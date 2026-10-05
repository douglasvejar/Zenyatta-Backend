// =================================================================
// hipismoSemana.js (05-10-2026) — "Fecha de Semana" ACTIVA, a pedido del
// usuario ("activame esta pantalla, no funciona"): cada grupo puede definir
// en qué día empieza y en qué día cierra su semana de Hipismo (por ejemplo
// Lunes -> Lunes, cuando el lunes hay carreras en Estados Unidos y ese lunes
// "extra" se cuenta dentro de la semana que cierra).
//
// Regla (confirmada con el usuario):
//   - Sin configuración (o Lunes -> Domingo) la semana es la de siempre:
//     lunes a domingo.
//   - Con una configuración (inicio, cierre) se guarda además la FECHA ANCLA:
//     el último día de "inicio" que ya pasó (o es hoy) al guardar. La
//     primera semana va de la ancla hasta el primer día de "cierre" que cae
//     DESPUÉS de ella (si inicio == cierre, la semana siguiente: 8 días). Las
//     semanas siguientes arrancan el día después de cada cierre y duran 7
//     días (terminan siempre en el día de cierre) — así ningún día cae en dos
//     semanas y los saldos nunca se duplican. Antes de la ancla, las semanas
//     son de 7 días terminando el día anterior a la ancla.
//   - Si el usuario guarda la misma configuración otra vez no se mueve la
//     ancla (la configuración es idempotente).
//   - RANGO PERSONALIZADO (calendario, a pedido del usuario): el usuario elige
//     con un calendario el DESDE y el HASTA de una semana. Esa semana dura
//     exactamente esos días (los que sean); se guarda como ancla = desde y
//     `hasta` explícito. Las semanas siguientes siguen en ciclo de 7 días
//     (arrancan el día después de `hasta`) y las anteriores son de 7 días
//     terminando el día antes de `desde`.
//
// Todo en UTC con fechas 'YYYY-MM-DD' (mismo criterio que fechaSemana.js),
// y hoy = hora de Venezuela (UTC-4), igual que el resto de Hipismo.
//
// obtenerConfigSemana() lee la configuración de la tabla `grupos` (columnas
// hipismo_semana_inicio/cierre/desde, ver sql/schema.sql) con una caché
// corta en memoria. Si la lectura falla (por ejemplo, todavía no se corrió
// el SQL nuevo en la base) devuelve la configuración por defecto en vez de
// tumbar el reporte: nunca peor que el comportamiento de siempre.
// =================================================================
const db = require('../db');

const UN_DIA = 24 * 60 * 60 * 1000;
const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const CONFIG_DEFECTO = Object.freeze({ inicio: 1, cierre: 0, desde: null, hasta: null });
const MAX_DIAS_RANGO = 31;
const CACHE_MS = 30 * 1000;
const cache = new Map(); // grupoId -> { cfg, hasta }

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDeMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function msDeIso(iso) { return Date.parse(iso + 'T00:00:00Z'); }
function hoyVenezuela() { return new Date(Date.now() - 4 * 60 * 60 * 1000); }
function isoDeFecha(d) { return isoDeMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }

function esConfigPorDefecto(cfg) {
  if (!cfg || cfg.desde == null) return true;
  if (cfg.hasta) return false; // rango personalizado: nunca es "la de siempre"
  return Number(cfg.inicio) === 1 && Number(cfg.cierre) === 0;
}

// Acepta 0-6 (domingo=0) o el nombre ("Lunes", "miercoles"...). null si no es válido.
function parsearDia(valor) {
  if (typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 && valor <= 6) return valor;
  const t = String(valor == null ? '' : valor).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^[0-6]$/.test(t)) return Number(t);
  const i = NOMBRES_DIA.findIndex(n => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === t);
  return i >= 0 ? i : null;
}

