// Solo Pozos con SALDO REAL (31-10-2026): el pozo actual incluye traspasos, recargas de pago diario y demás movimientos de la semana;
// los clientes de pago diario con saldo también salen; el semáforo/parpadeo y el texto usan ese mismo número.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
let fallas = 0, n = 0;
function ok(c, m) { n++; if (c) console.log('OK: ' + m); else { fallas++; console.log('FALLO: ' + m); } }

function extraer(inicio, fin) { const i = html.indexOf(inicio); const k = html.indexOf(fin, i); if (i < 0 || k < 0) throw new Error('no encontrado: ' + inicio); return html.slice(i, k); }
const codigo = extraer('function filaPozoCompleta(j) {', '// Fila simple de 2 columnas') + '\n' +
  extraer('function nombresPozoRojoActuales() {', 'function actualizarAlertaPozos() {') + '\n' +
  extraer('function colorPorPorcentaje(pct) {', '// 23-09-2026, a pedido del usuario ("al darle click');

const ctx = {
  CLIENTES_HIPISMO_CACHE: [], SALDOS_SEMANA_POZOS_DEVUELTO: {}, POZOS_EXCLUIDOS: new Set(),
  redondearCentavos: n => { const x = Number(n) || 0; return (x < 0 ? -1 : 1) * Math.round(Math.abs(x) * 100 + 1e-6) / 100 || 0; },
  incluirDevolucionPozos: () => false,
  nombresPagoDiarioPozos: () => new Set(ctx.CLIENTES_HIPISMO_CACHE.filter(j => j.pago_diario).map(j => j.nombre)),
  formatMontoTabla: n => Number(n).toFixed(2).replace('.', ','), formatNombre: x => x, attrNombrePozo: x => x, celdaSelPozo: () => ''
};
const fn = new Function(...Object.keys(ctx), codigo + '\nreturn { calcularPozosReales, filaPozoCompleta, nombresPozoRojoActuales, getMapa: () => POZOS_REAL_POR_NOMBRE };');
const m = fn(...Object.values(ctx));

const pozo = (ini, liq, liqHip) => ({ pozoInicial: ini, liquidado: liq, liquidadoHipismo: liqHip === undefined ? liq : liqHip, pozoActual: ini + liq });
ctx.CLIENTES_HIPISMO_CACHE.push(
  { nombre: 'HURACAN', tipo_cuenta: 'avalado', pozo: pozo(50, 19.7) },
  { nombre: 'INDIANA', tipo_cuenta: 'avalado', pozo: pozo(100, -52.5) },
  { nombre: 'CHAPO', tipo_cuenta: 'libre', pago_diario: true, pozo: pozo(0, 0) },
  { nombre: 'SANJOSE', tipo_cuenta: 'libre', pago_diario: true, pozo: pozo(0, 27.49) },
  { nombre: 'SINNADA', tipo_cuenta: 'libre', pago_diario: true, pozo: pozo(0, 0) },
  { nombre: 'DEUDOR', tipo_cuenta: 'libre', pago_diario: true, pozo: pozo(0, -30) });
// saldos de la semana (cierre final): traspaso de 20 de INDIANA a HURACAN; CHAPO recargó 1000 y ganó 979+..; DEUDOR perdió sin recargar
const saldos = [{ nombre: 'HURACAN', saldo: 39.7 }, { nombre: 'INDIANA', saldo: -72.5 }, { nombre: 'CHAPO', saldo: 979 }, { nombre: 'SANJOSE', saldo: 227.49 }, { nombre: 'DEUDOR', saldo: -30 }];
const mapa = m.calcularPozosReales(saldos);

ok(mapa.get('HURACAN').real === 89.7, 'HURACAN: el traspaso recibido se ve en el pozo actual (89,70)');
ok(mapa.get('HURACAN').otros === 20, 'HURACAN: "recargas, traspasos y otros" = +20');
ok(mapa.get('INDIANA').real === 27.5 && mapa.get('INDIANA').otros === -20, 'INDIANA: el traspaso enviado baja su pozo (27,50)');
ok(mapa.get('INDIANA').pct === 28 && mapa.get('INDIANA').color === 'amarillo', 'INDIANA: 28% amarillo');
ok(mapa.has('CHAPO') && mapa.get('CHAPO').real === 979, 'CHAPO (pago diario recargado) sale en Solo Pozos con su saldo real');
ok(mapa.get('CHAPO').ref === 979 && mapa.get('CHAPO').pct === 100, 'CHAPO: lo recargado cuenta como lo colocado');
ok(!mapa.has('SINNADA'), 'un pago diario sin nada no sale');
ok(mapa.get('DEUDOR').color === 'gris' && mapa.get('DEUDOR').pct === null, 'pago diario sin nada colocado queda en gris (no parpadea)');
ok(mapa.get('SANJOSE').real === 227.49 && mapa.get('SANJOSE').otros === 200, 'SANJOSE: ganó 27,49 jugando y el resto (recarga/cruces) en otros');

// rojo: avalado con 300 que ya quedó en 10 por un traspaso enviado
ctx.CLIENTES_HIPISMO_CACHE.push({ nombre: 'BOSS', tipo_cuenta: 'avalado', pozo: pozo(300, 0) });
const m2 = m.calcularPozosReales(saldos.concat([{ nombre: 'BOSS', saldo: -290 }]));
ok(m2.get('BOSS').color === 'rojo' && m.nombresPozoRojoActuales().join() === 'BOSS', 'queda en rojo por el traspaso y la alerta lo nombra');
const fila = m.filaPozoCompleta(m2.get('BOSS').j);
ok(fila.includes('fila-pozo-rojo') && fila.includes('data-color="rojo"') && fila.includes('data-ref="300,00"'), 'la fila parpadea (fila-pozo-rojo) y trae color y referencia');
ok(m.filaPozoCompleta(m2.get('HURACAN').j).includes('89,70'), 'la fila de HURACAN muestra 89,70');

console.log('\n' + (n - fallas) + ' pruebas OK, ' + fallas + ' fallaron.');
process.exit(fallas ? 1 : 0);
