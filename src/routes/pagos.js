// =================================================================
// PAGOS DEL GRUPO A LUDOX (15-09-2026, a pedido del usuario: "cada
// grupo debe pagar el servicio, el pago es semanal... quiero enlazar
// esas jugadas a un servidor online" — esto NO es sobre lo que un
// cliente le debe a un Grupo (eso ya lo resuelve toda la lógica de
// Balance General/tickets), es la SUSCRIPCIÓN: cada Grupo (cliente de
// esta plataforma) le paga semanalmente a Ludox por usar el servicio.
// Acá el Grupo REPORTA un pago (fecha, método, referencia opcional y
// una captura como prueba) — Súper-admin lo revisa y lo marca
// confirmado/rechazado desde routes/superadmin.js (ver las rutas
// /pagos de ahí). Confirmar o rechazar un reporte NO toca ningún
// saldo/ticket/Balance General — es un flujo de revisión aparte, en
// espejo de "mensajes_contacto"/routes/contacto.js pero del lado del
// Grupo ya logueado (acá SÍ hace falta sesión, por eso router.use
// (requiereGrupo) igual que en jugadores.js/whatsapp.js).
//
// La captura se guarda como base64 en la propia fila (captura_base64)
// porque esta app no tiene ningún integración de storage de archivos
// (S3, Supabase Storage, etc.) — es el mismo criterio ya usado para
// los logos de Grupo, así que no es un atajo nuevo, es consistente
// con el resto del proyecto. Se le pone un tope de 4MB decodificados
// para que nadie mande la foto cruda de la cámara sin comprimir.
// =================================================================
const express = require('express');
const db = require('../db');
const { requiereGrupo, requierePermiso } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('pagos'));

const METODOS_VALIDOS = ['pago_movil', 'binance', 'zelle', 'banesco_panama'];
const TOPE_CAPTURA_BYTES = 4 * 1024 * 1024; // 4MB decodificados

router.post('/', asyncHandler(async (req, res) => {
  const { fechaPago, metodo, referencia, capturaBase64, capturaMime } = req.body || {};

  if (!fechaPago || !String(fechaPago).trim()) {
    return res.status(400).json({ error: 'Falta la fecha del pago.' });
  }
  if (!metodo || !METODOS_VALIDOS.includes(metodo)) {
    return res.status(400).json({ error: 'Método de pago inválido. Debe ser uno de: ' + METODOS_VALIDOS.join(', ') + '.' });
  }
  if (!capturaBase64 || !String(capturaBase64).trim()) {
    return res.status(400).json({ error: 'Falta la captura del pago.' });
  }

  let mime = 'image/png';
  if (capturaMime) {
    if (!String(capturaMime).startsWith('image/')) {
      return res.status(400).json({ error: 'La captura debe ser una imagen.' });
    }
    mime = String(capturaMime);
  }

  // Bytes REALES una vez decodificado — el largo del string base64 no
  // sirve para esto (crece ~33% por la propia codificación).
  const bytes = Buffer.from(String(capturaBase64), 'base64').length;
  if (bytes > TOPE_CAPTURA_BYTES) {
    return res.status(400).json({ error: 'La captura pesa demasiado (máx. 4MB). Prueba con una captura de pantalla en vez de la foto original de la cámara.' });
  }

  const r = await db.query(
    `INSERT INTO pagos_grupo (grupo_id, fecha_pago, metodo, referencia, captura_base64, captura_mime, estado)
     VALUES ($1, $2, $3, $4, $5, $6, 'pendiente')
     RETURNING id, fecha_pago, metodo, referencia, estado, creado_en`,
    [
      req.grupoId,
      String(fechaPago).trim(),
      metodo,
      referencia ? String(referencia).trim().slice(0, 500) : null,
      String(capturaBase64),
      mime
    ]
  );

  const fila = r.rows[0];
  // No se re-manda la captura en la respuesta — el frontend acaba de
  // subirla, no necesita que el servidor se la devuelva de vuelta.
  res.status(201).json({
    id: fila.id,
    fechaPago: fila.fecha_pago,
    metodo: fila.metodo,
    referencia: fila.referencia,
    estado: fila.estado,
    creadoEn: fila.creado_en
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  // A propósito NO se selecciona captura_base64 acá — la lista tiene
  // que quedar liviana, la imagen se pide aparte solo cuando alguien
  // de verdad quiere verla (ver GET /:id/captura más abajo).
  const r = await db.query(
    `SELECT id, fecha_pago, metodo, referencia, estado, nota_admin, creado_en, revisado_en
     FROM pagos_grupo WHERE grupo_id = $1 ORDER BY creado_en DESC LIMIT 200`,
    [req.grupoId]
  );
  res.json(r.rows);
}));

router.get('/:id/captura', asyncHandler(async (req, res) => {
  const r = await db.query(
    'SELECT captura_base64, captura_mime FROM pagos_grupo WHERE id = $1 AND grupo_id = $2',
    [req.params.id, req.grupoId]
  );
  // 404 tanto si el id no existe como si es de OTRO grupo — nunca se
  // le confirma a nadie que un id ajeno existe.
  if (r.rows.length === 0) return res.status(404).json({ error: 'No se encontró esa captura.' });

  const fila = r.rows[0];
  res.set('Content-Type', fila.captura_mime);
  res.send(Buffer.from(fila.captura_base64, 'base64'));
}));

module.exports = router;
