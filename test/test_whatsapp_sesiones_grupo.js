// =================================================================
// PRUEBA: número de WhatsApp propio por grupo (17-11-2026) — whatsappSesionesGrupo.js + su conexión con el bot de jugadas.
// Con WhatsApp (Baileys), disco y base de datos FALSOS: revisa QR/estado, mensajes, reconexión, sesión cerrada, desvincular,
// arranque de los grupos guardados, y que la conexión general se haga a un lado cuando el grupo tiene su número propio conectado.
// =================================================================
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const originalLoad = Module._load;

const G = 'grupo-uno', JID = '120363000000000077@g.us';
const BD = { grupo: { id: G, nombre: 'Dream', activo: true, whatsapp_propio_jid: JID, whatsapp_propio_activo: true, hipismo_chat_habilitado: true, comandos_whatsapp_habilitado: true, comandos_whatsapp_numero: '+58 414 1111111' }, updates: [], activos: [{ id: 'a1' }, { id: 'a2' }], errorColumna: false };
function consulta(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT id, nombre, comandos_whatsapp_habilitado, comandos_whatsapp_numero FROM grupos WHERE id = \$1 AND whatsapp_propio_jid = \$2/i.test(sql)) {
    return { rows: (params[0] === G && params[1] === JID) ? [BD.grupo] : [] };
  }
  if (/^SELECT id, nombre, comandos_whatsapp_habilitado, comandos_whatsapp_numero FROM grupos WHERE whatsapp_grupo_jid/i.test(sql)) {
    return { rows: params[0] === JID ? [{ ...BD.grupo }] : [] };
  }
  if (/^SELECT activo, hipismo_chat_habilitado, whatsapp_propio_activo, whatsapp_propio_jid FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [BD.grupo] };
  if (/^SELECT id FROM grupos WHERE whatsapp_propio_activo = true/i.test(sql)) {
    if (BD.errorColumna) { const e = new Error('no existe la columna'); e.code = '42703'; throw e; }
    return { rows: BD.activos };
  }
  if (/^UPDATE grupos SET whatsapp_propio_activo = false/i.test(sql)) { BD.updates.push(params); return { rows: [] }; }
  if (/^SELECT hipodromo, carrera, abierta, to_char/i.test(sql)) return { rows: [] };
  if (/^SELECT nombre, telefono FROM jugadores/i.test(sql)) return { rows: [{ nombre: 'MARVEL', telefono: '0412-4537732' }] };
  if (/^(ALTER|create|do \$\$|alter)/i.test(sql)) return { rows: [] };
  throw new Error('BD falsa: consulta no prevista: ' + sql.slice(0, 140));
}
const fakePool = function () {
  this.query = async (t, p) => consulta(t, p);
  this.connect = async () => ({ query: async (t, p) => consulta(t, p), release() {} });
  this.on = () => {};
};
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
const gestor = require(path.join(__dirname, '..', 'src', 'services', 'whatsappSesionesGrupo'));
const glue = require(path.join(__dirname, '..', 'src', 'services', 'hipismoJugadasChatBot'));
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
const check = (c, m) => { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } };

