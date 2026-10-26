// =================================================================
// PRUEBA (26-10-2026): alerta "POCO POZO" -- a pedido del usuario: "cuando un cliente tenga poco pozo, así sea pago diario o
// avalado, debes generar alertas" (el pozo es el saldo con el que el cliente puede jugar). Se avisa en Administración > Alertas
// (hipismo_alertas, tipo POZO_BAJO) y en pantalla al cargar un plano / jugada.
//   - Solo clientes CON pozo: avalados y pago diario con pozo (tipo 'avalado' + marca pago_diario). Libres y pago diario sin pozo no.
//   - "Poco" = lo que queda disponible < 15% del pozo colocado; sin nada = "SIN POZO".
//   - Los que se pasaron en la misma carga (APUESTA_SOBRE_POZO) no se duplican.
//   - El mismo aviso no se repite en la lista de alertas (24 h), pero sí se devuelve para la pantalla.
//   - Un error al revisar nunca impide guardar.
// =================================================================
const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalLoad = Module._load;

const GRUPO_ID = 'g-pozo-bajo';
let pozos = {};        // nombre -> { inicial, disponible }
let jugadoresDB = [];
let escrituras = [];
let yaAvisado = false;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    if (!jugadoresDB) throw new Error('base caída');
    return { rows: jugadoresDB.filter(j => params[1].includes(j.nombre) && j.tipo_cuenta === 'avalado' && !j.es_cuenta_comision) };
  }
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) return { rows: (params[1] || []).map(nombre => ({ nombre })) };
  if (/^SELECT 1 FROM hipismo_alertas/i.test(sql)) return { rows: yaAvisado ? [{ '?column?': 1 }] : [] };
  if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) { escrituras.push({ sql, params }); return { rows: [{ id: 'x1' }] }; }
  return { rows: [] };
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...args) => { handlers.push([m, args]); return router; }; });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'h', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({ grupoId: GRUPO_ID }) };
  if (request === './pozo') return { calcularPozoJugador: async (g, j) => ({ pozoInicial: pozos[j.nombre].inicial, pozoDisponible: pozos[j.nombre].disponible }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';
const alertaPozo = require(path.join(__dirname, '..', 'src', 'services', 'hipismoAlertaPozo'));
const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocarRuta(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e.message));
  return { salida, status };
}
let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }
const jug = (nombre, extra) => ({ id: 'j-' + nombre, grupo_id: GRUPO_ID, nombre, tipo_cuenta: 'avalado', pago_diario: false, es_cuenta_comision: false, ...extra });

