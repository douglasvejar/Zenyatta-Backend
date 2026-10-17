// =================================================================
// PRUEBA: UN JUEGO DE MLB POSPUESTO / SUSPENDIDO / CANCELADO NUNCA SE EVALUA COMO TERMINADO 0-0 (17-10-2026).
// Caso real: "Over Guardians (6.5)-110" de WISTON salio PERDIDA con "0 carreras totales" aunque el juego se
// suspendio. La API de MLB manda los juegos pospuestos/cancelados con abstractGameState "Final" (codedGameState
// "D"/"C", sin marcador); el sistema los creia terminados y todo Over perdia. Ahora deben dar SUSPENDIDA.
// =================================================================
const { normalizarTexto } = require('../src/services/normalizar');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');
const { evaluarJugadaMLB } = require('../src/services/evaluador');
const { obtenerResultadosAPIs } = require('../src/services/mlbApi');

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

const juego = (pk, home, away, status, extra) => Object.assign({ gameNumber: 1, gamePk: pk, status, teams: { home: { team: { name: home } }, away: { team: { name: away } } } }, extra || {});

(async function main() {
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({
    json: async () => ({
      dates: [{
        games: [
          // Pospuesto: la API lo manda "Final" pero con codedGameState D, sin marcador ni linescore
          juego(1, 'Cleveland Guardians', 'Detroit Tigers', { abstractGameState: 'Final', codedGameState: 'D', detailedState: 'Postponed', statusCode: 'D', reason: 'Rain' }),
          // Suspendido (U) llamado "Final" por la API
          juego(2, 'Houston Astros', 'Texas Rangers', { abstractGameState: 'Final', codedGameState: 'U', detailedState: 'Suspended: Rain', statusCode: 'U' }, { linescore: { innings: [] } }),
          // Suspendido en vivo (abstract Live)
          juego(3, 'Boston Red Sox', 'New York Yankees', { abstractGameState: 'Live', codedGameState: 'U', detailedState: 'Suspended: Rain' }, { linescore: { innings: [] } }),
          // Cancelado
          juego(4, 'Chicago Cubs', 'St. Louis Cardinals', { abstractGameState: 'Final', codedGameState: 'C', detailedState: 'Cancelled' }),
          // Juego normal terminado
          juego(5, 'Seattle Mariners', 'Oakland Athletics', { abstractGameState: 'Final', codedGameState: 'F', detailedState: 'Final', statusCode: 'F' },
            { teams: { home: { team: { name: 'Seattle Mariners' }, score: 5 }, away: { team: { name: 'Oakland Athletics' }, score: 4 } }, linescore: { innings: [] } }),
          // Suspendido despues de la 6ta entrada con 3 carreras: las 5 entradas SI se completaron
          juego(6, 'Atlanta Braves', 'Miami Marlins', { abstractGameState: 'Live', codedGameState: 'U', detailedState: 'Suspended: Rain' },
            { teams: { home: { team: { name: 'Atlanta Braves' }, score: 2 }, away: { team: { name: 'Miami Marlins' }, score: 1 } },
              linescore: { currentInning: 6, inningState: 'Middle', innings: [{ home: { runs: 1 }, away: { runs: 0 } }, { home: { runs: 0 }, away: { runs: 1 } }, { home: { runs: 1 }, away: { runs: 0 } }, { home: { runs: 0 }, away: { runs: 0 } }, { home: { runs: 0 }, away: { runs: 0 } }] } })
        ]
      }]
    })
  });
  try {
    const datos = await obtenerResultadosAPIs('2026-10-16');
    const g = datos['cleveland guardians'];
    check(g && g.suspendido === true && g.finalizado === false, 'Pospuesto ("Final" + codedGameState D, sin marcador): suspendido=true y finalizado=false');
    check(datos['houston astros'].suspendido === true && datos['houston astros'].finalizado === false, 'Suspendido que la API llama "Final" (codedGameState U): suspendido, no finalizado');
    check(datos['boston red sox'].suspendido === true && datos['boston red sox'].finalizado === false, 'Suspendido en vivo: suspendido, no finalizado');
    check(datos['chicago cubs'].suspendido === true && datos['chicago cubs'].finalizado === false, 'Cancelado: suspendido, no finalizado');
    check(datos['seattle mariners'].finalizado === true && datos['seattle mariners'].suspendido === false && datos['seattle mariners'].totalRuns === 9, 'Juego normal terminado: sigue finalizado (9 carreras)');

    const over = evaluarJugadaMLB(normalizarTexto('Over Guardians (6.5)-110'), datos, DICCIONARIO_EQUIPOS_BASE);
    check(over.estado === 'SUSPENDIDA', `El Over del juego pospuesto da SUSPENDIDA (no PERDIDA con 0 carreras) -- dio ${over.estado}`);
    const under = evaluarJugadaMLB(normalizarTexto('Under Guardians (6.5)-110'), datos, DICCIONARIO_EQUIPOS_BASE);
    check(under.estado === 'SUSPENDIDA', `El Under del juego pospuesto tampoco gana por 0 carreras: da SUSPENDIDA -- dio ${under.estado}`);
    const ml = evaluarJugadaMLB(normalizarTexto('Cubs -120'), datos, DICCIONARIO_EQUIPOS_BASE);
    check(ml.estado === 'SUSPENDIDA', `Una moneyline del juego cancelado da SUSPENDIDA -- dio ${ml.estado}`);
    const ok = evaluarJugadaMLB(normalizarTexto('Mariners -110'), datos, DICCIONARIO_EQUIPOS_BASE);
    check(ok.estado === 'GANADA', `Un juego normal sigue evaluandose igual (Mariners ganó 5-4) -- dio ${ok.estado}`);
    const completo = evaluarJugadaMLB(normalizarTexto('Over Braves 4.5'), datos, DICCIONARIO_EQUIPOS_BASE);
    check(completo.estado === 'SUSPENDIDA', `Un juego suspendido a mitad no se resuelve por el marcador parcial en juego completo -- dio ${completo.estado}`);
    const cinco = evaluarJugadaMLB(normalizarTexto('Over Braves 5inn 2.5'), datos, DICCIONARIO_EQUIPOS_BASE);
    check(cinco.estado === 'GANADA' || cinco.estado === 'PERDIDA' || cinco.estado === 'PUSH', `Las 5 entradas SI se completaron antes de suspender: la apuesta de 5inn se decide (${cinco.estado})`);
  } finally { global.fetch = fetchOriginal; }
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
