// =================================================================
// PRUEBA: pantallas de REVISIÓN en Saldos (11-10-2026) -- "Tablas y Marcas
// Premiadas" (GET /revision/tablas-marcas-premiadas) y "Adelantadas de
// Clientes" (GET /revision/adelantadas-clientes). Solo lectura: lista las
// jugadas con pizarra y resultado por día > hipódromo > carrera > cliente,
// con el saldo real del cliente y de cada banca, sin tocar ningún total.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g1';
const OTRO_GRUPO_ID = 'g2';
let FECHA = null;
const TABLAS = { adelantadas: [], tercios: [] };

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p/i.test(sql) && /j\.banqueadores, j\.pizarra_usada/i.test(sql)) {
    const [g, d, h] = params;
    return { rows: TABLAS.adelantadas.filter(j => j.grupo_id === g && j.fecha >= d && j.fecha <= h && ['resuelto', 'falta_banqueo'].includes(j.estado)) };
  }
  if (/FROM hipismo_tercios_adelantadas_jugadas j JOIN hipismo_tercios_adelantadas_planos p/i.test(sql) && /j\.pizarra_usada/i.test(sql)) {
    const [g, d, h] = params;
    return { rows: TABLAS.tercios.filter(j => j.grupo_id === g && j.fecha >= d && j.fecha <= h && j.estado === 'resuelto') };
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


const handlerTyM = handlerDe('get', '/revision/tablas-marcas-premiadas');
const handlerAdel = handlerDe('get', '/revision/adelantadas-clientes');

(async function main() {
  const rs = await invocarRuta(handlerSemana, reqBase(GRUPO_ID));
  FECHA = rs._json.rango.desde;

  const base = (extra) => Object.assign({ grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'Keeneland', carrera_numero: 5, estado: 'resuelto', tipo: 'tf', comision_porcentaje: 2.5, sin_comision: false, pizarra_usada: '3.1.2', cantidad_tf: null, numero_ejemplar: 3, precio_por_tf: null, ganancia_potencial: 100, numero1: null, numero2: null, banqueadores: null }, extra);
  TABLAS.adelantadas = [
    // Tabla Fija sin banqueadores: banca = TABLAS FIJAS neto de comision
    base({ id: 'a1', cliente_nombre: 'LINARES', monto: 75, gano: true, resultado_cliente: 225, comision: 1.88 }),
    // Marca ya banqueada por 2 (Houston 4x7 120, acierta): +100 / -50 / -51.25 / comision 1.25
    base({ id: 'a2', cliente_nombre: 'HOUSTON', tipo: 'marca', numero_ejemplar: null, numero1: 4, numero2: 7, monto: 120, gano: true, resultado_cliente: 100, comision: 1.25,
      banqueadores: [{ nombre: 'MARCAS ZENYATTA', porcentaje: 50, pagaComision: false, comisionPorcentaje: null, monto: -50 }, { nombre: 'MARCAS SAMMY', porcentaje: 50, pagaComision: true, comisionPorcentaje: 2.5, monto: -51.25 }] }),
    // Marca decidida sin banqueo todavia
    base({ id: 'a3', cliente_nombre: 'ANA', tipo: 'marca', numero_ejemplar: null, numero1: 1, numero2: 2, monto: 50, gano: false, resultado_cliente: -50, comision: null, estado: 'falta_banqueo', carrera_numero: 6 }),
    // NO deben salir: pendiente, sin_decidir, otro grupo
    base({ id: 'a4', cliente_nombre: 'X', estado: 'pendiente', monto: 10, resultado_cliente: null, comision: null }),
    base({ id: 'a5', cliente_nombre: 'Y', estado: 'sin_decidir', monto: 10, resultado_cliente: 0, comision: 0 }),
    base({ id: 'a6', cliente_nombre: 'Z', grupo_id: OTRO_GRUPO_ID, monto: 10, resultado_cliente: 5, comision: 0 }),
    // Cliente que pierde una TF: -80, banca +78, comision 2
    base({ id: 'a7', cliente_nombre: 'MANOLO', monto: 80, gano: false, resultado_cliente: -80, comision: 2, carrera_numero: 5 })
  ];
  const r = await invocarRuta(handlerTyM, reqBase(GRUPO_ID));
  check(r._status === 200, '1) tablas-marcas responde 200');
  const dia = r._json.dias[0];
  check(r._json.dias.length === 1 && dia.fecha === FECHA, '2) un solo día con jugadas');
  const hip = dia.hipodromos[0];
  check(hip.nombre === 'Keeneland' && hip.carreras.map(c => c.carreraNumero).join(',') === '5,6', '3) Keeneland con carreras 5 y 6 ordenadas');
  const c5 = hip.carreras[0];
  check(c5.pizarra === '3.1.2', '4) trae la pizarra de la carrera');
  check(c5.jugadas.length === 3, '5) la 5ta trae 3 jugadas (pendiente / sin_decidir / otro grupo excluidos) -- dio ' + c5.jugadas.length);
  const lin = c5.jugadas.find(j => j.cliente === 'LINARES');
  check(lin.tipo === 'tf' && lin.resultadoCliente === 225 && lin.banca.length === 1 && lin.banca[0].nombre === 'TABLAS FIJAS' && lin.banca[0].monto === -226.88 && lin.cuadra === true, '6) Linares +225 -> TABLAS FIJAS -226,88, cuadra con comisión 1,88');
  const man = c5.jugadas.find(j => j.cliente === 'MANOLO');
  check(man.resultadoCliente === -80 && man.banca[0].monto === 78 && man.cuadra === true, '7) Manolo -80 -> TABLAS FIJAS +78');
  const hou = c5.jugadas.find(j => j.cliente === 'HOUSTON');
  check(hou.tipo === 'marca' && hou.jugada === 'Marca 4 x 7' && hou.banca.length === 2 && hou.banca[1].monto === -51.25 && hou.comisionGrupo === 1.25 && hou.cuadra === true, '8) Houston: +100 / Zenyatta -50 / Sammy -51,25 / comisión 1,25 y cuadra');
  check(c5.jugadas.map(j => j.cliente).join(',') === 'HOUSTON,LINARES,MANOLO', '9) ordenadas por cliente dentro de la carrera (dio ' + c5.jugadas.map(j => j.cliente).join(',') + ')');
  const ana = hip.carreras[1].jugadas[0];
  check(ana.sinBanqueo === true && ana.banca.length === 0 && ana.cuadra === null, '10) Marca sin banqueo se marca sinBanqueo y sin banca');
  check(r._json.resumen.jugadas === 4 && r._json.resumen.tablas === 2 && r._json.resumen.marcas === 2 && r._json.resumen.sinBanqueo === 1, '11) resumen: 4 jugadas (2 tablas, 2 marcas, 1 sin banqueo)');
  check(Math.abs(r._json.resumen.clientes - (225 + 100 - 50 - 80)) < 0.001, '12) neto de clientes = 195');
  check(Math.abs(c5.totales.comisionGrupo - (1.88 + 1.25 + 2)) < 0.001, '13) comisión del grupo de la 5ta = 5,13');

  // Adelantadas de clientes
  const t = (extra) => Object.assign({ grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'Aqueduct', carrera_numero: 3, estado: 'resuelto', es_cruce: false, grupo_caballos: [1, 2], cruce_grupo_a: null, cruce_grupo_b: null, modalidad: 'g', monto: 100, comision_porcentaje: 3, resultado_jugador: 97, resultado_banquero: -100, comision_grupo: 3, pizarra_usada: '1.2.3', jugador_nombre: 'PEDRO', banquero_nombre: 'LUIS' }, extra);
  TABLAS.tercios = [
    t({ id: 't1' }),
    t({ id: 't2', jugador_nombre: 'ANA', banquero_nombre: 'LUIS', es_cruce: true, grupo_caballos: null, cruce_grupo_a: [1], cruce_grupo_b: [2, 3], modalidad: 'p', resultado_jugador: -50, resultado_banquero: 48.5, comision_grupo: 1.5, monto: 50 }),
    t({ id: 't3', estado: 'sin_decidir', resultado_jugador: 0, resultado_banquero: 0, comision_grupo: 0 }),
    t({ id: 't4', grupo_id: OTRO_GRUPO_ID })
  ];
  const r2 = await invocarRuta(handlerAdel, reqBase(GRUPO_ID));
  const car = r2._json.dias[0].hipodromos[0].carreras[0];
  check(car.jugadas.length === 2 && car.pizarra === '1.2.3', '14) adelantadas: 2 resueltas (sin_decidir y otro grupo excluidas)');
  check(car.jugadas.map(j => j.jugador).join(',') === 'ANA,PEDRO', '15) ordenadas por jugador');
  const ped = car.jugadas.find(j => j.jugador === 'PEDRO');
  check(ped.jugada === '1y2 G' && ped.resultadoJugador === 97 && ped.resultadoBanquero === -100 && ped.comisionGrupo === 3 && ped.ganador === 'jugador' && ped.cuadra === true, '16) Pedro: 1y2 G, +97 / -100, comisión 3 (3%) y cuadra');
  const ana2 = car.jugadas.find(j => j.jugador === 'ANA');
  check(ana2.jugada === '1 x 2y3 P' && ana2.ganador === 'banquero' && ana2.cuadra === true, '17) cruce 1 x 2y3 P, gana el banquero y cuadra');
  check(r2._json.resumen.jugadas === 2 && Math.abs(r2._json.resumen.comisionGrupo - 4.5) < 0.001, '18) resumen: 2 jugadas, comisión 4,50');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  if (fallaron > 0) process.exit(1);
})().catch(e => { console.error('Error inesperado en la prueba:', e); process.exit(1); });
