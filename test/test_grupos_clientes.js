// =================================================================
// PRUEBA: "GRUPO DE CLIENTES" (30-09-2026, a pedido del usuario — ver la
// nota grande en src/services/gruposClientes.js y en sql/schema.sql).
// Ejercita las 3 familias de rutas reales (a través de su handler
// Express real, mismo patrón que test_hipismo_cierre_final_rango_
// personalizado.js/test_cliente_ruta.js — base de datos falsa en
// memoria vía Module._load, sin levantar un servidor HTTP de verdad):
//
//   1. GET/POST/DELETE /api/hipismo/grupos-clientes[...] (dentro de
//      routes/hipismo.js)
//   2. GET/POST/DELETE /api/grupos-clientes[...] (routes/gruposClientes.js,
//      Deportes)
//   3. GET /api/grupo-cliente/:token (routes/gruposClientesPublico.js,
//      compartida por los 2 módulos)
//
// Casos cubiertos:
//   a) El titular SIEMPRE aparece como miembro (confirmado con el
//      usuario), aunque nunca se lo agregue a mano a
//      grupos_clientes_miembros.
//   b) Un miembro agregado a mano también aparece, con su propio saldo.
//   c) saldoSemanaActual y saldoSemanaAnterior salen de rangos de fecha
//      DISTINTOS (semana actual vs. la de 7 días antes) — con datos de
//      prueba distintos en cada semana, deben dar números distintos.
//   d) totalSemanaActual/totalSemanaAnterior son la suma de los miembros.
//   e) Un grupo de Deportes y uno de Hipismo con el MISMO titular/grupo_id
//      son independientes: no se mezclan al listar ni al armar la
//      tarjeta (confirmado con el usuario: "son cuadros independiente
//      por modulo").
//   f) Guardas de tenant/módulo: crear con un titular que no es de este
//      grupo, agregar un cliente ajeno, o pedir/borrar un grupo con el
//      grupoId/módulo equivocado, nunca revientan y nunca "contaminan"
//      datos de otro tenant — dan 404/error esperado.
//   g) El link público (por token) arma la MISMA tarjeta que la ruta
//      autenticada, para cualquiera de los 2 módulos; un token inválido
//      da 404.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-gc-1'; // mismo "tenant" para Deportes e Hipismo, a propósito (ver caso "e")
const JUG_LOBO = 'jug-lobo';      // titular de ambos grupos (Deportes e Hipismo, filas aparte)
const JUG_MARCAS = 'jug-marcas';  // miembro agregado a mano
const JUG_OTRO_GRUPO = 'jug-de-otro-grupo'; // cliente de OTRO tenant, para el caso "f"

