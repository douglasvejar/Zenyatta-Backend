// =================================================================
// PRUEBA: lista pegable de "Valores a premio SIN comisión" en Cargar
// Planos (04-10-2026, a pedido del usuario: "donde escojo las jugadas a
// premio para que se calculen sin comision, creame una lista pegable
// desde 10a5 hasta 10a1... para seleccionar que valores del plano van
// sin %, puedo elegir varias opciones ya que en el plano pueden haber
// 10a4 10a3.5").
//
// Mismo patrón que test_hipismo_detalle_cliente_imagen_por_dia.js: sin
// jsdom disponible en este sandbox, se extrae el código REAL de
// public/hipismo-mockup.html con una regex (no una reimplementación a
// mano) y se corre contra un DOM falso mínimo, para probar el código que
// de verdad corre.
//
// Lo central a confirmar:
//   1) La escala tiene EXACTAMENTE los 17 valores pedidos, de 10a5 a
//      10a1 en pasos de 0.25, sin basura de punto flotante.
//   2) Elegir un chip agrega su valor al input de texto de siempre
//      (#inpSinComision) -- la fuente real que se manda al servidor
//      (parsearValoresSinComision en hipismoCalc.js) -- y lo vuelve a
//      quitar si se elige una segunda vez.
//   3) Se pueden elegir VARIOS a la vez (el caso real: un plano con
//      10a4 Y 10a3.5 en la misma carrera).
//   4) Abrir la lista refleja lo que YA esté en el input (si el operador
//      lo escribió a mano), y un valor fuera de la escala (ej. 10a6,
//      10a1.6 -- el campo acepta hasta 10a9) escrito a mano NO se pierde
//      al elegir/quitar chips de la escala.
//   5) "Limpiar selección" vacía el input y destilda todos los chips.
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

function extraerEscalaConst() {
  const m = /const ESCALA_SIN_COMISION = \(\(\) => \{[\s\S]*?\}\)\(\);/.exec(html);
  if (!m) throw new Error('No se encontró "const ESCALA_SIN_COMISION" en hipismo-mockup.html');
  return m[0];
}

const srcEscala = extraerEscalaConst();
const srcParsear = extraerFuncion('parsearValoresSinComisionCliente');
const srcFormatEs = extraerFuncion('formatValorSinComisionEs');
const srcConstruirGrid = extraerFuncion('construirGridSinComisionSiHaceFalta');
const srcSincronizar = extraerFuncion('sincronizarGridSinComisionConInput');
const srcToggleValor = extraerFuncion('toggleValorSinComision');
const srcLimpiarLista = extraerFuncion('limpiarListaSinComision');
const srcToggleLista = extraerFuncion('toggleListaSinComision');

check(srcEscala.includes('ESCALA_SIN_COMISION'), 'Se pudo extraer la const ESCALA_SIN_COMISION tal cual del archivo real');
check(srcToggleValor.includes('toggleValorSinComision'), 'Se pudo extraer toggleValorSinComision() tal cual del archivo real');

// ---- DOM falso mínimo ----
function crearElemento(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: { display: '' },
    dataset: {},
    children: [],
    value: '',
    textContent: '',
    classList: {
      _set: new Set(),
      contains(c) { return this._set.has(c); },
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, forzar) {
        const debeEstar = (typeof forzar === 'boolean') ? forzar : !this._set.has(c);
        if (debeEstar) this._set.add(c); else this._set.delete(c);
        return debeEstar;
      }
    },
    appendChild(child) { this.children.push(child); },
    get childElementCount() { return this.children.length; }
  };
  return el;
}

