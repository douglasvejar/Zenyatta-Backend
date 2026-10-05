// =================================================================
// hipismoCargasEspeciales.js (05-10-2026) — "Carga Masiva Especial".
//
// El operador escribe líneas "CLIENTE +monto" / "CLIENTE -monto" (una por
// línea), elige hipódromo, acción, fecha y (opcional) número de carrera: la
// suma de TODAS las líneas debe dar exactamente 0 — así un movimiento
// masivo nunca descuadra Balance General/Cierre Final (mismo principio que
// Winners, que tiene su ítem espejo). Cada nombre debe existir como cliente
// (o ser una cuenta del grupo, ver CUENTAS_GRUPO_CARGA_ESPECIAL).
//
// Este archivo es puro (parseo y validación, sin base de datos) salvo
// obtenerCargasEspecialesRango(), la ÚNICA consulta que leen Cierre Final,
// el link de cada cliente y Semana por Días (un solo SQL a propósito:
// cualquier prueba con una base falsa solo necesita reconocer ese texto).
// =================================================================
const db = require('../db');
const { round2 } = require('./hipismoAdelantadasCalc');

function normalizarNombre(n) {
  return (n || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
}

// "23.00" -> 23, "1.234,56" -> 1234.56, "1.234" -> 1234 (el "." como
// separador de miles, mismo criterio del resto del módulo), "23,5" -> 23.5.
function parsearMonto(txt) {
  let s = String(txt).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Cada línea: <nombre> <+|-><monto>, con espacios opcionales alrededor del
// signo y un "$" opcional. El nombre puede traer espacios ("RAFAEL PARLEY").
const RE_LINEA = /^(.+?)\s*([+-])\s*\$?\s*(\d[\d.,]*)\s*$/;

function parsearLineasCargaEspecial(texto) {
  const lineas = [];
  const errores = [];
  String(texto || '').split(/\r?\n/).forEach((cruda, i) => {
    const linea = cruda.replace(/\*/g, '').trim();
    if (!linea) return;
    const m = linea.match(RE_LINEA);
    if (!m) { errores.push({ numero: i + 1, linea, motivo: 'No tiene el formato "CLIENTE +monto" o "CLIENTE -monto".' }); return; }
    const cliente = normalizarNombre(m[1]);
    const valor = parsearMonto(m[3]);
    if (!cliente) { errores.push({ numero: i + 1, linea, motivo: 'Falta el nombre del cliente.' }); return; }
    if (!Number.isFinite(valor)) { errores.push({ numero: i + 1, linea, motivo: 'El monto no es un número válido.' }); return; }
    lineas.push({ cliente, monto: round2(m[2] === '-' ? -valor : valor), textoOriginal: linea });
  });
  return { lineas, errores };
}

// ACCIONES (05-10-2026, a pedido del usuario, con su imagen "Carga masiva —
// texto libre: creación de saldos"): en vez de un "código especial", la
// ventana elige un HIPÓDROMO y una ACCIÓN (la modalidad a la que pertenecen
// los saldos). La acción solo etiqueta: cada línea mueve el saldo de esa
// cuenta y en su detalle aparece como "<Acción> — Carga Masiva".
const ACCIONES_CARGA_ESPECIAL = [
  'CARRERA', 'REMATE', 'WINNERS', 'TABLAS FIJAS', 'MARCAS',
  'JUGADAS ENTRE TERCIOS ADELANTADAS', 'CRUCE', 'POLLA', 'DEPORTE', 'TRASPASO'
];

// Cuentas del grupo que NO son una ficha de cliente pero se aceptan en el
// texto (por ejemplo la comisión de Marcas del ejemplo del usuario: "% TABLAS
// Y MARCAS +1.25"). Cualquier otro nombre debe existir EXACTAMENTE como
// cliente, si no es error.
const CUENTAS_GRUPO_CARGA_ESPECIAL = [
  '% TABLAS Y MARCAS', '% TERCIOS ADELANTADAS', '% DE TABLAS FIJAS', 'PORCENTAJE MARCAS',
  'REMATE', 'WINNERS', 'TABLAS FIJAS', 'MARCAS'
];

function esAccionValida(accion) {
  return ACCIONES_CARGA_ESPECIAL.includes(normalizarNombre(accion));
}

function esCuentaGrupo(nombre) {
  return CUENTAS_GRUPO_CARGA_ESPECIAL.includes(normalizarNombre(nombre));
}

function conSigno(n) {
  return (n > 0 ? '+' : '') + n.toFixed(2);
}

// validarCargaEspecial({ texto, accion, fecha }) -> {
//   ok, lineas, suma, errores: [string...], avisos: [string...],
//   resumen: { ganan, pierden, cantidad }
// }
// (La existencia de cada cliente se comprueba aparte, contra la base: ver
// rutas /cargas-especiales.)
function validarCargaEspecial({ texto, accion, fecha }) {
  const { lineas, errores: erroresParseo } = parsearLineasCargaEspecial(texto);
  const errores = erroresParseo.map(e => `Línea ${e.numero} ("${e.linea}"): ${e.motivo}`);
  const avisos = [];
  if (!esAccionValida(accion)) errores.push('Elige la acción (Remate, Marcas, Winners, etc.).');
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) errores.push('Falta una fecha válida.');
  if (!lineas.length && !erroresParseo.length) errores.push('Escribe al menos una línea (CLIENTE +monto o CLIENTE -monto).');

  const suma = round2(lineas.reduce((s, l) => s + l.monto, 0));
  if (lineas.length && suma !== 0) {
    errores.push(`La suma debe ser igual a cero. Diferencia: ${conSigno(suma)}`);
  }
  const ganan = round2(lineas.filter(l => l.monto > 0).reduce((s, l) => s + l.monto, 0));
  const pierden = round2(lineas.filter(l => l.monto < 0).reduce((s, l) => s + l.monto, 0));
  return { ok: errores.length === 0, lineas, suma, errores, avisos, resumen: { ganan, pierden, cantidad: lineas.length } };
}

// Lee TODAS las líneas de cargas especiales de un rango (con `nombre`
// opcional para un solo cliente). Un solo SQL — ver la nota de arriba.
async function obtenerCargasEspecialesRango(grupoId, desde, hasta, nombre) {
  const r = await db.query(
    `SELECT l.cliente_nombre, l.monto, c.fecha, c.carrera, c.codigo_nombre, c.id AS carga_id, c.hipodromo_nombre
       FROM hipismo_cargas_especiales_lineas l
       JOIN hipismo_cargas_especiales c ON c.id = l.carga_id
      WHERE l.grupo_id = $1 AND c.fecha BETWEEN $2 AND $3 AND ($4::text IS NULL OR l.cliente_nombre = $4)
      ORDER BY c.fecha DESC, c.creado_en ASC, l.orden ASC`,
    [grupoId, desde, hasta, nombre || null]
  );
  return r.rows.map(row => ({
    clienteNombre: row.cliente_nombre,
    monto: Number(row.monto),
    fecha: row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha,
    carrera: row.carrera || null,
    codigoNombre: row.codigo_nombre, // la ACCIÓN elegida (REMATE, MARCAS...)
    hipodromoNombre: row.hipodromo_nombre || null,
    cargaId: row.carga_id
  }));
}

module.exports = {
  normalizarNombre, parsearMonto, parsearLineasCargaEspecial, validarCargaEspecial, obtenerCargasEspecialesRango,
  ACCIONES_CARGA_ESPECIAL, CUENTAS_GRUPO_CARGA_ESPECIAL, esAccionValida, esCuentaGrupo
};
