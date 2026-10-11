// =================================================================
// PRUEBA: la comisión del grupo en "Jugadas entre Tercios Adelantadas" ya
// resueltas debe aparecer en "Comisión por Carrera de Clientes"
// (GET /comisiones-por-carrera). Caso real 11-10-2026: "las jugadas
// adelantadas SÍ calculan bien los tercios, pero la comisión que se gana
// el grupo de esas jugadas no se ve reflejada en la comisión".
//   1. Carrera con plano + Tercios Adelantadas: se suma a la MISMA carrera.
//   2. Carrera de Tercios Adelantadas sin plano: aparece (planoId null).
//   3. El detalle trae al cliente que ganó y el texto de la jugada.
//   4. No cuentan pendientes, otro grupo ni comisión 0.
//   5. Los totales (carrera/hipódromo/día/general) cuadran.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g1';
const OTRO_GRUPO_ID = 'g2';
let FECHA = null; // se calcula con /semana-actual

const TABLAS = { planos: [], tercios: [] };

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, hipodromo_nombre, carrera_numero, comision_total FROM hipismo_planos/i.test(sql)) {
    const [g, d, h] = params;
    return { rows: TABLAS.planos.filter(p => p.grupo_id === g && p.fecha >= d && p.fecha <= h) };
  }
  if (/^SELECT plano_id, cliente_nombre, banquero_nombre, modalidad, caballo, monto/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre, j\.resultado_jugador[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas j JOIN/i.test(sql)) {
    const [g, d, h] = params;
    return { rows: TABLAS.tercios.filter(j => j.grupo_id === g && j.fecha >= d && j.fecha <= h && j.estado === 'resuelto' && j.comision_grupo > 0) };
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


const handlerSemana = handlerDe('get', '/semana-actual');
const handlerPorCarrera = handlerDe('get', '/comisiones-por-carrera');

(async function main() {
  const rs = await invocarRuta(handlerSemana, reqBase(GRUPO_ID));
  FECHA = rs._json.rango.desde;

  const t = (extra) => Object.assign({ grupo_id: GRUPO_ID, fecha: FECHA, estado: 'resuelto', jugador_nombre: 'Pedro', banquero_nombre: 'Luis', resultado_jugador: 40, resultado_banquero: -40, es_cruce: false, grupo_caballos: [1, 2], modalidad: 'g' }, extra);
  TABLAS.planos = [
    { id: 'p1', grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'Keeneland', carrera_numero: 3, comision_total: 6.5 },
    { id: 'p2', grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'Keeneland', carrera_numero: 5, comision_total: 4 }
  ];
  TABLAS.tercios = [
    t({ hipodromo_nombre: 'Keeneland', carrera_numero: 3, comision_grupo: 2 }),
    t({ hipodromo_nombre: 'Aqueduct', carrera_numero: 9, comision_grupo: 1.5, es_cruce: true, cruce_grupo_a: [1], cruce_grupo_b: [2, 3], modalidad: 'p', resultado_jugador: -10, resultado_banquero: 8.5, jugador_nombre: 'Ana' }),
    t({ hipodromo_nombre: 'Keeneland', carrera_numero: 3, estado: 'pendiente', comision_grupo: 77 }),
    t({ hipodromo_nombre: 'Keeneland', carrera_numero: 3, grupo_id: OTRO_GRUPO_ID, comision_grupo: 88 }),
    t({ hipodromo_nombre: 'Keeneland', carrera_numero: 3, comision_grupo: 0 })
  ];

  const r = await invocarRuta(handlerPorCarrera, reqBase(GRUPO_ID));
  check(r._status === 200, '1) responde 200');
  const dia = r._json.dias.find(d => d.fecha === FECHA);
  check(!!dia, '2) el día de las jugadas aparece');
  const kee = dia.hipodromos.find(h => h.nombre === 'Keeneland');
  const aqu = dia.hipodromos.find(h => h.nombre === 'Aqueduct');
  const c3 = kee.carreras.find(c => c.carreraNumero === 3);
  check(c3.totalComision === 8.5, '3) Keeneland 3ra = 6.50 del plano + 2.00 de Tercios Adelantadas = 8.50 (dio ' + c3.totalComision + ')');
  check(c3.planoId === 'p1', '3b) conserva su planoId');
  check(c3.detalle.length === 1 && c3.detalle[0].cliente === 'Pedro' && c3.detalle[0].comision === 2 && /adelantada entre tercios/.test(c3.detalle[0].jugada) && /1y2 G/.test(c3.detalle[0].jugada), '4) el detalle trae al cliente que ganó (Pedro), la jugada y los 2.00');
  check(kee.carreras.map(c => c.carreraNumero).join(',') === '3,5', '5) carreras de Keeneland ordenadas 3,5');
  check(Math.abs(kee.totalComision - 12.5) < 0.001, '6) subtotal Keeneland = 6.50 + 4 + 2 = 12.50 (dio ' + kee.totalComision + ')');
  const c9 = aqu.carreras[0];
  check(aqu.carreras.length === 1 && c9.carreraNumero === 9 && c9.planoId === null && c9.totalComision === 1.5, '7) Aqueduct 9na (sin plano) aparece con 1.50 y planoId null');
  check(c9.detalle[0].cliente === 'Luis' && /1 x 2y3 P/.test(c9.detalle[0].jugada), '8) en el cruce, gana el banquero (Luis) y la jugada se lee "1 x 2y3 P"');
  check(Math.abs(dia.totalComision - 14) < 0.001, '9) total del día = 12.50 + 1.50 = 14.00 (dio ' + dia.totalComision + ')');
  check(Math.abs(r._json.totalGeneral - 14) < 0.001, '10) total general = 14.00 (no se coló pendiente/otro grupo/comisión 0)');

  // Semana solo con Tercios Adelantadas (sin ningún plano)
  TABLAS.planos = [];
  const r2 = await invocarRuta(handlerPorCarrera, reqBase(GRUPO_ID));
  check(Math.abs(r2._json.totalGeneral - 3.5) < 0.001 && r2._json.dias.length === 1, '11) sin planos pero con Tercios Adelantadas igual muestra 3.50 (no responde vacío)');

  // Sin nada
  TABLAS.tercios = [];
  const r3 = await invocarRuta(handlerPorCarrera, reqBase(GRUPO_ID));
  check(r3._json.dias.length === 0 && r3._json.totalGeneral === 0, '12) sin nada responde dias: [] y total 0');

  // El % configurado del plano (3%, no el 5% fijo) es lo que se queda el grupo
  const calc = require(path.join(__dirname, '..', 'src', 'services', 'hipismoTerciosAdelantadasCalc'));
  const linea = { monto: 100, cruce: { gruposA: [[1]], gruposB: [[3]] } };
  const rank = h => ({ 1: 1, 2: 2, 3: 3, 4: 4 })[h];
  const c3pct = calc.resolverLineaTerciosAdelantada(linea, rank, 3);
  const c5pct = calc.resolverLineaTerciosAdelantada(linea, rank, 5);
  check(c3pct.comisionGrupo === 3 && c3pct.montoJugadorMostrado === 97, '13) con 3%: el ganador cobra 97 y el grupo se queda 3 (dio ' + c3pct.comisionGrupo + ')');
  check(c5pct.comisionGrupo === 5 && c5pct.montoJugadorMostrado === 95, '14) con 5%: el ganador cobra 95 y el grupo se queda 5 (sigue igual que Tercios normal)');
  check(calc.parsearPlanoTerciosAdelantadas('NOTA= TERCIOS ADELANTADOS -3%\n1ra Pedro 100 x Luis 1y2 g').pctSugerido === 3, '15) el 3% de "NOTA= ... -3%" se lee del plano');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  if (fallaron > 0) process.exit(1);
})().catch(e => { console.error('Error inesperado en la prueba:', e); process.exit(1); });
