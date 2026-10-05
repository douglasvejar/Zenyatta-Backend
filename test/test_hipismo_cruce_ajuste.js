// =================================================================
// PRUEBA: "Ajuste por cruce" (26-09-2026, a pedido del usuario, tras
// reportar con capturas + el plano real de LUSHO: "LOS PLANOS SI ME
// ESTAN CRUZANDO LAS JUGADAS SI ME LAS ESTA CRUZANDO FIJATE LUSHO-100
// PERO EN LOS BALANCES NO ME LA ESTA CRUZANDO... CORRIGE ..... ESO
// TAMBIEN MUEVE EL SALDO DE COMSION YA QUE AL CRUZAR LAS JUGADAS
// OBVIAMENTE QUEDA MENOS COMISION").
//
// Fixture: el plano REAL que pegó el usuario (Valencia, 1ra Carrera,
// TERCIOS, 7 líneas, cruza_jugadas=true) —
//   1) 10a7   (5) con 100: Richard -100 / Lusho    +95   (Lusho banquero)
//   2) 10a7   (5) con  50: Richard  -50 / Tony    +47.5
//   3) 10a7,5 (5) con 200: Lusho   -200 / Place   +190  (Lusho jugador)
//   4) 10a7,5 (5) con 100: Petit   -100 / Place    +95
//   5) 10a7,5 (5) con  50: Sammy    -50 / Yameko   +47.5
//   6) 10a7   (5) con  50: Alexis   -50 / Richard  +47.5 (Richard banquero)
//   7) 10a7   (5) con  50: Bombero  -50 / Tolerante +47.5
//
// "Sin cruzar" (lo que hasta ahora mostraban Balance General/Cierre
// Final/el link) LUSHO da -200+95 = -105,00 — exactamente la captura que
// mandó el usuario. "Cruzando" (lo que YA calculaba bien "Cargar
// Planos", ver calcularPlano()/recalcularTotalesPlano() con cruzar=true
// en services/hipismoCalc.js): el neto crudo de Lusho es
// -200 (jugador, negativo, no se divide por 0.95) + 95/0.95=100
// (banquero, positivo) = -100 — negativo, así que no paga comisión y el
// final queda en -100 tal cual, EXACTAMENTE "LUSHO-100" como dijo el
// usuario. El ajuste que debe aparecer aparte es, entonces,
// -100 - (-105) = +5,00.
//
// Se prueban los 3 lugares que antes NO reflejaban el cruce:
//   A) calcularAjustesCruce() en sí (unidad, sin DB) — LUSHO da +5.
//   B) obtenerLineasHipismoCliente() (services/hipismoLineasCliente.js) —
//      LUSHO ve sus 2 líneas de siempre (SIN tocar su valor individual,
//      tal como pidió el usuario: "Línea aparte 'Ajuste por cruce'") más
//      una línea nueva tipo 'cruce_ajuste' de +5, y la suma total de
//      todas sus líneas da -100 (no -105).
//   C) GET /cierre-final (routes/hipismo.js) — el saldo agregado de LUSHO
//      en la tabla de Cierre Final/Balance General también da -100.
//
// Mismo patrón de base de datos falsa en memoria, y el mismo mock de
// express/router (fakeExpressRouter con __handlers, invocarRuta) que ya
// usa el resto del proyecto para probar rutas de routes/hipismo.js (ver
// test_hipismo_porcentaje_doble_aval.js).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-lusho-1';
const FECHA = '2026-09-26';
const PLANO_ID = 'plano-lusho';

