// =================================================================
// PRUEBA: jugadas mixtas de 2 modalidades, apuesta a varios caballos
// ("o uno o el otro"), y el formato compacto de plano de "Grupo
// Gorila" (24-09-2026)
// =================================================================
// El usuario mandó un plano REAL de otro grupo de WhatsApp ("Grupo
// Gorila", "otro plano, otra manera de leer jugadas") con líneas como
// "Yellowtone 1/2-1p 10 puertolacruz 36" (sin "Juega"/"con"/"da", 5
// campos separados por espacio) y "Boss 1p 6,10 journalism 300"
// (apuesta a 2 caballos con un solo monto). En el mismo mensaje explicó
// con números reales una jugada mixta de 2 modalidades a la vez:
//   - "1/2-1p" con 55,00: si el caballo gana, gana completo -5%; si
//     llega 2do, pierde 41,25 (el 1p completo = 27,50, más la mitad del
//     1/2 = 13,75).
//   - "2n 1y2" (con espacio) con 100,00: si el caballo llega 2do,
//     pierde solo 25 (la mitad del "2n" no se decide = 0, la mitad del
//     "1y2" pierde la mitad = 25).
// Y confirmó por AskUserQuestion que la apuesta a varios caballos es
// "o uno o el otro" (el monto completo se resuelve con el MEJOR
// resultado entre los caballos listados) y que el separador de una
// jugada mixta puede venir con guion pegado O con espacio.
const assert = require('assert');
const path = require('path');
const {
  calcularPlano, resolverModalidadCompuesta, resolverModalidadMultiCaballo,
  normalizarModalidadCombo, recalcularTicket, parsearPizarra, LINEA_REGEX_COMPACTA
} = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) normalizarModalidadCombo: guion pegado y espacio dan lo mismo ---
check(normalizarModalidadCombo('1/2-1p') === '1/2-1p', '1) "1/2-1p" (guion) se normaliza igual');
check(normalizarModalidadCombo('2n 1y2') === '2n-1y2', '1) "2n 1y2" (espacio) se normaliza a "2n-1y2"');
check(normalizarModalidadCombo('1p') === '1p', '1) modalidad simple sin combinar no se toca');
// REGRESIÓN (bug encontrado y corregido en esta misma ronda, antes de
// entregar): "10 a 5" es UNA sola modalidad de décimos que de por sí
// trae espacios adentro — no debe partirse como si fuera una
// combinación de 2.
check(normalizarModalidadCombo('10 a 5') === '10 a 5', '1) REGRESIÓN: "10 a 5" (décimos, con espacios propios) NO se rompe');
check(normalizarModalidadCombo('10aini') === '10aini', '1) "10aini" (alias) tampoco se rompe (no calza como combo de 2)');

// --- 2) resolverModalidadCompuesta: los 2 ejemplos numéricos exactos del usuario ---
{
  const rGana = resolverModalidadCompuesta('1/2-1p', 1);
  check(rGana.j === 1, '2) "1/2-1p" pos=1 (gana) -> fracción completa');
  const rPierde = resolverModalidadCompuesta('1/2-1p', 2);
  check(Math.abs(rPierde.j * 55 - -41.25) < 0.001, '2) "1/2-1p" con 55,00, pos=2 -> pierde 41,25 (ejemplo exacto del usuario)');
}
{
  const rEspacio = resolverModalidadCompuesta(normalizarModalidadCombo('2n 1y2'), 2);
  check(Math.abs(rEspacio.j * 100 - -25) < 0.001, '2) "2n 1y2" con 100,00, pos=2 -> pierde 25 (ejemplo exacto del usuario)');
  const rGuion = resolverModalidadCompuesta('2n-1y2', 2);
  check(rGuion.j === rEspacio.j, '2) "2n-1y2" (guion) da EXACTO lo mismo que "2n 1y2" (espacio)');
}
// "pp" no se combina (formato de caballo distinto, necesita 2 caballos)
check(resolverModalidadCompuesta('pp-1p', 1) === null, '2) "pp" combinada con otra modalidad -> null (no soportado, no se arriesga un cálculo mal hecho)');
// 3+ modalidades combinadas: no soportado
check(resolverModalidadCompuesta('1p-2p-3p', 1) === null, '2) 3 modalidades combinadas -> null (no soportado)');

