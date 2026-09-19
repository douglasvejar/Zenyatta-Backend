// =================================================================
// PRUEBA: 2 rutas nuevas de Súper-admin (19-09-2026, a pedido del
// usuario: "quiero desde super admin pulsar el grupo y poder ver,
// balances del grupo detallado por clientes y sus saldos, tambien sus
// sabanas") — ver la nota grande junto al import de obtenerSabanaDeFecha
// en src/routes/superadmin.js.
//
// Cubre:
//   1. GET /grupos/:id/balance-clientes: mismo cálculo que ya usa el
//      propio panel del Grupo (Administración > Balance General) — trae
//      `filas` (una por cliente) + `filaTotal` + `balanceBanca`, respeta
//      el rango (default "semana actual", igual que /detalle), y separa
//      en bloques USD/BS cuando el grupo está en modo 'mixto'.
//   2. GET /grupos/:id/sabana-dia: reconstruye la sábana de una fecha
//      puntual de CUALQUIER grupo (tickets + resumenPorCliente), de
//      SOLO LECTURA — 400 sin `?fecha`, y trae los tickets tal cual
//      están guardados (sin recalcular su estado).
//   3. Un grupo_id que no existe da 404 en balance-clientes (mismo
//      criterio que /detalle).
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-1';
const GRUPO_MIXTO_ID = 'grupo-mixto';
const FECHA = '2026-09-02';

function formatearFechaISOLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mes + '-' + dia;
}
const HOY = new Date();
const FECHA_HOY = formatearFechaISOLocal(HOY);

const TABLAS = {
  grupos: [
    { id: GRUPO_ID, moneda_modo: 'usd', modelo_comision: 'plano', comision_tiers: [] },
    { id: GRUPO_MIXTO_ID, moneda_modo: 'mixto', modelo_comision: 'plano', comision_tiers: [] }
  ],
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', activo: true, comision_propia: 0, moneda: 'USD' },
    { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', activo: true, comision_propia: 0, moneda: 'USD' },
    { id: 'j-dolar', grupo_id: GRUPO_MIXTO_ID, nombre: 'DOLAR', activo: true, comision_propia: 0, moneda: 'USD' },
    { id: 'j-bolivar', grupo_id: GRUPO_MIXTO_ID, nombre: 'BOLIVAR', activo: true, comision_propia: 0, moneda: 'BS' }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  transferencias: [],
  polla_historial: [],
  tickets_historial: [
    // grupo-1, semana actual: PEDRO gana 80 sobre 100 -> banca -80.
    { id: 't-1', grupo_id: GRUPO_ID, fecha: FECHA_HOY, cliente_nombre: 'PEDRO', ticket_label: 'Ticket #1', detalle: 'Astros ML', arriesga: 100, gana: 80, estado: 'GANADA' },
    // grupo-mixto: DOLAR (USD) pierde 100; BOLIVAR (BS) gana 40 sobre 50.
    { id: 't-2', grupo_id: GRUPO_MIXTO_ID, fecha: FECHA_HOY, cliente_nombre: 'DOLAR', ticket_label: 'Ticket #1', detalle: 'Astros ML', arriesga: 100, gana: 0, estado: 'PERDIDA' },
    { id: 't-3', grupo_id: GRUPO_MIXTO_ID, fecha: FECHA_HOY, cliente_nombre: 'BOLIVAR', ticket_label: 'Ticket #2', detalle: 'Rangers ML', arriesga: 50, gana: 40, estado: 'GANADA' },
    // grupo-1, fecha fija (FECHA) — para la prueba de sabana-dia.
    { id: 't-dia-1', grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'PEDRO', ticket_label: 'Ticket #9', detalle: 'Astros ML', arriesga: 100, gana: 90, estado: 'GANADA' },
    { id: 't-dia-2', grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'ANA', ticket_label: 'Ticket #10', detalle: 'Yankees ML', arriesga: 80, gana: 0, estado: 'PENDIENTE' }
  ]
};

function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: 'Houston Astros' }, score: 5 },
              away: { team: { name: 'Texas Rangers' }, score: 1 }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA + 'T23:00:00Z',
            gamePk: 1
          }]
        }]
      })
    });
  }
  return Promise.resolve({ json: async () => ({ events: [] }) });
}
global.fetch = fakeFetch;

