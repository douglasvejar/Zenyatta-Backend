// =================================================================
// PRUEBA: services/emailAlertas.js (18-09-2026, "dame alerta si se cae
// la sesion de whatssap"). Cubre el comportamiento 100% opcional: sin
// las variables ALERTA_EMAIL_* configuradas, enviarAlertaEmail() nunca
// revienta ni intenta mandar nada de verdad — simplemente avisa que no
// está configurado. Con las variables puestas, sí intenta armar un
// transportador de nodemailer y mandar el correo (se verifica con un
// nodemailer falso, ya que el paquete real no está instalado en este
// sandbox — mismo criterio que @whiskeysockets/baileys en
// test_whatsapp_bot_flujo.js).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) Sin configurar: no revienta, dice que no se mandó nada ---
  delete process.env.ALERTA_EMAIL_SMTP_HOST;
  delete process.env.ALERTA_EMAIL_SMTP_USER;
  delete process.env.ALERTA_EMAIL_SMTP_PASS;
  delete process.env.ALERTA_EMAIL_DESTINO;

  const emailAlertasSinConfig = require(path.join(__dirname, '..', 'src', 'services', 'emailAlertas'));
  check(emailAlertasSinConfig.estaConfigurado() === false, 'estaConfigurado(): false cuando faltan las variables de entorno');
  const resultadoSinConfig = await emailAlertasSinConfig.enviarAlertaEmail('asunto', 'cuerpo');
  check(resultadoSinConfig.enviado === false && resultadoSinConfig.motivo === 'sin_configurar', 'enviarAlertaEmail() sin configurar: no revienta, devuelve {enviado:false, motivo:"sin_configurar"}');

  // --- 2) Configurado, con nodemailer falso: sí intenta mandar ---
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'services', 'emailAlertas'))];
  process.env.ALERTA_EMAIL_SMTP_HOST = 'smtp.fake.test';
  process.env.ALERTA_EMAIL_SMTP_PORT = '587';
  process.env.ALERTA_EMAIL_SMTP_USER = 'bot@fake.test';
  process.env.ALERTA_EMAIL_SMTP_PASS = 'clave-falsa';
  process.env.ALERTA_EMAIL_DESTINO = 'luisangelfreites24@gmail.com, otro@correo.com';

  let mailEnviado = null;
  Module._load = function (request, parent, isMain) {
    if (request === 'nodemailer') {
      return {
        createTransport: (opts) => ({
          sendMail: async (msg) => { mailEnviado = { opts, msg }; return { messageId: 'fake-id' }; }
        })
      };
    }
    return originalLoad.apply(this, arguments);
  };
  // OJO: obtenerTransportador() hace require('nodemailer') ADENTRO de la
  // función (mismo criterio que @whiskeysockets/baileys en
  // whatsappBot.js — ver el comentario grande en emailAlertas.js), así
  // que ese require pasa recién al llamar enviarAlertaEmail(), no al
  // cargar el módulo — Module._load tiene que seguir con el nodemailer
  // falso puesto HASTA que termine esa llamada, no solo hasta el
  // require() del módulo.
  const emailAlertasConfigurado = require(path.join(__dirname, '..', 'src', 'services', 'emailAlertas'));
  check(emailAlertasConfigurado.estaConfigurado() === true, 'estaConfigurado(): true con las 4 variables cargadas');
  const resultadoOk = await emailAlertasConfigurado.enviarAlertaEmail('🔴 se cayó WhatsApp', 'cuerpo de la alerta');
  Module._load = originalLoad;

  check(resultadoOk.enviado === true, 'enviarAlertaEmail() configurado: enviado = true');
  check(!!mailEnviado, 'enviarAlertaEmail() configurado: sí llamó a sendMail() del transportador');
  check(mailEnviado.msg.subject === '🔴 se cayó WhatsApp', 'el asunto llega tal cual al sendMail()');
  check(mailEnviado.msg.to.length === 2 && mailEnviado.msg.to[0] === 'luisangelfreites24@gmail.com', 'ALERTA_EMAIL_DESTINO con varios correos separados por coma se parte en una lista, sin espacios de sobra');

  // --- 3) Si sendMail() falla, no revienta — devuelve enviado:false ---
  delete require.cache[require.resolve(path.join(__dirname, '..', 'src', 'services', 'emailAlertas'))];
  Module._load = function (request, parent, isMain) {
    if (request === 'nodemailer') {
      return { createTransport: () => ({ sendMail: async () => { throw new Error('SMTP rechazó la conexión'); } }) };
    }
    return originalLoad.apply(this, arguments);
  };
  const emailAlertasFalla = require(path.join(__dirname, '..', 'src', 'services', 'emailAlertas'));
  const resultadoFalla = await emailAlertasFalla.enviarAlertaEmail('asunto', 'cuerpo');
  Module._load = originalLoad;
  check(resultadoFalla.enviado === false && resultadoFalla.motivo === 'SMTP rechazó la conexión', 'si sendMail() falla, enviarAlertaEmail() no revienta — devuelve {enviado:false, motivo:<mensaje del error>}');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de emailAlertas se cayó con una excepción:', e);
  process.exit(1);
});
