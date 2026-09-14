// =================================================================
// PRUEBA: routes/whatsapp.js — el lado del GRUPO del panel de WhatsApp,
// después de la revisión del 04-09-2026 (a pedido del usuario: "este
// servicio sera un plus para los grupos que compren el servicio...
// cuando este habilitada la opcion de sabana automatica, se debe cargar
// en resumen por cliente las jugadas y los saldos... como si se cargara
// la sabana manual").
//
// Cubre las 3 rutas que le quedaron a este archivo:
//   - GET /estado: sin el servicio contratado (whatsapp_habilitado=false)
//     responde de una un shape "apagado", sin tocar whatsappDiaEstado ni
//     la bandeja de pendientes.
//   - POST /dias/:fecha/enviar-resumen: rechaza con 400 sin el servicio
//     contratado, ANTES de fijarse si el bot está activado en el
//     servidor.
//   - GET /dias/:fecha/resumen (NUEVA — el auto-load de "Resumen por
//     Cliente"): 400 sin el servicio, 404 si todavía no llegó ninguna
//     sábana esa fecha, y 200 con el MISMO shape que POST
//     /api/sabana/procesar (resumenPorCliente/tickets/...) cuando sí hay
//     una sábana ya cargada por WhatsApp.
//
// Mismo patrón de "pg"/"fetch"/"express" falsos que
// test_whatsapp_bot_flujo.js / test_superadmin_logo.js — invoca los
// handlers reales de la ruta directo, sin levantar un servidor HTTP ni
// necesitar @whiskeysockets/baileys instalado.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g1';
const JID = '120363000000000001@g.us';
const FECHA = '2026-09-02';

const TABLAS = {
  grupos: [{ id: GRUPO_ID, whatsapp_grupo_jid: JID, whatsapp_habilitado: true }],
  jugadores: [{ id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', activo: true, comision_propia: 0 }],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  polla_historial: [],
  sabanas_pendientes_whatsapp: [],
  whatsapp_dia_estado: []
};

// --- fetch falso: ningún partido tiene resultado todavía (no hace falta
// más que eso para estas pruebas — no se prueba el "cierre" acá, ya está
// cubierto de sobra por test_whatsapp_bot_flujo.js) ---
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({ json: async () => ({ dates: [{ games: [] }] }) });
  }
  if (url.includes('/football/nfl/') || url.includes('/hockey/nhl/') || url.includes('/basketball/nba/') || url.includes('/soccer/')) {
    return Promise.resolve({ json: async () => ({ events: [] }) });
  }
  return Promise.reject(new Error('URL inesperada en la prueba: ' + url));
}
global.fetch = fakeFetch;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  // (04-09-2026) registrosSinCambios() en historial.js — esta prueba no
  // trackea el contenido real de tickets_historial, así que "sin filas
  // guardadas todavía" es siempre la respuesta correcta acá.
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO alertas/i.test(sql)) return { rows: [{ id: 'a-' + Math.random().toString(36).slice(2) }] };

  // --- sabanasPendientesWhatsapp.js (listarRecientes) ---
  if (/^SELECT .* FROM sabanas_pendientes_whatsapp WHERE grupo_id = \$1 ORDER BY recibido_en DESC LIMIT/i.test(sql)) {
    return { rows: TABLAS.sabanas_pendientes_whatsapp.filter(p => p.grupo_id === params[0]) };
  }

  // --- whatsappDiaEstado.js ---
  if (/^SELECT .* FROM whatsapp_dia_estado WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    return { rows: fila ? [fila] : [] };
  }
  if (/^SELECT .* FROM whatsapp_dia_estado WHERE grupo_id = \$1 AND fecha >=/i.test(sql)) {
    return { rows: TABLAS.whatsapp_dia_estado.filter(w => w.grupo_id === params[0]) };
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
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
delete process.env.WHATSAPP_BOT_ACTIVADO; // arranca APAGADO a nivel servidor en estas pruebas

const whatsappRouter = require(path.join(__dirname, '..', 'src', 'routes', 'whatsapp'));

Module._load = originalLoad;

function handlerDe(metodo, ruta) {
  const entrada = whatsappRouter.__handlers.find(([m, args]) => m === metodo && args[0] === ruta);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo + ' ' + ruta);
  // El último argumento es siempre el handler real (los routers de esta
  // app solo usan un middleware por ruta, el de asyncHandler ya envuelto).
  return entrada[1][entrada[1].length - 1];
}
const handlerEstado = handlerDe('get', '/estado');
const handlerEnviarResumen = handlerDe('post', '/dias/:fecha/enviar-resumen');
const handlerResumen = handlerDe('get', '/dias/:fecha/resumen');

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

