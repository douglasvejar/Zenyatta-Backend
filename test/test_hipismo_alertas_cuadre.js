// =================================================================
// PRUEBA (07-10-2026): alerta "apuesta más de lo que le queda", revisión
// de cuadre nocturna y registro de errores del servidor.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'g-alertas-1';
let pozos = {};        // nombre -> pozoDisponible
let jugadoresDB = [];  // filas de jugadores
let escrituras = [];   // INSERT/UPDATE/DELETE registrados
let falloDB = false;
let cuadreHechos = [];
let gruposHipismo = [];
let cierre = { clientes: [], comisionSemana: 0 };
let diagnostico = { totalClientesRevisados: 3, discrepancias: [] };
let diagnosticoLanza = false;
let semanasPedidas = [];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (falloDB) throw new Error('base caída');
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    return { rows: jugadoresDB.filter(j => params[1].includes(j.nombre) && j.tipo_cuenta === 'avalado' && !j.es_cuenta_comision) };
  }
  if (/^SELECT nombre FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    return { rows: (params[1] || []).map(nombre => ({ nombre })) };
  }
  if (/^SELECT \* FROM grupos WHERE modulo_hipismo_habilitado/i.test(sql)) return { rows: gruposHipismo };
  if (/^SELECT id FROM grupos WHERE modulo_hipismo_habilitado/i.test(sql)) return { rows: gruposHipismo.map(g => ({ id: g.id })) };
  if (/^SELECT \* FROM grupos WHERE id = \$1/i.test(sql)) return { rows: gruposHipismo.filter(g => g.id === params[0]) };
  if (/^SELECT grupo_id FROM hipismo_cuadre_nocturno/i.test(sql)) return { rows: cuadreHechos.map(g => ({ grupo_id: g })) };
  if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) { escrituras.push({ sql, params }); return { rows: [{ id: 'x1' }] }; }
  return { rows: [] };
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
  if (request === './pozo') return { calcularPozoJugador: async (g, j) => ({ pozoDisponible: pozos[j.nombre] }) };
  if (request === './hipismoSemana') return { rangoSemanaGrupo: async (g, hoy, off) => (semanasPedidas.push(off), off === 0) ? { desde: '2026-10-05', hasta: '2026-10-11' } : { desde: '2026-09-28', hasta: '2026-10-04' } };
  if (request === './hipismoResumenCliente') return {
    construirCierreFinalHipismo: async () => cierre,
    diagnosticarSaldosHipismo: async () => { if (diagnosticoLanza) throw new Error('boom'); return diagnostico; }
  };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake';
const alertaPozo = require(path.join(__dirname, '..', 'src', 'services', 'hipismoAlertaPozo'));
const cuadre = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCuadreNocturno'));
const errores = require(path.join(__dirname, '..', 'src', 'services', 'erroresServidor'));
const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
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
let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }
const jug = (nombre, extra) => ({ id: 'j-' + nombre, grupo_id: GRUPO_ID, nombre, tipo_cuenta: 'avalado', es_cuenta_comision: false, ...extra });

