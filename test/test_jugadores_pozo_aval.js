// =================================================================
// PRUEBA: Ajuste de Pozo (+/- con motivo, historial) y "varios avaladores
// con %" en jugadores.js (23-09-2026, duodécima-tercera ronda, a pedido
// del usuario: "desde pozo necesito seleccionar el cliente y editar el
// pozo, aumentarlo diminuirlo etc" -> respondió "Ajuste +/- con motivo"
// cuando se le preguntó cómo debía funcionar; y "en la pestaña clientes
// quiero... si el porcentaje que se le devuelve no es para el si no
// para su aval" -> respondió "Otro cliente ya existente" cuando se le
// preguntó qué es un aval). Ver la nota grande en sql/schema.sql (tablas
// pozo_ajustes, jugadores_avales_porcentaje) y en src/routes/jugadores.js.
//
// 28-09-2026: el modelo de aval pasó de UN solo avalado_por_id/
// porcentaje_devuelto_destino a VARIOS avaladores con % cada uno (tabla
// jugadores_avales_porcentaje) — las pruebas 4-7 de más abajo se
// actualizan para probar el modelo nuevo (mismas reglas de validación:
// otro jugador del mismo grupo, nunca de otro grupo, nunca el propio
// jugador, nunca repetido).
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
//   4. PUT /jugadores con avalesPorcentaje=[{avaladorId: OTRO jugador ya
//      existente del MISMO grupo, porcentaje}] -> se guarda.
//   5. avalesPorcentaje con avaladorId de un jugador de OTRO grupo -> 400
//      (nunca cruza grupos).
//   6. avalesPorcentaje con avaladorId = el propio jugador que se está
//      editando -> 400 (no puede ser su propio avalador).
//   7. avalesPorcentaje con el MISMO avaladorId repetido en 2 filas ->
//      400; con 2 avaladores DISTINTOS -> se guardan los 2.
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-pozo-1';
const OTRO_GRUPO_ID = 'grupo-pozo-2';
const TABLAS = {
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', pozo_inicial: 100 },
    { id: 'j-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', pozo_inicial: 0 },
    { id: 'j-carlos', grupo_id: GRUPO_ID, nombre: 'CARLOS', pozo_inicial: 0 },
    { id: 'j-otro-grupo', grupo_id: OTRO_GRUPO_ID, nombre: 'EXTRANJERO', pozo_inicial: 0 }
  ],
  pozo_ajustes: [],
  jugadores_avales_porcentaje: []
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

  // ---- buscarOCrearFicha (normalizarAvalesPorcentaje / resolverCuentaComisionPropiaId,
  // 02-10-2026, ver la nota grande en services/hipismoComisionPropia.js) ----
  if (/^SELECT id, nombre, es_cuenta_comision FROM jugadores WHERE grupo_id = \$1$/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId);
    return { rows: filas.map(j => ({ id: j.id, nombre: j.nombre, es_cuenta_comision: !!j.es_cuenta_comision })) };
  }
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial, es_cuenta_comision\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    let cuenta = TABLAS.jugadores.find(j => j.grupo_id === grupoId && j.nombre === nombre);
    if (!cuenta) {
      cuenta = { id: nuevoId('cta'), grupo_id: grupoId, nombre, activo: true, auto_creado: true, tipo_cuenta: 'libre', pozo_inicial: 0, es_cuenta_comision: true };
      TABLAS.jugadores.push(cuenta);
    } else {
      cuenta.es_cuenta_comision = true;
    }
    return { rows: [{ id: cuenta.id, nombre: cuenta.nombre }] };
  }
  // ---- reemplazarAvalesPorcentaje ----
  if (/^DELETE FROM jugadores_avales_porcentaje WHERE grupo_id = \$1 AND jugador_id = \$2$/i.test(sql)) {
    const [grupoId, jugadorId] = params;
    TABLAS.jugadores_avales_porcentaje = TABLAS.jugadores_avales_porcentaje.filter(a => !(a.grupo_id === grupoId && a.jugador_id === jugadorId));
    return { rows: [] };
  }
  if (/^INSERT INTO jugadores_avales_porcentaje \(grupo_id, jugador_id, avalador_id, porcentaje\)/i.test(sql)) {
    const [grupoId, jugadorId, avaladorId, porcentaje] = params;
    TABLAS.jugadores_avales_porcentaje.push({ grupo_id: grupoId, jugador_id: jugadorId, avalador_id: avaladorId, porcentaje });
    return { rows: [] };
  }

  // ---- POST /jugadores ----
  if (/^INSERT INTO jugadores \(grupo_id, nombre, telefono, notas, activo, tipo_cuenta, pozo_inicial, comision_propia, modelo_comision, moneda, modulos_anclados, incluir_porcentaje_en_jugadas, cuenta_comision_id\)/i.test(sql)) {
    const [grupoId, nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados, incluirPorcentajeEnJugadas, cuentaComisionId] = params;
    if (TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      const err = new Error('duplicado'); err.code = '23505'; throw err;
    }
    const fila = {
      id: nuevoId('j'), grupo_id: grupoId, nombre, telefono, notas, activo, tipo_cuenta: tipoCuenta,
      pozo_inicial: pozoInicial, comision_propia: comisionPropia, modelo_comision: modeloComision, moneda,
      modulos_anclados: modulosAnclados, incluir_porcentaje_en_jugadas: incluirPorcentajeEnJugadas, cuenta_comision_id: cuentaComisionId || null
    };
    TABLAS.jugadores.push(fila);
    return { rows: [fila] };
  }
  // ---- PUT /jugadores/:id ----
  if (/^UPDATE jugadores SET nombre = \$1, telefono = \$2, notas = \$3, activo = \$4, tipo_cuenta = \$5,\s*pozo_inicial = \$6, comision_propia = \$7, modelo_comision = \$8, moneda = \$9, auto_creado = false, modulos_anclados = \$10,\s*incluir_porcentaje_en_jugadas = \$11, cuenta_comision_id = \$12\s*WHERE id = \$13 AND grupo_id = \$14/i.test(sql)) {
    const [nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados, incluirPorcentajeEnJugadas, cuentaComisionId, id, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === id && x.grupo_id === grupoId);
    if (!j) return { rows: [] };
    Object.assign(j, { nombre, telefono, notas, activo, tipo_cuenta: tipoCuenta, pozo_inicial: pozoInicial, comision_propia: comisionPropia, modelo_comision: modeloComision, moneda, modulos_anclados: modulosAnclados, incluir_porcentaje_en_jugadas: incluirPorcentajeEnJugadas, cuenta_comision_id: cuentaComisionId || null });
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

  // --- 4) avalesPorcentaje (02-10-2026, rediseño "elegir ficha a mano": ya
  // no se manda avaladorId de un <select>, se escribe fichaNombre y el
  // backend la busca-o-crea con buscarOCrearFicha, ver la nota grande en
  // services/hipismoComisionPropia.js) -- acá MARIA ya existe como cliente
  // real del MISMO grupo, así que se encuentra y se usa su id tal cual ---
  const resPutAvalOk = await invocarRuta(handlerPut, Object.assign(reqBase(GRUPO_ID), {
    body: { nombre: 'PEDRO', tipoCuenta: 'libre', pozoInicial: 120, comisionPropia: 0, avalesPorcentaje: [{ fichaNombre: 'MARIA', porcentaje: 1 }] }
  }), { id: 'j-pedro' });
  check(resPutAvalOk._status === 200, '4) PUT con avalesPorcentaje (fichaNombre) apuntando a otro cliente ya existente del mismo grupo responde 200');
  check(resPutAvalOk._json.avalesPorcentaje.length === 1 && resPutAvalOk._json.avalesPorcentaje[0].avaladorId === 'j-maria' && resPutAvalOk._json.avalesPorcentaje[0].porcentaje === 1, 'Se guarda el avalador (MARIA) con su %, resuelto a su id real (no se crea una ficha nueva, ya existía)');
  check(TABLAS.jugadores_avales_porcentaje.some(a => a.jugador_id === 'j-pedro' && a.avalador_id === 'j-maria' && a.porcentaje === 1), 'Queda insertado en jugadores_avales_porcentaje');

  // --- 5) avalesPorcentaje con un nombre que coincide con un cliente de
  // OTRO grupo -> buscarOCrearFicha busca SOLO dentro de este grupo
  // (nunca cruza grupos), así que en vez de reusar a "EXTRANJERO" del otro
  // grupo, crea una ficha NUEVA con ese nombre acá mismo ---
  const resPutAvalOtroGrupo = await invocarRuta(handlerPut, Object.assign(reqBase(GRUPO_ID), {
    body: { nombre: 'PEDRO', tipoCuenta: 'libre', pozoInicial: 120, comisionPropia: 0, avalesPorcentaje: [{ fichaNombre: 'EXTRANJERO', porcentaje: 1 }] }
  }), { id: 'j-pedro' });
  check(resPutAvalOtroGrupo._status === 200, '5) PUT con fichaNombre que coincide con un cliente de OTRO grupo responde 200 (no es un error)');
  const avalExtranjero = resPutAvalOtroGrupo._json.avalesPorcentaje[0];
  check(!!avalExtranjero && avalExtranjero.avaladorId !== 'j-otro-grupo', 'Nunca cruza grupos: NO reusa el id de "EXTRANJERO" del otro grupo');
  check(TABLAS.jugadores.some(j => j.id === avalExtranjero.avaladorId && j.grupo_id === GRUPO_ID && j.nombre === 'EXTRANJERO' && j.es_cuenta_comision), 'En vez de eso, crea una ficha NUEVA llamada "EXTRANJERO" dentro de ESTE grupo');

  // --- 6) Un cliente no puede mandarle el % a su propia ficha por esta vía
  // (para eso está "Incluir % en sus jugadas" / comisionPropiaFicha) ---
  const resPutAvalPropio = await invocarRuta(handlerPut, Object.assign(reqBase(GRUPO_ID), {
    body: { nombre: 'PEDRO', tipoCuenta: 'libre', pozoInicial: 120, comisionPropia: 0, avalesPorcentaje: [{ fichaNombre: 'PEDRO', porcentaje: 1 }] }
  }), { id: 'j-pedro' });
  check(resPutAvalPropio._status === 400, '6) PUT con avalesPorcentaje.fichaNombre = su propio nombre responde 400');

  // --- 7) Varios avaladores a la vez (28-09-2026, a pedido del usuario:
  // "un cliente puede generarle 2% por darte un ejemplo repartido en
  // varias personas") + rechazo de la MISMA ficha escrita 2 veces ---
  const resPutDosAvales = await invocarRuta(handlerPut, Object.assign(reqBase(GRUPO_ID), {
    body: { nombre: 'PEDRO', tipoCuenta: 'libre', pozoInicial: 120, comisionPropia: 0, avalesPorcentaje: [{ fichaNombre: 'MARIA', porcentaje: 1 }, { fichaNombre: 'CARLOS', porcentaje: 1 }] }
  }), { id: 'j-pedro' });
  check(resPutDosAvales._status === 200 && resPutDosAvales._json.avalesPorcentaje.length === 2, '7) PUT con 2 fichas distintas (MARIA y CARLOS) guarda los 2');
  check(TABLAS.jugadores_avales_porcentaje.filter(a => a.jugador_id === 'j-pedro').length === 2, 'La fila vieja (solo MARIA) se reemplazó por las 2 nuevas, no se acumulan');

  const resPutAvalRepetido = await invocarRuta(handlerPut, Object.assign(reqBase(GRUPO_ID), {
    body: { nombre: 'PEDRO', tipoCuenta: 'libre', pozoInicial: 120, comisionPropia: 0, avalesPorcentaje: [{ fichaNombre: 'MARIA', porcentaje: 1 }, { fichaNombre: 'maria', porcentaje: 1 }] }
  }), { id: 'j-pedro' });
  check(resPutAvalRepetido._status === 400, 'PUT con la MISMA ficha escrita 2 veces (sin importar mayúsculas) responde 400 (hay que juntar el % en una sola fila)');

  // --- Sin mandar avalesPorcentaje: queda vacío, sin romper nada (retrocompatible) ---
  const resPostSinAvales = await invocarRuta(handlerPost, Object.assign(reqBase(GRUPO_ID), { body: { nombre: 'ANA', comisionPropia: 0 } }));
  check(resPostSinAvales._status === 201 && Array.isArray(resPostSinAvales._json.avalesPorcentaje) && resPostSinAvales._json.avalesPorcentaje.length === 0, 'POST sin avalesPorcentaje crea el cliente con la lista vacía, sin romper nada');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de jugadores/pozo-aval se cayó con una excepción:', e);
  process.exit(1);
});
