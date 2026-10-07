// =================================================================
// PRUEBA: POZO SEMANAL (07-10-2026, a pedido del usuario: "los pozos deben
// reiniciarse a lo que les coloqué en un principio cada semana nueva...
// si un tercio decía 5000 de pozo, al venir semana nueva debe volver a
// tener sus 5000"). Ver la nota grande en src/services/pozo.js.
//
// Casos: lo jugado en una semana anterior NO mueve el pozo de esta semana
// (Deportes y las 4 fuentes de Hipismo); lo de esta semana sí; lo que está
// en juego sigue congelado aunque sea de la semana pasada; un ajuste +/-
// (+/-) cambia el pozo BASE para siempre (decisión del usuario: en Hipismo
// es la única forma de ponerle pozo a un cliente), así que cada semana nueva
// el pozo vuelve a ese monto, ajustes incluidos.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const G = 'grupo-pozo-semanal';
const ahoraVe = () => new Date(Date.now() - 4 * 60 * 60 * 1000);
const DIA = 24 * 60 * 60 * 1000;
const isoDe = ms => new Date(ms).toISOString().slice(0, 10);

const T = { tickets_historial: [], hipismo_tickets: [], hipismo_remate_apuestas: [], hipismo_adelantadas_jugadas: [], hipismo_winners: [] };
const enRango = (f, d, h) => f >= d && f <= h;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/FROM tickets_historial WHERE/i.test(sql)) {
    const filas = T.tickets_historial.filter(r => r.grupo_id === params[0] && r.cliente_nombre === params[params.length - 1]);
    return { rows: filas.map(r => ({ id: r.id, fecha: r.fecha, cliente: r.cliente_nombre, ticket: 'T', detalle: 'x', arriesga: r.arriesga, gana: r.gana, estado: r.estado, logros: null })) };
  }
  if (/FROM hipismo_tickets t JOIN hipismo_planos p/i.test(sql)) {
    const [g, n, d, h] = params;
    return { rows: T.hipismo_tickets.filter(t => t.grupo_id === g && (t.cliente_nombre === n || t.banquero_nombre === n) && enRango(t.fecha, d, h)) };
  }
  if (/FROM hipismo_remate_apuestas a JOIN hipismo_remates r/i.test(sql)) {
    const [g, n, d, h] = params;
    return { rows: T.hipismo_remate_apuestas.filter(a => a.grupo_id === g && a.cliente_nombre === n && enRango(a.fecha, d, h)) };
  }
  if (/FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p/i.test(sql)) {
    const [g, d, h] = params;
    return { rows: T.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === g && ['resuelto', 'falta_banqueo', 'sin_decidir'].includes(j.estado) && enRango(j.fecha, d, h)) };
  }
  if (/FROM hipismo_winners WHERE grupo_id = \$1 AND cliente_nombre = \$2 AND fecha BETWEEN/i.test(sql)) {
    const [g, n, d, h] = params;
    return { rows: T.hipismo_winners.filter(w => w.grupo_id === g && w.cliente_nombre === n && enRango(w.fecha, d, h)) };
  }
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
Module._load = function (request) { if (request === 'pg') return { Pool: fakePool }; return originalLoad.apply(this, arguments); };
process.env.DATABASE_URL = 'postgresql://fake/fake';

const { calcularPozoJugador, rangoSemanaActualPozo } = require(path.join(__dirname, '..', 'src', 'services', 'pozo'));
Module._load = originalLoad;

let ok = 0, mal = 0;
function check(c, m) { if (c) { ok++; console.log('OK:', m); } else { mal++; console.error('FALLÓ:', m); } }

