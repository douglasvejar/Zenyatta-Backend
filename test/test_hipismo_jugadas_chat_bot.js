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
    { nombre: 'RICARDO', telefono: '+1 (904) 767-0886' }
  ],
  hipodromos: [{ id: 'h1', nombre: 'Mountaineer' }, { id: 'h2', nombre: 'La Rinconada' }],
  planos: [], jugadas: [], chat: []
};
let contador = 0;
function consulta(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return { rows: [] };
  if (/^SELECT id, nombre, comandos_whatsapp_habilitado, comandos_whatsapp_numero FROM grupos WHERE whatsapp_grupo_jid = \$1 AND whatsapp_habilitado = true AND hipismo_chat_habilitado = true AND activo = true/i.test(sql)) {
    return { rows: (params[0] === JID && GRUPO.hipismo_chat_habilitado) ? [GRUPO] : [] };
  }
  if (/^SELECT nombre, telefono FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: T.jugadores };
  if (/^SELECT nombre FROM hipismo_hipodromos WHERE grupo_id = \$1/i.test(sql)) return { rows: T.hipodromos };
  if (/^SELECT id FROM hipismo_hipodromos WHERE grupo_id = \$1 AND nombre = \$2/i.test(sql)) return { rows: T.hipodromos.filter(h => h.nombre === params[1]) };
  if (/^SELECT id, comision_porcentaje FROM hipismo_tercios_adelantadas_planos/i.test(sql)) {
    return { rows: T.planos.filter(p => p.grupo_id === params[0] && p.hipodromo_nombre === params[1] && String(p.fecha) === String(params[2]) && p.texto_original === params[3]) };
  }
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
const sock = { sendMessage: async (jid, contenido, opciones) => { const id = 'BOT' + (++seq); enviados.push({ jid, contenido, opciones, id }); return { key: { id, remoteJid: jid, fromMe: true } }; } };
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
  check(enviados.length === 0, 'un jugador no puede abrir una carrera');
  // el administrador (número autorizado en Súper-admin) abre
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'Mountaineer 1era carrera'));
  check(enviados.length === 1 && /Carrera abierta/.test(textoDe(ultimo())), 'el número autorizado abre "Mountaineer 1era carrera" y el bot confirma');

  // Cachaco publica 120
  const of = mensaje('CACHACO', 'Juego 4 x 1 10a8 con 120');
  await whatsappBot.manejarMensajeEntrante(sock, of);
  check(enviados.length === 1, 'publicar una jugada válida no genera mensaje');
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
  check(T.jugadas.length === 2 && /no tienes disponible/.test(textoDe(av)) && av.contenido.mentions && av.contenido.mentions[0] === num.NANA + '@s.whatsapp.net' && textoDe(av).startsWith('@' + num.NANA), 'Nana ya no tiene pozo: no se registra, se le avisa y se la menciona con @' + num.NANA);

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

  // plano desde la base de datos
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('ADMIN', 'plano'));
  const plano = textoDe(ultimo());
  check(/Sistema Dream/.test(plano) && /Mountaineer, 1era Carrera/.test(plano) && /1\) Juega Cachaco 10A8 \(4x1\) con 22,00 da Marvel/.test(plano) && /Juega Cachaco 10A8 \(5x4\) con 200,00 da Marvel/.test(plano) && /Total jugadas: 3/.test(plano), 'el plano sale de las jugadas guardadas, con "Total jugadas: 3"');

  // mensajes del propio bot no se vuelven a procesar
  const antes = enviados.length;
  await whatsappBot.manejarMensajeEntrante(sock, { key: { remoteJid: JID, participant: num.ADMIN + '@s.whatsapp.net', id: ultimo().id, fromMe: true }, message: { conversation: 'plano' } });
  check(enviados.length === antes, 'lo que escribió el propio bot no se procesa otra vez');

  // la sábana sigue su camino (no la toca el bot)
  await whatsappBot.manejarMensajeEntrante(sock, mensaje('CACHACO', 'hola buenas'));
  check(enviados.length === antes, 'una charla cualquiera no genera respuesta');

  Date.now = realNow;
  console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
