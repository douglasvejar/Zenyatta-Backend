// =================================================================
// PRUEBA: PATCH /api/superadmin/grupos/:id/whatsapp-habilitado y PATCH
// /api/superadmin/grupos/:id/whatsapp-jid (04-09-2026, a pedido del
// usuario: "este servicio sera un plus para los grupos que compren el
// servicio... quiero desde super admin poder habilitar esta opcion o no
// a los grupos" y "el codigo para activar el bot con el grupo de
// whatsaap solo lo puede activar, editar o eliminar desde super admin").
//
// Mismo patrón de base de datos falsa + express falso que
// test_superadmin_logo.js — invoca el handler real de la ruta directo,
// sin levantar un servidor HTTP.
//
// Cubre: prender/apagar el interruptor whatsapp_habilitado, guardar y
// borrar (con null o string vacío) el JID, que ninguna de las dos rutas
// exista del lado del Grupo (routes/whatsapp.js) — solo acá, del lado de
// Súper-admin — y que un grupo_id que no existe dé 404 en ambas.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  grupos: [
    { id: 'grupo-1', nombre: 'Deportes Zenyatta TX', whatsapp_habilitado: false, whatsapp_grupo_jid: null }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^UPDATE grupos SET whatsapp_habilitado = \$1 WHERE id = \$2 RETURNING id, whatsapp_habilitado, whatsapp_grupo_jid/i.test(sql)) {
    const [habilitado, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.whatsapp_habilitado = habilitado;
    return { rows: [{ id: grupo.id, whatsapp_habilitado: grupo.whatsapp_habilitado, whatsapp_grupo_jid: grupo.whatsapp_grupo_jid }] };
  }
  if (/^UPDATE grupos SET whatsapp_grupo_jid = \$1 WHERE id = \$2 RETURNING id, whatsapp_grupo_jid/i.test(sql)) {
    const [jid, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.whatsapp_grupo_jid = jid;
    return { rows: [{ id: grupo.id, whatsapp_grupo_jid: grupo.whatsapp_grupo_jid }] };
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
const whatsappRouter = require(path.join(__dirname, '..', 'src', 'routes', 'whatsapp'));

Module._load = originalLoad;

const entradaHabilitado = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'patch' && args[0] === '/grupos/:id/whatsapp-habilitado');
const handlerHabilitado = entradaHabilitado[1][1];
const entradaJid = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'patch' && args[0] === '/grupos/:id/whatsapp-jid');
const handlerJid = entradaJid[1][1];

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
  // --- 0) Ninguna de las dos rutas existe del lado del Grupo (04-09-2026:
  // se sacó PUT /grupo-jid de routes/whatsapp.js) — solo del lado de
  // Súper-admin, para que el propio Grupo no pueda tocar a qué grupo de
  // WhatsApp le apunta el bot ni prenderse el servicio solo ---
  const rutaJidDelGrupo = whatsappRouter.__handlers.find(([metodo, args]) => (metodo === 'put' || metodo === 'patch') && typeof args[0] === 'string' && args[0].includes('jid'));
  check(!rutaJidDelGrupo, 'routes/whatsapp.js (el lado del Grupo) ya NO tiene ninguna ruta para tocar el JID — eso pasó a ser exclusivo de Súper-admin');
  const rutaHabilitadoDelGrupo = whatsappRouter.__handlers.find(([metodo, args]) => typeof args[0] === 'string' && args[0].includes('habilitado'));
  check(!rutaHabilitadoDelGrupo, 'routes/whatsapp.js (el lado del Grupo) tampoco tiene ninguna ruta para prenderse el servicio solo');

  // --- 1) PATCH whatsapp-habilitado: prender el servicio ---
  const req1 = { params: { id: 'grupo-1' }, body: { habilitado: true } };
  const res1 = await invocarRuta(handlerHabilitado, req1);
  check(res1._status === 200, 'PATCH whatsapp-habilitado con true responde 200');
  check(res1._json.whatsappHabilitado === true, 'la respuesta confirma que quedó habilitado');
  check(TABLAS.grupos[0].whatsapp_habilitado === true, 'quedó de verdad guardado en la fila del grupo');

  // --- 2) apagarlo de nuevo ---
  const req2 = { params: { id: 'grupo-1' }, body: { habilitado: false } };
  const res2 = await invocarRuta(handlerHabilitado, req2);
  check(res2._json.whatsappHabilitado === false, 'PATCH whatsapp-habilitado con false lo apaga de nuevo');
  check(TABLAS.grupos[0].whatsapp_habilitado === false, 'quedó de verdad apagado en la fila del grupo');

  // --- 3) valores "truthy"/"falsy" raros se normalizan a booleano real ---
  const req3 = { params: { id: 'grupo-1' }, body: { habilitado: 'sí' } };
  const res3 = await invocarRuta(handlerHabilitado, req3);
  check(res3._json.whatsappHabilitado === true, 'un valor truthy cualquiera (ej. un string) se normaliza a boolean true, no se guarda tal cual');

  // --- 4) grupo que no existe -> 404 ---
  const req4 = { params: { id: 'no-existe' }, body: { habilitado: true } };
  const res4 = await invocarRuta(handlerHabilitado, req4);
  check(res4._status === 404, 'PATCH whatsapp-habilitado sobre un grupo que no existe da 404');

  // --- 5) PATCH whatsapp-jid: guardar un JID ---
  TABLAS.grupos[0].whatsapp_habilitado = true;
  const req5 = { params: { id: 'grupo-1' }, body: { jid: '120363000000000001@g.us' } };
  const res5 = await invocarRuta(handlerJid, req5);
  check(res5._status === 200, 'PATCH whatsapp-jid con un JID responde 200');
  check(res5._json.whatsappGrupoJid === '120363000000000001@g.us', 'la respuesta devuelve el JID guardado');
  check(TABLAS.grupos[0].whatsapp_grupo_jid === '120363000000000001@g.us', 'quedó de verdad guardado en la fila del grupo');

  // --- 6) desvincular con jid: null ---
  const req6 = { params: { id: 'grupo-1' }, body: { jid: null } };
  const res6 = await invocarRuta(handlerJid, req6);
  check(res6._json.whatsappGrupoJid === null, 'mandar jid:null desvincula (queda null en la respuesta)');
  check(TABLAS.grupos[0].whatsapp_grupo_jid === null, 'quedó null de verdad en la fila del grupo');

  // --- 7) desvincular con string vacío/espacios también borra ---
  TABLAS.grupos[0].whatsapp_grupo_jid = '120363000000000001@g.us';
  const req7 = { params: { id: 'grupo-1' }, body: { jid: '   ' } };
  const res7 = await invocarRuta(handlerJid, req7);
  check(res7._json.whatsappGrupoJid === null, 'un JID de solo espacios también se recorta y queda null');

  // --- 8) grupo que no existe -> 404 ---
  const req8 = { params: { id: 'no-existe' }, body: { jid: 'algo@g.us' } };
  const res8 = await invocarRuta(handlerJid, req8);
  check(res8._status === 404, 'PATCH whatsapp-jid sobre un grupo que no existe da 404');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de whatsapp-habilitado/whatsapp-jid se cayó con una excepción:', e);
  process.exit(1);
});
