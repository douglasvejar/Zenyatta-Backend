// =================================================================
// "GRUPO DE CLIENTES" — módulo Deportes (30-09-2026, a pedido del
// usuario). CRUD casi idéntico al que vive dentro de routes/hipismo.js
// (GET/POST /api/hipismo/grupos-clientes...) pero como archivo propio,
// montado en /api/grupos-clientes, con modulo='deportes' fijo — un grupo
// de Deportes y uno de Hipismo con el mismo titular son filas
// completamente aparte (confirmado con el usuario: "son cuadros
// independiente por modulo"), así que este archivo NUNCA importa nada
// de hipismo.js ni al revés; ambos solo comparten el mismo servicio
// services/gruposClientes.js (ver la nota grande ahí, y en
// sql/schema.sql junto a "create table grupos_clientes").
//
// El titular y los miembros se eligen del mismo listado de clientes de
// GET /api/jugadores (misma tabla jugadores, compartida entre los 2
// módulos). La tarjeta (GET /:id) trae saldo semana actual + semana
// anterior de respaldo, sin recalcular nada — reusa
// calcularBalanceSemanalPorCliente() (services/balanceGeneral.js), el
// mismo Balance General de siempre.
//
// El link público equivalente (sin login) es GET /api/grupo-cliente/:token,
// compartido con Hipismo (ver src/routes/gruposClientesPublico.js).
// =================================================================
const express = require('express');
const { requiereGrupo, requierePermiso } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const {
  crearGrupoCliente,
  listarGruposClientes,
  eliminarGrupoCliente,
  agregarMiembro,
  quitarMiembro,
  construirTarjetaGrupoCliente
} = require('../services/gruposClientes');

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('jugador'));

router.get('/', asyncHandler(async (req, res) => {
  const grupos = await listarGruposClientes(req.grupoId, 'deportes');
  return res.json({ grupos });
}));

router.post('/', asyncHandler(async (req, res) => {
  const titularId = (req.body.titularId || '').toString().trim();
  if (!titularId) return res.status(400).json({ error: 'Falta el cliente titular.' });
  const resultado = await crearGrupoCliente(req.grupoId, 'deportes', titularId);
  if (!resultado.ok) return res.status(404).json({ error: 'Ese cliente titular no existe en este grupo.' });
  return res.status(201).json({ grupoCliente: resultado.grupoCliente });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const tarjeta = await construirTarjetaGrupoCliente(req.params.id, req.grupoId, 'deportes');
  if (!tarjeta) return res.status(404).json({ error: 'Grupo de clientes no encontrado.' });
  return res.json(tarjeta);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const borrado = await eliminarGrupoCliente(req.grupoId, 'deportes', req.params.id);
  if (!borrado) return res.status(404).json({ error: 'Grupo de clientes no encontrado.' });
  return res.json({ ok: true });
}));

router.post('/:id/miembros', asyncHandler(async (req, res) => {
  const jugadorId = (req.body.jugadorId || '').toString().trim();
  if (!jugadorId) return res.status(400).json({ error: 'Falta el cliente a agregar.' });
  const resultado = await agregarMiembro(req.grupoId, 'deportes', req.params.id, jugadorId);
  if (!resultado.ok) return res.status(404).json({ error: resultado.motivo === 'cliente_no_encontrado' ? 'Ese cliente no existe en este grupo.' : 'Grupo de clientes no encontrado.' });
  return res.json({ ok: true });
}));

router.delete('/:id/miembros/:jugadorId', asyncHandler(async (req, res) => {
  const resultado = await quitarMiembro(req.grupoId, 'deportes', req.params.id, req.params.jugadorId);
  if (!resultado.ok) return res.status(404).json({ error: 'Grupo de clientes no encontrado.' });
  return res.json({ ok: true });
}));

module.exports = router;
