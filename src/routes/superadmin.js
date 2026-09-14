// Rutas del rol "Súper-admin" (vos): crear grupos y activarlos/
// desactivarlos a mano — el "interruptor manual, sin cobro automático"
// del diagrama de arquitectura.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requiereSuperadmin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { cargarConfigGrupo } = require('../services/grupoConfig');
const { calcularBalanceGeneral } = require('../services/balanceGeneral');
const { calcularRangoRapido } = require('../services/historial');
const alertasService = require('../services/alertas');
const chatService = require('../services/chat');
const mantenimientoGrupo = require('../services/mantenimientoGrupo');
const telefonosService = require('../services/telefonos');

const router = express.Router();
router.use(requiereSuperadmin);

// Lista todos los grupos (para ver cuáles están activos/inactivos).
router.get('/grupos', asyncHandler(async (req, res) => {
  const r = await db.query('SELECT id, nombre, email, activo, creado_en FROM grupos ORDER BY creado_en DESC');
  res.json(r.rows);
}));

// Crea un grupo nuevo. Queda INACTIVO por defecto — vos lo activas aparte
// una vez que arreglaste el cobro con ese cliente.
router.post('/grupos', asyncHandler(async (req, res) => {
  try {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Faltan nombre, email o password.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const r = await db.query(
      `INSERT INTO grupos (nombre, email, password_hash, activo) VALUES ($1, $2, $3, false)
       RETURNING id, nombre, email, activo, creado_en`,
      [nombre, email, passwordHash]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un grupo con ese email.' });
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear el grupo.' });
  }
}));

// Activa o desactiva un grupo (el interruptor manual).
router.patch('/grupos/:id/activo', asyncHandler(async (req, res) => {
  const { activo } = req.body;
  const r = await db.query(
    'UPDATE grupos SET activo = $1 WHERE id = $2 RETURNING id, nombre, email, activo',
    [!!activo, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json(r.rows[0]);
}));

// =================================================================
// DETALLE DE UN GRUPO — lo que se ve al hacer clic en un grupo desde
// superadmin.html: jugadores activos, cómo va su saldo (balance de la
// banca contra ESE grupo — misma cuenta que usa Balance General del
// propio Grupo, ver src/services/balanceGeneral.js), y su último inicio
// de sesión.
//
// Saldo de banca por RANGO de fechas (01-09-2026, a pedido del usuario:
// antes siempre sumaba TODO el historial del grupo, y quería ver por
// defecto la semana actual, con posibilidad de elegir otra fecha —
// mismo espíritu que ya tiene Balance General del propio panel del
// Grupo). Acepta ?desde=&hasta=; si no vienen, usa la semana actual
// (lunes a domingo, calcularRangoRapido('semana'), la misma cuenta que
// ya usa el resto de la app) — nunca "todo el historial" por defecto.
// La respuesta siempre devuelve el rango REALMENTE usado (`rango`) para
// que el frontend sepa qué fechas está mostrando.
//
// OJO con la contraseña: NO se puede "ver la clave actual" — se guarda
// como hash de un solo sentido (bcrypt), a propósito, y no hay forma de
// revertirlo, ni para el súper-admin ni para nadie (eso es justamente lo
// que hace segura esa columna). Por eso esta ruta nunca la incluye en la
// respuesta, y la forma de "cambiarla" es PATCH /grupos/:id/password (más
// abajo), que fija una CONTRASEÑA NUEVA sin necesitar la vieja.
//
// "Dispositivo" del último login: lo que en realidad se guarda es el
// encabezado User-Agent que manda el propio navegador (ej. "Chrome en
// Windows") — es lo más cerca de "qué dispositivo" que un backend web
// puede saber sin instalar nada del lado del Grupo. No es un modelo
// exacto de celular/PC, es la cadena que el navegador decide reportar.
// =================================================================
router.get('/grupos/:id/detalle', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const grupoRes = await db.query(
    `SELECT id, nombre, email, activo, creado_en, ultimo_login_en, ultimo_login_ip, ultimo_login_user_agent, logo_url, whatsapp_habilitado, whatsapp_grupo_jid, sabana_muestra, comandos_whatsapp_habilitado, comandos_whatsapp_numero
     FROM grupos WHERE id = $1`,
    [id]
  );
  const grupo = grupoRes.rows[0];
  if (!grupo) return res.status(404).json({ error: 'Grupo no encontrado.' });

  const jugadoresActivosRes = await db.query(
    'SELECT COUNT(*)::int AS total FROM jugadores WHERE grupo_id = $1 AND activo = true',
    [id]
  );

  // ?desde&hasta (elegidos a mano), o ?rango=hoy|semana|mes|todo, o por
  // defecto la semana actual — nunca "todo el historial" de entrada, eso
  // quedó atrás (ver comentario arriba). Mismo mecanismo de
  // calcularRangoRapido() que ya usan el panel del Grupo y cliente.js.
  let desde = req.query.desde;
  let hasta = req.query.hasta;
  if (!desde && !hasta) {
    const rango = await calcularRangoRapido(id, req.query.rango || 'semana');
    desde = rango.desde;
    hasta = rango.hasta;
  }

  const config = await cargarConfigGrupo(id);
  const configComision = { modelo: config.modeloComision, tiers: config.tiersComision, modelosPorCliente: config.modelosComisionPorCliente };
  const balance = await calcularBalanceGeneral(id, desde, hasta, config.porcentajesPropios, config.avalesMap, configComision);

  res.json({
    id: grupo.id,
    nombre: grupo.nombre,
    email: grupo.email,
    activo: grupo.activo,
    creadoEn: grupo.creado_en,
    jugadoresActivos: jugadoresActivosRes.rows[0].total,
    saldoBanca: balance.balanceBanca,
    rango: { desde, hasta },
    logoUrl: grupo.logo_url,
    whatsappHabilitado: grupo.whatsapp_habilitado,
    whatsappGrupoJid: grupo.whatsapp_grupo_jid,
    sabanaMuestra: grupo.sabana_muestra,
    // (09-09-2026, a pedido del usuario) número autorizado para los
    // comandos de chat de WhatsApp ("act"/"saldo final"/"corte semana"/
    // "saldo total semana <nombre>") — ver la nota grande en
    // sql/schema.sql. Exclusivo del Súper-admin, SEPARADO de
    // whatsappHabilitado/whatsappGrupoJid (esos siguen controlando
    // "SABANA DE JUGADAS", sin cambios).
    comandosWhatsappHabilitado: grupo.comandos_whatsapp_habilitado,
    comandosWhatsappNumero: grupo.comandos_whatsapp_numero,
    // (08-09-2026, a pedido del usuario) modelo de comisión de este
    // grupo — ver la nota grande en sql/schema.sql y comisiones.js.
    // Exclusivo del Súper-admin, igual que whatsappHabilitado arriba.
    modeloComision: config.modeloComision,
    comisionTiers: config.tiersComision,
    ultimoLogin: {
      en: grupo.ultimo_login_en,
      ip: grupo.ultimo_login_ip,
      userAgent: grupo.ultimo_login_user_agent
    }
  });
}));

// Restablece la contraseña de un Grupo — el súper-admin fija una NUEVA
// contraseña sin necesitar (ni poder saber) la anterior, ver la nota
// grande de arriba sobre por qué no se puede "ver la clave actual".
router.patch('/grupos/:id/password', asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'La contraseña nueva tiene que tener al menos 4 caracteres.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const r = await db.query(
    'UPDATE grupos SET password_hash = $1 WHERE id = $2 RETURNING id',
    [passwordHash, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.status(204).end();
}));

