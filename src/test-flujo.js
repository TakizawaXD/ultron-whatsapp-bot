// Prueba la conversación sin conectarse a WhatsApp: npm test
const assert = require('assert');
const { responder } = require('./flujo');
const catalogo = require('../catalogo.json');
const config = require('../config.json');

let s;
const paso = (txt) => { const r = responder(txt, s); s = { estado: r.estado }; return r; };

// Bienvenida + menú de 7 opciones
let r = paso('Hola, buenas');
assert.strictEqual(r.estado, 'menu');
assert.match(r.respuestas[0].texto, /Soy|Te saluda \*Andrés\*/);
for (let n = 1; n <= 7; n++) assert.match(r.respuestas[0].texto, new RegExp(`${n}️⃣`));

// 1: catálogo (imagen + PDF) y lista
r = paso('1');
assert.strictEqual(r.estado, 'precios'); assert.ok(r.respuestas.some((x) => x.tipo === 'catalogo'));

// Dentro de la lista, un número abre ese servicio (2 = Tiendas virtuales)
r = paso('2');
assert.strictEqual(r.estado, 'servicio'); assert.match(r.respuestas[0].texto, /Tiendas virtuales/);

// 2: servicios y precios → detalle de cada servicio (todos los del catálogo)
r = paso('menu');
r = paso('2');
assert.strictEqual(r.estado, 'precios');
assert.match(r.respuestas[0].texto, new RegExp(`1 al ${catalogo.length}`));
for (const [i, sv] of catalogo.entries()) {
  s = { estado: 'precios' };
  r = paso(String(i + 1));
  assert.strictEqual(r.estado, 'servicio', `servicio ${i + 1}`);
  assert.ok(r.respuestas[0].texto.includes(sv.nombre), `nombre del servicio ${i + 1}`);
}
s = { estado: 'precios' };
r = paso('2');
assert.match(r.respuestas[0].texto, /Tiendas virtuales/); assert.match(r.respuestas[0].texto, /\$800\.000 COP/);
r = paso('menu');
assert.doesNotMatch(r.respuestas[0].texto, /Te saluda/); // el saludo completo solo va la primera vez
r = paso('xyz');
assert.match(r.respuestas[0].texto, /No entendí/); assert.match(r.respuestas[0].texto, /1 al 7/);

// 3: cotización
r = paso('3');
assert.strictEqual(r.estado, 'cotizacion');
r = paso('Necesito una web para mi restaurante, presupuesto 300');
assert.strictEqual(r.estado, 'cotizacion_enviada'); assert.strictEqual(r.pausar, true);

// 4: formas de pago (las 4 de config.json) + demo
r = paso('menu');
r = paso('4');
for (const f of config.formasPago) assert.ok(r.respuestas[0].texto.includes(f.nombre), `forma de pago ${f.nombre}`);
assert.match(r.respuestas[0].texto, /demo gratis de 7 días/);

// 5: asesor
r = paso('5');
assert.strictEqual(r.estado, 'humano'); assert.strictEqual(r.pausar, true);

// 7: horario y contacto
r = paso('menu');
r = paso('7');
assert.match(r.respuestas[0].texto, /Horario/);

// 6: demo gratis
r = paso('menu');
assert.match(r.respuestas[0].texto, /Demo gratis de 7 días/);
r = paso('6');
assert.strictEqual(r.estado, 'demo'); assert.match(r.respuestas[0].texto, /Demo gratis de 7 días/);
r = paso('Panadería Ana, quiero ver una página web con el menú');
assert.strictEqual(r.estado, 'demo_solicitada'); assert.match(r.demo.negocio, /Panadería Ana/);

// Parte 1: ficha inicial (sin IA)
const { fichaInicial } = require('./flujo');
let f = fichaInicial([]);
assert.match(f, /Lo que hacemos/); assert.match(f, /\$400\.000 COP/); assert.match(f, /demo gratis de 7 días/);
assert.match(f, /Pregúntame/); // con IA invita a conversar
assert.match(f, /Chatbots[^\n]*\$600\.000 COP/); // el "desde" de cada grupo es el precio real más bajo del grupo
assert.match(fichaInicial([], { conIA: false }), /\*menu\*/); // sin IA invita al menú
f = fichaInicial([catalogo.find((x) => x.id === 'tienda')]);
assert.match(f, /Tiendas virtuales/); assert.match(f, /\$800\.000 COP/); assert.match(f, /Carrito de compras/);
assert.doesNotMatch(fichaInicial([catalogo[0]], { saludo: false }), /Hola/);

// Respuestas rápidas (sin IA) y control de lo que escribe la IA
const ultron = require('./ultron');
const rapida = (texto, historial = []) => ultron.respuestaRapida(texto, historial, { conIA: true })?.salida.at(-1).texto;
assert.match(rapida('cuánto cuestan sus servicios?'), /Lo que hacemos/);
assert.match(rapida('y una tienda virtual?'), /Tiendas virtuales/);
assert.match(rapida('y cuánto vale?', [{ role: 'user', content: 'quiero un sistema de inventario' }]), /Sistemas de inventario/);
assert.match(rapida('qué formas de pago tienen?'), /Por etapas/);
assert.match(rapida('Hola?'), /Hola de nuevo/);
assert.match(rapida('quiero hablar con una persona'), /asesor/);
assert.strictEqual(rapida('tengo una tienda de ropa y vendo por instagram, me sirve para manejar tallas y colores?'), undefined); // → IA
const revisar = (iaTexto, cliente = '') => ultron.revisarRespuestaIA([{ tipo: 'texto', texto: iaTexto }], cliente, []);
assert.ok(revisar('La web te cuesta $350.000 COP.').motivo, 'precio inventado');
assert.ok(revisar('Te doy un 20% de descuento.').motivo, 'descuento inventado');
assert.strictEqual(revisar('Las páginas web están desde *$400.000 COP*.').motivo, null);
assert.strictEqual(revisar('La tienda sale desde 800 mil. Paga 50% al iniciar.').motivo, null);
assert.strictEqual(revisar('Con tus 2 millones arrancamos.', 'tengo 2 millones').motivo, null);
assert.strictEqual(revisar('Incluye diseño. También el formul').salida[0].texto, 'Incluye diseño.');

console.log('✅ Todas las pruebas del flujo pasaron');
