// =================================================================
// PRUEBA: Pozos > quién sale en el plano (12-10-2026). Los desmarcados se guardan en el servidor, por grupo, y quedan
// fijos hasta que se vuelvan a marcar; un cliente nuevo no está en la lista (sale marcado). Sin la tabla (falta el SQL)
// el GET responde sinTabla y el PUT 503, sin romper nada.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
const GRUPO_ID = 'g-pozos-excl-1', OTRO = 'g-otro';
let tabla = []; // {grupo_id, nombre}
let sinTabla = false;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/hipismo_pozos_excluidos/.test(sql) && sinTabla) { const e = new Error('relation "hipismo_pozos_excluidos" does not exist'); e.code = '42P01'; throw e; }
  if (/^SELECT nombre FROM hipismo_pozos_excluidos WHERE grupo_id = \$1/i.test(sql)) return { rows: tabla.filter(x => x.grupo_id === params[0]).map(x => ({ nombre: x.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)) };
  if (/^DELETE FROM hipismo_pozos_excluidos WHERE grupo_id = \$1/i.test(sql)) { tabla = tabla.filter(x => x.grupo_id !== params[0]); return { rows: [] }; }
  if (/^INSERT INTO hipismo_pozos_excluidos/i.test(sql)) { params[1].forEach(n => { if (!tabla.some(x => x.grupo_id === params[0] && x.nombre === n)) tabla.push({ grupo_id: params[0], nombre: n }); }); return { rows: [] }; }
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
  const get = handlerDe('get', '/pozos-plano-excluidos'), put = handlerDe('put', '/pozos-plano-excluidos');
  const base = { grupoId: GRUPO_ID, params: {}, query: {} };
  let r = await invocar(get, { ...base });
  check(Array.isArray(r.salida.nombres) && r.salida.nombres.length === 0, '1) sin desmarcados, la lista viene vacía (todos salen marcados)');
  r = await invocar(put, { ...base, body: { nombres: ['SAMMY', ' KOKITO ', 'SAMMY', ''] } });
  check(r.status === 200 && r.salida.nombres.length === 2, '2) guardar limpia espacios, repetidos y vacíos');
  r = await invocar(get, { ...base });
  check(r.salida.nombres.join() === 'KOKITO,SAMMY', '3) los desmarcados quedan guardados (fijos)');
  r = await invocar(get, { ...base, grupoId: OTRO });
  check(r.salida.nombres.length === 0, '4) otro grupo no ve la lista de este');
  r = await invocar(put, { ...base, body: { nombres: ['KOKITO'] } });
  r = await invocar(get, { ...base });
  check(r.salida.nombres.join() === 'KOKITO', '5) volver a marcar a SAMMY lo saca de la lista; KOKITO sigue fijo');
  r = await invocar(put, { ...base, body: { nombres: [] } });
  r = await invocar(get, { ...base });
  check(r.salida.nombres.length === 0, '6) "Marcar todos" (lista vacía) deja a todos marcados');
  r = await invocar(put, { ...base, body: {} });
  check(r.status === 400, '7) sin lista responde 400');
  sinTabla = true;
  r = await invocar(get, { ...base });
  check(r.salida.sinTabla === true && r.salida.nombres === null, '8) sin la tabla el GET avisa sinTabla (la pantalla usa la copia del navegador)');
  r = await invocar(put, { ...base, body: { nombres: ['A'] } });
  check(r.status === 503 && r.salida.sinTabla, '9) sin la tabla el PUT responde 503 con aviso claro');
  console.log(`\n${pasaron} OK, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
