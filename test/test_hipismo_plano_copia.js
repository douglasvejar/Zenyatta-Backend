// =================================================================
// PRUEBA: copiar el plano desde "Revisar Jugadas" (08-10-2026, a pedido del
// usuario: "desde aquí dame la opción de copiar el plano en texto o en imagen
// y me lo vas a dar tal cual como si fuera desde Cargar Plano... para que si
// edito poder enviar el plano corregido"). GET /planos/:id/copia reconstruye
// SOLO LEYENDO lo guardado el texto de WhatsApp y los datos de la imagen:
//   1) un plano sin editar sale IDÉNTICO al texto de Cargar Planos;
//   2) si se editó un ticket, el texto y la imagen traen los números nuevos;
//   3) el bloque PARADA ADELANTADAS se arma desde lo guardado de esa carrera
//      (Tabla Fija, Marca y Tercios Adelantadas), con el ítem genérico;
//   4) nunca trae la comisión, y un plano ajeno/inexistente da 404;
//   5) no escribe nada en la base (solo SELECT).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

const GRUPO_ID = 'g-plano-copia-1';
const PLANO_ID = 'plano-1';
const PLANO = { id: PLANO_ID, grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 11, fecha: '2026-10-06', ret: '6', pizarra: '3 4 8 1 7', cruza_jugadas: false, comision_total: 0 };
const TABLAS = { tickets: [], adelantadas: [], tercios: [] };
const escrituras = [];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) { escrituras.push(sql); return { rows: [] }; }
  if (/^SELECT \* FROM hipismo_planos WHERE id = \$1 AND grupo_id = \$2/i.test(sql)) {
    return { rows: params[0] === PLANO_ID && params[1] === GRUPO_ID ? [PLANO] : [] };
  }
  if (/^SELECT \* FROM hipismo_tickets WHERE plano_id = \$1/i.test(sql)) return { rows: TABLAS.tickets };
  if (/FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p/i.test(sql)) return { rows: TABLAS.adelantadas };
  if (/FROM hipismo_tercios_adelantadas_jugadas j JOIN hipismo_tercios_adelantadas_planos p/i.test(sql)) return { rows: TABLAS.tercios };
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
const { calcularPlano, armarTextoResultado, PIE_PLANO_DEFECTO } = require('../src/services/hipismoCalc');
const { armarBloqueAdelantadas, resolverTablaFija } = require('../src/services/hipismoAdelantadasCalc');
Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocar(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, e => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { salida, status };
}

const filaDeTicket = (t, i) => ({
  id: 't' + i, plano_id: PLANO_ID, cliente_nombre: t.clienteNombre, banquero_nombre: t.banqueroNombre, modalidad: t.modalidad,
  caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultadoJugador, resultado_banquero: t.resultadoBanquero, sin_comision: !!t.sinComision
});

