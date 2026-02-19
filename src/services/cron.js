'use strict';

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

function startCronJobs(db) {
  // A cada 15 min: remove arquivos de áudio temporários órfãos (> 30 min)
  cron.schedule('*/15 * * * *', () => cleanTempAudio());

  // A cada 2 horas: fecha conversas inativas há mais de 7 dias
  cron.schedule('0 */2 * * *', () => closeStaleConversations(db));

  // Diário às 08:00: loga estatísticas do dia anterior
  cron.schedule('0 8 * * *', () => logDailyStats(db));

  logger.info('Cron jobs iniciados (cleanup áudio, conversas, stats diárias)');
}

function cleanTempAudio() {
  const tempDir = path.resolve(config.audio.tempPath);
  if (!fs.existsSync(tempDir)) return;

  const maxAgeMs = 30 * 60 * 1000; // 30 minutos
  const now = Date.now();
  let cleaned = 0;

  for (const file of fs.readdirSync(tempDir)) {
    if (file === '.gitkeep') continue;
    const filePath = path.join(tempDir, file);
    try {
      const { mtimeMs } = fs.statSync(filePath);
      if (now - mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch {
      // ignora erros de arquivo em uso
    }
  }

  if (cleaned > 0) {
    logger.info({ cleaned }, 'Cron: áudios temporários removidos');
  }
}

function closeStaleConversations(db) {
  const result = db.prepare(`
    UPDATE conversations
    SET status = 'closed', updated_at = datetime('now')
    WHERE status = 'active'
      AND updated_at < datetime('now', '-7 days')
  `).run();

  if (result.changes > 0) {
    logger.info({ closed: result.changes }, 'Cron: conversas inativas fechadas');
  }
}

function logDailyStats(db) {
  const yesterday = "date('now', '-1 day')";

  const leadsOntem = db.prepare(
    `SELECT COUNT(*) as n FROM leads WHERE date(created_at) = ${yesterday}`
  ).get().n;

  const bySegment = db.prepare(
    `SELECT segment, COUNT(*) as n FROM leads WHERE date(created_at) = ${yesterday} GROUP BY segment`
  ).all();

  const conversasOntem = db.prepare(
    `SELECT COUNT(*) as n FROM conversations WHERE date(created_at) = ${yesterday}`
  ).get().n;

  const handoffsOntem = db.prepare(
    `SELECT COUNT(*) as n FROM conversations WHERE status = 'handoff' AND date(updated_at) = ${yesterday}`
  ).get().n;

  logger.info({ leadsOntem, bySegment, conversasOntem, handoffsOntem }, 'Stats do dia anterior');
}

module.exports = { startCronJobs };