// Logo del Grupo (01-09-2026, a pedido del usuario, "para que sea algo
// más personalizado") — solo el Súper-admin puede ponerlo/cambiarlo, ver
// la nota grande junto a la columna "logo_url" en sql/schema.sql sobre
// por qué es una URL y no un archivo subido. `logoUrl: ''` (string
// vacío) borra el logo — vuelve a mostrarse el nombre del Grupo solo,
// como hasta ahora.
router.patch('/grupos/:id/logo', asyncHandler(async (req, res) => {
  const { logoUrl } = req.body;
  const valor = (logoUrl || '').trim();
  if (valor && !/^https?:\/\//i.test(valor)) {
    return res.status(400).json({ error: 'El logo tiene que ser una URL que empiece con http:// o https:// (por ejemplo, un link a una imagen ya subida a algún lado). Dejalo vacío para quitar el logo.' });
  }
  const r = await db.query(
    'UPDATE grupos SET logo_url = $1 WHERE id = $2 RETURNING logo_url',
    [valor || null, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ logoUrl: r.rows[0].logo_url });
}));

// "Sábana de muestra" (05-09-2026, a pedido del usuario) — ver la nota
// grande junto a la columna "sabana_muestra" en sql/schema.sql. Es un
// texto libre puramente de referencia/documentación (un mensaje real de
// ejemplo de cómo ESE grupo escribe su sábana), guardado tal cual lo
// pega el Súper-admin — SIN validar formato ni intentar interpretarlo,
// porque justamente el punto es que cada grupo puede escribir distinto.
// Mandar { sabanaMuestra: '' } (o solo espacios) lo borra.
router.patch('/grupos/:id/sabana-muestra', asyncHandler(async (req, res) => {
  const { sabanaMuestra } = req.body;
  const valor = (sabanaMuestra || '').trim();
  const r = await db.query(
    'UPDATE grupos SET sabana_muestra = $1 WHERE id = $2 RETURNING sabana_muestra',
    [valor || null, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ sabanaMuestra: r.rows[0].sabana_muestra });
}));

