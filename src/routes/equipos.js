// Administración de "Registrar Equipo o Apodo Nuevo" (equipos_personalizados)
// — el diccionario BASE (30 equipos de MLB) vive en código
// (src/services/diccionarioEquipos.js) y es igual para todos los grupos;
// esta tabla solo guarda los apodos EXTRA que cada grupo agregue a mano,
// exactamente igual que el localStorage "zenyatta_diccionario" de la app
// original, pero aislado por grupo.
const express = require('express');
const db = require('../db');
const { requiereGrupo, requierePermiso } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('equipos'));

router.get('/', asyncHandler(async (req, res) => {
  const r = await db.query(
    'SELECT id, apodo, nombre_oficial, deporte FROM equipos_personalizados WHERE grupo_id = $1 ORDER BY apodo',
    [req.grupoId]
  );
  res.json(r.rows);
}));

// GET /api/equipos/nombres-oficiales/:deporte — nombres oficiales reales de
// los equipos de un deporte, para el autocompletado de "Registrar Equipo o
// Apodo Nuevo" (ver actualizarDatalistEquiposOficiales() en public/app.js).
// Se pide DESDE EL BACKEND, no directo desde el navegador a la API externa,
// porque el navegador del usuario reportó (28-08-2026) que el datalist solo
// mostraba nombres para MLB: la API "oculta" de ESPN que usa NFL no deja que
// un navegador le pegue directo (CORS) — el fetch fallaba en silencio
// (quedaba atrapado en el try/catch de cargarNombresOficialesDeporte() en
// app.js) y el datalist se quedaba vacío para NFL. El backend, en cambio,
// no tiene esa restricción — es el mismo patrón que ya usa la Pizarra en
// Vivo para traer el marcador de NFL/NHL/fútbol.
router.get('/nombres-oficiales/:deporte', asyncHandler(async (req, res) => {
  const deporte = (req.params.deporte || '').toLowerCase();
  let nombres = [];
  try {
    if (deporte === 'mlb') {
      const r = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Yes');
      const json = await r.json();
      nombres = (json.teams || []).map(t => t.name).filter(Boolean);
    } else if (deporte === 'nfl') {
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40');
      const json = await r.json();
      const equipos = (json.sports && json.sports[0] && json.sports[0].leagues && json.sports[0].leagues[0] && json.sports[0].leagues[0].teams) || [];
      nombres = equipos.map(e => e.team && e.team.displayName).filter(Boolean);
    } else if (deporte === 'nhl') {
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams?limit=40');
      const json = await r.json();
      const equipos = (json.sports && json.sports[0] && json.sports[0].leagues && json.sports[0].leagues[0] && json.sports[0].leagues[0].teams) || [];
      nombres = equipos.map(e => e.team && e.team.displayName).filter(Boolean);
    } else if (deporte === 'basket') {
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=40');
      const json = await r.json();
      const equipos = (json.sports && json.sports[0] && json.sports[0].leagues && json.sports[0].leagues[0] && json.sports[0].leagues[0].teams) || [];
      nombres = equipos.map(e => e.team && e.team.displayName).filter(Boolean);
    } else if (deporte === 'ncaaf') {
      // NCAAF tiene ~130 equipos de División I FBS (contra 32 de NFL) — a
      // diferencia de las demás ligas de acá, un límite chico se quedaría
      // corto, así que se pide bien alto. Mismo formato de respuesta que
      // NFL/NHL/basket (misma API de ESPN, ver ncaafApi.js).
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=400');
      const json = await r.json();
      const equipos = (json.sports && json.sports[0] && json.sports[0].leagues && json.sports[0].leagues[0] && json.sports[0].leagues[0].teams) || [];
      nombres = equipos.map(e => e.team && e.team.displayName).filter(Boolean);
    } else if (deporte === 'soccer') {
      // Fútbol no es UNA liga — son las 10 competiciones de LIGAS_SOCCER
      // (soccerApi.js). Se piden todas EN PARALELO y se combinan/deduplican
      // en una sola lista alfabética — mismo espíritu que ya usa
      // obtenerResultadosSoccer() para los resultados en vivo.
      const { LIGAS_SOCCER } = require('../services/soccerApi');
      const respuestas = await Promise.all(LIGAS_SOCCER.map(liga =>
        fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/' + liga.slug + '/teams?limit=50')
          .then(r => r.json())
          .catch(() => null)
      ));
      const setNombres = new Set();
      respuestas.forEach(json => {
        if (!json) return;
        const equipos = (json.sports && json.sports[0] && json.sports[0].leagues && json.sports[0].leagues[0] && json.sports[0].leagues[0].teams) || [];
        equipos.forEach(e => {
          const nombre = e.team && e.team.displayName;
          if (nombre) setNombres.add(nombre);
        });
      });
      nombres = Array.from(setNombres);
    }
    // Cualquier otro deporte sin API conectada: `nombres` se queda en []
    // a propósito, no es un error.
  } catch (e) {
    console.error('No se pudo cargar nombres oficiales de "' + deporte + '":', e);
    // Si la API externa falla (ej. sin internet, o ESPN/MLB caídos un
    // instante), se responde igual con una lista vacía en vez de un 500 —
    // el usuario puede seguir escribiendo el nombre a mano mientras tanto.
  }
  res.json({ deporte, nombres: nombres.sort() });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { apodo, nombreOficial, deporte } = req.body;
  if (!apodo || !apodo.trim() || !nombreOficial || !nombreOficial.trim()) {
    return res.status(400).json({ error: 'Ingresa tanto el apodo como el nombre oficial.' });
  }
  const r = await db.query(
    `INSERT INTO equipos_personalizados (grupo_id, apodo, nombre_oficial, deporte)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (grupo_id, apodo) DO UPDATE SET nombre_oficial = EXCLUDED.nombre_oficial, deporte = EXCLUDED.deporte
     RETURNING id, apodo, nombre_oficial, deporte`,
    [req.grupoId, apodo.trim().toLowerCase(), nombreOficial.trim(), deporte || 'mlb']
  );
  res.status(201).json(r.rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM equipos_personalizados WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  res.status(204).end();
}));

module.exports = router;
