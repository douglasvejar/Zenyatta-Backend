// Autenticación liviana para la Fase 0: JWT propio (no el Auth de
// Supabase) firmado con JWT_SECRET. Es deliberadamente simple — sirve
// perfecto para "un Grupo entra con su usuario y contraseña", y se puede
// reemplazar más adelante por el Auth de Supabase sin tocar el resto de
// las rutas (todas leen req.grupoId).
//
// CUENTAS POR EMPLEADO (18-09-2026, a pedido del usuario — ver la nota
// grande en sql/schema.sql, tabla "empleados"): el JWT ahora puede
// representar dos tipos de sesión dentro de un mismo Grupo —
//   - El "Administrador" (el dueño, la fila de "grupos" de siempre):
//     payload = { grupoId } sin empleadoId, exactamente como antes.
//     SIEMPRE tiene acceso al 100% (req.rol === 'administrador').
//   - Un "Empleado" (fila de la tabla "empleados"): payload = { grupoId,
//     empleadoId }. Su acceso está limitado a lo que tenga cargado en
//     empleados.permisos (req.rol === 'empleado', req.permisos = [...]).
// requiereGrupo() carga SIEMPRE fresco desde la base (no confía en nada
// del JWT más que los ids) para que activar/desactivar un empleado, o
// cambiarle los permisos, tenga efecto inmediato sin esperar a que
// expire el token de 30 días.
const jwt = require('jsonwebtoken');
const db = require('../db');

// Todas las "secciones" del panel del Grupo que se pueden habilitar o no
// para un empleado — cada clave corresponde 1 a 1 con un botón del menú
// de public/grupo.html y con el/los archivo(s) de rutas que protege (ver
// dónde se usa requierePermiso() en cada routes/*.js). El Administrador
// nunca se fija en esta lista: siempre pasa. La gestión de empleados
// (routes/empleados.js) NO está en esta lista a propósito — es exclusiva
// del Administrador, nunca delegable, para que un empleado no se pueda
// dar a sí mismo (ni a otro) más acceso del que ya tiene.
const PERMISOS_VALIDOS = [
  'sabana', // 📋 Sábana (cargar/ver jugadas del día, tickets, pizarra)
  'sabanas', // 🗂️ Sábanas (histórico/papelera de días ya procesados)
  'whatsapp', // 📲 Sábana Automática por WhatsApp
  'equipos', // 🏷️ Apodos de Equipos
  'pagos', // 💳 Pagos (Grupo → Ludox) — el más sensible, casi siempre solo para el Administrador
  'jugador', // 👤 Jugador + 💸 Comisión propia + 🤝 Avalados (incluye elegir la moneda de un cliente)
  'porcentajes', // 📊 % Devueltos
  'balanceGeneral', // 📒 Balance General
  'transferencias', // 🔄 Transferencias
  'polla', // 🎲 Polla
  'alertas' // 🔔 Alertas y chat interno
];

// Lee req.grupo.moneda_modo con un default seguro ('usd', igual que la
// columna en sql/schema.sql) para cuando req.grupo no viene armado —
// pasa en varios tests que invocan un handler de ruta directamente sin
// pasar por requiereGrupo (construyen su propio req a mano, solo con
// grupoId/query/body) — sin este default, cualquier ruta que mire la
// moneda del grupo (jugadores.js, sabana.js, reportes.js, grupo.js)
// reventaría con esos tests. En producción req.grupo siempre viene
// seteado por requiereGrupo, así que este default nunca decide nada de
// verdad ahí — solo evita el TypeError en las pruebas viejas.
function monedaModoDe(req) {
  return (req.grupo && req.grupo.moneda_modo) || 'usd';
}

function normalizarPermisos(lista) {
  if (!Array.isArray(lista)) return [];
  const unicos = new Set(lista.filter(p => PERMISOS_VALIDOS.includes(p)));
  return Array.from(unicos);
}

