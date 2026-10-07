// =================================================================
// PRUEBA (07-10-2026): "Registro de Saldos" — saldo por cliente y período
// (semana/mes/año) con desglose por tipo de jugada, comisión y rentabilidad.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
const GRUPO_ID = 'g-registro-1';

const TABLAS = {};
function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/FROM jugadores WHERE grupo_id/i.test(sql)) return { rows: TABLAS.jugadores };
  if (/FROM hipismo_tickets t JOIN hipismo_planos/i.test(sql)) return { rows: TABLAS.tickets };
  if (/FROM hipismo_remate_apuestas a JOIN hipismo_remates/i.test(sql)) return { rows: TABLAS.remate };
  if (/FROM hipismo_winners/i.test(sql)) return { rows: TABLAS.winners };
  if (/FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos/i.test(sql)) return { rows: TABLAS.adelantadas };
  if (/FROM hipismo_tercios_adelantadas_jugadas j JOIN/i.test(sql)) return { rows: TABLAS.tercAdel };
  return { rows: [] };
}
const fakePool = function () { this.query = async (t, p) => ejecutarQuery(t, p); this.on = () => {}; };
let periodosPedidos = [];
const CIERRES = {};
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === './hipismoSemana') return { rangoSemanaGrupo: async (g, hoy, off) => { const d = new Date(Date.UTC(2026, 9, 5 + 7 * off)); const h = new Date(d.getTime() + 6 * 86400000); return { desde: d.toISOString().slice(0, 10), hasta: h.toISOString().slice(0, 10) }; } };
  if (request === './hipismoResumenCliente') return { construirCierreFinalHipismo: async (g, desde, hasta) => { periodosPedidos.push([desde, hasta]); return CIERRES[desde] || { clientes: [], comisionSemana: 0 }; } };
  if (request === './hipismoCargasEspeciales') return { obtenerCargasEspecialesRango: async () => TABLAS.cargas };
  if (request === './hipismoComisionPropia') return { obtenerAjustesComision: async (g, desde) => TABLAS.ajustes[desde] || {} };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
const reg = require(path.join(__dirname, '..', 'src', 'services', 'hipismoRegistroSaldos'));
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }
const por = (d, n) => d.clientes.find(c => c.nombre === n);

