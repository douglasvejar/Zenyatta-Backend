// =================================================================
// PRUEBA: "cliente doble" por espacios de más entre palabras (29-09-2026,
// a pedido del usuario después de reportar, por segunda vez, el mismo
// síntoma con el mismo cliente: "YA HAY UN Mrincreible EN CLIENTES CON
// LOS % CORRESPONDIENTES Y EL Mrincreible DE BALANCES NO MUESTRA %" —
// confirmado con el usuario que hay un solo cliente registrado (no un
// duplicado de ficha) y que Balance General le sigue dando -300 en vez
// de -297.
//
// Diagnóstico: jugadores.nombre exige un match EXACTO letra por letra
// contra hipismo_tickets/hipismo_adelantadas_jugadas.cliente_nombre para
// aplicar el % propio (obtenerComisionesPropias, en
// services/hipismoComisionPropia.js). En "Cargar Planos" (Tercios) el
// nombre del cliente SIEMPRE es un solo token sin espacios (LINEA_REGEX
// de hipismoCalc.js usa \S+), así que ahí un espacio de más es
// imposible — pero en "Planos Marcas y Tablas Adelantadas" (RE_CLIENTE =
// /^JUGANDO\s+(.+)$/i, hipismoAdelantadasCalc.js) y en "Remate"
// (parsearRemate, hipismoRemateCalc.js) el nombre SÍ puede traer varias
// palabras — un espacio de más ahí (fácil de tipear sin querer en
// WhatsApp, ej. "JUGANDO Mr  Increible" con doble espacio) queda
// GUARDADO tal cual pero es INVISIBLE en el navegador (que colapsa
// espacios de más al mostrar texto), así que el cliente se ve idéntico
// en Balance General y en Clientes mientras el % de su ficha nunca se
// llega a aplicar, sin ningún aviso.
//
// Esta prueba cubre las 2 capas del arreglo:
//   1) PREVENCIÓN — parsearJugadasAdelantadas()/parsearRemate() ahora
//      colapsan espacios de más al armar el nombre del cliente, para que
//      esto no vuelva a pasar de acá en adelante.
//   2) CURA — obtenerComisionesPropias()/asegurarCuentasComisionParaNombres()
//      (services/hipismoComisionPropia.js) ahora tienen un "rescate": si
//      un nombre de una jugada real no calza EXACTO contra ningún
//      jugador, se busca también por nombre normalizado (mayúscula +
//      espacios de más colapsados), para que una jugada YA guardada de
//      antes (con un espacio de más) también quede bien, sin tener que
//      re-tipear nada a mano.
//   3) Reproducción end-to-end del reporte real: GET /cierre-final le da
//      -297 (no -300) al cliente, en un solo ítem, con el mismo criterio
//      exacto del caso reportado (1% propio, "incluir % en sus jugadas"
//      en ON).
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// =================================================================
// 1) PREVENCIÓN — parseo de texto libre colapsa espacios de más.
// =================================================================
const { parsearJugadasAdelantadas } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoAdelantadasCalc'));
const { parsearRemate } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoRemateCalc'));

(() => {
  const { jugadas } = parsearJugadasAdelantadas('*JUGANDO Mr  Increible*\n5) 3TF DEL 4 A 20 ,50/300$\n');
  check(jugadas.length === 1 && jugadas[0].cliente === 'MR INCREIBLE',
    `1a) Jugadas Adelantadas: "JUGANDO Mr  Increible" (doble espacio) queda como cliente "MR INCREIBLE" (un solo espacio), no "MR  INCREIBLE" -- dio ${JSON.stringify(jugadas.map(j => j.cliente))}`);
})();

(() => {
  const { apuestas } = parsearRemate('1) 5 30$ Mr  Increible');
  check(apuestas.length === 1 && apuestas[0].cliente === 'MR INCREIBLE',
    '1b) Remate: "...30$ Mr  Increible" (doble espacio) queda como cliente "MR INCREIBLE" (un solo espacio), no "MR  INCREIBLE"');
})();

