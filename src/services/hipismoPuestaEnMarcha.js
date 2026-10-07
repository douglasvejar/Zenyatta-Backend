// =================================================================
// hipismoPuestaEnMarcha.js (07-10-2026) — PUESTA EN MARCHA DE UN GRUPO.
// Pedido (punto 8, "para vender a más grupos"): lista de pasos para dejar un
// grupo nuevo listo (hipódromos, banqueo, %, clientes…), una prueba piloto
// que confirme que todo funciona SIN guardar nada, y así enterarse de lo que
// falta antes de que el grupo cargue su primer plano.
//
//   construirChecklistGrupo(grupo): cada paso con estado
//     'ok' (listo) | 'pendiente' (falta, hace falta hacerlo) | 'opcional'
//     (no es obligatorio, se explica qué pasa si no se configura).
//   verificarEsquema(): confirma que la base de datos tiene las tablas,
//     columnas y tipos de alerta que el programa necesita (o sea, que
//     sql/schema.sql se corrió completo) — el error más común al actualizar.
//   ejecutarPruebaPiloto(grupo): corre el cálculo real con un plano de
//     ejemplo, revisa la configuración de banqueo y el cuadre de la semana
//     actual. Solo LEE: nunca crea clientes, planos ni alertas.
// Nada de esto es específico de un grupo: cada grupo se evalúa con SU propia
// configuración (banqueo, %, hipódromos).
// =================================================================
const db = require('../db');
const { obtenerConfigSemana, esConfigPorDefecto } = require('./hipismoSemana');
const { calcularPlano } = require('./hipismoCalc');
const { revisarCuadreGrupo } = require('./hipismoCuadreNocturno');

const ESQUEMA_ESPERADO = {
  grupos: ['hipismo_marcas_banqueo', 'hipismo_tf_banqueo', 'hipismo_semana_inicio'],
  hipismo_adelantadas_jugadas: ['sin_comision', 'montos_manuales'],
  hipismo_cuadre_nocturno: ['grupo_id', 'fecha', 'estado'],
  errores_servidor: ['grupo_id', 'mensaje', 'creado_en'],
  hipismo_cargas_especiales: ['fecha'],
  hipismo_tercios_adelantadas_jugadas: ['comision_grupo']
};

async function contar(sql, params) {
  try {
    const r = await db.query(sql, params);
    return Number(r.rows[0] && r.rows[0].n);
  } catch (e) {
    return null; // tabla/columna inexistente: lo reporta verificarEsquema
  }
}

// Banqueo configurado: arreglo de { nombre, porcentaje } cuyos % suman 100.
function evaluarBanqueo(valor) {
  if (!Array.isArray(valor) || !valor.length) return { configurado: false, valido: false, suma: 0 };
  const suma = Math.round(valor.reduce((a, b) => a + (Number(b && b.porcentaje) || 0), 0) * 100) / 100;
  return { configurado: true, valido: Math.abs(suma - 100) < 0.005 && valor.every(b => b && b.nombre), suma };
}

