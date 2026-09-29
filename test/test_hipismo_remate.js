// =================================================================
// PRUEBA: "Cargar Remate" — Módulo Hipismo (23-09-2026, a pedido del
// usuario, con un formato real de ejemplo pegado por él; actualizada el
// 26-09-2026 para los 3 modos de pago — REMATE PAGA / REMATE GARANTIZA /
// % de siempre — y el ítem "REMATE" en Balance General/Cierre Final).
// Cubre el motor de cálculo (services/hipismoRemateCalc.js) y las rutas
// reales (POST /remates, POST /remates/calcular, GET /cierre-final,
// GET /clientes/REMATE/detalle-semana) contra una base de datos falsa en
// memoria — mismo patrón que test_jugadores_modelo_comision.js/
// test_cliente_ruta.js (Module._load intercepta "pg"/"express" antes de
// requerir el router real).
//
// Casos cubiertos:
//   1. "REMATE PAGA" (texto con *PAGANDO 500$*): el remate paga EXACTO
//      lo que dice el texto, SIN tocar ningún % — con el ejemplo real
//      del usuario (pool 670) y el número 2 (JUNKO) ganando la carrera:
//      pago_ganador = 500 (el monto tal cual), comision_total (ahora
//      "resultadoRemate") = 170 (670 - 500, a favor de la casa).
//   2. "Quedó para la banca" (confirmado con el usuario, 23-09-2026): el
//      número ganador de la carrera NO fue jugado en el remate -> todos
//      pierden lo apostado, resultadoRemate = pool completo (670) — este
//      caso es IGUAL en los 3 modos, no depende de PAGA/GARANTIZA/%.
//   3. "REMATE GARANTIZA" (texto con *GARANTIZA 500$*): se preserva el
//      cálculo de piso + % de siempre — pago_ganador = MAX(pool*(1-%),
//      garantía), resultadoRemate = pool - pago_ganador.
//   4. "REMATE GARANTIZA" cuando NI VENDIENDO TODO EL POOL alcanza para
//      cubrir la garantía -> advertenciaGarantiaNoAlcanza: true (a
//      pedido del usuario: "si le quito X cantidad de % no da para pagar
//      el premio garantizado, indicame en un mensaje").
//   5. "Remate Paga" y "Remate Garantiza" al mismo tiempo -> 400 (nunca
//      pueden venir los 2 juntos en el mismo remate).
//   6. POST /remates/calcular sin llegada disponible (ni a mano ni de un
//      plano ya cargado) -> necesitaLlegada: true, no guarda nada.
//   7. GET /cierre-final: el resultado de los remates ya guardados entra
//      al mismo saldo semanal por cliente que las jugadas de "Cargar
//      Planos", pero su resultado (antes "comisión") viaja SEPARADO,
//      como su PROPIO ítem "REMATE" en la lista de clientes — nunca
//      mezclado con la comisión de 5% por carrera (26-09-2026, a pedido
//      del usuario: "esos 2000 negativos deben salir en un ítem en
//      balance como si fuera otro cliente llamado REMATE").
//   8. GET /clientes/REMATE/detalle-semana: el detalle carrera-por-
//      carrera-e-hipódromo de ese ítem "REMATE" (construirResumenRemateHipismo).
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
  // services/hipismoComisionPropia.js. Ningún cliente de esta prueba tiene
  // % propio. (28-09-2026) comision_propia ahora SIEMPRE es para el propio
  // cliente, y el % de aval adicional pasó a jugadores_avales_porcentaje —
  // ningún jugador de esta prueba tiene filas ahí, así que la 2da consulta
  // de abajo siempre da vacío.
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => ({
        id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cc_propio_nombre: null
      }))
    };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre, cc_av\.nombre AS cc_avalador_nombre/i.test(sql)) {
    return { rows: [] };
  }
  // "Cuenta de comisión como cliente real" (26-09-2026) —
  // asegurarCuentasComisionParaNombres() decide, por cada nombre que jugó,
  // si hace falta crear/enlazar su cuenta de comisión real ANTES de
  // guardar. Casi ningún jugador de esta prueba tiene % propio configurado,
  // así que casi siempre no hace falta crear nada.
  if (/^SELECT id, nombre, comision_propia, cuenta_comision_id FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => ({
        id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0,
        cuenta_comision_id: j.cuenta_comision_id || null
      }))
    };
  }
  if (/^SELECT DISTINCT jap\.avalador_id, av\.nombre AS avalador_nombre, av\.cuenta_comision_id AS avalador_cuenta_comision_id/i.test(sql)) {
    return { rows: [] };
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

  // POST /remates: INSERT hipismo_remates (18 columnas desde el
  // 26-09-2026, con pago_fijo agregado entre garantia y pool_total).
  if (/^INSERT INTO hipismo_remates/i.test(sql)) {
    const [grupoId, hipodromoId, hipodromoNombre, carreraNumero, fecha, textoOriginal, comisionPorcentaje, garantia, pagoFijo,
      poolTotal, pizarra, numeroGanador, huboGanador, caballoGanador, clienteGanador, pagoGanador, comisionTotal, textoResultado] = params;
    const fila = {
      id: nuevoId('rem'), grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre,
      carrera_numero: carreraNumero, fecha, texto_original: textoOriginal, comision_porcentaje: comisionPorcentaje,
      garantia, pago_fijo: pagoFijo, pool_total: poolTotal, pizarra, numero_ganador: numeroGanador, hubo_ganador: huboGanador,
      caballo_ganador: caballoGanador, cliente_ganador: clienteGanador, pago_ganador: pagoGanador,
      comision_total: comisionTotal, texto_resultado: textoResultado, creado_en: Date.now() + (seq++ / 1000)
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

  // GET /cierre-final: resultado de Remate de la semana (ítem "REMATE").
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const total = TABLAS.hipismo_remates
      .filter(r => r.grupo_id === grupoId && r.fecha >= desde && r.fecha <= hasta)
      .reduce((acc, r) => acc + Number(r.comision_total), 0);
    return { rows: [{ total }] };
  }

  // GET /clientes/REMATE/detalle-semana: detalle carrera-por-carrera-e-
  // hipódromo (construirResumenRemateHipismo, services/hipismoResumenCliente.js).
  if (/^SELECT hipodromo_nombre, carrera_numero, fecha, pizarra, pool_total, pago_ganador, comision_total, comision_porcentaje, garantia, pago_fijo, hubo_ganador FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3 ORDER BY fecha DESC, creado_en ASC/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remates
      .filter(r => r.grupo_id === grupoId && r.fecha >= desde && r.fecha <= hasta)
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.creado_en - b.creado_en));
    return {
      rows: filas.map(r => ({
        hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero, fecha: r.fecha, pizarra: r.pizarra,
        pool_total: r.pool_total, pago_ganador: r.pago_ganador, comision_total: r.comision_total,
        comision_porcentaje: r.comision_porcentaje, garantia: r.garantia, pago_fijo: r.pago_fijo, hubo_ganador: r.hubo_ganador
      }))
    };
  }

  // GET /cierre-final: Jugadas Adelantadas de la semana (23-09-2026, ver
  // test_hipismo_adelantadas.js) — esta prueba no crea ninguna, siempre vacío.
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores/i.test(sql)) {
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
  return entrada[1][entrada[1].length - 1];
}
const handlerCalcular = handlerDe('post', '/remates/calcular');
const handlerGuardar = handlerDe('post', '/remates');
const handlerCierreFinal = handlerDe('get', '/cierre-final');
const handlerDetalleSemana = handlerDe('get', '/clientes/:nombre/detalle-semana');

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

