// =================================================================
// PRUEBA: reconstrucción histórica del modelo de comisión
// 'por_tipo_jugada' (08-09-2026) — a diferencia de
// test_procesar_sabana_comision_por_tipo.js (que procesa la sábana del
// día en vivo), esta prueba parte de tickets YA GUARDADOS en
// tickets_historial (con su columna "logros" ya persistida) y verifica
// que historial.js los reconstruye bien sobre un RANGO de fechas — que
// es lo que usan Balance General y % Devueltos, sin volver a tocar la
// sábana original.
//
// Cubre además el caso de tickets viejos, guardados ANTES de que la
// columna "logros" existiera (logros: null en la base) — se tienen que
// tratar como "0 logros" (ningún tier calza) en vez de reventar o
// adivinar, tal como está documentado en comisiones.js.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g-historial-tipo';
const TIERS = [
  { logros: 1, porcentaje: 2 },
  { logros: 2, porcentaje: 3 },
  { logros: 3, porcentaje: 5 }
];

const TABLAS = {
  tickets_historial: [
    // ANA, día 1: directa (100, GANADA, 1 logro) + parley 2 (200, GANADA, 2 logros)
    { id: 't1', grupo_id: GRUPO_ID, fecha: '2026-09-01', cliente_nombre: 'ANA', ticket_label: 'T1', detalle: 'x', arriesga: 100, gana: 66.67, estado: 'GANADA', logros: 1 },
    { id: 't2', grupo_id: GRUPO_ID, fecha: '2026-09-01', cliente_nombre: 'ANA', ticket_label: 'T2', detalle: 'x', arriesga: 200, gana: 150, estado: 'GANADA', logros: 2 },
    // ANA, día 2: parley de 3 (50, PERDIDA, 3 logros) -- PERDIDA también comisiona
    { id: 't3', grupo_id: GRUPO_ID, fecha: '2026-09-02', cliente_nombre: 'ANA', ticket_label: 'T3', detalle: 'x', arriesga: 50, gana: 0, estado: 'PERDIDA', logros: 3 },
    // ANA, día 2: un ticket ANULADA (push) -- NO debe comisionar nada, sin importar sus logros
    { id: 't4', grupo_id: GRUPO_ID, fecha: '2026-09-02', cliente_nombre: 'ANA', ticket_label: 'T4', detalle: 'x', arriesga: 999, gana: 999, estado: 'ANULADA', logros: 3 },
    // LUIS, día 1: ticket VIEJO, guardado antes de que existiera la columna
    // "logros" -- llega como null desde la base (simulado con undefined
    // acá, para no confundir "0 real" con "nunca se guardó").
    { id: 't5', grupo_id: GRUPO_ID, fecha: '2026-09-01', cliente_nombre: 'LUIS', ticket_label: 'T5', detalle: 'x', arriesga: 500, gana: 400, estado: 'GANADA', logros: null }
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

const { calcularResumenHistorico, calcularComisionesDetalladas } = require(path.join(__dirname, '..', 'src', 'services', 'historial'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const desde = '2026-09-01', hasta = '2026-09-02';

  // --- 1) calcularResumenHistorico(): SIN modeloComision -> comportamiento de siempre ---
  const resumenPlano = await calcularResumenHistorico(GRUPO_ID, desde, hasta);
  check(resumenPlano.ANA.arriesgadoComisionable === 350, 'sin modeloComision (comportamiento de siempre): arriesgadoComisionable de ANA = 100+200+50 = 350 (la ANULADA de 999 no cuenta)');
  // (09-09-2026, "grupo mixto") acumularComisionPorTipoJugada() ahora se
  // llama SIEMPRE, sin importar `modeloComision` -- necesario para que un
  // cliente con la excepción individual 'por_tipo_jugada' tenga
  // comisionPorTipoAcumulada disponible aunque el grupo DEFAULT esté en
  // 'plano' (ver la nota grande en comisiones.js/historial.js). Sin
  // `tiers` (5to parámetro omitido acá), porcentajePorTipoJugada() siempre
  // da 0%, así que el campo queda en 0 -- inofensivo para un grupo 100%
  // plano, ya no queda "sin calcular" (undefined) como antes de este fix.
  check(resumenPlano.ANA.comisionPorTipoAcumulada === 0, 'sin modeloComision/tiers, comisionPorTipoAcumulada se acumula igual mas siempre da 0% -> 0 (inofensivo, ya no queda undefined)');

  // --- 2) calcularResumenHistorico() CON modelo 'por_tipo_jugada' ---
  const resumenPorTipo = await calcularResumenHistorico(GRUPO_ID, desde, hasta, 'por_tipo_jugada', TIERS);
  check(
    Math.abs(resumenPorTipo.ANA.comisionPorTipoAcumulada - 10.5) < 0.01,
    'ANA: comisionPorTipoAcumulada reconstruida del histórico = 100*2% + 200*3% + 50*5% = 2+6+2.5 = 10.5 (' + resumenPorTipo.ANA.comisionPorTipoAcumulada + '), IGNORANDO la ANULADA de 999'
  );
  check(
    Math.abs(resumenPorTipo.LUIS.comisionPorTipoAcumulada - 0) < 0.01,
    'LUIS: su único ticket tiene logros: null (guardado antes de que existiera la columna) -> se trata como 0 logros -> no matchea ningún tier -> comisión 0, no revienta'
  );

  // --- 3) calcularComisionesDetalladas() con modelo 'por_tipo_jugada', desglosado por fecha ---
  const porcentajesPropios = {}; // a propósito vacío: en este modelo se ignora
  const avalesMap = {};
  const detalles = await calcularComisionesDetalladas(GRUPO_ID, desde, hasta, porcentajesPropios, avalesMap, { modelo: 'por_tipo_jugada', tiers: TIERS });
  check(!!detalles.ANA, 'calcularComisionesDetalladas incluye a ANA aunque no tenga % propio configurado (el modelo por tipo de jugada no depende de porcentajesPropios)');
  check(Math.abs(detalles.ANA.total - 10.5) < 0.01, 'el total de ANA en el desglose también da 10.5, igual que calcularResumenHistorico');
  const dia1 = detalles.ANA.detalle.find(d => d.fecha === '2026-09-01');
  const dia2 = detalles.ANA.detalle.find(d => d.fecha === '2026-09-02');
  check(!!dia1 && Math.abs(dia1.comisionPropia - 8) < 0.01, 'día 2026-09-01 de ANA: comisión = 100*2% + 200*3% = 2+6 = 8');
  check(!!dia2 && Math.abs(dia2.comisionPropia - 2.5) < 0.01, 'día 2026-09-02 de ANA: comisión = 50*5% = 2.5 (la ANULADA de ese mismo día no suma nada)');

  // --- 4) Regresión: calcularComisionesDetalladas() sin configComision sigue igual que siempre ---
  const detallesPlano = await calcularComisionesDetalladas(GRUPO_ID, desde, hasta, { ANA: 5 }, {});
  const anaPlano = detallesPlano.ANA;
  check(!!anaPlano && Math.abs(anaPlano.total - 350 * 0.05) < 0.01, 'sin configComision, calcularComisionesDetalladas sigue usando el % plano de siempre (5% de 350 comisionable = 17.5)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
