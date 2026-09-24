// =================================================================
// PRUEBA: "Eliminar Jornada" (24-09-2026, Administración) — a pedido del
// usuario: "crea un boton que diga eliminar jornada.... al seleccionar
// un dia borra todo lo que este ese dia, todas las jugadas, remate,
// ganadores, jugadas entre tercios, todo absolutamente todo del dia".
// Se le preguntó si debía ser recuperable (papelera) o permanente.
// Respuesta textual: "PIDEME LA CLAVE DE ACCESO PARA VERIFICAR QUE
// QUIERO ELIMINARLO, AL ELIMINARLO SE BORRA PARA SIEMPRE" — permanente,
// protegido con la clave real de la sesión (grupos.password_hash o
// empleados.password_hash, según quién esté logueado). Ver la nota
// grande en routes/hipismo.js, GET /jornada/resumen y POST /jornada/eliminar.
//
// Mismo patrón de base de datos falsa en memoria que
// test_hipismo_reportes.js (Module._load intercepta "pg"/"express"/
// "bcryptjs" antes de requerir el router real) — a diferencia de otras
// pruebas del repo, acá bcryptjs.compare SÍ hace una comparación real
// (contra un "hash" falso con forma "HASH::<clave-real>"), para poder
// probar tanto la clave correcta como la incorrecta.
//
// Casos cubiertos:
//   1. GET /jornada/resumen?fecha=: cuenta planos/remates/adelantadas de
//      esa fecha puntual (sin tocar otras fechas), con los hipódromos
//      involucrados; una fecha sin nada -> vacio:true.
//   2. POST /jornada/eliminar sin password, o con password incorrecta ->
//      401, y NO borra nada (se verifica que las 3 tablas siguen intactas).
//   3. POST /jornada/eliminar con la clave correcta del ADMINISTRADOR
//      (grupos.password_hash) -> borra planos+tickets, remates+apuestas y
//      adelantadas+jugadas de ESA fecha, deja INTACTAS las de otra fecha
//      y las de otro grupo, y genera una alerta JORNADA_ELIMINADA.
//   4. Lo mismo pero logueado como EMPLEADO (empleados.password_hash) —
//      la clave que se valida es la del EMPLEADO, no la del grupo.
//   5. Falta la fecha en el body -> 400, sin llamar a bcrypt.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-jornada-1';
const OTRO_GRUPO_ID = 'grupo-jornada-2';
const FECHA = '2026-09-24';
const OTRA_FECHA = '2026-09-25';

