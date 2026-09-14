// =================================================================
// MANTENIMIENTO DE GRUPO — borrar jugadas/sábana (y Polla) por fecha,
// elegidas a mano por el Súper-admin (02-09-2026, a pedido del usuario:
// "Crea un boton en superadmin al seleccionar determinado grupo que ese
// boton me permita borrar todas las jugadas que tenga ese grupo y las
// sabanas eligiendo yo las fechas que deseo borrar").
//
// A pedido explícito del usuario (respuesta a la pregunta de aclaración),
// borrar fechas TAMBIÉN borra la Polla de esas mismas fechas ("Sí,
// incluir la Polla") — pero NO toca la tabla "alertas": una alerta queda
// guardada con la fecha en la que se DETECTÓ (fecha de Venezuela al
// momento de la confirmación/diferencia del cliente, por ejemplo), no
// necesariamente la fecha de la sábana que se está borrando — mezclar
// ambos borrados podría destruir sin querer una alerta de otro tipo que
// solo comparte el número de fecha. Si en el futuro hace falta borrar
// alertas también, mejor un botón aparte y explícito.
//
// Reprocesar una fecha ya deja "sin confirmar" el día (ver
// historial.js/desconfirmarDia) — borrar una fecha por completo hace lo
// mismo por la misma razón: no debe quedar una fecha marcada como
// "sábana oficial" si ya no tiene ni sábana.
const db = require('./../db');
const { desconfirmarDia } = require('./historial');
const { eliminarEstadoDia } = require('./whatsappDiaEstado');

// Lista, para un grupo, todas las fechas que tienen ALGÚN dato (sábana
// y/o Polla) — para armar el checklist de fechas que el Súper-admin puede
// elegir borrar. Devuelve un array de objetos { fecha, tickets, polla }
// ordenado de más reciente a más antiguo, para que las fechas más
// probables de querer borrar (las últimas) aparezcan primero.
async function listarFechasConDatos(grupoId) {
  const resTickets = await db.query(
    'SELECT fecha, COUNT(*)::int AS n FROM tickets_historial WHERE grupo_id = $1 GROUP BY fecha',
    [grupoId]
  );
  const resPolla = await db.query(
    'SELECT fecha, COUNT(*)::int AS n FROM polla_historial WHERE grupo_id = $1 GROUP BY fecha',
    [grupoId]
  );

  const porFecha = {};
  const aFechaISO = (f) => (f instanceof Date ? f.toISOString().split('T')[0] : f);

  resTickets.rows.forEach(r => {
    const fecha = aFechaISO(r.fecha);
    if (!porFecha[fecha]) porFecha[fecha] = { fecha, tickets: 0, polla: 0 };
    porFecha[fecha].tickets = r.n;
  });
  resPolla.rows.forEach(r => {
    const fecha = aFechaISO(r.fecha);
    if (!porFecha[fecha]) porFecha[fecha] = { fecha, tickets: 0, polla: 0 };
    porFecha[fecha].polla = r.n;
  });

  return Object.values(porFecha).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

// Borra la sábana (tickets_historial) y la Polla (polla_historial) de las
// fechas indicadas, para un grupo — todo dentro de una transacción (o se
// borra todo, o no se borra nada). Devuelve cuántas filas se borraron de
// cada tabla, para que el panel pueda confirmarle al Súper-admin qué se
// hizo.
async function borrarDatosDeFechas(grupoId, fechas) {
  if (!fechas || fechas.length === 0) return { fechas: [], ticketsBorrados: 0, pollaBorrada: 0 };

  const resultado = await db.transaccion(async (client) => {
    const resT = await client.query(
      'DELETE FROM tickets_historial WHERE grupo_id = $1 AND fecha = ANY($2::date[])',
      [grupoId, fechas]
    );
    const resP = await client.query(
      'DELETE FROM polla_historial WHERE grupo_id = $1 AND fecha = ANY($2::date[])',
      [grupoId, fechas]
    );
    return { ticketsBorrados: resT.rowCount || 0, pollaBorrada: resP.rowCount || 0 };
  });

  // Cada fecha borrada deja de tener sábana — cualquier confirmación
  // ("💾 Guardar Día") sobre esa fecha ya no tiene sentido.
  //
  // (04-09-2026, a pedido del usuario: "tengo un ticket abierto el dia 4
  // lo elimino desde super admin ... y me vuelve a aparecer el ticket") —
  // ver la nota grande en whatsappDiaEstado.js/eliminarEstadoDia: si
  // alguna de estas fechas había llegado por WhatsApp, también hay que
  // borrar acá su seguimiento — si no, el reloj de fondo del bot (o el
  // panel del Grupo, refrescando cada 25s) reprocesa el texto viejo que
  // seguía guardado y el ticket "resucita" solo, sin que nadie mande nada
  // de nuevo. Si una fecha nunca tuvo ninguna sábana por WhatsApp, esto
  // no hace nada.
  for (const fecha of fechas) {
    await desconfirmarDia(grupoId, fecha);
    await eliminarEstadoDia(grupoId, fecha);
  }

  return { fechas, ticketsBorrados: resultado.ticketsBorrados, pollaBorrada: resultado.pollaBorrada };
}

module.exports = { listarFechasConDatos, borrarDatosDeFechas };
