// Panel web local para ver y controlar el bot. Solo escucha en 127.0.0.1 (tu PC).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { RAIZ, responder, cargarDatos: cargarDatosPanel } = require('./flujo');
const ultron = require('./ultron');
const E = require('./estado');
const { generarCatalogo } = require('./generar-catalogo');

const PUBLICO = path.join(RAIZ, 'public');
const SALIDA = path.join(RAIZ, 'output');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function json(res, codigo, datos) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

function leerCuerpo(req) {
  return new Promise((ok, mal) => {
    let datos = '';
    req.on('data', (c) => { datos += c; if (datos.length > 1e6) { req.destroy(); mal(new Error('Cuerpo demasiado grande')); } });
    req.on('end', () => { try { ok(datos ? JSON.parse(datos) : {}); } catch { mal(new Error('JSON inválido')); } });
  });
}

function archivo(res, ruta) {
  if (!fs.existsSync(ruta)) return json(res, 404, { error: 'No existe' });
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(ruta).pipe(res);
}

function validarCatalogo(c) {
  if (!Array.isArray(c) || !c.length) throw new Error('El catálogo debe tener al menos un servicio');
  return c.map((s, i) => {
    if (!s.nombre?.trim()) throw new Error(`El servicio #${i + 1} no tiene nombre`);
    const precio = Number(s.precioDesde);
    if (!Number.isFinite(precio) || precio < 0) throw new Error(`Precio inválido en "${s.nombre}"`);
    return {
      id: s.id || s.nombre.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      nombre: s.nombre.trim(), descripcion: String(s.descripcion || '').trim(), precioDesde: precio,
      ...(s.adicional ? { adicional: true } : {}),
      tiempo: String(s.tiempo || '').trim(), incluye: (s.incluye || []).map(String).map((x) => x.trim()).filter(Boolean),
    };
  });
}

// Simula conversaciones con el mismo flujo que usa el bot, para ver exactamente qué responde.
function vistaPrevia() {
  const pasos = [
    ['Primer mensaje de alguien nuevo', ['Hola']],
    ['Opción 1 · Catálogo', ['Hola', '1']],
    ['Opción 2 · Precios', ['Hola', '2']],
    ['Detalle de un servicio', ['Hola', '2', '1']],
    ['Opción 3 · Cotización', ['Hola', '3']],
    ['Después de describir su proyecto', ['Hola', '3', 'Necesito una página web']],
    ['Opción 4 · Horario y contacto', ['Hola', '4']],
    ['Opción 5 · Hablar con un asesor', ['Hola', '5']],
    ['Escribe algo que no es una opción', ['Hola', 'precio?']],
  ];
  return pasos.map(([titulo, mensajes]) => {
    let sesion, r;
    for (const m of mensajes) { r = responder(m, sesion); sesion = { estado: r.estado }; }
    return {
      titulo, cliente: mensajes[mensajes.length - 1],
      respuestas: r.respuestas.map((x) => (x.tipo === 'texto' ? x.texto : '📎 [Se envía el catálogo: imagen + PDF]')),
      pausa: !!r.pausar,
    };
  });
}

