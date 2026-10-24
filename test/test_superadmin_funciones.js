// =================================================================
// PRUEBA: panel de funciones por sección en Súper-admin (13-10-2026). Crear grupo eligiendo módulos y secciones, guardar las
// secciones de un grupo existente, y el catálogo que alimenta el panel. Base falsa en memoria que captura el SQL.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
process.env.JWT_SECRET = 'clave-de-prueba';
process.env.DATABASE_URL = 'postgresql://fake/fake';

const consultas = [];
let grupoFila = { id: 'g1', funciones_habilitadas: null };
function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^ALTER TABLE grupos ADD COLUMN IF NOT EXISTS funciones_habilitadas/i.test(sql)) return { rows: [] };
  if (/^SELECT 1 FROM grupos WHERE lower\(email\) = \$1/i.test(sql)) return { rows: [] };
  consultas.push({ sql, params });
  if (/^INSERT INTO grupos/i.test(sql)) return { rows: [{ id: 'nuevo', nombre: params[0], email: params[1], activo: false, creado_en: '2026-10-13' }] };
  if (/^UPDATE grupos SET funciones_habilitadas/i.test(sql)) {
    if (params[1] !== 'g1') return { rows: [] };
    grupoFila = { id: 'g1', funciones_habilitadas: params[0] === null ? null : JSON.parse(params[0]) };
    return { rows: [grupoFila] };
  }
  throw new Error('La base de datos falsa no sabe responder: ' + sql);
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...args) => { handlers.push([m, args]); return router; }; });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'hash-falso', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({}) };
  return originalLoad.apply(this, arguments);
};
const superRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin'));
Module._load = originalLoad;

function handlerDe(m, p) { const e = superRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocar(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    const r = handler(req, res, (e) => { if (e) reject(e); });
    if (r && typeof r.catch === 'function') r.catch(reject);
  }).catch(e => console.error('ERROR INESPERADO:', e.message));
  return { salida, status };
}
let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }

(async function () {
  // 1) catálogo
  const cat = await invocar(handlerDe('get', '/funciones-catalogo'), { params: {}, query: {}, body: {} });
  check(cat.salida && cat.salida.funciones.length >= 25 && cat.salida.paquetes.completo && cat.salida.modulos.hipismo, '1) el catálogo trae módulos, secciones y paquetes');

  // 2) crear grupo sin elegir nada: igual que siempre (sin columnas de más)
  consultas.length = 0;
  let r = await invocar(handlerDe('post', '/grupos'), { params: {}, query: {}, body: { nombre: 'A', email: 'a@a.com', password: 'xxxx' } });
  const q1 = consultas[0];
  check(r.status === 201 && q1 && !/funciones_habilitadas|modulo_/i.test(q1.sql), '2) crear sin elegir nada no toca módulos ni funciones (todas, como antes)');

  // 3) crear con módulos y secciones
  consultas.length = 0;
  r = await invocar(handlerDe('post', '/grupos'), { params: {}, query: {}, body: { nombre: 'B', email: 'b@b.com', password: 'xxxx', moduloDeportes: false, moduloHipismo: true, moduloOficinas: true, funciones: ['hip_planos', 'hip_pozos', 'inventada'] } });
  const q2 = consultas[0];
  check(r.status === 201 && /modulo_deportes_habilitado/.test(q2.sql) && /modulo_hipismo_habilitado/.test(q2.sql) && /modulo_hipismo_oficinas_habilitado/.test(q2.sql) && /funciones_habilitadas/.test(q2.sql), '3a) crear con módulos y secciones guarda las 4 columnas');
  const guardada = JSON.parse(q2.params[q2.params.length - 1]);
  check(JSON.stringify(guardada) === JSON.stringify(['hip_planos', 'hip_pozos']), '3b) las claves inventadas se descartan y queda solo lo válido');
  check(q2.params[3] === false && q2.params.includes(true), '3c) los módulos elegidos se guardan como booleanos (Deportes apagado, Hipismo y Oficinas encendidos)');

  // 4) crear con paquete
  consultas.length = 0;
  r = await invocar(handlerDe('post', '/grupos'), { params: {}, query: {}, body: { nombre: 'C', email: 'c@c.com', password: 'xxxx', paquete: 'deportes_basico' } });
  const g4 = JSON.parse(consultas[0].params[consultas[0].params.length - 1]);
  check(g4.includes('sabana') && !g4.includes('polla') && !g4.some(c => c.startsWith('hip_')), '4) crear con paquete aplica el paquete');

  // 5) guardar funciones de un grupo existente
  consultas.length = 0;
  r = await invocar(handlerDe('put', '/grupos/:id/funciones'), { params: { id: 'g1' }, query: {}, body: { funciones: ['hip_winners', 'sabana'] } });
  check(r.status === 200 && r.salida.funcionesPersonalizadas === true && r.salida.funcionesHabilitadas.join() === 'sabana,hip_winners', '5a) PUT guarda y responde las secciones en el orden del catálogo');
  r = await invocar(handlerDe('put', '/grupos/:id/funciones'), { params: { id: 'g1' }, query: {}, body: { funciones: null } });
  check(r.salida.funcionesPersonalizadas === false && r.salida.funcionesHabilitadas.length >= 25 && consultas[consultas.length - 1].params[0] === null, '5b) funciones: null = todas (se guarda NULL)');
  r = await invocar(handlerDe('put', '/grupos/:id/funciones'), { params: { id: 'g1' }, query: {}, body: { paquete: 'hipismo_basico' } });
  check(r.salida.funcionesHabilitadas.includes('hip_planos') && !r.salida.funcionesHabilitadas.includes('hip_comisiones'), '5c) PUT con paquete');
  r = await invocar(handlerDe('put', '/grupos/:id/funciones'), { params: { id: 'zzz' }, query: {}, body: { funciones: [] } });
  check(r.status === 404, '5d) grupo inexistente responde 404');
  r = await invocar(handlerDe('put', '/grupos/:id/funciones'), { params: { id: 'g1' }, query: {}, body: {} });
  check(r.status === 400, '5e) sin lista responde 400');
  r = await invocar(handlerDe('put', '/grupos/:id/funciones'), { params: { id: 'g1' }, query: {}, body: { paquete: 'no-existe' } });
  check(r.status === 400, '5f) paquete desconocido responde 400');

  console.log(`\n${pasaron} OK, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