// Las 7 líneas del plano de LUSHO, ya como filas de hipismo_tickets
// (banquero_nombre siempre tiene un nombre real, como en la tabla real).
const TICKETS_PLANO = [
  { id: 't1', cliente_nombre: 'RICHARD', banquero_nombre: 'LUSHO', resultado_jugador: -100, resultado_banquero: 95, monto: 100, sin_comision: false },
  { id: 't2', cliente_nombre: 'RICHARD', banquero_nombre: 'TONY', resultado_jugador: -50, resultado_banquero: 47.5, monto: 50, sin_comision: false },
  { id: 't3', cliente_nombre: 'LUSHO', banquero_nombre: 'PLACE', resultado_jugador: -200, resultado_banquero: 190, monto: 200, sin_comision: false },
  { id: 't4', cliente_nombre: 'PETIT', banquero_nombre: 'PLACE', resultado_jugador: -100, resultado_banquero: 95, monto: 100, sin_comision: false },
  { id: 't5', cliente_nombre: 'SAMMY', banquero_nombre: 'YAMEKO', resultado_jugador: -50, resultado_banquero: 47.5, monto: 50, sin_comision: false },
  { id: 't6', cliente_nombre: 'ALEXIS', banquero_nombre: 'RICHARD', resultado_jugador: -50, resultado_banquero: 47.5, monto: 50, sin_comision: false },
  { id: 't7', cliente_nombre: 'BOMBERO', banquero_nombre: 'TOLERANTE', resultado_jugador: -50, resultado_banquero: 47.5, monto: 50, sin_comision: false }
];

function shapeTickets(rows) {
  return rows.map(t => ({
    clienteNombre: t.cliente_nombre,
    banqueroNombre: t.banquero_nombre,
    resultadoJugador: Number(t.resultado_jugador),
    resultadoBanquero: Number(t.resultado_banquero),
    sinComision: t.sin_comision
  }));
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// =================================================================
// A) calcularAjustesCruce() en sí — sin DB.
// =================================================================
function probarUnidadCalcularAjustesCruce() {
  const { calcularAjustesCruce } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));
  const ajustes = calcularAjustesCruce(shapeTickets(TICKETS_PLANO));

  check(ajustes.LUSHO === 5, `A) LUSHO debía ajustarse +5,00 (de -105 sin cruzar a -100 cruzado), dio ${ajustes.LUSHO}`);
  // Sanity check adicional: Richard también cambia (-150+50=-100 crudo,
  // negativo -> final -100; sin cruzar daba -150+47.5=-102.5; ajuste=+2.5).
  check(ajustes.RICHARD === 2.5, `A) RICHARD debía ajustarse +2,50, dio ${ajustes.RICHARD}`);
  // TONY solo aparece en 1 línea del plano (banquero de t2) — cruzar una
  // sola línea es matemáticamente igual a no cruzar, así que no debe
  // recibir ningún ajuste.
  check(!('TONY' in ajustes), 'A) TONY (una sola línea en el plano) no debía tener ajuste');
}

