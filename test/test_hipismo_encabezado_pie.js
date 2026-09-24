// =================================================================
// PRUEBA: encabezado/pie FIJO de "Cargar Planos" (24-09-2026) — a pedido
// del usuario, que pegó un plano real ya armado (con su propio
// encabezado "🇻🇪🏇🏟️ZENYATTA🏟️🏇🇻🇪", hipódromo+carrera, "Ret:", "Pizarra:",
// "*TERCIOS*", y su pie "*PLANO REFERENCIAL*" completo) y pidió: "debes
// leerlo y calcularlo, si el encabezado o el pie cambia no importa, lo
// que te importa es que leas y me des de vuelta las jugadas con el
// encabezado y el pie que te configuro". Ver la nota grande de
// limpiarEncabezadoYPie() y armarTextoResultado() en
// src/services/hipismoCalc.js — prueba directa contra el módulo (sin
// pasar por el router/Express), mismo criterio que otras pruebas
// puramente unitarias de este archivo (ej. test_hipismo_pizarra_separadores.js).
//
// Casos cubiertos:
//   1. ordinalCarrera(): 1ra, 2da, 3ra, 4ta...9na, y 10ma en adelante
//      (10ma, 11ma, 12ma...) — antes SIEMPRE devolvía "Nta" (bug: "11ta"
//      en vez de "11ma", el ejemplo real del usuario).
//   2. limpiarEncabezadoYPie(): descarta el encabezado (hasta "Pizarra:",
//      más un "*TERCIOS*"/blancos/rayas pegados justo después) y el pie
//      (desde "PLANO REFERENCIAL" hasta el final) de un texto pegado
//      completo, dejando SOLO las líneas de jugadas; un texto que NO
//      trae esas anclas (el caso de siempre, solo jugadas sueltas) no se
//      toca en absoluto.
//   3. calcularPlano() end-to-end con el plano REAL que pegó el usuario
//      (encabezado + jugadas + pie): no duplica el encabezado/pie en el
//      resultado, reconoce las líneas con modalidades soportadas, y dos
//      líneas con una modalidad NO soportada todavía ("2/3") quedan
//      señaladas en sinReconocer (no se pierden en silencio).
//   4. armarTextoResultado(): el encabezado que arma siempre usa
//      ordinalCarrera() y agrega "*TERCIOS*" como parte fija — sin
//      importar qué traiga el texto de entrada.
const assert = require('assert');
const path = require('path');
const { ordinalCarrera, limpiarEncabezadoYPie, calcularPlano, armarTextoResultado } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) ordinalCarrera ---
check(ordinalCarrera(1) === '1ra', '1) ordinalCarrera(1) = "1ra"');
check(ordinalCarrera(2) === '2da', 'ordinalCarrera(2) = "2da"');
check(ordinalCarrera(3) === '3ra', 'ordinalCarrera(3) = "3ra"');
check(ordinalCarrera(4) === '4ta', 'ordinalCarrera(4) = "4ta"');
check(ordinalCarrera(5) === '5ta', 'ordinalCarrera(5) = "5ta"');
check(ordinalCarrera(6) === '6ta', 'ordinalCarrera(6) = "6ta"');
check(ordinalCarrera(7) === '7ma', 'ordinalCarrera(7) = "7ma"');
check(ordinalCarrera(8) === '8va', 'ordinalCarrera(8) = "8va"');
check(ordinalCarrera(9) === '9na', 'ordinalCarrera(9) = "9na"');
check(ordinalCarrera(10) === '10ma', 'ordinalCarrera(10) = "10ma"');
check(ordinalCarrera(11) === '11ma', 'ordinalCarrera(11) = "11ma" (el ejemplo real del usuario: "La Rinconada, 11ma Carrera")');
check(ordinalCarrera(12) === '12ma', 'ordinalCarrera(12) = "12ma"');
check(ordinalCarrera('11') === '11ma', 'ordinalCarrera acepta el número como string (viene de un <select>/body JSON)');

// --- 2) limpiarEncabezadoYPie ---
const PLANO_PEGADO_USUARIO = ` *🇻🇪🏇🏟️ZENYATTA🏟️🏇🇻🇪*
La Rinconada, 11ma Carrera
Ret:
Pizarra: .....

 *TERCIOS*
Juega Rambo 1/2 (8) con 150,00 da Tykhe
Juega Bombero 1/2 (1) con 50,00 da Mujica
Juega Bombero 2n (1) con 50,00 da Mujica
Juega Josue 1/2 (1) con 100,00 da Mrincreible
Juega Milwaukee 2p (8) con 20,00 da Horacio
Juega Riky pp (4x3) con 15,00 da Zamuray
------------------------------

------------------------------
*PLANO REFERENCIAL*
*_La guía es el chat_*
(se gana y se cobra con el chat)
*USTED ES SU PROPIO CORREDOR*
*RECLAMOS AL PRIVADO*
*NO DIGA:* ❌MALO❌; CASA FALTA...
*TILDE SU JUGADA Y SE REVISARÁ*`;

