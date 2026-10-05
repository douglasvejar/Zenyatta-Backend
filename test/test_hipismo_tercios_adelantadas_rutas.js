// =================================================================
// PRUEBA: "Jugadas entre Tercios Adelantadas" — rutas reales (POST
// /tercios-adelantadas/calcular, POST /tercios-adelantadas, GET
// /tercios-adelantadas/pendientes, PUT/DELETE jugadas/:id, y el
// enganche con "Cargar Planos" — POST /planos resuelve solas las
// pendientes de esa carrera) contra una base de datos falsa en
// memoria — mismo patrón que test_hipismo_adelantadas.js (Module._load
// intercepta "pg"/"express" antes de requerir el router real). El
// motor de cálculo puro ya está cubierto en
// test_hipismo_tercios_adelantadas_calc.js; esta prueba cubre el
// CABLEADO con la base de datos y con Cargar Planos.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const GRUPO_ID = 'grupo-tercios-adel-1';
const FECHA_PRUEBA = '2026-10-10';

const TABLAS = {
  jugadores: [],
  hipismo_hipodromos: [{ id: 'hip-1', grupo_id: GRUPO_ID, nombre: 'La Rinconada', pais: 'VE' }],
  hipismo_planos: [],
  hipismo_tickets: [],
  hipismo_tercios_adelantadas_planos: [],
  hipismo_tercios_adelantadas_jugadas: [],
  hipismo_alertas: []
};
let seq = 1;
const nuevoId = (prefijo) => prefijo + (seq++);

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
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql === 'SELECT 1') return { rows: [] };

  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    if (!TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      TABLAS.jugadores.push({ id: nuevoId('j'), grupo_id: grupoId, nombre, activo: true, auto_creado: true, tipo_cuenta: 'libre', pozo_inicial: 0, comision_propia: 0 });
    }
    return { rows: [] };
  }
  if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return { rows: filas.map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cc_propio_nombre: null })) };
  }
  if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre FROM jugadores_avales_porcentaje jap/i.test(sql)) return { rows: [] };
  if (/^SELECT id, nombre, comision_propia, cuenta_comision_id.*FROM jugadores WHERE grupo_id = \$1 AND nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return { rows: filas.map(j => ({ id: j.id, nombre: j.nombre, comision_propia: j.comision_propia || 0, cuenta_comision_id: j.cuenta_comision_id || null })) };
  }
  if (/^SELECT DISTINCT jap\.avalador_id, av\.nombre AS avalador_nombre, av\.cuenta_comision_id AS avalador_cuenta_comision_id/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };

  if (/^SELECT pais FROM hipismo_hipodromos/i.test(sql)) {
    const [grupoId, nombre] = params;
    const h = TABLAS.hipismo_hipodromos.find(x => x.grupo_id === grupoId && x.nombre === nombre);
    return { rows: h ? [{ pais: h.pais }] : [] };
  }
  if (/^SELECT nombre FROM hipismo_hipodromos/i.test(sql)) {
    const [id, grupoId] = params;
    const h = TABLAS.hipismo_hipodromos.find(x => x.id === id && x.grupo_id === grupoId);
    return { rows: h ? [{ nombre: h.nombre }] : [] };
  }

  // ---- Jugadas Adelantadas (Tablas Fijas/Marcas) -- esta prueba nunca
  // crea ninguna, siempre vacío.
  if (/^SELECT j\.\* FROM hipismo_adelantadas_jugadas j/i.test(sql)) return { rows: [] };

  // ---- "Jugadas entre Tercios Adelantadas" ----
  if (/^INSERT INTO hipismo_tercios_adelantadas_planos/i.test(sql)) {
    const [grupoId, hipodromoId, hipodromoNombre, fecha, comisionPorcentaje, textoOriginal] = params;
    const fila = { id: nuevoId('plta'), grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre, fecha, comision_porcentaje: comisionPorcentaje, texto_original: textoOriginal, creado_en: Date.now() };
    TABLAS.hipismo_tercios_adelantadas_planos.push(fila);
    return { rows: [fila] };
  }
  if (/^INSERT INTO hipismo_tercios_adelantadas_jugadas/i.test(sql)) {
    const [planoId, grupoId, jugador, banquero, carreraNumero, esCruce, grupoCaballos, cruceA, cruceB, modalidad, monto, comisionPorcentaje, textoOriginal, faltaMonto, faltaJugador, faltaBanquero] = params;
    const fila = {
      id: nuevoId('jta'), plano_id: planoId, grupo_id: grupoId, jugador_nombre: jugador, banquero_nombre: banquero, carrera_numero: carreraNumero,
      es_cruce: esCruce, grupo_caballos: grupoCaballos ? JSON.parse(grupoCaballos) : null, cruce_grupo_a: cruceA ? JSON.parse(cruceA) : null, cruce_grupo_b: cruceB ? JSON.parse(cruceB) : null,
      modalidad, monto, comision_porcentaje: comisionPorcentaje, texto_original: textoOriginal,
      falta_monto: faltaMonto, falta_jugador: faltaJugador, falta_banquero: faltaBanquero,
      estado: 'pendiente', resultado_jugador: null, resultado_banquero: null, comision_grupo: null, pizarra_usada: null, resuelto_en: null, creado_en: Date.now() + seq
    };
    TABLAS.hipismo_tercios_adelantadas_jugadas.push(fila);
    return { rows: [fila] };
  }
  if (/^SELECT j\.\* FROM hipismo_tercios_adelantadas_jugadas j\s+JOIN hipismo_tercios_adelantadas_planos p/i.test(sql)) {
    const [grupoId, hipodromoNombre, carreraNumero, fecha] = params;
    const filas = TABLAS.hipismo_tercios_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && String(j.carrera_numero) === String(carreraNumero) && j.estado === 'pendiente' && !j.falta_monto && !j.falta_jugador && !j.falta_banquero)
      .filter(j => {
        const p = TABLAS.hipismo_tercios_adelantadas_planos.find(pl => pl.id === j.plano_id);
        return p && p.hipodromo_nombre === hipodromoNombre && p.fecha === fecha;
      })
      .sort((a, b) => a.creado_en - b.creado_en);
    return { rows: filas };
  }
  if (/^UPDATE hipismo_tercios_adelantadas_jugadas\s+SET estado = \$1, resultado_jugador = \$2, resultado_banquero = \$3, comision_grupo = \$4, pizarra_usada = \$5/i.test(sql)) {
    const [estado, resultadoJugador, resultadoBanquero, comisionGrupo, pizarraUsada, id, grupoId] = params;
    const j = TABLAS.hipismo_tercios_adelantadas_jugadas.find(x => x.id === id && x.grupo_id === grupoId);
    if (j) Object.assign(j, { estado, resultado_jugador: resultadoJugador, resultado_banquero: resultadoBanquero, comision_grupo: comisionGrupo, pizarra_usada: pizarraUsada, resuelto_en: Date.now() });
    return { rows: j ? [j] : [] };
  }
  if (/^SELECT j\.\*, p\.hipodromo_nombre, p\.fecha\s+FROM hipismo_tercios_adelantadas_jugadas j\s+JOIN hipismo_tercios_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.id = \$1 AND j\.grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const j = TABLAS.hipismo_tercios_adelantadas_jugadas.find(x => x.id === id && x.grupo_id === grupoId);
    if (!j) return { rows: [] };
    const p = TABLAS.hipismo_tercios_adelantadas_planos.find(pl => pl.id === j.plano_id);
    return { rows: [{ ...j, hipodromo_nombre: p.hipodromo_nombre, fecha: p.fecha }] };
  }
  if (/^SELECT j\.\*, p\.hipodromo_nombre, p\.fecha\s+FROM hipismo_tercios_adelantadas_jugadas j\s+JOIN hipismo_tercios_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND j\.estado = 'pendiente'/i.test(sql)) {
    const [grupoId] = params;
    const filas = TABLAS.hipismo_tercios_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && j.estado === 'pendiente')
      .map(j => {
        const p = TABLAS.hipismo_tercios_adelantadas_planos.find(pl => pl.id === j.plano_id);
        return { ...j, hipodromo_nombre: p.hipodromo_nombre, fecha: p.fecha };
      });
    return { rows: filas };
  }
  if (/^UPDATE hipismo_tercios_adelantadas_jugadas\s+SET jugador_nombre = \$1, banquero_nombre = \$2, monto = \$3, modalidad = \$4/i.test(sql)) {
    const [jugador, banquero, monto, modalidad, faltaMonto, faltaJugador, faltaBanquero, estado, resultadoJugador, resultadoBanquero, comisionGrupo, id, grupoId] = params;
    const j = TABLAS.hipismo_tercios_adelantadas_jugadas.find(x => x.id === id && x.grupo_id === grupoId);
    if (j) Object.assign(j, { jugador_nombre: jugador, banquero_nombre: banquero, monto, modalidad, falta_monto: faltaMonto, falta_jugador: faltaJugador, falta_banquero: faltaBanquero, estado, resultado_jugador: resultadoJugador, resultado_banquero: resultadoBanquero, comision_grupo: comisionGrupo });
    return { rows: j ? [j] : [] };
  }
  if (/^DELETE FROM hipismo_tercios_adelantadas_jugadas WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    TABLAS.hipismo_tercios_adelantadas_jugadas = TABLAS.hipismo_tercios_adelantadas_jugadas.filter(x => !(x.id === id && x.grupo_id === grupoId));
    return { rows: [] };
  }
  if (/^INSERT INTO hipismo_alertas/i.test(sql)) {
    const [grupoId, tipo, usuario, hipodromoNombre, carreraNumero, fecha, mensaje] = params;
    TABLAS.hipismo_alertas.push({ id: nuevoId('alerta'), grupo_id: grupoId, tipo, usuario, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero, fecha, mensaje });
    return { rows: [] };
  }

  if (/^SELECT id FROM hipismo_planos WHERE grupo_id = \$1 AND hipodromo_nombre = \$2 AND carrera_numero = \$3 AND fecha = \$4/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO hipismo_planos/i.test(sql)) {
    const [grupoId, hipodromoId, hipodromoNombre, carreraNumero, fecha, ret, pizarra, cruzaJugadas, textoOriginal, textoResultado, comisionTotal] = params;
    const fila = { id: nuevoId('plano'), grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero, fecha, ret, pizarra, cruza_jugadas: cruzaJugadas, texto_original: textoOriginal, texto_resultado: textoResultado, comision_total: comisionTotal, creado_en: Date.now() };
    TABLAS.hipismo_planos.push(fila);
    return { rows: [fila] };
  }
  if (/^INSERT INTO hipismo_tickets/i.test(sql)) return { rows: [] };

  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba (tercios-adelantadas-rutas) no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => {
    router[m] = (...args) => { handlers.push([m, args]); return router; };
  });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'bcryptjs') return { hash: async () => 'hash', compare: async () => true };
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const hipismoRouter = require(path.join(__dirname, '..', 'src', 'routes', 'hipismo'));
Module._load = originalLoad;