// Mismo remate, pero con "GARANTIZA" en vez de "PAGANDO" — 26-09-2026, a
// pedido del usuario ("REMATE PAGA"/"REMATE GARANTIZA" son 2 modos
// distintos, nunca sinónimos): esto detecta el modo "piso + %" en vez
// del modo "monto fijo, sin %".
const REMATE_EJEMPLO_GARANTIZA = REMATE_EJEMPLO.replace('*PAGANDO  500$*', '*GARANTIZA 500$*');

function reqBase(grupoId) {
  return { grupoId, grupo: { nombre: 'Zenyatta' } };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) "REMATE PAGA": el caballo #2 (JUNKO) gana -> se paga EXACTO lo que dice "PAGANDO" ---
  const req1 = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: REMATE_EJEMPLO, hipodromoNombre: 'La Rinconada', carreraNumero: 5, fecha: '2026-09-21', comisionPorcentaje: 20, pizarra: '2.5.1' }
  });
  const res1 = await invocarRuta(handlerGuardar, req1);
  check(res1._status === 201, 'POST /api/hipismo/remates (REMATE PAGA, ganador real) responde 201');
  check(res1._json && Number(res1._json.remate.pool_total) === 670, 'pool_total = 670 (suma de los 8 montos)');
  check(Number(res1._json.remate.pago_ganador) === 500, 'pago_ganador = 500 (el monto EXACTO de "PAGANDO", sin tocar ningún %)');
  check(Number(res1._json.remate.comision_total) === 170, 'resultadoRemate = 170 (670 de pool - 500 pagados, a favor de la casa) -- ya NO es "comisión", es el ítem REMATE');
  check(res1._json.remate.hubo_ganador === true, 'hubo_ganador = true');
  check(res1._json.remate.cliente_ganador === 'JUNKO', 'cliente_ganador = JUNKO (jugó el #2, que ganó la carrera)');
  check(res1._json.advertenciaGarantiaNoAlcanza === false, 'advertenciaGarantiaNoAlcanza = false en modo REMATE PAGA (no aplica, no hay garantía)');
  const apuestaJunko = TABLAS.hipismo_remate_apuestas.find(a => a.cliente_nombre === 'JUNKO' && a.remate_id === res1._json.remate.id);
  check(apuestaJunko && Number(apuestaJunko.resultado) === 460, 'la línea de JUNKO queda en +460 (500 de pago - 40 que apostó)');
  const apuestaMujica = TABLAS.hipismo_remate_apuestas.find(a => a.cliente_nombre === 'MUJICA' && a.remate_id === res1._json.remate.id);
  check(apuestaMujica && Number(apuestaMujica.resultado) === -150, 'la línea de MUJICA (perdió) queda en -150 (lo que apostó)');
  check(TABLAS.jugadores.some(j => j.nombre === 'JUNKO'), 'JUNKO quedó auto-registrado en "jugadores" (cliente nuevo)');
  check(TABLAS.jugadores.some(j => j.nombre === 'TYKHE'), 'TYKHE quedó auto-registrado en "jugadores" (cliente nuevo)');
  check(typeof res1._json.textoResultado === 'string' && res1._json.textoResultado.includes('Junko'),
    'textoResultado menciona al ganador (Junko)');
  check(res1._json.textoResultado.includes('✅💰'), 'textoResultado marca la línea ganadora con ✅💰');
  check(res1._json.textoResultado.includes('PAGANDO') && res1._json.textoResultado.includes('500,00'), 'textoResultado (el plano) SÍ muestra cuánto paga (PAGANDO 500,00$)');
  check(!res1._json.textoResultado.includes('170'), 'textoResultado (el plano) NUNCA muestra el resultado del remate (170) -- eso es solo para la parte administrativa');

  // --- 2) Mismo remate, pero el número ganador de la carrera (9) no fue jugado -> "queda para la banca" (igual en los 3 modos) ---
  const req2 = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: REMATE_EJEMPLO, hipodromoNombre: 'La Rinconada', carreraNumero: 6, fecha: '2026-09-21', comisionPorcentaje: 20, pizarra: '9.5.1' }
  });
  const res2 = await invocarRuta(handlerGuardar, req2);
  check(res2._status === 201, 'POST /api/hipismo/remates ("banca") responde 201');
  check(res2._json.remate.hubo_ganador === false, 'hubo_ganador = false (el #9 no fue jugado por nadie)');
  check(Number(res2._json.remate.pago_ganador) === 0, 'pago_ganador = 0 (nadie gana)');
  check(Number(res2._json.remate.comision_total) === 670, 'resultadoRemate = pool completo (670) -- no se paga nada cuando queda para la banca, sin importar el modo');
  const todasLasLineas = TABLAS.hipismo_remate_apuestas.filter(a => a.remate_id === res2._json.remate.id);
  check(todasLasLineas.every(a => Number(a.resultado) < 0), 'TODAS las líneas quedan negativas (todos pierden lo apostado)');
  check(res2._json.textoResultado.includes('quedó todo para la banca'), 'textoResultado avisa que quedó para la banca');

  // --- 3) "REMATE GARANTIZA": se preserva el piso + % de siempre (semana distinta, no interfiere con Cierre Final del caso 7) ---
  const req3 = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: REMATE_EJEMPLO_GARANTIZA, hipodromoNombre: 'La Rinconada', carreraNumero: 5, fecha: '2026-09-14', comisionPorcentaje: 20, pizarra: '2.5.1' }
  });
  const res3 = await invocarRuta(handlerGuardar, req3);
  check(res3._status === 201, 'POST /api/hipismo/remates (REMATE GARANTIZA) responde 201');
  check(Number(res3._json.remate.pago_ganador) === 536, 'pago_ganador = 536 (670*0.8, alcanza de sobra la garantía de 500 -> NO se paga la garantía)');
  check(Number(res3._json.remate.comision_total) === 134, 'resultadoRemate = 134 (670 - 536, el 20% completo -- la "ganancia de la casa")');
  check(res3._json.advertenciaGarantiaNoAlcanza === false, 'advertenciaGarantiaNoAlcanza = false (500 de garantía sí lo cubre el pool de 670)');

  // --- 4) "REMATE GARANTIZA" cuando ni vendiendo el pool completo (0% de comisión) alcanza para la garantía ---
  const req4Adv = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: REMATE_EJEMPLO_GARANTIZA, hipodromoNombre: 'La Rinconada', carreraNumero: 6, fecha: '2026-09-14', comisionPorcentaje: 0, garantia: 5000, pizarra: '2.5.1' }
  });
  const res4Adv = await invocarRuta(handlerGuardar, req4Adv);
  check(res4Adv._status === 201, 'POST /api/hipismo/remates (garantía imposible de cubrir) responde 201 igual -- se guarda, solo avisa');
  check(Number(res4Adv._json.remate.pago_ganador) === 5000, 'pago_ganador = 5000 (se paga la garantía completa aunque el pool no la cubra)');
  check(Number(res4Adv._json.remate.comision_total) === -4330, 'resultadoRemate = -4330 (670 de pool - 5000 pagados) -- queda NEGATIVO en el ítem REMATE');
  check(res4Adv._json.advertenciaGarantiaNoAlcanza === true, 'advertenciaGarantiaNoAlcanza = true (la garantía de 5000 es mayor que el pool de 670, ni al 0% de comisión alcanza)');

  // --- 5) "Remate Paga" y "Remate Garantiza" nunca pueden venir juntos ---
  const req5 = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: REMATE_EJEMPLO, hipodromoNombre: 'La Rinconada', carreraNumero: 7, fecha: '2026-09-14', comisionPorcentaje: 20, pagoFijo: 50, garantia: 100, pizarra: '2.5.1' }
  });
  const res5 = await invocarRuta(handlerCalcular, req5);
  check(res5._status === 400, 'POST /api/hipismo/remates/calcular con "Remate Paga" y "Remate Garantiza" juntos responde 400');
  check(/Remate Paga.*Remate Garantiza/i.test(res5._json.error || ''), 'el mensaje de error explica que no pueden venir los 2 juntos');

  // --- 6) POST /remates/calcular sin llegada disponible (ni manual ni de un plano ya cargado) ---
  const req6 = Object.assign(reqBase(GRUPO_ID), {
    body: { texto: REMATE_EJEMPLO, hipodromoNombre: 'Valencia', carreraNumero: 9, fecha: '2026-09-22', comisionPorcentaje: 20 }
  });
  const res6 = await invocarRuta(handlerCalcular, req6);
  check(res6._status === 200, 'POST /api/hipismo/remates/calcular sin llegada responde 200 (no es un error, solo falta un dato)');
  check(res6._json.necesitaLlegada === true, 'necesitaLlegada: true cuando no hay plano previo ni llegada manual');
  check(res6._json.poolTotal === 670, 'igual devuelve el poolTotal ya calculado, para que el admin pueda revisar el remate mientras completa la llegada');

  // --- 6b) Guardar sin llegada disponible -> 400, no debe guardar nada ---
  const cantidadRematesAntes = TABLAS.hipismo_remates.length;
  const res6b = await invocarRuta(handlerGuardar, req6);
  check(res6b._status === 400, 'POST /api/hipismo/remates sin llegada disponible responde 400');
  check(TABLAS.hipismo_remates.length === cantidadRematesAntes, 'no se guardó ningún remate nuevo cuando falta la llegada');

  // --- 6c) Si ya hay un plano cargado para ese hipódromo+carrera+fecha, la llegada se toma sola de ahí ---
  TABLAS.hipismo_planos.push({ grupo_id: GRUPO_ID, hipodromo_nombre: 'Valencia', carrera_numero: 9, fecha: '2026-09-22', pizarra: '3.1.2', creado_en: Date.now() });
  const res6c = await invocarRuta(handlerCalcular, req6);
  check(res6c._json.necesitaLlegada === false, 'con un plano ya cargado de esa carrera, ya no hace falta pedir la llegada');
  check(res6c._json.origenPizarra === 'plano_existente', 'origenPizarra indica que se tomó del plano ya guardado');
  check(res6c._json.numeroGanador === 3, 'el número ganador se toma del primer lugar de la pizarra del plano (3.1.2 -> ganó el 3)');
  check(res6c._json.hayGanador === true, 'el #3 (REY JOAQUIN) sí fue jugado en el remate -> MR INCREIBLE gana');

  // --- 7) GET /cierre-final: los remates YA guardados en la semana del 21-27 de sept (casos 1 y 2) entran al saldo semanal e ítem "REMATE" ---
  const req7 = Object.assign(reqBase(GRUPO_ID), { query: {} });
  // rangoSemana()/hoyVenezuela() usan la fecha REAL de hoy -- para que la
  // prueba no dependa del día en que se corre, se pisa temporalmente
  // Date.now() para que "hoy" caiga en la misma semana que 2026-09-21
  // (lunes 21 de septiembre de 2026). Los remates de los casos 3 y 4
  // (14-09-2026) quedan a propósito en la semana ANTERIOR, para no
  // mezclarse con estas cuentas.
  const OriginalDate = Date;
  const fechaFalsa = new OriginalDate('2026-09-23T12:00:00Z').getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { if (args.length === 0) { super(fechaFalsa); } else { super(...args); } }
    static now() { return fechaFalsa; }
  };
  let res7, res8;
  try {
    res7 = await invocarRuta(handlerCierreFinal, req7);
    // --- 8) GET /clientes/REMATE/detalle-semana: detalle de esos mismos 2 remates ---
    const reqDetalle = Object.assign(reqBase(GRUPO_ID), { params: { nombre: 'REMATE' }, query: {} });
    res8 = await invocarRuta(handlerDetalleSemana, reqDetalle);
  } finally {
    global.Date = OriginalDate;
  }
  check(res7._status === 200, 'GET /api/hipismo/cierre-final responde 200');
  // 23-09-2026 (duodécima-tercera ronda, a pedido del usuario: "...y
  // semana xxx... que seria la semana del año en la que estamos") — la
  // semana lunes 21 al domingo 27 de septiembre de 2026 es la semana
  // ISO-8601 número 39 de 2026 (ver services/fechaSemana.js).
  check(!!res7._json.numeroSemana, 'GET /cierre-final ahora también trae numeroSemana');
  check(res7._json.numeroSemana && res7._json.numeroSemana.anio === 2026 && res7._json.numeroSemana.semana === 39, 'numeroSemana calcula bien la semana 39 de 2026 para el lunes 21 al domingo 27 de septiembre');
  // JUNKO jugó el caballo #2 en LOS 2 remates de esta semana (mismo texto
  // de ejemplo reusado): en el primero ganó (+460, modo REMATE PAGA), en
  // el segundo ("banca", el #9 no fue jugado por nadie) perdió su
  // apuesta al #2 (-40) -> saldo semanal = 460 - 40 = 420, con 2 jugadas.
  const junkoCierre = res7._json.clientes.find(c => c.nombre === 'JUNKO');
  check(junkoCierre && Number(junkoCierre.saldo) === 420, 'JUNKO aparece en Cierre Final con saldo +420 (ganó 460 en el remate "REMATE PAGA", perdió 40 en el de la banca)');
  check(junkoCierre && junkoCierre.jugadas === 2, 'a JUNKO le cuentan 2 jugadas (una línea de remate en cada uno de los 2 remates de esta semana)');
  const tykheCierre = res7._json.clientes.find(c => c.nombre === 'TYKHE');
  // TYKHE aparece en los 2 remates: perdió 220 en el primero (3 caballos:
  // 60+80+80) y perdió 220 de nuevo en el segundo ("banca") -> -440 total.
  check(tykheCierre && Number(tykheCierre.saldo) === -440, 'TYKHE acumula -440 entre los 2 remates de esta semana (perdió sus 3 caballos en cada uno)');
  check(Number(res7._json.comisionRemateSemana) === (170 + 670), 'comisionRemateSemana (dato crudo, ya no se muestra como "comisión") suma 170 + 670 = 840 de los 2 remates de esta semana');
  check(Number(res7._json.comisionSemana) === 0, 'comisionSemana (la de "Cargar Planos", 5% por carrera) queda en 0 -- no se mezcla con la de Remate');
  // Ítem "REMATE" (26-09-2026, a pedido del usuario): el resultado de los
  // remates aparece como su PROPIO cliente en la lista, nunca sumado a
  // la comisión -- 170 + 670 = 840, positivo (a favor de la casa esta semana).
  const remateItem = res7._json.clientes.find(c => c.nombre === 'REMATE');
  check(!!remateItem, 'el ítem "REMATE" aparece en la lista de clientes de Cierre Final, como si fuera otro cliente más');
  check(remateItem && Number(remateItem.saldo) === 840, 'el ítem "REMATE" tiene saldo +840 (170 del remate "REMATE PAGA" + 670 del que quedó para la banca)');

  check(res8._status === 200, 'GET /api/hipismo/clientes/REMATE/detalle-semana responde 200 (nunca 404, aunque REMATE no sea un jugador real)');
  check(res8._json.jugador && res8._json.jugador.nombre === 'REMATE', 'el detalle identifica al "jugador" como REMATE');
  check(Number(res8._json.resumen.totalSemana) === 840, 'el resumen semanal del detalle también suma 840 (170 + 670)');
  check(res8._json.resumen.cantidadJugadas === 2, 'cuenta 2 remates esta semana (uno por cada carrera guardada)');
  check(Array.isArray(res8._json.dias) && res8._json.dias.length === 1, 'los 2 remates cayeron el mismo día (2026-09-21) -> un solo día en el detalle');
  const diaDetalle = res8._json.dias[0];
  check(diaDetalle && diaDetalle.fecha === '2026-09-21', 'el día del detalle es 2026-09-21');
  const hipDetalle = diaDetalle && diaDetalle.hipodromos.find(h => h.nombre === 'La Rinconada');
  check(hipDetalle && hipDetalle.carreras.length === 2, 'La Rinconada trae las 2 carreras del remate (5 y 6) detalladas');
  const carrera5Detalle = hipDetalle && hipDetalle.carreras.find(c => c.carrera === 5);
  check(carrera5Detalle && carrera5Detalle.modo === 'paga' && Number(carrera5Detalle.resultado) === 170, 'la carrera 5 (REMATE PAGA) queda con modo "paga" y resultado 170');
  const carrera6Detalle = hipDetalle && hipDetalle.carreras.find(c => c.carrera === 6);
  check(carrera6Detalle && Number(carrera6Detalle.resultado) === 670 && carrera6Detalle.huboGanador === false, 'la carrera 6 ("banca") queda con resultado 670 y huboGanador false');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Cargar Remate se cayó con una excepción:', e);
  process.exit(1);
});
