// =================================================================
// PRUEBA: GET /api/superadmin/grupos/:id/detalle — saldo de la banca por
// RANGO de fechas (01-09-2026, a pedido del usuario: "en la parte de
// saldo de banca me sale el saldo total de todo su historia, quiero
// predeterminado que salga semana actual, y pueda seleccionar fecha").
// =================================================================
// Mismo patrón de base de datos falsa + express falso que
// test_cliente_ruta.js/test_superadmin_logo.js — invoca el handler real
// de la ruta directo, sin levantar un servidor HTTP.
//
// Cubre:
//   1. Sin ?desde/?hasta/?rango, el saldo es SOLO de la semana actual
//      (no de todo el historial, que era el bug reportado) — un ticket
//      de hoy entra, uno de hace 60 días queda afuera.
//   2. ?rango=todo trae el historial completo (los 2 tickets).
//   3. ?desde&hasta a mano trae exactamente ese rango (el ticket viejo,
//      sin el de hoy).
//   4. La respuesta siempre trae `rango: {desde, hasta}` con el rango
//      REALMENTE usado, para que el frontend pueda mostrarlo/ precargar
//      los campos de fecha.
//   5. Un grupo_id que no existe sigue dando 404 (no se rompió con este
//      cambio).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

// --- Fechas de prueba: relativas a HOY, para que la prueba no dependa
// de en qué fecha de calendario se corra. ---
function formatearFechaISOLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mes + '-' + dia;
}
const HOY = new Date();
const FECHA_HOY = formatearFechaISOLocal(HOY);
const hace60 = new Date(HOY);
hace60.setDate(hace60.getDate() - 60);
const FECHA_VIEJA = formatearFechaISOLocal(hace60);

