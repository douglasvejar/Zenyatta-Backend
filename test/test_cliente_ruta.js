// =================================================================
// PRUEBA: GET /api/cliente/:token — vista pública del Cliente
// (01-09-2026, rediseño a pedido del usuario: logo del grupo, jugadas
// agrupadas por día, y el nuevo campo "diasConfirmados").
// =================================================================
// Mismo patrón de base de datos falsa en memoria que test_guardar_dia.js/
// test_alertas_integracion.js (reemplaza "pg" vía Module._load), pero acá
// además se fakea "express" (mismo espíritu que test_wiring.js) para
// poder capturar el handler real de la ruta "/:token" y llamarlo
// directo, sin levantar un servidor HTTP de verdad.
//
// Cubre que la respuesta trae:
//   1. grupo.nombre y grupo.logoUrl (null si el grupo no tiene logo).
//   2. jugador.tipoCuenta tal cual está guardado ('avalado'/'libre').
//   3. diasConfirmados con SOLO las fechas de ESE cliente en el rango que
//      de verdad están confirmadas (no las de otros grupos, no las de
//      fechas fuera de rango).
//   4. Un token que no existe da 404 sin reventar el servidor.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

// --- Base de datos falsa en memoria ---
const TABLAS = {
  grupos: [
    { id: 'grupo-1', activo: true, nombre: 'Deportes Zenyatta TX', logo_url: 'https://ejemplo.com/logo.png' }
  ],
  jugadores: [
    { id: 'jugador-1', grupo_id: 'grupo-1', nombre: 'RANDY', token: 'token-randy', tipo_cuenta: 'avalado', pozo_inicial: 500, comision_propia: 0, activo: true }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  tickets_historial: [
    { grupo_id: 'grupo-1', fecha: '2026-08-30', cliente_nombre: 'RANDY', jugador_id: 'jugador-1', ticket_label: 'Ticket #1', detalle: 'astros -150', arriesga: 100, gana: 66.67, estado: 'GANADA' },
    { grupo_id: 'grupo-1', fecha: '2026-08-31', cliente_nombre: 'RANDY', jugador_id: 'jugador-1', ticket_label: 'Ticket #2', detalle: 'yankees +120', arriesga: 50, gana: 60, estado: 'PERDIDA' }
  ],
  // "Polla" (02-09-2026) — RANDY perdió 30 el 31-08, dentro del rango
  // que prueba req1 más abajo.
  polla_historial: [
    { id: 'polla-1', grupo_id: 'grupo-1', fecha: '2026-08-31', cliente_nombre: 'RANDY', monto: -30, nota: null }
  ],
  // Solo el 30 quedó confirmado ("💾 Guardar Día") — el 31 todavía no.
  dias_confirmados: [
    { grupo_id: 'grupo-1', fecha: '2026-08-30' }
  ],
  // "Estamos cuadrados"/"Tengo diferencia" (02-09-2026) + teléfonos de
  // WhatsApp del grupo — vacías acá, se agrega alguna fila más abajo
  // dentro de main() para probar el caso "con datos".
  confirmaciones_cliente: [],
  grupo_telefonos: []
};

function filtrarTicketsHistorial(sql, params) {
  const grupoId = params[0];
  let idx = 1;
  let desde, hasta, cliente;
  if (/fecha >= \$/i.test(sql)) { desde = params[idx]; idx++; }
  if (/fecha <= \$/i.test(sql)) { hasta = params[idx]; idx++; }
  if (/cliente_nombre = \$/i.test(sql)) { cliente = params[idx]; idx++; }
  return TABLAS.tickets_historial.filter(r =>
    r.grupo_id === grupoId &&
    (!desde || r.fecha >= desde) &&
    (!hasta || r.fecha <= hasta) &&
    (!cliente || r.cliente_nombre === cliente)
  );
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT \* FROM jugadores WHERE token = \$1/i.test(sql)) {
    const jugador = TABLAS.jugadores.find(j => j.token === params[0]);
    return { rows: jugador ? [jugador] : [] };
  }
  if (/^SELECT activo, nombre, logo_url, modulo_hipismo_habilitado FROM grupos WHERE id = \$1/i.test(sql)) {
    const grupo = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: grupo ? [grupo] : [] };
  }
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
    return { rows: filtrarTicketsHistorial(sql, params) };
  }
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  // "Polla" (02-09-2026) — leerPolla() usa las mismas condiciones
  // dinámicas (grupo_id, desde?, hasta?, cliente?) que tickets_historial.
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    const grupoId = params[0];
    let idx = 1;
    let desde, hasta, cliente;
    if (/fecha >= \$/i.test(sql)) { desde = params[idx]; idx++; }
    if (/fecha <= \$/i.test(sql)) { hasta = params[idx]; idx++; }
    if (/cliente_nombre = \$/i.test(sql)) { cliente = params[idx]; idx++; }
    const filas = TABLAS.polla_historial.filter(r =>
      r.grupo_id === grupoId &&
      (!desde || r.fecha >= desde) &&
      (!hasta || r.fecha <= hasta) &&
      (!cliente || r.cliente_nombre === cliente)
    );
    // El SQL real le pone alias "AS cliente" a cliente_nombre.
    return { rows: filas.map(f => ({ id: f.id, fecha: f.fecha, cliente: f.cliente_nombre, monto: f.monto, nota: f.nota })) };
  }
  if (/^SELECT fecha FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = ANY\(\$2::date\[\]\)/i.test(sql)) {
    const [grupoId, fechas] = params;
    const filas = TABLAS.dias_confirmados.filter(d => d.grupo_id === grupoId && fechas.includes(d.fecha));
    return { rows: filas.map(f => ({ fecha: f.fecha })) };
  }
  // "Estamos cuadrados"/"Tengo diferencia" (02-09-2026) — obtenerConfirmacionHoy().
  if (/^SELECT tipo, creado_en FROM confirmaciones_cliente WHERE jugador_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [jugadorId, fecha] = params;
    const fila = TABLAS.confirmaciones_cliente.find(c => c.jugador_id === jugadorId && c.fecha === fecha);
    return { rows: fila ? [{ tipo: fila.tipo, creado_en: 'x' }] : [] };
  }
  // Teléfonos de WhatsApp del grupo (02-09-2026) — telefonoPrincipal().
  if (/^SELECT id, telefono, apodo, creado_en FROM grupo_telefonos WHERE grupo_id = \$1 ORDER BY creado_en ASC/i.test(sql)) {
    return { rows: TABLAS.grupo_telefonos.filter(t => t.grupo_id === params[0]) };
  }

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

