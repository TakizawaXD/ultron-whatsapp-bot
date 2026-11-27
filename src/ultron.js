// ULTRON: asesor comercial de TAKER con IA.
// Dos motores a elegir en el panel: Hugging Face (modelos abiertos vía router.huggingface.co) o Claude.
// Vende con técnicas de cierre, ofrece la demo gratuita de 7 días, recoge los datos del proyecto
// y pasa al asesor humano. Nunca inventa precios, descuentos, garantías ni urgencias.
const fs = require('fs');
const path = require('path');
const AnthropicSDK = require('@anthropic-ai/sdk');
const { cargarDatos, precio, RAIZ } = require('./flujo');
const iaLocal = require('./ia-local');

const Anthropic = AnthropicSDK.default || AnthropicSDK;
const MODELO = 'claude-opus-5-5';
const MODELO_HF = 'deepseek-ai/DeepSeek-V4.1-Flash-1017';
const URL_HF = 'https://router.huggingface.co/v1/chat/completions';
const F_SECRETOS = path.join(RAIZ, 'data', 'secretos.json'); // claves; nunca se envían al navegador
const MAX_HISTORIAL = 16; // mensajes que se envían a la IA: menos historial = menos tokens por respuesta

// ---------- Credenciales ----------
const CAMPO = { claude: 'anthropicApiKey', huggingface: 'hfToken' };
function leerSecretos() { try { return JSON.parse(fs.readFileSync(F_SECRETOS, 'utf8')); } catch { return {}; } }
function guardarClave(clave, proveedor = 'claude') {
  const s = leerSecretos();
  if (clave) s[CAMPO[proveedor]] = clave; else delete s[CAMPO[proveedor]];
  fs.mkdirSync(path.dirname(F_SECRETOS), { recursive: true });
  fs.writeFileSync(F_SECRETOS, JSON.stringify(s, null, 2));
  cliente = null;
}
const claveDe = (proveedor) => leerSecretos()[CAMPO[proveedor]] || (proveedor === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.HF_TOKEN);
let cliente = null;
function obtenerCliente() {
  if (cliente) return cliente;
  const clave = claveDe('claude');
  if (!clave) return null;
  cliente = new Anthropic({ apiKey: clave, maxRetries: 2, timeout: 90_000 });
  return cliente;
}
/** Motor activo según config.motor: 'local' | 'huggingface' | 'ia' (Claude) | 'menu'. */
function proveedorActivo() {
  const m = cargarDatos().config.motor;
  if (m === 'menu') return null;
  return ['local', 'huggingface'].includes(m) ? m : 'claude';
}
function disponible() {
  const p = proveedorActivo();
  if (p === 'local') return iaLocal.disponible();
  return !!(p && claveDe(p));
}
function estadoClaves() {
  const { config } = cargarDatos();
  return {
    proveedor: proveedorActivo(),
    claude: !!claveDe('claude'), huggingface: !!claveDe('huggingface'), local: iaLocal.disponible(),
    modeloClaude: MODELO, modeloHF: config.modeloHF || MODELO_HF, modeloLocal: iaLocal.MODELO_LOCAL,
  };
}

/** Formas de pago como texto: de config.formasPago, o el texto corto de ventas.pagos. */
function formasPago(config) {
  const formas = Array.isArray(config.formasPago) ? config.formasPago.filter((f) => f?.nombre) : [];
  if (formas.length) return formas.map((f) => `${f.nombre}${f.detalle ? `: ${f.detalle}` : ''}`);
  return [config.ventas?.pagos || '50% de anticipo para iniciar y 50% al entregar.'];
}

