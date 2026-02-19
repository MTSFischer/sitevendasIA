'use strict';

require('dotenv').config();

const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');
const { initDb } = require('./database');
const WhatsAppManager = require('./channels/whatsapp/manager');
const InstagramClient = require('./channels/instagram/index');
const { routeMessage } = require('./flows/router');
const { router: webhookRouter, setup: setupWebhooks } = require('./api/webhooks');

async function main() {
  logger.info('IA Atendimento — WhatsApp & Instagram iniciando...');

  config.validate();
  initDb();
  logger.info('Banco de dados inicializado');

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
    // Injeta o WhatsAppManager para habilitar o bridge IG → WA
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

  app.get('/', (req, res) => {
    res.json({
      name: 'IA Atendimento - WhatsApp & Instagram',
      version: '1.0.0',
      endpoints: {
        health: '/api/health',
        status: '/api/status',
        leads: '/api/leads',
        conversations: '/api/conversations',
        webhookInstagram: '/api/webhook/instagram',
      },
    });
  });

  const server = app.listen(config.server.port, () => {
    logger.info({
      port: config.server.port,
      webhookUrl: `${config.server.publicUrl}/api/webhook/instagram`,
    }, 'Servidor HTTP pronto');
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  async function shutdown(signal) {
    logger.info({ signal }, 'Sinal recebido — encerrando o sistema...');

    // Para de aceitar novas requisições HTTP
    server.close(() => logger.info('Servidor HTTP encerrado'));

    // Encerra todos os sockets do WhatsApp
    if (whatsappManager) {
      for (const [, client] of whatsappManager.clients) {
        await client.close().catch(() => {});
      }
      logger.info('Clientes WhatsApp desconectados');
    }

    // Dá 5s para tarefas em andamento terminarem; força saída depois
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

  // ── Erros globais ─────────────────────────────────────────────────────────
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
  // Usa console.error aqui porque o logger pode não ter sido criado ainda
  console.error('ERRO FATAL na inicialização:', err);
  process.exit(1);
});
