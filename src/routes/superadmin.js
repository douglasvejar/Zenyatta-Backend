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
// 19-09-2026, a pedido del usuario: "quiero desde super admin pulsar el
// grupo y poder ver, balances del grupo detallado por clientes y sus
// saldos, tambien sus sabanas" — obtenerSabanaDeFecha() ya es 100%
// genérica (recibe el grupoId como parámetro, nunca depende de una
// sesión de Grupo), así que se puede llamar directo desde acá para
// reconstruir la sábana de CUALQUIER grupo, de solo lectura (sin el
// botón "✏️ Editar" que sí tiene el propio panel del Grupo — para editar
// un ticket, hay que entrar como ese Grupo).
const { obtenerSabanaDeFecha } = require('../services/sabanaDia');
// "⬇️ Descargar" (21-09-2026, mismo pedido de arriba, extendido a la
// pestaña nueva "Saldos Semana" del propio panel del Grupo — ver
// routes/descargas.js): se reusa la MISMA función que arma ese reporte,
// solo que acá el grupo lo elige el Súper-admin por :id de la URL.
const { construirSaldosSemana } = require('../services/saldosSemana');

const router = express.Router();
router.use(requiereSuperadmin);

// Lista todos los grupos (para ver cuáles están activos/inactivos).
router.get('/grupos', asyncHandler(async (req, res) => {
  const r = await db.query('SELECT id, nombre, email, activo, creado_en FROM grupos ORDER BY creado_en DESC');
  res.json(r.rows);
}));

// Crea un grupo nuevo. Queda INACTIVO por defecto — tú lo activas aparte
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

