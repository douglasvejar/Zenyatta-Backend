// =================================================================
// PRUEBA: contraseña de un Grupo — solo hash, nunca recuperable
// (25-09-2026, decisión final del usuario: "por seguridad es mejor no
// verla... dejala que yo desde super admin pueda resetear la clave").
//
// Reemplaza a test_ver_clave_grupo.js (borrado en esta misma ronda junto
// con services/cifradoClave.js): hubo una versión intermedia de esta
// función que guardaba una copia cifrada reversible de la clave para que
// Súper-admin la pudiera "ver" — se revirtió antes de llegar a
// producción, y esta prueba confirma que NO quedó ningún resto de eso.
//
// Cubre:
//   1) routes/superadmin.js:
//      - POST /grupos guarda SOLO password_hash (nunca ninguna otra
//        columna de clave).
//      - GET /grupos/:id/detalle NUNCA devuelve `claveActual` ni ningún
//        campo parecido — la clave no es recuperable desde ningún lado.
//      - PATCH /grupos/:id/password (restablecer) actualiza SOLO
//        password_hash.
//   2) routes/grupo.js:
//      - PATCH /password (el propio grupo cambia su clave, "Ajustes >
//        Seguridad") exige al menos 4 caracteres y actualiza SOLO
//        password_hash del grupo de la SESIÓN (req.grupoId) — nunca de
//        otro grupo.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

process.env.JWT_SECRET = 'clave-secreta-de-prueba-no-real';

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

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

const TABLAS = {
  grupos: [
    { id: 'grupo-viejo', nombre: 'Viejo', email: 'viejo@ejemplo.com', activo: true, creado_en: '2026-01-01T00:00:00Z', ultimo_login_en: null, ultimo_login_ip: null, ultimo_login_user_agent: null, logo_url: null, whatsapp_habilitado: false, whatsapp_grupo_jid: null, sabana_muestra: null, comandos_whatsapp_habilitado: false, comandos_whatsapp_numero: null, modulo_deportes_habilitado: true, modulo_hipismo_habilitado: false, hipismo_cruzar_habilitado: true, password_hash: 'hash-viejo' }
  ],
  jugadores: []
};
let siguienteIdGrupo = 1;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^INSERT INTO grupos \(nombre, email, password_hash, activo\)/i.test(sql)) {
    const [nombre, email, passwordHash] = params;
    const fila = { id: 'grupo-nuevo-' + (siguienteIdGrupo++), nombre, email, password_hash: passwordHash, activo: false, creado_en: '2026-09-25T00:00:00Z' };
    TABLAS.grupos.push(fila);
    return { rows: [{ id: fila.id, nombre: fila.nombre, email: fila.email, activo: fila.activo, creado_en: fila.creado_en }] };
  }
  if (/^SELECT id, nombre, email, activo, creado_en, ultimo_login_en, ultimo_login_ip, ultimo_login_user_agent, logo_url, whatsapp_habilitado, whatsapp_grupo_jid, sabana_muestra.*hipismo_cruzar_habilitado\s*FROM grupos WHERE id = \$1/i.test(sql)) {
    const grupo = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: grupo ? [grupo] : [] };
  }
  if (/^SELECT COUNT\(\*\)::int AS total FROM jugadores WHERE grupo_id = \$1 AND activo = true/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_personalizados WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros FROM tickets_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT MIN\(fecha\) AS min_fecha FROM tickets_historial WHERE grupo_id = \$1/i.test(sql)) return { rows: [{ min_fecha: null }] };

  if (/^UPDATE grupos SET password_hash = \$1 WHERE id = \$2/i.test(sql)) {
    const [passwordHash, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.password_hash = passwordHash;
    return { rows: [{ id: grupo.id }] };
  }

  throw new Error('La base de datos falsa de esta prueba (reset de contraseña) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async (pw) => 'hash-de:' + pw, compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'x' }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.SUPERADMIN_SECRET = 'fake-secret';

const superadminRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin'));
const grupoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'grupo'));

Module._load = originalLoad;

