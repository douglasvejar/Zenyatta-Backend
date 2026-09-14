// =================================================================
// LA "DECISIÓN" DE QUÉ HACER CON UN DÍA ABIERTO DEL BOT DE WHATSAPP
// (03-09-2026, más tarde todavía, a pedido del usuario: "que la nueva
// sabana que se envie sustituya la vieja... el programa envie la sabana
// a medida de que se vaya teniendo resultados... que la lista se envie
// con resultados y cambios cada hora, si no hay resultados nuevos ni
// cambios en una hora, espere a la hora siguiente... al enviar sabana
// final... enviar la sabana y despues otro mensaje con todos los
// totales del dia").
//
// A PROPÓSITO, este archivo es lógica 100% pura — nada de base de datos
// (eso es whatsappDiaEstado.js) ni de WhatsApp/Baileys (eso es
// whatsappBot.js). Así la parte más importante — "¿le toca revisar este
// día ahora? ¿hay que avisar en el grupo? ¿ya se puede cerrar el día?" —
// se puede probar con total confianza en este sandbox, sin necesitar
// nada que no se pueda instalar/ejecutar acá (ver README.md).
const UNA_HORA_MS = 60 * 60 * 1000;

// Estados de ticket que NO son definitivos todavía — mismo criterio
// exacto que ya usa procesarSabana.js para "pendientes" por cliente (así
// "todosResueltos" de este archivo coincide 1 a 1 con lo que el propio
// Grupo ya ve como "pendiente" en el Resumen por Cliente).
const ESTADOS_ABIERTOS = ['PENDIENTE', 'FALTA CERRAR EN SÁBANA', 'NULA (FALTA LOGRO)', 'NULA (SIN JUGADA)', 'SUSPENDIDA', 'AMBIGUA (VARIOS DEPORTES)'];

function todosLosTicketsResueltos(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) return false; // sin tickets no hay nada que "cerrar" todavía
  return tickets.every(t => !ESTADOS_ABIERTOS.includes(t.estado));
}

// Huella determinística del estado actual de los tickets — para saber si
// "cambió algo" desde el último envío sin tener que guardar el listado
// completo. Ordenado por cliente+ticket para que el MISMO conjunto de
// tickets siempre dé el MISMO hash, sin importar en qué orden vinieron
// esta vez (evaluarJugada()/procesarSabana() no garantiza un orden
// estable entre corridas).
function calcularHashTickets(tickets) {
  const lista = (tickets || [])
    .map(t => (t.cliente || '') + '|' + (t.ticket || '') + '|' + t.estado + '|' + Number(t.paga || 0).toFixed(2))
    .sort();
  return lista.join('~~');
}

