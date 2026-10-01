// =================================================================
// CONECTOR A The Odds API (the-odds-api.com) — logros (moneyline) para
// la Calculadora Parley pública (01-10-2026, a pedido del usuario:
// "existe manera de cargar logros de apuestas, a la pagina? para que
// jueguen parley" -> "me gustaria conectarla a un proveedor que me
// cargue y actulice los logros automatico").
//
// Mismo espíritu que apiFootballApi.js / footballDataApi.js: este
// archivo SOLO sabe hablar con el proveedor externo y devolver datos
// normalizados — nunca toca la base de datos (eso lo hace
// services/parleyLogros.js, que es quien guarda el resultado de acá en
// parley_juegos).
//
// Se pide el mercado "h2h" (head-to-head = ganador del partido, sin
// handicap) con oddsFormat=american para que el número que llega ya
// venga en el mismo formato que usa la fórmula de la Calculadora Parley
// (negativo = favorito, positivo = contendor) sin importar si el
// bookmaker de origen publica en decimal (frecuente en libros
// europeos) — The Odds API normaliza esto solo con ese parámetro, no
// hace falta convertir nada acá.
//
// Documentación oficial: https://the-odds-api.com/liveapi/guides/v4/
// =================================================================

const BASE_URL = 'https://api.the-odds-api.com/v4/sports';

// Un solo pedido por "sport key" (ej. "baseball_mlb") trae TODOS los
// partidos próximos de esa liga con sus logros — no hace falta pedir
// partido por partido. region=us porque los bookmakers de esa región
// son los que de verdad usan el estilo moneyline americano de forma
// nativa (igual se pide oddsFormat=american para los que no).
async function obtenerLogrosDeDeporte(sportKey, apiKey) {
  const filas = [];
  try {
    const url = BASE_URL + '/' + encodeURIComponent(sportKey) + '/odds/'
      + '?apiKey=' + encodeURIComponent(apiKey)
      + '&regions=us'
      + '&markets=h2h'
      + '&oddsFormat=american';
    const res = await fetch(url);

    if (!res.ok) {
      // The Odds API devuelve el motivo en el cuerpo (ej. clave
      // inválida, "sport" desconocido, créditos agotados) — se lo
      // pasamos tal cual a quien llamó para que quede en el log/estado,
      // en vez de un "falló" genérico que obliga a adivinar por qué.
      let detalle = '';
      try { detalle = (await res.json()).message || ''; } catch (_) { /* cuerpo no era JSON, no pasa nada */ }
      return { filas, huboError: true, mensajeError: 'HTTP ' + res.status + (detalle ? ' — ' + detalle : '') + ' (sport: ' + sportKey + ')' };
    }

    const eventos = await res.json();
    (eventos || []).forEach(evento => {
      // Se toma el PRIMER bookmaker que traiga el mercado h2h completo
      // — promediar entre varios bookmakers es un refinamiento que no
      // hace falta para v1 (la calculadora ya deja al usuario editar el
      // número a mano si quiere ajustar la línea).
      const bookmaker = (evento.bookmakers || []).find(b =>
        (b.markets || []).some(m => m.key === 'h2h' && (m.outcomes || []).length >= 2)
      );
      if (!bookmaker) return; // partido sin momios todavía (muy lejano, o liga sin cobertura de ese book)

      const mercado = bookmaker.markets.find(m => m.key === 'h2h');
      const deporteGrupo = (evento.sport_key || sportKey).split('_')[0]; // 'baseball_mlb' -> 'baseball' (agrupador genérico, ver comentario en sql/schema.sql)

      (mercado.outcomes || []).forEach(outcome => {
        let seleccion;
        if (outcome.name === evento.home_team) seleccion = 'local';
        else if (outcome.name === evento.away_team) seleccion = 'visitante';
        else seleccion = 'empate'; // fútbol: el 3er resultado del mercado h2h siempre es "Draw"

        filas.push({
          deporte: deporteGrupo,
          liga: evento.sport_title || sportKey,
          eventoId: evento.id,
          equipoLocal: evento.home_team,
          equipoVisitante: evento.away_team,
          horaInicio: evento.commence_time || null,
          seleccion,
          nombreSeleccion: seleccion === 'empate' ? 'Empate' : outcome.name,
          logro: Number(outcome.price)
        });
      });
    });

    return { filas, huboError: false, mensajeError: null };
  } catch (err) {
    return { filas, huboError: true, mensajeError: 'Error de red consultando The Odds API (sport: ' + sportKey + '): ' + err.message };
  }
}

// Junta los logros de varias ligas/deportes en una sola lista. Cada
// "sportKey" se pide por separado porque así lo exige el proveedor (no
// existe un endpoint "todas las ligas de una" en The Odds API) — los
// errores de UN deporte puntual (ej. clave vencida justo ese día, o una
// liga mal escrita en ODDS_API_DEPORTES) no frenan a los demás.
async function obtenerTodosLosLogros(sportKeys, apiKey) {
  const todasLasFilas = [];
  const errores = [];
  for (const sportKey of sportKeys) {
    const { filas, huboError, mensajeError } = await obtenerLogrosDeDeporte(sportKey, apiKey);
    todasLasFilas.push(...filas);
    if (huboError) errores.push(mensajeError);
  }
  return { filas: todasLasFilas, errores };
}

module.exports = { obtenerLogrosDeDeporte, obtenerTodosLosLogros };
