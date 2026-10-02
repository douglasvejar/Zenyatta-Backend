// =================================================================
// PRUEBA: paridad entre GET /api/hipismo/semana-por-dias y GET
// /api/hipismo/cierre-final (28-09-2026, a pedido del usuario: "semana
// por dias no coincide con el balance general").
//
// Hasta esta ronda, /semana-por-dias solo hacía la suma CRUDA de
// tickets/apuestas de Remate/Adelantadas/Winners — le faltaban 3
// ajustes que /cierre-final (y por lo tanto Balance General, que usa el
// mismo endpoint) SÍ aplica y que SÍ afectan el saldo real de un
// cliente:
//   1) "% DEVUELTO" (jugadores.comision_propia)
//   2) "AJUSTE POR CRUCE" (planos con cruza_jugadas=true)
//   3) "TRASPASO DE COMISIÓN" (hipismo_comisiones_ajustes)
//
// Esta prueba junta los 3 casos en una sola semana (lunes 21 a domingo
// 27 de sept de 2026) y verifica que el total semanal de cada cliente en
// /semana-por-dias coincide EXACTO con su saldo en /cierre-final para el
// mismo período:
//   - LUSHO/RICHARD: el plano cruzado de test_hipismo_cruce_ajuste.js
//     (7 tickets, cruza_jugadas=true) — LUSHO y RICHARD deben dar -100
//     en ambos lados (no -105/-102.50 "sin cruzar").
//   - PEDRO: tiene 5% de comisión propia y perdió -100 en un ticket
//     normal (sin cruzar) — debe dar -100 en ambos lados, MÁS un ítem
//     "PEDRO - PORCENTAJE" de +5 en ambos lados.
//   - BANCA: el banquero del ticket de PEDRO — sanity check de que la
//     suma base (sin ningún ajuste nuevo) sigue coincidiendo.
//   - CARLOS: NUNCA jugó nada esta semana, solo tiene un traspaso manual
//     de comisión de +30 — tiene que aparecer como cliente nuevo en
//     AMBOS endpoints con el mismo saldo (prueba que acumularDia() lo
//     crea igual que el clientes.push() de /cierre-final).
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-paridad-1';
const PLANO_CRUCE = 'plano-cruce-lusho';
const PLANO_PEDRO = 'plano-pedro';
const FECHA_CRUCE = '2026-09-23';   // miércoles
const FECHA_PROPIO = '2026-09-24';  // jueves
const FECHA_TRASPASO = '2026-09-25'; // viernes
const HOY_FALSO = '2026-09-26T18:00:00Z'; // sábado, misma semana (lunes 21 a domingo 27)

// Mismas 7 líneas del plano cruzado real de LUSHO que ya prueba a fondo
// test_hipismo_cruce_ajuste.js (LUSHO y RICHARD dan -100 cruzados, no
// -105/-102.50 sin cruzar) — se reusa tal cual, solo para confirmar que
// /semana-por-dias ahora aplica el MISMO ajuste que /cierre-final.
const TICKETS_CRUCE = [
  { cliente_nombre: 'RICHARD', banquero_nombre: 'LUSHO', resultado_jugador: -100, resultado_banquero: 95, monto: 100, sin_comision: false },
  { cliente_nombre: 'RICHARD', banquero_nombre: 'TONY', resultado_jugador: -50, resultado_banquero: 47.5, monto: 50, sin_comision: false },
  { cliente_nombre: 'LUSHO', banquero_nombre: 'PLACE', resultado_jugador: -200, resultado_banquero: 190, monto: 200, sin_comision: false },
  { cliente_nombre: 'PETIT', banquero_nombre: 'PLACE', resultado_jugador: -100, resultado_banquero: 95, monto: 100, sin_comision: false },
  { cliente_nombre: 'SAMMY', banquero_nombre: 'YAMEKO', resultado_jugador: -50, resultado_banquero: 47.5, monto: 50, sin_comision: false },
  { cliente_nombre: 'ALEXIS', banquero_nombre: 'RICHARD', resultado_jugador: -50, resultado_banquero: 47.5, monto: 50, sin_comision: false },
  { cliente_nombre: 'BOMBERO', banquero_nombre: 'TOLERANTE', resultado_jugador: -50, resultado_banquero: 47.5, monto: 50, sin_comision: false }
].map(t => ({ ...t, plano_id: PLANO_CRUCE, grupo_id: GRUPO_ID }));

