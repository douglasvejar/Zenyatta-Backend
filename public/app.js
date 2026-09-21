// =================================================================
// Deportes Zenyatta — Frontend (Fase 0)
// =================================================================
// Habla con la API REST del backend (server.js) en vez de guardar todo en
// localStorage como la versión anterior. localStorage se usa acá SOLO para
// dos cosas chiquitas del lado del navegador: el token de sesión (para no
// tener que loguearse cada vez que se refresca la página) y la preferencia
// de columnas visibles en Balance General — igual que hacía la app
// original, nada de esto es el "dato" en sí, que ahora vive en Postgres.
// =================================================================

let TOKEN = localStorage.getItem('zenyatta_token') || null;
let GRUPO = null;
try { GRUPO = JSON.parse(localStorage.getItem('zenyatta_grupo') || 'null'); } catch (e) { GRUPO = null; }

let JUGADORES_CACHE = [];
let MAPA_ID_EQUIPOS_MLB = {};
// Nombres oficiales de equipo por deporte, para el datalist de "Registrar
// Equipo o Apodo Nuevo" (ver sección "3B" más abajo) — un array por
// deporte en vez de una sola lista mezclada, para que al elegir el
// deporte en el selector el campo "Nombre Oficial API" solo sugiera los
// equipos de ESE deporte (28-08-2026, a pedido explícito del usuario:
// "agregame los nombres oficiales cuando seleccione nfl para poder ir
// agregando los apodos a medida de que vayan jugando"). "nhl"/"soccer"
// quedan como arrays vacíos hasta que se conecte su API — mientras tanto
// el campo simplemente no sugiere nada para esos 2 (no rompe nada, el
// grupo puede seguir escribiendo el nombre a mano).
let NOMBRES_OFICIALES_POR_DEPORTE = { mlb: [], nfl: [], nhl: [], soccer: [] };
let ULTIMO_PLANO_WHATSAPP = null; // { fecha, grupos: [{ cliente, boletos: [...] }] }
let ULTIMOS_TICKETS = []; // último resultado de /api/sabana/procesar, para los botones "Debug"
let ULTIMA_FECHA_PROCESADA = null; // fecha del último "Procesar Sábana", para la Pizarra en Vivo
// "pollaRegistrada" (03-09-2026, a pedido del usuario): true solo si la
// fecha recién procesada tiene filas de Polla cargadas — cada grupo juega
// su Polla un día fijo distinto (ver comentario grande en renderDashboard),
// así que esto SIEMPRE sale del backend, nunca de asumir un día de la
// semana. aplicarVisibilidadColumnasResumen() lo usa para ocultar del todo
// las columnas de Polla / Total Día los días que el grupo no la registró.
let POLLA_REGISTRADA_HOY = false;
let EQUIPOS_RELEVANTES_HOY = new Set(); // equipos oficiales detectados en la última sábana procesada
let PIZARRA_INTERVALO = null; // id del setInterval del auto-refresco (20s), para poder cancelarlo
let ULTIMO_ERROR_ENVIO_WHATSAPP = null; // objeto completo { en, jid, mensaje, detalle } del último error al mandar por WhatsApp, para "📋 Copiar detalle del error"
let ALERTAS_INTERVALO = null; // id del setInterval que revisa alertas + chat sin leer (25s) — corre SIEMPRE mientras haya sesión, sin importar en qué pestaña se esté (a diferencia de la Pizarra, que solo corre en Sábana)
let CHAT_WIDGET_ABIERTO = false; // si el panel de la bandeja de chat flotante está abierto o minimizado (ver sección "CHAT DE SOPORTE" más abajo)
let CHAT_WIDGET_POLL_ABIERTO = null; // id del setInterval que refresca los mensajes mientras el panel está ABIERTO (para que se vea "en vivo" sin tener que cerrar y abrir)
// Qué pestaña está viendo el Grupo ahora mismo (04-09-2026, a pedido del
// usuario: "la pagina se queda un poco pegada... se tarda un poco en
// cargar los valores") — ver mostrarVista()/intentarCargarResumenWhatsappAutomatico()
// más abajo: el refresco automático de "Resumen por Cliente" (cada 25s)
// consulta EN PARALELO las 5 APIs de resultados en vivo (MLB/NFL/NHL/
// fútbol/NBA) y después redibuja varias tablas — trabajo pesado que antes
// corría de fondo sin importar qué pestaña estuviera mirando el Grupo
// (Balance General, Comisión, etc.), compitiendo por la red/CPU del
// navegador con lo que sea que estuviera haciendo. Ahora ese refresco
// pesado se salta solo si el Grupo no está en la pestaña "📋 Sábana".
let VISTA_ACTUAL = 'sabana';

// =================================================================
// BLOQUEO DE SCROLL DE FONDO CON UN MODAL ABIERTO (20-09-2026, a pedido
// del usuario: "cuando ingreso a travez de un telefono... quiero deslizar
// hacia abajo para ver mas informacion no baja, baja es la pantalla
// anterior que esta en el fondo... en pc si baja"). Ningún ".modal-fondo"
// de esta página (historial de cliente, capturas de imagen, editar
// ticket, extraer sábana de texto, etc.) bloqueaba el scroll del body de
// atrás mientras estaba abierto. En PC no se notaba porque la rueda del
// mouse siempre scrollea lo que esté bajo el cursor, pero en celular el
// dedo terminaba arrastrando la página de fondo en vez del cuadro nuevo.
// Se resuelve acá de forma GENÉRICA con un MutationObserver por cada
// .modal-fondo que ya existe en el HTML: mira si se le agrega/saca la
// clase "activo" o se le cambia el style.display a mano (las 2 formas
// que usa esta página para abrir/cerrar modales) y prende/apaga
// body.scroll-bloqueado (CSS en grupo.html) — así cubre TODOS los
// modales actuales sin tener que tocar cada función abrirXxx()/
// cerrarXxx() una por una, y también cualquiera que se agregue después.
let SCROLL_LOCK_Y_GUARDADO = 0;
function hayModalFondoVisible() {
  return Array.from(document.querySelectorAll('.modal-fondo'))
    .some(function (el) { return window.getComputedStyle(el).display !== 'none'; });
}
function actualizarBloqueoScrollFondo() {
  const debeBloquear = hayModalFondoVisible();
  const yaBloqueado = document.body.classList.contains('scroll-bloqueado');
  if (debeBloquear && !yaBloqueado) {
    SCROLL_LOCK_Y_GUARDADO = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = '-' + SCROLL_LOCK_Y_GUARDADO + 'px';
    document.body.classList.add('scroll-bloqueado');
  } else if (!debeBloquear && yaBloqueado) {
    document.body.classList.remove('scroll-bloqueado');
    document.body.style.top = '';
    window.scrollTo(0, SCROLL_LOCK_Y_GUARDADO);
  }
}
// app.js se carga al final de <body>, así que los .modal-fondo (HTML
// estático de grupo.html) ya existen en el DOM en este punto.
document.querySelectorAll('.modal-fondo').forEach(function (modal) {
  new MutationObserver(actualizarBloqueoScrollFondo)
    .observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
});

// =================================================================
// "MONEDA DEL GRUPO" (18-09-2026, feature nueva del backend — ver
// GET/PUT /api/grupo/moneda-modo y la nota grande en sql/schema.sql).
// 'usd'|'bs' = todo el grupo fijo en esa moneda (comportamiento de
// siempre, sin cambio); 'mixto' = cada cliente tiene su propia moneda y
// los reportes con dinero se dividen en 2 bloques (USD/Bs). Se carga una
// sola vez al iniciar sesión (ver mostrarApp()) y también cada vez que
// se guarda un cambio desde la pestaña "💱 Moneda" — el formulario de
// Jugador y la tabla de "Resumen por Cliente"/Sábanas/Balance
// General/% Devueltos la leen desde esta variable en vez de pedirla de
// nuevo cada vez, para no multiplicar llamadas a la API.
let MONEDA_MODO_GRUPO = 'usd';

// =================================================================
// "CUENTAS POR EMPLEADO" (18-09-2026, a pedido del usuario — ver la nota
// grande en src/routes/empleados.js). Cache de la última lista de
// empleados pedida (Administración > Empleados) y de las 11 claves de
// permiso válidas que el backend acepta, para no tener que volver a
// pedir "permisos-disponibles" cada vez que se abre/cierra el
// formulario de alta.
// =================================================================
let EMPLEADOS_CACHE = [];
let PERMISOS_DISPONIBLES_CACHE = [];

// Etiquetas humanas para cada clave de permiso (mismos íconos/texto que
// ya usa el propio sidebar para esa misma pestaña, para que un
// Administrador reconozca de una qué es cada casilla). Si el backend
// llegara a agregar una clave nueva que no está en este mapa, el
// checklist igual la muestra (con la clave cruda como respaldo) en vez
// de que desaparezca silenciosamente — ver renderChecklistPermisosEmpleado().
const ETIQUETAS_PERMISOS = {
  sabana: '📋 Sábana (vista diaria)',
  sabanas: '🗂️ Sábanas (historial, papelera)',
  whatsapp: '📲 Sábana Automática (WhatsApp)',
  equipos: '🏷️ Apodos de Equipos',
  pagos: '💳 Pagos',
  jugador: '👤 Jugador (clientes)',
  porcentajes: '📊 % Devueltos',
  balanceGeneral: '📒 Balance General',
  transferencias: '🔄 Transferencias',
  polla: '🎲 Polla',
  alertas: '🔔 Alertas / Chat',
  descargar: '⬇️ Descargar (Saldos Semana, Excel, PDF)'
};

// ¿Esta sesión tiene el permiso `clave` (uno de ETIQUETAS_PERMISOS de
// arriba)? Un Administrador (GRUPO.permisos === null) SIEMPRE tiene
// acceso a todo. Esto NO es la capa de seguridad real — esa ya existe en
// el backend (requierePermiso(), ver middleware/auth.js) — es nada más
// para decidir, del lado del navegador, si conviene siquiera INTENTAR
// pedirle algo a una ruta protegida por permiso.
//
// Por qué hace falta esto (18-09-2026, encontrado al implementar esta
// misma feature, no a pedido explícito del usuario): el helper api() de
// arriba cierra la sesión SOLA en cualquier 401/403 (para el caso normal
// de "tu sesión venció") — pero un Empleado sin, por ejemplo, permiso
// 'pagos' o 'alertas' iba a recibir 403 en las revisiones de fondo que
// corren SIEMPRE cada 25s (revisarNotificacionesFondo) apenas iniciaba
// sesión, y quedaba deslogueado de inmediato sin haber hecho nada malo.
// Se usa como guarda ANTES de llamar a una ruta gateada por permiso, en
// vez de tocar api()/cerrarSesion() (que sí deben seguir cerrando sesión
// ante un 403 real de sesión inválida).
function tienePermiso(clave) {
  if (!GRUPO || GRUPO.rol !== 'empleado') return true;
  // Defensivo (no debería pasar para un Empleado, ver auth.js): sin un
  // array de permisos no hay nada que negar.
  if (!Array.isArray(GRUPO.permisos)) return true;
  return GRUPO.permisos.includes(clave);
}

// =================================================================
// 0. HELPER DE LLAMADAS A LA API
// =================================================================
async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;

  let res;
  try {
    res = await fetch(path, Object.assign({}, options, { headers }));
  } catch (e) {
    throw new Error('No se pudo conectar con el servidor. ¿Está corriendo "npm start"?');
  }

  let data = null;
  try { data = await res.json(); } catch (e) { /* respuestas 204 no traen body */ }

  if (res.status === 401 || res.status === 403) {
    // La sesión venció o el grupo fue desactivado por el súper-admin — se
    // cierra sesión sola, salvo que el que falló haya sido el propio login
    // (ahí el 401 es "email o contraseña incorrectos", no hay sesión que cerrar).
    if (path !== '/api/auth/login') {
      cerrarSesion(data && data.error ? data.error : 'Tu sesión venció. Inicia sesión de nuevo.');
      throw new Error('Sesión inválida.');
    }
  }

  if (!res.ok) {
    throw new Error((data && data.error) || ('Error inesperado (' + res.status + ').'));
  }
  return data;
}

function formatMoney(n) {
  const num = Number(n) || 0;
  return (num < 0 ? '-$' : '$') + Math.abs(num).toFixed(2);
}

function hoyISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mes + '-' + dia;
}

// "lun 01/09" a partir de una fecha 'YYYY-MM-DD' — se parsea como UTC
// (mismo criterio que listaDeFechas() en balanceGeneral.js) para que no
// se corra un día por la zona horaria del navegador del usuario.
const DIAS_SEMANA_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function etiquetaDiaCorta(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  if (isNaN(d.getTime())) return fechaISO;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return DIAS_SEMANA_CORTO[d.getUTCDay()] + ' ' + dd + '/' + mm;
}

// "Miércoles" a partir de 'YYYY-MM-DD' (03-09-2026, a pedido del usuario:
// "a pesar de que a la izquierda se ve la fecha, no sé qué día es" — en
// el historial de cliente, agrupado por día, se necesita el nombre
// completo, no la abreviatura de 3 letras que ya usa etiquetaDiaCorta()
// para el desglose chico de Balance General). Mismo criterio UTC que
// etiquetaDiaCorta() para no correrse un día por la zona horaria.
const DIAS_SEMANA_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
function etiquetaDiaLarga(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  if (isNaN(d.getTime())) return fechaISO;
  return DIAS_SEMANA_LARGO[d.getUTCDay()];
}

// "01-09-2026" a partir de 'YYYY-MM-DD' (03-09-2026, a pedido del usuario:
// el badge de "Día confirmado" mostraba SOLO la hora en que se guardó —
// ej. "2/9/2026, 13:57:12" — sin la fecha de la sábana que se estaba
// guardando, así que un usuario que confirma HOY una sábana de un día
// ANTERIOR podía confundir esa hora con "se guardó como el día 2" cuando
// en realidad los datos siguen atados a la fecha correcta, solo que el
// CLIC de guardar pasó hoy. Se parsea como UTC, mismo criterio que
// etiquetaDiaCorta(), para no correrse un día por la zona horaria.
function formatFechaDDMMYYYY(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  if (isNaN(d.getTime())) return fechaISO;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return dd + '-' + mm + '-' + d.getUTCFullYear();
}

// =================================================================
// 1. LOGIN / SESIÓN
// =================================================================
async function iniciarSesion() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorBox = document.getElementById('loginError');
  errorBox.textContent = '';

  if (!email || !password) {
    errorBox.textContent = 'Ingresa tu email y contraseña.';
    return;
  }

  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    TOKEN = data.token;
    GRUPO = data.grupo;
    localStorage.setItem('zenyatta_token', TOKEN);
    localStorage.setItem('zenyatta_grupo', JSON.stringify(GRUPO));
    mostrarApp();
  } catch (e) {
    errorBox.textContent = e.message;
  }
}

function cerrarSesion(mensaje) {
  TOKEN = null;
  GRUPO = null;
  localStorage.removeItem('zenyatta_token');
  localStorage.removeItem('zenyatta_grupo');
  if (PIZARRA_INTERVALO) { clearInterval(PIZARRA_INTERVALO); PIZARRA_INTERVALO = null; }
  if (ALERTAS_INTERVALO) { clearInterval(ALERTAS_INTERVALO); ALERTAS_INTERVALO = null; }
  if (CHAT_WIDGET_POLL_ABIERTO) { clearInterval(CHAT_WIDGET_POLL_ABIERTO); CHAT_WIDGET_POLL_ABIERTO = null; }
  cerrarChatWidget();
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('vistaLogin').style.display = 'block';
  document.getElementById('loginError').textContent = mensaje || '';
  document.getElementById('loginPassword').value = '';
}

function mostrarApp() {
  document.getElementById('vistaLogin').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  // "Cuentas por Empleado" (18-09-2026): si el que inició sesión es un
  // Empleado (GRUPO.rol === 'empleado'), GRUPO.email es SU propio email
  // de login (no el del Grupo/negocio) y GRUPO.nombreEmpleado trae su
  // nombre — se muestran los dos junto con el nombre del Grupo al que
  // pertenece, para que quede claro con qué cuenta puntual entró (sobre
  // todo si un mismo Grupo tiene varios Empleados con acceso). El
  // Administrador (rol==='administrador') sigue viendo exactamente el
  // mismo texto de siempre.
  document.getElementById('topbarGrupo').textContent = (GRUPO.rol === 'empleado')
    ? 'Conectado como: ' + GRUPO.nombreEmpleado + ' — ' + GRUPO.nombre + ' (' + GRUPO.email + ')'
    : 'Conectado como: ' + GRUPO.nombre + ' (' + GRUPO.email + ')';
  // "Deportes Zenyatta" (15-09-2026, a pedido del usuario) ya no va fijo
  // arriba de "Verificador de Sábana" — cada Grupo ve ahí su propio
  // nombre (mismo criterio que ya se usaba en el Plano de WhatsApp, ver
  // generarPlanoWhatsApp() más abajo).
  const tituloSabanaEl = document.getElementById('tituloSabana');
  if (tituloSabanaEl) tituloSabanaEl.textContent = GRUPO.nombre + ' — Verificador de Sábana';
  document.getElementById('fechaPartidos').value = hoyISO();
  document.getElementById('transferFecha').value = hoyISO();
  cargarMapaLogosEquipos();
  cargarNombresOficialesDeporte('nfl');
  cargarNombresOficialesDeporte('nhl');
  cargarNombresOficialesDeporte('soccer');
  cargarNombresOficialesDeporte('basket');
  cargarNombresOficialesDeporte('ncaaf');
  cargarEquiposPersonalizados();
  // "Moneda del Grupo" (18-09-2026) se carga ACÁ, antes de mostrar
  // cualquier pestaña, para que MONEDA_MODO_GRUPO ya esté correcta la
  // primera vez que el Grupo abre Jugador/Sábana/etc. (si se dejara para
  // recién cuando se abre la pestaña "💱 Moneda", el selector de moneda
  // del formulario de Jugador se quedaría escondido hasta ese momento
  // aunque el grupo ya estuviera en modo 'mixto').
  cargarMonedaModoGrupo();
  cargarJugadores();
  // "Cuentas por Empleado" (18-09-2026) — oculta del sidebar lo que este
  // Empleado no tiene permiso de ver, y devuelve su primera pestaña
  // permitida (para un Administrador, o si el Empleado sí tiene permiso
  // 'sabana', esto da null/'sabana' y no cambia el arranque de siempre).
  const vistaInicialEmpleado = aplicarPermisosEmpleado();
  mostrarVista(vistaInicialEmpleado || 'sabana');

  // El badge de Alertas y el de la bandeja de chat se revisan cada 25s
  // SIEMPRE (no solo en la pestaña Sábana como la Pizarra en Vivo) — así,
  // si el Súper-admin manda un mensaje o el sistema genera una alerta
  // nueva mientras el Grupo está viendo otra pestaña, igual se entera sin
  // tener que ir a mirar (ver revisarNotificacionesFondo más abajo).
  revisarNotificacionesFondo();
  if (ALERTAS_INTERVALO) clearInterval(ALERTAS_INTERVALO);
  ALERTAS_INTERVALO = setInterval(revisarNotificacionesFondo, 25000);
}

// Revisa en un solo lugar las 2 cosas que pueden generar una notificación
// de fondo sin que el Grupo esté mirando esa pestaña puntual: alertas de
// tickets AMBIGUA (badge de la pestaña 🔔 Alertas) y mensajes nuevos del
// Súper-admin (badge + parpadeo de la bandeja de chat flotante).
function revisarNotificacionesFondo() {
  actualizarBadgeAlertas();
  actualizarBadgeChatWidget();
  actualizarBadgeWhatsapp();
  actualizarBadgePagosGrupo();
}

// =================================================================
// 2. NAVEGACIÓN ENTRE PESTAÑAS
// =================================================================
function toggleGrupoAdmin() {
  const grupo = document.getElementById('grupoAdmin');
  const caret = document.getElementById('adminCaret');
  const abierto = grupo.style.display !== 'none';
  grupo.style.display = abierto ? 'none' : 'flex';
  if (caret) caret.innerText = abierto ? '▸' : '▾';
}

// "whatsapp" (Sábana Automática) y "equipos" (Apodos de Equipos) se
// agregaron acá el 14-09-2026, a pedido del usuario ("quiero que la parte
// de sabana automatica y de los apodos de los equipos queden dentro de la
// barra de administracion para que no esten en sabana al iniciar la
// pagina") — antes vivían siempre visibles adentro de la pestaña 📋
// Sábana; ahora son 2 vistas más del menú ⚙️ Administración, igual que
// Jugador/Comisión/etc. Ningún dato ni función cambió, solo DÓNDE vive el
// HTML (ver renderPanelWhatsapp()/cargarEquiposPersonalizados() más abajo,
// siguen actualizando esos mismos ids sin importar qué pestaña se vea).
// "monedaGrupo" y "empleados" (18-09-2026) se agregan al final — ambas
// EXCLUSIVAS del Administrador (ver aplicarPermisosEmpleado() más abajo),
// viven dentro de "⚙️ Administración" así que NO van en
// VISTAS_FUERA_DE_ADMINISTRACION (mismo criterio que Jugador/Comisión/etc.).
const VISTAS = ['sabana', 'whatsapp', 'equipos', 'pagos', 'jugador', 'comision', 'porcentajes', 'balanceGeneral', 'transferencias', 'polla', 'sabanas', 'descargar', 'alertas', 'monedaGrupo', 'empleados'];
const NAV_IDS = { sabana: 'navSabana', whatsapp: 'navWhatsapp', equipos: 'navEquipos', pagos: 'navPagos', jugador: 'navJugador', comision: 'navComision', porcentajes: 'navPorcentajes', balanceGeneral: 'navBalanceGeneral', transferencias: 'navTransferencias', polla: 'navPolla', sabanas: 'navSabanas', descargar: 'navDescargar', alertas: 'navAlertas', monedaGrupo: 'navMonedaGrupo', empleados: 'navEmpleados' };

// "Sábana Automática"/"Apodos de Equipos"/"Pagos" (15-09-2026) ya NO viven
// dentro de "⚙️ Administración" — son botones propios del menú, así que
// NO tienen que abrir el submenú plegable al entrar a ellos (antes,
// cuando sí vivían ahí adentro, esta lista solo excluía 'sabana'/'alertas').
const VISTAS_FUERA_DE_ADMINISTRACION = ['sabana', 'alertas', 'whatsapp', 'equipos', 'pagos'];

function mostrarVista(nombre) {
  VISTA_ACTUAL = nombre;
  VISTAS.forEach(v => {
    const el = document.getElementById('vista' + v.charAt(0).toUpperCase() + v.slice(1));
    if (el) el.style.display = (v === nombre) ? 'block' : 'none';
    const nav = document.getElementById(NAV_IDS[v]);
    if (nav) nav.classList.toggle('nav-item-active', v === nombre);
  });
  if (!VISTAS_FUERA_DE_ADMINISTRACION.includes(nombre)) document.getElementById('grupoAdmin').style.display = 'flex';

  if (nombre === 'pagos') cargarPagosGrupo();
  // "Moneda del Grupo" (18-09-2026) — al entrar a Jugador se refresca la
  // visibilidad del selector de moneda del formulario, por si se cambió
  // el modo del grupo en otra pestaña del navegador mientras tanto.
  if (nombre === 'jugador') { cargarJugadores(); actualizarVisibilidadMonedaJugador(); }
  if (nombre === 'comision') { cargarJugadores().then(() => cargarAvales()); }
  if (nombre === 'porcentajes') aplicarRangoRapidoPanel('pd');
  if (nombre === 'balanceGeneral') { cargarColumnasBalanceGuardadas(); aplicarRangoRapidoPanel('bg'); }
  if (nombre === 'transferencias') { cargarJugadores().then(() => cargarTransferencias()); }
  if (nombre === 'polla') { if (!document.getElementById('pollaFecha').value) document.getElementById('pollaFecha').value = hoyISO(); cargarPolla(); }
  if (nombre === 'sabanas') { cargarColumnasSabanaDiaGuardadas(); if (!document.getElementById('sabanasFecha').value) document.getElementById('sabanasFecha').value = hoyISO(); cargarSabanaDia(); }
  if (nombre === 'descargar') { cargarColumnasSaldosSemanaGuardadas(); cargarSaldosSemana(); }
  if (nombre === 'alertas') { cargarAlertas(); marcarAlertasLeidas(); }
  // "Moneda del Grupo" / "Cuentas por Empleado" (18-09-2026, ambas
  // exclusivas del Administrador — ver aplicarPermisosEmpleado()).
  if (nombre === 'monedaGrupo') cargarMonedaModoGrupo();
  if (nombre === 'empleados') cargarEmpleados();

  // La Pizarra en Vivo solo se auto-refresca mientras la pestaña Sábana
  // está a la vista — al salir se pausa (no tiene sentido seguir pegándole
  // a la API cada 20s de fondo), y al volver se retoma de una vez.
  if (nombre === 'sabana') {
    cargarColumnasResumenGuardadas();
    if (ULTIMA_FECHA_PROCESADA) actualizarPizarraEnVivo();
    // El refresco automático de WhatsApp también estaba pausado mientras
    // no se estaba en esta pestaña (ver intentarCargarResumenWhatsappAutomatico) —
    // se retoma de una vez al volver, en vez de esperar hasta 25s al
    // próximo ciclo de fondo.
    actualizarBadgeWhatsapp();
  } else if (PIZARRA_INTERVALO) {
    clearInterval(PIZARRA_INTERVALO);
    PIZARRA_INTERVALO = null;
  }
}

// =================================================================
// "CUENTAS POR EMPLEADO" (18-09-2026) — oculta del sidebar los nav-items
// para los que este Empleado NO tiene permiso, y devuelve el nombre de
// la primera pestaña permitida (para que mostrarApp() no lo deje
// "aterrizar" en una pestaña que no puede ver). Un Administrador
// (GRUPO.rol === 'administrador') sigue viendo TODO, sin excepción — esta
// función no toca nada en ese caso.
//
// Esto es solo UX (el backend ya bloquea cada ruta con requierePermiso(),
// ver middleware/auth.js) — no oculta nada "a prueba de manipulación de
// localStorage", solo evita mostrarle un botón a un Empleado para algo
// que de todas formas le va a fallar con 403.
// =================================================================

// Qué permiso (de los 11 válidos, ver ETIQUETAS_PERMISOS) necesita cada
// pestaña del sidebar. "comision" no tiene una clave de permiso propia
// en el backend (son solo 11, ver PERMISOS_VALIDOS en middleware/auth.js)
// — decisión propia (no pedida explícitamente por el usuario): se agrupa
// bajo el mismo permiso que "jugador" porque vive en el mismo submenú y
// trabaja sobre los mismos clientes (% propio / avales), así que quien
// puede administrar Jugador razonablemente también puede administrar su
// Comisión, sin inventar una clave #12 solo para esto.
const MAPA_VISTA_PERMISO = {
  sabana: 'sabana',
  sabanas: 'sabanas',
  whatsapp: 'whatsapp',
  equipos: 'equipos',
  pagos: 'pagos',
  jugador: 'jugador',
  comision: 'jugador',
  porcentajes: 'porcentajes',
  balanceGeneral: 'balanceGeneral',
  transferencias: 'transferencias',
  polla: 'polla',
  alertas: 'alertas',
  descargar: 'descargar'
};

function aplicarPermisosEmpleado() {
  // "💱 Moneda" y "👥 Empleados" (18-09-2026) quedan ocultos para
  // CUALQUIER Empleado, sin excepción — no tienen un permiso propio en
  // la lista de 11 porque son exclusivos del Administrador (ver la nota
  // grande junto a estos 2 botones en grupo.html).
  if (GRUPO && GRUPO.rol === 'empleado') {
    const navMoneda = document.getElementById('navMonedaGrupo');
    const navEmpleados = document.getElementById('navEmpleados');
    if (navMoneda) navMoneda.style.display = 'none';
    if (navEmpleados) navEmpleados.style.display = 'none';
  }

  // Un Administrador ve todo — nada más que hacer. Tampoco hay nada que
  // ocultar si, por lo que sea, GRUPO.permisos no es un array (defensivo:
  // esto no debería pasar para un Empleado, ver routes/auth.js).
  if (!GRUPO || GRUPO.rol !== 'empleado' || !Array.isArray(GRUPO.permisos)) return null;

  let primeraVistaPermitida = null;
  VISTAS.forEach(vista => {
    const clavePermiso = MAPA_VISTA_PERMISO[vista];
    if (!clavePermiso) return; // 'monedaGrupo'/'empleados' ya se ocultaron arriba
    const permitido = GRUPO.permisos.includes(clavePermiso);
    const boton = document.getElementById(NAV_IDS[vista]);
    if (boton) boton.style.display = permitido ? '' : 'none';
    if (permitido && !primeraVistaPermitida) primeraVistaPermitida = vista;
  });

  // "⚙️ Administración" (el botón padre plegable) se oculta ENTERO si
  // TODOS sus hijos (Jugador/Comisión/%Devueltos/Balance
  // General/Transferencias/Polla/Sábanas, más Moneda/Empleados que ya
  // quedaron ocultos arriba) terminaron ocultos — así no se deja un
  // submenú vacío que se pueda desplegar sin nada adentro.
  const hijosDelSubmenu = document.querySelectorAll('#grupoAdmin .nav-item');
  const todosOcultos = Array.from(hijosDelSubmenu).every(el => el.style.display === 'none');
  const botonAdministracion = document.querySelector('.sidebar-admin .nav-parent');
  if (botonAdministracion) botonAdministracion.style.display = todosOcultos ? 'none' : '';

  return primeraVistaPermitida;
}

// =================================================================
// 3. LOGOS DE EQUIPO (decoración visual, opcional — si la API de MLB no
// responde por cualquier motivo simplemente no se muestran logos).
// =================================================================
async function cargarMapaLogosEquipos() {
  try {
    const res = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Yes');
    const json = await res.json();
    if (!json.teams) return;
    json.teams.forEach(t => { MAPA_ID_EQUIPOS_MLB[t.name.toLowerCase()] = t.id; });

    // Guarda los 30 nombres reales de MLB para el datalist de "Registrar
    // Equipo Nuevo" (ver actualizarDatalistEquiposOficiales más abajo) — no
    // se escribe directo al <datalist> acá, porque el datalist se filtra
    // por el deporte elegido en el selector, y este fetch puede terminar
    // en cualquier orden respecto al de NFL.
    NOMBRES_OFICIALES_POR_DEPORTE.mlb = json.teams.map(t => t.name).sort();
    actualizarDatalistEquiposOficiales();
  } catch (e) {
    console.error('No se pudo cargar el logo de los equipos de MLB:', e);
  }
}

// urlDirecta: algunas APIs (ej. NFL/ESPN) ya traen el logo del equipo
// directo en la respuesta del marcador — si viene, se usa tal cual y no
// hace falta el mapa nombre->id que sí necesita MLB.
// Guarda los nombres oficiales reales de un deporte (mismo patrón que MLB
// arriba, pero para cualquier deporte que el backend sepa servir) para el
// datalist de "Registrar Equipo o Apodo Nuevo".
//
// OJO (corregido 28-08-2026, reportado por el usuario: el datalist solo
// mostraba nombres para MLB): esto ANTES le pegaba directo desde el
// navegador a la API de ESPN, y esa API no deja que un navegador le pegue
// directo (CORS) — el fetch fallaba en silencio (quedaba atrapado en el
// catch de abajo) y el datalist se quedaba vacío para NFL, aunque para
// MLB sí funcionaba porque statsapi.mlb.com sí permite el pedido directo
// desde un navegador. Ahora esto le pide la lista al PROPIO BACKEND
// (`GET /api/equipos/nombres-oficiales/:deporte`, ver src/routes/equipos.js),
// que sí puede pegarle directo a la API externa sin restricción de CORS —
// mismo patrón que ya usa la Pizarra en Vivo. No falla nada si la llamada
// no responde (ej. sin internet) — el datalist simplemente se queda sin
// sugerencias para ese deporte hasta que se pueda cargar.
async function cargarNombresOficialesDeporte(deporte) {
  // Guarda de permiso (18-09-2026, ver tienePermiso() más arriba) — esto
  // se llama sin condición desde mostrarApp() apenas se inicia sesión, y
  // /api/equipos/* está gateado por el permiso 'equipos' en el backend.
  if (!tienePermiso('equipos')) return;
  try {
    const data = await api('/api/equipos/nombres-oficiales/' + deporte);
    NOMBRES_OFICIALES_POR_DEPORTE[deporte] = (data && data.nombres) || [];
    actualizarDatalistEquiposOficiales();
  } catch (e) {
    console.error('No se pudo cargar la lista de equipos de ' + deporte + ':', e);
  }
}

