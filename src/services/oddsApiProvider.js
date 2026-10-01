// =================================================================
// CONECTOR A The Odds API (the-odds-api.com) — logros para la
// Calculadora Parley y la pestaña PARLEYS (01-10-2026, a pedido del
// usuario: "existe manera de cargar logros de apuestas... para que
// jueguen parley" -> "me gustaria conectarla a un proveedor que me
// cargue y actulice los logros automatico" -> "en los logros coloca el
// rl la alta y la baja, si tienes logros a medio juego o 5to o 1h
// agregalos tambien" -> con una captura real de un sportsbook de
// referencia: "coloca una seccion donde pueda escoger juego completo/
// primera mitad/segunda mitad...").
//
// Mismo espíritu que apiFootballApi.js / footballDataApi.js: este
// archivo SOLO sabe hablar con el proveedor externo y devolver datos
// normalizados — nunca toca la base de datos (eso lo hace
// services/parleyLogros.js, que es quien guarda el resultado de acá en
// parley_juegos).
//
// MERCADOS: además del "h2h" (ganador/moneyline) original, también se
// pide:
//   - "spreads"  -> la Línea/Run Line (RL) — el favorito "da" puntos, el
//                   contendor los "recibe" (outcome.point).
//   - "totals"   -> Alta/Baja (Over/Under) — mismo total (outcome.point)
//                   para ambos lados.
//   - "h2h_h1" / "spreads_h1" / "totals_h1" -> los mismos 3 de arriba
//                   pero de 1er Tiempo/Medio Juego — SOLO para los
//                   deportes que de verdad juegan por mitades
//                   (americanfootball/basketball/soccer); MLB no tiene
//                   "mitades" (juega por entradas) así que no se piden.
//
// "2da Mitad"/"Segunda Mitad" (01-10-2026, a pedido del usuario, con una
// captura real de un sportsbook de referencia: "coloca una seccion donde
// pueda escoger juego completo/primera mitad/segunda mitad..."). Los
// mercados "h2h_h2"/"spreads_h2"/"totals_h2" EXISTEN en el catálogo de
// The Odds API (misma familia que "h1"), pero la documentación oficial
// NUNCA quedó 100% clara sobre si viajan en el mismo pedido barato (bulk,
// GET /v4/sports/{sport}/odds) o si — como "1st 5 innings"/"1st quarter"
// — exigen el endpoint "por evento" (mucho más caro: créditos = partidos
// × mercados × regiones). No se pudo hacer una prueba real contra la API
// desde ningún entorno disponible (ni este, ni la computadora del
// usuario — ambos bloquean la salida de red hacia api.the-odds-api.com)
// para confirmarlo con un pedido real. El usuario, informado de esta
// duda, pidió agregarla igual bajo el mismo esquema de seguridad ya
// usado para "1er Tiempo":
//   - El pedido de "2da Mitad" se hace en una llamada APARTE, separada
//     tanto del núcleo como de la de "1er Tiempo" (ver
//     obtenerLogrosDeDeporte más abajo).
//   - Si esa llamada falla (por ejemplo, si en verdad hiciera falta el
//     endpoint por evento y el proveedor la rechazara con un error de
//     "mercado desconocido"), se registra el motivo en consola pero NO
//     se marca huboError:true — el partido completo y el 1er Tiempo
//     siguen cargando bien igual, y simplemente no aparecería el botón
//     "2da Mitad" para ese deporte.
//   - Si en la práctica resulta que SÍ exige el endpoint caro, esa
//     llamada empezará a fallar sola (créditos agotados o error de
//     mercado) y quedará registrada en consola sin romper nada más — en
//     ese caso habría que avisarle al usuario para decidir si vale la
//     pena el costo o si se quita.
//
// Documentación oficial: https://the-odds-api.com/liveapi/guides/v4/
// =================================================================

const BASE_URL = 'https://api.the-odds-api.com/v4/sports';

// Mercados "núcleo" — siempre se piden para cualquier deporte, en UNA
// sola llamada barata (1 crédito por mercado pedido, por región).
const MERCADOS_NUCLEO = ['h2h', 'spreads', 'totals'];

// Mercados de 1er Tiempo/Medio Juego y de 2da Mitad — se piden cada uno
// en su propia llamada APARTE (ver nota grande arriba sobre por qué),
// solo para los deportes que de verdad juegan por mitades.
const MERCADOS_PRIMERA_MITAD = ['h2h_h1', 'spreads_h1', 'totals_h1'];
const MERCADOS_SEGUNDA_MITAD = ['h2h_h2', 'spreads_h2', 'totals_h2'];
const GRUPOS_CON_PRIMERA_MITAD = ['americanfootball', 'basketball', 'soccer'];

function grupoDeDeporte(sportKey) {
  return sportKey.split('_')[0];
}

