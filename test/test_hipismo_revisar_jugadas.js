// =================================================================
// PRUEBA: pestaña "Revisar Jugadas" (05-10-2026, a pedido del usuario:
// "en administración necesito una pestaña que se llame revisar jugadas...
// al seleccionar el día, el hipódromo y la carrera me despliegue todo
// absolutamente todo lo que tiene esa carrera, tanto jugadas adelantadas,
// tablas, remate, todo, no puedes dejar nada afuera ni winners... allí
// podré editar, eliminar jugadas").
//
// Cubre las rutas nuevas de routes/hipismo.js:
//   - GET /revisar-jugadas : junta planos+tickets, adelantadas (tf/marca),
//     tercios adelantadas (con y sin carrera), remates (pool y manual) con
//     sus apuestas, y winners — SOLO los de ese día/hipódromo/carrera.
//   - DELETE /planos/:id/tickets/:ticketId : borra un ticket suelto y
//     recalcula la comisión del plano; si era el último, manda el plano
//     entero a la papelera.
//   - PUT/DELETE /remates/:id/apuestas/:apuestaId : editar/borrar una
//     apuesta de un remate MANUAL (espejo = -suma de netos) o de POOL
//     (se recalcula con calcularRemate); si se borra la última apuesta,
//     se borra el remate.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-revisar-1';
const DIA = '2026-10-04';
const HIPO = 'La Rinconada';

const TABLAS = {
  jugadores: [
    { id: 'j-lusho', grupo_id: GRUPO_ID, nombre: 'LUSHO', comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false },
    { id: 'j-carla', grupo_id: GRUPO_ID, nombre: 'CARLA', comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false },
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false }
  ],
  hipismo_hipodromos: [{ id: 'hip-1', grupo_id: GRUPO_ID, nombre: HIPO }],
  hipismo_planos: [],
  hipismo_tickets: [],
  hipismo_planos_papelera: [],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_tercios_adelantadas_planos: [],
  hipismo_tercios_adelantadas_jugadas: [],
  hipismo_remates: [],
  hipismo_remate_apuestas: [],
  hipismo_winners: [],
  hipismo_alertas: []
};
let seq = 1;
const nuevoId = (prefijo) => prefijo + (seq++);

