// =================================================================
// PRUEBA: Papelera recuperable al eliminar la sábana de uno o varios
// días (03-09-2026, a pedido del usuario) — ver la nota grande en
// src/services/papeleraSabana.js. Base de datos falsa en memoria, mismo
// patrón que test_mantenimiento_telefonos.js (fakePool + fakeExpress,
// invocando los handlers reales de src/routes/sabana.js).
//
// Cubre:
//   1. POST /eliminar-fechas sin "fechas" -> 400, no toca nada.
//   2. POST /eliminar-fechas de un día con tickets Y polla: los mueve a
//      sabana_papelera, los borra de las tablas en vivo, desconfirma el
//      día, y deja EXACTAMENTE 1 alerta SABANA_ELIMINADA (a diferencia
//      del borrado de superadmin, que a propósito no genera alertas).
//   3. Un día SIN datos no genera entrada en la papelera ni alerta.
//   4. GET /papelera lista lo eliminado, con días restantes hasta la
//      purga automática.
//   5. POST /papelera/:id/restaurar reinserta los tickets/polla en las
//      tablas en vivo, marca la entrada como restaurada, y deja una
//      alerta SABANA_RESTAURADA — un segundo intento de restaurar la
//      MISMA entrada responde 400 (ya se restauró).
//   6. Una entrada de la papelera con más de 30 días se purga sola (ya
//      no aparece, y desaparece de la tabla) la próxima vez que se
//      consulta /papelera.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  tickets_historial: [
    { id: 't1', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'A', jugador_id: 'j-a', ticket_label: 'T1', detalle: 'x', arriesga: 100, gana: 0, estado: 'PERDIDA' },
    { id: 't2', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'B', jugador_id: 'j-b', ticket_label: 'T2', detalle: 'y', arriesga: 50, gana: 45, estado: 'GANADA' },
    { id: 't3', grupo_id: 'g1', fecha: '2026-09-02', cliente_nombre: 'A', jugador_id: 'j-a', ticket_label: 'T3', detalle: 'z', arriesga: 80, gana: 0, estado: 'PERDIDA' }
  ],
  polla_historial: [
    { id: 'p1', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'A', jugador_id: 'j-a', monto: -20, nota: null }
  ],
  dias_confirmados: [
    { grupo_id: 'g1', fecha: '2026-09-01' },
    { grupo_id: 'g1', fecha: '2026-09-02' }
  ],
  // (04-09-2026) el "estado" del bot de WhatsApp — 2026-09-01 SÍ había
  // llegado por WhatsApp (tiene texto guardado); simula justo el
  // escenario reportado: "elimino el ticket ... y me vuelve a aparecer".
  whatsapp_dia_estado: [
    { grupo_id: 'g1', fecha: '2026-09-01', ultimo_texto: 'SABANA DE JUGADAS\n01-09-2026\n...' },
    { grupo_id: 'g2', fecha: '2026-09-01', ultimo_texto: 'de OTRO grupo, no debe tocarse' }
  ],
  sabana_papelera: [],
  alertas: []
};
let contadorIds = 0;
function nuevoId(prefijo) { contadorIds++; return prefijo + '-' + contadorIds; }

