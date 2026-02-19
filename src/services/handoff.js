'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const ConversationModel = require('../database/models/Conversation');
const LeadModel = require('../database/models/Lead');

/**
 * Executa o handoff de uma conversa para atendimento humano
 */
async function executeHandoff({ conversationId, lead, whatsappManager }) {
  ConversationModel.updateStatus(conversationId, 'handoff');

  if (lead) {
    LeadModel.update(lead.id, { status: 'em_contato' });
  }

  // Notifica o número de handoff via WhatsApp
  if (config.handoff.whatsapp && whatsappManager) {
    await notifyHandoffNumber(whatsappManager, conversationId, lead);
  }

  logger.info({ conversationId }, 'Handoff: conversa transferida para atendimento humano');
}

async function notifyHandoffNumber(whatsappManager, conversationId, lead) {
  const conv = ConversationModel.findById(conversationId);
  if (!conv) return;

  const channel = conv.channel === 'whatsapp' ? 'WhatsApp' : 'Instagram';
  const segmentNames = {
    LIMPA_NOMES: 'Limpa Nomes',
    REVISAO_CONTRATUAL: 'Revisão Contratual',
    MULTAS_CNH: 'Multas CNH',
  };

  let notification = `🔔 *NOVO LEAD - ATENDIMENTO HUMANO*\n\n`;
  notification += `📱 Canal: ${channel}\n`;
  notification += `🎯 Segmento: ${segmentNames[conv.segment] || 'Não identificado'}\n`;
  notification += `👤 Contato: ${conv.channel_id}\n`;

  if (lead) {
    if (lead.nome) notification += `📛 Nome: ${lead.nome}\n`;
    if (lead.telefone) notification += `📞 Telefone: ${lead.telefone}\n`;
    if (lead.necessidade) notification += `📝 Necessidade: ${lead.necessidade}\n`;
    notification += `🌡️ Temperatura: ${lead.temperatura?.toUpperCase() || 'N/A'}\n`;
    if (lead.observacoes) notification += `📋 Obs: ${lead.observacoes}\n`;
  }

  notification += `\n⏰ ${new Date().toLocaleString('pt-BR')}\n`;
  notification += `\n_Responda diretamente para ${conv.channel_id}_`;

  try {
    await whatsappManager.send(
      config.whatsapp.numbers[0], // usa o primeiro número disponível
      config.handoff.whatsapp,
      { type: 'text', text: notification }
    );
  } catch (err) {
    logger.error({ err: err.message }, 'Handoff: erro ao notificar número de handoff');
  }
}

/**
 * Mensagem de transição para o cliente
 */
function getHandoffMessage(segment) {
  const segmentMessages = {
    LIMPA_NOMES: 'Vou conectar você com um dos nossos especialistas em regularização de crédito agora. Um momento! Em breve alguém entrará em contato.',
    REVISAO_CONTRATUAL: 'Vou te encaminhar para um dos nossos advogados especialistas em revisão contratual. Em breve entrarão em contato!',
    MULTAS_CNH: 'Dado o prazo, vou te conectar AGORA com um especialista em defesa de multas. Aguarde o contato!',
  };

  return segmentMessages[segment] ||
    'Vou te conectar com um dos nossos especialistas. Em breve alguém entrará em contato!';
}

module.exports = { executeHandoff, getHandoffMessage };
