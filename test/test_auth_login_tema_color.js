// =================================================================
// PRUEBA: POST /api/auth/login trae temaColorPrimario/Secundario (además
// de logoUrl, que ya viajaba desde el 24-09-2026) en la sesión del propio
// Administrador Y del Empleado (01-10-2026, a pedido del usuario:
// "QUIERO LOS CUADRES COMO HICISTE EL DE GRUPO DE CLIENTES, CON LOS
// COLORES QUE TENGA EL LOGO CONFIGURADO, Y EL LOGO DE FONDO" — Balance
// General/Cierre Final/Comisiones Devueltas por Cliente necesitan este
// mismo tema tenant-wide, configurado una sola vez en Súper-admin > 🖼️
// Logo > "Colores Reportes Cliente", que ya usa 🗂️ Grupo de Clientes).
//
// Casos cubiertos:
//   1. Administrador con tema propio configurado: logoUrl apunta al proxy
//      de siempre y temaColorPrimario/Secundario traen sus 2 colores.
//   2. Administrador SIN tema configurado: los 2 colores quedan en null
//      (nunca undefined ni el valor crudo de la columna) — el frontend lo
//      interpreta como "usa el verde de Ludox de siempre".
//   3. Empleado de un grupo CON tema configurado: igual que el
//      Administrador (el JOIN con "grupos" trae los mismos 2 colores,
//      bajo el alias grupo_tema_color_primario/secundario).
//   4. Empleado de un grupo SIN tema configurado: null también.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_CON_TEMA = {
  id: 'g-con-tema', nombre: 'Grupo Con Tema', email: 'contema@test.com', password_hash: 'x',
  activo: true, modulo_deportes_habilitado: true, modulo_hipismo_habilitado: true,
  hipismo_cruzar_habilitado: false,
  logo_url: 'https://ejemplo.com/logo.png', logo_base64: null,
  tema_color_primario: '#112233', tema_color_secundario: '#445566'
};
const GRUPO_SIN_TEMA = {
  id: 'g-sin-tema', nombre: 'Grupo Sin Tema', email: 'sintema@test.com', password_hash: 'x',
  activo: true, modulo_deportes_habilitado: true, modulo_hipismo_habilitado: true,
  hipismo_cruzar_habilitado: false,
  logo_url: null, logo_base64: null,
  tema_color_primario: null, tema_color_secundario: null
};
const EMPLEADO_CON_TEMA = {
  id: 'e-con-tema', grupo_id: 'g-con-tema', email: 'empleado-contema@test.com', password_hash: 'x',
  nombre: 'Empleado Con Tema', activo: true, permisos: ['sabana']
};
const EMPLEADO_SIN_TEMA = {
  id: 'e-sin-tema', grupo_id: 'g-sin-tema', email: 'empleado-sintema@test.com', password_hash: 'x',
  nombre: 'Empleado Sin Tema', activo: true, permisos: ['sabana']
};

const TABLAS = { grupos: [GRUPO_CON_TEMA, GRUPO_SIN_TEMA], empleados: [EMPLEADO_CON_TEMA, EMPLEADO_SIN_TEMA] };

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (sql === 'SELECT * FROM grupos WHERE email = $1') {
    const [email] = params;
    return { rows: TABLAS.grupos.filter(g => g.email === email) };
  }
  if (sql.startsWith('SELECT e.*, g.activo AS grupo_activo')) {
    const [email] = params;
    const fila = TABLAS.empleados.find(e => e.email === email);
    if (!fila) return { rows: [] };
    const g = TABLAS.grupos.find(x => x.id === fila.grupo_id);
    return {
      rows: [{
        ...fila,
        grupo_activo: g.activo, grupo_nombre: g.nombre,
        grupo_logo_url: g.logo_url, grupo_logo_base64: g.logo_base64,
        grupo_modulo_deportes_habilitado: g.modulo_deportes_habilitado,
        grupo_modulo_hipismo_habilitado: g.modulo_hipismo_habilitado,
        grupo_hipismo_cruzar_habilitado: g.hipismo_cruzar_habilitado,
        grupo_tema_color_primario: g.tema_color_primario,
        grupo_tema_color_secundario: g.tema_color_secundario
      }]
    };
  }
  if (sql.startsWith('UPDATE grupos SET ultimo_login_en') || sql.startsWith('UPDATE empleados SET ultimo_login_en')) {
    return { rows: [] };
  }

  throw new Error('La base de datos falsa de esta prueba (auth-login-tema-color) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
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

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'h', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({}) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';

const authRouter = require(path.join(__dirname, '..', 'src', 'routes', 'auth'));

Module._load = originalLoad;

function handlerDe(m, p) { const e = authRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }

async function invocarRuta(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { status, body: salida };
}

(async function main() {
  const handlerLogin = handlerDe('post', '/login');

  // ---- 1) Administrador CON tema ----
  const r1 = await invocarRuta(handlerLogin, { body: { email: 'contema@test.com', password: 'cualquiera' }, ip: '1.2.3.4', headers: {} });
  check(r1.body && r1.body.grupo, '1a) Login de Administrador con tema responde con grupo');
  check(r1.body.grupo.logoUrl === '/api/imagenes/logo-grupo/g-con-tema', '1b) logoUrl apunta al proxy de siempre');
  check(r1.body.grupo.temaColorPrimario === '#112233' && r1.body.grupo.temaColorSecundario === '#445566',
    `1c) temaColorPrimario/Secundario traen los 2 colores configurados -- dio ${JSON.stringify({ p: r1.body.grupo.temaColorPrimario, s: r1.body.grupo.temaColorSecundario })}`);

  // ---- 2) Administrador SIN tema ----
  const r2 = await invocarRuta(handlerLogin, { body: { email: 'sintema@test.com', password: 'cualquiera' }, ip: '1.2.3.4', headers: {} });
  check(r2.body.grupo.logoUrl === null, '2a) Sin logo configurado, logoUrl es null');
  check(r2.body.grupo.temaColorPrimario === null && r2.body.grupo.temaColorSecundario === null,
    '2b) Sin tema configurado, los 2 colores quedan en null (no undefined)');

  // ---- 3) Empleado de un grupo CON tema ----
  const r3 = await invocarRuta(handlerLogin, { body: { email: 'empleado-contema@test.com', password: 'cualquiera' }, ip: '1.2.3.4', headers: {} });
  check(r3.body && r3.body.grupo && r3.body.grupo.rol === 'empleado', '3a) Login de Empleado responde con rol "empleado"');
  check(r3.body.grupo.temaColorPrimario === '#112233' && r3.body.grupo.temaColorSecundario === '#445566',
    `3b) El Empleado hereda el mismo tema de su grupo -- dio ${JSON.stringify({ p: r3.body.grupo.temaColorPrimario, s: r3.body.grupo.temaColorSecundario })}`);

  // ---- 4) Empleado de un grupo SIN tema ----
  const r4 = await invocarRuta(handlerLogin, { body: { email: 'empleado-sintema@test.com', password: 'cualquiera' }, ip: '1.2.3.4', headers: {} });
  check(r4.body.grupo.temaColorPrimario === null && r4.body.grupo.temaColorSecundario === null,
    '4) El Empleado de un grupo sin tema también recibe null, no undefined');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
