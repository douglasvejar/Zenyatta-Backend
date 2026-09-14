// =================================================================
// BOT DE WHATSAPP — conector en vivo (03-09-2026, a pedido del usuario:
// "existe alguna manera de que en mi chat de whatssap yo actualice la
// sabana y se cargue automatico en el sistema?" y, más tarde ese mismo
// día, la ampliación grande: auto-importar 100%, "SABANA FINAL" para
// cerrar el día, y que el propio bot MANDE mensajes al grupo a medida
// que los juegos van teniendo resultado).
//
// *** ADVERTENCIA IMPORTANTE, LEER ANTES DE ACTIVAR ***
// Este archivo usa @whiskeysockets/baileys, una librería NO OFICIAL que
// se conecta a WhatsApp imitando a WhatsApp Web (no es la API oficial de
// Meta). En el entorno donde se armó este backend NO hubo forma de
// instalar ni verificar esta librería (sin acceso al registro de npm ni
// a los servidores de WhatsApp) — a diferencia de TODO el resto de este
// proyecto, este archivo específico NO se pudo probar/ejecutar ni una
// sola vez. Puede que necesite ajustes al usarlo por primera vez en tu
// propia máquina (ver README.md para el detalle completo). Por eso:
//   - Es 100% opcional: solo se activa (ver server.js) si
//     WHATSAPP_BOT_ACTIVADO=true en tu .env — apagado, este archivo ni
//     siquiera se carga. Y AUNQUE esté activado a nivel servidor, cada
//     Grupo necesita además tener el servicio contratado (04-09-2026, a
//     pedido del usuario: "este servicio sera un plus para los grupos
//     que compren el servicio") — grupoIdPorJid() (ver
//     sabanasPendientesWhatsapp.js) exige un JID vinculado Y
//     whatsapp_habilitado=true, los dos EXCLUSIVOS del Súper-admin.
//   - Usar una librería no oficial conlleva un riesgo real (aunque en
//     general bajo con uso moderado) de que WhatsApp bloquee el número
//     usado para conectarse. Usá de preferencia un número que no sea tu
//     línea principal.
//   - AHORA el bot también MANDA mensajes al grupo (antes solo leía) —
//     un error de este archivo ya no solo se pierde un mensaje entrante,
//     puede mandar algo al grupo real. Por eso TODO lo que decide "hay
//     que mandar algo/cerrar el día" vive en un módulo puro y probado
//     aparte (whatsappResumenDia.js) — este archivo solo obedece esa
//     decisión y llama sock.sendMessage(), que es la única parte que de
//     verdad no se pudo ejecutar ni una vez en este entorno.
//
// CÓMO FUNCIONA (resumen del flujo completo):
//   1. Un mensaje que arranca con "SABANA DE JUGADAS" y trae la fecha en
//      la línea de abajo, como "cordón de seguridad" (ver
//      whatsappTrigger.js) se auto-importa al instante — se procesa con
//      procesarSabana(), IGUAL que si se pegara a mano en la pestaña
//      Sábana. Cada nueva "SABANA DE JUGADAS" de un mismo día SUSTITUYE
//      a la anterior (nunca se acumulan 2 sábanas del mismo día — ver
//      whatsappDiaEstado.registrarTextoRecibido). Si la línea de la
//      fecha falta o no se puede leer, el mensaje se rechaza — el bot
//      NUNCA asume "hoy" por su cuenta (04-09-2026, a pedido del
//      usuario: la fecha ahí abajo es justamente para confirmar con
//      certeza qué día se está cargando).
//   2. Un reloj de fondo (cada 5 minutos, ver iniciarRelojDeFondo) recorre
//      todos los días "abiertos" (whatsappDiaEstado.listarDiasAbiertos) y
//      les da la chance de verificar/avisar/cerrar. Como procesarSabana()
//      consulta los resultados de los partidos EN VIVO cada vez que se
//      llama, volver a correrlo con la MISMA sábana guardada es lo que
//      detecta que un partido terminó y actualiza el estado de los
//      tickets, sin que haga falta ningún mensaje nuevo por WhatsApp. Si
//      algo cambió Y ya pasó una hora desde el último aviso (o nunca se
//      avisó nada), manda el listado actualizado al grupo (ver
//      whatsappResumenDia.decidirAccion). ESTE límite de 1 mensaje por
//      hora SOLO aplica ANTES de que llegue "SABANA DE JUGADAS FINAL"
//      (mientras el día todavía puede seguir recibiendo sábanas nuevas
//      con más tickets) — ver el punto 3.
//   3. Un mensaje que arranca con "SABANA DE JUGADAS FINAL" cierra el
//      día para nuevas sábanas (whatsappDiaEstado.marcarSabanaFinalRecibida)
//      — de ahí en más, cualquier "SABANA DE JUGADAS" (no FINAL) para
//      esa fecha se ignora y se avisa en el grupo. DESDE ese momento (07-
//      09-2026, a pedido del usuario) cada juego que va terminando avisa
//      AL INSTANTE, sin esperar la hora — la lista de tickets ya no puede
//      crecer más, así que como mucho hay tantos avisos como partidos
//      falten. Apenas TODOS los tickets de ese día tengan resultado, se
//      manda el listado final + un segundo mensaje aparte con los
//      totales del día, el día se confirma solo en Balance General
//      (equivalente automático de apretar "💾 Guardar Día" — 07-09-2026,
//      ver confirmarDia() más abajo) y se cierra
//      (whatsappDiaEstado.marcarCierreEnviado) — esto NUNCA espera el
//      reloj de la hora (ver el comentario en whatsappResumenDia.js).
//   4. El botón "📤 Enviar resumen ahora" del panel (routes/whatsapp.js)
//      llama la misma función de acá (procesarDiaAbierto) con
//      forzar:true — salta la espera de la hora y reinicia el reloj de
//      1 hora para el próximo envío automático.
const path = require('path');
const db = require('../db');
const { detectarTriggerSabana, quitarLineaTrigger, detectarComando, quitarTildes, normalizarTelefono, telefonoDeParticipante } = require('./whatsappTrigger');
const { grupoIdPorJid, crearPendiente, marcarImportada, descartarPendiente, marcarError } = require('./sabanasPendientesWhatsapp');
const whatsappDiaEstado = require('./whatsappDiaEstado');
const whatsappResumenDia = require('./whatsappResumenDia');
const { procesarSabana } = require('./procesarSabana');
const { confirmarDia, formatearFechaISO, calcularRangoRapido } = require('./historial');
const { cargarConfigGrupo } = require('./grupoConfig');
const { calcularBalanceSemanalPorCliente } = require('./balanceGeneral');
const {
  generarTextoListadoSabana,
  generarTextoTotalesDia,
  generarTextoBalanceSemanalCliente,
  generarTextoPorcentajeSemanalCliente
} = require('./planoWhatsAppTexto');

