// =================================================================
// PRUEBA: ítem "WINNERS" en GET /api/hipismo/cierre-final (28-09-2026,
// a pedido del usuario: "al cargar winners, ya le sale reflejada al
// cliente su jugada y su positivo y negativo eso esta excelente, pero
// eso debe ir contra el codigo llamado winners.... si lusho tiene +400
// en winners, winners debe decir -400... igual que un cliente... todo
// negativo debe tener su contra parte reflejado en la contabilidad,
// nuestra contabilidad es balances y cierre").
//
// Hasta esta ronda, GET /cierre-final sumaba el resultado de cada fila
// de hipismo_winners al saldo del cliente (acumular(cliente, monto))
// pero NUNCA le daba una contraparte — el mismo bug de "TABLAS FIJAS"/
// "PORCENTAJE MARCAS" arreglado antes en esta sesión, ahora en Winners.
//
// Casos cubiertos (Balance General y Cierre Final usan el MISMO
// endpoint, así que esta prueba cubre las 2 pantallas):
//   1. Si LUSHO tiene +400 en Winners, aparece un ítem "WINNERS" con
//      -400 — exactamente el espejo, ni un centavo de más o de menos.
//   2. Con VARIAS filas de Winners (mismo cliente 2 veces, y 2 clientes
//      distintos, algunos ganando y otros perdiendo), "WINNERS" suma el
//      espejo de TODAS — el balance completo cuadra en 0 (suma de
//      todos los saldos, incluyendo WINNERS, da exactamente 0).
//   3. Un cliente que pierde en Winners (monto negativo) también le
//      deja su contraparte POSITIVA a "WINNERS" (si el cliente pierde,
//      "WINNERS" gana esos mismos ítem completo).
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-winners-1';
const FECHA = '2026-09-24'; // jueves, semana lunes 21 a domingo 27 de sept de 2026

const TABLAS = {
  hipismo_winners: [
    { grupo_id: GRUPO_ID, cliente_nombre: 'LUSHO', monto: 400, fecha: FECHA },
    { grupo_id: GRUPO_ID, cliente_nombre: 'LUSHO', monto: 50, fecha: FECHA },     // 2da fila del mismo cliente -> se suma
    { grupo_id: GRUPO_ID, cliente_nombre: 'CARLA', monto: -120, fecha: FECHA }    // CARLA PIERDE en Winners
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto, j\.gano.*\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_winners.filter(w => w.grupo_id === grupoId && w.fecha >= desde && w.fecha <= hasta);
    return { rows: filas.map(w => ({ cliente_nombre: w.cliente_nombre, monto: w.monto })) };
  }
  if (/^SELECT j\.nombre, j\.comision_propia, j\.porcentaje_devuelto_destino, j\.porcentaje_devuelto_aval, av\.nombre AS aval_nombre,/i.test(sql)) {
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

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };

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
const handlerCierreFinal = handlerDe('get', '/cierre-final');

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

function reqBase(grupoId, query) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, params: {}, query: query || {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const res = await invocarRuta(handlerCierreFinal, reqBase(GRUPO_ID, { desde: FECHA, hasta: FECHA }));
  check(res._status === 200, '1) GET /cierre-final responde 200');

  const lusho = res._json.clientes.find(c => c.nombre === 'LUSHO');
  const carla = res._json.clientes.find(c => c.nombre === 'CARLA');
  const winners = res._json.clientes.find(c => c.nombre === 'WINNERS');

  check(!!lusho && lusho.saldo === 450, 'LUSHO: 400 + 50 = +450,00 (2 filas de Winners, mismo cliente, se suman)');
  check(!!carla && carla.saldo === -120, 'CARLA: -120,00 (perdió en Winners)');
  check(!!winners, 'El ítem "WINNERS" existe en la lista de clientes/saldos');
  check(winners && winners.saldo === -330, '2) "WINNERS": -(450) + -(-120) = -450 + 120 = -330,00 — el espejo EXACTO de la suma de todos los clientes');

  // 3) El balance completo cuadra: sumando TODOS los saldos (LUSHO +
  // CARLA + WINNERS) el resultado tiene que dar EXACTAMENTE 0 — la
  // prueba de fuego de que "todo negativo tiene su contraparte" que
  // pidió el usuario.
  const sumaTotal = res._json.clientes.reduce((acc, c) => acc + Number(c.saldo), 0);
  check(Math.round(sumaTotal * 100) / 100 === 0, '3) La suma de TODOS los saldos (LUSHO + CARLA + WINNERS) da exactamente 0 — el balance cuadra');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
