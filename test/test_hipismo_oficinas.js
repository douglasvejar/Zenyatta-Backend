// =================================================================
// PRUEBA: HIPISMO OFICINAS (09-10-2026)
// Jugadas cargadas en tabla (jugador, jugó/dio, tipo, caballo, monto) con cuadre por tipo + caballo.
// Verifica: (1) el cuadre y el mensaje de cuánto falta, (2) que el emparejamiento da EXACTAMENTE los mismos
// totales que el plano de texto de Grupos Hípicos, (3) las rutas /oficinas/* (cuadre, calcular, guardar,
// carrera siguiente, reabrir), (4) los interruptores del módulo (login, middleware, Súper-admin) y
// (5) que la pantalla nueva exista y use esas rutas.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalLoad = Module._load;

const GRUPO_ID = 'g-oficinas-1';
const CLIENTES = new Set(['JOSE', 'RAUL', 'PEDRO', 'ANA', 'LUIS']);
const HIPODROMOS = { 'h-gulf': 'GULFSTREAM' };
const planos = [];            // planos "guardados" en la base falsa
const pendientes = [];        // carreras guardadas sin llegada
let configPlanoResuelto = false; // grupos.oficinas_plano_resuelto
const papelera = [];
const escrituras = [];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    return { rows: (params[1] || []).filter(n => CLIENTES.has(n)).map(nombre => ({ nombre })) };
  }
  if (/^SELECT nombre, carreras_max FROM hipismo_hipodromos/i.test(sql)) return HIPODROMOS[params[0]] ? { rows: [{ nombre: HIPODROMOS[params[0]], carreras_max: 12 }] } : { rows: [] };
  if (/^SELECT nombre FROM hipismo_hipodromos WHERE id/i.test(sql)) return HIPODROMOS[params[0]] ? { rows: [{ nombre: HIPODROMOS[params[0]] }] } : { rows: [] };
  if (/^SELECT carrera_numero FROM hipismo_planos/i.test(sql)) {
    return { rows: planos.filter(p => p.hipodromo_nombre === params[1] && p.fecha === params[2]).map(p => ({ carrera_numero: p.carrera_numero })) };
  }
  if (/^SELECT id, pizarra, ret, cruza_jugadas, jugadas_oficina, texto_resultado FROM hipismo_planos/i.test(sql)) {
    const p = planos.find(x => x.hipodromo_nombre === params[1] && String(x.carrera_numero) === String(params[2]) && x.fecha === params[3]);
    return { rows: p ? [p] : [] };
  }
  if (/^SELECT id FROM hipismo_planos WHERE grupo_id/i.test(sql)) {
    return { rows: planos.filter(p => p.hipodromo_nombre === params[1] && String(p.carrera_numero) === String(params[2]) && p.fecha === params[3]).map(p => ({ id: p.id })) };
  }
  if (/^SELECT oficinas_plano_resuelto FROM grupos/i.test(sql)) return { rows: [{ oficinas_plano_resuelto: configPlanoResuelto }] };
  if (/^UPDATE grupos SET oficinas_plano_resuelto/i.test(sql)) { configPlanoResuelto = !!params[0]; return { rows: [] }; }
  // ---- carreras pendientes de llegada y Registro de Jugadas ----
  if (/^SELECT carrera_numero FROM hipismo_oficinas_pendientes/i.test(sql)) {
    return { rows: pendientes.filter(x => x.hipodromo_nombre === params[1] && x.fecha === params[2]).map(x => ({ carrera_numero: x.carrera_numero })) };
  }
  if (/^SELECT id, ret, cruza_jugadas, jugadas FROM hipismo_oficinas_pendientes/i.test(sql)) {
    const x = pendientes.find(q => q.hipodromo_nombre === params[1] && String(q.carrera_numero) === String(params[2]) && q.fecha === params[3]);
    return { rows: x ? [x] : [] };
  }
  if (/^SELECT id, hipodromo_id, hipodromo_nombre, carrera_numero, ret, jugadas FROM hipismo_oficinas_pendientes/i.test(sql)) {
    return { rows: pendientes.filter(x => x.fecha === params[1]) };
  }
  if (/^SELECT id, hipodromo_id, hipodromo_nombre, carrera_numero, pizarra, ret, jugadas_oficina FROM hipismo_planos/i.test(sql)) {
    return { rows: planos.filter(x => x.fecha === params[1] && x.jugadas_oficina) };
  }
  if (/^SELECT id, nombre FROM hipismo_hipodromos WHERE grupo_id/i.test(sql)) return { rows: Object.entries(HIPODROMOS).map(([id, nombre]) => ({ id, nombre })) };
  if (/^SELECT fecha, COUNT\(\*\)::int AS carreras FROM hipismo_planos/i.test(sql)) {
    const m = new Map(); planos.filter(x => x.jugadas_oficina).forEach(x => m.set(x.fecha, (m.get(x.fecha) || 0) + 1));
    return { rows: [...m.entries()].map(([fecha, carreras]) => ({ fecha, carreras })) };
  }
  if (/^SELECT fecha, COUNT\(\*\)::int AS pendientes FROM hipismo_oficinas_pendientes/i.test(sql)) {
    const m = new Map(); pendientes.forEach(x => m.set(x.fecha, (m.get(x.fecha) || 0) + 1));
    return { rows: [...m.entries()].map(([fecha, pendientes]) => ({ fecha, pendientes })) };
  }
  if (/^INSERT INTO hipismo_oficinas_pendientes/i.test(sql)) {
    const fila = { id: 'pend-' + (pendientes.length + 1), grupo_id: params[0], hipodromo_id: params[1], hipodromo_nombre: params[2], carrera_numero: params[3], fecha: params[4], ret: params[5], cruza_jugadas: params[6], jugadas: JSON.parse(params[7]) };
    const i = pendientes.findIndex(q => q.hipodromo_nombre === fila.hipodromo_nombre && q.carrera_numero === fila.carrera_numero && q.fecha === fila.fecha);
    if (i >= 0) pendientes[i] = { ...fila, id: pendientes[i].id }; else pendientes.push(fila);
    return { rows: [] };
  }
  if (/^DELETE FROM hipismo_oficinas_pendientes/i.test(sql)) {
    const i = pendientes.findIndex(q => q.hipodromo_nombre === params[1] && String(q.carrera_numero) === String(params[2]) && q.fecha === params[3]);
    if (i >= 0) pendientes.splice(i, 1);
    return { rows: [] };
  }
  if (/^INSERT INTO hipismo_planos \(/i.test(sql)) {
    const p = { id: 'plano-' + (planos.length + 1), grupo_id: params[0], hipodromo_id: params[1], hipodromo_nombre: params[2], carrera_numero: params[3], fecha: params[4], ret: params[5], pizarra: params[6], cruza_jugadas: params[7], texto_original: params[8], texto_resultado: params[9], comision_total: params[10], jugadas_oficina: null };
    planos.push(p); return { rows: [p] };
  }
  if (/^UPDATE hipismo_planos SET jugadas_oficina/i.test(sql)) {
    const p = planos.find(x => x.id === params[1]); if (p) p.jugadas_oficina = JSON.parse(params[0]);
    escrituras.push(sql); return { rows: [] };
  }
  if (/^INSERT INTO hipismo_tickets/i.test(sql)) { escrituras.push(sql); return { rows: [] }; }
  if (/^SELECT .*FROM hipismo_(adelantadas|tercios_adelantadas)/i.test(sql)) return { rows: [] };
  if (/^SELECT id, nombre, comision_propia, cuenta_comision_id, incluir_porcentaje_en_jugadas FROM jugadores/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) return { rows: [] };
  // Sustituir una carrera ya cargada: el plano viejo va a la papelera y se borra (services/hipismoPlanosPapelera.js)
  if (/^SELECT \* FROM hipismo_planos WHERE id = \$1 AND grupo_id/i.test(sql)) return { rows: planos.filter(x => x.id === params[0]) };
  if (/^SELECT \* FROM hipismo_tickets WHERE plano_id/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO hipismo_planos_papelera/i.test(sql)) { papelera.push(params); return { rows: [{ id: 'pap-' + papelera.length }] }; }
  if (/^DELETE FROM hipismo_planos WHERE id/i.test(sql)) { const i = planos.findIndex(x => x.id === params[0]); if (i >= 0) planos.splice(i, 1); return { rows: [] }; }
  if (/^SELECT .*FROM hipismo_planos_papelera/i.test(sql)) return { rows: [] };
  if (/^SELECT .*FROM hipismo_planos/i.test(sql)) return { rows: [] };
  if (/^SELECT .*FROM hipismo_tickets/i.test(sql)) return { rows: [] };
  if (/^SELECT /i.test(sql)) return { rows: [] };
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
const oficinas = require(path.join(__dirname, '..', 'src', 'services', 'hipismoOficinasCalc'));
const { calcularPlano } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocarRuta(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); return this; } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e.message));
  return { salida, status };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

