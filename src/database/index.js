'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

let db;

function getDb() {
  if (!db) {
    throw new Error('Banco de dados não inicializado. Chame initDb() primeiro.');
  }
  return db;
}

function initDb() {
  const dbPath = path.resolve(config.database.path);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  console.log(`[DB] Banco de dados iniciado em: ${dbPath}`);
  return db;
}

function createTables() {
  db.exec(`
    -- Conversas por cliente/canal
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,              -- 'whatsapp' | 'instagram'
      channel_id TEXT NOT NULL,           -- número WA ou user_id Instagram
      whatsapp_number TEXT,               -- número da empresa que recebeu a msg
      segment TEXT,                       -- 'LIMPA_NOMES' | 'REVISAO_CONTRATUAL' | 'MULTAS_CNH' | NULL
      audio_enabled INTEGER DEFAULT 1,    -- 1 = áudio habilitado
      status TEXT DEFAULT 'active',       -- 'active' | 'handoff' | 'closed'
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Mensagens de cada conversa
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      role TEXT NOT NULL,                 -- 'user' | 'assistant' | 'system'
      content TEXT NOT NULL,
      audio_url TEXT,                     -- URL do áudio gerado (se houver)
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Leads qualificados
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      conversation_id TEXT REFERENCES conversations(id),
      channel TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      nome TEXT,
      telefone TEXT,
      email TEXT,
      segment TEXT NOT NULL,
      necessidade TEXT,
      temperatura TEXT DEFAULT 'frio',    -- 'frio' | 'morno' | 'quente'
      status TEXT DEFAULT 'novo',         -- 'novo' | 'em_contato' | 'convertido' | 'perdido'
      observacoes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Índices para performance
    CREATE INDEX IF NOT EXISTS idx_conversations_channel_id
      ON conversations(channel, channel_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
      ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_leads_segment
      ON leads(segment);
    CREATE INDEX IF NOT EXISTS idx_leads_temperatura
      ON leads(temperatura);
  `);
}

module.exports = { initDb, getDb };
