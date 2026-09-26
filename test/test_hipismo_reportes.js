// =================================================================
// PRUEBA: "Montos Apostados", "Comisiones Devueltas" y "Eliminar Planos"
// (23-09-2026, duodécima ronda, a pedido del usuario) — ver las notas
// grandes en routes/hipismo.js (obtenerApuestasDelDia,
// agregarPorcentajeDevuelto) y en services/hipismoPlanosPapelera.js.
// Mismo patrón de base de datos falsa en memoria que
// test_hipismo_adelantadas.js (Module._load intercepta "pg"/"express"
// antes de requerir el router real).
//
// Casos cubiertos:
//   1. GET /montos-apostados?fecha=: suma lo apostado por cada cliente en
//      la fecha elegida, juntando los 3 tipos de jugada de Hipismo
//      (Tercios, Remate, Jugadas Adelantadas) — ordenado alfabéticamente,
//      con el detalle completo de cada línea.
//   2. GET /comisiones-devueltas?fecha=: mismo universo de apuestas, pero
//      solo para clientes con % propio configurado (jugadores.
//      comision_propia) — el % se calcula SIEMPRE sobre el monto
//      apostado de cada línea (gane o pierda), agrupado por hipódromo >
//      carrera. Un cliente sin % configurado no aparece en el reporte.
//   3. DELETE /planos/:id: mueve el plano (y sus tickets) a la Papelera y
//      lo borra de las tablas en vivo (simulando el ON DELETE CASCADE de
//      hipismo_tickets que declara schema.sql); un id que no existe
//      responde 404.
//   4. GET /planos/papelera: lista lo eliminado, con la cantidad de
//      tickets y los días restantes hasta la purga automática (30 días).
//   5. POST /planos/papelera/:id/restaurar: reinserta el plano y sus
//      tickets con sus ids originales; restaurar la MISMA entrada una
//      segunda vez responde 400.
//   6. Una entrada de la Papelera con más de 30 días se purga sola (ya no
//      aparece, y desaparece de la tabla) la próxima vez que se consulta
//      GET /planos/papelera.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-reportes-1';
const FECHA = '2026-09-20';
const FECHA2 = '2026-09-21';
const FECHA3 = '2026-09-22'; // duodécima-tercera ronda: plano-3/4, para no interferir con las pruebas de Montos Apostados/Comisiones Devueltas que filtran por FECHA/FECHA2.

