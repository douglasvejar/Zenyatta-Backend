// =================================================================
// PRUEBA: 💳 Pagos (15-09-2026, a pedido del usuario: "cada grupo debe
// pagar el servicio, el pago es semanal") — cubre las 2 mitades del
// flujo, con una base de datos falsa en memoria, mismo patrón que
// test_whatsapp_rutas_grupo.js / test_superadmin_logo.js:
//
//   - src/routes/pagos.js (el Grupo reporta un pago): validaciones de
//     POST / (fecha, método, captura, tope de 4MB), el happy path deja
//     una fila 'pendiente' con el grupo_id correcto, GET / solo trae
//     las filas de ESE grupo (nunca las de otro) y nunca trae
//     captura_base64, y GET /:id/captura da 404 tanto si el id no
//     existe como si es de OTRO grupo (nunca confirma cuál existe).
//   - src/routes/superadmin.js (Súper-admin revisa): GET /pagos trae
//     TODAS las filas de TODOS los grupos con el nombre del grupo,
//     GET /pagos/:id/captura sin restricción de grupo_id,
//     conteo-pendientes cuenta bien, confirmar/rechazar cambian el
//     estado y fijan revisado_en, y dan 404 sobre un id que no existe.
//   - Que requiereGrupo/requiereSuperadmin de verdad bloquean estas
//     rutas sin token (401), invocando el middleware REAL registrado
//     con router.use(...) en cada archivo (no un req ya armado a mano
//     con grupoId, como en el resto de las pruebas de acá abajo).
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_A = 'grupo-a';
const GRUPO_B = 'grupo-b';

const TABLAS = {
  grupos: [
    { id: GRUPO_A, nombre: 'Parleys Douglas', email: 'a@x.com', activo: true, whatsapp_grupo_jid: null, whatsapp_habilitado: false },
    { id: GRUPO_B, nombre: 'Deportes Zenyatta', email: 'b@x.com', activo: true, whatsapp_grupo_jid: null, whatsapp_habilitado: false }
  ],
  pagos_grupo: []
};

