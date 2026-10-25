// Prueba de la parte PURA de "Comisiones por Avales y Socios" (25-10-2026): validar socios, repartir centavos, armar el reporte.
const { normalizarNombreSocio, validarConfigSocios, repartirCentavosPorPorcentajes, armarReporteSocios, armarBalanceSocios } = require('../src/services/hipismoSocios');
let ok = 0, mal = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK:', m); } else { mal++; console.error('FALLÓ:', m); } };

check(normalizarNombreSocio('  luis   perez ') === 'LUIS PEREZ', 'nombre del socio en mayúsculas y sin espacios de más');
check(!validarConfigSocios([]).error && validarConfigSocios([]).socios.length === 0, 'lista vacía es válida (el grupo no usa socios)');
check(!!validarConfigSocios([{ nombre: 'A', porcentaje: 50 }, { nombre: 'B', porcentaje: 49.99 }]).error, '99,99% se rechaza');
check(!validarConfigSocios([{ nombre: 'A', porcentaje: 33.3333 }, { nombre: 'B', porcentaje: 33.3333 }, { nombre: 'C', porcentaje: 33.3334 }]).error, '33,3333+33,3333+33,3334 = 100 exacto');
check(!!validarConfigSocios([{ nombre: 'A', porcentaje: 50 }, { nombre: 'a', porcentaje: 50 }]).error, 'nombres repetidos (sin importar mayúsculas) se rechazan');
check(!!validarConfigSocios([{ nombre: '', porcentaje: 100 }]).error, 'nombre vacío se rechaza');
check(!!validarConfigSocios([{ nombre: 'A', porcentaje: 120 }, { nombre: 'B', porcentaje: -20 }]).error, 'porcentajes fuera de 0-100 se rechazan');
check(!validarConfigSocios([{ nombre: 'A', porcentaje: 0.1 + 0.2 }, { nombre: 'B', porcentaje: 99.7 }]).error, '0,1+0,2 (flotante) + 99,7 suma 100 sin error de coma flotante');

const rep = repartirCentavosPorPorcentajes(10001, [33.3333, 33.3333, 33.3334]);
check(rep.reduce((a, b) => a + b, 0) === 10001, 'repartir 100,01 en 3 suma exacto: ' + rep);
check(repartirCentavosPorPorcentajes(-10001, [50, 50]).reduce((a, b) => a + b, 0) === -10001, 'repartir un negativo también suma exacto');
check(repartirCentavosPorPorcentajes(0, [60, 40]).every(x => x === 0), 'repartir 0 da ceros');

const cierre = {
  comisionSemana: 100.00,
  comisionBrutaPorCliente: { ANA: 60, BETO: 30.5, CARLOS: 20 },
  devueltoPorOrigen: { ANA: 10, BETO: 1.5 },
  comisionSinAtribuir: 1
};
const socios = [{ id: 's1', nombre: 'LUIS', porcentaje: 60 }, { id: 's2', nombre: 'PEDRO', porcentaje: 40 }];
const jugadores = [{ nombre: 'ANA', hipismo_socio_id: 's1' }, { nombre: 'BETO', hipismo_socio_id: 's2' }, { nombre: 'CARLOS', hipismo_socio_id: null }];
const r = armarReporteSocios({ cierre, socios, jugadores, rango: { desde: '2026-10-19', hasta: '2026-10-25' }, nombreGrupo: 'G' });
check(r.activo && r.cuadra && r.diferencia === 0, 'el reporte cuadra con la comisión del cierre');
check(r.socios[0].total === 50 && r.socios[0].clientes[0].monto === 50, 'ANA produjo 60 - 10 devueltos = 50');
check(r.socios[1].total === 29, 'BETO produjo 30,5 - 1,5 = 29');
check(r.sinSocio.total === 21 && r.sinSocio.clientes.some(c => c.esAjuste && c.monto === 1), 'CARLOS (20) sin socio + ajuste (1) = 21');
check(r.porSocio[0].monto === 60 && r.porSocio[1].monto === 40, 'Por Socio reparte 100 al 60% / 40%');
const r0 = armarReporteSocios({ cierre, socios: [], jugadores, rango: {} });
check(r0.activo === false, 'sin socios no se activa');