// --- Express falso: solo necesita capturar el handler de "/:token" ---
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
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';

const clienteRouter = require(path.join(__dirname, '..', 'src', 'routes', 'cliente'));

Module._load = originalLoad;

const entradaToken = clienteRouter.__handlers.find(([metodo, args]) => metodo === 'get' && args[0] === '/:token');
const handlerToken = entradaToken[1][1]; // [path, handlerEnvueltoPorAsyncHandler]

// asyncHandler(fn) NO devuelve la promesa de fn() — hace
// "Promise.resolve(fn(...)).catch(next)" y listo, así que un simple
// "await handlerToken(...)" no espera nada de verdad. Por eso acá se
// invoca dentro de una Promise que se resuelve recién cuando el handler
// de verdad llama a res.json() (éxito) o next(err) (error) — eso sí
// refleja cuándo terminó el trabajo async de la ruta.
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

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- Token válido, rango que cubre los 2 tickets de RANDY ---
  const req1 = { params: { token: 'token-randy' }, query: { desde: '2026-08-30', hasta: '2026-08-31' } };
  const res1 = await invocarRuta(handlerToken, req1);

  check(res1._status === 200, 'Token válido responde 200');
  check(!!res1._json, 'Token válido devuelve un cuerpo JSON');
  check(res1._json.grupo && res1._json.grupo.nombre === 'Deportes Zenyatta TX', 'La respuesta trae el nombre del grupo');
  check(res1._json.grupo && res1._json.grupo.logoUrl === 'https://ejemplo.com/logo.png', 'La respuesta trae el logoUrl del grupo cuando lo tiene cargado');
  check(res1._json.jugador.tipoCuenta === 'avalado', 'La respuesta trae el tipo de cuenta del jugador (avalado)');
  check(res1._json.tickets.length === 2, 'Trae los 2 tickets de RANDY dentro del rango pedido');
  check(Array.isArray(res1._json.diasConfirmados), 'diasConfirmados es un array');
  check(res1._json.diasConfirmados.includes('2026-08-30') && !res1._json.diasConfirmados.includes('2026-08-31'),
    'diasConfirmados trae SOLO el 30 (confirmado), no el 31 (todavía sin confirmar)');
  check(!!res1._json.pozo, 'RANDY es avalado, así que la respuesta trae su pozo');

  // "Polla" (02-09-2026): RANDY perdió 30 el 31-08, dentro del rango.
  check(res1._json.resumen.polla === -30, 'resumen.polla trae el total de polla del rango (-30)');
  check(res1._json.resumen.balance === (res1._json.resumen.ganado - res1._json.resumen.perdido - 30),
    'resumen.balance incluye la polla sumada (ganado - perdido + polla)');
  check(Array.isArray(res1._json.polla) && res1._json.polla.length === 1 && res1._json.polla[0].monto === -30,
    'La respuesta trae el detalle de polla (array), con el monto tal cual se guardó');

  // "Estamos cuadrados"/"Tengo diferencia" + teléfono de WhatsApp
  // (02-09-2026) — sin nada cargado todavía, ambos campos van "vacíos".
  check(typeof res1._json.horaVenezuela === 'string' && res1._json.horaVenezuela.length > 0, 'La respuesta trae horaVenezuela (texto)');
  check(res1._json.confirmacionHoy === null, 'RANDY no usó ningún botón hoy -> confirmacionHoy: null');
  check(res1._json.telefonoDiferencia === null, 'grupo-1 no cargó ningún teléfono -> telefonoDiferencia: null');

  TABLAS.confirmaciones_cliente.push({ jugador_id: 'jugador-1', grupo_id: 'grupo-1', fecha: require('../src/services/fechaVenezuela').fechaVenezuelaHoy(), tipo: 'CUADRADO' });
  TABLAS.grupo_telefonos.push({ id: 'tel-1', grupo_id: 'grupo-1', telefono: '584121234567', apodo: 'Carlos' });
  const req1b = { params: { token: 'token-randy' }, query: { desde: '2026-08-30', hasta: '2026-08-31' } };
  const res1b = await invocarRuta(handlerToken, req1b);
  check(res1b._json.confirmacionHoy && res1b._json.confirmacionHoy.tipo === 'CUADRADO', 'Después de usar el botón hoy, confirmacionHoy trae el tipo usado');
  check(res1b._json.telefonoDiferencia === '584121234567', 'Con un teléfono cargado, telefonoDiferencia lo trae');

  // --- Token que no existe ---
  const req2 = { params: { token: 'token-que-no-existe' }, query: {} };
  const res2 = await invocarRuta(handlerToken, req2);
  check(res2._status === 404, 'Un token inexistente responde 404, no revienta el servidor');

  // --- Grupo sin logo cargado (logo_url null) ---
  TABLAS.grupos.push({ id: 'grupo-2', activo: true, nombre: 'Otro Grupo', logo_url: null });
  TABLAS.jugadores.push({ id: 'jugador-2', grupo_id: 'grupo-2', nombre: 'PEDRO', token: 'token-pedro', tipo_cuenta: 'libre', pozo_inicial: 0, comision_propia: 0, activo: true });
  const req3 = { params: { token: 'token-pedro' }, query: { desde: '2026-08-30', hasta: '2026-08-31' } };
  const res3 = await invocarRuta(handlerToken, req3);
  check(res3._json.grupo.logoUrl === null, 'Un grupo sin logo cargado da logoUrl: null (el frontend simplemente no muestra la imagen)');
  check(res3._json.pozo === null, 'PEDRO es "libre" (no avalado), así que la respuesta no trae pozo');
  check(res3._json.resumen.polla === 0 && res3._json.polla.length === 0, 'PEDRO no tiene polla guardada -> resumen.polla 0 y polla: []');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de la ruta del Cliente se cayó con una excepción:', e);
  process.exit(1);
});
