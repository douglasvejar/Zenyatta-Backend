// =================================================================
// PRUEBA: GET /api/superadmin/grupos/:id/hipismo-cierre-final (30-09-2026,
// a pedido del usuario: "desde super admin muestrame en la pestaña
// balance por clientes, el balance general del grupo que corresponda
// modulo hipismo").
//
// Este endpoint es un wrapper fino sobre construirCierreFinalHipismo
// (services/hipismoResumenCliente.js) — la MISMA lógica que ya prueba
// test_hipismo_cierre_final_rango_personalizado.js contra GET
// /api/hipismo/cierre-final (routes/hipismo.js), así que esta prueba NO
// repite esa cobertura de reglas de negocio (TABLAS FIJAS, % DEVUELTO,
// cruce, etc.) — se enfoca en lo que es específico de ESTA ruta:
//   1. Un :id de grupo que no existe da 404 (no revienta).
//   2. Un grupo que existe pero NO tiene el módulo de Hipismo habilitado
//      también da 404 — nunca se le muestra Hipismo a un grupo que solo
//      tiene Deportes.
//   3. Con ?desde=&hasta= explícitos, arma exactamente ese rango y
//      devuelve el mismo shape {rango, clientes, comisionSemana, ...} que
//      ya arma construirCierreFinalHipismo — se confirma con un caso real
//      (un ticket dentro del rango, uno afuera).
//   4. Sin desde/hasta ni ?rango=, cae al default "semana" (mismo
//      contrato que ya usa /grupos/:id/balance-clientes de Deportes, ver
//      la nota grande en src/routes/superadmin.js) — se confirma que NO
//      revienta y arma el rango de la semana actual.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_HIP = 'grupo-hipismo-1';
const GRUPO_SIN_HIPISMO = 'grupo-solo-deportes';

const TABLAS = {
  grupos: [
    { id: GRUPO_HIP, modulo_hipismo_habilitado: true },
    { id: GRUPO_SIN_HIPISMO, modulo_hipismo_habilitado: false }
  ],
  hipismo_planos: [
    { id: 'plano-adentro', grupo_id: GRUPO_HIP, fecha: '2026-09-19' },
    { id: 'plano-afuera', grupo_id: GRUPO_HIP, fecha: '2026-09-23' }
  ],
  hipismo_tickets: [
    { plano_id: 'plano-adentro', grupo_id: GRUPO_HIP, cliente_nombre: 'ADENTRO', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 20, resultado_banquero: -21 },
    { plano_id: 'plano-afuera', grupo_id: GRUPO_HIP, cliente_nombre: 'AFUERA', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 100, resultado_banquero: -105 }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^SELECT id, modulo_hipismo_habilitado FROM grupos WHERE id = \$1$/i.test(sql)) {
    const [id] = params;
    const grupo = TABLAS.grupos.find(g => g.id === id);
    return { rows: grupo ? [{ id: grupo.id, modulo_hipismo_habilitado: grupo.modulo_hipismo_habilitado }] : [] };
  }
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: false, cruza_jugadas: false }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto(, j\.gano)?\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre, cc_av\.nombre AS cc_avalador_nombre/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes\s+WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3\s+GROUP BY cliente_nombre/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [{ total: 0 }] };
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

const entrada = superadminRouter.__handlers.find(([metodo, args]) => metodo === 'get' && args[0] === '/grupos/:id/hipismo-cierre-final');
if (!entrada) throw new Error('No se encontró la ruta GET /grupos/:id/hipismo-cierre-final');
const handler = entrada[1][entrada[1].length - 1];

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

(async function main() {
  // --- 1) Grupo que no existe ---
  const res1 = await invocarRuta(handler, { params: { id: 'grupo-que-no-existe' }, query: {} });
  check(res1._status === 404, '1) Un :id de grupo que no existe da 404');

  // --- 2) Grupo que existe pero sin el módulo de Hipismo habilitado ---
  const res2 = await invocarRuta(handler, { params: { id: GRUPO_SIN_HIPISMO }, query: {} });
  check(res2._status === 404, '2) Un grupo sin el módulo de Hipismo habilitado también da 404');

  // --- 3) Rango explícito ?desde=&hasta= ---
  const res3 = await invocarRuta(handler, { params: { id: GRUPO_HIP }, query: { desde: '2026-09-19', hasta: '2026-09-20' } });
  check(res3._status === 200, '3) Con ?desde=&hasta= válidos responde 200');
  check(res3._json.rango.desde === '2026-09-19' && res3._json.rango.hasta === '2026-09-20', 'El rango devuelto es exactamente el que se pidió');
  check(Array.isArray(res3._json.clientes), 'La respuesta trae la lista "clientes", igual que /api/hipismo/cierre-final');
  check(res3._json.clientes.some(c => c.nombre === 'ADENTRO'), 'ADENTRO (19-09, dentro del rango) sí aparece');
  check(res3._json.clientes.some(c => c.nombre === 'BANCA'), 'BANCA (banquero del ticket de ADENTRO) también aparece, mismo criterio que /cierre-final');
  check(!res3._json.clientes.some(c => c.nombre === 'AFUERA'), 'AFUERA (23-09, fuera del rango pedido) NO aparece');
  check(typeof res3._json.comisionSemana === 'number', 'La respuesta trae comisionSemana, igual que /api/hipismo/cierre-final');

  // --- 4) Sin desde/hasta ni ?rango=: cae al default "semana" sin reventar ---
  const res4 = await invocarRuta(handler, { params: { id: GRUPO_HIP }, query: {} });
  check(res4._status === 200, '4) Sin desde/hasta ni rango explícito responde 200 (cae al default "semana")');
  check(!!(res4._json.rango && res4._json.rango.desde && res4._json.rango.hasta), 'Devuelve un rango resuelto (la semana actual) en vez de reventar');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de GET /grupos/:id/hipismo-cierre-final se cayó con una excepción:', e);
  process.exit(1);
});
