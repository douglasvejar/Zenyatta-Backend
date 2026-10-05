// =================================================================
// PRUEBA: "Revisar % Automáticos" (02-10-2026, a pedido explícito del
// usuario tras el rediseño de "elegir ficha a mano": "Quiero revisarlas
// todas ya" — ver la nota grande en src/routes/jugadores.js, sección
// "REVISAR % AUTOMÁTICOS").
//
// GET /api/jugadores/revisar-comisiones-automaticas: lista 1) cada cliente
// real con % propio configurado (comision_propia > 0) y el toggle
// "incluir % en sus jugadas" en OFF, con la ficha donde cae HOY (o null si
// nunca se resolvió); 2) cada fila de jugadores_avales_porcentaje, con la
// ficha donde cae HOY. Casos cubiertos:
//   1. PEDRO (3%, toggle OFF, cuenta_comision_id=null) aparece con
//      fichaId/fichaNombre = null (nunca se resolvió todavía).
//   2. LUIS (2%, toggle OFF, ya resuelto a "LUIS - PORCENTAJE") aparece
//      con esa ficha.
//   3. ANA (comision_propia=0) NO aparece.
//   4. CARLOS (5%, toggle ON) NO aparece (su % ya va directo en sus
//      propias jugadas, nunca en una ficha aparte).
//   5. El aval de MARIO hacia "DESTINO" aparece en la lista de avales.
//
// POST /api/jugadores/confirmar-ficha-comision: confirma/renombra UNO a
// la vez. Casos cubiertos:
//   6. tipo:'propio' con una ficha nueva -> la crea y enlaza
//      cuenta_comision_id.
//   7. tipo:'propio' con el propio nombre del cliente -> 400 (hay que usar
//      el toggle, no esto).
//   8. tipo:'aval' con una ficha nueva -> la crea y enlaza avalador_id.
//   9. tipo:'aval' con el nombre de quien GENERA el % -> 400.
//   10. id que no existe -> 404 (en ambos tipos).
//   11. fichaNombre vacío -> 400. tipo inválido -> 400.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-revisar-1';
const TABLAS = {
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 3, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false },
    { id: 'j-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 2, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: 'cta-luis', es_cuenta_comision: false },
    { id: 'cta-luis', grupo_id: GRUPO_ID, nombre: 'LUIS - PORCENTAJE', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: true },
    { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false },
    { id: 'j-carlos', grupo_id: GRUPO_ID, nombre: 'CARLOS', comision_propia: 5, incluir_porcentaje_en_jugadas: true, cuenta_comision_id: null, es_cuenta_comision: false },
    { id: 'j-mario', grupo_id: GRUPO_ID, nombre: 'MARIO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false },
    { id: 'j-destino', grupo_id: GRUPO_ID, nombre: 'DESTINO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false }
  ],
  jugadores_avales_porcentaje: [
    { id: 'aval-1', grupo_id: GRUPO_ID, jugador_id: 'j-mario', avalador_id: 'j-destino', porcentaje: 2 }
  ]
};
let seq = 1;
const nuevoId = (prefijo) => prefijo + '-' + (seq++);

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- GET /revisar-comisiones-automaticas ----
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, j\.cuenta_comision_id, cc\.nombre AS ficha_nombre\s+FROM jugadores j\s+LEFT JOIN jugadores cc ON cc\.id = j\.cuenta_comision_id\s+WHERE j\.grupo_id = \$1\s+AND NOT COALESCE\(j\.es_cuenta_comision, false\)\s+AND j\.comision_propia > 0\s+AND NOT COALESCE\(j\.incluir_porcentaje_en_jugadas, false\)/i.test(sql)) {
    const [grupoId] = params;
    const porId = new Map(TABLAS.jugadores.map(j => [j.id, j]));
    const filas = TABLAS.jugadores.filter(j =>
      j.grupo_id === grupoId && !j.es_cuenta_comision && Number(j.comision_propia) > 0 && !j.incluir_porcentaje_en_jugadas
    );
    return {
      rows: filas.map(j => {
        const cc = j.cuenta_comision_id ? porId.get(j.cuenta_comision_id) : null;
        return { id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cuenta_comision_id: j.cuenta_comision_id, ficha_nombre: cc ? cc.nombre : null };
      })
    };
  }
  if (/^SELECT jap\.id, jap\.jugador_id, j\.nombre AS jugador_nombre, jap\.porcentaje,\s*jap\.avalador_id, av\.nombre AS avalador_nombre\s+FROM jugadores_avales_porcentaje jap\s+JOIN jugadores j ON j\.id = jap\.jugador_id\s+JOIN jugadores av ON av\.id = jap\.avalador_id\s+WHERE jap\.grupo_id = \$1/i.test(sql)) {
    const [grupoId] = params;
    const porId = new Map(TABLAS.jugadores.map(j => [j.id, j]));
    const filas = TABLAS.jugadores_avales_porcentaje.filter(a => a.grupo_id === grupoId);
    return {
      rows: filas.map(a => ({
        id: a.id, jugador_id: a.jugador_id, jugador_nombre: porId.get(a.jugador_id).nombre,
        porcentaje: a.porcentaje, avalador_id: a.avalador_id, avalador_nombre: porId.get(a.avalador_id).nombre
      }))
    };
  }

  // ---- POST /confirmar-ficha-comision (tipo:'aval') ----
  if (/^SELECT jap\.id, jap\.jugador_id, j\.nombre AS jugador_nombre\s+FROM jugadores_avales_porcentaje jap\s+JOIN jugadores j ON j\.id = jap\.jugador_id\s+WHERE jap\.id = \$1 AND jap\.grupo_id = \$2/i.test(sql)) {
    const [id, grupoId] = params;
    const aval = TABLAS.jugadores_avales_porcentaje.find(a => a.id === id && a.grupo_id === grupoId);
    if (!aval) return { rows: [] };
    const jugador = TABLAS.jugadores.find(j => j.id === aval.jugador_id);
    return { rows: [{ id: aval.id, jugador_id: aval.jugador_id, jugador_nombre: jugador.nombre }] };
  }
  if (/^UPDATE jugadores_avales_porcentaje SET avalador_id = \$1 WHERE id = \$2 AND grupo_id = \$3/i.test(sql)) {
    const [avaladorId, id, grupoId] = params;
    const aval = TABLAS.jugadores_avales_porcentaje.find(a => a.id === id && a.grupo_id === grupoId);
    if (aval) aval.avalador_id = avaladorId;
    return { rows: [] };
  }

  // ---- POST /confirmar-ficha-comision (tipo:'propio') ----
  if (/^SELECT id, nombre FROM jugadores WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === id && x.grupo_id === grupoId);
    return { rows: j ? [{ id: j.id, nombre: j.nombre }] : [] };
  }
  if (/^UPDATE jugadores SET cuenta_comision_id = \$1 WHERE id = \$2 AND grupo_id = \$3$/i.test(sql)) {
    const [cuentaId, id, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === id && x.grupo_id === grupoId);
    if (j) j.cuenta_comision_id = cuentaId;
    return { rows: [] };
  }

  // ---- buscarOCrearFicha (services/hipismoComisionPropia.js) ----
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

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (revisar-comisiones-automaticas) no sabe responder: ' + sql);
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
const handlerGetRevisar = handlerDe('get', '/revisar-comisiones-automaticas');
const handlerPostConfirmar = handlerDe('post', '/confirmar-ficha-comision');

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

