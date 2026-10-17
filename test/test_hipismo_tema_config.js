// =================================================================
// PRUEBA: Tema del panel de Hipismo (15-10-2026). Cada grupo elige su tema; solo el administrador puede cambiarlo; un tema
// inventado se rechaza; sin la columna (falta el SQL) el GET avisa sinColumna y el PUT responde 503.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
const GRUPO_ID = 'g-tema-1', OTRO = 'g-otro';
let valores = {}; // grupo_id -> tema
let sinColumna = false;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/hipismo_tema/.test(sql) && sinColumna) { const e = new Error('column "hipismo_tema" does not exist'); e.code = '42703'; throw e; }
  if (/^SELECT hipismo_tema FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ hipismo_tema: params[0] in valores ? valores[params[0]] : null }] };
  if (/^UPDATE grupos SET hipismo_tema = \$1 WHERE id = \$2/i.test(sql)) { valores[params[1]] = params[0]; return { rows: [] }; }
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
  const get = handlerDe('get', '/tema-config'), put = handlerDe('put', '/tema-config');
  const admin = { grupoId: GRUPO_ID, params: {}, query: {}, rol: 'administrador' };
  let r = await invocar(get, { ...admin });
  check(r.salida.tema === 'cristal', '1) sin elegir nada el grupo ve Cristal');
  r = await invocar(put, { ...admin, body: { tema: 'noche' } });
  check(r.status === 200 && r.salida.tema === 'noche', '2) el administrador puede elegir Noche');
  r = await invocar(get, { ...admin });
  check(r.salida.tema === 'noche', '3) queda guardado para todo el grupo');
  r = await invocar(get, { ...admin, grupoId: OTRO });
  check(r.salida.tema === 'cristal', '4) otro grupo no se afecta');
  r = await invocar(put, { ...admin, grupoId: OTRO, body: { tema: 'club' } });
  r = await invocar(get, { ...admin });
  check(r.salida.tema === 'noche', '5) elegir tema en otro grupo no cambia el primero');
  r = await invocar(put, { ...admin, rol: 'empleado', body: { tema: 'mono' } });
  check(r.status === 403 && valores[GRUPO_ID] === 'noche', '6) un empleado no puede cambiarlo (403)');
  r = await invocar(put, { ...admin, body: { tema: 'inventado' } });
  check(r.status === 400 && valores[GRUPO_ID] === 'noche', '7) un tema que no existe se rechaza (400)');
  r = await invocar(put, { ...admin, body: {} });
  check(r.status === 400, '8) sin indicar tema responde 400');
  valores[GRUPO_ID] = 'algo-viejo';
  r = await invocar(get, { ...admin });
  check(r.salida.tema === 'cristal', '9) un valor guardado que ya no existe cae a Cristal');
  r = await invocar(get, { ...admin });
  check(r.salida.temas.includes('pastel') && r.salida.temas.includes('clasico') && r.salida.temas.length === 7, '10) el servidor informa los 7 temas (incluye Clásico)');
  const html = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const { TEMAS_HIPISMO } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoTemas'));
  const enPanel = [...html.matchAll(/\{ id: '([a-z]+)', nombre:/g)].map(m => m[1]);
  check(JSON.stringify(enPanel) === JSON.stringify(TEMAS_HIPISMO), '13) los temas que ofrece el panel son exactamente los que acepta el servidor');
  check(TEMAS_HIPISMO.filter(t => t !== 'cristal').every(t => html.includes('html[data-tema="' + t + '"] {')), '14) cada tema (menos Cristal, el de siempre) tiene su estilo en el panel');
  sinColumna = true;
  r = await invocar(get, { ...admin });
  check(r.salida.sinColumna === true && r.salida.tema === null, '11) sin la columna el GET avisa sinColumna (la pantalla usa la copia del navegador)');
  r = await invocar(put, { ...admin, body: { tema: 'pasto' } });
  check(r.status === 503 && r.salida.sinColumna, '12) sin la columna el PUT responde 503 con aviso claro');
  console.log(`\n${pasaron} OK, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
