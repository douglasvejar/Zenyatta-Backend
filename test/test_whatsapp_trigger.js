// =================================================================
// PRUEBA: detectarTriggerSabana() — la lógica pura que decide si un
// mensaje de WhatsApp "activa" la carga de una sábana (03-09-2026, a
// pedido del usuario: "existe alguna manera de que en mi chat de
// whatssap yo actualice la sabana y se cargue automatico en el
// sistema?"; formato revisado 04-09-2026, a pedido del usuario: "LA
// PLABRA QUE DISPARE SERA 'SABANA DE JUGADAS' Y ABAJO LA FECHA DEL DIA,
// COMO CORDON DE SEGURIDAD PARA QUE SEPAS QUE DIA ESTAMOS TRABAJANDO").
//
// Este archivo NO usa la base de datos falsa ni ningún Module._load —
// whatsappTrigger.js es 100% texto adentro/afuera a propósito, así se
// puede probar con total confianza incluso en un entorno sin acceso a
// internet ni a los paquetes de WhatsApp (ver README.md).
// =================================================================
const { detectarTriggerSabana, quitarLineaTrigger } = require('../src/services/whatsappTrigger');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) Casos básicos: con y sin tilde, mayúsculas/minúsculas ---
check(detectarTriggerSabana('SABANA DE JUGADAS\n03-09-2026').esSabana, 'SABANA DE JUGADAS (mayúsculas, sin tilde) + fecha activa el trigger');
check(detectarTriggerSabana('sabana de jugadas\n03-09-2026').esSabana, 'sabana de jugadas (minúsculas) activa el trigger');
check(detectarTriggerSabana('Sábana De Jugadas\n03-09-2026').esSabana, 'Sábana De Jugadas (con tilde) activa el trigger');
check(detectarTriggerSabana('SÁBANA DE JUGADAS\n03-09-2026').esSabana, 'SÁBANA DE JUGADAS (con tilde, mayúsculas) activa el trigger');
check(!detectarTriggerSabana('hola como estan').esSabana, 'un mensaje cualquiera NO activa el trigger');
check(!detectarTriggerSabana('esto no es la SABANA DE JUGADAS').esSabana, 'la frase en medio del mensaje (no al inicio) NO activa el trigger');
check(!detectarTriggerSabana('SABANA\n03-09-2026').esSabana, '"SABANA" sola (sin "DE JUGADAS") ya NO activa el trigger — cambió el formato');
check(!detectarTriggerSabana('SABANA DE APUESTAS\n03-09-2026').esSabana, 'una frase parecida pero distinta ("DE APUESTAS") no activa el trigger');

// --- 2) Casos raros/vacíos: no debe reventar ---
check(!detectarTriggerSabana('').esSabana, 'mensaje vacío no activa el trigger');
check(!detectarTriggerSabana('   ').esSabana, 'mensaje de solo espacios no activa el trigger');
check(!detectarTriggerSabana(null).esSabana, 'null no revienta, no activa el trigger');
check(!detectarTriggerSabana(undefined).esSabana, 'undefined no revienta, no activa el trigger');
check(!detectarTriggerSabana(12345).esSabana, 'un número (no texto) no revienta, no activa el trigger');
check(detectarTriggerSabana('  SABANA DE JUGADAS  \n03-09-2026').esSabana, 'espacios en blanco al inicio de la primera línea no rompen la detección');

// --- 3) Fecha en la SEGUNDA línea (el "cordón de seguridad"): los 3 formatos soportados ---
check(detectarTriggerSabana('SABANA DE JUGADAS\n03-09-2026').fecha === '2026-09-03', 'formato DD-MM-YYYY en la segunda línea se detecta y normaliza a YYYY-MM-DD');
check(detectarTriggerSabana('SABANA DE JUGADAS\n03/09/2026').fecha === '2026-09-03', 'formato DD/MM/YYYY se detecta y normaliza a YYYY-MM-DD');
check(detectarTriggerSabana('SABANA DE JUGADAS\n2026-09-03').fecha === '2026-09-03', 'formato YYYY-MM-DD se detecta tal cual (ya normalizado)');
check(detectarTriggerSabana('SABANA DE JUGADAS\n3-9-2026').fecha === '2026-09-03', 'día/mes de un solo dígito (sin cero adelante) también se detecta bien');
check(detectarTriggerSabana('SABANA DE JUGADAS\n03-09-2026').fechaEncontrada === true, 'fechaEncontrada queda en true cuando la fecha se pudo leer bien');

