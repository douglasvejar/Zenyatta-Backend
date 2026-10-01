// =================================================================
// PRUEBA: "toda jugada que no se decida no genera % ni comisión" en
// "Comisiones Devueltas por Cliente"/"por Hipódromo" (29-09-2026, a
// pedido explícito del usuario, caso real reportado con 2 capturas de
// pantalla):
//
//   "EN ESTA LISTA NO APARECE SOY GANADOR, Y A SEBASTIAN LE ESTAS PAGANDO
//   % POR UNA MARCA QUE NO SE DECIDE.... YA TE DIJE QUE JUGADA QUE NO SE
//   DECIDA SEA LO QUE SEA EL TIPO DE JUGADA NI GENERA % NI SE LE DEVUELVE
//   % A NADIE... NO PUEDES PAGAR O DELVOLVER % DE UNA JUGADA QUE QUEDO
//   NULA Y QUE OBVIAMENTE EL GRUPO NO GENERE COMISION... ELLOS GANAN % DE
//   LO QUE GENERE EL GRUPO"
//
// El bug real: GET /comisiones-devueltas y GET
// /comisiones-devueltas-por-hipodromo se arman sobre obtenerApuestasDelDia
// (routes/hipismo.js), que hasta esta ronda NUNCA traía el resultado de
// la jugada (ni resultado_jugador/resultado_banquero de Tercios, ni gano
// de Adelantadas) -- así que pagaban % sobre CUALQUIER monto apostado,
// se hubiera decidido la jugada o no. Ya existía el mismo filtro en
// /cierre-final, /saldo-comisiones y /semana-por-dias (ver
// test_hipismo_no_decide_sin_comision.js) -- a estas 2 rutas nunca había
// llegado (ver "Pendientes" en la nota grande del proyecto).
//
// Mismo fixture EXACTO que test_hipismo_no_decide_sin_comision.js (PEDRO
// 2%%, ticket decidido de 100 + ticket ANULADO "pp" de 50; ANA 3%%, Marca
// decidida de 200 + Marca ANULADA "sin_decidir" de 80) para poder
// comparar directo contra ese resultado ya confirmado en /cierre-final.
//
// Casos cubiertos:
//   1. GET /comisiones-devueltas?fecha=: PEDRO aparece con total 2,00 (SOLO
//      el ticket decidido; el anulado de 50 -- que daría +1,00 si el bug
//      existiera -- no suma nada). ANA aparece con total 6,00 (SOLO la
//      Marca decidida; la anulada de 80 -- que daría +2,40 si el bug
//      existiera -- no suma nada).
//   2. El detalle expandido de cada cliente en /comisiones-devueltas SOLO
//      trae la carrera decidida -- la jugada anulada ni aparece en el
//      detalle (no solo "aparece con $0").
//   3. GET /comisiones-devueltas-por-hipodromo?fecha=: el total de "La
//      Rinconada" (donde jugó PEDRO, Tercios) es 2,00, no 3,00.
//   4. Un cliente sin ninguna jugada DECIDIDA ese día (todo lo que jugó
//      quedó anulado) directamente no aparece en ninguno de los 2
//      reportes -- no aparece con $0.00.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-devueltas-no-decide-1';
const FECHA = '2026-09-29';

