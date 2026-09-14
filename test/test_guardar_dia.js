// =================================================================
// PRUEBA: "Guardar Día" (31-08-2026, a pedido del usuario) — confirmarDia
// / desconfirmarDia / estadoDia / fechasConfirmadas (src/services/historial.js)
// =================================================================
// Mismo patrón de base de datos falsa en memoria que test_alertas_integracion.js
// y test_wiring.js (reemplaza "pg" vía Module._load), pero acá se prueba
// historial.js directo (sin pasar por procesarSabana.js) para poder
// controlar los registros a mano. Cubre:
//   1. Una fecha recién procesada (guardarEnHistorial) queda SIN confirmar.
//   2. confirmarDia() la marca como confirmada (estadoDia lo refleja).
//   3. Volver a llamar guardarEnHistorial() sobre la MISMA fecha (como
//      pasaría al reprocesar la sábana) la deja SIN confirmar de nuevo,
//      automáticamente — sin que nadie llame a desconfirmarDia() a mano.
//   4. confirmarDia() es upsert: confirmar 2 veces seguidas no rompe nada.
//   5. fechasConfirmadas() (usado por el historial por cliente) devuelve
//      justo el subconjunto de fechas que están confirmadas.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

// --- Base de datos falsa en memoria ---
const TABLAS = { tickets_historial: [], dias_confirmados: [] };

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  if (/^DELETE FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.tickets_historial = TABLAS.tickets_historial.filter(r => !(r.grupo_id === grupoId && r.fecha === fecha));
    return { rows: [] };
  }
  if (/^INSERT INTO tickets_historial/i.test(sql)) {
    const [grupoId, fecha, cliente, jugadorId, ticket, detalle, arriesga, gana, estado] = params;
    TABLAS.tickets_historial.push({ grupo_id: grupoId, fecha, cliente_nombre: cliente, jugador_id: jugadorId, ticket_label: ticket, detalle, arriesga, gana, estado });
    return { rows: [] };
  }
  // (04-09-2026) registrosSinCambios() en historial.js — el paso previo a
  // guardar: compara lo nuevo contra lo YA guardado para esa fecha, para
  // no desconfirmar el día si el reproceso da EXACTAMENTE lo mismo.
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.tickets_historial.filter(r => r.grupo_id === grupoId && r.fecha === fecha);
    return { rows: filas.map(r => ({ cliente: r.cliente_nombre, ticket: r.ticket_label, detalle: r.detalle, arriesga: r.arriesga, gana: r.gana, estado: r.estado })) };
  }

  if (/^INSERT INTO dias_confirmados/i.test(sql)) {
    const [grupoId, fecha] = params;
    let existente = TABLAS.dias_confirmados.find(d => d.grupo_id === grupoId && d.fecha === fecha);
    const ahora = new Date().toISOString();
    if (existente) existente.confirmado_en = ahora;
    else { existente = { grupo_id: grupoId, fecha, confirmado_en: ahora }; TABLAS.dias_confirmados.push(existente); }
    return { rows: [{ confirmado_en: existente.confirmado_en }] };
  }
  if (/^DELETE FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.dias_confirmados = TABLAS.dias_confirmados.filter(d => !(d.grupo_id === grupoId && d.fecha === fecha));
    return { rows: [] };
  }
  if (/^SELECT confirmado_en FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.dias_confirmados.find(d => d.grupo_id === grupoId && d.fecha === fecha);
    return { rows: fila ? [{ confirmado_en: fila.confirmado_en }] : [] };
  }
  if (/^SELECT fecha FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = ANY\(\$2::date\[\]\)/i.test(sql)) {
    const [grupoId, fechas] = params;
    const filas = TABLAS.dias_confirmados.filter(d => d.grupo_id === grupoId && fechas.includes(d.fecha));
    return { rows: filas.map(f => ({ fecha: f.fecha })) };
  }
  // resumenConfirmacionRango() (01-09-2026) — condiciones dinámicas
  // (desde/hasta opcionales), igual que leerHistorial(); se arman en el
  // mismo orden que el código real (grupo_id, después desde, después
  // hasta), así que alcanza con mirar qué condiciones trae el SQL para
  // saber a qué posición de `params` corresponde cada una.
  if (/^SELECT DISTINCT fecha FROM tickets_historial WHERE/i.test(sql)) {
    const grupoId = params[0];
    let idx = 1;
    let desde, hasta;
    if (/fecha >= \$/i.test(sql)) { desde = params[idx]; idx++; }
    if (/fecha <= \$/i.test(sql)) { hasta = params[idx]; idx++; }
    const fechas = new Set(
      TABLAS.tickets_historial
        .filter(r => r.grupo_id === grupoId && (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta))
        .map(r => r.fecha)
    );
    return { rows: Array.from(fechas).map(f => ({ fecha: f })) };
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

const historial = require(path.join(__dirname, '..', 'src', 'services', 'historial'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const GRUPO_ID = 'grupo-guardar-dia-1';
  const FECHA = '2026-08-31';
  const registros1 = [
    { cliente: 'PEDRO', jugadorId: null, ticket: 'Ticket #1', detalle: 'astros -150', arriesga: 100, gana: 66.67, estado: 'PENDIENTE' }
  ];

  // --- 1. Recién procesada, sin confirmar ---
  await historial.guardarEnHistorial(GRUPO_ID, FECHA, registros1);
  let estado = await historial.estadoDia(GRUPO_ID, FECHA);
  check(estado.confirmado === false, 'Una fecha recién procesada (guardarEnHistorial) queda SIN confirmar');
  check(estado.confirmadoEn === null, 'estadoDia() de una fecha sin confirmar trae confirmadoEn null');

  // --- 2. confirmarDia() la marca ---
  const confirmacion = await historial.confirmarDia(GRUPO_ID, FECHA);
  check(confirmacion.confirmado === true, 'confirmarDia() devuelve confirmado: true');
  check(!!confirmacion.confirmadoEn, 'confirmarDia() devuelve un confirmadoEn no vacío');
  estado = await historial.estadoDia(GRUPO_ID, FECHA);
  check(estado.confirmado === true, 'estadoDia() ya refleja la fecha como confirmada después de confirmarDia()');

  // --- 3. Reprocesar la MISMA fecha la desconfirma sola ---
  const registros2 = [
    { cliente: 'PEDRO', jugadorId: null, ticket: 'Ticket #1', detalle: 'astros -150', arriesga: 100, gana: 66.67, estado: 'GANADA' }
  ];
  await historial.guardarEnHistorial(GRUPO_ID, FECHA, registros2);
  estado = await historial.estadoDia(GRUPO_ID, FECHA);
  check(estado.confirmado === false,
    'Reprocesar (guardarEnHistorial) la MISMA fecha que ya estaba confirmada la deja SIN confirmar de nuevo automáticamente');
  check(TABLAS.tickets_historial.find(r => r.grupo_id === GRUPO_ID && r.fecha === FECHA).estado === 'GANADA',
    'El reproceso sí actualizó el estado del ticket en tickets_historial (no solo tocó la confirmación)');

  // --- 4. confirmarDia() es upsert (confirmar 2 veces no rompe nada) ---
  await historial.confirmarDia(GRUPO_ID, FECHA);
  await historial.confirmarDia(GRUPO_ID, FECHA);
  const filasConfirmadas = TABLAS.dias_confirmados.filter(d => d.grupo_id === GRUPO_ID && d.fecha === FECHA);
  check(filasConfirmadas.length === 1, 'confirmarDia() llamado 2 veces seguidas no duplica la fila (upsert, ON CONFLICT DO UPDATE)');

  // --- 5. fechasConfirmadas() con varias fechas, solo algunas confirmadas ---
  const FECHA_2 = '2026-08-30';
  await historial.guardarEnHistorial(GRUPO_ID, FECHA_2, registros1); // esta queda SIN confirmar
  const confirmadas = await historial.fechasConfirmadas(GRUPO_ID, [FECHA, FECHA_2]);
  check(confirmadas.has(FECHA) && !confirmadas.has(FECHA_2),
    'fechasConfirmadas() devuelve solo el subconjunto de fechas realmente confirmadas');

  // --- Estado por defecto de una fecha que nunca se tocó ---
  const estadoNunca = await historial.estadoDia(GRUPO_ID, '2020-01-01');
  check(estadoNunca.confirmado === false, 'estadoDia() de una fecha que nunca se procesó ni confirmó da confirmado: false, no un error');

  // --- 6. resumenConfirmacionRango() (01-09-2026) — usado por Balance
  // General/% Devueltos: en este punto FECHA (31) está confirmada y
  // FECHA_2 (30) no ---
  let resumenRango = await historial.resumenConfirmacionRango(GRUPO_ID, FECHA_2, FECHA);
  check(resumenRango.totalDias === 2, 'resumenConfirmacionRango(): cuenta los 2 días con sábana procesada en el rango');
  check(resumenRango.diasConfirmados === 1, 'resumenConfirmacionRango(): de esos 2, solo 1 está confirmado');
  check(resumenRango.fechasSinConfirmar.length === 1 && resumenRango.fechasSinConfirmar[0] === FECHA_2,
    'resumenConfirmacionRango(): la lista de "sin confirmar" trae exactamente la fecha que falta confirmar');

  // Confirmando también FECHA_2, el rango completo queda confirmado
  await historial.confirmarDia(GRUPO_ID, FECHA_2);
  resumenRango = await historial.resumenConfirmacionRango(GRUPO_ID, FECHA_2, FECHA);
  check(resumenRango.diasConfirmados === 2 && resumenRango.fechasSinConfirmar.length === 0,
    'resumenConfirmacionRango(): con las 2 fechas confirmadas, no queda ninguna pendiente');

  // Un rango sin ninguna sábana procesada no revienta, da totalDias: 0
  const resumenVacio = await historial.resumenConfirmacionRango(GRUPO_ID, '2019-01-01', '2019-01-31');
  check(resumenVacio.totalDias === 0 && resumenVacio.diasConfirmados === 0 && resumenVacio.fechasSinConfirmar.length === 0,
    'resumenConfirmacionRango(): un rango sin actividad da totalDias: 0, no un error');

  // =================================================================
  // --- 7. "Las sábanas finales automáticas de WhatsApp no tienen dónde
  // confirmarlas" (04-09-2026, a pedido del usuario) — el panel de
  // WhatsApp reprocesa la MISMA fecha cada 25 segundos SOLO para
  // refrescar la pantalla (GET /api/whatsapp/dias/:fecha/resumen ->
  // procesarSabana() -> guardarEnHistorial()), aunque nada haya
  // cambiado. Antes, CADA una de esas llamadas desconfirmaba el día
  // aunque los registros fueran idénticos — así que confirmar una
  // sábana automática duraba, como mucho, 25 segundos en pantalla. Acá
  // se simula exactamente ese escenario: confirmar y después reprocesar
  // 3 veces seguidas con los MISMOS registros (como haría el refresco de
  // fondo) tiene que dejar el día confirmado todo el tiempo.
  // =================================================================
  const FECHA_WSP = '2026-09-04';
  const registrosWsp = [
    { cliente: 'BERNAL', jugadorId: null, ticket: 'Ticket #1', detalle: 'rangers alta 7.5 -120 | brewers baja 5to 4.5 -130', arriesga: 500, gana: 1121, estado: 'GANADA' },
    { cliente: 'BERNAL', jugadorId: null, ticket: 'Ticket #2', detalle: 'royals baja 9 -105 | tampa -119 | dodgers -265', arriesga: 100, gana: 394, estado: 'PERDIDA' }
  ];
  await historial.guardarEnHistorial(GRUPO_ID, FECHA_WSP, registrosWsp);
  await historial.confirmarDia(GRUPO_ID, FECHA_WSP);
  let estadoWsp = await historial.estadoDia(GRUPO_ID, FECHA_WSP);
  check(estadoWsp.confirmado === true, '(sábana automática) el día queda confirmado después de "💾 Guardar Día"');

  // 3 "refrescos de fondo" seguidos, cada 25s en la vida real, con
  // EXACTAMENTE los mismos registros (nada cambió: la sábana ya está
  // final, ningún juego más terminó) — el orden de los registros viene
  // distinto a propósito, para probar que la comparación no depende del
  // orden de los tickets.
  for (let i = 0; i < 3; i++) {
    await historial.guardarEnHistorial(GRUPO_ID, FECHA_WSP, [registrosWsp[1], registrosWsp[0]]);
  }
  estadoWsp = await historial.estadoDia(GRUPO_ID, FECHA_WSP);
  check(estadoWsp.confirmado === true,
    '(sábana automática) 3 refrescos de fondo seguidos con los MISMOS registros NO desconfirman el día — antes de este arreglo, esto fallaba');
  check(TABLAS.tickets_historial.filter(r => r.grupo_id === GRUPO_ID && r.fecha === FECHA_WSP).length === 2,
    'los refrescos de fondo sin cambios tampoco duplican filas en tickets_historial (se saltean el DELETE+INSERT entero)');

  // Ahora si un ticket SÍ cambia de verdad (ej. un juego en curso cerró)
  // el reproceso tiene que desconfirmar el día como siempre.
  const registrosWspCambiados = [
    { ...registrosWsp[0] },
    { ...registrosWsp[1], estado: 'GANADA' } // este SÍ cambió de PERDIDA a GANADA
  ];
  await historial.guardarEnHistorial(GRUPO_ID, FECHA_WSP, registrosWspCambiados);
  estadoWsp = await historial.estadoDia(GRUPO_ID, FECHA_WSP);
  check(estadoWsp.confirmado === false,
    '(sábana automática) si un ticket SÍ cambia de verdad, el reproceso sigue desconfirmando el día como antes');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "Guardar Día" se cayó con una excepción:', e);
  process.exit(1);
});
