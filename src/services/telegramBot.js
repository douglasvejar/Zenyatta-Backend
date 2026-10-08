// =================================================================
// BOT DE TELEGRAM — sábana automática (08-10-2026, a pedido del usuario:
// "vamos a conectar el módulo de deportes a un Telegram para que me saque las
// sábanas automáticas y me calcule todo... Telegram sí podemos trabajar mejor
// que WhatsApp").
//
// NO reimplementa nada: es un "oído y boca" nuevo para el MISMO motor de
// sábanas que ya usa WhatsApp. Cada chat de Telegram se representa con un jid
// sintético "tg_<chatId>@g.us" y el bot manda al flujo existente
// (whatsappBot.manejarMensajeEntrante / manejarComando / procesarDiaAbierto)
// un "sock" falso cuyo único método sendMessage() escribe por la API de
// Telegram. Así el parser, el evaluador, los planos y los comandos son
// EXACTAMENTE los mismos y no hay nada que mantener por duplicado.
//
// Qué hace:
//   1. Lee "SABANA DE JUGADAS" / "SABANA DE JUGADAS FINAL" en el grupo de
//      Telegram vinculado, la importa y (si TELEGRAM_RESPONDER_SABANA no es
//      'false') responde al instante con el listado ya calculado.
//   2. Comandos de chat ("act", "saldo final", "corte semana", "saldo total
//      semana <nombre>") — SOLO los pueden mandar los ADMINISTRADORES del grupo
//      de Telegram (no hace falta cargar ningún número).
//   3. Cada TELEGRAM_RESUMEN_MINUTOS (15 por defecto) revisa los resultados en
//      vivo de los grupos con Telegram y, si algo cambió, manda la
//      actualización (mismas reglas de siempre: 1 vez por hora si hay cambios,
//      y el cierre apenas está todo resuelto tras "SABANA FINAL"). Se apaga con
//      TELEGRAM_RESUMEN_AUTOMATICO=false. (En WhatsApp esto se sacó por el
//      baneo del 18-09; Telegram es una API oficial, ese riesgo no existe.)
//   4. Avisos al dueño: si TELEGRAM_AVISOS_CHAT_ID está cargado, las alertas
//      del sistema (ver alertas.crearAlerta) le llegan por mensaje privado.
//
// GRUPO CENTRAL (08-10-2026, a pedido del usuario: "puedo tener en un grupo creado
// con mi otro teléfono... todos los grupos me lleguen allí? te enviaré la sábana de
// varios grupos, leerás al principio a qué grupo pertenece"): con
// TELEGRAM_CENTRAL_CHAT_ID=<id del grupo central> (el ID lo da /id escrito allí; se
// admiten varios separados por coma), el dueño manda ahí las sábanas de CUALQUIER
// grupo del programa con el NOMBRE del grupo en la primera línea:
//     ZENYATTA
//     SABANA DE JUGADAS
//     08-10-2026
//     ...jugadas
// El bot busca ese nombre entre los grupos con el servicio de Telegram contratado
// (sin importar mayúsculas ni tildes), carga la sábana en ESE grupo y responde en el
// central con el nombre del grupo arriba ("📍 ZENYATTA"). Los comandos funcionan igual
// con el nombre en la primera línea ("ZENYATTA" + "act"). Solo los ADMINISTRADORES del
// central pueden mandar ahí; si el nombre no calza (o calza con varios) no se carga
// nada y el bot lo dice. Los grupos que no tienen un grupo de Telegram propio
// vinculado reciben ahí también el resumen automático.
//
// Vincular un grupo: el Súper-admin prende el servicio y genera un código en el
// detalle del grupo; un administrador escribe en el grupo de Telegram
// "/vincular CODIGO" y el bot guarda solo el chat. Sin buscar IDs a mano.
//
// Telegram entrega los mensajes de dos formas; acá se usa "long polling"
// (getUpdates) para no necesitar dominio ni webhook. IMPORTANTE en BotFather:
// /setprivacy -> Disable, para que el bot vea los mensajes del grupo (si no,
// solo ve los comandos con "/").
//
// Un mensaje de Telegram admite máximo 4096 caracteres; una sábana más larga
// llega partida en varios mensajes seguidos — se juntan (ver recibirTexto)
// antes de procesarla.
//
// *** NO SE PUDO PROBAR CONTRA TELEGRAM REAL en el entorno donde se escribió
// (sin salida a api.telegram.org): se probó con un fetch falso en memoria (ver
// test_telegram_bot.js). La validación definitiva es la primera sábana real.
// =================================================================
const db = require('../db');
const { crearClienteTelegram } = require('./telegramApi');
const { detectarTriggerSabana, detectarComando, quitarTildes } = require('./whatsappTrigger');
const { grupoIdPorJid } = require('./sabanasPendientesWhatsapp');
const whatsappDiaEstado = require('./whatsappDiaEstado');
const { formatearFechaISO } = require('./historial');

