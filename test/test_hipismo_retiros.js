// =================================================================
// PRUEBA: Administración > "Retiros" (25-10-2026, a pedido del usuario: "el retiro es para cuando se le cancela a un cliente:
// Raúl está ganando 200, se le coloca un retiro de 180 y queda en 20 ... PAGOS A CLIENTES +180, RAÚL -180 ... ordenado por día,
// se pueden editar o eliminar"). Un retiro es un traspaso de saldo (2 filas de hipismo_comisiones_ajustes) cuyo destino es la ficha
// fija PAGOS A CLIENTES (se crea sola como cuenta de comisión).
// =================================================================
const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

const GRUPO = 'g-ret-1', OTRO = 'g-ret-2';
let reloj = 1000, txAhora = null, seq = 0;
const AJUSTES = [];
const JUGADORES = [{ id: 'j1', grupo_id: GRUPO, nombre: 'RAUL', es_cuenta_comision: false }, { id: 'j2', grupo_id: GRUPO, nombre: 'ANA', es_cuenta_comision: false }];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql))
    return { rows: JUGADORES.filter(j => j.grupo_id === params[0] && params[1].includes(j.nombre)).map(j => ({ nombre: j.nombre })) };
  if (/^SELECT id, nombre, es_cuenta_comision FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: JUGADORES.filter(j => j.grupo_id === params[0]) };
  if (/^INSERT INTO jugadores/i.test(sql)) { const j = { id: 'j' + (JUGADORES.length + 1), grupo_id: params[0], nombre: params[1], es_cuenta_comision: /es_cuenta_comision\) VALUES/i.test(sql) }; JUGADORES.push(j); return { rows: [j] }; }
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
const post = body => invocar(handlerDe('post', '/retiros'), { ...base, body });
const saldoDe = nombre => AJUSTES.filter(a => a.grupo_id === GRUPO && a.cliente_nombre === nombre).reduce((s, a) => s + Number(a.monto), 0);

