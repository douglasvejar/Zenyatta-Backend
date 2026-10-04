// =================================================================
// PRUEBA: "Jugadas entre Tercios Adelantadas" ahora SÍ se ven reflejadas
// en los reportes de cliente/grupo (04-10-2026, caso real "Rambo": "NO
// CARGA NI LAS JUGADAS ADEALNTADAS ENTRE TERCIO NI LAS TABLAS O
// MARCAS" -> confirmado después: "LA JUGADA QUE NO SALE LA CARGA POR
// JUGADAS ADELANTDAS ENTRE TERCIOS").
//
// Hasta esta ronda, hipismo_tercios_adelantadas_jugadas NUNCA se leía
// desde:
//   1) obtenerLineasHipismoCliente() (services/hipismoLineasCliente.js)
//      -- el link público del cliente y "Detallado por Cliente" del
//      Administrador.
//   2) construirCierreFinalHipismo() (services/hipismoResumenCliente.js)
//      -- Balance General Y Cierre Final (GET /cierre-final), la
//      referencia "golden". La única vez que esta plata se veía era de
//      forma EFÍMERA, sin persistir, en la respuesta de POST /planos
//      justo al guardar el plano que resolvió la jugada
//      (mezclarTerciosAdelantadasEnBalance en routes/hipismo.js) --
//      recargar la pantalla (o abrir el link del cliente) la perdía por
//      completo.
//
// Esta prueba cubre los 2 puntos, con el MISMO criterio ya usado para
// Tablas Fijas/Marcas: el lado JUGADOR de una jugada 'resuelto' o
// 'sin_decidir' (ya definitivo) se ve, una 'pendiente' no. A diferencia
// de Tablas Fijas (que necesita la cuenta "espejo" TABLAS FIJAS), acá
// jugador + banquero + comisión del grupo ya suman 0 solos -- por eso
// el ítem nuevo en Cierre Final se llama "% TERCIOS ADELANTADAS", MISMO
// nombre que ya usa mezclarTerciosAdelantadasEnBalance para que el
// Balance General recién guardado y el recargado después se vean
// IGUAL.
// =================================================================
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: function () {
    this.query = async () => { throw new Error('No debería llamarse pg directo en esta prueba'); };
    this.connect = async () => ({ query: async () => { throw new Error('No debería llamarse'); }, release() {} });
    this.on = () => {};
  } };
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
  // =================================================================
  // PARTE 1 — obtenerLineasHipismoCliente() / textoJugadaHipismo()
  // (link del cliente y "Detallado por Cliente")
  // =================================================================
  const db = require(path.join(__dirname, '..', 'src', 'db'));
  const GRUPO_ID = 'grupo-tercios-adel-1';

  const TABLAS = {
    hipismo_tercios_adelantadas_planos: [
      { id: 'plano-ta-1', grupo_id: GRUPO_ID, hipodromo_id: 'hip-1', hipodromo_nombre: 'La Rinconada', fecha: '2026-10-01' }
    ],
    hipismo_tercios_adelantadas_jugadas: [
      // SAMMY jugó "2y4" del grupo [2,4] contra MUJICA, con 180 -- ganó
      // (igual al ejemplo real que confirmó el usuario del "combo" en
      // otra jugada). resultado_jugador/banquero YA vienen con el %
      // aplicado (mismo criterio que hipismo_tickets).
      {
        id: 'ta-1', plano_id: 'plano-ta-1', grupo_id: GRUPO_ID, jugador_nombre: 'SAMMY', banquero_nombre: 'MUJICA',
        carrera_numero: 5, es_cruce: false, grupo_caballos: [2, 4], cruce_grupo_a: null, cruce_grupo_b: null,
        modalidad: '2y4', monto: 180, comision_porcentaje: 5,
        estado: 'resuelto', resultado_jugador: 171, resultado_banquero: -180, comision_grupo: 9,
        pizarra_usada: '2.4.1', creado_en: new Date('2026-10-01T10:00:00Z')
      },
      // MUJICA también banqueó un CRUCE entre [1] y [3] contra HANRY --
      // ganó HANRY (jugador).
      {
        id: 'ta-2', plano_id: 'plano-ta-1', grupo_id: GRUPO_ID, jugador_nombre: 'HANRY', banquero_nombre: 'MUJICA',
        carrera_numero: 7, es_cruce: true, grupo_caballos: null, cruce_grupo_a: [1], cruce_grupo_b: [3],
        modalidad: null, monto: 100, comision_porcentaje: 5,
        estado: 'resuelto', resultado_jugador: 95, resultado_banquero: -100, comision_grupo: 5,
        pizarra_usada: '1.5.2', creado_en: new Date('2026-10-01T11:00:00Z')
      },
      // Una jugada 'sin_decidir' (neta en 0 para los 2 lados) -- SAMMY
      // también aparece acá, pero no debe sumar nada a su saldo.
      {
        id: 'ta-3', plano_id: 'plano-ta-1', grupo_id: GRUPO_ID, jugador_nombre: 'SAMMY', banquero_nombre: 'HANRY',
        carrera_numero: 8, es_cruce: false, grupo_caballos: [6], cruce_grupo_a: null, cruce_grupo_b: null,
        modalidad: '1p', monto: 50, comision_porcentaje: 5,
        estado: 'sin_decidir', resultado_jugador: 0, resultado_banquero: 0, comision_grupo: 0,
        pizarra_usada: '9.9.9', creado_en: new Date('2026-10-01T12:00:00Z')
      },
      // Una jugada todavía 'pendiente' (nunca se resolvió) -- NO debe
      // aparecer en el link de nadie, ni de SAMMY ni de su banquero.
      {
        id: 'ta-4', plano_id: 'plano-ta-1', grupo_id: GRUPO_ID, jugador_nombre: 'SAMMY', banquero_nombre: 'OTRO',
        carrera_numero: 9, es_cruce: false, grupo_caballos: [3], cruce_grupo_a: null, cruce_grupo_b: null,
        modalidad: '1p', monto: 30, comision_porcentaje: 5,
        estado: 'pendiente', resultado_jugador: null, resultado_banquero: null, comision_grupo: null,
        pizarra_usada: null, creado_en: new Date('2026-10-01T13:00:00Z')
      }
    ],
    hipismo_hipodromos: [{ id: 'hip-1', pais: 'VE' }],
    hipismo_tickets: [], hipismo_planos: [],
    hipismo_remate_apuestas: [], hipismo_remates: [],
    hipismo_adelantadas_jugadas: [], hipismo_adelantadas_planos: [],
    hipismo_winners: []
  };

  db.query = async (text, params) => {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.modalidad, t\.caballo, t\.monto/i.test(sql)) return { rows: [] };
    if (/^SELECT a\.caballo, a\.numero_ejemplar, a\.monto, a\.resultado/i.test(sql)) return { rows: [] };
    if (/^SELECT j\.tipo, j\.cliente_nombre, j\.carrera_numero, j\.cantidad_tf, j\.numero_ejemplar/i.test(sql)) return { rows: [] };
    if (/^SELECT w\.caballo, w\.monto, w\.fecha, w\.hipodromo_nombre, w\.carrera_numero, h\.pais/i.test(sql)) return { rows: [] };

    // obtenerLineasHipismoCliente(): "Jugadas entre Tercios Adelantadas" (NUEVA).
    if (/^SELECT j\.jugador_nombre, j\.banquero_nombre, j\.carrera_numero, j\.es_cruce/i.test(sql)) {
      const [grupoId, nombre, desde, hasta] = params;
      const filas = TABLAS.hipismo_tercios_adelantadas_jugadas
        .filter(j => j.grupo_id === grupoId && ['resuelto', 'sin_decidir'].includes(j.estado))
        .filter(j => j.jugador_nombre === nombre || j.banquero_nombre === nombre)
        .map(j => ({ j, p: TABLAS.hipismo_tercios_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
        .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta)
        .sort((a, b) => a.j.creado_en - b.j.creado_en);
      return {
        rows: filas.map(({ j, p }) => {
          const hip = TABLAS.hipismo_hipodromos.find(h => h.id === p.hipodromo_id);
          return {
            jugador_nombre: j.jugador_nombre, banquero_nombre: j.banquero_nombre, carrera_numero: j.carrera_numero,
            es_cruce: j.es_cruce, grupo_caballos: j.grupo_caballos, cruce_grupo_a: j.cruce_grupo_a, cruce_grupo_b: j.cruce_grupo_b,
            modalidad: j.modalidad, monto: j.monto, resultado_jugador: j.resultado_jugador, resultado_banquero: j.resultado_banquero,
            comision_grupo: j.comision_grupo, pizarra_usada: j.pizarra_usada,
            fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, pais: hip ? hip.pais : null
          };
        })
      };
    }

    throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
  };

  const lineasSammy = await obtenerLineasHipismoCliente(GRUPO_ID, 'SAMMY', '2026-09-25', '2026-10-05');
  check(lineasSammy.length === 2, 'SAMMY ve sus 2 jugadas ya decididas (la "resuelto" que ganó + la "sin_decidir" en 0) -- la "pendiente" nunca aparece');

  const lineaSammy = lineasSammy.find(l => l.resultado !== 0);
  const lineaSinDecidirSammy = lineasSammy.find(l => l.resultado === 0);
  check(!!lineaSinDecidirSammy && lineaSinDecidirSammy.carreraNumero === 8,
    'La jugada "sin_decidir" de SAMMY (carrera 8) aparece con resultado 0 -- ya decidida, pero neta para los 2 lados');
  check(lineaSammy.tipo === 'tercios_adelantada' && lineaSammy.rol === 'jugador' && lineaSammy.resultado === 171,
    'La línea de SAMMY trae tipo "tercios_adelantada", rol "jugador" y su resultado ya con el % aplicado (171 = 180 - 5%)');
  check(lineaSammy.carreraNumero === 5 && lineaSammy.hipodromoNombre === 'La Rinconada' && lineaSammy.fecha === '2026-10-01' && lineaSammy.pizarra === '2.4.1',
    'La línea de SAMMY trae la carrera/hipódromo/fecha/pizarra reales del plano');
  check(JSON.stringify(lineaSammy.grupoCaballos) === '[2,4]' && lineaSammy.esCruce === false,
    'La línea de SAMMY (jugada de grupo, no cruce) trae su grupoCaballos [2,4]');

  const lineasMujica = await obtenerLineasHipismoCliente(GRUPO_ID, 'MUJICA', '2026-09-25', '2026-10-05');
  check(lineasMujica.length === 2, 'MUJICA (banqueó las 2 jugadas resueltas) ve sus 2 líneas como banquero');
  const mujicaVsSammy = lineasMujica.find(l => l.carreraNumero === 5);
  check(!!mujicaVsSammy && mujicaVsSammy.rol === 'banquero' && mujicaVsSammy.resultado === -180,
    'MUJICA banqueando a SAMMY ve su propio resultado como banquero (-180, perdió completo porque SAMMY ganó)');
  const mujicaVsHanry = lineasMujica.find(l => l.carreraNumero === 7);
  check(!!mujicaVsHanry && mujicaVsHanry.esCruce === true && JSON.stringify(mujicaVsHanry.cruceGrupoA) === '[1]' && JSON.stringify(mujicaVsHanry.cruceGrupoB) === '[3]',
    'MUJICA banqueando el cruce ve esCruce:true con los 2 grupos del cruce');

  const sammyNoSinDecidir = (await obtenerLineasHipismoCliente(GRUPO_ID, 'SAMMY', '2026-09-25', '2026-10-05'))
    .reduce((acc, l) => acc + l.resultado, 0);
  check(sammyNoSinDecidir === 171, 'El saldo total de SAMMY (171) NO incluye nada de la jugada "sin_decidir" (0) ni de la "pendiente" (no aparece)');

  // --- textoJugadaHipismo(): el texto que ve el cliente en su link ---
  check(textoJugadaHipismo(lineaSammy) === '🎯 Adelantada entre tercios — Jugó 2y4 2Y4',
    'textoJugadaHipismo de una jugada de grupo dice "Jugó" + los caballos + la modalidad en mayúsculas');
  check(textoJugadaHipismo(mujicaVsSammy) === '🎯 Adelantada entre tercios — Dio 2y4 2Y4',
    'textoJugadaHipismo del lado banquero dice "Dio" en vez de "Jugó"');
  check(textoJugadaHipismo(mujicaVsHanry) === '🎯 Adelantada entre tercios — Dio 1 x 3',
    'textoJugadaHipismo de un cruce dice "grupoA x grupoB" (sin modalidad, porque esta jugada no tenía)');

  // =================================================================
  // PARTE 2 — construirCierreFinalHipismo() (Balance General/Cierre
  // Final, GET /cierre-final, la referencia "golden"). Antes de este
  // arreglo esta función tenía CERO wiring de Tercios Adelantadas, así
  // que recargar Balance General después de guardar un plano que
  // resolvió una de estas jugadas perdía esa plata por completo.
  // =================================================================
  const { construirCierreFinalHipismo } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoResumenCliente'));

  db.query = async (text, params) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

    if (/^SELECT t\.cliente_nombre, t\.banquero_nombre, t\.resultado_jugador, t\.resultado_banquero, t\.monto/i.test(sql)) return { rows: [] };
    if (/^SELECT a\.cliente_nombre, a\.resultado, a\.monto/i.test(sql)) return { rows: [] };
    if (/^SELECT j\.cliente_nombre, j\.tipo, j\.resultado_cliente, j\.comision, j\.banqueadores, j\.monto, j\.gano/i.test(sql)) return { rows: [] };
    if (/^SELECT cliente_nombre, monto FROM hipismo_winners/i.test(sql)) return { rows: [] };
    if (/^SELECT j\.id, j\.nombre, j\.comision_propia, cc_propio\.nombre AS cc_propio_nombre/i.test(sql)) return { rows: [] };
    if (/^SELECT jap\.jugador_id, jap\.porcentaje, av\.nombre AS avalador_nombre/i.test(sql)) return { rows: [] };
    if (/^SELECT cliente_nombre, COALESCE\(SUM\(monto\), 0\) AS total\s+FROM hipismo_comisiones_ajustes/i.test(sql)) return { rows: [] };
    if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_remates/i.test(sql)) return { rows: [{ total: 0 }] };
    if (/^SELECT COALESCE\(SUM\(comision_total\), 0\) AS total\s+FROM hipismo_planos/i.test(sql)) return { rows: [{ total: 0 }] };

    // construirCierreFinalHipismo(): "Jugadas entre Tercios Adelantadas" (NUEVA).
    if (/^SELECT j\.jugador_nombre, j\.banquero_nombre, j\.resultado_jugador, j\.resultado_banquero, j\.comision_grupo/i.test(sql)) {
      const [grupoId, desde, hasta] = params;
      const filas = TABLAS.hipismo_tercios_adelantadas_jugadas
        .filter(j => j.grupo_id === grupoId && ['resuelto', 'sin_decidir'].includes(j.estado))
        .map(j => ({ j, p: TABLAS.hipismo_tercios_adelantadas_planos.find(pl => pl.id === j.plano_id) }))
        .filter(({ p }) => p && p.fecha >= desde && p.fecha <= hasta);
      return {
        rows: filas.map(({ j, p }) => ({
          jugador_nombre: j.jugador_nombre, banquero_nombre: j.banquero_nombre,
          resultado_jugador: j.resultado_jugador, resultado_banquero: j.resultado_banquero, comision_grupo: j.comision_grupo,
          fecha: p.fecha, hipodromo_nombre: p.hipodromo_nombre, carrera_numero: j.carrera_numero
        }))
      };
    }

    throw new Error('La base de datos falsa de esta prueba (cierre-final) no sabe responder: ' + sql);
  };

  const cierre = await construirCierreFinalHipismo(GRUPO_ID, '2026-09-25', '2026-10-05');
  const cSammy = cierre.clientes.find(c => c.nombre === 'SAMMY');
  const cMujica = cierre.clientes.find(c => c.nombre === 'MUJICA');
  const cHanry = cierre.clientes.find(c => c.nombre === 'HANRY');
  const cItem = cierre.clientes.find(c => c.nombre === '% TERCIOS ADELANTADAS');

  check(!!cSammy && cSammy.saldo === 171, 'Balance General/Cierre Final ahora SÍ suma lo que ganó SAMMY en su jugada entre Tercios Adelantadas (171)');
  check(!!cMujica && cMujica.saldo === -280, 'MUJICA (banqueó las 2 jugadas resueltas: -180 y -100) queda en -280 en Balance General');
  check(!!cHanry && cHanry.saldo === 95, 'HANRY (ganó el cruce como jugador) queda en +95 en Balance General');
  check(!!cItem && cItem.saldo === 14, 'El ítem "% TERCIOS ADELANTADAS" suma la comisión del grupo de las 2 jugadas resueltas (9 + 5 = 14) -- mismo nombre EXACTO que ya usa mezclarTerciosAdelantadasEnBalance para el Balance General efímero de "Cargar Planos"');

  const sumaTotal = round2Test(cSammy.saldo + cMujica.saldo + cHanry.saldo + cItem.saldo);
  check(sumaTotal === 0, 'SAMMY + MUJICA + HANRY + "% TERCIOS ADELANTADAS" suman exactamente 0 (171 - 280 + 95 + 14 = 0) -- jugador+banquero+comisión siempre cuadra');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
})();

function round2Test(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
