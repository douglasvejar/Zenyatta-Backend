// =================================================================
// PRUEBA: "Comisiones Totales por Hipódromo" (24-09-2026, a pedido del
// usuario: "crea abajo una nueva que se va a llamar comsiones totales
// por hipodromo : alli saldria el total por carrea por hipodromo del
// dia seleccionado") — ver la nota grande en routes/hipismo.js, GET
// /comisiones-por-hipodromo.
//
// A diferencia de /comisiones-por-carrera (que agrupa por SEMANA), esta
// ruta es de UN SOLO DÍA y no necesita tocar hipismo_tickets — lee
// directo hipismo_planos.comision_total (ya calculado por carrera) y
// solo agrupa/suma por hipódromo. Mismo patrón de base de datos falsa en
// memoria que test_hipismo_reportes.js (Module._load intercepta
// "pg"/"express" antes de requerir el router real).
//
// Casos cubiertos:
//   1. Agrupa por hipódromo, ordenado alfabéticamente, con cada carrera
//      y su comisión, más un subtotal por hipódromo y un total general —
//      mismos números del ejemplo real que pegó el usuario (Assiniboia:
//      3.25+6.25+6.50+1.85+7.50+18.00 = 43.35).
//   2. Filtra por grupo_id Y por fecha — un plano de otro grupo o de otra
//      fecha no debe aparecer.
//   3. Sin planos ese día: responde hipodromos: [] y totalGeneral: 0 (no
//      un error).
//   4. Sin ?fecha=, usa la fecha de "hoy" en hora de Venezuela (mismo
//      default que /montos-apostados y /comisiones-devueltas) — se
//      verifica que no explota y responde 200 con esa fecha.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-hipodromo-1';
const OTRO_GRUPO_ID = 'grupo-hipodromo-2';
const FECHA = '2026-09-24';
const OTRA_FECHA = '2026-09-23';

