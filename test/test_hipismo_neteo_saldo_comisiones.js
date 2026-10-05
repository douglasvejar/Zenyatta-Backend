// =================================================================
// PRUEBA: neteo jugador vs banquero por carrera (Tercios), aplicado a
// "Saldo Comisiones" — GET /api/hipismo/saldo-comisiones (02-10-2026,
// Task #40 del barrido completo pedido por el usuario — ver la nota
// grande EXACTA de netearJugadorBanqueroTercios en services/hipismoCalc.js
// y de test_hipismo_neteo_jugador_banquero.js, que ya cubre
// /comisiones-devueltas y /comisiones-devueltas-por-hipodromo, y
// test_hipismo_neteo_cierre_final.js, que ya cubre /cierre-final).
//
// Mismo escenario EXACTO de GG (jugó 30/banqueó 10 en la carrera 7, jugó
// 10/banqueó 30 en la carrera 9, misma Rinconada, mismo día) — acá se
// verifica que GET /saldo-comisiones da 0,40 para "GG" (su % devuelto
// neto), nunca 0 (neteando el día completo) ni 0,80 (sin netear).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-neteo-saldo-1';
const FECHA = '2026-10-02';

const PCT = 1; // 1% de porcentaje propio para todos, para que las cuentas sean fáciles
function jugador(nombre) { return { id: 'j-' + nombre.toLowerCase(), grupo_id: GRUPO_ID, nombre, comision_propia: PCT }; }

const TABLAS = {
  jugadores: [jugador('GG'), jugador('MARLON1'), jugador('MARLON2'), jugador('PEPE'), jugador('LOLA')],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-carrera7', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 7, fecha: FECHA },
    { id: 'p-carrera9', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 9, fecha: FECHA }
  ],
  hipismo_tickets: [
    // --- Carrera 7: GG jugó 30 (perdió completo) y banqueó 10 (ganó, neto de 5%) -> neto 20 ---
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'MARLON1', monto: 30, resultado_jugador: -30, resultado_banquero: 30 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'PEPE', banquero_nombre: 'GG', monto: 10, resultado_jugador: -10, resultado_banquero: 10 * 0.95, sin_comision: false },
    // --- Carrera 9 (MISMO día, otra carrera): GG jugó 10 y banqueó 30 -> neto 20 ---
    { plano_id: 'p-carrera9', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'MARLON2', monto: 10, resultado_jugador: -10, resultado_banquero: 10 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera9', grupo_id: GRUPO_ID, cliente_nombre: 'LOLA', banquero_nombre: 'GG', monto: 30, resultado_jugador: -30, resultado_banquero: 30 * 0.95, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- /saldo-comisiones: rTickets (semana, BETWEEN) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.monto, j\.resultado_cliente, j\.banqueadores, j\.gano.*\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }

  // ---- obtenerComisionesPropias ----
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && (!nombres || nombres.includes(j.nombre)));
    return { rows: filas.map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cc_propio_nombre: null })) };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (neteo-saldo-comisiones) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
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

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'h', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';

const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));

Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }

async function invocarRuta(handler, req) {
  let salida = null;
  await new Promise((resolve, reject) => {
    const res = { status(c) { this._s = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return salida;
}

(async function main() {
  // "Saldo Comisiones" usa `semana` (actual/anterior/hace2), no un rango
  // personalizado -- se fuerza la fecha de "hoy" a la misma FECHA de la
  // prueba vía Date (mismo patrón EXACTO que ya usa
  // test_hipismo_comision_banquero_tercios.js) para que caiga dentro de
  // "semana actual".
  const OriginalDate = Date;
  const fake = new OriginalDate(FECHA + 'T12:00:00Z').getTime();
  global.Date = class extends OriginalDate { constructor(...a) { if (a.length === 0) super(fake); else super(...a); } static now() { return fake; } };

  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };

  const salida = await invocarRuta(handlerDe('get', '/saldo-comisiones'), { ...reqBase, query: {} });
  check(!!salida, '1) GET /saldo-comisiones respondió algo');
  const clientes = (salida && salida.clientes) || [];
  const filaGG = clientes.find(c => c.nombre === 'GG');
  const filaMarlon1 = clientes.find(c => c.nombre === 'MARLON1');
  const filaMarlon2 = clientes.find(c => c.nombre === 'MARLON2');
  const filaPepe = clientes.find(c => c.nombre === 'PEPE');
  const filaLola = clientes.find(c => c.nombre === 'LOLA');

  check(!!filaGG && Math.abs(filaGG.devueltoSemana - 0.40) < 0.001,
    `2) ARREGLO: GG da 0,40 en /saldo-comisiones (neto 20 en cada una de sus 2 carreras, nunca 0 por netear el día completo, ni 0,80 por no netear nada) -- dio ${filaGG ? filaGG.devueltoSemana : 'nada'}`);
  check(!!filaMarlon1 && Math.abs(filaMarlon1.devueltoSemana - 0.30) < 0.001, `3) MARLON1 da 0,30 -- dio ${filaMarlon1 ? filaMarlon1.devueltoSemana : 'nada'}`);
  check(!!filaMarlon2 && Math.abs(filaMarlon2.devueltoSemana - 0.10) < 0.001, `4) MARLON2 da 0,10 -- dio ${filaMarlon2 ? filaMarlon2.devueltoSemana : 'nada'}`);
  check(!!filaPepe && Math.abs(filaPepe.devueltoSemana - 0.10) < 0.001, `5) PEPE da 0,10 -- dio ${filaPepe ? filaPepe.devueltoSemana : 'nada'}`);
  check(!!filaLola && Math.abs(filaLola.devueltoSemana - 0.30) < 0.001, `6) LOLA da 0,30 -- dio ${filaLola ? filaLola.devueltoSemana : 'nada'}`);

  const totalGeneralEsperado = 0.40 + 0.30 + 0.10 + 0.10 + 0.30; // 1,20
  check(Math.abs((salida && salida.totalGeneral) - totalGeneralEsperado) < 0.001,
    `7) totalGeneral de /saldo-comisiones = 1,20 -- dio ${salida && salida.totalGeneral}`);

  global.Date = OriginalDate;
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
