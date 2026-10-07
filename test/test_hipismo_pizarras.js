// =================================================================
// PRUEBA: pantalla "Pizarras" (01-10-2026, a pedido del usuario: "crea un
// boton debajo de hipodromos que diga pizarras / alli puedo ver, editar,
// eliminar... por dia por hipodromo ordenado, las llegadas de las
// carreras"). Cubre los 5 endpoints nuevos de routes/hipismo.js:
//   - GET /pizarras?desde=&hasta=
//   - PUT /pizarras/tercios/:id (recalcula TODO el plano con la pizarra nueva)
//   - DELETE /pizarras/tercios/:id (deja el plano "pendiente", NO lo borra)
//   - PUT /pizarras/remate/:id (recalcula TODAS las apuestas con la pizarra nueva)
//   - DELETE /pizarras/remate/:id (deja el remate "pendiente", NO lo borra)
//
// Casos cubiertos:
//   1. GET /pizarras: trae Tercios + Remates del rango, con "pendiente"
//      en false cuando ya tienen pizarra.
//   2. PUT /pizarras/tercios/:id: recalcula resultado_jugador/
//      resultado_banquero de TODOS los tickets del plano con la pizarra
//      corregida (el ganador cambia de caballo), actualiza
//      hipismo_planos.pizarra/comision_total/texto_resultado, y registra
//      una alerta PIZARRA_EDITADA.
//   3. DELETE /pizarras/tercios/:id: NO borra el plano (sigue existiendo)
//      — todos sus tickets quedan en 0/0 ("sin decidir"), pizarra = NULL,
//      texto de aviso "pendiente", alerta PIZARRA_ELIMINADA.
//   4. PUT /pizarras/remate/:id: recalcula el resultado de cada apuesta
//      con el nuevo numero_ganador (derivado del primer número de la
//      pizarra), actualiza cabecera del remate.
//   5. DELETE /pizarras/remate/:id: NO borra el remate — todas sus
//      apuestas quedan resultado=0, pizarra/numero_ganador = NULL.
//   6. obtenerApuestasDelRango (vía GET /montos-apostados) trata un
//      remate con numero_ganador=NULL como "sin decidir" (decidida:false,
//      gano:null), no como "PERDIÓ" — el ajuste que motivó esta prueba.
//   7. GET /pizarras: el montoTotal de Tercios ahora es la comisión NETA
//      (comision_total menos el % propio/aval devuelto generado por los
//      tickets de ESE plano), no la bruta — ver calcularDevueltoPorPlanoTercios
//      en routes/hipismo.js. Los endpoints nuevos de Jugadas Adelantadas
//      (PUT/DELETE /pizarras/adelantadas) y la fila tipo:'adelantadas' de
//      GET /pizarras tienen su PROPIA prueba, test_hipismo_pizarras_adelantadas.js.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-pizarras-1';

