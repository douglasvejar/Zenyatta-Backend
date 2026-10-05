// =================================================================
// PRUEBA: "CLIENTE X NO EXISTE" (05-10-2026, a pedido del usuario:
// "actualmente se crea el jugador automatico pero no quiero eso porque
// me esta creando clientes dobles cuando tengo un error de una letra...
// a partir de ahora me vas a dar un mensaje en pantalla que diga:
// CLIENTE (NOMBRE) NO EXISTE").
//
// Todas las cargas de Hipismo (planos, adelantadas, tercios adelantadas,
// remates, winners, traspasos, ediciones) tienen que responder 422 con
// "CLIENTE X NO EXISTE" cuando un nombre no está en la ficha de clientes,
// SIN crear ningún cliente ni guardar nada; y funcionar igual de siempre
// cuando todos existen. Mismo patrón de base falsa en memoria que el resto.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g-cliente-no-existe-1';
const CLIENTES = new Set(['ANA', 'LUIS', 'MARLON1']);
const escrituras = [];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    return { rows: (params[1] || []).filter(n => CLIENTES.has(n)).map(nombre => ({ nombre })) };
  }
  if (/^INSERT INTO jugadores/i.test(sql)) { escrituras.push(sql); return { rows: [] }; }
  if (/^SELECT id, nombre, comision_propia, cuenta_comision_id, incluir_porcentaje_en_jugadas FROM jugadores/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) { escrituras.push(sql); return { rows: [{ id: 'x1' }] }; }
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...args) => { handlers.push([m, args]); return router; }; });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'h', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';
const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocarRuta(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e.message));
  return { salida, status };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

(async function main() {
  const base = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: {}, query: {} };

  // 1) Cargar Planos "Calcular": el cliente PEDRO no existe
  let r = await invocarRuta(handlerDe('post', '/planos/calcular'), {
    ...base, body: { texto: 'Juega PEDRO 1p (5) con 30,00 da MARLON1', pizarra: '5.1.2', cruzaJugadas: false }
  });
  check(r.status === 422, `1a) /planos/calcular con cliente inexistente responde 422 (dio ${r.status})`);
  check(r.salida && /CLIENTE PEDRO NO EXISTE/.test(r.salida.error), '1b) el mensaje dice "CLIENTE PEDRO NO EXISTE"');
  check(r.salida && JSON.stringify(r.salida.clientesNoExisten) === '["PEDRO"]', '1c) devuelve la lista clientesNoExisten');

  // 2) lo mismo con un banquero que no existe, y con un error de UNA letra
  r = await invocarRuta(handlerDe('post', '/planos/calcular'), {
    ...base, body: { texto: 'Juega ANA 1p (5) con 30,00 da MARLON2', pizarra: '5.1.2', cruzaJugadas: false }
  });
  check(r.status === 422 && /CLIENTE MARLON2 NO EXISTE/.test(r.salida.error), '2) el banquero con una letra distinta (MARLON2) también da "NO EXISTE"');

  // 3) todos existen -> calcula normal
  r = await invocarRuta(handlerDe('post', '/planos/calcular'), {
    ...base, body: { texto: 'Juega ANA 1p (5) con 30,00 da MARLON1', pizarra: '5.1.2', cruzaJugadas: false }
  });
  check(r.status === 200 && r.salida && r.salida.cantidadTickets === 1, '3) con todos los nombres existentes calcula igual que siempre');

  // 4) Winners: no guarda ni crea al cliente inexistente
  escrituras.length = 0;
  r = await invocarRuta(handlerDe('post', '/winners'), {
    ...base, body: { hipodromoNombre: 'BELMONT', carreraNumero: 4, fecha: '2026-10-05', lineas: [
      { cliente: 'ANA', caballo: '3', monto: 10 }, { cliente: 'JUNKO', caballo: '3', monto: -10 }
    ] }
  });
  check(r.status === 422 && /CLIENTE JUNKO NO EXISTE/.test(r.salida.error), '4a) /winners con JUNKO inexistente responde 422 y avisa');
  check(escrituras.length === 0, `4b) NO se creó ningún cliente ni se guardó nada (escrituras: ${escrituras.length})`);

  // 5) Remate manual
  escrituras.length = 0;
  r = await invocarRuta(handlerDe('post', '/remates/manual'), {
    ...base, body: { hipodromoNombre: 'BELMONT', carreraNumero: 4, fecha: '2026-10-05', lineas: [
      { cliente: 'ANA', numeroEjemplar: 1, monto: -20 }, { cliente: 'RAUL', numeroEjemplar: 2, monto: -20 }
    ] }
  });
  check(r.status === 422 && /CLIENTE RAUL NO EXISTE/.test(r.salida.error) && escrituras.length === 0, '5) /remates/manual con RAUL inexistente: 422 y sin guardar nada');

  // 6) Jugadas Adelantadas (Tablas Fijas y Marcas) calcular
  r = await invocarRuta(handlerDe('post', '/adelantadas/calcular'), {
    ...base, body: { texto: '*JUGANDO HALLAND*\n1) 5TF DEL 3 A 4 ,10/50$' }
  });
  check(r.status === 422 && /CLIENTE HALLAND NO EXISTE/.test((r.salida || {}).error || ''), '6) /adelantadas/calcular avisa "CLIENTE HALLAND NO EXISTE"');

  // 7) Traspaso de comisión: el destino debe existir
  escrituras.length = 0;
  r = await invocarRuta(handlerDe('post', '/comisiones/traspaso'), {
    ...base, body: { clienteOrigen: 'ANA', clienteDestino: 'NADIE', monto: 5, fecha: '2026-10-05' }
  });
  check(r.status === 422 && /CLIENTE NADIE NO EXISTE/.test((r.salida || {}).error || '') && escrituras.length === 0, '7) /comisiones/traspaso con destino inexistente: 422 y sin guardar');

  // 8) Traspaso de una jugada a un cliente inexistente: no se mueve nada
  escrituras.length = 0;
  r = await invocarRuta(handlerDe('post', '/traspasos/jugada'), {
    ...base, body: { tabla: 'hipismo_tickets', id: 't1', clienteNuevo: 'FANTASMA' }
  });
  check(r.status === 422 && /CLIENTE FANTASMA NO EXISTE/.test((r.salida || {}).error || ''), '8a) /traspasos/jugada a un cliente inexistente: 422');
  check(escrituras.length === 0, '8b) la jugada NO se movió');

  // 9) varios inexistentes -> un renglón por cliente
  r = await invocarRuta(handlerDe('post', '/winners'), {
    ...base, body: { hipodromoNombre: 'BELMONT', carreraNumero: 4, lineas: [
      { cliente: 'AAA', caballo: '1', monto: 5 }, { cliente: 'BBB', caballo: '1', monto: -5 }
    ] }
  });
  check(r.status === 422 && /CLIENTE AAA NO EXISTE/.test(r.salida.error) && /CLIENTE BBB NO EXISTE/.test(r.salida.error), '9) si faltan varios, avisa uno por uno');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  if (fallaron) process.exit(1);
})();