// --- 4) Sin fecha reconocible en la segunda línea -> fecha y fechaEncontrada quedan en null/false (no se inventa nada, "hoy" NUNCA se asume) ---
check(detectarTriggerSabana('SABANA DE JUGADAS').fecha === null, '"SABANA DE JUGADAS" sin ninguna segunda línea deja fecha en null');
check(detectarTriggerSabana('SABANA DE JUGADAS').fechaEncontrada === false, '"SABANA DE JUGADAS" sin segunda línea deja fechaEncontrada en false');
check(detectarTriggerSabana('SABANA DE JUGADAS\nDE HOY').fecha === null, '"DE HOY" en la segunda línea (no es una fecha en formato reconocido) deja fecha en null');
check(detectarTriggerSabana('SABANA DE JUGADAS\nDE HOY').fechaEncontrada === false, 'lo mismo para fechaEncontrada');
check(detectarTriggerSabana('SABANA DE JUGADAS\nLUNES').fecha === null, '"LUNES" (día de la semana, no fecha) en la segunda línea deja fecha en null');

// --- 5) La fecha solo se busca en la SEGUNDA línea, nunca en la primera ni en el resto ---
check(detectarTriggerSabana('SABANA DE JUGADAS 03-09-2026\n03-09-2026').fecha === '2026-09-03', 'una fecha pegada en la primera línea (junto al disparador) NO cuenta — solo importa la segunda línea (acá igual hay fecha correcta en la segunda)');
const primeraLineaConFecha = detectarTriggerSabana('SABANA DE JUGADAS 03-09-2026\nGIANCO 100-090');
check(primeraLineaConFecha.fecha === null, 'una fecha en la PRIMERA línea (junto al disparador) ya no se usa — el formato nuevo la exige en la línea de ABAJO');
const multilinea = detectarTriggerSabana('SABANA DE JUGADAS\n03-09-2026\nGIANCO 100-090 Cincinnati ML +130 100$ 02-09-2026');
check(multilinea.esSabana, 'un mensaje de varias líneas sigue activando el trigger si la primera línea es "SABANA DE JUGADAS"');
check(multilinea.fecha === '2026-09-03', 'la fecha se toma de la segunda línea, no de una fecha que aparezca más abajo en una jugada');

// --- 6) textoLimpio conserva el mensaje ORIGINAL sin tocar nada ---
const original = 'Sábana De Jugadas\n03-09-2026\nGIANCO ...\nMANOLO ...';
check(detectarTriggerSabana(original).textoLimpio === original, 'textoLimpio devuelve el mensaje exactamente igual a como llegó, sin recortar ni normalizar nada (eso se guarda tal cual en sabanas_pendientes_whatsapp.texto)');

// --- 7) Fecha inválida (fuera de rango) no se toma como buena ---
check(detectarTriggerSabana('SABANA DE JUGADAS\n32-13-2026').fecha === null, 'una fecha con día/mes fuera de rango (32-13-2026) no se acepta como fecha válida');
check(detectarTriggerSabana('SABANA DE JUGADAS\n32-13-2026').fechaEncontrada === false, 'y por lo tanto fechaEncontrada queda en false');

// --- 8) "SABANA DE JUGADAS FINAL" (revisado 04-09-2026): trigger de cierre, distinto de una actualización normal ---
check(detectarTriggerSabana('SABANA DE JUGADAS FINAL\n03-09-2026').esFinal === true, '"SABANA DE JUGADAS FINAL" activa esFinal');
check(detectarTriggerSabana('SABANA DE JUGADAS FINAL\n03-09-2026').esSabana === true, '"SABANA DE JUGADAS FINAL" también cuenta como esSabana (un cierre es, además, una sábana)');
check(detectarTriggerSabana('sabana de jugadas final\n03-09-2026').esFinal === true, '"sabana de jugadas final" en minúsculas también activa esFinal');
check(detectarTriggerSabana('Sábana De Jugadas Final\n03-09-2026').esFinal === true, '"Sábana De Jugadas Final" con tildes/mayúsculas mixtas también activa esFinal');
check(detectarTriggerSabana('SABANA DE JUGADAS FINAL\n03-09-2026').fecha === '2026-09-03', '"SABANA DE JUGADAS FINAL" detecta la fecha en la segunda línea igual que la forma normal');
check(detectarTriggerSabana('SABANA DE JUGADAS\n03-09-2026').esFinal === false, 'una "SABANA DE JUGADAS" normal (sin la palabra FINAL) NO activa esFinal');
check(detectarTriggerSabana('SABANA DE JUGADAS FINALIZADA\n03-09-2026').esFinal === false, '"SABANA DE JUGADAS FINALIZADA" no es lo mismo que "...FINAL" — no activa esFinal (límite de palabra)');
check(detectarTriggerSabana('SABANA DE JUGADAS FINALIZADA\n03-09-2026').esSabana === true, 'pero "SABANA DE JUGADAS FINALIZADA" sigue contando como una sábana normal (esSabana true, esFinal false)');
check(!detectarTriggerSabana('').esFinal, 'mensaje vacío no activa esFinal');
check(!detectarTriggerSabana(null).esFinal, 'null no activa esFinal (no revienta)');

