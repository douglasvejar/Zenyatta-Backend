// =================================================================
// PRUEBA: pestaña "Carga Masiva Especial" (05-10-2026, a pedido del
// usuario, con sus imágenes "Carga masiva — texto libre: creación de
// saldos" y "Regla de validación: suma cero"): se elige un HIPÓDROMO y una
// ACCIÓN (Remate, Marcas, Winners...), se escriben líneas
// "CLIENTE +monto" / "CLIENTE -monto" y se aprieta "Calcular": la suma debe
// dar 0 y cada nombre debe existir EXACTAMENTE como cliente (o ser una
// cuenta del grupo como "% TABLAS Y MARCAS"), si no no deja confirmar. Cada
// línea es un movimiento de saldo que ven Balance General/Cierre Final,
// Semana por Días y el link de cada cliente, con el nombre de la acción.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-cme-1';
const FECHA = '2026-10-02';

function jug(id, nombre, extra) {
  return Object.assign({ id, grupo_id: GRUPO_ID, nombre, comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false, modulos_anclados: false }, extra || {});
}
const TABLAS = {
  jugadores: [
    jug('j-jose', 'JOSE'), jug('j-lionel', 'LIONEL'), jug('j-moncler', 'MONCLER'),
    jug('j-rafael', 'RAFAEL PARLEY'), jug('j-fortuna', 'PARLEY FORTUNA'),
    jug('j-banco', 'BANCOX'),
    jug('j-haaland', 'HAALAND'), jug('j-mzen', 'MARCAS ZENYATTA'), jug('j-msam', 'MARCAS SAMMY')
  ],
  jugadores_avales_porcentaje: [],
  hipismo_planos: [
    { id: 'p-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 3, fecha: FECHA, cruza_jugadas: false, comision_total: 0 }
  ],
  // JOSE además juega normal: pierde 10 en Tercios (su saldo total debe ser -10 + -23)
  hipismo_tickets: [
    { plano_id: 'p-1', grupo_id: GRUPO_ID, cliente_nombre: 'JOSE', banquero_nombre: 'BANCOX', modalidad: '1p', caballo: '2', monto: 10, resultado_jugador: -10, resultado_banquero: 9.5, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: [],
  hipismo_winners: [], hipismo_comisiones_ajustes: [], tickets_historial: [],
  hipismo_tercios_adelantadas_jugadas: [],
  hipismo_hipodromos: [{ id: 'h1', grupo_id: GRUPO_ID, nombre: 'LA RINCONADA' }],
  hipismo_cargas_especiales: [],
  hipismo_cargas_especiales_lineas: []
};
let seqId = 0;
let reloj = 0;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- construirCierreFinalHipismo ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t\s+JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision || false, cruza_jugadas: p.cruza_jugadas || false, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas a\s+JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId)
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rr => rr.id === a.remate_id) }))
      .filter(({ r }) => r && r.fecha >= desde && r.fecha <= hasta)
      .map(({ a }) => ({ cliente_nombre: a.cliente_nombre, resultado: a.resultado, monto: a.monto }));
    return { rows: filas };
  }
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto, j\.gano.*\s+FROM hipismo_adelantadas_jugadas j\s+JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    return { rows: [] };
  }
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_winners
      .filter(w => w.grupo_id === grupoId && w.fecha >= desde && w.fecha <= hasta)
      .map(w => ({ cliente_nombre: w.cliente_nombre, monto: w.monto }));
    return { rows: filas };
  }
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes\s+WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3\s+GROUP BY cliente_nombre/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const mapa = new Map();
    TABLAS.hipismo_comisiones_ajustes
      .filter(a => a.grupo_id === grupoId && a.fecha >= desde && a.fecha <= hasta)
      .forEach(a => mapa.set(a.cliente_nombre, (mapa.get(a.cliente_nombre) || 0) + Number(a.monto)));
    return { rows: Array.from(mapa.entries()).map(([cliente_nombre, total]) => ({ cliente_nombre, total })) };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const total = TABLAS.hipismo_remates.filter(r => r.grupo_id === grupoId && r.fecha >= desde && r.fecha <= hasta).reduce((s, r) => s + Number(r.comision_total || 0), 0);
    return { rows: [{ total }] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN \$2 AND \$3$/i.test(sql)) {
    return { rows: [{ total: 0 }] };
  }

  // ---- diagnosticarSaldosHipismo: lista plana de jugadores del grupo ----
  if (/^SELECT id, grupo_id, nombre, modulos_anclados, es_cuenta_comision, comision_propia, incluir_porcentaje_en_jugadas FROM jugadores WHERE grupo_id = \$1$/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId).map(j => ({
      id: j.id, grupo_id: j.grupo_id, nombre: j.nombre, modulos_anclados: j.modulos_anclados, es_cuenta_comision: j.es_cuenta_comision,
      comision_propia: j.comision_propia, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas
    })) };
  }

  // ---- calcularDevueltoDestinoHipismo: candidatos cuyo % resuelve a esta ficha ----
  if (/^SELECT j\.nombre\s+FROM jugadores j\s+WHERE j\.grupo_id = \$1/i.test(sql)) {
    const [grupoId, destinoId] = params;
    const rows = TABLAS.jugadores.filter(j => {
      if (j.grupo_id !== grupoId || j.es_cuenta_comision || j.id === destinoId) return false;
      const cond1 = j.cuenta_comision_id === destinoId && (Number(j.comision_propia) || 0) > 0 && !j.incluir_porcentaje_en_jugadas;
      const cond2 = TABLAS.jugadores_avales_porcentaje.some(a => a.jugador_id === j.id && (Number(a.porcentaje) || 0) > 0 && a.avalador_id === destinoId);
      return cond1 || cond2;
    }).map(j => ({ nombre: j.nombre }));
    return { rows };
  }

  // ---- obtenerComisionesPropias ----
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const porId = new Map(TABLAS.jugadores.map(j => [j.id, j]));
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && (!nombres || nombres.includes(j.nombre)));
    return {
      rows: filas.map(j => {
        const ccPropio = j.cuenta_comision_id ? porId.get(j.cuenta_comision_id) : null;
        return { id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cc_propio_nombre: ccPropio ? ccPropio.nombre : null, incluir_porcentaje_en_jugadas: !!j.incluir_porcentaje_en_jugadas };
      })
    };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    const [grupoId, idsJugadores] = params;
    const porId = new Map(TABLAS.jugadores.map(j => [j.id, j]));
    const rows = TABLAS.jugadores_avales_porcentaje
      .filter(a => a.grupo_id === grupoId && idsJugadores.includes(a.jugador_id))
      .map(a => {
        const avalador = porId.get(a.avalador_id);
        return { jugador_id: a.jugador_id, porcentaje: a.porcentaje, avalador_nombre: avalador ? avalador.nombre : null };
      });
    return { rows };
  }

  // ---- obtenerLineasHipismoCliente / calcularDevueltoDestinoHipismo: tickets crudos para el neteo por carrera ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero,\s*t\.sin_comision, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre))
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta);
    return {
      rows: filas.map(({ t, p }) => ({
        cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre,
        resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero,
        sin_comision: t.sin_comision, fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero
      }))
    };
  }
  // ---- obtenerLineasHipismoCliente: Tercios ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre))
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta);
    return {
      rows: filas.map(({ t, p }) => ({
        cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad || '1/2',
        caballo: t.caballo || '1', monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero,
        fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, pizarra: p.pizarra || null, pais: 'VE'
      }))
    };
  }
  // ---- obtenerLineasHipismoCliente: Remate ----
  if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId && a.cliente_nombre === nombre)
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rr => rr.id === a.remate_id) }))
      .filter(({ r }) => r && r.fecha >= desde && r.fecha <= hasta);
    return {
      rows: filas.map(({ a, r }) => ({
        caballo: a.caballo, numero_ejemplar: a.numero_ejemplar, monto: a.monto, resultado: a.resultado,
        fecha: r.fecha, hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero, pizarra: r.pizarra, numero_ganador: r.numero_ganador, pais: null
      }))
    };
  }
  // ---- obtenerLineasHipismoCliente: Adelantadas ----
  if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) {
    return { rows: [] };
  }
  // ---- obtenerLineasHipismoCliente: Winners ----
  if (/^SELECT w\.caballo, w\.monto, w\.fecha, w\.hipodromo_nombre, w\.carrera_numero, h\.pais/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_winners
      .filter(w => w.grupo_id === grupoId && w.cliente_nombre === nombre && w.fecha >= desde && w.fecha <= hasta)
      .map(w => ({ caballo: w.caballo, monto: w.monto, fecha: w.fecha, hipodromo_nombre: w.hipodromo_nombre, carrera_numero: w.carrera_numero, pais: 'VE' }));
    return { rows: filas };
  }
  // ---- Traspasos de Comisión de un cliente normal/cuenta de comisión ----
  if (/^SELECT monto, fecha, nota FROM hipismo_comisiones_ajustes/i.test(sql)) {
    const [grupoId, clienteNombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_comisiones_ajustes
      .filter(a => a.grupo_id === grupoId && a.cliente_nombre === clienteNombre && a.fecha >= desde && a.fecha <= hasta)
      .map(a => ({ monto: a.monto, fecha: a.fecha, nota: a.nota || null }));
    return { rows: filas };
  }
  // ---- Deportes anclado (leerHistorial) ----
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros\s+FROM tickets_historial/i.test(sql)) {
    const [grupoId, desde, hasta, cliente] = params;
    const filas = TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && t.fecha >= desde && t.fecha <= hasta && t.cliente_nombre === cliente);
    return { rows: filas };
  }

  // ---- obtenerApuestasDelRango (/comisiones-devueltas) ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero/i.test(sql)) {
    const [grupoId, d1, d2] = params;
    const hasta = d2 === undefined ? d1 : d2;
    const filas = TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= d1 && p.fecha <= hasta)
      .map(({ t, p }) => ({ id: 't-x', cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.resultado_cliente/i.test(sql)) return { rows: [] };
  // ---- /saldo-comisiones ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.monto, t\.resultado_jugador, t\.resultado_banquero, t\.sin_comision, p\.hipodromo_nombre, p\.carrera_numero, p\.fecha\s+FROM hipismo_tickets t/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, sin_comision: t.sin_comision, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, fecha: p.fecha }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.monto\s+FROM hipismo_remate_apuestas a/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.monto, j\.resultado_cliente, j\.banqueadores, j\.gano, j\.sin_comision,\s*p\.fecha/i.test(sql)) return { rows: [] };

  // ---- /semana-por-dias ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.fecha, p\.hipodromo_nombre, p\.carrera_numero/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
      .map(({ t, p }) => ({ cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: p.cruza_jugadas, fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto, r\.fecha/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores, j\.monto, j\.gano, j\.sin_comision, p\.fecha/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos/i.test(sql)) return { rows: [] };
  if (/^SELECT p\.fecha AS fecha, j\.comision\s+FROM hipismo_adelantadas_jugadas j/i.test(sql)) return { rows: [] };

  // ---- Jugadas entre Tercios Adelantadas: ninguna en esta prueba ----
  if (/^SELECT j\.(\*|id, j\.jugador_nombre|jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };

  // ---- GET /clientes/:nombre/detalle-semana ----
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1 AND nombre = \$2$/i.test(sql)) {
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0] && j.nombre === params[1]) };
  }

  // ---- Carga Masiva Especial ----
  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha, c\.carrera, c\.codigo_nombre, c\.id AS carga_id, c\.hipodromo_nombre/i.test(sql)) {
    const [grupoId, desde, hasta, nombre] = params;
    const rows = [];
    TABLAS.hipismo_cargas_especiales.filter(c => c.grupo_id === grupoId && c.fecha >= desde && c.fecha <= hasta).forEach(c => {
      TABLAS.hipismo_cargas_especiales_lineas.filter(l => l.carga_id === c.id && (nombre == null || l.cliente_nombre === nombre)).sort((x, y) => x.orden - y.orden)
        .forEach(l => rows.push({ cliente_nombre: l.cliente_nombre, monto: l.monto, fecha: c.fecha, carrera: c.carrera, codigo_nombre: c.codigo_nombre, carga_id: c.id, hipodromo_nombre: c.hipodromo_nombre || null }));
    });
    return { rows };
  }
  if (/^SELECT nombre FROM hipismo_hipodromos WHERE grupo_id = \$1 AND nombre = \$2/i.test(sql)) {
    return { rows: TABLAS.hipismo_hipodromos.filter(h => h.grupo_id === params[0] && h.nombre === params[1]).map(h => ({ nombre: h.nombre })) };
  }
  if (/^INSERT INTO jugadores/i.test(sql)) {
    const [grupo_id, nombre] = params;
    TABLAS.insertsJugadores = (TABLAS.insertsJugadores || 0) + 1; // la regla nueva: NUNCA se crea un cliente solo
    if (!TABLAS.jugadores.some(j => j.grupo_id === grupo_id && j.nombre === nombre)) TABLAS.jugadores.push(jug('j-' + nombre, nombre, { grupo_id }));
    return { rows: [] };
  }
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    const [grupo, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupo && nombres.includes(j.nombre)).map(j => ({ nombre: j.nombre })) };
  }
  if (/^INSERT INTO hipismo_cargas_especiales \(/i.test(sql)) {
    const [grupo_id, fecha, carrera, codigo_nombre, hipodromo_nombre] = params;
    const id = 'carga' + (++seqId);
    TABLAS.hipismo_cargas_especiales.push({ id, grupo_id, fecha, carrera, codigo_nombre, hipodromo_nombre, creado_en: new Date(2026, 9, 5, 12, 0, 0, ++reloj) });
    return { rows: [{ id }] };
  }
  if (/^INSERT INTO hipismo_cargas_especiales_lineas/i.test(sql)) {
    const [carga_id, grupo_id, cliente_nombre, monto, orden] = params;
    TABLAS.hipismo_cargas_especiales_lineas.push({ id: 'l' + (++seqId), carga_id, grupo_id, cliente_nombre, monto: Number(monto), orden });
    return { rows: [] };
  }
  if (/^SELECT id, fecha, carrera, codigo_nombre, hipodromo_nombre, creado_en FROM hipismo_cargas_especiales WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.hipismo_cargas_especiales.filter(c => c.grupo_id === params[0]).sort((a, b) => (b.fecha.localeCompare(a.fecha)) || (b.creado_en - a.creado_en)) };
  }
  if (/^SELECT carga_id, cliente_nombre, monto, orden FROM hipismo_cargas_especiales_lineas WHERE grupo_id = \$1 AND carga_id = ANY/i.test(sql)) {
    const [grupo, ids] = params;
    return { rows: TABLAS.hipismo_cargas_especiales_lineas.filter(l => l.grupo_id === grupo && ids.includes(l.carga_id)).sort((a, b) => a.orden - b.orden) };
  }
  if (/^SELECT id FROM hipismo_cargas_especiales WHERE id = \$1 AND grupo_id = \$2/i.test(sql)) {
    return { rows: TABLAS.hipismo_cargas_especiales.filter(c => c.id === params[0] && c.grupo_id === params[1]).map(c => ({ id: c.id })) };
  }
  if (/^UPDATE hipismo_cargas_especiales SET fecha = \$1, carrera = \$2, codigo_nombre = \$3, hipodromo_nombre = \$4 WHERE id = \$5 AND grupo_id = \$6/i.test(sql)) {
    const c = TABLAS.hipismo_cargas_especiales.find(x => x.id === params[4] && x.grupo_id === params[5]);
    if (c) { c.fecha = params[0]; c.carrera = params[1]; c.codigo_nombre = params[2]; c.hipodromo_nombre = params[3]; }
    return { rows: [] };
  }
  if (/^DELETE FROM hipismo_cargas_especiales_lineas WHERE carga_id = \$1 AND grupo_id = \$2/i.test(sql)) {
    for (let i = TABLAS.hipismo_cargas_especiales_lineas.length - 1; i >= 0; i--) if (TABLAS.hipismo_cargas_especiales_lineas[i].carga_id === params[0]) TABLAS.hipismo_cargas_especiales_lineas.splice(i, 1);
    return { rows: [] };
  }
  if (/^DELETE FROM hipismo_cargas_especiales WHERE id = \$1 AND grupo_id = \$2 RETURNING id/i.test(sql)) {
    const i = TABLAS.hipismo_cargas_especiales.findIndex(c => c.id === params[0] && c.grupo_id === params[1]);
    if (i < 0) return { rows: [] };
    const id = TABLAS.hipismo_cargas_especiales[i].id;
    TABLAS.hipismo_cargas_especiales.splice(i, 1);
    for (let k = TABLAS.hipismo_cargas_especiales_lineas.length - 1; k >= 0; k--) if (TABLAS.hipismo_cargas_especiales_lineas[k].carga_id === id) TABLAS.hipismo_cargas_especiales_lineas.splice(k, 1);
    return { rows: [{ id }] };
  }

  throw new Error('La base de datos falsa de esta prueba (carga-masiva-especial) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};
function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...args) => { handlers.push([m, args]); return router; }; });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'h', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';

