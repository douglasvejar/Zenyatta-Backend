// =================================================================
// PRUEBA: generalización de las familias "Nn" y "AyB" a cualquier N
// (24-09-2026)
// =================================================================
// El usuario mandó la lista COMPLETA de cómo se juega en las oficinas
// ("ASI SE JUEGA EN LAS OFICINAS..."), confirmando el patrón que ya
// estaba parcialmente implementado (solo para N=2/N=3) y extendiéndolo
// explícitamente hasta "los 10P":
//
//   - familia "Nn" (empata en la posición N): antes solo existían "2n" y
//     "3n" hardcodeados — el usuario listó "2N", "3N", "4N", "5N" con la
//     misma regla, "ASI HASTA LOS 10P".
//   - familia "AyB" (gana/pierde la mitad): antes solo existían "1/2"
//     (≡"1y2"), "2y2" y "2y3" hardcodeados — el usuario listó "1y2N",
//     "2y2N", "2y3N", "3y3N", "3y4N", "4y4N", "4y5N", "5y5N", confirmando
//     el mismo patrón "AP/BN" que ya estaba en
//     claude/spec-modulo-hipismo.md sección 6 como "patrón general" para
//     CUALQUIER A y B (B=A o B=A+1) — nunca antes se había generalizado
//     en el CÓDIGO, solo en la documentación.
//
// No hizo falta ningún ejemplo numérico nuevo: la fórmula general ya
// estaba confirmada — solo había que generalizar el código para que deje
// de estar hardcodeado a N=2/N=3.
//
// También confirmó explícitamente que el lado del banquero es SIEMPRE la
// inversa del jugador ("los que dan o banquea sería la inversa") — eso ya
// era así desde el diseño original (resultado.b === -resultado.j salvo en
// un "no se decide"), se verifica acá de nuevo para dejarlo blindado.
const assert = require('assert');
const path = require('path');
const { resolverModalidad, calcularPlano } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// --- 1) Familia "Nn" generalizada: 2n..10n, misma regla para todas ---
for (let n = 2; n <= 10; n++) {
  for (let pos = 1; pos <= 12; pos++) {
    const r = resolverModalidad(`${n}n`, pos);
    let esperado;
    if (pos < n) esperado = { j: 1, b: -1 };
    else if (pos === n) esperado = { j: 0, b: 0 };
    else esperado = { j: -1, b: 1 };
    check(eq(r, esperado), `1) "${n}n" pos ${pos} -> ${JSON.stringify(r)}`);
  }
}
// Regresión: los alias históricos de 2n/3n siguen funcionando igual.
check(eq(resolverModalidad('2nini', 1), { j: 1, b: -1 }), 'Regresión: "2nini" (alias histórico) pos 1');
check(eq(resolverModalidad('2nini', 2), { j: 0, b: 0 }), 'Regresión: "2nini" pos 2 (empata)');
check(eq(resolverModalidad('3nn', 3), { j: 0, b: 0 }), 'Regresión: "3nn" (alias histórico) pos 3 (empata)');

// --- 2) Familia "AyB" generalizada: B===A (gana la mitad) para A=2..9 ---
for (let A = 2; A <= 9; A++) {
  for (let pos = 1; pos <= 12; pos++) {
    const r1 = resolverModalidad(`${A}y${A}`, pos);
    const r2 = resolverModalidad(`${A}y${A}n`, pos); // con "n" final, mismo resultado
    let esperado;
    if (pos < A) esperado = { j: 1, b: -1 };
    else if (pos === A) esperado = { j: 0.5, b: -0.5 };
    else esperado = { j: -1, b: 1 };
    check(eq(r1, esperado), `2) "${A}y${A}" pos ${pos} (gana la mitad en ${A}) -> ${JSON.stringify(r1)}`);
    check(eq(r2, esperado), `"${A}y${A}n" (con "n" final) da lo mismo que "${A}y${A}"`);
  }
}

// --- 3) Familia "AyB" generalizada: B===A+1 (pierde la mitad) para A=1..9 ---
for (let A = 1; A <= 9; A++) {
  const B = A + 1;
  for (let pos = 1; pos <= 12; pos++) {
    const r1 = resolverModalidad(`${A}y${B}`, pos);
    const r2 = resolverModalidad(`${A}/${B}`, pos); // notación con "/" en vez de "y"
    let esperado;
    if (pos <= A) esperado = { j: 1, b: -1 };
    else if (pos === B) esperado = { j: -0.5, b: 0.5 };
    else esperado = { j: -1, b: 1 };
    check(eq(r1, esperado), `3) "${A}y${B}" pos ${pos} (pierde la mitad en ${B}) -> ${JSON.stringify(r1)}`);
    check(eq(r2, esperado), `"${A}/${B}" (con "/" en vez de "y") da lo mismo que "${A}y${B}"`);
  }
}

