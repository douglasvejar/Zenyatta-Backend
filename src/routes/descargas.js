// =================================================================
// "⬇️ Descargar" (21-09-2026, a pedido del usuario): pestaña nueva del
// panel del Grupo, aparte de "📒 Balance General", para bajar un reporte
// semanal cliente-por-cliente/día-por-día listo para mandar por WhatsApp
// — como imagen en alta resolución ("📅 Saldos Semana"), como Excel (con
// las columnas que el usuario elija) o como PDF. La generación en sí es
// 100% del navegador (html2canvas/jsPDF/SheetJS, mismo patrón que ya usan
// Balance General y Sábanas) — esta ruta solo devuelve los números ya
// armados (ver services/saldosSemana.js, que hace toda la cuenta real).
//
// Mismo permiso ('descargar', ver PERMISOS_VALIDOS en middleware/auth.js)
// para las 2 sub-secciones de esta pestaña — no hace falta separarlo más
// fino, es una sola pantalla de solo lectura.
// =================================================================
const express = require('express');
const { requiereGrupo, requierePermiso } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { construirSaldosSemana } = require('../services/saldosSemana');

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('descargar'));

// ?fecha=YYYY-MM-DD (opcional, cualquier día DENTRO de la semana que se
// quiere ver — se usa para las flechitas "◀ Semana anterior"/"Semana
// siguiente ▶" del frontend, que solo le restan/suman 7 días a la fecha
// actual y vuelven a pedir). Sin ?fecha, es la semana actual (según la
// fecha de HOY en Venezuela, ver fechaVenezuela.js).
router.get('/saldos-semana', asyncHandler(async (req, res) => {
  const datos = await construirSaldosSemana(req.grupoId, req.grupo.nombre, req.grupo.logo_url, req.query.fecha);
  res.json(datos);
}));

module.exports = router;
