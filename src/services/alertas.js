// =================================================================
// ALERTAS — 2 tipos, ambos casos donde el sistema no adivina con dinero
// real de por medio y en cambio pide una aclaración:
//   - AMBIGUA_DEPORTE: jugadas AMBIGUA (VARIOS DEPORTES) que ni la
//     resolución manual previa, ni el marcador por-jugada, ni el
//     calendario, ni el número, ni el marcador de sección pudieron
//     resolver solas (ver evaluador.js) — se resuelven ELIGIENDO un
//     deporte de una lista de candidatos.
//   - SIN_LOGRO (28-08-2026): a la jugada le falta el número que hace
//     falta para verificarla o pagarla (la línea de una alta/baja, o la
//     cuota de un moneyline/hándicap) — ver procesarSabana.js. Acá no hay
//     nada que "elegir": el arreglo es que el Grupo corrija el texto en
//     la sábana y la vuelva a procesar, así que se descartan (ver
//     descartarAlerta) en vez de resolverse con un selector.
// Cada una queda registrada acá — visible tanto para el Grupo (en SU
// pestaña Alertas) como para el Súper-admin (en la suya, viendo TODOS los
// grupos). Las AMBIGUA_DEPORTE tienen un selector para resolverla a mano
// UNA sola vez; esa elección se guarda en resoluciones_ambiguas y, la
// PRÓXIMA vez que se reprocese esa sábana (hace falta volver a "Procesar
// Sábana", igual que cualquier otro cambio al diccionario de equipos),
// evaluarJugada() ya la usa directo (ver evaluador.js, capa 0 de
// resolverCandidatoAmbiguo).
//
// OJO: tanto en `alertas.pata` como en `resoluciones_ambiguas.pata_texto`
// se guarda el texto YA NORMALIZADO de la jugada (el mismo `jNorm` que
// procesarSabana.js le pasa a evaluarJugada) — no el texto original tal
// cual estaba en la sábana. Es a propósito: así el texto guardado acá es
// EXACTAMENTE la clave contra la que se busca al reprocesar, sin
// depender de que el original venga idéntico letra por letra la próxima
// vez (mayúsculas, tildes, etc. — ver normalizar.js).
// =================================================================
const db = require('../db');

// Se llama desde procesarSabana.js por cada pata que quedó AMBIGUA. Usa un
// índice único parcial (grupo_id, fecha, pata) WHERE resuelta = false —
// ver sql/schema.sql — así reprocesar la MISMA sábana varias veces (algo
// normal, ver historial.js) no genera alertas duplicadas para una jugada
// que ya está esperando que la resuelvan. Devuelve true si de verdad se
// insertó una fila NUEVA (false si ya existía una sin resolver y el
// ON CONFLICT la ignoró) — procesarSabana.js usa esto para que
// "alertasNuevas" en la respuesta solo cuente alertas GENUINAMENTE
// nuevas, no cada vez que se reprocesa una sábana que ya estaba avisada.
async function crearAlerta(grupoId, fecha, datos) {
  const r = await db.query(
    `INSERT INTO alertas (grupo_id, fecha, tipo, cliente_nombre, ticket_label, pata, mensaje, candidatos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (grupo_id, fecha, pata) WHERE resuelta = false DO NOTHING
     RETURNING id`,
    [
      grupoId,
      fecha,
      datos.tipo || 'AMBIGUA_DEPORTE',
      datos.cliente || null,
      datos.ticket || null,
      datos.pata,
      datos.mensaje,
      JSON.stringify(datos.candidatos || [])
    ]
  );
  return r.rows.length > 0;
}

// Carga, para un grupo+fecha, el mapa { pataTexto: deporteElegido } de
// resoluciones manuales YA guardadas — evaluarJugada() lo usa como la
// capa más fuerte de desambiguación (capa 0, ver evaluador.js). Se llama
// UNA vez por sábana procesada (no por jugada), y procesarSabana.js le
// pasa a cada evaluarJugada() el valor que le toque, si tiene alguno.
async function cargarResolucionesManuales(grupoId, fecha) {
  const r = await db.query(
    'SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas WHERE grupo_id = $1 AND fecha = $2',
    [grupoId, fecha]
  );
  const mapa = {};
  r.rows.forEach(row => { mapa[row.pata_texto] = row.deporte_elegido; });
  return mapa;
}

