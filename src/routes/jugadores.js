// Administración > Jugador (registro fijo de clientes, % propio, tipo de
// cuenta libre/avalado y su pozo) + Avales ("Avalados por").
const express = require('express');
const db = require('../db');
const { requiereGrupo, requierePermiso, monedaModoDe } = require('../middleware/auth');
const { calcularPozoJugador } = require('../services/pozo');
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
  const r = await db.query('SELECT * FROM jugadores WHERE grupo_id = $1 ORDER BY nombre', [req.grupoId]);
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
  const conPozo = await Promise.all(r.rows.map(async j => {
    const pozo = j.tipo_cuenta === 'avalado' ? await calcularPozoJugador(req.grupoId, j) : null;
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
// Valida y devuelve la lista normalizada [{ avaladorId, porcentaje }] a
// partir de `avalesPorcentaje` del body: cada avaladorId tiene que ser
// OTRO jugador ya registrado en el MISMO grupo (nunca el propio jugador
// que se está editando, nunca repetido, nunca de otro grupo), y cada
// porcentaje tiene que ser un número mayor que 0 (una fila con % vacío o
// en 0 simplemente se descarta, igual que el resto de los formularios de
// este sistema).
async function normalizarAvalesPorcentaje(grupoId, avalesPorcentaje, propioId) {
  const lista = Array.isArray(avalesPorcentaje) ? avalesPorcentaje : [];
  const vistos = new Set();
  const resultado = [];
  for (const entrada of lista) {
    const avaladorId = ((entrada && entrada.avaladorId) || '').toString().trim();
    const porcentaje = Number(entrada && entrada.porcentaje);
    if (!avaladorId || !porcentaje || porcentaje <= 0) continue;
    if (propioId && avaladorId === propioId) { const err = new Error('Un cliente no puede ser su propio avalador.'); err.status = 400; throw err; }
    if (vistos.has(avaladorId)) { const err = new Error('No puedes elegir el mismo avalador dos veces — junta el % en una sola fila.'); err.status = 400; throw err; }
    vistos.add(avaladorId);
    resultado.push({ avaladorId, porcentaje });
  }
  if (resultado.length) {
    const r = await db.query('SELECT id FROM jugadores WHERE grupo_id = $1 AND id = ANY($2::uuid[])', [grupoId, resultado.map(a => a.avaladorId)]);
    if (r.rows.length !== resultado.length) { const err = new Error('Alguno de los avaladores seleccionados no existe en este grupo.'); err.status = 400; throw err; }
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

router.post('/', asyncHandler(async (req, res) => {
  try {
    const { nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados, avalesPorcentaje, incluirPorcentajeEnJugadas } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del jugador.' });
    const tipo = tipoCuenta === 'avalado' ? 'avalado' : 'libre';
    const monedaFinal = resolverMonedaJugador(monedaModoDe(req), moneda);
    const avalesFinal = await normalizarAvalesPorcentaje(req.grupoId, avalesPorcentaje, null);
    const jugador = await db.transaccion(async (client) => {
      const r = await client.query(
        `INSERT INTO jugadores (grupo_id, nombre, telefono, notas, activo, tipo_cuenta, pozo_inicial, comision_propia, modelo_comision, moneda, modulos_anclados, incluir_porcentaje_en_jugadas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [req.grupoId, normalizarNombreJugador(nombre), telefono || null, notas || null, activo !== false, tipo,
          tipo === 'avalado' ? (Number(pozoInicial) || 0) : 0, Number(comisionPropia) || 0, normalizarModeloComisionJugador(modeloComision), monedaFinal, !!modulosAnclados, !!incluirPorcentajeEnJugadas]
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
    const { nombre, telefono, notas, activo, tipoCuenta, pozoInicial, comisionPropia, modeloComision, moneda, modulosAnclados, avalesPorcentaje, incluirPorcentajeEnJugadas } = req.body;
    const tipo = tipoCuenta === 'avalado' ? 'avalado' : 'libre';
    const monedaFinal = resolverMonedaJugador(monedaModoDe(req), moneda);
    const avalesFinal = await normalizarAvalesPorcentaje(req.grupoId, avalesPorcentaje, req.params.id);
    const jugador = await db.transaccion(async (client) => {
      const r = await client.query(
        `UPDATE jugadores SET nombre = $1, telefono = $2, notas = $3, activo = $4, tipo_cuenta = $5,
           pozo_inicial = $6, comision_propia = $7, modelo_comision = $8, moneda = $9, auto_creado = false, modulos_anclados = $10,
           incluir_porcentaje_en_jugadas = $11
         WHERE id = $12 AND grupo_id = $13 RETURNING *`,
        [normalizarNombreJugador(nombre), telefono || null, notas || null, activo !== false, tipo,
          tipo === 'avalado' ? (Number(pozoInicial) || 0) : 0, Number(comisionPropia) || 0, normalizarModeloComisionJugador(modeloComision), monedaFinal, !!modulosAnclados, !!incluirPorcentajeEnJugadas, req.params.id, req.grupoId]
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

module.exports = router;
