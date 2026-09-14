// =================================================================
// PRUEBA: GET /api/imagenes/logo (03-09-2026) — ver la nota grande en
// src/routes/imagenes.js. Corrige el bug reportado por el usuario: "al
// darle click en generar imagen, la imagen que me genera para enviar no
// aparecen los logos de los equipos" (html2canvas no puede leer píxeles
// de una imagen de otro origen sin CORS; este endpoint la trae del lado
// del servidor y se la sirve al navegador desde el MISMO origen).
// =================================================================
// Cubre:
//   1. Sin el parámetro "url" -> 400, no revienta.
//   2. Una URL con protocolo http (no https) -> 400, rechazada.
//   3. Una URL de un dominio NO permitido (ej. un sitio cualquiera,
//      para que esto no se pueda usar como proxy genérico) -> 400.
//   4. Una URL válida de un dominio permitido (mlbstatic.com /
//      espncdn.com) -> 200, devuelve el content-type y el body tal
//      cual los trajo el fetch falso (mismo patrón de fetch simulado
//      que test_sabana_polla_y_mayusculas.js).
//   5. Si el fetch al CDN real falla (ej. el logo no existe / 404
//      río arriba) -> 502, no revienta el servidor.
const assert = require('assert');
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
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;

let SIMULAR_ERROR_RED = false;
function fakeFetch(url) {
  if (SIMULAR_ERROR_RED) return Promise.reject(new Error('red caída'));
  if (url === 'https://www.mlbstatic.com/team-logos/117.svg') {
    return Promise.resolve({
      ok: true,
      headers: { get: (h) => (h === 'content-type' ? 'image/svg+xml' : null) },
      arrayBuffer: async () => Buffer.from('<svg>falso-astros</svg>')
    });
  }
  if (url === 'https://a.espncdn.com/i/teamlogos/nfl/500/no-existe.png') {
    return Promise.resolve({ ok: false, status: 404, headers: { get: () => null } });
  }
  return Promise.reject(new Error('URL inesperada en la prueba: ' + url));
}

Module._load = function (request, parent, isMain) {
  if (request === 'express') return fakeExpress;
  return originalLoad.apply(this, arguments);
};
global.fetch = fakeFetch;

const imagenesRouter = require(path.join(__dirname, '..', 'src', 'routes', 'imagenes'));

Module._load = originalLoad;

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res._headers = {};
    res._body = null;
    res._ended = false;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    res.set = (k, v) => { res._headers[k] = v; return res; };
    res.send = (body) => { res._body = body; resolve(res); return res; };
    res.end = () => { res._ended = true; resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const entrada = imagenesRouter.__handlers.find(([metodo, args]) => metodo === 'get' && args[0] === '/logo');
  const handler = entrada[1][entrada[1].length - 1];

  // --- 1) Sin "url" ---
  const r1 = await invocarRuta(handler, { query: {} });
  check(r1._status === 400, 'GET /api/imagenes/logo sin "url" responde 400, no revienta');

  // --- 2) http (no https) ---
  const r2 = await invocarRuta(handler, { query: { url: 'http://www.mlbstatic.com/team-logos/117.svg' } });
  check(r2._status === 400, 'Una URL con http (no https) se rechaza con 400');

  // --- 3) dominio no permitido ---
  const r3 = await invocarRuta(handler, { query: { url: 'https://sitio-cualquiera.com/logo.png' } });
  check(r3._status === 400, 'Un dominio fuera del whitelist (no mlbstatic.com/espncdn.com) se rechaza con 400 — no es un proxy genérico');

  // --- 4) URL válida, dominio permitido -> 200 con el content-type y el body reales ---
  const r4 = await invocarRuta(handler, { query: { url: 'https://www.mlbstatic.com/team-logos/117.svg' } });
  check(r4._status === 200 && r4._body, 'Una URL https de mlbstatic.com responde 200 con el body de la imagen');
  check(r4._headers['Content-Type'] === 'image/svg+xml', 'El content-type que devuelve es el que trajo el CDN real (no un genérico fijo)');
  check(/max-age/.test(r4._headers['Cache-Control'] || ''), 'Se cachea fuerte del lado del navegador (los logos no cambian)');

  // --- 5) el CDN real responde ok:false (ej. 404) -> 502 ---
  const r5 = await invocarRuta(handler, { query: { url: 'https://a.espncdn.com/i/teamlogos/nfl/500/no-existe.png' } });
  check(r5._status === 502, 'Si el CDN real no encuentra la imagen, el proxy responde 502 (no 200 con contenido vacío ni revienta)');

  // --- 6) el fetch en sí falla (red caída) -> 502, no revienta el servidor ---
  SIMULAR_ERROR_RED = true;
  const r6 = await invocarRuta(handler, { query: { url: 'https://www.mlbstatic.com/team-logos/117.svg' } });
  check(r6._status === 502, 'Si el fetch al CDN falla de plano (excepción de red), el proxy responde 502 en vez de tumbar el servidor');
  SIMULAR_ERROR_RED = false;

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba del proxy de logos se cayó con una excepción:', e);
  process.exit(1);
});
