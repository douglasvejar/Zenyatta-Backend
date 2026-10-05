// =================================================================
// PRUEBA: "toda jugada que no se decida no genera % ni comisión"
// (29-09-2026, a pedido explícito del usuario, tras arreglar el cálculo
// de Marcas "pp"/"a premio" que no figuran en la pizarra -- ver
// test_hipismo_pp_no_coloco.js y test_hipismo_marca_a_premio.js).
//
// La comisión base del -5%% de la plataforma YA estaba bien: una jugada
// anulada da resultado 0 de ambos lados, así que montoMostrado(0,...) ya
// daba 0 (Tercios) y una Marca "nula" ya guardaba comision:0
// (Adelantadas). Lo que faltaba era el % PROPIO/DE AVAL
// (jugadores.comision_propia / jugadores_avales_porcentaje), que se
// calcula sobre el `monto` (apuesta) CRUDO sin fijarse si la jugada se
// decidió o no -- por eso una jugada anulada seguía generando ese % como
// si se hubiera jugado normal.
//
// Esta prueba confirma, en /cierre-final y /saldo-comisiones, que:
//   1. PEDRO (2%% de comisión propia) tiene un ticket de Tercios DECIDIDO
//      de 100 (gana) -- genera "PEDRO - PORCENTAJE" = 2,00 -- y otro
//      ticket ANULADO ("pp" sin que ninguno de los 2 caballos figure,
//      resultado_jugador=0 y resultado_banquero=0) de 50 -- ese NO debe
//      sumar nada al %% (si sumara, darían 3,00 en vez de 2,00).
//   2. ANA (3%% de comisión propia) tiene una Marca de Jugadas Adelantadas
//      DECIDIDA de 200 -- genera "ANA - PORCENTAJE" = 6,00 -- y otra Marca
//      ANULADA (estado 'sin_decidir', gano=null) de 80 -- esa tampoco debe
//      sumar nada (si sumara, darían 8,40 en vez de 6,00).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-no-decide-1';
const FECHA = '2026-09-29';