async function verificarEsquema() {
  const faltan = [];
  const tablas = Object.keys(ESQUEMA_ESPERADO);
  const r = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [tablas]
  );
  const tiene = new Set(r.rows.map(x => `${x.table_name}.${x.column_name}`));
  const tablasVistas = new Set(r.rows.map(x => x.table_name));
  tablas.forEach(t => {
    if (!tablasVistas.has(t)) { faltan.push(`falta la tabla ${t}`); return; }
    ESQUEMA_ESPERADO[t].forEach(c => { if (!tiene.has(`${t}.${c}`)) faltan.push(`falta la columna ${t}.${c}`); });
  });
  try {
    const rc = await db.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'hipismo_alertas_tipo_check'`);
    const def = (rc.rows[0] && rc.rows[0].def) || '';
    ['APUESTA_SOBRE_POZO', 'CUADRE_DESCUADRADO'].forEach(t => { if (!def.includes(t)) faltan.push(`la tabla de alertas no acepta el tipo ${t}`); });
  } catch (e) { faltan.push('no se pudo leer la restricción de alertas'); }
  return { ok: faltan.length === 0, faltan };
}

// req.grupo (sesión) NO trae las columnas de banqueo, así que se leen siempre
// de la base: sin esto el banqueo salía "sin configurar" aunque estuviera.
async function leerBanqueoGrupo(grupoId) {
  try {
    const r = await db.query('SELECT hipismo_marcas_banqueo, hipismo_tf_banqueo FROM grupos WHERE id = $1', [grupoId]);
    const f = r.rows[0] || {};
    return { marcas: f.hipismo_marcas_banqueo || null, tf: f.hipismo_tf_banqueo || null };
  } catch (e) {
    return { marcas: null, tf: null };
  }
}

async function construirChecklistGrupo(grupo) {
  const gid = grupo.id;
  const banqueo = await leerBanqueoGrupo(gid);
  const [hipodromos, clientes, conPct, empleados, planos] = await Promise.all([
    contar('SELECT COUNT(*)::int AS n FROM hipismo_hipodromos WHERE grupo_id = $1', [gid]),
    contar(`SELECT COUNT(*)::int AS n FROM jugadores WHERE grupo_id = $1 AND COALESCE(es_cuenta_comision, false) = false AND COALESCE(activo, true) = true`, [gid]),
    contar(`SELECT COUNT(*)::int AS n FROM jugadores WHERE grupo_id = $1 AND COALESCE(es_cuenta_comision, false) = false AND COALESCE(comision_propia, 0) > 0`, [gid]),
    contar('SELECT COUNT(*)::int AS n FROM empleados WHERE grupo_id = $1', [gid]),
    contar('SELECT COUNT(*)::int AS n FROM hipismo_planos WHERE grupo_id = $1', [gid])
  ]);
  let ultimoCuadre = null;
  try {
    const r = await db.query('SELECT fecha, estado FROM hipismo_cuadre_nocturno WHERE grupo_id = $1 ORDER BY fecha DESC LIMIT 1', [gid]);
    ultimoCuadre = r.rows[0] || null;
  } catch (e) { /* tabla aún no creada */ }
  let semana = null;
  try { semana = await obtenerConfigSemana(gid); } catch (e) { /* defecto */ }

  const marcas = evaluarBanqueo(banqueo.marcas);
  const tf = evaluarBanqueo(banqueo.tf);
  const items = [];
  const add = (clave, titulo, estado, detalle, donde) => items.push({ clave, titulo, estado, detalle, donde });

  add('hipodromos', 'Hipódromos cargados', hipodromos > 0 ? 'ok' : 'pendiente',
    hipodromos > 0 ? `${hipodromos} hipódromo(s) cargado(s).` : 'No hay ningún hipódromo: sin ellos no se puede cargar un plano.', 'Administración > Hipódromos');
  add('clientes', 'Clientes creados', clientes > 0 ? 'ok' : 'pendiente',
    clientes > 0 ? `${clientes} cliente(s) activo(s). Recuerda: un plano con un nombre que no exista da "CLIENTE X NO EXISTE".` : 'Todavía no hay clientes. Los planos solo aceptan clientes ya creados.', 'Clientes');
  add('banqueoMarcas', 'Banqueo de Marcas', marcas.valido ? 'ok' : (marcas.configurado ? 'pendiente' : 'pendiente'),
    marcas.valido ? 'Configurado (los % suman 100).' : (marcas.configurado ? `Los % suman ${marcas.suma} y tienen que sumar 100.` : 'Sin banqueo: las Marcas quedan "falta banqueo" y hay que banquearlas una por una a mano.'), 'Administración > Banqueo (Marcas)');
  add('banqueoTf', 'Banqueo de Tablas Fijas', tf.valido ? 'ok' : (tf.configurado ? 'pendiente' : 'opcional'),
    tf.valido ? 'Configurado (los % suman 100).' : (tf.configurado ? `Los % suman ${tf.suma} y tienen que sumar 100.` : 'Sin banqueo propio: las Tablas Fijas juegan contra el ítem "TABLAS FIJAS" (así funciona por defecto).'), 'Administración > Banqueo (Tablas Fijas)');
  add('porcentajes', '% devueltos a clientes', conPct > 0 ? 'ok' : 'opcional',
    conPct > 0 ? `${conPct} cliente(s) con % propio.` : 'Ningún cliente tiene % propio: no se devuelve comisión a nadie (está bien si este grupo no devuelve).', 'Clientes > % propio');
  add('semana', 'Fecha de semana', 'ok',
    semana && !esConfigPorDefecto(semana) ? 'Semana personalizada configurada.' : 'Semana normal (lunes a domingo). Cámbiala solo si este grupo cierra en otro día.', 'Administración > Fecha de Semana');
  add('usuarios', 'Usuarios (empleados)', empleados > 0 ? 'ok' : 'opcional',
    empleados > 0 ? `${empleados} usuario(s) adicional(es).` : 'Solo entra el administrador. Crea usuarios si alguien más va a cargar planos.', 'Ajustes > Usuarios');
  add('primerPlano', 'Primer plano cargado', planos > 0 ? 'ok' : 'pendiente',
    planos > 0 ? `${planos} plano(s) guardado(s).` : 'Aún no se ha cargado ningún plano: haz la prueba piloto y luego carga uno real.', 'Cargar Planos');
  add('cuadre', 'Revisión automática de cuadre', ultimoCuadre ? (ultimoCuadre.estado === 'ok' ? 'ok' : 'pendiente') : 'opcional',
    ultimoCuadre ? (ultimoCuadre.estado === 'ok' ? 'La última revisión nocturna cuadró.' : 'La última revisión encontró algo: mira Administración > Alertas.') : 'Todavía no ha corrido (corre sola cada noche; puedes lanzarla a mano en Alertas).', 'Administración > Alertas');

  const pendientes = items.filter(i => i.estado === 'pendiente').length;
  return { items, pendientes, listo: pendientes === 0 };
}

async function ejecutarPruebaPiloto(grupo) {
  const banqueo = await leerBanqueoGrupo(grupo.id);
  const pasos = [];
  const paso = (clave, titulo, ok, detalle) => pasos.push({ clave, titulo, ok, detalle });

  try {
    const esq = await verificarEsquema();
    paso('esquema', 'Base de datos al día', esq.ok, esq.ok ? 'Todas las tablas, columnas y tipos de alerta están.' : 'Corre sql/schema.sql completo en Supabase: ' + esq.faltan.join('; ') + '.');
  } catch (e) { paso('esquema', 'Base de datos al día', false, 'No se pudo revisar: ' + e.message); }

  try {
    const r = calcularPlano({ texto: 'Juega ANA 1p (5) con 30,00 da BETO', pizarra: '5.1.2', cruzar: false });
    const t = r.tickets[0];
    const suma = t ? Math.round((t.resultadoJugador + t.resultadoBanquero + Number(r.comisionTotal || 0)) * 100) / 100 : NaN;
    paso('calculo', 'Cálculo de un plano de ejemplo', !!t && suma === 0,
      t ? (suma === 0 ? `Jugador ${t.resultadoJugador}, banquero ${t.resultadoBanquero}, comisión ${r.comisionTotal}: suma 0.` : `El ejemplo no suma 0 (diferencia ${suma}).`) : 'El plano de ejemplo no se reconoció.');
  } catch (e) { paso('calculo', 'Cálculo de un plano de ejemplo', false, 'Falló: ' + e.message); }

  [['banqueoMarcas', 'Banqueo de Marcas', banqueo.marcas, true], ['banqueoTf', 'Banqueo de Tablas Fijas', banqueo.tf, false]].forEach(([clave, titulo, valor, obligatorio]) => {
    const b = evaluarBanqueo(valor);
    if (!b.configurado) paso(clave, titulo, !obligatorio, obligatorio ? 'Sin configurar: las Marcas quedarán pendientes de banqueo manual.' : 'Sin banqueo propio (juegan contra TABLAS FIJAS).');
    else paso(clave, titulo, b.valido, b.valido ? 'Los % suman 100.' : `Los % suman ${b.suma}; tienen que sumar 100.`);
  });

  try {
    const c = await revisarCuadreGrupo(grupo, { semanas: [0] });
    paso('cuadre', 'Cuadre de la semana actual', c.ok, c.ok ? `Todo cuadra (${c.clientesRevisados} cliente(s) revisados).` : `${c.discrepancias.length} cliente(s) con diferencia y/o el balance no suma 0: mira Alertas.`);
  } catch (e) { paso('cuadre', 'Cuadre de la semana actual', false, 'No se pudo revisar: ' + e.message); }

  return { ok: pasos.every(p => p.ok), pasos };
}

module.exports = { leerBanqueoGrupo, construirChecklistGrupo, verificarEsquema, ejecutarPruebaPiloto, evaluarBanqueo, ESQUEMA_ESPERADO };