// ---- Balance por socios ----
const cierreB = { comisionSemana: 100.01, clientes: [
  { nombre: 'ANA', saldo: 120.5 }, { nombre: 'BETO', saldo: -40 }, { nombre: 'CARLOS', saldo: 15.25 }, { nombre: 'ANA - PORCENTAJE', saldo: 3 },
  { nombre: 'FICHA X', saldo: 2 }, { nombre: 'REMATE', saldo: -9.99 }, { nombre: 'CERO', saldo: 0 }] };
const jugB = [
  { id: 'a', nombre: 'ANA', hipismo_socio_id: 's1', cuenta_comision_id: 'pa' }, { id: 'pa', nombre: 'ANA - PORCENTAJE', hipismo_socio_id: null },
  { id: 'b', nombre: 'BETO', hipismo_socio_id: 's2', cuenta_comision_id: 'fx' }, { id: 'c', nombre: 'CARLOS', hipismo_socio_id: 's2', cuenta_comision_id: 'fx' },
  { id: 'fx', nombre: 'FICHA X', hipismo_socio_id: null }, { id: 'r', nombre: 'REMATE', hipismo_socio_id: null }];
const rb = armarBalanceSocios({ cierre: cierreB, socios, jugadores: jugB, rango: { desde: 'a', hasta: 'b' } });
check(rb.activo && rb.cuadra, 'balance por socios: activo y las comisiones cuadran');
check(rb.socios[0].clientes.map(c => c.nombre).join() === 'ANA,ANA - PORCENTAJE' && rb.socios[0].totalSaldo === 123.5, 'ANA y su cuenta de % (hereda el socio) van en la lista de LUIS: 123,50');
check(rb.socios[0].clientes.find(c => c.nombre === 'ANA - PORCENTAJE').heredado === true, 'la cuenta heredada se marca');
check(rb.socios[1].clientes.map(c => c.nombre).join() === 'CARLOS,FICHA X,BETO' && rb.socios[1].totalSaldo === -22.75, 'FICHA X (usada por BETO y CARLOS, ambos de PEDRO) sigue a PEDRO; total -22,75');
check(rb.sinSocio && rb.sinSocio.clientes.length === 1 && rb.sinSocio.clientes[0].nombre === 'REMATE', 'REMATE sin socio va en SIN SOCIO; el saldo 0 no sale');
check(rb.socios[0].comision === 60.01 && rb.socios[1].comision === 40 && rb.sumaComisiones === 100.01, 'comisión 100,01 al 60/40: 60,01 y 40,00 (suma exacta)');
const sumaSaldos = Math.round(100 * (rb.socios.reduce((a, s) => a + s.totalSaldo, 0) + rb.sinSocio.totalSaldo));
check(sumaSaldos === Math.round(100 * cierreB.clientes.reduce((a, c) => a + c.saldo, 0)) && rb.totalSaldos === sumaSaldos / 100, 'la suma de todas las listas = la suma de saldos de Balance General');
const jugAmb = jugB.map(j => j.id === 'c' ? { ...j, hipismo_socio_id: 's1' } : j);
const rb2 = armarBalanceSocios({ cierre: cierreB, socios, jugadores: jugAmb, rango: {} });
check(rb2.sinSocio.clientes.some(c => c.nombre === 'FICHA X'), 'una cuenta usada por clientes de DOS socios distintos no se adivina: va en SIN SOCIO');
check(armarBalanceSocios({ cierre: cierreB, socios: [], jugadores: jugB, rango: {} }).activo === false, 'balance por socios: sin socios no se activa');
check(armarBalanceSocios({ cierre: { comisionSemana: 0, clientes: [{ nombre: 'ANA - PORCENTAJE', saldo: 5 }] }, socios, jugadores: [{ id: 'a', nombre: 'ANA', hipismo_socio_id: 's1' }], rango: {} }).socios[0].clientes[0].heredado === true, 'una cuenta "X - PORCENTAJE" sin ficha enlazada igual sigue al socio de X');
console.log(`\n${ok} OK, ${mal} fallaron.`); process.exit(mal ? 1 : 0);
