'use strict';

const { processMessage } = require('../services/conversation');
const { qualifyLead, shouldQualify } = require('../services/lead');
const { executeHandoff, getHandoffMessage } = require('../services/handoff');
const ConversationModel = require('../database/models/Conversation');

/**
 * Roteador principal de mensagens
 * Recebe uma mensagem de qualquer canal e orquestra todo o fluxo
 */
async function routeMessage(event, whatsappManager) {
  const { channel, channelId, whatsappNumber, segment, text, send } = event;

  try {
    // 1. Processa a mensagem e gera resposta
    const result = await processMessage({
      channel,
      channelId,
      whatsappNumber,
      segment,
      text,
    });

    // 2. Verifica se a conversa está em handoff (humano já assumiu)
    const conv = ConversationModel.findById(result.conversationId);
    if (conv && conv.status === 'handoff') {
      // Conversa em handoff — não responde automaticamente
      return;
    }

    // 3. Envia a resposta ao cliente
    await send(result);

    // 4. Limpa arquivo de áudio temporário se houver
    if (result.cleanup) {
      result.cleanup();
    }

    // 5. Verifica se deve fazer handoff
    if (result.wantsHandoff || await shouldAutoHandoff(result.conversationId)) {
      const handoffMsg = getHandoffMessage(result.segment);
      await send({ type: 'text', text: handoffMsg });

      const lead = await qualifyLead(result.conversationId);
      await executeHandoff({
        conversationId: result.conversationId,
        lead: lead?.lead,
        whatsappManager,
      });
      return;
    }

    // 6. Qualificação periódica do lead
    const messages = ConversationModel.getMessages(result.conversationId, 50);
    if (shouldQualify(messages.length)) {
      await qualifyLead(result.conversationId).catch(err => {
        console.error('[Router] Erro na qualificação do lead:', err.message);
      });
    }
  } catch (err) {
    console.error(`[Router] Erro ao processar mensagem de ${channel}/${channelId}:`, err);

    try {
      await send({
        type: 'text',
        text: 'Desculpe, tive um problema técnico. Pode repetir sua mensagem?',
      });
    } catch {
      // ignora erro de envio de erro
    }
  }
}

/**
 * Verifica se a conversa deve ir automaticamente para handoff
 * baseado em critérios como número de mensagens ou temperatura do lead
 */
async function shouldAutoHandoff(conversationId) {
  const messages = ConversationModel.getMessages(conversationId, 50);

  // Handoff automático após muitas trocas de mensagem (conversa longa = lead quente)
  if (messages.length >= 16) {
    const { qualifyLead } = require('../services/lead');
    const result = await qualifyLead(conversationId);
    return result?.lead?.temperatura === 'quente' && result?.prontoPara === true;
  }

  return false;
}

module.exports = { routeMessage };
