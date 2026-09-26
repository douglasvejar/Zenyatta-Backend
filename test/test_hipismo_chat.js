// =================================================================
// PRUEBA: "Chat de soporte" también desde el módulo Hipismo (26-09-2026,
// a pedido del usuario: "activa el modulo de mensajes, asi como lo tiene
// el modulo de deportes para el modulo de hipismo... el que tenga los
// dos modulos activos es la misma bandeja de mensaje este en el modulo
// en que este"). routes/hipismo.js ahora expone GET/POST /chat, GET
// /chat/conteo-no-leidos y POST /chat/marcar-leidos — wrappers finitos
// sobre services/chat.js, la MISMA tabla mensajes_chat (por grupo_id,
// nunca por módulo) que ya usa routes/sabana.js para Deportes. Esta
// prueba no repite lo que ya cubre test_chat_conversaciones.js (el lado
// del Súper-admin, que ya es 100% agnóstico de módulo) — verifica que el
// LADO DEL GRUPO funciona igual desde hipismo.js, y que un mensaje
// guardado por CUALQUIERA de los 2 routers queda en la MISMA fila de
// mensajes_chat (por eso comparten bandeja).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-chat-1';
const TABLAS = {
  mensajes_chat: []
};
let seq = 1;
const nuevoId = () => 'msj' + (seq++);

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^INSERT INTO mensajes_chat \(grupo_id, remitente, texto, adjunto_datos, adjunto_tipo, adjunto_nombre\)\s+VALUES \(\$1, \$2, \$3, \$4, \$5, \$6\)\s+RETURNING id, grupo_id, remitente, texto, adjunto_datos, adjunto_tipo, adjunto_nombre, creado_en/i.test(sql)) {
    const [grupoId, remitente, texto, adjuntoDatos, adjuntoTipo, adjuntoNombre] = params;
    const fila = { id: nuevoId(), grupo_id: grupoId, remitente, texto, adjunto_datos: adjuntoDatos, adjunto_tipo: adjuntoTipo, adjunto_nombre: adjuntoNombre, creado_en: new Date().toISOString(), leido_grupo: remitente === 'grupo', leido_superadmin: remitente === 'superadmin' };
    TABLAS.mensajes_chat.push(fila);
    return { rows: [{ id: fila.id, grupo_id: fila.grupo_id, remitente: fila.remitente, texto: fila.texto, adjunto_datos: fila.adjunto_datos, adjunto_tipo: fila.adjunto_tipo, adjunto_nombre: fila.adjunto_nombre, creado_en: fila.creado_en }] };
  }
  if (/^SELECT id, remitente, texto, adjunto_datos, adjunto_tipo, adjunto_nombre, creado_en FROM mensajes_chat WHERE grupo_id = \$1 ORDER BY creado_en ASC LIMIT 500/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.mensajes_chat.filter(m => m.grupo_id === grupoId).sort((a, b) => a.creado_en < b.creado_en ? -1 : 1);
    return { rows: filas.map(m => ({ id: m.id, remitente: m.remitente, texto: m.texto, adjunto_datos: m.adjunto_datos, adjunto_tipo: m.adjunto_tipo, adjunto_nombre: m.adjunto_nombre, creado_en: m.creado_en })) };
  }
  if (/^SELECT COUNT\(\*\)::int AS total FROM mensajes_chat WHERE grupo_id = \$1 AND remitente = 'superadmin' AND leido_grupo = false/i.test(sql)) {
    const [grupoId] = params;
    const total = TABLAS.mensajes_chat.filter(m => m.grupo_id === grupoId && m.remitente === 'superadmin' && !m.leido_grupo).length;
    return { rows: [{ total }] };
  }
  if (/^UPDATE mensajes_chat SET leido_grupo = true WHERE grupo_id = \$1 AND remitente = 'superadmin' AND leido_grupo = false/i.test(sql)) {
    const [grupoId] = params;
    TABLAS.mensajes_chat.filter(m => m.grupo_id === grupoId && m.remitente === 'superadmin' && !m.leido_grupo).forEach(m => { m.leido_grupo = true; });
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

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));

Module._load = originalLoad;

function handlerDe(metodo, rutaPath) {
  const entrada = hipismoRouter.__handlers.find(([m, args]) => m === metodo && args[0] === rutaPath);
  return entrada[1][entrada[1].length - 1];
}
const handlerListar = handlerDe('get', '/chat');
const handlerEnviar = handlerDe('post', '/chat');
const handlerConteo = handlerDe('get', '/chat/conteo-no-leidos');
const handlerMarcarLeidos = handlerDe('post', '/chat/marcar-leidos');

