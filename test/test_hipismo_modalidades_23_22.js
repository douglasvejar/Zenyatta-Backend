// =================================================================
// PRUEBA: modalidades "2/3" y "2/2" como alias de "2y3"/"2y2" (24-09-2026)
// =================================================================
// El usuario pegó, en la ronda anterior, un plano REAL de "TERCIOS" con
// modalidades "2/3" y "2/2" que todavía no existían en resolverModalidad()
// — quedaban correctamente en sinReconocer (ver
// test_hipismo_encabezado_pie.js). Se le preguntó qué significaban y
// contestó, textual:
//
//   "2/3 ES IGUAL A 2P/3N Y 2/2 ES IGUAL A 2PY2N O 2P/2N...."
//
// Cruzando esto contra claude/spec-modulo-hipismo.md sección 6 (tabla ya
// CONFIRMADA con el usuario el 22-09-2026, "También se lee" de cada
// código): "2P/3N" es como se lee la modalidad "2y3", y "2P/2N" es como se
// lee "2y2". O sea: "2/3" y "2/2" NO son fórmulas nuevas — son alias de
// texto de modalidades que YA estaban confirmadas y en producción, mismo
// patrón ya usado para "1/2"≡"1y2". No hizo falta ningún ejemplo numérico
// nuevo: la matemática ya estaba verificada, solo faltaba reconocer el
// token.
//
// Casos cubiertos:
//   1. resolverModalidad('2/3', pos) da EXACTAMENTE lo mismo que
//      resolverModalidad('2y3', pos) para las 4 posiciones posibles.
//   2. resolverModalidad('2/2', pos) da EXACTAMENTE lo mismo que
//      resolverModalidad('2y2', pos) para las 3 posiciones posibles.
//   3. calcularPlano() con el plano REAL completo que pegó el usuario (21
//      líneas, incluyendo la línea con la palabra suelta "del" en medio:
//      "Juega Pedrito 2/2 del (8) con 4.000,00 da Tykhe") — las 21 líneas
//      se reconocen, 0 en sinReconocer.
//   4. El ticket guardado conserva la modalidad tal cual se escribió en el
//      plano ("2/3"/"2/2", no "2y3"/"2y2") — mismo criterio ya usado con
//      "1/2" vs "1y2".
//   5. Suma-cero: cada línea de "2/3"/"2/2", ANTES de comisión, siempre
//      reparte 0 entre jugador y banquero (nadie gana ni pierde plata de
//      la nada) — mismo chequeo que ya se les hace a Tablas Fijas/Marcas.
const assert = require('assert');
const path = require('path');
const { resolverModalidad, calcularPlano } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) "2/3" ≡ "2y3" para toda posición ---
for (let pos = 1; pos <= 4; pos++) {
  const a = resolverModalidad('2/3', pos);
  const b = resolverModalidad('2y3', pos);
  check(JSON.stringify(a) === JSON.stringify(b), `1) resolverModalidad("2/3", ${pos}) === resolverModalidad("2y3", ${pos}) -> ${JSON.stringify(a)}`);
}
check(JSON.stringify(resolverModalidad('2/3', 1)) === JSON.stringify({ j: 1, b: -1 }), 'Caballo llega 1ro: jugador gana completo -5% (se aplica en montoMostrado, acá es fracción bruta)');
check(JSON.stringify(resolverModalidad('2/3', 2)) === JSON.stringify({ j: 1, b: -1 }), 'Caballo llega 2do: jugador gana completo -5% (igual que 1ro)');
check(JSON.stringify(resolverModalidad('2/3', 3)) === JSON.stringify({ j: -0.5, b: 0.5 }), 'Caballo llega 3ro: jugador pierde LA MITAD, banquero gana esa mitad -5%');
check(JSON.stringify(resolverModalidad('2/3', 4)) === JSON.stringify({ j: -1, b: 1 }), 'Caballo llega 4to o peor: jugador pierde completo');

// --- 2) "2/2" ≡ "2y2" para toda posición ---
for (let pos = 1; pos <= 3; pos++) {
  const a = resolverModalidad('2/2', pos);
  const b = resolverModalidad('2y2', pos);
  check(JSON.stringify(a) === JSON.stringify(b), `2) resolverModalidad("2/2", ${pos}) === resolverModalidad("2y2", ${pos}) -> ${JSON.stringify(a)}`);
}
check(JSON.stringify(resolverModalidad('2/2', 1)) === JSON.stringify({ j: 1, b: -1 }), 'Caballo llega 1ro: jugador gana completo -5%');
check(JSON.stringify(resolverModalidad('2/2', 2)) === JSON.stringify({ j: 0.5, b: -0.5 }), 'Caballo llega 2do: jugador gana LA MITAD -5% (no pierde)');
check(JSON.stringify(resolverModalidad('2/2', 3)) === JSON.stringify({ j: -1, b: 1 }), 'Caballo llega 3ro o peor: jugador pierde completo');

