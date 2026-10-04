// =================================================================
// PRUEBA: "Pizarras" + Jugadas Adelantadas (01-10-2026, segunda ronda —
// ver la nota grande "ACTUALIZACIÓN 01-10-2026 (segunda ronda)" en
// routes/hipismo.js, punto 5). A diferencia de Tercios/Remate
// (test_hipismo_pizarras.js), Adelantadas no tiene un :id de una sola
// fila — se identifica por fecha+hipódromo+carrera y cubre TODAS sus
// jugadas de esa carrera de una vez.
//
// Casos cubiertos:
//   1. GET /pizarras: una carrera con Jugadas Adelantadas sale como fila
//      tipo:'adelantadas', agregando cantidad/montoTotal/pizarra de
//      TODAS sus jugadas (sin Tercios/Remate de por medio).
//   2. PUT /pizarras/adelantadas: re-resuelve una Tabla Fija que YA
//      estaba 'resuelto' con una pizarra VIEJA (soloPendientes=false) —
//      no solo las que seguían 'pendiente'.
//   3. PUT /pizarras/adelantadas sobre una Marca YA bancada
//      (estado='resuelto', banqueadores cargado): al recalcular con la
//      pizarra corregida, banqueadores queda en NULL y el estado vuelve
//      a 'falta_banqueo'/'sin_decidir' — el operador tiene que rebancar
//      con el resultado ya corregido (a propósito, ver la nota grande de
//      guardarResolucionAdelantadas en routes/hipismo.js).
//   4. DELETE /pizarras/adelantadas: NO borra las jugadas — todas vuelven
//      a 'pendiente' (gano/resultado_cliente/comision/pizarra_usada/
//      banqueadores en NULL).
//   5. 404 cuando no hay ninguna Jugada Adelantada para esa carrera.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-pizarras-adelantadas-1';

