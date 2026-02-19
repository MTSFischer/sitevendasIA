'use strict';

const logger = require('../utils/logger');

/**
 * Fila de mensagens por usuário.
 * Garante que as mensagens de um mesmo usuário sejam processadas
 * uma de cada vez, em ordem — eliminando race conditions.
 */
class UserMessageQueue {
  constructor() {
    // Map<userId, Promise> — cada entrada é a última promessa da fila daquele usuário
    this._queues = new Map();
    // Map<userId, number> — timestamp da última mensagem (para rate limiting)
    this._lastMessage = new Map();
    // Intervalo mínimo entre mensagens do mesmo usuário (ms)
    this._rateLimitMs = parseInt(process.env.RATE_LIMIT_MS || '1500', 10);
    // Tamanho máximo de fila por usuário antes de descartar (evita DoS)
    this._maxQueueDepth = parseInt(process.env.MAX_QUEUE_DEPTH || '5', 10);
    // Contagem de mensagens enfileiradas por usuário
    this._queueDepth = new Map();
  }

  /**
   * Enfileira uma tarefa para um usuário específico.
   * A tarefa só roda depois que todas as anteriores do mesmo usuário terminarem.
   *
   * @param {string} userId  — identificador único do usuário (channelId)
   * @param {Function} task  — função async a executar
   * @returns {Promise<void>}
   */
  enqueue(userId, task) {
    // Rate limiting: ignora mensagens muito rápidas
    const now = Date.now();
    const last = this._lastMessage.get(userId) || 0;
    if (now - last < this._rateLimitMs) {
      logger.debug({ userId }, 'Mensagem ignorada por rate limiting');
      return Promise.resolve();
    }
    this._lastMessage.set(userId, now);

    // Profundidade da fila: descarta se exceder o limite
    const depth = (this._queueDepth.get(userId) || 0);
    if (depth >= this._maxQueueDepth) {
      logger.warn({ userId, depth }, 'Fila cheia — mensagem descartada');
      return Promise.resolve();
    }
    this._queueDepth.set(userId, depth + 1);

    // Encadeia a nova tarefa na fila do usuário
    const previous = this._queues.get(userId) || Promise.resolve();

    const next = previous
      .then(() => task())
      .catch(err => logger.error({ err, userId }, 'Erro ao processar mensagem na fila'))
      .finally(() => {
        this._queueDepth.set(userId, (this._queueDepth.get(userId) || 1) - 1);
        // Libera memória quando a fila do usuário esvazia
        if (this._queues.get(userId) === next) {
          this._queues.delete(userId);
          this._queueDepth.delete(userId);
        }
      });

    this._queues.set(userId, next);
    return next;
  }

  /** Quantidade de usuários com filas ativas */
  get activeUsers() {
    return this._queues.size;
  }
}

// Singleton compartilhado por todos os canais
const queue = new UserMessageQueue();

module.exports = queue;
