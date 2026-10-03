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
//
// ACTUALIZADO 23-09-2026 ("aun hay problemas para leer los partidos 1h de
// futbol en cualquier liga" — ver el comentario grande en
// footballDataApi.js con la causa real: exceso de pedidos por minuto al
// plan gratis de football-data.org, agravado por el auto-refresco de
// /pizarra cada 20s). Dos cambios en este archivo:
//   1. football-data.org ahora se pide con UN SOLO endpoint
//      (`/v4/matches?dateFrom=X&dateTo=X`, filtrado client-side por
//      competencia) en vez de 6 pedidos por separado — los fixtures y las
//      URLs esperadas en los mocks de abajo se actualizaron para reflejar
//      eso.
//   2. Se agregaron los casos H/I/J que prueban el CACHÉ por fecha (no
//      pedir de nuevo dentro del TTL, sí pedir de nuevo tras
//      _resetCacheParaPruebas, y que llamadas simultáneas para la misma
//      fecha comparten un solo pedido en vuelo) — es la pieza central del
//      arreglo de esta ronda.
const assert = require('assert');
const { obtenerResultadosSoccer, nombresDeEquipoCoinciden } = require('../src/services/soccerApi');
const { _resetCacheParaPruebas } = require('../src/services/footballDataApi');

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

// Fixture de UN partido dentro de la respuesta de `/v4/matches` (endpoint
// general, trae partidos de VARIAS competencias a la vez — cada uno con
// su propio `competition.code`, que es lo que footballDataApi.js usa para
// quedarse solo con las 6 ligas que cubre este sistema).
function partidoFootballData(codigoCompetencia, homeName, homeShortName, awayName, awayShortName, homeHT, awayHT) {
  return {
    competition: { code: codigoCompetencia },
    status: 'FINISHED',
    homeTeam: { name: homeName, shortName: homeShortName },
    awayTeam: { name: awayName, shortName: awayShortName },
    score: { halfTime: { home: homeHT, away: awayHT }, fullTime: { home: homeHT + 1, away: awayHT } }
  };
}

