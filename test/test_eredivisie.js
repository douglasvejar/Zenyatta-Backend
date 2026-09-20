// =================================================================
// PRUEBA: Eredivisie (liga holandesa de fútbol) agregada al programa
// (20-09-2026), a pedido explícito del usuario: "Y tenemos la liga
// holandesa para agregar al programa porque no me aparece para agregar
// equipos a la api".
// =================================================================
// Mismo patrón que test_ncaaf_sin_mapear.js (12-09-2026, FBS+FCS) para
// agregar una liga/subdivisión nueva: 3 cambios —
//   1. soccerApi.js (LIGAS_SOCCER): nueva entrada { slug: 'ned.1', nombre:
//      'Eredivisie' } — con esto sola ya alcanza para que la Eredivisie
//      aparezca en "Registrar Equipo o Apodo Nuevo" (equipos.js reusa
//      LIGAS_SOCCER para el datalist) y para que sus resultados en vivo
//      se pidan junto con las otras 12 ligas de fútbol.
//   2. diccionarioEquipos.js: los 18 clubes de la temporada 2025-26/
//      2026-27 (Ajax, PSV, Feyenoord, AZ Alkmaar, FC Twente, FC Utrecht,
//      FC Groningen, Heerenveen, Sparta, Go Ahead Eagles, NEC, Fortuna,
//      Heracles, PEC Zwolle, NAC Breda, Excelsior, Telstar, FC Volendam).
//
// Detalle importante que este archivo verifica a propósito (fue la parte
// más delicada de esta entrega, no solo agregar el slug): el campo
// "nombre" de cada club en el diccionario tiene que ser EXACTAMENTE el
// texto que ESPN usa como `team.displayName` en su scoreboard en vivo —
// si no coincide, el ticket se reconoce (no queda SIN_MAPEO) pero el
// partido en vivo nunca se encuentra, y queda PENDIENTE para siempre.
// Confirmado por búsqueda web (no se pudo pegarle directo a la API desde
// este sandbox — misma limitación de red de siempre) contra decenas de
// resultados reales de partidos: varios clubes de Eredivisie aparecen en
// el marcador de ESPN con su forma CORTA, no la larga de su página de
// equipo — "PSV" (no "PSV Eindhoven"), "Sparta" (no "Sparta Rotterdam"),
// "NEC" (no "NEC Nijmegen"), "Fortuna" (no "Fortuna Sittard"), "Heracles"
// (no "Heracles Almelo"), "Heerenveen" (no "SC Heerenveen") — mientras que
// AZ es la excepción y SÍ aparece completo ("AZ Alkmaar", nunca solo
// "AZ" — que además sería un apodo peligroso de agregar pelado: "az" es
// sustring de "Lazio", "Trail Blazers", "Jazz", "Cruz Azul", etc.).
const assert = require('assert');
const { evaluarJugada } = require('../src/services/evaluador');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');
const { LIGAS_SOCCER, obtenerResultadosSoccer } = require('../src/services/soccerApi');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) La liga está en LIGAS_SOCCER (esto solo ya alcanza para que
// aparezca en el datalist de "Registrar Equipo o Apodo Nuevo", que reusa
// esta misma lista) ---
check(
  LIGAS_SOCCER.some(l => l.slug === 'ned.1' && l.nombre === 'Eredivisie'),
  'LIGAS_SOCCER incluye la Eredivisie ({ slug: "ned.1", nombre: "Eredivisie" })'
);

// --- 2) Cada apodo (forma corta Y forma larga) resuelve al "nombre"
// EXACTO que después hace falta para encontrar el partido en vivo ---
const casosApodo = [
  ['ajax', 'Ajax'], ['psv', 'PSV'], ['psv eindhoven', 'PSV'], ['feyenoord', 'Feyenoord'],
  ['az alkmaar', 'AZ Alkmaar'], ['fc twente', 'FC Twente'], ['twente', 'FC Twente'],
  ['fc utrecht', 'FC Utrecht'], ['utrecht', 'FC Utrecht'], ['fc groningen', 'FC Groningen'],
  ['groningen', 'FC Groningen'], ['heerenveen', 'Heerenveen'], ['sc heerenveen', 'Heerenveen'],
  ['sparta', 'Sparta'], ['sparta rotterdam', 'Sparta'], ['go ahead eagles', 'Go Ahead Eagles'],
  ['nec', 'NEC'], ['nec nijmegen', 'NEC'], ['fortuna', 'Fortuna'], ['fortuna sittard', 'Fortuna'],
  ['heracles', 'Heracles'], ['heracles almelo', 'Heracles'], ['pec zwolle', 'PEC Zwolle'],
  ['zwolle', 'PEC Zwolle'], ['nac breda', 'NAC Breda'], ['breda', 'NAC Breda'],
  ['excelsior', 'Excelsior'], ['telstar', 'Telstar'], ['fc volendam', 'FC Volendam'],
  ['volendam', 'FC Volendam']
];
casosApodo.forEach(([apodo, esperado]) => {
  const linea = apodo.charAt(0).toUpperCase() + apodo.slice(1) + ' -110';
  const r = evaluarJugada(linea, {}, DICCIONARIO_EQUIPOS_BASE, {});
  check(
    r.debug && r.debug.apodoDetectado === apodo && r.debug.equipoOficial === esperado,
    'Apodo "' + apodo + '" resuelve a "' + esperado + '" (el nombre que va a buscar en el marcador en vivo)'
  );
});

// --- 3) Regresión: los apodos cortos que se agregaron (sparta/nec/
// fortuna/heracles/breda/zwolle) NO pisan equipos ya existentes de OTROS
// deportes/ligas que por casualidad los contienen como sustring — la
// especificidad de evaluarJugada() (el apodo más largo que CONTIENE al
// corto gana) tiene que seguir protegiendo estos casos ---
const regresion = [
  ['Michigan State Spartans -110', 'Michigan State Spartans'],
  ['San Jose State Spartans -110', 'San Jose State Spartans'],
  ['Necaxa -110', 'Necaxa'],
  ['Lazio -110', 'Lazio'],
  ['Trail Blazers -110', 'Portland Trail Blazers'],
  ['Utah Jazz -110', 'Utah Jazz'],
  ['Philadelphia Eagles -110', 'Philadelphia Eagles'],
  ['Cruz Azul -110', 'Cruz Azul'],
  ['Arkansas Razorbacks -110', 'Arkansas Razorbacks']
];
regresion.forEach(([linea, esperado]) => {
  const r = evaluarJugada(linea, {}, DICCIONARIO_EQUIPOS_BASE, {});
  check(
    r.debug && r.debug.equipoOficial === esperado,
    'Regresión: "' + linea.trim() + '" sigue resolviendo a "' + esperado + '" (no lo pisó ningún apodo corto nuevo de Eredivisie)'
  );
});

// --- 4) De punta a punta: un ticket real de "PSV -150" se resuelve SOLO
// (GANADA/PERDIDA) contra el marcador en vivo de la Eredivisie, igual que
// cualquier otra de las 12 ligas de fútbol de siempre ---
(async function main() {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/soccer/ned.1/')) {
      return {
        json: async () => ({
          events: [{
            id: 'espn-ned-1',
            date: '2026-09-20T18:00Z',
            competitions: [{
              status: { type: { completed: true, description: 'Full Time', state: 'post' }, period: 2 },
              competitors: [
                { homeAway: 'home', team: { displayName: 'PSV', logo: null }, score: '2', winner: true },
                { homeAway: 'away', team: { displayName: 'FC Twente', logo: null }, score: '1', winner: false }
              ]
            }]
          }]
        })
      };
    }
    if (u.includes('/soccer/')) {
      return { json: async () => ({ events: [] }) }; // las demás 12 ligas: sin partidos ese día
    }
    throw new Error('URL inesperada en la prueba: ' + url);
  };

  const datosSoccer = await obtenerResultadosSoccer('2026-09-20');
  const datosPorDeporte = { soccer: datosSoccer };

  const rGanada = evaluarJugada('PSV -150', datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, {});
  check(rGanada.estado === 'GANADA', 'Ticket real "PSV -150" (moneyline, PSV ganó 2-1) se resuelve GANADA solo, sin marcador manual');

  const rPerdida = evaluarJugada('Fc twente -150', datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, {});
  check(rPerdida.estado === 'PERDIDA', 'Ticket real "FC Twente -150" (mismo partido, el que perdió) se resuelve PERDIDA solo');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
});
