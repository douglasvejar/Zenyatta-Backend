// =================================================================
// hipismoRegistroSaldos.js (07-10-2026) — "REGISTRO DE SALDOS".
// Pedido del usuario: "que sea un registro de saldos... se llevará un
// registro semanal del cliente, mensual y anual, así puedes ver qué tan
// rentable es un cliente, y también incluye tablas, marcas, jugadas
// adelantadas, comisión, etc."
//
// Para cada cliente y cada período (semanas del grupo, meses o años) arma:
//   - saldo: el resultado final del cliente, EXACTAMENTE el mismo número de
//     Balance General/Cierre Final (se calcula con construirCierreFinalHipismo,
//     la referencia "golden" — acá no se vuelve a sumar por otro camino).
//   - el desglose de ese saldo por tipo de jugada: Tercios, Remate, Winners,
//     Tablas Fijas, Marcas, Banca de Adelantadas (cuando el cliente banquea
//     una Marca/Tabla), Tercios Adelantadas, Carga Masiva, Traspasos y
//     "Otros" (lo que queda: % incluido en jugadas, ajustes por cruce, etc.,
//     para que el desglose siempre sume el saldo).
//   - comisión que le dejó al grupo (la comisión se cobra sobre lo que gana el
//     lado ganador de cada jugada, así que se le atribuye a ese cliente), el
//     % que se le devuelve (el saldo de su cuenta "NOMBRE - PORCENTAJE") y la
//     comisión NETA = comisión generada − % devuelto. La comisión neta es la
//     medida de rentabilidad: lo que el cliente de verdad le deja al grupo
//     después de devolverle su %. El saldo (cuánto ganó/perdió jugando) se
//     muestra aparte, porque quién está del otro lado de sus jugadas (el
//     grupo, banqueadores, otros clientes) cambia de un grupo a otro.
// Todo se calcula al momento (nada guardado aparte), así que siempre
// coincide con lo que dice Balance General aunque se corrija un plano viejo.
// Solo LEE: no cambia ningún dato.
// =================================================================
const db = require('../db');
const { rangoSemanaGrupo } = require('./hipismoSemana');
const { construirCierreFinalHipismo } = require('./hipismoResumenCliente');
const { obtenerCargasEspecialesRango } = require('./hipismoCargasEspeciales');
const { obtenerAjustesComision } = require('./hipismoComisionPropia');
const { round2 } = require('./hipismoAdelantadasCalc');

const NOMBRES_PSEUDO_ITEM = new Set(['WINNERS', 'TABLAS FIJAS', 'REMATE']);
const MAX_PERIODOS = { semana: 26, mes: 24, anio: 5 };
const DEFECTO_PERIODOS = { semana: 8, mes: 6, anio: 2 };
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDe(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function hoyVenezuela() { return new Date(Date.now() - 4 * 60 * 60 * 1000); }
function aIso(f) { return f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10); }
function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

const CAMPOS = ['jugadas', 'saldo', 'tercios', 'remate', 'winners', 'tablasFijas', 'marcas', 'bancaAdelantadas', 'tercAdelantadas', 'cargas', 'traspasos', 'otros', 'comisionGenerada', 'devuelto', 'comisionNeta'];
function filaVacia() { const f = {}; CAMPOS.forEach(c => { f[c] = 0; }); return f; }

// Lista de períodos (del más viejo al más nuevo, el último es el actual).
async function armarPeriodos(grupoId, granularidad, cantidad, hoyVe) {
  const periodos = [];
  if (granularidad === 'semana') {
    for (let off = -(cantidad - 1); off <= 0; off++) {
      const r = await rangoSemanaGrupo(grupoId, hoyVe, off);
      periodos.push({ clave: `${r.desde}`, etiqueta: `${ddmm(r.desde)} al ${ddmm(r.hasta)}`, desde: r.desde, hasta: r.hasta });
    }
  } else if (granularidad === 'mes') {
    const anio = hoyVe.getUTCFullYear(), mes = hoyVe.getUTCMonth();
    for (let k = cantidad - 1; k >= 0; k--) {
      const ini = new Date(Date.UTC(anio, mes - k, 1));
      const fin = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0));
      periodos.push({ clave: `${ini.getUTCFullYear()}-${pad2(ini.getUTCMonth() + 1)}`, etiqueta: `${MESES[ini.getUTCMonth()]} ${ini.getUTCFullYear()}`, desde: isoDe(ini), hasta: isoDe(fin) });
    }
  } else {
    const anio = hoyVe.getUTCFullYear();
    for (let k = cantidad - 1; k >= 0; k--) {
      const a = anio - k;
      periodos.push({ clave: String(a), etiqueta: String(a), desde: `${a}-01-01`, hasta: `${a}-12-31` });
    }
  }
  return periodos;
}