// OJO (04-09-2026, a pedido del usuario: "dice arriba deportes zenyatta y
// debe decir es como se llama el grupo"): los mensajes que el bot manda
// (avisos/listados/totales) tienen que arrancar con el nombre REAL del
// Grupo dueño de esa sábana, no un texto fijo — se busca acá, una sola
// consulta chica, antes de armar cualquiera de esos 2 mensajes.
async function obtenerNombreGrupo(grupoId) {
  try {
    const r = await db.query('SELECT nombre FROM grupos WHERE id = $1', [grupoId]);
    return (r.rows[0] && r.rows[0].nombre) || 'Deportes Zenyatta';
  } catch (e) {
    console.error('[whatsappBot] No se pudo leer el nombre del grupo ' + grupoId + ' (se usa un nombre genérico):', e.message);
    return 'Deportes Zenyatta';
  }
}

// Segunda capa de autorización, EXCLUSIVA de los 4 comandos de chat
// (09-09-2026, a pedido del usuario: "los comandos lo puede mandar el
// mismo que manda el comando sabana jugada, pero aparte en super admin
// yo puedo agregar un numero y activarle o desactivarle, la funcion de
// enviar comandos" — ver la nota grande en sql/schema.sql). "SABANA DE
// JUGADAS" en sí NUNCA pasa por acá — sigue aceptando a cualquiera en el
// grupo vinculado, sin cambios.
//
// Sin comandos_whatsapp_habilitado=true Y un comandos_whatsapp_numero
// cargado (ambos exclusivos de Súper-admin), NINGÚN comando se acepta de
// nadie — no hay un "modo abierto" implícito por default.
async function estaAutorizadoParaComandos(grupoId, participantJid) {
  try {
    const r = await db.query('SELECT comandos_whatsapp_habilitado, comandos_whatsapp_numero FROM grupos WHERE id = $1', [grupoId]);
    const fila = r.rows[0];
    if (!fila || !fila.comandos_whatsapp_habilitado) {
      // (09-09-2026, diagnóstico agregado tras un reporte de "no me
      // responde nada" probando "corte semana") — log AL NIVEL de "por
      // qué se ignoró" para poder diferenciar en la consola del servidor,
      // sin exponer nada por el propio WhatsApp: acá, ni siquiera está
      // prendido el interruptor en Súper-admin todavía (o el grupo no
      // existe), así que ni hace falta mirar el número del remitente.
      console.log('[whatsappBot] Comando ignorado (grupo ' + grupoId + '): "Comandos por WhatsApp" está APAGADO (o sin cargar) en Súper-admin — prendelo y cargá el número autorizado en el detalle del grupo, sección "📟 Comandos por WhatsApp".');
      return false;
    }
    const numeroConfigurado = normalizarTelefono(fila.comandos_whatsapp_numero);
    if (!numeroConfigurado) {
      console.log('[whatsappBot] Comando ignorado (grupo ' + grupoId + '): el interruptor de comandos está prendido pero todavía no hay ningún número cargado — cargalo en Súper-admin, sección "📟 Comandos por WhatsApp".');
      return false;
    }
    const digitosRemitente = telefonoDeParticipante(participantJid);
    const autorizado = digitosRemitente === numeroConfigurado;
    if (!autorizado) {
      const esLid = typeof participantJid === 'string' && participantJid.endsWith('@lid');
      let msg = '[whatsappBot] Comando ignorado (grupo ' + grupoId + '): el remitente no es el número autorizado — remitente JID: "' + participantJid + '" (dígitos extraídos: "' + digitosRemitente + '"), número autorizado configurado: "' + numeroConfigurado + '".';
      if (esLid) {
        // Ver el comentario grande de resolverNumeroRealDelRemitente() más
        // abajo — este remitente vino con un identificador @lid de
        // WhatsApp (no un número de teléfono real) y no se pudo resolver
        // al número de verdad. Solución inmediata sin esperar código
        // nuevo: cargar en Súper-admin, como "número autorizado", estos
        // mismos dígitos ("' + digitosRemitente + '") en vez de un
        // teléfono — se compara igual, dígito por dígito.
        msg += ' ⚠️ Este remitente usa un identificador @lid de WhatsApp (no pudo resolverse a un número de teléfono real) — como solución inmediata, podés cargar en Súper-admin, como "número autorizado", estos mismos dígitos ("' + digitosRemitente + '") en vez de un número de teléfono.';
      }
      console.log(msg);
    }
    return autorizado;
  } catch (e) {
    console.error('[whatsappBot] No se pudo verificar la autorización de comandos (grupo ' + grupoId + '):', e.message);
    return false;
  }
}

