// =================================================================
// "PAPELERA RECUPERABLE" para eliminar sábanas por día (03-09-2026, a
// pedido del usuario: "en la pestaña sabana crea un boton para eliminar
// toda la sabana de dicho dia, o de los dias que yo quiera seleccionar,
// asi en caso de algun error no tener que editar o borrar jugada por
// jugada", más su respuesta a la pregunta de aclaración: "papelera
// recuperable... es información contable, un borrado por error o mal
// intencionado puede ser grave").
//
// Distinto del borrado de superadmin ya existente
// (services/mantenimientoGrupo.js, borrarDatosDeFechas): ESE es
// definitivo y a propósito NO genera alertas (ver la nota grande en ese
// archivo — decisión ya tomada con el usuario el 02-09-2026). Este es el
// botón nuevo, DENTRO del propio grupo (pestaña "Sábanas"), y tiene 2
// diferencias clave a propósito:
//   1. Antes de borrar, guarda una copia completa de lo que había
//      (tickets_historial + polla_historial de esa fecha) en
//      "sabana_papelera", recuperable con restaurarPapelera() mientras
//      no se haya purgado (30 días).
//   2. SIEMPRE genera una alerta (tipo SABANA_ELIMINADA / luego
//      SABANA_RESTAURADA si se restaura) — visible para el Grupo y para
//      el Súper-admin, mismo criterio que TICKET_EDITADO en
//      sabanaDia.js — porque es justo la operación que un empleado con
//      mala intención usaría para "limpiar" jugadas que no le convienen.
//
// NOTA sobre "quién" hizo el borrado (a pedido del usuario, respuesta a
// la pregunta de aclaración: "solo grupo + fecha/hora, como ya
// funciona"): hoy cada grupo entra con un solo usuario/contraseña
// compartido (ver middleware/auth.js) — no hay cuentas por empleado, así
// que la alerta no puede decir CUÁL empleado fue, solo QUÉ se borró/
// restauró y CUÁNDO. Si más adelante se agregan cuentas individuales por
// empleado, ahí sí se podría sumar un campo "quién" a estas alertas.
const db = require('./../db');
const { desconfirmarDia } = require('./historial');
const { eliminarEstadoDia } = require('./whatsappDiaEstado');

const DIAS_ANTES_DE_PURGAR = 30;

async function purgarVencidas(grupoId) {
  await db.query(
    `DELETE FROM sabana_papelera WHERE grupo_id = $1 AND eliminado_en < now() - interval '${DIAS_ANTES_DE_PURGAR} days'`,
    [grupoId]
  );
}

function contarPorFecha(json) {
  try {
    return Array.isArray(json) ? json.length : (JSON.parse(json) || []).length;
  } catch (e) {
    return 0;
  }
}

