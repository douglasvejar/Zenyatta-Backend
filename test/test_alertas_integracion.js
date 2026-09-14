// =================================================================
// PRUEBA DE INTEGRACIÓN: procesarSabana.js <-> alertas.js (28-08-2026)
// =================================================================
// A diferencia de test_logica.js (que prueba evaluador.js en aislado,
// pasándole los candidatos ambiguos a mano) esta prueba corre el
// ORQUESTADOR COMPLETO (procesarSabana.js) con una base de datos falsa en
// memoria (mismo espíritu que test_wiring.js, que también reemplaza "pg"),
// para confirmar que:
//   1. Una jugada AMBIGUA de verdad genera una fila en "alertas" y que
//      procesarSabana.js devuelve "alertasNuevas" correctamente.
//   2. Resolverla con alertas.resolverAlerta() (como haría la pestaña
//      "Alertas" del panel) guarda la elección en "resoluciones_ambiguas".
//   3. Al REPROCESAR la MISMA sábana, evaluarJugada() ya usa esa
//      resolución sola (capa 0) y el ticket sale bien resuelto — sin
//      volver a generar otra alerta.
//
// "miami" y "houston" YA son apodos ambiguos de verdad en el diccionario
// BASE (Marlins/mlb + Dolphins/nfl, Astros/mlb + Texans/nfl — ver
// diccionarioEquipos.js) así que esta prueba los usa directo, sin
// inyectar nada. El caso de "miami" además fuerza el peor escenario (los
// 2 equipos con partido el mismo día, capa de calendario empatada) para
// seguir probando las capas 0/1/2/3 completas de resolverCandidatoAmbiguo().
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

// --- Base de datos falsa en memoria (reemplaza "pg", igual que test_wiring.js) ---
const TABLAS = { alertas: [], resoluciones_ambiguas: [] };
let siguienteIdAlerta = 1;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT \* FROM jugadores/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM avales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  // (08-09-2026) grupoConfig.js ahora también carga el modelo de comisión
  // del grupo (ver comisiones.js/sql/schema.sql) — esta prueba no lo
  // ejercita, así que alcanza con devolver siempre "plano" sin tiers.
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  // (04-09-2026) registrosSinCambios() en historial.js — esta prueba no
  // trackea el contenido real de tickets_historial, así que "sin filas
  // guardadas todavía" es siempre la respuesta correcta acá.
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  // "Guardar Día" (31-08-2026): guardarEnHistorial() ahora llama a
  // desconfirmarDia() al final de cada (re)proceso — esta prueba no
  // ejercita confirmarDia()/estadoDia() (eso lo cubre test_guardar_dia.js
  // aparte), así que alcanza con que el DELETE no reviente.
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  // Polla del día (02-09-2026): procesarSabana() ahora SIEMPRE la consulta
  // para poder sumarla a "Resumen por Cliente"/Plano — esta prueba no
  // ejercita Polla (eso lo cubre test_polla.js aparte), así que alcanza
  // con devolver "sin filas".
  if (/FROM polla_historial/i.test(sql)) return { rows: [] };

  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) {
    const [grupoId, fecha] = params;
    return { rows: TABLAS.resoluciones_ambiguas.filter(r => r.grupo_id === grupoId && r.fecha === fecha) };
  }
  if (/INSERT INTO resoluciones_ambiguas/i.test(sql)) {
    const [grupoId, fecha, pataTexto, deporteElegido] = params;
    const existente = TABLAS.resoluciones_ambiguas.find(r => r.grupo_id === grupoId && r.fecha === fecha && r.pata_texto === pataTexto);
    if (existente) existente.deporte_elegido = deporteElegido;
    else TABLAS.resoluciones_ambiguas.push({ grupo_id: grupoId, fecha, pata_texto: pataTexto, deporte_elegido: deporteElegido });
    return { rows: [] };
  }

  if (/^INSERT INTO alertas/i.test(sql)) {
    const [grupoId, fecha, tipo, cliente, ticket, pata, mensaje, candidatos] = params;
    const yaHayUnaSinResolver = TABLAS.alertas.some(a => a.grupo_id === grupoId && a.fecha === fecha && a.pata === pata && !a.resuelta);
    if (yaHayUnaSinResolver) return { rows: [] }; // simula el ON CONFLICT ... DO NOTHING (sin RETURNING)
    const id = 'alerta-' + (siguienteIdAlerta++);
    TABLAS.alertas.push({
      id, grupo_id: grupoId, fecha, tipo, cliente_nombre: cliente,
      ticket_label: ticket, pata, mensaje, candidatos: JSON.parse(candidatos), resuelta: false,
      deporte_resuelto: null, leida_superadmin: false, leida_grupo: false
    });
    return { rows: [{ id }] }; // simula el RETURNING id de una fila SÍ insertada
  }
  if (/^SELECT grupo_id, fecha, pata FROM alertas WHERE id = \$1/i.test(sql)) {
    const alerta = TABLAS.alertas.find(a => a.id === params[0]);
    return { rows: alerta ? [{ grupo_id: alerta.grupo_id, fecha: alerta.fecha, pata: alerta.pata }] : [] };
  }
  // descartarAlerta() (SIN_LOGRO, 28-08-2026) hace un SELECT más chico (solo
  // grupo_id, sin fecha ni pata — no hace falta nada más para descartar) y
  // un UPDATE sin deporte_resuelto — distintos de los de arriba/abajo
  // (resolverAlerta), así que se distinguen por texto exacto de la consulta.
  if (/^SELECT grupo_id FROM alertas WHERE id = \$1/i.test(sql)) {
    const alerta = TABLAS.alertas.find(a => a.id === params[0]);
    return { rows: alerta ? [{ grupo_id: alerta.grupo_id }] : [] };
  }
  if (/^UPDATE alertas SET resuelta = true, resuelto_en = now\(\) WHERE id = \$1/i.test(sql)) {
    const [id] = params;
    const alerta = TABLAS.alertas.find(a => a.id === id);
    if (alerta) alerta.resuelta = true; // deporte_resuelto queda null a propósito — no hay nada que "elegir"
    return { rows: [] };
  }
  if (/^UPDATE alertas SET resuelta = true/i.test(sql)) {
    const [deporteElegido, id] = params;
    const alerta = TABLAS.alertas.find(a => a.id === id);
    if (alerta) { alerta.resuelta = true; alerta.deporte_resuelto = deporteElegido; }
    return { rows: [] };
  }

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

