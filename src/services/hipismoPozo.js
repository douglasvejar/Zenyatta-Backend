// =================================================================
// LIQUIDADO DE POZO — HIPISMO (26-09-2026, a pedido del usuario: "al
// crear un plano gana o pierde... su pozo aumente o baja según vaya
// ganando o perdiendo") — hasta esta ronda, el pozo de un cliente de
// Hipismo (jugadores.tipo_cuenta = 'avalado') era 100% MANUAL: solo se
// movía con el +/- de "Ajustar pozo" (pozo_ajustes) — jugar Hipismo
// nunca tocaba el pozo, que es justo lo que reportó el usuario como
// "la pestaña Pozos no me está funcionando".
//
// Esto agrega el movimiento AUTOMÁTICO: la suma de TODO lo que ese
// cliente ganó/perdió alguna vez en Hipismo (Tercios de "Cargar Planos"
// + Remate + Jugadas Adelantadas, sea como jugador o como banquero) —
// de PARA SIEMPRE (todo el histórico), no solo de la semana — a
// diferencia de Balance/Cierre Final, que sí resetean cada semana A
// PROPÓSITO (ver la nota grande en routes/hipismo.js, GET /cierre-final:
// "si cierre final es el saldo real... no debe estar sumada ni restado
// pozos"). El resultado de acá se combina en services/pozo.js con el
// liquidado de Deportes, para que un cliente "anclado" a los 2 módulos
// vea TODO su juego reflejado en un solo pozo.
//
// A PROPÓSITO no incluye acá el "% Devuelto" (comisión propia) ni los
// Traspasos de Comisión — son movimientos de comisión/administrativos,
// no resultado de JUGAR, y el usuario no los mencionó al pedir esto. Si
// más adelante se quiere que también muevan el pozo, se agregan acá.
const db = require('../db');
const { asegurarBanqueoAutomaticoMarcas } = require('./hipismoMarcasBanqueoAuto');

// 07-10-2026 (a pedido del usuario: "los pozos deben reiniciarse a lo que les
// coloqué en un principio cada semana nueva... si un tercio decía 5000 de
// pozo, al venir semana nueva debe volver a tener sus 5000"): `rango`
// ({ desde, hasta } en 'YYYY-MM-DD', la semana activa del grupo — Fecha de
// Semana) limita TODO lo que se suma a esas fechas, con los mismos criterios
// de fecha que Cierre Final (fecha del plano / del remate / del plano de
// adelantadas / de la fila de Winners). Sin `rango` suma todo el histórico,
// como antes (nadie más lo usa así hoy, pero no se rompe).
async function calcularLiquidadoHipismo(grupoId, nombreCliente, rango) {
  await asegurarBanqueoAutomaticoMarcas(grupoId); // 06-10-2026
  const conRango = !!(rango && rango.desde && rango.hasta);
  const parametros = conRango
    ? [grupoId, nombreCliente, rango.desde, rango.hasta]
    : [grupoId, nombreCliente];

  // Cada fuente se suma dentro de PostgreSQL. Un ticket puede contar
  // por ambos lados si el cliente figura como jugador y banquero.
  const { rows } = await db.query(
    `WITH adelantadas AS (
       SELECT j.cliente_nombre, j.resultado_cliente, j.banqueadores
         FROM hipismo_adelantadas_jugadas j
         ${conRango ? 'JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id' : ''}
        WHERE j.grupo_id = $1 AND j.estado IN ('resuelto', 'falta_banqueo', 'sin_decidir')
          ${conRango ? 'AND p.fecha BETWEEN $3 AND $4' : ''}
     )
     SELECT
       COALESCE((
         SELECT SUM(
           CASE WHEN t.cliente_nombre = $2 THEN COALESCE(t.resultado_jugador, 0) ELSE 0 END +
           CASE WHEN t.banquero_nombre = $2 THEN COALESCE(t.resultado_banquero, 0) ELSE 0 END)
           FROM hipismo_tickets t
           ${conRango ? 'JOIN hipismo_planos p ON p.id = t.plano_id' : ''}
          WHERE t.grupo_id = $1 AND (t.cliente_nombre = $2 OR t.banquero_nombre = $2)
            ${conRango ? 'AND p.fecha BETWEEN $3 AND $4' : ''}
       ), 0) +
       COALESCE((
         SELECT SUM(a.resultado)
           FROM hipismo_remate_apuestas a
           ${conRango ? 'JOIN hipismo_remates r ON r.id = a.remate_id' : ''}
          WHERE a.grupo_id = $1 AND a.cliente_nombre = $2
            ${conRango ? 'AND r.fecha BETWEEN $3 AND $4' : ''}
       ), 0) +
       COALESCE((SELECT SUM(resultado_cliente) FROM adelantadas WHERE cliente_nombre = $2), 0) +
       COALESCE((
         SELECT SUM(CASE
           WHEN jsonb_typeof(b -> 'monto') = 'number' THEN (b ->> 'monto')::numeric
           WHEN jsonb_typeof(b -> 'monto') = 'string'
             AND btrim(b ->> 'monto') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
             THEN (b ->> 'monto')::numeric
           ELSE 0 END)
           FROM adelantadas j
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(j.banqueadores) = 'array' THEN j.banqueadores ELSE '[]'::jsonb END
           ) AS banquero(b)
          WHERE b ->> 'nombre' = $2
       ), 0) +
       COALESCE((
         SELECT SUM(w.monto) FROM hipismo_winners w
          WHERE w.grupo_id = $1 AND w.cliente_nombre = $2
            ${conRango ? 'AND w.fecha BETWEEN $3 AND $4' : ''}
       ), 0) AS total`,
    parametros
  );
  return Number(rows[0].total);
}

module.exports = { calcularLiquidadoHipismo };