// (09-09-2026, agregado tras un reporte real probando "corte semana":
// "remitente JID: 30971613171802@lid" en la consola de diagnóstico de
// arriba) — WhatsApp viene migrando participantes de grupo a "LID"
// (Linked ID), un identificador de privacidad interno de Meta que
// reemplaza al número de teléfono real en el campo "participant" de
// algunos grupos/cuentas (nada tiene que ver con este código, es un
// cambio del lado de WhatsApp). Cuando eso pasa, telefonoDeParticipante()
// ya NO extrae el número real — extrae los dígitos de ese identificador
// interno, que nunca va a coincidir con el número de teléfono real que
// se carga en Súper-admin.
//
// *** SIN FORMA DE PROBAR ESTO CONTRA WHATSAPP REAL EN ESTE ENTORNO ***
// (igual que el resto de este archivo, ver la advertencia grande al
// principio) — se intentan, en orden, las 2 formas conocidas en que
// @whiskeysockets/baileys puede exponer el número real detrás de un
// @lid; si ninguna funciona (versión de la librería que no las trae
// todavía, u otra causa), se devuelve el @lid tal cual, y el log de
// diagnóstico de estaAutorizadoParaComandos() lo va a mostrar igual que
// ahora — en ese caso, como solución YA MISMO sin esperar código nuevo,
// alcanza con cargar en Súper-admin, en el campo "número autorizado", los
// DÍGITOS que ese mismo log muestra en "dígitos extraídos" (el propio
// @lid) en vez de un número de teléfono — se compara igual, dígito por
// dígito, así que funciona igual de bien, aunque no "parezca" un
// teléfono. Válido siempre que WhatsApp no cambie ese @lid con el tiempo
// para ese mismo participante — algo que, a la fecha de este comentario,
// no se pudo confirmar ni descartar en este entorno.
async function resolverNumeroRealDelRemitente(sock, msg, participantJid) {
  if (typeof participantJid !== 'string' || !participantJid.endsWith('@lid')) {
    return participantJid; // ya es un JID normal (@s.whatsapp.net) — sin cambios
  }
  try {
    // 1) Algunas versiones de Baileys ya mandan el JID "alterno" (el de
    //    verdad, con el número de teléfono) junto al de LID, en la propia
    //    clave del mensaje entrante.
    const alterno = msg.key && (msg.key.participantAlt || msg.key.participantPn);
    if (typeof alterno === 'string' && alterno.includes('@')) return alterno;

    // 2) El mapa LID <-> número real que Baileys arma solo, a medida que
    //    va viendo la actividad de ese grupo (signalRepository.lidMapping).
    const mapeo = sock && sock.signalRepository && sock.signalRepository.lidMapping;
    if (mapeo && typeof mapeo.getPNForLID === 'function') {
      const real = await mapeo.getPNForLID(participantJid);
      if (typeof real === 'string' && real.includes('@')) return real;
    }
  } catch (e) {
    console.error('[whatsappBot] No se pudo resolver el número real detrás de un @lid (' + participantJid + '):', e.message);
  }
  return participantJid; // ninguna forma conocida funcionó — se devuelve tal cual
}

let estadoConexion = { conectado: false, ultimoQr: null, ultimoError: null, gruposDisponibles: [] };
let sockActual = null; // el socket de Baileys ya conectado, o null si no hay conexión activa ahora mismo.
let relojDeFondoIniciado = false;

function obtenerEstadoConexion() {
  // Copia simple para que quien lo lea (routes/whatsapp.js) no pueda
  // mutar el estado interno por accidente.
  return { ...estadoConexion };
}

// Lo usa routes/whatsapp.js para el botón manual "Enviar resumen ahora" —
// null si el bot no está conectado en este momento.
function obtenerSockActivo() {
  return sockActual;
}

function formatFechaAviso(fechaISO) {
  const [anio, mes, dia] = (fechaISO || '').split('-');
  return (anio && mes && dia) ? (dia + '-' + mes + '-' + anio) : (fechaISO || '(sin fecha)');
}

// Manda un texto al grupo sin nunca tumbar el flujo que lo llama (si el
// envío falla — ej. se perdió la conexión justo en ese momento — se
// registra el error y se sigue).
async function avisar(sock, jid, texto) {
  try {
    if (!sock || !jid) return;
    await sock.sendMessage(jid, { text: texto });
  } catch (e) {
    console.error('[whatsappBot] No se pudo mandar un aviso al grupo de WhatsApp:', e.message);
  }
}

async function extraerTexto(msg) {
  if (!msg || !msg.message) return null;
  return (
    msg.message.conversation ||
    (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) ||
    null
  );
}

