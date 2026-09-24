// =================================================================
// PRUEBA: construirResumenClienteHipismo() (24-09-2026, services/
// hipismoResumenCliente.js) — la función que arma la respuesta que ve
// UN cliente puntual, ahora compartida entre 2 lugares (ver la nota
// grande del archivo): el portal público (routes/hipismoCliente.js, por
// token) y la nueva pantalla del Administrador "Saldos > Detallado por
// Cliente" (GET /api/hipismo/clientes/:nombre/detalle-semana, por
// nombre+sesión). Esta prueba es una prueba de REGRESIÓN del refactor:
// antes esta lógica vivía inline dentro de routes/hipismoCliente.js —
// acá se confirma que, movida a su propio archivo y llamada con
// jugador/grupo ya resueltos (en vez de buscarlos ella misma por
// token), sigue produciendo exactamente el mismo resultado.
//
// Mismo patrón de base de datos falsa que test_hipismo_lineas_cliente.js
// (Module._load intercepta "pg" antes de requerir services/db.js).
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
  hipismo_adelantadas_planos: [],
  tickets_historial: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_tickets
      .filter(t => t.grupo_id === grupoId && (t.cliente_nombre === nombre || t.banquero_nombre === nombre))
      .map(t => ({ t, plano: TABLAS.hipismo_planos.find(p => p.id === t.plano_id) }))
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta);
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
  if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const filas = TABLAS.hipismo_remate_apuestas
      .filter(a => a.grupo_id === grupoId && a.cliente_nombre === nombre)
      .map(a => ({ a, remate: TABLAS.hipismo_remates.find(r => r.id === a.remate_id) }))
      .filter(({ remate }) => remate && remate.fecha >= desde && remate.fecha <= hasta);
    return {
      rows: filas.map(({ a, remate }) => ({
        caballo: a.caballo, numero_ejemplar: a.numero_ejemplar, monto: a.monto, resultado: a.resultado,
        fecha: remate.fecha, hipodromo_nombre: remate.hipodromo_nombre, carrera_numero: remate.carrera_numero,
        pizarra: remate.pizarra, numero_ganador: remate.numero_ganador, pais: null
      }))
    };
  }
  if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) {
    const [grupoId, nombre, desde, hasta] = params;
    const estadosValidos = ['resuelto', 'falta_banqueo', 'sin_decidir'];
    const filas = TABLAS.hipismo_adelantadas_jugadas
      .filter(j => j.grupo_id === grupoId && estadosValidos.includes(j.estado))
      .filter(j => j.cliente_nombre === nombre || (Array.isArray(j.banqueadores) && j.banqueadores.some(b => b.nombre === nombre)))
      .map(j => ({ j, plano: TABLAS.hipismo_adelantadas_planos.find(p => p.id === j.plano_id) }))
      .filter(({ plano }) => plano && plano.fecha >= desde && plano.fecha <= hasta);
    return {
      rows: filas.map(({ j, plano }) => ({
        tipo: j.tipo, cliente_nombre: j.cliente_nombre, carrera_numero: j.carrera_numero,
        cantidad_tf: j.cantidad_tf, numero_ejemplar: j.numero_ejemplar, numero1: j.numero1, numero2: j.numero2,
        monto: j.monto, resultado_cliente: j.resultado_cliente, banqueadores: j.banqueadores, pizarra_usada: j.pizarra_usada,
        fecha: plano.fecha, hipodromo_nombre: plano.hipodromo_nombre, pais: null
      }))
    };
  }
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros\s+FROM tickets_historial/i.test(sql)) {
    const [grupoId, desde, hasta, cliente] = params;
    const filas = TABLAS.tickets_historial.filter(t =>
      t.grupo_id === grupoId && t.fecha >= desde && t.fecha <= hasta && t.cliente_nombre === cliente);
    return { rows: filas };
  }

  throw new Error('La base de datos falsa de esta prueba (resumen-cliente) no sabe responder: ' + sql);
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

