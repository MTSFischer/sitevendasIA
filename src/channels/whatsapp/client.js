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

/**
 * Representa um cliente WhatsApp para um único número
 */
class WhatsAppClient {
  constructor(number, segment, onMessage) {
    this.number = number;
    this.segment = segment; // segmento fixo (ou null para triagem)
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

    const logger = pino({ level: 'silent' });

    this.socket = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: true,
      browser: ['IA Atendimento', 'Chrome', '120.0.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', (update) => {
      this._handleConnectionUpdate(update);
    });

    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        await this._handleIncomingMessage(msg);
      }
    });
  }

  _handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`\n[WhatsApp ${this.number}] Escaneie o QR code acima para conectar o número ${this.number}`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : null;

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[WhatsApp ${this.number}] Conexão encerrada. Código: ${statusCode}. Reconectar: ${shouldReconnect}`);
      this.isReady = false;

      if (shouldReconnect) {
        setTimeout(() => this.start(), 5000);
      }
    }

    if (connection === 'open') {
      console.log(`[WhatsApp ${this.number}] Conectado e pronto!`);
      this.isReady = true;
    }
  }

  async _handleIncomingMessage(msg) {
    try {
      // Ignora mensagens de grupos e broadcast
      if (isJidGroup(msg.key.remoteJid) || isJidBroadcast(msg.key.remoteJid)) return;
      // Ignora mensagens próprias
      if (msg.key.fromMe) return;
      // Ignora mensagens sem conteúdo
      if (!msg.message) return;

      const from = msg.key.remoteJid;
      const clientNumber = from.replace('@s.whatsapp.net', '');

      const text = this._extractMessageText(msg);
      if (!text || text.trim().length === 0) {
        await this._sendTextMessage(from, 'Desculpe, só consigo processar mensagens de texto por enquanto. Pode digitar sua dúvida?');
        return;
      }

      console.log(`[WhatsApp ${this.number}] Mensagem de ${clientNumber}: ${text.substring(0, 80)}...`);

      await this.onMessage({
        channel: 'whatsapp',
        channelId: clientNumber,
        whatsappNumber: this.number,
        segment: this.segment,
        text,
        raw: msg,
        send: (content) => this._send(from, content),
      });
    } catch (err) {
      console.error(`[WhatsApp ${this.number}] Erro ao processar mensagem:`, err);
    }
  }

  _extractMessageText(msg) {
    const message = msg.message;
    return (
      message?.conversation ||
      message?.extendedTextMessage?.text ||
      message?.imageMessage?.caption ||
      message?.videoMessage?.caption ||
      message?.buttonsResponseMessage?.selectedDisplayText ||
      message?.listResponseMessage?.title ||
      null
    );
  }

  async _send(to, content) {
    if (!this.socket || !this.isReady) {
      console.error(`[WhatsApp ${this.number}] Socket não está pronto para enviar`);
      return;
    }

    try {
      if (content.type === 'text') {
        await this._sendTextMessage(to, content.text);
      } else if (content.type === 'audio') {
        await this._sendAudioMessage(to, content.audioPath);
      } else if (content.type === 'text_and_audio') {
        await this._sendTextMessage(to, content.text);
        await this._sendAudioMessage(to, content.audioPath);
      }
    } catch (err) {
      console.error(`[WhatsApp ${this.number}] Erro ao enviar mensagem:`, err.message);
    }
  }

  async _sendTextMessage(to, text) {
    await this.socket.sendMessage(to, { text });
  }

  async _sendAudioMessage(to, audioPath) {
    if (!fs.existsSync(audioPath)) return;
    const audioBuffer = fs.readFileSync(audioPath);
    await this.socket.sendMessage(to, {
      audio: audioBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true, // ptt = Push-to-talk (aparece como mensagem de voz)
    });
  }

  async sendToContact(number, content) {
    const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
    await this._send(jid, content);
  }

  isConnected() {
    return this.isReady;
  }
}

module.exports = WhatsAppClient;
