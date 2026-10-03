// =================================================================
// PRUEBA: construirResumenClienteHipismo() con una CUENTA DE COMISIÓN
// (26-09-2026, a pedido del usuario: "LOS LINK DE % NO DAN SALDO DICEN
// 0") — hasta este arreglo, el link/detalle de un cliente
// "{nombre} - PORCENTAJE" (jugadores.es_cuenta_comision=true) siempre
// mostraba saldo 0 porque construirResumenClienteHipismo solo buscaba
// jugadas donde cliente_nombre/banquero_nombre = el nombre de la cuenta,
// y una cuenta de comisión nunca tiene jugadas propias.
//
// Esta prueba cubre la nueva rama (construirResumenCuentaComisionHipismo,
// services/hipismoResumenCliente.js) con el mismo patrón de base de
// datos falsa que test_hipismo_resumen_cliente.js, agregando las tablas
// "jugadores" (para resolver % propio/de aval, ver
// services/hipismoComisionPropia.js) y "hipismo_comisiones_ajustes"
// (Traspasos de Comisión).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

// FECHA dinámica (28-09-2026, arreglo de la prueba que quedaba flaky con el
// tiempo: antes usaba una fecha fija '2026-09-24', que dejó de caer dentro
// de "la semana actual" apenas pasó esa semana calendario, haciendo que
// TODAS las jugadas de este archivo quedaran fuera del rango desde/hasta
// que calcula construirResumenCuentaComisionHipismo con semana:'actual' —
// mismo criterio que ya usa test_superadmin_balance_y_sabana.js (FECHA_HOY)
// para no repetir este mismo problema.
function formatearFechaISOLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mes + '-' + dia;
}

