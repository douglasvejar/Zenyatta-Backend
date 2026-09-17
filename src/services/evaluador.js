// =================================================================
// EVALUADOR DE JUGADAS — multi-deporte (hándicap/línea, over/under y
// moneyline), a partir del 28-08-2026.
// =================================================================
// Hasta ahora esto solo sabía evaluar MLB. Se generalizó en 2 piezas:
//
// 1. evaluarConEquipoYConfig(): el núcleo de la lógica (buscar el juego,
//    ver si ya terminó, resolver over/under o hándicap/moneyline) —
//    IDÉNTICO al que ya existía para MLB, solo que ahora recibe por
//    parámetro qué tan grande puede ser "una línea real" antes de
//    confundirse con una cuota americana (ver CONFIG_POR_DEPORTE) y en
//    qué campos del objeto del juego vienen los puntos de cada equipo.
// 2. evaluarJugada(): el punto de entrada nuevo, que YA NO asume que todo
//    es MLB — busca el equipo en el diccionario (como siempre), lee el
//    campo `deporte` que ese equipo tiene guardado (viene del diccionario
//    de 3 capas: base/global/personalizado), y con eso decide SOLO ahí
//    contra qué API evaluar y con qué reglas. Así, en una misma sábana,
//    el Ticket 1 puede ser de MLB y el Ticket 2 de NFL sin que nadie
//    tenga que indicarlo a mano — cada jugada se resuelve con los datos
//    de SU propio deporte.
//
// evaluarJugadaMLB() se dejó tal cual estaba (mismo nombre, misma firma)
// para no romper nada que ya la llamara directo (ej. las pruebas
// automatizadas) — por dentro ahora es un atajo de evaluarJugada() para
// un solo deporte, pero el resultado es exactamente el mismo de antes.
//
// 31-08-2026 (a pedido del usuario): 2 agregados más, buscar
// "permiteApuestaEmpate" y "usaPrimeraMitad"/"1h" en este archivo —
// (1) apuesta AL EMPATE como su propio tipo de jugada (fútbol y NFL); y
// (2) "1h" (primera mitad) generalizado desde lo que antes era "5inn"
// (exclusivo de MLB) para que también lo reconozca NFL. Fútbol se dejó
// pendiente por ahora: la API de ESPN no expone ningún desglose de
// marcador por mitad/tiempo (verificado antes de tocar código).
const { buscarJuegoPorNombre } = require('./mlbApi'); // 100% genérica (solo busca por nombre de equipo) — se reutiliza tal cual para cualquier deporte.
const { detectarMarcadorDeporteEnTexto } = require('./parser'); // emoji/palabra clave por-jugada, ver parser.js