function armarEntorno(valorInicialInput) {
  const input = crearElemento('input');
  input.value = valorInicialInput || '';
  const grid = crearElemento('div');
  const panel = crearElemento('div');
  const elementosPorId = { inpSinComision: input, gridSinComision: grid, panelSinComision: panel };

  const fakeDocument = {
    getElementById: id => elementosPorId[id],
    createElement: tag => crearElemento(tag),
    // Alcanza con filtrar los hijos del grid (único selector usado en el
    // código real: '#gridSinComision .chip-sin-comision') -- no hace
    // falta un motor de selectores CSS real para esta prueba.
    querySelectorAll: () => grid.children
  };

  const sandbox = {
    document: fakeDocument,
    console,
    String,
    Math,
    parseFloat,
    Number
  };
  vm.createContext(sandbox);
  vm.runInContext(
    // El "const ESCALA_SIN_COMISION" real no queda como propiedad del
    // sandbox solo por correrlo con vm (así es `const`/`let` con vm, a
    // diferencia de `function`/`var`) -- la línea de globalThis es SOLO
    // un gancho de esta prueba para poder leerlo desde afuera; las
    // funciones reales de arriba (construirGridSinComisionSiHaceFalta,
    // etc.) ya lo ven bien por scope normal de JS, sin necesitar esto.
    srcEscala + '\nglobalThis.ESCALA_SIN_COMISION = ESCALA_SIN_COMISION;\n' +
    srcParsear + '\n' + srcFormatEs + '\n' + srcConstruirGrid + '\n' +
    srcSincronizar + '\n' + srcToggleValor + '\n' + srcLimpiarLista + '\n' + srcToggleLista,
    sandbox
  );
  return { sandbox, input, grid, panel };
}

// --- 1) La escala tiene los 17 valores exactos pedidos, sin basura de punto flotante ---
{
  const env = armarEntorno();
  const esperada = [5, 4.75, 4.5, 4.25, 4, 3.75, 3.5, 3.25, 3, 2.75, 2.5, 2.25, 2, 1.75, 1.5, 1.25, 1];
  check(env.sandbox.ESCALA_SIN_COMISION.length === 17, 'La escala tiene 17 valores (de 10a5 a 10a1, cada 0.25)');
  check(JSON.stringify(env.sandbox.ESCALA_SIN_COMISION) === JSON.stringify(esperada),
    'La escala es EXACTAMENTE [5, 4.75, 4.5, ... 1.25, 1] -- sin basura de punto flotante (ej. 4.7499999999999996)');
}

// --- 2) construirGridSinComisionSiHaceFalta() arma 17 chips, con la etiqueta en formato venezolano (coma) ---
{
  const env = armarEntorno();
  env.sandbox.construirGridSinComisionSiHaceFalta();
  check(env.grid.children.length === 17, 'construirGridSinComisionSiHaceFalta() crea 17 chips (uno por valor de la escala)');
  const primero = env.grid.children[0], ultimo = env.grid.children[16];
  check(primero.textContent === '10a5', 'El primer chip es "10a5" (sin coma, es entero)');
  check(env.grid.children[1].textContent === '10a4,75', 'El segundo chip es "10a4,75" (coma venezolana, no punto)');
  check(ultimo.textContent === '10a1', 'El último chip es "10a1"');
  check(primero.dataset.valor === '5' && env.grid.children[1].dataset.valor === '4.75',
    'El valor REAL guardado en cada chip (dataset.valor) sigue usando PUNTO decimal (lo que de verdad viaja al input), solo la etiqueta visible usa coma');
  // Llamarla una 2da vez no debe duplicar los chips (se construye una sola vez por carga de página).
  env.sandbox.construirGridSinComisionSiHaceFalta();
  check(env.grid.children.length === 17, 'Una 2da llamada a construirGridSinComisionSiHaceFalta() NO duplica los chips');
}

// --- 3) Elegir un chip agrega su valor al input; elegirlo de nuevo lo quita ---
{
  const env = armarEntorno();
  env.sandbox.toggleListaSinComision(true); // abre y construye/sincroniza
  const chip4 = env.grid.children.find(c => c.dataset.valor === '4');
  env.sandbox.toggleValorSinComision(4, chip4);
  check(env.input.value === '4', 'Elegir "10a4" deja el input en "4" (sin el prefijo "10a", igual que si el operador lo escribiera a mano)');
  check(chip4.classList.contains('chip-activo'), 'El chip "10a4" queda marcado como activo tras elegirlo');

  env.sandbox.toggleValorSinComision(4, chip4);
  check(env.input.value === '', 'Elegir "10a4" una 2da vez lo QUITA del input (vuelve a quedar vacío)');
  check(!chip4.classList.contains('chip-activo'), 'El chip "10a4" ya no queda activo tras quitarlo');
}

