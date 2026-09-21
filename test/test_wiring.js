// Prueba de "cableado": sin paquetes de npm instalados (no hay acceso a
// la registry desde este sandbox), se simulan express/pg/jsonwebtoken/
// bcryptjs/cors/dotenv con lo mínimo necesario para poder hacer require()
// de TODAS las rutas y servicios sin que truene por un import mal escrito,
// una ruta relativa rota, o un nombre de función que no existe. No prueba
// contra una base de datos real — eso se confirma la primera vez que el
// usuario lo corra contra su propio Supabase (ver README) — pero sí
// atrapa errores de "esto ni siquiera carga".
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => {
    router[m] = (...args) => { handlers.push([m, args]); return router; };
  });
  router.__handlers = handlers;
  return router;
}

const fakeExpress = () => {
  const app = fakeExpressRouter();
  app.listen = (port, cb) => { if (cb) cb(); return { close() {} }; };
  app.set = () => {}; // ej. app.set('trust proxy', true) en server.js
  return app;
};
fakeExpress.Router = fakeExpressRouter;
fakeExpress.json = () => (req, res, next) => next && next();
fakeExpress.static = () => (req, res, next) => next && next();

const fakePool = function () {
  this.query = async () => ({ rows: [] });
  this.connect = async () => ({ query: async () => ({ rows: [] }), release() {} });
  this.on = () => {}; // db.js le engancha un listener de 'error' al pool (ver comentario ahí)
};

const fakes = {
  express: fakeExpress,
  pg: { Pool: fakePool },
  jsonwebtoken: { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'x' }) },
  bcryptjs: { hash: async () => 'hash', compare: async () => true },
  cors: () => (req, res, next) => next && next(),
  dotenv: { config: () => {} }
};

Module._load = function (request, parent, isMain) {
  if (fakes[request]) return fakes[request];
  return originalLoad.apply(this, arguments);
};

process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';
process.env.SUPERADMIN_SECRET = 'fake-secret';

let ok = true;
function tryRequire(rel) {
  try {
    require(path.join(__dirname, '..', rel));
    console.log('OK: require(' + rel + ')');
  } catch (e) {
    ok = false;
    console.error('FALLÓ: require(' + rel + ') ->', e.message);
  }
}

[
  'src/db.js',
  'src/middleware/auth.js',
  'src/services/grupoConfig.js',
  'src/services/historial.js',
  'src/services/sabanaDia.js',
  'src/services/transferencias.js',
  'src/services/polla.js',
  'src/services/mantenimientoGrupo.js',
  'src/services/telefonos.js',
  'src/services/fechaVenezuela.js',
  'src/services/confirmaciones.js',
  'src/services/balanceGeneral.js',
  'src/services/fechaSemana.js',
  'src/services/saldosSemana.js',
  'src/services/pozo.js',
  'src/services/nflApi.js',
  'src/services/nhlApi.js',
  'src/services/nbaApi.js',
  'src/services/soccerApi.js',
  'src/services/footballDataApi.js',
  'src/services/alertas.js',
  'src/services/chat.js',
  'src/services/procesarSabana.js',
  'src/services/mantenimientoGrupo.js',
  'src/services/papeleraSabana.js',
  'src/services/whatsappTrigger.js',
  'src/services/sabanasPendientesWhatsapp.js',
  'src/services/whatsappDiaEstado.js',
  'src/services/whatsappResumenDia.js',
  'src/services/planoWhatsAppTexto.js',
  // whatsappBot.js SÍ se puede requerir acá (03-09-2026, más tarde
  // todavía) — a diferencia de la primera versión de este archivo,
  // @whiskeysockets/baileys ahora se requiere SOLO adentro de
  // iniciarBotWhatsApp() (nunca al cargar el módulo), justamente para
  // que manejarMensajeEntrante()/procesarDiaAbierto() — el corazón de
  // todo el flujo automático — se puedan probar de verdad en este
  // sandbox sin el paquete instalado (ver test_whatsapp_bot_flujo.js).
  // Lo único que sigue sin poder probarse acá es la conexión real a
  // WhatsApp en sí (iniciarBotWhatsApp(), que solo se llama si
  // WHATSAPP_BOT_ACTIVADO=true — ver server.js).
  'src/services/whatsappBot.js',
  // moneda.js/emailAlertas.js (18-09-2026, "moneda del grupo" + "alerta
  // si se cae WhatsApp"). emailAlertas.js requiere nodemailer adentro de
  // obtenerTransportador() (nunca al cargar el módulo, mismo criterio que
  // @whiskeysockets/baileys en whatsappBot.js) — por eso puede cargar
  // acá aunque nodemailer no esté en el mapa de `fakes` de arriba.
  'src/services/moneda.js',
  'src/services/emailAlertas.js',
  'src/routes/auth.js',
  'src/routes/superadmin.js',
  'src/routes/sabana.js',
  'src/routes/jugadores.js',
  'src/routes/avales.js',
  'src/routes/transferencias.js',
  'src/routes/polla.js',
  'src/routes/reportes.js',
  'src/routes/cliente.js',
  'src/routes/equipos.js',
  'src/routes/imagenes.js',
  'src/routes/whatsapp.js',
  'src/routes/empleados.js',
  'src/routes/grupo.js',
  'src/routes/descargas.js',
  'src/server.js'
].forEach(tryRequire);

Module._load = originalLoad;

console.log(ok ? '\n✅ Todos los módulos cargan sin errores de cableado.' : '\n❌ Hubo módulos que no cargaron.');
process.exit(ok ? 0 : 1);
