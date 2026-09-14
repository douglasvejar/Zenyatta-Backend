// =================================================================
// PRUEBA: borrar jugadas/sábana (y Polla) por fecha + teléfonos de
// WhatsApp del grupo — ambas cosas a pedido del usuario (02-09-2026):
// "Crea un boton en superadmin al seleccionar determinado grupo que ese
// boton me permita borrar todas las jugadas... eligiendo yo las fechas" y
// "crea un boton en super admin, que al seleccionar determinado grupo
// pueda agregarle dos o tres numeros de telefonos con su apodo".
// =================================================================
// Mismo patrón de base de datos falsa + express falso que
// test_superadmin_logo.js/test_polla.js — invoca el handler real de cada
// ruta directo, sin levantar un servidor HTTP.
//
// Cubre:
//   1. listarFechasConDatos()/GET .../fechas-con-datos: junta fechas de
//      tickets_historial Y polla_historial (una fecha con SOLO polla
//      también aparece), con la cantidad de cada una.
//   2. borrarDatosDeFechas()/POST .../borrar-fechas: borra tickets Y
//      polla de las fechas elegidas (nunca de otras), desconfirma esos
//      días, y NO toca alertas (se verifica indirectamente: la función
//      nunca hace ningún DELETE FROM alertas — si lo hiciera, esta
//      prueba reventaría con "la base de datos falsa no sabe responder").
//      Body sin fechas -> 400, sin tocar nada.
//   3. Teléfonos: listar (vacío al principio, ordenados por creado_en),
//      agregar (limpia el número a solo dígitos, valida apodo y largo
//      mínimo), tope de 3, y borrar.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  tickets_historial: [
    { grupo_id: 'grupo-1', fecha: '2026-08-20', id: 't1' },
    { grupo_id: 'grupo-1', fecha: '2026-08-20', id: 't2' },
    { grupo_id: 'grupo-1', fecha: '2026-08-21', id: 't3' },
    { grupo_id: 'grupo-2', fecha: '2026-08-20', id: 't4' } // de OTRO grupo, no debe aparecer ni borrarse
  ],
  polla_historial: [
    { grupo_id: 'grupo-1', fecha: '2026-08-21', id: 'p1' },
    { grupo_id: 'grupo-1', fecha: '2026-08-22', id: 'p2' } // fecha SOLO con polla, sin tickets
  ],
  dias_confirmados: [
    { grupo_id: 'grupo-1', fecha: '2026-08-20' },
    { grupo_id: 'grupo-1', fecha: '2026-08-21' }
  ],
  // (04-09-2026) el "estado" del bot de WhatsApp para 2026-08-20 (grupo-1)
  // — simula justo el escenario reportado: esa fecha SÍ llegó por
  // WhatsApp (tiene texto guardado), y por eso el reloj de fondo/el panel
  // la seguían reprocesando después de borrarla. 2026-08-21 nunca llegó
  // por WhatsApp (no tiene fila acá) — sirve para confirmar que borrar
  // esa fecha en el futuro no revienta aunque no haya nada que borrar.
  whatsapp_dia_estado: [
    { grupo_id: 'grupo-1', fecha: '2026-08-20', ultimo_texto: 'SABANA DE JUGADAS\n20-08-2026\n...' },
    { grupo_id: 'grupo-2', fecha: '2026-08-20', ultimo_texto: 'de OTRO grupo, no debe tocarse' }
  ],
  grupo_telefonos: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  // --- Mantenimiento por fecha ---
  if (/^SELECT fecha, COUNT\(\*\)::int AS n FROM tickets_historial WHERE grupo_id = \$1 GROUP BY fecha/i.test(sql)) {
    const conteo = {};
    TABLAS.tickets_historial.filter(r => r.grupo_id === params[0]).forEach(r => { conteo[r.fecha] = (conteo[r.fecha] || 0) + 1; });
    return { rows: Object.keys(conteo).map(fecha => ({ fecha, n: conteo[fecha] })) };
  }
  if (/^SELECT fecha, COUNT\(\*\)::int AS n FROM polla_historial WHERE grupo_id = \$1 GROUP BY fecha/i.test(sql)) {
    const conteo = {};
    TABLAS.polla_historial.filter(r => r.grupo_id === params[0]).forEach(r => { conteo[r.fecha] = (conteo[r.fecha] || 0) + 1; });
    return { rows: Object.keys(conteo).map(fecha => ({ fecha, n: conteo[fecha] })) };
  }
  if (/^DELETE FROM tickets_historial WHERE grupo_id = \$1 AND fecha = ANY\(\$2::date\[\]\)/i.test(sql)) {
    const [grupoId, fechas] = params;
    const antes = TABLAS.tickets_historial.length;
    TABLAS.tickets_historial = TABLAS.tickets_historial.filter(r => !(r.grupo_id === grupoId && fechas.includes(r.fecha)));
    return { rows: [], rowCount: antes - TABLAS.tickets_historial.length };
  }
  if (/^DELETE FROM polla_historial WHERE grupo_id = \$1 AND fecha = ANY\(\$2::date\[\]\)/i.test(sql)) {
    const [grupoId, fechas] = params;
    const antes = TABLAS.polla_historial.length;
    TABLAS.polla_historial = TABLAS.polla_historial.filter(r => !(r.grupo_id === grupoId && fechas.includes(r.fecha)));
    return { rows: [], rowCount: antes - TABLAS.polla_historial.length };
  }
  if (/^DELETE FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.dias_confirmados = TABLAS.dias_confirmados.filter(d => !(d.grupo_id === grupoId && d.fecha === fecha));
    return { rows: [] };
  }
  // (04-09-2026) eliminarEstadoDia() — ver whatsappDiaEstado.js
  if (/^DELETE FROM whatsapp_dia_estado WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.whatsapp_dia_estado = TABLAS.whatsapp_dia_estado.filter(w => !(w.grupo_id === grupoId && w.fecha === fecha));
    return { rows: [] };
  }

  // --- Teléfonos ---
  if (/^SELECT id, telefono, apodo, creado_en FROM grupo_telefonos WHERE grupo_id = \$1 ORDER BY creado_en ASC/i.test(sql)) {
    return { rows: TABLAS.grupo_telefonos.filter(t => t.grupo_id === params[0]).sort((a, b) => a.creado_en - b.creado_en) };
  }
  if (/^INSERT INTO grupo_telefonos \(grupo_id, telefono, apodo\) VALUES \(\$1, \$2, \$3\) RETURNING id, telefono, apodo, creado_en/i.test(sql)) {
    const [grupoId, telefono, apodo] = params;
    const fila = { id: 'tel-' + (TABLAS.grupo_telefonos.length + 1), grupo_id: grupoId, telefono, apodo, creado_en: TABLAS.grupo_telefonos.length + 1 };
    TABLAS.grupo_telefonos.push(fila);
    return { rows: [{ id: fila.id, telefono, apodo, creado_en: fila.creado_en }] };
  }
  if (/^DELETE FROM grupo_telefonos WHERE id = \$1 AND grupo_id = \$2/i.test(sql)) {
    const [id, grupoId] = params;
    TABLAS.grupo_telefonos = TABLAS.grupo_telefonos.filter(t => !(t.id === id && t.grupo_id === grupoId));
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
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'x' }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.SUPERADMIN_SECRET = 'fake-secret';

