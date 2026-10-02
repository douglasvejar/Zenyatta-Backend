// =================================================================
// PRUEBA: el filtro de "jugada no decidida" (sección 29-09-2026, "toda
// jugada que no se decida no genera % ni comisión") tiene que funcionar
// contra el comportamiento REAL de "pg" -- no solo contra el mock de los
// otros tests.
//
// BUG REAL encontrado (caso Sebastian, reportado por el usuario: seguía
// cobrando +$2,00 de "Sebastian - porcentaje" en Balance General DESPUÉS
// de aplicar el commit que arreglaba justo esto, y después de borrar y
// volver a cargar el plano -- así que no era un problema de caché ni de
// datos viejos): "pg" devuelve una columna `numeric` de Postgres como
// STRING de JavaScript (ej. "0.00"), NUNCA como number -- es el
// comportamiento documentado de node-postgres para evitar perder
// precisión, y este proyecto no registra ningún type parser que lo
// cambie (ver src/db.js, sin setTypeParser). El filtro que se agregó en
// la ronda anterior comparaba así: `t.resultado_jugador === 0` --
// comparación ESTRICTA de una STRING contra un NUMBER, que en JavaScript
// SIEMPRE da false, sin importar el valor real. Es decir: el filtro
// jamás excluía nada en producción, aunque en los tests (que arman su
// base de datos falsa con numbers de JS directos, como `resultado_jugador:
// 0`) sí "funcionara" -- confirmado con el usuario corriendo 2 consultas
// SQL directas en Supabase: los 2 tickets de Sebastian con la Marca "pp"
// (1x7) SÍ tenían resultado_jugador=0 y resultado_banquero=0 guardados
// correctamente, pero el % seguía cobrándose en Balance General de todas
// formas.
//
// Esta prueba arma el mock de base de datos para que devuelva
// resultado_jugador/resultado_banquero (y monto, comision_propia, etc.)
// como STRINGS -- tal cual los devolvería "pg" de verdad -- para que el
// mock no pueda tapar este tipo de bug otra vez. Cubre los 3 puntos
// donde se aplica este filtro: /cierre-final, /saldo-comisiones y
// /semana-por-dias.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-pg-string-1';
const FECHA = '2026-09-29'; // dentro de la semana lunes 28/09 a domingo 04/10 de 2026

const JUGADOR_SEBASTIAN = { id: 'j-sebastian', grupo_id: GRUPO_ID, nombre: 'SEBASTIAN', comision_propia: '1', incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_GG = { id: 'j-gg', grupo_id: GRUPO_ID, nombre: 'GG', comision_propia: '0', incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_SEBASTIAN }, { ...JUGADOR_GG }],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [{ id: 'p1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 13, fecha: FECHA, cruza_jugadas: false }],
  hipismo_tickets: [
    // EXACTAMENTE el caso real: SEBASTIAN vs GG, "pp (1x7)", quedó nula --
    // resultado_jugador Y resultado_banquero en "0.00" (STRING, como los
    // devolvería pg de verdad). NO debe generar el 1% de 100 (=1,00).
    { id: 't-sebastian-anulado', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'SEBASTIAN', banquero_nombre: 'GG', modalidad: 'pp', caballo: '1x7', monto: '100.00', resultado_jugador: '0.00', resultado_banquero: '0.00', sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: [],
  hipismo_winners: [], hipismo_comisiones_ajustes: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias (services/hipismoComisionPropia.js) ----
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    // comision_propia como STRING (así lo devuelve pg para `numeric`).
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
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto(, j\.gano)?/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s*FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) return { rows: [{ total: '0' }] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_planos/i.test(sql)) return { rows: [{ total: '0' }] };

  // ---- /saldo-comisiones ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.monto(, t\.resultado_jugador, t\.resultado_banquero)?/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    return {
      rows: TABLAS.hipismo_tickets
        .filter(t => t.grupo_id === grupoId)
        .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
        .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
        .map(({ t }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero }))
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s*FROM hipismo_remate_apuestas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.monto(, j\.banqueadores)?(, j\.gano)?\s*FROM hipismo_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  // ---- /semana-por-dias ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto, t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.fecha/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId).map(t => {
        const p = TABLAS.hipismo_planos.find(x => x.id === t.plano_id);
        return { cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: p.cruza_jugadas, fecha: p.fecha };
      })
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto, r\.fecha/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto, j\.gano, p\.fecha/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores, j\.monto, j\.gano, p\.fecha/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_planos/i.test(sql)) return { rows: [] };
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (pg-numeric-string) no sabe responder: ' + sql);
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

  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } };

  // ---- 1) GET /cierre-final ("Balance General") ----
  const salidaCierre = await invocarRuta(handlerDe('get', '/cierre-final'), reqBase);
  check(!!salidaCierre, '1a) GET /cierre-final respondió algo');
  const clientesCierre = (salidaCierre && salidaCierre.clientes) || [];
  const filaSebastianPct = clientesCierre.find(c => c.nombre === 'SEBASTIAN - PORCENTAJE');
  check(!filaSebastianPct,
    `1b) ARREGLO REAL (bug de "pg" devolviendo numeric como string): "SEBASTIAN - PORCENTAJE" NO aparece en /cierre-final (su única jugada de la semana quedó anulada, resultado_jugador/resultado_banquero llegan como STRING "0.00" igual que en producción) -- ${filaSebastianPct ? `dio ${filaSebastianPct.saldo}` : 'correctamente ausente'}`);

  // ---- 2) GET /saldo-comisiones ----
  const salidaSaldo = await invocarRuta(handlerDe('get', '/saldo-comisiones'), reqBase);
  check(!!salidaSaldo, '2a) GET /saldo-comisiones respondió algo');
  const filasSaldo = (salidaSaldo && salidaSaldo.clientes) || [];
  const saldoSebastian = filasSaldo.find(c => c.nombre === 'SEBASTIAN');
  check(!saldoSebastian,
    `2b) ARREGLO REAL: SEBASTIAN tampoco aparece en /saldo-comisiones -- ${saldoSebastian ? `dio ${saldoSebastian.devueltoSemana}` : 'correctamente ausente'}`);

  // ---- 3) GET /semana-por-dias ----
  const salidaDias = await invocarRuta(handlerDe('get', '/semana-por-dias'), reqBase);
  check(!!salidaDias, '3a) GET /semana-por-dias respondió algo');
  const diasClientes = (salidaDias && salidaDias.dias) || [];
  const filaDiaSebastian = diasClientes.find(d => d.nombre === 'SEBASTIAN - PORCENTAJE');
  check(!filaDiaSebastian,
    `3b) ARREGLO REAL: "SEBASTIAN - PORCENTAJE" tampoco aparece en /semana-por-dias -- ${filaDiaSebastian ? 'apareció (mal)' : 'correctamente ausente'}`);
  check(Math.abs((salidaCierre && salidaCierre.comisionSemana) || 0) < 0.001,
    `1c) La comisión real de /cierre-final da 0 (la única jugada de la semana está anulada, no hay comisión de Tercios ni % devuelto) -- dio ${salidaCierre && salidaCierre.comisionSemana}`);

  global.Date = OriginalDate;

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
