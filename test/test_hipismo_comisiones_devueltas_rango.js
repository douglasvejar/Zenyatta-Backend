// =================================================================
// PRUEBA: "Comisiones Devueltas por Cliente" con RANGO de fechas
// (01-10-2026, a pedido del usuario: "LA FECHA QUE VAS A MOSTRAR ARRIBA ES
// EL RANGO QUE YO ESCOJA" — después de pedir el formato "Destinatarios de
// Devolución" para copiar al WhatsApp, el usuario confirmó que quiere
// poder elegir un RANGO desde/hasta para este reporte, no solo un día
// puntual). Ver GET /comisiones-devueltas?desde=&hasta= y
// obtenerApuestasDelRango() en routes/hipismo.js.
//
// Casos cubiertos:
//   1. ?desde=&hasta= con 2 días distintos suma lo devuelto de AMBOS días
//      para el mismo cliente (antes solo se podía pedir un día a la vez).
//   2. El detalle expandido (hipodromos > carreras) trae `fecha` en cada
//      carrera, y las 2 carreras del mismo hipódromo+número en días
//      distintos NO se confunden entre sí (aparecen las 2, cada una con
//      su propia fecha y su propio monto/devuelto).
//   3. Retrocompatibilidad: sin ?desde=&hasta= (solo ?fecha=, como
//      siempre), el resultado es idéntico al de antes de este cambio —
//      mismo total, mismo `fecha` en la respuesta, y `desde === hasta ===
//      fecha`.
//   4. La respuesta siempre trae `desde`/`hasta` (nuevos campos), para que
//      el frontend pueda mostrar el rango real que el usuario eligió.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-devueltas-rango-1';
const FECHA_A = '2026-09-27';
const FECHA_B = '2026-09-28';

const JUGADOR_PEDRO = { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 2, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_PEDRO }],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-dia-a', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 3, fecha: FECHA_A },
    // A PROPÓSITO mismo hipódromo y mismo número de carrera que el de
    // arriba, pero en OTRO día -- para probar que no se confunden entre sí
    // cuando se piden los 2 días juntos.
    { id: 'p-dia-b', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 3, fecha: FECHA_B }
  ],
  hipismo_tickets: [
    // Día A: PEDRO apostó 100 y gana -> 2% de lo DECIDIDO = 2,00 devuelto.
    // resultado_jugador (02-10-2026, "SIN SACARLE EL 5%" -- ver
    // montoDecidido en services/hipismoAdelantadasCalc.js): 95, no 100 --
    // un "1P" ganado con 5% de comisión muestra/guarda monto*0.95, así que
    // lo decidido real (95/0.95=100) sigue siendo 100.
    { id: 't-dia-a', plano_id: 'p-dia-a', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(5)', monto: 100, resultado_jugador: 95, resultado_banquero: -100 },
    // Día B: PEDRO apostó 300 -> 2% = 6,00 devuelto.
    { id: 't-dia-b', plano_id: 'p-dia-b', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(2)', monto: 300, resultado_jugador: -300, resultado_banquero: 285 }
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

  // ---- obtenerApuestasDelRango: UN día (desde === hasta, mismo texto EXACTO de siempre) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha = \$2$/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.numero_ejemplar, a\.monto, r\.hipodromo_nombre, r\.carrera_numero, r\.numero_ganador, r\.hubo_ganador\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha = \$2 AND r\.modo <> 'manual'$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.banqueadores, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2$/i.test(sql)) {
    return { rows: [] };
  }

  // ---- obtenerApuestasDelRango: RANGO real (desde !== hasta, BETWEEN + trae `fecha`) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.numero_ejemplar, a\.monto, r\.hipodromo_nombre, r\.carrera_numero, r\.numero_ganador, r\.hubo_ganador, r\.fecha\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3 AND r\.modo <> 'manual'$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.banqueadores, p\.hipodromo_nombre, p\.fecha\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (comisiones-devueltas-rango) no sabe responder: ' + sql);
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
  const handlerComisionesDevueltas = handlerDe('get', '/comisiones-devueltas');
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };

  // ---- 1) y 2): ?desde=&hasta= con los 2 días ----
  const resRango = await invocarRuta(handlerComisionesDevueltas, { ...reqBase, query: { desde: FECHA_A, hasta: FECHA_B } });
  check(!!resRango, '1a) GET /comisiones-devueltas?desde=&hasta= respondió algo');
  check(resRango.desde === FECHA_A && resRango.hasta === FECHA_B, '1b) Trae desde/hasta tal cual se pidieron');
  check(resRango.fecha === FECHA_A, '1c) `fecha` (retrocompatibilidad) queda igual a `desde`');
  check(resRango.clientes.length === 1, '1d) Solo aparece PEDRO');
  const pedroRango = resRango.clientes[0];
  check(Math.abs(pedroRango.total - 8.00) < 0.001,
    `1e) PEDRO suma los 2 días: 2,00 (día A, 2% de 100) + 6,00 (día B, 2% de 300) = 8,00 -- dio ${pedroRango.total}`);
  check(Math.abs(resRango.totalGeneral - 8.00) < 0.001, '1f) totalGeneral también suma los 2 días: 8,00');

  // 2) El detalle expandido: mismo hipódromo+carrera en 2 días distintos no se confunden.
  check(pedroRango.hipodromos.length === 1, '2a) Un solo hipódromo (La Rinconada) agrupa los 2 días');
  const rinconadaRango = pedroRango.hipodromos[0];
  check(rinconadaRango.carreras.length === 2, '2b) Trae las 2 carreras por separado (una por día), no 1 sola mezclada');
  const carreraA = rinconadaRango.carreras.find(c => c.fecha === FECHA_A);
  const carreraB = rinconadaRango.carreras.find(c => c.fecha === FECHA_B);
  check(!!carreraA && carreraA.devuelto === 2, '2c) La carrera del día A trae su propia fecha y su propio devuelto (2,00)');
  check(!!carreraB && carreraB.devuelto === 6, '2d) La carrera del día B trae su propia fecha y su propio devuelto (6,00), sin mezclarse con la del día A');

  // ---- 3) y 4): retrocompatibilidad -- solo ?fecha= (sin desde/hasta) ----
  const resSoloFecha = await invocarRuta(handlerComisionesDevueltas, { ...reqBase, query: { fecha: FECHA_A } });
  check(resSoloFecha.fecha === FECHA_A && resSoloFecha.desde === FECHA_A && resSoloFecha.hasta === FECHA_A,
    '3a) Con solo ?fecha= (como siempre), desde === hasta === fecha');
  const pedroSoloFecha = resSoloFecha.clientes.find(c => c.nombre === 'PEDRO');
  check(!!pedroSoloFecha && pedroSoloFecha.total === 2,
    `3b) Retrocompatible: el mismo resultado de siempre para un solo día (2,00, sin el día B) -- dio ${pedroSoloFecha ? pedroSoloFecha.total : 'nada'}`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
