// =================================================================
// RUTAS DEL PANEL DE WHATSAPP (03-09-2026, a pedido del usuario:
// "existe alguna manera de que en mi chat de whatssap yo actualice la
// sabana y se cargue automatico en el sistema?" y, más tarde ese mismo
// día, la ampliación grande de auto-importar 100% + avisos en vivo +
// "SABANA FINAL").
//
// Con el auto-importado 100% automático (whatsappBot.js hace TODO el
// trabajo apenas llega el mensaje), este archivo dejó de ser una
// bandeja de aprobación manual — ya no existen /pendientes/:id/importar
// ni /pendientes/:id/descartar. Ahora es: (a) el estado de los días
// abiertos/cerrados del grupo + el botón manual "Enviar resumen ahora",
// (b) un log de auditoría de lo último que pasó con cada mensaje
// recibido (importada/descartada/error), y (c) un resumen de solo
// LECTURA de la sábana del día ya cargada por WhatsApp, para que el
// panel principal ("Resumen por Cliente") la muestre automáticamente
// sin que nadie tenga que pegarla a mano — ver GET /dias/:fecha/resumen
// más abajo.
//
// REVISADO 04-09-2026, a pedido del usuario: "este servicio sera un
// plus para los grupos que compren el servicio... quiero desde super
// admin poder habilitar esta opcion o no a los grupos" y "el codigo
// para activar el bot con el grupo de whatsaap solo lo puede activar,
// editar o eliminar desde super admin... no como ahorita que lo hice
// desde la sesion de un grupo, si lo dejamos asi ellos podrian cambiar
// para que grupo trabaja la aplicacion". Dos cambios grandes:
//   1. Ya NO existe PUT /grupo-jid acá — vincular/editar/desvincular el
//      JID del grupo de WhatsApp pasó a ser EXCLUSIVO del Súper-admin
//      (PATCH /api/superadmin/grupos/:id/whatsapp-jid, ver
//      superadmin.js/.html) — antes lo podía cambiar el propio Grupo
//      desde su sesión, lo que le hubiera dejado "secuestrar" a qué
//      grupo de WhatsApp le apunta el bot.
//   2. Todo lo de acá ahora respeta también req.grupo.whatsapp_habilitado
//      (el interruptor "este Grupo compró el servicio automático",
//      también exclusivo del Súper-admin) — un Grupo con esto en false
//      sigue 100% manual, aunque el bot esté prendido a nivel servidor.
//
// A propósito, este archivo NUNCA requiere '../services/whatsappBot' de
// forma incondicional en la parte de arriba — aunque ese módulo YA se
// puede cargar sin @whiskeysockets/baileys instalado (ver la nota en
// whatsappBot.js), sigue sin tener sentido cargarlo si
// WHATSAPP_BOT_ACTIVADO !== 'true' (el bot ni siquiera está corriendo,
// no habría ningún sock activo con el que mandar nada).
const express = require('express');
const { requiereGrupo, requierePermiso } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const pendientesService = require('../services/sabanasPendientesWhatsapp');
const whatsappDiaEstado = require('../services/whatsappDiaEstado');
const { procesarSabana } = require('../services/procesarSabana');

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('whatsapp'));

function botActivado() {
  return process.env.WHATSAPP_BOT_ACTIVADO === 'true';
}

function servicioHabilitado(req) {
  return !!(req.grupo && req.grupo.whatsapp_habilitado);
}

// Resumen fijo (id, fecha) -> { locked, lastCheck, lastSend } para que el
// panel pinte cada día con su candado y sus horas, sin exponer las 9
// columnas crudas de whatsapp_dia_estado.
function resumirDia(d) {
  return {
    fecha: d.fecha,
    cerrado: !!d.sabanaFinalEn,
    cierreEnviado: !!d.cierreEnviadoEn,
    ultimaVerificacionEn: d.ultimaVerificacionEn,
    ultimoEnvioResumenEn: d.ultimoEnvioResumenEn,
    tieneSabana: !!d.ultimoTexto
  };
}

