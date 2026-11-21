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
// La conexión es por grupo de Ludox. Los chats autorizados se guardan aparte en whatsapp_propio_chats.
// =================================================================
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const whatsappAuthDb = require('./whatsappAuthDb');

// =================================================================
// QUE UN PUSH NUNCA SILENCIE AL BOT (19-11-2026)
// Al desplegar, Railway deja el servidor viejo y el nuevo vivos a la vez durante unos segundos y los dos usaban la MISMA sesión de
// WhatsApp (guardada en la base): se echaban uno al otro, y a veces el que quedaba decía "Conectado" pero WhatsApp ya no le entregaba
// mensajes. Ahora hay tres defensas:
//   1) TURNO: cada sesión tiene un "turno" en la base (tabla whatsapp_sesion_turno). Solo UN servidor a la vez puede conectarla; el
//      nuevo espera (y se conecta solo) hasta que el viejo la suelta. El turno se renueva cada 10 s y caduca solo a los 30 s si el
//      servidor muere sin avisar.
//   2) APAGADO LIMPIO: al recibir SIGTERM (Railway apagando el servidor viejo) se cierra el socket y se suelta el turno al instante.
//   3) VIGILANTE: cada 10 s revisa todo. Si una conexión dice "Conectado" pero lleva minutos sin entregar ni un mensaje, la
//      reinicia sola (sin pedir QR) con espera creciente; si una sesión no está levantada, la levanta; si falla un reintento,
//      vuelve a programar otro. Nada de esto necesita que alguien entre al panel.
// =================================================================
const INSTANCIA = (process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_REPLICA_ID || 'local') + ':' + process.pid + ':' + crypto.randomBytes(3).toString('hex');
const TURNO_TTL_S = 30;
const LATIDO_MS = 10 * 1000;
const ESPERA_TURNO_MS = 3000;
const ESPERA_CONFLICTO_MS = 20000; // código 440: alguien más usa el número; no entrar en pelea cada 5 s
const SIN_MENSAJES_MS = 3 * 60 * 1000; // "Conectado" pero 0 mensajes durante este tiempo => se reinicia la conexión
const REFRESCO_BASE_MS = 10 * 60 * 1000;
const REFRESCO_MAX_MS = 2 * 60 * 60 * 1000;
const CADA_N_LATIDOS_RECONCILIAR = 6;
const BUFFER_MAX_MS = 30 * 1000;
const MAX_EDAD_MENSAJE_MS = 4 * 60 * 1000;

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
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  setIntervalo: (fn, ms) => { const t = setInterval(fn, ms); if (t && t.unref) t.unref(); return t; },
  ahora: () => Date.now(),
  // Turno de conexión (ver arriba). true = este servidor puede conectar/seguir conectado; false = otro servidor la tiene.
  tomarTurno: async (id) => {
    const consultar = () => db.query(
      `INSERT INTO whatsapp_sesion_turno (scope, dueno, expira_en) VALUES ($1, $2, now() + $3::int * interval '1 second')
       ON CONFLICT (scope) DO UPDATE SET dueno = EXCLUDED.dueno, expira_en = EXCLUDED.expira_en
       WHERE whatsapp_sesion_turno.dueno = EXCLUDED.dueno OR whatsapp_sesion_turno.expira_en < now()
       RETURNING dueno`, ['grupo-' + String(id), INSTANCIA, TURNO_TTL_S]);
    try { return (await consultar()).rows.length > 0; }
    catch (e) {
      if (!e || e.code !== '42P01') throw e;
      await db.query('create table if not exists whatsapp_sesion_turno (scope text primary key, dueno text not null, expira_en timestamptz not null)');
      return (await consultar()).rows.length > 0;
    }
  },
  soltarTurno: async (id) => {
    try { await db.query('DELETE FROM whatsapp_sesion_turno WHERE scope = $1 AND dueno = $2', ['grupo-' + String(id), INSTANCIA]); } catch (e) { /* caduca solo en 30 s */ }
  },
  filasActivas: async () => (await db.query('SELECT id FROM grupos WHERE whatsapp_propio_activo = true AND activo = true')).rows
};

function carpetaDeSesion(grupoId) {
  return path.join(deps.baseDir(), 'grupos', 'grupo-' + String(grupoId).replace(/[^a-zA-Z0-9_-]/g, ''));
}

