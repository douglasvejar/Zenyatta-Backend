// =================================================================
// PRUEBA: PATCH /api/superadmin/grupos/:id/modelo-comision (08-09-2026,
// a pedido del usuario — ver la nota grande en sql/schema.sql,
// comisiones.js y src/routes/superadmin.js). Igual que
// whatsapp-habilitado/whatsapp-jid, es EXCLUSIVO de Súper-admin.
//
// Mismo patrón de base de datos falsa + express falso que
// test_whatsapp_habilitado_superadmin.js — invoca el handler real de la
// ruta directo, sin levantar un servidor HTTP.
//
// Cubre: guardar el modelo 'plano' (sin tiers) y 'por_tipo_jugada' (con
// tiers), las validaciones (modelo inválido, sin tiers, tier con logros
// no entero/<=0, tier con porcentaje inválido), que GET
// /grupos/:id/detalle devuelva modeloComision/comisionTiers, y 404 para
// un grupo que no existe.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  grupos: [
    {
      id: 'grupo-1', nombre: 'Deportes Zenyatta TX', email: 'g1@x.com', activo: true, creado_en: new Date(),
      ultimo_login_en: null, ultimo_login_ip: null, ultimo_login_user_agent: null,
      logo_url: null, whatsapp_habilitado: false, whatsapp_grupo_jid: null, sabana_muestra: null,
      modelo_comision: 'plano', comision_tiers: []
    }
  ],
  jugadores: [],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  tickets_historial: [],
  polla_historial: [],
  transferencias: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^UPDATE grupos SET modelo_comision = \$1, comision_tiers = \$2 WHERE id = \$3 RETURNING id, modelo_comision, comision_tiers/i.test(sql)) {
    const [modelo, tiersJson, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.modelo_comision = modelo;
    grupo.comision_tiers = JSON.parse(tiersJson);
    return { rows: [{ id: grupo.id, modelo_comision: grupo.modelo_comision, comision_tiers: grupo.comision_tiers }] };
  }

  // --- lo que necesita GET /grupos/:id/detalle ---
  if (/^SELECT id, nombre, email, activo, creado_en, ultimo_login_en, ultimo_login_ip, ultimo_login_user_agent, logo_url, whatsapp_habilitado, whatsapp_grupo_jid, sabana_muestra.*FROM grupos WHERE id = \$1/i.test(sql)) {
    const grupo = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: grupo ? [grupo] : [] };
  }
  if (/^SELECT COUNT\(\*\)::int AS total FROM jugadores WHERE grupo_id = \$1 AND activo = true/i.test(sql)) return { rows: [{ total: 0 }] };
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    const grupo = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: grupo ? [{ modelo_comision: grupo.modelo_comision, comision_tiers: grupo.comision_tiers }] : [] };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT MIN\(fecha\) AS min_fecha FROM tickets_historial WHERE grupo_id = \$1/i.test(sql)) return { rows: [{ min_fecha: null }] };

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

Module._load = originalLoad;

