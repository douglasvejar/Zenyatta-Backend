// =================================================================
// PRUEBA: bot de Telegram (08-10-2026) — capa de API (formato/partir/fetch
// falso) + integración completa con el motor de sábanas de WhatsApp, usando
// un cliente de Telegram falso en memoria (no hay salida a api.telegram.org).
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g1';
const JID = '120363000000000009@g.us';
const CHAT = -1001234567890;

let siguienteIdPendiente = 1;
const TABLAS = {
  grupos: [{ id: GRUPO_ID, nombre: 'Deportes Bernal', activo: true, whatsapp_grupo_jid: JID, whatsapp_habilitado: false, telegram_habilitado: true, telegram_chat_id: String(CHAT), telegram_codigo_vinculo: null, modelo_comision: 'plano', comision_tiers: [], comandos_whatsapp_habilitado: true, comandos_whatsapp_numero: JID.replace('@g.us', '') }],
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', activo: true, comision_propia: 0 },
    { id: 'j-bernal', grupo_id: GRUPO_ID, nombre: 'BERNAL', activo: true, comision_propia: 0 },
    { id: 'j-lopez', grupo_id: GRUPO_ID, nombre: 'LOPEZ', activo: true, comision_propia: 10 },
    { id: 'j-carlos', grupo_id: GRUPO_ID, nombre: 'CARLOS', activo: true, comision_propia: 0 }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  tickets_historial: [],
  polla_historial: [],
  transferencias: [],
  sabanas_pendientes_whatsapp: [],
  whatsapp_dia_estado: [],
  dias_confirmados: []
};

// --- fetch falso, con el partido controlable a mano (mismo patrón que
// test_whatsapp_bot_flujo.js) ---
let partidoFinal = false;
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    if (!partidoFinal) return Promise.resolve({ json: async () => ({ dates: [{ games: [] }] }) });
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: { home: { team: { name: 'Houston Astros' }, score: 5 }, away: { team: { name: 'Texas Rangers' }, score: 1 } },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: new Date().toISOString().split('T')[0] + 'T23:00:00Z',
            gamePk: 1
          }]
        }]
      })
    });
  }
  if (url.includes('/football/nfl/') || url.includes('/hockey/nhl/') || url.includes('/basketball/nba/') || url.includes('/soccer/')) {
    return Promise.resolve({ json: async () => ({ events: [] }) });
  }
  return Promise.reject(new Error('URL inesperada en la prueba: ' + url));
}
global.fetch = fakeFetch;

