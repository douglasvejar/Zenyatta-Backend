// =================================================================
// PRUEBA: GET /api/hipismo/clientes/WINNERS/detalle-semana (28-09-2026,
// a pedido del usuario: "winners al meterme en detallado por cliente...
// no se encontró ese cliente").
//
// Hasta esta ronda, el ítem sintético "WINNERS" (la contraparte exacta
// de "Cargar Winners" en Balance General/Cierre Final, ver la nota
// grande del ítem "WINNERS" en GET /cierre-final) NUNCA se especial-
// casaba en esta ruta como sí se hace con "REMATE" — así que al hacer
// click en su cuadro dentro de "Detallado por Cliente", la ruta
// buscaba "WINNERS" en la tabla "jugadores", nunca lo encontraba, y
// devolvía 404 ("No se encontró ese cliente"), aunque su saldo SÍ
// apareciera bien en Balance General/Cierre Final (que lo arman aparte).
//
// Casos cubiertos:
//   1. GET /clientes/WINNERS/detalle-semana responde 200 (nunca 404).
//   2. El detalle es el ESPEJO exacto de cada fila de hipismo_winners:
//      si LUSHO ganó +400, la línea de "WINNERS" da -400 (y viceversa).
//   3. El total de la semana ("resumen.totalSemana") es la suma de esos
//      espejos — coincide con lo que ya calcula GET /cierre-final para
//      el ítem "WINNERS" (ver test_hipismo_winners_contrapartida_balance.js).
//   4. Aislado por grupo_id: un Winner de otro grupo nunca se mezcla.
//   5. Soporta "Seleccionar rango de fecha" (?desde=&hasta=) igual que
//      ya soporta el resumen de un cliente normal.
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-winners-detalle-1';
const OTRO_GRUPO_ID = 'grupo-winners-detalle-2';
const FECHA = '2026-09-24';

const TABLAS = {
  hipismo_winners: [
    { grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 5, fecha: FECHA, cliente_nombre: 'LUSHO', caballo: '7', monto: 400 },
    { grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 6, fecha: FECHA, cliente_nombre: 'CARLA', caballo: '3', monto: -120 },
    // De otro grupo -- nunca debe mezclarse.
    { grupo_id: OTRO_GRUPO_ID, hipodromo_nombre: 'Valencia', carrera_numero: 1, fecha: FECHA, cliente_nombre: 'AJENO', caballo: '1', monto: 999 }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (sql === 'SELECT hipodromo_nombre, carrera_numero, fecha, cliente_nombre, caballo, monto FROM hipismo_winners WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 ORDER BY fecha DESC, creado_en ASC') {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_winners.filter(w => w.grupo_id === grupoId && w.fecha >= desde && w.fecha <= hasta);
    return { rows: filas.map(w => ({ ...w })) };
  }

  throw new Error('La base de datos falsa de esta prueba (winners detalle-semana) no sabe responder: ' + sql);
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
  return { grupoId, grupo: { nombre: 'Zenyatta', logo_url: null, modulo_deportes_habilitado: true }, params: { nombre: 'WINNERS' }, query: query || {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const res = await invocarRuta(handlerDetalle, reqBase(GRUPO_ID, { desde: FECHA, hasta: FECHA }));
  check(res._status === 200, '1) GET /clientes/WINNERS/detalle-semana responde 200 (nunca 404)');
  check(res._json.jugador.nombre === 'WINNERS', '2) Trae jugador.nombre = "WINNERS"');
  check(res._json.rangoPersonalizado === true, '3) Con ?desde=&hasta=, rangoPersonalizado da true (mismo soporte que un cliente normal)');

  // 2 filas de Winners (LUSHO +400, CARLA -120) -> el espejo de WINNERS
  // da -400 y +120 -> total -280,00. Mismo signo EXACTO que ya calcula
  // /cierre-final para este ítem (ver test_hipismo_winners_contrapartida_balance.js).
  check(res._json.resumen.totalSemana === -280, `4) totalSemana = -(400) + -(-120) = -400+120 = -280,00, dio ${res._json.resumen.totalSemana}`);
  check(res._json.resumen.cantidadJugadas === 2, '5) Cuenta las 2 filas de Winners de este grupo (nunca la del otro grupo)');

  const dia = res._json.dias.find(d => d.fecha === FECHA);
  check(!!dia, '6) El día de los Winners aparece agrupado');
  const hip = dia && dia.hipodromos.find(h => h.nombre === 'La Rinconada');
  check(!!hip, '7) Agrupado bajo el hipódromo correcto');
  const lineaLusho = hip && hip.carreras.find(c => c.clienteNombre === 'LUSHO');
  const lineaCarla = hip && hip.carreras.find(c => c.clienteNombre === 'CARLA');
  check(!!lineaLusho && lineaLusho.resultado === -400, `8) La línea de LUSHO (ganó +400) da -400 en WINNERS, dio ${lineaLusho && lineaLusho.resultado}`);
  check(!!lineaLusho && lineaLusho.tipo === 'winner_contraparte', '9) tipo="winner_contraparte" (para que el frontend lo reconozca)');
  check(!!lineaCarla && lineaCarla.resultado === 120, `10) La línea de CARLA (perdió -120) da +120 en WINNERS, dio ${lineaCarla && lineaCarla.resultado}`);

  const resOtro = await invocarRuta(handlerDetalle, reqBase(OTRO_GRUPO_ID, { desde: FECHA, hasta: FECHA }));
  check(resOtro._json.resumen.cantidadJugadas === 1, '11) El otro grupo ve SOLO su propio Winner, aislado del primero');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de detalle-semana de WINNERS se cayó con una excepción:', e);
  process.exit(1);
});
