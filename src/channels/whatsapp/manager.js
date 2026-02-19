'use strict';

const config = require('../../config');
const WhatsAppClient = require('./client');

/**
 * Gerencia múltiplos clientes WhatsApp (um por número)
 */
class WhatsAppManager {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.clients = new Map(); // number -> WhatsAppClient
  }

  async start() {
    const numbers = config.whatsapp.numbers;

    if (numbers.length === 0) {
      console.log('[WhatsApp] Nenhum número configurado. Pulando inicialização do WhatsApp.');
      return;
    }

    console.log(`[WhatsApp] Inicializando ${numbers.length} número(s)...`);

    for (const number of numbers) {
      const segment = this._getSegmentForNumber(number);
      const client = new WhatsAppClient(number, segment, this.onMessage);
      this.clients.set(number, client);

      // Inicia os clientes com pequeno intervalo para evitar rate limit
      await new Promise(resolve => setTimeout(resolve, 2000));
      await client.start();
    }

    console.log('[WhatsApp] Todos os clientes iniciados.');
  }

  _getSegmentForNumber(number) {
    if (config.whatsapp.mode === 'segmento') {
      return config.whatsapp.segmentos[number] || null;
    }
    return null; // modo geral: triagem automática
  }

  /**
   * Envia mensagem via um número específico ou o primeiro disponível
   */
  async send(fromNumber, toNumber, content) {
    let client = this.clients.get(fromNumber);

    if (!client || !client.isConnected()) {
      // Fallback: usa o primeiro cliente conectado
      for (const [, c] of this.clients) {
        if (c.isConnected()) {
          client = c;
          break;
        }
      }
    }

    if (!client) {
      console.error('[WhatsApp] Nenhum cliente conectado disponível para enviar');
      return;
    }

    await client.sendToContact(toNumber, content);
  }

  getStatus() {
    const status = {};
    for (const [number, client] of this.clients) {
      status[number] = {
        connected: client.isConnected(),
        segment: client.segment,
      };
    }
    return status;
  }

  isAnyConnected() {
    for (const [, client] of this.clients) {
      if (client.isConnected()) return true;
    }
    return false;
  }
}

module.exports = WhatsAppManager;
