// =================================================================
// PRUEBA: "% propio/de aval también cuando se BANQUEA en Tercios"
// (29-09-2026, caso real reportado por el usuario: "YA HAY UN Mrincreible
// EN CLIENTES CON LOS % CORRESPONDIENTES Y EL Mrincreible DE BALANCES NO
// MUESTRA %"). Tras pedirle al usuario diagnóstico SQL directo (Supabase),
// se confirmó el verdadero origen del bug -- MUY distinto de lo que
// parecía al principio:
//
//   - La jugada de $300 fue "Cargar Planos" (Tercios): JOSUE fue el
//     CLIENTE y MRINCREIBLE fue el BANQUERO de esa jugada (no el cliente).
//   - En la ficha de MRINCREIBLE (jugadores), dentro del grupo real de esa
//     jugada, SÍ había un solo registro limpio con 1% de comisión propia
//     y 2 avales configurados (Ferrocarril 0.5%, Purga 0.5%) -- no era un
//     cliente duplicado ni un problema de espacios de más (los 2 arreglos
//     de la ronda anterior, ver test_hipismo_cliente_doble_espacios.js,
//     no aplicaban a este caso puntual).
//   - El verdadero motivo: obtenerComisionesPropias() SOLO se llamaba con
//     los nombres de quienes aparecían como CLIENTE en cada jugada
//     (t.cliente_nombre) -- el nombre del BANQUERO (t.banquero_nombre)
//     nunca se incluía, a propósito, desde el 23-09-2026 ("nunca lo que
//     banqueó"). Por eso el 1% de MRINCREIBLE y el 0.5%+0.5% de sus
//     avales nunca se calculaban para esa jugada puntual, aunque su
//     ficha estuviera perfectamente configurada.
//
// El usuario confirmó (AskUserQuestion) que ahora SÍ quiere que el %
// propio/de aval se gane también banqueando en Tercios -- esta prueba
// reproduce el caso real exacto (JOSUE/MRINCREIBLE/$300/Ferrocarril/
// Purga) end-to-end contra GET /cierre-final (el reporte que el usuario
// llama "Balance General") y contra GET /saldo-comisiones, confirmando
// que las 3 cuentas de % ahora aparecen con su monto correcto.
//
// El banqueo de Marcas (Jugadas Adelantadas) queda A PROPÓSITO fuera de
// este cambio -- no se confirmó ese alcance con el usuario -- así que NO
// se cubre acá (ver hipismoResumenCliente.js para esa exclusión explícita).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-banquero-tercios-1';
const FECHA = '2026-09-29';

