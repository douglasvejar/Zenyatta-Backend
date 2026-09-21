// =================================================================
// PRUEBA: services/saldosSemana.js — pestaña nueva "⬇️ Descargar" > "📅
// Saldos Semana" (21-09-2026, a pedido del usuario: "quiero enlazar esas
// jugadas a un servidor online donde me calcule los tickets ganados y
// perdidos y los totales de los clientes... descargar toda la semana...
// esto incluye todas las jugadas, pollas, traspaso, todo absolutamente
// todo").
//
// Mismo patrón de "pg" falso en memoria que test_balance_general.js
// (tickets_historial/polla_historial/transferencias) + test_whatsapp_bot_flujo.js
// (jugadores/avales/equipos_globales/equipos_personalizados/grupos, que
// necesita cargarConfigGrupo() por debajo). Semana de prueba: lunes
// 2026-09-14 a domingo 2026-09-20 (semana ISO 38 de 2026) — con
// movimiento SOLO el lunes y el martes, a propósito, para poder probar
// que los otros 5 días salen en $0.00 (relleno de ceros) en vez de
// faltar de la grilla.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g1';

const TABLAS = {
  grupos: [{ id: GRUPO_ID, modelo_comision: 'plano', comision_tiers: [] }],
  // MANOLO: 5% de comisión propia. PEDRO: sin %. ZOE: activa, sin NINGÚN
  // movimiento esta semana (para probar que igual aparece, en $0 toda la
  // semana). INACTIVO: ya no está activo, pero SÍ tuvo movimiento esta
  // semana (para probar que aparece igual, mismo criterio que "corte
  // semana" del bot de WhatsApp).
  jugadores: [
    { id: 'j-manolo', grupo_id: GRUPO_ID, nombre: 'MANOLO', activo: true, comision_propia: 5 },
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', activo: true, comision_propia: 0 },
    { id: 'j-zoe', grupo_id: GRUPO_ID, nombre: 'ZOE', activo: true, comision_propia: 0 },
    { id: 'j-inactivo', grupo_id: GRUPO_ID, nombre: 'INACTIVO', activo: false, comision_propia: 0 }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  tickets_historial: [
    // Lunes 2026-09-14
    { id: 't1', grupo_id: GRUPO_ID, fecha: '2026-09-14', cliente_nombre: 'MANOLO', ticket_label: 'T1', detalle: 'x', arriesga: 100, gana: 0, estado: 'PERDIDA' },
    { id: 't2', grupo_id: GRUPO_ID, fecha: '2026-09-14', cliente_nombre: 'PEDRO', ticket_label: 'T2', detalle: 'x', arriesga: 50, gana: 45, estado: 'GANADA' },
    // Martes 2026-09-15
    { id: 't3', grupo_id: GRUPO_ID, fecha: '2026-09-15', cliente_nombre: 'MANOLO', ticket_label: 'T3', detalle: 'x', arriesga: 80, gana: 72, estado: 'GANADA' },
    { id: 't4', grupo_id: GRUPO_ID, fecha: '2026-09-15', cliente_nombre: 'INACTIVO', ticket_label: 'T4', detalle: 'x', arriesga: 60, gana: 0, estado: 'PERDIDA' }
  ],
  polla_historial: [
    { id: 'p1', grupo_id: GRUPO_ID, fecha: '2026-09-15', cliente_nombre: 'MANOLO', monto: -30 },
    { id: 'p2', grupo_id: GRUPO_ID, fecha: '2026-09-15', cliente_nombre: 'PEDRO', monto: 10 }
  ],
  transferencias: [
    { id: 'tr1', grupo_id: GRUPO_ID, fecha: '2026-09-15', cliente_origen: 'MANOLO', cliente_destino: 'PEDRO', monto: 10 }
  ]
};

function enRango(fila, desde, hasta) {
  return (!desde || fila.fecha >= desde) && (!hasta || fila.fecha <= hasta);
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.avales.filter(a => a.grupo_id === params[0]) };
  if (/FROM equipos_globales/i.test(sql)) return { rows: TABLAS.equipos_globales };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: TABLAS.equipos_personalizados };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    const g = TABLAS.grupos.find(g => g.id === params[0]);
    return { rows: g ? [{ modelo_comision: g.modelo_comision, comision_tiers: g.comision_tiers }] : [] };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket.*FROM tickets_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ id: t.id, fecha: t.fecha, cliente: t.cliente_nombre, ticket: t.ticket_label, detalle: t.detalle, arriesga: t.arriesga, gana: t.gana, estado: t.estado })) };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.polla_historial.filter(p => p.grupo_id === grupoId && enRango(p, desde, hasta));
    return { rows: filas.map(p => ({ id: p.id, fecha: p.fecha, cliente: p.cliente_nombre, monto: p.monto, nota: null })) };
  }
  if (/^SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.transferencias.filter(t => t.grupo_id === grupoId && enRango(t, desde, hasta));
    return { rows: filas.map(t => ({ cliente_origen: t.cliente_origen, cliente_destino: t.cliente_destino, monto: t.monto })) };
  }
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.on = () => {};
};

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';