function ultimoHandler(router, metodo, ruta) {
  const entrada = router.__handlers.find(([m, args]) => m === metodo && args[0] === ruta);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo + ' ' + ruta);
  return entrada[1][entrada[1].length - 1];
}

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res._ended = false;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    res.end = () => { res._ended = true; resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

const handlerCrearGrupo = ultimoHandler(superadminRouter, 'post', '/grupos');
const handlerDetalle = ultimoHandler(superadminRouter, 'get', '/grupos/:id/detalle');
const handlerResetPassword = ultimoHandler(superadminRouter, 'patch', '/grupos/:id/password');
const handlerPasswordPropio = ultimoHandler(grupoRouter, 'patch', '/password');

(async function main() {
  // --- POST /grupos: solo guarda password_hash -------------------------
  const reqCrear = { body: { nombre: 'Grupo Nuevo', email: 'nuevo@ejemplo.com', password: 'clavesita1' } };
  const resCrear = await invocarRuta(handlerCrearGrupo, reqCrear);
  check(resCrear._status === 201, 'POST /grupos: responde 201');
  const idGrupoNuevo = resCrear._json.id;
  const filaGrupoNuevo = TABLAS.grupos.find(g => g.id === idGrupoNuevo);
  check(filaGrupoNuevo.password_hash === 'hash-de:clavesita1', 'POST /grupos: guarda password_hash');
  check(!('password_visible_cifrada' in filaGrupoNuevo), 'POST /grupos: NO guarda ninguna clave recuperable, ni cifrada');

  // --- GET /grupos/:id/detalle: nunca devuelve la clave -----------------
  const resDetalleNuevo = await invocarRuta(handlerDetalle, { params: { id: idGrupoNuevo }, query: {} });
  check(!('claveActual' in resDetalleNuevo._json), 'GET /detalle: la respuesta ya no trae ningún campo "claveActual"');
  check(JSON.stringify(resDetalleNuevo._json).indexOf('clavesita1') === -1, 'GET /detalle: la clave en texto plano no aparece en ningún lado de la respuesta');

  // --- PATCH /grupos/:id/password (súper-admin restablece) --------------
  const resReset = await invocarRuta(handlerResetPassword, { params: { id: 'grupo-viejo' }, body: { password: 'claveNuevaDelViejo' } });
  check(resReset._status === 204, 'PATCH /grupos/:id/password: responde 204');
  const filaViejaTrasReset = TABLAS.grupos.find(g => g.id === 'grupo-viejo');
  check(filaViejaTrasReset.password_hash === 'hash-de:claveNuevaDelViejo', 'PATCH /grupos/:id/password: actualiza password_hash con la clave nueva');
  check(!('password_visible_cifrada' in filaViejaTrasReset), 'PATCH /grupos/:id/password: no guarda ninguna copia recuperable de la clave');

  // --- PATCH /grupos/:id/password: valida mínimo de 4 caracteres --------
  const resResetCorta = await invocarRuta(handlerResetPassword, { params: { id: 'grupo-viejo' }, body: { password: 'ab' } });
  check(resResetCorta._status === 400, 'PATCH /grupos/:id/password: rechaza una clave de menos de 4 caracteres');

  // --- routes/grupo.js: PATCH /password (el propio grupo la cambia) -----
  const reqCambioPropio = { grupoId: idGrupoNuevo, body: { password: 'claveNuevaDelPropioGrupo' } };
  const resCambioPropio = await invocarRuta(handlerPasswordPropio, reqCambioPropio);
  check(resCambioPropio._status === 204, 'PATCH /api/grupo/password: responde 204');
  const filaTrasCambioPropio = TABLAS.grupos.find(g => g.id === idGrupoNuevo);
  check(filaTrasCambioPropio.password_hash === 'hash-de:claveNuevaDelPropioGrupo', 'PATCH /api/grupo/password: actualiza password_hash (lo que de verdad valida el login) con la clave nueva');
  check(!('password_visible_cifrada' in filaTrasCambioPropio), 'PATCH /api/grupo/password: tampoco guarda ninguna copia recuperable de la clave');

  // --- routes/grupo.js: PATCH /password valida mínimo de 4 caracteres ---
  const resCambioCorto = await invocarRuta(handlerPasswordPropio, { grupoId: idGrupoNuevo, body: { password: 'xy' } });
  check(resCambioCorto._status === 400, 'PATCH /api/grupo/password: rechaza una clave de menos de 4 caracteres');

  // --- routes/grupo.js: PATCH /password nunca toca OTRO grupo -----------
  const filaGrupoViejoAntes = JSON.stringify(TABLAS.grupos.find(g => g.id === 'grupo-viejo'));
  await invocarRuta(handlerPasswordPropio, { grupoId: idGrupoNuevo, body: { password: 'otraClaveMas1' } });
  const filaGrupoViejoDespues = JSON.stringify(TABLAS.grupos.find(g => g.id === 'grupo-viejo'));
  check(filaGrupoViejoAntes === filaGrupoViejoDespues, 'PATCH /api/grupo/password: cambiar la clave de UN grupo no toca para nada la fila de otro grupo');

  // --- No debe quedar ningún resto del servicio de cifrado ---------------
  check(!require('fs').existsSync(path.join(__dirname, '..', 'src', 'services', 'cifradoClave.js')), 'src/services/cifradoClave.js ya no existe (se revirtió por completo)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "reset de contraseña del grupo" se cayó con una excepción:', e);
  process.exit(1);
});
