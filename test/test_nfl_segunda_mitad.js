// =================================================================
// PRUEBA: "2h" (segunda mitad) en NFL — 10-10-2026, a pedido del usuario
// ("se puede implementar los 2h en nba y nfl?"). La 2da mitad = cuartos 3+4
// MÁS el tiempo extra; solo está lista cuando el partido termina.
// =================================================================
const { evaluarJugada } = require('../src/services/evaluador');
const { normalizarTexto } = require('../src/services/normalizar');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');
const { obtenerResultadosNFL } = require('../src/services/nflApi');

let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }

function eventoESPN({ completada, periodo, desc, home, away }) {
  const ls = arr => arr.map((v, i) => ({ period: i + 1, value: v }));
  return { id: 'e1', date: '2026-10-11T17:00Z', competitions: [{
    status: { period: periodo, displayClock: '0:00', type: { completed: completada, state: completada ? 'post' : 'in', description: desc } },
    competitors: [
      { homeAway: 'home', score: String(home.reduce((a, b) => a + b, 0)), team: { displayName: 'Pittsburgh Steelers', logo: 'x' }, linescores: ls(home) },
      { homeAway: 'away', score: String(away.reduce((a, b) => a + b, 0)), team: { displayName: 'Cincinnati Bengals', logo: 'y' }, linescores: ls(away) }
    ] }] };
}
async function traer(evento) {
  global.fetch = async () => ({ json: async () => ({ events: [evento] }) });
  return (await obtenerResultadosNFL('2026-10-11'))['pittsburgh steelers'];
}
function evaluar(texto, juego) {
  const datos = { mlb: {}, nfl: { 'pittsburgh steelers': juego, 'cincinnati bengals': juego }, nhl: {}, soccer: {} };
  return evaluarJugada(normalizarTexto(texto), datos, DICCIONARIO_EQUIPOS_BASE);
}

(async function main() {
  // Conector: tiempo regular (3+4)
  let j = await traer(eventoESPN({ completada: true, periodo: 4, desc: 'Final', home: [3, 7, 0, 10], away: [7, 0, 6, 3] }));
  check(j.homeScore2H === 10 && j.awayScore2H === 9 && j.final2H === true, 'Conector: 2da mitad = cuartos 3+4 (10 vs 9) y lista al terminar el partido');
  check(j.homeScore1H === 10 && j.awayScore1H === 7, 'Conector: la 1ra mitad sigue igual (cuartos 1+2)');

  // Conector: con tiempo extra, el overtime SÍ suma a la 2da mitad
  j = await traer(eventoESPN({ completada: true, periodo: 5, desc: 'Final/OT', home: [3, 7, 0, 10, 3], away: [7, 0, 6, 7, 0] }));
  check(j.homeScore2H === 13 && j.awayScore2H === 13, 'Conector: con tiempo extra, el OT cuenta en la 2da mitad (10+3 vs 6+7)');

  // Conector: partido en curso (3er cuarto) -> la 2da mitad NO está lista
  j = await traer(eventoESPN({ completada: false, periodo: 3, desc: 'In Progress', home: [3, 7, 3], away: [7, 0, 0] }));
  check(j.final2H === false && j.final1H === true, 'Conector: en el 3er cuarto la 1ra mitad ya cerró pero la 2da NO está lista');

  // Conector: en el 4to cuarto tampoco está lista (puede haber OT)
  j = await traer(eventoESPN({ completada: false, periodo: 4, desc: 'In Progress', home: [3, 7, 3, 3], away: [7, 0, 0, 7] }));
  check(j.final2H === false, 'Conector: en el 4to cuarto la 2da mitad todavía no está lista');

  // Evaluador
  const juego = { deporte: 'nfl', homeTeam: 'Pittsburgh Steelers', awayTeam: 'Cincinnati Bengals',
    homeScore: 23, awayScore: 16, homeScore1H: 10, awayScore1H: 7, final1H: true,
    homeScore2H: 13, awayScore2H: 9, final2H: true, finalizado: true, suspendido: false };
  check(evaluar('Steelers over 2h 21.5 -110', juego).estado === 'GANADA', 'Over 2h 21.5: la 2da mitad sumó 22 puntos (13+9) -> GANADA');
  check(evaluar('Steelers over 2h 22.5 -110', juego).estado === 'PERDIDA', 'Over 2h 22.5: 22 puntos no pasa de 22.5 -> PERDIDA (el "2" de "2h" no se cuela como línea)');
  check(evaluar('Steelers under 2h 22.5 -110', juego).estado === 'GANADA', 'Under 2h 22.5 -> GANADA');
  check(evaluar('Steelers 2h -3.5 -110', juego).estado === 'GANADA', 'Hándicap 2h: Steelers ganó la 2da mitad 13-9; -3.5 -> 13-3.5=9.5 vs 9 -> GANADA');
  check(evaluar('Steelers 2h -4.5 -110', juego).estado === 'PERDIDA', 'Hándicap 2h: Steelers -4.5 -> 8.5 vs 9 -> PERDIDA');
  check(evaluar('Bengals 2h +4.5 -110', juego).estado === 'GANADA', 'Hándicap 2h: Bengals +4.5 -> 13.5 vs 13 -> GANADA');
  check(evaluar('Steelers over 53.5 -110', juego).estado === 'PERDIDA', 'Sin "2h" el juego completo se evalúa igual que siempre (39 puntos < 53.5)');
  check(evaluar('Steelers over 1h 16.5 -110', juego).estado === 'GANADA', '"1h" sigue funcionando igual (10+7=17 > 16.5)');

  // Pendiente mientras la 2da mitad no esté lista
  const enCurso = { ...juego, homeScore2H: 3, awayScore2H: 0, final2H: false, finalizado: false };
  const r = evaluar('Steelers over 2h 21.5 -110', enCurso);
  check(r.estado === 'PENDIENTE' && /segunda mitad/i.test(r.razon), 'La 2da mitad en curso -> PENDIENTE ("la segunda mitad todavía no ha terminado")');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
