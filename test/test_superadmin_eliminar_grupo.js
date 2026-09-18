// =================================================================
// PRUEBA: DELETE /api/superadmin/grupos/:id (18-09-2026, a pedido del
// usuario: "no tengo la opcion de eliminar grupos"). Mismo patrón de
// base de datos falsa + express falso que test_superadmin_logo.js —
// invoca el handler real de la ruta directo, sin levantar un servidor
// HTTP.
//
// La base de datos falsa simula el "on delete cascade" real de
// sql/schema.sql: al borrar la fila de grupos, esta prueba también
// borra a mano las filas relacionadas en otras tablas falsas, para
// confirmar que la RUTA (que solo hace un DELETE FROM grupos) no
// necesita hacer nada más — Postgres se encarga del resto solo.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  grupos: [
    { id: 'grupo-1', nombre: 'Deportes Zenyatta TX' },
    { id: 'grupo-2', nombre: 'Otro Grupo' }
  ],
  // simulan tablas con "on delete cascade" hacia grupos(id)
  jugadores: [{ id: 'j1', grupo_id: 'grupo-1' }, { id: 'j2', grupo_id: 'grupo-2' }],
  tickets_historial: [{ id: 't1', grupo_id: 'grupo-1' }]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^DELETE FROM grupos WHERE id = \$1 RETURNING id, nombre$/i.test(sql)) {
    const [id] = params;
    const idx = TABLAS.grupos.findIndex(g => g.id === id);
    if (idx === -1) return { rows: [] };
    const [borrado] = TABLAS.grupos.splice(idx, 1);
    // simula el "on delete cascade" de verdad de Postgres
    TABLAS.jugadores = TABLAS.jugadores.filter(j => j.grupo_id !== id);
    TABLAS.tickets_historial = TABLAS.tickets_historial.filter(t => t.grupo_id !== id);
    return { rows: [{ id: borrado.id, nombre: borrado.nombre }] };
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
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'x' }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.SUPERADMIN_SECRET = 'fake-secret';

const superadminRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin'));

Module._load = originalLoad;

const entradaEliminar = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'delete' && args[0] === '/grupos/:id');
const handlerEliminar = entradaEliminar[1][1];

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

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  check(TABLAS.grupos.length === 2, 'arranca con 2 grupos (sanity check)');

  // --- Eliminar un grupo que existe ---
  const req1 = { params: { id: 'grupo-1' } };
  const res1 = await invocarRuta(handlerEliminar, req1);
  check(res1._status === 200, 'Eliminar un grupo existente responde 200');
  check(res1._json.eliminado === true, 'La respuesta confirma eliminado:true');
  check(res1._json.id === 'grupo-1' && res1._json.nombre === 'Deportes Zenyatta TX', 'La respuesta devuelve el id y nombre del grupo borrado');
  check(TABLAS.grupos.find(g => g.id === 'grupo-1') === undefined, 'El grupo ya no está en la tabla de grupos');
  check(TABLAS.jugadores.find(j => j.grupo_id === 'grupo-1') === undefined, 'Sus jugadores quedaron borrados en cascada (simulando el ON DELETE CASCADE real de Postgres)');
  check(TABLAS.tickets_historial.find(t => t.grupo_id === 'grupo-1') === undefined, 'Su historial de tickets quedó borrado en cascada');

  // --- Los datos de OTRO grupo no se tocan ---
  check(TABLAS.grupos.find(g => g.id === 'grupo-2') !== undefined, 'El otro grupo (grupo-2) sigue existiendo, sin tocar');
  check(TABLAS.jugadores.find(j => j.grupo_id === 'grupo-2') !== undefined, 'Los jugadores del otro grupo siguen existiendo, sin tocar');

  // --- Eliminar un grupo que NO existe ---
  const req2 = { params: { id: 'grupo-fantasma' } };
  const res2 = await invocarRuta(handlerEliminar, req2);
  check(res2._status === 404, 'Un grupo_id que no existe da 404, no revienta el servidor');
  check(TABLAS.grupos.length === 1, 'Nada se borró de más al intentar eliminar un grupo inexistente');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de DELETE /grupos/:id se cayó con una excepción:', e);
  process.exit(1);
});
