// =================================================================
// NÚMERO DE WHATSAPP PROPIO POR GRUPO (17-11-2026)
// Hasta ahora todo el sistema usaba UNA sola sesión de WhatsApp (whatsappBot.js). Para el servicio "Corredores y Administración
// Inteligente" cada grupo puede tener además SU PROPIO número (su propio QR y su propia carpeta de sesión), así no se mete un solo
// número en muchos grupos. Esta conexión extra:
//   - SOLO alimenta al bot de jugadas del chat (hipismoJugadasChatBot); la sábana y los comandos siguen por el número general.
//   - Guarda su sesión en <WHATSAPP_SESSION_DIR>/grupos/grupo-<id> (una carpeta por grupo, dentro del mismo volumen persistente).
//   - Se vuelve a levantar sola al arrancar el servidor para los grupos que ya la tenían vinculada (grupos.whatsapp_propio_activo).
//   - Mientras esté conectada, la conexión general NO procesa las jugadas de ese grupo (para no responder dos veces); si se cae, la
//     general vuelve a hacerse cargo si es que está en ese chat.
// Columnas en `grupos`: whatsapp_propio_activo (boolean) y whatsapp_propio_jid (el chat de WhatsApp donde trabaja el bot).
// =================================================================
const path = require('path');
const fs = require('fs');
const db = require('../db');
const whatsappAuthDb = require('./whatsappAuthDb');

const sesiones = new Map(); // grupoId -> { sock, gen, conectado, ultimoQr, ultimoError, gruposDisponibles, numero, reintento, cerrando }
const ESPERA_REINTENTO_MS = 5000;
const ESPERA_ENTRE_ARRANQUES_MS = 2500;

// Se pueden reemplazar en las pruebas (sin Baileys ni disco real).
const deps = {
  cargarBaileys: () => require('@whiskeysockets/baileys'),
  cargarBoom: () => require('@hapi/boom'),
  baseDir: () => (process.env.WHATSAPP_SESSION_DIR ? path.resolve(process.env.WHATSAPP_SESSION_DIR) : path.resolve('./whatsapp-session')),
  intentar: (args) => require('./hipismoJugadasChatBot').intentar(args),
  ayudasBot: () => require('./whatsappBot').crearAyudasJugadasChat,
  alertar: (asunto, cuerpo) => require('./emailAlertas').enviarAlertaEmail(asunto, cuerpo).catch(() => {}),
  // La sesión se guarda en la base de datos (sobrevive a reinicios sin necesitar un Volume en Railway). Si la tabla no existe o
  // Baileys no trae las piezas, se usan archivos como antes.
  crearAuth: async (id, baileys, dir) => {
    if (baileys.initAuthCreds && baileys.BufferJSON && baileys.proto) {
      try { return await whatsappAuthDb.authEnBaseDeDatos(db, 'grupo-' + String(id), baileys); }
      catch (e) { console.error('[whatsappSesionesGrupo] No se pudo guardar la sesión del grupo ' + id + ' en la base de datos (¿corriste el SQL nuevo?), uso archivos:', e.message); }
    }
    return baileys.useMultiFileAuthState(dir);
  },
  borrarSesionBd: (id) => whatsappAuthDb.borrarSesion(db, 'grupo-' + String(id)),
  esperar: (ms) => new Promise(r => setTimeout(r, ms)),
  setTimeout: (fn, ms) => setTimeout(fn, ms)
};

function carpetaDeSesion(grupoId) {
  return path.join(deps.baseDir(), 'grupos', 'grupo-' + String(grupoId).replace(/[^a-zA-Z0-9_-]/g, ''));
}

function estadoVacio() {
  return { sock: null, gen: 0, conectado: false, ultimoQr: null, ultimoError: null, gruposDisponibles: [], numero: null, reintento: null, cerrando: false };
}

function numeroDeSock(sock) {
  const id = sock && sock.user && sock.user.id;
  if (!id) return null;
  return String(id).split('@')[0].split(':')[0] || null;
}

function enmascararNumero(n) {
  const s = String(n || '').replace(/\D/g, '');
  if (s.length < 7) return s ? '•••' : null;
  return '+' + s.slice(0, s.length - 10 > 0 ? s.length - 10 : 2) + ' ' + s.slice(-10, -7) + ' ••• ' + s.slice(-4);
}

