// =================================================================
// RENOMBRAR UN CLIENTE EN TODO HIPISMO (19-11-2026, a pedido del usuario: "en Oficinas, donde se crea a los clientes, agrégale un
// botón de EDITAR para editar el nombre o agregarle si se les devuelve o producen algún %... se recalculan todas sus carreras
// automáticamente... esto aplica también para los grupos").
//
// Por qué hace falta: las jugadas guardadas (tickets de planos, jugadas de oficina, adelantadas, remates, winners, ajustes de
// comisión, jugadas del bot...) llevan el NOMBRE del cliente escrito, no su id. Los reportes (Balance General, Cierre Final, Pozos,
// Comisiones, Registro...) emparejan jugadores.nombre contra ese texto con igualdad exacta. Si solo se cambia jugadores.nombre, todo
// lo que ya se jugó queda con el nombre viejo: el cliente "pierde" su historial y aparece un cliente fantasma. Por eso, cuando el
// nombre cambia, se mueve TODO a la vez, dentro de la misma transacción que actualiza al cliente (si algo falla, no cambia nada).
//
// El % que se le devuelve (jugadores.comision_propia, su ficha y los % que le genera a otros) NO se guarda dentro de ninguna
// carrera: todos los reportes lo leen de la ficha del cliente cada vez que se calculan. Por eso, cambiar un % recalcula
// automáticamente TODAS sus carreras (las de hoy y las ya cerradas) sin tocar nada más; esta función solo se ocupa del nombre.
// =================================================================

// [tabla, columna]: todas llevan grupo_id. Si alguna tabla todavía no existe en una base vieja, se salta (savepoint).
const COLUMNAS_NOMBRE = [
  ['hipismo_tickets', 'cliente_nombre'],
  ['hipismo_tickets', 'banquero_nombre'],
  ['hipismo_remate_apuestas', 'cliente_nombre'],
  ['hipismo_remates', 'cliente_ganador'],
  ['hipismo_adelantadas_jugadas', 'cliente_nombre'],
  ['hipismo_tercios_adelantadas_jugadas', 'jugador_nombre'],
  ['hipismo_tercios_adelantadas_jugadas', 'banquero_nombre'],
  ['hipismo_comisiones_ajustes', 'cliente_nombre'],
  ['hipismo_winners', 'cliente_nombre'],
  ['hipismo_cargas_especiales_lineas', 'cliente_nombre'],
  ['hipismo_chat_jugadas', 'jugador_nombre'],
  ['hipismo_chat_jugadas', 'banquero_nombre'],
  ['hipismo_chat_numeros', 'jugador_nombre']
];

function normalizar(n) { return String(n || '').trim().toUpperCase().replace(/\s+/g, ' '); }
function escaparRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Ejecuta una sentencia que puede fallar solo porque la tabla/columna aún no existe, sin abortar la transacción.
async function intentar(client, sql, params) {
  await client.query('SAVEPOINT renombrar_cliente');
  try {
    const r = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT renombrar_cliente');
    return r;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT renombrar_cliente');
    await client.query('RELEASE SAVEPOINT renombrar_cliente');
    if (e && (e.code === '42P01' || e.code === '42703')) return null;
    throw e;
  }
}

// Reemplaza el nombre dentro de las listas de jugadas guardadas como JSON (Hipismo Oficinas): [{ jugador, lado, tipo, caballo, monto }].
const SQL_JSON = (tabla, col) => `
  UPDATE ${tabla} SET ${col} = (
    SELECT COALESCE(jsonb_agg(CASE WHEN e->>'jugador' = $2::text THEN jsonb_set(e, '{jugador}', to_jsonb($3::text)) ELSE e END ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(${col}) WITH ORDINALITY AS t(e, ord))
   WHERE grupo_id = $1 AND jsonb_typeof(${col}) = 'array'
     AND ${col} @> jsonb_build_array(jsonb_build_object('jugador', $2::text))`;