// Qué tan grande puede llegar a ser "una línea real" (el número de la
// apuesta) en cada deporte, para no confundirla con una cuota americana
// (que SIEMPRE tiene 100 de magnitud para arriba, en cualquier deporte).
// Ej: en MLB una línea de hándicap (run line) nunca pasa de 5.5 carreras,
// pero en NFL un margen de puntos sí puede llegar a 20+ — por eso cada
// deporte necesita su propio techo, no uno solo para todos.
// "Primera mitad" (31-08-2026, a pedido del usuario): igual que "5inn" ya
// existía SOLO para MLB (primeras 5 entradas), ahora "1h" hace lo mismo
// para cualquier deporte que lo tenga habilitado (usaPrimeraMitad) — el
// usuario confirmó que en MLB "1h" significa exactamente lo mismo que ya
// existía como "5inn"/"5to" (mismos campos de datos, sin tocar nada de
// MLB), y que en NFL "1h" es el marcador acumulado de los primeros 2
// cuartos (verificado que la API de ESPN para NFL sí trae ese desglose
// por cuarto en competitors[].linescores — ver nflApi.js). Fútbol
// (agregado más tarde, mismo día): la API de ESPN NO expone ningún
// desglose de marcador por tiempo/mitad (verificado antes de buscar otra
// fuente) — así que el "1h" de fútbol viene de football-data.org, cruzado
// por nombre de equipo en soccerApi.js, y SOLO cubre 6 de las 10
// competiciones (las del plan gratis de esa API: Premier League, La
// Liga, Serie A, Bundesliga, Ligue 1, Champions League). Liga MX, MLS,
// Copa Libertadores y Copa Sudamericana quedan pendientes — la fuente
// elegida para esas 4 (api-football.com) no se pudo verificar en este
// sandbox (documentación armada con JavaScript, no se pudo leer con las
// herramientas de búsqueda web disponibles acá — ver doc del proyecto).
// Baloncesto no está en esta lista porque no es un deporte conectado
// todavía (el usuario confirmó que no hace falta agregarlo ahora).
const CONFIG_POR_DEPORTE = {
  mlb: {
    unidadMarcador: 'carreras totales',
    usaPrimeraMitad: true,
    textoPrimeraMitad: ' (5 innings)',
    rangoLineaMax: 20,      // over/under: total de carreras del juego
    rangoHandicapMax: 5.5,  // hándicap (run line)
    campoHomeTotal: 'homeRuns',
    campoAwayTotal: 'awayRuns',
    campoHomePrimeraMitad: 'home5innRuns',
    campoAwayPrimeraMitad: 'away5innRuns',
    campoFinalPrimeraMitad: 'final5inn',
    // Doble juego (05-09-2026, a pedido del usuario: "hay dias en la mlb
    // que los equipos juegan 2 veces... el juego 2 puede venir como G2 o
    // GM2 o g2 o gm o juego2") — SOLO MLB tiene esto habilitado a
    // propósito: es el único deporte de este sistema donde el mismo
    // equipo puede jugar 2 veces en la misma fecha (doble juego/
    // doubleheader) — ver detectarNumeroJuegoEnJugada() y la nota grande
    // en mlbApi.js sobre cómo se guardan los 2 juegos por separado.
    usaDobleJuego: true
  },
  nfl: {
    unidadMarcador: 'puntos totales',
    usaPrimeraMitad: true,
    textoPrimeraMitad: ' (1ra mitad)',
    rangoLineaMax: 100,     // over/under: total de puntos del juego
    rangoHandicapMax: 60,   // hándicap (margen de puntos / spread)
    campoHomeTotal: 'homeScore',
    campoAwayTotal: 'awayScore',
    campoHomePrimeraMitad: 'homeScore1H',
    campoAwayPrimeraMitad: 'awayScore1H',
    campoFinalPrimeraMitad: 'final1H',
    // Apuesta al empate (31-08-2026): rarísimo en NFL (un partido de
    // temporada regular casi nunca termina empatado), pero el usuario
    // pidió que se reconozca igual por si acaso llega una jugada así.
    permiteApuestaEmpate: true
  },
  // NHL y fútbol agregados el 28-08-2026, a pedido explícito del usuario.
  nhl: {
    unidadMarcador: 'goles totales',
    usaPrimeraMitad: false,
    rangoLineaMax: 12,      // over/under: total de goles del juego (la línea típica es 4.5-7.5)
    rangoHandicapMax: 2.5,  // hándicap (puck line, típicamente ±1.5)
    campoHomeTotal: 'homeScore',
    campoAwayTotal: 'awayScore',
    // Sin apuesta al empate: la NHL no termina en empate (tiempo extra +
    // shootout hasta que haya un ganador), así que no aplica.
    //
    // "Por período" (31-08-2026, a pedido del usuario — ver el comentario
    // grande sobre "usaCuartos" más abajo): NHL se juega en 3 períodos, NO
    // 4 cuartos — el usuario le dice "cuarto" a cada período (ej. "Panthers
    // over 1Q"), así que acá adentro se acepta esa palabra igual, pero
    // `cantidadCuartos: 3` asegura que nunca se intente leer un "4to
    // cuarto" que no existe en este deporte.
    usaCuartos: true,
    cantidadCuartos: 3,
    nombreSegmento: 'período',
    campoLinescoresHome: 'homeLinescores',
    campoLinescoresAway: 'awayLinescores',
    campoCuartosCompletos: 'cuartosCompletos'
  },
  soccer: {
    unidadMarcador: 'goles totales',
    // "1h" en fútbol (31-08-2026): la API de ESPN (soccerApi.js) no trae
    // ningún desglose por mitad, así que este dato viene de OTRA fuente
    // (football-data.org, ver footballDataApi.js) que soccerApi.js cruza
    // por nombre de equipo antes de devolver cada juego — por eso acá
    // usaPrimeraMitad ya es true (el MECANISMO está listo), pero solo
    // funciona de verdad para 6 de las 10 competiciones (las que cubre el
    // plan gratis de esa API) Y solo si el usuario configuró su clave
    // (FOOTBALL_DATA_API_KEY). Si el juego no tiene el campo
    // campoFinalPrimeraMitad (liga sin cobertura, sin clave, o no se pudo
    // cruzar el nombre del equipo), esto queda igual que antes: PENDIENTE,
    // nunca inventa un resultado.
    usaPrimeraMitad: true,
    textoPrimeraMitad: ' (1er tiempo)',
    rangoLineaMax: 12,      // over/under: total de goles del partido (la línea típica es 0.5-5.5)
    rangoHandicapMax: 4.5,  // hándicap asiático/europeo
    campoHomeTotal: 'homeScore',
    campoAwayTotal: 'awayScore',
    campoHomePrimeraMitad: 'homeScore1H',
    campoAwayPrimeraMitad: 'awayScore1H',
    campoFinalPrimeraMitad: 'final1H',
    // ÚNICO entre todos los deportes de acá: si el cliente apostó a que un
    // equipo GANA (moneyline puro, hándicap 0 — no "doble oportunidad" ni
    // "empate no va") y el partido termina empatado, esa apuesta se cuenta
    // como PERDIDA, no como push/ANULADA — confirmado por el usuario el
    // 27-08-2026 (ver "Reglas de apuestas" en el doc de proyecto). En
    // NFL/MLB/NHL un empate en moneyline (hándicap 0) sigue siendo push.
    empatEsPerdidaEnMoneyline: true,
    // Apuesta al empate (31-08-2026, a pedido del usuario — ya hay
    // jugadas reales de su grupo que apuestan directo al empate, ej.
    // "Napoli E (+201)" o "Napoli empate +201"): esto es DISTINTO de
    // empatEsPerdidaEnMoneyline de arriba (esa regla es para cuando el
    // cliente apostó a que un EQUIPO gana y el partido empata; acá el
    // cliente apostó AL empate mismo, con su propia cuota).
    permiteApuestaEmpate: true
  },
  // NBA agregada el 31-08-2026, a pedido explícito del usuario ("agrega la
  // funcionalidad que ya esta con nfl, futbol, mlb y nhl, con nba") — mismo
  // patrón exacto que los demás deportes: conector nuevo (nbaApi.js),
  // diccionario de equipos en la misma entrega (ver
  // DICCIONARIO_EQUIPOS_NBA_BASE en diccionarioEquipos.js), y su propia
  // entrada acá.
  //
  // CORREGIDO el mismo día (31-08-2026): la primera versión le puso a NBA
  // "por cuarto" individual (usaCuartos, igual que NHL) — el usuario aclaró
  // que eso está MAL: en NBA solo se apuesta por 1ra mitad (cuartos 1+2),
  // 2da mitad (cuartos 3+4) o el juego completo, NUNCA por un cuarto suelto
  // (a diferencia de NHL, que SÍ se apuesta por período individual — ver
  // más abajo en la función evaluarConEquipoYConfig el comentario grande
  // sobre "usaCuartos", que sigue existiendo solo para NHL). Por eso acá
  // NO hay "usaCuartos" — en cambio, "usaPrimeraMitad" (mecanismo ya
  // existente, mismo que MLB "5inn"/NFL "1h") y "usaSegundaMitad" (nuevo,
  // mismo mecanismo pero para el segundo tiempo, cuartos 3+4).
  basket: {
    unidadMarcador: 'puntos totales',
    rangoLineaMax: 300,     // over/under: total de puntos del juego (un total típico de NBA ronda 210-240)
    rangoHandicapMax: 30,   // hándicap (spread de puntos, rara vez pasa de 20)
    campoHomeTotal: 'homeScore',
    campoAwayTotal: 'awayScore',
    usaPrimeraMitad: true,
    textoPrimeraMitad: ' (1ra mitad)',
    campoHomePrimeraMitad: 'homeScore1H',
    campoAwayPrimeraMitad: 'awayScore1H',
    campoFinalPrimeraMitad: 'final1H',
    usaSegundaMitad: true,
    textoSegundaMitad: ' (2da mitad)',
    campoHomeSegundaMitad: 'homeScore2H',
    campoAwaySegundaMitad: 'awayScore2H',
    campoFinalSegundaMitad: 'final2H'
    // Sin apuesta al empate: NBA no termina en empate (tiempo extra hasta
    // que haya un ganador), así que no aplica — mismo criterio que NHL.
  },
  // NCAAF (fútbol americano universitario) agregada el 12-09-2026, a pedido
  // explícito del usuario ("crees que puedas agregar una api para ncaaf?
  // existe?") — mismo día que se arregló el bug real de "Miami Florida"
  // quedando SIN_MAPEO en vez de PENDIENTE (ver la nota grande más abajo en
  // la rama "!config"). Con esta entrada, 'ncaaf' YA tiene config — esa
  // rama deja de aplicarle a NCAAF (queda para cualquier OTRO deporte que
  // en el futuro se agregue al diccionario sin su API todavía, igual que
  // pasó con NCAAF hasta hoy).
  //
  // Mismos parámetros que NFL (4 cuartos, 1ra mitad = cuartos 1+2, mismo
  // conector — ver ncaafApi.js, misma API de ESPN cambiando solo la ruta):
  // NCAAF juega bajo las mismas reglas de reloj que la NFL. Única
  // diferencia real: SIN apuesta al empate — a diferencia de la NFL (donde
  // un empate en temporada regular es rarísimo pero posible), la NCAA
  // exige tiempo extra hasta que haya un ganador desde 1996, así que un
  // ticket que apueste "al empate" en NCAAF no tiene sentido y no se
  // reconoce (si llegara a pasar, queda como cualquier jugada no
  // reconocida, no como una regla nueva a mantener).
  ncaaf: {
    unidadMarcador: 'puntos totales',
    usaPrimeraMitad: true,
    textoPrimeraMitad: ' (1ra mitad)',
    rangoLineaMax: 100,     // over/under: total de puntos del juego (igual techo que NFL)
    rangoHandicapMax: 60,   // hándicap (spread) — en NCAAF puede ser más grande que en NFL por la diferencia de nivel entre programas, pero el mismo techo de NFL ya cubre los casos reales
    campoHomeTotal: 'homeScore',
    campoAwayTotal: 'awayScore',
    campoHomePrimeraMitad: 'homeScore1H',
    campoAwayPrimeraMitad: 'awayScore1H',
    campoFinalPrimeraMitad: 'final1H',
    permiteApuestaEmpate: false
  }
};