let CONTADOR_ID = 0;
function nuevoId() { return 'pago-' + (++CONTADOR_ID); }

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  // --- requiereGrupo (middleware/auth.js) ---
  if (/^SELECT id, nombre, email, activo, whatsapp_grupo_jid, whatsapp_habilitado FROM grupos WHERE id = \$1/i.test(sql)) {
    const [id] = params;
    const g = TABLAS.grupos.find(x => x.id === id);
    return { rows: g ? [g] : [] };
  }

  // --- routes/pagos.js: POST / ---
  if (/^INSERT INTO pagos_grupo/i.test(sql)) {
    const [grupoId, fechaPago, metodo, referencia, capturaBase64, capturaMime] = params;
    const fila = {
      id: nuevoId(),
      grupo_id: grupoId,
      fecha_pago: fechaPago,
      metodo,
      referencia,
      captura_base64: capturaBase64,
      captura_mime: capturaMime,
      estado: 'pendiente',
      nota_admin: null,
      creado_en: new Date(Date.now() + TABLAS.pagos_grupo.length).toISOString(), // orden estable, creciente
      revisado_en: null
    };
    TABLAS.pagos_grupo.push(fila);
    return { rows: [{ id: fila.id, fecha_pago: fila.fecha_pago, metodo: fila.metodo, referencia: fila.referencia, estado: fila.estado, creado_en: fila.creado_en }] };
  }

  // --- routes/pagos.js: GET / (lado del Grupo, SIN captura_base64) ---
  if (/^SELECT id, fecha_pago, metodo, referencia, estado, nota_admin, creado_en, revisado_en FROM pagos_grupo WHERE grupo_id = \$1/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.pagos_grupo.filter(p => p.grupo_id === grupoId).sort((a, b) => b.creado_en.localeCompare(a.creado_en));
    return { rows: filas.map(f => ({ id: f.id, fecha_pago: f.fecha_pago, metodo: f.metodo, referencia: f.referencia, estado: f.estado, nota_admin: f.nota_admin, creado_en: f.creado_en, revisado_en: f.revisado_en })) };
  }

  // --- routes/pagos.js: GET /:id/captura (con ownership, grupo_id incluido) ---
  if (/^SELECT captura_base64, captura_mime FROM pagos_grupo WHERE id = \$1 AND grupo_id = \$2/i.test(sql)) {
    const [id, grupoId] = params;
    const fila = TABLAS.pagos_grupo.find(p => p.id === id && p.grupo_id === grupoId);
    return { rows: fila ? [{ captura_base64: fila.captura_base64, captura_mime: fila.captura_mime }] : [] };
  }

  // --- superadmin.js: GET /pagos (TODOS los grupos, con nombre) ---
  if (/^SELECT p\.id, p\.grupo_id, g\.nombre AS grupo_nombre/i.test(sql)) {
    const filas = TABLAS.pagos_grupo.slice().sort((a, b) => b.creado_en.localeCompare(a.creado_en));
    return {
      rows: filas.map(f => {
        const grupo = TABLAS.grupos.find(g => g.id === f.grupo_id);
        return {
          id: f.id, grupo_id: f.grupo_id, grupo_nombre: grupo ? grupo.nombre : '???',
          fecha_pago: f.fecha_pago, metodo: f.metodo, referencia: f.referencia, estado: f.estado,
          nota_admin: f.nota_admin, creado_en: f.creado_en, revisado_en: f.revisado_en
        };
      })
    };
  }

  // --- superadmin.js: GET /pagos/:id/captura (SIN restricción de grupo) ---
  if (/^SELECT captura_base64, captura_mime FROM pagos_grupo WHERE id = \$1$/i.test(sql)) {
    const [id] = params;
    const fila = TABLAS.pagos_grupo.find(p => p.id === id);
    return { rows: fila ? [{ captura_base64: fila.captura_base64, captura_mime: fila.captura_mime }] : [] };
  }

  // --- superadmin.js: GET /pagos/conteo-pendientes ---
  if (/^SELECT COUNT\(\*\)::int AS total FROM pagos_grupo WHERE estado = 'pendiente'/i.test(sql)) {
    return { rows: [{ total: TABLAS.pagos_grupo.filter(p => p.estado === 'pendiente').length }] };
  }

  // --- superadmin.js: POST /pagos/:id/confirmar ---
  if (/^UPDATE pagos_grupo SET estado = 'confirmado', nota_admin = \$1, revisado_en = now\(\) WHERE id = \$2/i.test(sql)) {
    const [notaAdmin, id] = params;
    const fila = TABLAS.pagos_grupo.find(p => p.id === id);
    if (!fila) return { rowCount: 0, rows: [] };
    fila.estado = 'confirmado';
    fila.nota_admin = notaAdmin;
    fila.revisado_en = new Date().toISOString();
    return { rowCount: 1, rows: [] };
  }

  // --- superadmin.js: POST /pagos/:id/rechazar ---
  if (/^UPDATE pagos_grupo SET estado = 'rechazado', nota_admin = \$1, revisado_en = now\(\) WHERE id = \$2/i.test(sql)) {
    const [notaAdmin, id] = params;
    const fila = TABLAS.pagos_grupo.find(p => p.id === id);
    if (!fila) return { rowCount: 0, rows: [] };
    fila.estado = 'rechazado';
    fila.nota_admin = notaAdmin;
    fila.revisado_en = new Date().toISOString();
    return { rowCount: 1, rows: [] };
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
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_A }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';
process.env.SUPERADMIN_SECRET = 'fake-secret';

const pagosRouter = require(path.join(__dirname, '..', 'src', 'routes', 'pagos'));
const superadminRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin'));

Module._load = originalLoad;

function handlerDe(router, metodo, ruta) {
  const entrada = router.__handlers.find(([m, args]) => m === metodo && args[0] === ruta);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo + ' ' + ruta);
  return entrada[1][entrada[1].length - 1];
}
function middlewareDe(router) {
  // router.use(fn) — el 'use' de arriba de cada archivo (requiereGrupo o
  // requiereSuperadmin, según el router).
  const entrada = router.__handlers.find(([m]) => m === 'use');
  return entrada[1][0];
}

const requiereGrupoReal = middlewareDe(pagosRouter);
const requiereSuperadminReal = middlewareDe(superadminRouter);

const handlerPostPagos = handlerDe(pagosRouter, 'post', '/');
const handlerGetPagos = handlerDe(pagosRouter, 'get', '/');
const handlerGetCaptura = handlerDe(pagosRouter, 'get', '/:id/captura');

