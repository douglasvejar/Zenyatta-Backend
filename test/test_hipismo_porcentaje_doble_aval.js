// =================================================================
// PRUEBA: VARIOS AVALADORES CON % CADA UNO (24-09-2026, "% devuelto"
// doble y simultáneo; REESCRITA 28-09-2026 a pedido del usuario: "en
// cliente la parte donde coloco el % que le genera a otro cliente
// dejame elegir varios ya que un cliente le puede generar % a varios...
// a medida que seleccione uno me aparece otra lista despegable y asi
// sucesivamente" — de paso el usuario simplificó "% que se le devuelve":
// ahora SIEMPRE es para el propio cliente, se quitó la opción de
// mandarlo al aval).
//
// El modelo viejo que probaba este archivo (jugadores.avalado_por_id +
// jugadores.porcentaje_devuelto_destino='aval'/'cliente' +
// jugadores.porcentaje_devuelto_aval, UN solo aval con dos % posibles)
// quedó reemplazado por jugadores_avales_porcentaje: 0, 1 o VARIAS filas
// por cliente, cada una con su propio avalador y su propio %, 100%
// independientes entre sí y de comision_propia (que ya nunca se
// redirige). Ver la nota grande de esa tabla en sql/schema.sql y de
// obtenerComisionesPropias en services/hipismoComisionPropia.js.
//
// Casos cubiertos, con 4 clientes distintos (mismo día, mismo
// hipódromo/carrera, apostando 100 cada uno, para que las cuentas sean
// fáciles de verificar):
//   1. PEDRO: comision_propia=1% (siempre para él mismo) + UN avalador
//      (JUAN) con 2% — DOS ítems simultáneos por el MISMO ticket: "PEDRO
//      - PORCENTAJE" (+1,00) y "JUAN - PORCENTAJE" (+2,00).
//   2. ANA: sin comision_propia, con UN avalador (CARLOS) al 3% — UN
//      SOLO ítem "CARLOS - PORCENTAJE" (+3,00); ya no existe la
//      "redirección" de comision_propia de antes, así que esto ahora se
//      configura como un avalador más, no como un caso especial.
//   3. LUIS: comision_propia=2% (para él mismo) + DOS avaladores
//      DISTINTOS (ROSA al 3%, SOFIA al 4%) sobre el MISMO ticket — el
//      caso central de esta ronda ("un cliente le puede generar % a
//      varios"): 3 ítems separados (LUIS +2,00, ROSA +3,00, SOFIA
//      +4,00), nunca mezclados.
//   4. MARIA: sin nada configurado — no aporta nada (retrocompatible,
//      igual que siempre).
//
// Se verifica en las 4 rutas que usan obtenerComisionesPropias():
// /comisiones-devueltas, /comisiones-devueltas-por-hipodromo,
// /saldo-comisiones y /cierre-final.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-doble-aval-1';
const FECHA = '2026-09-24'; // jueves, semana lunes 21 a domingo 27 de sept de 2026

