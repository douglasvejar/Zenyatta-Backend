// =================================================================
// PRUEBA: AUDITORÍA DE DECIMALES (11-10-2026, a pedido del usuario: "REVISA LOS
// DECIMALES DE TODOS LOS ITEM DE TODAS LAS JUGADAS DE TODOS LOS BALANCES EN LOS DOS
// MODULOS DE HIPISMO").
//   (a) Semanas aleatorias con centavos "difíciles": TODO número que devuelven
//       /cierre-final (Balance General), /semana-por-dias, /comisiones-devueltas,
//       /saldo-comisiones y el detalle de CADA cliente/ítem (incluidos
//       "% TABLAS FIJAS" y "% MARCAS") tiene como máximo 2 decimales (nada de
//       0,30000000000000004) y nunca "-0".
//   (b) Los formateadores de las pantallas (Grupo, Oficinas, portal del cliente)
//       redondean igual que el servidor: el medio centavo sube, "-0,00" no existe
//       y el dinero siempre lleva 2 decimales.
// =================================================================
// =================================================================
// PRUEBA: GRILLA == LINK, SIEMPRE, AL CENTAVO (05-10-2026). El usuario vio en
// Detallado por Cliente "5 de 75 cliente(s) no cuadran" con diferencias de
// $0,01 (Mrmoney, Mujica, Sammy, Sebastian, Zamuray) y pidió: "NO QUIERO MAS
// DIFERENCIA, EN NINGUN GRUPO UN CENTAVO A LA LARGA REPRESENTA CIENTOS DE
// DOLARES... PARA MAS NUNCA PRESENTAR ESTOS ERRORES".
//
// CAUSA: round2() era Math.round((n + Number.EPSILON) * 100) / 100. Cuando un
// % cae justo en medio centavo (ej. 12,50 * 1% = 0,125) el producto en
// coma flotante queda un pelo arriba o un pelo abajo de 0,125 según el ORDEN
// en que se sumaron las bases (la Grilla suma por un camino, el Link por
// otro), y entonces uno redondeaba a 0,13 y el otro a 0,12. Ahora round2()
// es a prueba de empates (medio centavo siempre sube, en valor absoluto), así
// que ambos caminos dan el mismo número sin importar el orden.
//
// Esta prueba (a) verifica round2() en los empates de medio centavo y (b)
// genera cientos de semanas aleatorias (Tercios con varias jugadas por
// carrera, clientes duales, jugadas "a premio", % propio con la cuenta
// aparte y con "incluir % en sus jugadas", avales, Tablas Fijas/Marcas con
// banqueadores, Jugadas entre Tercios Adelantadas y planos cruzados) y exige
// que diagnosticarSaldosHipismo() dé CERO discrepancias. Con el round2()
// anterior esta misma prueba encontraba ~1 semana mala de cada 130.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-fz-1';
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
    const [g, d1, d2] = params;
    return { rows: (TABLAS.hipismo_adelantadas_jugadas || []).filter(j => j.fecha >= d1 && j.fecha <= d2) };
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
        fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero, pizarra: p.pizarra || null, pais: 'VE', sin_comision: t.sin_comision || false, plano_id: t.plano_id, cruza_jugadas: p.cruza_jugadas || false
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
    const [g, nombre, d1, d2] = params;
    return { rows: (TABLAS.hipismo_adelantadas_jugadas || []).filter(j => j.fecha >= d1 && j.fecha <= d2 && (j.cliente_nombre === nombre || (Array.isArray(j.banqueadores) && j.banqueadores.some(b => b.nombre === nombre)))).map(j => Object.assign({ pais: 'VE', numero_ejemplar: 1, numero1: null, numero2: null, cantidad_tf: 1, pizarra_usada: null }, j)) };
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
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1 AND nombre = \$2$/i.test(sql)) {
    const [grupoId, nombre] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && j.nombre === nombre) };
  }
  if (/^SELECT j\.cliente_nombre, j\.carrera_numero, j\.numero_ejemplar, j\.monto, j\.resultado_cliente[\s\S]*FROM hipismo_adelantadas_jugadas/i.test(sql)) {
    const tipo = /j\.tipo = \$4/.test(sql) ? params[3] : 'tf';
    return { rows: (TABLAS.hipismo_adelantadas_jugadas || []).filter(j => j.tipo === tipo && (tipo !== 'tf' || !Array.isArray(j.banqueadores))).map(j => Object.assign({ numero_ejemplar: null, pizarra_usada: null, pais: 'VE' }, j)) };
  }
  if (/FROM hipismo_remates|FROM hipismo_winners/i.test(sql)) return { rows: [] };
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


