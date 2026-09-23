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
  hipismo_remates: []
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
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
});