const handlerGetPagosSA = handlerDe(superadminRouter, 'get', '/pagos');
const handlerGetCapturaSA = handlerDe(superadminRouter, 'get', '/pagos/:id/captura');
const handlerConteoPendientesSA = handlerDe(superadminRouter, 'get', '/pagos/conteo-pendientes');
const handlerConfirmarSA = handlerDe(superadminRouter, 'post', '/pagos/:id/confirmar');
const handlerRechazarSA = handlerDe(superadminRouter, 'post', '/pagos/:id/rechazar');

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res._sent = null;
    res._headers = {};
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    res.set = (nombre, valor) => { res._headers[nombre] = valor; return res; };
    res.send = (body) => { res._sent = body; resolve(res); return res; };
    res.end = () => { resolve(res); return res; };
    Promise.resolve(handler(req, res, (err) => { if (err) reject(err); })).catch(reject);
  });
}

function reqPara(grupoId, extra) {
  return Object.assign({ grupoId, params: {}, query: {}, body: {}, headers: {} }, extra || {});
}

const CAPTURA_CHICA_BASE64 = Buffer.from('esto-es-una-imagen-de-mentira').toString('base64'); // ~30 bytes, muy por debajo del tope

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // =================================================================
  // GATING: sin token, requiereGrupo/requiereSuperadmin cortan ANTES
  // de llegar a ningún handler (se invoca el middleware real, no un req
  // ya armado a mano).
  // =================================================================
  const rGrupoSinToken = await invocarRuta(requiereGrupoReal, { headers: {} });
  check(rGrupoSinToken._status === 401, 'requiereGrupo sin token da 401 (routes/pagos.js queda protegido de verdad)');

  const rSuperadminSinToken = await invocarRuta(requiereSuperadminReal, { headers: {} });
  check(rSuperadminSinToken._status === 401, 'requiereSuperadmin sin token da 401 (las rutas /pagos de superadmin.js quedan protegidas de verdad)');

  // =================================================================
  // POST /api/pagos — validaciones
  // =================================================================
  const rSinFecha = await invocarRuta(handlerPostPagos, reqPara(GRUPO_A, { body: { metodo: 'binance', capturaBase64: CAPTURA_CHICA_BASE64 } }));
  check(rSinFecha._status === 400, 'POST / sin fechaPago da 400');

  const rMetodoInvalido = await invocarRuta(handlerPostPagos, reqPara(GRUPO_A, { body: { fechaPago: '2026-09-15', metodo: 'paypal', capturaBase64: CAPTURA_CHICA_BASE64 } }));
  check(rMetodoInvalido._status === 400, 'POST / con un método fuera de la lista (ej. "paypal") da 400');

  const rSinCaptura = await invocarRuta(handlerPostPagos, reqPara(GRUPO_A, { body: { fechaPago: '2026-09-15', metodo: 'binance' } }));
  check(rSinCaptura._status === 400, 'POST / sin capturaBase64 da 400');

  const rMimeInvalido = await invocarRuta(handlerPostPagos, reqPara(GRUPO_A, { body: { fechaPago: '2026-09-15', metodo: 'binance', capturaBase64: CAPTURA_CHICA_BASE64, capturaMime: 'application/pdf' } }));
  check(rMimeInvalido._status === 400, 'POST / con capturaMime que no empieza con "image/" da 400');

  // 4MB + 1 byte decodificado, codificado a base64 — tiene que rechazarse.
  const bufferGrande = Buffer.alloc(4 * 1024 * 1024 + 1, 1);
  const rCapturaGrande = await invocarRuta(handlerPostPagos, reqPara(GRUPO_A, { body: { fechaPago: '2026-09-15', metodo: 'binance', capturaBase64: bufferGrande.toString('base64') } }));
  check(rCapturaGrande._status === 400, 'POST / con una captura de más de 4MB decodificados da 400 (nunca se llega a insertar)');
  check(TABLAS.pagos_grupo.length === 0, 'ninguno de los rechazos de arriba insertó una fila de verdad');

  // Exactamente 4MB decodificados — en el límite, tiene que ACEPTARSE.
  const bufferJustoEnElTope = Buffer.alloc(4 * 1024 * 1024, 1);
  const rCapturaJustoEnElTope = await invocarRuta(handlerPostPagos, reqPara(GRUPO_A, { body: { fechaPago: '2026-09-15', metodo: 'binance', capturaBase64: bufferJustoEnElTope.toString('base64') } }));
  check(rCapturaJustoEnElTope._status === 201, 'POST / con una captura de EXACTAMENTE 4MB decodificados sí se acepta (el tope es ">4MB", no ">=4MB")');
  TABLAS.pagos_grupo.length = 0; // se limpia para no interferir con los casos de abajo

  // =================================================================
  // POST /api/pagos — happy path
  // =================================================================
  const rCreado = await invocarRuta(handlerPostPagos, reqPara(GRUPO_A, {
    body: { fechaPago: '2026-09-15', metodo: 'pago_movil', referencia: 'últimos 4: 5695', capturaBase64: CAPTURA_CHICA_BASE64, capturaMime: 'image/jpeg' }
  }));
  check(rCreado._status === 201, 'POST / con datos válidos responde 201');
  check(rCreado._json.estado === 'pendiente', 'la fila creada queda en estado "pendiente"');
  check(rCreado._json.metodo === 'pago_movil', 'la respuesta trae el método guardado');
  check(rCreado._json.captura_base64 === undefined && rCreado._json.capturaBase64 === undefined, 'la respuesta de POST / NUNCA re-manda la captura (base64) de vuelta');
  check(TABLAS.pagos_grupo.length === 1 && TABLAS.pagos_grupo[0].grupo_id === GRUPO_A, 'la fila quedó guardada de verdad, con el grupo_id de quien la reportó (req.grupoId), no uno inventado por el body');

  // Un segundo pago del MISMO grupo, y uno de OTRO grupo — para las
  // pruebas de aislamiento de abajo (GET / y GET /:id/captura).
  const rCreado2 = await invocarRuta(handlerPostPagos, reqPara(GRUPO_A, {
    body: { fechaPago: '2026-09-16', metodo: 'zelle', capturaBase64: CAPTURA_CHICA_BASE64 }
  }));
  check(rCreado2._status === 201, 'segundo pago del mismo grupo también se crea bien');

  const rCreadoOtroGrupo = await invocarRuta(handlerPostPagos, reqPara(GRUPO_B, {
    body: { fechaPago: '2026-09-15', metodo: 'binance', capturaBase64: CAPTURA_CHICA_BASE64 }
  }));
  check(rCreadoOtroGrupo._status === 201, 'un pago de OTRO grupo (grupo B) también se crea bien');

  // =================================================================
  // GET /api/pagos — solo las propias, nunca la captura
  // =================================================================
  const rListaA = await invocarRuta(handlerGetPagos, reqPara(GRUPO_A));
  check(rListaA._json.length === 2, 'GET / del grupo A trae sus 2 pagos (no el del grupo B)');
  check(rListaA._json.every(p => p.captura_base64 === undefined), 'GET / nunca trae captura_base64 en ninguna fila de la lista');

  const rListaB = await invocarRuta(handlerGetPagos, reqPara(GRUPO_B));
  check(rListaB._json.length === 1, 'GET / del grupo B trae solo SU pago (aislamiento entre grupos)');

  // =================================================================
  // GET /api/pagos/:id/captura — ownership
  // =================================================================
  const idPagoDeA = rCreado._json.id;
  const rCapturaPropia = await invocarRuta(handlerGetCaptura, reqPara(GRUPO_A, { params: { id: idPagoDeA } }));
  check(rCapturaPropia._status === undefined || rCapturaPropia._status === 200, 'GET /:id/captura sobre un pago PROPIO responde 200 (con los bytes de la imagen)');
  check(Buffer.isBuffer(rCapturaPropia._sent) && rCapturaPropia._sent.toString('base64') === CAPTURA_CHICA_BASE64, 'los bytes servidos decodifican EXACTO al base64 original');
  check(rCapturaPropia._headers['Content-Type'] === 'image/jpeg', 'el Content-Type servido es el capturaMime guardado');

  const rCapturaAjena = await invocarRuta(handlerGetCaptura, reqPara(GRUPO_B, { params: { id: idPagoDeA } }));
  check(rCapturaAjena._status === 404, 'GET /:id/captura sobre un pago de OTRO grupo da 404 (nunca se sirve, aunque el id exista de verdad)');

  const rCapturaInexistente = await invocarRuta(handlerGetCaptura, reqPara(GRUPO_A, { params: { id: 'no-existe' } }));
  check(rCapturaInexistente._status === 404, 'GET /:id/captura sobre un id que no existe da 404 igual (mismo shape que "de otro grupo" — nunca se filtra cuál existe)');

  // =================================================================
  // Lado Súper-admin
  // =================================================================
  const rListaSA = await invocarRuta(handlerGetPagosSA, reqPara(null));
  check(rListaSA._json.length === 3, 'GET /pagos de Súper-admin trae los 3 pagos, de AMBOS grupos');
  check(rListaSA._json.some(p => p.grupo_nombre === 'Parleys Douglas') && rListaSA._json.some(p => p.grupo_nombre === 'Deportes Zenyatta'), 'cada fila trae el nombre real del grupo (JOIN con grupos)');
  check(rListaSA._json.every(p => p.captura_base64 === undefined), 'GET /pagos de Súper-admin tampoco trae captura_base64 en la lista');

  const rCapturaSA = await invocarRuta(handlerGetCapturaSA, reqPara(null, { params: { id: idPagoDeA } }));
  check(rCapturaSA._sent.toString('base64') === CAPTURA_CHICA_BASE64, 'Súper-admin puede ver la captura de CUALQUIER grupo (sin restricción de grupo_id)');

  const rCapturaSAInexistente = await invocarRuta(handlerGetCapturaSA, reqPara(null, { params: { id: 'no-existe' } }));
  check(rCapturaSAInexistente._status === 404, 'GET /pagos/:id/captura de Súper-admin también da 404 sobre un id inexistente');

  const rConteo1 = await invocarRuta(handlerConteoPendientesSA, reqPara(null));
  check(rConteo1._json.total === 3, 'conteo-pendientes cuenta los 3 pagos (todos siguen "pendiente" en este punto)');

  // --- confirmar ---
  const rConfirmar = await invocarRuta(handlerConfirmarSA, reqPara(null, { params: { id: idPagoDeA }, body: { notaAdmin: 'Todo en orden' } }));
  check(rConfirmar._status === 204, 'POST /pagos/:id/confirmar responde 204');
  const filaConfirmada = TABLAS.pagos_grupo.find(p => p.id === idPagoDeA);
  check(filaConfirmada.estado === 'confirmado', 'el estado quedó "confirmado" de verdad en la base');
  check(filaConfirmada.nota_admin === 'Todo en orden', 'la nota del admin se guardó');
  check(!!filaConfirmada.revisado_en, 'revisado_en quedó con una fecha (ya no null)');

  const rConteo2 = await invocarRuta(handlerConteoPendientesSA, reqPara(null));
  check(rConteo2._json.total === 2, 'después de confirmar uno, conteo-pendientes baja a 2');

  // --- rechazar (sin nota, a propósito — no debe ser obligatoria) ---
  const idPagoDeB = rCreadoOtroGrupo._json.id;
  const rRechazar = await invocarRuta(handlerRechazarSA, reqPara(null, { params: { id: idPagoDeB }, body: {} }));
  check(rRechazar._status === 204, 'POST /pagos/:id/rechazar SIN notaAdmin igual responde 204 (la nota es opcional)');
  const filaRechazada = TABLAS.pagos_grupo.find(p => p.id === idPagoDeB);
  check(filaRechazada.estado === 'rechazado', 'el estado quedó "rechazado" de verdad en la base');
  check(!!filaRechazada.revisado_en, 'revisado_en también quedó fijado al rechazar');

  const rConteo3 = await invocarRuta(handlerConteoPendientesSA, reqPara(null));
  check(rConteo3._json.total === 1, 'después de confirmar 1 y rechazar 1, conteo-pendientes baja a 1 (el segundo pago del grupo A sigue pendiente)');

  // --- confirmar/rechazar sobre un id que no existe -> 404, nunca revienta ---
  const rConfirmar404 = await invocarRuta(handlerConfirmarSA, reqPara(null, { params: { id: 'no-existe' }, body: {} }));
  check(rConfirmar404._status === 404, 'POST /pagos/:id/confirmar sobre un id inexistente da 404');

  const rRechazar404 = await invocarRuta(handlerRechazarSA, reqPara(null, { params: { id: 'no-existe' }, body: {} }));
  check(rRechazar404._status === 404, 'POST /pagos/:id/rechazar sobre un id inexistente da 404');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de 💳 Pagos se cayó con una excepción:', e);
  process.exit(1);
});
