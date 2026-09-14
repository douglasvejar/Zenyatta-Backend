// =================================================================
// PRUEBA DE INTEGRACIÓN: si un equipo NO está mapeado (esa liga todavía no
// tiene una API conectada) pero la sábana ya trae el marcador manual
// (✅/❌/⭕) puesto a mano, se usa ESE marcador para el resultado final —
// en vez de dejar el ticket PENDIENTE para siempre (06-09-2026, a pedido
// del usuario).
// =================================================================
// El usuario reportó: "hay equipos que no tenemos mapeados porque esa liga
// aun no tenemos la api que lo analice entonces mientras yo lo coloco
// manualmente si se dio o no y si hago eso al procesar la sabana lo deja
// como pendiente. Quiero que si un equipo no esta mapeado y yo manualmente
// coloco un signo que si se dio o no lo dejes asi mientras aun no tenemos
// esa api trabajando."
//
// Causa: procesarSabana.js marcaba CUALQUIER pata SIN_MAPEO (equipo que ni
// siquiera está en el diccionario) igual que una pata PENDIENTE real de
// una API que sí funciona (juego en curso/no encontrado) — ambos prendían
// la misma bandera "ticketPendiente", y el ticket quedaba PENDIENTE sin
// ninguna forma de salir de ahí, porque para un equipo SIN_MAPEO nunca va
// a aparecer ningún resultado de ninguna API.
//
// Arreglo: ahora se distingue "SIN_MAPEO" (sin API detrás, nunca se va a
// resolver solo) de "PENDIENTE/SUSPENDIDA real" (con API detrás, se va a
// resolver cuando esa API tenga el dato). Si el ÚNICO motivo de pendencia
// es SIN_MAPEO (ninguna pata está genuinamente pendiente de una API real)
// y la sábana ya trae un marcador manual, ese marcador decide el resultado
// (✅→GANADA, ❌→PERDIDA, ⭕→ANULADA). Si hay de por medio aunque sea 1
// pata con una pendencia REAL, o si no hay ningún marcador manual puesto,
// el ticket se sigue comportando EXACTAMENTE igual que antes: PENDIENTE.
//
// Mismo patrón de base de datos falsa + fetch falso que
// test_ticket_sin_jugadas.js/test_tolerancia_parley.js — corre el
// orquestador COMPLETO (procesarSabana.js), sin levantar un servidor HTTP
// ni pegarle a las APIs reales.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

function ejecutarQuery(text) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT \* FROM jugadores/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM avales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  if (/FROM polla_historial/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO alertas/i.test(sql)) return { rows: [{ id: 'alerta-1' }] };

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

const FECHA_PRUEBA = '2026-09-06';

// Ningún dato real hace falta: "Equipo Inventado FC" no está en NINGÚN
// diccionario, así que ninguna API lo va a encontrar nunca — es
// justamente el punto de la prueba.
function fakeFetch() {
  return Promise.resolve({ json: async () => ({ events: [] }) });
}

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
global.fetch = fakeFetch;

