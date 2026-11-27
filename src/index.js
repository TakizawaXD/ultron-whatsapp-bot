// Bot de WhatsApp: responde SOLO a personas que no están en tus contactos. Incluye panel web.
const fs = require('fs');
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { responder, cargarDatos, RAIZ } = require('./flujo');
const { generarCatalogo } = require('./generar-catalogo');
const { rutaNavegador } = require('./navegador');
const { iniciarPanel } = require('./panel');
const E = require('./estado');
const ultron = require('./ultron');
const voz = require('./voz');

const DATA_AUTH = path.join(RAIZ, '.wwebjs_auth');

const CATALOGO_PNG = path.join(RAIZ, 'output', 'catalogo.png');
const CATALOGO_PDF = path.join(RAIZ, 'output', 'catalogo.pdf');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const enviandoBot = new Map(); // chatId -> timestamp hasta el que ignoramos nuestros propios mensajes

async function asegurarCatalogo() {
  const fuente = Math.max(
    fs.statSync(path.join(RAIZ, 'catalogo.json')).mtimeMs,
    fs.statSync(path.join(RAIZ, 'config.json')).mtimeMs
  );
  const actual = fs.existsSync(CATALOGO_PDF) && fs.statSync(CATALOGO_PDF).mtimeMs > fuente;
  if (!actual) {
    E.log('🛠️  Generando catálogo (catalogo.json cambió)...');
    await generarCatalogo();
  }
}

// ---------- Cliente ----------
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: DATA_AUTH }),
  authTimeoutMs: 180_000, // conexiones lentas: esperar hasta 3 min a que WhatsApp Web conecte
  puppeteer: { headless: true, executablePath: rutaNavegador(), args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

client.on('qr', async (qr) => {
  console.log('\n📱 Escanea este código (o ábrelo en el panel) con WhatsApp > Dispositivos vinculados:\n');
  qrcodeTerminal.generate(qr, { small: true });
  E.setVivo({ conexion: 'qr', qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }) });
});
// WhatsApp a veces emite "loading_screen" después de "ready": no debe borrar el estado "conectado"
client.on('loading_screen', (pct) => { if (E.vivo.conexion !== 'conectado') E.setVivo({ conexion: 'cargando', qr: null, progreso: pct }); });
client.on('authenticated', () => { E.setVivo({ conexion: 'autenticado', qr: null }); E.log('🔐 Sesión autenticada.'); });
client.on('auth_failure', (m) => { E.setVivo({ conexion: 'error' }); E.log('❌ Fallo de autenticación:', m); });
let reconectando = false;
client.on('disconnected', async (r) => {
  E.setVivo({ conexion: 'desconectado', cuenta: null });
  E.log('⚠️  Desconectado:', r, '— reiniciando en 10 s...');
  if (reconectando) return;
  reconectando = true;
  await client.destroy().catch(() => {}); // cerrar el navegador antes de volver a abrirlo
  setTimeout(() => { reconectando = false; iniciarWhatsApp(); }, 10_000);
});

// Tus propios IDs (número y "lid"), para reconocer el chat "Mensajes para mí mismo"
const misIds = new Set();
client.on('ready', async () => {
  misIds.clear();
  misIds.add(client.info.wid._serialized);
  try {
    const lid = await client.pupPage.evaluate(() => window.require('WAWebUserPrefsMeUser').getMaybeMeLidUser()?.toString());
    if (lid) misIds.add(lid);
  } catch { /* sin lid */ }
  E.setVivo({ conexion: 'conectado', qr: null, cuenta: { nombre: client.info.pushname, numero: client.info.wid.user } });
  E.log(`✅ Bot listo como ${client.info.pushname} (${client.info.wid.user}). Solo respondo en chats privados.`);
  if (cargarDatos().config.probarConmigo !== false) E.log('🧪 Modo prueba: escríbete a ti mismo ("Mensajes para mí mismo" / tu propio chat) y el bot te responderá ahí.');
  try { await asegurarCatalogo(); } catch (e) { E.log('⚠️  No se pudo generar el catálogo:', e); }
});

// Carga el modelo local al arrancar para que la primera respuesta no espere la carga
function precargarIALocal() {
  const iaLocal = require('./ia-local');
  if (cargarDatos().config.motor !== 'local' || !iaLocal.disponible()) return;
  const t = Date.now();
  E.log('🧠 Cargando la IA local en memoria...');
  iaLocal.cargar()
    .then(() => ultron.calentarLocal())
    .then(() => E.log(`🧠 IA local lista en ${Math.round((Date.now() - t) / 1000)} s`))
    .catch((e) => E.log('⚠️  No se pudo cargar la IA local:', e.message));
}