// Ticket normal (sin cruzar) de PEDRO, que además tiene 5% de comisión
// propia — perdió -100, así que "% DEVUELTO" debe darle +5 (5% de los
// 100 apostados, gane o pierda) en un ítem aparte "PEDRO - PORCENTAJE".
const TICKET_PEDRO = {
  cliente_nombre: 'PEDRO', banquero_nombre: 'BANCA', resultado_jugador: -100, resultado_banquero: 95,
  monto: 100, sin_comision: false, plano_id: PLANO_PEDRO, grupo_id: GRUPO_ID
};

const TABLAS = {
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 5, cc_propio_nombre: null }
  ],
  jugadores_avales_porcentaje: [],
  hipismo_tickets: [...TICKETS_CRUCE, TICKET_PEDRO],
  hipismo_planos: [
    { id: PLANO_CRUCE, grupo_id: GRUPO_ID, fecha: FECHA_CRUCE, cruza_jugadas: true, comision_total: 0 },
    { id: PLANO_PEDRO, grupo_id: GRUPO_ID, fecha: FECHA_PROPIO, cruza_jugadas: false, comision_total: 0 }
  ],
  hipismo_remate_apuestas: [],
  hipismo_remates: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_adelantadas_planos: [],
  hipismo_winners: [],
  // TRASPASO DE COMISIÓN (26-09-2026): CARLOS nunca jugó nada esta
  // semana — su ÚNICO movimiento es este traspaso manual de +30.
  hipismo_comisiones_ajustes: [
    { grupo_id: GRUPO_ID, cliente_nombre: 'CARLOS', monto: 30, fecha: FECHA_TRASPASO }
  ]
};

