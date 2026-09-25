// =================================================================
// PRUEBA: Cuentas por empleado dentro de un Grupo (18-09-2026, a pedido
// del usuario: "soluciona la cuentas separas por empleado dentro de un
// grupo... un administrador que tiene acceso 100% y los empleados
// puedes elegir que pueden o no hacer, ya que quizas hay empleados de
// mas confianza con acceso a mas cosas que otro").
//
// Cubre:
//   1) middleware/auth.js — requierePermiso()/requiereAdministrador()/
//      requiereAlgunoDe()/normalizarPermisos() como funciones puras
//      (sin DB, construyendo req/res a mano).
//   2) routes/auth.js — login: primero prueba "grupos" (Administrador);
//      si no está ahí, prueba "empleados" — activo/inactivo, contraseña
//      incorrecta, cuenta del Grupo desactivada.
//   3) routes/empleados.js — CRUD exclusivo del Administrador (un
//      Empleado, sin importar sus permisos, nunca puede entrar).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function fakeRes() {
  const res = { _status: 200, _json: null };
  res.status = (c) => { res._status = c; return res; };
  res.json = (o) => { res._json = o; return res; };
  res.end = () => res;
  return res;
}

// --- 1) middleware/auth.js, funciones puras ----------------------------
const fakePoolVacio = function () {
  this.query = async () => ({ rows: [] });
  this.connect = async () => ({ query: async () => ({ rows: [] }), release() {} });
  this.on = () => {};
};
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePoolVacio };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'g1' }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
const authMw = require(path.join(__dirname, '..', 'src', 'middleware', 'auth'));
Module._load = originalLoad;

(function pruebasMiddleware() {
  // requierePermiso(): el Administrador siempre pasa.
  let siguienteLlamado = false;
  authMw.requierePermiso('pagos')({ rol: 'administrador', permisos: null }, fakeRes(), () => { siguienteLlamado = true; });
  check(siguienteLlamado, 'requierePermiso: el Administrador SIEMPRE pasa, sin importar la clave pedida');

  // Empleado CON el permiso -> pasa.
  siguienteLlamado = false;
  authMw.requierePermiso('sabana')({ rol: 'empleado', permisos: ['sabana', 'pagos'] }, fakeRes(), () => { siguienteLlamado = true; });
  check(siguienteLlamado, 'requierePermiso: un empleado CON la clave en su lista pasa');

  // Empleado SIN el permiso -> 403, no llama next().
  siguienteLlamado = false;
  const res1 = fakeRes();
  authMw.requierePermiso('pagos')({ rol: 'empleado', permisos: ['sabana'] }, res1, () => { siguienteLlamado = true; });
  check(!siguienteLlamado && res1._status === 403, 'requierePermiso: un empleado SIN la clave en su lista recibe 403, next() nunca se llama');

  // requiereAlgunoDe(): pasa con CUALQUIERA de las claves.
  siguienteLlamado = false;
  authMw.requiereAlgunoDe('balanceGeneral', 'jugador')({ rol: 'empleado', permisos: ['jugador'] }, fakeRes(), () => { siguienteLlamado = true; });
  check(siguienteLlamado, 'requiereAlgunoDe: pasa si el empleado tiene AL MENOS UNA de las claves dadas');

  siguienteLlamado = false;
  const res2 = fakeRes();
  authMw.requiereAlgunoDe('balanceGeneral', 'jugador')({ rol: 'empleado', permisos: ['polla'] }, res2, () => { siguienteLlamado = true; });
  check(!siguienteLlamado && res2._status === 403, 'requiereAlgunoDe: 403 si el empleado no tiene NINGUNA de las claves dadas');

  // requiereAdministrador(): solo pasa si rol === 'administrador'.
  siguienteLlamado = false;
  authMw.requiereAdministrador({ rol: 'administrador' }, fakeRes(), () => { siguienteLlamado = true; });
  check(siguienteLlamado, 'requiereAdministrador: pasa para el Administrador');

  siguienteLlamado = false;
  const res3 = fakeRes();
  authMw.requiereAdministrador({ rol: 'empleado', permisos: authMw.PERMISOS_VALIDOS }, res3, () => { siguienteLlamado = true; });
  check(!siguienteLlamado && res3._status === 403, 'requiereAdministrador: 403 para un EMPLEADO aunque tenga TODOS los permisos posibles — gestionar empleados nunca es delegable');

  // normalizarPermisos(): filtra claves inválidas y quita duplicados.
  const normalizados = authMw.normalizarPermisos(['sabana', 'sabana', 'inventado', 'pagos', null, 123]);
  check(normalizados.sort().join(',') === 'pagos,sabana', 'normalizarPermisos: descarta claves inválidas/repetidas, se queda solo con las válidas y únicas');
  check(authMw.normalizarPermisos('no-es-un-arreglo').length === 0, 'normalizarPermisos: si no le mandan un arreglo, devuelve vacío en vez de reventar');
})();

