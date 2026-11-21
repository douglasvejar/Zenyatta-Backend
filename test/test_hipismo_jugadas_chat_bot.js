// =================================================================
// PRUEBA: bot de jugadas del chat de Hipismo CONECTADO a WhatsApp (17-11-2026): pasa por manejarMensajeEntrante de verdad,
// con base de datos y WhatsApp falsos. Revisa: servicio por grupo, identificar por número, administrador, guardado en
// "Jugadas entre Tercios Adelantadas", pozo corregido por lo que el bot ya confirmó, citar/mencionar al responder y plano desde la base.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const G = 'g1', JID = '120363000000000099@g.us';
const GRUPO = { id: G, nombre: 'Dream', activo: true, whatsapp_grupo_jid: JID, whatsapp_habilitado: true, hipismo_chat_habilitado: true, comandos_whatsapp_habilitado: true, comandos_whatsapp_numero: '+58 414 1111111' };
const T = {
  jugadores: [
    { nombre: 'CACHACO', telefono: '+57 323 3070494' }, { nombre: 'MARVEL', telefono: '0412-4537732' }, { nombre: 'NANA', telefono: '58 424 1746628' },
    { nombre: 'RICARDO', telefono: '+1 (904) 767-0886' }, { nombre: 'TYKHE', telefono: '+57 302 5932077' }
  ],
  numeros: [],
  hipodromos: [{ id: 'h1', nombre: 'Mountaineer' }, { id: 'h2', nombre: 'La Rinconada' }],
  planos: [], adelantadas: [], chat: [], estado: null, estadosPorChat: new Map(),
  // vista cómoda de lo que el bot guardó (lo que antes se escribía en adelantadas): ahora vive solo en hipismo_chat_jugadas (plano en espera)
  get jugadas() {
    return this.chat.map(c => { const a = JSON.parse(c.apuesta || 'null') || {}; return { jugador_nombre: c.jugador_nombre, banquero_nombre: c.banquero_nombre, monto: c.monto, carrera_numero: c.carrera_numero, es_cruce: !!a.cruce, modalidad: a.modalidad, cruce_grupo_a: a.cruce ? JSON.stringify(a.cruce.gruposA) : null, cruce_grupo_b: a.cruce ? JSON.stringify(a.cruce.gruposB) : null }; });
  }
};
let contador = 0;
function consulta(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return { rows: [] };
  if (/^SELECT id, nombre, comandos_whatsapp_habilitado, comandos_whatsapp_numero FROM grupos WHERE whatsapp_grupo_jid = \$1 AND whatsapp_habilitado = true AND hipismo_chat_habilitado = true AND activo = true/i.test(sql)) {
    return { rows: (params[0] === JID && GRUPO.hipismo_chat_habilitado) ? [GRUPO] : [] };
  }
  if (/FROM grupos WHERE id = \$1 AND \$2 = ANY/i.test(sql)) {
    const autorizado = GRUPO.whatsapp_propio_chats.includes(params[1]);
    return { rows: params[0] === G && autorizado && GRUPO.hipismo_chat_habilitado ? [GRUPO] : [] };
  }
  if (/^SELECT estado FROM hipismo_chat_estado_por_chat/i.test(sql)) {
    const estado = T.estadosPorChat.get(params[1]);
    return { rows: estado ? [{ estado }] : [] };
  }
  if (/^INSERT INTO hipismo_chat_estado_por_chat/i.test(sql)) {
    T.estadosPorChat.set(params[1], JSON.parse(params[2]));
    return { rows: [] };
  }
  if (/^SELECT hipismo_chat_plano_formato FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ hipismo_chat_plano_formato: T.formato || 'texto' }] };
  if (/^SELECT nombre, telefono FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: T.jugadores };
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND COALESCE\(es_cuenta_comision, false\) = false/i.test(sql)) return { rows: T.jugadores.map(j => ({ nombre: j.nombre })) };
  if (/^SELECT digitos, jugador_nombre FROM hipismo_chat_numeros WHERE grupo_id = \$1/i.test(sql)) return { rows: T.numeros.filter(x => x.grupo_id === params[0]) };
  if (/^INSERT INTO hipismo_chat_numeros/i.test(sql)) {
    const i = T.numeros.findIndex(x => x.grupo_id === params[0] && x.digitos === params[1]);
    const f = { grupo_id: params[0], digitos: params[1], jugador_nombre: params[2] };
    if (i >= 0) T.numeros[i] = f; else T.numeros.push(f);
    return { rows: [] };
  }
  if (/^SELECT nombre FROM hipismo_hipodromos WHERE grupo_id = \$1/i.test(sql)) return { rows: T.hipodromos };
  if (/^SELECT id FROM hipismo_hipodromos WHERE grupo_id = \$1 AND nombre = \$2/i.test(sql)) return { rows: T.hipodromos.filter(h => h.nombre === params[1]) };
  // El bot NO toca las tablas de adelantadas: si lo hiciera, la BD falsa lanzaría "consulta no prevista".
  if (T.fallar && /^INSERT INTO hipismo_chat_jugadas/i.test(sql)) throw new Error('fallo simulado');
  if (/^INSERT INTO hipismo_chat_jugadas/i.test(sql)) {
    T.chat.push({ id: 'c' + (++contador), grupo_id: params[0], fecha: params[1], hipodromo_nombre: params[2], carrera_numero: params[3], jugador_nombre: params[4], banquero_nombre: params[5], monto: params[6], riesgo_jugador: params[7], riesgo_banquero: params[8], texto_linea: params[9], apuesta: params[10], resuelta: false, cerrada_en: null, adelantada_jugada_id: null, creado_en: new Date() });
    return { rows: [{ id: T.chat[T.chat.length - 1].id }] };
  }
  // jugadas que esperan la pizarra y todavía descuentan saldo (carrera abierta, o cerrada hace menos de 10 min)
  if (/^SELECT c.jugador_nombre, c.banquero_nombre, c.monto, c.riesgo_jugador, c.riesgo_banquero, c.adelantada_jugada_id FROM hipismo_chat_jugadas c LEFT JOIN hipismo_tercios_adelantadas_jugadas a/i.test(sql)) {
    const ahora = Date.now();
    return { rows: T.chat.filter(c => (c.jugador_nombre === params[1] || c.banquero_nombre === params[1]) && !c.resuelta && !c.adelantada_jugada_id &&
      ((!c.cerrada_en && c.creado_en.getTime() > ahora - 3 * 3600e3) || (c.cerrada_en && new Date(c.cerrada_en).getTime() > ahora - 10 * 60e3))) };
  }
  if (/^SELECT c.jugador_nombre, c.banquero_nombre, c.monto, c.apuesta, a.es_cruce, a.grupo_caballos, a.cruce_grupo_a, a.cruce_grupo_b, a.modalidad FROM hipismo_chat_jugadas c LEFT JOIN/i.test(sql)) {
    return { rows: T.chat.filter(c => c.fecha === params[1] && c.hipodromo_nombre === params[2] && c.carrera_numero === params[3] && !c.resuelta) };
  }
  if (/^SELECT c.id, c.jugador_nombre, c.banquero_nombre, c.monto, c.apuesta FROM hipismo_chat_jugadas c WHERE/i.test(sql)) {
    return { rows: T.chat.filter(c => c.grupo_id === params[0] && c.fecha === params[1] && c.hipodromo_nombre === params[2] && c.carrera_numero === params[3] && !c.adelantada_jugada_id && !c.resuelta) };
  }
  if (/^DELETE FROM hipismo_chat_jugadas WHERE id = \$1 AND grupo_id = \$2 AND resuelta = false AND adelantada_jugada_id IS NULL RETURNING id/i.test(sql)) {
    const i = T.chat.findIndex(c => c.id === params[0] && c.grupo_id === params[1] && !c.resuelta && !c.adelantada_jugada_id);
    if (i < 0) return { rows: [] };
    const [f] = T.chat.splice(i, 1); return { rows: [{ id: f.id }] };
  }
  const mCierre = sql.match(/^UPDATE hipismo_chat_jugadas SET cerrada_en = (NULL|now\(\)|\$5::timestamptz) WHERE/i);
  if (mCierre) {
    T.chat.filter(c => c.grupo_id === params[0] && c.fecha === params[1] && c.hipodromo_nombre === params[2] && c.carrera_numero === params[3] && !c.resuelta && !c.adelantada_jugada_id && (mCierre[1] === 'NULL' || !c.cerrada_en))
      .forEach(c => { c.cerrada_en = mCierre[1] === 'NULL' ? null : params[4] || new Date(); });
    return { rows: [] };
  }
  if (/^UPDATE hipismo_chat_jugadas SET resuelta = true WHERE id = ANY\(\$1\)/i.test(sql)) {
    T.chat.filter(c => params[0].includes(c.id)).forEach(c => { c.resuelta = true; });
    return { rows: [] };
  }
  if (/^INSERT INTO hipismo_chat_estado/i.test(sql)) { T.estado = { hipodromo: params[1], carrera: params[2], abierta: params[3], fecha: params[4], ultimoComando: params[5] }; return { rows: [] }; }
  if (/^SELECT hipodromo, carrera, abierta, to_char\(fecha, 'YYYY-MM-DD'\) AS fecha, ultimo_comando AS "ultimoComando",/i.test(sql)) return { rows: T.estado ? [T.estado] : [] };
  if (/^(ALTER|create|do \$\$|alter)/i.test(sql)) return { rows: [] };
  throw new Error('BD falsa: consulta no prevista: ' + sql.slice(0, 160));
}
const fakePool = function () {
  this.query = async (t, p) => consulta(t, p);
  this.connect = async () => ({ query: async (t, p) => consulta(t, p), release() {} });
  this.on = () => {};
};
// pozo falso (el cálculo real del pozo ya tiene sus propias pruebas): disponible del sistema = pozo; el bot descuenta lo suyo en espera de pizarra
const POZO = { NANA: 20, RICARDO: 1000 };
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (/hipismoAlertaPozo$/.test(request)) {
    return { clientesConPozoDisponible: async (g, nombres) => nombres.filter(n => POZO[n] !== undefined).map(n => ({ jugador: { nombre: n }, base: POZO[n], disponible: POZO[n], pagoDiario: false })) };
  }
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
const whatsappBot = require(path.join(__dirname, '..', 'src', 'services', 'whatsappBot'));
const glue = require(path.join(__dirname, '..', 'src', 'services', 'hipismoJugadasChatBot')); // se carga ahora, con el pozo falso puesto
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
const check = (c, m) => { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } };
const enviados = [];
let seq = 0;
const sock = { user: { id: '573246161764:3@s.whatsapp.net', lid: '98765432100:3@lid' }, sendMessage: async (jid, contenido, opciones) => { const id = 'BOT' + (++seq); enviados.push({ jid, contenido, opciones, id }); return { key: { id, remoteJid: jid, fromMe: true } }; } };
const num = { CACHACO: '573233070494', MARVEL: '584124537732', NANA: '584241746628', RICARDO: '19047670886', ADMIN: '584141111111', DESCONOCIDO: '5999999999' };
let socioEsAdminWhatsApp = false;
sock.groupMetadata = async () => ({ participants: [
  { id: num.ADMIN + '@s.whatsapp.net', admin: 'superadmin' },
  { id: '44444444444@lid', admin: socioEsAdminWhatsApp ? 'admin' : null }
] });
const guardados = {};
function mensaje(quien, texto, citadoId, fromMe) {
  const id = 'W' + (++seq);
  const m = { key: { remoteJid: JID, participant: num[quien] + '@s.whatsapp.net', id, fromMe: !!fromMe }, pushName: quien, message: citadoId ? { extendedTextMessage: { text: texto, contextInfo: { stanzaId: citadoId } } } : { conversation: texto } };
  guardados[id] = m; return m;
}
const ultimo = () => enviados[enviados.length - 1];
const textoDe = e => e.contenido.text;

