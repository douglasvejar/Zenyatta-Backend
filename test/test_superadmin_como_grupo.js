// =================================================================
// PRUEBA (07-10-2026): Súper-admin operando sobre un grupo ("Puesta en
// Marcha" en Super Admin). Las rutas del grupo se montan bajo
// /api/superadmin/grupos/:id/... y requiereGrupo actúa como administrador de
// ese grupo SOLO cuando el servidor puso la marca req.superadminGrupoId.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
const ID = '11111111-2222-3333-4444-555555555555';
let grupoDB = { id: ID, nombre: 'Grupo Demo', email: 'a@b.c', activo: true, modulo_hipismo_habilitado: true };
const consultas = [];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  consultas.push(sql);
  if (/^SELECT id, nombre, email, activo, whatsapp_grupo_jid/i.test(sql)) return { rows: params[0] === ID && grupoDB ? [grupoDB] : [] };
  if (/COUNT\(\*\)::int AS n/i.test(sql)) return { rows: [{ n: 2 }] };
  if (/information_schema|pg_constraint|hipismo_cuadre_nocturno|hipismo_marcas_banqueo/i.test(sql)) return { rows: [] };
  return { rows: [] };
}
const fakePool = function () { this.query = async (t, p) => ejecutarQuery(t, p); this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} }); this.on = () => {}; };
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
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => { throw new Error('no debería verificarse JWT en modo súper-admin'); } };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';
process.env.SUPERADMIN_SECRET = 'secreto';
const auth = require(path.join(__dirname, '..', 'src', 'middleware', 'auth'));
const superRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin'));
const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }
function resFalso() { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(o) { r.body = o; return r; } }; return r; }
async function correrCadena(fns, req, res) {
  for (const fn of fns) {
    let siguio = false;
    await new Promise((resolve) => {
      const res2 = Object.assign(res, { json(o) { res.body = o; resolve(); return res; } });
      Promise.resolve(fn(req, res2, (e) => { siguio = true; if (e) res.error = e; resolve(); })).catch(e => { res.error = e; resolve(); });
    });
    if (!siguio) return false;
  }
  return true;
}

(async function main() {
  // ---- 1) requiereGrupo con la marca de súper-admin
  let req = { headers: {}, superadminGrupoId: ID };
  let res = resFalso();
  let siguio = await correrCadena([auth.requiereGrupo], req, res);
  check(siguio && req.grupoId === ID && req.rol === 'administrador' && req.nombreActor === 'SÚPER-ADMIN' && req.permisos === null, '1a) con la marca de súper-admin actúa como el administrador de ese grupo (a nombre de SÚPER-ADMIN)');
  grupoDB = { ...grupoDB, activo: false };
  req = { headers: {}, superadminGrupoId: ID }; res = resFalso();
  siguio = await correrCadena([auth.requiereGrupo], req, res);
  check(siguio, '1b) también funciona con un grupo desactivado (se está armando antes de activarlo)');
  grupoDB = null;
  req = { headers: {}, superadminGrupoId: ID }; res = resFalso();
  siguio = await correrCadena([auth.requiereGrupo], req, res);
  check(!siguio && res.code === 404, '1c) si el grupo no existe responde 404');
  grupoDB = { id: ID, nombre: 'Grupo Demo', email: 'a@b.c', activo: true, modulo_hipismo_habilitado: true };
  req = { headers: {} }; res = resFalso();
  siguio = await correrCadena([auth.requiereGrupo], req, res);
  check(!siguio && res.code === 401, '1d) SIN la marca y sin token sigue respondiendo 401 (no se abrió ningún acceso nuevo)');
  req = { headers: { 'x-superadmin-grupo-id': ID, authorization: '' }, body: { superadminGrupoId: ID } }; res = resFalso();
  siguio = await correrCadena([auth.requiereGrupo], req, res);
  check(!siguio && res.code === 401, '1e) la marca no se puede mandar por header ni por el cuerpo de la petición');

  // ---- 2) montaje en el router de súper-admin
  const montajes = superRouter.__handlers.filter(([m, a]) => m === 'use' && typeof a[0] === 'string');
  const mH = montajes.find(([, a]) => a[0] === '/grupos/:id/hipismo');
  const mJ = montajes.find(([, a]) => a[0] === '/grupos/:id/jugadores');
  check(mH && mH[1].length === 3 && typeof mH[1][2] === 'function' && mJ && mJ[1].length === 3, '2a) se montan las rutas de Hipismo y de Clientes bajo /grupos/:id/...');
  const primero = superRouter.__handlers[0];
  check(primero[0] === 'use' && primero[1][0] === auth.requiereSuperadmin, '2b) lo primero del router es exigir el secreto de súper-admin (antes de cualquier montaje)');
  const comoGrupo = mH[1][1];
  req = { params: { id: 'no-es-uuid' } }; res = resFalso();
  siguio = await correrCadena([comoGrupo], req, res);
  check(!siguio && res.code === 404 && !req.superadminGrupoId, '2c) un id que no es UUID responde 404 y no marca nada');
  req = { params: { id: ID } }; res = resFalso();
  siguio = await correrCadena([comoGrupo], req, res);
  check(siguio && req.superadminGrupoId === ID, '2d) un UUID válido deja la marca del lado del servidor');

  // ---- 3) de punta a punta: Puesta en Marcha de un grupo desde Súper-admin
  const useFns = hipismoRouter.__handlers.filter(([m, a]) => m === 'use' && typeof a[0] === 'function').map(([, a]) => a[0]);
  const rutaPem = hipismoRouter.__handlers.find(([m, a]) => m === 'get' && a[0] === '/puesta-en-marcha');
  req = { headers: {}, superadminGrupoId: ID, params: {}, query: {} }; res = resFalso();
  siguio = await correrCadena([...useFns, ...rutaPem[1].slice(1)], req, res);
  check(siguio === false && res.code === 200 && res.body && Array.isArray(res.body.items) && res.body.items.length > 0, `3a) GET /puesta-en-marcha pasa por todos los filtros del grupo y devuelve la lista (${res.body && res.body.items && res.body.items.length} pasos)`);
  const rutaHip = hipismoRouter.__handlers.find(([m, a]) => m === 'get' && a[0] === '/hipodromos');
  check(!!rutaHip, '3b) las rutas de configuración (hipódromos, banqueo, semana) son las mismas que usa el grupo');
  // con módulo Hipismo apagado el grupo debe activarlo primero
  grupoDB = { ...grupoDB, modulo_hipismo_habilitado: false };
  req = { headers: {}, superadminGrupoId: ID, params: {}, query: {} }; res = resFalso();
  siguio = await correrCadena([...useFns, ...rutaPem[1].slice(1)], req, res);
  check(res.code === 403 && /módulo de Hipismo/.test((res.body || {}).error || ''), '3c) con el módulo Hipismo apagado avisa que primero hay que activarlo');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  process.exit(fallaron ? 1 : 0);
})();