(async function main() {
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: { id: PLANO_ID } };
  const handler = handlerDe('get', '/planos/:id/copia');

  // ---- 1) Plano sin editar: idéntico al de Cargar Planos ----
  const texto = 'Juega Sammy 1p (3) con 225 da Zenyatta\nJuega Mujica 1p (5) con 450 da Zenyatta\nJuega Tykhe 1/2 (4) con 200 da Sammy';
  const calc = calcularPlano({ texto, pizarra: PLANO.pizarra, cruzar: false });
  TABLAS.tickets = calc.tickets.map(filaDeTicket);
  const esperado = armarTextoResultado({ nombreGrupo: 'Zenyatta', hipodromoNombre: 'La Rinconada', carreraNumero: 11, ret: '6', pizarra: PLANO.pizarra, salidaLineas: calc.salidaLineas, totalesFinales: calc.totalesFinales, totalJugadas: calc.tickets.length });
  let r = await invocar(handler, reqBase);
  check(r.status === 200 && !!r.salida, '1) GET /planos/:id/copia responde 200');
  check(r.salida.textoResultado === esperado, '2) un plano sin editar sale IDÉNTICO al texto de Cargar Planos' + (r.salida.textoResultado === esperado ? '' : '\n--- esperado ---\n' + esperado + '\n--- obtenido ---\n' + r.salida.textoResultado));
  check(r.salida.datosImagen.jugadas.length === 3 && r.salida.datosImagen.carrera === 11 && r.salida.datosImagen.hipodromo === 'La Rinconada', '3) la imagen trae las 3 jugadas, la carrera y el hipódromo');
  check(r.salida.datosImagen.textoAcompanante === 'TOTALES DE LA CARRERA 11MA EN EL HIPÓDROMO LA RINCONADA EN EL GRUPO ZENYATTA', '4) texto de acompañamiento exacto');
  check(JSON.stringify(r.salida.datosImagen.llegada) === '["3","4","8","1","7"]' && JSON.stringify(r.salida.datosImagen.retirados) === '[6]', '5) llegada y retirado de la imagen');
  check(!/comisi/i.test(JSON.stringify(r.salida.datosImagen)) && !/comisi/i.test(r.salida.textoResultado), '6) ni el texto ni la imagen traen la comisión');

  // ---- 2) Se edita un ticket (Mujica 450 -> 300): sale lo corregido ----
  const editado = calcularPlano({ texto: 'Juega Sammy 1p (3) con 225 da Zenyatta\nJuega Mujica 1p (5) con 300 da Zenyatta\nJuega Tykhe 1/2 (4) con 200 da Sammy', pizarra: PLANO.pizarra, cruzar: false });
  TABLAS.tickets = editado.tickets.map(filaDeTicket);
  r = await invocar(handler, reqBase);
  check(/Mujica -300,00/.test(r.salida.textoResultado) && !/450,00/.test(r.salida.textoResultado), '7) tras editar el monto de Mujica a 300 el texto dice -300,00 y ya no 450,00');
  const mujica = r.salida.datosImagen.pierden.find(([n]) => n === 'Mujica');
  check(mujica && mujica[1] === -300, '8) la imagen también: Mujica -300');
  check(/Total Jugadas: 3/.test(r.salida.textoResultado), '9) trae "Total Jugadas: 3"');

  // ---- 3) Adelantadas de la carrera: Tabla Fija, Marca y Tercios Adelantadas ----
  TABLAS.adelantadas = [
    { id: 'a1', tipo: 'tf', cliente_nombre: 'PEPE', numero_ejemplar: 3, monto: 100, ganancia_potencial: 250, comision_porcentaje: 2.5, sin_comision: false, montos_manuales: false, pizarra_usada: PLANO.pizarra, resultado_cliente: 150, comision: 2.5, estado: 'resuelto', banqueadores: null },
    { id: 'a2', tipo: 'marca', cliente_nombre: 'LUIS', monto: 50, comision_porcentaje: 2.5, resultado_cliente: -50, estado: 'falta_banqueo', banqueadores: null }
  ];
  TABLAS.tercios = [{ id: 'x1', jugador_nombre: 'HANRY', banquero_nombre: 'HALLAND', resultado_jugador: 30, resultado_banquero: -30, estado: 'resuelto' }];
  const tf = resolverTablaFija({ numeroEjemplar: 3, monto: 100, gananciaPotencial: 250 }, h => ({ 3: 1, 4: 2, 8: 3, 1: 4, 7: 5 }[h] || 99), 2.5);
  const movs = [
    { nombre: 'PEPE', monto: 150, individual: true, grupo: 'a1' }, { nombre: 'TABLAS FIJAS', monto: tf.tablasFijas, individual: true, grupo: 'a1' },
    { nombre: 'LUIS', monto: -50, individual: true, grupo: 'a2' }, { nombre: 'MARCAS', monto: 50, individual: true, grupo: 'a2' },
    { nombre: 'HANRY', monto: 30 }, { nombre: 'HALLAND', monto: -30 }
  ];
  const bloque = armarBloqueAdelantadas(movs);
  const esperadoConAdel = armarTextoResultado({ nombreGrupo: 'Zenyatta', hipodromoNombre: 'La Rinconada', carreraNumero: 11, ret: '6', pizarra: PLANO.pizarra, salidaLineas: editado.salidaLineas, totalesFinales: editado.totalesFinales, incluirPie: false, totalJugadas: 3 })
    + '\n\n' + bloque + '\n------------------------------\n------------------------------\n' + PIE_PLANO_DEFECTO;
  r = await invocar(handler, reqBase);
  check(r.salida.textoResultado === esperadoConAdel, '10) con adelantadas: texto idéntico al de Cargar Planos (PARADA ADELANTADAS + pie al final)' + (r.salida.textoResultado === esperadoConAdel ? '' : '\n--- esperado ---\n' + esperadoConAdel + '\n--- obtenido ---\n' + r.salida.textoResultado));
  check(/PARADA ADELANTADAS/.test(r.salida.textoResultado) && /Tablas fijas -152,50/.test(r.salida.textoResultado) && /Marcas \+50,00/.test(r.salida.textoResultado), '11) la Tabla Fija sale con su ítem genérico "Tablas fijas" (-152,50) y la Marca con "Marcas" (+50,00), sin banqueadores reales');
  check(r.salida.textoResultado.trim().endsWith('*TILDE SU JUGADA Y SE REVISARÁ*'), '12) el pie "Tilde su jugada" queda de último');
  const ad = r.salida.datosImagen.adelantadas;
  check(ad && ad.filas.length === 4 && ad.filas.some(f => f.cliente === 'Pepe' && f.item === 'Tablas fijas') && ad.filas.some(f => f.cliente === 'Hanry' && f.item === 'Tercios adel.'), '13) la imagen trae las adelantadas (Pepe + Tablas Fijas, Hanry entre tercios)');

  // ---- 4) Seguridad y solo lectura ----
  const r404 = await invocar(handler, { ...reqBase, params: { id: 'otro-plano' } });
  check(r404.status === 404, '14) un plano inexistente o de otro grupo da 404');
  const r404b = await invocar(handler, { ...reqBase, grupoId: 'otro-grupo' });
  check(r404b.status === 404, '15) un plano de OTRO grupo no se puede copiar (404)');
  check(escrituras.length === 0, '16) copiar no escribe nada en la base (0 INSERT/UPDATE/DELETE)');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  process.exit(fallaron > 0 ? 1 : 0);
})();
