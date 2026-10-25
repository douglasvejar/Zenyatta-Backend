// =================================================================
// PRUEBA: clientes "PAGO DIARIO" (25-10-2026, a pedido del usuario: "cuando creas cliente, aparte de avalados y libres, hay
// clientes que se denominan pago diario... y cuando des el plano de pozos coloca de primero los pago diario: un icono PAGO DIARIO,
// abajo la lista de esos clientes y después AVALADOS: la lista de los clientes").
//   Backend (src/routes/jugadores.js): POST/PUT aceptan `pagoDiario` (boolean) y guardan la marca aparte; sin la columna
//   (42703) crear/editar sigue funcionando y solo avisa (503) si justo pedían marcar pago diario; si `pagoDiario` no viene
//   no se toca la marca; un avalado nunca queda como pago diario.
//   Pantalla (public/hipismo-mockup.html): htmlFilasPozosPorSeccion() parte la lista en PAGO DIARIO / AVALADOS: y, sin clientes
//   de pago diario, deja la tabla igual que siempre.
// =================================================================
const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

const GRUPO = 'g1';
const JUG = [{ id: 'j1', grupo_id: GRUPO, nombre: 'LUIS', tipo_cuenta: 'libre', pago_diario: false, pozo_inicial: 0 },
  { id: 'j2', grupo_id: GRUPO, nombre: 'PEPE', tipo_cuenta: 'avalado', pago_diario: false, pozo_inicial: 500 }];
let columnaExiste = true;
const LOG = [];
let seq = 10;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  LOG.push(sql);
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/^INSERT INTO jugadores \(/i.test(sql)) {
    const fila = { id: 'j' + (seq++), grupo_id: params[0], nombre: params[1], tipo_cuenta: params[5], pozo_inicial: params[6], pago_diario: false };
    JUG.push(fila); return { rows: [fila] };
  }
  if (/^UPDATE jugadores SET nombre = \$1/i.test(sql)) {
    const j = JUG.find(x => x.id === params[12]);
    j.nombre = params[0]; j.tipo_cuenta = params[4]; j.pozo_inicial = params[5];
    return { rows: [j] };
  }
  if (/^UPDATE jugadores SET pago_diario = \$1/i.test(sql)) {
    if (!columnaExiste) { const e = new Error('no existe la columna'); e.code = '42703'; throw e; }
    const j = JUG.find(x => x.id === params[1] && x.grupo_id === params[2]);
    j.pago_diario = params[0]; return { rows: [j] };
  }
  if (/jugadores_avales_porcentaje/i.test(sql) || /^SELECT/i.test(sql) || /^DELETE/i.test(sql)) return { rows: [] };
  throw new Error('La base falsa no sabe responder: ' + sql);
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
function fakeRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...a) => { handlers.push([m, a]); return router; }; });
  router.__handlers = handlers; return router;
}
const fakeExpress = () => fakeRouter(); fakeExpress.Router = fakeRouter;
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({}) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake'; process.env.JWT_SECRET = 'fake';
const router = require(path.join(__dirname, '..', 'src', 'routes', 'jugadores'));
Module._load = originalLoad;

