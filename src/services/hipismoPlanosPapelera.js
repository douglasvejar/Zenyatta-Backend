// =================================================================
// "PAPELERA RECUPERABLE" para "Eliminar Planos" en Hipismo (23-09-2026, a
// pedido del usuario: "en apuestas crea un boton de eliminar planos,
// alli me saldran todos los planos, yo seleccionare la fecha que quiero
// que me muestre y despues se desplegaran ordenados por hipodromos por
// carrera todos los planos").
//
// MISMO criterio ya usado para Deportes (services/papeleraSabana.js, a
// raíz de la respuesta textual del usuario en esa ronda: "papelera
// recuperable... es información contable, un borrado por error o mal
// intencionado puede ser grave") — acá no se preguntó de nuevo porque es
// el MISMO tipo de dato (un plano ya calculado, con plata real de
// clientes adentro) y el mismo criterio ya está establecido en el resto
// del sistema: antes de borrar de verdad, se guarda una copia completa
// (el plano + todos sus tickets) en hipismo_planos_papelera, recuperable
// con restaurarPlano() mientras no se haya purgado (30 días).
//
// ACTUALIZACIÓN (23-09-2026, duodécima-tercera ronda): en la ronda
// anterior se decidió, sin preguntar, que ESTE borrado NO generara
// alerta (a diferencia de la Papelera de Deportes) porque acá es
// plano-por-plano con el operador mirando la lista completa. El usuario
// pidió ahora explícitamente lo contrario ("si el plano lo eliminan se
// genera la alerta igual mente... indicando que se edito y que usuario
// se edito"), así que DELETE /planos/:id en routes/hipismo.js ahora SÍ
// llama registrarAlerta() (tipo PLANO_ELIMINADO) después de que esta
// función hace su trabajo — a propósito NO se movió esa llamada para
// ACÁ ADENTRO, para que este servicio siga siendo un módulo de
// bajo nivel (mover/copiar filas) sin saber nada de "quién" está
// operando (req.nombreActor) ni de la tabla de alertas.
const db = require('./../db');

const DIAS_ANTES_DE_PURGAR = 30;

async function purgarVencidas(grupoId) {
  await db.query(
    `DELETE FROM hipismo_planos_papelera WHERE grupo_id = $1 AND eliminado_en < now() - interval '${DIAS_ANTES_DE_PURGAR} days'`,
    [grupoId]
  );
}

// Borra UN plano puntual (y sus tickets) guardando antes una copia
// completa en la Papelera. Devuelve el id de la fila de Papelera creada.
async function eliminarPlano(grupoId, planoId) {
  return db.transaccion(async (client) => {
    const rPlano = await client.query('SELECT * FROM hipismo_planos WHERE id = $1 AND grupo_id = $2', [planoId, grupoId]);
    const plano = rPlano.rows[0];
    if (!plano) {
      const err = new Error('Ese plano no existe (puede que ya lo hayan eliminado).');
      err.status = 404;
      throw err;
    }
    const rTickets = await client.query('SELECT * FROM hipismo_tickets WHERE plano_id = $1', [planoId]);

    const rPapelera = await client.query(
      `INSERT INTO hipismo_planos_papelera (grupo_id, fecha, hipodromo_nombre, carrera_numero, plano_json, tickets_json)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [grupoId, plano.fecha, plano.hipodromo_nombre, plano.carrera_numero, JSON.stringify(plano), JSON.stringify(rTickets.rows)]
    );

    await client.query('DELETE FROM hipismo_planos WHERE id = $1 AND grupo_id = $2', [planoId, grupoId]);

    return { papeleraId: rPapelera.rows[0].id, fecha: plano.fecha, hipodromoNombre: plano.hipodromo_nombre, carreraNumero: plano.carrera_numero };
  });
}

// Lista lo que hay en la Papelera de un grupo (purga primero lo vencido).
async function listarPapelera(grupoId) {
  await purgarVencidas(grupoId);
  const res = await db.query(
    `SELECT id, fecha, hipodromo_nombre, carrera_numero, plano_json, tickets_json, eliminado_en, restaurado_en
       FROM hipismo_planos_papelera WHERE grupo_id = $1 ORDER BY eliminado_en DESC`,
    [grupoId]
  );
  const ahora = Date.now();
  return res.rows.map(r => {
    const eliminadoEn = new Date(r.eliminado_en).getTime();
    const diasPasados = Math.floor((ahora - eliminadoEn) / (24 * 60 * 60 * 1000));
    const planoJson = typeof r.plano_json === 'string' ? JSON.parse(r.plano_json) : r.plano_json;
    const ticketsJson = typeof r.tickets_json === 'string' ? JSON.parse(r.tickets_json) : r.tickets_json;
    return {
      id: r.id,
      fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha,
      hipodromoNombre: r.hipodromo_nombre,
      carreraNumero: r.carrera_numero,
      cantidadTickets: Array.isArray(ticketsJson) ? ticketsJson.length : 0,
      comisionTotal: planoJson ? Number(planoJson.comision_total) : 0,
      eliminadoEn: r.eliminado_en,
      restaurado: !!r.restaurado_en,
      diasRestantes: Math.max(0, DIAS_ANTES_DE_PURGAR - diasPasados)
    };
  });
}

// Restaura una entrada de la Papelera: reinserta el plano y sus tickets
// en las tablas en vivo (con los MISMOS ids que tenían).
async function restaurarPlano(grupoId, papeleraId) {
  const res = await db.query(
    'SELECT id, plano_json, tickets_json, restaurado_en FROM hipismo_planos_papelera WHERE grupo_id = $1 AND id = $2',
    [grupoId, papeleraId]
  );
  if (res.rows.length === 0) {
    const err = new Error('No se encontró esa entrada de la Papelera (puede que ya se haya purgado después de 30 días).');
    err.status = 404;
    throw err;
  }
  const fila = res.rows[0];
  if (fila.restaurado_en) {
    const err = new Error('Ese plano ya fue restaurado antes.');
    err.status = 400;
    throw err;
  }

  const plano = typeof fila.plano_json === 'string' ? JSON.parse(fila.plano_json) : fila.plano_json;
  const tickets = typeof fila.tickets_json === 'string' ? JSON.parse(fila.tickets_json) : fila.tickets_json;

  await db.transaccion(async (client) => {
    await client.query(
      `INSERT INTO hipismo_planos (id, grupo_id, hipodromo_id, hipodromo_nombre, carrera_numero, fecha, ret, pizarra, cruza_jugadas, texto_original, texto_resultado, comision_total, creado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [plano.id, grupoId, plano.hipodromo_id, plano.hipodromo_nombre, plano.carrera_numero, plano.fecha, plano.ret, plano.pizarra, plano.cruza_jugadas, plano.texto_original, plano.texto_resultado, plano.comision_total, plano.creado_en]
    );
    for (const t of (tickets || [])) {
      await client.query(
        `INSERT INTO hipismo_tickets (id, plano_id, grupo_id, cliente_nombre, banquero_nombre, modalidad, caballo, monto, resultado_jugador, resultado_banquero, creado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, t.plano_id, grupoId, t.cliente_nombre, t.banquero_nombre, t.modalidad, t.caballo, t.monto, t.resultado_jugador, t.resultado_banquero, t.creado_en]
      );
    }
    await client.query('UPDATE hipismo_planos_papelera SET restaurado_en = now() WHERE id = $1', [papeleraId]);
  });

  return { plano, ticketsRestaurados: (tickets || []).length };
}

module.exports = { eliminarPlano, listarPapelera, restaurarPlano };
