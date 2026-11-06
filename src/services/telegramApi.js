// =================================================================
// TELEGRAM — capa de comunicación con la API oficial de bots (08-10-2026).
//
// A diferencia de WhatsApp (Baileys: librería NO oficial que imita a WhatsApp
// Web, con riesgo real de baneo del número — le pasó al usuario el
// 18-09-2026), Telegram tiene una API de bots OFICIAL, gratuita y estable:
// no hay QR, no hay sesión que se caiga y un bot es un participante de pleno
// derecho del grupo. Por eso acá NO se necesita ninguna librería nueva: se usa
// el fetch global de Node 20+ (package.json ya exige Node >= 20).
//
// Este archivo solo habla con Telegram (getUpdates / sendMessage /
// getChatMember). Toda la lógica de negocio (sábanas, comandos, cálculo) vive
// en telegramBot.js y en los servicios que ya existían — nada de eso se toca.
// El fetch se puede inyectar para probar sin red (ver test_telegram_bot.js).
// =================================================================
const LIMITE_TELEGRAM = 4096; // máximo de caracteres por mensaje de Telegram
const LIMITE_TROZO = 3900;    // margen de seguridad (el HTML agrega etiquetas)

function escaparHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Los textos del sistema (planos, listados, avisos) usan el formato de WhatsApp:
// *negrita* y _cursiva_. Telegram no entiende eso tal cual (se vería el
// asterisco suelto), así que se convierte a HTML, que sí es estable. El resto
// del texto se escapa para que un "<" o "&" de un nombre nunca rompa el mensaje.
function formatearParaTelegram(texto) {
  const base = escaparHtml(texto);
  return base
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
}

// Parte un texto largo en trozos que entren en un mensaje de Telegram,
// cortando por líneas para no partir una jugada por la mitad.
function partirTexto(texto, max = LIMITE_TROZO) {
  const s = String(texto);
  if (s.length <= max) return [s];
  const trozos = [];
  let actual = '';
  for (const linea of s.split('\n')) {
    if (linea.length > max) {
      if (actual) { trozos.push(actual); actual = ''; }
      for (let i = 0; i < linea.length; i += max) trozos.push(linea.slice(i, i + max));
      continue;
    }
    const candidato = actual ? actual + '\n' + linea : linea;
    if (candidato.length > max) { trozos.push(actual); actual = linea; } else { actual = candidato; }
  }
  if (actual) trozos.push(actual);
  return trozos;
}

// Qué método de Telegram usar para un tipo de archivo (ver enviarArchivo).
function elegirMetodo(tipo) {
  const mime = String(tipo || '').split(';')[0].trim().toLowerCase();
  if (/^image\/(jpeg|jpg|png|webp)$/.test(mime)) return { metodo: 'sendPhoto', campo: 'photo' };
  if (mime === 'video/mp4') return { metodo: 'sendVideo', campo: 'video' };
  if (mime === 'audio/ogg' || mime === 'audio/opus') return { metodo: 'sendVoice', campo: 'voice' };
  if (mime === 'audio/mpeg' || mime === 'audio/mp3' || mime === 'audio/mp4' || mime === 'audio/x-m4a' || mime === 'audio/m4a') return { metodo: 'sendAudio', campo: 'audio' };
  return { metodo: 'sendDocument', campo: 'document' };
}

