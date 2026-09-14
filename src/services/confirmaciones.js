// =================================================================
// CONFIRMACIONES DEL CLIENTE — botones "✅ Estamos cuadrados" / "⚠️ Tengo
// diferencia" del link público del Cliente (02-09-2026, a pedido del
// usuario). A pedido EXPLÍCITO del usuario esto es "un plus": nunca
// bloquea ni cambia el funcionamiento normal del grupo — solo deja
// constancia y avisa. Usable una vez por día CALENDARIO DE VENEZUELA por
// jugador (ver sql/schema.sql, tabla confirmaciones_cliente, unique
// (jugador_id, fecha) — esa restricción de la base de datos es la que de
// verdad hace cumplir la regla, esta función solo la traduce a un mensaje
// entendible).
//
// Cada acción también deja una fila en "alertas" (la misma tabla que ya
// usan las jugadas AMBIGUA_DEPORTE/SIN_LOGRO) para que el Grupo y el
// Súper-admin la vean en su pestaña Alertas de siempre — ver la nota
// grande en alertas.js sobre esa tabla, y app.js/superadmin.html para el
// renderizado con los tipos nuevos.
//   - CONFIRMACION_CLIENTE: informativa, se guarda YA resuelta (no hay
//     nada que "arreglar") — solo deja constancia.
//   - DIFERENCIA_CLIENTE: se guarda SIN resolver, para que el Grupo la
//     vea como algo pendiente de revisar y la pueda marcar atendida
//     (reusa descartarAlerta(), que ya es genérica — ver alertas.js).
const db = require('./../db');
const { fechaVenezuelaHoy } = require('./fechaVenezuela');

// Qué usó el jugador HOY (fecha de Venezuela), si algo — para que
// cliente.html pinte el botón ya usado (y con qué resultado) al cargar la
// página, sin que el usuario tenga que apretarlo para enterarse.
async function obtenerConfirmacionHoy(jugadorId) {
  const fecha = fechaVenezuelaHoy();
  const r = await db.query(
    'SELECT tipo, creado_en FROM confirmaciones_cliente WHERE jugador_id = $1 AND fecha = $2',
    [jugadorId, fecha]
  );
  if (r.rows.length === 0) return null;
  return { tipo: r.rows[0].tipo, fecha, creadoEn: r.rows[0].creado_en };
}

async function registrarConfirmacion(grupoId, jugador, grupoNombre, tipo) {
  if (tipo !== 'CUADRADO' && tipo !== 'DIFERENCIA') {
    const err = new Error('Tipo de confirmación inválido.');
    err.status = 400;
    throw err;
  }
  const fecha = fechaVenezuelaHoy();

  try {
    await db.query(
      'INSERT INTO confirmaciones_cliente (grupo_id, jugador_id, fecha, tipo) VALUES ($1, $2, $3, $4)',
      [grupoId, jugador.id, fecha, tipo]
    );
  } catch (e) {
    if (e.code === '23505') {
      const err = new Error('Ya usaste este botón hoy — se puede volver a usar mañana.');
      err.status = 409;
      throw err;
    }
    throw e;
  }

  // Deja constancia en "alertas" (visible para el Grupo y para
  // Súper-admin) — ver la nota grande arriba.
  if (tipo === 'CUADRADO') {
    await db.query(
      `INSERT INTO alertas (grupo_id, fecha, tipo, cliente_nombre, pata, mensaje, resuelta, resuelto_en)
       VALUES ($1, $2, 'CONFIRMACION_CLIENTE', $3, $4, $5, true, now())`,
      [
        grupoId,
        fecha,
        jugador.nombre,
        `CONFIRMACION:${jugador.id}:${fecha}`,
        `${jugador.nombre} confirmó que su cuenta está cuadrada.`
      ]
    );
  } else {
    await db.query(
      `INSERT INTO alertas (grupo_id, fecha, tipo, cliente_nombre, pata, mensaje)
       VALUES ($1, $2, 'DIFERENCIA_CLIENTE', $3, $4, $5)`,
      [
        grupoId,
        fecha,
        jugador.nombre,
        `DIFERENCIA:${jugador.id}:${fecha}`,
        `${jugador.nombre} reportó una diferencia en su cuenta.`
      ]
    );
  }

  return { tipo, fecha };
}

module.exports = { obtenerConfirmacionHoy, registrarConfirmacion };