// Semana (según la configuración) que contiene la fecha `iso` -> { desde, hasta } en ms.
function semanaQueContiene(cfg, iso) {
  const d = msDeIso(iso);
  if (esConfigPorDefecto(cfg)) {
    const dow = new Date(d).getUTCDay();
    const lunes = d + (dow === 0 ? -6 : 1 - dow) * UN_DIA;
    return { desde: lunes, hasta: lunes + 6 * UN_DIA };
  }
  const ancla = msDeIso(cfg.desde);
  const diasPrimera = (((Number(cfg.cierre) - Number(cfg.inicio) + 7) % 7) || 7);
  const cierre0 = cfg.hasta ? msDeIso(cfg.hasta) : ancla + diasPrimera * UN_DIA;
  if (d >= ancla) {
    if (d <= cierre0) return { desde: ancla, hasta: cierre0 };
    const k = Math.floor((d - (cierre0 + UN_DIA)) / (7 * UN_DIA));
    const inicio = cierre0 + UN_DIA + k * 7 * UN_DIA;
    return { desde: inicio, hasta: inicio + 6 * UN_DIA };
  }
  const j = Math.floor((ancla - UN_DIA - d) / (7 * UN_DIA));
  const fin = ancla - UN_DIA - j * 7 * UN_DIA;
  return { desde: fin - 6 * UN_DIA, hasta: fin };
}

// Misma firma que el rangoSemana() de siempre (fecha = Date UTC, offset de
// semanas: 0 actual, -1 anterior, -2 hace 2...), pero con la configuración.
function rangoSemanaConfig(cfg, fecha, offsetSemanas) {
  let w = semanaQueContiene(cfg, isoDeFecha(fecha));
  for (let i = 0; i < -offsetSemanas; i++) w = semanaQueContiene(cfg, isoDeMs(w.desde - UN_DIA));
  for (let i = 0; i < offsetSemanas; i++) w = semanaQueContiene(cfg, isoDeMs(w.hasta + UN_DIA));
  return { desde: isoDeMs(w.desde), hasta: isoDeMs(w.hasta) };
}

// Último día de la semana `inicio` (0-6) que ya pasó o es hoy.
function anclaParaInicio(inicio, hoyIso) {
  const hoy = msDeIso(hoyIso);
  const dow = new Date(hoy).getUTCDay();
  return isoDeMs(hoy - ((dow - inicio + 7) % 7) * UN_DIA);
}

async function obtenerConfigSemana(grupoId) {
  const hit = cache.get(grupoId);
  if (hit && hit.hasta > Date.now()) return hit.cfg;
  let cfg = CONFIG_DEFECTO;
  try {
    const r = await db.query(
      `SELECT hipismo_semana_inicio, hipismo_semana_cierre, to_char(hipismo_semana_desde, 'YYYY-MM-DD') AS hipismo_semana_desde,
            to_char(hipismo_semana_hasta, 'YYYY-MM-DD') AS hipismo_semana_hasta
         FROM grupos WHERE id = $1`,
      [grupoId]
    );
    const fila = r && r.rows && r.rows[0];
    if (fila && fila.hipismo_semana_inicio != null && fila.hipismo_semana_cierre != null && fila.hipismo_semana_desde) {
      const inicio = parsearDia(Number(fila.hipismo_semana_inicio));
      const cierre = parsearDia(Number(fila.hipismo_semana_cierre));
      if (inicio != null && cierre != null && /^\d{4}-\d{2}-\d{2}$/.test(String(fila.hipismo_semana_desde))) {
        const desde = String(fila.hipismo_semana_desde);
        let hasta = fila.hipismo_semana_hasta ? String(fila.hipismo_semana_hasta) : null;
        if (hasta && (!/^\d{4}-\d{2}-\d{2}$/.test(hasta) || hasta < desde)) hasta = null;
        cfg = { inicio, cierre, desde, hasta };
      }
    }
  } catch (e) {
    return CONFIG_DEFECTO; // sin caché: se reintenta en la próxima consulta
  }
  cache.set(grupoId, { cfg, hasta: Date.now() + CACHE_MS });
  return cfg;
}

async function rangoSemanaGrupo(grupoId, fecha, offsetSemanas) {
  return rangoSemanaConfig(await obtenerConfigSemana(grupoId), fecha, offsetSemanas);
}

