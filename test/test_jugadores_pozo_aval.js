// =================================================================
// PRUEBA: Ajuste de Pozo (+/- con motivo, historial) y Aval/"% devuelto"
// en jugadores.js (23-09-2026, duodécima-tercera ronda, a pedido del
// usuario: "desde pozo necesito seleccionar el cliente y editar el
// pozo, aumentarlo diminuirlo etc" -> respondió "Ajuste +/- con motivo"
// cuando se le preguntó cómo debía funcionar; y "en la pestaña clientes
// quiero... si el porcentaje que se le devuelve no es para el si no
// para su aval" -> respondió "Otro cliente ya existente" cuando se le
// preguntó qué es un aval). Ver la nota grande en sql/schema.sql (tablas
// pozo_ajustes, columnas jugadores.avalado_por_id/
// porcentaje_devuelto_destino) y en src/routes/jugadores.js.
//
// Mismo patrón de base de datos falsa en memoria que
// test_jugadores_modelo_comision.js (Module._load intercepta
// "pg"/"express" antes de requerir el router real).
//
// Casos cubiertos:
//   1. POST /:id/pozo-ajuste: suma/resta sobre pozo_inicial (nunca lo
//      pisa), guarda el historial completo (monto, motivo, quién lo
//      hizo, el pozo resultante).
//   2. Validaciones: monto 0/NaN -> 400; jugador que no existe -> 404.
//   3. GET /:id/pozo-ajustes: historial más reciente primero.
//   4. POST/PUT /jugadores con avaladoPorId apuntando a OTRO jugador ya
//      existente del MISMO grupo -> se guarda.
//   5. avaladoPorId apuntando a un jugador de OTRO grupo -> 400 (nunca
//      cruza grupos).
//   6. avaladoPorId = el propio jugador que se está editando -> 400 (no
//      puede ser su propio aval).
//   7. porcentajeDevueltoDestino: 'aval' se guarda tal cual; cualquier
//      otro valor (undefined, '', basura) se normaliza a 'cliente'.
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-pozo-1';
const OTRO_GRUPO_ID = 'grupo-pozo-2';
const TABLAS = {
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', pozo_inicial: 100, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' },
    { id: 'j-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', pozo_inicial: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' },
    { id: 'j-otro-grupo', grupo_id: OTRO_GRUPO_ID, nombre: 'EXTRANJERO', pozo_inicial: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' }
  ],
  pozo_ajustes: []
};
let seq = 1;
const nuevoId = (prefijo) => prefijo + (seq++);

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- POST /:id/pozo-ajuste ----
  if (/^SELECT \* FROM jugadores WHERE id = \$1 AND grupo_id = \$2 FOR UPDATE$/i.test(sql)) {
    const [id, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === id && x.grupo_id === grupoId);
    return { rows: j ? [j] : [] };
  }
  if (/^UPDATE jugadores SET pozo_inicial = \$1 WHERE id = \$2$/i.test(sql)) {
    const [pozo, id] = params;
    const j = TABLAS.jugadores.find(x => x.id === id);
    if (j) j.pozo_inicial = pozo;
    return { rows: [] };
  }
  if (/^INSERT INTO pozo_ajustes \(grupo_id, jugador_id, monto, motivo, pozo_resultante, usuario\)/i.test(sql)) {
    const [grupoId, jugadorId, monto, motivo, pozoResultante, usuario] = params;
    TABLAS.pozo_ajustes.push({ id: nuevoId('adj'), grupo_id: grupoId, jugador_id: jugadorId, monto, motivo, pozo_resultante: pozoResultante, usuario, creado_en: Date.now() + seq });
    return { rows: [] };
  }
  // ---- GET /:id/pozo-ajustes ----
  if (/^SELECT id, monto, motivo, pozo_resultante, usuario, creado_en FROM pozo_ajustes WHERE grupo_id = \$1 AND jugador_id = \$2 ORDER BY creado_en DESC$/i.test(sql)) {
    const [grupoId, jugadorId] = params;
    return { rows: TABLAS.pozo_ajustes.filter(a => a.grupo_id === grupoId && a.jugador_id === jugadorId).sort((a, b) => b.creado_en - a.creado_en) };
  }

  // ---- validarAvaladoPorId ----
  if (/^SELECT id FROM jugadores WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === id && x.grupo_id === grupoId);
    return { rows: j ? [{ id: j.id }] : [] };
  }

  // ---- POST /jugadores ----
  if (/^INSERT INTO jugadores \(grupo_id, nombre, telefono, notas, activo, tipo_cuenta, pozo_inicial, comision_propia, modelo_comision, moneda, modulos_anclados, avalado_por_id, porcentaje_devuelto_destino, porcentaje_devuelto_aval\)/i.test(sql)) {
    const [grupoId, nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados, avaladoPorId, destino, porcentajeAval] = params;
    if (TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      const err = new Error('duplicado'); err.code = '23505'; throw err;
    }
    const fila = {
      id: nuevoId('j'), grupo_id: grupoId, nombre, telefono, notas, activo, tipo_cuenta: tipoCuenta,
      pozo_inicial: pozoInicial, comision_propia: comisionPropia, modelo_comision: modeloComision, moneda,
      modulos_anclados: modulosAnclados, avalado_por_id: avaladoPorId, porcentaje_devuelto_destino: destino,
      porcentaje_devuelto_aval: porcentajeAval
    };
    TABLAS.jugadores.push(fila);
    return { rows: [fila] };
  }
  // ---- PUT /jugadores/:id ----
  if (/^UPDATE jugadores SET nombre = \$1, telefono = \$2, notas = \$3, activo = \$4, tipo_cuenta = \$5,\s*pozo_inicial = \$6, comision_propia = \$7, modelo_comision = \$8, moneda = \$9, auto_creado = false, modulos_anclados = \$10,\s*avalado_por_id = \$11, porcentaje_devuelto_destino = \$12, porcentaje_devuelto_aval = \$13\s*WHERE id = \$14 AND grupo_id = \$15/i.test(sql)) {
    const [nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados, avaladoPorId, destino, porcentajeAval, id, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === id && x.grupo_id === grupoId);
    if (!j) return { rows: [] };
    Object.assign(j, { nombre, telefono, notas, activo, tipo_cuenta: tipoCuenta, pozo_inicial: pozoInicial, comision_propia: comisionPropia, modelo_comision: modeloComision, moneda, modulos_anclados: modulosAnclados, avalado_por_id: avaladoPorId, porcentaje_devuelto_destino: destino, porcentaje_devuelto_aval: porcentajeAval });
    return { rows: [j] };
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
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const jugadoresRouter = require(path.join(__dirname, '..', 'src', 'routes', 'jugadores'));

Module._load = originalLoad;

function handlerDe(metodo, rutaPath) {
  const entrada = jugadoresRouter.__handlers.find(([m, args]) => m === metodo && args[0] === rutaPath);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo.toUpperCase() + ' ' + rutaPath);
  return entrada[1][entrada[1].length - 1];
}
const handlerPost = handlerDe('post', '/');
const handlerPut = handlerDe('put', '/:id');
const handlerPozoAjuste = handlerDe('post', '/:id/pozo-ajuste');
const handlerPozoAjustes = handlerDe('get', '/:id/pozo-ajustes');

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

