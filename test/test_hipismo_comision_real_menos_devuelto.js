// =================================================================
// PRUEBA: "COMISIÓN REAL" — de la comisión que queda en el grupo se
// resta todo el % devuelto a clientes/avaladores (29-09-2026, a pedido
// explícito del usuario: "de la comison que queda en el grupo debes
// restar todos los % que se le devuelven a los clientes para ver la
// comision real de cuanto queda en el grupo" — confirmado con un
// ejemplo numérico exacto, y luego "CASO A PARA TODOS LOS RENGLONES,
// BALANCES, CIERRE FINAL, SALDO POR DIA, SALDO POR SEMANA... TODOS LOS
// SALDOS CASO A").
//
// 02-10-2026 — "COMISIÓN GRUPO" = TODO, no solo Tercios: el usuario
// verificó contra OTRO sistema con un ejemplo real ("se hicieron de
// comisión 183,55 [bruta, de TODOS los tipos de jugada, con el 5%]...
// la devolución fue de 77,52... restando eso le queda al grupo
// 106,02") y pidió que "COMISIÓN GRUPO" sea justo eso: bruta de TODOS
// los tipos de jugada (Tercios + Tablas Fijas + Marcas) menos TODO lo
// devuelto. Esta prueba se actualiza para ese nuevo "Caso B": ahora SÍ
// se suma "% DE TABLAS FIJAS"/"PORCENTAJE MARCAS" (que dejaron de
// armarse como su propio renglón de "cliente" — ver la nota grande de
// comisionAdelantadasSemana en GET /cierre-final) — la comisión de
// Remate sigue siendo la ÚNICA que nunca entra, porque Remate no es
// "comisión del grupo" en ningún sistema, tiene su propio ítem aparte.
//
// Este caso arma, en el MISMO día, las 3 fuentes de comisión (Tercios,
// Tabla Fija de Adelantadas, Remate) más el % propio de un cliente, y
// confirma que "comisionSemana" en GET /cierre-final Y en GET
// /semana-por-dias dan EXACTAMENTE el mismo número: Tercios (5,00) +
// Tabla Fija (5,00) menos el % devuelto (2,00) = 8,00 — nunca sumando
// los +12,50 de Remate (ese nunca es "comisión del grupo").
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-comision-real-1';
const FECHA = '2026-09-29'; // martes

