#!/bin/bash
# =============================================================
# Script para gerar pacote distribuível para o cliente (Windows)
# Uso: bash scripts/build-dist.sh
# Resultado: dist/bot-whatsapp-ia.zip
# =============================================================

set -e

DIST_DIR="dist"
PACKAGE_NAME="bot-whatsapp-ia"
OUTPUT_DIR="$DIST_DIR/$PACKAGE_NAME"

echo "============================================"
echo "  BUILD - Bot WhatsApp IA (Distribuível)"
echo "============================================"
echo ""

# Limpa build anterior
echo "[1/5] Limpando build anterior..."
rm -rf "$DIST_DIR"
mkdir -p "$OUTPUT_DIR"

# Copia arquivos do projeto (sem node_modules, .git, data, logs)
echo "[2/5] Copiando arquivos do projeto..."
find . -maxdepth 1 -mindepth 1 \
  ! -name 'node_modules' \
  ! -name '.git' \
  ! -name 'dist' \
  ! -name 'data' \
  ! -name 'logs' \
  ! -name '.env' \
  ! -name '*.log' \
  -exec cp -r {} "$OUTPUT_DIR/" \;

# Remove arquivos de sessão do WhatsApp se copiados
rm -rf "$OUTPUT_DIR/auth_info_"* 2>/dev/null || true
rm -f "$OUTPUT_DIR"/*.session 2>/dev/null || true

# Copia os scripts .bat para a raiz do pacote
echo "[3/5] Copiando launchers Windows..."
cp scripts/instalar.bat "$OUTPUT_DIR/1_INSTALAR.bat"
cp scripts/iniciar.bat  "$OUTPUT_DIR/2_INICIAR.bat"
cp scripts/parar.bat    "$OUTPUT_DIR/3_PARAR.bat"

# Cria o README do cliente
cat > "$OUTPUT_DIR/LEIA-ME.txt" << 'EOF'
====================================================
  BOT WHATSAPP & INSTAGRAM COM IA
  Guia de Instalação e Uso
====================================================

PRÉ-REQUISITOS:
  - Windows 10 ou 11
  - Node.js v18 ou superior
    Download: https://nodejs.org (versão LTS)

INSTALAÇÃO (apenas uma vez):
  1. Instale o Node.js caso ainda não tenha
  2. Execute: 1_INSTALAR.bat
  3. Aguarde a instalação completar
  4. Configure o arquivo .env que será aberto automaticamente

CONFIGURAÇÃO DO .env:
  - OPENAI_API_KEY: Sua chave da OpenAI (obrigatório)
  - WHATSAPP_NUMBERS: Seu número no formato 5511999999999
  - ADMIN_API_KEY: Senha de acesso ao dashboard (escolha uma)
  - Demais configurações são opcionais

USO DIÁRIO:
  - Para INICIAR o bot: Execute 2_INICIAR.bat
  - Para PARAR o bot:   Execute 3_PARAR.bat (ou Ctrl+C na janela)

PRIMEIRO USO (WhatsApp):
  - Após iniciar, aguarde o QR Code aparecer na tela
  - Abra o WhatsApp no celular
  - Vá em Aparelhos Conectados > Conectar Aparelho
  - Escaneie o QR Code

DASHBOARD:
  - Acesse: http://localhost:3000/dashboard
  - O navegador abrirá automaticamente ao iniciar o bot

SUPORTE:
  - Em caso de problemas, entre em contato com o suporte.

====================================================
EOF

# Gera o .zip
echo "[4/5] Gerando arquivo .zip..."
cd "$DIST_DIR"
zip -r "${PACKAGE_NAME}.zip" "$PACKAGE_NAME/" > /dev/null
cd ..

# Limpa pasta temporária
rm -rf "$OUTPUT_DIR"

echo "[5/5] Pronto!"
echo ""
echo "============================================"
echo "  Pacote gerado: $DIST_DIR/${PACKAGE_NAME}.zip"
echo "============================================"
echo ""
echo "Envie o arquivo .zip para o cliente."
echo "Instruções de instalação estão no LEIA-ME.txt dentro do zip."
echo ""
