// =================================================================
// CONECTOR A LA API DE FÚTBOL (vía la API "oculta"/no oficial de ESPN)
// =================================================================
// A diferencia de MLB/NFL/NHL (una sola liga cada uno), "fútbol" en
// ESPN es UN deporte con muchas ligas/torneos distintos, cada uno con su
// propio "slug" y su propio endpoint de scoreboard. Se le pide a TODAS
// las ligas configuradas EN PARALELO (mismo espíritu que ya usa
// procesarSabana.js para pedir MLB+NFL+NHL a la vez) y se combinan los
// resultados en un solo mapa — así una jugada de "Real Madrid" (La Liga)
// y otra de "Flamengo" (Copa Libertadores) se resuelven ambas contra la
// MISMA llamada a evaluarJugada(), exactamente igual que ya pasa entre
// MLB y NFL.
//
// Confirmado pegándole directo a cada endpoint real (vía la herramienta
// de búsqueda web) antes de escribir este conector: misma forma que
// NFL/NHL (competitions[0].status.{type,period,displayClock},
// competitors[].{homeAway,team.displayName,score,team.logo,winner}) — un
// empate SÍ es un resultado final válido acá (a diferencia de NFL/NHL),
// con status.type.completed = true y ambos competitors con winner=false.
//
// Ligas cubiertas hoy: Premier League, La Liga, Serie A, Bundesliga, Ligue 1,
// Liga MX, MLS, Champions League, Copa Libertadores, Copa Sudamericana
// (pedidas el 28-08-2026) + UEFA Europa League y UEFA Conference League
// (agregadas el 31-08-2026, a pedido del usuario — "falto la europa league
// y la conference") + Eredivisie de Holanda (agregada el 20-09-2026, a
// pedido del usuario — "tenemos la liga holandesa para agregar... no me
// aparece para agregar equipos a la api"). Agregar una liga nueva más
// adelante es solo sumar su slug acá — no hace falta tocar nada más del
// motor de evaluación (evaluador.js ya trata a TODO fútbol como un solo
// deporte "soccer", sin importar el torneo).
//
// Slugs de Europa League/Conference League confirmados contra la API real
// de ESPN (vía la herramienta de búsqueda web, con fechas reales de la
// temporada 2025-26) antes de agregarlos acá — mismo criterio ya usado
// para las 10 ligas anteriores: 'uefa.europa' devolvió partidos reales de
// fase de liga (ej. "Bologna at Aston Villa", 25-09-2025) con
// leagues[0].name = "UEFA Europa League"; 'uefa.europa.conf' devolvió
// partidos reales (ej. "Crystal Palace at Dynamo Kyiv", 02-10-2025) con
// leagues[0].name = "UEFA Conference League".
//
// Slug de Eredivisie ('ned.1') confirmado igual que las anteriores: varias
// páginas públicas reales de espn.com (standings/schedule/teams/stats,
// todas con /league/ned.1 en la URL) y decenas de resultados reales de
// partidos de la temporada 2025-26/2026-27 (vía búsqueda web — no se pudo
// pegarle directo a la API en vivo desde este sandbox, ver limitación de
// red documentada en el doc del proyecto) confirman el slug y, de paso,
// el nombre EXACTO que ESPN usa para cada club (importante: no siempre es
// el nombre completo — ver diccionarioEquipos.js, sección Eredivisie).
const LIGAS_SOCCER = [
  { slug: 'eng.1', nombre: 'Premier League' },
  { slug: 'esp.1', nombre: 'La Liga' },
  { slug: 'ita.1', nombre: 'Serie A' },
  { slug: 'ger.1', nombre: 'Bundesliga' },
  { slug: 'fra.1', nombre: 'Ligue 1' },
  { slug: 'mex.1', nombre: 'Liga MX' },
  { slug: 'usa.1', nombre: 'MLS' },
  { slug: 'uefa.champions', nombre: 'UEFA Champions League' },
  { slug: 'uefa.europa', nombre: 'UEFA Europa League' },
  { slug: 'uefa.europa.conf', nombre: 'UEFA Conference League' },
  { slug: 'conmebol.libertadores', nombre: 'Copa Libertadores' },
  { slug: 'conmebol.sudamericana', nombre: 'Copa Sudamericana' },
  { slug: 'ned.1', nombre: 'Eredivisie' }
];

