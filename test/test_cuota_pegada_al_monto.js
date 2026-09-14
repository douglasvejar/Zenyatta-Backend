// =================================================================
// PRUEBA: cuota confundida con el monto arriesgado cuando este va pegado
// al final de la jugada SIN "x"/"para" delante (03-09-2026, a partir de
// un ticket real del usuario: "⚾Cincinnati 1h +130  100$" / "100///130✅").
// =================================================================
// El usuario reportó que este ticket calculaba mal cuánto pagaba según lo
// arriesgado y la cuota. Causa real, encontrada leyendo el código:
//   1. extraerCuotaAmericana() (parser.js) tomaba el ÚLTIMO número de
//      magnitud >= 100 que encontraba en la jugada, sin exigir que
//      tuviera signo +/-. En "cincinnati 1h +130 100$" hay 2 números de esa
//      magnitud: la cuota real (+130) y el monto pegado al final (100$,
//      sin "x" delante, así que nada lo limpiaba del texto) — como el
//      monto aparece DESPUÉS en el texto, se usaba por error como si fuera
//      la cuota, dando un pago de $100 en vez de $130.
//   2. La línea "100///130✅" (3 barras en vez de 2, típeo fácil en
//      WhatsApp) no matcheaba el regex de "arriesga//paga" completo — solo
//      alcanzaba a leer el arriesgo (100), el pago real escrito (130) se
//      perdía en silencio y el ticket quedaba "pago estimado" en vez de
//      tomar el que ya traía la sábana.
// Los 2 se corrigen acá: una cuota americana real SIEMPRE lleva signo
// (+/-) — exigirlo alcanza para no confundirla con un monto en dólares sin
// necesidad de que el monto esté marcado de ninguna forma en particular; y
// el regex de "arriesga//paga" ahora acepta 2 o más barras seguidas.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  // (04-09-2026) registrosSinCambios() en historial.js — esta prueba no
  // trackea el contenido real de tickets_historial, así que "sin filas
  // guardadas todavía" es siempre la respuesta correcta acá.
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

// Cincinnati Reds (visita) ganó 5-2 EN EL JUEGO COMPLETO, y ya iba arriba
// 3-1 al cierre de la 5ta entrada — la jugada del ticket es "1h" (alias de
// "5inn" en MLB), así que lo que importa para evaluarla es el marcador a
// las 5 entradas, no el final. Con Cincinnati arriba en la 5ta, un
// moneyline a su favor (+130) queda GANADA.
const FECHA_PRUEBA = '2026-09-02';
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: 'St. Louis Cardinals' }, score: 2 },
              away: { team: { name: 'Cincinnati Reds' }, score: 5 }
            },
            linescore: {
              currentInning: 9,
              inningState: 'End',
              innings: [
                { home: { runs: 0 }, away: { runs: 1 } },
                { home: { runs: 1 }, away: { runs: 0 } },
                { home: { runs: 0 }, away: { runs: 2 } },
                { home: { runs: 0 }, away: { runs: 0 } },
                { home: { runs: 0 }, away: { runs: 0 } },
                { home: { runs: 1 }, away: { runs: 1 } },
                { home: { runs: 0 }, away: { runs: 0 } },
                { home: { runs: 0 }, away: { runs: 1 } },
                { home: { runs: 0 }, away: { runs: 0 } }
              ]
            },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
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

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
global.fetch = fakeFetch;