(async function main() {
  // -----------------------------------------------------------------
  // Caso A: con FOOTBALL_DATA_API_KEY configurada, se cruzan 2 partidos
  // por nombre — uno "fácil" (Napoli/SSC Napoli, mismo sufijo de
  // siempre) y uno DIFÍCIL a propósito (Inter Milan/FC Internazionale
  // Milano, nombres bien distintos entre las 2 APIs). Los 2 partidos
  // vienen en LA MISMA respuesta de `/v4/matches` (competencias PL y SA),
  // confirmando que un solo pedido alcanza para varias ligas a la vez.
  // -----------------------------------------------------------------
  _resetCacheParaPruebas();
  process.env.FOOTBALL_DATA_API_KEY = 'clave-de-prueba';
  let pedidosAFootballData = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/eng.1/')) {
      return { ok: true, json: async () => fixtureESPN('Manchester City', 'Arsenal', 2, 1) };
    }
    if (u.includes('site.api.espn.com') && u.includes('/soccer/ita.1/')) {
      return { ok: true, json: async () => fixtureESPN('Napoli', 'Inter Milan', 1, 2) };
    }
    if (u.includes('site.api.espn.com') && u.includes('/soccer/')) {
      return { ok: true, json: async () => ({ events: [] }) }; // las demás ligas de ESPN: sin partidos ese día
    }
    if (u.includes('api.football-data.org') && u.includes('/v4/matches')) {
      pedidosAFootballData++;
      return {
        ok: true,
        json: async () => ({
          matches: [
            partidoFootballData('PL', 'Manchester City FC', 'Man City', 'Arsenal FC', 'Arsenal', 1, 1),
            partidoFootballData('SA', 'SSC Napoli', 'Napoli', 'FC Internazionale Milano', 'Inter', 1, 1),
            partidoFootballData('BL1', 'Bayer Leverkusen', 'Leverkusen', 'Union Berlin', 'Union', 0, 0) // competencia cubierta pero sin relación con los tickets de esta prueba — confirma que el filtro por código no rompe nada
          ]
        })
      };
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

  check(pedidosAFootballData === 2, '2 pedidos a football-data.org (/v4/matches) — uno para la fecha de la sábana y otro para el día siguiente (03-10-2026, caso Colombia: evita que un partido archivado un día después por la API quede en "sin-cruce"), en vez de 6+6 por separado — sigue siendo 1 pedido por fecha, no 1 por liga');

  // -----------------------------------------------------------------
  // Caso B: SIN FOOTBALL_DATA_API_KEY configurada, el sistema sigue
  // funcionando exactamente igual que antes — ningún juego trae "1h",
  // pero tampoco se rompe ni se llama a football-data.org.
  // -----------------------------------------------------------------
  _resetCacheParaPruebas();
  delete process.env.FOOTBALL_DATA_API_KEY;
  let sePidioFootballData = false;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.football-data.org')) { sePidioFootballData = true; return { ok: true, json: async () => ({ matches: [] }) }; }
    if (u.includes('site.api.espn.com') && u.includes('/soccer/eng.1/')) {
      return { ok: true, json: async () => fixtureESPN('Manchester City', 'Arsenal', 2, 1) };
    }
    return { ok: true, json: async () => ({ events: [] }) };
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

  // -----------------------------------------------------------------
  // Casos D-G (agregados 20-09-2026, a raíz del caso real reportado por
  // el usuario: tickets de "1h" de La Liga/Serie A — ligas SÍ cubiertas
  // — quedaban PENDIENTE con un mensaje que sonaba a "puede que esta
  // liga no esté cubierta"). Confirman que `motivoSinPrimeraMitad`
  // distingue las 4 causas reales en vez de mezclarlas todas.
  // -----------------------------------------------------------------

  // Caso D: liga SÍ cubierta (La Liga) pero SIN la clave configurada —
  // debe marcarse 'sin-clave', no 'liga-no-cubierta'.
  _resetCacheParaPruebas();
  delete process.env.FOOTBALL_DATA_API_KEY;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/esp.1/')) {
      return { ok: true, json: async () => fixtureESPN('Barcelona', 'Real Madrid', 2, 1) };
    }
    return { ok: true, json: async () => ({ events: [] }) };
  };
  const resD = await obtenerResultadosSoccer('2026-08-31');
  check(resD['barcelona'] && resD['barcelona'].motivoSinPrimeraMitad === 'sin-clave',
    'Caso real (La Liga, sin FOOTBALL_DATA_API_KEY en el servidor): se marca "sin-clave", no el genérico de "liga no cubierta" — La Liga SÍ está en la lista');
  check(resD['barcelona'].fuentePrimeraMitad === 'football-data.org' && resD['barcelona'].variableEntornoPrimeraMitad === 'FOOTBALL_DATA_API_KEY',
    '02-10-2026: el juego queda marcado con la fuente real (football-data.org/FOOTBALL_DATA_API_KEY) para que evaluador.js arme el mensaje correcto, en vez de uno fijo');

  // Caso E: liga SÍ cubierta (Serie A), clave configurada, pero
  // football-data.org devuelve un error (401/429/etc.) en el pedido a
  // /v4/matches — debe marcarse 'error-api' para TODAS las ligas de esa
  // respuesta (ya no hay "una competencia falla, las otras 5 no" — ahora
  // es un solo pedido para las 6).
  _resetCacheParaPruebas();
  process.env.FOOTBALL_DATA_API_KEY = 'clave-de-prueba';
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/ita.1/')) {
      return { ok: true, json: async () => fixtureESPN('Roma', 'Lazio', 1, 0) };
    }
    if (u.includes('site.api.espn.com')) {
      return { ok: true, json: async () => ({ events: [] }) };
    }
    if (u.includes('api.football-data.org') && u.includes('/v4/matches')) {
      return { ok: false, status: 429, json: async () => ({}) }; // límite de pedidos superado
    }
    throw new Error('URL inesperada en la prueba: ' + url);
  };
  const resE = await obtenerResultadosSoccer('2026-08-31');
  check(resE['roma'] && resE['roma'].motivoSinPrimeraMitad === 'error-api',
    'Caso real (Serie A, football-data.org responde 429 en /v4/matches): se marca "error-api", no "liga no cubierta" — Serie A SÍ está en la lista y la clave SÍ está puesta');
  check(resE['roma'].fuentePrimeraMitad === 'football-data.org' && resE['roma'].variableEntornoPrimeraMitad === 'FOOTBALL_DATA_API_KEY',
    '02-10-2026: también en "error-api" queda marcada la fuente real (football-data.org/FOOTBALL_DATA_API_KEY)');

  // Caso F: liga SÍ cubierta, clave OK, la consulta responde 200, pero
  // este partido puntual no aparece ese día (o no cruzó por nombre) —
  // debe marcarse 'sin-cruce'.
  _resetCacheParaPruebas();
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/eng.1/')) {
      return { ok: true, json: async () => fixtureESPN('Chelsea', 'Everton', 1, 1) };
    }
    if (u.includes('site.api.espn.com')) {
      return { ok: true, json: async () => ({ events: [] }) };
    }
    return { ok: true, json: async () => ({ matches: [] }) }; // football-data.org responde bien, pero sin este partido
  };
  const resF = await obtenerResultadosSoccer('2026-08-31');
  check(resF['chelsea'] && resF['chelsea'].motivoSinPrimeraMitad === 'sin-cruce',
    'Liga cubierta + clave OK + respuesta 200 pero sin este partido puntual: se marca "sin-cruce" (el caso más específico, para revisar el club puntual)');
  check(resF['chelsea'].fuentePrimeraMitad === 'football-data.org' && resF['chelsea'].variableEntornoPrimeraMitad === 'FOOTBALL_DATA_API_KEY',
    '02-10-2026: también en "sin-cruce" queda marcada la fuente real (football-data.org/FOOTBALL_DATA_API_KEY)');

  // Caso G: liga que GENUINAMENTE no está cubierta (Europa League) —
  // sigue siendo 'liga-no-cubierta', el único caso donde el mensaje
  // original ("puede que esta liga no esté cubierta") sigue siendo
  // preciso.
  check(true, 'Nota: el caso "liga-no-cubierta" ya está cubierto por test_logica.js (testFutbol1hPartidoTerminadoSinDatoDeMitad, liga Europa League)');

  // -----------------------------------------------------------------
  // Casos H-J (23-09-2026, el arreglo central de esta ronda): el CACHÉ
  // por fecha en footballDataApi.js — ver el comentario grande ahí con
  // la causa real reportada por el usuario (límite de 10 pedidos/minuto
  // superado por el auto-refresco de /pizarra cada 20s).
  // -----------------------------------------------------------------
  _resetCacheParaPruebas();
  process.env.FOOTBALL_DATA_API_KEY = 'clave-de-prueba';
  let pedidosCasoH = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/eng.1/')) {
      return { ok: true, json: async () => fixtureESPN('Manchester City', 'Arsenal', 2, 1) };
    }
    if (u.includes('site.api.espn.com')) {
      return { ok: true, json: async () => ({ events: [] }) };
    }
    if (u.includes('api.football-data.org') && u.includes('/v4/matches')) {
      pedidosCasoH++;
      return { ok: true, json: async () => ({ matches: [partidoFootballData('PL', 'Manchester City FC', 'Man City', 'Arsenal FC', 'Arsenal', 1, 1)] }) };
    }
    throw new Error('URL inesperada en la prueba: ' + url);
  };

  // Caso H: 2 llamadas seguidas para la MISMA fecha (simula /pizarra
  // refrescando cada 20s mientras el caché sigue fresco) — la 2da NO debe
  // volver a pedirle nada a football-data.org. (03-10-2026: ahora cada
  // llamada pide 2 fechas — sábana y día siguiente — así que la primera
  // llamada ya dispara 2 pedidos; la 2da llamada, con las 2 fechas todavía
  // dentro del TTL, no debe sumar ninguno más.)
  await obtenerResultadosSoccer('2026-09-23');
  await obtenerResultadosSoccer('2026-09-23');
  check(pedidosCasoH === 2, 'Caso H — 2 llamadas seguidas para la misma fecha, dentro del TTL del caché: solo 2 pedidos reales a football-data.org (fecha sábana + día siguiente), no 4 (esto es lo que evita reventar el límite de 10/minuto cuando /pizarra refresca cada 20s)');

  // Caso I: llamadas SIMULTÁNEAS (sin esperar la primera) para la misma
  // fecha — deben compartir el mismo pedido en vuelo, no disparar 2 en
  // paralelo (simula /pizarra y /procesar pidiendo la fecha de hoy casi
  // al mismo tiempo).
  _resetCacheParaPruebas();
  pedidosCasoH = 0;
  const [resI1, resI2] = await Promise.all([
    obtenerResultadosSoccer('2026-09-23'),
    obtenerResultadosSoccer('2026-09-23')
  ]);
  check(pedidosCasoH === 2, 'Caso I — 2 llamadas simultáneas (sin esperar la primera) para la misma fecha: comparten el mismo pedido en vuelo por cada una de las 2 fechas (sábana + día siguiente), 2 pedidos reales en total, no 4');
  check(resI1['manchester city'].final1H === true && resI2['manchester city'].final1H === true, 'Caso I — ambas llamadas simultáneas devuelven igual el dato de "1h" ya resuelto');

  // Caso J: tras _resetCacheParaPruebas() (equivalente a que el TTL ya
  // expiró), SÍ se vuelve a pedir — el caché no se queda pegado para
  // siempre con un dato viejo.
  _resetCacheParaPruebas();
  pedidosCasoH = 0;
  await obtenerResultadosSoccer('2026-09-23');
  check(pedidosCasoH === 2, 'Caso J — tras vencer el caché (acá simulado con _resetCacheParaPruebas), se vuelve a pedir a football-data.org (las 2 fechas) en vez de quedarse con un dato viejo para siempre');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
});