// --- Base de datos falsa en memoria ---
const TABLAS = {
  grupos: [
    { id: 'grupo-1', nombre: 'Deportes Zenyatta TX', email: 'zen@ejemplo.com', activo: true, creado_en: '2026-01-01T00:00:00Z', ultimo_login_en: null, ultimo_login_ip: null, ultimo_login_user_agent: null, logo_url: null, whatsapp_habilitado: true, whatsapp_grupo_jid: '120363000000000001@g.us', sabana_muestra: 'SABANA DE JUGADAS\nRANDY\n1) Astros -150 100' }
  ],
  jugadores: [
    { id: 'jugador-1', grupo_id: 'grupo-1', nombre: 'RANDY', comision_propia: 0, activo: true }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  transferencias: [],
  polla_historial: [],
  tickets_historial: [
    // Ticket de HOY: RANDY gana 80 sobre 100 arriesgados -> a la banca le
    // cuesta 80 (perdido 0 - ganado 80 - comisión 0 = -80).
    { grupo_id: 'grupo-1', fecha: FECHA_HOY, cliente_nombre: 'RANDY', ticket_label: 'Ticket #1', detalle: 'astros -150', arriesga: 100, gana: 80, estado: 'GANADA' },
    // Ticket de hace 60 días: RANDY pierde 50 -> le queda a favor de la
    // banca +50 (perdido 50 - ganado 0 - comisión 0 = +50).
    { grupo_id: 'grupo-1', fecha: FECHA_VIEJA, cliente_nombre: 'RANDY', ticket_label: 'Ticket #0', detalle: 'yankees +120', arriesga: 50, gana: 0, estado: 'PERDIDA' }
  ]
};

function filtrarTicketsHistorial(sql, params) {
  const grupoId = params[0];
  let idx = 1;
  let desde, hasta;
  if (/fecha >= \$/i.test(sql)) { desde = params[idx]; idx++; }
  if (/fecha <= \$/i.test(sql)) { hasta = params[idx]; idx++; }
  return TABLAS.tickets_historial.filter(r =>
    r.grupo_id === grupoId &&
    (!desde || r.fecha >= desde) &&
    (!hasta || r.fecha <= hasta)
  );
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT id, nombre, email, activo, creado_en, ultimo_login_en, ultimo_login_ip, ultimo_login_user_agent, logo_url, whatsapp_habilitado, whatsapp_grupo_jid, sabana_muestra.*FROM grupos WHERE id = \$1/i.test(sql)) {
    const grupo = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: grupo ? [grupo] : [] };
  }
  if (/^SELECT COUNT\(\*\)::int AS total FROM jugadores WHERE grupo_id = \$1 AND activo = true/i.test(sql)) {
    return { rows: [{ total: TABLAS.jugadores.filter(j => j.grupo_id === params[0] && j.activo).length }] };
  }
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  }
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.avales.filter(a => a.grupo_id === params[0]) };
  }
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_globales/i.test(sql)) {
    return { rows: TABLAS.equipos_globales };
  }
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_personalizados WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.equipos_personalizados.filter(e => e.grupo_id === params[0]) };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros FROM tickets_historial WHERE/i.test(sql)) {
    return { rows: filtrarTicketsHistorial(sql, params) };
  }
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  }
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) {
    return { rows: [] };
  }
  // "Polla" (02-09-2026) — calcularBalanceGeneral() ahora también suma
  // la polla del rango; esta prueba no la usa (queda vacía), pero
  // balanceGeneral.js igual la consulta siempre.
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT MIN\(fecha\) AS min_fecha FROM tickets_historial WHERE grupo_id = \$1/i.test(sql)) {
    const filas = TABLAS.tickets_historial.filter(r => r.grupo_id === params[0]);
    if (filas.length === 0) return { rows: [{ min_fecha: null }] };
    const minFecha = filas.map(r => r.fecha).sort()[0];
    return { rows: [{ min_fecha: minFecha }] };
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

Module._load = originalLoad;

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
  // --- Sin query params: por defecto tiene que ser la SEMANA ACTUAL, no
  // todo el historial (el bug que reportó el usuario) ---
  const req1 = { params: { id: 'grupo-1' }, query: {} };
  const res1 = await invocarRuta(handlerDetalle, req1);
  check(res1._status === 200, 'Sin query params responde 200');
  check(res1._json.saldoBanca === -80, 'Sin query params, el saldo es SOLO de la semana actual (-80, no -80+50=-30 de todo el historial)');
  check(!!res1._json.rango && !!res1._json.rango.desde && !!res1._json.rango.hasta, 'La respuesta trae el rango {desde, hasta} que de verdad se usó');
  check(res1._json.rango.desde <= FECHA_HOY && res1._json.rango.hasta >= FECHA_HOY, 'El rango por defecto incluye el día de hoy (es la semana actual)');
  check(res1._json.whatsappHabilitado === true, 'la respuesta trae whatsappHabilitado (04-09-2026, interruptor del servicio automático)');
  check(res1._json.whatsappGrupoJid === '120363000000000001@g.us', 'la respuesta trae whatsappGrupoJid tal cual está guardado');
  check(res1._json.sabanaMuestra === 'SABANA DE JUGADAS\nRANDY\n1) Astros -150 100', 'la respuesta trae sabanaMuestra tal cual está guardado (05-09-2026, campo de referencia)');

  // --- ?rango=todo: trae el historial completo ---
  const req2 = { params: { id: 'grupo-1' }, query: { rango: 'todo' } };
  const res2 = await invocarRuta(handlerDetalle, req2);
  check(res2._json.saldoBanca === -30, '?rango=todo suma los 2 tickets (-80 + 50 = -30)');
  check(res2._json.rango.desde === FECHA_VIEJA, '?rango=todo arranca en la fecha del ticket más viejo');

  // --- ?desde&hasta a mano: solo el ticket viejo ---
  const req3 = { params: { id: 'grupo-1' }, query: { desde: FECHA_VIEJA, hasta: FECHA_VIEJA } };
  const res3 = await invocarRuta(handlerDetalle, req3);
  check(res3._json.saldoBanca === 50, '?desde&hasta a mano trae solo el ticket de esa fecha (+50)');
  check(res3._json.rango.desde === FECHA_VIEJA && res3._json.rango.hasta === FECHA_VIEJA, 'El rango devuelto es exactamente el pedido a mano');

  // --- Grupo que no existe ---
  const req4 = { params: { id: 'grupo-que-no-existe' }, query: {} };
  const res4 = await invocarRuta(handlerDetalle, req4);
  check(res4._status === 404, 'Un grupo_id que no existe sigue dando 404');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de GET /grupos/:id/detalle se cayó con una excepción:', e);
  process.exit(1);
});
