const express = require('express');
const { requiereGrupo } = require('../middleware/auth');
const { procesarSabana } = require('../services/procesarSabana');
const { obtenerResultadosAPIs } = require('../services/mlbApi');
const { obtenerResultadosNFL } = require('../services/nflApi');
const { obtenerResultadosNHL } = require('../services/nhlApi');
const { obtenerResultadosNBA } = require('../services/nbaApi');
const { obtenerResultadosSoccer } = require('../services/soccerApi');
const { obtenerResultadosNCAAF } = require('../services/ncaafApi');
const asyncHandler = require('../middleware/asyncHandler');
const alertasService = require('../services/alertas');
const chatService = require('../services/chat');
const { confirmarDia, estadoDia } = require('../services/historial');
const { obtenerSabanaDeFecha, editarTicketDia } = require('../services/sabanaDia');
const { armarListaJuegos } = require('../services/pizarraJuegos');
const { listarFechasConDatos } = require('../services/mantenimientoGrupo');
const papeleraSabana = require('../services/papeleraSabana');

const router = express.Router();
router.use(requiereGrupo);

// Pega la sábana + fecha (YYYY-MM-DD) -> procesa contra la API de MLB,
// guarda el historial, y devuelve el mismo resumen que mostraba la app
// original (tickets evaluados, resumen por cliente, totales de la casa,
// y el bloque para armar el Plano de WhatsApp).
router.post('/procesar', asyncHandler(async (req, res) => {
  try {
    const { texto, fecha } = req.body;
    const resultado = await procesarSabana(req.grupoId, texto, fecha);
    res.json(resultado);
  } catch (e) {
    // Errores de VALIDACIÓN (sábana vacía, sin apuestas detectadas, etc,
    // con su propio e.status) se manejan aquí adentro tal cual antes; el
    // asyncHandler de afuera atrapa lo que se escape sin querer (ej. la
    // API de MLB o la base de datos fallando a mitad de camino).
    res.status(e.status || 500).json({ error: e.message || 'Error al procesar la sábana.' });
  }
}));

// =================================================================
// "GUARDAR DÍA" (31-08-2026, a pedido del usuario) — como una fecha se
// puede reprocesar varias veces en el día (a medida que van cerrando más
// juegos), esto es la forma de marcar "esta versión, con los saldos
// finales, es la sábana OFICIAL del día". Ver historial.js
// (confirmarDia/estadoDia) para el detalle de por qué se borra sola cada
// vez que se reprocesa esa fecha.
// =================================================================
router.post('/confirmar-dia', asyncHandler(async (req, res) => {
  const { fecha } = req.body;
  if (!fecha) return res.status(400).json({ error: 'Falta la fecha (YYYY-MM-DD).' });
  const resultado = await confirmarDia(req.grupoId, fecha);
  res.json(resultado);
}));

router.get('/estado-dia', asyncHandler(async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: 'Falta la fecha (YYYY-MM-DD).' });
  const resultado = await estadoDia(req.grupoId, fecha);
  res.json(resultado);
}));

// =================================================================
// PESTAÑA "SÁBANAS" (Administración, 02-09-2026) — ver la nota grande en
// src/services/sabanaDia.js. GET /dia reconstruye la sábana de una fecha
// puntual desde lo ya guardado (para verla/fotografiarla); PUT
// /tickets/:id edita a mano un ticket de esa sábana y deja constancia en
// Alertas si de verdad cambió algo.
// =================================================================
router.get('/dia', asyncHandler(async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: 'Falta la fecha (YYYY-MM-DD).' });
  const resultado = await obtenerSabanaDeFecha(req.grupoId, fecha);
  res.json(resultado);
}));

// No hace falta validar acá que el ticket sea de este grupo_id: eso ya lo
// hace editarTicket()/obtenerTicketPorId() (ver historial.js), que
// siempre filtra por grupo_id + id — si el id es de otro grupo, responde
// 404 en vez de dejar editar un ticket ajeno.
router.put('/tickets/:id', asyncHandler(async (req, res) => {
  try {
    const resultado = await editarTicketDia(req.grupoId, req.params.id, req.body || {});
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo editar el ticket.' });
  }
}));

// =================================================================
// ELIMINAR SÁBANA POR DÍA(S), CON PAPELERA RECUPERABLE (03-09-2026, a
// pedido del usuario) — ver la nota grande en
// services/papeleraSabana.js. "fechas-con-datos" arma el checklist de
// días que el panel puede ofrecer para marcar (reusa la MISMA consulta
// de solo-lectura que ya usaba Súper-admin en mantenimientoGrupo.js,
// sin tocar ese flujo); "eliminar-fechas" borra con papelera + alerta;
// "papelera"/"papelera/:id/restaurar" listan y deshacen un borrado.
// =================================================================
router.get('/fechas-con-datos', asyncHandler(async (req, res) => {
  const fechas = await listarFechasConDatos(req.grupoId);
  res.json(fechas);
}));

router.post('/eliminar-fechas', asyncHandler(async (req, res) => {
  try {
    const { fechas } = req.body;
    const resultado = await papeleraSabana.eliminarSabanaDeFechas(req.grupoId, fechas);
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo eliminar la sábana de esos días.' });
  }
}));