function enRango(fila, desde, hasta) {
  return (!desde || fila.fecha >= desde) && (!hasta || fila.fecha <= hasta);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  // --- cargarConfigGrupo() / procesarSabana() ---
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: fila ? [{ modelo_comision: fila.modelo_comision, comision_tiers: fila.comision_tiers }] : [] };
  }
  if (/^SELECT comandos_whatsapp_habilitado, comandos_whatsapp_numero FROM grupos WHERE id = \$1/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: fila ? [{ comandos_whatsapp_habilitado: !!fila.comandos_whatsapp_habilitado, comandos_whatsapp_numero: fila.comandos_whatsapp_numero || null }] : [] };
  }
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };

  // --- tickets_historial: guardarEnHistorial()/leerHistorial() ---
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && t.fecha === fecha);
    return { rows: filas.map(t => ({ cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado })) };
  }
  if (/^DELETE FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.tickets_historial = TABLAS.tickets_historial.filter(t => !(t.grupo_id === grupoId && t.fecha === fecha));
    return { rows: [] };
  }
  if (/^INSERT INTO tickets_historial \(grupo_id, fecha, cliente_nombre, jugador_id, ticket_label, detalle, arriesga, gana, estado, logros\)/i.test(sql)) {
    const [grupoId, fecha, clienteNombre, jugadorId, ticketLabel, detalle, arriesga, gana, estado, logros] = params;
    TABLAS.tickets_historial.push({ id: 't' + (TABLAS.tickets_historial.length + 1), grupo_id: grupoId, fecha, cliente_nombre: clienteNombre, jugador_id: jugadorId, ticket_label: ticketLabel, detalle, arriesga, gana, estado, logros });
    return { rows: [] };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ id: t.id, fecha: t.fecha, cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado, logros: t.logros })) };
  }

  // --- polla/transferencias (calcularBalanceGeneral) ---
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) return { rows: [] };

  // --- dias_confirmados: confirmarDia()/desconfirmarDia() ---
  if (/^DELETE FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.dias_confirmados = TABLAS.dias_confirmados.filter(d => !(d.grupo_id === grupoId && d.fecha === fecha));
    return { rows: [] };
  }
  if (/^INSERT INTO dias_confirmados \(grupo_id, fecha\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    let fila = TABLAS.dias_confirmados.find(d => d.grupo_id === grupoId && d.fecha === fecha);
    if (!fila) { fila = { grupo_id: grupoId, fecha, confirmado_en: new Date() }; TABLAS.dias_confirmados.push(fila); }
    else { fila.confirmado_en = new Date(); }
    return { rows: [{ confirmado_en: fila.confirmado_en }] };
  }
  if (/^SELECT confirmado_en FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.dias_confirmados.find(d => d.grupo_id === grupoId && d.fecha === fecha);
    return { rows: fila ? [{ confirmado_en: fila.confirmado_en }] : [] };
  }

  // --- obtenerNombreGrupo / grupoIdPorJid ---
  if (/^SELECT nombre FROM grupos WHERE id = \$1/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: fila ? [{ nombre: fila.nombre }] : [] };
  }
  if (/^SELECT id FROM grupos WHERE whatsapp_grupo_jid = \$1 AND whatsapp_habilitado = true/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.whatsapp_grupo_jid === params[0] && g.whatsapp_habilitado === true);
    return { rows: fila ? [{ id: fila.id }] : [] };
  }

  // --- sabanasPendientesWhatsapp.js ---
  if (/^INSERT INTO sabanas_pendientes_whatsapp/i.test(sql)) {
    const [grupoId, fechaDetectada, texto, remitente, remitenteNombre] = params;
    const idNum = siguienteIdPendiente++;
    const fila = { id: 'p' + idNum, grupo_id: grupoId, fecha_detectada: fechaDetectada, texto, remitente, remitente_nombre: remitenteNombre, recibido_en: new Date(Date.now() + idNum * 1000), estado: 'pendiente', nota: null, procesado_en: null };
    TABLAS.sabanas_pendientes_whatsapp.push(fila);
    return { rows: [fila] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'importada'/i.test(sql)) {
    const [grupoId, id] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id);
    if (fila) { fila.estado = 'importada'; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'descartada'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id);
    if (fila) { fila.estado = 'descartada'; fila.nota = nota || null; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'error'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id);
    if (fila) { fila.estado = 'error'; fila.nota = nota || null; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }

  // --- whatsappDiaEstado.js ---
  if (/^SELECT .* FROM whatsapp_dia_estado WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    return { rows: fila ? [fila] : [] };
  }
  function filaVaciaDia(grupoId, fecha) {
    return { grupo_id: grupoId, fecha, ultimo_texto: null, ultimo_texto_en: null, sabana_final_en: null, ultima_verificacion_en: null, ultimo_envio_resumen_en: null, ultimo_hash_resumen: null, cierre_enviado_en: null };
  }
  if (/^INSERT INTO whatsapp_dia_estado \(grupo_id, fecha, ultimo_texto, ultimo_texto_en\)/i.test(sql)) {
    const [grupoId, fecha, texto] = params;
    let fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (!fila) { fila = filaVaciaDia(grupoId, fecha); TABLAS.whatsapp_dia_estado.push(fila); }
    fila.ultimo_texto = texto;
    fila.ultimo_texto_en = new Date();
    return { rows: [fila] };
  }
  if (/^UPDATE whatsapp_dia_estado SET ultima_verificacion_en = now\(\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (fila) fila.ultima_verificacion_en = new Date();
    return { rows: [] };
  }
  if (/^UPDATE whatsapp_dia_estado SET ultimo_envio_resumen_en = now\(\), ultimo_hash_resumen = \$3/i.test(sql)) {
    const [grupoId, fecha, hash] = params;
    const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (fila) { fila.ultimo_envio_resumen_en = new Date(); fila.ultimo_hash_resumen = hash; }
    return { rows: [] };
  }


  // --- Telegram ---
  if (/^SELECT id FROM grupos WHERE telegram_chat_id = \$1 AND telegram_habilitado = true/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.telegram_chat_id === params[0] && g.telegram_habilitado === true);
    return { rows: fila ? [{ id: fila.id }] : [] };
  }
  if (/^SELECT id, nombre FROM grupos WHERE telegram_codigo_vinculo = \$1 AND telegram_habilitado = true/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.telegram_codigo_vinculo === params[0] && g.telegram_habilitado === true);
    return { rows: fila ? [{ id: fila.id, nombre: fila.nombre }] : [] };
  }
  if (/^UPDATE grupos SET telegram_chat_id = NULL WHERE telegram_chat_id = \$1 AND id <> \$2/i.test(sql)) {
    TABLAS.grupos.forEach(g => { if (g.telegram_chat_id === params[0] && g.id !== params[1]) g.telegram_chat_id = null; });
    return { rows: [] };
  }
  if (/^UPDATE grupos SET telegram_chat_id = \$1, telegram_codigo_vinculo = NULL WHERE id = \$2/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.id === params[1]);
    if (fila) { fila.telegram_chat_id = params[0]; fila.telegram_codigo_vinculo = null; }
    return { rows: [] };
  }
  if (/^UPDATE grupos SET telegram_chat_id = \$1 WHERE telegram_chat_id = \$2/i.test(sql)) {
    TABLAS.grupos.forEach(g => { if (g.telegram_chat_id === params[1]) g.telegram_chat_id = params[0]; });
    return { rows: [] };
  }
  if (/^SELECT id, nombre, telegram_chat_id FROM grupos WHERE telegram_habilitado = true AND activo = true/i.test(sql)) {
    return { rows: TABLAS.grupos.filter(g => g.telegram_habilitado && g.activo).map(g => ({ id: g.id, nombre: g.nombre, telegram_chat_id: g.telegram_chat_id || null })) };
  }
  if (/^SELECT id, nombre FROM grupos WHERE telegram_habilitado = true AND activo = true/i.test(sql)) {
    return { rows: TABLAS.grupos.filter(g => g.telegram_habilitado && g.activo).map(g => ({ id: g.id, nombre: g.nombre })) };
  }
  if (/^SELECT id FROM grupos WHERE id = \$1 AND telegram_habilitado = true/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.id === params[0] && g.telegram_habilitado === true);
    return { rows: fila ? [{ id: fila.id }] : [] };
  }

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';