// La decisión en sí — pura: recibe valores simples, devuelve un string.
//   'ESPERAR'              — todavía no pasó 1 hora desde el último ENVÍO real al grupo (y nadie forzó un envío a mano).
//   'ENVIAR_CIERRE'        — el día ya recibió "SABANA FINAL" y todos los tickets tienen resultado: mandar listado final + totales, y cerrar.
//   'ENVIAR_ACTUALIZACION' — cambió algo desde el último envío (o nunca se mandó nada, o alguien apretó "Enviar ahora"): mandar el listado.
//   'NADA_QUE_ENVIAR'      — se revisó, pero no cambió nada desde el último envío — no hace falta mandar otro mensaje.
//
// =================================================================
// (07-09-2026, más tarde todavía, a pedido del usuario: "antes tenia el
// error de aunque haya pasado una hora despues del juego no lo
// actualizaba solo igual") — ESTE PARÁMETRO se llamaba antes
// `ultimaVerificacionEn` y venía de whatsapp_dia_estado.ultima_verificacion_en,
// que whatsappBot.js pisa con la hora actual en CADA vuelta del reloj de
// fondo (cada 5 minutos), pase lo que pase — se actualiza incluso cuando
// la decisión fue "ESPERAR" (ver el comentario grande en
// whatsappDiaEstado.registrarVerificacion/whatsappBot.procesarDiaAbierto).
// Eso significa que, para el reloj de fondo, "cuánto pasó desde la
// última verificación" daba SIEMPRE ~5 minutos (el intervalo del propio
// reloj), nunca más — así que la cuenta de 1 hora NUNCA se llegaba a
// cumplir sola: cada aviso automático de "cambió algo" dependía en la
// práctica de apretar el botón manual "Enviar resumen ahora" (que fuerza
// con forzar:true) o de que nunca se hubiera verificado antes (primera
// vez). El arreglo real: acá adentro ya NO se usa "cuándo se revisó por
// última vez" (eso sigue existiendo aparte, solo para mostrar en el
// panel que el sistema sigue vivo) sino `ultimoEnvioEn` — cuándo se
// mandó el ÚLTIMO MENSAJE DE VERDAD al grupo (whatsapp_dia_estado.
// ultimo_envio_resumen_en), que SOLO se actualiza cuando de verdad se
// manda algo (ver registrarEnvioResumen, llamado únicamente en las ramas
// ENVIAR_ACTUALIZACION/ENVIAR_CIERRE) — así la cuenta de 1 hora avanza de
// verdad entre un envío real y el siguiente, sin que el reloj de fondo
// la reinicie solo cada 5 minutos.
// =================================================================
function decidirAccion({ ahora, ultimoEnvioEn, sabanaFinalEn, hashActual, ultimoHashResumen, todosResueltos, forzar }) {
  // El cierre (ya llegó "SABANA FINAL" Y todos los tickets tienen
  // resultado) NUNCA espera el reloj de la hora — es un evento único de
  // una sola vez ("al todos los tickets tener resultado, enviar la
  // sabana y despues otro mensaje con todos los totales del dia"), no un
  // aviso periódico. Si esto se dejara atrás del chequeo de la hora, el
  // cierre podría demorarse hasta 60 minutos después de terminado el
  // último partido, que es justo lo que el usuario no quiere.
  if (sabanaFinalEn && todosResueltos) return 'ENVIAR_CIERRE';

  const cambioAlgo = !!forzar || hashActual !== ultimoHashResumen;

  // =================================================================
  // (07-09-2026, a pedido del usuario: "al momento de que se termino un
  // juego no mando automaticamente si se dio o no el juego lo tuve que
  // hacer manualmente por el botón") — una vez que YA llegó "SABANA DE
  // JUGADAS FINAL" para este día, la lista de tickets no puede crecer más
  // (whatsappBot.js rechaza cualquier sábana no-FINAL después de esto),
  // así que cada juego que va terminando de acá en más es un evento
  // acotado y finito camino al cierre — como mucho, tantos avisos como
  // partidos falten por resolver. Por eso, DESDE que llega "SABANA FINAL"
  // se avisa al instante cada vez que algo cambió, sin esperar la hora.
  // ANTES de "SABANA FINAL" (el día todavía puede seguir recibiendo
  // sábanas nuevas durante el día, con más tickets todavía por agregarse)
  // se mantiene el límite de 1 mensaje por hora tal como el propio
  // usuario lo pidió el 03-09-2026 — ahí sí existe el riesgo real de
  // mandar un mensaje nuevo por cada jugada suelta que se va resolviendo.
  if (sabanaFinalEn) {
    return cambioAlgo ? 'ENVIAR_ACTUALIZACION' : 'NADA_QUE_ENVIAR';
  }

  const yaPasoLaHora = !!forzar || !ultimoEnvioEn || (ahora - new Date(ultimoEnvioEn).getTime()) >= UNA_HORA_MS;
  if (!yaPasoLaHora) return 'ESPERAR';

  return cambioAlgo ? 'ENVIAR_ACTUALIZACION' : 'NADA_QUE_ENVIAR';
}

module.exports = { ESTADOS_ABIERTOS, todosLosTicketsResueltos, calcularHashTickets, decidirAccion, UNA_HORA_MS };