async function obtenerResultadosDeLiga(slug, nombreLiga, fechaCompacta) {
  const datos = {};
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/' + slug + '/scoreboard?dates=' + fechaCompacta);
    const json = await res.json();

    (json.events || []).forEach(ev => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return;

      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      if (!home || !away || !home.team || !away.team) return;

      const tipoEstado = (comp.status && comp.status.type) || {};
      const finalizado = tipoEstado.completed === true;
      const suspendido = !finalizado && /suspend|postpon|cancel|abandon/i.test(tipoEstado.description || tipoEstado.name || '');

      const homeScore = Number(home.score) || 0;
      const awayScore = Number(away.score) || 0;
      const periodo = (comp.status && comp.status.period) || 0;

      const info = {
        deporte: 'soccer',
        liga: nombreLiga,
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore,
        awayScore,
        totalScore: homeScore + awayScore,
        finalizado,
        suspendido,
        homeTeamLogo: home.team.logo || null,
        awayTeamLogo: away.team.logo || null,
        enVivo: {
          idJuego: ev.id,
          estadoDetallado: tipoEstado.description || '',
          estadoAbstracto: tipoEstado.state || '',
          horaInicioUTC: ev.date || null,
          periodo,
          periodoTexto: periodoATexto(periodo, tipoEstado.state),
          relojTexto: (comp.status && comp.status.displayClock) || ''
        }
      };

      // Si 2 ligas distintas tuvieran, el mismo día, un equipo con el
      // MISMO nombre exacto (raro, pero no imposible con clubes chicos),
      // el último que se procese pisaría al anterior — no se resuelve acá
      // a propósito (mismo criterio que MLB/NFL: el diccionario de equipos
      // es lo que decide a qué deporte/torneo pertenece un apodo, y esto
      // es solo el mapa de resultados por nombre oficial).
      datos[home.team.displayName.toLowerCase()] = info;
      datos[away.team.displayName.toLowerCase()] = info;
    });
  } catch (e) {
    console.error('Error al conectar con la API de fútbol (ESPN, liga ' + slug + '):', e);
  }
  return datos;
}

function periodoATexto(periodo, estadoAbstracto) {
  if (estadoAbstracto === 'pre' || !periodo) return '';
  const nombres = { 1: '1er tiempo', 2: '2do tiempo' };
  return nombres[periodo] || 'Tiempo extra';
}

// "1h" (primera mitad, 31-08-2026): ESPN no trae ningún desglose de
// marcador por mitad (verificado antes de buscar otra fuente), así que
// el marcador de la 1ra mitad se pide APARTE, a football-data.org (ver
// footballDataApi.js — solo cubre 6 de las 10 ligas de acá) y se cruza
// con los juegos de ESPN por NOMBRE DE EQUIPO, porque las 2 APIs no
// comparten ningún ID en común.
//
// Los nombres de equipo NO son idénticos entre las 2 fuentes (ESPN usa
// nombres cortos tipo "Napoli"; football-data.org usa el nombre oficial,
// a veces con sufijo tipo "FC"/"CF"/"SSC") — por eso este match es
// FLEXIBLE (normaliza, saca sufijos y compara por palabra — ver
// nombresDeEquipoCoinciden más abajo), no un "===" exacto. Puede fallar
// en algún club con un nombre muy distinto entre las 2 APIs — si eso
// pasa, esa jugada de "1h" simplemente se queda sin datos (PENDIENTE,
// como si la liga no tuviera "1h" todavía), nunca inventa un cruce
// incorrecto a medias.
const SUFIJOS_CLUB = /\b(fc|cf|ac|ssc|afc|cd|ud|sv|vfl|tsg|ss|as|rc|sc|ec|club|calcio)\b/g;

