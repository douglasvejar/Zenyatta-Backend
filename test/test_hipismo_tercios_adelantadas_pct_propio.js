// =================================================================
// PRUEBA: "Jugadas entre Tercios Adelantadas" ahora generan el % propio /
// de aval del cliente EN TODOS LADOS (05-10-2026, a pedido explícito del
// usuario, tras ver "12 de 72 cliente(s) no cuadran" en Detallado por
// Cliente: Grilla vs Link, siempre el link más alto). Causa: el link (y las
// cuentas de comisión/avalados) SÍ cobraban su % sobre estas jugadas
// (obtenerLineasHipismoCliente ya las traía), pero la grilla (Cierre Final,
// la referencia "golden") nunca las contaba. El usuario decidió: "Sí, que lo
// gane en todos lados".
//
// Escenario (una carrera de Keeneland, fecha FECHA):
//   - TAJUG: % propio 1% a su ficha dedicada "TAJUG - PORCENTAJE" (toggle
//     OFF). Pierde 33,33 en Tercios Y gana (jugador) una Jugada entre
//     Tercios Adelantadas de $100 con 5% en ESA misma carrera
//     (resultado 95 -> base decidida 100): la base fusionada de la
//     carrera es 133,33 -> 1% = 1,33 -- una sola vez.
//   - TAINC: % propio 2% con el toggle "incluir % en sus jugadas" ON.
//     BANQUEA una Adelantada entre Tercios (pierde 200, pct 5, su lado
//     perdedor lleva la fracción completa -> base 200) -> 2% = 4,00 dentro
//     de su propio saldo.
//   - FUENTEAV: avalado por AVALADOR al 3% (cond2). Juega una Adelantada
//     entre Tercios con pct 10 (resultado 90 -> base 100) -> 3,00.
//   - TAIGNORADO: una Adelantada entre Tercios 'sin_decidir' (0/0) -- no
//     genera NADA.
//   - BANCOT: banquero del resto (sin % propio).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-ta-pct-1';
const FECHA = '2026-10-02';

