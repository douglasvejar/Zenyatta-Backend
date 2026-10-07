// =================================================================
// PRUEBA (07-10-2026): "Puesta en Marcha" de un grupo — checklist, revisión
// del esquema de la base de datos y prueba piloto (solo lee).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
const GRUPO_ID = 'g-pem-1';

let cols = [];            // filas information_schema.columns
let defAlertas = 'CHECK (tipo = ANY (ARRAY[... APUESTA_SOBRE_POZO ... CUADRE_DESCUADRADO ...]))';
let conteos = {};
let ultimoCuadre = null;
let cuadreResultado = { ok: true, clientesRevisados: 4, discrepancias: [], sumaBalance: [] };
let escrituras = [];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/information_schema\.columns/i.test(sql)) return { rows: cols };
  if (/pg_get_constraintdef/i.test(sql)) return { rows: [{ def: defAlertas }] };
  if (/FROM hipismo_hipodromos/i.test(sql)) return { rows: [{ n: conteos.hipodromos }] };
  if (/FROM empleados/i.test(sql)) return { rows: [{ n: conteos.empleados }] };
  if (/FROM hipismo_planos/i.test(sql)) return { rows: [{ n: conteos.planos }] };
  if (/comision_propia, 0\) > 0/i.test(sql)) return { rows: [{ n: conteos.conPct }] };
  if (/FROM jugadores WHERE grupo_id = \$1 AND COALESCE\(es_cuenta_comision/i.test(sql)) return { rows: [{ n: conteos.clientes }] };
  if (/FROM hipismo_cuadre_nocturno/i.test(sql)) return { rows: ultimoCuadre ? [ultimoCuadre] : [] };
  if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) { escrituras.push(sql); return { rows: [] }; }
  return { rows: [] };
}
const fakePool = function () { this.query = async (t, p) => ejecutarQuery(t, p); this.on = () => {}; };
let semanaCfg = { inicio: null, cierre: null, desde: null, hasta: null };
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === './hipismoSemana') return { obtenerConfigSemana: async () => semanaCfg, esConfigPorDefecto: (c) => !c.inicio && !c.cierre };
  if (request === './hipismoCuadreNocturno') return { revisarCuadreGrupo: async () => { if (cuadreResultado === 'lanza') throw new Error('boom'); return cuadreResultado; } };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
const pem = require(path.join(__dirname, '..', 'src', 'services', 'hipismoPuestaEnMarcha'));
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }
function esquemaCompleto() {
  const r = [];
  Object.keys(pem.ESQUEMA_ESPERADO).forEach(t => pem.ESQUEMA_ESPERADO[t].forEach(c => r.push({ table_name: t, column_name: c })));
  return r;
}
const item = (d, k) => d.items.find(i => i.clave === k);

