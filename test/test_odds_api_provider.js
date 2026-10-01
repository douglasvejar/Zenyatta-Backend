// =================================================================
// PRUEBA: oddsApiProvider.js — el conector a The Odds API para los
// logros automáticos de la Calculadora Parley (01-10-2026).
//
// Mismo patrón que test_api_football_1h.js: no depende de ninguna red
// real, simula `global.fetch`. La forma del JSON de abajo (events[] con
// id/sport_key/sport_title/commence_time/home_team/away_team/
// bookmakers[].markets[].outcomes[].{name,price}) es la documentada por
// The Odds API para GET /v4/sports/{sport}/odds — ver
// https://the-odds-api.com/liveapi/guides/v4/
// =================================================================
const assert = require('assert');
const { obtenerLogrosDeDeporte, obtenerTodosLosLogros } = require('../src/services/oddsApiProvider');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function eventoMLB() {
  return {
    id: 'evt-mlb-1',
    sport_key: 'baseball_mlb',
    sport_title: 'MLB',
    commence_time: '2026-10-01T23:05:00Z',
    home_team: 'San Francisco Giants',
    away_team: 'San Diego Padres',
    bookmakers: [
      {
        key: 'fanduel',
        markets: [
          { key: 'h2h', outcomes: [{ name: 'San Francisco Giants', price: -125 }, { name: 'San Diego Padres', price: 130 }] }
        ]
      }
    ]
  };
}

function eventoSoccer3Vias() {
  return {
    id: 'evt-soccer-1',
    sport_key: 'soccer_epl',
    sport_title: 'EPL',
    commence_time: '2026-10-02T15:00:00Z',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    bookmakers: [
      {
        key: 'pinnacle',
        markets: [
          { key: 'h2h', outcomes: [{ name: 'Arsenal', price: -150 }, { name: 'Draw', price: 280 }, { name: 'Chelsea', price: 400 }] }
        ]
      }
    ]
  };
}

(async () => {
  // --- 1) 2 vías (MLB) -> 2 filas, deporte agrupado desde "sport_key" ---
  global.fetch = async () => ({ ok: true, json: async () => [eventoMLB()] });
  const r1 = await obtenerLogrosDeDeporte('baseball_mlb', 'clave-de-prueba');
  check(!r1.huboError, 'MLB: la consulta se procesa sin error');
  check(r1.filas.length === 2, 'MLB: 1 evento con 2 outcomes -> 2 filas (local y visitante, sin empate)');
  const giants = r1.filas.find(f => f.nombreSeleccion === 'San Francisco Giants');
  const padres = r1.filas.find(f => f.nombreSeleccion === 'San Diego Padres');
  check(giants && giants.seleccion === 'local' && giants.logro === -125, 'MLB: Giants es "local" con logro -125 (favorito)');
  check(padres && padres.seleccion === 'visitante' && padres.logro === 130, 'MLB: Padres es "visitante" con logro +130 (contendor)');
  check(giants.deporte === 'baseball', 'MLB: deporte agrupador = "baseball" (prefijo de "baseball_mlb", antes del primer "_")');
  check(giants.liga === 'MLB', 'MLB: liga = sport_title tal cual lo manda el proveedor ("MLB")');
  check(giants.eventoId === 'evt-mlb-1', 'MLB: eventoId = id del proveedor (agrupa las filas de este mismo partido)');

  // --- 2) 3 vías (fútbol) -> 3 filas, incluyendo "Empate" ---
  global.fetch = async () => ({ ok: true, json: async () => [eventoSoccer3Vias()] });
  const r2 = await obtenerLogrosDeDeporte('soccer_epl', 'clave-de-prueba');
  check(r2.filas.length === 3, 'Fútbol: mercado h2h de 3 vías -> 3 filas (local, empate, visitante)');
  const empate = r2.filas.find(f => f.seleccion === 'empate');
  check(empate && empate.nombreSeleccion === 'Empate' && empate.logro === 280, 'Fútbol: el outcome "Draw" se mapea a seleccion:"empate" con nombre a mostrar "Empate"');
  const arsenal = r2.filas.find(f => f.nombreSeleccion === 'Arsenal');
  check(arsenal && arsenal.seleccion === 'local', 'Fútbol: Arsenal (home_team) es "local"');

  // --- 3) Evento sin ningún bookmaker con h2h completo -> se descarta esa fila sin reventar ---
  global.fetch = async () => ({ ok: true, json: async () => [{ ...eventoMLB(), bookmakers: [] }] });
  const r3 = await obtenerLogrosDeDeporte('baseball_mlb', 'clave-de-prueba');
  check(r3.filas.length === 0 && !r3.huboError, 'Evento sin bookmakers: no revienta, simplemente no aporta filas');

  // --- 4) HTTP no-OK -> huboError:true con el motivo en mensajeError ---
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Invalid API key.' }) });
  const r4 = await obtenerLogrosDeDeporte('baseball_mlb', 'clave-invalida');
  check(r4.huboError && r4.filas.length === 0, 'Clave inválida (HTTP 401): huboError:true, sin filas');
  check(r4.mensajeError.includes('401') && r4.mensajeError.includes('Invalid API key'), 'El mensaje de error trae el status y el motivo que mandó el proveedor');

  // --- 5) Error de red (fetch rechaza) -> no revienta, huboError:true ---
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const r5 = await obtenerLogrosDeDeporte('baseball_mlb', 'clave-de-prueba');
  check(r5.huboError && r5.mensajeError.includes('ENOTFOUND'), 'Error de red: se atrapa, no tumba el proceso, el motivo queda en mensajeError');

  // --- 6) obtenerTodosLosLogros: junta varios deportes, un error de uno no frena a los demás ---
  let llamada = 0;
  global.fetch = async (url) => {
    llamada++;
    if (url.includes('basketball_nba')) return { ok: false, status: 429, json: async () => ({ message: 'Out of usage credits.' }) };
    return { ok: true, json: async () => [eventoMLB()] };
  };
  const r6 = await obtenerTodosLosLogros(['baseball_mlb', 'basketball_nba', 'americanfootball_nfl'], 'clave-de-prueba');
  check(llamada === 3, 'obtenerTodosLosLogros: hace 1 pedido por cada "sport key" de la lista');
  check(r6.filas.length === 4, 'obtenerTodosLosLogros: junta las filas de los deportes que SÍ respondieron bien (2 deportes x 2 filas)');
  check(r6.errores.length === 1 && r6.errores[0].includes('429'), 'obtenerTodosLosLogros: el deporte que falló (créditos agotados) queda en "errores", sin frenar a los demás');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