// Elimina un Grupo POR COMPLETO — 18-09-2026, a pedido del usuario ("no
// tengo la opcion de eliminar grupos"). Hasta ahora solo existía
// "Activar/Desactivar" (el interruptor manual de arriba), que apaga el
// acceso pero deja todos los datos guardados — esto en cambio BORRA de
// verdad al Grupo y todo lo que le pertenece, sin vuelta atrás.
//
// No hace falta borrar tabla por tabla a mano: TODAS las tablas que
// cuelgan de un grupo_id (jugadores, empleados, tickets_historial,
// transferencias, polla_historial, equipos_personalizados, alertas,
// mensajes_chat, pagos_grupo, grupo_telefonos, etc. — ver sql/schema.sql)
// ya están declaradas con "references grupos(id) on delete cascade", así
// que un solo DELETE acá arrastra todo, atómico, del lado de Postgres.
// La única tabla que NO cuelga de un grupo (mensajes_contacto, del
// formulario público del portal) no tiene grupo_id y por lo tanto no se
// toca. El frontend (superadmin.html) exige escribir el nombre exacto del
// grupo antes de habilitar este botón, porque no hay ningún "deshacer".
router.delete('/grupos/:id', asyncHandler(async (req, res) => {
  const r = await db.query('DELETE FROM grupos WHERE id = $1 RETURNING id, nombre', [req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ eliminado: true, id: r.rows[0].id, nombre: r.rows[0].nombre });
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
    `SELECT id, nombre, email, activo, creado_en, ultimo_login_en, ultimo_login_ip, ultimo_login_user_agent, logo_url, whatsapp_habilitado, whatsapp_grupo_jid, sabana_muestra, comandos_whatsapp_habilitado, comandos_whatsapp_numero, modulo_deportes_habilitado, modulo_hipismo_habilitado
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
    // (22-09-2026, a pedido del usuario) qué producto(s) tiene contratados
    // este grupo — ver la nota grande junto a estas 2 columnas en
    // sql/schema.sql y claude/plan-modulo-hipismo.md. Exclusivo del
    // Súper-admin, igual que whatsappHabilitado arriba.
    moduloDeportesHabilitado: grupo.modulo_deportes_habilitado,
    moduloHipismoHabilitado: grupo.modulo_hipismo_habilitado,
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

// Mismo helper que ya usa routes/reportes.js (agruparNombresPorMoneda)
// para "moneda del grupo" en modo 'mixto' — se duplica acá, chiquito a
// propósito, en vez de importar entre routers (cada archivo de rutas de
// este proyecto se mantiene con sus propios imports de /services, sin
// depender de otro router).
function agruparNombresPorMonedaSuperadmin(jugadores) {
  const usd = new Set();
  const bs = new Set();
  (jugadores || []).forEach(j => (j.moneda === 'BS' ? bs : usd).add(j.nombre));
  return { usd, bs };
}

// =================================================================
// BALANCE GENERAL POR CLIENTE, para CUALQUIER grupo (19-09-2026, a
// pedido del usuario — ver la nota grande junto al import de
// obtenerSabanaDeFecha más arriba). Mismo cálculo EXACTO que ya usa el
// propio panel del Grupo en Administración > Balance General
// (routes/reportes.js, GET /balance-general) — se reusa
// calcularBalanceGeneral() tal cual, solo que acá el grupo lo elige el
// Súper-admin por :id de la URL en vez de salir del token de sesión
// (requiereGrupo). Mismo manejo de rango que /grupos/:id/detalle de
// arriba (?desde&hasta, o ?rango=hoy|semana|mes|todo, default "semana").
// Respeta "moneda del grupo" (USD/Bs/Mixto) devolviendo 2 bloques
// (USD/BS) cuando el grupo está en modo 'mixto', igual que el panel del
// propio Grupo.
// =================================================================
router.get('/grupos/:id/balance-clientes', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const grupoRes = await db.query('SELECT id, moneda_modo FROM grupos WHERE id = $1', [id]);
  if (grupoRes.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  const monedaModo = grupoRes.rows[0].moneda_modo || 'usd';

  let desde = req.query.desde;
  let hasta = req.query.hasta;
  if (!desde && !hasta) {
    const rango = await calcularRangoRapido(id, req.query.rango || 'semana');
    desde = rango.desde;
    hasta = rango.hasta;
  }

  const config = await cargarConfigGrupo(id);
  const configComision = { modelo: config.modeloComision, tiers: config.tiersComision, modelosPorCliente: config.modelosComisionPorCliente };

  if (monedaModo === 'mixto') {
    const { usd, bs } = agruparNombresPorMonedaSuperadmin(config.jugadores);
    const [resultadoUSD, resultadoBS] = await Promise.all([
      calcularBalanceGeneral(id, desde, hasta, config.porcentajesPropios, config.avalesMap, configComision, usd),
      calcularBalanceGeneral(id, desde, hasta, config.porcentajesPropios, config.avalesMap, configComision, bs)
    ]);
    return res.json({ mixto: true, rango: { desde, hasta }, USD: resultadoUSD, BS: resultadoBS });
  }

  const resultado = await calcularBalanceGeneral(id, desde, hasta, config.porcentajesPropios, config.avalesMap, configComision);
  res.json({ mixto: false, moneda: monedaModo.toUpperCase(), rango: { desde, hasta }, ...resultado });
}));

// =================================================================
// "📅 Saldos Semana", para CUALQUIER grupo (21-09-2026, a pedido del
// usuario: "esto se puede usar tanto del grupo como desde super admin"):
// mismo reporte semanal cliente-por-cliente/día-por-día que ve el propio
// Grupo en su pestaña "⬇️ Descargar" (routes/descargas.js) — se reusa
// construirSaldosSemana() tal cual, solo que acá el grupo lo elige el
// Súper-admin por :id de la URL en vez de salir del token de sesión.
// ?fecha=YYYY-MM-DD opcional (cualquier día dentro de la semana que se
// quiere ver — mismas flechitas "◀ Semana anterior"/"Semana siguiente ▶"
// que en el panel del Grupo); sin ella, la semana actual.
// =================================================================
router.get('/grupos/:id/saldos-semana', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const grupoRes = await db.query('SELECT id, nombre, logo_url FROM grupos WHERE id = $1', [id]);
  const grupo = grupoRes.rows[0];
  if (!grupo) return res.status(404).json({ error: 'Grupo no encontrado.' });

  const datos = await construirSaldosSemana(id, grupo.nombre, grupo.logo_url, req.query.fecha);
  res.json(datos);
}));

// =================================================================
// SÁBANA DE UN DÍA PUNTUAL, para CUALQUIER grupo (19-09-2026, mismo
// pedido de arriba). obtenerSabanaDeFecha() ya es 100% genérica (ver el
// import arriba) — se llama directo con el :id de la URL. Devuelve
// exactamente lo mismo que ve el propio Grupo en su pestaña "📁 Sábanas"
// (tickets con su detalle/estado, resumen por cliente, juegos de esa
// fecha), pero de SOLO LECTURA: esta ruta no tiene un PUT para editar
// tickets — esa edición sigue siendo exclusiva del propio panel del
// Grupo (routes/sabana.js, PUT /tickets/:id, con su propio permiso
// 'sabanas' por empleado).
// =================================================================
router.get('/grupos/:id/sabana-dia', asyncHandler(async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: 'Falta la fecha (YYYY-MM-DD).' });
  const resultado = await obtenerSabanaDeFecha(req.params.id, fecha);
  res.json(resultado);
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
    return res.status(400).json({ error: 'El logo tiene que ser una URL que empiece con http:// o https:// (por ejemplo, un link a una imagen ya subida a algún lado). Déjalo vacío para quitar el logo.' });
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

// =================================================================
// MÓDULOS CONTRATADOS — Deportes / Hipismo (22-09-2026, a pedido del
// usuario: "donde le coloco si el grupo tiene deportes o hipismo? a los
// grupos que ya estan creados se le puede colocar?"). Ver la nota grande
// junto a estas 2 columnas en sql/schema.sql y el plan de arquitectura en
// claude/plan-modulo-hipismo.md. Mismo espíritu que whatsapp-habilitado
// arriba: interruptor manual, EXCLUSIVO del Súper-admin (el propio Grupo
// no tiene ningún botón para tocar ninguno de los 2) — se puede prender o
// apagar en cualquier momento, tanto en un grupo nuevo como en uno que ya
// existe desde antes de que existiera Hipismo.
//
// A propósito 2 rutas separadas (una por módulo) en vez de una sola que
// reciba los 2 a la vez, mismo criterio que whatsapp-habilitado /
// comandos-whatsapp-habilitado: cada interruptor se prende o apaga solo,
// sin depender del estado del otro. No se valida que quede al menos uno
// prendido — un grupo con los 2 en false simplemente no tiene ningún
// producto activo (por ejemplo, mientras se le da de baja o se renegocia
// el contrato), sin que eso rompa nada del resto del sistema.
router.patch('/grupos/:id/modulo-deportes', asyncHandler(async (req, res) => {
  const { habilitado } = req.body;
  const r = await db.query(
    'UPDATE grupos SET modulo_deportes_habilitado = $1 WHERE id = $2 RETURNING id, modulo_deportes_habilitado',
    [!!habilitado, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ moduloDeportesHabilitado: r.rows[0].modulo_deportes_habilitado });
}));

router.patch('/grupos/:id/modulo-hipismo', asyncHandler(async (req, res) => {
  const { habilitado } = req.body;
  const r = await db.query(
    'UPDATE grupos SET modulo_hipismo_habilitado = $1 WHERE id = $2 RETURNING id, modulo_hipismo_habilitado',
    [!!habilitado, req.params.id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
  res.json({ moduloHipismoHabilitado: r.rows[0].modulo_hipismo_habilitado });
}));

// (18-09-2026) Acá vivía PATCH /grupos/:id/whatsapp-modo-cuidadoso — el
// interruptor OPCIONAL de "modo cuidadoso". Se sacó por pedido explícito
// del usuario: el comportamiento cuidadoso (el bot nunca manda nada al
// grupo por su cuenta) ahora es el ÚNICO comportamiento, para todos los
// grupos, sin ningún interruptor — ver la advertencia grande al
// principio de whatsappBot.js.

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
// VER EL CÓDIGO QR COMO IMAGEN DE VERDAD (15-09-2026, bug real visto en
// vivo desplegando en Railway: el dibujo del QR en texto (ASCII, ver
// whatsappBot.js) se rompe en la pantalla de logs de Railway — las
// líneas son más angostas que el dibujo y se cortan/pasan de renglón,
// dejando un QR ilegible para la cámara del teléfono. En vez de depender
// de que el visor de logs del hosting renderice bien texto ancho, estas
// 2 rutas exponen el mismo código QR (el string crudo que ya guarda
// whatsappBot.estadoConexion.ultimoQr) como una imagen PNG de verdad,
// dibujada acá mismo con la librería `qrcode` (una de dibujo — 100%
// distinta de `qrcode-terminal`, la de texto que ya se usaba).
// =================================================================
router.get('/whatsapp-estado', asyncHandler(async (req, res) => {
  const { obtenerEstadoConexion } = require('../services/whatsappBot');
  const estado = obtenerEstadoConexion();
  res.json({
    conectado: estado.conectado,
    tieneQr: !!estado.ultimoQr,
    ultimoError: estado.ultimoError,
    // (15-09-2026, a pedido del usuario tras reportar "la sábana
    // automática no se envía por WhatsApp") — el último intento de
    // MANDAR un mensaje al grupo que falló (distinto de ultimoError, que
    // es sobre la CONEXIÓN) — ver el comentario grande en
    // whatsappBot.avisar(). null si el último envío salió bien o todavía
    // no se intentó ninguno.
    ultimoErrorEnvio: estado.ultimoErrorEnvio || null,
    // alertaActiva/alertaDesdeEn (18-09-2026, "alerta si se cae la
    // sesión de WhatsApp") — el panel (superadmin.html) los consulta
    // desde CUALQUIER pantalla (no solo la de vincular) para mostrar un
    // aviso fijo mientras esto sea true, ver la nota grande en
    // whatsappBot.js.
    alertaActiva: !!estado.alertaActiva,
    alertaDesdeEn: estado.alertaDesdeEn || null
  });
}));

// Botón "🔍 Diagnosticar quién traba el envío" (16-09-2026, a partir del
// detalle real del error "not-acceptable" que el usuario copió y pasó):
// ese error viene de un paso de Baileys que junta a TODOS los
// participantes de un grupo en un solo pedido — si UNO SOLO falla (se
// borró de WhatsApp, bloqueó este número, etc.) el envío ENTERO se cae
// para ese grupo. Prueba a cada participante uno por uno para señalar
// cuál(es) número(s) son el problema — ver
// whatsappBot.diagnosticarSesionesGrupo(). A diferencia de la versión de
// /api/whatsapp (grupo.html, que ya sabe a qué grupo de WhatsApp
// pertenece), Súper-admin ve a TODOS los clientes, así que el jid a
// diagnosticar llega por body — normalmente el mismo
// estadoBot.ultimoErrorEnvio.jid que ya se muestra en la caja de arriba.
router.post('/whatsapp-diagnosticar-sesiones', asyncHandler(async (req, res) => {
  const jid = req.body && req.body.jid;
  if (!jid) {
    return res.status(400).json({ error: 'Falta el jid del grupo de WhatsApp a diagnosticar.' });
  }
  const { obtenerSockActivo, diagnosticarSesionesGrupo } = require('../services/whatsappBot');
  const sock = obtenerSockActivo();
  if (!sock) {
    return res.status(409).json({ error: 'El bot no está conectado a WhatsApp en este momento (revisa el QR/la conexión).' });
  }
  const resultado = await diagnosticarSesionesGrupo(sock, jid);
  res.json(resultado);
}));

router.get('/whatsapp-qr.png', asyncHandler(async (req, res) => {
  const { obtenerEstadoConexion } = require('../services/whatsappBot');
  const estado = obtenerEstadoConexion();
  if (!estado.ultimoQr) {
    return res.status(404).json({ error: estado.conectado ? 'El WhatsApp ya está vinculado, no hay ningún QR pendiente.' : 'Todavía no llegó ningún código QR — espera unos segundos y vuelve a pedirlo.' });
  }
  const QRCode = require('qrcode');
  const buffer = await QRCode.toBuffer(estado.ultimoQr, { type: 'png', width: 320, margin: 2 });
  res.set('Cache-Control', 'no-store');
  res.type('png').send(buffer);
}));

// =================================================================
// GRUPOS DE WHATSAPP DISPONIBLES, PARA ELEGIR EN VEZ DE PEGAR EL JID A
// MANO (15-09-2026, bug real reportado en vivo: "la sábana automática no
// está funcionando" — la causa era que no había forma de conseguir el
// JID del grupo de WhatsApp del cliente sin ir a buscarlo en los logs de
// Railway, el mismo problema que ya se había resuelto para el QR). Estas
// 2 rutas exponen la lista de grupos a los que pertenece el número
// vinculado (whatsappBot.estadoConexion.gruposDisponibles) para que
// Súper-admin la muestre como un desplegable con el NOMBRE del grupo de
// WhatsApp — el JID sigue siendo el que se guarda, pero el usuario ya no
// tiene que copiarlo/pegarlo a mano.
// =================================================================
router.get('/whatsapp-grupos-disponibles', asyncHandler(async (req, res) => {
  const { obtenerEstadoConexion } = require('../services/whatsappBot');
  const estado = obtenerEstadoConexion();
  res.json({ conectado: estado.conectado, grupos: estado.gruposDisponibles || [] });
}));

// Le vuelve a preguntar a WhatsApp AHORA MISMO (en vez de esperar a la
// próxima reconexión del bot) — hace falta cuando el número se agrega a
// un grupo de WhatsApp nuevo DESPUÉS de que el bot ya estaba conectado
// (ver el comentario grande en whatsappBot.refrescarGruposDisponibles).
router.post('/whatsapp-grupos-disponibles/refrescar', asyncHandler(async (req, res) => {
  const { refrescarGruposDisponibles } = require('../services/whatsappBot');
  try {
    const grupos = await refrescarGruposDisponibles();
    res.json({ grupos });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
}));

// "Olvidar" la sesión guardada y generar un QR nuevo (15-09-2026, a
// pedido del usuario tras el error "No sessions" al mandar mensajes) —
// ver el comentario grande en whatsappBot.olvidarSesionWhatsapp(). Único
// botón "destructivo" de este panel: desvincula el número de WhatsApp
// (hay que volver a escanear el QR) para los 2 casos en que hace falta
// empezar de cero: la sesión quedó corrupta (síntoma: "No sessions" al
// mandar, aunque LEER mensajes funcione bien) o simplemente se perdió el
// vínculo y no hay forma de recuperarlo de otra manera.
router.post('/whatsapp-olvidar-sesion', asyncHandler(async (req, res) => {
  const { olvidarSesionWhatsapp } = require('../services/whatsappBot');
  await olvidarSesionWhatsapp();
  res.json({ ok: true });
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
// EQUIPOS_GLOBALES — diccionario "capa del medio": apodos que tú vas
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
// MENSAJES DE CONTACTO (15-09-2026): bandeja de lo que llega por el
// formulario "Contacto" del portal de bienvenida (public/index.html) —
// la ruta que los RECIBE es pública, sin login (POST /api/contacto, ver
// routes/contacto.js); estas de acá, protegidas por requiereSuperadmin
// (arriba del archivo), son las que los LEEN.
// =================================================================
router.get('/mensajes-contacto', asyncHandler(async (req, res) => {
  const r = await db.query(
    'SELECT id, nombre, contacto, mensaje, leido, creado_en FROM mensajes_contacto ORDER BY creado_en DESC LIMIT 200'
  );
  res.json(r.rows);
}));

router.get('/mensajes-contacto/conteo-no-leidos', asyncHandler(async (req, res) => {
  const r = await db.query('SELECT COUNT(*)::int AS total FROM mensajes_contacto WHERE leido = false');
  res.json({ total: r.rows[0].total });
}));

router.post('/mensajes-contacto/:id/marcar-leido', asyncHandler(async (req, res) => {
  await db.query('UPDATE mensajes_contacto SET leido = true WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

router.delete('/mensajes-contacto/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM mensajes_contacto WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// =================================================================
// PAGOS DEL GRUPO A LUDOX (15-09-2026) — bandeja donde Súper-admin
// revisa lo que cada Grupo reporta como pago de su SUSCRIPCIÓN
// semanal a la plataforma (ver la nota grande en sql/schema.sql,
// tabla pagos_grupo, y src/routes/pagos.js donde el Grupo las manda).
// Nada de esto toca saldos/tickets/Balance General de ningún Grupo —
// es un flujo de revisión completamente aparte.
// =================================================================
router.get('/pagos', asyncHandler(async (req, res) => {
  // JOIN con grupos solo para mostrar el nombre — la lista sigue sin
  // traer captura_base64 (se pide aparte, ver GET /pagos/:id/captura).
  const r = await db.query(
    `SELECT p.id, p.grupo_id, g.nombre AS grupo_nombre, p.fecha_pago, p.metodo, p.referencia,
            p.estado, p.nota_admin, p.creado_en, p.revisado_en
     FROM pagos_grupo p
     JOIN grupos g ON g.id = p.grupo_id
     ORDER BY p.creado_en DESC LIMIT 200`
  );
  res.json(r.rows);
}));

router.get('/pagos/:id/captura', asyncHandler(async (req, res) => {
  const r = await db.query('SELECT captura_base64, captura_mime FROM pagos_grupo WHERE id = $1', [req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'No se encontró esa captura.' });
  const fila = r.rows[0];
  res.set('Content-Type', fila.captura_mime);
  res.send(Buffer.from(fila.captura_base64, 'base64'));
}));

router.get('/pagos/conteo-pendientes', asyncHandler(async (req, res) => {
  const r = await db.query("SELECT COUNT(*)::int AS total FROM pagos_grupo WHERE estado = 'pendiente'");
  res.json({ total: r.rows[0].total });
}));

router.post('/pagos/:id/confirmar', asyncHandler(async (req, res) => {
  const { notaAdmin } = req.body || {};
  const r = await db.query(
    "UPDATE pagos_grupo SET estado = 'confirmado', nota_admin = $1, revisado_en = now() WHERE id = $2",
    [notaAdmin ? String(notaAdmin).trim().slice(0, 1000) : null, req.params.id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'No se encontró ese pago.' });
  res.status(204).end();
}));

router.post('/pagos/:id/rechazar', asyncHandler(async (req, res) => {
  // A propósito NO se exige notaAdmin acá — Súper-admin puede rechazar
  // sin nota y avisar el motivo después por WhatsApp/chat (ver el
  // comentario en sql/schema.sql, columna nota_admin).
  const { notaAdmin } = req.body || {};
  const r = await db.query(
    "UPDATE pagos_grupo SET estado = 'rechazado', nota_admin = $1, revisado_en = now() WHERE id = $2",
    [notaAdmin ? String(notaAdmin).trim().slice(0, 1000) : null, req.params.id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'No se encontró ese pago.' });
  res.status(204).end();
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
