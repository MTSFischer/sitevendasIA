'use strict';

const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const queue = require('../../services/queue');

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

// Padrões para detectar quando o usuário quer migrar para o WhatsApp
const WA_MIGRATION_PATTERNS = [
  /whatsapp/i,
  /zap/i,
  /wpp/i,
  /quero.*áudio/i,
  /manda.*áudio/i,
  /audio/i,
  /continua.*wha/i,
];

// Padrão para extrair número de WhatsApp da mensagem do usuário
const PHONE_PATTERN = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)(?:9\s?)?\d{4}[-\s]?\d{4}/;

/**
 * Cliente Instagram DM via Meta Graph API.
 * Inclui bridge Instagram → WhatsApp quando o cliente fornece seu número.
 */
class InstagramClient {
  constructor(onMessage, whatsappManager = null) {
    this.onMessage = onMessage;
    this.whatsappManager = whatsappManager;
    this.accessToken = config.instagram.accessToken;
    this.pageId = config.instagram.pageId;
    // Map<instagramUserId, 'awaiting_phone'> para o bridge IG→WA
    this._bridgeState = new Map();
  }

  /** Injeta o WhatsAppManager após a construção (evita dependência circular) */
  setWhatsAppManager(manager) {
    this.whatsappManager = manager;
  }

  /**
   * Processa evento de webhook do Instagram
   */
  async handleWebhookEvent(body) {
    if (!body || body.object !== 'instagram') return;

    for (const entry of (body.entry || [])) {
      for (const messaging of (entry.messaging || [])) {
        await this._processMessaging(messaging);
      }

      for (const change of (entry.changes || [])) {
        if (change.field === 'comments') {
          await this._handleComment(change.value);
        }
      }
    }
  }

  async _processMessaging(messaging) {
    const { sender, message } = messaging;
    if (!sender || !message) return;
    if (messaging.sender?.id === this.pageId) return;

    const userId = sender.id;
    const text = message.text || null;

    if (!text) {
      await this.sendMessage(userId,
        'Oi! Só consigo responder mensagens de texto por aqui. Me conta o que você precisa!');
      return;
    }

    logger.info({ userId, preview: text.substring(0, 60) }, 'Instagram: mensagem recebida');

    // ── Bridge Instagram → WhatsApp ──────────────────────────────────────
    // Se estamos aguardando o número do usuário para migrar para WA
    if (this._bridgeState.get(userId) === 'awaiting_phone') {
      const phone = this._extractPhone(text);
      if (phone) {
        await this._executeBridge(userId, phone);
        return;
      }
      // Número inválido — pede novamente
      await this.sendMessage(userId,
        'Não consegui identificar o número. Por favor, envie no formato: 11 99999-9999 (com DDD).');
      return;
    }

    // Detecta pedido de áudio ou migração para WhatsApp
    if (WA_MIGRATION_PATTERNS.some(p => p.test(text)) && this.whatsappManager?.isAnyConnected()) {
      this._bridgeState.set(userId, 'awaiting_phone');
      await this.sendMessage(userId,
        'Ótimo! Posso continuar nosso atendimento pelo WhatsApp onde você também recebe respostas em áudio. 😊\n\n' +
        'Me informa seu número de WhatsApp com DDD (ex: 11 99999-9999) e te chamo por lá!');
      return;
    }
    // ────────────────────────────────────────────────────────────────────

    // Enfileira por userId — sem race condition
    queue.enqueue(`ig_${userId}`, async () => {
      await this.onMessage({
        channel: 'instagram',
        channelId: userId,
        whatsappNumber: null,
        segment: null,
        text,
        raw: messaging,
        send: (content) => this._send(userId, content),
      });
    });
  }

