'use strict';

require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
    publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    ttsVoice: process.env.OPENAI_TTS_VOICE || 'nova',
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '800', 10),
    maxHistory: parseInt(process.env.AI_MAX_HISTORY || '20', 10),
  },

  whatsapp: {
    numbers: (process.env.WHATSAPP_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean),
    mode: process.env.WHATSAPP_MODE || 'geral',
    segmentos: parseWhatsAppSegmentos(process.env.WHATSAPP_SEGMENTOS || ''),
    sessionsPath: process.env.SESSIONS_PATH || './sessions',
  },

  instagram: {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
    pageId: process.env.INSTAGRAM_PAGE_ID || '',
    verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN || 'verify_token',
    appSecret: process.env.META_APP_SECRET || '',
  },

  database: {
    path: process.env.DATABASE_PATH || './data/database.sqlite',
  },

  handoff: {
    whatsapp: process.env.HANDOFF_WHATSAPP || '',
    email: process.env.HANDOFF_EMAIL || '',
  },

  audio: {
    enabledByDefault: process.env.AUDIO_ENABLED_DEFAULT !== 'false',
    maxChars: parseInt(process.env.AUDIO_MAX_CHARS || '500', 10),
    tempPath: './temp',
  },
};

function parseWhatsAppSegmentos(raw) {
  const map = {};
  if (!raw) return map;
  raw.split(',').forEach(pair => {
    const [number, segment] = pair.trim().split('=');
    if (number && segment) {
      map[number.trim()] = segment.trim();
    }
  });
  return map;
}

function validate() {
  const errors = [];

  if (!config.openai.apiKey) {
    errors.push('OPENAI_API_KEY não configurada');
  }

  if (config.whatsapp.numbers.length === 0 && !config.instagram.accessToken) {
    errors.push('Configure pelo menos um canal: WHATSAPP_NUMBERS ou INSTAGRAM_ACCESS_TOKEN');
  }

  if (errors.length > 0) {
    process.stderr.write('[Config] ERROS DE CONFIGURAÇÃO:\n');
    errors.forEach(e => process.stderr.write(`  - ${e}\n`));
    if (config.server.env === 'production') {
      process.exit(1);
    }
  }
}

config.validate = validate;

module.exports = config;