const TABLAS = {
  hipismo_planos: [],
  hipismo_remates: [],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_hipodromos: [],
  hipismo_alertas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- GET /pizarras: Tercios/Remate (vacíos en esta prueba) ----
  if (/^SELECT p\.id, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero, p\.pizarra, p\.comision_total,/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT r\.id, r\.fecha, r\.hipodromo_nombre, r\.carrera_numero, r\.pizarra, r\.pool_total,/i.test(sql)) {
    return { rows: [] };
  }
  // ---- GET /pizarras: fila agregada tipo:'adelantadas' ----
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

  // ---- buscarAdelantadasPendientes: variante soloPendientes=false (sin filtro de estado) ----
  if (/^SELECT j\.\* FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id WHERE j\.grupo_id = \$1 AND p\.hipodromo_nombre = \$2 AND j\.carrera_numero = \$3 AND p\.fecha = \$4 ORDER BY j\.creado_en$/i.test(sql)) {
    const [grupoId, hipodromoNombre, carreraNumero, fecha] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas.filter(j => {
      if (j.grupo_id !== grupoId || j.carrera_numero !== carreraNumero) return false;
      const plano = TABLAS.hipismo_adelantadas_planos.find(p => p.id === j.plano_id);
      return plano && plano.hipodromo_nombre === hipodromoNombre && plano.fecha === fecha;
    });
    return { rows: filas };
  }
  // ---- buscarAdelantadasPendientes: variante soloPendientes=true (con filtro de estado) ----
  if (/^SELECT j\.\* FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id WHERE j\.grupo_id = \$1 AND p\.hipodromo_nombre = \$2 AND j\.carrera_numero = \$3 AND p\.fecha = \$4 AND j\.estado = 'pendiente'/i.test(sql)) {
    const [grupoId, hipodromoNombre, carreraNumero, fecha] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas.filter(j => {
      if (j.grupo_id !== grupoId || j.carrera_numero !== carreraNumero || j.estado !== 'pendiente') return false;
      const plano = TABLAS.hipismo_adelantadas_planos.find(p => p.id === j.plano_id);
      return plano && plano.hipodromo_nombre === hipodromoNombre && plano.fecha === fecha;
    });
    return { rows: filas };
  }
  if (/^SELECT pais FROM hipismo_hipodromos WHERE grupo_id = \$1 AND nombre = \$2$/i.test(sql)) {
    const [grupoId, nombre] = params;
    const h = TABLAS.hipismo_hipodromos.find(x => x.grupo_id === grupoId && x.nombre === nombre);
    return { rows: h ? [h] : [] };
  }
  // ---- guardarResolucionAdelantadas ----
  if (/^UPDATE hipismo_adelantadas_jugadas SET estado = \$1, gano = \$2, resultado_cliente = \$3, comision = \$4, pizarra_usada = \$5, resuelto_en = now\(\), banqueadores = NULL WHERE id = \$6 AND grupo_id = \$7$/i.test(sql)) {
    const [estado, gano, resultadoCliente, comision, pizarraUsada, id, grupoId] = params;
    const j = TABLAS.hipismo_adelantadas_jugadas.find(x => x.id === id && x.grupo_id === grupoId);
    if (j) Object.assign(j, { estado, gano, resultado_cliente: resultadoCliente, comision, pizarra_usada: pizarraUsada, resuelto_en: Date.now(), banqueadores: null });
    return { rows: [] };
  }
  // ---- DELETE /pizarras/adelantadas ----
  if (/^UPDATE hipismo_adelantadas_jugadas SET estado = 'pendiente', gano = NULL, resultado_cliente = NULL, comision = NULL, banqueadores = NULL, pizarra_usada = NULL, resuelto_en = NULL WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const j = TABLAS.hipismo_adelantadas_jugadas.find(x => x.id === id && x.grupo_id === grupoId);
    if (j) Object.assign(j, { estado: 'pendiente', gano: null, resultado_cliente: null, comision: null, banqueadores: null, pizarra_usada: null, resuelto_en: null });
    return { rows: [] };
  }
  // ---- registrarAlerta ----
  if (/^INSERT INTO hipismo_alertas/i.test(sql)) {
    TABLAS.hipismo_alertas.push({ tipo: params[1], hipodromoNombre: params[3], carreraNumero: params[4], mensaje: params[6] });
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.\* FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (pizarras+adelantadas) no sabe responder: ' + sql);
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
const handlerPutAdelantadas = handlerDe('put', '/pizarras/adelantadas');
const handlerDeleteAdelantadas = handlerDe('delete', '/pizarras/adelantadas');

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
  TABLAS.hipismo_adelantadas_planos.push({
    id: 'ap-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', fecha: '2026-09-29', texto_original: 'texto', creado_en: 1000
  });

  // tf (Tabla Fija): YA estaba 'resuelto' con una pizarra VIEJA ('7.1.2',
  // el 5 no ganó) — la carrera real la ganó el 5, así que esto estaba MAL.
  TABLAS.hipismo_adelantadas_jugadas.push({
    id: 'tf-1', plano_id: 'ap-1', grupo_id: GRUPO_ID, cliente_nombre: 'LINARES', carrera_numero: 7, tipo: 'tf',
    numero_ejemplar: 5, monto: 100, ganancia_potencial: 500, comision_porcentaje: 2.5,
    texto_original: 'texto', error_calculo: false, estado: 'resuelto', gano: false, resultado_cliente: -100,
    comision: 2.5, banqueadores: null, pizarra_usada: '7.1.2', resuelto_en: 1000, creado_en: 1000
  });
  // marca: YA bancada (estado='resuelto', banqueadores cargado) con la
  // misma pizarra vieja — ver caso 3.
  TABLAS.hipismo_adelantadas_jugadas.push({
    id: 'marca-1', plano_id: 'ap-1', grupo_id: GRUPO_ID, cliente_nombre: 'MANOLO', carrera_numero: 7, tipo: 'marca',
    numero1: 5, numero2: 3, monto: 50, comision_porcentaje: 2.5,
    texto_original: 'texto', error_calculo: false, estado: 'resuelto', gano: false, resultado_cliente: -50,
    comision: null, banqueadores: [{ nombre: 'ZENYATTA', porcentaje: 100, pagaComision: true, comisionPorcentaje: 2.5, monto: 50 }],
    pizarra_usada: '7.1.2', resuelto_en: 1000, creado_en: 2000
  });

  // --- 1) GET /pizarras: la fila 'adelantadas' agrega las 2 jugadas de la carrera 7 ---
  const res1 = await invocarRuta(handlerGetPizarras, reqBase(GRUPO_ID, { query: { desde: '2026-09-29', hasta: '2026-09-29' } }));
  check(res1._status === 200, '1) GET /pizarras responde 200');
  const filaAdelantadas = res1._json.filas.find(f => f.tipo === 'adelantadas');
  check(!!filaAdelantadas, '1) GET /pizarras trae la fila tipo:adelantadas de la carrera 7');
  check(filaAdelantadas && filaAdelantadas.cantidad === 2, '1) Agrega las 2 jugadas (tf + marca) de esa carrera');
  check(filaAdelantadas && filaAdelantadas.montoTotal === 150, '1) montoTotal es la suma de los montos apostados (100 + 50)');
  check(filaAdelantadas && filaAdelantadas.pendiente === false, '1) pendiente=false (las 2 ya estaban resueltas)');
  check(filaAdelantadas && filaAdelantadas.pizarra === '7.1.2', '1) Muestra la pizarra con la que se resolvieron');

  // --- 2) PUT /pizarras/adelantadas: corrige la pizarra (ahora SÍ gana el 5) ---
  const res2 = await invocarRuta(handlerPutAdelantadas, reqBase(GRUPO_ID, {
    body: { fecha: '2026-09-29', hipodromoNombre: 'La Rinconada', carreraNumero: 7, pizarra: '5.3.1' }
  }));
  check(res2._status === 200, '2) PUT /pizarras/adelantadas responde 200');
  check(res2._json.cantidad === 2, '2) Reporta que recalculó las 2 jugadas de esa carrera');
  const tf1 = TABLAS.hipismo_adelantadas_jugadas.find(j => j.id === 'tf-1');
  check(tf1.gano === true, '2) LINARES (Tabla Fija al 5): con la pizarra corregida, el 5 SÍ ganó');
  check(tf1.resultado_cliente === 400, '2) resultado_cliente recalculado (ganancia_potencial 500 - monto 100 = 400)');
  check(tf1.pizarra_usada === '5.3.1', '2) pizarra_usada queda con la pizarra corregida');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PIZARRA_EDITADA' && a.carreraNumero === 7), '2) Se registró la alerta PIZARRA_EDITADA');

  // --- 3) La Marca ya bancada pierde su banqueo al recalcularse (a propósito) ---
  const marca1 = TABLAS.hipismo_adelantadas_jugadas.find(j => j.id === 'marca-1');
  check(marca1.banqueadores === null, '3) banqueadores queda en NULL tras recalcular con la pizarra corregida (había que rebanquear)');
  check(marca1.estado === 'falta_banqueo' || marca1.estado === 'sin_decidir', '3) El estado vuelve a falta_banqueo/sin_decidir (ya no "resuelto" con el banqueo viejo)');

  // --- 4) DELETE /pizarras/adelantadas: NO borra las jugadas, vuelven a 'pendiente' ---
  const res4 = await invocarRuta(handlerDeleteAdelantadas, reqBase(GRUPO_ID, {
    query: { fecha: '2026-09-29', hipodromoNombre: 'La Rinconada', carreraNumero: '7' }
  }));
  check(res4._status === 200 && res4._json.pendiente === true, '4) DELETE /pizarras/adelantadas responde pendiente:true');
  const tf1Final = TABLAS.hipismo_adelantadas_jugadas.find(j => j.id === 'tf-1');
  check(tf1Final.estado === 'pendiente' && tf1Final.gano === null && tf1Final.resultado_cliente === null, '4) La Tabla Fija vuelve a pendiente, sin resultado');
  check(tf1Final.pizarra_usada === null, '4) pizarra_usada queda NULL');
  check(TABLAS.hipismo_adelantadas_jugadas.length === 2, '4) Las jugadas SIGUEN existiendo (no se borraron, solo volvieron a pendiente)');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PIZARRA_ELIMINADA' && a.carreraNumero === 7), '4) Se registró la alerta PIZARRA_ELIMINADA');

  // --- 5) 404 cuando no hay ninguna Jugada Adelantada para esa carrera ---
  const res5 = await invocarRuta(handlerPutAdelantadas, reqBase(GRUPO_ID, {
    body: { fecha: '2026-09-29', hipodromoNombre: 'La Rinconada', carreraNumero: 12, pizarra: '1.2.3' }
  }));
  check(res5._status === 404, '5) PUT /pizarras/adelantadas con una carrera sin jugadas responde 404');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "Pizarras + Jugadas Adelantadas" se cayó con una excepción:', e);
  process.exit(1);
});