// Repinta el <datalist> de "Nombre Oficial API" (cajón "Registrar Equipo o
// Apodo Nuevo") con SOLO los nombres del deporte elegido en el selector
// "Deporte" de ese mismo cajón — así, si el grupo elige "NFL", el campo
// solo sugiere los 32 equipos de NFL (no una mezcla con los de MLB), y
// puede ir agregando apodos nuevos a medida que esos equipos van jugando,
// sin confundirse de deporte (28-08-2026, a pedido explícito del usuario).
// Se llama: cada vez que termina de cargar la lista de un deporte (arriba),
// y cada vez que el selector "Deporte" cambia (onchange en index.html).
function actualizarDatalistEquiposOficiales() {
  const datalist = document.getElementById('listaEquiposOficiales');
  const selectDeporte = document.getElementById('nuevoDeporte');
  if (!datalist || !selectDeporte) return;

  const deporte = selectDeporte.value;
  // El <select> ahora recorta con "..." el texto de la opción elegida si
  // no entra en su ancho (ver CSS, 01-09-2026 — antes se ensanchaba toda
  // la fila para mostrarlo completo) — se le pone el texto completo como
  // "title" para que siga apareciendo al pasar el mouse por encima.
  const opcionElegida = selectDeporte.options[selectDeporte.selectedIndex];
  if (opcionElegida) selectDeporte.title = opcionElegida.getAttribute('title') || opcionElegida.textContent;
  const nombres = NOMBRES_OFICIALES_POR_DEPORTE[deporte] || [];
  datalist.innerHTML = '';
  nombres.forEach(nombre => {
    const option = document.createElement('option');
    option.value = nombre;
    datalist.appendChild(option);
  });

  const ayuda = document.getElementById('ayudaNombreOficialEquipo');
  if (ayuda) {
    if (nombres.length > 0) {
      ayuda.textContent = '💡 El campo "Nombre Oficial API" te sugiere los ' + nombres.length + ' equipos reales de ' + NOMBRE_LARGO_DEPORTE(deporte) + ' mientras escribís, para que no se desalinee con la API.';
    } else {
      ayuda.textContent = '💡 Este deporte todavía no tiene su API conectada, así que no hay sugerencias todavía — podés escribir el nombre oficial a mano, y va a quedar guardado listo para cuando se conecte.';
    }
  }
}

function NOMBRE_LARGO_DEPORTE(deporte) {
  return { mlb: 'MLB', nfl: 'NFL', nhl: 'NHL', soccer: 'Fútbol Europeo' }[deporte] || deporte.toUpperCase();
}

// El logo NUNCA se pide directo al CDN externo (mlbstatic.com/
// espncdn.com) desde el <img> — se pide a través de nuestro propio
// backend (src/routes/imagenes.js) con urlLogoProxy(). En pantalla los
// 2 caminos se ven exactamente igual, pero pedirlo directo hace que
// html2canvas (el que arma la foto/el PDF de "📸 Generar imagen"/
// "📄 Descargar PDF") deje el logo en blanco sin avisar: esos CDN no
// habilitan CORS, así que el navegador no deja que html2canvas "lea" el
// contenido de una imagen de otro origen (03-09-2026, corrigiendo el
// bug reportado por el usuario: "la imagen que me genera para enviar
// no aparecen los logos"). Pasando por nuestro propio dominio, la
// imagen queda del MISMO origen que la página — cero problema de CORS.
function urlLogoProxy(urlReal) {
  return '/api/imagenes/logo?url=' + encodeURIComponent(urlReal);
}

function logoEquipoHTML(nombreOficial, urlDirecta) {
  if (urlDirecta) {
    return '<img src="' + urlLogoProxy(urlDirecta) + '" alt="" class="logo-equipo" onerror="this.style.display=\'none\'">';
  }
  if (!nombreOficial) return '';
  const id = MAPA_ID_EQUIPOS_MLB[nombreOficial.toLowerCase()];
  if (!id) return '';
  return '<img src="' + urlLogoProxy('https://www.mlbstatic.com/team-logos/' + id + '.svg') + '" alt="" class="logo-equipo" onerror="this.style.display=\'none\'">';
}

// =================================================================
// RASTERIZAR LOGOS ANTES DE CAPTURAR (03-09-2026, segunda vuelta del
// mismo bug — el usuario mandó una captura de pantalla: "eso no son los
// logos, mira lo que me da al darle generar imagen") — el proxy de
// arriba (urlLogoProxy) resolvió el problema de CORS, pero apareció uno
// más de fondo: los escudos de MLB son SVG (mlbstatic.com), y
// html2canvas NO sabe dibujar bien un SVG complejo dentro del canvas
// que arma — en vez del escudo real, dejaba una silueta plana de un
// solo color (se veía como una banderita/triángulo en vez del logo de
// verdad). Es una limitación conocida de html2canvas con SVG, no un
// problema de CORS ni de la imagen en sí (fuera de la foto, en la
// pantalla normal, el escudo se ve perfecto — el navegador SÍ sabe
// renderizar SVG bien).
//
// La solución es "revelar" cada logo ANTES de llamar a html2canvas: se
// dibuja el <img> ya cargado por el navegador sobre un <canvas> propio
// con drawImage(), y se reemplaza el src de la imagen por el PNG
// resultante (canvas.toDataURL()) — un PNG ya "aplanado" no le genera
// ningún problema a html2canvas. Como el <img> viene de nuestro propio
// dominio (mismo origen, gracias al proxy de arriba), esto no tiñe el
// canvas ni tira SecurityError.
async function convertirLogoAPngParaCaptura(img) {
  return new Promise(resolve => {
    const rasterizar = () => {
      try {
        if (!img.naturalWidth) { resolve(); return; }
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        img.src = canvas.toDataURL('image/png');
      } catch (e) {
        // Si por lo que sea no se puede (imagen rota, formato raro,
        // etc.), se deja el <img> tal como estaba — mejor una foto sin
        // ESE logo puntual que una foto que no se termina de generar.
      }
      resolve();
    };
    if (img.complete) rasterizar();
    else { img.onload = rasterizar; img.onerror = () => resolve(); }
  });
}

async function prepararLogosParaCaptura(contenedor) {
  // "logo-grupo-captura" (21-09-2026): el logo del GRUPO en el header de
  // "📅 Saldos Semana" (ver renderSaldosSemana()) puede ser cualquier
  // formato que el Súper-admin haya subido — mismo riesgo de SVG que ya
  // se resolvió para los escudos de equipo, así que se rasteriza con el
  // mismo mecanismo, sin duplicar la función.
  const imgs = Array.from(contenedor.querySelectorAll('img.logo-equipo, img.logo-grupo-captura'));
  await Promise.all(imgs.map(convertirLogoAPngParaCaptura));
}

// =================================================================
// 3B. REGISTRAR EQUIPO O APODO NUEVO (equipos_personalizados por grupo)
// =================================================================
let EQUIPOS_PERSONALIZADOS_CACHE = [];

async function cargarEquiposPersonalizados() {
  // Guarda de permiso (18-09-2026, ver tienePermiso() más arriba) — mismo
  // motivo que cargarNombresOficialesDeporte() justo arriba.
  if (!tienePermiso('equipos')) return;
  try {
    EQUIPOS_PERSONALIZADOS_CACHE = await api('/api/equipos');
    renderListaEquiposPersonalizados();
  } catch (e) {
    console.error(e);
  }
}

function renderListaEquiposPersonalizados() {
  const cont = document.getElementById('listaEquiposPersonalizados');
  if (!cont) return;
  if (EQUIPOS_PERSONALIZADOS_CACHE.length === 0) {
    cont.innerHTML = '<small style="color:var(--text-dim);">Todavía no has registrado ningún apodo propio.</small>';
    return;
  }
  // Arreglo (15-09-2026, a pedido del usuario: "sigo teniendo textos que
  // no se leen"): este chip tenía fondo blanco pero SIN color de texto
  // propio, así que heredaba el blanco/casi-blanco del tema oscuro
  // (var(--text)) — texto blanco sobre fondo blanco, invisible. Se le
  // pone fondo celeste clarito (misma familia del acento cian de Ludox)
  // y texto azul oscuro, para que se lea siempre sin importar el tema.
  cont.innerHTML = EQUIPOS_PERSONALIZADOS_CACHE.map(eq =>
    '<span style="background:#eaf9fc; border:1px solid #8fd9e6; border-radius:14px; padding:5px 10px; font-size:12px; display:inline-flex; align-items:center; gap:6px; color:#0d1326;">' +
      '<strong>' + eq.apodo + '</strong> → ' + eq.nombre_oficial +
      ' <button type="button" onclick="eliminarEquipoPersonalizado(\'' + eq.id + '\')" style="background:none; border:none; color:#c0392b; cursor:pointer; font-weight:bold; padding:0;">✕</button>' +
    '</span>'
  ).join('');
}

async function agregarEquipoAlDiccionario() {
  const apodo = document.getElementById('nuevoApodo').value.trim();
  const nombreOficial = document.getElementById('nuevoNombreOficial').value.trim();
  const deporte = document.getElementById('nuevoDeporte').value;

  if (!apodo || !nombreOficial) {
    alert('Por favor ingresa tanto el apodo como el nombre oficial.');
    return;
  }

  try {
    await api('/api/equipos', { method: 'POST', body: JSON.stringify({ apodo, nombreOficial, deporte }) });
    alert('¡Equipo "' + apodo + '" registrado! La próxima vez que proceses la sábana ya lo va a reconocer.');
    document.getElementById('nuevoApodo').value = '';
    document.getElementById('nuevoNombreOficial').value = '';
    await cargarEquiposPersonalizados();
    // Si ya había una sábana pegada, la reprocesa sola para que el equipo
    // recién agregado se refleje de una vez — igual que hacía la app original.
    if (document.getElementById('sabanaInput').value.trim()) {
      procesarYVerificar();
    }
  } catch (e) {
    alert('No se pudo guardar el equipo: ' + e.message);
  }
}

async function eliminarEquipoPersonalizado(id) {
  if (!confirm('¿Eliminar este apodo personalizado?')) return;
  try {
    await api('/api/equipos/' + id, { method: 'DELETE' });
    cargarEquiposPersonalizados();
  } catch (e) {
    alert('No se pudo eliminar: ' + e.message);
  }
}

// =================================================================
// PANEL DE WHATSAPP (03-09-2026, a pedido del usuario: "existe alguna
// manera de que en mi chat de whatssap yo actualice la sabana y se
// cargue automatico en el sistema?" y, ese mismo día más tarde, la
// ampliación grande: auto-importar 100%, avisos en vivo cada hora,
// "SABANA FINAL"). Ver src/routes/whatsapp.js. El bot en sí
// (services/whatsappBot.js) es 100% opcional (WHATSAPP_BOT_ACTIVADO en
// .env.example) — si no está activado, este panel simplemente se queda
// oculto con un aviso.
//
// Con el auto-importado 100% automático ya NO hay ninguna bandeja de
// aprobación (Importar/Descartar) — cada "SABANA" que llega se procesa
// sola, sin que el Grupo tenga que hacer nada. Este panel muestra en su
// lugar: (a) el estado de los días recientes (candado sí/no, última
// verificación, último envío) con el botón "📤 Enviar resumen ahora", y
// (b) el log de lo último que pasó con cada mensaje recibido
// (importada/descartada/error), para enterarse sin mirar la consola del
// servidor. Se revisa junto con el resto de las notificaciones de fondo
// (ver revisarNotificacionesFondo más arriba), cada 25s, sin importar en
// qué pestaña esté el Grupo.
// =================================================================
async function actualizarBadgeWhatsapp() {
  // Guarda de permiso (18-09-2026, ver tienePermiso() más arriba) — evita
  // que un Empleado sin permiso 'whatsapp' quede deslogueado solo por
  // esta revisión de fondo que corre cada 25s sin importar la pestaña.
  if (!tienePermiso('whatsapp')) return;
  try {
    const resp = await api('/api/whatsapp/estado');
    renderPanelWhatsapp(resp);
    // "Resumen por Cliente" se autocompleta con lo que ya cargó el bot,
    // cuando este Grupo tiene el servicio contratado (04-09-2026, a
    // pedido del usuario) — ver la función más abajo.
    intentarCargarResumenWhatsappAutomatico(resp);
  } catch (e) { /* si falla el chequeo de fondo, no interrumpe nada más de la app */ }
}

const WHATSAPP_ESTADO_LABEL = {
  importada: { texto: '✅ Importada', color: '#2e7d32' },
  descartada: { texto: '➖ Descartada', color: '#888' },
  error: { texto: '⚠️ Error', color: '#c0392b' },
  pendiente: { texto: '⏳ Procesando...', color: '#a67c00' }
};

