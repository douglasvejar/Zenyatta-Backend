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
const { requiereGrupo, requierePermiso } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
// numeroSemanaISO (23-09-2026, duodécima-tercera ronda, a pedido del
// usuario: "en balance general al ver los saldos y en cierre final
// colocame arriba la fecha que este comprendida la semana es decir del
// 15-08 al 22-08 por ejemplo, y semana xxx... que seria la semana del
// año en la que estamos") — MISMO cálculo de "número de semana del año"
// que ya usa Deportes en "📅 Saldos Semana" (ver services/fechaSemana.js,
// convención ISO-8601), reusado tal cual en vez de reinventarlo acá.
const { numeroSemanaISO } = require('../services/fechaSemana');
const {
  calcularPlano, armarTextoResultado, PIE_PLANO_DEFECTO,
  parsearPizarra, recalcularTicket, recalcularTotalesPlano, armarSalidaLineasDeTickets,
  parsearValoresSinComision
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
  resolverClienteMarca, resolverBanqueoMarca, armarBloqueAdelantadas, round2
} = require('../services/hipismoAdelantadasCalc');
// autoRegistrarJugadores (22-09-2026, a pedido del usuario: "al hacer un
// plano el cliente debe crearse automatico, despues el empleado debera
// ver si le coloca % o no") — es la MISMA función que ya usa Deportes
// al procesar una sábana (services/procesarSabana.js), reusada tal cual
// sobre la MISMA tabla "jugadores" compartida entre los 2 módulos (ver
// claude/plan-modulo-hipismo.md: "Jugadores... siguen siendo UNA sola
// tabla/pantalla compartida"). Da de alta con auto_creado=true,
// tipo_cuenta='libre', comisión 0% — el empleado decide después, desde
// Administración > Jugador, si le carga un % propio o lo deja así.
const { autoRegistrarJugadores } = require('../services/procesarSabana');
// "Eliminar Planos" — papelera recuperable (23-09-2026, a pedido del
// usuario: "en apuestas crea un boton de eliminar planos"). Ver la nota
// grande en services/hipismoPlanosPapelera.js — mismo criterio ya usado
// para la sábana de Deportes (papelera recuperable, nunca borrado
// definitivo, para un sistema contable).
const hipismoPlanosPapelera = require('../services/hipismoPlanosPapelera');
// construirResumenClienteHipismo (24-09-2026) — la nueva pestaña "Saldos >
// Detallado por Cliente" pide EXACTAMENTE la misma respuesta que ya arma
// GET /api/hipismo-cliente/:token (el portal público) para un cliente
// puntual, buscado por nombre en vez de por token — ver
// GET /clientes/:nombre/detalle-semana más abajo y la nota grande en
// services/hipismoResumenCliente.js.
const { construirResumenClienteHipismo } = require('../services/hipismoResumenCliente');

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
async function buscarAdelantadasPendientes(req, { hipodromoNombre, carreraNumero, fecha }) {
  const r = await db.query(
    `SELECT j.* FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.hipodromo_nombre = $2 AND j.carrera_numero = $3 AND p.fecha = $4
        AND j.estado = 'pendiente'
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

// Calcula (SIN guardar nada) cómo quedarían las jugadas adelantadas
// pendientes de una carrera contra una pizarra — lo usan tanto la vista
// previa (POST /planos/calcular) como, con persistencia aparte (ver
// guardarResolucionAdelantadas), POST /planos.
async function calcularResolucionAdelantadas(req, { hipodromoNombre, carreraNumero, fecha, pizarra }) {
  const pendientes = await buscarAdelantadasPendientes(req, { hipodromoNombre, carreraNumero, fecha });
  if (!pendientes.length) return { resueltas: [], movimientosParaTexto: [] };

  const rHip = await db.query('SELECT pais FROM hipismo_hipodromos WHERE grupo_id = $1 AND nombre = $2', [req.grupoId, hipodromoNombre]);
  const esNacional = rHip.rows.length ? rHip.rows[0].pais !== 'US' : true;
  const rank = parsearPizarraRank(pizarra);

  const resueltas = pendientes.map(j => {
    if (j.tipo === 'tf') {
      const r = resolverTablaFija(
        { numeroEjemplar: j.numero_ejemplar, monto: Number(j.monto), gananciaPotencial: Number(j.ganancia_potencial) },
        rank, Number(j.comision_porcentaje)
      );
      return {
        id: j.id, cliente: j.cliente_nombre, tipo: 'tf', estadoNuevo: 'resuelto', monto: Number(j.monto),
        gano: r.gano, resultadoCliente: r.resultadoCliente, comision: r.comision,
        movimientos: [{ nombre: j.cliente_nombre, monto: r.resultadoCliente }, { nombre: 'TABLAS FIJAS', monto: r.tablasFijas }]
      };
    }
    // Marca
    if (!esMarcaDecidible(pizarra, esNacional)) {
      return { id: j.id, cliente: j.cliente_nombre, tipo: 'marca', estadoNuevo: 'sin_decidir', monto: Number(j.monto), gano: null, resultadoCliente: 0, comision: 0, movimientos: [] };
    }
    const c = resolverClienteMarca({ numero1: j.numero1, numero2: j.numero2, monto: Number(j.monto) }, rank);
    return {
      id: j.id, cliente: j.cliente_nombre, tipo: 'marca', estadoNuevo: 'falta_banqueo', monto: Number(j.monto),
      gano: c.acierta, resultadoCliente: c.resultadoCliente, comision: null,
      movimientos: [{ nombre: j.cliente_nombre, monto: c.resultadoCliente }]
    };
  });

  const movimientosParaTexto = [];
  resueltas.forEach(r => movimientosParaTexto.push(...r.movimientos));
  return { resueltas, movimientosParaTexto };
}

// Persiste la resolución ya calculada arriba — SOLO la llama POST /planos
// (guardar de verdad), nunca /planos/calcular (vista previa).
async function guardarResolucionAdelantadas(client, req, resueltas, pizarra) {
  for (const r of resueltas) {
    await client.query(
      `UPDATE hipismo_adelantadas_jugadas
          SET estado = $1, gano = $2, resultado_cliente = $3, comision = $4, pizarra_usada = $5, resuelto_en = now()
        WHERE id = $6 AND grupo_id = $7`,
      [r.estadoNuevo, r.gano, r.resultadoCliente, r.comision, pizarra, r.id, req.grupoId]
    );
  }
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

    if (r.tipo === 'tf') {
      totales['TABLAS FIJAS'] = round2((totales['TABLAS FIJAS'] || 0) - r.resultadoCliente);
      if (r.comision) {
        totales['% DE TABLAS FIJAS'] = round2((totales['% DE TABLAS FIJAS'] || 0) + r.comision);
        comision = round2(comision + r.comision);
      }
    }
  });

  return { totales, comision };
}

// =================================================================
// "% DEVUELTO" POR CLIENTE (23-09-2026, undécima ronda) — a pedido del
// usuario, con un ejemplo numérico exacto: "si alguno de lo que pierde
// lleva comision o %... el cliente siempre va a jugar: si pierde pierde
// completo, si gana, gana -5%.... y APARTE en un item llama (nombre del
// cliente - porcentaje) alli es donde vas a colocar ese porcentaje que se
// va ganando el cliente carrera a carrera... supongamo... pedro tiene 1%
// de porcentaje entonces pedro jugo 100 y los pierde, en el plano... va a
// salir pedro -100, en el balance... esa carrera pedro -100 pero en el
// item pedro - porcentaje le va a salir en esa carrera +1".
//
// Reusa jugadores.comision_propia — el MISMO campo que ya usa Deportes
// para esto (ver services/comisiones.js: "% que gana sobre lo que ÉL
// arriesga"), compartido entre los 2 módulos en la misma tabla — nunca se
// aplica en el resultado normal del cliente (que siempre queda "pierde
// completo"/"gana -5%" tal cual, sin ajustar), sino en su propio ítem
// "{NOMBRE} - PORCENTAJE", siempre positivo (1% de lo que jugó, gane o
// pierda esa jugada puntual).
//
// REDIRECCIÓN AL AVAL (23-09-2026, duodécima-tercera ronda, a pedido del
// usuario: "en la pestaña clientes... si el porcentaje que se le
// devuelve no es para el si no para su aval, cuanto se le da de %"). Ver
// la nota grande en sql/schema.sql, columnas jugadores.avalado_por_id/
// porcentaje_devuelto_destino, y por qué esto NO reusa la tabla "avales"
// existente (concepto totalmente distinto, ver
// src/routes/jugadores.js). Cada nombre ahora resuelve a { pct, destino }
// — `destino` es el nombre del AVAL cuando porcentaje_devuelto_destino
// = 'aval' Y el aval está configurado; si no, es el mismo cliente (el
// comportamiento de siempre). El ítem "{destino} - PORCENTAJE" es a
// donde se acredita la plata; el cliente que lo GENERÓ (`nombre`) nunca
// se pierde — lo sigue mostrando GET /comisiones-devueltas tal cual
// (agrupado por quien apostó, no por quien cobra), a propósito, para que
// se pueda auditar "quién generó cuánto" aparte de "a quién se le pagó".
//
// ACTUALIZACIÓN 24-09-2026 ("hay clientes que generan % para el mismo y
// aparte le generan % a su avalador....." — confirmado por
// AskUserQuestion: "Dos % independientes y simultáneos"): cada cliente
// puede ahora generar HASTA 2 créditos de "% devuelto" a la vez sobre el
// MISMO monto apostado, así que el valor de este mapa pasó de ser un
// solo { pct, destino } a ser un ARREGLO de ellos (puede venir vacío,
// con 1, o con 2 entradas) — ver jugadores.porcentaje_devuelto_aval en
// la nota grande de sql/schema.sql, que es 100% independiente y no toca
// para nada comision_propia/porcentaje_devuelto_destino de siempre.
async function obtenerComisionesPropias(grupoId, nombres) {
  const unicos = Array.from(new Set((nombres || []).filter(Boolean)));
  if (!unicos.length) return {};
  // cc_propio/cc_aval (26-09-2026): la cuenta de comisión REAL de cada
  // posible destino (jugadores.cuenta_comision_id, ver la nota grande en
  // sql/schema.sql) — si ya existe (se crea sola al confirmar un Plano/
  // Remate, ver asegurarCuentasComisionParaNombres más abajo), su NOMBRE
  // ACTUAL manda sobre el texto armado a mano, así que renombrarla desde
  // Administración > Clientes se refleja acá para siempre.
  const r = await db.query(
    `SELECT j.nombre, j.comision_propia, j.porcentaje_devuelto_destino, j.porcentaje_devuelto_aval, av.nombre AS aval_nombre,
            cc_propio.nombre AS cc_propio_nombre, cc_aval.nombre AS cc_aval_nombre
       FROM jugadores j
       LEFT JOIN jugadores av ON av.id = j.avalado_por_id
       LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id
       LEFT JOIN jugadores cc_aval ON cc_aval.id = av.cuenta_comision_id
      WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])`,
    [grupoId, unicos]
  );
  const mapa = {};
  r.rows.forEach(j => {
    const entradas = [];
    // Entrada 1: la de siempre — comision_propia, para el cliente o para
    // su aval según porcentaje_devuelto_destino (sin cambios).
    const pctPropio = Number(j.comision_propia) || 0;
    if (pctPropio) {
      const usaAval = j.porcentaje_devuelto_destino === 'aval' && j.aval_nombre;
      const destino = usaAval ? j.aval_nombre : j.nombre;
      const cuentaNombre = (usaAval ? j.cc_aval_nombre : j.cc_propio_nombre) || `${destino} - PORCENTAJE`;
      entradas.push({ pct: pctPropio, destino, cuentaNombre, esAvalAdicional: false });
    }
    // Entrada 2 (NUEVA): porcentaje_devuelto_aval, siempre y cuando este
    // cliente tenga un aval configurado — INDEPENDIENTE y SIMULTÁNEA a
    // la de arriba, con su propio %, siempre acreditada al aval (nunca
    // al propio cliente — para eso ya está la entrada 1 con destino
    // ='cliente').
    const pctAval = Number(j.porcentaje_devuelto_aval) || 0;
    if (pctAval && j.aval_nombre) {
      const destino = j.aval_nombre;
      const cuentaNombre = j.cc_aval_nombre || `${destino} - PORCENTAJE`;
      entradas.push({ pct: pctAval, destino, cuentaNombre, esAvalAdicional: true });
    }
    mapa[j.nombre] = entradas;
  });
  return mapa;
}

// Crea (si hace falta) la cuenta de comisión REAL de `jugadorId` y la
// enlaza en jugadores.cuenta_comision_id — nombrada igual que el texto
// de siempre ("{nombreBase} - PORCENTAJE"), marcada es_cuenta_comision
// para que Cargar Planos/Remates no la ofrezcan como "quién apostó". El
// ON CONFLICT cubre 2 confirmaciones casi simultáneas para el mismo
// cliente sin crear 2 cuentas.
async function crearYLinkearCuentaComision(grupoId, jugadorId, nombreBase) {
  const nombreCuenta = `${nombreBase} - PORCENTAJE`;
  const rCuenta = await db.query(
    `INSERT INTO jugadores (grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial, es_cuenta_comision)
     VALUES ($1, $2, true, true, 'libre', 0, true)
     ON CONFLICT (grupo_id, nombre) DO UPDATE SET es_cuenta_comision = true
     RETURNING id`,
    [grupoId, nombreCuenta]
  );
  const cuentaId = rCuenta.rows[0].id;
  await db.query(
    `UPDATE jugadores SET cuenta_comision_id = $1 WHERE id = $2 AND grupo_id = $3 AND cuenta_comision_id IS NULL`,
    [cuentaId, jugadorId, grupoId]
  );
}

// Se llama SOLO al GUARDAR de verdad un Plano o un Remate (nunca en la
// vista previa de "Calcular", para no crear cuentas de cálculos que el
// operador después no confirma) — antes de leer obtenerComisionesPropias
// para el guardado real, se asegura de que cada jugador (o su aval) que
// vaya a generar comisión YA tenga su cuenta de comisión real enlazada.
async function asegurarCuentasComisionParaNombres(grupoId, nombres) {
  const unicos = Array.from(new Set((nombres || []).filter(Boolean)));
  if (!unicos.length) return;
  const r = await db.query(
    `SELECT j.id, j.nombre, j.comision_propia, j.porcentaje_devuelto_destino, j.porcentaje_devuelto_aval, j.cuenta_comision_id,
            av.id AS aval_id, av.nombre AS aval_nombre, av.cuenta_comision_id AS aval_cuenta_comision_id
       FROM jugadores j
       LEFT JOIN jugadores av ON av.id = j.avalado_por_id
      WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])`,
    [grupoId, unicos]
  );
  for (const j of r.rows) {
    const pctPropio = Number(j.comision_propia) || 0;
    const pctAval = Number(j.porcentaje_devuelto_aval) || 0;
    if (pctPropio) {
      const usaAval = j.porcentaje_devuelto_destino === 'aval' && j.aval_id;
      if (usaAval) {
        if (!j.aval_cuenta_comision_id) await crearYLinkearCuentaComision(grupoId, j.aval_id, j.aval_nombre);
      } else if (!j.cuenta_comision_id) {
        await crearYLinkearCuentaComision(grupoId, j.id, j.nombre);
      }
    }
    if (pctAval && j.aval_id && !j.aval_cuenta_comision_id) {
      await crearYLinkearCuentaComision(grupoId, j.aval_id, j.aval_nombre);
    }
  }
}

// Acumula en `totales` el ítem "{destino} - PORCENTAJE" de cada entrada
// { nombre, monto } (el monto APOSTADO de esa línea puntual, nunca el
// resultado) cuyo cliente tenga % propio y/o % de aval configurado (> 0)
// — `destino` es el propio cliente, su aval "de siempre" (destino=
// 'aval'), o su aval por el % ADICIONAL nuevo — pueden ser 2 ítems
// distintos a la vez para el mismo cliente (ver la nota grande de
// obtenerComisionesPropias). Muta `totales` en el lugar (mismo criterio
// que el resto de los merges de Balance General de este archivo).
function agregarPorcentajeDevuelto(totales, comisionesPropias, entradas) {
  (entradas || []).forEach(({ nombre, monto }) => {
    const infos = comisionesPropias[nombre];
    if (!infos || !infos.length) return;
    infos.forEach(info => {
      if (!info || !info.pct) return;
      const devuelto = round2(Math.abs(Number(monto) || 0) * (info.pct / 100));
      if (!devuelto) return;
      // 26-09-2026: info.cuentaNombre YA es el nombre final a mostrar
      // (el de la cuenta de comisión real si ya existe, o el texto de
      // siempre como vista previa — ver la nota grande de
      // obtenerComisionesPropias más arriba); info.destino en cambio es
      // el nombre "pelado" del cliente/aval, usado solo para AUDITAR
      // quién generó el % en los otros reportes.
      const clave = info.cuentaNombre;
      totales[clave] = round2((totales[clave] || 0) + devuelto);
    });
  });
}

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
    ? await calcularResolucionAdelantadas(req, { hipodromoNombre, carreraNumero, fecha: fechaFinal, pizarra })
    : { resueltas: [], movimientosParaTexto: [] };

  const huboTexto = !!(texto && texto.trim());
  if (!huboTexto && resueltas.length === 0) {
    return res.status(400).json({ error: 'Falta el texto del plano.' });
  }

  const resultado = huboTexto
    ? calcularPlano({ texto, pizarra, cruzar: !!cruzaJugadas, valoresSinComision: parsearValoresSinComision(valoresSinComision) })
    : { huboLineas: false, salidaLineas: [], sinReconocer: [], tickets: [], totalesFinales: {}, comisionTotal: 0 };
  if (huboTexto && !resultado.huboLineas) {
    return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto — revisa el formato de las líneas.' });
  }

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

  // 23-09-2026, a pedido del usuario ("un item llama pedro - porcentaje
  // alli es donde vas a colocar ese porcentaje que se va ganando el
  // cliente carrera a carrera"): se calcula sobre lo APOSTADO en esta
  // carrera puntual (tickets de Tercios, lado jugador, + el monto de las
  // adelantadas que se resolvieron acá) para cualquier cliente con % propio
  // configurado (jugadores.comision_propia) — nunca toca el resultado
  // normal del cliente, solo agrega su propio ítem aparte.
  const entradasApostadas = resultado.tickets.map(t => ({ nombre: t.clienteNombre, monto: t.monto }))
    .concat(resueltas.map(r => ({ nombre: r.cliente, monto: r.monto })));
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, entradasApostadas.map(e => e.nombre));
  agregarPorcentajeDevuelto(balance.totales, comisionesPropias, entradasApostadas);

  res.json({
    textoResultado,
    totalesFinales: balance.totales,
    comisionTotal: balance.comision,
    sinReconocer: resultado.sinReconocer,
    cantidadTickets: resultado.tickets.length,
    adelantadasResueltas: resueltas.map(r => ({ cliente: r.cliente, tipo: r.tipo, estado: r.estadoNuevo, gano: r.gano, resultadoCliente: r.resultadoCliente }))
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

  // Jugadas Adelantadas pendientes de ESTA MISMA carrera (ver la nota
  // grande arriba) — se resuelven con la pizarra que se está por guardar
  // acá, existan o no líneas normales de Tercios en este plano.
  const { resueltas, movimientosParaTexto } = await calcularResolucionAdelantadas(req, { hipodromoNombre: nombreHipodromoFinal, carreraNumero, fecha: fechaFinal, pizarra });

  // 23-09-2026, a pedido del usuario ("si llega a quedar alguna jugada
  // adelantada... sin nada... en darle a cargar así no pegue nada, jale
  // la jugada adelantada"): un plano sin texto YA NO es un error si hay
  // adelantadas pendientes de esa carrera — sirve para resolverlas solas
  // aunque nadie haya jugado nada "en vivo" en esa carrera puntual.
  const huboTexto = !!(texto && texto.trim());
  if (!huboTexto && resueltas.length === 0) {
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
  await autoRegistrarJugadores(req.grupoId, Array.from(nombresDelPlano), {});

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
    return planoCreado;
  });

  const balance = mezclarAdelantadasEnBalance(resultado.totalesFinales, resultado.comisionTotal, resueltas);

  // Ver la nota grande en POST /planos/calcular — mismo cálculo de "%
  // devuelto" acá, sobre lo que de verdad se guardó en este plano. A
  // diferencia de la vista previa, ACÁ SÍ se asegura la cuenta de
  // comisión real de cada destino ANTES de leer obtenerComisionesPropias
  // (26-09-2026, ver la nota grande de esa función) — recién cuando el
  // plano se guarda de verdad, nunca en un "Calcular" que el operador
  // después no confirma.
  const entradasApostadas = resultado.tickets.map(t => ({ nombre: t.clienteNombre, monto: t.monto }))
    .concat(resueltas.map(r => ({ nombre: r.cliente, monto: r.monto })));
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
    adelantadasResueltas: resueltas.map(r => ({ cliente: r.cliente, tipo: r.tipo, estado: r.estadoNuevo, gano: r.gano, resultadoCliente: r.resultadoCliente }))
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

  const clienteFinal = ((clienteNombre || ticket.cliente_nombre) + '').trim().toUpperCase();
  const banqueroFinal = ((banqueroNombre || ticket.banquero_nombre) + '').trim().toUpperCase();
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
  if (nombresNuevos.length) await autoRegistrarJugadores(req.grupoId, nombresNuevos, {});

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

  await autoRegistrarJugadores(req.grupoId, Array.from(new Set(jugadas.map(j => j.cliente))), {});

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

  res.status(201).json({ plano, cantidadJugadas: jugadas.length, sinReconocer });
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
  if (jugada.estado !== 'falta_banqueo') return res.status(400).json({ error: `Esta jugada está en estado "${jugada.estado}", no "falta_banqueo" — no se puede banquear (dos veces) o todavía no tiene resultado.` });

  const comisionPctDefecto = comisionPorcentaje !== undefined && comisionPorcentaje !== null && comisionPorcentaje !== '' && !isNaN(Number(comisionPorcentaje))
    ? Number(comisionPorcentaje) : Number(jugada.comision_porcentaje);

  const { banqueadores: banqueadoresResueltos, comisionMarcas } = resolverBanqueoMarca(
    { acierta: jugada.gano, base: jugada.gano ? Number(jugada.resultado_cliente) : Number(jugada.monto) },
    banqueadores, comisionPctDefecto
  );

  await autoRegistrarJugadores(req.grupoId, banqueadoresResueltos.map(b => b.nombre), {});

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
  const { cliente, monto, numeroEjemplar, numero1, numero2 } = req.body;

  const rJugada = await db.query(
    `SELECT j.*, p.hipodromo_nombre, p.fecha
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.id = $1 AND j.grupo_id = $2`,
    [req.params.id, req.grupoId]
  );
  const jugada = rJugada.rows[0];
  if (!jugada) return res.status(404).json({ error: 'Jugada adelantada no encontrada.' });

  const clienteFinal = ((cliente || jugada.cliente_nombre) + '').trim().toUpperCase();
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

  if (clienteFinal !== jugada.cliente_nombre) await autoRegistrarJugadores(req.grupoId, [clienteFinal], {});

  let recalculo = { estado: jugada.estado, gano: jugada.gano, resultadoCliente: jugada.resultado_cliente, comision: jugada.comision, banqueadores: jugada.banqueadores };
  if (jugada.pizarra_usada && jugada.estado !== 'sin_decidir') {
    const rank = parsearPizarraRank(jugada.pizarra_usada);
    if (jugada.tipo === 'tf') {
      const r = resolverTablaFija(
        { numeroEjemplar: numeroEjemplarFinal, monto: montoFinal, gananciaPotencial: Number(jugada.ganancia_potencial) },
        rank, Number(jugada.comision_porcentaje)
      );
      recalculo = { estado: 'resuelto', gano: r.gano, resultadoCliente: r.resultadoCliente, comision: r.comision, banqueadores: jugada.banqueadores };
    } else {
      const c = resolverClienteMarca({ numero1: numero1Final, numero2: numero2Final, monto: montoFinal }, rank);
      if (jugada.banqueadores) {
        const banqueadoresPrevios = typeof jugada.banqueadores === 'string' ? JSON.parse(jugada.banqueadores) : jugada.banqueadores;
        const base = c.acierta ? c.resultadoCliente : montoFinal;
        const { banqueadores, comisionMarcas } = resolverBanqueoMarca({ acierta: c.acierta, base }, banqueadoresPrevios, Number(jugada.comision_porcentaje));
        recalculo = { estado: 'resuelto', gano: c.acierta, resultadoCliente: c.resultadoCliente, comision: comisionMarcas, banqueadores: JSON.stringify(banqueadores) };
      } else {
        recalculo = { estado: 'falta_banqueo', gano: c.acierta, resultadoCliente: c.resultadoCliente, comision: null, banqueadores: null };
      }
    }
  }

  const r = await db.query(
    `UPDATE hipismo_adelantadas_jugadas
        SET cliente_nombre = $1, monto = $2, numero_ejemplar = $3, numero1 = $4, numero2 = $5,
            estado = $6, gano = $7, resultado_cliente = $8, comision = $9, banqueadores = $10
      WHERE id = $11 AND grupo_id = $12 RETURNING *`,
    [clienteFinal, montoFinal, numeroEjemplarFinal, numero1Final, numero2Final,
      recalculo.estado, recalculo.gano, recalculo.resultadoCliente, recalculo.comision, recalculo.banqueadores,
      jugada.id, req.grupoId]
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

// POST /remates/calcular: calcula SIN guardar — para revisar el remate
// (y, si hace falta, cargar la llegada a mano) antes de decidir guardarlo.
router.post('/remates/calcular', asyncHandler(async (req, res) => {
  const { texto, hipodromoNombre, carreraNumero, fecha, comisionPorcentaje, pizarra } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Falta el texto del remate.' });
  if (!hipodromoNombre) return res.status(400).json({ error: 'Falta el hipódromo.' });
  if (!carreraNumero) return res.status(400).json({ error: 'Falta el número de carrera.' });
  if (comisionPorcentaje === undefined || comisionPorcentaje === null || comisionPorcentaje === '' || isNaN(Number(comisionPorcentaje))) {
    return res.status(400).json({ error: 'Falta el % de comisión de este remate (no todos cobran igual).' });
  }

  const { apuestas, garantia, sinReconocer } = parsearRemate(texto);
  if (!apuestas.length) return res.status(400).json({ error: 'No reconocí ninguna apuesta en el texto — revisa el formato de las líneas.' });

  const fechaFinal = fecha || fechaHoyVenezuela();
  const { pizarra: pizarraResuelta, origen } = await resolverLlegadaRemate(req, { hipodromoNombre, carreraNumero, fecha: fechaFinal, pizarraManual: pizarra });
  const poolTotal = apuestas.reduce((acc, a) => acc + a.monto, 0);

  if (!pizarraResuelta) {
    return res.json({
      apuestas, garantia, sinReconocer, poolTotal,
      necesitaLlegada: true
    });
  }

  const numeroGanador = primerNumeroPizarra(pizarraResuelta);
  const resultado = calcularRemate({ apuestas, garantia, comisionPorcentaje, numeroGanador });
  const textoResultado = armarTextoResultadoRemate({
    nombreGrupo: req.grupo.nombre, hipodromoNombre, carreraNumero,
    pizarra: pizarraResuelta, apuestas, garantia, numeroGanador, resultado
  });

  res.json({
    apuestas, garantia, sinReconocer, poolTotal,
    pizarra: pizarraResuelta, origenPizarra: origen, numeroGanador,
    necesitaLlegada: false,
    hayGanador: resultado.hayGanador,
    apuestaGanadora: resultado.apuestaGanadora,
    pagoGanador: resultado.pagoGanador,
    comisionTotal: resultado.comisionTotal,
    totalesPorCliente: resultado.totalesPorCliente,
    textoResultado
  });
}));

// POST /remates: calcula Y guarda de verdad (hipismo_remates + hipismo_remate_apuestas).
router.post('/remates', asyncHandler(async (req, res) => {
  const { texto, hipodromoId, hipodromoNombre, carreraNumero, fecha, comisionPorcentaje, pizarra } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Falta el texto del remate.' });
  if (!carreraNumero) return res.status(400).json({ error: 'Falta el número de carrera.' });
  if (comisionPorcentaje === undefined || comisionPorcentaje === null || comisionPorcentaje === '' || isNaN(Number(comisionPorcentaje))) {
    return res.status(400).json({ error: 'Falta el % de comisión de este remate (no todos cobran igual).' });
  }

  let nombreHipodromoFinal = hipodromoNombre;
  if (hipodromoId) {
    const rh = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2', [hipodromoId, req.grupoId]);
    if (rh.rows.length === 0) return res.status(400).json({ error: 'Hipódromo no encontrado.' });
    nombreHipodromoFinal = rh.rows[0].nombre;
  }
  if (!nombreHipodromoFinal) return res.status(400).json({ error: 'Falta el hipódromo.' });

  const { apuestas, garantia, sinReconocer } = parsearRemate(texto);
  if (!apuestas.length) return res.status(400).json({ error: 'No reconocí ninguna apuesta en el texto — revisa el formato de las líneas.' });

  const fechaFinal = fecha || fechaHoyVenezuela();
  const { pizarra: pizarraResuelta } = await resolverLlegadaRemate(req, { hipodromoNombre: nombreHipodromoFinal, carreraNumero, fecha: fechaFinal, pizarraManual: pizarra });
  if (!pizarraResuelta) {
    return res.status(400).json({ error: 'Falta la llegada de esta carrera — todavía no hay un plano cargado con la pizarra para este hipódromo/carrera/fecha. Cargala a mano en "Llegada" para poder guardar el remate.' });
  }

  const numeroGanador = primerNumeroPizarra(pizarraResuelta);
  const resultado = calcularRemate({ apuestas, garantia, comisionPorcentaje, numeroGanador });
  const textoResultado = armarTextoResultadoRemate({
    nombreGrupo: req.grupo.nombre, hipodromoNombre: nombreHipodromoFinal, carreraNumero,
    pizarra: pizarraResuelta, apuestas, garantia, numeroGanador, resultado
  });

  // Da de alta en "jugadores" a cualquier cliente nuevo de este remate —
  // misma tabla compartida, mismo criterio que ya usa "Cargar Planos".
  const nombresDelRemate = new Set(apuestas.map(a => a.cliente));
  await autoRegistrarJugadores(req.grupoId, Array.from(nombresDelRemate), {});
  // Mismo criterio que POST /planos (26-09-2026, ver la nota grande de
  // obtenerComisionesPropias): un remate confirmado también puede
  // generar "% devuelto" (entra igual que Tercios en Cierre Final/
  // Comisiones Devueltas, ver obtenerApuestasDelDia) — se asegura la
  // cuenta de comisión real acá, al guardar de verdad, nunca en la vista
  // previa de "Calcular".
  await asegurarCuentasComisionParaNombres(req.grupoId, Array.from(nombresDelRemate));

  const remate = await db.transaccion(async (client) => {
    const rRemate = await client.query(
      `INSERT INTO hipismo_remates (grupo_id, hipodromo_id, hipodromo_nombre, carrera_numero, fecha, texto_original, comision_porcentaje, garantia, pool_total, pizarra, numero_ganador, hubo_ganador, caballo_ganador, cliente_ganador, pago_ganador, comision_total, texto_resultado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [req.grupoId, hipodromoId || null, nombreHipodromoFinal, carreraNumero, fechaFinal, texto, Number(comisionPorcentaje), garantia,
        resultado.poolTotal, pizarraResuelta, numeroGanador, resultado.hayGanador,
        resultado.apuestaGanadora ? resultado.apuestaGanadora.caballo : null,
        resultado.apuestaGanadora ? resultado.apuestaGanadora.cliente : null,
        resultado.pagoGanador, resultado.comisionTotal, textoResultado]
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
    totalesPorCliente: resultado.totalesPorCliente
  });
}));