const TABLAS = {
  hipismo_planos: [],
  hipismo_tickets: [],
  hipismo_remates: [],
  hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_alertas: [],
  jugadores: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- GET /pizarras ----
  if (/^SELECT p\.id, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero, p\.pizarra, p\.comision_total, \(SELECT COUNT\(\*\)::int FROM hipismo_tickets t WHERE t\.plano_id = p\.id\) AS cantidad FROM hipismo_planos p WHERE p\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_planos
      .filter(p => p.grupo_id === grupoId && p.fecha >= desde && p.fecha <= hasta)
      .map(p => ({
        id: p.id, fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero,
        pizarra: p.pizarra, comision_total: p.comision_total,
        cantidad: TABLAS.hipismo_tickets.filter(t => t.plano_id === p.id).length
      }));
    return { rows: filas };
  }
  if (/^SELECT r\.id, r\.fecha, r\.hipodromo_nombre, r\.carrera_numero, r\.pizarra, r\.pool_total, \(SELECT COUNT\(\*\)::int FROM hipismo_remate_apuestas a WHERE a\.remate_id = r\.id\) AS cantidad FROM hipismo_remates r WHERE r\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remates
      .filter(r => r.grupo_id === grupoId && r.fecha >= desde && r.fecha <= hasta)
      .map(r => ({
        id: r.id, fecha: r.fecha, hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero,
        pizarra: r.pizarra, pool_total: r.pool_total,
        cantidad: TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === r.id).length
      }));
    return { rows: filas };
  }
  // ---- GET /pizarras: fila agregada tipo:'adelantadas' (01-10-2026) ----
  if (/^SELECT p\.fecha, p\.hipodromo_nombre, j\.carrera_numero, COUNT\(\*\)::int AS cantidad, COALESCE\(SUM\(j\.monto\), 0\) AS monto_total, bool_and\(j\.estado = 'pendiente'\) AS todas_pendientes/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const grupos = new Map();
    TABLAS.hipismo_adelantadas_jugadas.forEach(j => {
      if (j.grupo_id !== grupoId) return;
      const plano = TABLAS.hipismo_adelantadas_planos.find(p => p.id === j.plano_id);
      if (!plano || plano.fecha < desde || plano.fecha > hasta) return;
      const clave = `${plano.fecha}::${plano.hipodromo_nombre}::${j.carrera_numero}`;
      if (!grupos.has(clave)) grupos.set(clave, { fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre, carrera_numero: j.carrera_numero, jugadas: [] });
      grupos.get(clave).jugadas.push(j);
    });
    const filas = Array.from(grupos.values()).map(g => {
      const resueltas = g.jugadas.filter(j => j.resuelto_en != null).sort((a, b) => b.resuelto_en - a.resuelto_en);
      return {
        fecha: g.fecha, hipodromo_nombre: g.hipodromo_nombre, carrera_numero: g.carrera_numero,
        cantidad: g.jugadas.length,
        monto_total: g.jugadas.reduce((s, j) => s + Number(j.monto), 0),
        todas_pendientes: g.jugadas.every(j => j.estado === 'pendiente'),
        pizarra_usada: resueltas.length ? resueltas[0].pizarra_usada : null
      };
    });
    return { rows: filas };
  }
  // ---- calcularDevueltoPorPlanoTercios: tickets de TODOS los planos del rango ----
  if (/^SELECT plano_id, cliente_nombre, banquero_nombre, monto, resultado_jugador, resultado_banquero, sin_comision FROM hipismo_tickets WHERE plano_id = ANY\(\$1::uuid\[\]\)$/i.test(sql)) {
    const [planoIds] = params;
    return { rows: TABLAS.hipismo_tickets.filter(t => planoIds.includes(t.plano_id)) };
  }
  // ---- obtenerComisionesPropias: jugadores por nombre exacto, y el
  // rescate "todos los jugadores del grupo" cuando algún nombre no calzó.
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre, j\.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio\.id = j\.cuenta_comision_id WHERE j\.grupo_id = \$1 AND j\.nombre = ANY\(\$2::text\[\]\)$/i.test(sql)) {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: !!j.incluir_porcentaje_en_jugadas })) };
  }
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre, j\.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio\.id = j\.cuenta_comision_id WHERE j\.grupo_id = \$1$/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: !!j.incluir_porcentaje_en_jugadas })) };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    return { rows: [] };
  }

  // ---- hipismo_planos: lookup + update ----
  if (/^SELECT \* FROM hipismo_planos WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const plano = TABLAS.hipismo_planos.find(p => p.id === id && p.grupo_id === grupoId);
    return { rows: plano ? [plano] : [] };
  }
  if (/^UPDATE hipismo_planos SET pizarra = \$1, comision_total = \$2, texto_resultado = \$3 WHERE id = \$4$/i.test(sql)) {
    const [pizarra, comisionTotal, textoResultado, id] = params;
    const p = TABLAS.hipismo_planos.find(x => x.id === id);
    if (p) Object.assign(p, { pizarra, comision_total: comisionTotal, texto_resultado: textoResultado });
    return { rows: [] };
  }
  if (/^UPDATE hipismo_planos SET pizarra = NULL, comision_total = 0, texto_resultado = \$1 WHERE id = \$2$/i.test(sql)) {
    const [textoResultado, id] = params;
    const p = TABLAS.hipismo_planos.find(x => x.id === id);
    if (p) Object.assign(p, { pizarra: null, comision_total: 0, texto_resultado: textoResultado });
    return { rows: [] };
  }

  // ---- hipismo_tickets: lookup + update ----
  if (/^SELECT \* FROM hipismo_tickets WHERE plano_id = \$1 ORDER BY creado_en$/i.test(sql)) {
    const [planoId] = params;
    return { rows: TABLAS.hipismo_tickets.filter(t => t.plano_id === planoId).sort((a, b) => a.creado_en - b.creado_en) };
  }
  if (/^UPDATE hipismo_tickets SET resultado_jugador = \$1, resultado_banquero = \$2 WHERE id = \$3$/i.test(sql)) {
    const [rj, rb, id] = params;
    const t = TABLAS.hipismo_tickets.find(x => x.id === id);
    if (t) Object.assign(t, { resultado_jugador: rj, resultado_banquero: rb });
    return { rows: [] };
  }
  if (/^UPDATE hipismo_tickets SET resultado_jugador = 0, resultado_banquero = 0 WHERE plano_id = \$1$/i.test(sql)) {
    const [planoId] = params;
    TABLAS.hipismo_tickets.filter(t => t.plano_id === planoId).forEach(t => Object.assign(t, { resultado_jugador: 0, resultado_banquero: 0 }));
    return { rows: [] };
  }

  // ---- hipismo_adelantadas_jugadas: ninguna pendiente en estas pruebas ----
  if (/^SELECT j\.\* FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id WHERE j\.grupo_id = \$1 AND p\.hipodromo_nombre = \$2 AND j\.carrera_numero = \$3 AND p\.fecha = \$4 AND j\.estado = 'pendiente'/i.test(sql)) {
    return { rows: [] };
  }

  // ---- hipismo_remates: lookup + update ----
  if (/^SELECT \* FROM hipismo_remates WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const r = TABLAS.hipismo_remates.find(x => x.id === id && x.grupo_id === grupoId);
    return { rows: r ? [r] : [] };
  }
  if (/^UPDATE hipismo_remates SET pizarra = \$1, numero_ganador = \$2, hubo_ganador = \$3, caballo_ganador = \$4, cliente_ganador = \$5, pago_ganador = \$6, comision_total = \$7, texto_resultado = \$8 WHERE id = \$9$/i.test(sql)) {
    const [pizarra, numeroGanador, huboGanador, caballoGanador, clienteGanador, pagoGanador, comisionTotal, textoResultado, id] = params;
    const r = TABLAS.hipismo_remates.find(x => x.id === id);
    if (r) Object.assign(r, { pizarra, numero_ganador: numeroGanador, hubo_ganador: huboGanador, caballo_ganador: caballoGanador, cliente_ganador: clienteGanador, pago_ganador: pagoGanador, comision_total: comisionTotal, texto_resultado: textoResultado });
    return { rows: [] };
  }
  if (/^UPDATE hipismo_remates SET pizarra = NULL, numero_ganador = NULL, hubo_ganador = false, caballo_ganador = NULL, cliente_ganador = NULL, pago_ganador = 0, comision_total = 0, texto_resultado = \$1 WHERE id = \$2$/i.test(sql)) {
    const [textoResultado, id] = params;
    const r = TABLAS.hipismo_remates.find(x => x.id === id);
    if (r) Object.assign(r, { pizarra: null, numero_ganador: null, hubo_ganador: false, caballo_ganador: null, cliente_ganador: null, pago_ganador: 0, comision_total: 0, texto_resultado: textoResultado });
    return { rows: [] };
  }

  // ---- hipismo_remate_apuestas: lookup + update ----
  if (/^SELECT \* FROM hipismo_remate_apuestas WHERE remate_id = \$1 ORDER BY creado_en$/i.test(sql)) {
    const [remateId] = params;
    return { rows: TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === remateId).sort((a, b) => a.creado_en - b.creado_en) };
  }
  if (/^SELECT \* FROM hipismo_remate_apuestas WHERE remate_id = \$1 ORDER BY numero_ejemplar$/i.test(sql)) {
    const [remateId] = params;
    return { rows: TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === remateId).sort((a, b) => a.numero_ejemplar - b.numero_ejemplar) };
  }
  if (/^UPDATE hipismo_remate_apuestas SET resultado = \$1 WHERE id = \$2$/i.test(sql)) {
    const [resultado, id] = params;
    const a = TABLAS.hipismo_remate_apuestas.find(x => x.id === id);
    if (a) a.resultado = resultado;
    return { rows: [] };
  }
  if (/^UPDATE hipismo_remate_apuestas SET resultado = 0 WHERE remate_id = \$1$/i.test(sql)) {
    const [remateId] = params;
    TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === remateId).forEach(a => { a.resultado = 0; });
    return { rows: [] };
  }

  // ---- obtenerApuestasDelRango (usada por GET /montos-apostados) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id WHERE t\.grupo_id = \$1 AND p\.fecha = \$2$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.numero_ejemplar, a\.monto, r\.hipodromo_nombre, r\.carrera_numero, r\.numero_ganador, r\.hubo_ganador FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id WHERE a\.grupo_id = \$1 AND r\.fecha = \$2 AND r\.modo <> 'manual'$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rr => rr.id === a.remate_id) }))
      .filter(({ a, r }) => r && r.grupo_id === grupoId && r.fecha === fecha)
      .map(({ a, r }) => ({
        id: a.id, cliente_nombre: a.cliente_nombre, caballo: a.caballo, numero_ejemplar: a.numero_ejemplar, monto: a.monto,
        hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero, numero_ganador: r.numero_ganador, hubo_ganador: r.hubo_ganador
      }));
    return { rows: filas };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.sin_comision, j\.banqueadores, p\.hipodromo_nombre FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }
  // comisiones propias / % devuelto (GET /montos-apostados las ignora para
  // esta prueba — basta con que no exploten).
  if (/^SELECT nombre, comision_propia, tipo_cuenta FROM jugadores/i.test(sql)) return { rows: [] };

  // ---- registrarAlerta ----
  if (/^INSERT INTO hipismo_alertas/i.test(sql)) {
    TABLAS.hipismo_alertas.push({ tipo: params[1], hipodromoNombre: params[3], carreraNumero: params[4], mensaje: params[6] });
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (pizarras) no sabe responder: ' + sql);
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
const handlerGetPizarras = handlerDe('get', '/pizarras');
const handlerPutTercios = handlerDe('put', '/pizarras/tercios/:id');
const handlerDeleteTercios = handlerDe('delete', '/pizarras/tercios/:id');
const handlerPutRemate = handlerDe('put', '/pizarras/remate/:id');
const handlerDeleteRemate = handlerDe('delete', '/pizarras/remate/:id');
const handlerMontosApostados = handlerDe('get', '/montos-apostados');

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
function reqBase(grupoId, extra) {
  return Object.assign({ grupoId, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: {}, query: {}, body: {} }, extra || {});
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // ---- Seed: un plano de Tercios y un remate, ambos YA con pizarra ----
  TABLAS.hipismo_planos.push({
    id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada',
    carrera_numero: 3, fecha: '2026-09-29', ret: null, pizarra: '5.3.1', cruza_jugadas: false,
    texto_original: 'texto original', texto_resultado: 'texto viejo', comision_total: 2.5, creado_en: 1000
  });
  TABLAS.hipismo_tickets.push(
    { id: 'tk-1', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'FLACO', modalidad: '1P', caballo: '5', monto: 100, resultado_jugador: 95, resultado_banquero: -100, sin_comision: false, creado_en: 1000 },
    { id: 'tk-2', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'MARIA', banquero_nombre: 'FLACO', modalidad: '1P', caballo: '3', monto: 40, resultado_jugador: -40, resultado_banquero: 38, sin_comision: false, creado_en: 2000 }
  );
  TABLAS.hipismo_remates.push({
    id: 'remate-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'Valencia', carrera_numero: 2,
    fecha: '2026-09-29', texto_original: 'texto', comision_porcentaje: 20, garantia: null, pago_fijo: null,
    pool_total: 80, pizarra: '7.1.2', numero_ganador: 7, hubo_ganador: true, caballo_ganador: 'RAYO', cliente_ganador: 'CARLOS',
    pago_ganador: 64, comision_total: 16, texto_resultado: 'texto viejo remate', creado_en: 1000
  });
  TABLAS.hipismo_remate_apuestas.push(
    { id: 'ra-1', remate_id: 'remate-1', grupo_id: GRUPO_ID, numero_ejemplar: 7, caballo: 'RAYO', cliente_nombre: 'CARLOS', monto: 30, resultado: 34, creado_en: 1000 },
    { id: 'ra-2', remate_id: 'remate-1', grupo_id: GRUPO_ID, numero_ejemplar: 4, caballo: 'TRUENO', cliente_nombre: 'PEDRO', monto: 50, resultado: -50, creado_en: 2000 }
  );

  // --- 1) GET /pizarras: trae el plano y el remate, ninguno pendiente ---
  const res1 = await invocarRuta(handlerGetPizarras, reqBase(GRUPO_ID, { query: { desde: '2026-09-29', hasta: '2026-09-29' } }));
  check(res1._status === 200, '1) GET /pizarras responde 200');
  check(res1._json.desde === '2026-09-29' && res1._json.hasta === '2026-09-29', '1) GET /pizarras devuelve desde/hasta junto con las filas');
  check(res1._json.filas.length === 2, '1) GET /pizarras trae 1 Tercios + 1 Remate');
  const filaTercios = res1._json.filas.find(f => f.tipo === 'tercios');
  const filaRemate = res1._json.filas.find(f => f.tipo === 'remate');
  check(!!filaTercios && filaTercios.pizarra === '5.3.1' && filaTercios.pendiente === false, '1) El plano de Tercios sale con su pizarra y pendiente=false');
  check(!!filaRemate && filaRemate.pizarra === '7.1.2' && filaRemate.pendiente === false, '1) El remate sale con su pizarra y pendiente=false');
  check(filaTercios.cantidad === 2, '1) El plano de Tercios reporta sus 2 tickets');
  check(filaRemate.cantidad === 2, '1) El remate reporta sus 2 apuestas');
  check(filaTercios.montoTotal === 2.5, '7) Sin comisión propia configurada para PEDRO/MARIA/FLACO, la comisión NETA de Tercios es igual a la bruta (comision_total)');
  check(filaRemate.montoTotal === 80, '1) El montoTotal del Remate sigue siendo el pool_total (monto apostado), sin cambios');

  // --- 2) PUT /pizarras/tercios/:id: corrige la pizarra (ahora gana el 3, no el 5) ---
  const res2 = await invocarRuta(handlerPutTercios, reqBase(GRUPO_ID, { params: { id: 'plano-1' }, body: { pizarra: '3.5.1' } }));
  check(res2._status === 200, '2) PUT /pizarras/tercios/:id responde 200');
  check(res2._json.plano.pizarra === '3.5.1', '2) El plano queda con la pizarra corregida');
  const tk1 = TABLAS.hipismo_tickets.find(t => t.id === 'tk-1');
  const tk2 = TABLAS.hipismo_tickets.find(t => t.id === 'tk-2');
  check(tk1.resultado_jugador < 0, '2) PEDRO (jugó al 5, que ya NO ganó con la pizarra corregida) ahora pierde');
  check(tk2.resultado_jugador > 0, '2) MARIA (jugó al 3, que SÍ ganó con la pizarra corregida) ahora gana');
  check(TABLAS.hipismo_planos.find(p => p.id === 'plano-1').texto_resultado !== 'texto viejo', '2) Se regeneró texto_resultado del plano');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PIZARRA_EDITADA' && a.carreraNumero === 3), '2) Se registró la alerta PIZARRA_EDITADA');

  // --- 3) DELETE /pizarras/tercios/:id: el plano NO se borra, queda pendiente ---
  const res3 = await invocarRuta(handlerDeleteTercios, reqBase(GRUPO_ID, { params: { id: 'plano-1' } }));
  check(res3._status === 200 && res3._json.pendiente === true, '3) DELETE /pizarras/tercios/:id responde pendiente:true');
  const planoTrasBorrar = TABLAS.hipismo_planos.find(p => p.id === 'plano-1');
  check(!!planoTrasBorrar, '3) El plano SIGUE existiendo (no se borró, a diferencia de "Eliminar Planos")');
  check(planoTrasBorrar.pizarra === null, '3) La pizarra del plano queda NULL');
  check(/pendiente de pizarra/i.test(planoTrasBorrar.texto_resultado), '3) El texto queda como aviso de pendiente');
  const tk1Final = TABLAS.hipismo_tickets.find(t => t.id === 'tk-1');
  const tk2Final = TABLAS.hipismo_tickets.find(t => t.id === 'tk-2');
  check(tk1Final.resultado_jugador === 0 && tk1Final.resultado_banquero === 0, '3) El ticket de PEDRO queda en 0/0 ("sin decidir")');
  check(tk2Final.resultado_jugador === 0 && tk2Final.resultado_banquero === 0, '3) El ticket de MARIA queda en 0/0 ("sin decidir")');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PIZARRA_ELIMINADA' && a.carreraNumero === 3), '3) Se registró la alerta PIZARRA_ELIMINADA');

  // --- 4) PUT /pizarras/remate/:id: corrige la pizarra (ahora gana el 4, no el 7) ---
  const res4 = await invocarRuta(handlerPutRemate, reqBase(GRUPO_ID, { params: { id: 'remate-1' }, body: { pizarra: '4.7.2' } }));
  check(res4._status === 200, '4) PUT /pizarras/remate/:id responde 200');
  check(res4._json.remate.numero_ganador === 4, '4) El remate queda con el numero_ganador corregido (4)');
  check(res4._json.remate.cliente_ganador === 'PEDRO', '4) El ganador ahora es PEDRO (jugó al 4)');
  const ra1 = TABLAS.hipismo_remate_apuestas.find(a => a.id === 'ra-1');
  const ra2 = TABLAS.hipismo_remate_apuestas.find(a => a.id === 'ra-2');
  check(ra1.resultado === -30, '4) CARLOS (jugó al 7, que ya NO ganó) ahora pierde su monto completo');
  check(ra2.resultado > 0, '4) PEDRO (jugó al 4, que SÍ ganó con la pizarra corregida) ahora gana');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PIZARRA_EDITADA' && a.hipodromoNombre === 'Valencia'), '4) Se registró la alerta PIZARRA_EDITADA del remate');

  // --- 5) DELETE /pizarras/remate/:id: el remate NO se borra, queda pendiente ---
  const res5 = await invocarRuta(handlerDeleteRemate, reqBase(GRUPO_ID, { params: { id: 'remate-1' } }));
  check(res5._status === 200 && res5._json.pendiente === true, '5) DELETE /pizarras/remate/:id responde pendiente:true');
  const remateTrasBorrar = TABLAS.hipismo_remates.find(r => r.id === 'remate-1');
  check(!!remateTrasBorrar, '5) El remate SIGUE existiendo (no se borró)');
  check(remateTrasBorrar.pizarra === null && remateTrasBorrar.numero_ganador === null, '5) pizarra y numero_ganador quedan NULL');
  check(remateTrasBorrar.hubo_ganador === false, '5) hubo_ganador vuelve a false');
  const ra1Final = TABLAS.hipismo_remate_apuestas.find(a => a.id === 'ra-1');
  const ra2Final = TABLAS.hipismo_remate_apuestas.find(a => a.id === 'ra-2');
  check(ra1Final.resultado === 0 && ra2Final.resultado === 0, '5) Todas las apuestas del remate quedan en resultado=0 ("sin decidir")');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PIZARRA_ELIMINADA' && a.hipodromoNombre === 'Valencia'), '5) Se registró la alerta PIZARRA_ELIMINADA del remate');

  // --- 6) obtenerApuestasDelRango (vía Montos Apostados) trata el remate
  //     pendiente como "sin decidir", no como "PERDIÓ" ---
  const res6 = await invocarRuta(handlerMontosApostados, reqBase(GRUPO_ID, { query: { desde: '2026-09-29', hasta: '2026-09-29' } }));
  check(res6._status === 200, '6) GET /montos-apostados responde 200 con un remate pendiente de pizarra');
  const detalleCarlos = (res6._json.clientes || []).find(c => c.nombre === 'CARLOS');
  const lineaRemateCarlos = detalleCarlos && detalleCarlos.detalle.find(d => d.tipo === 'remate');
  check(!!lineaRemateCarlos, '6) La jugada de remate de CARLOS sigue apareciendo en Montos Apostados (con monto, aunque esté pendiente)');
  check(lineaRemateCarlos.gano === null, '6) gano=null (sin decidir) para un remate con pizarra eliminada, no false ("perdió")');

  // --- 7) GET /pizarras: comisión NETA de Tercios con % propio real ---
  // (01-10-2026, a pedido del usuario tras ver "115,50" en producción:
  // "debes mostrar el % que quedo en comsion para el grupo en esa carrera
  // ya descontando todas las devoluciones"). Plano nuevo, carrera propia
  // (99) para no pisar plano-1 (ya "pendiente" tras la prueba 3).
  TABLAS.hipismo_planos.push({
    id: 'plano-net', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada',
    carrera_numero: 99, fecha: '2026-09-29', ret: null, pizarra: '2.1.3', cruza_jugadas: false,
    texto_original: 'texto', texto_resultado: 'texto', comision_total: 100, creado_en: 3000
  });
  TABLAS.hipismo_tickets.push(
    { id: 'tk-net', plano_id: 'plano-net', grupo_id: GRUPO_ID, cliente_nombre: 'JUAN', banquero_nombre: 'LUIS', modalidad: '1P', caballo: '2', monto: 200, resultado_jugador: 190, resultado_banquero: -200, sin_comision: false, creado_en: 3000 }
  );
  // JUAN: 5% propio sobre lo que apostó (200) = 10. LUIS: 2% = 4. Ningún
  // aval configurado (jugadores_avales_porcentaje queda vacío arriba).
  TABLAS.jugadores.push(
    { id: 'jug-juan', grupo_id: GRUPO_ID, nombre: 'JUAN', comision_propia: 5, incluir_porcentaje_en_jugadas: false },
    { id: 'jug-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 2, incluir_porcentaje_en_jugadas: false }
  );
  const res7 = await invocarRuta(handlerGetPizarras, reqBase(GRUPO_ID, { query: { desde: '2026-09-29', hasta: '2026-09-29' } }));
  const filaNet = res7._json.filas.find(f => f.tipo === 'tercios' && f.id === 'plano-net');
  check(!!filaNet, '7) GET /pizarras trae el plano-net nuevo');
  // 100 (bruto) - 10 (JUAN, 5% de 200) - 4 (LUIS, 2% de 200) = 86.
  check(filaNet && filaNet.montoTotal === 86, `7) La comisión NETA descuenta el % propio de cliente Y banquero (esperado 86, salió ${filaNet && filaNet.montoTotal})`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "Pizarras" se cayó con una excepción:', e);
  process.exit(1);
});
