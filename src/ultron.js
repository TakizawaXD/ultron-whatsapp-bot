// ULTRON: asesor comercial de TAKER con IA.
// Dos motores a elegir en el panel: Hugging Face (modelos abiertos vía router.huggingface.co) o Claude.
// Vende con técnicas de cierre, ofrece la demo gratuita de 7 días, recoge los datos del proyecto
// y pasa al asesor humano. Nunca inventa precios, descuentos, garantías ni urgencias.
const fs = require('fs');
const path = require('path');
const AnthropicSDK = require('@anthropic-ai/sdk');
const { cargarDatos, precio, RAIZ } = require('./flujo');

const Anthropic = AnthropicSDK.default || AnthropicSDK;
const MODELO = 'claude-opus-5-5';
const MODELO_HF = 'deepseek-ai/DeepSeek-V4.1-Flash-1017';
const URL_HF = 'https://router.huggingface.co/v1/chat/completions';
const F_SECRETOS = path.join(RAIZ, 'data', 'secretos.json'); // claves; nunca se envían al navegador
const MAX_HISTORIAL = 40;

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
/** Motor activo según config.motor: 'huggingface' | 'ia' (Claude) | 'menu'. */
function proveedorActivo() {
  const m = cargarDatos().config.motor;
  return m === 'huggingface' ? 'huggingface' : m === 'menu' ? null : 'claude';
}
function disponible() { const p = proveedorActivo(); return !!(p && claveDe(p)); }
function estadoClaves() {
  const { config } = cargarDatos();
  return {
    proveedor: proveedorActivo(),
    claude: !!claveDe('claude'), huggingface: !!claveDe('huggingface'),
    modeloClaude: MODELO, modeloHF: config.modeloHF || MODELO_HF,
  };
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
- Técnicas de cierre (altérnalas, no repitas la misma dos veces seguidas):
  · Cierre directo: "¿Arrancamos con tu página?"
  · Cierre por beneficios: lo que gana el cliente (más clientes, ventas 24/7, ahorro de tiempo, imagen profesional), sin inventar cifras.
  · Cierre por alternativa: dos opciones concretas ("¿Empezamos con la web informativa o vamos directo a la tienda online?").
  · Cierre por demostración: "Te preparamos una demo gratis de ${dias} días para que la veas antes de invertir. ¿La armamos?"
  · Cierre por agenda: proponer el siguiente paso concreto (pasar los datos, hablar con el asesor).
- Objeciones:
  · "No tengo presupuesto" / "está caro": muestra el valor, ofrece empezar con una versión más sencilla o por etapas, explica el pago en dos partes, y ofrece la demo gratuita. ${descuento > 0 ? `Solo como ÚLTIMO recurso, con un cliente decidido que sigue frenado por el precio, puedes decir que vas a solicitar un descuento de hasta ${descuento}% sujeto a confirmación del asesor (usa pasar_a_asesor con motivo "descuento_solicitado"). Nunca lo ofrezcas de entrada ni lo des por hecho.` : 'No hay descuentos autorizados: negocia el alcance, nunca el precio.'}
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

# Forma de pago
- ${v.pagos || '50% de anticipo para iniciar y 50% al entregar.'}
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
async function conversar(historial, texto, ctx = {}) {
  const proveedor = proveedorActivo();
  if (!proveedor) throw new Error('El motor está en "menú clásico"');
  const base = normalizarHistorial([...historial, { role: 'user', content: texto || '(mensaje sin texto: imagen, audio o archivo)' }]);
  const motor = crearMotor(proveedor, ctx, base);
  const salida = [];
  const efectos = { asesor: null, noContactar: false, ficha: {}, demo: null, seguimientoAutorizado: false };
  let catalogoEnviado = false;

  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const r = await motor.paso();
    for (const t of r.textos) salida.push({ tipo: 'texto', texto: t });
    const usos = r.usos.filter((u) => u.name);
    if (!usos.length) break;

    const resultados = usos.map((u) => {
      const i = u.input || {};
      let res = 'Hecho.';
      switch (u.name) {
        case 'enviar_catalogo':
          if (!catalogoEnviado) { salida.push({ tipo: 'catalogo' }); catalogoEnviado = true; res = 'Catálogo enviado (imagen y PDF).'; }
          else res = 'El catálogo ya se envió.';
          break;
        case 'registrar_datos_cliente':
          for (const [k, v] of Object.entries(i)) if (typeof v === 'string' && v.trim()) efectos.ficha[k] = v.trim();
          res = 'Datos guardados.';
          break;
        case 'solicitar_demo':
          efectos.demo = { servicio: i.servicio || '', negocio: i.negocio || '', detalles: i.detalles || '' };
          res = 'Solicitud de demo enviada al equipo. Dile al cliente que un asesor la prepara y se la envía por este chat, que es gratuita y temporal (dura los días indicados desde la entrega) y que para seguir usándola deberá contratar.';
          break;
        case 'autorizar_seguimiento':
          efectos.seguimientoAutorizado = true;
          res = 'Seguimiento autorizado.';
          break;
        case 'pasar_a_asesor':
          efectos.asesor = { motivo: i.motivo || 'cotizacion', resumen: i.resumen || '' };
          res = 'Asesor notificado. Dile al cliente que un asesor humano le escribe en horario de atención para continuar.';
          break;
        case 'no_contactar':
          efectos.noContactar = true;
          res = 'Registrado: no se le volverá a escribir.';
          break;
      }
      return { type: 'tool_result', tool_use_id: u.id, content: res };
    });
    motor.agregar(r.crudo, resultados);
  }

  if (!salida.some((s) => s.tipo === 'texto')) throw new Error('Ultron no generó respuesta');
  const respuestaTexto = salida.map((s) => (s.tipo === 'texto' ? s.texto : '[Se envió el catálogo: imagen y PDF]')).join('\n');
  return { salida, respuestaTexto, ...efectos };
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
  if (proveedorActivo() === 'huggingface') {
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

/** Comprueba una clave con una llamada mínima al proveedor indicado. */
async function probarClave(proveedor = 'claude') {
  if (proveedor === 'huggingface') {
    const r = await pedirHF({ max_tokens: 20, messages: [{ role: 'user', content: 'Responde solo: OK' }] });
    return !!r.choices?.length;
  }
  const r = await pedir({ max_tokens: 200, messages: [{ role: 'user', content: 'Responde solo: OK' }] });
  return r.content.some((b) => b.type === 'text');
}

module.exports = { conversar, mensajeProactivo, disponible, estadoClaves, guardarClave, probarClave, promptSistema, MODELO, MODELO_HF };
