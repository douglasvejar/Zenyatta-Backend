// =================================================================
// DETALLE DEL PAGO DE UNA RECARGA / RETIRO (02-11-2026, a pedido del usuario: "aquí puedo elegir, si lo requiero para mayor control, el
// método por el cual se hizo la recarga: zelle, pago móvil, dólares efectivo, bolívares efectivo, banesco panamá, cash app, otro (si
// escogen otro, pueden escribir el método y después ese método aparece ya guardado en la lista desplegable)... los que te indiqué son
// los predeterminados de cada grupo, los que vayan agregando son individuales de cada grupo... pueden subir la foto de la referencia
// del pago y/o la referencia... y al ver el detallado de ese cliente se debe ver de quién es la recarga o el retiro, y si tiene imagen
// un botón de ver imagen").
//
// Una recarga (Saldos > Recarga Saldos Pago Diarios) o un retiro es un PAR de filas en hipismo_comisiones_ajustes (cliente y cuenta). El
// detalle del pago se guarda en hipismo_pagos_detalle atado a la fila de ORIGEN del par (la que resta: en una recarga la de POZOS PAGO
// DIARIOS, en un retiro la del cliente; es el `id` que devuelve emparejarTraspasosSaldo), así al borrar el par se borra todo junto
// (ON DELETE CASCADE). Todo es opcional: sin método, referencia ni imagen no se guarda nada. La imagen va en base64 dentro de la base
// (igual que la captura de pago y los adjuntos del chat), nunca en el disco del servidor.
// Métodos: los 6 predeterminados + los que cada grupo agrega al elegir "Otro" (hipismo_metodos_pago, por grupo).
// =================================================================
const db = require('../db');

const METODOS_PREDETERMINADOS = ['Zelle', 'Pago móvil', 'Dólares efectivo', 'Bolívares efectivo', 'Banesco Panamá', 'Cash App'];
const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES_IMAGEN = 4 * 1024 * 1024; // 4 MB reales (el navegador la reduce antes de mandarla)
const MAX_METODO = 60;
const MAX_REFERENCIA = 160;

const limpiar = t => (t == null ? '' : String(t)).replace(/\s+/g, ' ').trim();
const claveMetodo = t => limpiar(t).toLowerCase();

function esPredeterminado(nombre) {
  const c = claveMetodo(nombre);
  return METODOS_PREDETERMINADOS.find(m => claveMetodo(m) === c) || null;
}

// Arma y valida los datos opcionales del pago a partir del cuerpo de la petición.
// body: { metodo, referencia, imagen: { base64, mime } | 'data:image/png;base64,...' }
// -> { ok:true, datos:{ metodo, referencia, imagenBase64, imagenMime, hayAlgo, imagenIncluida } } | { ok:false, error }
function validarDatosPago(body) {
  const b = body || {};
  let metodo = limpiar(b.metodo);
  const referencia = limpiar(b.referencia);
  if (metodo.length > MAX_METODO) return { ok: false, error: `El método de pago es muy largo (máximo ${MAX_METODO} letras).` };
  if (referencia.length > MAX_REFERENCIA) return { ok: false, error: `La referencia es muy larga (máximo ${MAX_REFERENCIA} letras).` };
  const pre = metodo ? esPredeterminado(metodo) : null;
  if (pre) metodo = pre; // "zelle" -> "Zelle"

  let imagenBase64 = null, imagenMime = null, imagenIncluida = false;
  let img = b.imagen;
  if (img && typeof img === 'string') {
    const m = img.match(/^data:([^;]+);base64,(.+)$/s);
    img = m ? { mime: m[1], base64: m[2] } : null;
  }
  if (img && typeof img === 'object' && img.base64) {
    const mime = String(img.mime || '').toLowerCase();
    const base64 = String(img.base64).replace(/\s+/g, '');
    if (!MIMES_IMAGEN.includes(mime)) return { ok: false, error: 'La imagen debe ser JPG, PNG, WEBP o GIF.' };
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { ok: false, error: 'La imagen no se pudo leer. Súbela de nuevo.' };
    const bytes = Math.floor(base64.length * 3 / 4);
    if (bytes > MAX_BYTES_IMAGEN) return { ok: false, error: 'La imagen es muy pesada (máximo 4 MB).' };
    imagenBase64 = base64; imagenMime = mime; imagenIncluida = true;
  }
  return { ok: true, datos: { metodo: metodo || null, referencia: referencia || null, imagenBase64, imagenMime, imagenIncluida, hayAlgo: !!(metodo || referencia || imagenIncluida) } };
}

// Los métodos del grupo: predeterminados primero y, después, los que el grupo fue agregando (ordenados).
async function listarMetodos(grupoId) {
  let personalizados = [];
  try {
    const r = await db.query('SELECT nombre FROM hipismo_metodos_pago WHERE grupo_id = $1 ORDER BY nombre', [grupoId]);
    personalizados = (r.rows || []).map(x => x.nombre);
  } catch (e) {
    if (!e || e.code !== '42P01') throw e; // todavía no existe la tabla: solo los predeterminados
  }
  return { predeterminados: METODOS_PREDETERMINADOS.slice(), personalizados };
}

