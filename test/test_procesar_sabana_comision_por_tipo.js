// =================================================================
// PRUEBA DE INTEGRACIÓN: procesarSabana.js con el grupo configurado en
// el modelo de comisión 'por_tipo_jugada' (08-09-2026, a pedido del
// usuario — ver la nota grande en comisiones.js/sql/schema.sql).
// =================================================================
// Corre el orquestador COMPLETO (procesarSabana.js) contra una base de
// datos falsa en memoria (mismo patrón que test_tolerancia_parley.js/
// test_sabana_polla_y_mayusculas.js), con un grupo cuyo modelo_comision
// es 'por_tipo_jugada' y tiers = [1 logro -> 2%, 2 logros -> 3%,
// 3 logros -> 5%] — exactamente el ejemplo que dio el usuario.
//
// Escenario armado a mano:
//   ANA juega 3 tickets el mismo día:
//     - Directa (1 logro), arriesga 100, GANADA -> comisión 100*2% = 2
//     - Parley de 2 logros, arriesga 200, GANADA -> comisión 200*3% = 6
//     - Parley de 3 logros, arriesga 50, GANADA -> comisión 50*5% = 2.5
//     Total esperado de ANA: 2 + 6 + 2.5 = 10.5
//
//   LUIS juega 1 ticket:
//     - Parley de 2 logros, arriesga 300, PERDIDA (una pata pierde) ->
//       comisión 300*3% = 9 (PERDIDA también es comisionable, igual que
//       en el modelo plano de siempre)
//
// Verifica que:
//   1. resumenPorCliente trae porcentajePropio: null y comisionPropia ya
//      sumada correctamente por cliente.
//   2. La respuesta trae modeloComision: 'por_tipo_jugada' (para que el
//      frontend sepa mostrar "Por tipo de jugada" en vez de un %).
//   3. Cada ticket de ticketsDetalle trae su "logros" (cantidad de patas)
//      correcto.
//   4. guardarEnHistorial() persiste "logros" en el INSERT de
//      tickets_historial — para que el rango histórico se pueda
//      reconstruir más adelante sin reprocesar la sábana original.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-tipo-jugada';
const FECHA_PRUEBA = '2026-09-08';

const TIERS = [
  { logros: 1, porcentaje: 2 },
  { logros: 2, porcentaje: 3 },
  { logros: 3, porcentaje: 5 }
];

const insertsHistorial = []; // captura cada INSERT INTO tickets_historial (con "logros" incluido)

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };

  // El grupo de esta prueba está en 'por_tipo_jugada' con los 3 tiers
  // del ejemplo del usuario (directas 2%, 2 logros 3%, 3 logros 5%).
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    return { rows: [{ modelo_comision: 'por_tipo_jugada', comision_tiers: TIERS }] };
  }

  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO tickets_historial/i.test(sql)) {
    insertsHistorial.push(params);
    return { rows: [] };
  }
  // registrosSinCambios() — sin nada guardado todavía, siempre "distinto".
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/FROM polla_historial/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO alertas/i.test(sql)) return { rows: [{ id: 'alerta-' + Math.random().toString(36).slice(2) }] };

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

// 3 juegos de MLB, todos ganados por el equipo local (moneyline
// favorito) — alcanza para armar la directa + los 2 parleys de ANA, y
// el parley de LUIS que pierde una pata (apostando al visitante que
// perdió).
const JUEGOS = [
  ['Houston Astros', 'Texas Rangers', 6, 2],
  ['Boston Red Sox', 'New York Yankees', 5, 1],
  ['Atlanta Braves', 'Miami Marlins', 4, 1]
];

function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: JUEGOS.map((j, i) => ({
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: j[0] }, score: j[2] },
              away: { team: { name: j[1] }, score: j[3] }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
            gamePk: 700 + i
          }))
        }]
      })
    });
  }
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

// --- helpers para calcular el pago "sellado" exacto de cada ticket, así
// no queda ningún margen de tolerancia que dispare alertas de más ---
function decimal(c) { return c > 0 ? 1 + c / 100 : 1 + 100 / Math.abs(c); }
function pago(cuotas, arriesgo) {
  return cuotas.reduce((acc, c) => acc * decimal(c), 1) * arriesgo - arriesgo;
}

