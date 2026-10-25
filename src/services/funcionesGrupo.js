// =================================================================
// FUNCIONES POR SECCIÓN DE CADA GRUPO (13-10-2026, a pedido del usuario: "un panel de control donde, a la hora de
// crear un grupo, pueda elegir qué puede usar y qué no de todo lo que tenemos" — respondió "HAZLO POR SECCION").
//
// Hasta ahora el Súper-admin solo prendía/apagaba 3 módulos enteros (Deportes, Hipismo, Hipismo Oficinas) y el
// administrador del grupo repartía permisos a sus empleados. Faltaba el nivel del medio: qué SECCIONES de cada módulo
// tiene contratadas un grupo. Este archivo es el CATÁLOGO ÚNICO de esas secciones (de acá salen el panel de Súper-admin,
// el menú de la pantalla y el candado del servidor):
//
//   - grupos.funciones_habilitadas (jsonb, ver sql/schema.sql): NULL = el grupo tiene TODAS las secciones (así los
//     grupos que ya existen no cambian en nada); un array = SOLO esas claves (lista de encendidas).
//   - Se combina con los permisos de empleado: un empleado ve lo que el grupo tiene Y el administrador le habilitó.
//   - Lo que NO está en el catálogo queda siempre disponible: Ajustes (Usuarios/Seguridad), Pagos a Ludox, chat interno,
//     y las lecturas compartidas que usan varias pantallas (cierre final, listas de hipódromos/clientes, alertas flotantes).
//
// Deportes: la clave de cada sección ES la clave de permiso que ya existe (sabana, polla, …) — así el candado de
// requierePermiso() (middleware/auth.js) sirve para las dos cosas. Hipismo: claves "hip_*", con la lista de pantallas
// del menú (data-vista de hipismo-mockup.html) y las rutas de /api/hipismo que protege cada una.
// =================================================================

const MODULOS = {
  deportes: 'Deportes',
  hipismo: 'Hipismo'
};

// ---------- Deportes (claves = PERMISOS_VALIDOS de middleware/auth.js, menos 'pagos' y 'hipismo') ----------
const FUNCIONES_DEPORTES = [
  { clave: 'sabana', modulo: 'deportes', nombre: 'Sábana', descripcion: 'Cargar y ver las jugadas del día, tickets y pizarra.' },
  { clave: 'sabanas', modulo: 'deportes', nombre: 'Sábanas (histórico y papelera)', descripcion: 'Días ya procesados y papelera.' },
  { clave: 'whatsapp', modulo: 'deportes', nombre: 'Sábana automática por WhatsApp', descripcion: 'Lectura del grupo de WhatsApp y comandos.' },
  { clave: 'equipos', modulo: 'deportes', nombre: 'Apodos de equipos', descripcion: 'Registro de equipos y apodos.' },
  { clave: 'jugador', modulo: 'deportes', nombre: 'Jugadores, comisión y avales', descripcion: 'Ficha de clientes, comisión propia, avalados y moneda.' },
  { clave: 'porcentajes', modulo: 'deportes', nombre: '% Devueltos', descripcion: 'Porcentajes devueltos a clientes.' },
  { clave: 'balanceGeneral', modulo: 'deportes', nombre: 'Balance General', descripcion: 'Balance general de la semana.' },
  { clave: 'transferencias', modulo: 'deportes', nombre: 'Transferencias', descripcion: 'Transferencias entre clientes.' },
  { clave: 'polla', modulo: 'deportes', nombre: 'Polla', descripcion: 'Módulo de polla.' },
  { clave: 'alertas', modulo: 'deportes', nombre: 'Alertas y chat interno', descripcion: 'Alertas del sistema y chat.' },
  { clave: 'descargar', modulo: 'deportes', nombre: 'Descargar (Saldos Semana, Excel, PDF)', descripcion: 'Reportes descargables.' }
];

