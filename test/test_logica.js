// Pruebas del motor de lógica pura (parser + evaluador + comisiones), sin
// tocar base de datos ni la API real de MLB — mismo espíritu que las
// pruebas de la app original (app.js), verificando que el port al backend
// se comporta EXACTAMENTE igual para los mismos casos ya confirmados.
//
// No depende de ningún paquete de npm (no hay acceso a la registry desde
// este sandbox) — solo usa los módulos de src/services que son JS puro.
const assert = require('assert');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');
const { normalizarTexto } = require('../src/services/normalizar');
const { parsearSabana, calcularPagoParley, detectarMarcadorDeporteEnTexto, normalizarComasDecimales, extraerCuotaAmericana, pataTieneCuotaYParaPropia } = require('../src/services/parser');
const { evaluarJugadaMLB, evaluarJugadaNFL, evaluarJugada, detectarCuartoEnJugada, detectarNumeroJuegoEnJugada } = require('../src/services/evaluador');
const { obtenerResultadosAPIs, buscarJuegoPorNombre } = require('../src/services/mlbApi');
const { esEstadoComisionable, calcularComisionTotalCliente } = require('../src/services/comisiones');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// -----------------------------------------------------------------
// Caso 1: MANOLO avala a RICKY sin jugar (regresión del bug #22 del
// proyecto original — MANOLO no debe duplicarse en el cierre del día).
// -----------------------------------------------------------------
(function testManoloAvaladorSinJugar() {
  const datosMLB = {
    'new york yankees': {
      homeTeam: 'New York Yankees', awayTeam: 'Boston Red Sox',
      homeRuns: 5, awayRuns: 2, totalRuns: 7,
      home5innRuns: 3, away5innRuns: 1, total5innRuns: 4,
      finalizado: true, final5inn: true, suspendido: false
    },
    'boston red sox': {
      homeTeam: 'New York Yankees', awayTeam: 'Boston Red Sox',
      homeRuns: 5, awayRuns: 2, totalRuns: 7,
      home5innRuns: 3, away5innRuns: 1, total5innRuns: 4,
      finalizado: true, final5inn: true, suspendido: false
    }
  };

  const textoSabana = ['*RICKY*', 'Ticket 1', 'Red sox -110', '20//15'].join('\n');
  const boletos = parsearSabana(textoSabana, DICCIONARIO_EQUIPOS_BASE);
  check(boletos.length === 1 && boletos[0].cliente === 'RICKY', 'parsearSabana detecta 1 ticket de RICKY');

  // Reproduce el pipeline de procesarSabana.js a mano (sin DB) para este caso.
  const resumenClientes = {};
  boletos.forEach(b => {
    const jugadasNorm = b.jugadas.map(normalizarTexto);
    const evals = jugadasNorm.map(j => evaluarJugadaMLB(j, datosMLB, DICCIONARIO_EQUIPOS_BASE));
    const perdido = evals.some(e => e.estado === 'PERDIDA');
    const estadoFinal = perdido ? 'PERDIDA' : 'GANADA';
    if (!resumenClientes[b.cliente]) resumenClientes[b.cliente] = { arriesgado: 0, arriesgadoComisionable: 0, ganado: 0, perdido: 0, pendientes: 0 };
    const rc = resumenClientes[b.cliente];
    rc.arriesgado += b.arriesga;
    if (esEstadoComisionable(estadoFinal)) rc.arriesgadoComisionable += b.arriesga;
    if (estadoFinal === 'PERDIDA') rc.perdido += b.arriesga;
  });

  check(resumenClientes.RICKY.perdido === 20, 'RICKY perdió su ticket de $20 (Red Sox perdió 2-5)');

  const porcentajesPropios = {};
  const avalesMap = { MANOLO: { RICKY: 5 } };

  const clientesDelDia = new Set(Object.keys(resumenClientes));
  Object.keys(avalesMap).forEach(avalador => {
    if (clientesDelDia.has(avalador)) return;
    const c = calcularComisionTotalCliente(avalador, resumenClientes, porcentajesPropios, avalesMap);
    if (Math.abs(c.total) > 0.001) clientesDelDia.add(avalador);
  });
  check(clientesDelDia.has('MANOLO'), 'MANOLO entra a "clientesDelDia" aunque no jugó (avala a RICKY)');

  const totalesPlano = Array.from(clientesDelDia).map(cliente => {
    const rc = resumenClientes[cliente] || { arriesgado: 0, arriesgadoComisionable: 0, ganado: 0, perdido: 0, pendientes: 0 };
    const comision = calcularComisionTotalCliente(cliente, resumenClientes, porcentajesPropios, avalesMap);
    return { cliente, jugoHoy: Object.prototype.hasOwnProperty.call(resumenClientes, cliente), totalBanca: rc.perdido - rc.ganado - comision.total, devolucion: comision.total };
  });

  const manolo = totalesPlano.find(c => c.cliente === 'MANOLO');
  check(manolo.jugoHoy === false, 'MANOLO tiene jugoHoy=false (no jugó, solo avala) — no debe mostrar línea de resultado propio');
  check(Math.abs(manolo.devolucion - 1) < 0.001, 'MANOLO gana 5% de $20 = $1.00 de comisión por avalar a RICKY');

  const ricky = totalesPlano.find(c => c.cliente === 'RICKY');
  check(ricky.jugoHoy === true, 'RICKY tiene jugoHoy=true (sí jugó)');
})();

// -----------------------------------------------------------------
// Caso 2: parley de 3 patas escrito en una sola línea con "x" (bug #18
// del proyecto original) — WISTON.
// -----------------------------------------------------------------
(function testParleyTresPatasConX() {
  const texto = ['*WISTON*', 'Ticket 5', 'Anaheim +120 x alta cincinatti 8 -120 x san francisco -1,5 +180', '100$'].join('\n');
  const boletos = parsearSabana(texto, DICCIONARIO_EQUIPOS_BASE);
  check(boletos.length === 1, 'Se detecta 1 solo ticket para el parley de 3 patas');
  check(boletos[0].jugadas.length === 3, 'separarPatasPorX separa las 3 patas del parley (Anaheim / Cincinnati / San Francisco)');

  const jugadasNorm = boletos[0].jugadas.map(normalizarTexto);
  const pago = calcularPagoParley(jugadasNorm, boletos[0].arriesga);
  // +120 -> 2.20 ; -120 -> 1.8333... ; +180 -> 2.80
  const esperado = 100 * 2.20 * 1.833333333 * 2.80 - 100;
  check(pago !== null && Math.abs(pago - esperado) < 0.01, 'La ganancia neta del parley de 3 patas se calcula multiplicando las 3 cuotas (≈$' + esperado.toFixed(2) + ')');
})();

// -----------------------------------------------------------------
// Caso 3: juego suspendido -> ticket queda SUSPENDIDA, no PENDIENTE normal.
// -----------------------------------------------------------------
(function testJuegoSuspendido() {
  const datosMLB = {
    'houston astros': {
      homeTeam: 'Houston Astros', awayTeam: 'Texas Rangers',
      homeRuns: 2, awayRuns: 1, totalRuns: 3,
      home5innRuns: 1, away5innRuns: 1, total5innRuns: 2,
      finalizado: false, final5inn: false, suspendido: true
    },
    'texas rangers': {
      homeTeam: 'Houston Astros', awayTeam: 'Texas Rangers',
      homeRuns: 2, awayRuns: 1, totalRuns: 3,
      home5innRuns: 1, away5innRuns: 1, total5innRuns: 2,
      finalizado: false, final5inn: false, suspendido: true
    }
  };
  const res = evaluarJugadaMLB(normalizarTexto('Astros -120'), datosMLB, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'SUSPENDIDA', 'Un juego suspendido marca el ticket como SUSPENDIDA (no PENDIENTE)');
})();

// -----------------------------------------------------------------
// Caso 4: over/under de primeras 5 entradas (5inn) se evalúa con el
// marcador parcial, no el del juego completo.
// -----------------------------------------------------------------
(function test5Innings() {
  const datosMLB = {
    'atlanta braves': {
      homeTeam: 'Atlanta Braves', awayTeam: 'Miami Marlins',
      homeRuns: 6, awayRuns: 5, totalRuns: 11,
      home5innRuns: 2, away5innRuns: 1, total5innRuns: 3,
      finalizado: true, final5inn: true, suspendido: false
    },
    'miami marlins': {
      homeTeam: 'Atlanta Braves', awayTeam: 'Miami Marlins',
      homeRuns: 6, awayRuns: 5, totalRuns: 11,
      home5innRuns: 2, away5innRuns: 1, total5innRuns: 3,
      finalizado: true, final5inn: true, suspendido: false
    }
  };
  // Alta de 4.5 en 5inn: total5inn=3 < 4.5 -> PERDIDA. Juego completo
  // (11 carreras) hubiera sido GANADA — confirma que usa el marcador de 5inn.
  const res = evaluarJugadaMLB(normalizarTexto('alta Atlanta 4.5 5inn'), datosMLB, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'PERDIDA', 'Over 4.5 en 5inn con 3 carreras parciales pierde, aunque el juego completo tuvo 11 (usa el marcador correcto)');
})();

// -----------------------------------------------------------------
// Caso 5 (NFL, 28-08-2026): hándicap (spread) de NFL con un margen mucho
// más grande que el que MLB nunca tendría (24 puntos) — confirma que el
// rango de "línea real" ampliado para NFL (hasta 60) detecta bien el
// spread sin confundirlo con la cuota americana (-110), y que el hándicap
// SÍ se resuelve distinto según decide ganar o perder.
// -----------------------------------------------------------------
(function testNFLHandicap() {
  const datosNFL = {
    'buffalo bills': {
      deporte: 'nfl', homeTeam: 'Buffalo Bills', awayTeam: 'New York Jets',
      homeScore: 30, awayScore: 6, totalScore: 36, finalizado: true, suspendido: false
    },
    'new york jets': {
      deporte: 'nfl', homeTeam: 'Buffalo Bills', awayTeam: 'New York Jets',
      homeScore: 30, awayScore: 6, totalScore: 36, finalizado: true, suspendido: false
    }
  };
  // Bills ganaron por 24 (30-6). Apostar Bills -20.5 -110 SÍ cubre (24 > 20.5) -> GANADA.
  const resGana = evaluarJugadaNFL(normalizarTexto('Bills -20.5 -110'), datosNFL, DICCIONARIO_EQUIPOS_BASE);
  check(resGana.estado === 'GANADA', 'NFL: Bills -20.5 cubre con un margen real de 24 puntos -> GANADA');

  // Jets +20.5 -110 (el rival, con el mismo margen) NO cubre (perdieron por 24, más que 20.5) -> PERDIDA.
  const resPierde = evaluarJugadaNFL(normalizarTexto('Jets +20.5 -110'), datosNFL, DICCIONARIO_EQUIPOS_BASE);
  check(resPierde.estado === 'PERDIDA', 'NFL: Jets +20.5 no alcanza a cubrir con ese margen -> PERDIDA');
})();

// -----------------------------------------------------------------
// Caso 6 (NFL): over/under de puntos totales con una línea típica de NFL
// (44.5) — muy por fuera del rango de MLB (máx 20), confirma que el
// techo ampliado para NFL detecta bien la línea.
// -----------------------------------------------------------------
(function testNFLOverUnder() {
  const datosNFL = {
    'dallas cowboys': {
      deporte: 'nfl', homeTeam: 'Dallas Cowboys', awayTeam: 'Philadelphia Eagles',
      homeScore: 27, awayScore: 24, totalScore: 51, finalizado: true, suspendido: false
    },
    'philadelphia eagles': {
      deporte: 'nfl', homeTeam: 'Dallas Cowboys', awayTeam: 'Philadelphia Eagles',
      homeScore: 27, awayScore: 24, totalScore: 51, finalizado: true, suspendido: false
    }
  };
  const res = evaluarJugadaNFL(normalizarTexto('Over Cowboys 44.5 -110'), datosNFL, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'GANADA', 'NFL: Over 44.5 con 51 puntos totales -> GANADA (línea de NFL, fuera del rango de MLB)');
})();

// -----------------------------------------------------------------
// Caso 7 (NFL): empate en el marcador final (posible en NFL, a diferencia
// de MLB) con un hándicap 0 (moneyline) -> ANULADA (push), no PERDIDA.
// -----------------------------------------------------------------
(function testNFLEmpateEsAnulada() {
  const datosNFL = {
    'green bay packers': {
      deporte: 'nfl', homeTeam: 'Green Bay Packers', awayTeam: 'Chicago Bears',
      homeScore: 20, awayScore: 20, totalScore: 40, finalizado: true, suspendido: false
    },
    'chicago bears': {
      deporte: 'nfl', homeTeam: 'Green Bay Packers', awayTeam: 'Chicago Bears',
      homeScore: 20, awayScore: 20, totalScore: 40, finalizado: true, suspendido: false
    }
  };
  const res = evaluarJugadaNFL(normalizarTexto('Packers -110'), datosNFL, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'ANULADA', 'NFL: un empate en el marcador con apuesta moneyline es ANULADA (push), no PERDIDA');
})();

