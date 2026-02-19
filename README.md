# IA Atendimento — WhatsApp & Instagram

Sistema de atendimento automatizado com Inteligência Artificial para escritórios jurídicos digitais.

**Segmentos atendidos:**
- Limpa Nomes (negativação / Serasa / SPC)
- Revisão Contratual (juros abusivos / financiamentos)
- Multas de CNH (suspensão / cassação / pontos)

---

## Funcionalidades

| Recurso | Status |
|---|---|
| Atendimento via WhatsApp (texto) | ✅ |
| Atendimento via WhatsApp (áudio/voz) | ✅ |
| Atendimento via Instagram DM | ✅ |
| Respostas automáticas em comentários do Instagram | ✅ |
| Múltiplos números de WhatsApp | ✅ |
| IA com contexto de conversa | ✅ |
| Identificação automática do segmento | ✅ |
| Qualificação automática de leads | ✅ |
| Transferência para atendimento humano | ✅ |
| Histórico de conversas (SQLite) | ✅ |
| Dashboard de leads (API REST) | ✅ |
| Toggle de áudio pelo cliente | ✅ |

---

## Pré-requisitos

- Node.js 18+ ou Docker
- Chave de API da OpenAI (GPT-4o)
- ffmpeg instalado (para conversão de áudio)
- Conta Meta Business para Instagram (opcional)

---

## Instalação

### Com Docker (recomendado)

```bash
# 1. Clone o repositório
git clone <url-do-repo>
cd ia-atendimento

# 2. Configure as variáveis de ambiente
cp .env.example .env
nano .env  # Preencha os valores

# 3. Inicie com Docker
docker-compose up -d

# 4. Acompanhe os logs (para escanear o QR code do WhatsApp)
docker-compose logs -f
```

### Sem Docker (Node.js direto)

```bash
# 1. Instale as dependências
npm install

# 2. Configure as variáveis
cp .env.example .env
# Edite o .env com seus dados

# 3. Inicie o sistema
npm start

# Ou em modo desenvolvimento (com auto-reload)
npm run dev
```

---

## Configuração

### 1. OpenAI

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_TTS_VOICE=nova
```

Vozes disponíveis: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

### 2. WhatsApp

```env
# Números de WhatsApp da empresa (formato internacional sem +)
WHATSAPP_NUMBERS=5511999999999,5511888888888

# Modo de atendimento
WHATSAPP_MODE=geral  # ou "segmento" para fixar um segmento por número

# Se modo=segmento, defina qual número atende qual segmento:
WHATSAPP_SEGMENTOS=5511999999999=LIMPA_NOMES,5511888888888=MULTAS_CNH
```

**Autorizar o WhatsApp:**
Na primeira execução, um QR code será exibido no terminal.
Escaneie com o WhatsApp Business no celular.
As sessões são salvas em `./sessions/` — não é preciso escanear novamente.

### 3. Instagram

Para receber mensagens do Instagram, é necessário:

1. Ter um **App Meta** configurado no [Meta for Developers](https://developers.facebook.com)
2. Configurar o webhook para apontar para `https://seudominio.com.br/api/webhook/instagram`
3. Obter um **Page Access Token** com permissão `instagram_manage_messages`

```env
INSTAGRAM_ACCESS_TOKEN=EAAxxxxx
INSTAGRAM_PAGE_ID=123456789
INSTAGRAM_VERIFY_TOKEN=token_que_voce_escolhe
META_APP_SECRET=seu_app_secret
```

### 4. Handoff Humano

```env
# Número que receberá notificações de leads qualificados
HANDOFF_WHATSAPP=5511777777777
```

---

## API REST

O sistema expõe uma API REST para monitoramento:

| Endpoint | Descrição |
|---|---|
| `GET /api/health` | Healthcheck |
| `GET /api/status` | Status geral + estatísticas |
| `GET /api/leads` | Lista de leads |
| `GET /api/conversations` | Lista de conversas |
| `GET /api/webhook/instagram` | Verificação de webhook |
| `POST /api/webhook/instagram` | Recebimento de eventos |

### Filtros de leads

```
GET /api/leads?segment=LIMPA_NOMES&temperatura=quente&status=novo
```

---

## Fluxo de Atendimento

```
Cliente envia mensagem
         │
         ▼
    Identifica canal
    (WhatsApp/Instagram)
         │
         ▼
    Detecta segmento
    (Limpa Nomes / Revisão
     Contratual / Multas CNH)
         │
         ▼
    Gera resposta com GPT-4o
    (com contexto da conversa)
         │
         ▼
    Converte para áudio? ──── SIM ──► Envia texto + voz (WhatsApp)
         │                                       │
        NÃO                                      │
         │◄────────────────────────────────────◄─┘
         │
         ▼
    Qualifica lead
    (frio / morno / quente)
         │
         ▼
    Handoff necessário? ── SIM ──► Notifica equipe + fecha conversa automática
         │
        NÃO
         │
         ▼
    Continua atendimento
```

---

## Segmentos e Comportamento da IA

### Limpa Nomes
- Identifica tipo e origem da dívida
- Explica possibilidade de análise gratuita
- Coleta dados sem prometer resultados
- Informa sobre prescrição e revisão de juros

### Revisão Contratual
- Explica revisão contratual de forma simples
- Identifica tipo de contrato (financiamento, empréstimo, etc.)
- Orienta envio de documentação
- Não promete redução de dívida

### Multas CNH
- Identifica situação da CNH e prazos
- Orienta sobre recurso administrativo e judicial
- Alta urgência — direciona para humano mais rapidamente
- Nunca promete cancelamento de multa

---

## Conformidade Legal

O sistema foi projetado para seguir o **Código de Ética da OAB** e a **LGPD**:

- Nunca promete resultados garantidos
- Não coleta CPF, senhas ou dados bancários
- Informa que dados são usados apenas para contato e análise
- Usa linguagem de orientação, não de garantia
- Aviso legal incluído nos prompts de IA

---

## Monitoramento

```bash
# Ver logs em tempo real
docker-compose logs -f

# Verificar status
curl http://localhost:3000/api/status

# Listar leads quentes
curl "http://localhost:3000/api/leads?temperatura=quente"
```

---

## Estrutura do Projeto

```
src/
├── config/           # Configurações centralizadas
├── database/         # SQLite + modelos
│   └── models/
├── ai/               # Motor de IA
│   ├── openai.js     # GPT-4o + detecção de segmento
│   ├── tts.js        # Text-to-Speech (voz)
│   └── prompts/      # Prompts por segmento
├── channels/
│   ├── whatsapp/     # Baileys (multi-número)
│   └── instagram/    # Meta Graph API
├── flows/
│   └── router.js     # Orquestrador de mensagens
├── services/
│   ├── conversation.js
│   ├── lead.js
│   └── handoff.js
├── api/
│   └── webhooks.js   # Endpoints HTTP
└── index.js          # Entry point
```

---

## Suporte

Em caso de dúvidas sobre configuração ou funcionamento, verifique:

1. Os logs do sistema (`docker-compose logs -f`)
2. O endpoint `/api/status` para ver o estado das conexões
3. As variáveis de ambiente no `.env`
