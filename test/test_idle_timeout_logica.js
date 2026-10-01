// =================================================================
// PRUEBA: lógica de "cierre de sesión por inactividad" (01-10-2026, a
// pedido del usuario: "si alguna sesion ya sea super admin o algun grupo
// dura mas de 1 hora sin tener actividad, cerrar la sesion y deven
// loguearse, le dejas un mesajen que la sesion fue cerrada por
// inactividad").
//
// Esto NO puede probarse como el resto de las pruebas de este repo
// (mockeando pg/express y llamando una ruta): es lógica 100% de
// localStorage dentro de app.js/hipismo-mockup.html/superadmin.html, sin
// ningún endpoint de por medio. En vez de reimplementar la fórmula a
// mano acá (lo que dejaría esta prueba sin detectar si alguien rompe el
// código real), se EXTRAE el bloque real de registrarActividad()/
// revisarInactividad() de public/app.js tal cual está escrito, y se corre
// con un `localStorage`/`document`/`cerrarSesion` falsos via vm — mismo
// espíritu que test_hipismo_alertas_tipo_check.js (que lee el código real
// como texto), aplicado acá a una porción ejecutable en vez de una
// comparación textual.
//
// Casos cubiertos:
//   1. Sin ninguna marca de actividad todavía: revisarInactividad() NO
//      cierra sesión — deja puesta la marca de "ahora" y sigue.
//   2. Con actividad de hace Menos de 1 hora: NO cierra sesión.
//   3. Con actividad de hace MÁS de 1 hora: SÍ cierra sesión, con el
//      mensaje exacto pedido por el usuario, usando la MISMA clave de
//      localStorage ('zenyatta_ultima_actividad') que después
//      consumen/comparten hipismo-mockup.html y el resto de la app.
//   4. registrarActividad() respeta el throttle (~5s): 2 llamadas
//      seguidas NO generan 2 escrituras distintas a localStorage.
//   5. Sin sesión (TOKEN null): revisarInactividad() no hace nada (no
//      explota, no cierra nada que no esté abierto).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const codigoAppJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

const inicioMarcador = '// =================================================================\n// CIERRE DE SESIÓN POR INACTIVIDAD (01-10-2026';
const finMarcador = 'setInterval(revisarInactividad, 30000);';
const inicio = codigoAppJs.indexOf(inicioMarcador);
const fin = codigoAppJs.indexOf(finMarcador);
if (inicio === -1 || fin === -1) {
  throw new Error('No se encontró el bloque de cierre por inactividad en public/app.js — ¿cambiaron los comentarios/nombres? Actualiza los marcadores de esta prueba.');
}
// Se corta ANTES de los addEventListener/setInterval reales (necesitan un
// DOM/timers de verdad que no hace falta simular acá) — solo se evalúan
// las 2 funciones + la constante, que es donde vive toda la lógica a
// probar.
const bloqueFuncionesInicio = codigoAppJs.indexOf('const MS_INACTIVIDAD_MAXIMA', inicio);
const bloqueFuncionesFin = codigoAppJs.indexOf("['click', 'keydown'", inicio);
const codigoAEvaluar = codigoAppJs.slice(bloqueFuncionesInicio, bloqueFuncionesFin);

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function nuevoContexto({ token, ahoraFalsa }) {
  const store = {};
  const fakeLocalStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const llamadasCerrarSesion = [];
  const sandbox = {
    localStorage: fakeLocalStorage,
    TOKEN: token,
    cerrarSesion: (mensaje) => { llamadasCerrarSesion.push(mensaje); },
    Date: { now: () => ahoraFalsa }
  };
  vm.createContext(sandbox);
  vm.runInContext(codigoAEvaluar, sandbox);
  return { sandbox, store, llamadasCerrarSesion };
}

(function main() {
  const AHORA = 10_000_000; // instante arbitrario, en ms
  const UNA_HORA_MS = 60 * 60 * 1000;

  // --- 1) Sin ninguna marca de actividad todavía ---
  {
    const { sandbox, store, llamadasCerrarSesion } = nuevoContexto({ token: 'tok-1', ahoraFalsa: AHORA });
    const cerro = sandbox.revisarInactividad();
    check(cerro === false, '1) Sin marca previa, revisarInactividad() NO cierra sesión');
    check(llamadasCerrarSesion.length === 0, '1) No se llamó a cerrarSesion()');
    check(store['zenyatta_ultima_actividad'] === String(AHORA), '1) Se dejó puesta una marca de actividad con "ahora"');
  }

  // --- 2) Actividad de hace MENOS de 1 hora: no cierra ---
  {
    const { sandbox, llamadasCerrarSesion } = nuevoContexto({ token: 'tok-1', ahoraFalsa: AHORA });
    sandbox.localStorage.setItem('zenyatta_ultima_actividad', String(AHORA - (UNA_HORA_MS - 60_000))); // 59 min atrás
    const cerro = sandbox.revisarInactividad();
    check(cerro === false, '2) Con actividad de hace 59 minutos, NO cierra sesión');
    check(llamadasCerrarSesion.length === 0, '2) No se llamó a cerrarSesion()');
  }

  // --- 3) Actividad de hace MÁS de 1 hora: SÍ cierra, con el mensaje pedido ---
  {
    const { sandbox, llamadasCerrarSesion } = nuevoContexto({ token: 'tok-1', ahoraFalsa: AHORA });
    sandbox.localStorage.setItem('zenyatta_ultima_actividad', String(AHORA - (UNA_HORA_MS + 60_000))); // 61 min atrás
    const cerro = sandbox.revisarInactividad();
    check(cerro === true, '3) Con actividad de hace 61 minutos, SÍ cierra sesión (revisarInactividad() devuelve true)');
    check(llamadasCerrarSesion.length === 1, '3) Se llamó a cerrarSesion() exactamente una vez');
    check(/inactividad/i.test(llamadasCerrarSesion[0] || ''), '3) El mensaje de cerrarSesion() menciona "inactividad" (pedido textual del usuario)');
  }

  // --- 4) registrarActividad() respeta el throttle (~5s) ---
  {
    const { sandbox, store } = nuevoContexto({ token: 'tok-1', ahoraFalsa: AHORA });
    sandbox.registrarActividad();
    const primeraMarca = store['zenyatta_ultima_actividad'];
    sandbox.Date.now = () => AHORA + 1000; // 1s después, dentro del throttle de 5s
    sandbox.registrarActividad();
    check(store['zenyatta_ultima_actividad'] === primeraMarca, '4) Una segunda llamada 1s después NO vuelve a escribir (throttle de ~5s)');
    sandbox.Date.now = () => AHORA + 6000; // 6s después, fuera del throttle
    sandbox.registrarActividad();
    check(store['zenyatta_ultima_actividad'] === String(AHORA + 6000), '4) Una llamada 6s después SÍ vuelve a escribir (ya pasó el throttle)');
  }

  // --- 5) Sin sesión (TOKEN null): no hace nada ---
  {
    const { sandbox, llamadasCerrarSesion } = nuevoContexto({ token: null, ahoraFalsa: AHORA });
    sandbox.localStorage.setItem('zenyatta_ultima_actividad', String(AHORA - (UNA_HORA_MS + 60_000)));
    const cerro = sandbox.revisarInactividad();
    check(cerro === false, '5) Sin TOKEN, revisarInactividad() no hace nada (devuelve false)');
    check(llamadasCerrarSesion.length === 0, '5) Sin TOKEN, no se llama a cerrarSesion() aunque la marca esté vieja');
  }

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
