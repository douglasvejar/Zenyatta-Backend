// =================================================================
// Ruta PÚBLICA (sin login) — logros (moneyline) automáticos para la
// Calculadora Parley de mercadeo (public/calculadora-parley.html,
// 01-10-2026). Mismo criterio que routes/contacto.js: todavía no es
// cliente de nadie, es cualquiera que entra a probar la calculadora.
//
// GET /juegos siempre responde 200, incluso sin ODDS_API_KEY
// configurada o sin ningún juego cargado todavía — la calculadora JAMÁS
// se cae por esto, simplemente avisa que toca escribir los logros a
// mano (ver cpCargarJuegos() en calculadora-parley.html).
// =================================================================
const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requiereSuperadmin } = require('../middleware/auth');
const { obtenerLogrosVigentes, refrescarLogrosParley } = require('../services/parleyLogros');

const router = express.Router();

router.get('/juegos', asyncHandler(async (req, res) => {
  const { juegos, actualizadoHaceMinutos } = await obtenerLogrosVigentes();
  res.json({ juegos, actualizadoHaceMinutos });
}));

// Disparo manual (Súper-admin) — útil para probar la conexión con The
// Odds API sin tener que esperar a la próxima corrida automática del
// intervalo (ver ODDS_API_INTERVALO_MINUTOS en .env.example).
router.post('/refrescar', requiereSuperadmin, asyncHandler(async (req, res) => {
  const resultado = await refrescarLogrosParley();
  res.json(resultado);
}));

module.exports = router;
