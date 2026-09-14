// =================================================================
// HISTORIAL PERSISTENTE (equivalente DB de guardarEnHistorial/leerHistorial)
// + RECONSTRUCCIÓN HISTÓRICA (Balance General y % Devueltos)
// =================================================================
// Portado de app.js (secciones 8 y 9), cambiando localStorage por
// consultas a Postgres. El comportamiento de "reemplazar" el historial de
// una fecha se mantiene igual: se borran las filas viejas de esa
// fecha+grupo y se insertan las nuevas, DENTRO DE UNA TRANSACCIÓN — así el
// usuario puede reprocesar la misma sábana varias veces en el día (a
// medida que más juegos terminan) sin duplicar tickets, y sin dejar la
// tabla a medias si algo falla en el medio.
const db = require('./../db');
const { esEstadoComisionable, calcularComisionTotalCliente, acumularComisionPorTipoJugada } = require('./comisiones');

// Convierte un registro (tanto los que llegan nuevos desde procesarSabana.js
// como una fila ya guardada en tickets_historial, leída con los mismos
// nombres de campo vía alias SQL) en una "firma" de texto comparable — para
// poder saber si dos listas de registros son EXACTAMENTE la misma sábana,
// sin importar en qué orden vengan (ver registrosSinCambios más abajo).
function firmarRegistro(r) {
  return [
    r.cliente,
    r.ticket,
    r.detalle,
    Number(r.arriesga).toFixed(2),
    Number(r.gana).toFixed(2),
    r.estado
  ].join('');
}

// (04-09-2026, a pedido del usuario: "las sabanas finales automaticas de
// whatssap no tengo donde confirmarlas, solo puedo confirmar las manuales,
// corrige eso") — compara lo que se está por guardar contra lo que YA está
// guardado en tickets_historial para (grupoId, fecha). Se usa para no
// desconfirmar el día cuando un reproceso da EXACTAMENTE lo mismo de antes
// (ver el comentario grande en guardarEnHistorial).
async function registrosSinCambios(grupoId, fecha, registrosNuevos) {
  const res = await db.query(
    `SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado
     FROM tickets_historial WHERE grupo_id = $1 AND fecha = $2`,
    [grupoId, fecha]
  );
  if (res.rows.length !== registrosNuevos.length) return false;
  const firmasActuales = res.rows.map(firmarRegistro).sort();
  const firmasNuevas = registrosNuevos.map(firmarRegistro).sort();
  for (let i = 0; i < firmasActuales.length; i++) {
    if (firmasActuales[i] !== firmasNuevas[i]) return false;
  }
  return true;
}