const JUGADOR_PEDRO = { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 2, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_ANA = { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 3, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_BANCO = { id: 'j-banco', grupo_id: GRUPO_ID, nombre: 'BANCO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_PEDRO }, { ...JUGADOR_ANA }, { ...JUGADOR_BANCO }],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [{ id: 'p1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA, cruza_jugadas: false }],
  hipismo_tickets: [
    // DECIDIDO: PEDRO le gana 100 a BANCO -- SÍ debe generar 2% = 2,00.
    // resultado_jugador (02-10-2026, "LOS % QUE SE DEVUELVEN ES DE LO
    // DECIDIDO NO DE LO APOSTADO... SIN SACARLE EL 5%" -- ver montoDecidido
    // en services/hipismoAdelantadasCalc.js): 95, no 100 -- un "1P" ganado
    // con 5% de comisión muestra/guarda monto*0.95 (ver montoMostrado() en
    // hipismoCalc.js), así que lo DECIDIDO real (montoDecidido(95,false) =
    // 95/0.95 = 100) sigue siendo 100, igual que antes de este ajuste.
    { id: 't-decidido', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCO', modalidad: '1P', caballo: '5', monto: 100, resultado_jugador: 95, resultado_banquero: -100, sin_comision: false },
    // ANULADO ("pp" sin que ninguno figure en la pizarra): 0 y 0 -- NO
    // debe generar el 2% de 50 (=1,00); si el bug existiera, PEDRO daría
    // 3,00 en vez de 2,00.
    { id: 't-anulado', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCO', modalidad: 'pp', caballo: '4x3', monto: 50, resultado_jugador: 0, resultado_banquero: 0, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [{ id: 'ap1', grupo_id: GRUPO_ID, fecha: FECHA }],
  hipismo_adelantadas_jugadas: [
    // DECIDIDA: ANA ganó su Marca de 200 -- SÍ debe generar 3% = 6,00.
    // resultado_cliente (02-10-2026, ver la nota grande de montoDecidido
    // más arriba): 200, no 190 -- el % propio/de aval de una Marca se
    // calcula sobre lo DECIDIDO (|resultado_cliente|, un neto ya
    // definitivo sin ningún 5% embebido), nunca sobre `monto`.
    { id: 'ad-decidida', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'marca', estado: 'resuelto', gano: true, cliente_nombre: 'ANA', monto: 200, resultado_cliente: 200, comision: 10, banqueadores: [] },
    // ANULADA (ninguno de los 2 caballos figuró -- estado 'sin_decidir',
    // gano=null): NO debe generar el 3% de 80 (=2,40); si el bug
    // existiera, ANA daría 8,40 en vez de 6,00.
    { id: 'ad-anulada', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'marca', estado: 'sin_decidir', gano: null, cliente_nombre: 'ANA', monto: 80, resultado_cliente: 0, comision: 0, banqueadores: [] }
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
    return { rows: [] };
  }

  // ---- /cierre-final ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s*t\.plano_id, t\.sin_comision, p\.cruza_jugadas/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId).map(t => {
        const p = TABLAS.hipismo_planos.find(x => x.id === t.plano_id);
        return { cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: p.cruza_jugadas };
      })
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto(, j\.gano)?/i.test(sql)) {
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
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.monto(, t\.resultado_jugador, t\.resultado_banquero)?/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    return {
      rows: TABLAS.hipismo_tickets
        .filter(t => t.grupo_id === grupoId)
        .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
        .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
        .map(({ t }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision }))
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s*FROM hipismo_remate_apuestas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.monto(, j\.resultado_cliente)?(, j\.banqueadores)?(, j\.gano)?(, p\.fecha, p\.hipodromo_nombre, j\.carrera_numero)?\s*FROM hipismo_adelantadas_jugadas/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas
        .filter(j => j.grupo_id === grupoId)
        .map(j => ({ j, p: TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
        .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
        .map(({ j, p }) => ({ cliente_nombre: j.cliente_nombre, monto: j.monto, resultado_cliente: j.resultado_cliente, banqueadores: j.banqueadores, gano: j.gano, fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: j.carrera_numero }))
    };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (no-decide-sin-comision) no sabe responder: ' + sql);
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

  // ---- 1) GET /cierre-final ("Balance General") ----
  const reqCierre = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } };
  const salidaCierre = await invocarRuta(handlerDe('get', '/cierre-final'), reqCierre);

  check(!!salidaCierre, '1a) GET /cierre-final respondió algo');
  const clientes = (salidaCierre && salidaCierre.clientes) || [];
  const filaPedroPct = clientes.find(c => c.nombre === 'PEDRO - PORCENTAJE');
  const filaAnaPct = clientes.find(c => c.nombre === 'ANA - PORCENTAJE');

  check(!!filaPedroPct && Math.abs(filaPedroPct.saldo - 2.00) < 0.001,
    `1b) ARREGLO: "PEDRO - PORCENTAJE" da 2,00 (SOLO el 2%% del ticket DECIDIDO de 100; el ticket ANULADO de 50 no suma nada) -- dio ${filaPedroPct ? filaPedroPct.saldo : 'nada'}`);
  check(!!filaAnaPct && Math.abs(filaAnaPct.saldo - 6.00) < 0.001,
    `1c) ARREGLO: "ANA - PORCENTAJE" da 6,00 (SOLO el 3%% de la Marca DECIDIDA de 200; la Marca ANULADA de 80 no suma nada) -- dio ${filaAnaPct ? filaAnaPct.saldo : 'nada'}`);

  // ---- 2) GET /saldo-comisiones (mismo cálculo, vista de saldo semanal) ----
  const reqSaldo = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } };
  const salidaSaldo = await invocarRuta(handlerDe('get', '/saldo-comisiones'), reqSaldo);
  check(!!salidaSaldo, '2a) GET /saldo-comisiones respondió algo');
  const filasSaldo = (salidaSaldo && salidaSaldo.clientes) || [];
  const saldoPedro = filasSaldo.find(c => c.nombre === 'PEDRO' && c.destino === 'PEDRO');
  const saldoAna = filasSaldo.find(c => c.nombre === 'ANA' && c.destino === 'ANA');
  check(!!saldoPedro && Math.abs(saldoPedro.devueltoSemana - 2.00) < 0.001,
    `2b) /saldo-comisiones también trae a PEDRO con 2,00 (sin el ticket anulado) -- dio ${saldoPedro ? saldoPedro.devueltoSemana : 'nada'}`);
  check(!!saldoAna && Math.abs(saldoAna.devueltoSemana - 6.00) < 0.001,
    `2c) /saldo-comisiones también trae a ANA con 6,00 (sin la Marca anulada) -- dio ${saldoAna ? saldoAna.devueltoSemana : 'nada'}`);

  global.Date = OriginalDate;

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
