'use strict';

const LeadModel = require('../database/models/Lead');
const ConversationModel = require('../database/models/Conversation');
const { extractLeadData } = require('../ai/openai');

/**
 * Qualifica o lead com base na conversa atual
 * Deve ser chamado periodicamente ou quando o lead parecer quente
 */
async function qualifyLead(conversationId) {
  const conv = ConversationModel.findById(conversationId);
  if (!conv) return null;

  // Verifica se já existe lead para esta conversa
  let lead = LeadModel.findByConversation(conversationId);

  // Só qualifica se tiver segmento definido
  if (!conv.segment) return lead;

  const messages = ConversationModel.getMessages(conversationId, 30);
  if (messages.length < 2) return lead;

  // Extrai dados do lead via IA
  const extracted = await extractLeadData(messages);

  if (!lead) {
    // Cria novo lead
    const id = LeadModel.create({
      conversationId,
      channel: conv.channel,
      channelId: conv.channel_id,
      segment: conv.segment,
      nome: extracted.nome,
      telefone: extracted.telefone || conv.channel_id,
      necessidade: extracted.necessidade,
      temperatura: extracted.temperatura || 'frio',
      observacoes: extracted.observacoes,
    });

    lead = { id, ...extracted, segment: conv.segment };
  } else {
    // Atualiza lead existente
    const updates = {};
    if (extracted.nome && !lead.nome) updates.nome = extracted.nome;
    if (extracted.necessidade) updates.necessidade = extracted.necessidade;
    if (extracted.temperatura) updates.temperatura = extracted.temperatura;
    if (extracted.observacoes) updates.observacoes = extracted.observacoes;

    if (Object.keys(updates).length > 0) {
      LeadModel.update(lead.id, updates);
      lead = { ...lead, ...updates };
    }
  }

  return { lead, prontoPara: extracted.pronto_para_handoff };
}

/**
 * Verifica se devemos qualificar o lead com base no número de mensagens
 */
function shouldQualify(messageCount) {
  // Qualifica a cada 5 mensagens ou quando a conversa for longa
  return messageCount > 0 && messageCount % 5 === 0;
}

module.exports = { qualifyLead, shouldQualify };