(async function main() {
  // ---- evaluarBanqueo
  check(!pem.evaluarBanqueo(null).configurado && !pem.evaluarBanqueo([]).configurado, '1a) sin banqueo = no configurado');
  check(pem.evaluarBanqueo([{ nombre: 'MARCAS A', porcentaje: 60 }, { nombre: 'MARCAS B', porcentaje: 40 }]).valido, '1b) 60 + 40 = 100 es válido');
  const mal = pem.evaluarBanqueo([{ nombre: 'MARCAS A', porcentaje: 60 }, { nombre: 'MARCAS B', porcentaje: 30 }]);
  check(mal.configurado && !mal.valido && mal.suma === 90, '1c) 60 + 30 = 90 no es válido y dice cuánto suman');
  check(!pem.evaluarBanqueo([{ nombre: '', porcentaje: 100 }]).valido, '1d) una fila sin nombre no es válida');

  // ---- esquema
  cols = esquemaCompleto();
  let e = await pem.verificarEsquema();
  check(e.ok && e.faltan.length === 0, '2a) con todo creado el esquema está al día');
  cols = esquemaCompleto().filter(c => !(c.table_name === 'hipismo_adelantadas_jugadas' && c.column_name === 'montos_manuales') && c.table_name !== 'errores_servidor');
  e = await pem.verificarEsquema();
  check(!e.ok && e.faltan.some(f => /montos_manuales/.test(f)) && e.faltan.some(f => /tabla errores_servidor/.test(f)), '2b) avisa la columna y la tabla que faltan (schema.sql sin correr completo)');
  cols = esquemaCompleto();
  defAlertas = "CHECK (tipo = ANY (ARRAY['PLANO_EDITADO']))";
  e = await pem.verificarEsquema();
  check(!e.ok && e.faltan.filter(f => /no acepta el tipo/.test(f)).length === 2, '2c) avisa si la tabla de alertas no acepta los tipos nuevos');
  defAlertas = 'APUESTA_SOBRE_POZO CUADRE_DESCUADRADO';

  // ---- checklist de un grupo nuevo vacío
  conteos = { hipodromos: 0, clientes: 0, conPct: 0, empleados: 0, planos: 0 };
  let c = await pem.construirChecklistGrupo({ id: GRUPO_ID, hipismo_marcas_banqueo: null, hipismo_tf_banqueo: null });
  check(!c.listo && item(c, 'hipodromos').estado === 'pendiente' && item(c, 'clientes').estado === 'pendiente' && item(c, 'banqueoMarcas').estado === 'pendiente' && item(c, 'primerPlano').estado === 'pendiente', '3a) grupo nuevo: faltan hipódromos, clientes, banqueo de Marcas y el primer plano');
  check(item(c, 'banqueoTf').estado === 'opcional' && item(c, 'porcentajes').estado === 'opcional' && item(c, 'usuarios').estado === 'opcional', '3b) Tablas Fijas sin banqueo, % devueltos y usuarios son opcionales');
  check(c.pendientes === 4, `3c) 4 pasos pendientes (dio ${c.pendientes})`);

  // ---- grupo configurado
  conteos = { hipodromos: 3, clientes: 25, conPct: 5, empleados: 2, planos: 40 };
  ultimoCuadre = { fecha: '2026-10-07', estado: 'ok' };
  c = await pem.construirChecklistGrupo({ id: GRUPO_ID, hipismo_marcas_banqueo: [{ nombre: 'MARCAS X', porcentaje: 100 }], hipismo_tf_banqueo: [{ nombre: 'TF X', porcentaje: 50 }, { nombre: 'TF Y', porcentaje: 50 }] });
  check(c.listo && c.pendientes === 0 && c.items.every(i => i.estado === 'ok'), '3d) grupo configurado: todo en ok');
  c = await pem.construirChecklistGrupo({ id: GRUPO_ID, hipismo_marcas_banqueo: [{ nombre: 'MARCAS X', porcentaje: 70 }], hipismo_tf_banqueo: null });
  check(!c.listo && item(c, 'banqueoMarcas').estado === 'pendiente' && /suman 70/.test(item(c, 'banqueoMarcas').detalle), '3e) banqueo que no suma 100 queda pendiente y explica por qué');
  ultimoCuadre = { fecha: '2026-10-07', estado: 'descuadre' };
  c = await pem.construirChecklistGrupo({ id: GRUPO_ID, hipismo_marcas_banqueo: [{ nombre: 'MARCAS X', porcentaje: 100 }] });
  check(item(c, 'cuadre').estado === 'pendiente', '3f) si la última revisión nocturna no cuadró, el paso queda pendiente');
  semanaCfg = { inicio: 1, cierre: 1, desde: '2026-10-05', hasta: null };
  c = await pem.construirChecklistGrupo({ id: GRUPO_ID, hipismo_marcas_banqueo: null });
  check(/personalizada/.test(item(c, 'semana').detalle), '3g) semana personalizada se nota en el paso de Fecha de semana');
  semanaCfg = { inicio: null, cierre: null, desde: null, hasta: null };

  // ---- prueba piloto
  escrituras = [];
  const grupoOk = { id: GRUPO_ID, hipismo_marcas_banqueo: [{ nombre: 'MARCAS X', porcentaje: 100 }], hipismo_tf_banqueo: null };
  let p = await pem.ejecutarPruebaPiloto(grupoOk);
  check(p.ok && p.pasos.every(x => x.ok), `4a) prueba piloto completa en verde (${JSON.stringify(p.pasos.filter(x => !x.ok))})`);
  const calc = p.pasos.find(x => x.clave === 'calculo');
  check(calc && /suma 0/.test(calc.detalle), `4b) el plano de ejemplo se calcula y suma 0 (${calc && calc.detalle})`);
  check(escrituras.length === 0, '4c) la prueba piloto NO escribe nada en la base');
  p = await pem.ejecutarPruebaPiloto({ id: GRUPO_ID, hipismo_marcas_banqueo: null });
  check(!p.ok && p.pasos.find(x => x.clave === 'banqueoMarcas').ok === false, '4d) sin banqueo de Marcas la prueba lo marca');
  cuadreResultado = { ok: false, clientesRevisados: 4, discrepancias: [{ nombre: 'ANA' }], sumaBalance: [] };
  p = await pem.ejecutarPruebaPiloto(grupoOk);
  check(!p.ok && p.pasos.find(x => x.clave === 'cuadre').ok === false, '4e) si el cuadre de la semana falla, la prueba lo marca');
  cuadreResultado = 'lanza';
  p = await pem.ejecutarPruebaPiloto(grupoOk);
  check(!p.ok && /No se pudo revisar/.test(p.pasos.find(x => x.clave === 'cuadre').detalle), '4f) si el cuadre mismo falla, la prueba sigue y lo reporta (no se cae)');
  cols = esquemaCompleto().filter(x => x.table_name !== 'errores_servidor');
  cuadreResultado = { ok: true, clientesRevisados: 1, discrepancias: [], sumaBalance: [] };
  p = await pem.ejecutarPruebaPiloto(grupoOk);
  check(!p.ok && p.pasos.find(x => x.clave === 'esquema').ok === false && /schema\.sql/.test(p.pasos.find(x => x.clave === 'esquema').detalle), '4g) base de datos desactualizada: manda a correr schema.sql');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  process.exit(fallaron ? 1 : 0);
})();
