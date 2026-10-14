// =================================================================
// PRUEBA: puente del chat de soporte con Telegram (14-10-2026).
//  - Un Grupo escribe en su bandeja -> llega al chat de avisos del dueño con el nombre del grupo.
//  - El dueño responde (reply) en Telegram -> queda como mensaje del 'superadmin' en el hilo de ESE grupo.
// Base de datos y cliente de Telegram falsos, sin red.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPOS = [
  { id: 'g1', nombre: 'Zenyatta', activo: true },
  { id: 'g2', nombre: 'Deportes Bernal', activo: true }
];
const MENSAJES = [];
function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT nombre FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = GRUPOS.find(x => x.id === params[0]);
    return { rows: g ? [{ nombre: g.nombre }] : [] };
  }
  if (/^SELECT id, nombre FROM grupos WHERE activo = true/i.test(sql)) return { rows: GRUPOS.filter(g => g.activo).map(g => ({ id: g.id, nombre: g.nombre })) };
  if (/^INSERT INTO mensajes_chat/i.test(sql)) {
    const [grupoId, remitente, texto, datos, tipo, nombre] = params;
    const fila = { id: 'm' + (MENSAJES.length + 1), grupo_id: grupoId, remitente, texto, tiene_adjunto: !!datos, adjunto_tipo: tipo, adjunto_nombre: nombre, leido_superadmin: false };
    MENSAJES.push(fila);
    return { rows: [fila] };
  }
  if (/^UPDATE mensajes_chat SET leido_superadmin = true/i.test(sql)) {
    MENSAJES.forEach(m => { if (m.grupo_id === params[0] && m.remitente === 'grupo') m.leido_superadmin = true; });
    return { rows: [] };
  }
  throw new Error('BD falsa: no sé responder ' + sql);
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
Module._load = function (request) { if (request === 'pg') return { Pool: fakePool }; return originalLoad.apply(this, arguments); };
process.env.DATABASE_URL = 'postgresql://fake/fake';
const telegramBot = require(path.join(__dirname, '..', 'src', 'services', 'telegramBot'));
const chatService = require(path.join(__dirname, '..', 'src', 'services', 'chat'));
Module._load = originalLoad;

let ok = 0, mal = 0;
function check(c, m) { if (c) { ok++; console.log('OK:', m); } else { mal++; console.error('FALLÓ:', m); } }
const espera = ms => new Promise(r => setTimeout(r, ms));

const DUENO_CHAT = 777000;
function crearApi(admins) {
  const enviados = []; let nextId = 100;
  return {
    enviados,
    enviarTexto: async (chatId, texto) => { const m = { message_id: nextId++ }; enviados.push({ chatId: String(chatId), texto, message_id: m.message_id }); return [m]; },
    esAdministrador: async (chatId, userId) => (admins || []).includes(userId)
  };
}
const DUENO = { id: DUENO_CHAT, first_name: 'Dueño', is_bot: false };
let uid = 1;
function respuesta({ chat = DUENO_CHAT, tipo = 'private', from = DUENO, citadoId, citadoTexto, texto }) {
  return { update_id: uid++, message: { message_id: 500 + uid, chat: { id: chat, type: tipo }, from, text: texto,
    reply_to_message: { message_id: citadoId, from: { is_bot: true }, text: citadoTexto } } };
}