// Estado general del panel: si este Grupo tiene el servicio contratado,
// bot conectado o no, grupo vinculado o no, los días recientes (abiertos
// y cerrados) con su candado/últimas horas, y el log de auditoría de
// mensajes recibidos por WhatsApp.
router.get('/estado', asyncHandler(async (req, res) => {
  const habilitado = servicioHabilitado(req);

  // Sin el servicio contratado (interruptor del Súper-admin), ni
  // siquiera tiene sentido listar días/recientes — este Grupo trabaja
  // 100% manual, como siempre.
  if (!habilitado) {
    return res.json({ habilitado: false, botActivo: botActivado(), grupoVinculado: false, estadoBot: null, dias: [], recientes: [] });
  }

  let estadoBot = null;
  if (botActivado()) {
    try {
      const { obtenerEstadoConexion } = require('../services/whatsappBot');
      estadoBot = obtenerEstadoConexion();
    } catch (e) {
      estadoBot = { conectado: false, error: 'El bot está activado pero no se pudo consultar su estado: ' + e.message };
    }
  }
  const [dias, recientes] = await Promise.all([
    whatsappDiaEstado.listarDiasDelGrupo(req.grupoId, 7),
    pendientesService.listarRecientes(req.grupoId, 20)
  ]);
  res.json({
    habilitado: true,
    botActivo: botActivado(),
    grupoVinculado: !!(req.grupo && req.grupo.whatsapp_grupo_jid),
    estadoBot,
    dias: dias.map(resumirDia),
    recientes
  });
}));

// Botón "📤 Enviar resumen ahora": fuerza una verificación de ese día YA
// y, si el bot está conectado, manda el listado (o el cierre, si ya
// corresponde) — desde el 18-09-2026 esta es la ÚNICA forma en que el
// resumen sale al grupo (junto con los comandos de chat), ver la
// advertencia grande al principio de whatsappBot.js.
router.post('/dias/:fecha/enviar-resumen', asyncHandler(async (req, res) => {
  if (!servicioHabilitado(req)) {
    // 400, a propósito NUNCA 401/403: el frontend (api() en app.js) trata
    // 401/403 como "la sesión venció" y cierra sesión sola — "no tienes
    // este servicio contratado" es un estado de negocio normal, no un
    // problema de autenticación, y no puede tumbarle la sesión a un Grupo
    // que simplemente no compró este plus.
    return res.status(400).json({ error: 'Este grupo no tiene contratado el servicio de sábana automática por WhatsApp.' });
  }
  if (!botActivado()) {
    return res.status(400).json({ error: 'El bot de WhatsApp no está activado en este servidor (WHATSAPP_BOT_ACTIVADO).' });
  }
  if (!req.grupo || !req.grupo.whatsapp_grupo_jid) {
    return res.status(400).json({ error: 'Este grupo todavía no tiene vinculado ningún grupo de WhatsApp (lo hace el Súper-admin).' });
  }
  const { obtenerSockActivo, procesarDiaAbierto } = require('../services/whatsappBot');
  const sock = obtenerSockActivo();
  if (!sock) {
    return res.status(409).json({ error: 'El bot no está conectado a WhatsApp en este momento (revisa el QR/la conexión).' });
  }
  const resultado = await procesarDiaAbierto(sock, req.grupoId, req.grupo.whatsapp_grupo_jid, req.params.fecha, { forzar: true });
  res.json(resultado);
}));

