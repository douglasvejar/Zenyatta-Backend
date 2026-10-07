// =================================================================
// erroresServidor.js (07-10-2026) — REGISTRO DE ERRORES DEL SERVIDOR.
// Pedido (punto 8): enterarse de que algo falló sin esperar a que un usuario
// lo reporte. server.js llama a registrarError() desde el manejador global
// de errores (el mismo que responde 500/503): guarda ruta, grupo, usuario y
// las primeras líneas del stack en errores_servidor. NUNCA rompe nada: si
// guardar el error falla (por ejemplo la base está caída), solo queda en el
// log de consola. Súper-admin ve los de todos los grupos; cada grupo, los
// suyos. Se limpian solos a los 30 días (ver hipismoCuadreNocturno.js).
// =================================================================
const db = require('../db');

const MAX_MENSAJE = 500;
const MAX_DETALLE = 1500;

async function registrarError(req, err, estado) {
  try {
    const mensaje = String((err && err.message) || err || 'Error desconocido').slice(0, MAX_MENSAJE);
    const detalle = err && err.stack ? String(err.stack).split('\n').slice(0, 8).join('\n').slice(0, MAX_DETALLE) : null;
    const ruta = req && (req.originalUrl || req.url) ? String(req.originalUrl || req.url).split('?')[0].slice(0, 300) : null;
    await db.query(
      `INSERT INTO errores_servidor (grupo_id, usuario, metodo, ruta, estado, mensaje, detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [(req && req.grupoId) || null, (req && req.nombreActor) || null, (req && req.method) || null, ruta, estado || 500, mensaje, detalle]
    );
  } catch (e) {
    console.error('[errores] no se pudo guardar el error en la base:', e.message);
  }
}

// grupoId opcional: con grupoId solo los de ese grupo; sin él, todos
// (Súper-admin). Más recientes primero.
async function listarErrores({ grupoId, limite } = {}) {
  const lim = Math.min(Math.max(parseInt(limite, 10) || 100, 1), 300);
  if (grupoId) {
    const r = await db.query(
      `SELECT id, grupo_id, usuario, metodo, ruta, estado, mensaje, detalle, creado_en
         FROM errores_servidor WHERE grupo_id = $1 ORDER BY creado_en DESC LIMIT $2`, [grupoId, lim]);
    return r.rows;
  }
  const r = await db.query(
    `SELECT e.id, e.grupo_id, g.nombre AS grupo_nombre, e.usuario, e.metodo, e.ruta, e.estado, e.mensaje, e.detalle, e.creado_en
       FROM errores_servidor e LEFT JOIN grupos g ON g.id = e.grupo_id
      ORDER BY e.creado_en DESC LIMIT $1`, [lim]);
  return r.rows;
}

module.exports = { registrarError, listarErrores };