// --- 3) calcularPlano() con el plano REAL completo del usuario ---
const PLANO_REAL_USUARIO = `Juega Rambo 2/3 (8) con 150,00 da Tykhe
Juega Rambo 2/3 (8) con 100,00 da Tykhe
Juega Zamuray 2/3 (8) con 30,00 da Tykhe
Juega Bombero 1/2 (1) con 50,00 da Mujica
Juega Bombero 2n (1) con 50,00 da Mujica
Juega Josue 1/2 (1) con 100,00 da Mrincreible
Juega Josue 2n (1) con 100,00 da Mrincreible
Juega Loba 1/2 (1) con 350,00 da Mrincreible
Juega Loba 2n (1) con 350,00 da Mrincreible
Juega Puertolacruz 1/2 (1) con 15,00 da Mrincreible
Juega Puertolacruz 2n (1) con 15,00 da Mrincreible
Juega Sammy 1/2 (1) con 200,00 da Pier
Juega Sammy 2n (1) con 200,00 da Pier
Juega Gringo 1/2 (1) con 75,00 da Pier
Juega Gringo 2n (1) con 75,00 da Pier
Juega Sammy 1/2 (1) con 50,00 da Hernan
Juega Sammy 2n (1) con 50,00 da Hernan
Juega Milwaukee 2p (8) con 20,00 da Horacio
Juega Milwaukee 2/2 (8) con 300,00 da Tykhe
Juega Haaland 2/2 (8) con 200,00 da Tykhe
Juega Pedrito 2/2 del (8) con 4.000,00 da Tykhe `;

const resultado = calcularPlano({ texto: PLANO_REAL_USUARIO, pizarra: '8.1.4', cruzar: true });
check(resultado.huboLineas === true, '3) calcularPlano() reconoce líneas en el plano real completo');
check(resultado.tickets.length === 21, 'Las 21 líneas del plano real se reconocen (antes, "2/3"/"2/2" caían en sinReconocer)');
check(resultado.sinReconocer.length === 0, '0 líneas sin reconocer — ni siquiera la de "Pedrito 2/2 del (8)" con la palabra suelta "del"');

const ticketPedrito = resultado.tickets.find(t => t.clienteNombre === 'PEDRITO');
check(!!ticketPedrito, 'La línea "Juega Pedrito 2/2 del (8) con 4.000,00 da Tykhe" (con "del" en medio) SÍ se reconoce');
check(ticketPedrito && ticketPedrito.modalidad === '2/2', 'El ticket de Pedrito guarda la modalidad tal cual se escribió ("2/2", no "2y2")');
check(ticketPedrito && ticketPedrito.monto === 4000, 'El monto "4.000,00" (con separador de miles) se parsea bien: 4000');
// Caballo 8 llega 1ro según la pizarra "8.1.4" -> con "2/2", pos 1 gana completo -5%.
check(ticketPedrito && ticketPedrito.resultadoJugador === 3800, 'Pedrito (2/2, caballo 8 llega 1ro) gana 4000 -5% = 3800');
check(ticketPedrito && ticketPedrito.resultadoBanquero === -4000, 'Tykhe (banquero de esa línea) paga los 4000 completos (pierde, no se le descuenta nada)');

// --- 4) Modalidad conservada tal cual en TODOS los tickets de "2/3"/"2/2" ---
const ticketsRambo23 = resultado.tickets.filter(t => t.clienteNombre === 'RAMBO' && t.modalidad === '2/3');
check(ticketsRambo23.length === 2, 'Las 2 líneas de Rambo con "2/3" quedan guardadas con esa modalidad exacta');
const ticketZamuray = resultado.tickets.find(t => t.clienteNombre === 'ZAMURAY');
check(ticketZamuray && ticketZamuray.modalidad === '2/3', 'Zamuray también guarda "2/3" tal cual');
const ticketMilwaukee22 = resultado.tickets.find(t => t.clienteNombre === 'MILWAUKEE' && t.modalidad === '2/2');
check(!!ticketMilwaukee22, 'Milwaukee con "2/2" (además de su otra línea "2p") se reconoce');
const ticketHaaland = resultado.tickets.find(t => t.clienteNombre === 'HAALAND');
check(ticketHaaland && ticketHaaland.modalidad === '2/2', 'Haaland guarda "2/2" tal cual');

// --- 5) Suma-cero: cada línea de "2/3"/"2/2" reparte 0 entre jugador y
// banquero ANTES de comisión (nadie gana ni pierde plata de la nada) ---
resultado.tickets.filter(t => t.modalidad === '2/3' || t.modalidad === '2/2').forEach(t => {
  const jRaw = t.resultadoJugador > 0 ? t.resultadoJugador / 0.95 : t.resultadoJugador;
  const bRaw = t.resultadoBanquero > 0 ? t.resultadoBanquero / 0.95 : t.resultadoBanquero;
  check(Math.abs(jRaw + bRaw) < 0.0001, `Suma-cero (bruto, antes de comisión) para ${t.clienteNombre} ${t.modalidad}: jRaw=${jRaw.toFixed(2)} + bRaw=${bRaw.toFixed(2)} = 0`);
});

// Regresión: "1/2" (que YA existía, familia distinta — A=1,B=2 -> pierde la
// mitad en 2do, no gana la mitad) sigue funcionando exactamente igual, sin
// que el agregado de "2/2"/"2/3" lo haya movido un poco.
check(JSON.stringify(resolverModalidad('1/2', 1)) === JSON.stringify({ j: 1, b: -1 }), 'Regresión: "1/2" pos 1 sigue igual (gana completo)');
check(JSON.stringify(resolverModalidad('1/2', 2)) === JSON.stringify({ j: -0.5, b: 0.5 }), 'Regresión: "1/2" pos 2 sigue igual (pierde la mitad — familia B=A+1, no la de "2/2"/"2/3")');
check(JSON.stringify(resolverModalidad('1/2', 3)) === JSON.stringify({ j: -1, b: 1 }), 'Regresión: "1/2" pos 3+ sigue igual (pierde completo)');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