// ---------- Prompt (estable: se cachea) ----------
function promptSistema() {
  const { config, catalogo } = cargarDatos();
  const c = config.contacto || {};
  const nombre = config.asistente || 'Ultron';
  const marca = config.marca || 'la empresa';
  const v = config.ventas || {};
  const dias = v.demoDias || 7;
  const descuento = Number(v.descuentoMaximo) || 0;
  const promo = (config.promocion || '').trim();
  const servicios = catalogo.map((s, i) => {
    const partes = [`${i + 1}. ${s.nombre}${s.adicional ? ' (servicio adicional)' : ''}: desde ${precio(s.precioDesde, config.moneda)}`];
    if (s.tiempo) partes.push(`   Tiempo estimado: ${s.tiempo}`);
    if (s.incluye?.length) partes.push(`   Incluye: ${s.incluye.join('; ')}`);
    if (s.descripcion) partes.push(`   ${s.descripcion}`);
    return partes.join('\n');
  }).join('\n');

  return `Eres ${nombre}, asesor comercial de ${config.negocio}. Atiendes por WhatsApp a quienes escriben al número de ${marca}. No eres un chatbot que responde preguntas: eres un vendedor profesional que conoce a fondo los servicios, entiende el negocio del cliente y convierte la conversación en un proyecto contratado.

# Tu objetivo, en este orden
1. Identificar si es un cliente potencial.
2. Detectar qué servicio necesita (pregunta por su negocio y lo que quiere lograr).
3. Presentar la solución adecuada, con su beneficio concreto.
4. Comunicar el precio "desde", el tiempo de entrega y la forma de pago.
5. Resolver objeciones.
6. Ofrecer la demostración gratuita de ${dias} días cuando corresponda.
7. Conseguir la contratación.
8. Recopilar los datos para iniciar el proyecto.
9. Pasar al asesor humano para formalizar.

# Personalidad
- Hablas como una persona que sabe vender: segura, cálida, con energía y carácter comercial. Nada de frases de robot ("¿En qué más puedo ayudarte?", "Como asistente virtual…").
- Persuasiva y proactiva: detectas oportunidades (si tiene tienda física, le hablas de vender en línea; si atiende mucho por WhatsApp, del chatbot).
- Amable pero enfocada en que el cliente tome una decisión. Cada mensaje acerca al cierre.
- Usas el nombre del cliente cuando lo sabes.

# Cómo vendes
- Si preguntan el precio de entrada, valida la decisión, menciona el beneficio y el precio "desde", y enseguida haz una pregunta de diagnóstico. Ejemplo: "¡Excelente decisión! Una página web te ayuda a conseguir más clientes y a verte más profesional. En ${marca} tenemos soluciones desde $400.000 COP. Antes de hablar de números, cuéntame: ¿ya tienes un negocio que quieras impulsar o estás arrancando un proyecto?"
- Recomienda UNA solución concreta; no recites el catálogo completo salvo que lo pidan (para eso está enviar_catalogo).
- Explica el beneficio para SU negocio, no la lista técnica de funciones.
- Si el cliente no sabe qué necesita, asesóralo: pregunta a qué se dedica y cuál es su mayor problema hoy, y recomienda a partir de eso.
- Cuando tenga sentido, sugiere UN servicio complementario (tienda online + chatbot de WhatsApp, sistema POS + inventario, CRM + notificaciones), sin presionar.
- Si el proyecto necesita características especiales que no están en el catálogo, pide los detalles (qué debe hacer, para cuántos usuarios, fecha) y usa pasar_a_asesor con motivo "cotizacion". Nunca prometas funciones, integraciones ni plazos que no estén en el catálogo o que el asesor no haya confirmado.
- Técnicas de cierre (altérnalas, no repitas la misma dos veces seguidas):
  · Cierre directo: "¿Arrancamos con tu página?"
  · Cierre por beneficios: lo que gana el cliente (más clientes, ventas 24/7, ahorro de tiempo, imagen profesional), sin inventar cifras.
  · Cierre por alternativa: dos opciones concretas ("¿Empezamos con la web informativa o vamos directo a la tienda online?").
  · Cierre por demostración: "Te preparamos una demo gratis de ${dias} días para que la veas antes de invertir. ¿La armamos?"
  · Cierre por agenda: proponer el siguiente paso concreto (pasar los datos, hablar con el asesor).
- Objeciones:
  · "No tengo presupuesto" / "está caro": muestra el valor, ofrece empezar con una versión más sencilla, explica las formas de pago (50/50, por etapas o plan a la medida) y ofrece la demo gratuita. ${descuento > 0 ? `Solo como ÚLTIMO recurso, con un cliente decidido que sigue frenado por el precio, puedes decir que vas a solicitar un descuento de hasta ${descuento}% sujeto a confirmación del asesor (usa pasar_a_asesor con motivo "descuento_solicitado"). Nunca lo ofrezcas de entrada ni lo des por hecho.` : 'No hay descuentos autorizados: negocia el alcance, nunca el precio.'}
  · "Lo voy a pensar": "¡Claro! ¿Qué es lo que más te hace dudar?" y resuélvelo; si sigue indeciso, propón la demo.
  · "Después" / "ahora no": ofrece dejar todo listo y pide permiso para escribirle más adelante.
- Un "no" ambiguo NO es una venta perdida: indaga y resuelve. Pero un rechazo definitivo ("no me interesa, gracias", "no me escriban") se respeta: despídete con amabilidad en una línea y usa no_contactar. Nunca insistas después de eso.
- No repitas el mismo argumento ni el mismo mensaje. Si ya hiciste dos intentos sobre la misma objeción, cambia de enfoque o propone la demo.

# Demostración gratuita de ${dias} días
- Se ofrece cuando el cliente está interesado pero el presupuesto o la duda lo frenan. Aplica a cualquier servicio del catálogo.
- Es una muestra SENCILLA de cómo se vería y funcionaría su proyecto: diseño y funciones básicas. No incluye integraciones con costo (pasarelas de pago reales, APIs de pago, dominios, hosting propio, apps publicadas en tiendas) ni desarrollo ilimitado.
- Debes dejar claro desde el principio que es TEMPORAL: dura ${dias} días desde que se le entrega y después se desactiva; para seguir usándola debe contratar el servicio.
- La prepara un asesor del equipo (no es instantánea). Para pedirla necesitas: nombre del negocio, a qué se dedica, qué servicio quiere ver y qué le gustaría que tuviera. Con eso usa solicitar_demo y dile que un asesor se la prepara y se la envía por este chat.
- Si en el contexto del cliente aparece una demo entregada o vencida, úsala para cerrar: pregunta qué le pareció y propón contratar.

# Formas de pago
${formasPago(config).map((f) => `- ${f}`).join('\n')}
- Úsalas para destrabar la venta: si el presupuesto no alcanza de una vez, propón el pago por etapas o el plan a la medida antes de dar por perdida la venta.
- No pides ni recibes pagos, datos bancarios, contraseñas ni documentos; el asesor humano envía los datos de pago oficiales.

# Datos del proyecto
- A medida que el cliente los da, guárdalos con registrar_datos_cliente: nombre, negocio, servicio de interés, qué necesita, presupuesto, fecha deseada y correo. No hagas un interrogatorio: pide uno o dos datos por mensaje, de forma natural.
- Cuando el cliente quiere contratar, confirma los datos clave y usa pasar_a_asesor con motivo "quiere_contratar".

# Seguimiento
- Si el cliente queda en pensarlo, pídele permiso: "¿Te parece si te escribo en un par de días para ver cómo vas?". Si acepta, usa autorizar_seguimiento. Sin su permiso no se le vuelve a escribir.

# Límites que NUNCA rompes
- Solo usas los precios, tiempos e inclusiones del catálogo. El precio es "desde"; el valor final lo confirma el asesor según el alcance.
- No inventas descuentos, promociones, cupos o disponibilidad limitada, fechas límite, testimonios, clientes, resultados garantizados ni garantías. ${promo ? `La única promoción vigente es esta, tal cual: «${promo}».` : 'Hoy no hay promociones vigentes.'}
- Si te preguntan directamente si eres una persona o un bot, no mientas: eres ${nombre}, el asesor virtual de ${marca}, y un asesor humano del equipo puede continuar cuando quiera.
- Nada de insultos, sarcasmo, culpa ni presión manipuladora. Persuasivo no es agresivo.
- Temas ajenos a los servicios de ${marca}: redirige con amabilidad a la venta.
- Si preguntan algo que no sabes (contratos, condiciones especiales, tecnologías puntuales), di que el asesor lo confirma y usa pasar_a_asesor.

# Herramientas
- enviar_catalogo: envía el catálogo (imagen y PDF). Úsala cuando pidan opciones o precios generales. Una sola vez por conversación.
- registrar_datos_cliente: guarda los datos del proyecto que el cliente te da.
- solicitar_demo: pide al equipo la demo gratuita de ${dias} días con los datos del negocio.
- autorizar_seguimiento: el cliente aceptó que le escribas más adelante.
- pasar_a_asesor: avisa al asesor humano (quiere contratar, pide cotización formal, pide una persona, solicitas un descuento o hay una pregunta fuera de tus límites).
- no_contactar: rechazo definitivo o pidió no recibir mensajes.

# Formato WhatsApp
- Mensajes cortos: 1 a 3 párrafos breves, máximo unas 6 líneas. Sin títulos, tablas ni encabezados markdown.
- Negrita con un solo asterisco: *así*. Uno o dos emojis como máximo.
- Español claro, trato de "tú".
- Primer mensaje de una conversación: saluda, preséntate en una línea como ${nombre} de ${marca} y haz una pregunta para descubrir su necesidad.

# Datos de la empresa
- Negocio: ${config.negocio}
- Eslogan: ${config.eslogan || ''}
- Horario del equipo humano: ${config.horario}
${c.email ? `- Email: ${c.email}\n` : ''}${c.web ? `- Portafolio: ${c.web}\n` : ''}${c.github ? `- GitHub: ${c.github}\n` : ''}${c.linkedin ? `- LinkedIn: ${c.linkedin}\n` : ''}
# Catálogo (precios en ${config.moneda})
${servicios}`;
}

