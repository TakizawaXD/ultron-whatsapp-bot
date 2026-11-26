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
  const lista = catalogo.map((s) => `- ${s.nombre}: desde ${precio(s.precioDesde, config.moneda)}${s.tiempo ? `, ${s.tiempo}` : ''}`).join('\n');
  return `Eres ${nombre}, asesor comercial de ${config.negocio} por WhatsApp. Hablas como un vendedor real: natural, cálido, seguro y con energía. Respondes en español, tuteando, en mensajes cortos (2 a 4 líneas). Nunca suenas a robot.

Tu meta es vender: descubre qué necesita el cliente con preguntas, recomienda UN servicio con su beneficio y precio "desde", resuelve dudas y termina siempre con una pregunta que lleve al siguiente paso. Si duda por el precio, ofrece empezar por algo sencillo, el pago (${v.pagos || '50% de anticipo y 50% al entregar'}) o una demo gratis de ${dias} días (temporal; luego debe contratar). Respeta un "no" definitivo.

Reglas: usa solo estos precios y servicios. No inventes descuentos, promociones, fechas límite, testimonios ni garantías.${promo ? ` Promoción vigente: ${promo}.` : ''}${Number(v.descuentoMaximo) ? ` Solo como último recurso puedes decir que pedirás un descuento de hasta ${v.descuentoMaximo}% que confirma el asesor.` : ''} No pidas pagos ni datos bancarios. Si te preguntan si eres una persona, di que eres el asesor virtual de ${marca}.

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
- Si no sabe qué necesita, recuérdale que puede escribir *menu* para ver las opciones del 1 al 6.

Ejemplo de conversación:
Cliente: Hola
${nombre}: ¡Hola! 👋 Soy ${nombre}, de ${marca}. Ayudo a negocios a vender más con páginas web, tiendas online y chatbots. Cuéntame, ¿qué negocio tienes o qué proyecto tienes en mente?
Cliente: Tengo una panadería, cuánto cuesta una página web? no tengo mucha plata
${nombre}: ¡Buenísimo! Una web le da a tu panadería más clientes y pedidos por WhatsApp. Las páginas están desde *$400.000 COP* y se pagan 50% al iniciar y 50% al entregar. Y si quieres verla antes de invertir, te preparamos una *demo gratis de ${dias} días*. ¿Te la armamos?
Cliente: lo voy a pensar
${nombre}: ¡Claro! ¿Qué es lo que más te hace dudar: el precio o cómo quedaría? Con la demo gratis sales de dudas sin pagar nada. ¿Cómo se llama tu panadería para empezarla?`;
}

