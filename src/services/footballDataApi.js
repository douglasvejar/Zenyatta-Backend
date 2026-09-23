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
// =================================================================
// RONDA 23-09-2026 — "aun hay problemas para leer los partidos 1h de
// futbol en cualquier liga" (reportado por el usuario, sin distinguir
// liga puntual — a diferencia de los casos anteriores, sección 16/29 del
// doc de actualizaciones, que sí eran por liga/mensaje). Causa real
// encontrada leyendo el código, no adivinada:
//
// 1) Esta función pedía, CADA VEZ que se llamaba, las 6 competiciones
//    cubiertas EN PARALELO (6 pedidos a football-data.org de una sola
//    vez). Y se llama sin ningún caché desde 3 lugares: `/procesar` (cada
//    sábana), `/dia` (sabanaDia.js) y, el más grave, **`/pizarra`, que el
//    panel auto-refresca cada 20 segundos** (ver el comentario de
//    sabana.js). Eso son 6 pedidos cada 20s = 18 pedidos/minuto SOLO por
//    tener la pizarra abierta — muy por encima del límite del plan
//    gratis de football-data.org, que es de **10 pedidos/minuto**
//    (confirmado en su documentación oficial de políticas, 23-09-2026).
//    Con varios grupos usando el panel a la vez, o con "Procesar Sábana"
//    corriendo al mismo tiempo que alguien mira la pizarra, el límite se
//    superaba todavía más rápido. Al pasarse del límite, football-data.org
//    responde 429 para las competiciones que no llegaron a tiempo — y eso
//    ya se veía (desde la sección 16/29) como `motivoSinPrimeraMitad:
//    'error-api'`, pero nunca se atacó la CAUSA (el exceso de pedidos),
//    solo se mejoró el mensaje. Como el 429 puede tocarle a cualquiera de
//    las 6 ligas según el orden en que football-data.org las procese, el
//    síntoma se veía "en cualquier liga", tal como reportó el usuario.
//
// 2) Aparte, esas 6 competiciones se pedían con 6 llamadas SEPARADAS
//    (`/v4/competitions/{codigo}/matches`) pudiendo pedirse las 6 en UNA
//    sola llamada al endpoint general `/v4/matches?dateFrom=X&dateTo=X`
//    (confirmado en la documentación oficial, 23-09-2026: acepta
//    `dateFrom`/`dateTo` y devuelve partidos de TODAS las competiciones a
//    las que da acceso el plan del usuario, cada uno con su propio objeto
//    `competition.code`) — no hace falta pedir "todos los partidos de
//    todas las competencias del mundo" y filtrar, alcanza con filtrar la
//    respuesta de ESE ÚNICO pedido por los 6 códigos que nos interesan.
//
// El arreglo, dos partes:
//   a) Un solo pedido a `/v4/matches` en vez de 6 a `/competitions/X`
//      (6 veces menos pedidos de entrada).
//   b) Un caché en memoria por fecha (ver CACHE_TTL_MS/CACHE_TTL_ERROR_MS
//      abajo): mientras el caché esté fresco, CUALQUIER cantidad de
//      llamadas a obtenerPrimeraMitadFutbol() para la MISMA fecha (desde
//      /pizarra cada 20s, desde /procesar, desde /dia, de cualquier
//      grupo) reusan el mismo resultado en vez de volver a pedirle nada a
//      football-data.org. Con (a)+(b), el peor caso pasa de ~18
//      pedidos/minuto a, como mucho, 1 pedido cada 45 segundos (~1.3
//      pedidos/minuto) — muy por debajo del límite de 10/minuto del plan
//      gratis, sin importar cuántos paneles estén abiertos a la vez.
//
// No se pudo hacer una llamada real autenticada a `/v4/matches` desde
// este sandbox (mismo bloqueo de red de siempre para pedidos con clave —
// ver el resto de este comentario en versiones anteriores del archivo);
// el endpoint, sus parámetros (`dateFrom`/`dateTo`) y que cada partido
// trae su propio `competition.code` SÍ se confirmaron contra la
// documentación oficial vigente (docs.football-data.org, 23-09-2026), lo
// mismo que el límite de 10 pedidos/minuto del plan gratis. Pendiente de
// confirmar con tráfico real una vez desplegado.
//
// El header de autenticación sigue siendo `X-Auth-Token`, y
// `match.score.halfTime.{home,away}` sigue siendo `null` hasta que el
// entretiempo pasó de verdad — eso no cambió, solo CÓMO se piden los
// partidos.
//
// IMPORTANTE — nombres de equipo: football-data.org usa el nombre
// "oficial" del club (ej. "Manchester City FC", o el nombre completo con
// sufijo tipo FC/CF/SSC/AFC), que casi nunca es IDÉNTICO al que devuelve
// ESPN (ej. "Manchester City", sin sufijo). El cruce entre las 2 fuentes
// lo hace soccerApi.js con un match flexible (ver
// normalizarNombreEquipoFutbol/nombresCoinciden ahí) — no es una
// comparación exacta, así que puede fallar en algún club puntual con un
// nombre muy distinto entre las 2 APIs.
const LIGAS_CON_PRIMERA_MITAD = [
  { codigo: 'PL', nombre: 'Premier League' },
  { codigo: 'PD', nombre: 'La Liga' },
  { codigo: 'SA', nombre: 'Serie A' },
  { codigo: 'BL1', nombre: 'Bundesliga' },
  { codigo: 'FL1', nombre: 'Ligue 1' },
  { codigo: 'CL', nombre: 'UEFA Champions League' }
];
const CODIGOS_CUBIERTOS = new Set(LIGAS_CON_PRIMERA_MITAD.map(l => l.codigo));

