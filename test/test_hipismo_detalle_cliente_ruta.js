// =================================================================
// PRUEBA: GET /api/hipismo/clientes/:nombre/detalle-semana (24-09-2026,
// nueva pestaña "Saldos > Detallado por Cliente") — ver la nota grande
// de la ruta en routes/hipismo.js. Esta prueba es sobre el WIRING de la
// ruta (busca al jugador por nombre+grupo, 404 si no existe, delega en
// construirResumenClienteHipismo) — la lógica de armado del resumen en
// sí ya está cubierta a fondo por test_hipismo_resumen_cliente.js.
//
// Mismo patrón de Module._load que test_hipismo_semana_por_dias.js
// (intercepta pg/express/bcryptjs/jsonwebtoken antes de requerir el
// router real).
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-detalle-1';

const TABLAS = {
  jugadores: [
    { id: 'jug-1', grupo_id: GRUPO_ID, nombre: 'HANRY', modulos_anclados: false, token: 'tok-hanry' }
  ],
  hipismo_tickets: [], hipismo_planos: [], hipismo_hipodromos: [],
  hipismo_remate_apuestas: [], hipismo_remates: [],
  hipismo_adelantadas_jugadas: [], hipismo_adelantadas_planos: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1 AND nombre = \$2/i.test(sql)) {
    const [grupoId, nombre] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && j.nombre === nombre) };
  }
  // Las 3 consultas de obtenerLineasHipismoCliente (sin datos en esta
  // prueba, que solo verifica el wiring de la ruta, no los montos).
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (detalle-cliente ruta) no sabe responder: ' + sql);
}

function fakePool() {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
}
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
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));

Module._load = originalLoad;

function handlerDe(metodo, rutaPath) {
  const entrada = hipismoRouter.__handlers.find(([m, args]) => m === metodo && args[0] === rutaPath);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo.toUpperCase() + ' ' + rutaPath);
  return entrada[1][entrada[1].length - 1];
}
const handlerDetalle = handlerDe('get', '/clientes/:nombre/detalle-semana');

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
function reqBase(grupoId) {
  return { grupoId, grupo: { nombre: 'Zenyatta', logo_url: null, modulo_deportes_habilitado: true }, params: {}, query: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const resOk = await invocarRuta(handlerDetalle, Object.assign(reqBase(GRUPO_ID), { params: { nombre: 'HANRY' }, query: { semana: 'actual' } }));
  check(resOk._status === 200, 'GET /clientes/HANRY/detalle-semana responde 200 para un cliente que existe');
  check(resOk._json.jugador.nombre === 'HANRY', 'Trae el nombre del jugador correcto');
  check(resOk._json.grupo.nombre === 'Zenyatta', 'Trae el nombre del grupo de la sesión (req.grupo), no uno buscado aparte');

  const res404 = await invocarRuta(handlerDetalle, Object.assign(reqBase(GRUPO_ID), { params: { nombre: 'NOEXISTE' }, query: {} }));
  check(res404._status === 404, 'Un cliente que no existe en este grupo da 404, no revienta');

  const resOtroGrupo = await invocarRuta(handlerDetalle, Object.assign(reqBase('otro-grupo-id'), { params: { nombre: 'HANRY' }, query: {} }));
  check(resOtroGrupo._status === 404, 'HANRY de OTRO grupo no es visible — la búsqueda está scoped por grupo_id, no solo por nombre');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de la ruta de detalle de cliente se cayó con una excepción:', e);
  process.exit(1);
});
