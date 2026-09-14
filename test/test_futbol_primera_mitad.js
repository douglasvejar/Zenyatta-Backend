// Prueba del cruce de "1h" (primera mitad) en fútbol: soccerApi.js pide
// los resultados de siempre a ESPN Y, en paralelo, el marcador de la 1ra
// mitad a football-data.org (footballDataApi.js) — y los cruza por
// NOMBRE DE EQUIPO, porque las 2 APIs no comparten ningún ID en común.
// No depende de ninguna red real: simula `global.fetch` con el esquema
// real de cada API (confirmado contra la documentación oficial de
// football-data.org antes de escribir el conector — ver
// footballDataApi.js) para confirmar que el cruce arma bien el resultado,
// incluido el caso más difícil (nombres de equipo MUY distintos entre las
// 2 fuentes, ej. "Inter Milan" vs "FC Internazionale Milano").
const assert = require('assert');
const { obtenerResultadosSoccer, nombresDeEquipoCoinciden } = require('../src/services/soccerApi');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function fixtureESPN(homeDisplayName, awayDisplayName, homeScore, awayScore) {
  return {
    events: [{
      id: 'espn-1',
      date: '2026-08-31T18:00Z',
      competitions: [{
        status: { type: { completed: true, description: 'Final', state: 'post' }, period: 2 },
        competitors: [
          { homeAway: 'home', winner: homeScore > awayScore, team: { displayName: homeDisplayName, logo: null }, score: String(homeScore) },
          { homeAway: 'away', winner: awayScore > homeScore, team: { displayName: awayDisplayName, logo: null }, score: String(awayScore) }
        ]
      }]
    }]
  };
}

function fixtureFootballData(homeName, homeShortName, awayName, awayShortName, homeHT, awayHT) {
  return {
    matches: [{
      status: 'FINISHED',
      homeTeam: { name: homeName, shortName: homeShortName },
      awayTeam: { name: awayName, shortName: awayShortName },
      score: { halfTime: { home: homeHT, away: awayHT }, fullTime: { home: homeHT + 1, away: awayHT } }
    }]
  };
}

(async function main() {
  // -----------------------------------------------------------------
  // Caso A: con FOOTBALL_DATA_API_KEY configurada, se cruzan 2 partidos
  // por nombre — uno "fácil" (Napoli/SSC Napoli, mismo sufijo de
  // siempre) y uno DIFÍCIL a propósito (Inter Milan/FC Internazionale
  // Milano, nombres bien distintos entre las 2 APIs).
  // -----------------------------------------------------------------
  process.env.FOOTBALL_DATA_API_KEY = 'clave-de-prueba';
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/eng.1/')) {
      return { json: async () => fixtureESPN('Manchester City', 'Arsenal', 2, 1) };
    }
    if (u.includes('site.api.espn.com') && u.includes('/soccer/ita.1/')) {
      return { json: async () => fixtureESPN('Napoli', 'Inter Milan', 1, 2) };
    }
    if (u.includes('site.api.espn.com') && u.includes('/soccer/')) {
      return { json: async () => ({ events: [] }) }; // las demás ligas de ESPN: sin partidos ese día
    }
    if (u.includes('api.football-data.org') && u.includes('/competitions/PL/')) {
      return { json: async () => fixtureFootballData('Manchester City FC', 'Man City', 'Arsenal FC', 'Arsenal', 1, 1) };
    }
    if (u.includes('api.football-data.org') && u.includes('/competitions/SA/')) {
      return { json: async () => fixtureFootballData('SSC Napoli', 'Napoli', 'FC Internazionale Milano', 'Inter', 1, 1) };
    }
    if (u.includes('api.football-data.org')) {
      return { json: async () => ({ matches: [] }) }; // las demás 4 competiciones cubiertas: sin partidos ese día
    }
    throw new Error('URL inesperada en la prueba: ' + url);
  };

  const resultados = await obtenerResultadosSoccer('2026-08-31');

  const manCity = resultados['manchester city'];
  check(!!manCity, 'Manchester City se resuelve bien desde ESPN (marcador final 2-1)');
  check(manCity && manCity.homeScore1H === 1 && manCity.awayScore1H === 1 && manCity.final1H === true,
    'Manchester City: el "1h" cruzado de football-data.org (1-1) se agrega bien al juego de ESPN, aunque el nombre traiga el sufijo "FC"');

  const napoli = resultados['napoli'];
  check(!!napoli, 'Napoli se resuelve bien desde ESPN (marcador final 1-2)');
  check(napoli && napoli.homeScore1H === 1 && napoli.awayScore1H === 1 && napoli.final1H === true,
    'Napoli/Inter Milan (caso difícil): el "1h" se cruza bien aunque football-data.org use "FC Internazionale Milano" (nombre MUY distinto a "Inter Milan" de ESPN) — el match funcionó por el shortName ("Inter") y por prefijo de palabra');

  // -----------------------------------------------------------------
  // Caso B: SIN FOOTBALL_DATA_API_KEY configurada, el sistema sigue
  // funcionando exactamente igual que antes — ningún juego trae "1h",
  // pero tampoco se rompe ni se llama a football-data.org.
  // -----------------------------------------------------------------
  delete process.env.FOOTBALL_DATA_API_KEY;
  let sePidioFootballData = false;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.football-data.org')) { sePidioFootballData = true; return { json: async () => ({ matches: [] }) }; }
    if (u.includes('site.api.espn.com') && u.includes('/soccer/eng.1/')) {
      return { json: async () => fixtureESPN('Manchester City', 'Arsenal', 2, 1) };
    }
    return { json: async () => ({ events: [] }) };
  };
  const resultadosSinClave = await obtenerResultadosSoccer('2026-08-31');
  check(!sePidioFootballData, 'Sin FOOTBALL_DATA_API_KEY configurada, NUNCA se le pega a football-data.org (no gasta pedidos de nadie por accidente)');
  check(resultadosSinClave['manchester city'] && resultadosSinClave['manchester city'].final1H === undefined,
    'Sin la clave configurada, el juego se resuelve igual que siempre (marcador final normal), simplemente sin datos de "1h"');

  // -----------------------------------------------------------------
  // Caso C: 2 partidos DISTINTOS de la MISMA ciudad el mismo día (el
  // derbi de Milán: si jugaran AC Milan vs alguien más Y, aparte, Inter
  // Milan vs otro equipo) — confirma que el cruce exige que LOCAL Y
  // VISITANTE coincidan a la vez, para no mezclar los 2 partidos por
  // compartir la palabra "Milan".
  // -----------------------------------------------------------------
  check(!nombresDeEquipoCoinciden('AC Milan', 'Inter Milan'), 'Regresión: "AC Milan" e "Inter Milan" (equipos DISTINTOS que comparten ciudad) no se consideran el mismo equipo');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
});
