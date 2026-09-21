// =================================================================
// PRUEBA: routes/descargas.js (⬇️ Descargar > 📅 Saldos Semana) — que la
// ruta exista, que esté protegida por requiereGrupo + el permiso nuevo
// 'descargar' (21-09-2026, PERMISOS_VALIDOS en middleware/auth.js), y
// que devuelva el JSON armado por services/saldosSemana.js usando
// req.grupoId/req.grupo.nombre/req.grupo.logo_url de la sesión — NO un
// :id de la URL (a diferencia de la versión de Súper-admin).
// =================================================================
const assert = require('assert');
const path = require('path');
const Module = require('module');
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

const fakePool = function () {
  this.query = async () => ({ rows: [] });
  this.on = () => {};
};

const fakes = { express: fakeExpress, pg: { Pool: fakePool }, jsonwebtoken: { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'g1' }) } };
Module._load = function (request, parent, isMain) {
  if (fakes[request]) return fakes[request];
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const { PERMISOS_VALIDOS, requierePermiso } = require(path.join(__dirname, '..', 'src', 'middleware', 'auth'));
const router = require(path.join(__dirname, '..', 'src', 'routes', 'descargas'));
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

check(PERMISOS_VALIDOS.includes('descargar'), "'descargar' es uno de los permisos válidos por empleado (aparece solo con esto en el checklist de Empleados)");

// router.use(requiereGrupo) y router.use(requierePermiso('descargar'))
// deben estar cargados ANTES de definir la ruta GET /saldos-semana.
const usosMiddleware = router.__handlers.filter(([m]) => m === 'use');
check(usosMiddleware.length >= 2, 'la ruta engancha al menos 2 middlewares de "use" (requiereGrupo + requierePermiso)');

const rutaSaldos = router.__handlers.find(([m, args]) => m === 'get' && args[0] === '/saldos-semana');
check(!!rutaSaldos, 'existe GET /saldos-semana');

function fakeRes() {
  const res = {};
  let marcarListo;
  res.__listo = new Promise(resolve => { marcarListo = resolve; });
  res.status = c => { res.statusCode = c; return res; };
  res.json = data => { res.body = data; marcarListo(); return res; };
  return res;
}

(async function main() {
  // Simula un req YA autenticado por requiereGrupo (esta prueba no
  // vuelve a probar requiereGrupo/requierePermiso en sí — eso ya lo
  // cubren test_empleados.js y demás; solo confirma que ESTA ruta
  // consume req.grupoId/req.grupo tal como los deja ese middleware).
  const req = {
    grupoId: 'g1',
    grupo: { nombre: 'Deportes Bernal', logo_url: 'https://ejemplo.com/logo.png' },
    query: { fecha: '2026-09-17' },
    rol: 'administrador',
    permisos: null
  };
  const res = fakeRes();
  const handler = rutaSaldos[1][rutaSaldos[1].length - 1]; // asyncHandler(fn)
  handler(req, res, () => {});
  await res.__listo;

  check(res.body && res.body.grupo && res.body.grupo.nombre === 'Deportes Bernal', 'la respuesta trae el nombre del grupo de la SESIÓN (req.grupo), no de ningún :id de la URL');
  check(res.body.grupo.logoUrl === 'https://ejemplo.com/logo.png', 'la respuesta trae el logo del grupo de la sesión');
  check(res.body.semana && res.body.semana.desde === '2026-09-14' && res.body.semana.hasta === '2026-09-20', 'respeta ?fecha= para elegir la semana (jueves 17 -> semana del 14 al 20)');
  check(Array.isArray(res.body.clientes), 'la respuesta trae un arreglo de clientes (vacío en esta prueba, sin ningún jugador en la base falsa)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de la ruta Descargar se cayó con una excepción:', e);
  process.exit(1);
});
