// =================================================================
// "GRUPO DE CLIENTES" (30-09-2026, a pedido del usuario — ver la nota
// grande en sql/schema.sql junto a "create table grupos_clientes" para
// el pedido textual completo y la comparación con "socios"). Resumen:
// el usuario arma a mano grupos arbitrarios de clientes (ej. "TYKHE" con
// LOBO, MARCAS, MRMONEY...), elige un cliente como titular (el nombre
// que se muestra arriba de la tarjeta), y el sistema muestra el saldo de
// la SEMANA ACTUAL de cada miembro — más el de la semana anterior, como
// respaldo — SIN volver a calcular nada: siempre lee el mismo Balance
// General que ya existe en cada módulo:
//   - Deportes: calcularBalanceSemanalPorCliente() (services/balanceGeneral.js)
//   - Hipismo:  construirCierreFinalHipismo() (services/hipismoResumenCliente.js)
//
// Un grupo vive en UN SOLO módulo ("modulo" en grupos_clientes) — un
// grupo de Deportes y uno de Hipismo con el mismo nombre de titular son
// filas completamente aparte, nunca se suman entre sí (confirmado con el
// usuario: "son cuadros independientes por modulo").
//
// El titular SIEMPRE aparece como un miembro más en la tarjeta (con su
// propio saldo), confirmado con el usuario viendo su propia captura de
// "Saldos por Socio" (donde el socio "TYKHE" también es una fila de la
// tabla) — construirTarjetaGrupoCliente() une titular + miembros acá
// mismo, sin que haga falta insertarlo también en
// grupos_clientes_miembros.
// =================================================================
const db = require('../db');
const { rangoSemanaGrupo } = require('./hipismoSemana');
const { cargarConfigGrupo } = require('./grupoConfig');
const { calcularBalanceSemanalPorCliente } = require('./balanceGeneral');
const { construirCierreFinalHipismo } = require('./hipismoResumenCliente');
const { calcularSemana } = require('./fechaSemana');
const { fechaVenezuelaHoy } = require('./fechaVenezuela');
const { urlLogoGrupo, temaColorGrupo } = require('./logoGrupo');

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const MODULOS_VALIDOS = ['deportes', 'hipismo'];

// Mismo redondeo EXACTO (a prueba de empates de medio centavo) que usa todo
// Hipismo -- ver round2 en hipismoAdelantadasCalc.js.
const { round2 } = require('./hipismoAdelantadasCalc');

// Cualquier fecha 'YYYY-MM-DD' que caiga 7 días antes de `fechaISO` sirve
// como referencia para que calcularSemana() (fechaSemana.js) encuentre el
// lunes de la semana ANTERIOR — misma semana ISO lunes-domingo que ya usa
// todo el proyecto (Balance General, Saldos Semana, Cierre Final).
function fechaSieteDiasAntes(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  return new Date(d.getTime() - 7 * UN_DIA_MS).toISOString().slice(0, 10);
}

// Mapa nombre -> saldo de la semana, para un módulo y rango dados — la
// ÚNICA función de este archivo que toca el cálculo real de cada módulo,
// siempre reusando la función ya existente (nunca duplica lógica de
// negocio de Balance General/Cierre Final).
async function saldosPorNombre(grupoId, modulo, desde, hasta) {
  const mapa = new Map();
  if (modulo === 'hipismo') {
    const resultado = await construirCierreFinalHipismo(grupoId, desde, hasta);
    resultado.clientes.forEach(c => mapa.set(c.nombre, Number(c.saldo)));
    return mapa;
  }
  // 'deportes'
  const config = await cargarConfigGrupo(grupoId);
  const configComision = { modelo: config.modeloComision, tiers: config.tiersComision, modelosPorCliente: config.modelosComisionPorCliente };
  const { porCliente } = await calcularBalanceSemanalPorCliente(
    grupoId, desde, hasta, config.porcentajesPropios, config.avalesMap, configComision
  );
  Object.keys(porCliente).forEach(nombre => mapa.set(nombre, Number(porCliente[nombre].totalSaldoCliente)));
  return mapa;
}

// --- CRUD ---------------------------------------------------------