function enFecha(fila, grupoId, fecha) { return fila.grupo_id === grupoId && fila.fecha === fecha; }

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  if (/^SELECT id, cliente_nombre, jugador_id, ticket_label, detalle, arriesga, gana, estado FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    return { rows: TABLAS.tickets_historial.filter(t => enFecha(t, grupoId, fecha)).map(({ grupo_id, fecha, ...resto }) => resto) };
  }
  if (/^SELECT id, cliente_nombre, jugador_id, monto, nota FROM polla_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    return { rows: TABLAS.polla_historial.filter(p => enFecha(p, grupoId, fecha)).map(({ grupo_id, fecha, ...resto }) => resto) };
  }
  if (/^INSERT INTO sabana_papelera \(grupo_id, fecha, tickets_json, polla_json\)/i.test(sql)) {
    const [grupoId, fecha, ticketsJson, pollaJson] = params;
    const id = nuevoId('pap');
    TABLAS.sabana_papelera.push({ id, grupo_id: grupoId, fecha, tickets_json: JSON.parse(ticketsJson), polla_json: JSON.parse(pollaJson), eliminado_en: new Date().toISOString(), restaurado_en: null });
    return { rows: [{ id }] };
  }
  if (/^DELETE FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2$/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.tickets_historial = TABLAS.tickets_historial.filter(t => !enFecha(t, grupoId, fecha));
    return { rows: [] };
  }
  if (/^DELETE FROM polla_historial WHERE grupo_id = \$1 AND fecha = \$2$/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.polla_historial = TABLAS.polla_historial.filter(p => !enFecha(p, grupoId, fecha));
    return { rows: [] };
  }
  // (04-09-2026) eliminarEstadoDia() — ver whatsappDiaEstado.js
  if (/^DELETE FROM whatsapp_dia_estado WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.whatsapp_dia_estado = TABLAS.whatsapp_dia_estado.filter(w => !(w.grupo_id === grupoId && w.fecha === fecha));
    return { rows: [] };
  }
  if (/^DELETE FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.dias_confirmados = TABLAS.dias_confirmados.filter(d => !(d.grupo_id === grupoId && d.fecha === fecha));
    return { rows: [] };
  }
  // El "tipo" ('SABANA_ELIMINADA'/'SABANA_RESTAURADA') va como literal
  // dentro del SQL (no como parámetro $N) — ver papeleraSabana.js — así
  // que se saca con un grupo de captura en vez de leerlo de "params".
  const mAlerta = sql.match(/^INSERT INTO alertas \(grupo_id, fecha, tipo, pata, mensaje, resuelta, resuelto_en\)\s*VALUES \(\$1, \$2, '([A-Z_]+)', \$3, \$4, true, now\(\)\)/i);
  if (mAlerta) {
    const tipo = mAlerta[1];
    const [grupoId, fecha, pata, mensaje] = params;
    TABLAS.alertas.push({ id: nuevoId('al'), grupo_id: grupoId, fecha, tipo, pata, mensaje, resuelta: true });
    return { rows: [] };
  }
  if (/^SELECT id, fecha, tickets_json, polla_json, eliminado_en, restaurado_en FROM sabana_papelera WHERE grupo_id = \$1 ORDER BY eliminado_en DESC/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.sabana_papelera.filter(p => p.grupo_id === grupoId).sort((a, b) => (a.eliminado_en < b.eliminado_en ? 1 : -1)) };
  }
  if (/^DELETE FROM sabana_papelera WHERE grupo_id = \$1 AND eliminado_en < now\(\) - interval '30 days'/i.test(sql)) {
    const [grupoId] = params;
    const cortePurga = Date.now() - 30 * 24 * 60 * 60 * 1000;
    TABLAS.sabana_papelera = TABLAS.sabana_papelera.filter(p => !(p.grupo_id === grupoId && new Date(p.eliminado_en).getTime() < cortePurga));
    return { rows: [] };
  }
  if (/^SELECT id, fecha, tickets_json, polla_json, restaurado_en FROM sabana_papelera WHERE grupo_id = \$1 AND id = \$2/i.test(sql)) {
    const [grupoId, id] = params;
    const fila = TABLAS.sabana_papelera.find(p => p.grupo_id === grupoId && p.id === id);
    return { rows: fila ? [fila] : [] };
  }
  if (/^INSERT INTO tickets_historial \(id, grupo_id, fecha, cliente_nombre, jugador_id, ticket_label, detalle, arriesga, gana, estado\)/i.test(sql)) {
    const [id, grupoId, fecha, cliente, jugadorId, ticket, detalle, arriesga, gana, estado] = params;
    if (!TABLAS.tickets_historial.find(t => t.id === id)) {
      TABLAS.tickets_historial.push({ id, grupo_id: grupoId, fecha, cliente_nombre: cliente, jugador_id: jugadorId, ticket_label: ticket, detalle, arriesga, gana, estado });
    }
    return { rows: [] };
  }
  if (/^INSERT INTO polla_historial \(id, grupo_id, fecha, cliente_nombre, jugador_id, monto, nota\)/i.test(sql)) {
    const [id, grupoId, fecha, cliente, jugadorId, monto, nota] = params;
    if (!TABLAS.polla_historial.find(p => p.id === id)) {
      TABLAS.polla_historial.push({ id, grupo_id: grupoId, fecha, cliente_nombre: cliente, jugador_id: jugadorId, monto, nota });
    }
    return { rows: [] };
  }
  if (/^UPDATE sabana_papelera SET restaurado_en = now\(\) WHERE id = \$1/i.test(sql)) {
    const [id] = params;
    const fila = TABLAS.sabana_papelera.find(p => p.id === id);
    if (fila) fila.restaurado_en = new Date().toISOString();
    return { rows: [] };
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

const FECHA_PRUEBA = '2026-09-01';
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com') || url.includes('/football/') || url.includes('/hockey/') || url.includes('/basketball/') || url.includes('/soccer/')) {
    return Promise.resolve({ json: async () => ({ dates: [], events: [] }) });
  }
  return Promise.reject(new Error('URL inesperada en la prueba: ' + url));
}

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'g1' }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
global.fetch = fakeFetch;