// --- 2) routes/auth.js — login de Administrador y de Empleado ----------
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

const GRUPO_ACTIVO = { id: 'g1', nombre: 'Grupo Uno', email: 'duenio@correo.com', password_hash: 'hash-correcto', activo: true };
const GRUPO_INACTIVO = { id: 'g2', nombre: 'Grupo Dos', email: 'duenio2@correo.com', password_hash: 'hash-correcto', activo: false };
const EMPLEADO_ACTIVO = { id: 'e1', grupo_id: 'g1', nombre: 'Empleado Uno', email: 'empleado@correo.com', password_hash: 'hash-correcto', activo: true, permisos: ['sabana'] };
const EMPLEADO_INACTIVO = { id: 'e2', grupo_id: 'g1', nombre: 'Empleado Dos', email: 'empleado2@correo.com', password_hash: 'hash-correcto', activo: false, permisos: [] };

function ejecutarQueryAuth(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT \* FROM grupos WHERE email = \$1/i.test(sql)) {
    const [email] = params;
    const fila = [GRUPO_ACTIVO, GRUPO_INACTIVO].find(g => g.email === email);
    return { rows: fila ? [fila] : [] };
  }
  if (/^UPDATE grupos SET ultimo_login_en/i.test(sql)) return { rows: [] };
  // El regex no exige la lista EXACTA de columnas después de "g.nombre AS
  // grupo_nombre" (moduloDeportesHabilitado/moduloHipismoHabilitado/
  // hipismoCruzarHabilitado, agregadas en rondas posteriores a esta
  // prueba) — solo que empiece con el SELECT esperado y llegue al JOIN,
  // así una columna nueva en auth.js no rompe esta prueba con un "no sabe
  // responder" (bug real encontrado el 25-09-2026 al agregar
  // hipismo_cruzar_habilitado: el regex viejo exigía que el JOIN viniera
  // pegado justo después de "grupo_nombre", sin nada en el medio).
  if (/^SELECT e\.\*, g\.activo AS grupo_activo, g\.nombre AS grupo_nombre.*FROM empleados e JOIN grupos g/i.test(sql)) {
    const [email] = params;
    const empleado = [EMPLEADO_ACTIVO, EMPLEADO_INACTIVO].find(e => e.email === email);
    if (!empleado) return { rows: [] };
    return { rows: [{ ...empleado, grupo_activo: GRUPO_ACTIVO.activo, grupo_nombre: GRUPO_ACTIVO.nombre }] };
  }
  if (/^UPDATE empleados SET ultimo_login_en/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (auth) no sabe responder: ' + sql);
}
const fakePoolAuth = function () {
  this.query = async (text, params) => ejecutarQueryAuth(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQueryAuth(text, params), release() {} });
  this.on = () => {};
};

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePoolAuth };
  if (request === 'express') return fakeExpress;
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'g1' }) };
  // bcryptjs.compare(password, hash) — en esta prueba, "correcta" es la
  // única contraseña de verdad válida para hash-correcto.
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async (pass, hash) => hash === 'hash-correcto' && pass === 'correcta' };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';
// db.js ya quedó en caché desde la parte 1 (con el pool VACÍO de ahí) —
// sin borrarlo, routes/auth.js reusaría esa misma instancia en vez de
// conectarse al fakePoolAuth de esta parte.
delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'db'))];
const authRouter = require(path.join(__dirname, '..', 'src', 'routes', 'auth'));
Module._load = originalLoad;

