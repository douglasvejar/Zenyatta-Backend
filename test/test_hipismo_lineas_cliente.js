// =================================================================
// PRUEBA: jugadas de Hipismo de UN cliente puntual (services/
// hipismoLineasCliente.js) ahora también incluyen sus apuestas de
// "Cargar Remate", no solo las de "Cargar Planos"/Tercios — a pedido del
// usuario, 23-09-2026: "esos totales se deben guardar en los saldos de
// los clientes, que le salga reflejado en la carrera y le indique que
// remate y cuanto".
//
// Antes de este arreglo, esta función SOLO leía hipismo_tickets — el
// saldo semanal AGREGADO de Cierre Final (GET /cierre-final en
// routes/hipismo.js) ya sumaba también hipismo_remate_apuestas desde que
// se construyó "Cargar Remate" (ver test_hipismo_remate.js), pero este
// archivo es el único lugar donde un cliente ve sus jugadas UNA POR UNA
// (con la carrera y el monto de cada una) — tanto en su propio link de
// Hipismo (routes/hipismoCliente.js) como en el link de Deportes cuando
// tiene Hipismo "anclado" (routes/cliente.js, vía textoJugadaHipismo).
//
// Mismo patrón de base de datos falsa en memoria que ya usa el resto del
// proyecto (Module._load intercepta "pg" antes de requerir src/db.js) —
// acá no hace falta interceptar "express" porque se prueba el servicio
// directamente, sin pasar por ninguna ruta.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  hipismo_tickets: [],
  hipismo_planos: [],
  hipismo_hipodromos: [],
  hipismo_remate_apuestas: [],
  hipismo_remates: [],
  hipismo_adelantadas_jugadas: [],
  hipismo_adelantadas_planos: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  // obtenerLineasHipismoCliente(): jugadas de Tercios (hipismo_tickets).
  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre))
      .map(t => {
        const plano = TABLAS.hipismo_planos.find(p => p.id === t.plano_id);
        return { t, plano };
      })
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta)
      .sort((a, b) => b.plano.fecha.localeCompare(a.plano.fecha));
    return {
      rows: filas.map(({ t, plano }) => {
        const hip = TABLAS.hipismo_hipodromos.find(h => h.id === plano.hipodromo_id);
        return {
          cliente_nombre: t.cliente_nombre, banquero_nombre: t.banquero_nombre, modalidad: t.modalidad,
          caballo: t.caballo, monto: t.monto, resultado_jugador: t.resultado_jugador, resultado_banquero: t.resultado_banquero,
          fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre, carrera_numero: plano.carrera_numero,
          pizarra: plano.pizarra, pais: hip ? hip.pais : null
        };
      })
    };
  }

  // obtenerLineasHipismoCliente(): jugadas de Remate (hipismo_remate_apuestas).
  if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId && a.cliente_nombre === nombre)
      .map(a => {
        const remate = TABLAS.hipismo_remates.find(r => r.id === a.remate_id);
        return { a, remate };
      })
      .filter(({ remate }) => remate && remate.fecha >= desde && remate.fecha <= hasta)
      .sort((a, b) => b.remate.fecha.localeCompare(a.remate.fecha));
    return {
      rows: filas.map(({ a, remate }) => {
        const hip = TABLAS.hipismo_hipodromos.find(h => h.id === remate.hipodromo_id);
        return {
          caballo: a.caballo, numero_ejemplar: a.numero_ejemplar, monto: a.monto, resultado: a.resultado,
          fecha: remate.fecha, hipodromo_nombre: remate.hipodromo_nombre, carrera_numero: remate.carrera_numero,
          pizarra: remate.pizarra, numero_ganador: remate.numero_ganador, pais: hip ? hip.pais : null
        };
      })
    };
  }

  // obtenerLineasHipismoCliente(): Jugadas Adelantadas (24-09-2026, a
  // pedido del usuario: "los que los clientes ven en su link debe
  // contener toda sus jugadas no puede faltar nada" — reportó que el
  // saldo de Balance General y el de su propio link no coincidían, y
  // esta función nunca había leído hipismo_adelantadas_jugadas).
  if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const estadosValidos = ['resuelto', 'falta_banqueo', 'sin_decidir'];
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && estadosValidos.includes(j.estado))
      .filter(j => {
        const esJugador = j.cliente_nombre === nombre;
        const esBanqueador = Array.isArray(j.banqueadores) && j.banqueadores.some(b => b.nombre === nombre);
        return esJugador || esBanqueador;
      })
      .map(j => {
        const plano = TABLAS.hipismo_adelantadas_planos.find(p => p.id === j.plano_id);
        return { j, plano };
      })
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta)
      .sort((a, b) => b.plano.fecha.localeCompare(a.plano.fecha));
    return {
      rows: filas.map(({ j, plano }) => {
        const hip = TABLAS.hipismo_hipodromos.find(h => h.id === plano.hipodromo_id);
        return {
          tipo: j.tipo, cliente_nombre: j.cliente_nombre, carrera_numero: j.carrera_numero,
          cantidad_tf: j.cantidad_tf, numero_ejemplar: j.numero_ejemplar, numero1: j.numero1, numero2: j.numero2,
          monto: j.monto, resultado_cliente: j.resultado_cliente, banqueadores: j.banqueadores, pizarra_usada: j.pizarra_usada,
          fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre, pais: hip ? hip.pais : null
        };
      })
    };
  }

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';