// =================================================================
// BORRAR JUGADAS/SÁBANA (Y POLLA) POR FECHA (02-09-2026, a pedido del
// usuario) — el Súper-admin elige un grupo, ve la lista de fechas que
// tienen datos, marca las que quiere y las borra. Incluye la Polla de
// esas mismas fechas (a pedido explícito del usuario) pero NO toca
// "alertas" — ver la nota grande en src/services/mantenimientoGrupo.js.
// =================================================================

// Lista las fechas con datos (sábana y/o Polla) de un grupo, para el
// checklist del panel.
router.get('/grupos/:id/fechas-con-datos', asyncHandler(async (req, res) => {
  const fechas = await mantenimientoGrupo.listarFechasConDatos(req.params.id);
  res.json(fechas);
}));

// Borra la sábana + Polla de las fechas elegidas. Body: { fechas: ['2026-08-20', ...] }.
router.post('/grupos/:id/borrar-fechas', asyncHandler(async (req, res) => {
  const { fechas } = req.body;
  if (!Array.isArray(fechas) || fechas.length === 0) {
    return res.status(400).json({ error: 'Elige al menos una fecha para borrar.' });
  }
  const resultado = await mantenimientoGrupo.borrarDatosDeFechas(req.params.id, fechas);
  res.json(resultado);
}));

// =================================================================
// SÁBANA AUTOMÁTICA POR WHATSAPP — servicio contratable aparte
// (04-09-2026, a pedido del usuario: "este servicio sera un plus para
// los grupos que compren el servicio, pueden comprarlo con este
// servicio de whatsapp automatico o, manual como veniamos haciendolo...
// quiero desde super admin poder habilitar esta opcion o no a los
// grupos" y "el codigo para activar el bot con el grupo de whatsaap
// solo lo puede activar, editar o eliminar desde super admin... si lo
// dejamos asi ellos podrian cambiar para que grupo trabaja la
// aplicacion"). Dos cosas separadas, ambas EXCLUSIVAS del Súper-admin
// (el propio Grupo ya no tiene ningún botón para tocar ninguna de las
// dos — ver src/routes/whatsapp.js):
//   - whatsapp_habilitado: el interruptor "este Grupo compró el
//     servicio" (igual espíritu que "activo", sin cobro automático).
//   - whatsapp_grupo_jid: A QUÉ grupo de WhatsApp le apunta el bot para
//     ese cliente — antes lo pegaba el propio Grupo desde su sesión, lo
//     que le hubiera dejado cambiarlo él mismo (riesgo de que apunte el
//     bot a cualquier grupo de WhatsApp que quisiera).
// =================================================================
router.patch('/grupos/:id/whatsapp-habilitado', asyncHandler(async (req, res) => {
  const { habilitado } = req.body;
  const r = await db.query(
    'UPDATE grupos SET whatsapp_habilitado = $1 WHERE id = $2 RETURNING id, whatsapp_habilitado, whatsapp_grupo_jid',
    [!!habilitado, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ whatsappHabilitado: r.rows[0].whatsapp_habilitado, whatsappGrupoJid: r.rows[0].whatsapp_grupo_jid });
}));

