'use strict';

const logger = require('../utils/logger');

/**
 * Executa uma função async com retry e backoff exponencial.
 * Retenta automaticamente em:
 *  - 429 Too Many Requests (rate limit da OpenAI)
 *  - 500/502/503/529 erros de servidor
 *
 * @param {Function} fn           Função async a executar
 * @param {object}   opts
 * @param {number}   opts.maxAttempts  Número máximo de tentativas (padrão: 3)
 * @param {number}   opts.baseDelayMs  Delay inicial em ms (padrão: 1000)
 * @param {number}   opts.maxDelayMs   Delay máximo em ms (padrão: 16000)
 */
async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 16000 } = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const status = err.status || err.response?.status;
      const isRetryable = status === 429 || (status >= 500 && status !== 501);

      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }

      // Se a API informar um "retry-after", respeitar
      const retryAfter = err.headers?.['retry-after'];
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);

      logger.warn({ status, attempt, maxAttempts, waitMs }, 'OpenAI: erro retentável, aguardando...');
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  throw lastErr;
}

module.exports = { withRetry };
