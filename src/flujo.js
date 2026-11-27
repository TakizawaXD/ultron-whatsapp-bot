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

const opcionesMenu = (config) => [
  `¿Por dónde empezamos? Responde con el *número*:`,
  ``,
  `1️⃣ Catálogo completo (imagen y PDF)`,
  `2️⃣ Servicios y precios`,
  `3️⃣ Cotizar mi proyecto`,
  `4️⃣ Formas de pago`,
  `5️⃣ Hablar con un asesor`,
  `6️⃣ ¿Sin presupuesto? Demo gratis de ${config.ventas?.demoDias || 7} días`,
  `7️⃣ Horario y contacto`,
  ``,
  `💬 También puedes contarme tu idea con tus palabras y te asesoro.`,
  `Escribe *menu* cuando quieras volver aquí.`,
];

// ---------- Parte 1: ficha inicial ----------
// El primer mensaje de cada conversación recibe SOLO lo importante, al instante y sin IA.
// Si pregunta por un servicio, la ficha es de ese servicio; si solo saluda, un resumen corto.
// Para saber más, el cliente conversa con Ultron (parte 2).

// Grupos del resumen corto (por id del catálogo; el precio "desde" se calcula del catálogo)
const GRUPOS_RESUMEN = [
  ['Páginas web y tiendas virtuales', ['web', 'tienda']],
  ['Sistemas para tu empresa (inventario, POS, CRM, citas…)', ['administrativo', 'inventario', 'pos', 'crm', 'reservas', 'medida', 'educativa', 'clasificados']],
  ['Chatbots, automatización e inteligencia artificial', ['whatsapp', 'chatbot-ia', 'automatizacion', 'ia']],
  ['Aplicaciones móviles', ['app']],
  ['APIs, bases de datos, dashboards y notificaciones', ['api', 'bd', 'dashboard', 'notificaciones']],
  ['Mantenimiento de software', ['soporte']],
];

const nombresPago = (config) => {
  const formas = Array.isArray(config.formasPago) ? config.formasPago.filter((f) => f?.nombre).map((f) => f.nombre.toLowerCase()) : [];
  if (!formas.length) return config.ventas?.pagos || '50% al iniciar y 50% al entregar';
  return formas.length > 1 ? `${formas.slice(0, -1).join(', ')} o ${formas[formas.length - 1]}` : formas[0];
};

/**
 * Ficha inicial (parte 1).
 * @param {object[]} servicios  servicios del catálogo que el cliente mencionó (puede ir vacío)
 * @param {{ conIA?: boolean }} o  si hay IA, invita a preguntar; si no, a usar el menú
 */
function fichaInicial(servicios = [], { conIA = true, saludo = true } = {}, datos = cargarDatos()) {
  const { config, catalogo } = datos;
  const nombre = config.asistente || 'Ultron';
  const marca = config.marca || config.negocio;
  const dias = config.ventas?.demoDias || 7;
  const cierre = conIA
    ? `👉 ¿Quieres saber más? Pregúntame lo que necesites (cómo funcionaría en tu negocio, tiempos, qué incluye…) y te asesoro aquí mismo. Si prefieres ver todas las opciones, escribe *menu*.`
    : `👉 Escribe *menu* para ver todas las opciones o *5* para hablar con un asesor.`;
  const pagosYDemo = [
    `💳 Puedes pagar ${nombresPago(config)}.`,
    `🎁 ¿Sin presupuesto todavía? Te armamos una *demo gratis de ${dias} días* antes de invertir.`,
  ];

  if (servicios.length) {
    const fichas = servicios.slice(0, 2).map((s) => [
      `🔹 *${s.nombre}*`,
      s.descripcion || null,
      `💵 Desde *${precio(s.precioDesde, config.moneda)}*${s.tiempo ? ` · ⏱️ ${s.tiempo}` : ''}`,
      s.incluye?.length ? `✅ ${s.incluye.join(' · ')}` : null,
    ].filter(Boolean).join('\n'));
    return [
      ...(saludo ? [`¡Hola! 👋 Soy *${nombre}*, de *${marca}*. Te cuento lo importante:`, ``] : []),
      fichas.join('\n\n'),
      ``,
      ...pagosYDemo,
      ``,
      cierre,
    ].join('\n');
  }

  const lineas = GRUPOS_RESUMEN.map(([titulo, ids]) => {
    const precios = catalogo.filter((s) => ids.includes(s.id)).map((s) => s.precioDesde);
    return precios.length ? `• ${titulo}: desde *${precio(Math.min(...precios), config.moneda)}*` : null;
  }).filter(Boolean);
  return [
    `¡Hola! 👋 Soy *${nombre}*, asesor virtual de *${marca}*. Creamos software para que tu negocio venda más y trabaje menos.`,
    ``,
    `💼 *Lo que hacemos*`,
    ...(lineas.length ? lineas : catalogo.slice(0, 6).map((s) => `• ${s.nombre}: desde *${precio(s.precioDesde, config.moneda)}*`)),
    ``,
    ...pagosYDemo,
    ``,
    cierre,
  ].join('\n');
}

