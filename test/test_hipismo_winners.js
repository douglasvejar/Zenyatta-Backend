// =================================================================
// PRUEBA: "Cargar Winners" — Módulo Hipismo (26-09-2026, a pedido del
// usuario: "en cargar winners se selecciona el cliente... con el
// hipódromo y la carrera, el número del caballo... y al lado una
// columna que diga monto... se coloca monto negativo o positivo en
// caso de que gane o pierda... igual que en los demás, se le da
// calcular, y después un botón que diga Cargar Winners... eso se le
// agrega a cada cliente en su ficha, es como si fuera una jugada más...
// eso mueve su balance y su pozo ya que es una jugada").
//
// A diferencia de Tercios/Remate/Adelantadas, Winners NO tiene % de
// comisión ni "monto apostado" — el operador escribe DIRECTAMENTE el
// resultado neto (con signo) de cada cliente, así que POST /winners no
// calcula nada, solo valida y guarda. Mismo patrón de base de datos
// falsa en memoria que el resto del proyecto (Module._load intercepta
// "pg"/"express" antes de requerir el router real) — ver
// test_hipismo_remate.js.
//
// Casos cubiertos:
//   1. Falta carreraNumero -> 400.
//   2. lineas vacío/ausente -> 400.
//   3. Falta el hipódromo (ni hipodromoId ni hipodromoNombre) -> 400.
//   4. Guardado real: 2 clientes, 1 gana y 1 pierde -> filas insertadas
//      con el monto correcto (con signo), autoRegistrarJugadores crea al
//      cliente que todavía no existía.
//   5. Una línea con monto 0 se descarta sola (no rompe el resto).
//   6. Un mismo cliente con 2 caballos (uno ganó, uno perdió) -> se suma
//      en totalesPorCliente.
//   7. Si NINGUNA línea queda válida (todas en 0 o sin cliente/caballo)
//      -> 400, no guarda nada.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-winners-1';
const TABLAS = {
  jugadores: [],
  hipismo_winners: [],
  hipismo_alertas: []
};
let seq = 1;
const nuevoId = (prefijo) => prefijo + (seq++);

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // autoRegistrarJugadores() (services/procesarSabana.js) — se llama con
  // jugadoresPorNombreExistentes: {}, así que trata a TODOS los nombres
  // del winner como "nuevos" y los intenta insertar (ON CONFLICT DO
  // NOTHING si ya existían).
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    if (!TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      TABLAS.jugadores.push({ id: nuevoId('j'), grupo_id: grupoId, nombre, activo: true, auto_creado: true, tipo_cuenta: 'libre', pozo_inicial: 0 });
    }
    return { rows: [] };
  }

  // Resolución de hipódromo por id (cuando el front manda hipodromoId en
  // vez de hipodromoNombre directo) — esta prueba no lo ejercita todavía
  // porque el front manda el nombre directo, pero queda cubierto.
  if (/^SELECT nombre FROM hipismo_hipodromos WHERE id = \$1 AND grupo_id = \$2/i.test(sql)) {
    return { rows: [] };
  }

  // POST /winners: INSERT hipismo_winners (una por línea válida).
  if (/^INSERT INTO hipismo_winners \(grupo_id, hipodromo_id, hipodromo_nombre, carrera_numero, fecha, cliente_nombre, caballo, monto\)/i.test(sql)) {
    const [grupoId, hipodromoId, hipodromoNombre, carreraNumero, fecha, clienteNombre, caballo, monto] = params;
    const fila = {
      id: nuevoId('win'), grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre,
      carrera_numero: carreraNumero, fecha, cliente_nombre: clienteNombre, caballo, monto, creado_en: Date.now()
    };
    TABLAS.hipismo_winners.push(fila);
    return { rows: [fila] };
  }

  // "Eliminar Winners" (28-09-2026) — GET /winners/dias.
  if (/^SELECT fecha, COUNT\(\*\)::int AS cantidad\s+FROM hipismo_winners\s+WHERE grupo_id = \$1\s+GROUP BY fecha\s+ORDER BY fecha DESC\s+LIMIT 120/i.test(sql)) {
    const [grupoId] = params;
    const porFecha = new Map();
    TABLAS.hipismo_winners.filter(w => w.grupo_id === grupoId).forEach(w => {
      porFecha.set(w.fecha, (porFecha.get(w.fecha) || 0) + 1);
    });
    return { rows: Array.from(porFecha.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([fecha, cantidad]) => ({ fecha, cantidad })) };
  }
  // GET /winners?fecha= (con o sin filtro de fecha).
  if (/^SELECT \* FROM hipismo_winners WHERE grupo_id = \$1\s*(AND fecha = \$2)?\s+ORDER BY fecha DESC, hipodromo_nombre ASC, carrera_numero ASC, creado_en ASC\s+LIMIT 200/i.test(sql)) {
    const [grupoId, fecha] = params;
    let filas = TABLAS.hipismo_winners.filter(w => w.grupo_id === grupoId);
    if (fecha) filas = filas.filter(w => w.fecha === fecha);
    filas = filas.slice().sort((a, b) =>
      b.fecha.localeCompare(a.fecha) ||
      a.hipodromo_nombre.localeCompare(b.hipodromo_nombre) ||
      a.carrera_numero - b.carrera_numero ||
      a.creado_en - b.creado_en
    );
    return { rows: filas };
  }
  // PUT/DELETE /winners/:id: buscar la fila por id.
  if (/^SELECT \* FROM hipismo_winners WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    return { rows: TABLAS.hipismo_winners.filter(w => w.id === id && w.grupo_id === grupoId) };
  }
  // PUT /winners/:id: UPDATE.
  if (/^UPDATE hipismo_winners SET cliente_nombre = \$1, caballo = \$2, monto = \$3\s+WHERE id = \$4 AND grupo_id = \$5 RETURNING \*/i.test(sql)) {
    const [clienteNombre, caballo, monto, id, grupoId] = params;
    const fila = TABLAS.hipismo_winners.find(w => w.id === id && w.grupo_id === grupoId);
    if (fila) { fila.cliente_nombre = clienteNombre; fila.caballo = caballo; fila.monto = monto; }
    return { rows: fila ? [fila] : [] };
  }
  // DELETE /winners/:id.
  if (/^DELETE FROM hipismo_winners WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    TABLAS.hipismo_winners = TABLAS.hipismo_winners.filter(w => !(w.id === id && w.grupo_id === grupoId));
    return { rows: [] };
  }
  // registrarAlerta() -- PUT/DELETE de Winners generan alerta (WINNER_EDITADO/WINNER_ELIMINADO).
  if (/^INSERT INTO hipismo_alertas \(grupo_id, tipo, usuario, hipodromo_nombre, carrera_numero, fecha, mensaje\)/i.test(sql)) {
    const [grupoId, tipo, usuario, hipodromoNombre, carreraNumero, fecha, mensaje] = params;
    TABLAS.hipismo_alertas.push({ grupo_id: grupoId, tipo, usuario, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero, fecha, mensaje });
    return { rows: [] };
  }

  // 04-10-2026: "Jugadas entre Tercios Adelantadas" -- ninguna prueba de

  // este archivo crea jugadas de esta pestana nueva, asi que la consulta

  // de pendientes (calcularResolucionTerciosAdelantadas en routes/hipismo.js)

  // siempre debe dar vacio.

  if (/^SELECT j\.\* FROM hipismo_tercios_adelantadas_jugadas/i.test(sql)) return { rows: [] };

  throw new Error('La base de datos falsa de esta prueba (winners) no sabe responder: ' + sql);
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