// -----------------------------------------------------------------
// Caso 8 (multi-deporte, el pedido explícito del usuario 28-08-2026): UNA
// sola sábana con el Ticket 1 de MLB y el Ticket 2 de NFL, resuelta con
// evaluarJugada() (el nuevo punto de entrada) SIN indicar el deporte en
// ningún lado — cada jugada se resuelve sola contra la API que le
// corresponde según lo que dice el diccionario para ESE equipo.
// -----------------------------------------------------------------
(function testMultiDeporteUnaSolaSabana() {
  const datosMLB = {
    'houston astros': {
      homeTeam: 'Houston Astros', awayTeam: 'Seattle Mariners',
      homeRuns: 5, awayRuns: 2, totalRuns: 7,
      home5innRuns: 3, away5innRuns: 1, total5innRuns: 4,
      finalizado: true, final5inn: true, suspendido: false
    },
    'seattle mariners': {
      homeTeam: 'Houston Astros', awayTeam: 'Seattle Mariners',
      homeRuns: 5, awayRuns: 2, totalRuns: 7,
      home5innRuns: 3, away5innRuns: 1, total5innRuns: 4,
      finalizado: true, final5inn: true, suspendido: false
    }
  };
  const datosNFL = {
    'kansas city chiefs': {
      deporte: 'nfl', homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos',
      homeScore: 24, awayScore: 17, totalScore: 41, finalizado: true, suspendido: false
    },
    'denver broncos': {
      deporte: 'nfl', homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos',
      homeScore: 24, awayScore: 17, totalScore: 41, finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: datosMLB, nfl: datosNFL };

  const texto = [
    '*PEDRO*',
    'Ticket 1',
    'Astros -150',
    '100//66.67',
    'Ticket 2',
    'Chiefs -110',
    '100//90.91'
  ].join('\n');

  const boletos = parsearSabana(texto, DICCIONARIO_EQUIPOS_BASE);
  check(boletos.length === 2, 'Multi-deporte: se detectan los 2 tickets de PEDRO (uno de MLB, uno de NFL)');

  const resTicket1 = evaluarJugada(normalizarTexto(boletos[0].jugadas[0]), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  const resTicket2 = evaluarJugada(normalizarTexto(boletos[1].jugadas[0]), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);

  check(resTicket1.estado === 'GANADA' && resTicket1.debug.equipoOficial === 'Houston Astros',
    'Multi-deporte: el Ticket 1 (Astros) se resuelve solo contra los datos de MLB');
  check(resTicket2.estado === 'GANADA' && resTicket2.debug.equipoOficial === 'Kansas City Chiefs',
    'Multi-deporte: el Ticket 2 (Chiefs), en la MISMA llamada, se resuelve solo contra los datos de NFL, sin tocar el selector de deporte');
})();

// -----------------------------------------------------------------
// Caso 9: un apodo guardado con un deporte que todavía no tiene API
// conectada (ej. "soccer") no rompe nada — el ticket queda SIN_MAPEO con
// una razón clara, no una excepción.
//
// 12-09-2026 (bug real reportado por el usuario, ver
// test_ncaaf_sin_mapear.js para el caso completo): este caso ANTES
// esperaba PENDIENTE acá — pero procesarSabana.js trata PENDIENTE como una
// pendencia REAL (recuperable sola, con una API que sí funciona), así que
// un deporte SIN ninguna API conectada (nunca se va a resolver solo, ni
// hoy ni "más adelante" salvo que alguien integre esa API) NO dejaba usar
// el marcador manual (✅/❌/⭕) — exactamente al revés de lo que hacía falta.
// Es la MISMA situación que un equipo que ni siquiera está en el
// diccionario (SIN_MAPEO), así que ahora devuelve ese mismo estado.
// -----------------------------------------------------------------
(function testDeporteSinAPIConectada() {
  // OJO: desde el 28-08-2026 cada apodo apunta a un ARRAY de candidatos
  // (ver diccionarioEquipos.js) — acá va con 1 solo candidato, que es el
  // caso normal (sin ambigüedad). Este caso usaba "soccer" y después
  // "basket" como ejemplo de deporte sin conectar — desde que se integró
  // NBA (31-08-2026, ver "NBA y apuestas por cuarto agregadas"), "basket"
  // YA tiene su propio CONFIG_POR_DEPORTE y ya no sirve de ejemplo, así que
  // se cambió a "rugby", que sigue siendo un deporte ficticio sin ninguna
  // API ni config conectada.
  const diccionarioConRugby = { ...DICCIONARIO_EQUIPOS_BASE, 'mi equipo de rugby': [{ nombre: 'Mi Equipo de Rugby', deporte: 'rugby' }] };
  const res = evaluarJugada(normalizarTexto('Mi Equipo de Rugby -110'), { mlb: {}, nfl: {}, nhl: {}, soccer: {}, basket: {} }, diccionarioConRugby);
  check(res.estado === 'SIN_MAPEO' && /rugby/.test(res.razon), 'Un deporte sin API conectada todavía (ej. rugby) queda SIN_MAPEO con una razón clara, no rompe, y respeta el marcador manual igual que un equipo ni siquiera registrado');
})();

// -----------------------------------------------------------------
// Caso 9b (NCAAF, 12-09-2026, a pedido explícito del usuario: "crees que
// puedas agregar una api para ncaaf? existe?"): NCAAF ahora SÍ tiene
// CONFIG_POR_DEPORTE (ver evaluador.js) y su propio conector (ncaafApi.js,
// misma API de ESPN que ya usa NFL) — este caso confirma que la lógica
// GENÉRICA de evaluarConEquipoYConfig() funciona igual de bien parametrizada
// para 'ncaaf' que para 'nfl' (hándicap y over/under con líneas típicas de
// fútbol americano, sin apuesta al empate). El caso end-to-end completo
// (con el ticket real reportado y la transición SIN_MAPEO/PENDIENTE) está
// en test_ncaaf_sin_mapear.js.
// -----------------------------------------------------------------
(function testNCAAFHandicapYOverUnder() {
  const datosNCAAF = {
    'georgia bulldogs': {
      deporte: 'ncaaf', homeTeam: 'Georgia Bulldogs', awayTeam: 'Alabama Crimson Tide',
      homeScore: 34, awayScore: 10, totalScore: 44, finalizado: true, suspendido: false
    },
    'alabama crimson tide': {
      deporte: 'ncaaf', homeTeam: 'Georgia Bulldogs', awayTeam: 'Alabama Crimson Tide',
      homeScore: 34, awayScore: 10, totalScore: 44, finalizado: true, suspendido: false
    }
  };
  // Georgia ganó por 24. Apostar Georgia -20.5 -110 SÍ cubre -> GANADA.
  const resGana = evaluarJugada(normalizarTexto('Georgia -20.5 -110'), { ncaaf: datosNCAAF }, DICCIONARIO_EQUIPOS_BASE);
  check(resGana.estado === 'GANADA', 'NCAAF: Georgia -20.5 cubre con un margen real de 24 puntos -> GANADA');

  // Alabama +20.5 -110 (el rival, mismo margen) NO cubre -> PERDIDA.
  const resPierde = evaluarJugada(normalizarTexto('Alabama +20.5 -110'), { ncaaf: datosNCAAF }, DICCIONARIO_EQUIPOS_BASE);
  check(resPierde.estado === 'PERDIDA', 'NCAAF: Alabama +20.5 no alcanza a cubrir con ese margen -> PERDIDA');

  // Over 60.5 con 44 puntos totales -> UNDER gana, no el over.
  const resOver = evaluarJugada(normalizarTexto('Over Georgia 60.5 -110'), { ncaaf: datosNCAAF }, DICCIONARIO_EQUIPOS_BASE);
  check(resOver.estado === 'PERDIDA', 'NCAAF: Over 60.5 con solo 44 puntos totales -> PERDIDA (línea típica de fútbol americano universitario, fuera del rango de MLB)');
})();

// -----------------------------------------------------------------
// Caso 9c (13-09-2026, bug real reportado por el usuario con 2 tickets
// reales — "Texas alta nfl 44.5 -110" quedó GANADA/confusa y "Texas -110"
// quedó PERDIDA, los 2 con el mismo apodo pelado "Texas" pero resultados
// que no se explicaban entre sí): "el logo del deporte, abreviación...
// o palabras enteras... debería funcionar y si no trae ningun
// idenficador debes mandar una alerta para evitar errores o confusiones".
//
// La causa: "texas" en el diccionario SOLO existe como Texas Rangers
// (mlb) — un único candidato. Antes de este arreglo, evaluarJugada()
// solo miraba el marcador explícito de deporte (emoji/palabra) cuando
// había 2+ candidatos entre los que elegir — con 1 solo candidato lo
// usaba a ciegas, sin importar qué deporte pidiera la persona. Ahora, si
// hay un marcador explícito y NINGÚN candidato real de ese apodo es de
// ese deporte, la jugada queda SIN_MAPEO con una razón clara (en vez de
// evaluarse contra el equipo equivocado) — y procesarSabana.js genera una
// alerta para este caso puntual (ver test_alertas_integracion.js /
// test_ncaaf_sin_mapear.js para el flujo de punta a punta).
// -----------------------------------------------------------------
(function testIdentificadorDeDeporteExplicitoNoCoincide() {
  const dicSoloTexasMLB = DICCIONARIO_EQUIPOS_BASE;

  // El caso real reportado: "nfl" explícito, pero "texas" solo es MLB.
  const resTexasNFL = evaluarJugada('Texas alta nfl 44.5 -110', {}, dicSoloTexasMLB, { deporteMarcador: detectarMarcadorDeporteEnTexto('Texas alta nfl 44.5 -110') });
  check(resTexasNFL.estado === 'SIN_MAPEO', 'BUG REAL: "Texas alta nfl 44.5" (identificador NFL explícito, pero "texas" solo es MLB) ya NO se evalúa a ciegas contra Texas Rangers — queda SIN_MAPEO');
  check(resTexasNFL.debug.deporteMarcadorNoCoincide === true, 'el debug marca explícitamente que el identificador de deporte NO coincide con lo mapeado, para que procesarSabana.js genere la alerta');
  check(/NFL/.test(resTexasNFL.razon) && /Texas Rangers/.test(resTexasNFL.razon) && /MLB/.test(resTexasNFL.razon), 'la razón explica el choque: pediste NFL, lo único mapeado es Texas Rangers (MLB)');

  // Regresión: SIN ningún identificador, "Texas -110" se sigue resolviendo
  // igual que siempre (Texas Rangers, mlb) — no hace falta poner un
  // identificador en cada jugada, solo en las que de verdad lo requieren.
  const resTexasSinMarcador = evaluarJugada('Texas -110', {}, dicSoloTexasMLB, { deporteMarcador: detectarMarcadorDeporteEnTexto('Texas -110') });
  check(resTexasSinMarcador.estado !== 'SIN_MAPEO' || !resTexasSinMarcador.debug.deporteMarcadorNoCoincide, 'REGRESIÓN: "Texas -110" sin ningún identificador se sigue resolviendo con el único candidato (Texas Rangers, mlb), sin el nuevo chequeo de mismatch');
  check(resTexasSinMarcador.debug.equipoOficial === 'Texas Rangers', 'REGRESIÓN: "Texas -110" solo sigue identificando a Texas Rangers, igual que siempre');

  // Excepción necesaria (🏈 = fútbol americano en general en este sistema,
  // usado tanto para NFL como NCAAF, ver EMOJI_DEPORTE en parser.js): un
  // identificador "nfl" contra un equipo que SOLO es NCAAF no debe romper
  // — es la ambigüedad conocida del propio emoji, no una contradicción
  // real. Reusa el mismo diccionario ampliado de NCAAF vía DICCIONARIO_EQUIPOS_BASE.
  const resMiamiConNFLForzado = evaluarJugada('miami florida alta 66-110', {}, DICCIONARIO_EQUIPOS_BASE, { deporteMarcador: 'nfl' });
  check(!(resMiamiConNFLForzado.debug && resMiamiConNFLForzado.debug.deporteMarcadorNoCoincide), 'EXCEPCIÓN: "miami florida" (solo NCAAF) con el marcador "nfl" forzado (típico del emoji 🏈, que también se usa para NCAAF) NO se marca como mismatch');
  check(resMiamiConNFLForzado.debug.equipoOficial === 'Miami (FL) Hurricanes', 'EXCEPCIÓN: sigue identificando a Miami (FL) Hurricanes correctamente pese al marcador "nfl"');

  // Pero la excepción es SOLO para el par nfl↔ncaaf: un identificador
  // "mlb"/"beisbol" contra un equipo que solo es NCAAF sigue siendo un
  // mismatch real (no hay ninguna ambigüedad conocida ahí).
  const resMiamiConMLBForzado = evaluarJugada('miami florida alta 66-110', {}, DICCIONARIO_EQUIPOS_BASE, { deporteMarcador: 'mlb' });
  check(resMiamiConMLBForzado.estado === 'SIN_MAPEO' && resMiamiConMLBForzado.debug.deporteMarcadorNoCoincide === true, '"miami florida" (solo NCAAF) con "beisbol"/mlb forzado SÍ es un mismatch real (no hay excepción para ese par)');

  // detectarMarcadorDeporteEnTexto(): "futbol universitario"/"fútbol
  // universitario" y "futbol colegial" tienen que forzar NCAAF, no soccer
  // — bug real encontrado implementando este mismo arreglo: como
  // contienen la palabra completa "futbol" (agregada mucho antes, para
  // soccer), el for de palabras clave devolvía 'soccer' antes de llegar a
  // ver la frase más específica. Se arregló ordenando las palabras por
  // largo (más específicas primero) en vez de depender del orden en que
  // se escribieron en el objeto.
  check(detectarMarcadorDeporteEnTexto('Georgia futbol universitario -7 -110') === 'ncaaf', 'BUG REAL: "futbol universitario" ya NO se confunde con "futbol" (soccer) — detecta ncaaf');
  check(detectarMarcadorDeporteEnTexto('Georgia fútbol universitario -7 -110') === 'ncaaf', 'lo mismo con tilde');
  check(detectarMarcadorDeporteEnTexto('Georgia futbol colegial -7 -110') === 'ncaaf', '"futbol colegial" (nuevo, a pedido del usuario) también fuerza ncaaf');
  check(detectarMarcadorDeporteEnTexto('Ohio futbol -110') === 'soccer', 'REGRESIÓN: "futbol" a secas (sin "universitario"/"colegial") sigue siendo soccer');

  // NCAAB (nuevo, a pedido explícito del usuario — "NCAAB", "baloncesto
  // colegial"): todavía no existe como deporte conectado en este sistema
  // (sin diccionario ni API), pero ahora se RECONOCE como identificador
  // explícito — para que, si alguien lo escribe, la jugada quede
  // SIN_MAPEO/PENDIENTE de que se conecte, en vez de colarse por error
  // como NBA solo por compartir la palabra "baloncesto".
  check(detectarMarcadorDeporteEnTexto('Duke -5 ncaab') === 'ncaab', '"ncaab" se reconoce como identificador explícito');
  check(detectarMarcadorDeporteEnTexto('Duke -5 baloncesto colegial') === 'ncaab', '"baloncesto colegial" fuerza ncaab, no basket/NBA');
  check(detectarMarcadorDeporteEnTexto('Duke -5 baloncesto universitario') === 'ncaab', '"baloncesto universitario" también fuerza ncaab');
  check(detectarMarcadorDeporteEnTexto('Lakers -5 baloncesto') === 'basket', 'REGRESIÓN: "baloncesto" a secas (sin "colegial"/"universitario") sigue siendo basket/NBA');
  const resNCAABSinMapeo = evaluarJugada('Duke -5 ncaab', {}, DICCIONARIO_EQUIPOS_BASE, { deporteMarcador: 'ncaab' });
  check(resNCAABSinMapeo.estado === 'SIN_MAPEO', 'una jugada marcada explícitamente "ncaab" da SIN_MAPEO (deporte todavía no soportado), sin colarse como NBA');
})();

// -----------------------------------------------------------------
// Casos 10-15 (desambiguación de apodos con VARIOS candidatos, 28-08-2026):
// un mismo apodo ("miami") con 3 candidatos posibles (MLB/NFL/soccer,
// exactamente el ejemplo que dio el usuario) — confirma cada una de las 5
// capas de resolverCandidatoAmbiguo() en evaluador.js, de la más manual a
// la más automática, y el AMBIGUA final cuando ninguna alcanza.
// -----------------------------------------------------------------
const DICCIONARIO_MIAMI_AMBIGUO = {
  miami: [
    { nombre: 'Miami Marlins', deporte: 'mlb' },
    { nombre: 'Miami Dolphins', deporte: 'nfl' },
    { nombre: 'Miami FC', deporte: 'soccer' }
  ]
};
const DATOS_MIAMI_MLB_JUEGA = {
  'miami marlins': {
    homeTeam: 'Miami Marlins', awayTeam: 'Atlanta Braves',
    homeRuns: 4, awayRuns: 2, totalRuns: 6,
    home5innRuns: 2, away5innRuns: 1, total5innRuns: 3,
    finalizado: true, final5inn: true, suspendido: false
  }
};
const DATOS_MIAMI_NFL_JUEGA = {
  'miami dolphins': {
    deporte: 'nfl', homeTeam: 'Miami Dolphins', awayTeam: 'New York Jets',
    homeScore: 27, awayScore: 10, totalScore: 37, finalizado: true, suspendido: false
  }
};

(function testAmbiguo1SoloUnoJuegaHoy() {
  // Capa "calendario": solo Miami Marlins (MLB) tiene partido hoy -> se
  // resuelve solo, sin necesitar ninguna otra pista.
  const res = evaluarJugada(normalizarTexto('miami -150'), { mlb: DATOS_MIAMI_MLB_JUEGA, nfl: {}, soccer: {} }, DICCIONARIO_MIAMI_AMBIGUO);
  check(res.estado === 'GANADA' && res.debug.equipoOficial === 'Miami Marlins',
    'Ambiguo (3 candidatos): si SOLO uno tiene partido hoy (Marlins/MLB), se resuelve solo por calendario');
})();

(function testAmbiguo2NumeroDesempata() {
  // Capa "número": Marlins Y Dolphins juegan hoy (2 candidatos con
  // partido) — un over/under de 55 solo cabe en el techo de NFL (100), no
  // en el de MLB (20), así que desempata solo sin tocar el calendario de nuevo.
  const datosPorDeporte = { mlb: DATOS_MIAMI_MLB_JUEGA, nfl: DATOS_MIAMI_NFL_JUEGA, soccer: {} };
  const res = evaluarJugada(normalizarTexto('over miami 55 -110'), datosPorDeporte, DICCIONARIO_MIAMI_AMBIGUO);
  // Dolphins 27 + Jets 10 = 37 puntos totales -> Over 55 PIERDE (37 < 55).
  // Lo que importa acá es que se resolvió a Dolphins/NFL (no Marlins/MLB) —
  // el resultado GANADA/PERDIDA de la jugada en sí es aparte.
  check(res.debug.equipoOficial === 'Miami Dolphins',
    'Ambiguo (2 con partido hoy): un número que solo cabe en el techo de NFL (55) desempata a favor de Dolphins/NFL');
  check(res.estado === 'PERDIDA', 'Resuelto a NFL, el Over 55 pierde con el marcador real (37 puntos totales)');
})();

(function testAmbiguo3MarcadorDeSeccionDesempata() {
  // Capa "marcador de sección": mismo empate (Marlins y Dolphins juegan
  // hoy) pero con un hándicap chico (-3) que cabe en el techo de AMBOS
  // deportes -> el número no alcanza a desempatar, así que decide el
  // marcador de sección "[NFL]" (deporteForzado), como si el Grupo hubiera
  // puesto esa línea arriba del ticket en la sábana.
  const datosPorDeporte = { mlb: DATOS_MIAMI_MLB_JUEGA, nfl: DATOS_MIAMI_NFL_JUEGA, soccer: {} };
  const res = evaluarJugada(normalizarTexto('miami -3 -110'), datosPorDeporte, DICCIONARIO_MIAMI_AMBIGUO, { deporteForzado: 'nfl' });
  check(res.estado === 'GANADA' && res.debug.equipoOficial === 'Miami Dolphins',
    'Ambiguo (número no alcanza a desempatar): el marcador de sección "[NFL]" decide a favor de Dolphins');
})();

(function testAmbiguo4QuedaAmbiguaSinPistas() {
  // Sin marcador de sección ni número que desempate: no se adivina, queda
  // AMBIGUA (VARIOS DEPORTES) con los 2 candidatos restantes listados.
  const datosPorDeporte = { mlb: DATOS_MIAMI_MLB_JUEGA, nfl: DATOS_MIAMI_NFL_JUEGA, soccer: {} };
  const res = evaluarJugada(normalizarTexto('miami -3 -110'), datosPorDeporte, DICCIONARIO_MIAMI_AMBIGUO);
  check(res.estado === 'AMBIGUA (VARIOS DEPORTES)', 'Sin ninguna pista que desempate, el ticket queda AMBIGUA (VARIOS DEPORTES), no se adivina');
  check(res.debug.candidatosAmbiguosDetalle && res.debug.candidatosAmbiguosDetalle.length === 2,
    'La alerta trae los 2 candidatos restantes (Marlins/mlb y Dolphins/nfl) para poder resolverla a mano desde "Alertas"');
})();

(function testAmbiguo5MarcadorPorJugadaGanaAlNumero() {
  // Capa "marcador por-jugada" (emoji/palabra clave, ver
  // detectarMarcadorDeporteEnTexto en parser.js): tiene MÁS prioridad que
  // el desempate por número — acá se simula pasando deporteMarcador='mlb'
  // (como si la jugada hubiera traído un "⚾" o la palabra "mlb"). El
  // número por sí solo (over 55) hubiera apuntado a NFL (ver caso
  // "Ambiguo2NumeroDesempata" arriba, con la MISMA jugada pero sin
  // marcador) — acá, en cambio, gana Marlins/MLB, confirmado por
  // equipoOficial. Que la evaluación en sí termine en PENDIENTE (55 no es
  // una línea válida de over/under en MLB, cuyo techo es 20) es la
  // consecuencia correcta y esperable de haber resuelto para MLB.
  const datosPorDeporte = { mlb: DATOS_MIAMI_MLB_JUEGA, nfl: DATOS_MIAMI_NFL_JUEGA, soccer: {} };
  const res = evaluarJugada(normalizarTexto('over miami 55 -110'), datosPorDeporte, DICCIONARIO_MIAMI_AMBIGUO, { deporteMarcador: 'mlb' });
  check(res.debug.equipoOficial === 'Miami Marlins',
    'Ambiguo: el marcador por-jugada ("⚾"/"mlb") le gana al desempate por número — se resuelve a Marlins/MLB, no a Dolphins/NFL');
  check(res.estado === 'PENDIENTE' && /línea numérica/.test(res.razon),
    'Ya resuelto a MLB por el marcador, la jugada evalúa contra datos de MLB — 55 no es una línea válida de over/under ahí (techo 20), así que queda PENDIENTE con motivo claro');
})();

(function testAmbiguo6ResolucionManualGanaATodo() {
  // Capa 0 (la más fuerte): una resolución manual ya guardada (desde la
  // pestaña Alertas, ver alertas.js/resoluciones_ambiguas) le gana incluso
  // al marcador por-jugada.
  const datosPorDeporte = { mlb: DATOS_MIAMI_MLB_JUEGA, nfl: DATOS_MIAMI_NFL_JUEGA, soccer: {} };
  const res = evaluarJugada(normalizarTexto('miami -3 -110'), datosPorDeporte, DICCIONARIO_MIAMI_AMBIGUO, { deporteMarcador: 'mlb', deporteResuelto: 'nfl' });
  check(res.estado === 'GANADA' && res.debug.equipoOficial === 'Miami Dolphins',
    'Ambiguo: una resolución manual previa (deporteResuelto) le gana incluso al marcador por-jugada');
})();

// -----------------------------------------------------------------
// Caso 16: detectarMarcadorDeporteEnTexto() (parser.js) — reconoce emoji
// (⚾/🏈/🏀/⚽/🏒) y palabra clave (nba/basket/nfl/mlb/soccer/nhl/etc.)
// pegados a la jugada, y no confunde nada cuando no hay ninguno.
// -----------------------------------------------------------------
(function testDetectarMarcadorDeporteEnTexto() {
  check(detectarMarcadorDeporteEnTexto('🏈 houston texans -3') === 'nfl', 'Emoji 🏈 al principio de la jugada se detecta como NFL');
  check(detectarMarcadorDeporteEnTexto('houston -150 ⚾') === 'mlb', 'Emoji ⚾ al final de la jugada se detecta como MLB');
  check(detectarMarcadorDeporteEnTexto('houston nba -110') === 'basket', 'Palabra clave "nba" pegada al equipo se detecta como basket');
  check(detectarMarcadorDeporteEnTexto('miami soccer +120') === 'soccer', 'Palabra clave "soccer" se detecta correctamente');
  check(detectarMarcadorDeporteEnTexto('astros -150') === null, 'Una jugada sin emoji ni palabra clave no detecta ningún marcador (null)');
})();

// -----------------------------------------------------------------
// Caso 17: coma o punto para separar decimales en los MONTOS de la sábana
// (bug reportado 28-08-2026 — "100,50//90,91" daba totales mal calculados
// porque esLineaSoloMonto/matchResultado en parser.js solo reconocían el
// punto). Tanto "," como "." tienen que leerse igual.
// -----------------------------------------------------------------
(function testComaDecimalEnMontos() {
  check(normalizarComasDecimales('100,50//90,91') === '100.50//90.91', 'normalizarComasDecimales() convierte coma a punto en un monto con "//"');
  check(normalizarComasDecimales('100.50//90.91') === '100.50//90.91', 'normalizarComasDecimales() no toca un monto que ya viene con punto');

  const textoConComa = ['*RICKY*', 'Ticket 1', 'Red sox -110', '20,50//15,25'].join('\n');
  const boletosComa = parsearSabana(textoConComa, DICCIONARIO_EQUIPOS_BASE);
  check(boletosComa.length === 1 && boletosComa[0].arriesga === 20.5 && boletosComa[0].pagaSabana === 15.25,
    'Un monto "arriesga//paga" escrito con coma ("20,50//15,25") se lee igual que con punto (arriesga=20.5, paga=15.25)');

  const textoConPara = ['*RICKY*', 'Ticket 1', 'Red sox -110 para 50,25'].join('\n');
  const boletosPara = parsearSabana(textoConPara, DICCIONARIO_EQUIPOS_BASE);
  check(boletosPara.length === 1 && boletosPara[0].pagaSabana === 50.25,
    'La ganancia deseada ("para 50,25") escrita con coma también se lee bien (pagaSabana=50.25)');

  const textoConX = ['*RICKY*', 'Ticket 1', 'Red sox -110 x 30,75'].join('\n');
  const boletosX = parsearSabana(textoConX, DICCIONARIO_EQUIPOS_BASE);
  check(boletosX.length === 1 && boletosX[0].arriesga === 30.75,
    'El monto arriesgado ("x 30,75") escrito con coma también se lee bien (arriesga=30.75)');
})();

// -----------------------------------------------------------------
// Caso 18: palabras REFERENCIALES de deporte en detectarMarcadorDeporteEnTexto()
// (pedido explícito del usuario, 28-08-2026: "si te colocan houston y una
// pelota de beisbol o un bate... es houston mlb, así para todos los
// deportes") — no hace falta que el trabajador escriba el nombre técnico
// del deporte, palabras naturales de cada uno también sirven de marcador.
// -----------------------------------------------------------------
(function testPalabrasReferencialesDeporte() {
  check(detectarMarcadorDeporteEnTexto('houston bate -150') === 'mlb', 'Palabra referencial "bate" se detecta como MLB');
  check(detectarMarcadorDeporteEnTexto('houston jonron +120') === 'mlb', 'Palabra referencial "jonron" se detecta como MLB');
  check(detectarMarcadorDeporteEnTexto('houston pitcher -110') === 'mlb', 'Palabra referencial "pitcher" se detecta como MLB');
  check(detectarMarcadorDeporteEnTexto('houston touchdown -3') === 'nfl', 'Palabra referencial "touchdown" se detecta como NFL');
  check(detectarMarcadorDeporteEnTexto('houston mariscal -3') === 'nfl', 'Palabra referencial "mariscal" se detecta como NFL');
  check(detectarMarcadorDeporteEnTexto('miami disco -110') === 'nhl', 'Palabra referencial "disco" se detecta como NHL');
  check(detectarMarcadorDeporteEnTexto('miami arquero -110') === 'soccer', 'Palabra referencial "arquero" se detecta como Fútbol');
  check(detectarMarcadorDeporteEnTexto('miami canasta -110') === 'basket', 'Palabra referencial "canasta" se detecta como Basket');
})();

// -----------------------------------------------------------------
// Caso 19: 2 formatos REALES de un grupo (28-08-2026) — el sábado deporte
// se indica con la LIGA pegada al equipo (MLB/NFL) en vez de emoji, y la
// ganancia deseada se escribe "PARA GANAR <monto>" en vez de "PARA <monto>"
// a secas. Antes de este arreglo, los 2 quedaban "FALTA CERRAR EN SÁBANA"
// (el monto se perdía en silencio en ambos casos) en vez de cerrarse solos.
// -----------------------------------------------------------------
(function testFormatosRealesLigaPegadaYParaGanar() {
  // Ejemplo A: parley de 2 patas, cada una con su propia liga (MLB/NFL)
  // pegada al equipo, y el monto arriesgado ("X 400") en la MISMA línea de
  // las jugadas en vez de en su propia línea aparte.
  const textoA = ['*CLIENTE A*', 'Houston MLB -190 x Houston NFL -190 x 400'].join('\n');
  const boletosA = parsearSabana(textoA, DICCIONARIO_EQUIPOS_BASE);
  check(boletosA.length === 1, 'Ejemplo real A: se detecta 1 solo ticket para el parley');
  check(boletosA[0].jugadas.length === 2, 'Ejemplo real A: se separan las 2 patas (Houston MLB / Houston NFL)');
  check(boletosA[0].arriesga === 400, 'Ejemplo real A: el monto arriesgado ("x 400" pegado a la última pata) se lee bien (arriesga=400), ya no se pierde');
  check(!boletosA[0].sinResultadoEnSabana, 'Ejemplo real A: el ticket YA NO queda "FALTA CERRAR EN SÁBANA"');
  check(detectarMarcadorDeporteEnTexto(boletosA[0].jugadas[0]) === 'mlb', 'Ejemplo real A: la 1ra pata ("Houston MLB") se marca como MLB por su propia liga pegada');
  check(detectarMarcadorDeporteEnTexto(boletosA[0].jugadas[1]) === 'nfl', 'Ejemplo real A: la 2da pata ("Houston NFL") se marca como NFL por su propia liga pegada, sin confundirse con la 1ra');

  // Ejemplo B: 1 sola pata, "PARA GANAR <monto>" (con la palabra "GANAR" en
  // el medio) en vez de "PARA <monto>" — tiene que auto-cerrar calculando
  // el arriesgo desde la cuota, igual que ya hacía con "PARA <monto>" a secas.
  const textoB = ['*CLIENTE B*', 'Miami NFL -129 para ganar 700'].join('\n');
  const boletosB = parsearSabana(textoB, DICCIONARIO_EQUIPOS_BASE);
  check(boletosB.length === 1, 'Ejemplo real B: se detecta 1 ticket');
  check(boletosB[0].pagaSabana === 700, 'Ejemplo real B: la ganancia deseada ("para ganar 700") se lee bien (pagaSabana=700)');
  check(boletosB[0].cierreAutomatico === true, 'Ejemplo real B: el ticket se auto-cierra calculando el arriesgo desde la cuota, como ya hacía "PARA <monto>"');
  check(boletosB[0].cuotaCierreAutomatico === -129, 'Ejemplo real B: la cuota usada para el auto-cierre es -129 (la de Miami NFL), no el 700 de "ganar 700"');
  check(Math.abs(boletosB[0].arriesga - 903) < 0.01, 'Ejemplo real B: arriesga = $903 (700 * 129/100, la cuota -129 a favor)');
})();

// -----------------------------------------------------------------
// Caso 20: "BESIBOL" (variante fonética de "béisbol" que usa algún grupo,
// 28-08-2026) como palabra referencial de MLB.
// -----------------------------------------------------------------
(function testBesibol() {
  check(detectarMarcadorDeporteEnTexto('houston besibol -190') === 'mlb', 'Palabra referencial "besibol" (variante fonética de béisbol) se detecta como MLB');
})();

// -----------------------------------------------------------------
// Caso 21: "SIN LOGRO" (28-08-2026, a pedido del usuario) — una jugada de
// CUALQUIER tipo (alta/baja, moneyline, run line/hándicap) puede llegar sin
// el número que hace falta para verificarla o pagarla. evaluador.js debe
// marcarla SIN_LOGRO (en vez de PENDIENTE o de adivinar) en cada caso, y
// extraerCuotaAmericana() (parser.js) debe ignorar números que NO puedan
// ser una cuota real (magnitud < 100), incluso si son el único número
// presente en la jugada.
// -----------------------------------------------------------------
(function testSinLogro() {
  const datosMLB = {
    'atlanta braves': {
      homeTeam: 'Atlanta Braves', awayTeam: 'Miami Marlins',
      homeRuns: 6, awayRuns: 5, totalRuns: 11,
      home5innRuns: 2, away5innRuns: 1, total5innRuns: 3,
      finalizado: true, final5inn: true, suspendido: false
    },
    'miami marlins': {
      homeTeam: 'Atlanta Braves', awayTeam: 'Miami Marlins',
      homeRuns: 6, awayRuns: 5, totalRuns: 11,
      home5innRuns: 2, away5innRuns: 1, total5innRuns: 3,
      finalizado: true, final5inn: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: datosMLB, nfl: {}, soccer: {} };

  // (a) Over/under SIN ningún número (ni línea ni cuota): "alta atlanta",
  // sin el "4.5" ni el "-120". No hay forma de saber si ganó o perdió.
  const resAlta = evaluarJugada(normalizarTexto('alta atlanta'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resAlta.estado === 'SIN_LOGRO', 'SIN LOGRO (a): "alta atlanta" sin línea ni cuota queda SIN_LOGRO, no PENDIENTE ni GANADA/PERDIDA');

  // (b) Moneyline/hándicap SIN ningún número: "atlanta" a secas, sin cuota
  // de moneyline ni línea de hándicap/run line.
  const resMoneyline = evaluarJugada(normalizarTexto('atlanta'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resMoneyline.estado === 'SIN_LOGRO', 'SIN LOGRO (b): "atlanta" a secas (sin moneyline ni run line) queda SIN_LOGRO, no se adivina con el marcador solo');

  // (c) Over/under CON la línea presente pero SIN la cuota: "alta atlanta
  // 4.5" resuelve GANADA/PERDIDA bien (usa el marcador de 5inn si se pide,
  // o el completo) porque evaluador.js NO necesita la cuota para eso — pero
  // extraerCuotaAmericana() debe devolver null (no hay ninguna cuota real),
  // que es lo que procesarSabana.js usa para igual marcar el TICKET como
  // FALTA LOGRO (no se puede calcular el pago del parley/jugada directa).
  const resAltaConLinea = evaluarJugada(normalizarTexto('alta atlanta 4.5'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resAltaConLinea.estado === 'GANADA', 'SIN LOGRO (c): "alta atlanta 4.5" SÍ resuelve GANADA/PERDIDA con solo la línea (11 > 4.5)');
  check(extraerCuotaAmericana(normalizarTexto('alta atlanta 4.5')) === null,
    'SIN LOGRO (c): pero extraerCuotaAmericana() no encuentra ninguna cuota real (magnitud >= 100) en "alta atlanta 4.5" — el 4.5 es la línea, no una cuota');

  // (d) Regresión: un número que SÍ tiene magnitud de cuota real (>= 100)
  // se sigue reconociendo bien, sin falsos SIN_LOGRO/null.
  check(extraerCuotaAmericana(normalizarTexto('atlanta -120')) === -120,
    'SIN LOGRO (d, regresión): "atlanta -120" sí tiene una cuota real y extraerCuotaAmericana() la reconoce (no un falso SIN_LOGRO)');

  // (e) Regresión clave: un número FUERA de rango como línea (ej. un "over
  // 55" que terminó resuelto contra MLB, cuyo techo es 20) NO es lo mismo
  // que "sin logro" — sigue quedando PENDIENTE con motivo claro, como ya
  // pasaba antes de este cambio (ver también Caso "Ambiguo5" más arriba).
  const resFueraDeRango = evaluarJugada(normalizarTexto('over atlanta 55 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resFueraDeRango.estado === 'PENDIENTE' && /línea numérica/.test(resFueraDeRango.razon),
    'SIN LOGRO (e, regresión): un número fuera del rango válido de línea NO se confunde con SIN_LOGRO — sigue quedando PENDIENTE con motivo claro');
})();

// -----------------------------------------------------------------
// Caso 22 (NHL, 28-08-2026): hándicap (puck line) y over/under de goles,
// con techos propios (rangoHandicapMax 2.5, rangoLineaMax 12) muy
// distintos a los de MLB/NFL — confirma que CONFIG_POR_DEPORTE.nhl
// detecta bien la línea aunque sea un número chico (típico de hockey,
// parecido a MLB en magnitud pero un deporte totalmente distinto).
// -----------------------------------------------------------------
(function testNHLHandicapYOverUnder() {
  const datosNHL = {
    'edmonton oilers': {
      deporte: 'nhl', homeTeam: 'Edmonton Oilers', awayTeam: 'Calgary Flames',
      homeScore: 5, awayScore: 2, totalScore: 7, finalizado: true, suspendido: false
    },
    'calgary flames': {
      deporte: 'nhl', homeTeam: 'Edmonton Oilers', awayTeam: 'Calgary Flames',
      homeScore: 5, awayScore: 2, totalScore: 7, finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: datosNHL, soccer: {} };

  // Oilers ganaron por 3 (5-2). Puck line -1.5 SÍ cubre (3 > 1.5).
  const resHandicap = evaluarJugada(normalizarTexto('Oilers -1.5 -120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resHandicap.estado === 'GANADA', 'NHL: Oilers -1.5 (puck line) cubre con un margen real de 3 goles -> GANADA');

  // Total de goles = 7. Over 6.5 gana.
  const resOver = evaluarJugada(normalizarTexto('Over Flames 6.5 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resOver.estado === 'GANADA', 'NHL: Over 6.5 con 7 goles totales -> GANADA');
})();

// -----------------------------------------------------------------
// Caso 23 (Fútbol, 28-08-2026): la regla confirmada por el usuario — un
// empate con apuesta moneyline pura ("gana el equipo") se cuenta como
// PERDIDA, NO como push/ANULADA (a diferencia de MLB/NFL/NHL, donde un
// empate en moneyline SIEMPRE es push). Un hándicap real que empata la
// línea exacta, en cambio, sigue siendo push como en cualquier deporte.
// -----------------------------------------------------------------
(function testSoccerEmpateEsPerdidaEnMoneyline() {
  const datosSoccer = {
    'liverpool': {
      deporte: 'soccer', liga: 'Premier League', homeTeam: 'Liverpool', awayTeam: 'Chelsea',
      homeScore: 1, awayScore: 1, totalScore: 2, finalizado: true, suspendido: false
    },
    'chelsea': {
      deporte: 'soccer', liga: 'Premier League', homeTeam: 'Liverpool', awayTeam: 'Chelsea',
      homeScore: 1, awayScore: 1, totalScore: 2, finalizado: true, suspendido: false
    },
    // Partido aparte, SIN empate, para probar el hándicap real por separado
    // (Barcelona ganó por 1 exacto — con línea -1 eso es empate CONTRA LA
    // LÍNEA, un push real, sin que el partido en sí haya sido un empate).
    'barcelona': {
      deporte: 'soccer', liga: 'La Liga', homeTeam: 'Barcelona', awayTeam: 'Valencia',
      homeScore: 2, awayScore: 1, totalScore: 3, finalizado: true, suspendido: false
    },
    'valencia': {
      deporte: 'soccer', liga: 'La Liga', homeTeam: 'Barcelona', awayTeam: 'Valencia',
      homeScore: 2, awayScore: 1, totalScore: 3, finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: {}, soccer: datosSoccer };

  // Moneyline puro (sin línea de hándicap) con empate 1-1 -> PERDIDA.
  const resMoneyline = evaluarJugada(normalizarTexto('Liverpool -150'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resMoneyline.estado === 'PERDIDA', 'Fútbol: "Liverpool -150" (moneyline, gana el equipo) con empate 1-1 -> PERDIDA, no ANULADA');

  // Hándicap real (Barcelona -1, línea entera): Barcelona ganó por exactamente
  // 1 (2-1) -> con la línea -1 eso empata la línea (push), a pesar de que el
  // partido NO terminó empatado — confirma que la regla de "empate pierde"
  // es SOLO para moneyline puro (hándicap 0), no para un hándicap real.
  const resHandicapPush = evaluarJugada(normalizarTexto('Barcelona -1 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resHandicapPush.estado === 'ANULADA', 'Fútbol: un hándicap real que empata la línea exacta sigue siendo push (ANULADA), la regla de empate-pierde es SOLO para moneyline puro');

  // Over/under de goles: total = 2 (Liverpool-Chelsea), over 2.5 pierde.
  const resOver = evaluarJugada(normalizarTexto('Over Chelsea 2.5 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resOver.estado === 'PERDIDA', 'Fútbol: Over 2.5 con 2 goles totales -> PERDIDA');
})();

// -----------------------------------------------------------------
// Caso 24 (multi-deporte ampliado, 28-08-2026): una sábana con Ticket 1 de
// NHL y Ticket 2 de fútbol, resuelta en una sola llamada a
// procesarSabana()/evaluarJugada() sin indicar el deporte en ningún lado
// — mismo criterio que ya se probó para MLB+NFL (Caso 8).
// -----------------------------------------------------------------
(function testNHLYFutbolEnUnaSolaSabana() {
  const datosNHL = {
    'vegas golden knights': {
      deporte: 'nhl', homeTeam: 'Vegas Golden Knights', awayTeam: 'San Jose Sharks',
      homeScore: 4, awayScore: 1, totalScore: 5, finalizado: true, suspendido: false
    },
    'san jose sharks': {
      deporte: 'nhl', homeTeam: 'Vegas Golden Knights', awayTeam: 'San Jose Sharks',
      homeScore: 4, awayScore: 1, totalScore: 5, finalizado: true, suspendido: false
    }
  };
  const datosSoccer = {
    'real madrid': {
      deporte: 'soccer', liga: 'La Liga', homeTeam: 'Real Madrid', awayTeam: 'Sevilla',
      homeScore: 3, awayScore: 0, totalScore: 3, finalizado: true, suspendido: false
    },
    'sevilla': {
      deporte: 'soccer', liga: 'La Liga', homeTeam: 'Real Madrid', awayTeam: 'Sevilla',
      homeScore: 3, awayScore: 0, totalScore: 3, finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: datosNHL, soccer: datosSoccer };

  const resTicket1 = evaluarJugada(normalizarTexto('Golden Knights -120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resTicket1.estado === 'GANADA', 'Multi-deporte ampliado: Ticket de NHL se resuelve solo contra los datos de NHL, sin indicar el deporte');

  const resTicket2 = evaluarJugada(normalizarTexto('Real Madrid -150'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resTicket2.estado === 'GANADA', 'Multi-deporte ampliado: Ticket de fútbol se resuelve solo contra los datos de fútbol, en la MISMA llamada que el de NHL');
})();

// -----------------------------------------------------------------
// Caso 25 (31-08-2026): apuesta AL EMPATE en fútbol — "Napoli e (+201)" y
// "Napoli empate +201" (las 2 formas reales que manda el grupo del
// usuario) deben reconocerse como el mismo tipo de apuesta: GANADA si el
// partido termina empatado, PERDIDA si no — sin importar el hándicap ni
// ningún otro número. Es DISTINTO de la regla "empate = perdida en
// moneyline" (Caso 23): acá el cliente apostó AL empate mismo, no a que
// un equipo gane.
// -----------------------------------------------------------------
(function testApuestaAlEmpateFutbol() {
  const datosEmpate = {
    'napoli': {
      deporte: 'soccer', liga: 'Serie A', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 1, awayScore: 1, totalScore: 2, finalizado: true, suspendido: false
    },
    'inter milan': {
      deporte: 'soccer', liga: 'Serie A', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 1, awayScore: 1, totalScore: 2, finalizado: true, suspendido: false
    }
  };
  const datosSinEmpate = {
    'napoli': {
      deporte: 'soccer', liga: 'Serie A', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 2, awayScore: 0, totalScore: 2, finalizado: true, suspendido: false
    },
    'inter milan': {
      deporte: 'soccer', liga: 'Serie A', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 2, awayScore: 0, totalScore: 2, finalizado: true, suspendido: false
    }
  };
  const datosPorDeporteEmpate = { mlb: {}, nfl: {}, nhl: {}, soccer: datosEmpate };
  const datosPorDeporteSinEmpate = { mlb: {}, nfl: {}, nhl: {}, soccer: datosSinEmpate };

  // Forma "E (+201)", tal cual llega en la sábana real del usuario.
  const resLetraEGana = evaluarJugada(normalizarTexto('Napoli e (+201)'), datosPorDeporteEmpate, DICCIONARIO_EQUIPOS_BASE);
  check(resLetraEGana.estado === 'GANADA', 'Empate (a): "Napoli e (+201)" con el partido 1-1 -> GANADA');

  const resLetraEPierde = evaluarJugada(normalizarTexto('Napoli e (+201)'), datosPorDeporteSinEmpate, DICCIONARIO_EQUIPOS_BASE);
  check(resLetraEPierde.estado === 'PERDIDA', 'Empate (b): "Napoli e (+201)" con el partido 2-0 (no empató) -> PERDIDA');

  // Forma "empate +201", la otra que manda el mismo grupo.
  const resPalabraGana = evaluarJugada(normalizarTexto('Napoli empate +201'), datosPorDeporteEmpate, DICCIONARIO_EQUIPOS_BASE);
  check(resPalabraGana.estado === 'GANADA', 'Empate (c): "Napoli empate +201" con el partido 1-1 -> GANADA (misma regla, otra forma de escribirlo)');

  // Regresión: una jugada normal de hándicap/moneyline (SIN "e" ni
  // "empate") no debe activar esta rama por error.
  const resNormal = evaluarJugada(normalizarTexto('Inter Milan -1.5 +120'), datosPorDeporteSinEmpate, DICCIONARIO_EQUIPOS_BASE);
  check(resNormal.estado !== undefined && resNormal.debug && resNormal.debug.tipoApuesta && !/EMPATE/.test(resNormal.debug.tipoApuesta), 'Empate (d, regresión): "Inter Milan -1.5 +120" (hándicap normal) NO se confunde con una apuesta al empate');
})();

// -----------------------------------------------------------------
// Caso 26 (31-08-2026): apuesta AL EMPATE en NFL — mismo mecanismo que
// fútbol, aunque en la práctica casi nunca se dé (un partido de NFL rara
// vez termina empatado).
// -----------------------------------------------------------------
(function testApuestaAlEmpateNFL() {
  const datosNFLEmpate = {
    'pittsburgh steelers': {
      deporte: 'nfl', homeTeam: 'Pittsburgh Steelers', awayTeam: 'Cincinnati Bengals',
      homeScore: 17, awayScore: 17, totalScore: 34, finalizado: true, suspendido: false
    },
    'cincinnati bengals': {
      deporte: 'nfl', homeTeam: 'Pittsburgh Steelers', awayTeam: 'Cincinnati Bengals',
      homeScore: 17, awayScore: 17, totalScore: 34, finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: {}, nfl: datosNFLEmpate, nhl: {}, soccer: {} };
  const res = evaluarJugada(normalizarTexto('Steelers empate +1800'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'GANADA', 'Empate en NFL: "Steelers empate +1800" con el partido 17-17 -> GANADA');
})();

// -----------------------------------------------------------------
// Caso 27 (31-08-2026): "1h" (primera mitad) en MLB — el usuario confirmó
// que significa exactamente lo mismo que "5inn"/"5to" (mismos campos,
// mismo comportamiento) — se prueba que ambas palabras dan el mismo
// resultado sobre los mismos datos.
// -----------------------------------------------------------------
(function testMLB1hEsAliasDe5inn() {
  const datosMLB = {
    'atlanta braves': {
      homeTeam: 'Atlanta Braves', awayTeam: 'Miami Marlins',
      homeRuns: 6, awayRuns: 5, totalRuns: 11,
      home5innRuns: 2, away5innRuns: 1, total5innRuns: 3,
      finalizado: true, final5inn: true, suspendido: false
    },
    'miami marlins': {
      homeTeam: 'Atlanta Braves', awayTeam: 'Miami Marlins',
      homeRuns: 6, awayRuns: 5, totalRuns: 11,
      home5innRuns: 2, away5innRuns: 1, total5innRuns: 3,
      finalizado: true, final5inn: true, suspendido: false
    }
  };
  const res5inn = evaluarJugadaMLB(normalizarTexto('alta Atlanta 4.5 5inn'), datosMLB, DICCIONARIO_EQUIPOS_BASE);
  const res1h = evaluarJugadaMLB(normalizarTexto('alta Atlanta 4.5 1h'), datosMLB, DICCIONARIO_EQUIPOS_BASE);
  check(res5inn.estado === 'PERDIDA' && res1h.estado === res5inn.estado, '"1h" en MLB da el mismo resultado que "5inn" (3 carreras parciales < 4.5 -> PERDIDA en ambas)');
})();

// -----------------------------------------------------------------
// Caso 28 (31-08-2026): "1h" (primera mitad) en NFL — usa la suma de los
// cuartos 1 y 2 (campo nuevo homeScore1H/awayScore1H, ver nflApi.js), y
// queda PENDIENTE mientras `final1H` sea false aunque el juego siga en
// vivo, sin adivinar con el marcador del juego completo.
// -----------------------------------------------------------------
(function testNFL1hPrimeraMitad() {
  const datosNFL1hTerminada = {
    'kansas city chiefs': {
      deporte: 'nfl', homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos',
      homeScore: 24, awayScore: 10, totalScore: 34,
      homeScore1H: 14, awayScore1H: 3, final1H: true,
      finalizado: true, suspendido: false
    },
    'denver broncos': {
      deporte: 'nfl', homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos',
      homeScore: 24, awayScore: 10, totalScore: 34,
      homeScore1H: 14, awayScore1H: 3, final1H: true,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporteTerminada = { mlb: {}, nfl: datosNFL1hTerminada, nhl: {}, soccer: {} };

  // Chiefs -7 en la primera mitad: ganaron la 1ra mitad 14-3 (margen de
  // 11) -> cubre el -7.
  const resHandicap1h = evaluarJugada(normalizarTexto('Chiefs -7 1h -110'), datosPorDeporteTerminada, DICCIONARIO_EQUIPOS_BASE);
  check(resHandicap1h.estado === 'GANADA', 'NFL 1h: "Chiefs -7 1h" con 1ra mitad 14-3 (margen 11) -> GANADA, no se confunde con el juego completo (24-10, margen 14)');

  // Over de la 1ra mitad: 14+3=17 puntos en la 1ra mitad.
  const resOver1h = evaluarJugada(normalizarTexto('Over Broncos 16.5 1h -110'), datosPorDeporteTerminada, DICCIONARIO_EQUIPOS_BASE);
  check(resOver1h.estado === 'GANADA', 'NFL 1h: Over 16.5 con 17 puntos en la 1ra mitad -> GANADA (usa homeScore1H+awayScore1H, no el total del juego)');

  // Si la 1ra mitad todavía NO terminó (final1H: false), aunque el campo
  // "finalizado" del juego completo también sea false, debe quedar
  // PENDIENTE — no se adivina con datos parciales a medio armar.
  const datosNFL1hEnCurso = {
    'kansas city chiefs': {
      deporte: 'nfl', homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos',
      homeScore: 7, awayScore: 3, totalScore: 10,
      homeScore1H: 7, awayScore1H: 3, final1H: false,
      finalizado: false, suspendido: false
    },
    'denver broncos': {
      deporte: 'nfl', homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos',
      homeScore: 7, awayScore: 3, totalScore: 10,
      homeScore1H: 7, awayScore1H: 3, final1H: false,
      finalizado: false, suspendido: false
    }
  };
  const datosPorDeporteEnCurso = { mlb: {}, nfl: datosNFL1hEnCurso, nhl: {}, soccer: {} };
  const resPendiente = evaluarJugada(normalizarTexto('Chiefs -7 1h -110'), datosPorDeporteEnCurso, DICCIONARIO_EQUIPOS_BASE);
  check(resPendiente.estado === 'PENDIENTE', 'NFL 1h: con final1H=false queda PENDIENTE aunque ya haya marcador parcial, no se adivina antes de tiempo');
})();

// -----------------------------------------------------------------
// Caso 29 (31-08-2026, regresión): "1h" no debe romper la extracción de
// números de una jugada normal — el "1" de "1h" NO debe leerse como un
// hándicap de 1 punto/carrera (bug que existiría si no se limpiara "1h"
// del texto antes de buscar números, igual que ya se hacía con "5inn").
// -----------------------------------------------------------------
(function testUnDeLaMarca1hNoSeConfundeConHandicap() {
  const datosNFL = {
    'kansas city chiefs': {
      deporte: 'nfl', homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos',
      homeScore: 24, awayScore: 10, totalScore: 34,
      homeScore1H: 14, awayScore1H: 3, final1H: true,
      finalizado: true, suspendido: false
    },
    'denver broncos': {
      deporte: 'nfl', homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos',
      homeScore: 24, awayScore: 10, totalScore: 34,
      homeScore1H: 14, awayScore1H: 3, final1H: true,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: {}, nfl: datosNFL, nhl: {}, soccer: {} };
  // Sin ningún hándicap real, solo el "1h" y la cuota de moneyline -160.
  // Si el "1" de "1h" se colara como hándicap, esto evaluaría con
  // hándicap=1 en vez de moneyline puro — el resultado GANADA sería el
  // mismo en este caso (Chiefs ganan la 1ra mitad de sobra), así que la
  // prueba real está en el debug: tipoApuesta debe decir "MONEYLINE", no
  // "HÁNDICAP +1".
  const res = evaluarJugada(normalizarTexto('Chiefs 1h -160'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res.debug && /^MONEYLINE/.test(res.debug.tipoApuesta), 'Regresión: "Chiefs 1h -160" se lee como MONEYLINE, no como hándicap +1 (el "1" de "1h" no se confunde con un número de la jugada)');
})();

// -----------------------------------------------------------------
// Caso 30 (31-08-2026): "1h" en fútbol — el evaluador ya sabe leer
// homeScore1H/awayScore1H/final1H para fútbol (mismo mecanismo que MLB y
// NFL); el cruce REAL contra football-data.org que arma esos campos se
// prueba aparte en test/test_futbol_primera_mitad.js — acá solo se
// confirma que evaluador.js los usa bien una vez que ya están puestos.
// -----------------------------------------------------------------
(function testFutbol1hPrimeraMitad() {
  const datosSoccer1hTerminada = {
    'napoli': {
      deporte: 'soccer', liga: 'Serie A', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 1, awayScore: 2, totalScore: 3,
      homeScore1H: 1, awayScore1H: 0, final1H: true,
      finalizado: true, suspendido: false
    },
    'inter milan': {
      deporte: 'soccer', liga: 'Serie A', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 1, awayScore: 2, totalScore: 3,
      homeScore1H: 1, awayScore1H: 0, final1H: true,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: {}, soccer: datosSoccer1hTerminada };

  // Napoli -0.5 en la 1ra mitad: iba ganando 1-0 al descanso -> cubre.
  const resHandicap1h = evaluarJugada(normalizarTexto('Napoli -0.5 1h -120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resHandicap1h.estado === 'GANADA', 'Fútbol 1h: "Napoli -0.5 1h" con la 1ra mitad 1-0 -> GANADA, no se confunde con el resultado final (1-2, Napoli terminó perdiendo)');

  // Sin "1h" configurado (juego SIN esos campos, ej. Liga MX/MLS/
  // Libertadores/Sudamericana, o Serie A sin que se haya podido cruzar el
  // nombre del equipo): debe quedar PENDIENTE, nunca romper ni adivinar
  // con el resultado del juego completo.
  const datosSoccerSin1h = {
    'club américa': {
      deporte: 'soccer', liga: 'Liga MX', homeTeam: 'Club América', awayTeam: 'Chivas Guadalajara',
      homeScore: 2, awayScore: 0, totalScore: 2,
      finalizado: true, suspendido: false
      // sin homeScore1H/awayScore1H/final1H — esta liga no tiene "1h" todavía.
    },
    'chivas guadalajara': {
      deporte: 'soccer', liga: 'Liga MX', homeTeam: 'Club América', awayTeam: 'Chivas Guadalajara',
      homeScore: 2, awayScore: 0, totalScore: 2,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporteSin1h = { mlb: {}, nfl: {}, nhl: {}, soccer: datosSoccerSin1h };
  const resSinDatos = evaluarJugada(normalizarTexto('Club America -0.5 1h -120'), datosPorDeporteSin1h, DICCIONARIO_EQUIPOS_BASE);
  check(resSinDatos.estado === 'PENDIENTE', 'Fútbol 1h: en una liga sin datos de "1h" (ej. Liga MX todavía), la jugada queda PENDIENTE en vez de romper o adivinar con el resultado final');
})();

// -----------------------------------------------------------------
// Caso 31 (31-08-2026, a partir de un ticket real del usuario): parley
// con una pata PUSH. Ticket real: "⚾Houston alta 9-105⭕ / ⚾Oakland alta
// 10-110 / 150 / 150//136✅" — la alta de Houston (9) cerró EXACTO en 9
// carreras (push/ANULADA, marcado con ⭕ en el ticket); la de Oakland (10)
// SÍ ganó (11 carreras). Regla del usuario: la pata push se SACA del
// parley y el pago se recalcula usando SOLO la cuota de la(s) pata(s)
// que sí jugaron, sobre el mismo arriesgado — nunca combinando la cuota
// de la pata push como si se hubiera jugado normal. $150 a -110 (solo
// Oakland) da $136.36 ≈ $136, tal como cerró el ticket real.
// -----------------------------------------------------------------
(function testParleyConPataPush() {
  const datosMLB = {
    'houston astros': {
      homeTeam: 'Houston Astros', awayTeam: 'Seattle Mariners',
      homeRuns: 5, awayRuns: 4, totalRuns: 9,
      finalizado: true, suspendido: false
    },
    'athletics': {
      homeTeam: 'Athletics', awayTeam: 'Texas Rangers',
      homeRuns: 6, awayRuns: 5, totalRuns: 11,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: datosMLB, nfl: {}, nhl: {}, soccer: {} };

  const texto = ['*CLIENTE*', 'Ticket 9', '⚾Houston alta 9-105', '⚾Oakland alta 10-110', '150'].join('\n');
  const boletos = parsearSabana(texto, DICCIONARIO_EQUIPOS_BASE);
  check(boletos.length === 1 && boletos[0].jugadas.length === 2, 'Parley con push: se detecta 1 ticket con 2 patas (Houston/Oakland)');

  const jugadasNorm = boletos[0].jugadas.map(normalizarTexto);
  const resultados = boletos[0].jugadas.map((jOriginal, i) => evaluarJugada(jugadasNorm[i], datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, {
    deporteMarcador: detectarMarcadorDeporteEnTexto(jOriginal)
  }));
  const estados = resultados.map(r => r.estado);

  check(estados[0] === 'ANULADA', 'Parley con push: "Houston alta 9" cerró EXACTO en 9 carreras -> push (ANULADA)');
  check(estados[1] === 'GANADA', 'Parley con push: "Oakland alta 10" con 11 carreras -> GANADA');

  const pago = calcularPagoParley(jugadasNorm, boletos[0].arriesga, estados);
  // Solo la cuota de Oakland (-110) cuenta -> 150 * (1 + 100/110) - 150 = 136.36...
  const esperado = 150 * (1 + 100 / 110) - 150;
  check(pago !== null && Math.abs(pago - esperado) < 0.01, 'Parley con push: la pata push se saca del cálculo — el pago usa SOLO la cuota de Oakland (≈$' + esperado.toFixed(2) + '), no las 2 cuotas combinadas (esto es lo que estaba mal antes del arreglo)');

  // Regresión de la cuenta VIEJA (incorrecta): si alguien combinara las 2
  // cuotas como si ninguna fuera push, daría un número bien distinto —
  // confirma que el arreglo realmente cambió el resultado, no que
  // "coincidió" con el viejo cálculo por casualidad.
  const pagoViejoIncorrecto = 150 * (1 + 100 / 105) * (1 + 100 / 110) - 150;
  check(Math.abs(pago - pagoViejoIncorrecto) > 50, 'Parley con push: el resultado nuevo es bien distinto del cálculo viejo que combinaba las 2 cuotas sin sacar la pata push (≈$' + pagoViejoIncorrecto.toFixed(2) + ')');
})();

// -----------------------------------------------------------------
// Caso 32: parley donde TODAS las patas resultan push -> el ticket
// ENTERO queda ANULADA (se devuelve el arriesgado, ni gana ni pierde),
// no solo la pata de 1 sola jugada (antes solo se chequeaba
// `jugadas.length === 1` para el estado ANULADA del ticket).
// -----------------------------------------------------------------
(function testParleyTodasLasPatasPush() {
  const datosMLB = {
    'houston astros': {
      homeTeam: 'Houston Astros', awayTeam: 'Seattle Mariners',
      homeRuns: 5, awayRuns: 4, totalRuns: 9,
      finalizado: true, suspendido: false
    },
    'athletics': {
      homeTeam: 'Athletics', awayTeam: 'Texas Rangers',
      homeRuns: 5, awayRuns: 5, totalRuns: 10,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: datosMLB, nfl: {}, nhl: {}, soccer: {} };

  const texto = ['*CLIENTE*', 'Ticket 10', '⚾Houston alta 9-105', '⚾Oakland alta 10-110', '150'].join('\n');
  const boletos = parsearSabana(texto, DICCIONARIO_EQUIPOS_BASE);
  const jugadasNorm = boletos[0].jugadas.map(normalizarTexto);
  const resultados = boletos[0].jugadas.map((jOriginal, i) => evaluarJugada(jugadasNorm[i], datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, {
    deporteMarcador: detectarMarcadorDeporteEnTexto(jOriginal)
  }));
  const estados = resultados.map(r => r.estado);

  check(estados[0] === 'ANULADA' && estados[1] === 'ANULADA', 'Las 2 patas cerraron EXACTO en su línea -> ambas push');

  const pago = calcularPagoParley(jugadasNorm, boletos[0].arriesga, estados);
  check(pago === null, 'Con TODAS las patas push, calcularPagoParley() no calcula ningún parley (null) — el ticket entero queda ANULADA en procesarSabana.js, no un parley a medio pagar');
})();

// -----------------------------------------------------------------
// Casos 33-41 (31-08-2026, a pedido del usuario, corregidos el MISMO día
// después de que el usuario aclaró un malentendido): NBA agregada como
// deporte completo + apuestas "1ra mitad"/"2da mitad" (NBA) y "por
// período" individual (NHL). OJO — el diseño original de esta entrega le
// había puesto a NBA apuestas por CUARTO individual (igual que NHL) — el
// usuario aclaró que eso está MAL: "Nba funciona solo de dos maneras para
// la primera mitad que son los dos primero cuartos y para la segunda
// mitad que son los ultimos dos cuartos y para el partido entero... la
// nhl si se dividen por si juegan el juego completo o si juegan por cada
// periodo individual". Los casos de abajo reflejan el diseño CORREGIDO:
// NBA usa "1h"/"2h" (mismo mecanismo que ya usaba MLB/NFL para "1h"), NHL
// sigue usando "por período" individual (ej. "Panthers over 1Q 3 -120").
// Todos estos casos usan datos inventados con la MISMA forma que
// devuelven nbaApi.js/nhlApi.js de verdad.
// -----------------------------------------------------------------
const DATOS_NBA_TERMINADO = (function () {
  // Kings (local) 105 = 30+25+28+22 por cuarto; Bucks (visitante) 97 =
  // 28+24+25+20 por cuarto. 1ra mitad (cuartos 1+2): Kings 55, Bucks 52,
  // total 107. 2da mitad (cuartos 3+4): Kings 50, Bucks 45, total 95.
  const juego = {
    homeTeam: 'Sacramento Kings', awayTeam: 'Milwaukee Bucks',
    homeScore: 105, awayScore: 97, totalScore: 202,
    homeLinescores: [30, 25, 28, 22], awayLinescores: [28, 24, 25, 20],
    cuartosCompletos: 4,
    homeScore1H: 55, awayScore1H: 52, final1H: true,
    homeScore2H: 50, awayScore2H: 45, final2H: true,
    finalizado: true, suspendido: false
  };
  return { 'sacramento kings': juego, 'milwaukee bucks': juego };
})();

// Caso 33: NBA "1ra mitad" (1h) over/under — con prueba de regresión de
// que el "1" de "1h" no se cuela como si fuera la línea (107 puntos reales
// en la 1ra mitad de Kings/Bucks: 55+52 — si el "1" se colara como línea,
// 107 puntos > 1 daría GANADA por error en el caso de abajo, que en
// realidad es PERDIDA).
(function testNBAPrimeraMitad() {
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: {}, soccer: {}, basket: DATOS_NBA_TERMINADO };
  const perdida = evaluarJugada(normalizarTexto('Bucks over 1h 110 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(perdida.estado === 'PERDIDA', 'NBA 1ra mitad: 107 puntos reales (55+52) es MENOS que la línea 110 -> PERDIDA (si el "1" de "1h" se colara como línea, esto daría GANADA por error)');
  check(/1ra mitad/i.test(perdida.debug.tipoApuesta), 'NBA 1ra mitad: la etiqueta de debug deja claro que la apuesta fue sobre la 1ra mitad, no el juego completo');

  const ganada = evaluarJugada(normalizarTexto('Bucks over 1h 100 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(ganada.estado === 'GANADA', 'NBA 1ra mitad: con línea 100 (menos que los 107 puntos reales de la 1ra mitad) -> GANADA');
})();

// Caso 34: NBA "2da mitad" (2h) over/under — mismo espíritu que "1h" pero
// para el segundo tiempo (cuartos 3+4), funcionalidad NUEVA que no existía
// para ningún otro deporte hasta ahora.
(function testNBASegundaMitad() {
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: {}, soccer: {}, basket: DATOS_NBA_TERMINADO };
  const perdida = evaluarJugada(normalizarTexto('Bucks over 2h 100 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(perdida.estado === 'PERDIDA', 'NBA 2da mitad: 95 puntos reales (50+45) es MENOS que la línea 100 -> PERDIDA (si el "2" de "2h" se colara como línea, esto daría GANADA por error)');
  check(/2da mitad/i.test(perdida.debug.tipoApuesta), 'NBA 2da mitad: la etiqueta de debug deja claro que la apuesta fue sobre la 2da mitad, distinta de la 1ra');

  const ganada = evaluarJugada(normalizarTexto('Bucks over 2h 90 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(ganada.estado === 'GANADA', 'NBA 2da mitad: con línea 90 (menos que los 95 puntos reales de la 2da mitad) -> GANADA');
})();

// Caso 35: NBA hándicap por "1h"/"2h" — Bucks (visitante) anotó 52 en la
// 1ra mitad y 45 en la 2da; Kings (local) 55 y 50 respectivamente.
(function testNBAHandicapPorMitad() {
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: {}, soccer: {}, basket: DATOS_NBA_TERMINADO };

  const perdida1h = evaluarJugada(normalizarTexto('Bucks 1h -3 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(perdida1h.estado === 'PERDIDA', 'NBA hándicap 1ra mitad: Bucks -3 (52-3=49 vs 55) -> PERDIDA');
  const ganada1h = evaluarJugada(normalizarTexto('Bucks 1h +5 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(ganada1h.estado === 'GANADA', 'NBA hándicap 1ra mitad: Bucks +5 (52+5=57 vs 55) -> GANADA');

  const perdida2h = evaluarJugada(normalizarTexto('Bucks 2h -3 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(perdida2h.estado === 'PERDIDA', 'NBA hándicap 2da mitad: Bucks -3 (45-3=42 vs 50) -> PERDIDA');
  const ganada2h = evaluarJugada(normalizarTexto('Bucks 2h +7 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(ganada2h.estado === 'GANADA', 'NBA hándicap 2da mitad: Bucks +7 (45+7=52 vs 50) -> GANADA');
})();

// Caso 36 (regresión directa del malentendido corregido): NBA NO se apuesta
// por cuarto individual — "1Q"/"3er cuarto" en una jugada resuelta a NBA
// debe quedar PENDIENTE con un motivo que sugiera "1h"/"2h", nunca
// evaluarse como si fuera el juego completo ni como una mitad.
(function testNBANoApuestaPorCuartoIndividual() {
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: {}, soccer: {}, basket: DATOS_NBA_TERMINADO };
  const res = evaluarJugada(normalizarTexto('Bucks over 1q 55 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'PENDIENTE' && /1h/i.test(res.razon) && /2h/i.test(res.razon), 'NBA: "over 1q 55" (cuarto individual) queda PENDIENTE con un motivo que aclara que NBA solo se apuesta por 1h/2h/juego completo, no por cuarto suelto — corregido tras la aclaración del usuario');

  const res2 = evaluarJugada(normalizarTexto('Bucks 3er cuarto -3 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res2.estado === 'PENDIENTE', 'NBA: "3er cuarto" (cuarto individual, en palabras) también queda PENDIENTE, no se evalúa por error');
})();

// Caso 37: NBA "1h"/"2h" que TODAVÍA no terminaron -> PENDIENTE con motivo
// claro, no se lee una mitad a medio jugar.
(function testNBAMitadTodaviaNoTermina() {
  const juegoEnCurso = {
    homeTeam: 'Atlanta Hawks', awayTeam: 'Boston Celtics',
    homeScore: 25, awayScore: 24, totalScore: 49,
    homeLinescores: [25], awayLinescores: [24],
    cuartosCompletos: 1,
    homeScore1H: 25, awayScore1H: 24, final1H: false, // solo terminó el 1er cuarto, falta el 2do
    homeScore2H: 0, awayScore2H: 0, final2H: false,
    finalizado: false, suspendido: false
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: {}, soccer: {}, basket: { 'atlanta hawks': juegoEnCurso, 'boston celtics': juegoEnCurso } };

  const res1h = evaluarJugada(normalizarTexto('Hawks over 1h 40 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res1h.estado === 'PENDIENTE' && /primera mitad/i.test(res1h.razon), 'NBA: la 1ra mitad todavía no terminó (solo va el 1er cuarto) -> PENDIENTE, no se adivina con datos a medio armar');

  const res2h = evaluarJugada(normalizarTexto('Hawks over 2h 40 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res2h.estado === 'PENDIENTE' && /segunda mitad/i.test(res2h.razon), 'NBA: la 2da mitad todavía no terminó (ni siquiera arrancó) -> PENDIENTE, mismo criterio');
})();

// Caso 38: NHL SÍ se apuesta por período individual — un período que
// todavía no terminó (distinto de "1h"/"2h" de NBA de arriba) -> PENDIENTE.
(function testNHLPeriodoTodaviaNoTermina() {
  const juegoEnCurso = {
    homeTeam: 'Edmonton Oilers', awayTeam: 'Calgary Flames',
    homeScore: 1, awayScore: 0,
    homeLinescores: [1], awayLinescores: [0],
    cuartosCompletos: 1, finalizado: false, suspendido: false
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: { 'edmonton oilers': juegoEnCurso, 'calgary flames': juegoEnCurso }, soccer: {}, basket: {} };
  const res = evaluarJugada(normalizarTexto('Oilers over 2q 3 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'PENDIENTE' && /2.*(cuarto|per[ií]odo)/i.test(res.razon), 'NHL: el 2do período todavía no terminó (solo va 1 completo) -> PENDIENTE con motivo claro — a diferencia de NBA, NHL SÍ soporta período individual');
})();

// Caso 39 (guarda de seguridad #1): una jugada menciona un cuarto/período,
// pero el deporte al que se resolvió NO tiene "por cuarto" habilitado NI
// "1h"/"2h" (MLB) -> PENDIENTE explicando por qué, JAMÁS se evalúa como si
// fuera el juego completo (eso podría dar un resultado incorrecto en
// silencio, con dinero real de por medio).
(function testGuardaCuartoEnDeporteSinSoporte() {
  const datosMLB = {
    'houston astros': {
      homeTeam: 'Houston Astros', awayTeam: 'Seattle Mariners',
      homeRuns: 5, awayRuns: 3, totalRuns: 8,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: datosMLB, nfl: {}, nhl: {}, soccer: {}, basket: {} };
  const res = evaluarJugada(normalizarTexto('Astros over 1q 3 -120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'PENDIENTE' && /cuarto.*per[ií]odo|per[ií]odo.*cuarto/i.test(res.razon), 'Guarda de seguridad: "Astros over 1q 3" resuelve a MLB (que no tiene cuartos ni 1h/2h habilitados) -> PENDIENTE con motivo claro, NUNCA se evalúa "3" como el total del juego completo (eso casi siempre daría PERDIDA por error, con dinero real de por medio)');
})();

// Caso 40 (guarda de seguridad #2): una jugada pide un período que no
// existe para ese deporte (NHL solo tiene 3 períodos, no un "4to
// cuarto") -> PENDIENTE, no un error ni una lectura fuera de rango.
(function testGuardaCuartoFueraDeRango() {
  const juego = {
    homeTeam: 'Florida Panthers', awayTeam: 'Boston Bruins',
    homeScore: 3, awayScore: 2,
    homeLinescores: [1, 1, 1], awayLinescores: [0, 1, 1],
    cuartosCompletos: 3, finalizado: true, suspendido: false
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: { 'florida panthers': juego, 'boston bruins': juego }, soccer: {}, basket: {} };
  const res = evaluarJugada(normalizarTexto('Florida Panthers over 4q 3 -120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'PENDIENTE' && /4/.test(res.razon), 'Guarda de seguridad: NHL solo tiene 3 períodos -> pedir el "4Q" da PENDIENTE con motivo claro, no revienta ni lee un dato inexistente');
})();

// Caso 41: NHL reconoce la palabra "período" (y "primer período" en
// palabras) exactamente igual que "1Q" — mismo mecanismo genérico para los
// 2 deportes, solo cambia la etiqueta cosmética (nombreSegmento).
(function testNHLPorPeriodoEnPalabras() {
  const juego = {
    homeTeam: 'Florida Panthers', awayTeam: 'Boston Bruins',
    homeScore: 3, awayScore: 1,
    homeLinescores: [1, 1, 1], awayLinescores: [0, 1, 0],
    cuartosCompletos: 3, finalizado: true, suspendido: false
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: { 'florida panthers': juego, 'boston bruins': juego }, soccer: {}, basket: {} };
  const res = evaluarJugada(normalizarTexto('Florida Panthers over primer periodo 0.5 -110'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'GANADA', 'NHL: "primer periodo" se reconoce igual que "1Q" — 1er período real fue 1-0 (1 gol total), más que la línea 0.5 -> GANADA');
})();

// Caso 42: regresión directa del ticket real del usuario ("Panthers over
// 1Q 3 -120") — "panthers" a secas es ambiguo (Carolina Panthers/NFL y
// Florida Panthers/NHL), pero si ESE día solo Florida Panthers tiene
// partido (Carolina no aparece en los datos de NFL), la desambiguación de
// 5 capas lo resuelve solo a NHL — y de ahí en más, la jugada se evalúa
// por período sin que haga falta ninguna aclaración manual.
(function testPantherAmbiguoConCuarto() {
  const juegoNHL = {
    homeTeam: 'Florida Panthers', awayTeam: 'Boston Bruins',
    homeScore: 3, awayScore: 1,
    homeLinescores: [1, 1, 1], awayLinescores: [0, 1, 0],
    cuartosCompletos: 3, finalizado: true, suspendido: false
  };
  // OJO: datosPorDeporte.nfl se deja VACÍO a propósito -> Carolina
  // Panthers no tiene partido hoy, así que la capa 1 (¿quién juega hoy?)
  // ya alcanza para desambiguar sin ninguna otra pista.
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: { 'florida panthers': juegoNHL, 'boston bruins': juegoNHL }, soccer: {}, basket: {} };
  const res = evaluarJugada(normalizarTexto('Panthers over 1Q 3 -120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res.debug.equipoOficial === 'Florida Panthers', 'Panthers ambiguo + cuarto: con solo Florida Panthers jugando hoy, se resuelve solo a NHL (no a Carolina Panthers/NFL, que no tiene cuartos habilitados)');
  check(res.estado !== 'PENDIENTE' || !/todavía no tiene la apuesta por cuartos/.test(res.razon || ''), 'Panthers ambiguo + cuarto: al resolver a NHL (que SÍ soporta período/cuarto), la guarda de seguridad de "deporte sin soporte" nunca se dispara');
})();

// Caso 43: detectarCuartoEnJugada() reconoce las 3 formas de escribirlo
// (dígito+Q, dígito+cuarto/período con o sin sufijo ordinal, y la palabra
// ordinal sola) — prueba directa de la función, sin pasar por todo el
// evaluador.
(function testDeteccionDeCuarto() {
  check(detectarCuartoEnJugada(normalizarTexto('Panthers over 1Q 3 -120')) === 1, 'detectarCuartoEnJugada: "1Q" -> cuarto 1');
  check(detectarCuartoEnJugada(normalizarTexto('Bucks 3er cuarto -3 -110')) === 3, 'detectarCuartoEnJugada: "3er cuarto" -> cuarto 3');
  check(detectarCuartoEnJugada(normalizarTexto('Bucks segundo cuarto -3 -110')) === 2, 'detectarCuartoEnJugada: "segundo cuarto" (ordinal en palabras) -> cuarto 2');
  check(detectarCuartoEnJugada(normalizarTexto('Panthers 1 periodo -110')) === 1, 'detectarCuartoEnJugada: "1 periodo" -> período 1');
  check(detectarCuartoEnJugada(normalizarTexto('Astros over 8 -110')) === null, 'detectarCuartoEnJugada: una jugada normal sin ningún marcador de cuarto/período -> null');
})();

// -----------------------------------------------------------------
// Caso 44: ticket real del usuario (05-09-2026) — 2 (o más) jugadas de
// UNA sola pata, SUELTAS una debajo de la otra, sin ningún ticket/
// cliente/monto de por medio que las separe, cada una con SU PROPIA
// cuota y su PROPIA ganancia deseada ("EQUIPO CUOTA para MONTO"):
// "⚾Mets -200 para 150" seguido de "⚾Whit sox 5to -115 para 250". El
// usuario reportó 2 problemas juntos: (a) "primero une los dos tickets
// cuando van por separado" — antes se mezclaban en un solo ticket con
// arriesga=$0/paga=$0 ("FALTA CERRAR EN SÁBANA"), en vez de ser 2 tickets
// ya cerrados solos, cada uno con su propio arriesgo calculado desde su
// propia cuota; y (b) "si el logro que paga un equipo es -120 y hay un
// espacio entre el signo y la cantidad no distingue el logro" — una
// cuota como "- 115" (con espacio) tampoco se reconocía.
// -----------------------------------------------------------------
(function testDosJugadasSueltasConCuotaYParaPropia() {
  check(pataTieneCuotaYParaPropia('⚾Mets -200 para 150') === true, 'pataTieneCuotaYParaPropia: "Mets -200 para 150" trae su propia cuota + ganancia deseada');
  check(pataTieneCuotaYParaPropia('⚾Whit sox 5to - 115 para 250') === true, 'pataTieneCuotaYParaPropia: reconoce la cuota aunque tenga un espacio entre el signo y el número ("- 115")');
  check(pataTieneCuotaYParaPropia('Astros -150') === false, 'pataTieneCuotaYParaPropia: una jugada sin "para <monto>" no es un ticket independiente por sí sola');
  check(pataTieneCuotaYParaPropia('alta 8 para 150') === false, 'pataTieneCuotaYParaPropia: un número sin magnitud de cuota real (< 100, ej. la línea "8" de una alta/baja) no cuenta como cuota');

  const texto = ['*RANDY*', '⚾Mets -200 para 150', '⚾Whit sox 5to - 115 para 250'].join('\n');
  const boletos = parsearSabana(texto, DICCIONARIO_EQUIPOS_BASE);
  check(boletos.length === 2, 'Las 2 jugadas sueltas, sin nada que las separe, se parsean como 2 TICKETS distintos (antes quedaban mezcladas en 1 solo)');
  check(boletos.every(b => b.cliente === 'RANDY'), 'Los 2 tickets quedan atribuidos al mismo cliente (RANDY)');
  check(boletos.every(b => !b.sinResultadoEnSabana), 'Ninguno de los 2 queda "FALTA CERRAR EN SÁBANA" — los 2 se auto-cierran solos');

  const ticketMets = boletos.find(b => b.jugadas[0].includes('Mets'));
  check(ticketMets.cierreAutomatico === true && ticketMets.cuotaCierreAutomatico === -200, 'Ticket de Mets: se auto-cierra con su propia cuota (-200)');
  check(ticketMets.pagaSabana === 150, 'Ticket de Mets: la ganancia deseada es la suya propia (150), no se mezcla con la del otro ticket');
  check(Math.abs(ticketMets.arriesga - 300) < 0.01, 'Ticket de Mets: arriesga = $300 (150 * 200/100, la cuota -200 a favor)');

  const ticketWhiteSox = boletos.find(b => b.jugadas[0].includes('Whit sox'));
  check(ticketWhiteSox.cierreAutomatico === true && ticketWhiteSox.cuotaCierreAutomatico === -115, 'Ticket de White Sox: se auto-cierra con SU cuota (-115), reconocida a pesar del espacio ("- 115")');
  check(ticketWhiteSox.pagaSabana === 250, 'Ticket de White Sox: la ganancia deseada es la suya propia (250)');
  check(Math.abs(ticketWhiteSox.arriesga - 287.5) < 0.01, 'Ticket de White Sox: arriesga = $287.50 (250 / (100/115))');
})();

// -----------------------------------------------------------------
// Caso 45: la cuota con un espacio entre el signo y el número ("- 120",
// "+ 130") se reconoce en TODOS lados que dependen de normalizarTexto(),
// no solo en el caso puntual de arriba — mismo reporte del usuario,
// probado directo contra extraerCuotaAmericana() (la función que también
// usa procesarSabana.js para decidir "FALTA LOGRO").
// -----------------------------------------------------------------
(function testCuotaConEspacioEntreSignoYNumero() {
  check(normalizarTexto('Astros - 150') === 'astros -150', 'normalizarTexto: le pega el signo "-" a su número aunque haya un espacio de por medio');
  check(normalizarTexto('Astros + 130') === 'astros +130', 'normalizarTexto: mismo arreglo con el signo "+"');
  check(normalizarTexto('Astros -150') === 'astros -150', 'normalizarTexto: una cuota que YA viene sin espacio sigue exactamente igual (sin este arreglo no se le cambia nada)');

  check(extraerCuotaAmericana(normalizarTexto('Astros - 150')) === -150, 'extraerCuotaAmericana: reconoce "- 150" (con espacio) como cuota -150');
  check(extraerCuotaAmericana(normalizarTexto('Astros + 130')) === 130, 'extraerCuotaAmericana: reconoce "+ 130" (con espacio) como cuota +130');

  // Ticket de una sola pata, con la cuota separada de su signo por un
  // espacio, y "para <monto>" a secas -> tiene que auto-cerrarse igual
  // que si no hubiera ningún espacio.
  const texto = ['*RANDY*', 'Astros - 150 para 200'].join('\n');
  const boletos = parsearSabana(texto, DICCIONARIO_EQUIPOS_BASE);
  check(boletos.length === 1 && boletos[0].cierreAutomatico === true && boletos[0].cuotaCierreAutomatico === -150,
    'Un ticket de 1 sola pata con la cuota separada por un espacio ("- 150 para 200") se auto-cierra igual, reconociendo la cuota -150');
})();

// -----------------------------------------------------------------
// Caso 46: doble juego de MLB (05-09-2026, a pedido del usuario con un
// ticket real: "LUIS Ticket #2 Tigers G2 (+120)" — Detroit jugó 2 veces
// esa fecha, y el ticket era puntualmente del 2do juego). Antes de este
// arreglo, `obtenerResultadosAPIs()` (mlbApi.js) guardaba cada equipo con
// UNA sola clave (su nombre) — si jugaba 2 veces el mismo día, el 2do
// partido pisaba en silencio al 1ro, y no había forma de pedir el juego 1
// en particular. El usuario aclaró que "el juego 2 puede venir como G2 o
// GM2 o g2 o gm o juego2" — se prueban las 4 formas.
// -----------------------------------------------------------------
(function testDobleJuegoMLB() {
  check(detectarNumeroJuegoEnJugada('Tigers G2 (+120)') === 2, 'detectarNumeroJuegoEnJugada: "G2" -> juego 2');
  check(detectarNumeroJuegoEnJugada('Tigers GM2 +120') === 2, 'detectarNumeroJuegoEnJugada: "GM2" -> juego 2');
  check(detectarNumeroJuegoEnJugada('tigers g2 +120') === 2, 'detectarNumeroJuegoEnJugada: "g2" (minúscula) -> juego 2');
  check(detectarNumeroJuegoEnJugada('Tigers juego2 +120') === 2, 'detectarNumeroJuegoEnJugada: "juego2" (pegado) -> juego 2');
  check(detectarNumeroJuegoEnJugada('Tigers juego 2 +120') === 2, 'detectarNumeroJuegoEnJugada: "juego 2" (con espacio) -> juego 2');
  check(detectarNumeroJuegoEnJugada('Tigers G1 +120') === 1, 'detectarNumeroJuegoEnJugada: "G1" -> juego 1');
  check(detectarNumeroJuegoEnJugada('Tigers +120') === null, 'detectarNumeroJuegoEnJugada: sin ningún marcador -> null (no hay doble juego que aclarar)');

  // 2 juegos de Detroit Tigers (home) vs Cleveland Guardians (away) la
  // MISMA fecha: Tigers gana el juego 1 (5-2), pierde el juego 2 (1-6).
  const juego1 = { homeTeam: 'Detroit Tigers', awayTeam: 'Cleveland Guardians', homeRuns: 5, awayRuns: 2, totalRuns: 7, home5innRuns: 3, away5innRuns: 1, total5innRuns: 4, finalizado: true, final5inn: true, suspendido: false, numeroJuego: 1 };
  const juego2 = { homeTeam: 'Detroit Tigers', awayTeam: 'Cleveland Guardians', homeRuns: 1, awayRuns: 6, totalRuns: 7, home5innRuns: 0, away5innRuns: 4, total5innRuns: 4, finalizado: true, final5inn: true, suspendido: false, numeroJuego: 2 };
  const datosMLB = {
    'detroit tigers': juego1, 'cleveland guardians': juego1, // clave "por defecto" -> juego 1
    'detroit tigers juego1': juego1, 'cleveland guardians juego1': juego1,
    'detroit tigers juego2': juego2, 'cleveland guardians juego2': juego2
  };
  const datosPorDeporte = { mlb: datosMLB, nfl: {}, nhl: {}, soccer: {}, basket: {} };

  check(evaluarJugada(normalizarTexto('Tigers G2 (+120)'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE).estado === 'PERDIDA',
    'Ticket real del usuario: "Tigers G2 (+120)" se evalúa contra el JUEGO 2 (Tigers 1-6, pierde), no el 1');
  check(evaluarJugada(normalizarTexto('Tigers GM2 +120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE).estado === 'PERDIDA', '"Tigers GM2 +120" también resuelve al juego 2');
  check(evaluarJugada(normalizarTexto('Tigers g2 +120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE).estado === 'PERDIDA', '"Tigers g2 +120" (minúscula) también resuelve al juego 2');
  check(evaluarJugada(normalizarTexto('Tigers juego2 +120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE).estado === 'PERDIDA', '"Tigers juego2 +120" también resuelve al juego 2');
  check(evaluarJugada(normalizarTexto('Tigers +120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE).estado === 'GANADA',
    'Sin ningún marcador de juego, se sigue asumiendo el juego 1 (Tigers 5-2, gana) — no "lo último procesado" como antes');
  check(evaluarJugada(normalizarTexto('Tigers G1 +120'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE).estado === 'GANADA', 'Pedir el juego 1 explícito ("G1") también da GANADA');

  const resDebug = evaluarJugada(normalizarTexto('Tigers G2 (+120)'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(!!resDebug.debug && resDebug.debug.equipoOficial === 'Detroit Tigers', 'El debug de "Tigers G2" identifica bien al equipo (Detroit Tigers) a pesar del marcador de juego');

  // Si se pide un juego que esa fecha no tuvo (ej. "G2" un día sin doble
  // juego), no hay que caer de vuelta al juego 1 por error — mejor avisar
  // que no se encontró, así se nota que la sábana dice algo que no
  // coincide con la realidad, en vez de evaluar contra el juego equivocado.
  const datosSinDobleJuego = { mlb: { 'detroit tigers': juego1, 'cleveland guardians': juego1 }, nfl: {}, nhl: {}, soccer: {}, basket: {} };
  const resSinG2 = evaluarJugada(normalizarTexto('Tigers G2 +120'), datosSinDobleJuego, DICCIONARIO_EQUIPOS_BASE);
  check(resSinG2.estado === 'PENDIENTE' && /no se encontr[oó] el juego 2/i.test(resSinG2.razon || ''),
    'Pedir "G2" un día sin doble juego da PENDIENTE con motivo claro, no evalúa por error contra el juego 1');

  // buscarJuegoPorNombre() directo, con datos armados a mano (sin pasar
  // por la API real) — mismo criterio que arriba, probado a más bajo nivel.
  check(buscarJuegoPorNombre(datosMLB, 'Detroit Tigers') === juego1, 'buscarJuegoPorNombre sin numeroJuego -> juego 1 (el "por defecto")');
  check(buscarJuegoPorNombre(datosMLB, 'Detroit Tigers', 2) === juego2, 'buscarJuegoPorNombre con numeroJuego=2 -> juego 2');
  check(buscarJuegoPorNombre(datosMLB, 'Detroit Tigers', 1) === juego1, 'buscarJuegoPorNombre con numeroJuego=1 -> juego 1');
  check(buscarJuegoPorNombre({ 'detroit tigers': juego1 }, 'Detroit Tigers', 2) === null, 'buscarJuegoPorNombre con numeroJuego=2 pero sin ese juego -> null (no cae al juego por defecto)');
})();

// -----------------------------------------------------------------
// Caso 47: obtenerResultadosAPIs() arma bien las claves de doble juego a
// partir de una respuesta simulada de la API real de MLB (con
// "gameNumber", el campo que la API SIEMPRE manda) — prueba de
// integración liviana, con "fetch" reemplazado a mano (sin red real).
// -----------------------------------------------------------------
// OJO: única prueba async de todo este archivo (obtenerResultadosAPIs()
// depende de "fetch") — el resumen final y el exit code se mueven adentro
// de este .then()/.catch() para esperarla, en vez del console.log a
// secas de siempre, que hubiera corrido ANTES de que esta prueba
// terminara de verdad (dando un conteo incompleto o un exit code
// prematuro).
(async function testObtenerResultadosAPIsDobleJuego() {
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({
    json: async () => ({
      dates: [{
        games: [
          { gameNumber: 1, gamePk: 1, status: { abstractGameState: 'Final', codedState: 'F' }, teams: { home: { team: { name: 'Detroit Tigers' }, score: 5 }, away: { team: { name: 'Cleveland Guardians' }, score: 2 } }, linescore: { innings: [] } },
          { gameNumber: 2, gamePk: 2, status: { abstractGameState: 'Final', codedState: 'F' }, teams: { home: { team: { name: 'Detroit Tigers' }, score: 1 }, away: { team: { name: 'Cleveland Guardians' }, score: 6 } }, linescore: { innings: [] } }
        ]
      }]
    })
  });

  try {
    const datos = await obtenerResultadosAPIs('2026-09-05');
    check(datos['detroit tigers juego1'].homeRuns === 5, 'obtenerResultadosAPIs: guarda el juego 1 bajo "detroit tigers juego1" (5 carreras)');
    check(datos['detroit tigers juego2'].homeRuns === 1, 'obtenerResultadosAPIs: guarda el juego 2 bajo "detroit tigers juego2" (1 carrera), sin pisar al juego 1');
    check(datos['detroit tigers'].homeRuns === 5, 'obtenerResultadosAPIs: la clave "por defecto" (sin número de juego) queda en el juego 1, no en "lo último procesado"');
  } finally {
    global.fetch = fetchOriginal;
  }
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(e => {
  console.error('La prueba de obtenerResultadosAPIs (doble juego) se cayó con una excepción:', e);
  process.exit(1);
});
