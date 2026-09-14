// =================================================================
// TELÉFONOS DEL GRUPO — números de WhatsApp con apodo, para el botón
// "Tengo diferencia" del link del Cliente (02-09-2026, a pedido del
// usuario). Solo se agregan/editan/borran desde Súper-admin — igual que
// el logo del grupo (ver sql/schema.sql, tabla grupo_telefonos, y la nota
// ahí sobre por qué). El Cliente SOLO lee el primer número (el más
// antiguo, por creado_en) — "Siempre el primero cargado", a pedido del
// usuario — nunca elige entre varios.
// =================================================================
const db = require('./../db');

async function listarTelefonos(grupoId) {
  const r = await db.query(
    'SELECT id, telefono, apodo, creado_en FROM grupo_telefonos WHERE grupo_id = $1 ORDER BY creado_en ASC',
    [grupoId]
  );
  return r.rows;
}

// Solo deja dígitos (wa.me necesita el número sin "+", espacios ni
// guiones) — así el Súper-admin puede escribirlo como quiera
// ("+58 412-1234567", "0412-1234567", etc.) y igual queda usable.
function limpiarTelefono(telefono) {
  return String(telefono || '').replace(/[^\d]/g, '');
}

async function agregarTelefono(grupoId, telefono, apodo) {
  const limpio = limpiarTelefono(telefono);
  if (!limpio || limpio.length < 7) {
    const err = new Error('El teléfono no parece válido — usa el número completo con código de país (ej. 584121234567).');
    err.status = 400;
    throw err;
  }
  if (!apodo || !apodo.trim()) {
    const err = new Error('Ingresa un apodo para identificar el número (ej. "Carlos - Soporte").');
    err.status = 400;
    throw err;
  }
  const existentes = await listarTelefonos(grupoId);
  if (existentes.length >= 3) {
    const err = new Error('Ya hay 3 números cargados para este grupo — borra uno antes de agregar otro.');
    err.status = 400;
    throw err;
  }
  const r = await db.query(
    'INSERT INTO grupo_telefonos (grupo_id, telefono, apodo) VALUES ($1, $2, $3) RETURNING id, telefono, apodo, creado_en',
    [grupoId, limpio, apodo.trim()]
  );
  return r.rows[0];
}

async function eliminarTelefono(grupoId, telefonoId) {
  await db.query('DELETE FROM grupo_telefonos WHERE id = $1 AND grupo_id = $2', [telefonoId, grupoId]);
}

// El número al que se dirige el botón "Tengo diferencia" del Cliente —
// siempre el primero cargado (más antiguo). Devuelve null si el grupo
// todavía no cargó ningún número (el botón, en ese caso, no genera el
// link de WhatsApp — ver cliente.html).
async function telefonoPrincipal(grupoId) {
  const lista = await listarTelefonos(grupoId);
  return lista.length > 0 ? lista[0] : null;
}

module.exports = { listarTelefonos, agregarTelefono, eliminarTelefono, telefonoPrincipal, limpiarTelefono };
