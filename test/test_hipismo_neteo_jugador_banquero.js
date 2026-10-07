// =================================================================
// PRUEBA: neteo jugador vs banquero por carrera, SOLO Tercios
// (02-10-2026, caso real reportado por el usuario con ejemplo de "GG"):
//
//   "gg juega y banquea y queda en 0 en esa carrera, alli no tienes que
//   pagarle comision de nada porque quedo en 0 ... supongamos que fuera
//   jugado 30 y banqueado 20, le tienes que sacar la devolucion a los 10
//   que queda que es lo que realmente quedaria en juego... como el todos
//   los clientes"
//
// Confirmado con el usuario (3 preguntas explícitas):
//   1. El neteo aplica SIEMPRE que un cliente juega Y banquea CUALQUIER
//      cosa en la misma carrera (no hace falta que sea la misma
//      modalidad/caballo de un lado y del otro).
//   2. Se netea por CARRERA puntual, nunca por todo el día.
//   3. SOLO aplica a Tercios — las Marcas de Jugadas Adelantadas (con sus
//      banqueadores propios) se quedan exactamente como están.
//
// Hasta esta ronda, el % devuelto de un cliente que jugaba Y banqueaba en
// la MISMA carrera se calculaba sumando el lado jugador y el lado
// banquero por separado (nunca netos) — el fix real:
// netearJugadorBanqueroTercios() en services/hipismoCalc.js, enchufado en
// obtenerApuestasDelRango (routes/hipismo.js), que alimenta
// /comisiones-devueltas y /comisiones-devueltas-por-hipodromo.
//
// Casos cubiertos:
//   1. GG en la carrera 7 de La Rinconada: jugó 30 (perdió completo) Y
//      banqueó 10 (ganó netos de 5%) -> neto = |30-10| = 20, nunca 40.
//   2. GG en la carrera 9 de La Rinconada (MISMO día, OTRA carrera): jugó
//      10 Y banqueó 30 -> neto = |10-30| = 20. Si el sistema netease por
//      DÍA en vez de por CARRERA, el neto total del día daría 0 (40 vs
//      40) en vez de 40 (20+20) -- este caso distingue ambos
//      comportamientos sin ambigüedad.
//   3. Clientes de un solo rol en esas carreras (MARLON1/MARLON2 solo
//      banquean, PEPE/LOLA solo juegan) no cambian en nada -- 0
//      regresión para el caso de siempre.
//   4. /comisiones-devueltas-por-hipodromo: el total de La Rinconada ya
//      viene neteado, y el desglose por código (ver feature anterior)
//      también refleja el neto, nunca el bruto.
//   5. Regresión: /montos-apostados sigue mostrando el monto BRUTO
//      apostado de GG (nunca el neto) -- el neteo es solo para % devuelto.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-neteo-1';
const FECHA = '2026-10-02';

const PCT = 1; // 1% de porcentaje propio para todos, para que las cuentas sean fáciles
function jugador(nombre) { return { id: 'j-' + nombre.toLowerCase(), grupo_id: GRUPO_ID, nombre, comision_propia: PCT, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }; }