const { construirResumenClienteHipismo } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoResumenCliente'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  const GRUPO_ID = 'grupo-resumen-1';
  const grupo = { nombre: 'Zenyatta', logo_url: 'https://ejemplo.com/logo.png', modulo_deportes_habilitado: true };

  // --- Fixture: HANRY, un Tercios normal + una Adelantada (Tabla Fija) ---
  TABLAS.hipismo_planos.push({ id: 'plano-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', carrera_numero: 9, fecha: '2026-09-24', pizarra: '6.10.4' });
  TABLAS.hipismo_hipodromos.push({ id: 'hip-1', pais: 'VE' });
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'HANRY', banquero_nombre: 'BANCO', modalidad: '9x2', caballo: '9', monto: 50, resultado_jugador: -50, resultado_banquero: 47.5 });
  TABLAS.hipismo_adelantadas_planos.push({ id: 'plano-adel-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', fecha: '2026-09-24' });
  TABLAS.hipismo_adelantadas_jugadas.push({
    id: 'adel-1', plano_id: 'plano-adel-1', grupo_id: GRUPO_ID, cliente_nombre: 'HANRY', carrera_numero: 9,
    tipo: 'tf', cantidad_tf: 1, numero_ejemplar: 1, monto: 50, resultado_cliente: 47.5, banqueadores: null,
    pizarra_usada: '6.10.4', estado: 'resuelto'
  });

  const jugadorHanry = { grupo_id: GRUPO_ID, nombre: 'HANRY', modulos_anclados: false };
  const resumenHanry = await construirResumenClienteHipismo(jugadorHanry, grupo, 'actual');

  check(resumenHanry.grupo.nombre === 'Zenyatta' && resumenHanry.grupo.logoUrl === 'https://ejemplo.com/logo.png',
    'El resumen trae el nombre y logo del grupo tal cual se le pasó (mismo shape que antes del refactor)');
  check(resumenHanry.jugador.nombre === 'HANRY', 'El resumen trae el nombre del jugador');
  check(resumenHanry.modulos.hipismo === true && resumenHanry.modulos.deportes === false,
    'Sin Deportes anclado (modulos_anclados: false), aunque el grupo sí tenga Deportes habilitado');
  check(resumenHanry.resumen.totalSemana === -2.5, 'Total de HANRY: -50 (Tercios) + 47.5 (Adelantada) = -2.5 — el mismo caso reportado por el usuario');
  check(resumenHanry.resumen.cantidadJugadas === 2, 'Cuenta las 2 jugadas (1 Tercios + 1 Adelantada)');
  const diaHanry = resumenHanry.dias.find(d => d.fecha === '2026-09-24');
  check(!!diaHanry, 'Trae el día 2026-09-24 agrupado');
  const carrerasHanry = diaHanry.hipodromos.find(h => h.nombre === 'La Rinconada').carreras;
  check(carrerasHanry.length === 2, 'Las 2 jugadas de HANRY quedan agrupadas bajo el mismo hipódromo/día');
  check(!!carrerasHanry.find(c => c.tipo === 'adelantada' && c.subtipo === 'tf' && c.resultado === 47.5),
    'La línea de Adelantada trae tipo/subtipo/resultado correctos, lista para que el frontend arme "🕐 Adelantada — Tabla fija (1)"');

  // --- Fixture: MULTI, con Hipismo + Deportes anclado ---
  TABLAS.hipismo_tickets.push({ plano_id: 'plano-1', grupo_id: GRUPO_ID, cliente_nombre: 'MULTI', banquero_nombre: 'BANCO', modalidad: '1/2', caballo: '5', monto: 40, resultado_jugador: 36, resultado_banquero: -36 });
  TABLAS.tickets_historial.push({ grupo_id: GRUPO_ID, fecha: '2026-09-24', cliente_nombre: 'MULTI', ticket: 'T1', detalle: 'Real Madrid ML', arriesga: 20, gana: 38, estado: 'GANADA', logros: null });
  TABLAS.tickets_historial.push({ grupo_id: GRUPO_ID, fecha: '2026-09-24', cliente_nombre: 'MULTI', ticket: 'T2', detalle: 'Barcelona ML', arriesga: 15, gana: 0, estado: 'PERDIDA', logros: null });

  const jugadorMulti = { grupo_id: GRUPO_ID, nombre: 'MULTI', modulos_anclados: true };
  const resumenMulti = await construirResumenClienteHipismo(jugadorMulti, grupo, 'actual');

  check(resumenMulti.modulos.deportes === true, 'MULTI tiene Deportes anclado (modulos_anclados: true + grupo con Deportes habilitado)');
  check(resumenMulti.resumen.totalHipismo === 36, 'Total de Hipismo de MULTI: 36 (Tercios)');
  check(resumenMulti.resumen.totalDeportes === 23, 'Total de Deportes de MULTI: 38 (ganada) - 15 (perdida) = 23');
  check(resumenMulti.resumen.totalSemana === 59, 'Total combinado de MULTI: 36 + 23 = 59 (Hipismo + Deportes juntos)');
  const diaMulti = resumenMulti.dias.find(d => d.fecha === '2026-09-24');
  const bloqueDeportes = diaMulti.hipodromos.find(h => h.tipo === 'deportes');
  check(!!bloqueDeportes && bloqueDeportes.carreras.length === 2, 'El bloque "Deportes" aparece separado, con sus 2 tickets');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de resumen de cliente se cayó con una excepción:', e);
  process.exit(1);
});
