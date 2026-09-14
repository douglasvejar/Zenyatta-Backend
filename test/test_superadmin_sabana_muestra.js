// =================================================================
// PRUEBA: PATCH /api/superadmin/grupos/:id/sabana-muestra (05-09-2026,
// a pedido del usuario, después de la charla sobre cómo manejar grupos
// con estilos de sábana distintos: "Si me sirve asi hazlo como dices
// para probarlo" — la "sábana de muestra" es un campo de referencia,
// EXCLUSIVO de Súper-admin, que guarda un mensaje real de ejemplo de
// cómo un grupo particular escribe su sábana; no lo usa ninguna lógica
// de parseo). Mismo patrón de base de datos falsa + express falso que
// test_superadmin_logo.js — invoca el handler real de la ruta directo,
// sin levantar un servidor HTTP.
//
// Cubre: guarda un texto, un string vacío (o solo espacios) BORRA la
// muestra (queda null), y un grupo_id que no existe da 404.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  grupos: [
    { id: 'grupo-1', nombre: 'Deportes Zenyatta TX', sabana_muestra: null }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^UPDATE grupos SET sabana_muestra = \$1 WHERE id = \$2 RETURNING sabana_muestra/i.test(sql)) {
    const [sabanaMuestra, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.sabana_muestra = sabanaMuestra;
    return { rows: [{ sabana_muestra: grupo.sabana_muestra }] };
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

const entradaSabanaMuestra = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'patch' && args[0] === '/grupos/:id/sabana-muestra');
const handlerSabanaMuestra = entradaSabanaMuestra[1][1];

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
  // --- Guardar un texto de muestra ---
  const muestra = 'SABANA DE JUGADAS\nRANDY\n1) Astros -150 100\n2) Yankees +120 50';
  const req1 = { params: { id: 'grupo-1' }, body: { sabanaMuestra: muestra } };
  const res1 = await invocarRuta(handlerSabanaMuestra, req1);
  check(res1._status === 200, 'Guardar un texto de muestra responde 200');
  check(res1._json.sabanaMuestra === muestra, 'La respuesta devuelve el texto guardado tal cual');
  check(TABLAS.grupos[0].sabana_muestra === muestra, 'El texto quedó guardado de verdad en la fila del grupo');

  // --- String vacío borra la muestra ---
  const req2 = { params: { id: 'grupo-1' }, body: { sabanaMuestra: '' } };
  const res2 = await invocarRuta(handlerSabanaMuestra, req2);
  check(res2._json.sabanaMuestra === null, 'Mandar sabanaMuestra vacío borra la muestra (queda null en la respuesta)');
  check(TABLAS.grupos[0].sabana_muestra === null, 'La muestra quedó null de verdad en la fila del grupo');

  // --- Solo espacios también borra (se recorta con trim) ---
  TABLAS.grupos[0].sabana_muestra = muestra;
  const req3 = { params: { id: 'grupo-1' }, body: { sabanaMuestra: '   \n  ' } };
  const res3 = await invocarRuta(handlerSabanaMuestra, req3);
  check(res3._json.sabanaMuestra === null, 'Mandar solo espacios/saltos de línea también borra la muestra');

  // --- No valida ni interpreta el formato: cualquier texto libre entra igual ---
  const textoRaro = '###@@@ formato re distinto de otro grupo 123';
  const req4 = { params: { id: 'grupo-1' }, body: { sabanaMuestra: textoRaro } };
  const res4 = await invocarRuta(handlerSabanaMuestra, req4);
  check(res4._status === 200 && res4._json.sabanaMuestra === textoRaro, 'No valida el formato — cualquier texto libre se guarda igual (es solo de referencia)');

  // --- Grupo que no existe ---
  const req5 = { params: { id: 'grupo-que-no-existe' }, body: { sabanaMuestra: 'x' } };
  const res5 = await invocarRuta(handlerSabanaMuestra, req5);
  check(res5._status === 404, 'Un grupo_id que no existe da 404, no revienta el servidor');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de PATCH /grupos/:id/sabana-muestra se cayó con una excepción:', e);
  process.exit(1);
});
