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

const TABLAS = {
  jugadores: [],
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
  if (/^SELECT j\.nombre\s+FROM jugadores j\s+LEFT JOIN jugadores av ON av\.id = j\.avalado_por_id\s+WHERE j\.grupo_id = \$1/i.test(sql)) {
    const [grupoId, cuentaId] = params;
    const delGrupo = TABLAS.jugadores.filter(j => j.grupo_id === grupoId);
    const porId = new Map(delGrupo.map(j => [j.id, j]));
    const rows = delGrupo.filter(j => {
      if (j.es_cuenta_comision) return false;
      const av = j.avalado_por_id ? porId.get(j.avalado_por_id) : null;
      const destinoCliente = (j.porcentaje_devuelto_destino || 'cliente') === 'cliente';
      const cond1 = destinoCliente && j.cuenta_comision_id === cuentaId && (Number(j.comision_propia) || 0) > 0;
      const cond2 = !destinoCliente && av && av.cuenta_comision_id === cuentaId && (Number(j.comision_propia) || 0) > 0;
      const cond3 = !!av && av.cuenta_comision_id === cuentaId && (Number(j.porcentaje_devuelto_aval) || 0) > 0;
      return cond1 || cond2 || cond3;
    }).map(j => ({ nombre: j.nombre }));
    return { rows };
  }

  // --- obtenerComisionesPropias (services/hipismoComisionPropia.js) ---
  if (/^SELECT j\.nombre, j\.comision_propia, j\.porcentaje_devuelto_destino, j\.porcentaje_devuelto_aval, av\.nombre AS aval_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const delGrupo = TABLAS.jugadores.filter(j => j.grupo_id === grupoId);
    const porId = new Map(delGrupo.map(j => [j.id, j]));
    const rows = delGrupo.filter(j => nombres.includes(j.nombre)).map(j => {
      const av = j.avalado_por_id ? porId.get(j.avalado_por_id) : null;
      const ccPropio = j.cuenta_comision_id ? porId.get(j.cuenta_comision_id) : null;
      const ccAval = av && av.cuenta_comision_id ? porId.get(av.cuenta_comision_id) : null;
      return {
        nombre: j.nombre,
        comision_propia: j.comision_propia,
        porcentaje_devuelto_destino: j.porcentaje_devuelto_destino,
        porcentaje_devuelto_aval: j.porcentaje_devuelto_aval,
        aval_nombre: av ? av.nombre : null,
        cc_propio_nombre: ccPropio ? ccPropio.nombre : null,
        cc_aval_nombre: ccAval ? ccAval.nombre : null
      };
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
  const FECHA = '2026-09-24';

  TABLAS.hipismo_hipodromos.push({ id: 'hip-1', pais: 'VE' });
  TABLAS.hipismo_planos.push({ id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 5, fecha: FECHA, pizarra: '3.9.5' });

  // --- PEDRO: % propio del 1%, sin aval — cuenta "PEDRO - PORCENTAJE" ---
  TABLAS.jugadores.push({
    id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 1,
    porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 0,
    avalado_por_id: null, cuenta_comision_id: 'cta-pedro', es_cuenta_comision: false
  });
  TABLAS.jugadores.push({
    id: 'cta-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO - PORCENTAJE', comision_propia: 0,
    porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 0,
    avalado_por_id: null, cuenta_comision_id: null, es_cuenta_comision: true
  });

  // Tercios: PEDRO pierde 100 → 1% de 100 = 1.00 (SIEMPRE positivo, aunque
  // PEDRO pierda su jugada — ver la nota grande de agregarPorcentajeDevuelto).
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCO', modalidad: '1/2', caballo: '3', monto: 100, resultado_jugador: -100, resultado_banquero: 95 });
  // Tercios: PEDRO gana 80 → 1% de 80 = 0.80 (también positivo, gane o pierda).
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCO', modalidad: '9x2', caballo: '9', monto: 80, resultado_jugador: 76, resultado_banquero: -76 });
  // Tercios: PEDRO como BANQUERO de OTRO — NUNCA genera % (ver la nota
  // grande de construirResumenCuentaComisionHipismo: "nunca lo que banqueó").
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

  const esperadoPedro = round2(1.00 + 0.80 + 0.60 - 0.50);
  check(resumenPedro.resumen.totalSemana === esperadoPedro,
    `El saldo de "PEDRO - PORCENTAJE" ya NO es 0 — suma 1%% de lo que PEDRO jugó (Tercios + Remate, nunca lo que banqueó ni Winners) más el traspaso: ${esperadoPedro} (obtenido: ${resumenPedro.resumen.totalSemana})`);
  check(resumenPedro.modulos.hipismo === true && resumenPedro.modulos.deportes === false,
    'Una cuenta de comisión nunca trae Deportes anclado');
  check(resumenPedro.jugador.nombre === 'PEDRO - PORCENTAJE', 'El resumen trae el nombre de la cuenta, no el del cliente real');

  const diaPedro = resumenPedro.dias.find(d => d.fecha === FECHA);
  check(!!diaPedro, 'Trae el día agrupado');
  const hipPedro = diaPedro.hipodromos.find(h => h.nombre === 'La Rinconada');
  check(!!hipPedro && hipPedro.carreras.filter(c => c.tipo === 'comision').length === 3,
    'Las 3 jugadas de PEDRO que SÍ generan % (2 Tercios + 1 Remate) quedan como 3 líneas tipo "comision" bajo La Rinconada');
  check(hipPedro.carreras.every(c => c.tipo !== 'comision' || c.clienteOrigen === 'PEDRO'),
    'Cada línea de comisión trae quién la generó (clienteOrigen)');
  const bloqueTraspasos = diaPedro.hipodromos.find(h => h.tipo === 'traspaso');
  check(!!bloqueTraspasos && bloqueTraspasos.carreras.length === 1 && bloqueTraspasos.carreras[0].resultado === -0.50,
    'El Traspaso de Comisión aparece en su propio bloque "Traspasos de Comisión", separado de las jugadas');

  // --- LUIS/MARIA: % propio redirigido al aval (2%) + % de aval adicional
  //     (1%) — AMBOS caen en la MISMA cuenta "MARIA - PORCENTAJE" (ver la
  //     nota grande de obtenerComisionesPropias: "hasta 2 entradas
  //     simultáneas por cliente"). ---
  TABLAS.jugadores.push({
    id: 'j-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', comision_propia: 0,
    porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 0,
    avalado_por_id: null, cuenta_comision_id: 'cta-maria', es_cuenta_comision: false
  });
  TABLAS.jugadores.push({
    id: 'cta-maria', grupo_id: GRUPO_ID, nombre: 'MARIA - PORCENTAJE', comision_propia: 0,
    porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 0,
    avalado_por_id: null, cuenta_comision_id: null, es_cuenta_comision: true
  });
  TABLAS.jugadores.push({
    id: 'j-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 2,
    porcentaje_devuelto_destino: 'aval', porcentaje_devuelto_aval: 1,
    avalado_por_id: 'j-maria', cuenta_comision_id: null, es_cuenta_comision: false
  });
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'LUIS', banquero_nombre: 'BANCO', modalidad: '1/2', caballo: '3', monto: 100, resultado_jugador: 95, resultado_banquero: -95 });

  const cuentaMaria = { id: 'cta-maria', grupo_id: GRUPO_ID, nombre: 'MARIA - PORCENTAJE', es_cuenta_comision: true, modulos_anclados: false };
  const resumenMaria = await construirResumenClienteHipismo(cuentaMaria, grupo, 'actual');

  const esperadoMaria = round2(2.00 + 1.00);
  check(resumenMaria.resumen.totalSemana === esperadoMaria,
    `El saldo de "MARIA - PORCENTAJE" suma las 2 entradas simultáneas de LUIS (2%% propio redirigido + 1%% de aval) sobre la MISMA jugada: ${esperadoMaria} (obtenido: ${resumenMaria.resumen.totalSemana})`);
  const diaMaria = resumenMaria.dias.find(d => d.fecha === FECHA);
  const hipMaria = diaMaria.hipodromos.find(h => h.nombre === 'La Rinconada');
  check(hipMaria.carreras.filter(c => c.tipo === 'comision').length === 2,
    'La jugada de LUIS genera 2 líneas de comisión separadas (una por cada entrada) dentro de la cuenta de MARIA');
  check(hipMaria.carreras.every(c => c.clienteOrigen === 'LUIS'), 'Ambas líneas identifican a LUIS como quien las generó');

  // --- Regresión: una cuenta de comisión sin ningún cliente real
  //     apuntándole (recién creada) da saldo 0 limpio, sin explotar. ---
  TABLAS.jugadores.push({
    id: 'cta-huerfana', grupo_id: GRUPO_ID, nombre: 'HUERFANO - PORCENTAJE', comision_propia: 0,
    porcentaje_devuelto_destino: 'cliente', porcentaje_devuelto_aval: 0,
    avalado_por_id: null, cuenta_comision_id: null, es_cuenta_comision: true
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