function firmarSesionGrupo(grupo) {
  return jwt.sign({ grupoId: grupo.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function firmarSesionEmpleado(empleado) {
  return jwt.sign({ grupoId: empleado.grupo_id, empleadoId: empleado.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// Exige "Authorization: Bearer <token>" con un JWT válido de un grupo
// ACTIVO (y, si es un empleado, también de un empleado ACTIVO). Si el
// grupo fue desactivado por el súper-admin, o el empleado fue
// desactivado/borrado por su Administrador, el token deja de servir
// aunque todavía no haya expirado.
async function requiereGrupo(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Falta el token de sesión (inicia sesión primero).' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // whatsapp_grupo_jid/whatsapp_habilitado/moneda_modo van en el SELECT
    // porque varias rutas necesitan leerlos de req.grupo sin otra
    // consulta aparte (whatsapp.js, jugadores.js, reportes.js, sabana.js).
    const res2 = await db.query(
      'SELECT id, nombre, email, activo, whatsapp_grupo_jid, whatsapp_habilitado, moneda_modo FROM grupos WHERE id = $1',
      [payload.grupoId]
    );
    const grupo = res2.rows[0];
    if (!grupo) return res.status(401).json({ error: 'Sesión inválida.' });
    if (!grupo.activo) return res.status(403).json({ error: 'Esta cuenta está desactivada. Contacta al administrador de la plataforma.' });

    req.grupoId = grupo.id;
    req.grupo = grupo;

    if (payload.empleadoId) {
      const res3 = await db.query(
        'SELECT id, nombre, email, activo, permisos FROM empleados WHERE id = $1 AND grupo_id = $2',
        [payload.empleadoId, grupo.id]
      );
      const empleado = res3.rows[0];
      if (!empleado) return res.status(401).json({ error: 'Sesión inválida.' });
      if (!empleado.activo) return res.status(403).json({ error: 'Esta cuenta de empleado fue desactivada. Contacta al administrador de tu grupo.' });
      req.empleadoId = empleado.id;
      req.empleado = empleado;
      req.rol = 'empleado';
      req.permisos = normalizarPermisos(empleado.permisos);
      req.nombreActor = empleado.nombre;
    } else {
      req.rol = 'administrador';
      req.permisos = null; // null = sin restricción, no "sin permisos"
      req.nombreActor = grupo.nombre;
    }

    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o vencida.' });
  }
}

// Middleware de sección: exige que la sesión actual (Administrador SIEMPRE
// pasa; un Empleado solo si tiene esta clave en sus permisos) pueda tocar
// esta sección del panel. Se usa DESPUÉS de requiereGrupo() en cada
// routes/*.js — ver PERMISOS_VALIDOS arriba para las claves válidas.
function requierePermiso(clave) {
  return function (req, res, next) {
    if (req.rol === 'administrador') return next();
    if (Array.isArray(req.permisos) && req.permisos.includes(clave)) return next();
    return res.status(403).json({ error: 'No tienes permiso para esto. Pídele al administrador de tu grupo que te lo habilite.' });
  };
}

// Igual que requierePermiso(), pero para una ruta que sirve a MÁS de una
// sección del panel a la vez (ej. "historial-cliente" lo usan tanto
// Balance General como Jugador) — pasa si el empleado tiene AL MENOS UNA
// de las claves dadas.
function requiereAlgunoDe(...claves) {
  return function (req, res, next) {
    if (req.rol === 'administrador') return next();
    if (Array.isArray(req.permisos) && claves.some(c => req.permisos.includes(c))) return next();
    return res.status(403).json({ error: 'No tienes permiso para esto. Pídele al administrador de tu grupo que te lo habilite.' });
  };
}

// Exige que la sesión sea del Administrador (el dueño del grupo, nunca un
// Empleado) — usado por routes/empleados.js, y por el interruptor de
// moneda del grupo (routes/grupo.js), a propósito NO delegables a ningún
// empleado por más permisos que tenga.
function requiereAdministrador(req, res, next) {
  if (req.rol !== 'administrador') {
    return res.status(403).json({ error: 'Esto solo lo puede hacer el administrador del grupo.' });
  }
  next();
}

// Exige el secreto de súper-admin (vos) en "Authorization: Bearer <SUPERADMIN_SECRET>".
function requiereSuperadmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || token !== process.env.SUPERADMIN_SECRET) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  next();
}

module.exports = {
  firmarSesionGrupo,
  firmarSesionEmpleado,
  requiereGrupo,
  requierePermiso,
  requiereAlgunoDe,
  requiereAdministrador,
  requiereSuperadmin,
  normalizarPermisos,
  monedaModoDe,
  PERMISOS_VALIDOS
};