const superadminRouter = require(path.join(__dirname, '..', 'src', 'routes', 'superadmin'));

Module._load = originalLoad;

function handlerDe(metodo, ruta) {
  const entrada = superadminRouter.__handlers.find(([m, args]) => m === metodo && args[0] === ruta);
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo.toUpperCase() + ' ' + ruta);
  return entrada[1][entrada[1].length - 1];
}

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
  // =================================================================
  // 1. GET /grupos/:id/fechas-con-datos
  // =================================================================
  const handlerFechas = handlerDe('get', '/grupos/:id/fechas-con-datos');
  const resFechas = await invocarRuta(handlerFechas, { params: { id: 'grupo-1' } });
  check(resFechas._status === 200, 'GET fechas-con-datos responde 200');
  check(resFechas._json.length === 3, 'GET fechas-con-datos junta las 3 fechas del grupo-1 (2 con tickets, 1 solo con polla)');
  const f20 = resFechas._json.find(f => f.fecha === '2026-08-20');
  check(f20 && f20.tickets === 2 && f20.polla === 0, '2026-08-20 tiene 2 tickets y 0 polla');
  const f21 = resFechas._json.find(f => f.fecha === '2026-08-21');
  check(f21 && f21.tickets === 1 && f21.polla === 1, '2026-08-21 tiene 1 ticket y 1 polla');
  const f22 = resFechas._json.find(f => f.fecha === '2026-08-22');
  check(f22 && f22.tickets === 0 && f22.polla === 1, '2026-08-22 (SOLO polla, sin tickets) también aparece en la lista');
  check(!resFechas._json.find(f => f.fecha === undefined), 'No hay fechas "fantasma" sin definir');

  // =================================================================
  // 2. POST /grupos/:id/borrar-fechas
  // =================================================================
  const handlerBorrar = handlerDe('post', '/grupos/:id/borrar-fechas');

  // Sin fechas -> 400, no toca nada
  const resVacio = await invocarRuta(handlerBorrar, { params: { id: 'grupo-1' }, body: {} });
  check(resVacio._status === 400, 'POST borrar-fechas sin "fechas" responde 400');
  check(TABLAS.tickets_historial.length === 4, 'Nada se borró todavía (sigue habiendo 4 tickets en total)');

  // Borra 2026-08-20 y 2026-08-22 (deja 2026-08-21 intacta)
  const resBorrar = await invocarRuta(handlerBorrar, { params: { id: 'grupo-1' }, body: { fechas: ['2026-08-20', '2026-08-22'] } });
  check(resBorrar._status === 200, 'POST borrar-fechas responde 200');
  check(resBorrar._json.ticketsBorrados === 2, 'Borra los 2 tickets de 2026-08-20 (grupo-1)');
  check(resBorrar._json.pollaBorrada === 1, 'Borra la 1 fila de polla de 2026-08-22');
  check(TABLAS.tickets_historial.filter(t => t.grupo_id === 'grupo-1' && t.fecha === '2026-08-20').length === 0, 'Ya no quedan tickets de grupo-1 en 2026-08-20');
  check(TABLAS.tickets_historial.find(t => t.grupo_id === 'grupo-2' && t.fecha === '2026-08-20'), 'El ticket de OTRO grupo (grupo-2) en la misma fecha NO se tocó');
  check(TABLAS.tickets_historial.find(t => t.fecha === '2026-08-21'), 'Los tickets de 2026-08-21 (fecha NO elegida) siguen intactos');
  check(TABLAS.polla_historial.find(p => p.fecha === '2026-08-21'), 'La polla de 2026-08-21 (fecha NO elegida) sigue intacta');
  check(TABLAS.dias_confirmados.filter(d => d.grupo_id === 'grupo-1' && d.fecha === '2026-08-20').length === 0, 'Borrar una fecha también la desconfirma (ya no hay sábana que confirmar)');
  check(TABLAS.dias_confirmados.find(d => d.fecha === '2026-08-21'), '2026-08-21 (no borrada) sigue confirmada — borrar OTRAS fechas no la desconfirma');

  // (04-09-2026) "el ticket que borro me vuelve a aparecer" — borrar la
  // fecha también tiene que borrar el seguimiento de WhatsApp de esa
  // fecha, para que el bot no la vuelva a reprocesar sola.
  check(TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === 'grupo-1' && w.fecha === '2026-08-20') === undefined,
    'Borrar 2026-08-20 (que SÍ había llegado por WhatsApp) también borra su fila de whatsapp_dia_estado — el bot ya no la va a reprocesar sola');
  check(TABLAS.whatsapp_dia_estado.find(w => w.grupo_id === 'grupo-2' && w.fecha === '2026-08-20'),
    'La fila de whatsapp_dia_estado de OTRO grupo (grupo-2), misma fecha, NO se tocó');
  // 2026-08-22 (la otra fecha borrada en este mismo pedido) nunca tuvo
  // ninguna fila en whatsapp_dia_estado (nunca llegó por WhatsApp) — el
  // DELETE de esa fecha no encuentra nada, y ya se vio arriba (resBorrar
  // 200) que eso no revienta la ruta.

  // =================================================================
  // 3. TELÉFONOS DE WHATSAPP
  // =================================================================
  const handlerListarTel = handlerDe('get', '/grupos/:id/telefonos');
  const handlerAgregarTel = handlerDe('post', '/grupos/:id/telefonos');
  const handlerBorrarTel = handlerDe('delete', '/grupos/:id/telefonos/:telId');

  const resVacioTel = await invocarRuta(handlerListarTel, { params: { id: 'grupo-1' } });
  check(resVacioTel._json.length === 0, 'Al principio el grupo no tiene teléfonos cargados');

  // Apodo faltante -> 400
  const resSinApodo = await invocarRuta(handlerAgregarTel, { params: { id: 'grupo-1' }, body: { telefono: '584121234567', apodo: '' } });
  check(resSinApodo._status === 400, 'Agregar sin apodo responde 400');

  // Número inválido (muy corto) -> 400
  const resNumCorto = await invocarRuta(handlerAgregarTel, { params: { id: 'grupo-1' }, body: { telefono: '123', apodo: 'Carlos' } });
  check(resNumCorto._status === 400, 'Un número demasiado corto responde 400');

  // Agregar 3 números válidos (con formato "sucio", se limpia a solo dígitos)
  const res1 = await invocarRuta(handlerAgregarTel, { params: { id: 'grupo-1' }, body: { telefono: '+58 412-1234567', apodo: 'Carlos - Soporte' } });
  check(res1._status === 201, 'Agregar el primer número responde 201');
  check(res1._json.telefono === '584121234567', 'El número se guarda limpio (solo dígitos, sin "+" ni espacios ni guiones)');
  await invocarRuta(handlerAgregarTel, { params: { id: 'grupo-1' }, body: { telefono: '584247654321', apodo: 'María' } });
  const res3 = await invocarRuta(handlerAgregarTel, { params: { id: 'grupo-1' }, body: { telefono: '584169998877', apodo: 'Pedro' } });
  check(res3._status === 201, 'Agregar el tercer número responde 201');

  // Un 4to número supera el tope de 3 -> 400
  const res4 = await invocarRuta(handlerAgregarTel, { params: { id: 'grupo-1' }, body: { telefono: '584161112233', apodo: 'Cuarto' } });
  check(res4._status === 400, 'Un 4to número responde 400 — el tope es 3');

  const resListado = await invocarRuta(handlerListarTel, { params: { id: 'grupo-1' } });
  check(resListado._json.length === 3, 'La lista final tiene exactamente 3 números (el 4to no se guardó)');
  check(resListado._json[0].apodo === 'Carlos - Soporte', 'El PRIMER número cargado ("Carlos - Soporte") queda primero en la lista — es el que usará el Cliente para "Tengo diferencia"');

  // Borrar uno
  const idABorrar = resListado._json[1].id;
  await invocarRuta(handlerBorrarTel, { params: { id: 'grupo-1', telId: idABorrar } });
  const resDespuesBorrar = await invocarRuta(handlerListarTel, { params: { id: 'grupo-1' } });
  check(resDespuesBorrar._json.length === 2, 'Después de borrar uno, quedan 2 números');
  check(!resDespuesBorrar._json.find(t => t.id === idABorrar), 'El número borrado ya no aparece en la lista');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de mantenimiento/teléfonos se cayó con una excepción:', e);
  process.exit(1);
});