function reqBase(grupoId) {
  return { grupoId, nombreActor: 'Zenyatta', params: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) Ajuste positivo sobre PEDRO (pozo_inicial arranca en 100) ---
  const res1 = await invocarRuta(handlerPozoAjuste, Object.assign(reqBase(GRUPO_ID), { body: { monto: 50, motivo: 'Depósito extra' } }), { id: 'j-pedro' });
  check(res1._status === 200, '1) POST /:id/pozo-ajuste responde 200');
  check(res1._json.pozo_inicial === 150, 'El pozo de PEDRO queda en 150 (100 + 50), nunca se pisa el valor anterior');
  check(TABLAS.pozo_ajustes.length === 1 && TABLAS.pozo_ajustes[0].monto === 50 && TABLAS.pozo_ajustes[0].motivo === 'Depósito extra', 'Queda guardado en el historial (monto y motivo)');
  check(TABLAS.pozo_ajustes[0].pozo_resultante === 150, 'El historial guarda también el pozo resultante');
  check(TABLAS.pozo_ajustes[0].usuario === 'Zenyatta', 'El historial guarda quién hizo el ajuste (req.nombreActor)');

  // --- Ajuste negativo (disminuir) ---
  const res2 = await invocarRuta(handlerPozoAjuste, Object.assign(reqBase(GRUPO_ID), { body: { monto: -30 } }), { id: 'j-pedro' });
  check(res2._status === 200 && res2._json.pozo_inicial === 120, 'Un ajuste negativo disminuye el pozo (150 - 30 = 120)');
  check(TABLAS.pozo_ajustes.length === 2 && TABLAS.pozo_ajustes[1].motivo === null, 'El motivo es opcional — queda null si no se manda');

  // --- 2) Validaciones ---
  const resMontoCero = await invocarRuta(handlerPozoAjuste, Object.assign(reqBase(GRUPO_ID), { body: { monto: 0 } }), { id: 'j-pedro' });
  check(resMontoCero._status === 400, '2) Un ajuste de monto 0 responde 400');
  const resMontoNaN = await invocarRuta(handlerPozoAjuste, Object.assign(reqBase(GRUPO_ID), { body: { monto: 'no-es-numero' } }), { id: 'j-pedro' });
  check(resMontoNaN._status === 400, 'Un monto que no es número responde 400');
  const resJugadorNoExiste = await invocarRuta(handlerPozoAjuste, Object.assign(reqBase(GRUPO_ID), { body: { monto: 10 } }), { id: 'j-no-existe' });
  check(resJugadorNoExiste._status === 404, 'Un jugador que no existe responde 404');

  // --- 3) GET /:id/pozo-ajustes: historial más reciente primero ---
  const resHistorial = await invocarRuta(handlerPozoAjustes, reqBase(GRUPO_ID), { id: 'j-pedro' });
  check(resHistorial._status === 200 && resHistorial._json.length === 2, '3) GET /:id/pozo-ajustes trae los 2 ajustes de PEDRO');
  check(resHistorial._json[0].monto === -30 && resHistorial._json[1].monto === 50, 'Más reciente primero (-30 antes que +50)');

  // --- 4) Aval: apuntar a OTRO jugador ya existente del MISMO grupo ---
  const resPutAvalOk = await invocarRuta(handlerPut, Object.assign(reqBase(GRUPO_ID), {
    body: { nombre: 'PEDRO', tipoCuenta: 'libre', pozoInicial: 120, comisionPropia: 0, avaladoPorId: 'j-maria', porcentajeDevueltoDestino: 'aval' }
  }), { id: 'j-pedro' });
  check(resPutAvalOk._status === 200, '4) PUT con avaladoPorId apuntando a otro jugador del mismo grupo responde 200');
  check(resPutAvalOk._json.avalado_por_id === 'j-maria', 'Se guarda el aval (MARIA)');
  check(resPutAvalOk._json.porcentaje_devuelto_destino === 'aval', 'Se guarda el destino "aval"');

  // --- 5) Aval de OTRO grupo -> 400 ---
  const resPutAvalOtroGrupo = await invocarRuta(handlerPut, Object.assign(reqBase(GRUPO_ID), {
    body: { nombre: 'PEDRO', tipoCuenta: 'libre', pozoInicial: 120, comisionPropia: 0, avaladoPorId: 'j-otro-grupo' }
  }), { id: 'j-pedro' });
  check(resPutAvalOtroGrupo._status === 400, '5) PUT con avaladoPorId de OTRO grupo responde 400 (nunca cruza grupos)');

  // --- 6) Un jugador no puede ser su propio aval ---
  const resPutAvalPropio = await invocarRuta(handlerPut, Object.assign(reqBase(GRUPO_ID), {
    body: { nombre: 'PEDRO', tipoCuenta: 'libre', pozoInicial: 120, comisionPropia: 0, avaladoPorId: 'j-pedro' }
  }), { id: 'j-pedro' });
  check(resPutAvalPropio._status === 400, '6) PUT con avaladoPorId = el propio jugador responde 400');

  // --- 7) porcentajeDevueltoDestino: normalización ---
  const resPostDestinoInvalido = await invocarRuta(handlerPost, Object.assign(reqBase(GRUPO_ID), {
    body: { nombre: 'CARLOS', comisionPropia: 0, porcentajeDevueltoDestino: 'lo-que-sea' }
  }));
  check(resPostDestinoInvalido._status === 201 && resPostDestinoInvalido._json.porcentaje_devuelto_destino === 'cliente', '7) Un valor inválido de porcentajeDevueltoDestino se normaliza a "cliente"');
  const resPostSinDestino = await invocarRuta(handlerPost, Object.assign(reqBase(GRUPO_ID), { body: { nombre: 'ANA', comisionPropia: 0 } }));
  check(resPostSinDestino._json.porcentaje_devuelto_destino === 'cliente' && resPostSinDestino._json.avalado_por_id === null, 'Sin mandar ninguno de los 2 campos, quedan en sus valores por defecto (cliente / sin aval)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de jugadores/pozo-aval se cayó con una excepción:', e);
  process.exit(1);
});
