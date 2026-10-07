// =================================================================
// PRUEBA: Pozo automático de Hipismo (26-09-2026, a pedido del usuario:
// "la pestaña pozos no me esta funcionando, quiero agregar pozo a
// clientes y no me deja, la lista completa de clientes tampoco sale...
// al crear un plano gana o pierde... su pozo aumente o baja según vaya
// ganando o perdiendo") — hasta esta ronda, el pozo de un cliente de
// Hipismo (jugadores.tipo_cuenta='avalado') era 100% manual (solo se
// movía con "Ajustar pozo"), nunca con resultados de juego reales. Ver
// la nota grande en src/services/hipismoPozo.js y src/services/pozo.js.
//
// Mismo patrón de base de datos falsa que test_guardar_dia.js (intercepta
// "pg" vía Module._load, deja correr el código real de historial.js/
// hipismoPozo.js/pozo.js contra esa base falsa).
//
// Casos cubiertos:
//   1. calcularLiquidadoHipismo(): suma tickets de Tercios donde el
//      cliente jugó (resultado_jugador) y donde banqueó (resultado_banquero).
//   2. Suma también Remate (hipismo_remate_apuestas.resultado).
//   3. Suma Adelantadas resuelto/falta_banqueo/sin_decidir (resultado_cliente
//      + su parte como banqueador dentro del jsonb "banqueadores").
//   4. Una Adelantada todavía 'pendiente' NO cuenta (mismo criterio que
//      Cierre Final).
//   5. calcularPozoJugador() combina Deportes (tickets_historial, YA
//      existía) + Hipismo (nuevo) en un solo pozoActual, sin romper el
//      cálculo de Deportes que ya funcionaba.
//   6. Un cliente que SOLO juega Hipismo (nada en tickets_historial de
//      Deportes) igual ve su pozo moverse solo con Hipismo.
//   7. Un cliente que SOLO juega Deportes (nada en Hipismo) sigue exacto
//      igual que antes de este cambio (regresión).
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-pozo-hip-1';
// POZO SEMANAL (07-10-2026): calcularPozoJugador solo suma lo de la semana
// activa, así que las jugadas de prueba van fechadas HOY (hora de Venezuela);
// las filas de Hipismo sin fecha se toman como de hoy. El caso "semana
// nueva" está en test_pozo_semanal.js.
const HOY = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
const enRango = (fecha, desde, hasta) => { const f = fecha || HOY; return f >= desde && f <= hasta; };

const TABLAS = {
  tickets_historial: [],
  hipismo_tickets: [],
  hipismo_remate_apuestas: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_winners: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  // ---- leerHistorial() (Deportes, historial.js) ----
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros FROM tickets_historial WHERE/i.test(sql)) {
    const grupoId = params[0];
    let filas = TABLAS.tickets_historial.filter(r => r.grupo_id === grupoId);
    if (sql.includes('cliente_nombre = $')) {
      const nombre = params[params.length - 1];
      filas = filas.filter(r => r.cliente_nombre === nombre);
    }
    return {
      rows: filas.map(r => ({
        id: r.id, fecha: r.fecha, cliente: r.cliente_nombre, ticket: r.ticket_label,
        detalle: r.detalle, arriesga: r.arriesga, gana: r.gana, estado: r.estado, logros: r.logros
      }))
    };
  }

  // ---- calcularLiquidadoHipismo(): Tercios ----
  if (/^SELECT cliente_nombre, banquero_nombre, resultado_jugador, resultado_banquero FROM hipismo_tickets WHERE grupo_id = \$1 AND \(cliente_nombre = \$2 OR banquero_nombre = \$2\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    return { rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre)) };
  }

  // ---- calcularLiquidadoHipismo(): Remate ----
  if (/^SELECT resultado FROM hipismo_remate_apuestas WHERE grupo_id = \$1 AND cliente_nombre = \$2/i.test(sql)) {
    const [grupoId, nombre] = params;
    return { rows: TABLAS.hipismo_remate_apuestas.filter(a => a.grupo_id === grupoId && a.cliente_nombre === nombre) };
  }

  // ---- calcularLiquidadoHipismo(): Adelantadas ----
  if (/^SELECT cliente_nombre, resultado_cliente, banqueadores FROM hipismo_adelantadas_jugadas WHERE grupo_id = \$1 AND estado IN \('resuelto', 'falta_banqueo', 'sin_decidir'\)/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId && ['resuelto', 'falta_banqueo', 'sin_decidir'].includes(j.estado)) };
  }

  // ---- calcularLiquidadoHipismo(): Winners ----
  if (/^SELECT monto FROM hipismo_winners WHERE grupo_id = \$1 AND cliente_nombre = \$2/i.test(sql)) {
    const [grupoId, nombre] = params;
    return { rows: TABLAS.hipismo_winners.filter(w => w.grupo_id === grupoId && w.cliente_nombre === nombre) };
  }

  // ---- versiones CON rango de semana (JOIN a planos/remates, ver hipismoPozo.js) ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero FROM hipismo_tickets t JOIN hipismo_planos p/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    return { rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre) && enRango(t.fecha, desde, hasta)) };
  }
  if (/^SELECT a\.resultado FROM hipismo_remate_apuestas a JOIN hipismo_remates r/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    return { rows: TABLAS.hipismo_remate_apuestas.filter(a => a.grupo_id === grupoId && a.cliente_nombre === nombre && enRango(a.fecha, desde, hasta)) };
  }
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p/i.test(sql)) {
    const [grupoId, desde, hasta] = params;
    return { rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId && ['resuelto', 'falta_banqueo', 'sin_decidir'].includes(j.estado) && enRango(j.fecha, desde, hasta)) };
  }
  if (/^SELECT monto FROM hipismo_winners WHERE grupo_id = \$1 AND cliente_nombre = \$2 AND fecha BETWEEN/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    return { rows: TABLAS.hipismo_winners.filter(w => w.grupo_id === grupoId && w.cliente_nombre === nombre && enRango(w.fecha, desde, hasta)) };
  }

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
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