const { procesarSabana } = require(path.join(__dirname, '..', 'src', 'services', 'procesarSabana'));
const { parsearSabana, extraerCuotaAmericana } = require(path.join(__dirname, '..', 'src', 'services', 'parser'));
const { normalizarTexto } = require(path.join(__dirname, '..', 'src', 'services', 'normalizar'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) extraerCuotaAmericana(): un monto pegado SIN "x"/"para" ya no
  // se confunde con la cuota, aunque aparezca DESPUÉS en el texto y tenga
  // magnitud >= 100 igual que la cuota real ---
  const jNorm = normalizarTexto('⚾Cincinnati 1h +130  100$');
  check(extraerCuotaAmericana(jNorm) === 130, 'extraerCuotaAmericana(): "cincinnati 1h +130 100$" reconoce +130 como la cuota, no el 100$ pegado al final');

  // Regresión: sigue funcionando igual que antes con casos ya cubiertos.
  check(extraerCuotaAmericana(normalizarTexto('atlanta -120')) === -120, 'extraerCuotaAmericana(): regresión, "atlanta -120" sigue devolviendo -120');
  check(extraerCuotaAmericana(normalizarTexto('alta atlanta 4.5')) === null, 'extraerCuotaAmericana(): regresión, "alta atlanta 4.5" (sin cuota real) sigue devolviendo null');

  // Regresión: un monto arriesgado con "x" o "para" delante se sigue
  // limpiando igual que siempre (esto ya funcionaba, pero confirma que el
  // cambio de exigir signo no rompió el camino existente).
  check(extraerCuotaAmericana(normalizarTexto('houston -150 x 200')) === -150, 'extraerCuotaAmericana(): regresión, "houston -150 x 200" (monto con "x" delante) sigue devolviendo -150, no el 200');
  check(extraerCuotaAmericana(normalizarTexto('houston -150 para 300')) === -150, 'extraerCuotaAmericana(): regresión, "houston -150 para 300" (monto con "para" delante) sigue devolviendo -150, no el 300');

  // --- 2) parsearSabana(): la línea "arriesga//paga" con 3 barras en vez
  // de 2 ya no pierde el pago escrito en la sábana ---
  const boletos3barras = parsearSabana(['YANKEE', '⚾Cincinnati 1h +130  100$', '100///130✅'].join('\n'), {});
  check(boletos3barras.length === 1, 'parsearSabana(): "100///130✅" (3 barras) sigue generando 1 solo boleto, no se pierde ni se duplica');
  check(boletos3barras[0].arriesga === 100, 'parsearSabana(): con 3 barras, arriesga se lee bien (100)');
  check(boletos3barras[0].pagaSabana === 130, 'parsearSabana(): con 3 barras, el pago YA NO se pierde — pagaSabana = 130 (antes quedaba en 0)');
  check(boletos3barras[0].marcadorManual === '✅', 'parsearSabana(): con 3 barras, el marcador manual (✅) se sigue leyendo bien');

  // Regresión: la línea normal de 2 barras sigue funcionando igual.
  const boletos2barras = parsearSabana(['ANA', 'houston -120', '100//180'].join('\n'), {});
  check(boletos2barras[0].arriesga === 100 && boletos2barras[0].pagaSabana === 180, 'parsearSabana(): regresión, "100//180" (2 barras, formato normal) sigue funcionando igual');

  // --- 3) procesarSabana() de punta a punta con el ticket REAL del
  // usuario: ya no queda "pago estimado" mal calculado ---
  const texto = ['YANKEE', '⚾Cincinnati 1h +130  100$', '100///130✅'].join('\n');
  const resp = await procesarSabana('g1', texto, FECHA_PRUEBA);
  const tYankee = resp.tickets.find(t => t.cliente === 'YANKEE');
  check(tYankee.estado === 'GANADA', 'YANKEE (Cincinnati +130, ganó 5-2): estado real = GANADA');
  check(Math.abs(tYankee.paga - 130) < 0.01, 'YANKEE: el pago calculado es $130 (100 arriesgado x cuota +130), no $100 como antes del arreglo');
  check(tYankee.esPagoEstimado === false, 'YANKEE: ya no queda como "estimado" — el pago SÍ vino escrito en la sábana (130), una vez que la línea de 3 barras se lee bien');
  check(tYankee.pagaConDiscrepancia === false, 'YANKEE: el pago escrito (130) coincide con el calculado (130) — no hay discrepancia que avisar');
  check(tYankee.marcadorManualIncorrecto === false, 'YANKEE: el ✅ que puso a mano coincide con GANADA (resultado real) — no se marca como incorrecto');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