function estadoPublico(grupoId) {
  const s = sesiones.get(String(grupoId));
  if (!s) return { activa: false, conectado: false, tieneQr: false, ultimoError: null, numero: null, grupos: [] };
  return {
    activa: true,
    conectado: !!s.conectado,
    tieneQr: !!s.ultimoQr && !s.conectado,
    ultimoError: s.ultimoError,
    numero: enmascararNumero(s.numero),
    ultimo: s.ultimo || null,
    grupos: s.gruposDisponibles || []
  };
}

function estaConectada(grupoId) {
  const s = sesiones.get(String(grupoId));
  return !!(s && s.conectado);
}

function obtenerQr(grupoId) {
  const s = sesiones.get(String(grupoId));
  return s && !s.conectado ? s.ultimoQr : null;
}

async function listarGrupos(s) {
  try {
    const grupos = await s.sock.groupFetchAllParticipating();
    s.gruposDisponibles = Object.values(grupos).map(g => ({ jid: g.id, nombre: g.subject }));
  } catch (e) {
    console.error('[whatsappSesionesGrupo] No se pudo listar los grupos de WhatsApp:', e.message);
  }
}

async function refrescarGrupos(grupoId) {
  const s = sesiones.get(String(grupoId));
  if (!s || !s.conectado || !s.sock) throw new Error('El número de este grupo todavía no está conectado — escanea el QR primero.');
  await listarGrupos(s);
  return s.gruposDisponibles;
}

function extraerTexto(msg) {
  const m = msg && msg.message;
  if (!m) return null;
  return m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || null;
}

// Un mensaje de WhatsApp que llegó por la conexión propia de este grupo.
async function manejarMensaje(grupoId, sock, msg) {
  const remoteJid = msg && msg.key && msg.key.remoteJid;
  const s = sesiones.get(String(grupoId));
  const anotar = (motivo) => { if (s) s.ultimo = { en: new Date().toISOString(), chat: remoteJid, motivo }; };
  if (!remoteJid || !String(remoteJid).endsWith('@g.us')) { anotar('Ignorado: es un chat privado, no un grupo'); return; }
  const texto = extraerTexto(msg);
  if (!texto) { anotar('Ignorado: el mensaje no tiene texto (foto, sticker...)'); return; }
  try {
    const ayudas = deps.ayudasBot()(sock, msg);
    await deps.intentar({ sock, msg, remoteJid, texto, grupoId, ayudas, anotar });
  } catch (e) {
    console.error('[whatsappSesionesGrupo] Error al procesar un mensaje del grupo ' + grupoId + ':', e);
  }
}

