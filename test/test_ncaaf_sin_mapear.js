// =================================================================
// PRUEBA: NCAAF (fútbol americano universitario) — historia completa de
// este mismo día (12-09-2026), en 2 entregas:
// =================================================================
// ENTREGA 1 (mañana del 12-09-2026, bug real reportado con un ticket real,
// "RICKY", Ticket #6): "Over Miami Florida🏈 (66)-110 / 49ers🏈(+3.5)-110 /
// Yankees⚾️(-300) / 50$ / 50//192,98✅ como este ticket tiene un juego de
// ncaaf y aun no tenemos esa api me marca como pendiente pero manualmente
// ya yo marque que se cumple el parley por que no funciona?". En ese
// momento NCAAF no tenía ninguna API conectada — se agregó "Miami Florida"
// al diccionario con deporte 'ncaaf' SIN entrada en CONFIG_POR_DEPORTE, así
// que quedaba SIN_MAPEO (no PENDIENTE) y el marcador manual (✅/❌/⭕)
// resolvía el ticket.
//
// ENTREGA 2 (mismo día, más tarde, a pedido explícito del usuario: "crees
// que puedas agregar una api para ncaaf? existe?"): se conectó la API real
// de NCAAF (ver ncaafApi.js, misma API de ESPN que ya usa NFL) y se agregó
// CONFIG_POR_DEPORTE.ncaaf en evaluador.js, además de ampliar el
// diccionario a las 4 conferencias "Power" + Notre Dame (ver la nota
// grande en diccionarioEquipos.js). Efecto sobre el comportamiento de este
// archivo:
//   - Un equipo de NCAAF que SÍ está en el diccionario ampliado (ej. Miami
//     Hurricanes, Georgia Bulldogs, LSU...) ya NO queda SIN_MAPEO: ahora
//     tiene una API real detrás, así que se comporta EXACTAMENTE igual que
//     cualquier otro deporte conectado (MLB/NFL/NHL/fútbol/NBA) — si el
//     partido está en la API, se resuelve SOLO; si no está (bye week, fecha
//     mal puesta, la API todavía no lo cargó), queda PENDIENTE de verdad
//     (una pendencia RECUPERABLE, no una que el marcador manual deba
//     pisar) — mismo criterio que ya regía para esos otros 5 deportes.
//   - Un equipo de NCAAF que TODAVÍA NO está en el diccionario (cualquier
//     programa fuera de las 4 conferencias "Power" + Notre Dame) sigue
//     quedando SIN_MAPEO igual que el día de hoy a la mañana — el
//     marcador manual lo sigue resolviendo, exactamente igual que
//     cualquier equipo sin mapear de cualquier otro deporte.
//
// ENTREGA 3 (mismo día, más tarde todavía — bug real reportado por un
// usuario: "🏈 California rl +3.5 -104 / 🏈 Texas state rl -2.5 -110 /
// 500//1372✅ Tengo este parley de ncaaf que se pierde pero en la sabana
// automatica lo marca como que se gana por que?"): "Texas state" (Sun
// Belt) todavía no estaba en el diccionario, y como el apodo pelado
// "texas" ya existe (mlb, Texas Rangers), la jugada se emparejaba por
// error contra los Rangers de béisbol en vez de caer en SIN_MAPEO — mismo
// bug que "Miami Florida" de la Entrega 1, con "texas" en vez de "miami"
// como apodo corto pre-existente. Se agregó TODO el resto de la FBS
// (AAC, Conference USA, MAC, Mountain West, Sun Belt + independientes,
// ver la nota grande en diccionarioEquipos.js) siguiendo la misma regla
// ("agregar un apodo más largo y específico que CONTENGA al corto, así
// gana automático"). Efecto sobre este archivo: "Fresno State" (usado
// hasta ahora como ejemplo de programa SIN_MAPEO en los puntos 3 y 7) ya
// quedó mapeado — se reemplazó por "North Dakota State" (potencia de
// FCS, fuera del alcance de la API de FBS de ESPN) como el nuevo ejemplo
// de programa genuinamente sin mapear.
// Mismo patrón de base de datos + fetch falsos que
// test_marcador_manual_sin_mapeo.js/test_alertas_integracion.js.
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const FECHA_PRUEBA = '2026-09-12';

