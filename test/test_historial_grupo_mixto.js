// =================================================================
// PRUEBA: "grupo mixto" en la RECONSTRUCCIÓN histórica (09-09-2026, a
// pedido del usuario — ver la nota grande en comisiones.js y en
// historial.js, calcularComisionesDetalladas). Complementa
// test_historial_comision_por_tipo.js (que cubre el modelo default
// 'por_tipo_jugada' del grupo entero) con el caso nuevo: un grupo cuyo
// modelo DEFAULT es 'plano', pero que tiene UN cliente con la excepción
// individual 'por_tipo_jugada' cargada (jugadores.modelo_comision).
//
// Cubre puntualmente el bug que se corrigió en calcularComisionesDetalladas
// (variable hayExcepcionesPorTipo): antes, un cliente sin % propio
// configurado (normal si su única fuente de comisión es la excepción por
// tipo de jugada) NUNCA entraba a "todosClientes" cuando el modelo
// DEFAULT del grupo era 'plano' -- su comisión reconstruida se perdía por
// completo del desglose de % Devueltos, aunque calcularResumenHistorico()
// sí la calculara bien (por eso hacía falta esta prueba aparte, para no
// quedarse solo con la de calcularResumenHistorico).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g-historial-mixto';
const TIERS = [
  { logros: 1, porcentaje: 2 },
  { logros: 2, porcentaje: 3 },
  { logros: 3, porcentaje: 5 }
];

const TABLAS = {
  tickets_historial: [
    // ANA tiene la excepción individual 'por_tipo_jugada' -- NO tiene %
    // propio configurado (porcentajesPropios vendrá sin ella).
    { id: 't1', grupo_id: GRUPO_ID, fecha: '2026-09-01', cliente_nombre: 'ANA', ticket_label: 'T1', detalle: 'x', arriesga: 100, gana: 66.67, estado: 'GANADA', logros: 1 },
    { id: 't2', grupo_id: GRUPO_ID, fecha: '2026-09-01', cliente_nombre: 'ANA', ticket_label: 'T2', detalle: 'x', arriesga: 200, gana: 150, estado: 'GANADA', logros: 2 },
    // LUIS sigue el modelo default del grupo ('plano'), con su % propio.
    { id: 't3', grupo_id: GRUPO_ID, fecha: '2026-09-01', cliente_nombre: 'LUIS', ticket_label: 'T3', detalle: 'x', arriesga: 400, gana: 0, estado: 'PERDIDA', logros: 1 }
  ]
};

function enRango(fila, desde, hasta) {
  return (!desde || fila.fecha >= desde) && (!hasta || fila.fecha <= hasta);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros\s+FROM tickets_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return {
      rows: filas.map(t => ({
        id: t.id, fecha: t.fecha, cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle,
        arriesga: t.arriesga, gana: t.gana, estado: t.estado, logros: t.logros
      }))
    };
  }
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';

const { calcularComisionesDetalladas } = require(path.join(__dirname, '..', 'src', 'services', 'historial'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const desde = '2026-09-01', hasta = '2026-09-01';
  // Grupo DEFAULT 'plano'. Solo LUIS tiene % propio configurado (5) --
  // ANA no tiene NINGUNO, porque su única fuente de comisión es su
  // excepción individual 'por_tipo_jugada'.
  const porcentajesPropios = { LUIS: 5 };
  const avalesMap = {};
  const configComision = { modelo: 'plano', tiers: TIERS, modelosPorCliente: { ANA: 'por_tipo_jugada' } };

  const detalles = await calcularComisionesDetalladas(GRUPO_ID, desde, hasta, porcentajesPropios, avalesMap, configComision);

  check(!!detalles.ANA, 'ANA aparece en el desglose de % Devueltos aunque no tenga % propio configurado (antes del fix, se perdía por completo)');
  check(Math.abs(detalles.ANA.total - 8) < 0.01, 'el total de ANA usa los tiers del grupo: 100*2% + 200*3% = 2+6 = 8, vía su excepción individual');
  check(!!detalles.LUIS, 'LUIS (sin excepción) sigue apareciendo, siguiendo el modelo default del grupo');
  check(Math.abs(detalles.LUIS.total - 20) < 0.01, 'el total de LUIS = 400*5% = 20 (plano, el default del grupo)');

  // --- Regresión: sin ninguna excepción cargada, comportamiento idéntico a como era antes del "grupo mixto" ---
  const detallesSinExcepciones = await calcularComisionesDetalladas(GRUPO_ID, desde, hasta, { LUIS: 5 }, {}, { modelo: 'plano', tiers: TIERS, modelosPorCliente: {} });
  check(!detallesSinExcepciones.ANA, 'sin ninguna excepción individual cargada, ANA (sin % propio) NO aparece en el desglose -- comportamiento de siempre para grupos 100% planos');
  check(!!detallesSinExcepciones.LUIS && Math.abs(detallesSinExcepciones.LUIS.total - 20) < 0.01, 'LUIS sigue apareciendo con su total plano de siempre');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