(async function main() {
  let r = await invocar(handlerDe('get', '/retiros'), base);
  check(r.salida.retiros.length === 0 && r.salida.cuenta === 'PAGOS A CLIENTES', '1) Sin retiros: lista vacía y se informa la cuenta PAGOS A CLIENTES');

  r = await post({ cliente: 'raul', monto: 180, fecha: '2026-10-24' });
  check(r.salida && r.salida.ok === true, '2) Registrar un retiro de 180 a Raúl responde ok');
  check(saldoDe('RAUL') === -180 && saldoDe('PAGOS A CLIENTES') === 180, '3) RAUL -180 y PAGOS A CLIENTES +180 (Raúl con +200 queda en 20)');
  const ficha = JUGADORES.find(j => j.nombre === 'PAGOS A CLIENTES');
  check(ficha && ficha.es_cuenta_comision === true, '4) La ficha PAGOS A CLIENTES se crea sola como cuenta de comisión (no sale como "quién apostó")');
  await post({ cliente: 'RAUL', monto: 20, fecha: '2026-10-25', nota: 'resto' });
  check(JUGADORES.filter(j => j.nombre === 'PAGOS A CLIENTES').length === 1, '5) La ficha no se duplica en el segundo retiro');
  await post({ cliente: 'Ana', monto: 50.5, fecha: '2026-10-25' });
  check(Math.abs(AJUSTES.filter(a => a.grupo_id === GRUPO).reduce((s, a) => s + Number(a.monto), 0)) < 1e-9, '6) Todos los retiros suman 0 (los balances siguen cuadrando)');

  r = await invocar(handlerDe('get', '/retiros'), base);
  const L = r.salida.retiros;
  check(L.length === 3, `7) La lista trae los 3 retiros -- trae ${L.length}`);
  check(L[0].fecha === '2026-10-25' && L[1].fecha === '2026-10-25' && L[2].fecha === '2026-10-24', '8) Ordenada por día, el más reciente primero');
  check(L[0].cliente === 'ANA' && L[0].monto === 50.5 && L[0].nota === 'Retiro (pago a cliente)', '9) Dentro del mismo día el último registrado va primero, con la nota por defecto');
  AJUSTES.push({ id: 'zz1', grupo_id: OTRO, cliente_nombre: 'X', monto: -5, fecha: '2026-10-25', nota: null, creado_en: new Date(2026, 9, 25, 9, 0, 0, 1) });
  AJUSTES.push({ id: 'zz2', grupo_id: OTRO, cliente_nombre: 'PAGOS A CLIENTES', monto: 5, fecha: '2026-10-25', nota: null, creado_en: new Date(2026, 9, 25, 9, 0, 0, 1) });
  r = await invocar(handlerDe('get', '/retiros'), base);
  check(r.salida.retiros.length === 3, '10) No se mezclan retiros de otro grupo');
  // un traspaso normal no es un retiro
  await invocar(handlerDe('post', '/comisiones/traspaso'), { ...base, body: { clienteOrigen: 'RAUL', clienteDestino: 'ANA', monto: 7, fecha: '2026-10-25' } });
  r = await invocar(handlerDe('get', '/retiros'), base);
  check(r.salida.retiros.length === 3, '11) Un traspaso normal entre clientes no aparece como retiro');

  // validaciones
  r = await post({ cliente: 'RAUL', monto: 0 }); check(r.status === 400, '12) Monto 0 -> 400');
  r = await post({ cliente: '', monto: 5 }); check(r.status === 400, '13) Sin cliente -> 400');
  r = await post({ cliente: 'PAGOS A CLIENTES', monto: 5 }); check(r.status === 400, '14) No se le puede hacer un retiro a la propia cuenta PAGOS A CLIENTES');
  r = await post({ cliente: 'FANTASMA', monto: 5 }); check(r.status === 422, '15) Cliente que no existe -> 422');

  // editar
  const idRaul180 = L.find(x => x.monto === 180).id;
  r = await invocar(handlerDe('put', '/retiros/:id'), { ...base, params: { id: idRaul180 }, body: { monto: 150, fecha: '2026-10-23', nota: 'corregido' } });
  check(r.salida && r.salida.ok === true && saldoDe('RAUL') === -177 && saldoDe('PAGOS A CLIENTES') === 220.5, '16) Editar el monto de 180 a 150: RAUL y PAGOS A CLIENTES se corrigen juntos');
  r = await invocar(handlerDe('get', '/retiros'), base);
  const ed = r.salida.retiros.find(x => x.id === idRaul180);
  check(ed && ed.monto === 150 && ed.fecha === '2026-10-23' && ed.nota === 'corregido' && r.salida.retiros.length === 3 && r.salida.retiros[2].id === idRaul180, '17) Tras editar sigue siendo UN retiro, con la fecha/nota nuevas y en su día');
  r = await invocar(handlerDe('put', '/retiros/:id'), { ...base, params: { id: idRaul180 }, body: { cliente: 'ana' } });
  check(r.salida.ok === true && saldoDe('RAUL') === -27 && saldoDe('ANA') === -193.5, '18) Cambiar de cliente mueve el retiro (Raúl recupera 150, Ana lo recibe)');
  r = await invocar(handlerDe('put', '/retiros/:id'), { ...base, params: { id: 'no-existe' }, body: { monto: 1 } });
  check(r.status === 404, '19) Editar un retiro que no existe -> 404');
  r = await invocar(handlerDe('put', '/retiros/:id'), { ...base, params: { id: idRaul180 }, body: { monto: -3 } });
  check(r.status === 400, '20) Editar con monto inválido -> 400');

  // eliminar
  r = await invocar(handlerDe('delete', '/retiros/:id'), { ...base, params: { id: idRaul180 } });
  check(r.salida.ok === true, '21) Eliminar un retiro responde ok');
  r = await invocar(handlerDe('get', '/retiros'), base);
  check(r.salida.retiros.length === 2 && !r.salida.retiros.some(x => x.id === idRaul180), '22) Ya no sale en la lista');
  check(Math.abs(AJUSTES.filter(a => a.grupo_id === GRUPO).reduce((s, a) => s + Number(a.monto), 0)) < 1e-9, '23) Al eliminar siguen sumando 0 (se borran las 2 mitades)');
  r = await invocar(handlerDe('delete', '/retiros/:id'), { ...base, params: { id: idRaul180 } });
  check(r.status === 404, '24) Eliminar otra vez -> 404');
  const idTraspaso = AJUSTES.find(a => a.grupo_id === GRUPO && a.nota === null && a.cliente_nombre === 'RAUL');
  const antes = AJUSTES.length;
  const idT = AJUSTES.find(a => a.grupo_id === GRUPO && a.cliente_nombre === 'RAUL' && a.monto === -7);
  r = await invocar(handlerDe('delete', '/retiros/:id'), { ...base, params: { id: idT.id } });
  check(r.status === 404 && AJUSTES.length === antes, '25) Un traspaso normal no se puede borrar desde Retiros');
  r = await invocar(handlerDe('delete', '/retiros/:id'), { ...base, grupoId: OTRO, params: { id: L.find(x => x.cliente === 'ANA').id } });
  check(r.status === 404, '26) No se puede tocar un retiro de otro grupo');

  // pantalla
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const sec = html.slice(html.indexOf('id="vista-retiros"'), html.indexOf('</section>', html.indexOf('id="vista-retiros"')));
  check(!/disabled>\s*\+ Registrar retiro/.test(sec) && /onclick="guardarRetiro\(\)"/.test(sec), '27) El botón Registrar retiro ya no está desactivado y guarda');
  check(/retiros: \(\) => entrarRetiros\(\)/.test(html), '28) Al entrar a Retiros se cargan clientes y la lista');
  check(/editarRetiro\(/.test(html) && /eliminarRetiro\(/.test(html) && /nombreDiaRetiro/.test(html), '29) La lista por día tiene editar y eliminar');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
