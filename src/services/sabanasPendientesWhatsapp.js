// =================================================================
// BANDEJA DE SÁBANAS PENDIENTES POR WHATSAPP (03-09-2026, a pedido del
// usuario: "existe alguna manera de que en mi chat de whatssap yo
// actualice la sabana y se cargue automatico en el sistema?").
//
// Este archivo es SOLO la capa de base de datos (guardar/listar/marcar) —
// a propósito no sabe nada de WhatsApp ni de la librería que se conecta
// (esa parte vive en whatsappBot.js, que este archivo ni siquiera
// requiere). Así este servicio se puede probar igual que cualquier otro
// del proyecto (con el mismo patrón de "pg" falso que ya usan
// papeleraSabana.js, historial.js, etc.), sin necesitar la librería de
// WhatsApp instalada — algo que en este entorno de trabajo no se pudo
// verificar (ver README.md).
//
// A propósito NO se conecta con la tabla "alertas" (que espera un campo
// "deporte" para poder resolverse desde ese panel) — esta bandeja tiene
// su propio panel en la pestaña Sábana.
//
// Actualización (03-09-2026, más tarde todavía, a pedido del usuario:
// "se cargue automatico"): ya NO hace falta que un humano apruebe cada
// mensaje — whatsappBot.js procesa cada "SABANA" al instante y esta
// bandeja queda como REGISTRO/auditoría de lo que pasó con cada
// mensaje: 'pendiente' (recién llegó, un instante antes de resolverse),
// 'importada' (se procesó bien), 'descartada' (ej. el día ya estaba
// cerrado con SABANA FINAL) o 'error' (procesarSabana() lanzó un error,
// ej. "no se detectaron apuestas válidas" — con el motivo en `nota`).
const db = require('./../db');

function mapFila(r) {
  return {
    id: r.id,
    grupoId: r.grupo_id,
    fechaDetectada: r.fecha_detectada instanceof Date
      ? r.fecha_detectada.toISOString().split('T')[0]
      : r.fecha_detectada,
    texto: r.texto,
    remitente: r.remitente,
    remitenteNombre: r.remitente_nombre,
    recibidoEn: r.recibido_en,
    estado: r.estado,
    nota: r.nota || null,
    procesadoEn: r.procesado_en
  };
}

const COLUMNAS = 'id, grupo_id, fecha_detectada, texto, remitente, remitente_nombre, recibido_en, estado, nota, procesado_en';

// Busca a qué grupo (tenant) pertenece un mensaje, por el JID del grupo
// de WhatsApp de donde vino. Devuelve null si ningún grupo tiene ese JID
// configurado en grupos.whatsapp_grupo_jid, O si ese grupo tiene el
// servicio APAGADO (whatsapp_habilitado = false) — en ambos casos el
// mensaje se ignora igual (04-09-2026, a pedido del usuario: "quiero
// desde super admin poder habilitar esta opcion o no a los grupos").
// Así, con solo apagar el interruptor desde Súper-admin alcanza para
// cortarle el servicio a un Grupo, sin tener que andar borrando el JID
// que ya tenía guardado.
async function grupoIdPorJid(jid) {
  if (!jid) return null;
  const res = await db.query('SELECT id FROM grupos WHERE whatsapp_grupo_jid = $1 AND whatsapp_habilitado = true', [jid]);
  return res.rows.length > 0 ? res.rows[0].id : null;
}

// Guarda un mensaje detectado como sábana en la bandeja de pendientes.
async function crearPendiente(grupoId, { texto, fechaDetectada, remitente, remitenteNombre }) {
  if (!grupoId) {
    const err = new Error('Falta el grupo.');
    err.status = 400;
    throw err;
  }
  if (!texto || !texto.trim()) {
    const err = new Error('El mensaje llegó vacío.');
    err.status = 400;
    throw err;
  }
  const res = await db.query(
    `INSERT INTO sabanas_pendientes_whatsapp (grupo_id, fecha_detectada, texto, remitente, remitente_nombre)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNAS}`,
    [grupoId, fechaDetectada || null, texto, remitente || null, remitenteNombre || null]
  );
  return mapFila(res.rows[0]);
}

