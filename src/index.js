'use strict';

require('dotenv').config();

const express = require('express');
const config = require('./config');
const { initDb } = require('./database');
const WhatsAppManager = require('./channels/whatsapp/manager');
const InstagramClient = require('./channels/instagram/index');
const { routeMessage } = require('./flows/router');
const { router: webhookRouter, setup: setupWebhooks } = require('./api/webhooks');

async function main() {
  console.log('======================================================');
  console.log('  IA Atendimento - WhatsApp & Instagram');
  console.log('  Limpa Nomes | Revisão Contratual | Multas CNH');
  console.log('======================================================\n');

  // Valida configurações
  config.validate();

  // Inicia banco de dados
  initDb();
  console.log('[Main] Banco de dados OK\n');

  // Cria a função de callback de mensagens (closure com whatsappManager)
  let whatsappManager;
  let instagramClient;

  const onMessage = async (event) => {
    await routeMessage(event, whatsappManager);
  };

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  whatsappManager = new WhatsAppManager(onMessage);
  await whatsappManager.start();

  // ── Instagram ────────────────────────────────────────────────────────────
  if (config.instagram.accessToken && config.instagram.pageId) {
    instagramClient = new InstagramClient(onMessage);
    console.log('[Instagram] Cliente configurado. Aguardando eventos via webhook.\n');
  } else {
    console.log('[Instagram] Não configurado (INSTAGRAM_ACCESS_TOKEN não definido).\n');
  }

  // ── Servidor HTTP (para webhooks e API) ───────────────────────────────────
  const app = express();
  app.use(express.json({ verify: rawBodySaver }));
  app.use(express.urlencoded({ extended: true }));

  setupWebhooks(instagramClient, whatsappManager);
  app.use('/api', webhookRouter);

  // Página inicial com instruções
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
      docs: 'Consulte o README.md para instruções de configuração',
    });
  });

  app.listen(config.server.port, () => {
    console.log(`[Server] Servidor HTTP rodando na porta ${config.server.port}`);
    console.log(`[Server] API disponível em: http://localhost:${config.server.port}/api/status`);
    console.log(`[Server] Webhook Instagram: ${config.server.publicUrl}/api/webhook/instagram\n`);
    console.log('Sistema pronto para atendimento!\n');
  });

  // ── Tratamento de erros não capturados ────────────────────────────────────
  process.on('unhandledRejection', (reason) => {
    console.error('[Main] Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[Main] Uncaught Exception:', err);
  });
}

// Salva o body raw para validação de assinatura do Meta
function rawBodySaver(req, res, buf) {
  req.rawBody = buf;
}

main().catch(err => {
  console.error('[Main] Erro fatal na inicialização:', err);
  process.exit(1);
});
