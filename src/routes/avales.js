const express = require('express');
const db = require('../db');
const { requiereGrupo } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);

router.get('/', asyncHandler(async (req, res) => {
  const r = await db.query(
    `SELECT a.id, a.porcentaje, ja.nombre AS avalador, jb.nombre AS avalado, a.avalador_id, a.avalado_id
     FROM avales a
     JOIN jugadores ja ON ja.id = a.avalador_id
     JOIN jugadores jb ON jb.id = a.avalado_id
     WHERE a.grupo_id = $1 ORDER BY ja.nombre, jb.nombre`,
    [req.grupoId]
  );
  res.json(r.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  try {
    const { avaladorId, avaladoId, porcentaje } = req.body;
    if (!avaladorId || !avaladoId) return res.status(400).json({ error: 'Falta el avalador o el avalado.' });
    if (avaladorId === avaladoId) return res.status(400).json({ error: 'Un jugador no puede avalarse a sí mismo.' });
    if (isNaN(Number(porcentaje))) return res.status(400).json({ error: 'Ingresa un % válido.' });

    const r = await db.query(
      `INSERT INTO avales (grupo_id, avalador_id, avalado_id, porcentaje) VALUES ($1, $2, $3, $4)
       ON CONFLICT (avalador_id, avalado_id) DO UPDATE SET porcentaje = EXCLUDED.porcentaje
       RETURNING *`,
      [req.grupoId, avaladorId, avaladoId, Number(porcentaje)]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar el aval.' });
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM avales WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  res.status(204).end();
}));

module.exports = router;