// Guarda/cambia/borra el JID del grupo de WhatsApp desde donde se va a
// leer la sábana (se copia del log del servidor la primera vez que el
// bot se conecta con ese número — ver whatsappBot.js). Mandar
// { jid: null } (o vacío) para desvincular.
router.patch('/grupos/:id/whatsapp-jid', asyncHandler(async (req, res) => {
  const { jid } = req.body;
  const valor = (jid || '').trim() || null;
  const r = await db.query(
    'UPDATE grupos SET whatsapp_grupo_jid = $1 WHERE id = $2 RETURNING id, whatsapp_grupo_jid',
    [valor, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ whatsappGrupoJid: r.rows[0].whatsapp_grupo_jid });
}));

// =================================================================
// NÚMERO AUTORIZADO PARA LOS COMANDOS DE CHAT (09-09-2026, a pedido del
// usuario: "los comandos lo puede mandar el mismo que manda el comando
// sabana jugada, pero aparte en super admin yo puedo agregar un numero y
// activarle o desactivarle, la funcion de enviar comandos" — ver la nota
// grande en sql/schema.sql). EXCLUSIVO del Súper-admin, mismo espíritu
// que whatsapp-habilitado/whatsapp-jid de arriba — y a propósito SEPARADO
// de esas 2 rutas: whatsapp-habilitado/whatsapp-jid siguen controlando
// quién puede mandar "SABANA DE JUGADAS" (sin cambios), esto es una
// segunda capa que SOLO le pone un candado a los 4 comandos de chat
// nuevos ("act"/"saldo final"/"corte semana"/"saldo total semana
// <nombre>", ver whatsappBot.estaAutorizadoParaComandos()).
router.patch('/grupos/:id/comandos-habilitado', asyncHandler(async (req, res) => {
  const { habilitado } = req.body;
  const r = await db.query(
    'UPDATE grupos SET comandos_whatsapp_habilitado = $1 WHERE id = $2 RETURNING id, comandos_whatsapp_habilitado, comandos_whatsapp_numero',
    [!!habilitado, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ comandosWhatsappHabilitado: r.rows[0].comandos_whatsapp_habilitado, comandosWhatsappNumero: r.rows[0].comandos_whatsapp_numero });
}));

// Guarda/cambia/borra el número autorizado para los comandos. Mandar
// { numero: null } (o vacío) para desvincular — mismo criterio que
// whatsapp-jid arriba. Se guarda tal cual lo escriba el Súper-admin (con
// o sin "+"/espacios/guiones); la comparación contra el número real de
// WhatsApp del remitente normaliza ambos lados a solo dígitos (ver
// normalizarTelefono()/telefonoDeParticipante() en whatsappTrigger.js).
router.patch('/grupos/:id/comandos-numero', asyncHandler(async (req, res) => {
  const { numero } = req.body;
  const valor = (numero || '').trim() || null;
  const r = await db.query(
    'UPDATE grupos SET comandos_whatsapp_numero = $1 WHERE id = $2 RETURNING id, comandos_whatsapp_numero',
    [valor, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ comandosWhatsappNumero: r.rows[0].comandos_whatsapp_numero });
}));

