// =================================================================
// PRUEBA: Saldos > "Recarga Saldos Pago Diarios" (26-10-2026, a pedido del usuario: "allí me van a aparecer todos los clientes con
// configuración de pago diario; se le recarga saldo, pero cada recarga va en contra de un ítem en los balances llamado POZOS PAGO
// DIARIOS: pongo Felipe +500 ... se le pondrán 500 más a Felipe y automáticamente POZOS PAGO DIARIOS -500"). Es un traspaso de saldo
// (2 filas de hipismo_comisiones_ajustes): el cliente suma y la ficha fija POZOS PAGO DIARIOS (cuenta de comisión) resta.
// =================================================================
const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

const GRUPO = 'g-ret-1', OTRO = 'g-ret-2';
let sinColumna = false;
let reloj = 1000, txAhora = null, seq = 0;
const AJUSTES = [];
const JUGADORES = [{ id: 'j1', grupo_id: GRUPO, nombre: 'FELIPE', es_cuenta_comision: false, pago_diario: true, activo: true }, { id: 'j2', grupo_id: GRUPO, nombre: 'ANA', es_cuenta_comision: false, pago_diario: true, activo: true },
  { id: 'j3', grupo_id: GRUPO, nombre: 'LUIS', es_cuenta_comision: false, pago_diario: false, activo: true }, { id: 'j4', grupo_id: OTRO, nombre: 'PEPE', es_cuenta_comision: false, pago_diario: true, activo: true }];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql))
    return { rows: JUGADORES.filter(j => j.grupo_id === params[0] && params[1].includes(j.nombre)).map(j => ({ nombre: j.nombre })) };
  if (/^SELECT id, nombre, es_cuenta_comision FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: JUGADORES.filter(j => j.grupo_id === params[0]) };
  if (/^INSERT INTO jugadores/i.test(sql)) { const j = { id: 'j' + (JUGADORES.length + 1), grupo_id: params[0], nombre: params[1], es_cuenta_comision: /es_cuenta_comision\) VALUES/i.test(sql) }; JUGADORES.push(j); return { rows: [j] }; }
  if (/^SELECT nombre, COALESCE\(activo, true\) AS activo FROM jugadores WHERE grupo_id = \$1 AND pago_diario = true/i.test(sql)) {
    if (sinColumna) { const e = new Error('no existe'); e.code = '42703'; throw e; }
    return { rows: JUGADORES.filter(j => j.grupo_id === params[0] && j.pago_diario && !j.es_cuenta_comision).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(j => ({ nombre: j.nombre, activo: j.activo })) };
  }
  if (sql === 'BEGIN') { txAhora = new Date(2026, 9, 25, 12, 0, 0, reloj++); return { rows: [] }; }
  if (sql === 'COMMIT' || sql === 'ROLLBACK') { txAhora = null; return { rows: [] }; }
  if (/^INSERT INTO hipismo_comisiones_ajustes/i.test(sql)) {
    const [grupo_id, cliente_nombre, monto, fecha, nota] = params;
    AJUSTES.push({ id: 'a' + (++seq), grupo_id, cliente_nombre, monto, fecha, nota, creado_en: txAhora || new Date() });
    return { rows: [] };
  }
  if (/^SELECT id, cliente_nombre, monto, fecha, nota, creado_en FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND creado_en IN \(SELECT creado_en/i.test(sql)) {
    const momentos = new Set(AJUSTES.filter(a => a.grupo_id === params[0] && a.cliente_nombre === params[1]).map(a => a.creado_en.getTime()));
    return { rows: AJUSTES.filter(a => a.grupo_id === params[0] && momentos.has(a.creado_en.getTime())).sort((x, y) => y.creado_en - x.creado_en) };
  }
  if (/^SELECT id, creado_en FROM hipismo_comisiones_ajustes WHERE id = \$1 AND grupo_id = \$2/i.test(sql)) return { rows: AJUSTES.filter(a => a.id === params[0] && a.grupo_id === params[1]) };
  if (/^SELECT id, cliente_nombre, monto, fecha, nota, creado_en FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND creado_en = \(SELECT creado_en FROM hipismo_comisiones_ajustes WHERE id = \$2 AND grupo_id = \$1\)/i.test(sql)) {
    const ref = AJUSTES.find(a => a.id === params[1] && a.grupo_id === params[0]);
    return { rows: ref ? AJUSTES.filter(a => a.grupo_id === params[0] && a.creado_en.getTime() === ref.creado_en.getTime()) : [] };
  }
  if (/^UPDATE hipismo_comisiones_ajustes SET cliente_nombre = \$1, monto = \$2, fecha = \$3, nota = \$4 WHERE grupo_id = \$5 AND id = \$6/i.test(sql)) {
    const a = AJUSTES.find(x => x.id === params[5] && x.grupo_id === params[4]);
    Object.assign(a, { cliente_nombre: params[0], monto: params[1], fecha: params[2], nota: params[3] }); return { rows: [] };
  }
  if (/^DELETE FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND id = ANY/i.test(sql)) {
    for (let i = AJUSTES.length - 1; i >= 0; i--) if (AJUSTES[i].grupo_id === params[0] && params[1].includes(AJUSTES[i].id)) AJUSTES.splice(i, 1);
    return { rows: [] };
  }
  throw new Error('La base falsa (retiros) no sabe responder: ' + sql);
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
  if (request === 'bcryptjs') return { hash: async () => 'h', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 't', verify: () => ({ grupoId: GRUPO }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake'; process.env.JWT_SECRET = 'fake';
const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocar(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    Promise.resolve(handler(req, res, e => { if (e) reject(e); })).catch(reject);
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { salida, status };
}
const base = { grupoId: GRUPO, grupo: { nombre: 'Z' }, params: {}, query: {} };
const post = body => invocar(handlerDe('post', '/recargas-pago-diario'), { ...base, body });
const saldoDe = nombre => AJUSTES.filter(a => a.grupo_id === GRUPO && a.cliente_nombre === nombre).reduce((s, a) => s + Number(a.monto), 0);

(async function main() {
  let r = await invocar(handlerDe('get', '/recargas-pago-diario'), base);
  check(r.salida.recargas.length === 0 && r.salida.cuenta === 'POZOS PAGO DIARIOS', '1) Sin recargas: lista vacía y se informa la cuenta POZOS PAGO DIARIOS');
  check(JSON.stringify(r.salida.clientes.map(c => c.nombre)) === JSON.stringify(['ANA', 'FELIPE']), '2) La lista trae SOLO los clientes de pago diario del grupo (no LUIS, no los de otro grupo)');

  r = await post({ cliente: 'felipe', monto: 500, fecha: '2026-10-26' });
  check(r.salida && r.salida.ok === true, '3) Recargar 500 a Felipe responde ok');
  check(saldoDe('FELIPE') === 500 && saldoDe('POZOS PAGO DIARIOS') === -500, '4) FELIPE +500 y POZOS PAGO DIARIOS -500 (automático)');
  const ficha = JUGADORES.find(j => j.nombre === 'POZOS PAGO DIARIOS');
  check(ficha && ficha.es_cuenta_comision === true, '5) La ficha POZOS PAGO DIARIOS se crea sola como cuenta de comisión');
  await post({ cliente: 'FELIPE', monto: 100, fecha: '2026-10-27', nota: 'pago móvil' });
  await post({ cliente: 'Ana', monto: 50.5, fecha: '2026-10-27' });
  check(JUGADORES.filter(j => j.nombre === 'POZOS PAGO DIARIOS').length === 1, '6) La ficha no se duplica');
  check(Math.abs(AJUSTES.filter(a => a.grupo_id === GRUPO).reduce((s, a) => s + Number(a.monto), 0)) < 1e-9, '7) Todas las recargas suman 0 (los balances siguen cuadrando)');
  check(saldoDe('POZOS PAGO DIARIOS') === -650.5, '8) POZOS PAGO DIARIOS acumula -650,50');

  r = await invocar(handlerDe('get', '/recargas-pago-diario'), base);
  const L = r.salida.recargas;
  check(L.length === 3 && L[0].fecha === '2026-10-27' && L[1].fecha === '2026-10-27' && L[2].fecha === '2026-10-26', `9) Lista de 3 ordenada por día, la más reciente primero (${L.length})`);
  check(L[0].cliente === 'ANA' && L[0].monto === 50.5 && L[0].nota === 'Recarga de saldo (pago diario)' && L[1].nota === 'pago móvil', '10) Cliente, monto y nota (por defecto o la escrita)');

  r = await post({ cliente: 'LUIS', monto: 10 });
  check(r.status === 422 && /PAGO DIARIO/.test(r.salida.error) && saldoDe('LUIS') === 0, '11) Un cliente que NO es de pago diario se rechaza (422) y no se mueve su saldo');
  r = await post({ cliente: 'PEPE', monto: 10 });
  check(r.status === 422, '12) Un pago diario de OTRO grupo se rechaza');
  r = await post({ cliente: 'FELIPE', monto: 0 });
  check(r.status === 400 && /mayor a 0/.test(r.salida.error), '13) Monto 0 se rechaza');
  r = await post({ cliente: '', monto: 5 });
  check(r.status === 400, '14) Sin cliente se rechaza');
  r = await post({ cliente: 'POZOS PAGO DIARIOS', monto: 5 });
  check(r.status === 400, '15) La cuenta POZOS PAGO DIARIOS no se puede recargar a sí misma');
  sinColumna = true;
  r = await post({ cliente: 'FELIPE', monto: 5 });
  sinColumna = false;
  check(r.status === 422, '16) Sin la columna pago_diario nadie es de pago diario (no se mueve nada)');

  // editar
  const idFelipe500 = L[2].id;
  r = await invocar(handlerDe('put', '/recargas-pago-diario/:id'), { ...base, params: { id: idFelipe500 }, body: { monto: 400 } });
  check(r.salida && r.salida.ok && saldoDe('FELIPE') === 500 && saldoDe('POZOS PAGO DIARIOS') === -550.5, '17) Cambiar 500 por 400: FELIPE 500 en total (400+100) y POZOS PAGO DIARIOS -550,50');
  check(Math.abs(AJUSTES.filter(a => a.grupo_id === GRUPO).reduce((s, a) => s + Number(a.monto), 0)) < 1e-9, '18) Editar no rompe el cuadre (suma 0)');
  r = await invocar(handlerDe('put', '/recargas-pago-diario/:id'), { ...base, params: { id: idFelipe500 }, body: { cliente: 'LUIS' } });
  check(r.status === 422, '19) Editar la recarga hacia un cliente que no es de pago diario se rechaza');
  r = await invocar(handlerDe('put', '/recargas-pago-diario/:id'), { ...base, params: { id: 'noexiste' }, body: { monto: 1 } });
  check(r.status === 404, '20) Editar una recarga que no existe da 404');

  // eliminar
  r = await invocar(handlerDe('delete', '/recargas-pago-diario/:id'), { ...base, params: { id: idFelipe500 } });
  check(r.salida && r.salida.ok && saldoDe('FELIPE') === 100 && saldoDe('POZOS PAGO DIARIOS') === -150.5, '21) Eliminar la recarga devuelve el saldo: FELIPE 100 y POZOS PAGO DIARIOS -150,50');
  r = await invocar(handlerDe('get', '/recargas-pago-diario'), base);
  check(r.salida.recargas.length === 2, '22) Quedan 2 recargas');
  // una recarga no aparece como retiro
  r = await invocar(handlerDe('get', '/retiros'), base);
  check(r.salida.retiros.length === 0, '23) Las recargas no se mezclan con los Retiros');

  // pantalla + permisos
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  check(/data-vista="recargaPagoDiario"[^>]*>💵<span class="nav-lbl"> Recarga Saldos Pago Diarios/.test(html), '24) Hay un botón "Recarga Saldos Pago Diarios" en el menú');
  const navPos = html.indexOf('data-vista="recargaPagoDiario"'), saldosPos = html.indexOf('id="grupoSaldos"'), comPos = html.indexOf('id="grupoComisiones"');
  check(saldosPos > 0 && navPos > saldosPos && navPos < comPos, '25) El botón está dentro de la pestaña Saldos');
  check(/id="vista-recargaPagoDiario"/.test(html) && /recargaPagoDiario: \(\) => entrarRecargaPagoDiario\(\)/.test(html), '26) Existe la pantalla y se carga al entrar');
  check(/confirm\(`¿Recargar/.test(html), '27) Pide confirmar antes de recargar');
  const F = require(path.join(__dirname, '..', 'src', 'services', 'funcionesGrupo'));
  check(F.seccionDeVistaHipismo('recargaPagoDiario') === 'hip_saldos', '28) La pantalla pertenece a la sección Saldos');
  check(F.rutaHipismoPermitida({ funciones_habilitadas: ['hip_saldos'] }, 'POST', '/recargas-pago-diario') && !F.rutaHipismoPermitida({ funciones_habilitadas: ['hip_planos'] }, 'POST', '/recargas-pago-diario'), '29) El servidor la deja pasar solo con la sección Saldos (o Finanzas) activa');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
