// =================================================================
// PRUEBA: GET /api/hipismo/semana-por-dias (24-09-2026, décimosexta
// ronda) — ver la nota grande de la ruta en routes/hipismo.js.
//
// Casos cubiertos, a partir de los 3 pedidos del usuario para esta
// pantalla:
//   1. "la tabla va mostrando los dias a medida que vayan cargando y
//      teniendo informacion... si estamos a jueves, no muestres viernes
//      sabado y domingo vacios" — un día sin ninguna jugada/apuesta no
//      aparece en `dias` ni en las filas de cada cliente.
//   2. "cuando hay carreras los lunes el lunes va al lado del domingo" —
//      el lunes queda al FINAL del arreglo `dias` (pegado al domingo),
//      no al principio, aunque la semana se siga calculando lunes-a-
//      domingo por dentro (rangoSemana no cambia).
//   3. "abajo a final de la lista debe ir el item comision grupo" — el
//      backend ahora también manda `comisionPorDia` (alineado con
//      `dias`) y `comisionSemana`, sumando Tercios + Remate + Jugadas
//      Adelantadas, igual que ya hace GET /cierre-final pero por día.
//
// Mismo patrón de base de datos falsa en memoria que
// test_hipismo_reportes.js/test_hipismo_remate.js (Module._load
// intercepta "pg"/"express"/"bcryptjs"/"jsonwebtoken" antes de requerir
// el router real), y mismo truco de pisar Date.now() para que la prueba
// no dependa del día real en que se corre (semana lunes 21 a domingo 27
// de septiembre de 2026 — la misma semana ya usada en
// test_hipismo_remate.js).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-semana-1';
const LUNES = '2026-09-21';
const MARTES = '2026-09-22'; // sin datos -> no debe aparecer
const MIERCOLES = '2026-09-23';
const JUEVES = '2026-09-24'; // sin datos -> no debe aparecer
const VIERNES = '2026-09-25'; // sin datos -> no debe aparecer
const SABADO = '2026-09-26'; // sin datos -> no debe aparecer
const DOMINGO = '2026-09-27';