function ticketsUnidos(grupoId, desde, hasta) {
  return TABLAS.hipismo_tickets
    .filter(t => t.grupo_id === grupoId)
    .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
    .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
    .map(({ t, p }) => ({ ...t, cruza_jugadas: p.cruza_jugadas || false, fecha: p.fecha }));
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  const [grupoId, p2, p3] = params;

  // ---- /cierre-final ----
  if (sql === "SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero, t.monto, t.plano_id, t.sin_comision, p.cruza_jugadas FROM hipismo_tickets t JOIN hipismo_planos p ON p.id = t.plano_id WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3") {
    return { rows: ticketsUnidos(grupoId, p2, p3).map(({ fecha, ...resto }) => resto) };
  }
  if (sql === "SELECT a.cliente_nombre, a.resultado, a.monto FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r.id = a.remate_id WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3") {
    return { rows: [] };
  }
  if (sql === "SELECT j.cliente_nombre, j.tipo, j.resultado_cliente, j.comision, j.banqueadores, j.monto, j.gano FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')") {
    return { rows: [] };
  }
  if (sql === "SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3") {
    return { rows: [] };
  }
  if (sql === "SELECT cliente_nombre, COALESCE(SUM(monto), 0) AS total FROM hipismo_comisiones_ajustes WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 GROUP BY cliente_nombre") {
    const filas = TABLAS.hipismo_comisiones_ajustes.filter(a => a.grupo_id === grupoId && a.fecha >= p2 && a.fecha <= p3);
    const mapa = {};
    filas.forEach(a => { mapa[a.cliente_nombre] = (mapa[a.cliente_nombre] || 0) + Number(a.monto); });
    return { rows: Object.keys(mapa).map(nombre => ({ cliente_nombre: nombre, total: mapa[nombre] })) };
  }
  if (sql === "SELECT COALESCE(SUM(comision_total), 0) AS total FROM hipismo_remates WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3") {
    return { rows: [{ total: 0 }] };
  }
  if (sql === "SELECT COALESCE(SUM(comision_total), 0) AS total FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3") {
    return { rows: [{ total: 0 }] };
  }

  // ---- /semana-por-dias ----
  if (sql === "SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero, t.monto, t.plano_id, t.sin_comision, p.cruza_jugadas, p.fecha FROM hipismo_tickets t JOIN hipismo_planos p ON p.id = t.plano_id WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3") {
    return { rows: ticketsUnidos(grupoId, p2, p3) };
  }
  if (sql === "SELECT a.cliente_nombre, a.resultado, a.monto, r.fecha FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r.id = a.remate_id WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3") {
    return { rows: [] };
  }
  if (sql === "SELECT j.cliente_nombre, j.resultado_cliente, j.banqueadores, j.monto, j.gano, p.fecha FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')") {
    return { rows: [] };
  }
  if (sql === "SELECT cliente_nombre, monto, fecha FROM hipismo_winners WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3") {
    return { rows: [] };
  }
  if (sql === "SELECT cliente_nombre, monto, fecha FROM hipismo_comisiones_ajustes WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3") {
    const filas = TABLAS.hipismo_comisiones_ajustes.filter(a => a.grupo_id === grupoId && a.fecha >= p2 && a.fecha <= p3);
    return { rows: filas.map(a => ({ cliente_nombre: a.cliente_nombre, monto: a.monto, fecha: a.fecha })) };
  }
  if (sql === "SELECT fecha, COALESCE(SUM(comision_total), 0) AS total FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 GROUP BY fecha") {
    return { rows: [] };
  }
  if (sql === "SELECT fecha, COALESCE(SUM(comision_total), 0) AS total FROM hipismo_remates WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 GROUP BY fecha") {
    return { rows: [] };
  }
  if (sql === "SELECT p.fecha AS fecha, j.comision FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')") {
    return { rows: [] };
  }

  // ---- compartida: obtenerComisionesPropias (28-09-2026, 2 consultas:
  // jugadores + jugadores_avales_porcentaje) ----
  if (sql === "SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])") {
    const nombres = params[1];
    return { rows: TABLAS.jugadores.filter(j => nombres.includes(j.nombre)) };
  }
  // "CLIENTE DOBLE" POR ESPACIOS DE MÁS (29-09-2026, ver la nota grande
  // en services/hipismoComisionPropia.js) — segunda consulta SIN filtro
  // de nombre, que obtenerComisionesPropias dispara solo cuando algún
  // nombre no calzó arriba (acá pasa siempre: RICHARD/LUSHO/etc. no
  // tienen fila en TABLAS.jugadores, a propósito, esta prueba solo
  // necesita configurar a PEDRO) — nunca encuentra ningún rescate extra
  // porque ninguno de esos nombres se parece a "PEDRO" ni por espacios de
  // más, así que el resultado de esta prueba no cambia en nada.
  if (sql === "SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1") {
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId) };
  }
  if (sql === "SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])") {
    return { rows: [] };
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
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));

Module._load = originalLoad;

function handlerDe(metodo, rutaPath) {
  const entrada = hipismoRouter.__handlers.find(([m, args]) => m === metodo && args[0] === rutaPath);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo.toUpperCase() + ' ' + rutaPath);
  return entrada[1][entrada[1].length - 1];
}
const handlerCierreFinal = handlerDe('get', '/cierre-final');
const handlerSemanaPorDias = handlerDe('get', '/semana-por-dias');

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