// Conversación con el modelo local (node-llama-cpp)
async function conversarLocal(base, ctx) {
  const salida = [];
  const est = { salida, efectos: { asesor: null, noContactar: false, ficha: {}, demo: null, seguimientoAutorizado: false }, catalogoEnviado: false };
  const historial = base.slice(0, -1).slice(-4);
  const contexto = textoContexto(ctx).replace(/^# Contexto de este cliente\n/, '');
  const ultimo = base[base.length - 1].content;
  const exactos = datosDeServicios(ultimo);
  const internos = [
    contexto && `Contexto: ${contexto.replace(/\n/g, ' | ')}`,
    exactos.length && `Datos EXACTOS de lo que pregunta (cítalos tal cual, no cambies precios ni tiempos): ${exactos.join(' || ')}`,
  ].filter(Boolean);
  const texto = internos.length ? `[Información interna, no la menciones como tal: ${internos.join(' — ')}]\n${ultimo}` : ultimo;
  // Sin herramientas: el modelo pequeño casi no las usa y alargan cada consulta.
  // Las intenciones importantes se detectan con frases clave (más rápido y más fiable).
  detectarIntenciones(ultimo, historial, ctx, est);
  const { config } = cargarDatos();
  // Preguntas sobre tecnologías: el modelo pequeño tiende a inventar ("sí, trabajamos con X").
  // Si no están configuradas en config.tecnologias, se responde al instante con un texto fijo y honesto.
  const tNorm = String(ultimo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!(config.tecnologias || '').trim() && /\b(react|node|python|php|laravel|wordpress|flutter|kotlin|swift|java|angular|vue|django|next|tecnologia|tecnologias|lenguaje|lenguajes|framework|stack)\b/.test(tNorm)) {
    salida.push({ tipo: 'texto', texto: 'Trabajamos con tecnologías modernas y elegimos la más adecuada según lo que necesita tu proyecto. El asesor te confirma el detalle técnico. ¿Qué proyecto tienes en mente para recomendarte la mejor opción?' });
    return est;
  }
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
  web: /pagina(s)? web|sitio web|\bweb\b|pagina para mi/,
  tienda: /tienda|e-?commerce|vender (en linea|por internet|online)|carrito/,
  app: /\bapps?\b|aplicaci|movil|android|\bios\b|play ?store/,
  sistema: /sistema|inventario|facturaci|software|crm|erp|punto de venta/,
  bot: /chat ?bot|\bbots?\b|asistente virtual/,
  whatsapp: /whats ?app/,
  soporte: /mantenimiento|soporte|arreglar|se (me )?dano|actualizar mi/,
  datos: /dato|dashboard|excel|reporte|analisis|power ?bi|kpi|estadistica/,
  dashboard: /dashboard|tiempo real/,
  reportes: /reporte|extraer|extraccion/,
  landing: /landing|una sola pagina|pagina de (aterrizaje|venta)/,
  uxui: /diseno|\bux\b|\bui\b|figma|prototipo/,
  seo: /\bseo\b|google|posicionamiento|aparecer en/,
  hosting: /dominio|hosting|correo(s)? (corporativo|empresarial|con mi)|\.com/,
  migracion: /migra|moderniz|sistema (viejo|antiguo)/,
  consultoria: /consultor|capacitaci|asesoria|ensen/,
  api: /\bapis?\b|backend|integrar/,
  automatizaciones: /automatiz|tareas repetitivas/,
  ia: /inteligencia artificial|\bia\b|\bai\b/,
  pagos: /pagos? en linea|pasarela|recibir pagos|tarjeta/,
  marketing: /marketing|publicidad|campana|correos? masivo/,
};

// Datos exactos de los servicios que el cliente menciona (para que la IA no se equivoque de precio)
function datosDeServicios(texto) {
  const { config, catalogo } = cargarDatos();
  const t = ` ${String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;
  const hallados = catalogo.filter((s) => {
    const rx = PALABRAS_SERVICIO[s.id] || PALABRAS_SERVICIO[s.id.replace(/-\d+$/, '')];
    if (rx?.test(t)) return true;
    return s.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\W+/).some((w) => w.length > 5 && t.includes(w));
  }).slice(0, 3);
  // Lo que incluye solo se agrega si lo pregunta (menos texto = respuesta más rápida)
  const pideDetalle = /incluye|trae|tiene|detalle|que hacen|que ofrece|caracteristic/.test(t);
  return hallados.map((s) => `${s.nombre}: desde ${precio(s.precioDesde, config.moneda)}${s.tiempo ? `, tiempo ${s.tiempo}` : ''}${pideDetalle && s.incluye?.length ? `, incluye ${s.incluye.join('; ')}` : ''}`);
}

// Frases clave del cliente → avisos y registros (para el motor local)
function detectarIntenciones(texto, historial, ctx, est) {
  const t = ` ${String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;
  const ultimoBot = String([...historial].reverse().find((h) => h.role === 'assistant')?.content || '').toLowerCase();
  if (/(no me interesa|no me escrib|no me molest|deja de escribir|no quiero (nada|mas mensajes))/.test(t)) {
    est.efectos.noContactar = true;
    return;
  }
  if (/(hablar|comunicar|atender).{0,20}(persona|humano|asesor|andres|alguien)|eres (un )?(bot|robot|maquina)/.test(t)) {
    if (!/eres (un )?(bot|robot|maquina)/.test(t)) est.efectos.asesor = { motivo: 'pide_humano', resumen: `Pidió hablar con una persona: "${texto}"` };
  }
  if (/(quiero|deseo|vamos a|me gustaria|listo para) (contratar|comprar|empezar|arrancar|iniciar|hacerlo)|como (te )?pago|donde (te )?pago|me interesa contratar|cerremos|hagamoslo/.test(t)) {
    est.efectos.asesor = { motivo: 'quiere_contratar', resumen: `Quiere contratar: "${texto}"` };
  }
  if (/(descuento|rebaja|mas barato)/.test(t) && !est.efectos.asesor) {
    est.efectos.asesor = { motivo: 'descuento_solicitado', resumen: `Pregunta por descuento: "${texto}"` };
  }
  const aceptaDemo = /demo/.test(ultimoBot) && /^ (si|sii|dale|ok|okay|listo|claro|de una|perfecto|bueno|me parece|hagamoslo|armala|quiero la demo)/.test(t);
  if ((aceptaDemo || /quiero (la|una) demo|(armen|hagan|preparen)(me)? (la|una) demo/.test(t)) && ctx.demo?.estado !== 'solicitada') {
    est.efectos.demo = { servicio: ctx.ficha?.servicio || 'por confirmar', negocio: ctx.ficha?.negocio || 'por confirmar', detalles: `Aceptó la demo con: "${texto}"` };
  }
  if (/(lo pienso|lo voy a pensar|despues te (escribo|aviso)|mas adelante|otro dia)/.test(t) && /(te escribo|escribirte|te contacto)/.test(ultimoBot)) {
    est.efectos.seguimientoAutorizado = true;
  }
  const correo = String(texto).match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (correo) est.efectos.ficha.email = correo[0];
}

async function conversar(historial, texto, ctx = {}) {
  const proveedor = proveedorActivo();
  if (!proveedor) throw new Error('El motor está en "menú clásico"');
  const base = normalizarHistorial([...historial, { role: 'user', content: texto || '(mensaje sin texto: imagen, audio o archivo)' }]);
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

module.exports = { conversar, mensajeProactivo, calentarLocal, disponible, estadoClaves, guardarClave, probarClave, promptSistema, MODELO, MODELO_HF };
