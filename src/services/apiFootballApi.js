// =================================================================
// CONECTOR A api-football.com (API-SPORTS) — SOLO para el marcador de
// "1h" (primera mitad) de las 4 competencias de SELECCIONES que
// football-data.org NO cubre: UEFA Nations League, Copa América,
// Amistoso Internacional y Eliminatorias Conmebol.
// =================================================================
// Mismo motivo que footballDataApi.js: la API de ESPN que usa
// soccerApi.js para todo lo demás (marcador final, en vivo, logos) no
// trae ningún desglose por mitad. football-data.org (footballDataApi.js)
// SÍ cubre "1h" pero solo para 6 ligas de CLUBES (su plan gratis no
// incluye ninguna competencia de SELECCIONES) — por eso estas 4 usan una
// fuente aparte.
//
// A diferencia de football-data.org, acá la clave va en el header
// `x-apisports-key` (confirmado contra la guía oficial de api-football.com
// y contra un pedido real hecho por el usuario desde
// dashboard.api-football.com/soccer/tester — 25-09-2026 — nunca adivinado:
// ver claude/actualizaciones-24-09-2026.md, ronda 33).
//
// IDs de las 4 competencias (confirmados contra /leagues real, no
// adivinados — 25-09-2026):
//   5  = UEFA Nations League
//   9  = Copa América
//   10 = Amistoso Internacional (nombre real en la API: "Friendlies")
//   34 = Eliminatorias Conmebol (nombre real en la API: "World Cup -
//        Qualification South America")
// Los nombres de acá abajo (campo "nombre") son los que ya usa
// soccerApi.js en LIGAS_SOCCER — TIENEN que ser idénticos letra por
// letra a esos, porque es lo que agregarPrimeraMitad() usa para decidir
// si una liga está "cubierta" por esta fuente.
//
// Plan gratis — confirmado con pedidos reales del usuario, no adivinado
// (25-09-2026):
//   - Pedir por `season` de una liga puntual (ej. `league=5&season=2026`)
//     SÍ está bloqueado: "Free plans do not have access to this season,
//     try from 2022 to 2024."
//   - El parámetro `last` también está bloqueado en el plan gratis.
//   - Pero pedir `/fixtures?date=AAAA-MM-DD` (sin season, sin league, la
//     fecha de HOY) SÍ funciona en el plan gratis — se probó con la
//     fecha real del día (2026-09-25) y devolvió 265 partidos reales,
//     incluidos partidos EN VIVO con `score.halftime` ya lleno. Como acá
//     SIEMPRE se pide por fecha (nunca por season), el plan gratis
//     alcanza — no hace falta pagar un plan superior para esto.
//
// Forma real del JSON de `/fixtures` (confirmada con una respuesta real,
// no adivinada): cada partido trae `league.id`, `teams.home/away.name`,
// `score.halftime.{home,away}` (null hasta que el entretiempo pasó de
// verdad, igual que `score.halfTime` en football-data.org) y
// `score.fulltime.{home,away}`.
//
// No se pudo hacer ningún pedido real a v3.football.api-sports.io desde
// este sandbox (mismo bloqueo de red de siempre — confirmado con curl
// directo). Todo lo de arriba se confirmó con pedidos reales que hizo el
// usuario desde su cuenta, pegados tal cual en el chat.
const COMPETENCIAS_API_FOOTBALL = [
  { id: 5, nombre: 'UEFA Nations League' },
  { id: 9, nombre: 'Copa América' },
  { id: 10, nombre: 'Amistoso Internacional' },
  { id: 34, nombre: 'Eliminatorias Conmebol' }
];
const IDS_CUBIERTOS = new Set(COMPETENCIAS_API_FOOTBALL.map(c => c.id));