function encontrarHandler(metodo, rutaBuscada) {
  const [, args] = hipismoRouter.__handlers.find(([m, a]) => m === metodo && a[0] === rutaBuscada);
  return args[args.length - 1];
}

// invocarRuta() — mismo patrón que test_hipismo_adelantadas.js: el
// handler (envuelto en asyncHandler) nunca devuelve su promesa interna,
// así que hay que resolver cuando de verdad llama a res.json(), no con
// un simple "await handler(...)".
function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (obj) => { res.payload = obj; resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

function fakeReq(body, params = {}, query = {}) {
  return { body, params, query, grupoId: GRUPO_ID, grupo: { nombre: 'ZENYATTA' }, nombreActor: 'Administrador' };
}

(async () => {
  // El mismo plano de ejemplo completo del usuario (1RA/7MA/2DA/9NA/8VA carrera).
  const PLANO_EJEMPLO = `*🏇🏻🇻🇪GRUPO ZENYATTA🐎🇻🇪*

*🇻🇪JUGADAS ADELANTADAS LA RINCONADA🇻🇪*

*1RA CARRERA*

*HANRY 2x7 20 DA HOUSTON*

*7MA CARRERA*

*HANRY JUEGA 1X2 400 DA SAMMY*

*MR INCREIBLE JUEGA 2Y2 DEL 2 DA RICKY 150*

*GG JUEGA 2x1 20 DA ROJAS*

*2DA CARRERA*

*SAMMY JUEGA 3X6 10A8 DA RICKY*

*9NA CARRERA*

*RICKY JUEGA 10X3 27 DA HOUSTON*

*8VA CARRERA*

*RAMBO JUEGO 2PTS 2Y3 DEL 4 180 DA MUJICA*

*NOTA= JUGADAS ADELANTADAS  -3%* 👀👀👀

👉🏼 *LOS PLANOS SON REFERENCIALES📝✍️*
👉🏼 *LA GUIA ES EL CHAT SE GANA Y PAGA CON EL CHAT* 📝
`;

  // ===== 1) POST /tercios-adelantadas/calcular (vista previa, no guarda) =====
  const postCalcular = encontrarHandler('post', '/tercios-adelantadas/calcular');
  {
    const req = fakeReq({ texto: PLANO_EJEMPLO });
    const res = await invocarRuta(postCalcular, req);
    check(res.statusCode === 200, 'POST /tercios-adelantadas/calcular responde 200');
    check(res.payload.hipodromo === 'LA RINCONADA', 'Vista previa detecta el hipódromo del texto');
    check(res.payload.pctSugerido === 3, 'Vista previa detecta el % sugerido (NOTA= ... -3%)');
    check(res.payload.lineas.length === 7, 'Vista previa reconoce las 7 líneas');
    check(res.payload.cantidadErrores === 1, 'Vista previa detecta 1 línea con error (a Sammy le falta el monto)');
    check(TABLAS.hipismo_tercios_adelantadas_planos.length === 0, 'La vista previa NO guardó nada en la base');
  }

  // ===== 2) POST /tercios-adelantadas (guardar de verdad) =====
  const postGuardar = encontrarHandler('post', '/tercios-adelantadas');
  let planoGuardado;
  {
    // hipodromoId: 'hip-1' -- el operador SÍ eligió el hipódromo arriba en
    // la pantalla (como hará la UI real, con su propio selector), así que
    // manda sobre el nombre leído del texto pegado y queda con la MISMA
    // grafía canónica ("La Rinconada") que después usa "Cargar Planos" --
    // evita el riesgo de que "LA RINCONADA" (tal cual viene en el texto)
    // no calce por mayúsculas/minúsculas contra el hipódromo seleccionado
    // en Cargar Planos.
    const req = fakeReq({ texto: PLANO_EJEMPLO, fecha: FECHA_PRUEBA, hipodromoId: 'hip-1' });
    const res = await invocarRuta(postGuardar, req);
    check(res.statusCode === 201, 'POST /tercios-adelantadas guarda el plano real (201)');
    check(res.payload.cantidadJugadas === 7, 'Guardó las 7 jugadas');
    check(res.payload.cantidadErrores === 1, 'Guardó marcando 1 jugada con error (Sammy, falta el monto)');
    planoGuardado = res.payload.plano;
    check(planoGuardado.hipodromo_nombre === 'La Rinconada', 'El plano guardado usa el hipódromo seleccionado (hipodromoId), con su grafía canónica');
    check(Number(planoGuardado.comision_porcentaje) === 3, 'El plano guardado usa el % leído de la NOTA (no se mandó explícito en el body)');
    check(TABLAS.hipismo_tercios_adelantadas_jugadas.length === 7, '7 jugadas insertadas en la base falsa');
    const sammy = TABLAS.hipismo_tercios_adelantadas_jugadas.find(j => j.jugador_nombre === 'SAMMY');
    check(!!sammy && sammy.falta_monto === true, 'La jugada de Sammy quedó marcada falta_monto=true');
    const hanry1 = TABLAS.hipismo_tercios_adelantadas_jugadas.find(j => j.jugador_nombre === 'HANRY' && j.carrera_numero === 1);
    check(!!hanry1 && hanry1.es_cruce === true && JSON.stringify(hanry1.cruce_grupo_a) === '[2]' && JSON.stringify(hanry1.cruce_grupo_b) === '[7]', 'Hanry carrera 1: cruce 2x7 guardado correcto');
    const mrIncreible = TABLAS.hipismo_tercios_adelantadas_jugadas.find(j => j.jugador_nombre === 'MR INCREIBLE');
    check(!!mrIncreible && Number(mrIncreible.monto) === 150 && mrIncreible.banquero_nombre === 'RICKY', 'MR INCREIBLE (nombre de 2 palabras): monto 150 y banquero RICKY guardados correcto');
  }

  // ===== 3) GET /tercios-adelantadas/pendientes =====
  const getPendientes = encontrarHandler('get', '/tercios-adelantadas/pendientes');
  {
    const req = fakeReq({}, {}, {});
    const res = await invocarRuta(getPendientes, req);
    check(res.payload.total === 7, 'GET /pendientes ve las 7 jugadas');
    check(res.payload.conError === 1, 'GET /pendientes cuenta 1 con error');
    check(res.payload.esperandoPizarra === 6, 'GET /pendientes cuenta 6 esperando pizarra (sin error)');
  }

  // ===== 4) PUT /tercios-adelantadas/jugadas/:id -- corrige el monto faltante de Sammy =====
  const putJugada = encontrarHandler('put', '/tercios-adelantadas/jugadas/:id');
  {
    const sammy = TABLAS.hipismo_tercios_adelantadas_jugadas.find(j => j.jugador_nombre === 'SAMMY');
    const req = fakeReq({ monto: 100 }, { id: sammy.id });
    const res = await invocarRuta(putJugada, req);
    check(res.statusCode === 200, 'PUT /tercios-adelantadas/jugadas/:id responde 200');
    check(res.payload.faltaMonto === false, 'Ya no falta el monto de Sammy');
    check(res.payload.estado === 'pendiente', 'Sammy sigue pendiente (todavía no llegó la pizarra de su carrera)');
    check(TABLAS.hipismo_alertas.some(a => a.tipo === 'TERCIOS_ADELANTADA_EDITADA'), 'Se registró la alerta TERCIOS_ADELANTADA_EDITADA');
  }

  // ===== 5) POST /planos (Cargar Planos) resuelve solas las pendientes de la carrera 1 =====
  // Carrera 1: HANRY 2x7 20 DA HOUSTON -- pelo a pelo, sin decimos. Pizarra
  // donde el 2 (Hanry) llega mejor que el 7 (Houston) -> gana Hanry.
  const postPlanos = encontrarHandler('post', '/planos');
  {
    const req = fakeReq({
      hipodromoNombre: 'La Rinconada', carreraNumero: 1, fecha: FECHA_PRUEBA,
      pizarra: '2-7-1', texto: '', ret: '', cruzaJugadas: false
    });
    const res = await invocarRuta(postPlanos, req);
    check(res.statusCode === 201, 'POST /planos (carrera 1, sin texto de Tercios en vivo) guarda igual porque hay tercios-adelantadas pendientes');
    const hanry1 = TABLAS.hipismo_tercios_adelantadas_jugadas.find(j => j.jugador_nombre === 'HANRY' && j.carrera_numero === 1);
    check(hanry1.estado === 'resuelto', 'Hanry carrera 1 queda resuelto');
    check(Number(hanry1.resultado_jugador) === 20 * 0.97, 'Hanry (gana) cobra 20*0.97=19.4 (comisión 3% leída de la NOTA)');
    check(Number(hanry1.resultado_banquero) === -20, 'Houston (pierde) pierde el monto completo, -20');
    check(res.payload.totalesFinales['HANRY'] === 19.4, 'Balance General: HANRY +19.4');
    check(res.payload.totalesFinales['HOUSTON'] === -20, 'Balance General: HOUSTON -20');
    check(res.payload.totalesFinales['% TERCIOS ADELANTADAS'] === 0.6, 'Balance General: comisión del grupo por esta jugada, 0.6 (3% de 20)');
    check(res.payload.terciosAdelantadasResueltas.length === 1, 'La respuesta trae 1 jugada de tercios-adelantadas resuelta');
    check(/PARADA ADELANTADAS/.test(res.payload.plano.texto_resultado), 'El texto del plano incluye el bloque "PARADA ADELANTADAS"');
    check(/HANRY \+19,40/i.test(res.payload.plano.texto_resultado) || /Hanry \+19,40/.test(res.payload.plano.texto_resultado), 'El bloque de texto muestra a Hanry ganando 19,40');
  }

  // ===== 6) POST /planos carrera 7: resuelve 3 jugadas a la vez (Hanry/Sammy, MrIncreible/Ricky, GG/Rojas) =====
  {
    // Pizarra: 1 llega 1ro, 2 llega 2do -- HANRY (1x2) pierde (necesita el
    // 1 o el 2 de PRIMERO exacto en "pp"? No, "1X2" sin decimos es pelo a
    // pelo: gana quien este mas cerca del 1er lugar -- Hanry va al 1,
    // Sammy va al 2 -- el 1 llego 1ro -> gana Hanry.
    // MR INCREIBLE (2Y2 del 2) -- modalidad real de Tercios (2 puestos) --
    // el 2 llega 2do -> dentro de "2y2" el 2do puesto paga la MITAD.
    // GG (2x1) -- Gg va al 2, Rojas va al 1 -- el 1 llego 1ro -> gana Rojas (banquero).
    const req = fakeReq({
      hipodromoNombre: 'La Rinconada', carreraNumero: 7, fecha: FECHA_PRUEBA,
      pizarra: '1-2-3', texto: '', ret: '', cruzaJugadas: false
    });
    const res = await invocarRuta(postPlanos, req);
    check(res.statusCode === 201, 'POST /planos (carrera 7) guarda');
    check(res.payload.terciosAdelantadasResueltas.length === 3, 'Resuelve las 3 jugadas de la carrera 7 a la vez');
    const hanry7 = TABLAS.hipismo_tercios_adelantadas_jugadas.find(j => j.jugador_nombre === 'HANRY' && j.carrera_numero === 7);
    check(hanry7.estado === 'resuelto' && Number(hanry7.resultado_jugador) === 400 * 0.97, 'Hanry carrera 7 gana 400*0.97=388 (1 contra 2, pelo a pelo, gana el 1)');
    const mrIncreible = TABLAS.hipismo_tercios_adelantadas_jugadas.find(j => j.jugador_nombre === 'MR INCREIBLE');
    check(mrIncreible.estado === 'resuelto', 'MR INCREIBLE queda resuelto');
    check(Number(mrIncreible.resultado_jugador) === round2(150 * 0.5 * 0.97), 'MR INCREIBLE cobra la mitad de 150 (2do puesto, modalidad 2y2) menos 3%');
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // ===== 7) DELETE /tercios-adelantadas/jugadas/:id =====
  const deleteJugada = encontrarHandler('delete', '/tercios-adelantadas/jugadas/:id');
  {
    const gg = TABLAS.hipismo_tercios_adelantadas_jugadas.find(j => j.jugador_nombre === 'GG');
    const req = fakeReq({}, { id: gg.id });
    const res = await invocarRuta(deleteJugada, req);
    check(res.payload.ok === true, 'DELETE /tercios-adelantadas/jugadas/:id responde ok');
    check(!TABLAS.hipismo_tercios_adelantadas_jugadas.some(j => j.id === gg.id), 'La jugada de GG ya no existe en la base');
    check(TABLAS.hipismo_alertas.some(a => a.tipo === 'TERCIOS_ADELANTADA_ELIMINADA'), 'Se registró la alerta TERCIOS_ADELANTADA_ELIMINADA');
  }

  console.log(`\n${pasaron} OK, ${fallaron} FALLARON`);
  if (fallaron > 0) process.exit(1);
})();
