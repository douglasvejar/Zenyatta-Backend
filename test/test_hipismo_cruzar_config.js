// =================================================================
// PRUEBA: Cruzar jugadas automático (14-10-2026). Preferencia por grupo: por defecto encendida, se guarda en el servidor,
// el Súper-admin puede bloquearla, y sin la columna (falta el SQL) el GET avisa sinColumna y el PUT responde 503.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
const GRUPO_ID = 'g-cruzar-1', OTRO = 'g-otro';
let valores = {}; // grupo_id -> boolean
let sinColumna = false;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/hipismo_cruzar_automatico/.test(sql) && sinColumna) { const e = new Error('column "hipismo_cruzar_automatico" does not exist'); e.code = '42703'; throw e; }
  if (/^SELECT hipismo_cruzar_automatico FROM grupos WHERE id = \$1/i.test(sql)) return { rows: params[0] in valores ? [{ hipismo_cruzar_automatico: valores[params[0]] }] : [{ hipismo_cruzar_automatico: true }] };
  if (/^UPDATE grupos SET hipismo_cruzar_automatico = \$1 WHERE id = \$2/i.test(sql)) { valores[params[1]] = params[0]; return { rows: [] }; }
  throw new Error('La base de datos falsa no sabe responder: ' + sql);
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
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
Module._load = function (request) {
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
async function invocar(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e.message));
  return { salida, status };
}
let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }

(async function () {
  const get = handlerDe('get', '/cruzar-config'), put = handlerDe('put', '/cruzar-config');
  const base = { grupoId: GRUPO_ID, params: {}, query: {}, grupo: { hipismo_cruzar_habilitado: true } };
  let r = await invocar(get, { ...base });
  check(r.salida.activo === true, '1) por defecto cruzar va encendido');
  r = await invocar(put, { ...base, body: { activo: false } });
  check(r.status === 200 && r.salida.activo === false, '2) se puede apagar');
  r = await invocar(get, { ...base });
  check(r.salida.activo === false, '3) queda apagado para todo el grupo');
  r = await invocar(get, { ...base, grupoId: OTRO });
  check(r.salida.activo === true, '4) otro grupo no se afecta');
  r = await invocar(put, { ...base, body: { activo: true } });
  r = await invocar(get, { ...base });
  check(r.salida.activo === true, '5) se puede volver a encender');
  r = await invocar(put, { ...base, body: { activo: 'si' } });
  check(r.status === 400, '6) un valor que no es verdadero/falso responde 400');
  r = await invocar(put, { ...base, grupo: { hipismo_cruzar_habilitado: false }, body: { activo: false } });
  check(r.status === 403 && valores[GRUPO_ID] === true, '7) si el Súper-admin lo desactivó, no se puede cambiar (403)');
  sinColumna = true;
  r = await invocar(get, { ...base });
  check(r.salida.sinColumna === true && r.salida.activo === null, '8) sin la columna el GET avisa sinColumna (la pantalla usa la copia del navegador)');
  r = await invocar(put, { ...base, body: { activo: false } });
  check(r.status === 503 && r.salida.sinColumna, '9) sin la columna el PUT responde 503 con aviso claro');
  console.log(`\n${pasaron} OK, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