// --- 3) resolverModalidadMultiCaballo: "o uno o el otro" ---
{
  const rankGanaEl10 = parsearPizarra('10.5.6'); // 10 llega 1ro, 6 llega 3ro
  const r = resolverModalidadMultiCaballo('1p', [6, 10], rankGanaEl10);
  check(r.j === 1, '3) 1p a caballos (6,10): gana el 10 -> el jugador gana completo (el mejor de los 2)');
}
{
  const rankNingunoGana = parsearPizarra('5.6.10'); // ni el 6 ni el 10 llegan 1ro
  const r = resolverModalidadMultiCaballo('1p', [6, 10], rankNingunoGana);
  check(r.j === -1, '3) 1p a caballos (6,10): ninguno gana -> pierde completo');
}
check(resolverModalidadMultiCaballo('1p', [6, 99], parsearPizarra('1')) === null || true, '3) (sanity) no revienta con caballos fuera de pizarra');

// --- 4) LINEA_REGEX_COMPACTA reconoce el formato de Grupo Gorila ---
check(LINEA_REGEX_COMPACTA.test('Gordo 1/2 10 soyganador 100'), '4) reconoce línea simple sin "Juega/con/da"');
check(LINEA_REGEX_COMPACTA.test('Yellowtone 1/2-1p 10 puertolacruz 36'), '4) reconoce línea con modalidad mixta (guion)');
check(LINEA_REGEX_COMPACTA.test('Boss 1p 6,10 journalism 300'), '4) reconoce línea con 2 caballos (coma)');
check(!LINEA_REGEX_COMPACTA.test('*🇻🇪Grupo Gorila🇻🇪*'), '4) NO confunde el nombre del grupo con una jugada');
check(!LINEA_REGEX_COMPACTA.test('*LA RINCONADA 14MA*'), '4) NO confunde el hipódromo/carrera con una jugada');

// --- 5) Plano REAL completo de "Grupo Gorila", de punta a punta ---
const PLANO_GORILA = `*🇻🇪Grupo Gorila🇻🇪*
*LA RINCONADA 14MA*

 *TERCIOS*

Gordo 1/2 10 soyganador 100
Polche 1/2 10 soyganador 50
Yellowtone 1/2-1p 10 puertolacruz 36
Yellowtone 1/2-1p 10 soyganador 50
Polche 1/2-1p 10 soyganador 100
Jordan 1/2-1p 10 cucui 38
Jordan 1/2-1p 10 Jaimito 262
Polche 1/2-1p 10 gato 25,5
Jordan 1/2-1p 10 newcastle 100
Jaimito 1/2-1p 10 Alberto 40
Lacava 1/2-1p 10 bombona 300
Lacava 1/2-1p 10 líder 55
Azabache 1/2 10 portugués 50
Gordo 1/2 10 Jaimito 100
Hh 1/2-1p 10 luisu 10
Azabache 1/2 10 Holliday 200
Boss 1p 6,10 journalism 300



------------------------------
*PLANO REFERENCIAL*
*_La guía es el chat_*
(se gana y se cobra con el chat)
*USTED ES SU PROPIO CORREDOR*
*RECLAMOS AL PRIVADO*
*VERIFICAR SUS JUGADAS POR FAVOR*
*NO DIGA:* ❌MALO❌; CASA FALTA...
*TILDE SU JUGADA Y SE REVISARÁ*`;