// =================================================================
// B) obtenerLineasHipismoCliente() — con DB falsa (sin pasar por Express).
// =================================================================
async function probarLineasCliente() {
  const TABLAS = {
    hipismo_tickets: TICKETS_PLANO.map(t => ({ ...t, plano_id: PLANO_ID, grupo_id: GRUPO_ID })),
    hipismo_planos: [
      { id: PLANO_ID, grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'Valencia', carrera_numero: 1, pizarra: '6.10.4.8.2', hipodromo_id: 'hip-1', cruza_jugadas: true, creado_en: 1 }
    ],
    hipismo_hipodromos: [{ id: 'hip-1', pais: 'VE' }]
  };

  function ejecutarQuery(text, params) {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto/i.test(sql)) {
      const [grupoId, nombre, desde, hasta] = params;
      const filas = TABLAS.hipismo_tickets
        .filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre))
        .map(t => ({ t, plano: TABLAS.hipismo_planos.find(p => p.id === t.plano_id) }))
        .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta)
        .sort((a, b) => b.plano.fecha.localeCompare(a.plano.fecha));
      return {
        rows: filas.map(({ t, plano }) => {
          const hip = TABLAS.hipismo_hipodromos.find(h => h.id === plano.hipodromo_id);
          return {
            cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad,
            caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero,
            plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: plano.cruza_jugadas,
            fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre, carrera_numero: plano.carrera_numero,
            pizarra: plano.pizarra, pais: hip ? hip.pais : null
          };
        })
      };
    }
    if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) return { rows: [] };
    if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) return { rows: [] };
    if (/^SELECT w\.caballo, w\.monto, w\.fecha, w\.hipodromo_nombre, w\.carrera_numero, h\.pais/i.test(sql)) return { rows: [] };

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

  Module._load = function (request, parent, isMain) {
    if (request === 'pg') return { Pool: fakePool };
    return originalLoad.apply(this, arguments);
  };
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://fake/fake';
  let obtenerLineasHipismoCliente;
  try {
    Object.keys(require.cache).forEach(k => {
      if (k.includes(path.join('src', 'db')) || k.includes(path.join('src', 'services'))) delete require.cache[k];
    });
    ({ obtenerLineasHipismoCliente } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoLineasCliente')));
  } finally {
    Module._load = originalLoad;
  }

  const lineas = await obtenerLineasHipismoCliente(GRUPO_ID, 'LUSHO', '2026-09-21', '2026-09-27');

  // LUSHO tiene 2 líneas normales (jugador en t3, banquero en t1) + 1
  // línea de ajuste por cruce — sus 2 líneas normales deben mantener
  // EXACTAMENTE su valor de siempre (el usuario pidió no tocar cada
  // línea individual, solo agregar el ajuste aparte).
  const normales = lineas.filter(l => l.tipo !== 'cruce_ajuste');
  const ajustes = lineas.filter(l => l.tipo === 'cruce_ajuste');
  check(normales.length === 2, `B) LUSHO debía tener 2 líneas normales (jugador+banquero), dio ${normales.length}`);
  check(ajustes.length === 1, `B) LUSHO debía tener exactamente 1 línea de ajuste por cruce, dio ${ajustes.length}`);

  const comoJugador = normales.find(l => l.rol === 'jugador');
  const comoBanquero = normales.find(l => l.rol === 'banquero');
  check(!!comoJugador && comoJugador.resultado === -200, `B) la línea de LUSHO como jugador debía seguir en -200,00 (sin tocar), dio ${comoJugador && comoJugador.resultado}`);
  check(!!comoBanquero && comoBanquero.resultado === 95, `B) la línea de LUSHO como banquero debía seguir en +95,00 (sin tocar), dio ${comoBanquero && comoBanquero.resultado}`);

  const ajuste = ajustes[0];
  check(!!ajuste && ajuste.resultado === 5, `B) la línea "Ajuste por cruce" de LUSHO debía dar +5,00, dio ${ajuste && ajuste.resultado}`);
  check(!!ajuste && ajuste.hipodromoNombre === 'Valencia' && ajuste.carreraNumero === 1, 'B) la línea de ajuste lleva el hipódromo/carrera del plano');

  const totalLusho = Math.round(lineas.reduce((acc, l) => acc + l.resultado, 0) * 100) / 100;
  check(totalLusho === -100, `B) la suma de TODAS las líneas de LUSHO debía dar -100,00 (el neto cruzado real), dio ${totalLusho}`);

  // TONY solo tiene 1 línea en el plano (banquero de t2) — no debe
  // recibirle ninguna línea de ajuste.
  const lineasTony = await obtenerLineasHipismoCliente(GRUPO_ID, 'TONY', '2026-09-21', '2026-09-27');
  check(lineasTony.filter(l => l.tipo === 'cruce_ajuste').length === 0, 'B) TONY (una sola línea en el plano) no recibe ninguna línea de ajuste');
}

// =================================================================
// C) GET /cierre-final — con DB falsa + router falso (mismo patrón que
// test_hipismo_porcentaje_doble_aval.js).
// =================================================================
function fakeExpressRouter() {
  const router = {};
  const handlers = [];
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => {
    router[m] = (...args) => { handlers.push([m, args]); return router; };
  });
  router.__handlers = handlers;
  return router;
}