function renderPanelWhatsapp(resp) {
  const panel = document.getElementById('panelWhatsapp');
  const badgeNav = document.getElementById('whatsappPendientesBadge');
  const badgePanel = document.getElementById('whatsappPanelBadge');
  // Mensaje que se ve en "⚙️ Administración > 📲 Sábana Automática" cuando
  // este Grupo no tiene el servicio contratado — antes ese panel vivía
  // siempre a la vista en 📋 Sábana y con el div oculto alcanzaba (no
  // quedaba ningún hueco raro); ahora que es su propia vista aparte
  // (14-09-2026), sin este aviso la pantalla se vería vacía.
  const sinServicio = document.getElementById('whatsappSinServicio');

  // Servicio no contratado (04-09-2026: interruptor whatsapp_habilitado,
  // exclusivo del Súper-admin) -> el panel entero queda oculto. Este
  // Grupo sigue trabajando 100% manual, como siempre — no es un error,
  // ni algo que el Grupo tenga que "activar" solo.
  if (!resp.habilitado) {
    if (panel) panel.style.display = 'none';
    if (sinServicio) sinServicio.style.display = 'block';
    [badgeNav, badgePanel].forEach(b => { if (b) b.style.display = 'none'; });
    return;
  }
  if (panel) panel.style.display = 'block';
  if (sinServicio) sinServicio.style.display = 'none';

  // El badge de la barra de navegación ahora avisa de mensajes con
  // 'error' recientes (algo que necesita que un humano lo mire), no de
  // "pendientes por aprobar" — eso ya no existe con el auto-importado.
  const conError = (resp.recientes || []).filter(r => r.estado === 'error').length;

  [badgeNav, badgePanel].forEach(badge => {
    if (!badge) return;
    if (conError > 0) {
      badge.textContent = conError > 99 ? '99+' : conError;
      badge.style.backgroundColor = '#c0392b';
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  });

  const noConfigurado = document.getElementById('whatsappNoConfigurado');
  const sinVincular = document.getElementById('whatsappSinVincular');
  const vinculado = document.getElementById('whatsappVinculado');

  if (!resp.botActivo) {
    noConfigurado.style.display = 'block';
    sinVincular.style.display = 'none';
    vinculado.style.display = 'none';
    return;
  }
  noConfigurado.style.display = 'none';
  sinVincular.style.display = resp.grupoVinculado ? 'none' : 'block';
  vinculado.style.display = resp.grupoVinculado ? 'block' : 'none';
  if (!resp.grupoVinculado) return;

  const estadoConexion = document.getElementById('whatsappEstadoConexion');
  if (resp.estadoBot) {
    estadoConexion.textContent = resp.estadoBot.conectado
      ? '🟢 Bot conectado a WhatsApp'
      : '🔴 Bot desconectado' + (resp.estadoBot.ultimoError ? ' — ' + resp.estadoBot.ultimoError : ' (esperando conexión...)');
  } else {
    estadoConexion.textContent = '';
  }

  // (15-09-2026, a pedido del usuario tras reportar "la sábana automática
  // no se envía por WhatsApp" aunque el mensaje SÍ se reconocía/importaba
  // bien) — esto es sobre el ENVÍO del listado de vuelta al grupo (antes
  // solo visible en los logs de Railway si fallaba), distinto de la
  // importación, que ya se ve abajo en "Actividad reciente".
  const cajaErrorEnvio = document.getElementById('whatsappErrorEnvioCaja');
  const errorEnvio = resp.estadoBot && resp.estadoBot.ultimoErrorEnvio;
  if (errorEnvio) {
    document.getElementById('whatsappErrorEnvioTexto').textContent =
      '"' + errorEnvio.mensaje + '" (' + formatFechaHoraAlerta(errorEnvio.en) + ')';
    cajaErrorEnvio.style.display = 'block';
    // Se guarda el objeto COMPLETO (no solo el texto ya resumido de
    // arriba) para que "📋 Copiar detalle del error" pueda copiar todo
    // lo que el servidor logró sacarle al error real — ver
    // copiarDetalleErrorEnvioWhatsapp() más abajo.
    ULTIMO_ERROR_ENVIO_WHATSAPP = errorEnvio;
  } else {
    cajaErrorEnvio.style.display = 'none';
    ULTIMO_ERROR_ENVIO_WHATSAPP = null;
  }

  const listaDias = document.getElementById('whatsappListaDias');
  const diasVacio = document.getElementById('whatsappDiasVacio');
  const dias = resp.dias || [];
  if (dias.length === 0) {
    listaDias.innerHTML = '';
    diasVacio.style.display = 'block';
  } else {
    diasVacio.style.display = 'none';
    listaDias.innerHTML = dias.map(d => {
      const estadoTexto = d.cierreEnviado
        ? '✅ Cerrado (listado + totales ya enviados)'
        : (d.cerrado ? '🔒 SABANA FINAL recibida — esperando que terminen los últimos juegos' : (d.tieneSabana ? '🔄 Abierto' : '— sin sábana cargada —'));
      const ultimaVerif = d.ultimaVerificacionEn ? formatFechaHoraAlerta(d.ultimaVerificacionEn) : 'nunca';
      const ultimoEnvio = d.ultimoEnvioResumenEn ? formatFechaHoraAlerta(d.ultimoEnvioResumenEn) : 'nunca';
      const botonEnviar = (d.tieneSabana && !d.cierreEnviado)
        ? '<button type="button" class="btn-chico" onclick="enviarResumenWhatsappAhora(\'' + d.fecha + '\')">📤 Enviar resumen ahora</button>'
        : '';
      // "Ver y confirmar" (09-09-2026, a pedido del usuario: "si quiero
      // cerrar el dia y confirmar la sabana, que me aparezca la ultima
      // sabana en la pagina para confirmarla desde el sistema") — carga
      // ESA sábana puntual en la pestaña "📋 Sábana" (mismo GET que ya usa
      // la auto-carga, ver intentarCargarResumenWhatsappAutomatico) SIN
      // mandar nada al grupo de WhatsApp, para que el Grupo la revise y
      // apriete "💾 Guardar Día" desde acá mismo — sirve tanto para el día
      // de HOY como para cualquier día reciente de la lista.
      const botonVer = d.tieneSabana
        ? '<button type="button" class="btn-chico" onclick="verYConfirmarSabanaWhatsapp(\'' + d.fecha + '\')">👁️ Ver y confirmar</button>'
        : '';
      return '<div class="whatsapp-pendiente">' +
        '<div class="whatsapp-pendiente-cabecera"><strong>' + formatFechaDDMMYYYY(d.fecha) + '</strong><span>' + estadoTexto + '</span></div>' +
        '<div style="font-size:12px; color:#666; margin-bottom:6px;">Última verificación: ' + ultimaVerif + ' · Último envío: ' + ultimoEnvio + '</div>' +
        (botonVer || botonEnviar ? '<div class="whatsapp-pendiente-acciones">' + botonVer + botonEnviar + '</div>' : '') +
        '</div>';
    }).join('');
  }

  const listaRecientes = document.getElementById('whatsappListaRecientes');
  const recientesVacio = document.getElementById('whatsappRecientesVacio');
  const recientes = resp.recientes || [];
  if (recientes.length === 0) {
    listaRecientes.innerHTML = '';
    recientesVacio.style.display = 'block';
  } else {
    recientesVacio.style.display = 'none';
    listaRecientes.innerHTML = recientes.map(r => {
      const etiqueta = WHATSAPP_ESTADO_LABEL[r.estado] || { texto: r.estado, color: '#666' };
      const cuando = formatFechaHoraAlerta(r.recibidoEn);
      const remitente = r.remitenteNombre || r.remitente || 'un número no identificado';
      const nota = r.nota ? '<div style="font-size:12px; color:#888; margin-top:2px;">' + escapeHtml(r.nota) + '</div>' : '';
      return '<div style="border:1px solid #e3e3e3; border-radius:6px; padding:6px 10px; font-size:12px;">' +
        '<div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">' +
        '<span>' + cuando + ' — ' + escapeHtml(remitente) + '</span>' +
        '<span style="color:' + etiqueta.color + '; font-weight:600;">' + etiqueta.texto + '</span>' +
        '</div>' + nota + '</div>';
    }).join('');
  }
}

function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

// guardarJidWhatsapp() se sacó (04-09-2026): vincular/editar/desvincular
// el grupo de WhatsApp pasó a ser EXCLUSIVO del Súper-admin (ver
// superadmin.html/PATCH /api/superadmin/grupos/:id/whatsapp-jid) — antes
// el propio Grupo lo podía cambiar desde acá, lo que le hubiera dejado
// apuntar el bot a cualquier grupo de WhatsApp que quisiera.

// Botón "📤 Enviar resumen ahora" de un día puntual: fuerza el envío YA
// (salta la espera de la hora) y reinicia el reloj de 1 hora para el
// próximo aviso automático (a pedido del usuario: "tambien tener un
// boton en el panel donde se pueda enviar... y se reincia el reloj de 1
// hora nuevamente para el proximo envio").
async function enviarResumenWhatsappAhora(fecha) {
  try {
    const resultado = await api('/api/whatsapp/dias/' + fecha + '/enviar-resumen', { method: 'POST' });
    if (resultado.accion === 'ENVIAR_CIERRE') {
      alert('✅ Se mandó el cierre del día ' + formatFechaDDMMYYYY(fecha) + ' (listado final + totales).');
    } else if (resultado.accion === 'ENVIAR_ACTUALIZACION') {
      alert('✅ Se mandó el listado actualizado al grupo de WhatsApp.');
    } else if (resultado.accion === 'NADA_QUE_ENVIAR') {
      alert('No había ningún cambio nuevo desde el último envío — igual se reinició el reloj de la hora.');
    } else {
      alert('No se pudo enviar todavía: ' + (resultado.motivo || resultado.error || resultado.accion));
    }
    actualizarBadgeWhatsapp();
  } catch (e) {
    alert('No se pudo enviar el resumen: ' + e.message);
  }
}

// Botón "👁️ Ver y confirmar" de un día puntual (09-09-2026, a pedido del
// usuario: "si quiero cerrar el dia y confirmar la sabana, que me
// aparezca la ultima sabana en la pagina para confirmarla desde el
// sistema") — carga ESA sábana puntual en la pestaña "📋 Sábana" (mismo
// GET que ya usa la auto-carga, ver intentarCargarResumenWhatsappAutomatico)
// SIN mandar nada al grupo de WhatsApp, para que el Grupo la revise y
// apriete "💾 Guardar Día" desde acá mismo — sirve tanto para el día de
// HOY como para cualquier día reciente de la lista.
async function verYConfirmarSabanaWhatsapp(fecha) {
  try {
    const resp = await api('/api/whatsapp/dias/' + fecha + '/resumen');
    mostrarVista('sabana');
    document.getElementById('fechaPartidos').value = fecha;
    pintarResultadoSabana(resp, fecha);
  } catch (e) {
    alert('No se pudo cargar esa sábana para revisarla/confirmarla: ' + e.message);
  }
}

// =================================================================
// 4. SÁBANA: procesar + tablas + dashboard
// =================================================================
async function procesarYVerificar() {
  const texto = document.getElementById('sabanaInput').value;
  const fecha = document.getElementById('fechaPartidos').value;
  if (!texto.trim()) { alert('Pega la sábana de apuestas antes de continuar.'); return; }
  if (!fecha) { alert('Elige la fecha de los partidos.'); return; }

  const boton = event && event.target;
  const textoOriginalBoton = boton ? boton.textContent : null;
  if (boton) { boton.disabled = true; boton.textContent = 'Procesando...'; }

  try {
    const resp = await api('/api/sabana/procesar', { method: 'POST', body: JSON.stringify({ texto, fecha }) });
    pintarResultadoSabana(resp, fecha);
  } catch (e) {
    alert('No se pudo procesar la sábana: ' + e.message);
  } finally {
    if (boton) { boton.disabled = false; boton.textContent = textoOriginalBoton; }
  }
}

// Pinta en pantalla la respuesta de UNA sábana ya procesada (dashboard,
// Resumen por Cliente, tabla de resultados, Plano de WhatsApp, Pizarra en
// Vivo, estado de "Guardar Día") — extraído de procesarYVerificar()
// (04-09-2026) para que la auto-carga de la sábana automática de
// WhatsApp (ver intentarCargarResumenWhatsappAutomatico() más abajo)
// pinte EXACTAMENTE lo mismo con el mismo shape de respuesta
// (resumenPorCliente/tickets/totales/...), sin duplicar esta lógica.
function pintarResultadoSabana(resp, fecha) {
  renderDashboard(resp.totales, resp.tickets.length);

  // "Moneda del Grupo" (18-09-2026, mixto) — si el backend mandó
  // "porMoneda" (solo pasa cuando el grupo está en modo 'mixto', ver
  // agregarPorMonedaSiMixto() en routes/sabana.js), el Resumen por
  // Cliente se pinta en 2 tablas separadas (USD/Bs) en vez de la única de
  // siempre, para no mezclar las 2 monedas en los mismos totales — pero
  // reutilizando la MISMA renderTablaClientes() de siempre, dos veces,
  // solo que apuntando a un <tbody> distinto cada vez (ver
  // asegurarTablasResumenClientesMixto() más abajo). Si el grupo NO está
  // en modo mixto, resp.porMoneda no viene y este bloque no hace nada —
  // comportamiento 100% igual al de antes de este cambio.
  const tablaNormal = document.getElementById('tablaClientes');
  const wrapMixto = document.getElementById('resumenClientesMixtoWrap');
  if (resp.porMoneda) {
    asegurarTablasResumenClientesMixto();
    if (tablaNormal) tablaNormal.style.display = 'none';
    if (wrapMixto) wrapMixto.style.display = 'block';
    renderTablaClientes(resp.porMoneda.USD.filas, '#tablaClientesUSD tbody');
    renderTablaClientes(resp.porMoneda.BS.filas, '#tablaClientesBS tbody');
  } else {
    if (tablaNormal) tablaNormal.style.display = '';
    if (wrapMixto) wrapMixto.style.display = 'none';
    renderTablaClientes(resp.resumenPorCliente);
  }
  ULTIMOS_TICKETS = resp.tickets;
  renderTablaResultados(resp.tickets);
  ULTIMO_PLANO_WHATSAPP = construirPlanoDesdeRespuesta(resp);
  // Refresca Jugador en segundo plano por si se auto-registró un cliente nuevo.
  cargarJugadores();

  // Aviso EN PANTALLA, ahí mismo, si esta sábana generó alertas nuevas
  // (jugadas AMBIGUA (VARIOS DEPORTES) que el sistema no pudo resolver
  // solo) — ver procesarSabana.js. No hace falta esperar al refresco de
  // 25s del badge para enterarse de algo que acaba de pasar.
  const avisoEl = document.getElementById('avisoAlertasNuevas');
  if (resp.alertasNuevas > 0) {
    avisoEl.style.display = 'block';
    avisoEl.innerHTML = '⚠️ <strong>' + resp.alertasNuevas + ' jugada' + (resp.alertasNuevas === 1 ? '' : 's') +
      ' quedó marcada como <em>AMBIGUA (VARIOS DEPORTES)</em></strong> — el sistema no pudo determinar solo a qué deporte pertenece(n). ' +
      'Anda a la pestaña <strong>🔔 Alertas</strong> para verlas y resolverlas.';
  } else {
    avisoEl.style.display = 'none';
  }
  actualizarBadgeAlertas();

  // Arranca (o reinicia) la Pizarra en Vivo con los equipos de ESTA
  // sábana — ver sección "5B" más abajo.
  ULTIMA_FECHA_PROCESADA = fecha;
  EQUIPOS_RELEVANTES_HOY = new Set();
  resp.tickets.forEach(t => (t.debug || []).forEach(d => { if (d.equipoOficial) EQUIPOS_RELEVANTES_HOY.add(d.equipoOficial); }));
  actualizarPizarraEnVivo();

  // "Guardar Día" (31-08-2026): cada reproceso deja la fecha SIN
  // confirmar (ver comentario en procesarSabana.js) — mostramos el
  // badge/botón de una vez con lo que ya sabemos, sin otro round-trip.
  renderEstadoDia({ fecha, confirmado: resp.diaConfirmado, confirmadoEn: null });
}

// =================================================================
// AUTO-CARGA de "Resumen por Cliente" desde la sábana automática de
// WhatsApp (04-09-2026, a pedido del usuario: "cuando este habilitada la
// opcion de sabana automatica, se debe cargar en resumen por cliente las
// jugadas y los saldos de como van en el dia como si se cargara la
// sabana manual"). Se llama junto con el resto de las notificaciones de
// fondo (cada 25s, ver revisarNotificacionesFondo) — GET
// /api/whatsapp/dias/:fecha/resumen devuelve EXACTAMENTE el mismo shape
// que POST /api/sabana/procesar, así que se pinta con la MISMA función
// (pintarResultadoSabana) de arriba, sin inventar ningún renderizado
// nuevo.
// =================================================================
let WHATSAPP_AUTOCARGA_ULTIMA_FECHA = null;
let WHATSAPP_AUTOCARGA_EN_CURSO = false;

async function intentarCargarResumenWhatsappAutomatico(estadoWhatsapp) {
  if (!estadoWhatsapp || !estadoWhatsapp.habilitado || !estadoWhatsapp.grupoVinculado) return;
  // (04-09-2026, a pedido del usuario: "la pagina se queda un poco
  // pegada... se tarda un poco en cargar los valores") — esto reprocesa
  // la sábana entera (5 APIs de resultados en vivo EN PARALELO + redibuja
  // varias tablas) y antes corría cada 25s SIN IMPORTAR qué pestaña
  // estuviera mirando el Grupo — compitiendo de fondo con Balance
  // General, Comisión, etc. Ahora se salta solo si no está en "📋
  // Sábana", mismo criterio que ya usa la Pizarra en Vivo (ver
  // mostrarVista()).
  if (VISTA_ACTUAL !== 'sabana') return;
  if (WHATSAPP_AUTOCARGA_EN_CURSO) return; // nunca 2 pedidos pisándose si el ciclo de 25s se solapa
  const fecha = hoyISO();

  // Nunca le pisa a mano al Grupo una fecha DISTINTA que ya esté mirando
  // (ej. revisando/editando un día viejo desde este mismo formulario) —
  // solo autocarga mientras el campo de fecha sigue en blanco o en "hoy",
  // que es como arranca la pestaña.
  const fechaEnPantalla = document.getElementById('fechaPartidos').value;
  if (fechaEnPantalla && fechaEnPantalla !== fecha) return;

  WHATSAPP_AUTOCARGA_EN_CURSO = true;
  try {
    const resp = await api('/api/whatsapp/dias/' + fecha + '/resumen');
    document.getElementById('fechaPartidos').value = fecha;
    pintarResultadoSabana(resp, fecha);
    WHATSAPP_AUTOCARGA_ULTIMA_FECHA = fecha;
  } catch (e) {
    // Sin sábana todavía hoy (404) es el estado normal antes de que
    // llegue el primer mensaje "SABANA DE JUGADAS" del día — no es un
    // error, así que no interrumpe al Grupo con ningún alert() de fondo.
    // Cualquier otro problema real ya se ve reflejado en el panel de
    // WhatsApp de arriba (estado de conexión / actividad reciente).
  } finally {
    WHATSAPP_AUTOCARGA_EN_CURSO = false;
  }
}

// =================================================================
// "GUARDAR DÍA" (31-08-2026, a pedido del usuario) — ver comentarios en
// historial.js (confirmarDia/desconfirmarDia/estadoDia) y sabana.js
// (rutas /confirmar-dia y /estado-dia) para el detalle del porqué.
// =================================================================

// Se dispara al elegir una fecha en el input de arriba (antes incluso de
// procesar) — así, si el usuario vuelve a esa fecha otro día, ve de una
// si esa sábana ya estaba confirmada o no, sin tener que reprocesar solo
// para averiguarlo.
async function cargarEstadoDiaParaFecha() {
  const fecha = document.getElementById('fechaPartidos').value;
  if (!fecha) { document.getElementById('estadoDiaBox').style.display = 'none'; return; }
  try {
    const estado = await api('/api/sabana/estado-dia?fecha=' + fecha);
    renderEstadoDia(estado);
  } catch (e) {
    // Silencioso: no bloquea el flujo de trabajo si esto falla, el usuario
    // igual puede procesar y guardar el día normalmente.
  }
}

function renderEstadoDia(estado) {
  const box = document.getElementById('estadoDiaBox');
  const badge = document.getElementById('estadoDiaBadge');
  box.style.display = 'flex';
  // "Día confirmado" ya mostraba la fecha correcta guardada en la base de
  // datos (`estado.fecha` SIEMPRE es la fecha de los partidos que elegiste
  // arriba, nunca la de hoy) — lo que faltaba era mostrarla en el badge.
  // Antes solo se veía la hora del CLIC de "Guardar Día" (ej. "2/9/2026,
  // 13:57:12"), y si confirmabas hoy una sábana de un día anterior, esa
  // hora de hoy se podía confundir con "se guardó como el día de hoy" —
  // corregido 03-09-2026 mostrando ambas cosas por separado y bien claras.
  const fechaSabana = estado.fecha ? formatFechaDDMMYYYY(estado.fecha) : '';
  if (estado.confirmado) {
    const hora = estado.confirmadoEn ? new Date(estado.confirmadoEn).toLocaleString() : '';
    badge.innerHTML = '<span class="badge-diaconfirmado">✅ Sábana del ' + fechaSabana + ': confirmada' +
      (hora ? ' <span style="font-weight:normal; opacity:0.85;">(guardada el ' + hora + ')</span>' : '') + '</span>';
  } else {
    badge.innerHTML = '<span class="badge-diasinconfirmar">⚠️ Sábana del ' + fechaSabana + ': sin confirmar</span>';
  }
}

// Se llama al presionar "💾 Guardar Día": marca la versión que se está
// viendo AHORA (la última que se procesó) como la sábana oficial de esa
// fecha. Si se vuelve a reprocesar esa fecha después, queda "sin
// confirmar" de nuevo automáticamente (ver guardarEnHistorial en
// historial.js) y hay que volver a presionar este botón.
async function guardarDia() {
  const fecha = ULTIMA_FECHA_PROCESADA || document.getElementById('fechaPartidos').value;
  if (!fecha) { alert('Primero procesa una sábana (o elige una fecha) antes de guardar el día.'); return; }
  const boton = document.getElementById('btnGuardarDia');
  const textoOriginal = boton.textContent;
  boton.disabled = true; boton.textContent = 'Guardando...';
  try {
    const estado = await api('/api/sabana/confirmar-dia', { method: 'POST', body: JSON.stringify({ fecha }) });
    renderEstadoDia(estado);
  } catch (e) {
    alert('No se pudo guardar el día: ' + e.message);
  } finally {
    boton.disabled = false; boton.textContent = textoOriginal;
  }
}

function renderDashboard(totales, totalJugadas) {
  // "Total de Jugadas del Día" = cantidad de tickets que trajo la sábana
  // procesada (no la suma de patas/parleys dentro de cada uno) — el mismo
  // conteo que después se ve fila por fila en la tabla de Resultados.
  document.getElementById('totalJugadasDia').textContent = totalJugadas;
  document.getElementById('totalArriesgado').textContent = formatMoney(totales.totalArriesgado);
  document.getElementById('totalPerdido').textContent = formatMoney(totales.totalPerdido);
  document.getElementById('totalPremios').textContent = formatMoney(totales.totalPremios);
  document.getElementById('totalDevoluciones').textContent = formatMoney(totales.totalDevoluciones);
  // "Balance Neto Casa" (corregido 03-09-2026, a pedido del usuario): ya
  // viene combinado con la Polla del día desde el backend cuando esa
  // fecha la tiene registrada (ver totalBalanceCasa en procesarSabana.js)
  // — antes este número era SOLO de la sábana y la Polla quedaba nada más
  // en su propia tarjeta, sin influir acá.
  document.getElementById('totalBalance').textContent = formatMoney(totales.totalBalanceCasa);
  const notaPolla = document.getElementById('totalBalanceNotaPolla');
  if (notaPolla) notaPolla.style.display = totales.pollaRegistrada ? '' : 'none';

  // "Banca Polla" (02-09-2026, ampliado 03-09-2026): la tarjeta de detalle
  // sigue apareciendo APARTE (para saber cuánto dio la Polla sola), pero
  // ahora se muestra u oculta según "pollaRegistrada" — true solo si esta
  // fecha puntual tiene filas de Polla cargadas en el sistema, sin importar
  // si el neto dio $0. Cada grupo juega su Polla un día fijo distinto (el
  // usuario juega la suya los martes); el día que NO se registra Polla
  // (ej. miércoles) esta tarjeta y las columnas de detalle del Resumen por
  // Cliente no deben aparecer — ver POLLA_REGISTRADA_HOY / renderTablaClientes.
  //
  // Red de seguridad (03-09-2026, más tarde todavía — a raíz de un reporte
  // del usuario de que dejó de ver la Polla POR COMPLETO, incluso en un día
  // que SÍ la había registrado): si por lo que sea el backend responde sin
  // el campo "pollaRegistrada" (ej. servidor viejo corriendo, todavía sin
  // reiniciar después de reemplazar los archivos del zip — un refresh del
  // navegador NO reinicia el proceso de Node), no hay que asumir "false" a
  // ciegas y esconder todo — se cae al criterio viejo (¿el monto neto de
  // Polla es distinto de $0?) para que al menos algo se siga viendo en vez
  // de un apagón total.
  POLLA_REGISTRADA_HOY = totales.pollaRegistrada !== undefined
    ? !!totales.pollaRegistrada
    : (Math.abs(totales.totalPolla || 0) > 0.001 || Math.abs(totales.totalBancaPolla || 0) > 0.001);
  const cardPolla = document.getElementById('cardBancaPolla');
  if (cardPolla) {
    cardPolla.style.display = POLLA_REGISTRADA_HOY ? '' : 'none';
    if (POLLA_REGISTRADA_HOY) document.getElementById('totalBancaPolla').textContent = formatMoney(totales.totalBancaPolla);
  }
}

function tokenClientePorNombre(nombre) {
  const j = JUGADORES_CACHE.find(x => x.nombre === nombre);
  return j ? j.token : null;
}

async function copiarLinkClientePorNombre(nombre) {
  const token = tokenClientePorNombre(nombre);
  if (!token) {
    alert('"' + nombre + '" todavía no está registrado en Administración > Jugador (o el registro no tiene link). Procesa una sábana o créalo a mano para generar su link.');
    return;
  }
  const link = location.origin + '/cliente.html?token=' + token;
  copiarTextoAlPortapapeles(link, 'Link de ' + nombre + ' copiado.');
}

// `tbodySelector` (18-09-2026, "moneda del grupo" mixto) — por defecto
// pinta en la tabla de siempre (#tablaClientes), pero se puede apuntar a
// otro <tbody> (ej. "#tablaClientesUSD tbody") para reutilizar esta
// misma función 2 veces cuando el grupo está en modo mixto, en vez de
// duplicar toda esta lógica de pintado — ver pintarResultadoSabana() y
// asegurarTablasResumenClientesMixto() más abajo.
function renderTablaClientes(resumenPorCliente, tbodySelector) {
  const tbody = document.querySelector(tbodySelector || '#tablaClientes tbody');
  tbody.innerHTML = '';
  resumenPorCliente.forEach(c => {
    const tr = document.createElement('tr');
    // "Total Día (con % y Polla)" (agregado 28-08-2026, ampliado
    // 02-09-2026 a pedido del usuario): el resultado del cliente en el día
    // sumando su comisión (propia + de avalados) Y su Polla, si jugó —
    // c.balance acá es puro resultado de apuestas de la sábana (ganado -
    // perdido, sin comisión ni Polla, ver procesarSabana.js). Se muestra
    // si el cliente jugó sábana O Polla ese día (antes solo miraba
    // c.jugoHoy) — un cliente que SOLO juega Polla ahora también ve su
    // total acá en vez de quedarse en "—".
    const tieneActividad = c.jugoHoy || c.jugoPolla;
    const totalDia = c.balance + c.comisionTotal + (c.polla || 0);
    const totalDiaHTML = tieneActividad
      ? '<span class="' + (totalDia >= 0 ? 'ganada' : 'perdida') + '">' + formatMoney(totalDia) + '</span>'
      : '<span style="color:#999;">—</span>';
    const pollaHTML = c.jugoPolla
      ? '<span class="' + ((c.polla || 0) >= 0 ? 'ganada' : 'perdida') + '">' + formatMoney(c.polla) + '</span>'
      : '<span style="color:#999;">—</span>';
    tr.innerHTML =
      '<td>' + c.cliente + '</td>' +
      '<td class="col-r-arriesgado">' + formatMoney(c.arriesgado) + '</td>' +
      '<td class="col-r-ganado">' + formatMoney(c.ganado) + '</td>' +
      '<td class="col-r-perdido">' + formatMoney(c.perdido) + '</td>' +
      '<td class="col-r-balance ' + (c.balance >= 0 ? 'ganada' : 'perdida') + '">' + formatMoney(c.balance) + '</td>' +
      // (08-09-2026) c.porcentajePropio viene null cuando el grupo usa el
      // modelo 'por_tipo_jugada' (ver la nota grande en comisiones.js) —
      // ahí no hay un solo % que mostrar porque cada ticket pudo usar uno
      // distinto según cuántos logros tenía, así que se avisa con una
      // etiqueta en vez de mostrar engañosamente "0%".
      '<td class="col-r-porcentaje">' + (c.porcentajePropio === null || c.porcentajePropio === undefined ? '<span title="Este grupo cobra % distinto según el tipo de jugada (directas, parleys...)">Por tipo de jugada</span>' : c.porcentajePropio + '%') + '</td>' +
      '<td class="col-r-comisionpropia">' + formatMoney(c.comisionPropia) + '</td>' +
      '<td class="col-r-comisionaval">' + formatMoney(c.comisionAval) + '</td>' +
      '<td class="col-r-polla">' + pollaHTML + '</td>' +
      '<td class="col-r-totaldia">' + totalDiaHTML + '</td>' +
      '<td class="col-r-pendientes">' + c.pendientes + '</td>' +
      '<td class="col-r-link"><button type="button" class="btn-chico btn-secundario" onclick="copiarLinkClientePorNombre(\'' + c.cliente.replace(/'/g, "\\'") + '\')">🔗</button></td>';
    tbody.appendChild(tr);
  });
  aplicarVisibilidadColumnasResumen();
}

// =================================================================
// COLUMNAS OCULTABLES de "Resumen por Cliente" (28-08-2026) — mismo patrón
// ya usado en Balance General (ver COLUMNAS_BALANCE/actualizarColumnasBalance
// más abajo), a pedido del usuario para poder mandar/ver solo lo que
// necesite (ej. solo Cliente + Total Día con %).
// =================================================================
const COLUMNAS_RESUMEN = [
  ['rcColArriesgado', 'col-r-arriesgado'],
  ['rcColGanado', 'col-r-ganado'],
  ['rcColPerdido', 'col-r-perdido'],
  ['rcColBalance', 'col-r-balance'],
  ['rcColPorcentaje', 'col-r-porcentaje'],
  ['rcColComisionPropia', 'col-r-comisionpropia'],
  ['rcColComisionAval', 'col-r-comisionaval'],
  ['rcColPolla', 'col-r-polla'],
  ['rcColTotalDia', 'col-r-totaldia'],
  ['rcColPendientes', 'col-r-pendientes'],
  ['rcColLink', 'col-r-link']
];

// "Polla" y "Total Día (con % y Polla)" (03-09-2026, a pedido del usuario):
// estas 2 columnas dependen de que la fecha procesada tenga Polla
// registrada — si no la tiene, se ocultan por completo (celda Y checkbox
// de "Mostrar/ocultar columnas"), sin importar si el usuario las había
// dejado marcadas la última vez. Cada grupo juega su Polla un día fijo
// distinto (ver POLLA_REGISTRADA_HOY más arriba), así que esto nunca
// asume un día de la semana — sale del backend, fecha por fecha.
const COLUMNAS_SOLO_CON_POLLA = ['rcColPolla', 'rcColTotalDia'];

function actualizarColumnasResumen() {
  const estado = {};
  COLUMNAS_RESUMEN.forEach(([checkboxId]) => { estado[checkboxId] = document.getElementById(checkboxId).checked; });
  localStorage.setItem('zenyatta_resumen_columnas', JSON.stringify(estado));
  aplicarVisibilidadColumnasResumen();
}

function cargarColumnasResumenGuardadas() {
  let estado = {};
  try { estado = JSON.parse(localStorage.getItem('zenyatta_resumen_columnas') || '{}'); } catch (e) { estado = {}; }
  COLUMNAS_RESUMEN.forEach(([checkboxId]) => {
    const cb = document.getElementById(checkboxId);
    if (cb && Object.prototype.hasOwnProperty.call(estado, checkboxId)) cb.checked = estado[checkboxId];
  });
  aplicarVisibilidadColumnasResumen();
}

function aplicarVisibilidadColumnasResumen() {
  COLUMNAS_RESUMEN.forEach(([checkboxId, claseColumna]) => {
    const checkbox = document.getElementById(checkboxId);
    const marcado = checkbox ? checkbox.checked : true;
    const esColumnaDePolla = COLUMNAS_SOLO_CON_POLLA.includes(checkboxId);
    // Las columnas de Polla, además de la preferencia del checkbox, exigen
    // que esta fecha tenga Polla registrada (ver COLUMNAS_SOLO_CON_POLLA).
    const visible = esColumnaDePolla ? (POLLA_REGISTRADA_HOY && marcado) : marcado;
    // Selector generalizado (18-09-2026, "moneda del grupo" mixto): antes
    // apuntaba solo a "#tablaClientes .clase"; ahora apunta a la clase
    // compartida ".tabla-resumen-cliente" para que la misma preferencia
    // de columnas afecte por igual a la tabla única (grupo NO mixto) y a
    // las 2 tablas USD/Bs (grupo mixto, ver asegurarTablasResumenClientesMixto()
    // más abajo) — sin este cambio, las columnas de las 2 tablas nuevas
    // nunca se hubieran ocultado/mostrado con este mismo checklist.
    document.querySelectorAll('.tabla-resumen-cliente .' + claseColumna).forEach(el => {
      el.style.display = visible ? '' : 'none';
    });
    if (esColumnaDePolla && checkbox) {
      // El checkbox de "mostrar esta columna" no tiene sentido un día sin
      // Polla — se oculta junto con la columna para no confundir.
      const etiqueta = checkbox.closest('label');
      if (etiqueta) etiqueta.style.display = POLLA_REGISTRADA_HOY ? '' : 'none';
    }
  });
}

// Construye, UNA sola vez, las 2 tablas "Resumen por Cliente" (USD/Bs)
// que se usan cuando el grupo está en modo 'mixto' — clonando el
// encabezado de #tablaClientes (mismas columnas, mismas clases
// col-r-*) para no repetir esa fila de <th> a mano acá. Se marca con
// "data-armado" para no reconstruirlas de nuevo cada vez que se procesa
// otra sábana en la misma sesión (ver pintarResultadoSabana() más
// arriba).
function asegurarTablasResumenClientesMixto() {
  const cont = document.getElementById('resumenClientesMixtoWrap');
  if (!cont || cont.dataset.armado) return;
  const filaEncabezado = document.querySelector('#tablaClientes thead tr').innerHTML;
  const bloque = (sufijo, titulo) =>
    '<h3 style="margin:18px 0 8px; color:var(--accent-cyan);">' + titulo + '</h3>' +
    '<table id="tablaClientes' + sufijo + '" class="tabla-resumen-cliente"><thead><tr>' + filaEncabezado + '</tr></thead><tbody></tbody></table>';
  cont.innerHTML = bloque('USD', '🇺🇸 Dólares (USD)') + bloque('BS', '🇻🇪 Bolívares (Bs)');
  cont.dataset.armado = '1';
}

const CLASE_ESTADO = {
  'GANADA': 'ganada',
  'PERDIDA': 'perdida',
  'ANULADA': 'anulada',
  'PENDIENTE': 'pendiente',
  'FALTA CERRAR EN SÁBANA': 'sinresultado',
  'NULA (FALTA LOGRO)': 'faltalogro',
  // "NULA (SIN JUGADA)" (05-09-2026): mismo color/estilo que "NULA (FALTA
  // LOGRO)" a propósito — las 2 son "este ticket necesita que revises la
  // sábana", solo que por un motivo distinto (acá directamente no hay
  // ninguna jugada asociada al arriesgo). Ver la nota grande en
  // procesarSabana.js.
  'NULA (SIN JUGADA)': 'faltalogro',
  'SUSPENDIDA': 'suspendida',
  'AMBIGUA (VARIOS DEPORTES)': 'ambigua'
};

function renderTablaResultados(tickets) {
  const tbody = document.querySelector('#tablaResultados tbody');
  tbody.innerHTML = '';

  tickets.forEach((t, idx) => {
    const jugadasHTML = t.jugadas.map((j, i) => {
      const info = (t.debug && t.debug[i]) || {};
      return '<div class="fila-jugada">' + logoEquipoHTML(info.equipoOficial, info.logoUrl) + '<span>' + j + '</span></div>';
    }).join('');

    const cuota = t.arriesga > 0 ? (t.paga / t.arriesga).toFixed(2) : '-';

    let notaPago = '';
    if (t.esPagoEstimado) notaPago = '<span class="nota-pago">estimado (sábana no traía pago)</span>';
    if (t.pagaConDiscrepancia) notaPago = '<span class="nota-discrepancia">⚠ sábana decía ' + formatMoney(t.pagaSabanaOriginal) + '</span>';
    if (t.cierreAutomatico) notaPago += '<span class="nota-pago">🔒 cierre automático</span>';

    // Marcador manual (✅/❌/⭕) corregido (03-09-2026): si alguien ya
    // había marcado a mano el ticket en la sábana y ese marcador no
    // coincidía con el resultado real verificado contra la API, se avisa
    // acá al lado del Estado — mismo criterio que la nota de "sábana
    // decía $X" para el pago.
    let notaEstado = '';
    if (t.marcadorManualIncorrecto) {
      notaEstado = '<br><span class="nota-discrepancia">⚠ sábana lo tenía marcado ' + t.marcadorManualOriginal + ', se corrigió</span>';
    }

    const claseEstado = CLASE_ESTADO[t.estado] || '';
    const tr = document.createElement('tr');
    // La app original pinta la FILA ENTERA (no solo la celda de estado) —
    // así se ve de un vistazo cuáles tickets ganaron/perdieron sin tener
    // que leer la columna de Estado una por una.
    tr.className = claseEstado;
    // data-label en cada <td> (15-09-2026): en PC no se usa para nada (la
    // tabla se ve normal, con su thead) — es solo lo que lee el CSS
    // ":before" en celular (ver @media max-width:760px en index.html) para
    // dibujar la tarjeta "Etiqueta: valor" sin tener que duplicar el
    // armado de esta fila en JS aparte para mobile.
    tr.innerHTML =
      '<td data-label="Cliente">' + t.cliente + '</td>' +
      '<td data-label="Ticket">' + t.ticket + '</td>' +
      '<td data-label="Jugada(s)">' + jugadasHTML + '</td>' +
      '<td data-label="Arriesga">' + formatMoney(t.arriesga) + '</td>' +
      '<td data-label="Gana (neto)">' + formatMoney(t.paga) + notaPago + '</td>' +
      '<td data-label="Cuota Calc.">' + cuota + '</td>' +
      '<td class="' + claseEstado + '" data-label="Estado Auto">' + t.estado + notaEstado + '</td>' +
      '<td data-label="Debug"><button type="button" class="btn-debug" onclick="toggleDebug(' + idx + ')">🔍 Ver</button></td>';
    tbody.appendChild(tr);

    const trDebug = document.createElement('tr');
    trDebug.className = 'fila-debug';
    trDebug.id = 'debug-' + idx;
    trDebug.style.display = 'none';
    const items = (t.debug || []).map(d =>
      '<li><strong>' + (d.pataOriginal || d.pata || '') + '</strong> → ' + (d.resultado || '') +
      (d.razon ? ' (' + d.razon + ')' : '') +
      (d.tipoApuesta ? ' — ' + d.tipoApuesta : '') +
      (d.marcadorUsado ? ' — ' + d.marcadorUsado : '') + '</li>'
    ).join('');
    trDebug.innerHTML = '<td colspan="8"><ul>' + (items || '<li>Sin datos de depuración.</li>') + '</ul></td>';
    tbody.appendChild(trDebug);
  });
}

function toggleDebug(idx) {
  const fila = document.getElementById('debug-' + idx);
  if (fila) fila.style.display = fila.style.display === 'none' ? 'table-row' : 'none';
}

// =================================================================
// 5. PLANO PARA WHATSAPP (ported 1 a 1 de la app original — ver app.js
// sección 6B — solo cambia de dónde sale ULTIMO_PLANO_WHATSAPP).
// =================================================================
function construirPlanoDesdeRespuesta(resp) {
  const gruposMap = new Map(); // preserva el orden de aparición, igual que la sábana pegada
  resp.tickets.forEach(t => {
    if (!gruposMap.has(t.cliente)) gruposMap.set(t.cliente, { cliente: t.cliente, boletos: [] });
    gruposMap.get(t.cliente).boletos.push({
      ticket: t.ticket,
      jugadas: t.jugadas,
      arriesga: t.arriesga,
      pagaMostrado: t.paga,
      estadoFinal: t.estado
    });
  });
  return {
    fecha: resp.fecha,
    grupos: Array.from(gruposMap.values()),
    totalesClientes: resp.planoWhatsApp.totalesClientes,
    // "TOTAL BANCA" (corregido 03-09-2026): ya viene combinado con la
    // Polla del día cuando corresponde (ver procesarSabana.js) — antes
    // era solo de la sábana y la Polla se imprimía nada más como línea
    // aparte, sin sumarse al total.
    totalBanca: resp.planoWhatsApp.totalBanca,
    totalBancaPolla: resp.planoWhatsApp.totalBancaPolla,
    // Misma red de seguridad que en renderDashboard(): si el backend no
    // manda "pollaRegistrada" (servidor viejo sin reiniciar), cae al
    // criterio del monto neto en vez de esconder la línea "BANCA POLLA" sin
    // motivo real.
    pollaRegistrada: resp.planoWhatsApp.pollaRegistrada !== undefined
      ? !!resp.planoWhatsApp.pollaRegistrada
      : Math.abs(resp.planoWhatsApp.totalBancaPolla || 0) > 0.001
  };
}

function formatMontoPlano(numero) {
  const redondeado = Math.round(numero * 100) / 100;
  return redondeado % 1 === 0 ? String(redondeado) : String(redondeado.toFixed(2)).replace(/0$/, '');
}

function formatDineroPlano(numero) {
  const redondeado = Math.round(numero * 100) / 100;
  const signo = redondeado < 0 ? '-' : '+';
  return signo + Math.abs(redondeado).toFixed(2) + '$';
}

function formatLineaResultadoPlano(arriesga, pagaMostrado, estadoFinal) {
  const arr = formatMontoPlano(arriesga);
  if (estadoFinal === 'GANADA') return arr + '//' + formatMontoPlano(pagaMostrado) + '✅';
  if (estadoFinal === 'PERDIDA') return '❌' + arr + '//' + formatMontoPlano(pagaMostrado);
  if (estadoFinal === 'ANULADA' || estadoFinal === 'SUSPENDIDA') return '⭕' + arr + '//';
  return arr + '//';
}

function generarPlanoWhatsApp() {
  if (!ULTIMO_PLANO_WHATSAPP || !ULTIMO_PLANO_WHATSAPP.grupos || ULTIMO_PLANO_WHATSAPP.grupos.length === 0) {
    alert('Primero presiona "Procesar Sábana y Validar APIs" para poder generar el plano.');
    return;
  }

  const partes = [];
  // OJO (04-09-2026, a pedido del usuario: "dice arriba deportes zenyatta
  // y debe decir es como se llama el grupo"): antes esto era un texto fijo
  // ("DEPORTES ZENYATTA", el nombre del ÚNICO negocio para el que se armó
  // la app original) — ahora que cada Grupo es un cliente distinto de la
  // plataforma, el encabezado del Plano usa el nombre real de ESE Grupo
  // (GRUPO.nombre, el mismo que se ve arriba en "Conectado como: ..."),
  // con el nombre viejo como respaldo solo si por algún motivo GRUPO
  // todavía no se cargó.
  partes.push('*' + ((GRUPO && GRUPO.nombre) || 'Ludox Venezuela 🇻🇪') + '*');
  partes.push('🏀⚽🏈⚾');
  if (ULTIMO_PLANO_WHATSAPP.fecha) {
    const [anio, mes, dia] = ULTIMO_PLANO_WHATSAPP.fecha.split('-');
    if (anio && mes && dia) partes.push(dia + '-' + mes + '-' + anio);
  }
  partes.push('');

  ULTIMO_PLANO_WHATSAPP.grupos.forEach(grupo => {
    partes.push('*' + grupo.cliente + '*');
    grupo.boletos.forEach(b => {
      partes.push(b.ticket.replace(/^Ticket #/, 'Ticket '));
      b.jugadas.forEach(j => partes.push(j));
      partes.push(formatLineaResultadoPlano(b.arriesga, b.pagaMostrado, b.estadoFinal));
      partes.push('');
    });
  });

  if (ULTIMO_PLANO_WHATSAPP.totalesClientes && ULTIMO_PLANO_WHATSAPP.totalesClientes.length > 0) {
    partes.push('*TOTALES DEL DÍA*');
    partes.push('');
    ULTIMO_PLANO_WHATSAPP.totalesClientes.forEach(c => {
      // Bug corregido (28-08-2026): c.totalBanca viene en convención CASA
      // y YA tiene la comisión (c.devolucion) restada adentro (ver
      // procesarSabana.js: totalBanca = perdido - ganado - comisionTotal)
      // — así que "-c.totalBanca - c.devolucion" da el resultado de las
      // apuestas SOLO (ganado - perdido, sin comisión). La línea "*%
      // NOMBRE*" de abajo sigue mostrando la comisión aparte (no se tocó:
      // el usuario no pidió mezclarla, y hacerlo reintroduciría el
      // doble-conteo si alguien suma las 2 líneas a mano — bug del
      // 28-08-2026).
      //
      // "Total del día" con Polla incluida (03-09-2026, más tarde todavía,
      // a pedido del usuario: *"estan separado los totales... hazlo como
      // total del dia con polla incluida, restas al balance o sumas
      // dependiendo de como quede la polla"*): antes esta sección imprimía
      // la línea del cliente (solo sábana) y, si jugó Polla, una línea
      // APARTE "🎲 POLLA <cliente>" — el usuario pidió UNA sola línea con
      // el resultado ya combinado. Se muestra si el cliente jugó sábana O
      // Polla ese día (antes la línea principal solo miraba c.jugoHoy, así
      // que un cliente que SOLO juega Polla —ej. SOLOPOLLA— no tenía línea
      // propia, nada más la de "POLLA <cliente>" que ahora desapareció).
      const resultadoSabana = -c.totalBanca - c.devolucion;
      const totalDiaCliente = resultadoSabana + (c.polla || 0);
      if (c.jugoHoy || c.jugoPolla) {
        partes.push(' *' + c.cliente + '* ');
        partes.push(formatDineroPlano(totalDiaCliente));
      }
      if (Math.abs(c.devolucion) > 0.001) {
        partes.push('*% ' + c.cliente + '*');
        partes.push('+' + Math.abs(Math.round(c.devolucion * 100) / 100).toFixed(2) + '$');
      }
    });
    partes.push('');
    partes.push(' *TOTAL BANCA* ');
    // Ya viene combinado con la Polla del día si esta fecha la tiene
    // registrada (ver construirPlanoDesdeRespuesta / procesarSabana.js).
    partes.push(formatDineroPlano(ULTIMO_PLANO_WHATSAPP.totalBanca));
    // La línea de detalle "BANCA POLLA" solo se imprime los días que el
    // grupo SÍ registró Polla (03-09-2026, a pedido del usuario) — antes
    // se decidía mirando si el neto era != 0, lo que la escondía por error
    // si la Polla se jugó pero cerró en $0 exacto.
    if (ULTIMO_PLANO_WHATSAPP.pollaRegistrada) {
      partes.push(' *🎲 BANCA POLLA* ');
      partes.push(formatDineroPlano(ULTIMO_PLANO_WHATSAPP.totalBancaPolla));
    }
  }

  const texto = partes.join('\n').replace(/\n+$/, '');
  const caja = document.getElementById('planoWhatsAppTexto');
  if (caja) caja.value = texto;
}

function copiarTextoAlPortapapeles(texto, mensajeExito) {
  const hacerFallback = () => {
    const temp = document.createElement('textarea');
    temp.value = texto;
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    try { document.execCommand('copy'); alert(mensajeExito); }
    catch (e) { alert('No se pudo copiar automáticamente. Cópialo a mano:\n\n' + texto); }
    document.body.removeChild(temp);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(() => alert(mensajeExito)).catch(hacerFallback);
  } else {
    hacerFallback();
  }
}

// "📋 Copiar detalle del error" (16-09-2026, a pedido del usuario tras
// reportar que el "not-acceptable" seguía igual después del arreglo del
// caché de metadata de grupo: "hay una forma de yo ver el error en otro
// lado y pasartelo para que se pueda corregir") — arma un texto con TODO
// lo que el servidor pudo sacarle al error real (no solo "not-acceptable"
// a secas, ver extraerDetalleError() en whatsappBot.js) para que se
// pueda pegar directo en el chat con Claude y seguir investigando con el
// error real en la mano, sin tener que entrar a los logs de Railway.
function copiarDetalleErrorEnvioWhatsapp() {
  const err = ULTIMO_ERROR_ENVIO_WHATSAPP;
  if (!err) { alert('No hay ningún error de envío guardado ahora mismo.'); return; }
  const partes = [
    'Error al mandar por WhatsApp (Ludox)',
    'Cuándo: ' + (err.en || '(sin fecha)'),
    'Grupo (jid): ' + (err.jid || '(desconocido)'),
    'Mensaje: ' + (err.mensaje || '(sin mensaje)')
  ];
  if (err.detalle) partes.push('Detalle técnico: ' + JSON.stringify(err.detalle, null, 2));
  copiarTextoAlPortapapeles(partes.join('\n'), '¡Copiado! Ya lo puedes pegar en el chat con Claude.');
}

// "Diagnosticar quién traba el envío" (16-09-2026, a partir del detalle
// real de "not-acceptable" que el usuario copió y pasó: assertSessions()
// de Baileys junta a TODOS los participantes del grupo en un solo pedido —
// si UNO SOLO falla, el envío ENTERO se cae para todo el grupo). Prueba la
// sesión de cada participante uno por uno (POST
// /api/whatsapp/diagnosticar-sesiones) para señalar cuál(es) número(s) son
// el problema — ver whatsappBot.diagnosticarSesionesGrupo(). Puede tardar
// unos segundos en grupos grandes (un pedido a WhatsApp por participante).
async function diagnosticarSesionesGrupoWhatsapp() {
  const caja = document.getElementById('whatsappDiagnosticoSesionesTexto');
  if (!caja) return;
  caja.textContent = '⏳ Revisando la sesión de cada participante del grupo, uno por uno... puede tardar unos segundos.';
  try {
    const r = await api('/api/whatsapp/diagnosticar-sesiones', { method: 'POST' });
    if (!r.conProblema || r.conProblema.length === 0) {
      caja.innerHTML = '✅ Se probó la sesión de los ' + r.revisados + ' participantes del grupo ("' + escapeHtml(r.grupoNombre || '') + '") uno por uno y ninguno dio problema individual. El "not-acceptable" podría estar pasando por otro motivo (por ejemplo, con muchos participantes a la vez) — copiá el detalle del error de arriba y pasámelo junto con este resultado.';
    } else {
      const lista = r.conProblema.map(p => '<li>+' + escapeHtml(p.numero || p.jid) + ' — ' + escapeHtml(p.mensaje) + '</li>').join('');
      caja.innerHTML = '⚠️ De ' + r.revisados + ' participantes revisados en "' + escapeHtml(r.grupoNombre || '') + '", estos ' + r.conProblema.length + ' número(s) no dejan armar una sesión cifrada (probablemente se borraron de WhatsApp o bloquearon este número) — mientras sigan en el grupo, el envío automático se va a seguir cayendo para TODOS:<ul style="margin:6px 0 0 18px; padding:0;">' + lista + '</ul>Revisá si siguen en WhatsApp y, si no, sacalos del grupo.';
    }
  } catch (e) {
    caja.textContent = '⚠️ No se pudo diagnosticar: ' + e.message;
  }
}

function copiarPlanoWhatsApp() {
  const caja = document.getElementById('planoWhatsAppTexto');
  if (!caja || !caja.value.trim()) {
    alert('Primero genera el plano con el botón "📲 Generar Plano WhatsApp".');
    return;
  }
  copiarTextoAlPortapapeles(caja.value, '¡Plano copiado! Ya lo puedes pegar en WhatsApp.');
}

// =================================================================
// 5B. PIZARRA EN VIVO (solo datos, sin video) — carreras, entrada, outs,
// bolas/strikes y corredores en base de los juegos de MLB que tocan las
// jugadas de la última sábana procesada. mlbApi.js (backend) ya trae todo
// el detalle en vivo; acá solo se filtra a los equipos relevantes y se
// dibuja. Se auto-refresca cada 20s mientras algún juego relevante siga
// sin terminar, y se detiene solo cuando todos terminan.
// =================================================================
function formatHoraLocal(isoUTC) {
  if (!isoUTC) return '';
  try {
    return new Date(isoUTC).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

// Cada deporte tiene su propia forma de tarjeta (MLB muestra outs/bases/
// bolas-strikes, algo que no existe en NFL) — renderJuegoCard() solo
// decide cuál dibujar, según el campo `deporte` que ya viene marcado en
// cada juego desde el backend (GET /api/sabana/pizarra).
function renderJuegoCard(info) {
  // NHL, fútbol (28-08-2026), NBA (31-08-2026) y NCAAF (12-09-2026)
  // comparten EXACTAMENTE la misma forma de datos que ya usa NFL
  // (homeScore/awayScore, logo directo de la API, enVivo.periodoTexto/
  // relojTexto, estadoAbstracto 'pre'/'in'/'post') — no hizo falta ninguna
  // tarjeta nueva, renderJuegoCardNFL() ya sirve tal cual (ver ncaafApi.js:
  // es, a propósito, casi una copia de nflApi.js).
  if (info.deporte === 'nfl' || info.deporte === 'nhl' || info.deporte === 'soccer' || info.deporte === 'basket' || info.deporte === 'ncaaf') return renderJuegoCardNFL(info);
  return renderJuegoCardMLB(info);
}

function renderJuegoCardMLB(info) {
  const ev = info.enVivo || {};
  const previo = !info.finalizado && !info.suspendido && (ev.estadoAbstracto === 'Preview' || !ev.entradaActual);
  const enCurso = !info.finalizado && !info.suspendido && !previo;

  let claseExtra = '';
  let etiquetaEstado = 'EN VIVO';
  if (info.finalizado) { claseExtra = ' finalizado'; etiquetaEstado = 'FINAL'; }
  else if (info.suspendido) { etiquetaEstado = 'SUSPENDIDO'; }
  else if (previo) { claseExtra = ' previo'; etiquetaEstado = 'ANTES DEL JUEGO'; }
  else { claseExtra = ' en-vivo'; }

  // Puntico cian pulsante junto a "EN VIVO" (15-09-2026, rediseño de la
  // Pizarra a un look más "tablero digital" — ver el CSS de .juego-card).
  const etiquetaConPunto = claseExtra === ' en-vivo' ? '<span class="jc-dot-vivo"></span>' + etiquetaEstado : etiquetaEstado;

  const textoDerecha = info.finalizado ? '' : (previo ? formatHoraLocal(ev.horaInicioUTC) : (ev.entradaActualTexto || ''));

  const awayBateando = enCurso && ev.entradaAlta !== false;
  const homeBateando = enCurso && ev.entradaAlta === false;

  const filaEquipo = (nombre, carreras, bateando) =>
    '<div class="jc-equipo' + (bateando ? ' jc-bateando' : '') + '">' +
      '<span class="jc-equipo-nombre">' + logoEquipoHTML(nombre) + nombre + '</span>' +
      '<span class="jc-carreras">' + (previo ? '-' : carreras) + '</span>' +
    '</div>';

  let detalleVivo = '';
  if (enCurso) {
    const puntos = (n, activos) => Array.from({ length: n }, (_, i) =>
      '<span class="punto' + (i < activos ? ' activo' : '') + '"></span>').join('');
    detalleVivo =
      '<div class="jc-detalle-vivo">' +
        '<div class="jc-outs">' + puntos(3, ev.outs || 0) + '</div>' +
        '<div class="jc-bases">' +
          '<span class="base base-1' + (ev.corredor1B ? ' ocupada' : '') + '"></span>' +
          '<span class="base base-2' + (ev.corredor2B ? ' ocupada' : '') + '"></span>' +
          '<span class="base base-3' + (ev.corredor3B ? ' ocupada' : '') + '"></span>' +
        '</div>' +
        '<div class="jc-conteo">' + (ev.bolas || 0) + '-' + (ev.strikes || 0) + '</div>' +
      '</div>';
  }

  return (
    '<div class="juego-card' + claseExtra + '">' +
      '<div class="jc-estado"><span>' + etiquetaConPunto + '</span><span>' + textoDerecha + '</span></div>' +
      filaEquipo(info.awayTeam, info.awayRuns, awayBateando) +
      filaEquipo(info.homeTeam, info.homeRuns, homeBateando) +
      detalleVivo +
    '</div>'
  );
}

// Tarjeta de NFL: mismo "cascarón" visual que la de MLB (mismas clases
// CSS: juego-card/jc-estado/jc-equipo/jc-carreras, ya existentes), pero
// sin outs/bases/bolas-strikes (no aplica a fútbol americano) y con el
// logo que ya viene directo de la API de ESPN en vez del mapa nombre->id
// que usa MLB.
function renderJuegoCardNFL(info) {
  const ev = info.enVivo || {};
  const previo = !info.finalizado && !info.suspendido && (ev.estadoAbstracto === 'pre' || !ev.periodo);

  let claseExtra = '';
  let etiquetaEstado = 'EN VIVO';
  if (info.finalizado) { claseExtra = ' finalizado'; etiquetaEstado = 'FINAL'; }
  else if (info.suspendido) { etiquetaEstado = 'SUSPENDIDO'; }
  else if (previo) { claseExtra = ' previo'; etiquetaEstado = 'ANTES DEL JUEGO'; }
  else { claseExtra = ' en-vivo'; }

  // Puntico cian pulsante junto a "EN VIVO" — mismo criterio que
  // renderJuegoCardMLB() (ver el CSS de .juego-card.en-vivo/.jc-dot-vivo).
  const etiquetaConPunto = claseExtra === ' en-vivo' ? '<span class="jc-dot-vivo"></span>' + etiquetaEstado : etiquetaEstado;

  const textoDerecha = info.finalizado
    ? ''
    : (previo
        ? formatHoraLocal(ev.horaInicioUTC)
        : [ev.periodoTexto, ev.relojTexto].filter(Boolean).join(' · '));

  const filaEquipo = (nombre, puntos, logoUrl) =>
    '<div class="jc-equipo">' +
      '<span class="jc-equipo-nombre">' + logoEquipoHTML(nombre, logoUrl) + nombre + '</span>' +
      '<span class="jc-carreras">' + (previo ? '-' : puntos) + '</span>' +
    '</div>';

  return (
    '<div class="juego-card' + claseExtra + '">' +
      '<div class="jc-estado"><span>' + etiquetaConPunto + '</span><span>' + textoDerecha + '</span></div>' +
      filaEquipo(info.awayTeam, info.awayScore, info.awayTeamLogo) +
      filaEquipo(info.homeTeam, info.homeScore, info.homeTeamLogo) +
    '</div>'
  );
}

async function actualizarPizarraEnVivo() {
  const cont = document.getElementById('pizarraEnVivo');
  const estadoEl = document.getElementById('pizarraEstado');
  if (!cont) return;

  if (!ULTIMA_FECHA_PROCESADA) {
    cont.innerHTML = '<p style="color:#888; grid-column:1/-1;">Procesa una sábana para ver aquí los juegos de tus clientes en curso.</p>';
    return;
  }

  try {
    const juegos = await api('/api/sabana/pizarra?fecha=' + ULTIMA_FECHA_PROCESADA);
    const relevantes = juegos.filter(j => EQUIPOS_RELEVANTES_HOY.has(j.homeTeam) || EQUIPOS_RELEVANTES_HOY.has(j.awayTeam));

    if (relevantes.length === 0) {
      cont.innerHTML = '<p style="color:#888; grid-column:1/-1;">No se encontraron partidos para las jugadas de esta sábana.</p>';
    } else {
      cont.innerHTML = relevantes.map(renderJuegoCard).join('');
    }

    const quedanEnCurso = relevantes.some(j => !j.finalizado);
    if (estadoEl) {
      estadoEl.textContent = quedanEnCurso
        ? 'Actualizado ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' — se refresca solo cada 20s'
        : (relevantes.length > 0 ? 'Todos los juegos relevantes ya terminaron.' : '');
    }

    if (PIZARRA_INTERVALO) { clearInterval(PIZARRA_INTERVALO); PIZARRA_INTERVALO = null; }
    if (quedanEnCurso) {
      PIZARRA_INTERVALO = setInterval(actualizarPizarraEnVivo, 20000);
    }
  } catch (e) {
    console.error('No se pudo actualizar la Pizarra en Vivo:', e);
  }
}

// =================================================================
// 6. ADMINISTRACIÓN > JUGADOR
// =================================================================
async function cargarJugadores() {
  // Guarda de permiso (18-09-2026, ver tienePermiso() más arriba) — esto
  // se llama sin condición desde mostrarApp() apenas se inicia sesión (lo
  // necesitan varias pestañas para llenar sus <select> de clientes), así
  // que un Empleado sin permiso 'jugador' quedaría deslogueado de
  // inmediato al entrar si no se corta acá antes de pedirle nada al
  // backend (que sí bloquea /api/jugadores con 403 para ese caso).
  if (!tienePermiso('jugador')) { JUGADORES_CACHE = []; renderTablaJugadores(); renderSelectsDeJugadores(); return JUGADORES_CACHE; }
  try {
    JUGADORES_CACHE = await api('/api/jugadores');
    renderTablaJugadores();
    renderSelectsDeJugadores();
  } catch (e) {
    console.error(e);
  }
  return JUGADORES_CACHE;
}

function actualizarVisibilidadPozoJugador() {
  const tipo = document.getElementById('jugadorTipoCuenta').value;
  document.getElementById('contenedorPozoJugador').style.display = (tipo === 'avalado') ? 'block' : 'none';
}

// "Moneda del Jugador" (18-09-2026, ver la nota grande en grupo.html
// junto a #contenedorMonedaJugador) — este selector SOLO se muestra
// cuando el grupo entero está en modo 'mixto' (MONEDA_MODO_GRUPO, cargada
// al iniciar sesión y refrescada cada vez que se guarda un cambio desde
// "💱 Moneda"). En modo fijo (USD o Bs) el backend fuerza esa moneda a
// TODOS los jugadores igual, así que preguntarlo acá sería una pregunta
// sin efecto real — se oculta para no confundir.
function actualizarVisibilidadMonedaJugador() {
  const cont = document.getElementById('contenedorMonedaJugador');
  if (cont) cont.style.display = (MONEDA_MODO_GRUPO === 'mixto') ? 'block' : 'none';
}

function cancelarEdicionJugador() {
  document.getElementById('jugadorEditandoId').value = '';
  document.getElementById('jugadorFormTitulo').textContent = '➕ Registrar Jugador Nuevo';
  document.getElementById('jugadorNombre').value = '';
  document.getElementById('jugadorTelefono').value = '';
  document.getElementById('jugadorNotas').value = '';
  document.getElementById('jugadorTipoCuenta').value = 'libre';
  document.getElementById('jugadorPozoInicial').value = '';
  document.getElementById('jugadorActivo').checked = true;
  const monedaSel = document.getElementById('jugadorMoneda');
  if (monedaSel) monedaSel.value = 'USD';
  actualizarVisibilidadPozoJugador();
  actualizarVisibilidadMonedaJugador();
}

function editarJugador(id) {
  const j = JUGADORES_CACHE.find(x => String(x.id) === String(id));
  if (!j) return;
  document.getElementById('jugadorEditandoId').value = j.id;
  document.getElementById('jugadorFormTitulo').textContent = '✏️ Editando: ' + j.nombre;
  document.getElementById('jugadorNombre').value = j.nombre;
  document.getElementById('jugadorTelefono').value = j.telefono || '';
  document.getElementById('jugadorNotas').value = j.notas || '';
  document.getElementById('jugadorTipoCuenta').value = j.tipo_cuenta;
  document.getElementById('jugadorPozoInicial').value = j.pozo_inicial || '';
  document.getElementById('jugadorActivo').checked = !!j.activo;
  // "Moneda del Jugador" (18-09-2026) — precarga con la moneda que ya
  // tiene guardada este cliente (el backend siempre la devuelve, sin
  // importar el modo del grupo, ver routes/jugadores.js).
  const monedaSel = document.getElementById('jugadorMoneda');
  if (monedaSel) monedaSel.value = j.moneda === 'BS' ? 'BS' : 'USD';
  actualizarVisibilidadPozoJugador();
  actualizarVisibilidadMonedaJugador();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function guardarJugador() {
  const id = document.getElementById('jugadorEditandoId').value;
  const nombre = document.getElementById('jugadorNombre').value.trim();
  if (!nombre) { alert('Ingresa el nombre del jugador.'); return; }

  // Al editar, se conserva el % de comisión propia que ya tenía (este
  // formulario no lo toca — eso vive en Administración > Comisión).
  const existente = id ? JUGADORES_CACHE.find(x => String(x.id) === String(id)) : null;

  const payload = {
    nombre,
    telefono: document.getElementById('jugadorTelefono').value.trim(),
    notas: document.getElementById('jugadorNotas').value.trim(),
    activo: document.getElementById('jugadorActivo').checked,
    tipoCuenta: document.getElementById('jugadorTipoCuenta').value,
    pozoInicial: document.getElementById('jugadorPozoInicial').value || 0,
    comisionPropia: existente ? existente.comision_propia : 0
  };

  // "Moneda del Jugador" (18-09-2026) — solo se manda cuando el selector
  // está visible (grupo en modo 'mixto'); en modo fijo el backend la
  // fuerza igual aunque no venga en el body (ver resolverMonedaJugador()
  // en routes/jugadores.js), así que no hace falta mandarla ahí, pero
  // tampoco molesta si se manda.
  if (MONEDA_MODO_GRUPO === 'mixto') {
    const monedaSel = document.getElementById('jugadorMoneda');
    if (monedaSel) payload.moneda = monedaSel.value;
  }

  try {
    if (id) {
      await api('/api/jugadores/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/jugadores', { method: 'POST', body: JSON.stringify(payload) });
    }
    cancelarEdicionJugador();
    cargarJugadores();
  } catch (e) {
    alert('No se pudo guardar el jugador: ' + e.message);
  }
}

async function eliminarJugador(id) {
  const j = JUGADORES_CACHE.find(x => String(x.id) === String(id));
  if (!confirm('¿Eliminar el registro de "' + (j ? j.nombre : id) + '"? Esto no borra su historial de jugadas ya procesadas.')) return;
  try {
    await api('/api/jugadores/' + id, { method: 'DELETE' });
    cargarJugadores();
  } catch (e) {
    alert('No se pudo eliminar: ' + e.message);
  }
}

function copiarLinkCliente(token, nombre) {
  if (!token) { alert('Este jugador no tiene link.'); return; }
  const link = location.origin + '/cliente.html?token=' + token;
  copiarTextoAlPortapapeles(link, 'Link de ' + nombre + ' copiado.');
}

function renderTablaJugadores() {
  const tbody = document.querySelector('#tablaJugadores tbody');
  tbody.innerHTML = '';
  JUGADORES_CACHE.forEach(j => {
    const pozoTexto = j.tipo_cuenta === 'avalado' && j.pozo
      ? formatMoney(j.pozo.pozoDisponible) + ' disp. (' + formatMoney(j.pozo.pozoActual) + ' total)'
      : '—';
    const monedaTexto = j.moneda === 'BS' ? '🇻🇪 Bs' : '🇺🇸 USD';
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + j.nombre + '</td>' +
      '<td>' + (j.telefono || '—') + '</td>' +
      '<td>' + (j.notas || '—') + '</td>' +
      '<td>' + (j.tipo_cuenta === 'avalado' ? '🔒 Avalado' : '🆓 Libre') + '</td>' +
      '<td>' + pozoTexto + '</td>' +
      '<td class="col-jugador-moneda" style="display:none;">' + monedaTexto + '</td>' +
      '<td>' + (j.activo ? 'Activo' : 'Inactivo') + '</td>' +
      '<td style="white-space:nowrap;">' +
        '<button type="button" class="btn-chico" onclick="editarJugador(\'' + j.id + '\')">✏️</button> ' +
        '<button type="button" class="btn-chico btn-secundario" onclick="copiarLinkCliente(\'' + j.token + '\',\'' + j.nombre.replace(/'/g, "\\'") + '\')">🔗 Link</button> ' +
        '<button type="button" class="btn-chico btn-secundario" onclick="abrirHistorialCliente(\'' + j.nombre.replace(/'/g, "\\'") + '\')">📖 Historial</button> ' +
        '<button type="button" class="btn-chico btn-peligro" onclick="eliminarJugador(\'' + j.id + '\')">🗑️</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
  // "col-jugador-moneda" (18-09-2026) — la columna (encabezado + cada
  // celda) solo se muestra cuando el grupo está en modo 'mixto' (ver la
  // nota grande junto a esta clase en grupo.html).
  document.querySelectorAll('#tablaJugadores .col-jugador-moneda').forEach(el => {
    el.style.display = (MONEDA_MODO_GRUPO === 'mixto') ? '' : 'none';
  });
}

// =================================================================
// ADMINISTRACIÓN > MONEDA DEL GRUPO (18-09-2026 — ver GET/PUT
// /api/grupo/moneda-modo en routes/grupo.js y la nota grande en
// sql/schema.sql). Cualquier sesión autenticada puede LEER el modo
// actual (se usa para el selector de moneda del formulario de Jugador y
// para decidir si los reportes con dinero se dividen en 2 bloques), pero
// solo un Administrador puede CAMBIARLO — el backend ya responde 403 si
// un Empleado intenta el PUT, y esta pestaña además está oculta por
// completo para cualquier Empleado (ver aplicarPermisosEmpleado()).
// =================================================================
async function cargarMonedaModoGrupo() {
  try {
    const data = await api('/api/grupo/moneda-modo');
    MONEDA_MODO_GRUPO = data.monedaModo;
    const sel = document.getElementById('monedaModoSelect');
    if (sel) sel.value = MONEDA_MODO_GRUPO;
    // Estos 2 lugares leen MONEDA_MODO_GRUPO para decidir qué mostrar —
    // se refrescan acá para que un cambio guardado en otra pestaña del
    // navegador (u otro Administrador con sesión abierta a la vez) se
    // refleje sin tener que recargar toda la página.
    actualizarVisibilidadMonedaJugador();
    renderTablaJugadores();
  } catch (e) {
    console.error('No se pudo cargar la moneda del grupo:', e);
  }
}

async function guardarMonedaModoGrupo() {
  const sel = document.getElementById('monedaModoSelect');
  const nuevoModo = sel.value;
  const aviso = document.getElementById('monedaModoGuardadoAviso');
  if (aviso) aviso.style.display = 'none';

  // Si el grupo VENÍA de 'mixto' y pasa a un modo fijo (USD o Bs), el
  // backend fuerza esa moneda fija a TODOS los clientes de una vez (ver
  // PUT /api/grupo/moneda-modo en routes/grupo.js) — sin importar la
  // moneda que cada uno tenía. Se pide confirmar ESTE cambio puntual
  // porque es el único de los 3 que reescribe datos ya guardados de
  // golpe (cambiar entre 'usd' y 'bs' fijo, o pasar A 'mixto', no borra
  // ni reescribe nada de cada jugador).
  if (MONEDA_MODO_GRUPO === 'mixto' && nuevoModo !== 'mixto') {
    const etiquetaNueva = nuevoModo === 'bs' ? 'Bolívares (Bs)' : 'Dólares (USD)';
    const confirmado = confirm(
      '⚠️ Vas a pasar el grupo de "Mixto" a "' + etiquetaNueva + '" fijo.\n\n' +
      'Todos los clientes pasarán a usar ' + etiquetaNueva + ', sin importar la moneda que tenían antes. ¿Continuar?'
    );
    if (!confirmado) return;
  }

  try {
    const data = await api('/api/grupo/moneda-modo', { method: 'PUT', body: JSON.stringify({ monedaModo: nuevoModo }) });
    MONEDA_MODO_GRUPO = data.monedaModo;
    if (aviso) { aviso.style.display = 'block'; }
    // El formulario/tabla de Jugador y los reportes de Sábana/Balance
    // General/% Devueltos dependen de esta variable — se refrescan de
    // una vez para que el cambio se vea sin tener que ir y volver de
    // pestaña.
    actualizarVisibilidadMonedaJugador();
    cargarJugadores();
  } catch (e) {
    alert('No se pudo guardar la moneda del grupo: ' + e.message);
  }
}

// =================================================================
// ADMINISTRACIÓN > EMPLEADOS (18-09-2026, a pedido del usuario:
// "soluciona la cuentas separas por empleado dentro de un grupo... un
// administrador que tiene acceso 100% y los empleados puedes elegir que
// pueden o no hacer" — ver la nota grande en src/routes/empleados.js).
// EXCLUSIVA del Administrador: la ruta ya responde 403 a un Empleado
// (además de "requiereAdministrador", ver middleware/auth.js), y esta
// pestaña está oculta por completo del sidebar para cualquier cuenta de
// Empleado (ver aplicarPermisosEmpleado()).
// =================================================================
async function cargarEmpleados() {
  try {
    const [empleados, permisos] = await Promise.all([
      api('/api/empleados'),
      // Se pide siempre (no solo la primera vez) porque no cambia en la
      // sesión y así se evita 1 llamada extra al backend a cada rato —
      // igual es una lista chiquita (11 strings) y no cuesta nada
      // repetirla mientras se sigue en esta misma pestaña.
      PERMISOS_DISPONIBLES_CACHE.length > 0 ? PERMISOS_DISPONIBLES_CACHE : api('/api/empleados/permisos-disponibles')
    ]);
    EMPLEADOS_CACHE = empleados;
    PERMISOS_DISPONIBLES_CACHE = permisos;
    renderChecklistPermisosEmpleado();
    renderTablaEmpleados();
  } catch (e) {
    console.error('No se pudo cargar la lista de Empleados:', e);
  }
}

// Arma el checklist de permisos del formulario a partir de
// PERMISOS_DISPONIBLES_CACHE (las 11 claves reales que acepta el
// backend, ver GET /api/empleados/permisos-disponibles) en vez de
// escribirlo a mano en grupo.html — si el backend agrega una clave
// nueva el día de mañana, este checklist la muestra sola (con la clave
// cruda como etiqueta de respaldo si ETIQUETAS_PERMISOS no la conoce
// todavía) sin tener que tocar HTML.
function renderChecklistPermisosEmpleado() {
  const cont = document.getElementById('empleadoPermisosChecklist');
  if (!cont) return;
  cont.innerHTML = PERMISOS_DISPONIBLES_CACHE.map(clave =>
    '<label style="font-weight:normal; display:flex; align-items:center; gap:6px; font-size:13px;">' +
    '<input type="checkbox" class="chk-permiso-empleado" value="' + clave + '" style="width:auto;"> ' +
    (ETIQUETAS_PERMISOS[clave] || clave) +
    '</label>'
  ).join('');
}

function marcarTodosPermisosEmpleado(marcar) {
  document.querySelectorAll('.chk-permiso-empleado').forEach(cb => { cb.checked = marcar; });
}

function cancelarEdicionEmpleado() {
  document.getElementById('empleadoEditandoId').value = '';
  document.getElementById('empleadoFormTitulo').textContent = '➕ Registrar Empleado Nuevo';
  document.getElementById('empleadoNombre').value = '';
  document.getElementById('empleadoEmail').value = '';
  document.getElementById('empleadoPassword').value = '';
  document.getElementById('empleadoPassword').placeholder = 'Ej: ******';
  const notaPassword = document.getElementById('empleadoPasswordNota');
  if (notaPassword) notaPassword.textContent = ' (mín. 6 caracteres)';
  document.getElementById('empleadoActivo').checked = true;
  marcarTodosPermisosEmpleado(false);
}

function editarEmpleado(id) {
  const emp = EMPLEADOS_CACHE.find(x => String(x.id) === String(id));
  if (!emp) return;
  document.getElementById('empleadoEditandoId').value = emp.id;
  document.getElementById('empleadoFormTitulo').textContent = '✏️ Editando: ' + emp.nombre;
  document.getElementById('empleadoNombre').value = emp.nombre;
  document.getElementById('empleadoEmail').value = emp.email;
  // La contraseña NUNCA se precarga (el backend no la devuelve, solo
  // guarda el hash) — dejarla en blanco al editar significa "no
  // cambiarla" (ver PUT /api/empleados/:id, actualización parcial).
  document.getElementById('empleadoPassword').value = '';
  document.getElementById('empleadoPassword').placeholder = 'Deja en blanco para no cambiarla';
  const notaPassword = document.getElementById('empleadoPasswordNota');
  if (notaPassword) notaPassword.textContent = ' (deja en blanco para no cambiarla)';
  document.getElementById('empleadoActivo').checked = !!emp.activo;
  const permisosDeEste = Array.isArray(emp.permisos) ? emp.permisos : [];
  document.querySelectorAll('.chk-permiso-empleado').forEach(cb => { cb.checked = permisosDeEste.includes(cb.value); });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function guardarEmpleado() {
  const id = document.getElementById('empleadoEditandoId').value;
  const nombre = document.getElementById('empleadoNombre').value.trim();
  const email = document.getElementById('empleadoEmail').value.trim();
  const password = document.getElementById('empleadoPassword').value;
  const permisos = Array.from(document.querySelectorAll('.chk-permiso-empleado:checked')).map(cb => cb.value);

  if (!nombre) { alert('Ingresa el nombre del empleado.'); return; }
  if (!email) { alert('Ingresa el email del empleado.'); return; }
  // Al crear, la contraseña es obligatoria; al editar, en blanco = "no
  // cambiarla" (ver la nota en cancelarEdicionEmpleado()/editarEmpleado()).
  if (!id && (!password || password.length < 6)) { alert('Ingresa una contraseña de al menos 6 caracteres.'); return; }
  if (id && password && password.length < 6) { alert('Si vas a cambiar la contraseña, debe tener al menos 6 caracteres.'); return; }

  const payload = { nombre, email, permisos, activo: document.getElementById('empleadoActivo').checked };
  if (password) payload.password = password;

  try {
    if (id) {
      await api('/api/empleados/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/empleados', { method: 'POST', body: JSON.stringify(payload) });
    }
    cancelarEdicionEmpleado();
    cargarEmpleados();
  } catch (e) {
    // El 409 ("ya existe una cuenta con ese email") ya viene con un
    // mensaje legible desde el backend (ver routes/empleados.js) — se
    // muestra tal cual, igual que cualquier otro error de este formulario.
    alert('No se pudo guardar el empleado: ' + e.message);
  }
}

async function eliminarEmpleado(id) {
  const emp = EMPLEADOS_CACHE.find(x => String(x.id) === String(id));
  if (!confirm('¿Eliminar la cuenta de "' + (emp ? emp.nombre : id) + '"? Ya no va a poder iniciar sesión.')) return;
  try {
    await api('/api/empleados/' + id, { method: 'DELETE' });
    cargarEmpleados();
  } catch (e) {
    alert('No se pudo eliminar: ' + e.message);
  }
}

function renderTablaEmpleados() {
  const tbody = document.querySelector('#tablaEmpleados tbody');
  tbody.innerHTML = '';
  if (EMPLEADOS_CACHE.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888;">Todavía no registraste ningún Empleado.</td></tr>';
    return;
  }
  EMPLEADOS_CACHE.forEach(emp => {
    const cantidad = Array.isArray(emp.permisos) ? emp.permisos.length : 0;
    // "Acceso total" (18-09-2026) — cuando un Empleado tiene los 11
    // permisos marcados, mostrar "11 de 11" es técnicamente correcto
    // pero menos claro que decirlo directo; PERMISOS_DISPONIBLES_CACHE
    // puede no estar cargada todavía la primera vez (ej. si esta tabla
    // se pintó antes de que resuelva esa llamada) — en ese caso se cae
    // al conteo simple "N permiso(s)" en vez de comparar contra 0.
    const totalDisponibles = PERMISOS_DISPONIBLES_CACHE.length;
    const permisosTexto = (totalDisponibles > 0 && cantidad === totalDisponibles)
      ? '✅ Acceso total (' + cantidad + ')'
      : cantidad + ' permiso(s)';
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + emp.nombre + '</td>' +
      '<td>' + emp.email + '</td>' +
      '<td>' + permisosTexto + '</td>' +
      '<td>' + (emp.activo ? 'Activo' : 'Inactivo') + '</td>' +
      '<td style="white-space:nowrap;">' +
        '<button type="button" class="btn-chico" onclick="editarEmpleado(\'' + emp.id + '\')">✏️</button> ' +
        '<button type="button" class="btn-chico btn-peligro" onclick="eliminarEmpleado(\'' + emp.id + '\')">🗑️</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

// =================================================================
// "CONTROL POR CLIENTE" (31-08-2026, a pedido del usuario) — historial
// completo de jugadas de UN cliente, para revisar cuando el usuario
// quiera. Ver GET /api/reportes/historial-cliente (reportes.js /
// historial.js).
// =================================================================
let HISTORIAL_CLIENTE_NOMBRE = null;

// `desde`/`hasta` opcionales (02-09-2026, a pedido del usuario): cuando se
// abre desde el botón "👁️ Ver" de Balance General, se precarga con el
// mismo rango que se estaba viendo ahí, en vez de arrancar vacío — así el
// detalle que se ve coincide con el saldo que se acaba de clickear.
function abrirHistorialCliente(nombre, desde, hasta) {
  HISTORIAL_CLIENTE_NOMBRE = nombre;
  document.getElementById('historialClienteNombre').textContent = nombre;
  document.getElementById('historialClienteDesde').value = desde || '';
  document.getElementById('historialClienteHasta').value = hasta || '';
  document.getElementById('modalHistorialCliente').classList.add('activo');
  buscarHistorialCliente();
}

function cerrarHistorialCliente() {
  document.getElementById('modalHistorialCliente').classList.remove('activo');
}

async function buscarHistorialCliente() {
  if (!HISTORIAL_CLIENTE_NOMBRE) return;
  const desde = document.getElementById('historialClienteDesde').value;
  const hasta = document.getElementById('historialClienteHasta').value;
  let qs = '?cliente=' + encodeURIComponent(HISTORIAL_CLIENTE_NOMBRE);
  if (desde) qs += '&desde=' + desde;
  if (hasta) qs += '&hasta=' + hasta;
  try {
    const resp = await api('/api/reportes/historial-cliente' + qs);
    // "movimientos" (02-09-2026): tickets de sábana Y filas de Polla
    // juntos — ver el comentario grande en routes/reportes.js. Antes solo
    // se leía resp.tickets, así que un cliente que SOLO juega Polla se
    // veía con la lista vacía a pesar de tener saldo.
    renderTablaHistorialCliente(resp.movimientos || resp.tickets || []);
  } catch (e) {
    alert('No se pudo cargar el historial: ' + e.message);
  }
}

// "neto" de un movimiento = lo que ese movimiento le suma/resta al saldo
// del cliente SOLO por jugadas/Polla (mismo criterio que saldoCliente en
// balanceGeneral.js, sin comisión ni transferencias, que no son "por
// movimiento" sino agregados del rango). GANADA suma lo pagado, PERDIDA
// resta lo arriesgado, cualquier otro estado (ANULADA/PENDIENTE/etc.) no
// mueve nada — la Polla suma su monto (ya viene con signo).
function netoMovimientoHistorialCliente(m) {
  if (m.tipo === 'polla') return m.monto;
  if (m.estado === 'GANADA') return m.gana;
  if (m.estado === 'PERDIDA') return -m.arriesga;
  return 0;
}

// Historial de cliente agrupado por día (03-09-2026, a pedido del
// usuario: "que sea más ordenado, que se separe por día, se vea el
// total por día, total semana ... a pesar de que a la izquierda se ve
// la fecha, no sé qué día es, deja la fecha pero separa por día ...
// que los días se puedan esconder o mostrar"). Antes era una única
// tabla plana con todos los movimientos del rango uno detrás de otro.
// Ahora se arma un grupo colapsable por cada fecha (nombre del día +
// fecha corta + total neto de ESE día), con sus movimientos adentro
// como antes, más un resumen del rango completo arriba de todo. Todos
// los días arrancan colapsados (para que el resumen se vea compacto de
// entrada); "Expandir/Colapsar todos" y el clic en cada encabezado los
// abren/cierran.
function renderTablaHistorialCliente(movimientos) {
  const cajaDias = document.getElementById('historialClienteDias');
  const resumenSemana = document.getElementById('historialClienteResumenSemana');
  const vacio = document.getElementById('historialClienteVacio');
  cajaDias.innerHTML = '';
  vacio.style.display = movimientos.length === 0 ? 'block' : 'none';
  resumenSemana.style.display = movimientos.length === 0 ? 'none' : 'flex';
  if (movimientos.length === 0) return;

  // Agrupa preservando el orden en que ya vienen (el backend los manda
  // ordenados por fecha ascendente, tickets antes que Polla dentro del
  // mismo día — ver routes/reportes.js).
  const porFecha = {};
  const ordenFechas = [];
  movimientos.forEach(m => {
    if (!porFecha[m.fecha]) { porFecha[m.fecha] = []; ordenFechas.push(m.fecha); }
    porFecha[m.fecha].push(m);
  });

  let totalRango = 0;

  ordenFechas.forEach((fecha, idxDia) => {
    const movsDelDia = porFecha[fecha];
    const totalDia = movsDelDia.reduce((acc, m) => acc + netoMovimientoHistorialCliente(m), 0);
    totalRango += totalDia;

    const divDia = document.createElement('div');
    divDia.className = 'historial-dia colapsado';
    divDia.id = 'historial-dia-' + idxDia;

    const colorTotalDia = totalDia >= 0 ? '#27ae60' : '#c0392b';
    const filasHtml = movsDelDia.map(m => {
      const badgeDia = m.diaConfirmado
        ? '<span class="badge-diaconfirmado">✅ Oficial</span>'
        : '<span class="badge-diasinconfirmar">⚠️ Sin confirmar</span>';

      if (m.tipo === 'polla') {
        // Fila de Polla (02-09-2026): mismas columnas que un ticket, para no
        // tener que rediseñar la tabla — "Ticket" muestra "🎲 Polla",
        // "Jugadas"/"Arriesga" quedan en "—" (la Polla no tiene esos
        // conceptos, ver polla.js), "Gana" muestra el monto CON signo
        // (puede ser negativo) y "Estado" un texto corto derivado del signo.
        const esGanancia = m.monto >= 0;
        return '<tr class="' + (esGanancia ? 'ganada' : 'perdida') + '">' +
          '<td>🎲 Polla</td>' +
          '<td>—</td>' +
          '<td>—</td>' +
          '<td class="' + (esGanancia ? 'ganada' : 'perdida') + '">' + (esGanancia ? '+' : '') + formatMoney(m.monto) + '</td>' +
          '<td class="' + (esGanancia ? 'ganada' : 'perdida') + '">' + (esGanancia ? 'GANÓ POLLA' : 'PERDIÓ POLLA') + '</td>' +
          '<td>' + badgeDia + '</td></tr>';
      }

      const claseEstado = CLASE_ESTADO[m.estado] || '';
      return '<tr class="' + claseEstado + '">' +
        '<td>' + m.ticket + '</td>' +
        '<td>' + (m.detalle || '').replace(/\n/g, '<br>') + '</td>' +
        '<td>' + formatMoney(m.arriesga) + '</td>' +
        '<td>' + formatMoney(m.gana) + '</td>' +
        '<td class="' + claseEstado + '">' + m.estado + '</td>' +
        '<td>' + badgeDia + '</td></tr>';
    }).join('');

    divDia.innerHTML =
      '<div class="historial-dia-header" onclick="toggleHistorialDia(' + idxDia + ')">' +
        '<span class="fecha-dia"><span class="flecha">▼</span>' + etiquetaDiaLarga(fecha) + '<span class="fecha-corta"> ' + formatFechaDDMMYYYY(fecha) + '</span></span>' +
        '<span style="color:' + colorTotalDia + '; font-weight:bold;">' + (totalDia >= 0 ? '+' : '') + formatMoney(totalDia) + '</span>' +
      '</div>' +
      '<div class="historial-dia-cuerpo"><table><thead><tr>' +
        '<th>Ticket</th><th>Jugadas</th><th>Arriesga</th><th>Gana</th><th>Estado</th><th>Sábana</th>' +
      '</tr></thead><tbody>' + filasHtml + '</tbody></table></div>';
    cajaDias.appendChild(divDia);
  });

  const colorTotalRango = totalRango >= 0 ? '#27ae60' : '#c0392b';
  resumenSemana.innerHTML =
    '<span>Total del rango (' + ordenFechas.length + ' día(s) con movimientos)</span>' +
    '<span style="color:' + colorTotalRango + ';">' + (totalRango >= 0 ? '+' : '') + formatMoney(totalRango) + '</span>';
}

function toggleHistorialDia(idx) {
  const div = document.getElementById('historial-dia-' + idx);
  if (div) div.classList.toggle('colapsado');
}

function expandirTodosHistorialCliente(expandir) {
  document.querySelectorAll('#historialClienteDias .historial-dia').forEach(div => {
    div.classList.toggle('colapsado', !expandir);
  });
}

function renderSelectsDeJugadores() {
  const nombresOrdenados = JUGADORES_CACHE.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
  const llenarPorId = (id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const actual = sel.value;
    sel.innerHTML = nombresOrdenados.map(j => '<option value="' + j.id + '">' + j.nombre + '</option>').join('');
    if (actual) sel.value = actual;
  };
  const llenarPorNombre = (id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const actual = sel.value;
    sel.innerHTML = nombresOrdenados.map(j => '<option value="' + j.nombre + '">' + j.nombre + '</option>').join('');
    if (actual) sel.value = actual;
  };
  llenarPorId('comisionJugadorSelect');
  llenarPorId('avalAvaladorSelect');
  llenarPorId('avalAvaladoSelect');
  llenarPorNombre('transferOrigen');
  llenarPorNombre('transferDestino');
}

// =================================================================
// 7. ADMINISTRACIÓN > COMISIÓN (% propio + avales)
// =================================================================
// Etiqueta legible del "modelo de comisión" de un jugador puntual (09-09-2026,
// "grupo mixto" — ver la nota grande en src/routes/jugadores.js /
// sql/schema.sql, columna jugadores.modelo_comision).
function etiquetaModeloComisionJugador(modelo) {
  if (modelo === 'plano') return '% fijo';
  if (modelo === 'por_tipo_jugada') return 'Por tipo de jugada';
  return 'Hereda del grupo';
}

async function guardarComisionPropia() {
  const id = document.getElementById('comisionJugadorSelect').value;
  const pct = document.getElementById('comisionPorcentajeInput').value;
  const modeloSelect = document.getElementById('comisionModeloSelect');
  const modelo = modeloSelect ? modeloSelect.value : '';
  if (!id) { alert('Elige un jugador.'); return; }
  // El % ya no es obligatorio: un jugador puede quedar con "modelo" =
  // 'por_tipo_jugada' (cobra por los niveles del grupo) sin necesitar un %
  // fijo propio; y "modelo" = 'plano' con % vacío equivale a 0 = "sin %",
  // tal como pidió el usuario ("puedo elegir cualquier tipo de % o sin %").
  if (pct !== '' && isNaN(Number(pct))) { alert('Ingresa un % válido (o déjalo vacío = 0).'); return; }

  const j = JUGADORES_CACHE.find(x => String(x.id) === String(id));
  if (!j) return;

  try {
    await api('/api/jugadores/' + id, {
      method: 'PUT',
      body: JSON.stringify({
        nombre: j.nombre, telefono: j.telefono, notas: j.notas, activo: j.activo,
        tipoCuenta: j.tipo_cuenta, pozoInicial: j.pozo_inicial,
        comisionPropia: pct === '' ? 0 : Number(pct), modeloComision: modelo || null
      })
    });
    document.getElementById('comisionPorcentajeInput').value = '';
    if (modeloSelect) modeloSelect.value = '';
    await cargarJugadores();
    renderTablaComisiones();
  } catch (e) {
    alert('No se pudo guardar: ' + e.message);
  }
}

function renderTablaComisiones() {
  const tbody = document.querySelector('#tablaComisiones tbody');
  tbody.innerHTML = '';
  // Se muestra un jugador si tiene % propio > 0 O si tiene un "modelo de
  // comisión" propio marcado (grupo mixto: puede tener 'por_tipo_jugada'
  // con % en 0, o 'plano' con % en 0 = "sin %" a propósito) — antes solo
  // entraban los que tenían % > 0, así que una excepción "sin %" o "por
  // tipo de jugada sin % de respaldo" quedaba invisible en esta tabla.
  JUGADORES_CACHE.filter(j => Number(j.comision_propia) > 0 || j.modelo_comision === 'plano' || j.modelo_comision === 'por_tipo_jugada')
    .sort((a, b) => a.nombre.localeCompare(b.nombre)).forEach(j => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + j.nombre + '</td>' +
        '<td>' + (j.comision_propia || 0) + '%</td>' +
        '<td>' + etiquetaModeloComisionJugador(j.modelo_comision) + '</td>' +
        '<td><button type="button" class="btn-chico btn-peligro" onclick="quitarComisionPropia(\'' + j.id + '\')">Quitar</button></td>';
      tbody.appendChild(tr);
    });
}

async function quitarComisionPropia(id) {
  const j = JUGADORES_CACHE.find(x => String(x.id) === String(id));
  if (!j) return;
  if (!confirm('¿Quitar el % y el modelo de comisión propios de "' + j.nombre + '" (vuelve a heredar el modelo del grupo)?')) return;
  try {
    await api('/api/jugadores/' + id, {
      method: 'PUT',
      body: JSON.stringify({
        nombre: j.nombre, telefono: j.telefono, notas: j.notas, activo: j.activo,
        tipoCuenta: j.tipo_cuenta, pozoInicial: j.pozo_inicial, comisionPropia: 0, modeloComision: null
      })
    });
    await cargarJugadores();
    renderTablaComisiones();
  } catch (e) {
    alert('No se pudo quitar: ' + e.message);
  }
}

let AVALES_CACHE = [];
async function cargarAvales() {
  try {
    AVALES_CACHE = await api('/api/avales');
    renderTablaAvales();
    renderTablaComisiones();
  } catch (e) {
    console.error(e);
  }
}

async function guardarAval() {
  const avaladorId = document.getElementById('avalAvaladorSelect').value;
  const avaladoId = document.getElementById('avalAvaladoSelect').value;
  const porcentaje = document.getElementById('avalPorcentajeInput').value;
  if (!avaladorId || !avaladoId) { alert('Elige el avalador y el avalado.'); return; }
  if (avaladorId === avaladoId) { alert('Un jugador no puede avalarse a sí mismo.'); return; }
  if (porcentaje === '' || isNaN(Number(porcentaje))) { alert('Ingresa un % válido.'); return; }

  try {
    await api('/api/avales', { method: 'POST', body: JSON.stringify({ avaladorId, avaladoId, porcentaje: Number(porcentaje) }) });
    document.getElementById('avalPorcentajeInput').value = '';
    cargarAvales();
  } catch (e) {
    alert('No se pudo guardar el aval: ' + e.message);
  }
}

async function eliminarAval(id) {
  if (!confirm('¿Eliminar este aval?')) return;
  try {
    await api('/api/avales/' + id, { method: 'DELETE' });
    cargarAvales();
  } catch (e) {
    alert('No se pudo eliminar: ' + e.message);
  }
}

function renderTablaAvales() {
  const tbody = document.querySelector('#tablaAvales tbody');
  tbody.innerHTML = '';
  AVALES_CACHE.forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + a.avalador + '</td>' +
      '<td>' + a.avalado + '</td>' +
      '<td>' + a.porcentaje + '%</td>' +
      '<td><button type="button" class="btn-chico btn-peligro" onclick="eliminarAval(\'' + a.id + '\')">🗑️</button></td>';
    tbody.appendChild(tr);
  });
}

// =================================================================
// 8. RANGOS RÁPIDOS COMPARTIDOS (% Devueltos y Balance General)
// =================================================================
async function aplicarRangoRapidoPanel(prefijo) {
  const tipo = document.getElementById(prefijo + 'RangoRapido').value;
  if (tipo === 'personalizado') {
    if (prefijo === 'pd') renderPorcentajesDevueltos();
    if (prefijo === 'bg') renderBalanceGeneral();
    return;
  }
  try {
    const rango = await api('/api/reportes/rango-rapido?tipo=' + tipo);
    document.getElementById(prefijo + 'Desde').value = rango.desde;
    document.getElementById(prefijo + 'Hasta').value = rango.hasta;
  } catch (e) {
    console.error(e);
  }
  if (prefijo === 'pd') renderPorcentajesDevueltos();
  if (prefijo === 'bg') renderBalanceGeneral();
}

// =================================================================
// 9. ADMINISTRACIÓN > % DEVUELTOS
// =================================================================
// Pinta UN bloque de % Devueltos a partir de un objeto `data` con la
// forma de siempre ({ porJugador, totalGeneral }). `sufijo` decide en
// qué ids pinta ('' = de siempre, grupo NO mixto; 'USD'/'BS' = bloque
// clonado, grupo mixto — ver asegurarBloquesPorcentajesMixto() más abajo)
// y también sirve de prefijo para los ids de "ver detalle" de cada fila,
// para que las 2 tablas (USD/Bs) no se pisen los mismos ids entre sí
// (18-09-2026, "moneda del grupo").
function pintarBloquePorcentajes(data, sufijo) {
  sufijo = sufijo || '';
  const totalEl = document.getElementById('pdTotalGeneral' + sufijo);
  if (totalEl) totalEl.textContent = formatMoney(data.totalGeneral);

  const tbody = document.querySelector('#tablaPorcentajesDevueltos' + sufijo + ' tbody');
  tbody.innerHTML = '';
  const nombres = Object.keys(data.porJugador).filter(n => data.porJugador[n].detalle.length > 0).sort();

  nombres.forEach((nombre, idx) => {
    const info = data.porJugador[nombre];
    const idKey = sufijo + idx;
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + nombre + '</td>' +
      '<td>' + formatMoney(info.total) + '</td>' +
      '<td><span class="detalle-toggle" onclick="togglePdDetalle(\'' + idKey + '\')">' + info.detalle.length + ' día(s) — ver detalle</span></td>';
    tbody.appendChild(tr);

    const trDetalle = document.createElement('tr');
    trDetalle.className = 'fila-detalle-expandida';
    trDetalle.id = 'pd-detalle-' + idKey;
    trDetalle.style.display = 'none';
    trDetalle.innerHTML = '<td colspan="3"><ul>' +
      info.detalle.map(d => '<li>' + d.fecha + ': propia ' + formatMoney(d.comisionPropia) + ' + avalados ' + formatMoney(d.comisionAval) + ' = <strong>' + formatMoney(d.total) + '</strong></li>').join('') +
      '</ul></td>';
    tbody.appendChild(trDetalle);
  });

  if (nombres.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#888;">Nadie tiene % devuelto en este rango.</td></tr>';
  }
}

// Construye, UNA sola vez, los 2 bloques de % Devueltos (USD/Bs) que se
// usan cuando el grupo está en modo 'mixto' — mismas columnas que
// #tablaPorcentajesDevueltos (clonando su <thead>).
function asegurarBloquesPorcentajesMixto() {
  const cont = document.getElementById('pdMixtoWrap');
  if (!cont || cont.dataset.armado) return;
  const filaEncabezado = document.querySelector('#tablaPorcentajesDevueltos thead tr').innerHTML;
  const bloque = (sufijo, titulo) =>
    '<div style="margin-top:18px;">' +
    '<h3 style="margin:0 0 6px; color:var(--accent-cyan);">' + titulo + '</h3>' +
    '<p style="margin:0 0 8px;">Total devuelto en el rango: <strong id="pdTotalGeneral' + sufijo + '" style="color:#facc15;">$0.00</strong></p>' +
    '<table id="tablaPorcentajesDevueltos' + sufijo + '" class="tabla-porcentajes-devueltos"><thead><tr>' + filaEncabezado + '</tr></thead><tbody></tbody></table>' +
    '</div>';
  cont.innerHTML = bloque('USD', '🇺🇸 Dólares (USD)') + bloque('BS', '🇻🇪 Bolívares (Bs)');
  cont.dataset.armado = '1';
}

async function renderPorcentajesDevueltos() {
  const desde = document.getElementById('pdDesde').value;
  const hasta = document.getElementById('pdHasta').value;
  if (!desde || !hasta) return;

  try {
    const data = await api('/api/reportes/porcentajes-devueltos?desde=' + desde + '&hasta=' + hasta);
    const bloqueNormal = document.getElementById('pdTablaWrapNormal');
    const bloqueMixto = document.getElementById('pdMixtoWrap');

    // "Moneda del Grupo" (18-09-2026, mixto) — data.mixto viene del
    // backend (ver routes/reportes.js); reutiliza pintarBloquePorcentajes()
    // 2 veces en vez de un camino de pintado aparte.
    if (data.mixto) {
      asegurarBloquesPorcentajesMixto();
      if (bloqueNormal) bloqueNormal.style.display = 'none';
      if (bloqueMixto) bloqueMixto.style.display = 'block';
      pintarBloquePorcentajes(data.USD, 'USD');
      pintarBloquePorcentajes(data.BS, 'BS');
    } else {
      if (bloqueMixto) bloqueMixto.style.display = 'none';
      if (bloqueNormal) bloqueNormal.style.display = '';
      pintarBloquePorcentajes(data, '');
    }
  } catch (e) {
    console.error(e);
  }
  cargarConfirmacionRango('pd', desde, hasta);
}

// `idKey` (18-09-2026, "moneda del grupo" mixto) — antes era solo el
// índice numérico de la fila ('pd-detalle-3'); ahora es el string
// completo que ya arma pintarBloquePorcentajes() (sufijo + índice, ej.
// 'USD3'), para que las filas del bloque normal y las de los 2 bloques
// USD/Bs nunca compartan el mismo id.
function togglePdDetalle(idKey) {
  const fila = document.getElementById('pd-detalle-' + idKey);
  if (fila) fila.style.display = fila.style.display === 'none' ? 'table-row' : 'none';
}

// =================================================================
// 10. ADMINISTRACIÓN > BALANCE GENERAL
// =================================================================

// "Saldo del grupo por día" (03-09-2026, a pedido del usuario). "dias"
// viene de data.porDia = [{fecha, balanceBanca}, ...] — vacío cuando el
// rango es más largo que el límite que puso el backend (ver
// calcularBalancePorDia() en balanceGeneral.js), en cuyo caso se oculta
// la tabla en vez de mostrarla vacía o a medias.
// `sufijo` (18-09-2026, "moneda del grupo" mixto) — '' pinta en los ids
// de siempre ("bgDesgloseDiario"...); 'USD'/'BS' pinta en la copia de
// ese mismo bloque que arma asegurarBloquesBalanceGeneralMixto() más
// abajo, para reutilizar esta función 2 veces sin duplicar su lógica.
function renderDesgloseDiarioBalance(dias, sufijo) {
  sufijo = sufijo || '';
  const caja = document.getElementById('bgDesgloseDiario' + sufijo);
  const filaDias = document.getElementById('bgDesgloseDiarioDias' + sufijo);
  const filaMontos = document.getElementById('bgDesgloseDiarioMontos' + sufijo);
  if (!caja || !filaDias || !filaMontos) return;

  if (!dias || dias.length === 0) {
    caja.style.display = 'none';
    return;
  }

  caja.style.display = 'block';
  filaDias.innerHTML = dias.map(d => '<th style="text-align:center; padding:6px 10px; white-space:nowrap;">' + etiquetaDiaCorta(d.fecha) + '</th>').join('');
  filaMontos.innerHTML = dias.map(d =>
    '<td style="text-align:center; padding:6px 10px; font-weight:bold; white-space:nowrap; color:' + (d.balanceBanca >= 0 ? '#27ae60' : '#c0392b') + ';">' + formatMoney(d.balanceBanca) + '</td>'
  ).join('');
}

// Pinta UN bloque completo de Balance General (stat de balance banca,
// desglose diario y la tabla de clientes con su fila TOTAL) a partir de
// un objeto `data` con la forma de siempre (balanceBanca, balanceBancaPolla,
// porDia, filas, filaTotal). `sufijo` decide EN QUÉ ids pinta: '' son los
// de siempre (grupo NO mixto); 'USD'/'BS' son los del bloque clonado
// correspondiente (grupo mixto, ver asegurarBloquesBalanceGeneralMixto()
// más abajo) — así esta misma función se reutiliza 2 veces en vez de
// duplicar toda esta lógica de pintado (18-09-2026, "moneda del grupo").
function pintarBloqueBalanceGeneral(data, sufijo, desde, hasta) {
  sufijo = sufijo || '';
  const bancaEl = document.getElementById('bgBalanceBanca' + sufijo);
  if (bancaEl) {
    bancaEl.textContent = formatMoney(data.balanceBanca);
    bancaEl.style.color = data.balanceBanca >= 0 ? '#27ae60' : '#c0392b';
  }

  // "Banca Polla" (02-09-2026, a pedido del usuario): se sigue
  // mostrando aparte como desglose informativo, pero "Balance de la
  // banca" de arriba YA la incluye (03-09-2026, ver balanceGeneral.js).
  const bancaPollaEl = document.getElementById('bgBalanceBancaPolla' + sufijo);
  if (bancaPollaEl) {
    bancaPollaEl.textContent = formatMoney(data.balanceBancaPolla || 0);
    bancaPollaEl.style.color = (data.balanceBancaPolla || 0) >= 0 ? '#27ae60' : '#c0392b';
  }

  renderDesgloseDiarioBalance(data.porDia || [], sufijo);

  const tbody = document.querySelector('#tablaBalanceGeneral' + sufijo + ' tbody');
  tbody.innerHTML = '';
  data.filas.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + f.cliente + '</td>' +
      '<td class="col-arriesgado">' + formatMoney(f.arriesgado) + '</td>' +
      '<td class="col-ganado">' + formatMoney(f.ganado) + '</td>' +
      '<td class="col-perdido">' + formatMoney(f.perdido) + '</td>' +
      '<td class="col-comision">' + formatMoney(f.comision) + '</td>' +
      '<td class="col-transferencias">' + formatMoney(f.transferencias) + '</td>' +
      '<td class="col-polla">' + formatMoney(f.polla || 0) + '</td>' +
      '<td class="col-saldo" style="font-weight:bold; color:' + (f.saldoCliente >= 0 ? '#27ae60' : '#c0392b') + ';">' + formatMoney(f.saldoCliente) + '</td>' +
      // "👁️ Ver" (02-09-2026, a pedido del usuario): abre el mismo modal
      // de "📖 Historial" (tickets + Polla), precargado con el rango que
      // se está viendo acá — antes no había ninguna forma de ver el
      // detalle de un cliente desde Balance General, así que un cliente
      // que solo juega Polla mostraba su saldo pero ningún clic
      // explicaba de dónde salía.
      '<td class="col-ver"><button type="button" class="btn-chico btn-secundario" onclick="abrirHistorialCliente(\'' + f.cliente.replace(/'/g, "\\'") + '\', \'' + desde + '\', \'' + hasta + '\')">👁️ Ver</button></td>';
    tbody.appendChild(tr);
  });
  if (data.filas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#888;">Sin movimientos en este rango.</td></tr>';
  }

  // Fila de "TOTAL" (03-09-2026, a pedido del usuario): la Polla de
  // cada cliente ya estaba adentro de su "Saldo Cliente" — lo que
  // faltaba era una fila que sumara TODA la tabla (incluida la Polla)
  // en un solo número al final, en blanco/resaltado para que se
  // distinga de las filas de clientes normales.
  if (data.filaTotal && data.filas.length > 0) {
    const t = data.filaTotal;
    const trTotal = document.createElement('tr');
    trTotal.className = 'fila-total-balance';
    // Arreglo (15-09-2026, misma familia de bug que el chip de apodos:
    // fondo claro sin color de texto propio → hereda el blanco del
    // tema oscuro y queda ilegible). Fondo celeste clarito + texto
    // azul oscuro, y el borde superior pasa del gris genérico al azul
    // de acento de Ludox.
    trTotal.style.cssText = 'background:#eaf6ff; color:#0d1326; font-weight:bold; border-top:2px solid #2f6bff;';
    trTotal.innerHTML =
      '<td>TOTAL</td>' +
      '<td class="col-arriesgado">' + formatMoney(t.arriesgado) + '</td>' +
      '<td class="col-ganado">' + formatMoney(t.ganado) + '</td>' +
      '<td class="col-perdido">' + formatMoney(t.perdido) + '</td>' +
      '<td class="col-comision">' + formatMoney(t.comision) + '</td>' +
      '<td class="col-transferencias">' + formatMoney(t.transferencias) + '</td>' +
      '<td class="col-polla">' + formatMoney(t.polla || 0) + '</td>' +
      '<td class="col-saldo" style="color:' + (t.saldoCliente >= 0 ? '#27ae60' : '#c0392b') + ';">' + formatMoney(t.saldoCliente) + '</td>' +
      '<td class="col-ver"></td>';
    tbody.appendChild(trTotal);
  }
}

// Construye, UNA sola vez, los 2 bloques de Balance General (USD/Bs) que
// se usan cuando el grupo está en modo 'mixto' — clona el <thead> de
// #tablaBalanceGeneral (mismas columnas) y arma el mismo mini-stat de
// "Balance de la banca"/"Banca Polla" y el mismo desglose diario que ya
// tiene el bloque normal, con ids con sufijo "USD"/"BS" para que
// pintarBloqueBalanceGeneral()/renderDesgloseDiarioBalance() los puedan
// pintar sin tocar nada del bloque normal. NO incluye el botón "📸
// Capturar tabla como imagen" — decisión propia por alcance, ver el
// comentario junto a "bgTablaWrapNormal" en grupo.html.
function asegurarBloquesBalanceGeneralMixto() {
  const cont = document.getElementById('bgMixtoWrap');
  if (!cont || cont.dataset.armado) return;
  const filaEncabezado = document.querySelector('#tablaBalanceGeneral thead tr').innerHTML;
  const bloque = (sufijo, titulo) =>
    '<div style="margin-top:22px; padding-top:14px; border-top:1px solid var(--card-border);">' +
    '<h3 style="margin:0 0 10px; color:var(--accent-cyan);">' + titulo + '</h3>' +
    '<div style="display:flex; flex-wrap:wrap; gap:24px; margin-bottom:10px;">' +
    '<div><label style="display:block;">Balance de la banca:</label><p id="bgBalanceBanca' + sufijo + '" style="margin:0; font-size:18px; font-weight:bold;">$0.00</p></div>' +
    '<div><label style="display:block;">— de eso, Banca Polla:</label><p id="bgBalanceBancaPolla' + sufijo + '" style="margin:0; font-size:18px; font-weight:bold;">$0.00</p></div>' +
    '</div>' +
    '<div id="bgDesgloseDiario' + sufijo + '" style="display:none; margin:10px 0; overflow-x:auto; overflow-y:hidden;">' +
    '<table style="min-width:100%; width:auto;"><thead><tr id="bgDesgloseDiarioDias' + sufijo + '"></tr></thead><tbody><tr id="bgDesgloseDiarioMontos' + sufijo + '"></tr></tbody></table>' +
    '</div>' +
    '<table id="tablaBalanceGeneral' + sufijo + '" class="tabla-balance-general" style="margin-top:10px;"><thead><tr>' + filaEncabezado + '</tr></thead><tbody></tbody></table>' +
    '</div>';
  cont.innerHTML = bloque('USD', '🇺🇸 Dólares (USD)') + bloque('BS', '🇻🇪 Bolívares (Bs)');
  cont.dataset.armado = '1';
}

async function renderBalanceGeneral() {
  const desde = document.getElementById('bgDesde').value;
  const hasta = document.getElementById('bgHasta').value;
  if (!desde || !hasta) return;

  try {
    const data = await api('/api/reportes/balance-general?desde=' + desde + '&hasta=' + hasta);
    const bloqueNormal = document.getElementById('bgTablaWrapNormal');
    const bloqueMixto = document.getElementById('bgMixtoWrap');

    // "Moneda del Grupo" (18-09-2026, mixto) — data.mixto viene del
    // backend (ver routes/reportes.js); cuando es true, data.USD/data.BS
    // ya traen la forma NORMAL completa (balanceBanca, porDia, filas,
    // filaTotal...) cada uno, así que se reutiliza pintarBloqueBalanceGeneral()
    // 2 veces en vez de un tercer camino de pintado.
    if (data.mixto) {
      asegurarBloquesBalanceGeneralMixto();
      if (bloqueNormal) bloqueNormal.style.display = 'none';
      if (bloqueMixto) bloqueMixto.style.display = 'block';
      pintarBloqueBalanceGeneral(data.USD, 'USD', desde, hasta);
      pintarBloqueBalanceGeneral(data.BS, 'BS', desde, hasta);
    } else {
      if (bloqueMixto) bloqueMixto.style.display = 'none';
      if (bloqueNormal) bloqueNormal.style.display = '';
      pintarBloqueBalanceGeneral(data, '', desde, hasta);
    }
    aplicarVisibilidadColumnasBalance();
  } catch (e) {
    console.error(e);
  }
  cargarConfirmacionRango('bg', desde, hasta);
}

// =================================================================
// Resumen de confirmación de un RANGO (01-09-2026, a pedido del usuario)
// — usado por % Devueltos y Balance General. A diferencia del badge de
// la pestaña Sábana (que es por UNA fecha), acá se resume un RANGO
// completo: "todo lo que hay en este rango ya quedó confirmado" o
// "todavía falta confirmar N día(s)" (con la lista, para que se sepa
// cuáles). Un rango sin ningún día con sábana procesada no muestra nada
// — no hay nada que confirmar.
// =================================================================
async function cargarConfirmacionRango(prefijo, desde, hasta) {
  const caja = document.getElementById(prefijo + 'ConfirmacionRango');
  if (!caja) return;
  try {
    const resumen = await api('/api/reportes/confirmacion-rango?desde=' + desde + '&hasta=' + hasta);
    if (resumen.totalDias === 0) { caja.style.display = 'none'; return; }
    caja.style.display = 'block';
    if (resumen.fechasSinConfirmar.length === 0) {
      caja.innerHTML = '<span class="banner-confirmacion-rango ok">✅ Los ' + resumen.totalDias + ' día(s) con sábana procesada de este rango ya están confirmados ("💾 Guardar Día") — estos números no deberían cambiar.</span>';
    } else {
      caja.innerHTML = '<span class="banner-confirmacion-rango aviso">⚠️ ' + resumen.fechasSinConfirmar.length + ' de ' + resumen.totalDias +
        ' día(s) de este rango todavía NO están confirmados (' + resumen.fechasSinConfirmar.join(', ') +
        ') — si vuelves a procesar esas fechas, estos números pueden cambiar.</span>';
    }
  } catch (e) {
    caja.style.display = 'none';
  }
}

const COLUMNAS_BALANCE = [
  ['bgColArriesgado', 'col-arriesgado'],
  ['bgColGanado', 'col-ganado'],
  ['bgColPerdido', 'col-perdido'],
  ['bgColComision', 'col-comision'],
  ['bgColTransferencias', 'col-transferencias'],
  ['bgColPolla', 'col-polla'],
  ['bgColSaldo', 'col-saldo']
];

function actualizarColumnasBalance() {
  const estado = {};
  COLUMNAS_BALANCE.forEach(([checkboxId]) => { estado[checkboxId] = document.getElementById(checkboxId).checked; });
  localStorage.setItem('zenyatta_bg_columnas', JSON.stringify(estado));
  aplicarVisibilidadColumnasBalance();
}

function cargarColumnasBalanceGuardadas() {
  let estado = {};
  try { estado = JSON.parse(localStorage.getItem('zenyatta_bg_columnas') || '{}'); } catch (e) { estado = {}; }
  COLUMNAS_BALANCE.forEach(([checkboxId]) => {
    const cb = document.getElementById(checkboxId);
    if (cb && Object.prototype.hasOwnProperty.call(estado, checkboxId)) cb.checked = estado[checkboxId];
  });
  aplicarVisibilidadColumnasBalance();
}

function aplicarVisibilidadColumnasBalance() {
  COLUMNAS_BALANCE.forEach(([checkboxId, claseColumna]) => {
    const visible = document.getElementById(checkboxId) ? document.getElementById(checkboxId).checked : true;
    // Selector generalizado (18-09-2026, "moneda del grupo" mixto): antes
    // apuntaba solo a "#tablaBalanceGeneral .clase"; ahora usa la clase
    // compartida ".tabla-balance-general" para afectar por igual a la
    // tabla única (grupo NO mixto) y a las 2 tablas USD/Bs armadas por
    // asegurarBloquesBalanceGeneralMixto() (grupo mixto).
    document.querySelectorAll('.tabla-balance-general .' + claseColumna).forEach(el => {
      el.style.display = visible ? '' : 'none';
    });
  });
}

// =================================================================
// "📸 Capturar tabla como imagen (HD)" (02-09-2026, a pedido del
// usuario): convierte la tabla #tablaBalanceGeneral, TAL COMO SE VE en
// pantalla ahora mismo (respeta qué columnas están marcadas — ver
// aplicarVisibilidadColumnasBalance de arriba), en una imagen PNG, con un
// botón para copiarla directo al portapapeles (lista para pegar en
// WhatsApp Web/Desktop con Ctrl+V) o descargarla. Usa html2canvas (CDN,
// cargado en index.html) — 100% del lado del navegador, sin pedirle nada
// nuevo al backend, así que la imagen sale exactamente igual a lo que el
// usuario tiene delante.
// =================================================================
let ULTIMA_CAPTURA_BALANCE_BLOB = null;
let ULTIMA_CAPTURA_BALANCE_URL = null;

function cerrarCapturaBalance() {
  document.getElementById('modalCapturaBalance').classList.remove('activo');
}

async function capturarTablaBalanceComoImagen() {
  const modal = document.getElementById('modalCapturaBalance');
  const estado = document.getElementById('capturaBalanceEstado');
  const img = document.getElementById('capturaBalanceImg');
  const btnCopiar = document.getElementById('btnCopiarCapturaBalance');
  const btnDescargar = document.getElementById('btnDescargarCapturaBalance');

  modal.classList.add('activo');
  estado.textContent = 'Generando imagen...';
  img.style.display = 'none';
  btnCopiar.disabled = true;
  btnDescargar.disabled = true;
  ULTIMA_CAPTURA_BALANCE_BLOB = null;

  if (typeof html2canvas !== 'function') {
    // Se pide de un CDN (ver index.html) — si el navegador no tenía
    // internet en este momento (o algo lo bloqueó), avisamos claro en vez
    // de fallar en silencio o con un error críptico de JS.
    estado.textContent = '⚠️ No se pudo cargar la herramienta para generar la imagen (revisa tu conexión a internet y vuelve a intentar).';
    return;
  }

  const tabla = document.getElementById('tablaBalanceGeneral');
  // Arreglo (16-09-2026, a pedido del usuario, con captura: "mira como
  // vienen" — las filas de clientes salían casi invisibles en la imagen
  // de Balance General). A diferencia de la "foto" de Sábana (que vive
  // en su PROPIA caja blanca aparte, #sabanasCapturaContenido), esta
  // tabla es la MISMA que se ve en pantalla en modo oscuro — html2canvas
  // le fuerza un fondo blanco al CANVAS final, pero las celdas normales
  // (sin color propio, pensadas para fondo oscuro) y el botón "👁️ Ver"
  // (fondo translúcido + texto casi blanco) se quedaban invisibles sobre
  // ese blanco. No se le puede poner un color fijo a la tabla porque
  // rompería la vista en pantalla — se le agrega la clase
  // "capturando-imagen" SOLO mientras dura esta captura (con sus propias
  // reglas de contraste, ver el CSS en grupo.html) y se quita apenas
  // termina, haya salido bien o mal.
  tabla.classList.add('capturando-imagen');
  try {
    // scale:3 = resolución 3x — "lo más HD posible" (pedido explícito del
    // usuario) sin depender de la resolución de pantalla de quien lo usa.
    const canvas = await html2canvas(tabla, { scale: 3, backgroundColor: '#ffffff', useCORS: true });
    canvas.toBlob(blob => {
      if (!blob) {
        estado.textContent = '⚠️ No se pudo generar la imagen. Intenta de nuevo.';
        return;
      }
      ULTIMA_CAPTURA_BALANCE_BLOB = blob;
      if (ULTIMA_CAPTURA_BALANCE_URL) URL.revokeObjectURL(ULTIMA_CAPTURA_BALANCE_URL);
      ULTIMA_CAPTURA_BALANCE_URL = URL.createObjectURL(blob);
      img.src = ULTIMA_CAPTURA_BALANCE_URL;
      img.style.display = 'inline-block';
      estado.textContent = '✅ Imagen lista — cópiala o descárgala.';
      btnCopiar.disabled = false;
      btnDescargar.disabled = false;
    }, 'image/png');
  } catch (e) {
    estado.textContent = '⚠️ No se pudo generar la imagen: ' + e.message;
  } finally {
    tabla.classList.remove('capturando-imagen');
  }
}

async function copiarCapturaBalance() {
  if (!ULTIMA_CAPTURA_BALANCE_BLOB) return;
  // ClipboardItem con imagen no está soportado en TODOS los navegadores
  // (ej. Firefox históricamente no) — si falla, se avisa y se sugiere
  // "Descargar imagen" como alternativa segura, en vez de dejar al
  // usuario sin saber qué pasó.
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      throw new Error('Este navegador no soporta copiar imágenes al portapapeles.');
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': ULTIMA_CAPTURA_BALANCE_BLOB })]);
    alert('¡Imagen copiada! Ya la puedes pegar (Ctrl+V) en WhatsApp Web o Desktop.');
  } catch (e) {
    alert('No se pudo copiar automáticamente (' + e.message + '). Usa "⬇️ Descargar imagen" y adjúntala a mano.');
  }
}

function descargarCapturaBalance() {
  if (!ULTIMA_CAPTURA_BALANCE_BLOB) return;
  const desde = document.getElementById('bgDesde') ? document.getElementById('bgDesde').value : '';
  const hasta = document.getElementById('bgHasta') ? document.getElementById('bgHasta').value : '';
  const nombreArchivo = 'balance-general' + (desde ? '_' + desde : '') + (hasta ? '_a_' + hasta : '') + '.png';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(ULTIMA_CAPTURA_BALANCE_BLOB);
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// =================================================================
// 11. ADMINISTRACIÓN > TRANSFERENCIAS
// =================================================================
async function cargarTransferencias() {
  try {
    const lista = await api('/api/transferencias');
    const tbody = document.querySelector('#tablaTransferencias tbody');
    tbody.innerHTML = '';
    lista.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + t.fecha + '</td>' +
        '<td>' + t.cliente_origen + '</td>' +
        '<td>' + t.cliente_destino + '</td>' +
        '<td>' + formatMoney(t.monto) + '</td>' +
        '<td>' + (t.nota || '—') + '</td>' +
        '<td><button type="button" class="btn-chico btn-peligro" onclick="eliminarTransferencia(\'' + t.id + '\')">🗑️</button></td>';
      tbody.appendChild(tr);
    });
    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888;">Sin transferencias todavía.</td></tr>';
    }
  } catch (e) {
    console.error(e);
  }
}

async function guardarTransferencia() {
  const fecha = document.getElementById('transferFecha').value || hoyISO();
  const clienteOrigen = document.getElementById('transferOrigen').value;
  const clienteDestino = document.getElementById('transferDestino').value;
  const monto = document.getElementById('transferMonto').value;
  const nota = document.getElementById('transferNota').value.trim();

  try {
    await api('/api/transferencias', { method: 'POST', body: JSON.stringify({ fecha, clienteOrigen, clienteDestino, monto: Number(monto), nota }) });
    document.getElementById('transferMonto').value = '';
    document.getElementById('transferNota').value = '';
    cargarTransferencias();
  } catch (e) {
    alert('No se pudo guardar la transferencia: ' + e.message);
  }
}

async function eliminarTransferencia(id) {
  if (!confirm('¿Eliminar esta transferencia?')) return;
  try {
    await api('/api/transferencias/' + id, { method: 'DELETE' });
    cargarTransferencias();
  } catch (e) {
    alert('No se pudo eliminar: ' + e.message);
  }
}

// =================================================================
// 12. ADMINISTRACIÓN > POLLA (02-09-2026, a pedido del usuario) — juego
// aparte de la sábana, ver src/services/polla.js. El admin pega el
// resultado ya calculado (una línea por cliente, "nombre monto") + la
// fecha, y el panel muestra qué se guardó, qué nombre no matcheó ningún
// cliente registrado (para corregir el texto), y la lista guardada de
// esa fecha para poder revisarla o borrar una fila puntual.
// =================================================================
async function procesarPolla() {
  const fecha = document.getElementById('pollaFecha').value || hoyISO();
  const texto = document.getElementById('pollaTexto').value;
  const resultadoEl = document.getElementById('pollaResultado');
  if (!texto || !texto.trim()) { alert('Pega el resultado de la polla antes de procesar.'); return; }

  resultadoEl.style.display = 'none';
  try {
    const data = await api('/api/polla/procesar', { method: 'POST', body: JSON.stringify({ fecha, texto }) });
    let html = '<strong>' + data.guardadas.length + ' cliente(s) guardado(s)</strong> para ' + fecha + '.';
    if (data.guardadas.length > 0) {
      html += '<ul>' + data.guardadas.map(g => '<li>' + g.cliente + ': ' + formatMoney(g.monto) + '</li>').join('') + '</ul>';
    }
    if (data.noEncontrados && data.noEncontrados.length > 0) {
      html += '<p style="color:#c0392b;">⚠️ Estos nombres NO coinciden con ningún cliente registrado y NO se guardaron: <strong>' +
        data.noEncontrados.join(', ') + '</strong>. Revisa el nombre (tiene que ser igual al del cliente en "Jugador") y vuelve a pegar el texto.</p>';
    }
    if (data.ignoradas && data.ignoradas.length > 0) {
      html += '<p style="color:#888;">Líneas ignoradas (no tenían el formato "nombre monto"): ' + data.ignoradas.map(l => '"' + l + '"').join(', ') + '</p>';
    }
    resultadoEl.innerHTML = html;
    resultadoEl.style.display = 'block';
    document.getElementById('pollaTexto').value = '';
    cargarPolla();
  } catch (e) {
    resultadoEl.innerHTML = '<span style="color:#c0392b;">No se pudo procesar la polla: ' + e.message + '</span>';
    resultadoEl.style.display = 'block';
  }
}

async function cargarPolla() {
  const fecha = document.getElementById('pollaFecha').value;
  try {
    const url = fecha ? '/api/polla?desde=' + fecha + '&hasta=' + fecha : '/api/polla';
    const lista = await api(url);
    const tbody = document.querySelector('#tablaPolla tbody');
    tbody.innerHTML = '';
    lista.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + p.fecha + '</td>' +
        '<td>' + p.cliente + '</td>' +
        '<td style="color:' + (p.monto >= 0 ? '#27ae60' : '#c0392b') + '; font-weight:bold;">' + formatMoney(p.monto) + '</td>' +
        '<td><button type="button" class="btn-chico btn-peligro" onclick="eliminarPolla(\'' + p.id + '\')">🗑️</button></td>';
      tbody.appendChild(tr);
    });
    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888;">Sin polla guardada' + (fecha ? ' en ' + fecha : '') + '.</td></tr>';
    }
  } catch (e) {
    console.error(e);
  }
}

async function eliminarPolla(id) {
  if (!confirm('¿Eliminar esta fila de la polla?')) return;
  try {
    await api('/api/polla/' + id, { method: 'DELETE' });
    cargarPolla();
  } catch (e) {
    alert('No se pudo eliminar: ' + e.message);
  }
}

// =================================================================
// 13. ADMINISTRACIÓN > SÁBANAS (02-09-2026, a pedido del usuario, ampliado
// 03-09-2026) — ver la nota grande en src/services/sabanaDia.js. Muestra
// la sábana YA PROCESADA de una fecha puntual (tickets + polla,
// reconstruidos desde lo guardado; el ESTADO de cada ticket sale siempre
// de la base, nunca se recalcula), lista para generarla como imagen o
// PDF (foto para copiar/enviar por WhatsApp) o para editar un ticket a
// mano si hizo falta corregir algo. Columnas elegibles por checkbox
// (igual que Balance General) para poder mandar solo lo que se quiera
// mostrar; cada jugada trae el ícono del equipo (reutiliza
// logoEquipoHTML(), igual que la tabla de Resultados de "📋 Sábana"); la
// pizarra ahora trae el marcador REAL de los juegos de esa sábana
// (arriba) + cómo salieron los clientes (abajo, mismas tarjetas de
// antes).
// =================================================================
let ULTIMA_SABANA_DIA = null;
let ULTIMA_CAPTURA_SABANA_BLOB = null;
let ULTIMA_CAPTURA_SABANA_URL = null;

async function cargarSabanaDia() {
  const fecha = document.getElementById('sabanasFecha').value;
  const areaVacio = document.getElementById('sabanasVacio');
  const areaCaptura = document.getElementById('sabanasCapturaArea');
  if (!fecha) return;

  try {
    const sabana = await api('/api/sabana/dia?fecha=' + fecha);
    ULTIMA_SABANA_DIA = sabana;

    if (sabana.tickets.length === 0 && sabana.polla.length === 0) {
      areaVacio.style.display = 'block';
      areaCaptura.style.display = 'none';
      return;
    }
    areaVacio.style.display = 'none';
    areaCaptura.style.display = 'block';
    document.getElementById('sabanasTituloFecha').textContent = fecha;
    renderTablaSabanaDia(sabana.tickets);
    renderTablaSabanaDiaPolla(sabana.polla);
    renderJuegosSabanaDia(sabana.juegos);

    // "Moneda del Grupo" (18-09-2026, mixto) — mismo criterio que
    // pintarResultadoSabana() (Sábana/Procesar): si el grupo está en modo
    // 'mixto', GET /api/sabana/dia trae "porMoneda" y se pintan 2
    // bloques de "Resultados de los Clientes" (USD/Bs) reutilizando la
    // MISMA renderPizarraSabanaDia() de siempre, apuntando a un
    // contenedor distinto cada vez.
    const pizarraNormal = document.getElementById('pizarraSabanaDia');
    const pizarraMixtoWrap = document.getElementById('pizarraSabanaDiaMixtoWrap');
    if (sabana.porMoneda) {
      if (pizarraNormal) pizarraNormal.style.display = 'none';
      if (pizarraMixtoWrap) pizarraMixtoWrap.style.display = 'block';
      renderPizarraSabanaDia(sabana.porMoneda.USD.filas, 'pizarraSabanaDiaUSD');
      renderPizarraSabanaDia(sabana.porMoneda.BS.filas, 'pizarraSabanaDiaBS');
    } else {
      if (pizarraNormal) pizarraNormal.style.display = 'flex';
      if (pizarraMixtoWrap) pizarraMixtoWrap.style.display = 'none';
      renderPizarraSabanaDia(sabana.resumenPorCliente);
    }
    aplicarVisibilidadColumnasSabanaDia();
  } catch (e) {
    alert('No se pudo cargar la sábana de esa fecha: ' + e.message);
  }
}

// =================================================================
// "Eliminar sábanas" con Papelera recuperable (03-09-2026, a pedido del
// usuario) — ver la nota grande en services/papeleraSabana.js. Dos
// paneles plegables dentro de la pestaña Sábanas: uno para elegir (con
// casillas) los días a eliminar, otro para ver/restaurar la Papelera.
// =================================================================
async function abrirPanelEliminarSabanas() {
  const panel = document.getElementById('panelEliminarSabanas');
  const panelPapelera = document.getElementById('panelPapelera');
  panelPapelera.style.display = 'none';
  const abrir = panel.style.display === 'none';
  panel.style.display = abrir ? 'block' : 'none';
  if (abrir) await cargarListaFechasEliminarSabana();
}

async function cargarListaFechasEliminarSabana() {
  const cont = document.getElementById('listaFechasEliminar');
  const vacio = document.getElementById('listaFechasEliminarVacio');
  cont.innerHTML = '<p style="color:#888; font-size:13px;">Cargando...</p>';
  try {
    const fechas = await api('/api/sabana/fechas-con-datos');
    if (fechas.length === 0) {
      cont.innerHTML = '';
      vacio.style.display = 'block';
      return;
    }
    vacio.style.display = 'none';
    cont.innerHTML = fechas.map(f =>
      '<label style="font-weight:normal; display:flex; align-items:center; gap:8px; font-size:13px; padding:4px 0; border-bottom:1px solid #f3e3e3;">' +
      '<input type="checkbox" class="chk-fecha-eliminar" value="' + f.fecha + '" style="width:auto;"> ' +
      '<strong>' + f.fecha + '</strong> — ' + f.tickets + ' ticket(s), ' + f.polla + ' fila(s) de polla' +
      '</label>'
    ).join('');
  } catch (e) {
    cont.innerHTML = '<p style="color:#c0392b; font-size:13px;">No se pudo cargar la lista: ' + e.message + '</p>';
  }
}

async function confirmarEliminarSabanasSeleccionadas() {
  const marcadas = Array.from(document.querySelectorAll('.chk-fecha-eliminar:checked')).map(c => c.value);
  if (marcadas.length === 0) {
    alert('Marca al menos un día para eliminar.');
    return;
  }
  if (!confirm('¿Eliminar la sábana de ' + marcadas.length + ' día(s) (' + marcadas.join(', ') + ')?\n\nQueda recuperable en la Papelera durante 30 días — esto NO borra nada para siempre todavía.')) return;

  try {
    const resultado = await api('/api/sabana/eliminar-fechas', { method: 'POST', body: JSON.stringify({ fechas: marcadas }) });
    alert('Se eliminó la sábana de ' + resultado.fechas.length + ' día(s) (' + resultado.ticketsBorrados + ' ticket(s), ' + resultado.pollaBorrada + ' fila(s) de polla). Se generó una alerta y queda recuperable en la Papelera.');
    await cargarListaFechasEliminarSabana();
    // Si la fecha que se está viendo en este momento fue una de las
    // eliminadas, se refresca para que deje de mostrar datos borrados.
    const fechaActual = document.getElementById('sabanasFecha').value;
    if (fechaActual && marcadas.includes(fechaActual)) cargarSabanaDia();
  } catch (e) {
    alert('No se pudo eliminar: ' + e.message);
  }
}

async function abrirPanelPapelera() {
  const panel = document.getElementById('panelPapelera');
  const panelEliminar = document.getElementById('panelEliminarSabanas');
  panelEliminar.style.display = 'none';
  const abrir = panel.style.display === 'none';
  panel.style.display = abrir ? 'block' : 'none';
  if (abrir) await cargarListaPapelera();
}

async function cargarListaPapelera() {
  const cont = document.getElementById('listaPapelera');
  const vacio = document.getElementById('listaPapeleraVacio');
  cont.innerHTML = '<p style="color:#888; font-size:13px;">Cargando...</p>';
  try {
    const filas = await api('/api/sabana/papelera');
    if (filas.length === 0) {
      cont.innerHTML = '';
      vacio.style.display = 'block';
      return;
    }
    vacio.style.display = 'none';
    cont.innerHTML = filas.map(f => {
      const estado = f.restaurado
        ? '<span style="color:#27ae60;">✅ ya restaurada</span>'
        : '<span style="color:#a33;">⏳ se borra para siempre en ' + f.diasRestantes + ' día(s)</span>';
      const boton = f.restaurado ? '' : '<button type="button" class="btn-chico" onclick="restaurarSabanaPapelera(\'' + f.id + '\')" style="background:#27ae60;">♻️ Restaurar</button>';
      return '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; padding:6px 0; border-bottom:1px solid #f3e3e3; flex-wrap:wrap;">' +
        '<div><strong>' + f.fecha + '</strong> — ' + f.tickets + ' ticket(s), ' + f.polla + ' fila(s) de polla<br>' + estado + '</div>' +
        boton +
        '</div>';
    }).join('');
  } catch (e) {
    cont.innerHTML = '<p style="color:#c0392b; font-size:13px;">No se pudo cargar la Papelera: ' + e.message + '</p>';
  }
}

async function restaurarSabanaPapelera(id) {
  if (!confirm('¿Restaurar esta sábana? Vuelve a quedar como estaba antes de eliminarla.')) return;
  try {
    const resultado = await api('/api/sabana/papelera/' + id + '/restaurar', { method: 'POST' });
    alert('Se restauró la sábana del día ' + resultado.fecha + ' (' + resultado.ticketsRestaurados + ' ticket(s), ' + resultado.pollaRestaurada + ' fila(s) de polla).');
    await cargarListaPapelera();
    await cargarListaFechasEliminarSabana();
    const fechaActual = document.getElementById('sabanasFecha').value;
    if (fechaActual === resultado.fecha) cargarSabanaDia();
  } catch (e) {
    alert('No se pudo restaurar: ' + e.message);
  }
}

// Columnas elegibles del ticket (mismo patrón que Balance General, ver
// COLUMNAS_BALANCE/actualizarColumnasBalance más abajo) — a pedido del
// usuario: "quiero poder seleccionar que quiero enviar, si quiero dejar
// numero de ticket si quiero dejar solo saldos etc". El cliente siempre
// se muestra; lo demás es opcional. Se guarda en localStorage, por eso
// mostrarVista('sabanas') llama cargarColumnasSabanaDiaGuardadas() antes
// de pedir la sábana.
const COLUMNAS_SABANA_DIA = [
  ['sbColTicket', 'col-sb-ticket'],
  ['sbColDetalle', 'col-sb-detalle'],
  ['sbColArriesga', 'col-sb-arriesga'],
  ['sbColGana', 'col-sb-gana'],
  ['sbColEstado', 'col-sb-estado']
];

function actualizarColumnasSabanaDia() {
  const estado = {};
  COLUMNAS_SABANA_DIA.forEach(([checkboxId]) => { estado[checkboxId] = document.getElementById(checkboxId).checked; });
  localStorage.setItem('zenyatta_sabanas_columnas', JSON.stringify(estado));
  aplicarVisibilidadColumnasSabanaDia();
}

function cargarColumnasSabanaDiaGuardadas() {
  let estado = {};
  try { estado = JSON.parse(localStorage.getItem('zenyatta_sabanas_columnas') || '{}'); } catch (e) { estado = {}; }
  COLUMNAS_SABANA_DIA.forEach(([checkboxId]) => {
    const cb = document.getElementById(checkboxId);
    if (cb && Object.prototype.hasOwnProperty.call(estado, checkboxId)) cb.checked = estado[checkboxId];
  });
  aplicarVisibilidadColumnasSabanaDia();
}

function aplicarVisibilidadColumnasSabanaDia() {
  COLUMNAS_SABANA_DIA.forEach(([checkboxId, claseColumna]) => {
    const visible = document.getElementById(checkboxId) ? document.getElementById(checkboxId).checked : true;
    document.querySelectorAll('#tablaSabanaDia .' + claseColumna).forEach(el => {
      el.style.display = visible ? '' : 'none';
    });
  });
}

function renderTablaSabanaDia(tickets) {
  const tbody = document.querySelector('#tablaSabanaDia tbody');
  tbody.innerHTML = tickets.map(t => {
    const claseEstado = CLASE_ESTADO[t.estado] || '';
    // Cada jugada con su ícono de equipo (03-09-2026, a pedido del
    // usuario) — reutiliza logoEquipoHTML(), igual que la tabla de
    // Resultados de "📋 Sábana". t.jugadas viene del backend ya separado
    // en patas, cada una con equipoOficial/logoUrl si se pudo detectar
    // (ver sabanaDia.js); si por lo que sea no viniera, se cae al texto
    // plano de "detalle" para no dejar la celda vacía.
    const jugadasHTML = (t.jugadas && t.jugadas.length > 0)
      ? t.jugadas.map(j => '<div class="fila-jugada">' + logoEquipoHTML(j.equipoOficial, j.logoUrl) + '<span>' + j.texto + '</span></div>').join('')
      : (t.detalle || '');
    return '<tr class="' + claseEstado + '">' +
      '<td>' + t.cliente + '</td>' +
      '<td class="col-sb-ticket">' + (t.ticket || '') + '</td>' +
      '<td class="col-sb-detalle">' + jugadasHTML + '</td>' +
      '<td class="col-sb-arriesga">' + formatMoney(t.arriesga) + '</td>' +
      '<td class="col-sb-gana">' + formatMoney(t.gana) + '</td>' +
      '<td class="col-sb-estado ' + claseEstado + '">' + t.estado + '</td>' +
      '<td><button type="button" class="btn-chico" onclick="editarTicketSabana(\'' + t.id + '\')">✏️ Editar</button></td>' +
      '</tr>';
  }).join('');
}

function renderTablaSabanaDiaPolla(polla) {
  const bloque = document.getElementById('sabanasPollaBloque');
  if (!polla || polla.length === 0) { bloque.style.display = 'none'; return; }
  bloque.style.display = 'block';
  const tbody = document.querySelector('#tablaSabanaDiaPolla tbody');
  tbody.innerHTML = polla.map(p =>
    '<tr><td>' + p.cliente + '</td>' +
    '<td style="color:' + (p.monto >= 0 ? '#27ae60' : '#c0392b') + '; font-weight:bold;">' + formatMoney(p.monto) + '</td></tr>'
  ).join('');
}

// "🏟️ Resultados de los Juegos" (03-09-2026, corregido a pedido del
// usuario — antes acá se mostraba un resumen de tickets, no partidos:
// "en pizarra de resultados me referia a como quedaron los juegos...
// coloca los resultados de los juegos que jugaron en esa sabana").
// `sabana.juegos` ya viene filtrado desde el backend a solo los partidos
// que tienen algún equipo detectado en las jugadas de esa sábana (ver
// sabanaDia.js) — se dibuja con la MISMA tarjeta que ya usa la Pizarra
// en Vivo de "📋 Sábana" (renderJuegoCard(), reconoce el campo
// `deporte` de cada juego).
function renderJuegosSabanaDia(juegos) {
  const cont = document.getElementById('juegosSabanaDia');
  if (!juegos || juegos.length === 0) {
    cont.innerHTML = '<p style="color:#888;">No se encontró el partido de ninguna jugada de esta sábana (puede pasar con equipos fuera de temporada, o si el deporte todavía no tiene API conectada).</p>';
    return;
  }
  cont.innerHTML = juegos.map(renderJuegoCard).join('');
}

// "👥 Resultados de los Clientes": una tarjeta por cliente con lo que YA
// quedó guardado en cada ticket (cuántos ganó/perdió/quedaron
// pendientes) más la polla si jugó.
// `containerId` (18-09-2026, "moneda del grupo" mixto) — por defecto
// pinta en el contenedor de siempre ("pizarraSabanaDia"), pero se puede
// apuntar a otro (ej. "pizarraSabanaDiaUSD") para reutilizar esta misma
// función 2 veces cuando el grupo está en modo mixto — ver
// cargarSabanaDia() más arriba.
function renderPizarraSabanaDia(resumenPorCliente, containerId) {
  const cont = document.getElementById(containerId || 'pizarraSabanaDia');
  if (!resumenPorCliente || resumenPorCliente.length === 0) {
    cont.innerHTML = '<p style="color:#888;">Sin clientes esta fecha.</p>';
    return;
  }
  cont.innerHTML = resumenPorCliente.map(c => {
    const netoSabana = c.ganado - c.perdido;
    const netoTotal = netoSabana + (c.polla || 0);
    const color = netoTotal > 0 ? '#eefaf1' : (netoTotal < 0 ? '#fdecea' : '#f4f6f9');
    const borde = netoTotal > 0 ? '#b7e4c7' : (netoTotal < 0 ? '#f3c6c1' : '#dbe2ea');
    const partes = [];
    if (c.ganados > 0) partes.push('<span style="color:#1e7e34;">✅ ' + c.ganados + ' ganado(s)</span>');
    if (c.perdidos > 0) partes.push('<span style="color:#c0392b;">❌ ' + c.perdidos + ' perdido(s)</span>');
    if (c.pendientes > 0) partes.push('<span style="color:#888;">⏳ ' + c.pendientes + ' pendiente(s)</span>');
    if (c.jugoPolla) partes.push('<span style="color:' + (c.polla >= 0 ? '#1e7e34' : '#c0392b') + ';">🎲 Polla ' + formatMoney(c.polla) + '</span>');
    return '<div style="background:' + color + '; border:1px solid ' + borde + '; border-radius:8px; padding:10px 12px;">' +
      '<strong>' + c.cliente + '</strong>' +
      '<div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:4px; font-size:13px;">' + partes.join('') + '</div>' +
      '</div>';
  }).join('');
}

function editarTicketSabana(id) {
  const t = (ULTIMA_SABANA_DIA && ULTIMA_SABANA_DIA.tickets.find(x => x.id === id));
  if (!t) return;
  document.getElementById('modalEditarTicketSabana').dataset.ticketId = id;
  document.getElementById('editTicketReferencia').textContent = (t.ticket || 'Ticket') + ' — ' + t.fecha;
  document.getElementById('editTicketCliente').value = t.cliente;
  document.getElementById('editTicketArriesga').value = t.arriesga;
  document.getElementById('editTicketGana').value = t.gana;
  document.getElementById('editTicketEstado').value = t.estado;
  document.getElementById('modalEditarTicketSabana').classList.add('activo');
}

function cerrarEditarTicketSabana() {
  document.getElementById('modalEditarTicketSabana').classList.remove('activo');
}

async function guardarEdicionTicketSabana() {
  const id = document.getElementById('modalEditarTicketSabana').dataset.ticketId;
  if (!id) return;

  const cambios = {
    cliente: document.getElementById('editTicketCliente').value.trim(),
    arriesga: Number(document.getElementById('editTicketArriesga').value),
    gana: Number(document.getElementById('editTicketGana').value),
    estado: document.getElementById('editTicketEstado').value
  };
  if (!cambios.cliente) { alert('El cliente no puede quedar vacío.'); return; }
  if (isNaN(cambios.arriesga) || isNaN(cambios.gana)) { alert('Arriesga y Gana tienen que ser números.'); return; }

  try {
    const resultado = await api('/api/sabana/tickets/' + id, { method: 'PUT', body: JSON.stringify(cambios) });
    cerrarEditarTicketSabana();
    if (resultado.cambios.length > 0) {
      alert('Ticket actualizado — se generó una alerta avisando qué se cambió (visible para el Grupo y para el Súper-admin).');
    } else {
      alert('No había nada distinto que guardar.');
    }
    cargarSabanaDia();
  } catch (e) {
    alert('No se pudo guardar la edición: ' + e.message);
  }
}

// "📸 Generar imagen" (mismo patrón que Balance General, ver
// capturarTablaBalanceComoImagen más arriba): convierte el bloque
// Sábana + Pizarra tal como se ve en pantalla en una imagen PNG en alta
// resolución, lista para copiar (Ctrl+V en WhatsApp) o descargar.
async function capturarSabanaDiaComoImagen() {
  const modal = document.getElementById('modalCapturaSabanaDia');
  const estado = document.getElementById('capturaSabanaDiaEstado');
  const img = document.getElementById('capturaSabanaDiaImg');
  const btnCopiar = document.getElementById('btnCopiarCapturaSabanaDia');
  const btnDescargar = document.getElementById('btnDescargarCapturaSabanaDia');

  const contenido = document.getElementById('sabanasCapturaContenido');
  if (!ULTIMA_SABANA_DIA || (ULTIMA_SABANA_DIA.tickets.length === 0 && ULTIMA_SABANA_DIA.polla.length === 0)) {
    alert('Primero elige una fecha que ya tenga una sábana procesada.');
    return;
  }

  modal.classList.add('activo');
  estado.textContent = 'Generando imagen...';
  img.style.display = 'none';
  btnCopiar.disabled = true;
  btnDescargar.disabled = true;
  ULTIMA_CAPTURA_SABANA_BLOB = null;

  if (typeof html2canvas !== 'function') {
    estado.textContent = '⚠️ No se pudo cargar la herramienta para generar la imagen (revisa tu conexión a internet y vuelve a intentar).';
    return;
  }

  try {
    await prepararLogosParaCaptura(contenido);
    const canvas = await html2canvas(contenido, { scale: 3, backgroundColor: '#ffffff', useCORS: true });
    canvas.toBlob(blob => {
      if (!blob) {
        estado.textContent = '⚠️ No se pudo generar la imagen. Intenta de nuevo.';
        return;
      }
      ULTIMA_CAPTURA_SABANA_BLOB = blob;
      if (ULTIMA_CAPTURA_SABANA_URL) URL.revokeObjectURL(ULTIMA_CAPTURA_SABANA_URL);
      ULTIMA_CAPTURA_SABANA_URL = URL.createObjectURL(blob);
      img.src = ULTIMA_CAPTURA_SABANA_URL;
      img.style.display = 'inline-block';
      estado.textContent = '✅ Imagen lista — cópiala o descárgala.';
      btnCopiar.disabled = false;
      btnDescargar.disabled = false;
    }, 'image/png');
  } catch (e) {
    estado.textContent = '⚠️ No se pudo generar la imagen: ' + e.message;
  }
}

async function copiarCapturaSabanaDia() {
  if (!ULTIMA_CAPTURA_SABANA_BLOB) return;
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      throw new Error('Este navegador no soporta copiar imágenes al portapapeles.');
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': ULTIMA_CAPTURA_SABANA_BLOB })]);
    alert('¡Imagen copiada! Ya la puedes pegar (Ctrl+V) en WhatsApp Web o Desktop.');
  } catch (e) {
    alert('No se pudo copiar automáticamente (' + e.message + '). Usa "⬇️ Descargar imagen" y adjúntala a mano.');
  }
}

function descargarCapturaSabanaDia() {
  if (!ULTIMA_CAPTURA_SABANA_BLOB) return;
  const fecha = document.getElementById('sabanasFecha') ? document.getElementById('sabanasFecha').value : '';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(ULTIMA_CAPTURA_SABANA_BLOB);
  a.download = 'sabana' + (fecha ? '_' + fecha : '') + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function cerrarCapturaSabanaDia() {
  document.getElementById('modalCapturaSabanaDia').classList.remove('activo');
}

// =================================================================
// "📄 Descargar PDF" (03-09-2026, a pedido del usuario) — para sábanas
// con muchas jugadas, una sola imagen queda MUY alta y al mandarla por
// WhatsApp se comprime y se pierde el detalle (letra chica ilegible). En
// vez de reusar html2pdf.js completo (que trae su PROPIA copia de
// html2canvas adentro y podría pisar el global `html2canvas` que ya usa
// "📸 Generar imagen"), acá se arma el PDF a mano con las 2 piezas que
// YA están cargadas: html2canvas (una sola captura en alta resolución
// de #sabanasCapturaContenido) + jsPDF standalone (cortar esa captura en
// pedazos del alto de una página y pegar cada pedazo en una página
// nueva) — así ningún detalle se pierde por más larga que sea la
// sábana, sin depender de la compresión de imagen de WhatsApp.
// =================================================================
async function descargarSabanaComoPDF() {
  if (!ULTIMA_SABANA_DIA || (ULTIMA_SABANA_DIA.tickets.length === 0 && ULTIMA_SABANA_DIA.polla.length === 0)) {
    alert('Primero elige una fecha que ya tenga una sábana procesada.');
    return;
  }
  if (typeof html2canvas !== 'function' || typeof window.jspdf === 'undefined') {
    alert('No se pudo cargar la herramienta para generar el PDF (revisa tu conexión a internet y vuelve a intentar).');
    return;
  }

  const contenido = document.getElementById('sabanasCapturaContenido');
  const fecha = document.getElementById('sabanasFecha') ? document.getElementById('sabanasFecha').value : '';

  try {
    await prepararLogosParaCaptura(contenido);
    const canvas = await html2canvas(contenido, { scale: 2, backgroundColor: '#ffffff', useCORS: true });

    // Página A4 vertical, en "unidades de canvas": se calcula cuántos
    // píxeles del canvas entran de alto en una página, manteniendo el
    // mismo ancho que el canvas completo (así no hay que reescalar).
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'px', format: 'a4' });
    const anchoPagina = pdf.internal.pageSize.getWidth();
    const altoPagina = pdf.internal.pageSize.getHeight();

    const escala = anchoPagina / canvas.width;
    const altoPaginaEnCanvas = Math.floor(altoPagina / escala);

    let y = 0;
    let primeraPagina = true;
    while (y < canvas.height) {
      const altoPedazo = Math.min(altoPaginaEnCanvas, canvas.height - y);

      const pedazo = document.createElement('canvas');
      pedazo.width = canvas.width;
      pedazo.height = altoPedazo;
      const ctx = pedazo.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pedazo.width, pedazo.height);
      ctx.drawImage(canvas, 0, y, canvas.width, altoPedazo, 0, 0, canvas.width, altoPedazo);

      const dataUrl = pedazo.toDataURL('image/jpeg', 0.95);
      if (!primeraPagina) pdf.addPage();
      pdf.addImage(dataUrl, 'JPEG', 0, 0, anchoPagina, altoPedazo * escala);

      primeraPagina = false;
      y += altoPedazo;
    }

    pdf.save('sabana' + (fecha ? '_' + fecha : '') + '.pdf');
  } catch (e) {
    alert('No se pudo generar el PDF: ' + e.message);
  }
}

// =================================================================
// "📝 Extraer en texto" (15-09-2026, a pedido del usuario: "en la seccion
// de sabana, coloca un boton que diga extraer en texto que me de esa
// sabana que seleccione en formato whatssap para asi si tengo que
// modificar algo poderlo hacer") — a partir de los tickets YA PROCESADOS
// de un día (ULTIMA_SABANA_DIA.tickets), reconstruye el texto plano que
// alguien pegaría en "📋 Sábana" (#sabanaInput) para procesarlos de
// nuevo. Es el camino INVERSO al de src/services/parser.js
// (parsearSabana): ahí es texto crudo → boletos, acá es boletos → texto
// crudo — para poder corregir algo a mano (un typo, un ticket que faltó)
// y volver a pegarlo en "📋 Sábana" para reprocesar, tal como lo pidió el
// usuario.
//
// A propósito NO se intenta adivinar/reproducir el dialecto ORIGINAL con
// el que se escribió cada sábana (nombre del cliente antes o después,
// "Ticket #N" con o sin "#", "arriesga//paga" vs. "500 para 1121", etc.
// — ver todos los casos que parsearSabana() tolera, test_formato_bernal.js
// y test_logica.js) — siempre se genera hacia UN SOLO dialecto canónico,
// el más simple y más seguro que el parser entiende:
//   <CLIENTE>
//   Ticket #<N>
//   <jugada 1>
//   <jugada 2>
//   <arriesga>//<gana>
//
// Por qué este y no otro:
//   - El cierre "<arriesga>//<gana>" SELLADO (sin "$", sin "para", solo 2
//     números separados por "//") es el ÚNICO cierre que parsearSabana()
//     entiende SIN recalcular nada desde una cuota — matchResultado, en
//     parser.js, hace `(?:x\s*|para\s+)?\$?(\d+...)\$?\s*\/\/+\s*\$?(\d+...)?\$?`:
//     TODA esa envoltura ("x"/"para"/"$"/emoji ✅❌⭕) es opcional, así que
//     "100.5//90.91" a secas matchea completo. Como acá YA se conoce el
//     arriesga/gana EXACTO que tiene el ticket procesado, este es el único
//     cierre que garantiza que el ticket reprocesado quede con el MISMO
//     arriesga/gana (nada que el parser tenga que inferir desde una cuota
//     puede salir distinto).
//   - El nombre del cliente en su PROPIA línea, ANTES del ticket, es el
//     dialecto "de toda la vida" que el parser soporta desde el principio
//     (esTextoCliente, en parser.js) — no depende del arreglo especial
//     para firmas AL FINAL (formato "Bernal", 04-09-2026), que es un caso
//     particular, no la regla general.
//   - Cada jugada se copia TAL CUAL del texto que el parser ya guardó
//     (t.detalle, separado por " | " — mismo separador que usa
//     src/services/sabanaDia.js para volver a separar las patas al
//     mostrarlas) — es texto que YA se sabe que el parser entiende, porque
//     es justo lo que produjo este mismo boleto la primera vez.
//
// Se separa cada ticket del siguiente con una línea en blanco, y se
// repite el nombre del cliente antes de CADA ticket (aunque 2 tickets
// seguidos sean del mismo cliente) — repetir el encabezado de cliente es
// válido para el parser (esTextoCliente no le importa si el nombre ya
// había aparecido antes) y evita tener que "agrupar" tickets por cliente
// acá, lo que sería una fuente extra de bugs sin necesidad real.
//
// Función PURA (texto/números adentro, nada de DOM) a propósito, para que
// sea trivial de probar sola — ver test/test_extraer_sabana_texto.js, que
// mantiene una copia exacta de esta función (comentada como tal, porque
// este archivo no está armado para importarse con require() desde Node:
// corre código de navegador al cargar).
// =================================================================
function formatearMontoParaTextoSabana(monto) {
  const n = Number(monto);
  const limpio = isFinite(n) ? n : 0;
  // toFixed(2) + Number(...) para pisar basura de coma flotante (ej.
  // 903.0000000001) y de paso no arrastrar ".00" en montos redondos —
  // "500" en vez de "500.00" (el parser acepta los 2, pero "500" es más
  // corto y más legible para editar a mano en el modal).
  return Number(limpio.toFixed(2)).toString();
}

function generarTextoSabanaWhatsApp(tickets) {
  const bloques = (tickets || []).map(t => {
    const lineas = [];
    lineas.push(String(t.cliente || 'GENERAL').toUpperCase());
    // El encabezado "Ticket #N" solo se agrega si el ticket YA tenía uno
    // (algunas sábanas se procesan sin numerar ticket — queda "Sin
    // Ticket" — y el parser no lo necesita para nada: agrupa por cliente,
    // no por número de ticket, así que omitirlo cuando no hay uno de
    // verdad es más fiel a lo que en realidad se procesó).
    const ticketLabel = (t.ticket || '').trim();
    if (/^ticket\s*#?\s*\d+$/i.test(ticketLabel)) {
      lineas.push(ticketLabel);
    }
    const jugadas = String(t.detalle || '').split(' | ').map(j => j.trim()).filter(Boolean);
    jugadas.forEach(j => lineas.push(j));
    lineas.push(formatearMontoParaTextoSabana(t.arriesga) + '//' + formatearMontoParaTextoSabana(t.gana));
    return lineas.join('\n');
  });
  return bloques.join('\n\n');
}

function extraerTextoSabanaWhatsApp() {
  if (!ULTIMA_SABANA_DIA || !ULTIMA_SABANA_DIA.tickets || ULTIMA_SABANA_DIA.tickets.length === 0) {
    alert('Primero elegí y cargá una fecha con sábana.');
    return;
  }
  const fechaTitulo = document.getElementById('sabanasTituloFecha');
  const fecha = fechaTitulo ? fechaTitulo.textContent : (document.getElementById('sabanasFecha') ? document.getElementById('sabanasFecha').value : '');
  document.getElementById('extraerSabanaTextoTitulo').textContent = fecha;
  document.getElementById('extraerSabanaTextoArea').value = generarTextoSabanaWhatsApp(ULTIMA_SABANA_DIA.tickets);
  document.getElementById('modalExtraerSabanaTexto').classList.add('activo');
}

function cerrarExtraerSabanaTexto() {
  document.getElementById('modalExtraerSabanaTexto').classList.remove('activo');
}

function copiarExtraerSabanaTexto() {
  const caja = document.getElementById('extraerSabanaTextoArea');
  if (!caja || !caja.value.trim()) return;
  // Reusa copiarTextoAlPortapapeles() (ver más arriba, sección "5.
  // GENERAR PLANO WHATSAPP") — el mismo idioma de éxito/fallback que ya
  // usa "📋 Copiar" del Plano de WhatsApp, en vez de inventar uno nuevo.
  copiarTextoAlPortapapeles(caja.value, '¡Copiado! Ya lo puedes pegar (y editar si hizo falta) en "📋 Sábana" para procesarlo de nuevo.');
}

// =================================================================
// "⬇️ Descargar" > "📅 Saldos Semana" (21-09-2026, a pedido del usuario,
// verbatim: "quiero enlazar esas jugadas a un servidor online donde me
// calcule los tickets ganados y perdidos y los totales de los
// clientes... descargar toda la semana... logo y nombre del grupo
// arriba... a la izquierda el nombre de los clientes y si tiene % su %
// abajo... al lado el saldo semana... y hacia la derecha lunes martes
// miercoles... esto incluye todas las jugadas, pollas, traspaso, todo
// absolutamente todo... la imagen siempre debe ser en hd... tambien
// coloca opcion donde puedo agregar mas columnas... exportar... excel...
// pdf... arriba fecha, y semana en la que estamos del año y el logo del
// grupo").
//
// GET /api/descargas/saldos-semana (routes/descargas.js,
// services/saldosSemana.js) ya devuelve TODOS los números listos — acá
// solo se pinta #ssCaptura (una caja blanca propia, ver el CSS grande en
// grupo.html) y esa MISMA caja es la que se manda a html2canvas/jsPDF,
// igual que ya hacen Balance General y Sábanas.
// =================================================================
let SALDOS_SEMANA_ACTUAL = null; // último JSON que devolvió el backend
let SALDOS_SEMANA_FECHA_REF = null; // 'YYYY-MM-DD' cualquier día DENTRO de la semana que se está mostrando; null = semana actual (la decide el backend)

const COLUMNAS_SALDOS_SEMANA = [
  ['ssColArriesgado', 'arriesgadoSemana', 'arriesgado', 'Arriesgado'],
  ['ssColGanado', 'ganadoSemana', 'ganado', 'Ganado'],
  ['ssColPerdido', 'perdidoSemana', 'perdido', 'Perdido'],
  ['ssColComision', 'comisionSemana', 'comision', '% Devuelto'],
  ['ssColTransferencias', 'transferenciasSemana', 'transferencias', 'Transferencias'],
  ['ssColPolla', 'pollaSemana', 'polla', 'Polla']
];

function actualizarColumnasSaldosSemana() {
  const estado = {};
  COLUMNAS_SALDOS_SEMANA.forEach(([checkboxId]) => { estado[checkboxId] = document.getElementById(checkboxId).checked; });
  localStorage.setItem('zenyatta_ss_columnas', JSON.stringify(estado));
  renderSaldosSemana();
}

function cargarColumnasSaldosSemanaGuardadas() {
  let estado = {};
  try { estado = JSON.parse(localStorage.getItem('zenyatta_ss_columnas') || '{}'); } catch (e) { estado = {}; }
  COLUMNAS_SALDOS_SEMANA.forEach(([checkboxId]) => {
    const cb = document.getElementById(checkboxId);
    if (cb && Object.prototype.hasOwnProperty.call(estado, checkboxId)) cb.checked = estado[checkboxId];
  });
}

async function cargarSaldosSemana() {
  const titulo = document.getElementById('ssTituloSemana');
  titulo.textContent = 'Cargando...';
  try {
    const qs = SALDOS_SEMANA_FECHA_REF ? ('?fecha=' + encodeURIComponent(SALDOS_SEMANA_FECHA_REF)) : '';
    SALDOS_SEMANA_ACTUAL = await api('/api/descargas/saldos-semana' + qs);
    renderSaldosSemana();
  } catch (e) {
    titulo.textContent = '⚠️ No se pudo cargar';
    alert('No se pudieron cargar los Saldos de la Semana: ' + e.message);
  }
}

// "◀ Semana anterior"/"Semana siguiente ▶": se mueve 7 días desde el
// LUNES de la semana que ya está en pantalla (no desde "hoy") — así
// clickear varias veces sigue avanzando semana por semana en la misma
// dirección, en vez de quedar pegado siempre a una semana de distancia
// de hoy.
function cambiarSemanaSaldos(deltaSemanas) {
  const base = (SALDOS_SEMANA_ACTUAL && SALDOS_SEMANA_ACTUAL.semana && SALDOS_SEMANA_ACTUAL.semana.desde) || hoyISO();
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaSemanas * 7);
  SALDOS_SEMANA_FECHA_REF = d.toISOString().split('T')[0];
  cargarSaldosSemana();
}

function irASemanaActualSaldos() {
  SALDOS_SEMANA_FECHA_REF = null;
  cargarSaldosSemana();
}

function escaparHtmlSaldosSemana(texto) {
  const div = document.createElement('div');
  div.textContent = texto == null ? '' : String(texto);
  return div.innerHTML;
}

// "+$50.00"/"-$50.00"/"$0.00", con la clase de color (verde/rojo/gris) —
// mismo criterio que .ganada/.perdida del resto de la app, pero pensado
// para fondo BLANCO (ver el CSS de #ssCaptura).
function celdaMontoSaldosSemana(monto) {
  const n = Number(monto) || 0;
  const clase = n > 0.004 ? 'ss-pos' : (n < -0.004 ? 'ss-neg' : 'ss-cero');
  const texto = n > 0.004 ? ('+' + formatMoney(n)) : formatMoney(n);
  return '<span class="' + clase + '">' + texto + '</span>';
}

// "5%"/"12.5%" — sin decimales de sobra si el % es un número entero.
function formatPorcentaje(pct) {
  const n = Number(pct) || 0;
  const texto = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return texto + '%';
}

// Arma #ssCaptura ENTERO (header + tabla) a partir de SALDOS_SEMANA_ACTUAL
// y de qué columnas extra estén marcadas ahora mismo — se vuelve a llamar
// cada vez que cambia una columna, así lo que se ve en pantalla es
// siempre exactamente lo que se va a capturar.
function renderSaldosSemana() {
  const datos = SALDOS_SEMANA_ACTUAL;
  const cont = document.getElementById('ssCaptura');
  const vacio = document.getElementById('ssVacio');
  const titulo = document.getElementById('ssTituloSemana');
  if (!datos) return;

  titulo.textContent = 'Semana ' + datos.semana.numero + ' de ' + datos.semana.anio + ' (' + formatFechaDDMMYYYY(datos.semana.desde) + ' – ' + formatFechaDDMMYYYY(datos.semana.hasta) + ')';

  // Solo clientes con ALGÚN registro esta semana (21-09-2026, a pedido
  // EXPLÍCITO del usuario — primero pidió ocultar a los que "no tienen
  // saldo", y después afinó el criterio: "en la imagen de descargar solo
  // muestrame los clientes que tengan jugadas, traspasos, o pollas o lo
  // que sea los clientes que no tengan ningun registro en la semana no me
  // lo muestres asi ahorra espacio"). OJO: esto es distinto de "saldo
  // final en $0.00" — un cliente que ganó y perdió montos que se cancelan
  // exactamente a $0.00 neto en la semana SÍ tuvo actividad real (jugadas
  // de verdad) y tiene que seguir apareciendo; lo único que se oculta es
  // al cliente que de verdad no tuvo NINGÚN registro (ni jugadas, ni
  // pollas, ni traspasos, ni comisión). Por eso el filtro mira los
  // totales semanales de CADA tipo de movimiento por separado (todos ya
  // calculados por el backend), no el saldo final. El TOTAL de abajo no
  // cambia (un cliente sin ningún registro no aportaba nada al total de
  // todos modos), y el Excel se deja intacto a propósito (el pedido fue
  // puntualmente sobre "la imagen de descargar").
  const clientesConActividad = (datos.clientes || []).filter(c =>
    c.arriesgadoSemana !== 0 || c.ganadoSemana !== 0 || c.perdidoSemana !== 0 ||
    c.transferenciasSemana !== 0 || c.pollaSemana !== 0 || c.comisionSemana !== 0
  );

  if (clientesConActividad.length === 0) {
    cont.innerHTML = '';
    vacio.style.display = 'block';
    return;
  }
  vacio.style.display = 'none';

  const columnasExtra = COLUMNAS_SALDOS_SEMANA.filter(([checkboxId]) => {
    const cb = document.getElementById(checkboxId);
    return cb && cb.checked;
  });

  const nombreGrupo = escaparHtmlSaldosSemana(datos.grupo.nombre || '');
  const logoHTML = datos.grupo.logoUrl
    ? '<img class="ss-logo logo-grupo-captura" src="' + urlLogoGrupoProxy() + '" alt="" onerror="this.style.display=\'none\'">'
    : '';

  const rangoTexto = rangoSemanaLegible(datos.semana.desde, datos.semana.hasta);
  const generadoTexto = 'Generado el ' + fechaHoraVenezuelaTextoCorto();

  let html = '';
  html += '<div class="ss-header">';
  html += logoHTML;
  html += '<div class="ss-header-textos">';
  html += '<div class="ss-nombre-grupo">' + nombreGrupo + '</div>';
  html += '<div class="ss-subtitulo">📅 Saldos Semana · jugadas, pollas y transferencias</div>';
  html += '</div>';
  html += '<div class="ss-semana-badge">';
  html += '<div class="ss-semana-numero">SEMANA ' + datos.semana.numero + ' · ' + datos.semana.anio + '</div>';
  html += '<div class="ss-semana-rango">' + rangoTexto + '</div>';
  html += '<div class="ss-fecha-generado">' + generadoTexto + '</div>';
  html += '</div>';
  html += '</div>';

  html += '<div class="ss-divider"></div>';

  html += '<table class="ss-tabla"><thead>';
  html += '<tr class="ss-fila-grupos"><th class="ss-col-cliente"></th><th class="ss-col-saldo"></th><th colspan="7">Lunes a Domingo</th>';
  if (columnasExtra.length > 0) html += '<th colspan="' + columnasExtra.length + '" class="ss-extra-primera">Detalle</th>';
  html += '</tr>';
  html += '<tr class="ss-fila-dias"><th class="ss-col-cliente">Cliente</th><th class="ss-col-saldo">Saldo Semana</th>';
  datos.semana.dias.forEach(d => {
    html += '<th>' + d.corta + '<span class="ss-th-fecha">' + formatFechaDDMMYYYY(d.fecha).slice(0, 5).replace('-', '/') + '</span></th>';
  });
  columnasExtra.forEach(([checkboxId, , , etiqueta], i) => {
    html += '<th class="ss-col-extra' + (i === 0 ? ' ss-extra-primera' : '') + '">' + etiqueta + '</th>';
  });
  html += '</tr></thead><tbody>';

  clientesConActividad.forEach(c => {
    // Fila del cliente: SOLO su resultado (jugadas + polla + transferencias),
    // SIN la comisión — la comisión va en su propia fila aparte, justo
    // debajo (21-09-2026, a pedido EXPLÍCITO del usuario: "son dos item
    // diferentes... quiero que se vea uno debajo del otro y no disperso...
    // no enseñes cuanto es su %, solo el nombre del %" — antes esto era
    // UNA sola fila con el nombre y, si tenía %, la TASA (ej. "5%") como
    // badge debajo del nombre en la MISMA celda; eso mezclaba 2 cosas
    // distintas en un solo renglón, que es justo lo que el usuario pidió
    // separar). Mismo criterio EXACTO que ya usa el mensaje de WhatsApp
    // "Plano" para esto mismo, "NOMBRE" / "% NOMBRE" en 2 líneas
    // independientes (ver comisiones.js/historial.js) — acá se replica
    // con los mismos campos que ya calcula el backend sin cambiar nada
    // ahí: "resultado" (por día) y "saldoSemana - comisionSemana" (para
    // la semana completa) son EXACTAMENTE el balance sin comisión.
    const saldoSemanaSinComision = c.saldoSemana - c.comisionSemana;
    html += '<tr class="ss-fila-cliente">';
    html += '<td class="ss-col-cliente"><span class="ss-nombre-cliente">' + escaparHtmlSaldosSemana(c.nombre) + '</span></td>';
    html += '<td class="ss-col-saldo">' + celdaMontoSaldosSemana(saldoSemanaSinComision) + '</td>';
    datos.semana.dias.forEach(d => {
      const dia = c.porDia[d.fecha] || { resultado: 0, comision: 0 };
      html += '<td class="ss-dia">' + celdaMontoSaldosSemana(dia.resultado) + '</td>';
    });
    columnasExtra.forEach(([checkboxId, campoSemana], i) => {
      html += '<td class="ss-col-extra' + (i === 0 ? ' ss-extra-primera' : '') + '">' + formatMoney(c[campoSemana]) + '</td>';
    });
    html += '</tr>';

    // Fila "NOMBRE %" aparte, solo para clientes con % propio (mismo
    // criterio que el badge que reemplaza: si tiene %, siempre se
    // muestra, tenga o no comisión ESTA semana puntual) — SOLO el nombre
    // con "%" pegado, sin la tasa (ej. nunca "5%"), con su propio
    // desglose día por día de la comisión sola. Las columnas "extra"
    // (arriesgado/ganado/etc.) no aplican acá — van con rayita.
    if (c.porcentaje > 0) {
      html += '<tr class="ss-fila-cliente ss-fila-comision">';
      html += '<td class="ss-col-cliente"><span class="ss-nombre-cliente ss-nombre-comision">' + escaparHtmlSaldosSemana(c.nombre) + ' %</span></td>';
      html += '<td class="ss-col-saldo">' + celdaMontoSaldosSemana(c.comisionSemana) + '</td>';
      datos.semana.dias.forEach(d => {
        const dia = c.porDia[d.fecha] || { resultado: 0, comision: 0 };
        html += '<td class="ss-dia">' + celdaMontoSaldosSemana(dia.comision) + '</td>';
      });
      columnasExtra.forEach((col, i) => {
        html += '<td class="ss-col-extra' + (i === 0 ? ' ss-extra-primera' : '') + '">—</td>';
      });
      html += '</tr>';
    }
  });

  // TOTAL: acá SÍ va todo unido en un solo monto (21-09-2026, a pedido
  // EXPLÍCITO del usuario: "abajo el total, suma todo incluyendo los %...
  // da un solo saldo total de la banca... todo se suma para hacer un solo
  // monto") — a diferencia de las filas POR CLIENTE (que sí separan
  // "NOMBRE" de "NOMBRE %" para poder ver a cada cliente por separado),
  // el TOTAL representa el saldo real de la banca, y ahí la comisión es
  // una plata que de verdad entra o sale igual que cualquier jugada/
  // polla/traspaso — por eso usa saldoSemana COMPLETO (con comisión) y,
  // por día, resultado + comision (= saldoCliente, el movimiento total
  // del día). Ya NO hay una fila "TOTAL %" aparte — se sacó a propósito.
  // El saldo de esta fila se muestra invertido (× -1): es la banca, no un
  // cliente más (21-09-2026, a pedido EXPLÍCITO del usuario: "el saldo
  // total, osea el saldo de la banca debe ser multiplicado x-1, asi si los
  // clientes ganan la banca se vea en negativo, si los clientes pierden la
  // banca se vea en positivo"). Los clientes ganan = saldoSemana total
  // positivo = a la banca LE SALIÓ esa plata = negativo para la banca, y
  // viceversa. Solo se invierte el saldo (Saldo Semana + columnas de día);
  // las columnas "Detalle" (Arriesgado/Ganado/Perdido/etc.) son estadística
  // agregada de las jugadas, no un saldo, así que se dejan tal cual. Se
  // renombra la fila de "TOTAL" a "SALDO BANCA" para que quede claro que
  // ya no es la simple suma de las filas de arriba, sino su inverso.
  html += '</tbody><tfoot><tr class="ss-fila-total">';
  html += '<td class="ss-col-cliente"><span class="ss-nombre-cliente">SALDO BANCA</span></td>';
  html += '<td class="ss-col-saldo">' + celdaMontoSaldosSemana(-datos.totales.saldoSemana) + '</td>';
  datos.semana.dias.forEach(d => {
    const dia = datos.totales.porDia[d.fecha] || { resultado: 0, comision: 0 };
    html += '<td class="ss-dia">' + celdaMontoSaldosSemana(-(dia.resultado + dia.comision)) + '</td>';
  });
  columnasExtra.forEach(([checkboxId, campoSemana], i) => {
    html += '<td class="ss-col-extra' + (i === 0 ? ' ss-extra-primera' : '') + '">' + formatMoney(datos.totales[campoSemana]) + '</td>';
  });
  html += '</tr></tfoot></table>';

  html += '<div class="ss-footer"><strong>' + (GRUPO && GRUPO.nombre ? escaparHtmlSaldosSemana(GRUPO.nombre) : 'Ludox') + '</strong> · Reporte generado automáticamente por Ludox</div>';

  cont.innerHTML = html;
}

// Mismo proxy que ya usa la ruta pública del cliente (GET
// /api/imagenes/logo-grupo/:grupoId, ver src/routes/imagenes.js) — se
// pide DESDE ESTE MISMO servidor (mismo origen) para que html2canvas
// pueda leer los píxeles del logo sin problema de CORS, igual que ya
// resuelve urlLogoProxy() para los escudos de equipo (ver más arriba).
function urlLogoGrupoProxy() {
  return '/api/imagenes/logo-grupo/' + encodeURIComponent(GRUPO.id) + '?v=' + Date.now();
}

// "generado el 21/09/2026, 9:14 a. m." corto, para el pie de la imagen —
// no hace falta el sufijo "(hora de Venezuela)" de
// fechaHoraVenezuelaTexto() (ver services/fechaVenezuela.js del backend,
// mismo criterio) porque ya lo dice justo al lado en formato compacto.
function fechaHoraVenezuelaTextoCorto() {
  const ahora = new Date();
  return formatFechaDDMMYYYY(hoyISO()).replace(/-/g, '/') + ', ' + ahora.toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' });
}

function capitalizar(texto) {
  if (!texto) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// "Lunes 14 – Domingo 20 de septiembre" (mismo mes) o "Lunes 29 de
// diciembre – Domingo 4 de enero" (la semana cruza de mes/año) — para el
// renglón chico debajo del badge "SEMANA 38 · 2026".
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function rangoSemanaLegible(desde, hasta) {
  const dDesde = new Date(desde + 'T00:00:00Z');
  const dHasta = new Date(hasta + 'T00:00:00Z');
  const mismoMes = dDesde.getUTCMonth() === dHasta.getUTCMonth() && dDesde.getUTCFullYear() === dHasta.getUTCFullYear();
  const inicio = capitalizar(etiquetaDiaLarga(desde)) + ' ' + dDesde.getUTCDate() + (mismoMes ? '' : ' de ' + MESES_LARGO[dDesde.getUTCMonth()]);
  const fin = capitalizar(etiquetaDiaLarga(hasta)) + ' ' + dHasta.getUTCDate() + ' de ' + MESES_LARGO[dHasta.getUTCMonth()];
  return inicio + ' – ' + fin;
}

// "📅 Saldos Semana (imagen HD)" — mismo patrón EXACTO que
// capturarSabanaDiaComoImagen()/capturarTablaBalanceComoImagen(): rasteriza
// el logo primero (prepararLogosParaCaptura, por si el logo del grupo
// fuera un SVG — mismo problema que ya se resolvió para los escudos de
// equipo), y usa scale:3 ("lo más HD posible", pedido explícito del
// usuario) con fondo blanco forzado.
async function capturarSaldosSemanaComoImagen() {
  const modal = document.getElementById('modalCapturaSaldosSemana');
  const estado = document.getElementById('capturaSaldosSemanaEstado');
  const img = document.getElementById('capturaSaldosSemanaImg');
  const btnCopiar = document.getElementById('btnCopiarCapturaSaldosSemana');
  const btnDescargar = document.getElementById('btnDescargarCapturaSaldosSemana');

  const contenido = document.getElementById('ssCaptura');
  if (!SALDOS_SEMANA_ACTUAL || !SALDOS_SEMANA_ACTUAL.clientes || SALDOS_SEMANA_ACTUAL.clientes.length === 0) {
    alert('Este grupo todavía no tiene ningún cliente registrado.');
    return;
  }

  modal.classList.add('activo');
  estado.textContent = 'Generando imagen...';
  img.style.display = 'none';
  btnCopiar.disabled = true;
  btnDescargar.disabled = true;
  ULTIMA_CAPTURA_SALDOS_SEMANA_BLOB = null;

  if (typeof html2canvas !== 'function') {
    estado.textContent = '⚠️ No se pudo cargar la herramienta para generar la imagen (revisa tu conexión a internet y vuelve a intentar).';
    return;
  }

  try {
    await prepararLogosParaCaptura(contenido);
    const canvas = await html2canvas(contenido, { scale: 3, backgroundColor: '#ffffff', useCORS: true });
    canvas.toBlob(blob => {
      if (!blob) {
        estado.textContent = '⚠️ No se pudo generar la imagen. Intenta de nuevo.';
        return;
      }
      ULTIMA_CAPTURA_SALDOS_SEMANA_BLOB = blob;
      if (ULTIMA_CAPTURA_SALDOS_SEMANA_URL) URL.revokeObjectURL(ULTIMA_CAPTURA_SALDOS_SEMANA_URL);
      ULTIMA_CAPTURA_SALDOS_SEMANA_URL = URL.createObjectURL(blob);
      img.src = ULTIMA_CAPTURA_SALDOS_SEMANA_URL;
      img.style.display = 'inline-block';
      estado.textContent = '✅ Imagen lista — cópiala o descárgala.';
      btnCopiar.disabled = false;
      btnDescargar.disabled = false;
    }, 'image/png');
  } catch (e) {
    estado.textContent = '⚠️ No se pudo generar la imagen: ' + e.message;
  }
}

let ULTIMA_CAPTURA_SALDOS_SEMANA_BLOB = null;
let ULTIMA_CAPTURA_SALDOS_SEMANA_URL = null;

async function copiarCapturaSaldosSemana() {
  if (!ULTIMA_CAPTURA_SALDOS_SEMANA_BLOB) return;
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      throw new Error('Este navegador no soporta copiar imágenes al portapapeles.');
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': ULTIMA_CAPTURA_SALDOS_SEMANA_BLOB })]);
    alert('¡Imagen copiada! Ya la puedes pegar (Ctrl+V) en WhatsApp Web o Desktop.');
  } catch (e) {
    alert('No se pudo copiar automáticamente (' + e.message + '). Usa "⬇️ Descargar imagen" y adjúntala a mano.');
  }
}

function descargarCapturaSaldosSemana() {
  if (!ULTIMA_CAPTURA_SALDOS_SEMANA_BLOB) return;
  const semana = SALDOS_SEMANA_ACTUAL ? SALDOS_SEMANA_ACTUAL.semana : null;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(ULTIMA_CAPTURA_SALDOS_SEMANA_BLOB);
  a.download = 'saldos_semana' + (semana ? '_' + semana.anio + '_s' + semana.numero : '') + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function cerrarCapturaSaldosSemana() {
  document.getElementById('modalCapturaSaldosSemana').classList.remove('activo');
}

// "📄 Descargar PDF" — mismo patrón EXACTO que descargarSabanaComoPDF()
// (cortar la captura en páginas del alto de una hoja), pero en horizontal
// ("l" de landscape): esta tabla es ANCHA (7 días + hasta 6 columnas
// extra), no alta como la Sábana — en una hoja vertical el texto saldría
// diminuto para que la tabla completa entrara de ancho.
async function descargarSaldosSemanaComoPDF() {
  if (!SALDOS_SEMANA_ACTUAL || !SALDOS_SEMANA_ACTUAL.clientes || SALDOS_SEMANA_ACTUAL.clientes.length === 0) {
    alert('Este grupo todavía no tiene ningún cliente registrado.');
    return;
  }
  if (typeof html2canvas !== 'function' || typeof window.jspdf === 'undefined') {
    alert('No se pudo cargar la herramienta para generar el PDF (revisa tu conexión a internet y vuelve a intentar).');
    return;
  }

  const contenido = document.getElementById('ssCaptura');
  const semana = SALDOS_SEMANA_ACTUAL.semana;

  try {
    await prepararLogosParaCaptura(contenido);
    const canvas = await html2canvas(contenido, { scale: 2, backgroundColor: '#ffffff', useCORS: true });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'l', unit: 'px', format: 'a4' });
    const anchoPagina = pdf.internal.pageSize.getWidth();
    const altoPagina = pdf.internal.pageSize.getHeight();

    const escala = anchoPagina / canvas.width;
    const altoPaginaEnCanvas = Math.floor(altoPagina / escala);

    let y = 0;
    let primeraPagina = true;
    while (y < canvas.height) {
      const altoPedazo = Math.min(altoPaginaEnCanvas, canvas.height - y);

      const pedazo = document.createElement('canvas');
      pedazo.width = canvas.width;
      pedazo.height = altoPedazo;
      const ctx = pedazo.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pedazo.width, pedazo.height);
      ctx.drawImage(canvas, 0, y, canvas.width, altoPedazo, 0, 0, canvas.width, altoPedazo);

      const dataUrl = pedazo.toDataURL('image/jpeg', 0.95);
      if (!primeraPagina) pdf.addPage();
      pdf.addImage(dataUrl, 'JPEG', 0, 0, anchoPagina, altoPedazo * escala);

      primeraPagina = false;
      y += altoPedazo;
    }

    pdf.save('saldos_semana' + (semana ? '_' + semana.anio + '_s' + semana.numero : '') + '.pdf');
  } catch (e) {
    alert('No se pudo generar el PDF: ' + e.message);
  }
}

