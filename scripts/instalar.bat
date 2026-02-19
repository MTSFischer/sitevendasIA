@echo off
chcp 65001 >nul
title Instalando Bot WhatsApp IA...

echo ============================================
echo   BOT WHATSAPP IA - INSTALACAO
echo ============================================
echo.

:: Verifica se Node.js esta instalado
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado!
    echo.
    echo Por favor, instale o Node.js antes de continuar:
    echo   1. Acesse: https://nodejs.org
    echo   2. Baixe a versao LTS
    echo   3. Instale e reinicie este script
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo [OK] Node.js encontrado: %NODE_VER%

:: Verifica versao minima (18+)
for /f "tokens=1 delims=." %%a in ("%NODE_VER:v=%") do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
    echo [ERRO] Node.js versao %NODE_VER% muito antiga. Minimo: v18
    echo Atualize em: https://nodejs.org
    pause
    exit /b 1
)

echo.
echo [1/3] Instalando dependencias...
call npm install --ignore-scripts 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
)

echo.
echo [2/3] Compilando modulo SQLite...
call npm rebuild better-sqlite3 2>&1
if %errorlevel% neq 0 (
    echo [AVISO] Falha ao compilar SQLite. Tentando alternativa...
    call npm install better-sqlite3 --build-from-source 2>&1
)

echo.
echo [3/3] Configurando ambiente...
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo [OK] Arquivo .env criado a partir do exemplo.
        echo.
        echo IMPORTANTE: Edite o arquivo .env antes de iniciar o bot!
        echo   - Adicione sua chave da OpenAI ^(OPENAI_API_KEY^)
        echo   - Configure os numeros do WhatsApp
        echo   - Defina uma senha para o dashboard ^(ADMIN_API_KEY^)
        echo.
        echo Abra o arquivo .env com o Bloco de Notas para configurar.
        start notepad .env
    ) else (
        echo [AVISO] Arquivo .env.example nao encontrado. Crie o .env manualmente.
    )
) else (
    echo [OK] Arquivo .env ja existe.
)

echo.
echo ============================================
echo   INSTALACAO CONCLUIDA COM SUCESSO!
echo ============================================
echo.
echo Para iniciar o bot, execute: iniciar.bat
echo.
pause
