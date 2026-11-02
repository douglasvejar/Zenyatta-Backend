// =================================================================
// PRUEBA: el TOTAL BANCA del plano de WhatsApp es EXACTAMENTE la suma de las líneas que se imprimen (02-11-2026).
// El usuario vio una línea de totales que sumaba 61,77 con TOTAL BANCA en 61,78: cada línea se redondeaba al imprimir pero el total
// sumaba los montos crudos (un % de 4,125, un premio de 74,095). Ahora cada monto se redondea a centavos ANTES de sumar.
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
    { id: 'j-a', grupo_id: 'g1', nombre: 'ANA', activo: true, comision_propia: 2.5 },
    { id: 'j-b', grupo_id: 'g1', nombre: 'BETO', activo: true, comision_propia: 2.5 },
    { id: 'j-c', grupo_id: 'g1', nombre: 'CARLOS', activo: true, comision_propia: 0 },
    { id: 'j-d', grupo_id: 'g1', nombre: 'DANI', activo: true, comision_propia: 2.5 }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  polla_historial: []
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
  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
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

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // Cada cliente juega algo que deja centavos "difíciles" (un % de 4,125; un premio de 74,095...). Houston gana (5-1).
  const texto = [
    'ANA', 'houston -120', '165//137.5', '',
    'BETO', 'houston -120', '33//74.095', '',
    'CARLOS', 'houston -120', '10//10', '',
    'CARLOS', 'texas -110', '60//60', '',
    'DANI', 'houston -120', '37//30.835'
  ].join('\n');
  const resp = await procesarSabana('g1', texto, FECHA_PRUEBA);
  const tc = resp.planoWhatsApp.totalesClientes;
  check(tc.length >= 3, 'el plano trae los clientes del día (' + tc.length + ')');

  const cent = n => Math.round(Math.abs(n) * 100 + 1e-6) * (n < 0 ? -1 : 1);
  const esCentavos = n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7;

  // Lo que se IMPRIME en el plano (misma cuenta de app.js / planoWhatsAppTexto.js): línea de cada cliente + línea "% cliente".
  let sumaLineas = 0;
  tc.forEach(c => {
    const resultado = -c.totalBanca - c.devolucion + (c.polla || 0);
    if (c.jugoHoy || c.jugoPolla) sumaLineas += cent(resultado);
    if (Math.abs(c.devolucion) > 0.001) sumaLineas += cent(c.devolucion);
    check(esCentavos(c.totalBanca) && esCentavos(c.devolucion), c.cliente + ': totalBanca y % ya vienen en centavos exactos (' + c.totalBanca + ' / ' + c.devolucion + ')');
  });
  // TOTAL BANCA = menos la suma de todas las líneas que se ven (los % que se le devuelven al cliente le restan a la banca)
  const totalBancaCent = cent(resp.planoWhatsApp.totalBanca);
  check(totalBancaCent === -sumaLineas, 'TOTAL BANCA (' + resp.planoWhatsApp.totalBanca + ') es EXACTAMENTE la suma de las líneas del plano (' + (-sumaLineas / 100) + ')');
  check(esCentavos(resp.planoWhatsApp.totalBanca) && esCentavos(resp.totales.totalBalanceCasa), 'TOTAL BANCA y Balance Neto Casa salen en centavos exactos');
  check(Math.abs(resp.totales.totalBalanceCasa - resp.planoWhatsApp.totalBanca) < 1e-9, 'la tarjeta Balance Neto Casa y el TOTAL BANCA del plano son el mismo número');
  const t = resp.totales;
  check(cent(t.totalBalanceCasa) === cent(t.totalPerdido) - cent(t.totalPremios) - cent(t.totalDevoluciones), 'perdido - premios - devoluciones de las tarjetas da el balance (sin centavo de diferencia)');
  resp.resumenPorCliente.forEach(c => check(esCentavos(c.ganado) && esCentavos(c.perdido) && esCentavos(c.comisionTotal) && esCentavos(c.balance), c.cliente + ': ganado/perdido/% /balance en centavos'));

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('ERROR INESPERADO:', e);
  process.exit(1);
});