async function main() {
  const rango = await rangoSemanaActualPozo(G);
  const hoy = isoDe(ahoraVe().getTime());
  const semanaPasada = isoDe(Date.parse(rango.desde + 'T00:00:00Z') - 2 * DIA); // 2 días antes de que arranque esta semana
  check(hoy >= rango.desde && hoy <= rango.hasta, `la semana activa (${rango.desde} a ${rango.hasta}) contiene hoy`);
  check(semanaPasada < rango.desde, 'la fecha "semana pasada" de la prueba cae antes del rango activo');

  // ---- Cliente avalado con pozo 5000 que jugó MUCHO la semana pasada ----
  T.hipismo_tickets.push({ grupo_id: G, cliente_nombre: 'TERCIO', banquero_nombre: 'CASA', resultado_jugador: -1200, resultado_banquero: 1200, fecha: semanaPasada });
  T.hipismo_remate_apuestas.push({ grupo_id: G, cliente_nombre: 'TERCIO', resultado: -100, fecha: semanaPasada });
  T.hipismo_adelantadas_jugadas.push({ grupo_id: G, cliente_nombre: 'TERCIO', resultado_cliente: -50, estado: 'resuelto', banqueadores: null, fecha: semanaPasada });
  T.hipismo_winners.push({ grupo_id: G, cliente_nombre: 'TERCIO', monto: -70, fecha: semanaPasada });
  T.tickets_historial.push({ grupo_id: G, fecha: semanaPasada, cliente_nombre: 'TERCIO', arriesga: 300, gana: 500, estado: 'PERDIDA' });
  const tercio = { id: 'j-tercio', nombre: 'TERCIO', pozo_inicial: 5000 };

  let p = await calcularPozoJugador(G, tercio);
  check(p.pozoInicial === 5000 && p.liquidado === 0 && p.pozoActual === 5000,
    `semana nueva: lo perdido la semana pasada NO cuenta — el pozo vuelve a 5000 (asignado ${p.pozoInicial}, liquidado ${p.liquidado}, actual ${p.pozoActual})`);

  // ---- Lo de ESTA semana sí mueve el pozo (las 5 fuentes) ----
  T.hipismo_tickets.push({ grupo_id: G, cliente_nombre: 'TERCIO', banquero_nombre: 'CASA', resultado_jugador: 200, resultado_banquero: -200, fecha: hoy });
  T.hipismo_remate_apuestas.push({ grupo_id: G, cliente_nombre: 'TERCIO', resultado: -30, fecha: hoy });
  T.hipismo_adelantadas_jugadas.push({ grupo_id: G, cliente_nombre: 'TERCIO', resultado_cliente: 10, estado: 'resuelto', banqueadores: null, fecha: hoy });
  T.hipismo_winners.push({ grupo_id: G, cliente_nombre: 'TERCIO', monto: 20, fecha: hoy });
  T.tickets_historial.push({ grupo_id: G, fecha: hoy, cliente_nombre: 'TERCIO', arriesga: 100, gana: 160, estado: 'GANADA' });
  p = await calcularPozoJugador(G, tercio);
  check(p.liquidadoHipismo === 200 - 30 + 10 + 20, `esta semana cuenta Hipismo (tercios+remate+adelantadas+winners) = 200, dio ${p.liquidadoHipismo}`);
  check(p.liquidadoDeportes === 160, `esta semana cuenta Deportes (+160), dio ${p.liquidadoDeportes}`);
  check(p.pozoActual === 5000 + 200 + 160 && p.pozoInicial + p.liquidado === p.pozoActual, `pozo actual = base 5000 + 360 de esta semana = 5360, dio ${p.pozoActual}`);

  // ---- En juego (pendiente) de la semana pasada sigue congelado ----
  T.tickets_historial.push({ grupo_id: G, fecha: semanaPasada, cliente_nombre: 'TERCIO', arriesga: 400, gana: 700, estado: 'PENDIENTE' });
  p = await calcularPozoJugador(G, tercio);
  check(p.congelado === 400 && p.pozoDisponible === p.pozoActual - 400, `lo pendiente de la semana pasada sigue congelado (400), dio ${p.congelado}`);

  // ---- Un ajuste +/- (pozo base) se conserva cada semana nueva ----
  // "Ajustar pozo" hace pozo_inicial += monto: el cliente de 6000 ya ajustado
  // arranca CADA semana en 6000, haya jugado lo que haya jugado antes.
  const ajustado = { id: 'j-ajuste', nombre: 'AJUSTADO', pozo_inicial: 6000 };
  T.hipismo_tickets.push({ grupo_id: G, cliente_nombre: 'AJUSTADO', banquero_nombre: 'CASA', resultado_jugador: -2500, resultado_banquero: 2500, fecha: semanaPasada });
  p = await calcularPozoJugador(G, ajustado);
  check(p.pozoInicial === 6000 && p.liquidado === 0 && p.pozoActual === 6000, `un pozo puesto con "Ajustar pozo" (6000) arranca la semana nueva en 6000 aunque perdió 2500 la semana pasada, dio ${p.pozoActual}`);
  T.hipismo_tickets.push({ grupo_id: G, cliente_nombre: 'AJUSTADO', banquero_nombre: 'CASA', resultado_jugador: -500, resultado_banquero: 500, fecha: hoy });
  p = await calcularPozoJugador(G, ajustado);
  check(p.pozoActual === 5500, `y esta semana lo perdido (-500) sí lo baja: 5500, dio ${p.pozoActual}`);

  // ---- Banquero: lo que gana/pierde como banquero también es de su semana ----
  T.hipismo_tickets.push({ grupo_id: G, cliente_nombre: 'OTRO', banquero_nombre: 'AJUSTADO', resultado_jugador: -300, resultado_banquero: 300, fecha: hoy });
  T.hipismo_tickets.push({ grupo_id: G, cliente_nombre: 'OTRO', banquero_nombre: 'AJUSTADO', resultado_jugador: 900, resultado_banquero: -900, fecha: semanaPasada });
  p = await calcularPozoJugador(G, ajustado);
  check(p.pozoActual === 5800, `como banquero solo cuenta lo de esta semana (+300, no los -900 de la pasada): 5800, dio ${p.pozoActual}`);

  // ---- Semana que el grupo configuró distinta (opciones.rango) ----
  p = await calcularPozoJugador(G, tercio, { rango: { desde: semanaPasada, hasta: semanaPasada } });
  check(p.liquidadoHipismo === -1200 - 100 - 50 - 70 && p.liquidadoDeportes === -300, `con un rango dado (el de la semana pasada) se calcula exactamente esa semana: Hipismo -1420, Deportes -300, dio ${p.liquidadoHipismo} / ${p.liquidadoDeportes}`);

  console.log(`\n${ok} pruebas OK, ${mal} fallaron.`);
  process.exit(mal > 0 ? 1 : 0);
}
main();
