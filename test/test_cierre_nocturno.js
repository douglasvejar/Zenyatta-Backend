// =================================================================
// PRUEBA: cierre nocturno de todos los grupos (08-10-2026). Pasada la medianoche de Venezuela se
// cierran, en orden, los grupos con la sábana de ayer toda resuelta; al terminar con todos sale UN
// mensaje final. Aquí se prueba el orquestador (orden, pendientes, reintentos, mensaje final), la
// fecha de "ayer" en Venezuela y el reparto de destinos de Telegram. El cierre de cada grupo
// (listado → totales → semana → foto) se prueba en test_whatsapp_comandos.js.
// =================================================================
const assert = require('assert');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'pg') return { Pool: function () { this.query = async () => ({ rows: [] }); this.connect = async () => ({ query: async () => ({ rows: [] }), release() {} }); this.on = () => {}; } };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';

const estado = require('../src/services/whatsappDiaEstado');
const whatsappBot = require('../src/services/whatsappBot');
const cierre = require('../src/services/cierreNocturno');
const telegramBot = require('../src/services/telegramBot');

let ok = 0, mal = 0;
function check(c, m) { try { assert.ok(c); ok++; console.log('OK: ' + m); } catch (e) { mal++; console.log('FALLÓ: ' + m); } }

(async () => {
  // --- fecha de "ayer" en Venezuela (UTC-4) ---
  const realNow = Date.now;
  Date.now = () => Date.parse('2026-10-08T03:30:00Z'); // 23:30 del 07-10 en Venezuela
  check(cierre.fechaVenezuelaAyer() === '2026-10-06', 'a las 23:30 del 07-10 (Venezuela) todavía no pasó la medianoche: "ayer" es el 06-10');
  Date.now = () => Date.parse('2026-10-08T04:30:00Z'); // 00:30 del 08-10 en Venezuela
  check(cierre.fechaVenezuelaAyer() === '2026-10-07', 'a las 00:30 del 08-10 (Venezuela) "ayer" ya es el 07-10');
  Date.now = () => Date.parse('2026-11-01T05:00:00Z'); // 01:00 del 01-11 en Venezuela
  check(cierre.fechaVenezuelaAyer() === '2026-10-31', 'el cambio de mes se resuelve bien (01-11 → ayer 31-10)');
  Date.now = realNow;

  // --- mensaje final ---
  const txt = cierre.textoTodosResueltos('2026-10-07', ['Bernal', 'Lusho VIP']);
  check(/TODOS LOS GRUPOS RESUELTOS/.test(txt) && txt.includes('07/10/2026') && txt.includes('BERNAL, LUSHO VIP') && /Hasta mañana/.test(txt), 'el mensaje final dice "todos los grupos resueltos", la fecha, los grupos y se despide con "Hasta mañana"');

  // --- orquestador ---
  let dias = [];
  estado.listarDiasParaCierreNocturno = async () => dias.map(d => ({ ...d }));
  const llamadas = [];
  let resultados = {};
  const cerrarDia = async (sock, grupoId, jid, fecha) => {
    llamadas.push(grupoId);
    const r = resultados[grupoId] || { accion: 'CERRADO' };
    if (r.accion === 'CERRADO') { const d = dias.find(x => x.grupoId === grupoId); if (d) d.cerrado = true; }
    return r;
  };
  const destinoDe = g => (g.grupoId === 'sin-chat' ? null : { sock: { id: g.grupoId }, jid: 'jid-' + g.grupoId });
  const finales = [];
  const enviarFinal = async t => { finales.push(t); };
  const correr = () => cierre.revisarCierreNocturno({ fecha: '2026-10-07', destinoDe, enviarFinal, cerrarDia });

  dias = [
    { grupoId: 'g-bernal', nombre: 'Bernal', cerrado: false },
    { grupoId: 'g-lusho', nombre: 'Lusho VIP', cerrado: false },
    { grupoId: 'g-zeta', nombre: 'Zeta', cerrado: false },
    { grupoId: 'sin-chat', nombre: 'Sin Chat', cerrado: false }
  ];
  resultados = { 'g-lusho': { accion: 'FALTAN_JUEGOS', pendientes: 2 } };
  let r = await correr();
  check(llamadas.join(',') === 'g-bernal,g-lusho,g-zeta', 'recorre los grupos en el orden de la lista, uno por uno (y se salta el que no tiene chat donde mandar)');
  check(r.cerrados.join(',') === 'Bernal,Zeta' && r.pendientes.length === 1 && r.pendientes[0].nombre === 'Lusho VIP', 'cierra los que ya están resueltos y deja pendiente al que aún tiene juegos');
  check(finales.length === 0 && !r.finalEnviado, 'mientras quede un grupo pendiente NO se manda el mensaje final');

  llamadas.length = 0;
  resultados = {};
  r = await correr();
  check(llamadas.join(',') === 'g-lusho', 'en el siguiente chequeo solo se reintenta el pendiente (los ya cerrados no se tocan)');
  check(finales.length === 1 && r.finalEnviado, 'al cerrarse el último grupo se manda UN mensaje final');
  check(finales[0].includes('BERNAL, LUSHO VIP, ZETA') && !finales[0].includes('SIN CHAT'), 'el mensaje final lista TODOS los grupos del día (también los cerrados antes), sin el que no tenía chat');

  llamadas.length = 0;
  r = await correr();
  check(llamadas.length === 0 && finales.length === 1, 'con todos ya cerrados no hace nada ni repite el mensaje final');

  // error en un grupo: queda pendiente, los demás siguen
  dias = [{ grupoId: 'g-a', nombre: 'A', cerrado: false }, { grupoId: 'g-b', nombre: 'B', cerrado: false }];
  resultados = { 'g-a': { accion: 'ERROR', error: 'x' } };
  finales.length = 0;
  r = await correr();
  check(r.cerrados.join(',') === 'B' && r.pendientes[0].nombre === 'A' && finales.length === 0, 'un error en un grupo no frena a los demás y lo deja pendiente (sin mensaje final)');
  const cerrarLanza = async (s, id) => { if (id === 'g-a') throw new Error('boom'); return { accion: 'CERRADO' }; };
  dias = [{ grupoId: 'g-a', nombre: 'A', cerrado: false }, { grupoId: 'g-b', nombre: 'B', cerrado: false }];
  r = await cierre.revisarCierreNocturno({ fecha: '2026-10-07', destinoDe, enviarFinal, cerrarDia: cerrarLanza });
  check(r.cerrados.join(',') === 'B' && r.pendientes.length === 1, 'si el cierre de un grupo lanza una excepción, tampoco frena a los demás');

  // sin grupos: no pasa nada
  dias = [];
  finales.length = 0;
  r = await correr();
  check(finales.length === 0 && r.cerrados.length === 0, 'sin grupos con sábana de ayer no se manda nada');

  // dos chequeos solapados: el segundo se omite
  dias = [{ grupoId: 'g-a', nombre: 'A', cerrado: false }];
  let liberar;
  const lento = () => new Promise(res => { liberar = res; });
  const p1 = cierre.revisarCierreNocturno({ fecha: '2026-10-07', destinoDe, enviarFinal, cerrarDia: async () => { await lento(); return { accion: 'CERRADO' }; } });
  await new Promise(res => setTimeout(res, 10));
  const r2 = await correr();
  check(r2.omitido === true, 'si ya hay un cierre en curso, el chequeo siguiente se omite (no se solapan)');
  liberar();
  await p1;

  // todos los grupos ya se cerraron ANTES de la medianoche (SABANA FINAL + todo resuelto): el mensaje final
  // igual sale una vez pasada la medianoche, y solo una vez aunque sigan los chequeos
  estado._reiniciarFinales();
  dias = [{ grupoId: 'g-a', nombre: 'A', cerrado: true }, { grupoId: 'g-b', nombre: 'B', cerrado: true }];
  finales.length = 0;
  llamadas.length = 0;
  r = await correr();
  check(llamadas.length === 0 && finales.length === 1 && r.finalEnviado, 'si todos los grupos ya se cerraron antes de la medianoche, igual sale el mensaje final (sin volver a cerrar a nadie)');
  r = await correr();
  check(finales.length === 1 && !r.finalEnviado, '...y el mensaje final no se repite en los chequeos siguientes');
  estado._reiniciarFinales();
  dias = [{ grupoId: 'g-a', nombre: 'A', cerrado: true }, { grupoId: 'g-b', nombre: 'B', cerrado: false }];
  finales.length = 0;
  resultados = { 'g-b': { accion: 'FALTAN_JUEGOS', pendientes: 1 } };
  r = await correr();
  check(finales.length === 0, 'con uno cerrado antes y otro todavía pendiente NO sale el mensaje final');
  resultados = {};

  estado._reiniciarFinales(); // (el mensaje final se guarda por día: cada escenario empieza limpio)
  // --- Telegram: a dónde sale cada cosa ---
  process.env.TELEGRAM_CENTRAL_CHAT_ID = '-100999';
  const enviados = [];
  const apiFalsa = { enviarTexto: async (chat, t) => enviados.push({ chat, t }), enviarFoto: async () => {} };
  // db: grupos con Telegram (uno con chat propio, otro sin)
  const db = require('../src/db');
  db.query = async sql => (/FROM grupos WHERE telegram_habilitado/i.test(sql) ? { rows: [{ id: 'g-propio', telegram_chat_id: '-100111' }, { id: 'g-central', telegram_chat_id: null }] } : { rows: [] });
  dias = [{ grupoId: 'g-propio', nombre: 'Propio', cerrado: false }, { grupoId: 'g-central', nombre: 'Central VIP', cerrado: false }];
  const enviadosPorGrupo = [];
  whatsappBot.cerrarDiaCompleto = async (sock, grupoId, jid) => { await sock.sendMessage(jid, { text: 'cierre ' + grupoId }); enviadosPorGrupo.push({ grupoId, jid }); return { accion: 'CERRADO' }; };
  const rt = await telegramBot.revisarCierreNocturnoTelegram({ api: apiFalsa, sock: { sendMessage: async (jid, c) => apiFalsa.enviarTexto(String(jid).replace(/^tg_|@g\.us$/g, ''), c.text) }, fecha: '2026-10-07' });
  check(enviadosPorGrupo[0].jid === 'tg_-100111@g.us' && enviados[0].chat === '-100111', 'el grupo con chat propio recibe su cierre en su chat');
  check(enviadosPorGrupo[1].jid === 'tgc_g-central@g.us' && enviados[1].chat === '-100999' && enviados[1].t.startsWith('📍 *CENTRAL VIP*'), 'el grupo sin chat propio lo recibe en el central, con su nombre arriba');
  check(enviados[2].chat === '-100999' && /TODOS LOS GRUPOS RESUELTOS/.test(enviados[2].t) && rt.finalEnviado, 'y el mensaje final de "todos resueltos" sale en el central, de último');

  // el resumen automático de Telegram pide el cierre COMPLETO (para que salga apenas llegue SABANA FINAL)
  const opcionesVistas = [];
  const procesarOriginal = whatsappBot.procesarDiaAbierto;
  whatsappBot.procesarDiaAbierto = async (sock, grupoId, jid, fecha, opts) => { opcionesVistas.push(opts); return { accion: 'NADA_QUE_ENVIAR' }; };
  await telegramBot.revisarResumenesAutomaticos({ api: apiFalsa, sock: { sendMessage: async () => {} } });
  check(opcionesVistas.length === 2 && opcionesVistas.every(o => o.cierreCompleto === true && o.forzar === false), 'el resumen automático de Telegram pide el cierre completo (día + semana + foto) y no fuerza');
  process.env.TELEGRAM_CIERRE_NOCTURNO = 'false';
  opcionesVistas.length = 0;
  await telegramBot.revisarResumenesAutomaticos({ api: apiFalsa, sock: { sendMessage: async () => {} } });
  check(opcionesVistas.length === 2 && opcionesVistas.every(o => o.cierreCompleto === false), 'con TELEGRAM_CIERRE_NOCTURNO=false el cierre completo automático queda apagado');
  delete process.env.TELEGRAM_CIERRE_NOCTURNO;
  whatsappBot.procesarDiaAbierto = procesarOriginal;

  // --- Aviso de problemas: qué pasa y con qué grupo ---
  const tf = cierre.textoProblemaCierre({ grupoNombre: 'Bernal', fecha: '2026-10-07', resultado: { accion: 'FALTAN_JUEGOS', pendientes: 2, detalle: [
    { cliente: 'PEDRO', ticket: '3', estado: 'SUSPENDIDA', jugadas: ['houston -120', 'astros +150'] },
    { cliente: 'LOPEZ', ticket: '1', estado: 'PENDIENTE', jugadas: ['rangers -110'] }
  ] } });
  check(tf.includes('PROBLEMA — BERNAL') && tf.includes('07/10/2026') && tf.includes('2 jugadas siguen sin resolver'), 'el aviso dice el grupo, el día y cuántas jugadas siguen sin resolver');
  check(tf.includes('• PEDRO — ticket 3 · SUSPENDIDA · houston -120 / astros +150') && tf.includes('• LOPEZ — ticket 1 · PENDIENTE · rangers -110'), 'lista cada jugada sin resolver con su cliente, ticket, estado y texto');
  check(/Qué hacer/.test(tf), 'y dice qué hacer');
  const te = cierre.textoProblemaCierre({ grupoNombre: 'Bernal', fecha: '2026-10-07', resultado: { accion: 'ERROR', error: 'se cayó la API' } });
  check(te.includes('PROBLEMA — BERNAL') && te.includes('se cayó la API'), 'un error al revisar la sábana también dice el grupo y el motivo');
  const muchas = cierre.textoProblemaCierre({ grupoNombre: 'G', fecha: '2026-10-07', resultado: { accion: 'FALTAN_JUEGOS', pendientes: 20, detalle: Array.from({ length: 20 }, (_, i) => ({ cliente: 'C' + i, ticket: String(i), estado: 'PENDIENTE', jugadas: [] })) } });
  check(muchas.includes('… y 5 más.') && !muchas.includes('C19'), 'con muchas jugadas pendientes lista las primeras 15 y dice cuántas más hay');

  // orquestador: llama al aviso por cada grupo que no se pudo cerrar
  dias = [{ grupoId: 'g-a', nombre: 'A', cerrado: false }, { grupoId: 'g-b', nombre: 'B', cerrado: false }, { grupoId: 'g-c', nombre: 'C', cerrado: false }];
  resultados = { 'g-a': { accion: 'FALTAN_JUEGOS', pendientes: 1, detalle: [] }, 'g-b': { accion: 'ERROR', error: 'x' } };
  const problemasAvisados = [];
  await cierre.revisarCierreNocturno({ fecha: '2026-10-07', destinoDe, enviarFinal, cerrarDia, avisarProblema: async p => problemasAvisados.push(p.grupoNombre + ':' + p.resultado.accion) });
  check(problemasAvisados.join(',') === 'A:FALTAN_JUEGOS,B:ERROR', 'avisa por cada grupo que no se pudo cerrar (juegos pendientes o error), no por el que sí cerró');

  // Telegram: destino y que no se repita
  const salida = [];
  telegramBot._usarCliente({ enviarTexto: async (chat, t) => salida.push({ chat, t }), enviarFoto: async () => {} });
  delete process.env.TELEGRAM_AVISOS_CHAT_ID;
  let rp = await telegramBot.avisarProblema({ grupoNombre: 'Bernal', titulo: 'Algo pasó', detalle: 'detalle', clave: 'k1' });
  check(rp.enviado && salida[0].chat === '-100999' && salida[0].t.includes('PROBLEMA — BERNAL'), 'sin chat de avisos configurado, el aviso de problema sale en el grupo central');
  rp = await telegramBot.avisarProblema({ grupoNombre: 'Bernal', titulo: 'Algo pasó', detalle: 'detalle', clave: 'k1' });
  check(rp.repetido && salida.length === 1, 'el mismo problema no se repite (los chequeos corren cada 15 minutos)');
  rp = await telegramBot.avisarProblema({ grupoNombre: 'Bernal', titulo: 'Otra cosa', detalle: 'd2', clave: 'k2' });
  check(rp.enviado && salida.length === 2, 'un problema distinto sí se avisa');
  process.env.TELEGRAM_AVISOS_CHAT_ID = '555';
  await telegramBot.avisarProblema({ grupoNombre: 'Bernal', titulo: 'Tercero', detalle: 'd3', clave: 'k3' });
  check(salida[2].chat === '555', 'con TELEGRAM_AVISOS_CHAT_ID configurado, el aviso va a ese chat privado');

  // lo que viene de whatsappBot (sábana ilegible): avisa con el grupo, salvo que ya se respondió en el mismo chat
  db.query = async sql => (/SELECT nombre FROM grupos WHERE id/i.test(sql) ? { rows: [{ nombre: 'Deportes Bernal' }] } : { rows: [] });
  salida.length = 0;
  await telegramBot.notificarProblemaDeBot({ jid: 'tg_-100111@g.us', grupoId: 'g1', titulo: 'No se pudo leer la sábana', detalle: 'Motivo: x', clave: 'n1' });
  check(salida.length === 1 && salida[0].chat === '555' && salida[0].t.includes('DEPORTES BERNAL'), 'una sábana ilegible en el chat propio de un grupo se le avisa al dueño, con el nombre del grupo');
  await telegramBot.notificarProblemaDeBot({ jid: 'tg_555@g.us', grupoId: 'g1', titulo: 'No se pudo leer la sábana', detalle: 'Motivo: x', clave: 'n2' });
  check(salida.length === 1, 'si el problema ocurrió en el mismo chat donde van los avisos, no se duplica (ya se le respondió allí)');
  await telegramBot.notificarProblemaDeBot({ jid: '120363@g.us', grupoId: 'g1', titulo: 'x', detalle: 'y', clave: 'n3' });
  check(salida.length === 1, 'lo que no vino por Telegram (WhatsApp) no se manda por Telegram');

  // Integración: el cierre nocturno de Telegram avisa UNA sola vez de un grupo atascado (chequeo tras chequeo)
  db.query = async sql => (/FROM grupos WHERE telegram_habilitado/i.test(sql) ? { rows: [{ id: 'g-atasc', telegram_chat_id: null }] } : { rows: [] });
  dias = [{ grupoId: 'g-atasc', nombre: 'Lusho VIP', cerrado: false }];
  whatsappBot.cerrarDiaCompleto = async () => ({ accion: 'FALTAN_JUEGOS', pendientes: 1, detalle: [{ cliente: 'PEDRO', ticket: '2', estado: 'SUSPENDIDA', jugadas: ['mets +110'] }] });
  salida.length = 0;
  delete process.env.TELEGRAM_AVISOS_CHAT_ID;
  const apiInt = { enviarTexto: async (chat, t) => salida.push({ chat, t }), enviarFoto: async () => {} };
  await telegramBot.revisarCierreNocturnoTelegram({ api: apiInt, sock: {}, fecha: '2026-10-07' });
  await telegramBot.revisarCierreNocturnoTelegram({ api: apiInt, sock: {}, fecha: '2026-10-07' });
  const avisosAtasco = salida.filter(x => /PROBLEMA — LUSHO VIP/.test(x.t));
  check(avisosAtasco.length === 1 && avisosAtasco[0].t.includes('PEDRO — ticket 2 · SUSPENDIDA · mets +110') && salida.every(x => !/TODOS LOS GRUPOS RESUELTOS/.test(x.t)), 'el grupo atascado se avisa una sola vez aunque el chequeo corra dos veces, y NO sale el mensaje final de "todos resueltos"');

  console.log('\n' + ok + ' pruebas OK, ' + mal + ' fallaron.');
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error('Se cayó:', e); process.exit(1); });