// GET /remates?fecha=&hipodromoId=&limite= : historial reciente (cabeceras).
router.get('/remates', asyncHandler(async (req, res) => {
  const { fecha, hipodromoId, limite } = req.query;
  const condiciones = ['grupo_id = $1'];
  const params = [req.grupoId];
  if (fecha) { params.push(fecha); condiciones.push(`fecha = $${params.length}`); }
  if (hipodromoId) { params.push(hipodromoId); condiciones.push(`hipodromo_id = $${params.length}`); }
  params.push(Math.min(parseInt(limite, 10) || 50, 200));
  const r = await db.query(
    `SELECT id, hipodromo_nombre, carrera_numero, fecha, comision_porcentaje, garantia, pool_total, hubo_ganador, cliente_ganador, pago_ganador, comision_total, creado_en
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

// GET /balance-general?fecha= : el "último plano" del día, mismo criterio
// que hoy usa el mockup (el resultado de lo último que se calculó) pero
// leído de la base — spec sección 12. Cierre Final (agregado semanal
// real) sigue pendiente, ver nota grande arriba del archivo.
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
function rangoSemana(fecha, offsetSemanas) {
  const diaSemana = fecha.getUTCDay();
  const diffHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(fecha);
  lunes.setUTCDate(lunes.getUTCDate() + diffHastaLunes + offsetSemanas * 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  return { desde: isoDeFechaUTC(lunes), hasta: isoDeFechaUTC(domingo) };
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

function textoJugadaTicket(t) {
  return `${t.modalidad} (${t.caballo}) con ${Number(t.monto).toFixed(2).replace('.', ',')}`;
}

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
  const { desde, hasta } = rangoSemana(hoyVenezuela(), offset);
  res.json({ rango: { desde, hasta }, numeroSemana: numeroSemanaISO(desde) });
}));

router.get('/comisiones-por-carrera', asyncHandler(async (req, res) => {
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const { desde, hasta } = rangoSemana(hoyVenezuela(), offset);
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
async function obtenerApuestasDelDia(grupoId, fecha) {
  const detalle = [];

  const rTickets = await db.query(
    `SELECT t.id, t.cliente_nombre, t.modalidad, t.caballo, t.monto, p.hipodromo_nombre, p.carrera_numero
       FROM hipismo_tickets t JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND p.fecha = $2`,
    [grupoId, fecha]
  );
  rTickets.rows.forEach(t => detalle.push({
    id: t.id, tabla: 'hipismo_tickets',
    cliente: t.cliente_nombre, hipodromoNombre: t.hipodromo_nombre, carreraNumero: t.carrera_numero,
    tipo: 'tercios', detalleTexto: `${t.modalidad} (${t.caballo})`, monto: Number(t.monto)
  }));

  const rRemate = await db.query(
    `SELECT a.id, a.cliente_nombre, a.caballo, a.monto, r.hipodromo_nombre, r.carrera_numero
       FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r.id = a.remate_id
      WHERE a.grupo_id = $1 AND r.fecha = $2`,
    [grupoId, fecha]
  );
  rRemate.rows.forEach(a => detalle.push({
    id: a.id, tabla: 'hipismo_remate_apuestas',
    cliente: a.cliente_nombre, hipodromoNombre: a.hipodromo_nombre, carreraNumero: a.carrera_numero,
    tipo: 'remate', detalleTexto: `Remate (${a.caballo})`, monto: Number(a.monto)
  }));

  const rAdelantadas = await db.query(
    `SELECT j.id, j.cliente_nombre, j.tipo, j.monto, j.numero_ejemplar, j.numero1, j.numero2, j.carrera_numero, p.hipodromo_nombre
       FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha = $2`,
    [grupoId, fecha]
  );
  rAdelantadas.rows.forEach(j => detalle.push({
    id: j.id, tabla: 'hipismo_adelantadas_jugadas',
    cliente: j.cliente_nombre, hipodromoNombre: j.hipodromo_nombre, carreraNumero: j.carrera_numero,
    tipo: j.tipo === 'tf' ? 'tabla_fija' : 'marca',
    detalleTexto: j.tipo === 'tf' ? `Tabla fija (${j.numero_ejemplar})` : `Marca (${j.numero1}x${j.numero2})`,
    monto: Number(j.monto)
  }));

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
  const detalle = (await obtenerApuestasDelDia(req.grupoId, fecha))
    .filter(d => d.cliente === cliente.trim().toUpperCase() && d.tipo !== 'remate');

  const porHipodromo = new Map();
  detalle.forEach(d => {
    if (!porHipodromo.has(d.hipodromoNombre)) porHipodromo.set(d.hipodromoNombre, { nombre: d.hipodromoNombre, jugadas: [] });
    porHipodromo.get(d.hipodromoNombre).jugadas.push(d);
  });
  res.json({ fecha, cliente: cliente.trim().toUpperCase(), hipodromos: Array.from(porHipodromo.values()) });
}));

router.post('/traspasos/jugada', asyncHandler(async (req, res) => {
  const { tabla, id, clienteNuevo } = req.body;
  if (!['hipismo_tickets', 'hipismo_adelantadas_jugadas'].includes(tabla)) {
    return res.status(400).json({ error: 'Solo se pueden traspasar jugadas de Tercios o de Jugadas Adelantadas.' });
  }
  const clienteNuevoFinal = ((clienteNuevo || '') + '').trim().toUpperCase();
  if (!clienteNuevoFinal) return res.status(400).json({ error: 'Falta el cliente al que se le pasa la jugada.' });

  const r = await db.query(
    `UPDATE ${tabla} SET cliente_nombre = $1 WHERE id = $2 AND grupo_id = $3 RETURNING *`,
    [clienteNuevoFinal, id, req.grupoId]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Esa jugada no existe.' });

  await autoRegistrarJugadores(req.grupoId, [clienteNuevoFinal], {});
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
  const origenFinal = ((clienteOrigen || '') + '').trim().toUpperCase();
  const destinoFinal = ((clienteDestino || '') + '').trim().toUpperCase();
  const montoFinal = Number(monto);
  const fechaFinal = fecha || fechaHoyVenezuela();
  if (!origenFinal || !destinoFinal) return res.status(400).json({ error: 'Falta el cliente de origen y/o el destino.' });
  if (origenFinal === destinoFinal) return res.status(400).json({ error: 'El origen y el destino no pueden ser el mismo cliente.' });
  if (!montoFinal || montoFinal <= 0 || isNaN(montoFinal)) return res.status(400).json({ error: 'Falta un monto válido a traspasar.' });

  await autoRegistrarJugadores(req.grupoId, [destinoFinal], {});

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

// Suma neta de ajustes de traspaso de comisión por cliente, en un rango
// de fechas — ver la nota grande de POST /comisiones/traspaso. Devuelve
// {} si nunca se hizo ningún traspaso (tabla vacía = sin efecto, no
// afecta ninguna semana de antes de que existiera esta función).
async function obtenerAjustesComision(grupoId, desde, hasta) {
  const r = await db.query(
    'SELECT cliente_nombre, COALESCE(SUM(monto), 0) AS total FROM hipismo_comisiones_ajustes WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 GROUP BY cliente_nombre',
    [grupoId, desde, hasta]
  );
  const mapa = {};
  r.rows.forEach(row => { mapa[row.cliente_nombre] = Number(row.total); });
  return mapa;
}

// GET /montos-apostados?fecha=YYYY-MM-DD (default: hoy en hora Venezuela).
router.get('/montos-apostados', asyncHandler(async (req, res) => {
  const fecha = req.query.fecha || isoDeFechaUTC(hoyVenezuela());
  const detalle = await obtenerApuestasDelDia(req.grupoId, fecha);

  const porCliente = new Map();
  detalle.forEach(d => {
    if (!porCliente.has(d.cliente)) porCliente.set(d.cliente, { nombre: d.cliente, total: 0, detalle: [] });
    const c = porCliente.get(d.cliente);
    c.total = round2(c.total + d.monto);
    c.detalle.push(d);
  });
  const clientes = Array.from(porCliente.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  res.json({ fecha, clientes });
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
// GET /comisiones-devueltas?fecha=YYYY-MM-DD (default: hoy en hora Venezuela).
router.get('/comisiones-devueltas', asyncHandler(async (req, res) => {
  const fecha = req.query.fecha || isoDeFechaUTC(hoyVenezuela());
  const detalle = await obtenerApuestasDelDia(req.grupoId, fecha);
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, detalle.map(d => d.cliente));

  // 24-09-2026: un cliente puede tener hasta 2 entradas simultáneas (ver
  // la nota grande de obtenerComisionesPropias) — así que ahora se agrupa
  // por (cliente + destino + %), no solo por cliente, para que las 2 se
  // muestren como 2 renglones separados en vez de mezclarse en uno solo.
  const porCliente = new Map();
  detalle.forEach(d => {
    const infos = comisionesPropias[d.cliente];
    if (!infos || !infos.length) return; // sin % configurado, no aparece en este reporte
    infos.forEach(info => {
      if (!info || !info.pct) return;
      const devuelto = round2(Math.abs(d.monto) * (info.pct / 100));
      if (!devuelto) return;
      // A propósito SIGUE agrupado por quien APOSTÓ (d.cliente), no por el
      // destino — este reporte audita "quién generó cuánto %"; `destino` se
      // agrega aparte para que el frontend pueda avisar "va acreditado a
      // {destino}" cuando el cliente tiene un aval configurado (ver la nota
      // grande de obtenerComisionesPropias más arriba).
      const clave = d.cliente + '::' + info.destino + '::' + info.pct;
      if (!porCliente.has(clave)) porCliente.set(clave, { nombre: d.cliente, porcentaje: info.pct, destino: info.destino, esAvalAdicional: !!info.esAvalAdicional, total: 0, hipodromos: new Map() });
      const c = porCliente.get(clave);
      c.total = round2(c.total + devuelto);
      if (!c.hipodromos.has(d.hipodromoNombre)) c.hipodromos.set(d.hipodromoNombre, { nombre: d.hipodromoNombre, total: 0, carreras: [] });
      const h = c.hipodromos.get(d.hipodromoNombre);
      h.total = round2(h.total + devuelto);
      h.carreras.push({ carreraNumero: d.carreraNumero, tipo: d.tipo, detalleTexto: d.detalleTexto, monto: d.monto, devuelto });
    });
  });

  const clientes = Array.from(porCliente.values())
    .map(c => ({ nombre: c.nombre, porcentaje: c.porcentaje, destino: c.destino, esAvalAdicional: c.esAvalAdicional, total: c.total, hipodromos: Array.from(c.hipodromos.values()) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.esAvalAdicional - b.esAvalAdicional);

  const totalGeneralDevueltas = round2(clientes.reduce((s, c) => s + c.total, 0));

  res.json({ fecha, clientes, totalGeneral: totalGeneralDevueltas });
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
  const detalle = await obtenerApuestasDelDia(req.grupoId, fecha);
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, detalle.map(d => d.cliente));

  const porHipodromo = new Map();
  let totalGeneral = 0;
  detalle.forEach(d => {
    const infos = comisionesPropias[d.cliente];
    if (!infos || !infos.length) return;
    // Este reporte solo suma TOTALES por hipódromo/carrera (no distingue
    // destino) — con hasta 2 entradas por cliente (ver la nota grande de
    // obtenerComisionesPropias), simplemente se suman las 2 acá.
    let devueltoTotalLinea = 0;
    infos.forEach(info => {
      if (!info || !info.pct) return;
      devueltoTotalLinea = round2(devueltoTotalLinea + Math.abs(d.monto) * (info.pct / 100));
    });
    if (!devueltoTotalLinea) return;
    const devuelto = devueltoTotalLinea;
    if (!porHipodromo.has(d.hipodromoNombre)) {
      porHipodromo.set(d.hipodromoNombre, { nombre: d.hipodromoNombre, totalDevuelto: 0, carrerasMap: new Map() });
    }
    const hip = porHipodromo.get(d.hipodromoNombre);
    hip.totalDevuelto = round2(hip.totalDevuelto + devuelto);
    totalGeneral = round2(totalGeneral + devuelto);
    hip.carrerasMap.set(d.carreraNumero, round2((hip.carrerasMap.get(d.carreraNumero) || 0) + devuelto));
  });

  const hipodromos = Array.from(porHipodromo.values())
    .map(h => ({
      nombre: h.nombre,
      totalDevuelto: h.totalDevuelto,
      carreras: Array.from(h.carrerasMap.entries())
        .map(([carreraNumero, devuelto]) => ({ carreraNumero, devuelto }))
        .sort((a, b) => a.carreraNumero - b.carreraNumero)
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

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
router.get('/cierre-final', asyncHandler(async (req, res) => {
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoSemana(hoyVe, offset);
  const esSemanaActual = isoDeFechaUTC(hoyVe) >= desde && isoDeFechaUTC(hoyVe) <= hasta;
  const numeroSemana = numeroSemanaISO(desde);

  const rTickets = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero, t.monto
       FROM hipismo_tickets t
       JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  const rApuestasRemate = await db.query(
    `SELECT a.cliente_nombre, a.resultado, a.monto
       FROM hipismo_remate_apuestas a
       JOIN hipismo_remates r ON r.id = a.remate_id
      WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  // Jugadas Adelantadas (23-09-2026, ver la nota grande en
  // services/hipismoAdelantadasCalc.js): el lado del CLIENTE que jugó
  // (tf o marca) ya es definitivo apenas sale de 'pendiente' —
  // 'resuelto', 'falta_banqueo' y 'sin_decidir' entran todos acá (en
  // 'sin_decidir' resultado_cliente ya quedó en 0). El lado de los
  // BANQUEADORES de una Marca solo existe una vez 'resuelto' (adentro
  // del jsonb banqueadores) — cada banquero es, para efectos de saldo,
  // un cliente más (ej. "MARCAS ZENYATTA").
  const rAdelantadas = await db.query(
    `SELECT j.cliente_nombre, j.resultado_cliente, j.comision, j.banqueadores, j.monto
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
    [req.grupoId, desde, hasta]
  );

  const porCliente = new Map();
  function acumular(nombre, resultado) {
    if (!porCliente.has(nombre)) porCliente.set(nombre, { nombre, jugadas: 0, gano: 0, perdio: 0 });
    const c = porCliente.get(nombre);
    c.jugadas += 1;
    const n = Number(resultado);
    if (n > 0) c.gano += n;
    else if (n < 0) c.perdio += -n;
  }
  rTickets.rows.forEach(t => {
    acumular(t.cliente_nombre, t.resultado_jugador);
    acumular(t.banquero_nombre, t.resultado_banquero);
  });
  rApuestasRemate.rows.forEach(a => acumular(a.cliente_nombre, a.resultado));

  let comisionAdelantadasSemana = 0;
  rAdelantadas.rows.forEach(j => {
    acumular(j.cliente_nombre, j.resultado_cliente);
    if (j.comision != null) comisionAdelantadasSemana += Number(j.comision);
    if (Array.isArray(j.banqueadores)) {
      j.banqueadores.forEach(b => acumular(b.nombre, b.monto));
    }
  });

  // "% DEVUELTO" (23-09-2026, undécima ronda, a pedido del usuario: "un
  // item llama pedro - porcentaje... recuerda todo debe verse reflejado
  // en balances") — mismo cálculo que Balance General de "Cargar Planos"
  // (ver agregarPorcentajeDevuelto más arriba), pero agregado para TODA
  // la semana: cada cliente con % propio configurado
  // (jugadores.comision_propia) se gana ese % de TODO lo que apostó como
  // JUGADOR (Tercios + Remate + Adelantadas — nunca lo que banqueó), gane
  // o pierda cada jugada puntual, sumado como su propio "cliente" aparte
  // ("{NOMBRE} - PORCENTAJE") en esta misma lista.
  const nombresJugadores = new Set();
  rTickets.rows.forEach(t => nombresJugadores.add(t.cliente_nombre));
  rApuestasRemate.rows.forEach(a => nombresJugadores.add(a.cliente_nombre));
  rAdelantadas.rows.forEach(j => nombresJugadores.add(j.cliente_nombre));
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, Array.from(nombresJugadores));
  function acumularDevuelto(nombre, monto) {
    const infos = comisionesPropias[nombre];
    if (!infos || !infos.length) return;
    // 24-09-2026: hasta 2 entradas simultáneas por cliente (ver la nota
    // grande de obtenerComisionesPropias) — cada una con su propio
    // destino, así que cada una suma su propio ítem "{destino} -
    // PORCENTAJE" aparte (pueden ser 2 ítems distintos para el mismo
    // cliente en la misma semana).
    infos.forEach(info => {
      if (!info || !info.pct) return;
      const devuelto = round2(Math.abs(Number(monto) || 0) * (info.pct / 100));
      if (!devuelto) return;
      // Ver la nota grande de arriba (agregarPorcentajeDevuelto):
      // info.cuentaNombre ya es el nombre final, no hace falta pegarle
      // el sufijo de nuevo.
      acumular(info.cuentaNombre, devuelto);
    });
  }
  rTickets.rows.forEach(t => acumularDevuelto(t.cliente_nombre, t.monto));
  rApuestasRemate.rows.forEach(a => acumularDevuelto(a.cliente_nombre, a.monto));
  rAdelantadas.rows.forEach(j => acumularDevuelto(j.cliente_nombre, j.monto));

  const clientes = Array.from(porCliente.values())
    .map(c => ({ ...c, saldo: c.gano - c.perdio }));

  // TRASPASO DE COMISIÓN (26-09-2026, ver POST /comisiones/traspaso más
  // arriba) — se suma/resta encima del saldo ya calculado; si el cliente
  // del ajuste no tenía ninguna jugada esta semana (ej. recién recibió
  // un traspaso sin haber jugado nada), se agrega como una fila nueva.
  const ajustesComision = await obtenerAjustesComision(req.grupoId, desde, hasta);
  Object.keys(ajustesComision).forEach(nombre => {
    const monto = ajustesComision[nombre];
    if (!monto) return;
    let c = clientes.find(x => x.nombre === nombre);
    if (!c) { c = { nombre, jugadas: 0, gano: 0, perdio: 0, saldo: 0 }; clientes.push(c); }
    c.saldo = round2(c.saldo + monto);
  });
  clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Comisión de la semana: mismo total ya guardado por plano (ver
  // /comisiones-por-carrera arriba) — no depende de los tickets sueltos.
  const rComision = await db.query(
    `SELECT COALESCE(SUM(comision_total), 0) AS total
       FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  // Comisión de Remate, aparte (ver la nota grande arriba) — cada remate
  // ya trae su propio % (no siempre el mismo), así que se suma su
  // comision_total ya calculado por cada remate guardado en el rango.
  const rComisionRemate = await db.query(
    `SELECT COALESCE(SUM(comision_total), 0) AS total
       FROM hipismo_remates WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );

  res.json({
    rango: { desde, hasta },
    semana,
    numeroSemana,
    esSemanaActual,
    clientes,
    comisionSemana: Number(rComision.rows[0].total),
    comisionRemateSemana: Number(rComisionRemate.rows[0].total),
    comisionAdelantadasSemana
  });
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
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoSemana(hoyVe, offset);
  const numeroSemana = numeroSemanaISO(desde);

  const rTickets = await db.query(
    `SELECT t.cliente_nombre, t.monto
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
  const rAdelantadas = await db.query(
    `SELECT j.cliente_nombre, j.monto
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
    [req.grupoId, desde, hasta]
  );

  const nombresJugadores = new Set();
  rTickets.rows.forEach(t => nombresJugadores.add(t.cliente_nombre));
  rApuestasRemate.rows.forEach(a => nombresJugadores.add(a.cliente_nombre));
  rAdelantadas.rows.forEach(j => nombresJugadores.add(j.cliente_nombre));
  const comisionesPropias = await obtenerComisionesPropias(req.grupoId, Array.from(nombresJugadores));

  // 24-09-2026: hasta 2 entradas simultáneas por cliente (ver la nota
  // grande de obtenerComisionesPropias) — se agrupa por (nombre +
  // destino + %) para mostrarlas como 2 renglones separados en vez de
  // mezclarlas en uno solo.
  const porCliente = new Map();
  function acumularSaldo(nombre, monto) {
    const infos = comisionesPropias[nombre];
    if (!infos || !infos.length) return;
    infos.forEach(info => {
      if (!info || !info.pct) return;
      const devuelto = round2(Math.abs(Number(monto) || 0) * (info.pct / 100));
      if (!devuelto) return;
      const clave = nombre + '::' + info.destino + '::' + info.pct;
      if (!porCliente.has(clave)) porCliente.set(clave, { nombre, porcentaje: info.pct, destino: info.destino, esAvalAdicional: !!info.esAvalAdicional, devueltoSemana: 0 });
      const c = porCliente.get(clave);
      c.devueltoSemana = round2(c.devueltoSemana + devuelto);
    });
  }
  rTickets.rows.forEach(t => acumularSaldo(t.cliente_nombre, t.monto));
  rApuestasRemate.rows.forEach(a => acumularSaldo(a.cliente_nombre, a.monto));
  rAdelantadas.rows.forEach(j => acumularSaldo(j.cliente_nombre, j.monto));

  const clientes = Array.from(porCliente.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
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
  const rJugador = await db.query(
    'SELECT * FROM jugadores WHERE grupo_id = $1 AND nombre = $2',
    [req.grupoId, req.params.nombre]
  );
  const jugador = rJugador.rows[0];
  if (!jugador) return res.status(404).json({ error: 'No se encontró ese cliente.' });

  const resultado = await construirResumenClienteHipismo(jugador, req.grupo, req.query.semana);
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
function diasDeLaSemanaHipismo(desde) {
  const dias = [];
  let actual = new Date(desde + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) {
    const fecha = isoDeFechaUTC(actual);
    dias.push({ fecha, nombre: DIAS_LARGO_HIPISMO[actual.getUTCDay()], corta: DIAS_CORTO_HIPISMO[actual.getUTCDay()] });
    actual = new Date(actual.getTime() + 24 * 60 * 60 * 1000);
  }
  // 24-09-2026, a pedido del usuario: "cuando hay carreras los lunes el
  // lunes va al lado del domingo" — `rangoSemana()` sigue definiendo la
  // semana lunes-a-domingo para el CÁLCULO (eso no cambia), pero para
  // MOSTRAR las columnas el lunes se corre al final, pegado al domingo,
  // en vez de encabezar la fila (dias[0] es siempre el lunes acá arriba).
  return [...dias.slice(1), dias[0]];
}

router.get('/semana-por-dias', asyncHandler(async (req, res) => {
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoSemana(hoyVe, offset);
  const esSemanaActual = isoDeFechaUTC(hoyVe) >= desde && isoDeFechaUTC(hoyVe) <= hasta;
  const numeroSemana = numeroSemanaISO(desde);
  const dias = diasDeLaSemanaHipismo(desde);

  const rTickets = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero, p.fecha
       FROM hipismo_tickets t
       JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  const rApuestasRemate = await db.query(
    `SELECT a.cliente_nombre, a.resultado, r.fecha
       FROM hipismo_remate_apuestas a
       JOIN hipismo_remates r ON r.id = a.remate_id
      WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  const rAdelantadas = await db.query(
    `SELECT j.cliente_nombre, j.resultado_cliente, j.banqueadores, p.fecha
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
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
  rAdelantadas.rows.forEach(j => {
    acumularDia(j.cliente_nombre, j.fecha, j.resultado_cliente);
    if (Array.isArray(j.banqueadores)) {
      j.banqueadores.forEach(b => acumularDia(b.nombre, j.fecha, b.monto));
    }
  });

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
  // usuario) — mismas 3 fuentes que ya suma Cierre Final (comisión de
  // Tercios por plano, comisión de Remate por remate, comisión de
  // Jugadas Adelantadas por jugada resuelta), pero agrupada por DÍA para
  // poder mostrar una columna por día igual que el resto de la fila.
  const rComisionPlanos = await db.query(
    `SELECT fecha, COALESCE(SUM(comision_total), 0) AS total
       FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 GROUP BY fecha`,
    [req.grupoId, desde, hasta]
  );
  const rComisionRemates = await db.query(
    `SELECT fecha, COALESCE(SUM(comision_total), 0) AS total
       FROM hipismo_remates WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 GROUP BY fecha`,
    [req.grupoId, desde, hasta]
  );
  const rComisionAdelantadas = await db.query(
    `SELECT p.fecha AS fecha, j.comision
       FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
    [req.grupoId, desde, hasta]
  );
  const comisionPorFecha = {};
  function acumularComisionFecha(fechaFila, monto) {
    if (monto == null) return;
    const fechaIso = fechaFila instanceof Date ? isoDeFechaUTC(fechaFila) : fechaFila;
    comisionPorFecha[fechaIso] = round2((comisionPorFecha[fechaIso] || 0) + Number(monto));
  }
  rComisionPlanos.rows.forEach(r => acumularComisionFecha(r.fecha, r.total));
  rComisionRemates.rows.forEach(r => acumularComisionFecha(r.fecha, r.total));
  rComisionAdelantadas.rows.forEach(r => acumularComisionFecha(r.fecha, r.comision));
  const comisionPorDia = diasConDatos.map(d => round2(comisionPorFecha[d.fecha] || 0));
  const comisionSemana = round2(Object.values(comisionPorFecha).reduce((a, b) => a + b, 0));

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

module.exports = router;
