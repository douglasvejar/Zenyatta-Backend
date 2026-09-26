// =================================================================
// PRUEBA: "Cargar Remate" — Módulo Hipismo (23-09-2026, a pedido del
// usuario, con un formato real de ejemplo pegado por él). Cubre el
// motor de cálculo (services/hipismoRemateCalc.js) contra el ejemplo
// REAL que dio el usuario, y las rutas reales (POST /remates,
// POST /remates/calcular, GET /cierre-final) contra una base de datos
// falsa en memoria — mismo patrón que test_jugadores_modelo_comision.js/
// test_cliente_ruta.js (Module._load intercepta "pg"/"express" antes de
// requerir el router real).
//
// Casos cubiertos:
//   1. El ejemplo real del usuario (8 caballos, pool 670, garantía 500,
//      20% de comisión) con el número 2 (JUNKO) ganando la carrera:
//      pago_ganador = MAX(670*0.8, 500) = 536, comision_total = 134 —
//      NO se paga la garantía acá porque el pool alcanza de sobra.
//   2. "Quedó para la banca" (confirmado con el usuario, 23-09-2026): el
//      número ganador de la carrera NO fue jugado en el remate -> todos
//      pierden lo apostado, comision_total = pool completo (670), sin
//      sacar ningún %.
//   3. POST /remates/calcular sin llegada disponible (ni a mano ni de un
//      plano ya cargado) -> necesitaLlegada: true, no guarda nada.
//   4. GET /cierre-final: el resultado de un remate ya guardado entra al
//      mismo saldo semanal por cliente que las jugadas de "Cargar
//      Planos", pero su comisión viaja SEPARADA (comisionRemateSemana),
//      nunca mezclada con la comisión de 5% por carrera.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-remate-1';
const TABLAS = {
  jugadores: [],
  hipismo_planos: [],
  hipismo_tickets: [],
  hipismo_remates: [],
  hipismo_remate_apuestas: []
};
let seq = 1;
const nuevoId = (prefijo) => prefijo + (seq++);

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // autoRegistrarJugadores() (services/procesarSabana.js) — se llama con
  // jugadoresPorNombreExistentes: {} desde hipismo.js, así que trata a
  // TODOS los nombres del remate como "nuevos" y los intenta insertar.
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    if (!TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      TABLAS.jugadores.push({ id: nuevoId('j'), grupo_id: grupoId, nombre, activo: true, auto_creado: true, tipo_cuenta: 'libre', pozo_inicial: 0, comision_propia: 0 });
    }
    return { rows: [] };
  }
  // "% devuelto" (undécima ronda) — obtenerComisionesPropias() en
  // routes/hipismo.js. Ningún cliente de esta prueba tiene % propio.
  if (/^SELECT j\.nombre, j\.comision_propia, j\.porcentaje_devuelto_destino, j\.porcentaje_devuelto_aval, av\.nombre AS aval_nombre,\s+cc_propio\.nombre AS cc_propio_nombre, cc_aval\.nombre AS cc_aval_nombre\s+FROM jugadores j\s+LEFT JOIN jugadores av ON av\.id = j\.avalado_por_id\s+LEFT JOIN jugadores cc_propio ON cc_propio\.id = j\.cuenta_comision_id\s+LEFT JOIN jugadores cc_aval ON cc_aval\.id = av\.cuenta_comision_id\s+WHERE j\.grupo_id = \$1 AND j\.nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => ({
        nombre: j.nombre, comision_propia: j.comision_propia || 0,
        porcentaje_devuelto_destino: j.porcentaje_devuelto_destino || 'cliente',
        porcentaje_devuelto_aval: j.porcentaje_devuelto_aval || 0,
        aval_nombre: j.avalado_por_id ? ((TABLAS.jugadores.find(x => x.id === j.avalado_por_id) || {}).nombre || null) : null,
        cc_propio_nombre: null,
        cc_aval_nombre: null
      }))
    };
  }
  // "Cuenta de comisión como cliente real" (26-09-2026) —
  // asegurarCuentasComisionParaNombres() en routes/hipismo.js decide, por
  // cada nombre que jugó, si hace falta crear/enlazar su cuenta de
  // comisión real ANTES de guardar. Casi ningún jugador de esta prueba
  // tiene % propio configurado, así que casi siempre no hace falta crear
  // nada.
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, j\.porcentaje_devuelto_destino, j\.porcentaje_devuelto_aval, j\.cuenta_comision_id,\s+av\.id AS aval_id, av\.nombre AS aval_nombre, av\.cuenta_comision_id AS aval_cuenta_comision_id\s+FROM jugadores j\s+LEFT JOIN jugadores av ON av\.id = j\.avalado_por_id\s+WHERE j\.grupo_id = \$1 AND j\.nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => {
        const aval = j.avalado_por_id ? TABLAS.jugadores.find(x => x.id === j.avalado_por_id) : null;
        return {
          id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0,
          porcentaje_devuelto_destino: j.porcentaje_devuelto_destino || 'cliente',
          porcentaje_devuelto_aval: j.porcentaje_devuelto_aval || 0,
          cuenta_comision_id: j.cuenta_comision_id || null,
          aval_id: aval ? aval.id : null,
          aval_nombre: aval ? aval.nombre : null,
          aval_cuenta_comision_id: aval ? (aval.cuenta_comision_id || null) : null
        };
      })
    };
  }
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial, es_cuenta_comision\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    let cuenta = TABLAS.jugadores.find(j => j.grupo_id === grupoId && j.nombre === nombre);
    if (!cuenta) {
      cuenta = { id: nuevoId('j'), grupo_id: grupoId, nombre, activo: true, auto_creado: true, tipo_cuenta: 'libre', pozo_inicial: 0, comision_propia: 0, es_cuenta_comision: true };
      TABLAS.jugadores.push(cuenta);
    } else {
      cuenta.es_cuenta_comision = true;
    }
    return { rows: [{ id: cuenta.id }] };
  }
  if (/^UPDATE jugadores SET cuenta_comision_id = \$1 WHERE id = \$2 AND grupo_id = \$3 AND cuenta_comision_id IS NULL/i.test(sql)) {
    const [cuentaId, jugadorId, grupoId] = params;
    const j = TABLAS.jugadores.find(x => x.id === jugadorId && x.grupo_id === grupoId && !x.cuenta_comision_id);
    if (j) j.cuenta_comision_id = cuentaId;
    return { rows: [] };
  }
  // "Traspaso de comisión" (26-09-2026) — /cierre-final ahora suma los
  // ajustes de hipismo_comisiones_ajustes sobre el saldo en vivo. Esta
  // prueba no hace ningún traspaso, así que siempre queda vacío.
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes\s+WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3\s+GROUP BY cliente_nombre/i.test(sql)) {
    return { rows: [] };
  }

  // resolverLlegadaRemate(): busca el plano más reciente de ese hipódromo+carrera+fecha.
  if (/^SELECT pizarra FROM hipismo_planos/i.test(sql)) {
    const [grupoId, hip, carrera, fecha] = params;
    const filas = TABLAS.hipismo_planos
      .filter(p => p.grupo_id === grupoId && p.hipodromo_nombre === hip && String(p.carrera_numero) === String(carrera) && p.fecha === fecha)
      .sort((a, b) => b.creado_en - a.creado_en);
    return { rows: filas.length ? [{ pizarra: filas[0].pizarra }] : [] };
  }

  // POST /remates: INSERT hipismo_remates
  if (/^INSERT INTO hipismo_remates/i.test(sql)) {
    const [grupoId, hipodromoId, hipodromoNombre, carreraNumero, fecha, textoOriginal, comisionPorcentaje, garantia,
      poolTotal, pizarra, numeroGanador, huboGanador, caballoGanador, clienteGanador, pagoGanador, comisionTotal, textoResultado] = params;
    const fila = {
      id: nuevoId('rem'), grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre,
      carrera_numero: carreraNumero, fecha, texto_original: textoOriginal, comision_porcentaje: comisionPorcentaje,
      garantia, pool_total: poolTotal, pizarra, numero_ganador: numeroGanador, hubo_ganador: huboGanador,
      caballo_ganador: caballoGanador, cliente_ganador: clienteGanador, pago_ganador: pagoGanador,
      comision_total: comisionTotal, texto_resultado: textoResultado, creado_en: Date.now()
    };
    TABLAS.hipismo_remates.push(fila);
    return { rows: [fila] };
  }

  // POST /remates: INSERT hipismo_remate_apuestas (una por línea)
  if (/^INSERT INTO hipismo_remate_apuestas/i.test(sql)) {
    const [remateId, grupoId, numeroEjemplar, caballo, clienteNombre, monto, resultado] = params;
    const fila = { id: nuevoId('apu'), remate_id: remateId, grupo_id: grupoId, numero_ejemplar: numeroEjemplar, caballo, cliente_nombre: clienteNombre, monto, resultado };
    TABLAS.hipismo_remate_apuestas.push(fila);
    return { rows: [fila] };
  }

  // GET /cierre-final: tickets de "Cargar Planos" de la semana (vacío en esta prueba).
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto/i.test(sql)) {
    return { rows: [] };
  }

  // GET /cierre-final: apuestas de remate de la semana.
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId)
      .filter(a => {
        const remate = TABLAS.hipismo_remates.find(r => r.id === a.remate_id);
        return remate && remate.fecha >= desde && remate.fecha <= hasta;
      });
    return { rows: filas.map(a => ({ cliente_nombre: a.cliente_nombre, resultado: a.resultado, monto: a.monto })) };
  }

  // GET /cierre-final: comisión de "Cargar Planos" de la semana (0 en esta prueba).
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_planos/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }

  // GET /cierre-final: comisión de Remate de la semana.
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const total = TABLAS.hipismo_remates
      .filter(r => r.grupo_id === grupoId && r.fecha >= desde && r.fecha <= hasta)
      .reduce((acc, r) => acc + Number(r.comision_total), 0);
    return { rows: [{ total }] };
  }

  // GET /cierre-final: Jugadas Adelantadas de la semana (23-09-2026, ver
  // test_hipismo_adelantadas.js) — esta prueba no crea ninguna, siempre vacío.
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.comision, j\.banqueadores/i.test(sql)) {
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
  return entrada[1][entrada[1].length - 1];
}
const handlerCalcular = handlerDe('post', '/remates/calcular');
const handlerGuardar = handlerDe('post', '/remates');
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

