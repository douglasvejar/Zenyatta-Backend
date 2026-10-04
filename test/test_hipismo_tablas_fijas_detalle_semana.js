// =================================================================
// PRUEBA: GET /api/hipismo/clientes/TABLAS%20FIJAS/detalle-semana
// (04-10-2026, a pedido del usuario: "y como hago para ver el detallado
// por carrera de esos codigos?", tras reportar con captura que "Tablas
// fijas" en Detallado por Cliente daba "No se encontró ese cliente").
//
// Mismo bug EXACTO que ya tuvo "WINNERS" el 28-09-2026 (ver
// test_hipismo_winners_detalle_semana.js): el ítem sintético "TABLAS
// FIJAS" (el espejo de la banca en Tabla Fija, ver acumular('TABLAS
// FIJAS', ...) en construirCierreFinalHipismo) nunca se especial-casaba
// en esta ruta como sí se hacía con "REMATE"/"WINNERS" — así que al
// hacer click en su cuadro dentro de "Detallado por Cliente", la ruta
// buscaba "TABLAS FIJAS" en la tabla "jugadores", nunca lo encontraba, y
// devolvía 404, aunque su saldo SÍ apareciera bien en Balance General/
// Cierre Final (que lo arman aparte).
//
// Casos cubiertos:
//   1. GET /clientes/TABLAS FIJAS/detalle-semana responde 200 (nunca 404).
//   2. El detalle es el ESPEJO neto de cada jugada tf: -(resultado_cliente
//      + comisión) — mismo invariante EXACTO que ya usa Cierre Final
//      (cliente + TABLAS FIJAS + comisión = 0 exacto).
//   3. Una jugada 'sin_decidir' (resultado_cliente=0, comisión=0) no
//      aporta ninguna línea (se salta sola, igual que REMATE/WINNERS).
//   4. Una Marca (tipo='marca') NUNCA se mezcla acá -- esta ruta es
//      EXCLUSIVA de tipo='tf'.
//   5. Aislado por grupo_id.
//   6. Soporta "Seleccionar rango de fecha" (?desde=&hasta=) igual que un
//      cliente normal.
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-tf-detalle-1';
const OTRO_GRUPO_ID = 'grupo-tf-detalle-2';
const FECHA = '2026-09-24';