const { construirSaldosSemana } = require(path.join(__dirname, '..', 'src', 'services', 'saldosSemana'));
const { calcularSemana } = require(path.join(__dirname, '..', 'src', 'services', 'fechaSemana'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}
function cercaDe(a, b, msg) {
  check(Math.abs(Number(a) - Number(b)) < 0.005, msg + ' (esperado ' + b + ', dio ' + a + ')');
}

(async function main() {
  // Cualquier fecha DENTRO de la semana lunes 14 a domingo 20 tiene que
  // dar exactamente esa semana — se pide con un jueves (17) a propósito,
  // para confirmar que no hace falta pasar el lunes exacto.
  const datos = await construirSaldosSemana(GRUPO_ID, 'Deportes Bernal', 'https://ejemplo.com/logo.png', '2026-09-17');

  // --- 1) Encabezado: grupo + semana ISO ---
  check(datos.grupo.nombre === 'Deportes Bernal', 'grupo.nombre pasa igual que se lo dieron');
  check(datos.grupo.logoUrl === 'https://ejemplo.com/logo.png', 'grupo.logoUrl pasa igual que se lo dieron');
  check(datos.semana.desde === '2026-09-14' && datos.semana.hasta === '2026-09-20', 'semana.desde/hasta = lunes 14 a domingo 20 de septiembre (la semana que contiene el jueves 17)');
  const esperado = calcularSemana('2026-09-17');
  check(datos.semana.anio === esperado.anio && datos.semana.numero === esperado.semana, 'semana.anio/numero coincide con calcularSemana() (fechaSemana.js)');
  check(Array.isArray(datos.semana.dias) && datos.semana.dias.length === 7, 'semana.dias trae exactamente 7 días');
  check(datos.semana.dias[0].fecha === '2026-09-14' && datos.semana.dias[0].nombre === 'Lunes', 'el primer día de la grilla es el LUNES (no domingo)');
  check(datos.semana.dias[6].fecha === '2026-09-20' && datos.semana.dias[6].nombre === 'Domingo', 'el último día de la grilla es el DOMINGO');

  // --- 2) Todos los clientes esperados aparecen ---
  const nombres = datos.clientes.map(c => c.nombre);
  check(nombres.includes('MANOLO') && nombres.includes('PEDRO'), 'los clientes con movimiento esta semana aparecen');
  check(nombres.includes('ZOE'), 'ZOE (activa, SIN ningún movimiento esta semana) igual aparece en el reporte — no queda afuera de la sábana');
  check(nombres.includes('INACTIVO'), 'INACTIVO (ya no está activo, pero tuvo movimiento esta semana) aparece igual — no se pierde su corte');
  check(nombres.join(',') === nombres.slice().sort().join(','), 'los clientes salen ordenados alfabéticamente');

  // --- 3) % propio de cada cliente ---
  const manolo = datos.clientes.find(c => c.nombre === 'MANOLO');
  const pedro = datos.clientes.find(c => c.nombre === 'PEDRO');
  const zoe = datos.clientes.find(c => c.nombre === 'ZOE');
  check(manolo.porcentaje === 5, 'MANOLO trae su % propio (5) separado del saldo');
  check(pedro.porcentaje === 0, 'PEDRO (sin % configurado) trae 0');

  // --- 4) ZOE (sin ningún movimiento) sale en $0 los 7 días, y su semana entera en $0 ---
  check(zoe.saldoSemana === 0 && zoe.arriesgadoSemana === 0 && zoe.pollaSemana === 0 && zoe.transferenciasSemana === 0, 'ZOE: todos los totales de la semana en $0');
  Object.values(zoe.porDia).forEach(d => {
    check(d.resultado === 0 && d.arriesgado === 0 && d.ganado === 0 && d.perdido === 0 && d.transferencias === 0 && d.polla === 0 && d.saldoCliente === 0, 'ZOE: cada día individual también en $0 (relleno de ceros, no falta ningún día)');
  });

  // --- 5) MANOLO/PEDRO: los días SIN actividad de esta semana (miércoles
  // a domingo) están en $0 — solo lunes y martes tienen números reales ---
  ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'].forEach(fecha => {
    check(manolo.porDia[fecha].resultado === 0 && manolo.porDia[fecha].saldoCliente === 0, 'MANOLO: ' + fecha + ' (sin actividad) sale en $0, no falta de la grilla');
  });
  check(manolo.porDia['2026-09-14'].arriesgado === 100 && manolo.porDia['2026-09-14'].perdido === 100, 'MANOLO lunes 14: arriesgó y perdió $100 (el ticket T1)');
  check(manolo.porDia['2026-09-15'].ganado === 72, 'MANOLO martes 15: ganó (le pagaron) $72 (el ticket T3, arriesgó 80 para ganar 72)');
  check(manolo.porDia['2026-09-15'].polla === -30, 'MANOLO martes 15: Polla -$30, tal cual se cargó');
  check(manolo.porDia['2026-09-15'].transferencias === -10, 'MANOLO martes 15: transfirió $10 a PEDRO (neto -10)');
  check(pedro.porDia['2026-09-15'].transferencias === 10, 'PEDRO martes 15: recibió esos $10 (neto +10)');

  // --- 6) TODO absolutamente todo entra al saldo de la semana (jugadas +
  // polla + transferencias + comisión) — invariante: la suma de los 7
  // días de porDia da EXACTAMENTE el total semanal, para cada campo ---
  datos.clientes.forEach(c => {
    const camposDia = ['resultado', 'comision', 'arriesgado', 'ganado', 'perdido', 'transferencias', 'polla'];
    const sumaDia = {};
    camposDia.forEach(campo => { sumaDia[campo] = 0; });
    Object.values(c.porDia).forEach(d => camposDia.forEach(campo => { sumaDia[campo] += d[campo]; }));

    cercaDe(sumaDia.arriesgado, c.arriesgadoSemana, c.nombre + ': suma de arriesgado por día = arriesgadoSemana');
    cercaDe(sumaDia.ganado, c.ganadoSemana, c.nombre + ': suma de ganado por día = ganadoSemana');
    cercaDe(sumaDia.perdido, c.perdidoSemana, c.nombre + ': suma de perdido por día = perdidoSemana');
    cercaDe(sumaDia.transferencias, c.transferenciasSemana, c.nombre + ': suma de transferencias por día = transferenciasSemana');
    cercaDe(sumaDia.polla, c.pollaSemana, c.nombre + ': suma de polla por día = pollaSemana');
    cercaDe(sumaDia.comision, c.comisionSemana, c.nombre + ': suma de comisión por día = comisionSemana');
    // saldoSemana = resultado (sin comisión) + comisión, mismo criterio
    // que "resultadoDia = saldoCliente - comision" en balanceGeneral.js.
    cercaDe(sumaDia.resultado + sumaDia.comision, c.saldoSemana, c.nombre + ': (resultado + comisión) de la semana = saldoSemana');
  });

  // --- 7) MANOLO SÍ tiene comisión propia (5%) esta semana (por el
  // ticket ganado/perdido comisionable) — confirma que el % no se queda
  // en $0 aunque el cliente termine perdiendo la semana ---
  check(Math.abs(manolo.comisionSemana) > 0, 'MANOLO: su comisión de la semana no es $0 (tiene 5% configurado y jugó)');
  check(pedro.comisionSemana === 0, 'PEDRO: sin % configurado, su comisión de la semana es exactamente $0');

  // --- 8) totales generales: suman exactamente lo mismo que los clientes ---
  const sumaSaldoClientes = datos.clientes.reduce((acc, c) => acc + c.saldoSemana, 0);
  cercaDe(datos.totales.saldoSemana, sumaSaldoClientes, 'totales.saldoSemana = suma de saldoSemana de todos los clientes');
  const sumaArriesgadoClientes = datos.clientes.reduce((acc, c) => acc + c.arriesgadoSemana, 0);
  cercaDe(datos.totales.arriesgadoSemana, sumaArriesgadoClientes, 'totales.arriesgadoSemana = suma de arriesgadoSemana de todos los clientes');
  check(!!datos.totales.porDia['2026-09-14'], 'totales.porDia trae los 7 días también');

  // --- 9) Semana sin absolutamente ningún dato (grupo nuevo) no revienta ---
  const vacio = await construirSaldosSemana(GRUPO_ID, 'Grupo Nuevo', null, '2099-01-01');
  check(vacio.clientes.length === 3, 'grupo con cero actividad en esa semana: igual devuelve los 3 clientes ACTIVOS (en $0) — INACTIVO no vuelve a aparecer porque esa semana no tuvo ningún movimiento');
  check(vacio.clientes.every(c => c.saldoSemana === 0), 'grupo con cero actividad: todos los saldos de la semana en $0');
  check(vacio.grupo.logoUrl === null, 'logoUrl null (grupo sin logo) se devuelve como null, no undefined ni string vacío raro');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de Saldos Semana se cayó con una excepción:', e);
  process.exit(1);
});