(async function main() {
  const cuotaAstros = -150; // gana (favorito local que ganó)
  const cuotaRedSox = -130; // gana
  const cuotaBraves = -140; // gana
  const cuotaRangers = 140; // el usuario apostó al VISITANTE que perdió -> pierde la pata

  // --- ANA: directa (1 logro) ---
  const pagoDirecta = pago([cuotaAstros], 100);
  const textoDirecta = ['ANA', 'Houston astros -150', '100//' + pagoDirecta.toFixed(2)].join('\n');

  // --- ANA: parley de 2 logros ---
  const pagoParley2 = pago([cuotaAstros, cuotaRedSox], 200);
  const textoParley2 = ['ANA', 'Houston astros -150', 'Boston red sox -130', '200//' + pagoParley2.toFixed(2)].join('\n');

  // --- ANA: parley de 3 logros ---
  const pagoParley3 = pago([cuotaAstros, cuotaRedSox, cuotaBraves], 50);
  const textoParley3 = ['ANA', 'Houston astros -150', 'Boston red sox -130', 'Atlanta braves -140', '50//' + pagoParley3.toFixed(2)].join('\n');

  // --- LUIS: parley de 2 logros, una pata pierde (Texas Rangers +140) ---
  const pagoParleyLuis = pago([cuotaRangers, cuotaRedSox], 300);
  const textoLuis = ['LUIS', 'Texas rangers +140', 'Boston red sox -130', '300//' + pagoParleyLuis.toFixed(2)].join('\n');

  const texto = [textoDirecta, '', textoParley2, '', textoParley3, '', textoLuis].join('\n');
  const resp = await procesarSabana(GRUPO_ID, texto, FECHA_PRUEBA);

  // --- 1) La respuesta avisa que este grupo usa 'por_tipo_jugada' ---
  check(resp.modeloComision === 'por_tipo_jugada', 'la respuesta trae modeloComision: "por_tipo_jugada", para que el frontend sepa cómo mostrar la columna de %');

  // --- 2) resumenPorCliente: porcentajePropio null + comisionPropia acumulada ticket por ticket ---
  const filaAna = resp.resumenPorCliente.find(c => c.cliente === 'ANA');
  check(!!filaAna, 'resumenPorCliente incluye a ANA');
  check(filaAna.porcentajePropio === null, 'ANA: porcentajePropio sale null (el % depende de cada ticket, no hay un solo número que mostrar)');
  check(Math.abs(filaAna.comisionPropia - 10.5) < 0.01, 'ANA: comisionPropia = 100*2% + 200*3% + 50*5% = 2 + 6 + 2.5 = 10.5 (' + filaAna.comisionPropia + ')');

  const filaLuis = resp.resumenPorCliente.find(c => c.cliente === 'LUIS');
  check(!!filaLuis, 'resumenPorCliente incluye a LUIS');
  check(filaLuis.porcentajePropio === null, 'LUIS: porcentajePropio también sale null');
  check(Math.abs(filaLuis.comisionPropia - 9) < 0.01, 'LUIS: comisionPropia = 300*3% = 9, aunque el ticket haya sido PERDIDA (PERDIDA también es comisionable, igual que en el modelo plano)');

  // --- 3) Cada ticket de ticketsDetalle trae su "logros" correcto ---
  const ticketsAna = resp.tickets.filter(t => t.cliente === 'ANA');
  check(ticketsAna.length === 3, 'ANA tiene 3 tickets en ticketsDetalle');
  const directaAna = ticketsAna.find(t => Math.abs(t.arriesga - 100) < 0.01);
  const parley2Ana = ticketsAna.find(t => Math.abs(t.arriesga - 200) < 0.01);
  const parley3Ana = ticketsAna.find(t => Math.abs(t.arriesga - 50) < 0.01);
  check(!!directaAna && directaAna.logros === 1, 'el ticket directo de ANA (arriesga 100) trae logros: 1');
  check(!!parley2Ana && parley2Ana.logros === 2, 'el parley de 2 patas de ANA (arriesga 200) trae logros: 2');
  check(!!parley3Ana && parley3Ana.logros === 3, 'el parley de 3 patas de ANA (arriesga 50) trae logros: 3');

  const ticketLuis = resp.tickets.find(t => t.cliente === 'LUIS');
  check(!!ticketLuis && ticketLuis.logros === 2, 'el ticket de LUIS (parley de 2 patas) trae logros: 2');
  check(ticketLuis.estado === 'PERDIDA', 'el ticket de LUIS quedó PERDIDA (apostó al equipo visitante, que perdió)');

  // --- 4) guardarEnHistorial() persiste "logros" en el INSERT de tickets_historial ---
  // Orden de columnas del INSERT (historial.js): grupo_id, fecha, cliente,
  // jugador_id, ticket_label, detalle, arriesga, gana, estado, logros.
  check(insertsHistorial.length === 4, 'se hicieron exactamente 4 INSERT INTO tickets_historial (3 de ANA + 1 de LUIS)');
  const insertDirectaAna = insertsHistorial.find(p => p[2] === 'ANA' && Math.abs(p[6] - 100) < 0.01);
  const insertParley2Ana = insertsHistorial.find(p => p[2] === 'ANA' && Math.abs(p[6] - 200) < 0.01);
  const insertParley3Ana = insertsHistorial.find(p => p[2] === 'ANA' && Math.abs(p[6] - 50) < 0.01);
  const insertLuis = insertsHistorial.find(p => p[2] === 'LUIS');
  check(!!insertDirectaAna && insertDirectaAna[9] === 1, 'el INSERT del ticket directo de ANA guarda logros = 1 en la columna 10 (tickets_historial.logros)');
  check(!!insertParley2Ana && insertParley2Ana[9] === 2, 'el INSERT del parley de 2 patas de ANA guarda logros = 2');
  check(!!insertParley3Ana && insertParley3Ana[9] === 3, 'el INSERT del parley de 3 patas de ANA guarda logros = 3');
  check(!!insertLuis && insertLuis[9] === 2, 'el INSERT del ticket de LUIS guarda logros = 2');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