// =================================================================
// MODELO DE COMISIÓN DEL GRUPO (08-09-2026, a pedido del usuario: "hay
// grupos que manejan de distintas maneras los %... tengo un grupo que el
// % es de lo arriesgado pero por tipo de jugadas... y despues esos
// resultados se suman y dan el total"). EXCLUSIVO del Súper-admin, mismo
// espíritu que whatsapp-habilitado/whatsapp-jid de arriba (el propio
// Grupo no tiene ningún botón para tocar esto).
//
// 'plano' (default): un solo % fijo por cliente (jugadores.comision_propia,
// sin cambios de comportamiento).
// 'por_tipo_jugada': UN solo juego de tiers por GRUPO (no por cliente — el
// usuario confirmó ese alcance) — ver la nota grande en sql/schema.sql y
// comisiones.js para la regla de coincidencia de tiers.
//
// tiers: [{ logros, porcentaje }, ...] — se valida acá que cada entrada
// tenga un "logros" entero positivo y un "porcentaje" numérico, pero NO se
// exige ninguna cantidad fija de tiers (el usuario avisó que más adelante
// puede querer un 4to nivel o más para parleys de 4+ logros).
//
// (09-09-2026, "grupo mixto" — a pedido del usuario: "se puede tener un
// modelo de % en un grupo mixto... clientes que se le regrese % variados
// dependiendo de las patas de las jugadas... o establecerle % fijo") —
// ANTES, guardar `modelo: 'plano'` BORRABA los tiers (los forzaba a []),
// sin importar qué tiers vinieran en el body — esto rompía el modelo
// mixto: un grupo cuyo DEFAULT es 'plano' pero que tiene 1 o más
// jugadores con la excepción individual 'por_tipo_jugada' cargada (ver
// jugadores.modelo_comision en sql/schema.sql) necesita SEGUIR teniendo
// disponible la tabla de niveles del grupo, aunque su modelo default ya
// no sea 'por_tipo_jugada'. Ahora los tiers se validan y se guardan TAL
// CUAL vengan en el body, sin importar `modelo` — la única regla que
// sigue atada al modelo default es "hace falta al menos 1 nivel si el
// modelo DEFAULT del grupo es 'por_tipo_jugada'" (si el default es
// 'plano', los tiers pueden venir vacíos, o con cualquier cantidad, para
// que los use quien tenga la excepción individual cargada).
// =================================================================
router.patch('/grupos/:id/modelo-comision', asyncHandler(async (req, res) => {
  const { modelo, tiers } = req.body;
  if (modelo !== 'plano' && modelo !== 'por_tipo_jugada') {
    return res.status(400).json({ error: 'El modelo tiene que ser "plano" o "por_tipo_jugada".' });
  }
  const listaTiers = Array.isArray(tiers) ? tiers : [];
  if (modelo === 'por_tipo_jugada' && listaTiers.length === 0) {
    return res.status(400).json({ error: 'Para el modelo "por tipo de jugada" hace falta al menos un nivel (logros + %).' });
  }
  const tiersLimpios = [];
  for (const t of listaTiers) {
    const logros = Number(t && t.logros);
    const porcentaje = Number(t && t.porcentaje);
    if (!Number.isInteger(logros) || logros <= 0) {
      return res.status(400).json({ error: 'Cada nivel necesita una cantidad de logros entera y mayor a 0.' });
    }
    if (!Number.isFinite(porcentaje) || porcentaje < 0) {
      return res.status(400).json({ error: 'Cada nivel necesita un porcentaje válido (0 o más).' });
    }
    tiersLimpios.push({ logros, porcentaje });
  }
  const r = await db.query(
    'UPDATE grupos SET modelo_comision = $1, comision_tiers = $2 WHERE id = $3 RETURNING id, modelo_comision, comision_tiers',
    [modelo, JSON.stringify(tiersLimpios), req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ modeloComision: r.rows[0].modelo_comision, comisionTiers: r.rows[0].comision_tiers });
}));

// =================================================================
// TELÉFONOS DE WHATSAPP DEL GRUPO (02-09-2026, a pedido del usuario) —
// solo el Súper-admin puede agregarlos/borrarlos (igual que el logo, ver
// sql/schema.sql). Máximo 3 (ver telefonos.js). El primero cargado es el
// que usa el botón "Tengo diferencia" del Cliente.
// =================================================================
router.get('/grupos/:id/telefonos', asyncHandler(async (req, res) => {
  const telefonos = await telefonosService.listarTelefonos(req.params.id);
  res.json(telefonos);
}));

router.post('/grupos/:id/telefonos', asyncHandler(async (req, res) => {
  try {
    const { telefono, apodo } = req.body;
    const nuevo = await telefonosService.agregarTelefono(req.params.id, telefono, apodo);
    res.status(201).json(nuevo);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo agregar el teléfono.' });
  }
}));

router.delete('/grupos/:id/telefonos/:telId', asyncHandler(async (req, res) => {
  await telefonosService.eliminarTelefono(req.params.id, req.params.telId);
  res.status(204).end();
}));

// =================================================================
// EQUIPOS_GLOBALES — diccionario "capa del medio": apodos que vos vas
// promoviendo para que los usen TODOS los grupos (no solo el que lo pidió
// primero). Ver la nota grande en sql/schema.sql y en
// src/services/diccionarioEquipos.js para el orden de capas completo.
// =================================================================

// Lista todos los apodos globales.
router.get('/equipos-globales', asyncHandler(async (req, res) => {
  const r = await db.query(
    'SELECT id, apodo, nombre_oficial, deporte FROM equipos_globales ORDER BY apodo'
  );
  res.json(r.rows);
}));

