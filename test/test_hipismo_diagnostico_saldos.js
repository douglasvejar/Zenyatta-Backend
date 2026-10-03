// =================================================================
// PRUEBA: GET /api/hipismo/diagnostico-saldos (03-10-2026, a pedido del
// usuario después de encontrar el caso "Legolas" — grilla $2.863,98 vs
// link $2.871,98 — justo después de haber arreglado el mismo tipo de
// error para "Mrmoney": "encontré otro cliente con el mismo error...
// necesito soluciones este error de raíz para todos"). Esta ruta corre
// construirCierreFinalHipismo() (la referencia "golden") y
// construirResumenClienteHipismo() (lo que ve el cliente en su link/modal)
// para CADA cliente real de un grupo y reporta cualquiera que no cuadre,
// en vez de depender de que alguien mande una captura de pantalla.
//
// Este fixture junta, en un solo grupo, TODOS los casos ya arreglados
// este mismo día para confirmar que los 2 cálculos siguen cuadrando para
// cada uno:
//   - HANRY: cliente normal simple (sanity check).
//   - GG + "GG - PORCENTAJE": neteo jugador/banquero por carrera (caso
//     real "GG") Y % propio redirigido a una ficha dedicada YA LINKEADA
//     (cuenta_comision_id), para probar calcularDevueltoDestinoHipismo
//     en su variante "cond1" (% propio redirigido), no solo "cond2"
//     (aval) que ya cubrió el caso Mrmoney.
//   - FUENTE1 avalado por MRMONEYLIKE: % de aval sobre un cliente NORMAL
//     (caso real "Mrmoney", variante "cond2").
//   - LEGOLASLIKE: jugada propia + Traspaso de Comisión (caso real
//     "Legolas" ya arreglado el mismo día, commit 99f7307) — reproduce
//     ese mismo escenario para confirmar que sigue cuadrando en sandbox,
//     ya que en producción el usuario reportó un $8 de diferencia nuevo
//     con datos reales que esta prueba no puede ver.
//   - DEPORTIVO: Hipismo + Deportes anclado — confirma que el diagnóstico
//     compara contra totalHipismo (nunca totalSemana), para no marcar
//     como "discrepancia" a cualquier cliente con Deportes anclado solo
//     porque su link suma Deportes y Cierre Final (100% Hipismo) nunca lo
//     tuvo que sumar.
//   - Un Remate de HANRY, para confirmar que el ítem pseudo "REMATE" (sin
//     fila propia en "jugadores") se salta solo, sin reventar.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-diagnostico-1';
const FECHA = '2026-10-02';