// El corazón del envío en vivo: re-procesa la sábana guardada de un día
// (que consulta los resultados de los partidos EN VIVO cada vez que se
// llama) y, según whatsappResumenDia.decidirAccion(), no hace nada / manda
// la actualización / cierra el día con listado + totales.
//
// `sock`/`jid` son quién manda el mensaje y a qué grupo — se pasan
// aparte (en vez de sacarlos de adentro de esta función) porque tanto
// el reloj de fondo (que ya trae el jid de listarDiasAbiertos) como el
// botón manual del panel (que lo saca de grupos.whatsapp_grupo_jid)
// necesitan llamar esta misma función.
async function procesarDiaAbierto(sock, grupoId, jid, fecha, { forzar = false } = {}) {
  const estadoDia = await whatsappDiaEstado.obtenerEstadoDia(grupoId, fecha);
  if (!estadoDia || !estadoDia.ultimoTexto) {
    return { accion: 'SIN_SABANA', motivo: 'Todavía no se cargó ninguna sábana para esta fecha.' };
  }

  let resp;
  try {
    resp = await procesarSabana(grupoId, estadoDia.ultimoTexto, fecha);
  } catch (e) {
    console.error('[whatsappBot] procesarDiaAbierto: no se pudo reprocesar la sábana guardada (grupo ' + grupoId + ', fecha ' + fecha + '):', e.message);
    return { accion: 'ERROR', error: e.message };
  }

  const hashActual = whatsappResumenDia.calcularHashTickets(resp.tickets);
  const todosResueltos = whatsappResumenDia.todosLosTicketsResueltos(resp.tickets);
  const accion = whatsappResumenDia.decidirAccion({
    ahora: Date.now(),
    // (07-09-2026, más tarde todavía, a pedido del usuario: "antes tenia
    // el error de aunque haya pasado una hora despues del juego no lo
    // actualizaba solo igual") — OJO, a propósito NO se manda
    // `estadoDia.ultimaVerificacionEn` acá: esa marca de tiempo se pisa
    // en CADA vuelta del reloj de fondo (5 minutos, ver más abajo), pase
    // lo que pase, así que usarla para la cuenta de "1 hora" hacía que
    // esa cuenta nunca pasara de ~5 minutos y el aviso automático nunca
    // se disparara solo. `ultimoEnvioResumenEn` en cambio SOLO se
    // actualiza cuando de verdad se manda un mensaje (registrarEnvioResumen,
    // más abajo) — ver el comentario grande en whatsappResumenDia.js.
    ultimoEnvioEn: estadoDia.ultimoEnvioResumenEn,
    sabanaFinalEn: estadoDia.sabanaFinalEn,
    hashActual,
    ultimoHashResumen: estadoDia.ultimoHashResumen,
    todosResueltos,
    forzar
  });

  // Esto SÍ se actualiza en cada vuelta, aunque la decisión haya sido
  // "ESPERAR" — es solo para que el panel pueda mostrar "Última
  // verificación: hace 3 minutos" y confirmar que el reloj de fondo
  // sigue vivo y mirando este día; el throttle de 1 hora de arriba ya NO
  // depende de este valor (ver el comentario de `ultimoEnvioEn`).
  await whatsappDiaEstado.registrarVerificacion(grupoId, fecha);

  if (accion === 'ESPERAR' || accion === 'NADA_QUE_ENVIAR') {
    return { accion };
  }

  if (accion === 'ENVIAR_ACTUALIZACION') {
    const nombreGrupo = await obtenerNombreGrupo(grupoId);
    const texto = generarTextoListadoSabana(resp, { esFinal: false, nombreGrupo });
    await avisar(sock, jid, texto);
    await whatsappDiaEstado.registrarEnvioResumen(grupoId, fecha, hashActual);
    return { accion, resp };
  }

  if (accion === 'ENVIAR_CIERRE') {
    const nombreGrupo = await obtenerNombreGrupo(grupoId);
    const textoListado = generarTextoListadoSabana(resp, { esFinal: true, nombreGrupo });
    await avisar(sock, jid, textoListado);
    const textoTotales = generarTextoTotalesDia(resp);
    await avisar(sock, jid, textoTotales);
    await whatsappDiaEstado.registrarEnvioResumen(grupoId, fecha, hashActual);
    await whatsappDiaEstado.marcarCierreEnviado(grupoId, fecha);
    // =================================================================
    // (07-09-2026, a pedido del usuario: "que la sabana automatica
    // funcione como la manual en todo sentido... el balance del dia de la
    // casa arreisgado todo porcentaje si lleva y todo eso") — con una
    // sábana manual, este es justo el momento en el que el Grupo aprieta
    // "💾 Guardar Día" a mano, ya con los saldos finales a la vista (ver
    // guardarDia() en app.js). Acá el equivalente es automático: en
    // cuanto el día está cerrado de verdad (SABANA FINAL + todos los
    // tickets con resultado, el listado final y los totales YA se
    // mandaron arriba), se confirma solo — así Balance General/%
    // Devueltos lo muestran como un día oficial sin que el Grupo tenga
    // que entrar al panel a apretar el botón. guardarEnHistorial() (ver
    // historial.js) ya guardó estos mismos registros un poco más arriba,
    // dentro de procesarSabana() — confirmarDia() solo le pone el sello
    // de "esta versión es la oficial" encima de lo que ya quedó guardado.
    // Si algo cambiara después (ej. una corrección manual de un ticket ya
    // cerrado), se desconfirma sola igual que cualquier otro día — ver
    // desconfirmarDia() en historial.js.
    // =================================================================
    try {
      await confirmarDia(grupoId, fecha);
    } catch (e) {
      console.error('[whatsappBot] Día cerrado pero no se pudo confirmar solo en Balance General (grupo ' + grupoId + ', fecha ' + fecha + '):', e.message);
    }
    console.log('[whatsappBot] Día cerrado (grupo ' + grupoId + ', fecha ' + fecha + '): listado final + totales mandados, y confirmado en Balance General.');
    return { accion, resp };
  }

  return { accion };
}

// =================================================================
// COMANDOS DE CHAT (09-09-2026, a pedido del usuario — ver la nota
// grande en whatsappTrigger.detectarComando). A diferencia de "SABANA DE
// JUGADAS" (que CARGA algo nuevo), estos 4 comandos solo piden una
// ACCIÓN sobre lo que ya está guardado — ninguno toca
// tickets_historial/procesarSabana salvo por reprocesar (nunca insertar)
// la sábana YA guardada del día, igual que ya hacía procesarDiaAbierto.
//
// "Quién puede mandar estos comandos": igual que "SABANA DE JUGADAS" de
// siempre — cualquiera que escriba en el grupo de WhatsApp VINCULADO Y
// con el servicio contratado (grupoIdPorJid exige ambas cosas, ver
// sabanasPendientesWhatsapp.js). No se agregó ninguna restricción extra
// de "solo tal número" porque el usuario no lo pidió explícitamente al
// contestar las preguntas de esta función — si más adelante hace falta
// limitarlo a un número puntual, se puede agregar comparando
// remitente/msg.key.participant contra un número autorizado guardado en
// el grupo.
// =================================================================

// "actualizar sabana" / "actualizar juegos" / "act": revisa de nuevo los
// resultados en vivo y reenvía el listado de HOY (con los íconos que ya
// correspondan) — reusa procesarDiaAbierto con forzar:true, EXACTAMENTE
// lo mismo que hace el botón "📤 Enviar resumen ahora" del panel, nada
// nuevo que probar aparte de esto.
async function manejarComandoActualizar(sock, grupoId, jid) {
  const fecha = formatearFechaISO(new Date());
  const resultado = await procesarDiaAbierto(sock, grupoId, jid, fecha, { forzar: true });
  if (resultado && resultado.accion === 'SIN_SABANA') {
    await avisar(sock, jid, '⚠️ Todavía no se cargó ninguna sábana de jugadas para hoy (' + formatFechaAviso(fecha) + ').');
  } else if (resultado && resultado.accion === 'ERROR') {
    await avisar(sock, jid, '⚠️ No se pudo actualizar la sábana de hoy: ' + resultado.error);
  }
  return resultado;
}

