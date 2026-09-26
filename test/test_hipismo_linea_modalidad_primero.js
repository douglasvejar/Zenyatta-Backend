// =================================================================
// PRUEBA: 3er formato de línea compacta de "Cargar Planos" — Módulo
// Hipismo (26-09-2026, a pedido del usuario, con un plano real de
// ejemplo pegado por él: "10a7 5 100 richard LUSHO" ... "10a7 5 50
// bombero tolerante"). El usuario explicó la lectura: "10A7 5 50
// BOMBERO TOLERANTE" se lee "Bombero jugó 10a7 el 5 con 50 y lo da
// Tolerante" — "10/7 el valor de la jugada, después el número de
// caballo el 5, después 50 el monto, después el primer nombre siempre
// es el que juega y el segundo el que da".
//
// Este formato tiene el MISMO significado que LINEA_REGEX_COMPACTA ya
// existente (cliente, modalidad, caballo, banquero, monto) pero con el
// ORDEN DE CAMPOS distinto (modalidad, caballo, monto, cliente,
// banquero) — ver LINEA_REGEX_MODALIDAD_PRIMERO en hipismoCalc.js.
//
// Casos cubiertos:
//   1. El ejemplo real completo del usuario (7 líneas, modalidad "a
//      premio" con y sin coma decimal) -> calcularPlano() reconoce las
//      7, ninguna en sinReconocer, cada ticket con jugador/banquero en
//      el orden correcto (primer nombre juega, segundo da).
//   2. Los montos calculados dan igual que la MISMA jugada escrita en
//      el formato compacto viejo (mismo cliente/modalidad/caballo/
//      monto) — confirma que es el mismo motor de cálculo, solo
//      cambia el orden en que se leen los campos.
//   3. Una modalidad distinta de "a premio" (ej. "1p") también funciona
//      con este orden de campos — no es exclusivo de los décimos.
//   4. Una línea de este formato con datos inválidos (monto no
//      numérico) NO calza ninguno de los 3 formatos -> sinReconocer.
const {
  calcularPlano, LINEA_REGEX_MODALIDAD_PRIMERO, LINEA_REGEX_COMPACTA
} = require('../src/services/hipismoCalc.js');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) El ejemplo real completo del usuario ---
const PLANO_EJEMPLO_USUARIO = `10a7 5 100 richard LUSHO
10a7 5 50 richard tony
10a7,5 5 200 LUSHO place
10a7,5 5 100 petit place
10a7,5 5 50 sammy yameko
10a7 5 50 alexis richard
10a7 5 50 bombero tolerante`;
// Pizarra 5.2.1.9 -> el caballo 5 llega 1ro (todas las líneas ganan).
const r1 = calcularPlano({ texto: PLANO_EJEMPLO_USUARIO, pizarra: '5.2.1.9', cruzar: false });
check(r1.sinReconocer.length === 0, '1a) Las 7 líneas del plano real del usuario se reconocen (ninguna en sinReconocer)');
check(r1.tickets.length === 7, '1b) Se calculan las 7 líneas');

const tBombero = r1.tickets.find(t => t.clienteNombre === 'BOMBERO');
check(!!tBombero, '1c) "bombero" (primer nombre) quedó como el CLIENTE que juega');
check(tBombero && tBombero.banqueroNombre === 'TOLERANTE', '1d) "tolerante" (segundo nombre) quedó como el BANQUERO que da');
check(tBombero && tBombero.caballo === '5', '1e) El caballo es el 5');
check(tBombero && Number(tBombero.monto) === 50, '1f) El monto es 50');
check(tBombero && Math.abs(tBombero.resultadoJugador - 33.25) < 0.001, '1g) 10a7 (N=7), caballo 5 gana, monto 50 -> 50*0,7*0,95 = 33,25');
check(tBombero && Math.abs(tBombero.resultadoBanquero - (-35)) < 0.001, '1h) El banquero pierde el espejo SIN el 5% de comisión: -35');

const tLushoPlace = r1.tickets.find(t => t.clienteNombre === 'LUSHO' && t.banqueroNombre === 'PLACE');
check(!!tLushoPlace, '1i) "LUSHO place" (modalidad con coma decimal 10a7,5) también se reconoce');
check(tLushoPlace && Math.abs(tLushoPlace.resultadoJugador - 142.5) < 0.001, '1j) 10a7,5 (N=7,5), caballo 5 gana, monto 200 -> 200*0,75*0,95 = 142,5');

// Confirma también el otro cliente que juega contra "richard" como
// banquero, y el caso donde richard es el que da (no el que juega).
const tRichardJuega = r1.tickets.find(t => t.clienteNombre === 'RICHARD' && t.banqueroNombre === 'LUSHO');
check(!!tRichardJuega && Math.abs(tRichardJuega.resultadoJugador - 66.5) < 0.001, '1k) "richard" jugando 10a7 x 100 contra LUSHO -> 100*0,7*0,95 = 66,5');
const tAlexisRichardDa = r1.tickets.find(t => t.clienteNombre === 'ALEXIS' && t.banqueroNombre === 'RICHARD');
check(!!tAlexisRichardDa, '1l) "alexis richard" -> alexis juega (1er nombre), RICHARD da (2do nombre) — mismo nombre "richard" puede jugar en una línea y dar en otra');

// --- 2) Mismo resultado que el formato compacto viejo (cliente
//        primero) con los mismos datos, solo cambia el orden de lectura ---
{
  const viejo = calcularPlano({ texto: 'Bombero 10a7 5 Tolerante 50', pizarra: '5.2.1.9', cruzar: false });
  const nuevo = calcularPlano({ texto: '10a7 5 50 Bombero Tolerante', pizarra: '5.2.1.9', cruzar: false });
  const tViejo = viejo.tickets[0];
  const tNuevo = nuevo.tickets[0];
  check(!!tViejo && !!tNuevo, '2a) Los 2 formatos (viejo y nuevo) reconocen la línea equivalente');
  check(tViejo.clienteNombre === tNuevo.clienteNombre && tViejo.banqueroNombre === tNuevo.banqueroNombre,
    '2b) Mismo cliente/banquero en los 2 formatos');
  check(Math.abs(tViejo.resultadoJugador - tNuevo.resultadoJugador) < 0.001,
    '2c) Mismo resultado numérico en los 2 formatos (mismo motor de cálculo, solo cambia el orden de los campos)');
}

// --- 3) Otra modalidad (no "a premio") con este mismo orden de campos ---
{
  const r3 = calcularPlano({ texto: '1p 5 100 Junko Mujica', pizarra: '5.2.1.9', cruzar: false });
  check(r3.tickets.length === 1 && r3.sinReconocer.length === 0, '3a) "1p 5 100 Junko Mujica" (modalidad 1p, no décimos) también se reconoce');
  const t3 = r3.tickets[0];
  check(t3 && t3.clienteNombre === 'JUNKO' && t3.banqueroNombre === 'MUJICA', '3b) Junko juega, Mujica da (mismo orden: 1er nombre juega, 2do da)');
  check(t3 && Math.abs(t3.resultadoJugador - 95) < 0.001, '3c) 1p, caballo 5 llega 1ro (dentro de "1 puesto"), gana completo: 100 -5% = 95');
}

// --- 4) Línea con monto no numérico no calza ningún formato ---
{
  const r4 = calcularPlano({ texto: '10a7 5 nosemonto Bombero Tolerante', pizarra: '5.2.1.9', cruzar: false });
  check(r4.tickets.length === 0, '4) Con un monto no numérico, la línea no calza ningún formato (no se inventa un ticket)');
}

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron.`);
process.exit(fallaron > 0 ? 1 : 0);