const mismoHipo = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // autoRegistrarJugadores / asegurarCuentasComisionParaNombres
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    if (!TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      TABLAS.jugadores.push({ id: nuevoId('j'), grupo_id: grupoId, nombre, comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false });
    }
    return { rows: [] };
  }
  if (/^SELECT id, nombre, comision_propia, cuenta_comision_id.*FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return { rows: filas.map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cuenta_comision_id: j.cuenta_comision_id || null, incluir_porcentaje_en_jugadas: !!j.incluir_porcentaje_en_jugadas })) };
  }

  // ---------- GET /revisar-jugadas ----------
  if (/^SELECT nombre FROM hipismo_hipodromos WHERE id = \$1 AND grupo_id = \$2/i.test(sql)) {
    const h = TABLAS.hipismo_hipodromos.find(x => x.id === params[0] && x.grupo_id === params[1]);
    return { rows: h ? [{ nombre: h.nombre }] : [] };
  }
  if (/^SELECT \* FROM hipismo_planos WHERE grupo_id = \$1 AND fecha = \$2 AND lower\(hipodromo_nombre\) = lower\(\$3\) AND carrera_numero = \$4/i.test(sql)) {
    const [g, f, h, c] = params;
    return { rows: TABLAS.hipismo_planos.filter(p => p.grupo_id === g && p.fecha === f && mismoHipo(p.hipodromo_nombre, h) && p.carrera_numero === c) };
  }
  if (/^SELECT \* FROM hipismo_tickets WHERE plano_id = ANY\(\$1\) ORDER BY creado_en/i.test(sql)) {
    return { rows: TABLAS.hipismo_tickets.filter(t => params[0].includes(t.plano_id)) };
  }
  if (/^SELECT j\.\*, p\.hipodromo_nombre, p\.fecha FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p/i.test(sql)) {
    const [g, f, h, c] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas.filter(j => {
      const p = TABLAS.hipismo_adelantadas_planos.find(x => x.id === j.plano_id);
      return j.grupo_id === g && p && p.fecha === f && mismoHipo(p.hipodromo_nombre, h) && j.carrera_numero === c;
    }).map(j => {
      const p = TABLAS.hipismo_adelantadas_planos.find(x => x.id === j.plano_id);
      return { ...j, hipodromo_nombre: p.hipodromo_nombre, fecha: p.fecha };
    });
    return { rows: filas };
  }
  if (/^SELECT j\.\*, p\.hipodromo_nombre, p\.fecha FROM hipismo_tercios_adelantadas_jugadas j JOIN hipismo_tercios_adelantadas_planos p/i.test(sql)) {
    const sinCarrera = /j\.carrera_numero IS NULL/i.test(sql);
    const [g, f, h, c] = params;
    const filas = TABLAS.hipismo_tercios_adelantadas_jugadas.filter(j => {
      const p = TABLAS.hipismo_tercios_adelantadas_planos.find(x => x.id === j.plano_id);
      if (!(j.grupo_id === g && p && p.fecha === f && mismoHipo(p.hipodromo_nombre, h))) return false;
      return sinCarrera ? j.carrera_numero == null : j.carrera_numero === c;
    }).map(j => {
      const p = TABLAS.hipismo_tercios_adelantadas_planos.find(x => x.id === j.plano_id);
      return { ...j, hipodromo_nombre: p.hipodromo_nombre, fecha: p.fecha };
    });
    return { rows: filas };
  }
  if (/^SELECT \* FROM hipismo_remates WHERE grupo_id = \$1 AND fecha = \$2 AND lower\(hipodromo_nombre\) = lower\(\$3\) AND carrera_numero = \$4/i.test(sql)) {
    const [g, f, h, c] = params;
    return { rows: TABLAS.hipismo_remates.filter(r => r.grupo_id === g && r.fecha === f && mismoHipo(r.hipodromo_nombre, h) && r.carrera_numero === c) };
  }
  if (/^SELECT \* FROM hipismo_remate_apuestas WHERE remate_id = ANY\(\$1\)/i.test(sql)) {
    return { rows: TABLAS.hipismo_remate_apuestas.filter(a => params[0].includes(a.remate_id)) };
  }
  if (/^SELECT \* FROM hipismo_winners WHERE grupo_id = \$1 AND fecha = \$2 AND lower\(hipodromo_nombre\) = lower\(\$3\) AND carrera_numero = \$4/i.test(sql)) {
    const [g, f, h, c] = params;
    return { rows: TABLAS.hipismo_winners.filter(w => w.grupo_id === g && w.fecha === f && mismoHipo(w.hipodromo_nombre, h) && w.carrera_numero === c) };
  }

  // ---------- DELETE /planos/:id/tickets/:ticketId (+ eliminarPlano) ----------
  if (/^SELECT \* FROM hipismo_planos WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const p = TABLAS.hipismo_planos.find(x => x.id === params[0] && x.grupo_id === params[1]);
    return { rows: p ? [p] : [] };
  }
  if (/^SELECT \* FROM hipismo_tickets WHERE id = \$1 AND plano_id = \$2$/i.test(sql)) {
    const t = TABLAS.hipismo_tickets.find(x => x.id === params[0] && x.plano_id === params[1]);
    return { rows: t ? [t] : [] };
  }
  if (/^SELECT COUNT\(\*\)::int AS n FROM hipismo_tickets WHERE plano_id = \$1$/i.test(sql)) {
    return { rows: [{ n: TABLAS.hipismo_tickets.filter(t => t.plano_id === params[0]).length }] };
  }
  if (/^DELETE FROM hipismo_tickets WHERE id = \$1 AND plano_id = \$2$/i.test(sql)) {
    TABLAS.hipismo_tickets = TABLAS.hipismo_tickets.filter(t => !(t.id === params[0] && t.plano_id === params[1]));
    return { rows: [] };
  }
  if (/^SELECT \* FROM hipismo_tickets WHERE plano_id = \$1 ORDER BY creado_en$/i.test(sql)) {
    return { rows: TABLAS.hipismo_tickets.filter(t => t.plano_id === params[0]) };
  }
  if (/^SELECT \* FROM hipismo_tickets WHERE plano_id = \$1$/i.test(sql)) {
    return { rows: TABLAS.hipismo_tickets.filter(t => t.plano_id === params[0]) };
  }
  if (/^UPDATE hipismo_planos SET comision_total = \$1, texto_resultado = \$2 WHERE id = \$3$/i.test(sql)) {
    const p = TABLAS.hipismo_planos.find(x => x.id === params[2]);
    p.comision_total = params[0]; p.texto_resultado = params[1];
    return { rows: [] };
  }
  if (/^INSERT INTO hipismo_planos_papelera/i.test(sql)) {
    const fila = { id: nuevoId('pap'), grupo_id: params[0], plano_json: params[4], tickets_json: params[5] };
    TABLAS.hipismo_planos_papelera.push(fila);
    return { rows: [{ id: fila.id }] };
  }
  if (/^DELETE FROM hipismo_planos WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    TABLAS.hipismo_planos = TABLAS.hipismo_planos.filter(p => !(p.id === params[0] && p.grupo_id === params[1]));
    TABLAS.hipismo_tickets = TABLAS.hipismo_tickets.filter(t => t.plano_id !== params[0]);
    return { rows: [] };
  }

  // ---------- PUT/DELETE /remates/:id/apuestas/:apuestaId ----------
  if (/^SELECT \* FROM hipismo_remates WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const r = TABLAS.hipismo_remates.find(x => x.id === params[0] && x.grupo_id === params[1]);
    return { rows: r ? [r] : [] };
  }
  if (/^SELECT \* FROM hipismo_remate_apuestas WHERE id = \$1 AND remate_id = \$2$/i.test(sql)) {
    const a = TABLAS.hipismo_remate_apuestas.find(x => x.id === params[0] && x.remate_id === params[1]);
    return { rows: a ? [a] : [] };
  }
  if (/^SELECT \* FROM hipismo_remate_apuestas WHERE remate_id = \$1 ORDER BY creado_en$/i.test(sql)) {
    return { rows: TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === params[0]) };
  }
  if (/^SELECT \* FROM hipismo_remate_apuestas WHERE remate_id = \$1 ORDER BY numero_ejemplar$/i.test(sql)) {
    return { rows: TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === params[0]).sort((a, b) => a.numero_ejemplar - b.numero_ejemplar) };
  }
  if (/^SELECT COUNT\(\*\)::int AS n FROM hipismo_remate_apuestas WHERE remate_id = \$1$/i.test(sql)) {
    return { rows: [{ n: TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === params[0]).length }] };
  }
  if (/^UPDATE hipismo_remate_apuestas SET cliente_nombre = \$1, numero_ejemplar = \$2, caballo = \$3, monto = \$4, resultado = \$5 WHERE id = \$6 AND remate_id = \$7$/i.test(sql)) {
    const a = TABLAS.hipismo_remate_apuestas.find(x => x.id === params[5] && x.remate_id === params[6]);
    a.cliente_nombre = params[0]; a.numero_ejemplar = params[1]; a.caballo = params[2]; a.monto = params[3]; a.resultado = params[4];
    return { rows: [] };
  }
  if (/^DELETE FROM hipismo_remate_apuestas WHERE id = \$1 AND remate_id = \$2$/i.test(sql)) {
    TABLAS.hipismo_remate_apuestas = TABLAS.hipismo_remate_apuestas.filter(a => !(a.id === params[0] && a.remate_id === params[1]));
    return { rows: [] };
  }
  if (/^UPDATE hipismo_remate_apuestas SET resultado = \$1 WHERE id = \$2$/i.test(sql)) {
    const a = TABLAS.hipismo_remate_apuestas.find(x => x.id === params[1]);
    a.resultado = params[0];
    return { rows: [] };
  }
  if (/^UPDATE hipismo_remates SET comision_total = \$1, texto_resultado = \$2, texto_original = \$3 WHERE id = \$4$/i.test(sql)) {
    const r = TABLAS.hipismo_remates.find(x => x.id === params[3]);
    r.comision_total = params[0]; r.texto_resultado = params[1]; r.texto_original = params[2];
    return { rows: [] };
  }
  if (/^UPDATE hipismo_remates SET pool_total = \$1 WHERE id = \$2$/i.test(sql)) {
    const r = TABLAS.hipismo_remates.find(x => x.id === params[1]);
    r.pool_total = params[0];
    return { rows: [] };
  }
  if (/^UPDATE hipismo_remates SET pool_total = \$1, hubo_ganador = \$2, caballo_ganador = \$3, cliente_ganador = \$4, pago_ganador = \$5, comision_total = \$6, texto_resultado = \$7 WHERE id = \$8$/i.test(sql)) {
    const r = TABLAS.hipismo_remates.find(x => x.id === params[7]);
    r.pool_total = params[0]; r.hubo_ganador = params[1]; r.caballo_ganador = params[2]; r.cliente_ganador = params[3];
    r.pago_ganador = params[4]; r.comision_total = params[5]; r.texto_resultado = params[6];
    return { rows: [] };
  }
  if (/^DELETE FROM hipismo_remates WHERE id = \$1$/i.test(sql)) {
    TABLAS.hipismo_remates = TABLAS.hipismo_remates.filter(r => r.id !== params[0]);
    TABLAS.hipismo_remate_apuestas = TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id !== params[0]);
    return { rows: [] };
  }

  if (/^INSERT INTO hipismo_alertas/i.test(sql)) {
    TABLAS.hipismo_alertas.push({ tipo: params[1], hipodromoNombre: params[3], carreraNumero: params[4], mensaje: params[6] });
    return { rows: [] };
  }

  throw new Error('La base de datos falsa de esta prueba (revisar jugadas) no sabe responder: ' + sql);
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
const { calcularRemate } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoRemateCalc'));
const { recalcularTotalesPlano } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));

