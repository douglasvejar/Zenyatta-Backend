// Administración > Jugador (registro fijo de clientes, % propio, tipo de
// cuenta libre/avalado y su pozo) + Avales ("Avalados por").
const express = require('express');
const db = require('../db');
const { requiereGrupo, requierePermiso, monedaModoDe } = require('../middleware/auth');
const { calcularPozoJugador, rangoSemanaActualPozo } = require('../services/pozo');
const { buscarOCrearFicha } = require('../services/hipismoComisionPropia');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);
router.use(requierePermiso('jugador'));

// Resuelve la moneda a guardar para un cliente (18-09-2026, "moneda del
// grupo" — ver la nota grande en sql/schema.sql). Si el grupo está fijo
// en 'usd' o 'bs', SIEMPRE se guarda esa moneda fija, sin importar lo
// que mande el formulario (así nunca queda un cliente "suelto" en la
// moneda equivocada por un dato viejo del navegador). Si el grupo está
// en 'mixto', se respeta lo que elija el Administrador al crear/editar
// ese cliente puntual (USD por default si no manda nada).
function resolverMonedaJugador(monedaModoGrupo, monedaPedida) {
  if (monedaModoGrupo !== 'mixto') return monedaModoGrupo.toUpperCase();
  return monedaPedida === 'BS' ? 'BS' : 'USD';
}