function handlerDe(m, p) { const e = router.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocar(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    Promise.resolve(handler(req, res, e => { if (e) reject(e); })).catch(reject);
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { status, body: salida };
}
const req = (body, params) => ({ body, params: params || {}, grupoId: GRUPO, rol: 'administrador', headers: {} });

(async function main() {
  const crear = handlerDe('post', '/');
  const editar = handlerDe('put', '/:id');

  let r = await invocar(crear, req({ nombre: 'Nuevo Diario', tipoCuenta: 'libre', pagoDiario: true }));
  check(r.status === 201 && r.body.pago_diario === true && JUG.find(j => j.nombre === 'NUEVO DIARIO').pago_diario === true, '1) Crear cliente con pagoDiario=true lo guarda como pago diario (tipo libre)');
  check(JUG.find(j => j.nombre === 'NUEVO DIARIO').tipo_cuenta === 'libre', '2) Un pago diario es de tipo libre (sin pozo)');

  const antes = LOG.length;
  r = await invocar(crear, req({ nombre: 'Normal', tipoCuenta: 'libre' }));
  check(r.status === 201 && JUG.find(j => j.nombre === 'NORMAL').pago_diario === false && LOG.slice(antes).every(s => !/SET pago_diario/.test(s)), '3) Crear un cliente normal no toca la marca (sin consulta extra)');

  r = await invocar(crear, req({ nombre: 'Con Pozo', tipoCuenta: 'avalado', pozoInicial: 300, pagoDiario: true }));
  const cp = JUG.find(j => j.nombre === 'CON POZO');
  check(r.status === 201 && cp.tipo_cuenta === 'libre' && cp.pago_diario === true && Number(cp.pozo_inicial) === 0, '4) Si piden pago diario, gana sobre "avalado": queda libre, sin pozo');

  r = await invocar(editar, req({ nombre: 'Luis', tipoCuenta: 'libre', pagoDiario: true }, { id: 'j1' }));
  check(r.status === 200 && JUG[0].pago_diario === true, '5) Editar: pasar un cliente libre a pago diario');
  r = await invocar(editar, req({ nombre: 'Luis', tipoCuenta: 'libre' }, { id: 'j1' }));
  check(r.status === 200 && JUG[0].pago_diario === true, '6) Editar sin mandar pagoDiario (otras pantallas) NO le borra la marca');
  r = await invocar(editar, req({ nombre: 'Luis', tipoCuenta: 'libre', pagoDiario: false }, { id: 'j1' }));
  check(r.status === 200 && JUG[0].pago_diario === false, '7) Editar con pagoDiario=false lo vuelve a libre normal');
  JUG[0].pago_diario = true;
  r = await invocar(editar, req({ nombre: 'Luis', tipoCuenta: 'avalado', pozoInicial: 200, pagoDiario: false }, { id: 'j1' }));
  check(r.status === 200 && JUG[0].tipo_cuenta === 'avalado' && JUG[0].pago_diario === false, '8) Pasarlo a avalado le quita la marca de pago diario');

  columnaExiste = false;
  r = await invocar(crear, req({ nombre: 'Sin Columna' }));
  check(r.status === 201, '9) Sin la columna, crear un cliente normal sigue funcionando igual');
  r = await invocar(editar, req({ nombre: 'Pepe', tipoCuenta: 'avalado', pozoInicial: 500 }, { id: 'j2' }));
  check(r.status === 200, '10) Sin la columna, editar un cliente (sin tocar pago diario) sigue funcionando');
  r = await invocar(crear, req({ nombre: 'Diario Sin Col', pagoDiario: true }));
  check(r.status === 503 && r.body.sinColumna === true && /SQL/.test(r.body.error), '11) Sin la columna, pedir pago diario avisa que falta correr el SQL (503) y el cliente queda creado');
  columnaExiste = true;

  // ---------- pantalla ----------
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const sacar = nombre => { const i = html.indexOf('function ' + nombre); if (i < 0) throw new Error('no está ' + nombre); let d = 0, k = html.indexOf('{', i); for (let p = k; p < html.length; p++) { if (html[p] === '{') d++; else if (html[p] === '}') { d--; if (!d) return html.slice(i, p + 1); } } };
  const codigo = ['nombresPagoDiarioPozos', 'filaSeccionPozos', 'htmlFilasPozosPorSeccion'].map(sacar).join('\n');
  const armar = cache => new Function('CLIENTES_HIPISMO_CACHE', codigo + '; return htmlFilasPozosPorSeccion;')(cache);
  const fila = n => `<tr data-nombre="${n}"></tr>`;
  const nombres = ['ANA', 'BETO', 'CARLOS', 'DIEGO'];
  const filas = nombres.map(n => ({ nombre: n }));
  const cache = [{ nombre: 'BETO', tipo_cuenta: 'libre', pago_diario: true }, { nombre: 'DIEGO', tipo_cuenta: 'libre', pago_diario: true },
    { nombre: 'ANA', tipo_cuenta: 'avalado' }, { nombre: 'CARLOS', tipo_cuenta: 'libre' }];
  let out = armar(cache)(filas, f => f.nombre, f => fila(f.nombre), 3);
  const pos = t => out.indexOf(t);
  check(pos('PAGO DIARIO') >= 0 && pos('PAGO DIARIO') < pos('"BETO"') && pos('"BETO"') < pos('"DIEGO"') && pos('"DIEGO"') < pos('AVALADOS:') && pos('AVALADOS:') < pos('"ANA"') && pos('"ANA"') < pos('"CARLOS"'),
    '12) Plano: primero 💵 PAGO DIARIO con su lista, luego "AVALADOS:" con el resto, cada lista en su orden');
  check(out.includes('💵 PAGO DIARIO') && (out.match(/fila-seccion-pozos/g) || []).length === 2, '13) Lleva el icono 💵 y exactamente 2 títulos de sección');
  out = armar([{ nombre: 'ANA', tipo_cuenta: 'avalado' }])(filas, f => f.nombre, f => fila(f.nombre), 3);
  check(!out.includes('fila-seccion-pozos') && (out.match(/<tr/g) || []).length === 4, '14) Sin clientes de pago diario la tabla queda igual que siempre (sin títulos)');
  out = armar(cache)([{ nombre: 'BETO' }, { nombre: 'DIEGO' }], f => f.nombre, f => fila(f.nombre), 3);
  check(out.includes('PAGO DIARIO') && !out.includes('AVALADOS:'), '15) Si todos son pago diario no sale el título AVALADOS: vacío');
  out = armar([{ nombre: 'BETO', tipo_cuenta: 'avalado', pago_diario: true }])([{ nombre: 'BETO' }], f => f.nombre, f => fila(f.nombre), 3);
  check(!out.includes('PAGO DIARIO'), '16) Un cliente con pozo (avalado) no cuenta como pago diario aunque tenga la marca vieja');

  check((html.match(/htmlFilasPozosPorSeccion\(/g) || []).length >= 4, '17) Los 3 filtros de Pozos (Saldos+Pozos, Solo Saldos, Solo Pozos) usan las secciones');
  check(/value="pago_diario"/.test(html) && (html.match(/value="pago_diario"/g) || []).length >= 2, '18) La opción "Pago diario" existe al crear el cliente y en su ficha');
  check(/encabezadoPendiente/.test(html) && /fila-seccion-pozos/.test(html), '19) El texto copiado y la imagen respetan los títulos de sección');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
