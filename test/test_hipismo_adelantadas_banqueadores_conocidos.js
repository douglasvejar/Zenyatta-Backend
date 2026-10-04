// =================================================================
// PRUEBA: GET /api/hipismo/adelantadas/banqueadores (28-09-2026, a
// pedido del usuario: "en marcas adelantadas despliegame una lista con
// los banqueros que ya agregue en marcas anteriores para no tener que
// escribir todas las veces lo mismo") — ver la nota grande de la ruta
// en routes/hipismo.js.
//
// Casos cubiertos:
//   1. Junta los nombres de banqueadores de VARIAS Marcas ya resueltas
//      (banqueadores es un array jsonb por jugada, puede haber más de
//      uno por Marca) en una sola lista, SIN duplicados.
//   2. Ordena alfabéticamente.
//   3. Nunca mezcla banqueadores de OTRO grupo (grupo_id distinto).
//   4. Una Marca todavía sin banquear (banqueadores IS NULL) no rompe
//      nada y no aporta ningún nombre.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-banqueadores-1';
const OTRO_GRUPO_ID = 'grupo-banqueadores-2';

const TABLAS = {
  hipismo_adelantadas_jugadas: [
    // Misma persona (BANCA ZENYATTA) banqueó 2 Marcas distintas — debe
    // salir UNA sola vez en la lista, no repetida.
    { id: 'j1', grupo_id: GRUPO_ID, banqueadores: [{ nombre: 'BANCA ZENYATTA', porcentaje: 100, pagaComision: true, monto: 10 }] },
    { id: 'j2', grupo_id: GRUPO_ID, banqueadores: [{ nombre: 'BANCA ZENYATTA', porcentaje: 60, pagaComision: false, monto: 6 }, { nombre: 'PEDRO', porcentaje: 40, pagaComision: true, monto: 4 }] },
    // Todavía sin banquear -- no debe romper la consulta ni aportar nada.
    { id: 'j3', grupo_id: GRUPO_ID, banqueadores: null },
    // De OTRO grupo -- nunca debe mezclarse en la respuesta de arriba.
    { id: 'j4', grupo_id: OTRO_GRUPO_ID, banqueadores: [{ nombre: 'BANQUERO AJENO', porcentaje: 100, pagaComision: true, monto: 5 }] }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^SELECT DISTINCT b->>'nombre' AS nombre\s+FROM hipismo_adelantadas_jugadas j, jsonb_array_elements\(j\.banqueadores\) b\s+WHERE j\.grupo_id = \$1 AND j\.banqueadores IS NOT NULL\s+ORDER BY nombre$/i.test(sql)) {
    const [grupoId] = params;
    const nombres = new Set();
    TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && Array.isArray(j.banqueadores))
      .forEach(j => j.banqueadores.forEach(b => nombres.add(b.nombre)));
    return { rows: Array.from(nombres).sort().map(nombre => ({ nombre })) };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.\* FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

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
const handlerBanqueadores = handlerDe('get', '/adelantadas/banqueadores');

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

function reqBase(grupoId) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, params: {}, query: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const res = await invocarRuta(handlerBanqueadores, reqBase(GRUPO_ID));
  check(res._status === 200, '1) GET /adelantadas/banqueadores responde 200');
  check(Array.isArray(res._json.banqueadores), 'La respuesta trae un arreglo "banqueadores"');
  check(res._json.banqueadores.length === 2, 'Solo 2 nombres distintos: BANCA ZENYATTA (sin repetir) y PEDRO — j3 (sin banquear) no aporta nada');
  check(res._json.banqueadores.includes('BANCA ZENYATTA'), 'Incluye "BANCA ZENYATTA" (banqueó 2 Marcas, sale una sola vez)');
  check(res._json.banqueadores.includes('PEDRO'), 'Incluye "PEDRO"');
  check(!res._json.banqueadores.includes('BANQUERO AJENO'), '"BANQUERO AJENO" (de OTRO grupo) NUNCA aparece');
  check(JSON.stringify(res._json.banqueadores) === JSON.stringify(['BANCA ZENYATTA', 'PEDRO']), 'Viene ordenado alfabéticamente');

  const resOtro = await invocarRuta(handlerBanqueadores, reqBase(OTRO_GRUPO_ID));
  check(resOtro._json.banqueadores.length === 1 && resOtro._json.banqueadores[0] === 'BANQUERO AJENO', 'El otro grupo ve SOLO su propio banquero, aislado del primero');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
