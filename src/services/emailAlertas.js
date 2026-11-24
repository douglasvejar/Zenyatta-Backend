// Alerta por correo cuando se cae la sesión de WhatsApp (18-09-2026, a
// pedido del usuario: "dame alerta si se cae la sesion de whatssap").
// Elegido junto con el usuario: correo + aviso fijo en el panel de
// Súper-admin (ver whatsappBot.js/superadmin.html) — el correo llega
// aunque nadie tenga el panel abierto en ese momento.
//
// 100% opcional, con el mismo criterio que el bot de WhatsApp mismo (ver
// WHATSAPP_BOT_ACTIVADO en .env.example): si las variables de entorno de
// correo no están cargadas, esta función simplemente NO manda nada (y lo
// dice por consola) en vez de romper el servidor — así el resto del
// sistema sigue funcionando igual para quien no quiera configurar esto.
//
// Usa SMTP genérico vía nodemailer (agregado a package.json) — la forma
// más simple y gratis de conseguir esto es una cuenta de Gmail con una
// "contraseña de aplicación" (myaccount.google.com/apppasswords), pero
// funciona con cualquier proveedor SMTP (Zoho, Outlook, un plan de
// hosting, etc.). Ver .env.example para las variables exactas.
let transportadorCache = null;

function smtpConfigurado() {
  return !!(
    process.env.ALERTA_EMAIL_SMTP_HOST &&
    process.env.ALERTA_EMAIL_SMTP_USER &&
    process.env.ALERTA_EMAIL_SMTP_PASS
  );
}

function estaConfigurado() {
  return smtpConfigurado() && !!process.env.ALERTA_EMAIL_DESTINO;
}

function esEmailContacto(valor) {
  return typeof valor === 'string' && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(valor);
}

async function enviarRespuestaContacto(destinatario, texto) {
  if (!smtpConfigurado()) return { enviado: false, motivo: 'sin_configurar' };
  if (!esEmailContacto(destinatario)) return { enviado: false, motivo: 'sin_email' };
  try {
    const resultado = await obtenerTransportador().sendMail({
      from: process.env.ALERTA_EMAIL_SMTP_USER,
      to: destinatario,
      subject: 'Respuesta de LudoxApp a tu mensaje de contacto',
      text: texto
    });
    return resultado.accepted?.length ? { enviado: true } : { enviado: false, motivo: 'smtp' };
  } catch (e) {
    console.error('[contacto] Falló la entrega SMTP:', e.code || 'SMTP');
    return { enviado: false, motivo: 'smtp' };
  }
}

function obtenerTransportador() {
  if (transportadorCache) return transportadorCache;
  // Require adentro de la función a propósito, mismo criterio que
  // whatsappBot.js con @whiskeysockets/baileys: si nodemailer no
  // estuviera instalado en algún entorno raro, que explote solo en el
  // momento de intentar mandar un correo de verdad, no al arrancar el
  // servidor entero.
  const nodemailer = require('nodemailer');
  const puerto = Number(process.env.ALERTA_EMAIL_SMTP_PORT) || 587;
  transportadorCache = nodemailer.createTransport({
    host: process.env.ALERTA_EMAIL_SMTP_HOST,
    port: puerto,
    secure: puerto === 465,
    auth: {
      user: process.env.ALERTA_EMAIL_SMTP_USER,
      pass: process.env.ALERTA_EMAIL_SMTP_PASS
    }
  });
  return transportadorCache;
}

// Nunca tira (rechaza la promesa) — un correo que falla no puede tumbar
// el flujo de conexión/reconexión de whatsappBot.js. Devuelve
// { enviado: true } o { enviado: false, motivo }.
async function enviarAlertaEmail(asunto, cuerpoTexto) {
  if (!estaConfigurado()) {
    console.log('[emailAlertas] Alerta NO enviada por correo (falta configurar ALERTA_EMAIL_* en .env):', asunto);
    return { enviado: false, motivo: 'sin_configurar' };
  }
  try {
    const transportador = obtenerTransportador();
    const destinatarios = String(process.env.ALERTA_EMAIL_DESTINO).split(',').map(s => s.trim()).filter(Boolean);
    await transportador.sendMail({
      from: process.env.ALERTA_EMAIL_SMTP_USER,
      to: destinatarios,
      subject: asunto,
      text: cuerpoTexto
    });
    return { enviado: true };
  } catch (e) {
    console.error('[emailAlertas] Falló el envío de la alerta por correo:', e.message);
    return { enviado: false, motivo: e.message };
  }
}

module.exports = { enviarAlertaEmail, estaConfigurado, enviarRespuestaContacto, esEmailContacto };