client.on('message_create', async (msg) => {
  // Cualquier mensaje (recibido o enviado) refresca "Todos mis chats" en el panel
  if (!msg.isStatus && msg.from !== 'status@broadcast') E.bus.emit('wa', msg.fromMe ? msg.to : msg.from);
  if (!msg.fromMe) return;
  const chatId = msg.to;
  if ((enviandoBot.get(chatId) || 0) > Date.now()) return; // lo envió el bot

  // ---- Modo prueba: te escribes a ti mismo y el bot responde como si fueras un cliente ----
  if (misIds.has(chatId)) {
    if (cargarDatos().config.probarConmigo === false) return;
    return atender(msg, { chatId, prueba: true });
  }

  // Si TÚ escribes a un cliente (desde el celular o el panel), el bot se calla en ese chat por unas horas.
  if (!E.sesiones[chatId]) return; // chat que el bot nunca atendió
  E.agregarHistorial(chatId, 'tu', msg.body || '[archivo]');
  const { pausaTrasRespuestaManualHoras } = cargarDatos().config;
  E.pausar(chatId, pausaTrasRespuestaManualHoras);
  E.log(`✋ Respondiste a ${E.sesiones[chatId].numero}: bot en pausa ${pausaTrasRespuestaManualHoras} h en ese chat.`);
});

client.on('message', async (msg) => {
  if (msg.fromMe) return;
  return atender(msg, { chatId: msg.from, prueba: false });
});

// WhatsApp a veces entrega el mismo mensaje más de una vez: se atiende solo una
const atendidos = new Set();
function yaAtendido(msg) {
  const id = msg.id?._serialized || msg.id?.id;
  if (!id) return false;
  if (atendidos.has(id)) return true;
  atendidos.add(id);
  if (atendidos.size > 2000) atendidos.delete(atendidos.values().next().value);
  return false;
}

/**
 * ¿Este contacto llevaba más de `diasInactividad` días sin hablar contigo?
 * Mira el mensaje anterior del chat (tuyo o suyo). Si el bot ya está atendiendo ese chat
 * por inactividad, sigue atendiéndolo mientras la conversación siga viva.
 * Si no se puede comprobar, devuelve false (por seguridad, no se responde a contactos).
 */
async function contactoInactivo(chatId, msg, chat, config) {
  const dias = Number(config.diasInactividad) || 0;
  if (dias <= 0) return false;
  const s = E.sesiones[chatId];
  const vivo = s?.porInactividad && s.ultimo && Date.now() - s.ultimo < config.reinicioConversacionMinutos * 60_000;
  if (vivo) return true;
  try {
    const recientes = await Promise.race([chat.fetchMessages({ limit: 6 }), esperar(15_000).then(() => null)]);
    if (!recientes) return false;
    const actual = msg.id?._serialized;
    const anteriores = recientes.filter((m) => m.id?._serialized !== actual && m.timestamp && m.timestamp <= msg.timestamp);
    // Sin mensajes anteriores = contacto guardado que nunca te había escrito: también lo atiende
    const ultimo = anteriores.length ? Math.max(...anteriores.map((m) => m.timestamp)) : 0;
    const diasSinHablar = ultimo ? (msg.timestamp - ultimo) / 86_400 : Infinity;
    if (diasSinHablar < dias) return false;
    E.log(`📇 Contacto ${ultimo ? `que llevaba ${Math.floor(diasSinHablar)} días sin hablar` : 'que nunca te había escrito'}: lo atiende el bot`);
    (E.sesiones[chatId] ||= { historial: [] }).porInactividad = true;
    return true;
  } catch {
    return false;
  }
}

