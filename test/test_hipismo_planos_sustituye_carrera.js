// =================================================================
// PRUEBA: "Sustituir en vez de duplicar" (29-09-2026, a pedido del
// usuario: "quiero que si se vuelve a meter un plano en una carrera que
// ya existia, el nuevo siempre sustituya al anterior, no duplique las
// carreras"). Antes de esta ronda, POST /planos (Cargar Planos) siempre
// insertaba un hipismo_planos nuevo, sin importar si esa MISMA carrera
// (mismo hipódromo + número de carrera + fecha) ya tenía un plano
// cargado — eso dejaba 2 planos vivos a la vez, y Balance General/Cierre
// Final sumaban los 2, duplicando esa carrera en los saldos.
//
// Ahora, antes de guardar el plano nuevo, se busca si YA existe un plano
// para ese mismo hipódromo/carrera/fecha — si existe, se manda a la
// Papelera (services/hipismoPlanosPapelera.js, recuperable 30 días,
// MISMO criterio que "Eliminar Planos") y solo queda vivo el nuevo.
//
// Casos cubiertos:
//   1. Primer plano de una carrera: se guarda normal, sustituyoAnterior
//      = false.
//   2. Un segundo plano para LA MISMA carrera (mismo hipódromo + número +
//      fecha): sustituyoAnterior = true, el plano viejo desaparece de
//      hipismo_planos (queda solo el nuevo) y aparece en
//      hipismo_planos_papelera, recuperable.
//   3. Un plano de OTRA carrera (distinto número) NO dispara ninguna
//      sustitución — sigue guardando normal, sin tocar la carrera
//      anterior.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-sustituye-1';
const FECHA = '2026-09-29';