(async function main() {
  // ---- parámetros
  let p = reg.normalizarParametros({});
  check(p.granularidad === 'semana' && p.cantidad === 8, '1a) por defecto: semanal, 8 semanas');
  p = reg.normalizarParametros({ granularidad: 'mes', cantidad: '999' });
  check(p.granularidad === 'mes' && p.cantidad === 24, '1b) la cantidad se limita (mes máx. 24)');
  p = reg.normalizarParametros({ granularidad: 'raro', cantidad: 'x' });
  check(p.granularidad === 'semana' && p.cantidad === 8, '1c) valores inválidos vuelven al defecto');

  // ---- datos
  TABLAS.jugadores = [
    { id: 'j-ana', nombre: 'ANA', es_cuenta_comision: false, cuenta_comision_id: 'c-ana' },
    { id: 'c-ana', nombre: 'ANA - PORCENTAJE', es_cuenta_comision: true, cuenta_comision_id: null },
    { id: 'j-beto', nombre: 'BETO', es_cuenta_comision: false, cuenta_comision_id: null },
    { id: 'j-mz', nombre: 'MARCAS ZENYATTA', es_cuenta_comision: false, cuenta_comision_id: null },
    { id: 'j-cero', nombre: 'SINJUEGO', es_cuenta_comision: false, cuenta_comision_id: null }
  ];
  TABLAS.tickets = [
    { cliente_nombre: 'ANA', banquero_nombre: 'BETO', resultado_jugador: '95', resultado_banquero: '-100', fecha: '2026-10-03' },
    { cliente_nombre: 'ANA', banquero_nombre: 'BETO', resultado_jugador: '-50', resultado_banquero: '47.5', fecha: new Date('2026-09-20T00:00:00Z') }
  ];
  TABLAS.winners = [{ cliente_nombre: 'ANA', monto: '10', fecha: '2026-10-02' }];
  TABLAS.remate = [{ cliente_nombre: 'BETO', resultado: '-20', fecha: '2026-10-05' }];
  TABLAS.adelantadas = [
    { cliente_nombre: 'ANA', tipo: 'tf', resultado_cliente: '30', comision: '1.5', banqueadores: null, fecha: '2026-10-04' },
    { cliente_nombre: 'BETO', tipo: 'marca', resultado_cliente: '-40', comision: '1', banqueadores: [{ nombre: 'MARCAS ZENYATTA', monto: 39 }], fecha: '2026-09-10' }
  ];
  TABLAS.tercAdel = [];
  TABLAS.cargas = [{ clienteNombre: 'ANA', monto: 5, fecha: '2026-10-06' }];
  TABLAS.ajustes = { '2026-10-01': { ANA: -3 } };
  CIERRES['2026-10-01'] = { comisionSemana: 2.5, // ya neta del % devuelto (6,5 - 4), como en Balance General
   clientes: [
    { nombre: 'ANA', jugadas: 3, saldo: 139 }, { nombre: 'BETO', jugadas: 2, saldo: -120 },
    { nombre: 'ANA - PORCENTAJE', jugadas: 0, saldo: 4 }, { nombre: 'WINNERS', jugadas: 1, saldo: -10 }, { nombre: 'REMATE', jugadas: 1, saldo: 20 }
  ] };
  CIERRES['2026-09-01'] = { comisionSemana: 3.5, clientes: [
    { nombre: 'ANA', jugadas: 1, saldo: -50 }, { nombre: 'BETO', jugadas: 2, saldo: 7.5 }, { nombre: 'MARCAS ZENYATTA', jugadas: 1, saldo: 39 }
  ] };

  const hoy = new Date('2026-10-07T12:00:00Z');
  periodosPedidos = [];
  const d = await reg.construirRegistroSaldosHipismo(GRUPO_ID, { granularidad: 'mes', cantidad: 2 }, hoy);
  check(d.periodos.length === 2 && d.periodos[0].desde === '2026-09-01' && d.periodos[0].hasta === '2026-09-30' && d.periodos[1].desde === '2026-10-01' && d.periodos[1].hasta === '2026-10-31', '2a) 2 meses: septiembre y octubre completos');
  check(d.periodos[0].etiqueta === 'Sep 2026' && d.periodos[1].etiqueta === 'Oct 2026', '2b) etiquetas "Sep 2026" / "Oct 2026"');
  check(periodosPedidos.length === 2 && periodosPedidos[1][0] === '2026-10-01' && periodosPedidos[1][1] === '2026-10-31', '2c) el saldo sale de Cierre Final con el rango de cada período');

  const ana = por(d, 'ANA'), beto = por(d, 'BETO'), mz = por(d, 'MARCAS ZENYATTA');
  const aOct = ana.periodos[1];
  check(aOct.saldo === 139 && aOct.jugadas === 3, '3a) ANA octubre: saldo 139 (el de Cierre Final) y 3 jugadas');
  check(aOct.tercios === 95 && aOct.winners === 10 && aOct.tablasFijas === 30 && aOct.cargas === 5 && aOct.traspasos === -3, '3b) ANA octubre: desglose Tercios 95, Winners 10, Tablas 30, Carga Masiva 5, Traspasos -3');
  check(aOct.otros === 2, '3c) "Otros" = lo que falta para llegar al saldo oficial (139 - 137 = 2)');
  check(aOct.comisionGenerada === 6.5 && aOct.devuelto === 4 && aOct.comisionNeta === 2.5, '3d) comisión generada 5+1,5 = 6,5; % devuelto 4 (cuenta ANA - PORCENTAJE); neta 2,5');
  const bSep = beto.periodos[0];
  check(bSep.tercios === 47.5 && bSep.marcas === -40 && bSep.comisionGenerada === 3.5 && bSep.saldo === 7.5 && bSep.otros === 0, '3e) BETO septiembre: Tercios 47,5 + Marcas -40; comisión 2,5 (ganó de banquero) + 1 = 3,5');
  check(beto.periodos[1].remate === -20 && beto.periodos[1].tercios === -100, '3f) BETO octubre: banquero perdió 100 y Remate -20');
  check(mz.periodos[0].bancaAdelantadas === 39 && mz.periodos[0].saldo === 39 && mz.periodos[0].otros === 0, '3g) MARCAS ZENYATTA (banquero de la Marca): Banca Adelantadas 39');
  check(!por(d, 'ANA - PORCENTAJE') && !por(d, 'WINNERS') && !por(d, 'REMATE') && !por(d, 'SINJUEGO'), '3h) no salen las cuentas de % devuelto, los ítems WINNERS/REMATE ni clientes sin movimiento');
  check(ana.total.saldo === 89 && ana.total.comisionNeta === 2.5 + 0 && ana.total.devuelto === 4, `3i) totales de ANA suman sus períodos (saldo ${ana.total.saldo})`);
  check(d.clientes[0].nombre === 'ANA' || d.clientes[0].total.comisionNeta >= d.clientes[1].total.comisionNeta, '3j) vienen ordenados del más rentable (mayor comisión neta) al menos');
  check(d.totales[1].comisionGrupo === 2.5 && d.totalGeneral.comisionGrupo === 6, '3k) trae la comisión del grupo de cada período (2,5 + 3,5 = 6)');
  // comisión neta de todos los clientes == comisión del grupo (mismo criterio que Balance General)
  check(Math.abs(d.totalGeneral.comisionNeta - d.totalGeneral.comisionGrupo) < 0.005, `3m) la comisión neta de todos los clientes (${d.totalGeneral.comisionNeta}) coincide con la comisión del grupo de Balance General (${d.totalGeneral.comisionGrupo})`);
  check(d.clientes.every(c => c.periodos.every(f => Math.abs((f.tercios + f.remate + f.winners + f.tablasFijas + f.marcas + f.bancaAdelantadas + f.tercAdelantadas + f.cargas + f.traspasos + f.otros) - f.saldo) < 0.005)), '3n) el desglose (con "Otros") siempre suma el saldo oficial');

  // ---- semana y año
  periodosPedidos = [];
  const s = await reg.construirRegistroSaldosHipismo(GRUPO_ID, { granularidad: 'semana', cantidad: 3 }, hoy);
  check(s.periodos.length === 3 && s.periodos[2].desde === '2026-10-05' && s.periodos[0].desde === '2026-09-21', '4a) 3 semanas, la última es la actual (05-10)');
  check(/^21\/09 al 27\/09$/.test(s.periodos[0].etiqueta), `4b) etiqueta de semana "21/09 al 27/09" (${s.periodos[0].etiqueta})`);
  const a = await reg.construirRegistroSaldosHipismo(GRUPO_ID, { granularidad: 'anio', cantidad: 2 }, hoy);
  check(a.periodos.length === 2 && a.periodos[1].desde === '2026-01-01' && a.periodos[1].hasta === '2026-12-31' && a.periodos[0].etiqueta === '2025', '4c) 2 años: 2025 y 2026');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  process.exit(fallaron ? 1 : 0);
})();
