// =================================================================
// Módulo Hipismo — backend real (22-09-2026, a pedido del usuario:
// "conecta el modulo real al backend ya quiero trabajar y hacer
// pruebas para poder ir diciendo que falta"). Ver claude/plan-modulo-
// hipismo.md y claude/spec-modulo-hipismo.md (Proyecto "DEPORTES", no
// viven en este repo) para el contexto completo.
//
// Primera rebanada real: Hipódromos (Administración > Hipódromos, spec
// sección 3) y "Cargar Planos" (spec secciones 1, 5, 6, 7 — el motor de
// cálculo vive en src/services/hipismoCalc.js, portado tal cual del
// mockup para no arriesgar las reglas ya confirmadas con el usuario).
// Lo que ESTE archivo todavía NO hace (sigue en el mockup, con datos de
// ejemplo): Pozos con histórico real, Cierre Final agregado real,
// Comisiones Devueltas/Saldo Comisiones (dependen de una fórmula que el
// usuario todavía no confirmó), portal público del cliente con datos
// reales, WhatsApp por módulo, Traspasos de Jugadas sobre saldos ya
// guardados.
//
// Cada ruta acá exige, además de la sesión normal (requiereGrupo) y el
// permiso 'hipismo' (mismo criterio que 'sabana' para Deportes — ver
// middleware/auth.js), que el GRUPO tenga el módulo contratado
// (grupos.modulo_hipismo_habilitado = true, el interruptor de
// Súper-admin ya construido) — sin esto, un grupo que solo compró
// Deportes podría llamar estas rutas a mano aunque el panel no le
// muestre el botón.
const express = require('express');
const db = require('../db');
const bcrypt = require('bcryptjs');
const { requiereGrupo, requierePermiso, requiereAdministrador } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
// CHAT DE SOPORTE (26-09-2026, "activa el modulo de mensajes... para el
// modulo de hipismo") — MISMO servicio y MISMA tabla (mensajes_chat, por
// grupo_id) que ya usa Deportes (ver services/chat.js y la sección "CHAT
// DE SOPORTE" al final de este archivo) — no es un chat aparte para
// Hipismo, es la MISMA bandeja: un grupo con los 2 módulos activos ve la
// misma conversación entre routes/sabana.js y acá.
const chatService = require('../services/chat');
// numeroSemanaISO (23-09-2026, duodécima-tercera ronda, a pedido del
// usuario: "en balance general al ver los saldos y en cierre final
// colocame arriba la fecha que este comprendida la semana es decir del
// 15-08 al 22-08 por ejemplo, y semana xxx... que seria la semana del
// año en la que estamos") — MISMO cálculo de "número de semana del año"
// que ya usa Deportes en "📅 Saldos Semana" (ver services/fechaSemana.js,
// convención ISO-8601), reusado tal cual en vez de reinventarlo acá.
const { numeroSemanaISO } = require('../services/fechaSemana');
const {
  rangoSemanaGrupo, obtenerConfigSemana, guardarConfigSemana, describirConfigSemana, parsearDia, diasDelRango,
  validarRangoPersonalizado, guardarRangoPersonalizado
} = require('../services/hipismoSemana');
const {
  calcularPlano, armarTextoResultado, PIE_PLANO_DEFECTO,
  parsearPizarra, recalcularTicket, recalcularTotalesPlano, armarSalidaLineasDeTickets,
  parsearValoresSinComision,
  // calcularAjustesCruce (26-09-2026, a pedido del usuario: "LOS PLANOS SI
  // ME ESTAN CRUZANDO LAS JUGADAS... PERO EN LOS BALANCES NO ME LA ESTA
  // CRUZANDO" — ver la nota grande de esta función más abajo, junto a
  // donde se usa en GET /cierre-final).
  calcularAjustesCruce,
  // netearJugadorBanqueroTercios (02-10-2026, a pedido del usuario, caso
  // real "GG" — ver la nota grande junto a esta función en
  // services/hipismoCalc.js): cuando un cliente juega Y banquea Tercios
  // en la MISMA carrera, el % devuelto se calcula sobre el NETO de los 2
  // lados, nunca sobre la suma.
  netearJugadorBanqueroTercios,
  // "Cargar Winners" (26-09-2026) reusa el mismo formato de nombre/monto
  // que el resto de Hipismo, sin necesitar nada del motor de cálculo de
  // Tercios (acá no se calcula nada, ver la nota grande junto a POST /winners).
  formatNombre, formatMontoTabla
} = require('../services/hipismoCalc');
// "Cargar Remate" (23-09-2026, a pedido del usuario, con un formato real
// de ejemplo pegado por él — ver la nota grande en
// services/hipismoRemateCalc.js y en sql/schema.sql, tablas
// hipismo_remates/hipismo_remate_apuestas). Un remate es un pozo aparte
// de los Tercios de "Cargar Planos": cada cliente apuesta a UN número de
// ejemplar, y si ESE número gana la carrera se lleva el pozo completo
// (menos comisión, o la garantía si el pozo no alcanza) — el resto
// pierde lo apostado.
const { parsearRemate, primerNumeroPizarra, calcularRemate, armarTextoResultadoRemate } = require('../services/hipismoRemateCalc');
// "Jugadas Adelantadas" — Tablas Fijas y Marcas (23-09-2026, nueva pestaña
// "Apuestas > Jugadas Adelantadas", ver la nota grande en
// services/hipismoAdelantadasCalc.js y en sql/schema.sql). Un cliente
// pega estas jugadas ANTES de que corra la carrera; cada línea queda
// 'pendiente' hasta que llega un plano de "Cargar Planos" con la pizarra
// de esa misma carrera (mismo criterio de auto-detección que ya usa
// Remate, ver resolverLlegadaRemate más abajo) — ahí Tablas Fijas se
// resuelve sola, y Marcas queda 'falta_banqueo' hasta que el operador le
// asigna quién banquea (POST /adelantadas/jugadas/:id/banquear).
const {
  parsearJugadasAdelantadas, esMarcaDecidible, resolverTablaFija,
  resolverClienteMarca, resolverBanqueoMarca, banqueoAutomaticoMarca, banqueoAutomaticoTablaFija, armarBloqueAdelantadas, round2,
  montoDecidido, montoDecididoExacto, montoBaseComisionExacto,
  parsearRetirados, apuestaConRetirado, adelantadaConRetirado, pctJugada, banqueadoresJugada, resolverMontosManuales
} = require('../services/hipismoAdelantadasCalc');
// "Jugadas entre Tercios Adelantadas" (04-10-2026, nueva pestaña hermana
// de "Jugadas Adelantadas"/Tablas Fijas y Marcas de arriba, ver la nota
// grande en services/hipismoTerciosAdelantadasCalc.js y en sql/schema.sql,
// tablas hipismo_tercios_adelantadas_planos/jugadas). Misma idea: el
// cliente pega estas jugadas de Tercios ANTES de la carrera, y se
// resuelven solas cuando llega el plano de "Cargar Planos" con la
// pizarra de esa misma carrera — a diferencia de Tablas Fijas/Marcas,
// acá CADA jugada ya trae jugador Y banquero explícitos (como Tercios en
// vivo), así que nunca queda "falta_banqueo" — o se resuelve de una
// ('resuelto'/'sin_decidir') o le falta un dato (falta_monto/
// falta_jugador/falta_banquero, ver más abajo), nunca las dos cosas.
const {
  asegurarBanqueoAutomaticoMarcas, obtenerBanqueoMarcasGrupo, guardarBanqueoMarcasGrupo, validarBanqueoMarcas,
  obtenerBanqueoTablasFijasGrupo, guardarBanqueoTablasFijasGrupo
} = require('../services/hipismoMarcasBanqueoAuto');
const {
  parsearPlanoTerciosAdelantadas, resolverLineaTerciosAdelantada, extraerPctDeTexto, montoBaseTerciosAdelantadaExacto
} = require('../services/hipismoTerciosAdelantadasCalc');
const {
  validarCargaEspecial, normalizarNombre: normalizarNombreCargaEspecial, obtenerCargasEspecialesRango,
  ACCIONES_CARGA_ESPECIAL, CUENTAS_GRUPO_CARGA_ESPECIAL, esCuentaGrupo
} = require('../services/hipismoCargasEspeciales');
// obtenerComisionesPropias/crearYLinkearCuentaComision/
// asegurarCuentasComisionParaNombres/agregarPorcentajeDevuelto/
// obtenerAjustesComision (26-09-2026) — extraídas a su propio archivo
// para que services/hipismoResumenCliente.js también las use (ver la
// nota grande donde vivían antes, más abajo).
const {
  obtenerComisionesPropias, crearYLinkearCuentaComision, asegurarCuentasComisionParaNombres,
  agregarPorcentajeDevuelto, obtenerAjustesComision
} = require('../services/hipismoComisionPropia');
// autoRegistrarJugadores (22-09-2026, a pedido del usuario: "al hacer un
// plano el cliente debe crearse automatico, despues el empleado debera
// ver si le coloca % o no") — es la MISMA función que ya usa Deportes
// al procesar una sábana (services/procesarSabana.js), reusada tal cual
// sobre la MISMA tabla "jugadores" compartida entre los 2 módulos (ver
// claude/plan-modulo-hipismo.md: "Jugadores... siguen siendo UNA sola
// tabla/pantalla compartida"). Da de alta con auto_creado=true,
// tipo_cuenta='libre', comisión 0% — el empleado decide después, desde
// Administración > Jugador, si le carga un % propio o lo deja así.

// CLIENTE QUE NO EXISTE = ERROR, NUNCA SE CREA SOLO (05-10-2026, a pedido
// del usuario: "actualmente se crea el jugador automatico pero no quiero
// eso porque me esta creando clientes dobles cuando tengo un error de una
// letra... a partir de ahora me vas a dar un mensaje en pantalla que diga:
// CLIENTE (NOMBRE) NO EXISTE... asi ya yo se si debo crearlo o escribir
// bien su nombre"). Reemplaza al alta automática (autoRegistrarJugadores)
// en TODAS las cargas de Hipismo (planos, adelantadas, tercios
// adelantadas, remates, winners, traspasos, carga masiva, ediciones).
// Compara por nombre normalizado (MAYÚSCULA, espacios colapsados) contra
// la ficha de jugadores del grupo, activa o no (un cliente inactivo
// existe: nunca se duplica).
async function clientesInexistentes(grupoId, nombres) {
  const limpios = Array.from(new Set((nombres || [])
    .map(n => normalizarNombreCargaEspecial(n))
    .filter(n => n && n !== 'GENERAL')));
  if (!limpios.length) return [];
  const r = await db.query('SELECT nombre FROM jugadores WHERE grupo_id = $1 AND nombre = ANY($2::text[])', [grupoId, limpios]);
  const existen = new Set(r.rows.map(x => x.nombre));
  return limpios.filter(n => !existen.has(n));
}

function cuerpoClientesNoExisten(faltan) {
  const lineas = faltan.map(n => `CLIENTE ${n} NO EXISTE`);
  return {
    error: lineas.join('\n') + '\nEscribe bien su nombre o créalo primero en Clientes.',
    clientesNoExisten: faltan
  };
}

// Responde 422 y devuelve true si algún nombre no existe — el llamador
// hace `if (await rechazarClientesInexistentes(req, res, nombres)) return;`.
async function rechazarClientesInexistentes(req, res, nombres) {
  const faltan = await clientesInexistentes(req.grupoId, nombres);
  if (!faltan.length) return false;
  res.status(422).json(cuerpoClientesNoExisten(faltan));
  return true;
}
// "Eliminar Planos" — papelera recuperable (23-09-2026, a pedido del
// usuario: "en apuestas crea un boton de eliminar planos"). Ver la nota
// grande en services/hipismoPlanosPapelera.js — mismo criterio ya usado
// para la sábana de Deportes (papelera recuperable, nunca borrado
// definitivo, para un sistema contable).
const hipismoPlanosPapelera = require('../services/hipismoPlanosPapelera');
const { detectarApuestasSobrePozo, mensajeApuestaSobrePozo } = require('../services/hipismoAlertaPozo');
// construirResumenClienteHipismo (24-09-2026) — la nueva pestaña "Saldos >
// Detallado por Cliente" pide EXACTAMENTE la misma respuesta que ya arma
// GET /api/hipismo-cliente/:token (el portal público) para un cliente
// puntual, buscado por nombre en vez de por token — ver
// GET /clientes/:nombre/detalle-semana más abajo y la nota grande en
// services/hipismoResumenCliente.js.
const { construirResumenClienteHipismo, construirResumenRemateHipismo, construirResumenWinnersHipismo, construirResumenTablasFijasHipismo, construirCierreFinalHipismo, diagnosticarSaldosHipismo } = require('../services/hipismoResumenCliente');
// "Grupo de Clientes" (30-09-2026) — CRUD de este módulo para services/
// gruposClientes.js, siempre con modulo='hipismo' fijo (ver la nota
// grande arriba de ese archivo y en sql/schema.sql junto a
// "create table grupos_clientes").
const {
  crearGrupoCliente,
  listarGruposClientes,
  eliminarGrupoCliente,
  agregarMiembro,
  quitarMiembro,
  construirTarjetaGrupoCliente
} = require('../services/gruposClientes');

// fechaHoyVenezuela() (24-09-2026) — BUG encontrado a partir de "al
// cargar plano no me esta jalando las jugadas adelantadas": el respaldo
// de "fecha" cuando el request no manda ninguna usaba
// `new Date().toISOString().slice(0,10)`, que da la fecha en UTC. Entre
// las 8pm y la medianoche hora Venezuela (UTC-4 fijo, sin horario de
// verano) UTC ya cambió de día, así que un plano cargado en ese rango
// horario podía guardarse con la fecha de MAÑANA sin que nadie lo
// notara — y buscarAdelantadasPendientes() compara esa fecha contra la
// de la jugada adelantada exacto, así que si no coinciden, no se jala.
// El frontend (hipismo-mockup.html) ya manda la fecha bien calculada
// desde fechaLocalHoy() (misma corrección, del lado del navegador); esto
// es solo el último respaldo por si algún request llega sin fecha.
function fechaHoyVenezuela() {
  const OFFSET_VENEZUELA_MS = 4 * 60 * 60 * 1000; // UTC-4, Venezuela no tiene horario de verano
  return new Date(Date.now() - OFFSET_VENEZUELA_MS).toISOString().slice(0, 10);
}

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('hipismo'));

function requiereModuloHipismo(req, res, next) {
  if (!req.grupo.modulo_hipismo_habilitado) {
    return res.status(403).json({ error: 'Este grupo no tiene el módulo de Hipismo habilitado. Pídele al administrador de la plataforma que lo active desde Súper-admin.' });
  }
  next();
}
router.use(requiereModuloHipismo);

// =================================================================
// ALERTAS DE HIPISMO (23-09-2026, duodécima-tercera ronda, a pedido del
// usuario: "se genera una alerta en una pestaña que diga alertas que
// este debajo de administracion, indicando que se edito y que usuario
// se edito.... si el plano lo eliminan se genera la alerta igual
// mente"). Ver la nota grande en sql/schema.sql, tabla hipismo_alertas,
// para por qué es una tabla NUEVA y no la "alertas" de Deportes (esa
// vive atada al flujo de AMBIGUA_DEPORTE/SIN_LOGRO, con columnas
// obligatorias — "pata" NOT NULL, candidatos jsonb — que no tienen
// sentido acá). registrarAlerta() es el único punto de escritura, usado
// tanto por Jugadas Adelantadas (editar/eliminar una jugada) como por
// "Eliminar Planos" (editar/eliminar un plano) — nunca se le pide
// confirmación al operador para generarla, es automática en cuanto la
// acción de verdad se concreta.
async function registrarAlerta(req, { tipo, hipodromoNombre, carreraNumero, fecha, mensaje }) {
  await db.query(
    `INSERT INTO hipismo_alertas (grupo_id, tipo, usuario, hipodromo_nombre, carrera_numero, fecha, mensaje)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [req.grupoId, tipo, req.nombreActor, hipodromoNombre || null, carreraNumero || null, fecha || null, mensaje]
  );
}

// APUESTA MÁS DE LO QUE LE QUEDA (07-10-2026, ver hipismoAlertaPozo.js):
// avisa en Administración > Alertas cuando un cliente con pozo apostó, en
// esta carga, más que su pozo disponible. Solo AVISA: nunca bloquea ni
// cambia montos, y cualquier error al revisar se ignora para que jamás
// impida guardar un plano. Devuelve la lista para mostrarla en pantalla.
async function alertarApuestasSobrePozo(req, { apuestas, hipodromoNombre, carreraNumero, fecha, etiqueta }) {
  try {
    const sobre = await detectarApuestasSobrePozo(req.grupoId, apuestas);
    for (const s of sobre) {
      await registrarAlerta(req, {
        tipo: 'APUESTA_SOBRE_POZO', hipodromoNombre, carreraNumero, fecha,
        mensaje: mensajeApuestaSobrePozo(s, etiqueta)
      });
    }
    return sobre;
  } catch (e) {
    console.warn('[alerta pozo] no se pudo revisar el pozo (se guarda igual):', e.message);
    return [];
  }
}

// GET /alertas : lista completa para la pestaña "Alertas" bajo
// Administración, más reciente primero. Sin filtro de fecha por ahora
// (el volumen esperado es bajo — ediciones/borrados son la excepción,
// no la regla) — si hace falta paginar/filtrar más adelante es un
// agregado aparte.
router.get('/alertas', asyncHandler(async (req, res) => {
  const r = await db.query(
    'SELECT * FROM hipismo_alertas WHERE grupo_id = $1 ORDER BY creado_en DESC LIMIT 300',
    [req.grupoId]
  );
  res.json(r.rows);
}));

// Cuadre nocturno y errores del servidor (07-10-2026). GET /cuadre-nocturno:
// bitácora de las últimas revisiones automáticas de este grupo (ver
// services/hipismoCuadreNocturno.js). POST /cuadre-nocturno/ejecutar: la
// misma revisión, a mano, guardada igual. GET /errores: errores del
// servidor de ESTE grupo (services/erroresServidor.js).
router.get('/cuadre-nocturno', asyncHandler(async (req, res) => {
  const r = await db.query(
    'SELECT fecha, estado, detalle, creado_en FROM hipismo_cuadre_nocturno WHERE grupo_id = $1 ORDER BY fecha DESC LIMIT 14',
    [req.grupoId]
  );
  res.json(r.rows);
}));

router.post('/cuadre-nocturno/ejecutar', asyncHandler(async (req, res) => {
  const resultado = await require('../services/hipismoCuadreNocturno').ejecutarCuadreGrupo(req.grupo, { usuario: req.nombreActor });
  res.json(resultado);
}));

router.get('/errores', asyncHandler(async (req, res) => {
  res.json(await require('../services/erroresServidor').listarErrores({ grupoId: req.grupoId, limite: req.query.limite }));
}));

// =================================================================
// HIPÓDROMOS (Administración > Hipódromos, spec sección 3)
// =================================================================
router.get('/hipodromos', asyncHandler(async (req, res) => {
  const r = await db.query('SELECT * FROM hipismo_hipodromos WHERE grupo_id = $1 ORDER BY nombre', [req.grupoId]);
  res.json(r.rows);
}));

router.post('/hipodromos', asyncHandler(async (req, res) => {
  const { nombre, pais, carrerasMax } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del hipódromo.' });
  const paisNormalizado = pais === 'US' ? 'US' : 'VE';
  try {
    const r = await db.query(
      'INSERT INTO hipismo_hipodromos (grupo_id, nombre, pais, carreras_max) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.grupoId, nombre.trim(), paisNormalizado, Number.isInteger(carrerasMax) ? carrerasMax : 25]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un hipódromo con ese nombre.' });
    throw e;
  }
}));

router.delete('/hipodromos/:id', asyncHandler(async (req, res) => {
  const r = await db.query('DELETE FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2 RETURNING id', [req.params.id, req.grupoId]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Hipódromo no encontrado.' });
  res.json({ ok: true });
}));

// PUT /hipodromos/:id (03-10-2026, a pedido del usuario: "en la pestaña
// hipodromo puedo editar o eliminar un hipodromo" — el borrado ya existía
// desde la segunda ronda pero nunca tuvo botón en la pantalla, y editar no
// existía ni acá ni en el frontend). Permite corregir nombre/país/cantidad
// de carreras de un hipódromo YA creado, sin tener que borrarlo y crearlo
// de nuevo (lo que perdería el historial de planos que ya lo referencian
// por hipodromo_id). Mismo manejo de nombre duplicado que el POST.
router.put('/hipodromos/:id', asyncHandler(async (req, res) => {
  const { nombre, pais, carrerasMax } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del hipódromo.' });
  const paisNormalizado = pais === 'US' ? 'US' : 'VE';
  try {
    const r = await db.query(
      'UPDATE hipismo_hipodromos SET nombre = $1, pais = $2, carreras_max = $3 WHERE id = $4 AND grupo_id = $5 RETURNING *',
      [nombre.trim(), paisNormalizado, Number.isInteger(carrerasMax) ? carrerasMax : 25, req.params.id, req.grupoId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Hipódromo no encontrado.' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe otro hipódromo con ese nombre.' });
    throw e;
  }
}));

// =================================================================
// JUGADAS ADELANTADAS — enganche con "Cargar Planos" (23-09-2026, ver la
// nota grande en services/hipismoAdelantadasCalc.js). En cuanto un plano
// de Cargar Planos trae la pizarra de una carrera, se buscan las jugadas
// adelantadas 'pendiente' de ESE MISMO hipódromo + carrera + fecha y se
// resuelven con esa misma pizarra: Tablas Fijas queda 'resuelto' de una
// (no depende de ningún banqueo), Marcas queda 'falta_banqueo' (el
// operador todavía tiene que asignar quién banquea, ver más abajo) o
// 'sin_decidir' si es un hipódromo nacional y la pizarra no llegó a 5
// puestos (ver esMarcaDecidible en el .js de arriba).
//
// Esto también es lo que permite "jalar" una jugada adelantada aunque
// esa carrera no tenga NINGÚN plano de Tercios en vivo (a pedido del
// usuario: "si llega a quedar alguna jugada adelantada... sin nada...
// en darle a cargar así no pegue nada, jale la jugada adelantada") — ver
// más abajo cómo /planos y /planos/calcular ya no exigen texto si hay
// adelantadas pendientes de esa carrera.
// =================================================================
// soloPendientes=true (de siempre): solo trae las que todavía no tienen
// NINGÚN resultado (estado='pendiente') — lo que usan POST /planos/
// /planos/calcular/PUT /pizarras/tercios/:id para "jalar" una Adelantada
// que llegó después o corregir de paso las que quedaron pendientes.
//
// soloPendientes=false (01-10-2026, a pedido del usuario — ver la nota
// grande de "PIZARRAS" más abajo, "ahora SÍ incluye Jugadas
// Adelantadas"): trae TODAS las jugadas de esa carrera sin importar su
// estado, para PUT/DELETE /pizarras/adelantadas, que corrige la pizarra
// de una carrera DESPUÉS de que ya se resolvió (mal) — ahí sí hace falta
// re-resolver jugadas que ya estaban 'resuelto'/'falta_banqueo'/
// 'sin_decidir', no solo las 'pendiente'.
async function buscarAdelantadasPendientes(req, { hipodromoNombre, carreraNumero, fecha }, soloPendientes = true) {
  const r = await db.query(
    `SELECT j.* FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.hipodromo_nombre = $2 AND j.carrera_numero = $3 AND p.fecha = $4
        ${soloPendientes ? `AND j.estado = 'pendiente'` : ''}
      ORDER BY j.creado_en`,
    [req.grupoId, hipodromoNombre, carreraNumero, fecha]
  );
  return r.rows;
}

// Mismo formato/separadores que parsearPizarra() en hipismoCalc.js.
function parsearPizarraRank(pizarraTxt) {
  const posiciones = {};
  (pizarraTxt || '').split(/[^0-9]+/).filter(Boolean).forEach((h, i) => { posiciones[parseInt(h, 10)] = i + 1; });
  return h => (posiciones[h] !== undefined ? posiciones[h] : 99);
}

// Caballos retirados ("Ret:") de una carrera (06-10-2026, ver la nota grande
// "CABALLO RETIRADO => APUESTA NULA" en hipismoAdelantadasCalc.js). Si quien
// llama ya tiene el "Ret:" (POST /planos, /planos/calcular, o el body de
// PUT /pizarras/adelantadas) lo pasa en `ret` y manda ese; si no (corregir
// una pizarra, editar una jugada ya resuelta) se lee del plano más reciente
// de esa misma carrera -- así un "Ret:" ya cargado nunca se pierde.
async function obtenerRetiradosCarrera(req, { hipodromoNombre, carreraNumero, fecha, ret }) {
  if (ret !== undefined && ret !== null) return parsearRetirados(ret);
  try {
    const r = await db.query(
      `SELECT ret FROM hipismo_planos
        WHERE grupo_id = $1 AND hipodromo_nombre = $2 AND carrera_numero = $3 AND fecha = $4 AND ret IS NOT NULL AND ret <> ''
        ORDER BY creado_en DESC LIMIT 1`,
      [req.grupoId, hipodromoNombre, carreraNumero, fecha]
    );
    return parsearRetirados(r.rows.length ? r.rows[0].ret : '');
  } catch (e) {
    return parsearRetirados('');
  }
}

// Calcula (SIN guardar nada) cómo quedarían las jugadas adelantadas
// pendientes de una carrera contra una pizarra — lo usan tanto la vista
// previa (POST /planos/calcular) como, con persistencia aparte (ver
// guardarResolucionAdelantadas), POST /planos.
async function calcularResolucionAdelantadas(req, { hipodromoNombre, carreraNumero, fecha, pizarra, ret }, soloPendientes = true) {
  // Las jugadas con montos exactos a mano (07-10-2026) quedan FIJAS: nunca se re-resuelven con la pizarra.
  const pendientes = (await buscarAdelantadasPendientes(req, { hipodromoNombre, carreraNumero, fecha }, soloPendientes)).filter(j => !j.montos_manuales);
  if (!pendientes.length) return { resueltas: [], movimientosParaTexto: [] };

  const rHip = await db.query('SELECT pais FROM hipismo_hipodromos WHERE grupo_id = $1 AND nombre = $2', [req.grupoId, hipodromoNombre]);
  const esNacional = rHip.rows.length ? rHip.rows[0].pais !== 'US' : true;
  const rank = parsearPizarraRank(pizarra);
  // Banqueo automático de Marcas: configuración DEL GRUPO (null = flujo manual).
  const configBanqueoMarcas = await obtenerBanqueoMarcasGrupo(req.grupoId);
  const configBanqueoTf = await obtenerBanqueoTablasFijasGrupo(req.grupoId);
  const retirados = await obtenerRetiradosCarrera(req, { hipodromoNombre, carreraNumero, fecha, ret });

  const resueltas = pendientes.map(j => { const r = ((j) => {
    // CABALLO RETIRADO => NULA (06-10-2026): si algún caballo de esta Marca o
    // Tabla Fija figura en "Ret:", la apuesta no se juega: 0 para el cliente,
    // sin banqueo, sin comisión y sin línea en el plano. Aplica a TODAS las
    // jugadas de la carrera, sin importar el cliente ni el grupo.
    if (adelantadaConRetirado(j, retirados)) {
      return { id: j.id, cliente: j.cliente_nombre, tipo: j.tipo === 'tf' ? 'tf' : 'marca', estadoNuevo: 'sin_decidir', monto: Number(j.monto), gano: null, resultadoCliente: 0, comision: 0, banqueadores: null, retirado: true, movimientos: [] };
    }
    if (j.tipo === 'tf') {
      const r = resolverTablaFija(
        { numeroEjemplar: j.numero_ejemplar, monto: Number(j.monto), gananciaPotencial: Number(j.ganancia_potencial) },
        rank, pctJugada(j)
      );
      // BANQUEO DE TABLAS FIJAS por grupo (06-10-2026): si el grupo configuró
      // quién banquea sus TF (o la jugada ya tenía banqueadores), el lado de
      // la banca se reparte entre ellos en vez del ítem "TABLAS FIJAS".
      // `comision` pasa a ser la que realmente pagan los banqueadores.
      const bqTf = banqueoAutomaticoTablaFija({ gano: r.gano, resultadoCliente: r.resultadoCliente, monto: Number(j.monto) }, pctJugada(j), banqueadoresJugada(j), configBanqueoTf);
      return {
        id: j.id, cliente: j.cliente_nombre, tipo: 'tf', estadoNuevo: 'resuelto', monto: Number(j.monto),
        gano: r.gano, resultadoCliente: r.resultadoCliente, comision: bqTf ? bqTf.comision : r.comision, banqueadores: bqTf ? bqTf.banqueadores : null,
        movimientos: [{ nombre: j.cliente_nombre, monto: r.resultadoCliente, individual: true, grupo: j.id }, { nombre: 'TABLAS FIJAS', monto: r.tablasFijas, individual: true, grupo: j.id }]
      };
    }
    // Marca
    if (!esMarcaDecidible(pizarra, esNacional)) {
      return { id: j.id, cliente: j.cliente_nombre, tipo: 'marca', estadoNuevo: 'sin_decidir', monto: Number(j.monto), gano: null, resultadoCliente: 0, comision: 0, movimientos: [] };
    }
    const c = resolverClienteMarca({ numero1: j.numero1, numero2: j.numero2, monto: Number(j.monto) }, rank);
    // NULA (28-09-2026, ver la nota grande de resolverClienteMarca): con
    // pizarra completa, si NINGUNO de los 2 caballos de esta marca
    // puntual figuró, no hay banqueo que asignar ni ganador que pagar —
    // se resuelve de una con 0 para todos, mismo tratamiento que
    // 'sin_decidir' (no entra a "Pendientes", entra a Balance con 0).
    if (c.nula) {
      return { id: j.id, cliente: j.cliente_nombre, tipo: 'marca', estadoNuevo: 'sin_decidir', monto: Number(j.monto), gano: null, resultadoCliente: 0, comision: 0, movimientos: [] };
    }
    // BANQUEO AUTOMÁTICO (06-10-2026, "DEBE SALIR EL ITEM DE MARCAS SAMMY Y
    // MARCAS ZENYATTA... IGUAL QUE TABLAS"): si el GRUPO configuró quién
    // banquea sus Marcas (pantalla "Banqueo de Marcas"), la Marca ya
    // decidida se banquea sola con esos banqueadores y queda 'resuelto' --
    // ver banqueoAutomaticoMarca. Si la jugada ya tenía banqueadores puestos
    // a mano (recálculo por corrección de pizarra) se conservan esos. Un
    // grupo SIN configuración queda 'falta_banqueo' como siempre.
    const banqueo = banqueoAutomaticoMarca({ acierta: c.acierta, base: c.acierta ? c.resultadoCliente : Number(j.monto) }, pctJugada(j), banqueadoresJugada(j), configBanqueoMarcas);
    return {
      id: j.id, cliente: j.cliente_nombre, tipo: 'marca', estadoNuevo: banqueo ? 'resuelto' : 'falta_banqueo', monto: Number(j.monto),
      gano: c.acierta, resultadoCliente: c.resultadoCliente, comision: banqueo ? banqueo.comisionMarcas : null, banqueadores: banqueo ? banqueo.banqueadores : null,
      // "MARCAS" espejo genérico en el TEXTO del plano (04-10-2026, a
      // pedido del usuario: "esos 120 que pierde falta quien los gana...
      // las marcas las banquea 2 clientes que debes crear en balances...
      // esos dos clientes son MARCAS ZENYATTA Y MARCAS SAMMY... ASI YA
      // QUE QUIENES BANQUEAN ES INFORMACIÓN PERSONAL DEL GRUPO LOS
      // CLIENTES NO DEBEN VERLO"). El banqueo REAL (con los banqueadores
      // reales, su %, y quién paga comisión -- ver resolverBanqueoMarca)
      // siempre pasa DESPUÉS, como un paso manual aparte (POST
      // /adelantadas/jugadas/:id/banquear) — en el momento en que se
      // genera ESTE texto (justo al cargar la pizarra) todavía no se
      // sabe quién banquea, así que mostrar los nombres reales acá no
      // es posible, y además el usuario no quiere que el cliente los
      // vea. Mismo patrón EXACTO que ya usa Tabla Fija más arriba
      // (movimientos: [cliente, 'TABLAS FIJAS']) — "MARCAS" es un
      // nombre fijo y genérico, nunca cambia aunque después se banquee
      // entre 1, 2 o más personas reales, y el texto del plano YA
      // enviado nunca se reconstruye con el banqueo real (ver la nota
      // grande de armarBloqueAdelantadas). SIN descontar ningún % ("LAS
      // MARCAS NO SE LE DESCUENTA % X ESO SALE ASI NETO EN EL PLANO") —
      // exactamente lo opuesto a resultadoCliente, nunca más ni menos.
      movimientos: [{ nombre: j.cliente_nombre, monto: c.resultadoCliente, individual: true, grupo: j.id }, { nombre: 'MARCAS', monto: round2(-c.resultadoCliente), individual: true, grupo: j.id }]
    };
  })(j); r.sinComision = !!j.sin_comision; return r; });

  const movimientosParaTexto = [];
  resueltas.forEach(r => movimientosParaTexto.push(...r.movimientos));
  return { resueltas, movimientosParaTexto };
}

// Persiste la resolución ya calculada arriba — SOLO la llama POST /planos
// (guardar de verdad), nunca /planos/calcular (vista previa).
async function guardarResolucionAdelantadas(client, req, resueltas, pizarra) {
  for (const r of resueltas) {
    await client.query(
      // banqueadores (06-10-2026): si el grupo configuró su banqueo
      // automático (o la Marca ya tenía banqueadores manuales), la Marca
      // decidida llega acá YA banqueada (r.banqueadores) -- se guarda de una.
      // Para TF, 'sin_decidir' y nula r.banqueadores no existe y queda NULL
      // (así una jugada que deja de estar decidida nunca arrastra un
      // banqueadores viejo de la pizarra ERRADA, mismo criterio de
      // siempre: "editar recalcula TODO el dinero desde cero").
      `UPDATE hipismo_adelantadas_jugadas
          SET estado = $1, gano = $2, resultado_cliente = $3, comision = $4, pizarra_usada = $5, resuelto_en = now(), banqueadores = $8
        WHERE id = $6 AND grupo_id = $7`,
      [r.estadoNuevo, r.gano, r.resultadoCliente, r.comision, pizarra, r.id, req.grupoId, r.banqueadores ? JSON.stringify(r.banqueadores) : null]
    );
  }
}

// =================================================================
// "Jugadas entre Tercios Adelantadas" (04-10-2026) — mismo patrón de
// buscar/calcular/guardar que Tablas Fijas/Marcas arriba, pero usando
// el motor de services/hipismoTerciosAdelantadasCalc.js. Nunca se
// intenta resolver una jugada con falta_monto/falta_jugador/
// falta_banquero (filtro en la consulta) — esas quedan 'pendiente' con
// su error hasta que el operador las corrija (PUT /tercios-adelantadas/
// jugadas/:id).
async function buscarTerciosAdelantadasPendientes(req, { hipodromoNombre, carreraNumero, fecha }) {
  const r = await db.query(
    `SELECT j.* FROM hipismo_tercios_adelantadas_jugadas j
       JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.hipodromo_nombre = $2 AND j.carrera_numero = $3 AND p.fecha = $4
        AND j.estado = 'pendiente' AND j.falta_monto = false AND j.falta_jugador = false AND j.falta_banquero = false
      ORDER BY j.creado_en`,
    [req.grupoId, hipodromoNombre, carreraNumero, fecha]
  );
  return r.rows;
}

// Calcula (SIN guardar nada) cómo quedarían las jugadas de esta nueva
// pestaña pendientes de una carrera contra una pizarra — usado tanto
// por la vista previa (POST /planos/calcular) como, con persistencia
// aparte, por POST /planos (guardar). movimientos ya viene en el MISMO
// formato [{nombre,monto}] que usa armarBloqueAdelantadas — a pedido
// del usuario ("ambas pestañas... saldran en el apartado de jugadas
// adelantadas"), estas jugadas se mezclan en el MISMO bloque "PARADA
// ADELANTADAS" del texto, en vez de tener un bloque aparte.
async function calcularResolucionTerciosAdelantadas(req, { hipodromoNombre, carreraNumero, fecha, pizarra, ret }) {
  const pendientes = await buscarTerciosAdelantadasPendientes(req, { hipodromoNombre, carreraNumero, fecha });
  if (!pendientes.length) return { resueltas: [], movimientos: [] };

  const rank = parsearPizarraRank(pizarra);
  const retirados = await obtenerRetiradosCarrera(req, { hipodromoNombre, carreraNumero, fecha, ret });
  const resueltas = pendientes.map(j => {
    // CABALLO RETIRADO => NULA (06-10-2026): misma regla que Marcas/Tablas
    // Fijas -- si algún caballo de la apuesta (grupo o cruce) está en "Ret:",
    // queda 'sin_decidir' (0 jugador, 0 banquero, sin comisión).
    if (apuestaConRetirado(j.es_cruce ? [j.cruce_grupo_a, j.cruce_grupo_b] : [j.grupo_caballos], retirados)) {
      return {
        id: j.id, jugador: j.jugador_nombre, banquero: j.banquero_nombre, estadoNuevo: 'sin_decidir',
        resultadoJugador: 0, resultadoBanquero: 0, comisionGrupo: 0, comisionPorcentaje: Number(j.comision_porcentaje), retirado: true, movimientos: []
      };
    }
    const linea = {
      cruce: j.es_cruce ? { gruposA: j.cruce_grupo_a, gruposB: j.cruce_grupo_b } : null,
      grupo: j.es_cruce ? null : j.grupo_caballos,
      modalidad: j.modalidad,
      monto: Number(j.monto)
    };
    const r = resolverLineaTerciosAdelantada(linea, rank, Number(j.comision_porcentaje));
    if (!r.decidida) {
      return {
        id: j.id, jugador: j.jugador_nombre, banquero: j.banquero_nombre, estadoNuevo: 'sin_decidir',
        resultadoJugador: 0, resultadoBanquero: 0, comisionGrupo: 0, comisionPorcentaje: Number(j.comision_porcentaje), movimientos: []
      };
    }
    return {
      id: j.id, jugador: j.jugador_nombre, banquero: j.banquero_nombre, estadoNuevo: 'resuelto',
      resultadoJugador: round2(r.montoJugadorMostrado), resultadoBanquero: round2(r.montoBanqueroMostrado), comisionGrupo: round2(r.comisionGrupo),
      comisionPorcentaje: Number(j.comision_porcentaje),
      movimientos: [{ nombre: j.jugador_nombre, monto: r.montoJugadorMostrado }, { nombre: j.banquero_nombre, monto: r.montoBanqueroMostrado }]
    };
  });

  const movimientos = [];
  resueltas.forEach(r => movimientos.push(...r.movimientos));
  return { resueltas, movimientos };
}

// Persiste la resolución ya calculada arriba — SOLO la llama POST
// /planos (guardar de verdad), nunca /planos/calcular (vista previa).
async function guardarResolucionTerciosAdelantadas(client, req, resueltas, pizarra) {
  for (const r of resueltas) {
    await client.query(
      `UPDATE hipismo_tercios_adelantadas_jugadas
          SET estado = $1, resultado_jugador = $2, resultado_banquero = $3, comision_grupo = $4, pizarra_usada = $5, resuelto_en = now()
        WHERE id = $6 AND grupo_id = $7`,
      [r.estadoNuevo, r.resultadoJugador, r.resultadoBanquero, r.comisionGrupo, pizarra, r.id, req.grupoId]
    );
  }
}

// Mezcla las jugadas de esta pestaña ya resueltas en el mismo Balance
// General que arma hipismoCalc.js — a diferencia de Tablas Fijas (que
// necesita la cuenta "espejo" TABLAS FIJAS porque el cliente juega
// contra "la banca"), acá jugador y banquero ya son 2 clientes reales
// que suman 0 entre ellos solos menos la comisión del grupo — por eso
// el ítem "% TERCIOS ADELANTADAS" (mismo criterio que "% DE TABLAS
// FIJAS": NO se vuelve a sumar al total "Comisión" del pie, para no
// contarla 2 veces — queda representada solo en este ítem).
function mezclarTerciosAdelantadasEnBalance(totalesFinales, resueltasTercios) {
  const totales = Object.assign({}, totalesFinales);
  resueltasTercios.forEach(r => {
    if (r.estadoNuevo !== 'resuelto') return;
    totales[r.jugador] = round2((totales[r.jugador] || 0) + r.resultadoJugador);
    totales[r.banquero] = round2((totales[r.banquero] || 0) + r.resultadoBanquero);
    if (r.comisionGrupo) {
      totales['% TERCIOS ADELANTADAS'] = round2((totales['% TERCIOS ADELANTADAS'] || 0) + r.comisionGrupo);
    }
  });
  return totales;
}

function filaJugadaTerciosAdelantadaPublica(j) {
  return {
    id: j.id,
    jugador: j.jugador_nombre,
    banquero: j.banquero_nombre,
    carreraNumero: j.carrera_numero,
    esCruce: j.es_cruce,
    grupoCaballos: j.grupo_caballos,
    cruceGrupoA: j.cruce_grupo_a,
    cruceGrupoB: j.cruce_grupo_b,
    modalidad: j.modalidad,
    monto: j.monto != null ? Number(j.monto) : null,
    comisionPorcentaje: Number(j.comision_porcentaje),
    textoOriginal: j.texto_original,
    faltaMonto: j.falta_monto,
    faltaJugador: j.falta_jugador,
    faltaBanquero: j.falta_banquero,
    estado: j.estado,
    resultadoJugador: j.resultado_jugador != null ? Number(j.resultado_jugador) : null,
    resultadoBanquero: j.resultado_banquero != null ? Number(j.resultado_banquero) : null,
    comisionGrupo: j.comision_grupo != null ? Number(j.comision_grupo) : null,
    pizarraUsada: j.pizarra_usada,
    hipodromoNombre: j.hipodromo_nombre,
    fecha: j.fecha,
    creadoEn: j.creado_en
  };
}

// 23-09-2026, a pedido del usuario ("en balance no me estas cargando los
// saldos de las jugadas adelantadas.... debes sumarle en la carrera
// correspondiente si el cliente gana o pierde... y se va colocando
// positivo a marcas... tambien tablas fijas, su saldo por carrera
// detallado"): las jugadas adelantadas que se resuelven al cargar el
// plano de ESA MISMA carrera (Tablas Fijas completa, o el lado del
// cliente de una Marca que quedó 'falta_banqueo') tienen que verse
// reflejadas en el mismo Balance General/vista previa que ya arma
// hipismoCalc.js para los Tercios de esa carrera — no solo en el bloque
// de texto "PARADA ADELANTADAS". Esto SOLO afecta lo que se le devuelve
// al operador en la respuesta (para pintar Balance General): lo que se
// guarda en hipismo_planos.comision_total sigue siendo nada más la
// comisión de Tercios (columna que usa "Comisiones por Carrera"), así
// que acá adentro no se toca `resultado` ni lo que se inserta en la base.
//
// 23-09-2026 (undécima ronda), a pedido del usuario ("en balance no me
// estas cargando... necesito me coloques el resultado de las tablas SIN
// el 2.5% y ese 2.5% aparte en un item llamado % de tablas fijas ya que
// ese 2.5% es comision para el grupo"): el bloque "PARADA ADELANTADAS"
// del plano de WhatsApp (armarBloqueAdelantadas, más abajo) SIGUE
// mostrando "Tablas fijas" combinado (pago al cliente + comisión juntos,
// sin cambios ahí — el usuario confirmó que ESE quedó "excelente"). Pero
// ACÁ, en Balance General, se separan en 2 ítems distintos: "TABLAS
// FIJAS" ahora es SOLO el espejo exacto de lo que le tocó al cliente (sin
// comisión adentro), y la comisión de Tablas Fijas tiene su PROPIO ítem
// aparte, "% DE TABLAS FIJAS" — para que se vea de un vistazo cuánto es
// plata que se movió con el cliente y cuánto es comisión del grupo. El
// total "Comisión" del pie de Balance General SIGUE sumando también esta
// comisión (sin cambios ahí) — este ítem nuevo es una vista adicional,
// no un reemplazo.
function mezclarAdelantadasEnBalance(totalesFinales, comisionTotal, resueltas) {
  const totales = Object.assign({}, totalesFinales);
  let comision = comisionTotal;

  resueltas.forEach(r => {
    totales[r.cliente] = round2((totales[r.cliente] || 0) + r.resultadoCliente);

    if (r.tipo === 'tf' && Array.isArray(r.banqueadores)) {
      // TF CON BANQUEADORES del grupo (06-10-2026): cada banquero suma su propio
      // renglón (ya neto de la comisión que paga) en vez del ítem "TABLAS
      // FIJAS"; la comisión (cliente + banqueadores + comisión = 0) va al pie.
      r.banqueadores.forEach(b => { totales[b.nombre] = round2((totales[b.nombre] || 0) + b.monto); });
      if (r.comision) comision = round2(comision + r.comision);
    } else if (r.tipo === 'tf') {
      // NETO de su propia comisión (28-09-2026, mismo arreglo que
      // /cierre-final más abajo, encontrado por el usuario ahí primero):
      // antes esto restaba solo r.resultadoCliente (bruto) y además
      // sumaba r.comision aparte al footer "comisión" — eso dejaba la
      // comisión "de más" sin contraparte en este mismo Balance (cliente
      // + "TABLAS FIJAS" + "% DE TABLAS FIJAS" NO sumaban 0) y la pagaba
      // 2 veces (una en "% DE TABLAS FIJAS", otra en el footer). Mismo
      // invariante que resolverTablaFija: cliente + tablasFijas + comisión
      // = 0 exacto — la comisión NO se vuelve a sumar al footer `comision`
      // acá, porque ya queda representada en el ítem "% DE TABLAS FIJAS".
      totales['TABLAS FIJAS'] = round2((totales['TABLAS FIJAS'] || 0) - (r.resultadoCliente + (r.comision || 0)));
      if (r.comision) {
        totales['% DE TABLAS FIJAS'] = round2((totales['% DE TABLAS FIJAS'] || 0) + r.comision);
      }
    }

    // MARCAS (06-10-2026, "DEBE SALIR EL ITEM DE MARCAS SAMMY Y MARCAS
    // ZENYATTA... IGUAL QUE TABLAS"): cada banquero de la Marca (ya sea el
    // automático MARCAS ZENYATTA/MARCAS SAMMY o uno manual) suma su propio
    // renglón, ya neto de la comisión que pague -- igual que
    // construirCierreFinalHipismo. La comisión de Marcas (cliente +
    // banqueadores + comisión = 0) se suma al footer `comision`, como ya
    // hace Cierre Final con COMISIÓN GRUPO.
    if (r.tipo === 'marca' && Array.isArray(r.banqueadores)) {
      r.banqueadores.forEach(b => { totales[b.nombre] = round2((totales[b.nombre] || 0) + b.monto); });
      if (r.comision) comision = round2(comision + r.comision);
    }
  });

  return { totales, comision };
}

// obtenerComisionesPropias, crearYLinkearCuentaComision,
// asegurarCuentasComisionParaNombres y agregarPorcentajeDevuelto ("%
// DEVUELTO" POR CLIENTE — cuentas de comisión, ver la nota grande de
// obtenerComisionesPropias) se movieron a
// services/hipismoComisionPropia.js (26-09-2026, al arreglar "LOS LINK
// DE % NO DAN SALDO DICEN 0", para que services/hipismoResumenCliente.js
// también pueda calcular el saldo real de una cuenta de comisión sin
// duplicar esta lógica) — se importan arriba, mismo nombre, mismo
// comportamiento.

// =================================================================
// PLANOS — "Cargar Planos" (spec secciones 1, 5, 6, 7)
// =================================================================
// POST /planos/calcular: calcula SIN guardar — para la vista previa del
// botón "Calcular" antes de decidir si se guarda de verdad.
router.post('/planos/calcular', asyncHandler(async (req, res) => {
  const { texto, pizarra, cruzaJugadas, hipodromoNombre, carreraNumero, ret, fecha, valoresSinComision } = req.body;
  if (!pizarra || !pizarra.trim()) return res.status(400).json({ error: 'Falta la Pizarra (orden de llegada).' });

  const fechaFinal = fecha || fechaHoyVenezuela();
  const { resueltas, movimientosParaTexto } = (hipodromoNombre && carreraNumero)
    ? await calcularResolucionAdelantadas(req, { hipodromoNombre, carreraNumero, fecha: fechaFinal, pizarra, ret })
    : { resueltas: [], movimientosParaTexto: [] };
  // "Jugadas entre Tercios Adelantadas" (04-10-2026) — mismo gancho que
  // Tablas Fijas/Marcas arriba, resuelve sus pendientes de ESTA MISMA
  // carrera contra la pizarra que se está calculando. Sus movimientos se
  // mezclan en el MISMO array que alimenta "PARADA ADELANTADAS" (a
  // pedido del usuario: "saldran en el apartado de jugadas adelantadas").
  const { resueltas: resueltasTercios, movimientos: movimientosTercios } = (hipodromoNombre && carreraNumero)
    ? await calcularResolucionTerciosAdelantadas(req, { hipodromoNombre, carreraNumero, fecha: fechaFinal, pizarra, ret })
    : { resueltas: [], movimientos: [] };
  movimientosParaTexto.push(...movimientosTercios);

  const huboTexto = !!(texto && texto.trim());
  if (!huboTexto && resueltas.length === 0 && resueltasTercios.length === 0) {
    return res.status(400).json({ error: 'Falta el texto del plano.' });
  }

  const resultado = huboTexto
    ? calcularPlano({ texto, pizarra, cruzar: !!cruzaJugadas, valoresSinComision: parsearValoresSinComision(valoresSinComision) })
    : { huboLineas: false, salidaLineas: [], sinReconocer: [], tickets: [], totalesFinales: {}, comisionTotal: 0 };
  if (huboTexto && !resultado.huboLineas) {
    return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto — revisa el formato de las líneas.' });
  }
  // Cliente/banquero que no exista = error ya en "Calcular" (no se crea solo).
  if (await rechazarClientesInexistentes(req, res, resultado.tickets.flatMap(t => [t.clienteNombre, t.banqueroNombre]))) return;

  const bloqueAdelantadas = armarBloqueAdelantadas(movimientosParaTexto);
  // 23-09-2026, a pedido del usuario (pegó un plano real donde el aviso
  // "PLANO REFERENCIAL" quedaba en el medio del mensaje, arriba de
  // "PARADA ADELANTADAS", en vez de al final de todo): cuando esta
  // carrera SÍ tiene bloque de adelantadas, el pie se omite acá adentro
  // (incluirPie:false) y se agrega DESPUÉS del bloque, para que quede
  // siempre como lo último del mensaje.
  let textoResultado = armarTextoResultado({
    nombreGrupo: req.grupo.nombre,
    hipodromoNombre: hipodromoNombre || '',
    carreraNumero: carreraNumero || '',
    ret,
    pizarra,
    salidaLineas: resultado.salidaLineas,
    totalesFinales: resultado.totalesFinales,
    incluirPie: !bloqueAdelantadas,
    // "Total Jugadas: N" (23-09-2026) — ver la nota grande en
    // hipismoCalc.js/armarTextoResultado. Cuenta los tickets de Tercios de
    // ESTA carrera puntual (huboTexto puede ser false si el plano solo
    // trajo la pizarra para resolver adelantadas — ahí tickets.length ya
    // da 0 solo, sin necesitar chequear huboTexto acá).
    totalJugadas: resultado.tickets.length
  });
  if (bloqueAdelantadas) {
    textoResultado += '\n\n' + bloqueAdelantadas + '\n------------------------------\n------------------------------\n' + PIE_PLANO_DEFECTO;
  }

  const balance = mezclarAdelantadasEnBalance(resultado.totalesFinales, resultado.comisionTotal, resueltas);
  balance.totales = mezclarTerciosAdelantadasEnBalance(balance.totales, resueltasTercios);

  // 23-09-2026, a pedido del usuario ("un item llama pedro - porcentaje
  // alli es donde vas a colocar ese porcentaje que se va ganando el
  // cliente carrera a carrera"): se calcula sobre lo APOSTADO en esta
  // carrera puntual (tickets de Tercios, lado jugador, + el monto de las
  // adelantadas que se resolvieron acá) para cualquier cliente con % propio
  // configurado (jugadores.comision_propia) — nunca toca el resultado
  // normal del cliente, solo agrega su propio ítem aparte.
  //
  // TAMBIÉN EL LADO BANQUERO (29-09-2026, caso real: "ya hay un
  // Mrincreible en Clientes con los % correspondientes y el Mrincreible
  // de Balances no muestra %" — Mrincreible resultó ser el BANQUERO de
  // esa jugada de Tercios, no el cliente; hasta esta ronda
  // entradasApostadas solo miraba clienteNombre, así que su % propio y el
  // de sus avales nunca se calculaban para lo que banqueó, a propósito
  // desde el 23-09-2026 — el usuario confirmó que ahora SÍ quiere que
  // cuente, y después que también cuente banqueando una Marca de Jugadas
  // Adelantadas — mismo criterio ya aplicado acá abajo en POST /planos
  // (el guardado real) y en /cierre-final, /saldo-comisiones y
  // /semana-por-dias).
  //
  // NUNCA una jugada que "no se decidió" (29-09-2026, a pedido explícito
  // del usuario: "toda jugada que no se decida no genera % ni
  // comisión"): un ticket de Tercios con una Marca "pp"/"a premio" donde
  // ningún caballo figuró (ver resolverCruzado() en hipismoCalc.js) queda
  // con resultadoJugador Y resultadoBanquero en 0 -- se descarta de
  // entradasApostadas por completo, para que su monto apostado NO genere
  // % propio/de aval para nadie (ni cliente ni banquero). Lo mismo para
  // una Marca de Jugadas Adelantadas resuelta 'sin_decidir' (nula, ver
  // resolverClienteMarca en hipismoAdelantadasCalc.js): r.gano queda en
  // null SOLO en ese caso (Tabla Fija siempre decide true/false), así que
  // filtrar por "r.gano !== null" descarta justo esas sin afectar Tabla
  // Fija ni una Marca sí decidida.
  // montoDecidido (02-10-2026, "LOS % QUE SE DEVUELVEN ES DE LO DECIDIDO NO
  // DE LO APOSTADO... SIEMPRE ES BASE A LO DECIDIDO SIN SACARLE EL 5%" —
  // ver la nota grande de montoDecidido() en services/hipismoAdelantadasCalc.js):
  // NUNCA t.monto (lo apostado bruto) — en una jugada fraccionada ("10A4")
  // el que gana solo decide una fracción del monto apostado. Jugadas
  // Adelantadas resueltas acá (r.resultadoCliente) ya es un neto
  // DEFINITIVO sin ningún 5% embebido, así que montoDecidido con
  // sinComision=true simplemente lo deja en valor absoluto.
  const entradasApostadas = entradasApostadasDeTickets(resultado.tickets, resueltas, resueltasTercios);
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, entradasApostadas.map(e => e.nombre));
  agregarPorcentajeDevuelto(balance.totales, comisionesPropias, entradasApostadas);

  res.json({
    textoResultado,
    totalesFinales: balance.totales,
    comisionTotal: balance.comision,
    sinReconocer: resultado.sinReconocer,
    cantidadTickets: resultado.tickets.length,
    adelantadasResueltas: resueltas.map(r => ({ cliente: r.cliente, tipo: r.tipo, estado: r.estadoNuevo, gano: r.gano, resultadoCliente: r.resultadoCliente })),
    terciosAdelantadasResueltas: resueltasTercios.map(r => ({ jugador: r.jugador, banquero: r.banquero, estado: r.estadoNuevo, resultadoJugador: r.resultadoJugador, resultadoBanquero: r.resultadoBanquero }))
  });
}));

// POST /planos: calcula Y guarda de verdad (hipismo_planos + hipismo_tickets).
router.post('/planos', asyncHandler(async (req, res) => {
  const { texto, pizarra, cruzaJugadas, hipodromoId, hipodromoNombre, carreraNumero, ret, fecha, valoresSinComision } = req.body;
  if (!pizarra || !pizarra.trim()) return res.status(400).json({ error: 'Falta la Pizarra (orden de llegada).' });
  if (!carreraNumero) return res.status(400).json({ error: 'Falta el número de carrera.' });

  let nombreHipodromoFinal = hipodromoNombre;
  if (hipodromoId) {
    const rh = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2', [hipodromoId, req.grupoId]);
    if (rh.rows.length === 0) return res.status(400).json({ error: 'Hipódromo no encontrado.' });
    nombreHipodromoFinal = rh.rows[0].nombre;
  }
  if (!nombreHipodromoFinal) return res.status(400).json({ error: 'Falta el hipódromo.' });

  const fechaFinal = fecha || fechaHoyVenezuela();

  // "SUSTITUIR EN VEZ DE DUPLICAR" (29-09-2026, a pedido del usuario: "si
  // se vuelve a meter un plano en una carrera que ya existía, el nuevo
  // siempre sustituya al anterior, no duplique las carreras") — antes de
  // esta ronda, cargar 2 veces la misma carrera (mismo hipódromo +
  // carrera + fecha) dejaba 2 planos vivos a la vez, y Balance General/
  // Cierre Final sumaban los 2 (duplicando esa carrera). Si YA existe un
  // plano para este mismo hipódromo/carrera/fecha, se manda a la Papelera
  // (hipismoPlanosPapelera.eliminarPlano — MISMO criterio que "Eliminar
  // Planos": recuperable 30 días, nunca un borrado definitivo, ver la
  // nota grande de ese archivo) ANTES de guardar el plano nuevo, para que
  // solo quede UNO vivo — el más reciente. Puede haber más de un plano
  // viejo coincidiendo (no debería, pero por las dudas se sustituyen
  // TODOS los que calcen).
  const rPlanosExistentes = await db.query(
    `SELECT id FROM hipismo_planos WHERE grupo_id = $1 AND hipodromo_nombre = $2 AND carrera_numero = $3 AND fecha = $4`,
    [req.grupoId, nombreHipodromoFinal, carreraNumero, fechaFinal]
  );
  for (const fila of rPlanosExistentes.rows) {
    await hipismoPlanosPapelera.eliminarPlano(req.grupoId, fila.id);
  }

  // Jugadas Adelantadas pendientes de ESTA MISMA carrera (ver la nota
  // grande arriba) — se resuelven con la pizarra que se está por guardar
  // acá, existan o no líneas normales de Tercios en este plano.
  const { resueltas, movimientosParaTexto } = await calcularResolucionAdelantadas(req, { hipodromoNombre: nombreHipodromoFinal, carreraNumero, fecha: fechaFinal, pizarra, ret });
  // "Jugadas entre Tercios Adelantadas" (04-10-2026) — mismo gancho, ver
  // la nota grande en POST /planos/calcular.
  const { resueltas: resueltasTercios, movimientos: movimientosTercios } = await calcularResolucionTerciosAdelantadas(req, { hipodromoNombre: nombreHipodromoFinal, carreraNumero, fecha: fechaFinal, pizarra, ret });
  movimientosParaTexto.push(...movimientosTercios);

  // 23-09-2026, a pedido del usuario ("si llega a quedar alguna jugada
  // adelantada... sin nada... en darle a cargar así no pegue nada, jale
  // la jugada adelantada"): un plano sin texto YA NO es un error si hay
  // adelantadas pendientes de esa carrera — sirve para resolverlas solas
  // aunque nadie haya jugado nada "en vivo" en esa carrera puntual.
  const huboTexto = !!(texto && texto.trim());
  if (!huboTexto && resueltas.length === 0 && resueltasTercios.length === 0) {
    return res.status(400).json({ error: 'Falta el texto del plano.' });
  }
  const resultado = huboTexto
    ? calcularPlano({ texto, pizarra, cruzar: !!cruzaJugadas, valoresSinComision: parsearValoresSinComision(valoresSinComision) })
    : { huboLineas: false, salidaLineas: [], sinReconocer: [], tickets: [], totalesFinales: {}, comisionTotal: 0 };
  if (huboTexto && !resultado.huboLineas) {
    return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto — revisa el formato de las líneas.' });
  }

  const bloqueAdelantadas = armarBloqueAdelantadas(movimientosParaTexto);
  // Ver la nota grande en POST /planos/calcular: el pie "PLANO
  // REFERENCIAL" se omite acá adentro cuando hay adelantadas para que
  // quede siempre como lo ÚLTIMO del mensaje, después de "PARADA
  // ADELANTADAS".
  let textoResultado = armarTextoResultado({
    nombreGrupo: req.grupo.nombre,
    hipodromoNombre: nombreHipodromoFinal,
    carreraNumero,
    ret,
    pizarra,
    salidaLineas: resultado.salidaLineas,
    totalesFinales: resultado.totalesFinales,
    incluirPie: !bloqueAdelantadas,
    totalJugadas: resultado.tickets.length
  });
  if (bloqueAdelantadas) {
    textoResultado += '\n\n' + bloqueAdelantadas + '\n------------------------------\n------------------------------\n' + PIE_PLANO_DEFECTO;
  }

  // Da de alta en "jugadores" a cualquier cliente/banquero de este plano
  // que todavía no esté registrado en el grupo — mismo criterio y misma
  // tabla que ya usa Deportes (ver el require de arriba). Los nombres ya
  // vienen en MAYÚSCULA desde hipismoCalc.js, así que "Mujica"/"MUJICA"/
  // "mujica" en planos distintos siempre resuelven al mismo registro
  // (ON CONFLICT (grupo_id, nombre) DO NOTHING adentro de la función).
  const nombresDelPlano = new Set();
  resultado.tickets.forEach(t => { nombresDelPlano.add(t.clienteNombre); nombresDelPlano.add(t.banqueroNombre); });
  resueltas.forEach(r => nombresDelPlano.add(r.cliente));
  if (await rechazarClientesInexistentes(req, res, Array.from(nombresDelPlano))) return;

  // Alerta de pozo (07-10-2026): lo apostado por cada cliente en los Tercios
  // de esta carga, medido ANTES de guardar para no contar dos veces el
  // resultado de este mismo plano. (Las Adelantadas se revisan cuando se
  // cargan, no al resolverse, para no avisar dos veces la misma apuesta.)
  const alertasPozo = await alertarApuestasSobrePozo(req, {
    apuestas: resultado.tickets.map(t => ({ nombre: t.clienteNombre, monto: t.monto })),
    hipodromoNombre: nombreHipodromoFinal, carreraNumero, fecha: fechaFinal,
    etiqueta: `${nombreHipodromoFinal} carrera ${carreraNumero}`
  });

  const plano = await db.transaccion(async (client) => {
    const rPlano = await client.query(
      `INSERT INTO hipismo_planos (grupo_id, hipodromo_id, hipodromo_nombre, carrera_numero, fecha, ret, pizarra, cruza_jugadas, texto_original, texto_resultado, comision_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.grupoId, hipodromoId || null, nombreHipodromoFinal, carreraNumero, fechaFinal, ret || null, pizarra, !!cruzaJugadas, texto || '', textoResultado, resultado.comisionTotal]
    );
    const planoCreado = rPlano.rows[0];

    for (const t of resultado.tickets) {
      await client.query(
        `INSERT INTO hipismo_tickets (plano_id, grupo_id, cliente_nombre, banquero_nombre, modalidad, caballo, monto, resultado_jugador, resultado_banquero, sin_comision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [planoCreado.id, req.grupoId, t.clienteNombre, t.banqueroNombre, t.modalidad, t.caballo, t.monto, t.resultadoJugador, t.resultadoBanquero, !!t.sinComision]
      );
    }
    if (resueltas.length) await guardarResolucionAdelantadas(client, req, resueltas, pizarra);
    if (resueltasTercios.length) await guardarResolucionTerciosAdelantadas(client, req, resueltasTercios, pizarra);
    return planoCreado;
  });

  const balance = mezclarAdelantadasEnBalance(resultado.totalesFinales, resultado.comisionTotal, resueltas);
  balance.totales = mezclarTerciosAdelantadasEnBalance(balance.totales, resueltasTercios);

  // Ver la nota grande en POST /planos/calcular — mismo cálculo de "%
  // devuelto" acá, sobre lo que de verdad se guardó en este plano
  // (incluido el lado BANQUERO, y excluyendo cualquier jugada que no se
  // decidió, ver la nota grande 29-09-2026 en /planos/calcular). A
  // diferencia de la vista previa, ACÁ SÍ se asegura la cuenta de
  // comisión real de cada destino ANTES de leer obtenerComisionesPropias
  // (26-09-2026, ver la nota grande de esa función) — recién cuando el
  // plano se guarda de verdad, nunca en un "Calcular" que el operador
  // después no confirma.
  // Ver la nota grande de montoDecidido() en /planos/calcular — NUNCA
  // t.monto (lo apostado bruto), la base del % propio/de aval es siempre
  // lo DECIDIDO en esa jugada puntual, sin sacarle el 5%.
  const entradasApostadas = entradasApostadasDeTickets(resultado.tickets, resueltas, resueltasTercios);
  const nombresApostados = entradasApostadas.map(e => e.nombre);
  await asegurarCuentasComisionParaNombres(req.grupoId, nombresApostados);
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, nombresApostados);
  agregarPorcentajeDevuelto(balance.totales, comisionesPropias, entradasApostadas);

  res.status(201).json({
    plano,
    totalesFinales: balance.totales,
    comisionTotal: balance.comision,
    sinReconocer: resultado.sinReconocer,
    // hipódromo/carrera/fecha de ESTE plano — el frontend los guarda junto
    // a Balance General para saber, más adelante, si el banqueo de una
    // Marca (POST /adelantadas/jugadas/:id/banquear) pertenece a la MISMA
    // carrera que se está mostrando y hay que sumarle en vivo, o si ya se
    // pasó a otra carrera (ver enviarBanqueo() en hipismo-mockup.html).
    hipodromoNombre: nombreHipodromoFinal,
    carreraNumero: Number(carreraNumero),
    fecha: fechaFinal,
    // sustituyoAnterior (29-09-2026): true cuando ya existía un plano
    // para este mismo hipódromo/carrera/fecha y se mandó a la Papelera
    // para dejar solo el nuevo vivo (ver la nota grande de arriba) — el
    // frontend lo puede usar para avisar "se sustituyó el plano anterior
    // de esta carrera" en vez de un simple "plano guardado".
    sustituyoAnterior: rPlanosExistentes.rows.length > 0,
    alertasPozo,
    adelantadasResueltas: resueltas.map(r => ({ cliente: r.cliente, tipo: r.tipo, estado: r.estadoNuevo, gano: r.gano, resultadoCliente: r.resultadoCliente })),
    terciosAdelantadasResueltas: resueltasTercios.map(r => ({ jugador: r.jugador, banquero: r.banquero, estado: r.estadoNuevo, resultadoJugador: r.resultadoJugador, resultadoBanquero: r.resultadoBanquero }))
  });
}));

// GET /planos?fecha=&hipodromoId=&limite= : historial reciente (cabeceras).
router.get('/planos', asyncHandler(async (req, res) => {
  const { fecha, hipodromoId, limite } = req.query;
  const condiciones = ['grupo_id = $1'];
  const params = [req.grupoId];
  if (fecha) { params.push(fecha); condiciones.push(`fecha = $${params.length}`); }
  if (hipodromoId) { params.push(hipodromoId); condiciones.push(`hipodromo_id = $${params.length}`); }
  params.push(Math.min(parseInt(limite, 10) || 50, 200));
  const r = await db.query(
    `SELECT id, hipodromo_nombre, carrera_numero, fecha, cruza_jugadas, comision_total, creado_en
       FROM hipismo_planos WHERE ${condiciones.join(' AND ')} ORDER BY creado_en DESC LIMIT $${params.length}`,
    params
  );
  res.json(r.rows);
}));

// =================================================================
// "ELIMINAR PLANOS" — papelera recuperable (23-09-2026, a pedido del
// usuario: "en apuestas crea un boton de eliminar planos, alli me
// saldran todos los planos, yo seleccionare la fecha que quiero que me
// muestre y despues se desplegaran ordenados por hipodromos por carrera
// todos los planos"). Ver la nota grande en
// services/hipismoPlanosPapelera.js. GET /planos (arriba) ya sirve para
// "todos los planos, filtrables por fecha" — el frontend los agrupa por
// hipódromo>carrera; acá solo hace falta borrar (a la Papelera) y
// listar/restaurar la Papelera.
//
// OJO: "GET /planos/papelera" va ANTES de "GET /planos/:id" (más arriba)
// para que Express no intente matchear "papelera" como si fuera un :id
// — mismo criterio ya usado para "GET /adelantadas/pendientes".
router.get('/planos/papelera', asyncHandler(async (req, res) => {
  const filas = await hipismoPlanosPapelera.listarPapelera(req.grupoId);
  res.json(filas);
}));

// GET /planos/dias : fechas distintas con planos guardados, para la
// pantalla "Eliminar Planos" rediseñada (23-09-2026, duodécima-tercera
// ronda, a pedido del usuario: "al entrar alli vere ordenado por dia,
// al seleccionar el dia ordenado por hipodromo, los planos") — la
// pantalla arranca mostrando SOLO los días que tienen algo, sin pedirle
// al usuario que adivine o tipee una fecha a ciegas. OJO: va ANTES de
// "GET /planos/:id" para que Express no intente matchear "dias" como si
// fuera un :id — mismo criterio ya usado arriba para "papelera".
router.get('/planos/dias', asyncHandler(async (req, res) => {
  const r = await db.query(
    `SELECT fecha, COUNT(*)::int AS cantidad
       FROM hipismo_planos
      WHERE grupo_id = $1
      GROUP BY fecha
      ORDER BY fecha DESC
      LIMIT 120`,
    [req.grupoId]
  );
  res.json(r.rows.map(row => ({
    fecha: row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha,
    cantidad: row.cantidad
  })));
}));

// GET /planos/buscar-pizarra?hipodromoNombre=&carreraNumero=&fecha= : busca
// si YA existe un plano guardado para esa combinación exacta de
// hipódromo+carrera+fecha (29-09-2026, a pedido del usuario: "en la
// pizarras si ya coloque alguna pizarra en esa carrera, al seleccionar la
// carrera colocame la pizarra anterior y colocame un mensaje abajo de la
// pizarra indicando que ya habia colocado llegada anteriormente... igual
// la puedo modificar"). Usa EXACTAMENTE el mismo criterio de búsqueda
// (grupo_id + hipodromo_nombre + carrera_numero + fecha) que ya usa
// POST /planos para decidir "sustituir en vez de duplicar" (ver más
// arriba) — si ese match encuentra un plano viejo para sustituirlo, este
// endpoint tiene que encontrar el mismo para poder mostrar su pizarra de
// antemano. Antes de "GET /planos/:id" (mismo criterio de orden que
// "papelera"/"dias" arriba: si no, Express intentaría matchear
// "buscar-pizarra" como si fuera un :id). Solo lectura, no toca nada.
router.get('/planos/buscar-pizarra', asyncHandler(async (req, res) => {
  const { hipodromoNombre, carreraNumero, fecha } = req.query;
  if (!hipodromoNombre || !carreraNumero || !fecha) {
    return res.json({ pizarra: null });
  }
  const r = await db.query(
    `SELECT id, pizarra FROM hipismo_planos
      WHERE grupo_id = $1 AND hipodromo_nombre = $2 AND carrera_numero = $3 AND fecha = $4
      ORDER BY creado_en DESC LIMIT 1`,
    [req.grupoId, hipodromoNombre, carreraNumero, fecha]
  );
  if (r.rows.length === 0) return res.json({ pizarra: null });
  res.json({ pizarra: r.rows[0].pizarra, planoId: r.rows[0].id });
}));

// GET /planos/:id : detalle completo (cabecera + tickets), para revisar un plano ya guardado.
router.get('/planos/:id', asyncHandler(async (req, res) => {
  const rPlano = await db.query('SELECT * FROM hipismo_planos WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const plano = rPlano.rows[0];
  if (!plano) return res.status(404).json({ error: 'Plano no encontrado.' });
  const rTickets = await db.query('SELECT * FROM hipismo_tickets WHERE plano_id = $1 ORDER BY creado_en', [plano.id]);
  res.json({ plano, tickets: rTickets.rows });
}));

// PUT /planos/:id/tickets/:ticketId : edita UN ticket puntual de un plano
// ya guardado — "en editar realizare cambios de montos o de jugador, al
// realizar el cambio click a un boton que diga guardar y eso me editara
// el plano anterior de esa carrera y la carrera quedara como se edito
// este" (23-09-2026). Body: { clienteNombre?, banqueroNombre?, monto? }.
// Recalcula el ticket editado con la MISMA pizarra del plano
// (recalcularTicket), y DESPUÉS recompone totalesFinales/comisionTotal de
// TODO el plano (recalcularTotalesPlano) porque en modo "cruza jugadas"
// el % se cobra sobre el neto por persona de todo el plano, no línea por
// línea — ver la nota grande de las 2 funciones en hipismoCalc.js.
//
// texto_resultado (el mensaje ya armado para WhatsApp) SOLO se regenera
// si ese plano NO tiene un bloque "PARADA ADELANTADAS" pegado abajo — si
// lo tiene, se deja tal cual estaba para no arriesgar mezclarlo mal con
// ese bloque (decisión tomada sin volver a preguntar; lo que sí queda
// siempre correcto en los dos casos son los números que alimentan Balance
// General/Comisiones por Carrera/Montos Apostados/Cierre Final, que leen
// directo de hipismo_tickets/hipismo_planos.comision_total, nunca del
// texto guardado).
router.put('/planos/:id/tickets/:ticketId', asyncHandler(async (req, res) => {
  const { clienteNombre, banqueroNombre, monto } = req.body;

  const rPlano = await db.query('SELECT * FROM hipismo_planos WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const plano = rPlano.rows[0];
  if (!plano) return res.status(404).json({ error: 'Plano no encontrado.' });

  const rTicket = await db.query('SELECT * FROM hipismo_tickets WHERE id = $1 AND plano_id = $2', [req.params.ticketId, plano.id]);
  const ticket = rTicket.rows[0];
  if (!ticket) return res.status(404).json({ error: 'Ese ticket no pertenece a este plano.' });

  // 29-09-2026 — mismo criterio que jugadores.js/hipismoCalc.js: colapsa
  // espacios de más entre palabras (ver la nota grande de
  // normalizarNombreJugador() en routes/jugadores.js).
  const clienteFinal = ((clienteNombre || ticket.cliente_nombre) + '').trim().toUpperCase().replace(/\s+/g, ' ');
  const banqueroFinal = ((banqueroNombre || ticket.banquero_nombre) + '').trim().toUpperCase().replace(/\s+/g, ' ');
  const montoFinal = (monto !== undefined && monto !== null && monto !== '') ? Number(monto) : Number(ticket.monto);
  if (!clienteFinal || !banqueroFinal) return res.status(400).json({ error: 'Faltan el cliente y/o el banquero.' });
  if (isNaN(montoFinal) || montoFinal <= 0) return res.status(400).json({ error: 'El monto tiene que ser un número mayor a 0.' });

  const rank = parsearPizarra(plano.pizarra);
  // sin_comision (24-09-2026) viaja tal cual quedó guardado ese ticket al
  // calcular el plano — editar monto/cliente/banquero NUNCA cambia si esa
  // línea va o no sin comisión (eso se decide una sola vez, al calcular).
  const recalculado = recalcularTicket({ modalidad: ticket.modalidad, caballo: ticket.caballo, monto: montoFinal, sinComision: ticket.sin_comision }, rank);
  if (!recalculado) return res.status(400).json({ error: `No se pudo recalcular este ticket (modalidad "${ticket.modalidad}" no reconocida).` });

  const nombresNuevos = [];
  if (clienteFinal !== ticket.cliente_nombre) nombresNuevos.push(clienteFinal);
  if (banqueroFinal !== ticket.banquero_nombre) nombresNuevos.push(banqueroFinal);
  if (nombresNuevos.length) if (await rechazarClientesInexistentes(req, res, nombresNuevos)) return;

  await db.query(
    `UPDATE hipismo_tickets SET cliente_nombre = $1, banquero_nombre = $2, monto = $3, resultado_jugador = $4, resultado_banquero = $5
      WHERE id = $6 AND plano_id = $7`,
    [clienteFinal, banqueroFinal, montoFinal, recalculado.resultadoJugador, recalculado.resultadoBanquero, ticket.id, plano.id]
  );

  const rTodosTickets = await db.query('SELECT * FROM hipismo_tickets WHERE plano_id = $1 ORDER BY creado_en', [plano.id]);
  const ticketsPlanos = rTodosTickets.rows.map(t => ({
    clienteNombre: t.cliente_nombre, banqueroNombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo,
    monto: Number(t.monto), resultadoJugador: Number(t.resultado_jugador), resultadoBanquero: Number(t.resultado_banquero),
    sinComision: !!t.sin_comision
  }));
  const { totalesFinales, comisionTotal } = recalcularTotalesPlano(ticketsPlanos, plano.cruza_jugadas);

  let textoResultadoFinal = plano.texto_resultado;
  if (!/PARADA ADELANTADAS/.test(plano.texto_resultado || '')) {
    textoResultadoFinal = armarTextoResultado({
      nombreGrupo: req.grupo.nombre, hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero,
      ret: plano.ret, pizarra: plano.pizarra, salidaLineas: armarSalidaLineasDeTickets(ticketsPlanos),
      totalesFinales, totalJugadas: ticketsPlanos.length
    });
  }

  await db.query('UPDATE hipismo_planos SET comision_total = $1, texto_resultado = $2 WHERE id = $3', [comisionTotal, textoResultadoFinal, plano.id]);

  await registrarAlerta(req, {
    tipo: 'PLANO_EDITADO', hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero,
    fecha: plano.fecha instanceof Date ? plano.fecha.toISOString().slice(0, 10) : plano.fecha,
    mensaje: `Se editó un ticket del plano de ${plano.hipodromo_nombre}, carrera ${plano.carrera_numero} (${clienteFinal} / ${banqueroFinal}).`
  });

  res.json({
    plano: { ...plano, comision_total: comisionTotal, texto_resultado: textoResultadoFinal },
    tickets: rTodosTickets.rows,
    totalesFinales
  });
}));

// DELETE /planos/:id/tickets/:ticketId : borra UN ticket suelto de un plano
// (05-10-2026, "Revisar Jugadas" — confirmado con el usuario: "Borrar un
// ticket suelto"). Recalcula igual que PUT (comisión del plano y texto para
// WhatsApp, salvo que el plano traiga un bloque "PARADA ADELANTADAS"). Si
// era el ÚLTIMO ticket, se elimina el plano completo por la papelera
// recuperable de siempre (un plano sin tickets no tiene sentido).
router.delete('/planos/:id/tickets/:ticketId', asyncHandler(async (req, res) => {
  const rPlano = await db.query('SELECT * FROM hipismo_planos WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const plano = rPlano.rows[0];
  if (!plano) return res.status(404).json({ error: 'Plano no encontrado.' });

  const rTicket = await db.query('SELECT * FROM hipismo_tickets WHERE id = $1 AND plano_id = $2', [req.params.ticketId, plano.id]);
  const ticket = rTicket.rows[0];
  if (!ticket) return res.status(404).json({ error: 'Ese ticket no pertenece a este plano.' });

  const fechaTexto = fechaComoISO(plano.fecha);
  const rCuenta = await db.query('SELECT COUNT(*)::int AS n FROM hipismo_tickets WHERE plano_id = $1', [plano.id]);
  if (rCuenta.rows[0].n <= 1) {
    const resultado = await hipismoPlanosPapelera.eliminarPlano(req.grupoId, plano.id);
    await registrarAlerta(req, {
      tipo: 'PLANO_ELIMINADO', hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero, fecha: fechaTexto,
      mensaje: `Se eliminó el último ticket (${ticket.cliente_nombre} / ${ticket.banquero_nombre}) del plano de ${plano.hipodromo_nombre}, carrera ${plano.carrera_numero} — el plano completo se movió a la papelera.`
    });
    return res.json({ ok: true, planoEliminado: true, ...resultado });
  }

  await db.query('DELETE FROM hipismo_tickets WHERE id = $1 AND plano_id = $2', [ticket.id, plano.id]);

  const rTodosTickets = await db.query('SELECT * FROM hipismo_tickets WHERE plano_id = $1 ORDER BY creado_en', [plano.id]);
  const ticketsPlanos = rTodosTickets.rows.map(t => ({
    clienteNombre: t.cliente_nombre, banqueroNombre: t.banquero_nombre, modalidad: t.modalidad, caballo: t.caballo,
    monto: Number(t.monto), resultadoJugador: Number(t.resultado_jugador), resultadoBanquero: Number(t.resultado_banquero),
    sinComision: !!t.sin_comision
  }));
  const { totalesFinales, comisionTotal } = recalcularTotalesPlano(ticketsPlanos, plano.cruza_jugadas);

  let textoResultadoFinal = plano.texto_resultado;
  if (!/PARADA ADELANTADAS/.test(plano.texto_resultado || '')) {
    textoResultadoFinal = armarTextoResultado({
      nombreGrupo: req.grupo.nombre, hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero,
      ret: plano.ret, pizarra: plano.pizarra, salidaLineas: armarSalidaLineasDeTickets(ticketsPlanos),
      totalesFinales, totalJugadas: ticketsPlanos.length
    });
  }

  await db.query('UPDATE hipismo_planos SET comision_total = $1, texto_resultado = $2 WHERE id = $3', [comisionTotal, textoResultadoFinal, plano.id]);

  await registrarAlerta(req, {
    tipo: 'PLANO_EDITADO', hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero, fecha: fechaTexto,
    mensaje: `Se eliminó un ticket del plano de ${plano.hipodromo_nombre}, carrera ${plano.carrera_numero} (${ticket.cliente_nombre} / ${ticket.banquero_nombre}).`
  });

  res.json({
    ok: true, planoEliminado: false,
    plano: { ...plano, comision_total: comisionTotal, texto_resultado: textoResultadoFinal },
    tickets: rTodosTickets.rows,
    totalesFinales
  });
}));

// DELETE /planos/:id : borra UN plano puntual (con papelera recuperable).
// 23-09-2026, duodécima-tercera ronda — a diferencia de la ronda
// anterior (ver la nota grande en services/hipismoPlanosPapelera.js),
// AHORA el usuario pidió explícitamente que el borrado desde "Eliminar
// Planos" SÍ genere una alerta ("si el plano lo eliminan se genera la
// alerta igual mente") — cambio de criterio respecto a la ronda pasada,
// documentado en claude/plan-modulo-hipismo.md.
router.delete('/planos/:id', asyncHandler(async (req, res) => {
  try {
    const resultado = await hipismoPlanosPapelera.eliminarPlano(req.grupoId, req.params.id);
    await registrarAlerta(req, {
      tipo: 'PLANO_ELIMINADO', hipodromoNombre: resultado.hipodromoNombre, carreraNumero: resultado.carreraNumero,
      fecha: resultado.fecha instanceof Date ? resultado.fecha.toISOString().slice(0, 10) : resultado.fecha,
      mensaje: `Se eliminó el plano de ${resultado.hipodromoNombre}, carrera ${resultado.carreraNumero}.`
    });
    res.json({ ok: true, ...resultado });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo eliminar ese plano.' });
  }
}));

// POST /planos/papelera/:id/restaurar : deshace un borrado.
router.post('/planos/papelera/:id/restaurar', asyncHandler(async (req, res) => {
  try {
    const resultado = await hipismoPlanosPapelera.restaurarPlano(req.grupoId, req.params.id);
    res.json({ ok: true, ...resultado });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo restaurar ese plano.' });
  }
}));

// =================================================================
// JUGADAS ADELANTADAS — "Tablas Fijas y Marcas" (23-09-2026, nueva
// pestaña Apuestas > Jugadas Adelantadas — ver la nota grande en
// services/hipismoAdelantadasCalc.js para el formato y la fórmula
// completa de cada tipo de jugada). Se pega el plano (varios clientes,
// varias carreras a la vez) junto con el hipódromo y el día en que se
// van a correr esas carreras — cada línea queda 'pendiente' hasta que
// "Cargar Planos" trae la pizarra de esa carrera puntual (ver
// calcularResolucionAdelantadas/guardarResolucionAdelantadas arriba).
// =================================================================
function filaJugadaAdelantadaPublica(j) {
  return {
    id: j.id,
    cliente: j.cliente_nombre,
    carreraNumero: j.carrera_numero,
    tipo: j.tipo,
    cantidadTf: j.cantidad_tf,
    numeroEjemplar: j.numero_ejemplar,
    precioPorTf: j.precio_por_tf != null ? Number(j.precio_por_tf) : null,
    gananciaPotencial: j.ganancia_potencial != null ? Number(j.ganancia_potencial) : null,
    numero1: j.numero1,
    numero2: j.numero2,
    monto: Number(j.monto),
    comisionPorcentaje: Number(j.comision_porcentaje),
    sinComision: !!j.sin_comision,
    montosManuales: !!j.montos_manuales,
    textoOriginal: j.texto_original,
    errorCalculo: j.error_calculo,
    detalleError: j.detalle_error,
    estado: j.estado,
    gano: j.gano,
    resultadoCliente: j.resultado_cliente != null ? Number(j.resultado_cliente) : null,
    comision: j.comision != null ? Number(j.comision) : null,
    banqueadores: j.banqueadores,
    pizarraUsada: j.pizarra_usada,
    creadoEn: j.creado_en
  };
}

// POST /adelantadas/calcular: parsea SIN guardar — vista previa para
// revisar los errores de cálculo (ver la nota grande del .js) antes de
// decidir si se guarda de verdad.
router.post('/adelantadas/calcular', asyncHandler(async (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Falta el texto del plano.' });

  const { jugadas, sinReconocer } = parsearJugadasAdelantadas(texto);
  if (!jugadas.length) return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto — revisa el formato de las líneas ("N) 5TF DEL X A Y ,monto/pago$" o "N) AxB monto$").' });
  if (await rechazarClientesInexistentes(req, res, jugadas.map(j => j.cliente))) return;

  res.json({
    jugadas,
    sinReconocer,
    cantidadErrores: jugadas.filter(j => j.errorCalculo).length
  });
}));

// POST /adelantadas: parsea Y guarda de verdad (hipismo_adelantadas_planos
// + hipismo_adelantadas_jugadas), todas en estado 'pendiente'. Si hay
// alguna línea con error de cálculo (la multiplicación no calza con lo
// escrito en el plano — spec: "esta multiplicacion debes revisarla
// siempre... debes generar alerta identificar en que jugada y que
// cliente esta el error"), NO se guarda nada — se devuelve la lista de
// errores para que el operador corrija el texto pegado y vuelva a
// intentar, en vez de guardar a medias con números que no cierran.
router.post('/adelantadas', asyncHandler(async (req, res) => {
  const { texto, hipodromoId, hipodromoNombre, fecha, comisionPorcentaje } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Falta el texto del plano.' });
  if (!fecha) return res.status(400).json({ error: 'Falta el día en que se corren estas carreras.' });

  let nombreHipodromoFinal = hipodromoNombre;
  if (hipodromoId) {
    const rh = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2', [hipodromoId, req.grupoId]);
    if (rh.rows.length === 0) return res.status(400).json({ error: 'Hipódromo no encontrado.' });
    nombreHipodromoFinal = rh.rows[0].nombre;
  }
  if (!nombreHipodromoFinal) return res.status(400).json({ error: 'Falta el hipódromo.' });

  const { jugadas, sinReconocer } = parsearJugadasAdelantadas(texto);
  if (!jugadas.length) return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto — revisa el formato de las líneas.' });

  const errores = jugadas.filter(j => j.errorCalculo);
  if (errores.length) {
    return res.status(400).json({
      error: 'Hay jugadas con la multiplicación mal calculada — corrige el plano antes de guardar.',
      errores: errores.map(j => ({ cliente: j.cliente, carreraNumero: j.carreraNumero, textoOriginal: j.textoOriginal, detalleError: j.detalleError }))
    });
  }

  const comisionPct = comisionPorcentaje !== undefined && comisionPorcentaje !== null && comisionPorcentaje !== '' && !isNaN(Number(comisionPorcentaje))
    ? Number(comisionPorcentaje) : 2.5;

  if (await rechazarClientesInexistentes(req, res, Array.from(new Set(jugadas.map(j => j.cliente))))) return;

  // Alerta de pozo (07-10-2026): lo que cada cliente jugó en este plano de
  // Tablas Fijas/Marcas contra lo que le queda (ver hipismoAlertaPozo.js).
  const alertasPozo = await alertarApuestasSobrePozo(req, {
    apuestas: jugadas.map(j => ({ nombre: j.cliente, monto: j.monto })),
    hipodromoNombre: nombreHipodromoFinal, fecha,
    etiqueta: `jugadas adelantadas de ${nombreHipodromoFinal}`
  });

  const plano = await db.transaccion(async (client) => {
    const rPlano = await client.query(
      `INSERT INTO hipismo_adelantadas_planos (grupo_id, hipodromo_id, hipodromo_nombre, fecha, texto_original)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.grupoId, hipodromoId || null, nombreHipodromoFinal, fecha, texto]
    );
    const planoCreado = rPlano.rows[0];

    for (const j of jugadas) {
      await client.query(
        `INSERT INTO hipismo_adelantadas_jugadas
           (plano_id, grupo_id, cliente_nombre, carrera_numero, tipo, cantidad_tf, numero_ejemplar, precio_por_tf, ganancia_potencial, numero1, numero2, monto, comision_porcentaje, texto_original, error_calculo, detalle_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [planoCreado.id, req.grupoId, j.cliente, j.carreraNumero, j.tipo,
          j.tipo === 'tf' ? j.cantidadTf : null, j.tipo === 'tf' ? j.numeroEjemplar : null,
          j.tipo === 'tf' ? j.precioPorTf : null, j.tipo === 'tf' ? j.gananciaPotencial : null,
          j.tipo === 'marca' ? j.numero1 : null, j.tipo === 'marca' ? j.numero2 : null,
          j.monto, comisionPct, j.textoOriginal, j.errorCalculo, j.detalleError]
      );
    }
    return planoCreado;
  });

  res.status(201).json({ plano, cantidadJugadas: jugadas.length, sinReconocer, alertasPozo });
}));

// GET /adelantadas?fecha=&hipodromoId=&limite= : historial reciente (cabeceras).
router.get('/adelantadas', asyncHandler(async (req, res) => {
  const { fecha, hipodromoId, limite } = req.query;
  const condiciones = ['grupo_id = $1'];
  const params = [req.grupoId];
  if (fecha) { params.push(fecha); condiciones.push(`fecha = $${params.length}`); }
  if (hipodromoId) { params.push(hipodromoId); condiciones.push(`hipodromo_id = $${params.length}`); }
  params.push(Math.min(parseInt(limite, 10) || 50, 200));
  const r = await db.query(
    `SELECT id, hipodromo_nombre, fecha, creado_en FROM hipismo_adelantadas_planos WHERE ${condiciones.join(' AND ')} ORDER BY creado_en DESC LIMIT $${params.length}`,
    params
  );
  res.json(r.rows);
}));

// GET /adelantadas/pendientes : todas las jugadas que todavía necesitan
// algo (esperando pizarra, o esperando que se les asigne banqueo),
// agrupadas por hipódromo + carrera + fecha — alimenta tanto la alerta
// titilante ("avisa... y enciende titilando la parada adelantada y cual
// es la jugada para cargar la pizarra") como la pantalla de Jugadas
// Adelantadas. OJO: va ANTES de "/adelantadas/:id" para que Express no
// intente matchear "pendientes" como si fuera un :id.
router.get('/adelantadas/pendientes', asyncHandler(async (req, res) => {
  await asegurarBanqueoAutomaticoMarcas(req.grupoId);
  const r = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND j.estado IN ('pendiente','falta_banqueo')
      ORDER BY p.fecha, p.hipodromo_nombre, j.carrera_numero, j.creado_en`,
    [req.grupoId]
  );

  const porCarrera = new Map();
  r.rows.forEach(j => {
    const fechaIso = j.fecha instanceof Date ? j.fecha.toISOString().slice(0, 10) : j.fecha;
    const clave = `${j.hipodromo_nombre}|${j.carrera_numero}|${fechaIso}`;
    if (!porCarrera.has(clave)) {
      porCarrera.set(clave, { hipodromoNombre: j.hipodromo_nombre, carreraNumero: j.carrera_numero, fecha: fechaIso, jugadas: [] });
    }
    porCarrera.get(clave).jugadas.push(filaJugadaAdelantadaPublica(j));
  });

  const carreras = Array.from(porCarrera.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  res.json({
    total: r.rows.length,
    esperandoPizarra: r.rows.filter(j => j.estado === 'pendiente').length,
    faltaBanqueo: r.rows.filter(j => j.estado === 'falta_banqueo').length,
    carreras
  });
}));

// GET /adelantadas/banqueadores (28-09-2026, a pedido del usuario: "en
// marcas adelantadas despliegame una lista con los banqueros que ya
// agregue en marcas anteriores para no tener que escribir todas las
// veces lo mismo") — nombres distintos ya usados como banquero de
// alguna Marca de este grupo, para autocompletar el campo "Nombre del
// banquero" al resolver un "falta_banqueo" (ver filaBanqueadorHtml en
// el mockup). A propósito NO se reusa /api/jugadores (la lista de
// clientes): un banquero se auto-registra ahí como cualquier otro
// cliente (ver autoRegistrarJugadores en services/procesarSabana.js),
// sin ninguna marca que lo distinga — esa lista mezclaría clientes que
// nunca banquearon nada con los que sí. jsonb_array_elements desarma
// el array `banqueadores` de cada Marca ya resuelta y saca los nombres
// únicos, sin importar en qué jugada/carrera/semana haya sido. OJO: va
// ANTES de "/adelantadas/:id" (mismo motivo que "pendientes" arriba).
router.get('/adelantadas/banqueadores', asyncHandler(async (req, res) => {
  const r = await db.query(
    `SELECT DISTINCT b->>'nombre' AS nombre
       FROM hipismo_adelantadas_jugadas j, jsonb_array_elements(j.banqueadores) b
      WHERE j.grupo_id = $1 AND j.banqueadores IS NOT NULL
      ORDER BY nombre`,
    [req.grupoId]
  );
  res.json({ banqueadores: r.rows.map(row => row.nombre).filter(Boolean) });
}));

// GET /adelantadas/:id : detalle completo (cabecera + jugadas).
router.get('/adelantadas/:id', asyncHandler(async (req, res) => {
  const rPlano = await db.query('SELECT * FROM hipismo_adelantadas_planos WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const plano = rPlano.rows[0];
  if (!plano) return res.status(404).json({ error: 'Plano no encontrado.' });
  const rJugadas = await db.query('SELECT * FROM hipismo_adelantadas_jugadas WHERE plano_id = $1 ORDER BY carrera_numero, creado_en', [plano.id]);
  res.json({ plano, jugadas: rJugadas.rows.map(filaJugadaAdelantadaPublica) });
}));

// POST /adelantadas/jugadas/:id/banquear: asigna quién banquea una Marca
// ya decidida (estado 'falta_banqueo') — "en las marcas permite
// seleccionar quien banquea, cuanto banquea de las marcas y si paga % o
// no" — cada banquero cubre un % (deben sumar ~100%) y decide aparte si
// cobra comisión sobre su parte. Deja la jugada en 'resuelto'.
router.post('/adelantadas/jugadas/:id/banquear', asyncHandler(async (req, res) => {
  const { banqueadores, comisionPorcentaje } = req.body;
  if (!Array.isArray(banqueadores) || banqueadores.length === 0) {
    return res.status(400).json({ error: 'Falta seleccionar quién banquea esta marca.' });
  }
  // 23-09-2026, a pedido del usuario ("colocame para agregar hasta 4
  // marqueros que banqueen la marca") — mismo límite del lado del
  // servidor, por si alguien llama la ruta directo sin pasar por el
  // formulario (que ya no deja agregar un 5to).
  if (banqueadores.length > 4) {
    return res.status(400).json({ error: 'Una Marca admite hasta 4 banqueadores.' });
  }
  for (const b of banqueadores) {
    if (!b.nombre || !b.nombre.trim()) return res.status(400).json({ error: 'Todos los banqueadores necesitan un nombre.' });
    if (b.porcentaje === undefined || b.porcentaje === null || isNaN(Number(b.porcentaje))) {
      return res.status(400).json({ error: `Falta el % que banquea ${b.nombre}.` });
    }
  }
  const sumaPorcentajes = banqueadores.reduce((acc, b) => acc + Number(b.porcentaje), 0);
  if (Math.abs(sumaPorcentajes - 100) > 0.5) {
    return res.status(400).json({ error: `Los % de los banqueadores deben sumar 100% (suman ${sumaPorcentajes}%).` });
  }

  const rJugada = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.id = $1 AND j.grupo_id = $2`,
    [req.params.id, req.grupoId]
  );
  const jugada = rJugada.rows[0];
  if (!jugada) return res.status(404).json({ error: 'Jugada adelantada no encontrada.' });
  if (jugada.tipo !== 'marca') return res.status(400).json({ error: 'Solo las Marcas necesitan banqueo — las Tablas Fijas se resuelven solas.' });
  // 06-10-2026: ahora las Marcas se banquean solas (MARCAS ZENYATTA/SAMMY),
  // así que "cambiar quién banquea" una Marca puntual es SOBRE una ya
  // 'resuelto' con banqueadores -- se permite re-banquear; lo que no se
  // puede es banquear algo que todavía no tiene resultado.
  if (jugada.estado !== 'falta_banqueo' && !(jugada.estado === 'resuelto' && jugada.banqueadores)) return res.status(400).json({ error: `Esta jugada está en estado "${jugada.estado}" — todavía no tiene resultado, no se puede banquear.` });

  const comisionPctDefecto = comisionPorcentaje !== undefined && comisionPorcentaje !== null && comisionPorcentaje !== '' && !isNaN(Number(comisionPorcentaje))
    ? Number(comisionPorcentaje) : Number(jugada.comision_porcentaje);

  // SIN COMISIÓN (07-10-2026): ningún banquero paga %, sin importar lo que traiga la petición.
  const { banqueadores: banqueadoresResueltos, comisionMarcas } = resolverBanqueoMarca(
    { acierta: jugada.gano, base: jugada.montos_manuales ? Math.abs(Number(jugada.resultado_cliente)) : (jugada.gano ? Number(jugada.resultado_cliente) : Number(jugada.monto)) },
    jugada.sin_comision ? banqueadores.map(b => Object.assign({}, b, { comisionPorcentaje: 0 })) : banqueadores,
    jugada.sin_comision ? 0 : comisionPctDefecto
  );

  if (await rechazarClientesInexistentes(req, res, banqueadoresResueltos.map(b => b.nombre))) return;

  const rActualizada = await db.query(
    `UPDATE hipismo_adelantadas_jugadas
        SET estado = 'resuelto', comision = $1, banqueadores = $2
      WHERE id = $3 AND grupo_id = $4 RETURNING *`,
    [comisionMarcas, JSON.stringify(banqueadoresResueltos), jugada.id, req.grupoId]
  );

  // 23-09-2026, a pedido del usuario ("colcocarle como se llama y cuanto
  // [gana o pierde cada marquero]" y "se va colocando positivo a marcas
  // [en balance]"): se devuelve el detalle ya resuelto (cliente +
  // banqueadores + comisión) para que la pantalla muestre el resultado
  // completo del banqueo, y para que, si Balance General está mostrando
  // justo esta misma carrera, sume ahí mismo estos montos sin tener que
  // volver a cargar el plano (ver enviarBanqueo() en hipismo-mockup.html).
  res.json({
    jugada: filaJugadaAdelantadaPublica(rActualizada.rows[0]),
    hipodromoNombre: jugada.hipodromo_nombre,
    carreraNumero: jugada.carrera_numero,
    fecha: jugada.fecha instanceof Date ? jugada.fecha.toISOString().slice(0, 10) : jugada.fecha,
    resultadoCliente: Number(jugada.resultado_cliente),
    banqueadores: banqueadoresResueltos,
    comisionMarcas
  });
}));

// =================================================================
// EDITAR / ELIMINAR una Jugada Adelantada puntual (23-09-2026, a pedido
// del usuario: "en jugadas adelantadas quiero poder seleccionar cada
// jugada, eliminarla, editarla en caso de que lo necesite, desde esa
// misma ventana seleccionando la jugada"). A diferencia de "Eliminar
// Planos" (abajo), que tiene su propia papelera recuperable, acá el
// borrado es DEFINITIVO — decisión tomada sin volver a preguntar: cada
// línea de Jugadas Adelantadas es un ítem chico, autocontenido, y esta
// pantalla ya funciona línea por línea con el operador mirando toda la
// lista — el "rastro" de qué se borró/editó y quién lo hizo queda en la
// nueva pestaña "Alertas" (registrarAlerta(), arriba de todo el
// archivo), igual criterio de auditoría que se usa para Eliminar Planos.
//
// Si la jugada YA estaba resuelta (tiene pizarra_usada guardada) se
// recalcula con la MISMA pizarra que ya se usó — nunca se le vuelve a
// pedir al operador que la pegue. Si es una Marca que YA tenía
// banqueadores asignados (estado 'resuelto'), se vuelven a resolver con
// los MISMOS % y las mismas decisiones de "paga comisión" que ya tenía
// cada banquero (resolverBanqueoMarca de nuevo, sobre la base nueva) —
// así que si el operador solo corrigió el monto o el número marcado, no
// hace falta rehacer el banqueo a mano. Una jugada 'sin_decidir' (la
// pizarra de esa carrera nunca llegó a los puestos necesarios) se deja
// tal cual quedó — no depende de los datos que se estén editando.
router.put('/adelantadas/jugadas/:id', asyncHandler(async (req, res) => {
  const { cliente, monto, numeroEjemplar, numero1, numero2, sinComision, montoManual } = req.body;

  const rJugada = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.id = $1 AND j.grupo_id = $2`,
    [req.params.id, req.grupoId]
  );
  const jugada = rJugada.rows[0];
  if (!jugada) return res.status(404).json({ error: 'Jugada adelantada no encontrada.' });

  // 29-09-2026 — mismo criterio que jugadores.js/hipismoCalc.js: colapsa
  // espacios de más entre palabras.
  const clienteFinal = ((cliente || jugada.cliente_nombre) + '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!clienteFinal) return res.status(400).json({ error: 'Falta el cliente.' });
  const montoFinal = (monto !== undefined && monto !== null && monto !== '') ? Number(monto) : Number(jugada.monto);
  if (isNaN(montoFinal) || montoFinal <= 0) return res.status(400).json({ error: 'El monto tiene que ser un número mayor a 0.' });

  const numeroEjemplarFinal = jugada.tipo === 'tf'
    ? ((numeroEjemplar !== undefined && numeroEjemplar !== null && numeroEjemplar !== '') ? parseInt(numeroEjemplar, 10) : jugada.numero_ejemplar)
    : jugada.numero_ejemplar;
  const numero1Final = jugada.tipo === 'marca'
    ? ((numero1 !== undefined && numero1 !== null && numero1 !== '') ? parseInt(numero1, 10) : jugada.numero1)
    : jugada.numero1;
  const numero2Final = jugada.tipo === 'marca'
    ? ((numero2 !== undefined && numero2 !== null && numero2 !== '') ? parseInt(numero2, 10) : jugada.numero2)
    : jugada.numero2;

  if (clienteFinal !== jugada.cliente_nombre) if (await rechazarClientesInexistentes(req, res, [clienteFinal])) return;

  // SIN COMISIÓN (07-10-2026): "normal" (el programa calcula el % de la jugada) o "sin
  // comisión" (0% para todos, sin comisión de grupo, sin % devuelto — ver pctJugada en
  // hipismoAdelantadasCalc.js). Si no se manda, se conserva lo que ya tenía la jugada.
  const sinComisionFinal = (sinComision === undefined || sinComision === null || sinComision === '')
    ? !!jugada.sin_comision
    : (sinComision === true || sinComision === 'true' || sinComision === 1 || sinComision === '1');
  const volverANormal = !sinComisionFinal && !!jugada.sin_comision;
  const jugadaEf = Object.assign({}, jugada, { sin_comision: sinComisionFinal });
  const pctEf = pctJugada(jugadaEf);

  // MONTOS EXACTOS A MANO (07-10-2026, solo con "Sin comisión"): ver resolverMontosManuales.
  // montoManual: objeto = fijar esos montos; null = quitar los montos a mano; sin mandar = se conserva lo que tenía.
  if (montoManual && typeof montoManual === 'object' && !sinComisionFinal) {
    return res.status(400).json({ error: 'Los montos exactos a mano solo se pueden usar con la opción "Sin comisión".' });
  }
  const manualQueda = sinComisionFinal && (montoManual === undefined ? !!jugada.montos_manuales : !!montoManual);
  const limpiandoManual = !!jugada.montos_manuales && !manualQueda;

  let recalculo = { estado: jugada.estado, gano: jugada.gano, resultadoCliente: jugada.resultado_cliente, comision: jugada.comision, banqueadores: jugada.banqueadores };
  if (montoManual && typeof montoManual === 'object') {
    // Banqueadores de la contraparte: los que ya tiene la jugada; si todavía no se resolvió, los que configuró el grupo.
    let base = Array.isArray(jugada.banqueadores) ? jugada.banqueadores : null;
    if (!base && (jugada.estado === 'pendiente' || jugada.estado === 'falta_banqueo')) {
      base = jugada.tipo === 'tf' ? await obtenerBanqueoTablasFijasGrupo(req.grupoId) : await obtenerBanqueoMarcasGrupo(req.grupoId);
    }
    const m = resolverMontosManuales({ tipo: jugada.tipo, manual: montoManual, base });
    if (!m.ok) return res.status(400).json({ error: m.error });
    if (m.banqueadores && await rechazarClientesInexistentes(req, res, m.banqueadores.map(b => b.nombre))) return;
    recalculo = { estado: m.estado, gano: m.gano, resultadoCliente: m.resultadoCliente, comision: m.comision, banqueadores: m.banqueadores ? JSON.stringify(m.banqueadores) : null };
  } else if (manualQueda) {
    // Ya tenía montos a mano y no se tocaron: se conservan tal cual (no se recalculan con la pizarra).
  } else if (limpiandoManual && !jugada.pizarra_usada) {
    // Quitó los montos a mano de una jugada que nunca se resolvió con pizarra: vuelve a esperar la pizarra.
    recalculo = { estado: 'pendiente', gano: null, resultadoCliente: null, comision: null, banqueadores: null };
  } else if (jugada.pizarra_usada && (jugada.estado !== 'sin_decidir' || limpiandoManual)) {
    const rank = parsearPizarraRank(jugada.pizarra_usada);
    // CABALLO RETIRADO => NULA (06-10-2026): si tras la edición algún caballo
    // de la apuesta figura en el "Ret:" de esa carrera, queda nula (0, sin
    // banqueo ni comisión), igual que al resolverla por primera vez.
    const retirados = await obtenerRetiradosCarrera(req, { hipodromoNombre: jugada.hipodromo_nombre, carreraNumero: jugada.carrera_numero, fecha: fechaComoISO(jugada.fecha) });
    if (adelantadaConRetirado({ tipo: jugada.tipo, numero_ejemplar: numeroEjemplarFinal, numero1: numero1Final, numero2: numero2Final }, retirados)) {
      recalculo = { estado: 'sin_decidir', gano: null, resultadoCliente: 0, comision: 0, banqueadores: null };
    } else if (jugada.tipo === 'tf') {
      const r = resolverTablaFija(
        { numeroEjemplar: numeroEjemplarFinal, monto: montoFinal, gananciaPotencial: Number(jugada.ganancia_potencial) },
        rank, pctEf
      );
      // TF que YA tenía banqueadores (06-10-2026): se recalculan sus montos con
      // los mismos nombres/%/comisión; una TF sin banqueadores sigue contra el
      // ítem "TABLAS FIJAS" (el historial no cambia solo por editar).
      const bqTf = jugada.banqueadores
        ? banqueoAutomaticoTablaFija({ gano: r.gano, resultadoCliente: r.resultadoCliente, monto: montoFinal }, pctEf, banqueadoresJugada(jugadaEf, volverANormal), null)
        : null;
      recalculo = bqTf
        ? { estado: 'resuelto', gano: r.gano, resultadoCliente: r.resultadoCliente, comision: bqTf.comision, banqueadores: JSON.stringify(bqTf.banqueadores) }
        : { estado: 'resuelto', gano: r.gano, resultadoCliente: r.resultadoCliente, comision: r.comision, banqueadores: jugada.banqueadores };
    } else {
      const c = resolverClienteMarca({ numero1: numero1Final, numero2: numero2Final, monto: montoFinal }, rank);
      if (c.nula) {
        // NULA (28-09-2026): si la edición hace que ahora ninguno de los
        // 2 caballos figure, se limpia cualquier banqueo que ya tuviera
        // asignado (con nula no hay nada que banquear) y queda en 0.
        recalculo = { estado: 'sin_decidir', gano: null, resultadoCliente: 0, comision: null, banqueadores: null };
      } else if (jugada.banqueadores) {
        const banqueadoresPrevios = banqueadoresJugada(jugadaEf, volverANormal);
        const base = c.acierta ? c.resultadoCliente : montoFinal;
        const { banqueadores, comisionMarcas } = resolverBanqueoMarca({ acierta: c.acierta, base }, banqueadoresPrevios, pctEf);
        recalculo = { estado: 'resuelto', gano: c.acierta, resultadoCliente: c.resultadoCliente, comision: comisionMarcas, banqueadores: JSON.stringify(banqueadores) };
      } else {
        // Sin banqueadores previos: banqueo automático SI el grupo lo
        // configuró (06-10-2026); si no, 'falta_banqueo' como siempre.
        const base = c.acierta ? c.resultadoCliente : montoFinal;
        const auto = banqueoAutomaticoMarca({ acierta: c.acierta, base }, pctEf, null, await obtenerBanqueoMarcasGrupo(req.grupoId));
        recalculo = auto
          ? { estado: 'resuelto', gano: c.acierta, resultadoCliente: c.resultadoCliente, comision: auto.comisionMarcas, banqueadores: JSON.stringify(auto.banqueadores) }
          : { estado: 'falta_banqueo', gano: c.acierta, resultadoCliente: c.resultadoCliente, comision: null, banqueadores: null };
      }
    }
  }

  const r = await db.query(
    `UPDATE hipismo_adelantadas_jugadas
        SET cliente_nombre = $1, monto = $2, numero_ejemplar = $3, numero1 = $4, numero2 = $5,
            estado = $6, gano = $7, resultado_cliente = $8, comision = $9, banqueadores = $10, sin_comision = $13, montos_manuales = $14
      WHERE id = $11 AND grupo_id = $12 RETURNING *`,
    [clienteFinal, montoFinal, numeroEjemplarFinal, numero1Final, numero2Final,
      recalculo.estado, recalculo.gano, recalculo.resultadoCliente, recalculo.comision, recalculo.banqueadores,
      jugada.id, req.grupoId, sinComisionFinal, manualQueda]
  );

  const fechaTexto = jugada.fecha instanceof Date ? jugada.fecha.toISOString().slice(0, 10) : jugada.fecha;
  await registrarAlerta(req, {
    tipo: 'ADELANTADA_EDITADA', hipodromoNombre: jugada.hipodromo_nombre, carreraNumero: jugada.carrera_numero, fecha: fechaTexto,
    mensaje: `Se editó la jugada adelantada de ${clienteFinal} (carrera ${jugada.carrera_numero}, ${jugada.hipodromo_nombre}, ${fechaTexto}).`
  });

  res.json(filaJugadaAdelantadaPublica(r.rows[0]));
}));

router.delete('/adelantadas/jugadas/:id', asyncHandler(async (req, res) => {
  const rJugada = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.id = $1 AND j.grupo_id = $2`,
    [req.params.id, req.grupoId]
  );
  const jugada = rJugada.rows[0];
  if (!jugada) return res.status(404).json({ error: 'Jugada adelantada no encontrada.' });

  await db.query('DELETE FROM hipismo_adelantadas_jugadas WHERE id = $1 AND grupo_id = $2', [jugada.id, req.grupoId]);

  const fechaTexto = jugada.fecha instanceof Date ? jugada.fecha.toISOString().slice(0, 10) : jugada.fecha;
  await registrarAlerta(req, {
    tipo: 'ADELANTADA_ELIMINADA', hipodromoNombre: jugada.hipodromo_nombre, carreraNumero: jugada.carrera_numero, fecha: fechaTexto,
    mensaje: `Se eliminó la jugada adelantada de ${jugada.cliente_nombre} (carrera ${jugada.carrera_numero}, ${jugada.hipodromo_nombre}, ${fechaTexto}).`
  });

  res.json({ ok: true });
}));

// =================================================================
// "Jugadas entre Tercios Adelantadas" (04-10-2026) — mismo patrón de
// endpoints que "Jugadas Adelantadas" arriba, usando
// services/hipismoTerciosAdelantadasCalc.js como motor.
// =================================================================

// POST /tercios-adelantadas/calcular: parsea SIN guardar — vista previa
// para revisar las líneas con error (falta monto/jugador/banquero)
// antes de decidir si se guarda de verdad.
router.post('/tercios-adelantadas/calcular', asyncHandler(async (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Falta el texto del plano.' });

  const { hipodromo, pctSugerido, lineas } = parsearPlanoTerciosAdelantadas(texto);
  if (!lineas.length) return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto.' });
  if (await rechazarClientesInexistentes(req, res, lineas.flatMap(l => [l.jugadorNombre, l.banqueroNombre]))) return;

  res.json({
    hipodromo,
    pctSugerido,
    lineas,
    cantidadErrores: lineas.filter(l => l.errores.faltaMonto || l.errores.faltaJugador || l.errores.faltaBanquero).length
  });
}));

// POST /tercios-adelantadas: parsea Y guarda de verdad, todas en estado
// 'pendiente'. A diferencia de Tablas Fijas/Marcas, una línea con datos
// faltantes NO bloquea el guardado del resto del plano (confirmado por
// el usuario: "no bloquea... la pestaña que corresponda titila
// indicando alerta") — se guarda igual, marcada con su error, para
// poder mostrarla en la pantalla de pendientes/alertas.
router.post('/tercios-adelantadas', asyncHandler(async (req, res) => {
  const { texto, hipodromoId, hipodromoNombre, fecha, comisionPorcentaje } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Falta el texto del plano.' });
  if (!fecha) return res.status(400).json({ error: 'Falta el día en que se corren estas carreras.' });

  const { hipodromo: hipodromoDelTexto, pctSugerido, lineas } = parsearPlanoTerciosAdelantadas(texto);
  if (!lineas.length) return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto.' });

  let nombreHipodromoFinal = hipodromoNombre || hipodromoDelTexto;
  if (hipodromoId) {
    const rh = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2', [hipodromoId, req.grupoId]);
    if (rh.rows.length === 0) return res.status(400).json({ error: 'Hipódromo no encontrado.' });
    nombreHipodromoFinal = rh.rows[0].nombre;
  }
  if (!nombreHipodromoFinal) return res.status(400).json({ error: 'Falta el hipódromo.' });

  // El % de la pantalla manda; si el operador no puso ninguno, se usa el
  // leído del texto ("NOTA= ... -3%"); si tampoco hay, 5% por defecto
  // (mismo criterio confirmado: "el % se elije arriba, pero si el plano
  // indica cuanto es el %, colocamelo automatico, sin embargo lo puedo
  // cambiar").
  const comisionPct = (comisionPorcentaje !== undefined && comisionPorcentaje !== null && comisionPorcentaje !== '' && !isNaN(Number(comisionPorcentaje)))
    ? Number(comisionPorcentaje) : (pctSugerido !== null ? pctSugerido : 5);

  const nombres = new Set();
  lineas.forEach(l => { if (l.jugadorNombre) nombres.add(l.jugadorNombre); if (l.banqueroNombre) nombres.add(l.banqueroNombre); });
  if (await rechazarClientesInexistentes(req, res, Array.from(nombres))) return;

  // Alerta de pozo (07-10-2026): lo que cada JUGADOR apostó en este plano
  // (el banquero pone la banca, no apuesta) contra lo que le queda.
  const alertasPozo = await alertarApuestasSobrePozo(req, {
    apuestas: lineas.map(l => ({ nombre: l.jugadorNombre, monto: l.monto })),
    hipodromoNombre: nombreHipodromoFinal, fecha,
    etiqueta: `tercios adelantadas de ${nombreHipodromoFinal}`
  });

  const plano = await db.transaccion(async (client) => {
    const rPlano = await client.query(
      `INSERT INTO hipismo_tercios_adelantadas_planos (grupo_id, hipodromo_id, hipodromo_nombre, fecha, comision_porcentaje, texto_original)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.grupoId, hipodromoId || null, nombreHipodromoFinal, fecha, comisionPct, texto]
    );
    const planoCreado = rPlano.rows[0];

    for (const l of lineas) {
      await client.query(
        `INSERT INTO hipismo_tercios_adelantadas_jugadas
           (plano_id, grupo_id, jugador_nombre, banquero_nombre, carrera_numero, es_cruce, grupo_caballos, cruce_grupo_a, cruce_grupo_b, modalidad, monto, comision_porcentaje, texto_original, falta_monto, falta_jugador, falta_banquero)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [planoCreado.id, req.grupoId, l.jugadorNombre || '', l.banqueroNombre || '', l.carreraNumero,
          !!l.cruce, l.cruce ? null : JSON.stringify(l.grupo || null), l.cruce ? JSON.stringify(l.cruce.gruposA) : null, l.cruce ? JSON.stringify(l.cruce.gruposB) : null,
          l.modalidad, l.monto, comisionPct, l.lineaOriginal, l.errores.faltaMonto, l.errores.faltaJugador, l.errores.faltaBanquero]
      );
    }
    return planoCreado;
  });

  res.status(201).json({
    plano,
    cantidadJugadas: lineas.length,
    cantidadErrores: lineas.filter(l => l.errores.faltaMonto || l.errores.faltaJugador || l.errores.faltaBanquero).length,
    alertasPozo
  });
}));

// GET /tercios-adelantadas/pendientes : todas las jugadas que todavía
// esperan la pizarra de su carrera, O que tienen algún dato faltante —
// alimenta la alerta titilante de la pestaña y la pantalla de errores
// ("al abrir saldra una pantalla indicando cual es el error, indicando
// jugada, carrera e hipodromo"). OJO: va ANTES de cualquier ruta con
// ":id" de esta familia, mismo motivo que /adelantadas/pendientes.
router.get('/tercios-adelantadas/pendientes', asyncHandler(async (req, res) => {
  const r = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_tercios_adelantadas_jugadas j
       JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND j.estado = 'pendiente'
      ORDER BY p.fecha, p.hipodromo_nombre, j.carrera_numero, j.creado_en`,
    [req.grupoId]
  );

  const porCarrera = new Map();
  r.rows.forEach(j => {
    const fechaIso = j.fecha instanceof Date ? j.fecha.toISOString().slice(0, 10) : j.fecha;
    const clave = `${j.hipodromo_nombre}|${j.carrera_numero}|${fechaIso}`;
    if (!porCarrera.has(clave)) {
      porCarrera.set(clave, { hipodromoNombre: j.hipodromo_nombre, carreraNumero: j.carrera_numero, fecha: fechaIso, jugadas: [] });
    }
    porCarrera.get(clave).jugadas.push(filaJugadaTerciosAdelantadaPublica(j));
  });

  const carreras = Array.from(porCarrera.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const conError = r.rows.filter(j => j.falta_monto || j.falta_jugador || j.falta_banquero);
  res.json({
    total: r.rows.length,
    esperandoPizarra: r.rows.length - conError.length,
    conError: conError.length,
    carreras
  });
}));

router.put('/tercios-adelantadas/jugadas/:id', asyncHandler(async (req, res) => {
  const { jugador, banquero, monto, modalidad } = req.body;

  const rJugada = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_tercios_adelantadas_jugadas j
       JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.id = $1 AND j.grupo_id = $2`,
    [req.params.id, req.grupoId]
  );
  const jugada = rJugada.rows[0];
  if (!jugada) return res.status(404).json({ error: 'Jugada no encontrada.' });

  const jugadorFinal = ((jugador !== undefined && jugador !== null && jugador !== '') ? jugador : jugada.jugador_nombre).toString().trim().toUpperCase().replace(/\s+/g, ' ');
  const banqueroFinal = ((banquero !== undefined && banquero !== null && banquero !== '') ? banquero : jugada.banquero_nombre).toString().trim().toUpperCase().replace(/\s+/g, ' ');
  const montoFinal = (monto !== undefined && monto !== null && monto !== '') ? Number(monto) : (jugada.monto != null ? Number(jugada.monto) : null);
  const modalidadFinal = (modalidad !== undefined && modalidad !== null && modalidad !== '') ? String(modalidad).toLowerCase().trim() : jugada.modalidad;

  if (montoFinal != null && (isNaN(montoFinal) || montoFinal <= 0)) {
    return res.status(400).json({ error: 'El monto tiene que ser un número mayor a 0.' });
  }

  const faltaMonto = montoFinal == null;
  const faltaJugador = !jugadorFinal;
  const faltaBanquero = !banqueroFinal;

  if (jugadorFinal && jugadorFinal !== jugada.jugador_nombre) if (await rechazarClientesInexistentes(req, res, [jugadorFinal])) return;
  if (banqueroFinal && banqueroFinal !== jugada.banquero_nombre) if (await rechazarClientesInexistentes(req, res, [banqueroFinal])) return;

  // Si ya tenía una pizarra usada (la carrera ya se había resuelto antes
  // de corregir el dato faltante), se recalcula de una con la pizarra
  // que ya tenía guardada — mismo criterio de "editar recalcula todo"
  // que usa el resto del sistema.
  let recalculo = { estado: jugada.estado, resultadoJugador: jugada.resultado_jugador, resultadoBanquero: jugada.resultado_banquero, comisionGrupo: jugada.comision_grupo };
  if (jugada.pizarra_usada && !faltaMonto && !faltaJugador && !faltaBanquero) {
    const rank = parsearPizarraRank(jugada.pizarra_usada);
    const linea = {
      cruce: jugada.es_cruce ? { gruposA: jugada.cruce_grupo_a, gruposB: jugada.cruce_grupo_b } : null,
      grupo: jugada.es_cruce ? null : jugada.grupo_caballos,
      modalidad: modalidadFinal,
      monto: montoFinal
    };
    const retirados = await obtenerRetiradosCarrera(req, { hipodromoNombre: jugada.hipodromo_nombre, carreraNumero: jugada.carrera_numero, fecha: fechaComoISO(jugada.fecha) });
    const r = resolverLineaTerciosAdelantada(linea, rank, Number(jugada.comision_porcentaje));
    recalculo = (r.decidida && !apuestaConRetirado(jugada.es_cruce ? [jugada.cruce_grupo_a, jugada.cruce_grupo_b] : [jugada.grupo_caballos], retirados))
      ? { estado: 'resuelto', resultadoJugador: round2(r.montoJugadorMostrado), resultadoBanquero: round2(r.montoBanqueroMostrado), comisionGrupo: round2(r.comisionGrupo) }
      : { estado: 'sin_decidir', resultadoJugador: 0, resultadoBanquero: 0, comisionGrupo: 0 };
  } else if (faltaMonto || faltaJugador || faltaBanquero) {
    recalculo = { estado: 'pendiente', resultadoJugador: null, resultadoBanquero: null, comisionGrupo: null };
  }

  const r = await db.query(
    `UPDATE hipismo_tercios_adelantadas_jugadas
        SET jugador_nombre = $1, banquero_nombre = $2, monto = $3, modalidad = $4,
            falta_monto = $5, falta_jugador = $6, falta_banquero = $7,
            estado = $8, resultado_jugador = $9, resultado_banquero = $10, comision_grupo = $11
      WHERE id = $12 AND grupo_id = $13 RETURNING *`,
    [jugadorFinal, banqueroFinal, montoFinal, modalidadFinal, faltaMonto, faltaJugador, faltaBanquero,
      recalculo.estado, recalculo.resultadoJugador, recalculo.resultadoBanquero, recalculo.comisionGrupo,
      jugada.id, req.grupoId]
  );

  const fechaTexto = jugada.fecha instanceof Date ? jugada.fecha.toISOString().slice(0, 10) : jugada.fecha;
  await registrarAlerta(req, {
    tipo: 'TERCIOS_ADELANTADA_EDITADA', hipodromoNombre: jugada.hipodromo_nombre, carreraNumero: jugada.carrera_numero, fecha: fechaTexto,
    mensaje: `Se editó la jugada entre Tercios Adelantadas de ${jugadorFinal || '(sin jugador)'} contra ${banqueroFinal || '(sin banquero)'} (carrera ${jugada.carrera_numero}, ${jugada.hipodromo_nombre}, ${fechaTexto}).`
  });

  res.json(filaJugadaTerciosAdelantadaPublica(r.rows[0]));
}));

router.delete('/tercios-adelantadas/jugadas/:id', asyncHandler(async (req, res) => {
  const rJugada = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_tercios_adelantadas_jugadas j
       JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.id = $1 AND j.grupo_id = $2`,
    [req.params.id, req.grupoId]
  );
  const jugada = rJugada.rows[0];
  if (!jugada) return res.status(404).json({ error: 'Jugada no encontrada.' });

  await db.query('DELETE FROM hipismo_tercios_adelantadas_jugadas WHERE id = $1 AND grupo_id = $2', [jugada.id, req.grupoId]);

  const fechaTexto = jugada.fecha instanceof Date ? jugada.fecha.toISOString().slice(0, 10) : jugada.fecha;
  await registrarAlerta(req, {
    tipo: 'TERCIOS_ADELANTADA_ELIMINADA', hipodromoNombre: jugada.hipodromo_nombre, carreraNumero: jugada.carrera_numero, fecha: fechaTexto,
    mensaje: `Se eliminó la jugada entre Tercios Adelantadas de ${jugada.jugador_nombre || '(sin jugador)'} contra ${jugada.banquero_nombre || '(sin banquero)'} (carrera ${jugada.carrera_numero}, ${jugada.hipodromo_nombre}, ${fechaTexto}).`
  });

  res.json({ ok: true });
}));

// =================================================================
// REMATE — "Cargar Remate" (23-09-2026, ver la nota grande en
// services/hipismoRemateCalc.js y sql/schema.sql). A diferencia de
// "Cargar Planos", acá el ganador de cada remate depende de quién ganó
// LA CARRERA (posición 1 de la pizarra/llegada), no de una modalidad por
// línea — así que antes de poder calcular hace falta la llegada de esa
// carrera puntual: si ya existe un plano cargado para ese mismo
// hipódromo + carrera + fecha, se usa su pizarra automáticamente; si no,
// hay que mandarla a mano en el campo "pizarra" del body.
// =================================================================

// Busca la llegada a usar: la que mandó el Administrador a mano tiene
// prioridad (por si quiere corregirla o todavía no cargó el plano de esa
// carrera); si no mandó ninguna, se busca el plano más reciente de ESE
// mismo hipódromo + carrera + fecha ya guardado en "Cargar Planos".
async function resolverLlegadaRemate(req, { hipodromoNombre, carreraNumero, fecha, pizarraManual }) {
  if (pizarraManual && pizarraManual.trim()) {
    return { pizarra: pizarraManual.trim(), origen: 'manual' };
  }
  const rPlano = await db.query(
    `SELECT pizarra FROM hipismo_planos
      WHERE grupo_id = $1 AND hipodromo_nombre = $2 AND carrera_numero = $3 AND fecha = $4
      ORDER BY creado_en DESC LIMIT 1`,
    [req.grupoId, hipodromoNombre, carreraNumero, fecha]
  );
  if (rPlano.rows.length > 0) return { pizarra: rPlano.rows[0].pizarra, origen: 'plano_existente' };
  return { pizarra: null, origen: null };
}

// "REMATE PAGA" / "REMATE GARANTIZA" (26-09-2026, ver la nota grande de
// calcularRemate en services/hipismoRemateCalc.js) — el operador puede
// escribir a mano en cualquiera de los 2 campos (pisando lo que
// parsearRemate() detectó del texto pegado, que el frontend usa para
// rellenarlos solo la primera vez) o dejarlos vacíos para que se use lo
// detectado. bodyVal manda siempre que venga un número válido.
function numeroOpcionalConRespaldo(bodyVal, detectadoVal) {
  if (bodyVal !== undefined && bodyVal !== null && bodyVal !== '' && !isNaN(Number(bodyVal))) return Number(bodyVal);
  return detectadoVal != null ? Number(detectadoVal) : null;
}

// Nombre del ítem "REMATE" en Balance General/Cierre Final (ver la nota
// grande de GET /cierre-final más abajo) — nunca es un jugador real de
// verdad, así que GET /clientes/:nombre/detalle-semana lo especial-casa
// en vez de buscarlo en "jugadores".
const NOMBRE_ITEM_REMATE = 'REMATE';
// Nombre del ítem "WINNERS" (28-09-2026, a pedido del usuario: "al
// meterme en detallado por cliente [el ítem WINNERS] ... no se encontró
// ese cliente") — mismo caso EXACTO que "REMATE" arriba: es la
// contraparte sintética de "Cargar Winners" (ver la nota grande del
// ítem "WINNERS" en GET /cierre-final), nunca una fila real de
// "jugadores", así que también se especial-casa acá en vez de 404ear.
const NOMBRE_ITEM_WINNERS = 'WINNERS';
// Nombre del ítem "TABLAS FIJAS" (04-10-2026, a pedido del usuario, caso
// real: al hacerle click en Detallado por Cliente salía "No se encontró
// ese cliente") — mismo caso EXACTO que "REMATE"/"WINNERS" arriba: es el
// espejo sintético de Tabla Fija (ver acumular('TABLAS FIJAS', ...) en
// construirCierreFinalHipismo), nunca una fila real de "jugadores".
const NOMBRE_ITEM_TABLAS_FIJAS = 'TABLAS FIJAS';

// POST /remates/calcular: calcula SIN guardar — para revisar el remate
// (y, si hace falta, cargar la llegada a mano) antes de decidir guardarlo.
router.post('/remates/calcular', asyncHandler(async (req, res) => {
  const { texto, hipodromoNombre, carreraNumero, fecha, comisionPorcentaje, garantia, pagoFijo, pizarra } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Falta el texto del remate.' });
  if (!hipodromoNombre) return res.status(400).json({ error: 'Falta el hipódromo.' });
  if (!carreraNumero) return res.status(400).json({ error: 'Falta el número de carrera.' });

  const { apuestas, pagoFijo: pagoFijoDetectado, garantia: garantiaDetectado, sinReconocer } = parsearRemate(texto);
  if (!apuestas.length) return res.status(400).json({ error: 'No reconocí ninguna apuesta en el texto — revisa el formato de las líneas.' });
  if (await rechazarClientesInexistentes(req, res, apuestas.map(a => a.cliente))) return;

  const pagoFijoFinal = numeroOpcionalConRespaldo(pagoFijo, pagoFijoDetectado);
  const garantiaFinal = numeroOpcionalConRespaldo(garantia, garantiaDetectado);
  if (pagoFijoFinal != null && garantiaFinal != null) {
    return res.status(400).json({ error: 'No puedes usar "Remate Paga" y "Remate Garantiza" al mismo tiempo en el mismo remate — deja uno de los dos vacío.' });
  }
  // El % de comisión solo hace falta cuando NO es "REMATE PAGA" (monto
  // fijo, sin %) — ver la nota grande de calcularRemate.
  if (pagoFijoFinal == null && (comisionPorcentaje === undefined || comisionPorcentaje === null || comisionPorcentaje === '' || isNaN(Number(comisionPorcentaje)))) {
    return res.status(400).json({ error: 'Falta el % de comisión de este remate (no todos cobran igual).' });
  }

  const fechaFinal = fecha || fechaHoyVenezuela();
  const { pizarra: pizarraResuelta, origen } = await resolverLlegadaRemate(req, { hipodromoNombre, carreraNumero, fecha: fechaFinal, pizarraManual: pizarra });
  const poolTotal = apuestas.reduce((acc, a) => acc + a.monto, 0);

  if (!pizarraResuelta) {
    return res.json({
      apuestas, pagoFijoDetectado, garantiaDetectado, sinReconocer, poolTotal,
      necesitaLlegada: true
    });
  }

  const numeroGanador = primerNumeroPizarra(pizarraResuelta);
  const resultado = calcularRemate({ apuestas, garantia: garantiaFinal, pagoFijo: pagoFijoFinal, comisionPorcentaje, numeroGanador });
  const textoResultado = armarTextoResultadoRemate({
    nombreGrupo: req.grupo.nombre, hipodromoNombre, carreraNumero,
    pizarra: pizarraResuelta, apuestas, garantia: garantiaFinal, pagoFijo: pagoFijoFinal, numeroGanador, resultado
  });

  res.json({
    apuestas, pagoFijoDetectado, garantiaDetectado, sinReconocer, poolTotal,
    pizarra: pizarraResuelta, origenPizarra: origen, numeroGanador,
    necesitaLlegada: false,
    hayGanador: resultado.hayGanador,
    apuestaGanadora: resultado.apuestaGanadora,
    pagoGanador: resultado.pagoGanador,
    // "REMATE PAGA"/"REMATE GARANTIZA" (26-09-2026, a pedido del
    // usuario: "eso de si el remate pierde o gana... no me lo des en el
    // plano... me lo llevas a la parte administrativa") — resultadoRemate
    // (antes "comisionTotal") es SOLO para la parte administrativa (ver
    // el textoResultado de arriba, que nunca lo incluye).
    resultadoRemate: resultado.resultadoRemate,
    advertenciaGarantiaNoAlcanza: resultado.advertenciaGarantiaNoAlcanza,
    totalesPorCliente: resultado.totalesPorCliente,
    textoResultado
  });
}));

// POST /remates: calcula Y guarda de verdad (hipismo_remates + hipismo_remate_apuestas).
router.post('/remates', asyncHandler(async (req, res) => {
  const { texto, hipodromoId, hipodromoNombre, carreraNumero, fecha, comisionPorcentaje, garantia, pagoFijo, pizarra } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Falta el texto del remate.' });
  if (!carreraNumero) return res.status(400).json({ error: 'Falta el número de carrera.' });

  let nombreHipodromoFinal = hipodromoNombre;
  if (hipodromoId) {
    const rh = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2', [hipodromoId, req.grupoId]);
    if (rh.rows.length === 0) return res.status(400).json({ error: 'Hipódromo no encontrado.' });
    nombreHipodromoFinal = rh.rows[0].nombre;
  }
  if (!nombreHipodromoFinal) return res.status(400).json({ error: 'Falta el hipódromo.' });

  const { apuestas, pagoFijo: pagoFijoDetectado, garantia: garantiaDetectado, sinReconocer } = parsearRemate(texto);
  if (!apuestas.length) return res.status(400).json({ error: 'No reconocí ninguna apuesta en el texto — revisa el formato de las líneas.' });

  const pagoFijoFinal = numeroOpcionalConRespaldo(pagoFijo, pagoFijoDetectado);
  const garantiaFinal = numeroOpcionalConRespaldo(garantia, garantiaDetectado);
  if (pagoFijoFinal != null && garantiaFinal != null) {
    return res.status(400).json({ error: 'No puedes usar "Remate Paga" y "Remate Garantiza" al mismo tiempo en el mismo remate — deja uno de los dos vacío.' });
  }
  if (pagoFijoFinal == null && (comisionPorcentaje === undefined || comisionPorcentaje === null || comisionPorcentaje === '' || isNaN(Number(comisionPorcentaje)))) {
    return res.status(400).json({ error: 'Falta el % de comisión de este remate (no todos cobran igual).' });
  }

  const fechaFinal = fecha || fechaHoyVenezuela();
  const { pizarra: pizarraResuelta } = await resolverLlegadaRemate(req, { hipodromoNombre: nombreHipodromoFinal, carreraNumero, fecha: fechaFinal, pizarraManual: pizarra });
  if (!pizarraResuelta) {
    return res.status(400).json({ error: 'Falta la llegada de esta carrera — todavía no hay un plano cargado con la pizarra para este hipódromo/carrera/fecha. Cargala a mano en "Llegada" para poder guardar el remate.' });
  }

  const numeroGanador = primerNumeroPizarra(pizarraResuelta);
  const resultado = calcularRemate({ apuestas, garantia: garantiaFinal, pagoFijo: pagoFijoFinal, comisionPorcentaje, numeroGanador });
  const textoResultado = armarTextoResultadoRemate({
    nombreGrupo: req.grupo.nombre, hipodromoNombre: nombreHipodromoFinal, carreraNumero,
    pizarra: pizarraResuelta, apuestas, garantia: garantiaFinal, pagoFijo: pagoFijoFinal, numeroGanador, resultado
  });

  // Da de alta en "jugadores" a cualquier cliente nuevo de este remate —
  // misma tabla compartida, mismo criterio que ya usa "Cargar Planos".
  const nombresDelRemate = new Set(apuestas.map(a => a.cliente));
  if (await rechazarClientesInexistentes(req, res, Array.from(nombresDelRemate))) return;
  // Mismo criterio que POST /planos (26-09-2026, ver la nota grande de
  // obtenerComisionesPropias): un remate confirmado también puede
  // generar "% devuelto" (entra igual que Tercios en Cierre Final/
  // Comisiones Devueltas, ver obtenerApuestasDelDia) — se asegura la
  // cuenta de comisión real acá, al guardar de verdad, nunca en la vista
  // previa de "Calcular".
  await asegurarCuentasComisionParaNombres(req.grupoId, Array.from(nombresDelRemate));

  const remate = await db.transaccion(async (client) => {
    const rRemate = await client.query(
      `INSERT INTO hipismo_remates (grupo_id, hipodromo_id, hipodromo_nombre, carrera_numero, fecha, texto_original, comision_porcentaje, garantia, pago_fijo, pool_total, pizarra, numero_ganador, hubo_ganador, caballo_ganador, cliente_ganador, pago_ganador, comision_total, texto_resultado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [req.grupoId, hipodromoId || null, nombreHipodromoFinal, carreraNumero, fechaFinal, texto, Number(comisionPorcentaje) || 0, garantiaFinal, pagoFijoFinal,
        resultado.poolTotal, pizarraResuelta, numeroGanador, resultado.hayGanador,
        resultado.apuestaGanadora ? resultado.apuestaGanadora.caballo : null,
        resultado.apuestaGanadora ? resultado.apuestaGanadora.cliente : null,
        // comision_total (nombre de columna sin cambios, ver la nota
        // grande en sql/schema.sql): guarda resultado.resultadoRemate,
        // que YA NO es "comisión" — es el resultado del remate en sí.
        resultado.pagoGanador, resultado.resultadoRemate, textoResultado]
    );
    const remateCreado = rRemate.rows[0];

    for (const a of apuestas) {
      const esGanadora = resultado.hayGanador && a.numeroEjemplar === numeroGanador;
      const lineaResultado = esGanadora ? (resultado.pagoGanador - a.monto) : -a.monto;
      await client.query(
        `INSERT INTO hipismo_remate_apuestas (remate_id, grupo_id, numero_ejemplar, caballo, cliente_nombre, monto, resultado)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [remateCreado.id, req.grupoId, a.numeroEjemplar, a.caballo, a.cliente, a.monto, lineaResultado]
      );
    }
    return remateCreado;
  });

  res.status(201).json({
    remate, apuestas, sinReconocer, textoResultado,
    advertenciaGarantiaNoAlcanza: resultado.advertenciaGarantiaNoAlcanza,
    totalesPorCliente: resultado.totalesPorCliente
  });
}));

// =================================================================
// "REMATE MANUAL" EN MODO NETO DIRECTO (04-10-2026, a pedido del
// usuario: "aqui en remate manual, no quiero colcoar pizarra ni comision
// ni anda solo sleccionar el dia el hipodromo y la carrerra, elegir
// caballo el jugador y te voy a colocar el monto neto de cuanto se gana
// cada uno o cuanto pierde ... si la lista el cliente que gana contra
// los clientes que pierden falta dinero para pagarle al que gana el
// item remate en esa carrera saldria - lo faltante .... si es al revez
// todo lo que los tercios pierdan sobra dinero o no hay que pagarle a a
// nadie eso se lo ganaria el remate"). Mismo criterio EXACTO de "Cargar
// Winners" (ver POST /winners más abajo): el operador ya sabe cuánto
// ganó o perdió cada cliente y lo escribe directo — nada de
// parsearRemate, calcularRemate, % de comisión, pizarra, pago fijo ni
// garantía (confirmado con el usuario, AskUserQuestion 04-10-2026: 1
// solo paso, sin "Calcular" previo).
//
// Se guarda en las MISMAS hipismo_remates/hipismo_remate_apuestas de
// siempre (nunca una tabla aparte) para que el ítem "REMATE" de Balance
// General/Cierre Final y su detalle carrera-a-carrera
// (construirResumenRemateHipismo) sigan funcionando sin tocarlos: acá
// comision_total es el ESPEJO exacto de la suma de todos los netos
// entrados — si falta plata para pagarle al que gana, el Remate queda
// NEGATIVO (lo puso la banca); si sobra, queda POSITIVO (se lo ganó la
// banca) — exactamente lo que pidió el usuario. La columna "modo" =
// 'manual' (ver sql/schema.sql) es lo único que distingue esta fila de
// un remate de pool — GET /pizarras, PUT/DELETE /pizarras/remate/:id y
// obtenerApuestasDelRango (Montos Apostados/Comisiones Devueltas) ya la
// ignoran a propósito: no tiene pizarra ni pool real que recalcular ni
// "lo apostado" que mostrar (mismo criterio que Winners, que tampoco
// aparece en esos reportes).
// Arma el texto para WhatsApp + el texto "original" + los totales por
// cliente de un Remate Manual a partir de sus líneas (cliente/ejemplar/
// monto neto con signo). Se usa tanto al guardarlo (POST /remates/manual)
// como al editar/borrar una línea suelta desde "Revisar Jugadas" (PUT/
// DELETE /remates/:id/apuestas/:apuestaId), para que el texto siempre
// quede igual al de un remate recién cargado (05-10-2026).
function armarTextoRemateManual({ nombreGrupo, hipodromoNombre, carreraNumero, fecha, lineas }) {
  const totalesPorCliente = {};
  lineas.forEach(l => { totalesPorCliente[l.cliente] = round2((totalesPorCliente[l.cliente] || 0) + l.monto); });

  const encabezado = `*🏇 REMATE ${(nombreGrupo || '').toUpperCase()}*\n${hipodromoNombre}, ${carreraNumero}ta Carrera — ${fecha}`;
  const lineasTexto = lineas.map(l =>
    `🐎 ${l.numeroEjemplar} — *${formatNombre(l.cliente)}*: ${l.monto >= 0 ? '+' : '-'}${formatMontoTabla(l.monto)}`
  );
  const lineasTotales = Object.keys(totalesPorCliente).sort((a, b) => a.localeCompare(b, 'es')).map(nombre =>
    `${formatNombre(nombre)} ${totalesPorCliente[nombre] >= 0 ? '+' : '-'}${formatMontoTabla(totalesPorCliente[nombre])}`
  );
  const textoResultado = [encabezado, '', ...lineasTexto, '', 'TOTALES:', ...lineasTotales].join('\n');
  const textoOriginal = lineas.map(l => `${l.numeroEjemplar}- EJEMPLAR ${l.numeroEjemplar} ${l.monto}$ ${l.cliente}`).join('\n');
  return { totalesPorCliente, textoResultado, textoOriginal };
}

router.post('/remates/manual', asyncHandler(async (req, res) => {
  const { hipodromoId, hipodromoNombre, carreraNumero, fecha, lineas } = req.body;
  if (!carreraNumero) return res.status(400).json({ error: 'Falta el número de carrera.' });
  if (!Array.isArray(lineas) || !lineas.length) {
    return res.status(400).json({ error: 'Agrega al menos un ejemplar con su jugador y su monto neto.' });
  }

  let nombreHipodromoFinal = hipodromoNombre;
  if (hipodromoId) {
    const rh = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2', [hipodromoId, req.grupoId]);
    if (rh.rows.length === 0) return res.status(400).json({ error: 'Hipódromo no encontrado.' });
    nombreHipodromoFinal = rh.rows[0].nombre;
  }
  if (!nombreHipodromoFinal) return res.status(400).json({ error: 'Falta el hipódromo.' });

  const lineasValidas = [];
  for (const l of (lineas || [])) {
    const cliente = ((l && l.cliente) || '').toString().trim();
    const numeroEjemplar = parseInt(l && l.numeroEjemplar, 10);
    const monto = Number(l && l.monto);
    if (!cliente || !isFinite(numeroEjemplar) || numeroEjemplar <= 0 || !isFinite(monto) || monto === 0) continue;
    lineasValidas.push({ cliente, numeroEjemplar, caballo: `EJEMPLAR ${numeroEjemplar}`, monto });
  }
  if (!lineasValidas.length) {
    return res.status(400).json({ error: 'Ninguna línea tiene jugador, ejemplar y monto neto válidos (el monto no puede quedar en 0).' });
  }

  const fechaFinal = fecha || fechaHoyVenezuela();
  // round2(-suma) -- mismo invariante ESPEJO ya usado en todo el sistema
  // (cliente + contraparte = 0, ver TABLAS FIJAS/WINNERS más arriba).
  const resultadoRemate = round2(-lineasValidas.reduce((acc, l) => acc + l.monto, 0));

  const nombresDelRemate = new Set(lineasValidas.map(l => l.cliente));
  if (await rechazarClientesInexistentes(req, res, Array.from(nombresDelRemate))) return;
  await asegurarCuentasComisionParaNombres(req.grupoId, Array.from(nombresDelRemate));

  const { totalesPorCliente, textoResultado, textoOriginal } = armarTextoRemateManual({
    nombreGrupo: req.grupo.nombre, hipodromoNombre: nombreHipodromoFinal, carreraNumero, fecha: fechaFinal, lineas: lineasValidas
  });

  const remate = await db.transaccion(async (client) => {
    const rRemate = await client.query(
      `INSERT INTO hipismo_remates (grupo_id, hipodromo_id, hipodromo_nombre, carrera_numero, fecha, texto_original, comision_porcentaje, garantia, pago_fijo, pool_total, pizarra, numero_ganador, hubo_ganador, caballo_ganador, cliente_ganador, pago_ganador, comision_total, texto_resultado, modo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [req.grupoId, hipodromoId || null, nombreHipodromoFinal, carreraNumero, fechaFinal, textoOriginal, 0, null, null,
        0, null, null, false, null, null, 0, resultadoRemate, textoResultado, 'manual']
    );
    const remateCreado = rRemate.rows[0];
    for (const l of lineasValidas) {
      await client.query(
        `INSERT INTO hipismo_remate_apuestas (remate_id, grupo_id, numero_ejemplar, caballo, cliente_nombre, monto, resultado)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [remateCreado.id, req.grupoId, l.numeroEjemplar, l.caballo, l.cliente, l.monto, l.monto]
      );
    }
    return remateCreado;
  });

  res.status(201).json({ remate, totalesPorCliente, textoResultado });
}));

// DELETE /remates/manual/:id : borra un Remate Manual COMPLETO (cascada
// a hipismo_remate_apuestas) — a diferencia de DELETE /pizarras/remate/:id
// (que solo vacía la pizarra de un remate de pool y lo deja "pendiente"),
// un Remate Manual no tiene pizarra que corregir: si el operador se
// equivocó en los montos, lo borra entero y lo vuelve a cargar (04-10-2026,
// lo prometido al usuario al confirmar este modo: "si te equivocas, lo
// borras... y lo vuelves a cargar"). Por eso exige modo='manual' — nunca
// se usa para borrar un remate de pool (eso sigue siendo "Eliminar
// Jornada", con clave, o "Pizarras" para solo despejar la llegada).
router.delete('/remates/manual/:id', asyncHandler(async (req, res) => {
  const rRemate = await db.query('SELECT * FROM hipismo_remates WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const remate = rRemate.rows[0];
  if (!remate) return res.status(404).json({ error: 'Remate no encontrado.' });
  if (remate.modo !== 'manual') return res.status(400).json({ error: 'Este remate no es de modo manual — bórralo desde "Eliminar Jornada" o corrígelo desde "Pizarras".' });

  await db.query('DELETE FROM hipismo_remates WHERE id = $1', [remate.id]);

  await registrarAlerta(req, {
    tipo: 'REMATE_MANUAL_ELIMINADO', hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero,
    fecha: fechaComoISO(remate.fecha),
    mensaje: `Se eliminó el Remate Manual de ${remate.hipodromo_nombre}, carrera ${remate.carrera_numero} (${fechaComoISO(remate.fecha)}) — borrado permanente.`
  });

  res.json({ ok: true });
}));

// =================================================================
// REVISAR JUGADAS — editar/borrar UNA apuesta suelta de un remate
// (05-10-2026, a pedido del usuario: nueva pestaña Administración >
// "Revisar Jugadas", donde al elegir día/hipódromo/carrera se ve TODO
// lo de esa carrera y se puede editar o eliminar cada jugada). Confirmado
// con el usuario (AskUserQuestion 05-10-2026): "Editar y borrar cada
// apuesta" tanto en remates de pool como en Remates Manuales.
//
// Una sola ruta para los dos modos (se ramifica por hipismo_remates.modo):
//  - 'manual': monto neto con signo (distinto de 0); el REMATE (espejo)
//    se recalcula solo como -suma de todos los netos y se regenera el
//    texto para WhatsApp.
//  - 'pool': monto > 0; se recalcula el remate COMPLETO con la misma
//    función de siempre (calcularRemate: pool, pago al ganador,
//    comisión/garantía/pago fijo, resultado de cada cliente) usando la
//    pizarra que ya tenía. Si ese remate está pendiente de llegada
//    (pizarra vaciada desde "Pizarras"), solo se ajusta el pool_total y el
//    resto queda pendiente como estaba.
// Si se borra la ÚLTIMA apuesta de un remate, se borra el remate entero
// (un remate sin apuestas no tiene sentido) — el frontend lo avisa antes.
// =================================================================
async function recalcularRemateTrasCambioDeApuestas(req, remate) {
  const rA = await db.query('SELECT * FROM hipismo_remate_apuestas WHERE remate_id = $1 ORDER BY creado_en', [remate.id]);
  const filas = rA.rows;
  const fechaTexto = fechaComoISO(remate.fecha);

  if (remate.modo === 'manual') {
    const lineas = filas.map(a => ({ cliente: a.cliente_nombre, numeroEjemplar: a.numero_ejemplar, monto: Number(a.monto) }));
    const resultadoRemate = round2(-lineas.reduce((acc, l) => acc + l.monto, 0));
    const { totalesPorCliente, textoResultado, textoOriginal } = armarTextoRemateManual({
      nombreGrupo: req.grupo.nombre, hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero, fecha: fechaTexto, lineas
    });
    await db.query(
      'UPDATE hipismo_remates SET comision_total = $1, texto_resultado = $2, texto_original = $3 WHERE id = $4',
      [resultadoRemate, textoResultado, textoOriginal, remate.id]
    );
    return { remate: { ...remate, comision_total: resultadoRemate, texto_resultado: textoResultado, texto_original: textoOriginal }, apuestas: filas, totalesPorCliente };
  }

  const apuestas = filas.map(a => ({ numeroEjemplar: a.numero_ejemplar, caballo: a.caballo, cliente: a.cliente_nombre, monto: Number(a.monto) }));
  const poolTotal = apuestas.reduce((acc, a) => acc + a.monto, 0);

  if (!remate.pizarra || remate.numero_ganador == null) {
    await db.query('UPDATE hipismo_remates SET pool_total = $1 WHERE id = $2', [poolTotal, remate.id]);
    return { remate: { ...remate, pool_total: poolTotal }, apuestas: filas, totalesPorCliente: null };
  }

  const numeroGanador = remate.numero_ganador;
  const garantia = remate.garantia != null ? Number(remate.garantia) : null;
  const pagoFijo = remate.pago_fijo != null ? Number(remate.pago_fijo) : null;
  const resultado = calcularRemate({ apuestas, garantia, pagoFijo, comisionPorcentaje: Number(remate.comision_porcentaje), numeroGanador });
  const textoResultado = armarTextoResultadoRemate({
    nombreGrupo: req.grupo.nombre, hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero,
    pizarra: remate.pizarra, apuestas, garantia, pagoFijo, numeroGanador, resultado
  });

  await db.transaccion(async (client) => {
    for (const a of filas) {
      const esGanadora = resultado.hayGanador && a.numero_ejemplar === numeroGanador;
      const lineaResultado = esGanadora ? (resultado.pagoGanador - Number(a.monto)) : -Number(a.monto);
      await client.query('UPDATE hipismo_remate_apuestas SET resultado = $1 WHERE id = $2', [lineaResultado, a.id]);
    }
    await client.query(
      `UPDATE hipismo_remates
          SET pool_total = $1, hubo_ganador = $2, caballo_ganador = $3, cliente_ganador = $4,
              pago_ganador = $5, comision_total = $6, texto_resultado = $7
        WHERE id = $8`,
      [
        resultado.poolTotal, resultado.hayGanador,
        resultado.apuestaGanadora ? resultado.apuestaGanadora.caballo : null,
        resultado.apuestaGanadora ? resultado.apuestaGanadora.cliente : null,
        resultado.pagoGanador, resultado.resultadoRemate, textoResultado, remate.id
      ]
    );
  });

  const rFinal = await db.query('SELECT * FROM hipismo_remate_apuestas WHERE remate_id = $1 ORDER BY numero_ejemplar', [remate.id]);
  return {
    remate: {
      ...remate, pool_total: resultado.poolTotal, hubo_ganador: resultado.hayGanador, pago_ganador: resultado.pagoGanador,
      comision_total: resultado.resultadoRemate, texto_resultado: textoResultado
    },
    apuestas: rFinal.rows,
    totalesPorCliente: resultado.totalesPorCliente
  };
}

async function cargarRemateYApuesta(req) {
  const rRemate = await db.query('SELECT * FROM hipismo_remates WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const remate = rRemate.rows[0];
  if (!remate) return { error: { status: 404, mensaje: 'Remate no encontrado.' } };
  const rApuesta = await db.query('SELECT * FROM hipismo_remate_apuestas WHERE id = $1 AND remate_id = $2', [req.params.apuestaId, remate.id]);
  const apuesta = rApuesta.rows[0];
  if (!apuesta) return { error: { status: 404, mensaje: 'Esa apuesta no pertenece a este remate.' } };
  return { remate, apuesta };
}

router.put('/remates/:id/apuestas/:apuestaId', asyncHandler(async (req, res) => {
  const { remate, apuesta, error } = await cargarRemateYApuesta(req);
  if (error) return res.status(error.status).json({ error: error.mensaje });

  const { cliente, numeroEjemplar, monto } = req.body;
  const clienteFinal = ((cliente !== undefined && cliente !== null && cliente !== '') ? String(cliente) : apuesta.cliente_nombre).trim().toUpperCase().replace(/\s+/g, ' ');
  const numeroFinal = (numeroEjemplar !== undefined && numeroEjemplar !== null && numeroEjemplar !== '') ? parseInt(numeroEjemplar, 10) : apuesta.numero_ejemplar;
  const montoFinal = (monto !== undefined && monto !== null && monto !== '') ? Number(monto) : Number(apuesta.monto);
  const esManual = remate.modo === 'manual';

  if (!clienteFinal) return res.status(400).json({ error: 'Falta el jugador.' });
  if (!isFinite(numeroFinal) || numeroFinal <= 0) return res.status(400).json({ error: 'El ejemplar tiene que ser un número mayor a 0.' });
  if (!isFinite(montoFinal)) return res.status(400).json({ error: 'El monto tiene que ser un número.' });
  if (esManual && montoFinal === 0) return res.status(400).json({ error: 'El monto neto no puede quedar en 0.' });
  if (!esManual && montoFinal <= 0) return res.status(400).json({ error: 'El monto tiene que ser un número mayor a 0.' });

  if (clienteFinal !== apuesta.cliente_nombre) {
    if (await rechazarClientesInexistentes(req, res, [clienteFinal])) return;
    await asegurarCuentasComisionParaNombres(req.grupoId, [clienteFinal]);
  }

  // El "caballo" es solo la etiqueta del ejemplar: se actualiza junto con el
  // número cuando era la genérica "EJEMPLAR N"; si traía un nombre real, se
  // respeta tal cual.
  let caballoFinal = apuesta.caballo;
  if (numeroFinal !== apuesta.numero_ejemplar && (esManual || /^EJEMPLAR \d+$/i.test(apuesta.caballo || ''))) {
    caballoFinal = `EJEMPLAR ${numeroFinal}`;
  }

  await db.query(
    `UPDATE hipismo_remate_apuestas
        SET cliente_nombre = $1, numero_ejemplar = $2, caballo = $3, monto = $4, resultado = $5
      WHERE id = $6 AND remate_id = $7`,
    [clienteFinal, numeroFinal, caballoFinal, montoFinal, esManual ? montoFinal : Number(apuesta.resultado), apuesta.id, remate.id]
  );

  const recalculo = await recalcularRemateTrasCambioDeApuestas(req, remate);

  await registrarAlerta(req, {
    tipo: 'PIZARRA_EDITADA', hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero,
    fecha: fechaComoISO(remate.fecha),
    mensaje: `Se editó una apuesta del ${esManual ? 'Remate Manual' : 'remate'} de ${remate.hipodromo_nombre}, carrera ${remate.carrera_numero} (${clienteFinal}, ejemplar ${numeroFinal}, ${montoFinal}) y se recalculó el remate.`
  });

  res.json(recalculo);
}));

router.delete('/remates/:id/apuestas/:apuestaId', asyncHandler(async (req, res) => {
  const { remate, apuesta, error } = await cargarRemateYApuesta(req);
  if (error) return res.status(error.status).json({ error: error.mensaje });
  const esManual = remate.modo === 'manual';

  const rCuenta = await db.query('SELECT COUNT(*)::int AS n FROM hipismo_remate_apuestas WHERE remate_id = $1', [remate.id]);
  const quedan = rCuenta.rows[0].n - 1;

  if (quedan <= 0) {
    await db.query('DELETE FROM hipismo_remates WHERE id = $1', [remate.id]);
    await registrarAlerta(req, {
      tipo: esManual ? 'REMATE_MANUAL_ELIMINADO' : 'PIZARRA_ELIMINADA', hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero,
      fecha: fechaComoISO(remate.fecha),
      mensaje: `Se eliminó la única apuesta que quedaba (${apuesta.cliente_nombre}, ejemplar ${apuesta.numero_ejemplar}) del ${esManual ? 'Remate Manual' : 'remate'} de ${remate.hipodromo_nombre}, carrera ${remate.carrera_numero} — el remate completo se borró.`
    });
    return res.json({ ok: true, remateEliminado: true });
  }

  await db.query('DELETE FROM hipismo_remate_apuestas WHERE id = $1 AND remate_id = $2', [apuesta.id, remate.id]);
  const recalculo = await recalcularRemateTrasCambioDeApuestas(req, remate);

  await registrarAlerta(req, {
    tipo: esManual ? 'REMATE_MANUAL_ELIMINADO' : 'PIZARRA_EDITADA', hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero,
    fecha: fechaComoISO(remate.fecha),
    mensaje: `Se eliminó una apuesta (${apuesta.cliente_nombre}, ejemplar ${apuesta.numero_ejemplar}) del ${esManual ? 'Remate Manual' : 'remate'} de ${remate.hipodromo_nombre}, carrera ${remate.carrera_numero} y se recalculó el remate.`
  });

  res.json({ ok: true, remateEliminado: false, ...recalculo });
}));

// GET /remates?fecha=&hipodromoId=&modo=&limite= : historial reciente (cabeceras).
router.get('/remates', asyncHandler(async (req, res) => {
  const { fecha, hipodromoId, modo, limite } = req.query;
  const condiciones = ['grupo_id = $1'];
  const params = [req.grupoId];
  if (fecha) { params.push(fecha); condiciones.push(`fecha = $${params.length}`); }
  if (hipodromoId) { params.push(hipodromoId); condiciones.push(`hipodromo_id = $${params.length}`); }
  if (modo) { params.push(modo); condiciones.push(`modo = $${params.length}`); }
  params.push(Math.min(parseInt(limite, 10) || 50, 200));
  const r = await db.query(
    `SELECT id, hipodromo_nombre, carrera_numero, fecha, comision_porcentaje, garantia, pool_total, hubo_ganador, cliente_ganador, pago_ganador, comision_total, modo, creado_en
       FROM hipismo_remates WHERE ${condiciones.join(' AND ')} ORDER BY creado_en DESC LIMIT $${params.length}`,
    params
  );
  res.json(r.rows);
}));

// GET /remates/:id : detalle completo (cabecera + apuestas), para revisar un remate ya guardado.
router.get('/remates/:id', asyncHandler(async (req, res) => {
  const rRemate = await db.query('SELECT * FROM hipismo_remates WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const remate = rRemate.rows[0];
  if (!remate) return res.status(404).json({ error: 'Remate no encontrado.' });
  const rApuestas = await db.query('SELECT * FROM hipismo_remate_apuestas WHERE remate_id = $1 ORDER BY numero_ejemplar', [remate.id]);
  res.json({ remate, apuestas: rApuestas.rows });
}));

// =================================================================
// "PIZARRAS" (01-10-2026, a pedido del usuario: "crea un boton debajo de
// hipodromos que diga pizarras / alli puedo ver, editar, eliminar...
// por dia por hipodromo ordenado, las llegadas de las carreras").
//
// Pantalla nueva en Administración, debajo de "Hipódromos", para ver/
// editar/eliminar la LLEGADA (pizarra) de una carrera ya cargada — por
// día > hipódromo > carrera, con cada modalidad presente en esa carrera
// (Tercios y/o Remate) como su propia tarjeta, independiente una de la
// otra. Esto se definió con el usuario en una ronda de 3 preguntas
// (AskUserQuestion, 01-10-2026):
//
//  1) ALCANCE: el usuario pidió, en sus propias palabras, poder "escoger
//     donde modificar, si seleccionar todas, o elegir si me modifica la
//     llegada para una sola modalidad de juego y las demas se siguen
//     decidiendo con su pizarra ya cargada" — por eso cada modalidad se
//     edita con su PROPIO endpoint (PUT /pizarras/tercios/:id,
//     PUT /pizarras/remate/:id), nunca un solo endpoint "por carrera":
//     el frontend decide si llama uno solo (una modalidad puntual) o los
//     2 seguidos (botón "aplicar a todas" cuando la carrera tiene más de
//     una modalidad cargada).
//  2) EDITAR: el usuario eligió "Recalcula todo el dinero" — editar la
//     pizarra de un plano/remate ya guardado tiene que recalcular TODOS
//     sus tickets/apuestas con la llegada corregida, no solo guardar el
//     texto nuevo. Se arma reusando el MISMO motor de cálculo que ya usa
//     PUT /planos/:id/tickets/:ticketId (Tercios) y POST /remates
//     (Remate) — nada de lógica de cálculo nueva acá.
//  3) ELIMINAR: el usuario eligió "Deja la carrera sin pizarra
//     (pendiente)", explícitamente NO "Elimina todo el plano/remate"
//     (eso ya lo hace "Eliminar Planos"/"Eliminar Winners"). Acá
//     "eliminar" vacía la pizarra (columna ahora NULLABLE, ver
//     sql/schema.sql) y pone todos los tickets/apuestas de esa carrera
//     en estado "sin decidir" — mismo patrón 0/0 que ya usa
//     decidida/gano en Montos Apostados (ver obtenerApuestasDelRango más
//     arriba), para que Balance General/Cierre Final/Pozo/Comisiones
//     Devueltas/Montos Apostados (que ya saben tratar 0 como "no
//     contribuye a nada") no necesiten ningún caso especial nuevo.
//
// ACTUALIZACIÓN 01-10-2026 (segunda ronda, tras ver la pantalla en
// producción) — 2 pedidos nuevos del usuario, confirmados con otra ronda
// de 3 preguntas (AskUserQuestion):
//
//  4) COMISIÓN NETA DE TERCIOS: la tarjeta de Tercios mostraba
//     comision_total BRUTO de ese plano (p.ej. "115,50"), pero el usuario
//     la compara contra Balance General/Cierre Final, que SIEMPRE
//     descuenta de la comisión el % propio/de aval que se le devuelve a
//     cada cliente ("COMISIÓN REAL", ver la nota grande de
//     construirCierreFinalHipismo en services/hipismoResumenCliente.js) —
//     en sus palabras: "debes mostrar el % que quedo en comsion para el
//     grupo en esa carrera ya descontando todas las devoluciones". Acá
//     se hace el MISMO cálculo (bruto menos % devuelto, filtrando tickets
//     "sin decidir" igual que /cierre-final) pero para UNA carrera
//     puntual en vez del agregado semanal — ver comisionDevueltaPorPlano
//     más abajo. Remate NO cambia: "LOS REMATES NO LE PRODUCEN % DE
//     DEVOLUCION A LOS CLIENTES" (nota ya existente en /cierre-final), así
//     que su montoTotal (pool_total, lo apostado) no tiene nada que
//     descontarle.
//
//  5) JUGADAS ADELANTADAS SÍ ENTRA (ya no queda afuera como decía la nota
//     vieja de arriba): el usuario pidió, al corregir la pizarra de una
//     carrera, "elegir a quién aplica esos cambios... los que no
//     seleccione se quedan con la pizarra que ya tenian cargada desde
//     planos... opción todos, jugadas adelantadas, remates, [...] plano
//     jugadas tercios" — Winners quedó afuera a propósito (confirmado:
//     "sacar Winners de esta pantalla" — no tiene pizarra ni se calcula
//     nada del lado del servidor, es un monto neto escrito a mano). Como
//     Adelantadas no tiene un único "plano" con 1 fila por carrera (cada
//     jugada guarda su propio pizarra_usada), se agrega como una fila
//     MÁS de esta misma lista (tipo:'adelantadas'), agregada por
//     hipódromo+carrera+fecha, con su PROPIO par de endpoints
//     (PUT/DELETE /pizarras/adelantadas, por fecha+hipódromo+carrera en
//     vez de por :id) que re-resuelve TODAS sus jugadas (no solo las que
//     seguían 'pendiente' — soloPendientes=false en
//     calcularResolucionAdelantadas, ver la nota grande ahí) con el mismo
//     motor de cálculo de siempre (resolverTablaFija/resolverClienteMarca).
//     OJO Marcas ya bancadas: si una Marca ya pasó por el banqueo manual
//     (estado='resuelto', con banqueadores ya cargado) y se corrige la
//     pizarra, vuelve a 'falta_banqueo'/'sin_decidir' y pierde ese
//     banqueadores (ver guardarResolucionAdelantadas) — es intencional
//     (banquear con la pizarra VIEJA ya no vale nada), pero el frontend
//     avisa esto antes de guardar para que no sea una sorpresa.
//
//     En el selector de "Aplicar a todas" (único lugar donde tiene
//     sentido elegir "a quién aplica", porque modificar UNA sola
//     modalidad ya lo hace su propio botón "Editar") cada modalidad
//     presente en la carrera aparece con su propio checkbox, todos
//     marcados por default — desmarcar una la deja "con la pizarra que ya
//     tenía cargada desde planos", tal cual lo pidió el usuario.
// =================================================================

// Texto placeholder para un plano/remate que queda "pendiente de
// pizarra" tras un DELETE acá — a propósito NO se reusa
// armarTextoResultado()/armarTextoResultadoRemate() (esas funciones
// asumen que YA hay un resultado que mostrar: con todo en 0 mostrarían
// "GANAN +0.00" para todo el mundo, lo cual sería engañoso — acá no
// ganó nadie todavía, está pendiente).
function textoPizarraPendiente({ hipodromoNombre, carreraNumero }) {
  return `⏳ *${hipodromoNombre}, ${carreraNumero}ta Carrera* — pendiente de pizarra (llegada eliminada). Esta carrera quedó sin decidir hasta que se cargue la llegada de nuevo.`;
}

// Comisión NETA de Tercios de UN plano puntual (01-10-2026, punto 4 de
// la nota grande de arriba) — mismo criterio exacto que
// construirCierreFinalHipismo (services/hipismoResumenCliente.js):
// bruto (comision_total) MENOS el % propio/de aval que generaron los
// tickets de ESE plano (cliente Y banquero, excluyendo tickets "sin
// decidir" y entradas con incluidaEnJugada — ver esa función para el
// porqué de cada exclusión), pero por UN plano en vez de agregado de
// toda la semana. Se recibe ya armado un Map(planoId -> devuelto) para
// no repetir las 2 consultas (tickets + obtenerComisionesPropias) por
// cada plano del rango.
async function calcularDevueltoPorPlanoTercios(req, planoIds) {
  const porPlano = new Map();
  if (!planoIds.length) return porPlano;
  const rTickets = await db.query(
    `SELECT plano_id, cliente_nombre, banquero_nombre, monto, resultado_jugador, resultado_banquero, sin_comision
       FROM hipismo_tickets WHERE plano_id = ANY($1::uuid[])`,
    [planoIds]
  );
  const nombres = new Set();
  rTickets.rows.forEach(t => { nombres.add(t.cliente_nombre); nombres.add(t.banquero_nombre); });
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, Array.from(nombres));
  function devueltoDeNombre(nombre, monto) {
    const infos = comisionesPropias[nombre];
    if (!infos || !infos.length) return 0;
    // Acumula exacto (sin redondear cada entrada por separado, 02-10-2026
    // — ver la nota grande EXACTA de montoDecididoExacto en
    // hipismoAdelantadasCalc.js) y redondea UNA sola vez al devolver.
    let total = 0;
    infos.forEach(info => {
      if (!info || !info.pct || info.incluidaEnJugada) return;
      total += Math.abs(Number(monto) || 0) * (info.pct / 100);
    });
    return round2(total);
  }
  // montoDecidido (02-10-2026, "SIEMPRE ES BASE A LO DECIDIDO SIN SACARLE
  // EL 5%" — ver la nota grande de montoDecidido() en
  // services/hipismoAdelantadasCalc.js): NUNCA t.monto, cada lado usa su
  // propio resultado ya decidido.
  const ticketsDecididosPorPlano = rTickets.rows.filter(t => !(Number(t.resultado_jugador) === 0 && Number(t.resultado_banquero) === 0));
  // NETEO jugador/banquero (02-10-2026, caso GG: ver la nota grande EXACTA
  // de netearJugadorBanqueroTercios en services/hipismoCalc.js) — cada
  // `plano_id` YA ES una sola carrera (invariante "sustituir en vez de
  // duplicar", ver la nota grande de POST /planos más abajo: nunca hay 2
  // planos vivos para el mismo hipódromo+carrera+fecha), así que se usa
  // directo como clave de carrera, sin necesitar hipódromo/carrera/fecha.
  const netoPorPlanoId = netearJugadorBanqueroTercios(ticketsDecididosPorPlano.map(t => ({
    clienteNombre: t.cliente_nombre, banqueroNombre: t.banquero_nombre,
    resultadoJugador: t.resultado_jugador, resultadoBanquero: t.resultado_banquero,
    sinComision: t.sin_comision, fecha: t.plano_id, hipodromoNombre: '', carreraNumero: ''
  })));
  const dualAgregadoPorPlanoId = new Set();
  // FUSIONAR POR CARRERA ANTES DE REDONDEAR (02-10-2026, mismo bug y mismo
  // arreglo YA probado en /comisiones-devueltas, /cierre-final,
  // /saldo-comisiones y /semana-por-dias — caso real: Balance General daba
  // $379,65 y debía dar $379,78): antes, devueltoDeNombre() se llamaba y
  // se redondeaba una vez POR TICKET — si un cliente tenía 2+ tickets en
  // el mismo plano (misma carrera, ver la nota grande de arriba), sumar
  // esos redondeos parciales no siempre da lo mismo que sumar las bases
  // EXACTAS de esa carrera y redondear una sola vez. Ahora se acumula la
  // base exacta (sin redondear) por (plano, nombre) en `basePorPlanoNombre`
  // y recién al final se llama devueltoDeNombre() UNA sola vez por cliente
  // por plano, con la base ya sumada.
  const basePorPlanoNombre = new Map();
  function sumarBaseCarrera(planoId, nombre, monto) {
    const clave = `${planoId}::${nombre}`;
    basePorPlanoNombre.set(clave, (basePorPlanoNombre.get(clave) || 0) + (Number(monto) || 0));
  }
  ticketsDecididosPorPlano.forEach(t => {
    const claveCarrera = `${t.plano_id}::::`;
    const infoJugador = netoPorPlanoId.get(claveCarrera)?.get(t.cliente_nombre);
    const infoBanquero = netoPorPlanoId.get(claveCarrera)?.get(t.banquero_nombre);
    // 04-10-2026: montoDecididoExacto -> montoBaseComisionExacto -- "a
    // premio" SIN comisión (t.sin_comision, bandera REAL del ticket) no
    // genera % devuelto (ver la nota grande de montoBaseComisionExacto en
    // hipismoAdelantadasCalc.js).
    if (!(infoJugador && infoJugador.dual)) sumarBaseCarrera(t.plano_id, t.cliente_nombre, montoBaseComisionExacto(t.resultado_jugador, t.sin_comision));
    if (!(infoBanquero && infoBanquero.dual)) sumarBaseCarrera(t.plano_id, t.banquero_nombre, montoBaseComisionExacto(t.resultado_banquero, t.sin_comision));
    // netoExacto, no `neto` (02-10-2026, ver la nota grande EXACTA de
    // montoDecididoExacto en hipismoAdelantadasCalc.js).
    [t.cliente_nombre, t.banquero_nombre].forEach(nombre => {
      const info = netoPorPlanoId.get(claveCarrera)?.get(nombre);
      if (!info || !info.dual) return;
      const claveDual = `${t.plano_id}::${nombre}`;
      if (dualAgregadoPorPlanoId.has(claveDual)) return;
      dualAgregadoPorPlanoId.add(claveDual);
      sumarBaseCarrera(t.plano_id, nombre, info.netoExacto);
    });
  });
  // Recién ahora se llama devueltoDeNombre() (que ya redondea una vez,
  // internamente, sumando las hasta 2 entradas de % propio/aval de ese
  // cliente) con la base YA fusionada de toda la carrera.
  basePorPlanoNombre.forEach((baseExacta, clave) => {
    const idxSep = clave.indexOf('::');
    const planoId = clave.slice(0, idxSep);
    const nombre = clave.slice(idxSep + 2);
    const devuelto = devueltoDeNombre(nombre, baseExacta);
    if (devuelto) porPlano.set(planoId, round2((porPlano.get(planoId) || 0) + devuelto));
  });
  return porPlano;
}

// entradasApostadasDeTickets (02-10-2026, caso GG: ver la nota grande
// EXACTA de netearJugadorBanqueroTercios en services/hipismoCalc.js) —
// arma la lista `{nombre, monto}` que alimenta agregarPorcentajeDevuelto()
// a partir de los tickets de ESTA carrera puntual (todos pertenecen al
// mismo plano, recién calculado/guardado, así que una sola clave de
// carrera constante alcanza) más las Jugadas Adelantadas resueltas con la
// misma pizarra. Un cliente que juega Y banquea en esta MISMA carrera
// (Tercios, única fuente que puede traer ambos roles acá) deja de generar
// 2 entradas por separado y pasa a generar UNA sola sobre el NETO de
// ambos lados — mismo criterio EXACTO que ya usan /comisiones-devueltas,
// /cierre-final, /saldo-comisiones y /semana-por-dias. Compartida por
// POST /planos/calcular (vista previa) y POST /planos (guardado real)
// para no duplicar esta lógica 2 veces.
function entradasApostadasDeTickets(tickets, resueltas, resueltasTercios) {
  const ticketsDecididos = (tickets || []).filter(t => !(t.resultadoJugador === 0 && t.resultadoBanquero === 0));
  const netoDeEstaCarrera = netearJugadorBanqueroTercios(ticketsDecididos.map(t => ({
    clienteNombre: t.clienteNombre, banqueroNombre: t.banqueroNombre,
    resultadoJugador: t.resultadoJugador, resultadoBanquero: t.resultadoBanquero,
    sinComision: t.sinComision, fecha: 'x', hipodromoNombre: 'x', carreraNumero: 'x'
  }))).get('x::x::x') || new Map();
  const dualAgregado = new Set();
  const entradasTickets = ticketsDecididos.flatMap(t => {
    const entradas = [];
    const infoJugador = netoDeEstaCarrera.get(t.clienteNombre);
    const infoBanquero = netoDeEstaCarrera.get(t.banqueroNombre);
    // 04-10-2026: montoDecididoExacto -> montoBaseComisionExacto -- misma
    // razón que en sumarBaseCarrera más arriba (t.sinComision acá es
    // SIEMPRE la bandera REAL del ticket, esto es puro Tercios).
    if (!(infoJugador && infoJugador.dual)) entradas.push({ nombre: t.clienteNombre, monto: montoBaseComisionExacto(t.resultadoJugador, t.sinComision) });
    if (!(infoBanquero && infoBanquero.dual)) entradas.push({ nombre: t.banqueroNombre, monto: montoBaseComisionExacto(t.resultadoBanquero, t.sinComision) });
    // netoExacto, no `neto` (02-10-2026, ver la nota grande EXACTA de
    // montoDecididoExacto en hipismoAdelantadasCalc.js) — agregarPorcentajeDevuelto()
    // (hipismoComisionPropia.js) ya redondea una sola vez.
    [t.clienteNombre, t.banqueroNombre].forEach(nombre => {
      const info = netoDeEstaCarrera.get(nombre);
      if (!info || !info.dual || dualAgregado.has(nombre)) return;
      dualAgregado.add(nombre);
      entradas.push({ nombre, monto: info.netoExacto });
    });
    return entradas;
  });
  // Jugadas entre Tercios Adelantadas resueltas en ESTE plano (05-10-2026,
  // a pedido explícito del usuario: el % propio/de aval también se gana
  // en estas jugadas, "en todos lados"): ambos lados, base DECIDIDA, nunca
  // una 'sin_decidir'.
  const entradasTerciosAdelantadas = [];
  (resueltasTercios || []).filter(r => r.estadoNuevo === 'resuelto').forEach(r => {
    if (Number(r.resultadoJugador) !== 0) entradasTerciosAdelantadas.push({ nombre: r.jugador, monto: montoBaseTerciosAdelantadaExacto(r.resultadoJugador, r.comisionPorcentaje) });
    if (Number(r.resultadoBanquero) !== 0) entradasTerciosAdelantadas.push({ nombre: r.banquero, monto: montoBaseTerciosAdelantadaExacto(r.resultadoBanquero, r.comisionPorcentaje) });
  });
  return entradasTickets
    .concat((resueltas || []).filter(r => r.gano !== null && !r.sinComision).map(r => ({ nombre: r.cliente, monto: montoDecididoExacto(r.resultadoCliente, true) })))
    .concat(entradasTerciosAdelantadas);
}

// GET /pizarras?desde=&hasta= : lista Tercios (planos) + Remates +
// Jugadas Adelantadas (agregadas por carrera, 01-10-2026, punto 5 de la
// nota grande de arriba) en el rango, para que el frontend los agrupe
// por día > hipódromo > carrera.
router.get('/pizarras', asyncHandler(async (req, res) => {
  const hoy = fechaHoyVenezuela();
  const desde = req.query.desde || hoy;
  const hasta = req.query.hasta || hoy;

  const rPlanos = await db.query(
    `SELECT p.id, p.fecha, p.hipodromo_nombre, p.carrera_numero, p.pizarra, p.comision_total,
            (SELECT COUNT(*)::int FROM hipismo_tickets t WHERE t.plano_id = p.id) AS cantidad
       FROM hipismo_planos p
      WHERE p.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3
      ORDER BY p.fecha, p.hipodromo_nombre, p.carrera_numero`,
    [req.grupoId, desde, hasta]
  );
  // modo <> 'manual' (04-10-2026, ver la nota grande de POST
  // /remates/manual): un Remate Manual no tiene pizarra ni pool que
  // editar/eliminar acá — nunca debe ofrecerse como "pendiente de
  // pizarra" (mismo criterio que ya excluye a Winners de esta pantalla).
  const rRemates = await db.query(
    `SELECT r.id, r.fecha, r.hipodromo_nombre, r.carrera_numero, r.pizarra, r.pool_total,
            (SELECT COUNT(*)::int FROM hipismo_remate_apuestas a WHERE a.remate_id = r.id) AS cantidad
       FROM hipismo_remates r
      WHERE r.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3 AND r.modo <> 'manual'
      ORDER BY r.fecha, r.hipodromo_nombre, r.carrera_numero`,
    [req.grupoId, desde, hasta]
  );
  // Adelantadas, agregadas por fecha+hipódromo+carrera (no hay 1 fila por
  // carrera como en planos/remates — se arma acá con GROUP BY). pizarra
  // se toma de la jugada resuelta MÁS reciente (bool_and(pendiente) para
  // saber si TODAS siguen sin resolver todavía).
  const rAdelantadas = await db.query(
    `SELECT p.fecha, p.hipodromo_nombre, j.carrera_numero,
            COUNT(*)::int AS cantidad,
            COALESCE(SUM(j.monto), 0) AS monto_total,
            bool_and(j.estado = 'pendiente') AS todas_pendientes,
            (ARRAY_AGG(j.pizarra_usada ORDER BY j.resuelto_en DESC NULLS LAST))[1] AS pizarra_usada
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3
      GROUP BY p.fecha, p.hipodromo_nombre, j.carrera_numero
      ORDER BY p.fecha, p.hipodromo_nombre, j.carrera_numero`,
    [req.grupoId, desde, hasta]
  );

  const devueltoPorPlano = await calcularDevueltoPorPlanoTercios(req, rPlanos.rows.map(p => p.id));

  const filas = [
    ...rPlanos.rows.map(p => ({
      tipo: 'tercios', id: p.id, fecha: fechaComoISO(p.fecha), hipodromoNombre: p.hipodromo_nombre,
      carreraNumero: p.carrera_numero, pizarra: p.pizarra, pendiente: p.pizarra === null,
      cantidad: p.cantidad, montoTotal: round2(Number(p.comision_total) - (devueltoPorPlano.get(p.id) || 0))
    })),
    ...rRemates.rows.map(r => ({
      tipo: 'remate', id: r.id, fecha: fechaComoISO(r.fecha), hipodromoNombre: r.hipodromo_nombre,
      carreraNumero: r.carrera_numero, pizarra: r.pizarra, pendiente: r.pizarra === null,
      cantidad: r.cantidad, montoTotal: Number(r.pool_total)
    })),
    // tipo:'adelantadas' no tiene un :id de una sola fila de verdad (es
    // un agregado de varias jugadas) — PUT/DELETE /pizarras/adelantadas
    // identifican la carrera por fecha+hipodromoNombre+carreraNumero en
    // el body, nunca por `id` (acá solo de adorno/clave de lista).
    ...rAdelantadas.rows.map(a => ({
      tipo: 'adelantadas', id: `${fechaComoISO(a.fecha)}:${a.hipodromo_nombre}:${a.carrera_numero}`,
      fecha: fechaComoISO(a.fecha), hipodromoNombre: a.hipodromo_nombre, carreraNumero: a.carrera_numero,
      pizarra: a.pizarra_usada, pendiente: a.todas_pendientes,
      cantidad: a.cantidad, montoTotal: Number(a.monto_total)
    }))
  ];
  // Respuesta envuelta en {desde, hasta, filas} (mismo criterio que GET
  // /montos-apostados y GET /comisiones-devueltas): el frontend, al
  // entrar sin elegir fechas, pide SIN query y el default ("hoy") que
  // calculó el servidor arriba vuelve en la respuesta para reflejarse en
  // los campos Desde/Hasta — el cálculo del default vive en un solo lugar.
  res.json({ desde, hasta, filas });
}));

// PUT /pizarras/tercios/:id { pizarra } : corrige la llegada de un plano
// de Tercios ya guardado y recalcula TODOS sus tickets con la llegada
// nueva (ver punto 2 de la nota grande de arriba) — mismo patrón que
// PUT /planos/:id/tickets/:ticketId, pero sobre el plano completo.
router.put('/pizarras/tercios/:id', asyncHandler(async (req, res) => {
  const { pizarra } = req.body;
  if (!pizarra || !pizarra.trim()) return res.status(400).json({ error: 'Falta la Pizarra (orden de llegada).' });

  const rPlano = await db.query('SELECT * FROM hipismo_planos WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const plano = rPlano.rows[0];
  if (!plano) return res.status(404).json({ error: 'Plano no encontrado.' });

  const pizarraFinal = pizarra.trim();
  const rank = parsearPizarra(pizarraFinal);

  const rTodosTickets = await db.query('SELECT * FROM hipismo_tickets WHERE plano_id = $1 ORDER BY creado_en', [plano.id]);
  const ticketsRecalculados = [];
  for (const t of rTodosTickets.rows) {
    const recalculado = recalcularTicket({ modalidad: t.modalidad, caballo: t.caballo, monto: Number(t.monto), sinComision: t.sin_comision }, rank);
    if (!recalculado) return res.status(400).json({ error: `No se pudo recalcular el ticket de ${t.cliente_nombre} (modalidad "${t.modalidad}" no reconocida) con esta pizarra.` });
    ticketsRecalculados.push({ id: t.id, ...recalculado, raw: t });
  }

  const ticketsPlanos = ticketsRecalculados.map(({ raw, resultadoJugador, resultadoBanquero }) => ({
    clienteNombre: raw.cliente_nombre, banqueroNombre: raw.banquero_nombre, modalidad: raw.modalidad, caballo: raw.caballo,
    monto: Number(raw.monto), resultadoJugador, resultadoBanquero, sinComision: !!raw.sin_comision
  }));
  const { totalesFinales, comisionTotal } = recalcularTotalesPlano(ticketsPlanos, plano.cruza_jugadas);

  let textoResultadoFinal = plano.texto_resultado;
  if (!/PARADA ADELANTADAS/.test(plano.texto_resultado || '')) {
    textoResultadoFinal = armarTextoResultado({
      nombreGrupo: req.grupo.nombre, hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero,
      ret: plano.ret, pizarra: pizarraFinal, salidaLineas: armarSalidaLineasDeTickets(ticketsPlanos),
      totalesFinales, totalJugadas: ticketsPlanos.length
    });
  }

  await db.transaccion(async (client) => {
    for (const t of ticketsRecalculados) {
      await client.query(
        'UPDATE hipismo_tickets SET resultado_jugador = $1, resultado_banquero = $2 WHERE id = $3',
        [t.resultadoJugador, t.resultadoBanquero, t.id]
      );
    }
    await client.query(
      'UPDATE hipismo_planos SET pizarra = $1, comision_total = $2, texto_resultado = $3 WHERE id = $4',
      [pizarraFinal, comisionTotal, textoResultadoFinal, plano.id]
    );
  });

  // Si esta carrera todavía tiene Jugadas Adelantadas 'pendiente' (no se
  // resolvieron cuando se cargó el plano la primera vez, por ejemplo
  // porque llegaron DESPUÉS), la pizarra corregida también las resuelve
  // acá — mismo mecanismo que ya usa POST /planos al guardar de verdad.
  const fechaPlano = fechaComoISO(plano.fecha);
  const { resueltas } = await calcularResolucionAdelantadas(req, {
    hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero, fecha: fechaPlano, pizarra: pizarraFinal, ret: plano.ret
  });
  if (resueltas.length) {
    await db.transaccion(async (client) => { await guardarResolucionAdelantadas(client, req, resueltas, pizarraFinal); });
  }

  await registrarAlerta(req, {
    tipo: 'PIZARRA_EDITADA', hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero, fecha: fechaPlano,
    mensaje: `Se corrigió la pizarra del plano de ${plano.hipodromo_nombre}, carrera ${plano.carrera_numero} (${pizarraFinal}) y se recalcularon sus tickets.`
  });

  const rTicketsFinales = await db.query('SELECT * FROM hipismo_tickets WHERE plano_id = $1 ORDER BY creado_en', [plano.id]);
  res.json({
    plano: { ...plano, pizarra: pizarraFinal, comision_total: comisionTotal, texto_resultado: textoResultadoFinal },
    tickets: rTicketsFinales.rows,
    totalesFinales
  });
}));

// DELETE /pizarras/tercios/:id : NO borra el plano — lo deja "pendiente
// de pizarra" (ver punto 3 de la nota grande de arriba). Todos sus
// tickets vuelven a resultado_jugador=0/resultado_banquero=0 (el mismo
// "sin decidir" que ya reconocen Balance General/Cierre Final/Pozo/
// Comisiones Devueltas/Montos Apostados), la pizarra queda NULL y el
// texto se reemplaza por un aviso de pendiente.
router.delete('/pizarras/tercios/:id', asyncHandler(async (req, res) => {
  const rPlano = await db.query('SELECT * FROM hipismo_planos WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const plano = rPlano.rows[0];
  if (!plano) return res.status(404).json({ error: 'Plano no encontrado.' });

  const textoPendiente = textoPizarraPendiente({ hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero });

  await db.transaccion(async (client) => {
    await client.query('UPDATE hipismo_tickets SET resultado_jugador = 0, resultado_banquero = 0 WHERE plano_id = $1', [plano.id]);
    await client.query(
      'UPDATE hipismo_planos SET pizarra = NULL, comision_total = 0, texto_resultado = $1 WHERE id = $2',
      [textoPendiente, plano.id]
    );
  });

  await registrarAlerta(req, {
    tipo: 'PIZARRA_ELIMINADA', hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero,
    fecha: fechaComoISO(plano.fecha),
    mensaje: `Se eliminó la pizarra del plano de ${plano.hipodromo_nombre}, carrera ${plano.carrera_numero} — queda pendiente de llegada.`
  });

  res.json({ ok: true, pendiente: true });
}));

// PUT /pizarras/remate/:id { pizarra } : corrige la llegada de un remate
// ya guardado y recalcula TODAS sus apuestas con la llegada nueva —
// mismo motor que usa POST /remates al guardar.
router.put('/pizarras/remate/:id', asyncHandler(async (req, res) => {
  const { pizarra } = req.body;
  if (!pizarra || !pizarra.trim()) return res.status(400).json({ error: 'Falta la Pizarra (orden de llegada).' });

  const rRemate = await db.query('SELECT * FROM hipismo_remates WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const remate = rRemate.rows[0];
  if (!remate) return res.status(404).json({ error: 'Remate no encontrado.' });
  // 04-10-2026, ver la nota grande de POST /remates/manual: un Remate
  // Manual no tiene pool/comisión que recalcular con este motor.
  if (remate.modo === 'manual') {
    return res.status(400).json({ error: 'Este remate se cargó en modo manual (monto neto directo) — no tiene pizarra ni pool que editar acá. Si te equivocaste, bórralo desde "Cargar Remate Manual" y cárgalo de nuevo.' });
  }

  const pizarraFinal = pizarra.trim();
  const numeroGanador = primerNumeroPizarra(pizarraFinal);
  if (numeroGanador === null) return res.status(400).json({ error: 'No reconocí ningún número en esa pizarra.' });

  const rApuestas = await db.query('SELECT * FROM hipismo_remate_apuestas WHERE remate_id = $1 ORDER BY creado_en', [remate.id]);
  const apuestas = rApuestas.rows.map(a => ({ numeroEjemplar: a.numero_ejemplar, caballo: a.caballo, cliente: a.cliente_nombre, monto: Number(a.monto) }));

  const resultado = calcularRemate({
    apuestas, garantia: remate.garantia != null ? Number(remate.garantia) : null,
    pagoFijo: remate.pago_fijo != null ? Number(remate.pago_fijo) : null,
    comisionPorcentaje: Number(remate.comision_porcentaje), numeroGanador
  });
  const textoResultado = armarTextoResultadoRemate({
    nombreGrupo: req.grupo.nombre, hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero,
    pizarra: pizarraFinal, apuestas, garantia: remate.garantia != null ? Number(remate.garantia) : null,
    pagoFijo: remate.pago_fijo != null ? Number(remate.pago_fijo) : null, numeroGanador, resultado
  });

  await db.transaccion(async (client) => {
    for (const a of rApuestas.rows) {
      const esGanadora = resultado.hayGanador && a.numero_ejemplar === numeroGanador;
      const lineaResultado = esGanadora ? (resultado.pagoGanador - Number(a.monto)) : -Number(a.monto);
      await client.query('UPDATE hipismo_remate_apuestas SET resultado = $1 WHERE id = $2', [lineaResultado, a.id]);
    }
    await client.query(
      `UPDATE hipismo_remates
          SET pizarra = $1, numero_ganador = $2, hubo_ganador = $3, caballo_ganador = $4, cliente_ganador = $5,
              pago_ganador = $6, comision_total = $7, texto_resultado = $8
        WHERE id = $9`,
      [
        pizarraFinal, numeroGanador, resultado.hayGanador,
        resultado.apuestaGanadora ? resultado.apuestaGanadora.caballo : null,
        resultado.apuestaGanadora ? resultado.apuestaGanadora.cliente : null,
        resultado.pagoGanador, resultado.resultadoRemate, textoResultado, remate.id
      ]
    );
  });

  await registrarAlerta(req, {
    tipo: 'PIZARRA_EDITADA', hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero,
    fecha: fechaComoISO(remate.fecha),
    mensaje: `Se corrigió la pizarra del remate de ${remate.hipodromo_nombre}, carrera ${remate.carrera_numero} (${pizarraFinal}) y se recalcularon sus apuestas.`
  });

  const rApuestasFinales = await db.query('SELECT * FROM hipismo_remate_apuestas WHERE remate_id = $1 ORDER BY numero_ejemplar', [remate.id]);
  res.json({
    remate: {
      ...remate, pizarra: pizarraFinal, numero_ganador: numeroGanador, hubo_ganador: resultado.hayGanador,
      pago_ganador: resultado.pagoGanador, comision_total: resultado.resultadoRemate, texto_resultado: textoResultado
    },
    apuestas: rApuestasFinales.rows,
    totalesPorCliente: resultado.totalesPorCliente
  });
}));

// DELETE /pizarras/remate/:id : NO borra el remate — lo deja "pendiente
// de pizarra" (mismo criterio que Tercios arriba). Todas sus apuestas
// vuelven a resultado=0 ("sin decidir"), numero_ganador/pizarra quedan
// NULL y el texto se reemplaza por un aviso de pendiente.
router.delete('/pizarras/remate/:id', asyncHandler(async (req, res) => {
  const rRemate = await db.query('SELECT * FROM hipismo_remates WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const remate = rRemate.rows[0];
  if (!remate) return res.status(404).json({ error: 'Remate no encontrado.' });
  // 04-10-2026, ver la nota grande de POST /remates/manual: un Remate
  // Manual no tiene pizarra que vaciar — use DELETE /remates/manual/:id.
  if (remate.modo === 'manual') {
    return res.status(400).json({ error: 'Este remate se cargó en modo manual (monto neto directo) — no tiene pizarra que eliminar acá. Si te equivocaste, bórralo desde "Cargar Remate Manual".' });
  }

  const textoPendiente = textoPizarraPendiente({ hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero });

  await db.transaccion(async (client) => {
    await client.query('UPDATE hipismo_remate_apuestas SET resultado = 0 WHERE remate_id = $1', [remate.id]);
    await client.query(
      `UPDATE hipismo_remates
          SET pizarra = NULL, numero_ganador = NULL, hubo_ganador = false, caballo_ganador = NULL, cliente_ganador = NULL,
              pago_ganador = 0, comision_total = 0, texto_resultado = $1
        WHERE id = $2`,
      [textoPendiente, remate.id]
    );
  });

  await registrarAlerta(req, {
    tipo: 'PIZARRA_ELIMINADA', hipodromoNombre: remate.hipodromo_nombre, carreraNumero: remate.carrera_numero,
    fecha: fechaComoISO(remate.fecha),
    mensaje: `Se eliminó la pizarra del remate de ${remate.hipodromo_nombre}, carrera ${remate.carrera_numero} — queda pendiente de llegada.`
  });

  res.json({ ok: true, pendiente: true });
}));

// PUT /pizarras/adelantadas { fecha, hipodromoNombre, carreraNumero,
// pizarra } : corrige la pizarra de TODAS las Jugadas Adelantadas de esa
// carrera puntual (01-10-2026, punto 5 de la nota grande de arriba) — a
// diferencia de Tercios/Remate, acá no hay un solo :id (cada jugada es
// su propia fila), así que la carrera se identifica por
// fecha+hipódromo+carrera, igual que buscarAdelantadasPendientes.
// soloPendientes=false: re-resuelve TODAS sin importar su estado actual
// (incluye las que ya estaban 'resuelto'/'falta_banqueo'/'sin_decidir'
// con la pizarra VIEJA). Una Marca que sigue decidida conserva sus
// banqueadores (manuales o los automáticos del grupo) con los
// montos recalculados; si deja de estar decidida, pierde el banqueo viejo.
router.put('/pizarras/adelantadas', asyncHandler(async (req, res) => {
  const { fecha, hipodromoNombre, carreraNumero, pizarra, ret } = req.body;
  if (!fecha || !hipodromoNombre || !carreraNumero) return res.status(400).json({ error: 'Falta fecha, hipódromo o número de carrera.' });
  if (!pizarra || !pizarra.trim()) return res.status(400).json({ error: 'Falta la Pizarra (orden de llegada).' });
  const pizarraFinal = pizarra.trim();

  const { resueltas } = await calcularResolucionAdelantadas(
    req, { hipodromoNombre, carreraNumero: Number(carreraNumero), fecha, pizarra: pizarraFinal, ret }, false
  );
  if (!resueltas.length) return res.status(404).json({ error: 'No hay Jugadas Adelantadas cargadas para esa carrera.' });

  await db.transaccion(async (client) => { await guardarResolucionAdelantadas(client, req, resueltas, pizarraFinal); });

  await registrarAlerta(req, {
    tipo: 'PIZARRA_EDITADA', hipodromoNombre, carreraNumero: Number(carreraNumero), fecha,
    mensaje: `Se corrigió la pizarra de las Jugadas Adelantadas de ${hipodromoNombre}, carrera ${carreraNumero} (${pizarraFinal}) y se recalcularon.`
  });

  res.json({ ok: true, pizarra: pizarraFinal, cantidad: resueltas.length });
}));

// DELETE /pizarras/adelantadas?fecha=&hipodromoNombre=&carreraNumero= :
// NO borra las jugadas (eso lo sigue haciendo "Jugadas Adelantadas" de
// siempre) — las deja "pendiente de pizarra" otra vez, mismo criterio
// que DELETE /pizarras/tercios|remate/:id.
router.delete('/pizarras/adelantadas', asyncHandler(async (req, res) => {
  const { fecha, hipodromoNombre, carreraNumero } = req.query;
  if (!fecha || !hipodromoNombre || !carreraNumero) return res.status(400).json({ error: 'Falta fecha, hipódromo o número de carrera.' });

  const todasLasJugadas = await buscarAdelantadasPendientes(req, { hipodromoNombre, carreraNumero: Number(carreraNumero), fecha }, false);
  if (!todasLasJugadas.length) return res.status(404).json({ error: 'No hay Jugadas Adelantadas cargadas para esa carrera.' });
  // Las de montos exactos a mano (07-10-2026) no dependen de la pizarra: se quedan como están.
  const jugadas = todasLasJugadas.filter(j => !j.montos_manuales);

  await db.transaccion(async (client) => {
    for (const j of jugadas) {
      await client.query(
        `UPDATE hipismo_adelantadas_jugadas
            SET estado = 'pendiente', gano = NULL, resultado_cliente = NULL, comision = NULL,
                banqueadores = NULL, pizarra_usada = NULL, resuelto_en = NULL
          WHERE id = $1 AND grupo_id = $2`,
        [j.id, req.grupoId]
      );
    }
  });

  await registrarAlerta(req, {
    tipo: 'PIZARRA_ELIMINADA', hipodromoNombre, carreraNumero: Number(carreraNumero), fecha,
    mensaje: `Se eliminó la pizarra de las Jugadas Adelantadas de ${hipodromoNombre}, carrera ${carreraNumero} — quedan pendientes de llegada.`
  });

  res.json({ ok: true, pendiente: true });
}));

// =================================================================
// "CARGAR WINNERS" (26-09-2026, confirmando el formato que quedó
// pendiente desde que se creó la pestaña: "en cargar winners se
// selecciona el cliente... con el hipodromo y la carrera, el numero del
// caballo... y al lado una columna que diga monto... alli se coloca
// monto negativo o positivo en caso de que gane o pierda... al pulsar
// cargar winners alli si se le agrega a cada cliente en su ficha, es
// como si fuera una jugada mas, se le suma o se le resta segun sea el
// caso eso mueve su balance y su pozo ya que es una jugada").
//
// A diferencia de Tercios/Remate/Adelantadas, acá NO se calcula nada del
// lado del servidor: el operador ya trae el resultado NETO de cada
// cliente (monto con signo) — "Calcular" en el frontend es 100% vista
// previa en el navegador (solo agrupa lo que el operador ya escribió),
// y esta ruta guarda tal cual una fila por cliente/caballo. Por eso no
// hay % de comisión ni "pool total": no aplica, no existe un monto
// apostado aparte del resultado en sí.
//
// A PROPÓSITO no toca "Montos Apostados"/"Comisiones Devueltas"/"Saldo
// Comisiones" (necesitan un monto APOSTADO, que Winners no tiene) — pero
// SÍ entra en GET /cierre-final, GET /semana-por-dias, el pozo del
// cliente (services/hipismoPozo.js) y su detalle de jugadas propio
// (services/hipismoLineasCliente.js), tal como pidió el usuario.
router.post('/winners', asyncHandler(async (req, res) => {
  const { hipodromoId, hipodromoNombre, carreraNumero, fecha, lineas } = req.body;
  if (!carreraNumero) return res.status(400).json({ error: 'Falta el número de carrera.' });
  if (!Array.isArray(lineas) || !lineas.length) {
    return res.status(400).json({ error: 'Agrega al menos un cliente con su caballo y su monto.' });
  }

  let nombreHipodromoFinal = hipodromoNombre;
  if (hipodromoId) {
    const rh = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2', [hipodromoId, req.grupoId]);
    if (rh.rows.length === 0) return res.status(400).json({ error: 'Hipódromo no encontrado.' });
    nombreHipodromoFinal = rh.rows[0].nombre;
  }
  if (!nombreHipodromoFinal) return res.status(400).json({ error: 'Falta el hipódromo.' });

  const lineasValidas = [];
  for (const l of (lineas || [])) {
    const cliente = ((l && l.cliente) || '').toString().trim();
    const caballo = (l && l.caballo !== undefined && l.caballo !== null) ? String(l.caballo).trim() : '';
    const monto = Number(l && l.monto);
    if (!cliente || !caballo || !isFinite(monto) || monto === 0) continue;
    lineasValidas.push({ cliente, caballo, monto });
  }
  if (!lineasValidas.length) {
    return res.status(400).json({ error: 'Ninguna línea tiene cliente, caballo y monto válidos (el monto no puede quedar en 0).' });
  }

  const fechaFinal = fecha || fechaHoyVenezuela();

  // Da de alta en "jugadores" a cualquier cliente que, por algún motivo,
  // no exista todavía (misma tabla compartida, mismo criterio que el
  // resto de Hipismo) — normalmente no hace falta porque el cliente se
  // ELIGE de un <select> con los clientes reales, pero es la misma red
  // de seguridad que ya usan Cargar Planos/Remate/Adelantadas.
  const nombresDelWinner = new Set(lineasValidas.map(l => l.cliente));
  if (await rechazarClientesInexistentes(req, res, Array.from(nombresDelWinner))) return;

  const filasGuardadas = await db.transaccion(async (client) => {
    const filas = [];
    for (const l of lineasValidas) {
      const r = await client.query(
        `INSERT INTO hipismo_winners (grupo_id, hipodromo_id, hipodromo_nombre, carrera_numero, fecha, cliente_nombre, caballo, monto)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.grupoId, hipodromoId || null, nombreHipodromoFinal, carreraNumero, fechaFinal, l.cliente, l.caballo, l.monto]
      );
      filas.push(r.rows[0]);
    }
    return filas;
  });

  // Totales por cliente (un cliente puede tener más de una línea en la
  // misma carga — ganó con un caballo, perdió con otro).
  const totalesPorCliente = {};
  lineasValidas.forEach(l => { totalesPorCliente[l.cliente] = round2((totalesPorCliente[l.cliente] || 0) + l.monto); });

  const encabezado = `*🏆 WINNERS ${(req.grupo.nombre || '').toUpperCase()}*\n${nombreHipodromoFinal}, ${carreraNumero}ta Carrera — ${fechaFinal}`;
  const lineasTexto = lineasValidas.map(l =>
    `🐎 ${l.caballo} — *${formatNombre(l.cliente)}*: ${l.monto >= 0 ? '+' : '-'}${formatMontoTabla(l.monto)}`
  );
  const lineasTotales = Object.keys(totalesPorCliente).sort((a, b) => a.localeCompare(b, 'es')).map(nombre =>
    `${formatNombre(nombre)} ${totalesPorCliente[nombre] >= 0 ? '+' : '-'}${formatMontoTabla(totalesPorCliente[nombre])}`
  );
  const textoResultado = [encabezado, '', ...lineasTexto, '', 'TOTALES:', ...lineasTotales].join('\n');

  res.status(201).json({ lineas: filasGuardadas, totalesPorCliente, textoResultado });
}));

// =================================================================
// "ELIMINAR WINNERS" (28-09-2026, a pedido del usuario: "crea un boton
// debajo de cargar winners... que se llame eliminar winners... alli
// podre ver editar y eliminar todas las jugadas de winners, ordenadas
// por fecha, por hipodromo, por carrera") — mismo patrón EXACTO de
// drill-down que ya usa "Eliminar Planos" (GET /planos/dias, después
// GET /planos?fecha=), pero SIN papelera recuperable: a diferencia de un
// plano (que es una cabecera con sus tickets), cada fila de
// hipismo_winners YA es la unidad más chica que existe — no hay un
// "plano de Winners" aparte que agrupe varias líneas, así que agrupar
// por (fecha, hipódromo, carrera) alcanza para reconstruir "las líneas
// que se cargaron juntas" sin necesitar una tabla cabecera nueva.
//
// GET /winners/dias va ANTES que cualquier otra ruta /winners/:algo para
// que Express no intente matchear "dias" como si fuera un :id (mismo
// criterio ya usado para /planos/dias).
router.get('/winners/dias', asyncHandler(async (req, res) => {
  const r = await db.query(
    `SELECT fecha, COUNT(*)::int AS cantidad
       FROM hipismo_winners
      WHERE grupo_id = $1
      GROUP BY fecha
      ORDER BY fecha DESC
      LIMIT 120`,
    [req.grupoId]
  );
  res.json(r.rows.map(row => ({
    fecha: row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha,
    cantidad: row.cantidad
  })));
}));

// GET /winners?fecha= : todas las líneas cargadas ese día, ordenadas por
// hipódromo y carrera (el frontend las agrupa así para "Eliminar
// Winners") — sin "fecha" devuelve las últimas 200 sin filtrar, mismo
// respaldo que ya usa GET /remates.
router.get('/winners', asyncHandler(async (req, res) => {
  const { fecha } = req.query;
  const params = [req.grupoId];
  let condicionFecha = '';
  if (fecha) { params.push(fecha); condicionFecha = `AND fecha = $${params.length}`; }
  const r = await db.query(
    `SELECT * FROM hipismo_winners WHERE grupo_id = $1 ${condicionFecha}
      ORDER BY fecha DESC, hipodromo_nombre ASC, carrera_numero ASC, creado_en ASC
      LIMIT 200`,
    params
  );
  res.json(r.rows);
}));

// PUT /winners/:id : edita UNA línea puntual (cliente, caballo y/o
// monto) — mismo alcance de edición que ya tiene PUT
// /adelantadas/jugadas/:id (nunca mueve la línea de fecha/hipódromo/
// carrera, eso sería borrarla y cargarla de nuevo en el sitio correcto).
router.put('/winners/:id', asyncHandler(async (req, res) => {
  const rWinner = await db.query('SELECT * FROM hipismo_winners WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const winner = rWinner.rows[0];
  if (!winner) return res.status(404).json({ error: 'Winner no encontrado.' });

  const { cliente, caballo, monto } = req.body;
  // 29-09-2026 — antes no se forzaba MAYÚSCULA acá (a diferencia de TODO
  // el resto del sistema para nombres de cliente), así que renombrar un
  // Winner a mano podía dejarlo en minúscula o con un espacio de más,
  // sin calzar nunca con jugadores.nombre — mismo criterio que
  // jugadores.js/hipismoCalc.js ahora en todos lados (ver la nota grande
  // de normalizarNombreJugador() en routes/jugadores.js).
  const clienteFinal = ((cliente !== undefined && cliente !== null && cliente !== '') ? String(cliente) : winner.cliente_nombre).trim().toUpperCase().replace(/\s+/g, ' ');
  const caballoFinal = ((caballo !== undefined && caballo !== null && caballo !== '') ? String(caballo) : winner.caballo).trim();
  const montoFinal = (monto !== undefined && monto !== null && monto !== '') ? Number(monto) : Number(winner.monto);
  if (!clienteFinal) return res.status(400).json({ error: 'Falta el cliente.' });
  if (!caballoFinal) return res.status(400).json({ error: 'Falta el caballo.' });
  if (!isFinite(montoFinal) || montoFinal === 0) return res.status(400).json({ error: 'El monto no puede quedar en 0.' });

  if (clienteFinal !== winner.cliente_nombre) if (await rechazarClientesInexistentes(req, res, [clienteFinal])) return;

  const r = await db.query(
    `UPDATE hipismo_winners SET cliente_nombre = $1, caballo = $2, monto = $3
      WHERE id = $4 AND grupo_id = $5 RETURNING *`,
    [clienteFinal, caballoFinal, montoFinal, winner.id, req.grupoId]
  );

  const fechaTexto = winner.fecha instanceof Date ? winner.fecha.toISOString().slice(0, 10) : winner.fecha;
  await registrarAlerta(req, {
    tipo: 'WINNER_EDITADO', hipodromoNombre: winner.hipodromo_nombre, carreraNumero: winner.carrera_numero, fecha: fechaTexto,
    mensaje: `Se editó el Winner de ${clienteFinal} (carrera ${winner.carrera_numero}, ${winner.hipodromo_nombre}, ${fechaTexto}).`
  });

  res.json(r.rows[0]);
}));

// DELETE /winners/:id : elimina UNA línea puntual — sin papelera (a
// diferencia de "Eliminar Planos"), mismo criterio que DELETE
// /adelantadas/jugadas/:id.
router.delete('/winners/:id', asyncHandler(async (req, res) => {
  const rWinner = await db.query('SELECT * FROM hipismo_winners WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const winner = rWinner.rows[0];
  if (!winner) return res.status(404).json({ error: 'Winner no encontrado.' });

  await db.query('DELETE FROM hipismo_winners WHERE id = $1 AND grupo_id = $2', [winner.id, req.grupoId]);

  const fechaTexto = winner.fecha instanceof Date ? winner.fecha.toISOString().slice(0, 10) : winner.fecha;
  await registrarAlerta(req, {
    tipo: 'WINNER_ELIMINADO', hipodromoNombre: winner.hipodromo_nombre, carreraNumero: winner.carrera_numero, fecha: fechaTexto,
    mensaje: `Se eliminó el Winner de ${winner.cliente_nombre} (carrera ${winner.carrera_numero}, ${winner.hipodromo_nombre}, ${fechaTexto}).`
  });

  res.json({ ok: true });
}));

// GET /balance-general?fecha= : el "último plano" del día, mismo criterio
// que hoy usa el mockup (el resultado de lo último que se calculó) pero
// leído de la base — spec sección 12. Cierre Final (agregado semanal
// real) sigue pendiente, ver nota grande arriba del archivo.
// =================================================================
// REVISAR JUGADAS (05-10-2026, a pedido del usuario: "en administración
// necesito una pestaña que se llame revisar jugadas... al seleccionar el
// día, el hipódromo y la carrera me despliegue todo absolutamente todo lo
// que tiene esa carrera, tanto jugadas adelantadas, tablas, remate, todo,
// no puedes dejar nada afuera ni winners... allí podré editar, eliminar
// jugadas"). GET /revisar-jugadas?fecha=&hipodromoId=|hipodromo=&carrera=
// junta en UNA respuesta todo lo que guarda cada tabla para esa carrera:
// planos (Tercios) con sus tickets, Jugadas Adelantadas (Tablas Fijas y
// Marcas), Jugadas entre Tercios Adelantadas, Remates (de pool y
// Manuales) con sus apuestas, y Winners. Editar/eliminar se hace con las
// rutas que ya existían para cada tipo (PUT/DELETE de cada uno) más las
// nuevas de ticket suelto y apuesta de remate de arriba — esta ruta solo
// LEE. Las jugadas de Tercios Adelantadas que quedaron SIN número de
// carrera (el plano no lo traía) se devuelven aparte (terciosSinCarrera)
// para ese mismo día/hipódromo, así "nada queda afuera".
// =================================================================
router.get('/revisar-jugadas', asyncHandler(async (req, res) => {
  const { fecha, hipodromoId, hipodromo, carrera } = req.query;
  if (!fecha) return res.status(400).json({ error: 'Falta el día.' });
  const carreraNumero = parseInt(carrera, 10);
  if (!isFinite(carreraNumero) || carreraNumero <= 0) return res.status(400).json({ error: 'Falta la carrera.' });

  let nombreHipodromo = hipodromo;
  if (hipodromoId) {
    const rh = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2', [hipodromoId, req.grupoId]);
    if (rh.rows.length === 0) return res.status(400).json({ error: 'Hipódromo no encontrado.' });
    nombreHipodromo = rh.rows[0].nombre;
  }
  if (!nombreHipodromo) return res.status(400).json({ error: 'Falta el hipódromo.' });

  // Se compara por NOMBRE (sin importar mayúsculas), no por hipodromo_id:
  // cada fila guarda una copia del nombre justo para sobrevivir a un
  // hipódromo renombrado/borrado (hipodromo_id queda NULL en ese caso).
  const base = [req.grupoId, fecha, nombreHipodromo];
  const conCarrera = [...base, carreraNumero];

  const rPlanos = await db.query(
    `SELECT * FROM hipismo_planos
      WHERE grupo_id = $1 AND fecha = $2 AND lower(hipodromo_nombre) = lower($3) AND carrera_numero = $4
      ORDER BY creado_en`, conCarrera
  );
  const idsPlanos = rPlanos.rows.map(p => p.id);
  const rTickets = idsPlanos.length
    ? await db.query('SELECT * FROM hipismo_tickets WHERE plano_id = ANY($1) ORDER BY creado_en', [idsPlanos])
    : { rows: [] };
  const planos = rPlanos.rows.map(p => ({
    id: p.id,
    hipodromoNombre: p.hipodromo_nombre,
    carreraNumero: p.carrera_numero,
    fecha: fechaComoISO(p.fecha),
    ret: p.ret,
    pizarra: p.pizarra,
    cruzaJugadas: !!p.cruza_jugadas,
    comisionTotal: Number(p.comision_total),
    creadoEn: p.creado_en,
    tickets: rTickets.rows.filter(t => t.plano_id === p.id).map(t => ({
      id: t.id,
      cliente: t.cliente_nombre,
      banquero: t.banquero_nombre,
      modalidad: t.modalidad,
      caballo: t.caballo,
      monto: Number(t.monto),
      resultadoJugador: Number(t.resultado_jugador),
      resultadoBanquero: Number(t.resultado_banquero),
      sinComision: !!t.sin_comision
    }))
  }));

  const rAdelantadas = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha = $2 AND lower(p.hipodromo_nombre) = lower($3) AND j.carrera_numero = $4
      ORDER BY j.creado_en`, conCarrera
  );

  const rTercios = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_tercios_adelantadas_jugadas j
       JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha = $2 AND lower(p.hipodromo_nombre) = lower($3) AND j.carrera_numero = $4
      ORDER BY j.creado_en`, conCarrera
  );
  const rTerciosSinCarrera = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_tercios_adelantadas_jugadas j
       JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha = $2 AND lower(p.hipodromo_nombre) = lower($3) AND j.carrera_numero IS NULL
      ORDER BY j.creado_en`, base
  );

  const rRemates = await db.query(
    `SELECT * FROM hipismo_remates
      WHERE grupo_id = $1 AND fecha = $2 AND lower(hipodromo_nombre) = lower($3) AND carrera_numero = $4
      ORDER BY creado_en`, conCarrera
  );
  const idsRemates = rRemates.rows.map(r => r.id);
  const rApuestas = idsRemates.length
    ? await db.query('SELECT * FROM hipismo_remate_apuestas WHERE remate_id = ANY($1) ORDER BY numero_ejemplar, creado_en', [idsRemates])
    : { rows: [] };
  const remates = rRemates.rows.map(r => ({
    id: r.id,
    modo: r.modo || 'pool',
    fecha: fechaComoISO(r.fecha),
    pizarra: r.pizarra,
    numeroGanador: r.numero_ganador,
    huboGanador: !!r.hubo_ganador,
    comisionPorcentaje: Number(r.comision_porcentaje),
    garantia: r.garantia != null ? Number(r.garantia) : null,
    pagoFijo: r.pago_fijo != null ? Number(r.pago_fijo) : null,
    poolTotal: Number(r.pool_total),
    pagoGanador: Number(r.pago_ganador),
    resultadoRemate: Number(r.comision_total),
    creadoEn: r.creado_en,
    apuestas: rApuestas.rows.filter(a => a.remate_id === r.id).map(a => ({
      id: a.id,
      numeroEjemplar: a.numero_ejemplar,
      caballo: a.caballo,
      cliente: a.cliente_nombre,
      monto: Number(a.monto),
      resultado: Number(a.resultado)
    }))
  }));

  const rWinners = await db.query(
    `SELECT * FROM hipismo_winners
      WHERE grupo_id = $1 AND fecha = $2 AND lower(hipodromo_nombre) = lower($3) AND carrera_numero = $4
      ORDER BY creado_en`, conCarrera
  );
  const winners = rWinners.rows.map(w => ({
    id: w.id, cliente: w.cliente_nombre, caballo: w.caballo, monto: Number(w.monto), creadoEn: w.creado_en
  }));

  res.json({
    fecha, hipodromo: nombreHipodromo, carrera: carreraNumero,
    planos,
    adelantadas: rAdelantadas.rows.map(filaJugadaAdelantadaPublica),
    tercios: rTercios.rows.map(filaJugadaTerciosAdelantadaPublica),
    terciosSinCarrera: rTerciosSinCarrera.rows.map(filaJugadaTerciosAdelantadaPublica),
    remates,
    winners
  });
}));

router.get('/balance-general', asyncHandler(async (req, res) => {
  const { fecha } = req.query;
  const params = [req.grupoId];
  let condicionFecha = '';
  if (fecha) { params.push(fecha); condicionFecha = `AND fecha = $${params.length}`; }
  const r = await db.query(
    `SELECT * FROM hipismo_planos WHERE grupo_id = $1 ${condicionFecha} ORDER BY creado_en DESC LIMIT 1`,
    params
  );
  if (r.rows.length === 0) return res.json({ plano: null });
  res.json({ plano: r.rows[0] });
}));

// =================================================================
// COMISIONES POR CARRERA (23-09-2026, a pedido del usuario: "en
// comisiones por carrera uneme todo un dia y al darle click veo por
// hipodromo al darle clikc en dicho hipodromo veo por carrera de ese
// hipodromo") — antes era una lista plana de carreras con datos de
// ejemplo (ver public/hipismo-mockup.html); ahora agrupa DÍA >
// HIPÓDROMO > CARRERA con datos reales de hipismo_planos/hipismo_tickets,
// el mismo drill-down de 3 niveles que pidió el usuario. El detalle
// jugada-por-jugada de cada carrera (para el 4to nivel, "click en la
// carrera") sigue viniendo adentro de cada carrera.
//
// GET /comisiones-por-carrera?semana=actual|anterior|hace2 — mismo
// patrón de 3 semanas que ya tenía el selector de "Cierre Final" en el
// mockup (semana actual, anterior, hace 2 semanas), semana FIJA lunes a
// domingo en hora de Venezuela (mismo cálculo que
// routes/hipismoCliente.js).
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDeFechaUTC(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function hoyVenezuela() { return new Date(Date.now() - 4 * 60 * 60 * 1000); }
// rangoSemana() (lunes a domingo fijo) se reemplazó el 05-10-2026 por
// rangoSemanaGrupo() de services/hipismoSemana.js, que respeta la
// configuración de "Fecha de Semana" de cada grupo (por defecto sigue siendo
// lunes a domingo, igual que antes).

// Rango de fechas a mano (28-09-2026, a pedido del usuario: "en balance
// general... agrega un panel donde pueda elegir el rango de fechas que
// quiero que me muestres... igual en cierre final") — ?desde=&hasta=
// como alternativa a ?semana=actual|anterior|hace2. Si vienen los 2
// parámetros con formato de fecha válido, GANAN sobre "semana" (ver
// /cierre-final más abajo); si vienen invertidos (desde > hasta) se
// ordenan solos en vez de rechazar la consulta.
function rangoPersonalizadoDeQuery(req) {
  const { desde, hasta } = req.query;
  if (!desde || !hasta) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return null;
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

// La comisión de UNA línea (ticket) es la diferencia entre el bruto (sin
// comisión) y lo que efectivamente cobró el lado que ganó esa línea —
// mismo criterio que montoMostrado()/resultadoJugador-Banquero en
// services/hipismoCalc.js: solo el lado GANADOR de cada línea paga 5%,
// el que pierde no paga nada. Sumar esto por carrera da lo mismo que
// hipismo_planos.comision_total (ya guardado) — se usa ese total como
// el número "oficial" de cada carrera y esto solo arma el detalle.
// sinComision (24-09-2026): un ticket exento (jugada "a premio" marcada
// sin el 5%, ver hipismoCalc.js) nunca tuvo comisión que reconstruir —
// sin este chequeo, dividir su resultado por 0.95 inventaría una
// comisión que en realidad nunca se cobró, y ese ticket aparecería con
// un detalle de comisión falso en este reporte.
function comisionDeLado(resultadoMostrado, sinComision) {
  const n = Number(resultadoMostrado);
  if (n <= 0 || sinComision) return 0;
  const bruto = n / 0.95;
  return bruto - n;
}

// (30-09-2026, a pedido del usuario: separador de mil + 2 decimales en
// todos los saldos/reportes de la página) — este texto se muestra en el
// detalle de comisión por carrera, nunca se vuelve a parsear.
function textoJugadaTicket(t) {
  return `${t.modalidad} (${t.caballo}) con ${Number(t.monto).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "FECHA DE SEMANA" ACTIVA (05-10-2026, a pedido del usuario: "activame esta
// pantalla, no funciona") — ver services/hipismoSemana.js.
//   GET /semana-config  configuración guardada + semanas anterior/actual/siguiente
//   PUT /semana-config  { inicio, cierre } (nombre de día o 0-6): guarda la semana
//                       del grupo; Lunes -> Domingo borra la configuración.
router.get('/semana-config', asyncHandler(async (req, res) => {
  res.json(describirConfigSemana(await obtenerConfigSemana(req.grupoId)));
}));

router.put('/semana-config', asyncHandler(async (req, res) => {
  const { inicio, cierre, desde, hasta } = req.body || {};
  // Rango personalizado elegido con el calendario (YYYY-MM-DD).
  if (desde !== undefined || hasta !== undefined) {
    const error = validarRangoPersonalizado(desde, hasta);
    if (error) return res.status(400).json({ error });
    const cfg = await guardarRangoPersonalizado(req.grupoId, desde, hasta);
    return res.json(describirConfigSemana(cfg));
  }
  const i = parsearDia(inicio);
  const c = parsearDia(cierre);
  if (i === null || c === null) {
    return res.status(400).json({ error: 'Elige el día en que empieza y el día en que cierra la semana.' });
  }
  const cfg = await guardarConfigSemana(req.grupoId, i, c);
  res.json(describirConfigSemana(cfg));
}));

// BANQUEO DE MARCAS por grupo (06-10-2026) — quién banquea por defecto las
// Marcas de ESTE grupo (ver services/hipismoMarcasBanqueoAuto.js). La
// plataforma se vende a varios grupos y cada uno banquea distinto, así que
// no hay nombres fijos: cada grupo carga los suyos (hasta 4, % que suman
// 100, y si pagan comisión). Lista vacía = sin banqueo automático (flujo
// manual de siempre).
//   GET /marcas-banqueo-config  -> { banqueadores: [{nombre,porcentaje,pagaComision}], max }
//   PUT /marcas-banqueo-config  { banqueadores: [...] } ([] lo desactiva)
router.get('/marcas-banqueo-config', asyncHandler(async (req, res) => {
  res.json({ banqueadores: (await obtenerBanqueoMarcasGrupo(req.grupoId)) || [], max: 4 });
}));

router.put('/marcas-banqueo-config', asyncHandler(async (req, res) => {
  const { lista, error } = validarBanqueoMarcas((req.body || {}).banqueadores);
  if (error) return res.status(400).json({ error });
  if (lista.length && await rechazarClientesInexistentes(req, res, lista.map(b => b.nombre))) return;
  const guardada = await guardarBanqueoMarcasGrupo(req.grupoId, lista);
  // Las Marcas que ya estaban esperando banqueo se banquean ahora mismo (TODAS de una vez,
  // sin resolverlas una a una). Con rebanquearTodas:true (06-10-2026) también se vuelven a
  // banquear con esta configuración las Marcas que ya tenían otros banqueadores.
  const rebanquearTodas = !!(req.body || {}).rebanquearTodas;
  let marcasBanqueadas = 0;
  let marcasRebanqueadas = 0;
  if (guardada) {
    const r = await asegurarBanqueoAutomaticoMarcas(req.grupoId, { incluirYaBanqueadas: rebanquearTodas });
    if (rebanquearTodas) { marcasBanqueadas = r.pendientes; marcasRebanqueadas = r.rebanqueadas; } else { marcasBanqueadas = r; }
  }
  res.json({ banqueadores: guardada || [], max: 4, marcasBanqueadas, marcasRebanqueadas });
}));

// BANQUEO DE TABLAS FIJAS por grupo (06-10-2026, "HAGAMOS LA MISMA
// CONFIGURACION PARA TABLAS FIJAS, CADA GRUPO ESTABLECE SU CONFIGURACION") —
// mismo formato y mismas validaciones que /marcas-banqueo-config. Lista
// vacía = las TF siguen jugando contra el ítem "TABLAS FIJAS" de siempre. Solo
// aplica a las Tablas Fijas que se resuelvan DE AHORA EN ADELANTE (las ya
// resueltas conservan su contrapartida).
router.get('/tf-banqueo-config', asyncHandler(async (req, res) => {
  res.json({ banqueadores: (await obtenerBanqueoTablasFijasGrupo(req.grupoId)) || [], max: 4 });
}));

router.put('/tf-banqueo-config', asyncHandler(async (req, res) => {
  const { lista, error } = validarBanqueoMarcas((req.body || {}).banqueadores);
  if (error) return res.status(400).json({ error });
  if (lista.length && await rechazarClientesInexistentes(req, res, lista.map(b => b.nombre))) return;
  const guardada = await guardarBanqueoTablasFijasGrupo(req.grupoId, lista);
  res.json({ banqueadores: guardada || [], max: 4 });
}));

// GET /semana-actual?semana=actual|anterior|hace2 (23-09-2026,
// duodécima-tercera ronda, a pedido del usuario: "en balance general al
// ver los saldos... colocame arriba la fecha que este comprendida la
// semana... y semana xxx... que seria la semana del año en la que
// estamos") — "Balance General" (de "Cargar Planos") no agrega nada por
// semana del lado del servidor, así que no tenía de dónde sacar este
// dato; este endpoint chiquito le da el MISMO rango/número de semana que
// ya calculan Comisiones por Carrera y Cierre Final, solo para pintar el
// encabezado.
router.get('/semana-actual', asyncHandler(async (req, res) => {
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const { desde, hasta } = await rangoSemanaGrupo(req.grupoId, hoyVenezuela(), offset);
  res.json({ rango: { desde, hasta }, numeroSemana: numeroSemanaISO(desde) });
}));

router.get('/comisiones-por-carrera', asyncHandler(async (req, res) => {
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const { desde, hasta } = await rangoSemanaGrupo(req.grupoId, hoyVenezuela(), offset);
  const numeroSemana = numeroSemanaISO(desde);

  const rPlanos = await db.query(
    `SELECT id, fecha, hipodromo_nombre, carrera_numero, comision_total
       FROM hipismo_planos
      WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3
      ORDER BY fecha DESC, hipodromo_nombre, carrera_numero`,
    [req.grupoId, desde, hasta]
  );
  if (rPlanos.rows.length === 0) {
    return res.json({ rango: { desde, hasta }, semana, numeroSemana, dias: [], totalGeneral: 0 });
  }

  const rTickets = await db.query(
    `SELECT plano_id, cliente_nombre, banquero_nombre, modalidad, caballo, monto, resultado_jugador, resultado_banquero, sin_comision
       FROM hipismo_tickets WHERE plano_id = ANY($1::uuid[])`,
    [rPlanos.rows.map(p => p.id)]
  );
  const ticketsPorPlano = new Map();
  rTickets.rows.forEach(t => {
    if (!ticketsPorPlano.has(t.plano_id)) ticketsPorPlano.set(t.plano_id, []);
    const detalle = [];
    const comJugador = comisionDeLado(t.resultado_jugador, t.sin_comision);
    const comBanquero = comisionDeLado(t.resultado_banquero, t.sin_comision);
    if (comJugador > 0) detalle.push({ cliente: t.cliente_nombre, jugada: textoJugadaTicket(t), comision: comJugador });
    if (comBanquero > 0) detalle.push({ cliente: t.banquero_nombre, jugada: textoJugadaTicket(t), comision: comBanquero });
    ticketsPorPlano.get(t.plano_id).push(...detalle);
  });

  const porDia = new Map();
  let totalGeneral = 0;
  rPlanos.rows.forEach(p => {
    const fechaIso = p.fecha instanceof Date ? p.fecha.toISOString().slice(0, 10) : p.fecha;
    if (!porDia.has(fechaIso)) porDia.set(fechaIso, { fecha: fechaIso, totalComision: 0, hipodromosMap: new Map() });
    const dia = porDia.get(fechaIso);
    if (!dia.hipodromosMap.has(p.hipodromo_nombre)) {
      dia.hipodromosMap.set(p.hipodromo_nombre, { nombre: p.hipodromo_nombre, totalComision: 0, carreras: [] });
    }
    const hip = dia.hipodromosMap.get(p.hipodromo_nombre);
    const comisionCarrera = Number(p.comision_total);
    hip.carreras.push({
      planoId: p.id,
      carreraNumero: p.carrera_numero,
      totalComision: comisionCarrera,
      detalle: ticketsPorPlano.get(p.id) || []
    });
    hip.totalComision += comisionCarrera;
    dia.totalComision += comisionCarrera;
    totalGeneral += comisionCarrera;
  });

  const dias = Array.from(porDia.values())
    .map(d => ({ fecha: d.fecha, totalComision: d.totalComision, hipodromos: Array.from(d.hipodromosMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  res.json({ rango: { desde, hasta }, semana, numeroSemana, dias, totalGeneral });
}));

// =================================================================
// "GRUPO SIN DEVOLUCIONES" (01-10-2026, a pedido del usuario: "quiero
// ver como quedaria el grupo sin devoluciones.... aqui me mostraras como
// seria la comision y como quedarian los tercios jugando solo con el 5%
// sin devolverle nada a nadie ... si gana gan -5% juegue o banque... si
// pierde pierde completo juegue o banquee.... alli me mostraras la lista
// de todos los clientes y abajo la comsiion como seria").
//
// SIMULACIÓN, no un reporte nuevo de verdad: cada ticket de Tercios YA
// guarda "gana -5%, pierde completo" en resultado_jugador/
// resultado_banquero — el % propio/aval de un cliente NUNCA se mete
// adentro de ese resultado, SIEMPRE fue un ítem aparte, "{cliente} -
// PORCENTAJE" (ver construirCierreFinalHipismo en
// services/hipismoResumenCliente.js y acumularDevuelto ahí mismo). Así
// que "cómo quedaría el grupo sin devolverle nada a nadie" es,
// literalmente, la MISMA suma de resultado_jugador/resultado_banquero de
// siempre, pero SIN llamar a obtenerComisionesPropias/acumularDevuelto
// en absoluto (nunca se agrega esa línea extra) — y la "comisión" que se
// muestra es la BRUTA de cada plano (SUM(comision_total), igual que
// /comisiones-por-carrera arriba), no la "comisión real" (neta) de
// Balance General/Cierre Final.
//
// ALCANCE: SOLO Tercios — mismo universo que "Comisión por Carrera de
// Clientes" (arriba, en esta misma sección de "Comisiones"). El usuario
// pidió explícitamente "los tercios"; Remate/Adelantadas/Winners quedan
// afuera de este comparador a propósito (si hiciera falta compararlos
// también, es una ronda aparte).
//
// Desde/Hasta con default "semana actual" (NO "hoy", a diferencia de
// Montos Apostados/Pizarras/Comisiones Devueltas) — pedido explícito del
// usuario ("estara predeterminado ver semana actual") — reusa
// rangoPersonalizadoDeQuery()/rangoSemana() de /cierre-final: si el
// frontend manda ?desde=&hasta= con fechas válidas, GANAN sobre la
// semana actual (rango personalizado); si no manda nada, cae en
// await rangoSemanaGrupo(req.grupoId, hoyVenezuela(), 0).
//
// GET /comisiones-sin-devoluciones?desde=&hasta=
router.get('/comisiones-sin-devoluciones', asyncHandler(async (req, res) => {
  const rangoPersonalizado = rangoPersonalizadoDeQuery(req);
  const { desde, hasta } = rangoPersonalizado || await rangoSemanaGrupo(req.grupoId, hoyVenezuela(), 0);

  const rPlanos = await db.query(
    `SELECT id, comision_total FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  const comisionGrupo = round2(rPlanos.rows.reduce((s, p) => s + Number(p.comision_total), 0));

  const porCliente = new Map();
  function acumular(nombre, resultado) {
    if (!porCliente.has(nombre)) porCliente.set(nombre, { nombre, jugadas: 0, gano: 0, perdio: 0 });
    const c = porCliente.get(nombre);
    c.jugadas += 1;
    const n = Number(resultado);
    if (n > 0) c.gano = round2(c.gano + n);
    else if (n < 0) c.perdio = round2(c.perdio + (-n));
  }

  if (rPlanos.rows.length) {
    const rTickets = await db.query(
      `SELECT cliente_nombre, banquero_nombre, resultado_jugador, resultado_banquero
         FROM hipismo_tickets WHERE plano_id = ANY($1::uuid[])`,
      [rPlanos.rows.map(p => p.id)]
    );
    rTickets.rows.forEach(t => {
      acumular(t.cliente_nombre, t.resultado_jugador);
      acumular(t.banquero_nombre, t.resultado_banquero);
    });
  }

  const clientes = Array.from(porCliente.values())
    .map(c => ({ ...c, saldo: round2(c.gano - c.perdio) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  res.json({ desde, hasta, rangoPersonalizado: !!rangoPersonalizado, clientes, comisionGrupo });
}));

// =================================================================
// "COMISIONES TOTALES POR HIPÓDROMO" (24-09-2026, a pedido del usuario:
// "crea abajo una nueva que se va a llamar comsiones totales por
// hipodromo : alli saldria el total por carrea por hipodromo del dia
// seleccionado"). A propósito de UN SOLO DÍA (no semana, como sí lo es
// /comisiones-por-carrera de arriba) — el ejemplo que pegó el usuario es
// una lista plana de hipódromos con el total de CADA carrera y un
// subtotal por hipódromo, sin agrupar por día ni por cliente. Como
// hipismo_planos.comision_total YA es la comisión total de esa
// carrera puntual (ver la nota grande de /comisiones-por-carrera más
// arriba), esta ruta no necesita tocar hipismo_tickets en absoluto.
//
// GET /comisiones-por-hipodromo?fecha=YYYY-MM-DD (default: hoy en hora Venezuela).
router.get('/comisiones-por-hipodromo', asyncHandler(async (req, res) => {
  const fecha = req.query.fecha || isoDeFechaUTC(hoyVenezuela());

  const rPlanos = await db.query(
    `SELECT hipodromo_nombre, carrera_numero, comision_total
       FROM hipismo_planos
      WHERE grupo_id = $1 AND fecha = $2
      ORDER BY hipodromo_nombre, carrera_numero`,
    [req.grupoId, fecha]
  );

  const porHipodromo = new Map();
  let totalGeneral = 0;
  rPlanos.rows.forEach(p => {
    if (!porHipodromo.has(p.hipodromo_nombre)) {
      porHipodromo.set(p.hipodromo_nombre, { nombre: p.hipodromo_nombre, totalComision: 0, carreras: [] });
    }
    const hip = porHipodromo.get(p.hipodromo_nombre);
    const comisionCarrera = Number(p.comision_total);
    hip.carreras.push({ carreraNumero: p.carrera_numero, comision: comisionCarrera });
    hip.totalComision = round2(hip.totalComision + comisionCarrera);
    totalGeneral = round2(totalGeneral + comisionCarrera);
  });

  const hipodromos = Array.from(porHipodromo.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  res.json({ fecha, hipodromos, totalGeneral });
}));

// =================================================================
// "MONTOS APOSTADOS" (23-09-2026, undécima ronda, a pedido del usuario:
// "un boton en apuestas llamado montos apostados, alli vere por cliente
// cuanto han apostado en el grupo, igual ordenado por fecha, alli me
// saldra el cliente al lado de su nombre el total en la fecha que
// seleccione y si lo selcciono... se despliega toda su informacion").
//
// Suma, para UNA fecha puntual (no un rango semanal, a propósito — el
// usuario pidió "la fecha que seleccione", singular), lo que cada
// cliente apostó como JUGADOR (nunca lo que banqueó/cubrió — banquear no
// es "apostar") en los 3 tipos de jugada de Hipismo: Tercios (Cargar
// Planos), Remate, y Jugadas Adelantadas (Tablas Fijas y Marcas, tomando
// la fecha en que se CORRE la carrera, igual que el resto del sistema
// las agrupa). Esta misma función se reusa para "Comisiones Devueltas"
// (más abajo), que necesita exactamente la misma base.
//
// `decidida` (29-09-2026, a pedido explícito del usuario: "YA TE DIJE QUE
// JUGADA QUE NO SE DECIDA SEA LO QUE SEA EL TIPO DE JUGADA NI GENERA % NI
// SE LE DEVUELVE % A NADIE... NO PUEDES PAGAR O DELVOLVER % DE UNA JUGADA
// QUE QUEDO NULA... ELLOS GANAN % DE LO QUE GENERE EL GRUPO") -- hasta esta
// ronda esta función NUNCA traía el resultado de la jugada (ni
// resultado_jugador/resultado_banquero de Tercios, ni gano de Adelantadas),
// así que "Comisiones Devueltas por Cliente"/"por Hipódromo" (más abajo)
// pagaban % sobre CUALQUIER monto apostado, decidida o no -- por eso
// Sebastian seguía cobrando % de una Marca "pp" que quedó nula. Mismo
// criterio EXACTO que ya usan /cierre-final, /saldo-comisiones y
// /semana-por-dias (ver esas notas grandes): un ticket de Tercios "no se
// decidió" cuando resultado_jugador Y resultado_banquero quedan en 0 (una
// Marca "pp"/"a premio" sin ningún caballo que figurara, o una familia "Nn"
// empatada); una Marca de Jugadas Adelantadas "no se decidió" cuando
// j.gano queda en null ('sin_decidir') -- Tabla Fija siempre decide
// true/false, así que nunca cae acá. Remate no tiene resultado propio por
// apuesta (ya se excluye aparte en cada reporte porque "LOS REMATES NO LE
// PRODUCEN % DE DEVOLUCION"), así que queda `decidida: true` sin que
// importe. A PROPÓSITO "Montos Apostados" (más abajo) NO filtra por
// `decidida` -- lo apostado es lo apostado, se haya decidido o no la
// jugada; solo los reportes de COMISIÓN/% devuelto deben filtrar por esto.
async function obtenerApuestasDelDia(grupoId, fecha, incluirBanquero = false) {
  return obtenerApuestasDelRango(grupoId, fecha, fecha, incluirBanquero);
}

// Normaliza una fecha de Postgres (tipo `date`, que pg puede devolver como
// objeto Date) al mismo string "YYYY-MM-DD" que ya usa el resto del
// sistema — mismo criterio EXACTO que ya usan /saldo-comisiones y
// /comisiones-por-hipodromo más arriba (`row.fecha instanceof Date ? ... :
// row.fecha`).
function fechaComoISO(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

// leerTerciosAdelantadasResueltas (05-10-2026): UNA sola consulta compartida
// por los reportes de % devuelto y de saldos por día/semana que antes no
// leían hipismo_tercios_adelantadas_jugadas (obtenerApuestasDelRango con
// incluirBanquero, /saldo-comisiones, /semana-por-dias) -- las jugadas ya
// 'resuelto'/'sin_decidir' del rango, con jugador Y banquero explícitos, el
// resultado ya con el % de comisión aplicado y el % configurado en ESA
// jugada (hace falta para deshacerlo y obtener la base decidida, ver
// montoBaseTerciosAdelantadaExacto).
async function leerTerciosAdelantadasResueltas(grupoId, desde, hasta) {
  const r = await db.query(
    `SELECT j.id, j.jugador_nombre, j.banquero_nombre, j.carrera_numero, j.modalidad, j.monto, j.resultado_jugador, j.resultado_banquero, j.comision_grupo, j.comision_porcentaje, p.hipodromo_nombre, p.fecha
       FROM hipismo_tercios_adelantadas_jugadas j JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto', 'sin_decidir')`,
    [grupoId, desde, hasta]
  );
  return r.rows;
}

// obtenerApuestasDelRango (01-10-2026, a pedido del usuario: "LA FECHA QUE
// VAS A MOSTRAR ARRIBA ES EL RANGO QUE YO ESCOJA" — "Comisiones Devueltas
// por Cliente" pasa de UN día puntual a poder elegir un rango, igual que
// Balance General/Cierre Final) — generaliza obtenerApuestasDelDia a un
// rango [desde, hasta] (ambos inclusive). Con `desde === hasta` (el caso
// de SIEMPRE para Montos Apostados, Traspaso de Jugadas y Comisiones
// Devueltas por Hipódromo, que NUNCA pasaron a pedir rango) usa el MISMO
// texto de consulta exacto de siempre (`p.fecha = $2`, sin pedir la
// columna `fecha` de vuelta) para no tocarle el SQL a ningún llamador
// existente ni a sus pruebas; con un rango real (desde !== hasta, nuevo,
// SOLO lo pide GET /comisiones-devueltas más abajo) usa BETWEEN y trae
// también `fecha` por fila, para poder distinguir en qué día puntual cayó
// cada carrera cuando el detalle expandido mezcla varios días.
// `incluirBanquero` (02-10-2026, a pedido del usuario: "los clientes que
// tiene el 1% en su mismo codigo necesito me muestres ese %" — caso real
// de MUJICA, que banqueó/cubrió una jugada de Tercios en Horseshoe
// Indianapolis (verbo "Dio" en Mis Jugadas, ver textoJugadaHipismo) y esa
// carrera NUNCA aparecía en "Comisiones Devueltas por Cliente" ni "por
// Hipódromo" — aunque sí contaba bien en Balance General/Cierre Final Y en
// Saldo Comisiones. BUG REAL encontrado: esta función SOLO armaba una
// entrada por el lado JUGADOR (t.cliente_nombre/resultado_jugador,
// j.cliente_nombre/resultado_cliente) y nunca una para el lado BANQUERO —
// construirResumenClienteHipismo (hipismoResumenCliente.js) y
// GET /saldo-comisiones (más abajo) sí traen `banquero_nombre`/
// `banqueadores` desde el 29-09-2026 ("el lado BANQUERO de Tercios/de una
// Marca también genera % devuelto"), pero esta función — que alimenta
// /comisiones-devueltas y /comisiones-devueltas-por-hipodromo, Y TAMBIÉN
// /montos-apostados y /traspasos/jugadas (que a propósito NO deben
// incluir lo banqueado: ver sus notas grandes, "banquear no es
// 'apostar'", y traspasar reasigna cliente_nombre, nunca banquero_nombre)
// — nunca se había actualizado para traer esa info. Se agrega un
// parámetro opcional (default false, así /montos-apostados y
// /traspasos/jugadas NO cambian en nada) que, en true (solo los 2
// reportes de % devuelto que lo necesitan), agrega una entrada EXTRA por
// cada ticket/banqueador con `rol: 'banquero'`, calculada con el MISMO
// criterio EXACTO que ya usan Saldo Comisiones/Balance General
// (montoDecidido sobre resultado_banquero, o sobre la parte de
// baseJugada que banqueó cada uno).
async function obtenerApuestasDelRango(grupoId, desde, hasta, incluirBanquero = false) {
  const detalle = [];
  const mismoDia = desde === hasta;

  const rTickets = mismoDia
    ? await db.query(
        `SELECT t.id, t.cliente_nombre, t.banquero_nombre, t.modalidad, t.caballo, t.monto, t.resultado_jugador, t.resultado_banquero, t.sin_comision, p.hipodromo_nombre, p.carrera_numero
           FROM hipismo_tickets t JOIN hipismo_planos p ON p.id = t.plano_id
          WHERE t.grupo_id = $1 AND p.fecha = $2`,
        [grupoId, desde]
      )
    : await db.query(
        `SELECT t.id, t.cliente_nombre, t.banquero_nombre, t.modalidad, t.caballo, t.monto, t.resultado_jugador, t.resultado_banquero, t.sin_comision, p.hipodromo_nombre, p.carrera_numero, p.fecha
           FROM hipismo_tickets t JOIN hipismo_planos p ON p.id = t.plano_id
          WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`,
        [grupoId, desde, hasta]
      );
  // `gano` (01-10-2026, a pedido del usuario: "EN MONTOS APOSTADOS MUESTRAME
  // SI JUGO O DIO EL CABALLO" — quiere ver, jugada por jugada, si esa línea
  // GANÓ, PERDIÓ o todavía no se puede saber (SIN DECIDIR), no solo si ya
  // se "decidió" como grupo). Para Tercios se deriva del MISMO par
  // resultado_jugador/resultado_banquero que ya usa `decidida` arriba (ver
  // montoMostrado()/resultadoJugador-Banquero en services/hipismoCalc.js):
  // el jugador (quien apostó, nunca el banquero) ganó esa línea cuando
  // resultado_jugador > 0; perdió cuando es <= 0 pero resultado_banquero >
  // 0 (ganó el otro lado); y null (sin decidir) solo en el mismo caso en
  // que decidida ya daba false (los 2 en 0 — una Marca "pp"/"a premio" sin
  // ningún caballo que figurara, o una familia "Nn" empatada).
  // netoPorCarrera (02-10-2026, "GG juega y banquea y queda en 0 en esa
  // carrera... no tienes que pagarle comision de nada porque quedo en 0
  // ... [si fuera] jugado 30 y banqueado 20, le tienes que sacar la
  // devolucion a los 10 que queda" — ver la nota grande EXACTA de
  // netearJugadorBanqueroTercios en services/hipismoCalc.js): SOLO se
  // calcula cuando `incluirBanquero` (si no, nunca hay lado banquero que
  // netear, y /montos-apostados / /traspasos/jugadas deben seguir
  // devolviendo EXACTO lo mismo de siempre). Un cliente que juega Y
  // banquea en la MISMA carrera (fecha+hipódromo+número) dentro de este
  // rango deja de recibir 2 entradas independientes en `detalle` (una por
  // rol) y pasa a tener UNA sola entrada sintética con `rol:'neto'` más
  // abajo — el resto de los clientes (la gran mayoría, un solo rol por
  // carrera) sigue exactamente igual que siempre.
  const netoPorCarrera = incluirBanquero
    ? netearJugadorBanqueroTercios(rTickets.rows.map(t => ({
        clienteNombre: t.cliente_nombre, banqueroNombre: t.banquero_nombre,
        resultadoJugador: t.resultado_jugador, resultadoBanquero: t.resultado_banquero,
        sinComision: t.sin_comision,
        fecha: mismoDia ? desde : fechaComoISO(t.fecha),
        hipodromoNombre: t.hipodromo_nombre, carreraNumero: t.carrera_numero
      })))
    : null;
  // Entradas sintéticas ya agregadas (clave carrera::nombre) para no
  // duplicar la línea "neto" una vez por cada ticket del cliente dual en
  // esa carrera — se arma una sola, con el PRIMER ticket que la dispara.
  const dualAgregado = new Set();

  rTickets.rows.forEach(t => {
    const rj = Number(t.resultado_jugador), rb = Number(t.resultado_banquero);
    const sinDecidir = rj === 0 && rb === 0;
    const fechaFila = mismoDia ? desde : fechaComoISO(t.fecha);
    const claveCarrera = `${fechaFila}::${t.hipodromo_nombre}::${t.carrera_numero}`;
    const infoJugador = netoPorCarrera && !sinDecidir ? netoPorCarrera.get(claveCarrera)?.get(t.cliente_nombre) : null;
    const infoBanquero = netoPorCarrera && !sinDecidir ? netoPorCarrera.get(claveCarrera)?.get(t.banquero_nombre) : null;

    // Lado JUGADOR — si ESTE cliente es "dual" en esta carrera (también
    // banquea algo acá), no se empuja su entrada de siempre: se reemplaza
    // más abajo por la entrada sintética "neto" (una sola vez).
    if (!(infoJugador && infoJugador.dual)) {
      detalle.push({
        id: t.id, tabla: 'hipismo_tickets', fecha: fechaFila,
        cliente: t.cliente_nombre, hipodromoNombre: t.hipodromo_nombre, carreraNumero: t.carrera_numero,
        tipo: 'tercios', detalleTexto: `${t.modalidad} (${t.caballo})`, monto: Number(t.monto),
        // montoDecidido (02-10-2026, "LOS % QUE SE DEVUELVEN ES DE LO
        // DECIDIDO NO DE LO APOSTADO" — ver la nota grande de montoDecidido()
        // en services/hipismoAdelantadasCalc.js): esta línea SIEMPRE es el
        // lado JUGADOR (ver la nota grande de más arriba, "nunca lo que
        // banqueó/cubrió"), así que su base es resultado_jugador. Se deja
        // aparte de `monto` (que /montos-apostados necesita intacto, en
        // bruto) para que los reportes de % devuelto (más abajo) usen esta
        // en cambio. `montoDecididoExacto` (sin redondear, ver la nota
        // grande EXACTA en hipismoAdelantadasCalc.js) es lo que esos
        // reportes deben usar para el % devuelto — `montoDecidido` (ya
        // redondeado) queda solo para mostrar.
        // 04-10-2026: montoDecididoExacto -> montoBaseComisionExacto en este
        // campo (el que SÍ consumen los reportes de % devuelto, ver
        // devueltoExacto más abajo) -- una jugada "a premio" SIN comisión
        // (t.sin_comision, bandera REAL del ticket) no debe generar %
        // devuelto (pedido explícito del usuario, ver la nota grande de
        // montoBaseComisionExacto en hipismoAdelantadasCalc.js). `montoDecidido`
        // se deja igual, es solo para mostrar "lo decidido" en el detalle.
        montoDecidido: montoDecidido(t.resultado_jugador, t.sin_comision),
        montoDecididoExacto: montoBaseComisionExacto(t.resultado_jugador, t.sin_comision),
        decidida: !sinDecidir,
        gano: sinDecidir ? null : rj > 0,
        rol: 'jugador'
      });
    }
    // Lado BANQUERO (02-10-2026, ver la nota grande de incluirBanquero más
    // arriba) — SOLO cuando el llamador lo pide (/comisiones-devueltas y
    // /comisiones-devueltas-por-hipodromo); /montos-apostados y
    // /traspasos/jugadas nunca pasan `incluirBanquero=true`, así que para
    // ellos esta función sigue devolviendo EXACTAMENTE lo mismo que antes.
    if (incluirBanquero && !(infoBanquero && infoBanquero.dual)) {
      detalle.push({
        id: t.id, tabla: 'hipismo_tickets', fecha: fechaFila,
        cliente: t.banquero_nombre, hipodromoNombre: t.hipodromo_nombre, carreraNumero: t.carrera_numero,
        tipo: 'tercios', detalleTexto: `${t.modalidad} (${t.caballo}) — banqueo`, monto: Number(t.monto),
        // 04-10-2026: misma razón que el lado jugador más arriba.
        montoDecidido: montoDecidido(t.resultado_banquero, t.sin_comision),
        montoDecididoExacto: montoBaseComisionExacto(t.resultado_banquero, t.sin_comision),
        decidida: !sinDecidir,
        gano: sinDecidir ? null : rb > 0,
        rol: 'banquero'
      });
    }
    // Entrada sintética "neto" — una por (carrera, cliente) dual, la
    // primera vez que aparece (venga del lado jugador o del banquero de
    // este ticket). `monto` acá es informativo (suma de lo apostado en
    // bruto de ambos lados, para que la columna "Apostado" del detalle
    // visual no quede vacía) — `montoDecidido` (el que de verdad usan los
    // reportes de % devuelto más abajo) es el NETO.
    [{ nombre: t.cliente_nombre, info: infoJugador }, { nombre: t.banquero_nombre, info: infoBanquero }].forEach(({ nombre, info }) => {
      if (!info || !info.dual) return;
      const claveDual = `${claveCarrera}::${nombre}`;
      if (dualAgregado.has(claveDual)) return;
      dualAgregado.add(claveDual);
      detalle.push({
        id: null, tabla: 'hipismo_tickets', fecha: fechaFila,
        cliente: nombre, hipodromoNombre: t.hipodromo_nombre, carreraNumero: t.carrera_numero,
        tipo: 'tercios', neteado: true,
        decididoJugador: info.decididoJugador, decididoBanquero: info.decididoBanquero,
        detalleTexto: 'Jugó y banqueó en esta carrera (neto)',
        monto: round2(info.decididoJugador + info.decididoBanquero),
        montoDecidido: info.neto,
        montoDecididoExacto: info.netoExacto,
        decidida: true, gano: null, rol: 'neto'
      });
    });
  });

  // r.modo <> 'manual' (04-10-2026, ver la nota grande de POST
  // /remates/manual): un Remate Manual no tiene "monto apostado" real
  // (solo el neto que escribió el operador) ni número ganador -- se
  // excluye de Montos Apostados/Comisiones Devueltas con el MISMO
  // criterio que ya excluye a Winners de este reporte (nunca se unen
  // acá).
  const rRemate = mismoDia
    ? await db.query(
        `SELECT a.id, a.cliente_nombre, a.caballo, a.numero_ejemplar, a.monto, r.hipodromo_nombre, r.carrera_numero, r.numero_ganador, r.hubo_ganador
           FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r.id = a.remate_id
          WHERE a.grupo_id = $1 AND r.fecha = $2 AND r.modo <> 'manual'`,
        [grupoId, desde]
      )
    : await db.query(
        `SELECT a.id, a.cliente_nombre, a.caballo, a.numero_ejemplar, a.monto, r.hipodromo_nombre, r.carrera_numero, r.numero_ganador, r.hubo_ganador, r.fecha
           FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r.id = a.remate_id
          WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3 AND r.modo <> 'manual'`,
        [grupoId, desde, hasta]
      );
  // Remate `gano` (01-10-2026): mismo criterio EXACTO que ya usa POST
  // /remates al calcular cada línea al guardarla (ver "esGanadora" en esa
  // ruta, más arriba) — compara el número de ejemplar jugado contra
  // r.numero_ganador, nunca el texto libre `caballo`. Con
  // hubo_ganador=false ("quedó para la banca") nadie gana nada, así que
  // `gano` da false para todo el mundo sin excepción.
  // Pendiente de pizarra (01-10-2026, módulo "Pizarras"): al eliminar la
  // pizarra de un remate desde esa pantalla, r.numero_ganador queda en
  // NULL (ver DELETE /pizarras/remate/:id) y la carrera vuelve a estar sin
  // decidir, igual que un plano de Tercios sin pizarra — acá SÍ puede
  // haber "sin decidir", a diferencia de lo que decía antes este comentario.
  rRemate.rows.forEach(a => {
    const pendiente = a.numero_ganador === null || a.numero_ganador === undefined;
    detalle.push({
      id: a.id, tabla: 'hipismo_remate_apuestas', fecha: mismoDia ? desde : fechaComoISO(a.fecha),
      cliente: a.cliente_nombre, hipodromoNombre: a.hipodromo_nombre, carreraNumero: a.carrera_numero,
      tipo: 'remate', detalleTexto: `Remate (${a.caballo})`, monto: Number(a.monto),
      decidida: !pendiente,
      gano: pendiente ? null : !!(a.hubo_ganador && Number(a.numero_ejemplar) === Number(a.numero_ganador))
    });
  });

  const rAdelantadas = mismoDia
    ? await db.query(
        `SELECT j.id, j.cliente_nombre, j.tipo, j.monto, j.resultado_cliente, j.numero_ejemplar, j.numero1, j.numero2, j.carrera_numero, j.gano, j.sin_comision, j.banqueadores, p.hipodromo_nombre
           FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
          WHERE j.grupo_id = $1 AND p.fecha = $2`,
        [grupoId, desde]
      )
    : await db.query(
        `SELECT j.id, j.cliente_nombre, j.tipo, j.monto, j.resultado_cliente, j.numero_ejemplar, j.numero1, j.numero2, j.carrera_numero, j.gano, j.sin_comision, j.banqueadores, p.hipodromo_nombre, p.fecha
           FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
          WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`,
        [grupoId, desde, hasta]
      );
  rAdelantadas.rows.forEach(j => {
    detalle.push({
      id: j.id, tabla: 'hipismo_adelantadas_jugadas', fecha: mismoDia ? desde : fechaComoISO(j.fecha),
      cliente: j.cliente_nombre, hipodromoNombre: j.hipodromo_nombre, carreraNumero: j.carrera_numero,
      tipo: j.tipo === 'tf' ? 'tabla_fija' : 'marca',
      detalleTexto: j.tipo === 'tf' ? `Tabla fija (${j.numero_ejemplar})` : `Marca (${j.numero1}x${j.numero2})`,
      monto: Number(j.monto),
      // resultado_cliente ya es un neto DEFINITIVO sin ningún 5% embebido
      // (ver la nota grande de montoDecidido más arriba, junto a Tercios) —
      // montoDecidido con sinComision=true lo deja en valor absoluto.
      montoDecidido: montoDecidido(j.resultado_cliente, true),
      montoDecididoExacto: montoDecididoExacto(j.resultado_cliente, true),
      decidida: j.gano !== null && !j.sin_comision, // sin comisión (07-10-2026): no genera % devuelto
      // j.gano ya viene en el formato exacto que necesita el front (01-10-2026,
      // "si jugo o dio el caballo"): true/false ya decidido, null = SIN DECIDIR
      // (Marca todavía sin pizarra — Tabla Fija siempre decide true/false, ver
      // la nota grande de obtenerApuestasDelDia más arriba).
      gano: j.gano,
      rol: 'jugador'
    });
    // Lado BANQUERO de una Marca (02-10-2026, ver la nota grande de
    // incluirBanquero más arriba) — cada banqueador solo banqueó su
    // `porcentaje` de la base DECIDIDA de la jugada completa
    // (|resultado_cliente|, el mismo "base" que ya usa
    // resolverBanqueoMarca para repartir entre banqueadores — ver
    // services/hipismoAdelantadasCalc.js), nunca de j.monto (el apostado
    // bruto de la Marca completa). Una Tabla Fija nunca trae
    // `banqueadores` (solo existe para Marca), y una Marca nula nunca
    // llega a tener banqueadores (solo se banquea una Marca ya
    // decidida) — así que este bloque no necesita ningún filtro extra de
    // `j.gano`.
    if (incluirBanquero && Array.isArray(j.banqueadores)) {
      // baseJugada (02-10-2026, ver la nota grande EXACTA de
      // montoDecididoExacto en hipismoAdelantadasCalc.js) — exacta, SIN
      // redondear: antes se partía de montoDecidido (ya redondeado) y
      // encima se multiplicaba por el % de cada banqueador, doble
      // redondeo en cadena antes de llegar siquiera a `parte`.
      const baseJugada = montoDecididoExacto(j.resultado_cliente, true);
      j.banqueadores.forEach(b => {
        const parte = baseJugada * (Number(b.porcentaje) || 0) / 100;
        detalle.push({
          id: j.id, tabla: 'hipismo_adelantadas_jugadas', fecha: mismoDia ? desde : fechaComoISO(j.fecha),
          cliente: b.nombre, hipodromoNombre: j.hipodromo_nombre, carreraNumero: j.carrera_numero,
          tipo: 'marca', detalleTexto: `Marca (${j.numero1}x${j.numero2}) — banqueo ${Number(b.porcentaje) || 0}%`,
          monto: Number(j.monto),
          montoDecidido: round2(parte),
          montoDecididoExacto: parte,
          decidida: j.gano !== null && !j.sin_comision,
          gano: j.gano,
          rol: 'banquero'
        });
      });
    }
  });

  // Jugadas entre Tercios Adelantadas (05-10-2026, a pedido explícito del
  // usuario, tras ver "12 de 72 cliente(s) no cuadran": el % propio/de aval
  // del cliente se gana TAMBIÉN en estas jugadas, "en todos lados"). SOLO
  // cuando el llamador pide `incluirBanquero` (los reportes de % devuelto:
  // /comisiones-devueltas, por-hipódromo y detalle de un día) -- NUNCA para
  // /montos-apostados ni /traspasos/jugadas (incluirBanquero=false), que
  // deben seguir devolviendo EXACTAMENTE lo mismo de siempre (estas
  // jugadas no son traspasables, tabla distinta). Cada fila trae su propio
  // jugador Y banquero (2 entradas), con la base DECIDIDA (inversa del %
  // de comisión configurado en ESA jugada, ver
  // montoBaseTerciosAdelantadaExacto); una 'sin_decidir' (los 2 en 0) queda
  // `decidida:false` y los reportes la descartan solos.
  if (incluirBanquero) {
    const rTerciosAdelantadasRango = { rows: await leerTerciosAdelantadasResueltas(grupoId, desde, hasta) };
    rTerciosAdelantadasRango.rows.forEach(j => {
      const rj = Number(j.resultado_jugador) || 0, rb = Number(j.resultado_banquero) || 0;
      const sinDecidir = rj === 0 && rb === 0;
      const fechaFila = fechaComoISO(j.fecha);
      const lados = [
        { cliente: j.jugador_nombre, r: rj, rol: 'jugador', sufijo: '' },
        { cliente: j.banquero_nombre, r: rb, rol: 'banquero', sufijo: ' — banqueo' }
      ];
      lados.forEach(({ cliente, r, rol, sufijo }) => {
        const baseExacta = sinDecidir ? 0 : montoBaseTerciosAdelantadaExacto(r, j.comision_porcentaje);
        detalle.push({
          id: j.id, tabla: 'hipismo_tercios_adelantadas_jugadas', fecha: fechaFila,
          cliente, hipodromoNombre: j.hipodromo_nombre, carreraNumero: j.carrera_numero,
          tipo: 'tercios_adelantada', detalleTexto: `Adelantada entre tercios${j.modalidad ? ' ' + String(j.modalidad).toUpperCase() : ''}${sufijo}`,
          monto: Number(j.monto) || 0,
          montoDecidido: round2(baseExacta),
          montoDecididoExacto: baseExacta,
          decidida: !sinDecidir,
          gano: sinDecidir ? null : r > 0,
          rol
        });
      });
    });
  }

  return detalle;
}

// =================================================================
// TRASPASO DE JUGADAS (23-09-2026, duodécima-tercera ronda — rediseño a
// pedido del usuario: "al entrar alli seleccionaremos primero la fecha,
// despues el cliente al sleccionar el cliente me saldra ordenado por
// hipodromo las jugadas, seleccionar la jugada y despues eligir en la
// lista a que cliente se le pasa... el otro cliente que se le quita ya
// no tendra registro de esa jugada, se le eliminara ese registro de
// balance y de todos lados". Alcance confirmado con AskUserQuestion:
// SOLO Tercios + Jugadas Adelantadas (Remate queda afuera a propósito).
//
// Es un UPDATE simple de cliente_nombre sobre la fila puntual — no hace
// falta ningún borrado aparte: Balance General, Montos Apostados,
// Comisiones Devueltas y Cierre Final son todos LIVE, derivados de estas
// mismas filas por cliente_nombre, así que en cuanto cambia ese campo el
// cliente viejo deja de tener rastro de esa jugada en cualquier reporte,
// automáticamente.
// =================================================================
router.get('/traspasos/jugadas', asyncHandler(async (req, res) => {
  const { fecha, cliente } = req.query;
  if (!fecha || !cliente) return res.status(400).json({ error: 'Falta la fecha y/o el cliente.' });
  // 29-09-2026: compara colapsando espacios de más de los 2 lados (sin
  // tocar nada de lo ya guardado) — así, si alguna jugada vieja quedó con
  // un espacio de más en su cliente_nombre (ver la nota grande de
  // normalizarNombreJugador() en routes/jugadores.js, y el caso real
  // reportado: "mr increible... no sale como deberia sale -300"),
  // buscarla tal cual se escribe siempre (sin ese espacio de más) igual
  // la encuentra acá, para poder arreglarla con el traspaso de abajo.
  const clienteBuscado = cliente.trim().toUpperCase().replace(/\s+/g, ' ');
  const detalle = (await obtenerApuestasDelDia(req.grupoId, fecha))
    .filter(d => (d.cliente || '').replace(/\s+/g, ' ') === clienteBuscado && d.tipo !== 'remate');

  const porHipodromo = new Map();
  detalle.forEach(d => {
    if (!porHipodromo.has(d.hipodromoNombre)) porHipodromo.set(d.hipodromoNombre, { nombre: d.hipodromoNombre, jugadas: [] });
    porHipodromo.get(d.hipodromoNombre).jugadas.push(d);
  });
  res.json({ fecha, cliente: clienteBuscado, hipodromos: Array.from(porHipodromo.values()) });
}));

router.post('/traspasos/jugada', asyncHandler(async (req, res) => {
  const { tabla, id, clienteNuevo } = req.body;
  if (!['hipismo_tickets', 'hipismo_adelantadas_jugadas'].includes(tabla)) {
    return res.status(400).json({ error: 'Solo se pueden traspasar jugadas de Tercios o de Jugadas Adelantadas.' });
  }
  // 29-09-2026 — mismo criterio que jugadores.js/hipismoCalc.js: colapsa
  // espacios de más entre palabras (así, entre otras cosas, sirve para
  // "arreglar" una jugada vieja con un espacio de más: traspasarla al
  // MISMO nombre, retipeado limpio, deja el cliente_nombre normalizado).
  const clienteNuevoFinal = ((clienteNuevo || '') + '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!clienteNuevoFinal) return res.status(400).json({ error: 'Falta el cliente al que se le pasa la jugada.' });

  // El cliente destino tiene que existir ANTES de mover nada (no se crea solo).
  if (await rechazarClientesInexistentes(req, res, [clienteNuevoFinal])) return;

  const r = await db.query(
    `UPDATE ${tabla} SET cliente_nombre = $1 WHERE id = $2 AND grupo_id = $3 RETURNING *`,
    [clienteNuevoFinal, id, req.grupoId]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Esa jugada no existe.' });
  res.json({ ok: true, jugada: r.rows[0] });
}));

// =================================================================
// TRASPASO DE COMISIÓN (26-09-2026, ver la nota grande de
// jugadores.cuenta_comision_id en sql/schema.sql) — una cuenta de
// comisión ("{nombre} - PORCENTAJE") no tiene jugadas propias que
// traspasar con el endpoint de arriba (su saldo se calcula en vivo
// sumando el % de lo que apostó el jugador de origen, nunca de una fila
// suya) — esto es un AJUSTE aparte: resta `monto` de `clienteOrigen` y
// lo suma a `clienteDestino`, los 2 en la misma `fecha` (para que caiga
// en la semana correcta de Balance General). No recalcula ni reemplaza
// el % en sí — cada reporte que lo necesita lo suma encima (ver
// obtenerAjustesComision más abajo). El destino puede ser CUALQUIER
// cliente (otra cuenta de comisión, o un cliente normal) — se
// auto-registra si todavía no existe, igual que el resto del sistema.
router.post('/comisiones/traspaso', asyncHandler(async (req, res) => {
  const { clienteOrigen, clienteDestino, monto, fecha, nota } = req.body;
  // 29-09-2026 — mismo criterio que jugadores.js/hipismoCalc.js: colapsa
  // espacios de más entre palabras.
  const origenFinal = ((clienteOrigen || '') + '').trim().toUpperCase().replace(/\s+/g, ' ');
  const destinoFinal = ((clienteDestino || '') + '').trim().toUpperCase().replace(/\s+/g, ' ');
  const montoFinal = Number(monto);
  const fechaFinal = fecha || fechaHoyVenezuela();
  if (!origenFinal || !destinoFinal) return res.status(400).json({ error: 'Falta el cliente de origen y/o el destino.' });
  if (origenFinal === destinoFinal) return res.status(400).json({ error: 'El origen y el destino no pueden ser el mismo cliente.' });
  if (!montoFinal || montoFinal <= 0 || isNaN(montoFinal)) return res.status(400).json({ error: 'Falta un monto válido a traspasar.' });

  if (await rechazarClientesInexistentes(req, res, [destinoFinal])) return;

  await db.transaccion(async (client) => {
    await client.query(
      'INSERT INTO hipismo_comisiones_ajustes (grupo_id, cliente_nombre, monto, fecha, nota) VALUES ($1,$2,$3,$4,$5)',
      [req.grupoId, origenFinal, -montoFinal, fechaFinal, nota || null]
    );
    await client.query(
      'INSERT INTO hipismo_comisiones_ajustes (grupo_id, cliente_nombre, monto, fecha, nota) VALUES ($1,$2,$3,$4,$5)',
      [req.grupoId, destinoFinal, montoFinal, fechaFinal, nota || null]
    );
  });

  res.json({ ok: true });
}));

// =================================================================
// PESTAÑA "TRASPASO DE SALDO" (Administración, 05-10-2026, a pedido del
// usuario: "la pestaña traspaso de saldos no esta activa... alli debes
// desplegarme la lista de clientes activos para seleccionar a quien quiero
// traspasarle" -- era solo una maqueta deshabilitada). Decisiones
// confirmadas con el usuario (AskUserQuestion): (1) se registra como AJUSTE
// en los 2 clientes -- el mismo mecanismo exacto de POST /comisiones/
// traspaso de arriba (resta al origen, suma al destino, misma fecha, así
// Balance General/Cierre Final/links siguen cuadrando); (2) las listas
// muestran los clientes ACTIVOS (incluidas las fichas "- PORCENTAJE") con
// buscador; (3) historial con botón para anular.
//
// Los 2 renglones de un traspaso se insertan en la MISMA transacción, así
// que comparten `creado_en` exacto (now() es constante dentro de una
// transacción) -- así se vuelven a emparejar sin necesitar ninguna columna
// nueva (sin cambio de schema): mismo creado_en + misma fecha + montos
// opuestos. Esto también incluye los traspasos de comisión hechos desde la
// ficha de una cuenta de "%" (mismo mecanismo, misma tabla).
// =================================================================
function emparejarTraspasosSaldo(filas) {
  const usadas = new Set();
  const pares = [];
  const clave = f => `${new Date(f.creado_en).getTime()}::${fechaComoISO(f.fecha)}`;
  filas.forEach(neg => {
    if (usadas.has(neg.id) || Number(neg.monto) >= 0) return;
    const pos = filas.find(f => !usadas.has(f.id) && f.id !== neg.id && Number(f.monto) > 0
      && clave(f) === clave(neg) && Math.abs(Number(f.monto) + Number(neg.monto)) < 0.005);
    if (!pos) return;
    usadas.add(neg.id); usadas.add(pos.id);
    pares.push({
      id: neg.id, idDestino: pos.id,
      origen: neg.cliente_nombre, destino: pos.cliente_nombre,
      monto: round2(Math.abs(Number(neg.monto))),
      fecha: fechaComoISO(neg.fecha), nota: neg.nota || null, creadoEn: neg.creado_en
    });
  });
  return pares.sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
}

router.get('/traspasos-saldo', asyncHandler(async (req, res) => {
  const r = await db.query(
    `SELECT id, cliente_nombre, monto, fecha, nota, creado_en
       FROM hipismo_comisiones_ajustes
      WHERE grupo_id = $1
      ORDER BY creado_en DESC
      LIMIT 400`,
    [req.grupoId]
  );
  res.json({ traspasos: emparejarTraspasosSaldo(r.rows).slice(0, 100) });
}));

// Anula un traspaso completo (las 2 patas). `:id` puede ser el id de
// cualquiera de las 2 filas del par.
router.delete('/traspasos-saldo/:id', asyncHandler(async (req, res) => {
  const rFila = await db.query(
    `SELECT id, cliente_nombre, monto, fecha, nota, creado_en
       FROM hipismo_comisiones_ajustes WHERE id = $1 AND grupo_id = $2`,
    [req.params.id, req.grupoId]
  );
  if (!rFila.rows.length) return res.status(404).json({ error: 'Ese traspaso no existe.' });
  const fila = rFila.rows[0];
  const rMismoMomento = await db.query(
    `SELECT id, cliente_nombre, monto, fecha, nota, creado_en
       FROM hipismo_comisiones_ajustes
      WHERE grupo_id = $1 AND creado_en = $2`,
    [req.grupoId, fila.creado_en]
  );
  const par = emparejarTraspasosSaldo(rMismoMomento.rows).find(p => p.id === fila.id || p.idDestino === fila.id);
  if (!par) return res.status(409).json({ error: 'No se encontró la otra mitad de este traspaso, así que no se anuló nada.' });
  await db.transaccion(async (client) => {
    await client.query('DELETE FROM hipismo_comisiones_ajustes WHERE grupo_id = $1 AND id = ANY($2::uuid[])', [req.grupoId, [par.id, par.idDestino]]);
  });
  res.json({ ok: true });
}));

// =================================================================
// "CARGA MASIVA ESPECIAL" (05-10-2026, a pedido del usuario — ver la nota
// grande de services/hipismoCargasEspeciales.js y de sql/schema.sql):
// escribir líneas "CLIENTE +monto" / "CLIENTE -monto" eligiendo hipódromo,
// acción (Remate, Marcas, Winners...), fecha y carrera; la suma debe dar 0
// y cada nombre debe existir (si no: "CLIENTE X NO EXISTE").
//   GET    /cargas-especiales               acciones + últimas cargas
//   POST   /cargas-especiales/previsualizar "Calcular": valida y muestra el detalle
//   POST   /cargas-especiales               confirma (guarda)
//   PUT    /cargas-especiales/:id           reemplaza una carga (editar)
//   DELETE /cargas-especiales/:id           elimina una carga
// =================================================================
// Comprueba el texto de una carga: formato, acción, fecha, suma 0 Y que cada
// nombre exista EXACTAMENTE como cliente (o sea una cuenta del grupo, ver
// CUENTAS_GRUPO_CARGA_ESPECIAL). Un nombre inexistente nunca se crea solo:
// da "CLIENTE X NO EXISTE" y no deja guardar.
async function evaluarCargaEspecial(req, body) {
  const { texto, accion, fecha } = body || {};
  const v = validarCargaEspecial({ texto, accion, fecha });
  const faltan = await clientesInexistentes(req.grupoId, v.lineas.filter(l => !esCuentaGrupo(l.cliente)).map(l => l.cliente));
  const faltanSet = new Set(faltan);
  const errores = faltan.map(n => `CLIENTE ${n} NO EXISTE`).concat(v.errores);
  return { v, faltan, faltanSet, errores, ok: errores.length === 0 };
}

router.get('/cargas-especiales', asyncHandler(async (req, res) => {
  const rCargas = await db.query(
    `SELECT id, fecha, carrera, codigo_nombre, hipodromo_nombre, creado_en
       FROM hipismo_cargas_especiales WHERE grupo_id = $1
      ORDER BY fecha DESC, creado_en DESC LIMIT 50`,
    [req.grupoId]
  );
  const ids = rCargas.rows.map(c => c.id);
  const rLineas = ids.length
    ? await db.query(
        `SELECT carga_id, cliente_nombre, monto, orden FROM hipismo_cargas_especiales_lineas
          WHERE grupo_id = $1 AND carga_id = ANY($2::uuid[]) ORDER BY orden ASC`,
        [req.grupoId, ids]
      )
    : { rows: [] };
  const porCarga = new Map();
  rLineas.rows.forEach(l => {
    if (!porCarga.has(l.carga_id)) porCarga.set(l.carga_id, []);
    porCarga.get(l.carga_id).push({ cliente: l.cliente_nombre, monto: Number(l.monto) });
  });
  const cargas = rCargas.rows.map(c => {
    const lineas = porCarga.get(c.id) || [];
    return {
      id: c.id, fecha: fechaComoISO(c.fecha), carrera: c.carrera || '', accion: c.codigo_nombre,
      hipodromo: c.hipodromo_nombre || '', lineas,
      ganan: round2(lineas.filter(l => l.monto > 0).reduce((t, l) => t + l.monto, 0)),
      pierden: round2(lineas.filter(l => l.monto < 0).reduce((t, l) => t + l.monto, 0))
    };
  });
  res.json({ acciones: ACCIONES_CARGA_ESPECIAL, cuentasGrupo: CUENTAS_GRUPO_CARGA_ESPECIAL, cargas });
}));

// "Calcular": no guarda nada. Devuelve la vista previa (cliente, saldo, tipo
// de acción, detalle) y los errores que impiden confirmar.
router.post('/cargas-especiales/previsualizar', asyncHandler(async (req, res) => {
  const { accion } = req.body || {};
  const accionNorm = normalizarNombreCargaEspecial(accion);
  const e = await evaluarCargaEspecial(req, req.body);
  res.json({
    ok: e.ok, suma: e.v.suma, errores: e.errores, avisos: e.v.avisos, resumen: e.v.resumen,
    clientesNoExisten: e.faltan,
    lineas: e.v.lineas.map(l => ({
      cliente: l.cliente, saldo: l.monto, monto: l.monto,
      tipoAccion: accionNorm, detalle: 'Carga Masiva',
      existe: !e.faltanSet.has(l.cliente), cuentaGrupo: esCuentaGrupo(l.cliente)
    }))
  });
}));

// Valida el cuerpo (acción, suma 0, nombres exactos, hipódromo) y devuelve
// lo necesario para guardar, o responde el error ya armado.
async function prepararCargaEspecial(req, res) {
  const { accion, carrera, hipodromo } = req.body || {};
  const e = await evaluarCargaEspecial(req, req.body);
  if (e.faltan.length) { res.status(422).json(cuerpoClientesNoExisten(e.faltan)); return null; }
  if (!e.ok) { res.status(400).json({ error: e.errores[0], errores: e.errores }); return null; }
  const hipodromoNombre = ((hipodromo == null ? '' : String(hipodromo)).trim()) || null;
  if (hipodromoNombre) {
    const rHip = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE grupo_id = $1 AND nombre = $2', [req.grupoId, hipodromoNombre]);
    if (!rHip.rows.length) { res.status(400).json({ error: 'Ese hipódromo no existe en el grupo.' }); return null; }
  }
  // Una línea en 0 no mueve nada: no se guarda.
  const lineas = e.v.lineas.filter(l => l.monto !== 0);
  if (!lineas.length) { res.status(400).json({ error: 'Todas las líneas están en 0, no hay nada que cargar.' }); return null; }
  return {
    lineas, accionNorm: normalizarNombreCargaEspecial(accion), fecha: req.body.fecha, hipodromoNombre,
    carrera: (carrera == null ? '' : String(carrera)).trim() || null
  };
}

async function guardarLineasCargaEspecial(client, req, cargaId, lineas) {
  let orden = 0;
  for (const l of lineas) {
    await client.query(
      'INSERT INTO hipismo_cargas_especiales_lineas (carga_id, grupo_id, cliente_nombre, monto, orden) VALUES ($1,$2,$3,$4,$5)',
      [cargaId, req.grupoId, l.cliente, l.monto, orden++]
    );
  }
}

router.post('/cargas-especiales', asyncHandler(async (req, res) => {
  const datos = await prepararCargaEspecial(req, res);
  if (!datos) return;
  const id = await db.transaccion(async (client) => {
    const r = await client.query(
      'INSERT INTO hipismo_cargas_especiales (grupo_id, fecha, carrera, codigo_nombre, hipodromo_nombre) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.grupoId, datos.fecha, datos.carrera, datos.accionNorm, datos.hipodromoNombre]
    );
    await guardarLineasCargaEspecial(client, req, r.rows[0].id, datos.lineas);
    return r.rows[0].id;
  });
  res.status(201).json({ ok: true, id, lineas: datos.lineas.length });
}));

router.put('/cargas-especiales/:id', asyncHandler(async (req, res) => {
  const rExiste = await db.query('SELECT id FROM hipismo_cargas_especiales WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  if (!rExiste.rows.length) return res.status(404).json({ error: 'Esa carga no existe.' });
  const datos = await prepararCargaEspecial(req, res);
  if (!datos) return;
  await db.transaccion(async (client) => {
    await client.query('UPDATE hipismo_cargas_especiales SET fecha = $1, carrera = $2, codigo_nombre = $3, hipodromo_nombre = $4 WHERE id = $5 AND grupo_id = $6',
      [datos.fecha, datos.carrera, datos.accionNorm, datos.hipodromoNombre, req.params.id, req.grupoId]);
    await client.query('DELETE FROM hipismo_cargas_especiales_lineas WHERE carga_id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
    await guardarLineasCargaEspecial(client, req, req.params.id, datos.lineas);
  });
  res.json({ ok: true, id: req.params.id, lineas: datos.lineas.length });
}));

router.delete('/cargas-especiales/:id', asyncHandler(async (req, res) => {
  const r = await db.query('DELETE FROM hipismo_cargas_especiales WHERE id = $1 AND grupo_id = $2 RETURNING id', [req.params.id, req.grupoId]);
  if (!r.rows.length) return res.status(404).json({ error: 'Esa carga no existe.' });
  res.json({ ok: true });
}));

// obtenerAjustesComision (suma neta de ajustes de traspaso de comisión
// por cliente, en un rango de fechas — ver la nota grande de POST
// /comisiones/traspaso más arriba) se movió a
// services/hipismoComisionPropia.js (26-09-2026, al arreglar "LOS LINK
// DE % NO DAN SALDO DICEN 0") para que también la use
// services/hipismoResumenCliente.js — se importa arriba junto con
// obtenerComisionesPropias.

// GET /montos-apostados?desde=&hasta= (01-10-2026, a pedido del usuario:
// "PUEDO FILTRAR POR CLIENTE Y POR FECHA... AGREGAR RANGO, Y MOSTRAS
// SIEMPRE POR DEFECTO SEMANA COMPLETA EN CURSO, PERO PUEDO ELEGIR UN DIA O
// DOS ETC LO QUE NECESITE") — pasa de UN día puntual a un rango real,
// mismo patrón ?desde=&hasta= que ya usan Balance General/Cierre
// Final/Comisiones Devueltas (ver rangoPersonalizadoDeQuery más arriba).
// Sin ningún parámetro, el default YA NO es "hoy" sino la SEMANA COMPLETA
// EN CURSO (lunes a domingo, mismo cálculo EXACTO de rangoSemana() que ya
// usan Cierre Final/Comisiones por Carrera/Saldo Comisiones con offset 0)
// — así el operador ve de entrada toda la semana, y la puede angostar a 1
// o 2 días puntuales con ?desde=&hasta=. `?fecha=` de siempre se sigue
// aceptando tal cual (un día puntual, como funcionaba hasta esta ronda)
// para no romper ningún llamador viejo — ver test_hipismo_reportes.js.
router.get('/montos-apostados', asyncHandler(async (req, res) => {
  const rangoPersonalizado = rangoPersonalizadoDeQuery(req);
  let desde, hasta;
  if (rangoPersonalizado) {
    ({ desde, hasta } = rangoPersonalizado);
  } else if (req.query.fecha) {
    desde = hasta = req.query.fecha;
  } else {
    ({ desde, hasta } = await rangoSemanaGrupo(req.grupoId, hoyVenezuela(), 0));
  }
  const detalle = await obtenerApuestasDelRango(req.grupoId, desde, hasta);

  const porCliente = new Map();
  detalle.forEach(d => {
    if (!porCliente.has(d.cliente)) porCliente.set(d.cliente, { nombre: d.cliente, total: 0, detalle: [] });
    const c = porCliente.get(d.cliente);
    c.total = round2(c.total + d.monto);
    c.detalle.push(d);
  });
  const clientes = Array.from(porCliente.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // `fecha` se mantiene por compatibilidad (= desde, como antes cuando
  // esto era de UN solo día); `desde`/`hasta` son los nuevos, para que el
  // frontend pueda mostrar/editar el rango real.
  res.json({ fecha: desde, desde, hasta, clientes });
}));

// =================================================================
// "COMISIONES DEVUELTAS" (23-09-2026, undécima ronda) — a pedido del
// usuario, con un ejemplo numérico exacto que confirmó la fórmula que
// llevaba varias rondas pendiente (ver la nota grande arriba de
// agregarPorcentajeDevuelto): % configurado por cliente
// (jugadores.comision_propia) sobre lo que apostó, carrera a carrera,
// SIEMPRE — gane o pierda esa jugada puntual. "ordenado como Montos
// Apostados" (pedido explícito del usuario): una fecha, un cliente por
// fila con su total devuelto ese día, y al expandirlo, el detalle
// ordenado por hipódromo > carrera de cómo se fue sumando ese %.
//
// GET /comisiones-devueltas?fecha=YYYY-MM-DD (default: hoy en hora
// Venezuela) — un solo día, como siempre; o ?desde=&hasta= (01-10-2026, a
// pedido del usuario: "LA FECHA QUE VAS A MOSTRAR ARRIBA ES EL RANGO QUE
// YO ESCOJA") para sumar varios días de corrido, igual que ya hacen
// Balance General/Cierre Final con ?desde=&hasta= (ver
// rangoPersonalizadoDeQuery más arriba) — si vienen los 2 válidos, GANAN
// sobre `fecha`. Con un solo día (?fecha= de siempre, o ?desde=&hasta= con
// el mismo valor) el comportamiento/los números no cambian en nada.
router.get('/comisiones-devueltas', asyncHandler(async (req, res) => {
  const rango = rangoPersonalizadoDeQuery(req);
  const fecha = req.query.fecha || isoDeFechaUTC(hoyVenezuela());
  const desde = rango ? rango.desde : fecha;
  const hasta = rango ? rango.hasta : fecha;
  // incluirBanquero=true (02-10-2026, ver la nota grande EXACTA de
  // obtenerApuestasDelRango: caso real MUJICA banqueando en Horseshoe
  // Indianapolis) — el lado BANQUERO también genera % devuelto.
  const detalle = await obtenerApuestasDelRango(req.grupoId, desde, hasta, true);
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, detalle.map(d => d.cliente));

  // 24-09-2026: un cliente puede tener hasta 2 entradas simultáneas (ver
  // la nota grande de obtenerComisionesPropias) — así que ahora se agrupa
  // por (cliente + destino + %), no solo por cliente, para que las 2 se
  // muestren como 2 renglones separados en vez de mezclarse en uno solo.
  //
  // Acumular EXACTO por carrera, redondear 1 sola vez por carrera
  // (02-10-2026, el usuario comparó esta pantalla contra "Comisiones
  // Devueltas por Hipódromo/Carrera" el mismo día y dieron $77,60 vs
  // $77,52 -- "deben dar lo mismo... el que está perfecto es por
  // Hipódromo/Carrera"). Causa real: cuando un cliente juega MÁS DE UNA
  // línea en la MISMA carrera (ej. Codino jugando "2/2 (7)" Y "2p (7)" en
  // la 5ta de Belmont -- un caso de lo más común, no una rareza), esta
  // ruta empujaba un `devuelto` YA redondeado POR CADA TICKET por
  // separado y sumaba esos redondeados -- mientras que
  // /comisiones-devueltas-por-hipodromo (arreglada antes, en el commit
  // del doble redondeo) junta primero el EXACTO de todos los tickets de
  // esa carrera bajo el mismo código y redondea una sola vez. Sumar
  // redondeados de a uno vs. redondear la suma exacta una sola vez no
  // siempre da el mismo centavo -- por eso las 2 pantallas, viendo
  // exactamente los mismos datos, terminaban mostrando totales distintos.
  // Se cambia esta ruta al MISMO criterio (acumular exacto por carrera,
  // redondear una sola vez), para que ambas pantallas vuelvan a coincidir
  // centavo a centavo siempre, sin importar cuántas líneas tenga un
  // cliente en una misma carrera.
  const porCliente = new Map();
  detalle.forEach(d => {
    // 26-09-2026, a pedido del usuario ("LOS REMATES NO LE PRODUCEN % DE
    // DEVOLUCION A LOS CLIENTES"): Remate SÍ entra en /montos-apostados
    // (lo apostado, sin importar %), pero a propósito NUNCA en este
    // reporte de % devuelto.
    if (d.tipo === 'remate') return;
    // NUNCA una jugada que "no se decidió" (29-09-2026, a pedido explícito
    // del usuario -- ver la nota grande EXACTA de obtenerApuestasDelDia
    // más arriba: "NO PUEDES PAGAR O DELVOLVER % DE UNA JUGADA QUE QUEDO
    // NULA... ELLOS GANAN % DE LO QUE GENERE EL GRUPO"). Antes de este
    // fix, este reporte no traía el resultado de la jugada y devolvía %
    // sobre CUALQUIER monto, decidida o no (caso real: Sebastian cobrando
    // % de una Marca "pp" que quedó nula).
    if (!d.decidida) return;
    const infos = comisionesPropias[d.cliente];
    if (!infos || !infos.length) return; // sin % configurado, no aparece en este reporte
    infos.forEach(info => {
      if (!info || !info.pct) return;
      // "incluir % en sus jugadas" (29-09-2026, revertido el 02-10-2026
      // para los 3 reportes de auditoría — ver la nota grande en
      // hipismoComisionPropia.js): ANTES este % se excluía acá porque ya
      // está sumado/restado DENTRO de la jugada del cliente (ver
      // construirResumenClienteHipismo), para no "duplicarlo" en el saldo
      // de Balance General/Cierre Final. Pero el usuario pidió verlo de
      // todos modos EN ESTE reporte ("necesito me muestres ese % en las
      // comisiones para ver la sumatoria real de las comisiones"): este
      // reporte es de auditoría pura (cuánto % se generó, no el saldo
      // financiero del cliente), así que mostrarlo acá no duplica nada en
      // Balance General — simplemente hacía que el TOTAL de este reporte
      // quedara incompleto para los clientes con el toggle en ON. Ya NO
      // se excluye por `incluidaEnJugada` acá (si solo tiene esta entrada,
      // destino === d.cliente, mismo criterio que cualquier otro % propio).
      // montoDecididoExacto, no montoDecidido (02-10-2026, ver la nota
      // grande EXACTA en hipismoAdelantadasCalc.js: "otro programa" daba
      // $0.01 menos — doble redondeo en cadena). NUNCA d.monto (lo
      // apostado bruto) ni d.montoDecidido (ya redondeado).
      const devueltoExacto = (Number(d.montoDecididoExacto) || 0) * (info.pct / 100);
      if (!devueltoExacto) return;
      // A propósito SIGUE agrupado por quien APOSTÓ (d.cliente), no por el
      // destino — este reporte audita "quién generó cuánto %"; `destino` se
      // agrega aparte para que el frontend pueda avisar "va acreditado a
      // {destino}" cuando el cliente tiene un aval configurado (ver la nota
      // grande de obtenerComisionesPropias más arriba).
      const clave = d.cliente + '::' + info.destino + '::' + info.pct;
      if (!porCliente.has(clave)) porCliente.set(clave, { nombre: d.cliente, porcentaje: info.pct, destino: info.destino, esAvalAdicional: !!info.esAvalAdicional, hipodromos: new Map() });
      const c = porCliente.get(clave);
      if (!c.hipodromos.has(d.hipodromoNombre)) c.hipodromos.set(d.hipodromoNombre, { nombre: d.hipodromoNombre, carrerasMap: new Map() });
      const h = c.hipodromos.get(d.hipodromoNombre);
      // `fecha` en la clave de carrera (01-10-2026): con un rango de
      // varios días, el mismo hipódromo+número de carrera puede repetirse
      // en días distintos — nunca deben juntarse entre sí.
      const claveCarreraLinea = d.fecha + '::' + d.carreraNumero;
      if (!h.carrerasMap.has(claveCarreraLinea)) {
        h.carrerasMap.set(claveCarreraLinea, {
          fecha: d.fecha, carreraNumero: d.carreraNumero, tipo: d.tipo,
          detalleTextos: [], monto: 0, exacto: 0,
          neteado: !!d.neteado, decididoJugador: d.decididoJugador, decididoBanquero: d.decididoBanquero,
          neto: d.neteado ? d.montoDecidido : undefined
        });
      }
      const entrada = h.carrerasMap.get(claveCarreraLinea);
      entrada.detalleTextos.push(d.detalleTexto);
      entrada.monto = round2(entrada.monto + (Number(d.monto) || 0));
      entrada.exacto += devueltoExacto;
    });
  });

  const clientes = Array.from(porCliente.values())
    .map(c => {
      const hipodromos = Array.from(c.hipodromos.values()).map(h => {
        const carreras = Array.from(h.carrerasMap.values()).map(entrada => ({
          fecha: entrada.fecha, carreraNumero: entrada.carreraNumero, tipo: entrada.tipo,
          // Varias líneas del mismo cliente en la MISMA carrera (ej. "2/2
          // (7)" y "2p (7)" del mismo caballo) se funden en un solo
          // renglón -- mismo criterio que ya usa /comisiones-devueltas-
          // por-hipodromo para que ambas pantallas den el mismo centavo.
          detalleTexto: entrada.detalleTextos.join(' + '),
          monto: entrada.monto,
          devuelto: round2(entrada.exacto),
          neteado: entrada.neteado, decididoJugador: entrada.decididoJugador, decididoBanquero: entrada.decididoBanquero, neto: entrada.neto
        }));
        const total = round2(carreras.reduce((s, cr) => s + cr.devuelto, 0));
        return { nombre: h.nombre, total, carreras };
      });
      const total = round2(hipodromos.reduce((s, h) => s + h.total, 0));
      return { nombre: c.nombre, porcentaje: c.porcentaje, destino: c.destino, esAvalAdicional: c.esAvalAdicional, total, hipodromos };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.esAvalAdicional - b.esAvalAdicional);

  const totalGeneralDevueltas = round2(clientes.reduce((s, c) => s + c.total, 0));

  // `fecha` se mantiene por compatibilidad (siempre = desde, como antes
  // cuando esto era de UN solo día); `desde`/`hasta` son los nuevos, para
  // que el frontend pueda mostrar el rango real que el usuario eligió.
  res.json({ fecha: desde, desde, hasta, clientes, totalGeneral: totalGeneralDevueltas });
}));

// =================================================================
// "COMISIONES DEVUELTAS POR HIPÓDROMO" (24-09-2026, a pedido del usuario:
// "la ventana comisiones devueltas metela en la pestaña comisiones... y
// colocale como nombre comisiones devuelta por hipodromo, alli debo ver
// ordenado por hipodromo por carrera, cuanto se a devuelto de comision").
// Mismos datos que /comisiones-devueltas (arriba) — el mismo universo de
// apuestas de UN día puntual, filtrado a clientes con % propio
// configurado — pero agregados por hipódromo > carrera, SUMANDO entre
// TODOS los clientes de esa carrera (a diferencia de /comisiones-
// devueltas, que agrupa por cliente primero). Mismo formato/estructura
// que ya usa /comisiones-por-hipodromo (comisión GANADA por el grupo),
// solo que acá el monto es lo DEVUELTO a los clientes con % propio.
//
// GET /comisiones-devueltas-por-hipodromo?fecha=YYYY-MM-DD (default: hoy en hora Venezuela).
router.get('/comisiones-devueltas-por-hipodromo', asyncHandler(async (req, res) => {
  const fecha = req.query.fecha || isoDeFechaUTC(hoyVenezuela());
  // incluirBanquero=true (02-10-2026, ver la nota grande EXACTA de
  // obtenerApuestasDelRango: caso real MUJICA banqueando en Horseshoe
  // Indianapolis) — el lado BANQUERO también genera % devuelto.
  const detalle = await obtenerApuestasDelDia(req.grupoId, fecha, true);
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, detalle.map(d => d.cliente));

  const porHipodromo = new Map();
  // "código" por carrera (02-10-2026, a pedido del usuario: "colocale
  // pestaña para que si yo despliego la pestaña a cada carrera me diga
  // que codigo y cuanto fue lo que dejaron para que de ese total en la
  // carrera") — antes acá se sumaban de una vez las hasta 2 entradas de
  // obtenerComisionesPropias (% propio + % de aval) por jugada ANTES de
  // redondear, perdiendo de vista a quién se le acreditaba cada parte.
  // Cada entrada se acumula POR SEPARADO bajo su propio `info.destino`
  // ("código"), dentro de un Map(carreraNumero -> {porCodigoMap}).
  //
  // montoDecididoExacto + acumulado SIN redondear (02-10-2026, "otro
  // programa" dio $0.01 menos en una carrera real — ver la nota grande
  // EXACTA de montoDecididoExacto en hipismoAdelantadasCalc.js). Acá había
  // DOS redondeos en cadena: (1) d.montoDecidido ya venía redondeado antes
  // de multiplicarlo por el %, y (2) la suma corrida de cada Map
  // (porCodigoMap/carrera.total/hip.totalDevuelto/totalGeneral) se
  // redondeaba otra vez en CADA entrada que se le sumaba. Ahora se
  // acumula la plata exacta (sin redondear ni la base ni las sumas
  // parciales) por código, y solo se redondea UNA VEZ por código al armar
  // la respuesta; carrera/hipódromo/total general se arman sumando esos
  // montos de código YA redondeados (nunca recalculando desde el
  // acumulado exacto), así la pestaña sigue sumando EXACTO el total que
  // se muestra arriba — la regla de siempre, solo que ahora sin el
  // sesgo de redondear de más en el camino.
  detalle.forEach(d => {
    // 26-09-2026, ver la nota grande EXACTA de /comisiones-devueltas
    // arriba: Remate a propósito no genera % devuelto.
    if (d.tipo === 'remate') return;
    // NUNCA una jugada que "no se decidió" (29-09-2026, ver la nota grande
    // EXACTA de /comisiones-devueltas arriba).
    if (!d.decidida) return;
    const infos = comisionesPropias[d.cliente];
    if (!infos || !infos.length) return;
    infos.forEach(info => {
      if (!info || !info.pct) return;
      // "incluir % en sus jugadas" (29-09-2026, revertido el 02-10-2026
      // para este reporte) — ver la nota grande EXACTA de
      // /comisiones-devueltas arriba: ya NO se excluye acá, a pedido del
      // usuario, para que el total de este reporte sea la sumatoria REAL.
      // montoDecididoExacto, no montoDecidido (02-10-2026) — ver la nota
      // grande de más arriba, NUNCA d.monto.
      const devueltoExacto = (Number(d.montoDecididoExacto) || 0) * (info.pct / 100);
      if (!devueltoExacto) return;
      if (!porHipodromo.has(d.hipodromoNombre)) {
        porHipodromo.set(d.hipodromoNombre, { nombre: d.hipodromoNombre, carrerasMap: new Map() });
      }
      const hip = porHipodromo.get(d.hipodromoNombre);
      if (!hip.carrerasMap.has(d.carreraNumero)) {
        hip.carrerasMap.set(d.carreraNumero, new Map());
      }
      const porCodigoMap = hip.carrerasMap.get(d.carreraNumero);
      porCodigoMap.set(info.destino, (porCodigoMap.get(info.destino) || 0) + devueltoExacto);
    });
  });

  const hipodromos = Array.from(porHipodromo.values())
    .map(h => {
      const carreras = Array.from(h.carrerasMap.entries())
        .map(([carreraNumero, porCodigoMap]) => {
          const porCodigo = Array.from(porCodigoMap.entries())
            .map(([codigo, exacto]) => ({ codigo, monto: round2(exacto) }))
            .filter(c => c.monto)
            .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'));
          const devuelto = round2(porCodigo.reduce((s, c) => s + c.monto, 0));
          return { carreraNumero, devuelto, porCodigo };
        })
        .filter(c => c.devuelto)
        .sort((a, b) => a.carreraNumero - b.carreraNumero);
      const totalDevuelto = round2(carreras.reduce((s, c) => s + c.devuelto, 0));
      return { nombre: h.nombre, totalDevuelto, carreras };
    })
    .filter(h => h.totalDevuelto)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const totalGeneral = round2(hipodromos.reduce((s, h) => s + h.totalDevuelto, 0));

  res.json({ fecha, hipodromos, totalGeneral });
}));

// =================================================================
// CIERRE FINAL REAL (23-09-2026, a pedido del usuario: "si cierre final
// es el saldo real de los clientes de sus jugadas no debe estar sumada
// ni restado pozos.... osea que quiero yo no es que tiene de pozo 400 y
// se gano 300, me vas a colocar en cierre final 700, no cierre final
// solo van sus jugadas... solo me susmaras y mostratas los pozos en
// pozos") — reemplaza el CIERRES_SEMANALES de ejemplo del mockup.
//
// A PROPÓSITO no toca hipismo_planos.pozo ni ninguna tabla de Pozos: el
// saldo de acá es EXCLUSIVAMENTE la suma de resultado_jugador/
// resultado_banquero de hipismo_tickets de la semana — lo mismo que ya
// resume "por cliente" services/pozo.js pero SIN el pozo inicial ni el
// arrastre de semanas anteriores que sí carga esa otra pantalla. Un
// cliente puede aparecer 2 veces conceptualmente (como jugador en una
// línea, como banquero en otra) — acá se juntan bajo el mismo nombre,
// igual que ya hace obtenerLineasHipismoCliente() para un cliente
// puntual, pero agregado para TODOS los clientes del grupo a la vez.
//
// Remate (23-09-2026): sus líneas SÍ entran acá también — un remate es
// otra forma de jugada de Hipismo, así que su resultado neto por cliente
// (hipismo_remate_apuestas.resultado) suma/resta al mismo saldo de
// jugadas de la semana. Su comisión, en cambio, va SEPARADA
// (comisionRemateSemana) del 5% de "Cargar Planos" (comisionSemana) —
// "esa comision se coloca en los balances como un item llamado remate",
// no mezclada con la comisión normal.
//
// "traspaso de saldo" y "retiros" que mencionó el usuario TODAVÍA no
// existen como funciones reales de Hipismo (las pantallas "💸 Retiros" y
// "🔄 Traspaso de Saldo" del mockup siguen con botones deshabilitados,
// sin backend) — el día que se construyan de verdad, tienen que sumarse/
// restarse acá también; por ahora el saldo es 100% de jugadas (Tercios +
// Remate), que ya es exactamente lo que pidió el usuario en su ejemplo
// (pozo 400 + ganó 300 => Cierre Final debe mostrar 300, no 700).
//
// GET /cierre-final?semana=actual|anterior|hace2 — mismo selector de 3
// semanas que ya usan comisiones-por-carrera y el link del cliente.
// 30-09-2026: el cálculo en sí (todas las consultas, TABLAS FIJAS,
// PORCENTAJE MARCAS, % DEVUELTO, cruce, traspasos, REMATE, etc.) se sacó
// a construirCierreFinalHipismo (services/hipismoResumenCliente.js) para
// poder reusarlo tal cual desde la nueva ruta de Super-admin (ver GET
// /grupos/:id/hipismo-cierre-final en routes/superadmin.js) — acá solo
// queda la resolución de semana/rango, que es lo único realmente
// específico de esta pantalla (el resto de la nota grande de esta lógica
// vive ahora junto a construirCierreFinalHipismo).
router.get('/cierre-final', asyncHandler(async (req, res) => {
  const rangoPersonalizado = rangoPersonalizadoDeQuery(req);
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || await rangoSemanaGrupo(req.grupoId, hoyVe, offset);
  // Con rango personalizado no tiene sentido "semana actual" ni "semana
  // ISO N" (puede abarcar varias semanas o ni empezar en lunes) — el
  // frontend usa el flag rangoPersonalizado de la respuesta para mostrar
  // el rango en vez de esos 2 datos.
  const esSemanaActual = !rangoPersonalizado && isoDeFechaUTC(hoyVe) >= desde && isoDeFechaUTC(hoyVe) <= hasta;
  const numeroSemana = numeroSemanaISO(desde);

  const resultado = await construirCierreFinalHipismo(req.grupoId, desde, hasta);
  return res.json({
    rango: { desde, hasta },
    semana,
    rangoPersonalizado: !!rangoPersonalizado,
    numeroSemana,
    esSemanaActual,
    ...resultado
  });
}));

// =================================================================
// GET /diagnostico-saldos?semana=actual|anterior|hace2 (03-10-2026, ver
// la nota grande EXACTA de diagnosticarSaldosHipismo en
// services/hipismoResumenCliente.js — caso real "Legolas": $2.863,98 en
// la grilla vs $2.871,98 en su propio link, mismo bug de fondo que
// "Mrmoney" pero detectado DESPUÉS, por captura de pantalla, en vez de
// por una verificación sistemática). Mismo selector de semana/rango que
// GET /cierre-final — corre ese mismo cálculo MÁS el de cada cliente, y
// solo devuelve los que no cuadran, para poder revisar de una sola vez
// si queda algún otro cliente con el mismo problema, en vez de esperar a
// que cada uno llegue por separado.
// =================================================================
router.get('/diagnostico-saldos', asyncHandler(async (req, res) => {
  const rangoPersonalizado = rangoPersonalizadoDeQuery(req);
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || await rangoSemanaGrupo(req.grupoId, hoyVe, offset);

  const resultado = await diagnosticarSaldosHipismo(req.grupoId, req.grupo, desde, hasta);
  return res.json({
    semana,
    rangoPersonalizado: !!rangoPersonalizado,
    ...resultado
  });
}));

// PUESTA EN MARCHA (07-10-2026, ver services/hipismoPuestaEnMarcha.js):
// GET /puesta-en-marcha = lista de pasos de un grupo nuevo + estado de la
// base de datos; POST /puesta-en-marcha/prueba = prueba piloto (solo lee,
// no guarda nada). Solo el administrador del grupo.
router.get('/puesta-en-marcha', requiereAdministrador, asyncHandler(async (req, res) => {
  const pem = require('../services/hipismoPuestaEnMarcha');
  const [checklist, esquema] = await Promise.all([pem.construirChecklistGrupo(req.grupo), pem.verificarEsquema().catch(e => ({ ok: false, faltan: ['no se pudo revisar: ' + e.message] }))]);
  res.json({ ...checklist, esquema });
}));
router.post('/puesta-en-marcha/prueba', requiereAdministrador, asyncHandler(async (req, res) => {
  res.json(await require('../services/hipismoPuestaEnMarcha').ejecutarPruebaPiloto(req.grupo));
}));

// GET /registro-saldos?granularidad=semana|mes|anio&cantidad=N (07-10-2026,
// ver services/hipismoRegistroSaldos.js): saldo de cada cliente por semana,
// mes o año, con el desglose por tipo de jugada y su comisión neta (qué tan
// rentable es). Solo lee; los números salen del mismo Cierre Final.
router.get('/registro-saldos', asyncHandler(async (req, res) => {
  const { construirRegistroSaldosHipismo } = require('../services/hipismoRegistroSaldos');
  res.json(await construirRegistroSaldosHipismo(req.grupoId, { granularidad: req.query.granularidad, cantidad: req.query.cantidad }));
}));

// =================================================================
// "GRUPO DE CLIENTES" (30-09-2026, a pedido del usuario — ver la nota
// grande en services/gruposClientes.js y en sql/schema.sql). CRUD de
// este módulo (modulo='hipismo' fijo en cada llamada); el titular y los
// miembros se eligen del mismo listado de clientes de GET /api/jugadores
// (misma tabla jugadores, compartida con Deportes). La tarjeta
// (GET /grupos-clientes/:id) trae saldo semana actual + semana anterior
// de respaldo, sin recalcular nada — reusa construirCierreFinalHipismo.
// El link público equivalente (sin login) es GET /api/grupo-cliente/:token,
// compartido con Deportes (ver src/routes/gruposClientesPublico.js).
// =================================================================
router.get('/grupos-clientes', asyncHandler(async (req, res) => {
  const grupos = await listarGruposClientes(req.grupoId, 'hipismo');
  return res.json({ grupos });
}));

router.post('/grupos-clientes', asyncHandler(async (req, res) => {
  const titularId = (req.body.titularId || '').toString().trim();
  if (!titularId) return res.status(400).json({ error: 'Falta el cliente titular.' });
  const resultado = await crearGrupoCliente(req.grupoId, 'hipismo', titularId);
  if (!resultado.ok) return res.status(404).json({ error: 'Ese cliente titular no existe en este grupo.' });
  return res.status(201).json({ grupoCliente: resultado.grupoCliente });
}));

router.get('/grupos-clientes/:id', asyncHandler(async (req, res) => {
  const tarjeta = await construirTarjetaGrupoCliente(req.params.id, req.grupoId, 'hipismo');
  if (!tarjeta) return res.status(404).json({ error: 'Grupo de clientes no encontrado.' });
  return res.json(tarjeta);
}));

router.delete('/grupos-clientes/:id', asyncHandler(async (req, res) => {
  const borrado = await eliminarGrupoCliente(req.grupoId, 'hipismo', req.params.id);
  if (!borrado) return res.status(404).json({ error: 'Grupo de clientes no encontrado.' });
  return res.json({ ok: true });
}));

router.post('/grupos-clientes/:id/miembros', asyncHandler(async (req, res) => {
  const jugadorId = (req.body.jugadorId || '').toString().trim();
  if (!jugadorId) return res.status(400).json({ error: 'Falta el cliente a agregar.' });
  const resultado = await agregarMiembro(req.grupoId, 'hipismo', req.params.id, jugadorId);
  if (!resultado.ok) return res.status(404).json({ error: resultado.motivo === 'cliente_no_encontrado' ? 'Ese cliente no existe en este grupo.' : 'Grupo de clientes no encontrado.' });
  return res.json({ ok: true });
}));

router.delete('/grupos-clientes/:id/miembros/:jugadorId', asyncHandler(async (req, res) => {
  const resultado = await quitarMiembro(req.grupoId, 'hipismo', req.params.id, req.params.jugadorId);
  if (!resultado.ok) return res.status(404).json({ error: 'Grupo de clientes no encontrado.' });
  return res.json({ ok: true });
}));

// =================================================================
// "SALDO COMISIONES" REAL (24-09-2026, a pedido del usuario: "saldo
// comisiones si esta sacando el % que se le devuelve a cada cliente" —
// hasta esta ronda la pantalla mostraba datos de ejemplo fijos). Mismo %
// propio por cliente (jugadores.comision_propia, ver la nota grande de
// obtenerComisionesPropias) y el mismo cálculo "% de todo lo apostado
// como jugador, gane o pierda" que ya usan /comisiones-devueltas (por
// día) y el ítem "{destino} - PORCENTAJE" de /cierre-final — acá,
// agregado para TODA la semana (mismo selector de 3 semanas que Cierre
// Final/Balance General), un renglón por cliente con su % configurado y
// cuánto lleva devuelto en esa semana.
//
// GET /saldo-comisiones?semana=actual|anterior|hace2
router.get('/saldo-comisiones', asyncHandler(async (req, res) => {
  await asegurarBanqueoAutomaticoMarcas(req.grupoId);
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = await rangoSemanaGrupo(req.grupoId, hoyVe, offset);
  const numeroSemana = numeroSemanaISO(desde);

  // `p.hipodromo_nombre, p.carrera_numero, p.fecha` (02-10-2026, agregadas
  // SOLO para el neteo jugador/banquero de más abajo — ver la nota grande
  // EXACTA de netearJugadorBanqueroTercios en services/hipismoCalc.js).
  const rTickets = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.monto, t.resultado_jugador, t.resultado_banquero, t.sin_comision, p.hipodromo_nombre, p.carrera_numero, p.fecha
       FROM hipismo_tickets t
       JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  const rApuestasRemate = await db.query(
    `SELECT a.cliente_nombre, a.monto
       FROM hipismo_remate_apuestas a
       JOIN hipismo_remates r ON r.id = a.remate_id
      WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  // p.fecha, p.hipodromo_nombre, j.carrera_numero (02-10-2026, ver la nota
  // grande EXACTA de acumularSaldo más abajo: hacen falta para fusionar por
  // carrera antes de redondear — antes esta consulta no las traía).
  const rAdelantadas = await db.query(
    `SELECT j.cliente_nombre, j.monto, j.resultado_cliente, j.banqueadores, j.gano, j.sin_comision,
            p.fecha, p.hipodromo_nombre, j.carrera_numero
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
    [req.grupoId, desde, hasta]
  );

  // Jugadas entre Tercios Adelantadas (05-10-2026): también generan % propio/de aval.
  const rTerciosAdelantadasSaldo = await leerTerciosAdelantadasResueltas(req.grupoId, desde, hasta);

  // 29-09-2026 (ver la nota grande de /cierre-final): el lado BANQUERO, en
  // cualquier presentación (Tercios o Marca de Jugadas Adelantadas),
  // ahora también cuenta para el % propio/de aval.
  const nombresJugadores = new Set();
  rTickets.rows.forEach(t => nombresJugadores.add(t.cliente_nombre));
  rTickets.rows.forEach(t => nombresJugadores.add(t.banquero_nombre));
  rApuestasRemate.rows.forEach(a => nombresJugadores.add(a.cliente_nombre));
  rAdelantadas.rows.forEach(j => {
    nombresJugadores.add(j.cliente_nombre);
    if (Array.isArray(j.banqueadores)) j.banqueadores.forEach(b => nombresJugadores.add(b.nombre));
  });
  rTerciosAdelantadasSaldo.forEach(j => { nombresJugadores.add(j.jugador_nombre); nombresJugadores.add(j.banquero_nombre); });
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, Array.from(nombresJugadores));

  // 24-09-2026: hasta 2 entradas simultáneas por cliente (ver la nota
  // grande de obtenerComisionesPropias) — se agrupa por (nombre +
  // destino + %) para mostrarlas como 2 renglones separados en vez de
  // mezclarlas en uno solo.
  //
  // FUSIONAR POR CARRERA ANTES DE REDONDEAR (02-10-2026, mismo bug y mismo
  // arreglo YA probado en /comisiones-devueltas y /cierre-final — caso
  // real: Balance General daba $379,65 y debía dar $379,78): cuando un
  // cliente tiene 2+ tickets/jugadas en la MISMA carrera, redondear cada
  // uno por separado y sumar esos redondeos no siempre da lo mismo que
  // sumar los montos EXACTOS de esa carrera y redondear una sola vez. Cada
  // grupo (nombre+destino+%) guarda ahora un `porCarrera` (Map de
  // claveCarrera -> exacto sin redondear); recién al armar `clientes` más
  // abajo se redondea UNA vez por carrera y se suman esos valores ya
  // redondeados para `devueltoSemana`.
  const porCliente = new Map();
  function acumularSaldo(nombre, monto, claveCarrera) {
    const infos = comisionesPropias[nombre];
    if (!infos || !infos.length) return;
    infos.forEach(info => {
      if (!info || !info.pct) return;
      // "incluir % en sus jugadas" (29-09-2026, revertido el 02-10-2026
      // para este reporte) — ver la nota grande EXACTA de
      // /comisiones-devueltas arriba: ya NO se excluye acá, a pedido del
      // usuario, para que el total de este reporte sea la sumatoria REAL.
      const exacto = Math.abs(Number(monto) || 0) * (info.pct / 100);
      if (!exacto) return;
      const clave = nombre + '::' + info.destino + '::' + info.pct;
      if (!porCliente.has(clave)) porCliente.set(clave, { nombre, porcentaje: info.pct, destino: info.destino, esAvalAdicional: !!info.esAvalAdicional, porCarrera: new Map() });
      const c = porCliente.get(clave);
      c.porCarrera.set(claveCarrera, (c.porCarrera.get(claveCarrera) || 0) + exacto);
    });
  }
  // 26-09-2026, a pedido del usuario ("LOS REMATES NO LE PRODUCEN % DE
  // DEVOLUCION A LOS CLIENTES") — Remate a propósito NO suma acá.
  //
  // NUNCA una jugada que "no se decidió" (29-09-2026, ver la nota grande
  // EXACTA de /cierre-final) — se filtra por resultado_jugador/
  // resultado_banquero en 0 para Tercios, y por gano !== null para
  // Adelantadas. Number(...) obligatorio -- ver la nota grande EXACTA de
  // /cierre-final sobre por qué "pg" nunca da estas columnas como number.
  // montoDecidido (02-10-2026, "SIEMPRE ES BASE A LO DECIDIDO SIN SACARLE
  // EL 5%" — ver la nota grande de montoDecidido() en
  // services/hipismoAdelantadasCalc.js): NUNCA t.monto/j.monto.
  const ticketsDecididos = rTickets.rows.filter(t => !(Number(t.resultado_jugador) === 0 && Number(t.resultado_banquero) === 0));
  // NETEO jugador/banquero por carrera (02-10-2026, caso GG: ver la nota
  // grande EXACTA de netearJugadorBanqueroTercios en hipismoCalc.js) — un
  // cliente que juega Y banquea en la MISMA carrera (Tercios únicamente)
  // deja de sumar % sobre cada lado por separado y pasa a sumarlo UNA sola
  // vez sobre el NETO de ambos lados en esa carrera — mismo criterio EXACTO
  // que ya usan /comisiones-devueltas y /cierre-final.
  const netoPorCarreraSaldo = netearJugadorBanqueroTercios(ticketsDecididos.map(t => ({
    clienteNombre: t.cliente_nombre, banqueroNombre: t.banquero_nombre,
    resultadoJugador: t.resultado_jugador, resultadoBanquero: t.resultado_banquero,
    sinComision: t.sin_comision,
    fecha: t.fecha instanceof Date ? t.fecha.toISOString().slice(0, 10) : t.fecha,
    hipodromoNombre: t.hipodromo_nombre, carreraNumero: t.carrera_numero
  })));
  const dualAgregadoSaldo = new Set();
  ticketsDecididos.forEach(t => {
    const fechaFila = t.fecha instanceof Date ? t.fecha.toISOString().slice(0, 10) : t.fecha;
    const claveCarrera = `${fechaFila}::${t.hipodromo_nombre}::${t.carrera_numero}`;
    const infoJugador = netoPorCarreraSaldo.get(claveCarrera)?.get(t.cliente_nombre);
    const infoBanquero = netoPorCarreraSaldo.get(claveCarrera)?.get(t.banquero_nombre);
    // 04-10-2026: montoDecididoExacto -> montoBaseComisionExacto -- "a
    // premio" SIN comisión (t.sin_comision, bandera REAL del ticket) no
    // genera % devuelto (ver la nota grande de montoBaseComisionExacto en
    // hipismoAdelantadasCalc.js).
    if (!(infoJugador && infoJugador.dual)) {
      acumularSaldo(t.cliente_nombre, montoBaseComisionExacto(t.resultado_jugador, t.sin_comision), claveCarrera);
    }
    // 29-09-2026 — lado BANQUERO de Tercios (ver la nota grande de arriba).
    if (!(infoBanquero && infoBanquero.dual)) {
      acumularSaldo(t.banquero_nombre, montoBaseComisionExacto(t.resultado_banquero, t.sin_comision), claveCarrera);
    }
    // netoExacto, no `neto` (02-10-2026, ver la nota grande EXACTA de
    // montoDecididoExacto en hipismoAdelantadasCalc.js) — acumularSaldo()
    // ya no redondea acá, solo fusiona por carrera (ver la nota grande de
    // arriba).
    [t.cliente_nombre, t.banquero_nombre].forEach(nombre => {
      const info = netoPorCarreraSaldo.get(claveCarrera)?.get(nombre);
      if (!info || !info.dual) return;
      const claveDual = `${claveCarrera}::${nombre}`;
      if (dualAgregadoSaldo.has(claveDual)) return;
      dualAgregadoSaldo.add(claveDual);
      acumularSaldo(nombre, info.netoExacto, claveCarrera);
    });
  });
  // claveCarrera con p.fecha/p.hipodromo_nombre/j.carrera_numero (agregadas
  // arriba a rAdelantadas) para poder fusionar con tickets de Tercios de la
  // misma carrera.
  rAdelantadas.rows.filter(j => j.gano !== null && !j.sin_comision).forEach(j => {
    const fechaFila = j.fecha instanceof Date ? j.fecha.toISOString().slice(0, 10) : j.fecha;
    const claveCarrera = `${fechaFila}::${j.hipodromo_nombre}::${j.carrera_numero}`;
    acumularSaldo(j.cliente_nombre, montoDecididoExacto(j.resultado_cliente, true), claveCarrera);
  });
  // 29-09-2026 — lado BANQUERO de una Marca: cada banqueador solo banqueó
  // su `porcentaje` de la base DECIDIDA de la jugada completa
  // (|resultado_cliente|, el mismo "base" que ya usa resolverBanqueoMarca
  // para repartir entre banqueadores — ver services/hipismoAdelantadasCalc.js),
  // nunca de j.monto (el apostado bruto de la Marca completa).
  rAdelantadas.rows.forEach(j => {
    if (!Array.isArray(j.banqueadores) || j.sin_comision) return; // sin comisión (07-10-2026): no genera % devuelto
    const baseJugada = montoDecididoExacto(j.resultado_cliente, true);
    const fechaFila = j.fecha instanceof Date ? j.fecha.toISOString().slice(0, 10) : j.fecha;
    const claveCarrera = `${fechaFila}::${j.hipodromo_nombre}::${j.carrera_numero}`;
    j.banqueadores.forEach(b => {
      const parte = baseJugada * (Number(b.porcentaje) || 0) / 100;
      acumularSaldo(b.nombre, parte, claveCarrera);
    });
  });
  // Jugadas entre Tercios Adelantadas (05-10-2026, ver la nota grande de
  // /cierre-final en services/hipismoResumenCliente.js): ambos lados,
  // base DECIDIDA, nunca una jugada que no se decidió (resultado 0).
  rTerciosAdelantadasSaldo.forEach(j => {
    const claveCarrera = `${fechaComoISO(j.fecha)}::${j.hipodromo_nombre}::${j.carrera_numero}`;
    if (Number(j.resultado_jugador) !== 0) acumularSaldo(j.jugador_nombre, montoBaseTerciosAdelantadaExacto(j.resultado_jugador, j.comision_porcentaje), claveCarrera);
    if (Number(j.resultado_banquero) !== 0) acumularSaldo(j.banquero_nombre, montoBaseTerciosAdelantadaExacto(j.resultado_banquero, j.comision_porcentaje), claveCarrera);
  });

  // Recién ahora se redondea UNA vez por carrera dentro de cada grupo
  // (nombre+destino+%), y se suman esos valores ya redondeados — ver la
  // nota grande EXACTA de acumularSaldo más arriba.
  const clientes = Array.from(porCliente.values())
    .map(c => ({
      nombre: c.nombre, porcentaje: c.porcentaje, destino: c.destino, esAvalAdicional: c.esAvalAdicional,
      devueltoSemana: round2(Array.from(c.porCarrera.values()).reduce((s, exacto) => s + round2(exacto), 0))
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const totalGeneral = round2(clientes.reduce((s, c) => s + c.devueltoSemana, 0));

  res.json({ rango: { desde, hasta }, semana, numeroSemana, clientes, totalGeneral });
}));

// =================================================================
// "Saldos > Detallado por Cliente" (24-09-2026, a pedido del usuario:
// "detallado por cliente es basicamente lo mismo que balance general
// pero al darle click al cliente puedo ver todas sus jugadas, asi como
// ellos la ven en sus links personalizados"). Esta ruta le devuelve al
// Administrador/Empleado EXACTAMENTE la misma respuesta que ya arma
// GET /api/hipismo-cliente/:token (el portal público, sin login) para
// ESE cliente puntual — mismo shape, misma función compartida
// (construirResumenClienteHipismo, ver services/hipismoResumenCliente.js)
// — así nunca puede mostrar algo distinto de lo que el cliente ve en su
// propio link. La diferencia es solo CÓMO se identifica al cliente: acá
// por su nombre (ya en MAYÚSCULA, mismo criterio de todo el módulo) más
// el grupo de la sesión, en vez de por su token público.
router.get('/clientes/:nombre/detalle-semana', asyncHandler(async (req, res) => {
  // "Seleccionar rango de fecha" (28-09-2026, a pedido del usuario:
  // "detallado por cliente crea 3 botones... semana actual, semana
  // anterior, y seleccionar rango de fecha") — mismo helper y mismo
  // criterio EXACTO que ya usan Balance General/Cierre Final (ver
  // rangoPersonalizadoDeQuery más arriba): si viene ?desde=&hasta=
  // válidos, manda sobre "semana" (que sigue funcionando igual que
  // siempre para "Semana actual"/"Semana anterior").
  const rangoPersonalizado = rangoPersonalizadoDeQuery(req);

  // ÍTEM "REMATE" (26-09-2026, ver la nota grande de construirResumenRemateHipismo
  // en services/hipismoResumenCliente.js) — nunca es una fila real de
  // "jugadores", así que se especial-casa ANTES de buscarlo ahí.
  if (req.params.nombre === NOMBRE_ITEM_REMATE) {
    const resultado = await construirResumenRemateHipismo(req.grupoId, req.grupo, req.query.semana, rangoPersonalizado);
    return res.json(resultado);
  }
  // ÍTEM "WINNERS" (28-09-2026, ver la nota grande de
  // construirResumenWinnersHipismo en services/hipismoResumenCliente.js)
  // — mismo caso que "REMATE" arriba: tampoco es una fila real de
  // "jugadores".
  if (req.params.nombre === NOMBRE_ITEM_WINNERS) {
    const resultado = await construirResumenWinnersHipismo(req.grupoId, req.grupo, req.query.semana, rangoPersonalizado);
    return res.json(resultado);
  }
  // ÍTEM "TABLAS FIJAS" (04-10-2026) — mismo caso que REMATE/WINNERS
  // arriba.
  if (req.params.nombre === NOMBRE_ITEM_TABLAS_FIJAS) {
    const resultado = await construirResumenTablasFijasHipismo(req.grupoId, req.grupo, req.query.semana, rangoPersonalizado);
    return res.json(resultado);
  }

  const rJugador = await db.query(
    'SELECT * FROM jugadores WHERE grupo_id = $1 AND nombre = $2',
    [req.grupoId, req.params.nombre]
  );
  let jugador = rJugador.rows[0];
  // Cuentas del grupo de "Carga Masiva Especial" (% TABLAS Y MARCAS, MARCAS,
  // etc.) que no son una ficha de cliente: igual se pueden abrir desde
  // Cierre Final/Detallado por Cliente, con lo que se les cargó (misma
  // ficha vacía de un cliente sin jugadas propias, solo con sus cargas).
  if (!jugador && esCuentaGrupo(req.params.nombre)) {
    jugador = {
      id: null, grupo_id: req.grupoId, nombre: normalizarNombreCargaEspecial(req.params.nombre), activo: true,
      modulos_anclados: false, es_cuenta_comision: false, comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null
    };
  }
  if (!jugador) return res.status(404).json({ error: 'No se encontró ese cliente.' });

  const resultado = await construirResumenClienteHipismo(jugador, req.grupo, req.query.semana, rangoPersonalizado);
  res.json(resultado);
}));

// =================================================================
// "SEMANA POR DÍAS" (24-09-2026, pestaña nueva en Apuestas) — a pedido
// del usuario: "creá una pestaña en apuestas que diga semana por días...
// allí me mostrás cada cliente con sus totales por días (ej: Ramon
// miércoles +200, jueves -100, viernes +400, total semana +500)". Mismo
// rango lunes-a-domingo y mismo selector de 3 semanas que ya usa Cierre
// Final (mismo bloque de arriba), y las MISMAS 3 fuentes (tickets de
// Tercios, apuestas de Remate, jugadas Adelantadas) — la diferencia es
// que acá se agrupa por (cliente, DÍA) en vez de por cliente solo para
// toda la semana, para poder mostrar una columna por día. El resultado
// de cada día es neto (ganó - perdió ESE día), igual que "Saldos Semana"
// de Deportes (ver services/saldosSemana.js) — mismo patrón, pero sin
// reusar ese archivo porque ahí lee las tablas de Deportes, no las de
// Hipismo.
const DIAS_LARGO_HIPISMO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_CORTO_HIPISMO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function diasDeLaSemanaHipismo(desde, hasta) {
  const dias = diasDelRango(desde, hasta || isoDeFechaUTC(new Date(new Date(desde + 'T00:00:00Z').getTime() + 6 * 24 * 60 * 60 * 1000))).map(fecha => {
    const d = new Date(fecha + 'T00:00:00Z');
    return { fecha, nombre: DIAS_LARGO_HIPISMO[d.getUTCDay()], corta: DIAS_CORTO_HIPISMO[d.getUTCDay()] };
  });
  // Semana de lunes a domingo (la de siempre): 24-09-2026, a pedido del
  // usuario: "cuando hay carreras los lunes el lunes va al lado del domingo"
  // — para MOSTRAR las columnas el lunes se corre al final, pegado al
  // domingo, en vez de encabezar la fila.
  if (dias.length === 7 && dias[0].nombre === 'Lunes') return [...dias.slice(1), dias[0]];
  // Semana configurada en "Fecha de Semana" (05-10-2026): orden cronológico;
  // si dura más de 7 días un día de la semana se repite (Lunes ... Lunes),
  // así que el encabezado lleva también la fecha.
  if (dias.length !== 7) {
    dias.forEach(d => { d.corta = `${d.corta} ${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}`; });
  }
  return dias;
}

router.get('/semana-por-dias', asyncHandler(async (req, res) => {
  await asegurarBanqueoAutomaticoMarcas(req.grupoId);
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = await rangoSemanaGrupo(req.grupoId, hoyVe, offset);
  const esSemanaActual = isoDeFechaUTC(hoyVe) >= desde && isoDeFechaUTC(hoyVe) <= hasta;
  const numeroSemana = numeroSemanaISO(desde);
  const dias = diasDeLaSemanaHipismo(desde, hasta);

  // 28-09-2026, a pedido del usuario ("semana por dias no coincide con
  // el balance general"): se agregan las columnas monto/plano_id/
  // sin_comision/cruza_jugadas (t.*, a.monto, j.monto) que antes NO se
  // seleccionaban acá — son las mismas 3 que usa /cierre-final para "%
  // DEVUELTO", "AJUSTE POR CRUCE" y "TRASPASO DE COMISIÓN" (ver esos 3
  // bloques más abajo). Sin ellas, esta vista día-por-día se quedaba
  // corta contra Cierre Final/Balance General para cualquier cliente con
  // % propio, un plano cruzado, o un traspaso manual de comisión.
  // `p.hipodromo_nombre, p.carrera_numero` (02-10-2026, agregadas SOLO
  // para el neteo jugador/banquero de más abajo — ver la nota grande
  // EXACTA de netearJugadorBanqueroTercios en services/hipismoCalc.js).
  const rTickets = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero, t.monto,
            t.plano_id, t.sin_comision, p.cruza_jugadas, p.fecha, p.hipodromo_nombre, p.carrera_numero
       FROM hipismo_tickets t
       JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  const rApuestasRemate = await db.query(
    `SELECT a.cliente_nombre, a.resultado, a.monto, r.fecha
       FROM hipismo_remate_apuestas a
       JOIN hipismo_remates r ON r.id = a.remate_id
      WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  // p.hipodromo_nombre, j.carrera_numero (02-10-2026, ver la nota grande
  // EXACTA de acumularDevueltoDia más abajo: hacen falta para fusionar por
  // carrera antes de redondear — antes esta consulta no las traía).
  const rAdelantadas = await db.query(
    `SELECT j.cliente_nombre, j.resultado_cliente, j.banqueadores, j.monto, j.gano, j.sin_comision, p.fecha,
            p.hipodromo_nombre, j.carrera_numero
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
    [req.grupoId, desde, hasta]
  );
  // Jugadas entre Tercios Adelantadas (05-10-2026): esta vista nunca las
  // leía -- ni su saldo, ni su comisión, ni su % devuelto (mismo hueco que
  // tenía Cierre Final hasta el 04-10-2026, ver la nota grande de
  // /cierre-final).
  const rTerciosAdelantadasDia = await leerTerciosAdelantadasResueltas(req.grupoId, desde, hasta);
  // "Cargar Winners" (26-09-2026) — misma nota que en /cierre-final:
  // cada fila ya es el resultado neto de ese cliente ese día.
  const rWinners = await db.query(
    `SELECT cliente_nombre, monto, fecha FROM hipismo_winners WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );

  const porCliente = new Map();
  function acumularDia(nombre, fechaFila, resultado) {
    const fechaIso = fechaFila instanceof Date ? isoDeFechaUTC(fechaFila) : fechaFila;
    if (!porCliente.has(nombre)) porCliente.set(nombre, { nombre, porDia: {}, totalSemana: 0 });
    const c = porCliente.get(nombre);
    const n = Number(resultado) || 0;
    c.porDia[fechaIso] = (c.porDia[fechaIso] || 0) + n;
    c.totalSemana += n;
  }
  rTickets.rows.forEach(t => {
    acumularDia(t.cliente_nombre, t.fecha, t.resultado_jugador);
    acumularDia(t.banquero_nombre, t.fecha, t.resultado_banquero);
  });
  rApuestasRemate.rows.forEach(a => acumularDia(a.cliente_nombre, a.fecha, a.resultado));
  rWinners.rows.forEach(w => acumularDia(w.cliente_nombre, w.fecha, w.monto));
  rTerciosAdelantadasDia.forEach(j => {
    acumularDia(j.jugador_nombre, j.fecha, j.resultado_jugador);
    acumularDia(j.banquero_nombre, j.fecha, j.resultado_banquero);
  });
  rAdelantadas.rows.forEach(j => {
    acumularDia(j.cliente_nombre, j.fecha, j.resultado_cliente);
    if (Array.isArray(j.banqueadores)) {
      j.banqueadores.forEach(b => acumularDia(b.nombre, j.fecha, b.monto));
    }
  });

  // "% DEVUELTO" por día (28-09-2026, mismo cálculo que /cierre-final —
  // ver la nota grande de esa ruta): cada cliente con % propio
  // configurado (jugadores.comision_propia) se gana ese % de TODO lo que
  // apostó como JUGADOR (Tercios + Adelantadas — nunca Remate, ver la
  // nota de /cierre-final: "LOS REMATES NO LE PRODUCEN % DE DEVOLUCION A
  // LOS CLIENTES"), atribuido al DÍA de esa jugada puntual.
  // 29-09-2026 (ver la nota grande de /cierre-final): el lado BANQUERO de
  // Tercios ahora también cuenta para el % propio/de aval.
  const nombresJugadores = new Set();
  rTickets.rows.forEach(t => nombresJugadores.add(t.cliente_nombre));
  rTickets.rows.forEach(t => nombresJugadores.add(t.banquero_nombre));
  rApuestasRemate.rows.forEach(a => nombresJugadores.add(a.cliente_nombre));
  rAdelantadas.rows.forEach(j => {
    nombresJugadores.add(j.cliente_nombre);
    if (Array.isArray(j.banqueadores)) j.banqueadores.forEach(b => nombresJugadores.add(b.nombre));
  });
  rTerciosAdelantadasDia.forEach(j => { nombresJugadores.add(j.jugador_nombre); nombresJugadores.add(j.banquero_nombre); });
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, Array.from(nombresJugadores));
  // "COMISIÓN REAL" por día (29-09-2026, mismo pedido/fórmula que
  // /cierre-final — ver la nota grande de esa ruta, "CASO A PARA TODOS
  // LOS RENGLONES"): se necesita, aparte de lo devuelto por CLIENTE (ya
  // acumulado arriba con acumularDia), el TOTAL devuelto de CADA DÍA para
  // restárselo a la comisión de Tercios de ese mismo día más abajo.
  const devueltoPorFecha = {};
  // FUSIONAR POR CARRERA ANTES DE REDONDEAR (02-10-2026, mismo bug y mismo
  // arreglo YA probado en /comisiones-devueltas, /cierre-final y
  // /saldo-comisiones — caso real: Balance General daba $379,65 y debía
  // dar $379,78): cuando un cliente tiene 2+ tickets/jugadas en la MISMA
  // carrera, redondear cada uno por separado y sumar esos redondeos no
  // siempre da lo mismo que sumar los montos EXACTOS de esa carrera y
  // redondear una sola vez. Como toda una carrera ocurre en UN solo día,
  // fusionar por carrera no cambia a qué día se atribuye el % devuelto —
  // solo cambia CUÁNDO se redondea.
  const porGrupoDia = new Map();
  function acumularDevueltoDia(nombre, fechaFila, monto, claveCarrera) {
    const infos = comisionesPropias[nombre];
    if (!infos || !infos.length) return;
    infos.forEach(info => {
      if (!info || !info.pct) return;
      const exacto = Math.abs(Number(monto) || 0) * (info.pct / 100);
      if (!exacto) return;
      const claveGrupo = `${claveCarrera}::${nombre}::${info.destino}::${info.pct}`;
      if (!porGrupoDia.has(claveGrupo)) {
        porGrupoDia.set(claveGrupo, { cuentaNombre: info.cuentaNombre, fechaFila, exacto: 0 });
      }
      porGrupoDia.get(claveGrupo).exacto += exacto;
    });
  }
  // NUNCA una jugada que "no se decidió" (29-09-2026, ver la nota grande
  // EXACTA de /cierre-final) — mismo filtro que /cierre-final y
  // /saldo-comisiones. Number(...) obligatorio -- ver esa misma nota.
  // montoDecidido (02-10-2026, "SIEMPRE ES BASE A LO DECIDIDO SIN SACARLE
  // EL 5%" — ver la nota grande de montoDecidido() en
  // services/hipismoAdelantadasCalc.js): NUNCA t.monto/j.monto.
  const ticketsDecididosDia = rTickets.rows.filter(t => !(Number(t.resultado_jugador) === 0 && Number(t.resultado_banquero) === 0));
  // NETEO jugador/banquero por carrera (02-10-2026, caso GG: ver la nota
  // grande EXACTA de netearJugadorBanqueroTercios en hipismoCalc.js) — un
  // cliente que juega Y banquea en la MISMA carrera (Tercios únicamente)
  // deja de sumar % sobre cada lado por separado y pasa a sumarlo UNA sola
  // vez sobre el NETO de ambos lados en esa carrera, atribuido al día de
  // esa carrera — mismo criterio EXACTO que ya usan /comisiones-devueltas,
  // /cierre-final y /saldo-comisiones.
  const netoPorCarreraDia = netearJugadorBanqueroTercios(ticketsDecididosDia.map(t => ({
    clienteNombre: t.cliente_nombre, banqueroNombre: t.banquero_nombre,
    resultadoJugador: t.resultado_jugador, resultadoBanquero: t.resultado_banquero,
    sinComision: t.sin_comision,
    fecha: t.fecha instanceof Date ? isoDeFechaUTC(t.fecha) : t.fecha,
    hipodromoNombre: t.hipodromo_nombre, carreraNumero: t.carrera_numero
  })));
  const dualAgregadoDia = new Set();
  ticketsDecididosDia.forEach(t => {
    const fechaIso = t.fecha instanceof Date ? isoDeFechaUTC(t.fecha) : t.fecha;
    const claveCarrera = `${fechaIso}::${t.hipodromo_nombre}::${t.carrera_numero}`;
    const infoJugador = netoPorCarreraDia.get(claveCarrera)?.get(t.cliente_nombre);
    const infoBanquero = netoPorCarreraDia.get(claveCarrera)?.get(t.banquero_nombre);
    // 04-10-2026: montoDecididoExacto -> montoBaseComisionExacto -- "a
    // premio" SIN comisión (t.sin_comision, bandera REAL del ticket) no
    // genera % devuelto (ver la nota grande de montoBaseComisionExacto en
    // hipismoAdelantadasCalc.js).
    if (!(infoJugador && infoJugador.dual)) {
      acumularDevueltoDia(t.cliente_nombre, t.fecha, montoBaseComisionExacto(t.resultado_jugador, t.sin_comision), claveCarrera);
    }
    if (!(infoBanquero && infoBanquero.dual)) {
      acumularDevueltoDia(t.banquero_nombre, t.fecha, montoBaseComisionExacto(t.resultado_banquero, t.sin_comision), claveCarrera);
    }
    // netoExacto, no `neto` (02-10-2026, ver la nota grande EXACTA de
    // montoDecididoExacto en hipismoAdelantadasCalc.js) — acumularDevueltoDia()
    // ya no redondea acá, solo fusiona por carrera (ver la nota grande de
    // arriba).
    [t.cliente_nombre, t.banquero_nombre].forEach(nombre => {
      const info = netoPorCarreraDia.get(claveCarrera)?.get(nombre);
      if (!info || !info.dual) return;
      const claveDual = `${claveCarrera}::${nombre}`;
      if (dualAgregadoDia.has(claveDual)) return;
      dualAgregadoDia.add(claveDual);
      acumularDevueltoDia(nombre, t.fecha, info.netoExacto, claveCarrera);
    });
  });
  // claveCarrera con p.hipodromo_nombre/j.carrera_numero (agregadas arriba
  // a rAdelantadas) para poder fusionar con tickets de Tercios de la misma
  // carrera.
  rAdelantadas.rows.filter(j => j.gano !== null && !j.sin_comision).forEach(j => {
    const fechaIsoJ = j.fecha instanceof Date ? isoDeFechaUTC(j.fecha) : j.fecha;
    const claveCarreraJ = `${fechaIsoJ}::${j.hipodromo_nombre}::${j.carrera_numero}`;
    acumularDevueltoDia(j.cliente_nombre, j.fecha, montoDecididoExacto(j.resultado_cliente, true), claveCarreraJ);
  });
  // 29-09-2026 — lado BANQUERO de una Marca (ver la nota grande de
  // /cierre-final): cada banqueador solo banqueó su `porcentaje` de la
  // base DECIDIDA de la jugada completa (|resultado_cliente|), nunca de
  // j.monto (el apostado bruto de la Marca completa).
  rAdelantadas.rows.forEach(j => {
    if (!Array.isArray(j.banqueadores) || j.sin_comision) return; // sin comisión (07-10-2026): no genera % devuelto
    const baseJugada = montoDecididoExacto(j.resultado_cliente, true);
    const fechaIsoJ = j.fecha instanceof Date ? isoDeFechaUTC(j.fecha) : j.fecha;
    const claveCarreraJ = `${fechaIsoJ}::${j.hipodromo_nombre}::${j.carrera_numero}`;
    j.banqueadores.forEach(b => {
      const parte = baseJugada * (Number(b.porcentaje) || 0) / 100;
      acumularDevueltoDia(b.nombre, j.fecha, parte, claveCarreraJ);
    });
  });
  // Jugadas entre Tercios Adelantadas (05-10-2026, ver la nota grande de
  // /cierre-final en services/hipismoResumenCliente.js).
  rTerciosAdelantadasDia.forEach(j => {
    const claveCarreraJ = `${fechaComoISO(j.fecha)}::${j.hipodromo_nombre}::${j.carrera_numero}`;
    if (Number(j.resultado_jugador) !== 0) acumularDevueltoDia(j.jugador_nombre, j.fecha, montoBaseTerciosAdelantadaExacto(j.resultado_jugador, j.comision_porcentaje), claveCarreraJ);
    if (Number(j.resultado_banquero) !== 0) acumularDevueltoDia(j.banquero_nombre, j.fecha, montoBaseTerciosAdelantadaExacto(j.resultado_banquero, j.comision_porcentaje), claveCarreraJ);
  });

  // Recién ahora se redondea UNA vez por (carrera, cliente, destino, %) —
  // ver la nota grande EXACTA de acumularDevueltoDia más arriba — y ese
  // valor ya redondeado es el que se suma al día del cliente destino y a
  // devueltoPorFecha (nunca al revés).
  porGrupoDia.forEach(({ cuentaNombre, fechaFila, exacto }) => {
    const devuelto = round2(exacto);
    if (!devuelto) return;
    const fechaIso = fechaFila instanceof Date ? isoDeFechaUTC(fechaFila) : fechaFila;
    acumularDia(cuentaNombre, fechaFila, devuelto);
    devueltoPorFecha[fechaIso] = round2((devueltoPorFecha[fechaIso] || 0) + devuelto);
  });

  // "AJUSTE POR CRUCE" por día (28-09-2026, mismo bug/arreglo que
  // /cierre-final — ver la nota grande de esa ruta): en un plano con
  // cruza_jugadas=true, cada ticket queda guardado "sin cruzar" línea
  // por línea; se reconstruye el neto cruzado real por plano
  // (calcularAjustesCruce) y se suma la diferencia, atribuida entera al
  // día de ESE plano (todos sus tickets comparten la misma fecha).
  const ticketsPorPlanoCruzadoDia = new Map();
  rTickets.rows.forEach(t => {
    if (!t.cruza_jugadas) return;
    if (!ticketsPorPlanoCruzadoDia.has(t.plano_id)) ticketsPorPlanoCruzadoDia.set(t.plano_id, []);
    ticketsPorPlanoCruzadoDia.get(t.plano_id).push({
      clienteNombre: t.cliente_nombre,
      banqueroNombre: t.banquero_nombre,
      resultadoJugador: Number(t.resultado_jugador),
      resultadoBanquero: Number(t.resultado_banquero),
      sinComision: t.sin_comision,
      fecha: t.fecha
    });
  });
  ticketsPorPlanoCruzadoDia.forEach(ticketsDelPlano => {
    const ajustesCruce = calcularAjustesCruce(ticketsDelPlano);
    const fechaPlano = ticketsDelPlano[0].fecha;
    Object.keys(ajustesCruce).forEach(nombre => {
      const monto = ajustesCruce[nombre];
      if (!monto) return;
      acumularDia(nombre, fechaPlano, monto);
    });
  });

  // "TRASPASO DE COMISIÓN" por día (28-09-2026, ver POST
  // /comisiones/traspaso): a diferencia de /cierre-final, acá NO se
  // reusa obtenerAjustesComision porque esa función agrupa por
  // cliente_nombre del lado del servidor y pierde la fecha de cada fila
  // — se necesita el detalle día-por-día, así que se consulta
  // hipismo_comisiones_ajustes directo, sin GROUP BY.
  const rAjustesComisionDia = await db.query(
    `SELECT cliente_nombre, monto, fecha FROM hipismo_comisiones_ajustes WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  rAjustesComisionDia.rows.forEach(r => acumularDia(r.cliente_nombre, r.fecha, r.monto));
  // CARGA MASIVA ESPECIAL (05-10-2026): cada línea es un movimiento de saldo
  // directo, atribuido al día de su carga.
  (await obtenerCargasEspecialesRango(req.grupoId, desde, hasta)).forEach(l => acumularDia(l.clienteNombre, l.fecha, l.monto));

  // "la tabla va mostrando los dias a medida que vayan cargando y
  // teniendo informacion... si estamos a jueves, no muestres viernes
  // sabado y domingo vacios" (24-09-2026) — se esconden del TODO (thead
  // y cada fila) los días donde NINGÚN cliente tuvo ni jugó ni banqueó
  // nada, sin importar si el día ya pasó o todavía no llegó; el criterio
  // es simplemente "¿hay algo cargado ese día?".
  const todosLosClientes = Array.from(porCliente.values());
  const diasConDatos = dias.filter(d => todosLosClientes.some(c => Math.abs(c.porDia[d.fecha] || 0) > 0.0001));

  // Orden alfabético (a pedido del usuario: "ordenado en orden
  // alfabetico") — mismo criterio de localeCompare('es') que Cierre Final.
  const clientes = todosLosClientes
    .map(c => ({
      nombre: c.nombre,
      porDia: diasConDatos.map(d => round2(c.porDia[d.fecha] || 0)),
      totalSemana: round2(c.totalSemana)
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // "COMISIÓN GRUPO" al pie de la tabla (24-09-2026, a pedido del
  // usuario), AGREGADA POR DÍA para poder mostrar una columna por día
  // igual que el resto de la fila.
  //
  // "COMISIÓN REAL" (29-09-2026, "de la comisión que queda en el grupo
  // debes restar todos los % que se le devuelven a los clientes" —
  // confirmado con "CASO A PARA TODOS LOS RENGLONES, BALANCES, CIERRE
  // FINAL, SALDO POR DÍA, SALDO POR SEMANA"): esta fila se mantiene
  // IGUALADA con Cierre Final/Balance General (ver la nota grande de GET
  // /cierre-final) — el Remate NUNCA entra acá (tiene su propio ítem
  // "REMATE", nunca "comisión" del grupo).
  //
  // "COMISIÓN GRUPO" = TODO, no solo Tercios (02-10-2026, a pedido
  // explícito del usuario verificando contra otro sistema: "se hicieron
  // de comisión 183,55 [bruta, de TODOS los tipos de jugada]... la
  // devolución fue de 77,52... restando eso le queda al grupo 106,02" —
  // ver la nota grande de comisionAdelantadasSemana en GET /cierre-final,
  // donde se hizo el mismo cambio): además de la comisión de Tercios por
  // plano, se suma también la de Tablas Fijas + Marcas de Jugadas
  // Adelantadas (j.comision), ya que "% DE TABLAS FIJAS"/"PORCENTAJE
  // MARCAS" dejaron de armarse como su propio renglón de "cliente" acá
  // (esta pantalla nunca los armó como fila, a diferencia de Cierre Final
  // — pero si no se suman en algún lado, esa plata se pierde del total).
  const rComisionPlanos = await db.query(
    `SELECT fecha, COALESCE(SUM(comision_total), 0) AS total
       FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 GROUP BY fecha`,
    [req.grupoId, desde, hasta]
  );
  const comisionBrutaPorFecha = {};
  rComisionPlanos.rows.forEach(r => {
    const fechaIso = r.fecha instanceof Date ? isoDeFechaUTC(r.fecha) : r.fecha;
    comisionBrutaPorFecha[fechaIso] = round2((comisionBrutaPorFecha[fechaIso] || 0) + Number(r.total));
  });
  const rComisionAdelantadas = await db.query(
    `SELECT p.fecha AS fecha, j.comision
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
    [req.grupoId, desde, hasta]
  );
  rComisionAdelantadas.rows.forEach(r => {
    if (r.comision == null) return;
    const fechaIso = r.fecha instanceof Date ? isoDeFechaUTC(r.fecha) : r.fecha;
    comisionBrutaPorFecha[fechaIso] = round2((comisionBrutaPorFecha[fechaIso] || 0) + Number(r.comision));
  });
  rTerciosAdelantadasDia.forEach(j => {
    if (!j.comision_grupo) return;
    const fechaIso = j.fecha instanceof Date ? isoDeFechaUTC(j.fecha) : j.fecha;
    comisionBrutaPorFecha[fechaIso] = round2((comisionBrutaPorFecha[fechaIso] || 0) + Number(j.comision_grupo));
  });
  const comisionPorDia = diasConDatos.map(d => round2((comisionBrutaPorFecha[d.fecha] || 0) - (devueltoPorFecha[d.fecha] || 0)));
  // comisionSemana se saca de los totales COMPLETOS (todas las fechas del
  // rango con comisión bruta o devuelto, no solo las de diasConDatos) para
  // que el total no dependa de qué días termina mostrando la tabla.
  const todasLasFechasConComision = new Set([...Object.keys(comisionBrutaPorFecha), ...Object.keys(devueltoPorFecha)]);
  const comisionSemana = round2(Array.from(todasLasFechasConComision)
    .reduce((acc, fechaIso) => acc + (comisionBrutaPorFecha[fechaIso] || 0) - (devueltoPorFecha[fechaIso] || 0), 0));

  res.json({ rango: { desde, hasta }, numeroSemana, esSemanaActual, dias: diasConDatos, clientes, comisionPorDia, comisionSemana });
}));

// =================================================================
// "ELIMINAR JORNADA" (24-09-2026, Administración) — a pedido del usuario:
// "crea un boton que diga eliminar jornada.... al seleccionar un dia
// borra todo lo que este ese dia, todas las jugadas, remate, ganadores,
// jugadas entre tercios, todo absolutamente todo del dia". Es un borrado
// MUCHO más grande que "Eliminar Planos" (que borra un plano de Tercios
// a la vez, con papelera recuperable de 30 días): acá se borra, de UNA
// fecha completa, TODO lo de Hipismo de un solo golpe — Tercios
// (hipismo_planos, cascada a hipismo_tickets), Remate (hipismo_remates,
// cascada a hipismo_remate_apuestas) y Jugadas Adelantadas
// (hipismo_adelantadas_planos, cascada a hipismo_adelantadas_jugadas —
// las 3 tablas "cabecera" tienen ON DELETE CASCADE hacia sus tablas de
// detalle, ver sql/schema.sql, así que basta con borrar las 3 cabeceras).
//
// Se le preguntó al usuario si esto debía ser recuperable (papelera,
// mismo criterio que "Eliminar Planos") o permanente. Respuesta textual:
// "PIDEME LA CLAVE DE ACCESO PARA VERIFICAR QUE QUIERO ELIMINARLO, AL
// ELIMINARLO SE BORRA PARA SIEMPRE" — o sea: PERMANENTE (sin papelera,
// nada que restaurar después), pero protegido con una re-autenticación:
// se le vuelve a pedir su propia contraseña de sesión (la del
// Administrador, o la del Empleado si es quien está logueado) y se
// valida contra su password_hash real (bcrypt.compare, exactamente el
// mismo mecanismo que ya usa POST /api/auth/login) antes de borrar nada
// — no es un PIN nuevo ni compartido entre todos, es la clave real de
// quien está pidiendo el borrado. Si la clave no es la correcta, no se
// borra nada (401) y no se genera ninguna alerta.
//
// Genera una alerta (tipo JORNADA_ELIMINADA — ver el ALTER que amplía el
// check de hipismo_alertas.tipo en sql/schema.sql) con el detalle de
// cuánto se borró, mismo criterio que "Eliminar Planos".
async function verificarClaveAccesoActor(req, password) {
  if (!password) return false;
  const tabla = req.rol === 'empleado' ? 'empleados' : 'grupos';
  const id = req.rol === 'empleado' ? req.empleadoId : req.grupoId;
  const r = await db.query(`SELECT password_hash FROM ${tabla} WHERE id = $1`, [id]);
  if (!r.rows.length || !r.rows[0].password_hash) return false;
  return bcrypt.compare(password, r.rows[0].password_hash);
}

// GET /jornada/resumen?fecha=YYYY-MM-DD — cuenta cuánto hay ANTES de
// pedir la clave, para que el operador vea bien qué está por borrar
// ("vas a borrar 4 planos, 1 remate y 2 jugadas adelantadas de ese día")
// antes de confirmar.
router.get('/jornada/resumen', asyncHandler(async (req, res) => {
  const fecha = req.query.fecha;
  if (!fecha) return res.status(400).json({ error: 'Falta la fecha.' });
  const [rPlanos, rRemates, rAdelantadas] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS n, COALESCE(array_agg(DISTINCT hipodromo_nombre), ARRAY[]::text[]) AS hipodromos FROM hipismo_planos WHERE grupo_id = $1 AND fecha = $2', [req.grupoId, fecha]),
    db.query('SELECT COUNT(*)::int AS n FROM hipismo_remates WHERE grupo_id = $1 AND fecha = $2', [req.grupoId, fecha]),
    db.query('SELECT COUNT(*)::int AS n FROM hipismo_adelantadas_planos WHERE grupo_id = $1 AND fecha = $2', [req.grupoId, fecha])
  ]);
  const planos = rPlanos.rows[0].n, remates = rRemates.rows[0].n, adelantadas = rAdelantadas.rows[0].n;
  res.json({
    fecha,
    planos, remates, adelantadas,
    hipodromos: rPlanos.rows[0].hipodromos,
    vacio: planos === 0 && remates === 0 && adelantadas === 0
  });
}));

// POST /jornada/eliminar — body: { fecha, password }. Borra TODO
// (Tercios + Remate + Jugadas Adelantadas) de esa fecha, de forma
// PERMANENTE (sin papelera), solo si `password` coincide con la clave
// real de quien está logueado ahora mismo.
router.post('/jornada/eliminar', asyncHandler(async (req, res) => {
  const { fecha, password } = req.body;
  if (!fecha) return res.status(400).json({ error: 'Falta la fecha.' });
  const claveOk = await verificarClaveAccesoActor(req, password);
  if (!claveOk) return res.status(401).json({ error: 'Clave incorrecta — no se borró nada.' });

  const resultado = await db.transaccion(async (client) => {
    const rPlanos = await client.query('DELETE FROM hipismo_planos WHERE grupo_id = $1 AND fecha = $2 RETURNING id', [req.grupoId, fecha]);
    const rRemates = await client.query('DELETE FROM hipismo_remates WHERE grupo_id = $1 AND fecha = $2 RETURNING id', [req.grupoId, fecha]);
    const rAdelantadas = await client.query('DELETE FROM hipismo_adelantadas_planos WHERE grupo_id = $1 AND fecha = $2 RETURNING id', [req.grupoId, fecha]);
    return { planos: rPlanos.rows.length, remates: rRemates.rows.length, adelantadas: rAdelantadas.rows.length };
  });

  await registrarAlerta(req, {
    tipo: 'JORNADA_ELIMINADA',
    fecha,
    mensaje: `Eliminó TODA la jornada del ${fecha}: ${resultado.planos} plano(s) de Tercios, ${resultado.remates} remate(s) y ${resultado.adelantadas} plano(s) de Jugadas Adelantadas — borrado permanente, sin papelera.`
  });

  res.json({ ok: true, fecha, ...resultado });
}));

// =================================================================
// CHAT DE SOPORTE (con el Súper-admin) — ver chat.js y la nota grande
// junto al require de chatService más arriba. Esta ruta NO agrega su
// propio chequeo de permiso: el router.use(requierePermiso('hipismo')) de
// arriba ya exige, para CUALQUIER ruta de este archivo, que la sesión sea
// el Administrador o un Empleado con el permiso 'hipismo' — exactamente
// el mismo criterio que ya protege /api/sabana/chat con 'alertas' del
// lado de Deportes, solo que con el permiso de este módulo.
// =================================================================
router.get('/chat', asyncHandler(async (req, res) => {
  const mensajes = await chatService.listarMensajes(req.grupoId);
  res.json(mensajes);
}));

router.post('/chat', asyncHandler(async (req, res) => {
  try {
    const mensaje = await chatService.enviarMensaje(req.grupoId, 'grupo', req.body.texto, req.body.adjunto);
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