(async function main() {
  // servicio apagado: nada
  GRUPO.hipismo_chat_habilitado = false;
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Mountaineer 1ra carrera'));
  check(enviados.length === 0, 'con el servicio apagado en Súper-admin, el bot no hace nada');
  GRUPO.hipismo_chat_habilitado = true;

  // un jugador no puede abrir
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('CACHACO', 'Mountaineer 1ra carrera'));
  check(enviados.length === 1 && /no está autorizado para abrir carreras/.test(textoDe(ultimo())) && !/Carrera abierta/.test(textoDe(ultimo())), 'un jugador no puede abrir una carrera: el bot explica que su número no está autorizado (ya no se queda mudo)');
  // el administrador (número autorizado en Súper-admin) abre
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Mountaineer 1era carrera'));
  check(enviados.length === 2 && textoDe(ultimo()) === '*✅ Carrera abierta: Mountaineer, 1era Carrera.*\n*PARA QUE DINERO , VAMOS PONLE PONLE 🤑🤑*', 'el número autorizado abre "Mountaineer 1era carrera" y el bot confirma');

  // Cachaco publica 120
  const of = mensaje('CACHACO', 'Juego 4 x 1 10a8 con 120');
  await whatsappBot.manejarMensajeEntrante(sock, of);
  check(enviados.length === 2, 'publicar una jugada válida no genera mensaje');
  // Marvel responde 22 (se identifica por su teléfono 0412-4537732)
  const r1 = mensaje('MARVEL', '22', of.key.id);
  await whatsappBot.manejarMensajeEntrante(sock, r1);
  check(textoDe(ultimo()) === '✅ Aquí jugaron' && ultimo().opciones && ultimo().opciones.quoted === r1, 'responde "✅ Aquí jugaron" CITANDO el mensaje de Marvel');
  check(T.jugadas.length === 1 && T.jugadas[0].jugador_nombre === 'CACHACO' && T.jugadas[0].banquero_nombre === 'MARVEL' && Number(T.jugadas[0].monto) === 22 && T.jugadas[0].es_cruce === true && T.jugadas[0].modalidad === '10a8', 'quedó en espera de la pizarra: Cachaco 10a8 4x1 con 22 da Marvel');
  check(JSON.parse(T.jugadas[0].cruce_grupo_a)[0] === 4 && JSON.parse(T.jugadas[0].cruce_grupo_b)[0] === 1, 'los caballos 4 y 1 quedaron en su lugar');
  check(T.planos.length === 0 && T.adelantadas.length === 0 && T.chat[0].hipodromo_nombre === 'Mountaineer' && T.chat[0].carrera_numero === 1 && T.chat[0].resuelta === false && T.chat[0].adelantada_jugada_id === null, 'es un plano en espera de la pizarra (Mountaineer, carrera 1): NO se escribe ninguna jugada adelantada ni plano');
  check(T.chat.length === 1 && T.chat[0].riesgo_banquero === 17.6 && T.chat[0].riesgo_jugador === 22, 'se registró el riesgo de cada lado (banquero 22 x 80% = 17,60)');

  // FlowSport (NANA) tiene 20 de pozo: pide 25 a 10a8 => arriesga 20 => alcanza justo
  const r2 = mensaje('NANA', '25', of.key.id);
  await whatsappBot.manejarMensajeEntrante(sock, r2);
  check(T.jugadas.length === 2 && Number(T.jugadas[1].monto) === 25, 'Nana (con pozo 20) da 25 a 10a8: arriesga 20, alcanza justo');
  // ahora ya gastó su pozo: otra de 10 se le rechaza con aviso y mención
  const of2 = mensaje('RICARDO', 'Juego 4x1 con 50 doy a8');
  await whatsappBot.manejarMensajeEntrante(sock, of2);
  const r3 = mensaje('NANA', '10', of2.key.id);
  await whatsappBot.manejarMensajeEntrante(sock, r3);
  const av = ultimo();
  check(T.jugadas.length === 2 && /dispone de un saldo de 0,00/.test(textoDe(av)) && av.contenido.mentions && av.contenido.mentions[0] === num.NANA + '@s.whatsapp.net' && textoDe(av).startsWith('Saludos @' + num.NANA + ' (Nana)'), 'Nana ya no tiene pozo: no se registra, se le avisa y se la menciona con @' + num.NANA);

  // recibo: roles invertidos y guardado con caballos invertidos
  const of3 = mensaje('MARVEL', 'Juego 4x5 recibo a 8 200');
  await whatsappBot.manejarMensajeEntrante(sock, of3);
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('CACHACO', 'J', of3.key.id));
  const g = T.jugadas[2];
  check(g && g.jugador_nombre === 'CACHACO' && g.banquero_nombre === 'MARVEL' && Number(g.monto) === 200 && JSON.parse(g.cruce_grupo_a)[0] === 5 && JSON.parse(g.cruce_grupo_b)[0] === 4, '"recibo": quien responde J juega 5x4 con 200 y quien publicó da');

  // número que no es cliente
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('DESCONOCIDO', 'Juego 4x1 con 10 doy a8'));
  check(/no está registrado como cliente/.test(textoDe(ultimo())), 'un número que no está en ninguna ficha: se le avisa que no está registrado');

  // panel de Súper-admin: qué número vio el bot y si lo encontró en alguna ficha
  let notas = [];
  const mAnota = mensaje('MARVEL', 'Juego 4x1 con 10 doy a8');
  await glue.intentar({ sock, msg: mAnota, remoteJid: JID, texto: 'Juego 4x1 con 10 doy a8', ayudas: whatsappBot.crearAyudasJugadasChat(sock, mAnota), anotar: n => notas.push(n) });
  check(notas.some(n => /584124537732/.test(n) && /es el cliente MARVEL/.test(n)), 'el panel muestra el número que vio el bot y el cliente al que corresponde');
  notas = [];
  const mLid = { key: { remoteJid: JID, participant: '99999999999@lid', id: 'LID1', fromMe: false }, pushName: 'Tykhe', message: { conversation: 'Juego 4x1 con 10 doy a8' } };
  await glue.intentar({ sock, msg: mLid, remoteJid: JID, texto: 'Juego 4x1 con 10 doy a8', ayudas: whatsappBot.crearAyudasJugadasChat(sock, mLid), anotar: n => notas.push(n) });
  check(notas.some(n => /99999999999/.test(n) && /oculta/.test(n) && /ninguna ficha/.test(n)), 'si WhatsApp oculta el número, el panel lo explica y dice que ninguna ficha coincide');

  // número oculto (@lid): el administrador lo asocia a mano con "registrar NOMBRE" citando su mensaje
  const msgLid = { key: { remoteJid: JID, participant: '88888888888@lid', id: 'TYK1', fromMe: false }, pushName: 'Tykhe', message: { conversation: 'Juego 4x1 con 10 doy a8' } };
  const ayLid = () => whatsappBot.crearAyudasJugadasChat(sock, msgLid);
  await glue.intentar({ sock, msg: msgLid, remoteJid: JID, texto: 'Juego 4x1 con 10 doy a8', ayudas: ayLid() });
  check(/no está registrado como cliente/.test(textoDe(ultimo())) && /registrar NOMBRE_DEL_CLIENTE/.test(textoDe(ultimo())), 'un @lid sin asociar: se le avisa y se le da la pista al administrador');
  const regMsg = (texto, citar) => ({ key: { remoteJid: JID, participant: num.ADMIN + '@s.whatsapp.net', id: 'REG' + (++seq), fromMe: false }, pushName: 'Admin', message: citar ? { extendedTextMessage: { text: texto, contextInfo: { stanzaId: 'TYK1', participant: '88888888888@lid' } } } : { conversation: texto } });
  let mReg = regMsg('registrar tykhe', false);
  await glue.intentar({ sock, msg: mReg, remoteJid: JID, texto: 'registrar tykhe', ayudas: whatsappBot.crearAyudasJugadasChat(sock, mReg) });
  check(/Responde \(cita\) el mensaje/.test(textoDe(ultimo())) && T.numeros.length === 0, 'registrar sin citar el mensaje de la persona: pide citarlo y no guarda nada');
  mReg = regMsg('registrar nadie', true);
  await glue.intentar({ sock, msg: mReg, remoteJid: JID, texto: 'registrar nadie', ayudas: whatsappBot.crearAyudasJugadasChat(sock, mReg) });
  check(/No encontré ningún cliente/.test(textoDe(ultimo())) && /Clientes registrados: .*CACHACO.*MARVEL/.test(textoDe(ultimo())) && /créalo primero en \*Clientes\*/.test(textoDe(ultimo())) && T.numeros.length === 0, 'registrar un nombre que no existe: avisa, muestra la lista de clientes del grupo para elegir el nombre exacto y no guarda');
  const pideJugador = { key: { remoteJid: JID, participant: '88888888888@lid', id: 'TYK2', fromMe: false }, pushName: 'Tykhe', message: { extendedTextMessage: { text: 'registrar tykhe', contextInfo: { stanzaId: 'TYK1', participant: '88888888888@lid' } } } };
  await glue.intentar({ sock, msg: pideJugador, remoteJid: JID, texto: 'registrar tykhe', ayudas: ayLid() });
  check(T.numeros.length === 0, 'un jugador (no administrador) no puede registrar números');
  mReg = regMsg('registrar tykhe', true);
  await glue.intentar({ sock, msg: mReg, remoteJid: JID, texto: 'registrar tykhe', ayudas: whatsappBot.crearAyudasJugadasChat(sock, mReg) });
  check(/Listo: ese número quedó registrado como \*TYKHE\*/.test(textoDe(ultimo())) && T.numeros.length === 1 && T.numeros[0].digitos === '88888888888' && T.numeros[0].jugador_nombre === 'TYKHE', 'el administrador asocia el @lid con TYKHE y queda guardado');
  const antesT = enviados.length;
  const ofT = { key: { remoteJid: JID, participant: '88888888888@lid', id: 'TYK3', fromMe: false }, pushName: 'Tykhe', message: { conversation: 'Juego 4x1 con 10 doy a8' } };
  await glue.intentar({ sock, msg: ofT, remoteJid: JID, texto: 'Juego 4x1 con 10 doy a8', ayudas: ayLid() });
  check(enviados.length === antesT, 'Tykhe ya es reconocido: publicar su jugada no genera "no está registrado"');
  // el mismo cliente, pero ahora WhatsApp (tras reconectar) deja ver su teléfono real —distinto al de la ficha— junto al @lid: sigue reconocido por lo registrado
  const antesAlt = enviados.length;
  const ofAlt = { key: { remoteJid: JID, participant: '88888888888@lid', participantAlt: '5491155550000@s.whatsapp.net', id: 'TYK4', fromMe: false }, pushName: 'Tykhe', message: { conversation: 'Juego 4x1 con 10 doy a8' } };
  await glue.intentar({ sock, msg: ofAlt, remoteJid: JID, texto: 'Juego 4x1 con 10 doy a8', ayudas: whatsappBot.crearAyudasJugadasChat(sock, ofAlt) });
  check(enviados.length === antesAlt, 'aunque ahora se vea el teléfono real (distinto al de la ficha), el cliente registrado a mano sigue siendo reconocido por su código @lid');
  // el administrador responde al AVISO del bot (no al mensaje de la persona): se registra a la persona del aviso, no al bot
  const nNum = T.numeros.length;
  const ofW = { key: { remoteJid: JID, participant: '66666666666@lid', id: 'TYK5', fromMe: false }, pushName: 'Otro', message: { conversation: 'Juego 4x1 con 10 doy a8' } };
  T.numeros = T.numeros.filter(x => x.digitos !== '66666666666');
  await glue.intentar({ sock, msg: ofW, remoteJid: JID, texto: 'Juego 4x1 con 10 doy a8', ayudas: whatsappBot.crearAyudasJugadasChat(sock, ofW) });
  const aviso = ultimo();
  check(/no está registrado como cliente/.test(textoDe(aviso)) && /Responde a ESTE mensaje/.test(textoDe(aviso)), 'el aviso "no registrado" invita a responderlo con "registrar NOMBRE"');
  const regAviso = { key: { remoteJid: JID, participant: num.ADMIN + '@s.whatsapp.net', id: 'REG' + (++seq), fromMe: false }, pushName: 'Admin', message: { extendedTextMessage: { text: 'Registrar TYKHE', contextInfo: { stanzaId: aviso.id, participant: '573246161764@s.whatsapp.net' } } } };
  await glue.intentar({ sock, msg: regAviso, remoteJid: JID, texto: 'Registrar TYKHE', ayudas: whatsappBot.crearAyudasJugadasChat(sock, regAviso) });
  check(/Listo: ese número quedó registrado como \*TYKHE\*/.test(textoDe(ultimo())) && T.numeros.some(x => x.digitos === '66666666666' && x.jugador_nombre === 'TYKHE') && !T.numeros.some(x => x.digitos === '573246161764'), 'respondiendo al aviso del bot se registra a la persona del aviso, NO al número del bot');
  // citar un mensaje del propio bot que no es un aviso conocido: no registra nada
  const nAntesBot = T.numeros.length;
  const regBot = { key: { remoteJid: JID, participant: num.ADMIN + '@s.whatsapp.net', id: 'REG' + (++seq), fromMe: false }, pushName: 'Admin', message: { extendedTextMessage: { text: 'registrar tykhe', contextInfo: { stanzaId: 'MSG-VIEJO-DEL-BOT', participant: '573246161764@s.whatsapp.net' } } } };
  await glue.intentar({ sock, msg: regBot, remoteJid: JID, texto: 'registrar tykhe', ayudas: whatsappBot.crearAyudasJugadasChat(sock, regBot) });
  check(T.numeros.length === nAntesBot && /No sé a quién registrar/.test(textoDe(ultimo())), 'citar un mensaje cualquiera del bot no registra al bot como cliente: pide citar a la persona');
  // aunque llegue el número del bot por otro camino, se rechaza
  const rBot = await glue._registrarNumeroManual(G, { jid: '98765432100@lid', nombre: 'tykhe' }, () => sock);
  check(rBot.ok === false && /propio bot/.test(rBot.motivo), 'el número (o @lid) del propio bot nunca se asocia a un cliente');
  // La autorización interna del bot y la de WhatsApp son independientes.
  const jugadorQuiere = { key: { remoteJid: JID, participant: '44444444444@lid', id: 'ADM1', fromMe: false }, pushName: 'Socio', message: { conversation: 'Abierta 2da de mountaineer' } };
  const ayS = () => whatsappBot.crearAyudasJugadasChat(sock, jugadorQuiere);
  await glue.intentar({ sock, msg: jugadorQuiere, remoteJid: JID, texto: 'Abierta 2da de mountaineer', ayudas: ayS() });
  const avisoAdm = ultimo();
  check(/no está autorizado para abrir carreras/.test(textoDe(avisoAdm)) && /administradores de este grupo de WhatsApp/.test(textoDe(avisoAdm)), 'alguien que no es administrador intenta abrir: se le dice que debe ser administrador de WhatsApp');
  const autor = { key: { remoteJid: JID, participant: num.ADMIN + '@s.whatsapp.net', id: 'AUT1', fromMe: false }, pushName: 'Admin', message: { extendedTextMessage: { text: 'autorizar', contextInfo: { stanzaId: avisoAdm.id, participant: '573246161764@s.whatsapp.net' } } } };
  await glue.intentar({ sock, msg: autor, remoteJid: JID, texto: 'autorizar', ayudas: whatsappBot.crearAyudasJugadasChat(sock, autor) });
  check(/ahora es administrador/.test(textoDe(ultimo())) && T.numeros.some(x => x.digitos === '44444444444' && x.jugador_nombre === '__ADMIN__'), 'el administrador responde "autorizar" al aviso y esa persona queda como administrador');
  const jugadorAbre = { key: { remoteJid: JID, participant: '44444444444@lid', id: 'ADM2', fromMe: false }, pushName: 'Socio', message: { conversation: 'Abierta 2da de mountaineer' } };
  await glue.intentar({ sock, msg: jugadorAbre, remoteJid: JID, texto: 'Abierta 2da de mountaineer', ayudas: whatsappBot.crearAyudasJugadasChat(sock, jugadorAbre) });
  check(T.estado.carrera === 1, 'autorizar dentro del bot no concede permiso para abrir carreras');
  socioEsAdminWhatsApp = true;
  await glue.intentar({ sock, msg: jugadorAbre, remoteJid: JID, texto: 'Abierta 2da de mountaineer', ayudas: whatsappBot.crearAyudasJugadasChat(sock, jugadorAbre) });
  check(/Carrera abierta: Mountaineer, 2da Carrera\.\*/.test(textoDe(ultimo())), 'la persona autorizada ya puede abrir carreras (aunque WhatsApp oculte su teléfono)');
  socioEsAdminWhatsApp = false;
  const jugadorCierra = { ...jugadorAbre, key: { ...jugadorAbre.key, id: 'ADM3' } };
  await glue.intentar({ sock, msg: jugadorCierra, remoteJid: JID, texto: 'cerrar', ayudas: whatsappBot.crearAyudasJugadasChat(sock, jugadorCierra) });
  check(T.estado.abierta, 'si WhatsApp quita el rol de administrador, el miembro ya no puede cerrar una carrera');
  await glue.intentar({ sock, msg: jugadorCierra, remoteJid: JID, texto: 'Pizarra 3.1.2.4', ayudas: whatsappBot.crearAyudasJugadasChat(sock, jugadorCierra) });
  check(T.estado.abierta, 'una pizarra de alguien sin rol de WhatsApp tampoco puede cerrar la carrera');
  await glue.intentar({ sock, msg: { key: { remoteJid: JID, participant: num.ADMIN + '@s.whatsapp.net', id: 'AB1', fromMe: false }, message: { conversation: 'Mountaineer 1era carrera' } }, remoteJid: JID, texto: 'Mountaineer 1era carrera', ayudas: whatsappBot.crearAyudasJugadasChat(sock, { key: { remoteJid: JID, participant: num.ADMIN + '@s.whatsapp.net' } }) });
  check(!T.numeros.some(x => x.jugador_nombre === '__ADMIN__' && x.digitos === '573246161764'), 'el número del propio bot nunca queda como administrador autorizado');
  // un administrador registrado no es tomado por cliente
  check(await glue.clientePorNumero(G, '44444444444@lid') === null, 'un administrador autorizado no se confunde con un cliente');
  let notasT = [];
  await glue.intentar({ sock, msg: ofT, remoteJid: JID, texto: 'Juego 4x1 con 10 doy a8', ayudas: ayLid(), anotar: n => notasT.push(n) });
  check(notasT.some(n => /es el cliente TYKHE/.test(n)), 'el panel muestra que ese número es el cliente TYKHE');

  // vigencia de 3 minutos con la hora real del mensaje de WhatsApp (messageTimestamp, en segundos)
  const mT = (quien, texto, citadoId, seg, extraCtx) => {
    const id = 'W' + (++seq);
    const m = { key: { remoteJid: JID, participant: num[quien] + '@s.whatsapp.net', id, fromMe: false }, pushName: quien, messageTimestamp: seg,
      message: citadoId ? { extendedTextMessage: { text: texto, contextInfo: { stanzaId: citadoId, ...(extraCtx || {}) } } } : { conversation: texto } };
    guardados[id] = m; return m;
  };
  const base = 1800000000;
  const ofV = mT('CACHACO', 'Juego 4x1 con 20 doy a8', null, base);
  await whatsappBot.manejarMensajeEntrante(sock, ofV);
  const nJug = T.jugadas.length;
  await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', '10', ofV.key.id, base + 200));
  check(T.jugadas.length === nJug && /🚨 ❌ Aquí nada\. La sentencia llegó después de 3 minutos\. Quien publicó la parada tiene 1 minuto para responder \*OK\* citando este aviso o la respuesta\.$/.test(textoDe(ultimo())) && ultimo().contenido.mentions?.length === 2, 'con la hora real de WhatsApp: respondieron 200 s después y el bot solicita confirmación');
  const ofV2 = mT('CACHACO', 'Juego 4x1 con 20 doy a8', null, base + 300);
  await whatsappBot.manejarMensajeEntrante(sock, ofV2);
  await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', '10', ofV2.key.id, base + 300 + 100));
  check(T.jugadas.length === nJug + 1 && enviados.slice(-2).some(e => textoDe(e) === '✅ Aquí jugaron'), 'respondieron a los 100 s: "Aquí jugaron"');
  // el bot no conocía la parada (reinicio): lo dice en vez de quedarse callado
  await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', '10', 'ID-QUE-EL-BOT-NO-VIO', base + 400, { quotedMessage: { conversation: 'Juego 3n del 1 400' } }));
  check(/Aquí nada, esa parada ya no está activa/.test(textoDe(ultimo())), 'respuesta a una parada que el bot no vio: avisa en vez de quedarse mudo (usa el texto citado)');
  // un error interno ya no deja al bot mudo
  const antesErr = enviados.length;
  const oldQ = glue._sesiones.values().next().value.motor;
  const ofE = mT('CACHACO', 'Juego 4x1 con 20 doy a8', null, base + 500);
  await whatsappBot.manejarMensajeEntrante(sock, ofE);
  const antesNum = T.jugadas.length;
  T.fallar = true;
  await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', '10', ofE.key.id, base + 510));
  T.fallar = false;
  check(enviados.length === antesErr + 1 && /error interno/.test(textoDe(ultimo())) && T.jugadas.length === antesNum, 'si algo falla por dentro, el bot avisa en el grupo en vez de quedarse mudo');

  // plano desde la base de datos
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'plano'));
  const plano = textoDe(ultimo());
  check(/^\*🇻🇪🏇🏟️DREAM🏟️🏇🇻🇪\*/.test(plano) && /Mountaineer, 1ra Carrera/.test(plano) && /^Juega Cachaco 10A8 \(4x1\) con 22,00 da Marvel/m.test(plano) && /Juega Cachaco 10A8 \(5x4\) con 200,00 da Marvel/.test(plano) && new RegExp('Total Jugadas: ' + T.jugadas.length + '\n').test(plano), 'el plano sale de las jugadas guardadas, con su "Total jugadas"');

  // el servidor se reinicia con la carrera abierta: se retoma desde la base y se sigue jugando
  glue._sesiones.clear();
  const antesR = enviados.length;
  const ofR = mensaje('CACHACO', 'Juego 4x1 con 15 doy a8');
  await whatsappBot.manejarMensajeEntrante(sock, ofR);
  check(enviados.length === antesR, 'tras un reinicio la carrera sigue abierta: publicar una jugada no genera "no hay carrera abierta"');
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('MARVEL', '5', ofR.key.id));
  check(textoDe(ultimo()) === '✅ Aquí jugaron', 'y las respuestas se registran como siempre');
  const stReal = global.setTimeout; const avisosPizarra = [];
  global.setTimeout = (fn, ms, ...a) => { if (ms === 605000) { avisosPizarra.push(fn); return { unref() {} }; } return stReal(fn, ms, ...a); };
  const nEsperaAntes = T.chat.filter(c => !c.resuelta).length;
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Cerrado'));
  global.setTimeout = stReal;
  check(avisosPizarra.length === 1 && T.chat.length > 0 && T.chat.every(c => c.cerrada_en), 'al cerrar la carrera se anota la hora de cierre de las jugadas en espera y se programa el aviso de los 10 minutos');
  // tope por saldo: mientras espera la pizarra, la jugada de Nana (da 25 a 10a8 = arriesga 20 de su pozo de 20) descuenta; a los 10 min sin pizarra se libera
  const dNana = await glue.disponibleDe(G, 'NANA');
  check(dNana.limitado && dNana.disponible === 0, 'esperando la pizarra, lo que arriesga Nana (20 de su pozo de 20) sigue descontado: le queda 0,00');
  T.chat.forEach(c => { c.cerrada_en = new Date(Date.now() - 15 * 60e3); });
  const dNana2 = await glue.disponibleDe(G, 'NANA');
  check(dNana2.disponible === 20, 'pasados 10 minutos sin pizarra, esas jugadas dejan de descontar: Nana vuelve a tener sus 20');
  const antesAv = enviados.length;
  await avisosPizarra[0]();
  check(enviados.length === antesAv + 1 && /lleva más de 10 minutos esperando la pizarra/.test(textoDe(ultimo())) && /Mountaineer, 1ª carrera/.test(textoDe(ultimo())), 'a los 10 minutos sin pizarra el bot avisa en el grupo que ya no descuentan saldo');
  T.chat.forEach(c => { c.cerrada_en = new Date(); });
  glue._sesiones.clear();
  const ofC = mensaje('CACHACO', 'Juego 4x1 con 15 doy a8');
  await whatsappBot.manejarMensajeEntrante(sock, ofC);
  check(/no hay una carrera abierta/i.test(textoDe(ultimo())), 'si la carrera estaba cerrada antes del reinicio, sigue cerrada');

  // mensajes del propio bot no se vuelven a procesar
  const antes = enviados.length;
  await whatsappBot.manejarMensajeEntrante(sock, { key: { remoteJid: JID, participant: num.ADMIN + '@s.whatsapp.net', id: ultimo().id, fromMe: true }, message: { conversation: 'plano' } });
  check(enviados.length === antes, 'lo que escribió el propio bot no se procesa otra vez');

  // la sábana sigue su camino (no la toca el bot)
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('CACHACO', 'hola buenas'));
  check(enviados.length === antes, 'una charla cualquiera no genera respuesta');

  // ---------- PIZARRA desde el chat (el cálculo real vive en el manejador de Cargar Planos: aquí se prueba con uno falso) ----------
  const llamadasPlano = [];
  // Forma REAL de la respuesta de guardar (POST /planos): el texto va en plano.texto_resultado (no hay textoResultado).
  let respuestaPlano = { status: 201, body: { plano: { texto_resultado: '*Sistema Dream*\nGANAN: Marvel\nPIERDEN: Cachaco' }, datosImagen: null } };
  glue._ext.guardarPlano = async (g, body) => { llamadasPlano.push({ g, body }); return respuestaPlano; };
  // si el cálculo falla (p. ej. ya había plano), las jugadas siguen en espera: no se marcan como calculadas
  respuestaPlano = { status: 409, body: { error: 'YA TIENES UN PLANO REGISTRADO EN ESTA CARRERA.', planoYaRegistrado: true } };
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4'));
  check(T.chat.every(c => !c.resuelta), 'si Cargar Planos no pudo guardar, las jugadas del bot siguen en espera (no se pierden)');
  llamadasPlano.length = 0;
  respuestaPlano = { status: 201, body: { plano: { texto_resultado: '*Sistema Dream*\nGANAN: Marvel\nPIERDEN: Cachaco' }, datosImagen: null } };
  const pubPizarra = enviados.length;
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4 Ret 7'));
  const cuerpo = llamadasPlano[0] && llamadasPlano[0].body;
  const lineasPlano = (cuerpo.texto || '').split('\n');
  check(lineasPlano.length === nEsperaAntes && lineasPlano.every(l => /^Juega \S+ 10A8 \((4x1|5x4)\) con \d+,\d\d da \S+$/.test(l)) && lineasPlano[0] === 'Juega CACHACO 10A8 (4x1) con 22,00 da MARVEL', 'el bot pega en Cargar Planos el MISMO texto que pegaría el empleado: una línea "Juega X 10A8 (4x1) con M da Y" por cada parada confirmada');
  check(llamadasPlano.length === 1 && llamadasPlano[0].g === G && cuerpo.pizarra === '3.1.2.4' && cuerpo.ret === '7' && cuerpo.hipodromoNombre === 'Mountaineer' && cuerpo.carreraNumero === 1, 'el administrador escribe "Pizarra 3.1.2.4 Ret 7": el bot calcula la carrera (como Calcular + Confirmar plano) con la llegada y los retirados');
  check(enviados.length === pubPizarra + 2 && /Pizarra cargada: \*Mountaineer, 1era Carrera\*/.test(textoDe(enviados[pubPizarra])) && /GANAN: Marvel/.test(textoDe(ultimo())), 'el bot avisa y publica en el grupo el plano con quién gana y quién pierde');
  check(T.chat.every(c => c.resuelta) && T.adelantadas.length === 0, 'al guardarse el plano (201) las jugadas del bot quedan calculadas y siguen sin existir como adelantadas');
  check((await glue.disponibleDe(G, 'NANA')).disponible === 20, 'ya calculadas, dejan de descontar del saldo (a partir de ahí lo lleva el sistema con el plano normal)');
  respuestaPlano = { status: 409, body: { error: 'YA TIENES UN PLANO REGISTRADO EN ESTA CARRERA.', planoYaRegistrado: true } };
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4'));
  check(/No pude cargar la pizarra: esa carrera ya tiene un plano registrado/.test(textoDe(ultimo())), 'si la carrera ya tenía plano, el bot lo explica (hay que borrarlo en Eliminar Planos)');
  respuestaPlano = { status: 400, body: { error: 'Falta el texto del plano.' } };
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4'));
  check(/no encontré jugadas pendientes del bot/.test(textoDe(ultimo())), 'si no había jugadas pendientes del bot, lo dice');
  respuestaPlano = { status: 400, body: { error: 'Hipódromo no encontrado.' } };
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4'));
  check(/No pude cargar la pizarra: Hipódromo no encontrado/.test(textoDe(ultimo())), 'cualquier otro error del sistema se muestra tal cual');

  // ---------- Plano resuelto en IMAGEN o en TEXTO según el grupo (18-11-2026) ----------
  T.formato = 'imagen';
  const PNG = Buffer.from('PNG-FALSO');
  const pedidosImagen = [];
  const generarOriginal = glue._ext.generarImagen;
  glue._ext.generarImagen = async (g, datos) => { pedidosImagen.push({ g, datos }); return PNG; };
  respuestaPlano = { status: 201, body: { plano: { texto_resultado: '*Sistema Dream*\nGANAN: Marvel' }, datosImagen: { grupo: 'Dream', textoAcompanante: '*TOTALES 1ERA CARRERA DE MOUNTAINEER, GRUPO DREAM* 💰🏇' } } };
  const antesImg = enviados.length;
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4'));
  check(pedidosImagen.length === 1 && pedidosImagen[0].g === G && pedidosImagen[0].datos.grupo === 'Dream', 'con el grupo en "imagen" el bot dibuja la tarjeta con los datos del plano');
  check(enviados.length === antesImg + 2 && Buffer.isBuffer(ultimo().contenido.image) && ultimo().contenido.caption === '*TOTALES 1ERA CARRERA DE MOUNTAINEER, GRUPO DREAM* 💰🏇' && !ultimo().contenido.text, 'envía la imagen con el pie "*TOTALES ...*" y no el texto');
  glue._ext.generarImagen = async () => null;
  const antesImg2 = enviados.length;
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4'));
  check(enviados.length === antesImg2 + 2 && /GANAN: Marvel/.test(textoDe(ultimo())), 'si la imagen no se pudo dibujar, el bot manda el plano en texto (nunca se queda sin publicar)');
  T.formato = 'texto';
  const pedidosAntes = pedidosImagen.length;
  glue._ext.generarImagen = async (g, datos) => { pedidosImagen.push({ g, datos }); return PNG; };
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4'));
  check(pedidosImagen.length === pedidosAntes && /GANAN: Marvel/.test(textoDe(ultimo())), 'con el grupo en "texto" no se dibuja nada y sale el plano de siempre');
  glue._ext.generarImagen = generarOriginal;

  respuestaPlano = { status: 201, body: { plano: {}, datosImagen: null } };
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4'));
  check(/Carrera calculada y guardada/.test(textoDe(ultimo())) && !/No pude cargar/.test(textoDe(ultimo())), 'si se guardó (201) pero no hay texto, no se dice que falló');

  // Mensaje con tres etiquetas (el de la parada, el que respondió y el que se quedó sin pozo): cada @@ se cambia por su @número y la lista no repite personas
  {
    const enviadosTest = [];
    const sFalso = { sock: { sendMessage: async (jid, contenido) => { enviadosTest.push(contenido); return { key: { id: 'x' } }; } }, jid: 'g@g.us', mensajes: new Map(), avisos: new Map() };
    await require('../src/services/hipismoJugadasChatBot')._enviar(sFalso, '✅ @@ @@2 Aquí solo jugaron 1.732,70 por pozo de @@3', { mencionar: '584141111111@s.whatsapp.net', nombre: 'A', mencionar2: '584142222222@s.whatsapp.net', nombre2: 'B', mencionar3: '584141111111@s.whatsapp.net', nombre3: 'A' });
    const c = enviadosTest[0];
    check(c.text === '✅ @584141111111 @584142222222 Aquí solo jugaron 1.732,70 por pozo de @584141111111' && c.mentions.length === 2, 'un mensaje con tres etiquetas sale con sus @números y sin repetir personas en la lista de menciones');
  }

  // Etiquetas reales también con el código oculto (@lid): texto "@código" + el mismo jid en `mentions` (antes salía "@Nombre" sin etiquetar a nadie)
  {
    const enviadosTest = [];
    const sFalso = { sock: { sendMessage: async (jid, contenido) => { enviadosTest.push(contenido); return { key: { id: 'x' } }; } }, jid: 'g@g.us', mensajes: new Map(), avisos: new Map() };
    await require('../src/services/hipismoJugadasChatBot')._enviar(sFalso, '✅ @@ @@2 Aquí solo jugaron 195,00 por pozo de @@3', { mencionar: '98765432100:7@lid', nombre: 'Tykhe', mencionar2: '584141111111@s.whatsapp.net', nombre2: 'B', mencionar3: '55555555555@lid', nombre3: 'tomsito' });
    const c = enviadosTest[0];
    check(c.text === '✅ @98765432100 @584141111111 Aquí solo jugaron 195,00 por pozo de @55555555555' && c.mentions.length === 3 && ['98765432100@lid', '584141111111@s.whatsapp.net', '55555555555@lid'].every(j => c.mentions.includes(j)), 'las personas con número oculto (@lid) también se etiquetan de verdad: "@código" en el texto y su jid en las menciones');
    const e2 = [];
    const sF2 = { sock: { sendMessage: async (jid, contenido) => { e2.push(contenido); return { key: { id: 'x' } }; } }, jid: 'g@g.us', mensajes: new Map(), avisos: new Map() };
    await require('../src/services/hipismoJugadasChatBot')._enviar(sF2, 'Hola @@', { mencionar: 'raro', nombre: 'Pepe' });
    check(e2[0].text === 'Hola @Pepe' && !e2[0].mentions, 'si el jid no se puede leer, no se inventa una etiqueta: queda el nombre en texto');
  }

  // "ERROR" en el chat: borrar la jugada en espera y listar administradores para etiquetarlos
  {
    T.chat.push({ id: 'cE1', grupo_id: G, fecha: '2026-11-19', hipodromo_nombre: 'Mountaineer', carrera_numero: 2, jugador_nombre: 'CACHACO', banquero_nombre: 'MARVEL', monto: 5, resuelta: false, cerrada_en: null, adelantada_jugada_id: null, creado_en: new Date(), apuesta: null });
    const antesN = T.chat.length, id0 = 'cE1';
    const r1 = await glue.eliminarJugadaEnEspera(G, id0), r2 = await glue.eliminarJugadaEnEspera(G, id0);
    check(r1.ok === true && T.chat.length === antesN - 1 && r2.ok === false, 'eliminarJugadaEnEspera borra una jugada en espera una sola vez');
    const adm = await glue.listarAdministradores({ id: G, comandos_whatsapp_numero: '+58 414 1111111' });
    check(adm.some(a => a.jid === '584141111111@s.whatsapp.net'), 'los administradores conocidos incluyen el número de Súper-admin');
    const enviadosTest = [];
    const sFalso = { sock: { sendMessage: async (jid, contenido) => { enviadosTest.push(contenido); return { key: { id: 'x' } }; } }, jid: 'g@g.us', mensajes: new Map(), avisos: new Map() };
    await glue._enviar(sFalso, '*ATENCIÓN ADMINISTRADORES: EL TERCIO @@ MARCÓ ERROR Y @@2 NO RESPONDIÓ* @@L', { mencionar: '98765432100@lid', nombre: 'A', mencionar2: '584142222222@s.whatsapp.net', nombre2: 'B', mencionarLista: adm });
    const c = enviadosTest[0];
    check(c.text.startsWith('*ATENCIÓN ADMINISTRADORES: EL TERCIO @98765432100 MARCÓ ERROR Y @584142222222 NO RESPONDIÓ* @') && c.text.includes('@584141111111') && c.mentions.includes('584141111111@s.whatsapp.net') && c.mentions.includes('98765432100@lid'), 'el llamado a los administradores los etiqueta de verdad a todos');
  }

  {
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'La Rinconada 6ta carrera', null, base + 1200));
    const enviarTardia = async (ts) => {
      const oferta = mT('CACHACO', 'Juego 3n del 2 100', null, ts);
      await whatsappBot.manejarMensajeEntrante(sock, oferta);
      const respuesta = mT('MARVEL', 'J', oferta.key.id, ts + 240);
      await whatsappBot.manejarMensajeEntrante(sock, respuesta);
      return { respuesta, avisoId: ultimo().id };
    };
    const antes = T.chat.length;
    const primera = await enviarTardia(base + 1210);
    await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', 'OK', primera.respuesta.key.id, base + 1460));
    check(T.chat.length === antes, 'el que toma la parada no puede darse el OK');
    await whatsappBot.manejarMensajeEntrante(sock, mT('CACHACO', 'OK', primera.avisoId, base + 1509));
    check(T.chat.length === antes + 1 && /Van jugando/.test(textoDe(ultimo())) &&
      ultimo().contenido.mentions?.length === 2, 'el OK antes del minuto guarda la jugada y etiqueta a ambos');
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'Aquí jugaron', primera.respuesta.key.id, base + 1510));
    check(T.chat.length === antes + 1, 'la confirmación de un administrador no duplica lo ya guardado');
    const segunda = await enviarTardia(base + 1520);
    await whatsappBot.manejarMensajeEntrante(sock, mT('CACHACO', 'OK', segunda.respuesta.key.id, base + 1820));
    check(T.chat.length === antes + 1 && /pasó el minuto/.test(textoDe(ultimo())), 'el OK al cumplirse el minuto se rechaza');
    await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', 'Aquí jugaron', segunda.respuesta.key.id, base + 1821));
    check(T.chat.length === antes + 1, 'un participante sin rol de WhatsApp no puede confirmar como administrador');
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'Aquí jugaron', segunda.respuesta.key.id, base + 1822));
    check(T.chat.length === antes + 2 && /Van jugando/.test(textoDe(ultimo())), 'un administrador confirma manualmente mientras la carrera sigue abierta');
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'plano', null, base + 1823));
    check(/CACHACO/i.test(textoDe(ultimo())) && /MARVEL/i.test(textoDe(ultimo())), 'el plano incluye las jugadas confirmadas');
  }

  {
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'La Rinconada 7ma carrera', null, base + 1900));
    const oferta = mT('CACHACO', 'Juego 3n del 2 100', null, base + 1901);
    await whatsappBot.manejarMensajeEntrante(sock, oferta);
    const respuesta = mT('MARVEL', '20', oferta.key.id, base + 1902);
    const cierre = mT('ADMIN', 'cerrado', null, base + 1903);
    const despues = mT('MARVEL', '30', oferta.key.id, base + 1904);
    const lote = glue.mensajesEnOrden([cierre, respuesta, despues]);
    check(lote[0] === respuesta && lote[1] === cierre && lote[2] === despues, 'ordena un lote de WhatsApp por hora del mensaje');
    const ayudas = whatsappBot.crearAyudasJugadasChat(sock, respuesta);
    let liberar;
    let avisoInicio;
    const inicio = new Promise(resolve => { avisoInicio = resolve; });
    const pausa = new Promise(resolve => { liberar = resolve; });
    const resolverOriginal = ayudas.resolverRemitente;
    ayudas.resolverRemitente = async jid => {
      avisoInicio();
      await pausa;
      return resolverOriginal(jid);
    };
    const antes = T.chat.length;
    const primerEnvio = enviados.length;
    const procesarRespuesta = glue.intentar({ sock, msg: respuesta, remoteJid: JID, texto: '20', ayudas });
    await inicio;
    const procesarCierre = whatsappBot.manejarMensajeEntrante(sock, cierre);
    const procesarDespues = whatsappBot.manejarMensajeEntrante(sock, despues);
    await new Promise(resolve => setImmediate(resolve));
    check(T.estado.abierta && T.chat.length === antes, 'cerrado espera a la respuesta anterior aunque identificar al cliente tarde');
    liberar();
    await Promise.all([procesarRespuesta, procesarCierre, procesarDespues]);
    const nuevos = enviados.slice(primerEnvio).map(textoDe);
    check(T.chat.length === antes + 1 && nuevos[0] === '✅ Aquí jugaron' &&
      /CARRERA CERRADA/.test(nuevos[1]) && /CACHACO/i.test(nuevos[2]),
    'se sentencia la jugada anterior, se incluye en el plano de cierre y se descarta la posterior');
  }

  {
    let vencio = false;
    try {
      await glue.conLimiteWhatsApp(new Promise(() => {}), 'probar el tiempo de espera', 5);
    } catch (e) {
      vencio = /WhatsApp no respondió/.test(e.message);
    }
    check(vencio, 'una operación de WhatsApp que nunca responde tiene un límite');
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'La Rinconada 8va carrera', null, base + 2000));
    const oferta = mT('CACHACO', 'Juego 1p del 4 120', null, base + 2001);
    await whatsappBot.manejarMensajeEntrante(sock, oferta);
    await whatsappBot.manejarMensajeEntrante(sock, mT('CACHACO', 'Se fue', null, base + 2120));
    const antes = T.chat.length;
    const respuesta = mT('DESCONOCIDO', 'J', oferta.key.id, base + 2121);
    await whatsappBot.manejarMensajeEntrante(sock, respuesta);
    check(T.chat.length === antes && /Aquí nada, puso se fue/.test(textoDe(ultimo())) &&
      ultimo().opciones?.quoted === respuesta, 'contesta al J de una parada retirada incluso sin reconocer a quien respondió');
  }

  {
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'La Rinconada 9na carrera', null, base + 2200));
    const oferta = mT('CACHACO', 'Consigo 10a8 el 1 con 40', null, base + 2201);
    const antes = T.chat.length;
    await whatsappBot.manejarMensajeEntrante(sock, oferta);
    await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', '15', oferta.key.id, base + 2202));
    await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', 'J', oferta.key.id, base + 2203));
    const jugadas = T.chat.slice(antes);
    check(jugadas.length === 2 && jugadas[0].monto === 15 && jugadas[1].monto === 25 &&
      jugadas.every(j => j.jugador_nombre === 'MARVEL' && j.banquero_nombre === 'CACHACO' &&
        JSON.parse(j.apuesta).modalidad === '10a8' && JSON.parse(j.apuesta).grupo[0] === 1),
    'Consigo 10a8 el 1 con 40: quien responde juega el 1; el autor banquea 15 y luego los 25 restantes');
  }

  {
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'La Rinconada 10ma carrera', null, base + 2300));
    const oferta = mT('CACHACO', 'Consigo 2p del 6 300', null, base + 2301);
    await whatsappBot.manejarMensajeEntrante(sock, oferta);
    await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', '100', oferta.key.id, base + 2310));
    const antes = T.chat.length;
    const respuesta = mT('RICARDO', '500', oferta.key.id, base + 2320);
    await whatsappBot.manejarMensajeEntrante(sock, respuesta);
    check(T.chat.length === antes && textoDe(ultimo()) === '❌ 🚨 *AQUÍ NADA ERROR DE MONTO*' &&
      ultimo().opciones?.quoted === respuesta, 'pedir 500 en una parada de 300 se rechaza y cita la respuesta');
    await whatsappBot.manejarMensajeEntrante(sock, mT('RICARDO', '200', oferta.key.id, base + 2330));
    check(T.chat.length === antes + 1 && T.chat.at(-1).monto === 200, 'el rechazo no consume los 200 disponibles');
  }

  {
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'La Rinconada 11ma carrera', null, base + 2400));
    const oferta = mT('CACHACO', 'Consigo 2p del 6 1000', null, base + 2401);
    await whatsappBot.manejarMensajeEntrante(sock, oferta);
    await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', '700', oferta.key.id, base + 2410));
    const antes = T.chat.length;
    const respuesta = mT('MARVEL', '500', oferta.key.id, base + 2420);
    await whatsappBot.manejarMensajeEntrante(sock, respuesta);
    const aviso = enviados.find(e => e.opciones?.quoted === respuesta);
    check(T.chat.length === antes + 1 && T.chat.at(-1).monto === 300 &&
      aviso?.contenido.text === '✅ Aquí solo 300,00', 'piden 500 en una parada de 1000 con 300 restantes: se confirman solo los 300');
  }

  {
    await whatsappBot.manejarMensajeEntrante(sock, mT('ADMIN', 'La Rinconada 12ma carrera', null, base + 2500));
    const primera = mT('CACHACO', 'Juego 2p del 6 con 50', null, base + 2501);
    const segunda = mT('CACHACO', 'Juego 2p del 6 con 50 más ....', null, base + 2502);
    const antes = T.chat.length;
    await whatsappBot.manejarMensajeEntrante(sock, primera);
    await whatsappBot.manejarMensajeEntrante(sock, segunda);
    await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', 'J', primera.key.id, base + 2510));
    await whatsappBot.manejarMensajeEntrante(sock, mT('MARVEL', 'J', segunda.key.id, base + 2511));
    check(T.chat.length === antes + 2 && T.chat.slice(antes).every(j => j.monto === 50),
      'una parada con más abre otros 50 que se pueden tomar citando el mensaje nuevo');
  }

  {
    const americanas = '111@g.us';
    const nacionales = '222@g.us';
    GRUPO.whatsapp_propio_chats = [americanas, nacionales];
    const mandar = (jid, texto, remitente = 'ADMIN') => {
      const msg = mensaje(remitente, texto);
      msg.key.remoteJid = jid;
      msg.messageTimestamp = Math.floor(Date.now() / 1000) - 1200;
      const socket = { ...sock, groupMetadata: async chat => ({
        participants: chat === americanas || chat === nacionales
          ? [
              { id: num.ADMIN + '@s.whatsapp.net', admin: 'admin' },
              { id: num.MARVEL + '@s.whatsapp.net', admin: chat === americanas ? 'admin' : null }
            ]
          : []
      }) };
      const ayudas = whatsappBot.crearAyudasJugadasChat(socket, msg);
      return glue.intentar({ grupoId: G, sock: socket, msg, remoteJid: jid, texto, ayudas });
    };
    await Promise.all([mandar(americanas, 'Mountaineer 1era carrera'), mandar(nacionales, 'La Rinconada 2da carrera')]);
    check(T.estadosPorChat.get(americanas)?.hipodromo === 'Mountaineer' &&
      T.estadosPorChat.get(nacionales)?.hipodromo === 'La Rinconada', 'dos chats autorizados guardan carreras distintas para el mismo grupo');
    await mandar(americanas, 'plano', 'MARVEL');
    check(ultimo().jid === americanas && /Mountaineer/i.test(textoDe(ultimo())), 'un administrador de WhatsApp sin permiso interno pide el plano de Americanas');
    await mandar(nacionales, 'plano');
    check(ultimo().jid === nacionales && /La Rinconada/i.test(textoDe(ultimo())), 'Nacionales recibe el plano de su propia carrera');
    await mandar(nacionales, 'plano', 'MARVEL');
    check(/no está autorizado para pedir el plano/.test(textoDe(ultimo())), 'ser administrador de Americanas no permite pedir el plano de Nacionales');
    glue._sesiones.clear();
    await mandar(americanas, 'cerrar');
    check(T.estadosPorChat.get(americanas)?.abierta === false &&
      T.estadosPorChat.get(nacionales)?.abierta === true, 'tras reiniciar, cerrar Americanas mantiene abierta Nacionales');
    const cierreRecuperado = mensaje('ADMIN', 'cerrado');
    cierreRecuperado.key.remoteJid = nacionales;
    const segundo = Math.floor(Date.now() / 1000) - 600;
    cierreRecuperado.messageTimestamp = segundo;
    const recuperar = () => glue.intentar({
      grupoId: G, sock, msg: cierreRecuperado, remoteJid: nacionales, texto: 'cerrado',
      ayudas: whatsappBot.crearAyudasJugadasChat(sock, cierreRecuperado), recuperado: true
    });
    const pendiente = {
      id: 'pendiente-recuperada', grupo_id: G, fecha: T.estadosPorChat.get(nacionales).fecha,
      hipodromo_nombre: 'La Rinconada', carrera_numero: 2, resuelta: false,
      jugador_nombre: 'CACHACO', banquero_nombre: 'MARVEL', monto: 20, apuesta: null
    };
    T.chat.push(pendiente);
    await recuperar();
    check(T.estadosPorChat.get(nacionales)?.abierta === false &&
      T.estadosPorChat.get(nacionales)?.ultimoComando?.ts === segundo * 1000 && Number(pendiente.cerrada_en) === segundo * 1000, 'el cierre recuperado conserva la hora original del chat');
    glue._sesiones.clear();
    const antesDuplicado = enviados.length;
    await recuperar();
    check(enviados.length === antesDuplicado, 'el cierre recuperado no vuelve a anunciarse tras reiniciar');
    GRUPO.whatsapp_propio_chats = [americanas];
    const antes = enviados.length;
    await mandar(nacionales, 'La Rinconada 3era carrera');
    check(enviados.length === antes && T.estadosPorChat.get(nacionales)?.carrera === 2, 'retirar la autorización detiene el chat de inmediato');
  }
  console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
