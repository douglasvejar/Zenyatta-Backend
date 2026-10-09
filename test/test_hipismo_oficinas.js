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

  r = await invocarRuta(handlerDe('post', '/oficinas/guardar'), { ...base, body: { filas: [...tabla.slice(0, 2), F('pedro', 'dio', '1p', '3', 350), F('x', 'jugo', 'zz', '3', 5), F('y', 'dio', 'zz', '3', 5)], pizarra: '3-1-2', hipodromoId: 'h-gulf', carreraNumero: 1, fecha: '2026-10-09' } });
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
  // El script de la página compila
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  try { new Function(script); check(true, '5) el script de la pantalla no tiene errores de sintaxis'); } catch (e) { check(false, '5) el script de la pantalla tiene error de sintaxis: ' + e.message); }

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  if (fallaron) process.exit(1);
})();
