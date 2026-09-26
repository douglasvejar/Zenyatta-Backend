// =================================================================
// PRUEBA: "% devuelto" DOBLE Y SIMULTÁNEO (24-09-2026, a pedido del
// usuario: "hay clientes que generan % para el mismo y aparte le
// generan % a su avalador....." — respuesta confirmada por
// AskUserQuestion: "Dos % independientes y simultáneos").
//
// Hasta esta ronda, un cliente solo podía generar el % de
// comision_propia PARA SÍ MISMO o PARA SU AVAL (jugadores.
// porcentaje_devuelto_destino, either/or) — nunca los dos a la vez, y
// nunca con un % distinto para cada uno. Ahora jugadores.
// porcentaje_devuelto_aval agrega un SEGUNDO % 100% independiente,
// siempre para el aval (si hay uno configurado), simultáneo al de
// arriba — ver la nota grande de obtenerComisionesPropias en
// routes/hipismo.js y la nota grande de sql/schema.sql.
//
// Casos cubiertos, con 4 clientes distintos (mismo día, mismo
// hipódromo/carrera, apostando 100 cada uno, para que las cuentas sean
// fáciles de verificar):
//   1. PEDRO: comision_propia=1% (destino='cliente', para él mismo) +
//      porcentaje_devuelto_aval=2% (para JUAN, su aval) — DOS ítems
//      simultáneos por el MISMO ticket: "PEDRO - PORCENTAJE" (+1,00) y
//      "JUAN - PORCENTAJE" (+2,00).
//   2. ANA: comision_propia=3% con destino='aval' (redirección de
//      SIEMPRE, sin tocar) hacia CARLOS, sin % adicional — sigue dando
//      UN SOLO ítem "CARLOS - PORCENTAJE" (+3,00), retrocompatible.
//   3. LUIS: comision_propia=2% con destino='aval' hacia ROSA, MÁS
//      porcentaje_devuelto_aval=5% (también hacia ROSA) — caso límite:
//      los DOS % van al MISMO destino (ROSA), pero deben quedar como 2
//      ítems/renglones SEPARADOS (2,00 y 5,00), nunca mezclados o
//      pisándose uno al otro, sumando 7,00 en el total general.
//   4. MARIA: sin nada configurado — no aporta nada (retrocompatible,
//      igual que siempre).
//
// Se verifica en las 4 rutas que usan obtenerComisionesPropias():
// /comisiones-devueltas, /comisiones-devueltas-por-hipodromo,
// /saldo-comisiones y /cierre-final.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-doble-aval-1';
const FECHA = '2026-09-24'; // jueves, semana lunes 21 a domingo 27 de sept de 2026