const entradaLogin = authRouter.__handlers.find(([m]) => m === 'post');
const handlerLogin = entradaLogin[1][entradaLogin[1].length - 1];
function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = fakeRes();
    res.json = (o) => { res._json = o; resolve(res); return res; };
    res.end = () => { resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

(async function pruebasLogin() {
  const rAdmin = await invocarRuta(handlerLogin, { body: { email: 'duenio@correo.com', password: 'correcta' }, headers: {} });
  check(rAdmin._json.grupo.rol === 'administrador', 'login del Administrador: rol = "administrador"');
  check(rAdmin._json.grupo.permisos === null, 'login del Administrador: permisos = null (sin restricción)');

  const rAdminMal = await invocarRuta(handlerLogin, { body: { email: 'duenio@correo.com', password: 'incorrecta' }, headers: {} });
  check(rAdminMal._status === 401, 'login del Administrador con contraseña incorrecta: 401');

  const rGrupoInactivo = await invocarRuta(handlerLogin, { body: { email: 'duenio2@correo.com', password: 'correcta' }, headers: {} });
  check(rGrupoInactivo._status === 403, 'login de un Grupo desactivado: 403, aunque la contraseña sea correcta');

  const rEmpleado = await invocarRuta(handlerLogin, { body: { email: 'empleado@correo.com', password: 'correcta' }, headers: {} });
  check(rEmpleado._json.grupo.rol === 'empleado', 'login de un Empleado: rol = "empleado" (mismo formulario, sin que nadie tenga que elegir)');
  check(Array.isArray(rEmpleado._json.grupo.permisos) && rEmpleado._json.grupo.permisos[0] === 'sabana', 'login de un Empleado: trae sus permisos ("sabana")');
  check(rEmpleado._json.grupo.nombreEmpleado === 'Empleado Uno', 'login de un Empleado: trae su propio nombre, distinto del nombre del Grupo');

  const rEmpleadoInactivo = await invocarRuta(handlerLogin, { body: { email: 'empleado2@correo.com', password: 'correcta' }, headers: {} });
  check(rEmpleadoInactivo._status === 403, 'login de un Empleado desactivado por su Administrador: 403');

  const rNadie = await invocarRuta(handlerLogin, { body: { email: 'no-existe@correo.com', password: 'correcta' }, headers: {} });
  check(rNadie._status === 401, 'login con un email que no es ni Grupo ni Empleado: 401 (mismo mensaje genérico, no revela cuál de las dos tablas se probó)');
})().then(pruebasEmpleadosCRUD).catch(e => {
  console.error('La prueba de empleados se cayó con una excepción:', e);
  process.exit(1);
});

// --- 3) routes/empleados.js — exclusivo del Administrador ---------------
async function pruebasEmpleadosCRUD() {
  const TABLAS_E = { empleados: [{ id: 'e1', grupo_id: 'g1', nombre: 'Empleado Uno', email: 'empleado@correo.com', password_hash: 'x', activo: true, permisos: ['sabana'] }] };
  function ejecutarQueryEmpleados(text, params) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (/^SELECT id, grupo_id, nombre, email, activo, permisos, creado_en, ultimo_login_en FROM empleados WHERE grupo_id = \$1/i.test(sql)) {
      const [grupoId] = params;
      return { rows: TABLAS_E.empleados.filter(e => e.grupo_id === grupoId) };
    }
    if (/^INSERT INTO empleados/i.test(sql)) {
      const [grupoId, nombre, email, hash, permisos] = params;
      if (TABLAS_E.empleados.some(e => e.email === email)) { const err = new Error('dup'); err.code = '23505'; throw err; }
      const fila = { id: 'e' + (TABLAS_E.empleados.length + 1), grupo_id: grupoId, nombre, email, activo: true, permisos: JSON.parse(permisos) };
      TABLAS_E.empleados.push(fila);
      return { rows: [fila] };
    }
    throw new Error('La base de datos falsa de esta prueba (empleados) no sabe responder: ' + sql);
  }
  const fakePoolEmpleados = function () {
    this.query = async (text, params) => ejecutarQueryEmpleados(text, params);
    this.connect = async () => ({ query: async (text, params) => ejecutarQueryEmpleados(text, params), release() {} });
    this.on = () => {};
  };

  Module._load = function (request, parent, isMain) {
    if (request === 'pg') return { Pool: fakePoolEmpleados };
    if (request === 'express') return fakeExpress;
    if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'g1' }) };
    if (request === 'bcryptjs') return { hash: async () => 'hash-empleado', compare: async () => true };
    return originalLoad.apply(this, arguments);
  };
  // Mismo motivo que arriba: db.js quedó cacheado con el fakePoolAuth de
  // la parte 2 — hay que forzar que routes/empleados.js (vía
  // middleware/auth.js) recargue db.js apuntando al fakePoolEmpleados de
  // esta parte.
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'db'))];
  const empleadosRouter = require(path.join(__dirname, '..', 'src', 'routes', 'empleados'));
  Module._load = originalLoad;

  const entradaGet = empleadosRouter.__handlers.find(([m, args]) => m === 'get' && args[0] === '/');
  const handlerGet = entradaGet[1][entradaGet[1].length - 1];
  const entradaPost = empleadosRouter.__handlers.find(([m]) => m === 'post');
  const handlerPost = entradaPost[1][entradaPost[1].length - 1];

  // El Administrador SÍ puede listar/crear.
  const resGet = await invocarRuta(handlerGet, { grupoId: 'g1', rol: 'administrador' });
  check(Array.isArray(resGet._json) && resGet._json.length === 1, 'GET /api/empleados (Administrador): lista los empleados de su grupo');

  const resPost = await invocarRuta(handlerPost, { grupoId: 'g1', rol: 'administrador', body: { nombre: 'Nueva', email: 'nueva@correo.com', password: '123456', permisos: ['sabana', 'inventado'] } });
  check(resPost._status === 201, 'POST /api/empleados (Administrador): crea un empleado nuevo');
  check(resPost._json.permisos.length === 1 && resPost._json.permisos[0] === 'sabana', 'POST /api/empleados: los permisos se normalizan (descarta "inventado")');

  const resPostCorta = await invocarRuta(handlerPost, { grupoId: 'g1', rol: 'administrador', body: { nombre: 'Otra', email: 'otra@correo.com', password: '123', permisos: [] } });
  check(resPostCorta._status === 400, 'POST /api/empleados: contraseña de menos de 6 caracteres se rechaza');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
}