const TABLAS = {
  hipismo_adelantadas_planos: [
    { id: 'plano-tf-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', fecha: FECHA, hipodromo_id: 'hip-1' },
    { id: 'plano-tf-2', grupo_id: OTRO_GRUPO_ID, hipodromo_nombre: 'Valencia', fecha: FECHA, hipodromo_id: 'hip-2' }
  ],
  hipismo_adelantadas_jugadas: [
    // Gana el cliente -> la banca (TABLAS FIJAS) pierde 190 + 10 de
    // comisión = -200.
    { grupo_id: GRUPO_ID, plano_id: 'plano-tf-1', tipo: 'tf', estado: 'resuelto', cliente_nombre: 'SOYGANADOR', carrera_numero: 5, numero_ejemplar: '9', monto: 200, resultado_cliente: 190, comision: 10, gano: true },
    // Pierde el cliente -> la banca gana el monto completo, sin comisión.
    { grupo_id: GRUPO_ID, plano_id: 'plano-tf-1', tipo: 'tf', estado: 'resuelto', cliente_nombre: 'PERDEDOR', carrera_numero: 6, numero_ejemplar: '3', monto: 50, resultado_cliente: -50, comision: 0, gano: false },
    // 'sin_decidir' (pizarra de menos de 5 puestos) -> 0 para todos, no
    // debe aportar ninguna línea.
    { grupo_id: GRUPO_ID, plano_id: 'plano-tf-1', tipo: 'tf', estado: 'sin_decidir', cliente_nombre: 'INDECISO', carrera_numero: 7, numero_ejemplar: '1', monto: 80, resultado_cliente: 0, comision: 0, gano: null },
    // Una Marca (tipo='marca') en el MISMO plano -- nunca debe mezclarse
    // acá, esta ruta es solo tf.
    { grupo_id: GRUPO_ID, plano_id: 'plano-tf-1', tipo: 'marca', estado: 'falta_banqueo', cliente_nombre: 'HALLAND', carrera_numero: 8, numero1: 8, numero2: 4, monto: 120, resultado_cliente: -120, comision: null, gano: false },
    // De otro grupo -- nunca debe mezclarse.
    { grupo_id: OTRO_GRUPO_ID, plano_id: 'plano-tf-2', tipo: 'tf', estado: 'resuelto', cliente_nombre: 'AJENO', carrera_numero: 1, numero_ejemplar: '5', monto: 999, resultado_cliente: 900, comision: 50, gano: true }
  ],
  hipismo_hipodromos: [
    { id: 'hip-1', pais: 'VE' },
    { id: 'hip-2', pais: 'VE' }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (/^SELECT j\.cliente_nombre, j\.carrera_numero, j\.numero_ejemplar, j\.monto, j\.resultado_cliente,/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && j.tipo === 'tf' && ['resuelto', 'sin_decidir'].includes(j.estado))
      .map(j => ({ j, p: TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta);
    return {
      rows: filas.map(({ j, p }) => {
        const hip = TABLAS.hipismo_hipodromos.find(h => h.id === p.hipodromo_id);
        return {
          cliente_nombre: j.cliente_nombre, carrera_numero: j.carrera_numero, numero_ejemplar: j.numero_ejemplar,
          monto: j.monto, resultado_cliente: j.resultado_cliente, comision: j.comision, gano: j.gano,
          pizarra_usada: '1 2 3 4 5', fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, pais: hip ? hip.pais : null
        };
      })
    };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de
  // este archivo crea jugadas de esta pestaña nueva.
  if (/^SELECT j\.\* FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (tablas fijas detalle-semana) no sabe responder: ' + sql);
}

function fakePool() {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
}
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
const handlerDetalle = handlerDe('get', '/clientes/:nombre/detalle-semana');

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
function reqBase(grupoId, query) {
  return { grupoId, grupo: { nombre: 'Zenyatta', logo_url: null, modulo_deportes_habilitado: true }, params: { nombre: 'TABLAS FIJAS' }, query: query || {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const res = await invocarRuta(handlerDetalle, reqBase(GRUPO_ID, { desde: FECHA, hasta: FECHA }));
  check(res._status === 200, '1) GET /clientes/TABLAS FIJAS/detalle-semana responde 200 (nunca 404)');
  check(res._json.jugador.nombre === 'TABLAS FIJAS', '2) Trae jugador.nombre = "TABLAS FIJAS"');
  check(res._json.rangoPersonalizado === true, '3) Con ?desde=&hasta=, rangoPersonalizado da true (mismo soporte que un cliente normal)');

  // SOYGANADOR ganó (resultado_cliente 190, comisión 10) -> TABLAS FIJAS
  // da -(190+10) = -200. PERDEDOR perdió (resultado_cliente -50, sin
  // comisión) -> TABLAS FIJAS da -(-50+0) = +50. INDECISO (sin_decidir)
  // no aporta nada. Total: -200 + 50 = -150.
  check(res._json.resumen.totalSemana === -150, `4) totalSemana = -200 + 50 = -150, dio ${res._json.resumen.totalSemana}`);
  check(res._json.resumen.cantidadJugadas === 2, '5) Cuenta solo las 2 jugadas tf con efecto (la sin_decidir y la Marca no cuentan)');

  const dia = res._json.dias.find(d => d.fecha === FECHA);
  check(!!dia, '6) El día de las jugadas tf aparece agrupado');
  const hip = dia && dia.hipodromos.find(h => h.nombre === 'La Rinconada');
  check(!!hip, '7) Agrupado bajo el hipódromo correcto');
  check(hip && hip.carreras.length === 2, '8) Solo 2 carreras (la sin_decidir y la Marca quedan afuera)');

  const lineaGanador = hip && hip.carreras.find(c => c.clienteNombre === 'SOYGANADOR');
  const lineaPerdedor = hip && hip.carreras.find(c => c.clienteNombre === 'PERDEDOR');
  check(!!lineaGanador && lineaGanador.resultado === -200, `9) La línea de SOYGANADOR (ganó, 190+10 comisión) da -200 en TABLAS FIJAS, dio ${lineaGanador && lineaGanador.resultado}`);
  check(!!lineaGanador && lineaGanador.tipo === 'tf_resultado' && lineaGanador.ganoCliente === true, '10) tipo="tf_resultado" y ganoCliente=true (para que el frontend diga "ganó con")');
  check(!!lineaPerdedor && lineaPerdedor.resultado === 50, `11) La línea de PERDEDOR (perdió -50) da +50 en TABLAS FIJAS, dio ${lineaPerdedor && lineaPerdedor.resultado}`);
  check(!!lineaPerdedor && lineaPerdedor.ganoCliente === false, '12) ganoCliente=false para PERDEDOR (para que el frontend diga "perdió con")');

  const resOtro = await invocarRuta(handlerDetalle, reqBase(OTRO_GRUPO_ID, { desde: FECHA, hasta: FECHA }));
  check(resOtro._json.resumen.cantidadJugadas === 1, '13) El otro grupo ve SOLO su propia jugada tf, aislada de la primera');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de detalle-semana de TABLAS FIJAS se cayó con una excepción:', e);
  process.exit(1);
});