const LONGITUD_MENSAJE_PARTIDO = 3500; // un mensaje así de largo probablemente sigue en el próximo

const estado = { activo: false, conectado: false, usuario: null, ultimoError: null, ultimaActualizacionEn: null };
let apiActual = null;
let sockActual = null;
let detenido = true;
let temporizadorResumen = null;
const buffers = new Map(); // "chat:user" -> { partes, temporizador }
const config = { esperaPartesMs: 2500 };

const jidDeChat = chatId => 'tg_' + chatId + '@g.us';
const chatDeJid = jid => String(jid).replace(/^tg_/, '').replace(/@g\.us$/, '');

// El único "sock" que necesita el motor de sábanas: sendMessage(jid, {text}).
function crearSock(api) {
  return {
    sendMessage: async (jid, contenido) => {
      if (!contenido || typeof contenido.text !== 'string') return;
      await api.enviarTexto(chatDeJid(jid), contenido.text);
    }
  };
}

function nombreDe(from) {
  if (!from) return null;
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || null;
}

function ctxPorDefecto(ctx) {
  return { api: (ctx && ctx.api) || apiActual, sock: (ctx && ctx.sock) || sockActual };
}

async function responder(api, chatId, texto) {
  try { await api.enviarTexto(chatId, texto); } catch (e) { console.error('[telegramBot] No se pudo responder en el chat ' + chatId + ':', e.message); }
}

// ---- "/vincular CODIGO" -------------------------------------------------
async function vincularChat(api, chatId, usuario, codigo) {
  const limpio = String(codigo || '').trim().toUpperCase();
  if (!limpio) {
    return responder(api, chatId, '⚠️ Escribe el código que te dio el administrador de la plataforma: */vincular CODIGO*');
  }
  let esAdmin = false;
  try { esAdmin = await api.esAdministrador(chatId, usuario.id); } catch (e) { esAdmin = false; }
  if (!esAdmin) {
    return responder(api, chatId, '⚠️ Solo un administrador del grupo de Telegram puede vincularlo.');
  }
  const r = await db.query('SELECT id, nombre FROM grupos WHERE telegram_codigo_vinculo = $1 AND telegram_habilitado = true', [limpio]);
  const grupo = r.rows[0];
  if (!grupo) {
    return responder(api, chatId, '⚠️ Ese código no es válido o ya se usó. Pídele al administrador de la plataforma uno nuevo.');
  }
  // Un chat solo puede estar vinculado a UN grupo del sistema.
  await db.query('UPDATE grupos SET telegram_chat_id = NULL WHERE telegram_chat_id = $1 AND id <> $2', [String(chatId), grupo.id]);
  await db.query('UPDATE grupos SET telegram_chat_id = $1, telegram_codigo_vinculo = NULL WHERE id = $2', [String(chatId), grupo.id]);
  console.log('[telegramBot] Chat ' + chatId + ' vinculado al grupo ' + grupo.id + '.');
  return responder(api, chatId, '✅ Listo: este grupo quedó vinculado a *' + grupo.nombre + '*. Desde ahora cada mensaje que empiece con *SABANA DE JUGADAS* (con la fecha en la línea de abajo) se carga y se calcula solo.');
}

