// =================================================================
// VISTA PÚBLICA DEL CLIENTE — Módulo Hipismo (22-09-2026, a pedido del
// usuario: "ya los clientes que tienen jugadas o los que se van a crear
// a futuro necesito tengan su link para ver sus saldos.... link sin
// clave ni nada solo entraran al link compartido que se lo daremos
// nosotros al darle click en copiar link, y veran sus jugadas
// semanales, o semana anterior").
//
// Mismo criterio EXACTO que ya usa Deportes en routes/cliente.js: sin
// login, el token largo e impredecible de la tabla "jugadores" (columna
// ya existente, pensada justo para esto — ver el comentario "link
// individual del cliente" en sql/schema.sql) ES el acceso, igual que un
// link "no listado". Cualquiera con el link ve SOLO los datos de ESE
// jugador en Hipismo, y de Deportes SOLO si el Administrador prendió
// jugadores.modulos_anclados para ese cliente puntual.
//
// 24-09-2026: el armado de la respuesta (día > hipódromo > carreras, con
// Deportes "anclado" si aplica) se movió a
// services/hipismoResumenCliente.js — a pedido del usuario, la nueva
// pantalla del Administrador "Saldos > Detallado por Cliente"
// (GET /api/hipismo/clientes/:nombre/detalle-semana en routes/hipismo.js)
// necesita construir EXACTAMENTE esta misma respuesta para un cliente
// puntual, buscado por nombre en vez de por token — se reusa la misma
// función en vez de duplicar la lógica, así las 2 vistas NUNCA pueden
// desviarse una de la otra.
const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { construirResumenClienteHipismo } = require('../services/hipismoResumenCliente');

const router = express.Router();

router.get('/:token', asyncHandler(async (req, res) => {
  const rJugador = await db.query('SELECT * FROM jugadores WHERE token = $1', [req.params.token]);
  const jugador = rJugador.rows[0];
  if (!jugador) return res.status(404).json({ error: 'Link inválido.' });

  const rGrupo = await db.query('SELECT activo, nombre, logo_url, modulo_hipismo_habilitado, modulo_deportes_habilitado FROM grupos WHERE id = $1', [jugador.grupo_id]);
  const grupo = rGrupo.rows[0];
  if (!grupo || !grupo.activo) {
    return res.status(403).json({ error: 'Esta cuenta no está disponible en este momento.' });
  }
  if (!grupo.modulo_hipismo_habilitado) {
    return res.status(403).json({ error: 'El módulo de Hipismo no está disponible para este grupo.' });
  }

  const resultado = await construirResumenClienteHipismo(jugador, grupo, req.query.semana);
  res.json(resultado);
}));

module.exports = router;
