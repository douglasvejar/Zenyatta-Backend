// =================================================================
// PRUEBA: modelo de comisión "por tipo de jugada" (08-09-2026, a pedido
// del usuario: "hay grupos que manejan de distintas maneras los %...
// tengo un grupo que el % es de lo arriesgado pero por tipo de
// jugadas... las directas es un 2%... dos logros es el 3%... y 3 logros
// es el 5%... y despues esos resultados se suman y dan el total").
//
// Funciones 100% puras de comisiones.js — sin base de datos, sin fetch.
// Cubre:
//   1. porcentajePorTipoJugada(): la regla de "el tier más alto que sea
//      <= los logros reales", el tier más alto actuando de techo abierto
//      para parleys todavía más grandes, 0% si el ticket tiene MENOS
//      logros que el tier más chico configurado, sin tiers -> 0%.
//   2. acumularComisionPorTipoJugada(): suma en DÓLARES (no %) por
//      ticket, respeta esEstadoComisionable (ANULADA/SUSPENDIDA/etc. no
//      suman nada), logros null/undefined se trata como "0 logros".
//   3. calcularComisionTotalCliente() con configComision.modelo =
//      'por_tipo_jugada': porcentajePropio sale null (nada que mostrar),
//      comisionPropia usa comisionPorTipoAcumulada en vez de
//      arriesgadoComisionable*pct, y comisionAval (avales) sigue
//      exactamente igual, sin importar el modelo del grupo — es una
//      relación de comisión aparte a propósito.
//   4. Sin configComision (o modelo 'plano'): comportamiento IDÉNTICO al
//      de siempre, ni un solo caso de regresión.
// =================================================================
const {
  porcentajePorTipoJugada,
  acumularComisionPorTipoJugada,
  calcularComisionTotalCliente
} = require('../src/services/comisiones');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const TIERS = [
  { logros: 1, porcentaje: 2 },
  { logros: 2, porcentaje: 3 },
  { logros: 3, porcentaje: 5 }
];

// --- 1) porcentajePorTipoJugada ---
check(porcentajePorTipoJugada(1, TIERS) === 2, 'directa (1 logro) usa el 2% configurado');
check(porcentajePorTipoJugada(2, TIERS) === 3, 'parley de 2 logros usa el 3%');
check(porcentajePorTipoJugada(3, TIERS) === 5, 'parley de 3 logros usa el 5%');
check(porcentajePorTipoJugada(4, TIERS) === 5, 'parley de 4 logros (sin tier propio) usa el techo abierto del tier más alto (5%, el de 3 logros)');
check(porcentajePorTipoJugada(8, TIERS) === 5, 'parley de 8 logros también usa el techo abierto del 5%');
check(porcentajePorTipoJugada(0, TIERS) === 0, '0 logros (ticket raro) no matchea ningún tier -> 0%, no adivina');
check(porcentajePorTipoJugada(2, []) === 0, 'sin tiers configurados -> siempre 0%, nunca revienta');
check(porcentajePorTipoJugada(2, null) === 0, 'tiers null -> 0%, no revienta');
check(porcentajePorTipoJugada(null, TIERS) === 0, 'logros null/undefined se trata como 0 logros -> no matchea el tier de 1 -> 0%');

// Tiers desordenados en el arreglo (el súper-admin los puede cargar en
// cualquier orden) -> la regla ordena sola por logros antes de elegir.
const TIERS_DESORDENADOS = [
  { logros: 3, porcentaje: 5 },
  { logros: 1, porcentaje: 2 },
  { logros: 2, porcentaje: 3 }
];
check(porcentajePorTipoJugada(2, TIERS_DESORDENADOS) === 3, 'el orden de los tiers en el arreglo no importa: sigue matcheando 2 logros -> 3%');

// Un solo tier configurado, sin "techo" explícito para nada más chico.
const UN_SOLO_TIER = [{ logros: 2, porcentaje: 4 }];
check(porcentajePorTipoJugada(1, UN_SOLO_TIER) === 0, 'con un solo tier de 2 logros, una directa (1 logro) no matchea nada -> 0%');
check(porcentajePorTipoJugada(2, UN_SOLO_TIER) === 4, 'con un solo tier de 2 logros, un parley de 2 sí matchea');
check(porcentajePorTipoJugada(5, UN_SOLO_TIER) === 4, 'y un parley de 5 usa ese mismo tier como techo abierto');

// --- 2) acumularComisionPorTipoJugada ---
(function () {
  const rc = {};
  acumularComisionPorTipoJugada(rc, { arriesga: 100, estado: 'PERDIDA', logros: 1 }, TIERS); // 100*2% = 2
  acumularComisionPorTipoJugada(rc, { arriesga: 200, estado: 'GANADA', logros: 2 }, TIERS); // 200*3% = 6
  acumularComisionPorTipoJugada(rc, { arriesga: 50, estado: 'PERDIDA', logros: 3 }, TIERS); // 50*5% = 2.5
  check(Math.abs(rc.comisionPorTipoAcumulada - 10.5) < 0.001, 'acumularComisionPorTipoJugada suma en dólares ticket por ticket: 2 + 6 + 2.5 = 10.5');
})();