// ---------- Hipismo (una sección = un grupo de pantallas del menú) ----------
const FUNCIONES_HIPISMO = [
  { clave: 'hip_planos', modulo: 'hipismo', nombre: 'Cargar Planos', descripcion: 'Cargar, validar y eliminar planos; planos eliminados; traspasos de jugadas; montos apostados.',
    vistas: ['cargarPlanos', 'validarPlano', 'eliminarPlanos', 'planosEliminados', 'traspasosJugadas', 'montosApostados'] },
  { clave: 'hip_carga_masiva', modulo: 'hipismo', nombre: 'Carga Masiva Especial', descripcion: 'Cargas masivas especiales de jugadas.', vistas: ['cargaMasivaEspecial'] },
  { clave: 'hip_remates', modulo: 'hipismo', nombre: 'Remates', descripcion: 'Remate automático desde chat y remate manual.', vistas: ['cargarRemate', 'cargarRemateManual'] },
  { clave: 'hip_adelantadas', modulo: 'hipismo', nombre: 'Tablas Fijas, Marcas y Tercios Adelantadas', descripcion: 'Jugadas adelantadas, tercios adelantadas, revisiones de tablas/marcas y banqueo.',
    vistas: ['jugadasAdelantadas', 'terciosAdelantadas', 'revTablasMarcas', 'revAdelantadasClientes', 'banqueoMarcas'] },
  { clave: 'hip_winners', modulo: 'hipismo', nombre: 'Winners', descripcion: 'Cargar y eliminar winners.', vistas: ['cargarWinners', 'eliminarWinners'] },
  { clave: 'hip_pozos', modulo: 'hipismo', nombre: 'Pozos', descripcion: 'Pozo de cada cliente, saldos + pozos y plano de pozos.', vistas: ['pozos'] },
  { clave: 'hip_saldos', modulo: 'hipismo', nombre: 'Saldos y Cierre', descripcion: 'Detallado por cliente, semana por días, balance general y cierre final.',
    vistas: ['detalladoCliente', 'semanaPorDias', 'balanceGeneral', 'cierreFinal', 'balanceSocios'] },
  { clave: 'hip_grupo_clientes', modulo: 'hipismo', nombre: 'Grupos de Clientes', descripcion: 'Agrupar clientes y sus cuadres.', vistas: ['grupoClientes'] },
  { clave: 'hip_comisiones', modulo: 'hipismo', nombre: 'Comisiones', descripcion: 'Comisión por carrera, por hipódromo, devueltas, saldo de comisiones y grupo sin devoluciones.',
    vistas: ['comisionesPorCarrera', 'comisionesTotalesPorHipodromo', 'comisionesDevueltasPorHipodromo', 'comisionesDevueltas', 'saldoComisiones', 'comisionesSinDevoluciones', 'comisionesSocios'] },
  { clave: 'hip_clientes', modulo: 'hipismo', nombre: 'Clientes, Avales y Registro de Saldos', descripcion: 'Ficha de clientes, avales y depósitos, registro de saldos.',
    vistas: ['clientes', 'avales', 'registroSaldos'] },
  { clave: 'hip_finanzas', modulo: 'hipismo', nombre: 'Retiros, Traspasos de Saldo y Gastos', descripcion: 'Movimientos de dinero del grupo.', vistas: ['retiros', 'traspasos', 'gastos'] },
  { clave: 'hip_hipodromos', modulo: 'hipismo', nombre: 'Hipódromos y Pizarras', descripcion: 'Alta de hipódromos y edición de pizarras.', vistas: ['hipodromos', 'pizarras'] },
  { clave: 'hip_revisar', modulo: 'hipismo', nombre: 'Revisar Jugadas', descripcion: 'Revisión de jugadas cargadas.', vistas: ['revisarJugadas'] },
  { clave: 'hip_ajustes_calculo', modulo: 'hipismo', nombre: 'Ajustes de cálculo', descripcion: 'Fecha de semana y cabeza/pie de plano.', vistas: ['fechaSemana', 'cabezaPie'] },
  { clave: 'hip_mantenimiento', modulo: 'hipismo', nombre: 'Eliminar Jornada', descripcion: 'Borrar una jornada completa.', vistas: ['eliminarJornada'] },
  { clave: 'hip_alertas', modulo: 'hipismo', nombre: 'Alertas de Hipismo', descripcion: 'Registro de ediciones y eliminaciones.', vistas: ['alertasHipismo'] },
  { clave: 'hip_link_cliente', modulo: 'hipismo', nombre: 'Link del cliente', descripcion: 'Página pública donde cada cliente ve sus jugadas.', vistas: [] }
];