const TABLAS = {
  jugadores: [jugador('GG'), jugador('MARLON1'), jugador('MARLON2'), jugador('PEPE'), jugador('LOLA')],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-carrera7', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 7, fecha: FECHA },
    { id: 'p-carrera9', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 9, fecha: FECHA }
  ],
  hipismo_tickets: [
    // --- Carrera 7: GG jugó 30 (perdió completo) y banqueó 10 (ganó, neto de 5%) -> neto 20 ---
    { id: 't-gg-juega-7', plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'MARLON1', modalidad: '2p', caballo: '7', monto: 30, resultado_jugador: -30, resultado_banquero: 30 * 0.95 },
    { id: 't-gg-banca-7', plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'PEPE', banquero_nombre: 'GG', modalidad: '1p', caballo: '3', monto: 10, resultado_jugador: -10, resultado_banquero: 10 * 0.95 },
    // --- Carrera 9 (MISMO día, otra carrera): GG jugó 10 y banqueó 30 -> neto 20 ---
    { id: 't-gg-juega-9', plano_id: 'p-carrera9', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'MARLON2', modalidad: '1p', caballo: '5', monto: 10, resultado_jugador: -10, resultado_banquero: 10 * 0.95 },
    { id: 't-gg-banca-9', plano_id: 'p-carrera9', grupo_id: GRUPO_ID, cliente_nombre: 'LOLA', banquero_nombre: 'GG', modalidad: '2p', caballo: '4', monto: 30, resultado_jugador: -30, resultado_banquero: 30 * 0.95 }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias (services/hipismoComisionPropia.js) ----
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  if (sql === 'SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])') {
    return { rows: [] };
  }

  // ---- obtenerApuestasDelDia (UN solo día, p.fecha = $2) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.numero_ejemplar, a\.monto, r\.hipodromo_nombre, r\.carrera_numero, r\.numero_ganador, r\.hubo_ganador\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.sin_comision, j\.banqueadores, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (neteo-jugador-banquero) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
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

Module._load = function (request, parent, isMain) {
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

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }

async function invocarRuta(handler, req) {
  let salida = null;
  await new Promise((resolve, reject) => {
    const res = { status(c) { this._s = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return salida;
}

(async function main() {
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };

  // ---- 1) GET /comisiones-devueltas?fecha= ----
  const salida = await invocarRuta(handlerDe('get', '/comisiones-devueltas'), { ...reqBase, query: { fecha: FECHA } });
  check(!!salida, '1a) GET /comisiones-devueltas respondió algo');
  const clientes = (salida && salida.clientes) || [];
  const filaGG = clientes.find(c => c.nombre === 'GG');
  const filaMarlon1 = clientes.find(c => c.nombre === 'MARLON1');
  const filaMarlon2 = clientes.find(c => c.nombre === 'MARLON2');
  const filaPepe = clientes.find(c => c.nombre === 'PEPE');
  const filaLola = clientes.find(c => c.nombre === 'LOLA');

  // GG: carrera 7 neto=20 (jugó 30, banqueó 10) + carrera 9 neto=20 (jugó
  // 10, banqueó 30) = 40 de base neta -> 1% = 0,40. NUNCA 0 (si neteara
  // por todo el día, 40 vs 40 = 0) ni 0,80 (si no neteara nunca, sumaría
  // 30+10+10+30=80 bruto).
  check(!!filaGG && Math.abs(filaGG.total - 0.40) < 0.001,
    `1b) ARREGLO: GG da 0,40 en /comisiones-devueltas (neto 20 en cada una de sus 2 carreras, nunca 0 por netear el día completo, ni 0,80 por no netear nada) -- dio ${filaGG ? filaGG.total : 'nada'}`);

  // MARLON1/MARLON2 (solo banquean, un solo rol cada uno en su carrera) y
  // PEPE/LOLA (solo juegan) -- 0 regresión, exactamente el monto de
  // siempre.
  check(!!filaMarlon1 && Math.abs(filaMarlon1.total - 0.30) < 0.001, `1c) MARLON1 (solo banqueó 30 en la carrera 7) da 0,30 -- dio ${filaMarlon1 ? filaMarlon1.total : 'nada'}`);
  check(!!filaMarlon2 && Math.abs(filaMarlon2.total - 0.10) < 0.001, `1d) MARLON2 (solo banqueó 10 en la carrera 9) da 0,10 -- dio ${filaMarlon2 ? filaMarlon2.total : 'nada'}`);
  check(!!filaPepe && Math.abs(filaPepe.total - 0.10) < 0.001, `1e) PEPE (solo jugó 10 en la carrera 7) da 0,10 -- dio ${filaPepe ? filaPepe.total : 'nada'}`);
  check(!!filaLola && Math.abs(filaLola.total - 0.30) < 0.001, `1f) LOLA (solo jugó 30 en la carrera 9) da 0,30 -- dio ${filaLola ? filaLola.total : 'nada'}`);

  const totalGeneralEsperado = 0.40 + 0.30 + 0.10 + 0.10 + 0.30; // 1,20
  check(Math.abs((salida && salida.totalGeneral) - totalGeneralEsperado) < 0.001,
    `1g) totalGeneral de /comisiones-devueltas = 1,20 -- dio ${salida && salida.totalGeneral}`);

  // El detalle expandido de GG debe traer sus 2 carreras (cada una ya
  // neteada), nunca 4 líneas sueltas sin netear.
  check(!!filaGG && Array.isArray(filaGG.hipodromos) && filaGG.hipodromos.length === 1 && filaGG.hipodromos[0].carreras.length === 2,
    `1h) El detalle de GG trae 1 hipódromo (La Rinconada) con 2 carreras (7 y 9), cada una ya neteada -- trajo ${filaGG ? JSON.stringify(filaGG.hipodromos.map(h => h.carreras.length)) : 'nada'}`);

  // ---- 2) GET /comisiones-devueltas-por-hipodromo?fecha= ----
  const salidaHip = await invocarRuta(handlerDe('get', '/comisiones-devueltas-por-hipodromo'), { ...reqBase, query: { fecha: FECHA } });
  check(!!salidaHip, '2a) GET /comisiones-devueltas-por-hipodromo respondió algo');
  const rinconada = (salidaHip && salidaHip.hipodromos || []).find(h => h.nombre === 'La Rinconada');
  check(!!rinconada && Math.abs(rinconada.totalDevuelto - totalGeneralEsperado) < 0.001,
    `2b) Subtotal de La Rinconada = 1,20 (ya neteado) -- dio ${rinconada ? rinconada.totalDevuelto : 'nada'}`);
  const carrera7 = rinconada && rinconada.carreras.find(c => c.carreraNumero === 7);
  const carrera9 = rinconada && rinconada.carreras.find(c => c.carreraNumero === 9);
  // Carrera 7: GG neto 0,20 + MARLON1 0,30 + PEPE 0,10 = 0,60
  check(!!carrera7 && Math.abs(carrera7.devuelto - 0.60) < 0.001, `2c) Carrera 7 da 0,60 (GG neto 0,20 + MARLON1 0,30 + PEPE 0,10) -- dio ${carrera7 ? carrera7.devuelto : 'nada'}`);
  // Carrera 9: GG neto 0,20 + MARLON2 0,10 + LOLA 0,30 = 0,60
  check(!!carrera9 && Math.abs(carrera9.devuelto - 0.60) < 0.001, `2d) Carrera 9 da 0,60 (GG neto 0,20 + MARLON2 0,10 + LOLA 0,30) -- dio ${carrera9 ? carrera9.devuelto : 'nada'}`);
  // El desglose por código de la carrera 7 también debe traer a GG con
  // 0,20 (neto), nunca con 0,30 (jugado) ni 0,10 (banqueado) sueltos.
  const codigoGGCarrera7 = carrera7 && carrera7.porCodigo.find(pc => pc.codigo === 'GG');
  check(!!codigoGGCarrera7 && Math.abs(codigoGGCarrera7.monto - 0.20) < 0.001,
    `2e) El desglose por código de la carrera 7 trae a GG con 0,20 (su neto), nunca con el bruto -- dio ${codigoGGCarrera7 ? codigoGGCarrera7.monto : 'nada'}`);

  // ---- 3) Regresión: /montos-apostados sigue mostrando el BRUTO ----
  const salidaMontos = await invocarRuta(handlerDe('get', '/montos-apostados'), { ...reqBase, query: { fecha: FECHA } });
  check(!!salidaMontos, '3a) GET /montos-apostados respondió algo');
  const ggMontos = (salidaMontos && salidaMontos.clientes || []).find(c => c.nombre === 'GG');
  check(!!ggMontos && Math.abs(ggMontos.total - 40) < 0.001,
    `3b) REGRESIÓN: GG en /montos-apostados sigue mostrando 40 (30+10, lo que JUGÓ en bruto, nunca lo que banqueó ni el neto) -- dio ${ggMontos ? ggMontos.total : 'nada'}`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
