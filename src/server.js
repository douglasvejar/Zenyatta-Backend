require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const superadminRoutes = require('./routes/superadmin');
const sabanaRoutes = require('./routes/sabana');
const jugadoresRoutes = require('./routes/jugadores');
const avalesRoutes = require('./routes/avales');
const transferenciasRoutes = require('./routes/transferencias');
const pollaRoutes = require('./routes/polla');
const reportesRoutes = require('./routes/reportes');
const clienteRoutes = require('./routes/cliente');
const equiposRoutes = require('./routes/equipos');
const imagenesRoutes = require('./routes/imagenes');
const whatsappRoutes = require('./routes/whatsapp');
const contactoRoutes = require('./routes/contacto');

const app = express();
// El día que esto corra detrás de un proxy (Cloudflare Tunnel en la Fase
// 1, o Railway en la Fase 2 — ver README), sin esto "req.ip" devuelve la
// IP del proxy en vez de la del navegador real que se conectó. Se deja
// activado desde ya (no afecta en nada corriendo local) para que el
// registro de "último login" (ver src/routes/auth.js) ya guarde la IP
// correcta apenas se despliegue, sin tener que acordarse de este detalle
// más adelante.
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '2mb' })); // la sábana pegada puede ser un texto largo

app.get('/api/salud', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/sabana', sabanaRoutes);
app.use('/api/jugadores', jugadoresRoutes);
app.use('/api/avales', avalesRoutes);
app.use('/api/transferencias', transferenciasRoutes);
app.use('/api/polla', pollaRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/cliente', clienteRoutes); // pública, sin login (ver comentario en routes/cliente.js)
app.use('/api/equipos', equiposRoutes);
app.use('/api/imagenes', imagenesRoutes); // proxy de logos, pública a propósito (ver routes/imagenes.js)
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/contacto', contactoRoutes); // pública, sin login (ver comentario en routes/contacto.js) — formulario del portal de bienvenida

// =================================================================
// BOT DE WHATSAPP (03-09-2026) — 100% opcional, apagado por defecto. Se
// arranca acá, DESPUÉS de que el servidor ya está armado, y solo si el
// Grupo puso WHATSAPP_BOT_ACTIVADO=true en su .env (ver .env.example
// para el paso a paso completo). Si falla al arrancar (por ejemplo,
// porque todavía no se instaló "npm install @whiskeysockets/baileys
// @hapi/boom qrcode-terminal"), el error queda en el log pero NUNCA tumba
// el resto del servidor — la sábana se sigue pudiendo cargar a mano como
// siempre.
// =================================================================
if (process.env.WHATSAPP_BOT_ACTIVADO === 'true') {
  require('./services/whatsappBot').iniciarBotWhatsApp().catch((err) => {
    console.error('[whatsappBot] No se pudo arrancar el bot de WhatsApp (el resto del servidor sigue funcionando normal):', err);
  });
}

// =================================================================
// FRONTEND: sirve la carpeta public/ (index.html = panel del Grupo,
// cliente.html = vista pública del Cliente vía ?token=). Así con
// "npm start" alcanza — no hace falta levantar un servidor aparte para
// la pantalla, ver public/app.js.
//
// "Cache-Control: no-cache" en HTML/JS: sin esto, el navegador puede
// quedarse con una copia vieja de app.js/index.html guardada en caché y
// no darse cuenta de que hay una versión nueva en el disco, aunque el
// servidor ya se haya reiniciado con los archivos actualizados — eso
// puede producir errores rarísimos y difíciles de explicar (variables
// que "no existen todavía", botones que no hacen nada) porque en
// realidad el navegador ni siquiera está corriendo el código nuevo.
// "no-cache" no significa "nunca guardar nada": el navegador igual
// puede guardar una copia, pero está OBLIGADO a preguntarle primero al
// servidor "¿sigue siendo esta la versión más reciente?" antes de
// usarla — así que un F5 normal (sin necesidad de Ctrl+Shift+R) siempre
// trae los cambios apenas se reinicia el servidor con el archivo nuevo.
// =================================================================
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((err, req, res, next) => {
  console.error(err);
  // ECONNRESET/ETIMEDOUT/etc contra la base de datos: no es culpa de lo
  // que mandó el usuario, es un hipo de red hacia Supabase. Se distingue
  // del 500 genérico para que en el panel se vea un mensaje que invita a
  // reintentar, no un error confuso.
  const esCaidaDeRed = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'].includes(err.code);
  res.status(esCaidaDeRed ? 503 : 500).json({
    error: esCaidaDeRed
      ? 'Se perdió la conexión con la base de datos por un instante. Intenta de nuevo.'
      : 'Error interno del servidor.'
  });
});

// Red de seguridad final: si a pesar de asyncHandler (ver
// src/middleware/asyncHandler.js) y el listener de pool.on('error') (ver
// src/db.js) algo se sigue escapando, esto lo deja en el log en vez de
// tumbar el proceso sin ninguna pista de qué pasó.
process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada sin atrapar (revisar si falta algún asyncHandler):', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Deportes Zenyatta backend corriendo en http://localhost:' + PORT);
});
