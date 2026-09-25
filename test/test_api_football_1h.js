// Prueba del cruce de "1h" (primera mitad) para las 4 competencias de
// SELECCIONES (UEFA Nations League, Copa América, Amistoso Internacional,
// Eliminatorias Conmebol) contra api-football.com — agregado 25-09-2026,
// a pedido del usuario ("no quedamos en agregar los 1h para las nueva
// competencias como nations leguae amistosos entre otros"). football-data.org
// (test_futbol_primera_mitad.js) solo cubre 6 ligas de CLUBES; estas 4
// competencias de selecciones van por una fuente aparte
// (apiFootballApi.js) porque el plan gratis de football-data.org no las
// tiene.
//
// El JSON simulado abajo (fixture/league/teams/goals/score.halftime) es
// la forma REAL confirmada con un pedido real que hizo el usuario desde
// dashboard.api-football.com/soccer/tester el 25-09-2026 — no se adivinó
// ningún campo (ver claude/actualizaciones-24-09-2026.md, ronda 33).
//
// Mismo patrón de pruebas que test_futbol_primera_mitad.js: no depende de
// ninguna red real, simula `global.fetch`.
const assert = require('assert');
const { obtenerResultadosSoccer, nombresDeEquipoCoinciden } = require('../src/services/soccerApi');
const { _resetCacheParaPruebas: resetFootballData } = require('../src/services/footballDataApi');
const { _resetCacheParaPruebas: resetApiFootball } = require('../src/services/apiFootballApi');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function fixtureESPN(homeDisplayName, awayDisplayName, homeScore, awayScore) {
  return {
    events: [{
      id: 'espn-1',
      date: '2026-09-25T18:00Z',
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

// Un partido dentro de la respuesta de `/fixtures` de api-football.com —
// misma forma real confirmada (fixture/league/teams/goals/score), con
// solo los campos que el conector realmente lee.
function partidoApiFootball(idLiga, homeName, awayName, homeHT, awayHT) {
  return {
    fixture: { id: 999, status: { long: 'Match Finished', short: 'FT' } },
    league: { id: idLiga },
    teams: {
      home: { name: homeName, winner: homeHT === null ? null : homeHT > awayHT },
      away: { name: awayName, winner: homeHT === null ? null : awayHT > homeHT }
    },
    goals: { home: homeHT === null ? null : homeHT + 1, away: awayHT === null ? null : awayHT + 1 },
    score: {
      halftime: { home: homeHT, away: awayHT },
      fulltime: { home: homeHT === null ? null : homeHT + 1, away: awayHT === null ? null : awayHT + 1 }
    }
  };
}

function limpiarClaves() {
  delete process.env.FOOTBALL_DATA_API_KEY;
  delete process.env.API_FOOTBALL_KEY;
}

(async function main() {
  // -----------------------------------------------------------------
  // Caso A: con API_FOOTBALL_KEY configurada, se cruza un partido real de
  // UEFA Nations League por nombre de selección (ESPN usa "Netherlands",
  // api-football también usa "Netherlands" — mismo nombre en inglés).
  // -----------------------------------------------------------------
  resetFootballData(); resetApiFootball(); limpiarClaves();
  process.env.API_FOOTBALL_KEY = 'clave-de-prueba';
  let pedidosAApiFootball = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/uefa.nations/')) {
      return { ok: true, json: async () => fixtureESPN('Norway', 'Netherlands', 1, 2) };
    }
    if (u.includes('site.api.espn.com')) {
      return { ok: true, json: async () => ({ events: [] }) };
    }
    if (u.includes('v3.football.api-sports.io') && u.includes('/fixtures')) {
      pedidosAApiFootball++;
      return {
        ok: true,
        json: async () => ({
          errors: [],
          response: [
            partidoApiFootball(5, 'Norway', 'Netherlands', 0, 1), // UEFA Nations League (id 5)
            partidoApiFootball(536, 'Dominican Republic', 'Nicaragua', 2, 1) // CONCACAF Nations League: competencia real que NO nos interesa, confirma que el filtro por id no rompe nada
          ]
        })
      };
    }
    throw new Error('URL inesperada en la prueba: ' + url);
  };

  const resA = await obtenerResultadosSoccer('2026-09-25');
  const noruega = resA['norway'];
  check(!!noruega, 'Norway se resuelve bien desde ESPN (marcador final 1-2, caso real reportado por el usuario)');
  check(noruega && noruega.homeScore1H === 0 && noruega.awayScore1H === 1 && noruega.final1H === true,
    'Norway/Netherlands: el "1h" cruzado de api-football.com (0-1) se agrega bien al juego de ESPN (UEFA Nations League)');
  check(pedidosAApiFootball === 1, 'Un solo pedido a api-football.com (/fixtures) resuelve las 4 competencias cubiertas a la vez');

  // -----------------------------------------------------------------
  // Caso B: SIN API_FOOTBALL_KEY configurada, el sistema sigue
  // funcionando igual que siempre — ningún juego de estas 4 competencias
  // trae "1h", pero tampoco se rompe ni se llama a api-football.com.
  // -----------------------------------------------------------------
  resetFootballData(); resetApiFootball(); limpiarClaves();
  let sePidioApiFootball = false;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('v3.football.api-sports.io')) { sePidioApiFootball = true; return { ok: true, json: async () => ({ errors: [], response: [] }) }; }
    if (u.includes('site.api.espn.com') && u.includes('/soccer/conmebol.america/')) {
      return { ok: true, json: async () => fixtureESPN('Argentina', 'Brazil', 2, 1) };
    }
    return { ok: true, json: async () => ({ events: [] }) };
  };
  const resB = await obtenerResultadosSoccer('2026-09-25');
  check(!sePidioApiFootball, 'Sin API_FOOTBALL_KEY configurada, NUNCA se le pega a api-football.com');
  check(resB['argentina'] && resB['argentina'].final1H === undefined && resB['argentina'].motivoSinPrimeraMitad === 'sin-clave',
    'Copa América (cubierta por api-football.com) sin la clave puesta: se marca "sin-clave" y el juego sigue resolviéndose normal, solo sin "1h"');

  // -----------------------------------------------------------------
  // Caso C: liga cubierta (Eliminatorias Conmebol), clave puesta, pero
  // api-football.com devuelve un error DENTRO del cuerpo (200 OK, con
  // `errors: {...}` no vacío) — caso real confirmado con el usuario
  // ("Free plans do not have access to..."). Debe marcarse 'error-api'.
  // -----------------------------------------------------------------
  resetFootballData(); resetApiFootball(); limpiarClaves();
  process.env.API_FOOTBALL_KEY = 'clave-de-prueba';
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/fifa.worldq.conmebol/')) {
      return { ok: true, json: async () => fixtureESPN('Venezuela', 'Colombia', 0, 0) };
    }
    if (u.includes('site.api.espn.com')) {
      return { ok: true, json: async () => ({ events: [] }) };
    }
    if (u.includes('v3.football.api-sports.io')) {
      return { ok: true, json: async () => ({ errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' }, results: 0, response: [] }) };
    }
    throw new Error('URL inesperada en la prueba: ' + url);
  };
  const resC = await obtenerResultadosSoccer('2026-09-25');
  check(resC['venezuela'] && resC['venezuela'].motivoSinPrimeraMitad === 'error-api',
    'api-football.com responde 200 con un error DENTRO del cuerpo (plan restringido): se marca "error-api", no "sin-cruce" — el error se detecta aunque el HTTP status sea 200');

  // -----------------------------------------------------------------
  // Caso D: liga cubierta, clave OK, respuesta 200 limpia, pero ESTE
  // partido puntual no aparece en la lista de api-football.com para esa
  // fecha — debe marcarse 'sin-cruce'.
  // -----------------------------------------------------------------
  resetFootballData(); resetApiFootball(); limpiarClaves();
  process.env.API_FOOTBALL_KEY = 'clave-de-prueba';
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/fifa.friendly/')) {
      return { ok: true, json: async () => fixtureESPN('Spain', 'France', 1, 1) };
    }
    if (u.includes('site.api.espn.com')) {
      return { ok: true, json: async () => ({ events: [] }) };
    }
    return { ok: true, json: async () => ({ errors: [], response: [] }) }; // api-football.com responde bien, pero sin este partido
  };
  const resD = await obtenerResultadosSoccer('2026-09-25');
  check(resD['spain'] && resD['spain'].motivoSinPrimeraMitad === 'sin-cruce',
    'Amistoso Internacional cubierto + clave OK + respuesta limpia pero sin este partido puntual: se marca "sin-cruce"');

  // -----------------------------------------------------------------
  // Caso E: regresión — una liga que NINGUNA de las 2 fuentes cubre
  // (Europa League, de clubes, no está en football-data.org NI es una
  // selección de api-football.com) sigue siendo 'liga-no-cubierta', aun
  // con AMBAS claves configuradas.
  // -----------------------------------------------------------------
  resetFootballData(); resetApiFootball();
  process.env.FOOTBALL_DATA_API_KEY = 'clave-de-prueba';
  process.env.API_FOOTBALL_KEY = 'clave-de-prueba';
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/uefa.europa/')) {
      return { ok: true, json: async () => fixtureESPN('Bologna', 'Aston Villa', 1, 0) };
    }
    if (u.includes('site.api.espn.com')) return { ok: true, json: async () => ({ events: [] }) };
    if (u.includes('api.football-data.org')) return { ok: true, json: async () => ({ matches: [] }) };
    if (u.includes('v3.football.api-sports.io')) return { ok: true, json: async () => ({ errors: [], response: [] }) };
    throw new Error('URL inesperada en la prueba: ' + url);
  };
  const resE = await obtenerResultadosSoccer('2026-09-25');
  check(resE['bologna'] && resE['bologna'].motivoSinPrimeraMitad === 'liga-no-cubierta',
    'Regresión: Europa League (ninguna de las 2 fuentes de "1h" la cubre) sigue marcándose "liga-no-cubierta", aun con las 2 claves configuradas');

  // -----------------------------------------------------------------
  // Caso F: las 2 fuentes a la vez, en la MISMA llamada — un partido de
  // club (football-data.org) y un partido de selección (api-football.com)
  // se resuelven bien SIMULTÁNEAMENTE. Confirma que generalizar
  // agregarPrimeraMitad() a una lista de fuentes no rompió el caso de
  // football-data.org que ya funcionaba.
  // -----------------------------------------------------------------
  resetFootballData(); resetApiFootball();
  process.env.FOOTBALL_DATA_API_KEY = 'clave-de-prueba';
  process.env.API_FOOTBALL_KEY = 'clave-de-prueba';
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/eng.1/')) {
      return { ok: true, json: async () => fixtureESPN('Manchester City', 'Arsenal', 2, 1) };
    }
    if (u.includes('site.api.espn.com') && u.includes('/soccer/uefa.nations/')) {
      return { ok: true, json: async () => fixtureESPN('Norway', 'Netherlands', 1, 2) };
    }
    if (u.includes('site.api.espn.com')) return { ok: true, json: async () => ({ events: [] }) };
    if (u.includes('api.football-data.org') && u.includes('/v4/matches')) {
      return { ok: true, json: async () => ({ matches: [{ competition: { code: 'PL' }, homeTeam: { name: 'Manchester City FC', shortName: 'Man City' }, awayTeam: { name: 'Arsenal FC', shortName: 'Arsenal' }, score: { halfTime: { home: 1, away: 1 }, fullTime: { home: 2, away: 1 } } }] }) };
    }
    if (u.includes('v3.football.api-sports.io')) {
      return { ok: true, json: async () => ({ errors: [], response: [partidoApiFootball(5, 'Norway', 'Netherlands', 0, 1)] }) };
    }
    throw new Error('URL inesperada en la prueba: ' + url);
  };
  const resF = await obtenerResultadosSoccer('2026-09-25');
  check(resF['manchester city'] && resF['manchester city'].final1H === true && resF['manchester city'].homeScore1H === 1,
    'Caso F — football-data.org (Premier League) sigue resolviendo bien su "1h" con las 2 fuentes activas a la vez');
  check(resF['norway'] && resF['norway'].final1H === true && resF['norway'].awayScore1H === 1,
    'Caso F — api-football.com (UEFA Nations League) resuelve bien su "1h" en la MISMA llamada, sin interferir con football-data.org');

  // -----------------------------------------------------------------
  // Casos G-I: el caché en memoria por fecha de apiFootballApi.js — mismo
  // mecanismo que football-data.org, probado igual (ver Casos H/I/J de
  // test_futbol_primera_mitad.js).
  // -----------------------------------------------------------------
  resetFootballData(); resetApiFootball(); limpiarClaves();
  process.env.API_FOOTBALL_KEY = 'clave-de-prueba';
  let pedidosCasoG = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/uefa.nations/')) {
      return { ok: true, json: async () => fixtureESPN('Norway', 'Netherlands', 1, 2) };
    }
    if (u.includes('site.api.espn.com')) return { ok: true, json: async () => ({ events: [] }) };
    if (u.includes('v3.football.api-sports.io')) {
      pedidosCasoG++;
      return { ok: true, json: async () => ({ errors: [], response: [partidoApiFootball(5, 'Norway', 'Netherlands', 0, 1)] }) };
    }
    throw new Error('URL inesperada en la prueba: ' + url);
  };

  // Caso G: 2 llamadas seguidas para la misma fecha, dentro del TTL — la
  // 2da no debe volver a pedirle nada a api-football.com.
  await obtenerResultadosSoccer('2026-09-25');
  await obtenerResultadosSoccer('2026-09-25');
  check(pedidosCasoG === 1, 'Caso G — 2 llamadas seguidas para la misma fecha, dentro del TTL del caché: solo 1 pedido real a api-football.com');

  // Caso H: llamadas simultáneas para la misma fecha comparten el mismo
  // pedido en vuelo.
  resetApiFootball();
  pedidosCasoG = 0;
  const [resH1, resH2] = await Promise.all([
    obtenerResultadosSoccer('2026-09-25'),
    obtenerResultadosSoccer('2026-09-25')
  ]);
  check(pedidosCasoG === 1, 'Caso H — 2 llamadas simultáneas para la misma fecha: comparten el mismo pedido en vuelo, 1 solo pedido real');
  check(resH1['norway'].final1H === true && resH2['norway'].final1H === true, 'Caso H — ambas llamadas simultáneas devuelven igual el dato de "1h" ya resuelto');

  // Caso I: tras _resetCacheParaPruebas() (TTL vencido), sí se vuelve a
  // pedir.
  resetApiFootball();
  pedidosCasoG = 0;
  await obtenerResultadosSoccer('2026-09-25');
  check(pedidosCasoG === 1, 'Caso I — tras vencer el caché, se vuelve a pedir a api-football.com en vez de quedarse con un dato viejo para siempre');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
});
