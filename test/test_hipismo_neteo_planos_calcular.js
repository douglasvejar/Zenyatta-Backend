// =================================================================
// PRUEBA: neteo jugador vs banquero por carrera (Tercios), aplicado a la
// vista previa de "Cargar Planos" — POST /api/hipismo/planos/calcular
// (02-10-2026, Task #42 del barrido completo pedido por el usuario — ver
// la nota grande EXACTA de netearJugadorBanqueroTercios en
// services/hipismoCalc.js, y entradasApostadasDeTickets en
// routes/hipismo.js, compartida por /planos/calcular y POST /planos).
//
// Caso real que disparó este arreglo: el usuario mandó un plano con GG
// jugando una modalidad Y banqueando otra, TODO en la misma carrera
// (mismo texto, una sola pizarra) — "gg juega y banquea y queda en 0 en
// esa carrera, alli no tienes que pagarle comision de nada". Esta prueba
// reproduce ese caso en UNA sola carrera (una sola llamada a
// /planos/calcular, el mismo "Cargar Planos" de siempre):
//   - GG juega 1p al caballo 5 con 30,00 (pierde, el caballo 5 nunca
//     entra en el 1er lugar según la pizarra).
//   - PEPE juega 1p al caballo 5 con 10,00 Y GG es su banquero (PEPE
//     pierde, así que GG gana banqueando 10 netos de comisión = 9,50).
//   - decididoJugador(GG) = 30, decididoBanquero(GG) = 10 -> neto = 20.
//   - Con 1% de % propio: "GG - PORCENTAJE" debe dar 0,20 -- NUNCA 0,40
//     (30+10 sin netear) ni 0 (si el sistema cancelara los montos en vez
//     de restarlos).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-neteo-planos-calcular-1';

const PCT = 1;
const TABLAS = {
  jugadores: [
    { id: 'j-gg', grupo_id: GRUPO_ID, nombre: 'GG', comision_propia: PCT },
    { id: 'j-marlon1', grupo_id: GRUPO_ID, nombre: 'MARLON1', comision_propia: PCT },
    { id: 'j-pepe', grupo_id: GRUPO_ID, nombre: 'PEPE', comision_propia: PCT }
  ],
  jugadores_avales_porcentaje: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias ----
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && (!nombres || nombres.includes(j.nombre)));
    return { rows: filas.map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cc_propio_nombre: null })) };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    return { rows: [] };
  }

  throw new Error('La base de datos falsa de esta prueba (neteo-planos-calcular) no sabe responder: ' + sql);
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

  // Pizarra "3.1.2": el caballo 3 llega 1ro -- el caballo 5 (el que juegan
  // GG y PEPE en 1p) nunca entra en el 1er lugar, así que AMBOS pierden su
  // lado jugador.
  const texto = 'Juega GG 1p (5) con 30,00 da MARLON1\nJuega PEPE 1p (5) con 10,00 da GG';
  const { salida, status } = await invocarRuta(handlerDe('post', '/planos/calcular'), {
    ...reqBase, body: { texto, pizarra: '3.1.2', cruzaJugadas: false }
  });
  check(status === 200 && !!salida, '1) POST /planos/calcular respondió 200 con algo');
  check(salida && salida.cantidadTickets === 2, `2) Se reconocieron las 2 líneas -- cantidadTickets=${salida ? salida.cantidadTickets : 'nada'}`);

  const totales = (salida && salida.totalesFinales) || {};
  check(Math.abs((totales['GG - PORCENTAJE'] || 0) - 0.20) < 0.001,
    `3) ARREGLO: "GG - PORCENTAJE" da 0,20 (neto de jugó 30 y banqueó 10 en la MISMA carrera), nunca 0,40 (sin netear) ni 0 (cancelado) -- dio ${totales['GG - PORCENTAJE']}`);
  check(Math.abs((totales['MARLON1 - PORCENTAJE'] || 0) - 0.30) < 0.001,
    `4) MARLON1 - PORCENTAJE (solo banqueó, un solo rol) da 0,30 sin cambios -- dio ${totales['MARLON1 - PORCENTAJE']}`);
  check(Math.abs((totales['PEPE - PORCENTAJE'] || 0) - 0.10) < 0.001,
    `5) PEPE - PORCENTAJE (solo jugó, un solo rol) da 0,10 sin cambios -- dio ${totales['PEPE - PORCENTAJE']}`);

  // Regresión: el saldo normal de GG (jugadas, nunca tocado por el neteo
  // del % devuelto) sigue siendo -30 (perdió) + 9,5 (ganó banqueando) = -20,5.
  check(Math.abs((totales['GG'] || 0) - (-20.5)) < 0.001,
    `6) REGRESIÓN: el saldo normal de GG sigue dando -20,50 (-30 jugando + 9,50 banqueando) -- dio ${totales['GG']}`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
