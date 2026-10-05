// =================================================================
// PRUEBA: "Fecha de Semana" ACTIVA (05-10-2026, a pedido del usuario:
// "activame esta pantalla, no funciona"). Cada grupo define el día en que
// empieza y el día en que cierra su semana de Hipismo; todos los reportes la
// usan. Casos del usuario: hoy lunes 05-10-2026, "empieza Lunes, cierra
// Lunes" -> 05/10 al 12/10 (8 días); la siguiente arranca el martes 13/10.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

const GRUPO_ID = 'g-semana-1';
const GRUPO = { inicio: null, cierre: null, desde: null, hasta: null };
let consultasGrupos = 0;

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/^SELECT hipismo_semana_inicio, hipismo_semana_cierre, to_char\(hipismo_semana_desde, 'YYYY-MM-DD'\) AS hipismo_semana_desde, to_char\(hipismo_semana_hasta, 'YYYY-MM-DD'\) AS hipismo_semana_hasta FROM grupos WHERE id = \$1/i.test(sql)) {
    consultasGrupos++;
    if (params[0] !== GRUPO_ID) return { rows: [] };
    return { rows: [{ hipismo_semana_inicio: GRUPO.inicio, hipismo_semana_cierre: GRUPO.cierre, hipismo_semana_desde: GRUPO.desde, hipismo_semana_hasta: GRUPO.hasta }] };
  }
  if (/^UPDATE grupos SET hipismo_semana_inicio = \$1, hipismo_semana_cierre = \$2, hipismo_semana_desde = \$3, hipismo_semana_hasta = \$4 WHERE id = \$5/i.test(sql)) {
    GRUPO.inicio = params[0]; GRUPO.cierre = params[1]; GRUPO.desde = params[2]; GRUPO.hasta = params[3];
    return { rows: [] };
  }
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}
const fakePool = function () {
  this.query = async (t, p) => ejecutarQuery(t, p);
  this.connect = async () => ({ query: async (t, p) => ejecutarQuery(t, p), release() {} });
  this.on = () => {};
};
function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...a) => { handlers.push([m, a]); return router; }; });
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
const sem = require(path.join(__dirname, '..', 'src', 'services', 'hipismoSemana'));
Module._load = originalLoad;

function handlerDe(m, p) { const e = hipismoRouter.__handlers.find(([mm, a]) => mm === m && a[0] === p); return e[1][e[1].length - 1]; }
async function invocarRuta(handler, req) {
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e.message));
  return { salida, status };
}
const fecha = iso => new Date(iso + 'T00:00:00Z');