  async _handleComment(comment) {
    if (!comment || !comment.from || !comment.id) return;

    const userId = comment.from.id;
    const text = comment.text || '';

    try {
      await axios.post(
        `${GRAPH_API_BASE}/${comment.id}/replies`,
        { message: 'Oi! Vi seu comentário. Te mandei uma mensagem privada para te atender melhor! 😊' },
        { params: { access_token: this.accessToken } }
      );

      queue.enqueue(`ig_${userId}`, async () => {
        await this.onMessage({
          channel: 'instagram',
          channelId: userId,
          whatsappNumber: null,
          segment: null,
          text: `[Via comentário] ${text}`,
          raw: comment,
          send: (content) => this._send(userId, content),
        });
      });
    } catch (err) {
      logger.error({ err: err.message, userId }, 'Instagram: erro ao responder comentário');
    }
  }

  /**
   * Executa a migração da conversa Instagram → WhatsApp.
   * Envia mensagem de notificação no WA e encerra o fluxo no IG.
   */
  async _executeBridge(instagramUserId, waPhone) {
    this._bridgeState.delete(instagramUserId);

    const normalizedPhone = waPhone.replace(/\D/g, '');
    const fullPhone = normalizedPhone.startsWith('55') ? normalizedPhone : `55${normalizedPhone}`;

    logger.info({ instagramUserId, waPhone: fullPhone }, 'Instagram: bridge para WhatsApp iniciado');

    // Avisa no Instagram
    await this.sendMessage(instagramUserId,
      `Perfeito! Vou te chamar agora no WhatsApp (${waPhone}). Um momento! 📱`);

    // Envia a primeira mensagem no WhatsApp
    if (this.whatsappManager) {
      const fromNumber = config.whatsapp.numbers[0];
      await this.whatsappManager.send(fromNumber, fullPhone, {
        type: 'text',
        text:
          'Olá! 👋 Sou a ARIA, assistente virtual. Você solicitou continuar nosso atendimento pelo WhatsApp!\n\n' +
          'Pode me contar o que você precisa? Aqui também respondo em áudio. 😊',
      });
    }
  }

  _extractPhone(text) {
    const match = text.match(PHONE_PATTERN);
    return match ? match[0] : null;
  }

  async _send(userId, content) {
    if (content.type === 'text' || content.type === 'text_and_audio') {
      await this.sendMessage(userId, content.text);
    } else if (content.type === 'audio') {
      // Instagram não suporta áudio direto — oferece migração para WA
      if (this.whatsappManager?.isAnyConnected()) {
        this._bridgeState.set(userId, 'awaiting_phone');
        await this.sendMessage(userId,
          'Para receber respostas em áudio, posso continuar pelo WhatsApp! ' +
          'Me informa seu número com DDD que te chamo por lá. 📱');
      } else {
        await this.sendMessage(userId, content.text);
      }
    }
  }

  async sendMessage(userId, text) {
    if (!this.accessToken || !userId) return;
    try {
      await axios.post(
        `${GRAPH_API_BASE}/me/messages`,
        {
          recipient: { id: userId },
          message: { text: this._sanitizeText(text) },
          messaging_type: 'RESPONSE',
        },
        { params: { access_token: this.accessToken } }
      );
    } catch (err) {
      logger.error({ err: err.response?.data || err.message, userId }, 'Instagram: erro ao enviar');
    }
  }

  async sendQuickReplies(userId, text, options) {
    if (!this.accessToken) return;
    try {
      await axios.post(
        `${GRAPH_API_BASE}/me/messages`,
        {
          recipient: { id: userId },
          message: {
            text: this._sanitizeText(text),
            quick_replies: options.map(opt => ({
              content_type: 'text',
              title: opt.substring(0, 20),
              payload: opt,
            })),
          },
          messaging_type: 'RESPONSE',
        },
        { params: { access_token: this.accessToken } }
      );
    } catch (err) {
      logger.error({ err: err.response?.data || err.message, userId }, 'Instagram: erro ao enviar quick replies');
    }
  }

  _sanitizeText(text) {
    return (text || '').substring(0, 1000);
  }

  verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.instagram.verifyToken) {
      logger.info('Instagram: webhook verificado com sucesso');
      res.status(200).send(challenge);
    } else {
      logger.warn('Instagram: falha na verificação do webhook');
      res.sendStatus(403);
    }
  }
}

module.exports = InstagramClient;
