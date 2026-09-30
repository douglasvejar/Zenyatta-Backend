// =================================================================
// PRUEBA: PATCH /api/superadmin/grupos/:id/tema-cliente (29-09-2026, a
// pedido del usuario: "colocame una ventana en logos que diga colores
// reportes cliente... asi cada grupo lo puedo personalizar segun sus
// logos") — ver la nota grande junto a tema_color_primario/
// tema_color_secundario en sql/schema.sql.
//
// Mismo patrón de base de datos falsa + express falso que
// test_superadmin_logo.js: invoca el handler real de la ruta directo,
// sin levantar un servidor HTTP.
//
// Cubre: guardar un par de colores hex válido, mandar los 2 vacíos
// vuelve al verde clásico (null/null), un color con formato inválido se
// rechaza con 400 sin tocar la base, mandar solo uno de los 2 (sin el
// otro) también se rechaza con 400 (nunca un degradado a medias), y un
// grupo_id que no existe da 404 tanto al guardar como al restablecer.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  grupos: [
    { id: 'grupo-1', nombre: 'Deportes Zenyatta TX', tema_color_primario: null, tema_color_secundario: null }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^UPDATE grupos SET tema_color_primario = null, tema_color_secundario = null WHERE id = \$1 RETURNING id/i.test(sql)) {
    const [id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.tema_color_primario = null;
    grupo.tema_color_secundario = null;
    return { rows: [{ id: grupo.id }] };
  }
  if (/^UPDATE grupos SET tema_color_primario = \$1, tema_color_secundario = \$2 WHERE id = \$3 RETURNING id/i.test(sql)) {
    const [p, s, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.tema_color_primario = p;
    grupo.tema_color_secundario = s;
    return { rows: [{ id: grupo.id }] };
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

const entrada = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'patch' && args[0] === '/grupos/:id/tema-cliente');
const handler = entrada[1][entrada[1].length - 1];

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
  // --- Guardar un par de colores hex válido ---
  const req1 = { params: { id: 'grupo-1' }, body: { colorPrimario: '#14532d', colorSecundario: '#16a34a' } };
  const res1 = await invocarRuta(handler, req1);
  check(res1._status === 200, 'Guardar un par de colores válido responde 200');
  check(res1._json.colorPrimario === '#14532d' && res1._json.colorSecundario === '#16a34a', 'La respuesta devuelve los 2 colores tal cual se mandaron');
  check(TABLAS.grupos[0].tema_color_primario === '#14532d' && TABLAS.grupos[0].tema_color_secundario === '#16a34a', 'Los 2 colores quedaron guardados de verdad en la fila del grupo');

  // --- Mandar los 2 vacíos vuelve al verde clásico (null/null) ---
  const req2 = { params: { id: 'grupo-1' }, body: { colorPrimario: '', colorSecundario: '' } };
  const res2 = await invocarRuta(handler, req2);
  check(res2._status === 200, 'Mandar los 2 colores vacíos responde 200');
  check(res2._json.colorPrimario === null && res2._json.colorSecundario === null, 'La respuesta confirma colorPrimario/colorSecundario en null (vuelve al verde clásico)');
  check(TABLAS.grupos[0].tema_color_primario === null && TABLAS.grupos[0].tema_color_secundario === null, 'Los 2 colores quedaron null de verdad en la fila del grupo');

  // --- Un body sin ninguno de los 2 campos también vuelve al verde clásico ---
  TABLAS.grupos[0].tema_color_primario = '#450a0a';
  TABLAS.grupos[0].tema_color_secundario = '#9a5b13';
  const req2b = { params: { id: 'grupo-1' }, body: {} };
  const res2b = await invocarRuta(handler, req2b);
  check(res2b._json.colorPrimario === null && res2b._json.colorSecundario === null, 'Un body sin colorPrimario/colorSecundario en absoluto también vuelve al verde clásico');

  // --- Formato inválido se rechaza (no es hex de 6 dígitos) ---
  TABLAS.grupos[0].tema_color_primario = null;
  TABLAS.grupos[0].tema_color_secundario = null;
  const req3 = { params: { id: 'grupo-1' }, body: { colorPrimario: 'verde', colorSecundario: '#16a34a' } };
  const res3 = await invocarRuta(handler, req3);
  check(res3._status === 400, 'Un color que no es un hex válido se rechaza con 400');
  check(TABLAS.grupos[0].tema_color_primario === null, 'Rechazado por formato inválido, no se guardó nada');

  // --- Un hex de 3 dígitos (formato corto CSS) también se rechaza — solo se acepta el de 6 ---
  const req3b = { params: { id: 'grupo-1' }, body: { colorPrimario: '#fff', colorSecundario: '#16a34a' } };
  const res3b = await invocarRuta(handler, req3b);
  check(res3b._status === 400, 'Un hex corto (3 dígitos) se rechaza con 400 — solo se acepta el formato de 6 dígitos');

  // --- Mandar solo UNO de los 2 colores (sin el otro) se rechaza — nunca un degradado a medias ---
  const req4 = { params: { id: 'grupo-1' }, body: { colorPrimario: '#14532d', colorSecundario: '' } };
  const res4 = await invocarRuta(handler, req4);
  check(res4._status === 400, 'Mandar un solo color (sin el otro) se rechaza con 400');
  check(TABLAS.grupos[0].tema_color_primario === null, 'Rechazado por venir un solo color, no se guardó nada a medias');

  // --- Grupo que no existe, al guardar ---
  const req5 = { params: { id: 'grupo-que-no-existe' }, body: { colorPrimario: '#14532d', colorSecundario: '#16a34a' } };
  const res5 = await invocarRuta(handler, req5);
  check(res5._status === 404, 'Un grupo_id que no existe da 404 al guardar un tema, no revienta el servidor');

  // --- Grupo que no existe, al restablecer ---
  const req6 = { params: { id: 'grupo-que-no-existe' }, body: {} };
  const res6 = await invocarRuta(handler, req6);
  check(res6._status === 404, 'Un grupo_id que no existe da 404 también al restablecer el tema');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de PATCH /grupos/:id/tema-cliente se cayó con una excepción:', e);
  process.exit(1);
});
