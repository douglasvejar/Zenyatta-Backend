// =================================================================
// PRUEBA: neteo jugador vs banquero por carrera (Tercios), aplicado a
// "Semana por Días" — GET /api/hipismo/semana-por-dias (02-10-2026,
// Task #41 del barrido completo pedido por el usuario — ver la nota
// grande EXACTA de netearJugadorBanqueroTercios en services/hipismoCalc.js
// y de test_hipismo_neteo_jugador_banquero.js / test_hipismo_neteo_cierre_
// final.js / test_hipismo_neteo_saldo_comisiones.js, que ya cubren los
// otros 3 reportes de % devuelto).
//
// Mismo escenario de GG, pero esta vez repartido en 2 DÍAS DISTINTOS de
// la misma semana (no 2 carreras del mismo día) para probar que el
// neteo por CARRERA (nunca por semana completa) también funciona
// correctamente cuando cada carrera cae en una fecha distinta:
//   - Lunes (carrera 7, La Rinconada): GG jugó 30 (perdió) y banqueó 10
//     (ganó neto) -> neto 20 -> % devuelto ese día: 0,20 (1%).
//   - Miércoles (carrera 9, La Rinconada): GG jugó 10 (perdió) y banqueó
//     30 (ganó neto) -> neto 20 -> % devuelto ese día: 0,20 (1%).
//   - totalSemana de "GG - PORCENTAJE": 0,40 (nunca 0 por netear toda la
//     semana junta, ni 0,80 por no netear nada).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-neteo-semana-1';
const LUNES = '2026-09-21';
const MIERCOLES = '2026-09-23';
const HOY_FALSO = '2026-09-26T18:00:00Z'; // sábado, misma semana (lunes 21 a domingo 27)

const PCT = 1;
function jugador(nombre) { return { id: 'j-' + nombre.toLowerCase(), grupo_id: GRUPO_ID, nombre, comision_propia: PCT }; }

const TABLAS = {
  jugadores: [jugador('GG'), jugador('MARLON1'), jugador('MARLON2'), jugador('PEPE'), jugador('LOLA')],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-carrera7', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 7, fecha: LUNES, comision_total: 0 },
    { id: 'p-carrera9', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 9, fecha: MIERCOLES, comision_total: 0 }
  ],
  hipismo_tickets: [
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'MARLON1', monto: 30, resultado_jugador: -30, resultado_banquero: 30 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'PEPE', banquero_nombre: 'GG', monto: 10, resultado_jugador: -10, resultado_banquero: 10 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera9', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'MARLON2', monto: 10, resultado_jugador: -10, resultado_banquero: 10 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera9', grupo_id: GRUPO_ID, cliente_nombre: 'LOLA', banquero_nombre: 'GG', monto: 30, resultado_jugador: -30, resultado_banquero: 30 * 0.95, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: [],
  hipismo_winners: [], hipismo_comisiones_ajustes: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision || false, cruza_jugadas: p.cruza_jugadas || false, fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto, r\.fecha\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores, j\.monto, j\.gano, p\.fecha\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_winners WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3 GROUP BY fecha$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT p\.fecha AS fecha, j\.comision\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
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

  throw new Error('La base de datos falsa de esta prueba (neteo-semana-por-dias) no sabe responder: ' + sql);
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
  const OriginalDate = Date;
  const fake = new OriginalDate(HOY_FALSO).getTime();
  global.Date = class extends OriginalDate { constructor(...a) { if (a.length === 0) super(fake); else super(...a); } static now() { return fake; } };

  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };
  const salida = await invocarRuta(handlerDe('get', '/semana-por-dias'), { ...reqBase, query: {} });
  check(!!salida, '1) GET /semana-por-dias respondió algo');
  const clientes = (salida && salida.clientes) || [];
  const dias = (salida && salida.dias) || [];

  const idxLunes = dias.findIndex(d => d.fecha === LUNES);
  const idxMiercoles = dias.findIndex(d => d.fecha === MIERCOLES);
  check(idxLunes >= 0 && idxMiercoles >= 0, `2) Lunes y miércoles aparecen entre los días con datos -- dias=${JSON.stringify(dias.map(d => d.fecha))}`);

  const ggPorcentaje = clientes.find(c => c.nombre === 'GG - PORCENTAJE');
  check(!!ggPorcentaje, '3) "GG - PORCENTAJE" aparece como cliente');
  check(!!ggPorcentaje && Math.abs(ggPorcentaje.porDia[idxLunes] - 0.20) < 0.001,
    `4) ARREGLO: "GG - PORCENTAJE" el lunes (carrera 7, neto 20) da +0,20 -- dio ${ggPorcentaje ? ggPorcentaje.porDia[idxLunes] : 'nada'}`);
  check(!!ggPorcentaje && Math.abs(ggPorcentaje.porDia[idxMiercoles] - 0.20) < 0.001,
    `5) ARREGLO: "GG - PORCENTAJE" el miércoles (carrera 9, neto 20) da +0,20 -- dio ${ggPorcentaje ? ggPorcentaje.porDia[idxMiercoles] : 'nada'}`);
  check(!!ggPorcentaje && Math.abs(ggPorcentaje.totalSemana - 0.40) < 0.001,
    `6) ARREGLO: totalSemana de "GG - PORCENTAJE" = 0,40 (nunca 0 por netear toda la semana, ni 0,80 por no netear nada) -- dio ${ggPorcentaje ? ggPorcentaje.totalSemana : 'nada'}`);

  // Regresión: los demás clientes (un solo rol por carrera) no cambian.
  const marlon1 = clientes.find(c => c.nombre === 'MARLON1 - PORCENTAJE');
  const marlon2 = clientes.find(c => c.nombre === 'MARLON2 - PORCENTAJE');
  const pepe = clientes.find(c => c.nombre === 'PEPE - PORCENTAJE');
  const lola = clientes.find(c => c.nombre === 'LOLA - PORCENTAJE');
  check(!!marlon1 && Math.abs(marlon1.totalSemana - 0.30) < 0.001, `7) MARLON1 - PORCENTAJE da 0,30 -- dio ${marlon1 ? marlon1.totalSemana : 'nada'}`);
  check(!!marlon2 && Math.abs(marlon2.totalSemana - 0.10) < 0.001, `8) MARLON2 - PORCENTAJE da 0,10 -- dio ${marlon2 ? marlon2.totalSemana : 'nada'}`);
  check(!!pepe && Math.abs(pepe.totalSemana - 0.10) < 0.001, `9) PEPE - PORCENTAJE da 0,10 -- dio ${pepe ? pepe.totalSemana : 'nada'}`);
  check(!!lola && Math.abs(lola.totalSemana - 0.30) < 0.001, `10) LOLA - PORCENTAJE da 0,30 -- dio ${lola ? lola.totalSemana : 'nada'}`);

  global.Date = OriginalDate;
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