function estadoVacio() {
  return { sock: null, gen: 0, conectado: false, ultimoQr: null, ultimoError: null, gruposDisponibles: [], numero: null, reintento: null, cerrando: false, eventos: 0, ultimoEvento: null, conectadoEn: null, reconexiones: 0, ultimoCodigo: null, turno: false, refrescos: 0, proximoRefresco: 0, ultimoRefresco: null };
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
    requiereNuevoQr: !!s.requiereNuevoQr,
    ultimoError: s.ultimoError,
    numero: enmascararNumero(s.numero),
    ultimo: s.ultimo || null,
    // Diagnóstico (18-11-2026): ¿WhatsApp le entrega eventos a este número? ¿se reconecta seguido?
    eventos: s.eventos || 0, ultimoEvento: s.ultimoEvento || null, conectadoEn: s.conectadoEn || null, reconexiones: s.reconexiones || 0, ultimoCodigo: s.ultimoCodigo || null,
    esperandoTurno: !s.turno, refrescos: s.refrescos || 0, ultimoRefresco: s.ultimoRefresco || null, flushForzados: s.flushForzados || 0, sinBuffer: !!s.sinBuffer,
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
  // messageStubType 2 = CIPHERTEXT: WhatsApp entregó el mensaje pero esta sesión no pudo descifrarlo (llaves guardadas dañadas o incompletas).
  if (!texto && msg && msg.messageStubType === 2) {
    console.error('[whatsappSesionesGrupo] Grupo ' + grupoId + ': NO se pudo descifrar un mensaje de ' + remoteJid + ' (' + ((msg.messageStubParameters || [])[0] || 'sin detalle') + ').');
    anotar('⚠️ Llegó un mensaje pero NO se pudo descifrar: la sesión guardada está dañada. Usa "Volver a vincular" y escanea el QR otra vez.');
    return;
  }
  if (!texto) { anotar('Ignorado: el mensaje no tiene texto (foto, sticker...)'); return; }
  // Mensajes viejos (19-11-2026): al reconectar, WhatsApp entrega de golpe lo que se escribió mientras estuvo caído (tipo "append": ej. 72 de
  // una vez). Ejecutar comandos o jugadas de hace rato (abrir/cerrar carreras, registrar jugadas dos veces) sería peligroso: solo se
  // atienden los de los últimos MAX_EDAD_MENSAJE_MS (cubre un deploy normal); los más viejos se ignoran y se anota en el panel.
  const t = msg && msg.messageTimestamp;
  const seg = t && typeof t === 'object' && typeof t.toNumber === 'function' ? t.toNumber() : Number(t);
  if (seg > 0 && deps.ahora() - seg * 1000 > MAX_EDAD_MENSAJE_MS) {
    anotar('Ignorado: mensaje viejo (de hace ' + Math.round((deps.ahora() - seg * 1000) / 60000) + ' min, llegó retrasado al reconectar)');
    return;
  }
  try {
    const ayudas = deps.ayudasBot()(sock, msg);
    await deps.intentar({ sock, msg, remoteJid, texto, grupoId, ayudas, anotar });
  } catch (e) {
    console.error('[whatsappSesionesGrupo] Error al procesar un mensaje del grupo ' + grupoId + ':', e);
  }
}

// Programa (y si falla, vuelve a programar) un nuevo intento de levantar la sesión. Nunca se queda sin reintento.
function programarReintento(id, s, ms) {
  if (s.reintento) { clearTimeout(s.reintento); s.reintento = null; }
  const gen = s.gen;
  s.reintento = deps.setTimeout(() => {
    s.reintento = null;
    if (s.gen !== gen || s.cerrando) return;
    iniciarSesion(id).catch(e => {
      console.error('[whatsappSesionesGrupo] Error al reconectar el grupo ' + id + ' (se vuelve a intentar):', e && e.message ? e.message : e);
      s.ultimoError = 'No se pudo reconectar (' + (e && e.message ? e.message : 'error') + '), reintentando…';
      if (!s.cerrando) programarReintento(id, s, ESPERA_REINTENTO_MS * 2);
    });
  }, ms);
}

// Cierra el socket de esta sesión sin tocar la sesión guardada (no desvincula, no pide QR).
function cerrarSocket(s) {
  s.gen++; s.conectado = false;
  if (s.reintento) { clearTimeout(s.reintento); s.reintento = null; }
  if (s.flusher) { try { clearInterval(s.flusher); } catch (e) { /* nada */ } s.flusher = null; }
  if (s.sock) { try { s.sock.end(undefined); } catch (e) { /* ya estaba cerrado */ } s.sock = null; }
}