// ¿Hay otro cliente cuyo nombre contiene este como palabras sueltas (PEDRO / PEDRO LUIS)? Entonces reemplazar dentro de textos libres
// sería ambiguo: en ese caso los textos no se tocan (los datos reales, arriba, sí se mueven siempre).
function esAmbiguoEnTextos(viejo, otrosNombres) {
  const v = ' ' + viejo + ' ';
  return otrosNombres.some(o => (' ' + normalizar(o) + ' ').includes(v));
}

// Mueve el nombre viejo al nuevo en todas las tablas de Hipismo del grupo. `client` = conexión de la transacción abierta.
// Devuelve { renombrado, carreras } (carreras = cuántas carreras tenían jugadas de este cliente).
async function renombrarClienteEnHipismo(client, grupoId, nombreViejo, nombreNuevo, otrosNombres) {
  const viejo = normalizar(nombreViejo), nuevo = normalizar(nombreNuevo);
  if (!viejo || !nuevo || viejo === nuevo) return { renombrado: false, carreras: 0 };

  // Cuántas carreras toca (para avisarle al usuario "se recalcularon N carreras").
  let carreras = 0;
  const rc = await intentar(client,
    `SELECT (SELECT COUNT(DISTINCT t.plano_id) FROM hipismo_tickets t WHERE t.grupo_id = $1 AND (t.cliente_nombre = $2 OR t.banquero_nombre = $2))
          + (SELECT COUNT(DISTINCT a.plano_id) FROM hipismo_tercios_adelantadas_jugadas a WHERE a.grupo_id = $1 AND (a.jugador_nombre = $2 OR a.banquero_nombre = $2)) AS n`,
    [grupoId, viejo]);
  if (rc && rc.rows[0]) carreras = Number(rc.rows[0].n) || 0;

  for (const [tabla, col] of COLUMNAS_NOMBRE) {
    await intentar(client, `UPDATE ${tabla} SET ${col} = $3 WHERE grupo_id = $1 AND ${col} = $2`, [grupoId, viejo, nuevo]);
  }
  // Clientes marcados para que NO salgan en el plano de pozos: la clave es (grupo, nombre).
  const yaEsta = await intentar(client, 'SELECT 1 FROM hipismo_pozos_excluidos WHERE grupo_id = $1 AND nombre = $2', [grupoId, nuevo]);
  if (yaEsta && yaEsta.rows.length) await intentar(client, 'DELETE FROM hipismo_pozos_excluidos WHERE grupo_id = $1 AND nombre = $2', [grupoId, viejo]);
  else await intentar(client, 'UPDATE hipismo_pozos_excluidos SET nombre = $3 WHERE grupo_id = $1 AND nombre = $2', [grupoId, viejo, nuevo]);

  // Jugadas de Oficinas guardadas como JSON (para poder reabrir y corregir la carrera).
  await intentar(client, SQL_JSON('hipismo_planos', 'jugadas_oficina'), [grupoId, viejo, nuevo]);
  await intentar(client, SQL_JSON('hipismo_oficinas_pendientes', 'jugadas'), [grupoId, viejo, nuevo]);

  // Textos de los planos (lo pegado y lo resuelto): solo si el nombre no se confunde con el de otro cliente.
  if (!esAmbiguoEnTextos(viejo, otrosNombres || [])) {
    const patron = '(^|[^[:alnum:]])' + escaparRegex(viejo) + '([^[:alnum:]]|$)';
    for (const col of ['texto_resultado', 'texto_original']) {
      await intentar(client,
        `UPDATE hipismo_planos SET ${col} = regexp_replace(${col}, $2, '\\1' || $3 || '\\2', 'gi') WHERE grupo_id = $1 AND ${col} ~* $2`,
        [grupoId, patron, nuevo.replace(/\\/g, '\\\\')]);
    }
  }
  return { renombrado: true, carreras };
}

module.exports = { renombrarClienteEnHipismo, COLUMNAS_NOMBRE, _normalizar: normalizar, _esAmbiguoEnTextos: esAmbiguoEnTextos };
