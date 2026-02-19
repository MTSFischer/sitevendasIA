FROM node:20-slim

# Instala ffmpeg para conversão de áudio
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia package.json primeiro para cache de layers
COPY package.json ./

# Instala dependências
RUN npm install --omit=dev

# Copia o código fonte
COPY src/ ./src/

# Cria diretórios necessários
RUN mkdir -p sessions data temp logs

# Porta do servidor HTTP
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "src/index.js"]