(async function main() {
  // ---------- 1) Motor puro ----------
  const def = sem.CONFIG_DEFECTO;
  check(JSON.stringify(sem.rangoSemanaConfig(def, fecha('2026-10-05'), 0)) === '{"desde":"2026-10-05","hasta":"2026-10-11"}', '1a) por defecto: lunes 05/10 -> semana 05/10 al 11/10 (lunes a domingo)');
  check(JSON.stringify(sem.rangoSemanaConfig(def, fecha('2026-10-11'), 0)) === '{"desde":"2026-10-05","hasta":"2026-10-11"}', '1b) por defecto: el domingo 11/10 sigue en esa semana');
  check(sem.rangoSemanaConfig(def, fecha('2026-10-07'), -1).desde === '2026-09-28' && sem.rangoSemanaConfig(def, fecha('2026-10-07'), -2).desde === '2026-09-21', '1c) por defecto: semana anterior y hace 2 semanas');

  const lunLun = { inicio: 1, cierre: 1, desde: '2026-10-05' };
  const r = (iso, off) => sem.rangoSemanaConfig(lunLun, fecha(iso), off || 0);
  check(JSON.stringify(r('2026-10-05')) === '{"desde":"2026-10-05","hasta":"2026-10-12"}', '2a) Lunes->Lunes anclada el 05/10: la semana actual va del 05/10 al 12/10 (8 días, como en la captura)');
  check(JSON.stringify(r('2026-10-12')) === '{"desde":"2026-10-05","hasta":"2026-10-12"}', '2b) el lunes de cierre 12/10 cuenta en la semana que cierra');
  check(JSON.stringify(r('2026-10-13')) === '{"desde":"2026-10-13","hasta":"2026-10-19"}', '2c) la semana siguiente arranca el martes 13/10 y cierra el lunes 19/10');
  check(JSON.stringify(r('2026-10-20')) === '{"desde":"2026-10-20","hasta":"2026-10-26"}', '2d) y así sigue encadenada (20/10 al 26/10)');
  check(JSON.stringify(r('2026-10-04')) === '{"desde":"2026-09-28","hasta":"2026-10-04"}', '2e) antes de la ancla, la semana termina el día anterior (28/09 al 04/10)');
  check(JSON.stringify(r('2026-10-08', -1)) === '{"desde":"2026-09-28","hasta":"2026-10-04"}' && JSON.stringify(r('2026-10-15', -1)) === '{"desde":"2026-10-05","hasta":"2026-10-12"}', '2f) semana anterior: desde la 1ra semana queda la de antes; desde la 2da queda la de 8 días');
  check(JSON.stringify(r('2026-10-08', 1)) === '{"desde":"2026-10-13","hasta":"2026-10-19"}', '2g) semana siguiente de la actual');
  // ningún día en 2 semanas: recorrer 60 días y comprobar que cada día cae en exactamente 1 semana consecutiva
  let ok = true; let prevHasta = null;
  for (let ms = Date.parse('2026-09-01T00:00:00Z'); ms < Date.parse('2026-12-01T00:00:00Z'); ms += 86400000) {
    const iso = new Date(ms).toISOString().slice(0, 10);
    const w = sem.rangoSemanaConfig(lunLun, fecha(iso), 0);
    if (!(w.desde <= iso && iso <= w.hasta)) ok = false;
    if (w.desde !== (prevHasta && prevHasta.w.desde)) { if (prevHasta && w.desde !== prevHasta.w.desde && new Date(Date.parse(w.desde + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10) !== prevHasta.w.hasta) ok = false; }
    prevHasta = { w };
  }
  check(ok, '2h) 3 meses seguidos: cada día cae en una sola semana y las semanas son consecutivas (sin huecos ni días dobles)');
  const marJue = { inicio: 2, cierre: 4, desde: '2026-10-06' }; // martes -> jueves
  check(JSON.stringify(sem.rangoSemanaConfig(marJue, fecha('2026-10-07'), 0)) === '{"desde":"2026-10-06","hasta":"2026-10-08"}', '3a) Martes->Jueves: la primera semana dura 3 días (06/10 al 08/10)');
  check(JSON.stringify(sem.rangoSemanaConfig(marJue, fecha('2026-10-09'), 0)) === '{"desde":"2026-10-09","hasta":"2026-10-15"}', '3b) la siguiente arranca el viernes 09/10 y dura 7 días (cierra el jueves 15/10)');
  check(sem.anclaParaInicio(1, '2026-10-08') === '2026-10-05' && sem.anclaParaInicio(1, '2026-10-05') === '2026-10-05' && sem.anclaParaInicio(0, '2026-10-05') === '2026-10-04', '4) la ancla es el último día de "inicio" que ya pasó o es hoy');
  check(sem.parsearDia('Miércoles') === 3 && sem.parsearDia('miercoles') === 3 && sem.parsearDia(0) === 0 && sem.parsearDia('Funday') === null, '5) parsearDia acepta nombres (con o sin tilde) y 0-6');
  const des = sem.describirConfigSemana(lunLun, fecha('2026-10-05'));
  check(des.inicioNombre === 'Lunes' && des.cierreNombre === 'Lunes' && des.actual.hasta === '2026-10-12' && des.siguiente.desde === '2026-10-13' && des.anterior.hasta === '2026-10-04' && !des.esDefecto, '6) describirConfigSemana trae nombres y semanas anterior/actual/siguiente');
  const dias = sem.diasDelRango('2026-10-05', '2026-10-12');
  check(dias.length === 8 && dias[0] === '2026-10-05' && dias[7] === '2026-10-12', '7) diasDelRango da los 8 días de la semana extendida');

  // ---------- 2) Rutas con base falsa ----------
  const base = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {}, query: {}, body: {} };
  let x = await invocarRuta(handlerDe('get', '/semana-config'), base);
  check(x.status === 200 && x.salida.esDefecto === true && x.salida.inicioNombre === 'Lunes' && x.salida.cierreNombre === 'Domingo', '8a) sin configuración: GET /semana-config devuelve Lunes -> Domingo (por defecto)');
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { inicio: 'Funday', cierre: 'Lunes' } });
  check(x.status === 400, '8b) un día inválido da 400 y no guarda nada');
  const hoy = new Date(Date.now() - 4 * 60 * 60 * 1000);
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { inicio: 'Lunes', cierre: 'Lunes' } });
  check(x.status === 200 && GRUPO.inicio === 1 && GRUPO.cierre === 1 && /^\d{4}-\d{2}-\d{2}$/.test(GRUPO.desde) && new Date(GRUPO.desde + 'T00:00:00Z').getUTCDay() === 1, '8c) PUT Lunes -> Lunes guarda inicio=1, cierre=1 y una ancla que es lunes');
  check(x.salida.actual.desde === GRUPO.desde || x.salida.actual.desde <= GRUPO.desde, '8d) la respuesta trae la semana actual con la configuración guardada');
  const anclaGuardada = GRUPO.desde;
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { inicio: 'Lunes', cierre: 'Lunes' } });
  check(GRUPO.desde === anclaGuardada, '8e) guardar la misma configuración otra vez NO mueve la ancla');
  x = await invocarRuta(handlerDe('get', '/semana-actual'), { ...base, query: {} });
  check(x.salida && x.salida.rango.desde === sem.rangoSemanaConfig({ inicio: 1, cierre: 1, desde: anclaGuardada }, hoy, 0).desde && x.salida.rango.hasta === sem.rangoSemanaConfig({ inicio: 1, cierre: 1, desde: anclaGuardada }, hoy, 0).hasta, '9a) GET /semana-actual (la usa Balance General/Cierre Final) respeta la configuración guardada');
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { inicio: 'Lunes', cierre: 'Domingo' } });
  check(GRUPO.inicio === null && GRUPO.cierre === null && GRUPO.desde === null && x.salida.esDefecto === true, '10a) guardar Lunes -> Domingo borra la configuración (vuelve a la de siempre)');
  x = await invocarRuta(handlerDe('get', '/semana-actual'), { ...base, query: {} });
  check(x.salida.rango.desde === sem.rangoSemanaConfig(def, hoy, 0).desde, '10b) y los reportes vuelven a lunes-domingo');

  // ---------- 3) Si la lectura falla, nada se rompe ----------
  sem.limpiarCacheSemana();
  const otro = await sem.rangoSemanaGrupo('grupo-que-no-existe', hoy, 0);
  check(otro.desde === sem.rangoSemanaConfig(def, hoy, 0).desde, '11) un grupo sin configuración (o sin columna aún) usa la semana de siempre');

  // ---------- 4) Pantalla ----------
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-mockup.html'), 'utf8');
  const iBoton = html.indexOf('id="btnGuardarSemana"');
  check(iBoton > 0 && !/id="btnGuardarSemana"[^>]*disabled/.test(html) && /onclick="guardarFechaSemana\(\)"/.test(html), '12a) el botón "Guardar configuración" está activo y llama a guardarFechaSemana()');
  check(/fechaSemana:\s*\(\)\s*=>\s*cargarFechaSemana\(\)/.test(html) && /\/api\/hipismo\/semana-config/.test(html), '12b) al entrar a la pantalla lee la configuración guardada del servidor');


  // ---------- 5) Rango personalizado con calendario ----------
  sem.limpiarCacheSemana();
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { desde: '2026-10-12', hasta: '2026-10-05' } });
  check(x.status === 400 && GRUPO.desde === null, '13a) "Hasta" anterior a "Desde" da 400 y no guarda');
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { desde: '2026-10-05', hasta: '2026-12-31' } });
  check(x.status === 400, '13b) más de 31 días da 400');
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { desde: '2026-02-31', hasta: '2026-03-02' } });
  check(x.status === 400, '13c) una fecha que no existe (31 de febrero) da 400');
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { desde: '2026-10-05' } });
  check(x.status === 400, '13d) falta el "Hasta" -> 400');
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { desde: '2026-10-07', hasta: '2026-10-20' } });
  check(x.status === 200 && GRUPO.desde === '2026-10-07' && GRUPO.hasta === '2026-10-20' && GRUPO.inicio === 3 && GRUPO.cierre === 2, '13e) rango 07/10 al 20/10 (14 días) se guarda con desde/hasta y los días derivados');
  check(x.salida.personalizada === true && x.salida.desde === '2026-10-07' && x.salida.hasta === '2026-10-20', '13f) la respuesta marca personalizada y trae desde/hasta');
  const per = { inicio: 3, cierre: 2, desde: '2026-10-07', hasta: '2026-10-20' };
  const R = (iso, off) => JSON.stringify(sem.rangoSemanaConfig(per, fecha(iso), off));
  check(R('2026-10-15', 0) === '{"desde":"2026-10-07","hasta":"2026-10-20"}', '13g) cualquier día dentro del rango cae en esa semana de 14 días');
  check(R('2026-10-21', 0) === '{"desde":"2026-10-21","hasta":"2026-10-27"}', '13h) la semana siguiente arranca el día después de "Hasta" y dura 7 días');
  check(R('2026-10-06', 0) === '{"desde":"2026-09-30","hasta":"2026-10-06"}', '13i) la semana anterior es de 7 días y termina el día antes de "Desde"');
  check(R('2026-10-10', -1) === '{"desde":"2026-09-30","hasta":"2026-10-06"}' && R('2026-10-10', 1) === '{"desde":"2026-10-21","hasta":"2026-10-27"}', '13j) offsets -1 / +1 desde el rango personalizado');
  // Mismo Lunes->Domingo pero con un rango de 14 días NO es "la de siempre"
  check(sem.esConfigPorDefecto({ inicio: 1, cierre: 0, desde: '2026-10-05', hasta: '2026-10-18' }) === false, '13k) Lunes->Domingo con rango de 14 días NO se confunde con la semana por defecto');
  // Un solo día
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { desde: '2026-10-05', hasta: '2026-10-05' } });
  check(x.status === 200 && JSON.stringify(sem.rangoSemanaConfig({ inicio: 1, cierre: 1, desde: '2026-10-05', hasta: '2026-10-05' }, fecha('2026-10-05'), 0)) === '{"desde":"2026-10-05","hasta":"2026-10-05"}', '13l) un rango de un solo día es válido');
  // Volver a la semana de siempre desde un rango personalizado
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { inicio: 'Lunes', cierre: 'Domingo' } });
  check(GRUPO.hasta === null && GRUPO.desde === null && x.salida.esDefecto === true && x.salida.personalizada === false, '13m) guardar Lunes -> Domingo borra también el rango personalizado');
  // Guardar por días después de un rango personalizado recalcula la ancla
  await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { desde: '2026-09-02', hasta: '2026-09-20' } });
  x = await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { inicio: 'Miércoles', cierre: 'Miércoles' } });
  check(GRUPO.hasta === null && GRUPO.inicio === 3 && GRUPO.cierre === 3 && new Date(GRUPO.desde + 'T00:00:00Z').getUTCDay() === 3, '13n) pasar de rango personalizado a días de la semana borra "hasta" y recalcula la ancla');
  await invocarRuta(handlerDe('put', '/semana-config'), { ...base, body: { inicio: 'Lunes', cierre: 'Domingo' } });

  // ---------- 6) Calendario en pantalla ----------
  check(/id="calSemMeses"/.test(html) && /onclick="guardarRangoSemana\(\)"/.test(html) && /id="btnGuardarRangoSemana"/.test(html), '14a) la pantalla tiene el calendario y el botón "Guardar rango elegido"');
  check(/function calSemElegir/.test(html) && /function guardarRangoSemana/.test(html) && /body: JSON\.stringify\(\{ desde, hasta \}\)/.test(html), '14b) el calendario elige Desde/Hasta y los manda al servidor');
  check(/if \(cfg\.hasta\)/.test(html), '14c) el cálculo de la semana de la pantalla también respeta el "Hasta" personalizado');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  process.exit(fallaron ? 1 : 0);
})();
