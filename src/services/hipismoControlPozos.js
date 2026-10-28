// =================================================================
// TABLERO DE CONTROL DE POZOS Y PAGO DIARIO (28-10-2026, a pedido del usuario: "una sola ventana con una fila por cliente que tenga
// pozo o sea pago diario: cuánto se le colocó o recargó, cuánto ha jugado y ganado o perdido esta semana, cuánto tiene en juego ahora,
// cuánto le queda disponible con su porcentaje, fecha de su última recarga y de su última jugada, y un semáforo; arriba un resumen del
// grupo"). Solo LEE: no mueve ningún saldo ni pozo.
//
// Por cliente (semana activa del grupo, la misma de Pozos / Balance General / Cierre Final):
//   colocado    = pozo base (jugadores.pozo_inicial) + recargas de la semana (Saldos > Recarga Saldos Pago Diarios)
//   apostado    = lo jugado esta semana (Tercios + Remate + Adelantadas + Deportes)
//   neto        = lo ganado/perdido esta semana (el mismo "liquidado" del pozo: Deportes + Hipismo)
//   enJuego     = lo arriesgado todavía sin resolver: Deportes pendiente + Adelantadas / Tercios Adelantadas pendientes
//   disponible  = colocado + neto - enJuego   (con lo que todavía puede jugar)
//   porcentaje  = disponible / colocado
//   semáforo    = el mismo corte del "pozo rojo" de Pozos: >=80% verde, <15% rojo, el resto amarillo; sin nada colocado = gris
// Entran los clientes con pozo (tipo 'avalado', con o sin marca de pago diario) y todos los de pago diario (aunque esa semana no
// hayan recargado: salen en gris "sin saldo"). Las cuentas de comisión y los clientes inactivos no entran.
// =================================================================
const db = require('../db');
const { calcularPozoJugador, rangoSemanaActualPozo } = require('./pozo');
const { hipismoEnJuegoPorCliente } = require('./hipismoEnJuego');
const { CUENTA_RECARGAS_PAGO_DIARIO } = require('./hipismoAlertaPozo');
const { round2 } = require('./hipismoAdelantadasCalc');

function iso(f) {
  if (!f) return null;
  return f instanceof Date ? f.toISOString().split('T')[0] : String(f).slice(0, 10);
}
const maxFecha = (...fs) => fs.map(iso).filter(Boolean).sort().pop() || null;

function semaforo(colocado, porcentaje) {
  if (!(colocado > 0)) return 'gris';
  if (porcentaje >= 80) return 'verde';
  if (porcentaje < 15) return 'rojo';
  return 'amarillo';
}
const ORDEN_SEMAFORO = { rojo: 0, amarillo: 1, gris: 2, verde: 3 };

async function clientesDelTablero(grupoId) {
  const consulta = condicion => db.query(
    `SELECT * FROM jugadores
      WHERE grupo_id = $1 AND ${condicion} AND COALESCE(es_cuenta_comision, false) = false AND COALESCE(activo, true) = true
      ORDER BY nombre`,
    [grupoId]
  );
  try { return (await consulta("(tipo_cuenta = 'avalado' OR pago_diario = true)")).rows; }
  catch (e) {
    if (!e || e.code !== '42703') throw e; // todavía no existe la columna pago_diario
    return (await consulta("tipo_cuenta = 'avalado'")).rows;
  }
}