/** @param {{ enviar(chatId, texto), cerrarSesion() }} acciones  funciones que dependen del cliente de WhatsApp */
function iniciarPanel(puerto, acciones) {
  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const ruta = url.pathname;

      // Protección CSRF: las acciones exigen un encabezado que otras webs no pueden mandar.
      if (req.method !== 'GET' && req.headers['x-panel'] !== '1') return json(res, 403, { error: 'Prohibido' });

      if (req.method === 'GET') {
        if (ruta === '/' || ruta === '/index.html') return archivo(res, path.join(PUBLICO, 'index.html'));
        if (ruta === '/catalogo.png' || ruta === '/catalogo.pdf') return archivo(res, path.join(SALIDA, ruta.slice(1)));
        if (ruta === '/logo.webp') return archivo(res, path.join(RAIZ, 'assets', 'logo.webp'));
        if (ruta === '/api/estado') return json(res, 200, E.snapshot());
        if (ruta === '/api/vista-previa') return json(res, 200, vistaPrevia());
        if (ruta === '/api/ultron/estado') return json(res, 200, { disponible: ultron.disponible(), ...ultron.estadoClaves() });
        if (ruta === '/api/catalogo') return json(res, 200, JSON.parse(fs.readFileSync(path.join(RAIZ, 'catalogo.json'), 'utf8')));
        if (ruta === '/api/config') return json(res, 200, JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8')));
        if (ruta === '/api/eventos') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write('retry: 2000\n\n');
          let t;
          let tWa;
          const avisar = () => { clearTimeout(t); t = setTimeout(() => res.write('data: cambio\n\n'), 150); };
          // "wa": hubo actividad en cualquier chat de WhatsApp (para refrescar "Todos mis chats")
          const avisarWa = (chatId) => { clearTimeout(tWa); tWa = setTimeout(() => res.write(`event: wa\ndata: ${JSON.stringify(chatId || '')}\n\n`), 400); };
          const latido = setInterval(() => res.write(': ping\n\n'), 25000);
          E.bus.on('cambio', avisar);
          E.bus.on('wa', avisarWa);
          req.on('close', () => { E.bus.off('cambio', avisar); E.bus.off('wa', avisarWa); clearInterval(latido); clearTimeout(t); clearTimeout(tWa); });
          return;
        }
        // ---- Chats reales de WhatsApp (requiere estar conectado) ----
        if (ruta === '/api/whatsapp/chats') return json(res, 200, await acciones.listarChats());
        const mMsgs = ruta.match(/^\/api\/whatsapp\/chats\/([^/]+)\/mensajes$/);
        if (mMsgs) {
          const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || 60, 10), 300);
          return json(res, 200, await acciones.mensajes(decodeURIComponent(mMsgs[1]), limite));
        }
        return json(res, 404, { error: 'No encontrado' });
      }

      const cuerpo = await leerCuerpo(req);

      if (ruta === '/api/control' && req.method === 'POST') {
        E.control.activo = !!cuerpo.activo;
        E.guardar();
        E.log(E.control.activo ? '▶️  Bot ACTIVADO desde el panel' : '⏸️  Bot APAGADO desde el panel');
        return json(res, 200, { ok: true });
      }

      // Respuesta automática por persona (cualquier chat privado, aunque el bot nunca lo haya atendido)
      const mModo = ruta.match(/^\/api\/chats\/([^/]+)\/modo$/);
      if (mModo && req.method === 'POST') {
        const chatId = decodeURIComponent(mModo[1]);
        if (!/@(c\.us|lid)$/.test(chatId)) return json(res, 400, { error: 'Solo se puede configurar en chats privados; el bot nunca responde en grupos' });
        const modo = cuerpo.modo;
        if (!['auto', 'siempre', 'nunca'].includes(modo)) return json(res, 400, { error: 'Modo inválido' });
        if (modo === 'auto') delete E.control.modoChat[chatId]; else E.control.modoChat[chatId] = modo;
        E.guardar();
        const quien = E.sesiones[chatId]?.nombre || chatId.split('@')[0];
        E.log({ auto: `🔁 ${quien}: respuesta automática solo si no es tu contacto`, siempre: `✅ ${quien}: el bot le responderá siempre`, nunca: `🚫 ${quien}: el bot no le responderá` }[modo]);
        return json(res, 200, { ok: true });
      }

      const mChat = ruta.match(/^\/api\/chats\/([^/]+)\/(pausar|reanudar|reiniciar|enviar)$/);
      if (mChat && req.method === 'POST') {
        const chatId = decodeURIComponent(mChat[1]);
        const s = E.sesiones[chatId];
        const accion = mChat[2];
        // Enviar funciona en cualquier chat de WhatsApp; el resto solo en chats que atiende el bot
        if (!s && accion !== 'enviar') return json(res, 404, { error: 'Chat no encontrado' });
        if (accion === 'pausar') {
          const horas = Math.min(Math.max(Number(cuerpo.horas) || 12, 0.1), 24 * 30);
          E.pausar(chatId, horas);
          E.log(`⏸️  Chat ${s.numero} pausado ${horas} h desde el panel`);
        } else if (accion === 'reanudar') {
          s.pausadoHasta = 0; s.estado = null; E.guardar();
          E.log(`▶️  Chat ${s.numero} reanudado: el bot volverá a responder`);
        } else if (accion === 'reiniciar') {
          delete E.sesiones[chatId]; E.guardar();
          E.log(`🗑️  Conversación con ${s.numero} borrada del panel`);
        } else if (accion === 'enviar') {
          const texto = String(cuerpo.texto || '').trim();
          if (!texto) return json(res, 400, { error: 'Mensaje vacío' });
          await acciones.enviar(chatId, texto);
        }
        return json(res, 200, { ok: true });
      }

      if (ruta === '/api/catalogo' && req.method === 'PUT') {
        const limpio = validarCatalogo(cuerpo);
        fs.writeFileSync(path.join(RAIZ, 'catalogo.json'), JSON.stringify(limpio, null, 2));
        await generarCatalogo();
        E.log(`📂 Catálogo guardado (${limpio.length} servicios) y regenerado`);
        return json(res, 200, { ok: true });
      }

      if (ruta === '/api/config' && req.method === 'PUT') {
        const actual = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
        const nuevo = { ...actual, ...cuerpo, contacto: { ...actual.contacto, ...(cuerpo.contacto || {}) } };
        nuevo.pausaTrasRespuestaManualHoras = Number(nuevo.pausaTrasRespuestaManualHoras) || 12;
        nuevo.reinicioConversacionMinutos = Number(nuevo.reinicioConversacionMinutos) || 120;
        nuevo.numerosIgnorados = (nuevo.numerosIgnorados || []).map((n) => String(n).replace(/\D/g, '')).filter(Boolean);
        nuevo.motor = ['menu', 'ia', 'huggingface', 'local'].includes(nuevo.motor) ? nuevo.motor : 'local';
        nuevo.modeloHF = /^[\w.-]+\/[\w.:-]+$/.test(String(nuevo.modeloHF || '')) ? nuevo.modeloHF : ultron.MODELO_HF;
        const vt = { ...(actual.ventas || {}), ...(cuerpo.ventas || {}) };
        nuevo.ventas = {
          pagos: String(vt.pagos || '50% de anticipo para iniciar y 50% al entregar.').trim(),
          descuentoMaximo: Math.min(Math.max(Number(vt.descuentoMaximo) || 0, 0), 50),
          demoDias: Math.min(Math.max(Math.round(Number(vt.demoDias) || 7), 1), 30),
        };
        nuevo.asistente = String(nuevo.asistente || 'Ultron').trim() || 'Ultron';
        nuevo.promocion = String(nuevo.promocion || '').trim();
        const horas = (Array.isArray(nuevo.seguimientosHoras) ? nuevo.seguimientosHoras : String(nuevo.seguimientosHoras || '').split(','))
          .map(Number).filter((h) => Number.isFinite(h) && h >= 1).slice(0, 2);
        nuevo.seguimientosHoras = horas;
        const a = { ...(actual.audios || {}), ...(cuerpo.audios || {}) };
        nuevo.audios = {
          activo: a.activo !== false && a.activo !== 'false',
          modo: a.modo === 'solo_audio' ? 'solo_audio' : 'audio_y_texto',
          voz: ['Raul', 'Sabina'].includes(a.voz) ? a.voz : 'Raul',
          velocidad: Math.min(Math.max(Number(a.velocidad) || 1.05, 0.7), 1.6),
          enPruebas: a.enPruebas !== false && a.enPruebas !== 'false',
        };
        fs.writeFileSync(path.join(RAIZ, 'config.json'), JSON.stringify(nuevo, null, 2));
        await generarCatalogo();
        E.log('⚙️  Configuración guardada');
        return json(res, 200, { ok: true });
      }

      // ---- Ultron (IA) ----
      if (ruta === '/api/ultron/clave' && req.method === 'POST') {
        const proveedor = cuerpo.proveedor === 'huggingface' ? 'huggingface' : 'claude';
        const nombre = proveedor === 'huggingface' ? 'Token de Hugging Face' : 'API key de Anthropic';
        const clave = String(cuerpo.clave || '').trim();
        if (!clave) { ultron.guardarClave(null, proveedor); E.log(`🔑 ${nombre} eliminado`); return json(res, 200, { ok: true }); }
        ultron.guardarClave(clave, proveedor);
        try {
          // la prueba usa el motor indicado, aunque no sea el activo
          if (proveedor === 'huggingface') {
            const r = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${clave}` } });
            if (!r.ok) throw Object.assign(new Error('token inválido'), { status: r.status });
          } else {
            await ultron.probarClave('claude');
          }
        } catch (e) {
          ultron.guardarClave(null, proveedor);
          return json(res, 400, { error: `${nombre} no funcionó: ${e.status === 401 ? 'clave inválida' : e.message}` });
        }
        E.log(`🔑 ${nombre} guardado y verificado`);
        return json(res, 200, { ok: true });
      }

      // ---- Demos: entregada (inicia el conteo), contrató, cancelar ----
      const mDemo = ruta.match(/^\/api\/chats\/([^/]+)\/demo$/);
      if (mDemo && req.method === 'POST') {
        const chatId = decodeURIComponent(mDemo[1]);
        const s = E.sesiones[chatId];
        if (!s?.demo) return json(res, 404, { error: 'Este chat no tiene demo' });
        const dias = cargarDatosPanel().config.ventas?.demoDias || 7;
        const quien = s.nombre || s.numero;
        if (cuerpo.accion === 'entregada') {
          Object.assign(s.demo, { estado: 'entregada', entregada: Date.now(), vence: Date.now() + dias * 86_400_000, avisoPendiente: false });
          E.log(`📦 Demo de ${quien} entregada: vence en ${dias} días`);
        } else if (cuerpo.accion === 'contrato') {
          Object.assign(s.demo, { estado: 'contrato', avisoPendiente: false });
          s.seguimientoAutorizado = false; // ya es cliente: no más seguimientos de venta
          E.contar('ventas');
          E.log(`🎉 ${quien} contrató`);
        } else if (cuerpo.accion === 'cancelar') {
          Object.assign(s.demo, { estado: 'cancelada', avisoPendiente: false });
          E.log(`✖️  Demo de ${quien} cancelada`);
        } else return json(res, 400, { error: 'Acción inválida' });
        E.guardar();
        return json(res, 200, { ok: true });
      }
      if (ruta === '/api/ultron/probar' && req.method === 'POST') {
        if (!ultron.disponible()) return json(res, 400, { error: 'Primero guarda la API key de Anthropic en Configuración' });
        const historial = Array.isArray(cuerpo.historial) ? cuerpo.historial.slice(-40) : [];
        const r = await ultron.conversar(historial, String(cuerpo.texto || ''), cuerpo.contexto || {});
        return json(res, 200, r);
      }

      if (ruta === '/api/catalogo/generar' && req.method === 'POST') {
        await generarCatalogo();
        E.log('🛠️  Catálogo regenerado desde el panel');
        return json(res, 200, { ok: true });
      }

      if (ruta === '/api/cerrar-sesion' && req.method === 'POST') {
        await acciones.cerrarSesion();
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: 'No encontrado' });
    } catch (e) {
      if (e.codigo !== 409) E.log('❌ Panel:', e);
      if (!res.headersSent) json(res, e.codigo || 400, { error: e.message });
    }
  });

  servidor.listen(puerto, '127.0.0.1', () => E.log(`🖥️  Panel listo en http://localhost:${puerto}`));
  servidor.on('error', (e) => E.log(`❌ No se pudo abrir el panel en el puerto ${puerto}:`, e));
  return servidor;
}

module.exports = { iniciarPanel };
