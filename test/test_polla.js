// =================================================================
// PRUEBA: "Polla" (02-09-2026, a pedido del usuario) — juego aparte de
// la sábana. Ver src/services/polla.js para el formato de texto y la
// fórmula completa.
// =================================================================
// Mismo patrón de base de datos falsa en memoria + express falso que
// test_cliente_ruta.js/test_guardar_dia.js. Cubre:
//   1. parsearResultadoPolla(): reconoce "nombre monto" con signo,
//      ignora el encabezado libre y líneas vacías/rotas.
//   2. guardarPolla(): matchea contra jugadores ACTIVOS (mayúsculas),
//      NO auto-registra nombres que no matchean (los reporta aparte),
//      reemplaza (no acumula) al reprocesar la misma fecha, y
//      desconfirma el día.
//   3. calcularPollaPorCliente(): suma por cliente dentro de un rango.
//   4. calcularBalanceGeneral() (services/balanceGeneral.js): la fórmula
//      exacta del ejemplo que mandó el usuario (itamar -200, tykhe
//      +440, f150 -300, ronaldo -267 -> banca polla +327), y que el
//      saldo de cada cliente incluye su polla sumada directo.
//   5. La ruta POST /api/polla/procesar (src/routes/polla.js) end-to-end.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

// --- Base de datos falsa en memoria ---
const TABLAS = {
  jugadores: [
    { id: 'j-itamar', grupo_id: 'grupo-1', nombre: 'ITAMAR', activo: true, comision_propia: 0 },
    { id: 'j-tykhe', grupo_id: 'grupo-1', nombre: 'TYKHE', activo: true, comision_propia: 0 },
    { id: 'j-f150', grupo_id: 'grupo-1', nombre: 'F150', activo: true, comision_propia: 0 },
    { id: 'j-ronaldo', grupo_id: 'grupo-1', nombre: 'RONALDO', activo: true, comision_propia: 0 },
    { id: 'j-inactivo', grupo_id: 'grupo-1', nombre: 'INACTIVO', activo: false, comision_propia: 0 }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  tickets_historial: [],
  transferencias: [],
  dias_confirmados: [
    { grupo_id: 'grupo-1', fecha: '2026-09-02' }
  ],
  polla_historial: []
};

function condicionesDinamicas(sql, params, campoFecha, campoCliente) {
  const grupoId = params[0];
  let idx = 1;
  let desde, hasta, cliente;
  if (new RegExp(campoFecha + ' >= \\$').test(sql)) { desde = params[idx]; idx++; }
  if (new RegExp(campoFecha + ' <= \\$').test(sql)) { hasta = params[idx]; idx++; }
  if (campoCliente && new RegExp(campoCliente + ' = \\$').test(sql)) { cliente = params[idx]; idx++; }
  return { grupoId, desde, hasta, cliente };
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  }
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.avales.filter(a => a.grupo_id === params[0]) };
  }
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_globales/i.test(sql)) {
    return { rows: TABLAS.equipos_globales };
  }
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_personalizados WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.equipos_personalizados.filter(e => e.grupo_id === params[0]) };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros FROM tickets_historial WHERE/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  }

  if (/^DELETE FROM polla_historial WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.polla_historial = TABLAS.polla_historial.filter(r => !(r.grupo_id === grupoId && r.fecha === fecha));
    return { rows: [] };
  }
  if (/^INSERT INTO polla_historial/i.test(sql)) {
    const [grupoId, fecha, cliente, jugadorId, monto] = params;
    TABLAS.polla_historial.push({ id: 'polla-' + TABLAS.polla_historial.length, grupo_id: grupoId, fecha, cliente_nombre: cliente, jugador_id: jugadorId, monto, nota: null });
    return { rows: [] };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    const { grupoId, desde, hasta, cliente } = condicionesDinamicas(sql, params, 'fecha', 'cliente_nombre');
    const filas = TABLAS.polla_historial.filter(r =>
      r.grupo_id === grupoId && (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta) && (!cliente || r.cliente_nombre === cliente)
    );
    // El SQL real le pone alias "AS cliente" a cliente_nombre — acá se
    // imita ese renombrado (si no, leerPolla() recibiría "cliente:
    // undefined" en cada fila).
    return { rows: filas.map(f => ({ id: f.id, fecha: f.fecha, cliente: f.cliente_nombre, monto: f.monto, nota: f.nota })) };
  }
  if (/^DELETE FROM polla_historial WHERE grupo_id = \$1 AND id = \$2/i.test(sql)) {
    const [grupoId, id] = params;
    TABLAS.polla_historial = TABLAS.polla_historial.filter(r => !(r.grupo_id === grupoId && r.id === id));
    return { rows: [] };
  }

  if (/^DELETE FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.dias_confirmados = TABLAS.dias_confirmados.filter(d => !(d.grupo_id === grupoId && d.fecha === fecha));
    return { rows: [] };
  }
  if (/^SELECT confirmado_en FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const fila = TABLAS.dias_confirmados.find(d => d.grupo_id === grupoId && d.fecha === fecha);
    return { rows: fila ? [{ confirmado_en: 'x' }] : [] };
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
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'x' }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const polla = require(path.join(__dirname, '..', 'src', 'services', 'polla'));
const { calcularBalanceGeneral } = require(path.join(__dirname, '..', 'src', 'services', 'balanceGeneral'));
const { estadoDia } = require(path.join(__dirname, '..', 'src', 'services', 'historial'));
const pollaRouter = require(path.join(__dirname, '..', 'src', 'routes', 'polla'));

