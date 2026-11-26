// Lógica de conversación pura (sin WhatsApp) para poder probarla aislada.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const leerJSON = (f) => JSON.parse(fs.readFileSync(path.join(RAIZ, f), 'utf8'));

function cargarDatos() {
  return { config: leerJSON('config.json'), catalogo: leerJSON('catalogo.json') };
}

const fmtNumero = new Intl.NumberFormat('es-CO', { useGrouping: 'always', maximumFractionDigits: 0 });
const precio = (n, moneda) => `$${fmtNumero.format(n)} ${moneda}`;

const OPCIONES_MENU = [
  `Responde con el *número* de la opción:`,
  `1️⃣ Ver catálogo de servicios`,
  `2️⃣ Precios`,
  `3️⃣ Pedir una cotización`,
  `4️⃣ Horario y contacto`,
  `5️⃣ Hablar con un asesor`,
  `6️⃣ Demo gratis de 7 días`,
  ``,
  `💬 O escríbeme tu pregunta con tus palabras y te respondo.`,
  `Escribe *menu* en cualquier momento para volver aquí.`,
];

/** Menú; con `bienvenida` antepone el saludo completo (solo en el primer mensaje). */
function textoMenu(config, bienvenida = false) {
  const saludo = bienvenida && config.bienvenida ? [config.bienvenida, ``] : [`📋 *Menú ${config.marca || config.negocio}*`, ``];
  return [...saludo, ...OPCIONES_MENU].join('\n');
}

function textoPrecios({ config, catalogo }) {
  const linea = (s, i) => `${i + 1}. *${s.nombre}* — desde ${precio(s.precioDesde, config.moneda)}${s.tiempo ? ` (${s.tiempo})` : ''}`;
  const principales = catalogo.map((s, i) => [s, i]).filter(([s]) => !s.adicional);
  const adicionales = catalogo.map((s, i) => [s, i]).filter(([s]) => s.adicional);
  return [
    `💰 *Precios de referencia*`,
    ``,
    ...principales.map(([s, i]) => linea(s, i)),
    ...(adicionales.length ? [``, `➕ *Servicios adicionales*`, ...adicionales.map(([s, i]) => linea(s, i))] : []),
    ``,
    `Escribe el número de un servicio para ver el detalle, o *menu* para volver.`,
  ].join('\n');
}

function textoServicio(s, config) {
  return [
    `🔹 *${s.nombre}*`,
    s.descripcion || null,
    ``,
    `💵 Desde: *${precio(s.precioDesde, config.moneda)}*`,
    s.tiempo ? `⏱️ Tiempo estimado: ${s.tiempo}` : null,
    ...(s.incluye?.length ? [`✅ Incluye:`, ...s.incluye.map((x) => `   • ${x}`)] : []),
    ``,
    `¿Te interesa? Escribe *3* para pedir cotización o *menu* para volver.`,
  ].filter((l) => l !== null).join('\n');
}

function textoContacto(config) {
  const c = config.contacto || {};
  return [
    `🕘 *Horario:* ${config.horario}`,
    c.email ? `📧 ${c.email}` : null,
    c.web ? `🌐 ${c.web}` : null,
    c.github ? `💻 ${c.github}` : null,
    c.linkedin ? `🔗 ${c.linkedin}` : null,
    ``,
    `Escribe *menu* para volver.`,
  ].filter((l) => l !== null).join('\n');
}

const TEXTO_COTIZACION = [
  `📝 *Cotización*`,
  `Cuéntanos en *un solo mensaje*:`,
  `• Qué necesitas (web, app, sistema, bot...)`,
  `• Para qué negocio o proyecto`,
  `• Fecha deseada y presupuesto aproximado`,
  ``,
  `Lo revisamos y te respondemos personalmente lo antes posible.`,
].join('\n');

/**
 * Decide la respuesta a un mensaje.
 * @param {string} texto  mensaje recibido
 * @param {{estado:string}|undefined} sesion  estado previo del chat
 * @returns {{ respuestas: Array<{tipo:'texto'|'catalogo', texto?:string}>, estado:string, pausar?:boolean }}
 */