async function crearGrupoCliente(grupoId, modulo, titularId) {
  if (!MODULOS_VALIDOS.includes(modulo)) throw new Error('Módulo inválido: ' + modulo);
  // El titular tiene que ser un cliente real de ESTE grupo/tenant — nunca
  // se confía en un id que venga de otro grupo por error.
  const rTitular = await db.query('SELECT id, nombre FROM jugadores WHERE id = $1 AND grupo_id = $2', [titularId, grupoId]);
  if (!rTitular.rows.length) return { ok: false, motivo: 'titular_no_encontrado' };

  const r = await db.query(
    `INSERT INTO grupos_clientes (grupo_id, modulo, titular_id)
     VALUES ($1, $2, $3) RETURNING id, token, titular_id, creado_en`,
    [grupoId, modulo, titularId]
  );
  const fila = r.rows[0];
  // Misma forma (camelCase) que devuelve listarGruposClientes() — así el
  // frontend puede simplemente meter esta fila al principio de su lista
  // en memoria sin tener que traducir nombres de campo distintos.
  return {
    ok: true,
    grupoCliente: {
      id: fila.id,
      token: fila.token,
      titularId: fila.titular_id,
      titularNombre: rTitular.rows[0].nombre,
      cantidadMiembros: 0,
      creadoEn: fila.creado_en
    }
  };
}

async function listarGruposClientes(grupoId, modulo) {
  const r = await db.query(
    `SELECT gc.id, gc.token, gc.titular_id, gc.creado_en, j.nombre AS titular_nombre,
            (SELECT COUNT(*) FROM grupos_clientes_miembros m WHERE m.grupo_cliente_id = gc.id) AS cantidad_miembros
       FROM grupos_clientes gc
       JOIN jugadores j ON j.id = gc.titular_id
      WHERE gc.grupo_id = $1 AND gc.modulo = $2
      ORDER BY j.nombre`,
    [grupoId, modulo]
  );
  return r.rows.map(row => ({
    id: row.id,
    token: row.token,
    titularId: row.titular_id,
    titularNombre: row.titular_nombre,
    cantidadMiembros: Number(row.cantidad_miembros),
    creadoEn: row.creado_en
  }));
}

async function eliminarGrupoCliente(grupoId, modulo, grupoClienteId) {
  const r = await db.query(
    'DELETE FROM grupos_clientes WHERE id = $1 AND grupo_id = $2 AND modulo = $3 RETURNING id',
    [grupoClienteId, grupoId, modulo]
  );
  return r.rows.length > 0;
}

async function agregarMiembro(grupoId, modulo, grupoClienteId, jugadorId) {
  const g = await db.query('SELECT id FROM grupos_clientes WHERE id = $1 AND grupo_id = $2 AND modulo = $3', [grupoClienteId, grupoId, modulo]);
  if (!g.rows.length) return { ok: false, motivo: 'grupo_no_encontrado' };
  const j = await db.query('SELECT id FROM jugadores WHERE id = $1 AND grupo_id = $2', [jugadorId, grupoId]);
  if (!j.rows.length) return { ok: false, motivo: 'cliente_no_encontrado' };
  await db.query(
    'INSERT INTO grupos_clientes_miembros (grupo_cliente_id, jugador_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [grupoClienteId, jugadorId]
  );
  return { ok: true };
}

async function quitarMiembro(grupoId, modulo, grupoClienteId, jugadorId) {
  const g = await db.query('SELECT id FROM grupos_clientes WHERE id = $1 AND grupo_id = $2 AND modulo = $3', [grupoClienteId, grupoId, modulo]);
  if (!g.rows.length) return { ok: false, motivo: 'grupo_no_encontrado' };
  await db.query('DELETE FROM grupos_clientes_miembros WHERE grupo_cliente_id = $1 AND jugador_id = $2', [grupoClienteId, jugadorId]);
  return { ok: true };
}

// --- La tarjeta (titular + miembros + saldos) ----------------------