async function guardarEnHistorial(grupoId, fecha, registros) {
  if (!fecha) return;

  // =================================================================
  // (04-09-2026, a pedido del usuario, ver arriba) — LA CAUSA del bug: el
  // panel de WhatsApp llama procesarSabana() (y por lo tanto acá) cada 25
  // segundos SOLO para refrescar resultados en vivo en pantalla (ver
  // whatsapp.js, GET /dias/:fecha/resumen), y hasta ahora CUALQUIER
  // reproceso — tuviera cambios de verdad o no — desconfirmaba el día
  // automáticamente. Entonces aunque el usuario apretara "💾 Guardar Día" a
  // mano sobre una sábana automática, a los 25 segundos el siguiente
  // refresco de fondo se lo volvía a sacar — dando la sensación de que las
  // sábanas de WhatsApp "no tienen dónde confirmarse". Con sábanas pegadas
  // a mano esto no se notaba porque ahí nadie reprocesa la misma fecha
  // solo en segundo plano cada 25 segundos.
  //
  // LA REGLA correcta (ya la explicaba el comentario original de abajo,
  // pero el código no la cumplía al pie de la letra): solo se debe perder
  // la confirmación si los datos DE VERDAD cambiaron por debajo (ej. un
  // juego que estaba en curso terminó, o alguien editó un ticket a mano).
  // Si el reproceso da EXACTAMENTE los mismos registros que ya había
  // guardados, no se toca ni la tabla ni la confirmación — así el día se
  // puede confirmar y se queda confirmado aunque el panel lo siga
  // refrescando solo de fondo.
  // =================================================================
  if (await registrosSinCambios(grupoId, fecha, registros)) return;

  await db.transaccion(async (client) => {
    await client.query('DELETE FROM tickets_historial WHERE grupo_id = $1 AND fecha = $2', [grupoId, fecha]);
    for (const r of registros) {
      // "logros" (08-09-2026, ver la nota grande en sql/schema.sql) —
      // cantidad de patas de este ticket, para poder reconstruir el
      // modelo de comisión 'por_tipo_jugada' sobre un rango histórico sin
      // reprocesar la sábana original. `r.logros` puede venir undefined
      // en llamadas viejas/de pruebas que no lo pasan — queda null.
      await client.query(
        `INSERT INTO tickets_historial (grupo_id, fecha, cliente_nombre, jugador_id, ticket_label, detalle, arriesga, gana, estado, logros)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [grupoId, fecha, r.cliente, r.jugadorId || null, r.ticket, r.detalle, r.arriesga, r.gana, r.estado, r.logros === undefined ? null : r.logros]
      );
    }
  });
  // Solo se llega hasta acá cuando SÍ hubo un cambio real (ver arriba) —
  // así que cualquier confirmación previa de "esta es la sábana final del
  // día" deja de ser válida. El usuario tiene que volver a presionar
  // "💾 Guardar Día" sobre la nueva versión para confirmarla de nuevo. Ver
  // confirmarDia()/desconfirmarDia() más abajo.
  await desconfirmarDia(grupoId, fecha);
}

// --- "Guardar Día" (31-08-2026) ---------------------------------------

// Marca una fecha como la sábana FINAL/oficial del día para ese grupo —
// se llama cuando el usuario presiona "💾 Guardar Día" en el panel, ya con
// los saldos finales a la vista. Upsert: si ya estaba confirmada, solo
// actualiza el horario (confirmarla de nuevo no rompe nada).
async function confirmarDia(grupoId, fecha) {
  if (!fecha) return null;
  const res = await db.query(
    `INSERT INTO dias_confirmados (grupo_id, fecha)
     VALUES ($1, $2)
     ON CONFLICT (grupo_id, fecha) DO UPDATE SET confirmado_en = now()
     RETURNING confirmado_en`,
    [grupoId, fecha]
  );
  const confirmadoEn = res.rows[0] && res.rows[0].confirmado_en;
  return { fecha, confirmado: true, confirmadoEn: confirmadoEn ? new Date(confirmadoEn).toISOString() : null };
}

// Le saca la marca de "confirmada" a una fecha — se llama SOLA cada vez
// que se reprocesa esa fecha (ver guardarEnHistorial arriba), nunca hace
// falta llamarla a mano desde el panel.
async function desconfirmarDia(grupoId, fecha) {
  if (!fecha) return;
  await db.query('DELETE FROM dias_confirmados WHERE grupo_id = $1 AND fecha = $2', [grupoId, fecha]);
}

// Estado de confirmación de UNA fecha puntual — lo usa el panel para
// mostrar el badge "✅ Día confirmado (hora)" / "⚠️ Sin confirmar" cuando
// carga la pestaña Sábana con una fecha ya procesada antes (sin tener que
// reprocesar solo para saber el estado).
async function estadoDia(grupoId, fecha) {
  if (!fecha) return { fecha, confirmado: false, confirmadoEn: null };
  const res = await db.query(
    'SELECT confirmado_en FROM dias_confirmados WHERE grupo_id = $1 AND fecha = $2',
    [grupoId, fecha]
  );
  if (res.rows.length === 0) return { fecha, confirmado: false, confirmadoEn: null };
  const confirmadoEn = res.rows[0].confirmado_en;
  return { fecha, confirmado: true, confirmadoEn: confirmadoEn ? new Date(confirmadoEn).toISOString() : null };
}

// Qué fechas (de la lista `fechas`) ya están confirmadas — usado por el
// historial por cliente (routes/reportes.js) para mostrarle a cada
// ticket/día un badge de "sábana oficial" sin consultar fecha por fecha.
// Devuelve un Set de fechas en formato 'YYYY-MM-DD'.
async function fechasConfirmadas(grupoId, fechas) {
  if (!fechas || fechas.length === 0) return new Set();
  const res = await db.query(
    'SELECT fecha FROM dias_confirmados WHERE grupo_id = $1 AND fecha = ANY($2::date[])',
    [grupoId, fechas]
  );
  return new Set(res.rows.map(r => (r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha)));
}

// Resumen de confirmación de un RANGO de fechas (01-09-2026, a pedido del
// usuario): Balance General y % Devueltos trabajan sobre un rango, no una
// fecha puntual como la pestaña Sábana — así que en vez de un solo
// badge, acá se cuenta cuántos de los días del rango que SÍ tuvieron
// sábana procesada (hay fila en tickets_historial) ya están confirmados
// ("💾 Guardar Día") y cuáles todavía no, para que el panel pueda avisar
// "estos números pueden cambiar todavía" sin tener que consultar fecha
// por fecha.
async function resumenConfirmacionRango(grupoId, desde, hasta) {
  const condiciones = ['grupo_id = $1'];
  const params = [grupoId];
  if (desde) { params.push(desde); condiciones.push('fecha >= $' + params.length); }
  if (hasta) { params.push(hasta); condiciones.push('fecha <= $' + params.length); }
  const res = await db.query(
    `SELECT DISTINCT fecha FROM tickets_historial WHERE ${condiciones.join(' AND ')}`,
    params
  );
  const fechas = res.rows.map(r => (r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha));
  const confirmadas = await fechasConfirmadas(grupoId, fechas);
  const fechasSinConfirmar = fechas.filter(f => !confirmadas.has(f)).sort();
  return { totalDias: fechas.length, diasConfirmados: confirmadas.size, fechasSinConfirmar };
}

// Lee el historial de un grupo, opcionalmente filtrado por rango de
// fechas y/o cliente — equivalente a leerHistorial().filter(...) de la
// app original, pero resuelto con SQL en vez de en memoria.
async function leerHistorial(grupoId, { desde, hasta, cliente } = {}) {
  const condiciones = ['grupo_id = $1'];
  const params = [grupoId];
  if (desde) { params.push(desde); condiciones.push('fecha >= $' + params.length); }
  if (hasta) { params.push(hasta); condiciones.push('fecha <= $' + params.length); }
  if (cliente) { params.push(cliente); condiciones.push('cliente_nombre = $' + params.length); }
  const res = await db.query(
    `SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros
     FROM tickets_historial WHERE ${condiciones.join(' AND ')} ORDER BY fecha, creado_en`,
    params
  );
  return res.rows.map(r => ({
    id: r.id,
    fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha,
    cliente: r.cliente,
    ticket: r.ticket,
    detalle: r.detalle,
    arriesga: Number(r.arriesga),
    gana: Number(r.gana),
    estado: r.estado,
    // "logros" (08-09-2026, ver comisiones.js) — puede venir null en filas
    // guardadas ANTES de que esta columna existiera; se deja tal cual
    // (null), acumularComisionPorTipoJugada() lo trata como "0 logros".
    logros: r.logros === null || r.logros === undefined ? null : Number(r.logros)
  }));
}

// Un ticket puntual por su id (para editarlo desde la pestaña "Sábanas" de
// Administración, ver sabanaDia.js) — null si no existe O si es de otro
// grupo (nunca se filtra solo por id a secas, siempre grupo_id + id).
async function obtenerTicketPorId(grupoId, id) {
  const res = await db.query(
    `SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros
     FROM tickets_historial WHERE grupo_id = $1 AND id = $2`,
    [grupoId, id]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha,
    cliente: r.cliente,
    ticket: r.ticket,
    detalle: r.detalle,
    arriesga: Number(r.arriesga),
    gana: Number(r.gana),
    estado: r.estado,
    logros: r.logros === null || r.logros === undefined ? null : Number(r.logros)
  };
}

// Edita a mano un ticket YA GUARDADO — desde la nueva pestaña "Sábanas" de
// Administración (02-09-2026, a pedido del usuario: "creame una pestaña
// que se llame sábanas ... tenga un botón para editar la sábana"). Se
// puede tocar cliente/arriesga/gana/estado (lo que el usuario confirmó
// que quería poder editar); cualquier campo que no venga en `cambios`
// queda intacto. Devuelve {anterior, nuevo, cambios} — `cambios` es la
// lista de los campos que DE VERDAD cambiaron (para armar el mensaje de
// la alerta TICKET_EDITADO en sabanaDia.js; si el admin abre el modal y
// guarda sin tocar nada, cambios queda vacío y no se genera alerta).
//
// A PROPÓSITO esto no tiene ninguna protección especial: si más adelante
// se vuelve a procesar la MISMA fecha, guardarEnHistorial() de arriba
// borra e inserta de cero, así que la edición manual se pisa igual que
// cualquier otro ticket de esa fecha — así lo confirmó el usuario
// (pregunta aclaratoria del 02-09-2026).
async function editarTicket(grupoId, id, cambios) {
  const actual = await obtenerTicketPorId(grupoId, id);
  if (!actual) {
    const err = new Error('Ese ticket no existe (o no pertenece a este grupo).');
    err.status = 404;
    throw err;
  }

  const columnas = [];
  const params = [];
  const cambiosDetectados = [];

  function tocar(columna, etiqueta, valorNuevoCrudo, valorViejo) {
    if (valorNuevoCrudo === undefined) return;
    params.push(valorNuevoCrudo);
    columnas.push(columna + ' = $' + params.length);
    if (String(valorViejo) !== String(valorNuevoCrudo)) {
      cambiosDetectados.push({ campo: etiqueta, antes: valorViejo, despues: valorNuevoCrudo });
    }
  }

  tocar('cliente_nombre', 'Cliente', cambios.cliente !== undefined ? String(cambios.cliente).trim().toUpperCase() : undefined, actual.cliente);
  tocar('arriesga', 'Arriesga', cambios.arriesga !== undefined ? Number(cambios.arriesga) : undefined, actual.arriesga);
  tocar('gana', 'Gana', cambios.gana !== undefined ? Number(cambios.gana) : undefined, actual.gana);
  tocar('estado', 'Estado', cambios.estado !== undefined ? String(cambios.estado).trim().toUpperCase() : undefined, actual.estado);

  if (columnas.length === 0) return { anterior: actual, nuevo: actual, cambios: [] };

  params.push(grupoId, id);
  await db.query(
    `UPDATE tickets_historial SET ${columnas.join(', ')} WHERE grupo_id = $${params.length - 1} AND id = $${params.length}`,
    params
  );

  // Igual que reprocesar la sábana (guardarEnHistorial, arriba): si el
  // ticket de esta fecha cambió, cualquier "💾 Guardar Día" previo de esa
  // fecha deja de ser válido.
  if (cambiosDetectados.length > 0) await desconfirmarDia(grupoId, actual.fecha);

  const nuevo = await obtenerTicketPorId(grupoId, id);
  return { anterior: actual, nuevo, cambios: cambiosDetectados };
}

// Reconstruye un objeto con la MISMA forma que "resumenClientes" (el que
// se arma en vivo al procesar una sábana) a partir del historial guardado,
// para cualquier rango de fechas — así se puede reutilizar
// calcularComisionTotalCliente tal cual en Balance General y % Devueltos.
//
// modeloComision/tiers (08-09-2026, opcionales) — se va acumulando
// SIEMPRE `comisionPorTipoAcumulada` por cliente (mismo campo y misma
// regla que procesarSabana.js, vía acumularComisionPorTipoJugada — ver
// comisiones.js para el porqué de factorizarlo), sin importar qué diga
// `modeloComision` acá — quien de verdad decide, POR CLIENTE, si se usa
// este valor o el plano (arriesgadoComisionable*pct) es
// calcularComisionTotalCliente() más adelante (09-09-2026, "grupo mixto"
// — ver la nota grande en comisiones.js, necesario para que un cliente
// con una excepción individual a 'por_tipo_jugada' tenga este dato
// disponible aunque el grupo por defecto esté en 'plano'). El parámetro
// `modeloComision` de esta función queda sin uso a propósito — se
// mantiene por compatibilidad con quien ya la llama con 4-5 argumentos.
// Si `tiers` viene vacío (grupo 100% 'plano', sin ninguna excepción),
// esto no cambia nada: porcentajePorTipoJugada() da 0% siempre.
async function calcularResumenHistorico(grupoId, desde, hasta, modeloComision, tiers) {
  const historial = await leerHistorial(grupoId, { desde, hasta });
  const resumen = {};
  historial.forEach(h => {
    if (!resumen[h.cliente]) {
      resumen[h.cliente] = { arriesgado: 0, arriesgadoComisionable: 0, ganado: 0, perdido: 0, pendientes: 0 };
    }
    const rc = resumen[h.cliente];
    rc.arriesgado += h.arriesga;
    if (esEstadoComisionable(h.estado)) rc.arriesgadoComisionable += h.arriesga;
    if (h.estado === 'GANADA') rc.ganado += h.gana;
    if (h.estado === 'PERDIDA') rc.perdido += h.arriesga;
    if (h.estado === 'PENDIENTE' || h.estado === 'FALTA CERRAR EN SÁBANA' || h.estado === 'NULA (FALTA LOGRO)' || h.estado === 'NULA (SIN JUGADA)' || h.estado === 'SUSPENDIDA') {
      rc.pendientes += 1;
    }
    acumularComisionPorTipoJugada(rc, { arriesga: h.arriesga, estado: h.estado, logros: h.logros }, tiers);
  });
  return resumen;
}

// Detalle día por día de todo el % devuelto a cada jugador (propio + por
// avalados) dentro de un rango de fechas.
//
// configComision (08-09-2026, opcional) — { modelo, tiers,
// modelosPorCliente }, ver la nota grande en comisiones.js. Cada bucket
// por fecha SIEMPRE acumula `comisionPorTipoAcumulada` (mismo mecanismo
// que calcularResumenHistorico arriba, sin importar el modelo default del
// grupo — 09-09-2026, "grupo mixto"), y calcularComisionTotalCliente es
// quien decide, POR CLIENTE, si usa ese valor o el plano
// (arriesgadoComisionable*pct). Si se omite `configComision` por
// completo, comportamiento de siempre.
async function calcularComisionesDetalladas(grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision) {
  const historial = await leerHistorial(grupoId, { desde, hasta });
  const modeloPorTipo = !!(configComision && configComision.modelo === 'por_tipo_jugada');
  const modelosPorCliente = (configComision && configComision.modelosPorCliente) || {};
  // (09-09-2026, "grupo mixto") true si ALGÚN jugador de este grupo tiene
  // una excepción individual a 'por_tipo_jugada' cargada — hace falta
  // para la misma corrección de "todosClientes" de más abajo, aunque el
  // modelo DEFAULT del grupo sea 'plano'.
  const hayExcepcionesPorTipo = Object.values(modelosPorCliente).some(m => m === 'por_tipo_jugada');
  const tiers = configComision && configComision.tiers;

  const porFecha = {};
  historial.forEach(h => {
    if (!porFecha[h.fecha]) porFecha[h.fecha] = {};
    if (!porFecha[h.fecha][h.cliente]) {
      porFecha[h.fecha][h.cliente] = { arriesgado: 0, arriesgadoComisionable: 0, ganado: 0, perdido: 0, pendientes: 0 };
    }
    const rc = porFecha[h.fecha][h.cliente];
    rc.arriesgado += h.arriesga;
    if (esEstadoComisionable(h.estado)) rc.arriesgadoComisionable += h.arriesga;
    if (h.estado === 'GANADA') rc.ganado += h.gana;
    if (h.estado === 'PERDIDA') rc.perdido += h.arriesga;
    acumularComisionPorTipoJugada(rc, { arriesga: h.arriesga, estado: h.estado, logros: h.logros }, tiers);
  });

  const todosClientes = new Set();
  Object.keys(porcentajesPropios).forEach(c => todosClientes.add(c));
  Object.keys(avalesMap).forEach(c => todosClientes.add(c));
  // (08-09-2026, extendido 09-09-2026 para "grupo mixto") En el modelo
  // 'por_tipo_jugada' el % NO sale de jugadores.comision_propia (por eso
  // porcentajesPropios puede venir vacío) — es un juego de tiers del
  // GRUPO que le aplica a cualquier cliente que haya jugado. Sin esto, un
  // cliente sin % propio configurado (normal en este modelo, ya que el %
  // no es "de él") nunca hubiera entrado a `todosClientes` y su comisión
  // reconstruida se perdía por completo de este desglose, aunque
  // calcularResumenHistorico() sí la calculara bien. Lo mismo aplica
  // ahora cuando el grupo está en 'plano' pero ALGÚN cliente puntual
  // tiene la excepción 'por_tipo_jugada' cargada (hayExcepcionesPorTipo) —
  // sin esto ese cliente puntual se perdería del desglose exactamente
  // igual, aunque el resto del grupo esté en 'plano'.
  if (modeloPorTipo || hayExcepcionesPorTipo) {
    Object.keys(porFecha).forEach(fecha => {
      Object.keys(porFecha[fecha]).forEach(c => todosClientes.add(c));
    });
  }

  const resultado = {};
  todosClientes.forEach(cliente => { resultado[cliente] = { total: 0, detalle: [] }; });

  Object.keys(porFecha).sort().forEach(fecha => {
    todosClientes.forEach(cliente => {
      const c = calcularComisionTotalCliente(cliente, porFecha[fecha], porcentajesPropios, avalesMap, configComision);
      if (Math.abs(c.total) > 0.001) {
        resultado[cliente].detalle.push({
          fecha,
          comisionPropia: c.comisionPropia,
          comisionAval: c.comisionAval,
          total: c.total
        });
        resultado[cliente].total += c.total;
      }
    });
  });

  return resultado;
}

function formatearFechaISO(d) {
  return d.toISOString().split('T')[0];
}

// Rango rápido (hoy/semana actual lunes-domingo/últimos 30 días/todo el
// historial) — igual que en la app original. "todo" necesita consultar la
// fecha más antigua del historial, así que es async.
async function calcularRangoRapido(grupoId, tipo) {
  const hoy = new Date();
  if (tipo === 'hoy') {
    return { desde: formatearFechaISO(hoy), hasta: formatearFechaISO(hoy) };
  }
  if (tipo === 'semana') {
    const diaSemana = hoy.getDay();
    const diffHastaLunes = (diaSemana === 0) ? -6 : (1 - diaSemana);
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() + diffHastaLunes);
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    return { desde: formatearFechaISO(lunes), hasta: formatearFechaISO(domingo) };
  }
  if (tipo === 'mes') {
    const d = new Date(hoy);
    d.setDate(d.getDate() - 29);
    return { desde: formatearFechaISO(d), hasta: formatearFechaISO(hoy) };
  }
  if (tipo === 'todo') {
    const res = await db.query('SELECT MIN(fecha) AS min_fecha FROM tickets_historial WHERE grupo_id = $1', [grupoId]);
    const minFecha = res.rows[0] && res.rows[0].min_fecha;
    return {
      desde: minFecha ? (minFecha instanceof Date ? formatearFechaISO(minFecha) : minFecha) : formatearFechaISO(hoy),
      hasta: formatearFechaISO(hoy)
    };
  }
  return null;
}

module.exports = {
  guardarEnHistorial,
  confirmarDia,
  desconfirmarDia,
  estadoDia,
  fechasConfirmadas,
  resumenConfirmacionRango,
  leerHistorial,
  obtenerTicketPorId,
  editarTicket,
  calcularResumenHistorico,
  calcularComisionesDetalladas,
  calcularRangoRapido,
  formatearFechaISO
};
