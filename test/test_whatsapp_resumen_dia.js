// =================================================================
// PRUEBA: whatsappResumenDia.js — la decisión pura de qué hacer con un
// día abierto del bot de WhatsApp (03-09-2026, más tarde todavía).
//
// Sin base de datos ni WhatsApp — solo valores de entrada y el string
// que devuelve decidirAccion(), más los 2 helpers (hash + "todos
// resueltos").
//
// (07-09-2026, más tarde todavía) El parámetro de tiempo de
// decidirAccion() se renombró de `ultimaVerificacionEn` a
// `ultimoEnvioEn` — ver el comentario grande en whatsappResumenDia.js:
// el bug real era que whatsappBot.js medía la espera de 1 hora contra
// "cuándo se revisó por última vez" (que el reloj de fondo pisa cada 5
// minutos, pase lo que pase) en vez de "cuándo se mandó el último
// mensaje de verdad" — con eso la hora nunca se llegaba a cumplir sola.
// Estas pruebas ya usan el nombre y el significado nuevos: HACE_30_MIN/
// HACE_90_MIN de acá en más representan "el último ENVÍO real fue hace
// tanto", no "la última revisión".
// =================================================================
const { todosLosTicketsResueltos, calcularHashTickets, decidirAccion, ESTADOS_ABIERTOS } = require('../src/services/whatsappResumenDia');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const AHORA = new Date('2026-09-03T18:00:00Z').getTime();
const HACE_30_MIN = new Date('2026-09-03T17:30:00Z').toISOString();
const HACE_90_MIN = new Date('2026-09-03T16:30:00Z').toISOString();

// --- 1) todosLosTicketsResueltos ---
check(todosLosTicketsResueltos([{ estado: 'GANADA' }, { estado: 'PERDIDA' }, { estado: 'ANULADA' }]) === true, 'GANADA/PERDIDA/ANULADA cuentan como resueltas (terminales)');
check(todosLosTicketsResueltos([{ estado: 'GANADA' }, { estado: 'PENDIENTE' }]) === false, 'un solo ticket PENDIENTE alcanza para que el día NO esté resuelto');
ESTADOS_ABIERTOS.forEach(estado => {
  check(todosLosTicketsResueltos([{ estado }]) === false, 'el estado "' + estado + '" cuenta como abierto (no resuelto todavía)');
});
check(todosLosTicketsResueltos([]) === false, 'una lista vacía de tickets NUNCA cuenta como "resuelta" (nada que cerrar)');
check(todosLosTicketsResueltos(null) === false, 'null no revienta, da false');

// --- 2) calcularHashTickets: determinístico y sensible a cambios reales ---
const ticketsA = [{ cliente: 'GIANCO', ticket: 'T1', estado: 'PENDIENTE', paga: 0 }, { cliente: 'MANOLO', ticket: 'T2', estado: 'GANADA', paga: 180 }];
const ticketsAOrdenDistinto = [{ cliente: 'MANOLO', ticket: 'T2', estado: 'GANADA', paga: 180 }, { cliente: 'GIANCO', ticket: 'T1', estado: 'PENDIENTE', paga: 0 }];
check(calcularHashTickets(ticketsA) === calcularHashTickets(ticketsAOrdenDistinto), 'el hash es el MISMO sin importar el orden en que vienen los tickets (mismo conjunto)');

const ticketsB = [{ cliente: 'GIANCO', ticket: 'T1', estado: 'GANADA', paga: 130 }, { cliente: 'MANOLO', ticket: 'T2', estado: 'GANADA', paga: 180 }];
check(calcularHashTickets(ticketsA) !== calcularHashTickets(ticketsB), 'el hash CAMBIA si un ticket pasó de PENDIENTE a GANADA (justo lo que hace falta detectar)');

const ticketsMismoEstadoOtroPago = [{ cliente: 'GIANCO', ticket: 'T1', estado: 'PENDIENTE', paga: 0 }, { cliente: 'MANOLO', ticket: 'T2', estado: 'GANADA', paga: 200 }];
check(calcularHashTickets(ticketsA) !== calcularHashTickets(ticketsMismoEstadoOtroPago), 'el hash también cambia si el PAGO de un ticket cambió, aunque el estado siga igual');
check(calcularHashTickets([]) === calcularHashTickets([]), 'una lista vacía da un hash estable (no revienta)');