const { calcularLiquidadoHipismo } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoPozo'));
const { calcularPozoJugador } = require(path.join(__dirname, '..', 'src', 'services', 'pozo'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

async function main() {
  // ---- 1) Tercios: jugador y banquero ----
  TABLAS.hipismo_tickets.push(
    { grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'CASA', resultado_jugador: 100, resultado_banquero: -100 },
    { grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'CASA', resultado_jugador: -40, resultado_banquero: 40 },
    { grupo_id: GRUPO_ID, cliente_nombre: 'MARIA', banquero_nombre: 'PEDRO', resultado_jugador: -20, resultado_banquero: 20 }
  );
  let liq = await calcularLiquidadoHipismo(GRUPO_ID, 'PEDRO');
  check(liq === 100 - 40 + 20, 'calcularLiquidadoHipismo: suma Tercios como jugador (100-40) Y como banquero de MARIA (+20) = 80, dio ' + liq);

  // ---- 2) Remate ----
  TABLAS.hipismo_remate_apuestas.push(
    { grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', resultado: 250 },
    { grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', resultado: -30 }
  );
  liq = await calcularLiquidadoHipismo(GRUPO_ID, 'PEDRO');
  check(liq === 80 + 250 - 30, 'calcularLiquidadoHipismo: suma también Remate (+250-30), acumulado con Tercios = 300, dio ' + liq);

  // ---- 3) Adelantadas resueltas (como cliente y como banqueador) ----
  TABLAS.hipismo_adelantadas_jugadas.push(
    { grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', resultado_cliente: 60, estado: 'resuelto', banqueadores: null },
    { grupo_id: GRUPO_ID, cliente_nombre: 'OTRO', resultado_cliente: -500, estado: 'falta_banqueo', banqueadores: [{ nombre: 'PEDRO', monto: 15 }, { nombre: 'MARIA', monto: 5 }] }
  );
  liq = await calcularLiquidadoHipismo(GRUPO_ID, 'PEDRO');
  check(liq === 300 + 60 + 15, 'calcularLiquidadoHipismo: suma Adelantadas propias (+60) Y como banqueador de OTRO (+15) = 375, dio ' + liq);

  // ---- 3b) Winners: se suma tal cual, con su propio signo ----
  TABLAS.hipismo_winners.push(
    { grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', caballo: '5', monto: 40 },
    { grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', caballo: '9', monto: -15 }
  );
  liq = await calcularLiquidadoHipismo(GRUPO_ID, 'PEDRO');
  check(liq === 375 + 40 - 15, 'calcularLiquidadoHipismo: suma también "Cargar Winners" (+40-15), acumulado = 400, dio ' + liq);

  // ---- 4) Una Adelantada 'pendiente' no cuenta ----
  TABLAS.hipismo_adelantadas_jugadas.push(
    { grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', resultado_cliente: 9999, estado: 'pendiente', banqueadores: null }
  );
  liq = await calcularLiquidadoHipismo(GRUPO_ID, 'PEDRO');
  check(liq === 400, 'calcularLiquidadoHipismo: una Adelantada todavía "pendiente" (9999) NO se suma — sigue en 400 (incluye Winners de arriba), dio ' + liq);

  // ---- 5) calcularPozoJugador combina Deportes + Hipismo ----
  TABLAS.tickets_historial.push(
    { grupo_id: GRUPO_ID, fecha: HOY, cliente_nombre: 'PEDRO', ticket_label: 'T1', detalle: 'x', arriesga: 100, gana: 180, estado: 'GANADA', logros: null },
    { grupo_id: GRUPO_ID, fecha: HOY, cliente_nombre: 'PEDRO', ticket_label: 'T2', detalle: 'x', arriesga: 50, gana: 90, estado: 'PERDIDA', logros: null }
  );
  const jugadorPedro = { nombre: 'PEDRO', pozo_inicial: 1000 };
  const pozoPedro = await calcularPozoJugador(GRUPO_ID, jugadorPedro);
  check(pozoPedro.liquidadoDeportes === 180 - 50, 'calcularPozoJugador: liquidadoDeportes sigue calculándose igual que siempre (GANADA suma "gana", PERDIDA resta "arriesga") = 130, dio ' + pozoPedro.liquidadoDeportes);
  check(pozoPedro.liquidadoHipismo === 400, 'calcularPozoJugador: liquidadoHipismo trae el mismo total que calculamos arriba, YA con Winners incluido (400), dio ' + pozoPedro.liquidadoHipismo);
  check(pozoPedro.liquidado === 130 + 400, 'calcularPozoJugador: liquidado total combina Deportes + Hipismo (130+400=530), dio ' + pozoPedro.liquidado);
  check(pozoPedro.pozoActual === 1000 + 130 + 400, 'calcularPozoJugador: pozoActual = pozoInicial + liquidado combinado (1000+530=1530), dio ' + pozoPedro.pozoActual);

  // ---- 6) Cliente que SOLO juega Hipismo ----
  TABLAS.hipismo_tickets.push({ grupo_id: GRUPO_ID, cliente_nombre: 'SOLOHIPICO', banquero_nombre: 'CASA', resultado_jugador: 45, resultado_banquero: -45 });
  const jugadorSoloHipico = { nombre: 'SOLOHIPICO', pozo_inicial: 200 };
  const pozoSoloHipico = await calcularPozoJugador(GRUPO_ID, jugadorSoloHipico);
  check(pozoSoloHipico.liquidadoDeportes === 0, 'calcularPozoJugador: un cliente sin NINGÚN ticket de Deportes da liquidadoDeportes=0, no revienta, dio ' + pozoSoloHipico.liquidadoDeportes);
  check(pozoSoloHipico.liquidadoHipismo === 45, 'calcularPozoJugador: ese mismo cliente sí ve su Hipismo real (+45), dio ' + pozoSoloHipico.liquidadoHipismo);
  check(pozoSoloHipico.pozoActual === 245, 'calcularPozoJugador: pozoActual de un cliente solo-Hipismo = pozoInicial + Hipismo (200+45=245), dio ' + pozoSoloHipico.pozoActual);

  // ---- 7) Regresión: cliente que SOLO juega Deportes sigue exacto igual ----
  TABLAS.tickets_historial.push({ grupo_id: GRUPO_ID, fecha: HOY, cliente_nombre: 'SOLODEPORTES', ticket_label: 'T3', detalle: 'x', arriesga: 200, gana: 380, estado: 'GANADA', logros: null });
  const jugadorSoloDeportes = { nombre: 'SOLODEPORTES', pozo_inicial: 500 };
  const pozoSoloDeportes = await calcularPozoJugador(GRUPO_ID, jugadorSoloDeportes);
  check(pozoSoloDeportes.liquidadoHipismo === 0, 'calcularPozoJugador: un cliente sin NINGUNA jugada de Hipismo da liquidadoHipismo=0 (regresión: no le inventa nada), dio ' + pozoSoloDeportes.liquidadoHipismo);
  check(pozoSoloDeportes.liquidadoDeportes === 380, 'calcularPozoJugador: su liquidadoDeportes sigue exacto igual que antes de este cambio (+380), dio ' + pozoSoloDeportes.liquidadoDeportes);
  check(pozoSoloDeportes.pozoActual === 880, 'calcularPozoJugador: pozoActual de un cliente solo-Deportes = pozoInicial + Deportes (500+380=880), sin que Hipismo le meta nada de más, dio ' + pozoSoloDeportes.pozoActual);

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  process.exit(fallaron > 0 ? 1 : 0);
}

main();
