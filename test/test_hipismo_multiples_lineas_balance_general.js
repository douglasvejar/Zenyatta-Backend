// =================================================================
// PRUEBA: un cliente con VARIAS líneas en la MISMA carrera (02-10-2026,
// Ronda 4 del barrido de redondeo — caso real: el usuario mostró un
// "Balance General" semanal con Comisión = $379,65 y dijo "REVISA AQUI LA
// COMISION SI NO ESTAS REDONDEANDO ALGO .... ME DA QUE DEBERIA DE DAR
// 379,78").
//
// Mismo bug que ya se arregló en /comisiones-devueltas (ver
// test_hipismo_multiples_lineas_misma_carrera.js, Ronda 3): cuando un
// cliente juega MÁS DE UNA línea en la MISMA carrera, `acumularDevuelto`/
// `acumularSaldo`/`acumularDevueltoDia` redondeaban el % devuelto de CADA
// ticket por separado y sumaban esos redondeados, en vez de sumar el
// monto EXACTO de todas las líneas de esa carrera y redondear UNA sola
// vez -- el mismo "suma de redondeos" vs. "redondeo de la suma" que ya
// rompía /comisiones-devueltas, pero esta vez en Balance General/Cierre
// Final, Saldo Comisiones y Semana por Días (las 3 rutas que alimentan
// construirCierreFinalHipismo y sus hermanas en routes/hipismo.js).
//
// CODINO juega 2 líneas perdidas de 33,33 cada una en la MISMA carrera,
// con 1% propio -- mismo escenario EXACTO de
// test_hipismo_multiples_lineas_misma_carrera.js:
//   - por ticket (el bug): 33,33 * 1% = 0,3333 -> redondeado a 0,33 cada
//     uno -> sumados por separado = 0,66
//   - exacto (el arreglo): 0,3333 + 0,3333 = 0,6666 -> redondeado UNA vez
//     = 0,67
// /cierre-final, /saldo-comisiones, /semana-por-dias y
// /comisiones-devueltas-por-hipodromo (la referencia, ya arreglada en la
// Ronda 2) deben dar TODOS 0,67 para CODINO, nunca 0,66.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-multilinea-balance-1';
const FECHA = '2026-10-02';