// Contexto variable de cada cliente (va en un bloque aparte para no romper la caché del prompt)
function textoContexto(ctx = {}) {
  const lineas = [];
  const f = ctx.ficha || {};
  const datos = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (datos.length) lineas.push(`Datos ya registrados del cliente: ${datos.join(' | ')}`);
  if (ctx.demo) {
    const d = ctx.demo;
    if (d.estado === 'solicitada') lineas.push(`Demo: solicitada (${d.servicio}); el equipo la está preparando.`);
    if (d.estado === 'entregada') lineas.push(`Demo: entregada; vence el ${new Date(d.vence).toLocaleDateString('es-CO')}.`);
    if (d.estado === 'vencida') lineas.push('Demo: ya venció. Pregunta qué le pareció y propón contratar el servicio definitivo.');
    if (d.estado === 'contrato') lineas.push('El cliente YA contrató. Atiéndelo como cliente; no le vendas lo mismo otra vez.');
  }
  if (ctx.seguimientoAutorizado) lineas.push('El cliente autorizó seguimiento.');
  if (ctx.nombreWhatsapp) lineas.push(`Nombre de perfil en WhatsApp: ${ctx.nombreWhatsapp}`);
  return lineas.length ? `# Contexto de este cliente\n${lineas.join('\n')}` : '';
}

const HERRAMIENTAS = [
  {
    name: 'enviar_catalogo',
    description: 'Envía al cliente el catálogo completo de servicios (imagen y PDF) en el chat.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: 'registrar_datos_cliente',
    description: 'Guarda los datos del proyecto que el cliente dio. Envía solo los campos que conoces; deja "" en los demás.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' }, negocio: { type: 'string' }, servicio: { type: 'string' },
        necesidad: { type: 'string' }, presupuesto: { type: 'string' }, fecha: { type: 'string' }, email: { type: 'string' },
      },
      required: ['nombre', 'negocio', 'servicio', 'necesidad', 'presupuesto', 'fecha', 'email'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'solicitar_demo',
    description: 'Pide al equipo que prepare la demostración gratuita y temporal para este cliente.',
    input_schema: {
      type: 'object',
      properties: {
        servicio: { type: 'string', description: 'Servicio que quiere ver en la demo.' },
        negocio: { type: 'string', description: 'Nombre y a qué se dedica el negocio.' },
        detalles: { type: 'string', description: 'Qué le gustaría ver: secciones, productos, colores, ideas.' },
      },
      required: ['servicio', 'negocio', 'detalles'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'autorizar_seguimiento',
    description: 'Registra que el cliente aceptó que se le escriba más adelante para retomar.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: 'pasar_a_asesor',
    description: 'Avisa a un asesor humano para que continúe (contratación, cotización formal, descuento, pregunta fuera de tus límites).',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', enum: ['quiere_contratar', 'cotizacion', 'descuento_solicitado', 'pide_humano', 'pregunta_fuera_de_limites'] },
        resumen: { type: 'string', description: 'Resumen para el asesor: qué necesita, negocio, presupuesto, fecha y lo acordado.' },
      },
      required: ['motivo', 'resumen'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'no_contactar',
    description: 'Rechazo definitivo o pidió no recibir más mensajes: no se le hará seguimiento.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
];

// Convierte el historial guardado ([{role, content: string}]) en mensajes válidos para la API
function normalizarHistorial(historial) {
  const msgs = [];
  for (const h of historial.slice(-MAX_HISTORIAL)) {
    if (!h?.content || !['user', 'assistant'].includes(h.role)) continue;
    const ultimo = msgs[msgs.length - 1];
    if (ultimo && ultimo.role === h.role) ultimo.content += `\n${h.content}`;
    else msgs.push({ role: h.role, content: h.content });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

function sistema(ctx) {
  const bloques = [{ type: 'text', text: promptSistema(), cache_control: { type: 'ephemeral' } }];
  const extra = textoContexto(ctx);
  if (extra) bloques.push({ type: 'text', text: extra });
  return bloques;
}

async function pedir(params) {
  const api = obtenerCliente();
  if (!api) throw new Error('Falta la API key de Anthropic (Configuración → Ultron)');
  // Respaldo automático si el modelo declina una solicitud por sus filtros de seguridad
  return api.beta.messages.create({
    model: MODELO,
    max_tokens: 4000,
    output_config: { effort: 'low' }, // chat rápido; el estilo lo define el prompt
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    ...params,
  });
}

// ---------- Hugging Face (API compatible con chat completions) ----------
const limpiarPensamiento = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();

async function pedirHF(body) {
  const token = claveDe('huggingface');
  if (!token) throw new Error('Falta el token de Hugging Face (Configuración → Ultron)');
  const modelo = cargarDatos().config.modeloHF || MODELO_HF;
  let ultimoError;
  for (let intento = 0; intento < 3; intento++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const res = await fetch(URL_HF, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelo, max_tokens: 1500, temperature: 0.7, ...body }),
        signal: ctrl.signal,
      });
      const datos = await res.json().catch(() => ({}));
      if (res.ok) return datos;
      const msg = datos?.error?.message || datos?.error || `HTTP ${res.status}`;
      ultimoError = Object.assign(new Error(`Hugging Face: ${msg}`), { status: res.status });
      if (![429, 500, 502, 503, 504].includes(res.status)) throw ultimoError; // errores que no se arreglan reintentando
    } catch (e) {
      ultimoError = e.name === 'AbortError' ? new Error('Hugging Face no respondió a tiempo') : e;
      if (e.status && ![429, 500, 502, 503, 504].includes(e.status)) throw ultimoError;
    } finally { clearTimeout(t); }
    await new Promise((r) => setTimeout(r, 1500 * (intento + 1)));
  }
  throw ultimoError;
}

const HERRAMIENTAS_HF = () => HERRAMIENTAS.map((h) => ({ type: 'function', function: { name: h.name, description: h.description, parameters: h.input_schema } }));
const sistemaTexto = (ctx) => sistema(ctx).map((b) => b.text).join('\n\n');

// Un "paso" de conversación con cualquiera de los dos motores, con resultado normalizado
function crearMotor(proveedor, ctx, mensajesBase) {
  if (proveedor === 'huggingface') {
    const messages = [{ role: 'system', content: sistemaTexto(ctx) }, ...mensajesBase];
    return {
      async paso() {
        const r = await pedirHF({ messages, tools: HERRAMIENTAS_HF(), tool_choice: 'auto' });
        const m = r.choices?.[0]?.message || {};
        const usos = (m.tool_calls || []).map((tc) => {
          let input = {};
          try { input = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function?.arguments || {}); } catch { /* argumentos inválidos */ }
          return { id: tc.id, name: tc.function?.name, input };
        });
        const texto = limpiarPensamiento(m.content);
        return { textos: texto ? [texto] : [], usos, crudo: { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls } };
      },
      agregar(crudo, resultados) {
        messages.push(crudo);
        for (const r of resultados) messages.push({ role: 'tool', tool_call_id: r.tool_use_id, content: r.content });
      },
    };
  }
  const messages = [...mensajesBase];
  const system = sistema(ctx);
  return {
    async paso() {
      const r = await pedir({ system, tools: HERRAMIENTAS, messages });
      if (r.stop_reason === 'refusal') throw new Error('El modelo declinó responder');
      const textos = r.content.filter((b) => b.type === 'text' && b.text.trim()).map((b) => b.text.trim());
      const usos = r.stop_reason === 'tool_use' ? r.content.filter((b) => b.type === 'tool_use') : [];
      return { textos, usos, crudo: r.content };
    },
    agregar(crudo, resultados) {
      messages.push({ role: 'assistant', content: crudo });
      messages.push({ role: 'user', content: resultados });
    },
  };
}

