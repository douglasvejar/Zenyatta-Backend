// =================================================================
// PRUEBA: "Comisiones Devueltas por Hipódromo" y "Saldo Comisiones"
// (24-09-2026, vigesimocuarta ronda, a pedido del usuario):
//   - "la venta comisiones devueltas metela en la pestaña comisiones...
//     colocale como nombre comisiones devuelta por hipodromo, alli debo
//     ver ordenado por hipodromo por carrera, cuanto se a devuelto de
//     comision" — ver GET /comisiones-devueltas-por-hipodromo en
//     routes/hipismo.js.
//   - "saldo comisiones si esta sacando el % que se le devuelve a cada
//     cliente" — hasta esta ronda esa pantalla mostraba datos de ejemplo
//     fijos; ahora es real. Ver GET /saldo-comisiones.
//
// Mismo patrón de base de datos falsa en memoria y mismo truco de pisar
// Date.now() que test_hipismo_semana_por_dias.js (semana lunes 21 a
// domingo 27 de septiembre de 2026).
//
// Casos cubiertos:
//   1. GET /comisiones-devueltas-por-hipodromo?fecha=: agrupa por
//      hipódromo > carrera, SUMANDO entre todos los clientes con % propio
//      configurado (un cliente sin % configurado no aporta nada), con
//      subtotal por hipódromo y total general — un plano de otro grupo o
//      de otra fecha no se cuela.
//   2. Un día sin ninguna devolución: responde hipodromos: [] y
//      totalGeneral: 0 (no un error).
//   3. GET /comisiones-devueltas?fecha= ya trae totalGeneral (nuevo campo
//      de esta ronda, suma de los totales de todos los clientes).
//   4. GET /saldo-comisiones?semana=actual|anterior|hace2: mismo % propio
//      por cliente, sumado para TODA la semana (Tercios + Remate,
//      cualquier jugada como JUGADOR) — un cliente sin % configurado no
//      aparece.
//   5. Sin ?semana=, usa 'actual' por defecto sin explotar.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-devueltas-hip-1';
const OTRO_GRUPO_ID = 'grupo-devueltas-hip-2';
const FECHA = '2026-09-24'; // jueves, semana lunes 21 a domingo 27 de sept de 2026
// Fuera de esa semana a propósito (no solo de FECHA) — así también sirve
// para probar que /saldo-comisiones, que agrupa por SEMANA, no se la
// cuela (si cayera dentro de la misma semana igual habría que sumarla).
const OTRA_FECHA = '2026-09-14';