// Semana actual fijada a lunes 21 al domingo 27 de sept de 2026; semana
// anterior lunes 14 al domingo 20 (mismo par de semanas que ya usa
// test_hipismo_cierre_final_rango_personalizado.js) — "hoy" se pisa más
// abajo con Date falso para que caiga en 2026-09-22 (martes), adentro de
// la semana actual.
const TABLAS = {
  grupos: [
    { id: GRUPO_ID, nombre: 'GORILAS GROUP', modelo_comision: null, comision_tiers: null }
  ],
  jugadores: [
    { id: JUG_LOBO, grupo_id: GRUPO_ID, nombre: 'LOBO', comision_propia: 0, modelo_comision: null, activo: true },
    { id: JUG_MARCAS, grupo_id: GRUPO_ID, nombre: 'MARCAS', comision_propia: 0, modelo_comision: null, activo: true },
    { id: JUG_OTRO_GRUPO, grupo_id: 'otro-grupo-ajeno', nombre: 'AJENO', comision_propia: 0, modelo_comision: null, activo: true }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  grupos_clientes: [],
  grupos_clientes_miembros: [],

  // --- Deportes: tickets_historial (LOBO y MARCAS, semana actual y anterior) ---
  tickets_historial: [
    { id: 'th1', grupo_id: GRUPO_ID, fecha: '2026-09-22', cliente_nombre: 'LOBO', ticket_label: 'T1', detalle: 'x', arriesga: 100, gana: 0, estado: 'PERDIDA' },   // semana actual
    { id: 'th2', grupo_id: GRUPO_ID, fecha: '2026-09-16', cliente_nombre: 'LOBO', ticket_label: 'T2', detalle: 'x', arriesga: 50, gana: 90, estado: 'GANADA' },     // semana anterior
    { id: 'th3', grupo_id: GRUPO_ID, fecha: '2026-09-23', cliente_nombre: 'MARCAS', ticket_label: 'T3', detalle: 'x', arriesga: 30, gana: 0, estado: 'PERDIDA' }    // semana actual
  ],
  polla_historial: [],
  transferencias: [],

  // --- Hipismo: planos/tickets (LOBO y MARCAS, semana actual y anterior) ---
  hipismo_planos: [
    { id: 'plano-actual', grupo_id: GRUPO_ID, fecha: '2026-09-22' },
    { id: 'plano-anterior', grupo_id: GRUPO_ID, fecha: '2026-09-16' }
  ],
  hipismo_tickets: [
    { plano_id: 'plano-actual', grupo_id: GRUPO_ID, cliente_nombre: 'LOBO', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 40, resultado_banquero: -42 },
    { plano_id: 'plano-anterior', grupo_id: GRUPO_ID, cliente_nombre: 'LOBO', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: 15, resultado_banquero: -15.75 },
    { plano_id: 'plano-actual', grupo_id: GRUPO_ID, cliente_nombre: 'MARCAS', banquero_nombre: 'BANCA', monto: 10, resultado_jugador: -20, resultado_banquero: 21 }
  ],
  hipismo_remates: [],
  hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_winners: [],
  hipismo_comisiones_ajustes: []
};

function enRango(fila, desde, hasta) {
  return (!desde || fila.fecha >= desde) && (!hasta || fila.fecha <= hasta);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // --- cargarConfigGrupo() (Deportes) ---
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: g ? [{ modelo_comision: g.modelo_comision, comision_tiers: g.comision_tiers }] : [] };
  }
  // --- calcularBalanceSemanalPorCliente() (Deportes) ---
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ id: t.id, fecha: t.fecha, cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado })) };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) return { rows: [] };

  // --- construirCierreFinalHipismo() (Hipismo) ---
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: false, cruza_jugadas: false }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto(, j\.gano)?\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre, cc_av\.nombre AS cc_avalador_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes\s+WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3\s+GROUP BY cliente_nombre/i.test(sql)) return { rows: [] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) return { rows: [{ total: 0 }] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) return { rows: [{ total: 0 }] };

  // --- src/services/gruposClientes.js: CRUD propio ---
  if (/^SELECT id, nombre FROM jugadores WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const j = TABLAS.jugadores.find(j => j.id === params[0] && j.grupo_id === params[1]);
    return { rows: j ? [{ id: j.id, nombre: j.nombre }] : [] };
  }
  if (/^INSERT INTO grupos_clientes \(grupo_id, modulo, titular_id\)/i.test(sql)) {
    const [grupoId, modulo, titularId] = params;
    const fila = { id: 'gc-' + (TABLAS.grupos_clientes.length + 1), grupo_id: grupoId, modulo, titular_id: titularId, token: 'token-' + grupoId + '-' + modulo + '-' + (TABLAS.grupos_clientes.length + 1), creado_en: new Date().toISOString() };
    TABLAS.grupos_clientes.push(fila);
    return { rows: [{ id: fila.id, token: fila.token, titular_id: fila.titular_id, creado_en: fila.creado_en }] };
  }
  if (/^SELECT gc\.id, gc\.token, gc\.titular_id, gc\.creado_en, j\.nombre AS titular_nombre,/i.test(sql)) {
    const [grupoId, modulo] = params;
    const filas = TABLAS.grupos_clientes.filter(gc => gc.grupo_id === grupoId && gc.modulo === modulo);
    return {
      rows: filas.map(gc => ({
        id: gc.id, token: gc.token, titular_id: gc.titular_id, creado_en: gc.creado_en,
        titular_nombre: TABLAS.jugadores.find(j => j.id === gc.titular_id).nombre,
        cantidad_miembros: TABLAS.grupos_clientes_miembros.filter(m => m.grupo_cliente_id === gc.id).length
      })).sort((a, b) => a.titular_nombre.localeCompare(b.titular_nombre))
    };
  }
  if (/^DELETE FROM grupos_clientes WHERE id = \$1 AND grupo_id = \$2 AND modulo = \$3 RETURNING id$/i.test(sql)) {
    const [id, grupoId, modulo] = params;
    const idx = TABLAS.grupos_clientes.findIndex(gc => gc.id === id && gc.grupo_id === grupoId && gc.modulo === modulo);
    if (idx === -1) return { rows: [] };
    TABLAS.grupos_clientes.splice(idx, 1);
    TABLAS.grupos_clientes_miembros = TABLAS.grupos_clientes_miembros.filter(m => m.grupo_cliente_id !== id); // on delete cascade
    return { rows: [{ id }] };
  }
  if (/^SELECT id FROM grupos_clientes WHERE id = \$1 AND grupo_id = \$2 AND modulo = \$3$/i.test(sql)) {
    const [id, grupoId, modulo] = params;
    const gc = TABLAS.grupos_clientes.find(gc => gc.id === id && gc.grupo_id === grupoId && gc.modulo === modulo);
    return { rows: gc ? [{ id: gc.id }] : [] };
  }
  if (/^SELECT id FROM jugadores WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const j = TABLAS.jugadores.find(j => j.id === params[0] && j.grupo_id === params[1]);
    return { rows: j ? [{ id: j.id }] : [] };
  }
  if (/^INSERT INTO grupos_clientes_miembros \(grupo_cliente_id, jugador_id\)/i.test(sql)) {
    const [grupoClienteId, jugadorId] = params;
    if (!TABLAS.grupos_clientes_miembros.some(m => m.grupo_cliente_id === grupoClienteId && m.jugador_id === jugadorId)) {
      TABLAS.grupos_clientes_miembros.push({ grupo_cliente_id: grupoClienteId, jugador_id: jugadorId });
    }
    return { rows: [] };
  }
  if (/^DELETE FROM grupos_clientes_miembros WHERE grupo_cliente_id = \$1 AND jugador_id = \$2$/i.test(sql)) {
    const [grupoClienteId, jugadorId] = params;
    TABLAS.grupos_clientes_miembros = TABLAS.grupos_clientes_miembros.filter(m => !(m.grupo_cliente_id === grupoClienteId && m.jugador_id === jugadorId));
    return { rows: [] };
  }
  // --- construirTarjetaGrupoCliente()/construirTarjetaPorToken() ---
  if (/^SELECT gc\.id, gc\.grupo_id, gc\.modulo, gc\.titular_id, gc\.token, gc\.creado_en,\s+g\.nombre AS grupo_nombre\s+FROM grupos_clientes gc\s+JOIN grupos g ON g\.id = gc\.grupo_id\s+WHERE gc\.id = \$1/i.test(sql)) {
    const id = params[0];
    const gc = TABLAS.grupos_clientes.find(gc => gc.id === id);
    if (!gc) return { rows: [] };
    // Filtros opcionales de grupoId/modulo (params[1]/params[2] en el orden
    // en que la función los agregó) — si vienen, deben calzar o no hay fila.
    if (params.length >= 2 && gc.grupo_id !== params[1]) return { rows: [] };
    if (params.length >= 3 && gc.modulo !== params[2]) return { rows: [] };
    const grupo = TABLAS.grupos.find(g => g.id === gc.grupo_id);
    return { rows: [{ id: gc.id, grupo_id: gc.grupo_id, modulo: gc.modulo, titular_id: gc.titular_id, token: gc.token, creado_en: gc.creado_en, grupo_nombre: grupo.nombre }] };
  }
  if (/^SELECT id, nombre FROM jugadores WHERE id = \$1$/i.test(sql)) {
    const j = TABLAS.jugadores.find(j => j.id === params[0]);
    return { rows: j ? [{ id: j.id, nombre: j.nombre }] : [] };
  }
  if (/^SELECT j\.id, j\.nombre\s+FROM jugadores j\s+JOIN grupos_clientes_miembros m ON m\.jugador_id = j\.id\s+WHERE m\.grupo_cliente_id = \$1$/i.test(sql)) {
    const id = params[0];
    const miembros = TABLAS.grupos_clientes_miembros.filter(m => m.grupo_cliente_id === id).map(m => TABLAS.jugadores.find(j => j.id === m.jugador_id));
    return { rows: miembros.map(j => ({ id: j.id, nombre: j.nombre })) };
  }
  if (/^SELECT id FROM grupos_clientes WHERE token = \$1$/i.test(sql)) {
    const gc = TABLAS.grupos_clientes.find(gc => gc.token === params[0]);
    return { rows: gc ? [{ id: gc.id }] : [] };
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

const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
const gruposClientesRouter = require(path.join(__dirname, '..', 'src', 'routes', 'gruposClientes'));
const gruposClientesPublicoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'gruposClientesPublico'));

