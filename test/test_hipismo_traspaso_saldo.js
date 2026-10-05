// =================================================================
// PRUEBA: pestaña Administración > "Traspaso de Saldo" (05-10-2026, a
// pedido del usuario: "la pestaña traspaso de saldos no esta activa... alli
// debes desplegarme la lista de clientes activos"). Backend nuevo:
// GET /traspasos-saldo (historial, empareja las 2 mitades de cada
// traspaso por creado_en+fecha+montos opuestos) y DELETE /traspasos-saldo/:id
// (anula las 2 mitades). El POST /comisiones/traspaso de siempre es el que
// registra el traspaso (resta al origen, suma al destino).
// =================================================================
const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-traspaso-1';
const OTRO_GRUPO = 'g-otro';
let reloj = 1000;
let txAhora = null;
let seq = 0;
const AJUSTES = [];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  // Regla nueva (05-10-2026): un cliente que no existe es error, no se crea solo. Por defecto los nombres existen; global.__CLIENTES_NO_EXISTEN (opcional) lista los que no.
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    // Los nombres "existen" (salvo los de global.__CLIENTES_NO_EXISTEN). Si la base falsa de esta prueba
    // guarda jugadores, se los da de alta con su mismo INSERT de siempre para que el resto de la ruta los vea.
    const existentes = (params[1] || []).filter(n => !(global.__CLIENTES_NO_EXISTEN || []).includes(n));
    existentes.forEach(nombre => { try { ejecutarQuery("INSERT INTO jugadores (grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial) VALUES ($1, $2, true, true, 'libre', 0) ON CONFLICT (grupo_id, nombre) DO NOTHING", [params[0], nombre]); } catch (e) { /* esta base falsa no guarda jugadores */ } });
    return { rows: existentes.map(nombre => ({ nombre })) };
  }
  if (sql === 'BEGIN') { txAhora = new Date(2026, 9, 5, 12, 0, 0, reloj++); return { rows: [] }; }
  if (sql === 'COMMIT' || sql === 'ROLLBACK') { txAhora = null; return { rows: [] }; }
  if (/^INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO hipismo_comisiones_ajustes/i.test(sql)) {
    const [grupo_id, cliente_nombre, monto, fecha, nota] = params;
    AJUSTES.push({ id: 'a' + (++seq), grupo_id, cliente_nombre, monto, fecha, nota, creado_en: txAhora || new Date() });
    return { rows: [] };
  }
  if (/^SELECT id, cliente_nombre, monto, fecha, nota, creado_en FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 ORDER BY creado_en DESC LIMIT 400/i.test(sql)) {
    return { rows: AJUSTES.filter(a => a.grupo_id === params[0]).slice().sort((x, y) => y.creado_en - x.creado_en) };
  }
  if (/^SELECT id, cliente_nombre, monto, fecha, nota, creado_en FROM hipismo_comisiones_ajustes WHERE id = \$1 AND grupo_id = \$2/i.test(sql)) {
    return { rows: AJUSTES.filter(a => a.id === params[0] && a.grupo_id === params[1]) };
  }
  if (/^SELECT id, cliente_nombre, monto, fecha, nota, creado_en FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND creado_en = \$2/i.test(sql)) {
    return { rows: AJUSTES.filter(a => a.grupo_id === params[0] && a.creado_en.getTime() === new Date(params[1]).getTime()) };
  }
  if (/^DELETE FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND id = ANY/i.test(sql)) {
    const [grupo, ids] = params;
    for (let i = AJUSTES.length - 1; i >= 0; i--) if (AJUSTES[i].grupo_id === grupo && ids.includes(AJUSTES[i].id)) AJUSTES.splice(i, 1);
    return { rows: [] };
  }
  throw new Error('La base de datos falsa de esta prueba (traspaso-saldo) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
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
async function invocarRuta(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { salida, status };
}

(async function main() {
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: {} };

  // Historial vacío
  let r = await invocarRuta(handlerDe('get', '/traspasos-saldo'), reqBase);
  check(r.salida && Array.isArray(r.salida.traspasos) && r.salida.traspasos.length === 0, '1) historial vacío al comienzo');

  // Hace 2 traspasos con la ruta de siempre (queda con el mismo creado_en en las 2 mitades)
  await invocarRuta(handlerDe('post', '/comisiones/traspaso'), { ...reqBase, body: { clienteOrigen: 'mrincreible', clienteDestino: 'Puertolacruz', monto: 50, fecha: '2026-10-05', nota: 'Traspaso de saldo' } });
  await invocarRuta(handlerDe('post', '/comisiones/traspaso'), { ...reqBase, body: { clienteOrigen: 'PURGA', clienteDestino: 'SAMMY', monto: 12.5, fecha: '2026-10-04', nota: 'acuerdo' } });
  // Un ajuste de OTRO grupo no debe verse
  AJUSTES.push({ id: 'zz1', grupo_id: OTRO_GRUPO, cliente_nombre: 'X', monto: -5, fecha: '2026-10-05', nota: null, creado_en: new Date(2026, 9, 5, 9, 0, 0, 1) });
  AJUSTES.push({ id: 'zz2', grupo_id: OTRO_GRUPO, cliente_nombre: 'Y', monto: 5, fecha: '2026-10-05', nota: null, creado_en: new Date(2026, 9, 5, 9, 0, 0, 1) });

  r = await invocarRuta(handlerDe('get', '/traspasos-saldo'), reqBase);
  const t = r.salida.traspasos;
  check(t.length === 2, `2a) el historial junta las 2 mitades de cada traspaso (2 traspasos, no 4 filas) -- hay ${t.length}`);
  const t1 = t.find(x => x.origen === 'MRINCREIBLE');
  check(!!t1 && t1.destino === 'PUERTOLACRUZ' && t1.monto === 50 && t1.fecha === '2026-10-05' && t1.nota === 'Traspaso de saldo', '2b) traspaso 1: MRINCREIBLE -> PUERTOLACRUZ, $50, con fecha y nota');
  const t2 = t.find(x => x.origen === 'PURGA');
  check(!!t2 && t2.destino === 'SAMMY' && t2.monto === 12.5, '2c) traspaso 2: PURGA -> SAMMY, $12,50');
  check(t[0].origen === 'PURGA', '2d) el más reciente va primero');
  check(!t.some(x => x.origen === 'X' || x.destino === 'Y'), '2e) no se mezclan traspasos de otro grupo');

  // Saldos netos: la suma de las 2 mitades es 0
  const suma = AJUSTES.filter(a => a.grupo_id === GRUPO_ID).reduce((s, a) => s + Number(a.monto), 0);
  check(Math.abs(suma) < 1e-9, '3) los traspasos suman 0 entre origen y destino');

  // Anular
  r = await invocarRuta(handlerDe('delete', '/traspasos-saldo/:id'), { ...reqBase, params: { id: t1.id } });
  check(r.salida && r.salida.ok === true, '4a) anular un traspaso responde ok');
  check(AJUSTES.filter(a => a.grupo_id === GRUPO_ID).length === 2, '4b) se borraron las 2 mitades del traspaso anulado (quedan solo las del otro)');
  r = await invocarRuta(handlerDe('get', '/traspasos-saldo'), reqBase);
  check(r.salida.traspasos.length === 1 && r.salida.traspasos[0].origen === 'PURGA', '4c) el historial ya no lo muestra y el otro sigue');

  // Anular con el id de la OTRA mitad también funciona
  const idMitadPositiva = AJUSTES.find(a => a.grupo_id === GRUPO_ID && Number(a.monto) > 0).id;
  r = await invocarRuta(handlerDe('delete', '/traspasos-saldo/:id'), { ...reqBase, params: { id: idMitadPositiva } });
  check(r.salida && r.salida.ok === true && AJUSTES.filter(a => a.grupo_id === GRUPO_ID).length === 0, '5) anular usando el id de la mitad destino también borra el par completo');

  // Seguridad / errores
  r = await invocarRuta(handlerDe('delete', '/traspasos-saldo/:id'), { ...reqBase, params: { id: 'zz1' } });
  check(r.status === 404 && AJUSTES.some(a => a.id === 'zz1'), '6a) no se puede anular un traspaso de OTRO grupo (404) y no se borra nada');
  r = await invocarRuta(handlerDe('delete', '/traspasos-saldo/:id'), { ...reqBase, params: { id: 'no-existe' } });
  check(r.status === 404, '6b) un id inexistente da 404');
  // Mitad huérfana: no se borra nada
  AJUSTES.push({ id: 'h1', grupo_id: GRUPO_ID, cliente_nombre: 'HUERFANO', monto: -7, fecha: '2026-10-05', nota: null, creado_en: new Date(2026, 9, 5, 8, 0, 0, 3) });
  r = await invocarRuta(handlerDe('delete', '/traspasos-saldo/:id'), { ...reqBase, params: { id: 'h1' } });
  check(r.status === 409 && AJUSTES.some(a => a.id === 'h1'), '6c) una mitad sin pareja da 409 y no borra nada');

  // Frontend: la pestaña ya no es una maqueta
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const seccion = html.slice(html.indexOf('id="vista-traspasos"'), html.indexOf('id="vista-gastos"'));
  check(seccion.includes('id="selTraspasoSaldoOrigen"') && seccion.includes('id="selTraspasoSaldoDestino"'), '7a) la pestaña tiene las listas desplegables De/A');
  check(!/disabled/.test(seccion.replace(/id="btnTraspasarSaldo"/, '')), '7b) ya no tiene botones deshabilitados');
  check(/traspasos:\s*\(\)\s*=>\s*entrarTraspasoSaldo\(\)/.test(html), '7c) al entrar a la pestaña se cargan los clientes activos y el historial');
  check(/\.filter\(j => j\.activo !== false\)/.test(html), '7d) las listas filtran solo clientes activos');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
