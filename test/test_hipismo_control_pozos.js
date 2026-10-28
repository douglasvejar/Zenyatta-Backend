// =================================================================
// PRUEBA (28-10-2026): Tablero "Control de Pozos" -- una fila por cliente con pozo o de pago diario: colocado/recargado, jugado, ganado o
// perdido, en juego, disponible con su %, última recarga y última jugada, semáforo; resumen del grupo. Solo lee.
// =================================================================
const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalLoad = Module._load;
let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }

const G = 'g-cp';
const RANGO = { desde: '2026-10-26', hasta: '2026-11-01' };
let sinColumna = false;
const J = (nombre, extra) => ({ id: 'j-' + nombre, grupo_id: G, nombre, tipo_cuenta: 'libre', pago_diario: false, pozo_inicial: 0, activo: true, es_cuenta_comision: false, ...extra });
const JUGADORES = [
  J('ANA', { tipo_cuenta: 'avalado', pozo_inicial: 1000 }),                 // con pozo: queda 70% -> amarillo
  J('BETO', { tipo_cuenta: 'avalado', pozo_inicial: 500 }),                  // con pozo: casi todo -> verde
  J('FELIPE', { pago_diario: true }),                                         // pago diario libre, recargó 500, le quedan 40 -> rojo
  J('MARIA', { pago_diario: true }),                                          // pago diario libre, sin recargas -> gris
  J('JOSE', { tipo_cuenta: 'avalado', pago_diario: true, pozo_inicial: 200 }),// pago diario con pozo + recarga
  J('LUIS'),                                                                  // libre normal: no entra
  J('INACTIVO', { tipo_cuenta: 'avalado', pozo_inicial: 100, activo: false }),// inactivo: no entra
  J('PAGOS A CLIENTES', { tipo_cuenta: 'avalado', pozo_inicial: 5, es_cuenta_comision: true })
];
const POZOS = {
  ANA: { pozoInicial: 1000, liquidado: -300, congelado: 0 },
  BETO: { pozoInicial: 500, liquidado: 50, congelado: 0 },
  FELIPE: { pozoInicial: 0, liquidado: -460, congelado: 0 },
  MARIA: { pozoInicial: 0, liquidado: 0, congelado: 0 },
  JOSE: { pozoInicial: 200, liquidado: 100, congelado: 30 }                  // 30 congelado de Deportes
};
const filas = (arr) => ({ rows: arr });
function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1 AND .* ORDER BY nombre/i.test(sql)) {
    if (/pago_diario = true/.test(sql) && sinColumna) { const e = new Error('no existe'); e.code = '42703'; throw e; }
    const conPD = /pago_diario = true/.test(sql);
    return filas(JUGADORES.filter(j => j.grupo_id === params[0] && (j.tipo_cuenta === 'avalado' || (conPD && j.pago_diario)) && !j.es_cuenta_comision && j.activo !== false).sort((a, b) => a.nombre.localeCompare(b.nombre)));
  }
  if (/FROM hipismo_comisiones_ajustes/.test(sql)) return filas([{ nombre: 'FELIPE', semana: '500', ultima: '2026-10-27' }, { nombre: 'JOSE', semana: '300', ultima: new Date('2026-10-26T12:00:00Z') }]);
  if (/FROM hipismo_tickets t JOIN/.test(sql)) return filas([{ nombre: 'ANA', semana: '200', ultima: '2026-10-28' }, { nombre: 'FELIPE', semana: '460', ultima: '2026-10-28' }]);
  if (/FROM hipismo_remate_apuestas/.test(sql)) return filas([{ nombre: 'ANA', semana: '50', ultima: '2026-10-20' }]);
  if (/FROM hipismo_adelantadas_jugadas j JOIN/.test(sql)) return filas([{ nombre: 'BETO', semana: '40', ultima: '2026-10-27' }]);
  if (/FROM tickets_historial/.test(sql)) return filas([{ nombre: 'JOSE', semana: '120', ultima: '2026-10-25' }]);
  if (/FROM hipismo_adelantadas_jugadas\s+WHERE/.test(sql) || /estado = 'pendiente'/.test(sql) && /hipismo_adelantadas_jugadas/.test(sql)) return filas([{ nombre: 'ANA', total: '100' }]);
  if (/hipismo_tercios_adelantadas_jugadas/.test(sql)) return filas([{ nombre: 'FELIPE', total: '10' }]);
  return filas([]);
}
const fakePool = function () { this.query = async (t, p) => ejecutarQuery(t, p); this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} }); this.on = () => {}; };
function fakeRouter() { const h = []; const r = function () {}; ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { r[m] = (...a) => { h.push([m, a]); return r; }; }); r.__handlers = h; return r; }
const fakeExpress = () => fakeRouter(); fakeExpress.Router = fakeRouter;
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'h', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({ grupoId: G }) };
  if (request === './pozo') return {
    rangoSemanaActualPozo: async () => RANGO,
    calcularPozoJugador: async (g, j) => { const p = POZOS[j.nombre]; return { ...p, rango: RANGO, pozoActual: p.pozoInicial + p.liquidado, pozoDisponible: p.pozoInicial + p.liquidado - p.congelado }; }
  };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake'; process.env.JWT_SECRET = 'fake';
const control = require(path.join(__dirname, '..', 'src', 'services', 'hipismoControlPozos'));
const router = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
const F = require(path.join(__dirname, '..', 'src', 'services', 'funcionesGrupo'));
Module._load = originalLoad;

