// =================================================================
// ESTADO DE CADA DÍA PARA EL BOT DE WHATSAPP (03-09-2026, más tarde
// todavía, a pedido del usuario: "que la nueva sabana que se envie
// sustituya la vieja... el programa envie la sabana a medida de que se
// vaya teniendo resultados... al enviar sabana final... enviar la
// sabana y despues otro mensaje con todos los totales del dia").
//
// Capa de base de datos, sin saber nada de WhatsApp/Baileys ni de
// procesarSabana() — solo lee/escribe la tabla whatsapp_dia_estado (ver
// la nota grande en sql/schema.sql). La DECISIÓN de qué hacer con este
// estado (esperar / mandar actualización / cerrar el día) vive aparte,
// en whatsappResumenDia.js, para poder probarla sin base de datos.
const db = require('./../db');

function mapFila(r) {
  if (!r) return null;
  return {
    grupoId: r.grupo_id,
    fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha,
    ultimoTexto: r.ultimo_texto,
    ultimoTextoEn: r.ultimo_texto_en,
    sabanaFinalEn: r.sabana_final_en,
    ultimaVerificacionEn: r.ultima_verificacion_en,
    ultimoEnvioResumenEn: r.ultimo_envio_resumen_en,
    ultimoHashResumen: r.ultimo_hash_resumen,
    cierreEnviadoEn: r.cierre_enviado_en
  };
}

const COLUMNAS = 'grupo_id, fecha, ultimo_texto, ultimo_texto_en, sabana_final_en, ultima_verificacion_en, ultimo_envio_resumen_en, ultimo_hash_resumen, cierre_enviado_en';

async function obtenerEstadoDia(grupoId, fecha) {
  const res = await db.query(
    `SELECT ${COLUMNAS} FROM whatsapp_dia_estado WHERE grupo_id = $1 AND fecha = $2`,
    [grupoId, fecha]
  );
  return mapFila(res.rows[0]);
}

// Guarda el texto de la sábana que se acaba de auto-importar como "la
// última" de ese día (grupo_id + fecha) — es lo que el reloj de cada
// hora vuelve a reprocesar contra resultados en vivo. Upsert: crea la
// fila si es la primera sábana del día, o actualiza el texto si ya
// existía (sin tocar sabana_final_en/cierre_enviado_en/etc, que son de
// otras partes del flujo).
async function registrarTextoRecibido(grupoId, fecha, texto) {
  const res = await db.query(
    `INSERT INTO whatsapp_dia_estado (grupo_id, fecha, ultimo_texto, ultimo_texto_en)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (grupo_id, fecha) DO UPDATE SET ultimo_texto = EXCLUDED.ultimo_texto, ultimo_texto_en = now()
     RETURNING ${COLUMNAS}`,
    [grupoId, fecha, texto]
  );
  return mapFila(res.rows[0]);
}

// Marca que llegó "SABANA FINAL" para este día — idempotente: si ya
// estaba marcado, NO pisa el timestamp original (para que "cuándo llegó
// el cierre" siga siendo el de la primera vez), y devuelve
// `yaEstabaCerrado: true` para que quien llama sepa que es un duplicado
// (y pueda avisar en el grupo en vez de tratarlo como algo nuevo).
async function marcarSabanaFinalRecibida(grupoId, fecha) {
  const existente = await obtenerEstadoDia(grupoId, fecha);
  if (existente && existente.sabanaFinalEn) {
    return { estado: existente, yaEstabaCerrado: true };
  }
  const res = await db.query(
    `INSERT INTO whatsapp_dia_estado (grupo_id, fecha, sabana_final_en)
     VALUES ($1, $2, now())
     ON CONFLICT (grupo_id, fecha) DO UPDATE SET sabana_final_en = COALESCE(whatsapp_dia_estado.sabana_final_en, now())
     RETURNING ${COLUMNAS}`,
    [grupoId, fecha]
  );
  return { estado: mapFila(res.rows[0]), yaEstabaCerrado: false };
}

async function registrarVerificacion(grupoId, fecha) {
  await db.query(
    `UPDATE whatsapp_dia_estado SET ultima_verificacion_en = now() WHERE grupo_id = $1 AND fecha = $2`,
    [grupoId, fecha]
  );
}

async function registrarEnvioResumen(grupoId, fecha, hash) {
  await db.query(
    `UPDATE whatsapp_dia_estado SET ultimo_envio_resumen_en = now(), ultimo_hash_resumen = $3 WHERE grupo_id = $1 AND fecha = $2`,
    [grupoId, fecha, hash]
  );
}

async function marcarCierreEnviado(grupoId, fecha) {
  await db.query(
    `UPDATE whatsapp_dia_estado SET cierre_enviado_en = now() WHERE grupo_id = $1 AND fecha = $2`,
    [grupoId, fecha]
  );
}

const COLUMNAS_W = 'w.grupo_id, w.fecha, w.ultimo_texto, w.ultimo_texto_en, w.sabana_final_en, w.ultima_verificacion_en, w.ultimo_envio_resumen_en, w.ultimo_hash_resumen, w.cierre_enviado_en';

// (18-09-2026) Acá vivía listarDiasAbiertos() — la consulta que el
// "reloj de fondo" de whatsappBot.js usaba para recorrer TODOS los
// grupos y decidir si a algún día le tocaba un envío automático. Se sacó
// entera junto con el reloj de fondo (ver la advertencia grande al
// principio de whatsappBot.js: el usuario pidió sacar por completo el
// envío automático, no solo apagarlo con un interruptor) — ya no tenía
// ningún otro llamador. Si hace falta retomar un envío automático algún
// día, está en el historial de git de este archivo.