// El grupo de Telegram pasó a "supergrupo": su ID cambia. Se actualiza solo.
async function migrarChat(viejo, nuevo) {
  await db.query('UPDATE grupos SET telegram_chat_id = $1 WHERE telegram_chat_id = $2', [String(nuevo), String(viejo)]);
  console.log('[telegramBot] El chat ' + viejo + ' migró a ' + nuevo + ' — vínculo actualizado.');
}

// ---- Grupo central: un chat para las sábanas de varios grupos --------
const idsCentrales = () => String(process.env.TELEGRAM_CENTRAL_CHAT_ID || '').split(',').map(x => x.trim()).filter(Boolean);
const esCentral = chatId => idsCentrales().includes(String(chatId));
const jidCentralDeGrupo = grupoId => 'tgc_' + grupoId + '@g.us';

// Sock que escribe SIEMPRE en el central, con el nombre del grupo arriba para que
// se sepa de cuál es cada mensaje (el jid que le pasa el motor se ignora).
function crearSockCentral(api, chatCentral, nombreGrupo) {
  return {
    sendMessage: async (_jid, contenido) => {
      if (!contenido || typeof contenido.text !== 'string') return;
      await api.enviarTexto(chatCentral, '📍 *' + String(nombreGrupo).toUpperCase() + '*\n' + contenido.text);
    }
  };
}

const normalizarNombre = t => quitarTildes(String(t || '').toLowerCase()).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const ES_LINEA_TRIGGER = /^\s*\**\s*SABANA\s+DE\s+JUGADAS\b/;

// Separa "NOMBRE DEL GRUPO" (líneas arriba) del resto. Devuelve null si el texto no
// trae un nombre arriba. Con "SABANA DE JUGADAS" abajo, `esSabana` es true.
function separarEncabezadoGrupo(texto) {
  const lineas = String(texto || '').split('\n');
  const noVacias = lineas.map((l, i) => ({ l: l.trim(), i })).filter(x => x.l);
  if (noVacias.length < 2) return null;
  const idxTrigger = lineas.findIndex(l => ES_LINEA_TRIGGER.test(quitarTildes(l).toUpperCase()));
  if (idxTrigger >= 1) {
    const arriba = noVacias.filter(x => x.i < idxTrigger);
    if (!arriba.length) return null;
    return { nombre: arriba[arriba.length - 1].l, cuerpo: lineas.slice(idxTrigger).join('\n'), esSabana: true };
  }
  if (idxTrigger === 0) return null;
  // Comando con el nombre del grupo arriba: "ZENYATTA" + "act".
  const primera = noVacias[0];
  const resto = lineas.slice(primera.i + 1).join('\n');
  if (detectarComando(resto)) return { nombre: primera.l, cuerpo: resto, esSabana: false };
  return null;
}

function resolverGrupoPorNombre(nombreCrudo, candidatos) {
  let buscado = normalizarNombre(nombreCrudo).replace(/^grupo /, '');
  if (!buscado) return { grupo: null, ambiguos: [] };
  const lista = candidatos.map(c => ({ ...c, norm: normalizarNombre(c.nombre) }));
  const exactos = lista.filter(c => c.norm === buscado || c.norm.replace(/^grupo /, '') === buscado);
  if (exactos.length === 1) return { grupo: exactos[0], ambiguos: [] };
  if (exactos.length > 1) return { grupo: null, ambiguos: exactos };
  if (buscado.length < 3) return { grupo: null, ambiguos: [] };
  const parecidos = lista.filter(c => c.norm.includes(buscado) || (c.norm.length >= 3 && buscado.includes(c.norm)));
  if (parecidos.length === 1) return { grupo: parecidos[0], ambiguos: [] };
  return { grupo: null, ambiguos: parecidos };
}