const REMATE_EJEMPLO = `*🇻🇪🐴REMATE ADELANTADO ZENYATTA🐴🇻🇪*


1️⃣- *INVADER* 150$ *MUJICA*
2️⃣- *MUFASA* 40$ *JUNKO*
3️⃣- *REY JOAQUIN* 100$ *MR INCREIBLE*
4️⃣- *FIRST TIME* 60$ *TYKHE*
5️⃣- *THE FIELDJER JR* 80$ *TYKHE*
6️⃣- *PAN DE AZUCAR* 80$ *KRISTIAN*
7️⃣- *SOL RAYO LASER (USA)* 80$ *RAMBO*
8️⃣- *TORO SALVAJE*  80$ *TYKHE*


*CIERRA DOMINGO 12.30*


*PAGANDO  500$*

*PONLES DE 20 HASTA 100*
*DE 50 HASTA  500*
*DE 100 HASTA 2000*`;

function reqBase(grupoId) {
  return { grupoId, grupo: { nombre: 'Zenyatta' } };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) El caballo #2 (JUNKO) gana la carrera -> pool alcanza para el 20% ---
  const req1 = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: REMATE_EJEMPLO, hipodromoNombre: 'La Rinconada', carreraNumero: 5, fecha: '2026-09-21', comisionPorcentaje: 20, pizarra: '2.5.1' }
  });
  const res1 = await invocarRuta(handlerGuardar, req1);
  check(res1._status === 201, 'POST /api/hipismo/remates (ganador real) responde 201');
  check(res1._json && Number(res1._json.remate.pool_total) === 670, 'pool_total = 670 (suma de los 8 montos)');
  check(Number(res1._json.remate.pago_ganador) === 536, 'pago_ganador = 536 (670*0.8, alcanza de sobra la garantía de 500 -> NO se paga la garantía)');
  check(Number(res1._json.remate.comision_total) === 134, 'comision_total = 134 (670 - 536, el 20% completo)');
  check(res1._json.remate.hubo_ganador === true, 'hubo_ganador = true');
  check(res1._json.remate.cliente_ganador === 'JUNKO', 'cliente_ganador = JUNKO (jugó el #2, que ganó la carrera)');
  const apuestaJunko = TABLAS.hipismo_remate_apuestas.find(a => a.cliente_nombre === 'JUNKO' && a.remate_id === res1._json.remate.id);
  check(apuestaJunko && Number(apuestaJunko.resultado) === 496, 'la línea de JUNKO queda en +496 (536 de pago - 40 que apostó)');
  const apuestaMujica = TABLAS.hipismo_remate_apuestas.find(a => a.cliente_nombre === 'MUJICA' && a.remate_id === res1._json.remate.id);
  check(apuestaMujica && Number(apuestaMujica.resultado) === -150, 'la línea de MUJICA (perdió) queda en -150 (lo que apostó)');
  check(TABLAS.jugadores.some(j => j.nombre === 'JUNKO'), 'JUNKO quedó auto-registrado en "jugadores" (cliente nuevo)');
  check(TABLAS.jugadores.some(j => j.nombre === 'TYKHE'), 'TYKHE quedó auto-registrado en "jugadores" (cliente nuevo)');
  check(typeof res1._json.textoResultado === 'string' && res1._json.textoResultado.includes('JUNKO'.toLowerCase() === 'junko' ? 'Junko' : 'Junko'),
    'textoResultado menciona al ganador (Junko)');
  check(res1._json.textoResultado.includes('✅💰'), 'textoResultado marca la línea ganadora con ✅💰');

  // --- 2) Mismo remate, pero el número ganador de la carrera (9) no fue jugado -> "queda para la banca" ---
  const req2 = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: REMATE_EJEMPLO, hipodromoNombre: 'La Rinconada', carreraNumero: 6, fecha: '2026-09-21', comisionPorcentaje: 20, pizarra: '9.5.1' }
  });
  const res2 = await invocarRuta(handlerGuardar, req2);
  check(res2._status === 201, 'POST /api/hipismo/remates ("banca") responde 201');
  check(res2._json.remate.hubo_ganador === false, 'hubo_ganador = false (el #9 no fue jugado por nadie)');
  check(Number(res2._json.remate.pago_ganador) === 0, 'pago_ganador = 0 (nadie gana)');
  check(Number(res2._json.remate.comision_total) === 670, 'comision_total = pool completo (670) -- no se saca ningún % cuando queda para la banca');
  const todasLasLineas = TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === res2._json.remate.id);
  check(todasLasLineas.every(a => Number(a.resultado) < 0), 'TODAS las líneas quedan negativas (todos pierden lo apostado)');
  check(res2._json.textoResultado.includes('quedó todo para la banca'), 'textoResultado avisa que quedó para la banca');

  // --- 3) POST /remates/calcular sin llegada disponible (ni manual ni de un plano ya cargado) ---
  const req3 = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: REMATE_EJEMPLO, hipodromoNombre: 'Valencia', carreraNumero: 9, fecha: '2026-09-22', comisionPorcentaje: 20 }
  });
  const res3 = await invocarRuta(handlerCalcular, req3);
  check(res3._status === 200, 'POST /api/hipismo/remates/calcular sin llegada responde 200 (no es un error, solo falta un dato)');
  check(res3._json.necesitaLlegada === true, 'necesitaLlegada: true cuando no hay plano previo ni llegada manual');
  check(res3._json.poolTotal === 670, 'igual devuelve el poolTotal ya calculado, para que el admin pueda revisar el remate mientras completa la llegada');

  // --- 3b) Guardar sin llegada disponible -> 400, no debe guardar nada ---
  const cantidadRematesAntes = TABLAS.hipismo_remates.length;
  const res3b = await invocarRuta(handlerGuardar, req3);
  check(res3b._status === 400, 'POST /api/hipismo/remates sin llegada disponible responde 400');
  check(TABLAS.hipismo_remates.length === cantidadRematesAntes, 'no se guardó ningún remate nuevo cuando falta la llegada');

  // --- 3c) Si ya hay un plano cargado para ese hipódromo+carrera+fecha, la llegada se toma sola de ahí ---
  TABLAS.hipismo_planos.push({ grupo_id: GRUPO_ID, hipodromo_nombre: 'Valencia', carrera_numero: 9, fecha: '2026-09-22', pizarra: '3.1.2', creado_en: Date.now() });
  const res3c = await invocarRuta(handlerCalcular, req3);
  check(res3c._json.necesitaLlegada === false, 'con un plano ya cargado de esa carrera, ya no hace falta pedir la llegada');
  check(res3c._json.origenPizarra === 'plano_existente', 'origenPizarra indica que se tomó del plano ya guardado');
  check(res3c._json.numeroGanador === 3, 'el número ganador se toma del primer lugar de la pizarra del plano (3.1.2 -> ganó el 3)');
  check(res3c._json.hayGanador === true, 'el #3 (REY JOAQUIN) sí fue jugado en el remate -> MR INCREIBLE gana');

  // --- 4) GET /cierre-final: los remates YA guardados (casos 1 y 2, ambos el 2026-09-21) entran al saldo semanal ---
  const req4 = Object.assign(reqBase(GRUPO_ID), { query: {} });
  // rangoSemana()/hoyVenezuela() usan la fecha REAL de hoy -- para que la
  // prueba no dependa del día en que se corre, se pisa temporalmente
  // Date.now() para que "hoy" caiga en la misma semana que 2026-09-21
  // (lunes 21 de septiembre de 2026).
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-23T12:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };
  let res4;
  try {
    res4 = await invocarRuta(handlerCierreFinal, req4);
  } finally {
    global.Date = OriginalDate;
  }
  check(res4._status === 200, 'GET /api/hipismo/cierre-final responde 200');
  // 23-09-2026 (duodécima-tercera ronda, a pedido del usuario: "...y
  // semana xxx... que seria la semana del año en la que estamos") — la
  // semana lunes 21 al domingo 27 de septiembre de 2026 es la semana
  // ISO-8601 número 39 de 2026 (ver services/fechaSemana.js).
  check(!!res4._json.numeroSemana, 'GET /cierre-final ahora también trae numeroSemana');
  check(res4._json.numeroSemana && res4._json.numeroSemana.anio === 2026 && res4._json.numeroSemana.semana === 39, 'numeroSemana calcula bien la semana 39 de 2026 para el lunes 21 al domingo 27 de septiembre');
  // JUNKO jugó el caballo #2 en LOS 2 remates de la prueba (mismo texto de
  // ejemplo reusado): en el primero ganó (+496), en el segundo ("banca",
  // el #9 no fue jugado por nadie) también perdió su apuesta al #2 (-40)
  // -> saldo semanal = 496 - 40 = 456, con 2 jugadas contadas.
  const junkoCierre = res4._json.clientes.find(c => c.nombre === 'JUNKO');
  check(junkoCierre && Number(junkoCierre.saldo) === 456, 'JUNKO aparece en Cierre Final con saldo +456 (ganó 496 en un remate, perdió 40 en el otro)');
  check(junkoCierre && junkoCierre.jugadas === 2, 'a JUNKO le cuentan 2 jugadas (una línea de remate en cada uno de los 2 remates)');
  const tykheCierre = res4._json.clientes.find(c => c.nombre === 'TYKHE');
  // TYKHE aparece en los 2 remates: perdió 220 en el primero (3 caballos:
  // 60+80+80) y perdió 220 de nuevo en el segundo ("banca") -> -440 total.
  check(tykheCierre && Number(tykheCierre.saldo) === -440, 'TYKHE acumula -440 entre los 2 remates (perdió sus 3 caballos en cada uno)');
  check(Number(res4._json.comisionRemateSemana) === (134 + 670), 'comisionRemateSemana suma la comisión de los 2 remates (134 + 670), SEPARADA de comisionSemana');
  check(Number(res4._json.comisionSemana) === 0, 'comisionSemana (la de "Cargar Planos", 5% por carrera) queda en 0 -- no se mezcla con la de Remate');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Cargar Remate se cayó con una excepción:', e);
  process.exit(1);
});