Module._load = originalLoad;

function handlerDe(metodo, rutaPath) {
  const entrada = hipismoRouter.__handlers.find(([m, args]) => m === metodo && args[0] === rutaPath);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo.toUpperCase() + ' ' + rutaPath);
  return entrada[1][entrada[1].length - 1];
}
const handlerRevisar = handlerDe('get', '/revisar-jugadas');
const handlerBorrarTicket = handlerDe('delete', '/planos/:id/tickets/:ticketId');
const handlerEditarApuesta = handlerDe('put', '/remates/:id/apuestas/:apuestaId');
const handlerBorrarApuesta = handlerDe('delete', '/remates/:id/apuestas/:apuestaId');

function invocarRuta(handler, req, params) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    handler(Object.assign({ params: params || {} }, req), res, (err) => { if (err) reject(err); });
  });
}
function reqBase(query, body) {
  return { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Admin', query: query || {}, body: body || {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// ---------------- Datos de la carrera 5 (la que se revisa) ----------------
function ticketFila(id, planoId, cliente, banquero, monto, resJ, resB) {
  return { id, plano_id: planoId, grupo_id: GRUPO_ID, cliente_nombre: cliente, banquero_nombre: banquero, modalidad: '1p', caballo: '3', monto, resultado_jugador: resJ, resultado_banquero: resB, sin_comision: false, creado_en: seq++ };
}
function sembrar() {
  TABLAS.hipismo_planos.push(
    { id: 'plano-5', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 5, fecha: DIA, ret: null, pizarra: '3.7.1', cruza_jugadas: false, texto_original: 'x', texto_resultado: 'texto viejo', comision_total: 9.5, creado_en: 1 },
    // Otra carrera del mismo día/hipódromo -> NO debe aparecer
    { id: 'plano-6', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 6, fecha: DIA, ret: null, pizarra: '1.2.3', cruza_jugadas: false, texto_original: 'x', texto_resultado: 't', comision_total: 1, creado_en: 2 },
    // Otro día, misma carrera -> NO debe aparecer
    { id: 'plano-otro-dia', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 5, fecha: '2026-10-03', ret: null, pizarra: '1.2.3', cruza_jugadas: false, texto_original: 'x', texto_resultado: 't', comision_total: 1, creado_en: 3 },
    // Otro hipódromo, misma carrera y día -> NO debe aparecer
    { id: 'plano-otro-hipo', grupo_id: GRUPO_ID, hipodromo_nombre: 'Gulfstream', carrera_numero: 5, fecha: DIA, ret: null, pizarra: '1.2.3', cruza_jugadas: false, texto_original: 'x', texto_resultado: 't', comision_total: 1, creado_en: 4 }
  );
  TABLAS.hipismo_tickets.push(
    ticketFila('tk-1', 'plano-5', 'LUSHO', 'CARLA', 100, 95, -100),
    ticketFila('tk-2', 'plano-5', 'PEDRO', 'CARLA', 50, 47.5, -50),
    ticketFila('tk-ajeno', 'plano-6', 'PEDRO', 'CARLA', 10, 9.5, -10)
  );

  TABLAS.hipismo_adelantadas_planos.push({ id: 'ad-plano-1', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, fecha: DIA });
  TABLAS.hipismo_adelantadas_jugadas.push(
    { id: 'ad-tf', plano_id: 'ad-plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'LUSHO', carrera_numero: 5, tipo: 'tf', cantidad_tf: 5, numero_ejemplar: 4, precio_por_tf: 10, ganancia_potencial: 200, monto: 50, comision_porcentaje: 2.5, texto_original: '5) 5TF', estado: 'pendiente', creado_en: 1 },
    { id: 'ad-marca', plano_id: 'ad-plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'CARLA', carrera_numero: 5, tipo: 'marca', numero1: 2, numero2: 6, monto: 30, comision_porcentaje: 2.5, texto_original: '5) 2x6 30$', estado: 'pendiente', creado_en: 2 },
    { id: 'ad-otra-carrera', plano_id: 'ad-plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', carrera_numero: 8, tipo: 'tf', cantidad_tf: 1, numero_ejemplar: 1, monto: 5, comision_porcentaje: 2.5, texto_original: 'x', estado: 'pendiente', creado_en: 3 }
  );

  TABLAS.hipismo_tercios_adelantadas_planos.push({ id: 'ter-plano-1', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, fecha: DIA });
  TABLAS.hipismo_tercios_adelantadas_jugadas.push(
    { id: 'ter-1', plano_id: 'ter-plano-1', grupo_id: GRUPO_ID, jugador_nombre: 'LUSHO', banquero_nombre: 'CARLA', carrera_numero: 5, es_cruce: false, grupo_caballos: [3], modalidad: '1p', monto: 40, comision_porcentaje: 5, texto_original: 'x', falta_monto: false, falta_jugador: false, falta_banquero: false, estado: 'pendiente', creado_en: 1 },
    { id: 'ter-sin-carrera', plano_id: 'ter-plano-1', grupo_id: GRUPO_ID, jugador_nombre: 'PEDRO', banquero_nombre: '', carrera_numero: null, es_cruce: false, grupo_caballos: [1], modalidad: null, monto: null, comision_porcentaje: 5, texto_original: 'x', falta_monto: true, falta_jugador: false, falta_banquero: true, estado: 'pendiente', creado_en: 2 },
    { id: 'ter-otra-carrera', plano_id: 'ter-plano-1', grupo_id: GRUPO_ID, jugador_nombre: 'PEDRO', banquero_nombre: 'CARLA', carrera_numero: 9, es_cruce: false, grupo_caballos: [2], modalidad: '1p', monto: 10, comision_porcentaje: 5, texto_original: 'x', falta_monto: false, falta_jugador: false, falta_banquero: false, estado: 'pendiente', creado_en: 3 }
  );

  // Remate de POOL con llegada (3.7.1 -> gana el 3): pool 100 + 60 = 160
  TABLAS.hipismo_remates.push(
    { id: 'rem-pool', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 5, fecha: DIA, modo: 'pool', comision_porcentaje: 10, garantia: null, pago_fijo: null, pool_total: 160, pizarra: '3.7.1', numero_ganador: 3, hubo_ganador: true, caballo_ganador: 'EJEMPLAR 3', cliente_ganador: 'LUSHO', pago_ganador: 144, comision_total: 16, texto_resultado: 't', texto_original: 't', creado_en: 1 },
    { id: 'rem-manual', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 5, fecha: DIA, modo: 'manual', comision_porcentaje: 0, garantia: null, pago_fijo: null, pool_total: 0, pizarra: null, numero_ganador: null, hubo_ganador: false, pago_ganador: 0, comision_total: -280, texto_resultado: 't', texto_original: 't', creado_en: 2 },
    // Remate de otra carrera -> NO debe aparecer
    { id: 'rem-otra', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 7, fecha: DIA, modo: 'manual', comision_porcentaje: 0, pool_total: 0, pizarra: null, numero_ganador: null, hubo_ganador: false, pago_ganador: 0, comision_total: 10, texto_resultado: 't', texto_original: 't', creado_en: 3 }
  );
  TABLAS.hipismo_remate_apuestas.push(
    { id: 'ap-pool-1', remate_id: 'rem-pool', grupo_id: GRUPO_ID, numero_ejemplar: 3, caballo: 'EJEMPLAR 3', cliente_nombre: 'LUSHO', monto: 100, resultado: 44, creado_en: 1 },
    { id: 'ap-pool-2', remate_id: 'rem-pool', grupo_id: GRUPO_ID, numero_ejemplar: 7, caballo: 'EJEMPLAR 7', cliente_nombre: 'CARLA', monto: 60, resultado: -60, creado_en: 2 },
    { id: 'ap-man-1', remate_id: 'rem-manual', grupo_id: GRUPO_ID, numero_ejemplar: 7, caballo: 'EJEMPLAR 7', cliente_nombre: 'LUSHO', monto: 400, resultado: 400, creado_en: 3 },
    { id: 'ap-man-2', remate_id: 'rem-manual', grupo_id: GRUPO_ID, numero_ejemplar: 3, caballo: 'EJEMPLAR 3', cliente_nombre: 'CARLA', monto: -120, resultado: -120, creado_en: 4 },
    { id: 'ap-otra', remate_id: 'rem-otra', grupo_id: GRUPO_ID, numero_ejemplar: 1, caballo: 'EJEMPLAR 1', cliente_nombre: 'PEDRO', monto: -10, resultado: -10, creado_en: 5 }
  );

  TABLAS.hipismo_winners.push(
    { id: 'win-1', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 5, fecha: DIA, cliente_nombre: 'PEDRO', caballo: '3', monto: 75, creado_en: 1 },
    { id: 'win-2', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 5, fecha: DIA, cliente_nombre: 'CARLA', caballo: '3', monto: -75, creado_en: 2 },
    { id: 'win-otra', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 6, fecha: DIA, cliente_nombre: 'PEDRO', caballo: '1', monto: 20, creado_en: 3 }
  );
}

(async function main() {
  sembrar();

  // ===================== GET /revisar-jugadas =====================
  const e1 = await invocarRuta(handlerRevisar, reqBase({ hipodromo: HIPO, carrera: '5' }));
  check(e1._status === 400, '1a) Sin día -> 400');
  const e2 = await invocarRuta(handlerRevisar, reqBase({ fecha: DIA, hipodromo: HIPO }));
  check(e2._status === 400, '1b) Sin carrera -> 400');
  const e3 = await invocarRuta(handlerRevisar, reqBase({ fecha: DIA, carrera: '5' }));
  check(e3._status === 400, '1c) Sin hipódromo -> 400');
  const e3b = await invocarRuta(handlerRevisar, reqBase({ fecha: DIA, hipodromoId: 'no-existe', carrera: '5' }));
  check(e3b._status === 400, '1d) Hipódromo (id) que no existe -> 400');

  // Mayúsculas distintas a propósito: el nombre se compara sin importar mayúsculas.
  const r = await invocarRuta(handlerRevisar, reqBase({ fecha: DIA, hipodromo: 'LA RINCONADA', carrera: '5' }));
  check(r._status === 200, '2) GET /revisar-jugadas responde 200 (nombre de hipódromo en otras mayúsculas)');
  const d = r._json;

  check(d.planos.length === 1 && d.planos[0].id === 'plano-5', '2a) Trae SOLO el plano de esa carrera/día/hipódromo (no los de otra carrera, otro día ni otro hipódromo)');
  check(d.planos[0].tickets.length === 2 && d.planos[0].tickets.every(t => t.id !== 'tk-ajeno'), '2a) Con sus 2 tickets (sin el ticket de otro plano)');
  check(d.planos[0].tickets[0].cliente === 'LUSHO' && d.planos[0].tickets[0].banquero === 'CARLA' && d.planos[0].tickets[0].monto === 100, '2a) El ticket trae cliente, banquero y monto');

  check(d.adelantadas.length === 2 && d.adelantadas.some(j => j.tipo === 'tf') && d.adelantadas.some(j => j.tipo === 'marca'), '2b) Trae las 2 jugadas adelantadas de la carrera (1 Tabla Fija y 1 Marca), sin la de la carrera 8');
  check(!d.adelantadas.some(j => j.id === 'ad-otra-carrera'), '2b) La adelantada de otra carrera NO aparece');

  check(d.tercios.length === 1 && d.tercios[0].id === 'ter-1', '2c) Trae la jugada entre Tercios Adelantadas de la carrera 5 (sin la de la carrera 9)');
  check(d.terciosSinCarrera.length === 1 && d.terciosSinCarrera[0].id === 'ter-sin-carrera', '2c) La de Tercios Adelantadas SIN número de carrera de ese día/hipódromo aparece aparte (nada queda afuera)');

  check(d.remates.length === 2, '2d) Trae los 2 remates de la carrera (pool y manual), sin el de la carrera 7');
  const rPool = d.remates.find(x => x.modo === 'pool');
  const rMan = d.remates.find(x => x.modo === 'manual');
  check(!!rPool && rPool.apuestas.length === 2 && rPool.pizarra === '3.7.1' && rPool.poolTotal === 160, '2d) El remate de pool trae sus 2 apuestas, la pizarra y el pool');
  check(!!rMan && rMan.apuestas.length === 2 && rMan.resultadoRemate === -280, '2d) El Remate Manual trae sus 2 líneas y su resultado (-280)');

  check(d.winners.length === 2 && d.winners.every(w => w.id !== 'win-otra'), '2e) Trae los 2 winners de la carrera (sin el de la carrera 6)');

  const rPorId = await invocarRuta(handlerRevisar, reqBase({ fecha: DIA, hipodromoId: 'hip-1', carrera: '5' }));
  check(rPorId._status === 200 && rPorId._json.planos.length === 1, '2f) También funciona eligiendo el hipódromo por id');

  const rVacia = await invocarRuta(handlerRevisar, reqBase({ fecha: DIA, hipodromo: HIPO, carrera: '20' }));
  check(rVacia._status === 200 && rVacia._json.planos.length === 0 && rVacia._json.remates.length === 0 && rVacia._json.winners.length === 0 && rVacia._json.adelantadas.length === 0 && rVacia._json.tercios.length === 0, '2g) Una carrera sin nada cargado devuelve todo vacío (no falla)');

  // ===================== DELETE /planos/:id/tickets/:ticketId =====================
  const t1 = await invocarRuta(handlerBorrarTicket, reqBase({}), { id: 'plano-5', ticketId: 'tk-ajeno' });
  check(t1._status === 404, '3a) Borrar un ticket que pertenece a OTRO plano -> 404');
  check(TABLAS.hipismo_tickets.some(t => t.id === 'tk-ajeno'), '3a) El ticket ajeno sigue existiendo');

  const t2 = await invocarRuta(handlerBorrarTicket, reqBase({}), { id: 'plano-5', ticketId: 'tk-1' });
  check(t2._status === 200 && t2._json.ok === true && t2._json.planoEliminado === false, '3b) Borrar un ticket suelto responde ok y el plano sigue');
  check(!TABLAS.hipismo_tickets.some(t => t.id === 'tk-1') && TABLAS.hipismo_tickets.some(t => t.id === 'tk-2'), '3b) Solo se borró ese ticket (el otro del plano sigue)');
  const quedan = TABLAS.hipismo_tickets.filter(t => t.plano_id === 'plano-5').map(t => ({
    clienteNombre: t.cliente_nombre, banqueroNombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo,
    monto: Number(t.monto), resultadoJugador: Number(t.resultado_jugador), resultadoBanquero: Number(t.resultado_banquero), sinComision: !!t.sin_comision
  }));
  const esperado = recalcularTotalesPlano(quedan, false).comisionTotal;
  const planoDespues = TABLAS.hipismo_planos.find(p => p.id === 'plano-5');
  check(planoDespues.comision_total === esperado && esperado !== 9.5, `3b) La comisión del plano se recalculó con los tickets que quedan (${esperado}), dio ${planoDespues.comision_total}`);
  check(planoDespues.texto_resultado !== 'texto viejo', '3b) El texto para WhatsApp del plano se regeneró');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PLANO_EDITADO'), '3b) Se registró la alerta PLANO_EDITADO');

  const t3 = await invocarRuta(handlerBorrarTicket, reqBase({}), { id: 'plano-5', ticketId: 'tk-2' });
  check(t3._status === 200 && t3._json.planoEliminado === true, '3c) Borrar el ÚLTIMO ticket elimina el plano completo (planoEliminado: true)');
  check(!TABLAS.hipismo_planos.some(p => p.id === 'plano-5'), '3c) El plano ya no existe');
  check(TABLAS.hipismo_planos_papelera.length === 1, '3c) El plano quedó en la papelera recuperable');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PLANO_ELIMINADO'), '3c) Se registró la alerta PLANO_ELIMINADO');

  // ===================== PUT /remates/:id/apuestas/:apuestaId — MANUAL =====================
  const m1 = await invocarRuta(handlerEditarApuesta, reqBase({}, { monto: '0' }), { id: 'rem-manual', apuestaId: 'ap-man-1' });
  check(m1._status === 400, '4a) Remate Manual: monto neto 0 -> 400');
  const m2 = await invocarRuta(handlerEditarApuesta, reqBase({}, { numeroEjemplar: '0' }), { id: 'rem-manual', apuestaId: 'ap-man-1' });
  check(m2._status === 400, '4b) Remate Manual: ejemplar 0 -> 400');
  const m3 = await invocarRuta(handlerEditarApuesta, reqBase({}, { monto: '100' }), { id: 'rem-manual', apuestaId: 'ap-pool-1' });
  check(m3._status === 404, '4c) Apuesta que pertenece a OTRO remate -> 404');
  const m4 = await invocarRuta(handlerEditarApuesta, reqBase({}, { monto: '100' }), { id: 'no-existe', apuestaId: 'ap-man-1' });
  check(m4._status === 404, '4d) Remate que no existe -> 404');

  const m5 = await invocarRuta(handlerEditarApuesta, reqBase({}, { monto: '150', numeroEjemplar: '9' }), { id: 'rem-manual', apuestaId: 'ap-man-1' });
  check(m5._status === 200, '4e) Editar una línea del Remate Manual responde 200');
  const manualDespues = TABLAS.hipismo_remates.find(x => x.id === 'rem-manual');
  check(manualDespues.comision_total === -30, `4e) El REMATE (espejo) se recalcula: -(150 + -120) = -30, dio ${manualDespues.comision_total}`);
  const apMan1 = TABLAS.hipismo_remate_apuestas.find(a => a.id === 'ap-man-1');
  check(apMan1.monto === 150 && apMan1.resultado === 150 && apMan1.numero_ejemplar === 9 && apMan1.caballo === 'EJEMPLAR 9', '4e) La línea guarda monto=resultado=150, ejemplar 9 y su etiqueta "EJEMPLAR 9"');
  check(/lusho/i.test(manualDespues.texto_resultado) && /9/.test(manualDespues.texto_resultado), '4e) El texto para WhatsApp se regeneró con el valor nuevo');

  const m6 = await invocarRuta(handlerEditarApuesta, reqBase({}, { cliente: 'nuevo cliente', monto: '-500' }), { id: 'rem-manual', apuestaId: 'ap-man-2' });
  check(m6._status === 200, '4f) Cambiar jugador y poner un neto NEGATIVO (-500) en un Remate Manual responde 200');
  check(TABLAS.hipismo_remates.find(x => x.id === 'rem-manual').comision_total === -(150 + -500), '4f) El espejo queda en +350 (sobra dinero, lo gana la banca)');
  check(TABLAS.hipismo_remate_apuestas.find(a => a.id === 'ap-man-2').cliente_nombre === 'NUEVO CLIENTE', '4f) El nombre se normaliza a MAYÚSCULAS');
  check(TABLAS.jugadores.some(j => j.nombre === 'NUEVO CLIENTE'), '4f) El cliente nuevo se da de alta en jugadores');

  // ===================== DELETE /remates/:id/apuestas/:apuestaId — MANUAL =====================
  const b1 = await invocarRuta(handlerBorrarApuesta, reqBase({}), { id: 'rem-manual', apuestaId: 'ap-man-2' });
  check(b1._status === 200 && b1._json.ok === true && b1._json.remateEliminado === false, '5a) Borrar una línea del Remate Manual responde ok y el remate sigue');
  check(TABLAS.hipismo_remates.find(x => x.id === 'rem-manual').comision_total === -150, '5a) El espejo se recalcula con la línea que queda: -150');
  const b2 = await invocarRuta(handlerBorrarApuesta, reqBase({}), { id: 'rem-manual', apuestaId: 'ap-man-1' });
  check(b2._status === 200 && b2._json.remateEliminado === true, '5b) Borrar la ÚLTIMA línea borra el Remate Manual completo (remateEliminado: true)');
  check(!TABLAS.hipismo_remates.some(x => x.id === 'rem-manual'), '5b) El remate manual ya no existe');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'REMATE_MANUAL_ELIMINADO'), '5b) Se registró la alerta REMATE_MANUAL_ELIMINADO');

  // ===================== PUT /remates/:id/apuestas/:apuestaId — POOL =====================
  const p1 = await invocarRuta(handlerEditarApuesta, reqBase({}, { monto: '-5' }), { id: 'rem-pool', apuestaId: 'ap-pool-1' });
  check(p1._status === 400, '6a) Remate de pool: monto negativo -> 400 (en pool el monto es lo apostado)');

  const p2 = await invocarRuta(handlerEditarApuesta, reqBase({}, { monto: '200' }), { id: 'rem-pool', apuestaId: 'ap-pool-1' });
  check(p2._status === 200, '6b) Editar el monto de una apuesta de un remate de pool responde 200');
  const esperadoPool = calcularRemate({
    apuestas: [
      { numeroEjemplar: 3, caballo: 'EJEMPLAR 3', cliente: 'LUSHO', monto: 200 },
      { numeroEjemplar: 7, caballo: 'EJEMPLAR 7', cliente: 'CARLA', monto: 60 }
    ],
    garantia: null, pagoFijo: null, comisionPorcentaje: 10, numeroGanador: 3
  });
  const poolDespues = TABLAS.hipismo_remates.find(x => x.id === 'rem-pool');
  check(poolDespues.pool_total === 260 && poolDespues.pool_total === esperadoPool.poolTotal, `6b) pool_total se recalcula a 260, dio ${poolDespues.pool_total}`);
  check(poolDespues.pago_ganador === esperadoPool.pagoGanador && poolDespues.comision_total === esperadoPool.resultadoRemate, `6b) pago al ganador (${esperadoPool.pagoGanador}) y resultado del remate (${esperadoPool.resultadoRemate}) coinciden con calcularRemate`);
  const apGanadora = TABLAS.hipismo_remate_apuestas.find(a => a.id === 'ap-pool-1');
  const apPerdedora = TABLAS.hipismo_remate_apuestas.find(a => a.id === 'ap-pool-2');
  check(apGanadora.resultado === esperadoPool.pagoGanador - 200, `6b) La apuesta ganadora recalcula su resultado (${esperadoPool.pagoGanador - 200}), dio ${apGanadora.resultado}`);
  check(apPerdedora.resultado === -60, '6b) La apuesta perdedora sigue en -60');
  check(poolDespues.pizarra === '3.7.1', '6b) La pizarra NO se toca');

  // Remate de pool con la llegada vaciada (pendiente): solo se ajusta el pool.
  TABLAS.hipismo_remates.push({ id: 'rem-pend', grupo_id: GRUPO_ID, hipodromo_nombre: HIPO, carrera_numero: 11, fecha: DIA, modo: 'pool', comision_porcentaje: 10, garantia: null, pago_fijo: null, pool_total: 100, pizarra: null, numero_ganador: null, hubo_ganador: false, pago_ganador: 0, comision_total: 0, texto_resultado: 'pendiente', texto_original: 't', creado_en: 9 });
  TABLAS.hipismo_remate_apuestas.push(
    { id: 'ap-pend-1', remate_id: 'rem-pend', grupo_id: GRUPO_ID, numero_ejemplar: 2, caballo: 'EJEMPLAR 2', cliente_nombre: 'PEDRO', monto: 100, resultado: 0, creado_en: 9 }
  );
  const p3 = await invocarRuta(handlerEditarApuesta, reqBase({}, { monto: '120' }), { id: 'rem-pend', apuestaId: 'ap-pend-1' });
  check(p3._status === 200, '6c) Editar una apuesta de un remate pendiente de llegada responde 200');
  const pend = TABLAS.hipismo_remates.find(x => x.id === 'rem-pend');
  check(pend.pool_total === 120 && pend.pizarra === null && pend.comision_total === 0 && pend.texto_resultado === 'pendiente', '6c) Solo cambia el pool_total (120); sigue pendiente de llegada, sin resultado ni texto nuevo');

  // ===================== DELETE /remates/:id/apuestas/:apuestaId — POOL =====================
  const q1 = await invocarRuta(handlerBorrarApuesta, reqBase({}), { id: 'rem-pool', apuestaId: 'ap-pool-2' });
  check(q1._status === 200 && q1._json.remateEliminado === false, '7a) Borrar una apuesta de un remate de pool responde ok y el remate sigue');
  const esperadoPool2 = calcularRemate({
    apuestas: [{ numeroEjemplar: 3, caballo: 'EJEMPLAR 3', cliente: 'LUSHO', monto: 200 }],
    garantia: null, pagoFijo: null, comisionPorcentaje: 10, numeroGanador: 3
  });
  const poolDespues2 = TABLAS.hipismo_remates.find(x => x.id === 'rem-pool');
  check(poolDespues2.pool_total === 200 && poolDespues2.comision_total === esperadoPool2.resultadoRemate, `7a) El remate se recalcula con la apuesta que queda (pool 200, resultado ${esperadoPool2.resultadoRemate}), dio pool ${poolDespues2.pool_total} / resultado ${poolDespues2.comision_total}`);
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PIZARRA_EDITADA'), '7a) Se registró una alerta de edición del remate');
  const q2 = await invocarRuta(handlerBorrarApuesta, reqBase({}), { id: 'rem-pool', apuestaId: 'ap-pool-1' });
  check(q2._status === 200 && q2._json.remateEliminado === true && !TABLAS.hipismo_remates.some(x => x.id === 'rem-pool'), '7b) Borrar la última apuesta de un remate de pool borra el remate completo');

  // Las rutas viejas siguen intactas.
  check(typeof handlerDe('put', '/planos/:id/tickets/:ticketId') === 'function', '8) La ruta PUT de ticket que ya existía sigue registrada');
  check(typeof handlerDe('delete', '/planos/:id') === 'function', '8) La ruta DELETE /planos/:id (plano entero) sigue registrada');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  process.exit(fallaron === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR INESPERADO:', e); process.exit(1); });
