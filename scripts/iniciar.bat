@echo off
chcp 65001 >nul
title Bot WhatsApp IA - Iniciando...

echo ============================================
echo   BOT WHATSAPP IA
echo ============================================
echo.

:: Verifica se foi instalado
if not exist node_modules (
    echo [ERRO] Dependencias nao instaladas.
    echo Execute primeiro: instalar.bat
    echo.
    pause
    exit /b 1
)

:: Verifica se .env existe
if not exist .env (
    echo [ERRO] Arquivo .env nao encontrado.
    echo Execute primeiro: instalar.bat
    echo.
    pause
    exit /b 1
)

:: Le a porta do .env (padrao: 3000)
set PORT=3000
for /f "tokens=2 delims==" %%a in ('findstr /i "^PORT=" .env 2^>nul') do set PORT=%%a

:: Le a chave admin do .env
set ADMIN_KEY=
for /f "tokens=2 delims==" %%a in ('findstr /i "^ADMIN_API_KEY=" .env 2^>nul') do set ADMIN_KEY=%%a

echo [OK] Iniciando servidor na porta %PORT%...
echo.
echo Dashboard disponivel em:
if defined ADMIN_KEY (
    echo   http://localhost:%PORT%/dashboard?key=%ADMIN_KEY%
) else (
    echo   http://localhost:%PORT%/dashboard
)
echo.
echo Para escanear o QR Code do WhatsApp, aguarde aparecer abaixo.
echo Para parar o bot, pressione Ctrl+C
echo.
echo ============================================
echo.

:: Abre o dashboard no navegador apos 5 segundos
if defined ADMIN_KEY (
    start "" /min cmd /c "timeout /t 5 >nul && start http://localhost:%PORT%/dashboard?key=%ADMIN_KEY%"
) else (
    start "" /min cmd /c "timeout /t 5 >nul && start http://localhost:%PORT%/dashboard"
)

:: Inicia o bot
node src/index.js

echo.
echo [INFO] Bot encerrado.
pause