// =================================================================
// "📊 Exportar Excel" de Saldos Semana (21-09-2026, a pedido del usuario:
// "...y yo pueda seleccionar que ver en ese archivo excel") — arma el
// .xlsx 100% en el navegador con SheetJS a partir de SALDOS_SEMANA_ACTUAL
// (los mismos datos que ya están en pantalla, sin pedirle nada nuevo al
// backend). A diferencia de la imagen/PDF (que muestran "Saldo Semana"
// SIEMPRE), acá el usuario elige columna por columna qué quiere que
// traiga el archivo — incluye "Saldo Semana" y los 7 días como
// checkboxes propios además de las 6 columnas "extra" de siempre.
// =================================================================
function abrirExportarExcelSaldosSemana() {
  if (!SALDOS_SEMANA_ACTUAL || !SALDOS_SEMANA_ACTUAL.clientes || SALDOS_SEMANA_ACTUAL.clientes.length === 0) {
    alert('Este grupo todavía no tiene ningún cliente registrado.');
    return;
  }
  document.getElementById('modalExportarExcelSaldosSemana').classList.add('activo');
}

function cerrarExportarExcelSaldosSemana() {
  document.getElementById('modalExportarExcelSaldosSemana').classList.remove('activo');
}

function generarExcelSaldosSemana() {
  if (typeof XLSX === 'undefined') {
    alert('No se pudo cargar la herramienta para generar el Excel (revisa tu conexión a internet y vuelve a intentar).');
    return;
  }
  const datos = SALDOS_SEMANA_ACTUAL;
  if (!datos || !datos.clientes || datos.clientes.length === 0) return;

  const incluirSaldoSemana = document.getElementById('xlsColSaldoSemana').checked;
  const incluirDias = document.getElementById('xlsColDias').checked;
  const columnasExtraXls = COLUMNAS_SALDOS_SEMANA.filter((_, i) => {
    const idsXls = ['xlsColArriesgado', 'xlsColGanado', 'xlsColPerdido', 'xlsColComision', 'xlsColTransferencias', 'xlsColPolla'];
    const cb = document.getElementById(idsXls[i]);
    return cb && cb.checked;
  });

  // Encabezados
  const encabezado = ['Cliente', '%'];
  if (incluirSaldoSemana) encabezado.push('Saldo Semana');
  if (incluirDias) datos.semana.dias.forEach(d => encabezado.push(d.nombre + ' ' + formatFechaDDMMYYYY(d.fecha)));
  columnasExtraXls.forEach(([, , , etiqueta]) => encabezado.push(etiqueta));

  const filas = [encabezado];
  datos.clientes.forEach(c => {
    const fila = [c.nombre, c.porcentaje > 0 ? formatPorcentaje(c.porcentaje) : ''];
    if (incluirSaldoSemana) fila.push(Number(c.saldoSemana.toFixed(2)));
    if (incluirDias) {
      datos.semana.dias.forEach(d => {
        const dia = c.porDia[d.fecha] || { resultado: 0, comision: 0 };
        fila.push(Number((dia.resultado + dia.comision).toFixed(2)));
      });
    }
    columnasExtraXls.forEach(([, campoSemana]) => fila.push(Number((c[campoSemana] || 0).toFixed(2))));
    filas.push(fila);
  });

  // Fila de TOTAL al final, mismo criterio que la imagen/PDF.
  const filaTotal = ['TOTAL', ''];
  if (incluirSaldoSemana) filaTotal.push(Number(datos.totales.saldoSemana.toFixed(2)));
  if (incluirDias) {
    datos.semana.dias.forEach(d => {
      const dia = datos.totales.porDia[d.fecha] || { resultado: 0, comision: 0 };
      filaTotal.push(Number((dia.resultado + dia.comision).toFixed(2)));
    });
  }
  columnasExtraXls.forEach(([, campoSemana]) => filaTotal.push(Number((datos.totales[campoSemana] || 0).toFixed(2))));
  filas.push(filaTotal);

  // 2 filas de título arriba de la tabla (grupo + semana), como en la
  // imagen/PDF — se arma como filas sueltas antes del encabezado real
  // para que abra directo mostrando de qué grupo/semana es este archivo.
  const tituloGrupo = (datos.grupo.nombre || 'Grupo') + ' — Saldos Semana';
  const tituloSemana = 'Semana ' + datos.semana.numero + ' de ' + datos.semana.anio + ' (' + formatFechaDDMMYYYY(datos.semana.desde) + ' – ' + formatFechaDDMMYYYY(datos.semana.hasta) + ')';

  const hoja = XLSX.utils.aoa_to_sheet([[tituloGrupo], [tituloSemana], [], ...filas]);
  hoja['!cols'] = encabezado.map((_, i) => ({ wch: i === 0 ? 20 : 14 }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Saldos Semana');
  XLSX.writeFile(libro, 'saldos_semana_' + datos.semana.anio + '_s' + datos.semana.numero + '.xlsx');

  cerrarExportarExcelSaldosSemana();
}

// =================================================================
// ALERTAS (jugadas AMBIGUA (VARIOS DEPORTES)) — ver src/services/alertas.js
// y src/routes/sabana.js. El badge de la pestaña se revisa cada 25s desde
// mostrarApp() (ver ALERTAS_INTERVALO más arriba), sin importar en qué
// pestaña esté el Grupo.
// =================================================================
const NOMBRES_DEPORTE = { mlb: 'MLB (Béisbol)', nfl: 'NFL (Fútbol Americano)', nhl: 'NHL (Hockey)', soccer: 'Fútbol', basket: 'Basket (NBA)' };

async function actualizarBadgeAlertas() {
  // Guarda de permiso (18-09-2026, ver tienePermiso() más arriba).
  if (!tienePermiso('alertas')) return;
  try {
    const { total } = await api('/api/sabana/alertas/conteo-no-leidas');
    const badge = document.getElementById('alertasBadge');
    const nav = document.getElementById('navAlertas');
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : total;
      badge.style.display = 'inline-block';
      nav.classList.add('nav-alerta-activa');
    } else {
      badge.style.display = 'none';
      nav.classList.remove('nav-alerta-activa');
    }
  } catch (e) { /* si falla el chequeo de fondo, no interrumpe nada más de la app */ }
}

async function marcarAlertasLeidas() {
  try {
    await api('/api/sabana/alertas/marcar-leidas', { method: 'POST' });
    actualizarBadgeAlertas();
  } catch (e) { /* no crítico */ }
}

// =================================================================
// 💳 PAGOS (15-09-2026) — ver la nota grande junto a #vistaPagos en
// grupo.html y src/routes/pagos.js. Esto es la SUSCRIPCIÓN semanal que
// este Grupo le paga a Ludox, no tiene nada que ver con las jugadas ni
// los saldos de sus clientes.
// =================================================================
const NOMBRES_METODO_PAGO = { pago_movil: 'Pago Móvil', binance: 'Binance', zelle: 'Zelle', banesco_panama: 'Banesco Panamá' };
const NOMBRES_ESTADO_PAGO = { pendiente: 'Pendiente', confirmado: 'Confirmado', rechazado: 'Rechazado' };
const TOPE_CAPTURA_PAGO_BYTES = 4 * 1024 * 1024; // 4MB — igual al tope que valida src/routes/pagos.js del lado del servidor

async function cargarPagosGrupo() {
  // Guarda de permiso (18-09-2026, ver tienePermiso() más arriba) — esta
  // pestaña ya está oculta del sidebar para un Empleado sin permiso
  // 'pagos' (ver aplicarPermisosEmpleado()), pero mostrarVista('pagos')
  // podría llegar a llamarse igual (ej. quedó como VISTA_ACTUAL de una
  // sesión vieja) — sin este alto explícito, terminaría deslogueado.
  if (!tienePermiso('pagos')) return;
  const fechaInput = document.getElementById('pagoFecha');
  if (fechaInput && !fechaInput.value) fechaInput.value = hoyISO();

  try {
    const pagos = await api('/api/pagos');
    renderPagosGrupo(pagos);
    actualizarBadgePagosGrupo(pagos);
  } catch (e) {
    alert('No se pudieron cargar tus pagos reportados: ' + e.message);
  }
}

function renderPagosGrupo(pagos) {
  const cuerpo = document.getElementById('cuerpoPagosGrupo');
  document.getElementById('vacioPagosGrupo').style.display = pagos.length === 0 ? 'block' : 'none';
  cuerpo.innerHTML = pagos.map(p => {
    const badgeClase = 'badge-pago-' + p.estado;
    const nota = p.nota_admin ? p.nota_admin.replace(/</g, '&lt;') : '';
    return '<tr>' +
      '<td data-label="Fecha">' + formatFechaDDMMYYYY(p.fecha_pago) + '</td>' +
      '<td data-label="Método">' + (NOMBRES_METODO_PAGO[p.metodo] || p.metodo) + '</td>' +
      '<td data-label="Referencia">' + (p.referencia ? p.referencia.replace(/</g, '&lt;') : '—') + '</td>' +
      '<td data-label="Estado"><span class="' + badgeClase + '">' + (NOMBRES_ESTADO_PAGO[p.estado] || p.estado) + '</span></td>' +
      '<td data-label="Nota de Súper-admin">' + (nota || '—') + '</td>' +
      '<td data-label="Acción"><button type="button" class="btn-chico" onclick="verCapturaPagoGrupo(\'' + p.id + '\')">👁️ Ver captura</button></td>' +
      '</tr>';
  }).join('');
}

// Mismo idioma visual que actualizarBadgeAlertas() (badge + parpadeo del
// botón de la pestaña) pero contando los pagos RECHAZADOS de este Grupo —
// un rechazo es algo que el Grupo tiene que notar aunque esté viendo otra
// pestaña (por eso también se llama desde revisarNotificacionesFondo()
// más arriba, no solo al entrar a la pestaña "💳 Pagos").
async function actualizarBadgePagosGrupo(pagosYaCargados) {
  // Guarda de permiso (18-09-2026, ver tienePermiso() más arriba).
  if (!tienePermiso('pagos')) return;
  try {
    const pagos = pagosYaCargados || await api('/api/pagos');
    const rechazados = pagos.filter(p => p.estado === 'rechazado').length;
    const badge = document.getElementById('pagosBadge');
    const nav = document.getElementById('navPagos');
    if (!badge || !nav) return;
    if (rechazados > 0) {
      badge.textContent = rechazados > 99 ? '99+' : rechazados;
      badge.style.display = 'inline-block';
      nav.classList.add('nav-alerta-activa');
    } else {
      badge.style.display = 'none';
      nav.classList.remove('nav-alerta-activa');
    }
  } catch (e) { /* chequeo de fondo — si falla, no interrumpe nada más de la app */ }
}

// Lee el archivo elegido, lo manda como base64 a POST /api/pagos y
// recarga el historial. El tope de 4MB se chequea ACÁ ANTES de leer el
// archivo (sin gastar ancho de banda ni CPU convirtiéndolo a base64 para
// nada) — el servidor igual lo vuelve a validar por su cuenta (ver
// routes/pagos.js), nunca hay que confiar solo en lo que valida el navegador.
async function reportarPago() {
  const fecha = document.getElementById('pagoFecha').value;
  const metodo = document.getElementById('pagoMetodoSelect').value;
  const referencia = document.getElementById('pagoReferenciaInput').value.trim();
  const fileInput = document.getElementById('pagoCapturaInput');
  const file = fileInput.files[0];

  if (!fecha) { alert('Elegí la fecha del pago.'); return; }
  if (!file) { alert('Adjuntá la captura del pago.'); return; }
  if (file.size > TOPE_CAPTURA_PAGO_BYTES) {
    alert('La imagen es muy pesada (máx. 4MB) — probá con una captura de pantalla en vez de la foto original de la cámara.');
    return;
  }

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result));
      lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      lector.readAsDataURL(file);
    });
    // El data URL viene como "data:image/png;base64,AAAA..." — el
    // servidor solo necesita la parte de después de la coma.
    const capturaBase64 = dataUrl.split(',')[1] || '';

    await api('/api/pagos', {
      method: 'POST',
      body: JSON.stringify({
        fechaPago: fecha,
        metodo,
        referencia: referencia || null,
        capturaBase64,
        capturaMime: file.type || 'image/png'
      })
    });

    alert('¡Pago reportado! Súper-admin lo va a revisar pronto.');
    document.getElementById('pagoReferenciaInput').value = '';
    fileInput.value = '';
    document.getElementById('pagoFecha').value = hoyISO();
    await cargarPagosGrupo();
  } catch (e) {
    alert('No se pudo reportar el pago: ' + e.message);
  }
}