// --- 4) Caso real: un plano con 10a4 Y 10a3.5 en la misma carrera -- se pueden elegir varios a la vez ---
{
  const env = armarEntorno();
  env.sandbox.toggleListaSinComision(true);
  const chip4 = env.grid.children.find(c => c.dataset.valor === '4');
  const chip35 = env.grid.children.find(c => c.dataset.valor === '3.5');
  env.sandbox.toggleValorSinComision(4, chip4);
  env.sandbox.toggleValorSinComision(3.5, chip35);
  check(env.input.value === '4, 3.5', 'Elegir "10a4" y "10a3,5" deja el input en "4, 3.5" (orden descendente, listo para mandar al servidor)');
  check(chip4.classList.contains('chip-activo') && chip35.classList.contains('chip-activo'), 'Ambos chips quedan marcados activos a la vez');

  const parseados = env.sandbox.parsearValoresSinComisionCliente(env.input.value);
  check(JSON.stringify(parseados) === JSON.stringify([4, 3.5]), 'El input resultante se parsea de vuelta a [4, 3.5] -- mismo criterio que parsearValoresSinComision() del servidor (hipismoCalc.js)');
}

// --- 5) Abrir la lista refleja lo que YA esté en el input, y un valor FUERA de la escala escrito a mano se respeta ---
{
  // El operador ya había escrito "4, 1.6" a mano (1.6 no es parte de la
  // escala de 0.25 en 0.25 -- caso real del tooltip, que acepta hasta
  // 10a9 con cualquier decimal).
  const env = armarEntorno('4, 1.6');
  env.sandbox.toggleListaSinComision(true); // abre -> debe sincronizar los chips con el input actual
  const chip4 = env.grid.children.find(c => c.dataset.valor === '4');
  check(chip4.classList.contains('chip-activo'), 'Al abrir la lista con "4, 1.6" ya en el input, el chip "10a4" aparece marcado activo');
  const activos = env.grid.children.filter(c => c.classList.contains('chip-activo'));
  check(activos.length === 1, 'Solo el chip "10a4" queda activo -- "1.6" no es parte de la escala fija, así que ningún otro chip se marca por error');

  // Elegir otro chip de la escala (10a3) NO debe borrar el "1.6" escrito a mano.
  const chip3 = env.grid.children.find(c => c.dataset.valor === '3');
  env.sandbox.toggleValorSinComision(3, chip3);
  check(env.input.value === '4, 3, 1.6', 'Elegir "10a3" de la lista agrega "3" SIN perder el "1.6" que el operador había escrito a mano fuera de la escala');
}

// --- 6) "Limpiar selección" vacía el input y destilda todos los chips ---
{
  const env = armarEntorno();
  env.sandbox.toggleListaSinComision(true);
  const chip4 = env.grid.children.find(c => c.dataset.valor === '4');
  const chip2 = env.grid.children.find(c => c.dataset.valor === '2');
  env.sandbox.toggleValorSinComision(4, chip4);
  env.sandbox.toggleValorSinComision(2, chip2);
  check(env.input.value === '4, 2', 'Setup: hay 2 valores elegidos antes de limpiar');

  env.sandbox.limpiarListaSinComision();
  check(env.input.value === '', 'limpiarListaSinComision() deja el input vacío');
  check(!chip4.classList.contains('chip-activo') && !chip2.classList.contains('chip-activo'), 'limpiarListaSinComision() destilda todos los chips elegidos');
}

// --- 7) toggleListaSinComision() abre/cierra el panel (sin argumento = toggle; con argumento = forzado) ---
{
  const env = armarEntorno();
  check(!env.panel.classList.contains('panel-visible'), 'El panel arranca cerrado');
  env.sandbox.toggleListaSinComision();
  check(env.panel.classList.contains('panel-visible'), 'toggleListaSinComision() sin argumento ABRE el panel si estaba cerrado');
  env.sandbox.toggleListaSinComision();
  check(!env.panel.classList.contains('panel-visible'), 'toggleListaSinComision() sin argumento CIERRA el panel si estaba abierto');
  env.sandbox.toggleListaSinComision(true);
  check(env.panel.classList.contains('panel-visible'), 'toggleListaSinComision(true) fuerza a que quede abierto (botón "📋 Elegir de la lista")');
  env.sandbox.toggleListaSinComision(false);
  check(!env.panel.classList.contains('panel-visible'), 'toggleListaSinComision(false) fuerza a que quede cerrado (botón "Listo ✓")');
}

console.log('\nPrueba de la lista "Valores a premio SIN comisión" terminada.');
if (process.exitCode) {
  console.log('Hubo fallos.');
} else {
  console.log('Todo OK.');
}