function normalizarNombreEquipoFutbol(nombre) {
  return (nombre || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos (misma técnica que ya usa normalizarTexto())
    .replace(SUFIJOS_CLUB, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Compara palabra por palabra (no letra por letra) para casos como
// "Inter Milan" (ESPN) vs "Internazionale Milano" (nombre más formal que
// suele usar football-data.org): ninguna de las 2 palabras es IDÉNTICA a
// su par, pero cada una es el PREFIJO de la otra ("inter"/"internazionale",
// "milan"/"milano") — de ahí el startsWith en las 2 direcciones.
function palabraCoincide(palabra, listaDePalabras) {
  return listaDePalabras.some(p => p === palabra || p.startsWith(palabra) || palabra.startsWith(p));
}

// true si, después de normalizar, los 2 nombres son IDÉNTICOS (ej.
// "napoli" === "napoli", después de sacarle el "SSC" a uno de los 2), o
// si TODAS las palabras significativas (4+ letras, para ignorar
// conectores como "de") del nombre más corto tienen una pareja en el más
// largo Y NINGUNO de los 2 se quedó en 1 sola palabra significativa (ej.
// "atletico madrid" adentro de "club atletico de madrid", o "inter
// milan"/"internazionale milano" por prefijo — ver palabraCoincide).
//
// El requisito de "ninguno se queda en 1 sola palabra" es a propósito:
// sin él, "AC Milan" (queda en solo "milan" al sacarle el "AC") pasaría
// como el MISMO equipo que "Inter Milan" con solo compartir el nombre de
// la ciudad — 2 clubes de verdad distintos. Con este requisito, un
// nombre que se reduce a 1 sola palabra SOLO combina si el otro nombre
// es ESA MISMA palabra exacta (cubierto arriba por "a === b"), nunca por
// aparecer adentro de un nombre más largo.
//
// Riesgo conocido, sin resolver del todo: nombres muy distintos entre
// las 2 APIs que no comparten NINGUNA palabra (ej. un acrónimo como
// "PSG" contra "Paris Saint-Germain FC") no se van a cruzar — no se
// intentó resolver esto con un mapa de alias a mano porque no se pudo
// verificar contra una respuesta real de football-data.org en este
// sandbox (ver comentario arriba de este archivo). Pendiente de probar
// con tickets reales una vez que el usuario tenga su clave.
function nombresDeEquipoCoinciden(nombreA, nombreB) {
  const a = normalizarNombreEquipoFutbol(nombreA);
  const b = normalizarNombreEquipoFutbol(nombreB);
  if (!a || !b) return false;
  if (a === b) return true;

  const palabrasA = a.split(' ').filter(p => p.length >= 4);
  const palabrasB = b.split(' ').filter(p => p.length >= 4);
  if (palabrasA.length === 0 || palabrasB.length === 0) return a.includes(b) || b.includes(a);
  if (palabrasA.length === 1 || palabrasB.length === 1) return false;

  const [cortas, largas] = palabrasA.length <= palabrasB.length ? [palabrasA, palabrasB] : [palabrasB, palabrasA];
  return cortas.every(p => palabraCoincide(p, largas));
}

// Cruza cada partido de football-data.org (que trae el marcador de la
// 1ra mitad) contra los juegos YA armados desde ESPN (mapaCombinado,
// cada juego repetido 2 veces: por el nombre local y el visitante) y les
// agrega homeScore1H/awayScore1H/final1H cuando encuentra un match — SE
// EXIGE que local Y visitante coincidan a la vez, para no cruzar mal 2
// partidos distintos que por casualidad compartan un equipo con nombre
// parecido.
//
// CORREGIDO (20-09-2026, caso real: Barcelona/La Liga y Roma/Serie A —
// las 2 ligas SÍ están en LIGAS_CON_PRIMERA_MITAD — quedaron PENDIENTE
// con el mensaje de "puede que esta liga no esté cubierta"): ahora cada
// juego se marca con `motivoSinPrimeraMitad` cuando NO se pudo completar
// el dato de 1h, distinguiendo el motivo real:
//   - 'liga-no-cubierta': el torneo de este partido (`juego.liga`) ni
//     siquiera está en la lista de las 6 ligas que cubre football-data.org
//     (ej. Europa League/Conference League/Liga MX/etc.) — esto SIGUE
//     siendo una limitación real, sin arreglo gratis posible.
//   - 'sin-clave': la liga SÍ está cubierta, pero `FOOTBALL_DATA_API_KEY`
//     no está configurada en el servidor — un problema de CONFIGURACIÓN,
//     no de cobertura, y si es este el motivo, arreglarlo es tan simple
//     como cargar esa variable de entorno en Railway.
//   - 'error-api': la liga SÍ está cubierta y la clave SÍ está puesta,
//     pero football-data.org devolvió un error (clave inválida, límite de
//     pedidos superado, etc. — ver el log del servidor) para ALGUNA de
//     las 6 competencias pedidas ese día.
//   - 'sin-cruce': la liga SÍ está cubierta, la clave SÍ está puesta, la
//     consulta SÍ respondió bien, pero este partido puntual no apareció
//     en la lista de football-data.org para esa fecha, o su nombre de
//     equipo no pudo cruzarse contra el de ESPN (ver
//     nombresDeEquipoCoinciden arriba) — el caso más específico, y el
//     único de los 4 que amerita revisar el club puntual en vez de la
//     configuración del servidor.
// Un juego que SÍ cruzó bien no lleva este campo (queda `undefined`).
function agregarPrimeraMitad(mapaCombinado, primeraMitadInfo) {
  const primeraMitadPorPartido = (primeraMitadInfo && primeraMitadInfo.partidos) || [];
  const claveConfigurada = !!(primeraMitadInfo && primeraMitadInfo.claveConfigurada);
  const huboError = !!(primeraMitadInfo && primeraMitadInfo.huboError);
  const { LIGAS_CON_PRIMERA_MITAD } = require('./footballDataApi'); // require perezoso, mismo motivo que en obtenerResultadosSoccer más abajo
  const nombresLigasCubiertas = LIGAS_CON_PRIMERA_MITAD.map(l => l.nombre);

  const juegosUnicos = new Set(Object.values(mapaCombinado));
  juegosUnicos.forEach(juego => {
    if (!nombresLigasCubiertas.includes(juego.liga)) {
      juego.motivoSinPrimeraMitad = 'liga-no-cubierta';
      return;
    }
    if (!claveConfigurada) {
      juego.motivoSinPrimeraMitad = 'sin-clave';
      return;
    }
    const match = primeraMitadPorPartido.find(pm =>
      (nombresDeEquipoCoinciden(juego.homeTeam, pm.homeTeamName) || nombresDeEquipoCoinciden(juego.homeTeam, pm.homeTeamShortName)) &&
      (nombresDeEquipoCoinciden(juego.awayTeam, pm.awayTeamName) || nombresDeEquipoCoinciden(juego.awayTeam, pm.awayTeamShortName))
    );
    if (match) {
      juego.homeScore1H = match.homeScore1H;
      juego.awayScore1H = match.awayScore1H;
      juego.final1H = match.final1H;
      if (!match.final1H) juego.motivoSinPrimeraMitad = 'sin-cruce'; // el partido cruzó, pero football-data.org todavía no tiene el dato del entretiempo — no es lo mismo que no haber cruzado nunca
      return;
    }
    juego.motivoSinPrimeraMitad = huboError ? 'error-api' : 'sin-cruce';
  });
}

// Pide TODAS las ligas configuradas en paralelo y combina el resultado en
// un solo mapa — si una liga falla (red, endpoint caído), las demás
// siguen funcionando igual (cada obtenerResultadosDeLiga ya atrapa su
// propio error y devuelve un mapa vacío en ese caso). También pide, EN
// PARALELO, el marcador de "1h" a football-data.org (si hay clave
// configurada — ver footballDataApi.js) y lo cruza por nombre de equipo.
async function obtenerResultadosSoccer(fechaISO) {
  const fechaCompacta = (fechaISO || '').replace(/-/g, '');
  const { obtenerPrimeraMitadFutbol } = require('./footballDataApi'); // require perezoso: evita un ciclo de módulos si algún día footballDataApi.js necesitara algo de acá
  const [mapasPorLiga, primeraMitadInfo] = await Promise.all([
    Promise.all(LIGAS_SOCCER.map(liga => obtenerResultadosDeLiga(liga.slug, liga.nombre, fechaCompacta))),
    obtenerPrimeraMitadFutbol(fechaISO).catch(() => ({ partidos: [], claveConfigurada: false, huboError: true }))
  ]);
  const mapaCombinado = Object.assign({}, ...mapasPorLiga);
  agregarPrimeraMitad(mapaCombinado, primeraMitadInfo);
  return mapaCombinado;
}

module.exports = { obtenerResultadosSoccer, LIGAS_SOCCER, nombresDeEquipoCoinciden };
