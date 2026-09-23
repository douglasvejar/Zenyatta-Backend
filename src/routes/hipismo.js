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
const { requiereGrupo, requierePermiso } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { calcularPlano, armarTextoResultado } = require('../services/hipismoCalc');
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
  resolverClienteMarca, resolverBanqueoMarca, armarBloqueAdelantadas
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
        id: j.id, cliente: j.cliente_nombre, tipo: 'tf', estadoNuevo: 'resuelto',
        gano: r.gano, resultadoCliente: r.resultadoCliente, comision: r.comision,
        movimientos: [{ nombre: j.cliente_nombre, monto: r.resultadoCliente }, { nombre: 'TABLAS FIJAS', monto: r.tablasFijas }]
      };
    }
    // Marca
    if (!esMarcaDecidible(pizarra, esNacional)) {
      return { id: j.id, cliente: j.cliente_nombre, tipo: 'marca', estadoNuevo: 'sin_decidir', gano: null, resultadoCliente: 0, comision: 0, movimientos: [] };
    }
    const c = resolverClienteMarca({ numero1: j.numero1, numero2: j.numero2, monto: Number(j.monto) }, rank);
    return {
      id: j.id, cliente: j.cliente_nombre, tipo: 'marca', estadoNuevo: 'falta_banqueo',
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

// =================================================================
// PLANOS — "Cargar Planos" (spec secciones 1, 5, 6, 7)
// =================================================================
// POST /planos/calcular: calcula SIN guardar — para la vista previa del
// botón "Calcular" antes de decidir si se guarda de verdad.
router.post('/planos/calcular', asyncHandler(async (req, res) => {
  const { texto, pizarra, cruzaJugadas, hipodromoNombre, carreraNumero, ret, fecha } = req.body;
  if (!pizarra || !pizarra.trim()) return res.status(400).json({ error: 'Falta la Pizarra (orden de llegada).' });

  const fechaFinal = fecha || new Date().toISOString().slice(0, 10);
  const { resueltas, movimientosParaTexto } = (hipodromoNombre && carreraNumero)
    ? await calcularResolucionAdelantadas(req, { hipodromoNombre, carreraNumero, fecha: fechaFinal, pizarra })
    : { resueltas: [], movimientosParaTexto: [] };

  const huboTexto = !!(texto && texto.trim());
  if (!huboTexto && resueltas.length === 0) {
    return res.status(400).json({ error: 'Falta el texto del plano.' });
  }

  const resultado = huboTexto
    ? calcularPlano({ texto, pizarra, cruzar: !!cruzaJugadas })
    : { huboLineas: false, salidaLineas: [], sinReconocer: [], tickets: [], totalesFinales: {}, comisionTotal: 0 };
  if (huboTexto && !resultado.huboLineas) {
    return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto — revisá el formato de las líneas.' });
  }

  let textoResultado = armarTextoResultado({
    nombreGrupo: req.grupo.nombre,
    hipodromoNombre: hipodromoNombre || '',
    carreraNumero: carreraNumero || '',
    ret,
    pizarra,
    salidaLineas: resultado.salidaLineas,
    totalesFinales: resultado.totalesFinales
  });
  const bloqueAdelantadas = armarBloqueAdelantadas(movimientosParaTexto);
  if (bloqueAdelantadas) textoResultado += '\n\n' + bloqueAdelantadas;

  res.json({
    textoResultado,
    totalesFinales: resultado.totalesFinales,
    comisionTotal: resultado.comisionTotal,
    sinReconocer: resultado.sinReconocer,
    cantidadTickets: resultado.tickets.length,
    adelantadasResueltas: resueltas.map(r => ({ cliente: r.cliente, tipo: r.tipo, estado: r.estadoNuevo, gano: r.gano, resultadoCliente: r.resultadoCliente }))
  });
}));

// POST /planos: calcula Y guarda de verdad (hipismo_planos + hipismo_tickets).
router.post('/planos', asyncHandler(async (req, res) => {
  const { texto, pizarra, cruzaJugadas, hipodromoId, hipodromoNombre, carreraNumero, ret, fecha } = req.body;
  if (!pizarra || !pizarra.trim()) return res.status(400).json({ error: 'Falta la Pizarra (orden de llegada).' });
  if (!carreraNumero) return res.status(400).json({ error: 'Falta el número de carrera.' });

  let nombreHipodromoFinal = hipodromoNombre;
  if (hipodromoId) {
    const rh = await db.query('SELECT nombre FROM hipismo_hipodromos WHERE id = $1 AND grupo_id = $2', [hipodromoId, req.grupoId]);
    if (rh.rows.length === 0) return res.status(400).json({ error: 'Hipódromo no encontrado.' });
    nombreHipodromoFinal = rh.rows[0].nombre;
  }
  if (!nombreHipodromoFinal) return res.status(400).json({ error: 'Falta el hipódromo.' });

  const fechaFinal = fecha || new Date().toISOString().slice(0, 10);

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
    ? calcularPlano({ texto, pizarra, cruzar: !!cruzaJugadas })
    : { huboLineas: false, salidaLineas: [], sinReconocer: [], tickets: [], totalesFinales: {}, comisionTotal: 0 };
  if (huboTexto && !resultado.huboLineas) {
    return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto — revisá el formato de las líneas.' });
  }

  let textoResultado = armarTextoResultado({
    nombreGrupo: req.grupo.nombre,
    hipodromoNombre: nombreHipodromoFinal,
    carreraNumero,
    ret,
    pizarra,
    salidaLineas: resultado.salidaLineas,
    totalesFinales: resultado.totalesFinales
  });
  const bloqueAdelantadas = armarBloqueAdelantadas(movimientosParaTexto);
  if (bloqueAdelantadas) textoResultado += '\n\n' + bloqueAdelantadas;

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
        `INSERT INTO hipismo_tickets (plano_id, grupo_id, cliente_nombre, banquero_nombre, modalidad, caballo, monto, resultado_jugador, resultado_banquero)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [planoCreado.id, req.grupoId, t.clienteNombre, t.banqueroNombre, t.modalidad, t.caballo, t.monto, t.resultadoJugador, t.resultadoBanquero]
      );
    }
    if (resueltas.length) await guardarResolucionAdelantadas(client, req, resueltas, pizarra);
    return planoCreado;
  });

  res.status(201).json({
    plano,
    totalesFinales: resultado.totalesFinales,
    comisionTotal: resultado.comisionTotal,
    sinReconocer: resultado.sinReconocer,
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

// GET /planos/:id : detalle completo (cabecera + tickets), para revisar un plano ya guardado.
router.get('/planos/:id', asyncHandler(async (req, res) => {
  const rPlano = await db.query('SELECT * FROM hipismo_planos WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  const plano = rPlano.rows[0];
  if (!plano) return res.status(404).json({ error: 'Plano no encontrado.' });
  const rTickets = await db.query('SELECT * FROM hipismo_tickets WHERE plano_id = $1 ORDER BY creado_en', [plano.id]);
  res.json({ plano, tickets: rTickets.rows });
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
  if (!jugadas.length) return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto — revisá el formato de las líneas ("N) 5TF DEL X A Y ,monto/pago$" o "N) AxB monto$").' });

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
  if (!jugadas.length) return res.status(400).json({ error: 'No reconocí ninguna jugada en el texto — revisá el formato de las líneas.' });

  const errores = jugadas.filter(j => j.errorCalculo);
  if (errores.length) {
    return res.status(400).json({
      error: 'Hay jugadas con la multiplicación mal calculada — corregí el plano antes de guardar.',
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

  const rJugada = await db.query('SELECT * FROM hipismo_adelantadas_jugadas WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
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

  res.json({ jugada: filaJugadaAdelantadaPublica(rActualizada.rows[0]) });
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
  if (!apuestas.length) return res.status(400).json({ error: 'No reconocí ninguna apuesta en el texto — revisá el formato de las líneas.' });

  const fechaFinal = fecha || new Date().toISOString().slice(0, 10);
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
  if (!apuestas.length) return res.status(400).json({ error: 'No reconocí ninguna apuesta en el texto — revisá el formato de las líneas.' });

  const fechaFinal = fecha || new Date().toISOString().slice(0, 10);
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
function comisionDeLado(resultadoMostrado) {
  const n = Number(resultadoMostrado);
  if (n <= 0) return 0;
  const bruto = n / 0.95;
  return bruto - n;
}

function textoJugadaTicket(t) {
  return `${t.modalidad} (${t.caballo}) con ${Number(t.monto).toFixed(2).replace('.', ',')}`;
}

router.get('/comisiones-por-carrera', asyncHandler(async (req, res) => {
  const semana = ['actual', 'anterior', 'hace2'].includes(req.query.semana) ? req.query.semana : 'actual';
  const offset = semana === 'anterior' ? -1 : (semana === 'hace2' ? -2 : 0);
  const { desde, hasta } = rangoSemana(hoyVenezuela(), offset);

  const rPlanos = await db.query(
    `SELECT id, fecha, hipodromo_nombre, carrera_numero, comision_total
       FROM hipismo_planos
      WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3
      ORDER BY fecha DESC, hipodromo_nombre, carrera_numero`,
    [req.grupoId, desde, hasta]
  );
  if (rPlanos.rows.length === 0) {
    return res.json({ rango: { desde, hasta }, semana, dias: [], totalGeneral: 0 });
  }

  const rTickets = await db.query(
    `SELECT plano_id, cliente_nombre, banquero_nombre, modalidad, caballo, monto, resultado_jugador, resultado_banquero
       FROM hipismo_tickets WHERE plano_id = ANY($1::uuid[])`,
    [rPlanos.rows.map(p => p.id)]
  );
  const ticketsPorPlano = new Map();
  rTickets.rows.forEach(t => {
    if (!ticketsPorPlano.has(t.plano_id)) ticketsPorPlano.set(t.plano_id, []);
    const detalle = [];
    const comJugador = comisionDeLado(t.resultado_jugador);
    const comBanquero = comisionDeLado(t.resultado_banquero);
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

  res.json({ rango: { desde, hasta }, semana, dias, totalGeneral });
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

  const rTickets = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero
       FROM hipismo_tickets t
       JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`,
    [req.grupoId, desde, hasta]
  );
  const rApuestasRemate = await db.query(
    `SELECT a.cliente_nombre, a.resultado
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
    `SELECT j.cliente_nombre, j.resultado_cliente, j.comision, j.banqueadores
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

  const clientes = Array.from(porCliente.values())
    .map(c => ({ ...c, saldo: c.gano - c.perdio }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

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
    esSemanaActual,
    clientes,
    comisionSemana: Number(rComision.rows[0].total),
    comisionRemateSemana: Number(rComisionRemate.rows[0].total),
    comisionAdelantadasSemana
  });
}));

module.exports = router;
