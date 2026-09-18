// =================================================================
// PRUEBA DE INTEGRACIÓN: whatsappBot.js — el flujo COMPLETO de la
// ampliación grande (03-09-2026, más tarde todavía): auto-importar cada
// "SABANA DE JUGADAS" al instante, sustituir la sábana del día, avisar
// en vivo a medida que un partido termina, "SABANA DE JUGADAS FINAL"
// bloqueando el día, y el cierre (listado + totales) en cuanto todos los
// tickets tienen resultado. Formato del disparador revisado 04-09-2026,
// a pedido del usuario: "SABANA DE JUGADAS" y, en la línea de ABAJO, la
// fecha como "cordón de seguridad" — sin esa fecha el mensaje se
// rechaza, nunca se asume "hoy".
//
// A diferencia de iniciarBotWhatsApp() (que sí necesita
// @whiskeysockets/baileys, imposible de instalar/probar en este
// entorno — ver la advertencia grande en whatsappBot.js), TODO lo que
// se prueba acá (manejarMensajeEntrante* / procesarDiaAbierto) NO
// depende de baileys en absoluto: son funciones de JavaScript común que
// reciben un `sock` falso (con un sendMessage() que solo guarda lo que
// se le manda) y un `msg` con la misma forma que entrega Baileys. Por
// eso whatsappBot.js requiere la librería SOLO adentro de
// iniciarBotWhatsApp() — nunca al cargar el archivo — así este archivo
// se puede requerir y probar en este sandbox sin ningún problema (ver
// también test_wiring.js, donde whatsappBot.js YA no está excluido).
//
// Mismo patrón de "pg"/"fetch" falsos en memoria que
// test_sabana_polla_y_mayusculas.js / test_sabana_dia.js — con un fetch
// MUTABLE (la función `partidoEstaFinal()` de más abajo) para poder
// simular, en la MISMA prueba, que un partido pasa de "todavía no
// terminó" a "Final" entre una verificación y la siguiente — así se
// prueba de verdad el corazón del aviso en vivo: volver a llamar
// procesarSabana() con el MISMO texto detecta el resultado nuevo solo.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g1';
const JID = '120363000000000001@g.us';
const FECHA = '2026-09-02';

