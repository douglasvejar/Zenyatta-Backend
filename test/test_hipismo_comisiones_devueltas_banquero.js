// =================================================================
// PRUEBA: el lado BANQUERO también debe generar "% devuelto" en los 2
// reportes de auditoría "Comisiones Devueltas por Cliente"/"por
// Hipódromo" (02-10-2026, caso real reportado con 2 capturas de
// pantalla: MUJICA, con 1% de porcentaje propio, banqueó/cubrió una
// jugada de Tercios en Horseshoe Indianapolis (verbo "Dio 10a4 del 1" en
// "Mis Jugadas", -80,00 con 200,00 apostado) y esa carrera NUNCA
// aparecía en "Comisiones Devueltas por Cliente" para MUJICA, aunque su
// total SÍ sumaba bien el resto de sus carreras jugadas como JUGADOR
// ("Jugó X del Y") — el usuario pidió explícitamente: "hay mas jugadas y
// hay jugadas que no le estas devolviendo % ... porque? ... verifica que
// a ndie le falte ninguna carrera por pagarle su %... explicame porque
// paso eso y solucionalo no puede suceder mas".
//
// El bug real: obtenerApuestasDelRango/obtenerApuestasDelDia
// (routes/hipismo.js) SOLO armaba una entrada por el lado JUGADOR de
// cada ticket/Marca (cliente_nombre/resultado_jugador,
// cliente_nombre/resultado_cliente) y nunca una para el lado BANQUERO —
// a diferencia de construirResumenClienteHipismo
// (services/hipismoResumenCliente.js, que alimenta Balance General/
// Cierre Final) y GET /saldo-comisiones, que desde el 29-09-2026 SÍ
// suman el lado banquero ("el lado BANQUERO de Tercios/de una Marca
// también genera % devuelto") — así que MUJICA SÍ veía su % completo en
// Balance General/Cierre Final y en Saldo Comisiones, pero
// /comisiones-devueltas y /comisiones-devueltas-por-hipodromo (que usan
// esa función compartida) le faltaba justo la parte banqueada.
//
// Casos cubiertos:
//   1. GET /comisiones-devueltas?fecha=: MUJICA aparece con su % de la
//      carrera que banqueó (1% de 200 decidido = 2,00), SUMADO a lo que
//      ya le tocaba como jugador en otra carrera (1% de 70 decidido =
//      0,70) -- total 2,70.
//   2. El detalle expandido de MUJICA trae las 2 carreras (la jugada Y la
//      banqueada), cada una con su propio hipódromo/carrera.
//   3. El lado BANQUERO de una Marca (Jugadas Adelantadas) también
//      genera % devuelto -- SOCIO, que banqueó el 40% de una Marca de
//      CARLOS, aparece con su % sobre su parte banqueada.
//   4. GET /comisiones-devueltas-por-hipodromo?fecha=: el total de
//      Horseshoe Indianapolis (donde MUJICA banqueó) SÍ incluye esos
//      2,00, antes invisibles.
//   5. Regresión: GET /montos-apostados NO debe sumarle a MUJICA/SOCIO lo
//      que banquearon -- "banquear no es apostar" (ver la nota grande de
//      obtenerApuestasDelRango) -- el fix de este archivo es SOLO para
//      los reportes de % devuelto, nunca para Montos Apostados.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-devueltas-banquero-1';
const FECHA = '2026-10-01';

