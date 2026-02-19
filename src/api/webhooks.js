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

// ── Middleware de autenticação para endpoints admin ───────────────────────────
function adminAuth(req, res, next) {
  const apiKey = config.admin.apiKey;
  if (!apiKey) return next(); // sem chave configurada, acesso livre (dev)

  const header = req.headers['x-api-key'] || req.query.apiKey;
  if (!header || header !== apiKey) {
    logger.warn({ ip: req.ip, path: req.path }, 'Admin: acesso negado');
    return res.status(401).json({ error: 'Não autorizado. Informe a API key no header X-API-Key.' });
  }
  next();
}

// ── Webhook do Instagram (GET — verificação) ──────────────────────────────────
router.get('/webhook/instagram', (req, res) => {
  if (!instagramClient) return res.sendStatus(503);
  instagramClient.verifyWebhook(req, res);
});

// ── Webhook do Instagram (POST — eventos) ────────────────────────────────────
router.post('/webhook/instagram', (req, res) => {
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
  if (!config.instagram.appSecret) return true;

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', config.instagram.appSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── Status público ────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    whatsapp: whatsappManager ? whatsappManager.getStatus() : {},
    instagram: { configured: !!config.instagram.accessToken },
  });
});

// ── Healthcheck ───────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

// ── Endpoints admin (requerem X-API-Key) ─────────────────────────────────────
router.get('/stats', adminAuth, (req, res) => {
  const ConversationModel = require('../database/models/Conversation');
  const LeadModel = require('../database/models/Lead');

  res.json({
    timestamp: new Date().toISOString(),
    conversations: ConversationModel.getStats(),
    leads: LeadModel.getStats(),
  });
});

router.get('/leads', adminAuth, (req, res) => {
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

router.get('/conversations', adminAuth, (req, res) => {
  const { getDb } = require('../database');
  const db = getDb();

  const conversations = db.prepare(`
    SELECT c.*, COUNT(m.id) as message_count
    FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT 100
  `).all();

  res.json({ total: conversations.length, conversations });
});

// ── Export de leads em CSV ────────────────────────────────────────────────────
router.get('/leads/export', adminAuth, (req, res) => {
  const { segment, temperatura, status, from, to } = req.query;
  const { getDb } = require('../database');
  const db = getDb();

  let query = 'SELECT * FROM leads WHERE 1=1';
  const params = [];

  if (segment) { query += ' AND segment = ?'; params.push(segment); }
  if (temperatura) { query += ' AND temperatura = ?'; params.push(temperatura); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (from) { query += ' AND date(created_at) >= ?'; params.push(from); }
  if (to) { query += ' AND date(created_at) <= ?'; params.push(to); }

  query += ' ORDER BY created_at DESC';

  const leads = db.prepare(query).all(...params);

  const segmentLabels = {
    LIMPA_NOMES: 'Limpa Nomes',
    REVISAO_CONTRATUAL: 'Revisão Contratual',
    MULTAS_CNH: 'Multas CNH',
  };

  const rows = [
    ['ID', 'Canal', 'Contato', 'Nome', 'Telefone', 'Segmento', 'Necessidade', 'Temperatura', 'Status', 'Observações', 'Data'],
    ...leads.map(l => [
      l.id,
      l.channel,
      l.channel_id,
      l.nome || '',
      l.telefone || '',
      segmentLabels[l.segment] || l.segment,
      (l.necessidade || '').replace(/,/g, ';'),
      l.temperatura,
      l.status,
      (l.observacoes || '').replace(/,/g, ';'),
      l.created_at,
    ]),
  ];

  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const filename = `leads_${new Date().toISOString().split('T')[0]}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM para Excel abrir corretamente
});

module.exports = { router, setup };
