// Administración > Polla (02-09-2026, a pedido del usuario) — ver
// src/services/polla.js para el formato de texto y la fórmula.
const express = require('express');
const { requiereGrupo } = require('../middleware/auth');
const pollaService = require('../services/polla');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);

// Lista lo guardado — sin filtro trae todo; se puede acotar con
// ?desde&hasta y/o ?cliente (mismo patrón que /api/reportes).
router.get('/', asyncHandler(async (req, res) => {
  const { desde, hasta, cliente } = req.query;
  const filas = await pollaService.leerPolla(req.grupoId, { desde, hasta, cliente });
  res.json(filas);
}));

// Pega el texto de la polla + la fecha -> lo interpreta y lo guarda
// (reemplaza lo que ya hubiera guardado para esa fecha, ver
// services/polla.js). Devuelve qué se guardó, qué nombre no matcheó
// ningún cliente registrado, y qué líneas del texto se ignoraron por no
// tener el formato "nombre monto" — para que el admin corrija y
// reprocese si hace falta.
router.post('/procesar', asyncHandler(async (req, res) => {
  try {
    const { texto, fecha } = req.body;
    if (!texto || !texto.trim()) {
      return res.status(400).json({ error: 'Pega el resultado de la polla antes de continuar.' });
    }
    const { filas, ignoradas } = pollaService.parsearResultadoPolla(texto);
    const resultado = await pollaService.guardarPolla(req.grupoId, fecha, filas);
    res.json({ ...resultado, ignoradas });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo procesar la polla.' });
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await pollaService.eliminarPolla(req.grupoId, req.params.id);
  res.status(204).end();
}));

module.exports = router;
