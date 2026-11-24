// Ruta PÚBLICA (sin login) — el formulario "Contacto" del portal de
// bienvenida (public/index.html) manda acá el mensaje de quien pregunta
// por el servicio. Se guarda en mensajes_contacto para que Súper-admin lo
// vea en su bandeja (ver GET /api/superadmin/mensajes-contacto, en
// routes/superadmin.js). No requiere login a propósito: todavía no es
// cliente de nadie, es alguien que recién quiere contratar.
const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { avisarMensajeContacto } = require('../services/telegramBot');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, contacto, mensaje } = req.body || {};

  if (!contacto || !String(contacto).trim()) {
    return res.status(400).json({ error: 'Dejanos un email o teléfono para poder responderte.' });
  }
  if (!mensaje || !String(mensaje).trim()) {
    return res.status(400).json({ error: 'Escribe tu mensaje.' });
  }

  const { rows } = await db.query(
    `INSERT INTO mensajes_contacto (nombre, contacto, mensaje) VALUES ($1, $2, $3)
     RETURNING id, nombre, contacto, mensaje`,
    [
      nombre ? String(nombre).trim().slice(0, 200) : null,
      String(contacto).trim().slice(0, 200),
      String(mensaje).trim().slice(0, 2000)
    ]
  );

  res.json({ ok: true });
  avisarMensajeContacto(rows[0]).catch(e => {
    console.error('[contacto] No se pudo entregar el aviso a Telegram:', e.message);
  });
}));

module.exports = router;