let seed = 1;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(arr) { return arr[ri(0, arr.length - 1)]; }
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
function monto() { return r2(ri(100, 90000) / 100); }


// Revisa recursivamente TODO número de una respuesta: ningún monto puede traer
// más de 2 decimales (ruido de coma flotante tipo 0.30000000000000004) ni -0.
const malos = [];
function escanear(valor, ruta, padre) {
  if (valor == null) return;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) { malos.push(ruta + ' = ' + valor); return; }
    if (Object.is(valor, -0)) malos.push(ruta + ' = -0');
    else if (Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6) malos.push(ruta + ' = ' + valor + (padre && padre.tipo ? ' <tipo ' + padre.tipo + '>' : ''));
    return;
  }
  if (Array.isArray(valor)) { valor.forEach((v, k) => escanear(v, ruta + '[' + k + ']')); return; }
  if (typeof valor === 'object') { Object.keys(valor).forEach(k => escanear(valor[k], ruta + '.' + k, valor)); }
}
const CAMPOS_NO_MONTO = /(porcentaje|pct|comisionPorcentaje|numero|carrera|ejemplar|cantidad|jugadas|id$|monto_pct|semana)/i;

(async function main() {
  const N = 60;
  const grupo = { nombre: 'Zenyatta', logo_url: null, modulo_deportes_habilitado: true };
  const ejemplos = [];
  let escenariosMalos = 0;
  for (let s = 0; s < N; s++) {
    const nombres = ['ANA', 'BETO', 'CARLOS', 'DINA', 'EDU', 'FELIX', 'GINA'];
    const jugadores = [];
    nombres.forEach((n, k) => {
      const pct = pick([0, 0, 1, 2, 2.5, 3, 5]);
      const incl = pct > 0 && rnd() < 0.4;
      const tieneCuenta = pct > 0 && !incl && rnd() < 0.7;
      jugadores.push(jug('j-' + n, n, { comision_propia: pct, incluir_porcentaje_en_jugadas: incl, cuenta_comision_id: tieneCuenta ? 'j-' + n + '-cta' : null }));
      if (tieneCuenta) jugadores.push(jug('j-' + n + '-cta', n + ' - PORCENTAJE', { es_cuenta_comision: true }));
    });
    jugadores.push(jug('j-BANCO', 'BANCO'));
    TABLAS.jugadores = jugadores;
    // avales
    TABLAS.jugadores_avales_porcentaje = [];
    const av = { a: pick(['CARLOS', 'DINA', 'EDU', 'FELIX', 'GINA']), b: pick(['ANA', 'BETO']) };
    if (rnd() < 0.6) TABLAS.jugadores_avales_porcentaje.push({ grupo_id: GRUPO_ID, jugador_id: 'j-' + av.a, avalador_id: 'j-' + av.b, porcentaje: pick([1, 2, 3]) });
    const todos = nombres.concat(['BANCO']);
    const planos = [], tickets = [], ta = [];
    const nCarreras = ri(2, 8);
    for (let c = 0; c < nCarreras; c++) {
      const fecha = '2026-10-0' + ri(1, 4);
      const hip = pick(['Keeneland', 'Belmont']);
      const pid = 'p-' + c;
      planos.push({ id: pid, grupo_id: GRUPO_ID, hipodromo_nombre: hip, carrera_numero: c + 1, fecha, cruza_jugadas: rnd() < 0.2, comision_total: 0 });
      const nT = ri(1, 7);
      for (let t = 0; t < nT; t++) {
        const cl = pick(todos); let ba = pick(todos); while (ba === cl) ba = pick(todos);
        const L = monto();
        const sinC = rnd() < 0.1;
        if (rnd() < 0.5) tickets.push({ plano_id: pid, grupo_id: GRUPO_ID, cliente_nombre: cl, banquero_nombre: ba, modalidad: '1p', caballo: '2', monto: L, resultado_jugador: -L, resultado_banquero: sinC ? L : r2(L * 0.95), sin_comision: sinC });
        else tickets.push({ plano_id: pid, grupo_id: GRUPO_ID, cliente_nombre: cl, banquero_nombre: ba, modalidad: '1p', caballo: '2', monto: L, resultado_jugador: sinC ? L : r2(L * 0.95), resultado_banquero: -L, sin_comision: sinC });
      }
      if (rnd() < 0.5) {
        const cl = pick(todos); let ba = pick(todos); while (ba === cl) ba = pick(todos);
        const base = monto(); const pct = pick([5, 10]);
        const gana = rnd() < 0.5;
        ta.push({ id: 'ta-' + c, grupo_id: GRUPO_ID, jugador_nombre: cl, banquero_nombre: ba, carrera_numero: c + 1, hipodromo_nombre: hip, fecha, es_cruce: false, grupo_caballos: [3], cruce_grupo_a: null, cruce_grupo_b: null, modalidad: '1p', monto: base, resultado_jugador: gana ? r2(base * (1 - pct / 100)) : -base, resultado_banquero: gana ? -base : r2(base * (1 - pct / 100)), comision_grupo: r2(base * pct / 100), comision_porcentaje: pct, pizarra_usada: '3.1.2', estado: 'resuelto' });
      }
    }
    const ade = [], win = [];
    for (let c = 0; c < nCarreras; c++) {
      if (rnd() < 0.6) {
        const cl = pick(todos); const tipo = pick(['tf', 'marca']);
        const R = r2((rnd() < 0.5 ? -1 : 1) * monto());
        const bq = [];
        if (tipo === 'marca') {
          let resto = 100; const n = ri(1, 3);
          for (let b = 0; b < n; b++) { const pc = b === n - 1 ? resto : ri(10, Math.max(10, resto - 10 * (n - b - 1))); resto -= pc; if (pc > 0) bq.push({ nombre: pick(todos), porcentaje: pc, monto: r2(-R * pc / 100) }); }
        }
        ade.push({ cliente_nombre: cl, tipo, resultado_cliente: R, comision: 0, banqueadores: tipo === 'marca' ? bq : null, monto: Math.abs(R), gano: R > 0, fecha: planos[c].fecha, hipodromo_nombre: planos[c].hipodromo_nombre, carrera_numero: c + 1, estado: 'resuelto' });
      }
    }
    TABLAS.hipismo_adelantadas_jugadas = ade;
    TABLAS.hipismo_planos = planos; TABLAS.hipismo_tickets = tickets; TABLAS.hipismo_tercios_adelantadas_jugadas = ta;

    TABLAS.hipismo_adelantadas_jugadas = ade;
    TABLAS.hipismo_planos = planos; TABLAS.hipismo_tickets = tickets; TABLAS.hipismo_tercios_adelantadas_jugadas = ta;
    const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: { desde: '2026-10-01', hasta: '2026-10-04' } };
    const rutas = [['get', '/cierre-final'], ['get', '/semana-por-dias'], ['get', '/comisiones-devueltas'], ['get', '/saldo-comisiones']];
    for (const [m, p] of rutas) {
      let salida;
      try { salida = await invocarRuta(handlerDe(m, p), Object.assign({}, reqBase)); } catch (e) { salida = null; }
      if (!salida) { if (s === 0) console.log('   (sin respuesta de', p, ')'); continue; }
      escanear(salida, p);
    }
    const cierre = await invocarRuta(handlerDe('get', '/cierre-final'), Object.assign({}, reqBase));
    if (cierre) {
      for (const c of cierre.clientes) {
        const det = await invocarRuta(handlerDe('get', '/clientes/:nombre/detalle-semana'), Object.assign({}, reqBase, { params: { nombre: c.nombre } }));
        if (det) escanear(det, 'detalle[' + c.nombre + ']');
      }
    }
  }
  // (b) formateadores del front, evaluados tal cual están en los HTML
  const fs = require('fs');
  function extraer(archivo, nombre) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', archivo), 'utf8');
    const i = html.indexOf('function ' + nombre + '(');
    if (i < 0) throw new Error('no encontré ' + nombre + ' en ' + archivo);
    let d = 0, j = html.indexOf('{', i);
    for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (d === 0) return html.slice(i, k + 1); } }
  }
  const mock = new Function(extraer('hipismo-mockup.html', 'redondearCentavos') + extraer('hipismo-mockup.html', 'formatMonto') + extraer('hipismo-mockup.html', 'formatMontoTabla') + extraer('hipismo-mockup.html', 'formatMontoDet') + 'return { formatMonto, formatMontoTabla, formatMontoDet };')();
  const nbsp = t => t.replace(/\u00a0/g, ' ');
  check(nbsp(mock.formatMonto(-1e-7)) === '$ 0,00' && nbsp(mock.formatMontoDet(-1e-7)) === '0,00', 'Pantalla Grupo: un total con ruido (-0,0000001) sale 0,00 y NO "-0,00"');
  check(nbsp(mock.formatMonto(1.005)) === '$ 1,01' && nbsp(mock.formatMonto(-0.125)) === '-$ 0,13' && nbsp(mock.formatMontoTabla(2.675)) === '2,68', 'Pantalla Grupo: el medio centavo sube igual que el servidor (1,005 -> 1,01; -0,125 -> -0,13; 2,675 -> 2,68)');
  const oficinas = new Function(extraer('hipismo-mockup.html', 'redondearCentavos') + extraer('hipismo-oficinas.html', 'fmt') + 'return { fmt };')();
  check(nbsp(oficinas.fmt(5.5)) === '5,50' && nbsp(oficinas.fmt(-1e-9)) === '0,00', 'Hipismo Oficinas: 5,5 se ve 5,50 y el ruido no sale "-0,00"');
  const portal = new Function(extraer('hipismo-cliente-portal.html', 'aCentavos') + extraer('hipismo-cliente-portal.html', 'formatMonto') + 'return { formatMonto };')();
  check(nbsp(portal.formatMonto(-1e-9)) === '0,00' && nbsp(portal.formatMonto(1.005)) === '1,01', 'Portal del cliente: sin "-0,00" y con el mismo redondeo');
  const informes = require(path.join(__dirname, '..', 'public', 'oficinas-informes.js'));
  check(informes.r2(1.005) === 1.01 && informes.r2(-0.125) === -0.13 && Object.is(informes.r2(-1e-9), 0), 'Informes de Oficinas: r2 redondea igual que el servidor');
  const patrones = {}; malos.forEach(x => { const base = x.replace(/ = [-\d.e]+/, ''); const k = base.replace(/\[[^\]]*\]/g, '[]').replace(/^detalle\[\]/, 'detalle'); patrones[k] = (patrones[k] || 0) + 1; });
  const unicos = Object.keys(patrones).map(k => k + ' x' + patrones[k]);
  check(malos.length === 0, `Ningún monto con ruido de decimales (${malos.length} hallazgos; tipos: ${JSON.stringify(unicos.slice(0, 15))}; ejemplos: ${JSON.stringify(malos.slice(0, 8))})`);
  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  process.exit(fallaron ? 1 : 0);
})();