function reqBase(grupoId) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, body: {} };
}

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    res.end = () => { resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) El grupo escribe desde Hipismo (routes/hipismo.js) ---
  const resEnviar = await invocarRuta(handlerEnviar, Object.assign(reqBase(GRUPO_ID), { body: { texto: 'Hola, tengo una duda de un remate' } }));
  check(resEnviar._status === 201, '1) POST /api/hipismo/chat guarda el mensaje (201)');
  check(TABLAS.mensajes_chat.length === 1 && TABLAS.mensajes_chat[0].remitente === 'grupo', 'Queda guardado en mensajes_chat con remitente=grupo, la MISMA tabla que usa Deportes');

  // --- 2) El Súper-admin responde directo en la tabla (simula que
  // respondió por el LADO de Deportes/Súper-admin, sin pasar por
  // hipismo.js) — para probar que hipismo.js SÍ ve ese mensaje: es la
  // misma bandeja, no una aparte. ---
  TABLAS.mensajes_chat.push({ id: nuevoId(), grupo_id: GRUPO_ID, remitente: 'superadmin', texto: 'Te leo, ¿cuál es la duda?', creado_en: new Date(Date.now() + 1000).toISOString(), leido_grupo: false, leido_superadmin: true });

  const resListar = await invocarRuta(handlerListar, reqBase(GRUPO_ID));
  check(resListar._status === 200 && resListar._json.length === 2, '2) GET /api/hipismo/chat trae los 2 mensajes (el del grupo + la respuesta del Súper-admin), aunque este último no se escribió por hipismo.js — es la MISMA bandeja');
  check(resListar._json[1].remitente === 'superadmin' && resListar._json[1].texto === 'Te leo, ¿cuál es la duda?', 'El mensaje del Súper-admin llega con su texto y remitente correctos');

  // --- 3) Conteo de no leídos (desde Hipismo) ---
  const resConteo1 = await invocarRuta(handlerConteo, reqBase(GRUPO_ID));
  check(resConteo1._json.total === 1, '3) GET /api/hipismo/chat/conteo-no-leidos: 1 mensaje del Súper-admin sin leer');

  // --- 4) Marcar leídos desde Hipismo baja el conteo a 0 ---
  await invocarRuta(handlerMarcarLeidos, reqBase(GRUPO_ID));
  const resConteo2 = await invocarRuta(handlerConteo, reqBase(GRUPO_ID));
  check(resConteo2._json.total === 0, '4) Después de POST /api/hipismo/chat/marcar-leidos, el conteo baja a 0');

  // --- 5) Otro grupo no ve estos mensajes (bandeja por grupo_id, nunca global) ---
  const resOtroGrupo = await invocarRuta(handlerListar, reqBase('otro-grupo-cualquiera'));
  check(resOtroGrupo._json.length === 0, '5) Un grupo distinto no ve los mensajes de este — cada grupo tiene su propia conversación');

  // --- 6) ADJUNTOS (26-09-2026, "puede adjuntar archivos, fotos, videos
  // e incluso mandar notas de voz") ---
  const fotoBase64 = Buffer.from('foto-de-mentira').toString('base64');
  const resFoto = await invocarRuta(handlerEnviar, Object.assign(reqBase(GRUPO_ID), { body: { texto: '', adjunto: { datos: fotoBase64, tipo: 'image/jpeg', nombre: 'ticket.jpg' } } }));
  check(resFoto._status === 201, '6) Se puede mandar SOLO una foto, sin texto (201)');
  check(resFoto._json.adjunto_tipo === 'image/jpeg' && resFoto._json.adjunto_nombre === 'ticket.jpg', 'La foto queda guardada con su mime type y nombre de archivo');
  check(resFoto._json.texto === '', 'El texto queda vacío (\'\'), nunca null, cuando el mensaje es solo la foto');

  const notaVozBase64 = Buffer.from('audio-de-mentira').toString('base64');
  const resNotaVoz = await invocarRuta(handlerEnviar, Object.assign(reqBase(GRUPO_ID), { body: { texto: '', adjunto: { datos: notaVozBase64, tipo: 'audio/webm', nombre: 'nota-de-voz.webm' } } }));
  check(resNotaVoz._status === 201 && resNotaVoz._json.adjunto_tipo === 'audio/webm', '6b) También se puede mandar una nota de voz (audio/webm)');

  const videoBase64 = Buffer.from('video-de-mentira').toString('base64');
  const resVideoConTexto = await invocarRuta(handlerEnviar, Object.assign(reqBase(GRUPO_ID), { body: { texto: 'Mira esto', adjunto: { datos: videoBase64, tipo: 'video/mp4', nombre: 'jugada.mp4' } } }));
  check(resVideoConTexto._status === 201 && resVideoConTexto._json.texto === 'Mira esto' && resVideoConTexto._json.adjunto_tipo === 'video/mp4', '6c) Un video puede ir ACOMPAÑADO de texto en el mismo mensaje');

  const pdfBase64 = Buffer.from('pdf-de-mentira').toString('base64');
  const resPdf = await invocarRuta(handlerEnviar, Object.assign(reqBase(GRUPO_ID), { body: { texto: '', adjunto: { datos: pdfBase64, tipo: 'application/pdf', nombre: 'comprobante.pdf' } } }));
  check(resPdf._status === 201 && resPdf._json.adjunto_tipo === 'application/pdf', '6d) También se aceptan "archivos" comunes (ej. PDF)');

  const resTipoInvalido = await invocarRuta(handlerEnviar, Object.assign(reqBase(GRUPO_ID), { body: { texto: '', adjunto: { datos: fotoBase64, tipo: 'application/x-msdownload', nombre: 'raro.exe' } } }));
  check(resTipoInvalido._status === 400, '6e) Un tipo de archivo no permitido (ej. un .exe) responde 400, no se guarda');

  const resVacio = await invocarRuta(handlerEnviar, Object.assign(reqBase(GRUPO_ID), { body: { texto: '' } }));
  check(resVacio._status === 400, '6f) Sin texto Y sin adjunto sigue respondiendo 400, como antes');

  const adjuntoMuyPesado = { datos: 'A'.repeat(12 * 1024 * 1024), tipo: 'image/png', nombre: 'gigante.png' };
  const resPesado = await invocarRuta(handlerEnviar, Object.assign(reqBase(GRUPO_ID), { body: { texto: '', adjunto: adjuntoMuyPesado } }));
  check(resPesado._status === 400, '6g) Un adjunto más pesado que el tope (~8MB reales) responde 400');

  const resListarConAdjuntos = await invocarRuta(handlerListar, reqBase(GRUPO_ID));
  check(resListarConAdjuntos._json.filter(m => m.adjunto_tipo).length === 4, '6h) GET /api/hipismo/chat trae los 4 mensajes con adjunto guardados (foto, nota de voz, video+texto, pdf) — ninguno de los rechazados');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
