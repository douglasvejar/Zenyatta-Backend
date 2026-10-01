// =================================================================
// PRUEBA: logosEquiposParley.js — logos de equipo para la Calculadora
// Parley y la pestaña PARLEYS (01-10-2026).
//
// Mismo patrón que test_odds_api_provider.js: no depende de ninguna red
// real, simula `global.fetch`. Las formas de respuesta usadas acá son
// las YA confirmadas en el resto del proyecto (ver cargarMapaLogosEquipos()
// en public/app.js para statsapi.mlb.com, y nflApi.js/nbaApi.js/
// soccerApi.js para el scoreboard de ESPN).
// =================================================================
const assert = require('assert');
const { obtenerMapaLogosMLB, obtenerLogosDeFecha, construirMapaLogos, fechaCompacta } = require('../src/services/logosEquiposParley');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function filaOdds(overrides) {
  return Object.assign({
    deporte: 'americanfootball',
    sportKeyOriginal: 'americanfootball_nfl',
    liga: 'NFL',
    eventoId: 'evt-1',
    equipoLocal: 'San Francisco 49ers',
    equipoVisitante: 'Seattle Seahawks',
    horaInicio: '2026-10-05T20:00:00Z',
    mercado: 'h2h',
    seleccion: 'local',
    nombreSeleccion: 'San Francisco 49ers',
    punto: null,
    logro: -200
  }, overrides);
}

