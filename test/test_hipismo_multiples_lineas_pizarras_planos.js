// =================================================================
// PRUEBA: un cliente con VARIAS líneas en la MISMA carrera (02-10-2026,
// Ronda 4 del barrido de redondeo -- ver test_hipismo_multiples_lineas_
// balance_general.js para el caso real de Balance General que disparó
// este arreglo), ahora en los 2 lugares que faltaban del barrido
// completo: "Pizarras" (comisión neta del plano) y "Cargar Planos"
// (vista previa de POST /planos/calcular).
//
// Mismo escenario EXACTO que las otras pruebas de esta ronda: CODINO
// juega 2 líneas perdidas de 33,33 cada una en la MISMA carrera, con 1%
// propio -- el % devuelto correcto es 0,67 (exacto 0,6666 redondeado una
// sola vez), nunca 0,66 (0,33+0,33 ya redondeados por separado).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-multilinea-pizarras-1';
const FECHA = '2026-10-02';

const TABLAS = {
  jugadores: [
    { id: 'j-codino', grupo_id: GRUPO_ID, nombre: 'CODINO', comision_propia: 1 }
  ],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    // comision_total inventada (3,00) -- lo que importa es que montoTotal
    // (comisión NETA) descuente 0,67 de devuelto, nunca 0,66.
    { id: 'p-carrera7', grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'Belmont Park', carrera_numero: 7, pizarra: '1.2.3', comision_total: 3.00 }
  ],
  hipismo_tickets: [
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'CODINO', banquero_nombre: 'CASA1', modalidad: '2/2', caballo: '7', monto: 33.33, resultado_jugador: -33.33, resultado_banquero: 33.33 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'CODINO', banquero_nombre: 'CASA1', modalidad: '2p', caballo: '7', monto: 33.33, resultado_jugador: -33.33, resultado_banquero: 33.33 * 0.95, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- GET /pizarras ----
  if (/^SELECT p\.id, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero, p\.pizarra, p\.comision_total, \(SELECT COUNT\(\*\)::int FROM hipismo_tickets t WHERE t\.plano_id = p\.id\) AS cantidad FROM hipismo_planos p WHERE p\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_planos
      .filter(p => p.grupo_id === grupoId && p.fecha >= desde && p.fecha <= hasta)
      .map(p => ({ id: p.id, fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, pizarra: p.pizarra, comision_total: p.comision_total, cantidad: TABLAS.hipismo_tickets.filter(t => t.plano_id === p.id).length }));
    return { rows: filas };
  }
  if (/^SELECT r\.id, r\.fecha, r\.hipodromo_nombre, r\.carrera_numero, r\.pizarra, r\.pool_total/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT p\.fecha, p\.hipodromo_nombre, j\.carrera_numero, COUNT\(\*\)::int AS cantidad/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT plano_id, cliente_nombre, banquero_nombre, monto, resultado_jugador, resultado_banquero, sin_comision FROM hipismo_tickets WHERE plano_id = ANY\(\$1::uuid\[\]\)$/i.test(sql)) {
    const [planoIds] = params;
    return { rows: TABLAS.hipismo_tickets.filter(t => planoIds.includes(t.plano_id)) };
  }

  // ---- obtenerComisionesPropias (compartida) ----
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre, j\.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio\.id = j\.cuenta_comision_id WHERE j\.grupo_id = \$1 AND j\.nombre = ANY\(\$2::text\[\]\)$/i.test(sql)) {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: false })) };
  }
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre, j\.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio\.id = j\.cuenta_comision_id WHERE j\.grupo_id = \$1$/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: false })) };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.\* FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (multiples-lineas-pizarras-planos) no sabe responder: ' + sql);
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
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { salida, status };
}

(async function main() {
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };

  // ---- 1) GET /pizarras: comisión NETA del plano ----
  const { salida: salidaPizarras } = await invocarRuta(handlerDe('get', '/pizarras'), { ...reqBase, query: { desde: FECHA, hasta: FECHA } });
  check(!!salidaPizarras, '1a) GET /pizarras respondió algo');
  const filaPlano = (salidaPizarras && salidaPizarras.filas || []).find(f => f.tipo === 'tercios' && f.id === 'p-carrera7');
  check(!!filaPlano, '1b) Trae el plano de CODINO');
  check(!!filaPlano && Math.abs(filaPlano.montoTotal - 2.33) < 0.001,
    `1c) ARREGLO: montoTotal neto del plano = 2,33 (comisión bruta 3,00 menos 0,67 de % devuelto fusionado por carrera), NUNCA 2,34 (si se restara 0,66, suma de 0,33+0,33 ya redondeados) -- dio ${filaPlano ? filaPlano.montoTotal : 'nada'}`);

  // ---- 2) POST /planos/calcular (vista previa de Cargar Planos) ----
  // Pizarra "1.2.3": el caballo 7 (el que juega CODINO en "2/2" y "2p")
  // no entra en el 1er, 2do ni 3er lugar -- pierde COMPLETO en ambas
  // modalidades (mismo criterio EXACTO que montoDecididoExacto/
  // resolverModalidad ya prueban en otros archivos de esta suite).
  const texto = 'Juega CODINO 2/2 (7) con 33,33 da CASA1\nJuega CODINO 2p (7) con 33,33 da CASA1';
  const { salida: salidaPlanos, status } = await invocarRuta(handlerDe('post', '/planos/calcular'), {
    ...reqBase, body: { texto, pizarra: '1.2.3', cruzaJugadas: false }
  });
  check(status === 200 && !!salidaPlanos, '2a) POST /planos/calcular respondió 200 con algo');
  check(salidaPlanos && salidaPlanos.cantidadTickets === 2, `2b) Se reconocieron las 2 líneas -- cantidadTickets=${salidaPlanos ? salidaPlanos.cantidadTickets : 'nada'}`);

  const totales = (salidaPlanos && salidaPlanos.totalesFinales) || {};
  check(Math.abs((totales['CODINO - PORCENTAJE'] || 0) - 0.67) < 0.001,
    `2c) ARREGLO: "CODINO - PORCENTAJE" da 0,67 (exacto de sus 2 líneas en la misma carrera, redondeado 1 sola vez), NUNCA 0,66 -- dio ${totales['CODINO - PORCENTAJE']}`);

  // Regresión: el saldo normal de CODINO (jugadas, nunca tocado por este
  // arreglo) sigue siendo -33,33 -33,33 = -66,66.
  check(Math.abs((totales['CODINO'] || 0) - (-66.66)) < 0.001,
    `2d) REGRESIÓN: el saldo normal de CODINO sigue dando -66,66 -- dio ${totales['CODINO']}`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