// Días de UN grupo puntual (abiertos Y ya cerrados, por defecto última
// semana) — lo que usa el panel del Grupo para mostrar el estado de sus
// propios días recientes (candado sí/no, última verificación, último
// envío) sin depender de que el bot esté activado ahora mismo.
async function listarDiasDelGrupo(grupoId, diasHaciaAtras = 7) {
  const res = await db.query(
    `SELECT ${COLUMNAS} FROM whatsapp_dia_estado
     WHERE grupo_id = $1 AND fecha >= (CURRENT_DATE - ($2 || ' days')::interval)
     ORDER BY fecha DESC`,
    [grupoId, diasHaciaAtras]
  );
  return res.rows.map(mapFila);
}

// =================================================================
// (04-09-2026, a pedido del usuario: "tengo un ticket abierto el dia 4 lo
// elimino desde super admin o desde el grupo y me vuelve a aparecer el
// ticket") — LA CAUSA: borrar la sábana de un día (papeleraSabana.js del
// lado del Grupo, o mantenimientoGrupo.js del lado de Súper-admin) SOLO
// borraba tickets_historial/polla_historial — nunca esta tabla
// (whatsapp_dia_estado). Si esa fecha había llegado por WhatsApp, el
// texto original se quedaba guardado acá (`ultimo_texto`), y el refresco
// del panel cada 25s (GET /dias/:fecha/resumen) lo volvía a reprocesar
// solo — "resucitando" el ticket recién borrado, sin que nadie mandara
// nada de nuevo por WhatsApp. (En su momento, el ahora-eliminado reloj de
// fondo del bot tenía el mismo problema — ver la advertencia grande en
// whatsappBot.js sobre por qué se sacó el 18-09-2026.)
//
// El arreglo: borrar la sábana de un día completo TAMBIÉN borra esta
// fila (grupo_id + fecha) — así el día queda como si esa fecha nunca
// hubiera recibido nada por WhatsApp: el panel deja de reprocesarlo, y si
// el candado de "SABANA FINAL" ya
// estaba puesto, también se libera (si más adelante llega una sábana
// nueva de verdad para esa fecha, se acepta como si fuera la primera).
// Si esa fecha nunca tuvo ninguna sábana por WhatsApp, este DELETE
// simplemente no encuentra nada y no hace nada.
// =================================================================
async function eliminarEstadoDia(grupoId, fecha) {
  await db.query('DELETE FROM whatsapp_dia_estado WHERE grupo_id = $1 AND fecha = $2', [grupoId, fecha]);
}

// =================================================================
// CIERRE NOCTURNO (08-10-2026) — columna aparte whatsapp_dia_estado.cierre_nocturno_en. A propósito
// NO está en COLUMNAS/mapFila: así, si todavía no se corrió el SQL que la crea, solo falla el cierre
// nocturno y no el resto del bot.
// =================================================================
// Días con sábana de esa fecha, de los grupos con Telegram activo, en orden por nombre de grupo.
async function listarDiasParaCierreNocturno(fecha) {
  const res = await db.query(
    `SELECT w.grupo_id, g.nombre, w.cierre_nocturno_en
       FROM whatsapp_dia_estado w
       JOIN grupos g ON g.id = w.grupo_id
      WHERE w.fecha = $1 AND w.ultimo_texto IS NOT NULL AND g.activo = true AND g.telegram_habilitado = true
      ORDER BY lower(g.nombre), g.nombre`,
    [fecha]
  );
  return res.rows.map(r => ({ grupoId: r.grupo_id, nombre: r.nombre, cerrado: !!r.cierre_nocturno_en }));
}

// "Reclama" el cierre de ese día: devuelve true SOLO a quien lo reclamó primero (UPDATE atómico).
async function reclamarCierreNocturno(grupoId, fecha) {
  const res = await db.query(
    `UPDATE whatsapp_dia_estado SET cierre_nocturno_en = now()
      WHERE grupo_id = $1 AND fecha = $2 AND cierre_nocturno_en IS NULL
      RETURNING grupo_id`,
    [grupoId, fecha]
  );
  return res.rows.length > 0;
}

// Mensaje final "todos los grupos resueltos": se manda UNA vez por día. Se guarda en
// whatsapp_dia_estado.cierre_final_enviado_en (sobrevive a reinicios del servidor). Si esa columna
// todavía no existe, se apoya en la memoria del proceso para no repetirlo mientras siga encendido.
const finalesEnMemoria = new Set();
async function finalNocturnoYaEnviado(fecha) {
  if (finalesEnMemoria.has(fecha)) return true;
  try {
    const res = await db.query('SELECT 1 FROM whatsapp_dia_estado WHERE fecha = $1 AND cierre_final_enviado_en IS NOT NULL LIMIT 1', [fecha]);
    return res.rows.length > 0;
  } catch (e) {
    return false;
  }
}
async function marcarFinalNocturnoEnviado(fecha) {
  finalesEnMemoria.add(fecha);
  try {
    await db.query('UPDATE whatsapp_dia_estado SET cierre_final_enviado_en = now() WHERE fecha = $1', [fecha]);
  } catch (e) {
    console.error('[whatsappDiaEstado] No se pudo guardar que el mensaje final ya salió (¿falta correr el SQL de cierre_final_enviado_en?):', e.message);
  }
}
function _reiniciarFinales() { finalesEnMemoria.clear(); }

module.exports = {
  finalNocturnoYaEnviado,
  marcarFinalNocturnoEnviado,
  _reiniciarFinales,
  listarDiasParaCierreNocturno,
  reclamarCierreNocturno,
  obtenerEstadoDia,
  registrarTextoRecibido,
  marcarSabanaFinalRecibida,
  registrarVerificacion,
  registrarEnvioResumen,
  marcarCierreEnviado,
  listarDiasDelGrupo,
  eliminarEstadoDia
};
