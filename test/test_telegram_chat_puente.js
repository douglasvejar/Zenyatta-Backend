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
let SIN_COLUMNA_TEMA = false;
function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT nombre FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = GRUPOS.find(x => x.id === params[0]);
    return { rows: g ? [{ nombre: g.nombre }] : [] };
  }
  if (/telegram_soporte_tema_id/i.test(sql) && SIN_COLUMNA_TEMA) { const e = new Error('column "telegram_soporte_tema_id" does not exist'); e.code = '42703'; throw e; }
  if (/^SELECT telegram_soporte_tema_id FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = GRUPOS.find(x => x.id === params[0]);
    return { rows: g ? [{ telegram_soporte_tema_id: g.tema || null }] : [] };
  }
  if (/^UPDATE grupos SET telegram_soporte_tema_id = \$1 WHERE id = \$2/i.test(sql)) {
    const g = GRUPOS.find(x => x.id === params[1]); if (g) g.tema = params[0]; return { rows: [] };
  }
  if (/^UPDATE grupos SET telegram_soporte_tema_id = NULL WHERE id = \$1/i.test(sql)) {
    const g = GRUPOS.find(x => x.id === params[0]); if (g) g.tema = null; return { rows: [] };
  }
  if (/^SELECT id, nombre FROM grupos WHERE telegram_soporte_tema_id = \$1/i.test(sql)) {
    return { rows: GRUPOS.filter(g => Number(g.tema) === Number(params[0])).map(g => ({ id: g.id, nombre: g.nombre })) };
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
  // el aviso NUNCA va al grupo central (ahí están las sábanas), aunque no haya chat privado configurado
  chatService.registrarNotificadorMensajes(telegramBot.avisarMensajeDeGrupo);
  await chatService.enviarMensaje('g2', 'grupo', 'Buenas');
  await espera(30);
  check(!api3.enviados.some(e => e.chatId === '-100999' && /DEPORTES BERNAL/.test(e.texto)) && api3.enviados.every(e => !/💬 MENSAJE/.test(e.texto)), '5c) con solo el grupo central configurado, el mensaje de un grupo NO se manda al central');

  // 6) Sin destino configurado no pasa nada (ni se rompe el envío del mensaje)
  delete process.env.TELEGRAM_CENTRAL_CHAT_ID;
  const m = await chatService.enviarMensaje('g1', 'grupo', 'sin destino');
  await espera(30);
  check(m && m.texto === 'sin destino', '6) sin destino de avisos configurado, el mensaje se guarda igual');

  // ===== UN CHAT POR GRUPO (temas de un grupo de soporte) =====
  delete process.env.TELEGRAM_CENTRAL_CHAT_ID;
  delete process.env.TELEGRAM_AVISOS_CHAT_ID;
  process.env.TELEGRAM_SOPORTE_CHAT_ID = '-100777';
  let siguienteTema = 10; const enviadosT = []; let temaCaido = null;
  const apiT = {
    enviarTexto: async (chatId, texto, op = {}) => {
      if (temaCaido && op.threadId === temaCaido) throw new Error('Bad Request: message thread not found');
      enviadosT.push({ chatId: String(chatId), texto, tema: op.threadId }); return [{ message_id: enviadosT.length }];
    },
    crearTemaForo: async (chatId, nombre) => { const id = siguienteTema++; apiT.temasCreados.push({ chatId: String(chatId), nombre, id }); return { message_thread_id: id }; },
    temasCreados: [],
    esAdministrador: async (c, u) => u === 42
  };
  const ctxT = telegramBot._usarCliente(apiT);
  await chatService.enviarMensaje('g1', 'grupo', 'Primer mensaje de Zenyatta');
  await espera(30);
  check(apiT.temasCreados.length === 1 && apiT.temasCreados[0].nombre === 'Zenyatta' && apiT.temasCreados[0].chatId === '-100777', '7a) el primer mensaje de un grupo crea SU tema con el nombre del grupo');
  const tz = apiT.temasCreados[0].id;
  check(enviadosT.length === 2 && enviadosT.every(e => e.tema === tz) && /Este es el chat de \*?ZENYATTA/.test(enviadosT[0].texto) && /Primer mensaje/.test(enviadosT[1].texto), '7b) manda una presentación y el mensaje dentro de ese tema');
  check(GRUPOS[0].tema === tz, '7c) guarda el número del tema en el grupo');
  await chatService.enviarMensaje('g1', 'grupo', 'Segundo mensaje');
  await espera(30);
  check(apiT.temasCreados.length === 1 && enviadosT[enviadosT.length - 1].tema === tz, '7d) el segundo mensaje usa el MISMO tema (no crea otro)');
  await chatService.enviarMensaje('g2', 'grupo', 'Hola desde Bernal');
  await espera(30);
  check(apiT.temasCreados.length === 2 && apiT.temasCreados[1].nombre === 'Deportes Bernal' && enviadosT[enviadosT.length - 1].tema === apiT.temasCreados[1].id, '7e) otro grupo recibe SU propio tema');
  // 2 mensajes casi juntos de un grupo nuevo no crean 2 temas
  GRUPOS.push({ id: 'g3', nombre: 'Nuevo', activo: true });
  await Promise.all([chatService.enviarMensaje('g3', 'grupo', 'a'), chatService.enviarMensaje('g3', 'grupo', 'b')]);
  await espera(60);
  check(apiT.temasCreados.filter(t => t.nombre === 'Nuevo').length === 1, '7f) dos mensajes seguidos de un grupo nuevo crean un solo tema');

  // 8) Escribir dentro del tema responde a ESE grupo (sin usar Responder)
  const enTema = (tema, texto, from = { id: 42, is_bot: false }) => ({ update_id: uid++, message: { message_id: 900 + uid, chat: { id: -100777, type: 'supergroup' }, from, text: texto, message_thread_id: tema, is_topic_message: true } });
  await telegramBot.manejarActualizacion(enTema(tz, 'Respondo desde el tema'), ctxT);
  const rt = MENSAJES.filter(m => m.remitente === 'superadmin' && m.texto === 'Respondo desde el tema');
  check(rt.length === 1 && rt[0].grupo_id === 'g1', '8a) lo escrito en el tema de Zenyatta llega a la bandeja de Zenyatta');
  check(enviadosT[enviadosT.length - 1].texto === '✅ Enviado' && enviadosT[enviadosT.length - 1].tema === tz, '8b) confirma "✅ Enviado" dentro del mismo tema');
  const nB = MENSAJES.length;
  await telegramBot.manejarActualizacion(enTema(tz, 'intruso', { id: 99, is_bot: false }), ctxT);
  check(MENSAJES.length === nB, '8c) quien no es administrador del grupo de soporte no puede');
  await telegramBot.manejarActualizacion(enTema(tz, '/id'), ctxT);
  check(MENSAJES.length === nB, '8d) un comando con "/" dentro del tema no se manda al grupo');
  await telegramBot.manejarActualizacion(enTema(9999, 'tema ajeno'), ctxT);
  check(MENSAJES.length === nB, '8e) un tema que no es de ningún grupo se ignora');
  // sin memoria (reinicio): el tema se reconoce por la base
  const ctxT2 = telegramBot._usarCliente(apiT);
  await telegramBot.manejarActualizacion(enTema(apiT.temasCreados[1].id, 'Bernal, ya te contesto'), ctxT2);
  check(MENSAJES.some(m => m.remitente === 'superadmin' && m.texto === 'Bernal, ya te contesto' && m.grupo_id === 'g2'), '8f) el tema de otro grupo responde a ESE grupo');

  // 9) Si borraron el tema en Telegram, se crea de nuevo y se reenvía
  temaCaido = tz;
  await chatService.enviarMensaje('g1', 'grupo', 'Mensaje con tema borrado');
  await espera(60);
  const nuevoTz = GRUPOS[0].tema;
  check(nuevoTz !== tz && enviadosT.some(e => e.tema === nuevoTz && /Mensaje con tema borrado/.test(e.texto)), '9) con el tema borrado se crea otro y el mensaje no se pierde');

  // 10) Sin la columna en la base: igual funciona (en memoria)
  SIN_COLUMNA_TEMA = true;
  GRUPOS.push({ id: 'g4', nombre: 'SinColumna', activo: true });
  await chatService.enviarMensaje('g4', 'grupo', 'sin columna');
  await espera(40);
  check(apiT.temasCreados.some(t => t.nombre === 'SinColumna') && enviadosT.some(e => /sin columna/.test(e.texto)), '10a) sin la columna en la base, el mensaje igual sale en un tema');
  const t4 = apiT.temasCreados.find(t => t.nombre === 'SinColumna').id;
  await telegramBot.manejarActualizacion(enTema(t4, 'respuesta sin columna'), ctxT);
  check(MENSAJES.some(m => m.remitente === 'superadmin' && m.texto === 'respuesta sin columna' && m.grupo_id === 'g4'), '10b) y se le puede responder (memoria)');
  SIN_COLUMNA_TEMA = false;
  // 11) Si el grupo de soporte no sirve (sin Temas), el mensaje sale en el chat de avisos
  process.env.TELEGRAM_AVISOS_CHAT_ID = String(DUENO_CHAT);
  const enviadosF = [];
  const apiF = { enviarTexto: async (c, t, op = {}) => { enviadosF.push({ c: String(c), t, tema: op.threadId }); return [{ message_id: enviadosF.length }]; },
    crearTemaForo: async () => { throw new Error('Bad Request: the chat is not a forum'); }, esAdministrador: async () => true };
  telegramBot._usarCliente(apiF);
  GRUPOS.push({ id: 'g5', nombre: 'SinForo', activo: true });
  await chatService.enviarMensaje('g5', 'grupo', 'mensaje con foro caído');
  await espera(40);
  check(enviadosF.length === 1 && enviadosF[0].c === String(DUENO_CHAT) && /SINFORO/.test(enviadosF[0].t), '11) si no se puede crear el tema, el mensaje igual llega al chat de avisos');
  delete process.env.TELEGRAM_SOPORTE_CHAT_ID;

  console.log(`\n${ok} pruebas OK, ${mal} fallaron.`);
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error('Error en la prueba:', e); process.exit(1); });
