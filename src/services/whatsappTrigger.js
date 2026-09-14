// =================================================================
// WHATSAPP TRIGGER — detección pura de "esto es una sábana" dentro de un
// mensaje de WhatsApp (03-09-2026, a pedido del usuario: "existe alguna
// manera de que en mi chat de whatssap yo actualice la sabana y se
// cargue automatico en el sistema?").
//
// A propósito, este archivo NO toca la base de datos ni la red — solo
// texto adentro, texto/objeto afuera. Así se puede probar 100% con
// pruebas normales de Node, sin necesitar Postgres ni la librería de
// WhatsApp (que en este entorno de trabajo no se puede instalar/
// verificar — ver README.md, sección de la función de WhatsApp).
//
// Formato del mensaje (revisado 04-09-2026, a pedido del usuario: "LA
// PLABRA QUE DISPARE SERA 'SABANA DE JUGADAS' Y ABAJO LA FECHA DEL DIA,
// COMO CORDON DE SEGURIDAD PARA QUE SEPAS QUE DIA ESTAMOS TRABAJANDO"):
//
//   SABANA DE JUGADAS
//   03-09-2026
//   (las jugadas...)
//
// Regla: un mensaje "activa" la sábana si su PRIMERA línea arranca
// (ignorando espacios en blanco, mayúsculas/minúsculas y tildes) con
// "SABANA DE JUGADAS". La fecha ya NO se busca en esa misma línea —
// tiene que venir SOLA en la SEGUNDA línea (el "cordón de seguridad" que
// pidió el usuario: así el bot nunca asume ni adivina "hoy" por su
// cuenta, siempre confirma con una fecha explícita a qué día corresponde
// el mensaje). Si esa segunda línea no trae una fecha válida, `fecha`
// queda en null y `fechaEncontrada` en false — es responsabilidad de
// quien llama (whatsappBot.js) rechazar el mensaje en ese caso, nunca
// asumir el día de hoy.
//
// Formatos de fecha reconocidos en esa segunda línea: "DD-MM-YYYY",
// "DD/MM/YYYY" y "YYYY-MM-DD" (con el mes y el año escritos completos).
//
// "SABANA DE JUGADAS FINAL" (03-09-2026, a pedido del usuario: "al
// enviar la palabra sabana final, ya alli no deberia de enviarse mas
// ninguna sabana... al todos los tickets tener resultado, enviar la
// sabana y despues otro mensaje con todos los totales del dia"): un
// mensaje que arranca con "SABANA DE JUGADAS FINAL" (misma primera
// línea, con "FINAL" al final) es un tipo de trigger DISTINTO —
// `esFinal: true` — que le avisa al resto del sistema (ver
// whatsappResumenDia.js/whatsappBot.js) que ese día ya no debe aceptar
// más actualizaciones de sábana por WhatsApp, y que hay que mandar el
// cierre (listado final + totales) apenas todos los tickets tengan
// resultado. También lleva la fecha en la segunda línea, igual que
// "SABANA DE JUGADAS" a secas. Se revisa "FINAL" ANTES que la forma
// simple porque "SABANA DE JUGADAS FINAL" también hace match con el
// patrón de "SABANA DE JUGADAS" sola.
// =================================================================