// VIGILANTE (cada 10 s): renueva el turno, detecta turnos perdidos y conexiones "Conectado" que no entregan mensajes.
let latidoTimer = null, latidos = 0, latidoEnCurso = false;
function asegurarLatido() {
  if (latidoTimer) return;
  latidoTimer = deps.setIntervalo(() => { latido().catch(e => console.error('[whatsappSesionesGrupo] Error del vigilante:', e && e.message ? e.message : e)); }, LATIDO_MS);
}

async function latido() {
  if (latidoEnCurso) return;
  latidoEnCurso = true;
  try {
    latidos++;
    for (const [id, s] of Array.from(sesiones.entries())) {
      if (s.cerrando || !s.turno) continue;
      let sigoSiendoYo;
      try { sigoSiendoYo = await deps.tomarTurno(id); } catch (e) { continue; } // fallo pasajero de la base: se intenta en el próximo latido
      if (s.cerrando || !s.turno) continue;
      if (!sigoSiendoYo) {
        console.error('[whatsappSesionesGrupo] Grupo ' + id + ': otro servidor tomó el turno de esta sesión; este queda en espera para no pelear por el número.');
        cerrarSocket(s); s.turno = false;
        s.ultimoError = 'Esperando que el otro servidor suelte la sesión de WhatsApp…';
        programarReintento(id, s, ESPERA_TURNO_MS * 3);
        continue;
      }
      const ahora = deps.ahora();
      // Red de seguridad: si el buffer de eventos de Baileys lleva más de 30 s retenido, se libera a la fuerza (así los mensajes llegan).
      try {
        const ev = s.sock && s.sock.ev;
        if (s.conectado && ev && typeof ev.isBuffering === 'function' && ev.isBuffering()) {
          s.bufferDesde = s.bufferDesde || ahora;
          if (ahora - s.bufferDesde > BUFFER_MAX_MS) {
            s.flushForzados = (s.flushForzados || 0) + 1; s.bufferDesde = null;
            console.error('[whatsappSesionesGrupo] Grupo ' + id + ': Baileys tenía los mensajes retenidos (buffer) más de 30 s — se liberan a la fuerza (vez ' + s.flushForzados + ').');
            ev.flush();
          }
        } else s.bufferDesde = null;
      } catch (e) { /* nada */ }
      const edad = s.conectado && s.conectadoEn ? ahora - Date.parse(s.conectadoEn) : 0;
      if (s.conectado && (s.eventos || 0) === 0 && edad >= SIN_MENSAJES_MS && ahora >= (s.proximoRefresco || 0)) {
        s.refrescos = (s.refrescos || 0) + 1;
        s.proximoRefresco = ahora + Math.min(REFRESCO_MAX_MS, REFRESCO_BASE_MS * Math.pow(2, s.refrescos - 1));
        s.ultimoRefresco = { en: new Date(ahora).toISOString(), n: s.refrescos, motivo: 'Decía "Conectado" pero WhatsApp no entregó ningún mensaje en ' + Math.round(edad / 60000) + ' min' };
        console.error('[whatsappSesionesGrupo] Grupo ' + id + ': conectado hace ' + Math.round(edad / 60000) + ' min sin recibir ni un mensaje — se reinicia la conexión sola (intento ' + s.refrescos + ').');
        if (s.refrescos === 3) deps.alertar('🟠 LUDOX: el bot de WhatsApp conecta pero no recibe mensajes', 'El número propio del grupo ' + id + ' lleva ' + s.refrescos + ' reinicios automáticos diciendo "Conectado" sin recibir mensajes (puede ser que el grupo esté en silencio, o que la sesión guardada esté dañada). Si en el grupo sí están escribiendo: Súper-admin → detalle del grupo → WhatsApp → "Volver a vincular".');
        iniciarSesion(id).catch(e => {
          console.error('[whatsappSesionesGrupo] Error al reiniciar el grupo ' + id + ':', e && e.message ? e.message : e);
          if (!s.cerrando) programarReintento(id, s, ESPERA_REINTENTO_MS);
        });
      }
    }
    if (latidos % CADA_N_LATIDOS_RECONCILIAR === 0) await reconciliar();
  } finally { latidoEnCurso = false; }
}

