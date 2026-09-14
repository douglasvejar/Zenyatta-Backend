// =================================================================
// PRUEBA: Polla integrada en la pestaña Sábana/Plano de WhatsApp +
// mayúsculas/minúsculas en el parser (02-09-2026, a pedido del usuario).
// =================================================================
// El usuario reportó 3 problemas relacionados, todos verificados acá con
// el orquestador COMPLETO (procesarSabana.js) contra una base de datos
// falsa en memoria (mismo patrón que test_alertas_integracion.js):
//   1. Si una fecha ya tenía Polla cargada, "Resumen por Cliente" y el
//      Plano de WhatsApp no la sumaban — corregido en procesarSabana.js
//      (nuevos campos "polla"/"jugoPolla" por cliente, "totalPolla"/
//      "totalBancaPolla" en los totales, "polla"/"bancaPolla" en
//      planoWhatsApp.totalesClientes).
//   2. Un cliente que SOLO juega Polla (sin ningún ticket de sábana ese
//      día) no aparecía para nada en "Resumen por Cliente" — ahora
//      aparece con jugoHoy:false, jugoPolla:true.
//   3. Un nombre de cliente escrito en minúscula en la sábana no se
//      reconocía como encabezado ("esTextoCliente" en parser.js no tenía
//      el flag "i") — sus jugadas quedaban mal atribuidas a "GENERAL" (o
//      al cliente anterior). Corregido agregando el flag "i".
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  jugadores: [
    { id: 'j-pedro', grupo_id: 'g1', nombre: 'PEDRO', activo: true, comision_propia: 0 },
    { id: 'j-solopolla', grupo_id: 'g1', nombre: 'SOLOPOLLA', activo: true, comision_propia: 0 }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  polla_historial: [
    { id: 'p1', grupo_id: 'g1', fecha: '2026-09-02', cliente_nombre: 'PEDRO', monto: -50 },
    { id: 'p2', grupo_id: 'g1', fecha: '2026-09-02', cliente_nombre: 'SOLOPOLLA', monto: 120 }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  // (04-09-2026) registrosSinCambios() en historial.js — esta prueba no
  // trackea el contenido real de tickets_historial, así que "sin filas
  // guardadas todavía" es siempre la respuesta correcta acá.
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    const grupoId = params[0];
    const desde = params[1], hasta = params[2];
    const filas = TABLAS.polla_historial.filter(r => r.grupo_id === grupoId && r.fecha >= desde && r.fecha <= hasta);
    // El SQL real le pone alias "AS cliente" a cliente_nombre — se imita
    // ese renombrado (si no, leerPolla() recibiría "cliente: undefined").
    return { rows: filas.map(f => ({ id: f.id, fecha: f.fecha, cliente: f.cliente_nombre, monto: f.monto, nota: f.nota || null })) };
  }
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

const FECHA_PRUEBA = '2026-09-02';
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: 'Houston Astros' }, score: 5 },
              away: { team: { name: 'Texas Rangers' }, score: 1 }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
            gamePk: 1
          }]
        }]
      })
    });
  }
  if (url.includes('/football/nfl/') || url.includes('/hockey/nhl/') || url.includes('/basketball/nba/') || url.includes('/soccer/')) {
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
const { parsearSabana } = require(path.join(__dirname, '..', 'src', 'services', 'parser'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) Parser: mayúscula/minúscula/mixto dan el MISMO resultado ---
  const dic = {};
  const boletosMin = parsearSabana(['pedro', 'houston -120', '100//90'].join('\n'), dic);
  const boletosMay = parsearSabana(['PEDRO', 'houston -120', '100//90'].join('\n'), dic);
  const boletosMix = parsearSabana(['Pedro', 'houston -120', '100//90'].join('\n'), dic);
  check(boletosMin.length === 1 && boletosMin[0].cliente === 'PEDRO', 'parsearSabana(): nombre de cliente en minúscula ("pedro") se reconoce igual que en mayúscula');
  check(boletosMay.length === 1 && boletosMay[0].cliente === 'PEDRO', 'parsearSabana(): nombre de cliente en mayúscula sigue funcionando (regresión)');
  check(boletosMix.length === 1 && boletosMix[0].cliente === 'PEDRO', 'parsearSabana(): nombre de cliente mixto ("Pedro") también se reconoce');

  // Sin el arreglo, este mismo texto en minúscula hubiera dejado la
  // jugada de PEDRO pegada a "GENERAL" en vez de a su propio cliente.
  const boletosDosClientesMinuscula = parsearSabana(
    ['pedro', 'houston -120', '100//90', '', 'solopolla', 'miami -110', '50//45'].join('\n'),
    dic
  );
  check(
    boletosDosClientesMinuscula.length === 2 &&
    boletosDosClientesMinuscula[0].cliente === 'PEDRO' &&
    boletosDosClientesMinuscula[1].cliente === 'SOLOPOLLA',
    'parsearSabana(): 2 clientes distintos, ambos en minúscula, se separan bien (no se pegan a GENERAL)'
  );

  // --- 2) procesarSabana(): PEDRO jugó sábana Y tiene Polla ese día ---
  const texto = ['PEDRO', 'houston -120', '100//90'].join('\n');
  const resp = await procesarSabana('g1', texto, FECHA_PRUEBA);

  const filaPedro = resp.resumenPorCliente.find(c => c.cliente === 'PEDRO');
  check(!!filaPedro, 'resumenPorCliente incluye a PEDRO (jugó sábana)');
  check(filaPedro.jugoHoy === true, 'PEDRO: jugoHoy = true (tiene ticket de sábana)');
  check(filaPedro.jugoPolla === true, 'PEDRO: jugoPolla = true (tiene Polla cargada este día)');
  check(filaPedro.polla === -50, 'PEDRO: polla = -50 (el monto exacto cargado)');

  const filaSolo = resp.resumenPorCliente.find(c => c.cliente === 'SOLOPOLLA');
  check(!!filaSolo, 'resumenPorCliente incluye a SOLOPOLLA aunque NO tenga ningún ticket de sábana ese día — antes no aparecía para nada');
  check(filaSolo.jugoHoy === false, 'SOLOPOLLA: jugoHoy = false (no jugó sábana)');
  check(filaSolo.jugoPolla === true, 'SOLOPOLLA: jugoPolla = true');
  check(filaSolo.polla === 120, 'SOLOPOLLA: polla = 120');
  check(filaSolo.arriesgado === 0 && filaSolo.balance === 0, 'SOLOPOLLA: sus campos de sábana quedan en 0 (nunca null/undefined)');

  // --- 3) Totales del dashboard incluyen Polla, como ítem APARTE ---
  check(resp.totales.totalPolla === (-50 + 120), 'totales.totalPolla = suma neta de Polla del día (-50 + 120 = 70)');
  check(resp.totales.totalBancaPolla === -(-50 + 120), 'totales.totalBancaPolla = negación de totalPolla (misma convención que balanceGeneral.js)');
  check(typeof resp.totales.totalBalanceCasaSabana === 'number', 'totales.totalBalanceCasaSabana (desglose solo sábana) existe');

  // "Balance Neto Casa" con Polla combinada (03-09-2026, a pedido del
  // usuario — revierte el criterio anterior de "nunca mezclar"): el
  // resultado de la Polla de este día SÍ tiene que sumarse/restarse al
  // balance neto de la casa.
  check(
    Math.abs(resp.totales.totalBalanceCasa - (resp.totales.totalBalanceCasaSabana + resp.totales.totalBancaPolla)) < 0.001,
    'totales.totalBalanceCasa = totalBalanceCasaSabana + totalBancaPolla (la Polla del día SÍ influye en el balance neto)'
  );
  check(resp.totales.pollaRegistrada === true, 'totales.pollaRegistrada = true (esta fecha tiene filas de Polla cargadas)');

  // --- 4) Plano de WhatsApp: totalesClientes trae polla/bancaPolla, y el total general también ---
  const planoP = resp.planoWhatsApp.totalesClientes.find(c => c.cliente === 'PEDRO');
  check(planoP.polla === -50 && planoP.bancaPolla === 50, 'planoWhatsApp.totalesClientes: PEDRO trae polla=-50 y bancaPolla=+50');
  const planoSolo = resp.planoWhatsApp.totalesClientes.find(c => c.cliente === 'SOLOPOLLA');
  check(!!planoSolo && planoSolo.polla === 120, 'planoWhatsApp.totalesClientes: SOLOPOLLA aparece con su polla aunque no jugó sábana');
  check(resp.planoWhatsApp.totalBancaPolla === -(-50 + 120), 'planoWhatsApp.totalBancaPolla = mismo total que totales.totalBancaPolla');
  check(
    Math.abs(resp.planoWhatsApp.totalBanca - (resp.planoWhatsApp.totalBancaSabana + resp.planoWhatsApp.totalBancaPolla)) < 0.001,
    'planoWhatsApp.totalBanca ("TOTAL BANCA" del plano) = totalBancaSabana + totalBancaPolla, ya combinado'
  );
  check(resp.planoWhatsApp.pollaRegistrada === true, 'planoWhatsApp.pollaRegistrada = true');

  // --- 5) Un día SIN Polla registrada: nada de esto debe aparecer ---
  const FECHA_SIN_POLLA = '2026-09-03';
  const respSinPolla = await procesarSabana('g1', texto, FECHA_SIN_POLLA);
  check(respSinPolla.totales.pollaRegistrada === false, 'Sin filas de Polla para esta fecha: totales.pollaRegistrada = false');
  check(respSinPolla.totales.totalPolla === 0 && respSinPolla.totales.totalBancaPolla === 0, 'Sin Polla ese día: totalPolla y totalBancaPolla dan 0');
  check(
    Math.abs(respSinPolla.totales.totalBalanceCasa - respSinPolla.totales.totalBalanceCasaSabana) < 0.001,
    'Sin Polla ese día: totalBalanceCasa queda igual al de sábana sola (no hay nada que sumar)'
  );
  check(respSinPolla.planoWhatsApp.pollaRegistrada === false, 'Sin Polla ese día: planoWhatsApp.pollaRegistrada = false');
  const filaSoloSinPolla = respSinPolla.resumenPorCliente.find(c => c.cliente === 'SOLOPOLLA');
  check(!filaSoloSinPolla, 'Sin Polla ese día: SOLOPOLLA (que solo juega Polla) ni siquiera aparece en resumenPorCliente');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
