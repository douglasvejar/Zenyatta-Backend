// =================================================================
// PRUEBA: neteo jugador vs banquero por carrera (Tercios), aplicado a
// "Pizarras" — GET /api/hipismo/pizarras (02-10-2026, Task #42 del
// barrido completo pedido por el usuario — ver la nota grande EXACTA de
// netearJugadorBanqueroTercios en services/hipismoCalc.js, y la nueva
// lógica de neteo en calcularDevueltoPorPlanoTercios, routes/hipismo.js).
//
// Mismo escenario de GG, pero esta vez ya GUARDADO en un solo plano (una
// sola carrera): GG jugó 30 (perdió) y banqueó 10 (ganó neto) -> neto 20.
// El montoTotal que muestra "Pizarras" para este plano es la comisión
// NETA (comision_total menos el % propio/aval devuelto de ESE plano) —
// comision_total = 1,50 (de GG/MARLON1) + 0,50 (de PEPE/GG) = 2,00.
// Devuelto (1% cada uno): GG neto 0,20 + MARLON1 0,30 + PEPE 0,10 = 0,60.
// montoTotal esperado = 2,00 - 0,60 = 1,40 -- NUNCA 1,20 (si no neteara,
// devuelto sería 0,80: GG 0,30+0,10 sin netear + MARLON1 0,30 + PEPE 0,10).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-neteo-pizarras-1';
const FECHA = '2026-10-02';

const PCT = 1;
const TABLAS = {
  jugadores: [
    { id: 'j-gg', grupo_id: GRUPO_ID, nombre: 'GG', comision_propia: PCT },
    { id: 'j-marlon1', grupo_id: GRUPO_ID, nombre: 'MARLON1', comision_propia: PCT },
    { id: 'j-pepe', grupo_id: GRUPO_ID, nombre: 'PEPE', comision_propia: PCT }
  ],
  hipismo_planos: [
    { id: 'plano-gg', grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'La Rinconada', carrera_numero: 7, pizarra: '3.1.2', comision_total: 2.00 }
  ],
  // GG jugó 30 (perdió, -30) y MARLON1 lo banqueó (ganó neto 28,50).
  // PEPE jugó 10 (perdió, -10) y GG lo banqueó (ganó neto 9,50).
  hipismo_tickets: [
    { plano_id: 'plano-gg', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'MARLON1', monto: 30, resultado_jugador: -30, resultado_banquero: 28.5, sin_comision: false },
    { plano_id: 'plano-gg', grupo_id: GRUPO_ID, cliente_nombre: 'PEPE', banquero_nombre: 'GG', monto: 10, resultado_jugador: -10, resultado_banquero: 9.5, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

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

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (neteo-pizarras) no sabe responder: ' + sql);
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

  const salida = await invocarRuta(handlerDe('get', '/pizarras'), { ...reqBase, query: { desde: FECHA, hasta: FECHA } });
  check(!!salida, '1) GET /pizarras respondió algo');
  const fila = (salida && salida.filas || []).find(f => f.tipo === 'tercios' && f.id === 'plano-gg');
  check(!!fila, '2) Trae el plano de GG');
  check(!!fila && Math.abs(fila.montoTotal - 1.40) < 0.001,
    `3) ARREGLO: montoTotal neto del plano = 1,40 (comisión bruta 2,00 menos 0,60 de % devuelto YA neteado), nunca 1,20 (sin netear, 0,80 de devuelto) -- dio ${fila ? fila.montoTotal : 'nada'}`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
