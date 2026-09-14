// =================================================================
// PRUEBA: comandos de chat del bot de WhatsApp (09-09-2026, a pedido del
// usuario: "quiero que reconoscas estos patrones si te escribe el
// numero de telefono que tienes registrado para reconocer sabana" —
// "actualizar sabana"/"actualizar juegos"/"act", "saldo final"/"saldo
// del dia", "corte semana"/"saldo semana"/"saldo semanal" y "saldo total
// semana <nombre>"/"total semana <nombre>").
//
// Cubre 2 capas separadas, igual que el resto del proyecto:
//   1) whatsappTrigger.detectarComando() — detección PURA de texto, sin
//      base de datos (mayúsculas/minúsculas, tildes, espacios de más).
//   2) whatsappBot.manejarComando()/manejarMensajeEntrante() —
//      integración completa con el mismo patrón de "pg"/"fetch" falsos
//      en memoria que test_whatsapp_bot_flujo.js.
//
// NOTA sobre fechas: "corte semana"/"saldo total semana <nombre>" leen
// la semana actual (lunes a domingo) con calcularRangoRapido('semana'),
// que depende de la fecha REAL de hoy — para que esta prueba nunca se
// rompa sola con el paso del tiempo (ver el bug ya encontrado y
// corregido en test_whatsapp_dia_estado.js), los tickets de prueba se
// ubican SIEMPRE relativos a ese mismo rango calculado en el momento de
// correr la prueba (el lunes de la semana actual + 1/+2 días), nunca en
// fechas fijas. "actualizar sabana"/"saldo final" sí usan la fecha real
// de HOY (así funciona el comando de verdad), así que esos tickets se
// ubican con la fecha de hoy.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g1';
const JID = '120363000000000009@g.us';

let siguienteIdPendiente = 1;
const TABLAS = {
  grupos: [{ id: GRUPO_ID, nombre: 'Deportes Bernal', whatsapp_grupo_jid: JID, whatsapp_habilitado: true, modelo_comision: 'plano', comision_tiers: [], comandos_whatsapp_habilitado: true, comandos_whatsapp_numero: JID.replace('@g.us', '') }],
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', activo: true, comision_propia: 0 },
    { id: 'j-bernal', grupo_id: GRUPO_ID, nombre: 'BERNAL', activo: true, comision_propia: 0 },
    { id: 'j-lopez', grupo_id: GRUPO_ID, nombre: 'LOPEZ', activo: true, comision_propia: 10 },
    { id: 'j-carlos', grupo_id: GRUPO_ID, nombre: 'CARLOS', activo: true, comision_propia: 0 }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  tickets_historial: [],
  polla_historial: [],
  transferencias: [],
  sabanas_pendientes_whatsapp: [],
  whatsapp_dia_estado: [],
  dias_confirmados: []
};

// --- fetch falso, con el partido controlable a mano (mismo patrón que
// test_whatsapp_bot_flujo.js) ---
let partidoFinal = false;
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    if (!partidoFinal) return Promise.resolve({ json: async () => ({ dates: [{ games: [] }] }) });
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: { home: { team: { name: 'Houston Astros' }, score: 5 }, away: { team: { name: 'Texas Rangers' }, score: 1 } },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: new Date().toISOString().split('T')[0] + 'T23:00:00Z',
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