// --- 3) decidirAccion: ESPERAR si no pasó 1 hora desde el ÚLTIMO ENVÍO REAL, salvo que se fuerce ---
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_30_MIN, sabanaFinalEn: null, hashActual: 'x', ultimoHashResumen: 'y', todosResueltos: false, forzar: false }) === 'ESPERAR', 'con el último envío real de hace solo 30 minutos, hay que ESPERAR');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_30_MIN, sabanaFinalEn: null, hashActual: 'x', ultimoHashResumen: 'y', todosResueltos: false, forzar: true }) !== 'ESPERAR', 'forzar:true (botón "Enviar ahora") salta la espera de la hora, aunque el último envío haya sido hace solo 30 minutos');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: null, sabanaFinalEn: null, hashActual: 'x', ultimoHashResumen: null, todosResueltos: false, forzar: false }) !== 'ESPERAR', 'un día que NUNCA mandó nada (ultimoEnvioEn null) no espera — se manda el primero de una');

// --- 4) ya pasó la hora desde el último envío real: ENVIAR_ACTUALIZACION si cambió algo, NADA_QUE_ENVIAR si no ---
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_90_MIN, sabanaFinalEn: null, hashActual: 'nuevo', ultimoHashResumen: 'viejo', todosResueltos: false, forzar: false }) === 'ENVIAR_ACTUALIZACION', 'pasó la hora desde el último envío real y el hash cambió -> ENVIAR_ACTUALIZACION');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_90_MIN, sabanaFinalEn: null, hashActual: 'igual', ultimoHashResumen: 'igual', todosResueltos: false, forzar: false }) === 'NADA_QUE_ENVIAR', 'pasó la hora pero nada cambió (mismo hash) -> NADA_QUE_ENVIAR, no hay que mandar spam');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_90_MIN, sabanaFinalEn: null, hashActual: 'x', ultimoHashResumen: null, todosResueltos: false, forzar: false }) === 'ENVIAR_ACTUALIZACION', 'si nunca se mandó nada antes (ultimoHashResumen null), pasada la hora se manda la primera actualización');

// =================================================================
// --- 4.b) (07-09-2026, más tarde todavía, a pedido del usuario: "antes
// tenia el error de aunque haya pasado una hora despues del juego no lo
// actualizaba solo igual") — EL BUG REAL que esto reemplaza: antes este
// parámetro venía de "cuándo se revisó por última vez", un valor que el
// reloj de fondo (cada 5 minutos) pisaba SIEMPRE, incluso cuando la
// decisión era "ESPERAR" — así que, para el reloj de fondo, "cuánto pasó
// desde la última verificación" nunca superaba esos ~5 minutos, y la
// cuenta de 1 hora JAMÁS se cumplía sola. Ahora decidirAccion() ya ni
// siquiera recibe ese dato — solo le importa `ultimoEnvioEn` (cuándo se
// mandó el ÚLTIMO MENSAJE DE VERDAD), que no tiene ese problema porque
// solo se actualiza cuando de verdad se manda algo. Esta prueba confirma
// el caso concreto: 1 hora y media desde el último ENVÍO real sí manda,
// sin importar qué tan seguido se haya "revisado" mientras tanto (ya ni
// se le pasa ese dato a esta función).
// =================================================================
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_90_MIN, sabanaFinalEn: null, hashActual: 'nuevo', ultimoHashResumen: 'viejo', todosResueltos: false, forzar: false }) === 'ENVIAR_ACTUALIZACION', 'con el último envío real de hace 90 minutos (ya pasó la hora) y el hash cambiado, manda la actualización — este es justo el caso que antes se rompía cuando se medía contra la última verificación en vez del último envío');

// --- 5) ENVIAR_CIERRE: solo si SABANA FINAL ya llegó Y todos los tickets están resueltos ---
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_90_MIN, sabanaFinalEn: HACE_90_MIN, hashActual: 'x', ultimoHashResumen: 'x', todosResueltos: true, forzar: false }) === 'ENVIAR_CIERRE', 'con SABANA FINAL recibido y todos los tickets resueltos -> ENVIAR_CIERRE (aunque el hash no haya cambiado)');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_90_MIN, sabanaFinalEn: null, hashActual: 'nuevo', ultimoHashResumen: 'viejo', todosResueltos: true, forzar: false }) === 'ENVIAR_ACTUALIZACION', 'todos los tickets resueltos pero SIN que haya llegado "SABANA FINAL" todavía -> sigue siendo una actualización normal, NO se cierra solo');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_90_MIN, sabanaFinalEn: HACE_90_MIN, hashActual: 'x', ultimoHashResumen: 'x', todosResueltos: false, forzar: false }) === 'NADA_QUE_ENVIAR', 'SABANA FINAL ya llegó pero TODAVÍA hay tickets pendientes (partido sin terminar) -> no se cierra ni se manda nada de más si nada cambió');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_90_MIN, sabanaFinalEn: HACE_90_MIN, hashActual: 'nuevo', ultimoHashResumen: 'viejo', todosResueltos: false, forzar: false }) === 'ENVIAR_ACTUALIZACION', 'SABANA FINAL ya llegó, siguen pendientes, pero cambió algo -> se manda la actualización igual (el cierre llega después, cuando termine todo)');