// Pizarra: el caballo 10 llega 1ro (así "1/2"/"1p" ganan completo en la
// mayoría de las líneas, y el multi-caballo de Boss también gana).
const resultado = calcularPlano({ texto: PLANO_GORILA, pizarra: '10.6.3', cruzar: false });
check(resultado.huboLineas === true, '5) huboLineas = true');
check(resultado.tickets.length === 17, '5) las 17 líneas de jugadas se reconocen (ninguna se pierde)');
check(resultado.sinReconocer.length === 0, '5) ninguna línea cae en "sin reconocer"');
const salidaTexto = resultado.salidaLineas.join('\n');
check(!salidaTexto.includes('Grupo Gorila') && !salidaTexto.includes('RINCONADA'), '5) el encabezado pegado (sin "Pizarra:") NO se cuela en el resultado');
check(!salidaTexto.includes('PLANO REFERENCIAL') && !salidaTexto.includes('CORREDOR'), '5) el pie pegado NO se cuela en el resultado');

const tGordo = resultado.tickets.find(t => t.clienteNombre === 'GORDO' && t.banqueroNombre === 'SOYGANADOR');
check(tGordo && tGordo.resultadoJugador === 95, '5) Gordo (1/2, caballo 10 gana) 100 -5% = 95');
const tYellowtone1 = resultado.tickets.find(t => t.clienteNombre === 'YELLOWTONE' && t.banqueroNombre === 'PUERTOLACRUZ');
check(tYellowtone1 && tYellowtone1.modalidad === '1/2-1p', '5) Yellowtone: modalidad guardada como "1/2-1p"');
check(tYellowtone1 && Math.abs(tYellowtone1.resultadoJugador - 34.2) < 0.001, '5) Yellowtone (1/2-1p, caballo 10 gana) 36 -5% = 34,20 (gana completo)');
const tBoss = resultado.tickets.find(t => t.clienteNombre === 'BOSS');
check(tBoss && tBoss.caballo === '6,10', '5) Boss: caballo guardado como "6,10" (los 2 caballos jugados)');
check(tBoss && tBoss.resultadoJugador === 285, '5) Boss (1p a 6,10 — "o uno o el otro" — gana el 10) 300 -5% = 285');

// --- 6) editar un ticket ya guardado con recalcularTicket() ---
{
  const rank = parsearPizarra('10.6.3');
  const r = recalcularTicket({ modalidad: '1/2-1p', caballo: '10', monto: 55 }, rank);
  check(Math.abs(r.resultadoJugador - 52.25) < 0.001, '6) recalcularTicket: "1/2-1p" con 55,00, caballo 10 gana -> 55 x 0,95 = 52,25');
}
{
  const rank = parsearPizarra('5.10.6'); // el 10 llega 2do (posición 2)
  const r = recalcularTicket({ modalidad: '1/2-1p', caballo: '10', monto: 55 }, rank);
  check(Math.abs(r.resultadoJugador - -41.25) < 0.001, '6) recalcularTicket: "1/2-1p" con 55,00, caballo 10 llega 2do -> -41,25 (mismo ejemplo del usuario)');
}
{
  const rank = parsearPizarra('5.6.10'); // ni 6 ni 10 llegan 1ro
  const r = recalcularTicket({ modalidad: '1p', caballo: '6,10', monto: 300 }, rank);
  check(Math.abs(r.resultadoJugador - -300) < 0.001, '6) recalcularTicket: "1p" a "6,10", ninguno gana -> pierde completo -300');
}

// --- 7) el formato viejo ("Juega...da...") también soporta combos y multi-caballo ---
{
  const texto = 'Juega Bombero 2n 1y2 (1) con 100,00 da Mujica';
  const r = calcularPlano({ texto, pizarra: '5.1.9', cruzar: false }); // caballo 1 llega 2do
  check(r.tickets.length === 1 && r.sinReconocer.length === 0, '7) formato viejo con combo "2n 1y2" (espacio) también se reconoce');
  check(r.tickets[0] && Math.abs(r.tickets[0].resultadoJugador - -25) < 0.001, '7) formato viejo: mismo resultado -25 que el ejemplo del usuario');
}
{
  const texto = 'Juega Boss 1p (6,10) con 300,00 da Journalism';
  const r = calcularPlano({ texto, pizarra: '10.6.3', cruzar: false });
  check(r.tickets.length === 1 && r.tickets[0].caballo === '6,10', '7) formato viejo también soporta multi-caballo entre paréntesis');
}

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
