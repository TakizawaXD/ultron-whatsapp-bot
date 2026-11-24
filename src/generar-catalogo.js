// Genera output/catalogo.html, output/catalogo.png y output/catalogo.pdf a partir de catalogo.json + config.json
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { cargarDatos, precio, RAIZ } = require('./flujo');
const { rutaNavegador } = require('./navegador');

const SALIDA = path.join(RAIZ, 'output');
const LOGO = path.join(RAIZ, 'assets', 'logo.webp');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function logoDataUri() {
  if (!fs.existsSync(LOGO)) return null;
  const tipo = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[path.extname(LOGO)] || 'image/webp';
  return `data:${tipo};base64,${fs.readFileSync(LOGO).toString('base64')}`;
}

function html({ config, catalogo }) {
  const principales = catalogo.filter((s) => !s.adicional);
  const adicionales = catalogo.filter((s) => s.adicional);
  const [num, moneda] = [(n) => precio(n, '').trim(), config.moneda];
  const tarjetas = principales.map((s) => `
    <article class="card">
      <h2>${esc(s.nombre)}</h2>
      ${s.descripcion ? `<p class="desc">${esc(s.descripcion)}</p>` : ''}
      <ul>${(s.incluye || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="pie">
        <span class="precio"><small>desde</small> ${esc(num(s.precioDesde))} <small>${esc(moneda)}</small></span>
        ${s.tiempo ? `<span class="tiempo">⏱ ${esc(s.tiempo)}</span>` : ''}
      </div>
    </article>`).join('');
  const extras = adicionales.length ? `
    <section class="extras">
      <h3>Servicios adicionales</h3>
      <div class="extras-grid">${adicionales.map((s) => `
        <div class="extra"><span>${esc(s.nombre)}</span><b><small>desde</small> ${esc(num(s.precioDesde))} <small>${esc(moneda)}</small></b></div>`).join('')}
      </div>
    </section>` : '';
  const c = config.contacto || {};
  const logo = logoDataUri();
  const limpiar = (u) => String(u).replace(/^https?:\/\//, '');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Catálogo · ${esc(config.negocio)}</title>
<style>
  :root{--azul:#00AEEF;--cian:#00E5FF;--fondo:#05070B;--card:#0B1220;--borde:#16263d;--texto:#FFFFFF;--suave:#9fb3c8;--tenue:#5d7189}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;color:var(--texto);width:1080px;padding:56px;
    background:radial-gradient(900px 500px at 85% -5%,rgba(0,174,239,.18),transparent 60%),radial-gradient(700px 400px at -10% 105%,rgba(0,229,255,.10),transparent 60%),var(--fondo)}
  header{display:flex;align-items:center;gap:36px;margin-bottom:44px;padding-bottom:36px;border-bottom:1px solid var(--borde)}
  header img{width:210px;height:210px;border-radius:24px;box-shadow:0 0 0 1px rgba(0,229,255,.25),0 0 60px rgba(0,174,239,.25)}
  .kicker{font-size:15px;letter-spacing:.35em;text-transform:uppercase;color:var(--cian);font-weight:600}
  header h1{font-size:40px;line-height:1.15;margin:10px 0 12px;letter-spacing:-.3px}
  header p{font-size:21px;color:var(--suave)}
  header p b{color:var(--cian);font-weight:600}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  .card{background:linear-gradient(180deg,rgba(0,174,239,.07),rgba(0,174,239,0) 40%),var(--card);border:1px solid var(--borde);border-top:2px solid var(--azul);border-radius:16px;padding:26px 28px;display:flex;flex-direction:column;break-inside:avoid}
  .card h2{font-size:24px;margin-bottom:8px}
  .desc{font-size:15.5px;line-height:1.5;color:var(--suave);margin-bottom:14px}
  ul{list-style:none;margin-bottom:18px;flex:1}
  li{font-size:15px;color:#d5e2ee;padding:3px 0 3px 22px;position:relative}
  li::before{content:'';position:absolute;left:2px;top:11px;width:8px;height:8px;border-radius:2px;background:var(--cian);box-shadow:0 0 8px var(--cian)}
  .pie{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--borde);padding-top:14px;gap:12px}
  .precio{font-size:27px;font-weight:700;color:var(--azul);font-variant-numeric:tabular-nums;white-space:nowrap}
  .precio small{font-size:13px;font-weight:500;color:var(--suave)}
  .tiempo{font-size:13.5px;color:var(--cian);border:1px solid rgba(0,229,255,.3);padding:4px 12px;border-radius:999px;white-space:nowrap}
  .extras{margin-top:28px;border:1px solid var(--borde);border-radius:16px;padding:24px 28px;background:var(--card)}
  .extras h3{font-size:14px;letter-spacing:.25em;text-transform:uppercase;color:var(--cian);margin-bottom:14px}
  .extras-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 36px}
  .extra{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:10px 0;border-bottom:1px dashed var(--borde);font-size:17px}
  .extra b{color:var(--azul);font-size:19px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .extra small{font-size:12px;font-weight:500;color:var(--suave)}
  footer{margin-top:36px;display:flex;gap:14px 30px;flex-wrap:wrap;font-size:16px;color:var(--suave)}
  footer b{color:var(--texto);font-weight:600}
  .nota{margin-top:16px;font-size:13.5px;color:var(--tenue)}
</style></head><body>
<header>
  ${logo ? `<img src="${logo}" alt="${esc(config.marca || '')}">` : ''}
  <div>
    <div class="kicker">Catálogo de servicios</div>
    <h1>${esc(config.negocio)}</h1>
    <p>${esc(config.eslogan || '')}</p>
  </div>
</header>
<section class="grid">${tarjetas}</section>
${extras}
<footer>
  <span><b>Horario:</b> ${esc(config.horario)}</span>
  ${c.email ? `<span><b>Email:</b> ${esc(c.email)}</span>` : ''}
  ${c.web ? `<span><b>Portafolio:</b> ${esc(limpiar(c.web))}</span>` : ''}
  ${c.github ? `<span><b>GitHub:</b> ${esc(limpiar(c.github))}</span>` : ''}
  ${c.linkedin ? `<span><b>LinkedIn:</b> ${esc(limpiar(c.linkedin))}</span>` : ''}
</footer>
<p class="nota">Precios de referencia en ${esc(moneda)}. El valor final depende del alcance de cada proyecto.</p>
</body></html>`;
}

async function generarCatalogo() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const archivoHtml = path.join(SALIDA, 'catalogo.html');
  fs.writeFileSync(archivoHtml, html(cargarDatos()), 'utf8');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: rutaNavegador(),
    userDataDir: path.join(RAIZ, '.chrome-catalogo'), // perfil en esta carpeta, no en el disco C:
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 800, deviceScaleFactor: 1 });
    await page.goto('file://' + archivoHtml.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.screenshot({ path: path.join(SALIDA, 'catalogo.png'), fullPage: true });
    await page.emulateMediaType('screen');
    await page.pdf({ path: path.join(SALIDA, 'catalogo.pdf'), width: '1080px', printBackground: true,
      height: (await page.evaluate(() => document.body.scrollHeight)) + 'px' });
  } finally {
    await browser.close();
  }
  return { png: path.join(SALIDA, 'catalogo.png'), pdf: path.join(SALIDA, 'catalogo.pdf') };
}

module.exports = { generarCatalogo };

if (require.main === module) {
  generarCatalogo()
    .then((r) => console.log('✅ Catálogo generado:\n  ' + r.png + '\n  ' + r.pdf))
    .catch((e) => { console.error('❌ Error generando catálogo:', e); process.exit(1); });
}