// =================================================================
// "POR CUARTO" (31-08-2026, a pedido del usuario, con un ticket real:
// "Panthers over 1Q 3 -120" = alta de 3 goles en el 1er cuarto/período) —
// SOLO para NHL (3 períodos, a los que el usuario y sus clientes les dicen
// "cuarto" igual — ver CONFIG_POR_DEPORTE.nhl, usaCuartos). NBA NO usa
// esto: el usuario aclaró que en NBA solo se apuesta por 1ra mitad, 2da
// mitad o juego completo, nunca por un cuarto individual suelto — ver
// CONFIG_POR_DEPORTE.basket (usaPrimeraMitad/usaSegundaMitad) más arriba.
// La función de acá queda genérica por si algún día otro deporte SÍ
// apuesta por segmento individual, pero hoy el único caso real es NHL.
// Reconoce el número de segmento
// pedido en 3 formas, todas confirmadas contra ejemplos reales del
// usuario:
//   - "1q"/"2q"/"3q"/"4q" (número pegado a la letra "q")
//   - "1 cuarto"/"1er cuarto"/"2do cuarto"/... (o la misma idea con
//     "período"/"periodo", para cuando alguien SÍ usa la palabra correcta
//     de hockey)
//   - la forma ordinal en palabras: "primer cuarto"/"segundo período"/etc.
// Devuelve el número de cuarto/período pedido (1 en adelante) o null si la
// jugada no menciona ninguno — NO valida acá si ese número existe de
// verdad para el deporte resuelto (eso lo hace evaluarConEquipoYConfig,
// que ya sabe cuántos cuartos/períodos tiene ese deporte en particular).
const ORDINALES_CUARTO = {
  primer: 1, primero: 1,
  segundo: 2,
  tercer: 3, tercero: 3,
  cuarto: 4,
  ultimo: 4 // "último cuarto" — sin acento acá porque se le saca el acento antes de buscar en este mapa
};

