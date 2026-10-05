// =================================================================
// PRUEBA: neteo jugador vs banquero por carrera (Tercios), aplicado a
// Balance General / Cierre Final — GET /api/hipismo/cierre-final
// (02-10-2026, Task #39 del barrido completo pedido por el usuario:
// "Si solo arreglo 2 y dejo los otros 5 con la lógica vieja, vas a ver
// a GG con $0 en un reporte y con el monto viejo (sin netear) en
// otro... Barrido completo en los 7 lugares").
//
// Mismo escenario EXACTO que test_hipismo_neteo_jugador_banquero.js
// (que ya prueba /comisiones-devueltas y /comisiones-devueltas-por-
// hipodromo) — acá se verifica que construirCierreFinalHipismo()
// (la función "golden" detrás de /cierre-final, Balance General y la
// tarjeta de Grupo de Clientes) da EXACTAMENTE el mismo % devuelto para
// GG: 0,40 (neto de sus 2 carreras), nunca 0,80 (sin netear) ni 0
// (neteando el día completo en vez de por carrera).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-neteo-cierre-1';
const FECHA = '2026-10-02';

const PCT = 1; // 1% de porcentaje propio para todos, para que las cuentas sean fáciles
function jugador(nombre) { return { id: 'j-' + nombre.toLowerCase(), grupo_id: GRUPO_ID, nombre, comision_propia: PCT }; }

const TABLAS = {
  jugadores: [jugador('GG'), jugador('MARLON1'), jugador('MARLON2'), jugador('PEPE'), jugador('LOLA')],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-carrera7', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 7, fecha: FECHA, cruza_jugadas: false, comision_total: 0 },
    { id: 'p-carrera9', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 9, fecha: FECHA, cruza_jugadas: false, comision_total: 0 }
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
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: [],
  hipismo_winners: [], hipismo_comisiones_ajustes: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- /cierre-final: rTickets (semana/rango, BETWEEN) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision || false, cruza_jugadas: p.cruza_jugadas || false, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto, j\.gano.*\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
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
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (neteo-cierre-final) no sabe responder: ' + sql);
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
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };

  // Rango personalizado de un solo día (02-10-2026) para que solo entren
  // las 2 carreras de esta prueba.
  const salida = await invocarRuta(handlerDe('get', '/cierre-final'), { ...reqBase, query: { desde: FECHA, hasta: FECHA } });
  check(!!salida, '1) GET /cierre-final respondió algo');
  const clientes = (salida && salida.clientes) || [];

  const ggPorcentaje = clientes.find(c => c.nombre === 'GG - PORCENTAJE');
  check(!!ggPorcentaje && Math.abs(ggPorcentaje.saldo - 0.40) < 0.001,
    `2) ARREGLO: "GG - PORCENTAJE" da +0,40 en /cierre-final (neto 20 en cada una de sus 2 carreras, nunca 0 por netear el día completo, ni 0,80 por no netear nada) -- dio ${ggPorcentaje ? ggPorcentaje.saldo : 'nada'}`);

  // Los demás clientes (un solo rol por carrera) no cambian en nada --
  // mismos montos que ya probó test_hipismo_neteo_jugador_banquero.js
  // para /comisiones-devueltas.
  const marlon1Porcentaje = clientes.find(c => c.nombre === 'MARLON1 - PORCENTAJE');
  const marlon2Porcentaje = clientes.find(c => c.nombre === 'MARLON2 - PORCENTAJE');
  const pepePorcentaje = clientes.find(c => c.nombre === 'PEPE - PORCENTAJE');
  const lolaPorcentaje = clientes.find(c => c.nombre === 'LOLA - PORCENTAJE');
  check(!!marlon1Porcentaje && Math.abs(marlon1Porcentaje.saldo - 0.30) < 0.001, `3) MARLON1 - PORCENTAJE da +0,30 -- dio ${marlon1Porcentaje ? marlon1Porcentaje.saldo : 'nada'}`);
  check(!!marlon2Porcentaje && Math.abs(marlon2Porcentaje.saldo - 0.10) < 0.001, `4) MARLON2 - PORCENTAJE da +0,10 -- dio ${marlon2Porcentaje ? marlon2Porcentaje.saldo : 'nada'}`);
  check(!!pepePorcentaje && Math.abs(pepePorcentaje.saldo - 0.10) < 0.001, `5) PEPE - PORCENTAJE da +0,10 -- dio ${pepePorcentaje ? pepePorcentaje.saldo : 'nada'}`);
  check(!!lolaPorcentaje && Math.abs(lolaPorcentaje.saldo - 0.30) < 0.001, `6) LOLA - PORCENTAJE da +0,30 -- dio ${lolaPorcentaje ? lolaPorcentaje.saldo : 'nada'}`);

  // GG también tiene su saldo normal de jugadas (NUNCA afectado por el
  // neteo del % devuelto -- el neteo es SOLO para calcular el %, no para
  // el saldo real de ganancia/pérdida): -30 (perdió, carrera7) + 9,5
  // (ganó banqueando, carrera7) - 10 (perdió, carrera9) + 28,5 (ganó
  // banqueando, carrera9) = -2.
  const ggSaldo = clientes.find(c => c.nombre === 'GG');
  check(!!ggSaldo && Math.abs(ggSaldo.saldo - (-2)) < 0.001,
    `7) REGRESIÓN: el saldo normal de GG (jugadas, sin tocar) sigue dando -2,00 -- dio ${ggSaldo ? ggSaldo.saldo : 'nada'}`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