/**
 * Conversa con el cliente.
 * @param {Array<{role:'user'|'assistant', content:string}>} historial  conversación previa (solo texto)
 * @param {string} texto  mensaje nuevo del cliente
 * @param {object} ctx  { ficha, demo, seguimientoAutorizado, nombreWhatsapp }
 */
// Ejecuta una herramienta de Ultron y anota su efecto; devuelve el texto que verá el modelo
function ejecutarHerramienta(nombre, i, est) {
  i = i || {};
  switch (nombre) {
    case 'enviar_catalogo':
      if (est.catalogoEnviado) return 'El catálogo ya se envió.';
      est.salida.push({ tipo: 'catalogo' }); est.catalogoEnviado = true;
      return 'Catálogo enviado (imagen y PDF).';
    case 'registrar_datos_cliente':
      for (const [k, v] of Object.entries(i)) if (typeof v === 'string' && v.trim()) est.efectos.ficha[k] = v.trim();
      return 'Datos guardados.';
    case 'solicitar_demo':
      est.efectos.demo = { servicio: i.servicio || '', negocio: i.negocio || '', detalles: i.detalles || '' };
      return 'Solicitud de demo enviada al equipo. Dile al cliente que un asesor la prepara y se la envía por este chat, que es gratuita y temporal (dura los días indicados desde la entrega) y que para seguir usándola deberá contratar.';
    case 'autorizar_seguimiento':
      est.efectos.seguimientoAutorizado = true;
      return 'Seguimiento autorizado.';
    case 'pasar_a_asesor':
      est.efectos.asesor = { motivo: i.motivo || 'cotizacion', resumen: i.resumen || '' };
      return 'Asesor notificado. Dile al cliente que un asesor humano le escribe en horario de atención para continuar.';
    case 'no_contactar':
      est.efectos.noContactar = true;
      return 'Registrado: no se le volverá a escribir.';
    default:
      return 'Herramienta desconocida.';
  }
}

// Prompt corto para el modelo local (en CPU, cada token del prompt cuesta tiempo)
function promptCompacto() {
  const { config, catalogo } = cargarDatos();
  const v = config.ventas || {};
  const dias = v.demoDias || 7;
  const nombre = config.asistente || 'Ultron';
  const marca = config.marca || 'la empresa';
  const promo = (config.promocion || '').trim();
  const lista = catalogo.map((s) => `- ${s.nombre}: desde ${precio(s.precioDesde, config.moneda)}${s.tiempo ? `, ${s.tiempo}` : ''}${s.descripcion ? `. ${s.descripcion}` : ''}`).join('\n');
  return `Eres ${nombre}, asesor comercial de ${config.negocio} por WhatsApp. Hablas como un vendedor real: natural, cálido, seguro y con energía. Respondes en español, tuteando, en mensajes cortos (2 a 4 líneas). Nunca suenas a robot.

Tu meta es vender: descubre qué necesita el cliente con preguntas, recomienda UN servicio con su beneficio y precio "desde", resuelve dudas y termina siempre con una pregunta que lleve al siguiente paso. Si no sabe qué necesita, pregúntale a qué se dedica y qué problema quiere resolver. Si duda por el precio, ofrece empezar por algo sencillo, las formas de pago (${formasPago(config).map((f) => f.split(':')[0]).join(', ')}) o una demo gratis de ${dias} días (temporal; luego debe contratar). Respeta un "no" definitivo.

Reglas: usa solo estos precios y servicios. No inventes descuentos, promociones, fechas límite, testimonios ni garantías. No prometas funciones ni plazos que no estén aquí: si pide algo especial, pide los detalles y di que el asesor le prepara la cotización.${promo ? ` Promoción vigente: ${promo}.` : ''}${Number(v.descuentoMaximo) ? ` Solo como último recurso puedes decir que pedirás un descuento de hasta ${v.descuentoMaximo}% que confirma el asesor.` : ''} No pidas pagos ni datos bancarios. Si te preguntan si eres una persona, di que eres el asesor virtual de ${marca}.

Servicios (${config.moneda}):
${lista}

Horario del equipo: ${config.horario}.

Cómo actúas ante cada situación:
- Saludo: SOLO en tu primer mensaje saluda y preséntate como ${nombre} de ${marca}. En los demás mensajes ve directo al punto, sin "Hola" ni presentarte otra vez. Nunca digas "¿en qué puedo ayudarte?".
- Nunca supongas el tipo de negocio del cliente: pregúntalo. El ejemplo de abajo es solo de estilo.
- Tecnologías o herramientas: ${(cargarDatos().config.tecnologias || '').trim() ? `trabajamos con ${cargarDatos().config.tecnologias}.` : 'NO afirmes con qué lenguajes o herramientas trabajamos; di que el asesor le confirma la tecnología ideal para su proyecto.'}
- Pregunta de precio: di el precio "desde", el beneficio para SU negocio y haz una pregunta de diagnóstico.
- "No tengo presupuesto" o "está caro": ofrece la demo gratis de ${dias} días para que vea su proyecto antes de invertir, y el pago en dos partes.
- "Lo voy a pensar": pregunta qué es lo que más le hace dudar y propón la demo.
- Quiere contratar o acepta la demo: pide nombre del negocio y qué quiere ver.
- Pregunta técnica o compleja: responde con precisión y en tono profesional, en pocas líneas. Si no sabes algo con certeza, dilo y ofrece que el asesor lo confirme. Nunca inventes datos.
- Si quiere ver todas las opciones, recuérdale que puede escribir *menu* (opciones del 1 al 7).

Ejemplo de conversación:
Cliente: Hola
${nombre}: ¡Hola! 👋 Soy ${nombre}, de ${marca}. Ayudo a negocios a vender más con páginas web, tiendas online y chatbots. Cuéntame, ¿qué negocio tienes o qué proyecto tienes en mente?
Cliente: Tengo una panadería, cuánto cuesta una página web? no tengo mucha plata
${nombre}: ¡Buenísimo! Una web le da a tu panadería más clientes y pedidos por WhatsApp. Las páginas están desde *$400.000 COP* y puedes pagar 50% al iniciar y 50% al entregar, o por etapas. Y si quieres verla antes de invertir, te preparamos una *demo gratis de ${dias} días*. ¿Te la armamos?
Cliente: lo voy a pensar
${nombre}: ¡Claro! ¿Qué es lo que más te hace dudar: el precio o cómo quedaría? Con la demo gratis sales de dudas sin pagar nada. ¿Cómo se llama tu panadería para empezarla?`;
}

