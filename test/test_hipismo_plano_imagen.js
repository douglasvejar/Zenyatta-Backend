// =================================================================
// PRUEBA: datos de la IMAGEN del plano ("Copiar en imagen" de Cargar Planos,
// 07-10-2026). Verifica, con el motor real, que POST /planos/calcular devuelve
// `datosImagen` con las mismas jugadas/totales que el texto del plano, el texto
// "TOTALES DE LA CARRERA ... EN EL HIPÓDROMO ... EN EL GRUPO ...", nunca la
// comisión del grupo, y que el servicio puro ordena Ganan/Pierden y arma
// PARADA ADELANTADAS.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'g-plano-imagen-1';

const PCT = 1;
const TABLAS = {
  jugadores: [
    { id: 'j-1', grupo_id: GRUPO_ID, nombre: 'SAMMY', comision_propia: 0 },
    { id: 'j-2', grupo_id: GRUPO_ID, nombre: 'MUJICA', comision_propia: 0 },
    { id: 'j-3', grupo_id: GRUPO_ID, nombre: 'ZENYATTA', comision_propia: 0 }
  ],
  jugadores_avales_porcentaje: []
};

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
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerComisionesPropias ----
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && (!nombres || nombres.includes(j.nombre)));
    return { rows: filas.map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cc_propio_nombre: null })) };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) {
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.(\*|id, j\.jugador_nombre)[\s\S]*?FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  if (/^SELECT j\.\* FROM hipismo_adelantadas_jugadas/i.test(sql)) return { rows: [] };
  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (neteo-planos-calcular) no sabe responder: ' + sql);
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
  let salida = null, status = 200;
  await new Promise((resolve, reject) => {
    const res = { status(c) { status = c; return this; }, json(o) { salida = o; resolve(); } };
    handler(req, res, (e) => { if (e) reject(e); });
  }).catch(e => console.error('ERROR INESPERADO:', e));
  return { salida, status };
}

(async function main() {
  const reqBase = { grupoId: GRUPO_ID, grupo: { nombre: 'Zenyatta' }, params: {} };
  const texto = 'Juega Sammy 1p (3) con 225 da Zenyatta\nJuega Mujica 1p (5) con 450 da Zenyatta';
  const { salida, status } = await invocarRuta(handlerDe('post', '/planos/calcular'), {
    ...reqBase, body: { texto, pizarra: '3 4 8 1 7', ret: '6', hipodromoNombre: 'La Rinconada', carreraNumero: 11, fecha: '2026-10-06', cruzaJugadas: false }
  });
  check(status === 200 && !!salida, '1) POST /planos/calcular respondió 200');
  const d = salida && salida.datosImagen;
  check(!!d, '2) la respuesta trae datosImagen');
  check(d && d.jugadas.length === 2, '3) 2 jugadas en la imagen');
  check(d && d.jugadas[0].cliente === 'Sammy' && d.jugadas[0].banquero === 'Zenyatta' && d.jugadas[0].modalidad === '1p' && d.jugadas[0].caballo === '3' && d.jugadas[0].monto === 225 && d.jugadas[0].resultado === 213.75,
    '4) primera jugada: Sammy 1p al 3 con 225 da Zenyatta = +213,75');
  check(d && d.jugadas[1].cliente === 'Mujica' && d.jugadas[1].resultado === -450, '5) segunda jugada: Mujica pierde -450');
  check(d && JSON.stringify(d.llegada) === JSON.stringify(['3', '4', '8', '1', '7']) && JSON.stringify(d.retirados) === '[6]', '6) llegada 3 4 8 1 7 y retirado 6');
  check(d && d.textoAcompanante === 'TOTALES DE LA CARRERA 11MA EN EL HIPÓDROMO LA RINCONADA EN EL GRUPO ZENYATTA', '7) texto de acompañamiento exacto -- fue: ' + (d && d.textoAcompanante));
  // Mismas cifras que el texto del plano.
  const txt = salida.textoResultado;
  const gan = (d && d.ganan.map(([n, v]) => n + ' +' + v)) || [];
  check(d && d.ganan[0][0] === 'Sammy' && d.ganan[0][1] === 213.75 && /Sammy \+213,75/.test(txt), '8) Ganan de la imagen = Ganan del texto (Sammy +213,75)');
  check(d && d.pierden[0][0] === 'Mujica' && d.pierden[0][1] === -450 && /Mujica -450,00/.test(txt), '9) Pierden de la imagen = Pierden del texto (Mujica -450,00)');
  check(d && !/comisi/i.test(JSON.stringify(d)), '10) los datos de la imagen NO incluyen la comisión del grupo');
  check(d && d.adelantadas === null, '11) sin jugadas adelantadas => adelantadas null');

  // Servicio puro: orden de ganan/pierden, adelantadas y texto sin carrera/hipódromo.
  const { armarDatosImagenPlano, armarTextoAcompanante } = require('../src/services/hipismoPlanoImagen');
  const p = armarDatosImagenPlano({
    grupoNombre: 'LUSHO', hipodromoNombre: 'Santa Rita', carreraNumero: 8, fecha: '2026-10-06', ret: '', pizarra: '7 1 4 8 5',
    tickets: [], totalesFinales: { A: 10, B: -5, C: 30, D: -50, E: 0 },
    movimientosAdelantadas: [
      { nombre: 'HALLAND', monto: 100, individual: true, grupo: 1 }, { nombre: 'MARCAS', monto: -100, individual: true, grupo: 1 },
      { nombre: 'HANRY', monto: -120, individual: true, grupo: 2 }, { nombre: 'TABLAS FIJAS', monto: 120, individual: true, grupo: 2 },
      { nombre: 'PEPE', monto: 40 }
    ]
  });
  check(JSON.stringify(p.ganan) === JSON.stringify([['C', 30], ['A', 10], ['E', 0]]), '12) Ganan ordenado de mayor a menor (el 0 va entre los que ganan, igual que el texto)');
  check(JSON.stringify(p.pierden) === JSON.stringify([['D', -50], ['B', -5]]), '13) Pierden ordenado del que más pierde al que menos');
  check(p.adelantadas && p.adelantadas.filas.length === 3, '14) PARADA ADELANTADAS: 2 pares individuales + 1 neto por nombre');
  check(p.adelantadas.filas[0].cliente === 'Halland' && p.adelantadas.filas[0].item === 'Marcas' && p.adelantadas.filas[0].resultado === 100, '15) el par muestra el ítem genérico (Marcas), nunca un banqueador real');
  check(p.adelantadas.filas[2].cliente === 'Pepe' && p.adelantadas.filas[2].item === 'Tercios adel.', '16) las Tercios Adelantadas salen por nombre');
  check(armarTextoAcompanante({ grupoNombre: 'Lusho', hipodromoNombre: '', carreraNumero: '' }) === 'TOTALES DE LA CARRERA EN EL GRUPO LUSHO', '17) sin carrera ni hipódromo: se omiten sin dejar huecos');
  check(armarTextoAcompanante({ grupoNombre: 'Lusho', hipodromoNombre: 'La Rinconada', carreraNumero: 3 }) === 'TOTALES DE LA CARRERA 3RA EN EL HIPÓDROMO LA RINCONADA EN EL GRUPO LUSHO', '18) 3ra se escribe 3RA');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})();
