// Cuadre al centavo de las Jugadas entre Tercios Adelantadas (12-10-2026, caso real: Balance
// General con "TOTAL PIERDEN + TOTAL GANAN = -1.540,26" y Comisión 1.540,39, $0,13 de diferencia).
//
// Causa: cada jugada guarda 3 montos redondeados POR SEPARADO (lo que gana el jugador, lo que
// pierde el banquero y la comisión del grupo). Cuando el % cae justo en medio centavo
// (ej. 10,10 x 5% = 0,505) los tres suben a la vez y sobraba $0,01 de comisión por jugada:
// jugador + banquero + comisión = +0,01 en vez de 0. Con muchas jugadas en la semana se acumula.
//
// Regla correcta: la comisión del grupo es EXACTAMENTE lo que le falta a jugador + banquero para
// sumar 0: comision_grupo = -(resultado_jugador + resultado_banquero). Para lo que se resuelva de
// ahora en adelante ya sale así (ver resolverLineaTerciosAdelantada); esta función corrige las
// jugadas YA guardadas. Es idempotente y barata (un UPDATE que solo toca las filas descuadradas);
// nunca rompe una lectura si falla.
const db = require('../db');

async function sanearComisionTerciosAdelantadas(grupoId) {
  try {
    const r = await db.query(
      `UPDATE hipismo_tercios_adelantadas_jugadas
          SET comision_grupo = ROUND(-(resultado_jugador + resultado_banquero)::numeric, 2)
        WHERE grupo_id = $1 AND estado = 'resuelto'
          AND resultado_jugador IS NOT NULL AND resultado_banquero IS NOT NULL
          AND comision_grupo IS DISTINCT FROM ROUND(-(resultado_jugador + resultado_banquero)::numeric, 2)`,
      [grupoId]
    );
    return (r && r.rowCount) || 0;
  } catch (e) {
    console.error('[tercios adelantadas] no se pudo sanear la comisión:', e.message);
    return 0;
  }
}

module.exports = { sanearComisionTerciosAdelantadas };