// Levanta las sesiones que deberían estar activas (grupos con número propio) y no están en marcha (porque falló el arranque, etc.).
async function reconciliar() {
  let filas;
  try { filas = await deps.filasActivas(); } catch (e) { return 0; }
  let levantadas = 0;
  for (const f of filas) {
    const s = sesiones.get(String(f.id));
    if (s && (s.sock || s.reintento || s.cerrando || s.iniciando || s.ultimoError && /cerró la sesión/.test(s.ultimoError))) continue;
    levantadas++;
    console.log('[whatsappSesionesGrupo] Vigilante: el grupo ' + f.id + ' debería estar conectado y no lo está; se levanta.');
    iniciarSesion(f.id).catch(e => {
      const st = sesiones.get(String(f.id));
      console.error('[whatsappSesionesGrupo] Vigilante: no se pudo levantar el grupo ' + f.id + ':', e && e.message ? e.message : e);
      if (st && !st.cerrando) programarReintento(String(f.id), st, ESPERA_REINTENTO_MS);
    });
  }
  return levantadas;
}

// Apagado limpio (SIGTERM de Railway): cierra los sockets y suelta los turnos para que el servidor nuevo tome las sesiones al instante.
async function apagar() {
  if (latidoTimer) { try { clearInterval(latidoTimer); } catch (e) { /* nada */ } latidoTimer = null; }
  const ids = [];
  for (const [id, s] of sesiones.entries()) { s.cerrando = true; ids.push([id, s.turno]); cerrarSocket(s); s.turno = false; }
  await deps.esperar(800); // deja terminar los guardados de llaves que estaban en curso
  for (const [id, tenia] of ids) { if (tenia) await deps.soltarTurno(id); }
  return ids.length;
}

// Arranca (o reinicia) la conexión propia de un grupo. Devuelve cuando el socket ya quedó armado (no espera al QR).
async function iniciarSesion(grupoId) {
  const id = String(grupoId);
  let s0 = sesiones.get(id);
  if (!s0) { s0 = estadoVacio(); sesiones.set(id, s0); }
  s0.iniciando = (s0.iniciando || 0) + 1; // para que el vigilante no la arranque dos veces a la vez
  try { return await iniciarSesionInterna(id); } finally { s0.iniciando--; }
}

async function reconectarSesion(grupoId) {
  const s = sesiones.get(String(grupoId));
  if (s?.iniciando || s?.cerrando) return;
  if (s) s.ultimoError = 'Reconectando WhatsApp con la sesión guardada…';
  await iniciarSesion(grupoId);
}