// grupoId/modulo opcionales para reforzar que el grupo pedido es de
// verdad del tenant/módulo esperado (rutas autenticadas) — se pueden
// omitir (pasar null) desde la ruta PÚBLICA por token, que ya validó el
// grupo por su propio token antes de llamar acá.
async function construirTarjetaGrupoCliente(grupoClienteId, grupoId, modulo) {
  const params = [grupoClienteId];
  let filtro = '';
  if (grupoId) { params.push(grupoId); filtro += ' AND gc.grupo_id = $' + params.length; }
  if (modulo) { params.push(modulo); filtro += ' AND gc.modulo = $' + params.length; }

  // 30-09-2026 (a pedido del usuario: "colocale color entre lineas...
  // agregale tambien su logo del grupo... el color y logo que se escoja
  // en logos") — trae también el tema de color y el logo del propio
  // GRUPO (tenant), para que la tarjeta (acá y en el link público) se
  // pueda pintar con la identidad visual de cada negocio, reusando los
  // mismos 2 helpers que ya usa el resto del proyecto (urlLogoGrupo/
  // temaColorGrupo en services/logoGrupo.js) — nunca un mecanismo nuevo.
  const rGrupo = await db.query(
    `SELECT gc.id, gc.grupo_id, gc.modulo, gc.titular_id, gc.token, gc.creado_en,
            g.nombre AS grupo_nombre, g.logo_url, g.logo_base64,
            g.tema_color_primario, g.tema_color_secundario
       FROM grupos_clientes gc
       JOIN grupos g ON g.id = gc.grupo_id
      WHERE gc.id = $1` + filtro,
    params
  );
  if (!rGrupo.rows.length) return null;
  const grupoCliente = rGrupo.rows[0];

  const rTitular = await db.query('SELECT id, nombre FROM jugadores WHERE id = $1', [grupoCliente.titular_id]);
  if (!rTitular.rows.length) return null; // titular borrado (on delete cascade ya habría borrado el grupo, pero por si acaso)
  const titular = rTitular.rows[0];

  const rMiembros = await db.query(
    `SELECT j.id, j.nombre
       FROM jugadores j
       JOIN grupos_clientes_miembros m ON m.jugador_id = j.id
      WHERE m.grupo_cliente_id = $1`,
    [grupoClienteId]
  );

  // El titular SIEMPRE aparece como miembro (ver nota grande arriba) —
  // se une por id acá, así nunca sale duplicado aunque también esté
  // insertado a mano en grupos_clientes_miembros.
  const mapaNombres = new Map();
  mapaNombres.set(titular.id, titular.nombre);
  rMiembros.rows.forEach(m => mapaNombres.set(m.id, m.nombre));

  // Semana actual + semana anterior "de respaldo" (30-09-2026, confirmado
  // con el usuario: "solo semana actual y una sola semana de saldo
  // semana anterior de respaldo" — nunca un selector para navegar
  // cualquier semana, a propósito, para que el link público quede simple).
  const hoyIso = fechaVenezuelaHoy();
  // Deportes: semana ISO lunes-domingo de siempre. Hipismo (05-10-2026): usa
  // la semana configurada en "Fecha de Semana" del grupo (por defecto, la
  // misma lunes-domingo).
  let semanaActual, semanaAnterior;
  if (grupoCliente.modulo === 'hipismo') {
    const hoyFecha = new Date(hoyIso + 'T00:00:00Z');
    semanaActual = await rangoSemanaGrupo(grupoCliente.grupo_id, hoyFecha, 0);
    semanaAnterior = await rangoSemanaGrupo(grupoCliente.grupo_id, hoyFecha, -1);
  } else {
    semanaActual = calcularSemana(hoyIso);
    semanaAnterior = calcularSemana(fechaSieteDiasAntes(hoyIso));
  }

  const [saldosActual, saldosAnterior] = await Promise.all([
    saldosPorNombre(grupoCliente.grupo_id, grupoCliente.modulo, semanaActual.desde, semanaActual.hasta),
    saldosPorNombre(grupoCliente.grupo_id, grupoCliente.modulo, semanaAnterior.desde, semanaAnterior.hasta)
  ]);

  const miembros = Array.from(mapaNombres.entries())
    .map(([id, nombre]) => ({
      id,
      nombre,
      esTitular: id === titular.id,
      saldoSemanaActual: round2(saldosActual.get(nombre) || 0),
      saldoSemanaAnterior: round2(saldosAnterior.get(nombre) || 0)
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const totalSemanaActual = round2(miembros.reduce((s, m) => s + m.saldoSemanaActual, 0));
  const totalSemanaAnterior = round2(miembros.reduce((s, m) => s + m.saldoSemanaAnterior, 0));

  const tema = temaColorGrupo(grupoCliente);

  return {
    id: grupoCliente.id,
    modulo: grupoCliente.modulo,
    token: grupoCliente.token,
    grupoNombre: grupoCliente.grupo_nombre,
    grupoLogoUrl: urlLogoGrupo(grupoCliente.grupo_id, grupoCliente),
    grupoColorPrimario: tema.colorPrimario,
    grupoColorSecundario: tema.colorSecundario,
    titular: { id: titular.id, nombre: titular.nombre },
    semanaActual: { desde: semanaActual.desde, hasta: semanaActual.hasta },
    semanaAnterior: { desde: semanaAnterior.desde, hasta: semanaAnterior.hasta },
    miembros,
    totalSemanaActual,
    totalSemanaAnterior
  };
}

async function construirTarjetaPorToken(token) {
  const r = await db.query('SELECT id FROM grupos_clientes WHERE token = $1', [token]);
  if (!r.rows.length) return null;
  return construirTarjetaGrupoCliente(r.rows[0].id, null, null);
}

module.exports = {
  crearGrupoCliente,
  listarGruposClientes,
  eliminarGrupoCliente,
  agregarMiembro,
  quitarMiembro,
  construirTarjetaGrupoCliente,
  construirTarjetaPorToken
};
