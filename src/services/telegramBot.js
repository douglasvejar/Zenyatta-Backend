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
const { fechaVenezuelaHoy } = require('./fechaVenezuela');

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
      if (contenido && contenido.image) {
        return api.enviarFoto(chatDeJid(jid), contenido.image, contenido.caption || '');
      }
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
      if (contenido && contenido.image) {
        return api.enviarFoto(chatCentral, contenido.image, '📍 *' + String(nombreGrupo).toUpperCase() + '*' + (contenido.caption ? '\n' + contenido.caption : ''));
      }
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

// Respuesta cuando en el grupo central llega un comando/sábana sin el nombre del grupo en la 1ª línea.
async function textoFaltaNombreGrupo(texto) {
  let disponibles = '';
  try {
    const r = await db.query('SELECT id, nombre FROM grupos WHERE telegram_habilitado = true AND activo = true');
    disponibles = r.rows.map(g => g.nombre).join(', ');
  } catch (e) { /* sin lista, igual se explica el formato */ }
  const esSabana = detectarTriggerSabana(texto).esSabana;
  const ejemplo = esSabana ? 'NOMBRE DEL GRUPO\nSABANA DE JUGADAS\n09-10-2026\n...jugadas...' : 'NOMBRE DEL GRUPO\nact';
  return '⚠️ En el grupo central escribe el *nombre del grupo en la primera línea*, así:\n\n' + ejemplo +
    (disponibles ? '\n\nGrupos disponibles: ' + disponibles + '.' : '') + '\nNo se hizo nada.';
}