const TABLAS = {
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 1, avalado_por_id: 'j-juan', porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 2 },
    { id: 'j-juan', grupo_id: GRUPO_ID, nombre: 'JUAN', comision_propia: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 0 },
    { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 3, avalado_por_id: 'j-carlos', porcentaje_devuelto_destino: 'aval', porcentaje_devuelto_aval: 0 },
    { id: 'j-carlos', grupo_id: GRUPO_ID, nombre: 'CARLOS', comision_propia: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 0 },
    { id: 'j-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 2, avalado_por_id: 'j-rosa', porcentaje_devuelto_destino: 'aval', porcentaje_devuelto_aval: 5 },
    { id: 'j-rosa', grupo_id: GRUPO_ID, nombre: 'ROSA', comision_propia: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 0 },
    { id: 'j-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', comision_propia: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 0 }
  ],
  hipismo_planos: [
    { id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA }
  ],
  hipismo_tickets: [
    // banquero_nombre SIEMPRE viene con un valor real en hipismo_tickets
    // (ver POST /planos en routes/hipismo.js: banqueroFinal nunca queda
    // vacío) — se usa "BANCA" fija en las 4 para no meter otra variable
    // en esta prueba; lo que importa es cliente_nombre/monto.
    { id: 'ticket-pedro', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCA', modalidad: '1P', caballo: '(5)', monto: 100, resultado_jugador: -100, resultado_banquero: 100 },
    { id: 'ticket-ana', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'ANA', banquero_nombre: 'BANCA', modalidad: '1P', caballo: '(3)', monto: 100, resultado_jugador: -100, resultado_banquero: 100 },
    { id: 'ticket-luis', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'LUIS', banquero_nombre: 'BANCA', modalidad: '1P', caballo: '(7)', monto: 100, resultado_jugador: -100, resultado_banquero: 100 },
    { id: 'ticket-maria', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'MARIA', banquero_nombre: 'BANCA', modalidad: '1P', caballo: '(1)', monto: 50, resultado_jugador: -50, resultado_banquero: 50 }
  ],
  hipismo_remates: [],
  hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerApuestasDelDia (/comisiones-devueltas[-por-hipodromo]) ----
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
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }

  // ---- /saldo-comisiones (semana, BETWEEN, solo monto) ----
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
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.monto\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }

  // ---- /cierre-final (semana, BETWEEN, con resultado_jugador/banquero) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }

  // ---- obtenerComisionesPropias ----
  if (/^SELECT j\.nombre, j\.comision_propia, j\.porcentaje_devuelto_destino, j\.porcentaje_devuelto_aval, av\.nombre AS aval_nombre,\s+cc_propio\.nombre AS cc_propio_nombre, cc_aval\.nombre AS cc_aval_nombre\s+FROM jugadores j\s+LEFT JOIN jugadores av ON av\.id = j\.avalado_por_id\s+LEFT JOIN jugadores cc_propio ON cc_propio\.id = j\.cuenta_comision_id\s+LEFT JOIN jugadores cc_aval ON cc_aval\.id = av\.cuenta_comision_id\s+WHERE j\.grupo_id = \$1 AND j\.nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => ({
        nombre: j.nombre, comision_propia: j.comision_propia || 0,
        porcentaje_devuelto_destino: j.porcentaje_devuelto_destino || 'cliente',
        porcentaje_devuelto_aval: j.porcentaje_devuelto_aval || 0,
        aval_nombre: j.avalado_por_id ? ((TABLAS.jugadores.find(x => x.id === j.avalado_por_id) || {}).nombre || null) : null,
        cc_propio_nombre: null,
        cc_aval_nombre: null
      }))
    };
  }

  // "Traspaso de comisión" (26-09-2026) — /cierre-final ahora suma los
  // ajustes de hipismo_comisiones_ajustes sobre el saldo en vivo. Esta
  // prueba no hace ningún traspaso, así que siempre queda vacío.
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes\s+WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3\s+GROUP BY cliente_nombre/i.test(sql)) {
    return { rows: [] };
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

function reqBase(grupoId) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, params: {}, query: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) /comisiones-devueltas-por-hipodromo: solo totales, sin
  // importar destino — 1(PEDRO propio) + 2(PEDRO->JUAN) + 3(ANA->CARLOS)
  // + 2(LUIS->ROSA propio) + 5(LUIS->ROSA adicional) = 13,00. MARIA no
  // aporta nada (sin % configurado). ---
  const resHip = await invocarRuta(handlerComisionesDevueltasHipodromo, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(resHip._status === 200, '1) GET /comisiones-devueltas-por-hipodromo responde 200');
  check(resHip._json.hipodromos.length === 1, 'Un solo hipódromo (La Rinconada)');
  const rinconada = resHip._json.hipodromos[0];
  check(rinconada.carreras.length === 1 && rinconada.carreras[0].carreraNumero === 1, 'Una sola carrera');
  check(rinconada.carreras[0].devuelto === 13, 'La carrera 1 suma los 5 % (propios + de aval, de los 3 clientes) = 13,00');
  check(resHip._json.totalGeneral === 13, 'Total general del día: 13,00 — MARIA (sin % configurado) no aporta nada');

  // --- 2) /comisiones-devueltas: cada cliente aparece como 1 o 2
  // renglones según cuántas entradas simultáneas tenga. ---
  const resDev = await invocarRuta(handlerComisionesDevueltas, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(resDev._status === 200, '2) GET /comisiones-devueltas responde 200');
  check(resDev._json.clientes.length === 5, 'Salen 5 renglones: PEDRO(x2) + ANA(x1) + LUIS(x2), MARIA no aparece');
  check(resDev._json.totalGeneral === 13, 'totalGeneral de /comisiones-devueltas también da 13,00');

  const filasPedro = resDev._json.clientes.filter(c => c.nombre === 'PEDRO');
  check(filasPedro.length === 2, 'PEDRO sale en 2 renglones separados (su % propio y el % de su aval)');
  const pedroPropio = filasPedro.find(c => c.destino === 'PEDRO');
  check(!!pedroPropio && pedroPropio.porcentaje === 1 && pedroPropio.total === 1 && !pedroPropio.esAvalAdicional, 'PEDRO propio: 1% -> 1,00 para él mismo, esAvalAdicional=false');
  const pedroAval = filasPedro.find(c => c.destino === 'JUAN');
  check(!!pedroAval && pedroAval.porcentaje === 2 && pedroAval.total === 2 && pedroAval.esAvalAdicional === true, 'PEDRO -> JUAN (aval NUEVO): 2% -> 2,00 para JUAN, esAvalAdicional=true');

  const filasAna = resDev._json.clientes.filter(c => c.nombre === 'ANA');
  check(filasAna.length === 1, 'ANA sale en UN SOLO renglón (retrocompatible: solo tenía el destino=aval de siempre, sin % adicional)');
  check(filasAna[0].destino === 'CARLOS' && filasAna[0].porcentaje === 3 && filasAna[0].total === 3 && !filasAna[0].esAvalAdicional, 'ANA -> CARLOS: 3% -> 3,00 (redirección de siempre, esAvalAdicional=false)');

  const filasLuis = resDev._json.clientes.filter(c => c.nombre === 'LUIS');
  check(filasLuis.length === 2, 'LUIS sale en 2 renglones AUNQUE los 2 vayan al MISMO destino (ROSA) — nunca se mezclan ni se pisan');
  const luisPropioRedirigido = filasLuis.find(c => c.porcentaje === 2);
  const luisAvalAdicional = filasLuis.find(c => c.porcentaje === 5);
  check(!!luisPropioRedirigido && luisPropioRedirigido.destino === 'ROSA' && luisPropioRedirigido.total === 2 && !luisPropioRedirigido.esAvalAdicional, 'LUIS -> ROSA (redirección de comision_propia, destino=aval de siempre): 2% -> 2,00');
  check(!!luisAvalAdicional && luisAvalAdicional.destino === 'ROSA' && luisAvalAdicional.total === 5 && luisAvalAdicional.esAvalAdicional === true, 'LUIS -> ROSA (% adicional NUEVO): 5% -> 5,00, un renglón totalmente aparte del anterior');

  check(!resDev._json.clientes.some(c => c.nombre === 'MARIA'), 'MARIA no aparece (sin % configurado, retrocompatible)');

  // --- 3) /saldo-comisiones: misma lógica, agregada por semana. Pisa
  // Date.now() para que "hoy" caiga en la semana de FECHA (mismo truco
  // que test_hipismo_comisiones_devueltas_hipodromo_y_saldo.js). ---
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-23T12:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };
  let resSaldo, resCierre;
  try {
    resSaldo = await invocarRuta(handlerSaldoComisiones, Object.assign(reqBase(GRUPO_ID), { query: { semana: 'actual' } }));
    resCierre = await invocarRuta(handlerCierreFinal, Object.assign(reqBase(GRUPO_ID), { query: { semana: 'actual' } }));
  } finally {
    global.Date = OriginalDate;
  }
  check(resSaldo._status === 200, '3) GET /saldo-comisiones?semana=actual responde 200');
  check(resSaldo._json.clientes.length === 5, '/saldo-comisiones también trae los 5 renglones (PEDRO x2, ANA x1, LUIS x2)');
  check(resSaldo._json.totalGeneral === 13, 'totalGeneral semanal de /saldo-comisiones: 13,00');
  const luisSaldo = resSaldo._json.clientes.filter(c => c.nombre === 'LUIS');
  check(luisSaldo.length === 2 && luisSaldo.some(c => c.devueltoSemana === 2) && luisSaldo.some(c => c.devueltoSemana === 5), 'LUIS también sale con sus 2 renglones separados (2,00 y 5,00) en /saldo-comisiones');

  // --- 4) /cierre-final: los 2 ítems "{destino} - PORCENTAJE" quedan
  // sumados en su propio "cliente" dentro de la misma lista de saldos —
  // ROSA acumula 2,00 + 5,00 = 7,00 bajo un SOLO ítem "ROSA -
  // PORCENTAJE" (acá SÍ se suman, porque acumular() ya agrupa por nombre
  // de ítem — la separación de arriba es solo para AUDITAR quién generó
  // cada %, ver la nota grande de obtenerComisionesPropias). ---
  check(resCierre._status === 200, '4) GET /cierre-final responde 200');
  const itemPedro = resCierre._json.clientes.find(c => c.nombre === 'PEDRO - PORCENTAJE');
  const itemJuan = resCierre._json.clientes.find(c => c.nombre === 'JUAN - PORCENTAJE');
  const itemCarlos = resCierre._json.clientes.find(c => c.nombre === 'CARLOS - PORCENTAJE');
  const itemRosa = resCierre._json.clientes.find(c => c.nombre === 'ROSA - PORCENTAJE');
  check(!!itemPedro && itemPedro.gano === 1, 'Ítem "PEDRO - PORCENTAJE": +1,00 (su % propio)');
  check(!!itemJuan && itemJuan.gano === 2, 'Ítem "JUAN - PORCENTAJE": +2,00 (el % adicional que generó PEDRO para su aval)');
  check(!!itemCarlos && itemCarlos.gano === 3, 'Ítem "CARLOS - PORCENTAJE": +3,00 (redirección de siempre de ANA)');
  check(!!itemRosa && itemRosa.gano === 7, 'Ítem "ROSA - PORCENTAJE": +7,00 — SUMA los 2,00 (redirigido) y 5,00 (adicional) que generó LUIS, un solo ítem en el saldo real');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
