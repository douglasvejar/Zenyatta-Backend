// =================================================================
// PRUEBA: NBA "2h" — el tiempo extra SÍ cuenta en la 2da mitad (10-10-2026,
// a pedido del usuario; igual que NFL). Antes se contaban solo los cuartos 3+4.
// =================================================================
const { obtenerResultadosNBA } = require('../src/services/nbaApi');
const { normalizarTexto } = require('../src/services/normalizar');
const { evaluarJugada } = require('../src/services/evaluador');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');

let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }
const ls = a => a.map((v, i) => ({ period: i + 1, value: v }));
function ev(completed, periodo, home, away) {
  return { id: '1', date: 'x', competitions: [{
    status: { period: periodo, displayClock: '0', type: { completed, state: completed ? 'post' : 'in', description: completed ? 'Final' : 'In Progress' } },
    competitors: [
      { homeAway: 'home', score: String(home.reduce((a, b) => a + b, 0)), team: { displayName: 'Boston Celtics' }, linescores: ls(home) },
      { homeAway: 'away', score: String(away.reduce((a, b) => a + b, 0)), team: { displayName: 'Miami Heat' }, linescores: ls(away) }
    ] }] };
}
async function traer(e) {
  global.fetch = async () => ({ json: async () => ({ events: [e] }) });
  return (await obtenerResultadosNBA('2026-10-10'))['boston celtics'];
}
function evaluar(texto, juego) {
  const datos = { mlb: {}, nfl: {}, nhl: {}, soccer: {}, basket: { 'boston celtics': juego, 'miami heat': juego } };
  return evaluarJugada(normalizarTexto(texto), datos, DICCIONARIO_EQUIPOS_BASE);
}

(async function main() {
  let j = await traer(ev(true, 4, [28, 30, 25, 27], [25, 27, 30, 26]));
  check(j.homeScore2H === 52 && j.awayScore2H === 56 && j.final2H, 'Tiempo regular: 2da mitad = cuartos 3+4 (52 vs 56), lista al terminar');

  j = await traer(ev(true, 5, [28, 30, 25, 27, 10], [25, 27, 30, 26, 12]));
  check(j.homeScore2H === 62 && j.awayScore2H === 68 && j.final2H, 'Con tiempo extra: la 2da mitad suma el OT (52+10 vs 56+12)');
  check(j.homeScore1H === 58 && j.awayScore1H === 52, 'La 1ra mitad no cambia (cuartos 1+2)');

  j = await traer(ev(true, 6, [28, 30, 25, 27, 10, 5], [25, 27, 30, 26, 10, 8]));
  check(j.homeScore2H === 67 && j.awayScore2H === 74, 'Con doble tiempo extra: suma los dos OT');

  j = await traer(ev(false, 5, [28, 30, 25, 27, 4], [25, 27, 30, 26, 2]));
  check(j.final2H === false, 'En pleno tiempo extra la 2da mitad NO está lista (todavía puede sumar puntos)');

  const final = await traer(ev(true, 5, [28, 30, 25, 27, 10], [25, 27, 30, 26, 12]));
  check(evaluar('Celtics over 2h 125.5 -110', final).estado === 'GANADA', 'Over 2h 125.5: con el OT la 2da mitad sumó 130 -> GANADA (sin contar el OT habría sido PERDIDA)');
  check(evaluar('Celtics over 2h 130.5 -110', final).estado === 'PERDIDA', 'Over 2h 130.5: 130 no pasa -> PERDIDA');
  const enOT = await traer(ev(false, 5, [28, 30, 25, 27, 4], [25, 27, 30, 26, 2]));
  const r = evaluar('Celtics over 2h 100.5 -110', enOT);
  check(r.estado === 'PENDIENTE', 'Jugada de 2h con el partido en tiempo extra -> PENDIENTE (no se resuelve a medias)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