function detectarCuartoEnJugada(lineaJugada) {
  const porLetraQ = lineaJugada.match(/\b([1-4])\s*q\b/i);
  if (porLetraQ) return parseInt(porLetraQ[1], 10);

  const porNumeroPalabra = lineaJugada.match(/\b([1-4])\s*(?:er|do|to|ro|ra)?\s*(?:cuartos?|per[ií]odos?)\b/i);
  if (porNumeroPalabra) return parseInt(porNumeroPalabra[1], 10);

  const porOrdinal = lineaJugada.match(/\b(primer|primero|segundo|tercer|tercero|cuarto|ultimo|último)\s+(?:cuarto|per[ií]odo)\b/i);
  if (porOrdinal) {
    const palabraSinAcento = porOrdinal[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return ORDINALES_CUARTO[palabraSinAcento] || null;
  }

  return null;
}

// Doble juego / doubleheader (05-09-2026, a pedido del usuario, con un
// ticket real: "Tigers G2 (+120)" — Detroit jugó 2 veces esa fecha, y esta
// jugada es puntualmente del 2do juego). Reconoce el número de juego
// pedido en las formas que el usuario confirmó que se usan: "G1"/"G2"
// (letra sola pegada al número), "GM1"/"GM2" (con la "M" de más), y
// "juego1"/"juego 1"/"juego2"/"juego 2" (con o sin espacio) — todas
// case-insensitive ("g2" funciona igual que "G2"). Solo tiene sentido
// para MLB (ver CONFIG_POR_DEPORTE.mlb.usaDobleJuego) — es el único
// deporte de este sistema donde el mismo equipo puede tener 2 partidos
// distintos la MISMA fecha. Sin ningún marcador, se sigue asumiendo el
// juego 1 (o el único juego del día, el caso de siempre) — ver la nota
// grande en mlbApi.js sobre por qué el juego 1 quedó como el valor por
// defecto y no el último juego procesado (como pasaba antes, sin querer).
function detectarNumeroJuegoEnJugada(lineaJugada) {
  const porLetraG = lineaJugada.match(/\bgm?\s*([12])\b/i);
  if (porLetraG) return parseInt(porLetraG[1], 10);

  const porPalabraJuego = lineaJugada.match(/\bjuego\s*([12])\b/i);
  if (porPalabraJuego) return parseInt(porPalabraJuego[1], 10);

  return null;
}

// Saca del texto TODOS los marcadores de segmento reconocidos (5inn/1h/
// cuarto/período/doble juego) antes de extraer números de línea/cuota —
// mismo criterio que ya existía para "5inn"/"1h" (evita que el "1" de
// "1h", el "3" de "3er cuarto", o el "2" de "G2"/"juego2" se cuelen como
// si fueran la línea o el hándicap de la jugada), ahora en un solo lugar
// para no repetir la lista varias veces.
function limpiarMarcadoresSegmento(lineaJugada) {
  return lineaJugada
    .replace(/5inn/gi, ' ')
    .replace(/\b1h\b/gi, ' ')
    .replace(/\b2h\b/gi, ' ') // "2da mitad" (31-08-2026, NBA) — mismo criterio que "1h"
    .replace(/\b[1-4]\s*q\b/gi, ' ')
    .replace(/\b[1-4]\s*(?:er|do|to|ro|ra)?\s*(?:cuartos?|per[ií]odos?)\b/gi, ' ')
    .replace(/\b(?:primer|primero|segundo|tercer|tercero|cuarto|ultimo|último)\s+(?:cuarto|per[ií]odo)\b/gi, ' ')
    .replace(/\bgm?\s*[12]\b/gi, ' ') // "G1"/"G2"/"GM1"/"GM2" (05-09-2026, doble juego de MLB)
    .replace(/\bjuego\s*[12]\b/gi, ' '); // "juego1"/"juego 2" (mismo caso, la otra forma de escribirlo)
}

// Núcleo compartido: recibe el equipo YA resuelto (infoEquipo/apodo) y la
// config de SU deporte, y decide GANADA/PERDIDA/ANULADA/PENDIENTE/etc.
// contra los datos de ese juego. No sabe nada de "de dónde salió" el
// deporte — eso lo decide evaluarJugada() antes de llamar acá.
function evaluarConEquipoYConfig(lineaJugada, datosDeporte, infoEquipo, apodoEncontrado, config) {
  // Doble juego (05-09-2026): ver la nota grande junto a
  // detectarNumeroJuegoEnJugada() más arriba — SOLO se busca este marcador
  // si el deporte lo tiene habilitado (hoy, únicamente MLB).
  const numeroJuegoPedido = config.usaDobleJuego ? detectarNumeroJuegoEnJugada(lineaJugada) : null;
  const juego = buscarJuegoPorNombre(datosDeporte, infoEquipo.nombre, numeroJuegoPedido);

  const debugBase = {
    pata: lineaJugada,
    apodoDetectado: apodoEncontrado,
    equipoOficial: infoEquipo.nombre
  };

  if (!juego) {
    // Si se pidió puntualmente un juego (ej. "G2") y ESE juego no está en
    // los datos (no hubo doble juego esa fecha, o todavía no arrancó/no
    // está en la API), el motivo es distinto de "no juega hoy" — para no
    // confundir al usuario pidiéndole que revise algo que no tiene nada
    // que ver.
    const razon = numeroJuegoPedido
      ? ('No se encontró el juego ' + numeroJuegoPedido + ' de ' + infoEquipo.nombre + ' para esta fecha (¿hubo doble juego de verdad ese día?)')
      : 'Partido no encontrado en la API';
    return { estado: 'PENDIENTE', razon, debug: debugBase };
  }

  // Logo del equipo detectado, si la API de ese deporte lo trae directo en
  // la respuesta del marcador (NFL sí, MLB no — MLB arma sus logos aparte
  // en el frontend a partir del nombre oficial, ver logoEquipoHTML en
  // app.js). Si no hay logo disponible acá, se deja sin definir y el
  // frontend hace su propio fallback.
  const mascotaEquipo = infoEquipo.nombre.toLowerCase().split(' ').pop();
  const esHome = juego.homeTeam.toLowerCase().split(' ').pop() === mascotaEquipo;
  const logoUrl = esHome ? juego.homeTeamLogo : juego.awayTeamLogo;
  if (logoUrl) debugBase.logoUrl = logoUrl;

  // "5inn"/"5to" es la palabra histórica de MLB; "1h" es la nueva palabra
  // genérica de "primera mitad" que ahora también reconocen NFL (y, más
  // adelante, fútbol — ver el comentario sobre CONFIG_POR_DEPORTE arriba).
  const esPrimeraMitad = config.usaPrimeraMitad && (lineaJugada.includes('5inn') || /\b1h\b/.test(lineaJugada));

  // "2h"/"2da mitad" (31-08-2026, agregado para NBA — ver
  // CONFIG_POR_DEPORTE.basket): mismo mecanismo que "1h", pero para el
  // segundo tiempo (cuartos 3+4 en NBA). Solo lo tienen habilitado los
  // deportes con "usaSegundaMitad: true" en su config.
  const esSegundaMitad = !!config.usaSegundaMitad && /\b2h\b/.test(lineaJugada);

  // "Por cuarto" (31-08-2026): a diferencia de "1h"/"2h" (un solo segmento fijo,
  // la primera mitad), acá la jugada puede pedir CUALQUIER cuarto/período
  // numerado — ver detectarCuartoEnJugada() arriba. Esto se calcula SIEMPRE
  // (sin importar si el deporte resuelto realmente soporta cuartos) porque
  // hace falta para la guarda de seguridad de abajo: si la jugada menciona
  // un cuarto pero el deporte no lo soporta, NUNCA hay que adivinar
  // evaluándola como juego completo (ej. "Panthers over 1Q 3" resuelto por
  // error a Carolina Panthers/NFL, que no tiene cuartos habilitados, NO
  // puede terminar evaluando "3 puntos totales" contra el marcador
  // completo del partido — eso sería casi siempre PERDIDA por error).
  const numeroCuartoEnTexto = detectarCuartoEnJugada(lineaJugada);
  if (numeroCuartoEnTexto !== null && !config.usaCuartos) {
    // Mensaje distinto según el motivo real (31-08-2026): un deporte con
    // "usaPrimeraMitad"/"usaSegundaMitad" habilitado (ej. NBA) SÍ apuesta
    // por segmento, solo que no por cuarto individual suelto — el mensaje
    // sugiere "1h"/"2h" en vez de sonar a que hace falta esperar a que se
    // conecte algo. Cualquier otro deporte (ej. MLB, sin ningún tipo de
    // segmento de cuarto) mantiene el mensaje genérico de siempre, para
    // cubrir también el caso de un apodo resuelto al deporte equivocado
    // (ej. "Panthers" resuelto por error a Carolina Panthers/NFL).
    const razon = (config.usaPrimeraMitad || config.usaSegundaMitad)
      ? ('Esta jugada menciona un cuarto/período ("' + numeroCuartoEnTexto + '") individual, pero este deporte no se apuesta por cuarto suelto — solo por 1ra mitad ("1h"), 2da mitad ("2h") o juego completo.')
      : ('Esta jugada menciona un cuarto/período ("' + numeroCuartoEnTexto + '"), pero este deporte todavía no tiene la apuesta por cuartos/períodos habilitada — revisar a qué equipo/deporte se resolvió esta jugada.');
    return { estado: 'PENDIENTE', razon, debug: debugBase };
  }
  const esPorCuarto = !!config.usaCuartos && numeroCuartoEnTexto !== null;
  if (esPorCuarto && numeroCuartoEnTexto > config.cantidadCuartos) {
    return {
      estado: 'PENDIENTE',
      razon: 'Este deporte no tiene un ' + numeroCuartoEnTexto + 'to ' + (config.nombreSegmento || 'cuarto') + ' (solo tiene ' + config.cantidadCuartos + ') — revisar la jugada.',
      debug: debugBase
    };
  }

  let partidoListoParaEstaJugada;
  if (esPorCuarto) {
    partidoListoParaEstaJugada = (juego[config.campoCuartosCompletos] || 0) >= numeroCuartoEnTexto;
  } else if (esSegundaMitad) {
    partidoListoParaEstaJugada = juego[config.campoFinalSegundaMitad];
  } else if (esPrimeraMitad) {
    partidoListoParaEstaJugada = juego[config.campoFinalPrimeraMitad];
  } else {
    partidoListoParaEstaJugada = juego.finalizado;
  }

  if (!partidoListoParaEstaJugada) {
    if (juego.suspendido) {
      return {
        estado: 'SUSPENDIDA',
        razon: 'El juego quedó suspendido o pospuesto — revisar cuándo se reanuda o se repite',
        debug: debugBase
      };
    }

    // (17-09-2026, a pedido del usuario con un ticket real de fútbol:
    // "Por que me da este error en futbol si ya el juego termino... esto
    // es futbol europa league y la liga de españa" — el mismo partido, en
    // su línea de juego COMPLETO, ya se había evaluado GANADA, o sea el
    // partido SÍ había terminado) — hasta acá, si el dato del segmento
    // (1h/2h, ver campoFinalPrimeraMitad/campoFinalSegundaMitad arriba)
    // todavía no estaba listo, el motivo SIEMPRE decía "aún no ha
    // terminado" sin importar si el PARTIDO COMPLETO ya había terminado o
    // no — literalmente falso en ese caso, y confuso: sonaba a que solo
    // hacía falta esperar más. En fútbol, el dato de 1h/2h viene de OTRA
    // fuente aparte del marcador final (football-data.org, ver el
    // comentario grande en CONFIG_POR_DEPORTE.soccer/footballDataApi.js),
    // que solo cubre 6 de las 10 competiciones que evalúa este sistema
    // (Premier League, La Liga, Serie A, Bundesliga, Ligue 1 y Champions
    // League — CONFIRMADO que la Europa League/Conference League NO están
    // en el plan gratis de esa API, ni en 2026) — si el partido es de una
    // liga sin cobertura, ese dato NUNCA va a llegar solo, por más que se
    // espere. Ahora se distingue: si el PARTIDO COMPLETO ya terminó pero
    // falta el dato del segmento, el motivo lo dice tal cual (y avisa que
    // puede hacer falta resolverlo a mano), en vez de sonar a que el
    // partido sigue en curso.
    if (juego.finalizado && (esPrimeraMitad || esSegundaMitad)) {
      return {
        estado: 'PENDIENTE',
        razon: 'El partido ya terminó, pero todavía no hay datos de ' + (esSegundaMitad ? 'la segunda mitad' : 'la primera mitad') + ' para poder resolver esta jugada — puede que esta liga/competición no tenga ese dato disponible (ej. en fútbol, la Europa League y la Conference League no están cubiertas); si sigue así, revisar y resolver a mano.',
        debug: debugBase
      };
    }

    return {
      estado: 'PENDIENTE',
      razon: esPorCuarto
        ? ('El ' + numeroCuartoEnTexto + 'to ' + (config.nombreSegmento || 'cuarto') + ' todavía no ha terminado')
        : esSegundaMitad
          ? 'La segunda mitad todavía no ha terminado'
          : (esPrimeraMitad
              ? (lineaJugada.includes('5inn') ? 'Las primeras 5 entradas todavía no han terminado' : 'La primera mitad todavía no ha terminado')
              : 'En juego o no iniciado'),
      debug: debugBase
    };
  }

  // Texto para las etiquetas de debug/Pizarra de acá en adelante — un solo
  // lugar en vez de repetir el ternario esPrimeraMitad en cada tipo de
  // apuesta (over/under y hándicap/moneyline).
  const textoSegmento = esPorCuarto
    ? (' (' + numeroCuartoEnTexto + 'to ' + (config.nombreSegmento || 'cuarto') + ')')
    : esSegundaMitad
      ? (config.textoSegundaMitad || ' (segunda mitad)')
      : (esPrimeraMitad ? (config.textoPrimeraMitad || ' (primera mitad)') : ' (juego completo)');

  // Apuesta AL EMPATE (31-08-2026, a pedido del usuario): el cliente
  // apuesta directamente a que el PARTIDO termine empatado, con su propia
  // cuota — se escribe como "E (+201)" o "empate +201" junto al nombre de
  // un equipo del partido (ej. "Napoli E (+201)"). Es un tipo de apuesta
  // totalmente aparte de alta/baja y de hándicap/moneyline (no importa
  // ningún hándicap ni margen, solo si el marcador final quedó igual), así
  // que se resuelve ACÁ, antes de esas dos ramas, y siempre con el
  // marcador COMPLETO del partido (no el de "1h"/primera mitad).
  // Distinto de `empatEsPerdidaEnMoneyline` (arriba en CONFIG_POR_DEPORTE):
  // esa regla es para cuando el cliente apostó a que un EQUIPO gana y el
  // partido empata; acá el cliente apostó AL empate mismo.
  // Nota: en un partido de eliminatoria que se define por tiempo extra o
  // penales (ej. octavos de Champions League), esto usa el resultado que
  // la API marca como "finalizado", que puede no ser el empate en los 90
  // minutos — no se pudo verificar este caso puntual contra la API real.
  const marcaEmpatePorLetraE = /\be\b\s*\(?[+-]\d{3,}\)?/i.test(lineaJugada);
  const marcaEmpatePorPalabra = /\bempate\b/i.test(lineaJugada);
  if (config.permiteApuestaEmpate && (marcaEmpatePorLetraE || marcaEmpatePorPalabra)) {
    const homeFinal = juego[config.campoHomeTotal];
    const awayFinal = juego[config.campoAwayTotal];
    const debugEmpate = {
      ...debugBase,
      tipoApuesta: 'EMPATE (a que el partido termine igualado)',
      marcadorUsado: homeFinal + ' - ' + awayFinal
    };
    if (homeFinal === awayFinal) return { estado: 'GANADA', debug: debugEmpate };
    return { estado: 'PERDIDA', debug: debugEmpate };
  }

  const esOver = /(over|alta|altas)/i.test(lineaJugada);
  const esUnder = /(under|baja|bajas)/i.test(lineaJugada);

  if (esOver || esUnder) {
    const limpiaSinSegmento = limpiarMarcadoresSegmento(lineaJugada);
    const numeros = limpiaSinSegmento.match(/\d+(?:\.\d+)?/g);
    let linea = null;

    if (numeros) {
      const candidato = numeros.map(parseFloat).find(n => n > 0 && n <= config.rangoLineaMax);
      if (candidato !== undefined) linea = candidato;
    }

    if (linea !== null) {
      const puntos = esPorCuarto
        ? (((juego[config.campoLinescoresHome] || [])[numeroCuartoEnTexto - 1] || 0) + ((juego[config.campoLinescoresAway] || [])[numeroCuartoEnTexto - 1] || 0))
        : esSegundaMitad
          ? (juego[config.campoHomeSegundaMitad] + juego[config.campoAwaySegundaMitad])
          : esPrimeraMitad
            ? (juego[config.campoHomePrimeraMitad] + juego[config.campoAwayPrimeraMitad])
            : (juego[config.campoHomeTotal] + juego[config.campoAwayTotal]);
      const debugOverUnder = {
        ...debugBase,
        tipoApuesta: (esOver ? 'OVER' : 'UNDER') + textoSegmento,
        lineaUsada: linea,
        marcadorUsado: puntos + ' ' + config.unidadMarcador
      };

      if (esOver) {
        if (puntos > linea) return { estado: 'GANADA', debug: debugOverUnder };
        if (puntos < linea) return { estado: 'PERDIDA', debug: debugOverUnder };
        return { estado: 'ANULADA', debug: debugOverUnder };
      }
      if (esUnder) {
        if (puntos < linea) return { estado: 'GANADA', debug: debugOverUnder };
        if (puntos > linea) return { estado: 'PERDIDA', debug: debugOverUnder };
        return { estado: 'ANULADA', debug: debugOverUnder };
      }
    } else if (!numeros || numeros.length === 0) {
      // Sin NINGÚN número en la jugada (ej. "alta miami", sin el "8" ni la
      // cuota) — no es que "todavía está en juego" (PENDIENTE sugiere que
      // se va a resolver solo con el tiempo, y este NUNCA se va a resolver
      // solo): directamente no hay forma de saber si esta jugada ganó o
      // perdió. Se marca SIN_LOGRO — procesarSabana.js lo convierte en el
      // mismo estado NULA (FALTA LOGRO) que ya existía para la jugada
      // ambigua entre 2 equipos (ver detectarEquipoSinLogro en parser.js) y
      // genera una alerta pidiendo corregir la sábana (28-08-2026, a
      // pedido del usuario).
      return {
        estado: 'SIN_LOGRO',
        razon: 'No se encontró el valor de la línea de ' + (esOver ? 'la alta/over' : 'la baja/under') + ' en esta jugada — sin ese número no se puede saber si ganó o perdió, ni calcular el pago.',
        debug: { ...debugBase, tipoApuesta: esOver ? 'OVER' : 'UNDER', lineaUsada: null }
      };
    } else {
      // SÍ hay número(s) en la jugada, pero NINGUNO cabe en el rango válido
      // de línea numérica de este deporte (ej. "over 55" ya resuelto a MLB,
      // cuyo techo es 20 — el 55 en realidad pertenecía a NFL). Esto es
      // distinto de SIN_LOGRO (que es cuando no hay NINGÚN número): acá el
      // dato sí vino, solo que no calza con el deporte al que se resolvió
      // la jugada, así que se deja igual que siempre (PENDIENTE con motivo
      // claro), sin generar una alerta de "falta logro".
      return {
        estado: 'PENDIENTE',
        razon: 'Ninguno de los números de esta jugada es una línea numérica válida para ' + (config.rangoLineaMax ? ('este deporte (rango 0-' + config.rangoLineaMax + ')') : 'este deporte') + '.',
        debug: { ...debugBase, tipoApuesta: esOver ? 'OVER' : 'UNDER', lineaUsada: null }
      };
    }
  }

  const cHome = esPorCuarto
    ? ((juego[config.campoLinescoresHome] || [])[numeroCuartoEnTexto - 1] || 0)
    : esSegundaMitad
      ? juego[config.campoHomeSegundaMitad]
      : esPrimeraMitad
        ? juego[config.campoHomePrimeraMitad]
        : juego[config.campoHomeTotal];
  const cAway = esPorCuarto
    ? ((juego[config.campoLinescoresAway] || [])[numeroCuartoEnTexto - 1] || 0)
    : esSegundaMitad
      ? juego[config.campoAwaySegundaMitad]
      : esPrimeraMitad
        ? juego[config.campoAwayPrimeraMitad]
        : juego[config.campoAwayTotal];

  const cMiEquipo = esHome ? cHome : cAway;
  const cRival = esHome ? cAway : cHome;

  const lineaSinInning = limpiarMarcadoresSegmento(lineaJugada);

  let handicap = 0;
  const matchesNumeros = lineaSinInning.match(/([+-]?\d+(?:\.\d+)?)/g);

  if (!matchesNumeros || matchesNumeros.length === 0) {
    // Ni línea de hándicap ni cuota de moneyline — nada de nada (ej. la
    // jugada quedó en solo el nombre del equipo). Antes esto caía en
    // silencio al caso MONEYLINE con hándicap 0, calculando GANADA/PERDIDA
    // solo con el marcador y sin ninguna cuota real de por medio — mismo
    // criterio que arriba: se marca SIN_LOGRO en vez de adivinar.
    return {
      estado: 'SIN_LOGRO',
      razon: 'No se encontró ninguna cuota (ni de moneyline, ni de hándicap/run line) en esta jugada.',
      debug: { ...debugBase, tipoApuesta: null, lineaUsada: null }
    };
  }

  for (let m of matchesNumeros) {
    let val = parseFloat(m);
    if (Math.abs(val) > 0 && Math.abs(val) <= config.rangoHandicapMax) {
      handicap = val;
      break;
    }
  }

  const resultadoAjustado = (cMiEquipo + handicap) - cRival;
  const debugHandicap = {
    ...debugBase,
    tipoApuesta: (handicap !== 0 ? ('HÁNDICAP ' + (handicap > 0 ? '+' : '') + handicap) : 'MONEYLINE') + textoSegmento,
    lineaUsada: handicap,
    marcadorUsado: cMiEquipo + ' (mi equipo) vs ' + cRival + ' (rival)'
  };

  if (resultadoAjustado > 0) return { estado: 'GANADA', debug: debugHandicap };
  if (resultadoAjustado < 0) return { estado: 'PERDIDA', debug: debugHandicap };

  // Empate exacto. En MLB/NFL/NHL esto siempre es push (ANULADA), sin
  // importar si era moneyline o hándicap. En fútbol, SOLO cuando es
  // moneyline puro (handicap === 0 — "gana el equipo", no una línea de
  // hándicap específica), el empate se cuenta como PERDIDA para quien
  // apostó a que ese equipo gana (ver config.empatEsPerdidaEnMoneyline y
  // "Reglas de apuestas" en el doc de proyecto). Un hándicap real
  // (ej. "Real Madrid -1") que empata la línea exacta sigue siendo push,
  // como en cualquier otro deporte.
  if (handicap === 0 && config.empatEsPerdidaEnMoneyline) {
    return {
      estado: 'PERDIDA',
      debug: { ...debugHandicap, notaEmpate: 'Empate — en fútbol, una apuesta a que un equipo gana (moneyline) se pierde en caso de empate, no se anula.' }
    };
  }
  return { estado: 'ANULADA', debug: debugHandicap };
}

// Punto de entrada multi-deporte: busca el equipo mencionado en la pata
// (igual que antes, recorriendo TODO el diccionario combinado — base +
// global + personalizado del grupo), y con el `deporte` que ese apodo
// tiene guardado decide sola contra qué API/reglas evaluar. `datosPorDeporte`
// es un objeto tipo `{ mlb: {...}, nfl: {...} }` con los resultados YA
// descargados de cada API para la fecha de la sábana (ver procesarSabana.js).
// -----------------------------------------------------------------
// DESAMBIGUACIÓN: cuando un apodo tiene MÁS DE UN candidato posible (ej.
// "Miami" podría ser Miami Marlins de MLB o Miami Dolphins de NFL — o,
// mañana, también un equipo de fútbol), se resuelve en capas, de la más
// automática a la más manual. Nunca se adivina a ciegas con dinero real
// de por medio: si no se puede resolver con confianza, el ticket queda
// marcado como AMBIGUA (VARIOS DEPORTES) pidiendo que se aclare.
// -----------------------------------------------------------------

// Capa 2 (la 1 es "¿quién tiene partido hoy?", ver resolverCandidatoAmbiguo):
// el tamaño del número de la jugada ya es una pista fuerte de qué deporte
// es. Reutiliza los mismos techos que cada deporte usa para PARSEAR su
// propia jugada (rangoLineaMax/rangoHandicapMax) — si un número solo cabe
// dentro del techo de UN deporte de los candidatos (ej. un margen de
// -20.5 nunca podría ser un hándicap de MLB, cuyo techo es 5.5), es señal
// de cuál es. Si cabe en el techo de más de uno (o de ninguno), esta capa
// no aporta nada y se sigue a la próxima.
function deportesQueCoincidenPorNumero(lineaJugada, deportesCandidatos) {
  const esOverUnder = /(over|alta|altas|under|baja|bajas)/i.test(lineaJugada);
  const limpia = limpiarMarcadoresSegmento(lineaJugada);
  const numeros = (limpia.match(/[+-]?\d+(?:\.\d+)?/g) || [])
    .map(parseFloat)
    // <100 para descartar cuotas americanas, que siempre son ≥100 de
    // magnitud (ej. -110, +150) en cualquier deporte.
    .filter(n => Math.abs(n) > 0 && Math.abs(n) < 100);

  if (numeros.length === 0) return [];

  return deportesCandidatos.filter(deporte => {
    const cfg = CONFIG_POR_DEPORTE[deporte];
    if (!cfg) return false;
    const techo = esOverUnder ? cfg.rangoLineaMax : cfg.rangoHandicapMax;
    return numeros.some(n => Math.abs(n) <= techo);
  });
}

// Decide CUÁL de los candidatos de un apodo ambiguo es el correcto para
// esta jugada puntual, en 5 capas (de la más explícita/manual a la más
// automática — a propósito, lo que la persona dice a mano siempre le gana
// a lo que el sistema adivina solo):
//   0. Resolución manual guardada: si esta MISMA jugada (texto exacto) ya
//      se había marcado como AMBIGUA antes y alguien la resolvió a mano
//      desde la pestaña "Alertas" (ver alertas.js/resoluciones_ambiguas en
//      la base de datos), esa elección es definitiva.
//   1. Marcador por-jugada: un emoji o palabra clave del deporte pegado a
//      la jugada (ej. "🏈 houston" o "houston nba") — ver
//      detectarMarcadorDeporteEnTexto() en parser.js.
//   2. Calendario: ¿cuál de los candidatos tiene partido ESE día? (con los
//      datos YA descargados de cada API — ver procesarSabana.js). Si solo
//      uno tiene partido hoy, es ese — sin preguntarle nada a nadie.
//   3. Si 2+ tienen partido hoy: el tamaño del número de la jugada (ver
//      deportesQueCoincidenPorNumero arriba).
//   4. Si sigue empatado: un marcador de SECCIÓN opcional que el propio
//      Grupo puede escribir en la sábana (ej. una línea "[NFL]") — ver
//      parser.js, se guarda en cada boleto como `deporteForzado`.
// Si ninguna de las 5 capas resuelve nada, no se adivina: se devuelve
// ambiguo (candidatosRestantes) para que evaluarJugada() lo marque como
// AMBIGUA (VARIOS DEPORTES) y se genere una alerta — ver procesarSabana.js.
// Devuelve { candidato } si se pudo resolver, o { candidato: null, motivo,
// candidatosRestantes } si no.
function resolverCandidatoAmbiguo(candidatos, datosPorDeporte, lineaJugada, deporteForzado, deporteResuelto, deporteMarcador) {
  if (deporteResuelto) {
    const elegidoManual = candidatos.find(c => c.deporte === deporteResuelto);
    if (elegidoManual) return { candidato: elegidoManual };
  }

  if (deporteMarcador) {
    const elegidoPorEmojiOPalabra = candidatos.find(c => c.deporte === deporteMarcador);
    if (elegidoPorEmojiOPalabra) return { candidato: elegidoPorEmojiOPalabra };
  }

  const conPartidoHoy = candidatos.filter(c =>
    buscarJuegoPorNombre((datosPorDeporte && datosPorDeporte[c.deporte]) || {}, c.nombre)
  );

  if (conPartidoHoy.length === 1) return { candidato: conPartidoHoy[0] };
  if (conPartidoHoy.length === 0) return { candidato: null, motivo: 'sin_partido_hoy' };

  const deportesEnJuego = conPartidoHoy.map(c => c.deporte);
  const deportesPorNumero = deportesQueCoincidenPorNumero(lineaJugada, deportesEnJuego);
  if (deportesPorNumero.length === 1) {
    return { candidato: conPartidoHoy.find(c => c.deporte === deportesPorNumero[0]) };
  }

  if (deporteForzado) {
    const elegidoPorMarcadorSeccion = conPartidoHoy.find(c => c.deporte === deporteForzado);
    if (elegidoPorMarcadorSeccion) return { candidato: elegidoPorMarcadorSeccion };
  }

  return { candidato: null, motivo: 'ambiguo', candidatosRestantes: conPartidoHoy };
}

// `opciones.deporteForzado`: el deporte del marcador de SECCIÓN activo
// para este ticket en la sábana (ej. "nfl" si había una línea "[NFL]"
// arriba), o null/undefined si no hay ninguno — ver parser.js.
// `opciones.deporteMarcador`: el deporte detectado por un emoji/palabra
// clave pegado a ESTA jugada puntual (ej. "🏈"/"nba") — ver
// detectarMarcadorDeporteEnTexto() en parser.js, se calcula en
// procesarSabana.js sobre el texto ORIGINAL (antes de normalizar, porque
// normalizarTexto le borra los emojis a la jugada).
// `opciones.deporteResuelto`: si esta jugada ya se había marcado AMBIGUA
// antes y el Grupo/Súper-admin la resolvió a mano desde "Alertas", el
// deporte que eligieron — ver alertas.js y resoluciones_ambiguas.
function evaluarJugada(lineaJugada, datosPorDeporte, diccionarioEquipos, opciones) {
  const deporteForzado = (opciones && opciones.deporteForzado) || null;
  const deporteMarcador = (opciones && opciones.deporteMarcador) || null;
  const deporteResuelto = (opciones && opciones.deporteResuelto) || null;
  // 06-09-2026 (a pedido del usuario: "un tikcet del inter de miami de
  // futbol que tenia su icono de futbol no lo distingue y lo lee como
  // beisbol aunque ya este mapeado y todo"): ANTES este for cortaba en el
  // PRIMER apodo que matcheara, en el orden en que Object.keys() los
  // devuelve — y ese orden es simplemente el orden en que cada deporte se
  // agregó al diccionario (MLB primero, fútbol bastante después), no el
  // de qué tan ESPECÍFICO es el apodo. "inter miami" (fútbol, un solo
  // candidato, sin ambigüedad) contiene la palabra completa "miami", que
  // TAMBIÉN es un apodo por sí solo (MLB Marlins / NFL Dolphins, agregado
  // mucho antes en el diccionario) — entonces para una jugada como "inter
  // miami alta 4-115" el for encontraba "miami" primero, se quedaba con
  // ESOS 2 candidatos (ninguno de fútbol) y nunca llegaba a ver "inter
  // miami" — la jugada terminaba evaluada contra MLB o NFL en vez de
  // fútbol, exactamente el bug reportado. El arreglo: ya no cortar en el
  // primer match — juntar TODOS los apodos que matcheen y quedarse con el
  // MÁS LARGO, pero SOLO cuando ese apodo más largo CONTIENE por completo
  // al que ya se había encontrado (ej. "inter miami" contiene a "miami")
  // — ahí sí es sin duda una descripción más específica del MISMO match.
  // Cuando 2 apodos que matchean NO se contienen entre sí (ej. "houston"
  // y "astros", o "chicago" y "cubs" — son palabras independientes, cada
  // una su propio apodo), no se toca nada: se respeta cuál apareció
  // primero en el diccionario, exactamente como ya funcionaba antes de
  // este arreglo — esa ambigüedad ya la resuelve resolverCandidatoAmbiguo
  // más abajo (por partido del día, emoji/palabra clave, etc.), y no es
  // el bug que se está resolviendo acá.
  let apodoEncontrado = null;

  for (const apodo of Object.keys(diccionarioEquipos)) {
    const regex = new RegExp('\\b' + apodo + '\\b', 'i');
    if (regex.test(lineaJugada) || lineaJugada.includes(apodo)) {
      if (!apodoEncontrado) {
        apodoEncontrado = apodo;
      } else if (apodo.length > apodoEncontrado.length && apodo.toLowerCase().includes(apodoEncontrado.toLowerCase())) {
        apodoEncontrado = apodo;
      }
    }
  }

  if (!apodoEncontrado) {
    return {
      estado: 'SIN_MAPEO',
      razon: 'Equipo no en diccionario',
      debug: { pata: lineaJugada, apodoDetectado: null, equipoOficial: null }
    };
  }

  const candidatos = diccionarioEquipos[apodoEncontrado];
  let infoEquipo;

  // =============================================================
  // 13-09-2026 (bug real, encontrado junto con el arreglo de "Texas
  // state"/Texas Rangers de más arriba en el mismo diccionario): el
  // usuario mandó 2 tickets con el mismo apodo pelado "Texas" — uno con
  // "nfl" escrito al lado, el otro sin ningún identificador — y pidió
  // explícitamente: "queremos que funcione que aunque estén escritos los
  // dos nombres igual pero tienen algun identificador... debería
  // funcionar y si no trae ningun idenficador debes mandar una alerta".
  //
  // La causa de fondo: "texas" en el diccionario SOLO existe como Texas
  // Rangers (mlb) — un único candidato. resolverCandidatoAmbiguo() (más
  // arriba), que es donde se mira el marcador explícito de deporte
  // (emoji/abreviatura/palabra — ver detectarMarcadorDeporteEnTexto() en
  // parser.js), SOLO se llama más abajo cuando hay 2 o más candidatos
  // (candidatos.length === 1 se resuelve directo, sin pasar por ahí). Un
  // apodo con UN SOLO candidato entonces se usaba a ciegas sin importar
  // qué deporte pidiera la persona — "Texas alta nfl 44.5" terminaba
  // evaluado contra Texas Rangers de MLB (el único candidato que hay),
  // ignorando por completo la palabra "nfl", en vez de reconocer que acá
  // NO hay ningún equipo de NFL mapeado para "Texas".
  //
  // El arreglo: si la jugada trae un identificador EXPLÍCITO de deporte
  // (deporteMarcador ya viene calculado desde procesarSabana.js) y
  // NINGUNO de los candidatos reales de este apodo — sean 1 o varios —
  // es de ese deporte, no se adivina con el que haya: se trata como
  // SIN_MAPEO ("puede ser un equipo de ese deporte que todavía no está en
  // el diccionario"), respetando el marcador manual (✅/❌/⭕) igual que
  // cualquier otro SIN_MAPEO — y procesarSabana.js además genera una
  // alerta para este caso puntual (a diferencia de un SIN_MAPEO común,
  // que no alerta solo y espera el marcador manual en silencio), porque
  // acá hay una CONTRADICCIÓN explícita entre lo que pidió la persona
  // (un deporte concreto) y lo que hay mapeado, no solo una ausencia —
  // exactamente el caso que pidió el usuario ("mandar una alerta para
  // evitar errores o confusiones"). Cuando la jugada NO trae ningún
  // identificador (deporteMarcador null, el caso más común, ej. "Yankees
  // -150"), este chequeo no aplica y todo sigue funcionando exactamente
  // igual que siempre — no hace falta poner un identificador en cada
  // jugada, solo en las que de verdad lo necesitan.
  //
  // EXCEPCIÓN NECESARIA para no romper el arreglo de "Miami Florida" del
  // 11/12-09-2026: el emoji 🏈 SIEMPRE fuerza deporteMarcador = 'nfl' en
  // este sistema (EMOJI_DEPORTE, parser.js) — a propósito NUNCA se
  // repartió un emoji aparte para NCAAF, así que el usuario usa 🏈 tanto
  // para tickets de NFL como de NCAAF (ver, por ejemplo, su propio
  // "🏈 California rl +3.5" / "🏈 Texas state rl -2.5", ambos NCAAF). Si
  // se aplicara el chequeo de arriba tal cual, CUALQUIER equipo mapeado
  // solo como NCAAF (ej. "miami florida" → Miami (FL) Hurricanes, un solo
  // candidato) rompería apenas alguien le pusiera 🏈 al lado, aunque 🏈
  // ahí nunca quiso decir "esto es de la NFL" en primer lugar — es
  // simplemente "esto es fútbol americano". Por eso, cuando el marcador
  // es 'nfl' (venga del emoji 🏈 o de la palabra "nfl"), un candidato
  // NCAAF SÍ cuenta como coincidencia — no es una contradicción real,
  // es la ambigüedad conocida y aceptada del propio emoji/etiqueta. Esta
  // tolerancia es SOLO para el par nfl↔ncaaf (los 2 "fútbol americano"
  // de este sistema); cualquier otro cruce (ej. "nfl" contra un candidato
  // que es SOLO mlb, como el bug real de "Texas") se sigue tratando como
  // mismatch real, tal como se reportó.
  // =============================================================
  const esFutbolAmericano = (d) => d === 'nfl' || d === 'ncaaf';
  const marcadorCoincideConAlgunCandidato = deporteMarcador === 'nfl'
    ? candidatos.some(c => esFutbolAmericano(c.deporte))
    : candidatos.some(c => c.deporte === deporteMarcador);
  if (deporteMarcador && !marcadorCoincideConAlgunCandidato) {
    const nombresConocidos = candidatos.map(c => c.nombre + ' (' + c.deporte.toUpperCase() + ')').join(', ');
    return {
      estado: 'SIN_MAPEO',
      razon: 'La jugada indica ' + deporteMarcador.toUpperCase() + ' explícitamente, pero "' + apodoEncontrado +
        '" en el diccionario solo está mapeado como ' + nombresConocidos + ' — puede ser un equipo de ' +
        deporteMarcador.toUpperCase() + ' que todavía no está en el diccionario. Revisa el nombre del equipo o ' +
        'agrégalo con un apodo más específico.',
      debug: {
        pata: lineaJugada, apodoDetectado: apodoEncontrado, equipoOficial: null,
        deporteMarcadorNoCoincide: true, deporteMarcador,
        candidatosDelApodo: candidatos.map(c => ({ nombre: c.nombre, deporte: c.deporte }))
      }
    };
  }

  if (candidatos.length === 1) {
    infoEquipo = candidatos[0];
  } else {
    const resolucion = resolverCandidatoAmbiguo(candidatos, datosPorDeporte, lineaJugada, deporteForzado, deporteResuelto, deporteMarcador);

    if (!resolucion.candidato) {
      if (resolucion.motivo === 'sin_partido_hoy') {
        return {
          estado: 'PENDIENTE',
          razon: 'Partido no encontrado en la API',
          debug: { pata: lineaJugada, apodoDetectado: apodoEncontrado, equipoOficial: null }
        };
      }
      // Ambiguo de verdad: 2 o más candidatos tienen partido HOY y no se
      // pudo desempatar ni por una resolución manual previa, ni por un
      // emoji/palabra clave, ni por el número de la jugada, ni por un
      // marcador de sección — no se adivina, se pide aclaración (y
      // procesarSabana.js genera una alerta con estos mismos candidatos
      // para que se pueda resolver desde la pestaña "Alertas").
      const candidatosConDeporte = resolucion.candidatosRestantes.map(c => ({ nombre: c.nombre, deporte: c.deporte }));
      const listaCandidatos = candidatosConDeporte.map(c => c.nombre + ' (' + c.deporte.toUpperCase() + ')');
      return {
        estado: 'AMBIGUA (VARIOS DEPORTES)',
        razon: '"' + apodoEncontrado + '" podría ser ' + listaCandidatos.join(' o ') + ' — los dos (o los varios) juegan hoy y no se pudo determinar cuál. Aclará escribiendo el nombre completo del equipo, poniendo un emoji/palabra clave del deporte junto al equipo (ej. "🏈" o "nba"), o resolviéndolo desde la pestaña Alertas.',
        debug: { pata: lineaJugada, apodoDetectado: apodoEncontrado, equipoOficial: null, candidatosAmbiguos: listaCandidatos, candidatosAmbiguosDetalle: candidatosConDeporte }
      };
    }

    infoEquipo = resolucion.candidato;
  }

  const deporte = infoEquipo.deporte || 'mlb';
  const config = CONFIG_POR_DEPORTE[deporte];

  if (!config) {
    // Deporte guardado en el diccionario (ej. por "Registrar Equipo Nuevo")
    // que todavía no tiene una API conectada. Desde el 12-09-2026 esto ya
    // NO le pasa a 'ncaaf' (ver CONFIG_POR_DEPORTE.ncaaf más arriba y
    // ncaafApi.js) — queda para cualquier deporte FUTURO que se agregue al
    // diccionario antes de conectarle su API (como pasó con soccer/NHL/NCAAF
    // en su momento).
    //
    // 12-09-2026 (bug real reportado por el usuario, ticket real: "Over
    // Miami Florida🏈(66)-110 / 49ers🏈(+3.5)-110 / Yankees⚾️(-300)", con
    // "✅" puesto a mano porque "aun no tenemos esa api me marca como
    // pendiente pero manualmente ya yo marque que se cumple el parley"):
    // ANTES este caso devolvía PENDIENTE, con la idea de que la API se
    // fuera a conectar "más adelante" (como pasó con soccer/NHL, y ahora
    // NCAAF mismo). El problema: procesarSabana.js trata PENDIENTE como una
    // pendencia REAL (recuperable sola, con una API que sí funciona) y por
    // eso NO deja que el marcador manual (✅/❌/⭕) resuelva el ticket —
    // exactamente al revés de lo que se necesita acá. Un deporte SIN
    // ninguna API conectada nunca se va a resolver solo (ni hoy ni "más
    // adelante" salvo que alguien integre esa API) — es EXACTAMENTE la
    // misma situación que un equipo que ni siquiera está en el diccionario
    // (SIN_MAPEO), así que ahora se devuelve ese mismo estado, para que
    // respete el marcador manual igual que cualquier otro equipo sin mapear
    // (ver la nota grande en procesarSabana.js, sección 06-09-2026).
    return {
      estado: 'SIN_MAPEO',
      razon: 'El deporte "' + deporte + '" todavía no tiene una API conectada',
      debug: { pata: lineaJugada, apodoDetectado: apodoEncontrado, equipoOficial: infoEquipo.nombre }
    };
  }

  const datosDeporte = (datosPorDeporte && datosPorDeporte[deporte]) || {};
  return evaluarConEquipoYConfig(lineaJugada, datosDeporte, infoEquipo, apodoEncontrado, config);
}

// Atajos de un solo deporte — se mantienen para no romper código/pruebas
// que ya llamaban evaluarJugadaMLB() directo con la firma de siempre
// (lineaJugada, datosMLB, diccionarioEquipos). Se comportan EXACTAMENTE
// igual que antes de esta generalización.
function evaluarJugadaMLB(lineaJugada, datosMLB, diccionarioEquipos) {
  return evaluarJugada(lineaJugada, { mlb: datosMLB }, diccionarioEquipos);
}

function evaluarJugadaNFL(lineaJugada, datosNFL, diccionarioEquipos) {
  return evaluarJugada(lineaJugada, { nfl: datosNFL }, diccionarioEquipos);
}

module.exports = { evaluarJugada, evaluarJugadaMLB, evaluarJugadaNFL, CONFIG_POR_DEPORTE, detectarCuartoEnJugada, detectarNumeroJuegoEnJugada, limpiarMarcadoresSegmento };
