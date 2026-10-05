// =================================================================
// PRUEBA: "🧮 Grupo sin Devoluciones" (01-10-2026, segunda ronda) — a
// pedido del usuario: "crea en comisiones un boton que diga , grupo sin
// devoluciones.... aqui me mostraras como seria la comision y como
// quedarian los tercios jugando solo con el 5% sin devolverle nada a
// nadie ... si gana gan -5% juegue o banque... si pierde pierde completo
// juegue o banquee". Ver GET /comisiones-sin-devoluciones en
// routes/hipismo.js.
//
// Casos cubiertos:
//   1. Sin ?desde=&hasta=, usa la semana actual (rangoSemana(hoy, 0)) por
//      default, y marca rangoPersonalizado=false.
//   2. Con ?desde=&hasta= personalizado, usa ESE rango (no la semana
//      actual), y marca rangoPersonalizado=true.
//   3. El saldo de cada cliente es el resultado YA guardado en el ticket
//      (resultado_jugador/resultado_banquero) tal cual — SIN restar
//      ninguna devolución de % propio (aunque el cliente tenga
//      comision_propia configurado, acá NO se consulta
//      obtenerComisionesPropias ni se le resta nada).
//   4. La comisión del grupo es la BRUTA (comision_total de cada plano),
//      sin descontar devoluciones.
//   5. Un rango sin ningún plano devuelve clientes=[] y comisionGrupo=0,
//      sin explotar.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-sin-devoluciones-1';
const FECHA_A = '2026-09-28'; // lunes
const FECHA_B = '2026-09-29'; // martes, misma semana que A
const FECHA_FUERA_RANGO = '2026-08-01'; // una semana sin ningún plano

// JUAN tiene 5% de comisión propia configurada -- a propósito, para
// comprobar que esta pantalla NO la usa ni la resta de su saldo.
const JUGADOR_JUAN = { id: 'j-juan', grupo_id: GRUPO_ID, nombre: 'JUAN', comision_propia: 5, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_JUAN }],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-dia-a', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 3, fecha: FECHA_A, comision_total: 10 },
    { id: 'p-dia-b', grupo_id: GRUPO_ID, hipodromo_nombre: 'Valencia', carrera_numero: 5, fecha: FECHA_B, comision_total: 15 }
  ],
  hipismo_tickets: [
    // Día A: JUAN jugó 200, ganó -- resultado_jugador ya guardado como
    // 190 (200 - 5% de comisión propia), LUIS banqueó y perdió -200.
    { id: 't-dia-a', plano_id: 'p-dia-a', grupo_id: GRUPO_ID, cliente_nombre: 'JUAN', banquero_nombre: 'LUIS', monto: 200, resultado_jugador: 190, resultado_banquero: -200 },
    // Día B: PEDRO jugó 100, perdió completo -- MARIA banqueó y ganó +95.
    { id: 't-dia-b', plano_id: 'p-dia-b', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'MARIA', monto: 100, resultado_jugador: -100, resultado_banquero: 95 }
  ]
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  if (sql === 'SELECT id, comision_total FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3') {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId && p.fecha >= desde && p.fecha <= hasta);
    return { rows: filas.map(p => ({ id: p.id, comision_total: p.comision_total })) };
  }

  if (sql === 'SELECT cliente_nombre, banquero_nombre, resultado_jugador, resultado_banquero FROM hipismo_tickets WHERE plano_id = ANY($1::uuid[])') {
    const [planoIds] = params;
    const filas = TABLAS.hipismo_tickets.filter(t => planoIds.includes(t.plano_id));
    return { rows: filas.map(t => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero })) };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (comisiones-sin-devoluciones) no sabe responder: ' + sql);
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

