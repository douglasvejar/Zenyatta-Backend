// =================================================================
// PRUEBA: alerta por correo + aviso fijo en el panel si se cae la sesión
// de WhatsApp (18-09-2026, a pedido del usuario: "dame alerta si se cae
// la sesion de whatssap"). Prueba programarOAlertarCaidaWhatsapp() /
// limpiarAlertaCaidaWhatsapp() directo (exportadas aparte de
// whatsappBot.js solo para esto, ver el comentario en su
// module.exports) — mismo criterio que el resto de las funciones de
// whatsappBot.js que ya se prueban así, sin necesitar
// @whiskeysockets/baileys instalado.
//
// Para no esperar los 3 minutos reales, se usa
// WHATSAPP_ALERTA_DEBOUNCE_MS_TESTING (solo para pruebas, ver el
// comentario junto a TIEMPO_ANTES_DE_ALERTAR_MS en whatsappBot.js) para
// bajarlo a 50ms.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}
function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const fakePool = function () {
  this.query = async () => ({ rows: [] });
  this.connect = async () => ({ query: async () => ({ rows: [] }), release() {} });
  this.on = () => {};
};

const correosEnviados = [];
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === './emailAlertas') {
    return { enviarAlertaEmail: async (asunto, cuerpo) => { correosEnviados.push({ asunto, cuerpo }); return { enviado: true }; } };
  }
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.WHATSAPP_ALERTA_DEBOUNCE_MS_TESTING = '50'; // 50ms en vez de 3 minutos, solo para esta prueba
const whatsappBot = require(path.join(__dirname, '..', 'src', 'services', 'whatsappBot'));
// OJO: a diferencia de otras pruebas, Module._load NO se restaura acá —
// programarOAlertarCaidaWhatsapp()/limpiarAlertaCaidaWhatsapp() hacen
// require('./emailAlertas') ADENTRO de la función (para no cargar
// nodemailer si nunca hace falta, ver el comentario grande en
// whatsappBot.js), así que ese require pasa recién cuando la prueba las
// LLAMA, no ahora. Se restaura al final de main().

(async function main() {
  // --- 1) Desconexión NO urgente: no manda nada al toque, espera el debounce ---
  whatsappBot.programarOAlertarCaidaWhatsapp('se perdió la conexión', false);
  check(whatsappBot.obtenerEstadoConexion().alertaActiva === false, 'desconexión no urgente: alertaActiva sigue false ANTES de que pase el tiempo de espera');
  check(correosEnviados.length === 0, 'desconexión no urgente: todavía no se mandó ningún correo (se está esperando por si reconecta sola)');

  await esperar(120);
  check(whatsappBot.obtenerEstadoConexion().alertaActiva === true, 'desconexión no urgente: pasado el tiempo de espera, alertaActiva = true (el panel debe mostrar el aviso fijo)');
  check(correosEnviados.length === 1, 'desconexión no urgente: pasado el tiempo de espera, SÍ se manda el correo (uno solo)');
  check(/cayó/i.test(correosEnviados[0].asunto), 'el correo de caída tiene un asunto que menciona la caída');

  // --- 2) Se reconecta: se apaga el aviso y se manda el correo de "se recuperó" ---
  whatsappBot.limpiarAlertaCaidaWhatsapp();
  check(whatsappBot.obtenerEstadoConexion().alertaActiva === false, 'al reconectar: alertaActiva vuelve a false');
  check(correosEnviados.length === 2, 'al reconectar (había alerta activa): se manda un SEGUNDO correo, de "se recuperó"');
  check(/reconectó/i.test(correosEnviados[1].asunto), 'el segundo correo menciona que se reconectó');

  // --- 3) Reconectar SIN que hubiera alerta activa: no manda correo de más ---
  const totalAntes = correosEnviados.length;
  whatsappBot.limpiarAlertaCaidaWhatsapp();
  check(correosEnviados.length === totalAntes, 'limpiarAlertaCaidaWhatsapp() sin alerta activa: no manda ningún correo de más (no hay nada que "recuperar")');

  // --- 4) Desconexión URGENTE (cerroSesion, hace falta un QR nuevo): manda YA, sin esperar ---
  whatsappBot.programarOAlertarCaidaWhatsapp('se cerró la sesión', true);
  check(whatsappBot.obtenerEstadoConexion().alertaActiva === true, 'desconexión urgente: alertaActiva = true DE INMEDIATO, sin esperar el debounce');
  check(correosEnviados.length === totalAntes + 1, 'desconexión urgente: el correo se manda de inmediato, sin esperar');
  whatsappBot.limpiarAlertaCaidaWhatsapp(); // deja todo limpio para no dejar un setTimeout pendiente

  // --- 5) Reprogramar una alerta no urgente varias veces (blips seguidos) no duplica el temporizador ---
  const totalAntes2 = correosEnviados.length;
  whatsappBot.programarOAlertarCaidaWhatsapp('primer blip', false);
  whatsappBot.programarOAlertarCaidaWhatsapp('segundo blip, 10ms después', false);
  await esperar(120);
  check(correosEnviados.length === totalAntes2 + 1, 'varios blips seguidos antes de que venza el debounce: se manda UN solo correo, no uno por cada blip');
  whatsappBot.limpiarAlertaCaidaWhatsapp();

  Module._load = originalLoad;
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de la alerta de WhatsApp se cayó con una excepción:', e);
  process.exit(1);
});