(async () => {
  process.env.TELEGRAM_AVISOS_CHAT_ID = String(DUENO_CHAT);
  delete process.env.TELEGRAM_CENTRAL_CHAT_ID;
  const api = crearApi([]);
  const ctx = telegramBot._usarCliente(api);
  chatService.registrarNotificadorMensajes(telegramBot.avisarMensajeDeGrupo);

  // 1) Grupo -> Telegram
  await chatService.enviarMensaje('g1', 'grupo', 'Hola, ¿pueden revisar el plano de la 5ta?');
  await espera(30);
  check(api.enviados.length === 1 && api.enviados[0].chatId === String(DUENO_CHAT), '1a) el mensaje del grupo llega al chat de avisos del dueño');
  const aviso = api.enviados[0];
  check(/💬 MENSAJE — ZENYATTA/.test(aviso.texto) && /plano de la 5ta/.test(aviso.texto), '1b) trae el nombre del grupo en mayúsculas y el texto');
  check(/Responde a este mensaje/.test(aviso.texto), '1c) explica cómo responder');
  // un mensaje del superadmin NO se avisa de vuelta
  await chatService.enviarMensaje('g1', 'superadmin', 'ya lo reviso');
  await espera(30);
  check(api.enviados.length === 1, '1d) lo que escribe el Súper-admin no genera aviso');
  // adjunto
  await chatService.enviarMensaje('g2', 'grupo', '', { datos: 'AAAA', tipo: 'image/png', nombre: 'captura.png' });
  await espera(30);
  check(api.enviados.length === 2 && /una foto/.test(api.enviados[1].texto) && /DEPORTES BERNAL/.test(api.enviados[1].texto), '1e) un adjunto sin texto avisa "Adjuntó una foto" con el grupo');

  // 2) Telegram -> grupo (por memoria del mensaje)
  await telegramBot.manejarActualizacion(respuesta({ citadoId: aviso.message_id, citadoTexto: '💬 MENSAJE — ZENYATTA\nHola', texto: 'Listo, ya está corregido' }), ctx);
  const resp = MENSAJES.filter(m => m.remitente === 'superadmin' && m.texto === 'Listo, ya está corregido');
  check(resp.length === 1 && resp[0].grupo_id === 'g1', '2a) la respuesta queda como mensaje del superadmin en el hilo de Zenyatta');
  check(api.enviados[api.enviados.length - 1].texto.includes('Enviado a *ZENYATTA*'), '2b) Telegram confirma a qué grupo se envió');
  const leidos = MENSAJES.filter(m => m.grupo_id === 'g1' && m.remitente === 'grupo').every(m => m.leido_superadmin);
  check(leidos, '2c) al responder, los mensajes de ese grupo quedan leídos');

  // 3) Tras un reinicio (sin memoria) se reconoce por el nombre de la primera línea
  const api2 = crearApi([]);
  const ctx2 = telegramBot._usarCliente(api2);
  await telegramBot.manejarActualizacion(respuesta({ citadoId: 9999, citadoTexto: '💬 MENSAJE — DEPORTES BERNAL\nfoto', texto: 'Recibido, gracias' }), ctx2);
  const r3 = MENSAJES.filter(m => m.remitente === 'superadmin' && m.texto === 'Recibido, gracias');
  check(r3.length === 1 && r3[0].grupo_id === 'g2', '3) sin memoria, el grupo se identifica por el nombre del encabezado');

  // 4) Seguridad
  const antes = MENSAJES.length;
  await telegramBot.manejarActualizacion(respuesta({ chat: -100555, tipo: 'supergroup', from: { id: 5, is_bot: false }, citadoId: aviso.message_id, citadoTexto: '💬 MENSAJE — ZENYATTA\nHola', texto: 'intruso' }), ctx2);
  check(MENSAJES.length === antes, '4a) alguien en otro chat NO puede responder a un grupo');
  await telegramBot.manejarActualizacion(respuesta({ chat: 123, tipo: 'private', from: { id: 123, is_bot: false }, citadoId: 1, citadoTexto: '💬 MENSAJE — ZENYATTA\nHola', texto: 'otro privado' }), ctx2);
  check(MENSAJES.length === antes, '4b) un chat privado que no es el del dueño tampoco');
  await telegramBot.manejarActualizacion(respuesta({ citadoId: 1, citadoTexto: 'otro mensaje cualquiera del bot', texto: 'hola' }), ctx2);
  check(MENSAJES.length === antes, '4c) responder a un mensaje del bot que no es del chat de soporte no hace nada');
  await telegramBot.manejarActualizacion(respuesta({ citadoId: 1, citadoTexto: '💬 MENSAJE — NO EXISTE\nx', texto: 'a quien' }), ctx2);
  check(MENSAJES.length === antes && /No encontré el grupo/.test(api2.enviados[api2.enviados.length - 1].texto), '4d) grupo desconocido: avisa y no envía');

  // 5) Grupo central: solo administradores
  process.env.TELEGRAM_CENTRAL_CHAT_ID = '-100999';
  delete process.env.TELEGRAM_AVISOS_CHAT_ID;
  const api3 = crearApi([42]);
  const ctx3 = telegramBot._usarCliente(api3);
  await telegramBot.manejarActualizacion(respuesta({ chat: -100999, tipo: 'supergroup', from: { id: 42, is_bot: false }, citadoId: 1, citadoTexto: '💬 MENSAJE — ZENYATTA\nHola', texto: 'desde el central' }), ctx3);
  check(MENSAJES.some(m => m.remitente === 'superadmin' && m.texto === 'desde el central' && m.grupo_id === 'g1'), '5a) un administrador del grupo central puede responder');
  const n = MENSAJES.length;
  await telegramBot.manejarActualizacion(respuesta({ chat: -100999, tipo: 'supergroup', from: { id: 43, is_bot: false }, citadoId: 1, citadoTexto: '💬 MENSAJE — ZENYATTA\nHola', texto: 'no soy admin' }), ctx3);
  check(MENSAJES.length === n, '5b) quien no es administrador del central no puede');
  // el aviso también va al central si no hay chat privado configurado
  chatService.registrarNotificadorMensajes(telegramBot.avisarMensajeDeGrupo);
  await chatService.enviarMensaje('g2', 'grupo', 'Buenas');
  await espera(30);
  check(api3.enviados.some(e => e.chatId === '-100999' && /DEPORTES BERNAL/.test(e.texto)), '5c) sin chat privado, el aviso sale en el grupo central');

  // 6) Sin destino configurado no pasa nada (ni se rompe el envío del mensaje)
  delete process.env.TELEGRAM_CENTRAL_CHAT_ID;
  const m = await chatService.enviarMensaje('g1', 'grupo', 'sin destino');
  await espera(30);
  check(m && m.texto === 'sin destino', '6) sin destino de avisos configurado, el mensaje se guarda igual');

  console.log(`\n${ok} pruebas OK, ${mal} fallaron.`);
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error('Error en la prueba:', e); process.exit(1); });
