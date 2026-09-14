// =================================================================
// PRUEBA: Balance General con el grupo en modelo de comisión
// 'por_tipo_jugada' (08-09-2026) — verifica que calcularBalanceGeneral()/
// calcularBalancePorDia() propagan correctamente configComision hasta
// calcularResumenHistorico() y calcularComisionTotalCliente(), y que la
// comisión ya viene descontada del "Balance de la banca" igual que en el
// modelo plano de siempre.
//
// Mismo patrón de base de datos falsa en memoria que
// test_balance_general.js. Escenario:
//   Día único 2026-09-01: ANA pierde una directa de 100 (1 logro,
//   comisión 2% = 2) y gana un parley de 2 patas de 200 que paga 150
//   (2 logros, comisión 3% = 6). Total comisión de ANA = 8.
//   totalBancaCliente(ANA) = perdido - ganado - comision = 100 - 150 - 8 = -58.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TIERS = [
  { logros: 1, porcentaje: 2 },
  { logros: 2, porcentaje: 3 }
];

const TABLAS = {
  tickets_historial: [
    { id: 't1', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'ANA', ticket_label: 'T1', detalle: 'x', arriesga: 100, gana: 0, estado: 'PERDIDA', logros: 1 },
    { id: 't2', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'ANA', ticket_label: 'T2', detalle: 'x', arriesga: 200, gana: 150, estado: 'GANADA', logros: 2 }
  ],
  polla_historial: [],
  transferencias: []
};

function enRango(fila, desde, hasta) {
  return (!desde || fila.fecha >= desde) && (!hasta || fila.fecha <= hasta);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ id: t.id, fecha: t.fecha, cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado, logros: t.logros })) };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) {
    return { rows: [] };
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

const { calcularBalanceGeneral, calcularBalancePorDia } = require(path.join(__dirname, '..', 'src', 'services', 'balanceGeneral'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const desde = '2026-09-01', hasta = '2026-09-01';
  const configComision = { modelo: 'por_tipo_jugada', tiers: TIERS };

  const resultado = await calcularBalanceGeneral('g1', desde, hasta, {}, {}, configComision);
  const filaAna = resultado.filas.find(f => f.cliente === 'ANA');
  check(!!filaAna, 'ANA aparece en Balance General aunque no tenga % propio configurado (modelo por tipo de jugada)');
  check(Math.abs(filaAna.comision - 8) < 0.01, 'ANA: comisión = 100*2% (directa perdida) + 200*3% (parley de 2 ganado) = 2 + 6 = 8');
  check(Math.abs(filaAna.saldoCliente - (-(100 - 150 - 8))) < 0.01, 'saldoCliente(ANA) = -(perdido - ganado - comision) = -(100-150-8) = 58');
  check(Math.abs(resultado.balanceBancaSabana - (100 - 150 - 8)) < 0.01, 'balanceBancaSabana = perdido - ganado - comision = 100-150-8 = -58 (la comisión tiered SÍ se descuenta de la banca, igual que en el modelo plano)');

  // Regresión: SIN configComision, la misma tabla de tickets con
  // porcentajesPropios reales da el resultado plano de siempre.
  const resultadoPlano = await calcularBalanceGeneral('g1', desde, hasta, { ANA: 5 }, {});
  const filaAnaPlano = resultadoPlano.filas.find(f => f.cliente === 'ANA');
  check(Math.abs(filaAnaPlano.comision - 300 * 0.05) < 0.01, 'sin configComision, ANA vuelve a usar su % plano de siempre: 5% de 300 comisionable (100 perdida + 200 ganada) = 15');

  // calcularBalancePorDia también propaga configComision.
  const porDia = await calcularBalancePorDia('g1', desde, hasta, {}, {}, configComision);
  check(porDia.length === 1 && Math.abs(porDia[0].balanceBanca - (-58)) < 0.01, 'calcularBalancePorDia con configComision da el mismo balanceBanca del día (-58)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Balance General por tipo de jugada se cayó con una excepción:', e);
  process.exit(1);
});