const FUNCIONES = FUNCIONES_DEPORTES.concat(FUNCIONES_HIPISMO);
const CLAVES_VALIDAS = FUNCIONES.map(f => f.clave);
const CLAVES_DEPORTES = FUNCIONES_DEPORTES.map(f => f.clave);
const CLAVES_HIPISMO = FUNCIONES_HIPISMO.map(f => f.clave);

// ---------- Paquetes (atajos para marcar muchas de una vez; después se afina) ----------
const PAQUETES = {
  completo: { nombre: 'Completo', claves: CLAVES_VALIDAS },
  deportes_basico: { nombre: 'Deportes básico', claves: ['sabana', 'sabanas', 'equipos', 'jugador', 'balanceGeneral', 'descargar'] },
  hipismo_basico: { nombre: 'Hipismo básico', claves: ['hip_planos', 'hip_adelantadas', 'hip_winners', 'hip_pozos', 'hip_saldos', 'hip_clientes', 'hip_hipodromos', 'hip_alertas', 'hip_link_cliente'] },
  hipismo_sin_comisiones: { nombre: 'Hipismo sin comisiones ni mantenimiento', claves: CLAVES_HIPISMO.filter(c => !['hip_comisiones', 'hip_mantenimiento'].includes(c)) }
};

// ---------- Estado de un grupo ----------
// null/undefined = todas encendidas (grupos existentes). Un array = solo esas.
function normalizarFunciones(lista) {
  if (lista === null || lista === undefined) return null;
  if (!Array.isArray(lista)) return null;
  const unicas = new Set(lista.filter(c => CLAVES_VALIDAS.includes(c)));
  return CLAVES_VALIDAS.filter(c => unicas.has(c)); // orden estable del catálogo
}

// funcionesDelGrupo: grupo (fila con .funciones_habilitadas) o directo el valor guardado.
function funcionHabilitada(grupoOLista, clave) {
  if (!CLAVES_VALIDAS.includes(clave)) return true; // lo que no está en el catálogo no se restringe
  const valor = (grupoOLista && !Array.isArray(grupoOLista) && typeof grupoOLista === 'object' && 'funciones_habilitadas' in grupoOLista)
    ? grupoOLista.funciones_habilitadas : grupoOLista;
  const lista = normalizarFunciones(valor);
  if (lista === null) return true;
  return lista.includes(clave);
}

// Lista efectiva de claves encendidas (siempre array) — para mandarla al panel/pantalla.
function funcionesEfectivas(grupoOLista) {
  const valor = (grupoOLista && !Array.isArray(grupoOLista) && typeof grupoOLista === 'object' && 'funciones_habilitadas' in grupoOLista)
    ? grupoOLista.funciones_habilitadas : grupoOLista;
  const lista = normalizarFunciones(valor);
  return lista === null ? CLAVES_VALIDAS.slice() : lista;
}