// Crea (o actualiza, si el apodo ya existía) un apodo global.
router.post('/equipos-globales', asyncHandler(async (req, res) => {
  const { apodo, nombreOficial, deporte } = req.body;
  if (!apodo || !apodo.trim() || !nombreOficial || !nombreOficial.trim()) {
    return res.status(400).json({ error: 'Ingresa tanto el apodo como el nombre oficial.' });
  }
  const r = await db.query(
    `INSERT INTO equipos_globales (apodo, nombre_oficial, deporte)
     VALUES ($1, $2, $3)
     ON CONFLICT (apodo) DO UPDATE SET nombre_oficial = EXCLUDED.nombre_oficial, deporte = EXCLUDED.deporte
     RETURNING id, apodo, nombre_oficial, deporte`,
    [apodo.trim().toLowerCase(), nombreOficial.trim(), deporte || 'mlb']
  );
  res.status(201).json(r.rows[0]);
}));

// Borra un apodo global (deja de valer para todos los grupos; cada grupo
// que lo tuviera además como personalizado no se ve afectado).
router.delete('/equipos-globales/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM equipos_globales WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// =================================================================
// ALERTAS (de TODOS los grupos) — ver alertas.js y el comentario grande
// de resoluciones_ambiguas/alertas en sql/schema.sql. Es la misma tabla
// que ve cada Grupo en la suya (src/routes/sabana.js), solo que acá
// vienen todas juntas con el nombre del grupo de cada una.
// =================================================================
router.get('/alertas', asyncHandler(async (req, res) => {
  const alertas = await alertasService.listarAlertasTodas();
  res.json(alertas);
}));

router.get('/alertas/conteo-no-leidas', asyncHandler(async (req, res) => {
  const total = await alertasService.contarNoLeidasSuperadmin();
  res.json({ total });
}));

router.post('/alertas/marcar-leidas', asyncHandler(async (req, res) => {
  await alertasService.marcarLeidasSuperadmin();
  res.status(204).end();
}));

router.post('/alertas/:id/resolver', asyncHandler(async (req, res) => {
  const { deporte } = req.body;
  if (!deporte || !deporte.trim()) {
    return res.status(400).json({ error: 'Elige un deporte antes de resolver la alerta.' });
  }
  try {
    const resultado = await alertasService.resolverAlerta(req.params.id, deporte.trim());
    res.json({ ok: true, grupoId: resultado.grupoId });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo resolver la alerta.' });
  }
}));

// Descarta una alerta que no tiene deporte para elegir (ej. tipo
// SIN_LOGRO, 28-08-2026) — ver alertas.js y el mismo comentario en
// src/routes/sabana.js.
router.post('/alertas/:id/descartar', asyncHandler(async (req, res) => {
  try {
    const resultado = await alertasService.descartarAlerta(req.params.id);
    res.json({ ok: true, grupoId: resultado.grupoId });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo descartar la alerta.' });
  }
}));

// =================================================================
// CHAT DE SOPORTE (con TODOS los grupos) — ver chat.js. El Súper-admin
// primero ve la lista de conversaciones (una por grupo con actividad) y
// después entra a la de un grupo puntual para leer/responder.
// =================================================================
router.get('/chat/conversaciones', asyncHandler(async (req, res) => {
  const conversaciones = await chatService.listarConversaciones();
  res.json(conversaciones);
}));

router.get('/chat/conteo-no-leidos', asyncHandler(async (req, res) => {
  const total = await chatService.contarNoLeidosSuperadminTotal();
  res.json({ total });
}));

router.get('/chat/:grupoId', asyncHandler(async (req, res) => {
  const mensajes = await chatService.listarMensajes(req.params.grupoId);
  res.json(mensajes);
}));

router.post('/chat/:grupoId', asyncHandler(async (req, res) => {
  try {
    const mensaje = await chatService.enviarMensaje(req.params.grupoId, 'superadmin', req.body.texto);
    res.status(201).json(mensaje);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo enviar el mensaje.' });
  }
}));

router.post('/chat/:grupoId/marcar-leidos', asyncHandler(async (req, res) => {
  await chatService.marcarLeidosSuperadmin(req.params.grupoId);
  res.status(204).end();
}));

module.exports = router;
