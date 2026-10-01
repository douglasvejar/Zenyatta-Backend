// Login del rol "Grupo" (administrador del negocio de apuestas) Y de sus
// Empleados (18-09-2026, a pedido del usuario — ver la nota grande en
// sql/schema.sql, tabla "empleados"). Un solo formulario de login para
// los dos: primero se busca el email en "grupos" (el dueño); si no
// aparece ahí, se busca en "empleados" (una cuenta de acceso limitado
// DENTRO de un grupo). No hace falta que quien entra sepa de antemano si
// es "el administrador" o "un empleado" — el panel (grupo.html) se
// adapta solo según lo que devuelva este login (grupo.rol/permisos).
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { firmarSesionGrupo, firmarSesionEmpleado } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { urlLogoGrupo, temaColorGrupo } = require('../services/logoGrupo');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Faltan email o password.' });

  const r = await db.query('SELECT * FROM grupos WHERE email = $1', [email]);
  const grupo = r.rows[0];

  if (grupo) {
    const ok = await bcrypt.compare(password, grupo.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    if (!grupo.activo) return res.status(403).json({ error: 'Esta cuenta todavía no está activada. Contacta al administrador de la plataforma.' });
    // "Ningún módulo activo" (26-09-2026, a pedido del usuario) — un
    // grupo con Deportes Y Hipismo desactivados a la vez (los 2
    // interruptores los mueve el Súper-admin, ver routes/superadmin.js:
    // PUT .../modulo-deportes y PUT .../modulo-hipismo) no tiene NADA que
    // mostrarle: sin este chequeo, el login pasaba igual y grupo.html
    // terminaba mostrando el panel de Deportes vacío/roto (mostrarApp()
    // solo redirige a Hipismo si Hipismo está prendido, nunca bloquea
    // cuando los 2 están apagados). Se corta acá, ANTES de entrar a
    // ningún panel.
    if (!grupo.modulo_deportes_habilitado && !grupo.modulo_hipismo_habilitado) {
      return res.status(403).json({ error: 'Este grupo no tiene ningún módulo activo (ni Deportes ni Hipismo). Contacta al administrador de la plataforma.' });
    }

    // Registra el último inicio de sesión (fecha/hora, IP, y el navegador/SO
    // que reportó el propio navegador vía User-Agent) — lo usa la pantalla
    // de detalle de Súper-admin (ver src/routes/superadmin.js). No bloquea
    // el login si esto falla por algún motivo raro: es un UPDATE aparte, no
    // se espera (await) ni se mete en el camino crítico de responder al login.
    db.query(
      'UPDATE grupos SET ultimo_login_en = now(), ultimo_login_ip = $1, ultimo_login_user_agent = $2 WHERE id = $3',
      [req.ip || null, req.headers['user-agent'] || null, grupo.id]
    ).catch(e => console.error('No se pudo registrar el último login (no afecta el login en sí):', e.message));

    const token = firmarSesionGrupo(grupo);
    // moduloDeportesHabilitado/moduloHipismoHabilitado (22-09-2026, a
    // pedido del usuario: selector "⚽ Deportes / 🐎 Hipismo" — ver
    // claude/plan-modulo-hipismo.md) van en la respuesta del login para
    // que grupo.html/hipismo-mockup.html decidan, sin otra llamada
    // aparte, a qué módulo entrar solo y si mostrar el botón de cambio.
    //
    // logoUrl (24-09-2026, a pedido del usuario: "en todos los reportes
    // quiero que se vea el logo del grupo arriba") — grupo.logo_url ya
    // existía (lo carga el Súper-admin, ver superadmin.js/html) y ya se
    // usaba en los links públicos de cliente (cliente.js/hipismoCliente.js)
    // pero nunca había viajado en la sesión del propio Administrador/
    // Empleado — sin esto, Cierre Final/Balance General/Semana por Días/
    // Pozos no tenían de dónde sacar el logo real para sus encabezados.
    //
    // temaColorPrimario/Secundario (01-10-2026, a pedido del usuario:
    // "QUIERO LOS CUADRES COMO HICISTE EL DE GRUPO DE CLIENTES, CON LOS
    // COLORES QUE TENGA EL LOGO CONFIGURADO, Y EL LOGO DE FONDO" — ver la
    // nota grande junto a #balanceCaptura/#cierreFinalCaptura/
    // #comisionesDevueltasCaptura en hipismo-mockup.html) — mismo
    // tema_color_primario/secundario que ya usa 🗂️ Grupo de Clientes
    // (configurado en Súper-admin > 🖼️ Logo > "Colores Reportes Cliente"),
    // ahora también disponible en la sesión del propio Administrador/
    // Empleado, igual que logoUrl. "SELECT *" de arriba ya trae estas 2
    // columnas sin que haga falta tocar esa consulta.
    const temaAdmin = temaColorGrupo(grupo);
    return res.json({
      token,
      grupo: {
        id: grupo.id, nombre: grupo.nombre, email: grupo.email, rol: 'administrador', permisos: null,
        moduloDeportesHabilitado: grupo.modulo_deportes_habilitado,
        moduloHipismoHabilitado: grupo.modulo_hipismo_habilitado,
        // "Cruzar jugadas" de Hipismo (24-09-2026) — viaja en el login
        // igual que los 2 de arriba, para que hipismo-mockup.html sepa,
        // sin otra llamada aparte, si este Grupo tiene permitido cruzar.
        hipismoCruzarHabilitado: grupo.hipismo_cruzar_habilitado,
        // 29-09-2026: ya no se manda grupo.logo_url crudo (podía ser un
        // archivo subido, no una URL externa, desde este mismo cambio) --
        // ver services/logoGrupo.js. "SELECT *" de arriba ya trae
        // logo_base64 sin que haga falta tocar esa consulta.
        logoUrl: urlLogoGrupo(grupo.id, grupo),
        temaColorPrimario: temaAdmin.colorPrimario,
        temaColorSecundario: temaAdmin.colorSecundario
      }
    });
  }

  // No es el Administrador de ningún grupo — probamos si es un Empleado.
  const r2 = await db.query(
    `SELECT e.*, g.activo AS grupo_activo, g.nombre AS grupo_nombre, g.logo_url AS grupo_logo_url, g.logo_base64 AS grupo_logo_base64,
            g.modulo_deportes_habilitado AS grupo_modulo_deportes_habilitado,
            g.modulo_hipismo_habilitado AS grupo_modulo_hipismo_habilitado,
            g.hipismo_cruzar_habilitado AS grupo_hipismo_cruzar_habilitado,
            g.tema_color_primario AS grupo_tema_color_primario,
            g.tema_color_secundario AS grupo_tema_color_secundario
       FROM empleados e JOIN grupos g ON g.id = e.grupo_id
      WHERE e.email = $1`,
    [email]
  );
  const empleado = r2.rows[0];
  if (!empleado) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

  const okEmpleado = await bcrypt.compare(password, empleado.password_hash);
  if (!okEmpleado) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  if (!empleado.grupo_activo) return res.status(403).json({ error: 'Esta cuenta todavía no está activada. Contacta al administrador de la plataforma.' });
  if (!empleado.activo) return res.status(403).json({ error: 'Esta cuenta de empleado fue desactivada. Contacta al administrador de tu grupo.' });
  // "Ningún módulo activo" (26-09-2026) — mismo chequeo que el login del
  // Administrador de arriba: si el grupo al que pertenece este Empleado
  // tiene Deportes Y Hipismo desactivados, tampoco lo deja entrar.
  if (!empleado.grupo_modulo_deportes_habilitado && !empleado.grupo_modulo_hipismo_habilitado) {
    return res.status(403).json({ error: 'Este grupo no tiene ningún módulo activo (ni Deportes ni Hipismo). Contacta al administrador de la plataforma.' });
  }

  db.query(
    'UPDATE empleados SET ultimo_login_en = now(), ultimo_login_ip = $1, ultimo_login_user_agent = $2 WHERE id = $3',
    [req.ip || null, req.headers['user-agent'] || null, empleado.id]
  ).catch(e => console.error('No se pudo registrar el último login del empleado (no afecta el login en sí):', e.message));

  const tokenEmpleado = firmarSesionEmpleado(empleado);
  const permisos = Array.isArray(empleado.permisos) ? empleado.permisos : [];
  // temaColorPrimario/Secundario (01-10-2026) — mismo alias que ya usa
  // logoUrl arriba (campoUrl/campoBase64): el JOIN trae las columnas de
  // "grupos" con el prefijo "grupo_" para no chocar con las propias del
  // empleado, así que temaColorGrupo() necesita que se le diga bajo qué
  // nombre quedaron.
  const temaEmpleado = temaColorGrupo(empleado, { campoPrimario: 'grupo_tema_color_primario', campoSecundario: 'grupo_tema_color_secundario' });
  res.json({
    token: tokenEmpleado,
    grupo: {
      id: empleado.grupo_id, nombre: empleado.grupo_nombre, email: empleado.email, rol: 'empleado', permisos, nombreEmpleado: empleado.nombre,
      moduloDeportesHabilitado: empleado.grupo_modulo_deportes_habilitado,
      moduloHipismoHabilitado: empleado.grupo_modulo_hipismo_habilitado,
      hipismoCruzarHabilitado: empleado.grupo_hipismo_cruzar_habilitado,
      logoUrl: urlLogoGrupo(empleado.grupo_id, empleado, { campoUrl: 'grupo_logo_url', campoBase64: 'grupo_logo_base64' }),
      temaColorPrimario: temaEmpleado.colorPrimario,
      temaColorSecundario: temaEmpleado.colorSecundario
    }
  });
}));

module.exports = router;
