// Notas de voz de Ultron: texto → voz de Windows (WAV) → nota de voz de WhatsApp (OGG/Opus).
// Gratis y sin internet: usa las voces instaladas en Windows y ffmpeg (paquete ffmpeg-static).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { RAIZ } = require('./flujo');

const CARPETA = path.join(RAIZ, 'data', 'audios');
const SCRIPT = path.join(__dirname, 'tts.ps1');

const correr = (cmd, args, ms = 120_000) => new Promise((ok, mal) => {
  execFile(cmd, args, { timeout: ms, windowsHide: true }, (e, stdout, stderr) => (e ? mal(new Error(stderr || e.message)) : ok(stdout)));
});

// "$1.200.000 COP" -> "1 millón 200 mil pesos" (las voces leen mal los puntos de miles)
function plataEnPalabras(n) {
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'un millón' : `${millones} millones`);
  if (miles) partes.push(`${miles} mil`);
  if (resto) partes.push(String(resto));
  return (partes.join(' ') || '0') + (millones && !miles && !resto ? ' de pesos' : ' pesos');
}

/** Adapta el texto de WhatsApp para que suene natural al leerlo en voz alta. */
function textoParaVoz(texto) {
  return String(texto)
    .replace(/https?:\/\/\S+/g, 'el enlace que te dejo por escrito')
    .replace(/\S+@\S+\.\S+/g, 'el correo que te dejo por escrito')
    .replace(/\$[ \t]?(\d{1,3}(?:\.\d{3})*)(?:[ \t]*(?:COP|pesos))?/gi, (_, num) => plataEnPalabras(Number(num.replace(/\./g, ''))))
    .replace(/[*_~`]/g, '')
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, '')
    .replace(/^\s*[•\-·]\s*/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Genera una nota de voz y devuelve la ruta del .ogg.
 * @param {string} texto  lo que dirá Ultron
 * @param {{voz?: string, velocidad?: number}} opciones
 */
async function generarNotaDeVoz(texto, { voz = 'Raul', velocidad = 1.05 } = {}) {
  const hablado = textoParaVoz(texto);
  if (!hablado) throw new Error('No hay texto para convertir en audio');
  fs.mkdirSync(CARPETA, { recursive: true });
  limpiarViejos();
  const base = path.join(CARPETA, `nota-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.writeFileSync(`${base}.txt`, hablado, 'utf8');
  try {
    await correr('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
      '-Entrada', `${base}.txt`, '-Salida', `${base}.wav`, '-Voz', voz, '-Velocidad', String(velocidad)]);
    await correr(ffmpeg, ['-y', '-loglevel', 'error', '-i', `${base}.wav`, '-vn', '-c:a', 'libopus', '-b:a', '32k',
      '-ac', '1', '-ar', '48000', '-application', 'voip', `${base}.ogg`]);
    return `${base}.ogg`;
  } finally {
    fs.rmSync(`${base}.txt`, { force: true });
    fs.rmSync(`${base}.wav`, { force: true });
  }
}

// Borra audios de más de 1 día para no llenar el disco
function limpiarViejos() {
  try {
    for (const f of fs.readdirSync(CARPETA)) {
      const p = path.join(CARPETA, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 86_400_000) fs.rmSync(p, { force: true });
    }
  } catch { /* carpeta vacía */ }
}

module.exports = { generarNotaDeVoz, textoParaVoz };
