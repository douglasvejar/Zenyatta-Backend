// =================================================================
// PRUEBA DE LÓGICA PURA: al buscar a qué equipo se refiere una jugada, se
// prefiere el apodo MÁS ESPECÍFICO cuando 2 apodos matchean el mismo texto
// y uno contiene por completo al otro (06-09-2026, bug real reportado por
// el usuario).
// =================================================================
// El usuario reportó: "con un tikcet del inter de miami de futbol que
// tenia su icono de futbol no lo distingue y lo lee como beisbol aunque ya
// este mapeado y todo. Entonces obiviamente marca un error pero el error
// es al procesar la sabana en esa jugada."
//
// Causa: evaluarJugada() (evaluador.js) busca a qué equipo se refiere una
// jugada recorriendo TODOS los apodos del diccionario y quedándose con el
// PRIMERO que matchee, en el orden en que Object.keys() los devuelve — ese
// orden es simplemente el orden en que cada deporte se fue agregando al
// diccionario (MLB primero, fútbol bastante después), no el de qué tan
// ESPECÍFICO es el apodo. "inter miami" (fútbol, MLS, un solo candidato,
// sin ninguna ambigüedad) contiene la palabra completa "miami", que
// TAMBIÉN es un apodo por sí solo (Miami Marlins de MLB / Miami Dolphins
// de NFL, agregados mucho antes en el diccionario) — entonces para una
// jugada como "inter miami alta 4-115" el for encontraba "miami" primero,
// se quedaba con esos 2 candidatos (ninguno de fútbol) y nunca llegaba a
// ver "inter miami" — la jugada terminaba evaluada contra MLB o NFL en vez
// de fútbol.
//
// Arreglo (evaluador.js, evaluarJugada()): ya no corta en el primer match
// — junta TODOS los apodos que matcheen y se queda con el MÁS LARGO de
// ellos, pero SOLO cuando ese apodo más largo CONTIENE por completo al que
// ya se había encontrado (ej. "inter miami" contiene a "miami"). Cuando 2
// apodos que matchean son independientes entre sí y ninguno contiene al
// otro (ej. "houston" y "astros", o "chicago" y "cubs" — cada uno su
// propio apodo, no uno un superconjunto del otro) no se toca nada: se
// respeta cuál apareció primero en el diccionario, exactamente como ya
// funcionaba — esa ambigüedad real entre deportes ya la resuelve
// resolverCandidatoAmbiguo() (por partido del día, emoji/palabra clave,
// marcador de sección, etc.), y no es el bug que se está resolviendo acá.
const assert = require('assert');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');
const { evaluarJugada } = require('../src/services/evaluador');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// -----------------------------------------------------------------
// Caso 1 (el bug reportado): "inter miami" tiene que detectarse como tal
// — NO como el "miami" ambiguo de MLB/NFL — sin importar si hay o no un
// partido de Miami Marlins ese día (por eso ni siquiera hace falta datos
// de soccer acá: alcanza con que el DEBUG diga qué apodo detectó).
// -----------------------------------------------------------------
(function testInterMiamiNoEsMiami() {
  const datosPorDeporte = { mlb: {}, nfl: {}, soccer: {} };
  const resultado = evaluarJugada('inter miami alta 4-115', datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, { deporteMarcador: 'soccer' });

  check(resultado.debug.apodoDetectado === 'inter miami', 'Una jugada de "inter miami" detecta el apodo "inter miami" (fútbol) y no el "miami" genérico (MLB/NFL) — apodoDetectado fue "' + resultado.debug.apodoDetectado + '"');
  check(resultado.debug.equipoOficial === 'Inter Miami CF', 'El equipo oficial resuelto es Inter Miami CF, no Miami Marlins ni Miami Dolphins');
})();

// -----------------------------------------------------------------
// Caso 2 (no debe romperse — regresión): "inter miami cf" (con el CF
// explícito) sigue detectándose igual de bien, con el apodo más largo
// todavía disponible.
// -----------------------------------------------------------------
(function testInterMiamiCF() {
  const datosPorDeporte = { mlb: {}, nfl: {}, soccer: {} };
  const resultado = evaluarJugada('inter miami cf baja 2.5 -110', datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, { deporteMarcador: 'soccer' });
  check(resultado.debug.apodoDetectado === 'inter miami cf' || resultado.debug.apodoDetectado === 'inter miami', 'Una jugada de "inter miami cf" también detecta un apodo de fútbol de Inter Miami (no "miami" genérico) — apodoDetectado fue "' + resultado.debug.apodoDetectado + '"');
  check(resultado.debug.equipoOficial === 'Inter Miami CF', '"inter miami cf" también resuelve a Inter Miami CF');
})();

// -----------------------------------------------------------------
// Caso 3 (no debe romperse — regresión, el bug que este mismo arreglo casi
// introduce en el primer intento): apodos que NO se contienen entre sí
// (ej. "chicago" es una palabra completa aparte de "cubs", ninguna
// contiene a la otra) tienen que seguir resolviéndose exactamente igual
// que antes — con el apodo específico del equipo ("cubs"), no con la
// ciudad ambigua ("chicago", que en este diccionario también es de los
// Chicago Bears de NFL y los Chicago Blackhawks de NHL).
// -----------------------------------------------------------------
(function testChicagoCubsSigueSiendoCubs() {
  const datosPorDeporte = { mlb: {} };
  const resultado = evaluarJugada('chicago cubs -160', datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, {});
  check(resultado.debug.apodoDetectado === 'cubs', '"chicago cubs -160" sigue detectando el apodo específico "cubs" (MLB), no el "chicago" ambiguo (compartido con NFL/NHL) — apodoDetectado fue "' + resultado.debug.apodoDetectado + '"');
  check(resultado.debug.equipoOficial === 'Chicago Cubs', 'Resuelve a Chicago Cubs sin pasar por ninguna ambigüedad de por medio');
})();

// -----------------------------------------------------------------
// Caso 4 (no debe romperse — regresión): un apodo de una sola palabra que
// SÍ es único (sin ningún apodo más largo ni más corto en conflicto) se
// sigue resolviendo exactamente igual que siempre.
// -----------------------------------------------------------------
(function testApodoUnicoSinConflicto() {
  const datosPorDeporte = { mlb: {} };
  const resultado = evaluarJugada('dodgers -155', datosPorDeporte, DICCIONARIO_EQUIPOS_BASE, {});
  check(resultado.debug.apodoDetectado === 'dodgers', '"dodgers -155" sigue detectando "dodgers" normalmente');
  check(resultado.debug.equipoOficial === 'Los Angeles Dodgers', 'Resuelve a Los Angeles Dodgers');
})();

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