function ejecutarQuery(text) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT \* FROM jugadores/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM avales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  if (/FROM polla_historial/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO alertas/i.test(sql)) return { rows: [{ id: 'alerta-' + Math.random().toString(36).slice(2) }] };
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

// 49ers GANA de verdad (moneyline), Yankees GANA de verdad, y ahora (a
// diferencia de la Entrega 1) Miami Hurricanes TAMBIÉN gana de verdad vía
// la API real de NCAAF — el parley entero se resuelve SOLO, sin hacer
// falta ningún marcador manual.
function fakeFetchResuelto(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: 'New York Yankees' }, score: 6 },
              away: { team: { name: 'Boston Red Sox' }, score: 2 }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
            gamePk: 9001
          }]
        }]
      })
    });
  }
  if (url.includes('/football/nfl/')) {
    return Promise.resolve({
      json: async () => ({
        events: [{
          id: 'espn-nfl-9001',
          date: FECHA_PRUEBA + 'T20:00:00Z',
          competitions: [{
            status: { type: { completed: true, description: 'Final', state: 'post' } },
            competitors: [
              { homeAway: 'home', team: { displayName: 'San Francisco 49ers', logo: null }, score: '27' },
              { homeAway: 'away', team: { displayName: 'Seattle Seahawks', logo: null }, score: '13' }
            ]
          }]
        }]
      })
    });
  }
  if (url.includes('/football/college-football/')) {
    return Promise.resolve({
      json: async () => ({
        events: [{
          id: 'espn-ncaaf-9001',
          date: FECHA_PRUEBA + 'T18:00:00Z',
          competitions: [{
            status: { type: { completed: true, description: 'Final', state: 'post' } },
            competitors: [
              { homeAway: 'home', team: { displayName: 'Miami Hurricanes', logo: null }, score: '66' },
              { homeAway: 'away', team: { displayName: 'Florida State Seminoles', logo: null }, score: '20' }
            ]
          }]
        }]
      })
    });
  }
  return Promise.resolve({ json: async () => ({ events: [] }) });
}

// Variante para el caso de regresión: los 49ers todavía NO tienen ningún
// partido en la API (una pendencia REAL de NFL, no relacionada con NCAAF).
function fakeFetchConPendenciaReal(url) {
  if (url.includes('/football/nfl/')) {
    return Promise.resolve({ json: async () => ({ events: [] }) });
  }
  return fakeFetchResuelto(url);
}

// Variante para el caso de la Entrega 2: la API de NCAAF está conectada
// (por eso 'ncaaf' YA tiene config), pero todavía no cargó ESTE partido de
// Miami puntual (ej. la sábana se procesó muy temprano) — a diferencia de
// la Entrega 1, esto ahora es una pendencia REAL (recuperable sola, cuando
// la API la cargue), NO algo que el marcador manual deba pisar.
function fakeFetchSinDatoNCAAFTodavia(url) {
  if (url.includes('/football/college-football/')) {
    return Promise.resolve({ json: async () => ({ events: [] }) });
  }
  return fakeFetchResuelto(url);
}

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';