// --- 9) quitarLineaTrigger (revisado 04-09-2026): le saca las PRIMERAS
// DOS líneas (disparador + fecha) al mensaje ANTES de mandárselo a
// procesarSabana() — sin esto, esas líneas quedan como un ticket
// fantasma "GENERAL" con estado "FALTA CERRAR EN SÁBANA" que nunca deja
// cerrar el día ---
check(quitarLineaTrigger('SABANA DE JUGADAS\n03-09-2026\nGIANCO\nhouston -120\n100//90') === 'GIANCO\nhouston -120\n100//90', 'le saca las primeras dos líneas (disparador + fecha), deja el resto tal cual');
check(quitarLineaTrigger('SABANA DE JUGADAS FINAL\n03-09-2026\nGIANCO\n100//90') === 'GIANCO\n100//90', 'funciona igual con el disparador de cierre');
check(quitarLineaTrigger('SABANA DE JUGADAS FINAL\n03-09-2026') === '', 'un mensaje que es SOLO el disparador + la fecha (nada de jugadas abajo) da string vacío');
check(quitarLineaTrigger('SABANA DE JUGADAS FINAL') === '', '"SABANA DE JUGADAS FINAL" sola (sin fecha ni nada más) también da vacío');
check(quitarLineaTrigger('') === '', 'mensaje vacío no revienta, da vacío');
check(quitarLineaTrigger(null) === '', 'null no revienta, da vacío');
check(quitarLineaTrigger('  SABANA DE JUGADAS  \n  03-09-2026  \n  GIANCO\n100//90  ') === 'GIANCO\n100//90', 'recorta espacios de más alrededor del resultado final');

// --- 10) (04-09-2026, a pedido del usuario: "que no importa si hay un
// espacio entre SABANA DE JUGADAS [y] FECHA... actualmente solo lees si
// escribo pegado") la fecha se sigue encontrando aunque haya 1 o más
// líneas EN BLANCO entre el disparador y la fecha — se toma la primera
// línea con contenido después del disparador, sea la línea 2, la 3, o la
// que sea ---
check(detectarTriggerSabana('SABANA DE JUGADAS\n\n03-09-2026').fecha === '2026-09-03', 'con UNA línea en blanco entre el disparador y la fecha, la fecha se sigue encontrando (antes se rechazaba: la línea 2 quedaba vacía)');
check(detectarTriggerSabana('SABANA DE JUGADAS\n\n03-09-2026').fechaEncontrada === true, 'y fechaEncontrada da true en ese mismo caso');
check(detectarTriggerSabana('SABANA DE JUGADAS\n\n\n03-09-2026').fecha === '2026-09-03', 'con VARIAS líneas en blanco de por medio también se encuentra');
check(detectarTriggerSabana('SABANA DE JUGADAS\n   \n03-09-2026').fecha === '2026-09-03', 'una línea con solo espacios (no vacía del todo, pero sin contenido real) también cuenta como "en blanco" y se salta');
check(detectarTriggerSabana('SABANA DE JUGADAS FINAL\n\n03-09-2026').fecha === '2026-09-03', 'funciona igual con "SABANA DE JUGADAS FINAL"');
check(detectarTriggerSabana('SABANA DE JUGADAS\n03-09-2026').fecha === '2026-09-03', 'y el caso de SIEMPRE (fecha pegada, sin ninguna línea en blanco) sigue funcionando exactamente igual');
check(detectarTriggerSabana('SABANA DE JUGADAS\n\n\nDE HOY').fechaEncontrada === false, 'si después de saltar las líneas en blanco la primera línea con contenido NO es una fecha válida, se sigue rechazando igual que siempre — el cordón de seguridad no se debilitó, solo se volvió tolerante a espacios');

check(quitarLineaTrigger('SABANA DE JUGADAS\n\n03-09-2026\nGIANCO\nhouston -120\n100//90') === 'GIANCO\nhouston -120\n100//90', 'quitarLineaTrigger() también saca la línea en blanco de más, junto con el disparador y la fecha — el cuerpo de la sábana queda limpio, sin una línea vacía fantasma adelante');
check(quitarLineaTrigger('SABANA DE JUGADAS\n\n\n03-09-2026') === '', 'un mensaje que es SOLO el disparador + líneas en blanco + la fecha (nada de jugadas abajo) sigue dando string vacío');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
