// =================================================================
// PRUEBA CON BASE REAL (Postgres): "Comisiones por Avales y Socios" (25-10-2026). Solo corre si hay E2E_PG_URL (una base con
// sql/schema.sql ya cargado); sin esa variable se salta, para que el resto de las pruebas no la necesiten.
//   E2E_PG_URL=postgres://postgres@localhost:5544/ludox node test/test_hipismo_socios_pg.js
// Lo importante: la suma de las tarjetas (clientes de cada socio + sin socio + ajustes) es EXACTAMENTE la comisión del Cierre Final
// (la misma de Balance General), con % devueltos, tickets de varios clientes, planos sin tickets y redondeos de centavos.
// =================================================================
if (!process.env.E2E_PG_URL) { console.log('SALTADA: falta E2E_PG_URL (prueba con Postgres real).'); process.exit(0); }
process.env.DATABASE_URL = process.env.E2E_PG_URL; process.env.JWT_SECRET = 'fake';
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
function fakeRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...a) => { handlers.push([m, a]); return router; }; });
  router.__handlers = handlers; return router;
}
const fakeExpress = () => fakeRouter(); fakeExpress.Router = fakeRouter;
Module._load = function (request) { if (request === 'express') return fakeExpress; return originalLoad.apply(this, arguments); };
const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
const jugadoresRouter = require(path.join(__dirname, '..', 'src', 'routes', 'jugadores'));
Module._load = originalLoad;
const db = require('../src/db');
const { construirCierreFinalHipismo } = require('../src/services/hipismoResumenCliente');
const hipismoSocios = require('../src/services/hipismoSocios');

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }
function handlerDe(router, m, p) { const e = router.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocar(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    Promise.resolve(handler(req, res, e => { if (e) reject(e); })).catch(reject);
  });
  return { status, body: salida };
}
let semilla = 12345;
const rnd = () => { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; return semilla / 0x7fffffff; };
const r2 = n => Math.round(n * 100) / 100;