const JUGADOR_MR = { id: 'j-mr', grupo_id: GRUPO_ID, nombre: 'MRINCREIBLE', comision_propia: 1, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_FERROCARRIL = { id: 'j-ferro', grupo_id: GRUPO_ID, nombre: 'FERROCARRIL', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_PURGA = { id: 'j-purga', grupo_id: GRUPO_ID, nombre: 'PURGA', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_JOSUE = { id: 'j-josue', grupo_id: GRUPO_ID, nombre: 'JOSUE', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_MR }, { ...JUGADOR_FERROCARRIL }, { ...JUGADOR_PURGA }, { ...JUGADOR_JOSUE }],
  // Los 2 avales configurados en la ficha real de MRINCREIBLE.
  jugadores_avales_porcentaje: [
    { grupo_id: GRUPO_ID, jugador_id: 'j-mr', avalador_id: 'j-ferro', porcentaje: 0.5 },
    { grupo_id: GRUPO_ID, jugador_id: 'j-mr', avalador_id: 'j-purga', porcentaje: 0.5 }
  ],
  hipismo_planos: [{ id: 'p1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA, cruza_jugadas: false }],
  // La jugada real exacta: JOSUE (cliente) le ganó $300 a MRINCREIBLE (banquero).
  hipismo_tickets: [
    { id: 't1', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'JOSUE', banquero_nombre: 'MRINCREIBLE', modalidad: '1P', caballo: '5', monto: 300, resultado_jugador: 300, resultado_banquero: -300, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: [],
  hipismo_winners: [], hipismo_comisiones_ajustes: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias (services/hipismoComisionPropia.js) ----
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  if (sql === 'SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])') {
    const [grupoId, idsJugadores] = params;
    return {
      rows: TABLAS.jugadores_avales_porcentaje
        .filter(a => a.grupo_id === grupoId && idsJugadores.includes(a.jugador_id))
        .map(a => {
          const av = TABLAS.jugadores.find(j => j.id === a.avalador_id);
          return { jugador_id: a.jugador_id, porcentaje: a.porcentaje, avalador_nombre: av ? av.nombre : null, cc_avalador_nombre: null };
        })
    };
  }

  // ---- /cierre-final ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s*t\.plano_id, t\.sin_comision, p\.cruza_jugadas/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId).map(t => {
        const p = TABLAS.hipismo_planos.find(x => x.id === t.plano_id);
        return { cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: p.cruza_jugadas };
      })
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s*FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) return { rows: [{ total: 0 }] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_planos/i.test(sql)) return { rows: [{ total: 0 }] };

  // ---- /saldo-comisiones ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.monto(, t\.resultado_jugador, t\.resultado_banquero)?(, t\.sin_comision)?(, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha)?\s*FROM hipismo_tickets/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    return {
      rows: TABLAS.hipismo_tickets
        .filter(t => t.grupo_id === grupoId)
        .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
        .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
        .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }))
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s*FROM hipismo_remate_apuestas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.monto(, j\.resultado_cliente)?(, j\.banqueadores)?(, j\.gano)?(, p\.fecha, p\.hipodromo_nombre, j\.carrera_numero)?\s*FROM hipismo_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (comision-banquero-tercios) no sabe responder: ' + sql);
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
  const fake = new OriginalDate(FECHA + 'T12:00:00Z').getTime();
  global.Date = class extends OriginalDate { constructor(...a) { if (a.length === 0) super(fake); else super(...a); } static now() { return fake; } };

  // ---- 1) GET /cierre-final ("Balance General" para el usuario) ----
  const reqCierre = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } };
  const salidaCierre = await invocarRuta(handlerDe('get', '/cierre-final'), reqCierre);

  check(!!salidaCierre, '1a) GET /cierre-final respondió algo');
  const clientes = (salidaCierre && salidaCierre.clientes) || [];
  const filaJosue = clientes.find(c => c.nombre === 'JOSUE');
  const filaMr = clientes.find(c => c.nombre === 'MRINCREIBLE');
  const filaMrPct = clientes.find(c => c.nombre === 'MRINCREIBLE - PORCENTAJE');
  // 02-10-2026: tras el rediseño, avalador_id YA ES directamente la ficha
  // elegida por el operador -- en este caso, el cliente real FERROCARRIL /
  // PURGA (sin ninguna sub-cuenta "- PORCENTAJE" auto-creada por detrás),
  // así que el % de aval se suma a la MISMA ficha de FERROCARRIL/PURGA.
  const filaFerro = clientes.find(c => c.nombre === 'FERROCARRIL');
  const filaPurga = clientes.find(c => c.nombre === 'PURGA');

  check(!!filaJosue && Math.abs(filaJosue.saldo - 300) < 0.001, `1b) JOSUE (cliente) ganó +300 -- dio ${filaJosue ? filaJosue.saldo : 'nada'}`);
  check(!!filaMr && Math.abs(filaMr.saldo - (-300)) < 0.001, `1c) MRINCREIBLE (banquero) sigue con su -300 normal, sin tocar -- dio ${filaMr ? filaMr.saldo : 'nada'}`);
  check(!!filaMrPct && Math.abs(filaMrPct.saldo - 3.00) < 0.001,
    `1d) ARREGLO PRINCIPAL: "MRINCREIBLE - PORCENTAJE" ahora aparece con +3,00 (1% de los 300 que banqueó) -- antes de este arreglo esta fila NO existía. Dio: ${filaMrPct ? filaMrPct.saldo : 'nada (bug reproducido)'}`);
  check(!!filaFerro && Math.abs(filaFerro.saldo - 1.50) < 0.001,
    `1e) "FERROCARRIL" (aval de MRINCREIBLE al 0,5%, directo a su propia ficha) ahora aparece con +1,50 -- dio ${filaFerro ? filaFerro.saldo : 'nada (bug reproducido)'}`);
  check(!!filaPurga && Math.abs(filaPurga.saldo - 1.50) < 0.001,
    `1f) "PURGA" (el otro aval de MRINCREIBLE al 0,5%, directo a su propia ficha) ahora aparece con +1,50 -- dio ${filaPurga ? filaPurga.saldo : 'nada (bug reproducido)'}`);

  // ---- 2) GET /saldo-comisiones (mismo cálculo, vista de saldo semanal) ----
  const reqSaldo = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } };
  const salidaSaldo = await invocarRuta(handlerDe('get', '/saldo-comisiones'), reqSaldo);
  check(!!salidaSaldo, '2a) GET /saldo-comisiones respondió algo');
  // /saldo-comisiones agrupa por (quien GENERÓ el % + destino + %) -- "nombre"
  // es siempre quien generó (MRINCREIBLE, banqueando), "destino" es a quién
  // se le acredita (ver la nota grande de agregarPorcentajeDevuelto).
  const filasSaldo = (salidaSaldo && salidaSaldo.clientes) || [];
  const saldoMrPropio = filasSaldo.find(c => c.nombre === 'MRINCREIBLE' && c.destino === 'MRINCREIBLE');
  const saldoFerro = filasSaldo.find(c => c.nombre === 'MRINCREIBLE' && c.destino === 'FERROCARRIL');
  const saldoPurga = filasSaldo.find(c => c.nombre === 'MRINCREIBLE' && c.destino === 'PURGA');
  check(!!saldoMrPropio && Math.abs(saldoMrPropio.devueltoSemana - 3.00) < 0.001,
    `2b) /saldo-comisiones también trae a MRINCREIBLE devolviendo 3,00 por su banqueo -- dio ${saldoMrPropio ? saldoMrPropio.devueltoSemana : 'nada'}`);
  check(!!saldoFerro && Math.abs(saldoFerro.devueltoSemana - 1.50) < 0.001,
    `2c) /saldo-comisiones trae a FERROCARRIL (avalador, generado por MRINCREIBLE) con 1,50 -- dio ${saldoFerro ? saldoFerro.devueltoSemana : 'nada'}`);
  check(!!saldoPurga && Math.abs(saldoPurga.devueltoSemana - 1.50) < 0.001,
    `2d) /saldo-comisiones trae a PURGA (avaladora, generado por MRINCREIBLE) con 1,50 -- dio ${saldoPurga ? saldoPurga.devueltoSemana : 'nada'}`);

  global.Date = OriginalDate;

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
