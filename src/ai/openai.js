'use strict';

const OpenAI = require('openai');
const config = require('../config');
const { withRetry } = require('./retry');
const { BASE_SYSTEM, MENU_INICIAL } = require('./prompts/base');
const { LIMPA_NOMES_SYSTEM } = require('./prompts/limpaNomes');
const { REVISAO_CONTRATUAL_SYSTEM } = require('./prompts/revisaoContratual');
const { MULTAS_CNH_SYSTEM } = require('./prompts/multasCNH');

let client;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return client;
}

const SEGMENT_PROMPTS = {
  LIMPA_NOMES: LIMPA_NOMES_SYSTEM,
  REVISAO_CONTRATUAL: REVISAO_CONTRATUAL_SYSTEM,
  MULTAS_CNH: MULTAS_CNH_SYSTEM,
};

function buildSystemPrompt(segment) {
  if (segment && SEGMENT_PROMPTS[segment]) {
    return SEGMENT_PROMPTS[segment];
  }
  return BASE_SYSTEM + '\n\n' + MENU_INICIAL;
}

/**
 * Detecta o segmento com base na mensagem do usuário
 */
async function detectSegment(userMessage) {
  const openai = getClient();

  const response = await withRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    temperature: 0,
    max_tokens: 20,
    messages: [
      {
        role: 'system',
        content: `Identifique o segmento de interesse do cliente a partir da mensagem.
Responda APENAS com uma das opções abaixo (sem explicação):
- LIMPA_NOMES (nome negativado, Serasa, SPC, dívida, inadimplência)
- REVISAO_CONTRATUAL (contrato, juros, financiamento, banco, parcela)
- MULTAS_CNH (multa, CNH, habilitação, pontos, suspensão, cassação)
- INDEFINIDO (não é claro o segmento)`,
      },
      { role: 'user', content: userMessage },
    ],
  }));

  const result = response.choices[0]?.message?.content?.trim() || 'INDEFINIDO';
  const valid = ['LIMPA_NOMES', 'REVISAO_CONTRATUAL', 'MULTAS_CNH', 'INDEFINIDO'];
  return valid.includes(result) ? result : 'INDEFINIDO';
}

/**
 * Extrai dados do lead da conversa (nome, telefone, temperatura, etc.)
 */
async function extractLeadData(messages) {
  const openai = getClient();

  const conversation = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Cliente' : 'Assistente'}: ${m.content}`)
    .join('\n');

  const response = await withRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    temperature: 0,
    max_tokens: 300,
    messages: [
      {
        role: 'system',
        content: `Analise a conversa e extraia os dados do lead em JSON válido.
Retorne APENAS o JSON, sem markdown ou explicações:
{
  "nome": string ou null,
  "telefone": string ou null,
  "necessidade": string resumida ou null,
  "temperatura": "frio" | "morno" | "quente",
  "pronto_para_handoff": boolean,
  "observacoes": string ou null
}

Temperatura:
- quente: cliente com caso específico, urgência, dados fornecidos
- morno: interesse mas sem detalhes suficientes
- frio: apenas curiosidade ou exploração`,
      },
      { role: 'user', content: conversation },
    ],
  }));

  try {
    const text = response.choices[0]?.message?.content?.trim() || '{}';
    return JSON.parse(text);
  } catch {
    return { temperatura: 'frio', pronto_para_handoff: false };
  }
}

/**
 * Verifica se o cliente quer falar com humano
 */
function detectsHandoffRequest(message) {
  const lower = message.toLowerCase();
  const keywords = [
    'falar com humano', 'falar com pessoa', 'atendente', 'advogado',
    'especialista', 'responsável', 'humano', 'pessoa real', 'quero falar',
    'me transfere', 'transferir', 'atendimento humano',
  ];
  return keywords.some(k => lower.includes(k));
}

/**
 * Verifica se o cliente deseja desativar o áudio
 */
function detectsAudioToggle(message) {
  const lower = message.toLowerCase();
  if (lower.includes('sem áudio') || lower.includes('sem audio') ||
      lower.includes('só texto') || lower.includes('so texto') ||
      lower.includes('não quero áudio') || lower.includes('desativa áudio')) {
    return 'disable';
  }
  if (lower.includes('manda áudio') || lower.includes('manda audio') ||
      lower.includes('ativa áudio') || lower.includes('com áudio')) {
    return 'enable';
  }
  return null;
}

/**
 * Gera resposta da IA para a mensagem do cliente
 */
async function generateResponse(conversation, userMessage, segment) {
  const openai = getClient();

  const systemPrompt = buildSystemPrompt(segment === 'INDEFINIDO' ? null : segment);
  const historyMessages = conversation.messages.slice(-config.openai.maxHistory);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...historyMessages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const response = await withRetry(() => openai.chat.completions.create({
    model: config.openai.model,
    temperature: config.openai.temperature,
    max_tokens: config.openai.maxTokens,
    messages,
  }));

  return response.choices[0]?.message?.content?.trim()
    || 'Desculpe, tive um problema ao processar sua mensagem. Pode repetir?';
}

module.exports = {
  generateResponse,
  detectSegment,
  extractLeadData,
  detectsHandoffRequest,
  detectsAudioToggle,
};
