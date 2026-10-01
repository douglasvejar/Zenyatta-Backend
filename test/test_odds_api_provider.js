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
//
// NOTA (01-10-2026): este archivo tuvo pruebas de "1er Tiempo"/"2da
// Mitad" (h2h_h1/h2h_h2 y sus RL/Alta-Baja) en una ronda anterior. Se
// quitaron porque, ya en producción, The Odds API confirmó con un error
// real que esos mercados NO EXISTEN en este endpoint (HTTP 422 —
// "Markets not supported by this endpoint") — ver el comentario grande
// al inicio de oddsApiProvider.js. Solo queda el "núcleo"
// (Ganador/RL/Alta-Baja del partido completo).
// =================================================================
const assert = require('assert');
const { obtenerLogrosDeDeporte, obtenerTodosLosLogros, mercadosParaDeporte } = require('../src/services/oddsApiProvider');

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

// Evento NFL con los 3 mercados del núcleo (partido completo) — RL
// (spreads) y Alta/Baja (totals) además del Ganador (01-10-2026, a
// pedido del usuario: "en los logros coloca el rl la alta y la baja").
function eventoNFLNucleo() {
  return {
    id: 'evt-nfl-1',
    sport_key: 'americanfootball_nfl',
    sport_title: 'NFL',
    commence_time: '2026-10-05T20:00:00Z',
    home_team: 'San Francisco 49ers',
    away_team: 'Seattle Seahawks',
    bookmakers: [
      {
        key: 'fanduel',
        markets: [
          { key: 'h2h', outcomes: [{ name: 'San Francisco 49ers', price: -200 }, { name: 'Seattle Seahawks', price: 170 }] },
          { key: 'spreads', outcomes: [{ name: 'San Francisco 49ers', price: -110, point: -4.5 }, { name: 'Seattle Seahawks', price: -110, point: 4.5 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: -105, point: 47.5 }, { name: 'Under', price: -115, point: 47.5 }] }
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
  check(llamada === 3, 'obtenerTodosLosLogros: hace 1 pedido por cada "sport key" de la lista (solo el núcleo, sin mitades)');
  check(r6.filas.length === 4, 'obtenerTodosLosLogros: junta las filas de los deportes que SÍ respondieron bien (2 deportes x 2 filas)');
  check(r6.errores.length === 1 && r6.errores[0].includes('429'), 'obtenerTodosLosLogros: el deporte que falló (créditos agotados) queda en "errores", sin frenar a los demás');

  // --- 7) mercadosParaDeporte: siempre el núcleo (h2h/spreads/totals), para cualquier deporte ---
  check(JSON.stringify(mercadosParaDeporte('baseball_mlb')) === JSON.stringify(['h2h', 'spreads', 'totals']), 'mercadosParaDeporte: MLB pide el núcleo (h2h/spreads/totals)');
  check(JSON.stringify(mercadosParaDeporte('americanfootball_nfl')) === JSON.stringify(['h2h', 'spreads', 'totals']), 'mercadosParaDeporte: NFL pide el mismo núcleo (sin "_h1"/"_h2" — ver nota grande en oddsApiProvider.js)');
  check(JSON.stringify(mercadosParaDeporte('soccer_epl')) === JSON.stringify(['h2h', 'spreads', 'totals']), 'mercadosParaDeporte: fútbol pide el mismo núcleo');

  // --- 8) RL/Alta-Baja (NFL, los 3 mercados del núcleo) ---
  global.fetch = async () => ({ ok: true, json: async () => [eventoNFLNucleo()] });
  const r8 = await obtenerLogrosDeDeporte('americanfootball_nfl', 'clave-de-prueba');
  check(!r8.huboError, 'NFL (núcleo): la consulta se procesa sin error');
  check(r8.filas.length === 6, 'NFL (núcleo): 3 mercados x 2 outcomes cada uno -> 6 filas');

  const rlLocal = r8.filas.find(f => f.mercado === 'spreads' && f.seleccion === 'local');
  check(rlLocal && rlLocal.nombreSeleccion === 'San Francisco 49ers' && rlLocal.punto === -4.5 && rlLocal.logro === -110, 'RL (spreads): el favorito conserva seleccion:"local" y trae su punto (-4.5)');
  const rlVisitante = r8.filas.find(f => f.mercado === 'spreads' && f.seleccion === 'visitante');
  check(rlVisitante && rlVisitante.punto === 4.5, 'RL (spreads): el contendor recibe el punto contrario (+4.5)');

  const alta = r8.filas.find(f => f.mercado === 'totals' && f.seleccion === 'alta');
  const baja = r8.filas.find(f => f.mercado === 'totals' && f.seleccion === 'baja');
  check(alta && alta.nombreSeleccion === 'Alta' && alta.punto === 47.5 && alta.logro === -105, 'Alta/Baja (totals): "Over" se mapea a seleccion:"alta", con su punto y logro');
  check(baja && baja.nombreSeleccion === 'Baja' && baja.punto === 47.5, 'Alta/Baja (totals): "Under" se mapea a seleccion:"baja", mismo punto que "Alta"');

  check(r8.filas.every(f => f.sportKeyOriginal === 'americanfootball_nfl'), 'Todas las filas de un mismo evento conservan sportKeyOriginal (lo usará logosEquiposParley.js)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