// Lista las sábanas pendientes por WhatsApp de un grupo (las más nuevas
// primero). Por defecto solo las 'pendiente' — pasar incluirResueltas:true
// para ver también las ya importadas/descartadas (por ejemplo, para un
// historial).
async function listarPendientes(grupoId, { incluirResueltas } = {}) {
  const res = incluirResueltas
    ? await db.query(
        `SELECT ${COLUMNAS} FROM sabanas_pendientes_whatsapp WHERE grupo_id = $1 ORDER BY recibido_en DESC`,
        [grupoId]
      )
    : await db.query(
        `SELECT ${COLUMNAS} FROM sabanas_pendientes_whatsapp WHERE grupo_id = $1 AND estado = 'pendiente' ORDER BY recibido_en DESC`,
        [grupoId]
      );
  return res.rows.map(mapFila);
}

// Últimos N registros de la bandeja (cualquier estado) — para el panel
// de "actividad reciente de WhatsApp" (auditoría), sin importar si ya se
// resolvieron o no. `limite` acotado a un rango razonable para no traer
// miles de filas de golpe.
async function listarRecientes(grupoId, limite = 20) {
  const n = Math.max(1, Math.min(100, Number(limite) || 20));
  const res = await db.query(
    `SELECT ${COLUMNAS} FROM sabanas_pendientes_whatsapp WHERE grupo_id = $1 ORDER BY recibido_en DESC LIMIT ${n}`,
    [grupoId]
  );
  return res.rows.map(mapFila);
}

async function obtenerPendiente(grupoId, id) {
  const res = await db.query(
    `SELECT ${COLUMNAS} FROM sabanas_pendientes_whatsapp WHERE grupo_id = $1 AND id = $2`,
    [grupoId, id]
  );
  if (res.rows.length === 0) {
    const err = new Error('No se encontró ese mensaje pendiente (puede que ya se haya importado o descartado en otra pestaña).');
    err.status = 404;
    throw err;
  }
  return mapFila(res.rows[0]);
}

async function marcarImportada(grupoId, id) {
  const res = await db.query(
    `UPDATE sabanas_pendientes_whatsapp SET estado = 'importada', procesado_en = now()
     WHERE grupo_id = $1 AND id = $2 AND estado = 'pendiente'
     RETURNING ${COLUMNAS}`,
    [grupoId, id]
  );
  if (res.rows.length === 0) {
    const err = new Error('No se encontró ese mensaje pendiente (puede que ya se haya importado o descartado antes).');
    err.status = 404;
    throw err;
  }
  return mapFila(res.rows[0]);
}

async function descartarPendiente(grupoId, id, nota) {
  const res = await db.query(
    `UPDATE sabanas_pendientes_whatsapp SET estado = 'descartada', procesado_en = now(), nota = $3
     WHERE grupo_id = $1 AND id = $2 AND estado = 'pendiente'
     RETURNING ${COLUMNAS}`,
    [grupoId, id, nota || null]
  );
  if (res.rows.length === 0) {
    const err = new Error('No se encontró ese mensaje pendiente (puede que ya se haya importado o descartado antes).');
    err.status = 404;
    throw err;
  }
  return mapFila(res.rows[0]);
}

// Un intento de auto-importación que falló (ej. procesarSabana() lanzó
// "no se detectaron apuestas válidas") — se deja registrado con el motivo
// en `nota`, en vez de perderse en el log del servidor sin que el Grupo
// se entere (03-09-2026, más tarde todavía).
async function marcarError(grupoId, id, nota) {
  const res = await db.query(
    `UPDATE sabanas_pendientes_whatsapp SET estado = 'error', procesado_en = now(), nota = $3
     WHERE grupo_id = $1 AND id = $2 AND estado = 'pendiente'
     RETURNING ${COLUMNAS}`,
    [grupoId, id, nota || null]
  );
  if (res.rows.length === 0) {
    const err = new Error('No se encontró ese mensaje pendiente (puede que ya se haya importado o descartado antes).');
    err.status = 404;
    throw err;
  }
  return mapFila(res.rows[0]);
}

module.exports = {
  grupoIdPorJid,
  crearPendiente,
  listarPendientes,
  listarRecientes,
  obtenerPendiente,
  marcarImportada,
  descartarPendiente,
  marcarError
};
