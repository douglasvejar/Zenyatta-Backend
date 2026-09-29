// =================================================================
// PRUEBA: Marca "a premio" (cruzada + décimos, ej. "4x3 10a8") — 29-09-2026
// =================================================================
// El usuario explicó que una Marca ("AxB", un caballo contra otro,
// banqueada) se puede jugar de 2 formas:
//   - "pp" (cruzado a secas): el que gana se lleva el monto COMPLETO
//     -5%, el que pierde pierde completo (ya cubierto, ver
//     test_hipismo_pp_no_coloco.js).
//   - "a premio" (10aN, ej. "10a8"): MISMA comparación cabeza a cabeza
//     entre los 2 caballos, pero el que gana solo se lleva N/10 del
//     monto (nunca completo) -5%; el que pierde SIEMPRE pierde el monto
//     completo. Ejemplo real confirmado por el usuario: "Juan juega 4x3
//     10a8 lo da Jaime con 100 -- si Juan gana cobra 80-5%=76 y Jaime
//     pierde 80; si Juan pierde, pierde los 100 completos y Jaime cobra
//     100-5%=95".
//
// ANTES de este arreglo, una modalidad "a premio" con un caballo "AxB"
// NUNCA entraba por la rama cruzada (solo lo hacía "pp" literal) — caía
// en el caso de "caballo solo", que le hacía parseInt("4x3") -> 4,
// IGNORANDO el "x3" por completo. Esto no se notaba (no caía en
// sinReconocer) pero daba un resultado SILENCIOSAMENTE INCORRECTO cada
// vez que el caballo ignorado (el "x3") era el que de verdad importaba
// para decidir quién quedó mejor colocado entre los 2 -- el caso 2 de
// abajo (pizarra "8.2.4.6") es exactamente ese escenario: ANTES daba
// "Juan pierde" (porque el 4 no es 1er lugar) cuando en realidad Juan
// GANA (el 4, 3er lugar, quedó mejor que el 3, que ni figura).
//
// También se prueba que la misma regla de "si ninguno de los 2 figura,
// no se decide" (ver test_hipismo_pp_no_coloco.js) aplica igual acá, y
// que una modalidad NO confirmada para cruzar (ej. "1p") con un caballo
// "AxB" cae en sinReconocer en vez de arriesgar el mismo bug silencioso.
const path = require('path');
const { calcularPlano, recalcularTicket, parsearPizarra, esModalidadSinComision } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const LINEA = '10a8 4x3 100 Juan Jaime'; // Juan juega el 4 contra el 3 ("a premio" 10a8), se lo da Jaime, con 100.

// --- 1) Juan gana (el 4 queda 1er lugar) ---
let r = calcularPlano({ texto: LINEA, pizarra: '4.2.6.8', cruzar: false });
let t = r.tickets[0];
check(!!t && t.resultadoJugador === 76 && t.resultadoBanquero === -80,
  `1) El 4 llega 1ro -- Juan (juega el 4) gana 8/10 de 100 menos 5%% = 76,00, Jaime pierde 80,00 -- dio jugador=${t ? t.resultadoJugador : 'nada'}, banquero=${t ? t.resultadoBanquero : 'nada'}`);

// --- 2) ARREGLO PRINCIPAL: Juan gana por comparación relativa, aunque el 4 no sea 1er lugar ---
// El 4 llega 3ro (SÍ figura), el 3 NO figura en absoluto -- el 4 quedó
// mejor colocado que el 3, así que Juan (que jugó el 4) sigue ganando,
// aunque su caballo no haya sido el 1er lugar de la carrera. Este es
// justo el caso que el bug viejo (parseInt truncando "4x3" a 4) resolvía
// MAL, porque solo miraba si el 4 era 1ro (no lo es acá) sin comparar
// contra el 3 en absoluto.
r = calcularPlano({ texto: LINEA, pizarra: '8.2.4.6', cruzar: false });
t = r.tickets[0];
check(!!t && t.resultadoJugador === 76 && t.resultadoBanquero === -80,
  `2) ARREGLO: el 4 llega 3ro y el 3 no figura -- Juan sigue ganando (el 4 quedó mejor que el 3) -- dio jugador=${t ? t.resultadoJugador : 'nada (bug viejo: perdía por no ser 1ro)'}, banquero=${t ? t.resultadoBanquero : 'nada'}`);