// Carga una sábana por el motor de siempre y, si de verdad se cargó, responde con
// el listado ya calculado ("que me calcule todo"). Sirve para el grupo vinculado
// y para el central: solo cambia el sock y el jid.
async function cargarSabanaYResponder(sock, jid, usuario, texto) {
  const whatsappBot = require('./whatsappBot');
  const sabana = detectarTriggerSabana(texto);
  const msg = { key: { remoteJid: jid, participant: 'tg_user_' + (usuario && usuario.id) }, message: { conversation: texto }, pushName: nombreDe(usuario) };
  const grupoId = await grupoIdPorJid(jid);
  const antes = grupoId && sabana.fecha ? await whatsappDiaEstado.obtenerEstadoDia(grupoId, sabana.fecha) : null;
  await whatsappBot.manejarMensajeEntrante(sock, msg);
  if (grupoId && sabana.fecha && process.env.TELEGRAM_RESPONDER_SABANA !== 'false') {
    const despues = await whatsappDiaEstado.obtenerEstadoDia(grupoId, sabana.fecha);
    const seCargo = despues && despues.ultimoTexto && (!antes || String(antes.ultimoTextoEn) !== String(despues.ultimoTextoEn) || antes.ultimoTexto !== despues.ultimoTexto);
    if (seCargo) {
      try {
        await whatsappBot.procesarDiaAbierto(sock, grupoId, jid, sabana.fecha, { forzar: true });
      } catch (e) {
        console.error('[telegramBot] Sábana cargada pero no se pudo mandar el listado:', e.message);
      }
    }
  }
}

// Devuelve true si el mensaje era para el grupo central y ya se atendió.
async function procesarEnCentral({ api }, chatId, usuario, texto) {
  const partes = separarEncabezadoGrupo(texto);
  if (!partes) return false;
  const whatsappBot = require('./whatsappBot');

  let esAdmin = false;
  try { esAdmin = await api.esAdministrador(chatId, usuario && usuario.id); } catch (e) { esAdmin = false; }
  if (!esAdmin) {
    console.log('[telegramBot] Mensaje del grupo central ignorado: quien lo mandó no es administrador.');
    return true;
  }

  const r = await db.query('SELECT id, nombre FROM grupos WHERE telegram_habilitado = true AND activo = true');
  const { grupo, ambiguos } = resolverGrupoPorNombre(partes.nombre, r.rows);
  if (!grupo) {
    const disponibles = r.rows.map(g => g.nombre).join(', ') || '(ninguno todavía: activa el servicio de Telegram en Súper-admin)';
    const motivo = ambiguos.length > 1
      ? '⚠️ "' + partes.nombre + '" calza con varios grupos (' + ambiguos.map(g => g.nombre).join(', ') + '). Escribe el nombre completo en la primera línea.'
      : '⚠️ No encontré ningún grupo llamado "' + partes.nombre + '". Escribe el nombre del grupo en la primera línea. Grupos disponibles: ' + disponibles + '.';
    await responder(api, chatId, motivo + '\nNo se cargó nada.');
    return true;
  }

  const sock = crearSockCentral(api, chatId, grupo.nombre);
  const jid = jidCentralDeGrupo(grupo.id);
  if (partes.esSabana) {
    await cargarSabanaYResponder(sock, jid, usuario, partes.cuerpo);
  } else {
    await whatsappBot.manejarComando(sock, grupo.id, jid, detectarComando(partes.cuerpo));
  }
  return true;
}

// ---- Procesa UN texto ya completo (una sábana entera o un comando) -----
async function procesarTexto({ api, sock }, chatId, usuario, texto) {
  const whatsappBot = require('./whatsappBot');
  const jid = jidDeChat(chatId);

  if (esCentral(chatId)) {
    const atendido = await procesarEnCentral({ api, sock }, chatId, usuario, texto);
    if (atendido) return;
  }

  if (detectarTriggerSabana(texto).esSabana) {
    return cargarSabanaYResponder(sock, jid, usuario, texto);
  }

  const comando = detectarComando(texto);
  if (!comando) return;
  const grupoId = await grupoIdPorJid(jid);
  if (!grupoId) return;
  let esAdmin = false;
  try { esAdmin = await api.esAdministrador(chatId, usuario && usuario.id); } catch (e) { esAdmin = false; }
  if (!esAdmin) {
    console.log('[telegramBot] Comando ignorado (chat ' + chatId + '): quien lo mandó no es administrador del grupo de Telegram.');
    return;
  }
  await whatsappBot.manejarComando(sock, grupoId, jid, comando);
}

