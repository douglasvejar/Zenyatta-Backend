// =================================================================
// VERIFICACIÓN (11-10-2026, a pedido del usuario: "verifica si el % de las
// marcas y de las tablas me lo estás sumando a la comisión"): arma en un
// mismo día Tercios + Tabla Fija (sin banqueadores) + Marca con 2 banqueadores +
// Tabla Fija con banqueadores + Marca sin banqueo todavía, y confirma que:
//   * comisionSemana = Tercios 5,00 + TF 5,00 + Marca 1,25 + TF banq. 2,50
//     - % propio devuelto de PEDRO 2,00 = 11,75 (la Marca sin banqueo no suma
//     nada todavía), tanto en /cierre-final como en /semana-por-dias.
//   * Cuadre exacto: la suma de TODOS los renglones de clientes + COMISIÓN
//     GRUPO = 0,00 (no se pierde ni se duplica ni un centavo).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-verif-tf-marcas';
const FECHA = '2026-09-29'; // martes

const JUGADOR_PEDRO = { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 2, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_BANCO = { id: 'j-banco', grupo_id: GRUPO_ID, nombre: 'BANCO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_ANA = { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_LUIS = { id: 'j-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_PEDRO }, { ...JUGADOR_BANCO }, { ...JUGADOR_ANA }, { ...JUGADOR_LUIS }, { id: 'j-0', grupo_id: GRUPO_ID, nombre: 'HOUSTON', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }, { id: 'j-1', grupo_id: GRUPO_ID, nombre: 'LINARES', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }, { id: 'j-2', grupo_id: GRUPO_ID, nombre: 'ZAMURAY', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }, { id: 'j-3', grupo_id: GRUPO_ID, nombre: 'MARCAS ZENYATTA', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }, { id: 'j-4', grupo_id: GRUPO_ID, nombre: 'MARCAS SAMMY', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }, { id: 'j-5', grupo_id: GRUPO_ID, nombre: 'TABLAS ZENYATTA', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }, { id: 'j-6', grupo_id: GRUPO_ID, nombre: 'TABLAS SAMMY', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }],
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
  hipismo_remates: [],
  hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [{ id: 'ap1', grupo_id: GRUPO_ID, fecha: FECHA }],
  // Tabla Fija: ANA ganó 95 netos, con 5,00 de comisión de Tabla Fija
  // ("% DE TABLAS FIJAS") -- a propósito con un monto GRANDE para que,
  // si por error se sumara esa comisión a "comisionSemana", el número
  // resultante sería obviamente distinto de 3,00.
  hipismo_adelantadas_jugadas: [
    // Tabla Fija SIN banqueadores configurados (banca = ítem TABLAS FIJAS)
    { id: 'ad1', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'tf', estado: 'resuelto', gano: true, cliente_nombre: 'ANA', monto: 100, resultado_cliente: 95, comision: 5, banqueadores: null },
    // Marca ya banqueada (ejemplo real Houston 4x7 120$): +100 / -50 / -51,25 / comisión 1,25
    { id: 'ad2', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'marca', estado: 'resuelto', gano: true, cliente_nombre: 'HOUSTON', monto: 120, resultado_cliente: 100, comision: 1.25,
      banqueadores: [{ nombre: 'MARCAS ZENYATTA', porcentaje: 50, monto: -50 }, { nombre: 'MARCAS SAMMY', porcentaje: 50, monto: -51.25 }] },
    // Tabla Fija CON banqueadores del grupo: 47,50 / -25 / -25 / comisión 2,50
    { id: 'ad3', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'tf', estado: 'resuelto', gano: true, cliente_nombre: 'LINARES', monto: 50, resultado_cliente: 47.5, comision: 2.5,
      banqueadores: [{ nombre: 'TABLAS ZENYATTA', porcentaje: 50, monto: -25 }, { nombre: 'TABLAS SAMMY', porcentaje: 50, monto: -25 }] },
    // Marca decidida SIN banqueo todavía: todavía no hay comisión que sumar
    { id: 'ad4', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'marca', estado: 'falta_banqueo', gano: false, cliente_nombre: 'ZAMURAY', monto: 30, resultado_cliente: -30, comision: null, banqueadores: null }
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
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores, j\.monto(, j\.gano)?(, j\.sin_comision)?, p\.fecha/i.test(sql)) {
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
  // 15-10-2026: ítem "REMATE" por día (consulta nueva de /semana-por-dias) — esta prueba no tiene remates.
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3 GROUP BY fecha/i.test(sql)) return { rows: [] };
  // 15-10-2026: espejo del ítem "TABLAS FIJAS" por día (consulta nueva de /semana-por-dias) — esta prueba no lo usa.
  if (/^SELECT p\.fecha AS fecha, j\.resultado_cliente, j\.comision\s+FROM hipismo_adelantadas_jugadas j/i.test(sql)) return { rows: [] };
  if (/^SELECT p\.fecha AS fecha, j\.comision\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId).map(j => {
        const p = TABLAS.hipismo_adelantadas_planos.find(x => x.id === j.plano_id);
        return { fecha: p.fecha, comision: j.comision };
      })
    };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
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

  const c = await invocarRuta(handlerDe('get', '/cierre-final'), { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { semana: 'actual' } });
  check(!!c, '1) /cierre-final respondió');
  check(Math.abs(Number(c.comisionAdelantadasSemana) - (5 + 1.25 + 2.5)) < 0.001, `2) comisión cruda de Tablas Fijas + Marcas = 5,00 + 1,25 + 2,50 = 8,75 (la Marca sin banqueo no suma) -- dio ${c.comisionAdelantadasSemana}`);
  check(Math.abs(Number(c.comisionSemana) - 11.75) < 0.001, `3) COMISIÓN GRUPO = 5,00 + 8,75 - 2,00 = 11,75 -- dio ${c.comisionSemana}`);
  const suma = Math.round(c.clientes.reduce((a, x) => a + x.saldo, 0) * 100) / 100;
  // ZAMURAY perdió 30 en una Marca todavía SIN banqueo: su lado perdedor ya cuenta, pero la banca todavía
  // no existe (se asigna después), así que ese -30 es lo único que queda sin contraparte.
  const dif = Math.round((suma + Number(c.comisionSemana)) * 100) / 100;
  check(Math.abs(dif - (-30)) < 0.011, `4) CUADRE: suma de todos los renglones (${suma}) + comisión (${c.comisionSemana}) = -30,00, que es justo la Marca de ZAMURAY todavía sin banqueo (sin ella da 0,00) -- dio ${dif}`);
  check(Math.abs(c.clientes.find(x => x.nombre === 'ZAMURAY').saldo - (-30)) < 0.001, '4b) ZAMURAY sigue con -30 en su renglón');
  const nombres = c.clientes.map(x => x.nombre).sort().join(' | ');
  console.log('   renglones:', nombres);
  const d = await invocarRuta(handlerDe('get', '/semana-por-dias'), { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: {} });
  check(!!d && Math.abs(Number(d.comisionSemana) - 11.75) < 0.001, `5) /semana-por-dias da la misma COMISIÓN GRUPO 11,75 -- dio ${d && d.comisionSemana}`);

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  if (fallaron > 0) process.exit(1);
})().catch(e => { console.error('Error inesperado en la prueba:', e); process.exit(1); });
