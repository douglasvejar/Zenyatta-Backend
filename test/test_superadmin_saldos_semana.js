// =================================================================
// PRUEBA: routes/superadmin.js — GET /grupos/:id/saldos-semana (21-09-2026,
// mismo pedido de "⬇️ Descargar" del panel del Grupo, extendido acá para
// que el Súper-admin pueda ver/descargar "📅 Saldos Semana" de CUALQUIER
// grupo por :id de la URL, de solo lectura). El cálculo en sí
// (construirSaldosSemana) ya está probado a fondo en test_saldos_semana.js
// — esta prueba solo cubre el WIRING de la ruta: que exista, que busque el
// grupo por el :id de la URL (no de ninguna sesión), que pase ?fecha= tal
// cual, y que dé 404 si el grupo no existe (mismo criterio que
// /grupos/:id/detalle y /grupos/:id/balance-clientes).
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g1';

const TABLAS = {
  grupos: [{ id: GRUPO_ID, nombre: 'Deportes Bernal', logo_url: 'https://ejemplo.com/logo.png', modelo_comision: 'plano', comision_tiers: [] }],
  jugadores: [
    { id: 'j-manolo', grupo_id: GRUPO_ID, nombre: 'MANOLO', activo: true, comision_propia: 5 }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  tickets_historial: [
    { id: 't1', grupo_id: GRUPO_ID, fecha: '2026-09-15', cliente_nombre: 'MANOLO', ticket_label: 'T1', detalle: 'x', arriesga: 80, gana: 72, estado: 'GANADA' }
  ],
  polla_historial: [],
  transferencias: []
};

function enRango(fila, desde, hasta) {
  return (!desde || fila.fecha >= desde) && (!hasta || fila.fecha <= hasta);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT id, nombre, logo_url FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = TABLAS.grupos.find(x => x.id === params[0]);
    return { rows: g ? [{ id: g.id, nombre: g.nombre, logo_url: g.logo_url }] : [] };
  }
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.avales.filter(a => a.grupo_id === params[0]) };
  if (/FROM equipos_globales/i.test(sql)) return { rows: TABLAS.equipos_globales };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: TABLAS.equipos_personalizados };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: g ? [{ modelo_comision: g.modelo_comision, comision_tiers: g.comision_tiers }] : [] };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ id: t.id, fecha: t.fecha, cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado })) };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.polla_historial.filter(p => p.grupo_id === grupoId && enRango(p, desde, hasta));
    return { rows: filas.map(p => ({ id: p.id, fecha: p.fecha, cliente: p.cliente_nombre, monto: p.monto, nota: null })) };
  }
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.transferencias.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ cliente_origen: t.cliente_origen, cliente_destino: t.cliente_destino, monto: t.monto })) };
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

function handlerDe(metodo, ruta) {
  const entrada = superadminRouter.__handlers.find(([m, args]) => m === metodo && args[0] === ruta);
  if (!entrada) throw new Error('No se registró la ruta ' + metodo.toUpperCase() + ' ' + ruta);
  return entrada[1][entrada[1].length - 1];
}
const handlerSaldosSemana = handlerDe('get', '/grupos/:id/saldos-semana');

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
  const r1 = await invocarRuta(handlerSaldosSemana, { params: { id: GRUPO_ID }, query: { fecha: '2026-09-17' } });
  check(r1._status === 200, 'saldos-semana: responde 200 para un grupo que existe');
  check(r1._json.grupo && r1._json.grupo.nombre === 'Deportes Bernal', 'saldos-semana: trae el nombre del grupo buscado por el :id DE LA URL (no de ninguna sesión de Grupo)');
  check(r1._json.grupo.logoUrl === 'https://ejemplo.com/logo.png', 'saldos-semana: trae el logo del grupo buscado por :id');
  check(r1._json.semana && r1._json.semana.desde === '2026-09-14' && r1._json.semana.hasta === '2026-09-20', 'saldos-semana: respeta ?fecha= para elegir la semana (jueves 17 -> semana del 14 al 20)');
  const manolo = (r1._json.clientes || []).find(c => c.nombre === 'MANOLO');
  check(!!manolo && manolo.ganadoSemana === 72, 'saldos-semana: el cálculo real de construirSaldosSemana llega intacto hasta la respuesta (MANOLO ganó 72 el martes)');

  // Sin ?fecha -> igual responde 200 (construirSaldosSemana usa "la semana
  // actual" por defecto, mismo criterio que /grupos/:id/detalle).
  const r2 = await invocarRuta(handlerSaldosSemana, { params: { id: GRUPO_ID }, query: {} });
  check(r2._status === 200, 'saldos-semana: sin ?fecha también responde 200 (usa la semana actual por defecto)');

  // Grupo que no existe -> 404, mismo criterio que /detalle y
  // /balance-clientes.
  const r3 = await invocarRuta(handlerSaldosSemana, { params: { id: 'no-existe' }, query: {} });
  check(r3._status === 404, 'saldos-semana: un grupo_id que no existe da 404 (no revienta con un 500)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de superadmin saldos-semana se cayó con una excepción:', e);
  process.exit(1);
});
