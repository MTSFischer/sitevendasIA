'use strict';

require('dotenv').config();

const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');
const { initDb, getDb } = require('./database');
const WhatsAppManager = require('./channels/whatsapp/manager');
const InstagramClient = require('./channels/instagram/index');
const { routeMessage } = require('./flows/router');
const { router: webhookRouter, setup: setupWebhooks } = require('./api/webhooks');
const { router: dashboardRouter } = require('./api/dashboard');
const { startCronJobs } = require('./services/cron');

async function main() {
  logger.info('IA Atendimento — WhatsApp & Instagram iniciando...');

  config.validate();
  const db = initDb();
  logger.info('Banco de dados inicializado');

  // ── Cron jobs ─────────────────────────────────────────────────────────────
  startCronJobs(db);

  let whatsappManager;
  let instagramClient;

  const onMessage = async (event) => {
    await routeMessage(event, whatsappManager);
  };

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  whatsappManager = new WhatsAppManager(onMessage);
  await whatsappManager.start();

  // ── Instagram ─────────────────────────────────────────────────────────────
  if (config.instagram.accessToken && config.instagram.pageId) {
    instagramClient = new InstagramClient(onMessage);
    instagramClient.setWhatsAppManager(whatsappManager);
    logger.info('Instagram configurado — aguardando eventos via webhook');
  } else {
    logger.warn('Instagram não configurado (INSTAGRAM_ACCESS_TOKEN ausente)');
  }

  // ── Servidor HTTP ─────────────────────────────────────────────────────────
  const app = express();
  app.use(express.json({ verify: rawBodySaver }));
  app.use(express.urlencoded({ extended: true }));

  setupWebhooks(instagramClient, whatsappManager);
  app.use('/api', webhookRouter);
  app.use('/dashboard', dashboardRouter);

  app.get('/', (req, res) => {
    res.json({
      name: 'IA Atendimento - WhatsApp & Instagram',
      version: '1.0.0',
      endpoints: {
        dashboard: '/dashboard',
        health: '/api/health',
        status: '/api/status',
        stats: '/api/stats',
        leads: '/api/leads',
        leadsExport: '/api/leads/export',
        conversations: '/api/conversations',
        webhookInstagram: '/api/webhook/instagram',
      },
      auth: config.admin.apiKey ? 'X-API-Key header requerido nos endpoints admin' : 'Sem autenticação (configure ADMIN_API_KEY)',
    });
  });

  const server = app.listen(config.server.port, () => {
    logger.info({
      port: config.server.port,
      dashboard: `${config.server.publicUrl}/dashboard`,
      webhookUrl: `${config.server.publicUrl}/api/webhook/instagram`,
    }, 'Servidor HTTP pronto');
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  async function shutdown(signal) {
    logger.info({ signal }, 'Sinal recebido — encerrando o sistema...');

    server.close(() => logger.info('Servidor HTTP encerrado'));

    if (whatsappManager) {
      for (const [, client] of whatsappManager.clients) {
        await client.close().catch(() => {});
      }
      logger.info('Clientes WhatsApp desconectados');
    }

    const forceExit = setTimeout(() => {
      logger.warn('Shutdown forçado após timeout');
      process.exit(1);
    }, 5000);
    forceExit.unref();

    logger.info('Sistema encerrado com sucesso');
    process.exit(0);
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException');
  });
}

function rawBodySaver(req, _res, buf) {
  req.rawBody = buf;
}

main().catch(err => {
  console.error('ERRO FATAL na inicialização:', err);
  process.exit(1);
});
