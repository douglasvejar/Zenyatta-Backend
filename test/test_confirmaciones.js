// =================================================================
// PRUEBA: botones "✅ Estamos cuadrados" / "⚠️ Tengo diferencia" del link
// del Cliente (02-09-2026, a pedido del usuario). A pedido EXPLÍCITO del
// usuario, esto es "un plus" — nunca bloquea nada — y se puede usar UNA
// VEZ POR DÍA CALENDARIO DE VENEZUELA por jugador ("el boton lo pueden
// usar una sola vez por dia", respuesta del usuario a la pregunta de
// aclaración — no una vez por semana, no una sola vez para siempre).
// =================================================================
// Mismo patrón de base de datos falsa + express falso que
// test_cliente_ruta.js/test_polla.js.
//
// Cubre:
//   1. fechaVenezuelaHoy()/fechaHoraVenezuelaTexto(): la fecha de
//      Venezuela (UTC-4 fijo) puede caer en un día de calendario DISTINTO
//      al de UTC — se prueba con una hora UTC conocida que cruza la
//      medianoche en Venezuela.
//   2. obtenerConfirmacionHoy()/registrarConfirmacion(): registra
//      CUADRADO o DIFERENCIA, un segundo intento el MISMO día (misma
//      fecha de Venezuela) para el MISMO jugador falla con 409 — el
//      "unique (jugador_id, fecha)" de la base es lo que de verdad hace
//      cumplir la regla (se simula el código 23505 de Postgres). Dos
//      jugadores DISTINTOS el mismo día no chocan entre sí.
//   3. Cada acción deja una fila en "alertas": CONFIRMACION_CLIENTE queda
//      YA resuelta (informativa); DIFERENCIA_CLIENTE queda SIN resolver
//      (pendiente de que el grupo la atienda).
//   4. La ruta POST /api/cliente/:token/confirmar end-to-end: token
//      inválido -> 404, grupo inactivo -> 403, tipo inválido -> 400,
//      éxito -> 201, segundo intento el mismo día -> 409.
//   5. El GET /api/cliente/:token de siempre ahora también trae
//      "confirmacionHoy" y "telefonoDiferencia" (el primer teléfono
//      cargado, o null si el grupo no cargó ninguno).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  grupos: [
    { id: 'grupo-1', nombre: 'Deportes Zenyatta TX', activo: true, logo_url: null }
  ],
  jugadores: [
    { id: 'j-randy', grupo_id: 'grupo-1', nombre: 'RANDY', token: 'token-randy', tipo_cuenta: 'libre', comision_propia: 0 },
    { id: 'j-pedro', grupo_id: 'grupo-1', nombre: 'PEDRO', token: 'token-pedro', tipo_cuenta: 'libre', comision_propia: 0 }
  ],
  confirmaciones_cliente: [], // { grupo_id, jugador_id, fecha, tipo }
  alertas: [],
  grupo_telefonos: [],
  tickets_historial: [],
  polla_historial: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT \* FROM jugadores WHERE token = \$1/i.test(sql)) {
    const j = TABLAS.jugadores.find(x => x.token === params[0]);
    return { rows: j ? [j] : [] };
  }
  if (/^SELECT activo, nombre, logo_url, modulo_hipismo_habilitado FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = TABLAS.grupos.find(x => x.id === params[0]);
    return { rows: g ? [g] : [] };
  }
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/^SELECT apodo, nombre_oficial, deporte FROM equipos_personalizados WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros FROM tickets_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT fecha FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = ANY/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };

  // --- Teléfonos (para telefonoPrincipal()) ---
  if (/^SELECT id, telefono, apodo, creado_en FROM grupo_telefonos WHERE grupo_id = \$1 ORDER BY creado_en ASC/i.test(sql)) {
    return { rows: TABLAS.grupo_telefonos.filter(t => t.grupo_id === params[0]) };
  }

  // --- confirmaciones_cliente ---
  if (/^SELECT tipo, creado_en FROM confirmaciones_cliente WHERE jugador_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [jugadorId, fecha] = params;
    const fila = TABLAS.confirmaciones_cliente.find(c => c.jugador_id === jugadorId && c.fecha === fecha);
    return { rows: fila ? [{ tipo: fila.tipo, creado_en: 'x' }] : [] };
  }
  if (/^INSERT INTO confirmaciones_cliente \(grupo_id, jugador_id, fecha, tipo\) VALUES \(\$1, \$2, \$3, \$4\)/i.test(sql)) {
    const [grupoId, jugadorId, fecha, tipo] = params;
    if (TABLAS.confirmaciones_cliente.find(c => c.jugador_id === jugadorId && c.fecha === fecha)) {
      // Mismo error que tira "pg" cuando se viola un "unique" — es
      // EXACTAMENTE lo que hace cumplir "una vez por día" a nivel de base
      // de datos (ver sql/schema.sql, confirmaciones_cliente).
      const err = new Error('duplicate key value violates unique constraint "confirmaciones_cliente_jugador_id_fecha_key"');
      err.code = '23505';
      throw err;
    }
    TABLAS.confirmaciones_cliente.push({ grupo_id: grupoId, jugador_id: jugadorId, fecha, tipo });
    return { rows: [] };
  }

  // --- alertas (INSERT para CONFIRMACION_CLIENTE / DIFERENCIA_CLIENTE) ---
  if (/^INSERT INTO alertas \(grupo_id, fecha, tipo, cliente_nombre, pata, mensaje, resuelta, resuelto_en\) VALUES \(\$1, \$2, 'CONFIRMACION_CLIENTE', \$3, \$4, \$5, true, now\(\)\)/i.test(sql)) {
    const [grupoId, fecha, cliente, pata, mensaje] = params;
    TABLAS.alertas.push({ id: 'a-' + (TABLAS.alertas.length + 1), grupo_id: grupoId, fecha, tipo: 'CONFIRMACION_CLIENTE', cliente_nombre: cliente, pata, mensaje, resuelta: true });
    return { rows: [] };
  }
  if (/^INSERT INTO alertas \(grupo_id, fecha, tipo, cliente_nombre, pata, mensaje\) VALUES \(\$1, \$2, 'DIFERENCIA_CLIENTE', \$3, \$4, \$5\)/i.test(sql)) {
    const [grupoId, fecha, cliente, pata, mensaje] = params;
    TABLAS.alertas.push({ id: 'a-' + (TABLAS.alertas.length + 1), grupo_id: grupoId, fecha, tipo: 'DIFERENCIA_CLIENTE', cliente_nombre: cliente, pata, mensaje, resuelta: false });
    return { rows: [] };
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

const { fechaVenezuelaHoy, fechaHoraVenezuelaTexto } = require(path.join(__dirname, '..', 'src', 'services', 'fechaVenezuela'));
const confirmaciones = require(path.join(__dirname, '..', 'src', 'services', 'confirmaciones'));
const clienteRouter = require(path.join(__dirname, '..', 'src', 'routes', 'cliente'));

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

// Declarado afuera de main() para que el .catch() de más abajo también
// pueda restaurarlo si algo revienta a mitad de prueba.
const original_Date_now = Date.now;

(async function main() {
  // =================================================================
  // 1. fechaVenezuelaHoy() — América/Caracas es UTC-4 FIJO (sin horario
  //    de verano), así que a las 2:30 AM UTC del día 3 le corresponde
  //    todavía el día 2 en Venezuela (2:30 - 4h = 22:30 del día 2).
  // =================================================================
  Date.now = () => new Date('2026-09-03T02:30:00.000Z').getTime();
  check(fechaVenezuelaHoy() === '2026-09-02', 'fechaVenezuelaHoy(): a las 2:30 AM UTC del día 3, en Venezuela (UTC-4) todavía es el día 2');
  check(/miércoles 2 de septiembre de 2026/.test(fechaHoraVenezuelaTexto()), 'fechaHoraVenezuelaTexto(): arma el texto largo con el día de la semana correcto en Venezuela');
  Date.now = () => new Date('2026-09-03T18:00:00.000Z').getTime();
  check(fechaVenezuelaHoy() === '2026-09-03', 'fechaVenezuelaHoy(): a las 6 PM UTC, en Venezuela (UTC-4 = 2 PM) ya es el día 3');
  Date.now = original_Date_now;

  // =================================================================
  // 2 y 3. registrarConfirmacion() / obtenerConfirmacionHoy() + alertas
  // =================================================================
  Date.now = () => new Date('2026-09-02T15:00:00.000Z').getTime(); // 11 AM en Venezuela, fecha = 2026-09-02
  const randy = TABLAS.jugadores.find(j => j.id === 'j-randy');
  const pedro = TABLAS.jugadores.find(j => j.id === 'j-pedro');

  const antesConf = await confirmaciones.obtenerConfirmacionHoy(randy.id);
  check(antesConf === null, 'obtenerConfirmacionHoy(): null cuando el jugador todavía no usó ningún botón hoy');

  const r1 = await confirmaciones.registrarConfirmacion('grupo-1', randy, 'Deportes Zenyatta TX', 'CUADRADO');
  check(r1.tipo === 'CUADRADO' && r1.fecha === '2026-09-02', 'registrarConfirmacion(CUADRADO): devuelve tipo y fecha');

  const despuesConf = await confirmaciones.obtenerConfirmacionHoy(randy.id);
  check(despuesConf && despuesConf.tipo === 'CUADRADO', 'obtenerConfirmacionHoy(): ahora devuelve CUADRADO para RANDY');

  const alertaConfirmacion = TABLAS.alertas.find(a => a.tipo === 'CONFIRMACION_CLIENTE' && a.cliente_nombre === 'RANDY');
  check(alertaConfirmacion && alertaConfirmacion.resuelta === true, 'CONFIRMACION_CLIENTE queda registrada YA resuelta (informativa, nada que atender)');

  // Segundo intento el MISMO día -> 409 (a nivel de servicio)
  let error409 = null;
  try { await confirmaciones.registrarConfirmacion('grupo-1', randy, 'Deportes Zenyatta TX', 'DIFERENCIA'); }
  catch (e) { error409 = e; }
  check(error409 && error409.status === 409, 'Un segundo uso el MISMO día de Venezuela responde 409 ("ya usaste este botón hoy")');
  check(TABLAS.confirmaciones_cliente.filter(c => c.jugador_id === randy.id).length === 1, 'No quedó una segunda fila de confirmación para RANDY');
  check(!TABLAS.alertas.find(a => a.tipo === 'DIFERENCIA_CLIENTE' && a.cliente_nombre === 'RANDY'), 'El intento rechazado NO generó ninguna alerta de diferencia (no llegó a insertarse)');

  // PEDRO (otro jugador) SÍ puede usar el botón el mismo día — la regla
  // es por jugador, no global.
  const r2 = await confirmaciones.registrarConfirmacion('grupo-1', pedro, 'Deportes Zenyatta TX', 'DIFERENCIA');
  check(r2.tipo === 'DIFERENCIA', 'Otro jugador (PEDRO) SÍ puede usar el botón el mismo día — la restricción es por jugador');
  const alertaDiferencia = TABLAS.alertas.find(a => a.tipo === 'DIFERENCIA_CLIENTE' && a.cliente_nombre === 'PEDRO');
  check(alertaDiferencia && alertaDiferencia.resuelta === false, 'DIFERENCIA_CLIENTE queda SIN resolver (pendiente de que el grupo la atienda)');

  // Tipo inválido
  let errorTipo = null;
  try { await confirmaciones.registrarConfirmacion('grupo-1', randy, 'Deportes Zenyatta TX', 'ALGO_RARO'); }
  catch (e) { errorTipo = e; }
  check(errorTipo && errorTipo.status === 400, 'Un tipo que no es CUADRADO ni DIFERENCIA responde 400');

  // =================================================================
  // 4. Ruta POST /api/cliente/:token/confirmar end-to-end
  // =================================================================
  Date.now = () => new Date('2026-09-05T15:00:00.000Z').getTime(); // fecha nueva, sin choques con lo de arriba
  const handlerConfirmar = clienteRouter.__handlers.find(([m, args]) => m === 'post' && args[0] === '/:token/confirmar')[1].slice(-1)[0];

  const resTokenInvalido = await invocarRuta(handlerConfirmar, { params: { token: 'no-existe' }, body: { tipo: 'CUADRADO' } });
  check(resTokenInvalido._status === 404, 'POST .../confirmar con un token inválido responde 404');

  TABLAS.grupos[0].activo = false;
  const resGrupoInactivo = await invocarRuta(handlerConfirmar, { params: { token: 'token-randy' }, body: { tipo: 'CUADRADO' } });
  check(resGrupoInactivo._status === 403, 'POST .../confirmar con el grupo inactivo responde 403');
  TABLAS.grupos[0].activo = true;

  const resTipoInvalido = await invocarRuta(handlerConfirmar, { params: { token: 'token-randy' }, body: { tipo: 'ALGO_RARO' } });
  check(resTipoInvalido._status === 400, 'POST .../confirmar con un tipo inválido responde 400');

  const resOk = await invocarRuta(handlerConfirmar, { params: { token: 'token-randy' }, body: { tipo: 'CUADRADO' } });
  check(resOk._status === 201, 'POST .../confirmar válido responde 201');

  const resSegundoUso = await invocarRuta(handlerConfirmar, { params: { token: 'token-randy' }, body: { tipo: 'DIFERENCIA' } });
  check(resSegundoUso._status === 409, 'Un segundo POST .../confirmar el MISMO día para el mismo jugador responde 409');

  // =================================================================
  // 5. El GET de siempre trae "confirmacionHoy" y "telefonoDiferencia"
  // =================================================================
  const handlerGet = clienteRouter.__handlers.find(([m, args]) => m === 'get' && args[0] === '/:token')[1].slice(-1)[0];

  const resGetSinTelefono = await invocarRuta(handlerGet, { params: { token: 'token-randy' }, query: {} });
  check(resGetSinTelefono._json.confirmacionHoy && resGetSinTelefono._json.confirmacionHoy.tipo === 'CUADRADO', 'GET /:token trae confirmacionHoy con lo que ya usó RANDY hoy');
  check(resGetSinTelefono._json.telefonoDiferencia === null, 'GET /:token: telefonoDiferencia es null cuando el grupo no cargó ningún número');

  TABLAS.grupo_telefonos.push({ id: 'tel-1', grupo_id: 'grupo-1', telefono: '584121234567', apodo: 'Carlos' });
  const resGetConTelefono = await invocarRuta(handlerGet, { params: { token: 'token-pedro' }, query: {} });
  check(resGetConTelefono._json.telefonoDiferencia === '584121234567', 'GET /:token: telefonoDiferencia trae el primer número cargado del grupo');
  check(resGetConTelefono._json.confirmacionHoy === null, 'GET /:token: confirmacionHoy es null para PEDRO en esta fecha nueva (todavía no usó el botón hoy)');

  Date.now = original_Date_now;

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  Date.now = original_Date_now; // por si algo revienta a mitad de prueba, no dejar Date.now pisado
  console.error('La prueba de confirmaciones se cayó con una excepción:', e);
  process.exit(1);
});