// --- 3) Juan pierde (el 3 queda mejor colocado que el 4) ---
r = calcularPlano({ texto: LINEA, pizarra: '3.2.6.8', cruzar: false });
t = r.tickets[0];
check(!!t && t.resultadoJugador === -100 && t.resultadoBanquero === 95,
  `3) El 3 llega 1ro (mejor que el 4, que no figura) -- Juan PIERDE EL MONTO COMPLETO (100,00, no una fracción), Jaime cobra 100 menos 5%% = 95,00 -- dio jugador=${t ? t.resultadoJugador : 'nada'}, banquero=${t ? t.resultadoBanquero : 'nada'}`);

// --- 4) Ninguno de los 2 figura -- no se decide (misma regla que "pp") ---
r = calcularPlano({ texto: LINEA, pizarra: '8.2.6.9', cruzar: false });
t = r.tickets[0];
check(!!t && t.resultadoJugador === 0 && t.resultadoBanquero === 0,
  `4) Ni el 4 ni el 3 figuran en la pizarra -- no se decide (0 y 0), misma regla que "pp" -- dio jugador=${t ? t.resultadoJugador : 'nada'}, banquero=${t ? t.resultadoBanquero : 'nada'}`);

// --- 5) "sin comisión" (toggle por N de esa carrera) sigue aplicando al lado que gana ---
r = calcularPlano({ texto: LINEA, pizarra: '4.2.6.8', cruzar: false, valoresSinComision: [8] });
t = r.tickets[0];
check(!!t && t.sinComision === true && t.resultadoJugador === 80,
  `5) Con el operador marcando "8" como sin comisión para esta carrera, Juan gana los 80,00 NETOS (sin el 5%%) -- dio sinComision=${t ? t.sinComision : 'nada'}, jugador=${t ? t.resultadoJugador : 'nada'}`);
check(esModalidadSinComision('10a8', [8]) === true, '5b) esModalidadSinComision("10a8", [8]) sigue funcionando igual que con un caballo solo (no depende del formato del caballo)');

// --- 6) Una modalidad NO confirmada para cruzar, con un caballo "AxB", cae en sinReconocer ---
const rNoSoportado = calcularPlano({ texto: '1p 4x3 100 Juan Jaime', pizarra: '4.2.6.8', cruzar: false });
check(rNoSoportado.tickets.length === 0 && rNoSoportado.sinReconocer.length === 1,
  '6) "1p" con un caballo "4x3" (cruce no confirmado con el usuario para esa modalidad) cae en sinReconocer, en vez de arriesgar el mismo bug silencioso de truncar a un solo caballo');

// --- 7) recalcularTicket() (editar un ticket ya guardado) -- mismos 4 casos ---
const rank1 = parsearPizarra('4.2.6.8');
check(JSON.stringify(recalcularTicket({ modalidad: '10a8', caballo: '4x3', monto: 100, sinComision: false }, rank1)) === JSON.stringify({ resultadoJugador: 76, resultadoBanquero: -80 }),
  '7a) recalcularTicket(): el 4 llega 1ro -- Juan gana 76,00, mismo cálculo que calcularPlano()');
const rank2 = parsearPizarra('8.2.4.6');
check(JSON.stringify(recalcularTicket({ modalidad: '10a8', caballo: '4x3', monto: 100, sinComision: false }, rank2)) === JSON.stringify({ resultadoJugador: 76, resultadoBanquero: -80 }),
  '7b) recalcularTicket(): el 4 llega 3ro y el 3 no figura -- Juan sigue ganando (mismo arreglo que calcularPlano())');
const rank4 = parsearPizarra('8.2.6.9');
check(JSON.stringify(recalcularTicket({ modalidad: '10a8', caballo: '4x3', monto: 100, sinComision: false }, rank4)) === JSON.stringify({ resultadoJugador: 0, resultadoBanquero: 0 }),
  '7c) recalcularTicket(): ninguno de los 2 figura -- no se decide (0 y 0)');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
