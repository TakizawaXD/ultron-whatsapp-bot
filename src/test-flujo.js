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

console.log('✅ Todas las pruebas del flujo pasaron');
