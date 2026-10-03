// =================================================================
// PRUEBA: "Copiar Imagen HD" del Detallado por Cliente parte en VARIAS
// imágenes (una por día) cuando el cliente tiene más de 1 día cargado
// (03-10-2026, a pedido del usuario: "cuando un cliente tenga así tantas
// jugadas, busca un formato que al darle click en copiar imagen, tanto
// tú como yo podamos apreciar todo bien" -- caso real "Sammy": con la
// semana completa en 1 sola imagen gigante -muchísimo más alta que
// ancha-, al comprimirla WhatsApp/el chat de Claude el ancho quedaba
// aplastado a unos pocos píxeles y los números eran ilegibles).
//
// Este archivo NO tiene navegador real ni jsdom disponible (sin
// node_modules/red, ver la nota de siempre en los demás tests de este
// repo) -- en vez de eso arma un DOM falso MÍNIMO a mano, con solo lo
// que usan generarYEntregarUnaImagenDetalle()/copiarDetalleClienteImagen()
// de public/hipismo-mockup.html (extraídas tal cual del archivo real con
// una regex, para probar el código que de verdad corre, no una copia
// reescrita a mano), y mockea html2canvas/clipboard/createElement para
// poder verificar el FLUJO DE CONTROL: cuántas imágenes se generan, en
// qué orden se ocultan/muestran los días, y que el estado de display se
// restaura al final.
// =================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function check(cond, msg) {
  if (cond) console.log('OK:', msg);
  else { console.log('FALLÓ:', msg); process.exitCode = 1; }
}

const html = fs.readFileSync(path.join(__dirname, '../public/hipismo-mockup.html'), 'utf8');

function extraerFuncion(nombre) {
  const regexAsync = new RegExp(`(?:async )?function ${nombre}\\([^)]*\\) \\{`);
  const m = regexAsync.exec(html);
  if (!m) throw new Error(`No se encontró "function ${nombre}" en hipismo-mockup.html`);
  const inicio = m.index;
  // Recorta por conteo de llaves hasta cerrar la función (mismo truco
  // simple que alcanza para código bien formado sin llaves dentro de
  // strings/regex raras en esta zona del archivo).
  let profundidad = 0, i = inicio, finCuerpo = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') profundidad++;
    else if (html[i] === '}') {
      profundidad--;
      if (profundidad === 0) { finCuerpo = i + 1; break; }
    }
  }
  if (finCuerpo === -1) throw new Error(`No se pudo recortar el cuerpo de ${nombre}`);
  return html.slice(inicio, finCuerpo);
}

const srcGenerar = extraerFuncion('generarYEntregarUnaImagenDetalle');
const srcCopiar = extraerFuncion('copiarDetalleClienteImagen');
// Carpeta "Semana NOMBRE (del día al día, semana X del año)" (03-10-2026,
// a pedido del usuario: "cuando se le de click en copiar imagen y sea mas
// de 1 imagen, descargalo en una carpeta llamada..." -- ver
// construirNombreCarpetaDetalleCliente en public/hipismo-mockup.html).
const srcLimpiar = extraerFuncion('limpiarParaNombreArchivo');
const srcFechaCarpeta = extraerFuncion('formatFechaCortaParaCarpeta');
const srcCarpeta = extraerFuncion('construirNombreCarpetaDetalleCliente');
const srcFormatNombre = extraerFuncion('formatNombre');
check(srcGenerar.includes('generarYEntregarUnaImagenDetalle'), 'Se pudo extraer generarYEntregarUnaImagenDetalle() tal cual del archivo real');
check(srcCopiar.includes('copiarDetalleClienteImagen'), 'Se pudo extraer copiarDetalleClienteImagen() tal cual del archivo real');
check(srcCarpeta.includes('construirNombreCarpetaDetalleCliente'), 'Se pudo extraer construirNombreCarpetaDetalleCliente() tal cual del archivo real');