function crearClienteTelegram({ token, fetchImpl, esperarImpl } = {}) {
  const hacerFetch = fetchImpl || ((...a) => fetch(...a));
  const esperar = esperarImpl || (ms => new Promise(r => setTimeout(r, ms)));
  const base = 'https://api.telegram.org/bot' + token + '/';

  // Telegram limita a ~20 mensajes por minuto en un mismo grupo. El cierre de varios grupos manda muchos
  // seguidos al central: cuando Telegram responde 429 ("Too Many Requests", con retry_after), se espera lo
  // que pide y se reintenta, en vez de perder el mensaje (por ejemplo la foto del último grupo).
  const MAX_REINTENTOS_429 = 4;
  const ESPERA_MAX_429_S = 60;
  async function llamar(metodo, params = {}, opciones = {}) {
    for (let intento = 0; ; intento++) {
      try {
        return await llamarUnaVez(metodo, params, opciones);
      } catch (e) {
        if (e && e.codigo === 429 && intento < MAX_REINTENTOS_429) {
          const segundos = Math.min(Math.max(Number(e.reintentarEnSegundos) || 5, 1), ESPERA_MAX_429_S);
          console.log('[telegramApi] Telegram pidió esperar ' + segundos + 's (límite de mensajes) en ' + metodo + ' — reintento ' + (intento + 1) + '/' + MAX_REINTENTOS_429 + '.');
          await esperar(segundos * 1000 + 500);
          continue;
        }
        throw e;
      }
    }
  }

  async function llamarUnaVez(metodo, params = {}, { timeoutMs = 40000, formData = null } = {}) {
    if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN.');
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const temporizador = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const resp = await hacerFetch(base + metodo, {
        method: 'POST',
        // Con archivo (foto) va como multipart: el navegador/Node pone solo el content-type.
        headers: formData ? undefined : { 'content-type': 'application/json' },
        body: formData || JSON.stringify(params),
        signal: ctl ? ctl.signal : undefined
      });
      const datos = await resp.json();
      if (!datos || datos.ok !== true) {
        const err = new Error((datos && datos.description) || 'Telegram respondió con error.');
        err.codigo = datos && datos.error_code;
        err.reintentarEnSegundos = datos && datos.parameters && datos.parameters.retry_after;
        throw err;
      }
      return datos.result;
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  // Manda un texto (formato WhatsApp convertido a HTML), partido en varios
  // mensajes si es muy largo. Si Telegram rechaza el HTML, reintenta en texto
  // plano para que un aviso nunca se pierda por una etiqueta mal formada.
  // `opciones.threadId`: en un grupo con TEMAS (foro) el mensaje va dentro de ese tema (14-10-2026).
  async function enviarTexto(chatId, texto, opciones = {}) {
    const trozos = partirTexto(texto);
    const enviados = [];
    const tema = opciones && opciones.threadId ? { message_thread_id: Number(opciones.threadId) } : {};
    for (const trozo of trozos) {
      try {
        enviados.push(await llamar('sendMessage', { chat_id: chatId, ...tema, text: formatearParaTelegram(trozo), parse_mode: 'HTML', disable_web_page_preview: true }));
      } catch (e) {
        if (/parse entities|can't parse/i.test(e.message || '')) {
          enviados.push(await llamar('sendMessage', { chat_id: chatId, ...tema, text: trozo, disable_web_page_preview: true }));
        } else {
          throw e;
        }
      }
    }
    return enviados;
  }

  // Manda una foto (PNG en un Buffer) con un texto corto abajo. Si Telegram rechaza el
  // HTML del texto, reintenta sin formato para que la foto nunca se pierda.
  async function enviarFoto(chatId, buffer, caption) {
    const armar = (texto, conHtml) => {
      const f = new FormData();
      f.append('chat_id', String(chatId));
      if (texto) {
        f.append('caption', String(texto).slice(0, 1000));
        if (conHtml) f.append('parse_mode', 'HTML');
      }
      f.append('photo', new Blob([buffer], { type: 'image/png' }), 'saldos-semana.png');
      return f;
    };
    try {
      return await llamar('sendPhoto', {}, { timeoutMs: 60000, formData: armar(caption ? formatearParaTelegram(caption) : '', true) });
    } catch (e) {
      if (caption && /parse entities|can't parse/i.test(e.message || '')) {
        return await llamar('sendPhoto', {}, { timeoutMs: 60000, formData: armar(caption, false) });
      }
      throw e;
    }
  }

  // ARCHIVOS DEL CHAT (06-11-2026, a pedido del usuario: "cuando me envían un archivo adjunto por el chat, no me
  // cargan en el Telegram"): antes solo se avisaba con texto que había un adjunto. Ahora el archivo mismo viaja a
  // Telegram, con el método que mejor lo muestra: foto, video mp4, nota de voz (ogg/opus), audio (mp3/m4a) y, para
  // todo lo demás (PDF, Word, Excel, videos .mov/.webm, audios .webm), como documento.
  // `opciones`: { tipo, nombre, caption, threadId }.
  async function enviarArchivo(chatId, buffer, opciones = {}) {
    const mime = String(opciones.tipo || 'application/octet-stream').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    const nombre = String(opciones.nombre || 'archivo').slice(0, 120);
    const caption = opciones.caption || '';
    const armar = (metodo, campo, texto, conHtml) => {
      const f = new FormData();
      f.append('chat_id', String(chatId));
      if (opciones.threadId) f.append('message_thread_id', String(Number(opciones.threadId)));
      if (texto) {
        f.append('caption', String(texto).slice(0, 1000));
        if (conHtml) f.append('parse_mode', 'HTML');
      }
      f.append(campo, new Blob([buffer], { type: mime }), nombre);
      return f;
    };
    const mandar = async (m) => {
      try {
        return await llamar(m.metodo, {}, { timeoutMs: 90000, formData: armar(m.metodo, m.campo, caption ? formatearParaTelegram(caption) : '', true) });
      } catch (e) {
        if (caption && /parse entities|can't parse/i.test(e.message || '')) {
          return await llamar(m.metodo, {}, { timeoutMs: 90000, formData: armar(m.metodo, m.campo, caption, false) });
        }
        throw e;
      }
    };
    const primero = elegirMetodo(mime);
    try {
      return await mandar(primero);
    } catch (e) {
      // Si Telegram no acepta el formato como foto/video/voz (medidas, códec...), se manda igual como documento.
      if (primero.metodo === 'sendDocument' || /thread|topic|chat not found|bot was kicked|not enough rights/i.test(e.message || '')) throw e;
      return await mandar({ metodo: 'sendDocument', campo: 'document' });
    }
  }

  // ¿Quién escribió es administrador (o dueño) del grupo de Telegram? En un
  // chat privado siempre es "él mismo".
  async function esAdministrador(chatId, userId) {
    if (Number(chatId) > 0) return true;
    const m = await llamar('getChatMember', { chat_id: chatId, user_id: userId });
    return !!m && (m.status === 'creator' || m.status === 'administrator');
  }

  return {
    llamar,
    enviarTexto,
    enviarFoto,
    enviarArchivo,
    esAdministrador,
    // Crea un tema (un "chat" aparte) dentro de un grupo con Temas activados. Devuelve { message_thread_id, name, ... }.
    crearTemaForo: (chatId, nombre) => llamar('createForumTopic', { chat_id: chatId, name: String(nombre || 'Grupo').slice(0, 128) }),
    obtenerYo: () => llamar('getMe'),
    obtenerActualizaciones: (offset, timeoutSeg = 30) => llamar('getUpdates', { offset, timeout: timeoutSeg, allowed_updates: ['message', 'edited_message'] }, { timeoutMs: (timeoutSeg + 15) * 1000 }),
    quitarWebhook: () => llamar('deleteWebhook', { drop_pending_updates: false })
  };
}

module.exports = { elegirMetodo, crearClienteTelegram, formatearParaTelegram, partirTexto, escaparHtml, LIMITE_TELEGRAM };
