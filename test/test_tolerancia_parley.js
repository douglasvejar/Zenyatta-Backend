// =================================================================
// PRUEBA DE INTEGRACIÓN: la tolerancia de "¿el pago escrito en la sábana
// coincide con el calculado?" ahora tiene un TECHO fijo, no solo un
// porcentaje (06-09-2026, bug real reportado por el usuario).
// =================================================================
// El usuario reportó: "hay un error en los parleys si se pasan sellado ya
// en la sabana con lo arriesgado y cuanto ganaria el cliente y esta mal
// ese calculo no lo corrige pero en las directas si se corrigen".
//
// Causa: procesarSabana.js compara el pago ESCRITO en la sábana contra el
// pago CALCULADO desde las cuotas, y solo lo corrige/avisa si la
// diferencia supera una tolerancia — pero esa tolerancia era SOLO "2% del
// pago calculado" (con un piso de $1, sin ningún techo). Una jugada
// DIRECTA (1 sola pata) casi siempre paga poco (decenas o pocos cientos
// de dólares), así que el 2% ahí son apenas $1-5 — cualquier error real
// de la sábana lo supera fácil y se corrige, como el usuario ya veía. Un
// PARLEY combina varias cuotas MULTIPLICADAS entre sí, así que su pago
// real es varias veces más grande que el de una jugada directa — el
// MISMO 2% ahí ya son $50, $100, hasta $300+ de margen. Un error real de
// sábana (mal sumado/multiplicado a mano) de esa magnitud quedaba
// ESCONDIDO adentro de ese margen enorme y nunca se corregía ni se
// avisaba — exactamente el reporte del usuario.
//
// Arreglo: la tolerancia ahora tiene un techo fijo de $5, sin importar
// cuán grande sea el pago del parley (`src/services/procesarSabana.js`,
// Math.min(Math.max(1, pagoCalculado * 0.02), 5)) — sigue tolerando el
// redondeo normal de centavos/dólar (el piso de $1 se mantiene), pero
// cualquier diferencia de más de $5 se corrige y se avisa, sea un parley
// o una jugada directa.
//
// Mismo patrón de base de datos falsa + fetch falso que
// test_alertas_integracion.js/test_ticket_sin_jugadas.js — corre el
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

// 8 juegos de MLB, todos "GANADOS" por el equipo local — alcanza para
// armar un parley de 8 patas con cuotas variadas (favoritos moderados).
const JUEGOS = [
  ['Houston Astros', 'Texas Rangers', 6, 2],
  ['Boston Red Sox', 'New York Yankees', 5, 1],
  ['Atlanta Braves', 'Miami Marlins', 4, 1],
  ['Chicago Cubs', 'St. Louis Cardinals', 7, 3],
  ['Los Angeles Dodgers', 'San Diego Padres', 3, 2],
  ['New York Mets', 'Philadelphia Phillies', 5, 4],
  ['Seattle Mariners', 'Oakland Athletics', 6, 1],
  ['Toronto Blue Jays', 'Baltimore Orioles', 4, 3]
];

