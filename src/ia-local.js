// IA local y gratuita: ejecuta un modelo abierto de Hugging Face (GGUF) en este equipo con node-llama-cpp.
// Sin cuentas, sin internet y sin límites. En CPU cada respuesta tarda decenas de segundos.
const fs = require('fs');
const path = require('path');
const { RAIZ } = require('./flujo');

const CARPETA = path.join(RAIZ, 'modelos');
const MODELO_LOCAL = 'qwen2.5-3b-instruct-q4_k_m.gguf';

let cargando = null;   // promesa de carga del modelo (se carga una sola vez)
let cola = Promise.resolve(); // un mensaje a la vez: el equipo no da para más

function rutaModelo(nombre) { return path.join(CARPETA, nombre || MODELO_LOCAL); }
function disponible(nombre) {
  try { return fs.statSync(rutaModelo(nombre)).size > 500_000_000; } catch { return false; }
}

async function cargar(nombre) {
  if (cargando) return cargando;
  cargando = (async () => {
    const { getLlama, LlamaChatSession, defineChatSessionFunction } = await import('node-llama-cpp');
    let llama;
    try { llama = await getLlama({ build: 'never' }); }            // usa la GPU si sirve
    catch { llama = await getLlama({ gpu: false, build: 'never' }); } // si no, solo CPU
    const model = await llama.loadModel({ modelPath: rutaModelo(nombre) });
    const context = await model.createContext({ contextSize: 4096 });
    const secuencia = context.getSequence();
    return { llama, model, context, secuencia, LlamaChatSession, defineChatSessionFunction };
  })();
  cargando.catch(() => { cargando = null; });
  return cargando;
}

/**
 * Genera una respuesta.
 * @param {object} o
 * @param {string} o.sistema  prompt de sistema (estable, para reutilizar lo ya procesado)
 * @param {Array<{role:'user'|'assistant', content:string}>} o.historial
 * @param {string} o.texto  mensaje del usuario (puede incluir contexto interno)
 * @param {Array<{name:string, description:string, input_schema:object, handler:(i:object)=>string}>} [o.herramientas]
 * @param {number} [o.maxTokens]
 */
function generar(o) {
  const tarea = cola.then(() => generarAhora(o));
  cola = tarea.catch(() => {});
  return tarea;
}

async function generarAhora({ sistema, historial = [], texto, herramientas = [], maxTokens = 180 }) {
  const m = await cargar();
  const sesion = new m.LlamaChatSession({ contextSequence: m.secuencia, autoDisposeSequence: false });
  try {
    sesion.setChatHistory([
      { type: 'system', text: sistema },
      ...historial.map((h) => (h.role === 'user' ? { type: 'user', text: h.content } : { type: 'model', response: [h.content] })),
    ]);
    const functions = herramientas.length ? Object.fromEntries(herramientas.map((h) => [h.name, m.defineChatSessionFunction({
      description: h.description,
      params: h.input_schema && Object.keys(h.input_schema.properties || {}).length ? paraGbnf(h.input_schema) : undefined,
      handler: (params) => h.handler(params || {}),
    })])) : undefined;
    const respuesta = await sesion.prompt(texto, { functions, maxTokens, temperature: 0.7, repeatPenalty: { penalty: 1.1 } });
    return String(respuesta || '').trim();
  } finally {
    sesion.dispose({ disposeSequence: false });
  }
}

// node-llama-cpp usa un subconjunto de JSON Schema: quitamos lo que no admite
function paraGbnf(schema) {
  const props = {};
  for (const [k, v] of Object.entries(schema.properties || {})) {
    props[k] = v.enum ? { enum: v.enum } : { type: v.type || 'string', ...(v.description ? { description: v.description } : {}) };
  }
  return { type: 'object', properties: props };
}

module.exports = { generar, disponible, cargar, MODELO_LOCAL, CARPETA };