// ---------- Candado de rutas de /api/hipismo ----------
// [métodos, regex sobre la ruta (sin /api/hipismo), secciones (basta UNA encendida)]. La primera que coincide manda; lo que no
// coincide con ninguna queda libre (lecturas compartidas por varias pantallas, alertas flotantes, chat, oficinas, ajustes).
const TODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const ESCRIBIR = ['POST', 'PUT', 'PATCH', 'DELETE'];
const REGLAS_RUTAS_HIPISMO = [
  // Cargar Planos
  [['GET'], /^\/planos\/papelera/, ['hip_planos']],
  [['POST', 'PUT', 'PATCH', 'DELETE'], /^\/planos(\/|$)/, ['hip_planos']],
  [['GET'], /^\/planos\/[^/]+\/copia$/, ['hip_planos', 'hip_saldos']],
  [TODOS, /^\/traspasos\/jugadas?$/, ['hip_planos']],
  [['GET'], /^\/montos-apostados/, ['hip_planos']],
  // Carga masiva
  [TODOS, /^\/cargas-especiales/, ['hip_carga_masiva']],
  // Remates
  [TODOS, /^\/remates/, ['hip_remates']],
  // Tablas fijas, marcas y tercios adelantadas
  [ESCRIBIR, /^\/adelantadas/, ['hip_adelantadas']],
  [['GET'], /^\/adelantadas(\/(?!pendientes|banqueadores)[^/]+)?$/, ['hip_adelantadas', 'hip_saldos']],
  [ESCRIBIR, /^\/tercios-adelantadas/, ['hip_adelantadas']],
  [['GET'], /^\/revision\//, ['hip_adelantadas']],
  [['PUT'], /^\/(marcas|tf)-banqueo-config$/, ['hip_adelantadas']],
  // Winners
  [TODOS, /^\/winners/, ['hip_winners']],
  // Pozos
  [TODOS, /^\/pozos-plano-excluidos$/, ['hip_pozos']],
  // Saldos y cierre
  [['GET'], /^\/balance-general/, ['hip_saldos']],
  [['GET'], /^\/balance-socios/, ['hip_saldos']],
  [['GET'], /^\/semana-por-dias/, ['hip_saldos']],
  [['GET'], /^\/diagnostico-saldos/, ['hip_saldos']],
  [['GET'], /^\/clientes\/[^/]+\/detalle-semana/, ['hip_saldos', 'hip_comisiones', 'hip_grupo_clientes', 'hip_pozos', 'hip_clientes']],
  // Grupos de clientes
  [ESCRIBIR, /^\/grupos-clientes/, ['hip_grupo_clientes']],
  [['GET'], /^\/grupos-clientes/, ['hip_grupo_clientes', 'hip_saldos']],
  // Comisiones
  [['GET'], /^\/(comisiones-por-carrera|comisiones-por-hipodromo|comisiones-devueltas|comisiones-devueltas-por-hipodromo|comisiones-sin-devoluciones|saldo-comisiones)/, ['hip_comisiones', 'hip_saldos']],
  // Clientes / finanzas
  [['POST'], /^\/comisiones\/traspaso$/, ['hip_clientes', 'hip_finanzas']],
  [TODOS, /^\/traspasos-saldo/, ['hip_finanzas', 'hip_clientes']],
  [TODOS, /^\/retiros/, ['hip_finanzas']],
  [['GET'], /^\/comisiones-socios/, ['hip_comisiones', 'hip_saldos']],
  [['GET'], /^\/registro-saldos/, ['hip_clientes', 'hip_saldos']],
  // Hipódromos y pizarras
  [ESCRIBIR, /^\/hipodromos/, ['hip_hipodromos']],
  [TODOS, /^\/pizarras/, ['hip_hipodromos', 'hip_revisar', 'hip_adelantadas', 'hip_remates', 'hip_planos']],
  // Revisar jugadas
  [['GET'], /^\/revisar-jugadas/, ['hip_revisar']],
  // Ajustes de cálculo
  [['PUT'], /^\/semana-config$/, ['hip_ajustes_calculo']],
  // Mantenimiento
  [TODOS, /^\/jornada\//, ['hip_mantenimiento']]
];

// Devuelve la lista de secciones (basta una) que habilita esta ruta, o null si es de uso libre.
function seccionesDeRutaHipismo(metodo, ruta) {
  const m = String(metodo || 'GET').toUpperCase();
  const r = String(ruta || '').split('?')[0].replace(/\/+$/, '') || '/';
  for (const [metodos, regex, secciones] of REGLAS_RUTAS_HIPISMO) {
    if (metodos.includes(m) && regex.test(r)) return secciones;
  }
  return null;
}

// ¿Esta ruta de /api/hipismo está permitida para este grupo? (true = pasa)
function rutaHipismoPermitida(grupo, metodo, ruta) {
  const secciones = seccionesDeRutaHipismo(metodo, ruta);
  if (!secciones) return true;
  return secciones.some(c => funcionHabilitada(grupo, c));
}

// Vista del menú (data-vista) -> clave de sección, o null si no está restringida (ej. usuarios, seguridad, preferencias).
function seccionDeVistaHipismo(vista) {
  const f = FUNCIONES_HIPISMO.find(x => (x.vistas || []).includes(vista));
  return f ? f.clave : null;
}

module.exports = {
  MODULOS,
  FUNCIONES,
  FUNCIONES_DEPORTES,
  FUNCIONES_HIPISMO,
  CLAVES_VALIDAS,
  CLAVES_DEPORTES,
  CLAVES_HIPISMO,
  PAQUETES,
  normalizarFunciones,
  funcionHabilitada,
  funcionesEfectivas,
  seccionesDeRutaHipismo,
  rutaHipismoPermitida,
  seccionDeVistaHipismo
};