/** Formas de pago (config.formasPago); si no existen, usa el texto corto de ventas.pagos. */
function textoPagos(config) {
  const formas = Array.isArray(config.formasPago) ? config.formasPago.filter((f) => f?.nombre) : [];
  const dias = config.ventas?.demoDias || 7;
  return [
    `💳 *Formas de pago*`,
    ``,
    ...(formas.length
      ? formas.map((f, i) => `${i + 1}. *${f.nombre}*${f.detalle ? `\n    ${f.detalle}` : ''}`)
      : [config.ventas?.pagos || '50% para iniciar y 50% al entregar.']),
    ``,
    `🎁 ¿Aún no tienes el presupuesto? Te preparamos una *demo gratis de ${dias} días* para que veas cómo quedaría tu proyecto (escribe *6*).`,
    ``,
    `Escribe *3* para cotizar o *menu* para volver.`,
  ].join('\n');
}

/** Menú; con `bienvenida` antepone el saludo completo (solo en el primer mensaje). */
function textoMenu(config, bienvenida = false) {
  const saludo = bienvenida && config.bienvenida ? [config.bienvenida, ``] : [`📋 *Menú ${config.marca || config.negocio}*`, ``];
  return [...saludo, ...opcionesMenu(config)].join('\n');
}

function textoPrecios({ config, catalogo }) {
  const linea = (s, i) => `*${i + 1}.* ${s.nombre} — desde *${precio(s.precioDesde, config.moneda)}*`;
  const principales = catalogo.map((s, i) => [s, i]).filter(([s]) => !s.adicional);
  const adicionales = catalogo.map((s, i) => [s, i]).filter(([s]) => s.adicional);
  return [
    `💼 *Servicios y precios*`,
    ``,
    ...principales.map(([s, i]) => linea(s, i)),
    ...(adicionales.length ? [``, `➕ *Servicios adicionales*`, ...adicionales.map(([s, i]) => linea(s, i))] : []),
    ``,
    `Precios de referencia: el valor final depende del alcance de tu proyecto.`,
    `👉 Escribe el *número* de un servicio (1 al ${catalogo.length}) para ver qué incluye, o *menu* para volver.`,
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
    `¿Te interesa? Escribe *3* para cotizar, *4* para ver las formas de pago o *menu* para volver.`,
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
      return { respuestas: [{ tipo: 'texto', texto: textoPagos(config) }], estado: 'menu' };
    case '7':
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
        respuestas: [{ tipo: 'texto', texto: `No entendí tu respuesta 🤔. Escribe un número del *1 al 7* o *menu* para ver las opciones.` }],
        estado: estado || 'menu',
      };
  }
}

module.exports = { responder, cargarDatos, textoMenu, textoPagos, textoContacto, fichaInicial, precio, RAIZ };
