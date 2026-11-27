// Estado compartido entre el bot y el panel web. Todo lo persistente vive en data/.
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { RAIZ } = require('./flujo');

const DATA = path.join(RAIZ, process.env.BOT_DATA || 'data');
const F_SESIONES = path.join(DATA, 'sesiones.json');
const F_CONTROL = path.join(DATA, 'control.json');
const MAX_HISTORIAL = 40;
const MAX_LOGS = 300;

const bus = new EventEmitter();
bus.setMaxListeners(50);

// Lee un JSON; si el archivo está dañado usa la copia anterior (.bak) en vez de empezar vacío
const leer = (f, def) => {
  for (const ruta of [f, `${f}.bak`]) {
    try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') console.error(`⚠️  No se pudo leer ${path.basename(ruta)}: ${e.message}`);
    }
  }
  return def;
};
// Escritura segura: archivo temporal + renombrar, y se conserva la versión anterior como .bak.
// Si el proceso muere a mitad de escritura, el archivo bueno sigue ahí.
function escribirSeguro(f, datos) {
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
  if (fs.existsSync(f)) fs.copyFileSync(f, `${f}.bak`);
  fs.renameSync(tmp, f);
}
const hoy = () => new Date().toISOString().slice(0, 10);

// { [chatId]: { estado, ultimo, pausadoHasta, nombre, numero, historial: [{de, texto, t}] } }
const sesiones = leer(F_SESIONES, {});
// En una instalación nueva el bot arranca APAGADO: lo enciendes en el panel cuando ya esté configurado
const control = leer(F_CONTROL, { activo: false, stats: {} });
control.stats ||= {};
// Respuesta automática por persona: { [chatId]: 'siempre' | 'nunca' } (sin entrada = automática)
control.modoChat ||= {};

const vivo = { conexion: 'iniciando', qr: null, cuenta: null, logs: [] };

let tGuardar;
function guardarYa() {
  clearTimeout(tGuardar);
  try {
    fs.mkdirSync(DATA, { recursive: true });
    escribirSeguro(F_SESIONES, sesiones);
    escribirSeguro(F_CONTROL, control);
  } catch (e) {
    console.error('❌ No se pudieron guardar los datos:', e.message);
  }
}
function guardar() {
  clearTimeout(tGuardar);
  tGuardar = setTimeout(guardarYa, 300);
  bus.emit('cambio');
}

function log(...partes) {
  const texto = partes.map((p) => (p instanceof Error ? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  console.log(new Date().toLocaleTimeString(), texto);
  vivo.logs.push({ t: Date.now(), texto });
  if (vivo.logs.length > MAX_LOGS) vivo.logs.shift();
  bus.emit('cambio');
}

function contar(campo) {
  const d = (control.stats[hoy()] ||= { mensajes: 0, nuevos: 0, cotizaciones: 0, humano: 0 });
  d[campo] = (d[campo] || 0) + 1;
  // conservar solo 30 días
  const dias = Object.keys(control.stats).sort();
  while (dias.length > 30) delete control.stats[dias.shift()];
  guardar();
}

function agregarHistorial(chatId, de, texto) {
  const s = (sesiones[chatId] ||= { estado: null, ultimo: 0, pausadoHasta: 0, historial: [] });
  s.historial ||= [];
  s.historial.push({ de, texto: String(texto || '').slice(0, 2000), t: Date.now() });
  if (s.historial.length > MAX_HISTORIAL) s.historial.splice(0, s.historial.length - MAX_HISTORIAL);
  guardar();
}

function pausar(chatId, horas) {
  const s = (sesiones[chatId] ||= { historial: [] });
  s.pausadoHasta = Date.now() + horas * 3600_000;
  guardar();
}

function setVivo(cambios) { Object.assign(vivo, cambios); bus.emit('cambio'); }

function snapshot() {
  const ahora = Date.now();
  const chats = Object.entries(sesiones)
    .map(([id, s]) => ({
      id, nombre: s.nombre || null, numero: s.numero || id.split('@')[0], estado: s.estado,
      ultimo: s.ultimo || 0, pausadoHasta: s.pausadoHasta > ahora ? s.pausadoHasta : 0,
      ficha: s.ficha || null, demo: s.demo || null, seguimientoAutorizado: !!s.seguimientoAutorizado,
      noSeguir: !!s.noSeguir, seguimientos: s.seguimientos || 0,
      historial: s.historial || [],
    }))
    .sort((a, b) => b.ultimo - a.ultimo);
  return {
    conexion: vivo.conexion, qr: vivo.qr, cuenta: vivo.cuenta, activo: control.activo, modos: control.modoChat,
    stats: { hoy: control.stats[hoy()] || {}, dias: control.stats },
    chats, logs: vivo.logs.slice(-150),
  };
}

module.exports = { bus, sesiones, control, vivo, guardar, guardarYa, log, contar, agregarHistorial, pausar, setVivo, snapshot };