const { procesarSabana } = require(path.join(__dirname, '..', 'src', 'services', 'procesarSabana'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // -----------------------------------------------------------------
  // Caso 1 (el bug reportado, marcador ✅): jugada directa de un equipo
  // que no está mapeado en ningún lado, con marcador manual "se dio".
  // -----------------------------------------------------------------
  const texto1 = ['PACO', 'Equipo Inventado FC alta 2-115', '100//87✅'].join('\n');
  const r1 = await procesarSabana('grupo-1', texto1, FECHA_PRUEBA);
  const t1 = r1.tickets.find(t => t.cliente === 'PACO');
  check(t1.estado === 'GANADA', 'Equipo sin mapear + marcador manual "✅": el ticket queda GANADA (antes se quedaba PENDIENTE para siempre)');
  check(t1.resueltoPorMarcadorManualSinMapeo === true, 'Se marca resueltoPorMarcadorManualSinMapeo=true para que la interfaz pueda explicar por qué se usó el marcador a mano');
  check(!!t1.notaResueltoPorMarcadorManualSinMapeo, 'Trae una nota explicando que esa liga todavía no tiene API y se usó el marcador manual');
  check(t1.marcadorManualIncorrecto === false, 'No se marca como "marcador incorrecto" — el marcador ES la fuente de verdad acá, no hay nada que corregir');

  // -----------------------------------------------------------------
  // Caso 2 (marcador ❌): mismo equipo sin mapear, pero marcado como
  // perdido a mano.
  // -----------------------------------------------------------------
  const texto2 = ['MARIA', 'Equipo Inventado FC alta 2-115', '100//87❌'].join('\n');
  const r2 = await procesarSabana('grupo-1', texto2, FECHA_PRUEBA);
  const t2 = r2.tickets.find(t => t.cliente === 'MARIA');
  check(t2.estado === 'PERDIDA', 'Equipo sin mapear + marcador manual "❌": el ticket queda PERDIDA');
  check(t2.resueltoPorMarcadorManualSinMapeo === true, 'También se marca resueltoPorMarcadorManualSinMapeo=true en el caso perdido');

  // -----------------------------------------------------------------
  // Caso 3 (marcador ⭕): equipo sin mapear marcado como anulado/push.
  // -----------------------------------------------------------------
  const texto3 = ['JOSE', 'Equipo Inventado FC alta 2-115', '100//87⭕'].join('\n');
  const r3 = await procesarSabana('grupo-1', texto3, FECHA_PRUEBA);
  const t3 = r3.tickets.find(t => t.cliente === 'JOSE');
  check(t3.estado === 'ANULADA', 'Equipo sin mapear + marcador manual "⭕": el ticket queda ANULADA');

  // -----------------------------------------------------------------
  // Caso 4 (no debe romperse — regresión): el mismo equipo sin mapear,
  // pero SIN ningún marcador manual puesto — tiene que seguir PENDIENTE,
  // exactamente como se comportaba antes de este arreglo (nadie dijo nada
  // a mano, no hay de dónde sacar el resultado).
  // -----------------------------------------------------------------
  const texto4 = ['ANA', 'Equipo Inventado FC alta 2-115', '100//87'].join('\n');
  const r4 = await procesarSabana('grupo-1', texto4, FECHA_PRUEBA);
  const t4 = r4.tickets.find(t => t.cliente === 'ANA');
  check(t4.estado === 'PENDIENTE', 'Equipo sin mapear SIN marcador manual: se sigue comportando igual que siempre, queda PENDIENTE');
  check(t4.resueltoPorMarcadorManualSinMapeo === false, 'Sin marcador manual no se activa el override');

  // -----------------------------------------------------------------
  // Caso 5 (no debe romperse — regresión, el caso más delicado): un parley
  // con 2 patas — una de un equipo SIN MAPEAR (marcador ✅ puesto) y otra
  // de un equipo SÍ mapeado en MLB pero que la API falsa no encuentra
  // (PENDIENTE real, de una API que sí existe) — el marcador manual NO se
  // debe usar acá, porque hay una pendencia REAL de por medio que algún
  // día sí se puede resolver solo. El ticket tiene que seguir PENDIENTE.
  // -----------------------------------------------------------------
  const texto5 = ['LUIS', 'Houston astros -150', 'Equipo Inventado FC alta 2-115', '100//9999✅'].join('\n');
  const r5 = await procesarSabana('grupo-1', texto5, FECHA_PRUEBA);
  const t5 = r5.tickets.find(t => t.cliente === 'LUIS');
  check(t5.estado === 'PENDIENTE', 'Parley con 1 pata sin mapear + 1 pata con pendencia REAL de API: NO se usa el marcador manual, sigue PENDIENTE');
  check(t5.resueltoPorMarcadorManualSinMapeo === false, 'No se activa el override cuando hay una pendencia real mezclada');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "marcador manual + equipo sin mapear" se cayó con una excepción:', e);
  process.exit(1);
});
