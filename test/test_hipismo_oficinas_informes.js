// =================================================================
// PRUEBA: HIPISMO OFICINAS — informes (09-10-2026): Balance General, Detallado por Cliente y Comisión por
// Carrera. Pedido del usuario: "recuerda que todos los saldos deben coincidir".
//   1) GET /oficinas/comision-por-carrera: la comisión neta por carrera (5% menos % devuelto) + lo que no
//      está ligado a una carrera (Tabla Fija) = la comisión del Balance General (/cierre-final).
//   2) Las funciones de public/oficinas-informes.js: formato de dinero, Balance (total + comisión = 0),
//      Detallado por Cliente (carrera > hipódromo > día > período) y que la pantalla tenga sus botones.
// La cuenta completa (con una base PostgreSQL real y varios clientes) se verificó aparte; esta prueba deja
// fijo lo esencial sin necesitar base de datos.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-comision-real-1';
const FECHA = '2026-09-29'; // martes

const JUGADOR_PEDRO = { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 2, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_BANCO = { id: 'j-banco', grupo_id: GRUPO_ID, nombre: 'BANCO', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_ANA = { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };
const JUGADOR_LUIS = { id: 'j-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 0, incluir_porcentaje_en_jugadas: false, cuenta_comision_id: null };

const TABLAS = {
  jugadores: [{ ...JUGADOR_PEDRO }, { ...JUGADOR_BANCO }, { ...JUGADOR_ANA }, { ...JUGADOR_LUIS }],
  jugadores_avales_porcentaje: [],
  // Tercios: PEDRO le gana 100 a BANCO -- comisión de ESE plano: 5,00
  // (5%% de 100). El % propio de PEDRO (2%%) se gana sobre el monto
  // completo (100), sin importar cuánto ganó -- 2,00.
  hipismo_planos: [{ id: 'p1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA, cruza_jugadas: false, comision_total: 5.00 }],
  hipismo_tickets: [
    { id: 't1', plano_id: 'p1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'BANCO', modalidad: '1P', caballo: '5', monto: 100, resultado_jugador: 95, resultado_banquero: -100, sin_comision: false }
  ],
  // Remate: LUIS pierde 50 en un remate cuya comisión total (la que se
  // queda "la casa" de ESE remate puntual) es 12,50 -- a propósito un
  // número que NO calza con -(-50) para dejar claro que esta prueba no
  // depende de que Remate sea "zero-sum" con sus apuestas: solo importa
  // que comisionRemateSemana (12,50) NUNCA se sume a comisionSemana.
  hipismo_remates: [{ id: 'r1', grupo_id: GRUPO_ID, hipodromo_nombre: 'Churchill Downs', carrera_numero: 5, fecha: FECHA, comision_total: 12.50 }],
  hipismo_remate_apuestas: [
    { id: 'ra1', grupo_id: GRUPO_ID, remate_id: 'r1', cliente_nombre: 'LUIS', caballo: '(2)', resultado: -50, monto: 50 }
  ],
  hipismo_adelantadas_planos: [{ id: 'ap1', grupo_id: GRUPO_ID, fecha: FECHA }],
  // Tabla Fija: ANA ganó 95 netos, con 5,00 de comisión de Tabla Fija
  // ("% DE TABLAS FIJAS") -- a propósito con un monto GRANDE para que,
  // si por error se sumara esa comisión a "comisionSemana", el número
  // resultante sería obviamente distinto de 3,00.
  hipismo_adelantadas_jugadas: [
    { id: 'ad1', plano_id: 'ap1', grupo_id: GRUPO_ID, tipo: 'tf', estado: 'resuelto', gano: true, cliente_nombre: 'ANA', monto: 100, resultado_cliente: 95, comision: 5, banqueadores: [] }
  ],
  hipismo_winners: [], hipismo_comisiones_ajustes: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias (services/hipismoComisionPropia.js) ----
  if (sql === 'SELECT j.id, j.nombre, j.comision_propia, cc_propio.nombre AS cc_propio_nombre, j.incluir_porcentaje_en_jugadas FROM jugadores j LEFT JOIN jugadores cc_propio ON cc_propio.id = j.cuenta_comision_id WHERE j.grupo_id = $1 AND j.nombre = ANY($2::text[])') {
    const [grupoId, nombres] = params;
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre)).map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia, cc_propio_nombre: null, incluir_porcentaje_en_jugadas: j.incluir_porcentaje_en_jugadas })) };
  }
  if (sql === 'SELECT jap.jugador_id, jap.porcentaje, av.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap JOIN jugadores av ON av.id = jap.avalador_id WHERE jap.grupo_id = $1 AND jap.jugador_id = ANY($2::uuid[])') {
    return { rows: [] };
  }

  // ---- /cierre-final ----
  // (negative lookahead: la variante de /semana-por-dias es igual pero
  // sigue con ", p.fecha" -- sin esto, esta regex más corta la
  // interceptaría primero por ser un prefijo exacto de esa otra query.)
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s*t\.plano_id, t\.sin_comision, p\.cruza_jugadas(?!, p\.fecha)/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId).map(t => {
        const p = TABLAS.hipismo_planos.find(x => x.id === t.plano_id);
        return { cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: p.cruza_jugadas, fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero };
      })
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto\s+FROM hipismo_remate_apuestas/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.hipismo_remate_apuestas.filter(a => a.grupo_id === grupoId).map(a => ({ cliente_nombre: a.cliente_nombre, resultado: a.resultado, monto: a.monto })) };
  }
  if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto(, j\.gano)?/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId).map(j => ({
        cliente_nombre: j.cliente_nombre, tipo: j.tipo, resultado_cliente: j.resultado_cliente,
        comision: j.comision, banqueadores: j.banqueadores, monto: j.monto, gano: j.gano
      }))
    };
  }
  if (/^SELECT cliente_nombre, monto FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s*FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_remates/i.test(sql)) {
    const [grupoId] = params;
    const total = TABLAS.hipismo_remates.filter(r => r.grupo_id === grupoId).reduce((s, r) => s + r.comision_total, 0);
    return { rows: [{ total }] };
  }
  if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s*FROM hipismo_planos/i.test(sql)) {
    const [grupoId] = params;
    const total = TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId).reduce((s, p) => s + p.comision_total, 0);
    return { rows: [{ total }] };
  }

  // ---- /semana-por-dias ----
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto,\s+t\.plano_id, t\.sin_comision, p\.cruza_jugadas, p\.fecha/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_tickets.filter(t => t.grupo_id === grupoId).map(t => {
        const p = TABLAS.hipismo_planos.find(x => x.id === t.plano_id);
        return { cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero, monto: t.monto, plano_id: t.plano_id, sin_comision: t.sin_comision, cruza_jugadas: p.cruza_jugadas, fecha: p.fecha };
      })
    };
  }
  if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto, r\.fecha\s+FROM hipismo_remate_apuestas/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_remate_apuestas.filter(a => a.grupo_id === grupoId).map(a => {
        const r = TABLAS.hipismo_remates.find(x => x.id === a.remate_id);
        return { cliente_nombre: a.cliente_nombre, resultado: a.resultado, monto: a.monto, fecha: r.fecha };
      })
    };
  }
  if (/^SELECT j\.cliente_nombre, j\.resultado_cliente, j\.banqueadores, j\.monto(, j\.gano)?(, j\.sin_comision)?, p\.fecha/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId).map(j => {
        const p = TABLAS.hipismo_adelantadas_planos.find(x => x.id === j.plano_id);
        return { cliente_nombre: j.cliente_nombre, resultado_cliente: j.resultado_cliente, banqueadores: j.banqueadores, monto: j.monto, gano: j.gano, fecha: p.fecha };
      })
    };
  }
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_winners/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, monto, fecha FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
  if (/^SELECT fecha, COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId);
    const porFecha = new Map();
    filas.forEach(p => porFecha.set(p.fecha, (porFecha.get(p.fecha) || 0) + p.comision_total));
    return { rows: Array.from(porFecha.entries()).map(([fecha, total]) => ({ fecha, total })) };
  }
  // 02-10-2026 ("COMISIÓN GRUPO" = TODO, no solo Tercios — ver la nota
  // grande de comisionAdelantadasSemana en GET /cierre-final): nueva
  // consulta de /semana-por-dias para sumar también la comisión de
  // Tablas Fijas/Marcas por día.
  if (/^SELECT p\.fecha AS fecha, j\.comision\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha BETWEEN \$2 AND \$3 AND j\.estado IN/i.test(sql)) {
    const [grupoId] = params;
    return {
      rows: TABLAS.hipismo_adelantadas_jugadas.filter(j => j.grupo_id === grupoId).map(j => {
        const p = TABLAS.hipismo_adelantadas_planos.find(x => x.id === j.plano_id);
        return { fecha: p.fecha, comision: j.comision };
      })
    };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };
  if (/^SELECT j\.jugador_nombre, j\.banquero_nombre/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, hipodromo_nombre, carrera_numero, comision_total FROM hipismo_planos WHERE grupo_id = \$1 AND fecha BETWEEN/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId) };
  }
  throw new Error('La base de datos falsa de esta prueba (oficinas informes) no sabe responder: ' + sql);
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