// ---- Procesa UN texto ya completo (una sábana entera o un comando) -----
async function procesarTexto({ api, sock }, chatId, usuario, texto) {
  const whatsappBot = require('./whatsappBot');
  const jid = jidDeChat(chatId);

  if (esCentral(chatId)) {
    const atendido = await procesarEnCentral({ api, sock }, chatId, usuario, texto);
    if (atendido) return;
    // Un comando o una sábana SIN el nombre del grupo arriba, escrito en el central: antes se
    // ignoraba en silencio (parecía que el bot no hacía nada). Ahora el administrador recibe la pista.
    if ((detectarComando(texto) || detectarTriggerSabana(texto).esSabana) && !(await grupoIdPorJid(jid))) {
      let esAdmin = false;
      try { esAdmin = await api.esAdministrador(chatId, usuario && usuario.id); } catch (e) { esAdmin = false; }
      if (esAdmin) await responder(api, chatId, await textoFaltaNombreGrupo(texto));
      return;
    }
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

// ---- CHAT DE SOPORTE <-> TELEGRAM (14-10-2026) -----------------------------
// A pedido del usuario: "cuando un grupo me envíe un mensaje por la bandeja de mensajes me llegue el
// mensaje al Telegram indicándome el grupo y yo poderle responder por allí y lo vea en la plataforma,
// así puedo tener una conversación más fluida en caso de no estar en la PC".
//   - Un Grupo escribe en su bandeja (services/chat.js, remitente 'grupo') -> llega al destino de avisos del
//     dueño (su chat privado con el bot o el grupo central) como "💬 MENSAJE — NOMBRE DEL GRUPO" + el texto.
//   - El dueño usa "Responder" (reply) sobre ese mensaje de Telegram -> se guarda como mensaje del
//     'superadmin' en el hilo de ESE grupo (el grupo lo ve en su bandeja y el panel de Súper-admin también).
// A qué grupo pertenece un mensaje se sabe por una memoria (id del mensaje de Telegram -> grupo) y, si el
// servidor se reinició y la memoria se perdió, por el nombre que va en la primera línea. Sin cambios de SQL.
const MARCA_CHAT = '💬 MENSAJE — ';
const grupoPorMensajeTelegram = new Map(); // "chat:message_id" -> { grupoId, nombre }
const claveMensaje = (chatId, messageId) => String(chatId) + ':' + String(messageId);

function describirAdjunto(m) {
  if (!m || !m.tiene_adjunto) return '';
  const tipo = String(m.adjunto_tipo || '');
  const que = tipo.startsWith('image/') ? 'una foto' : tipo.startsWith('video/') ? 'un video' : tipo.startsWith('audio/') ? 'una nota de voz' : 'un archivo';
  return '📎 Adjuntó ' + que + (m.adjunto_nombre && !tipo.startsWith('audio/') ? ' (' + m.adjunto_nombre + ')' : '') + ' — míralo en la plataforma.';
}

// UN CHAT POR GRUPO (14-10-2026, a pedido del usuario: "quiero que estos mensajes me lleguen individual por
// grupo, un chat por cada grupo que me escriba"): Telegram no deja que un bot cree chats privados, pero sí
// TEMAS dentro de un grupo propio (un supergrupo con "Temas" activados). Con TELEGRAM_SOPORTE_CHAT_ID=<id de ese
// grupo>, el bot crea UN TEMA por cada grupo que le escribe (con el nombre del grupo), manda ahí sus mensajes y
// todo lo que el dueño escriba dentro de ese tema le llega a ESA bandeja, sin tener que usar "Responder".
// El número del tema se guarda en grupos.telegram_soporte_tema_id (sql/pendiente-14-10-2026.sql); si esa columna
// todavía no existe, se recuerda en memoria (tras un reinicio se crearía otro tema).
const chatSoporte = () => String(process.env.TELEGRAM_SOPORTE_CHAT_ID || '').split(',')[0].trim() || null;
const temaDeGrupo = new Map();   // grupoId -> id del tema
const grupoDeTema = new Map();   // id del tema -> { grupoId, nombre }
const temasCreandose = new Map(); // grupoId -> Promise (evita crear 2 temas si llegan 2 mensajes juntos)
let avisadoSinColumnaTema = false;
const faltaColumnaTema = e => e && (e.code === '42703' || /telegram_soporte_tema_id/i.test(e.message || ''));

function recordarTema(grupoId, nombre, temaId) {
  temaDeGrupo.set(grupoId, temaId);
  grupoDeTema.set(String(temaId), { grupoId, nombre });
  if (grupoDeTema.size > 2000) grupoDeTema.delete(grupoDeTema.keys().next().value);
}
async function olvidarTema(grupoId) {
  const t = temaDeGrupo.get(grupoId);
  temaDeGrupo.delete(grupoId);
  if (t != null) grupoDeTema.delete(String(t));
  try { await db.query('UPDATE grupos SET telegram_soporte_tema_id = NULL WHERE id = $1', [grupoId]); } catch (e) { /* sin columna: nada que limpiar */ }
}
// Devuelve { temaId, nuevo }. Crea el tema la primera vez.
async function obtenerTemaDeGrupo(grupoId, nombre) {
  if (temaDeGrupo.has(grupoId)) return { temaId: temaDeGrupo.get(grupoId), nuevo: false };
  try {
    const r = await db.query('SELECT telegram_soporte_tema_id FROM grupos WHERE id = $1', [grupoId]);
    const guardado = r.rows[0] && r.rows[0].telegram_soporte_tema_id;
    if (guardado) { recordarTema(grupoId, nombre, Number(guardado)); return { temaId: Number(guardado), nuevo: false }; }
  } catch (e) {
    if (!faltaColumnaTema(e)) throw e;
    if (!avisadoSinColumnaTema) { avisadoSinColumnaTema = true; console.warn('[telegramBot] Falta la columna grupos.telegram_soporte_tema_id (corre el SQL pendiente): los temas del chat de soporte se recuerdan solo en memoria.'); }
  }
  if (temasCreandose.has(grupoId)) return temasCreandose.get(grupoId).then(r => ({ temaId: r.temaId, nuevo: false }));
  const promesa = (async () => {
    const tema = await apiActual.crearTemaForo(chatSoporte(), nombre);
    const temaId = Number(tema.message_thread_id);
    recordarTema(grupoId, nombre, temaId);
    try { await db.query('UPDATE grupos SET telegram_soporte_tema_id = $1 WHERE id = $2', [temaId, grupoId]); } catch (e) { if (!faltaColumnaTema(e)) console.error('[telegramBot] No se pudo guardar el tema del grupo:', e.message); }
    return { temaId, nuevo: true };
  })();
  temasCreandose.set(grupoId, promesa);
  try { return await promesa; } finally { temasCreandose.delete(grupoId); }
}

async function avisarMensajeEnTema({ grupoId, nombre, texto }) {
  const chat = chatSoporte();
  let { temaId, nuevo } = await obtenerTemaDeGrupo(grupoId, nombre);
  const mandar = async () => {
    if (nuevo) await apiActual.enviarTexto(chat, '💬 Este es el chat de *' + String(nombre).toUpperCase() + '*. Todo lo que escribas aquí le llega a su bandeja de mensajes.', { threadId: temaId });
    await apiActual.enviarTexto(chat, texto, { threadId: temaId });
  };
  try {
    await mandar();
  } catch (e) {
    // El tema se borró o se cerró desde Telegram: se crea de nuevo y se reenvía.
    if (!/thread not found|topic|TOPIC/i.test(e.message || '')) throw e;
    await olvidarTema(grupoId);
    ({ temaId, nuevo } = await obtenerTemaDeGrupo(grupoId, nombre));
    nuevo = true;
    await mandar();
  }
  return { enviado: true };
}

async function avisarMensajeDeGrupo({ grupoId, mensaje }) {
  const enTemas = !!chatSoporte();
  let destino = enTemas ? chatSoporte() : destinoAvisos();
  if (!destino || !apiActual) return { enviado: false };
  const r = await db.query('SELECT nombre FROM grupos WHERE id = $1', [grupoId]);
  const nombre = (r.rows[0] && r.rows[0].nombre) || 'GRUPO';
  if (enTemas) {
    const cuerpo = ['💬 *' + String(nombre).toUpperCase() + '*'];
    if (mensaje && mensaje.texto) cuerpo.push(mensaje.texto);
    const adjTema = describirAdjunto(mensaje);
    if (adjTema) cuerpo.push(adjTema);
    try {
      return await avisarMensajeEnTema({ grupoId, nombre, texto: cuerpo.join('\n') });
    } catch (e) {
      // El grupo de soporte falló (no tiene Temas activados, el bot no puede administrarlos, etc.): si hay un chat de
      // avisos, el mensaje sale ahí como siempre en vez de perderse.
      console.error('[telegramBot] No se pudo usar el grupo de soporte con temas (' + e.message + ').');
      destino = destinoAvisos();
      if (!destino) throw e;
    }
  }
  const partes = [MARCA_CHAT + String(nombre).toUpperCase()];
  if (mensaje && mensaje.texto) partes.push(mensaje.texto);
  const adj = describirAdjunto(mensaje);
  if (adj) partes.push(adj);
  partes.push('↩️ Responde a este mensaje para contestarle.');
  // El encabezado va en negrita para que se distinga; el texto del grupo se manda tal cual.
  const texto = partes[0].replace(/^(.*)$/, '*$1*') + '\n' + partes.slice(1).join('\n');
  const enviados = await apiActual.enviarTexto(destino, texto);
  (enviados || []).forEach(m => {
    if (!m || m.message_id == null) return;
    grupoPorMensajeTelegram.set(claveMensaje(destino, m.message_id), { grupoId, nombre });
    if (grupoPorMensajeTelegram.size > 1000) grupoPorMensajeTelegram.delete(grupoPorMensajeTelegram.keys().next().value);
  });
  return { enviado: true };
}

// Mensaje escrito DENTRO de un tema del grupo de soporte: va a la bandeja del grupo dueño de ese tema.
// Devuelve true si lo atendió (o lo ignoró a propósito), false si ese tema no es de ningún grupo.
async function responderDesdeTema({ api }, mensaje, texto) {
  const chatId = mensaje.chat.id;
  const temaId = mensaje.message_thread_id;
  const usuario = mensaje.from || null;
  let destino = grupoDeTema.get(String(temaId));
  if (!destino) {
    try {
      const r = await db.query('SELECT id, nombre FROM grupos WHERE telegram_soporte_tema_id = $1', [temaId]);
      if (r.rows[0]) { destino = { grupoId: r.rows[0].id, nombre: r.rows[0].nombre }; grupoDeTema.set(String(temaId), destino); temaDeGrupo.set(destino.grupoId, Number(temaId)); }
    } catch (e) { if (!faltaColumnaTema(e)) throw e; }
  }
  if (!destino) return false;
  let autorizado = false;
  try { autorizado = await api.esAdministrador(chatId, usuario && usuario.id); } catch (e) { autorizado = false; }
  if (!autorizado) return true;
  const opciones = { threadId: temaId };
  if (!texto) {
    await api.enviarTexto(chatId, '⚠️ Por ahora solo puedo enviarle al grupo mensajes de *texto*. Para mandarle una foto o un archivo, usa la plataforma.', opciones).catch(() => {});
    return true;
  }
  try {
    const chatService = require('./chat');
    await chatService.enviarMensaje(destino.grupoId, 'superadmin', texto);
    await chatService.marcarLeidosSuperadmin(destino.grupoId);
    await api.enviarTexto(chatId, '✅ Enviado', opciones).catch(() => {});
  } catch (e) {
    await api.enviarTexto(chatId, '⚠️ No se pudo enviar a ' + destino.nombre + ': ' + e.message, opciones).catch(() => {});
  }
  return true;
}

// Devuelve true si el mensaje era una respuesta a un aviso del chat de soporte (ya se atendió o se explicó
// por qué no), false si no tiene nada que ver y debe seguir el flujo normal.
async function responderChatDeGrupo({ api }, mensaje, texto) {
  const citado = mensaje.reply_to_message;
  const chatId = mensaje.chat.id;
  const usuario = mensaje.from || null;
  if (!citado || !citado.from || !citado.from.is_bot) return false;
  const conocido = grupoPorMensajeTelegram.get(claveMensaje(chatId, citado.message_id));
  const encabezado = String(citado.text || '').match(/^💬 MENSAJE — (.+)/);
  if (!conocido && !encabezado) return false;

  // Solo el dueño: su chat privado de avisos, o un administrador del grupo central.
  const esPrivadoDeAvisos = String(chatId) === String(process.env.TELEGRAM_AVISOS_CHAT_ID || '') && mensaje.chat.type === 'private';
  let autorizado = esPrivadoDeAvisos;
  if (!autorizado && esCentral(chatId)) {
    try { autorizado = await api.esAdministrador(chatId, usuario && usuario.id); } catch (e) { autorizado = false; }
  }
  if (!autorizado) return true; // alguien ajeno respondiendo: se ignora sin hacer nada

  if (!texto) {
    await responder(api, chatId, '⚠️ Por ahora solo puedo enviarle al grupo mensajes de *texto*. Para mandarle una foto o un archivo, usa la plataforma.');
    return true;
  }
  let destino = conocido;
  if (!destino) {
    const r = await db.query('SELECT id, nombre FROM grupos WHERE activo = true');
    const { grupo, ambiguos } = resolverGrupoPorNombre(encabezado[1], r.rows);
    if (!grupo) {
      await responder(api, chatId, ambiguos.length > 1
        ? '⚠️ No pude saber a cuál grupo responder (varios se llaman parecido). Responde desde la plataforma. No se envió nada.'
        : '⚠️ No encontré el grupo "' + encabezado[1] + '". Responde desde la plataforma. No se envió nada.');
      return true;
    }
    destino = { grupoId: grupo.id, nombre: grupo.nombre };
  }
  try {
    const chatService = require('./chat');
    await chatService.enviarMensaje(destino.grupoId, 'superadmin', texto);
    await chatService.marcarLeidosSuperadmin(destino.grupoId);
    await responder(api, chatId, '✅ Enviado a *' + String(destino.nombre).toUpperCase() + '* — lo verá en su bandeja de mensajes.');
  } catch (e) {
    await responder(api, chatId, '⚠️ No se pudo enviar a ' + destino.nombre + ': ' + e.message);
  }
  return true;
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
  // Escrito dentro de un tema del grupo de soporte (un chat por grupo): se manda a la bandeja de ese grupo.
  if (mensaje.message_thread_id && chatSoporte() && String(mensaje.chat.id) === chatSoporte() && !/^\s*\/\w+/.test(texto || '')) {
    if (await responderDesdeTema(ctx, mensaje, texto)) return;
  }
  // Respuesta (reply) a un aviso del chat de soporte: se manda a la bandeja de ese grupo.
  if (mensaje.reply_to_message && !/^\s*\/\w+/.test(texto || '')) {
    if (await responderChatDeGrupo(ctx, mensaje, texto)) return;
  }
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
        ? 'Hola 👋 Soy el bot de sábanas. Tu ID de chat es *' + chatId + '* (si quieres recibir aquí los avisos del sistema, ese número va en la variable TELEGRAM_AVISOS_CHAT_ID del servidor). Para vincular un grupo: agrégame al grupo y un administrador escribe */vincular CODIGO*. Cuando un grupo te escriba por su bandeja de mensajes, te llega aquí: responde (Reply) a ese mensaje y el grupo lo ve en la plataforma.'
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
  const fecha = fechaVenezuelaHoy(); // hora de Venezuela (UTC-4), no UTC
  const central = idsCentrales()[0];
  // Con SABANA FINAL + todo resuelto, el cierre sale completo (día + semana + foto) sin esperar la medianoche.
  const opciones = { forzar: false, cierreCompleto: process.env.TELEGRAM_CIERRE_NOCTURNO !== 'false' };
  for (const g of r.rows) {
    try {
      let r = null;
      if (g.telegram_chat_id) {
        r = await whatsappBot.procesarDiaAbierto(ctx.sock, g.id, jidDeChat(g.telegram_chat_id), fecha, opciones);
      } else if (central) {
        // Sin grupo de Telegram propio: el resumen sale en el central, con el nombre arriba.
        r = await whatsappBot.procesarDiaAbierto(crearSockCentral(ctx.api, central, g.nombre), g.id, jidCentralDeGrupo(g.id), fecha, opciones);
      }
      if (r && r.accion === 'ERROR') {
        await avisarProblema({
          grupoNombre: g.nombre,
          titulo: 'No pude revisar la sábana del ' + fecha.split('-').reverse().join('/') + ' con los resultados en vivo.',
          detalle: 'Motivo: ' + (r.error || 'error desconocido') + '\nLo sigo intentando cada ' + (Number(process.env.TELEGRAM_RESUMEN_MINUTOS) || 15) + ' minutos; si se repite, revisa la sábana en el panel.',
          clave: 'resumen|' + g.id + '|' + fecha + '|' + r.error
        });
      }
    } catch (e) {
      console.error('[telegramBot] Resumen automático falló (grupo ' + g.id + '):', e.message);
    }
  }
}

// ---- Cierre nocturno de todos los grupos ---------------------------------
// Cada grupo recibe su cierre donde ya recibe el resto (su chat de Telegram vinculado o, si no
// tiene, el central con el nombre arriba). El mensaje final de "todos resueltos" sale en el central
// (o, si no hay, en el chat de avisos del dueño).
async function revisarCierreNocturnoTelegram(ctxExterno) {
  const ctx = ctxPorDefecto(ctxExterno);
  const { revisarCierreNocturno, textoProblemaCierre } = require('./cierreNocturno');
  const central = idsCentrales()[0];
  const destinoFinal = central || process.env.TELEGRAM_AVISOS_CHAT_ID || null;
  const r = await db.query('SELECT id, telegram_chat_id FROM grupos WHERE telegram_habilitado = true AND activo = true');
  const chatPropio = new Map(r.rows.map(g => [g.id, g.telegram_chat_id]));
  return revisarCierreNocturno({
    fecha: ctxExterno && ctxExterno.fecha,
    destinoDe: g => {
      const propio = chatPropio.get(g.grupoId);
      if (propio) return { sock: ctx.sock, jid: jidDeChat(propio) };
      if (central) return { sock: crearSockCentral(ctx.api, central, g.nombre), jid: jidCentralDeGrupo(g.grupoId) };
      return null;
    },
    enviarFinal: destinoFinal ? (texto => ctx.api.enviarTexto(destinoFinal, texto)) : null,
    avisarProblema: ({ grupoNombre, grupoId, fecha, resultado }) => {
      const firma = resultado.accion === 'ERROR'
        ? String(resultado.error)
        : (resultado.detalle || []).map(d => d.cliente + '#' + d.ticket + ':' + d.estado).join(',');
      return avisarProblema({ texto: textoProblemaCierre({ grupoNombre, fecha, resultado }), grupoNombre, clave: 'cierre|' + grupoId + '|' + fecha + '|' + firma });
    }
  });
}

// ---- Avisos al dueño ------------------------------------------------------
// Van a su chat privado con el bot (TELEGRAM_AVISOS_CHAT_ID) y, si no lo configuró, al grupo central.
const destinoAvisos = () => process.env.TELEGRAM_AVISOS_CHAT_ID || idsCentrales()[0] || null;

async function avisarPropietario(texto) {
  const destino = destinoAvisos();
  if (!destino || !apiActual) return { enviado: false };
  try {
    await apiActual.enviarTexto(destino, texto);
    return { enviado: true };
  } catch (e) {
    console.error('[telegramBot] No se pudo avisar al dueño:', e.message);
    return { enviado: false, motivo: e.message };
  }
}

// PROBLEMAS (08-10-2026, a pedido del usuario: "si no puedes resolver una sabana o un juego debes
// enviarme un mensaje al telegram indicandome que pasa y con que grupo pasa"): un aviso con el grupo
// arriba, qué pasa y qué hacer. `clave` evita repetir el MISMO problema (los chequeos corren cada 15
// minutos): el mismo aviso no sale otra vez en 12 horas; si el problema cambia, la clave cambia y sí sale.
const avisosEnviados = new Map();
const REPETIR_AVISO_MS = 12 * 60 * 60 * 1000;
async function avisarProblema({ grupoNombre, titulo, detalle, clave, texto }) {
  const k = clave || (String(grupoNombre) + '|' + titulo + '|' + detalle);
  const antes = avisosEnviados.get(k);
  if (antes && Date.now() - antes < REPETIR_AVISO_MS) return { enviado: false, repetido: true };
  const cuerpo = texto || ('⚠️ *PROBLEMA' + (grupoNombre ? ' — ' + String(grupoNombre).toUpperCase() : '') + '*\n' + (titulo ? titulo + '\n' : '') + (detalle || ''));
  const r = await avisarPropietario(cuerpo);
  if (r.enviado) {
    avisosEnviados.set(k, Date.now());
    if (avisosEnviados.size > 500) avisosEnviados.delete(avisosEnviados.keys().next().value);
  }
  return r;
}

// Lo que recibe de whatsappBot (sábana que no se pudo leer, error inesperado): ubica el grupo por el jid y
// avisa. Si el mensaje venía del grupo central y los avisos van al central, no se repite (ya se le respondió allí).
async function notificarProblemaDeBot({ jid, grupoId, titulo, detalle, clave }) {
  const j = String(jid || '');
  if (!/^tgc?_/.test(j)) return; // solo lo que vino por Telegram
  const id = grupoId || await grupoIdPorJid(j);
  let nombre = null;
  if (id) {
    const r = await db.query('SELECT nombre FROM grupos WHERE id = $1', [id]);
    nombre = r.rows[0] && r.rows[0].nombre;
  }
  const chatOrigen = j.startsWith('tgc_') ? idsCentrales()[0] : chatDeJid(j);
  if (String(chatOrigen) === String(destinoAvisos())) return;
  return avisarProblema({ grupoNombre: nombre || (j.startsWith('tg_') ? 'chat ' + chatDeJid(j) : null), titulo, detalle, clave });
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
        try { await manejarActualizacion(u); } catch (e) {
          console.error('[telegramBot] Error con una actualización (se sigue con la próxima):', e);
          const chat = u && (u.message || u.edited_message) && (u.message || u.edited_message).chat;
          avisarProblema({
            grupoNombre: chat && (chat.title || String(chat.id)),
            titulo: 'Error inesperado al procesar un mensaje de Telegram.',
            detalle: 'Motivo: ' + e.message + '\nEse mensaje no se cargó: vuelve a mandarlo y, si se repite, avísame.',
            clave: 'telegram|' + e.message
          }).catch(() => {});
        }
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
  require('./whatsappBot').registrarNotificadorProblemas(notificarProblemaDeBot);
  require('./chat').registrarNotificadorMensajes(avisarMensajeDeGrupo);

  const resumenAuto = process.env.TELEGRAM_RESUMEN_AUTOMATICO !== 'false';
  const cierreNocturno = process.env.TELEGRAM_CIERRE_NOCTURNO !== 'false';
  if (resumenAuto || cierreNocturno) {
    const minutos = Number(process.env.TELEGRAM_RESUMEN_MINUTOS) || 15;
    temporizadorResumen = setInterval(() => {
      if (resumenAuto) revisarResumenesAutomaticos().catch(e => console.error('[telegramBot] Resumen automático:', e.message));
      // Pasada la medianoche de Venezuela: cierra los grupos cuya sábana de ayer ya está toda resuelta.
      if (cierreNocturno) revisarCierreNocturnoTelegram().catch(e => console.error('[telegramBot] Cierre nocturno:', e.message));
    }, minutos * 60 * 1000);
    if (temporizadorResumen.unref) temporizadorResumen.unref();
  }
  bucleDeLectura();
  return true;
}

function detenerBotTelegram() {
  try { require('./chat').registrarNotificadorMensajes(null); } catch (e) { /* nada que quitar */ }
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
  manejarActualizacion, avisarMensajeDeGrupo, responderChatDeGrupo, responderDesdeTema, revisarResumenesAutomaticos, revisarCierreNocturnoTelegram, avisarPropietario, avisarProblema, notificarProblemaDeBot,
  jidDeChat, chatDeJid, crearSock, crearSockCentral, config, _usarCliente,
  separarEncabezadoGrupo, resolverGrupoPorNombre, esCentral
};
