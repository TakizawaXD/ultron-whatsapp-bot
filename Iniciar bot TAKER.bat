@echo off
chcp 65001 >nul
title Bot de WhatsApp - TAKER
cd /d "%~dp0"

rem Archivos temporales en G: (el disco C: esta casi lleno)
if not exist "G:\Temp" mkdir "G:\Temp"
set "TEMP=G:\Temp"
set "TMP=G:\Temp"
set "PUPPETEER_SKIP_DOWNLOAD=true"

if not exist "node_modules" (
  echo Instalando dependencias por primera vez...
  call npm install || goto :error
)

echo Abriendo el panel en http://localhost:3000 ...
start "" /min cmd /c "timeout /t 6 >nul & start http://localhost:3000"

echo.
echo  Bot de WhatsApp - TAKER
echo  Panel: http://localhost:3000
echo  Deja esta ventana abierta. Para detener el bot, cierrala o presiona Ctrl+C.
echo.
node src\index.js
echo.
echo El bot se detuvo.
pause
exit /b

:error
echo No se pudieron instalar las dependencias.
pause
