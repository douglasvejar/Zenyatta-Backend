// =================================================================
// PRUEBA: Orden de la lista de Pozos (23-10-2026). Cada grupo elige 'alfabetico' (por defecto) o 'menor_mayor'; solo el administrador
// lo cambia; un orden inventado se rechaza; sin la columna (falta el SQL) el GET avisa sinColumna y el PUT responde 503. Y la
// pantalla Pozos ordena de verdad las 3 listas según esa preferencia.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
const GRUPO_ID = 'g-pozos-1', OTRO = 'g-otro';
let valores = {}; // grupo_id -> orden
let sinColumna = false;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/hipismo_pozos_orden/.test(sql) && sinColumna) { const e = new Error('column "hipismo_pozos_orden" does not exist'); e.code = '42703'; throw e; }
  if (/^SELECT hipismo_pozos_orden FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ hipismo_pozos_orden: params[0] in valores ? valores[params[0]] : null }] };
  if (/^UPDATE grupos SET hipismo_pozos_orden = \$1 WHERE id = \$2/i.test(sql)) { valores[params[1]] = params[0]; return { rows: [] }; }
  throw new Error('La base de datos falsa no sabe responder: ' + sql);
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...args) => { handlers.push([m, args]); return router; }; });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'h', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';
const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
Module._load = originalLoad;
function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocar(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e.message));
  return { salida, status };
}
let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }

(async function () {
  const get = handlerDe('get', '/pozos-config'), put = handlerDe('put', '/pozos-config');
  const admin = { grupoId: GRUPO_ID, params: {}, query: {}, rol: 'administrador' };
  let r = await invocar(get, { ...admin });
  check(r.salida.orden === 'alfabetico', '1) sin elegir nada la lista de Pozos sale en orden alfabético');
  r = await invocar(put, { ...admin, body: { orden: 'menor_mayor' } });
  check(r.status === 200 && r.salida.orden === 'menor_mayor', '2) el administrador puede elegir "del que menos tiene al que más tiene"');
  r = await invocar(get, { ...admin });
  check(r.salida.orden === 'menor_mayor', '3) queda guardado para todo el grupo');
  r = await invocar(get, { ...admin, grupoId: OTRO });
  check(r.salida.orden === 'alfabetico', '4) otro grupo no se afecta');
  await invocar(put, { ...admin, grupoId: OTRO, body: { orden: 'alfabetico' } });
  r = await invocar(get, { ...admin });
  check(r.salida.orden === 'menor_mayor', '5) cambiar el orden en otro grupo no cambia el primero');
  r = await invocar(put, { ...admin, rol: 'empleado', body: { orden: 'alfabetico' } });
  check(r.status === 403 && valores[GRUPO_ID] === 'menor_mayor', '6) un empleado no puede cambiarlo (403)');
  r = await invocar(put, { ...admin, body: { orden: 'inventado' } });
  check(r.status === 400 && valores[GRUPO_ID] === 'menor_mayor', '7) un orden que no existe se rechaza (400)');
  r = await invocar(put, { ...admin, body: {} });
  check(r.status === 400, '8) sin indicar orden responde 400');
  valores[GRUPO_ID] = 'algo-viejo';
  r = await invocar(get, { ...admin });
  check(r.salida.orden === 'alfabetico', '9) un valor guardado que ya no existe cae a alfabético');
  r = await invocar(get, { ...admin });
  check(r.salida.ordenes.length === 2 && r.salida.ordenes.includes('menor_mayor'), '10) el servidor informa los 2 órdenes');

  // ---- la pantalla Pozos ordena de verdad (se saca ordenarFilasPozos() del HTML y se prueba suelta) ----
  const html = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const fn = html.match(/function ordenarFilasPozos\(filas, montoDe, nombreDe\) \{[\s\S]*?\n\}\n/);
  check(!!fn, '11) existe ordenarFilasPozos() en el panel');
  const mk = orden => new Function('POZOS_ORDEN', fn[0] + '; return ordenarFilasPozos;')(orden);
  const datos = [{ n: 'Zeta', m: 50 }, { n: 'ana', m: 300 }, { n: 'Maria', m: -20 }, { n: 'Beto', m: 50 }, { n: 'Carlos', m: 0 }];
  const montoDe = x => x.m, nombreDe = x => x.n;
  let o = mk('alfabetico')(datos, montoDe, nombreDe).map(x => x.n).join(',');
  check(o === 'ana,Beto,Carlos,Maria,Zeta', '12) alfabético: A a Z sin importar mayúsculas (' + o + ')');
  o = mk('menor_mayor')(datos, montoDe, nombreDe).map(x => x.n).join(',');
  check(o === 'Maria,Carlos,Beto,Zeta,ana', '13) menor a mayor: del que menos tiene al que más tiene, empate por nombre (' + o + ')');
  check(datos[0].n === 'Zeta', '14) no modifica la lista original');
  const usos = (html.match(/ordenarFilasPozos\(/g) || []).length;
  check(usos >= 4, '15) las 3 listas de Pozos (Saldos + Pozos, Solo Pozos, Solo Saldos) usan el orden elegido (' + usos + ' usos)');
  check(/sincronizarOrdenPozosServidor\(\);\s*\n\s*const nombreEl/.test(html), '16) el orden se sincroniza al abrir el panel (la lista nace ya ordenada)');
  check(/id="pozosOrdenOpciones"/.test(html) && html.includes("elegirPozosOrden('menor_mayor')"), '17) Ajustes > Preferencias ofrece las 2 opciones');
  sinColumna = true;
  r = await invocar(get, { ...admin });
  check(r.salida.sinColumna === true && r.salida.orden === null, '18) sin la columna el GET avisa sinColumna (la pantalla usa la copia del navegador)');
  r = await invocar(put, { ...admin, body: { orden: 'menor_mayor' } });
  check(r.status === 503 && r.salida.sinColumna, '19) sin la columna el PUT responde 503 con aviso claro');
  console.log(`\n${pasaron} OK, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();
