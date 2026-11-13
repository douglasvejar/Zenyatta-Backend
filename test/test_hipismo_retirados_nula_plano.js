// 13-11-2026: un caballo RETIRADO en cualquier jugada del plano normal (Grupos Hípicos y
// Oficinas comparten el motor) => la jugada es NULA (push): 0/0, sin banqueo ni comisión.
const C = require('../src/services/hipismoCalc');
const { parsearRetirados } = require('../src/services/hipismoAdelantadasCalc');
const fs = require('fs'); const path = require('path');
let ok = 0, fail = 0;
const check = (c, m) => { if (c) { ok++; } else { fail++; console.log('FALLA:', m); } };

const pizarra = '10.5.3.1';
const texto = [
  'Boss 1p 5 journalism 100',
  'Pedro pp 4x3 juan 100',
  'Maria 1p 6y10 luis 100',
  'Ana 1p 10 carlos 100'
].join('\n');

// sin retirados: nada cambia
const base = C.calcularPlano({ texto, pizarra, cruzar: false });
check(base.tickets.length === 4 && !base.tickets.some(t => t.nulaRetirado), 'sin retirados nada se anula');
check(base.tickets[3].resultadoJugador > 0, 'Ana gana normal sin retirados');

// Ret 5: la simple del 5 queda nula
let r = C.calcularPlano({ texto, pizarra, cruzar: false, retirados: parsearRetirados('5') });
check(r.tickets[0].nulaRetirado === true && r.tickets[0].resultadoJugador === 0 && r.tickets[0].resultadoBanquero === 0, 'simple con retirado = 0/0');
check(r.tickets[1].nulaRetirado !== true, 'la 4x3 NO se anula con Ret 5');
check(r.salidaLineas.some(l => /NULA.*caballo 5 retirado/.test(l)), 'se muestra la línea NULA');
check(r.totalesFinales['JOURNALISM'] === 0 && r.totalesFinales['BOSS'] === 0, 'Boss/Journalism en 0');
check(r.comisionTotal <= base.comisionTotal, 'no suma comisión de la nula');

// Ret 3: pp 4x3 nula (cualquiera de los dos caballos)
r = C.calcularPlano({ texto, pizarra, cruzar: false, retirados: parsearRetirados('3') });
check(r.tickets[1].nulaRetirado === true && r.tickets[1].resultadoJugador === 0, 'pp 4x3 con el 3 retirado = nula');
// Ret 6, 4 (varios separadores): morocha 6y10 nula; pp 4x3 nula
r = C.calcularPlano({ texto, pizarra, cruzar: false, retirados: parsearRetirados('6, 4') });
check(r.tickets[2].nulaRetirado === true && r.tickets[2].resultadoJugador === 0, 'morocha 6,10 con el 6 retirado = nula');
check(r.tickets[1].nulaRetirado === true, 'pp 4x3 con el 4 retirado = nula');
check(r.tickets[3].nulaRetirado !== true && r.tickets[3].resultadoJugador > 0, 'la del 10 sigue normal');

// cruza jugadas: la nula no entra al neto
const cz = C.calcularPlano({ texto: 'Boss 1p 5 journalism 100\nBoss 1p 10 journalism 100', pizarra, cruzar: true, retirados: parsearRetirados('5') });
const cz0 = C.calcularPlano({ texto: 'Boss 1p 10 journalism 100', pizarra, cruzar: true });
check(cz.totalesFinales['BOSS'] === cz0.totalesFinales['BOSS'], 'cruzar: la nula no altera el neto');

// recalcularTicket / armarSalidaLineasDeTickets
const rank = C.parsearPizarra(pizarra);
const rt = C.recalcularTicket({ modalidad: '1p', caballo: '10', monto: 100 }, rank, parsearRetirados('10'));
check(rt.resultadoJugador === 0 && rt.resultadoBanquero === 0, 'recalcularTicket con retirado = 0/0');
const rt2 = C.recalcularTicket({ modalidad: '1p', caballo: '10', monto: 100 }, rank, parsearRetirados('7'));
check(rt2.resultadoJugador !== 0, 'recalcularTicket sin coincidencia sigue normal');
const sal = C.armarSalidaLineasDeTickets([{ clienteNombre: 'A', banqueroNombre: 'B', modalidad: '1p', caballo: '10', monto: 100, resultadoJugador: 0, resultadoBanquero: 0 }], { retirados: parsearRetirados('10') });
check(sal.some(l => /NULA/.test(l)), 'armarSalida marca NULA');
const sal2 = C.armarSalidaLineasDeTickets([{ clienteNombre: 'A', banqueroNombre: 'B', modalidad: '1p', caballo: '10', monto: 100, resultadoJugador: 95, resultadoBanquero: -100 }]);
check(!sal2.some(l => /NULA/.test(l)), 'sin retirados no marca NULA');
check(C.jugadaConRetirado('4x3', parsearRetirados('3')) && !C.jugadaConRetirado('4x3', parsearRetirados('5')) && !C.jugadaConRetirado('4x3', null), 'jugadaConRetirado');

// cableado en rutas y pozo
const rutas = fs.readFileSync(path.join(__dirname, '../src/routes/hipismo.js'), 'utf8');
check((rutas.match(/retirados: parsearRetirados\(ret\)/g) || []).length === 2, 'calcular y guardar pasan retirados');
check((rutas.match(/rank, parsearRetirados\(plano\.ret\)/g) || []).length === 2, 'editar ticket y corregir pizarra pasan retirados');
check((rutas.match(/retirados: parsearRetirados\(plano\.ret\)/g) || []).length === 4, 'las 4 salidas de líneas pasan retirados');
const alerta = fs.readFileSync(path.join(__dirname, '../src/services/hipismoAlertaPozo.js'), 'utf8');
check(/nulaRetirado\) return/.test(alerta), 'validar pozo ignora la nula');

console.log(`${ok} OK, ${fail} fallas`);
process.exit(fail ? 1 : 0);
