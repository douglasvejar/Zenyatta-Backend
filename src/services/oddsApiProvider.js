// =================================================================
// CONECTOR A The Odds API (the-odds-api.com) — logros para la
// Calculadora Parley y la pestaña PARLEYS (01-10-2026, a pedido del
// usuario: "existe manera de cargar logros de apuestas... para que
// jueguen parley" -> "me gustaria conectarla a un proveedor que me
// cargue y actulice los logros automatico" -> "en los logros coloca el
// rl la alta y la baja, si tienes logros a medio juego o 5to o 1h
// agregalos tambien").
//
// Mismo espíritu que apiFootballApi.js / footballDataApi.js: este
// archivo SOLO sabe hablar con el proveedor externo y devolver datos
// normalizados — nunca toca la base de datos (eso lo hace
// services/parleyLogros.js, que es quien guarda el resultado de acá en
// parley_juegos).
//
// MERCADOS QUE SE PIDEN HOY (el "núcleo", disponible para CUALQUIER
// deporte en el pedido barato de la liga completa):
//   - "h2h"      -> Ganador/moneyline.
//   - "spreads"  -> la Línea/Run Line (RL) — el favorito "da" puntos, el
//                   contendor los "recibe" (outcome.point).
//   - "totals"   -> Alta/Baja (Over/Under) — mismo total (outcome.point)
//                   para ambos lados.
//
// "1er Tiempo"/"2da Mitad" (h2h_h1/spreads_h1/totals_h1 y sus
// equivalentes "_h2") — CONFIRMADO QUE NO SE PUEDEN PEDIR ACÁ (01-10-2026):
// se implementaron en una ronda anterior pidiéndolos en llamadas
// separadas al mismo endpoint barato (GET /v4/sports/{sport}/odds), bajo
// la sospecha (la documentación oficial nunca lo aclaró del todo) de que
// quizás no viajaran ahí. Ya en producción, el proveedor rechazó esas
// llamadas con un error real y explícito:
//   HTTP 422 — "Markets not supported by this endpoint: h2h_h1,
//   spreads_h1, totals_h1" (y lo mismo para los "_h2")
// Es decir: esos mercados NO EXISTEN en el endpoint barato, para ningún
// deporte. Para tenerlos hay que usar el endpoint "por evento" (GET
// /v4/sports/{sport}/events/{eventId}/odds), que se paga distinto: el
// costo = cantidad de mercados que de verdad vienen en la respuesta ×
// regiones, PERO hay que pagarlo por CADA PARTIDO por separado (no una
// vez por liga completa como el núcleo). Con las ligas de este sistema
// (NFL, NBA, EPL, La Liga, Champions League) un día con muchos partidos
// puede significar varios miles de créditos SOLO para 1er Tiempo/2da
// Mitad en una sola corrida de refresco — informado el usuario con el
// cálculo real, decidió NO implementarlo por ahora y dejar únicamente el
// partido completo (Ganador/RL/Alta-Baja), que es barato y fijo por liga
// sin importar cuántos partidos haya. Si en el futuro se quiere
// retomar esto, hay que usar el endpoint "por evento" descrito arriba,
// con su propio refresco (mucho más espaciado que el del partido
// completo) para controlar el gasto.
//
// Documentación oficial: https://the-odds-api.com/liveapi/guides/v4/
// =================================================================

const BASE_URL = 'https://api.the-odds-api.com/v4/sports';

// Único grupo de mercados que se pide — ver nota grande arriba sobre por
// qué "1er Tiempo"/"2da Mitad" no están (confirmado con un pedido real
// que el endpoint barato los rechaza).
const MERCADOS_NUCLEO = ['h2h', 'spreads', 'totals'];

// Mismos mercados para cualquier deporte — se mantiene esta función
// (en vez de usar MERCADOS_NUCLEO directo en todos lados) porque ya la
// usan otras partes del sistema/los tests, y por si en el futuro vuelve
// a haber mercados que dependan del deporte.
function mercadosParaDeporte(sportKey) {
  return MERCADOS_NUCLEO;
}

// Etiqueta a mostrar + a qué "seleccion" semántica corresponde cada
// outcome, según el mercado. "spreads" conserva seleccion:'local'/
// 'visitante' (como h2h) porque sigue siendo UN EQUIPO con un punto
// encima; "totals" no tiene equipo — Over/Under se traduce a
// 'alta'/'baja' tal como las pidió el usuario.
function interpretarOutcome(mercadoKey, outcome, evento) {
  if (mercadoKey === 'totals') {
    const esAlta = outcome.name === 'Over';
    return { seleccion: esAlta ? 'alta' : 'baja', nombreSeleccion: esAlta ? 'Alta' : 'Baja' };
  }
  if (outcome.name === evento.home_team) return { seleccion: 'local', nombreSeleccion: outcome.name };
  if (outcome.name === evento.away_team) return { seleccion: 'visitante', nombreSeleccion: outcome.name };
  return { seleccion: 'empate', nombreSeleccion: 'Empate' }; // fútbol h2h: 3er resultado siempre es "Draw"
}