// Resuelve una alerta a mano (desde la pestaña Alertas, del lado del
// Grupo o del Súper-admin): guarda la elección en resoluciones_ambiguas
// (para que la PRÓXIMA vez que se procese esa sábana ya salga bien sola) y
// marca la alerta como resuelta. No recalcula el ticket en el momento —
// hace falta volver a "Procesar Sábana" para verlo aplicado.
async function resolverAlerta(alertaId, deporteElegido) {
  const r = await db.query('SELECT grupo_id, fecha, pata FROM alertas WHERE id = $1', [alertaId]);
  const alerta = r.rows[0];
  if (!alerta) {
    const err = new Error('Alerta no encontrada.');
    err.status = 404;
    throw err;
  }

  await db.query(
    `INSERT INTO resoluciones_ambiguas (grupo_id, fecha, pata_texto, deporte_elegido)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (grupo_id, fecha, pata_texto) DO UPDATE SET deporte_elegido = EXCLUDED.deporte_elegido`,
    [alerta.grupo_id, alerta.fecha, alerta.pata, deporteElegido]
  );
  await db.query(
    'UPDATE alertas SET resuelta = true, deporte_resuelto = $1, resuelto_en = now() WHERE id = $2',
    [deporteElegido, alertaId]
  );

  return { grupoId: alerta.grupo_id };
}

// Descarta una alerta que NO tiene un deporte para elegir (hoy, tipo
// SIN_LOGRO: a la jugada le falta un número en la sábana — no hay ningún
// "candidato" que seleccionar, a diferencia de AMBIGUA_DEPORTE). Solo la
// marca resuelta — no guarda nada en resoluciones_ambiguas, porque no hay
// ningún deporte que recordar para la próxima vez: si el Grupo corrige el
// texto de la jugada en la sábana, la próxima vez es un texto distinto y
// se evalúa de cero, tal como corresponde.
async function descartarAlerta(alertaId) {
  const r = await db.query('SELECT grupo_id FROM alertas WHERE id = $1', [alertaId]);
  const alerta = r.rows[0];
  if (!alerta) {
    const err = new Error('Alerta no encontrada.');
    err.status = 404;
    throw err;
  }
  await db.query('UPDATE alertas SET resuelta = true, resuelto_en = now() WHERE id = $1', [alertaId]);
  return { grupoId: alerta.grupo_id };
}

// Alertas de UN grupo (panel del Grupo), más nuevas primero.
async function listarAlertasGrupo(grupoId) {
  const r = await db.query(
    `SELECT id, fecha, tipo, cliente_nombre, ticket_label, pata, mensaje, candidatos, resuelta, deporte_resuelto, leida_grupo, creado_en
     FROM alertas WHERE grupo_id = $1 ORDER BY creado_en DESC LIMIT 200`,
    [grupoId]
  );
  return r.rows;
}

// Alertas de TODOS los grupos (panel de Súper-admin), con el nombre del
// grupo para saber de cuál viene cada una.
async function listarAlertasTodas() {
  const r = await db.query(
    `SELECT a.id, a.grupo_id, g.nombre AS grupo_nombre, a.fecha, a.tipo, a.cliente_nombre, a.ticket_label,
            a.pata, a.mensaje, a.candidatos, a.resuelta, a.deporte_resuelto, a.leida_superadmin, a.creado_en
     FROM alertas a JOIN grupos g ON g.id = a.grupo_id
     ORDER BY a.creado_en DESC LIMIT 300`
  );
  return r.rows;
}

async function contarNoLeidasGrupo(grupoId) {
  const r = await db.query('SELECT COUNT(*)::int AS total FROM alertas WHERE grupo_id = $1 AND leida_grupo = false', [grupoId]);
  return r.rows[0].total;
}

async function contarNoLeidasSuperadmin() {
  const r = await db.query('SELECT COUNT(*)::int AS total FROM alertas WHERE leida_superadmin = false');
  return r.rows[0].total;
}

async function marcarLeidasGrupo(grupoId) {
  await db.query('UPDATE alertas SET leida_grupo = true WHERE grupo_id = $1 AND leida_grupo = false', [grupoId]);
}

async function marcarLeidasSuperadmin() {
  await db.query('UPDATE alertas SET leida_superadmin = true WHERE leida_superadmin = false');
}

module.exports = {
  crearAlerta,
  cargarResolucionesManuales,
  resolverAlerta,
  descartarAlerta,
  listarAlertasGrupo,
  listarAlertasTodas,
  contarNoLeidasGrupo,
  contarNoLeidasSuperadmin,
  marcarLeidasGrupo,
  marcarLeidasSuperadmin
};