function quitarTildes(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizarFecha(dia, mes, anio) {
  const d = String(dia).padStart(2, '0');
  const m = String(mes).padStart(2, '0');
  const a = String(anio);
  if (a.length !== 4) return null;
  const diaNum = Number(d), mesNum = Number(m);
  if (!(diaNum >= 1 && diaNum <= 31)) return null;
  if (!(mesNum >= 1 && mesNum <= 12)) return null;
  return `${a}-${m}-${d}`;
}

// OJO (04-09-2026, a pedido del usuario: "que no importa si hay un
// espacio entre SABANA DE JUGADAS [y] FECHA... actualmente solo lees si
// escribo pegado"): antes esto exigía que la fecha estuviera LITERALMENTE
// en la línea 2 (lineas[1]) — si el usuario dejaba una o más líneas en
// blanco entre el disparador y la fecha (fácil que pase escribiendo desde
// el celular), lineas[1] quedaba vacía, no se encontraba ninguna fecha, y
// el mensaje se rechazaba igual que si la fecha faltara de verdad. Ahora
// se saltan solas las líneas en blanco que haya después del disparador, y
// se toma como "la línea de la fecha" la PRIMERA línea con contenido que
// aparezca — sin importar si es la línea 2, la 3, o la que sea. Devuelve
// -1 si no hay ninguna línea con contenido después de la primera.
function indiceLineaFecha(lineas) {
  for (let i = 1; i < lineas.length; i++) {
    if (lineas[i].trim() !== '') return i;
  }
  return -1;
}

function detectarFechaEnLinea(linea) {
  // YYYY-MM-DD
  let m = linea.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return normalizarFecha(m[3], m[2], m[1]);

  // DD-MM-YYYY
  m = linea.match(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/);
  if (m) return normalizarFecha(m[1], m[2], m[3]);

  // DD/MM/YYYY
  m = linea.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return normalizarFecha(m[1], m[2], m[3]);

  return null;
}

// Devuelve { esSabana, esFinal, fecha, fechaEncontrada, textoLimpio }.
//   esSabana: true/false — si el mensaje arranca con "SABANA DE JUGADAS"
//     (esto incluye también "SABANA DE JUGADAS FINAL" — un cierre
//     siempre es, además, una sábana).
//   esFinal: true/false — si específicamente arrancó con "SABANA DE
//     JUGADAS FINAL".
//   fecha: 'YYYY-MM-DD' leída de la SEGUNDA línea del mensaje, o null si
//     esa línea no traía una fecha válida.
//   fechaEncontrada: true/false — el "cordón de seguridad": si viene en
//     false, quien llama NO debe asumir el día de hoy ni ningún otro,
//     tiene que rechazar el mensaje y pedir que lo reenvíen con la fecha
//     en la línea de abajo.
//   textoLimpio: el mensaje original, sin tocar (se guarda tal cual en
//     sabanas_pendientes_whatsapp.texto).
function detectarTriggerSabana(textoMensaje) {
  if (typeof textoMensaje !== 'string') return { esSabana: false, esFinal: false, fecha: null, fechaEncontrada: false, textoLimpio: '' };

  const textoLimpio = textoMensaje;
  const texto = textoMensaje.trim();
  if (!texto) return { esSabana: false, esFinal: false, fecha: null, fechaEncontrada: false, textoLimpio };

  const lineas = texto.split('\n');
  const primeraLinea = lineas[0];
  const primeraLineaSinTildes = quitarTildes(primeraLinea).toUpperCase();

  const esFinal = /^\s*SABANA\s+DE\s+JUGADAS\s+FINAL\b/.test(primeraLineaSinTildes);
  const esSabana = esFinal || /^\s*SABANA\s+DE\s+JUGADAS\b/.test(primeraLineaSinTildes);

  if (!esSabana) {
    return { esSabana: false, esFinal: false, fecha: null, fechaEncontrada: false, textoLimpio };
  }

  const idxFecha = indiceLineaFecha(lineas);
  const lineaFecha = idxFecha === -1 ? '' : lineas[idxFecha];
  const fecha = detectarFechaEnLinea(lineaFecha);
  return { esSabana: true, esFinal, fecha, fechaEncontrada: !!fecha, textoLimpio };
}

// Le quita las PRIMERAS DOS líneas (la del disparador, "SABANA DE
// JUGADAS"/"SABANA DE JUGADAS FINAL", y la de la fecha justo debajo) a
// un mensaje ya detectado como sábana, y devuelve SOLO lo que viene
// después — eso es lo que hay que mandarle a procesarSabana(), nunca el
// mensaje completo (03-09-2026, más tarde todavía; ajustado 04-09-2026
// al pasar la fecha a su propia línea).
//
// Por qué hace falta esto: a diferencia de pegar una sábana a mano (que
// nunca trae esas dos líneas adelante), acá SIEMPRE están — y
// procesarSabana()/el parser no las reconoce como nada (no son un
// cliente, no son una jugada), así que las deja como un ticket fantasma
// bajo "GENERAL" con estado "FALTA CERRAR EN SÁBANA". Ese estado cuenta
// como "abierto" para whatsappResumenDia.js — sin sacar estas líneas, un
// día con un ticket fantasma de esos jamás llegaría a
// "todosLosTicketsResueltos" y el cierre no se mandaría NUNCA. Si el
// mensaje es SOLO esas dos líneas (ej. "SABANA DE JUGADAS FINAL" +
// fecha, sin ninguna jugada abajo), esto devuelve '' — que es justamente
// lo que hace que procesarSabana() no encuentre ningún ticket, y
// whatsappBot.js lo trate como "cierre sin contenido nuevo".
function quitarLineaTrigger(textoMensaje) {
  if (typeof textoMensaje !== 'string') return '';
  const texto = textoMensaje.trim();
  const lineas = texto.split('\n');
  // Igual que detectarTriggerSabana(): la fecha puede no estar en la
  // línea 2 exacta si hay líneas en blanco de por medio — hay que sacar
  // el disparador Y todo hasta la línea de la fecha (inclusive), sea cual
  // sea su posición real. Si no se encontró ninguna línea con contenido
  // (mensaje de una sola línea, sin fecha), se usa 2 como respaldo — mismo
  // comportamiento de siempre para ese caso límite.
  const idxFecha = indiceLineaFecha(lineas);
  const desde = idxFecha === -1 ? 2 : idxFecha + 1;
  return lineas.slice(desde).join('\n').trim();
}

// =================================================================
// COMANDOS DE CHAT (09-09-2026, a pedido del usuario: "quiero que
// reconoscas estos patrones si te escribe el numero de telefono que
// tienes registrado para reconocer sabana"): a diferencia de "SABANA DE
// JUGADAS" (que trae un cuerpo de jugadas abajo), estos son mensajes
// CORTOS de una sola línea que piden una ACCIÓN puntual — no cargan
// nada nuevo, solo le piden al bot que actualice/mande algo que ya
// tiene guardado. Mismo criterio que el resto de este archivo: 100%
// texto adentro, objeto afuera, sin tildes/mayúsculas ni espacios de
// más, para que "Act", "ACT", "act " o "Actualizar Sábana" disparen
// igual.
//
//   'actualizar_sabana' — "actualizar sabana" / "actualizar juegos" /
//     "act": revisa de nuevo los resultados en vivo y reenvía el listado
//     de hoy con los íconos que ya correspondan (reusa
//     whatsappBot.procesarDiaAbierto con forzar:true — el mismo botón
//     "📤 Enviar resumen ahora" del panel, pero disparado por chat).
//   'saldo_dia' — "saldo final" / "saldo del dia": si TODOS los juegos
//     de hoy ya tienen resultado, manda el listado con íconos y después
//     los totales del día; si todavía falta alguno, manda el listado tal
//     cual está y un aviso aparte de que faltan juegos por decidirse.
//   'corte_semana' — "corte semana" / "saldo semana" / "saldo semanal":
//     el desglose día por día + total de la semana actual (lunes a
//     domingo) de CADA cliente registrado en el grupo, 2 mensajes por
//     cliente (el balance y, aparte, su %).
//   'saldo_cliente' — "saldo total semana <nombre>" / "total semana
//     <nombre>": lo mismo de arriba pero de un solo cliente puntual.
//
// Devuelve null si el texto no coincide con ninguno de estos patrones —
// es responsabilidad de quien llama (whatsappBot.js) probar esto DESPUÉS
// de detectarTriggerSabana() (un mensaje nunca es las dos cosas a la
// vez: "SABANA DE JUGADAS..." nunca calza acá, y estos comandos nunca
// traen jugadas abajo).
function detectarComando(textoMensaje) {
  if (typeof textoMensaje !== 'string') return null;
  // Mismo criterio de "primera línea" que detectarTriggerSabana() —
  // así un comando escrito como la primera línea de un mensaje más
  // largo (ej. pegado desde el celular con un salto de línea de más al
  // final) igual se reconoce, sin arrastrar basura de líneas de abajo.
  const primeraLinea = (textoMensaje.split('\n')[0] || '');
  const limpio = quitarTildes(primeraLinea.trim().toLowerCase()).replace(/\s+/g, ' ');
  if (!limpio) return null;

  if (limpio === 'actualizar sabana' || limpio === 'actualizar juegos' || limpio === 'act') {
    return { tipo: 'actualizar_sabana' };
  }

  if (limpio === 'saldo final' || limpio === 'saldo del dia') {
    return { tipo: 'saldo_dia' };
  }

  if (limpio === 'corte semana' || limpio === 'saldo semana' || limpio === 'saldo semanal') {
    return { tipo: 'corte_semana' };
  }

  let m = limpio.match(/^saldo total semana\s+(.+)$/) || limpio.match(/^total semana\s+(.+)$/);
  if (m && m[1].trim()) {
    return { tipo: 'saldo_cliente', nombre: m[1].trim() };
  }

  return null;
}

// =================================================================
// AUTORIZACIÓN de los comandos de chat (09-09-2026, a pedido del
// usuario: "los comandos lo puede mandar el mismo que manda el comando
// sabana jugada, pero aparte en super admin yo puedo agregar un numero y
// activarle o desactivarle, la funcion de enviar comandos" — ver la nota
// grande en sql/schema.sql, columnas grupos.comandos_whatsapp_habilitado/
// comandos_whatsapp_numero, y whatsappBot.estaAutorizadoParaComandos()).
//
// Ambas funciones son puras (sin DB) a propósito, para poder probar la
// normalización de números sin necesitar una base de datos falsa —
// quien SÍ toca la base de datos (leer el número configurado del grupo)
// es whatsappBot.js.
// =================================================================

// Deja SOLO los dígitos de un número de teléfono — así "+58 412-123.4567",
// "584121234567" y "412 123 4567" (si el Súper-admin lo escribe así)
// terminan siendo comparables entre sí.
function normalizarTelefono(numero) {
  if (numero === null || numero === undefined) return '';
  return String(numero).replace(/\D/g, '');
}

// El JID de un participante de un grupo de WhatsApp (Baileys) viene como
// "584121234567:12@s.whatsapp.net" (con ":12" del dispositivo) o, más
// simple, "584121234567@s.whatsapp.net" — esto se queda solo con el
// número, ya normalizado a puros dígitos.
function telefonoDeParticipante(participantJid) {
  if (typeof participantJid !== 'string') return '';
  const soloUsuario = participantJid.split('@')[0].split(':')[0];
  return normalizarTelefono(soloUsuario);
}

module.exports = {
  detectarTriggerSabana,
  quitarLineaTrigger,
  indiceLineaFecha,
  detectarComando,
  quitarTildes,
  normalizarTelefono,
  telefonoDeParticipante
};