// La fila fake de TABLAS.tickets_historial trae "cliente_nombre"/
// "ticket_label" (los nombres reales de columna) — la consulta real usa
// "AS cliente"/"AS ticket" para renombrarlas, algo que acá hay que hacer
// a mano porque este ejecutarQuery() fake no corre SQL de verdad.
function mapTicketRow(r) {
  return { id: r.id, fecha: r.fecha, cliente: r.cliente_nombre, ticket: r.ticket_label, detalle: r.detalle, arriesga: r.arriesga, gana: r.gana, estado: r.estado, logros: r.logros };
}

function filtrarTicketsHistorial(sql, params) {
  const grupoId = params[0];
  let idx = 1, desde, hasta;
  if (/fecha >= \$/i.test(sql)) { desde = params[idx]; idx++; }
  if (/fecha <= \$/i.test(sql)) { hasta = params[idx]; idx++; }
  return TABLAS.tickets_historial.filter(r =>
    r.grupo_id === grupoId &&
    (!desde || r.fecha >= desde) &&
    (!hasta || r.fecha <= hasta)
  ).map(mapTicketRow);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT id, moneda_modo FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = TABLAS.grupos.find(x => x.id === params[0]);
    return { rows: g ? [{ id: g.id, moneda_modo: g.moneda_modo }] : [] };
  }
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  }
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.avales.filter(a => a.grupo_id === params[0]) };
  }
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_globales/i.test(sql)) {
    return { rows: TABLAS.equipos_globales };
  }
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_personalizados WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.equipos_personalizados.filter(e => e.grupo_id === params[0]) };
  }
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = TABLAS.grupos.find(x => x.id === params[0]);
    return { rows: [{ modelo_comision: (g && g.modelo_comision) || 'plano', comision_tiers: (g && g.comision_tiers) || [] }] };
  }
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros FROM tickets_historial WHERE/i.test(sql)) {
    return { rows: filtrarTicketsHistorial(sql, params) };
  }
  if (/^SELECT MIN\(fecha\) AS min_fecha FROM tickets_historial WHERE grupo_id = \$1/i.test(sql)) {
    const filas = TABLAS.tickets_historial.filter(r => r.grupo_id === params[0]);
    if (filas.length === 0) return { rows: [{ min_fecha: null }] };
    return { rows: [{ min_fecha: filas.map(r => r.fecha).sort()[0] }] };
  }

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

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

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'x' }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.SUPERADMIN_SECRET = 'fake-secret';

const superadminRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin'));

Module._load = originalLoad;