function handlerDe(metodo, rutaPath) {
  const entrada = hipismoRouter.__handlers.find(([m, args]) => m === metodo && args[0] === rutaPath);
  return entrada[1][entrada[1].length - 1];
}
const handlerWinners = handlerDe('post', '/winners');
const handlerWinnersDias = handlerDe('get', '/winners/dias');
const handlerWinnersLista = handlerDe('get', '/winners');
const handlerWinnersPut = handlerDe('put', '/winners/:id');
const handlerWinnersDelete = handlerDe('delete', '/winners/:id');

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

function reqBase(grupoId, body) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, body: body || {} };
}
function reqGet(grupoId, query) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: {}, query: query || {} };
}
function reqConId(grupoId, id, body) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: { id }, query: {}, body: body || {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

async function main() {
  // 1) Falta carreraNumero.
  {
    const res = await invocarRuta(handlerWinners, reqBase(GRUPO_ID, {
      hipodromoNombre: 'La Rinconada', fecha: '2026-09-26',
      lineas: [{ cliente: 'PEDRO', caballo: '5', monto: 40 }]
    }));
    check(res._status === 400, '1) Sin carreraNumero -> 400');
  }

  // 2) lineas vacío.
  {
    const res = await invocarRuta(handlerWinners, reqBase(GRUPO_ID, {
      hipodromoNombre: 'La Rinconada', carreraNumero: 3, fecha: '2026-09-26', lineas: []
    }));
    check(res._status === 400, '2) lineas vacío -> 400');
  }

  // 3) Falta el hipódromo.
  {
    const res = await invocarRuta(handlerWinners, reqBase(GRUPO_ID, {
      carreraNumero: 3, fecha: '2026-09-26',
      lineas: [{ cliente: 'PEDRO', caballo: '5', monto: 40 }]
    }));
    check(res._status === 400, '3) Sin hipódromo -> 400');
  }

  // 4) Guardado real: PEDRO gana con el 5 (+40), JUNKO pierde con el 9 (-15).
  //    JUNKO todavía no existe en jugadores -> autoRegistrarJugadores lo crea.
  const antesDeJunko = TABLAS.jugadores.some(j => j.nombre === 'JUNKO');
  check(!antesDeJunko, '4a) JUNKO todavía no existe antes de cargar el winner');
  {
    const res = await invocarRuta(handlerWinners, reqBase(GRUPO_ID, {
      hipodromoNombre: 'La Rinconada', carreraNumero: 3, fecha: '2026-09-26',
      lineas: [
        { cliente: 'PEDRO', caballo: '5', monto: 40 },
        { cliente: 'JUNKO', caballo: '9', monto: -15 }
      ]
    }));
    check(res._status === 201, '4b) Guardado real -> 201');
    check(res._json.lineas.length === 2, '4c) Se guardaron 2 filas');
    const filaPedro = TABLAS.hipismo_winners.find(w => w.cliente_nombre === 'PEDRO');
    const filaJunko = TABLAS.hipismo_winners.find(w => w.cliente_nombre === 'JUNKO');
    check(!!filaPedro && Number(filaPedro.monto) === 40 && filaPedro.caballo === '5', '4d) Fila de PEDRO: caballo 5, monto +40');
    check(!!filaJunko && Number(filaJunko.monto) === -15 && filaJunko.caballo === '9', '4e) Fila de JUNKO: caballo 9, monto -15');
    check(res._json.totalesPorCliente.PEDRO === 40, '4f) totalesPorCliente.PEDRO === 40');
    check(res._json.totalesPorCliente.JUNKO === -15, '4g) totalesPorCliente.JUNKO === -15');
    check(TABLAS.jugadores.some(j => j.nombre === 'JUNKO'), '4h) autoRegistrarJugadores creó a JUNKO');
    check(typeof res._json.textoResultado === 'string' && res._json.textoResultado.includes('WINNERS'), '4i) textoResultado trae el encabezado WINNERS');
    check(res._json.textoResultado.includes('Pedro') && res._json.textoResultado.includes('+40'), '4j) textoResultado menciona a Pedro y +40,00');
    check(res._json.textoResultado.includes('Junko') && res._json.textoResultado.includes('-15'), '4k) textoResultado menciona a Junko y -15,00');
  }

  // 5) Una línea con monto 0 se descarta sola, el resto se guarda igual.
  {
    const antes = TABLAS.hipismo_winners.length;
    const res = await invocarRuta(handlerWinners, reqBase(GRUPO_ID, {
      hipodromoNombre: 'La Rinconada', carreraNumero: 4, fecha: '2026-09-26',
      lineas: [
        { cliente: 'PEDRO', caballo: '2', monto: 0 },
        { cliente: 'PEDRO', caballo: '6', monto: 25 }
      ]
    }));
    check(res._status === 201, '5a) Con una línea en 0 y otra válida -> igual guarda (201)');
    check(res._json.lineas.length === 1, '5b) Solo se guardó 1 fila (la de monto 0 se descartó)');
    check(TABLAS.hipismo_winners.length === antes + 1, '5c) Solo se insertó 1 fila nueva en la base');
  }

  // 6) Un mismo cliente con 2 caballos en la misma carga -> se suma en totalesPorCliente.
  {
    const res = await invocarRuta(handlerWinners, reqBase(GRUPO_ID, {
      hipodromoNombre: 'La Rinconada', carreraNumero: 5, fecha: '2026-09-26',
      lineas: [
        { cliente: 'MUJICA', caballo: '1', monto: 30 },
        { cliente: 'MUJICA', caballo: '4', monto: -10 }
      ]
    }));
    check(res._status === 201, '6a) 2 líneas del mismo cliente -> 201');
    check(res._json.lineas.length === 2, '6b) Se guardaron las 2 filas por separado');
    check(res._json.totalesPorCliente.MUJICA === 20, '6c) totalesPorCliente.MUJICA suma 30 + (-10) = 20');
  }

  // 7) Ninguna línea válida (todas en 0) -> 400, no guarda nada.
  {
    const antes = TABLAS.hipismo_winners.length;
    const res = await invocarRuta(handlerWinners, reqBase(GRUPO_ID, {
      hipodromoNombre: 'La Rinconada', carreraNumero: 6, fecha: '2026-09-26',
      lineas: [{ cliente: 'PEDRO', caballo: '3', monto: 0 }]
    }));
    check(res._status === 400, '7a) Todas las líneas en 0 -> 400');
    check(TABLAS.hipismo_winners.length === antes, '7b) No se insertó ninguna fila nueva');
  }

  // =================================================================
  // "ELIMINAR WINNERS" (28-09-2026, a pedido del usuario: "crea un boton
  // debajo de cargar winners... que se llame eliminar winners... alli
  // podre ver editar y eliminar todas las jugadas de winners, ordenadas
  // por fecha, por hipodromo, por carrera"). A esta altura ya hay 5 filas
  // guardadas en '2026-09-26' (La Rinconada): PEDRO/5 +40, JUNKO/9 -15,
  // PEDRO/6 +25, MUJICA/1 +30, MUJICA/4 -10.

  // 8) GET /winners/dias
  {
    const res = await invocarRuta(handlerWinnersDias, reqGet(GRUPO_ID));
    check(res._status === 200, '8a) GET /winners/dias responde 200');
    const dia = res._json.find(d => d.fecha === '2026-09-26');
    check(!!dia && dia.cantidad === 5, `8b) El día 2026-09-26 trae cantidad=5, dio ${dia && dia.cantidad}`);
  }

  // 9) GET /winners?fecha=2026-09-26 -- ordenado por hipódromo/carrera/creado_en.
  let idParaEditar, idParaEliminar;
  {
    const res = await invocarRuta(handlerWinnersLista, reqGet(GRUPO_ID, { fecha: '2026-09-26' }));
    check(res._status === 200, '9a) GET /winners?fecha= responde 200');
    check(res._json.length === 5, `9b) Trae las 5 líneas de ese día, dio ${res._json.length}`);
    check(res._json[0].carrera_numero === 3 && res._json[1].carrera_numero === 3, '9c) Ordenado por carrera: las 2 de la carrera 3 (PEDRO/JUNKO) primero');
    idParaEditar = res._json.find(w => w.cliente_nombre === 'PEDRO' && w.caballo === '5').id;
    idParaEliminar = res._json.find(w => w.cliente_nombre === 'JUNKO').id;
  }

  // 10) PUT /winners/:id -- edita cliente/caballo/monto de una línea puntual.
  {
    const res = await invocarRuta(handlerWinnersPut, reqConId(GRUPO_ID, idParaEditar, { monto: 999 }));
    check(res._status === 200, '10a) PUT /winners/:id responde 200');
    check(Number(res._json.monto) === 999, `10b) El monto quedó en 999, dio ${res._json.monto}`);
    check(res._json.cliente_nombre === 'PEDRO' && res._json.caballo === '5', '10c) cliente/caballo no cambiaron (no vinieron en el body)');
    check(TABLAS.hipismo_alertas.some(a => a.tipo === 'WINNER_EDITADO'), '10d) Se registró una alerta WINNER_EDITADO');
  }

  // 11) DELETE /winners/:id -- borra una línea puntual, sin papelera.
  {
    const antes = TABLAS.hipismo_winners.length;
    const res = await invocarRuta(handlerWinnersDelete, reqConId(GRUPO_ID, idParaEliminar));
    check(res._status === 200 && res._json.ok === true, '11a) DELETE /winners/:id responde { ok: true }');
    check(TABLAS.hipismo_winners.length === antes - 1, '11b) Se borró la fila de verdad (una menos en la tabla)');
    check(!TABLAS.hipismo_winners.some(w => w.id === idParaEliminar), '11c) La fila de JUNKO ya no existe');
    check(TABLAS.hipismo_alertas.some(a => a.tipo === 'WINNER_ELIMINADO'), '11d) Se registró una alerta WINNER_ELIMINADO');

    const resLista = await invocarRuta(handlerWinnersLista, reqGet(GRUPO_ID, { fecha: '2026-09-26' }));
    check(resLista._json.length === 4, `11e) GET /winners?fecha= ahora trae 4 líneas, dio ${resLista._json.length}`);
  }

  // 12) Un id que no existe (o de otro grupo) da 404, nunca revienta.
  {
    const resPut = await invocarRuta(handlerWinnersPut, reqConId(GRUPO_ID, 'no-existe', { monto: 5 }));
    check(resPut._status === 404, '12a) PUT a un id inexistente -> 404');
    const resDelete = await invocarRuta(handlerWinnersDelete, reqConId('otro-grupo-id', idParaEditar));
    check(resDelete._status === 404, '12b) DELETE de una línea de OTRO grupo -> 404 (nunca la borra)');
    check(TABLAS.hipismo_winners.some(w => w.id === idParaEditar), '12c) La línea de PEDRO sigue existiendo (el intento de otro grupo no la tocó)');
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron.`);
  process.exit(fallaron > 0 ? 1 : 0);
}

main();
