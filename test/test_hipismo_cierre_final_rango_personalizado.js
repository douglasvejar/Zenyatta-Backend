// =================================================================
// PRUEBA: GET /api/hipismo/cierre-final?desde=&hasta= — RANGO
// PERSONALIZADO (28-09-2026, a pedido del usuario: "en balance general,
// debes mostrar por defecto siempre la semana actual, sin embargo
// agrega un panel donde pueda elegir el rango de fechas que quiero que
// me muestres... igual en cierre final" — confirmado por
// AskUserQuestion: solo Balance General y Cierre Final, con un 4to
// botón "Rango personalizado" además de los 3 de siempre).
//
// Balance General y Cierre Final llaman al MISMO endpoint
// (GET /cierre-final), así que una sola prueba de este endpoint cubre
// las 2 pantallas — lo único que cambia entre ellas es cómo arma la URL
// el frontend (ver pintarBalanceGeneral/pintarCierreFinal en
// public/hipismo-mockup.html).
//
// Casos cubiertos:
//   1. ?desde=&hasta= devuelve rangoPersonalizado:true, rango exacto, y
//      SOLO suma lo que cae dentro de ese rango (frontera inclusiva en
//      ambos extremos, lo de un día antes/después queda afuera).
//   2. esSemanaActual siempre false con rango personalizado, aunque el
//      rango incluya el día de "hoy".
//   3. Si vienen invertidas (hasta antes que desde), se ordenan solas
//      en vez de fallar.
//   4. Si falta desde o hasta (o el formato no es YYYY-MM-DD), el
//      endpoint IGNORA el intento de rango personalizado y cae de
//      vuelta al comportamiento de siempre (?semana=actual).
//   5. Un rango que cruza el límite entre 2 semanas ISO (algo que
//      ?semana=actual|anterior|hace2 nunca podría mostrar de una sola
//      vez) suma los 2 lados correctamente.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-rango-1';
// Semana 1: lunes 14 a domingo 20 de sept de 2026. Semana 2: lunes 21 a
// domingo 27. El rango de prueba (19 al 22) cruza el límite entre las 2.
const TABLAS = {
  hipismo_planos: [
    { id: 'plano-antes', grupo_id: GRUPO_ID, fecha: '2026-09-18' },     // fuera (antes del rango)
    { id: 'plano-viernes', grupo_id: GRUPO_ID, fecha: '2026-09-19' },   // frontera inicial -> adentro
    { id: 'plano-domingo', grupo_id: GRUPO_ID, fecha: '2026-09-20' },   // adentro
    { id: 'plano-lunes', grupo_id: GRUPO_ID, fecha: '2026-09-21' },     // adentro (ya semana 2)
    { id: 'plano-martes', grupo_id: GRUPO_ID, fecha: '2026-09-22' },    // frontera final -> adentro
    { id: 'plano-despues', grupo_id: GRUPO_ID, fecha: '2026-09-23' }    // fuera (después del rango)
  ],
  hipismo_tickets: [
    { plano_id: 'plano-antes', grupo_id: GRUPO_ID, cliente_nombre: 'ANTES', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 100, resultado_banquero: -105 },
    { plano_id: 'plano-viernes', grupo_id: GRUPO_ID, cliente_nombre: 'VIERNES', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 20, resultado_banquero: -21 },
    { plano_id: 'plano-domingo', grupo_id: GRUPO_ID, cliente_nombre: 'DOMINGO', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 30, resultado_banquero: -31.5 },
    { plano_id: 'plano-lunes', grupo_id: GRUPO_ID, cliente_nombre: 'LUNES', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 40, resultado_banquero: -42 },
    { plano_id: 'plano-martes', grupo_id: GRUPO_ID, cliente_nombre: 'MARTES', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 50, resultado_banquero: -52.5 },
    { plano_id: 'plano-despues', grupo_id: GRUPO_ID, cliente_nombre: 'DESPUES', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 100, resultado_banquero: -105 }
  ],
  hipismo_remates: [],
  hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_winners: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: false, cruza_jugadas: false, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
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
  // (28-09-2026) obtenerComisionesPropias() ahora hace 2 consultas: los
  // jugadores en sí, y sus avaladores en jugadores_avales_porcentaje —
  // ningún jugador de esta prueba tiene % propio ni avales configurados,
  // así que ambas siempre dan vacío.
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre, cc_av\.nombre AS cc_avalador_nombre/i.test(sql)) {
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

  if (/^SELECT j\.\* FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };
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
  // Pisa Date.now() para que "hoy" caiga DENTRO del rango personalizado
  // que se prueba (2026-09-19 al 2026-09-22) — así el caso 2 (esSemanaActual
  // siempre false con rango personalizado) es una prueba real, no un
  // acierto de casualidad.
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-20T12:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };
  let res1, res2, res3, res4;
  try {
    // --- 1) Rango personalizado que cruza 2 semanas ISO: 19 al 22 de
    // septiembre. Debe traer VIERNES+DOMINGO+LUNES+MARTES+BANCA (el
    // banquero de esos 4 tickets), sin ANTES ni DESPUES. ---
    res1 = await invocarRuta(handlerCierreFinal, reqBase(GRUPO_ID, { desde: '2026-09-19', hasta: '2026-09-22' }));

    // --- 3) Invertido (hasta antes que desde): mismo resultado que el
    // caso 1, ordenado solo. ---
    res3 = await invocarRuta(handlerCierreFinal, reqBase(GRUPO_ID, { desde: '2026-09-22', hasta: '2026-09-19' }));

    // --- 4) Falta "hasta": debe IGNORAR el intento de rango y caer a
    // semana=actual (offset 0 sobre el 20-09-2026, que cae en la
    // semana lunes 14 a domingo 20) — no debe reventar ni devolver un
    // rango a medias. ---
    res4 = await invocarRuta(handlerCierreFinal, reqBase(GRUPO_ID, { desde: '2026-09-19' }));
  } finally {
    global.Date = OriginalDate;
  }

  check(res1._status === 200, '1) GET /cierre-final?desde=&hasta= responde 200');
  check(res1._json.rangoPersonalizado === true, 'rangoPersonalizado: true cuando vienen desde/hasta válidos');
  check(res1._json.rango.desde === '2026-09-19' && res1._json.rango.hasta === '2026-09-22', 'El rango devuelto es EXACTAMENTE el que se pidió, no un redondeo a semana completa');
  // 5, no 4: los 4 clientes de las jugadas adentro del rango MÁS
  // "BANCA" (el banquero de los 4 tickets, acumulado como un "cliente"
  // más — mismo criterio de siempre en /cierre-final, ver acumular()).
  check(res1._json.clientes.length === 5, '5 renglones: VIERNES, DOMINGO, LUNES, MARTES + BANCA — ANTES y DESPUES quedan afuera');
  check(!res1._json.clientes.some(c => c.nombre === 'ANTES'), 'ANTES (18-09, un día antes del rango) NO aparece');
  check(!res1._json.clientes.some(c => c.nombre === 'DESPUES'), 'DESPUES (23-09, un día después del rango) NO aparece');
  check(res1._json.clientes.some(c => c.nombre === 'VIERNES'), 'VIERNES (19-09, frontera inicial) SÍ aparece — frontera inclusiva');
  check(res1._json.clientes.some(c => c.nombre === 'MARTES'), 'MARTES (22-09, frontera final) SÍ aparece — frontera inclusiva');
  check(res1._json.clientes.some(c => c.nombre === 'LUNES'), 'LUNES (21-09, ya en la semana ISO siguiente) SÍ aparece — el rango cruza el límite de semana sin problema');

  // --- 2) esSemanaActual siempre false con rango personalizado, aunque
  // "hoy" (20-09-2026, pisado arriba) caiga adentro del rango. ---
  check(res1._json.esSemanaActual === false, '2) esSemanaActual es false con rango personalizado, aunque "hoy" caiga adentro del rango pedido');

  check(res3._status === 200, '3) desde/hasta invertidas también responde 200');
  check(res3._json.rango.desde === '2026-09-19' && res3._json.rango.hasta === '2026-09-22', 'Invertidas (hasta antes que desde): se ordenan solas al mismo rango que el caso 1');
  check(res3._json.clientes.length === 5, 'Mismo resultado que el caso 1 (5 renglones) con las fechas invertidas');

  check(res4._status === 200, '4) Con "hasta" faltante responde 200 (no revienta)');
  check(res4._json.rangoPersonalizado === false, 'rangoPersonalizado: false cuando falta "hasta" — ignora el intento de rango personalizado');
  check(res4._json.rango.desde === '2026-09-14' && res4._json.rango.hasta === '2026-09-20', 'Cae de vuelta a la semana actual completa (14 al 20 de sept) en vez de un rango a medias');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