const TABLAS = {
  grupos: [
    { id: GRUPO_ID, password_hash: 'HASH::clave-admin-123' },
    { id: OTRO_GRUPO_ID, password_hash: 'HASH::otra-clave' }
  ],
  empleados: [
    { id: 'emp-1', grupo_id: GRUPO_ID, password_hash: 'HASH::clave-empleado-456' }
  ],
  hipismo_planos: [
    { id: 'plano-1', grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'La Rinconada' },
    { id: 'plano-2', grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'Valencia' },
    { id: 'plano-otra-fecha', grupo_id: GRUPO_ID, fecha: OTRA_FECHA, hipodromo_nombre: 'La Rinconada' },
    { id: 'plano-otro-grupo', grupo_id: OTRO_GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'La Rinconada' }
  ],
  hipismo_tickets: [
    { id: 'tk-1', plano_id: 'plano-1' },
    { id: 'tk-2', plano_id: 'plano-2' },
    { id: 'tk-otra-fecha', plano_id: 'plano-otra-fecha' }
  ],
  hipismo_remates: [
    { id: 'remate-1', grupo_id: GRUPO_ID, fecha: FECHA },
    { id: 'remate-otra-fecha', grupo_id: GRUPO_ID, fecha: OTRA_FECHA }
  ],
  hipismo_remate_apuestas: [
    { id: 'ra-1', remate_id: 'remate-1' },
    { id: 'ra-otra-fecha', remate_id: 'remate-otra-fecha' }
  ],
  hipismo_adelantadas_planos: [
    { id: 'adel-1', grupo_id: GRUPO_ID, fecha: FECHA },
    { id: 'adel-otra-fecha', grupo_id: GRUPO_ID, fecha: OTRA_FECHA }
  ],
  hipismo_adelantadas_jugadas: [
    { id: 'aj-1', plano_id: 'adel-1' },
    { id: 'aj-otra-fecha', plano_id: 'adel-otra-fecha' }
  ],
  hipismo_alertas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- verificarClaveAccesoActor ----
  if (/^SELECT password_hash FROM grupos WHERE id = \$1$/i.test(sql)) {
    const [id] = params;
    const g = TABLAS.grupos.find(x => x.id === id);
    return { rows: g ? [{ password_hash: g.password_hash }] : [] };
  }
  if (/^SELECT password_hash FROM empleados WHERE id = \$1$/i.test(sql)) {
    const [id] = params;
    const e = TABLAS.empleados.find(x => x.id === id);
    return { rows: e ? [{ password_hash: e.password_hash }] : [] };
  }

  // ---- GET /jornada/resumen ----
  if (/^SELECT COUNT\(\*\)::int AS n, COALESCE\(array_agg\(DISTINCT hipodromo_nombre\), ARRAY\[\]::text\[\]\) AS hipodromos FROM hipismo_planos WHERE grupo_id = \$1 AND fecha = \$2$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId && p.fecha === fecha);
    return { rows: [{ n: filas.length, hipodromos: Array.from(new Set(filas.map(p => p.hipodromo_nombre))) }] };
  }
  if (/^SELECT COUNT\(\*\)::int AS n FROM hipismo_remates WHERE grupo_id = \$1 AND fecha = \$2$/i.test(sql)) {
    const [grupoId, fecha] = params;
    return { rows: [{ n: TABLAS.hipismo_remates.filter(r => r.grupo_id === grupoId && r.fecha === fecha).length }] };
  }
  if (/^SELECT COUNT\(\*\)::int AS n FROM hipismo_adelantadas_planos WHERE grupo_id = \$1 AND fecha = \$2$/i.test(sql)) {
    const [grupoId, fecha] = params;
    return { rows: [{ n: TABLAS.hipismo_adelantadas_planos.filter(p => p.grupo_id === grupoId && p.fecha === fecha).length }] };
  }

  // ---- POST /jornada/eliminar (con cascada simulada, como ON DELETE CASCADE) ----
  if (/^DELETE FROM hipismo_planos WHERE grupo_id = \$1 AND fecha = \$2 RETURNING id$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const borrados = TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId && p.fecha === fecha);
    const idsBorrados = new Set(borrados.map(p => p.id));
    TABLAS.hipismo_planos = TABLAS.hipismo_planos.filter(p => !idsBorrados.has(p.id));
    TABLAS.hipismo_tickets = TABLAS.hipismo_tickets.filter(t => !idsBorrados.has(t.plano_id));
    return { rows: borrados.map(p => ({ id: p.id })) };
  }
  if (/^DELETE FROM hipismo_remates WHERE grupo_id = \$1 AND fecha = \$2 RETURNING id$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const borrados = TABLAS.hipismo_remates.filter(r => r.grupo_id === grupoId && r.fecha === fecha);
    const idsBorrados = new Set(borrados.map(r => r.id));
    TABLAS.hipismo_remates = TABLAS.hipismo_remates.filter(r => !idsBorrados.has(r.id));
    TABLAS.hipismo_remate_apuestas = TABLAS.hipismo_remate_apuestas.filter(a => !idsBorrados.has(a.remate_id));
    return { rows: borrados.map(r => ({ id: r.id })) };
  }
  if (/^DELETE FROM hipismo_adelantadas_planos WHERE grupo_id = \$1 AND fecha = \$2 RETURNING id$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const borrados = TABLAS.hipismo_adelantadas_planos.filter(p => p.grupo_id === grupoId && p.fecha === fecha);
    const idsBorrados = new Set(borrados.map(p => p.id));
    TABLAS.hipismo_adelantadas_planos = TABLAS.hipismo_adelantadas_planos.filter(p => !idsBorrados.has(p.id));
    TABLAS.hipismo_adelantadas_jugadas = TABLAS.hipismo_adelantadas_jugadas.filter(j => !idsBorrados.has(j.plano_id));
    return { rows: borrados.map(p => ({ id: p.id })) };
  }

  // ---- registrarAlerta() ----
  if (/^INSERT INTO hipismo_alertas \(grupo_id, tipo, usuario, hipodromo_nombre, carrera_numero, fecha, mensaje\)/i.test(sql)) {
    const [grupoId, tipo, usuario, hipodromoNombre, carreraNumero, fecha, mensaje] = params;
    TABLAS.hipismo_alertas.push({ grupo_id: grupoId, tipo, usuario, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero, fecha, mensaje });
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
  // A diferencia de otras pruebas del repo (que siempre devuelven true),
  // acá bcryptjs.compare hace una comparación REAL contra el "hash" falso
  // ("HASH::<clave>") para poder probar clave correcta vs. incorrecta.
  if (request === 'bcryptjs') return {
    hash: async () => 'hash',
    compare: async (password, hash) => !!hash && hash === ('HASH::' + password)
  };
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
const handlerResumen = handlerDe('get', '/jornada/resumen');
const handlerEliminar = handlerDe('post', '/jornada/eliminar');

function invocarRuta(handler, req, paramsExtra) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    if (paramsExtra) req.params = paramsExtra;
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

function reqAdmin(grupoId) {
  return { grupoId, rol: 'administrador', nombreActor: 'Zenyatta', params: {}, query: {}, body: {} };
}
function reqEmpleado(grupoId, empleadoId) {
  return { grupoId, empleadoId, rol: 'empleado', nombreActor: 'Carlos', params: {}, query: {}, body: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) GET /jornada/resumen ---
  const resResumen = await invocarRuta(handlerResumen, Object.assign(reqAdmin(GRUPO_ID), { query: { fecha: FECHA } }));
  check(resResumen._status === 200, '1) GET /jornada/resumen responde 200');
  check(resResumen._json.planos === 2 && resResumen._json.remates === 1 && resResumen._json.adelantadas === 1, 'Cuenta 2 planos, 1 remate y 1 adelantada de esa fecha (sin contar otras fechas ni otro grupo)');
  check(resResumen._json.hipodromos.sort().join(',') === 'La Rinconada,Valencia', 'Trae los hipódromos involucrados ese día');
  check(resResumen._json.vacio === false, 'vacio:false cuando hay algo cargado');

  const resResumenVacio = await invocarRuta(handlerResumen, Object.assign(reqAdmin(GRUPO_ID), { query: { fecha: '2099-01-01' } }));
  check(resResumenVacio._json.vacio === true && resResumenVacio._json.planos === 0, 'Una fecha sin nada cargado responde vacio:true');

  const resResumenSinFecha = await invocarRuta(handlerResumen, Object.assign(reqAdmin(GRUPO_ID), { query: {} }));
  check(resResumenSinFecha._status === 400, 'GET /jornada/resumen sin fecha responde 400');

  // --- 5) Falta la fecha en POST /jornada/eliminar -> 400 ---
  const resSinFecha = await invocarRuta(handlerEliminar, Object.assign(reqAdmin(GRUPO_ID), { body: { password: 'clave-admin-123' } }));
  check(resSinFecha._status === 400, '5) POST /jornada/eliminar sin fecha responde 400');

  // --- 2) Sin password, o con password incorrecta -> 401, no borra nada ---
  const totalPlanosAntes = TABLAS.hipismo_planos.length;
  const resSinPassword = await invocarRuta(handlerEliminar, Object.assign(reqAdmin(GRUPO_ID), { body: { fecha: FECHA } }));
  check(resSinPassword._status === 401, '2) POST /jornada/eliminar sin password responde 401');

  const resPasswordMala = await invocarRuta(handlerEliminar, Object.assign(reqAdmin(GRUPO_ID), { body: { fecha: FECHA, password: 'clave-incorrecta' } }));
  check(resPasswordMala._status === 401, 'POST /jornada/eliminar con password incorrecta responde 401');
  check(TABLAS.hipismo_planos.length === totalPlanosAntes, 'Con clave incorrecta, NO se borró ningún plano');
  check(TABLAS.hipismo_alertas.length === 0, 'Con clave incorrecta, tampoco se generó ninguna alerta');

  // --- 3) Clave correcta del ADMINISTRADOR -> borra TODO lo de esa fecha ---
  const resOk = await invocarRuta(handlerEliminar, Object.assign(reqAdmin(GRUPO_ID), { body: { fecha: FECHA, password: 'clave-admin-123' } }));
  check(resOk._status === 200, '3) POST /jornada/eliminar con la clave correcta responde 200');
  check(resOk._json.planos === 2 && resOk._json.remates === 1 && resOk._json.adelantadas === 1, 'Devuelve cuántos planos/remates/adelantadas borró');
  check(TABLAS.hipismo_planos.filter(p => p.grupo_id === GRUPO_ID && p.fecha === FECHA).length === 0, 'Los planos de esa fecha ya no existen');
  check(TABLAS.hipismo_tickets.some(t => t.id === 'tk-1' || t.id === 'tk-2') === false, 'Los tickets de esos planos se borraron en cascada');
  check(TABLAS.hipismo_remates.filter(r => r.fecha === FECHA).length === 0, 'Los remates de esa fecha ya no existen');
  check(TABLAS.hipismo_remate_apuestas.some(a => a.id === 'ra-1') === false, 'Las apuestas de remate se borraron en cascada');
  check(TABLAS.hipismo_adelantadas_planos.filter(p => p.fecha === FECHA).length === 0, 'Las jugadas adelantadas de esa fecha ya no existen');
  check(TABLAS.hipismo_adelantadas_jugadas.some(j => j.id === 'aj-1') === false, 'Las jugadas de adelantadas se borraron en cascada');

  check(TABLAS.hipismo_planos.some(p => p.id === 'plano-otra-fecha'), 'Un plano de OTRA fecha no se tocó');
  check(TABLAS.hipismo_planos.some(p => p.id === 'plano-otro-grupo'), 'Un plano de OTRO grupo (misma fecha) no se tocó');

  check(TABLAS.hipismo_alertas.length === 1, 'Se generó exactamente 1 alerta');
  check(TABLAS.hipismo_alertas[0].tipo === 'JORNADA_ELIMINADA', 'La alerta es de tipo JORNADA_ELIMINADA');
  check(TABLAS.hipismo_alertas[0].usuario === 'Zenyatta', 'La alerta guarda quién la eliminó (req.nombreActor)');
  check(/2 plano/.test(TABLAS.hipismo_alertas[0].mensaje) && /1 remate/.test(TABLAS.hipismo_alertas[0].mensaje), 'El mensaje de la alerta detalla cuánto se borró');

  // --- 4) Logueado como EMPLEADO: se valida SU clave, no la del grupo ---
  const resEmpleadoClaveDeGrupo = await invocarRuta(handlerEliminar, Object.assign(reqEmpleado(GRUPO_ID, 'emp-1'), { body: { fecha: OTRA_FECHA, password: 'clave-admin-123' } }));
  check(resEmpleadoClaveDeGrupo._status === 401, '4) Un empleado con la clave del GRUPO (no la suya) responde 401');
  check(TABLAS.hipismo_planos.some(p => p.id === 'plano-otra-fecha'), 'No se borró nada con la clave equivocada');

  const resEmpleadoOk = await invocarRuta(handlerEliminar, Object.assign(reqEmpleado(GRUPO_ID, 'emp-1'), { body: { fecha: OTRA_FECHA, password: 'clave-empleado-456' } }));
  check(resEmpleadoOk._status === 200, 'Un empleado con SU PROPIA clave sí puede eliminar la jornada');
  check(TABLAS.hipismo_planos.some(p => p.id === 'plano-otra-fecha') === false, 'El plano de esa fecha se borró');
  check(TABLAS.hipismo_alertas.length === 2 && TABLAS.hipismo_alertas[1].usuario === 'Carlos', 'La 2da alerta queda a nombre del empleado (req.nombreActor)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Eliminar Jornada se cayó con una excepción:', e);
  process.exit(1);
});
