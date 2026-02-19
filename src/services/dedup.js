'use strict';

/**
 * Deduplicador de mensagens por ID.
 * Evita processar a mesma mensagem duas vezes — Baileys pode re-entregar
 * em reconexões ou quando o webhook é chamado mais de uma vez.
 */
class MessageDeduplicator {
  constructor(ttlMs = 5 * 60 * 1000) {
    this._seen = new Map(); // messageId → timestamp de expiração
    this._ttlMs = ttlMs;

    // Limpeza periódica para não crescer indefinidamente
    const interval = setInterval(() => this._cleanup(), ttlMs);
    if (interval.unref) interval.unref(); // não impede o processo de sair
  }

  /**
   * Retorna true se a mensagem já foi processada (duplicata).
   * Registra o ID automaticamente na primeira chamada.
   */
  isDuplicate(messageId) {
    if (!messageId) return false;

    if (this._seen.has(messageId)) {
      return true;
    }

    this._seen.set(messageId, Date.now() + this._ttlMs);
    return false;
  }

  _cleanup() {
    const now = Date.now();
    for (const [id, expiry] of this._seen) {
      if (now > expiry) this._seen.delete(id);
    }
  }

  get size() {
    return this._seen.size;
  }
}

module.exports = new MessageDeduplicator();
