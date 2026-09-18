// Administración > Empleados (18-09-2026, a pedido del usuario:
// "soluciona la cuentas separas por empleado dentro de un grupo... un
// administrador que tiene acceso 100% y los empleados puedes elegir que
// pueden o no hacer, ya que quizas hay empleados de mas confianza con
// acceso a mas cosas que otro"). Ver la nota grande en sql/schema.sql
// (tabla "empleados") y en middleware/auth.js (PERMISOS_VALIDOS).
//
// EXCLUSIVO del Administrador (requiereAdministrador, además de
// requiereGrupo) — un Empleado, sin importar qué permisos tenga, nunca
// puede crear/editar/borrar otro empleado ni verse a sí mismo en esta
// lista. Así se evita que un empleado se pueda dar a sí mismo (o a otro)
// más acceso del que el Administrador le dio.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requiereGrupo, requiereAdministrador, normalizarPermisos, PERMISOS_VALIDOS } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);
router.use(requiereAdministrador);

function sinClave(fila) {
  const { password_hash, ...resto } = fila;
  return resto;
}

router.get('/', asyncHandler(async (req, res) => {
  const r = await db.query(
    'SELECT id, grupo_id, nombre, email, activo, permisos, creado_en, ultimo_login_en FROM empleados WHERE grupo_id = $1 ORDER BY nombre',
    [req.grupoId]
  );
  res.json(r.rows);
}));

// Lista de claves válidas de permisos, para que el frontend arme el
// checklist sin tener que copiarla a mano en el HTML/JS.
router.get('/permisos-disponibles', asyncHandler(async (req, res) => {
  res.json(PERMISOS_VALIDOS);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, email, password, permisos } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del empleado.' });
  if (!email || !email.trim()) return res.status(400).json({ error: 'Falta el email del empleado.' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });

  try {
    const hash = await bcrypt.hash(String(password), 10);
    const r = await db.query(
      `INSERT INTO empleados (grupo_id, nombre, email, password_hash, permisos)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, grupo_id, nombre, email, activo, permisos, creado_en`,
      [req.grupoId, nombre.trim(), email.trim().toLowerCase(), hash, JSON.stringify(normalizarPermisos(permisos))]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una cuenta (Grupo o Empleado) con ese email.' });
    throw e;
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { nombre, email, activo, permisos, password } = req.body || {};
  const campos = [];
  const params = [];

  if (nombre !== undefined) { params.push(nombre.trim()); campos.push('nombre = $' + params.length); }
  if (email !== undefined) { params.push(email.trim().toLowerCase()); campos.push('email = $' + params.length); }
  if (activo !== undefined) { params.push(!!activo); campos.push('activo = $' + params.length); }
  if (permisos !== undefined) { params.push(JSON.stringify(normalizarPermisos(permisos))); campos.push('permisos = $' + params.length); }
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    const hash = await bcrypt.hash(String(password), 10);
    params.push(hash);
    campos.push('password_hash = $' + params.length);
  }
  if (campos.length === 0) return res.status(400).json({ error: 'No hay nada para actualizar.' });

  params.push(req.params.id, req.grupoId);
  try {
    const r = await db.query(
      `UPDATE empleados SET ${campos.join(', ')} WHERE id = $${params.length - 1} AND grupo_id = $${params.length}
       RETURNING id, grupo_id, nombre, email, activo, permisos, creado_en`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empleado no encontrado.' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una cuenta (Grupo o Empleado) con ese email.' });
    throw e;
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM empleados WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  res.status(204).end();
}));

module.exports = router;
