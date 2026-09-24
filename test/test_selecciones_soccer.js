// =================================================================
// PRUEBA: 4 competencias de SELECCIONES agregadas al soccer (24-09-2026),
// a pedido explícito del usuario: "En la el modulo de deportes de la app
// esta los partidos amistosos y la nations leguae en el soccer? Para
// deterrminar los juegos que hay hoy?" y, tras confirmar que no estaban
// cubiertas, "si agregalos todos".
// =================================================================
// Mismo patrón que test_eredivisie.js para agregar una competencia nueva
// de fútbol — 2 cambios:
//   1. soccerApi.js (LIGAS_SOCCER): 4 entradas nuevas — 'fifa.friendly'
//      (Amistoso Internacional), 'fifa.worldq.conmebol' (Eliminatorias
//      Conmebol), 'conmebol.america' (Copa América), 'uefa.nations'
//      (UEFA Nations League).
//   2. diccionarioEquipos.js: las 10 selecciones de la CONMEBOL (con
//      "vinotinto" para Venezuela) + una selección amplia de selecciones
//      europeas, todas con deporte "soccer" (mismo deporte que los
//      clubes — evaluador.js no distingue torneo).
//
// A diferencia de Eredivisie (una liga más, mismo "tipo" que las 12
// anteriores), acá lo que se verifica con más cuidado es que el "nombre"
// de cada selección sea el nombre del país EN INGLÉS (confirmado por
// búsqueda web contra partidos reales de ESPN, ej. "Argentina 3-0
// Venezuela", "Spain 5-4 France") — mientras que el APODO que escribe el
// cliente/operador en el chat sigue en español, y en el caso de
// Venezuela, también su apodo popular "vinotinto".
const assert = require('assert');
const { evaluarJugada } = require('../src/services/evaluador');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');
const { LIGAS_SOCCER, obtenerResultadosSoccer } = require('../src/services/soccerApi');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) Las 4 competencias de selecciones están en LIGAS_SOCCER ---
const nuevasLigas = [
  ['fifa.friendly', 'Amistoso Internacional'],
  ['fifa.worldq.conmebol', 'Eliminatorias Conmebol'],
  ['conmebol.america', 'Copa América'],
  ['uefa.nations', 'UEFA Nations League']
];
nuevasLigas.forEach(([slug, nombre]) => {
  check(
    LIGAS_SOCCER.some(l => l.slug === slug && l.nombre === nombre),
    'LIGAS_SOCCER incluye ' + nombre + ' ({ slug: "' + slug + '" })'
  );
});
check(LIGAS_SOCCER.length === 17, 'LIGAS_SOCCER tiene ahora 17 competencias en total (13 de clubes + 4 de selecciones)');

// --- 2) Las 10 selecciones de la CONMEBOL (con "vinotinto" para
// Venezuela) resuelven al nombre del país EN INGLÉS exacto ---
const conmebol = [
  ['argentina', 'Argentina'], ['bolivia', 'Bolivia'], ['brasil', 'Brazil'],
  ['chile', 'Chile'], ['colombia', 'Colombia'], ['ecuador', 'Ecuador'],
  ['paraguay', 'Paraguay'], ['peru', 'Peru'], ['uruguay', 'Uruguay'],
  ['venezuela', 'Venezuela'], ['vinotinto', 'Venezuela'], ['la vinotinto', 'Venezuela']
];
conmebol.forEach(([apodo, esperado]) => {
  const linea = apodo.charAt(0).toUpperCase() + apodo.slice(1) + ' -110';
  const r = evaluarJugada(linea, {}, DICCIONARIO_EQUIPOS_BASE, {});
  check(
    r.debug && r.debug.apodoDetectado === apodo && r.debug.equipoOficial === esperado,
    'Selección "' + apodo + '" resuelve a "' + esperado + '" (el nombre que va a buscar en el marcador en vivo)'
  );
});

// --- 3) Una muestra de selecciones europeas (las que más probablemente
// aparezcan en un Amistoso o en la UEFA Nations League) también resuelve
// bien ---
const europeas = [
  ['espana', 'Spain'], ['francia', 'France'], ['alemania', 'Germany'],
  ['inglaterra', 'England'], ['italia', 'Italy'], ['portugal', 'Portugal'],
  ['holanda', 'Netherlands'], ['croacia', 'Croatia']
];
europeas.forEach(([apodo, esperado]) => {
  const linea = apodo.charAt(0).toUpperCase() + apodo.slice(1) + ' -110';
  const r = evaluarJugada(linea, {}, DICCIONARIO_EQUIPOS_BASE, {});
  check(
    r.debug && r.debug.apodoDetectado === apodo && r.debug.equipoOficial === esperado,
    'Selección "' + apodo + '" resuelve a "' + esperado + '"'
  );
});

// --- 4) Regresión: ninguna selección nueva pisa un club ya existente
// que la CONTENGA como sustring (ej. "Universidad de Chile" no debe
// resolver como si fuera la selección de Chile pelada) ---
const regresion = [
  ['Universidad de Chile -110', 'Universidad de Chile'],
  ['Atletico Nacional -110', 'Atlético Nacional'],
  ['Independiente del Valle -110', 'Independiente del Valle'],
  ['Liga de Quito -110', 'Liga de Quito'],
  ['Cerro Porteno -110', 'Cerro Porteño'],
  ['Penarol -110', 'Peñarol']
];
regresion.forEach(([linea, esperado]) => {
  const r = evaluarJugada(linea, {}, DICCIONARIO_EQUIPOS_BASE, {});
  check(
    r.debug && r.debug.equipoOficial === esperado,
    'Regresión: "' + linea.trim() + '" sigue resolviendo a "' + esperado + '" (no lo pisó ninguna selección nueva)'
  );
});

// --- 5) De punta a punta: un ticket real de "Venezuela +250" se resuelve
// SOLO (GANADA/PERDIDA) contra el marcador en vivo de Eliminatorias
// Conmebol, igual que cualquier otra de las 13 ligas de clubes de
// siempre — mismo caso real usado para confirmar el slug por búsqueda
// web (Argentina 3-0 Venezuela, Eliminatorias, 04-09-2025) ---
(async function main() {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/soccer/fifa.worldq.conmebol/')) {
      return {
        json: async () => ({
          events: [{
            id: 'espn-conmebol-1',
            date: '2026-09-24T23:00Z',
            competitions: [{
              status: { type: { completed: true, description: 'Full Time', state: 'post' }, period: 2 },
              competitors: [
                { homeAway: 'home', team: { displayName: 'Argentina', logo: null }, score: '3', winner: true },
                { homeAway: 'away', team: { displayName: 'Venezuela', logo: null }, score: '0', winner: false }
              ]
            }]
          }]
        })
      };
    }
    if (u.includes('/soccer/')) {
      return { json: async () => ({ events: [] }) }; // las demás 16 competencias: sin partidos ese día
    }
    throw new Error('URL inesperada en la prueba: ' + url);
  };

  const datosSoccer = await obtenerResultadosSoccer('2026-09-24');
  const datosPorDeporte = { soccer: datosSoccer };

  const rGanada = evaluarJugada('Argentina -450', datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, {});
  check(rGanada.estado === 'GANADA', 'Ticket real "Argentina -450" (moneyline, Eliminatorias Conmebol, ganó 3-0) se resuelve GANADA solo');

  const rPerdida = evaluarJugada('Vinotinto +450', datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, {});
  check(rPerdida.estado === 'PERDIDA', 'Ticket real "Vinotinto +450" (apodo popular de Venezuela, mismo partido que perdió) se resuelve PERDIDA solo');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
});
