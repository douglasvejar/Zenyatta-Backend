// Autenticación liviana para la Fase 0: JWT propio (no el Auth de
// Supabase) firmado con JWT_SECRET, guardando solo el id del grupo. Es
// deliberadamente simple — sirve perfecto para "un Grupo entra con su
// usuario y contraseña", y se puede reemplazar más adelante por el Auth
// de Supabase sin tocar el resto de las rutas (todas leen req.grupoId).
const jwt = require('jsonwebtoken');
const db = require('../db');

function firmarSesionGrupo(grupo) {
  return jwt.sign({ grupoId: grupo.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// Exige "Authorization: Bearer <token>" con un JWT válido de un grupo
// ACTIVO. Si el grupo fue desactivado por el súper-admin (interruptor
// manual), el token deja de servir aunque todavía no haya expirado.
async function requiereGrupo(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Falta el token de sesión (inicia sesión primero).' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // whatsapp_grupo_jid/whatsapp_habilitado van en el SELECT (03-09-2026,
    // más tarde todavía; whatsapp_habilitado agregado 04-09-2026) porque
    // routes/whatsapp.js necesita req.grupo.whatsapp_grupo_jid para saber
    // a qué JID mandarle el botón manual "Enviar resumen ahora", y
    // req.grupo.whatsapp_habilitado para saber si este Grupo compró el
    // servicio de sábana automática (interruptor que solo prende/apaga el
    // Súper-admin, ver sql/schema.sql) — sin esto quedaban siempre
    // undefined, aunque las columnas sí tuvieran el dato guardado.
    // whatsapp_modo_cuidadoso (18-09-2026, tras el cierre de cuenta de
    // WhatsApp del usuario) por el mismo motivo: routes/whatsapp.js (GET
    // /estado) lo expone de solo lectura en el panel del Grupo, para que
    // se entienda por qué el resumen ya no se manda solo.
    const res2 = await db.query('SELECT id, nombre, email, activo, whatsapp_grupo_jid, whatsapp_habilitado, whatsapp_modo_cuidadoso FROM grupos WHERE id = $1', [payload.grupoId]);
    const grupo = res2.rows[0];
    if (!grupo) return res.status(401).json({ error: 'Sesión inválida.' });
    if (!grupo.activo) return res.status(403).json({ error: 'Esta cuenta está desactivada. Contacta al administrador de la plataforma.' });

    req.grupoId = grupo.id;
    req.grupo = grupo;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o vencida.' });
  }
}

// Exige el secreto de súper-admin (vos) en "Authorization: Bearer <SUPERADMIN_SECRET>".
function requiereSuperadmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || token !== process.env.SUPERADMIN_SECRET) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  next();
}

module.exports = { firmarSesionGrupo, requiereGrupo, requiereSuperadmin };