// Arranca (o reinicia) la conexión propia de un grupo. Devuelve cuando el socket ya quedó armado (no espera al QR).
async function iniciarSesion(grupoId) {
  const id = String(grupoId);
  let s = sesiones.get(id);
  if (!s) { s = estadoVacio(); sesiones.set(id, s); }
  s.cerrando = false;
  if (s.reintento) { clearTimeout(s.reintento); s.reintento = null; }
  if (s.sock) { try { s.sock.end(undefined); } catch (e) { /* ya estaba cerrado */ } s.sock = null; }
  const gen = ++s.gen;

  const baileys = deps.cargarBaileys();
  const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = baileys;
  const { Boom } = deps.cargarBoom();

  const dir = carpetaDeSesion(id);
  fs.mkdirSync(dir, { recursive: true });
  const { state, saveCreds } = await deps.crearAuth(id, baileys, dir);
  const yaTeniaSesion = !!(state && state.creds && state.creds.registered) || fs.existsSync(path.join(dir, 'creds.json'));
  console.log('[whatsappSesionesGrupo] Grupo ' + id + ': ' + (yaTeniaSesion ? 'retomando la sesión guardada (base de datos o carpeta ' + dir + ')' : 'sin sesión guardada (pedirá QR)'));

  let version;
  try { version = (await fetchLatestBaileysVersion()).version; } catch (e) { /* se sigue con la versión que trae la librería */ }

  const sock = makeWASocket({ auth: state, version });
  s.sock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    if (s.gen !== gen) return; // un socket viejo ya reemplazado
    const { connection, lastDisconnect, qr } = update;
    if (qr) { s.ultimoQr = qr; s.conectado = false; }
    if (connection === 'open') {
      s.conectado = true; s.ultimoQr = null; s.ultimoError = null;
      s.numero = numeroDeSock(sock);
      console.log('[whatsappSesionesGrupo] Grupo ' + id + ': conectado con su número propio.');
      listarGrupos(s);
    }
    if (connection === 'close') {
      s.conectado = false;
      if (s.cerrando) return;
      const motivo = lastDisconnect && lastDisconnect.error ? new Boom(lastDisconnect.error) : null;
      const cerroSesion = motivo && motivo.output && motivo.output.statusCode === DisconnectReason.loggedOut;
      if (cerroSesion) {
        s.ultimoError = 'WhatsApp cerró la sesión de este número — hay que volver a vincularlo (escanear un QR nuevo).';
        s.ultimoQr = null;
        console.error('[whatsappSesionesGrupo] Grupo ' + id + ': ' + s.ultimoError);
        deps.alertar('🔴 LUDOX: se cayó el número propio de un grupo', 'El número propio del grupo ' + id + ' ya no está vinculado (WhatsApp cerró la sesión). Entra a Súper-admin → detalle del grupo → WhatsApp y vincúlalo de nuevo.');
      } else {
        const codigo = motivo && motivo.output ? motivo.output.statusCode : null;
        const explicacion = { 440: 'la sesión se abrió en otro lugar (dos servidores usando el mismo número)', 515: 'WhatsApp pidió reiniciar la conexión (normal justo después de escanear el QR)', 428: 'WhatsApp cerró la conexión', 408: 'se agotó el tiempo de espera', 500: 'la sesión guardada está dañada', 503: 'WhatsApp no estaba disponible' }[codigo];
        console.log('[whatsappSesionesGrupo] Grupo ' + id + ': conexión cerrada (código ' + codigo + (explicacion ? ' — ' + explicacion : '') + '), reintentando.');
        s.ultimoError = 'Se perdió la conexión' + (codigo ? ' (código ' + codigo + (explicacion ? ': ' + explicacion : '') + ')' : '') + ', reintentando…';
        s.reintento = deps.setTimeout(() => {
          s.reintento = null;
          if (s.gen !== gen || s.cerrando) return;
          iniciarSesion(id).catch(e => console.error('[whatsappSesionesGrupo] Error al reconectar el grupo ' + id + ':', e));
        }, ESPERA_REINTENTO_MS);
      }
    }
  });

  sock.ev.on('messages.upsert', async (evento) => {
    if (s.gen !== gen) return;
    for (const msg of (evento.messages || [])) await manejarMensaje(id, sock, msg);
  });

  return sock;
}

// Desvincula: cierra sesión en WhatsApp, borra la carpeta y apaga la bandera en la base.
async function desvincular(grupoId) {
  const id = String(grupoId);
  const s = sesiones.get(id);
  if (s) {
    s.cerrando = true; s.gen++;
    if (s.reintento) { clearTimeout(s.reintento); s.reintento = null; }
    if (s.sock) {
      try { await s.sock.logout(); } catch (e) { try { s.sock.end(undefined); } catch (e2) { /* nada */ } }
    }
    sesiones.delete(id);
  }
  try { await deps.borrarSesionBd(id); } catch (e) { console.error('[whatsappSesionesGrupo] No se pudo borrar la sesión guardada en la base del grupo ' + id + ':', e.message); }
  try { fs.rmSync(carpetaDeSesion(id), { recursive: true, force: true }); } catch (e) {
    console.error('[whatsappSesionesGrupo] No se pudo borrar la carpeta de sesión del grupo ' + id + ':', e.message);
  }
  await db.query('UPDATE grupos SET whatsapp_propio_activo = false, whatsapp_propio_jid = NULL WHERE id = $1', [grupoId]);
}

// Al arrancar el servidor: levanta, de a una, las conexiones de los grupos que ya tenían número propio.
async function arrancarSesionesGuardadas() {
  let filas = [];
  try {
    const r = await db.query('SELECT id FROM grupos WHERE whatsapp_propio_activo = true AND activo = true');
    filas = r.rows;
  } catch (e) {
    if (!e || e.code !== '42703') console.error('[whatsappSesionesGrupo] No se pudieron leer los grupos con número propio:', e.message);
    return 0;
  }
  for (const f of filas) {
    try { await iniciarSesion(f.id); } catch (e) { console.error('[whatsappSesionesGrupo] No se pudo arrancar el grupo ' + f.id + ':', e.message); }
    await deps.esperar(ESPERA_ENTRE_ARRANQUES_MS);
  }
  return filas.length;
}

module.exports = {
  iniciarSesion, desvincular, arrancarSesionesGuardadas, refrescarGrupos,
  estadoPublico, estaConectada, obtenerQr, carpetaDeSesion, enmascararNumero,
  _deps: deps, _sesiones: sesiones
};