function enRango(fila, desde, hasta) {
  return (!desde || fila.fecha >= desde) && (!hasta || fila.fecha <= hasta);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  // --- cargarConfigGrupo() / procesarSabana() ---
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: fila ? [{ modelo_comision: fila.modelo_comision, comision_tiers: fila.comision_tiers }] : [] };
  }
  if (/^SELECT comandos_whatsapp_habilitado, comandos_whatsapp_numero FROM grupos WHERE id = \$1/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: fila ? [{ comandos_whatsapp_habilitado: !!fila.comandos_whatsapp_habilitado, comandos_whatsapp_numero: fila.comandos_whatsapp_numero || null }] : [] };
  }
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };

  // --- tickets_historial: guardarEnHistorial()/leerHistorial() ---
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && t.fecha === fecha);
    return { rows: filas.map(t => ({ cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado })) };
  }
  if (/^DELETE FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.tickets_historial = TABLAS.tickets_historial.filter(t => !(t.grupo_id === grupoId && t.fecha === fecha));
    return { rows: [] };
  }
  if (/^INSERT INTO tickets_historial \(grupo_id, fecha, cliente_nombre, jugador_id, ticket_label, detalle, arriesga, gana, estado, logros\)/i.test(sql)) {
    const [grupoId, fecha, clienteNombre, jugadorId, ticketLabel, detalle, arriesga, gana, estado, logros] = params;
    TABLAS.tickets_historial.push({ id: 't' + (TABLAS.tickets_historial.length + 1), grupo_id: grupoId, fecha, cliente_nombre: clienteNombre, jugador_id: jugadorId, ticket_label: ticketLabel, detalle, arriesga, gana, estado, logros });
    return { rows: [] };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ id: t.id, fecha: t.fecha, cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado, logros: t.logros })) };
  }

  // --- polla/transferencias (calcularBalanceGeneral) ---
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) return { rows: [] };

  // --- dias_confirmados: confirmarDia()/desconfirmarDia() ---
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

  // --- obtenerNombreGrupo / grupoIdPorJid ---
  if (/^SELECT nombre FROM grupos WHERE id = \$1/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: fila ? [{ nombre: fila.nombre }] : [] };
  }
  if (/^SELECT id FROM grupos WHERE whatsapp_grupo_jid = \$1 AND whatsapp_habilitado = true/i.test(sql)) {
    const fila = TABLAS.grupos.find(g => g.whatsapp_grupo_jid === params[0] && g.whatsapp_habilitado === true);
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
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id);
    if (fila) { fila.estado = 'importada'; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'descartada'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id);
    if (fila) { fila.estado = 'descartada'; fila.nota = nota || null; fila.procesado_en = new Date(); }
    return { rows: fila ? [fila] : [] };
  }
  if (/^UPDATE sabanas_pendientes_whatsapp SET estado = 'error'/i.test(sql)) {
    const [grupoId, id, nota] = params;
    const fila = TABLAS.sabanas_pendientes_whatsapp.find(p => p.grupo_id === grupoId && p.id === id);
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
const { detectarComando } = require(path.join(__dirname, '..', 'src', 'services', 'whatsappTrigger'));
const { formatearFechaISO, calcularRangoRapido, estadoDia: estadoDiaConfirmado } = require(path.join(__dirname, '..', 'src', 'services', 'historial'));
const { generarTextoBalanceSemanalCliente, generarTextoPorcentajeSemanalCliente, nombreDiaSemana } = require(path.join(__dirname, '..', 'src', 'services', 'planoWhatsAppTexto'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function crearSockFalso() {
  const mensajes = [];
  return { mensajes, sendMessage: async (jid, contenido) => { mensajes.push({ jid, text: contenido.text }); } };
}

function crearMensaje(texto) {
  return { key: { remoteJid: JID, fromMe: false, participant: JID.replace('@g.us', '') + ':1@s.whatsapp.net' }, message: { conversation: texto }, pushName: 'Cliente Prueba' };
}

function fechaMasDias(fechaISO, n) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

(async function main() {
  // =================================================================
  // 1) detectarComando() — pura, sin base de datos
  // =================================================================
  check(detectarComando('actualizar sabana').tipo === 'actualizar_sabana', '"actualizar sabana" se reconoce');
  check(detectarComando('Actualizar Sábana').tipo === 'actualizar_sabana', '"Actualizar Sábana" (mayúsculas + tilde) se reconoce igual');
  check(detectarComando('actualizar juegos').tipo === 'actualizar_sabana', '"actualizar juegos" se reconoce');
  check(detectarComando('act').tipo === 'actualizar_sabana', '"act" solo se reconoce');
  check(detectarComando('  ACT  ').tipo === 'actualizar_sabana', '"  ACT  " (espacios + mayúsculas) se reconoce igual');
  check(detectarComando('actuar sabana') === null, '"actuar sabana" (typo de verdad, no solo tildes/mayúsculas) NO se reconoce');

  check(detectarComando('saldo final').tipo === 'saldo_dia', '"saldo final" se reconoce');
  check(detectarComando('Saldo Del Día').tipo === 'saldo_dia', '"Saldo Del Día" se reconoce');
  check(detectarComando('saldo del dia') !== null, '"saldo del dia" (sin tilde) se reconoce');

  check(detectarComando('corte semana').tipo === 'corte_semana', '"corte semana" se reconoce');
  check(detectarComando('saldo semana').tipo === 'corte_semana', '"saldo semana" se reconoce');
  check(detectarComando('SALDO SEMANAL').tipo === 'corte_semana', '"SALDO SEMANAL" se reconoce');

  const cmdCliente1 = detectarComando('saldo total semana bernal');
  check(cmdCliente1 && cmdCliente1.tipo === 'saldo_cliente' && cmdCliente1.nombre === 'bernal', '"saldo total semana bernal" se reconoce con el nombre "bernal"');
  const cmdCliente2 = detectarComando('total semana LOPEZ');
  check(cmdCliente2 && cmdCliente2.tipo === 'saldo_cliente' && cmdCliente2.nombre === 'lopez', '"total semana LOPEZ" se reconoce con el nombre en minúsculas ("lopez")');
  const cmdCliente3 = detectarComando('  Total   Semana   Ana Maria  ');
  check(cmdCliente3 && cmdCliente3.tipo === 'saldo_cliente' && cmdCliente3.nombre === 'ana maria', 'nombres con más de una palabra y espacios de más también se reconocen ("ana maria")');

  check(detectarComando('hola, buenas tardes') === null, 'un mensaje de chat normal no dispara ningún comando');
  check(detectarComando('SABANA DE JUGADAS\n2026-09-09\nPEDRO\nhouston -120\n100//90') === null, 'una "SABANA DE JUGADAS" de verdad no se confunde con ningún comando de chat');
  check(detectarComando('') === null, 'un texto vacío no dispara nada');
  check(detectarComando(null) === null, 'un valor no-string no revienta, devuelve null');

  // Un comando escrito como primera línea de un mensaje más largo también
  // se reconoce (mismo criterio que detectarTriggerSabana).
  check(detectarComando('act\n(mensaje pegado con algo más abajo)').tipo === 'actualizar_sabana', 'un comando en la primera línea de un mensaje más largo también se reconoce');

  // =================================================================
  // 2) generarTextoBalanceSemanalCliente/generarTextoPorcentajeSemanalCliente — puras
  // =================================================================
  const textoSinJugadas = generarTextoBalanceSemanalCliente('CARLOS', { porFecha: {}, totalResultado: 0, totalComision: 0 });
  check(textoSinJugadas.includes('*Cliente: CARLOS*'), 'el balance semanal siempre arranca con "Cliente: <nombre>"');
  check(textoSinJugadas.includes('(sin jugadas esta semana)'), 'un cliente sin ninguna jugada esta semana lo dice explícito, en vez de una lista vacía');
  check(textoSinJugadas.includes('*TOTAL SEMANA*') && textoSinJugadas.includes('+0.00$'), 'el total semana de alguien sin jugadas es +0.00$');

  const datosBernal = { porFecha: { '2026-09-07': { resultado: -200, comision: 0 }, '2026-09-08': { resultado: 150, comision: 0 } }, totalResultado: -50, totalComision: 0 };
  const textoBernal = generarTextoBalanceSemanalCliente('BERNAL', datosBernal);
  check(textoBernal.includes(nombreDiaSemana('2026-09-07') + ': -200.00$'), 'cada día con jugadas muestra su nombre en español + el monto con signo (lunes: -200.00$)');
  check(textoBernal.includes(nombreDiaSemana('2026-09-08') + ': +150.00$'), 'un día ganador se muestra en positivo (martes: +150.00$)');
  check(textoBernal.includes('*TOTAL SEMANA*') && textoBernal.trim().endsWith('-50.00$'), 'el total semana es la suma de los días (-200+150 = -50.00$)');

  const datosLopez = { porFecha: { '2026-09-09': { resultado: -100, comision: 10 } }, totalResultado: -100, totalComision: 10 };
  const textoPctLopez = generarTextoPorcentajeSemanalCliente('LOPEZ', datosLopez);
  check(textoPctLopez.includes('*Cliente: LOPEZ (%)*'), 'el mensaje de % se distingue del de balance en el encabezado');
  check(textoPctLopez.includes('+10.00$'), 'el % de un día se muestra en su propia línea (+10.00$)');
  check(textoPctLopez.trim().endsWith('+10.00$') && textoPctLopez.includes('*TOTAL SEMANA %*'), 'el total semana % es la suma de las comisiones del rango');

  // =================================================================
  // 3) "corte semana" / "saldo total semana <nombre>" — integración
  // completa, con tickets ya decididos guardados en tickets_historial
  // (no hace falta reprocesar ninguna sábana en vivo para esto)
  // =================================================================
  const { desde: lunesSemana } = await calcularRangoRapido(GRUPO_ID, 'semana');
  const diaMartes = fechaMasDias(lunesSemana, 1);
  const diaMiercoles = fechaMasDias(lunesSemana, 2);

  TABLAS.tickets_historial.push(
    { id: 'h1', grupo_id: GRUPO_ID, fecha: lunesSemana, cliente_nombre: 'BERNAL', ticket_label: 'Ticket #1', detalle: 'houston -120', arriesga: 200, gana: 0, estado: 'PERDIDA', logros: 1 },
    { id: 'h2', grupo_id: GRUPO_ID, fecha: diaMartes, cliente_nombre: 'BERNAL', ticket_label: 'Ticket #2', detalle: 'astros +150', arriesga: 100, gana: 150, estado: 'GANADA', logros: 1 },
    { id: 'h3', grupo_id: GRUPO_ID, fecha: diaMiercoles, cliente_nombre: 'LOPEZ', ticket_label: 'Ticket #1', detalle: 'rangers -110', arriesga: 100, gana: 0, estado: 'PERDIDA', logros: 1 }
  );

  const sockCorte = crearSockFalso();
  const resultadoCorte = await whatsappBot.manejarComandoCorteSemana(sockCorte, GRUPO_ID, JID);
  check(resultadoCorte.accion === 'CORTE_SEMANA_ENVIADO', '"corte semana" corre sin errores y confirma el envío');
  // PEDRO, BERNAL, LOPEZ, CARLOS = 4 clientes activos registrados; BERNAL
  // y CARLOS no tienen comisión (1 mensaje c/u), LOPEZ sí tiene 10% de
  // comisión (2 mensajes) — PEDRO tampoco jugó ni tiene % (1 mensaje).
  check(sockCorte.mensajes.length === 5, '"corte semana" manda 1 mensaje por cada cliente sin comisión (PEDRO, BERNAL, CARLOS) + 2 para el único con comisión (LOPEZ) = 5 mensajes en total');
  check(sockCorte.mensajes.every(m => m.jid === JID), 'todos los mensajes del corte semanal se mandan al JID correcto del grupo');

  const mensajeBernal = sockCorte.mensajes.find(m => m.text.includes('*Cliente: BERNAL*'));
  check(!!mensajeBernal && mensajeBernal.text.includes(nombreDiaSemana(lunesSemana) + ': -200.00$') && mensajeBernal.text.includes(nombreDiaSemana(diaMartes) + ': +150.00$'), 'el mensaje de BERNAL trae sus 2 días con el resultado correcto de sus jugadas (sin comisión, sin Polla)');
  check(mensajeBernal.text.trim().endsWith('-50.00$'), 'el total semana de BERNAL es -200+150 = -50.00$');
  check(!sockCorte.mensajes.some(m => m.text.includes('Cliente: BERNAL (%)')), 'BERNAL no tiene ningún % configurado, así que NO se le manda un segundo mensaje de %');

  const mensajesLopez = sockCorte.mensajes.filter(m => m.text.includes('LOPEZ'));
  check(mensajesLopez.length === 2, 'LOPEZ (10% de comisión) recibe 2 mensajes: el balance y, aparte, su %');
  const balanceLopez = mensajesLopez.find(m => m.text.includes('*Cliente: LOPEZ*'));
  const pctLopez = mensajesLopez.find(m => m.text.includes('(%)'));
  check(!!balanceLopez && balanceLopez.text.includes(nombreDiaSemana(diaMiercoles) + ': -100.00$'), 'el mensaje de balance de LOPEZ muestra -100.00$ (SOLO el resultado de la jugada, sin descontar la comisión)');
  check(!!pctLopez && pctLopez.text.includes('+10.00$'), 'el mensaje de % de LOPEZ muestra su comisión de esa jugada perdida: 100*10% = 10.00$');

  const mensajeCarlos = sockCorte.mensajes.find(m => m.text.includes('*Cliente: CARLOS*'));
  check(!!mensajeCarlos && mensajeCarlos.text.includes('(sin jugadas esta semana)'), 'CARLOS (registrado pero sin ninguna jugada esta semana) igual recibe su reporte, avisando que no jugó');

  // --- "saldo total semana <nombre>"/"total semana <nombre>" — un solo cliente ---
  const sockUno = crearSockFalso();
  const resultadoUno = await whatsappBot.manejarComandoSaldoCliente(sockUno, GRUPO_ID, JID, 'bernal');
  check(resultadoUno.accion === 'SALDO_CLIENTE_ENVIADO' && resultadoUno.cliente === 'BERNAL', 'buscar "bernal" (minúsculas) encuentra al cliente BERNAL (nombre real guardado en mayúsculas)');
  check(sockUno.mensajes.length === 1 && sockUno.mensajes[0].text.includes('*Cliente: BERNAL*'), 'y manda solo su mensaje de balance (sin comisión, no hace falta el segundo)');

  const sockUnoLopez = crearSockFalso();
  await whatsappBot.manejarComandoSaldoCliente(sockUnoLopez, GRUPO_ID, JID, 'LÓPEZ');
  check(sockUnoLopez.mensajes.length === 2, 'buscar "LÓPEZ" (con tilde) también encuentra a LOPEZ, y como tiene comisión manda los 2 mensajes');

  const sockDesconocido = crearSockFalso();
  const resultadoDesconocido = await whatsappBot.manejarComandoSaldoCliente(sockDesconocido, GRUPO_ID, JID, 'Nombre Que No Existe');
  check(resultadoDesconocido.accion === 'CLIENTE_NO_ENCONTRADO', 'pedir el saldo de un cliente que no existe no revienta');
  check(sockDesconocido.mensajes.length === 1 && /No encontré ningún cliente/.test(sockDesconocido.mensajes[0].text), 'y avisa en el grupo que no encontró ningún cliente con ese nombre');

  // =================================================================
  // 4) "actualizar sabana"/"act" y "saldo final"/"saldo del dia" —
  // integración completa vía manejarMensajeEntrante(), con una sábana en
  // vivo de HOY (misma fecha real que usa la producción)
  // =================================================================
  const HOY = formatearFechaISO(new Date());
  const textoSabanaHoy = ['SABANA DE JUGADAS', HOY, 'PEDRO', 'houston -120', '100//90'].join('\n');
  const sockCarga = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockCarga, crearMensaje(textoSabanaHoy));
  check(sockCarga.mensajes.length === 1, 'se carga la sábana de hoy normalmente (1er aviso automático de siempre)');

  // --- "act" con el partido TODAVÍA sin resultado: reenvía el listado
  // (forzado, sin esperar la hora) ---
  partidoFinal = false;
  const sockAct = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockAct, crearMensaje('act'));
  check(sockAct.mensajes.length === 1 && sockAct.mensajes[0].text.includes('🔄 *Actualización de resultados*'), '"act" reenvía el listado de hoy (forzado, sin esperar la hora) mientras el partido no terminó');

  // --- "saldo final" con el partido TODAVÍA sin resultado: manda el
  // listado + un aviso APARTE de que faltan juegos, SIN totales ---
  const sockSaldoIncompleto = crearSockFalso();
  const resSaldoIncompleto = await whatsappBot.manejarComandoSaldoDia(sockSaldoIncompleto, GRUPO_ID, JID);
  check(resSaldoIncompleto.accion === 'FALTAN_JUEGOS', '"saldo final" con juegos pendientes devuelve FALTAN_JUEGOS');
  check(sockSaldoIncompleto.mensajes.length === 2, 'manda 2 mensajes: el listado y, aparte, el aviso de que faltan juegos');
  check(!sockSaldoIncompleto.mensajes[0].text.includes('TOTALES'), 'el primer mensaje es el listado, NUNCA los totales, mientras falten juegos');
  check(/faltan jugadas por decidirse|juegos por terminar/i.test(sockSaldoIncompleto.mensajes[1].text), 'el segundo mensaje avisa explícitamente que faltan jugadas/juegos por decidirse');
  const confirmacionIncompleta = await estadoDiaConfirmado(GRUPO_ID, HOY);
  check(confirmacionIncompleta.confirmado === false, 'mientras falten juegos, el día NO se confirma en Balance General');

  // --- el partido TERMINA: "saldo final" ahora sí manda el listado con
  // íconos + los totales, y confirma el día ---
  partidoFinal = true;
  const sockSaldoCompleto = crearSockFalso();
  const resSaldoCompleto = await whatsappBot.manejarComandoSaldoDia(sockSaldoCompleto, GRUPO_ID, JID);
  check(resSaldoCompleto.accion === 'TOTALES_ENVIADOS', '"saldo final" con todos los juegos resueltos devuelve TOTALES_ENVIADOS');
  check(sockSaldoCompleto.mensajes.length === 2, 'manda 2 mensajes: el listado final + los totales');
  check(sockSaldoCompleto.mensajes[0].text.includes('✅ *SÁBANA FINAL — todos los resultados*'), 'el primer mensaje ya trae el título de "SÁBANA FINAL" con los íconos puestos');
  check(sockSaldoCompleto.mensajes[1].text.includes('*TOTALES DEL DÍA*'), 'el segundo mensaje es el de los totales del día');
  const confirmacionCompleta = await estadoDiaConfirmado(GRUPO_ID, HOY);
  check(confirmacionCompleta.confirmado === true, 'con todo resuelto, "saldo final" SÍ confirma el día en Balance General ("como termine el día")');
  const diaTrasSaldoFinal = await (require(path.join(__dirname, '..', 'src', 'services', 'whatsappDiaEstado'))).obtenerEstadoDia(GRUPO_ID, HOY);
  check(!diaTrasSaldoFinal.sabanaFinalEn && !diaTrasSaldoFinal.cierreEnviadoEn, '"saldo final" NO marca el día como cerrado para nuevas sábanas — es una consulta, no reemplaza a "SABANA DE JUGADAS FINAL"');

  // --- "act"/"saldo final" en un grupo SIN el servicio contratado: se
  // ignoran en silencio, igual que "SABANA DE JUGADAS" ---
  const JID_SIN_SERVICIO = '120363000000000099@g.us';
  TABLAS.grupos.push({ id: 'g-otro', nombre: 'Otro Grupo', whatsapp_grupo_jid: JID_SIN_SERVICIO, whatsapp_habilitado: false, modelo_comision: 'plano', comision_tiers: [] });
  const sockSinServicio = crearSockFalso();
  await whatsappBot.manejarMensajeEntrante(sockSinServicio, { key: { remoteJid: JID_SIN_SERVICIO, fromMe: false, participant: JID_SIN_SERVICIO }, message: { conversation: 'act' } });
  check(sockSinServicio.mensajes.length === 0, 'un grupo sin el servicio de WhatsApp contratado no recibe ninguna respuesta a estos comandos, igual que con "SABANA DE JUGADAS"');

  // --- "act" en un día SIN ninguna sábana cargada todavía: avisa en vez
  // de fallar en silencio ---
  const FECHA_VACIA_JID = JID; // mismo grupo, pero probamos manejarComandoActualizar directo contra una fecha sin sábana usando otro grupo limpio
  TABLAS.grupos.push({ id: 'g-limpio', nombre: 'Grupo Limpio', whatsapp_grupo_jid: '120363000000000077@g.us', whatsapp_habilitado: true, modelo_comision: 'plano', comision_tiers: [] });
  TABLAS.jugadores.push({ id: 'j-limpio', grupo_id: 'g-limpio', nombre: 'NADIE', activo: true, comision_propia: 0 });
  const sockActVacio = crearSockFalso();
  await whatsappBot.manejarComandoActualizar(sockActVacio, 'g-limpio', '120363000000000077@g.us');
  check(sockActVacio.mensajes.length === 1 && /Todavía no se cargó ninguna sábana/.test(sockActVacio.mensajes[0].text), '"act" en un grupo sin ninguna sábana cargada hoy avisa en vez de no hacer nada');

  const sockSaldoVacio = crearSockFalso();
  await whatsappBot.manejarComandoSaldoDia(sockSaldoVacio, 'g-limpio', '120363000000000077@g.us');
  check(sockSaldoVacio.mensajes.length === 1 && /Todavía no se cargó ninguna sábana/.test(sockSaldoVacio.mensajes[0].text), '"saldo final" en un grupo sin ninguna sábana cargada hoy también avisa, sin reventar');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de comandos de WhatsApp se cayó con una excepción:', e);
  process.exit(1);
});