// Si el método no es de los predeterminados, queda guardado en la lista del grupo (una sola vez).
async function asegurarMetodo(ejecutor, grupoId, metodo) {
  const nombre = limpiar(metodo);
  if (!nombre || esPredeterminado(nombre)) return;
  try {
    await ejecutor.query(
      `INSERT INTO hipismo_metodos_pago (grupo_id, nombre)
       SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM hipismo_metodos_pago WHERE grupo_id = $1 AND lower(nombre) = lower($2))`,
      [grupoId, nombre]
    );
  } catch (e) {
    if (!e || e.code !== '42P01') throw e;
  }
}

// Guarda (o reemplaza) el detalle del pago de un par. `datos` viene de validarDatosPago. Si no hay nada, no hace nada.
// `editando`: al corregir una recarga/retiro, dejar método y referencia vacíos los borra (la imagen ya subida se conserva).
async function guardarDetallePago(ejecutor, grupoId, ajusteId, datos, editando) {
  if (!ajusteId || !datos) return false;
  if (!datos.hayAlgo) {
    if (!editando) return false;
    await ejecutor.query('UPDATE hipismo_pagos_detalle SET metodo = NULL, referencia = NULL WHERE grupo_id = $1 AND ajuste_id = $2', [grupoId, ajusteId]);
    await ejecutor.query('DELETE FROM hipismo_pagos_detalle WHERE grupo_id = $1 AND ajuste_id = $2 AND imagen_base64 IS NULL', [grupoId, ajusteId]);
    return false;
  }
  await asegurarMetodo(ejecutor, grupoId, datos.metodo);
  // Si el grupo ya tenía ese método con otras mayúsculas ("binance" vs "Binance"), se usa el nombre ya guardado.
  let metodo = datos.metodo;
  if (metodo && !esPredeterminado(metodo)) {
    try {
      const rm = await ejecutor.query('SELECT nombre FROM hipismo_metodos_pago WHERE grupo_id = $1 AND lower(nombre) = lower($2) LIMIT 1', [grupoId, metodo]);
      if (rm.rows && rm.rows[0] && rm.rows[0].nombre) metodo = rm.rows[0].nombre;
    } catch (e) { if (!e || e.code !== '42P01') throw e; }
  }
  await ejecutor.query(
    `INSERT INTO hipismo_pagos_detalle (ajuste_id, grupo_id, metodo, referencia, imagen_base64, imagen_mime)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (ajuste_id) DO UPDATE SET metodo = EXCLUDED.metodo, referencia = EXCLUDED.referencia,
       imagen_base64 = COALESCE(EXCLUDED.imagen_base64, hipismo_pagos_detalle.imagen_base64),
       imagen_mime = COALESCE(EXCLUDED.imagen_mime, hipismo_pagos_detalle.imagen_mime)`,
    [ajusteId, grupoId, metodo, datos.referencia, datos.imagenBase64, datos.imagenMime]
  );
  return true;
}

// Detalle de varios pares: Map ajusteId -> { metodo, referencia, tieneImagen }. Sin tabla o sin ids: mapa vacío.
async function detallesPorAjuste(grupoId, ids) {
  const mapa = new Map();
  const lista = Array.from(new Set((ids || []).filter(Boolean)));
  if (!lista.length) return mapa;
  try {
    const r = await db.query(
      `SELECT ajuste_id, metodo, referencia, (imagen_base64 IS NOT NULL) AS tiene_imagen
         FROM hipismo_pagos_detalle WHERE grupo_id = $1 AND ajuste_id = ANY($2::uuid[])`,
      [grupoId, lista]
    );
    (r.rows || []).forEach(x => mapa.set(x.ajuste_id, { metodo: x.metodo || null, referencia: x.referencia || null, tieneImagen: !!x.tiene_imagen }));
  } catch (e) { /* sin tabla (falta el SQL) o base falsa de prueba: sin detalle */ }
  return mapa;
}

async function leerImagenPago(grupoId, ajusteId) {
  const r = await db.query(
    'SELECT imagen_base64, imagen_mime FROM hipismo_pagos_detalle WHERE grupo_id = $1 AND ajuste_id = $2 AND imagen_base64 IS NOT NULL',
    [grupoId, ajusteId]
  );
  const f = r.rows && r.rows[0];
  return f ? { buffer: Buffer.from(f.imagen_base64, 'base64'), mime: f.imagen_mime || 'image/jpeg' } : null;
}

module.exports = {
  METODOS_PREDETERMINADOS, MIMES_IMAGEN, MAX_BYTES_IMAGEN,
  validarDatosPago, listarMetodos, asegurarMetodo, guardarDetallePago, detallesPorAjuste, leerImagenPago, esPredeterminado
};
