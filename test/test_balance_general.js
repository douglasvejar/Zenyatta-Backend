// =================================================================
// PRUEBA: Balance General — "Banca Polla" combinada en "Balance de la
// banca", fila TOTAL, y desglose por día (03-09-2026, a pedido del
// usuario: "me estás dejando el resultado polla aparte... para que el
// resultado de la polla se vea reflejado e influya en el total del
// saldo del grupo", más "arriba donde dice balance quiero ver una
// tabla donde se vea el saldo del grupo por día").
//
// Base de datos falsa en memoria (mismo patrón que
// test_sabana_polla_y_mayusculas.js), con un escenario armado a mano
// para poder verificar los números exactos:
//
//   Día 2026-09-01: A pierde un ticket de 100 (banca +100); B gana un
//     ticket de 50 que paga 45 (banca -45). Sin Polla ese día.
//     -> balanceBanca del día 1 = 100 - 45 = 55.
//
//   Día 2026-09-02: A gana un ticket de 80 que paga 72 (banca -72); B
//     pierde un ticket de 60 (banca +60). Polla: A -30 (banca +30), B
//     +10 (banca -10). Transferencia de 10 de A a B (no debería mover
//     la banca, solo redistribuir entre clientes).
//     -> balanceBanca del día 2 = (-72 + 60) + (30 - 10) = -12 + 20 = 8.
//
//   Rango completo (ambos días): balanceBanca = 55 + 8 = 63.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  tickets_historial: [
    { id: 't1', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'A', ticket_label: 'T1', detalle: 'x', arriesga: 100, gana: 0, estado: 'PERDIDA' },
    { id: 't2', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'B', ticket_label: 'T2', detalle: 'x', arriesga: 50, gana: 45, estado: 'GANADA' },
    { id: 't3', grupo_id: 'g1', fecha: '2026-09-02', cliente_nombre: 'A', ticket_label: 'T3', detalle: 'x', arriesga: 80, gana: 72, estado: 'GANADA' },
    { id: 't4', grupo_id: 'g1', fecha: '2026-09-02', cliente_nombre: 'B', ticket_label: 'T4', detalle: 'x', arriesga: 60, gana: 0, estado: 'PERDIDA' }
  ],
  polla_historial: [
    { id: 'p1', grupo_id: 'g1', fecha: '2026-09-02', cliente_nombre: 'A', monto: -30 },
    { id: 'p2', grupo_id: 'g1', fecha: '2026-09-02', cliente_nombre: 'B', monto: 10 }
  ],
  transferencias: [
    { id: 'tr1', grupo_id: 'g1', fecha: '2026-09-02', cliente_origen: 'A', cliente_destino: 'B', monto: 10 }
  ]
};

function enRango(fila, desde, hasta) {
  return (!desde || fila.fecha >= desde) && (!hasta || fila.fecha <= hasta);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ id: t.id, fecha: t.fecha, cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado })) };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.polla_historial.filter(p => p.grupo_id === grupoId && enRango(p, desde, hasta));
    return { rows: filas.map(p => ({ id: p.id, fecha: p.fecha, cliente: p.cliente_nombre, monto: p.monto, nota: null })) };
  }
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.transferencias.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ cliente_origen: t.cliente_origen, cliente_destino: t.cliente_destino, monto: t.monto })) };
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
  const desde = '2026-09-01', hasta = '2026-09-02';
  const resultado = await calcularBalanceGeneral('g1', desde, hasta, {}, {});

  // --- 1) "Balance de la banca" combinado (sábana + polla) ---
  check(resultado.balanceBancaSabana === 43, 'balanceBancaSabana (solo tickets) = 100 - 45 - 72 + 60 = 43');
  check(resultado.balanceBancaPolla === 20, 'balanceBancaPolla = 30 - 10 = 20');
  check(resultado.balanceBanca === 63, 'balanceBanca (combinado) = 43 + 20 = 63 — ANTES excluía la Polla y quedaba en 43');

  // --- 2) filas por cliente (sin cambios de fórmula, solo verificando) ---
  const filaA = resultado.filas.find(f => f.cliente === 'A');
  const filaB = resultado.filas.find(f => f.cliente === 'B');
  check(filaA.saldoCliente === -68, 'saldoCliente(A) = -(100-72) - 10(transferencia enviada) - 30(polla) = -68');
  check(filaB.saldoCliente === 5, 'saldoCliente(B) = -(60-45) + 10(transferencia recibida) + 10(polla) = 5');

  // --- 3) filaTotal: la Polla ya sumada en un solo renglón de TOTAL ---
  check(!!resultado.filaTotal, 'la respuesta incluye filaTotal');
  check(resultado.filaTotal.saldoCliente === -63, 'filaTotal.saldoCliente = -68 + 5 = -63 = -(balanceBanca combinado)');
  check(resultado.filaTotal.polla === -20, 'filaTotal.polla = -30 + 10 = -20 (coincide con -balanceBancaPolla)');
  check(resultado.filaTotal.transferencias === 0, 'filaTotal.transferencias = -10 + 10 = 0 (las transferencias no mueven el total del grupo, solo lo redistribuyen)');
  check(resultado.filaTotal.arriesgado === 290, 'filaTotal.arriesgado = (100+80) + (50+60) = 290');

  // --- 4) Desglose por día: cada día suma exactamente el total del rango ---
  const porDia = await calcularBalancePorDia('g1', desde, hasta, {}, {});
  check(porDia.length === 2, 'calcularBalancePorDia() devuelve un renglón por cada uno de los 2 días del rango');
  const dia1 = porDia.find(d => d.fecha === '2026-09-01');
  const dia2 = porDia.find(d => d.fecha === '2026-09-02');
  check(dia1 && dia1.balanceBanca === 55, 'día 2026-09-01: balanceBanca = 100 - 45 = 55 (sin Polla ese día)');
  check(dia2 && dia2.balanceBanca === 8, 'día 2026-09-02: balanceBanca = (-72+60) + (30-10) = 8');
  check(dia1.balanceBanca + dia2.balanceBanca === resultado.balanceBanca, 'la suma de los días del desglose cuadra exactamente con balanceBanca del rango completo');

  // --- 5) Rango vacío/sin fechas -> no revienta, devuelve arreglo vacío ---
  const porDiaSinFechas = await calcularBalancePorDia('g1', null, null, {}, {});
  check(Array.isArray(porDiaSinFechas) && porDiaSinFechas.length === 0, 'calcularBalancePorDia() sin desde/hasta devuelve un arreglo vacío en vez de reventar');

  // --- 6) Rango largo (más de 31 días) -> se omite el desglose, no dispara 90+ consultas ---
  const porDiaRangoLargo = await calcularBalancePorDia('g1', '2026-01-01', '2026-12-31', {}, {});
  check(Array.isArray(porDiaRangoLargo) && porDiaRangoLargo.length === 0, 'calcularBalancePorDia() con un rango de casi un año devuelve vacío (el frontend simplemente no muestra la tabla) en vez de disparar cientos de consultas');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Balance General se cayó con una excepción:', e);
  process.exit(1);
});