// GET /api/pagos/:id/captura exige sesión de Grupo (requiereGrupo en
// routes/pagos.js) igual que cualquier otra ruta de este panel — la
// sesión viaja como "Authorization: Bearer <token>" (ver api() más
// arriba), NO como cookie, así que un simple <a href>/window.open NO
// serviría (el navegador no manda ese header solo). Por eso acá se pide
// la imagen a mano con fetch() + el mismo header, y se abre el blob
// resultante en una pestaña nueva.
async function verCapturaPagoGrupo(id) {
  try {
    const headers = {};
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const res = await fetch('/api/pagos/' + id + '/captura', { headers });
    if (!res.ok) throw new Error('No se pudo abrir la captura (' + res.status + ').');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (e) {
    alert('No se pudo abrir la captura: ' + e.message);
  }
}

function formatFechaHoraAlerta(iso) {
  try { return new Date(iso).toLocaleString('es-ES', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return iso; }
}

async function cargarAlertas() {
  try {
    const alertas = await api('/api/sabana/alertas');
    renderAlertas(alertas);
  } catch (e) {
    alert('No se pudieron cargar las alertas: ' + e.message);
  }
}

function renderAlertas(alertas) {
  const cont = document.getElementById('listaAlertas');
  document.getElementById('vacioAlertas').style.display = alertas.length === 0 ? 'block' : 'none';
  cont.innerHTML = alertas.map(a => {
    const candidatos = a.candidatos || [];
    const opciones = candidatos.map(c => '<option value="' + c.deporte + '">' + (NOMBRES_DEPORTE[c.deporte] || c.deporte.toUpperCase()) + ' — ' + c.nombre + '</option>').join('');
    const cabeceraTexto = formatFechaHoraAlerta(a.creado_en) + ' — ' + (a.cliente_nombre || 'GENERAL') + (a.ticket_label ? ' — ' + a.ticket_label : '');
    // Confirmaciones/diferencias del link del Cliente (02-09-2026, "un
    // plus" — ver src/services/confirmaciones.js): presentación propia,
    // distinta de AMBIGUA_DEPORTE/SIN_LOGRO (acá no hay deporte que
    // elegir ni sábana que corregir).
    if (a.tipo === 'CONFIRMACION_CLIENTE') {
      return '<div class="caja-alerta resuelta">' +
        '<div class="alerta-cabecera"><span>' + cabeceraTexto + '</span><span class="badge-resuelta">✅ Cuenta cuadrada</span></div>' +
        '<div class="alerta-mensaje">' + a.mensaje + '</div></div>';
    }
    if (a.tipo === 'DIFERENCIA_CLIENTE') {
      return a.resuelta
        ? '<div class="caja-alerta resuelta">' +
            '<div class="alerta-cabecera"><span>' + cabeceraTexto + '</span><span class="badge-resuelta">✅ Atendida</span></div>' +
            '<div class="alerta-mensaje">' + a.mensaje + '</div></div>'
        : '<div class="caja-alerta">' +
            '<div class="alerta-cabecera"><span>' + cabeceraTexto + '</span><span>⚠️ Diferencia reportada</span></div>' +
            '<div class="alerta-mensaje">' + a.mensaje + '</div>' +
            '<div class="alerta-resolver"><button type="button" class="btn-chico" onclick="descartarAlertaGrupo(\'' + a.id + '\')">Marcar atendida</button></div></div>';
    }
    // Ticket editado a mano desde la pestaña "Sábanas" (02-09-2026, ver
    // sabanaDia.js) — informativa, igual que CONFIRMACION_CLIENTE: solo
    // deja constancia de qué se cambió, no hay nada que resolver.
    if (a.tipo === 'TICKET_EDITADO') {
      return '<div class="caja-alerta resuelta">' +
        '<div class="alerta-cabecera"><span>' + cabeceraTexto + '</span><span class="badge-resuelta">✏️ Ticket editado</span></div>' +
        '<div class="alerta-mensaje">' + a.mensaje + '</div></div>';
    }
    // Sábana eliminada/restaurada desde la pestaña "Sábanas" (03-09-2026,
    // ver services/papeleraSabana.js) — igual de informativa que
    // TICKET_EDITADO, pero con su propio badge para que se distinga de un
    // simple cambio de ticket (esto es lo que un empleado con mala
    // intención podría usar para "limpiar" jugadas, ver la nota grande en
    // papeleraSabana.js).
    if (a.tipo === 'SABANA_ELIMINADA') {
      return '<div class="caja-alerta resuelta">' +
        '<div class="alerta-cabecera"><span>' + cabeceraTexto + '</span><span class="badge-resuelta" style="background:#f3c6c6; color:#a33;">🗑️ Sábana eliminada</span></div>' +
        '<div class="alerta-mensaje">' + a.mensaje + '</div></div>';
    }
    if (a.tipo === 'SABANA_RESTAURADA') {
      return '<div class="caja-alerta resuelta">' +
        '<div class="alerta-cabecera"><span>' + cabeceraTexto + '</span><span class="badge-resuelta">♻️ Sábana restaurada</span></div>' +
        '<div class="alerta-mensaje">' + a.mensaje + '</div></div>';
    }
    if (a.resuelta) {
      // Una alerta AMBIGUA_DEPORTE resuelta trae deporte_resuelto; una
      // SIN_LOGRO descartada (no había deporte que elegir, ver
      // descartarAlertaGrupo más abajo) no trae ninguno — se muestra
      // "Descartada" en vez de "Resuelta como null" (28-08-2026).
      const badge = a.deporte_resuelto
        ? '<span class="badge-resuelta">✅ Resuelta como ' + (NOMBRES_DEPORTE[a.deporte_resuelto] || a.deporte_resuelto) + '</span>'
        : '<span class="badge-resuelta">✅ Descartada</span>';
      return '<div class="caja-alerta resuelta">' +
        '<div class="alerta-cabecera"><span>' + formatFechaHoraAlerta(a.creado_en) + ' — ' + (a.cliente_nombre || 'GENERAL') + (a.ticket_label ? ' — ' + a.ticket_label : '') + '</span>' +
        badge + '</div>' +
        '<div class="alerta-mensaje">' + a.mensaje + '</div></div>';
    }
    // Con candidatos (AMBIGUA_DEPORTE): elegir el deporte correcto y
    // "Resolver". Sin candidatos (ej. SIN_LOGRO, 28-08-2026 — a la jugada
    // le falta un número en la sábana, no hay ningún deporte que elegir):
    // el arreglo real es corregir el texto en la sábana y reprocesar, acá
    // solo hay un botón "Descartar" para sacarla de la lista de pendientes.
    const accion = candidatos.length > 0
      ? '<select id="alertaSelect-' + a.id + '">' + opciones + '</select>' +
        '<button type="button" class="btn-chico" onclick="resolverAlertaGrupo(\'' + a.id + '\')">Resolver</button>'
      : '<button type="button" class="btn-chico" onclick="descartarAlertaGrupo(\'' + a.id + '\')">Descartar (ya corregí la sábana)</button>';
    return '<div class="caja-alerta" id="alerta-' + a.id + '">' +
      '<div class="alerta-cabecera"><span>' + formatFechaHoraAlerta(a.creado_en) + ' — ' + (a.cliente_nombre || 'GENERAL') + (a.ticket_label ? ' — ' + a.ticket_label : '') + '</span><span>⏳ Pendiente</span></div>' +
      '<div class="alerta-mensaje">' + a.mensaje + '</div>' +
      '<div class="alerta-resolver">' + accion + '</div></div>';
  }).join('');
}

async function resolverAlertaGrupo(id) {
  const select = document.getElementById('alertaSelect-' + id);
  const deporte = select ? select.value : '';
  if (!deporte) { alert('Elige un deporte antes de resolver.'); return; }
  try {
    await api('/api/sabana/alertas/' + id + '/resolver', { method: 'POST', body: JSON.stringify({ deporte }) });
    alert('Listo — vuelve a procesar la sábana de esa fecha para que el ticket se recalcule con la corrección.');
    cargarAlertas();
    actualizarBadgeAlertas();
  } catch (e) {
    alert('No se pudo resolver la alerta: ' + e.message);
  }
}

// Descarta una alerta sin candidatos (ej. SIN_LOGRO) — ver el comentario
// de renderAlertas() y descartarAlerta() en src/services/alertas.js.
async function descartarAlertaGrupo(id) {
  try {
    await api('/api/sabana/alertas/' + id + '/descartar', { method: 'POST' });
    cargarAlertas();
    actualizarBadgeAlertas();
  } catch (e) {
    alert('No se pudo descartar la alerta: ' + e.message);
  }
}

// =================================================================
// CHAT DE SOPORTE (con el Súper-admin) — ver src/services/chat.js.
// Vive en la bandeja de chat flotante (burbuja abajo a la derecha, estilo
// Chatra/Intercom, 28-08-2026) — YA NO dentro de la pestaña 🔔 Alertas,
// que ahora solo muestra las notificaciones de tickets AMBIGUA (ver
// mostrarVista('alertas') más arriba). La burbuja titila mientras haya
// mensajes del Súper-admin sin leer (revisarNotificacionesFondo, cada
// 25s, corre siempre, sin importar en qué pestaña esté el Grupo).
// =================================================================
function toggleChatWidget() {
  CHAT_WIDGET_ABIERTO = !CHAT_WIDGET_ABIERTO;
  document.getElementById('chatWidgetPanel').style.display = CHAT_WIDGET_ABIERTO ? 'flex' : 'none';

  if (CHAT_WIDGET_ABIERTO) {
    // Al abrir: se van los mensajes, se marcan como leídos (apaga el
    // parpadeo y el badge) y se arranca un refresco cada 8s mientras esté
    // abierto, para que se sienta "en vivo" si el Súper-admin va
    // escribiendo. Al cerrar, ese refresco extra se detiene — el chequeo
    // de fondo de cada 25s (revisarNotificacionesFondo) sigue igual.
    cargarChatGrupo();
    if (CHAT_WIDGET_POLL_ABIERTO) clearInterval(CHAT_WIDGET_POLL_ABIERTO);
    CHAT_WIDGET_POLL_ABIERTO = setInterval(cargarChatGrupo, 8000);
  } else {
    if (CHAT_WIDGET_POLL_ABIERTO) { clearInterval(CHAT_WIDGET_POLL_ABIERTO); CHAT_WIDGET_POLL_ABIERTO = null; }
  }
}

// Minimiza (sin cerrar sesión) — se usa al cerrar sesión, para que la
// próxima vez que alguien entre la bandeja arranque cerrada.
function cerrarChatWidget() {
  CHAT_WIDGET_ABIERTO = false;
  const panel = document.getElementById('chatWidgetPanel');
  if (panel) panel.style.display = 'none';
}

async function actualizarBadgeChatWidget() {
  // Guarda de permiso (18-09-2026, ver tienePermiso() más arriba) — el
  // chat de soporte vive gateado por el mismo permiso 'alertas' del lado
  // del backend (ver routes/sabana.js).
  if (!tienePermiso('alertas')) return;
  try {
    const { total } = await api('/api/sabana/chat/conteo-no-leidos');
    const badge = document.getElementById('chatWidgetBadge');
    const burbuja = document.getElementById('chatWidgetBurbuja');
    if (!badge || !burbuja) return;
    // Si el panel ya está abierto, no hace falta ni el badge ni el
    // parpadeo — el Grupo ya está viendo la conversación.
    if (total > 0 && !CHAT_WIDGET_ABIERTO) {
      badge.textContent = total > 99 ? '99+' : total;
      badge.style.display = 'inline-block';
      burbuja.classList.add('parpadea');
    } else {
      badge.style.display = 'none';
      burbuja.classList.remove('parpadea');
    }
  } catch (e) { /* chequeo de fondo — si falla, no interrumpe nada más de la app */ }
}

async function cargarChatGrupo() {
  try {
    const mensajes = await api('/api/sabana/chat');
    renderChatMensajesGrupo(mensajes);
    await api('/api/sabana/chat/marcar-leidos', { method: 'POST' });
    actualizarBadgeChatWidget();
  } catch (e) {
    // no crítico — el chat simplemente queda vacío si algo falla
  }
}

function renderChatMensajesGrupo(mensajes) {
  const cont = document.getElementById('chatMensajes');
  if (mensajes.length === 0) {
    cont.innerHTML = '<p style="color:#888; font-size:13px; text-align:center;">Todavía no hay mensajes. Escríbele al Súper-admin abajo.</p>';
  } else {
    cont.innerHTML = mensajes.map(m =>
      '<div class="chat-burbuja ' + (m.remitente === 'grupo' ? 'propio' : 'otro') + '">' + escaparHtmlChat(m.texto) +
      '<span class="chat-hora">' + (m.remitente === 'grupo' ? 'Tú' : 'Súper-admin') + ' — ' + formatFechaHoraAlerta(m.creado_en) + '</span></div>'
    ).join('');
  }
  cont.scrollTop = cont.scrollHeight;
}

function escaparHtmlChat(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

async function enviarMensajeChatGrupo() {
  const textarea = document.getElementById('chatTexto');
  const texto = textarea.value.trim();
  if (!texto) return;
  try {
    await api('/api/sabana/chat', { method: 'POST', body: JSON.stringify({ texto }) });
    textarea.value = '';
    cargarChatGrupo();
  } catch (e) {
    alert('No se pudo enviar el mensaje: ' + e.message);
  }
}

// =================================================================
// 10. AUTO-LOGIN (si ya había un token guardado de una visita anterior)
// =================================================================
// Va al FINAL del archivo a propósito: mostrarApp() dispara, sincrónicamente,
// una cadena de llamadas (mostrarVista → usa VISTAS/NAV_IDS; cargarEquipos-
// Personalizados → usa EQUIPOS_PERSONALIZADOS_CACHE) que necesitan que esas
// variables "const"/"let" YA se hayan declarado. Si esta auto-entrada se
// dispara ANTES de esas líneas (como pasaba antes, cuando este bloque vivía
// arriba del archivo, justo después de definir mostrarApp), el navegador
// tira "Cannot access '...' before initialization" — la ejecución del script
// se corta ahí mismo y NINGUNA declaración de más abajo llega a inicializarse
// nunca, aunque las funciones sí queden definidas (se "izan" completas antes
// de correr nada). Por eso antes solo pasaba al recargar la página ya
// logueado (cuando había un token guardado) — con un login nuevo (sin token
// todavía) esta función no hace nada y el bug no se nota.
(function intentarSesionGuardada() {
  if (TOKEN && GRUPO) {
    mostrarApp();
  }
})();
