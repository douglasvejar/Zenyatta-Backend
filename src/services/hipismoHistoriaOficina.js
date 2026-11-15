// =================================================================
// HISTORIA DE LA OFICINA (15-11-2026, a pedido del usuario: "módulo Oficina crea una ventana llamada Historia de la Oficina; allí la lista
// de los clientes con cuántas jugadas han tenido, cuánto han jugado y cuánto % le producen a la oficina; se ordena por la semana actual de la
// oficina y tiene un rango para ver las fechas que yo seleccione"). Después: sin la columna "rinde sobre lo jugado", el cliente sin jugadas
// NO sale, orden del que más produce al que menos, y TODO (tercios, marcas, tablas fijas, remate y cualquier otro ítem) cuenta como "Jugadas".
//
// La comisión de cada cliente es la misma de "Comisiones por Socios": comisión bruta que generó − % devuelto por sus jugadas (todo sale de
// construirCierreFinalHipismo(..., { comisionPorCliente: true })). Lo que no pertenece a un cliente de la lista (clientes sin jugadas, cuentas de
// comisión, ítems, ajuste de centavos) se muestra aparte en "otros", así la suma de la lista + otros es SIEMPRE la comisión del Balance General.
// "Jugado" = monto apostado: tickets (los dos lados), remate, adelantadas y tercios adelantadas; Winners solo cuenta como jugada (no tiene monto).
// Una jugada nula (0/0: caballo retirado o sin decidir) no cuenta ni en jugadas ni en jugado.
// armarHistoriaOficina es PURA (sin base de datos) para poder probarla; obtenerMovimientoOficina hace las consultas.
// =================================================================
const db = require('../db');

const norm = t => ((t == null ? '' : t) + '').trim().toUpperCase().replace(/\s+/g, ' ');
const aCentavos = n => Math.round((Number(n) || 0) * 100 + (Number(n) < 0 ? -1e-9 : 1e-9));

// Consultas: monto jugado y jugadas nulas por cliente (claves normalizadas).
async function obtenerMovimientoOficina(grupoId, desde, hasta) {
  const jugadoCent = new Map(), nulas = new Map();
  const sumar = (mapa, nombre, v) => { const k = norm(nombre); if (k) mapa.set(k, (mapa.get(k) || 0) + v); };
  const [rTickets, rRemate, rAdel, rTerAdel] = await Promise.all([
    db.query(
      `SELECT t.cliente_nombre, t.banquero_nombre, t.monto, t.resultado_jugador, t.resultado_banquero
         FROM hipismo_tickets t JOIN hipismo_planos p ON p.id = t.plano_id
        WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`, [grupoId, desde, hasta]),
    db.query(
      `SELECT a.cliente_nombre, a.monto FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r.id = a.remate_id
        WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3`, [grupoId, desde, hasta]),
    db.query(
      `SELECT j.cliente_nombre, j.monto, j.estado FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
        WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`, [grupoId, desde, hasta]),
    db.query(
      `SELECT j.jugador_nombre, j.banquero_nombre, j.monto, j.estado FROM hipismo_tercios_adelantadas_jugadas j
         JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
        WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','sin_decidir')`, [grupoId, desde, hasta])
  ]);
  rTickets.rows.forEach(t => {
    if (Number(t.resultado_jugador) === 0 && Number(t.resultado_banquero) === 0) { sumar(nulas, t.cliente_nombre, 1); sumar(nulas, t.banquero_nombre, 1); return; }
    const c = aCentavos(t.monto);
    sumar(jugadoCent, t.cliente_nombre, c); sumar(jugadoCent, t.banquero_nombre, c);
  });
  rRemate.rows.forEach(a => sumar(jugadoCent, a.cliente_nombre, aCentavos(a.monto)));
  rAdel.rows.forEach(j => { if (j.estado === 'sin_decidir') sumar(nulas, j.cliente_nombre, 1); else sumar(jugadoCent, j.cliente_nombre, aCentavos(j.monto)); });
  rTerAdel.rows.forEach(j => {
    if (j.estado === 'sin_decidir') { sumar(nulas, j.jugador_nombre, 1); sumar(nulas, j.banquero_nombre, 1); return; }
    const c = aCentavos(j.monto);
    sumar(jugadoCent, j.jugador_nombre, c); sumar(jugadoCent, j.banquero_nombre, c);
  });
  return { jugadoCent, nulas };
}

// cierre: construirCierreFinalHipismo(..., { comisionPorCliente: true }); jugadores: [{nombre, es_cuenta_comision}];
// movimiento: lo que devuelve obtenerMovimientoOficina.
function armarHistoriaOficina({ cierre, jugadores, movimiento }) {
  const bruta = (cierre && cierre.comisionBrutaPorCliente) || {};
  const devuelto = (cierre && cierre.devueltoPorOrigen) || {};
  const jugadoCent = (movimiento && movimiento.jugadoCent) || new Map();
  const nulas = (movimiento && movimiento.nulas) || new Map();
  const esCliente = new Set((jugadores || []).filter(j => !j.es_cuenta_comision).map(j => norm(j.nombre)));

  const netoDe = nombre => aCentavos(bruta[nombre]) - aCentavos(devuelto[nombre]);
  const total = aCentavos(cierre && cierre.comisionSemana);
  const filas = [];
  ((cierre && cierre.clientes) || []).forEach(c => {
    const k = norm(c.nombre);
    if (!esCliente.has(k)) return;                                  // ítems (REMATE, WINNERS...) y cuentas de comisión no son clientes
    const jugadas = (Number(c.jugadas) || 0) - (nulas.get(k) || 0);
    if (jugadas <= 0) return;                                       // sin jugadas no sale en la lista
    filas.push({ nombre: c.nombre, jugadas, jugadoCent: jugadoCent.get(k) || 0, comisionCent: netoDe(c.nombre) });
  });
  filas.sort((a, b) => b.comisionCent - a.comisionCent || b.jugadoCent - a.jugadoCent || a.nombre.localeCompare(b.nombre, 'es'));

  const sumaCent = filas.reduce((a, f) => a + f.comisionCent, 0);
  const otrosCent = total - sumaCent;
  const pct = c => (total ? Math.round(c / total * 10000) / 100 : 0);
  return {
    filas: filas.map(f => ({ nombre: f.nombre, jugadas: f.jugadas, jugado: f.jugadoCent / 100, comision: f.comisionCent / 100, porcentaje: pct(f.comisionCent) })),
    otros: otrosCent / 100,
    totales: {
      clientes: filas.length,
      jugadas: filas.reduce((a, f) => a + f.jugadas, 0),
      jugado: filas.reduce((a, f) => a + f.jugadoCent, 0) / 100,
      comisionClientes: sumaCent / 100
    },
    comisionOficina: total / 100
  };
}

module.exports = { armarHistoriaOficina, obtenerMovimientoOficina };
