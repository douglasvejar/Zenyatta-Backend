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

// Evento NFL con los 9 mercados que ya se piden para "americanfootball"
// (partido completo + 1er tiempo + 2da mitad) — RL (spreads), Alta/Baja
// (totals) y sus equivalentes "_h1"/"_h2", para probar que
// oddsApiProvider.js arma bien cada mercado por separado (01-10-2026, a
// pedido del usuario: "en los logros coloca el rl la alta y la baja, si
// tienes logros a medio juego o 5to o 1h agregalos tambien" -> más tarde,
// con una captura real de referencia: "coloca una seccion donde pueda
// escoger juego completo/primera mitad/segunda mitad...").
function eventoNFL9Mercados() {
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
          { key: 'totals', outcomes: [{ name: 'Over', price: -105, point: 47.5 }, { name: 'Under', price: -115, point: 47.5 }] },
          { key: 'h2h_h1', outcomes: [{ name: 'San Francisco 49ers', price: -160 }, { name: 'Seattle Seahawks', price: 140 }] },
          { key: 'spreads_h1', outcomes: [{ name: 'San Francisco 49ers', price: -110, point: -2.5 }, { name: 'Seattle Seahawks', price: -110, point: 2.5 }] },
          { key: 'totals_h1', outcomes: [{ name: 'Over', price: -110, point: 23.5 }, { name: 'Under', price: -110, point: 23.5 }] },
          { key: 'h2h_h2', outcomes: [{ name: 'San Francisco 49ers', price: -140 }, { name: 'Seattle Seahawks', price: 120 }] },
          { key: 'spreads_h2', outcomes: [{ name: 'San Francisco 49ers', price: -110, point: -1.5 }, { name: 'Seattle Seahawks', price: -110, point: 1.5 }] },
          { key: 'totals_h2', outcomes: [{ name: 'Over', price: -110, point: 24.5 }, { name: 'Under', price: -110, point: 24.5 }] }
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
  // Desde el 01-10-2026 el núcleo (h2h/spreads/totals), el 1er tiempo
  // (h2h_h1/spreads_h1/totals_h1) y la 2da mitad (h2h_h2/spreads_h2/
  // totals_h2) se piden en 3 llamadas separadas para los deportes que
  // juegan por mitades (ver "GRUPOS_CON_PRIMERA_MITAD"): MLB no juega por
  // mitades -> 1 llamada; NBA falla en el núcleo -> 1 sola llamada (no se
  // intentan 1er tiempo ni 2da mitad si el núcleo ya falló); NFL sí juega
  // por mitades y el núcleo respondió bien -> 3 llamadas (núcleo + 1er
  // tiempo + 2da mitad). Total: 1 + 1 + 3 = 5.
  check(llamada === 5, 'obtenerTodosLosLogros: MLB=1 + NBA=1 (falló en el núcleo) + NFL=3 (núcleo, 1er tiempo y 2da mitad por separado) = 5 llamadas');
  check(r6.filas.length === 4, 'obtenerTodosLosLogros: junta las filas de los deportes que SÍ respondieron bien (2 deportes x 2 filas)');
  check(r6.errores.length === 1 && r6.errores[0].includes('429'), 'obtenerTodosLosLogros: el deporte que falló (créditos agotados) queda en "errores", sin frenar a los demás');

  // --- 7) mercadosParaDeporte: MLB sin mitades (juega por entradas), NFL/NBA/soccer SÍ las incluyen (1er tiempo + 2da mitad) ---
  check(JSON.stringify(mercadosParaDeporte('baseball_mlb')) === JSON.stringify(['h2h', 'spreads', 'totals']), 'mercadosParaDeporte: MLB pide solo partido completo (h2h/spreads/totals), sin mitades');
  check(mercadosParaDeporte('americanfootball_nfl').includes('h2h_h1'), 'mercadosParaDeporte: NFL SÍ incluye "h2h_h1" (1er tiempo)');
  check(mercadosParaDeporte('americanfootball_nfl').includes('h2h_h2'), 'mercadosParaDeporte: NFL SÍ incluye "h2h_h2" (2da mitad)');
  check(mercadosParaDeporte('basketball_nba').length === 9, 'mercadosParaDeporte: NBA pide los 9 mercados (partido completo + 1er tiempo + 2da mitad)');
  check(mercadosParaDeporte('soccer_epl').includes('totals_h1') && mercadosParaDeporte('soccer_epl').includes('totals_h2'), 'mercadosParaDeporte: fútbol SÍ incluye "totals_h1" y "totals_h2" (1er tiempo y 2da mitad)');
  check(JSON.stringify(mercadosParaDeporte('icehockey_nhl')) === JSON.stringify(['h2h', 'spreads', 'totals']), 'mercadosParaDeporte: hockey (por períodos, no por mitades) sin mitades');

  // --- 8) RL/Alta-Baja/1er Tiempo/2da Mitad (NFL, los 9 mercados a la vez) ---
  global.fetch = async () => ({ ok: true, json: async () => [eventoNFL9Mercados()] });
  const r8 = await obtenerLogrosDeDeporte('americanfootball_nfl', 'clave-de-prueba');
  check(!r8.huboError, 'NFL (9 mercados): la consulta se procesa sin error');
  check(r8.filas.length === 18, 'NFL (9 mercados): 9 mercados x 2 outcomes cada uno -> 18 filas');

  const rlLocal = r8.filas.find(f => f.mercado === 'spreads' && f.seleccion === 'local');
  check(rlLocal && rlLocal.nombreSeleccion === 'San Francisco 49ers' && rlLocal.punto === -4.5 && rlLocal.logro === -110, 'RL (spreads): el favorito conserva seleccion:"local" y trae su punto (-4.5)');
  const rlVisitante = r8.filas.find(f => f.mercado === 'spreads' && f.seleccion === 'visitante');
  check(rlVisitante && rlVisitante.punto === 4.5, 'RL (spreads): el contendor recibe el punto contrario (+4.5)');

  const alta = r8.filas.find(f => f.mercado === 'totals' && f.seleccion === 'alta');
  const baja = r8.filas.find(f => f.mercado === 'totals' && f.seleccion === 'baja');
  check(alta && alta.nombreSeleccion === 'Alta' && alta.punto === 47.5 && alta.logro === -105, 'Alta/Baja (totals): "Over" se mapea a seleccion:"alta", con su punto y logro');
  check(baja && baja.nombreSeleccion === 'Baja' && baja.punto === 47.5, 'Alta/Baja (totals): "Under" se mapea a seleccion:"baja", mismo punto que "Alta"');

  const ganador1H = r8.filas.find(f => f.mercado === 'h2h_h1' && f.seleccion === 'local');
  check(ganador1H && ganador1H.punto === null && ganador1H.logro === -160, '1er Tiempo (h2h_h1): mismo criterio que el partido completo, sin punto (el ganador no tiene línea)');
  const rl1H = r8.filas.find(f => f.mercado === 'spreads_h1' && f.seleccion === 'visitante');
  check(rl1H && rl1H.punto === 2.5, 'RL de 1er Tiempo (spreads_h1): trae su propio punto, distinto al del partido completo');
  const altaBaja1H = r8.filas.filter(f => f.mercado === 'totals_h1');
  check(altaBaja1H.length === 2 && altaBaja1H.every(f => f.punto === 23.5), 'Alta/Baja de 1er Tiempo (totals_h1): sus 2 filas (alta/baja) con su propio punto');

  const ganador2H = r8.filas.find(f => f.mercado === 'h2h_h2' && f.seleccion === 'local');
  check(ganador2H && ganador2H.punto === null && ganador2H.logro === -140, '2da Mitad (h2h_h2): mismo criterio que el partido completo, sin punto');
  const rl2H = r8.filas.find(f => f.mercado === 'spreads_h2' && f.seleccion === 'visitante');
  check(rl2H && rl2H.punto === 1.5, 'RL de 2da Mitad (spreads_h2): trae su propio punto, distinto al del partido completo y al de 1er Tiempo');
  const altaBaja2H = r8.filas.filter(f => f.mercado === 'totals_h2');
  check(altaBaja2H.length === 2 && altaBaja2H.every(f => f.punto === 24.5), 'Alta/Baja de 2da Mitad (totals_h2): sus 2 filas (alta/baja) con su propio punto');

  check(r8.filas.every(f => f.sportKeyOriginal === 'americanfootball_nfl'), 'Todas las filas de un mismo evento conservan sportKeyOriginal (lo usará logosEquiposParley.js)');

  // --- 9) Resiliencia: si falla el pedido de "1er Tiempo" pero el núcleo
  // (h2h/spreads/totals) y la 2da mitad sí respondieron bien, el deporte
  // NO debe quedar marcado como error y las filas que sí llegaron deben
  // conservarse igual. Esto es justo el motivo por el que, desde el
  // 01-10-2026, el núcleo, el 1er tiempo y la 2da mitad se piden en 3
  // llamadas separadas: así, si The Odds API llegara a rechazar algún
  // mercado de "mitad" (todavía no está 100% confirmado que funcionen en
  // el endpoint "bulk" barato — ver el comentario al inicio de este
  // archivo), el Ganador/RL/Alta-Baja del partido completo (y cualquier
  // otra mitad que sí haya funcionado) sigue funcionando normal.
  global.fetch = async (url) => {
    if (url.includes('h2h_h1')) {
      return { ok: false, status: 422, json: async () => ({ message: 'Unknown markets: h2h_h1' }) };
    }
    return { ok: true, json: async () => [eventoNFL9Mercados()] };
  };
  const r9 = await obtenerLogrosDeDeporte('americanfootball_nfl', 'clave-de-prueba');
  check(!r9.huboError, 'Resiliencia: si falla SOLO el pedido de 1er Tiempo, el deporte no queda marcado como error (huboError:false)');
  check(r9.filas.length === 12, 'Resiliencia: las 6 filas del núcleo + las 6 de 2da Mitad se conservan (12 en total) aunque el 1er Tiempo haya fallado');
  check(r9.filas.every(f => f.mercado !== 'h2h_h1' && f.mercado !== 'spreads_h1' && f.mercado !== 'totals_h1'), 'Resiliencia: ninguna fila es de "_h1" (ese pedido falló y no aportó filas)');
  check(r9.filas.some(f => f.mercado === 'h2h_h2'), 'Resiliencia: la 2da Mitad sí se conserva, porque su propia llamada no falló');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