Module._load = function (request, parent, isMain) {
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
  let salida = null;
  await new Promise((resolve, reject) => {
    const res = { status(c) { this._s = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return salida;
}

(async function main() {
  const OriginalDate = Date;
  const fake = new OriginalDate(FECHA + 'T12:00:00Z').getTime();
  global.Date = class extends OriginalDate { constructor(...a) { if (a.length === 0) super(fake); else super(...a); } static now() { return fake; } };
  const INF = require(path.join(__dirname, '..', 'public', 'oficinas-informes.js'));
  const fs = require('fs');

  // ---- 1) Comisión por carrera == comisión del Balance General ----
  const base = { grupoId: GRUPO_ID, grupo: { nombre: 'Oficina Uno' }, params: {}, query: { desde: FECHA, hasta: FECHA } };
  const cierre = await invocarRuta(handlerDe('get', '/cierre-final'), base);
  const com = await invocarRuta(handlerDe('get', '/oficinas/comision-por-carrera'), base);
  check(!!com && com.grupoNombre === 'Oficina Uno', '1a) responde con el nombre de la oficina');
  check(com.totales.bruta === 5 && com.totales.devuelto === 2 && com.totales.neta === 3, `1b) la carrera: 5,00 de comisión - 2,00 devuelto = 3,00 neta (dio ${JSON.stringify(com.totales)})`);
  check(com.otrosConceptos === 5, `1c) la comisión de la Tabla Fija (5,00) no es de una carrera: sale aparte como "otros conceptos" (dio ${com.otrosConceptos})`);
  check(com.comisionOficina === cierre.comisionSemana && com.comisionOficina === 8, `1d) comisión oficina (${com.comisionOficina}) = comisión del Balance General (${cierre.comisionSemana}) = 8,00`);
  check(com.totales.neta + com.otrosConceptos === com.comisionOficina, '1e) carreras + otros conceptos = comisión oficina');
  check(com.dias.length === 1 && com.dias[0].hipodromos[0].nombre === 'La Rinconada' && com.dias[0].hipodromos[0].carreras[0].carreraNumero === 1, '1f) ordenado por día > hipódromo > carrera');
  check(Array.isArray(cierre.devueltoPorCarrera) && cierre.devueltoPorCarrera.length === 1 && cierre.devueltoPorCarrera[0].monto === 2, '1g) el Balance expone lo devuelto por carrera (2,00)');

  // ---- 2) Funciones de los informes ----
  check(INF.dinero(1234.5) === '1.234,50' && INF.dinero(-0.001) === '0,00' && INF.dineroConSigno(95) === '+95,00' && INF.dineroConSigno(-100) === '-100,00', '2a) dinero con punto de miles, coma y 2 decimales');
  const b = INF.armarBalance({ clientes: [{ nombre: 'PEDRO', saldo: 95 }, { nombre: 'BANCO', saldo: -100 }, { nombre: 'PEDRO - PORCENTAJE', saldo: 2 }], comisionSemana: 3 }, n => /PORCENTAJE/.test(n));
  check(b.totalClientes === -3 && b.comisionOficina === 3 && b.diferencia === 0, '2b) Balance: total de todos los renglones (-3) + comisión (3) = 0');
  check(b.filas.find(f => f.nombre === 'PEDRO - PORCENTAJE').esItem === true && b.filas.find(f => f.nombre === 'PEDRO').esItem === false, '2c) marca los ítems');
  check(INF.armarBalance({ clientes: [{ nombre: 'A', saldo: 10 }], comisionSemana: 3 }).diferencia === 13, '2d) si algo no cuadra, la diferencia se ve');

  const detalle = INF.armarDetalleCliente({
    resumen: { totalSemana: 166 },
    dias: [
      { fecha: '2026-10-06', hipodromos: [{ nombre: 'Gulfstream', carreras: [{ carrera: 1, rol: 'jugador', modalidad: '1p', caballo: '(3)', monto: 100, resultado: 95 }] }] },
      { fecha: '2026-10-05', hipodromos: [
        { nombre: 'Traspasos de Comisión', tipo: 'traspaso', carreras: [{ tipo: 'traspaso', nota: 'ajuste', resultado: 1 }] },
        { nombre: 'La Rinconada', carreras: [{ carrera: 2, rol: 'banquero', modalidad: '2p', caballo: '(5)', monto: 50, resultado: -50 }] },
        { nombre: 'Gulfstream', carreras: [
          { carrera: 2, rol: 'jugador', modalidad: '1p', caballo: '(4)', monto: 60, resultado: 57 },
          { carrera: 1, rol: 'jugador', modalidad: '1p', caballo: '(3)', monto: 100, resultado: 95 },
          { carrera: 1, rol: 'banquero', modalidad: '3n', caballo: '(1)', monto: 40, resultado: -38 },
          { tipo: 'comision', carrera: 1, clienteOrigen: 'ANA', porcentaje: 1, monto: 100, resultado: 1 } ] } ] }
    ]
  });
  check(detalle.dias[0].fecha === '2026-10-05' && detalle.dias[1].fecha === '2026-10-06', '2e) los días salen en orden cronológico');
  const d5 = detalle.dias[0];
  check(d5.hipodromos.map(h => h.nombre).join() === 'Gulfstream,La Rinconada,Traspasos de Comisión', '2f) hipódromos A-Z y los bloques que no son hipódromo al final');
  const gulf = d5.hipodromos[0];
  check(gulf.carreras.map(c => c.numero).join() === '1,2', '2g) carreras en orden');
  check(gulf.carreras[0].total === 58 && gulf.carreras[1].total === 57 && gulf.total === 115, `2h) total por carrera (95-38+1=58 y 57) y del hipódromo (115) (dio ${gulf.carreras[0].total}/${gulf.carreras[1].total}/${gulf.total})`);
  check(d5.total === 115 + (-50) + 1, `2i) total del día = suma de sus hipódromos (66) (dio ${d5.total})`);
  check(detalle.totalPeriodo === 66 + 95 && detalle.totalPeriodo === 161, `2j) total del período = suma de los días (161) (dio ${detalle.totalPeriodo})`);
  check(INF.descripcionLinea({ rol: 'jugador', modalidad: '1p', caballo: '(3)', monto: 100 }) === 'Jugó 1p (3) con 100,00', '2k) "Jugó 1p (3) con 100,00"');
  check(INF.descripcionLinea({ rol: 'banquero', modalidad: 'pp', caballoA: 4, caballoB: 3, monto: 80 }) === 'Dio pp (4x3) con 80,00', '2l) un cruce se lee "Dio pp (4x3) con 80,00"');

  // ---- 3) La pantalla ----
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'hipismo-oficinas.html'), 'utf8');
  ['Balance General', 'Detallado por Cliente', 'Comisión por Carrera', 'COMISIÓN OFICINA', 'Copiar imagen HD', 'Descargar PDF', 'TOTAL DEL DÍA', 'oficinas-informes.js', 'html2canvas', 'jspdf', '/api/hipismo/cierre-final', '/detalle-semana', '/api/hipismo/oficinas/comision-por-carrera'].forEach(t => check(html.includes(t), `3) la pantalla incluye "${t}"`));
  ['balCaptura', 'detCaptura', 'comCaptura'].forEach(id => check(new RegExp(`copiarImagenHD\\('${id}'`).test(html) && new RegExp(`descargarPDF\\('${id}'`).test(html), `3) ${id}: tiene botón de imagen HD y de PDF`));
  check(/while \(y < canvas\.height\)/.test(html) && /pdf\.addPage\(\)/.test(html), '3) el PDF se parte en varias páginas (no recorta un informe largo)');
  check(/inf-logo-fondo/.test(html) && /ponerInforme\('balCaptura'/.test(html) && /ponerInforme\('detCaptura'/.test(html) && /ponerInforme\('comCaptura'/.test(html) && /\/api\/imagenes\/logo-grupo\//.test(html), '3) Balance, Detallado y Comisión llevan el logo del grupo de fondo');
  check(/cargarImagenLogo\(urlLogoGrupo\(\)\)/.test(html) && /globalAlpha = 0\.14/.test(html), '3) en el PDF, cada página dibuja el logo de fondo');
  check(/contextoEn/.test(html) && /i > 0 && cabPx/.test(html) && /Página \$\{i \+ 1\} de \$\{tramos\.length\}/.test(html), '3) en el PDF, cada página repite el encabezado y el contexto (día, hipódromo, columnas) y numera "Página X de Y"');
  check(/inf-dia/.test(html) && /inf-hip/.test(html), '3) los bloques de día y de hipódromo están marcados para repetirlos en cada página');
  check(/Semana actual/.test(html) && /Semana anterior/.test(html) && /Ver rango/.test(html), '3) selector de semana + rango de fechas');
  const script = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];
  try { new Function(script); check(true, '3) el script de la pantalla compila'); } catch (e) { check(false, '3) error de sintaxis: ' + e.message); }

  global.Date = OriginalDate;
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