// =================================================================
// 2) y 3) CURA + reproducción end-to-end — necesita el fake DB completo.
// =================================================================
const GRUPO_ID = 'g-cliente-doble-1';
const FECHA = '2026-09-28';
// El cliente real, registrado UNA sola vez, con nombre LIMPIO (un solo
// espacio) y su % correctamente configurado — exactamente como confirmó
// el usuario ("ya hay un Mrincreible en Clientes con los % correspondientes").
const JUGADOR_MR = { id: 'j-mr', grupo_id: GRUPO_ID, nombre: 'MR INCREIBLE', comision_propia: 1, incluir_porcentaje_en_jugadas: true, cuenta_comision_id: null };
// Otro cliente, para probar el "rescate" con el toggle OFF (asegurarCuentasComisionParaNombres).
const JUGADOR_PEDRO = { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 5, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_MR }, { ...JUGADOR_PEDRO }],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [{ id: 'p1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA, cruza_jugadas: false }],
  // La jugada REAL de "MR INCREIBLE" quedó guardada con un espacio de más
  // (simula haber venido de una línea "JUGANDO Mr  Increible" de ANTES de
  // este arreglo) — el bug real reportado.
  hipismo_tickets: [
    { id: 't1', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'MR  INCREIBLE', banquero_nombre: 'BANCA', modalidad: '1P', caballo: '3', monto: 300, resultado_jugador: -300, resultado_banquero: 285, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: [],
  hipismo_winners: [], hipismo_comisiones_ajustes: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias / asegurarCuentasComisionParaNombres ----
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  // "Rescate" (29-09-2026) — segunda consulta SIN filtro de nombre.
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1') {
    const [grupoId] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  if (sql === 'SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])') {
    return { rows: [] };
  }
  if (sql === 'SELECT id, nombre, comision_propia, cuenta_comision_id, incluir_porcentaje_en_jugadas FROM jugadores WHERE grupo_id = $1 AND nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)) };
  }
  // "Rescate" también acá (asegurarCuentasComisionParaNombres).
  if (sql === 'SELECT id, nombre, comision_propia, cuenta_comision_id, incluir_porcentaje_en_jugadas FROM jugadores WHERE grupo_id = $1') {
    const [grupoId] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId) };
  }
  if (sql === 'SELECT DISTINCT jap.avalador_id, av.nombre AS avalador_nombre, av.cuenta_comision_id AS avalador_cuenta_comision_id FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[]) AND jap.porcentaje > 0') {
    return { rows: [] };
  }
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial, es_cuenta_comision\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    let cuenta = TABLAS.jugadores.find(j => j.grupo_id === grupoId && j.nombre === nombre);
    if (!cuenta) {
      cuenta = { id: 'cta-' + (TABLAS.jugadores.length + 1), grupo_id: grupoId, nombre, comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: true };
      TABLAS.jugadores.push(cuenta);
    } else {
      cuenta.es_cuenta_comision = true;
    }
    return { rows: [{ id: cuenta.id }] };
  }
  if (/^UPDATE jugadores SET cuenta_comision_id = \$1/i.test(sql)) {
    const [cuentaId, jugadorId, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === jugadorId && x.grupo_id === grupoId);
    if (j && !j.cuenta_comision_id) j.cuenta_comision_id = cuentaId;
    return { rows: [] };
  }

  // ---- /cierre-final ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s*t\.plano_id, t\.sin_comision, p\.cruza_jugadas/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId).map(t => {
      const p = TABLAS.hipismo_planos.find(x => x.id === t.plano_id);
      return { cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: p.cruza_jugadas };
    }) };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s*FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) return { rows: [{ total: 0 }] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_planos/i.test(sql)) return { rows: [{ total: 0 }] };

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.\* FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (cliente-doble-espacios) no sabe responder: ' + sql);
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

const { obtenerComisionesPropias, asegurarCuentasComisionParaNombres } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoComisionPropia'));
const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));

Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }

(async function main() {
  // ---- 2a) obtenerComisionesPropias: rescate por nombre normalizado ----
  const comisiones = await obtenerComisionesPropias(GRUPO_ID, ['MR  INCREIBLE']); // el nombre EXACTO de la jugada real, con doble espacio
  const entradas = comisiones['MR  INCREIBLE'] || [];
  check(entradas.length === 1, '2a) obtenerComisionesPropias encuentra el % de "MR INCREIBLE" aunque la jugada real diga "MR  INCREIBLE" (doble espacio)');
  check(entradas[0] && entradas[0].incluidaEnJugada === true && entradas[0].cuentaNombre === 'MR  INCREIBLE',
    '2b) La entrada rescatada queda con cuentaNombre = "MR  INCREIBLE" (la clave de la jugada real, no la de la ficha) para que el % se sume a la MISMA fila del Balance');

  // ---- 2c) asegurarCuentasComisionParaNombres: rescate con toggle OFF ----
  // PEDRO tiene el toggle OFF y todavía no tiene cuenta_comision_id — la
  // jugada real llegó como "Pedro " (espacio de más al final, típico de
  // un tipeo apurado).
  await asegurarCuentasComisionParaNombres(GRUPO_ID, ['PEDRO ']);
  const pedroActualizado = TABLAS.jugadores.find(j => j.id === 'j-pedro');
  check(!!pedroActualizado.cuenta_comision_id, '2c) asegurarCuentasComisionParaNombres crea/enlaza la cuenta de comisión de PEDRO aunque la jugada real diga "PEDRO " (espacio de más)');
  const cuentaPedro = TABLAS.jugadores.find(j => j.id === pedroActualizado.cuenta_comision_id);
  check(!!cuentaPedro && cuentaPedro.nombre === 'PEDRO - PORCENTAJE', '2d) La cuenta creada se llama "PEDRO - PORCENTAJE" (nombre limpio de la ficha, no el de la jugada real)');

  // ---- 3) Reproducción end-to-end del reporte real: GET /cierre-final ----
  const OriginalDate = Date;
  const fake = new OriginalDate(FECHA + 'T12:00:00Z').getTime();
  global.Date = class extends OriginalDate { constructor(...a) { if (a.length === 0) super(fake); else super(...a); } static now() { return fake; } };
  const h = handlerDe('get', '/cierre-final');
  const req = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } };
  // asyncHandler (middleware/asyncHandler.js) envuelve la ruta real en
  // "Promise.resolve(fn(...)).catch(next)" SIN devolver esa promesa — así
  // que "await h(req, res, next)" no espera a que la ruta de verdad
  // termine. Hay que esperar a que se llame res.json() (mismo patrón ya
  // usado en test_hipismo_semana_por_dias_paridad.js/test_hipismo_winners.js).
  let salida = null;
  await new Promise((resolve, reject) => {
    const res = { status(c) { this._s = c; return this; }, json(o) { salida = o; resolve(); } };
    h(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR en /cierre-final:', e));
  global.Date = OriginalDate;

  check(!!salida, '3a) GET /cierre-final respondió algo');
  const filaMr = salida && salida.clientes ? salida.clientes.find(c => c.nombre === 'MR  INCREIBLE') : null;
  check(!!filaMr, '3b) "MR  INCREIBLE" (el nombre tal cual quedó en la jugada real) aparece en el Cierre Final');
  check(filaMr && Math.abs(Number(filaMr.saldo) - (-297)) < 0.001,
    `3c) El saldo final es -297 (perdió 300, se le devuelve 1% = 3, netos en su propia jugada) — dio ${filaMr ? filaMr.saldo : 'nada'} (antes de este arreglo daba -300, el % nunca se aplicaba)`);
  check(salida.clientes.filter(c => (c.nombre || '').replace(/\s+/g, ' ').trim() === 'MR INCREIBLE').length === 1,
    '3d) Aparece una SOLA fila para este cliente (no 2 filas separadas por el espacio de más)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