const TABLAS = {
  jugadores: [
    { id: 'jug-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', comision_propia: 1, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' },
    { id: 'jug-maria', grupo_id: GRUPO_ID, nombre: 'MARIA', comision_propia: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' },
    // Aval de PEDRO (duodécima-tercera ronda, #63) — se activa a mitad de
    // la prueba, ver más abajo.
    { id: 'jug-aval-pedro', grupo_id: GRUPO_ID, nombre: 'AVAL DE PEDRO', comision_propia: 0, avalado_por_id: null, porcentaje_devuelto_destino: 'cliente' }
  ],
  hipismo_planos: [
    { id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 1, fecha: FECHA, ret: null, pizarra: '5.3.1', cruza_jugadas: false, texto_original: 'x1', texto_resultado: 'y1', comision_total: 2.5, creado_en: Date.now() },
    { id: 'plano-2', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 5, fecha: FECHA2, ret: null, pizarra: '1.2.3', cruza_jugadas: false, texto_original: 'x2', texto_resultado: 'y2', comision_total: 5, creado_en: Date.now() },
    // plano-3/4 (duodécima-tercera ronda): fixtures para PUT
    // /planos/:id/tickets/:ticketId — ver la nota grande de esa ruta en
    // routes/hipismo.js. plano-3 NO tiene "PARADA ADELANTADAS" en su
    // texto (se regenera al editar); plano-4 SÍ lo tiene (se deja tal
    // cual, a propósito, ver esa misma nota).
    { id: 'plano-3', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 7, fecha: FECHA3, ret: '5:00', pizarra: '2.5.1', cruza_jugadas: false, texto_original: 'x3', texto_resultado: 'texto viejo plano-3', comision_total: 4, creado_en: Date.now() },
    { id: 'plano-4', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 8, fecha: FECHA3, ret: null, pizarra: '2.5.1', cruza_jugadas: false, texto_original: 'x4', texto_resultado: 'algo\n------------------------------\nPARADA ADELANTADAS\n✅ *GANAN*\nJose +10\n------------------------------\n------------------------------\nPLANO REFERENCIAL', comision_total: 2, creado_en: Date.now() }
  ],
  hipismo_tickets: [
    { id: 'ticket-pedro-1', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', banquero_nombre: 'FLACO', modalidad: '1P', caballo: '(5)', monto: 100, resultado_jugador: -100, resultado_banquero: 97.5, creado_en: Date.now() },
    { id: 'ticket-maria-1', plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'MARIA', banquero_nombre: 'FLACO', modalidad: '2P', caballo: '(3)', monto: 40, resultado_jugador: -40, resultado_banquero: 39, creado_en: Date.now() },
    { id: 'ticket-carlos-1', plano_id: 'plano-2', grupo_id: GRUPO_ID, cliente_nombre: 'CARLOS', banquero_nombre: 'FLACO', modalidad: '1P', caballo: '(2)', monto: 20, resultado_jugador: -20, resultado_banquero: 19.5, creado_en: Date.now() },
    // plano-3: pizarra "2.5.1" -> rank(2)=1, rank(5)=2, rank(1)=3.
    // ticket-a: 1P (2) -> gana (2 llegó 1ro). ticket-b: 2P (9) -> pierde
    // (9 no colocó). Los dos con CARLOS2 de jugador, para que el cambio
    // de UN ticket también se note en el total agregado de CARLOS2.
    { id: 'ticket-a', plano_id: 'plano-3', grupo_id: GRUPO_ID, cliente_nombre: 'CARLOS2', banquero_nombre: 'BANCO1', modalidad: '1p', caballo: '2', monto: 50, resultado_jugador: 47.5, resultado_banquero: -50, creado_en: 1000 },
    { id: 'ticket-b', plano_id: 'plano-3', grupo_id: GRUPO_ID, cliente_nombre: 'CARLOS2', banquero_nombre: 'BANCO2', modalidad: '2p', caballo: '9', monto: 30, resultado_jugador: -30, resultado_banquero: 28.5, creado_en: 2000 },
    { id: 'ticket-c', plano_id: 'plano-4', grupo_id: GRUPO_ID, cliente_nombre: 'PEPE', banquero_nombre: 'BANCO3', modalidad: '1p', caballo: '2', monto: 10, resultado_jugador: 9.5, resultado_banquero: -10, creado_en: 3000 }
  ],
  hipismo_remates: [
    { id: 'remate-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', carrera_numero: 2, fecha: FECHA }
  ],
  hipismo_remate_apuestas: [
    { id: 'ra-1', grupo_id: GRUPO_ID, remate_id: 'remate-1', cliente_nombre: 'PEDRO', caballo: '(7)', monto: 30 }
  ],
  hipismo_adelantadas_planos: [
    { id: 'adplano-1', grupo_id: GRUPO_ID, hipodromo_nombre: 'La Rinconada', fecha: FECHA }
  ],
  hipismo_adelantadas_jugadas: [
    { id: 'adj-1', plano_id: 'adplano-1', grupo_id: GRUPO_ID, cliente_nombre: 'PEDRO', tipo: 'tf', monto: 50, numero_ejemplar: 5, numero1: null, numero2: null, carrera_numero: 3 }
  ],
  hipismo_planos_papelera: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

  // ---- obtenerApuestasDelDia (Montos Apostados / Comisiones Devueltas /
  // Traspaso de Jugadas — duodécima-tercera ronda: ahora también trae
  // t.id/a.id/j.id, para poder targetear la fila exacta al traspasar). ----
  if (/^SELECT t\.id, t\.cliente_nombre, t\.modalidad, t\.caballo, t\.monto, p\.hipodromo_nombre, p\.carrera_numero\s+FROM hipismo_tickets t JOIN hipismo_planos p ON p\.id = t\.plano_id\s+WHERE t\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId)
      .map(t => ({ t, p: TABLAS.hipismo_planos.find(pl => pl.id === t.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ t, p }) => ({ id: t.id, cliente_nombre: t.cliente_nombre, modalidad: t.modalidad, caballo: t.caballo, monto: t.monto, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: p.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT a\.id, a\.cliente_nombre, a\.caballo, a\.monto, r\.hipodromo_nombre, r\.carrera_numero\s+FROM hipismo_remate_apuestas a JOIN hipismo_remates r ON r\.id = a\.remate_id\s+WHERE a\.grupo_id = \$1 AND r\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId)
      .map(a => ({ a, r: TABLAS.hipismo_remates.find(rm => rm.id === a.remate_id) }))
      .filter(({ r }) => r && r.fecha === fecha)
      .map(({ a, r }) => ({ id: a.id, cliente_nombre: a.cliente_nombre, caballo: a.caballo, monto: a.monto, hipodromo_nombre: r.hipodromo_nombre, carrera_numero: r.carrera_numero }));
    return { rows: filas };
  }
  if (/^SELECT j\.id, j\.cliente_nombre, j\.tipo, j\.monto, j\.numero_ejemplar, j\.numero1, j\.numero2, j\.carrera_numero, p\.hipodromo_nombre\s+FROM hipismo_adelantadas_jugadas j JOIN hipismo_adelantadas_planos p ON p\.id = j\.plano_id\s+WHERE j\.grupo_id = \$1 AND p\.fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId)
      .map(j => ({ j, p: TABLAS.hipismo_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
      .filter(({ p }) => p && p.fecha === fecha)
      .map(({ j, p }) => ({ id: j.id, cliente_nombre: j.cliente_nombre, tipo: j.tipo, monto: j.monto, numero_ejemplar: j.numero_ejemplar, numero1: j.numero1, numero2: j.numero2, carrera_numero: j.carrera_numero, hipodromo_nombre: p.hipodromo_nombre }));
    return { rows: filas };
  }
  if (/^SELECT j\.nombre, j\.comision_propia, j\.porcentaje_devuelto_destino, j\.porcentaje_devuelto_aval, av\.nombre AS aval_nombre,\s+cc_propio\.nombre AS cc_propio_nombre, cc_aval\.nombre AS cc_aval_nombre\s+FROM jugadores j\s+LEFT JOIN jugadores av ON av\.id = j\.avalado_por_id\s+LEFT JOIN jugadores cc_propio ON cc_propio\.id = j\.cuenta_comision_id\s+LEFT JOIN jugadores cc_aval ON cc_aval\.id = av\.cuenta_comision_id\s+WHERE j\.grupo_id = \$1 AND j\.nombre = ANY/i.test(sql)) {
    const [grupoId, nombres] = params;
    const filas = TABLAS.jugadores.filter(j => j.grupo_id === grupoId && nombres.includes(j.nombre));
    return {
      rows: filas.map(j => ({
        nombre: j.nombre, comision_propia: j.comision_propia || 0,
        porcentaje_devuelto_destino: j.porcentaje_devuelto_destino || 'cliente',
        porcentaje_devuelto_aval: j.porcentaje_devuelto_aval || 0,
        aval_nombre: j.avalado_por_id ? ((TABLAS.jugadores.find(x => x.id === j.avalado_por_id) || {}).nombre || null) : null,
        cc_propio_nombre: null,
        cc_aval_nombre: null
      }))
    };
  }

  // ---- "Eliminar Planos" — GET /planos/dias (23-09-2026, duodécima-
  // tercera ronda, rediseño: "al entrar alli vere ordenado por dia"). ----
  if (/^SELECT fecha, COUNT\(\*\)::int AS cantidad\s+FROM hipismo_planos\s+WHERE grupo_id = \$1\s+GROUP BY fecha\s+ORDER BY fecha DESC\s+LIMIT 120$/i.test(sql)) {
    const [grupoId] = params;
    const porFecha = new Map();
    TABLAS.hipismo_planos.filter(p => p.grupo_id === grupoId).forEach(p => {
      porFecha.set(p.fecha, (porFecha.get(p.fecha) || 0) + 1);
    });
    const filas = Array.from(porFecha.entries())
      .map(([fecha, cantidad]) => ({ fecha, cantidad }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    return { rows: filas };
  }

  // ---- "Eliminar Planos" / Papelera (services/hipismoPlanosPapelera.js) ----
  if (/^SELECT \* FROM hipismo_planos WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    const plano = TABLAS.hipismo_planos.find(p => p.id === id && p.grupo_id === grupoId);
    return { rows: plano ? [plano] : [] };
  }
  if (/^SELECT \* FROM hipismo_tickets WHERE plano_id = \$1/i.test(sql)) {
    const [planoId] = params;
    return { rows: TABLAS.hipismo_tickets.filter(t => t.plano_id === planoId) };
  }
  if (/^INSERT INTO hipismo_planos_papelera \(grupo_id, fecha, hipodromo_nombre, carrera_numero, plano_json, tickets_json\)/i.test(sql)) {
    const [grupoId, fecha, hipodromoNombre, carreraNumero, planoJson, ticketsJson] = params;
    const id = 'pap-' + (TABLAS.hipismo_planos_papelera.length + 1);
    TABLAS.hipismo_planos_papelera.push({
      id, grupo_id: grupoId, fecha, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero,
      plano_json: JSON.parse(planoJson), tickets_json: JSON.parse(ticketsJson),
      eliminado_en: new Date().toISOString(), restaurado_en: null
    });
    return { rows: [{ id }] };
  }
  if (/^DELETE FROM hipismo_planos WHERE id = \$1 AND grupo_id = \$2$/i.test(sql)) {
    const [id, grupoId] = params;
    // Simula el ON DELETE CASCADE declarado en schema.sql para hipismo_tickets.plano_id.
    TABLAS.hipismo_tickets = TABLAS.hipismo_tickets.filter(t => t.plano_id !== id);
    TABLAS.hipismo_planos = TABLAS.hipismo_planos.filter(p => !(p.id === id && p.grupo_id === grupoId));
    return { rows: [] };
  }
  if (/^DELETE FROM hipismo_planos_papelera WHERE grupo_id = \$1 AND eliminado_en < now\(\) - interval '30 days'/i.test(sql)) {
    const [grupoId] = params;
    const cortePurga = Date.now() - 30 * 24 * 60 * 60 * 1000;
    TABLAS.hipismo_planos_papelera = TABLAS.hipismo_planos_papelera.filter(p => !(p.grupo_id === grupoId && new Date(p.eliminado_en).getTime() < cortePurga));
    return { rows: [] };
  }
  if (/^SELECT id, fecha, hipodromo_nombre, carrera_numero, plano_json, tickets_json, eliminado_en, restaurado_en\s+FROM hipismo_planos_papelera WHERE grupo_id = \$1 ORDER BY eliminado_en DESC/i.test(sql)) {
    const [grupoId] = params;
    return { rows: TABLAS.hipismo_planos_papelera.filter(p => p.grupo_id === grupoId).sort((a, b) => (a.eliminado_en < b.eliminado_en ? 1 : -1)) };
  }
  if (/^SELECT id, plano_json, tickets_json, restaurado_en FROM hipismo_planos_papelera WHERE grupo_id = \$1 AND id = \$2/i.test(sql)) {
    const [grupoId, id] = params;
    const fila = TABLAS.hipismo_planos_papelera.find(p => p.grupo_id === grupoId && p.id === id);
    return { rows: fila ? [fila] : [] };
  }
  if (/^INSERT INTO hipismo_planos \(id, grupo_id, hipodromo_id, hipodromo_nombre, carrera_numero, fecha, ret, pizarra, cruza_jugadas, texto_original, texto_resultado, comision_total, creado_en\)/i.test(sql)) {
    const [id, grupoId, hipodromoId, hipodromoNombre, carreraNumero, fecha, ret, pizarra, cruzaJugadas, textoOriginal, textoResultado, comisionTotal, creadoEn] = params;
    if (!TABLAS.hipismo_planos.find(p => p.id === id)) {
      TABLAS.hipismo_planos.push({ id, grupo_id: grupoId, hipodromo_id: hipodromoId, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero, fecha, ret, pizarra, cruza_jugadas: cruzaJugadas, texto_original: textoOriginal, texto_resultado: textoResultado, comision_total: comisionTotal, creado_en: creadoEn });
    }
    return { rows: [] };
  }
  if (/^INSERT INTO hipismo_tickets \(id, plano_id, grupo_id, cliente_nombre, banquero_nombre, modalidad, caballo, monto, resultado_jugador, resultado_banquero, creado_en\)/i.test(sql)) {
    const [id, planoId, grupoId, cliente, banquero, modalidad, caballo, monto, resultadoJugador, resultadoBanquero, creadoEn] = params;
    if (!TABLAS.hipismo_tickets.find(t => t.id === id)) {
      TABLAS.hipismo_tickets.push({ id, plano_id: planoId, grupo_id: grupoId, cliente_nombre: cliente, banquero_nombre: banquero, modalidad, caballo, monto, resultado_jugador: resultadoJugador, resultado_banquero: resultadoBanquero, creado_en: creadoEn });
    }
    return { rows: [] };
  }
  if (/^UPDATE hipismo_planos_papelera SET restaurado_en = now\(\) WHERE id = \$1/i.test(sql)) {
    const [id] = params;
    const fila = TABLAS.hipismo_planos_papelera.find(p => p.id === id);
    if (fila) fila.restaurado_en = new Date().toISOString();
    return { rows: [] };
  }

  // ---- Alertas (duodécima-tercera ronda, registrarAlerta() en
  // routes/hipismo.js) — DELETE /planos/:id y PUT /planos/:id/tickets/:id
  // ahora generan alerta.
  if (/^INSERT INTO hipismo_alertas \(grupo_id, tipo, usuario, hipodromo_nombre, carrera_numero, fecha, mensaje\)/i.test(sql)) {
    const [grupoId, tipo, usuario, hipodromoNombre, carreraNumero, fecha, mensaje] = params;
    TABLAS.hipismo_alertas = TABLAS.hipismo_alertas || [];
    TABLAS.hipismo_alertas.push({ id: 'alerta-' + (TABLAS.hipismo_alertas.length + 1), grupo_id: grupoId, tipo, usuario, hipodromo_nombre: hipodromoNombre, carrera_numero: carreraNumero, fecha, mensaje, creado_en: new Date().toISOString() });
    return { rows: [] };
  }
  if (/^SELECT \* FROM hipismo_alertas WHERE grupo_id = \$1 ORDER BY creado_en DESC/i.test(sql)) {
    const [grupoId] = params;
    return { rows: (TABLAS.hipismo_alertas || []).filter(a => a.grupo_id === grupoId).sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1)) };
  }

  // ---- PUT /planos/:id/tickets/:ticketId (duodécima-tercera ronda) ----
  if (/^SELECT \* FROM hipismo_tickets WHERE id = \$1 AND plano_id = \$2$/i.test(sql)) {
    const [id, planoId] = params;
    const t = TABLAS.hipismo_tickets.find(x => x.id === id && x.plano_id === planoId);
    return { rows: t ? [t] : [] };
  }
  if (/^UPDATE hipismo_tickets SET cliente_nombre = \$1, banquero_nombre = \$2, monto = \$3, resultado_jugador = \$4, resultado_banquero = \$5\s*WHERE id = \$6 AND plano_id = \$7/i.test(sql)) {
    const [cliente, banquero, monto, resultadoJugador, resultadoBanquero, id, planoId] = params;
    const t = TABLAS.hipismo_tickets.find(x => x.id === id && x.plano_id === planoId);
    if (t) Object.assign(t, { cliente_nombre: cliente, banquero_nombre: banquero, monto, resultado_jugador: resultadoJugador, resultado_banquero: resultadoBanquero });
    return { rows: [] };
  }
  if (/^UPDATE hipismo_planos SET comision_total = \$1, texto_resultado = \$2 WHERE id = \$3$/i.test(sql)) {
    const [comisionTotal, textoResultado, id] = params;
    const p = TABLAS.hipismo_planos.find(x => x.id === id);
    if (p) { p.comision_total = comisionTotal; p.texto_resultado = textoResultado; }
    return { rows: [] };
  }
  // autoRegistrarJugadores (PUT /planos/:id/tickets/:id que cambia un
  // nombre, y POST /traspasos/jugada).
  if (/^INSERT INTO jugadores \(grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial\)/i.test(sql)) {
    const [grupoId, nombre] = params;
    if (!TABLAS.jugadores.some(j => j.grupo_id === grupoId && j.nombre === nombre)) {
      TABLAS.jugadores.push({ id: 'j-' + nombre, grupo_id: grupoId, nombre, activo: true, auto_creado: true, tipo_cuenta: 'libre', pozo_inicial: 0, comision_propia: 0 });
    }
    return { rows: [] };
  }

  // ---- POST /traspasos/jugada (duodécima-tercera ronda) ----
  const mTraspaso = sql.match(/^UPDATE (hipismo_tickets|hipismo_adelantadas_jugadas) SET cliente_nombre = \$1 WHERE id = \$2 AND grupo_id = \$3 RETURNING \*$/i);
  if (mTraspaso) {
    const tabla = mTraspaso[1];
    const [clienteNuevo, id, grupoId] = params;
    const clave = tabla === 'hipismo_tickets' ? 'hipismo_tickets' : 'hipismo_adelantadas_jugadas';
    const fila = TABLAS[clave].find(x => x.id === id && x.grupo_id === grupoId);
    if (!fila) return { rows: [] };
    fila.cliente_nombre = clienteNuevo;
    return { rows: [fila] };
  }

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
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
  if (!entrada) throw new Error('No se encontró la ruta ' + metodo.toUpperCase() + ' ' + rutaPath);
  return entrada[1][entrada[1].length - 1];
}
const handlerMontosApostados = handlerDe('get', '/montos-apostados');
const handlerComisionesDevueltas = handlerDe('get', '/comisiones-devueltas');
const handlerPlanosDias = handlerDe('get', '/planos/dias');
const handlerPlanosPapelera = handlerDe('get', '/planos/papelera');
const handlerPlanoEliminar = handlerDe('delete', '/planos/:id');
const handlerPlanoRestaurar = handlerDe('post', '/planos/papelera/:id/restaurar');
const handlerPlanoTicketEditar = handlerDe('put', '/planos/:id/tickets/:ticketId');
const handlerAlertas = handlerDe('get', '/alertas');
const handlerTraspasosJugadas = handlerDe('get', '/traspasos/jugadas');
const handlerTraspasoJugada = handlerDe('post', '/traspasos/jugada');

function invocarRuta(handler, req, paramsExtra) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    if (paramsExtra) req.params = paramsExtra;
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

function reqBase(grupoId) {
  return { grupoId, grupo: { nombre: 'Zenyatta' }, nombreActor: 'Zenyatta', params: {}, query: {} };
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) GET /montos-apostados ---
  const resMontos = await invocarRuta(handlerMontosApostados, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(resMontos._status === 200, '1) GET /montos-apostados responde 200');
  check(resMontos._json.fecha === FECHA, 'Devuelve la fecha consultada');
  check(resMontos._json.clientes.length === 2, 'Trae a los 2 clientes que apostaron ese día (PEDRO y MARIA)');
  check(resMontos._json.clientes[0].nombre === 'MARIA', 'Ordenado alfabéticamente: MARIA primero');
  check(resMontos._json.clientes[1].nombre === 'PEDRO', 'PEDRO segundo');
  const pedroMontos = resMontos._json.clientes.find(c => c.nombre === 'PEDRO');
  check(pedroMontos.total === 180, 'PEDRO apostó 180 en total (100 Tercios + 30 Remate + 50 Tabla Fija)');
  check(pedroMontos.detalle.length === 3, 'El detalle de PEDRO trae sus 3 líneas (una por tipo de jugada)');
  check(pedroMontos.detalle.some(d => d.tipo === 'tercios' && d.monto === 100 && d.carreraNumero === 1), 'El detalle incluye su línea de Tercios (carrera 1, 100)');
  check(pedroMontos.detalle.some(d => d.tipo === 'remate' && d.monto === 30 && d.carreraNumero === 2), 'El detalle incluye su línea de Remate (carrera 2, 30)');
  check(pedroMontos.detalle.some(d => d.tipo === 'tabla_fija' && d.monto === 50 && d.carreraNumero === 3), 'El detalle incluye su línea de Tabla Fija (carrera 3, 50)');
  const mariaMontos = resMontos._json.clientes.find(c => c.nombre === 'MARIA');
  check(mariaMontos.total === 40, 'MARIA apostó 40 en total (solo Tercios)');

  // Una fecha sin ninguna jugada -> lista vacía, no un error.
  const resMontosVacio = await invocarRuta(handlerMontosApostados, Object.assign(reqBase(GRUPO_ID), { query: { fecha: '2026-01-01' } }));
  check(resMontosVacio._status === 200 && resMontosVacio._json.clientes.length === 0, 'Una fecha sin jugadas responde 200 con la lista de clientes vacía');

  // --- 2) GET /comisiones-devueltas ---
  const resDevueltas = await invocarRuta(handlerComisionesDevueltas, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  check(resDevueltas._status === 200, '2) GET /comisiones-devueltas responde 200');
  check(resDevueltas._json.clientes.length === 1, 'Solo aparece PEDRO (MARIA no tiene % propio configurado)');
  const pedroDevuelto = resDevueltas._json.clientes[0];
  check(pedroDevuelto.nombre === 'PEDRO' && pedroDevuelto.porcentaje === 1, 'Trae a PEDRO con su 1% configurado');
  check(pedroDevuelto.total === 1.8, 'PEDRO se devuelve 1,8 en total (1% de 180 apostado, sumado línea a línea)');
  check(pedroDevuelto.hipodromos.length === 1 && pedroDevuelto.hipodromos[0].nombre === 'La Rinconada', 'Agrupado por hipódromo: solo "La Rinconada"');
  check(pedroDevuelto.hipodromos[0].total === 1.8, 'El total de "La Rinconada" es 1,8 (las 3 líneas son de ese mismo hipódromo)');
  check(pedroDevuelto.hipodromos[0].carreras.length === 3, 'Trae las 3 carreras (1, 2 y 3), carrera a carrera');
  check(pedroDevuelto.hipodromos[0].carreras.some(c => c.carreraNumero === 1 && c.devuelto === 1), 'Carrera 1 (Tercios, 100 apostado): devuelto 1');
  check(pedroDevuelto.hipodromos[0].carreras.some(c => c.carreraNumero === 2 && c.devuelto === 0.3), 'Carrera 2 (Remate, 30 apostado): devuelto 0,3');
  check(pedroDevuelto.hipodromos[0].carreras.some(c => c.carreraNumero === 3 && c.devuelto === 0.5), 'Carrera 3 (Tabla Fija, 50 apostado): devuelto 0,5');
  check(pedroDevuelto.destino === 'PEDRO', 'Sin aval configurado, "destino" es el propio cliente');

  // --- 2b) Redirección al AVAL (23-09-2026, #63, a pedido del usuario:
  // "si el porcentaje que se le devuelve no es para el si no para su
  // aval") — se activa el aval de PEDRO y se repite la misma consulta:
  // el monto/porcentaje NO cambian, pero el ítem se acredita al aval. ---
  TABLAS.jugadores.find(j => j.nombre === 'PEDRO').avalado_por_id = 'jug-aval-pedro';
  TABLAS.jugadores.find(j => j.nombre === 'PEDRO').porcentaje_devuelto_destino = 'aval';
  const resDevueltasConAval = await invocarRuta(handlerComisionesDevueltas, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  const pedroConAval = resDevueltasConAval._json.clientes[0];
  check(pedroConAval.nombre === 'PEDRO', '2b) El reporte SIGUE agrupado por quién apostó (PEDRO), no por el aval — para poder auditar "quién generó cuánto"');
  check(pedroConAval.total === 1.8 && pedroConAval.porcentaje === 1, 'El monto y el % no cambian (misma fórmula de siempre)');
  check(pedroConAval.destino === 'AVAL DE PEDRO', 'Pero ahora "destino" apunta al aval configurado');

  // --- GET /planos/dias (23-09-2026, duodécima-tercera ronda, rediseño
  // de "Eliminar Planos": "al entrar alli vere ordenado por dia") — con
  // los 4 planos de la fixture todavía intactos (plano-1 FECHA, plano-2
  // FECHA2, plano-3 y plano-4 los 2 en FECHA3), agrupado por fecha y
  // ordenado del más nuevo al más viejo. ---
  const resPlanosDias = await invocarRuta(handlerPlanosDias, reqBase(GRUPO_ID));
  check(resPlanosDias._status === 200, 'GET /api/hipismo/planos/dias responde 200');
  check(JSON.stringify(resPlanosDias._json) === JSON.stringify([
    { fecha: FECHA3, cantidad: 2 },
    { fecha: FECHA2, cantidad: 1 },
    { fecha: FECHA, cantidad: 1 }
  ]), 'GET /planos/dias agrupa por fecha (FECHA3 con 2 planos) y ordena del más nuevo al más viejo');

  // --- 3, 4) DELETE /planos/:id (Papelera) ---
  const resPapeleraAntes = await invocarRuta(handlerPlanosPapelera, reqBase(GRUPO_ID));
  check(resPapeleraAntes._json.length === 0, '3) La Papelera empieza vacía');

  const resEliminarNoExiste = await invocarRuta(handlerPlanoEliminar, reqBase(GRUPO_ID), { id: 'plano-que-no-existe' });
  check(resEliminarNoExiste._status === 404, 'DELETE /planos/:id con un id que no existe responde 404');

  const resEliminar = await invocarRuta(handlerPlanoEliminar, reqBase(GRUPO_ID), { id: 'plano-2' });
  check(resEliminar._status === 200 && resEliminar._json.ok === true, 'DELETE /planos/:id elimina el plano-2 (200)');
  check(resEliminar._json.hipodromoNombre === 'La Rinconada' && resEliminar._json.carreraNumero === 5, 'Devuelve el hipódromo y la carrera del plano eliminado');
  check(!TABLAS.hipismo_planos.find(p => p.id === 'plano-2'), 'El plano-2 ya no está en la tabla en vivo');
  check(!TABLAS.hipismo_tickets.find(t => t.id === 'ticket-carlos-1'), 'Su ticket (CARLOS) tampoco sigue en la tabla en vivo (cascada)');
  check(TABLAS.hipismo_planos.find(p => p.id === 'plano-1'), 'El plano-1 (NO tocado) sigue intacto');

  // --- 4) GET /planos/papelera ---
  const resPapeleraDespues = await invocarRuta(handlerPlanosPapelera, reqBase(GRUPO_ID));
  check(resPapeleraDespues._json.length === 1, 'La Papelera ahora lista 1 entrada');
  const entradaPapelera = resPapeleraDespues._json[0];
  check(entradaPapelera.hipodromoNombre === 'La Rinconada' && entradaPapelera.carreraNumero === 5, 'La entrada trae el hipódromo/carrera correctos');
  check(entradaPapelera.cantidadTickets === 1, 'La entrada trae la cantidad correcta de tickets guardados (1, el de CARLOS)');
  check(entradaPapelera.diasRestantes === 30, 'Recién eliminada, quedan los 30 días completos para restaurar');
  check(entradaPapelera.restaurado === false, 'Todavía no se restauró');
  const papeleraId = entradaPapelera.id;

  // --- 5) POST /planos/papelera/:id/restaurar ---
  const resRestaurar = await invocarRuta(handlerPlanoRestaurar, reqBase(GRUPO_ID), { id: papeleraId });
  check(resRestaurar._status === 200 && resRestaurar._json.ok === true, 'POST /planos/papelera/:id/restaurar responde 200');
  check(TABLAS.hipismo_planos.find(p => p.id === 'plano-2'), 'El plano-2 volvió a la tabla en vivo');
  check(TABLAS.hipismo_tickets.find(t => t.id === 'ticket-carlos-1'), 'Su ticket (CARLOS) también volvió, con el mismo id original');

  const resRestaurarOtraVez = await invocarRuta(handlerPlanoRestaurar, reqBase(GRUPO_ID), { id: papeleraId });
  check(resRestaurarOtraVez._status === 400, 'Restaurar la misma entrada una 2da vez responde 400 (ya se había restaurado)');

  const resRestaurarNoExiste = await invocarRuta(handlerPlanoRestaurar, reqBase(GRUPO_ID), { id: 'pap-no-existe' });
  check(resRestaurarNoExiste._status === 404, 'Restaurar una entrada de Papelera que no existe responde 404');

  // --- 6) Purga automática de entradas de más de 30 días ---
  TABLAS.hipismo_planos_papelera.push({
    id: 'pap-vieja', grupo_id: GRUPO_ID, fecha: '2026-01-01', hipodromo_nombre: 'La Rinconada', carrera_numero: 9,
    plano_json: { comision_total: 0 }, tickets_json: [],
    eliminado_en: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), // 40 días atrás
    restaurado_en: null
  });
  const resPapeleraConVieja = await invocarRuta(handlerPlanosPapelera, reqBase(GRUPO_ID));
  check(!resPapeleraConVieja._json.find(p => p.id === 'pap-vieja'), 'Una entrada de más de 30 días se purga sola y ya no aparece en GET /planos/papelera');
  check(!TABLAS.hipismo_planos_papelera.find(p => p.id === 'pap-vieja'), 'La entrada vieja también desapareció de la tabla (purga real, no solo un filtro visual)');

  // =================================================================
  // 7) PUT /planos/:id/tickets/:ticketId (duodécima-tercera ronda, a
  // pedido del usuario: "en editar realizare cambios de montos o de
  // jugador... eso me editara el plano anterior de esa carrera"). Ver la
  // nota grande de la ruta en routes/hipismo.js y de
  // recalcularTicket()/recalcularTotalesPlano() en hipismoCalc.js.
  // =================================================================
  const resEditarTicket = await invocarRuta(handlerPlanoTicketEditar, Object.assign(reqBase(GRUPO_ID), { body: { monto: 200 } }), { id: 'plano-3', ticketId: 'ticket-a' });
  check(resEditarTicket._status === 200, '7) PUT /planos/:id/tickets/:ticketId edita el ticket-a de plano-3 (200)');
  const ticketAEditado = resEditarTicket._json.tickets.find(t => t.id === 'ticket-a');
  check(Number(ticketAEditado.monto) === 200, 'El monto del ticket queda en 200');
  check(Number(ticketAEditado.resultado_jugador) === 190, 'Recalculado con la misma pizarra (2 sigue en 1er lugar): 200 × 0,95 = 190');
  check(Number(ticketAEditado.resultado_banquero) === -200, 'El banquero pierde el monto nuevo completo (-200)');
  check(resEditarTicket._json.totalesFinales.CARLOS2 === 160, 'El total de CARLOS2 (que tiene 2 tickets en este plano) se recompuso: 190 (ticket-a nuevo) + -30 (ticket-b, sin tocar) = 160');
  check(resEditarTicket._json.totalesFinales.BANCO1 === -200, 'BANCO1 (banquero del ticket editado) queda en -200');
  check(resEditarTicket._json.totalesFinales.BANCO2 === 28.5, 'BANCO2 (banquero del OTRO ticket, sin tocar) sigue en 28,5');
  check(resEditarTicket._json.plano.comision_total === 11.5, 'La comisión total del plano se recompuso: 10 (ticket-a nuevo) + 1,5 (ticket-b, sin tocar) = 11,5');
  check(TABLAS.hipismo_planos.find(p => p.id === 'plano-3').comision_total === 11.5, 'La comisión nueva queda guardada de verdad en hipismo_planos');
  check(resEditarTicket._json.plano.texto_resultado !== 'texto viejo plano-3', 'texto_resultado se REGENERA (este plano no tenía "PARADA ADELANTADAS")');
  check(resEditarTicket._json.plano.texto_resultado.includes('Total Jugadas: 2'), 'El texto regenerado además ya trae la línea "Total Jugadas: 2" (ver #58, armarTextoResultado)');
  check(TABLAS.hipismo_alertas.some(a => a.tipo === 'PLANO_EDITADO' && a.hipodromo_nombre === 'La Rinconada' && a.carrera_numero === 7), 'Se generó la alerta "PLANO_EDITADO" con el hipódromo/carrera correctos');

  // --- Editar también el CLIENTE de un ticket -> autoRegistrarJugadores ---
  const resEditarCliente = await invocarRuta(handlerPlanoTicketEditar, Object.assign(reqBase(GRUPO_ID), { body: { clienteNombre: 'CARLOS NUEVO' } }), { id: 'plano-3', ticketId: 'ticket-b' });
  check(resEditarCliente._status === 200, 'PUT también permite editar solo el nombre del cliente (200)');
  check(TABLAS.hipismo_tickets.find(t => t.id === 'ticket-b').cliente_nombre === 'CARLOS NUEVO', 'El ticket-b queda con el nuevo nombre');
  check(TABLAS.jugadores.some(j => j.nombre === 'CARLOS NUEVO'), 'El nuevo nombre queda auto-registrado en jugadores');

  // --- Un plano con "PARADA ADELANTADAS" en su texto NO se regenera ---
  const textoViejoPlano4 = TABLAS.hipismo_planos.find(p => p.id === 'plano-4').texto_resultado;
  const resEditarConAdelantadas = await invocarRuta(handlerPlanoTicketEditar, Object.assign(reqBase(GRUPO_ID), { body: { monto: 999 } }), { id: 'plano-4', ticketId: 'ticket-c' });
  check(resEditarConAdelantadas._status === 200, 'PUT en un plano con "PARADA ADELANTADAS" igual responde 200');
  check(Number(TABLAS.hipismo_tickets.find(t => t.id === 'ticket-c').monto) === 999, 'El ticket SÍ se actualiza (el monto real cambia)');
  check(TABLAS.hipismo_planos.find(p => p.id === 'plano-4').texto_resultado === textoViejoPlano4, 'Pero texto_resultado se deja TAL CUAL (no se arriesga a mezclarlo mal con el bloque de adelantadas)');
  check(TABLAS.hipismo_planos.find(p => p.id === 'plano-4').comision_total === 49.95, 'La comisión SÍ se recalculó igual (49,95 = 5% de 999), aunque el texto no se tocara (todo lo que alimenta los reportes queda correcto en los 2 casos)');

  // --- 404: plano y ticket que no existen ---
  const resEditarPlanoNoExiste = await invocarRuta(handlerPlanoTicketEditar, Object.assign(reqBase(GRUPO_ID), { body: { monto: 10 } }), { id: 'plano-no-existe', ticketId: 'ticket-a' });
  check(resEditarPlanoNoExiste._status === 404, 'PUT sobre un plano que no existe responde 404');
  const resEditarTicketNoExiste = await invocarRuta(handlerPlanoTicketEditar, Object.assign(reqBase(GRUPO_ID), { body: { monto: 10 } }), { id: 'plano-3', ticketId: 'ticket-no-existe' });
  check(resEditarTicketNoExiste._status === 404, 'PUT sobre un ticket que no pertenece a ese plano responde 404');

  // =================================================================
  // 8) GET /alertas (duodécima-tercera ronda, nueva pestaña Alertas bajo
  // Administración) — lista lo que ya generaron las pruebas de arriba
  // (el DELETE /planos/:id de la sección 3-4 y los PUT de la 7).
  // =================================================================
  const resAlertas = await invocarRuta(handlerAlertas, reqBase(GRUPO_ID));
  check(resAlertas._status === 200 && Array.isArray(resAlertas._json), '8) GET /alertas responde 200 con un arreglo');
  check(resAlertas._json.length >= 4, 'Trae todas las alertas generadas hasta ahora (1 PLANO_ELIMINADO + 3 PLANO_EDITADO)');
  check(resAlertas._json.every(a => a.usuario === 'Zenyatta'), 'Todas quedan con el usuario que las generó');
  check(resAlertas._json.some(a => a.tipo === 'PLANO_ELIMINADO'), 'Incluye la alerta del borrado de plano-2 (sección 3-4)');

  // =================================================================
  // 9) Traspaso de Jugadas (duodécima-tercera ronda — rediseño: fecha >
  // cliente > hipódromo > jugada > nuevo cliente). PEDRO tiene 3 líneas
  // el día FECHA: Tercios (plano-1), Remate (fuera de alcance) y Tabla
  // Fija (adelantadas). Solo las 2 primeras (Tercios + Adelantadas)
  // deben poder traspasarse.
  // =================================================================
  const resTraspasoLista = await invocarRuta(handlerTraspasosJugadas, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA, cliente: 'PEDRO' } }));
  check(resTraspasoLista._status === 200, '9) GET /traspasos/jugadas responde 200');
  const todasLasJugadas = resTraspasoLista._json.hipodromos.flatMap(h => h.jugadas);
  check(todasLasJugadas.length === 2, 'Solo trae las 2 jugadas traspasables de PEDRO ese día (Tercios + Tabla Fija) — el Remate queda afuera a propósito');
  check(!todasLasJugadas.some(j => j.tipo === 'remate'), 'Ninguna jugada de tipo "remate" aparece en la lista');
  check(resTraspasoLista._json.hipodromos[0].nombre === 'La Rinconada', 'Agrupado por hipódromo');
  const jugadaTercios = todasLasJugadas.find(j => j.tipo === 'tercios');
  check(jugadaTercios.id === 'ticket-pedro-1' && jugadaTercios.tabla === 'hipismo_tickets', 'La jugada de Tercios trae su id real y la tabla de origen, listos para el traspaso');

  const resTraspasoFalta = await invocarRuta(handlerTraspasosJugadas, Object.assign(reqBase(GRUPO_ID), { query: {} }));
  check(resTraspasoFalta._status === 400, 'Sin fecha y/o cliente, responde 400');

  // --- Traspasar la jugada de Tercios de PEDRO a MARIA ---
  const resTraspaso = await invocarRuta(handlerTraspasoJugada, Object.assign(reqBase(GRUPO_ID), { body: { tabla: 'hipismo_tickets', id: 'ticket-pedro-1', clienteNuevo: 'MARIA' } }));
  check(resTraspaso._status === 200 && resTraspaso._json.ok === true, 'POST /traspasos/jugada traspasa la jugada (200)');
  check(TABLAS.hipismo_tickets.find(t => t.id === 'ticket-pedro-1').cliente_nombre === 'MARIA', 'El ticket queda a nombre de MARIA en la base');

  // --- Se confirma que PEDRO ya no tiene rastro de esa jugada (Montos Apostados) ---
  const resMontosDespues = await invocarRuta(handlerMontosApostados, Object.assign(reqBase(GRUPO_ID), { query: { fecha: FECHA } }));
  const pedroDespues = resMontosDespues._json.clientes.find(c => c.nombre === 'PEDRO');
  check(pedroDespues.total === 80, 'PEDRO ya no tiene esos 100 de Tercios en Montos Apostados (180 - 100 = 80)');
  check(!pedroDespues.detalle.some(d => d.tipo === 'tercios'), 'Su detalle ya no trae ninguna línea de Tercios');
  const mariaDespues = resMontosDespues._json.clientes.find(c => c.nombre === 'MARIA');
  check(mariaDespues.total === 140, 'MARIA ahora la tiene sumada (40 que ya tenía + 100 traspasados = 140)');

  // --- Traspasar una Tabla Fija de PEDRO a un cliente nuevo (auto-registro) ---
  const jugadaTf = TABLAS.hipismo_adelantadas_jugadas[0];
  const resTraspasoTf = await invocarRuta(handlerTraspasoJugada, Object.assign(reqBase(GRUPO_ID), { body: { tabla: 'hipismo_adelantadas_jugadas', id: jugadaTf.id, clienteNuevo: 'JUAN NUEVO' } }));
  check(resTraspasoTf._status === 200, 'También se puede traspasar una Tabla Fija (Jugadas Adelantadas)');
  check(TABLAS.hipismo_adelantadas_jugadas[0].cliente_nombre === 'JUAN NUEVO', 'Queda a nombre del cliente nuevo');
  check(TABLAS.jugadores.some(j => j.nombre === 'JUAN NUEVO'), 'El cliente nuevo queda auto-registrado');

  // --- Validaciones ---
  const resTraspasoRemate = await invocarRuta(handlerTraspasoJugada, Object.assign(reqBase(GRUPO_ID), { body: { tabla: 'hipismo_remate_apuestas', id: 'ra-1', clienteNuevo: 'MARIA' } }));
  check(resTraspasoRemate._status === 400, 'Intentar traspasar una jugada de Remate responde 400 (fuera de alcance a propósito)');
  const resTraspasoNoExiste = await invocarRuta(handlerTraspasoJugada, Object.assign(reqBase(GRUPO_ID), { body: { tabla: 'hipismo_tickets', id: 'ticket-no-existe', clienteNuevo: 'MARIA' } }));
  check(resTraspasoNoExiste._status === 404, 'Traspasar una jugada que no existe responde 404');
  const resTraspasoSinCliente = await invocarRuta(handlerTraspasoJugada, Object.assign(reqBase(GRUPO_ID), { body: { tabla: 'hipismo_tickets', id: 'ticket-maria-1' } }));
  check(resTraspasoSinCliente._status === 400, 'Sin clienteNuevo responde 400');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
}).catch(err => {
  console.error('ERROR INESPERADO:', err);
  process.exit(1);
});