const whatsappBot = require(path.join(__dirname, '..', 'src', 'services', 'whatsappBot'));

const telegramApi = require(path.join(__dirname, '..', 'src', 'services', 'telegramApi'));
const telegramBot = require(path.join(__dirname, '..', 'src', 'services', 'telegramBot'));
const { formatearFechaISO } = require(path.join(__dirname, '..', 'src', 'services', 'historial'));
const whatsappDiaEstado = require(path.join(__dirname, '..', 'src', 'services', 'whatsappDiaEstado'));
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function crearApiFalsa(admins) {
  const enviados = [];
  return {
    enviados,
    enviarTexto: async (chatId, texto) => { enviados.push({ chatId: String(chatId), texto }); },
    esAdministrador: async (chatId, userId) => (admins || []).includes(userId)
  };
}
const ADMIN = { id: 111, first_name: 'Dueño', is_bot: false };
const CLIENTE = { id: 222, first_name: 'Cliente', is_bot: false };
let updateId = 1;
const upd = (texto, { chat = CHAT, from = CLIENTE, tipo = 'supergroup', editado = false } = {}) =>
  ({ update_id: updateId++, [editado ? 'edited_message' : 'message']: { message_id: updateId, chat: { id: chat, type: tipo }, from, text: texto } });
const espera = ms => new Promise(r => setTimeout(r, ms));

