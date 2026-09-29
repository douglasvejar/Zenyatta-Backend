// =================================================================
// PRUEBA: "GET /planos/buscar-pizarra" (29-09-2026, a pedido del
// usuario: "en la pizarras si ya coloque alguna pizarra en esa carrera,
// al seleccionar la carrera colocame la pizarra anterior y colocame un
// mensaje abajo de la pizarra indicando que ya habia colocado llegada
// anteriormente.... igual la puedo modificar"). Este endpoint nuevo es
// el que el frontend llama cada vez que cambia Hipódromo/Carrera/Fecha en
// "Cargar Planos", para saber si ya hay una pizarra guardada de antes y
// precargarla. Usa el MISMO criterio de búsqueda (grupo_id +
// hipodromo_nombre + carrera_numero + fecha) que ya usa POST /planos para
// "sustituir en vez de duplicar" — ver test_hipismo_planos_sustituye_carrera.js.
//
// Casos cubiertos:
//   1. No hay ningún plano guardado todavía para esa combinación: pizarra = null.
//   2. Ya existe un plano guardado para esa combinación exacta: devuelve
//      su pizarra (y el id del plano).
//   3. Un plano de OTRA carrera, OTRO hipódromo, u OTRA fecha no debe
//      "contaminar" la búsqueda (cada campo se compara por separado).
//   4. Si hay 2 planos guardados para la misma combinación (no debería
//      pasar en producción gracias a "sustituir en vez de duplicar", pero
//      por las dudas), devuelve el MÁS RECIENTE (creado_en DESC).
//   5. Faltando algún parámetro (hipodromoNombre/carreraNumero/fecha):
//      responde pizarra = null sin explotar, no manda una consulta rota
//      a la base de datos.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-buscar-pizarra-1';

const TABLAS = {
  hipismo_planos: []
};
let siguienteId = 1;
function nuevoId(prefijo) { return prefijo + '-' + (siguienteId++); }

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- GET /planos/buscar-pizarra ----
  if (/^SELECT id, pizarra FROM hipismo_planos\s+WHERE grupo_id = \$1 AND hipodromo_nombre = \$2 AND carrera_numero = \$3 AND fecha = \$4\s+ORDER BY creado_en DESC LIMIT 1$/i.test(sql)) {
    const [grupoId, hipodromoNombre, carreraNumero, fecha] = params;
    const filas = TABLAS.hipismo_planos.filter(p =>
      p.grupo_id === grupoId && p.hipodromo_nombre === hipodromoNombre &&
      Number(p.carrera_numero) === Number(carreraNumero) && p.fecha === fecha);
    // Más reciente primero (mismo orden que pide la consulta real: creado_en DESC).
    filas.sort((a, b) => b.creado_en - a.creado_en);
    return { rows: filas.slice(0, 1).map(p => ({ id: p.id, pizarra: p.pizarra })) };
  }

  throw new Error('La base de datos falsa de esta prueba (planos-buscar-pizarra) no sabe responder: ' + sql);
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
const handlerBuscarPizarra = handlerDe('get', '/planos/buscar-pizarra');

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
function reqBase(grupoId, query) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: {}, query: query || {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) Todavía no hay ningún plano: pizarra = null ---
  const res1 = await invocarRuta(handlerBuscarPizarra, reqBase(GRUPO_ID, {
    hipodromoNombre: 'La Rinconada', carreraNumero: '5', fecha: '2026-09-29'
  }));
  check(res1._status === 200, '1) Responde 200 aunque no haya nada');
  check(res1._json.pizarra === null, '1) pizarra = null cuando no hay ningún plano guardado todavía');

  // --- Seed: un plano ya guardado para La Rinconada / carrera 5 / 2026-09-29 ---
  TABLAS.hipismo_planos.push({
    id: nuevoId('plano'), grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada',
    carrera_numero: 5, fecha: '2026-09-29', pizarra: '10.2.3', creado_en: 1000
  });

  // --- 2) Ahora sí existe: debe devolver su pizarra ---
  const res2 = await invocarRuta(handlerBuscarPizarra, reqBase(GRUPO_ID, {
    hipodromoNombre: 'La Rinconada', carreraNumero: '5', fecha: '2026-09-29'
  }));
  check(res2._json.pizarra === '10.2.3', '2) Devuelve la pizarra ya guardada de esa combinación exacta');
  check(!!res2._json.planoId, '2) Devuelve también el id del plano encontrado');

  // --- 3a) Otra carrera (6) NO debe encontrar nada ---
  const res3a = await invocarRuta(handlerBuscarPizarra, reqBase(GRUPO_ID, {
    hipodromoNombre: 'La Rinconada', carreraNumero: '6', fecha: '2026-09-29'
  }));
  check(res3a._json.pizarra === null, '3a) Otra carrera (6) no devuelve la pizarra de la carrera 5');

  // --- 3b) Otro hipódromo NO debe encontrar nada ---
  const res3b = await invocarRuta(handlerBuscarPizarra, reqBase(GRUPO_ID, {
    hipodromoNombre: 'Santa Anita', carreraNumero: '5', fecha: '2026-09-29'
  }));
  check(res3b._json.pizarra === null, '3b) Otro hipódromo no devuelve la pizarra de La Rinconada');

  // --- 3c) Otra fecha NO debe encontrar nada ---
  const res3c = await invocarRuta(handlerBuscarPizarra, reqBase(GRUPO_ID, {
    hipodromoNombre: 'La Rinconada', carreraNumero: '5', fecha: '2026-09-30'
  }));
  check(res3c._json.pizarra === null, '3c) Otra fecha no devuelve la pizarra del día anterior');

  // --- 4) Dos planos para la MISMA combinación (no debería pasar en
  //     producción, pero por las dudas): devuelve el MÁS RECIENTE ---
  TABLAS.hipismo_planos.push({
    id: nuevoId('plano'), grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada',
    carrera_numero: 5, fecha: '2026-09-29', pizarra: '9.9.9', creado_en: 2000
  });
  const res4 = await invocarRuta(handlerBuscarPizarra, reqBase(GRUPO_ID, {
    hipodromoNombre: 'La Rinconada', carreraNumero: '5', fecha: '2026-09-29'
  }));
  check(res4._json.pizarra === '9.9.9', '4) Con 2 planos coincidiendo, devuelve el MÁS RECIENTE (9.9.9, no 10.2.3)');

  // --- 5) Faltando un parámetro: pizarra = null, sin explotar ---
  const res5 = await invocarRuta(handlerBuscarPizarra, reqBase(GRUPO_ID, {
    hipodromoNombre: 'La Rinconada', carreraNumero: '5'
    // falta "fecha"
  }));
  check(res5._status === 200, '5) Responde 200 aunque falte un parámetro (no explota)');
  check(res5._json.pizarra === null, '5) pizarra = null cuando falta algún parámetro');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "buscar-pizarra" se cayó con una excepción:', e);
  process.exit(1);
});