(async () => {
  // --- 1) fechaCompacta: formato de The Odds API -> formato de ESPN ---
  check(fechaCompacta('2026-10-05T20:00:00Z') === '20261005', 'fechaCompacta: convierte ISO a YYYYMMDD');
  check(fechaCompacta(null) === null, 'fechaCompacta: sin fecha -> null, no revienta');
  check(fechaCompacta('') === null, 'fechaCompacta: fecha vacía -> null');

  // --- 2) obtenerMapaLogosMLB: directorio de statsapi.mlb.com ---
  global.fetch = async (url) => {
    check(url.includes('statsapi.mlb.com/api/v1/teams'), 'obtenerMapaLogosMLB: consulta el endpoint real de statsapi.mlb.com');
    return { ok: true, json: async () => ({ teams: [{ id: 137, name: 'San Francisco Giants' }, { id: 135, name: 'San Diego Padres' }] }) };
  };
  const mapaMLB = await obtenerMapaLogosMLB();
  check(mapaMLB['san francisco giants'] === 'https://www.mlbstatic.com/team-logos/137.svg', 'obtenerMapaLogosMLB: arma la URL con el patrón mlbstatic.com/team-logos/{id}.svg');
  check(mapaMLB['san diego padres'] === 'https://www.mlbstatic.com/team-logos/135.svg', 'obtenerMapaLogosMLB: incluye todos los equipos del directorio');

  // --- 3) obtenerMapaLogosMLB: si el endpoint falla, no revienta, devuelve mapa vacío ---
  global.fetch = async () => ({ ok: false, status: 500 });
  const mapaMLBError = await obtenerMapaLogosMLB();
  check(Object.keys(mapaMLBError).length === 0, 'obtenerMapaLogosMLB: HTTP no-OK -> mapa vacío, no revienta');

  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const mapaMLBErrorRed = await obtenerMapaLogosMLB();
  check(Object.keys(mapaMLBErrorRed).length === 0, 'obtenerMapaLogosMLB: error de red -> mapa vacío, no revienta');

  // --- 4) obtenerLogosDeFecha: scoreboard de ESPN (mismo patrón que nflApi.js) ---
  global.fetch = async (url) => {
    check(url === 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261005', 'obtenerLogosDeFecha: arma la URL exacta de ESPN con la ruta y fecha pedidas');
    return {
      ok: true,
      json: async () => ({
        events: [{
          competitions: [{
            competitors: [
              { homeAway: 'home', team: { displayName: 'San Francisco 49ers', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png' } },
              { homeAway: 'away', team: { displayName: 'Seattle Seahawks', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png' } }
            ]
          }]
        }]
      })
    };
  };
  const mapaESPN = await obtenerLogosDeFecha('football/nfl', '20261005');
  check(mapaESPN['san francisco 49ers'] === 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png', 'obtenerLogosDeFecha: extrae el logo directo de competitors[].team.logo');
  check(mapaESPN['seattle seahawks'] === 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png', 'obtenerLogosDeFecha: incluye local y visitante');

  // --- 5) construirMapaLogos: arma eventoId -> {logoLocal, logoVisitante}, combinando MLB + ESPN, 1 sola consulta por combinación ---
  let llamadasMLB = 0, llamadasESPN = 0;
  global.fetch = async (url) => {
    if (url.includes('statsapi.mlb.com')) {
      llamadasMLB++;
      return { ok: true, json: async () => ({ teams: [{ id: 137, name: 'San Francisco Giants' }, { id: 135, name: 'San Diego Padres' }] }) };
    }
    llamadasESPN++;
    return {
      ok: true,
      json: async () => ({
        events: [{
          competitions: [{
            competitors: [
              { homeAway: 'home', team: { displayName: 'San Francisco 49ers', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png' } },
              { homeAway: 'away', team: { displayName: 'Seattle Seahawks', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png' } }
            ]
          }]
        }]
      })
    };
  };

  const filas = [
    filaOdds({ eventoId: 'evt-nfl-1', mercado: 'h2h' }),
    filaOdds({ eventoId: 'evt-nfl-1', mercado: 'spreads', seleccion: 'visitante', nombreSeleccion: 'Seattle Seahawks', equipoLocal: 'San Francisco 49ers' }), // 2da fila del MISMO partido/fecha -> no debe repetir la consulta a ESPN
    filaOdds({ eventoId: 'evt-mlb-1', deporte: 'baseball', sportKeyOriginal: 'baseball_mlb', equipoLocal: 'San Francisco Giants', equipoVisitante: 'San Diego Padres', horaInicio: '2026-10-01T23:05:00Z' })
  ];
  const mapaLogos = await construirMapaLogos(filas);

  check(llamadasESPN === 1, 'construirMapaLogos: 2 filas del mismo evento/fecha -> 1 sola consulta a ESPN (no 1 por fila)');
  check(llamadasMLB === 1, 'construirMapaLogos: se pide el directorio de MLB una sola vez, sin importar cuántos partidos de MLB haya');
  check(mapaLogos['evt-nfl-1'].logoLocal === 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png', 'construirMapaLogos: NFL -> logoLocal resuelto desde ESPN');
  check(mapaLogos['evt-nfl-1'].logoVisitante === 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png', 'construirMapaLogos: NFL -> logoVisitante resuelto desde ESPN');
  check(mapaLogos['evt-mlb-1'].logoLocal === 'https://www.mlbstatic.com/team-logos/137.svg', 'construirMapaLogos: MLB -> logoLocal resuelto desde statsapi.mlb.com (no desde ESPN)');
  check(mapaLogos['evt-mlb-1'].logoVisitante === 'https://www.mlbstatic.com/team-logos/135.svg', 'construirMapaLogos: MLB -> logoVisitante resuelto desde statsapi.mlb.com');

  // --- 6) construirMapaLogos: equipo que no cruza con ningún proveedor -> null, sin reventar ---
  global.fetch = async (url) => {
    if (url.includes('statsapi.mlb.com')) return { ok: true, json: async () => ({ teams: [] }) };
    return { ok: true, json: async () => ({ events: [] }) };
  };
  const mapaSinCruce = await construirMapaLogos([filaOdds({ eventoId: 'evt-sin-cruce' })]);
  check(mapaSinCruce['evt-sin-cruce'].logoLocal === null && mapaSinCruce['evt-sin-cruce'].logoVisitante === null, 'construirMapaLogos: equipo sin match -> logos en null, no revienta');

  // --- 7) construirMapaLogos: liga sin mapear a ESPN (sport_key no está en MAPA_SPORT_KEY_A_ESPN) -> null, sin consultar nada ---
  let llamadasExtra = 0;
  global.fetch = async () => { llamadasExtra++; return { ok: true, json: async () => ({ events: [] }) }; };
  const mapaLigaSinMapear = await construirMapaLogos([filaOdds({ eventoId: 'evt-liga-rara', deporte: 'rugby', sportKeyOriginal: 'rugbyleague_nrl' })]);
  check(mapaLigaSinMapear['evt-liga-rara'].logoLocal === null, 'construirMapaLogos: sport_key sin mapear a ESPN -> logo en null');
  check(llamadasExtra === 0, 'construirMapaLogos: sport_key sin mapear -> ni siquiera consulta a ESPN (no hay ruta que pedir)');

  // --- 8) construirMapaLogos: lista vacía -> mapa vacío, sin consultar nada ---
  let llamadasVacio = 0;
  global.fetch = async () => { llamadasVacio++; return { ok: true, json: async () => ({}) }; };
  const mapaVacio = await construirMapaLogos([]);
  check(Object.keys(mapaVacio).length === 0 && llamadasVacio === 0, 'construirMapaLogos: sin filas -> mapa vacío, no consulta nada');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