// Guarda la configuración. Lunes -> Domingo = la de siempre (se borra la
// configuración). Si es la misma que ya estaba guardada, no mueve la ancla.
async function guardarConfigSemana(grupoId, inicio, cierre, hoy) {
  const actual = await obtenerConfigSemana(grupoId);
  const hoyIso = isoDeFecha(hoy || hoyVenezuela());
  let nueva;
  if (Number(inicio) === 1 && Number(cierre) === 0) {
    nueva = { inicio: null, cierre: null, desde: null, hasta: null };
  } else if (!esConfigPorDefecto(actual) && !actual.hasta && actual.inicio === inicio && actual.cierre === cierre) {
    nueva = { inicio, cierre, desde: actual.desde, hasta: null };
  } else {
    nueva = { inicio, cierre, desde: anclaParaInicio(inicio, hoyIso), hasta: null };
  }
  await db.query(
    'UPDATE grupos SET hipismo_semana_inicio = $1, hipismo_semana_cierre = $2, hipismo_semana_desde = $3, hipismo_semana_hasta = $4 WHERE id = $5',
    [nueva.inicio, nueva.cierre, nueva.desde, nueva.hasta, grupoId]
  );
  cache.delete(grupoId);
  return obtenerConfigSemana(grupoId);
}

function esFechaIso(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = msDeIso(v);
  return !Number.isNaN(ms) && isoDeMs(ms) === v;
}

// Valida un rango elegido con el calendario. Devuelve un mensaje de error o null.
function validarRangoPersonalizado(desde, hasta) {
  if (!esFechaIso(desde) || !esFechaIso(hasta)) return 'Elige en el calendario el día desde el que empieza la semana y el día en que cierra.';
  if (hasta < desde) return 'La fecha "Hasta" no puede ser anterior a la fecha "Desde".';
  const dias = (msDeIso(hasta) - msDeIso(desde)) / UN_DIA + 1;
  if (dias > MAX_DIAS_RANGO) return `El rango no puede pasar de ${MAX_DIAS_RANGO} días (elegiste ${dias}).`;
  return null;
}

// Guarda un rango personalizado (calendario): esa semana va exactamente de
// `desde` a `hasta`; las siguientes siguen en ciclo de 7 días.
async function guardarRangoPersonalizado(grupoId, desde, hasta) {
  const error = validarRangoPersonalizado(desde, hasta);
  if (error) { const e = new Error(error); e.status = 400; throw e; }
  const inicio = new Date(msDeIso(desde)).getUTCDay();
  const cierre = new Date(msDeIso(hasta)).getUTCDay();
  await db.query(
    'UPDATE grupos SET hipismo_semana_inicio = $1, hipismo_semana_cierre = $2, hipismo_semana_desde = $3, hipismo_semana_hasta = $4 WHERE id = $5',
    [inicio, cierre, desde, hasta, grupoId]
  );
  cache.delete(grupoId);
  return obtenerConfigSemana(grupoId);
}

// Lo que muestra la pantalla "Fecha de Semana": la configuración y las
// semanas anterior / actual / siguiente con sus fechas reales.
function describirConfigSemana(cfg, hoy) {
  const h = hoy || hoyVenezuela();
  const esDefecto = esConfigPorDefecto(cfg);
  const inicio = esDefecto ? 1 : cfg.inicio;
  const cierre = esDefecto ? 0 : cfg.cierre;
  return {
    inicio, cierre, inicioNombre: NOMBRES_DIA[inicio], cierreNombre: NOMBRES_DIA[cierre],
    esDefecto, desde: esDefecto ? null : cfg.desde, hasta: esDefecto ? null : (cfg.hasta || null),
    personalizada: !esDefecto && !!cfg.hasta,
    anterior: rangoSemanaConfig(cfg, h, -1),
    actual: rangoSemanaConfig(cfg, h, 0),
    siguiente: rangoSemanaConfig(cfg, h, 1)
  };
}

// Días (YYYY-MM-DD) de un rango, de desde a hasta incluidos.
function diasDelRango(desde, hasta) {
  const dias = [];
  for (let ms = msDeIso(desde); ms <= msDeIso(hasta); ms += UN_DIA) dias.push(isoDeMs(ms));
  return dias;
}

function limpiarCacheSemana() { cache.clear(); }

module.exports = {
  NOMBRES_DIA, CONFIG_DEFECTO, parsearDia, esConfigPorDefecto, semanaQueContiene, rangoSemanaConfig,
  anclaParaInicio, obtenerConfigSemana, rangoSemanaGrupo, guardarConfigSemana, describirConfigSemana,
  diasDelRango, limpiarCacheSemana, validarRangoPersonalizado, guardarRangoPersonalizado, MAX_DIAS_RANGO
};
