// =================================================================
// PRUEBA: PATCH /api/superadmin/grupos/:id/logo (01-09-2026, a pedido
// del usuario: "los logos... solo se pueden agregar o editar desde
// super admin").
//
// REESCRITA 29-09-2026, a pedido del usuario: "quiero subir el logo del
// grupo, no por url si no cargar la imagen del grupo desde super admin,
// queda cargada para cada grupo en su pagina" — el endpoint pasó de
// aceptar una URL externa pegada a mano a aceptar el ARCHIVO subido
// (base64, mismo patrón que POST /pagos con la captura del comprobante,
// ver routes/pagos.js). Mismo patrón de base de datos falsa + express
// falso que test_cliente_ruta.js — invoca el handler real de la ruta
// directo, sin levantar un servidor HTTP.
//
// Cubre: sube un archivo válido (PNG chico), un logoBase64 vacío/ausente
// BORRA el logo (archivo Y logo_url legacy, si tenía), un mime que no es
// imagen se rechaza con 400 sin tocar la base, una imagen de más de 4MB
// decodificados se rechaza con 400, subir un archivo nuevo reemplaza una
// logo_url legacy (queda null), y un grupo_id que no existe da 404.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  grupos: [
    { id: 'grupo-1', nombre: 'Deportes Zenyatta TX', logo_url: null, logo_base64: null, logo_mime: null }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^UPDATE grupos SET logo_url = null, logo_base64 = null, logo_mime = null WHERE id = \$1 RETURNING id/i.test(sql)) {
    const [id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.logo_url = null;
    grupo.logo_base64 = null;
    grupo.logo_mime = null;
    return { rows: [{ id: grupo.id }] };
  }
  if (/^UPDATE grupos SET logo_base64 = \$1, logo_mime = \$2, logo_url = null WHERE id = \$3 RETURNING id/i.test(sql)) {
    const [logoBase64, logoMime, id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    if (!grupo) return { rows: [] };
    grupo.logo_base64 = logoBase64;
    grupo.logo_mime = logoMime;
    grupo.logo_url = null;
    return { rows: [{ id: grupo.id }] };
  }
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => {
    router[m] = (...args) => { handlers.push([m, args]); return router; };
  });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'x' }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.SUPERADMIN_SECRET = 'fake-secret';

const superadminRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin'));

Module._load = originalLoad;

const entradaLogo = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'patch' && args[0] === '/grupos/:id/logo');
const handlerLogo = entradaLogo[1][entradaLogo[1].length - 1];

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// PNG 1x1 real (67 bytes decodificados) — sirve como "archivo chico
// válido" sin tener que generar bytes al azar.
const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

(async function main() {
  // --- Subir un archivo válido ---
  const req1 = { params: { id: 'grupo-1' }, body: { logoBase64: PNG_1X1_BASE64, logoMime: 'image/png' } };
  const res1 = await invocarRuta(handlerLogo, req1);
  check(res1._status === 200, 'Subir un archivo válido responde 200');
  check(res1._json.tieneLogo === true, 'La respuesta confirma que el grupo ya tiene logo (tieneLogo: true)');
  check(TABLAS.grupos[0].logo_base64 === PNG_1X1_BASE64, 'El archivo quedó guardado de verdad en logo_base64');
  check(TABLAS.grupos[0].logo_mime === 'image/png', 'El mime quedó guardado de verdad en logo_mime');
  check(TABLAS.grupos[0].logo_url === null, 'logo_url queda null (nunca conviven las 2 formas a la vez)');

  // --- logoBase64 vacío borra el logo ---
  const req2 = { params: { id: 'grupo-1' }, body: { logoBase64: '', logoMime: '' } };
  const res2 = await invocarRuta(handlerLogo, req2);
  check(res2._json.tieneLogo === false, 'Mandar logoBase64 vacío borra el logo (tieneLogo: false)');
  check(TABLAS.grupos[0].logo_base64 === null, 'logo_base64 quedó null de verdad en la fila del grupo');
  check(TABLAS.grupos[0].logo_mime === null, 'logo_mime también quedó null');

  // --- logoBase64 ausente (sin body.logoBase64 en absoluto) también borra ---
  TABLAS.grupos[0].logo_base64 = PNG_1X1_BASE64;
  TABLAS.grupos[0].logo_mime = 'image/png';
  const req2b = { params: { id: 'grupo-1' }, body: {} };
  const res2b = await invocarRuta(handlerLogo, req2b);
  check(res2b._json.tieneLogo === false, 'Un body sin logoBase64 en absoluto también borra el logo');
  check(TABLAS.grupos[0].logo_base64 === null, 'logo_base64 quedó null');

  // --- Mime que no es imagen se rechaza ---
  const req3 = { params: { id: 'grupo-1' }, body: { logoBase64: PNG_1X1_BASE64, logoMime: 'application/pdf' } };
  const res3 = await invocarRuta(handlerLogo, req3);
  check(res3._status === 400, 'Un mime que no es una imagen soportada se rechaza con 400');
  check(TABLAS.grupos[0].logo_base64 === null, 'Rechazado por mime inválido, no se guardó nada');

  // --- Imagen demasiado pesada (> 4MB decodificados) se rechaza ---
  const bytesGrandes = Buffer.alloc(4 * 1024 * 1024 + 1, 1); // 1 byte más del tope
  const base64Grande = bytesGrandes.toString('base64');
  const req4 = { params: { id: 'grupo-1' }, body: { logoBase64: base64Grande, logoMime: 'image/png' } };
  const res4 = await invocarRuta(handlerLogo, req4);
  check(res4._status === 400, 'Una imagen de más de 4MB decodificados se rechaza con 400');
  check(TABLAS.grupos[0].logo_base64 === null, 'Rechazada por pesar demasiado, no se guardó nada');

  // --- Subir un archivo nuevo reemplaza una logo_url legacy ---
  TABLAS.grupos[0].logo_url = 'https://algo-legacy.com/logo.png'; // simula un grupo viejo con URL pegada
  const req5 = { params: { id: 'grupo-1' }, body: { logoBase64: PNG_1X1_BASE64, logoMime: 'image/jpeg' } };
  const res5 = await invocarRuta(handlerLogo, req5);
  check(res5._json.tieneLogo === true, 'Subir un archivo nuevo confirma tieneLogo: true');
  check(TABLAS.grupos[0].logo_base64 === PNG_1X1_BASE64, 'El archivo nuevo quedó guardado');
  check(TABLAS.grupos[0].logo_url === null, 'La logo_url legacy se borró al subir el archivo nuevo (nunca conviven las 2)');

  // --- Grupo que no existe ---
  const req6 = { params: { id: 'grupo-que-no-existe' }, body: { logoBase64: PNG_1X1_BASE64, logoMime: 'image/png' } };
  const res6 = await invocarRuta(handlerLogo, req6);
  check(res6._status === 404, 'Un grupo_id que no existe da 404, no revienta el servidor');

  // --- Grupo que no existe, al BORRAR también da 404 ---
  const req7 = { params: { id: 'grupo-que-no-existe' }, body: {} };
  const res7 = await invocarRuta(handlerLogo, req7);
  check(res7._status === 404, 'Un grupo_id que no existe da 404 también al borrar el logo');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de PATCH /grupos/:id/logo se cayó con una excepción:', e);
  process.exit(1);
});