const { obtenerLineasHipismoCliente, textoJugadaHipismo } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoLineasCliente'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const GRUPO_ID = 'grupo-lineas-1';

  // --- Fixture: un plano de Tercios (JUNKO juega 1/2 del 6, gana) ---
  TABLAS.hipismo_planos.push({
    id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada',
    carrera_numero: 10, fecha: '2026-09-20', pizarra: '6.3.1'
  });
  TABLAS.hipismo_tickets.push({
    plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'JUNKO', banquero_nombre: 'MUJICA', modalidad: '1/2', caballo: '6',
    monto: 100, resultado_jugador: 90, resultado_banquero: -90
  });
  TABLAS.hipismo_hipodromos.push({ id: 'hip-1', pais: 'VE' });

  // --- Fixture: 2 remates de la 14ta carrera de La Rinconada — JUNKO
  // juega el caballo #2 en los 2 (gana el 1ro, pierde el 2do, mismo
  // ejemplo real que ya cubre test_hipismo_remate.js) ---
  TABLAS.hipismo_remates.push({
    id: 'remate-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada',
    carrera_numero: 14, fecha: '2026-09-21', pizarra: '2.5.1', numero_ganador: 2
  });
  TABLAS.hipismo_remate_apuestas.push({
    remate_id: 'remate-1', grupo_id: GRUPO_ID, cliente_nombre: 'JUNKO', caballo: 'MUFASA', numero_ejemplar: 2,
    monto: 40, resultado: 496
  });
  TABLAS.hipismo_remates.push({
    id: 'remate-2', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada',
    carrera_numero: 14, fecha: '2026-09-22', pizarra: '9.5.1', numero_ganador: 9
  });
  TABLAS.hipismo_remate_apuestas.push({
    remate_id: 'remate-2', grupo_id: GRUPO_ID, cliente_nombre: 'JUNKO', caballo: 'MUFASA', numero_ejemplar: 2,
    monto: 40, resultado: -40
  });

  const lineas = await obtenerLineasHipismoCliente(GRUPO_ID, 'JUNKO', '2026-09-15', '2026-09-30');

  check(lineas.length === 3, 'Trae las 3 líneas de JUNKO: 1 de Tercios + 2 de Remate (antes de este arreglo, las 2 de Remate ni existían acá)');

  const lineaTercios = lineas.find(l => l.tipo !== 'remate');
  check(!!lineaTercios && lineaTercios.resultado === 90 && lineaTercios.caballo === '6' && lineaTercios.rol === 'jugador',
    'La línea de Tercios sigue exactamente igual que antes (rol, caballo, resultado) — este arreglo no le cambió nada');

  const lineasRemate = lineas.filter(l => l.tipo === 'remate');
  check(lineasRemate.length === 2, 'Las 2 líneas de Remate llegan con tipo: "remate"');

  const remateGanado = lineasRemate.find(l => l.resultado === 496);
  check(!!remateGanado, 'El remate que ganó JUNKO trae su resultado neto correcto (496 = 536 de pago - 40 apostado)');
  check(remateGanado.ganoRemate === true, 'ganoRemate: true cuando el número de ejemplar jugado coincide con el número ganador de la carrera');
  check(remateGanado.carreraNumero === 14 && remateGanado.hipodromoNombre === 'La Rinconada' && remateGanado.pizarra === '2.5.1',
    'La línea de remate ganado trae la carrera, el hipódromo y la pizarra — pedido explícito del usuario ("que le salga reflejado en la carrera")');
  check(remateGanado.caballo === 'MUFASA' && remateGanado.numeroEjemplar === 2 && remateGanado.monto === 40,
    'La línea de remate ganado trae el caballo apostado, su número de ejemplar y el monto apostado');

  const rematePerdido = lineasRemate.find(l => l.resultado === -40);
  check(!!rematePerdido, 'El remate que perdió JUNKO (número 9 ganó, ella jugó el 2) trae su resultado neto correcto (-40, todo lo apostado)');
  check(rematePerdido.ganoRemate === false, 'ganoRemate: false cuando el número de ejemplar jugado NO coincide con el número ganador');

  const totalNeto = lineas.reduce((acc, l) => acc + l.resultado, 0);
  check(totalNeto === 546, 'La suma de las 3 líneas (90 + 496 - 40) da el saldo neto correcto de JUNKO para el rango — esto es lo que alimenta el link del cliente');

  // --- textoJugadaHipismo(): el texto que ve el cliente en su link ---
  check(textoJugadaHipismo(lineaTercios) === 'Jugó 1/2 del 6', 'textoJugadaHipismo de una línea de Tercios sigue igual que antes');
  check(textoJugadaHipismo(remateGanado) === '🏆 Remate — ganó con MUFASA', 'textoJugadaHipismo dice explícitamente "Remate" y que ganó, con el caballo — pedido del usuario ("que le indique que remate")');
  check(textoJugadaHipismo(rematePerdido) === '🏆 Remate — jugó MUFASA', 'textoJugadaHipismo de un remate perdido dice "Remate" sin decir que ganó');

  // --- Regresión: un cliente sin ningún remate sigue viendo solo sus Tercios ---
  const lineasMujica = await obtenerLineasHipismoCliente(GRUPO_ID, 'MUJICA', '2026-09-15', '2026-09-30');
  check(lineasMujica.length === 1 && lineasMujica[0].tipo !== 'remate' && lineasMujica[0].resultado === -90,
    'Regresión: un cliente sin ninguna apuesta de remate (MUJICA, solo banquero de Tercios) no se ve afectado por este arreglo');

  // --- Regresión: rango de fechas que no incluye ningún remate ---
  const lineasSoloTercios = await obtenerLineasHipismoCliente(GRUPO_ID, 'JUNKO', '2026-09-20', '2026-09-20');
  check(lineasSoloTercios.length === 1 && lineasSoloTercios[0].tipo !== 'remate',
    'Regresión: si el rango de fechas no toca ningún remate, solo trae la línea de Tercios (la consulta de remate no revienta ni trae de más)');

  // =================================================================
  // Jugadas Adelantadas (24-09-2026, a pedido del usuario: "el link de
  // hanry me da otro [saldo]... eso no puede suceder... yo no puedo
  // tener un saldo y ellos otros"). Fixture: HANRY jugó una Tabla Fija
  // ya resuelta (gana), y además banqueó la Marca de OTRO cliente (ya
  // resuelta). Una tercera adelantada de HANRY sigue 'pendiente' — no
  // debe aparecer todavía, igual que Cierre Final la excluye hasta que
  // se resuelva.
  // =================================================================
  TABLAS.hipismo_adelantadas_planos.push({
    id: 'plano-adel-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', fecha: '2026-09-24'
  });
  TABLAS.hipismo_adelantadas_jugadas.push({
    id: 'adel-1', plano_id: 'plano-adel-1', grupo_id: GRUPO_ID, cliente_nombre: 'HANRY', carrera_numero: 9,
    tipo: 'tf', cantidad_tf: 1, numero_ejemplar: 5, monto: 50, resultado_cliente: 47.5, banqueadores: null,
    pizarra_usada: '6.10.4.8.2', estado: 'resuelto'
  });
  TABLAS.hipismo_adelantadas_jugadas.push({
    id: 'adel-2', plano_id: 'plano-adel-1', grupo_id: GRUPO_ID, cliente_nombre: 'OTRO', carrera_numero: 10,
    tipo: 'marca', numero1: 6, numero2: 10, monto: 100, resultado_cliente: 190,
    banqueadores: [{ nombre: 'HANRY', porcentaje: 50, pagaComision: true, comisionPorcentaje: 5, monto: 15 }],
    pizarra_usada: '6.10.4.8.2', estado: 'resuelto'
  });
  TABLAS.hipismo_adelantadas_jugadas.push({
    id: 'adel-3', plano_id: 'plano-adel-1', grupo_id: GRUPO_ID, cliente_nombre: 'HANRY', carrera_numero: 11,
    tipo: 'tf', cantidad_tf: 1, numero_ejemplar: 3, monto: 20, resultado_cliente: null, banqueadores: null,
    pizarra_usada: null, estado: 'pendiente'
  });

  const lineasHanry = await obtenerLineasHipismoCliente(GRUPO_ID, 'HANRY', '2026-09-01', '2026-09-30');
  check(lineasHanry.length === 2, 'HANRY ve sus 2 jugadas adelantadas ya resueltas (su TF como jugador + su banqueo de la Marca de OTRO) — la pendiente no aparece');

  const lineaTf = lineasHanry.find(l => l.tipo === 'adelantada' && l.rol === 'jugador');
  check(!!lineaTf && lineaTf.resultado === 47.5 && lineaTf.subtipo === 'tf' && lineaTf.numeroEjemplar === 5,
    'La Tabla Fija de HANRY (jugador) trae tipo "adelantada", su resultado real y el número de ejemplar');
  check(lineaTf.fecha === '2026-09-24' && lineaTf.hipodromoNombre === 'La Rinconada' && lineaTf.carreraNumero === 9 && lineaTf.pizarra === '6.10.4.8.2',
    'La Tabla Fija de HANRY trae la fecha/hipódromo/carrera/pizarra reales del plano de Jugadas Adelantadas');

  const lineaBanquero = lineasHanry.find(l => l.tipo === 'adelantada' && l.rol === 'banquero');
  check(!!lineaBanquero && lineaBanquero.resultado === 15 && lineaBanquero.subtipo === 'marca' && lineaBanquero.numero1 === 6 && lineaBanquero.numero2 === 10,
    'HANRY también ve, como línea aparte, lo que ganó BANQUEANDO la Marca de OTRO cliente (mismo criterio que ya usa Cierre Final con acumular(b.nombre, b.monto))');

  const totalHanryConAdelantadas = lineasHanry.reduce((acc, l) => acc + l.resultado, 0);
  check(totalHanryConAdelantadas === 62.5, 'El saldo total de HANRY con sus adelantadas (47.5 + 15 = 62.5) es lo que ahora ve reflejado en su link, igual que en Cierre Final/Balance General');

  check(textoJugadaHipismo(lineaTf) === '🕐 Adelantada — Tabla fija (5)', 'textoJugadaHipismo de una Tabla Fija jugada dice "Adelantada" y el número de ejemplar');
  check(textoJugadaHipismo(lineaBanquero) === '🕐 Adelantada — Banqueó Marca (6x10)', 'textoJugadaHipismo de un banqueo de Marca dice "Banqueó" y los 2 números de la marca');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
});