const TABLAS = {
  hipismo_planos: [
    { id: 'plano-lunes', grupo_id: GRUPO_ID, fecha: LUNES, comision_total: 2.5 },
    { id: 'plano-miercoles', grupo_id: GRUPO_ID, fecha: MIERCOLES, comision_total: 1.5 }
  ],
  hipismo_tickets: [
    { plano_id: 'plano-lunes', grupo_id: GRUPO_ID, cliente_nombre: 'CARLOS', banquero_nombre: 'BANCO', resultado_jugador: 50, resultado_banquero: -52.5, fecha: LUNES },
    { plano_id: 'plano-miercoles', grupo_id: GRUPO_ID, cliente_nombre: 'ANA', banquero_nombre: 'BANCO2', resultado_jugador: -30, resultado_banquero: 28.5, fecha: MIERCOLES }
  ],
  hipismo_remates: [
    { id: 'remate-domingo', grupo_id: GRUPO_ID, fecha: DOMINGO, comision_total: 20 }
  ],
  hipismo_remate_apuestas: [
    { remate_id: 'remate-domingo', grupo_id: GRUPO_ID, cliente_nombre: 'CARLOS', resultado: 100, fecha: DOMINGO }
  ],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, p\.fecha\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId && t.fecha >= desde && t.fecha <= hasta);
    return { rows: filas.map(t => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, fecha: t.fecha })) };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, r\.fecha\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas.filter(a => a.grupo_id === grupoId && a.fecha >= desde && a.fecha <= hasta);
    return { rows: filas.map(a => ({ cliente_nombre: a.cliente_nombre, resultado: a.resultado, fecha: a.fecha })) };
  }
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores, p\.fecha\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3 GROUP BY fecha/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const porFecha = new Map();
    TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId && p.fecha >= desde && p.fecha <= hasta).forEach(p => {
      porFecha.set(p.fecha, (porFecha.get(p.fecha) || 0) + Number(p.comision_total));
    });
    return { rows: Array.from(porFecha.entries()).map(([fecha, total]) => ({ fecha, total })) };
  }
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3 GROUP BY fecha/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const porFecha = new Map();
    TABLAS.hipismo_remates.filter(r => r.grupo_id === grupoId && r.fecha >= desde && r.fecha <= hasta).forEach(r => {
      porFecha.set(r.fecha, (porFecha.get(r.fecha) || 0) + Number(r.comision_total));
    });
    return { rows: Array.from(porFecha.entries()).map(([fecha, total]) => ({ fecha, total })) };
  }
  if (/^SELECT p\.fecha AS fecha, j\.comision\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }

  throw new Error('La base de datos falsa de esta prueba (semana-por-dias) no sabe responder: ' + sql);
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
const handlerSemanaPorDias = handlerDe('get', '/semana-por-dias');

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
  return { grupoId, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: {}, query: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // Pisa Date.now() para que "hoy" caiga en la semana lunes 21 a domingo
  // 27 de septiembre de 2026 (mismo truco que test_hipismo_remate.js).
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-23T12:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };
  let res;
  try {
    res = await invocarRuta(handlerSemanaPorDias, Object.assign(reqBase(GRUPO_ID), { query: { semana: 'actual' } }));
  } finally {
    global.Date = OriginalDate;
  }

  check(res._status === 200, 'GET /api/hipismo/semana-por-dias responde 200');
  check(res._json.rango.desde === LUNES && res._json.rango.hasta === DOMINGO, 'El rango sigue siendo lunes 21 a domingo 27 (rangoSemana no cambió)');

  // --- 1) y 2): días filtrados + lunes al final, pegado al domingo ---
  const fechasDias = res._json.dias.map(d => d.fecha);
  check(fechasDias.length === 3, 'Solo aparecen los 3 días con datos (martes/jueves/viernes/sábado, sin datos, quedan afuera)');
  check(!fechasDias.includes(MARTES) && !fechasDias.includes(JUEVES) && !fechasDias.includes(VIERNES) && !fechasDias.includes(SABADO), 'Ninguno de los días vacíos aparece en "dias"');
  check(JSON.stringify(fechasDias) === JSON.stringify([MIERCOLES, DOMINGO, LUNES]), 'Orden: miércoles, domingo, LUNES al final (pegado al domingo) — no lunes primero');
  check(res._json.dias[2].fecha === LUNES && res._json.dias[2].nombre === 'Lunes', 'El último elemento de "dias" es el lunes');

  // --- clientes: orden alfabético + porDia alineado a "dias" filtrado/reordenado ---
  const nombres = res._json.clientes.map(c => c.nombre);
  check(JSON.stringify(nombres) === JSON.stringify(['ANA', 'BANCO', 'BANCO2', 'CARLOS']), 'Clientes en orden alfabético: ANA, BANCO, BANCO2, CARLOS');
  const carlos = res._json.clientes.find(c => c.nombre === 'CARLOS');
  check(JSON.stringify(carlos.porDia) === JSON.stringify([0, 100, 50]), 'CARLOS: 0 el miércoles, +100 el domingo (remate), +50 el lunes (ticket) — mismo orden que "dias"');
  check(carlos.totalSemana === 150, 'Total semanal de CARLOS = 50 (lunes) + 100 (domingo) = 150');
  const banco = res._json.clientes.find(c => c.nombre === 'BANCO');
  check(JSON.stringify(banco.porDia) === JSON.stringify([0, 0, -52.5]), 'BANCO (banqueador del lunes) queda en el último día (lunes), no en el primero');
  const ana = res._json.clientes.find(c => c.nombre === 'ANA');
  check(JSON.stringify(ana.porDia) === JSON.stringify([-30, 0, 0]), 'ANA: -30 el miércoles (primer día de la fila), 0 el resto');

  // --- 3) "Comisión Grupo": Tercios (lunes+miércoles) + Remate (domingo) ---
  check(JSON.stringify(res._json.comisionPorDia) === JSON.stringify([1.5, 20, 2.5]), 'comisionPorDia alineado a "dias": 1,5 miércoles (Tercios) + 20 domingo (Remate) + 2,5 lunes (Tercios)');
  check(res._json.comisionSemana === 24, 'comisionSemana = 1,5 + 20 + 2,5 = 24 (suma de Tercios + Remate de toda la semana)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Semana por Días se cayó con una excepción:', e);
  process.exit(1);
});