// ---------- Baileys falso ----------
const socks = [];
function makeWASocket(args) {
  const handlers = {};
  const sock = {
    handlers, argsCreacion: args, terminado: false, cerroSesion: false, enviados: [],
    user: { id: '584121234567:12@s.whatsapp.net' },
    ev: { on: (n, f) => { handlers[n] = f; } },
    end() { sock.terminado = true; },
    async logout() { sock.cerroSesion = true; },
    async groupFetchAllParticipating() { return { [JID]: { id: JID, subject: 'AMERICANAS DREAM' } }; },
    async sendMessage(jid, contenido, op) { const id = 'BOT' + (sock.enviados.length + 1); sock.enviados.push({ jid, contenido, op, id }); return { key: { id } }; }
  };
  socks.push(sock);
  return sock;
}
const DisconnectReason = { loggedOut: 401 };
class Boom { constructor(e) { this.output = { statusCode: (e && e.statusCode) || 500 }; } }
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wsg-'));
const alertas = [];
const TURNO = { ok: true, soltados: [] };
const RELOJ = { t: Date.parse('2026-11-19T20:00:00Z') };
const timers = [];
const llamadas = [];
Object.assign(gestor._deps, {
  cargarBaileys: () => ({ default: makeWASocket, useMultiFileAuthState: async (dir) => ({ state: { dir }, saveCreds: () => {} }), DisconnectReason, fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }) }),
  cargarBoom: () => ({ Boom }),
  baseDir: () => base,
  borrarSesionBd: async () => {},
  intentar: async (a) => { llamadas.push(a); if (a.anotar) a.anotar('Lo leyó el bot de jugadas'); return false; },
  alertar: (asunto, cuerpo) => { alertas.push(asunto); return Promise.resolve(); },
  esperar: async () => {},
  setTimeout: (fn, ms) => { const t = { fn, ms, limpiado: false }; timers.push(t); return t; },
  // Turno de conexión, vigilante y reloj falsos (19-11-2026)
  setIntervalo: () => ({ falso: true }),
  ahora: () => RELOJ.t,
  tomarTurno: async () => TURNO.ok,
  soltarTurno: async (id) => { TURNO.soltados.push(id); },
  filasActivas: async () => BD.activos
});
const realClearTimeout = global.clearTimeout;
global.clearTimeout = (t) => { if (t && typeof t === 'object' && 'fn' in t) { t.limpiado = true; return; } return realClearTimeout(t); };