const TABLAS = {
  hipismo_planos: [
    // Assiniboia (24-09-2026): mismo ejemplo numérico que pegó el
    // usuario — 6 carreras, subtotal 43.35.
    { id: 'p-ass-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 1, fecha: FECHA, comision_total: 3.25 },
    { id: 'p-ass-2', grupo_id: GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 2, fecha: FECHA, comision_total: 6.25 },
    { id: 'p-ass-3', grupo_id: GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 3, fecha: FECHA, comision_total: 6.50 },
    { id: 'p-ass-4', grupo_id: GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 4, fecha: FECHA, comision_total: 1.85 },
    { id: 'p-ass-5', grupo_id: GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 5, fecha: FECHA, comision_total: 7.50 },
    { id: 'p-ass-6', grupo_id: GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 6, fecha: FECHA, comision_total: 18.00 },
    // Churchill Downs: 2 carreras, para probar que un segundo hipódromo
    // no se mezcla con el primero y queda ordenado alfabéticamente
    // DESPUÉS de Assiniboia.
    { id: 'p-cd-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'Churchill Downs', carrera_numero: 3, fecha: FECHA, comision_total: 10 },
    { id: 'p-cd-2', grupo_id: GRUPO_ID, hipodromo_nombre: 'Churchill Downs', carrera_numero: 7, fecha: FECHA, comision_total: 5.5 },
    // Otro grupo, misma fecha — NO debe aparecer.
    { id: 'p-otro-grupo', grupo_id: OTRO_GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 1, fecha: FECHA, comision_total: 999 },
    // Mismo grupo, otra fecha — NO debe aparecer al pedir FECHA.
    { id: 'p-otra-fecha', grupo_id: GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 1, fecha: OTRA_FECHA, comision_total: 500 }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^SELECT hipodromo_nombre, carrera_numero, comision_total\s+FROM hipismo_planos\s+WHERE grupo_id = \$1 AND fecha = \$2\s+ORDER BY hipodromo_nombre, carrera_numero$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_planos
      .filter(p => p.grupo_id === grupoId && p.fecha === fecha)
      .sort((a, b) => a.hipodromo_nombre.localeCompare(b.hipodromo_nombre) || a.carrera_numero - b.carrera_numero)
      .map(p => ({ hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, comision_total: p.comision_total }));
    return { rows: filas };
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
const handlerComisionesPorHipodromo = handlerDe('get', '/comisiones-por-hipodromo');

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
  return { grupoId, grupo: { nombre: 'Zenyatta' }, params: {}, query: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) Agrupa por hipódromo, ordenado, con subtotales y total general ---
  const res1 = await invocarRuta(handlerComisionesPorHipodromo, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(res1._status === 200, 'GET /comisiones-por-hipodromo responde 200');
  check(res1._json.fecha === FECHA, 'la respuesta trae la fecha pedida');
  check(res1._json.hipodromos.length === 2, 'trae exactamente 2 hipódromos (Assiniboia, Churchill Downs)');
  check(res1._json.hipodromos[0].nombre === 'Assiniboia', 'el primer hipódromo (alfabético) es Assiniboia');
  check(res1._json.hipodromos[1].nombre === 'Churchill Downs', 'el segundo hipódromo es Churchill Downs');
  check(res1._json.hipodromos[0].carreras.length === 6, 'Assiniboia trae sus 6 carreras');
  check(res1._json.hipodromos[0].carreras[0].carreraNumero === 1 && res1._json.hipodromos[0].carreras[0].comision === 3.25, 'la 1ra carrera de Assiniboia trae $3.25');
  check(res1._json.hipodromos[0].carreras[5].carreraNumero === 6 && res1._json.hipodromos[0].carreras[5].comision === 18, 'la 6ta carrera de Assiniboia trae $18.00');
  check(Math.abs(res1._json.hipodromos[0].totalComision - 43.35) < 0.001, 'el subtotal de Assiniboia da $43.35 (mismo ejemplo del usuario)');
  check(Math.abs(res1._json.hipodromos[1].totalComision - 15.5) < 0.001, 'el subtotal de Churchill Downs da $15.50 (10 + 5.50)');
  check(Math.abs(res1._json.totalGeneral - 58.85) < 0.001, 'el total general suma los 2 hipódromos ($43.35 + $15.50 = $58.85)');

  // --- 2) Filtra por grupo_id y por fecha (no se cuela el otro grupo ni la otra fecha) ---
  const totalSoloAsignado = res1._json.hipodromos[0].carreras.reduce((s, c) => s + c.comision, 0);
  check(Math.abs(totalSoloAsignado - 43.35) < 0.001, 'no se coló el plano de OTRO_GRUPO_ID (999) ni el de OTRA_FECHA (500) en el subtotal de Assiniboia');

  // --- 3) Sin planos ese día: responde vacío, no un error ---
  const res3 = await invocarRuta(handlerComisionesPorHipodromo, Object.assign(reqBase(GRUPO_ID), { query: { fecha: '2026-01-01' } }));
  check(res3._status === 200, 'un día sin planos responde 200 (no un error)');
  check(Array.isArray(res3._json.hipodromos) && res3._json.hipodromos.length === 0, 'un día sin planos trae hipodromos: []');
  check(res3._json.totalGeneral === 0, 'un día sin planos trae totalGeneral: 0');

  // --- 4) Sin ?fecha=, usa el default (hoy en hora Venezuela) sin explotar ---
  const res4 = await invocarRuta(handlerComisionesPorHipodromo, reqBase(GRUPO_ID));
  check(res4._status === 200, 'sin ?fecha= igual responde 200, usando el default de "hoy"');
  check(typeof res4._json.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(res4._json.fecha), 'el default de fecha tiene forma YYYY-MM-DD');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  if (fallaron > 0) process.exit(1);
})().catch(e => {
  console.error('Error inesperado en la prueba:', e);
  process.exit(1);
});
