// =================================================================
// PRUEBA: doble redondeo al sacar el % devuelto (02-10-2026, el usuario
// comparó una carrera real -- 5ta de Belmont Park -- contra "otro
// programa" y encontró $0.01 de diferencia en 2 de 6 códigos ("Agregados
// ferrocarril" 0,76 vs 0,75; "Purga" 0,76 vs 0,75), que en la semana le
// sumaban $10-20. Causa real encontrada: montoDecidido() SIEMPRE
// redondeaba a centavos (round2(r/0.95) para una jugada ganada), y todo
// reporte de % devuelto volvía a multiplicar ese valor YA redondeado por
// el % propio/de aval y a redondear OTRA VEZ -- doble redondeo en cadena.
// Ver la nota grande EXACTA de montoDecididoExacto en
// services/hipismoAdelantadasCalc.js.
//
// Esta prueba fija un caso real y chico donde el doble redondeo SÍ se
// nota (no todos los montos lo disparan, por eso el usuario veía solo 2
// códigos de 6 afectados): WINNY ganó una jugada de Tercios con
// resultado_jugador = 0,71 (neto de comisión) y tiene 2% de % propio.
//   - decidido exacto = 0,71 / 0,95 = 0,7473684...
//   - % devuelto CORRECTO (un solo redondeo) = round2(0,7473684 * 0,02)
//     = 0,01
//   - % devuelto con el BUG (doble redondeo) = round2(round2(0,7473684)
//     * 0,02) = round2(0,75 * 0,02) = round2(0,015) = 0,02 -- el doble
//     de lo que corresponde.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// ---- 0) Unidad pura: la aritmética en sí, sin tocar ninguna ruta ----
const { round2, montoDecidido, montoDecididoExacto } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoAdelantadasCalc'));
{
  const R = 0.71, PCT = 2;
  const exacto = montoDecididoExacto(R, false);
  const baseRedondeada = montoDecidido(R, false);
  const correcto = round2(exacto * (PCT / 100));
  const conBugDeAntes = round2(baseRedondeada * (PCT / 100));
  check(Math.abs(exacto - 0.7473684210526316) < 1e-9, `0a) montoDecididoExacto(0,71) = 0,71/0,95 exacto, sin redondear -- dio ${exacto}`);
  check(baseRedondeada === 0.75, `0b) montoDecidido(0,71) sigue redondeando a 0,75 para mostrar (no cambia, es el uso correcto de esa función) -- dio ${baseRedondeada}`);
  check(correcto === 0.01, `0c) ARREGLO: % devuelto correcto (un solo redondeo, sobre el exacto) = 0,01 -- dio ${correcto}`);
  check(conBugDeAntes === 0.02, `0d) confirma el bug de antes: redondear el decidido Y OTRA VEZ el % daba 0,02 (el doble) -- dio ${conBugDeAntes}`);
}

const GRUPO_ID = 'g-doble-redondeo-1';
const FECHA = '2026-10-02';

const TABLAS = {
  jugadores: [
    { id: 'j-winny', grupo_id: GRUPO_ID, nombre: 'WINNY', comision_propia: 2, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null }
  ],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-carrera5', grupo_id: GRUPO_ID, hipodromo_nombre: 'Belmont Park', carrera_numero: 5, fecha: FECHA }
  ],
  // WINNY ganó esta línea (resultado_jugador > 0, neto de 5%) -- CASA1 (su
  // banquero) no tiene % propio configurado, así que no aparece en ningún
  // reporte de % devuelto y no estorba la cuenta.
  hipismo_tickets: [
    { id: 't-winny', plano_id: 'p-carrera5', grupo_id: GRUPO_ID, cliente_nombre: 'WINNY', banquero_nombre: 'CASA1', modalidad: '2p', caballo: '4', monto: 15, resultado_jugador: 0.71, resultado_banquero: -0.71 }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  if (sql === 'SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])') {
    return { rows: [] };
  }
  // obtenerComisionesPropias, variante "faltantes" (nombres que no venían
  // ya en jugadores, ej. CASA1, que no tiene fila en TABLAS.jugadores) --
  // trae TODOS los jugadores del grupo para reintentar el emparejamiento.
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1') {
    const [grupoId] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
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
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.banqueadores, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (doble-redondeo) no sabe responder: ' + sql);
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
  const filaWinny = (salida && salida.clientes || []).find(c => c.nombre === 'WINNY');
  check(!!filaWinny && Math.abs(filaWinny.total - 0.01) < 0.0001,
    `1a) ARREGLO: /comisiones-devueltas da 0,01 para WINNY (un solo redondeo sobre el decidido exacto), NUNCA 0,02 (el doble redondeo de antes) -- dio ${filaWinny ? filaWinny.total : 'nada'}`);

  // ---- 2) GET /comisiones-devueltas-por-hipodromo?fecha= (el reporte del screenshot) ----
  const salidaHip = await invocarRuta(handlerDe('get', '/comisiones-devueltas-por-hipodromo'), { ...reqBase, query: { fecha: FECHA } });
  const belmont = (salidaHip && salidaHip.hipodromos || []).find(h => h.nombre === 'Belmont Park');
  check(!!belmont && Math.abs(belmont.totalDevuelto - 0.01) < 0.0001,
    `2a) ARREGLO: subtotal de Belmont Park = 0,01, NUNCA 0,02 -- dio ${belmont ? belmont.totalDevuelto : 'nada'}`);
  const carrera5 = belmont && belmont.carreras.find(c => c.carreraNumero === 5);
  check(!!carrera5 && Math.abs(carrera5.devuelto - 0.01) < 0.0001,
    `2b) ARREGLO: la carrera 5 muestra 0,01, NUNCA 0,02 -- dio ${carrera5 ? carrera5.devuelto : 'nada'}`);
  const codigoWinny = carrera5 && carrera5.porCodigo.find(pc => pc.codigo === 'WINNY');
  check(!!codigoWinny && Math.abs(codigoWinny.monto - 0.01) < 0.0001,
    `2c) ARREGLO: el desglose por código trae a WINNY con 0,01, NUNCA 0,02 -- dio ${codigoWinny ? codigoWinny.monto : 'nada'}`);
  check(Math.abs((salidaHip && salidaHip.totalGeneral) - 0.01) < 0.0001,
    `2d) totalGeneral también da 0,01 -- dio ${salidaHip && salidaHip.totalGeneral}`);
  // El código suma EXACTO el total de la carrera, y la carrera suma EXACTO
  // el total del hipódromo (la regla de siempre, "a pedido del usuario:
  // que de ese total en la carrera") -- con 1 solo código/carrera/hipódromo
  // acá, coincide trivialmente, pero confirma que no quedó nada descuadrado.
  check(carrera5.porCodigo.reduce((s, c) => s + c.monto, 0) === carrera5.devuelto,
    '2e) el desglose por código sigue sumando EXACTO el total mostrado de la carrera');
  check(belmont.carreras.reduce((s, c) => s + c.devuelto, 0) === belmont.totalDevuelto,
    '2f) las carreras siguen sumando EXACTO el total mostrado del hipódromo');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