// Mismo cálculo de "semana actual" que usa el backend (rangoSemana +
// hoyVenezuela), calculado acá aparte con las mismas reglas para poder
// comparar sin tener que mockear Date.
function isoDeFechaUTC(d) { return d.toISOString().slice(0, 10); }
function rangoSemanaEsperado(fecha, offsetSemanas) {
  const diaSemana = fecha.getUTCDay();
  const diffHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(fecha);
  lunes.setUTCDate(lunes.getUTCDate() + diffHastaLunes + offsetSemanas * 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  return { desde: isoDeFechaUTC(lunes), hasta: isoDeFechaUTC(domingo) };
}

(async function main() {
  const handler = handlerDe('get', '/comisiones-sin-devoluciones');
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };

  // ---- 1) Sin desde/hasta: usa la semana actual ----
  const hoy = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const semanaEsperada = rangoSemanaEsperado(hoy, 0);
  const resDefault = await invocarRuta(handler, { ...reqBase, query: {} });
  check(!!resDefault, '1a) GET /comisiones-sin-devoluciones (sin query) respondió algo');
  check(resDefault.desde === semanaEsperada.desde && resDefault.hasta === semanaEsperada.hasta,
    `1b) Sin desde/hasta, usa la semana actual (${semanaEsperada.desde} a ${semanaEsperada.hasta}) -- dio ${resDefault.desde} a ${resDefault.hasta}`);
  check(resDefault.rangoPersonalizado === false, '1c) rangoPersonalizado=false cuando se usa la semana actual por default');

  // ---- 2) Con desde/hasta personalizado (el rango real de las 2 fechas de prueba) ----
  const resRango = await invocarRuta(handler, { ...reqBase, query: { desde: FECHA_A, hasta: FECHA_B } });
  check(resRango.desde === FECHA_A && resRango.hasta === FECHA_B, '2a) Con desde/hasta, usa ESE rango (no la semana actual)');
  check(resRango.rangoPersonalizado === true, '2b) rangoPersonalizado=true cuando se pide un rango a mano');

  // ---- 3) Saldos SIN restar devoluciones, aunque JUAN tenga 5% propio configurado ----
  check(resRango.clientes.length === 4, `3a) Aparecen los 4 nombres (JUAN, LUIS, PEDRO, MARIA) -- dio ${resRango.clientes.length}`);
  const juan = resRango.clientes.find(c => c.nombre === 'JUAN');
  const luis = resRango.clientes.find(c => c.nombre === 'LUIS');
  const pedro = resRango.clientes.find(c => c.nombre === 'PEDRO');
  const maria = resRango.clientes.find(c => c.nombre === 'MARIA');
  check(!!juan && juan.saldo === 190, `3b) JUAN queda con su resultado_jugador YA guardado (190), sin tocar su 5% propio -- dio ${juan && juan.saldo}`);
  check(!!luis && luis.saldo === -200, `3c) LUIS (banqueó y perdió) queda en -200 -- dio ${luis && luis.saldo}`);
  check(!!pedro && pedro.saldo === -100, `3d) PEDRO (jugó y perdió completo) queda en -100 -- dio ${pedro && pedro.saldo}`);
  check(!!maria && maria.saldo === 95, `3e) MARIA (banqueó y ganó) queda en +95 -- dio ${maria && maria.saldo}`);

  // ---- 4) Comisión del grupo: BRUTA (suma de comision_total de los 2 planos) ----
  check(resRango.comisionGrupo === 25, `4a) comisionGrupo = 10 (día A) + 15 (día B) = 25, sin descontar nada -- dio ${resRango.comisionGrupo}`);

  // ---- 5) Rango sin ningún plano ----
  const resVacio = await invocarRuta(handler, { ...reqBase, query: { desde: FECHA_FUERA_RANGO, hasta: FECHA_FUERA_RANGO } });
  check(Array.isArray(resVacio.clientes) && resVacio.clientes.length === 0, '5a) Un rango sin planos devuelve clientes=[]');
  check(resVacio.comisionGrupo === 0, '5b) Un rango sin planos devuelve comisionGrupo=0');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