(async function main() {
  // ---------- 1) detectarPozoBajo ----------
  jugadoresDB = [jug('ANA'), jug('LUIS'), jug('PEDRO', { pago_diario: true }), jug('LIBRE1', { tipo_cuenta: 'libre' }), jug('DIARIO', { tipo_cuenta: 'libre', pago_diario: true }),
    jug('ANA - PORCENTAJE', { es_cuenta_comision: true }), jug('RAYA')];
  pozos = {
    ANA: { inicial: 1000, disponible: 100 },        // 10% -> bajo
    LUIS: { inicial: 1000, disponible: 150 },       // 15% justo -> NO es bajo (hay que bajar de 15)
    PEDRO: { inicial: 500, disponible: 50 },        // pago diario con pozo, 10% -> bajo
    LIBRE1: { inicial: 0, disponible: 0 }, DIARIO: { inicial: 0, disponible: 0 },
    'ANA - PORCENTAJE': { inicial: 0, disponible: 0 },
    RAYA: { inicial: 1000, disponible: -20 }        // sin pozo
  };
  let r = await alertaPozo.detectarPozoBajo(GRUPO_ID, ['ANA', 'LUIS', 'PEDRO', 'LIBRE1', 'DIARIO', 'ANA - PORCENTAJE', 'RAYA']);
  const por = n => r.find(x => x.nombre === n);
  check(!!por('ANA') && por('ANA').porcentaje === 10 && !por('ANA').agotado && por('ANA').pozoDisponible === 100 && por('ANA').pozoInicial === 1000, '1a) AVALADO con 10% de su pozo -> alerta de poco pozo');
  check(!por('LUIS'), '1b) con 15% justo todavía no avisa (avisa por debajo del 15%)');
  check(!!por('PEDRO') && por('PEDRO').pagoDiario === true, '1c) PAGO DIARIO con pozo también avisa (y se marca como pago diario)');
  check(!por('LIBRE1') && !por('DIARIO') && !por('ANA - PORCENTAJE'), '1d) libres, pago diario SIN pozo y cuentas de comisión no avisan');
  check(!!por('RAYA') && por('RAYA').agotado === true && por('RAYA').porcentaje === 0, '1e) pozo agotado/negativo -> "sin pozo"');
  r = await alertaPozo.detectarPozoBajo(GRUPO_ID, ['ANA', 'PEDRO'], { excluir: ['ANA'] });
  check(r.length === 1 && r[0].nombre === 'PEDRO', '1f) los excluidos (ya alertados por pasarse) no se duplican');
  r = await alertaPozo.detectarPozoBajo(GRUPO_ID, []);
  check(r.length === 0, '1g) sin clientes no consulta nada');
  const m1 = alertaPozo.mensajePozoBajo({ nombre: 'PEDRO', pagoDiario: true, pozoInicial: 500, pozoDisponible: 50, porcentaje: 10, agotado: false }, 'Belmont carrera 3');
  const m2 = alertaPozo.mensajePozoBajo({ nombre: 'RAYA', pagoDiario: false, pozoInicial: 1000, pozoDisponible: -20, porcentaje: 0, agotado: true }, '');
  check(/PEDRO \(pago diario\) tiene POCO POZO/.test(m1) && /Belmont carrera 3/.test(m1) && /10%/.test(m1), `1h) mensaje poco pozo legible: "${m1}"`);
  check(/RAYA se quedó SIN POZO/.test(m2) && /le quedan 0,00/.test(m2), `1i) mensaje sin pozo legible: "${m2}"`);

  // ---------- 2) ruta POST /tercios-adelantadas ----------
  const base = { grupoId: GRUPO_ID, grupo: { id: GRUPO_ID, nombre: 'Largavita' }, nombreActor: 'Largavita', params: {}, query: {} };
  const texto = '*JUGADAS ADELANTADAS LA RINCONADA*\n\n*1RA CARRERA*\n\n*ANA 2x7 50 DA LUIS*\n*PEDRO 2x5 20 DA LUIS*';
  pozos = { ANA: { inicial: 1000, disponible: 100 }, PEDRO: { inicial: 500, disponible: 50 } };
  escrituras = []; yaAvisado = false;
  const body = { texto, hipodromoNombre: 'La Rinconada', fecha: '2026-10-26' };
  let rr = await invocarRuta(handlerDe('post', '/tercios-adelantadas'), { ...base, body });
  check(rr.status === 201, `2a) la carga se guarda (status ${rr.status} ${JSON.stringify(rr.salida && rr.salida.error || '')})`);
  if (rr.status === 201) {
    const alertas = escrituras.filter(e => /INSERT INTO hipismo_alertas/i.test(e.sql) && e.params[1] === 'POZO_BAJO');
    check(Array.isArray(rr.salida.pozoBajo) && rr.salida.pozoBajo.length === 2, '2b) la respuesta trae pozoBajo con los 2 clientes (para el aviso en pantalla)');
    check(alertas.length === 2 && alertas.every(a => /POCO POZO/.test(a.params[6])), '2c) deja 2 alertas POZO_BAJO en Administración > Alertas');
    check(alertas.some(a => /PEDRO \(pago diario\)/.test(a.params[6])), '2d) el pago diario con pozo también queda alertado');
    // mismo aviso otra vez: pantalla sí, lista no
    escrituras = []; yaAvisado = true;
    rr = await invocarRuta(handlerDe('post', '/tercios-adelantadas'), { ...base, body });
    check(rr.salida.pozoBajo.length === 2 && escrituras.filter(e => /INSERT INTO hipismo_alertas/i.test(e.sql) && e.params[1] === 'POZO_BAJO').length === 0, '2e) el mismo aviso repetido no llena la lista de alertas, pero igual sale en pantalla');
  }
  // si el que se pasa ya tiene su alerta APUESTA_SOBRE_POZO no se duplica con POZO_BAJO
  pozos = { ANA: { inicial: 1000, disponible: 5 }, PEDRO: { inicial: 500, disponible: 400 } };
  escrituras = []; yaAvisado = false;
  rr = await invocarRuta(handlerDe('post', '/tercios-adelantadas'), { ...base, body });
  const tipos = escrituras.filter(e => /INSERT INTO hipismo_alertas/i.test(e.sql)).map(e => e.params[1]);
  check(tipos.length === 1 && tipos[0] === 'APUESTA_SOBRE_POZO' && rr.salida.pozoBajo.length === 0, `2f) quien se pasó solo tiene su alerta de "apostó más" (tipos: ${tipos.join(',')})`);
  // si la revisión falla, el plano igual se guarda
  const viejo = jugadoresDB; jugadoresDB = null; escrituras = [];
  rr = await invocarRuta(handlerDe('post', '/tercios-adelantadas'), { ...base, body });
  jugadoresDB = viejo;
  check(rr.status === 201 && rr.salida.pozoBajo.length === 0, '2g) si falla la revisión, el plano se guarda igual (sin alertas)');

  // ---------- 3) pantalla + SQL ----------
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  check((html.match(/mostrarAvisoPozo\(data\.alertasPozo, data\.pozoBajo\)/g) || []).length === 3, '3a) los 3 lugares donde se carga un plano/jugada muestran también el aviso de poco pozo');
  check(/POZO_BAJO: '🪙 Poco pozo'/.test(html), '3b) la pestaña Alertas sabe nombrar el tipo POZO_BAJO');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  check(/'CUADRE_DESCUADRADO','POZO_BAJO'/.test(sql), '3c) el check de hipismo_alertas.tipo en sql/schema.sql admite POZO_BAJO');
  const dbjs = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
  check(/'CUADRE_DESCUADRADO','POZO_BAJO'/.test(dbjs), '3d) el servidor también lo aplica solo al arrancar (db.js)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