// --- Fixtures de las 2 APIs (mismo esquema real ya confirmado en las 2 conexiones) ---
const FECHA_PRUEBA = '2026-08-28';
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: 'Miami Marlins' }, score: 4 },
              away: { team: { name: 'Atlanta Braves' }, score: 2 }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
            gamePk: 999001
          }, {
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: 'Houston Astros' }, score: 5 },
              away: { team: { name: 'Texas Rangers' }, score: 1 }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
            gamePk: 999003
          }]
        }]
      })
    });
  }
  if (url.includes('/football/nfl/')) {
    return Promise.resolve({
      json: async () => ({
        events: [{
          id: 'espn-999002',
          date: FECHA_PRUEBA + 'T20:00:00Z',
          competitions: [{
            status: { type: { completed: true, description: 'Final', state: 'post' } },
            competitors: [
              { homeAway: 'home', team: { displayName: 'Miami Dolphins', logo: null }, score: '27' },
              { homeAway: 'away', team: { displayName: 'New York Jets', logo: null }, score: '10' }
            ]
          }]
        }, {
          id: 'espn-999004',
          date: FECHA_PRUEBA + 'T18:00:00Z',
          competitions: [{
            status: { type: { completed: true, description: 'Final', state: 'post' } },
            competitors: [
              { homeAway: 'home', team: { displayName: 'Houston Texans', logo: null }, score: '20' },
              { homeAway: 'away', team: { displayName: 'Indianapolis Colts', logo: null }, score: '17' }
            ]
          }]
        }, {
          // Dallas Cowboys jugando el MISMO día que Dallas Stars (NHL, ver
          // fixture de abajo) — a propósito, para la prueba de
          // desambiguación "dallas" NFL/NHL (ver más abajo).
          id: 'espn-999005',
          date: FECHA_PRUEBA + 'T21:00:00Z',
          competitions: [{
            status: { type: { completed: true, description: 'Final', state: 'post' } },
            competitors: [
              { homeAway: 'home', team: { displayName: 'Dallas Cowboys', logo: null }, score: '31' },
              { homeAway: 'away', team: { displayName: 'Washington Commanders', logo: null }, score: '14' }
            ]
          }]
        }]
      })
    });
  }
  // NHL — usado solo por las pruebas nuevas de "Múltiples deportes: NHL y
  // fútbol agregados" (28-08-2026); las pruebas viejas de este archivo no
  // dependen de NHL, así que un fixture chico alcanza.
  if (url.includes('/hockey/nhl/')) {
    return Promise.resolve({
      json: async () => ({
        events: [{
          id: 'espn-nhl-1',
          date: FECHA_PRUEBA + 'T23:00:00Z',
          competitions: [{
            status: { type: { completed: true, description: 'Final', state: 'post' }, period: 3 },
            competitors: [
              { homeAway: 'home', team: { displayName: 'Edmonton Oilers', logo: null }, score: '5' },
              { homeAway: 'away', team: { displayName: 'Calgary Flames', logo: null }, score: '2' }
            ]
          }]
        }, {
          // Dallas Stars jugando el MISMO día que Dallas Cowboys (NFL, ver
          // fixture de arriba) — el calendario solo (capa 2 de
          // desambiguación) NO alcanza para desempatar "dallas" acá, hace
          // falta el marcador por-jugada (capa 1).
          id: 'espn-nhl-2',
          date: FECHA_PRUEBA + 'T22:00:00Z',
          competitions: [{
            status: { type: { completed: true, description: 'Final', state: 'post' }, period: 3 },
            competitors: [
              { homeAway: 'home', team: { displayName: 'Dallas Stars', logo: null }, score: '4' },
              { homeAway: 'away', team: { displayName: 'Nashville Predators', logo: null }, score: '2' }
            ]
          }]
        }]
      })
    });
  }
  // NBA (31-08-2026) — ninguna prueba de este archivo depende todavía de
  // datos de NBA; un scoreboard vacío alcanza para que procesarSabana()
  // pueda pedirla en paralelo sin romper nada (mismo criterio que ya usaba
  // fútbol antes de tener su propio fixture con partido real).
  if (url.includes('/basketball/nba/')) {
    return Promise.resolve({ json: async () => ({ events: [] }) });
  }
  // Fútbol — soccerApi.js pide 10 ligas en paralelo (ver LIGAS_SOCCER). Se
  // usa la URL de La Liga (esp.1) para devolver el partido de Real Madrid
  // que necesita la prueba de "parley de 3 patas mezclando MLB/NFL/fútbol"
  // (más abajo); el resto de las ligas devuelve un scoreboard vacío, igual
  // que pasaría un día sin partidos en esa liga.
  if (url.includes('/soccer/esp.1/')) {
    return Promise.resolve({
      json: async () => ({
        events: [{
          id: 'espn-soccer-1',
          date: FECHA_PRUEBA + 'T19:00:00Z',
          competitions: [{
            status: { type: { completed: true, description: 'Full Time', state: 'post' }, period: 2 },
            competitors: [
              { homeAway: 'home', team: { displayName: 'Real Madrid', logo: null }, score: '3', winner: true },
              { homeAway: 'away', team: { displayName: 'Sevilla', logo: null }, score: '1', winner: false }
            ]
          }]
        }]
      })
    });
  }
  if (url.includes('/soccer/')) {
    return Promise.resolve({ json: async () => ({ events: [] }) });
  }
  return Promise.reject(new Error('URL inesperada en la prueba: ' + url));
}

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
global.fetch = fakeFetch;