function reqPara(grupo, extra) {
  return Object.assign({ grupoId: grupo.id, grupo, params: {}, query: {}, body: {} }, extra || {});
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const grupoSinServicio = { id: GRUPO_ID, whatsapp_grupo_jid: JID, whatsapp_habilitado: false };
  const grupoConServicio = { id: GRUPO_ID, whatsapp_grupo_jid: JID, whatsapp_habilitado: true };

  // --- 1) GET /estado sin el servicio contratado: shape "apagado", sin
  // tocar whatsappDiaEstado/pendientesService (si los tocara, con la
  // base de datos falsa de arriba reventaría igual, pero lo confirmamos
  // explícitamente con el shape esperado) ---
  const r1 = await invocarRuta(handlerEstado, reqPara(grupoSinServicio));
  check(r1._status === 200, 'GET /estado sin servicio contratado responde 200 igual (no es un error, es un estado válido)');
  check(r1._json.habilitado === false, 'la respuesta dice habilitado:false');
  check(Array.isArray(r1._json.dias) && r1._json.dias.length === 0, 'sin servicio, "dias" viene vacío (nunca llega a consultar whatsapp_dia_estado)');
  check(Array.isArray(r1._json.recientes) && r1._json.recientes.length === 0, 'sin servicio, "recientes" también viene vacío');

  // --- 2) GET /estado CON el servicio contratado: shape completo ---
  const r2 = await invocarRuta(handlerEstado, reqPara(grupoConServicio));
  check(r2._json.habilitado === true, 'GET /estado con el servicio contratado dice habilitado:true');
  check(r2._json.botActivo === false, 'con WHATSAPP_BOT_ACTIVADO sin poner, botActivo da false');
  check(r2._json.grupoVinculado === true, 'grupoVinculado refleja que este grupo tiene whatsapp_grupo_jid cargado');
  check(Array.isArray(r2._json.dias), 'con servicio contratado, "dias" SÍ se consulta (viene como array, aunque esté vacío)');

  // --- 3) POST /dias/:fecha/enviar-resumen: 400 sin el servicio
  // (NUNCA 403/401 -- eso dispara un cierre de sesión del lado del
  // frontend, ver la nota en routes/whatsapp.js),
  // ANTES de fijarse si el bot del servidor está activado ---
  const r3 = await invocarRuta(handlerEnviarResumen, reqPara(grupoSinServicio, { params: { fecha: FECHA } }));
  check(r3._status === 400, 'POST /dias/:fecha/enviar-resumen sin el servicio contratado da 400 (nunca 403/401, para no disparar un cierre de sesión del lado del frontend)');

  // --- 4) con servicio, pero el bot del SERVIDOR no está activado -> 400 ---
  const r4 = await invocarRuta(handlerEnviarResumen, reqPara(grupoConServicio, { params: { fecha: FECHA } }));
  check(r4._status === 400, 'con el servicio contratado pero el bot del servidor apagado (WHATSAPP_BOT_ACTIVADO), da 400');

  // --- 5) GET /dias/:fecha/resumen: 400 sin el servicio ---
  const r5 = await invocarRuta(handlerResumen, reqPara(grupoSinServicio, { params: { fecha: FECHA } }));
  check(r5._status === 400, 'GET /dias/:fecha/resumen sin el servicio contratado da 400 (mismo motivo: nunca 403/401 acá)');

  // --- 6) con servicio, pero todavía no llegó ninguna sábana esa fecha -> 404 ---
  const r6 = await invocarRuta(handlerResumen, reqPara(grupoConServicio, { params: { fecha: FECHA } }));
  check(r6._status === 404, 'GET /dias/:fecha/resumen sin ninguna sábana cargada todavía da 404 (no revienta, no inventa nada)');

  // --- 7) con una sábana YA cargada por WhatsApp (simulando lo que deja
  // whatsappBot.js en whatsapp_dia_estado.ultimo_texto), el resumen se
  // recalcula y responde con el MISMO shape que POST /api/sabana/procesar
  // — es justamente lo que el frontend necesita para pintar "Resumen por
  // Cliente" automáticamente ---
  TABLAS.whatsapp_dia_estado.push({ grupo_id: GRUPO_ID, fecha: FECHA, ultimo_texto: 'PEDRO\nhouston -120\n100//90', ultimo_texto_en: new Date(), sabana_final_en: null, ultima_verificacion_en: null, ultimo_envio_resumen_en: null, ultimo_hash_resumen: null, cierre_enviado_en: null });
  const r7 = await invocarRuta(handlerResumen, reqPara(grupoConServicio, { params: { fecha: FECHA } }));
  check(r7._status === 200, 'GET /dias/:fecha/resumen con una sábana ya cargada responde 200');
  check(Array.isArray(r7._json.resumenPorCliente) && r7._json.resumenPorCliente.some(c => c.cliente === 'PEDRO'), 'trae resumenPorCliente con PEDRO adentro, igual que si se hubiera pegado a mano y procesado');
  check(Array.isArray(r7._json.tickets) && r7._json.tickets.length === 1, 'trae también "tickets" (mismo shape que POST /api/sabana/procesar)');
  check(r7._json.tickets[0].estado === 'PENDIENTE' || r7._json.tickets[0].estado === 'FALTA CERRAR EN SÁBANA', 'el ticket todavía sin resultado (el partido no terminó) queda en un estado abierto, no inventa un ganador/perdedor');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de routes/whatsapp.js (lado del Grupo) se cayó con una excepción:', e);
  process.exit(1);
});