// --- 4) Regresión exacta de los 3 casos que YA estaban hardcodeados antes
// de esta generalización (1/2≡1y2, 2y2≡2/2, 2y3≡2/3) — tienen que dar
// EXACTAMENTE lo mismo que daban antes, byte a byte. ---
check(eq(resolverModalidad('1/2', 1), { j: 1, b: -1 }), '4) Regresión "1/2" pos1');
check(eq(resolverModalidad('1/2', 2), { j: -0.5, b: 0.5 }), 'Regresión "1/2" pos2 (pierde la mitad)');
check(eq(resolverModalidad('1/2', 3), { j: -1, b: 1 }), 'Regresión "1/2" pos3');
check(eq(resolverModalidad('1y2', 2), { j: -0.5, b: 0.5 }), 'Regresión "1y2" (alias) pos2');
check(eq(resolverModalidad('2y2', 2), { j: 0.5, b: -0.5 }), 'Regresión "2y2" pos2 (gana la mitad)');
check(eq(resolverModalidad('2/2', 2), { j: 0.5, b: -0.5 }), 'Regresión "2/2" (alias) pos2');
check(eq(resolverModalidad('2y3', 3), { j: -0.5, b: 0.5 }), 'Regresión "2y3" pos3 (pierde la mitad)');
check(eq(resolverModalidad('2/3', 3), { j: -0.5, b: 0.5 }), 'Regresión "2/3" (alias) pos3');

// --- 5) "10/N" décimos sigue intacto (no se mezcla con la familia AyB
// nueva, a pesar de que ambas usan "/") ---
check(eq(resolverModalidad('10/3', 1), { j: 0.3, b: -0.3 }), '5) "10/3" (décimos) pos1 sigue pagando 3/10, no la familia AyB');
check(eq(resolverModalidad('10/3', 2), { j: -1, b: 1 }), '"10/3" pos2 pierde completo');
check(eq(resolverModalidad('10a7', 1), { j: 0.7, b: -0.7 }), '"10a7" (alias) pos1');
check(eq(resolverModalidad('10 a 7', 1), { j: 0.7, b: -0.7 }), '"10 a 7" (con espacios) pos1');

// --- 6) Una combinación A/B que no sigue el patrón (B != A y B != A+1)
// no se calcula — sigue el "safety net" ---
check(resolverModalidad('3/7', 1) === null, '6) "3/7" (combinación que no sigue el patrón) -> null, no se inventa nada');
check(resolverModalidad('5/9', 1) === null, '"5/9" (combinación que no sigue el patrón) -> null');

// --- 7) calcularPlano() end-to-end con un plano de ejemplo usando varias
// modalidades NUEVAS generalizadas en la misma carrera ---
const PLANO_EJEMPLO = `Juega Pedro 3y3 (5) con 100,00 da Sammy
Juega Ana 4y5 (5) con 200,00 da Mujica
Juega Luis 4n (5) con 50,00 da Hernan
Juega Sofia 5n (2) con 80,00 da Tykhe
Juega Carlos 10 a 5 (5) con 1000,00 da Pier`;
// Pizarra 5.2.1.9 -> caballo 5 llega 1ro, caballo 2 llega 2do.
const resultado = calcularPlano({ texto: PLANO_EJEMPLO, pizarra: '5.2.1.9', cruzar: false });
check(resultado.sinReconocer.length === 0, '7) Ninguna línea sin reconocer con las modalidades nuevas generalizadas');
check(resultado.tickets.length === 5, 'Las 5 líneas se calculan');

const tPedro = resultado.tickets.find(t => t.clienteNombre === 'PEDRO');
check(tPedro && tPedro.resultadoJugador === 95, 'Pedro (3y3, caballo 5 llega 1ro, gana completo) 100 -5% = 95');
const tAna = resultado.tickets.find(t => t.clienteNombre === 'ANA');
check(tAna && tAna.resultadoJugador === 190, 'Ana (4y5, caballo 5 llega 1ro, gana completo) 200 -5% = 190');
const tLuis = resultado.tickets.find(t => t.clienteNombre === 'LUIS');
check(tLuis && tLuis.resultadoJugador === 47.5, 'Luis (4n, caballo 5 llega 1ro, gana completo) 50 -5% = 47,5');
const tSofia = resultado.tickets.find(t => t.clienteNombre === 'SOFIA');
check(tSofia && tSofia.resultadoJugador === 76, 'Sofia (5n, caballo 2 llega 2do — pos 2 < 5, gana completo) 80 -5% = 76');
const tCarlos = resultado.tickets.find(t => t.clienteNombre === 'CARLOS');
check(tCarlos && tCarlos.resultadoJugador === 475, 'Carlos (10 a 5, caballo 5 llega 1ro) 1000 x 0,5 -5% = 475');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