/** Atiende un mensaje entrante (o tuyo a ti mismo en modo prueba) y responde si corresponde. */
async function atender(msg, { chatId, prueba }) {
  if (yaAtendido(msg)) return;
  try {
    if (msg.isStatus || chatId === 'status@broadcast' || chatId.endsWith('@newsletter')) return;
    if (['e2e_notification', 'notification_template', 'call_log', 'protocol', 'revoked'].includes(msg.type)) return;
    // Al reconectar, WhatsApp entrega mensajes viejos: no contestar nada de hace más de 10 minutos
    if (msg.timestamp && Date.now() / 1000 - msg.timestamp > 600) return;

    // ---- Solo chats privados: el bot NUNCA habla en grupos ----
    if (!/@(c\.us|lid)$/.test(chatId)) return;
    const { config } = cargarDatos();
    const chat = await msg.getChat();
    if (chat.isGroup) return;

    // ---- ¿Le responde el bot a esta persona? ----
    // "nunca"/"siempre" se eligen en el panel; sin elección: solo si NO es tu contacto
    let contacto, numero;
    if (prueba) {
      numero = client.info.wid.user;
    } else {
      const modo = E.control.modoChat[chatId] || 'auto';
      if (modo === 'nunca') return;
      contacto = await msg.getContact();
      numero = contacto.number || chatId.split('@')[0];
      if (modo === 'auto') {
        if ((config.numerosIgnorados || []).includes(numero)) return;
        // Contactos: solo si llevaban más de N días sin hablar contigo (o el bot ya los está atendiendo)
        if (contacto.isMyContact && !(await contactoInactivo(chatId, msg, chat, config))) return;
      }
    }

    const nuevo = !E.sesiones[chatId];
    E.agregarHistorial(chatId, 'cliente', msg.body || `[${msg.type}]`);
    const s = E.sesiones[chatId];
    s.nombre = prueba ? '🧪 Yo (prueba)' : contacto.pushname || s.nombre || null;
    s.numero = numero;
    if (!prueba) { E.contar('mensajes'); if (nuevo) E.contar('nuevos'); }

    if (!E.control.activo && !prueba) { s.ultimo = Date.now(); E.guardar(); return; } // las pruebas funcionan aunque el bot esté apagado
    if (s.pausadoHasta && s.pausadoHasta > Date.now()) { s.ultimo = Date.now(); E.guardar(); return; }

    s.seguimientos = 0; // el cliente respondió: se reinician los seguimientos
    const vencida = s.ultimo && Date.now() - s.ultimo > config.reinicioConversacionMinutos * 60_000;
    const pausaVencida = !!s.pausadoHasta;
    s.pausadoHasta = 0;
    const ctx = { chat, prueba, numero };

    // ---- Notas de voz, stickers y archivos sin texto ----
    // La IA no puede escucharlos: antes recibía "[ptt]" y respondía cualquier cosa
    const sinTexto = !(msg.body || '').trim();
    if (sinTexto && ['ptt', 'audio'].includes(msg.type)) {
      E.log(`🎤 ${s.nombre || numero} envió una nota de voz: se le pide escribir`);
      s.ultimo = Date.now(); E.guardar();
      await enviarSalida(chatId, [{ tipo: 'texto', texto: '🎤 Por ahora no puedo escuchar notas de voz. ¿Me lo escribes, por favor? Así te respondo enseguida.' }]);
      return;
    }
    if (sinTexto && ['sticker', 'reaction'].includes(msg.type)) { s.ultimo = Date.now(); E.guardar(); return; }

    // ---- Dos partes ----
    // Parte 1 (sin IA): el primer mensaje recibe una ficha con lo importante, y las preguntas
    //   frecuentes (precio de un servicio, pagos, horario, catálogo, asesor, demo…) tienen respuesta fija.
    // Parte 2 (IA): solo las preguntas libres que no tienen respuesta fija. Así se ahorran tokens.
    // Sin IA configurada, lo que no tiene respuesta fija lo atiende el menú clásico.
    const texto = (msg.body || '').trim() || (['image', 'video', 'document'].includes(msg.type) ? `(El cliente envió ${{ image: 'una imagen', video: 'un video', document: 'un documento' }[msg.type]} sin texto)` : '');
    if (prueba && /^\/?reiniciar$/i.test(texto)) {
      s.ia = []; s.estado = null; E.guardar();
      enviandoBot.set(chatId, Date.now() + 10_000);
      await client.sendMessage(chatId, '🧪 Conversación reiniciada. Escribe como si fueras un cliente nuevo.');
      return;
    }
    const conversacionNueva = nuevo || !s.estado || vencida || pausaVencida;
    const pideMenu = /^(\d{1,2}[.)]?|men[uú]|inicio|opciones|0)$/i.test(texto);
    if (conversacionNueva && !pideMenu) return encolarIA(chatId, texto || `[${msg.type}]`, { ...ctx, inicio: true });
    // Números (en el menú), "menú" y la cotización/demo en curso → menú instantáneo
    if (esParaMenu(texto, s, conversacionNueva)) {
      return responderConMenu(chatId, texto, conversacionNueva ? undefined : s, ctx);
    }
    return encolarIA(chatId, texto || `[${msg.type}]`, ctx);
  } catch (e) {
    E.log('❌ Error atendiendo mensaje:', e);
  }
}

// Muestra "grabando audio…" un momento antes de enviar una nota de voz
async function chatGrabando(chatId) {
  try { const chat = await client.getChatById(chatId); await chat.sendStateRecording(); await esperar(1500); } catch { /* opcional */ }
}

// Envía una lista de respuestas ({tipo:'texto'|'catalogo'|'audio'}) al chat, registrándolas en el historial
async function enviarSalida(chatId, salida) {
  const { config } = cargarDatos();
  enviandoBot.set(chatId, Date.now() + 120_000);
  try {
    for (const resp of salida) {
      if (resp.tipo === 'texto') {
        await client.sendMessage(chatId, resp.texto);
        E.agregarHistorial(chatId, 'bot', resp.texto);
      } else if (resp.tipo === 'audio') {
        await chatGrabando(chatId);
        await client.sendMessage(chatId, MessageMedia.fromFilePath(resp.ruta), { sendAudioAsVoice: true });
        E.agregarHistorial(chatId, 'bot', `🎤 [Nota de voz] ${resp.texto}`);
      } else if (resp.tipo === 'catalogo') {
        await asegurarCatalogo();
        await client.sendMessage(chatId, MessageMedia.fromFilePath(CATALOGO_PNG), { caption: `Catálogo · ${config.negocio}` });
        await client.sendMessage(chatId, MessageMedia.fromFilePath(CATALOGO_PDF), { sendMediaAsDocument: true });
        E.agregarHistorial(chatId, 'bot', '📎 [Catálogo enviado: imagen + PDF]');
      }
      await esperar(300);
    }
  } finally {
    enviandoBot.set(chatId, Date.now() + 3000);
  }
}

