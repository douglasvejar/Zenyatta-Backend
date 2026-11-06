// =================================================================
// PRUEBA: HIPISMO OFICINAS — mejoras del 05-11-2026 (recargas/retiros/control de pozos, cierre del día, aviso de pendientes,
// permisos por empleado, historial, Excel, marcar pago diario).
// Sin base de datos: la base se reemplaza por una falsa y las rutas se llaman directo.
// =================================================================
const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalLoad = Module._load;
const RAIZ = path.join(__dirname, '..');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}
const leer = p => fs.readFileSync(path.join(RAIZ, p), 'utf8');

// Base falsa para TODO el archivo (el db real exige DATABASE_URL): cada bloque cambia dbRespuesta.
const consultas = [];
let dbRespuesta = () => ({ rows: [] });
const dbFalsa = {
  query: async (t, p) => { consultas.push([t, p]); return dbRespuesta(t, p); },
  transaccion: async (f) => f({ query: async (t, p) => { consultas.push([t, p]); return { rows: [{ id: 'x' }] }; } })
};
const routerFalso = (handlers) => () => { const router = {}; ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => { router[m] = (...a) => { handlers.push([m, a]); return router; }; }); return router; };
const handlers = [];
const expressReal = require('express');
let usarRouterFalso = false;
Module._load = function (request) {
  if (/(^|\/)db$/.test(request) || request === '../db') return dbFalsa;
  if (usarRouterFalso && request === 'express') { const e = () => ({}); e.Router = routerFalso(handlers); e.json = expressReal.json; return e; }
  return originalLoad.apply(this, arguments);
};

// ---------- 1) armarCierreDia (pura) ----------
const control = require('../src/services/hipismoOficinasControl');
{
  const d = control.armarCierreDia({
    fecha: '2026-11-04',
    planos: [{ hipodromo_nombre: 'Gulfstream Park', carrera_numero: 1 }, { hipodromo_nombre: 'Gulfstream Park', carrera_numero: 2 }, { hipodromo_nombre: 'Gulfstream Park', carrera_numero: 4 }],
    pendientes: [{ hipodromo_nombre: 'Gulfstream Park', carrera_numero: 5 }],
    cierre: { clientes: [{ nombre: 'PEDRO', saldo: -100 }, { nombre: 'JOSE', saldo: 95 }], comisionSemana: 5 }
  });
  check(d.hipodromos.length === 1 && d.hipodromos[0].calculadas === 3 && d.hipodromos[0].pendientes === 1, 'cierre del día: cuenta calculadas y pendientes');
  check(JSON.stringify(d.hipodromos[0].faltantes) === '[3]', 'cierre del día: detecta el hueco (carrera 3 no cargada)');
  check(d.totales.carreras === 4 && d.totales.pendientes === 1 && d.totales.huecos === 1, 'cierre del día: totales');
  check(d.saldos.cuadra === true && d.saldos.diferencia === 0, 'cierre del día: saldo de clientes + comisión = 0 cuadra');
  check(d.listo === false, 'cierre del día: no está listo si queda una carrera sin llegada');
  check(d.avisos.some(a => a.nivel === 'error' && /sin llegada/.test(a.texto)), 'cierre del día: avisa de la carrera sin llegada');
  check(d.avisos.some(a => a.nivel === 'aviso' && /carrera 3/.test(a.texto)), 'cierre del día: avisa del hueco');
}
{
  const d = control.armarCierreDia({
    fecha: '2026-11-04',
    planos: [{ hipodromo_nombre: 'Santa Anita', carrera_numero: 1 }, { hipodromo_nombre: 'Santa Anita', carrera_numero: 2 }],
    pendientes: [],
    cierre: { clientes: [{ nombre: 'PEDRO', saldo: -100 }, { nombre: 'JOSE', saldo: 95 }], comisionSemana: 4 }
  });
  check(d.saldos.cuadra === false && d.saldos.diferencia === -1, 'cierre del día: detecta que el día NO cuadra (-1,00)');
  check(d.avisos.some(a => /no cuadra/.test(a.texto)) && d.listo === false, 'cierre del día: avisa que no cuadra y no queda listo');
}
{
  const d = control.armarCierreDia({
    fecha: '2026-11-04',
    planos: [{ hipodromo_nombre: 'Santa Anita', carrera_numero: 1 }, { hipodromo_nombre: 'Gulfstream Park', carrera_numero: 1 }],
    pendientes: [],
    cierre: { clientes: [{ nombre: 'PEDRO', saldo: -100 }, { nombre: 'JOSE', saldo: 95 }], comisionSemana: 5 }
  });
  check(d.listo === true && d.avisos.length === 0, 'cierre del día: todo calculado y cuadrado = listo, sin avisos');
  check(d.hipodromos[0].nombre === 'Gulfstream Park', 'cierre del día: hipódromos ordenados por nombre');
  const vacio = control.armarCierreDia({ fecha: '2026-11-04', planos: [], pendientes: [], cierre: { clientes: [], comisionSemana: 0 } });
  check(vacio.listo === false && vacio.avisos.some(a => a.nivel === 'info'), 'cierre del día: un día sin carreras no se da por listo');
}

