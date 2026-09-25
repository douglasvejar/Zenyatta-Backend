// Configuración propia del Grupo (18-09-2026, a pedido del usuario:
// "permiteme elegir si el grupo trabaja en dolares, bolivares o mixto").
// A diferencia del modelo de comisión (grupos.modelo_comision, que solo
// puede tocar el Súper-admin), la MONEDA del grupo la elige el propio
// Administrador — no hace falta pasar por Súper-admin. Exclusivo del
// Administrador (nunca un Empleado, aunque tenga el permiso "jugador")
// porque es una decisión estructural del negocio, no del día a día.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requiereGrupo, requiereAdministrador, monedaModoDe } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
// "Ajustes > Seguridad" (25-09-2026, a pedido del usuario) — ver la nota
// grande junto a password_visible_cifrada en sql/schema.sql.
const { cifrarClave } = require('../services/cifradoClave');

const router = express.Router();
router.use(requiereGrupo);

router.get('/moneda-modo', asyncHandler(async (req, res) => {
  res.json({ monedaModo: monedaModoDe(req) });
}));

router.put('/moneda-modo', requiereAdministrador, asyncHandler(async (req, res) => {
  const { monedaModo } = req.body || {};
  if (!['usd', 'bs', 'mixto'].includes(monedaModo)) {
    return res.status(400).json({ error: 'Moneda inválida (usa "usd", "bs" o "mixto").' });
  }

  // Si el grupo deja de ser "mixto" (vuelve a una moneda fija), todos los
  // clientes pasan a esa moneda fija de una vez — así el resto del
  // código puede confiar SIEMPRE en jugadores.moneda sin mirar antes el
  // modo del grupo (ver nota grande en sql/schema.sql). Si el grupo
  // ENTRA a "mixto", no se toca ningún cliente existente (todos quedan
  // con la moneda que ya tenían, que el Administrador puede ir
  // cambiando cliente por cliente desde la pestaña Jugador).
  if (monedaModo !== 'mixto') {
    await db.query('UPDATE jugadores SET moneda = $1 WHERE grupo_id = $2', [monedaModo.toUpperCase(), req.grupoId]);
  }

  const r = await db.query('UPDATE grupos SET moneda_modo = $1 WHERE id = $2 RETURNING moneda_modo', [monedaModo, req.grupoId]);
  res.json({ monedaModo: r.rows[0].moneda_modo });
}));

// "Ajustes > Seguridad" (25-09-2026, a pedido del usuario: "AL ENTRAR
// ALLI PUEDEN CAMBIAR LA CLAVE DE ACCESO DEL GRUPO") — el propio grupo
// cambia su clave de acceso, sin pasar por Súper-admin. Exclusivo del
// Administrador (nunca un Empleado, aunque tenga cualquier permiso — el
// mismo criterio que ya usa la gestión de Empleados, que tampoco es
// delegable). No se pide la clave ACTUAL para poder cambiarla: quien
// entra a esta pantalla ya probó ser el Administrador con su sesión
// vigente (mismo criterio que ya usa "💱 Moneda", arriba en este mismo
// archivo, para otro ajuste exclusivo del Administrador).
//
// Guarda tanto password_hash (bcrypt, lo único que de verdad valida el
// login) como password_visible_cifrada (cifrado reversible, para que el
// Súper-admin la pueda ver desde su panel — ver la nota grande junto a
// esa columna en sql/schema.sql). Cambiarla desde acá deja la clave
// visible para el Súper-admin de ahora en adelante, igual que si la
// hubiera restablecido él mismo.
router.patch('/password', requiereAdministrador, asyncHandler(async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'La contraseña nueva tiene que tener al menos 4 caracteres.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const passwordVisibleCifrada = cifrarClave(password);
  await db.query(
    'UPDATE grupos SET password_hash = $1, password_visible_cifrada = $2 WHERE id = $3',
    [passwordHash, passwordVisibleCifrada, req.grupoId]
  );
  res.status(204).end();
}));

module.exports = router;
