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
  planos: [], jugadas: [], chat: [], estado: null
};
let contador = 0;
function consulta(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return { rows: [] };
  if (/^SELECT id, nombre, comandos_whatsapp_habilitado, comandos_whatsapp_numero FROM grupos WHERE whatsapp_grupo_jid = \$1 AND whatsapp_habilitado = true AND hipismo_chat_habilitado = true AND activo = true/i.test(sql)) {
    return { rows: (params[0] === JID && GRUPO.hipismo_chat_habilitado) ? [GRUPO] : [] };
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
  if (/^SELECT id, comision_porcentaje FROM hipismo_tercios_adelantadas_planos/i.test(sql)) {
    return { rows: T.planos.filter(p => p.grupo_id === params[0] && p.hipodromo_nombre === params[1] && String(p.fecha) === String(params[2]) && p.texto_original === params[3]) };
  }
  if (T.fallar && /^INSERT INTO hipismo_tercios_adelantadas_jugadas/i.test(sql)) throw new Error('fallo simulado');
  if (/^INSERT INTO hipismo_tercios_adelantadas_planos/i.test(sql)) {
    const p = { id: 'p' + (++contador), grupo_id: params[0], hipodromo_id: params[1], hipodromo_nombre: params[2], fecha: params[3], comision_porcentaje: 5, texto_original: params[4] };
    T.planos.push(p); return { rows: [p] };
  }
  if (/^INSERT INTO hipismo_tercios_adelantadas_jugadas/i.test(sql)) {
    const f = { id: 'a' + (++contador), plano_id: params[0], jugador_nombre: params[2], banquero_nombre: params[3], carrera_numero: params[4], es_cruce: params[5], grupo_caballos: params[6], cruce_grupo_a: params[7], cruce_grupo_b: params[8], modalidad: params[9], monto: params[10], comision_porcentaje: params[11], texto_original: params[12], estado: 'pendiente' };
    T.jugadas.push(f); return { rows: [{ id: f.id }] };
  }
  if (/^INSERT INTO hipismo_chat_jugadas/i.test(sql)) {
    T.chat.push({ grupo_id: params[0], fecha: params[1], hipodromo_nombre: params[2], carrera_numero: params[3], jugador_nombre: params[4], banquero_nombre: params[5], monto: params[6], riesgo_jugador: params[7], riesgo_banquero: params[8], texto_linea: params[9], adelantada_jugada_id: params[10], creado_en: new Date() });
    return { rows: [] };
  }
  if (/FROM hipismo_chat_jugadas c JOIN hipismo_tercios_adelantadas_jugadas a ON a.id = c.adelantada_jugada_id WHERE c.grupo_id = \$1 AND a.estado = 'pendiente'/i.test(sql)) {
    return { rows: T.chat.filter(c => c.jugador_nombre === params[1] || c.banquero_nombre === params[1]).map(c => ({ ...c, estado: (T.jugadas.find(j => j.id === c.adelantada_jugada_id) || {}).estado })).filter(c => c.estado === 'pendiente') };
  }
  if (/FROM hipismo_chat_jugadas c JOIN hipismo_tercios_adelantadas_jugadas a ON a.id = c.adelantada_jugada_id WHERE c.grupo_id = \$1 AND c.fecha = \$2/i.test(sql)) {
    return { rows: T.chat.filter(c => c.hipodromo_nombre === params[2] && c.carrera_numero === params[3]).map(c => {
      const a = T.jugadas.find(j => j.id === c.adelantada_jugada_id);
      return a ? { jugador_nombre: a.jugador_nombre, banquero_nombre: a.banquero_nombre, monto: a.monto, es_cruce: a.es_cruce, grupo_caballos: a.grupo_caballos, cruce_grupo_a: a.cruce_grupo_a, cruce_grupo_b: a.cruce_grupo_b, modalidad: a.modalidad } : null;
    }).filter(Boolean) };
  }
  if (/^INSERT INTO hipismo_chat_estado/i.test(sql)) { T.estado = { hipodromo: params[1], carrera: params[2], abierta: params[3], fecha: params[4] }; return { rows: [] }; }
  if (/^SELECT hipodromo, carrera, abierta, to_char\(fecha, 'YYYY-MM-DD'\) AS fecha FROM hipismo_chat_estado/i.test(sql)) return { rows: T.estado ? [T.estado] : [] };
  if (/^(ALTER|create|do \$\$|alter)/i.test(sql)) return { rows: [] };
  throw new Error('BD falsa: consulta no prevista: ' + sql.slice(0, 160));
}
const fakePool = function () {
  this.query = async (t, p) => consulta(t, p);
  this.connect = async () => ({ query: async (t, p) => consulta(t, p), release() {} });
  this.on = () => {};
};
// pozo falso (el cálculo real del pozo ya tiene sus propias pruebas): disponible base por cliente
const POZO = { NANA: 20, RICARDO: 1000 };
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (/hipismoAlertaPozo$/.test(request)) {
    return { clientesConPozoDisponible: async (g, nombres) => nombres.filter(n => POZO[n] !== undefined).map(n => ({ jugador: { nombre: n }, base: POZO[n], disponible: POZO[n] - T.jugadas.filter(j => j.jugador_nombre === n).reduce((a, j) => a + Number(j.monto), 0), pagoDiario: false })) };
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
  // la caché de 30 s: se salta moviendo el reloj
  const realNow = Date.now; Date.now = () => realNow() + 31000;

  // un jugador no puede abrir
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('CACHACO', 'Mountaineer 1ra carrera'));
  check(enviados.length === 1 && /no está autorizado para abrir carreras/.test(textoDe(ultimo())) && !/Carrera abierta/.test(textoDe(ultimo())), 'un jugador no puede abrir una carrera: el bot explica que su número no está autorizado (ya no se queda mudo)');
  // el administrador (número autorizado en Súper-admin) abre
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Mountaineer 1era carrera'));
  check(enviados.length === 2 && /Carrera abierta/.test(textoDe(ultimo())), 'el número autorizado abre "Mountaineer 1era carrera" y el bot confirma');

  // Cachaco publica 120
  const of = mensaje('CACHACO', 'Juego 4 x 1 10a8 con 120');
  await whatsappBot.manejarMensajeEntrante(sock, of);
  check(enviados.length === 2, 'publicar una jugada válida no genera mensaje');
  // Marvel responde 22 (se identifica por su teléfono 0412-4537732)
  const r1 = mensaje('MARVEL', '22', of.key.id);
  await whatsappBot.manejarMensajeEntrante(sock, r1);
  check(textoDe(ultimo()) === '✅ Aquí jugaron' && ultimo().opciones && ultimo().opciones.quoted === r1, 'responde "✅ Aquí jugaron" CITANDO el mensaje de Marvel');
  check(T.jugadas.length === 1 && T.jugadas[0].jugador_nombre === 'CACHACO' && T.jugadas[0].banquero_nombre === 'MARVEL' && Number(T.jugadas[0].monto) === 22 && T.jugadas[0].es_cruce === true && T.jugadas[0].modalidad === '10a8', 'se guardó en Jugadas entre Tercios Adelantadas (pendiente): Cachaco 10a8 4x1 con 22 da Marvel');
  check(JSON.parse(T.jugadas[0].cruce_grupo_a)[0] === 4 && JSON.parse(T.jugadas[0].cruce_grupo_b)[0] === 1, 'los caballos 4 y 1 quedaron en su lugar');
  check(T.planos.length === 1 && T.planos[0].hipodromo_nombre === 'Mountaineer' && T.jugadas[0].carrera_numero === 1, 'quedó en un plano de Mountaineer, carrera 1, del día');
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
  check(T.jugadas.length === 2 && /dispone de un saldo de 0,00/.test(textoDe(av)) && av.contenido.mentions && av.contenido.mentions[0] === num.NANA + '@s.whatsapp.net' && textoDe(av).startsWith('Saludos @' + num.NANA), 'Nana ya no tiene pozo: no se registra, se le avisa y se la menciona con @' + num.NANA);

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
  check(/No encontré ningún cliente/.test(textoDe(ultimo())) && T.numeros.length === 0, 'registrar un nombre que no existe: avisa y no guarda');
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
  // "autorizar": un administrador autoriza a otra persona (responde a su aviso "no autorizado") y desde entonces puede abrir carreras
  const jugadorQuiere = { key: { remoteJid: JID, participant: '44444444444@lid', id: 'ADM1', fromMe: false }, pushName: 'Socio', message: { conversation: 'Abierta 2da de mountaineer' } };
  const ayS = () => whatsappBot.crearAyudasJugadasChat(sock, jugadorQuiere);
  await glue.intentar({ sock, msg: jugadorQuiere, remoteJid: JID, texto: 'Abierta 2da de mountaineer', ayudas: ayS() });
  const avisoAdm = ultimo();
  check(/no está autorizado para abrir carreras/.test(textoDe(avisoAdm)) && /autorizar/.test(textoDe(avisoAdm)), 'alguien que no es administrador intenta abrir: se le explica y se le dice cómo autorizarlo');
  const autor = { key: { remoteJid: JID, participant: num.ADMIN + '@s.whatsapp.net', id: 'AUT1', fromMe: false }, pushName: 'Admin', message: { extendedTextMessage: { text: 'autorizar', contextInfo: { stanzaId: avisoAdm.id, participant: '573246161764@s.whatsapp.net' } } } };
  await glue.intentar({ sock, msg: autor, remoteJid: JID, texto: 'autorizar', ayudas: whatsappBot.crearAyudasJugadasChat(sock, autor) });
  check(/ahora es administrador/.test(textoDe(ultimo())) && T.numeros.some(x => x.digitos === '44444444444' && x.jugador_nombre === '__ADMIN__'), 'el administrador responde "autorizar" al aviso y esa persona queda como administrador');
  const jugadorAbre = { key: { remoteJid: JID, participant: '44444444444@lid', id: 'ADM2', fromMe: false }, pushName: 'Socio', message: { conversation: 'Abierta 2da de mountaineer' } };
  await glue.intentar({ sock, msg: jugadorAbre, remoteJid: JID, texto: 'Abierta 2da de mountaineer', ayudas: whatsappBot.crearAyudasJugadasChat(sock, jugadorAbre) });
  check(/Carrera abierta: \*Mountaineer, 2da Carrera\*/.test(textoDe(ultimo())), 'la persona autorizada ya puede abrir carreras (aunque WhatsApp oculte su teléfono)');
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
  check(T.jugadas.length === nJug && /Aquí nada, pasaron más de 3 minutos/.test(textoDe(ultimo())), 'con la hora real de WhatsApp: respondieron 200 s después y el bot dice "Aquí nada" por tiempo');
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
  check(/Sistema Dream/.test(plano) && /Mountaineer, 1era Carrera/.test(plano) && /1\) Juega Cachaco 10A8 \(4x1\) con 22,00 da Marvel/.test(plano) && /Juega Cachaco 10A8 \(5x4\) con 200,00 da Marvel/.test(plano) && new RegExp('Total jugadas: ' + T.jugadas.length + '$').test(plano), 'el plano sale de las jugadas guardadas, con su "Total jugadas"');

  // el servidor se reinicia con la carrera abierta: se retoma desde la base y se sigue jugando
  glue._sesiones.clear();
  const antesR = enviados.length;
  const ofR = mensaje('CACHACO', 'Juego 4x1 con 15 doy a8');
  await whatsappBot.manejarMensajeEntrante(sock, ofR);
  check(enviados.length === antesR, 'tras un reinicio la carrera sigue abierta: publicar una jugada no genera "no hay carrera abierta"');
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('MARVEL', '5', ofR.key.id));
  check(textoDe(ultimo()) === '✅ Aquí jugaron', 'y las respuestas se registran como siempre');
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Cerrado'));
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
  const pubPizarra = enviados.length;
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Pizarra 3.1.2.4 Ret 7'));
  const cuerpo = llamadasPlano[0] && llamadasPlano[0].body;
  check(llamadasPlano.length === 1 && llamadasPlano[0].g === G && cuerpo.texto === '' && cuerpo.pizarra === '3.1.2.4' && cuerpo.ret === '7' && cuerpo.hipodromoNombre === 'Mountaineer' && cuerpo.carreraNumero === 1, 'el administrador escribe "Pizarra 3.1.2.4 Ret 7": el bot manda a calcular la carrera con plano vacío, la llegada y los retirados');
  check(enviados.length === pubPizarra + 2 && /Pizarra cargada: \*Mountaineer, 1era Carrera\*/.test(textoDe(enviados[pubPizarra])) && /GANAN: Marvel/.test(textoDe(ultimo())), 'el bot avisa y publica en el grupo el plano con quién gana y quién pierde');
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

  Date.now = realNow;
  console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