const TABLAS = {
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 1 },
    { id: 'j-juan', grupo_id: GRUPO_ID, nombre: 'JUAN', comision_propia: 0 },
    { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 0 },
    { id: 'j-carlos', grupo_id: GRUPO_ID, nombre: 'CARLOS', comision_propia: 0 },
    { id: 'j-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 2 },
    { id: 'j-rosa', grupo_id: GRUPO_ID, nombre: 'ROSA', comision_propia: 0 },
    { id: 'j-sofia', grupo_id: GRUPO_ID, nombre: 'SOFIA', comision_propia: 0 },
    { id: 'j-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', comision_propia: 0 }
  ],
  jugadores_avales_porcentaje: [
    { grupo_id: GRUPO_ID, jugador_id: 'j-pedro', avalador_id: 'j-juan', porcentaje: 2 },
    { grupo_id: GRUPO_ID, jugador_id: 'j-ana', avalador_id: 'j-carlos', porcentaje: 3 },
    { grupo_id: GRUPO_ID, jugador_id: 'j-luis', avalador_id: 'j-rosa', porcentaje: 3 },
    { grupo_id: GRUPO_ID, jugador_id: 'j-luis', avalador_id: 'j-sofia', porcentaje: 4 }
  ],
  hipismo_planos: [
    { id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA }
  ],
  hipismo_tickets: [
    // banquero_nombre SIEMPRE viene con un valor real en hipismo_tickets
    // (ver POST /planos en routes/hipismo.js: banqueroFinal nunca queda
    // vacío) — se usa "BANCA" fija en las 4 para no meter otra variable
    // en esta prueba; lo que importa es cliente_nombre/monto.
    { id: 'ticket-pedro', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCA', modalidad: '1P', caballo: '(5)', monto: 100, resultado_jugador: -100, resultado_banquero: 100 },
    { id: 'ticket-ana', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'ANA', banquero_nombre: 'BANCA', modalidad: '1P', caballo: '(3)', monto: 100, resultado_jugador: -100, resultado_banquero: 100 },
    { id: 'ticket-luis', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'LUIS', banquero_nombre: 'BANCA', modalidad: '1P', caballo: '(7)', monto: 100, resultado_jugador: -100, resultado_banquero: 100 },
    { id: 'ticket-maria', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'MARIA', banquero_nombre: 'BANCA', modalidad: '1P', caballo: '(1)', monto: 50, resultado_jugador: -50, resultado_banquero: 50 }
  ],
  hipismo_remates: [],
  hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [],
  hipismo_adelantadas_jugadas: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerApuestasDelDia (/comisiones-devueltas[-por-hipodromo]) ----
  // 29-09-2026: ahora también trae resultado_jugador/resultado_banquero/
  // gano (filtro "no se decidió") -- ver la nota grande en routes/hipismo.js.
  if (/^SELECT t\.id, t\.cliente_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.monto, r\.hipodromo_nombre, r\.carrera_numero\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, j\.gano, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    return { rows: [] };
  }

  // ---- /saldo-comisiones (semana, BETWEEN, solo monto) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.monto(, t\.resultado_jugador, t\.resultado_banquero)?\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.monto(, j\.banqueadores)?(, j\.gano)?\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }

  // ---- /cierre-final (semana, BETWEEN, con resultado_jugador/banquero) ----
  // 26-09-2026: ahora también trae plano_id/sin_comision/cruza_jugadas
  // para el ajuste por cruce — ningún plano de esta prueba tiene
  // cruza_jugadas=true, así que el ajuste siempre da {} (sin cambios).
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision || false, cruza_jugadas: p.cruza_jugadas || false }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto(, j\.gano)?\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }

  // ---- obtenerComisionesPropias (28-09-2026, 2 consultas: la del propio
  // cliente y la de sus avaladores en jugadores_avales_porcentaje) ----
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    // 29-09-2026: esta misma consulta también se dispara SIN el filtro de
    // nombres (solo grupoId) cuando obtenerComisionesPropias necesita el
    // "rescate por nombre parecido" (ver la nota grande de esa función,
    // caso real "cliente doble") — acá eso pasa con "BANCA" (banquero fijo
    // de esta prueba, nunca configurado con %), así que sin este chequeo
    // `nombres.includes` truena por undefined.
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && (!nombres || nombres.includes(j.nombre)));
    return {
      rows: filas.map(j => ({
        id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cc_propio_nombre: null
      }))
    };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre, cc_av\.nombre AS cc_avalador_nombre/i.test(sql)) {
    const [grupoId, idsJugadores] = params;
    const porId = new Map(TABLAS.jugadores.map(j => [j.id, j]));
    const filas = TABLAS.jugadores_avales_porcentaje
      .filter(a => a.grupo_id === grupoId && idsJugadores.includes(a.jugador_id))
      .map(a => {
        const avalador = porId.get(a.avalador_id);
        return { jugador_id: a.jugador_id, porcentaje: a.porcentaje, avalador_nombre: avalador ? avalador.nombre : null, cc_avalador_nombre: null };
      });
    return { rows: filas };
  }

  // "Traspaso de comisión" (26-09-2026) — /cierre-final ahora suma los
  // ajustes de hipismo_comisiones_ajustes sobre el saldo en vivo. Esta
  // prueba no hace ningún traspaso, así que siempre queda vacío.
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes\s+WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3\s+GROUP BY cliente_nombre/i.test(sql)) {
    return { rows: [] };
  }

  // "Cargar Winners" (26-09-2026) — /cierre-final ahora también suma
  // hipismo_winners; esta prueba no crea ninguno, siempre vacío.
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
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
const handlerCierreFinal = handlerDe('get', '/cierre-final');

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
  // --- 1) /comisiones-devueltas-por-hipodromo: solo totales, sin
  // importar destino — 1(PEDRO propio) + 2(PEDRO->JUAN) + 3(ANA->CARLOS)
  // + 2(LUIS propio) + 3(LUIS->ROSA) + 4(LUIS->SOFIA) = 15,00. MARIA no
  // aporta nada (sin % configurado). ---
  const resHip = await invocarRuta(handlerComisionesDevueltasHipodromo, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(resHip._status === 200, '1) GET /comisiones-devueltas-por-hipodromo responde 200');
  check(resHip._json.hipodromos.length === 1, 'Un solo hipódromo (La Rinconada)');
  const rinconada = resHip._json.hipodromos[0];
  check(rinconada.carreras.length === 1 && rinconada.carreras[0].carreraNumero === 1, 'Una sola carrera');
  check(rinconada.carreras[0].devuelto === 15, 'La carrera 1 suma los 5 % (propios + de avales, de los 3 clientes) = 15,00');
  check(resHip._json.totalGeneral === 15, 'Total general del día: 15,00 — MARIA (sin % configurado) no aporta nada');

  // --- 2) /comisiones-devueltas: cada cliente aparece como 1, 2 o 3
  // renglones según cuántos avaladores tenga configurados. ---
  const resDev = await invocarRuta(handlerComisionesDevueltas, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(resDev._status === 200, '2) GET /comisiones-devueltas responde 200');
  check(resDev._json.clientes.length === 6, 'Salen 6 renglones: PEDRO(x2) + ANA(x1) + LUIS(x3), MARIA no aparece');
  check(resDev._json.totalGeneral === 15, 'totalGeneral de /comisiones-devueltas también da 15,00');

  const filasPedro = resDev._json.clientes.filter(c => c.nombre === 'PEDRO');
  check(filasPedro.length === 2, 'PEDRO sale en 2 renglones separados (su % propio y el % de su avalador)');
  const pedroPropio = filasPedro.find(c => c.destino === 'PEDRO');
  check(!!pedroPropio && pedroPropio.porcentaje === 1 && pedroPropio.total === 1 && !pedroPropio.esAvalAdicional, 'PEDRO propio: 1% -> 1,00 para él mismo, esAvalAdicional=false');
  const pedroAval = filasPedro.find(c => c.destino === 'JUAN');
  check(!!pedroAval && pedroAval.porcentaje === 2 && pedroAval.total === 2 && pedroAval.esAvalAdicional === true, 'PEDRO -> JUAN (avalador): 2% -> 2,00 para JUAN, esAvalAdicional=true');

  const filasAna = resDev._json.clientes.filter(c => c.nombre === 'ANA');
  check(filasAna.length === 1, 'ANA sale en UN SOLO renglón (sin % propio, solo su avalador CARLOS)');
  check(filasAna[0].destino === 'CARLOS' && filasAna[0].porcentaje === 3 && filasAna[0].total === 3 && filasAna[0].esAvalAdicional === true, 'ANA -> CARLOS: 3% -> 3,00, esAvalAdicional=true (ya no existe la "redirección" de comision_propia de antes)');

  const filasLuis = resDev._json.clientes.filter(c => c.nombre === 'LUIS');
  check(filasLuis.length === 3, 'LUIS sale en 3 renglones: su % propio + 2 avaladores DISTINTOS (ROSA y SOFIA), nunca mezclados');
  const luisPropio = filasLuis.find(c => c.destino === 'LUIS');
  const luisRosa = filasLuis.find(c => c.destino === 'ROSA');
  const luisSofia = filasLuis.find(c => c.destino === 'SOFIA');
  check(!!luisPropio && luisPropio.porcentaje === 2 && luisPropio.total === 2 && !luisPropio.esAvalAdicional, 'LUIS propio: 2% -> 2,00 para él mismo');
  check(!!luisRosa && luisRosa.porcentaje === 3 && luisRosa.total === 3 && luisRosa.esAvalAdicional === true, 'LUIS -> ROSA (avaladora 1): 3% -> 3,00');
  check(!!luisSofia && luisSofia.porcentaje === 4 && luisSofia.total === 4 && luisSofia.esAvalAdicional === true, 'LUIS -> SOFIA (avaladora 2): 4% -> 4,00, un renglón totalmente aparte de ROSA');

  check(!resDev._json.clientes.some(c => c.nombre === 'MARIA'), 'MARIA no aparece (sin % configurado, retrocompatible)');

  // --- 3) /saldo-comisiones: misma lógica, agregada por semana. Pisa
  // Date.now() para que "hoy" caiga en la semana de FECHA (mismo truco
  // que test_hipismo_comisiones_devueltas_hipodromo_y_saldo.js). ---
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-23T12:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };
  let resSaldo, resCierre;
  try {
    resSaldo = await invocarRuta(handlerSaldoComisiones, Object.assign(reqBase(GRUPO_ID), { query: { semana: 'actual' } }));
    resCierre = await invocarRuta(handlerCierreFinal, Object.assign(reqBase(GRUPO_ID), { query: { semana: 'actual' } }));
  } finally {
    global.Date = OriginalDate;
  }
  check(resSaldo._status === 200, '3) GET /saldo-comisiones?semana=actual responde 200');
  check(resSaldo._json.clientes.length === 6, '/saldo-comisiones también trae los 6 renglones (PEDRO x2, ANA x1, LUIS x3)');
  check(resSaldo._json.totalGeneral === 15, 'totalGeneral semanal de /saldo-comisiones: 15,00');
  const luisSaldo = resSaldo._json.clientes.filter(c => c.nombre === 'LUIS');
  check(luisSaldo.length === 3 && luisSaldo.some(c => c.devueltoSemana === 2) && luisSaldo.some(c => c.devueltoSemana === 3) && luisSaldo.some(c => c.devueltoSemana === 4),
    'LUIS también sale con sus 3 renglones separados (2,00 propio + 3,00 ROSA + 4,00 SOFIA) en /saldo-comisiones');

  // --- 4) /cierre-final: cada ítem "{destino} - PORCENTAJE" queda sumado
  // en su propio "cliente" dentro de la misma lista de saldos — como acá
  // cada avalador es DISTINTO, ROSA y SOFIA quedan en ítems separados
  // (nunca se juntan entre sí, a diferencia del ejemplo viejo donde 2 %
  // iban al MISMO destino). ---
  check(resCierre._status === 200, '4) GET /cierre-final responde 200');
  const itemPedro = resCierre._json.clientes.find(c => c.nombre === 'PEDRO - PORCENTAJE');
  const itemJuan = resCierre._json.clientes.find(c => c.nombre === 'JUAN - PORCENTAJE');
  const itemCarlos = resCierre._json.clientes.find(c => c.nombre === 'CARLOS - PORCENTAJE');
  const itemLuis = resCierre._json.clientes.find(c => c.nombre === 'LUIS - PORCENTAJE');
  const itemRosa = resCierre._json.clientes.find(c => c.nombre === 'ROSA - PORCENTAJE');
  const itemSofia = resCierre._json.clientes.find(c => c.nombre === 'SOFIA - PORCENTAJE');
  check(!!itemPedro && itemPedro.gano === 1, 'Ítem "PEDRO - PORCENTAJE": +1,00 (su % propio)');
  check(!!itemJuan && itemJuan.gano === 2, 'Ítem "JUAN - PORCENTAJE": +2,00 (el % que le generó PEDRO como avalador)');
  check(!!itemCarlos && itemCarlos.gano === 3, 'Ítem "CARLOS - PORCENTAJE": +3,00 (el % que le generó ANA como avalador)');
  check(!!itemLuis && itemLuis.gano === 2, 'Ítem "LUIS - PORCENTAJE": +2,00 (su % propio)');
  check(!!itemRosa && itemRosa.gano === 3, 'Ítem "ROSA - PORCENTAJE": +3,00 (uno de los 2 avaladores de LUIS)');
  check(!!itemSofia && itemSofia.gano === 4, 'Ítem "SOFIA - PORCENTAJE": +4,00 (el otro avalador de LUIS, en su propio ítem, nunca mezclado con el de ROSA)');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