const JUGADOR_PEDRO = { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 2, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_ANA = { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 3, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_BANCO = { id: 'j-banco', grupo_id: GRUPO_ID, nombre: 'BANCO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
// SOLONULA: su ÚNICA jugada del día quedó anulada -- no debe aparecer en
// ninguno de los 2 reportes (ni con total 0).
const JUGADOR_SOLONULA = { id: 'j-solonula', grupo_id: GRUPO_ID, nombre: 'SOLONULA', comision_propia: 5, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_PEDRO }, { ...JUGADOR_ANA }, { ...JUGADOR_BANCO }, { ...JUGADOR_SOLONULA }],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [{ id: 'p1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA }],
  hipismo_tickets: [
    // DECIDIDO: PEDRO le gana 100 a BANCO -- SÍ debe generar 2% = 2,00.
    { id: 't-decidido', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '5', monto: 100, resultado_jugador: 100, resultado_banquero: -100 },
    // ANULADO ("pp" sin que ninguno figure en la pizarra): 0 y 0 -- NO debe
    // generar el 2% de 50 (=1,00); si el bug existiera, PEDRO daría 3,00.
    { id: 't-anulado', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: 'pp', caballo: '4x3', monto: 50, resultado_jugador: 0, resultado_banquero: 0 },
    // SOLONULA: su único ticket del día quedó anulado -- no debe generar
    // NINGÚN devuelto ni aparecer en ninguno de los 2 reportes.
    { id: 't-solonula-anulado', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'SOLONULA', modalidad: 'pp', caballo: '2x1', monto: 200, resultado_jugador: 0, resultado_banquero: 0 }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [{ id: 'ap1', grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'Santa Anita' }],
  hipismo_adelantadas_jugadas: [
    // DECIDIDA: ANA ganó su Marca de 200 -- SÍ debe generar 3% = 6,00.
    { id: 'ad-decidida', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'marca', gano: true, cliente_nombre: 'ANA', monto: 200, numero1: 1, numero2: 3, numero_ejemplar: null },
    // ANULADA (ninguno de los 2 caballos figuró -- gano=null, "13ma — pp
    // (1x7)" del caso real reportado por el usuario): NO debe generar el
    // 3% de 80 (=2,40); si el bug existiera, ANA daría 8,40.
    { id: 'ad-anulada', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'marca', gano: null, cliente_nombre: 'ANA', monto: 80, numero1: 1, numero2: 7, numero_ejemplar: null }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias (services/hipismoComisionPropia.js) ----
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  if (sql === 'SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre, cc_av.nombre AS cc_avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id LEFT JOIN jugadores cc_av ON cc_av.id = av.cuenta_comision_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])') {
    return { rows: [] };
  }

  // ---- obtenerApuestasDelDia (Montos Apostados / Comisiones Devueltas / Traspaso de Jugadas) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.numero_ejemplar, a\.monto, r\.hipodromo_nombre, r\.carrera_numero, r\.numero_ganador, r\.hubo_ganador\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId)
      .map(j => ({ j, p: TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ j, p }) => ({ id: j.id, cliente_nombre: j.cliente_nombre, tipo: j.tipo, monto: j.monto, numero_ejemplar: j.numero_ejemplar, numero1: j.numero1, numero2: j.numero2, carrera_numero: j.carrera_numero, gano: j.gano, hipodromo_nombre: p.hipodromo_nombre }));
    return { rows: filas };
  }

  throw new Error('La base de datos falsa de esta prueba (comisiones-devueltas-no-decide) no sabe responder: ' + sql);
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

  // ---- 1) GET /comisiones-devueltas?fecha= ----
  const salidaDevueltas = await invocarRuta(handlerDe('get', '/comisiones-devueltas'), { ...reqBase, query: { fecha: FECHA } });
  check(!!salidaDevueltas, '1a) GET /comisiones-devueltas respondió algo');
  const clientesDevueltas = (salidaDevueltas && salidaDevueltas.clientes) || [];
  const filaPedro = clientesDevueltas.find(c => c.nombre === 'PEDRO');
  const filaAna = clientesDevueltas.find(c => c.nombre === 'ANA');
  const filaSolonula = clientesDevueltas.find(c => c.nombre === 'SOLONULA');

  check(!!filaPedro && Math.abs(filaPedro.total - 2.00) < 0.001,
    `1b) ARREGLO: PEDRO en /comisiones-devueltas da 2,00 (SOLO el ticket decidido de 100; el "pp" anulado de 50 -- caso real: Sebastian -- no suma nada) -- dio ${filaPedro ? filaPedro.total : 'nada'}`);
  check(!!filaAna && Math.abs(filaAna.total - 6.00) < 0.001,
    `1c) ARREGLO: ANA en /comisiones-devueltas da 6,00 (SOLO la Marca decidida de 200; la Marca "sin_decidir" de 80 no suma nada) -- dio ${filaAna ? filaAna.total : 'nada'}`);
  check(!filaSolonula, '1d) ARREGLO: SOLONULA (su única jugada del día quedó anulada) NO aparece en /comisiones-devueltas -- ni con total 0');

  // El detalle expandido de PEDRO solo debe traer la carrera decidida.
  check(!!filaPedro && Array.isArray(filaPedro.hipodromos) && filaPedro.hipodromos.length === 1 && filaPedro.hipodromos[0].carreras.length === 1,
    '1e) El detalle expandido de PEDRO trae UNA sola carrera (la decidida) -- la anulada ni aparece en el detalle');

  const totalGeneralEsperado = 8.00; // 2,00 (PEDRO) + 6,00 (ANA)
  check(Math.abs((salidaDevueltas && salidaDevueltas.totalGeneral) - totalGeneralEsperado) < 0.001,
    `1f) totalGeneral de /comisiones-devueltas = 8,00 (2,00 + 6,00, sin las jugadas anuladas) -- dio ${salidaDevueltas && salidaDevueltas.totalGeneral}`);

  // ---- 2) GET /comisiones-devueltas-por-hipodromo?fecha= ----
  const salidaHipodromo = await invocarRuta(handlerDe('get', '/comisiones-devueltas-por-hipodromo'), { ...reqBase, query: { fecha: FECHA } });
  check(!!salidaHipodromo, '2a) GET /comisiones-devueltas-por-hipodromo respondió algo');
  const hipodromos = (salidaHipodromo && salidaHipodromo.hipodromos) || [];
  const rinconada = hipodromos.find(h => h.nombre === 'La Rinconada');
  check(!!rinconada && Math.abs(rinconada.totalDevuelto - 2.00) < 0.001,
    `2b) ARREGLO: "La Rinconada" (Tercios de PEDRO) da 2,00, no 3,00 -- dio ${rinconada ? rinconada.totalDevuelto : 'nada'}`);
  check(Math.abs((salidaHipodromo && salidaHipodromo.totalGeneral) - totalGeneralEsperado) < 0.001,
    `2c) totalGeneral de /comisiones-devueltas-por-hipodromo = 8,00 -- dio ${salidaHipodromo && salidaHipodromo.totalGeneral}`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
