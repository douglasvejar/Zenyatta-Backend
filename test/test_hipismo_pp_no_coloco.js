// =================================================================
// PRUEBA: "pp" (cruzado, la Marca dentro de un plano de Tercios) cuando
// NINGUNO de los 2 caballos figura en la pizarra (29-09-2026, caso real
// reportado por el usuario con una captura de "Sebastian": jugó
// "1x7 pp" con Pizarra "8.2.3.4" -- ni el 1 ni el 7 aparecen ahí -- y el
// sistema se la estaba cobrando COMPLETA como perdida (-100,00 cada
// línea, -200,00 total), en vez de no decidirla.
//
// El usuario explicó la regla real: para que una Marca se decida, alguno
// de los 2 caballos tiene que figurar entre las posiciones que cuentan
// para ese hipódromo (top 4 en hipódromos de EEUU, top 5 en Venezuela —
// la pizarra que arma el operador ya viene con esa cantidad de
// posiciones). Si NINGUNO de los 2 figura, la jugada NO SE DECIDE (0 y
// 0) — la misma regla que resolverClienteMarca() (Jugadas Adelantadas,
// services/hipismoAdelantadasCalc.js) YA aplicaba correctamente desde
// antes; el bug estaba solo del lado de Tercios/"Cargar Planos"
// (resolverModalidad('pp', ...) en services/hipismoCalc.js), que hasta
// este arreglo le daba la jugada completa al banquero en vez de anularla
// — un criterio heredado sin confirmar del mockup viejo (ver el
// historial de git de esa función).
//
// Si SOLO UNO de los 2 figura, sigue ganando automático (no cambia:
// nunca fue el caso reportado ni el que estaba mal). Si los 2 figuran,
// sigue ganando el de mejor puesto (rank más chico), tampoco cambia.
// =================================================================
const path = require('path');
const { resolverModalidad, parsearPizarra, calcularPlano, recalcularTicket } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) resolverModalidad('pp', ...) directo, con los ranks ya resueltos ---
check(JSON.stringify(resolverModalidad('pp', 99, 99)) === JSON.stringify({ j: 0, b: 0 }),
  '1a) ARREGLO: ninguno de los 2 figura (ambos rank 99) -> NO SE DECIDE (0 y 0), ya no gana el banquero');
check(JSON.stringify(resolverModalidad('pp', 3, 99)) === JSON.stringify({ j: 1, b: -1 }),
  '1b) Solo el caballo A figura (rank 3) y B no (99) -> sigue ganando A automático, sin cambios');
check(JSON.stringify(resolverModalidad('pp', 99, 2)) === JSON.stringify({ j: -1, b: 1 }),
  '1c) Solo el caballo B figura (rank 2) y A no (99) -> sigue ganando B (pierde el jugador), sin cambios');
check(JSON.stringify(resolverModalidad('pp', 1, 4)) === JSON.stringify({ j: 1, b: -1 }),
  '1d) Los 2 figuran, A mejor colocado (rank 1 vs 4) -> sigue ganando A, sin cambios');
check(JSON.stringify(resolverModalidad('pp', 4, 1)) === JSON.stringify({ j: -1, b: 1 }),
  '1e) Los 2 figuran, B mejor colocado (rank 1 vs 4) -> sigue ganando B (pierde el jugador), sin cambios');

// --- 2) parsearPizarra: confirma los ranks reales del caso de Sebastian ---
const rank = parsearPizarra('8.2.3.4');
check(rank(1) === 99 && rank(7) === 99, '2) Pizarra "8.2.3.4" (caso real): ni el caballo 1 ni el 7 figuran -- ambos dan rank 99');

// --- 3) calcularPlano() end-to-end, reproduciendo el caso real completo ---
const PLANO_SEBASTIAN = 'Juega Sebastian pp (1x7) con 100,00 da Codina';
const resultado = calcularPlano({ texto: PLANO_SEBASTIAN, pizarra: '8.2.3.4', cruzar: false });
check(resultado.huboLineas === true, '3a) calcularPlano() reconoce la línea "pp"');
check(resultado.tickets.length === 1, '3b) Genera 1 solo ticket');
const ticket = resultado.tickets[0];
check(!!ticket && ticket.resultadoJugador === 0 && ticket.resultadoBanquero === 0,
  `3c) ARREGLO PRINCIPAL: Sebastian (cliente) NO pierde los 100,00 -- la jugada queda en 0/0 (no decidida) en vez de -100,00/+100,00. Dio: jugador=${ticket ? ticket.resultadoJugador : 'nada'}, banquero=${ticket ? ticket.resultadoBanquero : 'nada'}`);
check(!!ticket && ticket.clienteNombre === 'SEBASTIAN' && ticket.banqueroNombre === 'CODINA' && ticket.modalidad === 'pp' && ticket.monto === 100,
  '3d) El ticket se guarda igual que siempre (cliente/banquero/modalidad/monto) -- solo cambia el resultado calculado');

// Con pizarra distinta, donde el 1 SÍ figura (2do lugar) -- confirma que
// calcularPlano() sigue decidiendo normal cuando corresponde (no quedó
// "todo en 0" por accidente del arreglo).
const resultadoDecide = calcularPlano({ texto: PLANO_SEBASTIAN, pizarra: '8.1.3.4', cruzar: false });
const ticketDecide = resultadoDecide.tickets[0];
check(!!ticketDecide && ticketDecide.resultadoJugador > 0 && ticketDecide.resultadoBanquero < 0,
  `3e) Con pizarra "8.1.3.4" (el 1 SÍ figura, 2do lugar) la jugada SÍ se decide y Sebastian gana -- dio jugador=${ticketDecide ? ticketDecide.resultadoJugador : 'nada'}`);

// --- 4) recalcularTicket() (editar un ticket ya guardado) -- mismo caso ---
const rankSebastian = parsearPizarra('8.2.3.4');
const recalculado = recalcularTicket({ modalidad: 'pp', caballo: '1x7', monto: 100, sinComision: false }, rankSebastian);
check(!!recalculado && recalculado.resultadoJugador === 0 && recalculado.resultadoBanquero === 0,
  `4) recalcularTicket() (editar un ticket ya guardado) aplica el MISMO arreglo -- dio jugador=${recalculado ? recalculado.resultadoJugador : 'nada'}, banquero=${recalculado ? recalculado.resultadoBanquero : 'nada'}`);

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