// ---------- Notas de voz ----------
// Ultron agrega una nota de voz a sus respuestas en los chats marcados "Sí, responder siempre"
// (y en tu chat de prueba, para que la escuches). Si el audio falla, se envía solo el texto.
async function conVoz(chatId, salida, { prueba }) {
  const { config } = cargarDatos();
  const a = config.audios || {};
  if (a.activo === false) return salida;
  const aplica = prueba ? a.enPruebas !== false : E.control.modoChat[chatId] === 'siempre';
  const textos = salida.filter((x) => x.tipo === 'texto').map((x) => x.texto);
  if (!aplica || !textos.length) return salida;
  try {
    const ruta = await voz.generarNotaDeVoz(textos.join('\n\n'), { voz: a.voz || 'Raul', velocidad: a.velocidad || 1.05 });
    const nota = { tipo: 'audio', ruta, texto: textos.join('\n\n') };
    // "solo_audio": la voz reemplaza el texto (el catálogo se envía igual)
    return a.modo === 'solo_audio' ? [nota, ...salida.filter((x) => x.tipo !== 'texto')] : [nota, ...salida];
  } catch (e) {
    E.log(`⚠️  No se pudo generar la nota de voz (${e.message}); se envía solo texto.`);
    return salida;
  }
}

// Avisa al dueño (o, en modo prueba, explica qué pasaría) cuando el cliente pasa a un asesor humano
async function pasarAAsesor(chatId, { motivo, resumen }, { prueba, numero }) {
  const { config } = cargarDatos();
  const s = E.sesiones[chatId];
  const textos = {
    cotizacion: 'pidió una cotización', quiere_comprar: 'QUIERE COMPRAR', quiere_contratar: '🔥 QUIERE CONTRATAR',
    descuento_solicitado: 'pide un descuento para cerrar (Ultron le dijo que lo confirmas tú; máx. autorizado en Configuración)',
    pide_humano: 'quiere hablar con un asesor', pregunta_fuera_de_limites: 'tiene una pregunta para un asesor',
  };
  const ficha = Object.entries(s?.ficha || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
  if (ficha) resumen = `${resumen || ''}\n📋 ${ficha}`.trim();
  const motivoTxt = textos[motivo] || 'necesita un asesor';
  if (prueba) {
    enviandoBot.set(chatId, Date.now() + 10_000);
    await client.sendMessage(chatId, `🧪 *Prueba:* con un cliente real aquí se pausaría el bot y te llegaría este aviso:\n🔔 El cliente ${motivoTxt}.${resumen ? `\n📝 ${resumen}` : ''}`);
    E.log(`🧪 Prueba: el cliente ${motivoTxt}`);
    return;
  }
  s.estado = motivo === 'pide_humano' ? 'humano' : 'cotizacion_enviada';
  E.pausar(chatId, config.pausaTrasRespuestaManualHoras);
  E.contar(motivo === 'pide_humano' ? 'humano' : motivo === 'quiere_contratar' ? 'contratar' : 'cotizaciones');
  enviandoBot.set(client.info.wid._serialized, Date.now() + 10_000);
  await client.sendMessage(client.info.wid._serialized,
    `🔔 *${s.nombre || 'Cliente'}* (+${numero}) ${motivoTxt}.${resumen ? `\n📝 ${resumen}` : ''}\nAbre el chat para continuar; Ultron queda en pausa ahí.`);
  E.log(`🔔 ${s.nombre || numero} ${motivoTxt}`);
}

// ¿Este mensaje lo responde el menú (instantáneo) en vez de la IA?
function esParaMenu(texto, s, conversacionNueva) {
  const t = String(texto || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Un número es una opción del menú, salvo en plena conversación con Ultron:
  // ahí "50" o "2" suele ser la respuesta a su pregunta (productos, presupuesto, sedes...)
  if (/^\d{1,2}[.)]?$/.test(t)) return s?.estado !== 'ultron' || conversacionNueva;
  if (['menu', 'inicio', '0', 'opciones'].includes(t)) return true;
  if (['cotizacion', 'demo'].includes(s?.estado)) return true;      // está llenando la cotización o la demo
  const saludo = /^(hola+|holi|buenas?|buen(os)? dias?|buenas (tardes|noches)|hey|hi|ola|saludos|que tal)( [a-z]+)?[!.¡ ]*$/.test(t);
  return saludo && (conversacionNueva || !s?.estado || s.estado === 'menu');
}

const RESUMEN_MENU = {
  menu: 'Le mostré el menú de opciones.', precios: 'Le mostré la lista de precios de los servicios.',
  servicio: 'Le mostré el detalle de un servicio.', cotizacion: 'Le pedí los detalles para la cotización.',
  cotizacion_enviada: 'Recibí su solicitud de cotización y la pasé al asesor.', humano: 'Le avisé al asesor que quiere hablar con una persona.',
  demo: 'Le expliqué la demo gratis y le pedí los datos de su negocio.', demo_solicitada: 'Registré su solicitud de demo gratis.',
};

// ---------- Menú (instantáneo; también es el respaldo cuando no hay IA) ----------
async function responderConMenu(chatId, texto, sesionPrevia, { chat, prueba, numero }) {
  const s = E.sesiones[chatId];
  const r = responder(texto, sesionPrevia);
  E.log(`💬 ${s.nombre || numero} [${sesionPrevia?.estado || 'nuevo'}] "${(texto || '').slice(0, 40)}" → ${r.estado}`);
  await chat.sendStateTyping().catch(() => {});
  await esperar(400);
  await enviarSalida(chatId, r.respuestas);
  s.estado = r.estado;
  s.ultimo = Date.now();
  // Para que la IA sepa qué pasó si después el cliente escribe libremente
  s.ia = [...(s.ia || []), { role: 'user', content: texto || '' }, { role: 'assistant', content: `[${RESUMEN_MENU[r.estado] || 'Respondí con el menú.'}]` }].slice(-40);
  E.guardar();
  if (r.demo) {
    s.demo = { estado: 'solicitada', ...r.demo, solicitada: Date.now(), entregada: 0, vence: 0 };
    E.guardar();
    await avisarDemo(chatId, r.demo, { prueba, numero });
  }
  if (r.pausar) {
    await pasarAAsesor(chatId, { motivo: r.estado === 'humano' ? 'pide_humano' : 'cotizacion', resumen: `Último mensaje: "${texto}"` }, { prueba, numero });
    if (prueba) { s.estado = null; E.guardar(); }
  }
}

// ---------- Ultron (IA) ----------
// Se agrupan los mensajes que el cliente manda seguidos (3 s) para responder una sola vez.
const colasIA = new Map(); // chatId -> { textos, timer, ocupado, ctx }
function encolarIA(chatId, texto, ctx) {
  let c = colasIA.get(chatId);
  if (!c) { c = { textos: [], timer: null, ocupado: false, ctx }; colasIA.set(chatId, c); }
  c.textos.push(texto);
  c.ctx = ctx;
  clearTimeout(c.timer);
  c.timer = setTimeout(() => { if (!c.ocupado) procesarColaIA(chatId); }, 1500);
}
async function procesarColaIA(chatId) {
  const c = colasIA.get(chatId);
  if (!c || !c.textos.length) return;
  c.ocupado = true;
  // Si mandó varias veces el mismo texto seguido, cuenta como uno
  const texto = c.textos.splice(0).filter((t, i, a) => i === 0 || t.trim() !== a[i - 1].trim()).join('\n');
  try {
    await responderConUltron(chatId, texto, c.ctx);
  } finally {
    c.ocupado = false;
    if (c.textos.length) procesarColaIA(chatId); else colasIA.delete(chatId);
  }
}

async function responderConUltron(chatId, texto, ctx) {
  const s = E.sesiones[chatId];
  const { chat, prueba, numero } = ctx;
  await chat.sendStateTyping().catch(() => {});
  // WhatsApp borra el "escribiendo…" a los ~25 s; la IA local puede tardar más, así que se renueva
  const escribiendo = setInterval(() => chat.sendStateTyping().catch(() => {}), 15_000);
  let r;
  try {
    r = await ultron.conversar(s.ia || [], texto, { ...contextoCliente(s), inicio: !!ctx.inicio, conIA: ultron.disponible() });
  } catch (e) {
    clearInterval(escribiendo);
    if (e.codigo !== 'SIN_IA') E.log(`⚠️  Ultron no pudo responder a ${s.nombre || numero} (${e.message}). Respondo con el menú.`);
    // "No entendí… escribe 1 al 7" (no se repite la bienvenida completa)
    return responderConMenu(chatId, texto, s.estado && s.estado !== 'ultron' ? s : { estado: 'menu' }, ctx);
  }
  clearInterval(escribiendo);
  E.log(`${r.sinIA ? '⚡ Sin IA' : '🤖 Ultron'} → ${s.nombre || numero}: "${r.respuestaTexto.replace(/\s+/g, ' ').slice(0, 70)}"`);
  if (!prueba) E.contar(r.sinIA ? 'sinIA' : 'conIA'); // cuántas respuestas ahorraron IA
  await enviarSalida(chatId, await conVoz(chatId, r.salida, { prueba }));

  s.ia = [...(s.ia || []), { role: 'user', content: texto }, { role: 'assistant', content: r.respuestaTexto }].slice(-40);
  // Aceptó la demo: el siguiente mensaje (datos del negocio) lo recoge el flujo de la demo y avisa al equipo.
  // Sin IA, tras la ficha el chat queda en el menú para que los números funcionen.
  s.estado = r.pedirDatosDemo ? 'demo' : ultron.disponible() ? 'ultron' : 'menu';
  s.ultimo = Date.now();
  aplicarEfectos(chatId, r, { prueba, numero });
  E.guardar();
  if (r.demo) await avisarDemo(chatId, r.demo, { prueba, numero });
  if (r.asesor) await pasarAAsesor(chatId, r.asesor, { prueba, numero });
}

function contextoCliente(s) {
  return { ficha: s.ficha, demo: s.demo, seguimientoAutorizado: s.seguimientoAutorizado, nombreWhatsapp: s.nombre };
}

// Guarda lo que Ultron registró con sus herramientas: ficha, demo, permiso de seguimiento, "no contactar"
function aplicarEfectos(chatId, r, { numero }) {
  const s = E.sesiones[chatId];
  if (Object.keys(r.ficha || {}).length) s.ficha = { ...(s.ficha || {}), ...r.ficha };
  if (r.seguimientoAutorizado && !s.seguimientoAutorizado) {
    s.seguimientoAutorizado = true; s.seguimientos = 0;
    E.log(`👍 ${s.nombre || numero} autorizó seguimiento`);
  }
  if (r.noContactar) {
    s.noSeguir = true; s.seguimientoAutorizado = false;
    E.log(`🙅 ${s.nombre || numero} rechazó definitivamente: sin seguimientos.`);
  }
  if (r.demo) {
    s.demo = { estado: 'solicitada', ...r.demo, solicitada: Date.now(), entregada: 0, vence: 0 };
    if (!s.ficha?.negocio && r.demo.negocio) s.ficha = { ...(s.ficha || {}), negocio: r.demo.negocio };
  }
}

// Te avisa para que prepares la demo; el conteo de días empieza cuando la marcas "entregada" en el panel
async function avisarDemo(chatId, demo, { prueba, numero }) {
  const s = E.sesiones[chatId];
  const { config } = cargarDatos();
  const dias = config.ventas?.demoDias || 7;
  const aviso = `🎁 *Demo gratuita solicitada* por *${s.nombre || 'cliente'}* (+${numero})\n• Servicio: ${demo.servicio}\n• Negocio: ${demo.negocio}\n• Quiere ver: ${demo.detalles}\nPrepárala y envíasela por su chat. Luego márcala como *entregada* en el panel (pestaña Clientes y demos): ahí empiezan los ${dias} días.`;
  E.contar('demos');
  if (prueba) {
    enviandoBot.set(chatId, Date.now() + 10_000);
    await client.sendMessage(chatId, `🧪 *Prueba:* con un cliente real te llegaría este aviso:\n${aviso}`);
  } else {
    enviandoBot.set(client.info.wid._serialized, Date.now() + 10_000);
    await client.sendMessage(client.info.wid._serialized, aviso);
  }
  E.log(`🎁 Demo solicitada por ${s.nombre || numero}: ${demo.servicio}`);
}

// ---------- Mensajes proactivos de Ultron ----------
// 1) Seguimientos: SOLO a clientes que autorizaron que se les escriba (a las 24 h y 72 h, configurable).
// 2) Demos: al vencer los días de la demo, se marca vencida y Ultron escribe para cerrar la venta.
// Siempre en horario diurno, nunca en grupos, pruebas, chats pausados o a quien rechazó.
async function revisarProactivos() {
  if (E.vivo.conexion !== 'conectado' || !E.control.activo) return;
  const { config } = cargarDatos();
  const iaOk = config.motor !== 'menu' && ultron.disponible();
  const horas = config.seguimientosHoras || [24, 72];
  const [desde, hasta] = config.horarioSeguimientos || [8, 20];
  const hora = new Date().getHours();
  const enHorario = hora >= desde && hora < hasta;

  for (const [chatId, s] of Object.entries(E.sesiones)) {
    if (misIds.has(chatId) || !/@(c\.us|lid)$/.test(chatId)) continue;

    // Demo vencida: se desactiva aunque no se pueda escribir ahora; el mensaje espera al horario
    if (s.demo?.estado === 'entregada' && s.demo.vence && Date.now() >= s.demo.vence) {
      s.demo.estado = 'vencida'; s.demo.avisoPendiente = true; E.guardar();
      E.log(`⌛ Venció la demo de ${s.nombre || s.numero}: desactívala si está publicada.`);
      enviandoBot.set(client.info.wid._serialized, Date.now() + 10_000);
      await client.sendMessage(client.info.wid._serialized,
        `⌛ Venció la demo gratuita de *${s.nombre || 'cliente'}* (+${s.numero}). Desactívala si está publicada.${iaOk && !s.noSeguir ? ' Ultron le escribirá para cerrar la venta.' : ''}`).catch(() => {});
    }

    if (!iaOk || !enHorario) continue;
    if (s.noSeguir || s.pausadoHasta > Date.now() || E.control.modoChat[chatId] === 'nunca') continue;

    try {
      if (s.demo?.avisoPendiente) {
        const texto = await ultron.mensajeProactivo(s.ia || [], contextoCliente(s), 'demo_vencida');
        await enviarSalida(chatId, await conVoz(chatId, [{ tipo: 'texto', texto }], { prueba: false }));
        s.ia = [...(s.ia || []), { role: 'assistant', content: texto }].slice(-40);
        s.demo.avisoPendiente = false; s.estado = 'ultron'; E.guardar();
        E.log(`💼 Ultron escribió a ${s.nombre || s.numero} para cerrar tras la demo`);
        await esperar(5000);
        continue;
      }

      if (!s.seguimientoAutorizado || s.estado !== 'ultron' || !s.ia?.length) continue;
      const ultimo = s.historial?.[s.historial.length - 1];
      if (!ultimo || ultimo.de !== 'bot') continue; // solo si el último mensaje fue de Ultron
      const n = s.seguimientos || 0;
      if (n >= horas.length || Date.now() - ultimo.t < horas[n] * 3600_000) continue;

      const texto = await ultron.mensajeProactivo(s.ia, contextoCliente(s), 'seguimiento', n + 1);
      await enviarSalida(chatId, await conVoz(chatId, [{ tipo: 'texto', texto }], { prueba: false }));
      s.ia = [...s.ia, { role: 'assistant', content: texto }].slice(-40);
      s.seguimientos = n + 1;
      E.guardar();
      E.log(`⏰ Seguimiento ${n + 1}/${horas.length} enviado a ${s.nombre || s.numero}`);
      await esperar(5000);
    } catch (e) {
      E.log(`⚠️  No se pudo escribir a ${s.nombre || s.numero}: ${e.message}`);
    }
  }
}
const revisarSeguimientos = revisarProactivos;
setInterval(() => revisarSeguimientos().catch((e) => E.log('⚠️  Seguimientos:', e.message)), 10 * 60_000);

// ---------- Lectura de chats para el panel ----------
const ETIQUETAS = {
  image: '📷 Imagen', video: '🎥 Video', audio: '🎵 Audio', ptt: '🎤 Nota de voz', document: '📄 Documento',
  sticker: '💟 Sticker', location: '📍 Ubicación', vcard: '👤 Contacto', multi_vcard: '👥 Contactos',
  revoked: '🚫 Mensaje eliminado', call_log: '📞 Llamada', poll_creation: '📊 Encuesta', gif: '🎞️ GIF',
};
function textoMensaje(m) {
  const etiqueta = ETIQUETAS[m.type];
  if (!etiqueta) return m.body || `[${m.type}]`;
  const conLeyenda = ['image', 'video', 'document', 'gif'].includes(m.type) && m.body && m.body.length < 1000;
  return conLeyenda ? `${etiqueta}: ${m.body}` : etiqueta;
}
function exigirConexion() {
  if (E.vivo.conexion !== 'conectado') {
    const e = new Error('WhatsApp aún no está conectado'); e.codigo = 409; throw e;
  }
}

let cacheChats = { t: 0, datos: null };
let listandoChats = null; // si ya hay una lectura en curso, reutilizarla en vez de lanzar otra
function listarChats() {
  exigirConexion();
  if (cacheChats.datos && Date.now() - cacheChats.t < 3000) return cacheChats.datos;
  listandoChats ||= leerChats().finally(() => { listandoChats = null; });
  return listandoChats;
}
async function leerChats() {
  // Lectura liviana directa de WhatsApp Web: client.getChats() serializa todo (miniaturas incluidas)
  // y con cuentas grandes se queda colgado. Aquí solo sacamos los campos que el panel muestra.
  const crudos = await client.pupPage.evaluate(() => {
    const idDe = (x) => x?._serialized || x?.toString?.() || '';
    return window.require('WAWebCollections').Chat.getModelsArray().map((c) => {
      const id = idDe(c.id);
      let ultimo = c.msgs?.last?.() || null;
      if (!ultimo && c.lastReceivedKey) {
        try { ultimo = window.require('WAWebCollections').Msg.get(idDe(c.lastReceivedKey)) || null; } catch { /* sin vista previa */ }
      }
      const esGrupo = id.endsWith('@g.us');
      return {
        id, esGrupo,
        nombre: c.formattedTitle || c.name || c.contact?.name || c.contact?.pushname || c.id?.user || id,
        numero: esGrupo ? null : (c.contact?.phoneNumber?.user || (id.endsWith('@c.us') ? c.id.user : null)),
        noLeidos: Math.max(c.unreadCount || 0, 0),
        fijado: !!c.pin,
        archivado: !!c.archive,
        silenciado: !!(c.mute && c.mute.expiration !== 0),
        t: c.t || 0,
        ultimo: ultimo ? { type: ultimo.type, body: (ultimo.type === 'chat' ? ultimo.body : (ultimo.caption || '')).slice(0, 200), fromMe: !!ultimo.id?.fromMe } : null,
      };
    });
  });
  const datos = crudos
    .filter((c) => c.id && c.id !== 'status@broadcast' && !c.id.endsWith('@newsletter'))
    .sort((a, b) => (b.fijado - a.fijado) || (b.t - a.t))
    .slice(0, 300)
    .map((c) => ({
      id: c.id, nombre: c.nombre, numero: c.numero, esGrupo: c.esGrupo,
      noLeidos: c.noLeidos, fijado: c.fijado, archivado: c.archivado, silenciado: c.silenciado,
      ultimo: c.t * 1000,
      ultimoTexto: c.ultimo ? textoMensaje(c.ultimo) : '',
      ultimoDeMi: !!c.ultimo?.fromMe,
      bot: !!E.sesiones[c.id],
    }));
  cacheChats = { t: Date.now(), datos };
  return datos;
}

// Mensajes de un chat, también con lectura liviana (sin miniaturas ni archivos)
async function mensajesDeChat(chatId, limite) {
  exigirConexion();
  const leer = () => client.pupPage.evaluate((id, limite) => {
    const idDe = (x) => x?._serialized || x?.toString?.() || '';
    const chat = window.require('WAWebCollections').Chat.getModelsArray().find((c) => idDe(c.id) === id);
    if (!chat) return null;
    const esGrupo = id.endsWith('@g.us');
    return {
      nombre: chat.formattedTitle || chat.name || chat.contact?.name || chat.contact?.pushname || chat.id?.user || id,
      numero: esGrupo ? null : (chat.contact?.phoneNumber?.user || (id.endsWith('@c.us') ? chat.id.user : null)),
      esGrupo,
      mensajes: (chat.msgs?.getModelsArray?.() || []).slice(-limite).map((m) => ({
        id: idDe(m.id), type: m.type, fromMe: !!m.id?.fromMe, t: m.t || 0,
        body: (m.type === 'chat' ? m.body : (m.caption || '')) || '',
        autor: esGrupo && !m.id?.fromMe ? (m.senderObj?.pushname || m.notifyName || idDe(m.author).split('@')[0]) : null,
      })),
    };
  }, chatId, limite);

  let d = await leer();
  if (!d) throw new Error('Chat no encontrado');
  // Si WhatsApp aún no cargó mensajes de este chat, pedírselos a la librería (con límite de tiempo)
  if (d.mensajes.length < Math.min(limite, 15)) {
    try {
      const chat = await client.getChatById(chatId);
      await Promise.race([chat.fetchMessages({ limit: limite }), esperar(20_000)]);
      d = (await leer()) || d;
    } catch { /* se muestran los que haya */ }
  }
  const historialBot = new Set((E.sesiones[chatId]?.historial || []).filter((h) => h.de === 'bot').map((h) => h.texto));
  return {
    id: chatId, nombre: d.nombre, numero: d.numero, esGrupo: d.esGrupo,
    mensajes: d.mensajes
      .filter((m) => !['e2e_notification', 'notification_template', 'protocol', 'gp2', 'notification', 'ciphertext'].includes(m.type))
      .map((m) => ({
        id: m.id, deMi: m.fromMe, autor: m.autor,
        texto: textoMensaje(m), t: m.t * 1000,
        bot: m.fromMe && historialBot.has(m.body),
      })),
  };
}

// ---------- Panel ----------
const { config } = cargarDatos();
iniciarPanel(config.puertoPanel || 3000, {
  listarChats,
  mensajes: mensajesDeChat,
  enviar: async (chatId, texto) => {
    if (E.vivo.conexion !== 'conectado') throw new Error('WhatsApp no está conectado');
    await client.sendMessage(chatId, texto); // message_create lo registra como "tú" y pausa el bot
    cacheChats.t = 0;
  },
  cerrarSesion: async () => {
    E.log('🚪 Cerrando sesión de WhatsApp desde el panel...');
    await client.logout();
  },
});

// Un error de la librería (p. ej. al cerrar sesión) no debe tumbar el bot ni el panel
process.on('unhandledRejection', (e) => E.log('⚠️  Error no controlado:', e?.message || String(e)));

// pm2 detiene con SIGINT; systemd o docker con SIGTERM. Se guarda todo antes de salir.
async function cerrar() { E.log('Cerrando...'); E.guardarYa(); await client.destroy().catch(() => {}); process.exit(0); }
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

async function iniciarWhatsApp(intento = 1) {
  E.log(`🚀 Iniciando WhatsApp${intento > 1 ? ` (intento ${intento})` : ''}... la primera vez tarda un poco.`);
  try {
    E.setVivo({ conexion: 'iniciando' });
    await client.initialize();
  } catch (e) {
    E.setVivo({ conexion: 'error' });
    const espera = Math.min(intento * 15, 120);
    E.log(`❌ No se pudo iniciar WhatsApp: ${e?.message || e}. Reintentando en ${espera} s...`);
    await client.destroy().catch(() => {});
    setTimeout(() => iniciarWhatsApp(intento + 1), espera * 1000);
  }
}
iniciarWhatsApp();
precargarIALocal(); // en paralelo: la IA queda lista mientras WhatsApp conecta