const TABLAS = {
  jugadores: [
    { id: 'jug-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 1, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' },
    { id: 'jug-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', comision_propia: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' }
  ],
  hipismo_planos: [
    { id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA },
    { id: 'plano-2', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 2, fecha: FECHA },
    { id: 'plano-otro-grupo', grupo_id: OTRO_GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 1, fecha: FECHA },
    { id: 'plano-otra-fecha', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 9, fecha: OTRA_FECHA }
  ],
  hipismo_tickets: [
    // Carrera 1: PEDRO apostó 100 -> 1% = 1.00 devuelto.
    { id: 'ticket-1', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(5)', monto: 100 },
    // Carrera 2: PEDRO apostó 200 -> 2.00 devuelto; MARIA apostó 50 pero
    // no tiene % configurado -> no aporta nada al reporte.
    { id: 'ticket-2', plano_id: 'plano-2', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '2P', caballo: '(3)', monto: 200 },
    { id: 'ticket-3', plano_id: 'plano-2', grupo_id: GRUPO_ID, cliente_nombre: 'MARIA', modalidad: '1P', caballo: '(7)', monto: 50 },
    // Otro grupo -- NUNCA debe aparecer.
    { id: 'ticket-otro-grupo', plano_id: 'plano-otro-grupo', grupo_id: OTRO_GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(1)', monto: 999 },
    // Otra fecha -- no debe aparecer al pedir FECHA.
    { id: 'ticket-otra-fecha', plano_id: 'plano-otra-fecha', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(1)', monto: 500 }
  ],
  hipismo_remates: [
    { id: 'remate-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'Churchill Downs', carrera_numero: 5, fecha: FECHA }
  ],
  hipismo_remate_apuestas: [
    // Churchill Downs, carrera 5: PEDRO apostó 100 -> 1.00 devuelto.
    { id: 'ra-1', grupo_id: GRUPO_ID, remate_id: 'remate-1', cliente_nombre: 'PEDRO', caballo: '(2)', monto: 100 }
  ],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerApuestasDelDia (usada por /comisiones-devueltas-por-hipodromo) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.modalidad, t\.caballo, t\.monto, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.monto, r\.hipodromo_nombre, r\.carrera_numero\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId)
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rm => rm.id === a.remate_id) }))
      .filter(({ r }) => r && r.fecha === fecha)
      .map(({ a, r }) => ({ id: a.id, cliente_nombre: a.cliente_nombre, caballo: a.caballo, monto: a.monto, hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }

  // ---- consultas de /saldo-comisiones (semana, BETWEEN) ----
  if (/^SELECT t\.cliente_nombre, t\.monto\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t }) => ({ cliente_nombre: t.cliente_nombre, monto: t.monto }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId)
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rm => rm.id === a.remate_id) }))
      .filter(({ r }) => r && r.fecha >= desde && r.fecha <= hasta)
      .map(({ a }) => ({ cliente_nombre: a.cliente_nombre, monto: a.monto }));
    return { rows: filas };
  }
  if (/^SELECT j\.cliente_nombre, j\.monto\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }

  if (/^SELECT j\.nombre, j\.comision_propia, j\.porcentaje_devuelto_destino, j\.porcentaje_devuelto_aval, av\.nombre AS aval_nombre\s+FROM jugadores j\s+LEFT JOIN jugadores av ON av\.id = j\.avalado_por_id\s+WHERE j\.grupo_id = \$1 AND j\.nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => ({
        nombre: j.nombre, comision_propia: j.comision_propia || 0,
        porcentaje_devuelto_destino: j.porcentaje_devuelto_destino || 'cliente',
        porcentaje_devuelto_aval: j.porcentaje_devuelto_aval || 0,
        aval_nombre: j.avalado_por_id ? ((TABLAS.jugadores.find(x => x.id === j.avalado_por_id) || {}).nombre || null) : null
      }))
    };
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
const handlerComisionesDevueltas = handlerDe('get', '/comisiones-devueltas');
const handlerComisionesDevueltasHipodromo = handlerDe('get', '/comisiones-devueltas-por-hipodromo');
const handlerSaldoComisiones = handlerDe('get', '/saldo-comisiones');

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
  // --- 1) GET /comisiones-devueltas-por-hipodromo ---
  const res1 = await invocarRuta(handlerComisionesDevueltasHipodromo, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(res1._status === 200, '1) GET /comisiones-devueltas-por-hipodromo responde 200');
  check(res1._json.fecha === FECHA, 'Trae la fecha pedida');
  check(res1._json.hipodromos.length === 2, 'Trae 2 hipódromos (Churchill Downs, La Rinconada)');
  check(res1._json.hipodromos[0].nombre === 'Churchill Downs', 'Orden alfabético: Churchill Downs primero');
  check(res1._json.hipodromos[1].nombre === 'La Rinconada', 'La Rinconada segundo');
  const churchill = res1._json.hipodromos[0];
  check(churchill.carreras.length === 1 && churchill.carreras[0].carreraNumero === 5 && churchill.carreras[0].devuelto === 1, 'Churchill Downs: carrera 5 con 1,00 devuelto (1% de 100 de Remate)');
  check(churchill.totalDevuelto === 1, 'Subtotal de Churchill Downs: 1,00');
  const rinconada = res1._json.hipodromos[1];
  check(rinconada.carreras.length === 2, 'La Rinconada trae sus 2 carreras');
  check(rinconada.carreras.find(c => c.carreraNumero === 1).devuelto === 1, 'Carrera 1: 1,00 devuelto (1% de 100 de PEDRO)');
  check(rinconada.carreras.find(c => c.carreraNumero === 2).devuelto === 2, 'Carrera 2: 2,00 devuelto (1% de 200 de PEDRO; MARIA no aporta, sin % configurado)');
  check(rinconada.totalDevuelto === 3, 'Subtotal de La Rinconada: 3,00 (1,00 + 2,00)');
  check(res1._json.totalGeneral === 4, 'Total general del día: 4,00 (1,00 Churchill Downs + 3,00 La Rinconada) — no se cuela ni el otro grupo (999) ni la otra fecha (500)');

  // --- 2) Un día sin ninguna devolución: vacío, no error ---
  const res2 = await invocarRuta(handlerComisionesDevueltasHipodromo, Object.assign(reqBase(GRUPO_ID), { query: { fecha: '2026-01-01' } }));
  check(res2._status === 200, '2) Un día sin devoluciones responde 200 (no un error)');
  check(Array.isArray(res2._json.hipodromos) && res2._json.hipodromos.length === 0, 'hipodromos: [] cuando no hay nada ese día');
  check(res2._json.totalGeneral === 0, 'totalGeneral: 0 cuando no hay nada ese día');

  // --- 3) GET /comisiones-devueltas ya trae totalGeneral ---
  const res3 = await invocarRuta(handlerComisionesDevueltas, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(res3._status === 200, '3) GET /comisiones-devueltas responde 200');
  check(res3._json.totalGeneral === 4, 'totalGeneral (nuevo campo de esta ronda) suma los totales de todos los clientes: 4,00 (PEDRO: 1,00 + 2,00 + 1,00 de Remate)');

  // --- 4) y 5) GET /saldo-comisiones — pisa Date.now() para que "hoy" caiga
  // en la semana lunes 21 a domingo 27 de sept de 2026 (mismo truco que
  // test_hipismo_semana_por_dias.js). ---
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-23T12:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };
  let res4, res5;
  try {
    res4 = await invocarRuta(handlerSaldoComisiones, Object.assign(reqBase(GRUPO_ID), { query: { semana: 'actual' } }));
    res5 = await invocarRuta(handlerSaldoComisiones, reqBase(GRUPO_ID)); // sin ?semana=
  } finally {
    global.Date = OriginalDate;
  }
  check(res4._status === 200, '4) GET /saldo-comisiones?semana=actual responde 200');
  check(res4._json.rango.desde === '2026-09-21' && res4._json.rango.hasta === '2026-09-27', 'El rango es lunes 21 a domingo 27 de sept (semana de FECHA)');
  check(res4._json.clientes.length === 1, 'Solo aparece PEDRO (MARIA no tiene % propio configurado)');
  const pedroSaldo = res4._json.clientes[0];
  check(pedroSaldo.nombre === 'PEDRO' && pedroSaldo.porcentaje === 1, 'Trae a PEDRO con su 1% configurado');
  check(pedroSaldo.devueltoSemana === 4, 'PEDRO lleva 4,00 devueltos en la semana (1,00 + 2,00 de Tercios + 1,00 de Remate — la otra fecha y el otro grupo no se cuelan)');
  check(pedroSaldo.destino === 'PEDRO', 'Sin aval configurado, destino es el propio cliente');
  check(res4._json.totalGeneral === 4, 'totalGeneral de la semana: 4,00');
  check(res5._status === 200, '5) Sin ?semana=, usa "actual" por defecto sin explotar');
  check(res5._json.semana === 'actual', 'El default de semana es "actual"');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
