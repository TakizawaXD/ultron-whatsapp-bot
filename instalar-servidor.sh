#!/usr/bin/env bash
# Instala ULTRON (bot de WhatsApp de TAKER) en un servidor Ubuntu 22.04/24.04,
# pensado para Oracle Cloud "Always Free" (ARM, VM.Standard.A1.Flex).
# Uso, dentro de la carpeta del proyecto ya clonado:  bash instalar-servidor.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
MODELO="qwen2.5-3b-instruct-q4_k_m.gguf"
URL_MODELO="https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/$MODELO"
verde() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }

verde "1/6 Zona horaria (Bogotá) y paquetes del sistema"
sudo timedatectl set-timezone America/Bogota || true
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates fonts-noto-color-emoji fonts-liberation

verde "2/6 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

verde "3/6 Chromium (para WhatsApp Web y el catálogo) y pm2"
command -v chromium >/dev/null || [ -x /snap/bin/chromium ] || sudo snap install chromium
command -v pm2 >/dev/null || sudo npm install -g pm2

verde "4/6 Dependencias del bot"
cd "$DIR"
PUPPETEER_SKIP_DOWNLOAD=true npm install
npm test

verde "5/6 IA local gratuita: $MODELO (2,1 GB desde Hugging Face)"
mkdir -p modelos
if [ "$(stat -c %s "modelos/$MODELO" 2>/dev/null || echo 0)" -lt 2000000000 ]; then
  curl -L --fail --retry 5 -C - -o "modelos/$MODELO" "$URL_MODELO"
else
  echo "El modelo ya estaba descargado."
fi

verde "6/6 Arrancar ULTRON con pm2 (se reinicia solo si se cae o si el servidor se reinicia)"
pm2 delete ultron >/dev/null 2>&1 || true
pm2 start src/index.js --name ultron
pm2 save
sudo env PATH="$PATH:/usr/bin" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" >/dev/null
pm2 status

IP="$(curl -s -m 5 ifconfig.me || echo IP_DEL_SERVIDOR)"
cat <<EOF

✅ ULTRON está corriendo en el servidor.

Abre el panel DESDE TU PC (deja esa ventana abierta):
  ssh -i G:\\claves\\oracle.key -L 3000:localhost:3000 $USER@$IP
y entra a http://localhost:3000 para escanear el QR.

IMPORTANTE: apaga el bot de tu PC antes de escanear, o los clientes recibirán respuestas dobles.

Comandos útiles en el servidor:
  pm2 logs ultron      ver el registro en vivo (Ctrl+C para salir)
  pm2 restart ultron   reiniciar el bot
  cd $DIR && git pull && PUPPETEER_SKIP_DOWNLOAD=true npm install && pm2 restart ultron   actualizar
EOF
