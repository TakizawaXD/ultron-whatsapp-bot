// Busca un Chrome o Edge instalado para no descargar Chromium.
const fs = require('fs');
const path = require('path');

const candidatos = [
  process.env.CHROME_PATH,
  path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function rutaNavegador() {
  const ruta = candidatos.find((p) => fs.existsSync(p));
  if (!ruta) throw new Error('No encontré Chrome ni Edge. Instala Chrome o define la variable CHROME_PATH.');
  return ruta;
}

module.exports = { rutaNavegador };
