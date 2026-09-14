// =================================================================
// PRUEBA: PATCH /api/superadmin/grupos/:id/logo (01-09-2026, a pedido
// del usuario: "los logos... solo se pueden agregar o editar desde
// super admin"). Mismo patrón de base de datos falsa + express falso que
// test_cliente_ruta.js — invoca el handler real de la ruta directo, sin
// levantar un servidor HTTP.
//
// Cubre: guarda una URL válida, un string vacío BORRA el logo (queda
// null), una URL que no empieza con http(s):// se rechaza con 400 sin
// tocar la base, y un grupo_id que no existe da 404.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  grupos: [
    { id: 'grupo-1', nombre: 'Deportes Zenyatta TX', logo_url: null }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^UPDATE grupos SET logo_url = \$1 WHERE id = \$2 RETURNING logo_url/i.test(sql)) {
    const [logoUrl, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.logo_url = logoUrl;
    return { rows: [{ logo_url: grupo.logo_url }] };
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

const entradaLogo = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'patch' && args[0] === '/grupos/:id/logo');
const handlerLogo = entradaLogo[1][1];

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
  // --- URL válida ---
  const req1 = { params: { id: 'grupo-1' }, body: { logoUrl: 'https://ejemplo.com/logo.png' } };
  const res1 = await invocarRuta(handlerLogo, req1);
  check(res1._status === 200, 'Guardar una URL válida responde 200');
  check(res1._json.logoUrl === 'https://ejemplo.com/logo.png', 'La respuesta devuelve la URL guardada');
  check(TABLAS.grupos[0].logo_url === 'https://ejemplo.com/logo.png', 'La URL quedó guardada de verdad en la fila del grupo');

  // --- String vacío borra el logo ---
  const req2 = { params: { id: 'grupo-1' }, body: { logoUrl: '' } };
  const res2 = await invocarRuta(handlerLogo, req2);
  check(res2._json.logoUrl === null, 'Mandar logoUrl vacío borra el logo (queda null en la respuesta)');
  check(TABLAS.grupos[0].logo_url === null, 'El logo quedó null de verdad en la fila del grupo');

  // --- URL inválida (no empieza con http:// ni https://) ---
  TABLAS.grupos[0].logo_url = 'https://algo-previo.com/x.png'; // para confirmar que NO se pisa con la inválida
  const req3 = { params: { id: 'grupo-1' }, body: { logoUrl: 'ftp://no-sirve.com/x.png' } };
  const res3 = await invocarRuta(handlerLogo, req3);
  check(res3._status === 400, 'Una URL que no es http(s) se rechaza con 400');
  check(TABLAS.grupos[0].logo_url === 'https://algo-previo.com/x.png', 'Rechazada la URL inválida, el logo anterior queda intacto (no se pisó con nada)');

  // --- Grupo que no existe ---
  const req4 = { params: { id: 'grupo-que-no-existe' }, body: { logoUrl: 'https://ejemplo.com/x.png' } };
  const res4 = await invocarRuta(handlerLogo, req4);
  check(res4._status === 404, 'Un grupo_id que no existe da 404, no revienta el servidor');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de PATCH /grupos/:id/logo se cayó con una excepción:', e);
  process.exit(1);
});