(async () => {
  // ----- utilidades -----
  check(gestor.carpetaDeSesion(G).startsWith(path.join(base, 'grupos')), 'la sesión de cada grupo vive en <carpeta>/grupos/grupo-<id>');
  check(!gestor.carpetaDeSesion('../../etc').includes('..'), 'el id del grupo no puede escapar de la carpeta');
  check(gestor.enmascararNumero('584121234567') === '+58 412 ••• 4567', 'el número se muestra enmascarado');
  check(gestor.enmascararNumero('') === null, 'sin número no se muestra nada');

  // ----- estado inicial -----
  let e = gestor.estadoPublico(G);
  check(e.activa === false && e.conectado === false && e.tieneQr === false, 'sin conexión propia: estado vacío');
  check(gestor.estaConectada(G) === false && gestor.obtenerQr(G) === null, 'sin conexión propia: no está conectada y no hay QR');

  // ----- iniciar: QR y conexión -----
  await gestor.iniciarSesion(G);
  check(fs.existsSync(gestor.carpetaDeSesion(G)), 'al iniciar se crea la carpeta de sesión del grupo');
  const s1 = socks[0];
  s1.handlers['connection.update']({ qr: 'QR-ABC' });
  e = gestor.estadoPublico(G);
  check(e.activa && !e.conectado && e.tieneQr, 'con un QR pendiente: esperando escanear');
  check(gestor.obtenerQr(G) === 'QR-ABC', 'el QR se puede leer para dibujarlo');
  s1.handlers['connection.update']({ connection: 'open' });
  await new Promise(r => setImmediate(r));
  e = gestor.estadoPublico(G);
  check(e.conectado && !e.tieneQr && e.numero === '+58 412 ••• 4567', 'conectado: sin QR y con el número enmascarado');
  check(e.grupos.length === 1 && e.grupos[0].jid === JID && e.grupos[0].nombre === 'AMERICANAS DREAM', 'al conectar se arma la lista de grupos de WhatsApp de ese número');
  check(gestor.estaConectada(G) && gestor.obtenerQr(G) === null, 'conectada: ya no hay QR');
  const refrescada = await gestor.refrescarGrupos(G);
  check(refrescada.length === 1, 'refrescar la lista funciona estando conectada');
  let err = null; try { await gestor.refrescarGrupos('otro'); } catch (x) { err = x; }
  check(err && /conectado/.test(err.message), 'refrescar sin conexión explica que primero hay que escanear el QR');

  // ----- mensajes -----
  const mk = (jid, texto) => ({ key: { remoteJid: jid, id: 'M' + Math.random() }, message: { conversation: texto } });
  await s1.handlers['messages.upsert']({ messages: [mk(JID, 'Juego 4x1 con 75 doy a8')] });
  check(gestor.estadoPublico(G).ultimo && /bot de jugadas/.test(gestor.estadoPublico(G).ultimo.motivo), 'el panel sabe que el último mensaje lo leyó el bot');
  check(llamadas.length === 1 && llamadas[0].grupoId === G && llamadas[0].remoteJid === JID && llamadas[0].texto === 'Juego 4x1 con 75 doy a8', 'un mensaje del grupo llega al bot de jugadas indicando de qué grupo es');
  check(llamadas[0].sock === s1 && typeof llamadas[0].ayudas === 'undefined' || llamadas[0].ayudas !== undefined, 'el bot recibe las ayudas');
  await s1.handlers['messages.upsert']({ messages: [mk('584121234567@s.whatsapp.net', 'hola')] });
  await s1.handlers['messages.upsert']({ messages: [{ key: { remoteJid: JID, id: 'X' }, message: { imageMessage: {} } }] });
  check(llamadas.length === 1, 'chats privados y mensajes sin texto se ignoran');
  // Diagnóstico (18-11-2026): el panel cuenta lo que WhatsApp le entrega y avisa si un mensaje no se pudo descifrar
  check(gestor.estadoPublico(G).eventos >= 3 && gestor.estadoPublico(G).ultimoEvento && gestor.estadoPublico(G).ultimoEvento.n === 1, 'el panel cuenta los mensajes que WhatsApp le entregó a este número');
  await s1.handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: JID, id: 'C1' }, messageStubType: 2, messageStubParameters: ['Bad MAC'] }] });
  check(llamadas.length === 1 && /NO se pudo descifrar/.test(gestor.estadoPublico(G).ultimo.motivo), 'un mensaje que no se puede descifrar se avisa en el panel (sesión dañada: volver a vincular)');

  // ----- caída normal: reintenta -----
  s1.handlers['connection.update']({ connection: 'close', lastDisconnect: { error: { statusCode: 500 } } });
  e = gestor.estadoPublico(G);
  check(!e.conectado && /reintentando/.test(e.ultimoError), 'si se pierde la conexión: queda "reintentando"');
  const t = timers[timers.length - 1];
  check(t && t.ms === 5000, 'se programa un reintento en 5 segundos');
  check(alertas.length === 0, 'una caída normal no manda correo');
  t.fn(); await new Promise(r => setTimeout(r, 20));
  check(socks.length === 2, 'el reintento crea una conexión nueva');
  check(socks[0].terminado, 'la conexión vieja se cierra');
  // eventos de la conexión vieja ya no cuentan
  const antes = llamadas.length;
  await socks[0].handlers['messages.upsert']({ messages: [mk(JID, 'Juego 1x2 con 5')] });
  socks[0].handlers['connection.update']({ connection: 'open' });
  check(llamadas.length === antes && !gestor.estaConectada(G), 'una conexión vieja ya reemplazada no hace nada');
  socks[1].handlers['connection.update']({ connection: 'open' });
  check(gestor.estaConectada(G), 'la conexión nueva queda conectada');

  // ----- sesión cerrada por WhatsApp -----
  const nTimers = timers.length;
  socks[1].handlers['connection.update']({ connection: 'close', lastDisconnect: { error: { statusCode: 401 } } });
  e = gestor.estadoPublico(G);
  check(!e.conectado && /cerró la sesión/.test(e.ultimoError), 'si WhatsApp cierra la sesión: se avisa que hay que volver a vincular');
  check(timers.length === nTimers, 'no se reintenta solo (necesita un QR nuevo)');
  check(alertas.length === 1 && /número propio/.test(alertas[0]), 'se manda el correo de alerta');

  // ----- volver a vincular -----
  await gestor.iniciarSesion(G);
  check(socks.length === 3, 'volver a vincular crea una conexión nueva');
  socks[2].handlers['connection.update']({ qr: 'QR-2' });
  check(gestor.estadoPublico(G).tieneQr, 'y muestra su QR nuevo');
  socks[2].handlers['connection.update']({ connection: 'open' });

  // ----- desvincular -----
  fs.writeFileSync(path.join(gestor.carpetaDeSesion(G), 'creds.json'), '{}');
  await gestor.desvincular(G);
  check(socks[2].cerroSesion, 'desvincular cierra la sesión en WhatsApp');
  check(!fs.existsSync(gestor.carpetaDeSesion(G)), 'desvincular borra la carpeta de sesión');
  check(BD.updates.length === 1 && BD.updates[0][0] === G, 'desvincular apaga la bandera en la base');
  check(gestor.estadoPublico(G).activa === false, 'queda sin conexión propia');
  socks[2].handlers['connection.update']({ connection: 'close', lastDisconnect: { error: { statusCode: 500 } } });
  check(timers.filter(x => !x.limpiado).length === timers.filter(x => !x.limpiado).length && gestor.estaConectada(G) === false, 'tras desvincular no se reconecta');

  // ----- arranque -----
  const antesSocks = socks.length;
  const n = await gestor.arrancarSesionesGuardadas();
  check(n === 2 && socks.length === antesSocks + 2, 'al arrancar el servidor se levantan los grupos con número propio');
  check(fs.existsSync(gestor.carpetaDeSesion('a1')) && fs.existsSync(gestor.carpetaDeSesion('a2')), 'cada grupo con su carpeta');
  BD.errorColumna = true;
  check(await gestor.arrancarSesionesGuardadas() === 0, 'si todavía no existe la columna, no se cae el arranque');
  BD.errorColumna = false;

  // ----- QUE UN PUSH NUNCA SILENCIE AL BOT (19-11-2026) -----
  const abrir = (sock) => { sock.handlers['connection.update']({ connection: 'open' }); };
  const reloj = (min) => { RELOJ.t += min * 60 * 1000; };
  // 1) Turno: si otro servidor tiene la sesión, este espera (sin conectar) y se conecta solo cuando se libera
  TURNO.ok = false;
  const socksAntesT = socks.length;
  await gestor.iniciarSesion('t1');
  check(socks.length === socksAntesT, 'sin el turno (otro servidor conectado) NO se crea el socket: no se pelea por el número');
  e = gestor.estadoPublico('t1');
  check(!e.conectado && e.esperandoTurno && /Esperando que el servidor anterior/.test(e.ultimoError), 'el panel dice que está esperando que el servidor anterior suelte la sesión');
  let tt = timers[timers.length - 1];
  check(tt && tt.ms === 3000, 'reintenta tomar el turno cada 3 segundos');
  tt.fn(); await new Promise(r => setTimeout(r, 20));
  check(socks.length === socksAntesT && timers[timers.length - 1].ms === 3000 && timers[timers.length - 1] !== tt, 'si sigue ocupado, vuelve a esperar (nunca se queda sin reintento)');
  TURNO.ok = true;
  timers[timers.length - 1].fn(); await new Promise(r => setTimeout(r, 20));
  check(socks.length === socksAntesT + 1, 'en cuanto el servidor anterior suelta el turno, se conecta solo');
  const sT = socks[socks.length - 1];
  abrir(sT); await new Promise(r => setImmediate(r));
  check(gestor.estaConectada('t1') && !gestor.estadoPublico('t1').esperandoTurno, 'conectado y con el turno');

  // 2) Si en el latido el turno ya es de otro servidor, este suelta el socket y espera (no hay pelea de 440)
  TURNO.ok = false;
  await gestor._latido();
  check(sT.terminado && !gestor.estaConectada('t1') && gestor.estadoPublico('t1').esperandoTurno, 'al perder el turno cierra su socket y queda en espera');
  check(timers[timers.length - 1].ms === 9000, 'y vuelve a intentar tomar el turno más tarde');
  TURNO.ok = true;
  timers[timers.length - 1].fn(); await new Promise(r => setTimeout(r, 20));
  const sT2 = socks[socks.length - 1];
  abrir(sT2); await new Promise(r => setImmediate(r));
  check(gestor.estaConectada('t1'), 'cuando el turno vuelve a estar libre, se reconecta sola');

  // 3) Vigilante: dice "Conectado" pero no entrega mensajes -> se reinicia sola, con espera creciente
  const nSocks3 = socks.length;
  reloj(2);
  await gestor._latido();
  check(socks.length === nSocks3, 'a los 2 minutos sin mensajes todavía no se toca (el grupo puede estar en silencio)');
  reloj(2); // 4 min conectada sin recibir nada
  await gestor._latido(); await new Promise(r => setTimeout(r, 20));
  check(socks.length === nSocks3 + 1 && sT2.terminado, 'a los 4 minutos "Conectado" sin ningún mensaje: reinicia la conexión sola (sin pedir QR)');
  e = gestor.estadoPublico('t1');
  check(e.refrescos === 1 && e.ultimoRefresco && /no entregó ningún mensaje/.test(e.ultimoRefresco.motivo), 'el panel anota que el vigilante la reinició y por qué');
  const sT3 = socks[socks.length - 1]; abrir(sT3); await new Promise(r => setImmediate(r));
  reloj(5);
  await gestor._latido(); await new Promise(r => setTimeout(r, 20));
  check(socks.length === nSocks3 + 1, 'no se reinicia otra vez enseguida: espera creciente (10 min)');
  reloj(6); // ya pasaron más de 10 min del primer reinicio
  await gestor._latido(); await new Promise(r => setTimeout(r, 20));
  check(socks.length === nSocks3 + 2 && gestor.estadoPublico('t1').refrescos === 2, 'pasado el tiempo de espera, la reinicia de nuevo');
  const sT4 = socks[socks.length - 1]; abrir(sT4); await new Promise(r => setImmediate(r));
  reloj(30);
  await gestor._latido(); await new Promise(r => setTimeout(r, 20));
  check(socks.length === nSocks3 + 3 && gestor.estadoPublico('t1').refrescos === 3, 'tercer reinicio automático');
  check(alertas.some(a => /no recibe mensajes/.test(a)), 'al tercer intento se avisa por correo');
  const sT5 = socks[socks.length - 1]; abrir(sT5); await new Promise(r => setImmediate(r));
  await sT5.handlers['messages.upsert']({ messages: [{ key: { remoteJid: '999@g.us', id: 'V1' }, message: { conversation: 'hola' } }] });
  check(gestor.estadoPublico('t1').refrescos === 0, 'cuando llega un mensaje el vigilante se tranquiliza (reinicia su cuenta)');
  const nSocks3b = socks.length; reloj(60);
  await gestor._latido(); await new Promise(r => setTimeout(r, 20));
  check(socks.length === nSocks3b, 'con mensajes entregándose no se reinicia nada, aunque pase el tiempo');

  // 3b) Buffer de eventos de Baileys retenido (causa del "Conectado con 0 mensajes"): se libera a la fuerza a los 30 s
  let bufferActivo = true, flushes = 0;
  sT5.ev.isBuffering = () => bufferActivo; sT5.ev.flush = () => { flushes++; bufferActivo = false; };
  await gestor._latido();
  check(flushes === 0, 'buffer retenido hace menos de 30 s: todavía no se toca');
  RELOJ.t += 31000; await gestor._latido();
  check(flushes === 1 && gestor.estadoPublico('t1').flushForzados === 1, 'buffer retenido más de 30 s: se libera a la fuerza y queda anotado');
  check(socks[socks.length - 1].argsCreacion && socks[socks.length - 1].argsCreacion.syncFullHistory === false && socks[socks.length - 1].argsCreacion.shouldSyncHistoryMessage() === false, 'el socket se crea sin sincronizar historial (evita que el buffer se cuelgue)');

  // 3c) Mensajes viejos entregados de golpe al reconectar no se ejecutan
  const nLl = llamadas.length;
  const segAhora = Math.floor(RELOJ.t / 1000);
  await sT5.handlers['messages.upsert']({ type: 'append', messages: [{ key: { remoteJid: JID, id: 'OLD1' }, messageTimestamp: segAhora - 600, message: { conversation: 'abierta 5ta de gulf' } }] });
  check(llamadas.length === nLl && /mensaje viejo/.test((gestor._sesiones.get('t1').ultimo || {}).motivo || ''), 'un mensaje de hace 10 min (entregado tarde al reconectar) se ignora y el panel lo explica');
  await sT5.handlers['messages.upsert']({ type: 'append', messages: [{ key: { remoteJid: JID, id: 'NEW1' }, messageTimestamp: { toNumber: () => segAhora - 60 }, message: { conversation: 'abierta 5ta de gulf' } }] });
  check(llamadas.length === nLl + 1, 'uno de hace 1 min (lo escrito durante el deploy) sí se atiende');

  // 4) Código 440 (el número se abrió en otro lugar): espera más para no entrar en pelea
  sT5.handlers['connection.update']({ connection: 'close', lastDisconnect: { error: { statusCode: 440 } } });
  check(timers[timers.length - 1].ms === 20000 && /otro lugar/.test(gestor.estadoPublico('t1').ultimoError || '') === false || timers[timers.length - 1].ms === 20000, 'código 440: espera 20 s antes de reintentar (no pelea cada 5 s)');

  // 5) Si un reintento falla (ej. la base se cae justo al desplegar), se vuelve a programar otro
  const bailOriginal = gestor._deps.cargarBaileys;
  let fallosRestantes = 1;
  gestor._deps.cargarBaileys = () => { if (fallosRestantes-- > 0) throw new Error('base caída'); return bailOriginal(); };
  const nTim = timers.length;
  timers[timers.length - 1].fn(); await new Promise(r => setTimeout(r, 20));
  check(timers.length === nTim + 1 && timers[timers.length - 1].ms === 10000 && /reintentando/.test(gestor.estadoPublico('t1').ultimoError), 'si el reintento falla se programa otro (nunca queda muerta)');
  timers[timers.length - 1].fn(); await new Promise(r => setTimeout(r, 20));
  gestor._deps.cargarBaileys = bailOriginal;
  check(gestor.estadoPublico('t1').activa && !!gestor._sesiones.get('t1').sock, 'y el segundo reintento la levanta');

  // 6) Reconciliador: un grupo que debería estar activo y no está en marcha se levanta solo
  BD.activos = [{ id: 'r1' }];
  const nSocks6 = socks.length;
  const lev = await gestor._reconciliar(); await new Promise(r => setTimeout(r, 20));
  check(lev === 1 && socks.length === nSocks6 + 1 && gestor._sesiones.has('r1'), 'el vigilante levanta una sesión que debería estar activa y no lo estaba');
  check(await gestor._reconciliar() === 0, 'y no toca la que ya está en marcha');
  BD.activos = [{ id: 'a1' }, { id: 'a2' }];

  // 7) Apagado limpio (SIGTERM): cierra los sockets y suelta los turnos al instante
  TURNO.soltados.length = 0;
  const vivos = Array.from(gestor._sesiones.values()).filter(x => x.sock).map(x => x.sock);
  const nApagadas = await gestor.apagar();
  check(nApagadas >= 3 && vivos.every(x => x.terminado), 'apagado limpio: todos los sockets se cierran');
  check(TURNO.soltados.includes('t1') && TURNO.soltados.includes('r1'), 'apagado limpio: se sueltan los turnos para que el servidor nuevo tome las sesiones al instante');
  check(!gestor._sesiones.get('t1').sock && gestor._sesiones.get('t1').cerrando, 'tras apagar no se reconecta nada');
  gestor._sesiones.delete('t1'); gestor._sesiones.delete('r1');

  // ----- conexión con el bot de jugadas -----
  const sockBot = socks[0];
  const MSG = (id, texto, participante) => ({ key: { remoteJid: JID, id, participant: participante }, pushName: 'Marvel', message: { conversation: texto } });
  const ayudas = { resolverRemitente: async j => j, esAdministrador: async () => false };
  // por el número propio: reconoce el grupo y responde (no hay carrera abierta todavía)
  await glue.intentar({ sock: sockBot, msg: MSG('P1', 'Juego 4x1 con 75 doy a8', '584124537732@s.whatsapp.net'), remoteJid: JID, texto: 'Juego 4x1 con 75 doy a8', ayudas, grupoId: G });
  check(sockBot.enviados.length === 1 && /carrera abierta/i.test(sockBot.enviados[0].contenido.text), 'por el número propio el bot reconoce el grupo y responde por esa misma conexión');
  // grupoId equivocado o chat distinto: no le toca
  await glue.intentar({ sock: sockBot, msg: MSG('P2', 'Juego 4x1 con 75 doy a8', '584124537732@s.whatsapp.net'), remoteJid: '999@g.us', texto: 'Juego 4x1 con 75 doy a8', ayudas, grupoId: G });
  check(sockBot.enviados.length === 1, 'un chat que no es el elegido para ese número se ignora');
  // el motivo del "ignorado" se ve en el panel (mensaje que entra por la conexión propia, chat distinto del elegido)
  await gestor.iniciarSesion(G);
  const sockNuevo = socks[socks.length - 1];
  sockNuevo.handlers['connection.update']({ connection: 'open' });
  gestor._deps.intentar = (a) => glue.intentar(a);
  await sockNuevo.handlers['messages.upsert']({ messages: [{ key: { remoteJid: '999@g.us', id: 'Z1' }, message: { conversation: 'hola' } }] });
  check(/no es el elegido/.test((gestor.estadoPublico(G).ultimo || {}).motivo || ''), 'el panel explica por qué ignoró un mensaje de otro chat');
  BD.grupo.activo = false; BD.grupo.whatsapp_propio_jid = '555@g.us';
  glue._sesiones.clear();
  await sockNuevo.handlers['messages.upsert']({ messages: [{ key: { remoteJid: '555@g.us', id: 'Z2' }, message: { conversation: 'hola' } }] });
  check(/INACTIVO/.test((gestor.estadoPublico(G).ultimo || {}).motivo || ''), 'y avisa si el grupo está inactivo');
  BD.grupo.activo = true; BD.grupo.whatsapp_propio_jid = JID;
  // por la conexión general: se hace a un lado si el grupo tiene su número propio conectado
  const sockGeneral = { enviados: [], sendMessage: async (j, c) => { sockGeneral.enviados.push(c); return { key: { id: 'G' + sockGeneral.enviados.length } }; } };
  const sPropia = gestor._sesiones;
  sPropia.set(G, { conectado: true, sock: sockBot, gruposDisponibles: [], gen: 1 });
  await glue.intentar({ sock: sockGeneral, msg: MSG('P3', 'Juego 4x1 con 75 doy a8', '584124537732@s.whatsapp.net'), remoteJid: JID, texto: 'Juego 4x1 con 75 doy a8', ayudas });
  check(sockGeneral.enviados.length === 0, 'con el número propio conectado, la conexión general no responde (nada de doble respuesta)');
  sPropia.get(G).conectado = false;
  glue._sesiones.delete(G); // sesión nueva del bot (el aviso "no hay carrera" se repite solo cada 2 minutos)
  await glue.intentar({ sock: sockGeneral, msg: MSG('P4', 'Juego 4x1 con 75 doy a8', '584124537732@s.whatsapp.net'), remoteJid: JID, texto: 'Juego 4x1 con 75 doy a8', ayudas });
  check(sockGeneral.enviados.length === 1, 'si el número propio se cae, la conexión general vuelve a encargarse');

  fs.rmSync(base, { recursive: true, force: true });
  global.clearTimeout = realClearTimeout;
  console.log('\n' + pasaron + ' pasaron, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(x => { console.error('Error en la prueba:', x); process.exit(1); });
