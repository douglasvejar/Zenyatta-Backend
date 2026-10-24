// =================================================================
// PRUEBA: el usuario (email) del login NO distingue mayúsculas/minúsculas
// (ni espacios sobrados), pero la clave SÍ (24-10-2026, a pedido del usuario).
// Cubre: Administrador, Empleado, clave con otras mayúsculas (rechazada),
// usuario inexistente, y el alta de grupo en Súper-admin (guarda en minúsculas
// y rechaza el que solo difiera en mayúsculas).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}


const GRUPOS = [{ id: 'g1', nombre: 'Grupo Uno', email: 'luis@ludox.com', password_hash: 'Clave123', activo: true,
  modulo_deportes_habilitado: true, modulo_hipismo_habilitado: true, hipismo_cruzar_habilitado: false, logo_url: null, logo_base64: null,
  tema_color_primario: null, tema_color_secundario: null }];
const EMPLEADOS = [{ id: 'e1', grupo_id: 'g1', email: 'juan@ludox.com', password_hash: 'Secreta9', nombre: 'Juan', activo: true, permisos: ['sabana'] }];
const INSERTADOS = [];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql.startsWith('SELECT * FROM grupos WHERE lower(email) = lower($1)')) {
    return { rows: GRUPOS.filter(g => g.email.toLowerCase() === String(params[0]).toLowerCase()).slice(0, 1) };
  }
  if (sql.startsWith('SELECT e.*, g.activo AS grupo_activo')) {
    if (!/WHERE lower\(e\.email\) = lower\(\$1\)/.test(sql)) throw new Error('El login de empleado debe comparar el email con lower()');
    const fila = EMPLEADOS.find(e => e.email.toLowerCase() === String(params[0]).toLowerCase());
    if (!fila) return { rows: [] };
    const g = GRUPOS.find(x => x.id === fila.grupo_id);
    return { rows: [{ ...fila, grupo_activo: g.activo, grupo_nombre: g.nombre, grupo_logo_url: null, grupo_logo_base64: false,
      grupo_modulo_deportes_habilitado: true, grupo_modulo_hipismo_habilitado: true, grupo_hipismo_cruzar_habilitado: false,
      grupo_tema_color_primario: null, grupo_tema_color_secundario: null }] };
  }
  if (sql.startsWith('UPDATE grupos SET ultimo_login_en') || sql.startsWith('UPDATE empleados SET ultimo_login_en')) return { rows: [] };
  if (sql.startsWith('SELECT 1 FROM grupos WHERE lower(email) = $1')) return { rows: GRUPOS.filter(g => g.email.toLowerCase() === params[0]).map(() => ({ '?column?': 1 })) };
  if (sql.startsWith('INSERT INTO grupos')) { INSERTADOS.push(params); return { rows: [{ id: 'g2', nombre: params[0], email: params[1] }] }; }
  if (/hipodromos/i.test(sql)) return { rows: [], rowCount: 0 };
  throw new Error('La base falsa no sabe responder: ' + sql);
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
function fakeRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...a) => { handlers.push([m, a]); return router; }; });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeRouter();
fakeExpress.Router = fakeRouter;

Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  // bcrypt falso pero SENSIBLE: el "hash" es la propia clave, y compara exacto.
  if (request === 'bcryptjs') return { hash: async (c) => c, compare: async (c, h) => c === h };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({}) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';
process.env.SUPERADMIN_SECRET = 'fake';
const authRouter = require(path.join(__dirname, '..', 'src', 'routes', 'auth'));
let superRouter = null;
try { superRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin')); } catch (e) { console.error('No cargó superadmin:', e.message); }
Module._load = originalLoad;

function handlerDe(router, m, p) { const e = router.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocar(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    Promise.resolve(handler(req, res, (e) => { if (e) reject(e); })).catch(reject);
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { status, body: salida };
}
const login = (email, password) => invocar(handlerDe(authRouter, 'post', '/login'), { body: { email, password }, ip: '1.1.1.1', headers: {} });

(async function main() {
  let r = await login('luis@ludox.com', 'Clave123');
  check(r.status === 200 && r.body.token, '1) Administrador entra con el email tal cual');
  r = await login('LUIS@Ludox.COM', 'Clave123');
  check(r.status === 200 && r.body.token && r.body.grupo.id === 'g1', '2) Administrador entra con el email en MAYÚSCULAS/mezcla');
  r = await login('  Luis@ludox.com  ', 'Clave123');
  check(r.status === 200 && r.body.token, '3) Espacios al inicio/final del email no molestan');
  r = await login('LUIS@ludox.com', 'clave123');
  check(r.status === 401, '4) La clave SÍ distingue mayúsculas: "clave123" no entra');
  r = await login('LUIS@ludox.com', 'CLAVE123');
  check(r.status === 401, '5) La clave en MAYÚSCULAS tampoco entra');
  r = await login('JUAN@LUDOX.COM', 'Secreta9');
  check(r.status === 200 && r.body.grupo.rol === 'empleado', '6) Empleado entra con el email en mayúsculas');
  r = await login('juan@ludox.com', 'secreta9');
  check(r.status === 401, '7) La clave del Empleado también es exacta');
  r = await login('nadie@ludox.com', 'Clave123');
  check(r.status === 401, '8) Un usuario que no existe sigue rechazado');
  r = await login('', 'Clave123');
  check(r.status === 400, '9) Email vacío sigue dando 400');

  if (superRouter) {
    const crear = handlerDe(superRouter, 'post', '/grupos');
    let c = await invocar(crear, { body: { nombre: 'Nuevo', email: '  NUEVO@Ludox.com ', password: 'Abc' }, headers: {} });
    check(c.status === 201 && INSERTADOS.length === 1 && INSERTADOS[0][1] === 'nuevo@ludox.com', '10) Súper-admin guarda el email nuevo en minúsculas y sin espacios -- guardó ' + JSON.stringify(INSERTADOS[0] && INSERTADOS[0][1]));
    check(INSERTADOS[0][2] === 'Abc', '11) La clave se guarda tal cual la escribieron (sin pasar a minúsculas)');
    c = await invocar(crear, { body: { nombre: 'Otro', email: 'LUIS@LUDOX.COM', password: 'x' }, headers: {} });
    check(c.status === 409 && INSERTADOS.length === 1, '12) No deja crear un grupo cuyo email solo difiere en mayúsculas');
  }
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