function reqBase(grupoId, query) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, params: {}, query: query || {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate(HOY_FALSO).getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };

  let resCierre, resDias;
  try {
    resCierre = await invocarRuta(handlerCierreFinal, reqBase(GRUPO_ID, { semana: 'actual' }));
    resDias = await invocarRuta(handlerSemanaPorDias, reqBase(GRUPO_ID, { semana: 'actual' }));
  } finally {
    global.Date = OriginalDate;
  }

  check(resCierre._status === 200, '1) GET /cierre-final responde 200');
  check(resDias._status === 200, '2) GET /semana-por-dias responde 200');
  check(resCierre._json.rango.desde === resDias._json.rango.desde && resCierre._json.rango.hasta === resDias._json.rango.hasta,
    '3) ambos endpoints calculan el MISMO rango de fechas para "semana actual"');

  function saldoCierre(nombre) {
    const c = resCierre._json.clientes.find(x => x.nombre === nombre);
    return c ? c.saldo : undefined;
  }
  function totalDias(nombre) {
    const c = resDias._json.clientes.find(x => x.nombre === nombre);
    return c ? c.totalSemana : undefined;
  }

  // AJUSTE POR CRUCE — LUSHO y RICHARD deben dar -100 EN AMBOS lados (no
  // -105/-102,50 "sin cruzar").
  check(saldoCierre('LUSHO') === -100, `4) /cierre-final: LUSHO debía dar -100,00 (cruzado), dio ${saldoCierre('LUSHO')}`);
  check(totalDias('LUSHO') === -100, `5) /semana-por-dias: LUSHO debía dar -100,00 (cruzado), dio ${totalDias('LUSHO')}`);
  check(saldoCierre('RICHARD') === -100, `6) /cierre-final: RICHARD debía dar -100,00 (cruzado), dio ${saldoCierre('RICHARD')}`);
  check(totalDias('RICHARD') === -100, `7) /semana-por-dias: RICHARD debía dar -100,00 (cruzado), dio ${totalDias('RICHARD')}`);

  // % DEVUELTO — PEDRO perdió -100 (sin ajustar) y su 5% propio genera
  // "PEDRO - PORCENTAJE" +5 aparte, en AMBOS lados.
  check(saldoCierre('PEDRO') === -100, `8) /cierre-final: PEDRO debía dar -100,00, dio ${saldoCierre('PEDRO')}`);
  check(totalDias('PEDRO') === -100, `9) /semana-por-dias: PEDRO debía dar -100,00, dio ${totalDias('PEDRO')}`);
  check(saldoCierre('PEDRO - PORCENTAJE') === 5, `10) /cierre-final: "PEDRO - PORCENTAJE" debía dar +5,00, dio ${saldoCierre('PEDRO - PORCENTAJE')}`);
  check(totalDias('PEDRO - PORCENTAJE') === 5, `11) /semana-por-dias: "PEDRO - PORCENTAJE" debía dar +5,00, dio ${totalDias('PEDRO - PORCENTAJE')}`);

  // Sanity check: BANCA (banquero del ticket de PEDRO, sin ningún ajuste
  // nuevo) sigue coincidiendo en ambos lados.
  check(saldoCierre('BANCA') === 95, `12) /cierre-final: BANCA debía dar +95,00, dio ${saldoCierre('BANCA')}`);
  check(totalDias('BANCA') === 95, `13) /semana-por-dias: BANCA debía dar +95,00, dio ${totalDias('BANCA')}`);

  // TRASPASO DE COMISIÓN — CARLOS nunca jugó nada, solo tiene el
  // traspaso de +30 — debe aparecer como cliente NUEVO en AMBOS lados.
  check(saldoCierre('CARLOS') === 30, `14) /cierre-final: CARLOS (solo traspaso) debía dar +30,00, dio ${saldoCierre('CARLOS')}`);
  check(totalDias('CARLOS') === 30, `15) /semana-por-dias: CARLOS (solo traspaso) debía dar +30,00, dio ${totalDias('CARLOS')}`);

  // El día del traspaso (viernes 25) debe aparecer entre los días con
  // datos, y la columna de CARLOS ese día debe ser +30.
  const carlosDias = resDias._json.clientes.find(x => x.nombre === 'CARLOS');
  const idxViernes = resDias._json.dias.findIndex(d => d.fecha === FECHA_TRASPASO);
  check(idxViernes >= 0, '16) el viernes 25 (día del traspaso) aparece entre los días con datos');
  check(!!carlosDias && carlosDias.porDia[idxViernes] === 30, `17) la columna de CARLOS el viernes 25 debía ser +30,00, dio ${carlosDias && carlosDias.porDia[idxViernes]}`);
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