// "saldo final" / "saldo del dia" (09-09-2026, semántica exacta a pedido
// del usuario: "solo si la sabana ya tiene todas las jugadas con sus
// resultados, si llego a pedir saldo final o saldo del dia y aun quedan
// juegos sin resultados, enviame de nuevo la sabana verificando si ya
// todos los juegos estan listos... si estan listos colcoale sus signos
// calculalos y despues envias saldos totales, si aun faltan juegos
// emvia la sabana y posterior un mensaje indicando que faltan jugadas
// por decidirse").
//
// A PROPÓSITO esto NO reusa whatsappResumenDia.decidirAccion() — esa
// función exige sabanaFinalEn && todosResueltos para el cierre (ver la
// nota grande en whatsappResumenDia.js); este comando cierra con
// SOLAMENTE todosResueltos, sin importar si llegó o no "SABANA DE
// JUGADAS FINAL". Tampoco marca el día como cerrado
// (marcarSabanaFinalRecibida/marcarCierreEnviado) — a propósito: el
// usuario puede pedir "saldo del día" como una CONSULTA en cualquier
// momento, y si más tarde llegan más jugadas para esa misma fecha (el
// día nunca recibió "SABANA DE JUGADAS FINAL" de verdad), tienen que
// poder seguir entrando sin que este comando haya dejado el día
// bloqueado. Sí se confirma el día en Balance General
// (confirmarDia — "como termine el dia") cuando todo está resuelto,
// igual que en el cierre automático — si más tarde cambia algo, se
// desconfirma sola (ver desconfirmarDia en historial.js).
async function manejarComandoSaldoDia(sock, grupoId, jid) {
  const fecha = formatearFechaISO(new Date());
  const estadoDia = await whatsappDiaEstado.obtenerEstadoDia(grupoId, fecha);
  if (!estadoDia || !estadoDia.ultimoTexto) {
    await avisar(sock, jid, '⚠️ Todavía no se cargó ninguna sábana de jugadas para hoy (' + formatFechaAviso(fecha) + ').');
    return { accion: 'SIN_SABANA' };
  }

  let resp;
  try {
    resp = await procesarSabana(grupoId, estadoDia.ultimoTexto, fecha);
  } catch (e) {
    console.error('[whatsappBot] manejarComandoSaldoDia: no se pudo reprocesar la sábana de hoy (grupo ' + grupoId + '):', e.message);
    await avisar(sock, jid, '⚠️ No se pudo revisar la sábana de hoy: ' + e.message);
    return { accion: 'ERROR', error: e.message };
  }

  const todosResueltos = whatsappResumenDia.todosLosTicketsResueltos(resp.tickets);
  const hashActual = whatsappResumenDia.calcularHashTickets(resp.tickets);
  const nombreGrupo = await obtenerNombreGrupo(grupoId);

  if (!todosResueltos) {
    const textoListado = generarTextoListadoSabana(resp, { esFinal: false, nombreGrupo });
    await avisar(sock, jid, textoListado);
    await avisar(sock, jid, '⏳ Todavía faltan jugadas por decidirse o juegos por terminar — apenas todos tengan resultado, volvé a pedir *saldo final*/*saldo del día* para ver los totales.');
    await whatsappDiaEstado.registrarEnvioResumen(grupoId, fecha, hashActual);
    return { accion: 'FALTAN_JUEGOS', resp };
  }

  const textoListado = generarTextoListadoSabana(resp, { esFinal: true, nombreGrupo });
  await avisar(sock, jid, textoListado);
  const textoTotales = generarTextoTotalesDia(resp);
  await avisar(sock, jid, textoTotales);
  await whatsappDiaEstado.registrarEnvioResumen(grupoId, fecha, hashActual);
  try {
    await confirmarDia(grupoId, fecha);
  } catch (e) {
    console.error('[whatsappBot] manejarComandoSaldoDia: no se pudo confirmar el día en Balance General (grupo ' + grupoId + ', fecha ' + fecha + '):', e.message);
  }
  return { accion: 'TOTALES_ENVIADOS', resp };
}

// Arma y manda los 2 mensajes de un cliente puntual ("balance" y, si
// tuvo algo de comisión en la semana, "% aparte") — usado tanto por
// "corte semana" (todos los clientes) como por "saldo total semana
// <nombre>" (uno solo), para no duplicar el criterio de cuándo mandar
// el segundo mensaje.
async function enviarCorteClienteSemana(sock, jid, nombreCliente, datosCliente) {
  const datos = datosCliente || { porFecha: {}, totalResultado: 0, totalComision: 0 };
  await avisar(sock, jid, generarTextoBalanceSemanalCliente(nombreCliente, datos));
  if (Math.abs(datos.totalComision) > 0.001) {
    await avisar(sock, jid, generarTextoPorcentajeSemanalCliente(nombreCliente, datos));
  }
}

// "corte semana" / "saldo semana" / "saldo semanal": el desglose de la
// semana actual (lunes a domingo) de CADA cliente registrado (activo) en
// el grupo, 2 mensajes por cliente por separado (09-09-2026, a pedido
// del usuario, ver la nota grande en balanceGeneral.
// calcularBalanceSemanalPorCliente).
async function manejarComandoCorteSemana(sock, grupoId, jid) {
  const { desde, hasta } = await calcularRangoRapido(grupoId, 'semana');
  const { porcentajesPropios, avalesMap, modeloComision, tiersComision, modelosComisionPorCliente, jugadores } = await cargarConfigGrupo(grupoId);
  const configComision = { modelo: modeloComision, tiers: tiersComision, modelosPorCliente: modelosComisionPorCliente };
  const { porCliente } = await calcularBalanceSemanalPorCliente(grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision);

  // Todos los clientes ACTIVOS registrados en el grupo (aunque no hayan
  // jugado nada esta semana — el propio texto de generarTextoBalanceSemanalCliente
  // avisa "(sin jugadas esta semana)" en ese caso) + cualquier cliente
  // que sí tuvo movimiento esta semana pero ya no esté activo (para no
  // perder su corte solo porque se dio de baja a mitad de semana).
  const nombres = jugadores.filter(j => j.activo).map(j => j.nombre);
  Object.keys(porCliente).forEach(nombre => { if (!nombres.includes(nombre)) nombres.push(nombre); });

  if (nombres.length === 0) {
    await avisar(sock, jid, '⚠️ Este grupo todavía no tiene ningún cliente registrado.');
    return { accion: 'SIN_CLIENTES' };
  }

  for (const nombre of nombres) {
    await enviarCorteClienteSemana(sock, jid, nombre, porCliente[nombre]);
  }
  return { accion: 'CORTE_SEMANA_ENVIADO', clientes: nombres.length };
}

