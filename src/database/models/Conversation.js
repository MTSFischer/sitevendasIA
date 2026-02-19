'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../index');

const ConversationModel = {
  findOrCreate(channel, channelId, whatsappNumber = null) {
    const db = getDb();

    // Usa transação para eliminar a race condition TOCTOU (time-of-check/time-of-use)
    const result = db.transaction(() => {
      let conv = db.prepare(`
        SELECT * FROM conversations
        WHERE channel = ? AND channel_id = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 1
      `).get(channel, channelId);

      if (!conv) {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO conversations (id, channel, channel_id, whatsapp_number)
          VALUES (?, ?, ?, ?)
        `).run(id, channel, channelId, whatsappNumber);
        conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
      }

      return conv;
    })();

    return result;
  },

  findById(id) {
    return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  },

  updateSegment(id, segment) {
    getDb().prepare(`
      UPDATE conversations SET segment = ?, updated_at = datetime('now') WHERE id = ?
    `).run(segment, id);
  },

  updateStatus(id, status) {
    getDb().prepare(`
      UPDATE conversations SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, id);
  },

  toggleAudio(id, enabled) {
    getDb().prepare(`
      UPDATE conversations SET audio_enabled = ?, updated_at = datetime('now') WHERE id = ?
    `).run(enabled ? 1 : 0, id);
  },

  getMessages(conversationId, limit = 20) {
    return getDb().prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ? AND role != 'system'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(conversationId, limit);
  },

  addMessage(conversationId, role, content, audioUrl = null) {
    const db = getDb();
    const id = uuidv4();

    // Transação: INSERT + limpeza do histórico como operação atômica
    db.transaction(() => {
      db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, audio_url)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, conversationId, role, content, audioUrl);

      // Mantém apenas as últimas 40 mensagens por conversa
      db.prepare(`
        DELETE FROM messages
        WHERE conversation_id = ? AND id NOT IN (
          SELECT id FROM messages
          WHERE conversation_id = ?
          ORDER BY created_at DESC
          LIMIT 40
        )
      `).run(conversationId, conversationId);
    })();

    return id;
  },

  getStats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) as n FROM conversations').get().n,
      active: db.prepare("SELECT COUNT(*) as n FROM conversations WHERE status = 'active'").get().n,
      handoff: db.prepare("SELECT COUNT(*) as n FROM conversations WHERE status = 'handoff'").get().n,
      bySegment: db.prepare(`
        SELECT segment, COUNT(*) as total FROM conversations
        WHERE segment IS NOT NULL GROUP BY segment
      `).all(),
      byChannel: db.prepare(`
        SELECT channel, COUNT(*) as total FROM conversations GROUP BY channel
      `).all(),
    };
  },
};

module.exports = ConversationModel;
