// =================================================================
// PRUEBA: "Moneda del grupo" (18-09-2026, a pedido del usuario:
// "permiteme elegir si el grupo trabaja en dolares, bolivares o mixto,
// si elijo mixto al momento de crear los clientes se le elige la moneda
// y el grupo tendria entonces dos reportes, bolivares y dolares").
//
// Cubre:
//   1) services/moneda.js (partirPorMoneda) — la utilidad pura que parte
//      un listado en dos bloques.
//   2) routes/jugadores.js — resolverMonedaJugador(): un grupo fijo
//      ('usd'/'bs') SIEMPRE guarda esa moneda, sin importar lo que
//      mande el formulario; un grupo 'mixto' respeta lo elegido.
//   3) services/balanceGeneral.js — el filtro opcional nombresPermitidos
//      (para partir el Balance General en dos, uno por moneda) da
//      exactamente el mismo resultado que filtrar A MANO el escenario
//      de test_balance_general.js.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

// --- 1) partirPorMoneda() ---------------------------------------------
const { partirPorMoneda } = require(path.join(__dirname, '..', 'src', 'services', 'moneda'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(function pruebasPartirPorMoneda() {
  const filas = [
    { cliente: 'ANA', arriesgado: 100, ganado: 0, moneda: 'USD' },
    { cliente: 'LUIS', arriesgado: 50, ganado: 20, moneda: 'BS' },
    { cliente: 'PEDRO', arriesgado: 30, ganado: 10 } // sin moneda -> default seguro USD
  ];
  const bloques = partirPorMoneda(filas, ['arriesgado', 'ganado']);
  check(bloques.USD.filas.length === 2, 'partirPorMoneda: 2 filas caen en USD (ANA + PEDRO, que no trae moneda)');
  check(bloques.BS.filas.length === 1, 'partirPorMoneda: 1 fila cae en BS (LUIS)');
  check(bloques.USD.totales.arriesgado === 130, 'partirPorMoneda: total arriesgado USD = 100 + 30 = 130');
  check(bloques.BS.totales.arriesgado === 50, 'partirPorMoneda: total arriesgado BS = 50');
  check(bloques.BS.totales.ganado === 20, 'partirPorMoneda: total ganado BS = 20');
})();

// --- 2) resolverMonedaJugador() (routes/jugadores.js) -----------------
function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => {
    router[m] = (...args) => { handlers.push([m, args]); return router; };
  });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;

const TABLAS_J = { jugadores: [] };
let siguienteId = 1;
function ejecutarQueryJugadores(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^INSERT INTO jugadores/i.test(sql)) {
    const [grupoId, nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda] = params;
    const fila = { id: 'j' + (siguienteId++), grupo_id: grupoId, nombre, moneda };
    TABLAS_J.jugadores.push(fila);
    return { rows: [fila] };
  }
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}
const fakePoolJugadores = function () {
  this.query = async (text, params) => ejecutarQueryJugadores(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQueryJugadores(text, params), release() {} });
  this.on = () => {};
};

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePoolJugadores };
  if (request === 'express') return fakeExpress;
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'g1' }) };
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';
const jugadoresRouter = require(path.join(__dirname, '..', 'src', 'routes', 'jugadores'));
Module._load = originalLoad;