router.get('/papelera', asyncHandler(async (req, res) => {
  const filas = await papeleraSabana.listarPapelera(req.grupoId);
  res.json(filas);
}));

router.post('/papelera/:id/restaurar', asyncHandler(async (req, res) => {
  try {
    const resultado = await papeleraSabana.restaurarPapelera(req.grupoId, req.params.id);
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo restaurar esa sábana.' });
  }
}));

// =================================================================
// PIZARRA EN VIVO: "solo datos" (sin video) de los juegos EN CURSO de
// todos los deportes conectados, para una fecha — carreras/puntos,
// entrada/cuarto, y (solo MLB) outs, bolas/strikes, corredores en base.
// Equivalente de la sección que en la app original se auto-refrescaba
// cada 20s leyendo la MISMA API de resultados que usa "Procesar Sábana",
// solo que aquí se expone aparte para que el panel la pueda pedir sin
// tener que reprocesar toda la sábana cada vez. Cada conector
// (mlbApi.js/nflApi.js, y los que se sumen después) ya trae el detalle
// "enVivo" completo; esto solo los junta y deduplica (cada API keyea por
// equipo local Y visitante, acá se devuelve 1 fila por juego) antes de
// mandarlo. Cada fila trae su propio campo `deporte` para que el panel
// sepa con qué diseño de tarjeta dibujarla.
router.get('/pizarra', asyncHandler(async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: 'Falta la fecha (YYYY-MM-DD).' });

  const [datosMLB, datosNFL, datosNHL, datosSoccer, datosNBA, datosNCAAF] = await Promise.all([
    obtenerResultadosAPIs(fecha),
    obtenerResultadosNFL(fecha),
    obtenerResultadosNHL(fecha),
    obtenerResultadosSoccer(fecha),
    obtenerResultadosNBA(fecha),
    obtenerResultadosNCAAF(fecha)
  ]);

  const juegos = armarListaJuegos({ datosMLB, datosNFL, datosNHL, datosSoccer, datosNBA, datosNCAAF });

  res.json(juegos);
}));

// =================================================================
// ALERTAS (del propio Grupo) — jugadas AMBIGUA (VARIOS DEPORTES) que se
// fueron generando al procesar sábanas (ver procesarSabana.js). El
// Súper-admin ve las de TODOS los grupos desde src/routes/superadmin.js;
// acá el Grupo solo ve (y solo puede marcar leídas/resolver) las suyas.
// =================================================================
router.get('/alertas', asyncHandler(async (req, res) => {
  const alertas = await alertasService.listarAlertasGrupo(req.grupoId);
  res.json(alertas);
}));

router.get('/alertas/conteo-no-leidas', asyncHandler(async (req, res) => {
  const total = await alertasService.contarNoLeidasGrupo(req.grupoId);
  res.json({ total });
}));

router.post('/alertas/marcar-leidas', asyncHandler(async (req, res) => {
  await alertasService.marcarLeidasGrupo(req.grupoId);
  res.status(204).end();
}));

// Resuelve una alerta a mano eligiendo el deporte correcto — ver
// alertas.js (guarda la elección en resoluciones_ambiguas para la
// PRÓXIMA vez que se reprocese esa sábana). No valida acá que la alerta
// pertenezca a este grupo_id a propósito: el id es un UUID impredecible
// que solo aparece en las respuestas de ESTE mismo grupo (ver
// listarAlertasGrupo), así que en la práctica un Grupo nunca llega a
// conocer el id de una alerta ajena para poder mandarlo acá.
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
// SIN_LOGRO, 28-08-2026: a la jugada le falta un número en la sábana) —
// ver alertas.js. El arreglo real es corregir el texto en la sábana y
// volver a procesar; esto solo la saca de la lista de pendientes.
router.post('/alertas/:id/descartar', asyncHandler(async (req, res) => {
  try {
    const resultado = await alertasService.descartarAlerta(req.params.id);
    res.json({ ok: true, grupoId: resultado.grupoId });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo descartar la alerta.' });
  }
}));

// =================================================================
// CHAT DE SOPORTE (del propio Grupo, con el Súper-admin) — ver chat.js.
// =================================================================
router.get('/chat', asyncHandler(async (req, res) => {
  const mensajes = await chatService.listarMensajes(req.grupoId);
  res.json(mensajes);
}));

router.post('/chat', asyncHandler(async (req, res) => {
  try {
    const mensaje = await chatService.enviarMensaje(req.grupoId, 'grupo', req.body.texto);
    res.status(201).json(mensaje);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo enviar el mensaje.' });
  }
}));

router.get('/chat/conteo-no-leidos', asyncHandler(async (req, res) => {
  const total = await chatService.contarNoLeidosGrupo(req.grupoId);
  res.json({ total });
}));

router.post('/chat/marcar-leidos', asyncHandler(async (req, res) => {
  await chatService.marcarLeidosGrupo(req.grupoId);
  res.status(204).end();
}));

module.exports = router;