// Un solo pedido a `/fixtures?date=X` (trae TODOS los partidos del mundo
// de ese día, de cualquier competencia) y se filtra la respuesta por los
// 4 IDs de arriba — mismo espíritu que footballDataApi.js con
// `/v4/matches` (1 pedido en vez de varios, filtrado del lado de acá).
//
// api-football.com puede responder HTTP 200 y aun así traer un error
// DENTRO del cuerpo (`errors`, ya sea un objeto con claves como
// `{ plan: "..." }` o, cuando todo salió bien, un arreglo vacío `[]`) —
// por eso no alcanza con mirar `res.ok`, hay que revisar `json.errors`
// también (confirmado con las respuestas reales que pegó el usuario:
// "Free plans do not have access to..." llegó con `results: 0` y sin que
// el usuario reportara nunca un status distinto de 200).
async function obtenerPartidosDelDia(fechaISO, apiKey) {
  const datos = [];
  try {
    const res = await fetch(
      'https://v3.football.api-sports.io/fixtures?date=' + fechaISO,
      { headers: { 'x-apisports-key': apiKey } }
    );
    if (!res.ok) {
      console.error('api-football.com respondió ' + res.status + ' al pedir /fixtures — revisar si API_FOOTBALL_KEY es válida.');
      return { datos, huboError: true };
    }
    const json = await res.json();

    const erroresCrudos = json.errors;
    const huboErrorEnElCuerpo = !!erroresCrudos && (Array.isArray(erroresCrudos) ? erroresCrudos.length > 0 : Object.keys(erroresCrudos).length > 0);
    if (huboErrorEnElCuerpo) {
      console.error('api-football.com devolvió un error dentro de la respuesta de /fixtures:', JSON.stringify(erroresCrudos));
      return { datos, huboError: true };
    }

    (json.response || []).forEach(partido => {
      const idLiga = partido.league && partido.league.id;
      if (!IDS_CUBIERTOS.has(idLiga)) return; // partido de una competencia que no nos interesa (el endpoint general trae TODAS las del mundo ese día)

      const halftime = (partido.score && partido.score.halftime) || {};
      const homeScore1H = halftime.home;
      const awayScore1H = halftime.away;
      // "final1H" solo cuando el dato de verdad llegó (null hasta que el
      // entretiempo pasó) — mismo criterio que footballDataApi.js.
      const final1H = homeScore1H !== null && homeScore1H !== undefined && awayScore1H !== null && awayScore1H !== undefined;
      const nombreLocal = (partido.teams && partido.teams.home && partido.teams.home.name) || '';
      const nombreVisitante = (partido.teams && partido.teams.away && partido.teams.away.name) || '';
      datos.push({
        // api-football no trae un "nombre corto" aparte del nombre
        // normal (a diferencia de football-data.org, que sí tiene
        // shortName) — se repite el mismo nombre en los 2 campos para
        // que agregarPrimeraMitad() pueda seguir probando ambos sin
        // tratamiento especial.
        homeTeamName: nombreLocal,
        homeTeamShortName: nombreLocal,
        awayTeamName: nombreVisitante,
        awayTeamShortName: nombreVisitante,
        homeScore1H: final1H ? homeScore1H : 0,
        awayScore1H: final1H ? awayScore1H : 0,
        final1H
      });
    });
  } catch (e) {
    console.error('Error al conectar con api-football.com (/fixtures):', e);
    return { datos, huboError: true };
  }
  return { datos, huboError: false };
}

// Caché en memoria por fecha — mismo mecanismo (y mismos TTL) que
// footballDataApi.js, con su propio mapa independiente (son 2 fuentes
// distintas, cada una con su propio límite de pedidos por minuto).
const CACHE_TTL_MS = 45000;
const CACHE_TTL_ERROR_MS = 20000;
let cachePorFecha = new Map(); // fechaISO -> { creadoEn, ttl, promesa }

function _resetCacheParaPruebas() {
  cachePorFecha = new Map();
}

// Devuelve { partidos, claveConfigurada, huboError } — mismo contrato que
// obtenerPrimeraMitadFutbol() de footballDataApi.js.
async function obtenerPrimeraMitadApiFootball(fechaISO) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return { partidos: [], claveConfigurada: false, huboError: false };

  const entradaCacheada = cachePorFecha.get(fechaISO);
  if (entradaCacheada && (Date.now() - entradaCacheada.creadoEn) < entradaCacheada.ttl) {
    return entradaCacheada.promesa;
  }

  const promesa = obtenerPartidosDelDia(fechaISO, apiKey).then(({ datos, huboError }) => ({
    partidos: datos,
    claveConfigurada: true,
    huboError
  }));
  cachePorFecha.set(fechaISO, { creadoEn: Date.now(), ttl: CACHE_TTL_MS, promesa });

  const resultado = await promesa;
  if (resultado.huboError) {
    cachePorFecha.set(fechaISO, { creadoEn: Date.now(), ttl: CACHE_TTL_ERROR_MS, promesa });
  }
  return resultado;
}

module.exports = { obtenerPrimeraMitadApiFootball, COMPETENCIAS_API_FOOTBALL, _resetCacheParaPruebas };
