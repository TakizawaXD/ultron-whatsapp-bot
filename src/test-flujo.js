// Prueba la conversación sin conectarse a WhatsApp: npm test
const assert = require('assert');
const { responder } = require('./flujo');

let s;
const paso = (txt) => { const r = responder(txt, s); s = { estado: r.estado }; return r; };

let r = paso('Hola, buenas');
assert.strictEqual(r.estado, 'menu'); assert.match(r.respuestas[0].texto, /1️⃣/); assert.match(r.respuestas[0].texto, /Soy \*Andrés\*/);
r = paso('1');
assert.strictEqual(r.estado, 'precios'); assert.ok(r.respuestas.some((x) => x.tipo === 'catalogo'));
r = paso('2');
assert.strictEqual(r.estado, 'servicio'); assert.match(r.respuestas[0].texto, /Tiendas online/); assert.match(r.respuestas[0].texto, /\$800\.000 COP/);
r = paso('2'); // vuelve a lista de precios
const nIA = require('../catalogo.json').findIndex((s) => s.adicional && /inteligencia artificial/i.test(s.nombre)) + 1;
r = paso(String(nIA));
assert.match(r.respuestas[0].texto, /inteligencia artificial[\s\S]*\$700\.000 COP/); assert.doesNotMatch(r.respuestas[0].texto, /Incluye/);
r = paso('2');
const nDatos = require('../catalogo.json').findIndex((s) => s.id === 'datos') + 1;
r = paso(String(nDatos));
assert.match(r.respuestas[0].texto, /Análisis de datos[\s\S]*\$700\.000 COP/);
r = paso('menu');
assert.doesNotMatch(r.respuestas[0].texto, /Bienvenido/);
r = paso('xyz');
assert.match(r.respuestas[0].texto, /No entendí/);
r = paso('3');
assert.strictEqual(r.estado, 'cotizacion');
r = paso('Necesito una web para mi restaurante, presupuesto 300');
assert.strictEqual(r.estado, 'cotizacion_enviada'); assert.strictEqual(r.pausar, true);
r = paso('menu');
assert.strictEqual(r.estado, 'menu');
r = paso('5');
assert.strictEqual(r.estado, 'humano'); assert.strictEqual(r.pausar, true);
r = paso('4');
assert.match(r.respuestas[0].texto, /Horario/);

r = paso('menu');
assert.match(r.respuestas[0].texto, /6️⃣ Demo gratis/);
r = paso('6');
assert.strictEqual(r.estado, 'demo'); assert.match(r.respuestas[0].texto, /Demo gratis de 7 días/);
r = paso('Panadería Ana, quiero ver una página web con el menú');
assert.strictEqual(r.estado, 'demo_solicitada'); assert.match(r.demo.negocio, /Panadería Ana/);

console.log('✅ Todas las pruebas del flujo pasaron');