const limpio = limpiarEncabezadoYPie(PLANO_PEGADO_USUARIO);
check(!/ZENYATTA/.test(limpio), '2) limpiarEncabezadoYPie() descarta la línea del título (ZENYATTA)');
check(!/La Rinconada, 11ma Carrera/.test(limpio), 'Descarta la línea de hipódromo/carrera');
check(!/Pizarra:/.test(limpio), 'Descarta la línea "Pizarra:"');
check(!/TERCIOS/.test(limpio), 'Descarta el "*TERCIOS*" suelto (armarTextoResultado agrega el suyo)');
check(!/PLANO REFERENCIAL/.test(limpio), 'Descarta el pie completo ("PLANO REFERENCIAL" en adelante)');
check(!/------/.test(limpio), 'Descarta las rayas separadoras del encabezado/pie');
check(limpio.split('\n').every(l => l.trim() === '' || /^Juega /.test(l)), 'Lo único que queda son líneas "Juega..." (sin líneas sueltas de ruido)');
check(limpio.split('\n').filter(l => /^Juega /.test(l)).length === 6, 'Quedan las 6 líneas de jugadas exactas, ni una de más ni de menos');

// Un texto SIN encabezado/pie (el caso de siempre) no se toca en nada.
const SOLO_JUGADAS = 'Juega Pedro 1p (5) con 100,00 da Sammy';
check(limpiarEncabezadoYPie(SOLO_JUGADAS) === SOLO_JUGADAS, 'Un texto sin encabezado/pie pegado queda exactamente igual (no rompe el uso de siempre)');
check(limpiarEncabezadoYPie('') === '', 'Texto vacío no revienta');
check(limpiarEncabezadoYPie(undefined) === '', 'Texto undefined no revienta (devuelve string vacío)');

// --- 3) calcularPlano() end-to-end con el plano real completo ---
const resultado = calcularPlano({ texto: PLANO_PEGADO_USUARIO, pizarra: '8.1.4', cruzar: true });
check(resultado.huboLineas === true, '3) calcularPlano() reconoce líneas en el plano pegado completo');
check(resultado.tickets.length === 6, 'Reconoce las 6 jugadas (1/2, 1/2, 2n, 1/2, 2p, pp — todas modalidades ya soportadas)');
check(resultado.sinReconocer.length === 0, 'Ninguna línea sin reconocer con estas modalidades');
check(!resultado.salidaLineas.some(l => /ZENYATTA|PLANO REFERENCIAL|Pizarra:/.test(l)), 'El encabezado/pie pegado NUNCA aparece mezclado en salidaLineas');

// Con una modalidad NO soportada todavía ("2/3") en el medio: no se
// pierde en silencio, queda marcada para que el operador la revise.
const CON_MODALIDAD_NO_SOPORTADA = PLANO_PEGADO_USUARIO.replace('Juega Rambo 1/2 (8) con 150,00 da Tykhe', 'Juega Rambo 2/3 (8) con 150,00 da Tykhe');
const resultado2 = calcularPlano({ texto: CON_MODALIDAD_NO_SOPORTADA, pizarra: '8.1.4', cruzar: true });
check(resultado2.sinReconocer.some(l => /2\/3/.test(l)), 'Una modalidad todavía no soportada ("2/3") queda en sinReconocer, no se calcula ni se pierde en silencio');
check(resultado2.tickets.length === 5, 'Las otras 5 líneas SÍ se calculan bien aunque una quede sin reconocer');

// --- 4) armarTextoResultado(): encabezado fijo con ordinalCarrera() + "*TERCIOS*" ---
const texto = armarTextoResultado({
  nombreGrupo: 'zenyatta', hipodromoNombre: 'La Rinconada', carreraNumero: 11, ret: '', pizarra: '8.1.4',
  salidaLineas: resultado.salidaLineas, totalesFinales: resultado.totalesFinales, totalJugadas: resultado.tickets.length
});
check(texto.startsWith('*🇻🇪🏇🏟️ZENYATTA🏟️🏇🇻🇪*\nLa Rinconada, 11ma Carrera\nRet: \nPizarra: 8.1.4\n\n*TERCIOS*'), '4) El encabezado usa ordinalCarrera() ("11ma", no "11ta") y siempre incluye "*TERCIOS*"');
check(texto.endsWith('*TILDE SU JUGADA Y SE REVISARÁ*'), 'El pie configurado (PLANO REFERENCIAL) sigue yendo al final');
check((texto.match(/PLANO REFERENCIAL/g) || []).length === 1, 'El pie aparece UNA sola vez (nunca duplicado)');
check((texto.match(/TERCIOS/g) || []).length === 1, '"*TERCIOS*" aparece UNA sola vez (nunca duplicado)');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
