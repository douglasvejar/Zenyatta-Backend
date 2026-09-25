// =================================================================
// PRUEBA: "Ver la clave de acceso de un grupo, desde Súper-admin"
// (25-09-2026, a pedido del usuario: "esa clave la cambien cuantas veces
// quieran siempre desde super admin la debo poder ver") y el cambio de
// clave del propio grupo desde "Ajustes > Seguridad"
// (PATCH /api/grupo/password).
//
// Cubre:
//   1) services/cifradoClave.js — cifrarClave()/descifrarClave() dan la
//      MISMA clave de vuelta (round-trip), null si no hay nada guardado,
//      y null (sin reventar) si el valor guardado está corrupto.
//   2) routes/superadmin.js:
//      - POST /grupos guarda password_hash Y password_visible_cifrada.
//      - GET /grupos/:id/detalle devuelve `claveActual` ya descifrada
//        cuando el grupo tiene password_visible_cifrada guardada, y
//        `claveActual: null` para un grupo viejo que todavía no la
//        tiene (no se puede recuperar un password_hash ya guardado).
//      - PATCH /grupos/:id/password actualiza LAS 2 columnas — de ahí
//        en adelante ese grupo también queda con su clave visible.
//   3) routes/grupo.js:
//      - PATCH /password exige al menos 4 caracteres (mismo mínimo que
//        ya exige el súper-admin).
//      - Actualiza password_hash Y password_visible_cifrada del grupo
//        de la SESIÓN (req.grupoId) — nunca de otro grupo.
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

// --- 1) cifradoClave.js, sin mockear nada (usa crypto real de Node) ---
const { cifrarClave, descifrarClave } = require(path.join(__dirname, '..', 'src', 'services', 'cifradoClave'));

(function pruebasCifrado() {
  const cifrada = cifrarClave('miClaveDePrueba123');
  check(typeof cifrada === 'string' && cifrada.length > 0, 'cifrarClave: devuelve un string no vacío');
  check(descifrarClave(cifrada) === 'miClaveDePrueba123', 'descifrarClave: da EXACTAMENTE la misma clave de vuelta (round-trip)');
  check(descifrarClave(null) === null, 'descifrarClave: null si no hay nada guardado (grupo viejo, ver la nota grande en sql/schema.sql)');
  check(descifrarClave('') === null, 'descifrarClave: null con un string vacío');
  check(descifrarClave('esto-no-es-un-valor-cifrado-valido') === null, 'descifrarClave: null (sin reventar) con un valor corrupto/con formato inválido');

  // Con un JWT_SECRET DISTINTO al que se usó para cifrar, no se puede
  // descifrar — confirma que la llave de verdad depende de JWT_SECRET.
  const cifradaConSecretoViejo = cifrarClave('otraClave');
  process.env.JWT_SECRET = 'un-secreto-completamente-distinto';
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'services', 'cifradoClave'))];
  const { descifrarClave: descifrarConOtroSecreto } = require(path.join(__dirname, '..', 'src', 'services', 'cifradoClave'));
  check(descifrarConOtroSecreto(cifradaConSecretoViejo) === null, 'descifrarClave: null si JWT_SECRET cambió desde que se cifró (no revienta, simplemente no se puede leer)');
  process.env.JWT_SECRET = 'clave-secreta-de-prueba-no-real'; // vuelve a la de siempre para el resto de la prueba
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'services', 'cifradoClave'))];
})();