(async function main() {
  // ---------- 1) Cuadre por tipo + caballo ----------
  const F = (jugador, lado, tipo, caballo, monto) => ({ jugador, lado, tipo, caballo, monto });
  let c = oficinas.calcularCuadre([F('jose', 'jugo', '1p', '3', '200'), F('raul', 'jugo', '1p', '3', '150')]);
  check(!c.cuadra && c.detalle[0].falta === 350 && c.detalle[0].faltaLado === 'dio', '1a) jose 200 + raul 150 jugaron y nadie dio: faltan 350 por dar');
  check(/faltan 350 por dar/.test(c.mensajes[0]) && /1p del 3/.test(c.mensajes[0]), '1b) el mensaje dice "1p del 3" y "faltan 350 por dar"');
  c = oficinas.calcularCuadre([F('jose', 'jugo', '1p', '3', '200'), F('raul', 'jugo', '1p', '3', '150'), F('pedro', 'dio', '1p', '3', '350')]);
  check(c.cuadra && c.totalJugo === 350 && c.totalDio === 350, '1c) cuando lo que jugaron = lo que dieron, cuadra');
  // Cuadra el total pero no cada tipo + caballo
  c = oficinas.calcularCuadre([F('jose', 'jugo', '1p', '3', '100'), F('pedro', 'dio', '1p', '5', '100')]);
  check(!c.cuadra && c.detalle.length === 2 && c.detalle.every(d => !d.cuadra), '1d) 100 jugados al 3 y 100 dados al 5 NO cuadra aunque el total sea igual (cuadre por tipo + caballo)');
  check(c.detalle.some(d => d.faltaLado === 'jugo') && c.detalle.some(d => d.faltaLado === 'dio'), '1e) indica cuál falta por jugar y cuál por dar');
  c = oficinas.calcularCuadre([F('jose', 'jugo', '2p', '3', '100'), F('pedro', 'dio', '1p', '3', '100')]);
  check(!c.cuadra, '1f) 2p del 3 contra 1p del 3 no se emparejan (distinto tipo)');
  // Mayúsculas/espacios/coma decimal
  c = oficinas.calcularCuadre([F(' Jose  ', 'jugo', '1P', ' 3 ', '1.250,50'), F('PEDRO', 'dio', '1p', '3', '1250.5')]);
  check(c.cuadra, '1g) "1P"/"1p", espacios, "1.250,50" y "1250.5" se leen igual');
  // Filas incompletas
  c = oficinas.calcularCuadre([F('jose', 'jugo', '', '3', '100'), F('', 'dio', '1p', '3', '100'), F('ana', 'jugo', '1p', '3', '0')]);
  check(c.errores.length === 3 && !c.cuadra, '1h) filas sin tipo, sin jugador o con monto 0 se marcan con su número de fila');
  check(oficinas.calcularCuadre([F('', 'jugo', '', '', '')]).hayJugadas === false, '1i) una fila totalmente en blanco se ignora');
  // Cruce 4x3 / 3x4
  c = oficinas.calcularCuadre([F('ana', 'jugo', 'pp', '4x3', '100'), F('luis', 'dio', 'pp', '3x4', '100')]);
  check(c.cuadra, '1j) pp 4x3 y pp 3x4 son el mismo cruce');
  // Misma persona de los dos lados en el mismo grupo se netea
  c = oficinas.calcularCuadre([F('ana', 'jugo', '1p', '3', '100'), F('ana', 'dio', '1p', '3', '100')]);
  check(c.cuadra === false && c.detalle[0].jugo === 0 && c.detalle[0].dio === 0, '1k) la misma persona jugando y dando lo mismo se anula (no hay nada que cuadrar)');

  // ---------- 2) El emparejamiento da los mismos totales que el plano de texto ----------
  const filas = [
    F('jose', 'jugo', '1p', '3', 200), F('raul', 'jugo', '1p', '3', 150), F('pedro', 'dio', '1p', '3', 350),
    F('ana', 'jugo', '2p', '5', 100), F('luis', 'dio', '2p', '5', 60), F('pedro', 'dio', '2p', '5', 40),
    F('ana', 'jugo', 'pp', '4x3', 80), F('raul', 'dio', 'pp', '3x4', 80)
  ];
  const parejas = oficinas.emparejar(filas);
  const texto = oficinas.armarTextoPlano(parejas);
  const r1 = calcularPlano({ texto, pizarra: '3-5-4-1-2', cruzar: false });
  check(r1.sinReconocer.length === 0 && r1.tickets.length === parejas.length, '2a) el plano armado lo reconoce el motor de siempre, sin líneas sin reconocer');
  // Referencia hecha a mano, línea por línea con el formato clásico (cada jugador contra cada banquero en proporción)
  const manual = [
    'Juega JOSE 1p (3) con 200 da PEDRO', 'Juega RAUL 1p (3) con 150 da PEDRO',
    'Juega ANA 2p (5) con 60 da LUIS', 'Juega ANA 2p (5) con 40 da PEDRO',
    'Juega ANA pp (4x3) con 80 da RAUL'
  ].join('\n');
  const r2 = calcularPlano({ texto: manual, pizarra: '3-5-4-1-2', cruzar: false });
  const iguales = Object.keys(r2.totalesFinales).every(k => Math.abs(r1.totalesFinales[k] - r2.totalesFinales[k]) < 0.005) && Object.keys(r1.totalesFinales).length === Object.keys(r2.totalesFinales).length;
  check(iguales, '2b) los totales por persona son idénticos a los del plano escrito a mano');
  // El dinero se conserva: lo que ganan unos lo pierden otros (menos la comisión)
  const suma = Object.values(r1.totalesFinales).reduce((a, b) => a + b, 0);
  check(Math.abs(suma + r1.comisionTotal) < 0.01, '2c) los totales de todos + la comisión suman cero');
  // Un jugador que juega contra varios bankeros / un banquero con varios jugadores
  const p2 = oficinas.emparejar([F('jose', 'jugo', '1p', '3', 100), F('pedro', 'dio', '1p', '3', 30), F('luis', 'dio', '1p', '3', 70)]);
  check(p2.length === 2 && p2[0].monto === 30 && p2[1].monto === 70 && p2.every(p => p.jugador === 'JOSE'), '2d) un jugador de 100 se reparte entre quienes dieron 30 y 70');
  // En un cruce el jugador va con SU caballo
  const p3 = oficinas.emparejar([F('luis', 'dio', 'pp', '3x4', 100), F('ana', 'jugo', 'pp', '4x3', 100)]);
  check(p3[0].caballo === '4x3' && p3[0].jugador === 'ANA', '2e) en pp 4x3 el jugador va con su caballo (4x3) aunque el banquero escribiera 3x4');
  check(oficinas.tiposNoReconocidos([F('a', 'jugo', '1p', '3', 10), F('b', 'dio', '1p', '3', 10)]).length === 0, '2f) 1p del 3 es reconocido por el motor');
  check(oficinas.tiposNoReconocidos([F('a', 'jugo', 'zz', '3', 10)]).join() === 'zz del 3', '2g) un tipo inventado (zz) se avisa antes de guardar');

  // ---------- 3) Rutas ----------
  const base = { grupoId: GRUPO_ID, grupo: { nombre: 'Oficina Uno' }, nombreActor: 'Admin', params: {}, query: {} };
  const tabla = [F('jose', 'jugo', '1p', '3', '200'), F('raul', 'jugo', '1p', '3', '150'), F('pedro', 'dio', '1p', '3', '350')];
  let r = await invocarRuta(handlerDe('post', '/oficinas/cuadre'), { ...base, body: { filas: tabla.slice(0, 2) } });
  check(r.status === 200 && r.salida.cuadra === false && r.salida.detalle[0].falta === 350, '3a) POST /oficinas/cuadre devuelve cuánto falta');
  r = await invocarRuta(handlerDe('post', '/oficinas/cuadre'), { ...base, body: { filas: tabla } });
  check(r.salida.cuadra === true && r.salida.noReconocidas.length === 0, '3b) POST /oficinas/cuadre con todo cuadrado dice que cuadra');

  r = await invocarRuta(handlerDe('post', '/oficinas/guardar'), { ...base, body: { filas: tabla.slice(0, 2), pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 1, fecha: '2026-10-09' } });
  check(r.status === 422 && /no cuadra/i.test(r.salida.error) && /350/.test(r.salida.error), '3c) guardar una carrera que no cuadra da 422 y dice cuánto falta');
  check(planos.length === 0, '3d) y NO se guardó ningún plano');

  r = await invocarRuta(handlerDe('post', '/oficinas/guardar'), { ...base, body: { filas: [...tabla.slice(0, 2), F('pedro', 'dio', '1p', '3', 350), F('ana', 'jugo', 'zz', '3', 5), F('luis', 'dio', 'zz', '3', 5)], pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 1, fecha: '2026-10-09' } });
  check(r.status === 422 && /zz del 3/.test(r.salida.error), '3e) un tipo que el motor no entiende se rechaza nombrándolo');

  r = await invocarRuta(handlerDe('post', '/oficinas/calcular'), { ...base, body: { filas: tabla, pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 1, fecha: '2026-10-09' } });
  check(r.status === 200 && r.salida.cantidadTickets === 2 && planos.length === 0, '3f) calcular (vista previa) arma 2 tickets y no guarda nada');
  check(r.salida.totalesFinales && r.salida.totalesFinales.PEDRO === -350, '3g) PEDRO banqueó 350 y el 3 ganó: -350');

  r = await invocarRuta(handlerDe('post', '/oficinas/guardar'), { ...base, body: { filas: tabla, pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 1, fecha: '2026-10-09' } });
  check(r.status === 201 && r.salida.plano && planos.length === 1, '3h) guardar una carrera cuadrada responde 201 y guarda el plano');
  check(planos[0].jugadas_oficina && planos[0].jugadas_oficina.length === 3 && planos[0].jugadas_oficina[0].jugador === 'JOSE', '3i) quedan guardadas las jugadas de la tabla para reabrirlas');
  check(planos[0].hipodromo_nombre === 'GULFSTREAM' && planos[0].carrera_numero === 1, '3j) el plano queda a nombre del hipódromo y la carrera elegidos');

  r = await invocarRuta(handlerDe('get', '/oficinas/siguiente-carrera'), { ...base, query: { hipodromoId: 'h-gulf', fecha: '2026-10-09' } });
  check(r.salida.siguiente === 2 && JSON.stringify(r.salida.cargadas) === '[1]', '3k) tras cargar la 1 de Gulfstream, la carrera que sigue es la 2');
  r = await invocarRuta(handlerDe('get', '/oficinas/siguiente-carrera'), { ...base, query: { hipodromoId: 'h-gulf', fecha: '2026-10-10' } });
  check(r.salida.siguiente === 1, '3l) otro día empieza de nuevo en la carrera 1');

  r = await invocarRuta(handlerDe('get', '/oficinas/carrera'), { ...base, query: { hipodromoId: 'h-gulf', carrera: '1', fecha: '2026-10-09' } });
  check(r.salida.existe && r.salida.filas.length === 3 && r.salida.pizarra === '3-1-2', '3m) reabrir la carrera 1 devuelve su tabla y su llegada');
  r = await invocarRuta(handlerDe('get', '/oficinas/carrera'), { ...base, query: { hipodromoId: 'h-gulf', carrera: '9', fecha: '2026-10-09' } });
  check(r.salida.existe === false, '3n) una carrera que no existe se informa como tal');

  // Hipódromo ajeno / sin hipódromo
  r = await invocarRuta(handlerDe('get', '/oficinas/siguiente-carrera'), { ...base, query: { hipodromoId: 'otro' } });
  check(r.status === 404, '3o) un hipódromo que no es del grupo da 404');

  // Cliente que no existe: igual que en Grupos Hípicos
  r = await invocarRuta(handlerDe('post', '/oficinas/guardar'), { ...base, body: { filas: [F('fantasma', 'jugo', '1p', '3', 10), F('pedro', 'dio', '1p', '3', 10)], pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 2, fecha: '2026-10-09' } });
  check(r.status === 422 && /CLIENTE FANTASMA NO EXISTE/.test(r.salida.error) && planos.length === 1, '3p) un jugador que no es cliente: "CLIENTE FANTASMA NO EXISTE" y no se guarda');

  // Aviso "CLIENTE X NO EXISTE" (ventana en pantalla con el nombre)
  const tablaFantasma = [F('fantasma', 'jugo', '1p', '3', 10), F('Pedro', 'dio', '1p', '3', 10), F('otro fantasma', 'jugo', '2p', '4', 5), F('raul', 'dio', '2p', '4', 5)];
  r = await invocarRuta(handlerDe('post', '/oficinas/cuadre'), { ...base, body: { filas: tablaFantasma } });
  check(r.status === 200 && JSON.stringify(r.salida.clientesNoExisten) === JSON.stringify(['FANTASMA', 'OTRO FANTASMA']), '3q) POST /oficinas/cuadre lista los clientes que no existen (con su nombre)');
  r = await invocarRuta(handlerDe('post', '/oficinas/cuadre'), { ...base, body: { filas: tabla } });
  check(r.salida.clientesNoExisten.length === 0, '3r) si todos existen, no hay aviso');
  const planosAntes = planos.length;
  r = await invocarRuta(handlerDe('post', '/oficinas/calcular'), { ...base, body: { filas: tablaFantasma, pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 2, fecha: '2026-10-09' } });
  check(r.status === 422 && /CLIENTE FANTASMA NO EXISTE/.test(r.salida.error) && /CLIENTE OTRO FANTASMA NO EXISTE/.test(r.salida.error) && r.salida.clientesNoExisten.length === 2, '3s) calcular con clientes inexistentes: 422 con TODOS los nombres');
  r = await invocarRuta(handlerDe('post', '/oficinas/guardar'), { ...base, body: { filas: [F('fantasma', 'jugo', '1p', '3', 10), F('pedro', 'dio', '1p', '3', 4)], pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 2, fecha: '2026-10-09' } });
  check(r.status === 422 && Array.isArray(r.salida.clientesNoExisten) && planos.length === planosAntes, '3t) el aviso de cliente inexistente sale antes que el de cuadre y no guarda nada');

  // ---------- Registro de Jugadas y carreras pendientes de llegada ----------
  const tablaCinco = [F('jose', 'jugo', '1p', '3', 200), F('raul', 'jugo', '1p', '3', 150), F('pedro', 'dio', '1p', '3', 350)];
  const cuerpoPend = (extra) => ({ filas: tablaCinco, hipodromoId: 'h-gulf', carreraNumero: 5, fecha: '2026-10-09', ...(extra || {}) });
  const planosAntesReg = planos.length;
  r = await invocarRuta(handlerDe('post', '/oficinas/pendiente'), { ...base, body: cuerpoPend() });
  check(r.status === 201 && pendientes.length === 1 && planos.length === planosAntesReg, '6a) guardar SIN llegada: queda pendiente y NO se crea ningún plano (no afecta balances)');
  check(pendientes[0].jugadas.length === 3 && pendientes[0].jugadas[0].jugador === 'JOSE', '6b) el pendiente guarda las jugadas tal cual (para reabrirlas)');
  r = await invocarRuta(handlerDe('post', '/oficinas/pendiente'), { ...base, body: cuerpoPend({ filas: tablaCinco.slice(0, 2) }) });
  check(r.status === 422 && /no cuadra/i.test(r.salida.error) && pendientes.length === 1, '6c) sin llegada TAMBIÉN exige que la carrera cuadre');
  r = await invocarRuta(handlerDe('post', '/oficinas/pendiente'), { ...base, body: cuerpoPend({ filas: [F('fantasma', 'jugo', '1p', '3', 10), F('pedro', 'dio', '1p', '3', 10)] }) });
  check(r.status === 422 && /CLIENTE FANTASMA NO EXISTE/.test(r.salida.error) && pendientes.length === 1, '6d) sin llegada también avisa "CLIENTE X NO EXISTE"');
  r = await invocarRuta(handlerDe('post', '/oficinas/pendiente'), { ...base, body: cuerpoPend({ filas: [F('jose', 'jugo', '1p', '3', 100), F('pedro', 'dio', '1p', '3', 100)] }) });
  check(r.status === 201 && pendientes.length === 1 && pendientes[0].jugadas.length === 2, '6e) volver a guardar el pendiente lo corrige (no lo duplica)');
  r = await invocarRuta(handlerDe('post', '/oficinas/pendiente'), { ...base, body: cuerpoPend({ carreraNumero: 1 }) });
  check(r.status === 409 && r.salida.calculada === true, '6f) una carrera ya calculada no se puede dejar sin llegada (409)');

  r = await invocarRuta(handlerDe('get', '/oficinas/carrera'), { ...base, query: { hipodromoId: 'h-gulf', carrera: '5', fecha: '2026-10-09' } });
  check(r.salida.existe && r.salida.pendiente === true && r.salida.pizarra === '' && r.salida.filas.length === 2, '6g) reabrir una carrera pendiente devuelve sus jugadas y avisa que es pendiente');
  r = await invocarRuta(handlerDe('get', '/oficinas/siguiente-carrera'), { ...base, query: { hipodromoId: 'h-gulf', fecha: '2026-10-09' } });
  check(JSON.stringify(r.salida.cargadas) === '[1,5]' && JSON.stringify(r.salida.pendientes) === '[5]' && r.salida.siguiente === 6, '6h) las pendientes cuentan como cargadas y se distinguen');

  r = await invocarRuta(handlerDe('get', '/oficinas/registro'), { ...base, query: { fecha: '2026-10-09' } });
  const regGulf = r.salida.hipodromos.find(h => h.nombre === 'GULFSTREAM');
  check(regGulf && regGulf.hipodromoId === 'h-gulf' && regGulf.carreras.map(x => x.numero + ':' + x.estado).join() === '1:calculada,5:pendiente', '6i) el Registro del día lista por hipódromo cada carrera con su estado (calculada / pendiente)');
  check(regGulf.carreras[0].pizarra === '3-1-2' && regGulf.carreras[0].filas === 3 && regGulf.carreras[0].totalJugado === 350 && regGulf.carreras[0].jugadores === 3, '6j) cada carrera muestra su llegada, cuántas jugadas, jugadores y total jugado');
  check(r.salida.totales.carreras === 2 && r.salida.totales.calculadas === 1 && r.salida.totales.pendientes === 1, '6k) el Registro suma carreras, calculadas y pendientes');
  r = await invocarRuta(handlerDe('get', '/oficinas/registro'), { ...base, query: { fecha: '2026-10-11' } });
  check(r.salida.hipodromos.length === 0 && r.salida.totales.carreras === 0, '6l) un día sin carreras sale vacío');
  r = await invocarRuta(handlerDe('get', '/oficinas/registro'), { ...base, query: { fecha: 'ayer' } });
  check(r.status === 400, '6m) una fecha inválida da 400');
  r = await invocarRuta(handlerDe('get', '/oficinas/registro-dias'), { ...base, query: {} });
  check(r.salida.dias.length === 1 && r.salida.dias[0].fecha === '2026-10-09' && r.salida.dias[0].carreras === 1 && r.salida.dias[0].pendientes === 1, '6n) los días con carreras se pueden abrir de un clic');

  // Agregar la llegada: se calcula sola y el pendiente desaparece
  r = await invocarRuta(handlerDe('post', '/oficinas/guardar'), { ...base, body: cuerpoPend({ pizarra: '3-1-2' }) });
  check(r.status === 201 && pendientes.length === 0 && planos.length === planosAntesReg + 1, '6o) al guardar el pendiente con su pizarra se calcula (plano nuevo) y deja de estar pendiente');
  // Editar una carrera ya calculada: cambiar un monto y un jugador y guardar la recalcula
  const filasEditadas = [F('jose', 'jugo', '1p', '3', 300), F('ana', 'jugo', '1p', '3', 150), F('pedro', 'dio', '1p', '3', 450)];
  r = await invocarRuta(handlerDe('post', '/oficinas/guardar'), { ...base, body: { filas: filasEditadas, pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 5, fecha: '2026-10-09' } });
  check(r.status === 201 && r.salida.sustituyoAnterior === true && r.salida.totalesFinales.PEDRO === -450, '6p) editar montos y jugadores de una carrera calculada y guardar la recalcula (PEDRO -450) y sustituye la anterior');
  const planoEditado = planos.filter(x => x.carrera_numero === 5).pop();
  check(planoEditado.jugadas_oficina.some(f => f.jugador === 'ANA') && planoEditado.jugadas_oficina.find(f => f.jugador === 'JOSE').monto === 300, '6q) lo editado queda guardado para volver a abrirlo');
  r = await invocarRuta(handlerDe('post', '/oficinas/pendiente'), { ...base, body: cuerpoPend({ carreraNumero: 7 }) });
  r = await invocarRuta(handlerDe('delete', '/oficinas/pendiente'), { ...base, query: { hipodromoId: 'h-gulf', carrera: '7', fecha: '2026-10-09' } });
  check(r.status === 200 && pendientes.length === 0, '6r) una carrera pendiente se puede descartar');

  // ---------- Configuración > Planos para grupos ----------
  r = await invocarRuta(handlerDe('get', '/oficinas/configuracion'), { ...base, query: {} });
  check(r.status === 200 && r.salida.planoResuelto === false, '7a) por defecto el plano resuelto está APAGADO (en las oficinas las jugadas son en vivo)');
  r = await invocarRuta(handlerDe('put', '/oficinas/configuracion'), { ...base, body: { planoResuelto: true } });
  check(r.status === 200 && r.salida.planoResuelto === true && configPlanoResuelto === true, '7b) activar el plano resuelto lo guarda');
  r = await invocarRuta(handlerDe('get', '/oficinas/configuracion'), { ...base, query: {} });
  check(r.salida.planoResuelto === true, '7c) al volver a leer la configuración sigue activado');
  r = await invocarRuta(handlerDe('put', '/oficinas/configuracion'), { ...base, body: { planoResuelto: false } });
  check(r.status === 200 && configPlanoResuelto === false, '7d) desactivarlo también se guarda');
  r = await invocarRuta(handlerDe('put', '/oficinas/configuracion'), { ...base, body: { planoResuelto: 'si' } });
  check(r.status === 400, '7e) un valor que no es true/false se rechaza');
  const entradaPut = hipismoRouter.__handlers.find(([m, a]) => m === 'put' && a[0] === '/oficinas/configuracion');
  check(entradaPut[1].length === 3, '7f) cambiar la configuración exige ser administrador del grupo (lleva el guardia de administrador)');

  // "Cruzar jugadas": el mismo interruptor de Súper-admin vale para los dos módulos
  const tablaCruce = [F('jose', 'jugo', '1p', '3', 100), F('pedro', 'dio', '1p', '3', 100), F('jose', 'jugo', '1p', '7', 40), F('ana', 'dio', '1p', '7', 40)];
  const cuerpoBase = { filas: tablaCruce, pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 5, fecha: '2026-10-09' };
  r = await invocarRuta(handlerDe('post', '/oficinas/calcular'), { ...base, body: { ...cuerpoBase, cruzaJugadas: false } });
  const sinCruzar = r.salida.totalesFinales.JOSE;
  r = await invocarRuta(handlerDe('post', '/oficinas/calcular'), { ...base, body: { ...cuerpoBase, cruzaJugadas: true } });
  const cruzando = r.salida.totalesFinales.JOSE;
  check(Math.abs(sinCruzar - 55) < 0.01 && Math.abs(cruzando - 57) < 0.01, `3q) con "cruzar" JOSE queda en 57 (5% solo sobre el saldo 60) y sin cruzar en 55 (dio ${cruzando} y ${sinCruzar})`);
  const htmlOf = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-oficinas.html'), 'utf8');
  check(/hipismoCruzarHabilitado !== false/.test(htmlOf) && /puedeCruzarJugadas\(\) && \$\('jCruzar'\)\.checked/.test(htmlOf), '3r) Oficinas respeta el interruptor "Cruzar jugadas" de Súper-admin igual que Grupos Hípicos');

  // ---------- 4) Interruptores del módulo ----------
  const leer = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  check(/modulo_hipismo_oficinas_habilitado boolean not null default false/.test(leer('sql/schema.sql')) && /jugadas_oficina jsonb/.test(leer('sql/schema.sql')), '4a) el SQL crea la columna del módulo (apagado por defecto) y jugadas_oficina');
  check(/modulo_hipismo_oficinas_habilitado/.test(leer('src/middleware/auth.js')), '4b) la sesión del grupo trae el interruptor');
  const auth = leer('src/routes/auth.js');
  check((auth.match(/moduloHipismoOficinasHabilitado/g) || []).length >= 2 && (auth.match(/modulo_hipismo_oficinas_habilitado/g) || []).length >= 3, '4c) el login (administrador y empleado) manda moduloHipismoOficinasHabilitado y no bloquea a un grupo que solo tiene Oficinas');
  const sa = leer('src/routes/superadmin.js');
  check(/router\.patch\('\/grupos\/:id\/modulo-hipismo-oficinas'/.test(sa) && /moduloHipismoOficinasHabilitado/.test(sa), '4d) Súper-admin tiene la ruta para activar/desactivar Oficinas');
  check(/!req\.grupo\.modulo_hipismo_habilitado && !req\.grupo\.modulo_hipismo_oficinas_habilitado/.test(leer('src/routes/hipismo.js')), '4e) las rutas de Hipismo dejan pasar a un grupo con solo Oficinas');
  const sah = leer('public/superadmin.html');
  check(/Módulo Hipismo Grupos Hípicos/.test(sah) && /Módulo Hipismo Oficinas/.test(sah) && /toggleModuloGrupo\('hipismo-oficinas'\)/.test(sah), '4f) Súper-admin muestra "Hipismo Grupos Hípicos" y el interruptor de "Hipismo Oficinas"');
  check(/Hipismo Grupos Hípicos/.test(leer('public/grupo.html')) && /Hipismo Grupos Hípicos/.test(leer('public/hipismo-mockup.html')), '4g) el selector de módulos llama "Hipismo Grupos Hípicos" al módulo de siempre');
  check(/hipismo-oficinas\.html/.test(leer('public/app.js')) && /moduloHipismoOficinasHabilitado/.test(leer('public/app.js')), '4h) un grupo con solo Oficinas entra derecho a su pantalla');

  // ---------- 5) La pantalla ----------
  const html = leer('public/hipismo-oficinas.html');
  ['Crear Hipódromo', 'Crear Cliente', 'Jugadas', 'Jugó', 'Dio', '/api/hipismo/oficinas/cuadre', '/api/hipismo/oficinas/guardar', '/api/hipismo/oficinas/siguiente-carrera', 'Faltan'].forEach(t => {
    check(html.includes(t), `5) la pantalla de Oficinas incluye "${t}"`);
  });
  check(/¿Se le devuelve un % a este cliente\?/.test(html) && /le genera % a otro cliente/.test(html), '5) Crear Cliente pregunta por el % que se le devuelve y el % que le genera a otro cliente');
  check(/moduloHipismoOficinasHabilitado/.test(html), '5) la pantalla exige tener el módulo Oficinas');
  check(/Registro de Jugadas/.test(html) && /panel-registro/.test(html) && /\/api\/hipismo\/oficinas\/registro\?fecha=/.test(html) && /\/api\/hipismo\/oficinas\/pendiente/.test(html), '5) la pestaña "Registro de Jugadas" existe y usa las rutas del Registro y de pendientes');
  check(/data-tab="configuracion"/.test(html) && /panel-configuracion/.test(html) && /Planos para grupos/.test(html) && /\/api\/hipismo\/oficinas\/configuracion/.test(html) && /id="cfgPlano"/.test(html), '5) hay un botón "Configuración" con la pestaña "Planos para grupos" y su interruptor');
  check(/if \(!CONFIG\.planoResuelto\) return;/.test(html), '5) con el plano resuelto apagado, la pantalla no lo muestra');
  check(/\.tabs \{[^}]*flex-direction: column/.test(html) && /grid-template-columns: 230px/.test(html), '5) el menú de botones va a la izquierda, uno debajo del otro');
  check(/abrirDelRegistro/.test(html) && /Guardar y calcular/.test(html) && /Guardar sin llegada/.test(html) && /volverAlRegistro/.test(html), '5) abrir una carrera desde el Registro, guardar y calcular / guardar sin llegada y volver');
  check(/modalNoExiste/.test(html) && /NO EXISTE/.test(html) && /clientesNoExisten/.test(html) && /focusout/.test(html), '5) la pantalla avisa en una ventana "CLIENTE X NO EXISTE" con el nombre');
  check(/modalNoExisteCrear/.test(html) && /irATab\('clientes'\)/.test(html), '5) la ventana ofrece ir a Crear Cliente con el nombre puesto');
  // El script de la página compila
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  try { new Function(script); check(true, '5) el script de la pantalla no tiene errores de sintaxis'); } catch (e) { check(false, '5) el script de la pantalla tiene error de sintaxis: ' + e.message); }

  // ---- 6) Marcas escritas como el usuario las escribe: Tipo "4x3" (o "4×3") / "marca" (06-11-2026) ----
  const ent = (tipo, caballo, lado) => oficinas.normalizarEntradas([{ jugador: 'LUSHO', lado: lado || 'jugo', tipo, caballo, monto: 300 }]);
  const e1 = ent('4×3', '4');
  check(e1.errores.length === 0 && e1.entradas[0].tipo === 'pp' && e1.entradas[0].caballo === '4x3', '6a) Tipo "4×3" + Caballo "4" = pp 4x3 (el caso de la captura)');
  check(ent('4x3', '3').entradas[0].caballo === '3x4', '6b) Tipo 4x3 con Caballo 3: juega con el 3, el cruce queda 3x4');
  check(ent('4x3', '').errores.length === 0 && ent('4x3', '').entradas[0].caballo === '4x3', '6c) Tipo 4x3 sin Caballo también vale');
  check(ent('marca', '3x4').entradas[0].tipo === 'pp' && ent('Marcas', '3X4').entradas[0].caballo === '3x4', '6d) Tipo "marca" + Caballo 3x4 = pp 3x4');
  check(ent('marca', '4').errores.length === 0 && ent('marca', '4').entradas[0].tipo === 'marca', '6e) "marca" con un solo caballo no se inventa nada (el motor avisará que no la reconoce)');
  check(ent('pp', '4x3').entradas[0].tipo === 'pp' && ent('2p', '4').entradas[0].caballo === '4', '6f) lo de siempre no cambia (pp 4x3, 2p 4)');
  const cuadreMarca = oficinas.calcularCuadre([
    { jugador: 'LUSHO', lado: 'jugo', tipo: '4×3', caballo: '4', monto: 300 },
    { jugador: 'RAUL', lado: 'dio', tipo: 'marca', caballo: '3x4', monto: 300 }]);
  check(cuadreMarca.cuadra && cuadreMarca.detalle.length === 1 && cuadreMarca.detalle[0].etiqueta === 'pp del 4x3', '6g) Lusho (4×3) y Raúl (marca 3x4) cuadran como un solo cruce');
  const parejaMarca = oficinas.emparejar([
    { jugador: 'LUSHO', lado: 'jugo', tipo: '4×3', caballo: '4', monto: 300 },
    { jugador: 'RAUL', lado: 'dio', tipo: 'pp', caballo: '3x4', monto: 300 }]);
  check(parejaMarca.length === 1 && parejaMarca[0].tipo === 'pp' && parejaMarca[0].caballo === '4x3' && parejaMarca[0].jugador === 'LUSHO', '6h) Lusho va con el 4 en el plano');
  check(oficinas.tiposNoReconocidos([{ jugador: 'LUSHO', lado: 'jugo', tipo: '4×3', caballo: '4', monto: 300 }]).length === 0, '6i) el motor reconoce la marca escrita como 4×3');
  check(/<option value="marca">/.test(html), '6j) la lista de tipos ofrece "marca"');
  check(/function esMarcaFila/.test(html) && /data-c="cab1"/.test(html) && /data-c="cab2"/.test(html) && /class="cab-par"/.test(html), '6k) con Tipo "Marca" la casilla Caballo se parte en dos (cab1 vs cab2)');
  const ep = (premio, cab) => oficinas.normalizarEntradas([{ jugador: 'LUIS', lado: 'jugo', tipo: 'Marca', caballo: cab || '3x4', premio, monto: 100 }]);
  check(ep('', '3x4').entradas[0].tipo === 'pp' && ep('pp').entradas[0].tipo === 'pp', '6m) Marca sin premio o con "pp" = pp (completo)');
  check(ep('10a8').entradas[0].tipo === '10a8' && ep('10A9').entradas[0].tipo === '10a9' && ep('7,5').entradas[0].tipo === '10a7,5' && ep('8').entradas[0].tipo === '10a8', '6n) Marca con premio 10a8 / 10A9 / 7,5 / 8 = a premio (10aN)');
  check(ep('10a8').entradas[0].caballo === '3x4', '6o) el premio no toca el cruce');
  check(oficinas.tiposNoReconocidos([{ jugador: 'L', lado: 'jugo', tipo: 'Marca', caballo: '3x4', premio: '10a8', monto: 100 }]).length === 0, '6p) el motor reconoce una marca 10a8');
  check(oficinas.tiposNoReconocidos([{ jugador: 'L', lado: 'jugo', tipo: 'Marca', caballo: '3x4', premio: 'xx', monto: 100 }]).length === 1, '6q) un premio mal escrito se avisa antes de guardar');
  const cu2 = oficinas.calcularCuadre([
    { jugador: 'LUIS', lado: 'jugo', tipo: 'Marca', caballo: '3x4', premio: '10a8', monto: 100 },
    { jugador: 'RAUL', lado: 'dio', tipo: 'Marca', caballo: '4x3', premio: '10a8', monto: 100 },
    { jugador: 'ANA', lado: 'jugo', tipo: 'Marca', caballo: '3x4', premio: 'pp', monto: 50 }]);
  check(!cu2.cuadra && cu2.detalle.length === 2 && cu2.detalle.find(d => d.etiqueta === '10a8 del 3x4').cuadra && !cu2.detalle.find(d => d.etiqueta === 'pp del 3x4').cuadra, '6r) cada premio cuadra por separado (10a8 aparte de pp)');
  const emp = oficinas.emparejar([
    { jugador: 'LUIS', lado: 'jugo', tipo: 'Marca', caballo: '3x4', premio: '10a8', monto: 100 },
    { jugador: 'RAUL', lado: 'dio', tipo: 'Marca', caballo: '4x3', premio: '10a8', monto: 100 }]);
  check(emp.length === 1 && emp[0].tipo === '10a8' && emp[0].caballo === '3x4', '6s) el plano queda "10a8 (3x4)" con Luis jugando el 3');
  check(/id="dlPremios"/.test(html) && /data-c="premio"/.test(html) && /function filaDeServidor/.test(html), '6t) la casilla del premio sale solo con Marca y trae sus opciones (pp, 10a9, 10a8…)');
  check(/esMarcaFila\(f\)\s*\?\s*170/.test(html), '6u) el premio solo aparece en filas de Marca');
  check(/function sincronizarMarca/.test(html) && /\$\{a\}x\$\{b\}/.test(html), '6l) las dos casillas se juntan como "AxB" para el servidor');

  // ---- 7) Avisos en Jugadas: pizarras que faltan y carrera que ya tiene jugadas (06-11-2026) ----
  check(/id="jPizarrasFaltan"/.test(html) && /function avisarPizarrasFaltan/.test(html) && /pendientes-periodo\?desde=/.test(html), '7a) Jugadas avisa de las pizarras (llegadas) que faltan por cargar usando las carreras guardadas sin llegada');
  check(/avisarPizarrasFaltan\(\);\s*\n\s*\}\s*catch|abrirSiguienteCarrera\(\);\s*\n\s*avisarPizarrasFaltan/.test(html) && /if \(t === 'jugadas'[^)]*\)[^\n]*avisarPizarrasFaltan/.test(html), '7b) el aviso de pizarras se refresca al guardar y al volver a Jugadas');
  check(/async function irAPizarraFalta/.test(html) && /data-carrera="\$\{c\.carrera\}"/.test(html), '7c) tocar una carrera sin pizarra la abre para cargarla');
  check(/id="modalYaCargada"/.test(html) && /Esta carrera ya tiene jugadas cargadas/.test(html) && /function preguntarYaCargada/.test(html), '7d) existe la ventana "Esta carrera ya tiene jugadas cargadas"');
  check(/<select id="jCarrera" onchange="cambioCarrera\(false, true\)">/.test(html) && /if \(preguntar && !enEdicion\(\)\)/.test(html), '7e) al elegir a mano una carrera ya cargada pregunta (no al abrirla desde el Registro ni desde los chips)');
  check(/modalYaCargadaOtra/.test(html) && /modalYaCargadaVer/.test(html) && /Escape/.test(html), '7f) la ventana deja elegir otra carrera o verla y corregirla');
  const rutaPend = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'routes', 'hipismo.js'), 'utf8');
  check(/router\.get\('\/oficinas\/pendientes-periodo'/.test(rutaPend) && /rangoPersonalizadoDeQuery\(req\)/.test(rutaPend), '7g) el servidor ya entrega las carreras sin llegada por rango de fechas');

  // ---- 8) Agregar más jugadas a una carrera ya cargada (06-11-2026) ----
  check(/async function agregarMasJugadas/.test(html) && /id="modalYaCargadaAgregar"/.test(html) && /Agregar más jugadas/.test(html), '8a) existe la opción "Agregar más jugadas" (ventana de carrera ya cargada)');
  check(/AGREGANDO = \{ hipodromoId/.test(html) && /tr\.classList\.add\('fila-existente'\)/.test(html) && /el\.disabled = true/.test(html), '8b) las jugadas que ya estaban quedan bloqueadas y las nuevas van debajo');
  check(/\$\('jPizarra'\)\.value = r\.pizarra \|\| ''; \$\('jRet'\)\.value = r\.ret \|\| ''/.test(html) && /\$\('jPizarra'\)\.readOnly = true/.test(html), '8c) la carrera se abre con la pizarra que ya tenía (bloqueada) para calcular las nuevas jugadas sin volver a cargarla');
  check(/Guardar jugadas nuevas y calcular/.test(html) && /se calcularon con la pizarra que ya tenía/.test(html), '8d) el botón y el mensaje hablan de jugadas nuevas calculadas con la pizarra existente');
  check(/agregarDelRegistro/.test(html) && /➕ Agregar<\/button>/.test(html), '8e) el Registro tiene el botón "➕ Agregar" por carrera');
  check(/Cargada como plano en Grupos Hípicos \(sin tabla\): igual se muestra su pizarra/.test(html), '8f) una carrera cargada como plano también muestra su pizarra al elegirla');
  const oficinasMerge = oficinas.calcularCuadre([
    { jugador: 'LUIS', lado: 'jugo', tipo: '1p', caballo: '3', monto: 100 }, { jugador: 'RAUL', lado: 'dio', tipo: '1p', caballo: '3', monto: 100 },
    { jugador: 'ANA', lado: 'jugo', tipo: '1p', caballo: '5', monto: 200 }, { jugador: 'PEDRO', lado: 'dio', tipo: '1p', caballo: '5', monto: 200 }]);
  check(oficinasMerge.cuadra && oficinasMerge.detalle.length === 2, '8g) las jugadas de siempre + las nuevas cuadran juntas (la tabla se guarda completa y se calcula con la misma pizarra)');

  // ---- 9) Listas despegables con búsqueda por teclado (06-11-2026) ----
  check(/\$\{esc\(nombreHip\(i\.nombre\)\)\} \$\{BANDERA_PAIS\[pais\]\}<\/option>/.test(html) && !/>\$\{BANDERA_PAIS\[pais\]\} \$\{esc\(nombreHip/.test(html), '9a) en la lista de hipódromos la bandera va AL FINAL: tecleando una letra salta al nombre que empieza con ella');
  check(/<select id="jCarrera"/.test(html) && /function armarOpcionesCarrera/.test(html) && /function ponerCarrera/.test(html), '9b) la carrera es una lista despegable 1..N (se salta tecleando el número)');
  check(!/\$\('jCarrera'\)\.value = (?!n \? String)/.test(html.replace(/\$\('jCarrera'\)\.value = n \? String\(n\) : ''/, '')), '9c) ningún sitio asigna jCarrera a mano: todos pasan por ponerCarrera (que crea la opción si no existe)');
  check(/<select id="jCopiarN"/.test(html), '9d) "Copiar de otra carrera" también es lista (solo las carreras ya cargadas)');
  // 9e) Módulo Hipismo / Grupos: mismas listas de hipódromos con la bandera AL FINAL (06-11-2026)
  const mock = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const opcionesHip = mock.match(/<option value="\$\{[^"]*h\.nombre[^"]*\}">[^`]*<\/option>/g) || [];
  const conBandera = opcionesHip.filter(o => /banderaPorPais/.test(o));
  check(conBandera.length >= 8 && conBandera.every(o => /h\.nombre\)?\} \$\{banderaPorPais\[h\.pais\]/.test(o)), '9e) en el módulo Hipismo/Grupos todas las listas de hipódromos llevan la bandera al final (' + conBandera.length + ' listas)');
  // 9f) Salto por letras (06-11-2026): la lista muestra todo y cada letra pasa al siguiente que empieza con ella, sin fin
  const vm = require('vm');
  const codigoBL = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'buscador-lista.js'), 'utf8');
  const ctxBL = { window: {}, document: { addEventListener() {}, removeEventListener() {} } };
  vm.createContext(ctxBL); vm.runInContext(codigoBL, ctxBL);
  const BL = ctxBL.window.BuscadorLista;
  const ops = ['— Elige —', 'La Rinconada 🇻🇪', 'Valencia 🇻🇪', 'Tampa Bay Downs 🇺🇸', 'Turfway Park 🇺🇸', 'Santa Anita 🇺🇸', 'Tampa Extra 🇺🇸'].map(t => ({ valor: t, texto: t, grupo: '', off: false }));
  let pos = 0; const vuelta = [];
  for (let i = 0; i < 7; i++) { pos = BL.siguienteCoincidencia(ops, pos, 't'); vuelta.push(ops[pos].texto.replace(/ 🇺🇸/, '')); }
  check(JSON.stringify(vuelta) === JSON.stringify(['Tampa Bay Downs', 'Turfway Park', 'Tampa Extra', 'Tampa Bay Downs', 'Turfway Park', 'Tampa Extra', 'Tampa Bay Downs']), '9f) pulsar "t" una y otra vez recorre los hipódromos con T y vuelve al primero, sin fin');
  check(BL.siguienteCoincidencia(ops, 3, 'tt') === 4 && BL.siguienteCoincidencia(ops, 3, 'tam') === 3 && BL.siguienteCoincidencia(ops, 3, 'tur') === 4, '9g) "tt" equivale a pulsar t otra vez; varias letras distintas ("tam", "tur") buscan el nombre que empieza igual');
  check(BL.siguienteCoincidencia(ops, 0, 'sánta') === 5 && BL.siguienteCoincidencia(ops, 0, 'park') === 4 && BL.siguienteCoincidencia(ops, 0, 'zzz') === -1, '9h) ignora acentos, encuentra por palabra ("park") y devuelve -1 si nada coincide');
  check(!/filtrar/.test(codigoBL) && /bl-lista/.test(codigoBL), '9h2) la lista ya no se filtra: siempre se ven todos los hipódromos');
  const htmlMock = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const idsMock = ['selHipodromo', 'vpHipodromo', 'selHipodromoRemate', 'selHipodromoRemateManual', 'selHipodromoAdelantadas', 'selHipodromoTerciosAdelantadas', 'selHipodromoWinners', 'selHipodromoRevisar', 'selCmeHipodromo'];
  check(/<script src="buscador-lista\.js"><\/script>/.test(html) && /<script src="buscador-lista\.js"><\/script>/.test(htmlMock) && /<select id="jHipodromo" data-buscar/.test(html) && /<select id="rHipodromo" data-buscar/.test(html) && idsMock.every(i => new RegExp('<select id="' + i + '" data-buscar').test(htmlMock)), '9i) las listas de hipódromos de Oficinas y de Hipismo/Grupos usan el buscador');
  check(/👤 Crear Cliente u Oficina<\/button>/.test(html) && /<h2>Crear cliente u oficina<\/h2>/.test(html), '9j) la pestaña y el título se llaman "Crear cliente u oficina"');
  check(/function asegurarFilaLibre/.test(html) && /function ultimaFilaCompleta/.test(html) && /alEscribirFila\(t\);\n  asegurarFilaLibre\(\);/.test(html), '10a) al completar la última fila (jugador y monto) se crea sola una fila nueva, de a una');
  const portal = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'hipismo-cliente-portal.html'), 'utf8');
  check(/\.informe \.inf-logo-fondo \{[^}]*z-index: 2;/.test(html) && /LOGO_LUDOX_MARCA/.test(html), '11a) la marca de agua de los informes va ENCIMA del contenido (tenue) y usa el logo de Ludox si el grupo no tiene uno');
  check(/\.marca-agua \{[^}]*pointer-events: none/.test(portal) && /id="marcaAgua"/.test(portal) && /marca\.style\.backgroundImage/.test(portal), '11b) el link del cliente también lleva la marca de agua (sin capturar clics)');
  const ma = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'marca-agua.js'), 'utf8');
  check(/<script src="marca-agua\.js"><\/script>/.test(html) && /<script src="marca-agua\.js"><\/script>/.test(portal) && /MarcaAgua\.preparar\(logo\)/.test(html) && /MarcaAgua\.preparar\(data\.grupo\.logoUrl/.test(portal), '11c) un logo blanco sin fondo se oscurece solo para la marca de agua (informes, PDF y link del cliente)');
  const ctxMA = { window: {}, document: {}, Image: function () {} }; require('vm').createContext(ctxMA); require('vm').runInContext(ma, ctxMA);
  const claro = new Uint8ClampedArray([255, 255, 255, 255, 250, 250, 250, 200, 0, 0, 0, 0]), oscuro = new Uint8ClampedArray([20, 20, 20, 255, 30, 60, 90, 255]), color = new Uint8ClampedArray([200, 40, 40, 255, 40, 80, 200, 255]);
  check(ctxMA.window.MarcaAgua.esClaro(claro) && !ctxMA.window.MarcaAgua.esClaro(oscuro) && !ctxMA.window.MarcaAgua.esClaro(color), '11d) detecta si el logo es claro (blanco) para oscurecerlo; los oscuros o de colores quedan como están');

  // ---- 12) Tipo de cliente (Tercio / Oficina) y link de Oficinas (06-11-2026) ----
  const rutaJug = leer('src/routes/jugadores.js'), rutaHip = leer('src/routes/hipismo.js'), dbjs = leer('src/db.js');
  check(/name="cTipo" value="tercio" checked/.test(html) && /name="cTipo" value="oficina"/.test(html) && !/cliente normal|lleva % de devolución/.test(html.slice(html.indexOf('id="cTipoSel"'), html.indexOf('id="cTipoSel"') + 700)),
    '12a) el formulario tiene el selector Tipo (Tercio por defecto / Oficina), sin textos debajo de cada opción');
  check(/ICO_TIPO/.test(html) && /<circle cx="12" cy="8" r="4"\/>/.test(html) && /<rect x="4" y="3" width="16" height="18"/.test(html), '12b) cada tipo lleva su icono (persona = Tercio, edificio = Oficina)');
  check(!/cDevuelvePregunta|cTercioNota/.test(html) && /if \(valorRadio\('cDevuelve'\) === 'si'\) \{\s*comisionPropia =/.test(html) && /avalesPorcentaje, tipoCliente/.test(html),
    '12c) el Tercio TAMBIÉN lleva las preguntas del % de devolución (el tipo es solo una etiqueta); el tipo viaja al servidor');
  check(/name="cPozoSi" value="libre"/.test(html) && /Tercio libre/.test(html) && /sinPozo: valorRadio\('cPozoSi'\) === 'no' && !\$\('cPagoDiario'\)\.checked/.test(html) && /cPozoExplica/.test(html),
    '12c2) la pregunta del pozo tiene 3 opciones (No = sin pozo, Sí = con pozo, Tercio libre) y se explica cada una');
  check(/etiquetaTipo\(c\)/.test(html) && /cambiarTipoCliente\(/.test(html) && /\/tipo-cliente'/.test(html), '12d) la lista muestra la etiqueta del tipo y permite cambiarlo');
  check(/tipo_cliente text not null default 'tercio'/.test(dbjs) && /update jugadores set tipo_cliente = 'oficina' where coalesce\(comision_propia, 0\) > 0/.test(dbjs) && /if not exists \(select 1 from information_schema\.columns where table_name = 'jugadores' and column_name = 'tipo_cliente'\)/.test(dbjs),
    '12e) la columna se crea sola y clasifica UNA sola vez a los existentes (con % = oficina, sin % = tercio)');
  const sqlPend = leer('sql/pendiente-06-11-2026.sql'), sqlTodo = leer('sql/schema.sql');
  check(sqlPend.includes('tipo_cliente') && sqlTodo.includes(sqlPend.trim()), '12f) el SQL está en el archivo pendiente y al final de schema.sql (completo)');
  check(/resolverTipoCliente/.test(rutaJug) && !/tipoCliente === 'tercio'\) \{ comisionPropia = 0/.test(rutaJug) && /guardarTipoCliente\(jugador\.id, req\.grupoId, tipoCliente\)/.test(rutaJug) && /guardarSinPozo\(jugador\.id, req\.grupoId, req\.body\.sinPozo, tipo\)/.test(rutaJug),
    '12g) crear cliente guarda el tipo y la marca "sin pozo" (aparte, toleran la columna ausente); un Tercio también guarda su %');
  check(/router\.put\('\/clientes\/:id\/tipo-cliente'/.test(rutaHip) && !/todavía tiene % de devolución/.test(rutaHip) && /router\.put\('\/clientes\/:id\/sin-pozo'/.test(rutaHip) && /tipo_cuenta = 'libre'/.test(rutaHip), '12h) las rutas de cambio de tipo y de "sin pozo / libre" existen (el sin pozo solo aplica a clientes libres)');
  check(/sin_pozo boolean not null default false/i.test(dbjs) && sqlTodo.includes('add column if not exists sin_pozo boolean not null default false') && leer('sql/pendiente-06-11-2026.sql').includes('sin_pozo'), '12h2) la columna sin_pozo se crea sola, está en schema.sql y en el pendiente');
  const alertaPozo = leer('src/services/hipismoAlertaPozo.js');
  check(/incluirSinPozo: true/.test(alertaPozo) && /sinPozo: !!c\.sinPozo/.test(alertaPozo) && /todavía NO tiene pozo: aún no puede jugar/.test(alertaPozo), '12h3) cargar una jugada a un cliente "sin pozo" genera la alerta (apostó X pero todavía no tiene pozo)');
  const mejorasJs = leer('public/oficinas-mejoras.js');
  check(/Sin pozo, aún no puede jugar/.test(mejorasJs) && /c\.sin_pozo === true/.test(mejorasJs) && /alternarSinPozo/.test(html) && /Tercio libre/.test(html), '12h4) la tabla de jugadas avisa de un cliente sin pozo y la lista permite pasarlo a libre o dejarlo sin pozo');
  check(/formato=oficinas&/.test(html) && /devolucion-propia/.test(html) && /\.lin-dev/.test(html), '12i) el Detallado de Oficinas pide el % dentro de la carrera y lo pinta');
  check(/id="cPagoDiarioWrap"/.test(html) && /\$\('cPagoDiarioWrap'\)\.classList\.toggle\('oculto', esOf\)/.test(html) && /if \(esOf\) \$\('cPagoDiario'\)\.checked = false/.test(html), '12p) al elegir Oficina desaparece "Cliente de pago diario" (y se desmarca)');
  check(/¿Se le devuelve un % a esta oficina\?/.test(html) && /¿Esta oficina le genera % a otra oficina o a un cliente\?/.test(html) && /¿Esta oficina tiene pozo\?/.test(html) && /esOf \? 'Libre' : 'Tercio libre'/.test(html), '12q) con Oficina las preguntas hablan de "esta oficina" y la opción libre se llama "Libre"');
  check(/tipoDeCliente\(c\) === 'oficina' && !c\.pago_diario \? ''/.test(html), '12r) en la lista, una oficina no ofrece "Marcar pago diario"');
  check(/async function refrescarLogoGrupo\(\)/.test(html) && /await fetch\(url\)/.test(html) && /zenyatta_logo_chequeo_/.test(html) && !/no-cache/.test(html.slice(html.indexOf('async function refrescarLogoGrupo'))) && /GRUPO\.logoUrl = tiene \? url : null/.test(html) && /\nrefrescarLogoGrupo\(\);/.test(html), '12s) al abrir la página se consulta el logo REAL del grupo (aunque la sesión sea vieja) para la marca de agua');
  const por=fs.readFileSync(path.join(__dirname,'..','public','oficinas-cliente-portal.html'),'utf8'), vie=fs.readFileSync(path.join(__dirname,'..','public','hipismo-cliente-portal.html'),'utf8');
  check(/zenyatta_logo_chequeo_[\s\S]{0,200}10 \* 60 \* 1000/.test(html), '12t) el chequeo del logo se hace a lo sumo 1 vez cada 10 min por pestaña (no pesa en Supabase) y usa la caché HTTP normal');
  check(/oficinas_portal_precarga/.test(vie) && /tomarPrecarga/.test(por) && /oficinas_portal_precarga/.test(por), '12u) la redirección al link nuevo reutiliza el resumen ya descargado (no duplica la consulta pesada)');
  check(/data-tab="links"/.test(html) && /id="panel-links"/.test(html) && /if \(t === 'links'\) cargarLinks\(\)/.test(html), '12v) existe la pestaña "Links" de Oficinas');
  check(/Saludos \$\{tituloNombre\(c\.nombre\)\}[\s\S]{0,200}oficina de confianza \$\{tituloNombre\(GRUPO\.nombre\)\}/.test(html) && /🏇/.test(html) && /💰/.test(html) && /💵/.test(html) && /operativo las 24 horas/.test(html), '12w) el mensaje a copiar lleva el nombre del cliente y de la oficina del grupo, con emojis de caballo y dinero');
  check(!/lk-ejemplo|Solo enlace/.test(html), '12x) la ventana Links no tiene cuadro de ejemplo ni botón "Solo enlace"');
  check(/function cargarLinks\(forzar\)[\s\S]{0,120}!CLIENTES\.length/.test(html), '12y) Links no vuelve a pedir la lista de clientes si ya está cargada (no pesa en Supabase)');
  check(/id="jAyudaGuardar"/.test(html) && /Para guardarla falta elegir/.test(html) && /CUADRE_OK && faltaHip/.test(html), '15d) si la carrera cuadra pero falta elegir hipódromo o carrera, la pantalla lo dice (y marca la casilla) en vez de dejar el botón gris sin explicación');
  { const Fx = (j, l, t, c, m) => ({ jugador: j, lado: l, tipo: t, caballo: c, monto: m });
    const base = [Fx('Andres', 'jugo', '2p', '8', 600), Fx('The book', 'dio', '2p', '8', 300), Fx('Robert', 'dio', '2p', '8', 300)];
    const conLibre = oficinas.calcularCuadre(base.concat([Fx('', 'jugo', '2p', '8', '')]));
    check(conLibre.cuadra === true && conLibre.errores.length === 0 && conLibre.mensajes.length === 0, '15a) la fila libre que abre sola la pantalla (con tipo y caballo ya puestos, sin jugador ni monto) NO cuenta como error: la carrera cuadra');
    const sinJug = oficinas.calcularCuadre([Fx('', 'jugo', '2p', '8', 300), Fx('Pedro', 'dio', '2p', '8', 300)]);
    const sinMonto = oficinas.calcularCuadre([Fx('Ana', 'jugo', '2p', '8', ''), Fx('Pedro', 'dio', '2p', '8', 300)]);
    check(sinJug.cuadra === false && sinJug.errores[0].error === 'Falta el jugador.' && sinMonto.cuadra === false && /monto/.test(sinMonto.errores[0].error), '15b) una fila con monto pero sin jugador (o jugador sin monto) sigue siendo un error');
    check(oficinas.emparejar(base.concat([Fx('', 'jugo', '2p', '8', '')])).length === 2, '15c) la fila libre tampoco entra al emparejamiento ni al guardado'); }
  check(/data-tab="pizarras"/.test(html) && /id="panel-pizarras"/.test(html) && /if \(t === 'pizarras'\) pzAbrirPestana\(\)/.test(html), '14a) existe la pestaña "Pizarras" de Oficinas');
  check(/async function pzGuardar\(\)[\s\S]{0,1800}\/api\/hipismo\/oficinas\/guardar[\s\S]{0,500}filas: r\.filas\.map\(filaDeServidor\)[\s\S]{0,400}\/api\/hipismo\/pizarras\/tercios\//.test(html), '14b) guardar la pizarra vuelve a guardar la carrera con TODAS sus jugadas (recalcula todas); las cargadas como plano usan /pizarras/tercios/:id');
  check(/Antes: \$\{r\.pizarra\}[\s\S]{0,200}Se recalcularán todas las jugadas/.test(html) && /No hay nada que cambiar|nada que cambiar/.test(html) && /todavía no tiene jugadas cargadas/.test(html), '14c) al modificar una pizarra ya cargada pide confirmación; sin jugadas ofrece ir a cargarlas');
  check(/siguiente-carrera\?hipodromoId=[\s\S]{0,200}pzFecha/.test(html) && !/setInterval/.test(html.slice(html.indexOf('PIZARRAS: ver'), html.indexOf('function irATab'))), '14d) Pizarras solo consulta al elegir hipódromo/carrera (sin temporizadores: no pesa en Supabase)');
  check(/router\.delete\('\/clientes\/:id', requierePermisoOficina\('oficinas_eliminar'\)/.test(rutaHip) && /DELETE FROM jugadores WHERE id = \$1 AND grupo_id = \$2/.test(rutaHip), '13a) eliminar cliente/oficina: ruta propia, solo del grupo de la sesión y con permiso oficinas_eliminar para empleados');
  check(/eliminarClienteOficina\('\$\{esc\(c\.id\)\}'\)/.test(html) && /puedeOficina\('oficinas_eliminar'\)/.test(html) && /async function eliminarClienteOficina\(id\)[\s\S]{0,900}confirm\([\s\S]{0,700}NO se borran[\s\S]{0,200}method: 'DELETE'/.test(html), '13b) la lista de clientes tiene el botón Eliminar, que pide confirmación y avisa que no borra las jugadas');
  check(/<path d="\$\{CABALLO_PATH\}" fill="\$\{c\.bg\}"/.test(vie) && !/fill="#8d8d8d"/.test(vie), '12z) en el link de Grupos Hípicos la cabeza del caballo va del mismo color que su número (no gris)');
  const informes = require(path.join(__dirname, '..', 'public', 'oficinas-informes.js'));
  const det = informes.armarDetalleCliente({ dias: [{ fecha: '2026-11-06', hipodromos: [{ nombre: 'gulfstream park', carreras: [
    { carrera: 2, rol: 'jugador', modalidad: 'pp', caballoA: 4, caballoB: 3, monto: 80, resultado: -80 },
    { carrera: 2, tipo: 'devolucion-propia', porcentaje: 5, monto: 80, resultado: 4 }] }] }], resumen: { totalSemana: -76 } });
  const car2 = det.dias[0].hipodromos[0].carreras[0];
  check(car2.lineas.length === 2 && car2.total === -76 && det.totalPeriodo === -76 && car2.lineas[1].jugada === null && /% devuelto 5% de 80,00/.test(car2.lineas[1].texto.replace(/\s/g, ' ')),
    '12j) el Detallado agrupa el % devuelto dentro de su carrera y la carrera lo incluye en su total');
  const portalOf = leer('public/oficinas-cliente-portal.html'), portalViejo = leer('public/hipismo-cliente-portal.html');
  check(/class="dia-tit" role="button"/.test(portalOf) && /class="car-cab" role="button"/.test(portalOf) && /di === ultimo \? '' : ' cerrado'/.test(portalOf) && /car-caja cerrada/.test(portalOf) && /id="btnTodo"/.test(portalOf),
    '12k) el link de Oficinas tiene días y carreras plegables (último día abierto, resto cerrado) y un botón Abrir/Cerrar todo');
  check(/oficinas-informes\.js/.test(portalOf) && /marca-agua\.js/.test(portalOf) && /\/api\/hipismo-cliente\//.test(portalOf) && /MarcaAgua\.preparar\(data\.grupo\.logoUrl/.test(portalOf), '12l) el link de Oficinas usa el mismo servidor/token, los helpers de informes y la marca de agua');
  check(/if \(data\.formatoOficinas\) \{[\s\S]{0,600}location\.replace\('oficinas-cliente-portal\.html\?token='/.test(portalViejo), '12m) el link viejo redirige a la página nueva en grupos de Oficinas (los links ya enviados siguen sirviendo)');
  const servicio = leer('src/services/hipismoResumenCliente.js');
  check(/formatoOficinas: devolucionEnCarreraPorDefecto\(grupo\)/.test(servicio) && /modulo_hipismo_oficinas_habilitado && !grupo\.modulo_hipismo_habilitado/.test(servicio), '12n) la respuesta del link avisa formatoOficinas solo para grupos con Oficinas y sin Grupos Hípicos');
  const vmCtx = { window: {}, document: { getElementById: () => ({}), querySelectorAll: () => [], addEventListener() {} }, location: { search: '?token=x' }, fetch: async () => ({}), console };
  const scriptsPortal = [...portalOf.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  let compila = true; try { new (require('vm').Script)(scriptsPortal); } catch (e) { compila = false; }
  check(compila, '12o) el script de la página nueva compila');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  if (fallaron) process.exit(1);
})();