const entradaModelo = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'patch' && args[0] === '/grupos/:id/modelo-comision');
const handlerModelo = entradaModelo[1][1];
const entradaDetalle = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'get' && args[0] === '/grupos/:id/detalle');
const handlerDetalle = entradaDetalle[1][1];

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
  // --- 1) Guardar el modelo 'por_tipo_jugada' con tiers válidos ---
  const req1 = { params: { id: 'grupo-1' }, body: { modelo: 'por_tipo_jugada', tiers: [{ logros: 1, porcentaje: 2 }, { logros: 2, porcentaje: 3 }, { logros: 3, porcentaje: 5 }] } };
  const res1 = await invocarRuta(handlerModelo, req1);
  check(res1._status === 200, 'PATCH modelo-comision con tiers válidos responde 200');
  check(res1._json.modeloComision === 'por_tipo_jugada', 'la respuesta confirma el modelo guardado');
  check(Array.isArray(res1._json.comisionTiers) && res1._json.comisionTiers.length === 3, 'la respuesta trae los 3 tiers guardados');
  check(TABLAS.grupos[0].modelo_comision === 'por_tipo_jugada', 'quedó de verdad guardado en la fila del grupo');

  // --- 2) GET /detalle ahora refleja el modelo y los tiers guardados ---
  const reqDetalle = { params: { id: 'grupo-1' }, query: {} };
  const resDetalle = await invocarRuta(handlerDetalle, reqDetalle);
  check(resDetalle._json.modeloComision === 'por_tipo_jugada', 'GET /grupos/:id/detalle trae modeloComision');
  check(Array.isArray(resDetalle._json.comisionTiers) && resDetalle._json.comisionTiers.length === 3, 'GET /grupos/:id/detalle trae comisionTiers');

  // --- 3) Volver a 'plano' (sin tiers, no hacen falta) ---
  const req2 = { params: { id: 'grupo-1' }, body: { modelo: 'plano' } };
  const res2 = await invocarRuta(handlerModelo, req2);
  check(res2._status === 200, 'PATCH modelo-comision a "plano" (sin tiers) responde 200');
  check(res2._json.modeloComision === 'plano', 'vuelve a "plano"');
  check(Array.isArray(res2._json.comisionTiers) && res2._json.comisionTiers.length === 0, 'al volver a "plano", los tiers quedan vacíos');

  // --- 4) Modelo inválido ---
  const req3 = { params: { id: 'grupo-1' }, body: { modelo: 'lo-que-sea' } };
  const res3 = await invocarRuta(handlerModelo, req3);
  check(res3._status === 400, 'un modelo que no es "plano" ni "por_tipo_jugada" responde 400');

  // --- 5) 'por_tipo_jugada' sin ningún tier ---
  const req4 = { params: { id: 'grupo-1' }, body: { modelo: 'por_tipo_jugada', tiers: [] } };
  const res4 = await invocarRuta(handlerModelo, req4);
  check(res4._status === 400, '"por_tipo_jugada" sin ningún tier responde 400 (hace falta al menos 1 nivel)');

  // --- 6) tier con logros inválidos (0, negativo, no entero) ---
  const req5 = { params: { id: 'grupo-1' }, body: { modelo: 'por_tipo_jugada', tiers: [{ logros: 0, porcentaje: 2 }] } };
  const res5 = await invocarRuta(handlerModelo, req5);
  check(res5._status === 400, 'un tier con logros = 0 responde 400');

  const req6 = { params: { id: 'grupo-1' }, body: { modelo: 'por_tipo_jugada', tiers: [{ logros: 1.5, porcentaje: 2 }] } };
  const res6 = await invocarRuta(handlerModelo, req6);
  check(res6._status === 400, 'un tier con logros no entero (1.5) responde 400');

  // --- 7) tier con porcentaje inválido (negativo o no numérico) ---
  const req7 = { params: { id: 'grupo-1' }, body: { modelo: 'por_tipo_jugada', tiers: [{ logros: 1, porcentaje: -5 }] } };
  const res7 = await invocarRuta(handlerModelo, req7);
  check(res7._status === 400, 'un tier con porcentaje negativo responde 400');

  const req8 = { params: { id: 'grupo-1' }, body: { modelo: 'por_tipo_jugada', tiers: [{ logros: 1, porcentaje: 'nada' }] } };
  const res8 = await invocarRuta(handlerModelo, req8);
  check(res8._status === 400, 'un tier con porcentaje no numérico responde 400');

  // --- 8) un porcentaje de 0 SÍ es válido (un nivel que no cobra nada, a propósito) ---
  const req9 = { params: { id: 'grupo-1' }, body: { modelo: 'por_tipo_jugada', tiers: [{ logros: 1, porcentaje: 0 }] } };
  const res9 = await invocarRuta(handlerModelo, req9);
  check(res9._status === 200, 'un tier con porcentaje = 0 es válido (un nivel que a propósito no cobra nada)');

  // --- 9) grupo que no existe -> 404 ---
  const req10 = { params: { id: 'no-existe' }, body: { modelo: 'plano' } };
  const res10 = await invocarRuta(handlerModelo, req10);
  check(res10._status === 404, 'PATCH modelo-comision sobre un grupo que no existe da 404');

  // =================================================================
  // --- 10) FIX del 09-09-2026 ("grupo mixto"): los tiers YA NO se
  // borran al volver el modelo DEFAULT del grupo a "plano", si el body
  // SÍ trae una lista de tiers -- hacen falta para cualquier cliente con
  // la excepción individual "por_tipo_jugada" cargada (ver
  // jugadores.modelo_comision). Antes de este fix, esto los hubiera
  // vaciado a [] sin importar qué viniera en el body.
  // =================================================================
  const req11 = { params: { id: 'grupo-1' }, body: { modelo: 'por_tipo_jugada', tiers: [{ logros: 1, porcentaje: 2 }, { logros: 2, porcentaje: 3 }, { logros: 3, porcentaje: 5 }] } };
  const res11 = await invocarRuta(handlerModelo, req11);
  check(res11._status === 200, 'preparación: se recargan los 3 tiers de siempre con modelo por_tipo_jugada');

  const req12 = { params: { id: 'grupo-1' }, body: { modelo: 'plano', tiers: [{ logros: 1, porcentaje: 2 }, { logros: 2, porcentaje: 3 }, { logros: 3, porcentaje: 5 }] } };
  const res12 = await invocarRuta(handlerModelo, req12);
  check(res12._status === 200, 'volver a "plano" CON un array de tiers en el body responde 200');
  check(res12._json.modeloComision === 'plano', 'el modelo default del grupo sí cambia a "plano"');
  check(Array.isArray(res12._json.comisionTiers) && res12._json.comisionTiers.length === 3, 'FIX: los 3 tiers se PRESERVAN (no se borran) porque el body los trajo explícitamente, aunque el modelo default ya no sea "por_tipo_jugada"');
  check(TABLAS.grupos[0].comision_tiers.length === 3, 'quedaron de verdad guardados en la fila del grupo, no solo en la respuesta');

  // Si el body NO trae ninguna lista de tiers (como en la prueba #3, más
  // arriba), el comportamiento sigue siendo "quedan vacíos" -- eso nunca
  // cambió, ni tenía por qué: no hay ningún tier que preservar si nadie
  // mandó ninguno.
  const req13 = { params: { id: 'grupo-1' }, body: { modelo: 'plano' } };
  const res13 = await invocarRuta(handlerModelo, req13);
  check(res13._status === 200, 'volver a "plano" SIN mandar tiers en el body sigue respondiendo 200');
  check(Array.isArray(res13._json.comisionTiers) && res13._json.comisionTiers.length === 0, 'sin tiers en el body, quedan vacíos (nada que preservar) -- esto es DISTINTO a "borrarlos a la fuerza": es simplemente lo que se mandó');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de modelo-comision se cayó con una excepción:', e);
  process.exit(1);
});
