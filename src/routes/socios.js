// "🤝 Administrar Socios" (26-09-2026, a pedido del usuario) — grupos de
// clientes para el reporte "Saldos de Socios y sus Avalados", pestaña
// nueva DENTRO de "📅 Saldos Semana" (ver services/saldosSemana.js y
// routes/descargas.js: ese servicio ya deja en cada cliente su
// "socioId", y esta ruta es solo para crear/renombrar/borrar Socios y
// decidir qué clientes pertenecen a cada uno).
//
// Mismo permiso que Jugador ('jugador', ver PERMISOS_VALIDOS en
// middleware/auth.js — el comentario de esa constante ya dice "Jugador +
// Comisión propia + Avalados", administrar a qué Socio pertenece cada
// cliente es parte de lo mismo) — no hizo falta sumar un permiso nuevo.
const express = require('express');
const db = require('../db');
const { requiereGrupo, requierePermiso } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('jugador'));

// GET / — cada Socio con la lista de sus clientes (id + nombre), para
// pintar de una vez el modal "Administrar Socios" sin pedir 2 veces.
router.get('/', asyncHandler(async (req, res) => {
  const rSocios = await db.query('SELECT id, nombre FROM socios WHERE grupo_id = $1 ORDER BY nombre', [req.grupoId]);
  const rJugadores = await db.query(
    'SELECT id, nombre, socio_id FROM jugadores WHERE grupo_id = $1 AND socio_id IS NOT NULL ORDER BY nombre',
    [req.grupoId]
  );
  const socios = rSocios.rows.map(s => ({
    id: s.id,
    nombre: s.nombre,
    clientes: rJugadores.rows.filter(j => j.socio_id === s.id).map(j => ({ id: j.id, nombre: j.nombre }))
  }));
  res.json(socios);
}));

// POST / { nombre } — crea un Socio nuevo, todavía sin clientes.
router.post('/', asyncHandler(async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del socio.' });
  try {
    const r = await db.query(
      'INSERT INTO socios (grupo_id, nombre) VALUES ($1, $2) RETURNING id, nombre',
      [req.grupoId, nombre]
    );
    res.status(201).json({ id: r.rows[0].id, nombre: r.rows[0].nombre, clientes: [] });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un socio con ese nombre.' });
    throw e;
  }
}));

// PUT /:id { nombre } — renombra un Socio (sus clientes no se tocan).
router.put('/:id', asyncHandler(async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del socio.' });
  try {
    const r = await db.query(
      'UPDATE socios SET nombre = $1 WHERE id = $2 AND grupo_id = $3 RETURNING id, nombre',
      [nombre, req.params.id, req.grupoId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Socio no encontrado.' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un socio con ese nombre.' });
    throw e;
  }
}));

// DELETE /:id — borra el Socio; sus clientes NO se borran, solo quedan
// sin socio (socio_id vuelve a NULL, ver "on delete set null" en
// sql/schema.sql) y dejan de salir en el reporte agrupado hasta que se
// les asigne otro Socio.
router.delete('/:id', asyncHandler(async (req, res) => {
  const r = await db.query('DELETE FROM socios WHERE id = $1 AND grupo_id = $2 RETURNING id', [req.params.id, req.grupoId]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Socio no encontrado.' });
  res.json({ ok: true });
}));

// PUT /:id/clientes { jugadorIds: [...] } — reemplaza TODA la membresía
// de este Socio de una sola vez (el checklist del modal manda la lista
// completa de quién queda adentro, así se guarda en un solo click). Un
// cliente que estaba en OTRO socio y se marca acá se le cambia el
// socio_id sin que el operador tenga que ir a desmarcarlo allá primero.
router.put('/:id/clientes', asyncHandler(async (req, res) => {
  const rSocio = await db.query('SELECT id FROM socios WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  if (rSocio.rows.length === 0) return res.status(404).json({ error: 'Socio no encontrado.' });

  const jugadorIds = Array.isArray(req.body.jugadorIds) ? req.body.jugadorIds.filter(Boolean) : [];

  await db.query('UPDATE jugadores SET socio_id = NULL WHERE grupo_id = $1 AND socio_id = $2', [req.grupoId, req.params.id]);
  if (jugadorIds.length > 0) {
    await db.query(
      'UPDATE jugadores SET socio_id = $1 WHERE grupo_id = $2 AND id = ANY($3::uuid[])',
      [req.params.id, req.grupoId, jugadorIds]
    );
  }
  res.json({ ok: true });
}));

module.exports = router;