// ---- DOM falso mínimo ----
function crearElemento(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    // En un navegador real, el.style.display de un elemento sin ningún
    // style inline puesto es '' (string vacío), NUNCA undefined -- se
    // arranca así acá para que la prueba de "se restauró el display
    // original" sea real (si no, undefined === undefined siempre pasaría
    // la prueba aunque el código tuviera un bug).
    style: { display: '' },
    dataset: {},
    children: [],
    classList: {
      _set: new Set(),
      contains(c) { return this._set.has(c); },
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); }
    },
    appendChild(child) { this.children.push(child); },
    removeChild(child) { this.children = this.children.filter(c => c !== child); },
    click() {},
    addEventListener() {}
  };
  return el;
}

function crearDiaFalso(claseExtra) {
  const el = crearElemento('div');
  el.classList.add('detmodal-dia');
  if (claseExtra) el.classList.add(claseExtra);
  return el;
}

function armarEntorno(cantidadDias, dataActual) {
  const contenido = crearElemento('div'); // #detalleClienteCaptura
  const contenedorDias = crearElemento('div'); // #detalleClienteDias
  const dias = [];
  for (let i = 0; i < cantidadDias; i++) {
    const d = crearDiaFalso();
    dias.push(d);
    contenedorDias.children.push(d);
  }
  const toastEl = crearElemento('span');
  const elementosPorId = {
    detalleClienteCaptura: contenido,
    detalleClienteDias: contenedorDias,
    toastDetalleCliente: toastEl
  };

  const llamadasHtml2canvas = [];
  const descargas = []; // cada download = {download: 'detalle_cliente_XdeY.png'}
  let copiasPortapapeles = 0;

  const fakeDocument = {
    getElementById: id => elementosPorId[id],
    createElement: tag => crearElemento(tag),
    body: { appendChild() {}, removeChild() {} }
  };
  const fakeWindow = {
    html2canvas: async (el) => {
      llamadasHtml2canvas.push(el);
      return {
        toBlob: (cb) => cb({ fake: true })
      };
    },
    navigator: {
      clipboard: {
        write: async () => { copiasPortapapeles++; }
      }
    },
    ClipboardItem: function (x) { this.x = x; },
    URL: { createObjectURL: () => 'blob://fake' },
    requestAnimationFrame: (cb) => cb(),
    Promise
  };

  const sandbox = {
    document: fakeDocument,
    html2canvas: fakeWindow.html2canvas,
    navigator: fakeWindow.navigator,
    ClipboardItem: fakeWindow.ClipboardItem,
    URL: fakeWindow.URL,
    requestAnimationFrame: fakeWindow.requestAnimationFrame,
    console,
    Promise,
    setTimeout,
    String,
    DETALLE_CLIENTE_DATA_ACTUAL: dataActual || null,
    mostrarToastDetalleCliente: (msg) => { toastEl.textContent = msg; }
  };
  // Parchar createElement('a') para registrar las "descargas" (el click
  // en el <a download="..."> simulado).
  const origCreateElement = fakeDocument.createElement;
  fakeDocument.createElement = (tag) => {
    const el = origCreateElement(tag);
    if (tag === 'a') {
      el.click = () => { descargas.push(el.download); };
    }
    return el;
  };

  vm.createContext(sandbox);
  vm.runInContext(srcFormatNombre + '\n' + srcLimpiar + '\n' + srcFechaCarpeta + '\n' + srcCarpeta + '\n' + srcGenerar + '\n' + srcCopiar, sandbox);

  return { sandbox, contenido, contenedorDias, dias, descargas, getCopias: () => copiasPortapapeles, getLlamadas: () => llamadasHtml2canvas };
}