let siguienteIdPendiente = 1;
const TABLAS = {
  grupos: [{ id: GRUPO_ID, nombre: 'Deportes Bernal', whatsapp_grupo_jid: JID, whatsapp_habilitado: true }],
  jugadores: [{ id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', activo: true, comision_propia: 0 }],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  polla_historial: [],
  sabanas_pendientes_whatsapp: [],
  whatsapp_dia_estado: [],
  dias_confirmados: []
};

// --- fetch falso, con el partido Astros/Rangers controlable a mano ---
let partidoFinal = false; // arranca "en progreso" (sin resultado todavía)
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    if (!partidoFinal) {
      return Promise.resolve({ json: async () => ({ dates: [{ games: [] }] }) }); // "no hay nada definitivo todavía"
    }
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: 'Houston Astros' }, score: 5 },
              away: { team: { name: 'Texas Rangers' }, score: 1 }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA + 'T23:00:00Z',
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

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  // --- lo que necesita procesarSabana()/cargarConfigGrupo() ---
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  // (04-09-2026) registrosSinCambios() en historial.js — esta prueba no
  // trackea el contenido real de tickets_historial, así que "sin filas
  // guardadas todavía" es siempre la respuesta correcta acá.
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };

  // --- historial.js: confirmarDia()/desconfirmarDia()/estadoDia() (07-09-2026:
  // ahora también las usa whatsappBot.js, para confirmar solo el día en
  // Balance General apenas se manda el cierre — ver procesarDiaAbierto) ---
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
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO alertas/i.test(sql)) return { rows: [{ id: 'a-' + Math.random().toString(36).slice(2) }] };

  // --- obtenerNombreGrupo (04-09-2026: el encabezado de los mensajes que
  // manda el bot usa el nombre real del Grupo, no un texto fijo) ---
  if (/^SELECT nombre FROM grupos WHERE id = \$1/i.test(sql)) {
    const [grupoId] = params;
    const fila = TABLAS.grupos.find(g => g.id === grupoId);
    return { rows: fila ? [{ nombre: fila.nombre }] : [] };
  }

  // --- grupoIdPorJid (04-09-2026: ahora también exige whatsapp_habilitado = true) ---
  if (/^SELECT id FROM grupos WHERE whatsapp_grupo_jid = \$1 AND whatsapp_habilitado = true/i.test(sql)) {
    const [jid] = params;
    const fila = TABLAS.grupos.find(g => g.whatsapp_grupo_jid === jid && g.whatsapp_habilitado === true);
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
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id && p.estado === 'pendiente');
    if (fila) { fila.estado = 'importada'; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'descartada'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id && p.estado === 'pendiente');
    if (fila) { fila.estado = 'descartada'; fila.nota = nota || null; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'error'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id && p.estado === 'pendiente');
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
  if (/^INSERT INTO whatsapp_dia_estado \(grupo_id, fecha, sabana_final_en\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    let fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (!fila) { fila = filaVaciaDia(grupoId, fecha); TABLAS.whatsapp_dia_estado.push(fila); }
    if (!fila.sabana_final_en) fila.sabana_final_en = new Date();
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
  if (/^UPDATE whatsapp_dia_estado SET cierre_enviado_en = now\(\)/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === grupoId && w.fecha === fecha);
    if (fila) fila.cierre_enviado_en = new Date();
    return { rows: [] };
  }

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
const { obtenerEstadoDia } = require(path.join(__dirname, '..', 'src', 'services', 'whatsappDiaEstado'));
const { estadoDia: estadoDiaConfirmado } = require(path.join(__dirname, '..', 'src', 'services', 'historial'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// sock falso: solo guarda lo que se le manda, no habla con WhatsApp de verdad.
function crearSockFalso() {
  const mensajes = [];
  return { mensajes, sendMessage: async (jid, contenido) => { mensajes.push({ jid, text: contenido.text }); } };
}

function crearMensaje(texto, { fromMe = false } = {}) {
  return { key: { remoteJid: JID, fromMe, participant: JID.replace('@g.us', '') + ':1@s.whatsapp.net' }, message: { conversation: texto }, pushName: 'Cliente Prueba' };
}

function ultimaSabanaPendiente() {
  return TABLAS.sabanas_pendientes_whatsapp[TABLAS.sabanas_pendientes_whatsapp.length - 1];
}

(async function main() {
  // --- 1) mensajes que NUNCA activan nada: chat 1 a 1, sin "SABANA DE JUGADAS" ---
  const sockIgnorado = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockIgnorado, { key: { remoteJid: '5804121234567@s.whatsapp.net', fromMe: false }, message: { conversation: 'SABANA DE JUGADAS\n' + FECHA } });
  await whatsappBot.manejarMensajeEntrante(sockIgnorado, crearMensaje('Hola, buenas tardes'));
  check(sockIgnorado.mensajes.length === 0, 'un chat 1 a 1 o un mensaje sin "SABANA DE JUGADAS" nunca generan ningún envío');
  check(TABLAS.sabanas_pendientes_whatsapp.length === 0, 'tampoco generan ningún registro en la bandeja de auditoría');

  // --- 1.c) (04-09-2026, a pedido del usuario) un mensaje "fromMe" (mandado
  // desde el MISMO número que escaneó el QR y corre el bot) SÍ se procesa
  // igual que cualquier otro — antes se ignoraba en silencio, y era el
  // propio usuario quien mandaba la sábana desde ese número. Usa su PROPIA
  // fecha (distinta de FECHA, la que usan las pruebas 2 en adelante) para
  // no interferir con "es la primera sábana del día" de esas pruebas ---
  const FECHA_FROMME = '2026-09-01';
  const sockFromMe = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockFromMe, crearMensaje('SABANA DE JUGADAS\n' + FECHA_FROMME + '\nPEDRO\nhouston -120\n100//90', { fromMe: true }));
  const pendFromMe = ultimaSabanaPendiente();
  check(!!pendFromMe && pendFromMe.estado === 'importada', 'una "SABANA DE JUGADAS" mandada "fromMe" (desde el número del propio bot) SE IMPORTA igual que si la mandara cualquier otro participante del grupo');
  check(sockFromMe.mensajes.length === 0, '(18-09-2026) una importación exitosa YA NO manda ningún aviso solo al grupo — el resumen se pide a mano con el botón o un comando de chat');
  check((await obtenerEstadoDia(GRUPO_ID, FECHA_FROMME)) !== null, 'y queda guardada bajo su propia fecha en whatsapp_dia_estado');

  // --- 1.b) el "cordón de seguridad": "SABANA DE JUGADAS" SIN una fecha
  // válida en la línea de abajo se RECHAZA — el bot nunca asume "hoy" ---
  const sockSinFecha = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockSinFecha, crearMensaje('SABANA DE JUGADAS\nPEDRO\nhouston -120\n100//90'));
  check(sockSinFecha.mensajes.length === 1 && /No se pudo leer la fecha/.test(sockSinFecha.mensajes[0].text), 'sin una fecha reconocible en la segunda línea, se avisa en el grupo pidiendo que la reenvíen con el formato correcto');
  const pendSinFecha = ultimaSabanaPendiente();
  check(pendSinFecha.estado === 'error' && /Falta la fecha/i.test(pendSinFecha.nota || ''), 'el intento sin fecha válida queda registrado como "error" en la bandeja, con el motivo');
  check((await obtenerEstadoDia(GRUPO_ID, FECHA)) === null, 'y sobre todo: NO se carga ninguna sábana bajo ninguna fecha (ni "hoy" ni ninguna otra) — el cordón de seguridad hizo su trabajo');

  // --- 2) primera "SABANA DE JUGADAS" del día: se auto-importa, pero
  // (18-09-2026) ya no se manda ningún aviso solo al grupo — la
  // importación queda lista para cuando alguien pida el resumen a mano ---
  const sock1 = crearSockFalso();
  const textoSabana1 = ['SABANA DE JUGADAS', FECHA, 'PEDRO', 'houston -120', '100//90'].join('\n');
  await whatsappBot.manejarMensajeEntrante(sock1, crearMensaje(textoSabana1));

  const pend1 = ultimaSabanaPendiente();
  check(!!pend1 && pend1.estado === 'importada' && pend1.texto === textoSabana1, 'la primera "SABANA DE JUGADAS" queda registrada en la bandeja de auditoría, "importada", con el mensaje ORIGINAL completo (trigger + fecha incluidos)');
  const dia1 = await obtenerEstadoDia(GRUPO_ID, FECHA);
  check(!!dia1 && dia1.ultimoTexto === 'PEDRO\nhouston -120\n100//90', 'whatsapp_dia_estado guarda el CUERPO de la sábana (sin las líneas "SABANA DE JUGADAS"/fecha) como "la última" del día — así no queda un ticket fantasma que nunca se resuelve');
  check(dia1.sabanaFinalEn === null, 'el día NO está cerrado todavía (nunca llegó "SABANA DE JUGADAS FINAL")');
  check(sock1.mensajes.length === 0, '(18-09-2026) la importación NO manda ningún aviso al grupo por su cuenta — el bot nunca decide solo mandar nada, ni siquiera la primera vez que se carga un día');

  // --- 3) una SEGUNDA "SABANA DE JUGADAS" llega poco después (mismo
  // día): sustituye el texto guardado — tampoco manda ningún mensaje,
  // como cualquier importación ---
  const sock2 = crearSockFalso();
  const cuerpoSabana2 = ['PEDRO', 'houston -120', '100//90', '', 'MANOLO', 'houston -120', '50//45'].join('\n');
  const textoSabana2 = 'SABANA DE JUGADAS\n' + FECHA + '\n' + cuerpoSabana2;
  await whatsappBot.manejarMensajeEntrante(sock2, crearMensaje(textoSabana2));
  const dia2 = await obtenerEstadoDia(GRUPO_ID, FECHA);
  check(dia2.ultimoTexto === cuerpoSabana2, 'la segunda sábana SUSTITUYE la primera (nunca se acumulan 2 sábanas del mismo día)');
  check(sock2.mensajes.length === 0, 'tampoco esta segunda importación manda ningún mensaje al grupo');
  check(TABLAS.sabanas_pendientes_whatsapp.filter(p => p.grupo_id === GRUPO_ID && p.fecha_detectada === FECHA && p.estado === 'importada').length === 2, 'ambas sábanas quedan registradas como "importada" en la bandeja de auditoría, aunque ninguna haya generado un aviso');

  // --- 4) "SABANA DE JUGADAS FINAL" llega mientras el partido TODAVÍA no
  // terminó: bloquea el día para nuevas sábanas, pero NO cierra todavía
  // (faltan resultados) ---
  const sock3 = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sock3, crearMensaje('SABANA DE JUGADAS FINAL\n' + FECHA));
  const dia3 = await obtenerEstadoDia(GRUPO_ID, FECHA);
  check(!!dia3.sabanaFinalEn, 'llegó "SABANA DE JUGADAS FINAL": el día queda marcado como cerrado para nuevas sábanas');
  check(dia3.cierreEnviadoEn === null, 'pero el CIERRE (listado final + totales) todavía NO se manda — el partido de MANOLO sigue sin resultado');
  const pendFinal1 = ultimaSabanaPendiente();
  check(pendFinal1.estado === 'descartada' && /cierre sin jugadas nuevas/i.test(pendFinal1.nota || ''), 'el mensaje "SABANA DE JUGADAS FINAL" (sin ninguna jugada nueva adentro) se registra como "descartada" con la nota explicando que se sigue usando la sábana previa — NO es un error');

  // --- 5) con el día ya cerrado, una nueva "SABANA DE JUGADAS" (no
  // FINAL) para esa misma fecha se rechaza con un aviso en el grupo ---
  const sock4 = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sock4, crearMensaje(['SABANA DE JUGADAS', FECHA, 'PEDRO', 'houston -120', '200//180'].join('\n')));
  const dia4 = await obtenerEstadoDia(GRUPO_ID, FECHA);
  check(dia4.ultimoTexto === cuerpoSabana2, 'la sábana guardada NO cambió — el intento de actualizarla después del cierre se ignora');
  check(sock4.mensajes.length === 1 && /ya fue cerrada con \*SABANA DE JUGADAS FINAL\*/.test(sock4.mensajes[0].text), 'se avisa en el grupo que esa fecha ya está cerrada y el mensaje se ignoró');
  const pendRechazada = ultimaSabanaPendiente();
  check(pendRechazada.estado === 'error' && /ya fue cerrada con SABANA DE JUGADAS FINAL/i.test(pendRechazada.nota || ''), 'el intento rechazado queda registrado como "error" en la bandeja, con el motivo');

  // --- 6) un segundo "SABANA DE JUGADAS FINAL" (duplicado) también se avisa y se ignora ---
  const sock5 = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sock5, crearMensaje('SABANA DE JUGADAS FINAL\n' + FECHA));
  check(sock5.mensajes.length === 1 && /ya se había recibido \*SABANA DE JUGADAS FINAL\*/i.test(sock5.mensajes[0].text), 'un segundo "SABANA DE JUGADAS FINAL" para el mismo día se avisa como duplicado');
  const pendDup = ultimaSabanaPendiente();
  check(pendDup.estado === 'error' && /Duplicado/i.test(pendDup.nota || ''), 'el duplicado queda registrado en la bandeja con la nota "Duplicado..."');

  // --- 7) el partido TERMINA: se llama procesarDiaAbierto a mano (con
  // forzar:true, como hace el botón "Enviar resumen ahora" del panel) y,
  // como ahora SÍ están todos los tickets resueltos y el día ya tenía
  // "SABANA FINAL", se manda el CIERRE — 2 mensajes: listado final +
  // totales — y el día se cierra ---
  partidoFinal = true;
  const sock6 = crearSockFalso();
  const resultado = await whatsappBot.procesarDiaAbierto(sock6, GRUPO_ID, JID, FECHA, { forzar: true });
  check(resultado.accion === 'ENVIAR_CIERRE', 'con el partido ya "Final" y SABANA FINAL recibido, procesarDiaAbierto decide ENVIAR_CIERRE');
  check(sock6.mensajes.length === 2, 'el cierre manda EXACTAMENTE 2 mensajes: primero el listado, después los totales (nunca juntos en uno solo)');
  check(sock6.mensajes[0].text.includes('✅ *SÁBANA FINAL — todos los resultados*'), 'el primer mensaje del cierre es el listado, con el título de "SÁBANA FINAL"');
  check(!sock6.mensajes[0].text.includes('❌') && !sock6.mensajes[0].text.includes('⭕') && (sock6.mensajes[0].text.match(/\/\/[\d.]+✅/g) || []).length === 2, 'los 2 tickets (houston -120, Astros ganaron) aparecen GANADA (arriesga//paga✅) — ninguno queda ❌/⭕/sin ícono');
  check(sock6.mensajes[1].text.includes('*TOTALES DEL DÍA*'), 'el segundo mensaje del cierre es, aparte, el de los totales');
  const diaFinal = await obtenerEstadoDia(GRUPO_ID, FECHA);
  check(!!diaFinal.cierreEnviadoEn, 'el día queda marcado como cerrado (cierreEnviadoEn) — no se le va a volver a mandar nada más');

  // --- 7.b) (07-09-2026, a pedido del usuario: "que la sabana automatica
  // funcione como la manual en todo sentido... quede en el balance
  // general") — apenas se manda el cierre, el día se confirma SOLO en
  // Balance General (dias_confirmados), sin que nadie tenga que entrar al
  // panel a apretar "💾 Guardar Día" a mano ---
  const confirmacion = await estadoDiaConfirmado(GRUPO_ID, FECHA);
  check(confirmacion.confirmado === true, 'apenas se manda el cierre automático, el día queda confirmado SOLO en Balance General — equivalente automático de "💾 Guardar Día"');
  check(!!confirmacion.confirmadoEn, 'la confirmación automática trae su propia hora, igual que si se hubiera confirmado a mano');

  // --- 8) una vez cerrado, procesarDiaAbierto ya no manda nada de más,
  // ni aunque se fuerce (el cierre solo se manda una vez) ---
  const sock7 = crearSockFalso();
  const resultado2 = await whatsappBot.procesarDiaAbierto(sock7, GRUPO_ID, JID, FECHA, { forzar: true });
  check(resultado2.accion === 'ENVIAR_CIERRE' && sock7.mensajes.length === 2, 'procesarDiaAbierto es idempotente: si se lo vuelve a llamar a mano (botón o comando) después de cerrado, recalcula lo mismo (no revienta)');

  // --- 9) un mensaje con una jugada mal escrita (sin ningún ticket
  // reconocible) se registra como "error", con un aviso en el grupo ---
  const sock8 = crearSockFalso();
  const FECHA_ERROR = '2026-09-06';
  await whatsappBot.manejarMensajeEntrante(sock8, crearMensaje('SABANA DE JUGADAS\n' + FECHA_ERROR + '\nesto no es ninguna jugada reconocible'));
  const pendError = ultimaSabanaPendiente();
  check(pendError.estado === 'error', 'un mensaje sin ninguna jugada válida se registra como "error" en la bandeja');
  check(sock8.mensajes.length === 1 && /No se pudo leer la sábana/.test(sock8.mensajes[0].text), 'se avisa en el grupo que no se pudo leer la sábana, para que la vuelvan a mandar bien');
  const diaError = await obtenerEstadoDia(GRUPO_ID, FECHA_ERROR);
  check(!diaError || !diaError.ultimoTexto, 'un mensaje que no se pudo procesar NUNCA llega a guardarse como "la sábana" de ese día');

  // =================================================================
  // --- 10) (07-09-2026, más tarde todavía, a pedido del usuario: "antes
  // tenia el error de aunque haya pasado una hora despues del juego no lo
  // actualizaba solo igual") — LA CAUSA real de ese bug: el reloj de
  // fondo llama procesarDiaAbierto() cada 5 minutos, y esa función SIEMPRE
  // llama registrarVerificacion() (pase lo que pase, hasta cuando decide
  // "ESPERAR") — así que `ultima_verificacion_en` quedaba pisada con la
  // hora actual cada 5 minutos. Como decidirAccion() ANTES calculaba la
  // espera de 1 hora contra ESE campo, "cuánto pasó desde la última
  // verificación" nunca llegaba a superar los ~5 minutos del propio
  // reloj — el aviso automático de "cambió algo" NUNCA se llegaba a
  // disparar solo (solo con el botón manual, que fuerza, o la primerísima
  // vez). Reproducido acá armando a mano un día con su ÚLTIMO ENVÍO real
  // de hace 90 minutos pero su ÚLTIMA VERIFICACIÓN de hace apenas 2
  // minutos (como si el reloj de fondo lo hubiera venido revisando cada
  // 5 minutos sin mandar nada, tal como pasaba antes del arreglo) — con
  // el arreglo, decidirAccion() ya no mira la verificación, mira el envío
  // real, así que sí manda la actualización.
  // =================================================================
  const FECHA_RELOJ = '2026-09-07';
  TABLAS.whatsapp_dia_estado.push({
    grupo_id: GRUPO_ID,
    fecha: FECHA_RELOJ,
    ultimo_texto: 'PEDRO\nhouston -120\n100//90',
    ultimo_texto_en: new Date(Date.now() - 95 * 60 * 1000),
    sabana_final_en: null,
    ultima_verificacion_en: new Date(Date.now() - 2 * 60 * 1000), // "revisado" hace solo 2 minutos (el reloj de fondo pasó varias veces)
    ultimo_envio_resumen_en: new Date(Date.now() - 90 * 60 * 1000), // pero el ÚLTIMO MENSAJE DE VERDAD fue hace 90 minutos
    ultimo_hash_resumen: 'un-hash-viejo-que-ya-no-coincide',
    cierre_enviado_en: null
  });
  const sockReloj = crearSockFalso();
  const resultadoReloj = await whatsappBot.procesarDiaAbierto(sockReloj, GRUPO_ID, JID, FECHA_RELOJ, { forzar: false });
  check(resultadoReloj.accion === 'ENVIAR_ACTUALIZACION', 'con el ÚLTIMO ENVÍO real de hace 90 minutos (ya pasó la hora) pero la ÚLTIMA VERIFICACIÓN de hace solo 2 minutos, ahora SÍ manda la actualización — antes del arreglo esto daba ESPERAR para siempre, porque miraba la verificación en vez del envío');
  check(sockReloj.mensajes.length === 1, 'y ese envío manda su mensaje normal al grupo');

  // Regresión: si el ÚLTIMO ENVÍO real fue hace poco (10 minutos), sigue
  // esperando la hora tal cual — el arreglo no volvió el aviso "siempre
  // instantáneo", solo corrigió CONTRA QUÉ se mide la hora.
  const FECHA_RELOJ2 = '2026-09-05';
  TABLAS.whatsapp_dia_estado.push({
    grupo_id: GRUPO_ID,
    fecha: FECHA_RELOJ2,
    ultimo_texto: 'PEDRO\nhouston -120\n100//90',
    ultimo_texto_en: new Date(Date.now() - 15 * 60 * 1000),
    sabana_final_en: null,
    ultima_verificacion_en: new Date(Date.now() - 1 * 60 * 1000),
    ultimo_envio_resumen_en: new Date(Date.now() - 10 * 60 * 1000), // último envío real hace solo 10 minutos
    ultimo_hash_resumen: 'un-hash-viejo-que-ya-no-coincide',
    cierre_enviado_en: null
  });
  const sockReloj2 = crearSockFalso();
  const resultadoReloj2 = await whatsappBot.procesarDiaAbierto(sockReloj2, GRUPO_ID, JID, FECHA_RELOJ2, { forzar: false });
  check(resultadoReloj2.accion === 'ESPERAR', 'regresión: si el último envío real fue hace solo 10 minutos, se sigue esperando la hora normalmente (el arreglo no manda todo el tiempo, solo corrige el bug de la cuenta)');
  check(sockReloj2.mensajes.length === 0, 'y por lo tanto no manda ningún mensaje todavía');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