const sabanaRouter = require(path.join(__dirname, '..', 'src', 'routes', 'sabana'));

Module._load = originalLoad;

function handlerDe(metodo, ruta) {
  const entrada = sabanaRouter.__handlers.find(([m, args]) => m === metodo && args[0] === ruta);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo.toUpperCase() + ' ' + ruta);
  return entrada[1][entrada[1].length - 1];
}

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    res.end = () => { resolve(res); return res; };
    handler({ grupoId: 'g1', ...req }, res, (err) => { if (err) reject(err); });
  });
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const handlerEliminar = handlerDe('post', '/eliminar-fechas');
  const handlerPapelera = handlerDe('get', '/papelera');
  const handlerRestaurar = handlerDe('post', '/papelera/:id/restaurar');

  // --- 1) Sin "fechas" -> 400 ---
  const resVacio = await invocarRuta(handlerEliminar, { body: {} });
  check(resVacio._status === 400, 'POST /eliminar-fechas sin "fechas" responde 400');
  check(TABLAS.tickets_historial.length === 3, 'Nada se borró todavía');

  // --- 2) Eliminar 2026-09-01 (2 tickets + 1 polla) ---
  const resEliminar = await invocarRuta(handlerEliminar, { body: { fechas: ['2026-09-01'] } });
  check(resEliminar._status === 200, 'POST /eliminar-fechas responde 200');
  check(resEliminar._json.ticketsBorrados === 2, 'Reporta 2 tickets borrados');
  check(resEliminar._json.pollaBorrada === 1, 'Reporta 1 fila de polla borrada');
  check(resEliminar._json.papeleraIds.length === 1, 'Se creó 1 entrada en la papelera (1 día con datos)');
  check(TABLAS.tickets_historial.filter(t => t.fecha === '2026-09-01').length === 0, 'Ya no quedan tickets del 2026-09-01 en la tabla en vivo');
  check(TABLAS.tickets_historial.find(t => t.fecha === '2026-09-02'), 'Los tickets del 2026-09-02 (NO elegido) siguen intactos');
  check(TABLAS.polla_historial.length === 0, 'La polla del día eliminado también se borró de la tabla en vivo');
  check(!TABLAS.dias_confirmados.find(d => d.fecha === '2026-09-01'), 'El día eliminado quedó desconfirmado');
  check(TABLAS.dias_confirmados.find(d => d.fecha === '2026-09-02'), 'El día 2026-09-02 (no tocado) sigue confirmado');
  check(TABLAS.alertas.length === 1 && TABLAS.alertas[0].tipo === 'SABANA_ELIMINADA', 'Se generó EXACTAMENTE 1 alerta de tipo SABANA_ELIMINADA (a diferencia del borrado de superadmin, que no genera ninguna)');

  // (04-09-2026) "el ticket que borro me vuelve a aparecer" — eliminar la
  // sábana de un día que SÍ había llegado por WhatsApp también tiene que
  // borrar su seguimiento, para que el bot no la reprocese sola.
  check(TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === 'g1' && w.fecha === '2026-09-01') === undefined,
    'Eliminar 2026-09-01 (que SÍ había llegado por WhatsApp) también borra su fila de whatsapp_dia_estado');
  check(TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === 'g2' && w.fecha === '2026-09-01'),
    'La fila de whatsapp_dia_estado de OTRO grupo (g2), misma fecha, NO se tocó');

  const papeleraId = resEliminar._json.papeleraIds[0];

  // --- 3) Eliminar un día SIN datos: no crea papelera ni alerta ---
  const resSinDatos = await invocarRuta(handlerEliminar, { body: { fechas: ['2026-01-01'] } });
  check(resSinDatos._json.papeleraIds.length === 0, 'Un día sin ningún dato no genera entrada en la papelera');
  check(TABLAS.alertas.length === 1, 'Tampoco genera una alerta nueva (sigue habiendo solo 1)');

  // --- 4) GET /papelera ---
  const resPapelera = await invocarRuta(handlerPapelera, {});
  check(resPapelera._json.length === 1, 'GET /papelera lista la entrada recién creada');
  check(resPapelera._json[0].tickets === 2 && resPapelera._json[0].polla === 1, 'La entrada trae la cantidad correcta de tickets y polla guardados');
  check(resPapelera._json[0].diasRestantes === 30, 'Recién eliminada, quedan los 30 días completos para restaurar');
  check(resPapelera._json[0].restaurado === false, 'Todavía no se restauró');

  // --- 5) Restaurar ---
  const resRestaurar = await invocarRuta(handlerRestaurar, { params: { id: papeleraId } });
  check(resRestaurar._status === 200, 'POST /papelera/:id/restaurar responde 200');
  check(resRestaurar._json.ticketsRestaurados === 2 && resRestaurar._json.pollaRestaurada === 1, 'Reporta lo restaurado (2 tickets, 1 polla)');
  check(TABLAS.tickets_historial.filter(t => t.fecha === '2026-09-01').length === 2, 'Los 2 tickets del 2026-09-01 volvieron a la tabla en vivo');
  check(TABLAS.polla_historial.length === 1, 'La fila de polla también volvió');
  check(TABLAS.tickets_historial.find(t => t.id === 't1') && TABLAS.tickets_historial.find(t => t.id === 't2'), 'Los tickets restaurados conservan sus ids originales (t1, t2)');
  check(TABLAS.alertas.length === 2 && TABLAS.alertas[1].tipo === 'SABANA_RESTAURADA', 'Se generó una 2da alerta de tipo SABANA_RESTAURADA');

  // Restaurar de nuevo la MISMA entrada -> 400
  const resRestaurarOtraVez = await invocarRuta(handlerRestaurar, { params: { id: papeleraId } });
  check(resRestaurarOtraVez._status === 400, 'Restaurar la misma entrada una 2da vez responde 400 (ya se había restaurado)');

  // --- 6) Purga automática de entradas de más de 30 días ---
  TABLAS.sabana_papelera.push({
    id: 'pap-vieja', grupo_id: 'g1', fecha: '2026-01-01',
    tickets_json: [], polla_json: [],
    eliminado_en: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), // 40 días atrás
    restaurado_en: null
  });
  const resPapeleraConVieja = await invocarRuta(handlerPapelera, {});
  check(!resPapeleraConVieja._json.find(p => p.id === 'pap-vieja'), 'Una entrada de más de 30 días se purga sola y ya no aparece en /papelera');
  check(!TABLAS.sabana_papelera.find(p => p.id === 'pap-vieja'), 'La entrada vieja también desapareció de la tabla (purga real, no solo un filtro visual)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Papelera de Sábanas se cayó con una excepción:', e);
  process.exit(1);
});
