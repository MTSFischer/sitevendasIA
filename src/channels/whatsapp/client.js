'use strict';

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  isJidGroup,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const config = require('../../config');
const logger = require('../../utils/logger');
const queue = require('../../services/queue');

/**
 * Representa um cliente WhatsApp para um único número.
 */
class WhatsAppClient {
  constructor(number, segment, onMessage) {
    this.number = number;
    this.segment = segment;
    this.onMessage = onMessage;
    this.socket = null;
    this.isReady = false;
    this.sessionPath = path.resolve(config.whatsapp.sessionsPath, `session_${number}`);
  }

  async start() {
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const silentLogger = pino({ level: 'silent' });

    this.socket = makeWASocket({
      version,
      logger: silentLogger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      printQRInTerminal: true,
      browser: ['IA Atendimento', 'Chrome', '120.0.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    this.socket.ev.on('creds.update', saveCreds);
    this.socket.ev.on('connection.update', (u) => this._handleConnectionUpdate(u));
    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        await this._handleIncomingMessage(msg);
      }
    });
  }

  _handleConnectionUpdate({ connection, lastDisconnect, qr }) {
    if (qr) {
      logger.info({ number: this.number }, 'Escaneie o QR code acima para conectar');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : null;
      const shouldReconnect = code !== DisconnectReason.loggedOut;

      logger.warn({ number: this.number, code, shouldReconnect }, 'Conexão WhatsApp encerrada');
      this.isReady = false;

      if (shouldReconnect) {
        setTimeout(() => this.start(), 5000);
      }
    }

    if (connection === 'open') {
      logger.info({ number: this.number }, 'WhatsApp conectado e pronto');
      this.isReady = true;
    }
  }

  async _handleIncomingMessage(msg) {
    if (isJidGroup(msg.key.remoteJid) || isJidBroadcast(msg.key.remoteJid)) return;
    if (msg.key.fromMe) return;
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const clientNumber = from.replace('@s.whatsapp.net', '');
    const text = this._extractMessageText(msg);

    if (!text || text.trim().length === 0) {
      await this._sendText(from, 'Desculpe, só consigo processar mensagens de texto. Pode digitar sua dúvida?');
      return;
    }

    logger.info({ number: this.number, from: clientNumber, preview: text.substring(0, 60) }, 'Mensagem recebida');

    // Enfileira por usuário — processa uma de cada vez, sem race condition
    queue.enqueue(clientNumber, async () => {
      // Typing indicator: "digitando..." enquanto a IA processa
      await this._setTyping(from, true);
      try {
        await this.onMessage({
          channel: 'whatsapp',
          channelId: clientNumber,
          whatsappNumber: this.number,
          segment: this.segment,
          text,
          raw: msg,
          send: (content) => this._send(from, content),
        });
      } finally {
        await this._setTyping(from, false);
      }
    });
  }

  _extractMessageText(msg) {
    const m = msg.message;
    return (
      m?.conversation ||
      m?.extendedTextMessage?.text ||
      m?.imageMessage?.caption ||
      m?.videoMessage?.caption ||
      m?.buttonsResponseMessage?.selectedDisplayText ||
      m?.listResponseMessage?.title ||
      null
    );
  }

  async _setTyping(jid, composing) {
    try {
      await this.socket.sendPresenceUpdate(composing ? 'composing' : 'paused', jid);
    } catch {
      // não é crítico — ignora
    }
  }

  async _send(to, content) {
    if (!this.socket || !this.isReady) {
      logger.error({ number: this.number }, 'Socket não pronto para envio');
      return;
    }
    try {
      if (content.type === 'text') {
        await this._sendText(to, content.text);
      } else if (content.type === 'audio') {
        await this._sendAudio(to, content.audioPath);
      } else if (content.type === 'text_and_audio') {
        await this._sendText(to, content.text);
        await this._sendAudio(to, content.audioPath);
      }
    } catch (err) {
      logger.error({ err: err.message, number: this.number }, 'Erro ao enviar mensagem');
    }
  }

  async _sendText(to, text) {
    await this.socket.sendMessage(to, { text });
  }

  async _sendAudio(to, audioPath) {
    if (!fs.existsSync(audioPath)) return;
    const audioBuffer = fs.readFileSync(audioPath);
    await this.socket.sendMessage(to, {
      audio: audioBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    });
  }

  async sendToContact(number, content) {
    const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
    await this._send(jid, content);
  }

  async close() {
    if (this.socket) {
      try { await this.socket.logout(); } catch { /* ignora */ }
      this.socket = null;
      this.isReady = false;
    }
  }

  isConnected() {
    return this.isReady;
  }
}

module.exports = WhatsAppClient;
