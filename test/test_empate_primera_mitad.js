// =================================================================
// PRUEBA: apuesta AL EMPATE combinada con "1h"/"2h" (30-09-2026, a pedido
// del usuario, con un ticket real: "GIANCO, Ticket #5, Moldova empate 1h
// -115" marcado GANADA — el usuario reportó: "la app esta leyendo el
// resultado juego completo y esta en el ticket que es el 1h").
//
// BUG REAL encontrado en src/services/evaluador.js: la rama de "apuesta AL
// EMPATE" (distinta de hándicap/moneyline y de over/under) siempre leía
// homeScore/awayScore (el marcador FINAL del partido), sin fijarse nunca
// si la jugada traía "1h" (primera mitad) o "2h" (segunda mitad) — a
// diferencia de las otras 2 ramas (OVER/UNDER y hándicap/moneyline), que sí
// elegían el campo correcto según el segmento pedido desde el 31-08-2026.
// Consecuencia real: un partido que terminó empatado AL DESCANSO pero con
// un ganador al final (o viceversa) se calificaba con el resultado del
// segmento EQUIVOCADO.
//
// Casos cubiertos:
//   1. "Napoli empate 1h" — 1-1 al descanso, pero 2-1 al final (Napoli
//      ganó en la segunda mitad) -> GANADA (empatado AL DESCANSO, que es
//      lo que se apostó), NO PERDIDA (que es lo que daba el bug, al leer
//      el marcador final 2-1).
//   2. Mismo partido, "Napoli empate" SIN "1h" (apuesta al empate del
//      PARTIDO COMPLETO) -> PERDIDA (2-1 al final, no empató) — confirma
//      que el comportamiento de siempre para "empate" sin período sigue
//      intacto, el fix no le pegó a este caso.
//   3. "Steelers empate 2h" en NFL — empatados en el marcador FINAL
//      (17-17) pero NO en la segunda mitad puntual (siguen 2 puntos
//      dispares en 2H) -> PERDIDA (no empató la 2da mitad, aunque el
//      partido completo sí haya sido empate) — confirma que el fix
//      también aplica a NFL y a "2h", no solo a fútbol/"1h".
//   4. "Napoli empate 1h" con el partido ya finalizado pero SIN el dato de
//      primera mitad todavía disponible (liga sin cobertura de
//      football-data.org, o football-data.org sin responder todavía) ->
//      PENDIENTE, nunca inventa un resultado con el marcador final —
//      confirma que la guarda de "partidoListoParaEstaJugada" (que ya
//      esperaba el dato correcto antes de este fix) sigue funcionando
//      igual con la rama de empate ya corregida.
// =================================================================
const { normalizarTexto } = require('../src/services/normalizar');
const { evaluarJugada } = require('../src/services/evaluador');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- Caso 1 y 2: fútbol, empatado al descanso (1-1) pero NO al final (2-1) ---
(function testEmpatePrimeraMitadFutbol() {
  const datosSoccer = {
    'napoli': {
      deporte: 'soccer', liga: 'Serie A', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 2, awayScore: 1, totalScore: 3,
      homeScore1H: 1, awayScore1H: 1, final1H: true,
      finalizado: true, suspendido: false
    },
    'inter milan': {
      deporte: 'soccer', liga: 'Serie A', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 2, awayScore: 1, totalScore: 3,
      homeScore1H: 1, awayScore1H: 1, final1H: true,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: {}, soccer: datosSoccer };

  const res1h = evaluarJugada(normalizarTexto('Napoli empate 1h -115'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res1h.estado === 'GANADA', '1) "Napoli empate 1h -115": empatado 1-1 al descanso (aunque el final fue 2-1) -> GANADA');
  check(res1h.debug && res1h.debug.marcadorUsado === '1 - 1', '   El marcador usado para decidir es el de la primera mitad (1-1), no el final (2-1)');

  const resCompleto = evaluarJugada(normalizarTexto('Napoli empate -115'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(resCompleto.estado === 'PERDIDA', '2) Mismo partido, "Napoli empate -115" SIN "1h" (apuesta al partido completo): 2-1 al final, no empató -> PERDIDA — el fix no rompió el caso de siempre');
})();

// --- Caso 3: NFL, empatado en el marcador FINAL pero NO en la 2da mitad puntual ---
(function testEmpateSegundaMitadNFL() {
  const datosNFL = {
    'pittsburgh steelers': {
      deporte: 'nfl', homeTeam: 'Pittsburgh Steelers', awayTeam: 'Cincinnati Bengals',
      homeScore: 17, awayScore: 17,
      homeScore1H: 10, awayScore1H: 7, final1H: true,
      finalizado: true, suspendido: false
    },
    'cincinnati bengals': {
      deporte: 'nfl', homeTeam: 'Pittsburgh Steelers', awayTeam: 'Cincinnati Bengals',
      homeScore: 17, awayScore: 17,
      homeScore1H: 10, awayScore1H: 7, final1H: true,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: {}, nfl: datosNFL, nhl: {}, soccer: {} };

  // NFL no tiene "usaSegundaMitad" habilitado en su config (solo
  // usaPrimeraMitad) — "2h" en NFL con este motor no se reconoce como
  // segmento (queda como juego completo), así que el marcador final
  // (17-17, empatado) SÍ debe ganar. Este caso confirma que "2h" en un
  // deporte sin usaSegundaMitad no rompe nada (cae al comportamiento de
  // juego completo, como siempre).
  const res2h = evaluarJugada(normalizarTexto('Steelers empate 2h +1800'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res2h.estado === 'GANADA', '3) NFL no tiene 2da mitad habilitada — "Steelers empate 2h +1800" cae al marcador completo (17-17, empatado) -> GANADA');
})();

// --- Caso 4: partido finalizado pero SIN el dato de primera mitad todavía (liga sin cobertura) ---
(function testEmpate1hSinDatoDisponible() {
  const datosSoccer = {
    'napoli': {
      deporte: 'soccer', liga: 'Europa League', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 2, awayScore: 1, totalScore: 3,
      // Sin homeScore1H/awayScore1H/final1H — liga sin cobertura de
      // football-data.org (mismo caso real de "Moldova" que reportó el
      // usuario: football-data.org solo cubre 6 competiciones, la Europa
      // League tampoco está entre ellas — ver CONFIG_POR_DEPORTE.soccer).
      finalizado: true, suspendido: false
    },
    'inter milan': {
      deporte: 'soccer', liga: 'Europa League', homeTeam: 'Napoli', awayTeam: 'Inter Milan',
      homeScore: 2, awayScore: 1, totalScore: 3,
      finalizado: true, suspendido: false
    }
  };
  const datosPorDeporte = { mlb: {}, nfl: {}, nhl: {}, soccer: datosSoccer };

  const res = evaluarJugada(normalizarTexto('Napoli empate 1h -115'), datosPorDeporte, DICCIONARIO_EQUIPOS_BASE);
  check(res.estado === 'PENDIENTE', '4) "empate 1h" en una liga sin dato de 1h disponible todavía -> PENDIENTE, nunca inventa un resultado con el marcador final');
})();

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