Module._load = originalLoad;

function handlerDe(router, metodo, rutaPath) {
  const entrada = router.__handlers.find(([m, args]) => m === metodo && args[0] === rutaPath);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo.toUpperCase() + ' ' + rutaPath);
  return entrada[1][entrada[1].length - 1];
}
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
function reqBase(grupoId, params, body, query) {
  return { grupoId, grupo: { nombre: 'GORILAS GROUP', modulo_hipismo_habilitado: true }, params: params || {}, body: body || {}, query: query || {} };
}
function reqPublico(params) {
  return { params: params || {}, body: {}, query: {} };
}

const hGetHip = handlerDe(hipismoRouter, 'get', '/grupos-clientes');
const hPostHip = handlerDe(hipismoRouter, 'post', '/grupos-clientes');
const hGetOneHip = handlerDe(hipismoRouter, 'get', '/grupos-clientes/:id');
const hDeleteHip = handlerDe(hipismoRouter, 'delete', '/grupos-clientes/:id');
const hAddMiembroHip = handlerDe(hipismoRouter, 'post', '/grupos-clientes/:id/miembros');
const hDelMiembroHip = handlerDe(hipismoRouter, 'delete', '/grupos-clientes/:id/miembros/:jugadorId');

const hGetDep = handlerDe(gruposClientesRouter, 'get', '/');
const hPostDep = handlerDe(gruposClientesRouter, 'post', '/');
const hGetOneDep = handlerDe(gruposClientesRouter, 'get', '/:id');
const hDeleteDep = handlerDe(gruposClientesRouter, 'delete', '/:id');
const hAddMiembroDep = handlerDe(gruposClientesRouter, 'post', '/:id/miembros');