function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: JUEGOS.map((j, i) => ({
            gameNumber: 1,
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: j[0] }, score: j[2] },
              away: { team: { name: j[1] }, score: j[3] }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
            gamePk: 500 + i
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

const CUOTAS = [-150, -130, -140, -160, -155, -145, -135, -150];
function decimal(c) { return c > 0 ? 1 + c / 100 : 1 + 100 / Math.abs(c); }
function pagoRealParley(arriesgo) {
  return CUOTAS.reduce((acc, c) => acc * decimal(c), 1) * arriesgo - arriesgo;
}

const EQUIPOS = [
  'Houston astros -150', 'Boston red sox -130', 'Atlanta braves -140', 'Chicago cubs -160',
  'Los angeles dodgers -155', 'New york mets -145', 'Seattle mariners -135', 'Toronto blue jays -150'
];

(async function main() {
  // -----------------------------------------------------------------
  // Caso 1 (el bug reportado): parley de 8 patas, arriesgo $100, pago
  // real ≈ $6524.59 — la sábana lo trae SELLADO con un error de $100
  // (1.53% del pago real, bien por debajo del viejo 2% de tolerancia,
  // pero MUY por encima de cualquier redondeo razonable). Antes de este
  // arreglo, esto NO se corregía ni se avisaba — ahora sí.
  // -----------------------------------------------------------------
  const pagoReal1 = pagoRealParley(100);
  const pagoSellado1 = pagoReal1 - 100;
  const texto1 = ['CARLOS', ...EQUIPOS, '100//' + pagoSellado1.toFixed(2)].join('\n');
  const r1 = await procesarSabana('grupo-1', texto1, FECHA_PRUEBA);
  const t1 = r1.tickets.find(t => t.cliente === 'CARLOS');

  check(t1.estado === 'GANADA', 'Parley de 8 patas, todas ganadoras: el ticket queda GANADA');
  check(Math.abs(t1.paga - pagoReal1) < 0.01, 'El pago mostrado es el CALCULADO desde las cuotas (≈$' + pagoReal1.toFixed(2) + '), no el sellado con el error de $100 — antes de este arreglo se quedaba con el número mal escrito');
  check(t1.pagaConDiscrepancia === true, 'Se marca pagaConDiscrepancia=true — un error de $100 en un parley de este tamaño (1.53% del pago) ya NO pasa desapercibido');
  check(Math.abs(t1.pagaSabanaOriginal - pagoSellado1) < 0.01, 'pagaSabanaOriginal conserva el número que en verdad traía la sábana, para poder mostrar el aviso "⚠ sábana decía $X"');

  // -----------------------------------------------------------------
  // Caso 2 (no debe romperse): la MISMA sábana pero con el pago sellado
  // bien calculado, solo con un redondeo de centavos — no debe avisar de
  // ninguna discrepancia (el piso de $1 de tolerancia se mantiene).
  // -----------------------------------------------------------------
  const pagoSellado2 = pagoReal1 + 0.30;
  const texto2 = ['MARIA', ...EQUIPOS, '100//' + pagoSellado2.toFixed(2)].join('\n');
  const r2 = await procesarSabana('grupo-1', texto2, FECHA_PRUEBA);
  const t2 = r2.tickets.find(t => t.cliente === 'MARIA');
  check(t2.pagaConDiscrepancia === false, 'Un redondeo chico (30 centavos) en un parley grande sigue sin generar ninguna alerta de discrepancia — la tolerancia de $1 de piso no se tocó');

  // -----------------------------------------------------------------
  // Caso 3 (regresión, "las directas siguen igual"): una jugada de 1 sola
  // pata (Houston -150), arriesgo $100, con un error de $10 en el pago
  // sellado (bien por encima del techo de $5) — se sigue corrigiendo,
  // como ya pasaba antes del arreglo.
  // -----------------------------------------------------------------
  const pagoRealDirecta = 100 * decimal(-150) - 100; // 66.67
  const pagoSelladoDirecta = pagoRealDirecta + 10;
  const texto3 = ['PEDRO', 'Houston astros -150', '100//' + pagoSelladoDirecta.toFixed(2)].join('\n');
  const r3 = await procesarSabana('grupo-1', texto3, FECHA_PRUEBA);
  const t3 = r3.tickets.find(t => t.cliente === 'PEDRO');
  check(t3.pagaConDiscrepancia === true, 'Jugada DIRECTA con un error de $10 en el pago sellado: se sigue corrigiendo igual que siempre (esto no cambió)');
  check(Math.abs(t3.paga - pagoRealDirecta) < 0.01, 'Jugada DIRECTA: el pago corregido es el calculado desde la cuota (≈$' + pagoRealDirecta.toFixed(2) + ')');

  // -----------------------------------------------------------------
  // Caso 4 (el techo nuevo, límite exacto): un parley con un error de
  // exactamente $5.50 en el pago sellado tiene que corregirse (supera el
  // techo de $5); uno con $4.50 de diferencia todavía entra dentro del
  // techo y no debe avisar nada (evita "sobre-corregir" por centavos).
  // -----------------------------------------------------------------
  const texto4a = ['LUISA', ...EQUIPOS, '100//' + (pagoReal1 - 5.50).toFixed(2)].join('\n');
  const r4a = await procesarSabana('grupo-1', texto4a, FECHA_PRUEBA);
  const t4a = r4a.tickets.find(t => t.cliente === 'LUISA');
  check(t4a.pagaConDiscrepancia === true, 'Parley grande con una diferencia de $5.50 (por encima del techo de $5): SÍ se corrige');

  const texto4b = ['LUISA2', ...EQUIPOS, '100//' + (pagoReal1 - 4.50).toFixed(2)].join('\n');
  const r4b = await procesarSabana('grupo-1', texto4b, FECHA_PRUEBA);
  const t4b = r4b.tickets.find(t => t.cliente === 'LUISA2');
  check(t4b.pagaConDiscrepancia === false, 'Parley grande con una diferencia de $4.50 (por debajo del techo de $5): NO se avisa como discrepancia');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de tolerancia de parleys se cayó con una excepción:', e);
  process.exit(1);
});