// Conversación con el modelo local (node-llama-cpp)
async function conversarLocal(base, ctx) {
  const salida = [];
  const est = { salida, efectos: { asesor: null, noContactar: false, ficha: {}, demo: null, seguimientoAutorizado: false, pedirDatosDemo: false }, catalogoEnviado: false };
  const historial = base.slice(0, -1).slice(-4);
  const contexto = textoContexto(ctx).replace(/^# Contexto de este cliente\n/, '');
  const ultimo = base[base.length - 1].content;
  const exactos = datosDeServicios(ultimo);
  const { config } = cargarDatos();
  // Las intenciones clave (asesor, demo, rechazo…) ya las resolvió respuestaRapida() sin IA.
  // Aquí solo se registran datos sueltos, como el correo.
  detectarIntenciones(ultimo, historial, ctx, est);
  const preguntaTecnologia = !(config.tecnologias || '').trim() && RX_TECNOLOGIA.test(normalizar(ultimo));
  const internos = [
    contexto && `Contexto: ${contexto.replace(/\n/g, ' | ')}`,
    exactos.length && `Datos EXACTOS de lo que pregunta (cítalos tal cual, no cambies precios ni tiempos): ${exactos.join(' || ')}`,
    preguntaTecnologia && 'No afirmes con qué tecnología o plataforma trabajamos: di que el asesor confirma la tecnología ideal',
  ].filter(Boolean);
  const texto = internos.length ? `[Información interna, no la menciones como tal: ${internos.join(' — ')}]\n${ultimo}` : ultimo;
  const respuesta = await iaLocal.generar({ sistema: promptCompacto(), historial, texto, temperatura: 0.35 });
  const nombre = config.asistente || 'Ultron';
  let limpio = limpiarPensamiento(respuesta).replace(new RegExp(`^(${nombre}|Ultron|Asistente|Asesor)\\s*:\\s*`, 'i'), '').trim();
  // Si ya habló antes, quitar el saludo/presentación repetidos del inicio
  if (historial.some((h) => h.role === 'assistant')) {
    limpio = limpio
      .replace(/^¡?\s*(hola|buenas)[^.!?\n]*[!.]?\s*(👋\s*)?/i, '')
      .replace(new RegExp(`^soy ${nombre}[^.!?\\n]*[.!]\\s*`, 'i'), '')
      .replace(/^nos especializamos[^.!?\n]*[.!]\s*/i, '')
      .trim();
    limpio = limpio.charAt(0).toUpperCase() + limpio.slice(1);
  }
  if (limpio) salida.push({ tipo: 'texto', texto: limpio });
  return est;
}

// Palabras con las que los clientes se refieren a cada servicio (por id del catálogo)
const PALABRAS_SERVICIO = {
  // Catálogo actual (20 servicios)
  administrativo: /sistema administrativo|administrar (mi|la) empresa|\berp\b|gestion de (empleados|operaciones)|nomina/,
  inventario: /inventario|existencias|stock|bodega/,
  pos: /\bpos\b|punto de venta|facturaci|factura electronica|\bcaja\b/,
  'chatbot-ia': /chat ?bots?|\bbots?\b|asistente virtual|asistente (con|de) (ia|inteligencia)/,
  automatizacion: /automatiz|tareas repetitivas|procesos manuales/,
  crm: /\bcrm\b|seguimiento (de|a) (mis )?clientes|gestion de clientes|embudo de ventas/,
  reservas: /reserva|\bcitas?\b|agendar|agendamiento|agenda/,
  bd: /bases? de datos|\bsql\b|mysql|postgres/,
  educativa: /educativ|cursos? (en linea|online|virtual)|\bcursos\b|academia|colegio|estudiantes|e-?learning/,
  clasificados: /clasificados|anuncios|marketplace|publicar (productos|anuncios)/,
  notificaciones: /notificacion|alertas|recordatorios|correos? automatico/,
  medida: /a la medida|a medida|software personalizado|sistema personalizado|algo unico/,
  // Palabras compartidas con servicios anteriores (se usan si el servicio existe en el catálogo)
  web: /pagina(s)? web|sitio web|\bweb\b|pagina para mi/,
  tienda: /tienda|e-?commerce|vender (en linea|por internet|online)|carrito/,
  app: /\bapps?\b|aplicaci|movil|android|\bios\b|play ?store/,
  sistema: /sistema|inventario|facturaci|software|crm|erp|punto de venta/,
  bot: /chat ?bot|\bbots?\b|asistente virtual/,
  whatsapp: /whats ?app/,
  soporte: /mantenimiento|soporte|arreglar|se (me )?dano|actualizar mi/,
  datos: /analisis de datos|\banalizar (mis |los )?datos|dashboard|excel|power ?bi|\bkpis?\b|estadistica/,
  dashboard: /dashboard|tiempo real|analitica|indicadores|estadisticas|\bkpis?\b|informes/,
  reportes: /reporte|extraer|extraccion/,
  landing: /landing|una sola pagina|pagina de (aterrizaje|venta)/,
  uxui: /diseno|\bux\b|\bui\b|figma|prototipo/,
  seo: /\bseo\b|google|posicionamiento|aparecer en/,
  hosting: /dominio|hosting|correo(s)? (corporativo|empresarial|con mi)/,
  migracion: /migra|moderniz|sistema (viejo|antiguo)/,
  consultoria: /consultor|capacitaci|asesoria|ensen/,
  api: /\bapis?\b|backend|\brest\b|integrar (mis|los|dos) sistemas/,
  automatizaciones: /automatiz|tareas repetitivas/,
  ia: /inteligencia artificial|\bia\b|\bai\b|chat ?gpt|modelo de lenguaje/,
  pagos: /pagos? en linea|pasarela|recibir pagos|cobrar (en linea|con tarjeta|online)/,
  marketing: /marketing|publicidad|campana|correos? masivo/,
};

const GENERICAS = new Set(['integracion', 'desarrollo', 'correo', 'correos', 'whatsapp', 'tiempo', 'ventas', 'servicio', 'servicios', 'automaticos', 'sistema', 'sistemas', 'online', 'digital', 'pagina', 'paginas']);

/** Servicios del catálogo que el cliente menciona con sus palabras (máx. 3). */
function serviciosMencionados(texto) {
  const { catalogo } = cargarDatos();
  const t = ` ${normalizar(texto)} `;
  return catalogo.filter((s) => {
    const rx = PALABRAS_SERVICIO[s.id] || PALABRAS_SERVICIO[s.id.replace(/-\d+$/, '')];
    if (rx) return rx.test(t);
    // Servicios nuevos sin palabras clave: por su nombre, ignorando palabras demasiado comunes
    return normalizar(s.nombre).split(/\W+/).some((w) => w.length > 5 && !GENERICAS.has(w) && new RegExp(`\\b${w}\\b`).test(t));
  }).slice(0, 3);
}

// Datos exactos de los servicios que el cliente menciona (para que la IA no se equivoque de precio)
function datosDeServicios(texto) {
  const { config } = cargarDatos();
  const t = ` ${normalizar(texto)} `;
  const hallados = serviciosMencionados(texto);
  // Lo que incluye solo se agrega si lo pregunta (menos texto = respuesta más rápida)
  const pideDetalle = /incluye|trae|tiene|detalle|que hacen|que ofrece|caracteristic/.test(t);
  return hallados.map((s) => `${s.nombre}: desde ${precio(s.precioDesde, config.moneda)}${s.tiempo ? `, tiempo ${s.tiempo}` : ''}${pideDetalle && s.incluye?.length ? `, incluye ${s.incluye.join('; ')}` : ''}`);
}

// Frases clave del cliente → avisos y registros (para el motor local)
const normalizar = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function detectarIntenciones(texto, historial, ctx, est) {
  const t = ` ${normalizar(texto).replace(/[¡!¿?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const palabras = t.trim().split(' ').filter(Boolean).length;
  const ultimoBot = normalizar([...historial].reverse().find((h) => h.role === 'assistant')?.content);
  const afirma = /^ (si|sii+|claro|dale|ok|okay|listo|de una|perfecto|me parece|hagamoslo|armala|bueno|va|vale)\b/.test(t) && !/\b(no|pero|aun no|todavia no)\b/.test(t);

  // Rechazo definitivo: solo si no está pidiendo otra cosa ("no me interesa la app, mejor una web" no cuenta)
  const rechazo = /\b(no me interesa|no me escrib|no me molest|deja de escribir|dejen de escribir|no quiero (nada|mas mensajes)|no necesito nada)\b/.test(t);
  if (rechazo && !/\b(mejor|pero|sino|quiero|necesito un|necesito una|prefiero)\b/.test(t.replace(/no necesito nada|no quiero (nada|mas mensajes)/, ''))) {
    est.efectos.noContactar = true;
    return;
  }
  if (/\b(hablar|comunicarme|comunicar|contactar)( me)? con (un |una |el |la |algun |alguna )?(persona|humano|asesor|asesora|andres|alguien|vendedor)|\b(atienda|atiendame|me atienda) (un |una |el )?(persona|humano|asesor)|\bpasame (con|a) (un |una |el )?(persona|humano|asesor)/.test(t)) {
    est.efectos.asesor = { motivo: 'pide_humano', resumen: `Pidió hablar con una persona: "${texto}"` };
  }
  // "Quiero empezar un negocio de ropa" no es contratar: empezar/arrancar solo cuenta en mensajes cortos
  const contratar = /\b(quiero|deseo|me gustaria|listo para|vamos a) (contratar|comprar|contratarlos|contratarte)\b|\bme interesa contratar\b|\b(como|donde|a donde) (te |les )?(pago|consigno|transfiero)\b|\bcerremos\b/.test(t)
    || (palabras <= 6 && /\b(quiero|vamos a|listo para) (empezar|arrancar|iniciar|hacerlo)\b|^ (hagamoslo|arranquemos|empecemos)\b/.test(t));
  if (contratar) est.efectos.asesor = { motivo: 'quiere_contratar', resumen: `Quiere contratar: "${texto}"` };
  // Pedir un descuento pasa al asesor solo si hay descuento autorizado; "¿algo más barato?" lo resuelve la IA
  if (/\b(descuento|rebaja|rebajita)\b/.test(t) && !est.efectos.asesor && Number(cargarDatos().config.ventas?.descuentoMaximo) > 0) {
    est.efectos.asesor = { motivo: 'descuento_solicitado', resumen: `Pregunta por descuento: "${texto}"` };
  }
  // Acepta la demo: se le piden los datos del negocio (no se avisa al equipo hasta tenerlos)
  // Solo si Ultron le PREGUNTÓ por la demo (la ficha inicial la menciona, pero no la ofrece con pregunta)
  const aceptaDemo = /demo[^.!\n]*\?/.test(ultimoBot) && afirma;
  if ((aceptaDemo || /\bquiero (la|una) demo\b|\b(armen|hagan|preparen|arma|haz|prepara)(me)? (la|una) demo\b/.test(t)) && !['solicitada', 'entregada'].includes(ctx.demo?.estado) && !est.efectos.asesor) {
    est.efectos.pedirDatosDemo = true;
  }
  // Permiso de seguimiento: lo pidió Ultron y el cliente aceptó, o el cliente dijo que lo piensa
  const botPideSeguir = /(te escribo|escribirte|te contacto|contactarte|te aviso)/.test(ultimoBot);
  if (botPideSeguir && (afirma || /\b(lo pienso|lo voy a pensar|despues (te|les) (escribo|aviso)|mas adelante|otro dia)\b/.test(t))) {
    est.efectos.seguimientoAutorizado = true;
  }
  const correo = String(texto).match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (correo) est.efectos.ficha.email = correo[0];
}

const RX_TECNOLOGIA = /\b(react|node|python|php|laravel|wordpress|shopify|flutter|kotlin|swift|java|angular|vue|django|tecnologia|tecnologias|lenguaje|lenguajes|framework|stack)\b/;

/**
 * Respuestas sin IA (ahorran tokens y son exactas). Devuelve null si hace falta la IA.
 * Cubre: primer mensaje (ficha), pedir asesor, contratar, rechazo, aceptar la demo, precio de un servicio,
 * formas de pago, horario/contacto, catálogo, tecnologías y "gracias/ok".
 */
function respuestaRapida(texto, historial, ctx = {}) {
  const { config } = cargarDatos();
  const { fichaInicial, textoPagos, textoContacto } = require('./flujo');
  const est = { salida: [], efectos: { asesor: null, noContactar: false, ficha: {}, demo: null, seguimientoAutorizado: false, pedirDatosDemo: false } };
  const fija = (txt, extra = []) => { est.salida.push(...extra, { tipo: 'texto', texto: txt }); return est; };
  const t = normalizar(texto).replace(/[¡!¿?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  const palabras = t ? t.split(' ').length : 0;
  const dias = config.ventas?.demoDias || 7;
  const marca = config.marca || 'nuestro equipo';
  const servicios = serviciosMencionados(texto);

  // 1) Momentos clave: avisos al asesor, rechazo y demo
  detectarIntenciones(texto, historial, ctx, est);
  if (est.efectos.noContactar) return fija('Entendido, gracias por tu tiempo 🙌. No te volveremos a escribir. Si más adelante necesitas algo, aquí estaremos.');
  const motivo = est.efectos.asesor?.motivo;
  if (motivo === 'quiere_contratar') return fija(`¡Excelente decisión! 🎉 Ya le pasé tu solicitud a un asesor de ${marca} para formalizar el proyecto. Te escribe por este chat en horario de atención (${config.horario}).`);
  if (motivo === 'pide_humano') return fija(`¡Claro! Ya le avisé a un asesor de ${marca} para que te atienda personalmente por este chat en horario de atención (${config.horario}).`);
  if (motivo === 'descuento_solicitado') return fija(`Entiendo. Voy a consultar con el asesor si es posible un ajuste en el precio; él te confirma por este chat en horario de atención (${config.horario}).`);
  if (est.efectos.pedirDatosDemo) {
    return fija(`¡Listo! 🎁 Te preparamos la *demo gratis de ${dias} días*. Cuéntame en *un solo mensaje*:\n• Nombre de tu negocio y a qué se dedica\n• Qué quieres ver (página web, tienda, app, sistema, chatbot…)\n• Ideas o colores que te gusten`);
  }
  if (est.efectos.seguimientoAutorizado && palabras <= 8) return fija('¡Perfecto! Te escribo en unos días para ver cómo vas. Si antes te surge alguna duda, aquí estoy 🙌');

  // 2) Primer mensaje de la conversación: la ficha con lo importante
  const conIA = ctx.conIA !== false;
  if (ctx.inicio) return fija(fichaInicial(servicios, { conIA }));

  // 3) Preguntas frecuentes con respuesta exacta (solo mensajes cortos y directos)
  if (palabras <= 12) {
    const sigue = conIA ? '¿Qué proyecto tienes en mente?' : 'Escribe *menu* para ver todas las opciones.';
    // Saludo en medio de la conversación: no hace falta la IA ni repetir la ficha
    if (/^(hola+|holi|buenas?( tardes| noches| dias)?|buen dia|buenos dias|hey|ola|saludos|que tal)( [a-z]+)?$/.test(t)) {
      return fija(`¡Hola de nuevo! 👋 ¿En qué te ayudo? ${conIA ? 'Cuéntame qué necesitas.' : 'Escribe *menu* para ver las opciones.'}`);
    }
    if (/\b(formas? de pago|metodos? de pago|como (se )?paga|se puede pagar|financ|cuotas|a plazos|por etapas|pagar por partes)\b/.test(t)) return fija(textoPagos(config));
    // Ejemplos de trabajos: el portafolio (va antes que el catálogo)
    const web = config.contacto?.web;
    if (web && /\b(ejemplos?|portafolio|trabajos (anteriores|realizados|hechos)|proyectos (anteriores|realizados|hechos)|muestras?)\b/.test(t)) {
      return fija(`Puedes ver nuestros trabajos aquí: ${web} 🌐\n\n¿Te armamos una *demo gratis de ${dias} días* para que veas cómo quedaría *tu* proyecto?`);
    }
    const cobertura = String(config.cobertura || '').trim();
    if (cobertura && /\b(donde (estan|quedan|son|se ubican)|ubicad[oa]s?|ubicacion|que ciudad|presencial|otro pais|otros paises|atienden en|trabajan en|de donde son)\b/.test(t)) {
      return fija(`Trabajamos con clientes de ${cobertura} 🌎. El asesor te confirma cómo coordinamos tu proyecto según tu ciudad. ${sigue}`);
    }
    if (/\b(horario|a que hora|atienden|correo electronico|email|datos de contacto|numero de contacto)\b/.test(t) && !servicios.length) return fija(textoContacto(config));
    if (/\b(catalogo|brochure|todos (los|sus) servicios|que servicios|que hacen|que ofrecen)\b/.test(t)) {
      return fija(`Aquí tienes nuestro catálogo 📂. ¿Cuál de estos servicios te sirve para tu negocio? Si me cuentas a qué te dedicas, te recomiendo el ideal.`, [{ tipo: 'catalogo' }]);
    }
    if (/\b(como (empezamos|empiezo|inicio|iniciamos|arrancamos|funciona el proceso|es el proceso)|que necesito para (empezar|iniciar|arrancar)|cual es el proceso|pasos para)\b/.test(t)) {
      return fija(`Es muy sencillo:\n1️⃣ Me cuentas tu idea: qué necesitas y para qué negocio.\n2️⃣ El asesor te envía la cotización con el alcance, el precio y el tiempo.\n3️⃣ Eliges la forma de pago (${formasPago(config).map((f) => f.split(':')[0].toLowerCase()).join(', ')}) y arrancamos.\n\n¿Me cuentas qué necesitas?`);
    }
    const preguntaTiempo = /\b(cuanto (tiempo )?(se )?(demora|demoran|tarda|tardan)|en cuanto tiempo|tiempo de entrega|cuanto se (demora|tarda)n?)\b/.test(t);
    const preguntaPrecio = preguntaTiempo || /\b(precio|precios|cuanto|valor|vale|valen|cuesta|cuestan|costo|cobran|tarifa|incluye)\b/.test(t);
    // "¿Y cuánto vale?" sin decir el servicio: el que se venía hablando en los últimos mensajes
    // (solo lo que dijo el propio cliente; "¿cuánto cuestan sus servicios?" es una pregunta general)
    const general = /\b(servicios|precios|todo|todos|ustedes)\b/.test(t);
    const anteriorCliente = [...historial].reverse().find((h) => h.role === 'user')?.content || '';
    const delContexto = servicios.length ? servicios : preguntaPrecio && palabras <= 5 && !general
      ? serviciosMencionados(anteriorCliente).slice(0, 1) : [];
    if (delContexto.length && (preguntaPrecio || palabras <= 6)) { // "y un sistema de inventario?"
      return fija(fichaInicial(delContexto.slice(0, 2), { conIA, saludo: false }));
    }
    if (preguntaTiempo) {
      const { catalogo } = cargarDatos();
      const conTiempo = catalogo.filter((s) => s.tiempo && !/segun/i.test(normalizar(s.tiempo)));
      if (conTiempo.length) return fija(`⏱️ *Tiempos estimados*\n${conTiempo.map((s) => `• ${s.nombre}: ${s.tiempo}`).join('\n')}\n\nLos demás dependen del alcance y el asesor te los confirma en la cotización. ${sigue}`);
    }
    if (preguntaPrecio) return fija(`${fichaInicial([], { conIA, saludo: false })}`); // "¿cuánto cuestan sus servicios?"
    if (!(config.tecnologias || '').trim() && RX_TECNOLOGIA.test(t) && !servicios.length) {
      return fija('Trabajamos con tecnologías modernas y elegimos la más adecuada según lo que necesita tu proyecto. El asesor te confirma el detalle técnico. ¿Qué proyecto tienes en mente para recomendarte la mejor opción?');
    }
    if (/^(muchas )?gracias( .*)?$|^(ok|okay|vale|listo|perfecto|entendido|genial|excelente|super|bueno|de acuerdo)( gracias)?$/.test(t)) {
      return fija('¡Con gusto! 🙌 Si te surge cualquier duda o quieres arrancar tu proyecto, escríbeme por aquí.');
    }
  }
  return null;
}

// ---------- Control de calidad de lo que escribe la IA ----------
// Montos en el texto: "$400.000", "400.000", "1,5 millones", "800 mil" (solo cifras de precio, ≥ 10.000)
function montos(texto) {
  const t = normalizar(texto);
  const res = [];
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s?(millones|millon|mil)\b/g)) {
    res.push(Math.round(parseFloat(m[1].replace(',', '.')) * (m[2] === 'mil' ? 1e3 : 1e6)));
  }
  const sinPalabras = t.replace(/(\d+(?:[.,]\d+)?)\s?(millones|millon|mil)\b/g, ' ');
  for (const m of sinPalabras.matchAll(/\$?\s?(\d{1,3}(?:[.,]\d{3})+|\d{5,})(?![\d%])/g)) res.push(Number(m[1].replace(/[.,]/g, '')));
  return res.filter((n) => n >= 10_000);
}

/**
 * Revisa la respuesta de la IA antes de enviarla. Si inventa un precio o un porcentaje (descuento)
 * que no existe, se reemplaza por la ficha exacta del catálogo. También quita restos de instrucciones
 * internas y recorta respuestas cortadas o demasiado largas para WhatsApp.
 */
function revisarRespuestaIA(salida, textoCliente, historial) {
  const { config, catalogo } = cargarDatos();
  const precios = new Set(catalogo.map((s) => s.precioDesde));
  // Cifras que dijo el propio cliente (su presupuesto) también son válidas
  for (const n of montos([textoCliente, ...historial.filter((h) => h.role === 'user').map((h) => h.content)].join(' '))) precios.add(n);
  const porcentajes = new Set([50, 100, ...(Number(config.ventas?.descuentoMaximo) > 0 ? [Number(config.ventas.descuentoMaximo)] : [])]);
  let motivo = null;
  const revisada = salida.map((s) => {
    if (s.tipo !== 'texto') return s;
    let t = s.texto.replace(/\[?\s*informaci[oó]n interna[^\]\n]*\]?/gi, '').trim();
    if (montos(t).some((n) => !precios.has(n))) motivo = 'precio que no está en el catálogo';
    if ([...t.matchAll(/(\d{1,3})\s?%/g)].some((m) => !porcentajes.has(Number(m[1])))) motivo ||= 'porcentaje no autorizado';
    // Respuesta cortada a mitad de frase (límite de tokens) o demasiado larga: hasta la última frase completa
    const corta = (txt, max) => {
      const parte = txt.slice(0, max);
      const fin = Math.max(parte.lastIndexOf('. '), parte.lastIndexOf('! '), parte.lastIndexOf('? '), parte.lastIndexOf('.\n'), parte.lastIndexOf('?\n'), parte.lastIndexOf('!\n'));
      return fin > max * 0.4 ? parte.slice(0, fin + 1).trim() : txt;
    };
    if (t.length > 900) t = corta(t, 900);
    if (!/[.!?…)*\u{1F300}-\u{1FAFF}☀-➿]\s*$/u.test(t)) t = corta(t + ' ', t.length + 1);
    return { ...s, texto: t };
  }).filter((s) => s.tipo !== 'texto' || s.texto);
  if (!motivo) return { salida: revisada, motivo: null };
  // Reemplazo seguro: la ficha exacta del servicio del que se habla (o el resumen general)
  const textoIA = salida.filter((s) => s.tipo === 'texto').map((s) => s.texto).join(' ');
  const servicios = serviciosMencionados(textoCliente).length ? serviciosMencionados(textoCliente) : serviciosMencionados(textoIA);
  const { fichaInicial } = require('./flujo');
  return {
    salida: [...salida.filter((s) => s.tipo !== 'texto'), { tipo: 'texto', texto: `Te comparto los valores exactos 👇\n\n${fichaInicial(servicios.slice(0, 2), { saludo: false })}` }],
    motivo,
  };
}

async function conversar(historial, texto, ctx = {}) {
  const base = normalizarHistorial([...historial, { role: 'user', content: texto || '(mensaje sin texto: imagen, audio o archivo)' }]);
  // Primero, lo que se responde sin IA
  const rapida = respuestaRapida(texto || '', base.slice(0, -1), ctx);
  if (rapida) {
    const respuestaTexto = rapida.salida.map((s) => (s.tipo === 'texto' ? s.texto : '[Se envió el catálogo: imagen y PDF]')).join('\n');
    return { salida: rapida.salida, respuestaTexto, sinIA: true, ...rapida.efectos };
  }
  if (!disponible()) throw Object.assign(new Error('No hay IA configurada'), { codigo: 'SIN_IA' });
  const proveedor = proveedorActivo();
  let salida, efectos;

  if (proveedor === 'local') {
    ({ salida, efectos } = await conversarLocal(base, ctx));
  } else {
    const motor = crearMotor(proveedor, ctx, base);
    const est = { salida: [], efectos: { asesor: null, noContactar: false, ficha: {}, demo: null, seguimientoAutorizado: false }, catalogoEnviado: false };
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const r = await motor.paso();
      for (const t of r.textos) est.salida.push({ tipo: 'texto', texto: t });
      const usos = r.usos.filter((u) => u.name);
      if (!usos.length) break;
      const resultados = usos.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: ejecutarHerramienta(u.name, u.input, est) }));
      motor.agregar(r.crudo, resultados);
    }
    ({ salida, efectos } = est);
  }

  const revision = revisarRespuestaIA(salida, texto || '', base.slice(0, -1));
  salida = revision.salida;
  if (!salida.some((s) => s.tipo === 'texto')) throw new Error('Ultron no generó respuesta');
  const respuestaTexto = salida.map((s) => (s.tipo === 'texto' ? s.texto : '[Se envió el catálogo: imagen y PDF]')).join('\n');
  return { salida, respuestaTexto, corregida: revision.motivo, ...efectos };
}

/**
 * Escribe un mensaje proactivo (seguimiento autorizado o cierre de demo vencida).
 * @param {'seguimiento'|'demo_vencida'} tipo
 */
async function mensajeProactivo(historial, ctx, tipo, numero = 1) {
  const msgs = normalizarHistorial(historial);
  const transcripcion = msgs.map((m) => `${m.role === 'user' ? 'Cliente' : 'Ultron'}: ${m.content}`).join('\n');
  const tarea = tipo === 'demo_vencida'
    ? 'La demostración gratuita del cliente acaba de vencer y se desactivó. Escribe el mensaje de cierre: pregunta qué le pareció, recuérdale lo que gana con el servicio definitivo, el precio "desde" y la forma de pago, y propón contratar con una pregunta de alternativa.'
    : `El cliente autorizó que le escribieras para retomar. Este es el seguimiento ${numero}. Retoma lo que necesitaba, aporta una razón concreta para avanzar y termina con una pregunta fácil de responder. ${numero >= 2 ? 'Es el último seguimiento: deja la puerta abierta sin presionar.' : ''}`;
  const instruccion = `[Instrucción interna, no es un mensaje del cliente] ${tarea}
Conversación hasta ahora:
${transcripcion || '(sin mensajes previos)'}

Escribe SOLO el texto del mensaje que Ultron enviará (2 a 5 líneas). No inventes promociones ni fechas límite.`;
  let texto;
  if (proveedorActivo() === 'local') {
    texto = limpiarPensamiento(await iaLocal.generar({ sistema: promptCompacto(), texto: instruccion, maxTokens: 220 }));
  } else if (proveedorActivo() === 'huggingface') {
    const r = await pedirHF({ messages: [{ role: 'system', content: sistemaTexto(ctx) }, { role: 'user', content: instruccion }] });
    texto = limpiarPensamiento(r.choices?.[0]?.message?.content);
  } else {
    const r = await pedir({ system: sistema(ctx), messages: [{ role: 'user', content: instruccion }] });
    if (r.stop_reason === 'refusal') throw new Error('El modelo declinó responder');
    texto = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }
  if (!texto) throw new Error('No se generó el mensaje');
  return texto;
}

/** IA local: procesa el guion de ventas por adelantado para que la primera respuesta sea rápida. */
async function calentarLocal() {
  await iaLocal.generar({ sistema: promptCompacto(), texto: 'Hola', maxTokens: 1 });
}

/** Comprueba una clave con una llamada mínima al proveedor indicado. */
async function probarClave(proveedor = 'claude') {
  if (proveedor === 'huggingface') {
    const r = await pedirHF({ max_tokens: 20, messages: [{ role: 'user', content: 'Responde solo: OK' }] });
    return !!r.choices?.length;
  }
  const r = await pedir({ max_tokens: 200, messages: [{ role: 'user', content: 'Responde solo: OK' }] });
  return r.content.some((b) => b.type === 'text');
}

module.exports = { conversar, respuestaRapida, revisarRespuestaIA, montos, serviciosMencionados, mensajeProactivo, calentarLocal, disponible, estadoClaves, guardarClave, probarClave, promptSistema, MODELO, MODELO_HF };
