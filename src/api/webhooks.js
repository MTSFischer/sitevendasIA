'use strict';

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

let instagramClient = null;
let whatsappManager = null;

function setup(instagram, whatsapp) {
  instagramClient = instagram;
  whatsappManager = whatsapp;
}

// ── Verificação do webhook do Instagram (GET) ───────────────────────────────
router.get('/webhook/instagram', (req, res) => {
  if (!instagramClient) return res.sendStatus(503);
  instagramClient.verifyWebhook(req, res);
});

// ── Recebimento de eventos do Instagram (POST) ──────────────────────────────
router.post('/webhook/instagram', (req, res) => {
  // Verifica assinatura do Meta para segurança
  if (!verifyMetaSignature(req)) {
    logger.warn('Webhook: assinatura inválida do Meta');
    return res.sendStatus(403);
  }

  res.sendStatus(200); // Responde imediatamente (exigido pelo Meta)

  if (instagramClient) {
    instagramClient.handleWebhookEvent(req.body).catch(err => {
      logger.error({ err: err.message }, 'Webhook Instagram: erro ao processar evento');
    });
  }
});

function verifyMetaSignature(req) {
  if (!config.instagram.appSecret) return true; // sem secret configurado, aceita tudo

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', config.instagram.appSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── API de status e relatórios ──────────────────────────────────────────────

router.get('/status', (req, res) => {
  const { getDb } = require('../database');
  const ConversationModel = require('../database/models/Conversation');
  const LeadModel = require('../database/models/Lead');

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    whatsapp: whatsappManager ? whatsappManager.getStatus() : {},
    instagram: { configured: !!config.instagram.accessToken },
    stats: {
      conversations: ConversationModel.getStats(),
      leads: LeadModel.getStats(),
    },
  });
});

router.get('/leads', (req, res) => {
  const LeadModel = require('../database/models/Lead');
  const { segment, temperatura, status, limit } = req.query;

  const leads = LeadModel.getAll({
    segment,
    temperatura,
    status,
    limit: parseInt(limit || '100', 10),
  });

  res.json({ total: leads.length, leads });
});

router.get('/conversations', (req, res) => {
  const { getDb } = require('../database');
  const db = getDb();

  const conversations = db.prepare(`
    SELECT c.*, COUNT(m.id) as message_count
    FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT 50
  `).all();

  res.json({ total: conversations.length, conversations });
});

// ── Healthcheck ─────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

module.exports = { router, setup };