function responder(texto, sesion, datos = cargarDatos()) {
  const { config, catalogo } = datos;
  const t = (texto || '').trim().toLowerCase();
  const estado = sesion?.estado;

  // Primer mensaje o pide menú
  if (!estado) {
    return { respuestas: [{ tipo: 'texto', texto: textoMenu(config, true) }], estado: 'menu' };
  }
  if (['menu', 'menú', 'hola', 'inicio', '0'].includes(t)) {
    return { respuestas: [{ tipo: 'texto', texto: textoMenu(config) }], estado: 'menu' };
  }

  // Esperando el detalle de la cotización: cualquier texto se toma como la solicitud
  if (estado === 'cotizacion') {
    return {
      respuestas: [{
        tipo: 'texto',
        texto: `✅ ¡Recibido! Ya tenemos los detalles de tu proyecto. Un asesor de ${config.marca || 'nuestro equipo'} te contactará personalmente en horario de atención (${config.horario}).`,
      }],
      estado: 'cotizacion_enviada',
      pausar: true,
    };
  }

  // Esperando los datos del negocio para la demo
  if (estado === 'demo') {
    const dias = config.ventas?.demoDias || 7;
    return {
      respuestas: [{
        tipo: 'texto',
        texto: `🎁 ¡Listo! Ya le pasé tu solicitud al equipo. Te preparamos la demo y te la enviamos por este chat. Recuerda que es *gratis y dura ${dias} días* desde que la recibes; para seguir usándola contratas el servicio.\n\nMientras tanto, ¿tienes alguna pregunta? Escríbela o escribe *menu*.`,
      }],
      estado: 'demo_solicitada',
      demo: { servicio: 'por confirmar', negocio: texto, detalles: texto },
    };
  }

  // Dentro de la lista de precios, un número es un servicio
  if (estado === 'precios') {
    const n = parseInt(t, 10);
    if (n >= 1 && n <= catalogo.length) {
      return { respuestas: [{ tipo: 'texto', texto: textoServicio(catalogo[n - 1], config) }], estado: 'servicio' };
    }
  }

  switch (t) {
    case '1':
      return {
        respuestas: [
          { tipo: 'texto', texto: `📂 Aquí tienes el catálogo de servicios de ${config.marca || config.negocio}:` },
          { tipo: 'catalogo' },
          { tipo: 'texto', texto: textoPrecios(datos) },
        ],
        estado: 'precios',
      };
    case '2':
      return { respuestas: [{ tipo: 'texto', texto: textoPrecios(datos) }], estado: 'precios' };
    case '3':
      return { respuestas: [{ tipo: 'texto', texto: TEXTO_COTIZACION }], estado: 'cotizacion' };
    case '4':
      return { respuestas: [{ tipo: 'texto', texto: textoContacto(config) }], estado: 'menu' };
    case '5':
      return {
        respuestas: [{
          tipo: 'texto',
          texto: `🙋 ¡Perfecto! Ya le avisamos a ${config.dueno || 'nuestro equipo'}. Déjanos tu mensaje aquí y te responderemos personalmente lo antes posible (${config.horario}).`,
        }],
        estado: 'humano',
        pausar: true,
      };
    case '6': {
      const dias = config.ventas?.demoDias || 7;
      return {
        respuestas: [{
          tipo: 'texto',
          texto: [
            `🎁 *Demo gratis de ${dias} días*`,
            `Te preparamos una versión sencilla de tu proyecto para que veas cómo quedaría *antes de invertir*. Dura ${dias} días desde que la recibes y luego, si te gusta, contratas el servicio.`,
            ``,
            `Cuéntame en *un solo mensaje*:`,
            `• Nombre de tu negocio y a qué se dedica`,
            `• Qué quieres ver (página web, tienda, app, sistema, chatbot…)`,
            `• Ideas o colores que te gusten`,
          ].join('\n'),
        }],
        estado: 'demo',
      };
    }
    default:
      return {
        respuestas: [{ tipo: 'texto', texto: `No entendí tu respuesta 🤔. Escribe un número del *1 al 6* o *menu* para ver las opciones.` }],
        estado: estado || 'menu',
      };
  }
}

module.exports = { responder, cargarDatos, textoMenu, precio, RAIZ };