const TABLAS = {
  jugadores: [
    { id: 'j-codino', grupo_id: GRUPO_ID, nombre: 'CODINO', comision_propia: 1, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }
  ],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-carrera7', grupo_id: GRUPO_ID, hipodromo_nombre: 'Belmont Park', carrera_numero: 7, fecha: FECHA, cruza_jugadas: false, comision_total: 0 }
  ],
  // CODINO pierde las 2 líneas (misma carrera, mismo caballo, 2
  // modalidades distintas) -- CASA1 (banquero) sin % propio configurado,
  // no estorba la cuenta.
  hipismo_tickets: [
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'CODINO', banquero_nombre: 'CASA1', modalidad: '2/2', caballo: '7', monto: 33.33, resultado_jugador: -33.33, resultado_banquero: 33.33 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'CODINO', banquero_nombre: 'CASA1', modalidad: '2p', caballo: '7', monto: 33.33, resultado_jugador: -33.33, resultado_banquero: 33.33 * 0.95, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: [],
  hipismo_winners: [], hipismo_comisiones_ajustes: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias (compartida por TODAS las rutas) ----
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && (!nombres || nombres.includes(j.nombre)));
    return { rows: filas.map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas || false })) };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    return { rows: [] };
  }

  // ---- /comisiones-devueltas-por-hipodromo (referencia, un solo día) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.numero_ejemplar, a\.monto, r\.hipodromo_nombre, r\.carrera_numero, r\.numero_ganador, r\.hubo_ganador\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.banqueadores, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }

  // ---- /cierre-final (rango, BETWEEN) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision || false, cruza_jugadas: p.cruza_jugadas || false, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto, j\.gano.*\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes\s+WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3\s+GROUP BY cliente_nombre/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }

  // ---- /saldo-comisiones (semana, BETWEEN) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.monto, j\.resultado_cliente, j\.banqueadores, j\.gano.*\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }

  // ---- /semana-por-dias (semana, BETWEEN) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision || false, cruza_jugadas: p.cruza_jugadas || false, fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto, r\.fecha\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores, j\.monto, j\.gano, p\.fecha, p\.hipodromo_nombre, j\.carrera_numero\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_winners WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3 GROUP BY fecha$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3 GROUP BY fecha$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT p\.fecha AS fecha, j\.comision\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (multiples-lineas-balance-general) no sabe responder: ' + sql);
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
  // "Saldo Comisiones" y "Semana por Días" usan `semana` (actual/
  // anterior/hace2), no un rango personalizado -- se fuerza la fecha de
  // "hoy" a la misma FECHA de la prueba (mismo patrón EXACTO que ya usan
  // test_hipismo_neteo_saldo_comisiones.js / test_hipismo_neteo_semana_
  // por_dias.js) para que caiga dentro de "semana actual".
  const OriginalDate = Date;
  const fake = new OriginalDate(FECHA + 'T12:00:00Z').getTime();
  global.Date = class extends OriginalDate { constructor(...a) { if (a.length === 0) super(fake); else super(...a); } static now() { return fake; } };

  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };

  // ---- 0) GET /comisiones-devueltas-por-hipodromo (referencia, ya
  // arreglada en la Ronda 2 -- da 0,67) ----
  const salidaHip = await invocarRuta(handlerDe('get', '/comisiones-devueltas-por-hipodromo'), { ...reqBase, query: { fecha: FECHA } });
  const belmont = (salidaHip && salidaHip.hipodromos || []).find(h => h.nombre === 'Belmont Park');
  check(!!belmont && Math.abs(belmont.totalDevuelto - 0.67) < 0.0001,
    `0) REFERENCIA: /comisiones-devueltas-por-hipodromo da 0,67 para Belmont Park -- dio ${belmont ? belmont.totalDevuelto : 'nada'}`);

  // ---- 1) GET /cierre-final (Balance General) ----
  const salidaCierre = await invocarRuta(handlerDe('get', '/cierre-final'), { ...reqBase, query: { desde: FECHA, hasta: FECHA } });
  check(!!salidaCierre, '1a) GET /cierre-final respondió algo');
  const codinoCierre = (salidaCierre && salidaCierre.clientes || []).find(c => c.nombre === 'CODINO - PORCENTAJE');
  check(!!codinoCierre && Math.abs(codinoCierre.saldo - 0.67) < 0.0001,
    `1b) ARREGLO: "CODINO - PORCENTAJE" da 0,67 en /cierre-final (exacto de sus 2 líneas en la misma carrera, redondeado 1 sola vez), NUNCA 0,66 -- dio ${codinoCierre ? codinoCierre.saldo : 'nada'}`);

  // ---- 2) GET /saldo-comisiones ----
  const salidaSaldo = await invocarRuta(handlerDe('get', '/saldo-comisiones'), { ...reqBase, query: {} });
  check(!!salidaSaldo, '2a) GET /saldo-comisiones respondió algo');
  const codinoSaldo = (salidaSaldo && salidaSaldo.clientes || []).find(c => c.nombre === 'CODINO');
  check(!!codinoSaldo && Math.abs(codinoSaldo.devueltoSemana - 0.67) < 0.0001,
    `2b) ARREGLO: CODINO da 0,67 en /saldo-comisiones, NUNCA 0,66 -- dio ${codinoSaldo ? codinoSaldo.devueltoSemana : 'nada'}`);

  // ---- 3) GET /semana-por-dias ----
  const salidaSemana = await invocarRuta(handlerDe('get', '/semana-por-dias'), { ...reqBase, query: {} });
  check(!!salidaSemana, '3a) GET /semana-por-dias respondió algo');
  const codinoSemana = (salidaSemana && salidaSemana.clientes || []).find(c => c.nombre === 'CODINO - PORCENTAJE');
  check(!!codinoSemana && Math.abs(codinoSemana.totalSemana - 0.67) < 0.0001,
    `3b) ARREGLO: CODINO da 0,67 de totalSemana en /semana-por-dias, NUNCA 0,66 -- dio ${codinoSemana ? codinoSemana.totalSemana : 'nada'}`);

  // ---- 4) Las 4 pantallas DEBEN COINCIDIR centavo a centavo ----
  check(belmont && codinoCierre && codinoSaldo && codinoSemana &&
    belmont.totalDevuelto === codinoCierre.saldo &&
    codinoCierre.saldo === codinoSaldo.devueltoSemana &&
    codinoSaldo.devueltoSemana === codinoSemana.totalSemana,
    `4) ARREGLO PRINCIPAL: por-hipódromo, cierre-final, saldo-comisiones y semana-por-dias dan EXACTAMENTE el mismo total para CODINO -- ${belmont ? belmont.totalDevuelto : 'nada'} / ${codinoCierre ? codinoCierre.saldo : 'nada'} / ${codinoSaldo ? codinoSaldo.devueltoSemana : 'nada'} / ${codinoSemana ? codinoSemana.totalSemana : 'nada'}`);

  global.Date = OriginalDate;
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
