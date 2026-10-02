// =================================================================
// PRUEBA: "Comisiones Devueltas por Hipódromo" y "Saldo Comisiones"
// (24-09-2026, vigesimocuarta ronda, a pedido del usuario):
//   - "la venta comisiones devueltas metela en la pestaña comisiones...
//     colocale como nombre comisiones devuelta por hipodromo, alli debo
//     ver ordenado por hipodromo por carrera, cuanto se a devuelto de
//     comision" — ver GET /comisiones-devueltas-por-hipodromo en
//     routes/hipismo.js.
//   - "saldo comisiones si esta sacando el % que se le devuelve a cada
//     cliente" — hasta esta ronda esa pantalla mostraba datos de ejemplo
//     fijos; ahora es real. Ver GET /saldo-comisiones.
//
// Mismo patrón de base de datos falsa en memoria y mismo truco de pisar
// Date.now() que test_hipismo_semana_por_dias.js (semana lunes 21 a
// domingo 27 de septiembre de 2026).
//
// Casos cubiertos:
//   1. GET /comisiones-devueltas-por-hipodromo?fecha=: agrupa por
//      hipódromo > carrera, SUMANDO entre todos los clientes con % propio
//      configurado (un cliente sin % configurado no aporta nada), con
//      subtotal por hipódromo y total general — un plano de otro grupo o
//      de otra fecha no se cuela.
//   2. Un día sin ninguna devolución: responde hipodromos: [] y
//      totalGeneral: 0 (no un error).
//   3. GET /comisiones-devueltas?fecha= ya trae totalGeneral (nuevo campo
//      de esta ronda, suma de los totales de todos los clientes).
//   4. GET /saldo-comisiones?semana=actual|anterior|hace2: mismo % propio
//      por cliente, sumado para TODA la semana (Tercios + Remate,
//      cualquier jugada como JUGADOR) — un cliente sin % configurado no
//      aparece.
//   5. Sin ?semana=, usa 'actual' por defecto sin explotar.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-devueltas-hip-1';
const OTRO_GRUPO_ID = 'grupo-devueltas-hip-2';
const FECHA = '2026-09-24'; // jueves, semana lunes 21 a domingo 27 de sept de 2026
// Fuera de esa semana a propósito (no solo de FECHA) — así también sirve
// para probar que /saldo-comisiones, que agrupa por SEMANA, no se la
// cuela (si cayera dentro de la misma semana igual habría que sumarla).
const OTRA_FECHA = '2026-09-14';

