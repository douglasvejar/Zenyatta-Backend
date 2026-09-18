const express = require('express');
const { requiereGrupo, requierePermiso } = require('../middleware/auth');
const transferenciasService = require('../services/transferencias');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('transferencias'));

router.get('/', asyncHandler(async (req, res) => {
  res.json(await transferenciasService.listarTransferencias(req.grupoId));
}));

router.post('/', asyncHandler(async (req, res) => {
  try {
    const { fecha, clienteOrigen, clienteDestino, monto, nota } = req.body;
    const t = await transferenciasService.crearTransferencia(req.grupoId, {
      fecha: fecha || new Date().toISOString().split('T')[0],
      clienteOrigen, clienteDestino, monto: Number(monto), nota
    });
    res.status(201).json(t);
  } catch (e) {
    // Errores de VALIDACIÓN (origen==destino, monto inválido, etc, ver
    // services/transferencias.js) siguen siendo 400 aquí adentro — el
    // asyncHandler de afuera solo atrapa lo que se escape sin querer
    // (ej. la propia conexión a la base de datos cayéndose).
    res.status(400).json({ error: e.message });
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await transferenciasService.eliminarTransferencia(req.grupoId, req.params.id);
  res.status(204).end();
}));

module.exports = router;
