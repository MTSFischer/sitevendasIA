'use strict';

const ConversationModel = require('../database/models/Conversation');
const { generateResponse, detectSegment, detectsHandoffRequest, detectsAudioToggle } = require('../ai/openai');
const { textToSpeech, cleanupAudio } = require('../ai/tts');
const config = require('../config');

/**
 * Processa uma mensagem recebida de qualquer canal
 * Retorna o conteúdo a ser enviado de volta ao cliente
 */
async function processMessage({ channel, channelId, whatsappNumber, segment: fixedSegment, text }) {
  // 1. Busca ou cria a conversa
  const conv = ConversationModel.findOrCreate(channel, channelId, whatsappNumber);

  // 2. Verifica se o cliente quer toggle de áudio
  const audioToggle = detectsAudioToggle(text);
  if (audioToggle) {
    const enabled = audioToggle === 'enable';
    ConversationModel.toggleAudio(conv.id, enabled);
    const msg = enabled
      ? 'Certo! Vou te responder em áudio quando possível.'
      : 'Perfeito! Vou te responder apenas por texto.';
    return { type: 'text', text: msg };
  }

  // 3. Determina o segmento
  let segment = conv.segment || fixedSegment || null;

  if (!segment) {
    const detected = await detectSegment(text);
    if (detected !== 'INDEFINIDO') {
      segment = detected;
      ConversationModel.updateSegment(conv.id, segment);
    }
  }

  // 4. Verifica pedido de handoff
  const wantsHandoff = detectsHandoffRequest(text);

  // 5. Adiciona mensagem do usuário ao histórico
  ConversationModel.addMessage(conv.id, 'user', text);

  // 6. Busca histórico para contexto
  const messages = ConversationModel.getMessages(conv.id, config.openai.maxHistory);

  // 7. Gera resposta da IA
  const conversationContext = { id: conv.id, messages };
  let responseText = await generateResponse(conversationContext, text, segment || 'INDEFINIDO');

  // 8. Salva resposta da IA no histórico
  ConversationModel.addMessage(conv.id, 'assistant', responseText);

  // 9. Gera áudio se habilitado e canal suporta (WhatsApp)
  let audioPath = null;
  const audioEnabled = conv.audio_enabled === 1 || conv.audio_enabled === true;

  if (audioEnabled && channel === 'whatsapp' && responseText.length <= config.audio.maxChars) {
    audioPath = await textToSpeech(responseText);
  }

  // 10. Monta resposta final
  const result = {
    conversationId: conv.id,
    segment,
    wantsHandoff,
  };

  if (audioPath) {
    result.type = 'text_and_audio';
    result.text = responseText;
    result.audioPath = audioPath;
    result.cleanup = () => cleanupAudio(audioPath);
  } else {
    result.type = 'text';
    result.text = responseText;
  }

  return result;
}

module.exports = { processMessage };