Module._load = originalLoad;

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
  const GRUPO_ID = 'grupo-1';
  const FECHA = '2026-09-02';

  // --- 1. parsearResultadoPolla() ---
  const textoEjemplo = 'resultado polla\n\nitamar -200\ntykhe +440\nf150 -300\nronaldo -267\n\n';
  const { filas, ignoradas } = polla.parsearResultadoPolla(textoEjemplo);
  check(filas.length === 4, 'parsearResultadoPolla(): reconoce las 4 líneas de cliente+monto');
  check(ignoradas.length === 1 && ignoradas[0] === 'resultado polla', 'parsearResultadoPolla(): el encabezado libre "resultado polla" se ignora (no matchea el patrón nombre+monto)');
  check(filas.find(f => f.cliente === 'ITAMAR').monto === -200, 'parsearResultadoPolla(): ITAMAR -200 (mayúsculas, signo negativo)');
  check(filas.find(f => f.cliente === 'TYKHE').monto === 440, 'parsearResultadoPolla(): TYKHE +440');
  check(filas.find(f => f.cliente === 'F150').monto === -300, 'parsearResultadoPolla(): F150 -300 (nombre con número)');
  check(filas.find(f => f.cliente === 'RONALDO').monto === -267, 'parsearResultadoPolla(): RONALDO -267');

  // Nombre con espacios + línea rota
  const { filas: filas2, ignoradas: ignoradas2 } = polla.parsearResultadoPolla('juan perez -100\nlinea sin monto valido\n');
  check(filas2.length === 1 && filas2[0].cliente === 'JUAN PEREZ' && filas2[0].monto === -100, 'parsearResultadoPolla(): soporta nombres con espacios ("juan perez")');
  check(ignoradas2.includes('linea sin monto valido'), 'parsearResultadoPolla(): una línea sin monto numérico al final se ignora, no rompe nada');

  // --- 2. guardarPolla(): guarda los que matchean, reporta los que no ---
  const resultado1 = await polla.guardarPolla(GRUPO_ID, FECHA, [
    ...filas,
    { cliente: 'NOMBRE-QUE-NO-EXISTE', monto: 50 },
    { cliente: 'INACTIVO', monto: 10 }
  ]);
  check(resultado1.guardadas.length === 4, 'guardarPolla(): guarda los 4 clientes que SÍ matchean con un jugador activo');
  check(resultado1.noEncontrados.includes('NOMBRE-QUE-NO-EXISTE'), 'guardarPolla(): un nombre que no matchea ningún jugador queda en noEncontrados');
  check(resultado1.noEncontrados.includes('INACTIVO'), 'guardarPolla(): un jugador INACTIVO cuenta como "no encontrado" (no se le carga)');
  check(TABLAS.polla_historial.length === 4, 'guardarPolla(): NO auto-registra a los que no matchean — solo se guardaron las 4 filas válidas');

  // "Guardar Día" (ver historial.js): guardar polla desconfirma la fecha
  let estado = await estadoDia(GRUPO_ID, FECHA);
  check(estado.confirmado === false, 'guardarPolla() desconfirma el día (mismo criterio que reprocesar la sábana)');

  // --- Reprocesar la MISMA fecha reemplaza, no acumula ---
  const resultado2 = await polla.guardarPolla(GRUPO_ID, FECHA, [{ cliente: 'ITAMAR', monto: -999 }]);
  check(resultado2.guardadas.length === 1, 'Reprocesar la misma fecha: guardadas trae solo lo del nuevo texto');
  check(TABLAS.polla_historial.length === 1 && TABLAS.polla_historial[0].monto === -999,
    'Reprocesar la MISMA fecha REEMPLAZA lo guardado antes (no queda duplicado ni lo viejo)');

  // Reponer los 4 datos del ejemplo del usuario para las pruebas de balance
  await polla.guardarPolla(GRUPO_ID, FECHA, filas);

  // --- 3. calcularPollaPorCliente() ---
  const porCliente = await polla.calcularPollaPorCliente(GRUPO_ID, FECHA, FECHA);
  check(porCliente.ITAMAR === -200 && porCliente.TYKHE === 440 && porCliente.F150 === -300 && porCliente.RONALDO === -267,
    'calcularPollaPorCliente(): suma correcta por cliente en el rango');

  // --- 4. calcularBalanceGeneral(): fórmula EXACTA del ejemplo del usuario ---
  // "itamar -200, tykhe +440, f150 -300, ronaldo -267 -> banca +327"
  // (3 pierden 767 en total, 1 gana 440 -> le sobra 327 a la banca).
  const balance = await calcularBalanceGeneral(GRUPO_ID, FECHA, FECHA, {}, {});
  check(balance.balanceBancaPolla === 327, 'calcularBalanceGeneral(): balanceBancaPolla da +327, igual que el ejemplo que mandó el usuario');
  const filaItamar = balance.filas.find(f => f.cliente === 'ITAMAR');
  check(filaItamar.polla === -200, 'calcularBalanceGeneral(): la fila de ITAMAR trae su polla (-200) como ítem aparte');
  check(filaItamar.saldoCliente === -200, 'calcularBalanceGeneral(): ITAMAR no tiene tickets de sábana ni transferencias, así que su saldoCliente es EXACTAMENTE su polla (-200)');
  const filaTykhe = balance.filas.find(f => f.cliente === 'TYKHE');
  check(filaTykhe.saldoCliente === 440, 'calcularBalanceGeneral(): TYKHE (ganó la polla) tiene saldoCliente +440');

  // --- 5. Ruta POST /api/polla/procesar end-to-end ---
  const entradaProcesar = pollaRouter.__handlers.find(([metodo, args]) => metodo === 'post' && args[0] === '/procesar');
  const handlerProcesar = entradaProcesar[1][entradaProcesar[1].length - 1];
  const req1 = { grupoId: GRUPO_ID, body: { fecha: '2026-09-03', texto: 'resultado polla\nitamar -50\nsinmatch -10' } };
  const res1 = await invocarRuta(handlerProcesar, req1);
  check(res1._status === 200, 'POST /api/polla/procesar responde 200 con un texto válido');
  check(res1._json.guardadas.length === 1 && res1._json.guardadas[0].cliente === 'ITAMAR', 'La ruta devuelve "guardadas" con lo que sí matcheó');
  check(res1._json.noEncontrados.includes('SINMATCH'), 'La ruta devuelve "noEncontrados" con lo que no matcheó, para que el admin corrija el texto');

  const req2 = { grupoId: GRUPO_ID, body: { fecha: '2026-09-03', texto: '   ' } };
  const res2 = await invocarRuta(handlerProcesar, req2);
  check(res2._status === 400, 'POST /api/polla/procesar con texto vacío responde 400, no revienta');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Polla se cayó con una excepción:', e);
  process.exit(1);
});
