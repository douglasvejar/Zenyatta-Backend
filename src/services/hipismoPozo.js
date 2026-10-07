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
  let total = 0;
  const conRango = !!(rango && rango.desde && rango.hasta);

  // Tercios de "Cargar Planos" — el cliente puede ganar/perder como
  // jugador (resultado_jugador) O como banquero de otro (resultado_banquero);
  // un mismo ticket puede involucrarlo en los 2 roles a la vez (raro, pero
  // posible si se banquea a sí mismo por error) — se suman ambos si aplica.
  const rTickets = conRango
    ? await db.query(
      `SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero
         FROM hipismo_tickets t
         JOIN hipismo_planos p ON p.id = t.plano_id
        WHERE t.grupo_id = $1 AND (t.cliente_nombre = $2 OR t.banquero_nombre = $2) AND p.fecha BETWEEN $3 AND $4`,
      [grupoId, nombreCliente, rango.desde, rango.hasta]
    )
    : await db.query(
      `SELECT cliente_nombre, banquero_nombre, resultado_jugador, resultado_banquero
         FROM hipismo_tickets
        WHERE grupo_id = $1 AND (cliente_nombre = $2 OR banquero_nombre = $2)`,
      [grupoId, nombreCliente]
    );
  rTickets.rows.forEach(t => {
    if (t.cliente_nombre === nombreCliente) total += Number(t.resultado_jugador) || 0;
    if (t.banquero_nombre === nombreCliente) total += Number(t.resultado_banquero) || 0;
  });

  // Remate — cada apuesta ya trae su resultado neto final (ganó el pozo
  // completo menos comisión, o perdió lo apostado).
  const rRemate = conRango
    ? await db.query(
      `SELECT a.resultado
         FROM hipismo_remate_apuestas a
         JOIN hipismo_remates r ON r.id = a.remate_id
        WHERE a.grupo_id = $1 AND a.cliente_nombre = $2 AND r.fecha BETWEEN $3 AND $4`,
      [grupoId, nombreCliente, rango.desde, rango.hasta]
    )
    : await db.query(
      'SELECT resultado FROM hipismo_remate_apuestas WHERE grupo_id = $1 AND cliente_nombre = $2',
      [grupoId, nombreCliente]
    );
  rRemate.rows.forEach(a => { total += Number(a.resultado) || 0; });

  // Jugadas Adelantadas — mismo criterio que Cierre Final (routes/hipismo.js,
  // GET /cierre-final): solo cuentan las que ya salieron de 'pendiente'
  // (resuelto, falta_banqueo, sin_decidir — en 'sin_decidir' el resultado ya
  // quedó en 0). El cliente puede aparecer como quien jugó (cliente_nombre)
  // o, en una Marca ya resuelta, como uno de los banqueadores (jsonb).
  const rAdelantadas = conRango
    ? await db.query(
      `SELECT j.cliente_nombre, j.resultado_cliente, j.banqueadores
         FROM hipismo_adelantadas_jugadas j
         JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
        WHERE j.grupo_id = $1 AND j.estado IN ('resuelto', 'falta_banqueo', 'sin_decidir') AND p.fecha BETWEEN $2 AND $3`,
      [grupoId, rango.desde, rango.hasta]
    )
    : await db.query(
      `SELECT cliente_nombre, resultado_cliente, banqueadores
         FROM hipismo_adelantadas_jugadas
        WHERE grupo_id = $1 AND estado IN ('resuelto', 'falta_banqueo', 'sin_decidir')`,
      [grupoId]
    );
  rAdelantadas.rows.forEach(j => {
    if (j.cliente_nombre === nombreCliente) total += Number(j.resultado_cliente) || 0;
    if (Array.isArray(j.banqueadores)) {
      j.banqueadores.forEach(b => {
        if (b && b.nombre === nombreCliente) total += Number(b.monto) || 0;
      });
    }
  });

  // "Cargar Winners" (26-09-2026, a pedido del usuario: "eso mueve su
  // balance y su pozo ya que es una jugada") — cada fila ya es el
  // resultado neto de ese cliente, se suma tal cual.
  const rWinners = conRango
    ? await db.query(
      'SELECT monto FROM hipismo_winners WHERE grupo_id = $1 AND cliente_nombre = $2 AND fecha BETWEEN $3 AND $4',
      [grupoId, nombreCliente, rango.desde, rango.hasta]
    )
    : await db.query(
      'SELECT monto FROM hipismo_winners WHERE grupo_id = $1 AND cliente_nombre = $2',
      [grupoId, nombreCliente]
    );
  rWinners.rows.forEach(w => { total += Number(w.monto) || 0; });

  return total;
}

module.exports = { calcularLiquidadoHipismo };