async function construirControlPozos(grupoId) {
  const rango = await rangoSemanaActualPozo(grupoId);
  const jugadores = await clientesDelTablero(grupoId);
  const nombres = jugadores.map(j => j.nombre);
  const vacio = { semana: rango, resumen: resumir([]), clientes: [] };
  if (!nombres.length) return vacio;

  const mapa = (rows, campo) => { const m = new Map(); (rows || []).forEach(f => m.set(f.nombre, f)); return m; };
  const q = async (sql, params) => (await db.query(sql, params)).rows || [];

  // ---- recargas (suma de la semana + última de todas) ----
  const recargas = mapa(await q(
    `SELECT cliente_nombre AS nombre,
            COALESCE(SUM(monto) FILTER (WHERE fecha >= $3 AND fecha <= $4), 0) AS semana,
            MAX(fecha) AS ultima
       FROM hipismo_comisiones_ajustes
      WHERE grupo_id = $1 AND cliente_nombre = ANY($2) AND monto > 0
        AND creado_en IN (SELECT creado_en FROM hipismo_comisiones_ajustes WHERE grupo_id = $1 AND cliente_nombre = $5)
      GROUP BY cliente_nombre`,
    [grupoId, nombres, rango.desde, rango.hasta, CUENTA_RECARGAS_PAGO_DIARIO]));

  // ---- lo jugado esta semana + última jugada (de siempre) ----
  const tercios = mapa(await q(
    `SELECT t.cliente_nombre AS nombre,
            COALESCE(SUM(t.monto) FILTER (WHERE p.fecha >= $3 AND p.fecha <= $4), 0) AS semana, MAX(p.fecha) AS ultima
       FROM hipismo_tickets t JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND t.cliente_nombre = ANY($2) GROUP BY t.cliente_nombre`,
    [grupoId, nombres, rango.desde, rango.hasta]));
  const remates = mapa(await q(
    `SELECT a.cliente_nombre AS nombre,
            COALESCE(SUM(a.monto) FILTER (WHERE r.fecha >= $3 AND r.fecha <= $4), 0) AS semana, MAX(r.fecha) AS ultima
       FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r.id = a.remate_id
      WHERE a.grupo_id = $1 AND a.cliente_nombre = ANY($2) GROUP BY a.cliente_nombre`,
    [grupoId, nombres, rango.desde, rango.hasta]));
  const adelantadas = mapa(await q(
    `SELECT j.cliente_nombre AS nombre,
            COALESCE(SUM(j.monto) FILTER (WHERE p.fecha >= $3 AND p.fecha <= $4), 0) AS semana, MAX(p.fecha) AS ultima
       FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND j.cliente_nombre = ANY($2) GROUP BY j.cliente_nombre`,
    [grupoId, nombres, rango.desde, rango.hasta]));
  // Los Tercios Adelantadas ya resueltos se guardan como tickets (ya contados arriba); los pendientes solo cuentan como "en juego".
  const deportes = mapa(await q(
    `SELECT cliente_nombre AS nombre,
            COALESCE(SUM(arriesga) FILTER (WHERE fecha >= $3 AND fecha <= $4), 0) AS semana, MAX(fecha) AS ultima
       FROM tickets_historial WHERE grupo_id = $1 AND cliente_nombre = ANY($2) GROUP BY cliente_nombre`,
    [grupoId, nombres, rango.desde, rango.hasta]));

  const enJuegoHipismo = await hipismoEnJuegoPorCliente(grupoId, nombres);

  const clientes = [];
  for (const j of jugadores) {
    const pozo = await calcularPozoJugador(grupoId, j, { rango });
    const esPagoDiario = !!j.pago_diario;
    const tipo = esPagoDiario ? (j.tipo_cuenta === 'avalado' ? 'pago_diario_pozo' : 'pago_diario') : 'avalado';
    const base = round2(pozo.pozoInicial);
    const rec = recargas.get(j.nombre);
    const recargasSemana = esPagoDiario ? round2(Number(rec && rec.semana) || 0) : 0;
    const colocado = round2(base + recargasSemana);
    const neto = round2(pozo.liquidado);
    const enJuego = round2((pozo.congelado || 0) + (enJuegoHipismo.get(j.nombre) || 0));
    const disponible = round2(colocado + neto - enJuego);
    const val = (m, campo) => Number(m.get(j.nombre) && m.get(j.nombre)[campo]) || 0;
    const apostado = round2(val(tercios, 'semana') + val(remates, 'semana') + val(adelantadas, 'semana') + val(deportes, 'semana'));
    const porcentaje = colocado > 0 ? Math.max(0, Math.round((disponible / colocado) * 100)) : 0;
    clientes.push({
      nombre: j.nombre, tipo,
      pozoBase: base, recargasSemana, colocado,
      apostado, neto, enJuego, disponible, porcentaje,
      semaforo: semaforo(colocado, porcentaje),
      ultimaRecarga: esPagoDiario ? iso(rec && rec.ultima) : null,
      ultimaJugada: maxFecha(
        tercios.get(j.nombre) && tercios.get(j.nombre).ultima, remates.get(j.nombre) && remates.get(j.nombre).ultima,
        adelantadas.get(j.nombre) && adelantadas.get(j.nombre).ultima, deportes.get(j.nombre) && deportes.get(j.nombre).ultima)
    });
  }
  // Primero los que más atención piden: rojos, amarillos, sin saldo y al final los verdes; dentro de cada uno, el que menos % le queda.
  clientes.sort((a, b) => ORDEN_SEMAFORO[a.semaforo] - ORDEN_SEMAFORO[b.semaforo] || a.porcentaje - b.porcentaje || a.nombre.localeCompare(b.nombre, 'es'));
  return { semana: rango, resumen: resumir(clientes), clientes };
}

function resumir(clientes) {
  const suma = campo => round2(clientes.reduce((a, c) => a + c[campo], 0));
  const cuenta = s => clientes.filter(c => c.semaforo === s).length;
  return {
    totalClientes: clientes.length,
    totalColocado: suma('colocado'), totalApostado: suma('apostado'), totalNeto: suma('neto'),
    totalEnJuego: suma('enJuego'), totalDisponible: suma('disponible'),
    rojos: cuenta('rojo'), amarillos: cuenta('amarillo'), verdes: cuenta('verde'), sinSaldo: cuenta('gris'),
    pagoDiario: clientes.filter(c => c.tipo !== 'avalado').length,
    conPozo: clientes.filter(c => c.tipo !== 'pago_diario').length
  };
}

module.exports = { construirControlPozos, semaforo };
