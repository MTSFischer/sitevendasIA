'use strict';

const ConversationModel = require('../database/models/Conversation');
const { generateResponse, detectSegment, detectsHandoffRequest, detectsAudioToggle } = require('../ai/openai');
const { textToSpeech, cleanupAudio } = require('../ai/tts');
const config = require('../config');

const LGPD_NOTICE =
  '⚠️ *Aviso de Privacidade (LGPD)*\n' +
  'Seus dados são usados exclusivamente para análise preliminar e contato sobre o assunto informado. ' +
  'Não compartilhamos suas informações com terceiros sem sua autorização. ' +
  'Para solicitar exclusão dos seus dados, basta pedir a qualquer momento.\n\n';

/**
 * Processa uma mensagem recebida de qualquer canal.
 * Retorna o conteúdo a ser enviado de volta ao cliente.
 */
async function processMessage({ channel, channelId, whatsappNumber, segment: fixedSegment, text }) {
  // 1. Busca ou cria a conversa
  const conv = ConversationModel.findOrCreate(channel, channelId, whatsappNumber);

  // 2. Detecta se é a primeira mensagem desta conversa
  const existingMessages = ConversationModel.getMessages(conv.id, 1);
  const isNewConversation = existingMessages.length === 0;

  // 3. Verifica se o cliente quer toggle de áudio
  const audioToggle = detectsAudioToggle(text);
  if (audioToggle) {
    const enabled = audioToggle === 'enable';
    ConversationModel.toggleAudio(conv.id, enabled);
    const msg = enabled
      ? 'Certo! Vou te responder em áudio quando possível.'
      : 'Perfeito! Vou te responder apenas por texto.';
    return { type: 'text', text: msg, conversationId: conv.id, isNewConversation: false };
  }

  // 4. Determina o segmento
  let segment = conv.segment || fixedSegment || null;

  if (!segment) {
    const detected = await detectSegment(text);
    if (detected !== 'INDEFINIDO') {
      segment = detected;
      ConversationModel.updateSegment(conv.id, segment);
    }
  }

  // 5. Verifica pedido de handoff
  const wantsHandoff = detectsHandoffRequest(text);

  // 6. Adiciona mensagem do usuário ao histórico
  ConversationModel.addMessage(conv.id, 'user', text);

  // 7. Busca histórico para contexto
  const messages = ConversationModel.getMessages(conv.id, config.openai.maxHistory);

  // 8. Gera resposta da IA
  const conversationContext = { id: conv.id, messages };
  let responseText = await generateResponse(conversationContext, text, segment || 'INDEFINIDO');

  // 9. Prepend aviso LGPD na primeira mensagem do canal (não WhatsApp, que terá lista interativa)
  if (isNewConversation && channel !== 'whatsapp') {
    responseText = LGPD_NOTICE + responseText;
  }

  // 10. Salva resposta da IA no histórico
  ConversationModel.addMessage(conv.id, 'assistant', responseText);

  // 11. Gera áudio se habilitado e canal suporta (WhatsApp)
  let audioPath = null;
  const audioEnabled = conv.audio_enabled === 1 || conv.audio_enabled === true;

  if (audioEnabled && channel === 'whatsapp' && responseText.length <= config.audio.maxChars) {
    audioPath = await textToSpeech(responseText);
  }

  // 12. Monta resposta final
  const result = {
    conversationId: conv.id,
    segment,
    wantsHandoff,
    isNewConversation,
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

module.exports = { processMessage, LGPD_NOTICE };