const JUGADOR_MUJICA = { id: 'j-mujica', grupo_id: GRUPO_ID, nombre: 'MUJICA', comision_propia: 1, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_PEDRO = { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_CARLOS = { id: 'j-carlos', grupo_id: GRUPO_ID, nombre: 'CARLOS', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_SOCIO = { id: 'j-socio', grupo_id: GRUPO_ID, nombre: 'SOCIO', comision_propia: 2, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_MUJICA }, { ...JUGADOR_PEDRO }, { ...JUGADOR_CARLOS }, { ...JUGADOR_SOCIO }],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-thistledown', grupo_id: GRUPO_ID, hipodromo_nombre: 'Thistledown', carrera_numero: 3, fecha: FECHA },
    { id: 'p-horseshoe', grupo_id: GRUPO_ID, hipodromo_nombre: 'Horseshoe Indianapolis', carrera_numero: 7, fecha: FECHA }
  ],
  hipismo_tickets: [
    // MUJICA como JUGADOR (verbo "Jugó" en Mis Jugadas) -- esto YA
    // aparecía bien antes del fix: ganó 100 decidido -> 1% = 1,00.
    { id: 't-mujica-jugador', plano_id: 'p-thistledown', grupo_id: GRUPO_ID, cliente_nombre: 'MUJICA', banquero_nombre: 'PEDRO', modalidad: '10A7', caballo: '5', monto: 100, resultado_jugador: 66.5, resultado_banquero: -100 },
    // PEDRO jugó contra MUJICA en Horseshoe Indianapolis y perdió 200
    // decidido -- MUJICA banqueó esa carrera (verbo "Dio" en Mis
    // Jugadas, caso real reportado) y por eso también gana 1% = 2,00,
    // que es justo lo que el bug se comía por completo.
    { id: 't-mujica-banquero', plano_id: 'p-horseshoe', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'MUJICA', modalidad: '10A4', caballo: '1', monto: 200, resultado_jugador: -200, resultado_banquero: 190 }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [{ id: 'ap-santa-anita', grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'Santa Anita' }],
  hipismo_adelantadas_jugadas: [
    // CARLOS jugó una Marca y ganó 300 decidido; SOCIO banqueó el 40% de
    // esa Marca -- su % propio (2%) debe calcularse sobre SU PARTE
    // banqueada (300 * 40% = 120), nunca sobre el monto completo.
    {
      id: 'ad-marca-banqueada', plano_id: 'ap-santa-anita', grupo_id: GRUPO_ID, tipo: 'marca', gano: true,
      cliente_nombre: 'CARLOS', monto: 300, resultado_cliente: 300, numero1: 2, numero2: 9, numero_ejemplar: null,
      banqueadores: [{ nombre: 'SOCIO', porcentaje: 40 }]
    }
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
  if (sql === 'SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])') {
    return { rows: [] };
  }

  // ---- obtenerApuestasDelDia (Montos Apostados / Comisiones Devueltas / Traspaso de Jugadas) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.numero_ejemplar, a\.monto, r\.hipodromo_nombre, r\.carrera_numero, r\.numero_ganador, r\.hubo_ganador\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.banqueadores, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId)
      .map(j => ({ j, p: TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ j, p }) => ({ id: j.id, cliente_nombre: j.cliente_nombre, tipo: j.tipo, monto: j.monto, resultado_cliente: j.resultado_cliente, numero_ejemplar: j.numero_ejemplar, numero1: j.numero1, numero2: j.numero2, carrera_numero: j.carrera_numero, gano: j.gano, banqueadores: j.banqueadores, hipodromo_nombre: p.hipodromo_nombre }));
    return { rows: filas };
  }

  throw new Error('La base de datos falsa de esta prueba (comisiones-devueltas-banquero) no sabe responder: ' + sql);
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
  const filaMujica = clientesDevueltas.find(c => c.nombre === 'MUJICA');
  const filaSocio = clientesDevueltas.find(c => c.nombre === 'SOCIO');
  const filaPedro = clientesDevueltas.find(c => c.nombre === 'PEDRO');

  // 0,70 (1% de 70 decidido -- resultado_jugador=66,5/0,95=70, mismo
  // monto EXACTO del caso real reportado: Thistledown "+0,70" con 100
  // apostado) + 2,00 (1% de 200 decidido -- resultado_banquero=190/0,95=
  // 200 -- lo que banqueó en Horseshoe Indianapolis, caso real reportado,
  // invisible por completo antes de este fix).
  check(!!filaMujica && Math.abs(filaMujica.total - 2.70) < 0.001,
    `1b) ARREGLO: MUJICA en /comisiones-devueltas da 2,70 (0,70 de lo que jugó en Thistledown + 2,00 de lo que banqueó en Horseshoe Indianapolis, caso real reportado) -- dio ${filaMujica ? filaMujica.total : 'nada'}`);
  check(!filaPedro, '1c) PEDRO (comision_propia=0, sin % configurado) no aparece en /comisiones-devueltas, ni como jugador ni como banquero');

  // El detalle expandido de MUJICA debe traer LAS 2 carreras: la que
  // jugó (Thistledown) y la que banqueó (Horseshoe Indianapolis) -- antes
  // del fix, Horseshoe Indianapolis faltaba por completo.
  check(!!filaMujica && Array.isArray(filaMujica.hipodromos) && filaMujica.hipodromos.length === 2,
    `1d) ARREGLO: el detalle expandido de MUJICA trae sus 2 hipódromos (Thistledown jugado + Horseshoe Indianapolis banqueado) -- trajo ${filaMujica ? filaMujica.hipodromos.length : 0}`);
  const horseshoeDeMujica = filaMujica && filaMujica.hipodromos.find(h => h.nombre === 'Horseshoe Indianapolis');
  check(!!horseshoeDeMujica && Math.abs(horseshoeDeMujica.total - 2.00) < 0.001,
    `1e) ARREGLO: Horseshoe Indianapolis (banqueado) aporta 2,00 al detalle de MUJICA -- antes del fix esta carrera no aparecía en absoluto`);

  // ---- 2) Lado BANQUERO de una Marca (Jugadas Adelantadas) ----
  check(!!filaSocio && Math.abs(filaSocio.total - 2.40) < 0.001,
    `2a) ARREGLO: SOCIO (banqueó el 40% de la Marca de CARLOS, 2% propio sobre 300*40%=120) da 2,40 en /comisiones-devueltas -- dio ${filaSocio ? filaSocio.total : 'nada'}`);

  const totalGeneralEsperado = 5.10; // 2,70 (MUJICA) + 2,40 (SOCIO)
  check(Math.abs((salidaDevueltas && salidaDevueltas.totalGeneral) - totalGeneralEsperado) < 0.001,
    `2b) totalGeneral de /comisiones-devueltas = 5,10 (2,70 + 2,40) -- dio ${salidaDevueltas && salidaDevueltas.totalGeneral}`);

  // ---- 3) GET /comisiones-devueltas-por-hipodromo?fecha= ----
  const salidaHipodromo = await invocarRuta(handlerDe('get', '/comisiones-devueltas-por-hipodromo'), { ...reqBase, query: { fecha: FECHA } });
  check(!!salidaHipodromo, '3a) GET /comisiones-devueltas-por-hipodromo respondió algo');
  const hipodromos = (salidaHipodromo && salidaHipodromo.hipodromos) || [];
  const horseshoe = hipodromos.find(h => h.nombre === 'Horseshoe Indianapolis');
  check(!!horseshoe && Math.abs(horseshoe.totalDevuelto - 2.00) < 0.001,
    `3b) ARREGLO: Horseshoe Indianapolis (solo lo que MUJICA banqueó ahí) da 2,00 en /comisiones-devueltas-por-hipodromo -- antes del fix no aparecía -- dio ${horseshoe ? horseshoe.totalDevuelto : 'nada'}`);
  check(Math.abs((salidaHipodromo && salidaHipodromo.totalGeneral) - totalGeneralEsperado) < 0.001,
    `3c) totalGeneral de /comisiones-devueltas-por-hipodromo = 5,10 -- dio ${salidaHipodromo && salidaHipodromo.totalGeneral}`);

  // ---- 4) Regresión: /montos-apostados NO debe sumarle a MUJICA/SOCIO
  // lo que banquearon -- "banquear no es apostar" (ver la nota grande de
  // incluirBanquero en obtenerApuestasDelRango): este fix es SOLO para
  // los 2 reportes de % devuelto, Montos Apostados no cambia en nada.
  const salidaMontos = await invocarRuta(handlerDe('get', '/montos-apostados'), { ...reqBase, query: { fecha: FECHA } });
  check(!!salidaMontos, '4a) GET /montos-apostados respondió algo');
  const clientesMontos = (salidaMontos && salidaMontos.clientes) || [];
  const mujicaMontos = clientesMontos.find(c => c.nombre === 'MUJICA');
  check(!!mujicaMontos && Math.abs(mujicaMontos.total - 100) < 0.001,
    `4b) REGRESIÓN: MUJICA en /montos-apostados solo trae lo que JUGÓ (100 en Thistledown), nunca lo que banqueó en Horseshoe Indianapolis (200) -- dio ${mujicaMontos ? mujicaMontos.total : 'nada'}`);
  check(!clientesMontos.find(c => c.nombre === 'SOCIO'),
    '4c) REGRESIÓN: SOCIO (solo banqueó, nunca jugó como cliente) no aparece en /montos-apostados');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
