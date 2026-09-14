// Login del rol "Grupo" (administrador del negocio de apuestas).
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { firmarSesionGrupo } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan email o password.' });

  const r = await db.query('SELECT * FROM grupos WHERE email = $1', [email]);
  const grupo = r.rows[0];
  if (!grupo) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

  const ok = await bcrypt.compare(password, grupo.password_hash);
  if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

  if (!grupo.activo) return res.status(403).json({ error: 'Esta cuenta todavía no está activada. Contacta al administrador de la plataforma.' });

  // Registra el último inicio de sesión (fecha/hora, IP, y el navegador/SO
  // que reportó el propio navegador vía User-Agent) — lo usa la pantalla
  // de detalle de Súper-admin (ver src/routes/superadmin.js). No bloquea
  // el login si esto falla por algún motivo raro: es un UPDATE aparte, no
  // se espera (await) ni se mete en el camino crítico de responder al login.
  db.query(
    'UPDATE grupos SET ultimo_login_en = now(), ultimo_login_ip = $1, ultimo_login_user_agent = $2 WHERE id = $3',
    [req.ip || null, req.headers['user-agent'] || null, grupo.id]
  ).catch(e => console.error('No se pudo registrar el último login (no afecta el login en sí):', e.message));

  const token = firmarSesionGrupo(grupo);
  res.json({ token, grupo: { id: grupo.id, nombre: grupo.nombre, email: grupo.email } });
}));

module.exports = router;