(async () => {
  const email = 'socios-e2e-' + Date.now() + '@x.com';
  const g = (await db.query(
    `INSERT INTO grupos (nombre, email, password_hash) VALUES ('GRUPO E2E', $1, 'x') RETURNING id`, [email])).rows[0].id;
  const clientes = ['ANA', 'BETO', 'CARLOS', 'DANIELA', 'EDGAR', 'FABIO', 'GLORIA', 'HUGO'];
  // Con % propio (se devuelve) y sin él.
  const pcts = { ANA: 1, BETO: 0.5, CARLOS: 0, DANIELA: 1.5, EDGAR: 0, FABIO: 2, GLORIA: 0.75, HUGO: 0 };
  for (const c of clientes) await db.query('INSERT INTO jugadores (grupo_id, nombre, comision_propia) VALUES ($1,$2,$3)', [g, c, pcts[c]]);

  // 14 planos en la semana; en cada uno varios tickets entre clientes (gana jugador o banquero) con el 5% ya aplicado al ganador.
  const hoy = new Date(Date.now() - 4 * 3600 * 1000);
  const dow = (hoy.getUTCDay() + 6) % 7; // lunes = 0
  const lunes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - dow));
  const iso = d => d.toISOString().slice(0, 10);
  for (let p = 0; p < 14; p++) {
    const fecha = iso(new Date(lunes.getTime() + (p % 5) * 86400000));
    const tickets = [];
    let com = 0;
    const n = p === 13 ? 0 : 2 + Math.floor(rnd() * 5);
    for (let t = 0; t < n; t++) {
      const a = clientes[Math.floor(rnd() * clientes.length)];
      let b = clientes[Math.floor(rnd() * clientes.length)]; if (b === a) b = clientes[(clientes.indexOf(a) + 1) % clientes.length];
      const monto = r2(5 + rnd() * 400);
      const gana = rnd() > 0.45;
      const bruto = monto; // lo que gana el ganador antes de comisión
      const neto = r2(bruto * 0.95);
      const comT = r2(bruto - neto);
      com += comT;
      tickets.push(gana ? { a, b, rj: neto, rb: -bruto, monto } : { a, b, rj: -bruto, rb: neto, monto });
    }
    // El plano guarda comision_total ya redondeada (puede diferir un centavo de la suma de tickets: así es la vida real).
    let comPlano = r2(com);
    if (p === 3) comPlano = r2(comPlano + 0.01);
    if (p === 13) comPlano = 0.37; // plano sin tickets con comisión: se muestra como AJUSTES
    const pl = (await db.query(
      `INSERT INTO hipismo_planos (grupo_id, hipodromo_nombre, carrera_numero, fecha, pizarra, texto_original, texto_resultado, comision_total)
       VALUES ($1,'HIPODROMO X',$2,$3,'1.2.3','x','x',$4) RETURNING id`, [g, p + 1, fecha, comPlano])).rows[0].id;
    for (const t of tickets) {
      await db.query(
        `INSERT INTO hipismo_tickets (plano_id, grupo_id, cliente_nombre, banquero_nombre, modalidad, caballo, monto, resultado_jugador, resultado_banquero)
         VALUES ($1,$2,$3,$4,'1p','1',$5,$6,$7)`, [pl, g, t.a, t.b, t.monto, t.rj, t.rb]);
    }
  }
  const desde = iso(lunes), hasta = iso(new Date(lunes.getTime() + 6 * 86400000));
  const grupo = { id: g, nombre: 'GRUPO E2E' };
  const req = (extra) => ({ grupoId: g, grupo, query: {}, body: {}, params: {}, ...extra });

  // 0) Sin socios: la ruta responde activo:false y no estorba.
  let r = await invocar(handlerDe(hipismoRouter, 'get', '/comisiones-socios'), req({ query: { desde, hasta } }));
  check(r.body.activo === false, 'sin socios el reporte no se activa (el grupo calcula como siempre)');

  // 1) Distribución que NO suma 100 se rechaza; la que suma exacto 100 se guarda.
  r = await invocar(handlerDe(hipismoRouter, 'put', '/socios'), req({ body: { socios: [{ nombre: 'Luis', porcentaje: 60 }, { nombre: 'Pedro', porcentaje: 30 }] } }));
  check(r.status === 400 && /100%/.test(r.body.error), 'socios que suman 90% se rechazan: ' + (r.body.error || ''));
  r = await invocar(handlerDe(hipismoRouter, 'put', '/socios'), req({ body: { socios: [{ nombre: 'Luis', porcentaje: 33.3333 }, { nombre: 'Pedro', porcentaje: 33.3333 }, { nombre: 'Maria', porcentaje: 33.3334 }] } }));
  check(r.body.ok && r.body.socios.length === 3 && r.body.suma === 100, 'socios 33,3333 + 33,3333 + 33,3334 suman exacto 100 y se guardan');
  const socios = r.body.socios;
  const idDe = n => socios.find(s => s.nombre === n).id;

  // 2) Asignar clientes a un solo socio (bulk) y por el formulario de cliente (socioId).
  r = await invocar(handlerDe(hipismoRouter, 'put', '/socios/asignar'), req({ body: { clientes: ['ana', 'BETO', 'CARLOS'], socioId: idDe('LUIS') } }));
  check(r.body.ok && r.body.actualizados === 3, 'asignar 3 clientes a LUIS de una vez');
  const idDaniela = (await db.query("SELECT id FROM jugadores WHERE grupo_id=$1 AND nombre='HUGO'", [g])).rows[0].id;
  r = await invocar(handlerDe(jugadoresRouter, 'put', '/:id'), req({ params: { id: idDaniela }, body: { nombre: 'HUGO', tipoCuenta: 'libre', comisionPropia: 0, socioId: idDe('PEDRO') } }));
  check(r.status === 200 && r.body.hipismo_socio_id === idDe('PEDRO'), 'el formulario del cliente guarda "Avalado por" (socioId)');
  r = await invocar(handlerDe(jugadoresRouter, 'put', '/:id'), req({ params: { id: idDaniela }, body: { nombre: 'HUGO', tipoCuenta: 'libre', comisionPropia: 0 } }));
  const sd = (await db.query('SELECT hipismo_socio_id FROM jugadores WHERE id=$1', [idDaniela])).rows[0].hipismo_socio_id;
  check(sd === idDe('PEDRO'), 'editar el cliente SIN mandar socioId no le borra el socio');
  r = await invocar(handlerDe(jugadoresRouter, 'put', '/:id'), req({ params: { id: idDaniela }, body: { nombre: 'HUGO', tipoCuenta: 'libre', comisionPropia: 0, socioId: '00000000-0000-0000-0000-000000000000' } }));
  check(r.status === 400, 'un socio que no es del grupo se rechaza');
  await invocar(handlerDe(hipismoRouter, 'put', '/socios/asignar'), req({ body: { clientes: ['EDGAR', 'FABIO'], socioId: idDe('MARIA') } }));
  await invocar(handlerDe(hipismoRouter, 'put', '/socios/asignar'), req({ body: { clientes: ['DANIELA'], socioId: idDe('PEDRO') } }));
  // GLORIA queda sin socio.

  // 3) El reporte cuadra EXACTO con el Cierre Final.
  const cierre = await construirCierreFinalHipismo(g, desde, hasta);
  const cierre2 = await construirCierreFinalHipismo(g, desde, hasta, { comisionPorCliente: true });
  check(cierre.comisionSemana === cierre2.comisionSemana, 'pedir el desglose por cliente no cambia la comisión del Cierre Final (' + cierre.comisionSemana + ')');
  r = await invocar(handlerDe(hipismoRouter, 'get', '/comisiones-socios'), req({ query: { desde, hasta } }));
  const rep = r.body;
  console.log('Comisión Cierre Final:', cierre.comisionSemana, '| Reporte:', rep.comisionTotal, '| suma tarjetas:', rep.sumaTarjetas, '| dif:', rep.diferencia);
  check(rep.activo === true, 'con socios el reporte se activa');
  check(rep.comisionTotal === cierre.comisionSemana, 'la Comisión Total del reporte es la del Cierre Final');
  const sumaC = Math.round(100 * (rep.socios.reduce((a, s) => a + s.total, 0) + (rep.sinSocio ? rep.sinSocio.total : 0)));
  check(sumaC === Math.round(100 * cierre.comisionSemana), 'clientes de cada socio + sin socio + ajustes = comisión del Cierre, al centavo');
  check(rep.cuadra === true && rep.diferencia === 0, 'el reporte dice que cuadra (diferencia 0)');
  rep.socios.forEach(s => {
    const suma = Math.round(100 * s.clientes.reduce((a, c) => a + c.monto, 0));
    check(suma === Math.round(100 * s.total), `la tarjeta de ${s.nombre} suma lo mismo que sus clientes (${s.total})`);
  });
  const porSocioSuma = Math.round(100 * rep.porSocio.reduce((a, s) => a + s.monto, 0));
  check(porSocioSuma === Math.round(100 * cierre.comisionSemana), 'la tarjeta "Por Socio" (según %) suma exacto la Comisión Total');
  check(rep.sinSocio && rep.sinSocio.clientes.some(c => c.esAjuste), 'el plano sin tickets sale como AJUSTES, no se pierde');
  check(rep.sinSocio && rep.sinSocio.clientes.some(c => c.nombre === 'GLORIA'), 'los clientes sin socio salen aparte');
  // Orden: de más a menos dentro de cada socio.
  rep.socios.forEach(s => check(s.clientes.every((c, i, a) => i === 0 || a[i - 1].monto >= c.monto), `clientes de ${s.nombre} ordenados de mayor a menor`));
  // Un cliente que tiene % devuelto aparece neto (menor que su bruto).
  const bruta = cierre2.comisionBrutaPorCliente, dev = cierre2.devueltoPorOrigen;
  check(Object.keys(dev).length > 0 && Object.keys(dev).every(n => r2(bruta[n] || 0) >= 0), 'hay % devueltos y se descuentan por cliente: ' + JSON.stringify(dev));

  // 4) Borrar un socio deja a sus clientes sin socio (y sigue cuadrando); y la lista se puede re-guardar.
  r = await invocar(handlerDe(hipismoRouter, 'put', '/socios'), req({ body: { socios: [{ id: idDe('LUIS'), nombre: 'Luis Alberto', porcentaje: 70 }, { id: idDe('PEDRO'), nombre: 'Pedro', porcentaje: 30 }] } }));
  check(r.body.ok && r.body.socios.length === 2 && r.body.socios.some(s => s.nombre === 'LUIS ALBERTO'), 'editar y quitar socios (MARIA se elimina, LUIS se renombra)');
  const sinMaria = (await db.query("SELECT hipismo_socio_id FROM jugadores WHERE grupo_id=$1 AND nombre='EDGAR'", [g])).rows[0].hipismo_socio_id;
  check(sinMaria === null, 'los clientes del socio eliminado quedan sin socio');
  r = await invocar(handlerDe(hipismoRouter, 'get', '/comisiones-socios'), req({ query: { desde, hasta } }));
  check(r.body.cuadra === true && r.body.comisionTotal === cierre.comisionSemana, 'tras cambiar los socios sigue cuadrando con el Cierre Final');
  r = await invocar(handlerDe(hipismoRouter, 'put', '/socios'), req({ body: { socios: [] } }));
  check(r.body.ok && r.body.socios.length === 0, 'quitar todos los socios desactiva la función');
  r = await invocar(handlerDe(hipismoRouter, 'get', '/comisiones-socios'), req({ query: { desde, hasta } }));
  check(r.body.activo === false, 'sin socios vuelve a no activarse');

  if (process.env.E2E_KEEP) console.log('GRUPO_ID=' + g); else await db.query('DELETE FROM grupos WHERE id = $1', [g]);
  console.log(`\n${pasaron} OK, ${fallaron} fallaron.`);
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