async function iniciarSesionInterna(grupoId) {
  const id = String(grupoId);
  let s = sesiones.get(id);
  if (!s) { s = estadoVacio(); sesiones.set(id, s); }
  s.cerrando = false;
  cerrarSocket(s);
  const gen = s.gen;
  asegurarLatido();

  // Turno: solo un servidor a la vez conecta esta sesión (el nuevo espera a que el viejo la suelte).
  let tengoTurno = false;
  try { tengoTurno = await deps.tomarTurno(id); }
  catch (e) { console.error('[whatsappSesionesGrupo] Grupo ' + id + ': no se pudo reservar el turno en la base, reintento:', e.message); s.ultimoError = 'No se pudo hablar con la base de datos, reintentando…'; }
  if (s.gen !== gen || s.cerrando) return null;
  if (!tengoTurno) {
    s.turno = false; s.conectado = false;
    if (!/^No se pudo hablar/.test(s.ultimoError || '')) s.ultimoError = 'Esperando que el servidor anterior suelte la sesión de WhatsApp (se conecta sola en cuanto la suelte)…';
    programarReintento(id, s, ESPERA_TURNO_MS);
    return null;
  }
  s.turno = true;

  const baileys = deps.cargarBaileys();
  const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = baileys;
  const { Boom } = deps.cargarBoom();

  const dir = carpetaDeSesion(id);
  // Tras un logout confirmado, reutilizar las credenciales vuelve a provocar el mismo cierre.
  // Se eliminan solo después de tomar el turno de esta sesión.
  if (s.requiereNuevoQr) {
    await deps.borrarSesionBd(id);
    fs.rmSync(dir, { recursive: true, force: true });
    s.requiereNuevoQr = false;
    s.ultimoError = null;
  }
  fs.mkdirSync(dir, { recursive: true });
  const { state, saveCreds } = await deps.crearAuth(id, baileys, dir);
  const yaTeniaSesion = !!(state && state.creds && state.creds.registered) || fs.existsSync(path.join(dir, 'creds.json'));
  console.log('[whatsappSesionesGrupo] Grupo ' + id + ': ' + (yaTeniaSesion ? 'retomando la sesión guardada (base de datos o carpeta ' + dir + ')' : 'sin sesión guardada (pedirá QR)'));

  let version;
  try { version = (await fetchLatestBaileysVersion()).version; } catch (e) { /* se sigue con la versión que trae la librería */ }

  // Sin sincronizar historial (19-11-2026): Baileys, al reconectar una sesión ya guardada, RETIENE todos los mensajes en un buffer
  // hasta terminar de sincronizar; si esa sincronización se queda colgada, el buffer no se libera nunca y WhatsApp aparece
  // "Conectado" pero messages.upsert jamás se dispara (justo el síntoma de "0 mensajes"). El bot no necesita el historial.
  const sock = makeWASocket({ auth: state, version, syncFullHistory: false, shouldSyncHistoryMessage: () => false });
  s.sock = sock;
  // SIN BUFFER (19-11-2026): Baileys retiene los mensajes (ev.buffer) mientras procesa cada notificación y, tras reconectar, hasta
  // terminar de ponerse al día; con muchos mensajes pendientes o una consulta lenta eso significaba minutos de silencio (el bot
  // contestó una carrera abierta 4 min tarde). Este bot no necesita ese orden consolidado: se anula el buffer para que cada
  // mensaje llegue a messages.upsert apenas se descifra.
  try { if (sock.ev && typeof sock.ev.buffer === 'function') { sock.ev.buffer = () => {}; s.sinBuffer = true; } } catch (e) { /* si no se puede, queda el vigilante de 30 s */ }
  // CAUSA REAL (19-11-2026, confirmada en el log de Railway: un lote de mensajes "append" cada ~40 s): en esta versión de Baileys cada
  // mensaje que entra llama a createBufferedFunction -> buffer() y ya NO se libera solo ("lo controla la máquina de estados", que
  // con la sincronización de historial apagada nunca vuelve a liberar). Resultado: el buffer queda retenido para siempre y los mensajes
  // solo salían cuando el vigilante los liberaba a la fuerza. Se libera cada 1 s mientras haya algo retenido: retraso máximo de 1 s.
  if (s.flusher) { try { clearInterval(s.flusher); } catch (e) { /* nada */ } }
  s.flusher = deps.setIntervalo(() => {
    try { if (s.sock === sock && sock.ev && typeof sock.ev.isBuffering === 'function' && sock.ev.isBuffering() && typeof sock.ev.flush === 'function') sock.ev.flush(); } catch (e) { /* nada */ }
  }, 1000);
  sock.ev.on('creds.update', () => { if (s.gen === gen && !s.requiereNuevoQr) return saveCreds(); });

  sock.ev.on('connection.update', (update) => {
    if (s.gen !== gen) return; // un socket viejo ya reemplazado
    const { connection, lastDisconnect, qr } = update;
    if (qr) { s.ultimoQr = qr; s.conectado = false; }
    if (connection === 'open') {
      s.conectado = true; s.ultimoQr = null; s.ultimoError = null; s.conectadoEn = new Date(deps.ahora()).toISOString(); s.eventos = 0; s.ultimoEvento = null;
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
        s.requiereNuevoQr = true;
        console.error('[whatsappSesionesGrupo] Grupo ' + id + ': ' + s.ultimoError);
        deps.alertar('🔴 LUDOX: se cayó el número propio de un grupo', 'El número propio del grupo ' + id + ' ya no está vinculado (WhatsApp cerró la sesión). Entra a Bot IA en el portal de Hipismo del grupo y vincúlalo de nuevo.');
      } else {
        const codigo = motivo && motivo.output ? motivo.output.statusCode : null;
        s.reconexiones = (s.reconexiones || 0) + 1; s.ultimoCodigo = codigo;
        const explicacion = { 440: 'la sesión se abrió en otro lugar (dos servidores usando el mismo número)', 515: 'WhatsApp pidió reiniciar la conexión (normal justo después de escanear el QR)', 428: 'WhatsApp cerró la conexión', 408: 'se agotó el tiempo de espera', 500: 'la sesión guardada está dañada', 503: 'WhatsApp no estaba disponible' }[codigo];
        console.log('[whatsappSesionesGrupo] Grupo ' + id + ': conexión cerrada (código ' + codigo + (explicacion ? ' — ' + explicacion : '') + '), reintentando.');
        s.ultimoError = 'Se perdió la conexión' + (codigo ? ' (código ' + codigo + (explicacion ? ': ' + explicacion : '') + ')' : '') + ', reintentando…';
        programarReintento(id, s, codigo === 440 ? ESPERA_CONFLICTO_MS : ESPERA_REINTENTO_MS);
      }
    }
  });

  sock.ev.on('messages.upsert', async (evento) => {
    if (s.gen !== gen) return;
    const n = (evento.messages || []).length;
    // Retraso: cuánto tardó en llegar a este servidor lo que escribieron (si crece, el problema está en WhatsApp/la librería, no en el bot).
    let retrasoMax = null;
    for (const m of (evento.messages || [])) {
      const t = m && m.messageTimestamp; const seg = t && typeof t === 'object' && typeof t.toNumber === 'function' ? t.toNumber() : Number(t);
      if (seg > 0) { const r = Math.round((deps.ahora() - seg * 1000) / 1000); if (retrasoMax === null || r > retrasoMax) retrasoMax = r; }
    }
    s.eventos = (s.eventos || 0) + n; s.ultimoEvento = { en: new Date().toISOString(), tipo: evento.type || null, n, retrasoSeg: retrasoMax };
    s.refrescos = 0; s.proximoRefresco = 0; // la conexión sí está entregando mensajes: se reinicia el vigilante
    console.log('[whatsappSesionesGrupo] Grupo ' + id + ': llegaron ' + n + ' mensaje(s) (tipo ' + (evento.type || '?') + (retrasoMax !== null ? ', el más viejo de hace ' + retrasoMax + ' s' : '') + ')');
    // Encola todo el lote antes de esperar; otro evento puede llegar enseguida.
    await Promise.all(require('./hipismoJugadasChatBot').mensajesEnOrden(evento.messages).map(async msg => {
      const t0 = deps.ahora();
      await manejarMensaje(id, sock, msg);
      const dur = deps.ahora() - t0;
      if (dur > 3000) console.error('[whatsappSesionesGrupo] Grupo ' + id + ': un mensaje tardó ' + Math.round(dur / 1000) + ' s en procesarse.');
    }));
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
  await db.query('UPDATE grupos SET whatsapp_propio_activo = false WHERE id = $1', [grupoId]);
}

// Al arrancar el servidor: levanta, de a una, las conexiones de los grupos que ya tenían número propio.
async function arrancarSesionesGuardadas() {
  let filas = [];
  try {
    const r = await db.query('SELECT id FROM grupos WHERE whatsapp_propio_activo = true AND activo = true');
    filas = r.rows;
  } catch (e) {
    if (!e || e.code !== '42703') {
      console.error('[whatsappSesionesGrupo] No se pudieron leer los grupos con número propio (se reintenta en 15 s):', e.message);
      deps.setTimeout(() => { arrancarSesionesGuardadas().catch(() => {}); }, 15000);
    }
    return 0;
  }
  asegurarLatido(); // el vigilante queda corriendo aunque este arranque falle
  for (const f of filas) {
    try { await iniciarSesion(f.id); }
    catch (e) {
      console.error('[whatsappSesionesGrupo] No se pudo arrancar el grupo ' + f.id + ' (se reintenta):', e.message);
      const st = sesiones.get(String(f.id));
      if (st && !st.cerrando) programarReintento(String(f.id), st, ESPERA_REINTENTO_MS * 2);
    }
    await deps.esperar(ESPERA_ENTRE_ARRANQUES_MS);
  }
  return filas.length;
}

module.exports = {
  iniciarSesion, reconectarSesion, desvincular, arrancarSesionesGuardadas, refrescarGrupos, apagar,
  estadoPublico, estaConectada, obtenerQr, carpetaDeSesion, enmascararNumero,
  _deps: deps, _sesiones: sesiones, _latido: latido, _reconciliar: reconciliar, _constantes: { SIN_MENSAJES_MS, REFRESCO_BASE_MS, REFRESCO_MAX_MS, TURNO_TTL_S }
};