(async function main() {
  // ===== 1) Capa de API: formato, partir, fetch falso =====
  check(telegramApi.formatearParaTelegram('*Hola* _mundo_ a<b & c') === '<b>Hola</b> <i>mundo</i> a&lt;b &amp; c', 'formato WhatsApp -> HTML de Telegram (negrita, cursiva, escapa < y &)');
  check(telegramApi.formatearParaTelegram('mi_nombre_largo') === 'mi_nombre_largo', 'los guiones bajos dentro de una palabra no se vuelven cursiva');
  const largo = Array.from({ length: 1000 }, (_, i) => 'linea ' + i).join('\n');
  const trozos = telegramApi.partirTexto(largo);
  check(trozos.length > 1 && trozos.every(t => t.length <= 3900) && trozos.join('\n') === largo, 'un texto largo se parte por líneas en trozos que entran en Telegram, sin perder nada');

  const llamadas = [];
  const fetchFalso = async (url, op) => {
    const metodo = url.split('/').pop();
    const params = JSON.parse(op.body);
    llamadas.push({ metodo, params });
    if (metodo === 'sendMessage' && params.parse_mode === 'HTML' && /MALO/.test(params.text)) return { json: async () => ({ ok: false, description: "Bad Request: can't parse entities" }) };
    if (metodo === 'getChatMember') return { json: async () => ({ ok: true, result: { status: params.user_id === 1 ? 'administrator' : 'member' } }) };
    return { json: async () => ({ ok: true, result: { username: 'bot_prueba' } }) };
  };
  const cli = telegramApi.crearClienteTelegram({ token: 'T', fetchImpl: fetchFalso });
  await cli.enviarTexto(-100, '*Plano*');
  check(llamadas[0].metodo === 'sendMessage' && llamadas[0].params.parse_mode === 'HTML' && llamadas[0].params.text === '<b>Plano</b>', 'enviarTexto manda sendMessage en HTML con el formato convertido');
  llamadas.length = 0;
  await cli.enviarTexto(-100, 'texto MALO');
  check(llamadas.length === 2 && llamadas[1].params.parse_mode === undefined, 'si Telegram rechaza el HTML, reintenta en texto plano (el aviso no se pierde)');
  check(await cli.esAdministrador(-100, 1) === true && await cli.esAdministrador(-100, 2) === false, 'esAdministrador distingue admin de miembro');
  check(await cli.esAdministrador(555, 2) === true, 'en un chat privado siempre se considera al propio usuario');

  // ===== 2) /id y /start =====
  const api = crearApiFalsa([ADMIN.id]);
  const ctx = telegramBot._usarCliente(api);
  await telegramBot.manejarActualizacion(upd('/id'), ctx);
  check(api.enviados.length === 1 && api.enviados[0].texto.includes(String(CHAT)), '/id responde el ID del chat');
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd('/start@mi_bot', { chat: 777, tipo: 'private', from: ADMIN }), ctx);
  check(api.enviados.length === 1 && api.enviados[0].texto.includes('777') && /vincular/i.test(api.enviados[0].texto), '/start en privado explica y da el ID del chat');

  // ===== 3) Vincular con código =====
  const g = TABLAS.grupos[0];
  g.telegram_chat_id = null;
  g.telegram_codigo_vinculo = 'ABCD2345';
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd('/vincular ABCD2345', { from: CLIENTE }), ctx);
  check(/Solo un administrador/.test(api.enviados[0].texto) && !g.telegram_chat_id, 'un miembro que no es administrador NO puede vincular');
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd('/vincular@mi_bot CODIGOMALO', { from: ADMIN }), ctx);
  check(/no es válido/.test(api.enviados[0].texto) && !g.telegram_chat_id, 'un código inexistente no vincula nada');
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd('/vincular abcd2345', { from: ADMIN }), ctx);
  check(g.telegram_chat_id === String(CHAT) && g.telegram_codigo_vinculo === null && /Deportes Bernal/.test(api.enviados[0].texto), 'un administrador con el código correcto vincula el chat (sin importar mayúsculas) y el código se gasta');
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd('/vincular ABCD2345', { from: ADMIN }), ctx);
  check(/no es válido|ya se usó/.test(api.enviados[0].texto), 'el código no se puede reusar');

  // ===== 4) Sábana en el grupo vinculado =====
  const HOY = formatearFechaISO(new Date());
  const sabana = ['SABANA DE JUGADAS', HOY, 'PEDRO', 'houston -120', '100//90'].join('\n');
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd(sabana), ctx);
  check(TABLAS.tickets_historial.some(t => t.cliente_nombre === 'PEDRO'), 'la sábana del grupo de Telegram se importa y calcula (ticket de PEDRO en el historial)');
  check(api.enviados.length === 1 && api.enviados[0].chatId === String(CHAT) && api.enviados[0].texto.includes('🔄 *Actualización de resultados*'), 'responde en el mismo chat con el listado ya calculado');
  check(TABLAS.sabanas_pendientes_whatsapp.length === 1 && TABLAS.sabanas_pendientes_whatsapp[0].estado === 'importada', 'queda registrada como importada, igual que por WhatsApp');

  // sábana corregida (mensaje editado) reemplaza a la anterior
  api.enviados.length = 0;
  const sabana2 = ['SABANA DE JUGADAS', HOY, 'PEDRO', 'houston -120', '200//90'].join('\n');
  await telegramBot.manejarActualizacion(upd(sabana2, { editado: true }), ctx);
  check(TABLAS.tickets_historial.filter(t => t.cliente_nombre === 'PEDRO').length === 1 && TABLAS.tickets_historial.find(t => t.cliente_nombre === 'PEDRO').arriesga === 200, 'un mensaje EDITADO se procesa y reemplaza la sábana del día (arriesga 200)');

  // sábana ilegible: avisa y no manda listado
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd(['SABANA DE JUGADAS', 'sin fecha', 'blabla'].join('\n')), ctx);
  check(api.enviados.length === 1 && /No se pudo leer la fecha/.test(api.enviados[0].texto), 'una sábana sin fecha se rechaza con aviso (nunca asume "hoy")');

  // ===== 5) Chat NO vinculado, bots, privados =====
  api.enviados.length = 0;
  const antes = TABLAS.tickets_historial.length;
  await telegramBot.manejarActualizacion(upd(sabana, { chat: -999 }), ctx);
  check(api.enviados.length === 0 && TABLAS.tickets_historial.length === antes, 'un grupo de Telegram NO vinculado se ignora por completo');
  await telegramBot.manejarActualizacion(upd(sabana, { from: { id: 9, is_bot: true } }), ctx);
  check(api.enviados.length === 0, 'los mensajes de otros bots se ignoran');
  await telegramBot.manejarActualizacion(upd(sabana, { chat: 777, tipo: 'private', from: ADMIN }), ctx);
  check(api.enviados.length === 0, 'una sábana por chat privado no se procesa (solo en el grupo vinculado)');

  // ===== 6) Comandos: solo administradores =====
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd('act', { from: CLIENTE }), ctx);
  check(api.enviados.length === 0, 'un comando de alguien que NO es administrador se ignora');
  await telegramBot.manejarActualizacion(upd('act', { from: ADMIN }), ctx);
  check(api.enviados.length === 1 && api.enviados[0].texto.includes('Actualización de resultados'), '"act" de un administrador reenvía el listado');
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd('saldo total semana pedro', { from: ADMIN }), ctx);
  check(api.enviados.length >= 1 && api.enviados[0].texto.includes('Cliente: PEDRO'), '"saldo total semana pedro" de un administrador responde el corte del cliente');
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd('hola a todos', { from: ADMIN }), ctx);
  check(api.enviados.length === 0, 'una conversación normal no dispara nada');

  // ===== 7) Sábana larga partida en varios mensajes =====
  telegramBot.config.esperaPartesMs = 40;
  TABLAS.tickets_historial.length = 0;
  TABLAS.whatsapp_dia_estado.length = 0;
  const relleno = Array.from({ length: 190 }, () => 'houston -120\n10//9').join('\n');
  const parte1 = ['SABANA DE JUGADAS', HOY, 'PEDRO', relleno].join('\n');
  check(parte1.length >= 3500, '(preparación) la primera parte mide ' + parte1.length + ' caracteres, como una sábana partida por Telegram');
  const parte2 = ['LOPEZ', 'astros -110', '77//70'].join('\n');
  api.enviados.length = 0;
  const p1 = telegramBot.manejarActualizacion(upd(parte1), ctx);
  await p1;
  check(TABLAS.tickets_historial.length === 0, 'la primera parte (muy larga) espera a la siguiente en vez de procesarse sola');
  await telegramBot.manejarActualizacion(upd(parte2), ctx);
  await espera(120);
  check(TABLAS.tickets_historial.some(t => t.cliente_nombre === 'LOPEZ') && TABLAS.tickets_historial.some(t => t.cliente_nombre === 'PEDRO'), 'las dos partes se juntan y se procesan como UNA sábana (PEDRO y LOPEZ)');
  check(parte1.length <= 4096, '(preparación) y cabe en un mensaje de Telegram (' + parte1.length + ' <= 4096)');

  // ===== 8) Resumen automático =====
  TABLAS.whatsapp_dia_estado.length = 0;
  TABLAS.tickets_historial.length = 0;
  await telegramBot.manejarActualizacion(upd(sabana), ctx);          // carga + responde (registra el envío)
  api.enviados.length = 0;
  await telegramBot.revisarResumenesAutomaticos(ctx);
  check(api.enviados.length === 0, 'el resumen automático NO repite lo que ya se mandó si nada cambió');
  // cambia el resultado del partido -> el hash cambia, pero el límite de 1 hora aplica
  const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === GRUPO_ID);
  fila.ultimo_envio_resumen_en = new Date(Date.now() - 2 * 3600 * 1000);
  fila.ultimo_hash_resumen = 'otro';
  await telegramBot.revisarResumenesAutomaticos(ctx);
  check(api.enviados.length === 1 && api.enviados[0].chatId === String(CHAT), 'si pasó más de 1 hora y algo cambió, el resumen automático manda la actualización al grupo de Telegram');

  // ===== 9) Migración a supergrupo y aviso al dueño =====
  await telegramBot.manejarActualizacion({ update_id: 900, message: { chat: { id: CHAT, type: 'group' }, migrate_to_chat_id: -1009999 } }, ctx);
  check(TABLAS.grupos[0].telegram_chat_id === '-1009999', 'si el grupo migra a supergrupo, el vínculo se actualiza solo');
  delete process.env.TELEGRAM_AVISOS_CHAT_ID;
  check((await telegramBot.avisarPropietario('x')).enviado === false, 'sin TELEGRAM_AVISOS_CHAT_ID no se manda ningún aviso');
  process.env.TELEGRAM_AVISOS_CHAT_ID = '4242';
  api.enviados.length = 0;
  check((await telegramBot.avisarPropietario('🔔 prueba')).enviado === true && api.enviados[0].chatId === '4242', 'con TELEGRAM_AVISOS_CHAT_ID el aviso llega al chat privado del dueño');


  // ===== 9b) GRUPO CENTRAL: sábanas de varios grupos en un solo chat =====
  TABLAS.grupos[0].telegram_chat_id = String(CHAT);
  TABLAS.grupos.push({ id: 'g2', nombre: 'Deportes Lusho', activo: true, telegram_habilitado: true, telegram_chat_id: null, telegram_codigo_vinculo: null, modelo_comision: 'plano', comision_tiers: [] });
  TABLAS.grupos.push({ id: 'g3', nombre: 'Deportes Lusho VIP', activo: true, telegram_habilitado: true, telegram_chat_id: null, telegram_codigo_vinculo: null, modelo_comision: 'plano', comision_tiers: [] });
  TABLAS.grupos.push({ id: 'g4', nombre: 'Sin Telegram', activo: true, telegram_habilitado: false, telegram_chat_id: null, modelo_comision: 'plano', comision_tiers: [] });
  const CENTRAL = -1007777;
  process.env.TELEGRAM_CENTRAL_CHAT_ID = String(CENTRAL);

  const sepa = telegramBot.separarEncabezadoGrupo(['🇻🇪 *ZENYATTA*', '', 'SABANA DE JUGADAS', '08-10-2026', 'PEDRO', 'houston -120', '100//90'].join('\n'));
  check(sepa && sepa.esSabana && /ZENYATTA/.test(sepa.nombre) && sepa.cuerpo.startsWith('SABANA DE JUGADAS'), 'separa el nombre del grupo (1ª línea, aunque traiga emoji/asteriscos) del resto de la sábana');
  check(telegramBot.separarEncabezadoGrupo(sabana) === null, 'una sábana SIN nombre arriba no trae encabezado de grupo');
  const sepaCmd = telegramBot.separarEncabezadoGrupo('Lusho\nact');
  check(sepaCmd && !sepaCmd.esSabana && sepaCmd.nombre === 'Lusho' && sepaCmd.cuerpo === 'act', 'también separa "NOMBRE + comando"');
  const cands = [{ id: 'a', nombre: 'Deportes Zenyatta' }, { id: 'b', nombre: 'Deportes Lusho' }, { id: 'c', nombre: 'Deportes Lusho VIP' }];
  check(telegramBot.resolverGrupoPorNombre('zenyatta', cands).grupo.id === 'a', 'resuelve "zenyatta" -> "Deportes Zenyatta" (sin mayúsculas ni prefijo)');
  check(telegramBot.resolverGrupoPorNombre('DEPORTES LUSHO', cands).grupo.id === 'b', 'un nombre exacto gana aunque otro lo contenga ("Deportes Lusho" vs "Deportes Lusho VIP")');
  check(telegramBot.resolverGrupoPorNombre('Lusho', cands).grupo === null && telegramBot.resolverGrupoPorNombre('Lusho', cands).ambiguos.length === 2, 'un nombre que calza con varios grupos es ambiguo y NO elige uno');
  check(telegramBot.resolverGrupoPorNombre('Zenyáta', cands).grupo === null, 'un nombre que no existe no se adivina');

  TABLAS.whatsapp_dia_estado.length = 0;
  TABLAS.tickets_historial.length = 0;
  api.enviados.length = 0;
  const sabanaLusho = ['LUSHO VIP', 'SABANA DE JUGADAS', HOY, 'ANA', 'houston -120', '50//45'].join('\n');
  await telegramBot.manejarActualizacion(upd(sabanaLusho, { chat: CENTRAL, from: ADMIN }), ctx);
  check(TABLAS.tickets_historial.length === 1 && TABLAS.tickets_historial[0].grupo_id === 'g3' && TABLAS.tickets_historial[0].cliente_nombre === 'ANA', 'la sábana del central se carga en el grupo que dice el encabezado (Deportes Lusho VIP)');
  check(api.enviados.length >= 1 && api.enviados.every(m => m.chatId === String(CENTRAL) && m.texto.startsWith('📍 *DEPORTES LUSHO VIP*')), 'las respuestas salen SOLO en el central, con el nombre del grupo arriba');

  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd(['Zenyatta', 'SABANA DE JUGADAS', HOY, 'PEDRO', 'houston -120', '100//90'].join('\n'), { chat: CENTRAL, from: ADMIN }), ctx);
  check(!TABLAS.tickets_historial.some(t => t.cliente_nombre === 'PEDRO'), 'una sábana con un nombre de grupo que no existe ("Zenyatta") no se carga en NINGÚN grupo');
  check(api.enviados.length === 1 && /No encontré ningún grupo llamado "Zenyatta"/.test(api.enviados[0].texto) && /Deportes Lusho/.test(api.enviados[0].texto), 'un nombre que no existe se avisa, lista los grupos disponibles y no carga nada');

  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd(['Bernal', 'SABANA DE JUGADAS', HOY, 'PEDRO', 'houston -120', '100//90'].join('\n'), { chat: CENTRAL, from: ADMIN }), ctx);
  check(TABLAS.tickets_historial.some(t => t.grupo_id === GRUPO_ID && t.cliente_nombre === 'PEDRO'), 'con "Bernal" arriba, la sábana de PEDRO va a Deportes Bernal (el nombre parcial alcanza si es único)');

  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd(['Lusho', 'SABANA DE JUGADAS', HOY, 'ANA', 'houston -120', '50//45'].join('\n'), { chat: CENTRAL, from: ADMIN }), ctx);
  check(api.enviados.length === 1 && /calza con varios grupos/.test(api.enviados[0].texto), '"Lusho" calza con 2 grupos: pide el nombre completo y no carga nada');

  api.enviados.length = 0;
  const antesTickets = TABLAS.tickets_historial.length;
  await telegramBot.manejarActualizacion(upd(sabanaLusho, { chat: CENTRAL, from: CLIENTE }), ctx);
  check(api.enviados.length === 0 && TABLAS.tickets_historial.length === antesTickets, 'en el central solo cuentan los ADMINISTRADORES: un miembro común se ignora');

  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd(['Sin Telegram', 'SABANA DE JUGADAS', HOY, 'ANA', 'houston -120', '50//45'].join('\n'), { chat: CENTRAL, from: ADMIN }), ctx);
  check(api.enviados.length === 1 && /No encontré/.test(api.enviados[0].texto), 'un grupo SIN el servicio de Telegram contratado no se puede alimentar desde el central');

  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd(['Deportes Lusho VIP', 'act'].join('\n'), { chat: CENTRAL, from: ADMIN }), ctx);
  check(api.enviados.length === 1 && api.enviados[0].texto.startsWith('📍 *DEPORTES LUSHO VIP*') && /Actualización de resultados/.test(api.enviados[0].texto), 'un comando con el nombre del grupo arriba ("Deportes Lusho VIP" + "act") responde en el central con ese grupo');

  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd('hola, buenas', { chat: CENTRAL, from: ADMIN }), ctx);
  check(api.enviados.length === 0, 'una conversación normal en el central no dispara nada');

  // resumen automático: los grupos sin Telegram propio salen en el central
  const filaL = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === 'g3');
  filaL.ultimo_envio_resumen_en = new Date(Date.now() - 2 * 3600 * 1000);
  filaL.ultimo_hash_resumen = 'otro';
  api.enviados.length = 0;
  await telegramBot.revisarResumenesAutomaticos(ctx);
  check(api.enviados.some(m => m.chatId === String(CENTRAL) && m.texto.startsWith('📍 *DEPORTES LUSHO VIP*')), 'el resumen automático de un grupo sin Telegram propio se publica en el central, con su nombre');
  check(!api.enviados.some(m => /Sin Telegram/i.test(m.texto)), '...y un grupo sin el servicio nunca recibe nada');

  // sábana larga partida, con nombre de grupo, en el central
  telegramBot.config.esperaPartesMs = 40;
  TABLAS.tickets_historial.length = 0;
  TABLAS.whatsapp_dia_estado.length = 0;
  const relleno2 = Array.from({ length: 190 }, () => 'houston -120\n10//9').join('\n');
  const larga1 = ['Deportes Lusho VIP', 'SABANA DE JUGADAS', HOY, 'ANA', relleno2].join('\n');
  api.enviados.length = 0;
  await telegramBot.manejarActualizacion(upd(larga1, { chat: CENTRAL, from: ADMIN }), ctx);
  check(TABLAS.tickets_historial.length === 0, '(central) la primera parte muy larga espera a la siguiente');
  await telegramBot.manejarActualizacion(upd(['LUIS', 'astros -110', '77//70'].join('\n'), { chat: CENTRAL, from: ADMIN }), ctx);
  await espera(150);
  check(TABLAS.tickets_historial.some(t => t.cliente_nombre === 'LUIS') && TABLAS.tickets_historial.every(t => t.grupo_id === 'g3'), '(central) las dos partes se juntan y se cargan en el grupo del encabezado');
  delete process.env.TELEGRAM_CENTRAL_CHAT_ID;

  // ===== 10) Arranque y bucle de lectura con un fetch falso =====
  const metodos = [];
  let entregado = false;
  const fetchBot = async (url, op) => {
    const metodo = url.split('/').pop();
    const params = JSON.parse(op.body);
    metodos.push(metodo);
    if (metodo === 'getMe') return { json: async () => ({ ok: true, result: { username: 'zenyatta_bot' } }) };
    if (metodo === 'deleteWebhook') return { json: async () => ({ ok: true, result: true }) };
    if (metodo === 'getUpdates') {
      if (!entregado) { entregado = true; return { json: async () => ({ ok: true, result: [{ update_id: 5, message: { message_id: 1, chat: { id: 321, type: 'supergroup' }, from: CLIENTE, text: '/id' } }] }) }; }
      return new Promise(() => {});
    }
    if (metodo === 'sendMessage') return { json: async () => ({ ok: true, result: { message_id: 2 } }) };
    return { json: async () => ({ ok: true, result: {} }) };
  };
  process.env.TELEGRAM_RESUMEN_AUTOMATICO = 'false';
  const arranco = await telegramBot.iniciarBotTelegram({ fetchImpl: fetchBot, token: 'TOKEN' });
  await espera(100);
  check(arranco === true && telegramBot.obtenerEstadoTelegram().usuario === 'zenyatta_bot' && telegramBot.obtenerEstadoTelegram().conectado === true, 'el bot arranca, se identifica (getMe) y queda conectado');
  check(metodos.includes('deleteWebhook') && metodos.includes('getUpdates') && metodos.includes('sendMessage'), 'quita el webhook, lee con getUpdates y responde con sendMessage');
  telegramBot.detenerBotTelegram();
  check(telegramBot.obtenerEstadoTelegram().activo === false, 'detenerBotTelegram() lo apaga');
  delete process.env.TELEGRAM_BOT_TOKEN;
  check((await telegramBot.iniciarBotTelegram({})) === false, 'sin token no arranca');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Telegram se cayó con una excepción:', e);
  process.exit(1);
});