function construirTablasCierreFinal() {
  return {
    jugadores: [],
    hipismo_tickets: TICKETS_PLANO.map(t => ({ ...t, plano_id: PLANO_ID, grupo_id: GRUPO_ID })),
    hipismo_planos: [
      { id: PLANO_ID, grupo_id: GRUPO_ID, fecha: FECHA, comision_total: 0, cruza_jugadas: true }
    ],
    hipismo_comisiones_ajustes: []
  };
}

function ejecutarQueryCierreFinal(TABLAS, text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({
        cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre,
        resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto,
        plano_id: t.plano_id, sin_comision: t.sin_comision || false, cruza_jugadas: p.cruza_jugadas || false
      }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre, cc_av\.nombre AS cc_avalador_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos/i.test(sql)) return { rows: [{ total: 0 }] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates/i.test(sql)) return { rows: [{ total: 0 }] };

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
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

async function probarCierreFinal() {
  const TABLAS = construirTablasCierreFinal();
  const fakePool = function () {
    this.query = async (text, params) => ejecutarQueryCierreFinal(TABLAS, text, params);
    this.connect = async () => ({ query: async (text, params) => ejecutarQueryCierreFinal(TABLAS, text, params), release() {} });
    this.on = () => {};
  };
  const fakeExpress = () => fakeExpressRouter();
  fakeExpress.Router = fakeExpressRouter;

  Module._load = function (request, parent, isMain) {
    if (request === 'pg') return { Pool: fakePool };
    if (request === 'express') return fakeExpress;
    if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
    if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_ID }) };
    return originalLoad.apply(this, arguments);
  };
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://fake/fake';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'fake-secret';

  let hipismoRouter;
  try {
    Object.keys(require.cache).forEach(k => {
      if (k.includes(path.join('src', 'db')) || k.includes(path.join('src', 'services')) || k.includes(path.join('src', 'routes', 'hipismo'))) {
        delete require.cache[k];
      }
    });
    hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
  } finally {
    Module._load = originalLoad;
  }

  const entrada = hipismoRouter.__handlers.find(([m, args]) => m === 'get' && args[0] === '/cierre-final');
  check(!!entrada, 'C) se encontró la ruta GET /cierre-final');
  const handlerCierreFinal = entrada[1][entrada[1].length - 1];

  // "semana=actual" depende de la fecha real — se pisa Date igual que
  // test_hipismo_porcentaje_doble_aval.js, para que "hoy" caiga en la
  // semana del plano de LUSHO (2026-09-26, sábado; semana lunes 21 a
  // domingo 27 de sept de 2026).
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-26T18:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };
  let res;
  try {
    res = await invocarRuta(handlerCierreFinal, Object.assign(reqBase(GRUPO_ID), { query: { semana: 'actual' } }));
  } finally {
    global.Date = OriginalDate;
  }

  check(res._status === 200, 'C) GET /cierre-final responde 200');
  const lusho = res._json && res._json.clientes.find(c => c.nombre === 'LUSHO');
  check(!!lusho, 'C) LUSHO aparece en clientes de /cierre-final');
  check(!!lusho && lusho.saldo === -100, `C) el saldo de LUSHO en /cierre-final debía dar -100,00 (cruzado), dio ${lusho && lusho.saldo}`);

  const richard = res._json && res._json.clientes.find(c => c.nombre === 'RICHARD');
  check(!!richard, 'C) RICHARD aparece en clientes de /cierre-final');
  check(!!richard && richard.saldo === -100, `C) el saldo de RICHARD en /cierre-final debía dar -100,00 (cruzado), dio ${richard && richard.saldo}`);
}

async function main() {
  probarUnidadCalcularAjustesCruce();
  await probarLineasCliente();
  await probarCierreFinal();

  console.log(`\n${pasaron} pruebas pasaron, ${fallaron} fallaron.`);
  if (fallaron > 0) process.exit(1);
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