(async () => {
  // --- Caso 1: UN SOLO día -> comportamiento de siempre (1 imagen, portapapeles) ---
  {
    const env = armarEntorno(1);
    await env.sandbox.copiarDetalleClienteImagen();
    check(env.getLlamadas().length === 1, 'Con 1 solo día: html2canvas se llama 1 sola vez (sin partir en varias imágenes)');
    check(env.getCopias() === 1, 'Con 1 solo día: se copia al portapapeles (comportamiento de siempre), no se descarga nada');
    check(env.descargas.length === 0, 'Con 1 solo día: NO se dispara ninguna descarga de archivo');
    check(env.dias[0].style.display === '', 'Con 1 solo día: el único bloque de día queda visible (nunca se tocó su display)');
  }

  // --- Caso 2: VARIOS días (caso Sammy: 4 días) -> 1 imagen por día, todas
  //     descargadas DENTRO de la carpeta "Semana NOMBRE (...)" ---
  {
    const dataSammy = {
      jugador: { nombre: 'SAMMY' },
      rango: { desde: '2026-10-01', hasta: '2026-10-03' },
      numeroSemana: { semana: 40, anio: 2026 }
    };
    const env = armarEntorno(4, dataSammy);
    await env.sandbox.copiarDetalleClienteImagen();
    check(env.getLlamadas().length === 4, 'Con 4 días: html2canvas se llama 4 veces (1 imagen por día, en vez de 1 imagen gigante con los 4 juntos)');
    check(env.getCopias() === 0, 'Con varios días: NUNCA se usa el portapapeles (no tiene sentido pisarlo 4 veces seguidas en el mismo click)');
    check(env.descargas.length === 4, 'Con 4 días: se disparan 4 descargas, una por cada imagen');
    const carpetaEsperada = 'Semana Sammy (01-10-2026 al 03-10-2026, semana 40 del 2026)';
    check(env.descargas.every((nombre, i) => nombre === `${carpetaEsperada}/detalle_cliente_${i + 1}de4.png`),
      `Cada descarga cae DENTRO de la carpeta "${carpetaEsperada}" (el "/" en el nombre hace que Chrome/Edge creen esa subcarpeta en Descargas), con un nombre que identifica su día dentro de la tanda (1de4..4de4): obtenido ${JSON.stringify(env.descargas)}`);
    check(env.dias.every(d => d.style.display === ''), 'Al terminar, TODOS los días vuelven a quedar visibles (se restauró el display original de cada uno)');
  }

  // --- Caso 2b: varios días pero SIN datos para armar la carpeta (no
  //     debería pasar nunca en la app real, el botón espera a que cargue)
  //     -> cae de vuelta a descargar suelto, sin reventar. ---
  {
    const env = armarEntorno(2, null);
    await env.sandbox.copiarDetalleClienteImagen();
    check(env.descargas.length === 2, 'Sin datos de cliente/rango: igual se descargan las 2 imágenes (no revienta)');
    check(env.descargas.every((nombre, i) => nombre === `detalle_cliente_${i + 1}de2.png`),
      `Sin datos para armar la carpeta, el nombre de archivo queda suelto (sin "/"), igual que antes de este cambio: obtenido ${JSON.stringify(env.descargas)}`);
  }

  // --- Caso 3: durante la tanda, en cada captura solo 1 día está visible a la vez ---
  {
    const env = armarEntorno(3);
    const visiblesPorCaptura = [];
    const origHtml2canvas = env.sandbox.html2canvas;
    env.sandbox.html2canvas = async (el) => {
      visiblesPorCaptura.push(env.dias.map(d => d.style.display !== 'none'));
      return origHtml2canvas(el);
    };
    await env.sandbox.copiarDetalleClienteImagen();
    check(visiblesPorCaptura.length === 3, 'Se hicieron 3 capturas para 3 días');
    check(visiblesPorCaptura.every(v => v.filter(Boolean).length === 1),
      `En CADA captura solo 1 día queda visible a la vez (nunca 2+ juntos, que es justo lo que generaba la imagen gigante): obtenido ${JSON.stringify(visiblesPorCaptura)}`);
    check(visiblesPorCaptura[0][0] && !visiblesPorCaptura[0][1] && !visiblesPorCaptura[0][2], 'La 1ra captura muestra el día 1 (y oculta el 2 y el 3)');
    check(!visiblesPorCaptura[1][0] && visiblesPorCaptura[1][1] && !visiblesPorCaptura[1][2], 'La 2da captura muestra el día 2 (y oculta el 1 y el 3)');
    check(!visiblesPorCaptura[2][0] && !visiblesPorCaptura[2][1] && visiblesPorCaptura[2][2], 'La 3ra captura muestra el día 3 (y oculta el 1 y el 2)');
  }

  const totalLinea = process.exitCode ? 'con fallos' : 'sin fallos';
  console.log(`\nPrueba de "Copiar Imagen HD" por día terminada ${totalLinea}.`);
})();