// --- 6) ENVIAR_CIERRE NUNCA espera el reloj de la hora (es un evento único, no un aviso periódico) ---
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_30_MIN, sabanaFinalEn: HACE_30_MIN, hashActual: 'x', ultimoHashResumen: 'x', todosResueltos: true, forzar: false }) === 'ENVIAR_CIERRE', 'con SABANA FINAL y todos resueltos, se cierra YA aunque el último envío haya sido hace apenas 30 minutos (no espera a que se cumpla la hora)');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: new Date(AHORA).toISOString(), sabanaFinalEn: new Date(AHORA).toISOString(), hashActual: 'x', ultimoHashResumen: 'x', todosResueltos: true, forzar: false }) === 'ENVIAR_CIERRE', 'incluso con "ultimoEnvioEn" en el mismo instante de ahora (0 minutos pasados), el cierre se manda de una si ya están todos resueltos');

// =================================================================
// --- 7) (07-09-2026, a pedido del usuario: "al momento de que se
// termino un juego no mando automaticamente si se dio o no el juego lo
// tuve que hacer manualmente por el botón") — DESDE que llega "SABANA
// FINAL", cada cambio se avisa AL INSTANTE, sin esperar la hora, aunque
// todavía falten tickets por resolver (si ya estuvieran todos resueltos
// sería ENVIAR_CIERRE, caso ya cubierto arriba). ANTES de "SABANA FINAL"
// el límite de 1 hora se mantiene exactamente igual que siempre (ver
// los bloques 3/4 más arriba, que siguen sin tocarse).
// =================================================================
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_30_MIN, sabanaFinalEn: HACE_30_MIN, hashActual: 'nuevo', ultimoHashResumen: 'viejo', todosResueltos: false, forzar: false }) === 'ENVIAR_ACTUALIZACION', 'con SABANA FINAL ya recibido, un juego que termina y cambia el hash avisa DE UNA aunque el último envío haya sido hace solo 30 minutos (antes esto daba ESPERAR)');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: new Date(AHORA - 60 * 1000).toISOString(), sabanaFinalEn: new Date(AHORA - 60 * 1000).toISOString(), hashActual: 'nuevo', ultimoHashResumen: 'viejo', todosResueltos: false, forzar: false }) === 'ENVIAR_ACTUALIZACION', 'lo mismo con el último envío de hace apenas 1 minuto: con SABANA FINAL ya no importa cuánto pasó, si cambió algo se avisa ya');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_30_MIN, sabanaFinalEn: HACE_30_MIN, hashActual: 'igual', ultimoHashResumen: 'igual', todosResueltos: false, forzar: false }) === 'NADA_QUE_ENVIAR', 'con SABANA FINAL ya recibido pero SIN ningún cambio real, no se manda nada de más (no hay que confundir "ya no espera la hora" con "avisa aunque no haya novedad")');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_90_MIN, sabanaFinalEn: null, hashActual: 'nuevo', ultimoHashResumen: 'viejo', todosResueltos: false, forzar: false }) === 'ENVIAR_ACTUALIZACION', 'regresión: SIN SABANA FINAL, pasada la hora, sigue funcionando exactamente igual que siempre');
check(decidirAccion({ ahora: AHORA, ultimoEnvioEn: HACE_30_MIN, sabanaFinalEn: null, hashActual: 'nuevo', ultimoHashResumen: 'viejo', todosResueltos: false, forzar: false }) === 'ESPERAR', 'regresión: SIN SABANA FINAL, a los 30 minutos TODAVÍA hay que ESPERAR — el límite de 1 hora sigue intacto antes de que llegue la sábana final');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
