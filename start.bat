@echo off
title Blender to FiveM - Prop Converter
color 0A

echo.
echo  ========================================
echo   Blender to FiveM - Prop Converter
echo  ========================================
echo.

cd /d "%~dp0"

:: Verifica Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  [ERRORE] Node.js non trovato!
    echo  Scaricalo da: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Verifica node_modules
if not exist "node_modules\" (
    echo  [INFO] Prima esecuzione - installazione dipendenze...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo  [ERRORE] Installazione dipendenze fallita.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Dipendenze installate.
    echo.
)

echo  Avvio applicazione...
echo.
call npm run dev