// Borra la sábana (tickets_historial) y la Polla (polla_historial) de
// las fechas indicadas, guardando antes una copia en sabana_papelera y
// dejando una alerta. Devuelve { fechas, ticketsBorrados, pollaBorrada,
// papeleraIds } para que el panel pueda avisar "listo, se puede
// restaurar desde la Papelera".
async function eliminarSabanaDeFechas(grupoId, fechas) {
  if (!fechas || fechas.length === 0) {
    const err = new Error('Elige al menos un día para eliminar.');
    err.status = 400;
    throw err;
  }

  let ticketsBorrados = 0;
  let pollaBorrada = 0;
  const papeleraIds = [];
  const resumenPorFecha = [];

  for (const fecha of fechas) {
    const resultado = await db.transaccion(async (client) => {
      const resTickets = await client.query(
        'SELECT id, cliente_nombre, jugador_id, ticket_label, detalle, arriesga, gana, estado FROM tickets_historial WHERE grupo_id = $1 AND fecha = $2',
        [grupoId, fecha]
      );
      const resPolla = await client.query(
        'SELECT id, cliente_nombre, jugador_id, monto, nota FROM polla_historial WHERE grupo_id = $1 AND fecha = $2',
        [grupoId, fecha]
      );

      if (resTickets.rows.length === 0 && resPolla.rows.length === 0) {
        return { fecha, tickets: 0, polla: 0, papeleraId: null };
      }

      const papelera = await client.query(
        `INSERT INTO sabana_papelera (grupo_id, fecha, tickets_json, polla_json)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [grupoId, fecha, JSON.stringify(resTickets.rows), JSON.stringify(resPolla.rows)]
      );

      await client.query('DELETE FROM tickets_historial WHERE grupo_id = $1 AND fecha = $2', [grupoId, fecha]);
      await client.query('DELETE FROM polla_historial WHERE grupo_id = $1 AND fecha = $2', [grupoId, fecha]);

      return { fecha, tickets: resTickets.rows.length, polla: resPolla.rows.length, papeleraId: papelera.rows[0].id };
    });

    if (resultado.papeleraId) {
      ticketsBorrados += resultado.tickets;
      pollaBorrada += resultado.polla;
      papeleraIds.push(resultado.papeleraId);
      resumenPorFecha.push(resultado);
      await desconfirmarDia(grupoId, fecha);
    }

    // (04-09-2026, ver la nota grande en whatsappDiaEstado.js/
    // eliminarEstadoDia) — SIEMPRE, no solo cuando había algo en la
    // Papelera: si esta fecha había llegado por WhatsApp, hay que borrar
    // también su seguimiento acá, para que el bot no la vuelva a
    // reprocesar sola y "resucite" el ticket recién borrado. Si la fecha
    // nunca tuvo ninguna sábana por WhatsApp, esto no hace nada.
    await eliminarEstadoDia(grupoId, fecha);
  }

  if (papeleraIds.length > 0) {
    const detalle = resumenPorFecha.map(r => r.fecha + ' (' + r.tickets + ' ticket(s), ' + r.polla + ' fila(s) de polla)').join('; ');
    const mensaje = 'Se eliminó la sábana de ' + papeleraIds.length + ' día(s): ' + detalle + '. Se puede restaurar desde la Papelera durante ' + DIAS_ANTES_DE_PURGAR + ' días.';
    await db.query(
      `INSERT INTO alertas (grupo_id, fecha, tipo, pata, mensaje, resuelta, resuelto_en)
       VALUES ($1, $2, 'SABANA_ELIMINADA', $3, $4, true, now())`,
      [grupoId, resumenPorFecha[0].fecha, 'SABANA_ELIMINADA:' + papeleraIds.join(',') + ':' + Date.now(), mensaje]
    );
  }

  return { fechas: resumenPorFecha.map(r => r.fecha), ticketsBorrados, pollaBorrada, papeleraIds };
}

// Lista lo que hay en la Papelera de un grupo (purga primero lo vencido).
async function listarPapelera(grupoId) {
  await purgarVencidas(grupoId);
  const res = await db.query(
    `SELECT id, fecha, tickets_json, polla_json, eliminado_en, restaurado_en
     FROM sabana_papelera WHERE grupo_id = $1 ORDER BY eliminado_en DESC`,
    [grupoId]
  );
  const ahora = Date.now();
  return res.rows.map(r => {
    const eliminadoEn = new Date(r.eliminado_en).getTime();
    const diasPasados = Math.floor((ahora - eliminadoEn) / (24 * 60 * 60 * 1000));
    return {
      id: r.id,
      fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha,
      tickets: contarPorFecha(r.tickets_json),
      polla: contarPorFecha(r.polla_json),
      eliminadoEn: r.eliminado_en,
      restaurado: !!r.restaurado_en,
      diasRestantes: Math.max(0, DIAS_ANTES_DE_PURGAR - diasPasados)
    };
  });
}

// Restaura una entrada de la Papelera: reinserta sus tickets/polla en
// las tablas en vivo (con los MISMOS ids que tenían, para que quede
// igual que antes de borrarla) y deja una alerta de que se restauró.
async function restaurarPapelera(grupoId, papeleraId) {
  const res = await db.query(
    'SELECT id, fecha, tickets_json, polla_json, restaurado_en FROM sabana_papelera WHERE grupo_id = $1 AND id = $2',
    [grupoId, papeleraId]
  );
  if (res.rows.length === 0) {
    const err = new Error('No se encontró esa entrada de la Papelera (puede que ya se haya purgado después de 30 días).');
    err.status = 404;
    throw err;
  }
  const fila = res.rows[0];
  if (fila.restaurado_en) {
    const err = new Error('Esta sábana ya fue restaurada antes.');
    err.status = 400;
    throw err;
  }

  const tickets = Array.isArray(fila.tickets_json) ? fila.tickets_json : JSON.parse(fila.tickets_json || '[]');
  const polla = Array.isArray(fila.polla_json) ? fila.polla_json : JSON.parse(fila.polla_json || '[]');
  const fecha = fila.fecha instanceof Date ? fila.fecha.toISOString().split('T')[0] : fila.fecha;

  await db.transaccion(async (client) => {
    for (const t of tickets) {
      await client.query(
        `INSERT INTO tickets_historial (id, grupo_id, fecha, cliente_nombre, jugador_id, ticket_label, detalle, arriesga, gana, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, grupoId, fecha, t.cliente_nombre, t.jugador_id, t.ticket_label, t.detalle, t.arriesga, t.gana, t.estado]
      );
    }
    for (const p of polla) {
      await client.query(
        `INSERT INTO polla_historial (id, grupo_id, fecha, cliente_nombre, jugador_id, monto, nota)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, grupoId, fecha, p.cliente_nombre, p.jugador_id, p.monto, p.nota]
      );
    }
    await client.query('UPDATE sabana_papelera SET restaurado_en = now() WHERE id = $1', [papeleraId]);
  });

  await desconfirmarDia(grupoId, fecha);

  const mensaje = 'Se restauró la sábana del día ' + fecha + ' desde la Papelera (' + tickets.length + ' ticket(s), ' + polla.length + ' fila(s) de polla).';
  await db.query(
    `INSERT INTO alertas (grupo_id, fecha, tipo, pata, mensaje, resuelta, resuelto_en)
     VALUES ($1, $2, 'SABANA_RESTAURADA', $3, $4, true, now())`,
    [grupoId, fecha, 'SABANA_RESTAURADA:' + papeleraId + ':' + Date.now(), mensaje]
  );

  return { fecha, ticketsRestaurados: tickets.length, pollaRestaurada: polla.length };
}

module.exports = { eliminarSabanaDeFechas, listarPapelera, restaurarPapelera };