const entradaPost = jugadoresRouter.__handlers.find(([metodo]) => metodo === 'post');
const handlerPost = entradaPost[1][entradaPost[1].length - 1];

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    res.end = () => { resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

(async function pruebasResolverMoneda() {
  // Grupo fijo en 'usd': aunque el formulario mande "BS", se guarda USD.
  const req1 = { grupoId: 'g1', grupo: { moneda_modo: 'usd' }, body: { nombre: 'ANA', moneda: 'BS' } };
  const res1 = await invocarRuta(handlerPost, req1);
  check(res1._json.moneda === 'USD', 'grupo fijo en "usd": el cliente se guarda en USD aunque el formulario mandara "BS"');

  // Grupo fijo en 'bs': aunque el formulario mande "USD", se guarda BS.
  const req2 = { grupoId: 'g1', grupo: { moneda_modo: 'bs' }, body: { nombre: 'LUIS', moneda: 'USD' } };
  const res2 = await invocarRuta(handlerPost, req2);
  check(res2._json.moneda === 'BS', 'grupo fijo en "bs": el cliente se guarda en BS aunque el formulario mandara "USD"');

  // Grupo 'mixto': se respeta lo que mande el formulario.
  const req3 = { grupoId: 'g1', grupo: { moneda_modo: 'mixto' }, body: { nombre: 'PEDRO', moneda: 'BS' } };
  const res3 = await invocarRuta(handlerPost, req3);
  check(res3._json.moneda === 'BS', 'grupo "mixto": se respeta la moneda BS elegida al crear el cliente');

  const req4 = { grupoId: 'g1', grupo: { moneda_modo: 'mixto' }, body: { nombre: 'CARLOS' } };
  const res4 = await invocarRuta(handlerPost, req4);
  check(res4._json.moneda === 'USD', 'grupo "mixto" sin elegir moneda explícita: default USD');

  // Sin req.grupo (mismo patrón que otras pruebas viejas que invocan el
  // handler directamente, sin pasar por requiereGrupo): no revienta,
  // default seguro 'usd'.
  const req5 = { grupoId: 'g1', body: { nombre: 'SINGRUPO' } };
  const res5 = await invocarRuta(handlerPost, req5);
  check(res5._status === 201 && res5._json.moneda === 'USD', 'sin req.grupo armado (pruebas que invocan el handler directo): no revienta, default USD');
})().then(pruebasBalanceGeneral).catch(e => {
  console.error('La prueba de moneda del grupo se cayó con una excepción:', e);
  process.exit(1);
});

// --- 3) calcularBalanceGeneral() con nombresPermitidos -----------------
// Mismo escenario EXACTO que test_balance_general.js, pero agregando un
// tercer cliente en otra "moneda" (acá simulada solo con el filtro de
// nombres, sin tocar tickets_historial) para confirmar que
// nombresPermitidos deja afuera a quien no está en el Set, sin cambiar
// en nada los números de quien SÍ queda adentro.
async function pruebasBalanceGeneral() {
  const TABLAS_B = {
    tickets_historial: [
      { id: 't1', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'A', ticket_label: 'T1', detalle: 'x', arriesga: 100, gana: 0, estado: 'PERDIDA' },
      { id: 't2', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'B', ticket_label: 'T2', detalle: 'x', arriesga: 50, gana: 45, estado: 'GANADA' }
    ],
    polla_historial: [],
    transferencias: []
  };
  function ejecutarQueryBalance(text, params) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) {
      const [grupoId] = params;
      const filas = TABLAS_B.tickets_historial.filter(t => t.grupo_id === grupoId);
      return { rows: filas.map(t => ({ id: t.id, fecha: t.fecha, cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado })) };
    }
    if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
    if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) return { rows: [] };
    throw new Error('La base de datos falsa de esta prueba (balance general) no sabe responder: ' + sql);
  }
  const fakePoolBalance = function () {
    this.query = async (text, params) => ejecutarQueryBalance(text, params);
    this.connect = async () => ({ query: async (text, params) => ejecutarQueryBalance(text, params), release() {} });
    this.on = () => {};
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'pg') return { Pool: fakePoolBalance };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'services', 'balanceGeneral'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'services', 'historial'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'services', 'transferencias'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'services', 'polla'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'db'))];
  const { calcularBalanceGeneral } = require(path.join(__dirname, '..', 'src', 'services', 'balanceGeneral'));
  Module._load = originalLoad;

  const sinFiltro = await calcularBalanceGeneral('g1', '2026-09-01', '2026-09-01', {}, {});
  check(sinFiltro.filas.length === 2, 'sin nombresPermitidos: entran los 2 clientes, comportamiento de siempre');

  // El filtro va en el 7mo parámetro (después de configComision, el 6to).
  const soloABien = await calcularBalanceGeneral('g1', '2026-09-01', '2026-09-01', {}, {}, undefined, new Set(['A']));
  check(soloABien.filas.length === 1 && soloABien.filas[0].cliente === 'A', 'nombresPermitidos = {A}: solo entra A, B queda afuera');
  check(soloABien.balanceBanca === 100, 'nombresPermitidos = {A}: balanceBanca = 100 (solo lo que dejó A, sin mezclar lo de B)');

  const soloBBien = await calcularBalanceGeneral('g1', '2026-09-01', '2026-09-01', {}, {}, undefined, new Set(['B']));
  check(soloBBien.filas.length === 1 && soloBBien.filas[0].cliente === 'B', 'nombresPermitidos = {B}: solo entra B, A queda afuera');
  check(soloBBien.balanceBanca === -45, 'nombresPermitidos = {B}: balanceBanca = -45 (solo lo que dejó B)');

  check(soloABien.balanceBanca + soloBBien.balanceBanca === sinFiltro.balanceBanca, 'los dos bloques por separado (A + B) suman EXACTAMENTE el total combinado — nada se pierde ni se duplica al partir por moneda');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
}