// Un pedido a The Odds API con una lista puntual de mercados.
async function pedirMercados(sportKey, apiKey, mercados) {
  try {
    const url = BASE_URL + '/' + encodeURIComponent(sportKey) + '/odds/'
      + '?apiKey=' + encodeURIComponent(apiKey)
      + '&regions=us'
      + '&markets=' + mercados.join(',')
      + '&oddsFormat=american';
    const res = await fetch(url);

    if (!res.ok) {
      // The Odds API devuelve el motivo en el cuerpo (ej. clave
      // inválida, "sport"/"market" desconocido, créditos agotados) — se
      // lo pasamos tal cual a quien llamó para que quede en el
      // log/estado, en vez de un "falló" genérico que obliga a adivinar
      // por qué.
      let detalle = '';
      try { detalle = (await res.json()).message || ''; } catch (_) { /* cuerpo no era JSON, no pasa nada */ }
      return { eventos: null, error: 'HTTP ' + res.status + (detalle ? ' — ' + detalle : '') + ' (sport: ' + sportKey + ', mercados: ' + mercados.join(',') + ')' };
    }

    return { eventos: await res.json(), error: null };
  } catch (err) {
    return { eventos: null, error: 'Error de red consultando The Odds API (sport: ' + sportKey + ', mercados: ' + mercados.join(',') + '): ' + err.message };
  }
}

// Convierte la respuesta cruda de un pedido (lista de eventos) en filas
// normalizadas, para los mercados puntuales que SE PIDIERON en esa
// llamada (nunca de más — si un evento trae otro mercado que no se pidió,
// se ignora).
function extraerFilas(eventos, sportKeyFallback, mercadosPedidos) {
  const filas = [];
  (eventos || []).forEach(evento => {
    const deporteGrupo = (evento.sport_key || sportKeyFallback).split('_')[0]; // 'baseball_mlb' -> 'baseball' (agrupador genérico, ver comentario en sql/schema.sql)

    mercadosPedidos.forEach(mercadoKey => {
      // Se toma el PRIMER bookmaker que traiga ESTE mercado puntual
      // completo — no todos los books publican todos los mercados por
      // igual, así que se busca mercado por mercado en vez de exigir que
      // un solo book tenga todos a la vez.
      const bookmaker = (evento.bookmakers || []).find(b =>
        (b.markets || []).some(m => m.key === mercadoKey && (m.outcomes || []).length >= 2)
      );
      if (!bookmaker) return; // ningún book tiene este mercado todavía para este partido

      const mercado = bookmaker.markets.find(m => m.key === mercadoKey);
      (mercado.outcomes || []).forEach(outcome => {
        const { seleccion, nombreSeleccion } = interpretarOutcome(mercadoKey, outcome, evento);
        filas.push({
          deporte: deporteGrupo,
          sportKeyOriginal: evento.sport_key || sportKeyFallback, // transitorio: solo lo usa logosEquiposParley.js para elegir la liga de ESPN correcta — nunca se guarda en la base de datos
          liga: evento.sport_title || sportKeyFallback,
          eventoId: evento.id,
          equipoLocal: evento.home_team,
          equipoVisitante: evento.away_team,
          horaInicio: evento.commence_time || null,
          mercado: mercadoKey,
          seleccion,
          nombreSeleccion,
          punto: (outcome.point !== undefined && outcome.point !== null) ? Number(outcome.point) : null,
          logro: Number(outcome.price)
        });
      });
    });
  });
  return filas;
}

// Pide el partido completo (único grupo de mercados disponible por ahora
// — ver nota grande arriba). Si falla, se reporta como error real (sin
// eso no hay logros de verdad para esta liga).
async function obtenerLogrosDeDeporte(sportKey, apiKey) {
  const { eventos, error } = await pedirMercados(sportKey, apiKey, MERCADOS_NUCLEO);
  if (error) {
    return { filas: [], huboError: true, mensajeError: error };
  }

  const filas = extraerFilas(eventos, sportKey, MERCADOS_NUCLEO);
  return { filas, huboError: false, mensajeError: null };
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

module.exports = { obtenerLogrosDeDeporte, obtenerTodosLosLogros, mercadosParaDeporte };