const { procesarSabana } = require(path.join(__dirname, '..', 'src', 'services', 'procesarSabana'));
const { evaluarJugada } = require(path.join(__dirname, '..', 'src', 'services', 'evaluador'));
const { DICCIONARIO_EQUIPOS_BASE, mezclarConPersonalizados } = require(path.join(__dirname, '..', 'src', 'services', 'diccionarioEquipos'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const diccionario = mezclarConPersonalizados([], []);

  // -----------------------------------------------------------------
  // 1) Unidad: "miami florida"/"miami hurricanes" YA NO quedan SIN_MAPEO
  //    (Entrega 2: 'ncaaf' ahora tiene una API real conectada) — sin datos
  //    de la API en la mano, quedan PENDIENTE ("no encontrado"), igual que
  //    cualquier otro equipo de un deporte conectado que todavía no tiene
  //    partido cargado. Lo importante es que sigue siendo EL EQUIPO
  //    CORRECTO (Miami Hurricanes, NCAAF) — nunca se confunde con
  //    Dolphins/Marlins.
  // -----------------------------------------------------------------
  const resMiamiFlorida = evaluarJugada('miami florida alta 66-110', {}, diccionario, { deporteMarcador: 'nfl' });
  check(resMiamiFlorida.estado === 'PENDIENTE', '"miami florida" (NCAAF, ya con API real) da PENDIENTE cuando no hay datos — no SIN_MAPEO, y sin confundirse con Miami Dolphins pese al 🏈/nfl forzado');
  check(resMiamiFlorida.debug.equipoOficial === 'Miami (FL) Hurricanes', 'el debug identifica el equipo correcto (Miami (FL) Hurricanes), no un equipo de NFL/MLB');

  const resMiamiHurricanes = evaluarJugada('miami hurricanes -150', {}, diccionario, {});
  check(resMiamiHurricanes.estado === 'PENDIENTE', '"miami hurricanes" también da PENDIENTE sin datos (mismo equipo, alias distinto)');

  // Regresión: "miami" SOLO (sin "florida"/"hurricanes") sigue funcionando
  // exactamente igual que siempre — no se rompió nada de MLB/NFL.
  const resMiamiSolo = evaluarJugada('miami -3 -110', {}, diccionario, { deporteMarcador: 'nfl' });
  check(resMiamiSolo.estado === 'PENDIENTE' && resMiamiSolo.debug.equipoOficial === 'Miami Dolphins',
    'REGRESIÓN: "miami" solo (sin "florida") sigue resolviendo a Miami Dolphins vía el emoji 🏈, sin verse afectado por el diccionario de NCAAF');

  // -----------------------------------------------------------------
  // 2) Unidad, más general: un deporte SIN NINGUNA API (todavía) sigue
  //    dando SIN_MAPEO, no PENDIENTE — esa parte de la regla NO cambió con
  //    la Entrega 2, sigue siendo la red de seguridad para cualquier
  //    deporte que se agregue al diccionario ANTES de conectarle su API
  //    (como le pasaba a NCAAF hasta esta misma mañana).
  // -----------------------------------------------------------------
  const dicConDeporteInventado = { ...diccionario, 'equipo de prueba': [{ nombre: 'Equipo De Prueba FC', deporte: 'deporte-que-no-existe' }] };
  const resDeporteInventado = evaluarJugada('equipo de prueba -110', {}, dicConDeporteInventado, {});
  check(resDeporteInventado.estado === 'SIN_MAPEO', 'un deporte cualquiera sin CONFIG_POR_DEPORTE (sin API) da SIN_MAPEO, no PENDIENTE');
  check(/todavía no tiene una API conectada/.test(resDeporteInventado.razon), 'la razón sigue explicando que ese deporte no tiene API, solo cambió el estado');

  // -----------------------------------------------------------------
  // 3) Unidad: un programa de NCAAF que TODAVÍA NO está en el diccionario
  //    ampliado (fuera de las 4 conferencias "Power" + Notre Dame) sigue
  //    quedando SIN_MAPEO — el marcador manual lo sigue resolviendo igual
  //    que a cualquier equipo sin mapear de cualquier otro deporte. Esto
  //    demuestra que ampliar el diccionario no le sacó la red de seguridad
  //    a los programas que todavía faltan.
  // -----------------------------------------------------------------
  const resProgramaNoMapeado = evaluarJugada('north dakota state bison -110', {}, diccionario, {});
  check(resProgramaNoMapeado.estado === 'SIN_MAPEO', 'un programa que todavía no está en el diccionario (ej. North Dakota State, de la FCS) sigue dando SIN_MAPEO, no PENDIENTE');

  // -----------------------------------------------------------------
  // 3-bis) LA ENTREGA 3: el caso puntual reportado por el usuario. "Texas
  //    state" ahora SÍ está en el diccionario (Sun Belt) con la clave
  //    compuesta "texas state" — más larga que el apodo pelado "texas"
  //    (mlb, Texas Rangers) y lo contiene, así que gana automático por la
  //    regla de "el apodo más largo que contiene al corto gana". Ya NO se
  //    confunde con los Rangers de béisbol.
  // -----------------------------------------------------------------
  const resTexasState = evaluarJugada('🏈 Texas state rl -2.5 -110', {}, diccionario, {});
  check(resTexasState.debug.apodoDetectado === 'texas state', '"Texas state" ahora se detecta con su propio apodo compuesto, no con el "texas" pelado');
  check(resTexasState.debug.equipoOficial === 'Texas State Bobcats', '"Texas state" resuelve a Texas State Bobcats (ncaaf) — ya NO a Texas Rangers (mlb)');
  check(resTexasState.estado === 'PENDIENTE', '"Texas state" (ya mapeado, con API real) da PENDIENTE sin datos en la mano — no SIN_MAPEO ni una respuesta prestada de otro deporte');

  // -----------------------------------------------------------------
  // 4) De punta a punta, CON la API de NCAAF real conectada: el mismo
  //    ticket real reportado por el usuario (Miami Florida + 49ers +
  //    Yankees) — ahora los 3 juegos GANAN de verdad vía sus 3 APIs (ya no
  //    hace falta ningún marcador manual para la pata de NCAAF).
  // -----------------------------------------------------------------
  global.fetch = fakeFetchResuelto;
  const textoTicketReal = [
    'RICKY',
    'Ticket #6',
    'miami florida alta 66-110',
    '49ers -150',
    'yankees -300',
    '50//192.98✅'
  ].join('\n');
  const r1 = await procesarSabana('grupo-ncaaf', textoTicketReal, FECHA_PRUEBA);
  const t1 = r1.tickets.find(t => t.cliente === 'RICKY');
  check(!!t1, 'el ticket de RICKY aparece en la respuesta');
  check(t1.estado === 'GANADA', 'el ticket real reportado (Miami Florida NCAAF + 49ers + Yankees) queda GANADA — ahora resuelto por las 3 APIs reales, incluida NCAAF');
  check(!t1.resueltoPorMarcadorManualSinMapeo, 'YA NO hizo falta el marcador manual: la pata de NCAAF se resolvió sola contra la API real, igual que las otras 2');

  // -----------------------------------------------------------------
  // 5) Regresión (pendencia real de NFL, sin relación con NCAAF): si
  //    además de NCAAF hay OTRA pata con una pendencia real (49ers sin
  //    partido en la API), el ticket sigue PENDIENTE.
  // -----------------------------------------------------------------
  global.fetch = fakeFetchConPendenciaReal;
  const textoConPendenciaReal = [
    'CARLOS',
    'Ticket #7',
    'miami florida alta 66-110',
    '49ers -150',
    'yankees -300',
    '50//192.98✅'
  ].join('\n');
  const r2 = await procesarSabana('grupo-ncaaf', textoConPendenciaReal, FECHA_PRUEBA);
  const t2 = r2.tickets.find(t => t.cliente === 'CARLOS');
  check(t2.estado === 'PENDIENTE', 'con una pendencia REAL de NFL mezclada (49ers sin partido en la API), el ticket sigue PENDIENTE');

  // -----------------------------------------------------------------
  // 6) LA NUEVA REGLA DE LA ENTREGA 2: si el ÚNICO problema es que la API
  //    de NCAAF todavía no cargó el partido de Miami (una pendencia REAL
  //    de NCAAF, no "sin mapear"), el marcador manual YA NO debe pisarla —
  //    a diferencia de la Entrega 1, ahora NCAAF es un deporte conectado
  //    de verdad, así que se comporta como cualquier otro: PENDIENTE de
  //    verdad, recuperable sola cuando la API cargue el partido.
  // -----------------------------------------------------------------
  global.fetch = fakeFetchSinDatoNCAAFTodavia;
  const textoSinDatoNCAAFTodavia = [
    'JULIA',
    'Ticket #8',
    'miami florida alta 66-110',
    '49ers -150',
    'yankees -300',
    '50//192.98✅'
  ].join('\n');
  const r3 = await procesarSabana('grupo-ncaaf', textoSinDatoNCAAFTodavia, FECHA_PRUEBA);
  const t3 = r3.tickets.find(t => t.cliente === 'JULIA');
  check(t3.estado === 'PENDIENTE', 'si la API de NCAAF todavía no cargó el partido de Miami, el ticket queda PENDIENTE de verdad (pendencia real, ya no "sin mapear") aunque tenga el marcador ✅');
  check(!t3.resueltoPorMarcadorManualSinMapeo, 'el marcador manual NO se usa acá: la pendencia de NCAAF ahora es real (API conectada), no "equipo sin mapear"');

  // -----------------------------------------------------------------
  // 7) El marcador manual SIGUE funcionando para un programa de NCAAF que
  //    todavía no está en el diccionario ampliado (Fresno State, ver el punto 3)
  //    — mismo mecanismo de siempre para equipos genuinamente sin mapear.
  // -----------------------------------------------------------------
  global.fetch = fakeFetchResuelto;
  const textoConProgramaNoMapeado = [
    'PEDRO',
    'Ticket #9',
    'north dakota state bison -110',
    '49ers -150',
    'yankees -300',
    '50//192.98✅'
  ].join('\n');
  const r4 = await procesarSabana('grupo-ncaaf', textoConProgramaNoMapeado, FECHA_PRUEBA);
  const t4 = r4.tickets.find(t => t.cliente === 'PEDRO');
  check(t4.estado === 'GANADA', 'un programa que todavía no está en el diccionario (North Dakota State) se sigue resolviendo vía el marcador manual, con los otros 2 legs ganando de verdad');
  check(t4.resueltoPorMarcadorManualSinMapeo === true, 'para North Dakota State (sin mapear) el marcador manual SIGUE activándose, a diferencia de Miami (ya mapeado, con API real)');

  // -----------------------------------------------------------------
  // 8) ENTREGA 3, de punta a punta: el ticket real reportado ("Ticket 2",
  //    California +3.5 / Texas state -2.5). California pierde por 10
  //    (no cubre el +3.5) y Texas State gana por 10 (sí cubre el -2.5) —
  //    como una jugada del parley PIERDE, el parley entero debe quedar
  //    PERDIDA, no GANADA. Antes de este arreglo, "Texas state" se
  //    emparejaba con los Rangers de mlb (un resultado real pero de otro
  //    juego) y podía dar cualquier cosa por casualidad; ahora usa el
  //    partido real de NCAAF de Texas State/California.
  // -----------------------------------------------------------------
  function fakeFetchTicket2(url) {
    if (url.includes('/football/college-football/')) {
      return Promise.resolve({
        json: async () => ({
          events: [{
            id: 'espn-ncaaf-9002',
            date: FECHA_PRUEBA + 'T20:00:00Z',
            competitions: [{
              status: { type: { completed: true, description: 'Final', state: 'post' } },
              competitors: [
                { homeAway: 'home', team: { displayName: 'Texas State Bobcats', logo: null }, score: '30' },
                { homeAway: 'away', team: { displayName: 'California Golden Bears', logo: null }, score: '20' }
              ]
            }]
          }]
        })
      });
    }
    return Promise.resolve({ json: async () => ({ events: [] }) });
  }
  global.fetch = fakeFetchTicket2;
  const textoTicket2 = [
    'Ticket 2',
    '🏈 California rl +3.5 -104',
    '🏈 Texas state rl -2.5 -110',
    '500//1372✅'
  ].join('\n');
  const r5 = await procesarSabana('grupo-ncaaf', textoTicket2, FECHA_PRUEBA);
  const t5 = r5.tickets[0];
  check(!!t5, 'el "Ticket 2" reportado por el usuario aparece en la respuesta');
  check(t5.estado === 'PERDIDA', 'el "Ticket 2" real (California no cubre +3.5, aunque Texas State sí cubra -2.5) queda PERDIDA — ya no se marca GANADA por error');
  check(!t5.resueltoPorMarcadorManualSinMapeo, 'ya no hizo falta el marcador manual ✅: ambas patas se resolvieron solas contra la API real de NCAAF, y el estado real (PERDIDA) le ganó al marcador manual');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de NCAAF se cayó con una excepción:', e);
  process.exit(1);
});
