// =================================================================
// PRUEBA: "Montos Apostados" con RANGO de fechas + "gano" por jugada
// (01-10-2026, a pedido del usuario: "EN MONTOS APOSTADOS MUESTRAME SI
// JUGO O DIO EL CABALLO... PUEDO FILTRAR POR CLIENTE Y POR FECHA...
// AGREGAR RANGO, Y MOSTRAS SIEMPRE POR DEFECTO SEMANA COMPLETA EN CURSO,
// PERO PUEDO ELEGIR UN DIA O DOS ETC LO QUE NECESITE"). Ver GET
// /montos-apostados?desde=&hasta= y obtenerApuestasDelRango() en
// routes/hipismo.js. Mismo patrón de base de datos falsa en memoria que
// test_hipismo_comisiones_devueltas_rango.js (su hermano directo — ese
// cubre /comisiones-devueltas, este cubre /montos-apostados).
//
// Casos cubiertos:
//   1. ?desde=&hasta= con 2 días distintos suma lo apostado de AMBOS días
//      para el mismo cliente.
//   2. Retrocompatibilidad: ?fecha= (como siempre) sigue funcionando
//      igual, con desde === hasta === fecha en la respuesta.
//   3. Sin NINGÚN parámetro, el default YA NO es "hoy" sino la semana
//      completa en curso (lunes a domingo) — se verifica contra el MISMO
//      cálculo de rangoSemana() que usa el backend, replicado acá.
//   4. "gano" por línea: Tercios (resultado_jugador), Remate (numero_
//      ejemplar vs numero_ganador/hubo_ganador) y Jugadas Adelantadas
//      (j.gano tal cual) — ver la nota grande en obtenerApuestasDelRango.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-montos-rango-1';
const FECHA_A = '2026-09-27';
const FECHA_B = '2026-09-28';

const TABLAS = {
  hipismo_planos: [
    { id: 'p-dia-a', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 3, fecha: FECHA_A },
    { id: 'p-dia-b', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 4, fecha: FECHA_B }
  ],
  hipismo_tickets: [
    // Día A: PEDRO ganó esa línea (resultado_jugador > 0) -> gano true.
    { id: 't-dia-a', plano_id: 'p-dia-a', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(5)', monto: 100, resultado_jugador: 95, resultado_banquero: -100 },
    // Día B: PEDRO perdió esa línea (resultado_jugador <= 0, ganó el banquero) -> gano false.
    { id: 't-dia-b', plano_id: 'p-dia-b', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(2)', monto: 300, resultado_jugador: -300, resultado_banquero: 285 }
  ],
  hipismo_remates: [
    // Remate del día A: ganó el (9), PEDRO jugó al (9) -> gano true.
    { id: 'rem-a', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 2, fecha: FECHA_A, numero_ganador: 9, hubo_ganador: true },
    // Remate del día B: "quedó para la banca" (nadie jugó el ganador) -> gano false para todos.
    { id: 'rem-b', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 5, fecha: FECHA_B, numero_ganador: 3, hubo_ganador: false }
  ],
  hipismo_remate_apuestas: [
    { id: 'ra-dia-a', grupo_id: GRUPO_ID, remate_id: 'rem-a', cliente_nombre: 'PEDRO', caballo: '(9)', numero_ejemplar: 9, monto: 20 },
    { id: 'ra-dia-b', grupo_id: GRUPO_ID, remate_id: 'rem-b', cliente_nombre: 'PEDRO', caballo: '(3)', numero_ejemplar: 3, monto: 15 }
  ],
  hipismo_adelantadas_planos: [
    { id: 'adplano-a', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', fecha: FECHA_A }
  ],
  hipismo_adelantadas_jugadas: [
    // Marca todavía sin pizarra -> gano: null (SIN DECIDIR).
    { id: 'adj-a', plano_id: 'adplano-a', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', tipo: 'marca', monto: 10, numero_ejemplar: null, numero1: 2, numero2: 7, carrera_numero: 6, gano: null }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerApuestasDelRango: UN día (desde === hasta) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha = \$2$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.numero_ejemplar, a\.monto, r\.hipodromo_nombre, r\.carrera_numero, r\.numero_ganador, r\.hubo_ganador\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha = \$2$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId)
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rm => rm.id === a.remate_id) }))
      .filter(({ r }) => r && r.fecha === fecha)
      .map(({ a, r }) => ({ id: a.id, cliente_nombre: a.cliente_nombre, caballo: a.caballo, numero_ejemplar: a.numero_ejemplar, monto: a.monto, hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero, numero_ganador: r.numero_ganador, hubo_ganador: r.hubo_ganador }));
    return { rows: filas };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.banqueadores, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId)
      .map(j => ({ j, p: TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ j, p }) => ({ id: j.id, cliente_nombre: j.cliente_nombre, tipo: j.tipo, monto: j.monto, resultado_cliente: j.resultado_cliente, numero_ejemplar: j.numero_ejemplar, numero1: j.numero1, numero2: j.numero2, carrera_numero: j.carrera_numero, gano: j.gano, banqueadores: j.banqueadores, hipodromo_nombre: p.hipodromo_nombre }));
    return { rows: filas };
  }

  // ---- obtenerApuestasDelRango: RANGO real (desde !== hasta, BETWEEN + trae `fecha`) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.numero_ejemplar, a\.monto, r\.hipodromo_nombre, r\.carrera_numero, r\.numero_ganador, r\.hubo_ganador, r\.fecha\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId)
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rm => rm.id === a.remate_id) }))
      .filter(({ r }) => r && r.fecha >= desde && r.fecha <= hasta)
      .map(({ a, r }) => ({ id: a.id, cliente_nombre: a.cliente_nombre, caballo: a.caballo, numero_ejemplar: a.numero_ejemplar, monto: a.monto, hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero, numero_ganador: r.numero_ganador, hubo_ganador: r.hubo_ganador, fecha: r.fecha }));
    return { rows: filas };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.banqueadores, p\.hipodromo_nombre, p\.fecha\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId)
      .map(j => ({ j, p: TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ j, p }) => ({ id: j.id, cliente_nombre: j.cliente_nombre, tipo: j.tipo, monto: j.monto, resultado_cliente: j.resultado_cliente, numero_ejemplar: j.numero_ejemplar, numero1: j.numero1, numero2: j.numero2, carrera_numero: j.carrera_numero, gano: j.gano, banqueadores: j.banqueadores, hipodromo_nombre: p.hipodromo_nombre, fecha: p.fecha }));
    return { rows: filas };
  }

  throw new Error('La base de datos falsa de esta prueba (montos-apostados-rango) no sabe responder: ' + sql);
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

