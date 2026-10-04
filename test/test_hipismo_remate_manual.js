// =================================================================
// PRUEBA: "Cargar Remate Manual" en modo NETO DIRECTO (04-10-2026, a
// pedido del usuario: "aqui en remate manual, no quiero colcoar pizarra
// ni comision ni anda solo sleccionar el dia el hipodromo y la carrerra,
// elegir caballo el jugador y te voy a colocar el monto neto de cuanto
// se gana cada uno o cuanto pierde ... si la lista el cliente que gana
// contra los clientes que pierden falta dinero para pagarle al que gana
// el item remate en esa carrera saldria - lo faltante .... si es al
// revez todo lo que los tercios pierdan sobra dinero ... eso se lo
// ganaria el remate").
//
// Cubre los endpoints nuevos/tocados de routes/hipismo.js:
//   - POST /remates/manual (guarda directo, sin pizarra/comisión/pool)
//   - DELETE /remates/manual/:id (borrado permanente, solo modo='manual')
//   - GET /remates?modo=manual (listado filtrado)
//   - GET /pizarras: un Remate Manual NUNCA aparece como "pendiente de
//     pizarra" (se excluye con modo <> 'manual')
//   - PUT/DELETE /pizarras/remate/:id: rechazan un Remate Manual (400) —
//     ese motor de pool/comisión no aplica acá
//   - GET /clientes/REMATE/detalle-semana (construirResumenRemateHipismo):
//     un Remate Manual aparece con modo:'manual'
//
// Casos cubiertos:
//   1. POST /remates/manual: "falta dinero" (los netos ganados > lo que
//      pagan los que pierden) -> comision_total NEGATIVO (lo pone la banca).
//   2. POST /remates/manual: "sobra dinero" (lo que pierden los tercios >
//      lo ganado) -> comision_total POSITIVO (se lo gana la banca).
//   3. Validaciones: sin hipódromo, sin líneas válidas, montos en 0 se ignoran.
//   4. GET /remates?modo=manual trae solo los manuales.
//   5. GET /pizarras NUNCA lista un Remate Manual (ni de pendiente ni de cargado).
//   6. PUT /pizarras/remate/:id y DELETE /pizarras/remate/:id responden
//      400 sobre un Remate Manual, con mensaje explicando por qué.
//   7. DELETE /remates/manual/:id borra la fila entera (cascada a sus
//      apuestas) y nunca borra un remate de pool (sigue siendo modo='pool').
//   8. GET /clientes/REMATE/detalle-semana: el Remate Manual aparece con
//      modo:'manual' y el resultado correcto (espejo de la suma de netos).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-remate-manual-1';
const TABLAS = {
  jugadores: [
    { id: 'j-lusho', grupo_id: GRUPO_ID, nombre: 'LUSHO', comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false },
    { id: 'j-carla', grupo_id: GRUPO_ID, nombre: 'CARLA', comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false },
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false }
  ],
  hipismo_remates: [],
  hipismo_remate_apuestas: [],
  hipismo_alertas: []
};
let seq = 1;
const nuevoId = (prefijo) => prefijo + (seq++);

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // autoRegistrarJugadores() -- todos los nombres de esta prueba ya
  // existen en TABLAS.jugadores, así que nunca hace falta insertar nada
  // nuevo (se simula igual, por si acaso).
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    if (!TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      TABLAS.jugadores.push({ id: nuevoId('j'), grupo_id: grupoId, nombre, comision_propia: 0, cuenta_comision_id: null, incluir_porcentaje_en_jugadas: false });
    }
    return { rows: [] };
  }

  // asegurarCuentasComisionParaNombres() -- ningún jugador de esta
  // prueba tiene % propio, así que nunca crea ninguna cuenta aparte.
  if (/^SELECT id, nombre, comision_propia, cuenta_comision_id.*FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return { rows: filas.map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cuenta_comision_id: j.cuenta_comision_id || null, incluir_porcentaje_en_jugadas: !!j.incluir_porcentaje_en_jugadas })) };
  }

  // POST /remates/manual: INSERT hipismo_remates (19 columnas, con "modo" al final).
  if (/^INSERT INTO hipismo_remates/i.test(sql)) {
    const [grupoId, hipodromoId, hipodromoNombre, carreraNumero, fecha, textoOriginal, comisionPorcentaje, garantia, pagoFijo,
      poolTotal, pizarra, numeroGanador, huboGanador, caballoGanador, clienteGanador, pagoGanador, comisionTotal, textoResultado, modo] = params;
    const fila = {
      id: nuevoId('rem'), grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre,
      carrera_numero: carreraNumero, fecha, texto_original: textoOriginal, comision_porcentaje: comisionPorcentaje,
      garantia, pago_fijo: pagoFijo, pool_total: poolTotal, pizarra, numero_ganador: numeroGanador, hubo_ganador: huboGanador,
      caballo_ganador: caballoGanador, cliente_ganador: clienteGanador, pago_ganador: pagoGanador,
      comision_total: comisionTotal, texto_resultado: textoResultado, modo, creado_en: Date.now() + (seq++ / 1000)
    };
    TABLAS.hipismo_remates.push(fila);
    return { rows: [fila] };
  }
  if (/^INSERT INTO hipismo_remate_apuestas/i.test(sql)) {
    const [remateId, grupoId, numeroEjemplar, caballo, clienteNombre, monto, resultado] = params;
    const fila = { id: nuevoId('apu'), remate_id: remateId, grupo_id: grupoId, numero_ejemplar: numeroEjemplar, caballo, cliente_nombre: clienteNombre, monto, resultado };
    TABLAS.hipismo_remate_apuestas.push(fila);
    return { rows: [fila] };
  }

  // GET /remates?modo=&fecha=&hipodromoId=&limite=
  if (/^SELECT id, hipodromo_nombre, carrera_numero, fecha, comision_porcentaje, garantia, pool_total, hubo_ganador, cliente_ganador, pago_ganador, comision_total, modo, creado_en\s+FROM hipismo_remates WHERE/i.test(sql)) {
    // Reconstruye el filtro a mano según cuántos params vinieron (mismo
    // orden que arma la ruta: grupo_id siempre primero, luego fecha/
    // hipodromoId/modo opcionales, limite siempre último).
    let filas = TABLAS.hipismo_remates.filter(r => r.grupo_id === params[0]);
    const condiciones = sql.match(/WHERE (.+) ORDER BY/)[1];
    let idx = 1;
    if (condiciones.includes('fecha = $')) { filas = filas.filter(r => r.fecha === params[idx]); idx++; }
    if (condiciones.includes('hipodromo_id = $')) { filas = filas.filter(r => r.hipodromo_id === params[idx]); idx++; }
    if (condiciones.includes('modo = $')) { filas = filas.filter(r => r.modo === params[idx]); idx++; }
    const limite = params[params.length - 1];
    filas = filas.slice().sort((a, b) => b.creado_en - a.creado_en).slice(0, limite);
    return { rows: filas };
  }

  // DELETE /remates/manual/:id, PUT/DELETE /pizarras/remate/:id: lookup.
  if (/^SELECT \* FROM hipismo_remates WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const r = TABLAS.hipismo_remates.find(x => x.id === id && x.grupo_id === grupoId);
    return { rows: r ? [r] : [] };
  }
  if (/^DELETE FROM hipismo_remates WHERE id = \$1$/i.test(sql)) {
    const [id] = params;
    TABLAS.hipismo_remates = TABLAS.hipismo_remates.filter(r => r.id !== id);
    TABLAS.hipismo_remate_apuestas = TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id !== id);
    return { rows: [] };
  }

  // GET /pizarras (planos de Tercios y Jugadas Adelantadas: vacío en esta
  // prueba, solo importa el bloque de Remates).
  if (/^SELECT p\.id, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero, p\.pizarra, p\.comision_total/i.test(sql)) return { rows: [] };
  if (/^SELECT p\.fecha, p\.hipodromo_nombre, j\.carrera_numero, COUNT/i.test(sql)) return { rows: [] };
  if (/^SELECT r\.id, r\.fecha, r\.hipodromo_nombre, r\.carrera_numero, r\.pizarra, r\.pool_total, \(SELECT COUNT\(\*\)::int FROM hipismo_remate_apuestas a WHERE a\.remate_id = r\.id\) AS cantidad\s+FROM hipismo_remates r\s+WHERE r\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3 AND r\.modo <> 'manual'/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remates
      .filter(r => r.grupo_id === grupoId && r.fecha >= desde && r.fecha <= hasta && r.modo !== 'manual')
      .map(r => ({
        id: r.id, fecha: r.fecha, hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero,
        pizarra: r.pizarra, pool_total: r.pool_total,
        cantidad: TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === r.id).length
      }));
    return { rows: filas };
  }
  // calcularDevueltoPorPlanoTercios con lista vacía de planos -- no debe
  // ni consultar nada (ver la nota grande de esa función), pero por las
  // dudas se responde vacío igual.
  if (/^SELECT plano_id, cliente_nombre, banquero_nombre, monto, resultado_jugador, resultado_banquero, sin_comision FROM hipismo_tickets WHERE plano_id = ANY/i.test(sql)) {
    return { rows: [] };
  }

  // GET /clientes/REMATE/detalle-semana (construirResumenRemateHipismo).
  if (/^SELECT hipodromo_nombre, carrera_numero, fecha, pizarra, pool_total, pago_ganador, comision_total, comision_porcentaje, garantia, pago_fijo, hubo_ganador, modo FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3 ORDER BY fecha DESC, creado_en ASC$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remates
      .filter(r => r.grupo_id === grupoId && r.fecha >= desde && r.fecha <= hasta)
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.creado_en - b.creado_en));
    return {
      rows: filas.map(r => ({
        hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero, fecha: r.fecha, pizarra: r.pizarra,
        pool_total: r.pool_total, pago_ganador: r.pago_ganador, comision_total: r.comision_total,
        comision_porcentaje: r.comision_porcentaje, garantia: r.garantia, pago_fijo: r.pago_fijo, hubo_ganador: r.hubo_ganador,
        modo: r.modo
      }))
    };
  }

  // registrarAlerta()
  if (/^INSERT INTO hipismo_alertas/i.test(sql)) {
    TABLAS.hipismo_alertas.push({ tipo: params[1], hipodromoNombre: params[3], carreraNumero: params[4], mensaje: params[6] });
    return { rows: [] };
  }

  throw new Error('La base de datos falsa de esta prueba (remate manual) no sabe responder: ' + sql);
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
const handlerGuardarManual = handlerDe('post', '/remates/manual');
const handlerEliminarManual = handlerDe('delete', '/remates/manual/:id');
const handlerListar = handlerDe('get', '/remates');
const handlerPizarras = handlerDe('get', '/pizarras');
const handlerPutPizarraRemate = handlerDe('put', '/pizarras/remate/:id');
const handlerDeletePizarraRemate = handlerDe('delete', '/pizarras/remate/:id');
const handlerDetalleSemana = handlerDe('get', '/clientes/:nombre/detalle-semana');

