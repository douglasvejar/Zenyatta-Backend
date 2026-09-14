// =================================================================
// CHAT DE SOPORTE — un hilo por Grupo con el Súper-admin. No hay chats
// entre grupos, ni un grupo con más de un hilo: es 1 conversación por
// grupo_id, con mensajes de remitente 'grupo' o 'superadmin'.
// =================================================================
const db = require('../db');

async function enviarMensaje(grupoId, remitente, texto) {
  if (!texto || !texto.trim()) {
    const err = new Error('Escribe un mensaje antes de enviarlo.');
    err.status = 400;
    throw err;
  }
  const r = await db.query(
    `INSERT INTO mensajes_chat (grupo_id, remitente, texto)
     VALUES ($1, $2, $3) RETURNING id, grupo_id, remitente, texto, creado_en`,
    [grupoId, remitente, texto.trim()]
  );
  return r.rows[0];
}

async function listarMensajes(grupoId) {
  const r = await db.query(
    'SELECT id, remitente, texto, creado_en FROM mensajes_chat WHERE grupo_id = $1 ORDER BY creado_en ASC LIMIT 500',
    [grupoId]
  );
  return r.rows;
}

// Para el panel del Súper-admin: UN renglón por CADA grupo que existe
// (02-09-2026, corregido a pedido del usuario) — antes el "WHERE EXISTS"
// dejaba afuera a cualquier grupo que todavía no le hubiera escrito
// primero al Súper-admin, así que la bandeja solo servía para RESPONDER,
// nunca para que el Súper-admin iniciara una conversación con un grupo
// que él quisiera contactar. Ahora se listan TODOS los grupos (LEFT JOIN,
// sin el WHERE EXISTS) — los que ya tienen mensajes aparecen primero,
// ordenados por el más reciente (igual que antes); los que todavía no
// tienen ninguno quedan al final (ultimo_en NULL), ordenados por nombre,
// listos para que el Súper-admin les escriba el primer mensaje.
async function listarConversaciones() {
  const r = await db.query(
    `SELECT g.id AS grupo_id, g.nombre AS grupo_nombre, g.activo AS grupo_activo,
            (SELECT texto FROM mensajes_chat m WHERE m.grupo_id = g.id ORDER BY m.creado_en DESC LIMIT 1) AS ultimo_mensaje,
            (SELECT creado_en FROM mensajes_chat m WHERE m.grupo_id = g.id ORDER BY m.creado_en DESC LIMIT 1) AS ultimo_en,
            (SELECT COUNT(*)::int FROM mensajes_chat m WHERE m.grupo_id = g.id AND m.remitente = 'grupo' AND m.leido_superadmin = false) AS no_leidos
     FROM grupos g
     ORDER BY ultimo_en DESC NULLS LAST, g.nombre ASC`
  );
  return r.rows;
}

async function contarNoLeidosGrupo(grupoId) {
  const r = await db.query(
    "SELECT COUNT(*)::int AS total FROM mensajes_chat WHERE grupo_id = $1 AND remitente = 'superadmin' AND leido_grupo = false",
    [grupoId]
  );
  return r.rows[0].total;
}

async function contarNoLeidosSuperadminTotal() {
  const r = await db.query(
    "SELECT COUNT(*)::int AS total FROM mensajes_chat WHERE remitente = 'grupo' AND leido_superadmin = false"
  );
  return r.rows[0].total;
}

async function marcarLeidosGrupo(grupoId) {
  await db.query(
    "UPDATE mensajes_chat SET leido_grupo = true WHERE grupo_id = $1 AND remitente = 'superadmin' AND leido_grupo = false",
    [grupoId]
  );
}

async function marcarLeidosSuperadmin(grupoId) {
  await db.query(
    "UPDATE mensajes_chat SET leido_superadmin = true WHERE grupo_id = $1 AND remitente = 'grupo' AND leido_superadmin = false",
    [grupoId]
  );
}

module.exports = {
  enviarMensaje,
  listarMensajes,
  listarConversaciones,
  contarNoLeidosGrupo,
  contarNoLeidosSuperadminTotal,
  marcarLeidosGrupo,
  marcarLeidosSuperadmin
};
