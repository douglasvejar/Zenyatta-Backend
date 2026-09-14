// Carga de una sola vez, desde la base de datos, todo lo que un grupo
// tiene configurado (jugadores, % propios, avales, diccionario de equipos
// personalizado) — se usa al procesar una sábana y al reconstruir
// reportes históricos, para no repetir la misma consulta en cada función.
const db = require('../db');
const { mezclarConPersonalizados } = require('./diccionarioEquipos');

async function cargarConfigGrupo(grupoId) {
  const [jugadoresRes, avalesRes, equiposGlobalesRes, equiposRes, grupoRes] = await Promise.all([
    db.query('SELECT * FROM jugadores WHERE grupo_id = $1', [grupoId]),
    db.query('SELECT * FROM avales WHERE grupo_id = $1', [grupoId]),
    // Capa global (equipos_globales): la administra el Súper-admin, no
    // lleva grupo_id porque es la misma para todos los grupos.
    db.query('SELECT apodo, nombre_oficial, deporte FROM equipos_globales'),
    db.query('SELECT apodo, nombre_oficial, deporte FROM equipos_personalizados WHERE grupo_id = $1', [grupoId]),
    // (08-09-2026, a pedido del usuario) modelo de comisión de ESTE grupo
    // — 'plano' (default, sin cambios de comportamiento) o
    // 'por_tipo_jugada' (ver la nota grande en sql/schema.sql y en
    // comisiones.js). Exclusivo del Súper-admin, se carga acá para que
    // procesarSabana.js/historial.js/balanceGeneral.js lo tengan
    // disponible sin agregar otra consulta aparte.
    db.query('SELECT modelo_comision, comision_tiers FROM grupos WHERE id = $1', [grupoId])
  ]);

  const jugadores = jugadoresRes.rows;
  const jugadoresPorNombre = {};
  const porcentajesPropios = {};
  // Excepción de modelo de comisión POR JUGADOR (09-09-2026, "grupo
  // mixto" — ver la nota grande en sql/schema.sql, columna
  // jugadores.modelo_comision, y en comisiones.js,
  // calcularComisionTotalCliente). Solo entran acá los jugadores que
  // tienen una excepción cargada (modelo_comision NO null) — el resto
  // sigue el modelo default del grupo, sin cambios.
  const modelosComisionPorCliente = {};
  jugadores.forEach(j => {
    jugadoresPorNombre[j.nombre] = j;
    if (Number(j.comision_propia) > 0) porcentajesPropios[j.nombre] = Number(j.comision_propia);
    if (j.modelo_comision === 'plano' || j.modelo_comision === 'por_tipo_jugada') {
      modelosComisionPorCliente[j.nombre] = j.modelo_comision;
    }
  });

  // Mapea IDs de jugador -> nombre, para poder armar el avalesMap por
  // nombre (que es como trabaja calcularComisionTotalCliente, igual que
  // en la app original).
  const nombrePorId = {};
  jugadores.forEach(j => { nombrePorId[j.id] = j.nombre; });

  const avalesMap = {};
  avalesRes.rows.forEach(a => {
    const nombreAvalador = nombrePorId[a.avalador_id];
    const nombreAvalado = nombrePorId[a.avalado_id];
    if (!nombreAvalador || !nombreAvalado) return;
    if (!avalesMap[nombreAvalador]) avalesMap[nombreAvalador] = {};
    avalesMap[nombreAvalador][nombreAvalado] = Number(a.porcentaje);
  });

  const diccionarioEquipos = mezclarConPersonalizados(equiposGlobalesRes.rows, equiposRes.rows);

  const filaGrupo = grupoRes.rows[0];
  const modeloComision = (filaGrupo && filaGrupo.modelo_comision) || 'plano';
  // jsonb ya llega parseado como array/objeto JS desde el driver de pg —
  // el fallback a [] es solo para cuando el grupo no existiera (no
  // debería pasar, cargarConfigGrupo siempre se llama con un grupo_id
  // válido, pero mejor no reventar).
  const tiersComision = (filaGrupo && Array.isArray(filaGrupo.comision_tiers)) ? filaGrupo.comision_tiers : [];

  return { jugadores, jugadoresPorNombre, porcentajesPropios, avalesMap, diccionarioEquipos, modeloComision, tiersComision, modelosComisionPorCliente };
}

module.exports = { cargarConfigGrupo };