function invocarRuta(handler, req, params) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    handler(Object.assign({ params: params || {} }, req), res, (err) => { if (err) reject(err); });
  });
}
function reqBase(query, body) {
  return { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, query: query || {}, body: body || {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) "Falta dinero": LUSHO gana 400, CARLA pierde solo 120 -> el
  // Remate tiene que poner 280 de su bolsillo (comision_total = -280) ---
  const res1 = await invocarRuta(handlerGuardarManual, reqBase({}, {
    hipodromoNombre: 'La Rinconada', carreraNumero: 5, fecha: '2026-10-04',
    lineas: [
      { cliente: 'LUSHO', numeroEjemplar: 7, monto: 400 },
      { cliente: 'CARLA', numeroEjemplar: 3, monto: -120 },
      { cliente: 'PEDRO', numeroEjemplar: 9, monto: 0 } // monto 0 -> se ignora
    ]
  }));
  check(res1._status === 201, '1) POST /remates/manual responde 201');
  check(res1._json.remate.modo === 'manual', '1) El remate queda guardado con modo="manual"');
  check(res1._json.remate.comision_total === -280, `1) comision_total = -(400 + -120) = -280 (falta dinero, lo pone la banca), dio ${res1._json.remate.comision_total}`);
  check(res1._json.remate.pizarra === null && res1._json.remate.numero_ganador === null, '1) Sin pizarra ni número ganador (no aplica en este modo)');
  check(res1._json.remate.pago_fijo === null && res1._json.remate.garantia === null && Number(res1._json.remate.comision_porcentaje) === 0, '1) Sin pago fijo, garantía ni % de comisión');
  check(TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === res1._json.remate.id).length === 2, '1) Se guardaron exactamente 2 apuestas (la de monto 0 se descartó)');
  const apuestaLusho = TABLAS.hipismo_remate_apuestas.find(a => a.remate_id === res1._json.remate.id && a.cliente_nombre === 'LUSHO');
  check(!!apuestaLusho && apuestaLusho.monto === 400 && apuestaLusho.resultado === 400, '1) La apuesta de LUSHO guarda monto=resultado=400 (el neto tal cual)');
  check(res1._json.textoResultado.includes('REMATE') && /lusho/i.test(res1._json.textoResultado) && /carla/i.test(res1._json.textoResultado), '1) textoResultado menciona el ítem REMATE y a los 2 clientes');

  // --- 2) "Sobra dinero": CARLA pierde 500, PEDRO gana solo 100 -> el
  // Remate se gana 400 (comision_total = +400) ---
  const res2 = await invocarRuta(handlerGuardarManual, reqBase({}, {
    hipodromoNombre: 'La Rinconada', carreraNumero: 6, fecha: '2026-10-04',
    lineas: [
      { cliente: 'CARLA', numeroEjemplar: 2, monto: -500 },
      { cliente: 'PEDRO', numeroEjemplar: 4, monto: 100 }
    ]
  }));
  check(res2._status === 201, '2) POST /remates/manual (sobra dinero) responde 201');
  check(res2._json.remate.comision_total === 400, `2) comision_total = -(-500 + 100) = 400 (sobra dinero, se lo gana la banca), dio ${res2._json.remate.comision_total}`);

  // --- 3) Validaciones ---
  const res3 = await invocarRuta(handlerGuardarManual, reqBase({}, {
    carreraNumero: 7, fecha: '2026-10-04', lineas: [{ cliente: 'LUSHO', numeroEjemplar: 1, monto: 50 }]
  }));
  check(res3._status === 400, '3a) Sin hipódromo -> 400');

  const res4 = await invocarRuta(handlerGuardarManual, reqBase({}, {
    hipodromoNombre: 'La Rinconada', carreraNumero: 7, fecha: '2026-10-04', lineas: []
  }));
  check(res4._status === 400, '3b) Sin líneas -> 400');

  const res5 = await invocarRuta(handlerGuardarManual, reqBase({}, {
    hipodromoNombre: 'La Rinconada', carreraNumero: 7, fecha: '2026-10-04',
    lineas: [{ cliente: 'LUSHO', numeroEjemplar: 1, monto: 0 }]
  }));
  check(res5._status === 400, '3c) Solo líneas con monto 0 -> 400 (ninguna línea válida)');

  // --- 4) GET /remates?modo=manual trae solo los manuales ---
  const res6 = await invocarRuta(handlerListar, reqBase({ modo: 'manual' }));
  check(res6._status === 200 && res6._json.length === 2, `4) GET /remates?modo=manual trae los 2 remates manuales, dio ${res6._json && res6._json.length}`);
  check(res6._json.every(r => r.modo === 'manual'), '4) Todos los remates listados son modo="manual"');

  // --- 5) GET /pizarras NUNCA lista un Remate Manual ---
  const res7 = await invocarRuta(handlerPizarras, reqBase({ desde: '2026-10-04', hasta: '2026-10-04' }));
  check(res7._status === 200, '5) GET /pizarras responde 200');
  check(res7._json.filas.length === 0, `5) Ningún Remate Manual aparece en Pizarras (ni pendiente ni cargado), dio ${res7._json.filas.length} filas`);

  // --- 6) PUT/DELETE /pizarras/remate/:id rechazan un Remate Manual ---
  const idManual = res1._json.remate.id;
  const res8 = await invocarRuta(handlerPutPizarraRemate, reqBase({}, { pizarra: '3.2.1' }), { id: idManual });
  check(res8._status === 400, '6a) PUT /pizarras/remate/:id sobre un Remate Manual -> 400');
  check(/modo manual/i.test(res8._json.error), '6a) El mensaje explica que es modo manual');
  const remateSinTocar = TABLAS.hipismo_remates.find(r => r.id === idManual);
  check(remateSinTocar.comision_total === -280, '6a) El remate NO se tocó (sigue en -280)');

  const res9 = await invocarRuta(handlerDeletePizarraRemate, reqBase({}), { id: idManual });
  check(res9._status === 400, '6b) DELETE /pizarras/remate/:id sobre un Remate Manual -> 400');
  check(TABLAS.hipismo_remates.some(r => r.id === idManual), '6b) El remate SIGUE existiendo (no se vació ni se borró)');

  // --- 7) DELETE /remates/manual/:id borra la fila entera ---
  const res10 = await invocarRuta(handlerEliminarManual, reqBase({}), { id: idManual });
  check(res10._status === 200 && res10._json.ok === true, '7a) DELETE /remates/manual/:id responde ok:true');
  check(!TABLAS.hipismo_remates.some(r => r.id === idManual), '7a) El remate ya NO existe (borrado permanente)');
  check(!TABLAS.hipismo_remate_apuestas.some(a => a.remate_id === idManual), '7a) Sus apuestas tampoco existen (cascada)');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'REMATE_MANUAL_ELIMINADO'), '7a) Se registró la alerta REMATE_MANUAL_ELIMINADO');

  const res11 = await invocarRuta(handlerEliminarManual, reqBase({}), { id: 'no-existe' });
  check(res11._status === 404, '7b) DELETE /remates/manual/:id con un id que no existe -> 404');

  // Un remate de pool (modo='pool') NUNCA se puede borrar con esta ruta.
  TABLAS.hipismo_remates.push({
    id: 'rem-pool-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 9,
    fecha: '2026-10-04', modo: 'pool', comision_total: 50
  });
  const res12 = await invocarRuta(handlerEliminarManual, reqBase({}), { id: 'rem-pool-1' });
  check(res12._status === 400, '7c) DELETE /remates/manual/:id sobre un remate modo="pool" -> 400 (nunca lo borra)');
  check(TABLAS.hipismo_remates.some(r => r.id === 'rem-pool-1'), '7c) El remate de pool SIGUE existiendo');

  // --- 8) GET /clientes/REMATE/detalle-semana: modo:'manual' en el detalle ---
  const res13 = await invocarRuta(handlerDetalleSemana, { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: { nombre: 'REMATE' }, query: { desde: '2026-10-04', hasta: '2026-10-04' } });
  check(res13._status === 200, '8) GET /clientes/REMATE/detalle-semana responde 200');
  const dia = res13._json.dias.find(d => d.fecha === '2026-10-04');
  const hip = dia && dia.hipodromos.find(h => h.nombre === 'La Rinconada');
  const carreraManual = hip && hip.carreras.find(c => c.carrera === 6); // el remate #2 (res2), el único modo=manual que sigue vivo
  check(!!carreraManual && carreraManual.modo === 'manual', '8) La carrera del Remate Manual que sigue vivo trae modo:"manual"');
  check(!!carreraManual && carreraManual.resultado === 400, `8) Su resultado sigue siendo 400 (el espejo de la suma de netos), dio ${carreraManual && carreraManual.resultado}`);
  const carreraPool = hip && hip.carreras.find(c => c.carrera === 9);
  check(!!carreraPool && carreraPool.modo !== 'manual', '8) El remate de pool (fixture del caso 7c) sigue con su modo normal, nunca "manual"');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Remate Manual se cayó con una excepción:', e);
  process.exit(1);
});