// Un solo pedido a `/v4/matches?dateFrom=X&dateTo=X` (en vez de 6, uno
// por competencia — ver el comentario grande de arriba) y se filtra la
// respuesta por los 6 códigos que nos interesan. `res.ok` se revisa antes
// de leer el JSON (mismo motivo que antes: distinguir "football-data.org
// respondió con un error real" de "no hay partidos ese día", ver sección
// 16 del doc de actualizaciones).
async function obtenerPartidosDelDia(fechaISO, apiKey) {
  const datos = [];
  try {
    const res = await fetch(
      'https://api.football-data.org/v4/matches?dateFrom=' + fechaISO + '&dateTo=' + fechaISO,
      { headers: { 'X-Auth-Token': apiKey } }
    );
    if (!res.ok) {
      console.error('football-data.org respondió ' + res.status + ' al pedir /v4/matches — revisar si FOOTBALL_DATA_API_KEY es válida o si se superó el límite de pedidos por minuto del plan gratis.');
      return { datos, huboError: true };
    }
    const json = await res.json();

    (json.matches || []).forEach(m => {
      const codigoCompetencia = (m.competition && m.competition.code) || '';
      if (!CODIGOS_CUBIERTOS.has(codigoCompetencia)) return; // partido de una competencia que no nos interesa (el endpoint general trae TODAS las que el plan del usuario puede ver)

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
    console.error('Error al conectar con football-data.org (/v4/matches):', e);
    return { datos, huboError: true };
  }
  return { datos, huboError: false };
}

// Caché en memoria por fecha (23-09-2026, ver el comentario grande de
// arriba) — evita volver a pedirle a football-data.org lo mismo una y
// otra vez cuando varias partes del sistema (pizarra cada 20s, procesar
// sábana, sabanaDia) piden la MISMA fecha en un ratito corto. Guarda la
// PROMESA (no solo el resultado) para que, si 2 pedidos llegan a la vez
// mientras el primero todavía está en vuelo, el segundo espere ese mismo
// pedido en vez de disparar uno nuevo en paralelo.
//
// TTL más corto para un resultado con error (CACHE_TTL_ERROR_MS): así, si
// football-data.org respondió mal por un motivo transitorio (429 por un
// pico puntual), el sistema reintenta más pronto en vez de quedarse 45s
// mostrando "error-api" de forma innecesaria — pero nunca tan corto como
// para volver a golpear el límite de pedidos por minuto.
const CACHE_TTL_MS = 45000;
const CACHE_TTL_ERROR_MS = 20000;
let cachePorFecha = new Map(); // fechaISO -> { creadoEn, ttl, promesa }

function _resetCacheParaPruebas() {
  cachePorFecha = new Map();
}

// Devuelve { partidos, claveConfigurada, huboError } en vez de una lista
// pelada — así evaluador.js/soccerApi.js pueden distinguir "esta liga no
// está cubierta" de "esta liga SÍ está cubierta pero algo falló" (por
// ejemplo, que `FOOTBALL_DATA_API_KEY` nunca se configuró en el servidor
// de producción, o que la clave es inválida/quedó sin cupo).
async function obtenerPrimeraMitadFutbol(fechaISO) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
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
  // Se guarda la promesa YA (antes de esperarla) para que llamadas
  // simultáneas a esta misma fecha reusen este mismo pedido en vez de
  // disparar uno nuevo cada una.
  cachePorFecha.set(fechaISO, { creadoEn: Date.now(), ttl: CACHE_TTL_MS, promesa });

  const resultado = await promesa;
  if (resultado.huboError) {
    // Se corrige el TTL guardado a uno más corto para un resultado con
    // error, ahora que ya se sabe que lo fue (no se puede saber antes de
    // await porque recién ahí se conoce huboError).
    cachePorFecha.set(fechaISO, { creadoEn: Date.now(), ttl: CACHE_TTL_ERROR_MS, promesa });
  }
  return resultado;
}

module.exports = { obtenerPrimeraMitadFutbol, LIGAS_CON_PRIMERA_MITAD, _resetCacheParaPruebas };
