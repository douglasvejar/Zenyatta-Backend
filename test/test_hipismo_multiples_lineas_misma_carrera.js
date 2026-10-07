// =================================================================
// PRUEBA: un cliente con VARIAS líneas en la MISMA carrera (02-10-2026,
// el usuario comparó "Comisiones Devueltas por Cliente" ($77,60) contra
// "Comisiones Devueltas por Hipódromo/Carrera" ($77,52) el mismo día y
// dieron distinto -- "DEBEN DAR LO MISMO... EL RESULTADO QUE ESTA
// PERFECTO ES EL DE Comisiones Devueltas por Hipódromo/Carrera").
//
// Causa real: cuando un cliente juega MÁS DE UNA línea en la MISMA
// carrera (ej. "2/2 (7)" Y "2p (7)" del mismo caballo -- como CODINO en
// el ejemplo original del usuario, de lo más común, no una rareza),
// /comisiones-devueltas empujaba un `devuelto` YA redondeado POR CADA
// TICKET por separado y sumaba esos redondeados, mientras que
// /comisiones-devueltas-por-hipodromo junta primero el EXACTO de todos
// los tickets de esa carrera bajo el mismo código y redondea una sola
// vez. Sumar redondeados de a uno vs. redondear la suma exacta una sola
// vez no siempre da el mismo centavo.
//
// CODINO juega 2 líneas perdidas de 33,33 cada una en la MISMA carrera,
// con 1% propio:
//   - por ticket: 33,33 * 1% = 0,3333 -> redondeado a 0,33 cada uno ->
//     sumados por separado (el bug) = 0,66
//   - exacto: 0,3333 + 0,3333 = 0,6666 -> redondeado UNA vez = 0,67
// Ambas pantallas deben dar 0,67 ahora, nunca 0,66.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-multilinea-1';
const FECHA = '2026-10-02';

const TABLAS = {
  jugadores: [
    { id: 'j-codino', grupo_id: GRUPO_ID, nombre: 'CODINO', comision_propia: 1, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }
  ],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-carrera7', grupo_id: GRUPO_ID, hipodromo_nombre: 'Belmont Park', carrera_numero: 7, fecha: FECHA }
  ],
  // CODINO pierde las 2 líneas (misma carrera, mismo caballo, 2
  // modalidades distintas) -- CASA1 (banquero) sin % propio configurado,
  // no estorba la cuenta.
  hipismo_tickets: [
    { id: 't-codino-1', plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'CODINO', banquero_nombre: 'CASA1', modalidad: '2/2', caballo: '7', monto: 33.33, resultado_jugador: -33.33, resultado_banquero: 33.33 * 0.95 },
    { id: 't-codino-2', plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'CODINO', banquero_nombre: 'CASA1', modalidad: '2p', caballo: '7', monto: 33.33, resultado_jugador: -33.33, resultado_banquero: 33.33 * 0.95 }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  if (sql === 'SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])') {
    return { rows: [] };
  }
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1') {
    const [grupoId] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }

  // ---- obtenerApuestasDelDia (UN solo día, p.fecha = $2) ----
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
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.sin_comision, j\.banqueadores, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (multiples-lineas-misma-carrera) no sabe responder: ' + sql);
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
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };

  // ---- 1) GET /comisiones-devueltas?fecha= ----
  const salida = await invocarRuta(handlerDe('get', '/comisiones-devueltas'), { ...reqBase, query: { fecha: FECHA } });
  const filaCodino = (salida && salida.clientes || []).find(c => c.nombre === 'CODINO');
  check(!!filaCodino && Math.abs(filaCodino.total - 0.67) < 0.0001,
    `1a) ARREGLO: /comisiones-devueltas da 0,67 para CODINO (exacto de sus 2 líneas en la misma carrera, redondeado 1 sola vez), NUNCA 0,66 (sumar 0,33+0,33 ya redondeados) -- dio ${filaCodino ? filaCodino.total : 'nada'}`);
  const hip = filaCodino && filaCodino.hipodromos.find(h => h.nombre === 'Belmont Park');
  check(!!hip && hip.carreras.length === 1,
    `1b) sus 2 líneas de la carrera 7 se funden en UN solo renglón de carrera, no 2 -- trajo ${hip ? hip.carreras.length : 'nada'}`);
  check(!!hip && Math.abs(hip.carreras[0].devuelto - 0.67) < 0.0001,
    `1c) ese renglón fundido da 0,67 -- dio ${hip ? hip.carreras[0].devuelto : 'nada'}`);
  check(!!hip && hip.carreras[0].detalleTexto === '2/2 (7) + 2p (7)',
    `1d) el detalle del renglón fundido lista las 2 modalidades -- dio ${hip ? hip.carreras[0].detalleTexto : 'nada'}`);
  check(!!hip && Math.abs(hip.carreras[0].monto - 66.66) < 0.0001,
    `1e) el monto apostado del renglón fundido suma las 2 líneas (33,33+33,33=66,66) -- dio ${hip ? hip.carreras[0].monto : 'nada'}`);

  // ---- 2) GET /comisiones-devueltas-por-hipodromo?fecha= (debe COINCIDIR) ----
  const salidaHip = await invocarRuta(handlerDe('get', '/comisiones-devueltas-por-hipodromo'), { ...reqBase, query: { fecha: FECHA } });
  const belmont = (salidaHip && salidaHip.hipodromos || []).find(h => h.nombre === 'Belmont Park');
  check(!!belmont && Math.abs(belmont.totalDevuelto - 0.67) < 0.0001,
    `2a) /comisiones-devueltas-por-hipodromo también da 0,67 -- dio ${belmont ? belmont.totalDevuelto : 'nada'}`);

  // ---- 3) Las 2 pantallas DEBEN COINCIDIR centavo a centavo ----
  check(filaCodino && belmont && filaCodino.total === belmont.totalDevuelto,
    `3a) ARREGLO PRINCIPAL: /comisiones-devueltas y /comisiones-devueltas-por-hipodromo dan EXACTAMENTE el mismo total para CODINO/Belmont Park -- ${filaCodino ? filaCodino.total : 'nada'} vs ${belmont ? belmont.totalDevuelto : 'nada'}`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
