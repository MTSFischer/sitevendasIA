@echo off
chcp 65001 >nul
title Parando Bot...

echo Parando o Bot WhatsApp IA...
taskkill /f /im node.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Bot encerrado com sucesso.
) else (
    echo [INFO] Nenhum processo do bot encontrado.
)
echo.
pause
