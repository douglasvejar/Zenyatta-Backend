// =================================================================
// CONECTOR A football-data.org — SOLO para el marcador de "1h" (primera
// mitad) en fútbol.
// =================================================================
// La API de ESPN que ya usa soccerApi.js para todo lo demás (marcador
// final, en vivo, logos) NO expone ningún desglose de marcador por mitad
// — se verificó esto contra la API real antes de buscar otra fuente (ver
// README / doc del proyecto, sección "Apuesta al empate + '1h'"). Esta es
// la fuente elegida por el usuario para 6 de las 10 competiciones.
//
// A diferencia de mlbApi.js/nflApi.js/nhlApi.js/soccerApi.js (ESPN, sin
// clave), football-data.org SÍ necesita una clave gratis — se consigue
// registrándose en https://www.football-data.org/client/register y va en
// la variable de entorno FOOTBALL_DATA_API_KEY (ver .env.example). Sin
// esa clave configurada, esta función no hace ningún pedido y devuelve
// una lista vacía — el sistema sigue funcionando exactamente igual que
// antes (el "1h" de esas 6 ligas simplemente no está disponible, ninguna
// jugada se rompe: sigue quedando PENDIENTE como ya pasa hoy).
//
// Cobertura: SOLO 6 de las 10 competiciones de fútbol que ya evalúa el
// sistema — las que el plan gratis de football-data.org cubre para
// siempre, sin límite de día (confirmado contra su página de cobertura):
// Premier League, La Liga, Serie A, Bundesliga, Ligue 1 y Champions
// League. Liga MX, MLS, Copa Libertadores y Copa Sudamericana NO están
// acá — el usuario eligió cubrir esas 4 con una fuente aparte
// (api-football.com), pendiente de verificar su forma real de respuesta
// antes de programarla (su documentación es un sitio armado con
// JavaScript que no se pudo leer con las herramientas de este sandbox —
// ver doc del proyecto).
//
// Verificado contra la documentación oficial (docs.football-data.org)
// antes de escribir este conector — NO se pudo hacer una llamada real
// autenticada desde este sandbox (no hay forma de mandar el header de
// autenticación con las herramientas de búsqueda web disponibles acá),
// así que esto se apoya en la documentación pública, no en una respuesta
// real observada. Confirmado en la documentación: el endpoint
// `/v4/competitions/{codigo}/matches?dateFrom=X&dateTo=X` devuelve, por
// cada partido, `match.score.halfTime.{home,away}` (null hasta que el
// entretiempo pasó de verdad — ahí es cuando se puede usar) y
// `match.status` (SCHEDULED/TIMED/IN_PLAY/PAUSED/FINISHED/...). El header
// de autenticación es `X-Auth-Token`.
//
// IMPORTANTE — nombres de equipo: football-data.org usa el nombre
// "oficial" del club (ej. "Manchester City FC", o el nombre completo con
// sufijo tipo FC/CF/SSC/AFC), que casi nunca es IDÉNTICO al que devuelve
// ESPN (ej. "Manchester City", sin sufijo). El cruce entre las 2 fuentes
// lo hace soccerApi.js con un match flexible (ver
// normalizarNombreEquipoFutbol/nombresCoinciden ahí) — no es una
// comparación exacta, así que puede fallar en algún club puntual con un
// nombre muy distinto entre las 2 APIs. Pendiente de confirmar con
// tickets reales una vez que el usuario tenga su clave.
const LIGAS_CON_PRIMERA_MITAD = [
  { codigo: 'PL', nombre: 'Premier League' },
  { codigo: 'PD', nombre: 'La Liga' },
  { codigo: 'SA', nombre: 'Serie A' },
  { codigo: 'BL1', nombre: 'Bundesliga' },
  { codigo: 'FL1', nombre: 'Ligue 1' },
  { codigo: 'CL', nombre: 'UEFA Champions League' }
];

async function obtenerPrimeraMitadDeCompetencia(codigo, fechaISO, apiKey) {
  const datos = [];
  try {
    const res = await fetch(
      'https://api.football-data.org/v4/competitions/' + codigo + '/matches?dateFrom=' + fechaISO + '&dateTo=' + fechaISO,
      { headers: { 'X-Auth-Token': apiKey } }
    );
    const json = await res.json();

    (json.matches || []).forEach(m => {
      const halfTime = (m.score && m.score.halfTime) || {};
      const homeScore1H = halfTime.home;
      const awayScore1H = halfTime.away;
      // "final1H" solo cuando el dato de verdad llegó (null hasta que el
      // entretiempo pasó) — antes de eso no se puede usar el marcador de
      // la 1ra mitad, aunque el partido ya haya arrancado.
      const final1H = homeScore1H !== null && homeScore1H !== undefined && awayScore1H !== null && awayScore1H !== undefined;
      datos.push({
        homeTeamName: (m.homeTeam && m.homeTeam.name) || '',
        homeTeamShortName: (m.homeTeam && m.homeTeam.shortName) || '',
        awayTeamName: (m.awayTeam && m.awayTeam.name) || '',
        awayTeamShortName: (m.awayTeam && m.awayTeam.shortName) || '',
        homeScore1H: final1H ? homeScore1H : 0,
        awayScore1H: final1H ? awayScore1H : 0,
        final1H
      });
    });
  } catch (e) {
    console.error('Error al conectar con football-data.org (competencia ' + codigo + '):', e);
  }
  return datos;
}

// Devuelve una LISTA (no un mapa por nombre, a propósito) — el cruce por
// nombre de equipo lo hace soccerApi.js, que es quien conoce los nombres
// "oficiales" de ESPN contra los que hay que emparejar.
async function obtenerPrimeraMitadFutbol(fechaISO) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return [];

  const listas = await Promise.all(
    LIGAS_CON_PRIMERA_MITAD.map(liga => obtenerPrimeraMitadDeCompetencia(liga.codigo, fechaISO, apiKey))
  );
  return [].concat(...listas);
}

module.exports = { obtenerPrimeraMitadFutbol, LIGAS_CON_PRIMERA_MITAD };