const TABLAS = {
  jugadores: [],
  jugadores_avales_porcentaje: [],
  hipismo_tickets: [],
  hipismo_planos: [],
  hipismo_hipodromos: [],
  hipismo_remate_apuestas: [],
  hipismo_remates: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_adelantadas_planos: [],
  hipismo_winners: [],
  hipismo_comisiones_ajustes: [],
  tickets_historial: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  // --- Candidatos: clientes reales cuyo % resuelve a ESTA cuenta puntual
  //     (construirResumenCuentaComisionHipismo, services/hipismoResumenCliente.js).
  //     28-09-2026: comision_propia ahora SIEMPRE es para el propio cliente,
  //     y el % de aval pasó a la tabla jugadores_avales_porcentaje (varios
  //     avaladores por cliente) — ver la nota grande de esa tabla en
  //     sql/schema.sql.
  if (/^SELECT j\.nombre\s+FROM jugadores j\s+WHERE j\.grupo_id = \$1/i.test(sql)) {
    const [grupoId, cuentaId] = params;
    const delGrupo = TABLAS.jugadores.filter(j => j.grupo_id === grupoId);
    const rows = delGrupo.filter(j => {
      if (j.es_cuenta_comision) return false;
      const cond1 = j.cuenta_comision_id === cuentaId && (Number(j.comision_propia) || 0) > 0;
      // 02-10-2026: cond2 ya NO pasa por avalador.cuenta_comision_id (esa
      // indirección doble quedó eliminada) -- ahora jap.avalador_id YA ES
      // directamente la ficha elegida por el operador, así que basta
      // comparar avalador_id contra cuentaId.
      const cond2 = TABLAS.jugadores_avales_porcentaje.some(a => {
        if (a.jugador_id !== j.id || !(Number(a.porcentaje) > 0)) return false;
        return a.avalador_id === cuentaId;
      });
      return cond1 || cond2;
    }).map(j => ({ nombre: j.nombre }));
    return { rows };
  }

  // --- obtenerComisionesPropias (services/hipismoComisionPropia.js) ---
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const delGrupo = TABLAS.jugadores.filter(j => j.grupo_id === grupoId);
    const porId = new Map(delGrupo.map(j => [j.id, j]));
    const rows = delGrupo.filter(j => nombres.includes(j.nombre)).map(j => {
      const ccPropio = j.cuenta_comision_id ? porId.get(j.cuenta_comision_id) : null;
      return { id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: ccPropio ? ccPropio.nombre : null };
    });
    return { rows };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    const [grupoId, idsJugadores] = params;
    const porId = new Map(TABLAS.jugadores.map(j => [j.id, j]));
    const rows = TABLAS.jugadores_avales_porcentaje
      .filter(a => a.grupo_id === grupoId && idsJugadores.includes(a.jugador_id))
      .map(a => {
        const avalador = porId.get(a.avalador_id);
        const ccAval = avalador && avalador.cuenta_comision_id ? porId.get(avalador.cuenta_comision_id) : null;
        return { jugador_id: a.jugador_id, porcentaje: a.porcentaje, avalador_nombre: avalador ? avalador.nombre : null, cc_avalador_nombre: ccAval ? ccAval.nombre : null };
      });
    return { rows };
  }

  // --- Traspasos de Comisión (hipismo_comisiones_ajustes) ---
  if (/^SELECT monto, fecha, nota FROM hipismo_comisiones_ajustes/i.test(sql)) {
    const [grupoId, clienteNombre, desde, hasta] = params;
    const rows = TABLAS.hipismo_comisiones_ajustes
      .filter(a => a.grupo_id === grupoId && a.cliente_nombre === clienteNombre && a.fecha >= desde && a.fecha <= hasta)
      .map(a => ({ monto: a.monto, fecha: a.fecha, nota: a.nota || null }));
    return { rows };
  }

  // --- Tercios (obtenerLineasHipismoCliente) ---
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre))
      .map(t => ({ t, plano: TABLAS.hipismo_planos.find(p => p.id === t.plano_id) }))
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta);
    return {
      rows: filas.map(({ t, plano }) => {
        const hip = TABLAS.hipismo_hipodromos.find(h => h.id === plano.hipodromo_id);
        return {
          cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad,
          caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero,
          fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre, carrera_numero: plano.carrera_numero,
          pizarra: plano.pizarra, pais: hip ? hip.pais : null
        };
      })
    };
  }
  // --- Tickets crudos para el neteo jugador/banquero por carrera
  //     (03-10-2026, netearJugadorBanqueroTercios -- ver la nota grande de
  //     construirResumenCuentaComisionHipismo en
  //     services/hipismoResumenCliente.js, caso "GG juega y banquea en la
  //     MISMA carrera") ---
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero,\s*t\.sin_comision, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre))
      .map(t => ({ t, plano: TABLAS.hipismo_planos.find(p => p.id === t.plano_id) }))
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta);
    return {
      rows: filas.map(({ t, plano }) => ({
        cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre,
        resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero,
        sin_comision: t.sin_comision, fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre,
        carrera_numero: plano.carrera_numero
      }))
    };
  }
  // --- Remate ---
  if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId && a.cliente_nombre === nombre)
      .map(a => ({ a, remate: TABLAS.hipismo_remates.find(r => r.id === a.remate_id) }))
      .filter(({ remate }) => remate && remate.fecha >= desde && remate.fecha <= hasta);
    return {
      rows: filas.map(({ a, remate }) => ({
        caballo: a.caballo, numero_ejemplar: a.numero_ejemplar, monto: a.monto, resultado: a.resultado,
        fecha: remate.fecha, hipodromo_nombre: remate.hipodromo_nombre, carrera_numero: remate.carrera_numero,
        pizarra: remate.pizarra, numero_ganador: remate.numero_ganador, pais: null
      }))
    };
  }
  // --- Adelantadas ---
  if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const estadosValidos = ['resuelto', 'falta_banqueo', 'sin_decidir'];
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && estadosValidos.includes(j.estado))
      .filter(j => j.cliente_nombre === nombre || (Array.isArray(j.banqueadores) && j.banqueadores.some(b => b.nombre === nombre)))
      .map(j => ({ j, plano: TABLAS.hipismo_adelantadas_planos.find(p => p.id === j.plano_id) }))
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta);
    return {
      rows: filas.map(({ j, plano }) => ({
        tipo: j.tipo, cliente_nombre: j.cliente_nombre, carrera_numero: j.carrera_numero,
        cantidad_tf: j.cantidad_tf, numero_ejemplar: j.numero_ejemplar, numero1: j.numero1, numero2: j.numero2,
        monto: j.monto, resultado_cliente: j.resultado_cliente, banqueadores: j.banqueadores, pizarra_usada: j.pizarra_usada,
        fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre, pais: null
      }))
    };
  }
  // --- Winners ---
  if (/^SELECT w\.caballo, w\.monto, w\.fecha, w\.hipodromo_nombre, w\.carrera_numero, h\.pais/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_winners
      .filter(w => w.grupo_id === grupoId && w.cliente_nombre === nombre && w.fecha >= desde && w.fecha <= hasta);
    return {
      rows: filas.map(w => ({
        caballo: w.caballo, monto: w.monto, fecha: w.fecha, hipodromo_nombre: w.hipodromo_nombre,
        carrera_numero: w.carrera_numero, pais: null
      }))
    };
  }
  // --- Deportes anclado (leerHistorial) ---
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros\s+FROM tickets_historial/i.test(sql)) {
    const [grupoId, desde, hasta, cliente] = params;
    const filas = TABLAS.tickets_historial.filter(t =>
      t.grupo_id === grupoId && t.fecha >= desde && t.fecha <= hasta && t.cliente_nombre === cliente);
    return { rows: filas };
  }

  throw new Error('La base de datos falsa de esta prueba (resumen-cuenta-comision) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';

const { construirResumenClienteHipismo } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoResumenCliente'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// round2 local, solo para armar los montos esperados de este archivo de
// prueba (no reusa el de producción a propósito, para no "probar contra
// sí mismo").
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

(async function main() {
  const GRUPO_ID = 'grupo-comision-1';
  const grupo = { nombre: 'Zenyatta', logo_url: 'https://ejemplo.com/logo.png', modulo_deportes_habilitado: true };
  const FECHA = formatearFechaISOLocal(new Date());

  TABLAS.hipismo_hipodromos.push({ id: 'hip-1', pais: 'VE' });
  TABLAS.hipismo_planos.push({ id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 5, fecha: FECHA, pizarra: '3.9.5' });

  // --- PEDRO: % propio del 1%, sin avalador — cuenta "PEDRO - PORCENTAJE" ---
  TABLAS.jugadores.push({
    id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 1,
    cuenta_comision_id: 'cta-pedro', es_cuenta_comision: false
  });
  TABLAS.jugadores.push({
    id: 'cta-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO - PORCENTAJE', comision_propia: 0,
    cuenta_comision_id: null, es_cuenta_comision: true
  });

  // Tercios: PEDRO pierde 100 (decidido 100) — SIEMPRE positivo, aunque
  // PEDRO pierda su jugada (ver la nota grande de agregarPorcentajeDevuelto).
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCO', modalidad: '1/2', caballo: '3', monto: 100, resultado_jugador: -100, resultado_banquero: 95 });
  // Tercios: PEDRO gana 76 (decidido 76/0.95 = 80) — también cuenta, gane o
  // pierda.
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCO', modalidad: '9x2', caballo: '9', monto: 80, resultado_jugador: 76, resultado_banquero: -76 });
  // Tercios: PEDRO como BANQUERO de OTRO, EN LA MISMA CARRERA (carrera 5,
  // plano-1) — 29-09-2026 (caso real "Mrincreible"): esto AHORA SÍ genera %
  // (a diferencia de antes de esa ronda, "nunca lo que banqueó"). Y, desde
  // el 03-10-2026 (ver la nota grande de construirResumenCuentaComisionHipismo
  // en services/hipismoResumenCliente.js), como PEDRO juega (2 tickets) Y
  // banquea (este ticket) en la MISMA carrera, las 3 posiciones se NETEAN
  // en una sola: decididoJugador = 100+80 = 180, decididoBanquero = 28.5/0.95
  // = 30, neto = |180-30| = 150 → 1% = 1.50 (nunca 1.00+0.80+0.30=2.10 por
  // separado, la misma regla del caso "GG" aplicada acá).
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'OTRO', banquero_nombre: 'PEDRO', modalidad: '1/2', caballo: '5', monto: 30, resultado_jugador: -30, resultado_banquero: 28.5 });

  // Remate: PEDRO apuesta 60 → 1% de 60 = 0.60.
  TABLAS.hipismo_remates.push({ id: 'remate-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 6, fecha: FECHA, pizarra: '3.9.5', numero_ganador: 3 });
  TABLAS.hipismo_remate_apuestas.push({ remate_id: 'remate-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', caballo: 'Relámpago', numero_ejemplar: 3, monto: 60, resultado: 54 });

  // Winners: PEDRO gana 200 — NUNCA genera % (no tiene "monto apostado",
  // ver la nota grande de agregarPorcentajeDevuelto).
  TABLAS.hipismo_winners.push({ grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', caballo: '7', monto: 200, fecha: FECHA, hipodromo_nombre: 'La Rinconada', carrera_numero: 7 });

  // Traspaso de Comisión: -0.50 sale de la cuenta de PEDRO esa misma semana.
  TABLAS.hipismo_comisiones_ajustes.push({ grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO - PORCENTAJE', monto: -0.50, fecha: FECHA, nota: 'Ajuste manual de prueba' });

  const cuentaPedro = { id: 'cta-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO - PORCENTAJE', es_cuenta_comision: true, modulos_anclados: false };
  const resumenPedro = await construirResumenClienteHipismo(cuentaPedro, grupo, 'actual');

  // 26-09-2026, a pedido del usuario ("LOS REMATES NO LE PRODUCEN % DE
  // DEVOLUCION A LOS CLIENTES"): el 0.60 de Remate YA NO entra acá. Winners
  // tampoco (no tiene "monto apostado"). 03-10-2026: las 3 posiciones de
  // Tercios de PEDRO en la carrera 5 (jugó 2 tickets, banqueó 1) quedan
  // NETEADAS en una sola comisión de 1.50 (ver la nota grande junto a esos
  // tickets, arriba) en vez de sumarse por separado (1.00+0.80+0.30=2.10).
  const esperadoPedro = round2(1.50 - 0.50);
  check(resumenPedro.resumen.totalSemana === esperadoPedro,
    `El saldo de "PEDRO - PORCENTAJE" ya NO es 0 — 1%% sobre el NETO de lo que PEDRO jugó Y banqueó en la carrera 5 (nunca sobre la suma de las 2 posiciones por separado), más el traspaso: ${esperadoPedro} (obtenido: ${resumenPedro.resumen.totalSemana})`);
  check(resumenPedro.modulos.hipismo === true && resumenPedro.modulos.deportes === false,
    'Una cuenta de comisión nunca trae Deportes anclado');
  check(resumenPedro.jugador.nombre === 'PEDRO - PORCENTAJE', 'El resumen trae el nombre de la cuenta, no el del cliente real');

  const diaPedro = resumenPedro.dias.find(d => d.fecha === FECHA);
  check(!!diaPedro, 'Trae el día agrupado');
  const hipPedro = diaPedro.hipodromos.find(h => h.nombre === 'La Rinconada');
  const comisionesPedro = hipPedro ? hipPedro.carreras.filter(c => c.tipo === 'comision') : [];
  check(comisionesPedro.length === 1 && comisionesPedro[0].origenTipo === 'tercios-neto',
    `Las 3 posiciones de Tercios de PEDRO en la carrera 5 (jugó+jugó+banqueó) se netean en UNA sola línea "tercios-neto" -- el Remate (60 apostado) sigue sin contar para la cuenta de comisión (líneas obtenidas: ${comisionesPedro.length})`);
  check(hipPedro.carreras.every(c => c.tipo !== 'comision' || c.clienteOrigen === 'PEDRO'),
    'Cada línea de comisión trae quién la generó (clienteOrigen)');
  const bloqueTraspasos = diaPedro.hipodromos.find(h => h.tipo === 'traspaso');
  check(!!bloqueTraspasos && bloqueTraspasos.carreras.length === 1 && bloqueTraspasos.carreras[0].resultado === -0.50,
    'El Traspaso de Comisión aparece en su propio bloque "Traspasos de Comisión", separado de las jugadas');

  // --- LUIS/MARIA (28-09-2026, modelo nuevo: comision_propia SIEMPRE es
  //     para el propio cliente, "porcentaje_devuelto_destino" ya no
  //     existe): LUIS genera su propio % (2%, cae en SU cuenta "LUIS -
  //     PORCENTAJE") Y, POR SEPARADO Y SIMULTÁNEO, un % adicional (1%)
  //     para su avaladora MARIA (jugadores_avales_porcentaje) — 2 destinos
  //     DISTINTOS sobre la MISMA jugada, cada uno a su propia cuenta. ---
  TABLAS.jugadores.push({
    id: 'j-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', comision_propia: 0,
    cuenta_comision_id: 'cta-maria', es_cuenta_comision: false
  });
  TABLAS.jugadores.push({
    id: 'cta-maria', grupo_id: GRUPO_ID, nombre: 'MARIA - PORCENTAJE', comision_propia: 0,
    cuenta_comision_id: null, es_cuenta_comision: true
  });
  TABLAS.jugadores.push({
    id: 'j-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 2,
    cuenta_comision_id: 'cta-luis', es_cuenta_comision: false
  });
  TABLAS.jugadores.push({
    id: 'cta-luis', grupo_id: GRUPO_ID, nombre: 'LUIS - PORCENTAJE', comision_propia: 0,
    cuenta_comision_id: null, es_cuenta_comision: true
  });
  // 02-10-2026: avalador_id ya ES directamente la ficha elegida por el
  // operador al configurar este aval -- acá el operador escribió "MARIA -
  // PORCENTAJE" (la cuenta dedicada ya existente), no "MARIA" a secas, así
  // que avalador_id apunta a 'cta-maria', no a 'j-maria'.
  TABLAS.jugadores_avales_porcentaje.push({ grupo_id: GRUPO_ID, jugador_id: 'j-luis', avalador_id: 'cta-maria', porcentaje: 1 });
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'LUIS', banquero_nombre: 'BANCO', modalidad: '1/2', caballo: '3', monto: 100, resultado_jugador: 95, resultado_banquero: -95 });

  const cuentaMaria = { id: 'cta-maria', grupo_id: GRUPO_ID, nombre: 'MARIA - PORCENTAJE', es_cuenta_comision: true, modulos_anclados: false };
  const resumenMaria = await construirResumenClienteHipismo(cuentaMaria, grupo, 'actual');

  const esperadoMaria = round2(1.00);
  check(resumenMaria.resumen.totalSemana === esperadoMaria,
    `El saldo de "MARIA - PORCENTAJE" solo trae el 1%% que LUIS le genera como avaladora (el 2%% propio de LUIS ya NO cae acá, cae en la cuenta de LUIS): ${esperadoMaria} (obtenido: ${resumenMaria.resumen.totalSemana})`);
  const diaMaria = resumenMaria.dias.find(d => d.fecha === FECHA);
  const hipMaria = diaMaria.hipodromos.find(h => h.nombre === 'La Rinconada');
  check(hipMaria.carreras.filter(c => c.tipo === 'comision').length === 1,
    'La jugada de LUIS genera exactamente 1 línea de comisión dentro de la cuenta de MARIA (la del avalador, no la propia)');
  check(hipMaria.carreras.every(c => c.clienteOrigen === 'LUIS'), 'La línea identifica a LUIS como quien la generó');

  const cuentaLuis = { id: 'cta-luis', grupo_id: GRUPO_ID, nombre: 'LUIS - PORCENTAJE', es_cuenta_comision: true, modulos_anclados: false };
  const resumenLuis = await construirResumenClienteHipismo(cuentaLuis, grupo, 'actual');
  check(resumenLuis.resumen.totalSemana === round2(2.00),
    `El saldo de "LUIS - PORCENTAJE" trae su propio 2%% (comision_propia SIEMPRE es para el propio cliente): esperado 2, obtenido ${resumenLuis.resumen.totalSemana}`);

  // --- GG (03-10-2026, caso real que reportó el usuario: "al abrir el
  //     cliente me da un saldo completamente distinto" -- la cuenta de
  //     comisión "Agregados soy ganador" cobraba % por separado sobre el
  //     lado jugador Y el lado banquero de GG cuando coincidían en la
  //     MISMA carrera, en vez de sobre el neto. GG juega y pierde 100 en
  //     la carrera 5 (plano-1) -- decidido 100 -- Y banquea a OTRO2 en esa
  //     MISMA carrera, perdiendo 60 como banquero -- decidido 60. Neto =
  //     |100 - 60| = 40. Con 1%% propio, el devuelto correcto es 0.40, NUNCA
  //     1.00 + 0.60 = 1.60 (que es lo que daba antes de este arreglo). ---
  TABLAS.jugadores.push({
    id: 'j-gg', grupo_id: GRUPO_ID, nombre: 'GG', comision_propia: 1,
    cuenta_comision_id: 'cta-gg', es_cuenta_comision: false
  });
  TABLAS.jugadores.push({
    id: 'cta-gg', grupo_id: GRUPO_ID, nombre: 'GG - PORCENTAJE', comision_propia: 0,
    cuenta_comision_id: null, es_cuenta_comision: true
  });
  // Ticket A: GG juega y pierde 100 (decidido = 100).
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'BANCOX', modalidad: '1/2', caballo: '4', monto: 100, resultado_jugador: -100, resultado_banquero: 95 });
  // Ticket B, MISMA carrera: GG banquea a OTRO2, que gana -- GG pierde 60
  // como banquero (decidido = 60).
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'OTRO2', banquero_nombre: 'GG', modalidad: '9x2', caballo: '6', monto: 60, resultado_jugador: 60, resultado_banquero: -60 });

  const cuentaGG = { id: 'cta-gg', grupo_id: GRUPO_ID, nombre: 'GG - PORCENTAJE', es_cuenta_comision: true, modulos_anclados: false };
  const resumenGG = await construirResumenClienteHipismo(cuentaGG, grupo, 'actual');

  const esperadoGG = round2(Math.abs(100 - 60) * 0.01);
  check(resumenGG.resumen.totalSemana === esperadoGG,
    `GG jugó Y banqueó en la MISMA carrera -- el 1%% debe cobrarse sobre el NETO (|100-60|=40 → 0.40), nunca sobre la suma de las 2 posiciones por separado (1.60): esperado ${esperadoGG}, obtenido ${resumenGG.resumen.totalSemana}`);
  const diaGG = resumenGG.dias.find(d => d.fecha === FECHA);
  const hipGG = diaGG.hipodromos.find(h => h.nombre === 'La Rinconada');
  const comisionesGG = hipGG.carreras.filter(c => c.tipo === 'comision');
  check(comisionesGG.length === 1,
    `El neteo colapsa las 2 posiciones de GG en esa carrera en UNA sola línea de comisión, no 2 (obtenidas: ${comisionesGG.length})`);
  check(comisionesGG[0] && comisionesGG[0].origenTipo === 'tercios-neto',
    'La línea neteada queda marcada como "tercios-neto" para que la UI avise que es un neto jugador+banquero');

  // --- Regresión: una cuenta de comisión sin ningún cliente real
  //     apuntándole (recién creada) da saldo 0 limpio, sin explotar. ---
  TABLAS.jugadores.push({
    id: 'cta-huerfana', grupo_id: GRUPO_ID, nombre: 'HUERFANO - PORCENTAJE', comision_propia: 0,
    cuenta_comision_id: null, es_cuenta_comision: true
  });
  const cuentaHuerfana = { id: 'cta-huerfana', grupo_id: GRUPO_ID, nombre: 'HUERFANO - PORCENTAJE', es_cuenta_comision: true, modulos_anclados: false };
  const resumenHuerfano = await construirResumenClienteHipismo(cuentaHuerfana, grupo, 'actual');
  check(resumenHuerfano.resumen.totalSemana === 0 && resumenHuerfano.dias.length === 0,
    'Una cuenta de comisión sin ningún cliente real enlazado da saldo 0 limpio (sin días), no truena');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de resumen de cuenta de comisión se cayó con una excepción:', e);
  process.exit(1);
});
