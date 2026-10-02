// =================================================================
// PRUEBA: "% propio/de aval también cuando se BANQUEA una MARCA"
// (29-09-2026, a pedido explícito del usuario tras el arreglo de Tercios:
// "las marcas en todas sus presentaciones sean adelantadas o en jugadas
// contra tercios del plano, o como sea deben cumplir todas la misma
// regla..." -- ver test_hipismo_comision_banquero_tercios.js para el caso
// real "Mrincreible" que disparó el arreglo original, ahí sí solo de
// Tercios).
//
// Esta prueba reproduce el mismo tipo de caso pero para una Marca de
// Jugadas Adelantadas: MRINCREIBLE banquea el 50% de una Marca de $600 --
// o sea, banqueó $300 de esa jugada puntualmente -- y tiene 1% de
// comisión propia + 2 avales (Ferrocarril 0.5%, Purga 0.5%), igual que en
// el caso real de Tercios. Como una Marca banqueada NO guarda el monto
// que banqueó cada quien (solo el resultado NETO ganado/perdido, ver
// resolverBanqueoMarca en services/hipismoAdelantadasCalc.js), el % debe
// calcularse sobre `j.monto * b.porcentaje/100` (300), NO sobre el
// monto total de la jugada (600) ni sobre el resultado neto del
// banqueador -- por eso se usa porcentaje=50% de $600 (=$300) en vez de
// repetir el mismo $300 "por casualidad" del caso de Tercios, para
// confirmar que el escalado realmente se está aplicando y no que el
// cálculo solo "pasa" el monto de la jugada sin tocarlo.
//
// Se prueba contra GET /cierre-final ("Balance General") y GET
// /saldo-comisiones, igual que la prueba hermana de Tercios.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-banquero-marca-1';
const FECHA = '2026-09-29';

const JUGADOR_MR = { id: 'j-mr', grupo_id: GRUPO_ID, nombre: 'MRINCREIBLE', comision_propia: 1, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_FERROCARRIL = { id: 'j-ferro', grupo_id: GRUPO_ID, nombre: 'FERROCARRIL', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_PURGA = { id: 'j-purga', grupo_id: GRUPO_ID, nombre: 'PURGA', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_JOSUE = { id: 'j-josue', grupo_id: GRUPO_ID, nombre: 'JOSUE', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_MR }, { ...JUGADOR_FERROCARRIL }, { ...JUGADOR_PURGA }, { ...JUGADOR_JOSUE }],
  jugadores_avales_porcentaje: [
    { grupo_id: GRUPO_ID, jugador_id: 'j-mr', avalador_id: 'j-ferro', porcentaje: 0.5 },
    { grupo_id: GRUPO_ID, jugador_id: 'j-mr', avalador_id: 'j-purga', porcentaje: 0.5 }
  ],
  hipismo_tickets: [], hipismo_planos: [],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [{ id: 'ap1', grupo_id: GRUPO_ID, fecha: FECHA }],
  // La Marca: $600 en total, JOSUE (cliente) ganó su parte, y MRINCREIBLE
  // banqueó el 50% de esa jugada ($300 puntuales) -- `monto` acá en
  // banqueadores[] es el RESULTADO NETO de MRINCREIBLE (perdió, banqueó
  // contra JOSUE que acertó), no lo que banqueó.
  hipismo_adelantadas_jugadas: [
    {
      id: 'ad1', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'marca', estado: 'resuelto', gano: true,
      cliente_nombre: 'JOSUE', monto: 600, resultado_cliente: 300, comision: 0,
      banqueadores: [{ nombre: 'MRINCREIBLE', porcentaje: 50, monto: -300, pagaComision: false, comisionPorcentaje: 0 }]
    }
  ],
  hipismo_winners: [], hipismo_comisiones_ajustes: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias (services/hipismoComisionPropia.js) ----
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  if (sql === 'SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])') {
    const [grupoId, idsJugadores] = params;
    return {
      rows: TABLAS.jugadores_avales_porcentaje
        .filter(a => a.grupo_id === grupoId && idsJugadores.includes(a.jugador_id))
        .map(a => {
          const av = TABLAS.jugadores.find(j => j.id === a.avalador_id);
          return { jugador_id: a.jugador_id, porcentaje: a.porcentaje, avalador_nombre: av ? av.nombre : null, cc_avalador_nombre: null };
        })
    };
  }

  // ---- /cierre-final ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s*t\.plano_id, t\.sin_comision, p\.cruza_jugadas/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId).map(j => ({
        cliente_nombre: j.cliente_nombre, tipo: j.tipo, resultado_cliente: j.resultado_cliente,
        comision: j.comision, banqueadores: j.banqueadores, monto: j.monto, gano: j.gano
      }))
    };
  }
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s*FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) return { rows: [{ total: 0 }] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_planos/i.test(sql)) return { rows: [{ total: 0 }] };

  // ---- /saldo-comisiones ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.monto(, t\.resultado_jugador, t\.resultado_banquero)?\s*FROM hipismo_tickets/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s*FROM hipismo_remate_apuestas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.monto(, j\.banqueadores)?(, j\.gano)?\s*FROM hipismo_adelantadas_jugadas/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas
        .filter(j => j.grupo_id === grupoId)
        .map(j => ({ j, p: TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
        .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
        .map(({ j }) => ({ cliente_nombre: j.cliente_nombre, monto: j.monto, banqueadores: j.banqueadores, gano: j.gano }))
    };
  }

  throw new Error('La base de datos falsa de esta prueba (comision-banquero-marca) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
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

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'h', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';

const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));

Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }

async function invocarRuta(handler, req) {
  let salida = null;
  await new Promise((resolve, reject) => {
    const res = { status(c) { this._s = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return salida;
}

(async function main() {
  const OriginalDate = Date;
  const fake = new OriginalDate(FECHA + 'T12:00:00Z').getTime();
  global.Date = class extends OriginalDate { constructor(...a) { if (a.length === 0) super(fake); else super(...a); } static now() { return fake; } };

  // ---- 1) GET /cierre-final ("Balance General" para el usuario) ----
  const reqCierre = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } };
  const salidaCierre = await invocarRuta(handlerDe('get', '/cierre-final'), reqCierre);

  check(!!salidaCierre, '1a) GET /cierre-final respondió algo');
  const clientes = (salidaCierre && salidaCierre.clientes) || [];
  const filaMrPct = clientes.find(c => c.nombre === 'MRINCREIBLE - PORCENTAJE');
  // 02-10-2026: tras el rediseño, avalador_id YA ES directamente la ficha
  // elegida por el operador -- en este caso, el cliente real FERROCARRIL /
  // PURGA (sin ninguna sub-cuenta "- PORCENTAJE" auto-creada por detrás),
  // así que el % de aval se suma a la MISMA ficha de FERROCARRIL/PURGA.
  const filaFerro = clientes.find(c => c.nombre === 'FERROCARRIL');
  const filaPurga = clientes.find(c => c.nombre === 'PURGA');

  // MRINCREIBLE banqueó el 50% de una Marca de $600 = $300 puntuales.
  // 1% de $300 = $3,00; cada aval al 0,5% de $300 = $1,50.
  check(!!filaMrPct && Math.abs(filaMrPct.saldo - 3.00) < 0.001,
    `1b) ARREGLO: "MRINCREIBLE - PORCENTAJE" aparece con +3,00 (1% de los $300 que banqueó de la Marca, escalados de su 50% sobre $600) -- dio ${filaMrPct ? filaMrPct.saldo : 'nada (bug reproducido)'}`);
  check(!!filaFerro && Math.abs(filaFerro.saldo - 1.50) < 0.001,
    `1c) "FERROCARRIL" (aval de MRINCREIBLE al 0,5%, directo a su propia ficha) aparece con +1,50 -- dio ${filaFerro ? filaFerro.saldo : 'nada (bug reproducido)'}`);
  check(!!filaPurga && Math.abs(filaPurga.saldo - 1.50) < 0.001,
    `1d) "PURGA" (el otro aval de MRINCREIBLE al 0,5%, directo a su propia ficha) aparece con +1,50 -- dio ${filaPurga ? filaPurga.saldo : 'nada (bug reproducido)'}`);

  // ---- 2) GET /saldo-comisiones (mismo cálculo, vista de saldo semanal) ----
  const reqSaldo = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } };
  const salidaSaldo = await invocarRuta(handlerDe('get', '/saldo-comisiones'), reqSaldo);
  check(!!salidaSaldo, '2a) GET /saldo-comisiones respondió algo');
  const filasSaldo = (salidaSaldo && salidaSaldo.clientes) || [];
  const saldoMrPropio = filasSaldo.find(c => c.nombre === 'MRINCREIBLE' && c.destino === 'MRINCREIBLE');
  const saldoFerro = filasSaldo.find(c => c.nombre === 'MRINCREIBLE' && c.destino === 'FERROCARRIL');
  const saldoPurga = filasSaldo.find(c => c.nombre === 'MRINCREIBLE' && c.destino === 'PURGA');
  check(!!saldoMrPropio && Math.abs(saldoMrPropio.devueltoSemana - 3.00) < 0.001,
    `2b) /saldo-comisiones también trae a MRINCREIBLE devolviendo 3,00 por banquear la Marca -- dio ${saldoMrPropio ? saldoMrPropio.devueltoSemana : 'nada'}`);
  check(!!saldoFerro && Math.abs(saldoFerro.devueltoSemana - 1.50) < 0.001,
    `2c) /saldo-comisiones trae a FERROCARRIL (avalador, generado por MRINCREIBLE) con 1,50 -- dio ${saldoFerro ? saldoFerro.devueltoSemana : 'nada'}`);
  check(!!saldoPurga && Math.abs(saldoPurga.devueltoSemana - 1.50) < 0.001,
    `2d) /saldo-comisiones trae a PURGA (avaladora, generado por MRINCREIBLE) con 1,50 -- dio ${saldoPurga ? saldoPurga.devueltoSemana : 'nada'}`);

  global.Date = OriginalDate;

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