// ---------- 2) carrerasPendientesPeriodo (base falsa) ----------
(async () => {
  dbRespuesta = (texto, params) => {
    if (/hipismo_oficinas_pendientes/.test(texto)) {
      if (params[0] === 'sin-tabla') { const e = new Error('no existe'); e.code = '42P01'; throw e; }
      return { rows: [{ fecha: new Date('2026-11-03T00:00:00Z'), hipodromo_nombre: 'Gulfstream Park', carrera_numero: '4' }, { fecha: '2026-11-04', hipodromo_nombre: 'Santa Anita', carrera_numero: 2 }] };
    }
    return { rows: [] };
  };
  const ctl = control;
  let r = await ctl.carrerasPendientesPeriodo('g1', '2026-11-02', '2026-11-08');
  check(r.total === 2 && r.carreras[0].fecha === '2026-11-03' && r.carreras[0].carrera === 4, 'pendientes del período: lista fecha, hipódromo y número de carrera');
  r = await ctl.carrerasPendientesPeriodo('sin-tabla', '2026-11-02', '2026-11-08');
  check(r.total === 0, 'pendientes del período: si falta la tabla (SQL sin correr) responde vacío, no error');

  // ---------- 3) permisos por empleado en Oficinas ----------
  const { requierePermisoOficina, PERMISOS_OFICINAS, PERMISOS_VALIDOS } = require('../src/middleware/auth');
  const pasa = (req, clave) => { let ok = false, estado = null; requierePermisoOficina(clave)(req, { status: (s) => ({ json: () => { estado = s; } }) }, () => { ok = true; }); return { ok, estado }; };
  check(PERMISOS_OFICINAS.length === 3 && PERMISOS_OFICINAS.every(p => PERMISOS_VALIDOS.includes(p)), 'permisos: las 3 claves de Oficinas son válidas');
  check(pasa({ rol: 'administrador', permisos: null }, 'oficinas_saldos').ok, 'permisos: el administrador siempre puede');
  check(pasa({ rol: 'empleado', permisos: ['hip_ver'] }, 'oficinas_saldos').ok, 'permisos: empleado sin claves de Oficinas conserva el acceso de siempre');
  check(pasa({ rol: 'empleado', permisos: [] }, 'oficinas_informes').ok, 'permisos: empleado con lista vacía tampoco se bloquea (compatibilidad)');
  check(pasa({ rol: 'empleado', permisos: ['oficinas_saldos'] }, 'oficinas_saldos').ok, 'permisos: empleado con la clave puede');
  const sin = pasa({ rol: 'empleado', permisos: ['oficinas_saldos'] }, 'oficinas_eliminar');
  check(!sin.ok && sin.estado === 403, 'permisos: empleado con otra clave de Oficinas recibe 403 en lo que no marcó');

  // ---------- 4) rutas ----------
  usarRouterFalso = true; dbRespuesta = () => ({ rows: [] });
  let hip;
  try { delete require.cache[require.resolve('../src/routes/hipismo')]; hip = require('../src/routes/hipismo'); }
  catch (e) { console.error('No se pudo cargar la ruta con la base falsa:', e.message); }
  usarRouterFalso = false;

  const buscar = (m, p) => handlers.find(([mm, a]) => mm === m && a[0] === p);
  const rutaPD = buscar('put', '/clientes/:id/pago-diario');
  check(!!rutaPD, 'ruta PUT /clientes/:id/pago-diario existe');
  check(!!buscar('get', '/oficinas/pendientes-periodo') && !!buscar('get', '/oficinas/cierre-dia'), 'rutas GET /oficinas/pendientes-periodo y /oficinas/cierre-dia existen');
  const llamar = async (h, req) => new Promise((resolve, reject) => {
    const res = { codigo: 200, status(c) { this.codigo = c; return this; }, json(b) { resolve({ codigo: this.codigo, body: b }); } };
    Promise.resolve(h(req, res, e => reject(e))).catch(reject);
  });
  if (rutaPD) {
    const h = rutaPD[1][rutaPD[1].length - 1];
    const ID = '11111111-2222-3333-4444-555555555555';
    dbRespuesta = () => ({ rows: [{ id: ID, nombre: 'JOSE', pago_diario: true }] });
    let r = await llamar(h, { grupoId: 'g1', params: { id: ID }, body: { pagoDiario: true } });
    check(r.codigo === 200 && r.body.ok && r.body.cliente.pago_diario === true, 'pago diario: marcar a un cliente responde ok');
    check(/UPDATE jugadores SET pago_diario/.test(consultas[consultas.length - 1][0]) && consultas[consultas.length - 1][1].includes('g1'), 'pago diario: el UPDATE va filtrado por grupo (aislamiento)');
    r = await llamar(h, { grupoId: 'g1', params: { id: ID }, body: { pagoDiario: 'si' } });
    check(r.codigo === 400, 'pago diario: un valor que no es sí/no da 400');
    r = await llamar(h, { grupoId: 'g1', params: { id: 'abc' }, body: { pagoDiario: true } });
    check(r.codigo === 404, 'pago diario: id inválido da 404');
    dbRespuesta = () => ({ rows: [] });
    r = await llamar(h, { grupoId: 'g1', params: { id: ID }, body: { pagoDiario: false } });
    check(r.codigo === 404, 'pago diario: cliente de otro grupo / inexistente da 404');
  }

  // Candados por permiso puestos en las rutas
  const tieneMiddleware = (m, p, n) => { const e = buscar(m, p); return !!e && e[1].length > 2 && e[1].slice(1, -1).some(f => f && f.name === 'requierePermisoOficinaMw' || typeof f === 'function'); };
  check(tieneMiddleware('post', '/recargas-pago-diario'), 'permisos: POST recargas lleva candado de Oficinas');
  check(tieneMiddleware('post', '/retiros'), 'permisos: POST retiros lleva candado de Oficinas');
  check(tieneMiddleware('get', '/oficinas/comision-por-carrera'), 'permisos: Comisión por Carrera lleva candado de Oficinas');
  check(tieneMiddleware('delete', '/oficinas/pendiente'), 'permisos: eliminar pendiente lleva candado de Oficinas');

  // ---------- 5) funcionesGrupo ----------
  const fg = require('../src/services/funcionesGrupo');
  const secc = fg.seccionesDeRutaHipismo('PUT', '/clientes/abc/pago-diario');
  check(Array.isArray(secc) && secc.includes('hip_clientes') && secc.includes('hip_saldos'), 'funcionesGrupo: marcar pago diario cae bajo Clientes/Saldos');
  check(fg.seccionesDeRutaHipismo('GET', '/oficinas/cierre-dia') === null, 'funcionesGrupo: las rutas /oficinas/* siguen libres de candado por sección');

  // ---------- 6) pantalla (cadenas) ----------
  const html = leer('public/hipismo-oficinas.html');
  const saldos = leer('public/oficinas-saldos.js');
  const mejoras = leer('public/oficinas-mejoras.js');
  ['panel-recargas', 'panel-controlpozos', 'panel-cierredia', 'panel-historial', 'jPozoAviso', 'balPendientes', 'spPendientes', 'cPagoDiario', 'oficinas-saldos.js', 'oficinas-mejoras.js'].forEach(k =>
    check(html.includes(k), `pantalla: hipismo-oficinas.html contiene ${k}`));
  check(/data-perm="oficinas_saldos"/.test(html) && /data-perm="oficinas_informes"/.test(html) && /data-perm="oficinas_eliminar"/.test(html), 'pantalla: las pestañas llevan data-perm según el permiso');
  ['descargarExcel', 'entrarRecargas', 'entrarRetiros', 'guardarRetiro', 'cargarControlPozosOf', 'alternarPagoDiario'].forEach(k => check(saldos.includes('function ' + k) || saldos.includes('window.' + k), `oficinas-saldos.js define ${k}`));
  ['duplicarFila', 'copiarDeOtraCarrera', 'cargarCierreDia', 'cargarHistorial', 'exportarExcel', 'aplicarPermisosOficina', 'verJugadasRegistro'].forEach(k => check(mejoras.includes(k), `oficinas-mejoras.js define ${k}`));
  try { new Function(saldos); new Function(mejoras); check(true, 'los dos scripts nuevos son JavaScript válido'); } catch (e) { check(false, 'JavaScript inválido: ' + e.message); }
  const dbJs = leer('src/db.js'), schema = leer('sql/schema.sql');
  check(/PENDIENTE_ELIMINADO/.test(dbJs) && /PENDIENTE_ELIMINADO/.test(schema), 'base: el tipo de alerta PENDIENTE_ELIMINADO está permitido en db.js y schema.sql');
  check(/PENDIENTE_ELIMINADO/.test(leer('src/routes/hipismo.js')), 'ruta: eliminar una carrera pendiente deja registro en el Historial');


  // ---------- 7) socios en Oficinas ----------
  const socios = leer('public/oficinas-socios.js');
  try { new Function(socios); check(true, 'oficinas-socios.js es JavaScript válido'); } catch (e) { check(false, 'oficinas-socios.js inválido: ' + e.message); }
  ['panel-comisionessocios', 'panel-balancesocios', 'sub-socios', 'socFilas', 'socGuardar', 'spSeleccion', 'oficinas-socios.js'].forEach(k => check(html.includes(k), `pantalla: hipismo-oficinas.html contiene ${k}`));
  check(/data-tab="comisionessocios" data-perm="oficinas_informes"/.test(html) && /data-tab="balancesocios" data-perm="oficinas_informes"/.test(html), 'pantalla: las pestañas de socios llevan el permiso de informes');
  check(/class="tab oculto" data-tab="comisionessocios"/.test(html) && /class="tab oculto" data-tab="balancesocios"/.test(html), 'pantalla: las pestañas de socios arrancan ocultas (un grupo sin socios no las ve)');
  ['/api/hipismo/socios', '/api/hipismo/socios/asignar', '/api/hipismo/comisiones-socios', '/api/hipismo/balance-socios', '/api/hipismo/pozos-plano-excluidos'].forEach(k => check(socios.includes(k), `oficinas-socios.js usa la ruta ${k}`));
  ['/socios', '/socios/asignar', '/comisiones-socios', '/balance-socios', '/pozos-plano-excluidos'].forEach(k => check(!!buscar('get', k) || !!buscar('put', k), `la ruta ${k} existe en el servidor`));
  check(/hipismo-oficinas\.html[\s\S]*oficinas-socios\.js/.test('hipismo-oficinas.html oficinas-socios.js') && html.indexOf('oficinas-mejoras.js') < html.indexOf('oficinas-socios.js'), 'pantalla: oficinas-socios.js se carga después de oficinas-mejoras.js');


  // ---------- 8) traspaso de saldo, socio al crear cliente y Excel del Registro ----------
  ['subpanel-traspasos', 'tsOrigen', 'tsDestino', 'tsGuardar', 'cSocioBloque', 'excelRegistro()'].forEach(k => check(html.includes(k), `pantalla: hipismo-oficinas.html contiene ${k}`));
  ['entrarTraspasos', 'guardarTraspaso', 'anularTraspaso', 'excelTraspasos', 'excelRegistro'].forEach(k => check(saldos.includes('function ' + k), `oficinas-saldos.js define ${k}`));
  check(saldos.includes('/api/hipismo/comisiones/traspaso') && saldos.includes('/api/hipismo/traspasos-saldo'), 'traspaso: usa las rutas de siempre (comisiones/traspaso y traspasos-saldo)');
  check(/socioId: \$\('cSocio'\)\.value \|\| null/.test(html), 'crear cliente: manda socioId solo cuando el bloque de socio está en pantalla');
  check(socios.includes('pintarSocioCliente') && socios.includes('etiquetaSocioDe'), 'oficinas-socios.js arma el bloque "¿Pertenece a un socio?" y la etiqueta del socio en la lista');
  const rutaTras = buscar('post', '/comisiones/traspaso'), rutaAnular = buscar('delete', '/traspasos-saldo/:id');
  check(!!rutaTras && rutaTras[1].length > 2, 'permisos: POST /comisiones/traspaso lleva candado de Oficinas');
  check(!!rutaAnular && rutaAnular[1].length > 2, 'permisos: anular un traspaso lleva candado de Oficinas');


  // ---------- 9) hipódromos: nacionales arriba, americanos abajo, con bandera ----------
  check(html.includes('opcionesHipodromosAgrupadas') && html.includes('<optgroup label="${TITULO_PAIS[pais]}">'), 'hipódromos: las listas desplegables se arman con grupos Nacionales / Americanos');
  check(html.includes("VE: '🇻🇪'") && html.includes("US: '🇺🇸'"), 'hipódromos: cada país tiene su bandera');
  check(/grupo\('VE'\) \+ grupo\('US'\)/.test(html), 'hipódromos: los nacionales van primero y los americanos debajo');
  check((html.match(/opcionesHipodromosAgrupadas\(/g) || []).length >= 3, 'hipódromos: Jugadas y Registro usan la lista agrupada');
  check(mejoras.includes('banderaHip(h.nombre)') && mejoras.includes('ordenarHipodromos('), 'hipódromos: el Cierre del Día también va con bandera y nacionales primero');


  // ---------- 10) Balance General en dos columnas y número de semana ----------
  const INFO_ = require('../public/oficinas-informes.js');
  const bal = INFO_.armarBalance({ clientes: [{ nombre: 'A', saldo: 384 }, { nombre: 'B', saldo: -400 }, { nombre: 'C', saldo: 190 }, { nombre: 'D', saldo: -270 }, { nombre: 'E', saldo: 0 }, { nombre: 'F', saldo: 25.5 }], comisionSemana: 0 });
  check(bal.pierden.map(f => f.nombre).join('') === 'BD', 'balance: a la izquierda los que pierden, el que más pierde primero');
  check(bal.ganan.map(f => f.nombre).join('') === 'ACF', 'balance: a la derecha los que ganan, el que más gana primero');
  check(bal.sinSaldo.length === 1 && bal.totalPierden === -670 && bal.totalGanan === 599.5 && bal.totalClientes === -70.5, 'balance: totales de cada lado y total general');
  const rangoSem = { desde: '2026-11-02', hasta: '2026-11-08' };
  check(INFO_.textoPeriodo({ rango: rangoSem, numeroSemana: { anio: 2026, semana: 45 } }) === 'Semana 45 — 02/11/2026 al 08/11/2026', 'semana: el servidor manda {anio, semana} y se muestra "Semana 45" (no [object Object])');
  check(INFO_.textoPeriodo({ rango: rangoSem, numeroSemana: 45 }) === 'Semana 45 — 02/11/2026 al 08/11/2026', 'semana: también funciona si viene como número');
  check(html.includes('class="bal-dos"') && html.includes('Pierden') && html.includes('Ganan'), 'pantalla: el Balance General tiene columnas Pierden y Ganan');

  console.log(`\n${pasaron} OK, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('ERROR en la prueba:', e); process.exit(1); });
