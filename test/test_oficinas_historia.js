// 15-11-2026: Historia de la Oficina (jugadas, jugado y comisión que produce cada cliente).
const fs = require('fs'), path = require('path');
const leer = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@localhost:1/x';
const { armarHistoriaOficina } = require('../src/services/hipismoHistoriaOficina');
let ok = 0, fail = 0;
const check = (c, m) => { if (c) ok++; else { fail++; console.log('FALLA:', m); } };

const jugadores = [
  { nombre: 'AGUILAR' }, { nombre: 'ESTRIBO' }, { nombre: 'ROBERT' }, { nombre: 'ZETA' },
  { nombre: 'AGUILAR - PORCENTAJE', es_cuenta_comision: true }
];
const cierre = {
  clientes: [
    { nombre: 'AGUILAR', jugadas: 5 }, { nombre: 'ESTRIBO', jugadas: 3 }, { nombre: 'ROBERT', jugadas: 2 }, { nombre: 'ZETA', jugadas: 0 },
    { nombre: 'REMATE', jugadas: 4 }, { nombre: 'WINNERS', jugadas: 1 }, { nombre: 'AGUILAR - PORCENTAJE', jugadas: 0 }
  ],
  comisionBrutaPorCliente: { AGUILAR: 20, ESTRIBO: 12.5, ROBERT: 3 },
  devueltoPorOrigen: { AGUILAR: 4, ESTRIBO: 2.5 },
  comisionSemana: 29.07            // 16 + 10 + 3 = 29 → 0,07 de ajuste de centavos
};
const movimiento = { jugadoCent: new Map([['AGUILAR', 150000], ['ESTRIBO', 80000], ['ROBERT', 30000]]), nulas: new Map([['ROBERT', 1]]) };
const h = armarHistoriaOficina({ cierre, jugadores, movimiento });

check(h.filas.map(f => f.nombre).join() === 'AGUILAR,ESTRIBO,ROBERT', 'ordenado del que más produce al que menos; sin jugadas, ítems y cuentas de comisión no salen');
check(h.filas[0].comision === 16 && h.filas[1].comision === 10 && h.filas[2].comision === 3, 'comisión = bruta − devuelto');
check(h.filas[0].jugadas === 5 && h.filas[2].jugadas === 1, 'la jugada nula no cuenta (Robert 2 − 1 = 1)');
check(h.filas[0].jugado === 1500 && h.filas[1].jugado === 800, 'jugado en dinero');
check(h.totales.jugadas === 9 && h.totales.jugado === 2600 && h.totales.clientes === 3, 'totales');
check(h.otros === 0.07 && h.comisionOficina === 29.07 && Math.round((h.totales.comisionClientes + h.otros) * 100) === 2907, 'la lista + otros = la comisión del Balance General, al centavo');
check(Math.abs(h.filas[0].porcentaje - 55.04) < 0.01, 'porcentaje de la comisión de la oficina');

// sin movimiento: lista vacía
const vacio = armarHistoriaOficina({ cierre: { clientes: [], comisionSemana: 0 }, jugadores, movimiento: { jugadoCent: new Map(), nulas: new Map() } });
check(vacio.filas.length === 0 && vacio.comisionOficina === 0 && vacio.otros === 0, 'sin jugadas: lista vacía');

// pantalla y ruta
const html = leer('public/hipismo-oficinas.html'), mej = leer('public/oficinas-mejoras.js'), rutas = leer('src/routes/hipismo.js');
check(/data-tab="historia" data-perm="oficinas_informes"/.test(html) && /id="panel-historia"/.test(html) && />📖 Historia de la Oficina</.test(html), 'pestaña y panel');
check(/iniciarPeriodo\('his', \(\) => cargarHistoria\(\)\)/.test(html) && /if \(t === 'historia'\) cargarHistoria\(\)/.test(html), 'selector de semana/rango y carga al abrir');
check(/router\.get\('\/oficinas\/historia', requierePermisoOficina\('oficinas_informes'\)/.test(rutas), 'ruta protegida con el permiso de informes');
check(/async function cargarHistoria/.test(mej) && /function pintarHistoria/.test(mej) && /que === 'historia'/.test(mej), 'pantalla y Excel');
check(!/Rinde sobre/i.test(html + mej), 'sin la columna "Rinde sobre lo jugado"');
check(/nth-child\(even\) \{ background: #e8e0d0/.test(html), 'filas sombreadas intercaladas');
check(/hisCaptura: 'hisToast'/.test(html), 'imagen/PDF con su aviso');
try { new Function(mej); check(true, 'JS válido'); } catch (e) { check(false, e.message); }
console.log(`${ok} OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
