// =================================================================
// PRUEBA: las copias de "cierre de sesión por inactividad" en
// hipismo-mockup.html y superadmin.html (01-10-2026) — hermana de
// test_idle_timeout_logica.js (que prueba la versión de app.js). Estas 2
// páginas DUPLICAN la lógica a propósito (no cargan app.js, ver la nota
// grande junto a registrarActividadHip() en hipismo-mockup.html) con
// nombres de función propios, así que un typo al copiar/pegar (ej. una
// clave de localStorage mal escrita que ya no coincide con la de
// app.js, rompiendo el "comparten sesión") no lo detectaría ninguna otra
// prueba — de ahí esta prueba aparte.
//
// Casos cubiertos, para CADA una de las 2 páginas:
//   1. Sin marca de actividad todavía: no cierra, deja puesta "ahora".
//   2. Actividad de hace MÁS de 1 hora: SÍ cierra, con el mensaje
//      pedido ("...por inactividad...").
//   3. hipismo-mockup.html específicamente usa la MISMA clave de
//      localStorage ('zenyatta_ultima_actividad') que ya usa app.js —
//      si esto se rompe, un operador que pasa de Deportes a Hipismo (o
//      viceversa) perdería el conteo de inactividad real.
//   4. superadmin.html usa su PROPIA clave
//      ('zenyatta_superadmin_ultima_actividad'), nunca la de Grupo/
//      Hipismo — son 2 sesiones independientes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

function extraerBloque(archivo, inicioTexto, finTexto) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', archivo), 'utf8');
  const inicio = codigo.indexOf(inicioTexto);
  const fin = codigo.indexOf(finTexto, inicio);
  if (inicio === -1 || fin === -1) {
    throw new Error(`No se encontró el bloque esperado en public/${archivo} (¿cambiaron los nombres? actualiza los marcadores de esta prueba).`);
  }
  return codigo.slice(inicio, fin);
}

(function main() {
  const AHORA = 10_000_000;
  const UNA_HORA_MS = 60 * 60 * 1000;

  // ---- hipismo-mockup.html ----
  {
    const codigo = extraerBloque('hipismo-mockup.html', 'const MS_THROTTLE_ACTIVIDAD_HIP', "['click', 'keydown'");
    const store = {};
    const fakeLocalStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
    const llamadas = [];
    const sandbox = {
      localStorage: fakeLocalStorage,
      TOKEN: 'tok-hip',
      MS_INACTIVIDAD_MAXIMA_HIP: UNA_HORA_MS,
      cerrarSesionHipismo: (mensaje) => { llamadas.push(mensaje); },
      Date: { now: () => AHORA }
    };
    vm.createContext(sandbox);
    vm.runInContext(codigo, sandbox);

    sandbox.revisarInactividadHip();
    check(store['zenyatta_ultima_actividad'] === String(AHORA), 'hipismo-mockup.html 1) Sin marca previa, deja puesta "ahora" en LA MISMA clave que app.js (zenyatta_ultima_actividad)');
    check(llamadas.length === 0, 'hipismo-mockup.html 1) No cierra sesión sin marca previa');

    store['zenyatta_ultima_actividad'] = String(AHORA - (UNA_HORA_MS + 60_000));
    sandbox.revisarInactividadHip();
    check(llamadas.length === 1, 'hipismo-mockup.html 2) Con actividad de hace 61 minutos, cierra sesión (cerrarSesionHipismo)');
    check(/inactividad/i.test(llamadas[0] || ''), 'hipismo-mockup.html 2) El mensaje menciona "inactividad"');
  }

  // ---- superadmin.html ----
  {
    const codigo = extraerBloque('superadmin.html', 'const MS_INACTIVIDAD_MAXIMA_SA', "['click', 'keydown'");
    const store = {};
    const fakeLocalStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
    const llamadasSalir = [];
    const llamadasMostrarAcceso = [];
    const sandbox = {
      localStorage: fakeLocalStorage,
      SECRET: 'sec-sa',
      salir: () => { llamadasSalir.push(true); },
      mostrarAcceso: (mensaje) => { llamadasMostrarAcceso.push(mensaje); },
      Date: { now: () => AHORA }
    };
    vm.createContext(sandbox);
    vm.runInContext(codigo, sandbox);

    sandbox.revisarInactividadSuperadmin();
    check(store['zenyatta_superadmin_ultima_actividad'] === String(AHORA), 'superadmin.html 1) Sin marca previa, deja puesta "ahora" en SU PROPIA clave (zenyatta_superadmin_ultima_actividad)');
    check(store['zenyatta_ultima_actividad'] === undefined, 'superadmin.html 1) NUNCA toca la clave de Grupo/Hipismo (zenyatta_ultima_actividad) — sesiones independientes');
    check(llamadasSalir.length === 0, 'superadmin.html 1) No cierra sesión sin marca previa');

    store['zenyatta_superadmin_ultima_actividad'] = String(AHORA - (UNA_HORA_MS + 60_000));
    const cerro = sandbox.revisarInactividadSuperadmin();
    check(cerro === true, 'superadmin.html 2) Con actividad de hace 61 minutos, revisarInactividadSuperadmin() devuelve true');
    check(llamadasSalir.length === 1, 'superadmin.html 2) Llama a salir() exactamente una vez');
    check(llamadasMostrarAcceso.length === 1 && /inactividad/i.test(llamadasMostrarAcceso[0] || ''), 'superadmin.html 2) Llama a mostrarAcceso() con un mensaje que menciona "inactividad"');
  }

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