// Mismo cálculo EXACTO que rangoSemana()/hoyVenezuela() en routes/hipismo.js
// (lunes a domingo, hora Venezuela = UTC-4), replicado acá para poder
// verificar el default "semana completa en curso" sin pisar la fecha real.
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDeFechaUTC(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function hoyVenezuelaLocal() { return new Date(Date.now() - 4 * 60 * 60 * 1000); }
function rangoSemanaLocal(fecha, offsetSemanas) {
  const diaSemana = fecha.getUTCDay();
  const diffHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(fecha);
  lunes.setUTCDate(lunes.getUTCDate() + diffHastaLunes + offsetSemanas * 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  return { desde: isoDeFechaUTC(lunes), hasta: isoDeFechaUTC(domingo) };
}

(async function main() {
  const handlerMontosApostados = handlerDe('get', '/montos-apostados');
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };

  // ---- 1) ?desde=&hasta= con los 2 días ----
  const resRango = await invocarRuta(handlerMontosApostados, { ...reqBase, query: { desde: FECHA_A, hasta: FECHA_B } });
  check(!!resRango, '1a) GET /montos-apostados?desde=&hasta= respondió algo');
  check(resRango.desde === FECHA_A && resRango.hasta === FECHA_B, '1b) Trae desde/hasta tal cual se pidieron');
  check(resRango.fecha === FECHA_A, '1c) `fecha` (retrocompatibilidad) queda igual a `desde`');
  check(resRango.clientes.length === 1, '1d) Solo aparece PEDRO');
  const pedro = resRango.clientes[0];
  check(Math.abs(pedro.total - 445) < 0.001,
    `1e) PEDRO suma los 2 días (100+20+300+15+10=445) -- dio ${pedro.total}`);
  check(pedro.detalle.length === 5, '1f) El detalle trae las 5 líneas de los 2 días juntos');

  // ---- 2) "gano" por línea, en el rango ----
  const tercA = pedro.detalle.find(d => d.tipo === 'tercios' && d.fecha === FECHA_A);
  check(!!tercA && tercA.gano === true, '2a) Tercios día A: PEDRO ganó esa línea (resultado_jugador=95>0) -> gano===true');
  const tercB = pedro.detalle.find(d => d.tipo === 'tercios' && d.fecha === FECHA_B);
  check(!!tercB && tercB.gano === false, '2b) Tercios día B: PEDRO perdió (resultado_jugador=-300) -> gano===false');
  const remA = pedro.detalle.find(d => d.tipo === 'remate' && d.fecha === FECHA_A);
  check(!!remA && remA.gano === true, '2c) Remate día A: jugó el (9), ganó el (9) -> gano===true');
  const remB = pedro.detalle.find(d => d.tipo === 'remate' && d.fecha === FECHA_B);
  check(!!remB && remB.gano === false, '2d) Remate día B: "quedó para la banca" (hubo_ganador=false) -> gano===false para todos');
  const marca = pedro.detalle.find(d => d.tipo === 'marca');
  check(!!marca && marca.gano === null, '2e) Marca sin pizarra todavía: gano===null (SIN DECIDIR), tal cual venía j.gano');

  // ---- 3) retrocompatibilidad -- solo ?fecha= ----
  const resSoloFecha = await invocarRuta(handlerMontosApostados, { ...reqBase, query: { fecha: FECHA_A } });
  check(resSoloFecha.fecha === FECHA_A && resSoloFecha.desde === FECHA_A && resSoloFecha.hasta === FECHA_A,
    '3a) Con solo ?fecha= (como siempre), desde === hasta === fecha');
  const pedroSoloFecha = resSoloFecha.clientes.find(c => c.nombre === 'PEDRO');
  check(!!pedroSoloFecha && pedroSoloFecha.total === 130,
    `3b) Retrocompatible: el mismo resultado de siempre para un solo día (100 Tercios + 20 Remate + 10 Marca del día A, sin el día B) -- dio ${pedroSoloFecha ? pedroSoloFecha.total : 'nada'}`);

  // ---- 4) sin NINGÚN parámetro -> default "semana completa en curso" ----
  const resSinParams = await invocarRuta(handlerMontosApostados, { ...reqBase, query: {} });
  const { desde: desdeEsperado, hasta: hastaEsperado } = rangoSemanaLocal(hoyVenezuelaLocal(), 0);
  check(resSinParams.desde === desdeEsperado && resSinParams.hasta === hastaEsperado,
    `4a) Sin parámetros, el default es la semana completa en curso (lunes a domingo) -- esperaba ${desdeEsperado}..${hastaEsperado}, dio ${resSinParams.desde}..${resSinParams.hasta}`);
  check(resSinParams.fecha === desdeEsperado, '4b) `fecha` (retrocompatibilidad) también queda en el lunes de esa semana');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