// --- 2) routes/superadmin.js ---
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
    // Grupo YA EXISTENTE de antes de esta función — nunca cambió su clave,
    // así que no tiene password_visible_cifrada (NULL, como quedaría de
    // verdad en Supabase tras el ALTER TABLE).
    { id: 'grupo-viejo', nombre: 'Viejo', email: 'viejo@ejemplo.com', activo: true, creado_en: '2026-01-01T00:00:00Z', ultimo_login_en: null, ultimo_login_ip: null, ultimo_login_user_agent: null, logo_url: null, whatsapp_habilitado: false, whatsapp_grupo_jid: null, sabana_muestra: null, comandos_whatsapp_habilitado: false, comandos_whatsapp_numero: null, modulo_deportes_habilitado: true, modulo_hipismo_habilitado: false, hipismo_cruzar_habilitado: true, password_hash: 'hash-viejo', password_visible_cifrada: null }
  ],
  jugadores: []
};
let siguienteIdGrupo = 1;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^INSERT INTO grupos \(nombre, email, password_hash, password_visible_cifrada, activo\)/i.test(sql)) {
    const [nombre, email, passwordHash, passwordVisibleCifrada] = params;
    const fila = { id: 'grupo-nuevo-' + (siguienteIdGrupo++), nombre, email, password_hash: passwordHash, password_visible_cifrada: passwordVisibleCifrada, activo: false, creado_en: '2026-09-25T00:00:00Z' };
    TABLAS.grupos.push(fila);
    return { rows: [{ id: fila.id, nombre: fila.nombre, email: fila.email, activo: fila.activo, creado_en: fila.creado_en }] };
  }
  if (/^SELECT id, nombre, email, activo, creado_en, ultimo_login_en, ultimo_login_ip, ultimo_login_user_agent, logo_url, whatsapp_habilitado, whatsapp_grupo_jid, sabana_muestra.*password_visible_cifrada\s*FROM grupos WHERE id = \$1/i.test(sql)) {
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

  if (/^UPDATE grupos SET password_hash = \$1, password_visible_cifrada = \$2 WHERE id = \$3/i.test(sql)) {
    const [passwordHash, passwordVisibleCifrada, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.password_hash = passwordHash;
    grupo.password_visible_cifrada = passwordVisibleCifrada;
    return { rows: [{ id: grupo.id }] };
  }

  throw new Error('La base de datos falsa de esta prueba (ver la clave) no sabe responder: ' + sql);
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
  // --- POST /grupos guarda la clave visible desde el primer día -------
  const reqCrear = { body: { nombre: 'Grupo Nuevo', email: 'nuevo@ejemplo.com', password: 'clavesita1' } };
  const resCrear = await invocarRuta(handlerCrearGrupo, reqCrear);
  check(resCrear._status === 201, 'POST /grupos: responde 201');
  const idGrupoNuevo = resCrear._json.id;
  const filaGrupoNuevo = TABLAS.grupos.find(g => g.id === idGrupoNuevo);
  check(!!filaGrupoNuevo.password_visible_cifrada, 'POST /grupos: guarda password_visible_cifrada (no queda NULL)');
  check(descifrarClave(filaGrupoNuevo.password_visible_cifrada) === 'clavesita1', 'POST /grupos: lo que se guardó cifrado, descifra EXACTO a la clave que se mandó');

  // --- GET /grupos/:id/detalle: un grupo con clave visible -------------
  const resDetalleNuevo = await invocarRuta(handlerDetalle, { params: { id: idGrupoNuevo }, query: {} });
  check(resDetalleNuevo._json.claveActual === 'clavesita1', 'GET /detalle: un grupo con password_visible_cifrada devuelve claveActual ya descifrada');

  // --- GET /grupos/:id/detalle: un grupo VIEJO sin clave visible -------
  const resDetalleViejo = await invocarRuta(handlerDetalle, { params: { id: 'grupo-viejo' }, query: {} });
  check(resDetalleViejo._json.claveActual === null, 'GET /detalle: un grupo viejo (sin password_visible_cifrada) devuelve claveActual: null, no revienta ni inventa nada');

  // --- PATCH /grupos/:id/password (súper-admin restablece) "activa" ----
  // la visibilidad para ese grupo viejo, de ahí en adelante.
  const resReset = await invocarRuta(handlerResetPassword, { params: { id: 'grupo-viejo' }, body: { password: 'claveNuevaDelViejo' } });
  check(resReset._status === 204, 'PATCH /grupos/:id/password: responde 204');
  const resDetalleViejoTrasReset = await invocarRuta(handlerDetalle, { params: { id: 'grupo-viejo' }, query: {} });
  check(resDetalleViejoTrasReset._json.claveActual === 'claveNuevaDelViejo', 'Tras restablecerla desde Súper-admin, el grupo viejo YA queda con su clave visible de ahí en adelante');

  // --- PATCH /grupos/:id/password: valida mínimo de 4 caracteres -------
  const resResetCorta = await invocarRuta(handlerResetPassword, { params: { id: 'grupo-viejo' }, body: { password: 'ab' } });
  check(resResetCorta._status === 400, 'PATCH /grupos/:id/password: rechaza una clave de menos de 4 caracteres');

  // --- routes/grupo.js: PATCH /password (el propio grupo la cambia) ----
  const reqCambioPropio = { grupoId: idGrupoNuevo, body: { password: 'claveNuevaDelPropioGrupo' } };
  const resCambioPropio = await invocarRuta(handlerPasswordPropio, reqCambioPropio);
  check(resCambioPropio._status === 204, 'PATCH /api/grupo/password: responde 204');
  const filaTrasCambioPropio = TABLAS.grupos.find(g => g.id === idGrupoNuevo);
  check(filaTrasCambioPropio.password_hash === 'hash-de:claveNuevaDelPropioGrupo', 'PATCH /api/grupo/password: actualiza password_hash (lo que de verdad valida el login) con la clave nueva');
  check(descifrarClave(filaTrasCambioPropio.password_visible_cifrada) === 'claveNuevaDelPropioGrupo', 'PATCH /api/grupo/password: también actualiza password_visible_cifrada — el Súper-admin la sigue pudiendo ver');

  // --- routes/grupo.js: PATCH /password valida mínimo de 4 caracteres --
  const resCambioCorto = await invocarRuta(handlerPasswordPropio, { grupoId: idGrupoNuevo, body: { password: 'xy' } });
  check(resCambioCorto._status === 400, 'PATCH /api/grupo/password: rechaza una clave de menos de 4 caracteres');

  // --- routes/grupo.js: PATCH /password nunca toca OTRO grupo ----------
  const filaGrupoViejoAntes = JSON.stringify(TABLAS.grupos.find(g => g.id === 'grupo-viejo'));
  await invocarRuta(handlerPasswordPropio, { grupoId: idGrupoNuevo, body: { password: 'otraClaveMas1' } });
  const filaGrupoViejoDespues = JSON.stringify(TABLAS.grupos.find(g => g.id === 'grupo-viejo'));
  check(filaGrupoViejoAntes === filaGrupoViejoDespues, 'PATCH /api/grupo/password: cambiar la clave de UN grupo no toca para nada la fila de otro grupo');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "ver la clave del grupo" se cayó con una excepción:', e);
  process.exit(1);
});
