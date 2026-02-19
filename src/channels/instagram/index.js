'use strict';

const axios = require('axios');
const config = require('../../config');

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Cliente Instagram DM via Meta Graph API
 */
class InstagramClient {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.accessToken = config.instagram.accessToken;
    this.pageId = config.instagram.pageId;
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

      // Comentários em posts
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

    // Ignora eco de mensagens próprias
    if (messaging.sender?.id === this.pageId) return;

    const userId = sender.id;
    const text = message.text || null;

    if (!text) {
      await this.sendMessage(userId, 'Oi! Por enquanto só consigo responder mensagens de texto. Pode me contar o que você precisa?');
      return;
    }

    console.log(`[Instagram] Mensagem de ${userId}: ${text.substring(0, 80)}...`);

    await this.onMessage({
      channel: 'instagram',
      channelId: userId,
      whatsappNumber: null,
      segment: null, // sempre triagem automática
      text,
      raw: messaging,
      send: (content) => this._send(userId, content),
    });
  }

  async _handleComment(comment) {
    if (!comment || !comment.from || !comment.id) return;

    const userId = comment.from.id;
    const text = comment.text || '';

    // Resposta automática em comentário (privada, via DM)
    const replyText = 'Oi! Vi seu comentário. Para te atender melhor, te mandei uma mensagem privada!';

    try {
      // Responde o comentário publicamente
      await axios.post(
        `${GRAPH_API_BASE}/${comment.id}/replies`,
        { message: replyText },
        { params: { access_token: this.accessToken } }
      );

      // Envia DM para o usuário
      await this.onMessage({
        channel: 'instagram',
        channelId: userId,
        whatsappNumber: null,
        segment: null,
        text: `[Via comentário] ${text}`,
        raw: comment,
        send: (content) => this._send(userId, content),
      });
    } catch (err) {
      console.error('[Instagram] Erro ao responder comentário:', err.message);
    }
  }

  async _send(userId, content) {
    if (content.type === 'text' || content.type === 'text_and_audio') {
      await this.sendMessage(userId, content.text);
    }
    // Instagram não suporta áudio via API básica — só texto e imagens
    // Para áudio, sugerimos migrar para WhatsApp
    if (content.type === 'audio') {
      await this.sendMessage(userId, '🎧 Prefere receber essa resposta em áudio? Posso continuar nosso atendimento pelo WhatsApp! Me informe seu número.');
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
      console.error('[Instagram] Erro ao enviar mensagem:', err.response?.data || err.message);
    }
  }

  /**
   * Envia mensagem com botões de resposta rápida
   */
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
      console.error('[Instagram] Erro ao enviar quick replies:', err.response?.data || err.message);
    }
  }

  _sanitizeText(text) {
    // Instagram tem limite de 1000 caracteres por mensagem
    return (text || '').substring(0, 1000);
  }

  /**
   * Verifica webhook do Instagram (desafio GET)
   */
  verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.instagram.verifyToken) {
      console.log('[Instagram] Webhook verificado com sucesso!');
      res.status(200).send(challenge);
    } else {
      console.error('[Instagram] Falha na verificação do webhook');
      res.sendStatus(403);
    }
  }
}

module.exports = InstagramClient;