// ---- Junta los mensajes partidos de una sábana larga -------------------
function recibirTexto(ctx, chatId, usuario, texto) {
  const clave = chatId + ':' + (usuario && usuario.id);
  const existente = buffers.get(clave);
  const vaciar = () => {
    const b = buffers.get(clave);
    if (!b) return;
    clearTimeout(b.temporizador);
    buffers.delete(clave);
    return procesarTexto(ctx, chatId, usuario, b.partes.join('\n')).catch(e => console.error('[telegramBot] Error al procesar un mensaje:', e));
  };

  if (existente) {
    existente.partes.push(texto);
    clearTimeout(existente.temporizador);
    if (texto.length >= LONGITUD_MENSAJE_PARTIDO) {
      existente.temporizador = setTimeout(vaciar, config.esperaPartesMs);
      return null;
    }
    return vaciar();
  }
  if (texto.length >= LONGITUD_MENSAJE_PARTIDO && (detectarTriggerSabana(texto).esSabana || (esCentral(chatId) && separarEncabezadoGrupo(texto)))) {
    const b = { partes: [texto], temporizador: null };
    b.temporizador = setTimeout(vaciar, config.esperaPartesMs);
    buffers.set(clave, b);
    return null;
  }
  return procesarTexto(ctx, chatId, usuario, texto);
}

// ---- Entrada: una actualización de Telegram -----------------------------
async function manejarActualizacion(update, ctxExterno) {
  const ctx = ctxPorDefecto(ctxExterno);
  const { api } = ctx;
  const mensaje = update && (update.message || update.edited_message);
  if (!mensaje || !mensaje.chat) return;

  if (mensaje.migrate_to_chat_id) {
    await migrarChat(mensaje.chat.id, mensaje.migrate_to_chat_id);
    return;
  }
  if (mensaje.from && mensaje.from.is_bot) return;
  const texto = mensaje.text || mensaje.caption;
  if (!texto) return;

  const chatId = mensaje.chat.id;
  const usuario = mensaje.from || null;
  const esPrivado = mensaje.chat.type === 'private';

  // Comandos propios con "/" (aceptan "/vincular@NombreDelBot").
  const cmd = texto.trim().match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (cmd) {
    const nombreCmd = cmd[1].toLowerCase();
    if (nombreCmd === 'id') {
      return responder(api, chatId, 'ID de este chat: *' + chatId + '*');
    }
    if (nombreCmd === 'start' || nombreCmd === 'help' || nombreCmd === 'ayuda') {
      return responder(api, chatId, esPrivado
        ? 'Hola 👋 Soy el bot de sábanas. Tu ID de chat es *' + chatId + '* (si quieres recibir aquí los avisos del sistema, ese número va en la variable TELEGRAM_AVISOS_CHAT_ID del servidor). Para vincular un grupo: agrégame al grupo y un administrador escribe */vincular CODIGO*.'
        : 'Hola 👋 Para vincular este grupo, un administrador escribe */vincular CODIGO* (el código lo genera el administrador de la plataforma).');
    }
    if (nombreCmd === 'vincular') {
      if (esPrivado) return responder(api, chatId, '⚠️ El vínculo se hace dentro del grupo de Telegram: agrégame al grupo y escribe ahí */vincular CODIGO*.');
      if (!usuario) return;
      return vincularChat(api, chatId, usuario, cmd[2]);
    }
    return; // cualquier otro "/algo" se ignora
  }

  if (esPrivado) return; // las sábanas y los comandos se atienden solo en el grupo vinculado
  return recibirTexto(ctx, chatId, usuario, texto);
}

// ---- Resumen automático -------------------------------------------------
async function revisarResumenesAutomaticos(ctxExterno) {
  const ctx = ctxPorDefecto(ctxExterno);
  const whatsappBot = require('./whatsappBot');
  const r = await db.query('SELECT id, nombre, telegram_chat_id FROM grupos WHERE telegram_habilitado = true AND activo = true');
  const fecha = formatearFechaISO(new Date());
  const central = idsCentrales()[0];
  for (const g of r.rows) {
    try {
      if (g.telegram_chat_id) {
        await whatsappBot.procesarDiaAbierto(ctx.sock, g.id, jidDeChat(g.telegram_chat_id), fecha, { forzar: false });
      } else if (central) {
        // Sin grupo de Telegram propio: el resumen sale en el central, con el nombre arriba.
        await whatsappBot.procesarDiaAbierto(crearSockCentral(ctx.api, central, g.nombre), g.id, jidCentralDeGrupo(g.id), fecha, { forzar: false });
      }
    } catch (e) {
      console.error('[telegramBot] Resumen automático falló (grupo ' + g.id + '):', e.message);
    }
  }
}