// "saldo total semana <nombre>" / "total semana <nombre>": lo mismo de
// arriba pero de un solo cliente — busca sin importar tildes/mayúsculas
// (los nombres de cliente en el sistema siempre se guardan en MAYÚSCULAS,
// ver routes/jugadores.js).
async function manejarComandoSaldoCliente(sock, grupoId, jid, nombreBuscado) {
  const { desde, hasta } = await calcularRangoRapido(grupoId, 'semana');
  const { porcentajesPropios, avalesMap, modeloComision, tiersComision, modelosComisionPorCliente, jugadores } = await cargarConfigGrupo(grupoId);

  const buscadoNormalizado = quitarTildes(nombreBuscado.trim().toLowerCase());
  const jugador = jugadores.find(j => quitarTildes(String(j.nombre || '').trim().toLowerCase()) === buscadoNormalizado);
  const configComision = { modelo: modeloComision, tiers: tiersComision, modelosPorCliente: modelosComisionPorCliente };
  const { porCliente } = await calcularBalanceSemanalPorCliente(grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision);

  // Si no está registrado como jugador PERO sí aparece con movimiento
  // esta semana (ej. un cliente ya dado de baja), se busca también por
  // nombre normalizado adentro de porCliente antes de rendirse.
  let nombreCliente = jugador ? jugador.nombre : null;
  if (!nombreCliente) {
    nombreCliente = Object.keys(porCliente).find(n => quitarTildes(n.trim().toLowerCase()) === buscadoNormalizado) || null;
  }

  if (!nombreCliente) {
    await avisar(sock, jid, '⚠️ No encontré ningún cliente registrado como "' + nombreBuscado.trim() + '".');
    return { accion: 'CLIENTE_NO_ENCONTRADO' };
  }

  await enviarCorteClienteSemana(sock, jid, nombreCliente, porCliente[nombreCliente]);
  return { accion: 'SALDO_CLIENTE_ENVIADO', cliente: nombreCliente };
}

async function manejarComando(sock, grupoId, jid, comando) {
  try {
    if (comando.tipo === 'actualizar_sabana') return await manejarComandoActualizar(sock, grupoId, jid);
    if (comando.tipo === 'saldo_dia') return await manejarComandoSaldoDia(sock, grupoId, jid);
    if (comando.tipo === 'corte_semana') return await manejarComandoCorteSemana(sock, grupoId, jid);
    if (comando.tipo === 'saldo_cliente') return await manejarComandoSaldoCliente(sock, grupoId, jid, comando.nombre);
  } catch (e) {
    console.error('[whatsappBot] Error al procesar el comando "' + comando.tipo + '" (grupo ' + grupoId + '):', e);
    await avisar(sock, jid, '⚠️ Ocurrió un error al procesar ese comando: ' + e.message);
  }
}