// Normaliza el nombre de un jugador/cliente al guardarlo (29-09-2026, a
// pedido del usuario después del caso real de "mr increible se le
// devuelve el 1%... y no sale como deberia sale -300"): además de
// MAYÚSCULA (de siempre), colapsa espacios de más entre palabras a uno
// solo (ej. "Mr  Increible" con doble espacio -> "MR INCREIBLE"). Sin
// esto, un espacio de más acá es INVISIBLE en el navegador (que colapsa
// espacios de más al mostrar texto) pero rompe en silencio el
// emparejamiento EXACTO de jugadores.nombre contra
// hipismo_tickets.cliente_nombre que usa obtenerComisionesPropias (ver
// services/hipismoComisionPropia.js) para aplicar el % propio de cada
// cliente — mismo criterio ahora usado también al parsear un plano/
// remate/jugada adelantada (ver services/hipismoCalc.js y
// hipismoAdelantadasCalc.js).
function normalizarNombreJugador(nombre) {
  return (nombre || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
}

router.get('/', asyncHandler(async (req, res) => {
  // cc_propio_nombre (02-10-2026, ver la nota grande de buscarOCrearFicha
  // en services/hipismoComisionPropia.js): el nombre ACTUAL de la ficha
  // donde va el % propio de este cliente (si ya tiene una enlazada) — la
  // ficha de Cliente lo usa para precargar el campo "¿en qué ficha va ese
  // %?" con lo que YA está configurado, en vez de dejarlo en blanco.
  const r = await db.query(
    `SELECT j.*, cc_propio.nombre AS cc_propio_nombre
       FROM jugadores j
       LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id
      WHERE j.grupo_id = $1
      ORDER BY j.nombre`,
    [req.grupoId]
  );
  // avalesPorcentaje (28-09-2026, ver la nota grande de
  // jugadores_avales_porcentaje en sql/schema.sql) — una sola consulta
  // para TODOS los jugadores de este grupo, agrupada acá mismo en JS, en
  // vez de una consulta por jugador (mismo criterio que calcularPozoJugador
  // de abajo, pero sin el ida-y-vuelta por cada fila).
  const rAvales = await db.query(
    `SELECT jap.jugador_id, jap.avalador_id, jap.porcentaje, av.nombre AS avalador_nombre
       FROM jugadores_avales_porcentaje jap
       JOIN jugadores av ON av.id = jap.avalador_id
      WHERE jap.grupo_id = $1`,
    [req.grupoId]
  );
  const avalesPorJugadorId = {};
  rAvales.rows.forEach(fila => {
    if (!avalesPorJugadorId[fila.jugador_id]) avalesPorJugadorId[fila.jugador_id] = [];
    avalesPorJugadorId[fila.jugador_id].push({ avaladorId: fila.avalador_id, avaladorNombre: fila.avalador_nombre, porcentaje: Number(fila.porcentaje) });
  });
  // Semana activa una sola vez para toda la lista (POZO SEMANAL, 07-10-2026,
  // ver la nota grande en services/pozo.js).
  const rangoSemana = await rangoSemanaActualPozo(req.grupoId);
  const conPozo = await Promise.all(r.rows.map(async j => {
    const pozo = j.tipo_cuenta === 'avalado' ? await calcularPozoJugador(req.grupoId, j, { rango: rangoSemana }) : null;
    return { ...j, pozo, avalesPorcentaje: avalesPorJugadorId[j.id] || [] };
  }));
  res.json(conPozo);
}));

// Valida/normaliza "modeloComision" para crear/editar un jugador
// (09-09-2026, "grupo mixto" — a pedido del usuario: "se puede tener un
// modelo de % en un grupo mixto... clientes que se le regrese % variados
// dependiendo de las patas de las jugadas... o establecerle % fijo por
// cualquier tipo de jugada etc" / "puedo elegir cualquier tipo de % o sin
// %" — ver la nota grande en sql/schema.sql, columna jugadores.
// modelo_comision). A diferencia del modelo/niveles DEFAULT del grupo
// (grupos.modelo_comision/comision_tiers, exclusivo de Súper-admin), esta
// excepción POR JUGADOR la carga el propio GRUPO, igual que ya carga
// comision_propia — no hace falta pasar por Súper-admin para marcar "este
// cliente puntual cobra distinto".
//   - null / undefined / '' / 'heredado' -> null (hereda el modelo
//     DEFAULT del grupo, sin excepción — es el valor de siempre).
//   - 'plano' -> este jugador SIEMPRE usa su propio % (comisionPropia,
//     que puede ser 0 = "sin %"), sin importar el modelo del grupo.
//   - 'por_tipo_jugada' -> este jugador SIEMPRE cobra según los niveles
//     del GRUPO (grupos.comision_tiers), sin importar el modelo del
//     grupo — hace falta que el grupo tenga al menos 1 nivel cargado
//     desde Súper-admin para que esto tenga efecto real (si no hay
//     niveles, simplemente no calza ninguno y cobra 0%, ver
//     comisiones.js).
function normalizarModeloComisionJugador(valor) {
  if (valor === 'plano' || valor === 'por_tipo_jugada') return valor;
  return null;
}

// =================================================================
// VARIOS AVALADORES CON % CADA UNO (28-09-2026, a pedido del usuario: "en
// cliente la parte donde coloco el % que le genera a otro cliente dejame
// elegir varios ya que un cliente le puede generar % a varios... aqui es
// donde quiero que me dejes elegir mas de un avalador, ya que un cliente
// puede generarle 2% por darte un ejemplo repartido en varias personas").
// Reemplaza el modelo viejo (avaladoPorId + porcentajeDevueltoAval, UN
// solo destino) — ver la nota grande de jugadores_avales_porcentaje en
// sql/schema.sql. De paso, "porcentajeDevueltoDestino" ya NO se lee del
// body: "% que se le devuelve" (comisionPropia) ahora SIEMPRE es para el
// propio cliente, a pedido del mismo usuario ("en % que se le devuelve,
// coloca: % de devolucion para el mismo cliente... la celda que esta al
// lado que pregunta pra quien es el % eliminala").
//
// normalizarNombreFicha(): misma normalización que usa buscarOCrearFicha
// en services/hipismoComisionPropia.js (upper + trim + colapsar espacios)
// — se repite acá (en vez de importarla) porque solo hace falta para
// comparar texto, sin tocar la base de datos.
function normalizarNombreFicha(nombre) {
  return (nombre || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
}

// Valida y devuelve la lista normalizada [{ avaladorId, porcentaje }] a
// partir de `avalesPorcentaje` del body — CAMBIO 02-10-2026 (a pedido del
// usuario, ver la nota grande de buscarOCrearFicha): cada fila del body
// ahora trae `fichaNombre` (el nombre que el operador ESCRIBIÓ, no un id
// de una lista) en vez de `avaladorId` — ya no se elige un avalador de
// una lista fija, el operador decide y escribe él mismo en qué ficha va
// ese %, sin que el sistema le pegue ningún sufijo automático por detrás
// (ver la nota grande en routes/hipismo.js antigua, "Agregados
// Ferrocarril - porcentaje - porcentaje"). Cada fichaNombre se resuelve
// con buscarOCrearFicha (reusa una ficha existente con ese nombre, o
// crea una nueva marcada es_cuenta_comision) — nunca puede ser la MISMA
// ficha del cliente que se está editando (para eso existe "Incluir % en
// sus jugadas"), y no se puede repetir el mismo nombre en 2 filas (se
// compara ANTES de crear nada, así una fila inválida nunca deja una
// ficha nueva huérfana).
async function normalizarAvalesPorcentaje(grupoId, avalesPorcentaje, propioId, nombrePropio) {
  const lista = Array.isArray(avalesPorcentaje) ? avalesPorcentaje : [];
  const vistos = new Set();
  const pendientes = [];
  const nombrePropioNorm = normalizarNombreFicha(nombrePropio);
  for (const entrada of lista) {
    const fichaNombreTxt = ((entrada && entrada.fichaNombre) || '').toString().trim();
    const porcentaje = Number(entrada && entrada.porcentaje);
    if (!fichaNombreTxt || !porcentaje || porcentaje <= 0) continue;
    const norm = normalizarNombreFicha(fichaNombreTxt);
    if (nombrePropioNorm && norm === nombrePropioNorm) { const err = new Error('No puedes mandarle el % a su propia ficha por acá — usa "Incluir % en sus jugadas" para eso.'); err.status = 400; throw err; }
    if (vistos.has(norm)) { const err = new Error('No puedes escribir la misma ficha dos veces — junta el % en una sola fila.'); err.status = 400; throw err; }
    vistos.add(norm);
    pendientes.push({ fichaNombreTxt, porcentaje });
  }
  const resultado = [];
  for (const p of pendientes) {
    const ficha = await buscarOCrearFicha(grupoId, p.fichaNombreTxt);
    resultado.push({ avaladorId: ficha.id, porcentaje: p.porcentaje });
  }
  return resultado;
}

// Reemplaza TODAS las filas de jugadores_avales_porcentaje de `jugadorId`
// por `avales` (borra las que ya no estén y agrega las nuevas) — mismo
// criterio de "guardar de una vez la lista completa" que ya usa el resto
// de este sistema para listas chicas administradas desde un formulario
// (nunca un PATCH fila por fila). Se llama DESPUÉS de guardar el jugador
// mismo, dentro de la misma transacción.
async function reemplazarAvalesPorcentaje(client, grupoId, jugadorId, avales) {
  await client.query('DELETE FROM jugadores_avales_porcentaje WHERE grupo_id = $1 AND jugador_id = $2', [grupoId, jugadorId]);
  for (const a of avales) {
    await client.query(
      `INSERT INTO jugadores_avales_porcentaje (grupo_id, jugador_id, avalador_id, porcentaje) VALUES ($1, $2, $3, $4)`,
      [grupoId, jugadorId, a.avaladorId, a.porcentaje]
    );
  }
}

// resolverCuentaComisionPropiaId() (02-10-2026, ver la nota grande de
// buscarOCrearFicha en services/hipismoComisionPropia.js): jugadores.
// cuenta_comision_id sigue siendo el mismo campo de siempre — lo que
// cambia es que ya NO espera a que se guarde un Plano/Remate para
// resolverse solo (esa red de seguridad sigue ahí para clientes viejos,
// ver asegurarCuentasComisionParaNombres, pero deja de ser el camino
// normal) — ahora se resuelve acá mismo, al guardar la ficha, con el
// nombre que el operador escribió en comisionPropiaFicha. Si no hay %
// propio, o si "incluir % en sus jugadas" está en ON, se limpia (null) —
// no hace falta ninguna ficha aparte en esos 2 casos.
async function resolverCuentaComisionPropiaId(grupoId, { comisionPropia, incluirPorcentajeEnJugadas, comisionPropiaFicha, nombreNormalizado }) {
  const pctPropio = Number(comisionPropia) || 0;
  if (!pctPropio || incluirPorcentajeEnJugadas) return null;
  const fichaTxt = (comisionPropiaFicha || '').toString().trim();
  if (!fichaTxt) { const err = new Error('Falta elegir en qué ficha va el % propio de este cliente.'); err.status = 400; throw err; }
  if (normalizarNombreFicha(fichaTxt) === normalizarNombreFicha(nombreNormalizado)) {
    const err = new Error('Para que el % vaya en su misma ficha, activa "Incluir % en sus jugadas" en vez de escribir su propio nombre acá.');
    err.status = 400; throw err;
  }
  const ficha = await buscarOCrearFicha(grupoId, fichaTxt);
  return ficha.id;
}

router.post('/', asyncHandler(async (req, res) => {
  try {
    const { nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados, avalesPorcentaje, incluirPorcentajeEnJugadas, comisionPropiaFicha } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del jugador.' });
    const tipo = tipoCuenta === 'avalado' ? 'avalado' : 'libre';
    const monedaFinal = resolverMonedaJugador(monedaModoDe(req), moneda);
    const nombreNorm = normalizarNombreJugador(nombre);
    const avalesFinal = await normalizarAvalesPorcentaje(req.grupoId, avalesPorcentaje, null, nombreNorm);
    const cuentaComisionIdFinal = await resolverCuentaComisionPropiaId(req.grupoId, { comisionPropia, incluirPorcentajeEnJugadas, comisionPropiaFicha, nombreNormalizado: nombreNorm });
    const jugador = await db.transaccion(async (client) => {
      const r = await client.query(
        `INSERT INTO jugadores (grupo_id, nombre, telefono, notas, activo, tipo_cuenta, pozo_inicial, comision_propia, modelo_comision, moneda, modulos_anclados, incluir_porcentaje_en_jugadas, cuenta_comision_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [req.grupoId, nombreNorm, telefono || null, notas || null, activo !== false, tipo,
          tipo === 'avalado' ? (Number(pozoInicial) || 0) : 0, Number(comisionPropia) || 0, normalizarModeloComisionJugador(modeloComision), monedaFinal, !!modulosAnclados, !!incluirPorcentajeEnJugadas, cuentaComisionIdFinal]
      );
      const nuevo = r.rows[0];
      await reemplazarAvalesPorcentaje(client, req.grupoId, nuevo.id, avalesFinal);
      return nuevo;
    });
    res.status(201).json({ ...jugador, avalesPorcentaje: avalesFinal });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un jugador con ese nombre en este grupo.' });
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear el jugador.' });
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  try {
    const { nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados, avalesPorcentaje, incluirPorcentajeEnJugadas, comisionPropiaFicha } = req.body;
    const tipo = tipoCuenta === 'avalado' ? 'avalado' : 'libre';
    const monedaFinal = resolverMonedaJugador(monedaModoDe(req), moneda);
    const nombreNorm = normalizarNombreJugador(nombre);
    const avalesFinal = await normalizarAvalesPorcentaje(req.grupoId, avalesPorcentaje, req.params.id, nombreNorm);
    const cuentaComisionIdFinal = await resolverCuentaComisionPropiaId(req.grupoId, { comisionPropia, incluirPorcentajeEnJugadas, comisionPropiaFicha, nombreNormalizado: nombreNorm });
    const jugador = await db.transaccion(async (client) => {
      const r = await client.query(
        `UPDATE jugadores SET nombre = $1, telefono = $2, notas = $3, activo = $4, tipo_cuenta = $5,
           pozo_inicial = $6, comision_propia = $7, modelo_comision = $8, moneda = $9, auto_creado = false, modulos_anclados = $10,
           incluir_porcentaje_en_jugadas = $11, cuenta_comision_id = $12
         WHERE id = $13 AND grupo_id = $14 RETURNING *`,
        [nombreNorm, telefono || null, notas || null, activo !== false, tipo,
          tipo === 'avalado' ? (Number(pozoInicial) || 0) : 0, Number(comisionPropia) || 0, normalizarModeloComisionJugador(modeloComision), monedaFinal, !!modulosAnclados, !!incluirPorcentajeEnJugadas, cuentaComisionIdFinal, req.params.id, req.grupoId]
      );
      if (r.rows.length === 0) { const err = new Error('Jugador no encontrado.'); err.status = 404; throw err; }
      const actualizado = r.rows[0];
      await reemplazarAvalesPorcentaje(client, req.grupoId, actualizado.id, avalesFinal);
      return actualizado;
    });
    res.json({ ...jugador, avalesPorcentaje: avalesFinal });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un jugador con ese nombre en este grupo.' });
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar el jugador.' });
  }
}));

// Interruptor rápido de "Anclar módulos" (23-09-2026, a pedido del usuario:
// "hazlo tambien al revez, pero solo sucedera si yo anclo o lo avctivo esa
// funcion al cliente, si no cada pantalla es independiente" — ver la nota
// grande en sql/schema.sql) — aparte del PUT completo de arriba, para poder
// prender/apagar el anclado con un solo click desde pantallas que no abren
// el formulario entero (ej. la pestaña "Clientes" de Hipismo). Body:
// { anclado: true|false }.
router.patch('/:id/modulos-anclados', asyncHandler(async (req, res) => {
  const r = await db.query(
    'UPDATE jugadores SET modulos_anclados = $1 WHERE id = $2 AND grupo_id = $3 RETURNING *',
    [!!req.body.anclado, req.params.id, req.grupoId]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Jugador no encontrado.' });
  res.json(r.rows[0]);
}));

// Borra el registro de administración del jugador (NO su historial de
// jugadas ya procesadas, que vive en tickets_historial por nombre).
router.delete('/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM jugadores WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
  res.status(204).end();
}));

// =================================================================
// AJUSTE DE POZO (23-09-2026, a pedido del usuario: "desde pozo necesito
// seleccionar el cliente y editar el pozo, aumentarlo diminuirlo etc" —
// respondió "Ajuste +/- con motivo" cuando se le preguntó cómo debía
// funcionar). Ver la nota grande en sql/schema.sql, tabla pozo_ajustes:
// nunca se pisa jugadores.pozo_inicial de golpe — cada cambio queda
// guardado (monto +/-, motivo, quién lo hizo) y el pozo vigente es la
// suma. Compartida entre Deportes e Hipismo (misma tabla jugadores).
// Body: { monto: number (+/-), motivo?: string }.
router.post('/:id/pozo-ajuste', asyncHandler(async (req, res) => {
  const monto = Number(req.body.monto);
  if (!monto || isNaN(monto)) return res.status(400).json({ error: 'El ajuste tiene que ser un número distinto de 0 (positivo para aumentar, negativo para disminuir).' });
  const motivo = (req.body.motivo || '').trim() || null;

  try {
    const jugadorActualizado = await db.transaccion(async (client) => {
      const rJug = await client.query('SELECT * FROM jugadores WHERE id = $1 AND grupo_id = $2 FOR UPDATE', [req.params.id, req.grupoId]);
      const jugador = rJug.rows[0];
      if (!jugador) { const err = new Error('Jugador no encontrado.'); err.status = 404; throw err; }
      const pozoResultante = Number(jugador.pozo_inicial) + monto;
      await client.query('UPDATE jugadores SET pozo_inicial = $1 WHERE id = $2', [pozoResultante, jugador.id]);
      await client.query(
        `INSERT INTO pozo_ajustes (grupo_id, jugador_id, monto, motivo, pozo_resultante, usuario)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.grupoId, jugador.id, monto, motivo, pozoResultante, req.nombreActor]
      );
      return { ...jugador, pozo_inicial: pozoResultante };
    });
    res.json(jugadorActualizado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo ajustar el pozo.' });
  }
}));

// Historial de ajustes de pozo de un jugador puntual (más reciente primero).
router.get('/:id/pozo-ajustes', asyncHandler(async (req, res) => {
  const r = await db.query(
    'SELECT id, monto, motivo, pozo_resultante, usuario, creado_en FROM pozo_ajustes WHERE grupo_id = $1 AND jugador_id = $2 ORDER BY creado_en DESC',
    [req.grupoId, req.params.id]
  );
  res.json(r.rows);
}));

// =================================================================
// "REVISAR % AUTOMÁTICOS" (02-10-2026, a pedido explícito del usuario tras
// el rediseño de "elegir ficha a mano": "Quiero revisarlas todas ya" —
// en vez de dejar que cada cliente viejo se vaya actualizando solo de a
// poco a medida que alguien lo edita, este par de endpoints le da al
// operador una sola pantalla con TODO lo que hoy genera algún % (propio o
// de aval), mostrando en qué ficha cae cada uno ahora mismo, para que
// pueda confirmar o renombrar de una vez. No cambia ningún dato por sí
// solo — solo lista; el POST de abajo es el que efectivamente mueve un
// destino a la ficha que el operador escriba.
// =================================================================

// Lista TODO lo que genera % hoy: 1) cada cliente real con % propio
// configurado (comision_propia > 0) y el toggle "incluir % en sus
// jugadas" en OFF (si está en ON, su % ya va directo en sus propias
// jugadas, nunca en una ficha aparte — no aplica acá), mostrando en qué
// ficha cae ahora (cuenta_comision_id / cc_propio_nombre, o null si
// todavía nunca se guardó ninguna y quedaría pendiente de la red de
// seguridad retrocompatible); 2) cada fila de jugadores_avales_porcentaje,
// mostrando quién genera el % y en qué ficha cae hoy (avalador_id/nombre).
router.get('/revisar-comisiones-automaticas', asyncHandler(async (req, res) => {
  const rPropios = await db.query(
    `SELECT j.id, j.nombre, j.comision_propia, j.cuenta_comision_id, cc.nombre AS ficha_nombre
       FROM jugadores j
       LEFT JOIN jugadores cc ON cc.id = j.cuenta_comision_id
      WHERE j.grupo_id = $1
        AND NOT COALESCE(j.es_cuenta_comision, false)
        AND j.comision_propia > 0
        AND NOT COALESCE(j.incluir_porcentaje_en_jugadas, false)
      ORDER BY j.nombre`,
    [req.grupoId]
  );
  const rAvales = await db.query(
    `SELECT jap.id, jap.jugador_id, j.nombre AS jugador_nombre, jap.porcentaje,
            jap.avalador_id, av.nombre AS avalador_nombre
       FROM jugadores_avales_porcentaje jap
       JOIN jugadores j ON j.id = jap.jugador_id
       JOIN jugadores av ON av.id = jap.avalador_id
      WHERE jap.grupo_id = $1
      ORDER BY j.nombre`,
    [req.grupoId]
  );
  res.json({
    propios: rPropios.rows.map(j => ({
      jugadorId: j.id, nombre: j.nombre, porcentaje: Number(j.comision_propia),
      fichaId: j.cuenta_comision_id || null, fichaNombre: j.ficha_nombre || null
    })),
    avales: rAvales.rows.map(a => ({
      avalId: a.id, jugadorId: a.jugador_id, jugadorNombre: a.jugador_nombre,
      porcentaje: Number(a.porcentaje), fichaId: a.avalador_id, fichaNombre: a.avalador_nombre
    }))
  });
}));

// Confirma o renombra, UNO a la vez, la ficha donde cae un % de los que
// lista el GET de arriba. Body: { tipo: 'propio'|'aval', id, fichaNombre }
// — id es jugadorId para 'propio' (ver resolverCuentaComisionPropiaId) o
// avalId (jugadores_avales_porcentaje.id) para 'aval'. El "ya existe un
// cliente real, ¿confirmas?" (si fichaNombre coincide con otro cliente
// real) se resuelve del lado del navegador ANTES de llamar acá (con
// confirm()), igual que en el formulario de Cliente — este endpoint
// confía en que, si lo están llamando, el operador ya confirmó.
router.post('/confirmar-ficha-comision', asyncHandler(async (req, res) => {
  const { tipo, id, fichaNombre } = req.body;
  const fichaTxt = (fichaNombre || '').toString().trim();
  if (!fichaTxt) return res.status(400).json({ error: 'Falta escribir en qué ficha va este %.' });
  if (!id) return res.status(400).json({ error: 'Falta indicar qué % se está confirmando.' });

  try {
    if (tipo === 'aval') {
      const rAval = await db.query(
        `SELECT jap.id, jap.jugador_id, j.nombre AS jugador_nombre
           FROM jugadores_avales_porcentaje jap
           JOIN jugadores j ON j.id = jap.jugador_id
          WHERE jap.id = $1 AND jap.grupo_id = $2`,
        [id, req.grupoId]
      );
      const aval = rAval.rows[0];
      if (!aval) return res.status(404).json({ error: 'No se encontró ese % de aval.' });
      if (normalizarNombreFicha(fichaTxt) === normalizarNombreFicha(aval.jugador_nombre)) {
        return res.status(400).json({ error: 'No puedes mandarle el % a su propia ficha por acá — usa "Incluir % en sus jugadas" para eso.' });
      }
      const ficha = await buscarOCrearFicha(req.grupoId, fichaTxt);
      await db.query('UPDATE jugadores_avales_porcentaje SET avalador_id = $1 WHERE id = $2 AND grupo_id = $3', [ficha.id, id, req.grupoId]);
      return res.json({ tipo: 'aval', avalId: id, jugadorNombre: aval.jugador_nombre, fichaId: ficha.id, fichaNombre: ficha.nombre, esNuevo: ficha.esNuevo });
    }

    if (tipo === 'propio') {
      const rJug = await db.query('SELECT id, nombre FROM jugadores WHERE id = $1 AND grupo_id = $2', [id, req.grupoId]);
      const jugador = rJug.rows[0];
      if (!jugador) return res.status(404).json({ error: 'No se encontró ese cliente.' });
      if (normalizarNombreFicha(fichaTxt) === normalizarNombreFicha(jugador.nombre)) {
        return res.status(400).json({ error: 'Para que el % vaya en su misma ficha, activa "Incluir % en sus jugadas" en vez de escribir su propio nombre acá.' });
      }
      const ficha = await buscarOCrearFicha(req.grupoId, fichaTxt);
      await db.query('UPDATE jugadores SET cuenta_comision_id = $1 WHERE id = $2 AND grupo_id = $3', [ficha.id, id, req.grupoId]);
      return res.json({ tipo: 'propio', jugadorId: id, jugadorNombre: jugador.nombre, fichaId: ficha.id, fichaNombre: ficha.nombre, esNuevo: ficha.esNuevo });
    }

    return res.status(400).json({ error: 'tipo tiene que ser "propio" o "aval".' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'No se pudo confirmar la ficha.' });
  }
}));

module.exports = router;