function tienePrimeraMitad(sportKey) {
  return GRUPOS_CON_PRIMERA_MITAD.includes(grupoDeDeporte(sportKey));
}

// Misma restricción que "1er Tiempo": los mismos deportes que juegan por
// mitades tienen también "2da Mitad" (MLB, que juega por entradas,
// tampoco la tiene).
function tieneSegundaMitad(sportKey) {
  return GRUPOS_CON_PRIMERA_MITAD.includes(grupoDeDeporte(sportKey));
}

// Combinado informativo (ej. para logs/documentación) de TODOS los
// mercados que se terminan pidiendo para un sportKey, aunque viajen en
// hasta 3 llamadas separadas — ver obtenerLogrosDeDeporte().
function mercadosParaDeporte(sportKey) {
  if (!tienePrimeraMitad(sportKey)) return MERCADOS_NUCLEO;
  return [...MERCADOS_NUCLEO, ...MERCADOS_PRIMERA_MITAD, ...MERCADOS_SEGUNDA_MITAD];
}

// Etiqueta a mostrar + a qué "seleccion" semántica corresponde cada
// outcome, según el mercado. "spreads"/"spreads_h1"/"spreads_h2"
// conservan seleccion:'local'/'visitante' (como h2h) porque siguen siendo
// UN EQUIPO con un punto encima; "totals"/"totals_h1"/"totals_h2" no
// tienen equipo — Over/Under se traducen a 'alta'/'baja' tal como las
// pidió el usuario.
function interpretarOutcome(mercadoKey, outcome, evento) {
  const esTotales = mercadoKey === 'totals' || mercadoKey === 'totals_h1' || mercadoKey === 'totals_h2';
  if (esTotales) {
    const esAlta = outcome.name === 'Over';
    return { seleccion: esAlta ? 'alta' : 'baja', nombreSeleccion: esAlta ? 'Alta' : 'Baja' };
  }
  if (outcome.name === evento.home_team) return { seleccion: 'local', nombreSeleccion: outcome.name };
  if (outcome.name === evento.away_team) return { seleccion: 'visitante', nombreSeleccion: outcome.name };
  return { seleccion: 'empate', nombreSeleccion: 'Empate' }; // fútbol h2h/h2h_h1: 3er resultado siempre es "Draw"
}

// Un pedido a The Odds API con una lista puntual de mercados. Separado
// de obtenerLogrosDeDeporte() para poder pedir el núcleo y la 1ra mitad
// en 2 llamadas independientes (ver nota grande arriba) sin duplicar la
// lógica de armar la URL / leer el error.
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
      // igual (1er tiempo sobre todo es menos universal que el partido
      // completo), así que se busca mercado por mercado en vez de exigir
      // que un solo book tenga todos a la vez.
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

// Pide el partido completo (núcleo) y, si el deporte juega por mitades,
// el 1er Tiempo y la 2da Mitad en llamadas APARTE, cada una (ver nota
// grande arriba sobre por qué). Si falla el núcleo, se reporta como error
// real (sin eso no hay logros de verdad para esta liga). Si falla SOLO el
// 1er Tiempo y/o la 2da Mitad, el partido completo ya cargó bien — se
// registra el motivo en consola pero NO se marca huboError:true (eso
// frenaría/alarmaría por algo que no rompe el feature principal, ver
// sql/schema.sql y la nota grande arriba).
async function obtenerLogrosDeDeporte(sportKey, apiKey) {
  const { eventos: eventosNucleo, error: errorNucleo } = await pedirMercados(sportKey, apiKey, MERCADOS_NUCLEO);
  if (errorNucleo) {
    return { filas: [], huboError: true, mensajeError: errorNucleo };
  }

  const filas = extraerFilas(eventosNucleo, sportKey, MERCADOS_NUCLEO);

  if (tienePrimeraMitad(sportKey)) {
    const { eventos: eventosH1, error: errorH1 } = await pedirMercados(sportKey, apiKey, MERCADOS_PRIMERA_MITAD);
    if (errorH1) {
      console.error('Logros Parley: no se pudo cargar el 1er Tiempo de ' + sportKey + ' (el partido completo sí cargó bien) — ' + errorH1);
    } else {
      filas.push(...extraerFilas(eventosH1, sportKey, MERCADOS_PRIMERA_MITAD));
    }
  }

  if (tieneSegundaMitad(sportKey)) {
    const { eventos: eventosH2, error: errorH2 } = await pedirMercados(sportKey, apiKey, MERCADOS_SEGUNDA_MITAD);
    if (errorH2) {
      console.error('Logros Parley: no se pudo cargar la 2da Mitad de ' + sportKey + ' (el partido completo sí cargó bien) — ' + errorH2);
    } else {
      filas.push(...extraerFilas(eventosH2, sportKey, MERCADOS_SEGUNDA_MITAD));
    }
  }

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