(async function main() {
  // ---------- 1) detectarApuestasSobrePozo ----------
  jugadoresDB = [jug('ANA'), jug('LUIS'), jug('LIBRE1', { tipo_cuenta: 'libre' }), jug('ANA - PORCENTAJE', { es_cuenta_comision: true })];
  pozos = { ANA: 100, LUIS: 500, 'ANA - PORCENTAJE': 0 };
  let r = await alertaPozo.detectarApuestasSobrePozo(GRUPO_ID, [{ nombre: 'ANA', monto: 60 }, { nombre: 'ANA', monto: 70 }, { nombre: 'LUIS', monto: 300 }, { nombre: 'LIBRE1', monto: 9999 }]);
  check(r.length === 1 && r[0].nombre === 'ANA' && r[0].apostado === 130 && r[0].pozoDisponible === 100 && r[0].faltante === 30, '1a) ANA apostó 60+70=130 con pozo 100 -> alerta, se pasa por 30; LUIS (300 de 500) y el cliente libre no');
  r = await alertaPozo.detectarApuestasSobrePozo(GRUPO_ID, [{ nombre: 'ANA', monto: 100 }]);
  check(r.length === 0, '1b) apostar EXACTAMENTE lo que le queda no alerta');
  pozos.ANA = -50;
  r = await alertaPozo.detectarApuestasSobrePozo(GRUPO_ID, [{ nombre: 'ANA', monto: 10 }]);
  check(r.length === 1 && r[0].pozoDisponible === -50 && r[0].faltante === 10, '1c) pozo negativo: cualquier apuesta alerta y se pasa por el monto apostado');
  r = await alertaPozo.detectarApuestasSobrePozo(GRUPO_ID, [{ nombre: 'ANA', monto: 0 }, { nombre: '', monto: 5 }, { nombre: 'ANA', monto: 'x' }]);
  check(r.length === 0, '1d) montos 0/vacíos/no numéricos se ignoran');
  r = await alertaPozo.detectarApuestasSobrePozo(GRUPO_ID, []);
  check(r.length === 0, '1e) sin apuestas no consulta nada');
  const msg = alertaPozo.mensajeApuestaSobrePozo({ nombre: 'ANA', apostado: 130, pozoDisponible: 100, faltante: 30 }, 'Belmont carrera 3');
  check(/ANA apostó/.test(msg) && /Belmont carrera 3/.test(msg) && /se pasa por/.test(msg), `1f) mensaje legible: "${msg}"`);

  // ---------- 2) ruta POST /tercios-adelantadas deja la alerta ----------
  pozos = { ANA: 5, LUIS: 500 };
  escrituras = [];
  const base = { grupoId: GRUPO_ID, grupo: { id: GRUPO_ID, nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: {}, query: {} };
  const texto = '*JUGADAS ADELANTADAS LA RINCONADA*\n\n*1RA CARRERA*\n\n*ANA 2x7 50 DA LUIS*';
  const rr = await invocarRuta(handlerDe('post', '/tercios-adelantadas'), { ...base, body: { texto, hipodromoNombre: 'La Rinconada', fecha: '2026-10-07' } });
  const hayLineas = rr.status === 201;
  check(hayLineas, `2a) /tercios-adelantadas guarda el plano (status ${rr.status} ${JSON.stringify(rr.salida && rr.salida.error || '')})`);
  if (hayLineas) {
    check(Array.isArray(rr.salida.alertasPozo), '2b) la respuesta trae alertasPozo');
    const alertas = escrituras.filter(e => /INSERT INTO hipismo_alertas/i.test(e.sql));
    check(rr.salida.alertasPozo.length === 1 && alertas.length === 1 && alertas[0].params[1] === 'APUESTA_SOBRE_POZO', `2c) deja 1 alerta APUESTA_SOBRE_POZO en Administración > Alertas (alertas: ${alertas.length})`);
    check(alertas[0] && /ANA apostó/.test(alertas[0].params[6]), '2d) el mensaje nombra al cliente');
  }
  // si la revisión de pozo falla, el plano se guarda igual
  escrituras = [];
  const viejoQuery = jugadoresDB;
  jugadoresDB = null; // hará reventar la revisión de pozo
  const rr2 = await invocarRuta(handlerDe('post', '/tercios-adelantadas'), { ...base, body: { texto, hipodromoNombre: 'La Rinconada', fecha: '2026-10-07' } });
  jugadoresDB = viejoQuery;
  check(rr2.status === 201 && rr2.salida.alertasPozo.length === 0, '2e) si falla la revisión del pozo, el plano igual se guarda (sin alertas)');

  // ---------- 3) suma del balance ----------
  cierre = { clientes: [{ nombre: 'A', saldo: 100 }, { nombre: 'B', saldo: -60 }, { nombre: 'WINNERS', saldo: -45 }], comisionSemana: 5 };
  let s = await cuadre.revisarSumaBalance(GRUPO_ID, '2026-10-05', '2026-10-11');
  check(s.cuadra && s.diferencia === 0, '3a) 100 - 60 - 45 + comisión 5 = 0 -> cuadra');
  cierre.comisionSemana = 5.01;
  s = await cuadre.revisarSumaBalance(GRUPO_ID, '2026-10-05', '2026-10-11');
  check(s.cuadra, '3b) 1 centavo de ruido está dentro de la tolerancia');
  cierre.comisionSemana = 12;
  s = await cuadre.revisarSumaBalance(GRUPO_ID, '2026-10-05', '2026-10-11');
  check(!s.cuadra && s.diferencia === 7, '3c) si sobran 7 el balance NO cuadra');

  // ---------- 4) ejecutarCuadreGrupo ----------
  const grupo = { id: GRUPO_ID, nombre: 'Zenyatta' };
  const hoyVe = new Date('2026-10-07T08:00:00Z'); // 04:00 a. m. VE (Date ya "corrida")
  cierre = { clientes: [{ nombre: 'A', saldo: 10 }, { nombre: 'B', saldo: -10 }], comisionSemana: 0 };
  diagnostico = { totalClientesRevisados: 2, discrepancias: [] };
  escrituras = [];
  let e = await cuadre.ejecutarCuadreGrupo(grupo, { hoy: hoyVe });
  check(e.estado === 'ok' && e.fecha === '2026-10-07', '4a) todo cuadra -> estado ok');
  check(!escrituras.some(x => /hipismo_alertas/.test(x.sql)), '4b) sin diferencias NO se crea ninguna alerta');
  const bit = escrituras.find(x => /hipismo_cuadre_nocturno/.test(x.sql));
  check(bit && bit.params[2] === 'ok' && /ON CONFLICT \(grupo_id, fecha\) DO UPDATE/.test(bit.sql), '4c) se guarda la bitácora del día (upsert por grupo+fecha)');

  diagnostico = { totalClientesRevisados: 2, discrepancias: [{ nombre: 'A', totalGrid: 10, totalLink: 10.5, diferencia: 0.5 }] };
  cierre = { clientes: [{ nombre: 'A', saldo: 10 }], comisionSemana: 0 };
  escrituras = [];
  e = await cuadre.ejecutarCuadreGrupo(grupo, { hoy: hoyVe });
  const al = escrituras.find(x => /INSERT INTO hipismo_alertas/.test(x.sql));
  check(e.estado === 'descuadre' && al && /CUADRE_DESCUADRADO/.test(al.sql) && al.params[1] === 'SISTEMA', '4d) con diferencias -> estado descuadre + alerta CUADRE_DESCUADRADO del usuario SISTEMA');
  check(al && /A \(grilla 10,00 vs link 10,50\)/.test(al.params[3]) && /no suma 0/.test(al.params[3]), `4e) el mensaje nombra al cliente y la suma del balance (${al && al.params[3]})`);
  check(semanasPedidas.length > 0 && semanasPedidas.every(o => o === 0), `4e2) la revisión nocturna mira SOLO la semana actual (semanas pedidas: ${JSON.stringify(semanasPedidas)})`);
  check(e.detalle.semanas.length === 1 && e.detalle.sumaBalance.length === 1 && /1 cliente\(s\)/.test(al.params[3]), '4e3) el detalle guardado trae una sola semana y el aviso cuenta 1 cliente (sin duplicados de la semana anterior)');

  diagnosticoLanza = true;
  escrituras = [];
  e = await cuadre.ejecutarCuadreGrupo(grupo, { hoy: hoyVe });
  check(e.estado === 'error' && !escrituras.some(x => /hipismo_alertas/.test(x.sql)) && escrituras.some(x => /hipismo_cuadre_nocturno/.test(x.sql)), '4f) si la revisión misma falla, queda estado error en la bitácora y no se inventa una alerta');
  diagnosticoLanza = false;

  // ---------- 5) pasada nocturna ----------
  gruposHipismo = [{ id: 'g1', nombre: 'A' }, { id: 'g2', nombre: 'B' }];
  diagnostico = { totalClientesRevisados: 1, discrepancias: [] };
  cierre = { clientes: [], comisionSemana: 0 };
  cuadreHechos = [];
  escrituras = [];
  let p = await cuadre.pasadaNocturna({ hoy: new Date('2026-10-07T02:30:00Z') }); // 2:30 a. m.
  check(p.corridos === 0 && escrituras.length === 0, '5a) antes de las 3:00 a. m. no corre nada');
  p = await cuadre.pasadaNocturna({ hoy: hoyVe });
  check(p.corridos === 2, '5b) después de las 3:00 corre los 2 grupos con Hipismo');
  cuadreHechos = ['g1'];
  escrituras = [];
  p = await cuadre.pasadaNocturna({ hoy: hoyVe });
  check(p.corridos === 1 && escrituras.filter(x => /INSERT INTO hipismo_cuadre_nocturno/.test(x.sql))[0].params[0] === 'g2', '5c) el grupo que ya tiene revisión de hoy se salta (no se repite)');
  check(escrituras.some(x => /DELETE FROM errores_servidor/.test(x.sql)), '5d) la pasada limpia los errores de más de 30 días');

  // ---------- 6) registro de errores ----------
  escrituras = [];
  const err = new Error('Algo se rompió'); err.stack = 'Error: Algo se rompió\n  at a\n  at b';
  await errores.registrarError({ grupoId: GRUPO_ID, nombreActor: 'Zenyatta', method: 'POST', originalUrl: '/api/hipismo/planos?x=1' }, err, 500);
  const ins = escrituras.find(x => /INSERT INTO errores_servidor/.test(x.sql));
  check(ins && ins.params[0] === GRUPO_ID && ins.params[2] === 'POST' && ins.params[3] === '/api/hipismo/planos' && ins.params[5] === 'Algo se rompió', '6a) guarda grupo, usuario, método, ruta (sin query string) y mensaje');
  falloDB = true;
  let lanzo = false;
  try { await errores.registrarError({}, new Error('x'), 500); } catch (e2) { lanzo = true; }
  falloDB = false;
  check(!lanzo, '6b) si la base está caída, registrar el error NO lanza (solo queda en consola)');
  await errores.registrarError(undefined, 'texto suelto', undefined);
  check(escrituras.some(x => /INSERT INTO errores_servidor/.test(x.sql) && x.params[5] === 'texto suelto' && x.params[4] === 500), '6c) tolera req ausente y errores que no son Error');

  // rutas
  let rl = await invocarRuta(handlerDe('get', '/cuadre-nocturno'), base);
  check(rl.status === 200 && Array.isArray(rl.salida), '7a) GET /cuadre-nocturno responde la bitácora');
  rl = await invocarRuta(handlerDe('get', '/errores'), base);
  check(rl.status === 200 && Array.isArray(rl.salida), '7b) GET /errores responde la lista del grupo');
  cierre = { clientes: [], comisionSemana: 0 };
  escrituras = [];
  rl = await invocarRuta(handlerDe('post', '/cuadre-nocturno/ejecutar'), base);
  check(rl.status === 200 && rl.salida.estado === 'ok', '7c) POST /cuadre-nocturno/ejecutar corre la revisión a mano');

  console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
  process.exit(fallaron ? 1 : 0);
})();
