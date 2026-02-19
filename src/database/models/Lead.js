'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../index');

const LeadModel = {
  create({ conversationId, channel, channelId, segment, nome, telefone, email, necessidade, temperatura, observacoes }) {
    const id = uuidv4();
    getDb().prepare(`
      INSERT INTO leads (id, conversation_id, channel, channel_id, segment, nome, telefone, email, necessidade, temperatura, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, conversationId || null, channel, channelId, segment, nome || null, telefone || null, email || null, necessidade || null, temperatura || 'frio', observacoes || null);

    return id;
  },

  findByConversation(conversationId) {
    return getDb().prepare('SELECT * FROM leads WHERE conversation_id = ?').get(conversationId);
  },

  update(id, fields) {
    const allowed = ['nome', 'telefone', 'email', 'necessidade', 'temperatura', 'status', 'observacoes'];
    const sets = Object.keys(fields)
      .filter(k => allowed.includes(k))
      .map(k => `${k} = ?`);

    if (sets.length === 0) return;

    const values = Object.keys(fields)
      .filter(k => allowed.includes(k))
      .map(k => fields[k]);

    getDb().prepare(`
      UPDATE leads SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?
    `).run(...values, id);
  },

  getAll({ segment, temperatura, status, limit = 100 } = {}) {
    let query = 'SELECT * FROM leads WHERE 1=1';
    const params = [];

    if (segment) { query += ' AND segment = ?'; params.push(segment); }
    if (temperatura) { query += ' AND temperatura = ?'; params.push(temperatura); }
    if (status) { query += ' AND status = ?'; params.push(status); }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    return getDb().prepare(query).all(...params);
  },

  getStats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) as n FROM leads').get().n,
      bySegment: db.prepare('SELECT segment, COUNT(*) as total FROM leads GROUP BY segment').all(),
      byTemperatura: db.prepare('SELECT temperatura, COUNT(*) as total FROM leads GROUP BY temperatura').all(),
      byStatus: db.prepare('SELECT status, COUNT(*) as total FROM leads GROUP BY status').all(),
      recent: db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 10').all(),
    };
  },
};

module.exports = LeadModel;
