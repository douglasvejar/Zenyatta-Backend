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

// CORREGIDO (20-09-2026, caso real reportado por el usuario: 2 tickets de
// "1h" de La Liga y Serie A — ligas SÍ cubiertas acá — quedaron PENDIENTE
// con el mensaje de "puede que esta liga no esté cubierta", que es
// engañoso cuando la liga SÍ está en la lista): hasta ahora, si
// football-data.org respondía con un error (401 clave inválida, 403 plan
// sin acceso a esa competencia, 429 límite de pedidos por minuto del plan
// gratis superado, etc.), esta función lo tragaba en silencio y devolvía
// una lista vacía — exactamente el mismo resultado que si el partido
// simplemente no hubiera llegado todavía. Ahora se revisa `res.ok` y, si
// la respuesta no fue 200, se loguea el status real (para verlo en los
// logs de Railway) y se marca esta competencia puntual como "con error",
// en vez de mezclarla en silencio con "sin partidos ese día".
async function obtenerPrimeraMitadDeCompetencia(codigo, fechaISO, apiKey) {
  const datos = [];
  try {
    const res = await fetch(
      'https://api.football-data.org/v4/competitions/' + codigo + '/matches?dateFrom=' + fechaISO + '&dateTo=' + fechaISO,
      { headers: { 'X-Auth-Token': apiKey } }
    );
    if (!res.ok) {
      console.error('football-data.org respondió ' + res.status + ' para la competencia ' + codigo + ' — revisar si FOOTBALL_DATA_API_KEY es válida o si se superó el límite de pedidos por minuto del plan gratis.');
      return { datos, huboError: true };
    }
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
    return { datos, huboError: true };
  }
  return { datos, huboError: false };
}

// Devuelve { partidos, claveConfigurada, huboError } en vez de una lista
// pelada — mismo motivo que el comentario grande de arriba: sin esto,
// evaluador.js no podía distinguir "esta liga no está cubierta" de "esta
// liga SÍ está cubierta pero algo falló" (lo más probable siendo que
// `FOOTBALL_DATA_API_KEY` nunca se configuró en el servidor de
// producción, o que la clave es inválida/quedó sin cupo) — con estos 2
// datos expuestos, soccerApi.js/evaluador.js ya pueden armar un mensaje
// que diga la verdad en cada caso, en vez de un genérico que puede
// confundir a un partido de una liga SÍ cubierta con uno que no lo está.
async function obtenerPrimeraMitadFutbol(fechaISO) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return { partidos: [], claveConfigurada: false, huboError: false };

  const resultados = await Promise.all(
    LIGAS_CON_PRIMERA_MITAD.map(liga => obtenerPrimeraMitadDeCompetencia(liga.codigo, fechaISO, apiKey))
  );
  const partidos = [].concat(...resultados.map(r => r.datos));
  const huboError = resultados.some(r => r.huboError);
  return { partidos, claveConfigurada: true, huboError };
}

module.exports = { obtenerPrimeraMitadFutbol, LIGAS_CON_PRIMERA_MITAD };