function handlerDe(metodo, ruta) {
  const entrada = superadminRouter.__handlers.find(([m, args]) => m === metodo && args[0] === ruta);
  if (!entrada) throw new Error('No se registró la ruta ' + metodo.toUpperCase() + ' ' + ruta);
  return entrada[1][entrada[1].length - 1];
}
const handlerBalanceClientes = handlerDe('get', '/grupos/:id/balance-clientes');
const handlerSabanaDia = handlerDe('get', '/grupos/:id/sabana-dia');

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // =========================== balance-clientes ===========================
  const rb1 = await invocarRuta(handlerBalanceClientes, { params: { id: GRUPO_ID }, query: {} });
  check(rb1._status === 200, 'balance-clientes: responde 200 para un grupo normal (usd)');
  check(rb1._json.mixto === false, 'balance-clientes: mixto:false para un grupo en modo fijo');
  check(rb1._json.moneda === 'USD', 'balance-clientes: trae la moneda del grupo (USD)');
  check(Array.isArray(rb1._json.filas), 'balance-clientes: trae "filas" (un array, una fila por cliente)');
  const filaPedro = rb1._json.filas.find(f => f.cliente === 'PEDRO');
  check(!!filaPedro, 'balance-clientes: PEDRO aparece en la tabla');
  check(filaPedro.arriesgado === 100 && filaPedro.ganado === 80, 'balance-clientes: los números de PEDRO son los correctos (arriesgado 100, ganado 80)');
  check(!!rb1._json.filaTotal, 'balance-clientes: trae filaTotal');
  check(rb1._json.balanceBanca === -80, 'balance-clientes: balanceBanca correcto (banca perdió 80 con PEDRO)');
  check(!!rb1._json.rango && rb1._json.rango.desde <= FECHA_HOY && rb1._json.rango.hasta >= FECHA_HOY, 'balance-clientes: sin query params, el rango por defecto es la semana actual (incluye hoy)');

  // ?rango=todo también funciona (mismo mecanismo que /detalle)
  const rb2 = await invocarRuta(handlerBalanceClientes, { params: { id: GRUPO_ID }, query: { rango: 'todo' } });
  check(rb2._status === 200, 'balance-clientes: ?rango=todo también responde 200');

  // Grupo en modo MIXTO: 2 bloques (USD/BS), cada uno con solo el
  // cliente de su moneda.
  const rb3 = await invocarRuta(handlerBalanceClientes, { params: { id: GRUPO_MIXTO_ID }, query: { rango: 'todo' } });
  check(rb3._json.mixto === true, 'balance-clientes: mixto:true para un grupo en modo mixto');
  check(!!rb3._json.USD && !!rb3._json.BS, 'balance-clientes: trae los bloques USD y BS');
  check(rb3._json.USD.filas.some(f => f.cliente === 'DOLAR'), 'balance-clientes (mixto): DOLAR aparece en el bloque USD');
  check(!rb3._json.USD.filas.some(f => f.cliente === 'BOLIVAR'), 'balance-clientes (mixto): BOLIVAR NO aparece en el bloque USD');
  check(rb3._json.BS.filas.some(f => f.cliente === 'BOLIVAR'), 'balance-clientes (mixto): BOLIVAR aparece en el bloque BS');
  check(!rb3._json.BS.filas.some(f => f.cliente === 'DOLAR'), 'balance-clientes (mixto): DOLAR NO aparece en el bloque BS');

  // Grupo que no existe -> 404 (mismo criterio que /detalle)
  const rb4 = await invocarRuta(handlerBalanceClientes, { params: { id: 'no-existe' }, query: {} });
  check(rb4._status === 404, 'balance-clientes: un grupo_id que no existe da 404');

  // =============================== sabana-dia ==============================
  const rs1 = await invocarRuta(handlerSabanaDia, { params: { id: GRUPO_ID }, query: { fecha: FECHA } });
  check(rs1._status === 200, 'sabana-dia: responde 200 con ?fecha');
  check(rs1._json.fecha === FECHA, 'sabana-dia: devuelve la fecha pedida');
  check(Array.isArray(rs1._json.tickets) && rs1._json.tickets.length === 2, 'sabana-dia: trae los 2 tickets de esa fecha (de CUALQUIER grupo, por :id de la URL)');
  const ticketPedro = rs1._json.tickets.find(t => t.cliente === 'PEDRO');
  check(!!ticketPedro && ticketPedro.estado === 'GANADA', 'sabana-dia: el estado ya guardado del ticket viene tal cual (GANADA), sin recalcularlo');
  check(Array.isArray(rs1._json.resumenPorCliente) && rs1._json.resumenPorCliente.length === 2, 'sabana-dia: resumenPorCliente trae 1 fila por cliente (PEDRO y ANA)');

  // Sin ?fecha -> 400, no revienta
  const rs2 = await invocarRuta(handlerSabanaDia, { params: { id: GRUPO_ID }, query: {} });
  check(rs2._status === 400, 'sabana-dia: sin ?fecha responde 400 (no 500)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de balance-clientes/sabana-dia se cayó con una excepción:', e);
  process.exit(1);
});