const hPublico = handlerDe(gruposClientesPublicoRouter, 'get', '/:token');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // "Hoy" pisado a 2026-09-22 (martes), adentro de la semana actual
  // 21-27 de sept — mismo criterio que test_hipismo_cierre_final_rango_
  // personalizado.js.
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-22T12:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };

  try {
    // =============================================================
    // HIPISMO
    // =============================================================
    const resCrearHip = await invocarRuta(hPostHip, reqBase(GRUPO_ID, {}, { titularId: JUG_LOBO }));
    check(resCrearHip._status === 201, '1) POST /hipismo/grupos-clientes con titular válido -> 201');
    check(resCrearHip._json.grupoCliente.titularNombre === 'LOBO', 'El grupo creado trae el nombre del titular (LOBO)');
    const idGrupoHip = resCrearHip._json.grupoCliente.id;
    const tokenGrupoHip = resCrearHip._json.grupoCliente.token;

    const resCrearHipMalo = await invocarRuta(hPostHip, reqBase(GRUPO_ID, {}, { titularId: JUG_OTRO_GRUPO }));
    check(resCrearHipMalo._status === 404, '2) POST con un titular que NO es de este grupo -> 404, nunca crea el grupo con un cliente ajeno');

    const resAgregarMiembroHip = await invocarRuta(hAddMiembroHip, reqBase(GRUPO_ID, { id: idGrupoHip }, { jugadorId: JUG_MARCAS }));
    check(resAgregarMiembroHip._status === 200, '3) Agregar MARCAS como miembro del grupo de Hipismo -> 200');

    const resAgregarAjenoHip = await invocarRuta(hAddMiembroHip, reqBase(GRUPO_ID, { id: idGrupoHip }, { jugadorId: JUG_OTRO_GRUPO }));
    check(resAgregarAjenoHip._status === 404, '4) Agregar un cliente de OTRO tenant como miembro -> 404, nunca lo agrega');

    const resTarjetaHip = await invocarRuta(hGetOneHip, reqBase(GRUPO_ID, { id: idGrupoHip }));
    check(resTarjetaHip._status === 200, '5) GET de la tarjeta del grupo de Hipismo -> 200');
    const tarjetaHip = resTarjetaHip._json;
    check(tarjetaHip.modulo === 'hipismo', 'La tarjeta trae modulo: "hipismo"');
    check(tarjetaHip.titular.nombre === 'LOBO', 'titular.nombre es LOBO');
    check(tarjetaHip.miembros.length === 2, '6) La tarjeta trae 2 miembros: LOBO (titular, NUNCA insertado a mano en grupos_clientes_miembros) + MARCAS');
    const lobosHip = tarjetaHip.miembros.find(m => m.nombre === 'LOBO');
    const marcasHip = tarjetaHip.miembros.find(m => m.nombre === 'MARCAS');
    check(!!lobosHip && lobosHip.esTitular === true, '7) LOBO sale con esTitular: true, aunque nunca se insertó en grupos_clientes_miembros a mano');
    check(!!marcasHip && marcasHip.esTitular === false, 'MARCAS sale con esTitular: false');
    check(lobosHip.saldoSemanaActual !== lobosHip.saldoSemanaAnterior, '8) saldoSemanaActual y saldoSemanaAnterior de LOBO salen de rangos de fecha distintos -> números distintos');
    check(lobosHip.saldoSemanaActual !== 0, 'saldoSemanaActual de LOBO no queda en 0 (sí hubo una jugada esa semana)');
    check(lobosHip.saldoSemanaAnterior !== 0, 'saldoSemanaAnterior de LOBO no queda en 0 (sí hubo una jugada la semana pasada)');
    const sumaActualHip = Math.round((lobosHip.saldoSemanaActual + marcasHip.saldoSemanaActual) * 100) / 100;
    check(Math.abs(tarjetaHip.totalSemanaActual - sumaActualHip) < 0.01, '9) totalSemanaActual es la SUMA de los saldoSemanaActual de cada miembro');

    // Link público, mismo grupo de Hipismo
    const resPublicoHip = await invocarRuta(hPublico, reqPublico({ token: tokenGrupoHip }));
    check(resPublicoHip._status === 200, '10) GET /api/grupo-cliente/:token (público, sin login) del grupo de Hipismo -> 200');
    check(resPublicoHip._json.modulo === 'hipismo' && resPublicoHip._json.titular.nombre === 'LOBO', 'La tarjeta pública trae exactamente lo mismo que la ruta autenticada');

    const resPublicoInvalido = await invocarRuta(hPublico, reqPublico({ token: 'token-que-no-existe' }));
    check(resPublicoInvalido._status === 404, '11) Un token inválido en el link público -> 404, no revienta');

    // =============================================================
    // DEPORTES — mismo grupo_id/titular, módulo aparte (caso "e")
    // =============================================================
    const resCrearDep = await invocarRuta(hPostDep, reqBase(GRUPO_ID, {}, { titularId: JUG_LOBO }));
    check(resCrearDep._status === 201, '12) POST /grupos-clientes (Deportes) con el MISMO titular LOBO -> 201, fila aparte de la de Hipismo');
    const idGrupoDep = resCrearDep._json.grupoCliente.id;
    check(idGrupoDep !== idGrupoHip, 'El grupo de Deportes tiene un id distinto al de Hipismo, aunque comparten titular y grupo_id');

    await invocarRuta(hAddMiembroDep, reqBase(GRUPO_ID, { id: idGrupoDep }, { jugadorId: JUG_MARCAS }));

    const resTarjetaDep = await invocarRuta(hGetOneDep, reqBase(GRUPO_ID, { id: idGrupoDep }));
    check(resTarjetaDep._status === 200, '13) GET de la tarjeta del grupo de Deportes -> 200');
    const tarjetaDep = resTarjetaDep._json;
    check(tarjetaDep.modulo === 'deportes', 'La tarjeta trae modulo: "deportes"');
    check(tarjetaDep.miembros.length === 2, 'También trae 2 miembros (LOBO titular + MARCAS)');
    const lobosDep = tarjetaDep.miembros.find(m => m.nombre === 'LOBO');
    check(lobosDep.saldoSemanaActual !== lobosHip.saldoSemanaActual, '14) El saldo de LOBO en Deportes es DISTINTO al de Hipismo (cuadros independientes por módulo, nunca se mezclan ni se suman)');

    // El grupo de Deportes NO debe aparecer si se pide con módulo Hipismo (y viceversa)
    const resTarjetaDepComoHip = await invocarRuta(hGetOneHip, reqBase(GRUPO_ID, { id: idGrupoDep }));
    check(resTarjetaDepComoHip._status === 404, '15) Pedir el grupo de Deportes por la ruta de Hipismo -> 404 (nunca se cruzan)');

    // Listados: cada módulo ve SOLO el suyo
    const resListaHip = await invocarRuta(hGetHip, reqBase(GRUPO_ID));
    check(resListaHip._json.grupos.length === 1 && resListaHip._json.grupos[0].id === idGrupoHip, '16) El listado de Hipismo trae SOLO el grupo de Hipismo (1), no el de Deportes');
    const resListaDep = await invocarRuta(hGetDep, reqBase(GRUPO_ID));
    check(resListaDep._json.grupos.length === 1 && resListaDep._json.grupos[0].id === idGrupoDep, 'El listado de Deportes trae SOLO el grupo de Deportes (1), no el de Hipismo');
    check(resListaDep._json.grupos[0].cantidadMiembros === 1, '17) cantidadMiembros del grupo de Deportes es 1 (solo MARCAS — el titular no cuenta acá, se agrega aparte al armar la tarjeta)');

    // =============================================================
    // BORRAR — con guarda de tenant/módulo
    // =============================================================
    const resBorrarConGrupoEquivocado = await invocarRuta(hDeleteHip, reqBase('otro-tenant-cualquiera', { id: idGrupoHip }));
    check(resBorrarConGrupoEquivocado._status === 404, '18) Borrar el grupo de Hipismo mandando un grupoId de OTRO tenant -> 404, no lo borra');
    const resTarjetaSigueExistiendo = await invocarRuta(hGetOneHip, reqBase(GRUPO_ID, { id: idGrupoHip }));
    check(resTarjetaSigueExistiendo._status === 200, 'El grupo de Hipismo SIGUE existiendo después del intento fallido de borrado');

    const resBorrarHip = await invocarRuta(hDeleteHip, reqBase(GRUPO_ID, { id: idGrupoHip }));
    check(resBorrarHip._status === 200 && resBorrarHip._json.ok === true, '19) Borrar el grupo de Hipismo con el grupoId correcto -> 200 ok:true');
    const resTarjetaYaNoExiste = await invocarRuta(hGetOneHip, reqBase(GRUPO_ID, { id: idGrupoHip }));
    check(resTarjetaYaNoExiste._status === 404, 'Después de borrado, pedir su tarjeta da 404');
    const resListaHipVacia = await invocarRuta(hGetHip, reqBase(GRUPO_ID));
    check(resListaHipVacia._json.grupos.length === 0, 'El listado de Hipismo queda vacío — el de Deportes (idGrupoDep) sigue intacto, nunca se tocó');
    const resListaDepSigue = await invocarRuta(hGetDep, reqBase(GRUPO_ID));
    check(resListaDepSigue._json.grupos.length === 1, 'El grupo de Deportes NO se borró de rebote al borrar el de Hipismo');
  } finally {
    global.Date = OriginalDate;
  }
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
