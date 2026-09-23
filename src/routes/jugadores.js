// Administración > Jugador (registro fijo de clientes, % propio, tipo de
// cuenta libre/avalado y su pozo) + Avales ("Avalados por").
const express = require('express');
const db = require('../db');
const { requiereGrupo, requierePermiso, monedaModoDe } = require('../middleware/auth');
const { calcularPozoJugador } = require('../services/pozo');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('jugador'));

// Resuelve la moneda a guardar para un cliente (18-09-2026, "moneda del
// grupo" — ver la nota grande en sql/schema.sql). Si el grupo está fijo
// en 'usd' o 'bs', SIEMPRE se guarda esa moneda fija, sin importar lo
// que mande el formulario (así nunca queda un cliente "suelto" en la
// moneda equivocada por un dato viejo del navegador). Si el grupo está
// en 'mixto', se respeta lo que elija el Administrador al crear/editar
// ese cliente puntual (USD por default si no manda nada).
function resolverMonedaJugador(monedaModoGrupo, monedaPedida) {
  if (monedaModoGrupo !== 'mixto') return monedaModoGrupo.toUpperCase();
  return monedaPedida === 'BS' ? 'BS' : 'USD';
}

router.get('/', asyncHandler(async (req, res) => {
  const r = await db.query('SELECT * FROM jugadores WHERE grupo_id = $1 ORDER BY nombre', [req.grupoId]);
  const conPozo = await Promise.all(r.rows.map(async j => {
    const pozo = j.tipo_cuenta === 'avalado' ? await calcularPozoJugador(req.grupoId, j) : null;
    return { ...j, pozo };
  }));
  res.json(conPozo);
}));

// Valida/normaliza "modeloComision" para crear/editar un jugador
// (09-09-2026, "grupo mixto" — a pedido del usuario: "se puede tener un
// modelo de % en un grupo mixto... clientes que se le regrese % variados
// dependiendo de las patas de las jugadas... o establecerle % fijo por
// cualquier tipo de jugada etc" / "puedo elegir cualquier tipo de % o sin
// %" — ver la nota grande en sql/schema.sql, columna jugadores.
// modelo_comision). A diferencia del modelo/niveles DEFAULT del grupo
// (grupos.modelo_comision/comision_tiers, exclusivo de Súper-admin), esta
// excepción POR JUGADOR la carga el propio GRUPO, igual que ya carga
// comision_propia — no hace falta pasar por Súper-admin para marcar "este
// cliente puntual cobra distinto".
//   - null / undefined / '' / 'heredado' -> null (hereda el modelo
//     DEFAULT del grupo, sin excepción — es el valor de siempre).
//   - 'plano' -> este jugador SIEMPRE usa su propio % (comisionPropia,
//     que puede ser 0 = "sin %"), sin importar el modelo del grupo.
//   - 'por_tipo_jugada' -> este jugador SIEMPRE cobra según los niveles
//     del GRUPO (grupos.comision_tiers), sin importar el modelo del
//     grupo — hace falta que el grupo tenga al menos 1 nivel cargado
//     desde Súper-admin para que esto tenga efecto real (si no hay
//     niveles, simplemente no calza ninguno y cobra 0%, ver
//     comisiones.js).
function normalizarModeloComisionJugador(valor) {
  if (valor === 'plano' || valor === 'por_tipo_jugada') return valor;
  return null;
}

router.post('/', asyncHandler(async (req, res) => {
  try {
    const { nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del jugador.' });
    const tipo = tipoCuenta === 'avalado' ? 'avalado' : 'libre';
    const monedaFinal = resolverMonedaJugador(monedaModoDe(req), moneda);
    const r = await db.query(
      `INSERT INTO jugadores (grupo_id, nombre, telefono, notas, activo, tipo_cuenta, pozo_inicial, comision_propia, modelo_comision, moneda, modulos_anclados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [req.grupoId, nombre.trim().toUpperCase(), telefono || null, notas || null, activo !== false, tipo,
        tipo === 'avalado' ? (Number(pozoInicial) || 0) : 0, Number(comisionPropia) || 0, normalizarModeloComisionJugador(modeloComision), monedaFinal, !!modulosAnclados]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un jugador con ese nombre en este grupo.' });
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear el jugador.' });
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  try {
    const { nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados } = req.body;
    const tipo = tipoCuenta === 'avalado' ? 'avalado' : 'libre';
    const monedaFinal = resolverMonedaJugador(monedaModoDe(req), moneda);
    const r = await db.query(
      `UPDATE jugadores SET nombre = $1, telefono = $2, notas = $3, activo = $4, tipo_cuenta = $5,
         pozo_inicial = $6, comision_propia = $7, modelo_comision = $8, moneda = $9, auto_creado = false, modulos_anclados = $10
       WHERE id = $11 AND grupo_id = $12 RETURNING *`,
      [nombre.trim().toUpperCase(), telefono || null, notas || null, activo !== false, tipo,
        tipo === 'avalado' ? (Number(pozoInicial) || 0) : 0, Number(comisionPropia) || 0, normalizarModeloComisionJugador(modeloComision), monedaFinal, !!modulosAnclados, req.params.id, req.grupoId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Jugador no encontrado.' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un jugador con ese nombre en este grupo.' });
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar el jugador.' });
  }
}));

// Interruptor rápido de "Anclar módulos" (23-09-2026, a pedido del usuario:
// "hazlo tambien al revez, pero solo sucedera si yo anclo o lo avctivo esa
// funcion al cliente, si no cada pantalla es independiente" — ver la nota
// grande en sql/schema.sql) — aparte del PUT completo de arriba, para poder
// prender/apagar el anclado con un solo click desde pantallas que no abren
// el formulario entero (ej. la pestaña "Clientes" de Hipismo). Body:
// { anclado: true|false }.
router.patch('/:id/modulos-anclados', asyncHandler(async (req, res) => {
  const r = await db.query(
    'UPDATE jugadores SET modulos_anclados = $1 WHERE id = $2 AND grupo_id = $3 RETURNING *',
    [!!req.body.anclado, req.params.id, req.grupoId]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Jugador no encontrado.' });
  res.json(r.rows[0]);
}));

// Borra el registro de administración del jugador (NO su historial de
// jugadas ya procesadas, que vive en tickets_historial por nombre).
router.delete('/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM jugadores WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  res.status(204).end();
}));

module.exports = router;