// ---- Avisos al dueño (mensaje privado) ----------------------------------
async function avisarPropietario(texto) {
  const destino = process.env.TELEGRAM_AVISOS_CHAT_ID;
  if (!destino || !apiActual) return { enviado: false };
  try {
    await apiActual.enviarTexto(destino, texto);
    return { enviado: true };
  } catch (e) {
    console.error('[telegramBot] No se pudo avisar al dueño:', e.message);
    return { enviado: false, motivo: e.message };
  }
}

// ---- Arranque / bucle ---------------------------------------------------
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function bucleDeLectura() {
  let offset;
  let espera = 2000;
  while (!detenido) {
    try {
      const novedades = await apiActual.obtenerActualizaciones(offset, 30);
      estado.conectado = true;
      estado.ultimoError = null;
      espera = 2000;
      for (const u of novedades) {
        offset = u.update_id + 1;
        estado.ultimaActualizacionEn = new Date().toISOString();
        try { await manejarActualizacion(u); } catch (e) { console.error('[telegramBot] Error con una actualización (se sigue con la próxima):', e); }
      }
    } catch (e) {
      estado.conectado = false;
      estado.ultimoError = e.message;
      if (e.codigo === 409) console.error('[telegramBot] Telegram dice que OTRO proceso ya está leyendo con este mismo bot (error 409). Solo puede haber una copia del servidor corriendo con el bot activado.');
      else console.error('[telegramBot] Falló la lectura de Telegram (reintenta en ' + espera / 1000 + 's):', e.message);
      await dormir(espera);
      espera = Math.min(espera * 2, 60000);
    }
  }
}

async function iniciarBotTelegram({ fetchImpl, token } = {}) {
  const tk = token || process.env.TELEGRAM_BOT_TOKEN;
  if (!tk) {
    console.log('[telegramBot] Falta TELEGRAM_BOT_TOKEN — el bot de Telegram no arranca.');
    return false;
  }
  apiActual = crearClienteTelegram({ token: tk, fetchImpl });
  sockActual = crearSock(apiActual);
  const yo = await apiActual.obtenerYo();
  estado.usuario = yo && yo.username;
  estado.activo = true;
  detenido = false;
  try { await apiActual.quitarWebhook(); } catch (e) { /* si no había webhook, nada que quitar */ }
  console.log('[telegramBot] Conectado como @' + estado.usuario + '.');

  if (process.env.TELEGRAM_RESUMEN_AUTOMATICO !== 'false') {
    const minutos = Number(process.env.TELEGRAM_RESUMEN_MINUTOS) || 15;
    temporizadorResumen = setInterval(() => {
      revisarResumenesAutomaticos().catch(e => console.error('[telegramBot] Resumen automático:', e.message));
    }, minutos * 60 * 1000);
    if (temporizadorResumen.unref) temporizadorResumen.unref();
  }
  bucleDeLectura();
  return true;
}

function detenerBotTelegram() {
  detenido = true;
  estado.activo = false;
  estado.conectado = false;
  if (temporizadorResumen) { clearInterval(temporizadorResumen); temporizadorResumen = null; }
  buffers.forEach(b => clearTimeout(b.temporizador));
  buffers.clear();
}

function obtenerEstadoTelegram() { return { ...estado }; }

// Para pruebas: arma el contexto con un cliente/sock inyectados.
function _usarCliente(api) { apiActual = api; sockActual = crearSock(api); return { api, sock: sockActual }; }

module.exports = {
  iniciarBotTelegram, detenerBotTelegram, obtenerEstadoTelegram,
  manejarActualizacion, revisarResumenesAutomaticos, avisarPropietario,
  jidDeChat, chatDeJid, crearSock, config, _usarCliente,
  separarEncabezadoGrupo, resolverGrupoPorNombre, esCentral
};