async function manejarMensajeEntrante(sock, msg) {
  try {
    const remoteJid = msg.key && msg.key.remoteJid;
    if (!remoteJid || !remoteJid.endsWith('@g.us')) return; // solo grupos, no chats 1 a 1

    // OJO (04-09-2026, a pedido del usuario): NO se descartan los mensajes
    // "fromMe" (mandados desde el MISMO número que escaneó el QR y corre
    // el bot). Antes se ignoraban a propósito — la idea original era
    // evitar que el bot reprocesara sus propios avisos/resúmenes — pero
    // eso también bloqueaba al usuario cuando él mismo (desde ese mismo
    // número) era quien mandaba la "SABANA DE JUGADAS" al grupo. Es
    // seguro sacar el filtro: los mensajes que el propio bot manda
    // (avisos, listados, totales — ver planoWhatsAppTexto.js) NUNCA
    // arrancan con "SABANA DE JUGADAS", así que detectarTriggerSabana()
    // de abajo los descarta solo, sin necesidad de fijarse en fromMe.

    const texto = await extraerTexto(msg);
    if (!texto) return;

    const { esSabana, esFinal, fecha: fechaDetectada, fechaEncontrada, textoLimpio } = detectarTriggerSabana(texto);

    // Comandos de chat cortos (09-09-2026: "actualizar sabana"/"act",
    // "saldo final"/"saldo del dia", "corte semana", "saldo total semana
    // <nombre>") — nunca coinciden con "SABANA DE JUGADAS...", así que se
    // prueban solo cuando el mensaje NO es una sábana.
    if (!esSabana) {
      const comando = detectarComando(texto);
      if (!comando) return;
      // Mismo criterio que "SABANA DE JUGADAS": exige un grupo con este
      // JID vinculado Y el servicio contratado (ambas cosas exclusivas
      // de Súper-admin) — sin eso, se ignora en silencio, igual que
      // cualquier otro mensaje suelto en un grupo sin el servicio.
      const grupoId = await grupoIdPorJid(remoteJid);
      if (!grupoId) return;
      // Segunda capa, EXCLUSIVA de los comandos (09-09-2026): solo el
      // número que el Súper-admin cargó y dejó habilitado para este
      // grupo puede disparar "act"/"saldo final"/"corte semana"/"saldo
      // total semana <nombre>" — cualquier otro participante del mismo
      // grupo se ignora en silencio (no se le avisa "no autorizado", para
      // no confirmarle a nadie que este número sí es especial).
      const remitenteComandoCrudo = (msg.key && msg.key.participant) || remoteJid;
      const remitenteComando = await resolverNumeroRealDelRemitente(sock, msg, remitenteComandoCrudo);
      const autorizado = await estaAutorizadoParaComandos(grupoId, remitenteComando);
      if (!autorizado) return;
      await manejarComando(sock, grupoId, remoteJid, comando);
      return;
    }

    // grupoIdPorJid() (04-09-2026) exige AMBAS cosas: un grupo con este
    // JID vinculado Y whatsapp_habilitado=true — ambas exclusivas del
    // Súper-admin (ver la nota grande en sabanasPendientesWhatsapp.js).
    const grupoId = await grupoIdPorJid(remoteJid);
    if (!grupoId) {
      console.log('[whatsappBot] Mensaje "SABANA DE JUGADAS" recibido de un grupo de WhatsApp sin ningún grupo del sistema vinculado Y con el servicio contratado (JID: ' + remoteJid + '). Se ignora. Eso se activa desde Súper-admin (detalle del Grupo → "📲 Sábana automática por WhatsApp").');
      return;
    }

    const remitente = (msg.key && msg.key.participant) || remoteJid;
    const remitenteNombre = msg.pushName || null;

    // Cordón de seguridad (04-09-2026, a pedido del usuario): la fecha
    // tiene que venir SÍ o SÍ en la línea de abajo de "SABANA DE
    // JUGADAS". Si no está o no se pudo leer, el mensaje se rechaza acá
    // mismo — el bot nunca asume el día de hoy por su cuenta, para no
    // cargar sin querer la sábana en la fecha equivocada.
    if (!fechaEncontrada) {
      const pendiente = await crearPendiente(grupoId, { texto: textoLimpio, fechaDetectada: null, remitente, remitenteNombre });
      await marcarError(grupoId, pendiente.id, 'Falta la fecha (o no se pudo leer) en la línea de abajo de "SABANA DE JUGADAS".');
      await avisar(sock, remoteJid, '⚠️ No se pudo leer la fecha. Recordá el formato:\n*SABANA DE JUGADAS*\nDD-MM-YYYY\n(las jugadas...)\n\nVolvé a mandar el mensaje con la fecha en la línea de abajo del disparador.');
      return;
    }
    const fecha = fechaDetectada;

    const pendiente = await crearPendiente(grupoId, { texto: textoLimpio, fechaDetectada: fecha, remitente, remitenteNombre });

    const estadoDiaPrevio = await whatsappDiaEstado.obtenerEstadoDia(grupoId, fecha);

    // El día ya se cerró con "SABANA DE JUGADAS FINAL" — no se aceptan
    // más actualizaciones de sábana (sí se sigue aceptando otro "SABANA
    // DE JUGADAS FINAL", para el caso de duplicado, que se maneja aparte
    // abajo).
    if (estadoDiaPrevio && estadoDiaPrevio.sabanaFinalEn && !esFinal) {
      await marcarError(grupoId, pendiente.id, 'Se ignoró: la fecha ' + fecha + ' ya fue cerrada con SABANA DE JUGADAS FINAL. No se aceptan más actualizaciones de sábana para esa fecha.');
      await avisar(sock, remoteJid, '⚠️ La fecha ' + formatFechaAviso(fecha) + ' ya fue cerrada con *SABANA DE JUGADAS FINAL* — este mensaje se ignoró. Si hace falta corregir algo, hacelo desde el panel.');
      return;
    }

    if (esFinal) {
      const { yaEstabaCerrado } = await whatsappDiaEstado.marcarSabanaFinalRecibida(grupoId, fecha);
      if (yaEstabaCerrado) {
        await marcarError(grupoId, pendiente.id, 'Duplicado: ya se había recibido SABANA DE JUGADAS FINAL para la fecha ' + fecha + '.');
        await avisar(sock, remoteJid, '⚠️ Ya se había recibido *SABANA DE JUGADAS FINAL* para la fecha ' + formatFechaAviso(fecha) + ' — este mensaje se ignoró (duplicado).');
        return;
      }
    }

    // OJO: a procesarSabana() nunca se le manda el mensaje completo — se
    // le sacan antes las primeras dos líneas (la del disparador, "SABANA
    // DE JUGADAS.../...FINAL", y la de la fecha justo abajo), porque el
    // parser no las reconoce como nada y las deja como un ticket
    // fantasma bajo "GENERAL" con estado "FALTA CERRAR EN SÁBANA", que
    // cuenta como "abierto" para siempre (ver quitarLineaTrigger() en
    // whatsappTrigger.js — sin esto, ningún día llegaría jamás a
    // "todosLosTicketsResueltos" y el cierre no se mandaría nunca). Un
    // "SABANA DE JUGADAS FINAL" muchas veces es SOLO esas dos líneas, sin
    // ninguna jugada abajo — en ese caso el cuerpo queda vacío,
    // procesarSabana() no encuentra ningún ticket, y eso está bien: no
    // es un error, más abajo se decide que es un cierre sin contenido
    // nuevo.
    const cuerpoSabana = quitarLineaTrigger(textoLimpio);
    let resultadoParseo = null;
    let motivoError = null;
    try {
      const resp = await procesarSabana(grupoId, cuerpoSabana, fecha);
      // OJO: "resp.tickets.length > 0" NO alcanza para saber si el
      // mensaje traía una jugada de verdad — cualquier línea que el
      // parser no reconoce (un typo, una nota, texto suelto) igual
      // termina como un ticket bajo el cliente "GENERAL" con arriesga:0
      // (para no perder esa línea sin más). Un ticket REAL siempre
      // arriesga algo — por eso se exige al menos uno con arriesga > 0.
      const hayTicketsReales = resp && Array.isArray(resp.tickets) && resp.tickets.some(t => Number(t.arriesga) > 0);
      if (hayTicketsReales) {
        resultadoParseo = resp;
      } else {
        motivoError = 'no se reconoció ninguna jugada real en el mensaje';
      }
    } catch (e) {
      motivoError = e.message || String(e);
    }

    if (resultadoParseo) {
      await whatsappDiaEstado.registrarTextoRecibido(grupoId, fecha, cuerpoSabana);
      await marcarImportada(grupoId, pendiente.id);
      console.log('[whatsappBot] Sábana' + (esFinal ? ' FINAL' : '') + ' auto-importada (grupo ' + grupoId + ', fecha ' + fecha + ').');
    } else if (esFinal && estadoDiaPrevio && estadoDiaPrevio.ultimoTexto) {
      // Cierre "solo" (sin jugadas nuevas en el mensaje) -> se sigue con
      // la sábana que ya estaba cargada, no es un error.
      await descartarPendiente(grupoId, pendiente.id, 'Mensaje de cierre sin jugadas nuevas — se sigue usando la última sábana ya cargada para esta fecha' + (motivoError ? (' (' + motivoError + ')') : '') + '.');
    } else {
      await marcarError(grupoId, pendiente.id, motivoError || 'No se pudo leer ninguna jugada en el mensaje.');
      await avisar(sock, remoteJid, '⚠️ No se pudo leer la sábana: ' + (motivoError || 'no se reconoció ninguna jugada') + '\nRevisá el formato del mensaje y volvé a mandarla.');
      return; // sin una sábana válida cargada para hoy, no hay nada más que verificar/mandar
    }

    // Se acaba de cargar/actualizar la sábana del día: se verifica de
    // una vez (sigue respetando el reloj de la hora salvo que sea la
    // primera verificación del día, o que ya toque cerrar) en vez de
    // esperar a que el reloj de fondo pase por acá.
    await procesarDiaAbierto(sock, grupoId, remoteJid, fecha, { forzar: false });
  } catch (e) {
    console.error('[whatsappBot] Error al procesar un mensaje entrante (no se cae el bot, solo se pierde este mensaje puntual):', e);
  }
}

