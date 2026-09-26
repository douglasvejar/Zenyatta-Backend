// =================================================================
// CHAT DE SOPORTE — un hilo por Grupo con el Súper-admin. No hay chats
// entre grupos, ni un grupo con más de un hilo: es 1 conversación por
// grupo_id, con mensajes de remitente 'grupo' o 'superadmin'.
// =================================================================
const db = require('../db');

// Tipos de adjunto aceptados (26-09-2026, "puede adjuntar archivos,
// fotos, videos e incluso mandar notas de voz") — cualquier imagen/video/
// audio (fotos, videos, notas de voz grabadas en el navegador) más los
// formatos de documento más comunes para "archivos". Cualquier otro mime
// type se rechaza para no terminar guardando algo inesperado como base64
// en la base de datos.
const TIPOS_ADJUNTO_PERMITIDOS = /^(image|video|audio)\//;
const TIPOS_DOCUMENTO_PERMITIDOS = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
]);
// Tope por adjunto (26-09-2026): este proyecto no tiene un servicio de
// almacenamiento de archivos aparte — el adjunto viaja como base64 dentro
// de la misma fila de mensajes_chat (mismo criterio que la captura de
// "💳 Pagos"). Base64 pesa ~33% más que el archivo real, así que 8MB de
// archivo original ya son ~10.9MB de texto — de sobra para fotos y notas
// de voz, ajustado para que un video tenga que ser cortito.
const TOPE_ADJUNTO_BASE64_CHARS = 11 * 1024 * 1024; // ~8MB de archivo real

function validarAdjunto(adjunto) {
  if (!adjunto) return null;
  const { datos, tipo, nombre } = adjunto;
  if (!datos || !tipo) {
    const err = new Error('El adjunto llegó incompleto — intenta adjuntarlo de nuevo.');
    err.status = 400;
    throw err;
  }
  const esMultimedia = TIPOS_ADJUNTO_PERMITIDOS.test(tipo);
  const esDocumento = TIPOS_DOCUMENTO_PERMITIDOS.has(tipo);
  if (!esMultimedia && !esDocumento) {
    const err = new Error('Ese tipo de archivo no se puede adjuntar (solo fotos, videos, audio y documentos comunes).');
    err.status = 400;
    throw err;
  }
  if (datos.length > TOPE_ADJUNTO_BASE64_CHARS) {
    const err = new Error('El archivo es muy pesado (máximo ~8MB) — probá con uno más liviano o un video más corto.');
    err.status = 400;
    throw err;
  }
  return { datos, tipo, nombre: nombre ? String(nombre).slice(0, 200) : 'archivo' };
}

async function enviarMensaje(grupoId, remitente, texto, adjunto) {
  const textoFinal = (texto || '').trim();
  const adjuntoFinal = validarAdjunto(adjunto);
  if (!textoFinal && !adjuntoFinal) {
    const err = new Error('Escribe un mensaje o adjunta algo antes de enviarlo.');
    err.status = 400;
    throw err;
  }
  const r = await db.query(
    `INSERT INTO mensajes_chat (grupo_id, remitente, texto, adjunto_datos, adjunto_tipo, adjunto_nombre)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, grupo_id, remitente, texto, adjunto_datos, adjunto_tipo, adjunto_nombre, creado_en`,
    [grupoId, remitente, textoFinal, adjuntoFinal ? adjuntoFinal.datos : null, adjuntoFinal ? adjuntoFinal.tipo : null, adjuntoFinal ? adjuntoFinal.nombre : null]
  );
  return r.rows[0];
}

async function listarMensajes(grupoId) {
  const r = await db.query(
    'SELECT id, remitente, texto, adjunto_datos, adjunto_tipo, adjunto_nombre, creado_en FROM mensajes_chat WHERE grupo_id = $1 ORDER BY creado_en ASC LIMIT 500',
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