(async function main() {
  const d = await control.construirControlPozos(G);
  const por = n => d.clientes.find(c => c.nombre === n);
  check(d.semana.desde === RANGO.desde && d.semana.hasta === RANGO.hasta, '1) Trae la semana activa del grupo');
  check(JSON.stringify(d.clientes.map(c => c.nombre).sort()) === JSON.stringify(['ANA', 'BETO', 'FELIPE', 'JOSE', 'MARIA']), '2) Entran avalados y pago diario; no el libre normal, ni el inactivo, ni la cuenta de comisión');

  const ana = por('ANA');
  check(ana.tipo === 'avalado' && ana.colocado === 1000 && ana.apostado === 250 && ana.neto === -300 && ana.enJuego === 100 && ana.disponible === 600 && ana.porcentaje === 60 && ana.semaforo === 'amarillo',
    `3) ANA (con pozo 1000): jugó 250 (200 tercios + 50 remate), -300, 100 en juego (adelantadas pendientes) -> disponible 600 (60%) amarillo -- ${JSON.stringify(ana)}`);
  const beto = por('BETO');
  check(beto.colocado === 500 && beto.apostado === 40 && beto.disponible === 550 && beto.porcentaje === 110 && beto.semaforo === 'verde', '4) BETO: ganó 50, disponible 550 (110%) verde');
  const felipe = por('FELIPE');
  check(felipe.tipo === 'pago_diario' && felipe.pozoBase === 0 && felipe.recargasSemana === 500 && felipe.colocado === 500 && felipe.enJuego === 10 && felipe.disponible === 30 && felipe.porcentaje === 6 && felipe.semaforo === 'rojo' && felipe.ultimaRecarga === '2026-10-27',
    `5) FELIPE (pago diario): recargó 500, perdió 460, 10 en juego (tercios adelantadas) -> disponible 30 (6%) ROJO, última recarga 27-10 -- ${JSON.stringify(felipe)}`);
  const maria = por('MARIA');
  check(maria.semaforo === 'gris' && maria.colocado === 0 && maria.porcentaje === 0 && maria.ultimaRecarga === null, '6) MARIA (pago diario sin recargas): gris "sin saldo", no sale en rojo');
  const jose = por('JOSE');
  check(jose.tipo === 'pago_diario_pozo' && jose.colocado === 500 && jose.neto === 100 && jose.enJuego === 30 && jose.disponible === 570 && jose.ultimaRecarga === '2026-10-26' && jose.apostado === 120,
    `7) JOSE (pago diario con pozo): 200 + recarga 300 = 500; ganó 100; 30 en juego de Deportes -> 570; jugó 120 -- ${JSON.stringify(jose)}`);
  check(ana.ultimaJugada === '2026-10-28' && beto.ultimaJugada === '2026-10-27' && jose.ultimaJugada === '2026-10-25' && maria.ultimaJugada === null, '8) Última jugada = la más reciente entre tercios, remate, adelantadas y Deportes (null si nunca jugó)');
  check(JSON.stringify(d.clientes.map(c => c.semaforo)) === JSON.stringify(['rojo', 'amarillo', 'gris', 'verde', 'verde']), `9) Orden: los que piden atención primero (rojo, amarillo, sin saldo, verdes) -- ${d.clientes.map(c => c.nombre + ':' + c.semaforo).join(' ')}`);
  const r = d.resumen;
  check(r.totalClientes === 5 && r.totalColocado === 2500 && r.totalEnJuego === 140 && r.rojos === 1 && r.amarillos === 1 && r.verdes === 2 && r.sinSaldo === 1, `10) Resumen: 5 clientes, colocado 2.500, en juego 140, 1 rojo / 1 amarillo / 2 verdes / 1 sin saldo -- ${JSON.stringify(r)}`);
  check(r.totalNeto === -610 && r.totalApostado === 870 && r.totalDisponible === 1750 && r.pagoDiario === 3 && r.conPozo === 3, '11) Resumen: neto -610, jugado 870, disponible 1.750; 3 de pago diario y 3 con pozo (JOSE cuenta en ambos)');

  // sin columna pago_diario: solo avalados, sin romper
  sinColumna = true;
  const d2 = await control.construirControlPozos(G);
  sinColumna = false;
  check(JSON.stringify(d2.clientes.map(c => c.nombre).sort()) === JSON.stringify(['ANA', 'BETO', 'JOSE']), '12) Si todavía no existe la columna pago_diario, el tablero muestra los avalados y no se rompe');

  // grupo sin clientes
  const antes = JUGADORES.splice(0, JUGADORES.length);
  const d3 = await control.construirControlPozos(G);
  JUGADORES.push(...antes);
  check(d3.clientes.length === 0 && d3.resumen.totalClientes === 0, '13) Sin clientes con pozo ni pago diario devuelve lista vacía');

  // ruta, permisos y pantalla
  const h = router.__handlers.find(([m, a]) => m === 'get' && a[0] === '/control-pozos');
  check(!!h, '14) Existe GET /control-pozos');
  check(F.rutaHipismoPermitida({ funciones_habilitadas: ['hip_pozos'] }, 'GET', '/control-pozos') && !F.rutaHipismoPermitida({ funciones_habilitadas: ['hip_planos'] }, 'GET', '/control-pozos'), '15) Se permite con la sección Pozos (o Saldos) y se rechaza sin ellas');
  check(F.seccionDeVistaHipismo('controlPozos') === 'hip_pozos', '16) La pantalla pertenece a la sección Pozos');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  check(/data-vista="controlPozos"[^>]*>🎛️<span class="nav-lbl"> Control de Pozos/.test(html) && /id="vista-controlPozos"/.test(html) && /controlPozos: \(\) => cargarControlPozos\(\)/.test(html), '17) Hay botón en el menú, la pantalla y se carga al entrar');
  check(/\/api\/hipismo\/control-pozos/.test(html) && /function pintarControlPozos/.test(html), '18) La pantalla pide /control-pozos y pinta el tablero');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