const JUGADOR_PEDRO = { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 2, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_BANCO = { id: 'j-banco', grupo_id: GRUPO_ID, nombre: 'BANCO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_ANA = { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_LUIS = { id: 'j-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_PEDRO }, { ...JUGADOR_BANCO }, { ...JUGADOR_ANA }, { ...JUGADOR_LUIS }],
  jugadores_avales_porcentaje: [],
  // Tercios: PEDRO le gana 100 a BANCO -- comisión de ESE plano: 5,00
  // (5%% de 100). El % propio de PEDRO (2%%) se gana sobre el monto
  // completo (100), sin importar cuánto ganó -- 2,00.
  hipismo_planos: [{ id: 'p1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA, cruza_jugadas: false, comision_total: 5.00 }],
  hipismo_tickets: [
    { id: 't1', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCO', modalidad: '1P', caballo: '5', monto: 100, resultado_jugador: 95, resultado_banquero: -100, sin_comision: false }
  ],
  // Remate: LUIS pierde 50 en un remate cuya comisión total (la que se
  // queda "la casa" de ESE remate puntual) es 12,50 -- a propósito un
  // número que NO calza con -(-50) para dejar claro que esta prueba no
  // depende de que Remate sea "zero-sum" con sus apuestas: solo importa
  // que comisionRemateSemana (12,50) NUNCA se sume a comisionSemana.
  hipismo_remates: [{ id: 'r1', grupo_id: GRUPO_ID, hipodromo_nombre: 'Churchill Downs', carrera_numero: 5, fecha: FECHA, comision_total: 12.50 }],
  hipismo_remate_apuestas: [
    { id: 'ra1', grupo_id: GRUPO_ID, remate_id: 'r1', cliente_nombre: 'LUIS', caballo: '(2)', resultado: -50, monto: 50 }
  ],
  hipismo_adelantadas_planos: [{ id: 'ap1', grupo_id: GRUPO_ID, fecha: FECHA }],
  // Tabla Fija: ANA ganó 95 netos, con 5,00 de comisión de Tabla Fija
  // ("% DE TABLAS FIJAS") -- a propósito con un monto GRANDE para que,
  // si por error se sumara esa comisión a "comisionSemana", el número
  // resultante sería obviamente distinto de 3,00.
  hipismo_adelantadas_jugadas: [
    { id: 'ad1', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'tf', estado: 'resuelto', gano: true, cliente_nombre: 'ANA', monto: 100, resultado_cliente: 95, comision: 5, banqueadores: [] }
  ],
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
    return { rows: [] };
  }

  // ---- /cierre-final ----
  // (negative lookahead: la variante de /semana-por-dias es igual pero
  // sigue con ", p.fecha" -- sin esto, esta regex más corta la
  // interceptaría primero por ser un prefijo exacto de esa otra query.)
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s*t\.plano_id, t\.sin_comision, p\.cruza_jugadas(?!, p\.fecha)/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId).map(t => {
        const p = TABLAS.hipismo_planos.find(x => x.id === t.plano_id);
        return { cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: p.cruza_jugadas };
      })
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.hipismo_remate_apuestas.filter(a => a.grupo_id === grupoId).map(a => ({ cliente_nombre: a.cliente_nombre, resultado: a.resultado, monto: a.monto })) };
  }
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto(, j\.gano)?/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId).map(j => ({
        cliente_nombre: j.cliente_nombre, tipo: j.tipo, resultado_cliente: j.resultado_cliente,
        comision: j.comision, banqueadores: j.banqueadores, monto: j.monto, gano: j.gano
      }))
    };
  }
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s*FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) {
    const [grupoId] = params;
    const total = TABLAS.hipismo_remates.filter(r => r.grupo_id === grupoId).reduce((s, r) => s + r.comision_total, 0);
    return { rows: [{ total }] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_planos/i.test(sql)) {
    const [grupoId] = params;
    const total = TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId).reduce((s, p) => s + p.comision_total, 0);
    return { rows: [{ total }] };
  }

  // ---- /semana-por-dias ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.fecha/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId).map(t => {
        const p = TABLAS.hipismo_planos.find(x => x.id === t.plano_id);
        return { cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: p.cruza_jugadas, fecha: p.fecha };
      })
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto, r\.fecha\s+FROM hipismo_remate_apuestas/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_remate_apuestas.filter(a => a.grupo_id === grupoId).map(a => {
        const r = TABLAS.hipismo_remates.find(x => x.id === a.remate_id);
        return { cliente_nombre: a.cliente_nombre, resultado: a.resultado, monto: a.monto, fecha: r.fecha };
      })
    };
  }
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores, j\.monto(, j\.gano)?, p\.fecha/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId).map(j => {
        const p = TABLAS.hipismo_adelantadas_planos.find(x => x.id === j.plano_id);
        return { cliente_nombre: j.cliente_nombre, resultado_cliente: j.resultado_cliente, banqueadores: j.banqueadores, monto: j.monto, gano: j.gano, fecha: p.fecha };
      })
    };
  }
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId);
    const porFecha = new Map();
    filas.forEach(p => porFecha.set(p.fecha, (porFecha.get(p.fecha) || 0) + p.comision_total));
    return { rows: Array.from(porFecha.entries()).map(([fecha, total]) => ({ fecha, total })) };
  }
  // 02-10-2026 ("COMISIÓN GRUPO" = TODO, no solo Tercios — ver la nota
  // grande de comisionAdelantadasSemana en GET /cierre-final): nueva
  // consulta de /semana-por-dias para sumar también la comisión de
  // Tablas Fijas/Marcas por día.
  if (/^SELECT p\.fecha AS fecha, j\.comision\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId).map(j => {
        const p = TABLAS.hipismo_adelantadas_planos.find(x => x.id === j.plano_id);
        return { fecha: p.fecha, comision: j.comision };
      })
    };
  }

  throw new Error('La base de datos falsa de esta prueba (comision-real-menos-devuelto) no sabe responder: ' + sql);
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

  // ---- 1) GET /cierre-final ----
  const reqCierre = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } };
  const salidaCierre = await invocarRuta(handlerDe('get', '/cierre-final'), reqCierre);
  check(!!salidaCierre, '1a) GET /cierre-final respondió algo');

  check(Number(salidaCierre.comisionRemateSemana) === 12.50, '1b) comisionRemateSemana (dato crudo) sigue trayendo 12,50, sin cambios');

  check(Number(salidaCierre.comisionSemana) === 8.00,
    `1c) ARREGLO (02-10-2026): comisionSemana = 5,00 (Tercios) + 5,00 (Tabla Fija) - 2,00 (PEDRO - porcentaje) = 8,00 -- NUNCA sumando los +12,50 del Remate -- dio ${salidaCierre.comisionSemana}`);

  const filaPedroPct = salidaCierre.clientes.find(c => c.nombre === 'PEDRO - PORCENTAJE');
  check(!!filaPedroPct && Math.abs(filaPedroPct.saldo - 2.00) < 0.001, '1d) "PEDRO - PORCENTAJE" sigue apareciendo con 2,00 (sin cambios, esto ya funcionaba)');
  const filaTfPct = salidaCierre.clientes.find(c => c.nombre === '% DE TABLAS FIJAS');
  check(!filaTfPct, '1e) "% DE TABLAS FIJAS" ya NO aparece como su propio renglón de cliente (02-10-2026: esa comisión ahora se suma directo a "COMISIÓN GRUPO")');
  const filaRemate = salidaCierre.clientes.find(c => c.nombre === 'REMATE');
  check(!!filaRemate && Math.abs(filaRemate.saldo - 12.50) < 0.001, '1f) El ítem "REMATE" sigue apareciendo con 12,50 (no desapareció, solo no se suma a comisionSemana)');

  // ---- 2) GET /semana-por-dias (mismo día, debe dar el mismo total) ----
  const reqDias = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: {} };
  const salidaDias = await invocarRuta(handlerDe('get', '/semana-por-dias'), reqDias);
  check(!!salidaDias, '2a) GET /semana-por-dias respondió algo');
  check(Number(salidaDias.comisionSemana) === 8.00,
    `2b) ARREGLO: comisionSemana de Semana por Días TAMBIÉN da 8,00 -- igualado a Cierre Final -- dio ${salidaDias.comisionSemana}`);
  check(salidaDias.dias.length === 1 && JSON.stringify(salidaDias.comisionPorDia) === JSON.stringify([8.00]),
    `2c) comisionPorDia trae un solo día (${FECHA}) con 8,00 -- dio ${JSON.stringify(salidaDias.comisionPorDia)}`);

  global.Date = OriginalDate;

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