function jug(id, nombre, extra) {
  return Object.assign({ id, grupo_id: GRUPO_ID, nombre, comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false, modulos_anclados: false }, extra || {});
}
const TABLAS = {
  jugadores: [
    jug('j-tajug', 'TAJUG', { comision_propia: 1, cuenta_comision_id: 'j-tajug-cta' }),
    jug('j-tajug-cta', 'TAJUG - PORCENTAJE', { es_cuenta_comision: true }),
    jug('j-tainc', 'TAINC', { comision_propia: 2, incluir_porcentaje_en_jugadas: true }),
    jug('j-fuenteav', 'FUENTEAV'),
    jug('j-avalador', 'AVALADOR'),
    jug('j-taignorado', 'TAIGNORADO', { comision_propia: 5 }),
    jug('j-bancot', 'BANCOT')
  ],
  jugadores_avales_porcentaje: [
    { grupo_id: GRUPO_ID, jugador_id: 'j-fuenteav', avalador_id: 'j-avalador', porcentaje: 3 }
  ],
  hipismo_planos: [
    { id: 'p-k5', grupo_id: GRUPO_ID, hipodromo_nombre: 'Keeneland', carrera_numero: 5, fecha: FECHA, cruza_jugadas: false, comision_total: 0 }
  ],
  hipismo_tickets: [
    { plano_id: 'p-k5', grupo_id: GRUPO_ID, cliente_nombre: 'TAJUG', banquero_nombre: 'BANCOT', modalidad: '1p', caballo: '2', monto: 33.33, resultado_jugador: -33.33, resultado_banquero: 33.33 * 0.95, sin_comision: false }
  ],
  hipismo_remates: [], hipismo_remate_apuestas: [],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: [],
  hipismo_winners: [],
  hipismo_comisiones_ajustes: [],
  tickets_historial: [],
  // Jugadas entre Tercios Adelantadas YA resueltas (resultado con el % de
  // comisión aplicado solo a la fracción ganadora, igual que
  // montoMostradoConPct).
  hipismo_tercios_adelantadas_jugadas: [
    // TAJUG gana 100 con 5% -> resultado 95 / banquero pierde 100
    { id: 'ta-1', grupo_id: GRUPO_ID, jugador_nombre: 'TAJUG', banquero_nombre: 'BANCOT', carrera_numero: 5, hipodromo_nombre: 'Keeneland', fecha: FECHA, es_cruce: false, grupo_caballos: [3], cruce_grupo_a: null, cruce_grupo_b: null, modalidad: '1p', monto: 100, resultado_jugador: 95, resultado_banquero: -100, comision_grupo: 5, comision_porcentaje: 5, pizarra_usada: '3.1.2', estado: 'resuelto' },
    // TAINC (banquero) pierde 200: el jugador FUENTEX gana 200 con 5% -> 190
    { id: 'ta-2', grupo_id: GRUPO_ID, jugador_nombre: 'BANCOT', banquero_nombre: 'TAINC', carrera_numero: 6, hipodromo_nombre: 'Keeneland', fecha: FECHA, es_cruce: false, grupo_caballos: [1], cruce_grupo_a: null, cruce_grupo_b: null, modalidad: '1p', monto: 200, resultado_jugador: 190, resultado_banquero: -200, comision_grupo: 10, comision_porcentaje: 5, pizarra_usada: '1.2.3', estado: 'resuelto' },
    // FUENTEAV gana 100 con 10% -> 90 / banquero pierde 100
    { id: 'ta-3', grupo_id: GRUPO_ID, jugador_nombre: 'FUENTEAV', banquero_nombre: 'BANCOT', carrera_numero: 7, hipodromo_nombre: 'Keeneland', fecha: FECHA, es_cruce: false, grupo_caballos: [4], cruce_grupo_a: null, cruce_grupo_b: null, modalidad: '1p', monto: 100, resultado_jugador: 90, resultado_banquero: -100, comision_grupo: 10, comision_porcentaje: 10, pizarra_usada: '4.1.2', estado: 'resuelto' },
    // TAIGNORADO: sin_decidir, no genera nada
    { id: 'ta-4', grupo_id: GRUPO_ID, jugador_nombre: 'TAIGNORADO', banquero_nombre: 'BANCOT', carrera_numero: 8, hipodromo_nombre: 'Keeneland', fecha: FECHA, es_cruce: false, grupo_caballos: [9], cruce_grupo_a: null, cruce_grupo_b: null, modalidad: '1p', monto: 50, resultado_jugador: 0, resultado_banquero: 0, comision_grupo: 0, comision_porcentaje: 5, pizarra_usada: '1.2.3', estado: 'sin_decidir' }
  ]
};

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
  if (/^SELECT j\.cliente_nombre, j\.monto, j\.resultado_cliente, j\.banqueadores, j\.gano,\s*p\.fecha/i.test(sql)) return { rows: [] };

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
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores, j\.monto, j\.gano, p\.fecha/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos/i.test(sql)) return { rows: [] };
  if (/^SELECT p\.fecha AS fecha, j\.comision\s+FROM hipismo_adelantadas_jugadas j/i.test(sql)) return { rows: [] };

  // ---- Jugadas entre Tercios Adelantadas ----
  const filtrarTA = (grupoId, desde, hasta) => TABLAS.hipismo_tercios_adelantadas_jugadas
    .filter(j => j.grupo_id === grupoId && j.fecha >= desde && j.fecha <= hasta && (j.estado === 'resuelto' || j.estado === 'sin_decidir'));
  // construirCierreFinalHipismo
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre, j\.resultado_jugador, j\.resultado_banquero, j\.comision_grupo,\s*j\.comision_porcentaje, p\.fecha, p\.hipodromo_nombre, j\.carrera_numero/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    return { rows: filtrarTA(grupoId, desde, hasta) };
  }
  // obtenerLineasHipismoCliente
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre, j\.carrera_numero, j\.es_cruce,/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    return { rows: filtrarTA(grupoId, desde, hasta).filter(j => j.jugador_nombre === nombre || j.banquero_nombre === nombre).map(j => Object.assign({ pais: 'VE' }, j)) };
  }
  // leerTerciosAdelantadasResueltas (reportes de % devuelto / saldo por día)
  if (/^SELECT j\.id, j\.jugador_nombre, j\.banquero_nombre, j\.carrera_numero, j\.modalidad/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    return { rows: filtrarTA(grupoId, desde, hasta) };
  }
  if (/^SELECT j\.\*[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (ta-pct-propio) no sabe responder: ' + sql);
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
  let salida = null;
  await new Promise((resolve, reject) => {
    const res = { status(c) { this._s = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return salida;
}

(async function main() {
  const reqBase = {
    grupoId: GRUPO_ID,
    grupo: { nombre: 'Zenyatta', logo_url: null, modulo_deportes_habilitado: true },
    params: {}
  };
  const { construirCierreFinalHipismo, construirResumenClienteHipismo } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoResumenCliente'));
  const { montoBaseTerciosAdelantadaExacto } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoTerciosAdelantadasCalc'));

  // 1) helper de base decidida
  check(Math.abs(montoBaseTerciosAdelantadaExacto(95, 5) - 100) < 1e-9, '1a) base de un ganador con 5%: 95 -> 100');
  check(Math.abs(montoBaseTerciosAdelantadaExacto(90, 10) - 100) < 1e-9, '1b) base de un ganador con 10%: 90 -> 100');
  check(montoBaseTerciosAdelantadaExacto(-100, 5) === 100, '1c) base de un perdedor: |r| (100)');
  check(montoBaseTerciosAdelantadaExacto(0, 5) === 0, '1d) base de una jugada sin decidir (0): 0');
  check(Math.abs(montoBaseTerciosAdelantadaExacto(95, undefined) - 100) < 1e-9, '1e) sin % configurado asume 5');

  // 2) DIAGNÓSTICO: ningún cliente queda con discrepancia grilla vs link
  const salida = await invocarRuta(handlerDe('get', '/diagnostico-saldos'), { ...reqBase, query: { desde: FECHA, hasta: FECHA } });
  check(!!salida && Array.isArray(salida.discrepancias), '2a) GET /diagnostico-saldos respondió');
  check(salida && salida.discrepancias.length === 0, `2b) ARREGLO: 0 discrepancias grilla vs link con Tercios Adelantadas -- encontradas: ${JSON.stringify(salida && salida.discrepancias)}`);

  // 3) Grilla (Cierre Final): saldo de cada ficha
  const cierre = await construirCierreFinalHipismo(GRUPO_ID, FECHA, FECHA);
  const saldo = nombre => { const c = cierre.clientes.find(x => x.nombre === nombre); return c ? Math.round(c.saldo * 100) / 100 : null; };
  // TAJUG: Tercios (-33,33) + TA (+95) = 61,67 -- su 1% va a la cuenta aparte
  check(saldo('TAJUG') === 61.67, `3a) TAJUG saldo 61,67 (sin su % adentro, toggle OFF) -- dio ${saldo('TAJUG')}`);
  // Su cuenta: 1% de (33,33 + 100) = 1,3333 -> 1,33 -- UNA sola vez, fusionado por carrera
  check(saldo('TAJUG - PORCENTAJE') === 1.33, `3b) "TAJUG - PORCENTAJE" = 1,33 (1% de 133,33 fusionado por carrera) -- dio ${saldo('TAJUG - PORCENTAJE')}`);
  // TAINC: banqueó y perdió 200; su 2% (4,00) cae en su propia cuenta PORCENTAJE interna o en su saldo
  const tainc = saldo('TAINC');
  const tainc_cta = saldo('TAINC - PORCENTAJE');
  check((tainc === -200 && tainc_cta === 4) || tainc === -196, `3c) TAINC: % propio 2% de 200 = 4,00 (en su cuenta o dentro de su saldo) -- saldo ${tainc}, cuenta ${tainc_cta}`);
  // AVALADOR: 3% de la base 100 de FUENTEAV
  check(saldo('AVALADOR') === 3, `3d) AVALADOR gana su 3% de aval sobre la Adelantada de FUENTEAV (100 -> 3,00) -- dio ${saldo('AVALADOR')}`);
  // TAIGNORADO no genera nada
  check(saldo('TAIGNORADO - PORCENTAJE') === null, '3e) una jugada sin_decidir (0/0) no genera % para nadie');

  // 4) Links
  const jugTAJUG = TABLAS.jugadores.find(j => j.nombre === 'TAJUG');
  const rTAJUG = await construirResumenClienteHipismo(jugTAJUG, reqBase.grupo, 'actual', { desde: FECHA, hasta: FECHA });
  check(Math.abs(rTAJUG.resumen.totalHipismo - 61.67) < 0.001, `4a) link de TAJUG = grilla (61,67) -- dio ${rTAJUG.resumen.totalHipismo}`);
  const jugTAINC = TABLAS.jugadores.find(j => j.nombre === 'TAINC');
  const rTAINC = await construirResumenClienteHipismo(jugTAINC, reqBase.grupo, 'actual', { desde: FECHA, hasta: FECHA });
  check(Math.abs(rTAINC.resumen.totalHipismo - saldo('TAINC')) < 0.001, `4b) link de TAINC (toggle ON) = grilla -- link ${rTAINC.resumen.totalHipismo} vs grilla ${saldo('TAINC')}`);
  const jugAval = TABLAS.jugadores.find(j => j.nombre === 'AVALADOR');
  const rAval = await construirResumenClienteHipismo(jugAval, reqBase.grupo, 'actual', { desde: FECHA, hasta: FECHA });
  check(Math.abs(rAval.resumen.totalHipismo - 3) < 0.001, `4c) link del AVALADOR = 3,00 -- dio ${rAval.resumen.totalHipismo}`);
  const jugCta = TABLAS.jugadores.find(j => j.nombre === 'TAJUG - PORCENTAJE');
  const rCta = await construirResumenClienteHipismo(jugCta, reqBase.grupo, 'actual', { desde: FECHA, hasta: FECHA });
  check(Math.abs(rCta.resumen.totalHipismo - 1.33) < 0.001, `4d) link de "TAJUG - PORCENTAJE" = 1,33 (una sola línea fusionada por carrera) -- dio ${rCta.resumen.totalHipismo}`);

  // 5) /comisiones-devueltas (reporte de auditoría) trae las Adelantadas entre Tercios
  const dev = await invocarRuta(handlerDe('get', '/comisiones-devueltas'), { ...reqBase, query: { desde: FECHA, hasta: FECHA } });
  const filaTAJUG = dev && dev.clientes.find(c => c.nombre === 'TAJUG');
  check(!!filaTAJUG && Math.abs(filaTAJUG.total - 1.33) < 0.001, `5a) /comisiones-devueltas: TAJUG = 1,33 -- dio ${filaTAJUG && filaTAJUG.total}`);
  const filaTAINC = dev && dev.clientes.find(c => c.nombre === 'TAINC');
  check(!!filaTAINC && Math.abs(filaTAINC.total - 4) < 0.001, `5b) /comisiones-devueltas: TAINC (lado banquero) = 4,00 -- dio ${filaTAINC && filaTAINC.total}`);
  const filaFuente = dev && dev.clientes.find(c => c.nombre === 'FUENTEAV');
  check(!!filaFuente && Math.abs(filaFuente.total - 3) < 0.001, `5c) /comisiones-devueltas: FUENTEAV = 3,00 -- dio ${filaFuente && filaFuente.total}`);
  check(!(dev && dev.clientes.find(c => c.nombre === 'TAIGNORADO')), '5d) /comisiones-devueltas: la jugada sin decidir no genera nada');
  const totalDevolver = dev && dev.totalGeneral;
  check(Math.abs(totalDevolver - (1.33 + 4 + 3)) < 0.001, `5e) total general = 8,33 -- dio ${totalDevolver}`);

  // 6) /saldo-comisiones da lo mismo
  const saldoCom = await invocarRuta(handlerDe('get', '/saldo-comisiones'), { ...reqBase, query: { semana: 'anterior' } });
  check(!!saldoCom, '6a) /saldo-comisiones respondió');
  const sc = nombre => { const c = saldoCom && saldoCom.clientes.find(x => x.nombre === nombre); return c ? c.devueltoSemana : null; };
  check(sc('TAJUG') === 1.33, `6b) /saldo-comisiones: TAJUG = 1,33 -- dio ${sc('TAJUG')}`);
  check(sc('TAINC') === 4, `6c) /saldo-comisiones: TAINC = 4,00 -- dio ${sc('TAINC')}`);
  check(sc('FUENTEAV') === 3, `6d) /saldo-comisiones: FUENTEAV = 3,00 -- dio ${sc('FUENTEAV')}`);
  check(sc('TAIGNORADO') === null, '6e) /saldo-comisiones: la jugada sin decidir no genera nada');
  check(saldoCom && Math.abs(saldoCom.totalGeneral - 8.33) < 0.001, `6f) /saldo-comisiones total = 8,33 -- dio ${saldoCom && saldoCom.totalGeneral}`);

  // 7) /semana-por-dias: antes ignoraba por completo las Tercios Adelantadas
  const sem = await invocarRuta(handlerDe('get', '/semana-por-dias'), { ...reqBase, query: { semana: 'anterior' } });
  check(!!sem, '7a) /semana-por-dias respondió');
  const totSem = nombre => { const c = sem && sem.clientes.find(x => x.nombre === nombre); return c ? c.totalSemana : null; };
  check(totSem('TAJUG') === 61.67 + 1.33 - 1.33 || totSem('TAJUG') === 61.67, `7b) /semana-por-dias: TAJUG = 61,67 (Tercios -33,33 + Adelantada entre tercios +95) -- dio ${totSem('TAJUG')}`);
  check(totSem('TAJUG - PORCENTAJE') === 1.33, `7c) /semana-por-dias: "TAJUG - PORCENTAJE" = 1,33 -- dio ${totSem('TAJUG - PORCENTAJE')}`);
  check(totSem('AVALADOR') === 3, `7d) /semana-por-dias: AVALADOR = 3,00 -- dio ${totSem('AVALADOR')}`);
  check(totSem('BANCOT') !== null, '7e) /semana-por-dias: BANCOT aparece (banquero de las Adelantadas entre tercios)');
  // Comisión bruta de las Adelantadas entre tercios (5+10+10=25) menos lo devuelto (8,33)
  check(sem && Math.abs(sem.comisionSemana - (25 - 8.33)) < 0.01, `7f) /semana-por-dias: comisión real = 25 - 8,33 = 16,67 -- dio ${sem && sem.comisionSemana}`);

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