// Botón "🔍 Diagnosticar quién traba el envío" (16-09-2026, a partir del
// detalle real del error "not-acceptable" que el usuario copió con el
// botón de arriba y pasó al chat): ese error viene de adentro de Baileys,
// de un paso que junta a TODOS los participantes del grupo que necesitan
// una sesión cifrada nueva en UN SOLO pedido a WhatsApp — si el servidor
// rechaza ese pedido para UN SOLO participante (alguien que se borró de
// WhatsApp, o que bloqueó a este número, por ejemplo), el pedido ENTERO
// se cae y el mensaje no se le manda a NADIE del grupo. Esta acción prueba
// la sesión de cada participante UNO POR UNO para señalar exactamente
// cuál(es) número(s) son el problema — ver el comentario grande en
// whatsappBot.diagnosticarSesionesGrupo(). A propósito es manual (puede
// tardar unos segundos en grupos grandes, un pedido por participante).
router.post('/diagnosticar-sesiones', asyncHandler(async (req, res) => {
  if (!servicioHabilitado(req)) {
    return res.status(400).json({ error: 'Este grupo no tiene contratado el servicio de sábana automática por WhatsApp.' });
  }
  if (!botActivado()) {
    return res.status(400).json({ error: 'El bot de WhatsApp no está activado en este servidor (WHATSAPP_BOT_ACTIVADO).' });
  }
  if (!req.grupo || !req.grupo.whatsapp_grupo_jid) {
    return res.status(400).json({ error: 'Este grupo todavía no tiene vinculado ningún grupo de WhatsApp (lo hace el Súper-admin).' });
  }
  const { obtenerSockActivo, diagnosticarSesionesGrupo } = require('../services/whatsappBot');
  const sock = obtenerSockActivo();
  if (!sock) {
    return res.status(409).json({ error: 'El bot no está conectado a WhatsApp en este momento (revisa el QR/la conexión).' });
  }
  const resultado = await diagnosticarSesionesGrupo(sock, req.grupo.whatsapp_grupo_jid);
  res.json(resultado);
}));

// =================================================================
// RESUMEN DE SOLO LECTURA de la sábana de un día ya cargado por
// WhatsApp (04-09-2026, a pedido del usuario: "cuando este habilitada
// la opcion de sabana automatica, se debe cargar en resumen por cliente
// las jugadas y los saldos de como van en el dia como si se cargara la
// sabana manual"). El panel principal (pestaña Sábana, "Resumen por
// Cliente") llama esto solo apenas se abre esa pestaña, en vez de
// obligar a pegar el texto a mano — con el MISMO shape de respuesta que
// POST /api/sabana/procesar (mismo `resumenPorCliente`/`tickets`/etc.),
// para poder pintarlo con exactamente las mismas funciones del
// frontend. A propósito NO manda ningún mensaje al grupo de WhatsApp
// real (eso es cosa del reloj de fondo / del botón "Enviar resumen
// ahora") — esto solo vuelve a correr procesarSabana() contra el texto
// YA guardado (que de paso también refresca resultados en vivo, mismo
// mecanismo que procesarDiaAbierto()) para poder MOSTRARLO en pantalla.
router.get('/dias/:fecha/resumen', asyncHandler(async (req, res) => {
  if (!servicioHabilitado(req)) {
    // 400, a propósito NUNCA 401/403: el frontend (api() en app.js) trata
    // 401/403 como "la sesión venció" y cierra sesión sola — "no tienes
    // este servicio contratado" es un estado de negocio normal, no un
    // problema de autenticación, y no puede tumbarle la sesión a un Grupo
    // que simplemente no compró este plus.
    return res.status(400).json({ error: 'Este grupo no tiene contratado el servicio de sábana automática por WhatsApp.' });
  }
  const estadoDia = await whatsappDiaEstado.obtenerEstadoDia(req.grupoId, req.params.fecha);
  if (!estadoDia || !estadoDia.ultimoTexto) {
    return res.status(404).json({ error: 'Todavía no llegó ninguna sábana por WhatsApp para esta fecha.' });
  }
  const resultado = await procesarSabana(req.grupoId, estadoDia.ultimoTexto, req.params.fecha);
  res.json(resultado);
}));

module.exports = router;
