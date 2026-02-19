'use strict';

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

let client;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return client;
}

const TEMP_DIR = path.resolve(config.audio.tempPath);

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Converte texto em áudio usando OpenAI TTS
 * Retorna o caminho do arquivo .ogg gerado (compatível com WhatsApp)
 */
async function textToSpeech(text) {
  if (!text || text.length === 0) return null;

  // Limpa markdown e caracteres especiais do texto antes de converter
  const cleanText = text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/[_~`]/g, '')
    .replace(/emoji_\w+/g, '')
    .replace(/[1-9]️⃣/g, '')
    .replace(/[\u{1F600}-\u{1F9FF}]/gu, '')  // remove emojis
    .trim();

  if (!cleanText || cleanText.length === 0) return null;

  // Trunca se muito longo
  const truncated = cleanText.length > config.audio.maxChars
    ? cleanText.substring(0, config.audio.maxChars) + '...'
    : cleanText;

  ensureTempDir();

  const mp3Path = path.join(TEMP_DIR, `${uuidv4()}.mp3`);
  const oggPath = mp3Path.replace('.mp3', '.ogg');

  try {
    const openai = getClient();

    // Gera o áudio em MP3
    const mp3Response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: config.openai.ttsVoice,
      input: truncated,
      response_format: 'mp3',
    });

    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    fs.writeFileSync(mp3Path, buffer);

    // Converte MP3 → OGG Opus (formato do WhatsApp)
    await convertToOggOpus(mp3Path, oggPath);

    // Remove o MP3 original
    fs.unlinkSync(mp3Path);

    return oggPath;
  } catch (err) {
    logger.error({ err: err.message }, 'TTS: erro ao gerar áudio');
    // Limpa arquivos em caso de erro
    if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
    if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
    return null;
  }
}

/**
 * Converte arquivo de áudio para OGG Opus usando fluent-ffmpeg
 */
function convertToOggOpus(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpegStatic = require('ffmpeg-static');
    const ffmpeg = require('fluent-ffmpeg');

    ffmpeg.setFfmpegPath(ffmpegStatic);

    ffmpeg(inputPath)
      .audioCodec('libopus')
      .audioFrequency(48000)
      .audioChannels(1)
      .format('ogg')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

/**
 * Remove arquivo temporário de áudio após envio
 */
function cleanupAudio(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      // ignora erros de limpeza
    }
  }
}

module.exports = { textToSpeech, cleanupAudio };