const TABLAS = {
  jugadores: [
    { id: 'jug-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 1, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' },
    { id: 'jug-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', comision_propia: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' },
    // LEGOLAS (02-10-2026, caso real del usuario): 1% propio con el
    // toggle "incluir_porcentaje_en_jugadas" en ON -- antes de este
    // cambio, estos 3 reportes de auditoría lo excluían por completo
    // (ver la nota grande en hipismoComisionPropia.js); ahora debe
    // aparecer igual que PEDRO, con su propio % como línea aparte.
    { id: 'jug-legolas', grupo_id: GRUPO_ID, nombre: 'LEGOLAS', comision_propia: 1, incluir_porcentaje_en_jugadas: true, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' }
  ],
  hipismo_planos: [
    { id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA },
    { id: 'plano-2', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 2, fecha: FECHA },
    { id: 'plano-3', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 3, fecha: FECHA },
    { id: 'plano-otro-grupo', grupo_id: OTRO_GRUPO_ID, hipodromo_nombre: 'Assiniboia', carrera_numero: 1, fecha: FECHA },
    { id: 'plano-otra-fecha', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 9, fecha: OTRA_FECHA }
  ],
  hipismo_tickets: [
    // Carrera 1: PEDRO apostó 100 y gana -> 1% de lo DECIDIDO = 1.00
    // devuelto. resultado_jugador (02-10-2026, "SIN SACARLE EL 5%" -- ver
    // montoDecidido en services/hipismoAdelantadasCalc.js): 95, no 100 --
    // un "1P" ganado con 5% de comisión muestra/guarda monto*0.95, así que
    // lo decidido real (95/0.95=100) sigue siendo 100.
    { id: 'ticket-1', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(5)', monto: 100, resultado_jugador: 95 },
    // Carrera 2: PEDRO apostó 200 y gana -> 2.00 devuelto (mismo criterio
    // que arriba: resultado_jugador=190, decidido=200); MARIA apostó 50
    // pero no tiene % configurado -> no aporta nada al reporte.
    { id: 'ticket-2', plano_id: 'plano-2', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '2P', caballo: '(3)', monto: 200, resultado_jugador: 190 },
    { id: 'ticket-3', plano_id: 'plano-2', grupo_id: GRUPO_ID, cliente_nombre: 'MARIA', modalidad: '1P', caballo: '(7)', monto: 50, resultado_jugador: 47.5 },
    // Carrera 3: LEGOLAS (toggle ON) apostó 100 y pierde -> 1% de lo
    // decidido (100, ya que perdió) = 1.00 devuelto -- debe aparecer en
    // los 3 reportes de este archivo a pesar del toggle.
    { id: 'ticket-legolas', plano_id: 'plano-3', grupo_id: GRUPO_ID, cliente_nombre: 'LEGOLAS', modalidad: '1P', caballo: '(9)', monto: 100, resultado_jugador: -100 },
    // Otro grupo -- NUNCA debe aparecer.
    { id: 'ticket-otro-grupo', plano_id: 'plano-otro-grupo', grupo_id: OTRO_GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(1)', monto: 999 },
    // Otra fecha -- no debe aparecer al pedir FECHA.
    { id: 'ticket-otra-fecha', plano_id: 'plano-otra-fecha', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', modalidad: '1P', caballo: '(1)', monto: 500 }
  ],
  hipismo_remates: [
    { id: 'remate-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'Churchill Downs', carrera_numero: 5, fecha: FECHA }
  ],
  hipismo_remate_apuestas: [
    // Churchill Downs, carrera 5: PEDRO apostó 100 -> 1.00 devuelto.
    { id: 'ra-1', grupo_id: GRUPO_ID, remate_id: 'remate-1', cliente_nombre: 'PEDRO', caballo: '(2)', monto: 100 }
  ],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerApuestasDelDia (usada por /comisiones-devueltas-por-hipodromo) ----
  // 29-09-2026: la consulta ahora también trae resultado_jugador/
  // resultado_banquero (para el filtro "no se decidió" -- ver la nota
  // grande de obtenerApuestasDelDia en routes/hipismo.js); ningún ticket de
  // esta prueba las necesita (todas sus jugadas están decididas), así que
  // simplemente se pasan tal cual vengan (undefined acá, que da
  // `decidida: true` igual que antes de este fix).
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
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId)
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rm => rm.id === a.remate_id) }))
      .filter(({ r }) => r && r.fecha === fecha)
      .map(({ a, r }) => ({ id: a.id, cliente_nombre: a.cliente_nombre, caballo: a.caballo, numero_ejemplar: a.numero_ejemplar, monto: a.monto, hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero, numero_ganador: r.numero_ganador, hubo_ganador: r.hubo_ganador }));
    return { rows: filas };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, j\.banqueadores, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }

  // ---- consultas de /saldo-comisiones (semana, BETWEEN) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.monto(, t\.resultado_jugador, t\.resultado_banquero)?(, t\.sin_comision)?\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId)
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rm => rm.id === a.remate_id) }))
      .filter(({ r }) => r && r.fecha >= desde && r.fecha <= hasta)
      .map(({ a }) => ({ cliente_nombre: a.cliente_nombre, monto: a.monto }));
    return { rows: filas };
  }
  if (/^SELECT j\.cliente_nombre, j\.monto(, j\.resultado_cliente)?(, j\.banqueadores)?(, j\.gano)?\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }

  // (28-09-2026) obtenerComisionesPropias() ahora hace 2 consultas: los
  // jugadores en sí (comision_propia SIEMPRE para el propio cliente), y
  // sus avaladores en jugadores_avales_porcentaje — ni PEDRO ni MARIA
  // tienen filas ahí, así que la 2da siempre da vacío.
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => ({
        id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0,
        cc_propio_nombre: null,
        incluir_porcentaje_en_jugadas: !!j.incluir_porcentaje_en_jugadas
      }))
    };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
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
const handlerComisionesDevueltas = handlerDe('get', '/comisiones-devueltas');
const handlerComisionesDevueltasHipodromo = handlerDe('get', '/comisiones-devueltas-por-hipodromo');
const handlerSaldoComisiones = handlerDe('get', '/saldo-comisiones');

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
  return { grupoId, grupo: { nombre: 'Zenyatta' }, params: {}, query: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) GET /comisiones-devueltas-por-hipodromo ---
  const res1 = await invocarRuta(handlerComisionesDevueltasHipodromo, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(res1._status === 200, '1) GET /comisiones-devueltas-por-hipodromo responde 200');
  check(res1._json.fecha === FECHA, 'Trae la fecha pedida');
  // 26-09-2026, a pedido del usuario ("LOS REMATES NO LE PRODUCEN % DE
  // DEVOLUCION A LOS CLIENTES"): el Remate de Churchill Downs (100 de
  // PEDRO) ya NO genera % devuelto -- ese hipódromo, que solo tenía esa
  // línea de Remate, desaparece por completo del reporte; queda solo
  // La Rinconada (Tercios).
  check(res1._json.hipodromos.length === 1, 'Trae 1 solo hipódromo (La Rinconada) -- Churchill Downs solo tenía Remate, que ya no genera % devuelto');
  check(res1._json.hipodromos[0].nombre === 'La Rinconada', 'La Rinconada es el único hipódromo del reporte');
  const rinconada = res1._json.hipodromos[0];
  check(rinconada.carreras.length === 3, 'La Rinconada trae sus 3 carreras (incluida la de LEGOLAS)');
  check(rinconada.carreras.find(c => c.carreraNumero === 1).devuelto === 1, 'Carrera 1: 1,00 devuelto (1% de 100 de PEDRO)');
  check(rinconada.carreras.find(c => c.carreraNumero === 2).devuelto === 2, 'Carrera 2: 2,00 devuelto (1% de 200 de PEDRO; MARIA no aporta, sin % configurado)');
  // 02-10-2026, caso real del usuario: LEGOLAS tiene el toggle "incluir %
  // en sus jugadas" en ON -- antes de este cambio, este reporte lo
  // excluía por completo (ver la nota grande en hipismoComisionPropia.js
  // y el comentario junto a `info.incluidaEnJugada` en /comisiones-
  // devueltas-por-hipodromo). Ahora sí aparece, igual que cualquier otro
  // % propio.
  check(rinconada.carreras.find(c => c.carreraNumero === 3).devuelto === 1, 'Carrera 3: 1,00 devuelto (1% de 100 de LEGOLAS, a pesar de tener "incluir % en sus jugadas" en ON)');
  check(rinconada.totalDevuelto === 4, 'Subtotal de La Rinconada: 4,00 (1,00 + 2,00 + 1,00 de LEGOLAS)');
  check(res1._json.totalGeneral === 4, 'Total general del día: 4,00 (incluye el 1,00 de LEGOLAS -- el Remate de Churchill Downs sigue sin contar, ni el otro grupo (999) ni la otra fecha (500))');

  // --- 2) Un día sin ninguna devolución: vacío, no error ---
  const res2 = await invocarRuta(handlerComisionesDevueltasHipodromo, Object.assign(reqBase(GRUPO_ID), { query: { fecha: '2026-01-01' } }));
  check(res2._status === 200, '2) Un día sin devoluciones responde 200 (no un error)');
  check(Array.isArray(res2._json.hipodromos) && res2._json.hipodromos.length === 0, 'hipodromos: [] cuando no hay nada ese día');
  check(res2._json.totalGeneral === 0, 'totalGeneral: 0 cuando no hay nada ese día');

  // --- 3) GET /comisiones-devueltas ya trae totalGeneral ---
  const res3 = await invocarRuta(handlerComisionesDevueltas, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(res3._status === 200, '3) GET /comisiones-devueltas responde 200');
  check(res3._json.totalGeneral === 4, 'totalGeneral suma los totales de todos los clientes: 4,00 (PEDRO: 1,00 + 2,00 de Tercios, más 1,00 de LEGOLAS -- el Remate ya no aporta)');
  const legolasDevueltas = res3._json.clientes.find(c => c.nombre === 'LEGOLAS');
  check(!!legolasDevueltas && legolasDevueltas.total === 1, '02-10-2026: LEGOLAS (toggle "incluir % en sus jugadas" ON) SÍ aparece en /comisiones-devueltas con su propio 1,00, a pesar del toggle');
  check(legolasDevueltas.destino === 'LEGOLAS' && !legolasDevueltas.esAvalAdicional, 'La línea de LEGOLAS es su propio % (no un aval), acreditada a su propio nombre');

  // --- 4) y 5) GET /saldo-comisiones — pisa Date.now() para que "hoy" caiga
  // en la semana lunes 21 a domingo 27 de sept de 2026 (mismo truco que
  // test_hipismo_semana_por_dias.js). ---
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-23T12:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };
  let res4, res5;
  try {
    res4 = await invocarRuta(handlerSaldoComisiones, Object.assign(reqBase(GRUPO_ID), { query: { semana: 'actual' } }));
    res5 = await invocarRuta(handlerSaldoComisiones, reqBase(GRUPO_ID)); // sin ?semana=
  } finally {
    global.Date = OriginalDate;
  }
  check(res4._status === 200, '4) GET /saldo-comisiones?semana=actual responde 200');
  check(res4._json.rango.desde === '2026-09-21' && res4._json.rango.hasta === '2026-09-27', 'El rango es lunes 21 a domingo 27 de sept (semana de FECHA)');
  check(res4._json.clientes.length === 2, 'Aparecen PEDRO y LEGOLAS (MARIA sigue sin % propio configurado)');
  const pedroSaldo = res4._json.clientes.find(c => c.nombre === 'PEDRO');
  check(!!pedroSaldo && pedroSaldo.porcentaje === 1, 'Trae a PEDRO con su 1% configurado');
  check(pedroSaldo.devueltoSemana === 3, 'PEDRO lleva 3,00 devueltos en la semana (1,00 + 2,00 de Tercios -- el Remate ya no cuenta, y la otra fecha y el otro grupo tampoco se cuelan)');
  check(pedroSaldo.destino === 'PEDRO', 'Sin aval configurado, destino es el propio cliente');
  // 02-10-2026, caso real del usuario: LEGOLAS (toggle "incluir % en sus
  // jugadas" ON) antes NO aparecía acá -- ver la nota grande EXACTA de
  // /comisiones-devueltas en hipismoComisionPropia.js. Ahora sí, igual
  // que PEDRO.
  const legolasSaldo = res4._json.clientes.find(c => c.nombre === 'LEGOLAS');
  check(!!legolasSaldo && legolasSaldo.porcentaje === 1 && legolasSaldo.devueltoSemana === 1,
    '02-10-2026: LEGOLAS (toggle ON) SÍ aparece en /saldo-comisiones, con 1,00 devuelto en la semana');
  check(legolasSaldo.destino === 'LEGOLAS', 'LEGOLAS: sin aval configurado, destino es su propio nombre');
  check(res4._json.totalGeneral === 4, 'totalGeneral de la semana: 4,00 (3,00 de PEDRO + 1,00 de LEGOLAS, sin el Remate)');
  check(res5._status === 200, '5) Sin ?semana=, usa "actual" por defecto sin explotar');
  check(res5._json.semana === 'actual', 'El default de semana es "actual"');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
