// =================================================================
// LINK PÚBLICO DE "GRUPO DE CLIENTES" (30-09-2026, a pedido del
// usuario). Mismo criterio que routes/cliente.js: sin usuario/contraseña
// a propósito — el token largo e impredecible de grupos_clientes.token
// ES el acceso, igual que un link "no listado". Compartido entre
// Deportes e Hipismo: el módulo se resuelve solo con la propia fila de
// grupos_clientes (columna "modulo"), nunca hace falta que el link lo
// diga.
//
// Sin autenticación (no lleva requiereGrupo) — se monta en server.js
// SEPARADO de /api/grupos-clientes (el CRUD autenticado de Deportes) y
// de /api/hipismo/grupos-clientes (el CRUD autenticado de Hipismo), acá
// en /api/grupo-cliente (singular), para que no puedan confundirse ni
// colisionar rutas.
// =================================================================
const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { construirTarjetaPorToken } = require('../services/gruposClientes');

const router = express.Router();

router.get('/:token', asyncHandler(async (req, res) => {
  const tarjeta = await construirTarjetaPorToken(req.params.token);
  if (!tarjeta) return res.status(404).json({ error: 'Link inválido.' });
  return res.json(tarjeta);
}));

module.exports = router;
