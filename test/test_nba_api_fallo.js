// =================================================================
// PRUEBA (27-10-2026): NBA "Partido no encontrado en la API" -- el usuario vio Minnesota y Memphis (juegos del 26-10) en PENDIENTE
// con ese mensaje. Ahora la consulta a ESPN se reintenta una vez y, si falla o no trae ningún juego, la jugada dice el motivo real
// (volver a procesar / revisar la fecha) en vez del mismo mensaje de siempre.
// =================================================================
const { obtenerResultadosNBA } = require('../src/services/nbaApi');
const { normalizarTexto } = require('../src/services/normalizar');
const { evaluarJugada } = require('../src/services/evaluador');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');

let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }
const silencio = console.error; 
function evento(home, away) {
  return { id: '1', date: 'x', competitions: [{ status: { period: 0, displayClock: '', type: { completed: false, state: 'pre', description: 'Scheduled' } },
    competitors: [{ homeAway: 'home', score: '0', team: { displayName: home }, linescores: [] }, { homeAway: 'away', score: '0', team: { displayName: away }, linescores: [] }] }] };
}
function evaluar(texto, nba) {
  return evaluarJugada(normalizarTexto(texto), { mlb: {}, nfl: {}, nhl: {}, soccer: {}, basket: nba, ncaaf: {} }, DICCIONARIO_EQUIPOS_BASE);
}

(async function main() {
  console.error = () => {};
  // 1) ESPN cae las 2 veces: el motivo queda en __meta y la jugada lo dice
  let intentos = 0;
  global.fetch = async () => { intentos++; throw new Error('fetch failed'); };
  let nba = await obtenerResultadosNBA('2026-10-26');
  check(intentos === 3 && nba.__meta.error === 'fetch failed' && Object.keys(nba).length === 0, '1a) Si ESPN falla se reintenta 2 veces (3 intentos) y el error queda en __meta sin parecer un juego');
  let r = evaluar('Timberwolves +130', nba);
  check(r.estado === 'PENDIENTE' && /No se pudo consultar la API/.test(r.razon) && /Vuelve a procesar/.test(r.razon), `1b) La jugada dice que no se pudo consultar la API (no "Partido no encontrado"): "${r.razon}"`);

  // 2) ESPN responde con error HTTP
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  nba = await obtenerResultadosNBA('2026-10-26');
  check(/503/.test(nba.__meta.error), '2) Un error HTTP (503) también cuenta como falla de la API');

  // 3) falla la 1ra vez y funciona la 2da: sin error, con juegos
  intentos = 0;
  global.fetch = async () => { intentos++; if (intentos === 1) throw new Error('timeout'); return { ok: true, json: async () => ({ events: [evento('Minnesota Timberwolves', 'Boston Celtics'), evento('Memphis Grizzlies', 'Miami Heat')] }) }; };
  nba = await obtenerResultadosNBA('2026-10-26');
  check(intentos === 2 && nba.__meta.error === null && nba['minnesota timberwolves'] && nba['memphis grizzlies'], '3a) Falla la primera consulta y la segunda funciona: trae los juegos y sin error');
  r = evaluar('Grizzlies -115', nba);
  check(r.razon !== 'Partido no encontrado en la API' && !/No se pudo consultar/.test(r.razon || ''), '3b) Con los juegos cargados la jugada se evalúa normal (no queda en "no encontrado")');

  // 4) ESPN responde bien pero sin juegos esa fecha
  global.fetch = async () => ({ ok: true, json: async () => ({ events: [] }) });
  nba = await obtenerResultadosNBA('2026-10-26');
  r = evaluar('Timberwolves +130', nba);
  check(nba.__meta.totalEventos === 0 && /ningún juego/.test(r.razon) && /fecha de la sábana/.test(r.razon), `4) Sin juegos esa fecha, el motivo manda a revisar la fecha de la sábana: "${r.razon}"`);

  // 5) hay juegos pero no de ese equipo: se mantiene el mensaje de siempre
  global.fetch = async () => ({ ok: true, json: async () => ({ events: [evento('Boston Celtics', 'Miami Heat')] }) });
  nba = await obtenerResultadosNBA('2026-10-26');
  r = evaluar('Timberwolves +130', nba);
  check(r.estado === 'PENDIENTE' && r.razon === 'Partido no encontrado en la API', '5) Si la API trae juegos pero no el de ese equipo, sigue diciendo "Partido no encontrado en la API"');

  // 6) nombre ambiguo ("wolves" = Wolverhampton de fútbol o Timberwolves de NBA) con la API de NBA caída
  global.fetch = async () => { throw new Error('fetch failed'); };
  nba = await obtenerResultadosNBA('2026-10-26');
  r = evaluar('Wolves +130', nba);
  check(r.estado === 'PENDIENTE' && /No se pudo consultar la API/.test(r.razon || ''), `6) Nombre ambiguo con la API de NBA caída también explica el motivo real: "${r.razon}"`);

  // 7) ESPN responde 200 con el cuerpo vacío (caso real "Unexpected end of JSON input") y luego funciona
  intentos = 0;
  global.fetch = async () => { intentos++; if (intentos === 1) return { ok: true, text: async () => '' }; return { ok: true, text: async () => JSON.stringify({ events: [evento('Boston Celtics', 'Los Angeles Lakers')] }) }; };
  nba = await obtenerResultadosNBA('2026-10-26');
  check(intentos === 2 && nba.__meta.error === null && nba['boston celtics'], '7a) Cuerpo vacío en el 1er intento: reintenta y trae los juegos');
  intentos = 0; const urls = [];
  global.fetch = async (u) => { intentos++; urls.push(String(u)); return { ok: true, text: async () => '{"events":[' }; };
  nba = await obtenerResultadosNBA('2026-10-26');
  check(intentos === 3 && nba.__meta.error === 'ESPN respondió incompleto' && !/Unexpected end/.test(nba.__meta.error), '7b) Si siempre llega cortado, el motivo es claro (sin "Unexpected end of JSON input")');
  check(/site\.web\.api\.espn\.com/.test(urls[1]), '7c) El 2º intento prueba el servidor alterno de ESPN');

  console.error = silencio;
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