function normalizarParametros({ granularidad, cantidad } = {}) {
  const g = ['semana', 'mes', 'anio'].includes(granularidad) ? granularidad : 'semana';
  let n = parseInt(cantidad, 10);
  if (!Number.isFinite(n) || n < 1) n = DEFECTO_PERIODOS[g];
  return { granularidad: g, cantidad: Math.min(n, MAX_PERIODOS[g]) };
}

async function construirRegistroSaldosHipismo(grupoId, parametros = {}, hoy) {
  const { granularidad, cantidad } = normalizarParametros(parametros);
  const hoyVe = hoy || hoyVenezuela();
  const periodos = await armarPeriodos(grupoId, granularidad, cantidad, hoyVe);
  const desdeTotal = periodos[0].desde;
  const hastaTotal = periodos[periodos.length - 1].hasta;
  const indicePeriodo = (fecha) => periodos.findIndex(p => fecha >= p.desde && fecha <= p.hasta);

  // --- quién es quién: cuentas "NOMBRE - PORCENTAJE" -> su dueño
  const rJug = await db.query(
    'SELECT id, nombre, es_cuenta_comision, cuenta_comision_id FROM jugadores WHERE grupo_id = $1',
    [grupoId]
  );
  const nombrePorId = new Map(rJug.rows.map(j => [j.id, j.nombre]));
  const duenoDeCuenta = new Map(); // nombre de cuenta -> nombre del cliente
  rJug.rows.forEach(j => {
    if (j.cuenta_comision_id && nombrePorId.has(j.cuenta_comision_id)) duenoDeCuenta.set(nombrePorId.get(j.cuenta_comision_id), j.nombre);
  });
  const esCuentaComision = new Set(rJug.rows.filter(j => j.es_cuenta_comision).map(j => j.nombre));

  // porCliente: nombre -> Array(periodos) de filas
  const porCliente = new Map();
  function fila(nombre, i) {
    if (!porCliente.has(nombre)) porCliente.set(nombre, periodos.map(() => filaVacia()));
    return porCliente.get(nombre)[i];
  }
  const comisionGrupoPorPeriodo = periodos.map(() => 0);

  // --- 1) saldo oficial + jugadas, período por período (misma cuenta de Balance General)
  const devueltoPorPeriodo = periodos.map(() => new Map()); // dueño -> % devuelto
  for (let i = 0; i < periodos.length; i++) {
    const p = periodos[i];
    const cierre = await construirCierreFinalHipismo(grupoId, p.desde, p.hasta);
    comisionGrupoPorPeriodo[i] = round2(cierre.comisionSemana || 0);
    cierre.clientes.forEach(c => {
      if (NOMBRES_PSEUDO_ITEM.has(c.nombre)) return;
      if (duenoDeCuenta.has(c.nombre)) { // cuenta de % devuelto: se pliega en el dueño
        const m = devueltoPorPeriodo[i];
        m.set(duenoDeCuenta.get(c.nombre), round2((m.get(duenoDeCuenta.get(c.nombre)) || 0) + Number(c.saldo || 0)));
        return;
      }
      const f = fila(c.nombre, i);
      f.saldo = round2(c.saldo);
      f.jugadas = Number(c.jugadas || 0);
    });
  }
  devueltoPorPeriodo.forEach((m, i) => m.forEach((monto, dueno) => { fila(dueno, i).devuelto = monto; }));

  // --- 2) desglose por tipo (una sola lectura de todo el rango, repartida por fecha)
  const rTickets = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero, p.fecha
       FROM hipismo_tickets t JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`, [grupoId, desdeTotal, hastaTotal]);
  rTickets.rows.forEach(t => {
    const i = indicePeriodo(aIso(t.fecha)); if (i < 0) return;
    const rj = Number(t.resultado_jugador) || 0, rb = Number(t.resultado_banquero) || 0;
    fila(t.cliente_nombre, i).tercios += rj;
    fila(t.banquero_nombre, i).tercios += rb;
    const com = -(rj + rb); // la comisión sale de lo que gana el lado ganador
    if (com > 0.0001) fila(rj > 0 ? t.cliente_nombre : t.banquero_nombre, i).comisionGenerada += com;
  });

  const rRemate = await db.query(
    `SELECT a.cliente_nombre, a.resultado, r.fecha
       FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r.id = a.remate_id
      WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3`, [grupoId, desdeTotal, hastaTotal]);
  rRemate.rows.forEach(a => { const i = indicePeriodo(aIso(a.fecha)); if (i >= 0) fila(a.cliente_nombre, i).remate += Number(a.resultado) || 0; });

  const rWin = await db.query(
    'SELECT cliente_nombre, monto, fecha FROM hipismo_winners WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3', [grupoId, desdeTotal, hastaTotal]);
  rWin.rows.forEach(w => { const i = indicePeriodo(aIso(w.fecha)); if (i >= 0) fila(w.cliente_nombre, i).winners += Number(w.monto) || 0; });

  const rAde = await db.query(
    `SELECT j.cliente_nombre, j.tipo, j.resultado_cliente, j.comision, j.banqueadores, p.fecha
       FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
    [grupoId, desdeTotal, hastaTotal]);
  rAde.rows.forEach(j => {
    const i = indicePeriodo(aIso(j.fecha)); if (i < 0) return;
    const f = fila(j.cliente_nombre, i);
    if (j.tipo === 'tf') f.tablasFijas += Number(j.resultado_cliente) || 0; else f.marcas += Number(j.resultado_cliente) || 0;
    if (j.comision != null) f.comisionGenerada += Number(j.comision); // puede ser negativa (diferencia de montos a mano)
    if (Array.isArray(j.banqueadores)) j.banqueadores.forEach(b => { if (b && b.nombre) fila(b.nombre, i).bancaAdelantadas += Number(b.monto) || 0; });
  });

  const rTa = await db.query(
    `SELECT j.jugador_nombre, j.banquero_nombre, j.resultado_jugador, j.resultado_banquero, j.comision_grupo, p.fecha
       FROM hipismo_tercios_adelantadas_jugadas j JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','sin_decidir')`,
    [grupoId, desdeTotal, hastaTotal]);
  rTa.rows.forEach(j => {
    const i = indicePeriodo(aIso(j.fecha)); if (i < 0) return;
    const rj = Number(j.resultado_jugador) || 0, rb = Number(j.resultado_banquero) || 0;
    fila(j.jugador_nombre, i).tercAdelantadas += rj;
    fila(j.banquero_nombre, i).tercAdelantadas += rb;
    const com = Number(j.comision_grupo) || 0;
    if (com > 0) fila(rj > 0 ? j.jugador_nombre : j.banquero_nombre, i).comisionGenerada += com;
  });

  const cargas = await obtenerCargasEspecialesRango(grupoId, desdeTotal, hastaTotal);
  cargas.forEach(l => { const i = indicePeriodo(l.fecha); if (i >= 0) fila(l.clienteNombre, i).cargas += l.monto; });

  for (let i = 0; i < periodos.length; i++) {
    const aj = await obtenerAjustesComision(grupoId, periodos[i].desde, periodos[i].hasta);
    Object.keys(aj).forEach(nombre => { if (aj[nombre]) fila(nombre, i).traspasos += Number(aj[nombre]); });
  }

  // --- 3) cierre de cada fila: "otros" (lo que falta para llegar al saldo oficial) y comisión neta
  const clientes = [];
  porCliente.forEach((filas, nombre) => {
    if (NOMBRES_PSEUDO_ITEM.has(nombre) || esCuentaComision.has(nombre)) return;
    const total = filaVacia();
    filas.forEach(f => {
      CAMPOS.forEach(c => { f[c] = round2(f[c]); });
      f.otros = round2(f.saldo - (f.tercios + f.remate + f.winners + f.tablasFijas + f.marcas + f.bancaAdelantadas + f.tercAdelantadas + f.cargas + f.traspasos));
      f.comisionNeta = round2(f.comisionGenerada - f.devuelto);
      CAMPOS.forEach(c => { total[c] += f[c]; });
    });
    CAMPOS.forEach(c => { total[c] = round2(total[c]); });
    if (CAMPOS.every(c => total[c] === 0) && filas.every(f => CAMPOS.every(c => f[c] === 0))) return;
    clientes.push({ nombre, periodos: filas, total });
  });
  clientes.sort((a, b) => b.total.comisionNeta - a.total.comisionNeta || a.nombre.localeCompare(b.nombre, 'es'));

  // --- 4) totales del grupo por período
  const totales = periodos.map((p, i) => {
    const t = filaVacia();
    clientes.forEach(c => CAMPOS.forEach(k => { t[k] += c.periodos[i][k]; }));
    CAMPOS.forEach(k => { t[k] = round2(t[k]); });
    t.comisionGrupo = comisionGrupoPorPeriodo[i];
    return t;
  });
  const totalGeneral = filaVacia();
  totales.forEach(t => CAMPOS.forEach(k => { totalGeneral[k] += t[k]; }));
  CAMPOS.forEach(k => { totalGeneral[k] = round2(totalGeneral[k]); });
  totalGeneral.comisionGrupo = round2(comisionGrupoPorPeriodo.reduce((a, b) => a + b, 0));

  return { granularidad, cantidad, periodos, clientes, totales, totalGeneral, campos: CAMPOS };
}

module.exports = { construirRegistroSaldosHipismo, normalizarParametros, armarPeriodos, CAMPOS };