(function () {
  const rc = {};
  acumularComisionPorTipoJugada(rc, { arriesga: 100, estado: 'ANULADA', logros: 1 }, TIERS);
  acumularComisionPorTipoJugada(rc, { arriesga: 100, estado: 'SUSPENDIDA', logros: 2 }, TIERS);
  acumularComisionPorTipoJugada(rc, { arriesga: 100, estado: 'NULA (FALTA LOGRO)', logros: 3 }, TIERS);
  acumularComisionPorTipoJugada(rc, { arriesga: 100, estado: 'NULA (SIN JUGADA)', logros: 1 }, TIERS);
  acumularComisionPorTipoJugada(rc, { arriesga: 100, estado: 'AMBIGUA (VARIOS DEPORTES)', logros: 1 }, TIERS);
  check(!rc.comisionPorTipoAcumulada, 'ningún estado NO comisionable suma nada (mismo criterio que esEstadoComisionable en el modelo plano)');
})();

(function () {
  const rc = {};
  acumularComisionPorTipoJugada(rc, { arriesga: 100, estado: 'PENDIENTE', logros: undefined }, TIERS);
  acumularComisionPorTipoJugada(rc, { arriesga: 100, estado: 'PENDIENTE', logros: null }, TIERS);
  check(rc.comisionPorTipoAcumulada === 0, 'logros undefined/null en un ticket todavía pendiente se trata como 0 logros (no matchea ningún tier) en vez de reventar');
})();

// --- 3) calcularComisionTotalCliente con modelo 'por_tipo_jugada' ---
(function () {
  const resumenClientes = {
    ANA: { arriesgadoComisionable: 350, comisionPorTipoAcumulada: 10.5 },
    LUIS: { arriesgadoComisionable: 100, comisionPorTipoAcumulada: 4 }
  };
  const porcentajesPropios = { ANA: 999 }; // a propósito un valor absurdo -> tiene que IGNORARSE en este modelo
  const avalesMap = { LUIS: { ANA: 10 } }; // LUIS avala a ANA al 10% -> 350*10% = 35, SIEMPRE plano
  const configComision = { modelo: 'por_tipo_jugada', tiers: TIERS };

  const comisionAna = calcularComisionTotalCliente('ANA', resumenClientes, porcentajesPropios, avalesMap, configComision);
  check(comisionAna.porcentajePropio === null, 'con el modelo por_tipo_jugada, porcentajePropio sale null (no hay un solo % que mostrar)');
  check(comisionAna.comisionPropia === 10.5, 'comisionPropia usa comisionPorTipoAcumulada (10.5), NO arriesgadoComisionable*pct (que hubiera dado un disparate con el 999% de prueba)');
  check(comisionAna.comisionAval === 0, 'ANA no avala a nadie -> comisionAval en 0');
  check(comisionAna.total === 10.5, 'total = comisionPropia + comisionAval = 10.5 + 0');

  const comisionLuis = calcularComisionTotalCliente('LUIS', resumenClientes, porcentajesPropios, avalesMap, configComision);
  check(comisionLuis.porcentajePropio === null, 'LUIS también sale con porcentajePropio null bajo este modelo');
  check(comisionLuis.comisionPropia === 4, 'comisionPropia de LUIS usa su propia comisionPorTipoAcumulada (4)');
  check(comisionLuis.comisionAval === 35, 'comisionAval de LUIS SIGUE siendo plana (10% de los 350 comisionables de ANA) — el modelo por tipo de jugada NUNCA toca los avales, es una relación de comisión aparte');
  check(comisionLuis.total === 39, 'total de LUIS = 4 (propia, por tipo) + 35 (aval, plano) = 39');
})();

// --- 4) sin configComision (o modelo 'plano'): CERO cambios de comportamiento ---
(function () {
  const resumenClientes = { ANA: { arriesgadoComisionable: 350, comisionPorTipoAcumulada: 999 } }; // a propósito, tiene que IGNORARSE
  const porcentajesPropios = { ANA: 5 };
  const avalesMap = {};

  const sinConfig = calcularComisionTotalCliente('ANA', resumenClientes, porcentajesPropios, avalesMap);
  check(sinConfig.porcentajePropio === 5, 'sin configComision (5to parámetro omitido), porcentajePropio sigue siendo el % plano de siempre');
  check(sinConfig.comisionPropia === 17.5, 'sin configComision, comisionPropia sigue siendo arriesgadoComisionable*pct = 350*5% = 17.5 (ignora comisionPorTipoAcumulada aunque venga cargado)');

  const modeloPlanoExplicito = calcularComisionTotalCliente('ANA', resumenClientes, porcentajesPropios, avalesMap, { modelo: 'plano', tiers: [] });
  check(modeloPlanoExplicito.comisionPropia === 17.5, 'con configComision.modelo = "plano" explícito, el resultado es idéntico a no pasar configComision');

  const sinTiersEnElConfig = calcularComisionTotalCliente('ANA', resumenClientes, porcentajesPropios, avalesMap, { modelo: 'por_tipo_jugada' }); // tiers undefined
  check(sinTiersEnElConfig.comisionPropia === 999, 'con modelo por_tipo_jugada pero sin comisionPorTipoAcumulada calculado a mano, usa lo que ya venga acumulado en el resumen (acá 999, forzado a propósito) sin recalcular nada');
})();

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
