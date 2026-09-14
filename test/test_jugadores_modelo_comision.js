// =================================================================
// PRUEBA: POST/PUT /api/jugadores guardan "modeloComision" (09-09-2026,
// "grupo mixto" — a pedido del usuario, ver la nota grande en
// src/routes/jugadores.js y sql/schema.sql, columna
// jugadores.modelo_comision). Este es el endpoint que usa la propia
// página del GRUPO (Comisión > "Modelo de comisión") para marcar una
// excepción puntual, sin tener que pasar por Súper-admin.
//
// Cubre normalizarModeloComisionJugador(): valores válidos ('plano',
// 'por_tipo_jugada') se guardan tal cual; cualquier otra cosa (undefined,
// '', null, texto random) se normaliza a null (= "hereda del grupo",
// el valor de siempre, retrocompatible con cualquier código/pruebas que
// no manden este campo).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-jugadores-1';
const TABLAS = { jugadores: [] };
let siguienteId = 1;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^INSERT INTO jugadores \(grupo_id, nombre, telefono, notas, activo, tipo_cuenta, pozo_inicial, comision_propia, modelo_comision\)/i.test(sql)) {
    const [grupoId, nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision] = params;
    if (TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      const err = new Error('duplicado'); err.code = '23505'; throw err;
    }
    const fila = {
      id: 'j' + (siguienteId++), grupo_id: grupoId, nombre, telefono, notas, activo,
      tipo_cuenta: tipoCuenta, pozo_inicial: pozoInicial, comision_propia: comisionPropia, modelo_comision: modeloComision
    };
    TABLAS.jugadores.push(fila);
    return { rows: [fila] };
  }

  if (/^UPDATE jugadores SET nombre = \$1, telefono = \$2, notas = \$3, activo = \$4, tipo_cuenta = \$5,\s*pozo_inicial = \$6, comision_propia = \$7, modelo_comision = \$8, auto_creado = false\s*WHERE id = \$9 AND grupo_id = \$10/i.test(sql)) {
    const [nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, id, grupoId] = params;
    const fila = TABLAS.jugadores.find(j => j.id === id && j.grupo_id === grupoId);
    if (!fila) return { rows: [] };
    Object.assign(fila, { nombre, telefono, notas, activo, tipo_cuenta: tipoCuenta, pozo_inicial: pozoInicial, comision_propia: comisionPropia, modelo_comision: modeloComision });
    return { rows: [fila] };
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

// El router real hace router.use(requiereGrupo) como PRIMER handler --
// los POST/PUT/DELETE reales quedan en las posiciones siguientes.
const entradaPost = jugadoresRouter.__handlers.find(([metodo]) => metodo === 'post');
const handlerPost = entradaPost[1][entradaPost[1].length - 1];
const entradaPut = jugadoresRouter.__handlers.find(([metodo, args]) => metodo === 'put' && args[0] === '/:id');
const handlerPut = entradaPut[1][entradaPut[1].length - 1];

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    res.end = () => { resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) POST con modeloComision: 'plano' -> se guarda tal cual ---
  const req1 = { grupoId: GRUPO_ID, body: { nombre: 'ANA', comisionPropia: 0, modeloComision: 'plano' } };
  const res1 = await invocarRuta(handlerPost, req1);
  check(res1._status === 201, 'POST /api/jugadores con modeloComision "plano" responde 201');
  check(res1._json.modelo_comision === 'plano', 'se guarda modelo_comision = "plano" tal cual vino, aunque comisionPropia sea 0 (= "sin %", a propósito)');

  // --- 2) POST con modeloComision: 'por_tipo_jugada' -> se guarda tal cual ---
  const req2 = { grupoId: GRUPO_ID, body: { nombre: 'LUIS', comisionPropia: 0, modeloComision: 'por_tipo_jugada' } };
  const res2 = await invocarRuta(handlerPost, req2);
  check(res2._json.modelo_comision === 'por_tipo_jugada', 'se guarda modelo_comision = "por_tipo_jugada" tal cual vino');

  // --- 3) POST sin modeloComision (undefined) -> null, hereda del grupo ---
  const req3 = { grupoId: GRUPO_ID, body: { nombre: 'CARLOS', comisionPropia: 5 } };
  const res3 = await invocarRuta(handlerPost, req3);
  check(res3._json.modelo_comision === null, 'sin modeloComision en el body, se normaliza a null (hereda el modelo del grupo) -- retrocompatible con como se creaban los jugadores antes de esta función existir');

  // --- 4) POST con un valor inválido/basura -> también se normaliza a null ---
  const req4 = { grupoId: GRUPO_ID, body: { nombre: 'PEDRO', comisionPropia: 3, modeloComision: 'lo-que-sea' } };
  const res4 = await invocarRuta(handlerPost, req4);
  check(res4._json.modelo_comision === null, 'un modeloComision con cualquier valor que no sea "plano" ni "por_tipo_jugada" se normaliza a null, en vez de guardar basura');

  // --- 5) PUT actualiza modeloComision de un jugador ya existente ---
  const idAna = res1._json.id;
  const req5 = {
    params: { id: idAna }, grupoId: GRUPO_ID,
    body: { nombre: 'ANA', telefono: null, notas: null, activo: true, tipoCuenta: 'libre', pozoInicial: 0, comisionPropia: 0, modeloComision: 'por_tipo_jugada' }
  };
  const res5 = await invocarRuta(handlerPut, req5);
  check(res5._status === 200, 'PUT /api/jugadores/:id responde 200');
  check(res5._json.modelo_comision === 'por_tipo_jugada', 'PUT actualiza la excepción de ANA a "por_tipo_jugada"');

  // --- 6) PUT para "quitar" la excepción (modeloComision: null explícito) ---
  const req6 = {
    params: { id: idAna }, grupoId: GRUPO_ID,
    body: { nombre: 'ANA', telefono: null, notas: null, activo: true, tipoCuenta: 'libre', pozoInicial: 0, comisionPropia: 0, modeloComision: null }
  };
  const res6 = await invocarRuta(handlerPut, req6);
  check(res6._json.modelo_comision === null, 'PUT con modeloComision: null vuelve a "hereda del grupo" (quita la excepción)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de jugadores/modelo_comision se cayó con una excepción:', e);
  process.exit(1);
});