async function listarGruposDisponibles(sock) {
  try {
    const grupos = await sock.groupFetchAllParticipating();
    const lista = Object.values(grupos).map(g => ({ jid: g.id, nombre: g.subject }));
    estadoConexion.gruposDisponibles = lista;
    console.log('[whatsappBot] Grupos de WhatsApp a los que pertenece este número (copiá el JID del que corresponda al Súper-admin, para que lo cargue en el detalle del Grupo → "📲 Sábana automática por WhatsApp"):');
    lista.forEach(g => console.log('  - "' + g.nombre + '" -> ' + g.jid));
  } catch (e) {
    console.error('[whatsappBot] No se pudo listar los grupos de WhatsApp:', e.message);
  }
}

// El reloj de fondo: cada 5 minutos recorre TODOS los días abiertos de
// TODOS los grupos con bot vinculado y les da la chance de verificar/
// avisar/cerrar (cada día respeta su propio "cada hora" por adentro, ver
// whatsappResumenDia.decidirAccion — este intervalo de 5 minutos es solo
// qué tan seguido se FIJA si a algún día ya le toca, no qué tan seguido
// se manda algo al grupo).
const INTERVALO_RELOJ_MS = 5 * 60 * 1000;

async function tickRelojDeFondo() {
  if (!sockActual) return; // sin conexión activa ahora mismo, no hay con qué mandar nada
  let dias = [];
  try {
    dias = await whatsappDiaEstado.listarDiasAbiertos(3);
  } catch (e) {
    console.error('[whatsappBot] No se pudo listar los días abiertos:', e.message);
    return;
  }
  for (const dia of dias) {
    try {
      await procesarDiaAbierto(sockActual, dia.grupoId, dia.whatsappGrupoJid, dia.fecha, { forzar: false });
    } catch (e) {
      console.error('[whatsappBot] Error al verificar el día ' + dia.fecha + ' (grupo ' + dia.grupoId + '):', e.message);
    }
  }
}

function iniciarRelojDeFondo() {
  if (relojDeFondoIniciado) return;
  relojDeFondoIniciado = true;
  setInterval(() => { tickRelojDeFondo().catch(e => console.error('[whatsappBot] Error inesperado en el reloj de fondo:', e)); }, INTERVALO_RELOJ_MS);
  console.log('[whatsappBot] Reloj de fondo iniciado (revisa los días abiertos cada 5 minutos).');
}

// Arranca el bot. Se llama UNA vez desde server.js, solo si
// WHATSAPP_BOT_ACTIVADO=true. Si algo falla acá adentro, el error se
// propaga hacia quien llamó (server.js lo atrapa con .catch para que
// nunca tumbe el resto del servidor).
async function iniciarBotWhatsApp() {
  // Requires adentro de la función a propósito: si este archivo se
  // llegara a cargar sin querer (no debería, ver server.js/routes/whatsapp.js),
  // que el error explote acá, en el momento de intentar arrancar el bot,
  // y no al momento de simplemente requerir el archivo.
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
  const { Boom } = require('@hapi/boom');
  const qrcode = require('qrcode-terminal');

  const sessionDir = process.env.WHATSAPP_SESSION_DIR
    ? path.resolve(process.env.WHATSAPP_SESSION_DIR)
    : path.resolve('./whatsapp-session');

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      estadoConexion.ultimoQr = qr;
      console.log('[whatsappBot] Escaneá este código QR con el WhatsApp que va a "escuchar" el grupo (Ajustes > Dispositivos vinculados > Vincular un dispositivo):');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      estadoConexion.conectado = true;
      estadoConexion.ultimoError = null;
      sockActual = sock;
      console.log('[whatsappBot] Conectado a WhatsApp.');
      listarGruposDisponibles(sock);
      iniciarRelojDeFondo();
    }

    if (connection === 'close') {
      estadoConexion.conectado = false;
      sockActual = null;
      const motivo = lastDisconnect && lastDisconnect.error ? new Boom(lastDisconnect.error) : null;
      const cerroSesion = motivo && motivo.output && motivo.output.statusCode === DisconnectReason.loggedOut;
      if (cerroSesion) {
        estadoConexion.ultimoError = 'Se cerró la sesión de WhatsApp (hay que volver a escanear el QR). Borrá la carpeta de sesión (' + sessionDir + ') y reiniciá el servidor.';
        console.error('[whatsappBot] ' + estadoConexion.ultimoError);
      } else {
        estadoConexion.ultimoError = 'Se perdió la conexión con WhatsApp, reintentando...';
        console.log('[whatsappBot] Conexión perdida, reintentando...');
        iniciarBotWhatsApp().catch(e => console.error('[whatsappBot] Error al reconectar:', e));
      }
    }
  });

  sock.ev.on('messages.upsert', async (evento) => {
    const mensajes = evento.messages || [];
    for (const msg of mensajes) {
      await manejarMensajeEntrante(sock, msg);
    }
  });

  return sock;
}

module.exports = {
  iniciarBotWhatsApp,
  obtenerEstadoConexion,
  obtenerSockActivo,
  procesarDiaAbierto,
  // manejarMensajeEntrante y tickRelojDeFondo se exportan sobre todo
  // para poder probarlas de verdad (ver test_whatsapp_bot_flujo.js) sin
  // necesitar @whiskeysockets/baileys instalado — ninguna de las dos
  // toca esa librería, solo reciben un `sock`/`msg` ya armados.
  manejarMensajeEntrante,
  tickRelojDeFondo,
  // Comandos de chat (09-09-2026) — exportados aparte para poder probar
  // cada uno directo, sin tener que armar un `msg` de Baileys falso para
  // cada caso (ver test_whatsapp_comandos.js).
  manejarComando,
  manejarComandoActualizar,
  manejarComandoSaldoDia,
  manejarComandoCorteSemana,
  manejarComandoSaldoCliente,
  // Autorización de comandos (09-09-2026) — exportada aparte para
  // probarla directo (ver test_whatsapp_comandos_autorizacion.js).
  estaAutorizadoParaComandos,
  // Resolución de @lid -> número real (09-09-2026) — exportada aparte
  // para poder probarla directo (ver test_whatsapp_comandos_autorizacion.js).
  resolverNumeroRealDelRemitente
};