const TABLAS = {
  jugadores: [
    { id: 'j-hanry', grupo_id: GRUPO_ID, nombre: 'HANRY', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false, modulos_anclados: false },
    { id: 'j-gg', grupo_id: GRUPO_ID, nombre: 'GG', comision_propia: 1, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: 'j-gg-cta', es_cuenta_comision: false, modulos_anclados: false },
    { id: 'j-gg-cta', grupo_id: GRUPO_ID, nombre: 'GG - PORCENTAJE', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: true, modulos_anclados: false },
    { id: 'j-marlon1', grupo_id: GRUPO_ID, nombre: 'MARLON1', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false, modulos_anclados: false },
    { id: 'j-fuente1', grupo_id: GRUPO_ID, nombre: 'FUENTE1', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false, modulos_anclados: false },
    { id: 'j-mrmoneylike', grupo_id: GRUPO_ID, nombre: 'MRMONEYLIKE', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false, modulos_anclados: false },
    { id: 'j-legolaslike', grupo_id: GRUPO_ID, nombre: 'LEGOLASLIKE', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false, modulos_anclados: false },
    { id: 'j-deportivo', grupo_id: GRUPO_ID, nombre: 'DEPORTIVO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false, modulos_anclados: true },
    { id: 'j-bancoz', grupo_id: GRUPO_ID, nombre: 'BANCOZ', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null, es_cuenta_comision: false, modulos_anclados: false }
  ],
  jugadores_avales_porcentaje: [
    { grupo_id: GRUPO_ID, jugador_id: 'j-fuente1', avalador_id: 'j-mrmoneylike', porcentaje: 2 }
  ],
  hipismo_planos: [
    { id: 'p-carrera7', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 7, fecha: FECHA, cruza_jugadas: false, comision_total: 0 },
    { id: 'p-carrera9', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 9, fecha: FECHA, cruza_jugadas: false, comision_total: 0 },
    { id: 'p-fuente1', grupo_id: GRUPO_ID, hipodromo_nombre: 'Gulfstream Park', carrera_numero: 11, fecha: FECHA, cruza_jugadas: false, comision_total: 0 },
    { id: 'p-legolas', grupo_id: GRUPO_ID, hipodromo_nombre: 'Belmont Park', carrera_numero: 1, fecha: FECHA, cruza_jugadas: false, comision_total: 0 },
    { id: 'p-deportivo', grupo_id: GRUPO_ID, hipodromo_nombre: 'Belmont Park', carrera_numero: 2, fecha: FECHA, cruza_jugadas: false, comision_total: 0 }
  ],
  hipismo_tickets: [
    // GG: dual jugador/banquero en 2 carreras distintas (caso "GG" ya probado en test_hipismo_neteo_cierre_final.js)
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'MARLON1', monto: 30, resultado_jugador: -30, resultado_banquero: 30 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera7', grupo_id: GRUPO_ID, cliente_nombre: 'HANRY', banquero_nombre: 'GG', monto: 10, resultado_jugador: -10, resultado_banquero: 10 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera9', grupo_id: GRUPO_ID, cliente_nombre: 'GG', banquero_nombre: 'MARLON1', monto: 10, resultado_jugador: -10, resultado_banquero: 10 * 0.95, sin_comision: false },
    { plano_id: 'p-carrera9', grupo_id: GRUPO_ID, cliente_nombre: 'HANRY', banquero_nombre: 'GG', monto: 30, resultado_jugador: -30, resultado_banquero: 30 * 0.95, sin_comision: false },
    // FUENTE1: pierde 500 decidido, avala a MRMONEYLIKE al 2%
    { plano_id: 'p-fuente1', grupo_id: GRUPO_ID, cliente_nombre: 'FUENTE1', banquero_nombre: 'BANCOZ', monto: 500, resultado_jugador: -500, resultado_banquero: 475, sin_comision: false },
    // LEGOLASLIKE: gana 500 completo (reproduce el caso real "Legolas")
    { plano_id: 'p-legolas', grupo_id: GRUPO_ID, cliente_nombre: 'LEGOLASLIKE', banquero_nombre: 'BANCOZ', monto: 500, resultado_jugador: 500, resultado_banquero: -500, sin_comision: true },
    // DEPORTIVO: juega y pierde 100 en Hipismo (aparte de su Deportes anclado)
    { plano_id: 'p-deportivo', grupo_id: GRUPO_ID, cliente_nombre: 'DEPORTIVO', banquero_nombre: 'BANCOZ', monto: 100, resultado_jugador: -100, resultado_banquero: 95, sin_comision: false }
  ],
  // Remate de HANRY (26-09-2026, ítem pseudo "REMATE" -- sin fila propia
  // en "jugadores", tiene que saltarse solo en el diagnóstico).
  hipismo_remates: [{ id: 'r-1', grupo_id: GRUPO_ID, fecha: FECHA, hipodromo_nombre: 'La Rinconada', carrera_numero: 7, pizarra: '1.2.3', numero_ganador: 5, comision_total: -50 }],
  hipismo_remate_apuestas: [{ id: 'ra-1', grupo_id: GRUPO_ID, remate_id: 'r-1', cliente_nombre: 'HANRY', caballo: '5', numero_ejemplar: 1, monto: 50, resultado: -50 }],
  hipismo_adelantadas_planos: [], hipismo_adelantadas_jugadas: [],
  hipismo_winners: [],
  hipismo_comisiones_ajustes: [
    { grupo_id: GRUPO_ID, cliente_nombre: 'LEGOLASLIKE', monto: -8.00, fecha: FECHA, nota: 'Traspaso de prueba' }
  ],
  tickets_historial: [
    { grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'DEPORTIVO', ticket: 'T1', detalle: 'Equipo A ML', arriesga: 20, gana: 38, estado: 'GANADA', logros: null }
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
    return { rows: [] };
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
  if (/^SELECT id, grupo_id, nombre, modulos_anclados, es_cuenta_comision FROM jugadores WHERE grupo_id = \$1$/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId).map(j => ({ id: j.id, grupo_id: j.grupo_id, nombre: j.nombre, modulos_anclados: j.modulos_anclados, es_cuenta_comision: j.es_cuenta_comision })) };
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
    return { rows: [] };
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

  throw new Error('La base de datos falsa de esta prueba (diagnostico-saldos) no sabe responder: ' + sql);
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

  const salida = await invocarRuta(handlerDe('get', '/diagnostico-saldos'), { ...reqBase, query: { desde: FECHA, hasta: FECHA } });
  check(!!salida, '1) GET /diagnostico-saldos respondió algo');
  check(salida && Array.isArray(salida.discrepancias), '2) La respuesta trae un arreglo "discrepancias"');
  check(salida && salida.totalClientesRevisados > 0, `3) Revisó al menos 1 cliente -- revisó ${salida ? salida.totalClientesRevisados : 'nada'}`);

  const nombresConDiscrepancia = (salida && salida.discrepancias || []).map(d => d.nombre);
  check(nombresConDiscrepancia.length === 0,
    `4) ARREGLO: ningún cliente queda con discrepancia entre la grilla y su link (GG dual-neteado + % propio redirigido, Mrmoney-style aval sobre un cliente normal, Legolas-style traspaso, y Deportes anclado) -- discrepancias encontradas: ${JSON.stringify(salida ? salida.discrepancias : null)}`);

  // "REMATE" es un ítem pseudo (sin fila en "jugadores") -- confirma que
  // el diagnóstico lo saltó solo, sin reventar y sin reportarlo como
  // discrepancia (no tiene link propio con el que comparar).
  check(!nombresConDiscrepancia.includes('REMATE'), '5) El ítem pseudo "REMATE" se salta (no tiene ficha real que comparar), sin romper el diagnóstico');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