function reqBase(grupoId) {
  return { grupoId, params: {}, query: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1-5) GET /revisar-comisiones-automaticas ---
  const resGet = await invocarRuta(handlerGetRevisar, reqBase(GRUPO_ID));
  check(resGet._status === 200, '1) GET /revisar-comisiones-automaticas responde 200');

  const propios = resGet._json.propios;
  const pedro = propios.find(p => p.nombre === 'PEDRO');
  check(!!pedro && pedro.fichaId === null && pedro.fichaNombre === null,
    '2) PEDRO (3%, nunca resuelto) aparece con fichaId/fichaNombre = null');
  const luis = propios.find(p => p.nombre === 'LUIS');
  check(!!luis && luis.fichaId === 'cta-luis' && luis.fichaNombre === 'LUIS - PORCENTAJE',
    '3) LUIS (2%, ya resuelto) aparece con su ficha actual "LUIS - PORCENTAJE"');
  check(!propios.some(p => p.nombre === 'ANA'), '4) ANA (comision_propia=0) NO aparece en "propios"');
  check(!propios.some(p => p.nombre === 'CARLOS'), '5) CARLOS (toggle ON) NO aparece en "propios" (su % ya va directo en sus jugadas)');

  const avales = resGet._json.avales;
  check(avales.length === 1 && avales[0].jugadorNombre === 'MARIO' && avales[0].fichaNombre === 'DESTINO' && avales[0].porcentaje === 2,
    '6) El aval de MARIO -> DESTINO (2%) aparece en la lista de avales');

  // --- 7) POST confirmar-ficha-comision, tipo:'propio', ficha nueva ---
  const resConfirmaPropio = await invocarRuta(handlerPostConfirmar, Object.assign(reqBase(GRUPO_ID), {
    body: { tipo: 'propio', id: 'j-pedro', fichaNombre: 'PEDRO - PERSONAL' }
  }));
  check(resConfirmaPropio._status === 200, '7) POST confirmar-ficha-comision (propio, ficha nueva) responde 200');
  check(resConfirmaPropio._json.fichaNombre === 'PEDRO - PERSONAL' && resConfirmaPropio._json.esNuevo === true,
    'Crea la ficha nueva "PEDRO - PERSONAL" (esNuevo=true)');
  const pedroActualizado = TABLAS.jugadores.find(j => j.id === 'j-pedro');
  check(pedroActualizado.cuenta_comision_id === resConfirmaPropio._json.fichaId,
    'Queda enlazada en jugadores.cuenta_comision_id de PEDRO');

  // --- 8) tipo:'propio' con su propio nombre -> 400 ---
  const resConfirmaPropioMismo = await invocarRuta(handlerPostConfirmar, Object.assign(reqBase(GRUPO_ID), {
    body: { tipo: 'propio', id: 'j-pedro', fichaNombre: 'PEDRO' }
  }));
  check(resConfirmaPropioMismo._status === 400, '8) POST confirmar-ficha-comision (propio) con su propio nombre responde 400 (hay que usar el toggle)');

  // --- 9) POST confirmar-ficha-comision, tipo:'aval', ficha nueva ---
  const resConfirmaAval = await invocarRuta(handlerPostConfirmar, Object.assign(reqBase(GRUPO_ID), {
    body: { tipo: 'aval', id: 'aval-1', fichaNombre: 'DESTINO NUEVO' }
  }));
  check(resConfirmaAval._status === 200, '9) POST confirmar-ficha-comision (aval, ficha nueva) responde 200');
  check(resConfirmaAval._json.fichaNombre === 'DESTINO NUEVO' && resConfirmaAval._json.esNuevo === true,
    'Crea la ficha nueva "DESTINO NUEVO" (esNuevo=true)');
  const avalActualizado = TABLAS.jugadores_avales_porcentaje.find(a => a.id === 'aval-1');
  check(avalActualizado.avalador_id === resConfirmaAval._json.fichaId, 'Queda enlazado en jugadores_avales_porcentaje.avalador_id');

  // --- 10) tipo:'aval' con el nombre de quien GENERA el % -> 400 ---
  const resConfirmaAvalMismo = await invocarRuta(handlerPostConfirmar, Object.assign(reqBase(GRUPO_ID), {
    body: { tipo: 'aval', id: 'aval-1', fichaNombre: 'MARIO' }
  }));
  check(resConfirmaAvalMismo._status === 400, '10) POST confirmar-ficha-comision (aval) con el nombre de quien genera el % responde 400');

  // --- 11) id que no existe -> 404 (ambos tipos) ---
  const resPropioNoExiste = await invocarRuta(handlerPostConfirmar, Object.assign(reqBase(GRUPO_ID), {
    body: { tipo: 'propio', id: 'no-existe', fichaNombre: 'LO QUE SEA' }
  }));
  check(resPropioNoExiste._status === 404, '11a) tipo:propio con id que no existe responde 404');
  const resAvalNoExiste = await invocarRuta(handlerPostConfirmar, Object.assign(reqBase(GRUPO_ID), {
    body: { tipo: 'aval', id: 'no-existe', fichaNombre: 'LO QUE SEA' }
  }));
  check(resAvalNoExiste._status === 404, '11b) tipo:aval con id que no existe responde 404');

  // --- 12) fichaNombre vacío -> 400; tipo inválido -> 400 ---
  const resSinFicha = await invocarRuta(handlerPostConfirmar, Object.assign(reqBase(GRUPO_ID), {
    body: { tipo: 'propio', id: 'j-luis', fichaNombre: '   ' }
  }));
  check(resSinFicha._status === 400, '12a) fichaNombre vacío responde 400');
  const resTipoInvalido = await invocarRuta(handlerPostConfirmar, Object.assign(reqBase(GRUPO_ID), {
    body: { tipo: 'lo-que-sea', id: 'j-luis', fichaNombre: 'ALGO' }
  }));
  check(resTipoInvalido._status === 400, '12b) tipo inválido responde 400');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de revisar-comisiones-automaticas se cayó con una excepción:', e);
  process.exit(1);
});
