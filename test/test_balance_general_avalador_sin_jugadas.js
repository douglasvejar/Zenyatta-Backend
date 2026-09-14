// =================================================================
// PRUEBA: un cliente que SOLO avala a otros (cobra % de las jugadas de
// un avalado) pero él mismo no jugó ni tiene Polla en el rango, ahora
// SÍ aparece en Balance General — con su comisión de avalado (bug #21
// del proyecto original, que ya estaba arreglado para el dashboard de
// la sábana del día pero nunca se había portado a balanceGeneral.js).
// =================================================================
// A pedido del usuario (03-09-2026): "manolo tiene % que se a ganado de
// sus clientes quiero que me muestres los clientes que tienen % así
// como me muestras los que juegan la polla ... para cuando yo sume
// aparte uno a uno los totales de cada cliente me dé exactamente el
// monto del balance general".
//
// También es la causa real de que el mismo día (02-09) diera un total
// distinto en el dashboard de la pestaña Sábana (-$977.35, que SÍ
// incluía la comisión de avalado de MANOLO) que en el desglose "por
// día" de Balance General (-$977.05 = 30 centavos... en este caso de
// prueba, $30 exactos, de diferencia): antes, calcularBalancePorDia()
// (que reusa calcularBalanceGeneral) sencillamente no armaba la fila de
// MANOLO, así que su comisión de avalado nunca se restaba de la banca.
//
// Escenario:
//   RICKY (avalado por MANOLO al 10%) pierde un ticket de $300 el
//   2026-09-01. MANOLO no juega nada ni tiene Polla ese rango — solo
//   cobra su 10% de avalado: $300 x 10% = $30.
//   Día 2026-09-02: RICKY no juega nada (para probar que MANOLO NO
//   aparece ese día puntual, porque ese día su comisión da $0).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  tickets_historial: [
    { id: 't1', grupo_id: 'g1', fecha: '2026-09-01', cliente_nombre: 'RICKY', ticket_label: 'T1', detalle: 'x', arriesga: 300, gana: 0, estado: 'PERDIDA' }
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
  const porcentajesPropios = {};
  const avalesMap = { MANOLO: { RICKY: 10 } };

  // --- 1) Rango completo: MANOLO aparece en las filas, aunque no jugó ni tiene Polla ---
  const resultado = await calcularBalanceGeneral('g1', '2026-09-01', '2026-09-02', porcentajesPropios, avalesMap);

  const filaManolo = resultado.filas.find(f => f.cliente === 'MANOLO');
  check(!!filaManolo, 'MANOLO aparece en filas de Balance General aunque no jugó ni tiene Polla en el rango (antes, faltaba)');
  check(filaManolo && Math.abs(filaManolo.comision - 30) < 0.001, 'MANOLO: comisión de avalado = $300 x 10% = $30');
  check(filaManolo && Math.abs(filaManolo.saldoCliente - 30) < 0.001, 'MANOLO: saldoCliente = +$30 (lo que gana por avalar a RICKY)');
  check(filaManolo && filaManolo.arriesgado === 0 && filaManolo.ganado === 0 && filaManolo.perdido === 0, 'MANOLO: arriesgado/ganado/perdido en $0 (no jugó él mismo)');

  const filaRicky = resultado.filas.find(f => f.cliente === 'RICKY');
  check(!!filaRicky, 'RICKY (quien sí jugó) sigue apareciendo con normalidad');
  check(Math.abs(filaRicky.saldoCliente - (-300)) < 0.001, 'RICKY: saldoCliente = -$300 (perdió el ticket completo)');

  // --- 2) El total YA incluye la comisión de MANOLO: antes se perdía por completo ---
  check(Math.abs(resultado.balanceBancaSabana - 270) < 0.001, 'balanceBancaSabana = 300 (perdido de RICKY) - 30 (comisión pagada a MANOLO) = 270 — antes daba 300, sin restar la comisión de MANOLO porque su fila ni se armaba');
  check(Math.abs(resultado.filaTotal.comision - 30) < 0.001, 'filaTotal.comision = 30 (la comisión de MANOLO ya suma en el total de la columna)');

  // --- 3) "Sumar uno a uno los clientes debe dar el total": ahora si cuadra ---
  const sumaManual = resultado.filas.reduce((acc, f) => acc + f.saldoCliente, 0);
  check(Math.abs(sumaManual - resultado.filaTotal.saldoCliente) < 0.001, 'sumar el saldoCliente de cada fila (incluida MANOLO) da exactamente filaTotal.saldoCliente');
  check(Math.abs(resultado.filaTotal.saldoCliente - (-resultado.balanceBanca)) < 0.001, 'filaTotal.saldoCliente = -balanceBanca, como siempre');

  // --- 4) Desglose por día: MANOLO aparece SOLO el día que le tocó comisión ---
  const porDia = await calcularBalancePorDia('g1', '2026-09-01', '2026-09-02', porcentajesPropios, avalesMap);
  const dia1 = porDia.find(d => d.fecha === '2026-09-01');
  const dia2 = porDia.find(d => d.fecha === '2026-09-02');
  check(dia1 && Math.abs(dia1.balanceBanca - 270) < 0.001, 'día 2026-09-01 (RICKY jugó): balanceBanca = 300 - 30 (comisión de MANOLO) = 270 — antes daba 300 igual que el rango completo, por el mismo bug');
  check(dia2 && Math.abs(dia2.balanceBanca - 0) < 0.001, 'día 2026-09-02 (RICKY no jugó): balanceBanca = 0 — MANOLO no gana comisión ese día puntual, así que no hace falta que aparezca (contribuye $0 de cualquier forma)');
  check(Math.abs((dia1.balanceBanca + dia2.balanceBanca) - resultado.balanceBanca) < 0.001, 'la suma de los 2 días del desglose cuadra exactamente con el balanceBanca del rango completo');

  // --- 5) Sin avales configurados, nada cambia (regresión) ---
  const sinAvales = await calcularBalanceGeneral('g1', '2026-09-01', '2026-09-02', {}, {});
  check(!sinAvales.filas.find(f => f.cliente === 'MANOLO'), 'regresión: sin avalesMap, MANOLO ni siquiera se evalúa (no aparece de la nada)');
  check(Math.abs(sinAvales.balanceBancaSabana - 300) < 0.001, 'regresión: sin avales, balanceBancaSabana = 300 (solo lo perdido por RICKY, sin ninguna comisión que restar)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
