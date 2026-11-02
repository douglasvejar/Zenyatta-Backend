// =================================================================
// PRUEBA: método de pago, referencia y foto del comprobante de RECARGAS (pago diario) y RETIROS (02-11-2026, a pedido del usuario:
// "puedo elegir el método por el cual se hizo la recarga: zelle, pago móvil, dólares efectivo, bolívares efectivo, banesco panamá,
// cash app, otro (lo que escriban queda guardado en la lista de ESE grupo)... la referencia y/o la foto... y al ver el detallado del
// cliente se debe ver de quién/para quién fue, y si tiene imagen un botón de ver imagen").
// =================================================================
const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

const GRUPO = 'g-pag-1', OTRO = 'g-pag-2';


const AJUSTES = [];
const DETALLES = [];   // { ajuste_id, grupo_id, metodo, referencia, imagen_base64, imagen_mime }
const METODOS = [];    // { grupo_id, nombre }
const JUGADORES = [{ id: 'j1', grupo_id: GRUPO, nombre: 'RAUL', es_cuenta_comision: false }, { id: 'j9', grupo_id: GRUPO, nombre: 'FELIPE', es_cuenta_comision: false, pago_diario: true }, { id: 'j8', grupo_id: GRUPO, nombre: 'LUIS', es_cuenta_comision: false, pago_diario: true }];
const UUID = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let reloj = 1000, txAhora = null, seq = 0;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql))
    return { rows: JUGADORES.filter(j => j.grupo_id === params[0] && params[1].includes(j.nombre)).map(j => ({ nombre: j.nombre })) };
  if (/^SELECT 1 FROM jugadores WHERE grupo_id = \$1 AND nombre = \$2 AND pago_diario = true/i.test(sql))
    return { rows: JUGADORES.filter(j => j.grupo_id === params[0] && j.nombre === params[1] && j.pago_diario === true).map(() => ({ '?column?': 1 })) };
  if (/^SELECT nombre, COALESCE\(activo, true\) AS activo FROM jugadores/i.test(sql))
    return { rows: JUGADORES.filter(j => j.grupo_id === params[0] && j.pago_diario === true).map(j => ({ nombre: j.nombre, activo: true })) };
  if (/^SELECT id, nombre, es_cuenta_comision FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: JUGADORES.filter(j => j.grupo_id === params[0]) };
  if (/^INSERT INTO jugadores/i.test(sql)) { const j = { id: 'j' + (JUGADORES.length + 1), grupo_id: params[0], nombre: params[1], es_cuenta_comision: /es_cuenta_comision\) VALUES/i.test(sql) }; JUGADORES.push(j); return { rows: [j] }; }
  if (sql === 'BEGIN') { txAhora = new Date(2026, 10, 2, 12, 0, 0, reloj++); return { rows: [] }; }
  if (sql === 'COMMIT' || sql === 'ROLLBACK') { txAhora = null; return { rows: [] }; }
  if (/^INSERT INTO hipismo_comisiones_ajustes/i.test(sql)) {
    const [grupo_id, cliente_nombre, monto, fecha, nota] = params;
    const a = { id: UUID(++seq), grupo_id, cliente_nombre, monto, fecha, nota, creado_en: txAhora || new Date() };
    AJUSTES.push(a);
    return { rows: /RETURNING id/i.test(sql) ? [{ id: a.id }] : [] };
  }
  if (/^SELECT id, cliente_nombre, monto, fecha, nota, creado_en FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND creado_en IN \(SELECT creado_en/i.test(sql)) {
    const cuentas = Array.isArray(params[1]) ? params[1] : [params[1]];
    const momentos = new Set(AJUSTES.filter(a => a.grupo_id === params[0] && cuentas.includes(a.cliente_nombre)).map(a => a.creado_en.getTime()));
    return { rows: AJUSTES.filter(a => a.grupo_id === params[0] && momentos.has(a.creado_en.getTime())).sort((x, y) => y.creado_en - x.creado_en) };
  }
  if (/^SELECT id, creado_en FROM hipismo_comisiones_ajustes WHERE id = \$1 AND grupo_id = \$2/i.test(sql)) return { rows: AJUSTES.filter(a => a.id === params[0] && a.grupo_id === params[1]) };
  if (/^SELECT id, cliente_nombre, monto, fecha, nota, creado_en FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND creado_en = \(SELECT creado_en/i.test(sql)) {
    const ref = AJUSTES.find(a => a.id === params[1] && a.grupo_id === params[0]);
    return { rows: ref ? AJUSTES.filter(a => a.grupo_id === params[0] && a.creado_en.getTime() === ref.creado_en.getTime()) : [] };
  }
  if (/^UPDATE hipismo_comisiones_ajustes SET cliente_nombre = \$1, monto = \$2, fecha = \$3, nota = \$4 WHERE grupo_id = \$5 AND id = \$6/i.test(sql)) {
    const a = AJUSTES.find(x => x.id === params[5] && x.grupo_id === params[4]);
    Object.assign(a, { cliente_nombre: params[0], monto: params[1], fecha: params[2], nota: params[3] }); return { rows: [] };
  }
  if (/^DELETE FROM hipismo_comisiones_ajustes WHERE grupo_id = \$1 AND id = ANY/i.test(sql)) {
    for (let i = AJUSTES.length - 1; i >= 0; i--) if (AJUSTES[i].grupo_id === params[0] && params[1].includes(AJUSTES[i].id)) AJUSTES.splice(i, 1);
    for (let i = DETALLES.length - 1; i >= 0; i--) if (!AJUSTES.some(a => a.id === DETALLES[i].ajuste_id)) DETALLES.splice(i, 1); // ON DELETE CASCADE
    return { rows: [] };
  }
  // ---- detalle del pago
  if (/^INSERT INTO hipismo_metodos_pago/i.test(sql)) {
    if (!METODOS.some(m => m.grupo_id === params[0] && m.nombre.toLowerCase() === String(params[1]).toLowerCase())) METODOS.push({ grupo_id: params[0], nombre: params[1] });
    return { rows: [] };
  }
  if (/^SELECT nombre FROM hipismo_metodos_pago WHERE grupo_id = \$1 AND lower\(nombre\)/i.test(sql)) return { rows: METODOS.filter(m => m.grupo_id === params[0] && m.nombre.toLowerCase() === String(params[1]).toLowerCase()).map(m => ({ nombre: m.nombre })) };
  if (/^SELECT nombre FROM hipismo_metodos_pago WHERE grupo_id = \$1/i.test(sql)) return { rows: METODOS.filter(m => m.grupo_id === params[0]).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(m => ({ nombre: m.nombre })) };
  if (/^INSERT INTO hipismo_pagos_detalle/i.test(sql)) {
    const [ajuste_id, grupo_id, metodo, referencia, img, mime] = params;
    const ex = DETALLES.find(d => d.ajuste_id === ajuste_id);
    if (ex) { Object.assign(ex, { metodo, referencia }); if (img) { ex.imagen_base64 = img; ex.imagen_mime = mime; } }
    else DETALLES.push({ ajuste_id, grupo_id, metodo, referencia, imagen_base64: img, imagen_mime: mime });
    return { rows: [] };
  }
  if (/^UPDATE hipismo_pagos_detalle SET metodo = NULL, referencia = NULL/i.test(sql)) {
    DETALLES.filter(d => d.grupo_id === params[0] && d.ajuste_id === params[1]).forEach(d => { d.metodo = null; d.referencia = null; }); return { rows: [] };
  }
  if (/^DELETE FROM hipismo_pagos_detalle WHERE grupo_id = \$1 AND ajuste_id = \$2 AND imagen_base64 IS NULL/i.test(sql)) {
    for (let i = DETALLES.length - 1; i >= 0; i--) if (DETALLES[i].grupo_id === params[0] && DETALLES[i].ajuste_id === params[1] && !DETALLES[i].imagen_base64) DETALLES.splice(i, 1);
    return { rows: [] };
  }
  if (/^SELECT ajuste_id, metodo, referencia, \(imagen_base64 IS NOT NULL\) AS tiene_imagen FROM hipismo_pagos_detalle/i.test(sql))
    return { rows: DETALLES.filter(d => d.grupo_id === params[0] && params[1].includes(d.ajuste_id)).map(d => ({ ajuste_id: d.ajuste_id, metodo: d.metodo, referencia: d.referencia, tiene_imagen: !!d.imagen_base64 })) };
  if (/^SELECT imagen_base64, imagen_mime FROM hipismo_pagos_detalle/i.test(sql))
    return { rows: DETALLES.filter(d => d.grupo_id === params[0] && d.ajuste_id === params[1] && d.imagen_base64).map(d => ({ imagen_base64: d.imagen_base64, imagen_mime: d.imagen_mime })) };
  // ---- lectura del detallado de un cliente (con la contraparte del par)
  if (/^SELECT a\.id, a\.monto, a\.fecha, a\.nota, \(SELECT b\.cliente_nombre/i.test(sql)) {
    const [g, nombre, desde, hasta] = params;
    const par = a => AJUSTES.find(b => b.grupo_id === a.grupo_id && b.creado_en.getTime() === a.creado_en.getTime() && b.id !== a.id && b.monto === -a.monto);
    return { rows: AJUSTES.filter(a => a.grupo_id === g && a.cliente_nombre === nombre && a.fecha >= desde && a.fecha <= hasta)
      .map(a => ({ id: a.id, monto: a.monto, fecha: a.fecha, nota: a.nota, contraparte: par(a) ? par(a).cliente_nombre : null, contraparte_id: par(a) ? par(a).id : null })) };
  }
  throw new Error('La base falsa (pagos detalle) no sabe responder: ' + sql);
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
const pagos = require(path.join(__dirname, '..', 'src', 'services', 'hipismoPagosDetalle'));
const resumen = require(path.join(__dirname, '..', 'src', 'services', 'hipismoResumenCliente'));
Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocar(handler, req) {
  let salida = null, status = 200, tipo = null, cuerpo = null;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, set(k, v) { if (/content-type/i.test(k)) tipo = v; return this; }, send(b) { cuerpo = b; resolve(); }, json(o) { salida = o; resolve(); } };
    Promise.resolve(handler(req, res, e => { if (e) reject(e); })).catch(reject);
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { salida, status, tipo, cuerpo };
}
const base = { grupoId: GRUPO, grupo: { nombre: 'Z' }, params: {}, query: {} };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const IMG = { base64: PNG.toString('base64'), mime: 'image/png' };

(async function main() {
  // ---- validación pura
  let v = pagos.validarDatosPago({});
  check(v.ok && !v.datos.hayAlgo, '1) Sin método, referencia ni imagen: todo es opcional (no hay nada que guardar)');
  v = pagos.validarDatosPago({ metodo: ' zelle ', referencia: '  123  456 ' });
  check(v.ok && v.datos.metodo === 'Zelle' && v.datos.referencia === '123 456', '2) El método predeterminado se normaliza ("zelle" -> "Zelle") y la referencia se limpia');
  v = pagos.validarDatosPago({ imagen: { base64: IMG.base64, mime: 'application/pdf' } });
  check(!v.ok, '3) Solo se aceptan imágenes (JPG, PNG, WEBP, GIF)');
  v = pagos.validarDatosPago({ imagen: { base64: 'A'.repeat(6 * 1024 * 1024), mime: 'image/png' } });
  check(!v.ok && /4 MB/.test(v.error), '4) Una imagen de más de 4 MB se rechaza con un mensaje claro');
  v = pagos.validarDatosPago({ imagen: 'data:image/png;base64,' + IMG.base64 });
  check(v.ok && v.datos.imagenMime === 'image/png' && v.datos.imagenIncluida, '5) También acepta la imagen como data URL');
  v = pagos.validarDatosPago({ metodo: 'x'.repeat(61) });
  check(!v.ok, '6) Un método de más de 60 letras se rechaza');

  // ---- métodos por grupo
  let r = await invocar(handlerDe('get', '/metodos-pago'), base);
  check(JSON.stringify(r.salida.predeterminados) === JSON.stringify(['Zelle', 'Pago móvil', 'Dólares efectivo', 'Bolívares efectivo', 'Banesco Panamá', 'Cash App']) && r.salida.personalizados.length === 0,
    '7) Cada grupo arranca con los 6 métodos predeterminados y ninguno propio');

  // ---- recarga con método "Otro" + referencia + imagen
  r = await invocar(handlerDe('post', '/recargas-pago-diario'), { ...base, body: { cliente: 'felipe', monto: 500, fecha: '2026-11-02', metodo: 'Binance', referencia: 'TX-889', imagen: IMG } });
  check(r.salida && r.salida.ok === true, '8) Recargar con método nuevo, referencia e imagen responde ok');
  r = await invocar(handlerDe('get', '/metodos-pago'), base);
  check(r.salida.personalizados.length === 1 && r.salida.personalizados[0] === 'Binance', '9) El método escrito en "Otro" queda guardado en la lista del grupo');
  r = await invocar(handlerDe('get', '/metodos-pago'), { ...base, grupoId: OTRO });
  check(r.salida.personalizados.length === 0, '10) Otro grupo NO ve los métodos de este grupo');
  await invocar(handlerDe('post', '/recargas-pago-diario'), { ...base, body: { cliente: 'luis', monto: 100, fecha: '2026-11-02', metodo: 'binance' } });
  r = await invocar(handlerDe('get', '/metodos-pago'), base);
  check(r.salida.personalizados.length === 1, '11) Escribir el mismo método con otras mayúsculas no lo duplica');
  await invocar(handlerDe('post', '/recargas-pago-diario'), { ...base, body: { cliente: 'luis', monto: 40, fecha: '2026-11-02', metodo: 'zelle' } });
  r = await invocar(handlerDe('get', '/metodos-pago'), base);
  check(r.salida.personalizados.length === 1, '12) Un método predeterminado no se copia a la lista propia');

  // ---- lista de recargas
  r = await invocar(handlerDe('get', '/recargas-pago-diario'), base);
  const LR = r.salida.recargas;
  const rf = LR.find(x => x.cliente === 'FELIPE');
  check(rf && rf.metodo === 'Binance' && rf.referencia === 'TX-889' && rf.tieneImagen === true, '13) La lista de recargas trae método, referencia y si tiene imagen');
  const rl = LR.find(x => x.cliente === 'LUIS' && x.monto === 100);
  check(rl && rl.metodo === 'Binance' && rl.referencia === null && rl.tieneImagen === false, '14) Una recarga sin referencia ni imagen lo dice');
  r = await invocar(handlerDe('post', '/recargas-pago-diario'), { ...base, body: { cliente: 'luis', monto: 10, fecha: '2026-11-02' } });
  r = await invocar(handlerDe('get', '/recargas-pago-diario'), base);
  const rs = r.salida.recargas.find(x => x.monto === 10);
  check(rs && rs.metodo === null && rs.tieneImagen === false && DETALLES.length === 3, '15) Una recarga sin datos de pago se guarda igual que siempre (no crea detalle)');
  check(Math.abs(AJUSTES.reduce((s, a) => s + Number(a.monto), 0)) < 1e-9, '16) Los saldos siguen sumando 0');

  // ---- comprobante
  r = await invocar(handlerDe('get', '/comprobantes/:id'), { ...base, params: { id: rf.id } });
  check(r.tipo === 'image/png' && Buffer.isBuffer(r.cuerpo) && r.cuerpo.equals(PNG), '17) El comprobante devuelve exactamente la imagen subida');
  r = await invocar(handlerDe('get', '/comprobantes/:id'), { ...base, grupoId: OTRO, params: { id: rf.id } });
  check(r.status === 404, '18) Otro grupo no puede ver el comprobante');
  r = await invocar(handlerDe('get', '/comprobantes/:id'), { ...base, params: { id: 'no-es-un-id' } });
  check(r.status === 404, '19) Un id inválido -> 404');
  r = await invocar(handlerDe('get', '/comprobantes/:id'), { ...base, params: { id: rs.id } });
  check(r.status === 404, '20) Una recarga sin imagen -> 404');

  // ---- detallado del cliente: de quién / para quién + pago
  const FILAS_F = await resumen.leerTraspasosConDetalle(GRUPO, 'FELIPE', '2026-10-26', '2026-11-01'.replace('11-01', '11-08'));
  check(FILAS_F.length === 1 && FILAS_F[0].contraparte === 'POZOS PAGO DIARIOS' && FILAS_F[0].pago.metodo === 'Binance' && FILAS_F[0].pago.tieneImagen === true && FILAS_F[0].pago.comprobanteId === rf.id,
    '21) En el detallado de FELIPE la recarga muestra la contraparte, el método y el id del comprobante');
  const FILAS_P = await resumen.leerTraspasosConDetalle(GRUPO, 'POZOS PAGO DIARIOS', '2026-10-26', '2026-11-08');
  const lineaF = FILAS_P.map(resumen.lineaTraspaso).find(l => l.pago && l.pago.referencia === 'TX-889');
  check(FILAS_P.length === 4 && lineaF && lineaF.contraparte === 'FELIPE' && lineaF.resultado === -500 && lineaF.pago.comprobanteId === rf.id,
    '22) En el detallado de POZOS PAGO DIARIOS cada recarga dice para qué cliente fue, con su método, referencia y comprobante');
  check(FILAS_P.map(resumen.lineaTraspaso).filter(l => l.contraparte).length === 4, '23) Las 4 recargas dicen para quién fueron');

  // ---- editar
  r = await invocar(handlerDe('put', '/recargas-pago-diario/:id'), { ...base, params: { id: rf.id }, body: { referencia: 'TX-900' } });
  check(r.salida.ok === true, '24a) Editar solo la referencia responde ok');
  const dF = DETALLES.find(d => d.ajuste_id === rf.id);
  check(dF.referencia === 'TX-900' && dF.imagen_base64 === IMG.base64, '24) Al editar la referencia sin subir otra foto, la imagen anterior se conserva');
  r = await invocar(handlerDe('put', '/recargas-pago-diario/:id'), { ...base, params: { id: rf.id }, body: { metodo: '', referencia: '' } });
  const dF2 = DETALLES.find(d => d.ajuste_id === rf.id);
  check(dF2 && dF2.metodo === null && dF2.referencia === null && dF2.imagen_base64, '25) Vaciar método y referencia los borra pero conserva la foto');
  r = await invocar(handlerDe('put', '/recargas-pago-diario/:id'), { ...base, params: { id: rl.id }, body: { metodo: '', referencia: '' } });
  check(!DETALLES.some(d => d.ajuste_id === rl.id), '26) Si al vaciar no queda nada (ni foto), el detalle desaparece');
  r = await invocar(handlerDe('put', '/recargas-pago-diario/:id'), { ...base, params: { id: rf.id }, body: { monto: 450 } });
  check(r.salida.ok === true && DETALLES.some(d => d.ajuste_id === rf.id), '27) Editar solo el monto no toca el detalle del pago');

  // ---- eliminar: se va el detalle
  r = await invocar(handlerDe('delete', '/recargas-pago-diario/:id'), { ...base, params: { id: rf.id } });
  check(r.salida.ok === true && !DETALLES.some(d => d.ajuste_id === rf.id), '28) Eliminar la recarga borra también su detalle y su imagen');

  // ---- retiro
  r = await invocar(handlerDe('post', '/retiros'), { ...base, body: { cliente: 'raul', monto: 80, fecha: '2026-11-02', metodo: 'Pago móvil', referencia: '0102', imagen: IMG } });
  check(r.salida && r.salida.ok === true, '30) Un retiro también acepta método, referencia e imagen');
  r = await invocar(handlerDe('get', '/retiros'), base);
  const rr = r.salida.retiros.find(x => x.cliente === 'RAUL');
  check(rr && rr.metodo === 'Pago móvil' && rr.referencia === '0102' && rr.tieneImagen === true, '31) La lista de retiros trae método, referencia e imagen');
  r = await invocar(handlerDe('get', '/comprobantes/:id'), { ...base, params: { id: rr.id } });
  check(r.tipo === 'image/png' && r.cuerpo.equals(PNG), '32) El comprobante del retiro se puede ver');
  const FR = await resumen.leerTraspasosConDetalle(GRUPO, 'PAGOS A CLIENTES', '2026-10-26', '2026-11-08');
  check(FR.length === 1 && FR[0].contraparte === 'RAUL' && FR[0].pago && FR[0].pago.metodo === 'Pago móvil' && FR[0].pago.comprobanteId === rr.id,
    '33) En el detallado de PAGOS A CLIENTES el retiro dice de qué cliente fue y trae el pago (aunque el detalle cuelga de la otra mitad)');
  r = await invocar(handlerDe('post', '/retiros'), { ...base, body: { cliente: 'raul', monto: 5, imagen: { base64: IMG.base64, mime: 'text/html' } } });
  check(r.status === 400, '34) Un retiro con un archivo que no es imagen -> 400 y no se guarda nada');
  check(AJUSTES.filter(a => a.monto === -5).length === 0, '35) Tampoco quedaron filas a medias');
  r = await invocar(handlerDe('put', '/retiros/:id'), { ...base, params: { id: rr.id }, body: { metodo: 'Zelle' } });
  check(r.salida.ok === true && DETALLES.find(d => d.ajuste_id === rr.id).metodo === 'Zelle', '36) Editar el método de un retiro lo cambia');
  r = await invocar(handlerDe('delete', '/retiros/:id'), { ...base, params: { id: rr.id } });
  check(r.salida.ok === true && !DETALLES.some(d => d.ajuste_id === rr.id), '37) Eliminar el retiro borra su detalle');

  // ---- pantalla y permisos
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const secRec = html.slice(html.indexOf('id="vista-recargaPagoDiario"'), html.indexOf('</section>', html.indexOf('id="vista-recargaPagoDiario"')));
  const secRet = html.slice(html.indexOf('id="vista-retiros"'), html.indexOf('</section>', html.indexOf('id="vista-retiros"')));
  check(/id="bloquePagoRec"/.test(secRec) && /id="bloquePagoRet"/.test(secRet), '40) Las pantallas de Recarga y Retiros tienen el bloque de datos del pago');
  check(/Otro…/.test(html) && /accept="image\/\*"/.test(html) && /verComprobante\(/.test(html) && /\/api\/hipismo\/comprobantes\//.test(html), '41) El formulario tiene "Otro…", la foto y el botón Ver imagen que pide el comprobante con la sesión');
  check(/detalleContrapartePagoHtml\(c\)/.test(html) && /textoTraspasoPDF\(t\)/.test(html), '42) El detallado del cliente (pantalla y PDF) muestra de quién/para quién y el pago');
  check(/ignoreElements/.test(html), '43) El botón Ver imagen no sale en la imagen que se copia del detallado');
  const F = require('../src/services/funcionesGrupo');
  check(F.seccionesDeRutaHipismo('GET', '/metodos-pago') && F.seccionesDeRutaHipismo('GET', '/comprobantes/abc'), '44) Las rutas nuevas tienen sección (el candado por grupo las conoce)');
  check(F.rutaHipismoPermitida({ funciones_habilitadas: ['hip_clientes'] }, 'GET', '/comprobantes/abc') && !F.rutaHipismoPermitida({ funciones_habilitadas: ['hip_planos'] }, 'GET', '/comprobantes/abc'), '45) Quien puede ver el detallado del cliente puede ver el comprobante; sin esas secciones no');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})();