const { procesarSabana } = require(path.join(__dirname, '..', 'src', 'services', 'procesarSabana'));
const { resolverAlerta, descartarAlerta } = require(path.join(__dirname, '..', 'src', 'services', 'alertas'));
const diccionarioEquipos = require(path.join(__dirname, '..', 'src', 'services', 'diccionarioEquipos'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // Inyecta la ambigüedad de prueba (Marlins/MLB + Dolphins/NFL, mismo
  // apodo "miami") directo en el objeto que YA está en memoria — así
  // mezclarConPersonalizados() (grupoConfig.js) la toma sin tocar disco.
  diccionarioEquipos.DICCIONARIO_EQUIPOS_BASE.miami = [
    { nombre: 'Miami Marlins', deporte: 'mlb' },
    { nombre: 'Miami Dolphins', deporte: 'nfl' }
  ];

  const GRUPO_ID = 'grupo-prueba-1';
  const texto = ['*PEDRO*', 'Ticket 1', 'miami -3 -110', '100//90.91'].join('\n');

  // --- Primera pasada: debe quedar AMBIGUA y generar 1 alerta ---
  const r1 = await procesarSabana(GRUPO_ID, texto, FECHA_PRUEBA);
  check(r1.alertasNuevas === 1, 'procesarSabana(): la primera pasada genera exactamente 1 alerta nueva');
  check(r1.tickets[0].estado === 'AMBIGUA (VARIOS DEPORTES)', 'El ticket de PEDRO queda AMBIGUA (VARIOS DEPORTES) en la primera pasada');
  check(TABLAS.alertas.length === 1 && !TABLAS.alertas[0].resuelta, 'Queda 1 fila sin resolver en la tabla "alertas"');

  // Reprocesar la MISMA sábana sin resolver nada todavía no debe duplicar
  // la alerta (índice único parcial simulado en ejecutarQuery arriba).
  const r1b = await procesarSabana(GRUPO_ID, texto, FECHA_PRUEBA);
  check(r1b.alertasNuevas === 0 && TABLAS.alertas.length === 1, 'Reprocesar sin resolver todavía NO duplica la alerta');

  // --- Resolver la alerta a mano (como desde la pestaña "Alertas") ---
  await resolverAlerta(TABLAS.alertas[0].id, 'nfl');
  check(TABLAS.alertas[0].resuelta && TABLAS.alertas[0].deporte_resuelto === 'nfl', 'resolverAlerta() marca la alerta como resuelta con "nfl"');
  check(TABLAS.resoluciones_ambiguas.length === 1 && TABLAS.resoluciones_ambiguas[0].deporte_elegido === 'nfl',
    'resolverAlerta() guarda la elección en "resoluciones_ambiguas" para la próxima vez');

  // --- Segunda pasada: ya con la resolución guardada, se resuelve sola ---
  const r2 = await procesarSabana(GRUPO_ID, texto, FECHA_PRUEBA);
  check(r2.alertasNuevas === 0, 'Reprocesada con la resolución ya guardada, no genera ninguna alerta nueva');
  check(r2.tickets[0].estado === 'GANADA', 'Resuelto a Dolphins/NFL, el ticket ("miami -3") gana (27-3=24 > 10)');
  check(r2.tickets[0].debug[0].equipoOficial === 'Miami Dolphins', 'El debug del ticket confirma que se resolvió a Miami Dolphins, no Miami Marlins');

  // NOTA: acá antes se borraba `diccionarioEquipos.DICCIONARIO_EQUIPOS_BASE.miami`
  // para no dejar la ambigüedad de prueba inyectada en el módulo compartido.
  // Desde el bug #30 (28-08-2026) "miami" YA es una entrada real y
  // permanente del diccionario BASE (Marlins/mlb + Dolphins/nfl, ver
  // diccionarioEquipos.js) — ya no hace falta inyectarla NI borrarla; se
  // deja tal cual para que los casos de abajo (que también la usan) sigan
  // viéndola ambigua, como sería en producción.

  // =================================================================
  // CASO "HOUSTON NFL" (bug reportado por el usuario, 28-08-2026): en una
  // sábana con jugadas de MLB por emoji ⚾ arriba, un ticket sin emoji que
  // dice "HOUSTON NFL" se estaba tomando como Houston Astros (MLB) e
  // ignorando por completo la palabra "NFL". Houston Astros Y Houston
  // Texans tienen partido el mismo día en este fixture (el peor caso: la
  // capa de calendario por sí sola no alcanza para desempatar), así que
  // esto prueba que la palabra "NFL" pegada a la jugada (capa 1,
  // deporteMarcador) resuelve sola a Houston Texans sin generar ninguna
  // alerta AMBIGUA.
  const GRUPO_ID_2 = 'grupo-prueba-2';
  const textoHouston = [
    '*Ticket 21*',
    '⚾ Toronto alta 8,5 +100 para 200',
    '200//200✅',
    '*WISTON*',
    'Ticket 22',
    'HOUSTON NFL +100 para 150',
    '150//150✅',
    '*MARCOPOLO*'
  ].join('\n');

  const r3 = await procesarSabana(GRUPO_ID_2, textoHouston, FECHA_PRUEBA);
  const ticketHouston = r3.tickets.find(t => t.ticket === 'Ticket #22');
  check(!!ticketHouston, 'El ticket #22 ("HOUSTON NFL") se parseó correctamente de la sábana');
  check(r3.alertasNuevas === 0, 'El ticket "HOUSTON NFL" NO genera alerta AMBIGUA — la palabra "NFL" alcanza para resolverlo solo');
  check(ticketHouston && ticketHouston.debug[0].equipoOficial === 'Houston Texans',
    'El ticket "HOUSTON NFL" se resuelve a Houston Texans (NFL), no a Houston Astros (MLB)');
  check(ticketHouston && ticketHouston.estado === 'GANADA', 'El ticket "HOUSTON NFL +100" gana (20-17=3 > 0, moneyline a favor de Houston)');

  // =================================================================
  // CASO: PARLEY DE VARIAS PATAS CON UNA SOLA PATA AMBIGUA (28-08-2026, a
  // pedido explícito del usuario: "esto es valido para jugadas desde 1
  // pata 2 patas 3 patas etc"). Un parley de 2 patas donde la primera es
  // MLB clarísimo (astros, sin choque con ningún otro deporte) y la
  // segunda es "miami" sin ningún marcador (ambiguo de verdad, Marlins Y
  // Dolphins juegan el mismo día en este fixture) — el ticket ENTERO debe
  // quedar AMBIGUA (VARIOS DEPORTES), no solo la pata problemática, y debe
  // generar exactamente 1 alerta (por la pata de "miami"), aunque la otra
  // pata ya se pudiera resolver perfectamente sola.
  // =================================================================
  const GRUPO_ID_3 = 'grupo-prueba-3';
  const textoParleyAmbiguo = [
    '*TESTCLIENTE*',
    'Ticket 30',
    'astros -150 x miami -3 -110',
    '150//140'
  ].join('\n');

  const r4 = await procesarSabana(GRUPO_ID_3, textoParleyAmbiguo, FECHA_PRUEBA);
  const ticketParley = r4.tickets[0];
  check(ticketParley.estado === 'AMBIGUA (VARIOS DEPORTES)',
    'Un parley de 2 patas con 1 sola pata ambigua (de un total de 2, "miami") queda AMBIGUA el ticket ENTERO, no solo esa pata');
  check(r4.alertasNuevas === 1, 'Genera exactamente 1 alerta nueva (la de la pata "miami"), aunque el ticket tenga 2 patas');
  check(ticketParley.debug.length === 2 && ticketParley.debug[0].resultado === 'GANADA' && ticketParley.debug[1].resultado === 'AMBIGUA (VARIOS DEPORTES)',
    'El debug por-pata sigue mostrando que la 1ra pata (astros) SÍ se pudo resolver sola (GANADA) y la 2da (miami) quedó ambigua — el ticket completo no paga hasta que se aclare');

  // =================================================================
  // CASO: PARLEY DE 3 PATAS CON DEPORTES MEZCLADOS (a pedido explícito del
  // usuario, 28-08-2026: "hay apuestas con deportes mixtos, osea puedes
  // tener un parley de 3 patas donde tengas houston mlb x texas nfl x real
  // madrid que seria futbol"). Cuando se escribió este caso por primera vez
  // fútbol todavía NO tenía API conectada, así que la 3ra pata quedaba
  // PENDIENTE con "todavía no tiene una API conectada". Desde que se
  // integraron fútbol y NHL (28-08-2026, más tarde, ver "Múltiples
  // deportes: fútbol y NHL agregados"), "Real Madrid" ya es un equipo real
  // del diccionario base — este caso ahora demuestra el escenario COMPLETO
  // que pidió el usuario: las 3 patas resolviéndose solas, cada una contra
  // su propia API, en la MISMA llamada.
  // =================================================================
  const GRUPO_ID_4 = 'grupo-prueba-4';
  const textoParleyMixto = [
    '*TESTCLIENTE2*',
    'Ticket 31',
    'astros -150 x texans -120 x real madrid -150',
    '150//140'
  ].join('\n');

  const r5 = await procesarSabana(GRUPO_ID_4, textoParleyMixto, FECHA_PRUEBA);
  const ticketMixto = r5.tickets[0];
  check(ticketMixto.debug.length === 3, 'El parley de 3 patas (MLB x NFL x fútbol) se separó correctamente en 3 patas');
  check(ticketMixto.debug[0].equipoOficial === 'Houston Astros' && ticketMixto.debug[0].resultado === 'GANADA',
    'La pata de MLB (astros) se resolvió sola contra la API de MLB');
  check(ticketMixto.debug[1].equipoOficial === 'Houston Texans' && ticketMixto.debug[1].resultado === 'GANADA',
    'La pata de NFL (texans) se resolvió sola contra la API de NFL, en el MISMO ticket que la de MLB');
  check(ticketMixto.debug[2].equipoOficial === 'Real Madrid' && ticketMixto.debug[2].resultado === 'GANADA',
    'La pata de fútbol (Real Madrid) se resolvió sola contra la API de fútbol (La Liga), en el MISMO ticket que las de MLB y NFL');
  check(ticketMixto.estado === 'GANADA', 'El ticket completo queda GANADA — las 3 patas de 3 deportes distintos se pagaron juntas, sin selector de deporte en ningún lado');
  check(r5.alertasNuevas === 0, 'Ninguna de las 3 patas generó alerta — no había ninguna ambigüedad ni dato faltante');

  // =================================================================
  // CASO "SIN LOGRO" END-TO-END (28-08-2026, a pedido explícito del
  // usuario): un ticket con una pata de "alta" SIN el valor de la línea ni
  // la cuota tiene que quedar NULA (FALTA LOGRO) completo (no solo esa
  // pata) y generar exactamente 1 alerta tipo SIN_LOGRO, sin candidatos
  // para elegir — y esa alerta se descarta (no se "resuelve") una vez que
  // el Grupo corrige el texto en la sábana.
  // =================================================================
  const GRUPO_ID_5 = 'grupo-prueba-5';
  const textoSinLogro = [
    '*CLIENTESL*',
    'Ticket 40',
    'alta astros',
    '100//90'
  ].join('\n');

  const r6 = await procesarSabana(GRUPO_ID_5, textoSinLogro, FECHA_PRUEBA);
  const ticketSinLogro = r6.tickets[0];
  check(ticketSinLogro.estado === 'NULA (FALTA LOGRO)',
    'SIN LOGRO end-to-end: "alta astros" sin línea ni cuota deja el ticket ENTERO en NULA (FALTA LOGRO)');
  check(r6.alertasNuevas === 1, 'SIN LOGRO end-to-end: genera exactamente 1 alerta nueva');
  const alertaSinLogro = TABLAS.alertas.find(a => a.tipo === 'SIN_LOGRO' && !a.resuelta);
  check(!!alertaSinLogro, 'SIN LOGRO end-to-end: la alerta nueva quedó guardada con tipo SIN_LOGRO');
  check(alertaSinLogro && Array.isArray(alertaSinLogro.candidatos) && alertaSinLogro.candidatos.length === 0,
    'SIN LOGRO end-to-end: la alerta SIN_LOGRO no trae candidatos (no hay ningún deporte que elegir, a diferencia de AMBIGUA_DEPORTE)');

  // --- Descartarla (como el botón "Descartar (ya corregí la sábana)") ---
  await descartarAlerta(alertaSinLogro.id);
  check(alertaSinLogro.resuelta === true, 'descartarAlerta() marca la alerta como resuelta');
  check(alertaSinLogro.deporte_resuelto === null,
    'descartarAlerta() NO guarda ningún deporte_resuelto (queda null) — no hay nada que recordar para la próxima vez, a diferencia de resolverAlerta()');
  check(TABLAS.resoluciones_ambiguas.length === 1,
    'descartarAlerta() no agrega ninguna fila nueva a "resoluciones_ambiguas" (sigue con la única de más arriba, del caso AMBIGUA_DEPORTE)');

  // =================================================================
  // CASO "DALLAS" — desambiguación entre NFL y NHL (28-08-2026, mismo
  // mecanismo ya probado con Houston/Miami entre MLB y NFL, ver bug #30):
  // "dallas" pelado apunta a 2 candidatos (Dallas Cowboys/nfl y Dallas
  // Stars/nhl, ver diccionarioEquipos.js), y los 2 tienen partido el MISMO
  // día en este fixture — el calendario solo no alcanza, hace falta el
  // marcador por-jugada ("nhl"/🏒) para desempatar.
  // =================================================================
  const GRUPO_ID_6 = 'grupo-prueba-6';
  const textoDallasNHL = [
    '*CLIENTEDALLAS*',
    'Ticket 50',
    'dallas nhl -150',
    '100//66'
  ].join('\n');

  const r7 = await procesarSabana(GRUPO_ID_6, textoDallasNHL, FECHA_PRUEBA);
  const ticketDallas = r7.tickets[0];
  check(ticketDallas.debug[0].equipoOficial === 'Dallas Stars',
    '"dallas nhl" se resuelve a Dallas Stars (NHL), no a Dallas Cowboys (NFL), gracias a la palabra "nhl" pegada a la jugada');
  check(ticketDallas.estado === 'GANADA', '"dallas nhl -150" gana con el marcador real de Dallas Stars (4-2, moneyline a favor)');
  check(r7.alertasNuevas === 0, '"dallas nhl" no genera ninguna alerta AMBIGUA — la palabra "nhl" alcanzó para resolverlo solo');

  // =================================================================
  // CASO "TEXAS" — identificador de deporte explícito que NO coincide con
  // lo mapeado (13-09-2026, bug real reportado por el usuario con un
  // ticket real: "Texas alta nfl 44.5 -110" quedaba resuelto contra
  // Texas Rangers/mlb sin ningún aviso, solo porque "texas" en el
  // diccionario únicamente existe como Texas Rangers — ver evaluador.js,
  // el chequeo `deporteMarcadorNoCoincide`). A diferencia de "dallas"/
  // "houston"/"miami" (ambiguos DE VERDAD, con 2+ candidatos reales), acá
  // "texas" solo tiene 1 candidato — antes de este arreglo el marcador
  // "nfl" ni se llegaba a mirar. Ahora genera una alerta de tipo
  // DEPORTE_NO_COINCIDE (a diferencia de un SIN_MAPEO común, que no
  // alerta solo) para que el Grupo/Súper-admin lo note y lo corrija.
  // =================================================================
  const GRUPO_ID_7 = 'grupo-prueba-7';
  const textoTexasNFLSinMarcadorManual = [
    '*CLIENTETEXAS*',
    'Ticket 60',
    'Texas alta nfl 44.5 -110',
    '100//90.91'
  ].join('\n');

  const r8 = await procesarSabana(GRUPO_ID_7, textoTexasNFLSinMarcadorManual, FECHA_PRUEBA);
  const ticketTexas = r8.tickets[0];
  check(ticketTexas.estado === 'PENDIENTE', 'BUG REAL: "Texas alta nfl 44.5" (identificador NFL explícito, pero "texas" solo es MLB) queda PENDIENTE — ya NO se evalúa a ciegas contra Texas Rangers');
  check(ticketTexas.debug[0].equipoOficial === null && ticketTexas.debug[0].deporteMarcadorNoCoincide === true,
    'el debug de la pata confirma que fue el mismatch de deporte, no un "no encontrado" común');
  check(r8.alertasNuevas === 1, 'genera exactamente 1 alerta nueva (a diferencia de un SIN_MAPEO común, que no alerta solo)');
  const alertaTexas = TABLAS.alertas.find(a => a.tipo === 'DEPORTE_NO_COINCIDE');
  check(!!alertaTexas, 'la alerta se guarda con tipo DEPORTE_NO_COINCIDE, distinto de AMBIGUA_DEPORTE/SIN_LOGRO');
  check(/NFL/.test(alertaTexas.mensaje) && /Texas Rangers/.test(alertaTexas.mensaje), 'el mensaje de la alerta explica el choque (pediste NFL, lo único mapeado es Texas Rangers)');

  // El marcador manual (✅/❌/⭕) SIGUE pudiendo resolver el ticket (mismo
  // mecanismo que cualquier otro SIN_MAPEO, ver procesarSabana.js) — la
  // alerta nueva es un AVISO agregado, no reemplaza esa vía de escape.
  const GRUPO_ID_8 = 'grupo-prueba-8';
  const textoTexasNFLConMarcadorManual = [
    '*CLIENTETEXAS2*',
    'Ticket 61',
    'Texas alta nfl 44.5 -110',
    '100//90.91❌'
  ].join('\n');
  const r9 = await procesarSabana(GRUPO_ID_8, textoTexasNFLConMarcadorManual, FECHA_PRUEBA);
  const ticketTexas2 = r9.tickets[0];
  check(ticketTexas2.estado === 'PERDIDA', 'con el marcador manual ❌ puesto a mano, el ticket SIGUE resolviéndose (PERDIDA), igual que cualquier otro SIN_MAPEO');
  check(ticketTexas2.resueltoPorMarcadorManualSinMapeo === true, 'se marca que se usó el marcador manual para resolverlo');
  check(r9.alertasNuevas === 1, 'la alerta se sigue generando igual (para que quede registrado el choque, aunque el marcador manual ya haya resuelto el ticket)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de integración de alertas se cayó con una excepción:', e);
  process.exit(1);
});