const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));

Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }

async function invocarRuta(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { salida, status };
}

(async function main() {
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta', logo_url: null, modulo_deportes_habilitado: true }, params: {}, query: {} };
  const svc = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCargasEspeciales'));
  const { construirCierreFinalHipismo, construirResumenClienteHipismo } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoResumenCliente'));
  const post = (ruta, body, extra) => invocarRuta(handlerDe('post', ruta), { ...reqBase, body, ...(extra || {}) });

  const TEXTO = 'JOSE -23.00\nLIONEL -50.00\nMONCLER -100.00\nRAFAEL PARLEY +100.00\nPARLEY FORTUNA +73.00';
  const TEXTO_MARCAS = 'HAALAND +100\nMARCAS ZENYATTA -50\nMARCAS SAMMY -51,25\n% TABLAS Y MARCAS +1.25';

  // ---------- 1) Parseo y validación (puros) ----------
  const v = svc.validarCargaEspecial({ texto: TEXTO, accion: 'deporte', fecha: FECHA });
  check(v.ok && v.lineas.length === 5 && v.suma === 0, '1a) un texto que suma 0 valida: 5 líneas, suma 0');
  check(v.lineas.find(l => l.cliente === 'RAFAEL PARLEY' && l.monto === 100), '1b) un nombre con espacios ("RAFAEL PARLEY +100.00") se lee completo');
  check(v.resumen.ganan === 173 && v.resumen.pierden === -173, '1c) ganan +173 / pierden -173');
  const vMal = svc.validarCargaEspecial({ texto: 'JUGADOR A +50\nJUGADOR B -20\nJUGADOR C -10', accion: 'MARCAS', fecha: FECHA });
  check(!vMal.ok && vMal.errores.some(e => e === 'La suma debe ser igual a cero. Diferencia: +20.00'), `1d) suma distinta de 0: "La suma debe ser igual a cero. Diferencia: +20.00" -- ${JSON.stringify(vMal.errores)}`);
  const vFormato = svc.validarCargaEspecial({ texto: 'esto no es una linea\nA +5\nB -5', accion: 'MARCAS', fecha: FECHA });
  check(!vFormato.ok && vFormato.errores.some(e => /Línea 1/.test(e)), '1e) una línea sin formato se reporta con su número');
  check(!svc.validarCargaEspecial({ texto: 'A +5\nB -5', accion: '', fecha: FECHA }).ok, '1f) sin acción no valida');
  check(!svc.validarCargaEspecial({ texto: 'A +5\nB -5', accion: 'INVENTADA', fecha: FECHA }).ok, '1f2) una acción que no está en la lista no valida');
  check(!svc.validarCargaEspecial({ texto: '', accion: 'REMATE', fecha: FECHA }).ok, '1g) sin líneas no valida');
  check(svc.parsearMonto('1.234,56') === 1234.56 && svc.parsearMonto('23.00') === 23 && svc.parsearMonto('23,5') === 23.5, '1h) montos: 1.234,56 / 23.00 / 23,5');
  check(svc.validarCargaEspecial({ texto: 'a +$10,50\nb - 10.5', accion: 'REMATE', fecha: FECHA }).ok, '1i) acepta "$" y espacios alrededor del signo');
  check(svc.validarCargaEspecial({ texto: TEXTO_MARCAS, accion: 'MARCAS', fecha: FECHA }).ok, '1j) el ejemplo de Marcas (HAALAND +100, MARCAS ZENYATTA -50, MARCAS SAMMY -51,25, % TABLAS Y MARCAS +1.25) suma 0');
  check(['REMATE', 'WINNERS', 'TABLAS FIJAS', 'MARCAS', 'CARRERA', 'POLLA', 'CRUCE', 'DEPORTE'].every(a => svc.ACCIONES_CARGA_ESPECIAL.includes(a)), '1k) la lista de acciones trae Remate, Winners, Tablas Fijas, Marcas, Carrera, Polla, Cruce y Deporte');

  // ---------- 2) "Calcular" (vista previa): detalle y errores ----------
  let r = await post('/cargas-especiales/previsualizar', { texto: TEXTO_MARCAS, accion: 'MARCAS', hipodromo: 'LA RINCONADA', fecha: FECHA, carrera: '4' });
  check(r.salida && r.salida.ok === true && r.salida.lineas.length === 4, '2a) vista previa ok con las 4 líneas del ejemplo de Marcas');
  const fila = n => r.salida.lineas.find(l => l.cliente === n);
  check(fila('HAALAND').saldo === 100 && fila('HAALAND').tipoAccion === 'MARCAS' && fila('HAALAND').detalle === 'Carga Masiva', '2b) cada fila trae cliente, saldo, tipo de acción (MARCAS) y detalle "Carga Masiva"');
  check(fila('% TABLAS Y MARCAS').cuentaGrupo === true && fila('HAALAND').cuentaGrupo === false, '2c) "% TABLAS Y MARCAS" se reconoce como cuenta del grupo');
  r = await post('/cargas-especiales/previsualizar', { texto: 'HALAND +100\nMARCAS ZENYATTA -100', accion: 'MARCAS', fecha: FECHA });
  check(r.salida && r.salida.ok === false && r.salida.errores[0] === 'CLIENTE HALAND NO EXISTE' && r.salida.lineas.find(l => l.cliente === 'HALAND').existe === false, '2d) un nombre mal escrito (HALAND) da "CLIENTE HALAND NO EXISTE" y no deja confirmar');
  r = await post('/cargas-especiales/previsualizar', { texto: 'JOSE +10\nLIONEL -5', accion: 'REMATE', fecha: FECHA });
  check(r.salida && r.salida.ok === false && r.salida.errores.some(e => /Diferencia: \+5\.00/.test(e)), '2e) vista previa de algo que no suma 0 trae el error con la diferencia');
  r = await post('/cargas-especiales/previsualizar', { texto: 'JOSE +10\nREMATE -10', accion: 'REMATE', fecha: FECHA });
  check(r.salida && r.salida.ok === true, '2f) la cuenta REMATE (contrapartida) se acepta aunque no sea un cliente');

  // ---------- 3) Confirmar ----------
  r = await post('/cargas-especiales', { texto: 'JOSE +10\nLIONEL -5', accion: 'REMATE', fecha: FECHA });
  check(r.status === 400 && TABLAS.hipismo_cargas_especiales.length === 0, '3a) no se puede confirmar si no suma 0 (400) y no se guarda nada');
  r = await post('/cargas-especiales', { texto: 'HALAND +100\nMARCAS ZENYATTA -100', accion: 'MARCAS', fecha: FECHA });
  check(r.status === 422 && /CLIENTE HALAND NO EXISTE/.test(r.salida.error) && TABLAS.hipismo_cargas_especiales.length === 0, '3b) un cliente inexistente da 422 "CLIENTE HALAND NO EXISTE" y no se guarda nada');
  r = await post('/cargas-especiales', { texto: TEXTO, accion: 'NOEXISTE', fecha: FECHA });
  check(r.status === 400 && TABLAS.hipismo_cargas_especiales.length === 0, '3c) no se puede confirmar con una acción que no está en la lista');
  r = await post('/cargas-especiales', { texto: TEXTO, accion: 'DEPORTE', hipodromo: 'HIPODROMO FANTASMA', fecha: FECHA });
  check(r.status === 400 && TABLAS.hipismo_cargas_especiales.length === 0, '3d) no se puede confirmar con un hipódromo que no existe');
  r = await post('/cargas-especiales', { texto: TEXTO, accion: 'deporte', fecha: FECHA, carrera: ' 1 ' });
  check(r.status === 201 && r.salida.ok, '3e) confirmar un texto que suma 0 responde 201');
  check(TABLAS.hipismo_cargas_especiales.length === 1 && TABLAS.hipismo_cargas_especiales[0].carrera === '1' && TABLAS.hipismo_cargas_especiales[0].codigo_nombre === 'DEPORTE', '3f) se guardó 1 carga con su carrera y su acción en MAYÚSCULA');
  check(TABLAS.hipismo_cargas_especiales_lineas.length === 5, '3g) se guardaron las 5 líneas');
  check(Math.abs(TABLAS.hipismo_cargas_especiales_lineas.reduce((s, l) => s + l.monto, 0)) < 1e-9, '3h) lo guardado suma 0');
  check(!TABLAS.insertsJugadores, '3i) NO se creó ningún cliente solo (regla nueva)');

  // ---------- 5) Saldos: grilla (Cierre Final) ----------
  const cierre = await construirCierreFinalHipismo(GRUPO_ID, FECHA, FECHA);
  const saldo = n => { const c = cierre.clientes.find(x => x.nombre === n); return c ? Math.round(c.saldo * 100) / 100 : null; };
  check(saldo('JOSE') === -33, `5a) JOSE = -33 (Tercios -10 + carga especial -23) -- dio ${saldo('JOSE')}`);
  check(saldo('LIONEL') === -50 && saldo('MONCLER') === -100, '5b) LIONEL -50 y MONCLER -100 (clientes que solo tienen la carga)');
  check(saldo('RAFAEL PARLEY') === 100 && saldo('PARLEY FORTUNA') === 73, '5c) RAFAEL PARLEY +100 y PARLEY FORTUNA +73');
  const sumaCargas = ['LIONEL', 'MONCLER', 'RAFAEL PARLEY', 'PARLEY FORTUNA'].reduce((s, n) => s + saldo(n), 0) + (saldo('JOSE') + 10);
  check(Math.abs(sumaCargas) < 0.001, '5d) las cargas no cambian el total (suman 0)');

  // ---------- 6) Link de cada cliente = grilla ----------
  for (const nombre of ['JOSE', 'LIONEL', 'MONCLER', 'RAFAEL PARLEY', 'PARLEY FORTUNA']) {
    const j = TABLAS.jugadores.find(x => x.nombre === nombre);
    const res = await construirResumenClienteHipismo(j, reqBase.grupo, 'actual', { desde: FECHA, hasta: FECHA });
    check(Math.abs(res.resumen.totalHipismo - saldo(nombre)) < 0.001, `6) link de ${nombre} = grilla (${saldo(nombre)}) -- dio ${res.resumen.totalHipismo}`);
  }
  const jLionel = TABLAS.jugadores.find(x => x.nombre === 'LIONEL');
  const resLionel = await construirResumenClienteHipismo(jLionel, reqBase.grupo, 'actual', { desde: FECHA, hasta: FECHA });
  const bloque = resLionel.dias[0] && resLionel.dias[0].hipodromos.find(h => h.nombre === 'Deporte (Carga Masiva)');
  check(!!bloque && bloque.tipo === 'traspaso' && bloque.carreras[0].resultado === -50 && /Carrera 1/.test(bloque.carreras[0].nota) && /Todos los hipódromos/.test(bloque.carreras[0].nota),
    '6b) en su link aparece el bloque "Deporte (Carga Masiva)" con -50, la carrera y el hipódromo');

  // ---------- 7) Diagnóstico grilla vs link ----------
  const diag = await invocarRuta(handlerDe('get', '/diagnostico-saldos'), { ...reqBase, query: { desde: FECHA, hasta: FECHA } });
  check(diag.salida && diag.salida.discrepancias.length === 0, `7) diagnóstico: 0 discrepancias con cargas especiales -- ${JSON.stringify(diag.salida && diag.salida.discrepancias)}`);

  // ---------- 8) Semana por días ----------
  const sem = await invocarRuta(handlerDe('get', '/semana-por-dias'), { ...reqBase, query: { semana: 'anterior' } });
  const tot = n => { const c = sem.salida && sem.salida.clientes.find(x => x.nombre === n); return c ? c.totalSemana : null; };
  check(tot('JOSE') === -33 && tot('LIONEL') === -50 && tot('RAFAEL PARLEY') === 100, `8) /semana-por-dias suma las cargas (JOSE ${tot('JOSE')}, LIONEL ${tot('LIONEL')}, RAFAEL ${tot('RAFAEL PARLEY')})`);

  // ---------- 9) Historial, editar, eliminar ----------
  let hist = await invocarRuta(handlerDe('get', '/cargas-especiales'), reqBase);
  check(hist.salida.cargas.length === 1 && hist.salida.cargas[0].lineas.length === 5 && hist.salida.cargas[0].ganan === 173 && hist.salida.cargas[0].pierden === -173, '9a) el historial trae la carga con sus líneas y totales');
  check(hist.salida.cargas[0].accion === 'DEPORTE' && Array.isArray(hist.salida.acciones) && hist.salida.acciones.includes('MARCAS'), '9b) el historial trae la acción de la carga y la lista de acciones');
  const idCarga = hist.salida.cargas[0].id;
  // Editar: corrige LIONEL a -40 y MONCLER a -110 (sigue sumando 0)
  r = await invocarRuta(handlerDe('put', '/cargas-especiales/:id'), { ...reqBase, params: { id: idCarga }, body: { texto: 'JOSE -23\nLIONEL -40\nMONCLER -110\nRAFAEL PARLEY +100\nPARLEY FORTUNA +73', accion: 'DEPORTE', hipodromo: 'LA RINCONADA', fecha: FECHA, carrera: '2' } });
  check(r.salida && r.salida.ok && TABLAS.hipismo_cargas_especiales_lineas.length === 5 && TABLAS.hipismo_cargas_especiales[0].carrera === '2' && TABLAS.hipismo_cargas_especiales[0].hipodromo_nombre === 'LA RINCONADA', '9c) editar reemplaza las líneas (siguen 5) y actualiza la carrera y el hipódromo');
  const cierre2 = await construirCierreFinalHipismo(GRUPO_ID, FECHA, FECHA);
  check(cierre2.clientes.find(x => x.nombre === 'LIONEL').saldo === -40 && cierre2.clientes.find(x => x.nombre === 'MONCLER').saldo === -110, '9d) los saldos reflejan la edición (LIONEL -40, MONCLER -110)');
  r = await invocarRuta(handlerDe('put', '/cargas-especiales/:id'), { ...reqBase, params: { id: idCarga }, body: { texto: 'JOSE -23\nLIONEL -40', accion: 'DEPORTE', fecha: FECHA } });
  check(r.status === 400 && TABLAS.hipismo_cargas_especiales_lineas.length === 5, '9e) editar con algo que no suma 0 da 400 y no cambia nada');
  r = await invocarRuta(handlerDe('put', '/cargas-especiales/:id'), { ...reqBase, params: { id: 'no-existe' }, body: { texto: TEXTO, accion: 'DEPORTE', fecha: FECHA } });
  check(r.status === 404, '9f) editar una carga inexistente da 404');
  r = await invocarRuta(handlerDe('delete', '/cargas-especiales/:id'), { ...reqBase, params: { id: idCarga } });
  check(r.salida && r.salida.ok && TABLAS.hipismo_cargas_especiales.length === 0 && TABLAS.hipismo_cargas_especiales_lineas.length === 0, '9g) eliminar borra la carga y todas sus líneas');
  const cierre3 = await construirCierreFinalHipismo(GRUPO_ID, FECHA, FECHA);
  check(!cierre3.clientes.find(x => x.nombre === 'LIONEL' && x.saldo !== 0) && cierre3.clientes.find(x => x.nombre === 'JOSE').saldo === -10, '9h) tras eliminar, JOSE vuelve a -10 y LIONEL a 0');
  r = await invocarRuta(handlerDe('delete', '/cargas-especiales/:id'), { ...reqBase, params: { id: idCarga } });
  check(r.status === 404, '9i) eliminar de nuevo da 404');

  // ---------- 10) Pantalla ----------
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const iCargar = html.indexOf('data-vista="cargarPlanos"');
  const iCme = html.indexOf('data-vista="cargaMasivaEspecial"');
  check(iCme > iCargar && iCme - iCargar < 700, '10a) el botón "Carga Masiva Especial" está justo debajo de "Cargar Planos" en el menú');
  check(/id="vista-cargaMasivaEspecial"/.test(html) && /id="selCmeHipodromo"/.test(html) && /id="selCmeAccion"/.test(html) && /id="txtCmeLineas"/.test(html) && /id="btnCmeAplicar"/.test(html) && !/selCmeCodigo/.test(html), '10b) la pantalla tiene hipódromo, acción, fecha, carrera, texto libre, calcular y confirmar (y ya no el código)');
  check(/cargaMasivaEspecial:\s*\(\)\s*=>\s*entrarCargaMasivaEspecial\(\)/.test(html), '10c) al entrar se cargan las acciones y las cargas recientes');
  check(/NO EXISTE/.test(html) && /Tipo de acción/.test(html), '10d) la vista previa marca "NO EXISTE" y trae la columna "Tipo de acción"');

  // ---------- 11) Ejemplo de Marcas completo: HAALAND / MARCAS ZENYATTA / MARCAS SAMMY / % TABLAS Y MARCAS ----------
  r = await post('/cargas-especiales', { texto: TEXTO_MARCAS, accion: 'MARCAS', hipodromo: 'LA RINCONADA', fecha: FECHA, carrera: '4' });
  check(r.status === 201 && TABLAS.hipismo_cargas_especiales.length === 1 && TABLAS.hipismo_cargas_especiales_lineas.length === 4, '11a) el ejemplo de Marcas se confirma (4 líneas)');
  const cierre4 = await construirCierreFinalHipismo(GRUPO_ID, FECHA, FECHA);
  const s4 = n => { const c = cierre4.clientes.find(x => x.nombre === n); return c ? Math.round(c.saldo * 100) / 100 : null; };
  check(s4('HAALAND') === 100 && s4('MARCAS ZENYATTA') === -50 && s4('MARCAS SAMMY') === -51.25 && s4('% TABLAS Y MARCAS') === 1.25, `11b) cada cuenta queda en su sitio: HAALAND +100, MARCAS ZENYATTA -50, MARCAS SAMMY -51,25, % TABLAS Y MARCAS +1,25 -- dio ${s4('HAALAND')}/${s4('MARCAS ZENYATTA')}/${s4('MARCAS SAMMY')}/${s4('% TABLAS Y MARCAS')}`);
  const jHaaland = TABLAS.jugadores.find(x => x.nombre === 'HAALAND');
  const resH = await construirResumenClienteHipismo(jHaaland, reqBase.grupo, 'actual', { desde: FECHA, hasta: FECHA });
  const bloqueH = resH.dias[0] && resH.dias[0].hipodromos.find(h => h.nombre === 'Marcas (Carga Masiva)');
  check(!!bloqueH && bloqueH.carreras[0].resultado === 100 && /LA RINCONADA/.test(bloqueH.carreras[0].nota) && /Carrera 4/.test(bloqueH.carreras[0].nota), '11c) en el link de HAALAND aparece "Marcas (Carga Masiva)" con +100, LA RINCONADA y la carrera 4');
  const diag2 = await invocarRuta(handlerDe('get', '/diagnostico-saldos'), { ...reqBase, query: { desde: FECHA, hasta: FECHA } });
  check(diag2.salida && diag2.salida.discrepancias.length === 0, `11d) diagnóstico: 0 discrepancias también con el ejemplo de Marcas -- ${JSON.stringify(diag2.salida && diag2.salida.discrepancias)}`);
  check(!TABLAS.insertsJugadores, '11e) todavía NO se creó ningún cliente solo');
  const detCuenta = await invocarRuta(handlerDe('get', '/clientes/:nombre/detalle-semana'), { ...reqBase, params: { nombre: '% TABLAS Y MARCAS' }, query: { desde: FECHA, hasta: FECHA } });
  const bloqueCuenta = detCuenta.salida && detCuenta.salida.dias && detCuenta.salida.dias[0] && detCuenta.salida.dias[0].hipodromos.find(h => h.nombre === 'Marcas (Carga Masiva)');
  check(detCuenta.status === 200 && !!bloqueCuenta && bloqueCuenta.carreras[0].resultado === 1.25 && Math.abs(detCuenta.salida.resumen.totalHipismo - 1.25) < 0.001, `11f) la cuenta del grupo "% TABLAS Y MARCAS" se puede abrir en Detallado por Cliente (no da "No se encontró") con su +1,25 -- status ${detCuenta.status}`);
  const detFantasma = await invocarRuta(handlerDe('get', '/clientes/:nombre/detalle-semana'), { ...reqBase, params: { nombre: 'NO EXISTE NADIE' }, query: { desde: FECHA, hasta: FECHA } });
  check(detFantasma.status === 404, '11g) un nombre que no es cliente ni cuenta del grupo sigue dando 404');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