const TABLAS = {
  jugadores: [],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [],
  hipismo_tickets: [],
  hipismo_planos_papelera: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_adelantadas_planos: []
};
let siguienteId = 1;
function nuevoId(prefijo) { return prefijo + '-' + (siguienteId++); }

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- Jugadas Adelantadas pendientes de esta carrera (siempre vacío) ----
  if (/^SELECT j\.\* FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id/i.test(sql)) {
    return { rows: [] };
  }

  // ---- "Sustituir en vez de duplicar": busca un plano ya existente de
  //      esta misma carrera ----
  if (/^SELECT id FROM hipismo_planos WHERE grupo_id = \$1 AND hipodromo_nombre = \$2 AND carrera_numero = \$3 AND fecha = \$4/i.test(sql)) {
    const [grupoId, hipodromoNombre, carreraNumero, fecha] = params;
    const filas = TABLAS.hipismo_planos.filter(p =>
      p.grupo_id === grupoId && p.hipodromo_nombre === hipodromoNombre &&
      Number(p.carrera_numero) === Number(carreraNumero) && p.fecha === fecha);
    return { rows: filas.map(p => ({ id: p.id })) };
  }

  // ---- hipismoPlanosPapelera.eliminarPlano() ----
  if (/^SELECT \* FROM hipismo_planos WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const p = TABLAS.hipismo_planos.find(x => x.id === id && x.grupo_id === grupoId);
    return { rows: p ? [p] : [] };
  }
  if (/^SELECT \* FROM hipismo_tickets WHERE plano_id = \$1$/i.test(sql)) {
    const [planoId] = params;
    return { rows: TABLAS.hipismo_tickets.filter(t => t.plano_id === planoId) };
  }
  if (/^INSERT INTO hipismo_planos_papelera/i.test(sql)) {
    const [grupoId, fecha, hipodromoNombre, carreraNumero] = params;
    const fila = { id: nuevoId('papelera'), grupo_id: grupoId, fecha, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero };
    TABLAS.hipismo_planos_papelera.push(fila);
    return { rows: [{ id: fila.id }] };
  }
  if (/^DELETE FROM hipismo_planos WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    TABLAS.hipismo_planos = TABLAS.hipismo_planos.filter(p => !(p.id === id && p.grupo_id === grupoId));
    TABLAS.hipismo_tickets = TABLAS.hipismo_tickets.filter(t => t.plano_id !== id);
    return { rows: [] };
  }

  // ---- autoRegistrarJugadores ----
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    if (!TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      TABLAS.jugadores.push({ id: nuevoId('j'), grupo_id: grupoId, nombre, comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null });
    }
    return { rows: [] };
  }

  // ---- asegurarCuentasComisionParaNombres / obtenerComisionesPropias ----
  if (/^SELECT id, nombre, comision_propia, cuenta_comision_id.*incluir_porcentaje_en_jugadas FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)) };
  }
  if (/^SELECT DISTINCT jap\.avalador_id, av\.nombre AS avalador_nombre, av\.cuenta_comision_id AS avalador_cuenta_comision_id/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre, j\.incluir_porcentaje_en_jugadas/i.test(sql)) {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    return { rows: [] };
  }

  // ---- Guarda el plano nuevo ----
  if (/^INSERT INTO hipismo_planos \(grupo_id, hipodromo_id, hipodromo_nombre, carrera_numero, fecha, ret, pizarra, cruza_jugadas, texto_original, texto_resultado, comision_total\)/i.test(sql)) {
    const [grupoId, hipodromoId, hipodromoNombre, carreraNumero, fecha, ret, pizarra, cruzaJugadas, textoOriginal, textoResultado, comisionTotal] = params;
    const fila = { id: nuevoId('plano'), grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero, fecha, ret, pizarra, cruza_jugadas: cruzaJugadas, texto_original: textoOriginal, texto_resultado: textoResultado, comision_total: comisionTotal };
    TABLAS.hipismo_planos.push(fila);
    return { rows: [fila] };
  }
  if (/^INSERT INTO hipismo_tickets/i.test(sql)) {
    const [planoId, grupoId, clienteNombre, banqueroNombre, modalidad, caballo, monto, resultadoJugador, resultadoBanquero, sinComision] = params;
    TABLAS.hipismo_tickets.push({ id: nuevoId('ticket'), plano_id: planoId, grupo_id: grupoId, cliente_nombre: clienteNombre, banquero_nombre: banqueroNombre, modalidad, caballo, monto, resultado_jugador: resultadoJugador, resultado_banquero: resultadoBanquero, sin_comision: sinComision });
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (planos-sustituye-carrera) no sabe responder: ' + sql);
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
const handlerPlanosGuardar = handlerDe('post', '/planos');

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
function reqBase(grupoId) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) Primer plano de la carrera 5: se guarda normal ---
  const res1 = await invocarRuta(handlerPlanosGuardar, Object.assign(reqBase(GRUPO_ID), {
    body: { texto: 'Juega Sebastian 1p (10) con 50,00 da Flaco', pizarra: '10.2.3', cruzaJugadas: false, hipodromoNombre: 'La Rinconada', carreraNumero: 5, fecha: FECHA }
  }));
  check(res1._status === 201, '1) Primer plano de la carrera 5 se guarda (201)');
  check(res1._json.sustituyoAnterior === false, 'Primer plano: sustituyoAnterior = false (no había nada antes)');
  check(TABLAS.hipismo_planos.length === 1, 'Queda 1 plano vivo');
  check(TABLAS.hipismo_tickets.length === 1, 'Queda 1 ticket vivo (Sebastian/Flaco)');
  check(TABLAS.hipismo_planos_papelera.length === 0, 'Nada en la Papelera todavía');
  const idPlanoViejo = TABLAS.hipismo_planos[0].id;

  // --- 2) Un segundo plano para LA MISMA carrera (mismo hipódromo +
  //     número + fecha) con un texto DISTINTO (corrección del operador):
  //     debe sustituir, no duplicar ---
  const res2 = await invocarRuta(handlerPlanosGuardar, Object.assign(reqBase(GRUPO_ID), {
    body: { texto: 'Juega Sebastian 1p (10) con 80,00 da Flaco', pizarra: '10.2.3', cruzaJugadas: false, hipodromoNombre: 'La Rinconada', carreraNumero: 5, fecha: FECHA }
  }));
  check(res2._status === 201, '2) Segundo plano de la MISMA carrera 5 se guarda (201)');
  check(res2._json.sustituyoAnterior === true, 'sustituyoAnterior = true (ya existía un plano de esta carrera)');
  check(TABLAS.hipismo_planos.length === 1, 'Sigue quedando 1 SOLO plano vivo de la carrera 5 (no se duplicó)');
  check(TABLAS.hipismo_planos[0].id !== idPlanoViejo, 'El plano vivo es el NUEVO (id distinto al primero)');
  check(TABLAS.hipismo_tickets.length === 1 && Number(TABLAS.hipismo_tickets[0].monto) === 80, 'El ticket vivo es el del plano nuevo (monto 80, no 50)');
  check(TABLAS.hipismo_planos_papelera.length === 1, 'El plano viejo quedó guardado en la Papelera (recuperable)');
  check(TABLAS.hipismo_planos_papelera[0].carrera_numero === 5, 'La entrada de la Papelera es de la carrera 5');

  // --- 3) Un plano de OTRA carrera (6) no dispara ninguna sustitución ---
  const res3 = await invocarRuta(handlerPlanosGuardar, Object.assign(reqBase(GRUPO_ID), {
    body: { texto: 'Juega Rambo 1p (7) con 100,00 da Zeta', pizarra: '7.1.4', cruzaJugadas: false, hipodromoNombre: 'La Rinconada', carreraNumero: 6, fecha: FECHA }
  }));
  check(res3._status === 201, '3) Plano de OTRA carrera (6) se guarda (201)');
  check(res3._json.sustituyoAnterior === false, 'sustituyoAnterior = false (la carrera 6 no tenía nada antes)');
  check(TABLAS.hipismo_planos.length === 2, 'Ahora hay 2 planos vivos (carrera 5 y carrera 6), sin tocar la carrera 5');
  check(TABLAS.hipismo_planos_papelera.length === 1, 'La Papelera sigue con solo 1 entrada (la de la carrera 5 sustituida antes)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "sustituir en vez de duplicar" se cayó con una excepción:', e);
  process.exit(1);
});
