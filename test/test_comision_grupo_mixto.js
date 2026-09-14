// =================================================================
// PRUEBA: "grupo mixto" — modelo de comisión POR CLIENTE (09-09-2026, a
// pedido del usuario: "quiero que por cada grupo poderle dar el modelo de
// % a el grupo en su totalidad para todos los clientes o para clientes
// individuales... se puede tener un modelo de % en un grupo mixto...
// clientes que se le regrese % variados dependiendo de las patas de las
// jugadas.... o establecerle % fijo por cualquier tipo de jugada etc" /
// "puedo elegir cualquier tipo de % o sin %").
//
// Función 100% pura de comisiones.js (calcularComisionTotalCliente) — sin
// base de datos, sin fetch. Cubre exactamente lo que documenta la nota
// grande de esa función:
//   1. Cliente SIN excepción -> sigue el modelo DEFAULT del grupo
//      (configComision.modelo), sin cambios.
//   2. Grupo DEFAULT 'por_tipo_jugada' + un cliente con excepción 'plano'
//      -> ese cliente usa SU % fijo (comisionPropia via
//      porcentajesPropios), aunque el resto del grupo cobre por tiers.
//   3. Grupo DEFAULT 'plano' + un cliente con excepción 'por_tipo_jugada'
//      -> ese cliente usa los TIERS DEL GRUPO (comisionPorTipoAcumulada),
//      aunque el resto del grupo cobre % fijo.
//   4. Un cliente con excepción 'plano' y % en 0 -> "sin %" a propósito
//      (0 es un valor válido, no "sin configurar").
//   5. Los avales (comisionAval) NUNCA cambian por ninguna excepción de
//      modelo — siguen siendo siempre planos, para cualquier cliente.
//   6. Sin `modelosPorCliente` en el configComision (undefined) ->
//      comportamiento IDÉNTICO al modelo default de siempre (retrocompat
//      con el código/pruebas ya existentes de 'por_tipo_jugada' plano).
// =================================================================
const { calcularComisionTotalCliente } = require('../src/services/comisiones');

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

// --- 1) sin excepción -> sigue el modelo default del grupo ---
(function () {
  const resumenClientes = {
    ANA: { arriesgadoComisionable: 100, comisionPorTipoAcumulada: 7 },
    LUIS: { arriesgadoComisionable: 100, comisionPorTipoAcumulada: 7 }
  };
  const porcentajesPropios = { ANA: 5, LUIS: 5 };
  const avalesMap = {};

  // Grupo default 'por_tipo_jugada', ningún cliente con excepción.
  const configGrupoPorTipo = { modelo: 'por_tipo_jugada', tiers: TIERS, modelosPorCliente: {} };
  const anaSinExcepcion = calcularComisionTotalCliente('ANA', resumenClientes, porcentajesPropios, avalesMap, configGrupoPorTipo);
  check(anaSinExcepcion.porcentajePropio === null, 'sin excepción, ANA sigue el modelo default del grupo (por_tipo_jugada) -> porcentajePropio null');
  check(anaSinExcepcion.comisionPropia === 7, 'sin excepción, ANA cobra por los tiers del grupo (comisionPorTipoAcumulada = 7), no su % plano de 5');

  // Grupo default 'plano', ningún cliente con excepción.
  const configGrupoPlano = { modelo: 'plano', tiers: TIERS, modelosPorCliente: {} };
  const luisSinExcepcion = calcularComisionTotalCliente('LUIS', resumenClientes, porcentajesPropios, avalesMap, configGrupoPlano);
  check(luisSinExcepcion.porcentajePropio === 5, 'sin excepción, LUIS sigue el modelo default del grupo (plano) -> su % de 5');
  check(luisSinExcepcion.comisionPropia === 5, 'sin excepción, LUIS cobra 100*5% = 5 (plano), no los 7 de comisionPorTipoAcumulada');
})();

// --- 2) grupo default 'por_tipo_jugada' + un cliente con excepción 'plano' ---
(function () {
  const resumenClientes = {
    ANA: { arriesgadoComisionable: 100, comisionPorTipoAcumulada: 999 }, // a propósito absurdo, tiene que IGNORARSE
    LUIS: { arriesgadoComisionable: 100, comisionPorTipoAcumulada: 7 }
  };
  const porcentajesPropios = { ANA: 5 }; // LUIS no tiene % propio configurado (no hace falta bajo por_tipo_jugada)
  const avalesMap = {};
  const configComision = { modelo: 'por_tipo_jugada', tiers: TIERS, modelosPorCliente: { ANA: 'plano' } };

  const ana = calcularComisionTotalCliente('ANA', resumenClientes, porcentajesPropios, avalesMap, configComision);
  check(ana.porcentajePropio === 5, 'grupo en por_tipo_jugada, pero ANA tiene excepción "plano" -> muestra su % fijo (5)');
  check(ana.comisionPropia === 5, 'ANA con excepción plano cobra 100*5% = 5, IGNORA por completo los 999 de comisionPorTipoAcumulada');

  const luis = calcularComisionTotalCliente('LUIS', resumenClientes, porcentajesPropios, avalesMap, configComision);
  check(luis.porcentajePropio === null, 'LUIS no tiene excepción -> sigue el modelo default del grupo (por_tipo_jugada)');
  check(luis.comisionPropia === 7, 'LUIS sigue cobrando por los tiers del grupo (7), sin que la excepción de ANA lo afecte');
})();

// --- 3) grupo default 'plano' + un cliente con excepción 'por_tipo_jugada' ---
(function () {
  const resumenClientes = {
    ANA: { arriesgadoComisionable: 100, comisionPorTipoAcumulada: 10.5 },
    LUIS: { arriesgadoComisionable: 200, comisionPorTipoAcumulada: 999 } // a propósito absurdo, tiene que IGNORARSE
  };
  const porcentajesPropios = { LUIS: 8 }; // ANA no tiene % propio configurado (no hace falta bajo su excepción)
  const avalesMap = {};
  const configComision = { modelo: 'plano', tiers: TIERS, modelosPorCliente: { ANA: 'por_tipo_jugada' } };

  const ana = calcularComisionTotalCliente('ANA', resumenClientes, porcentajesPropios, avalesMap, configComision);
  check(ana.porcentajePropio === null, 'grupo en plano, pero ANA tiene excepción "por_tipo_jugada" -> porcentajePropio null');
  check(ana.comisionPropia === 10.5, 'ANA con excepción por_tipo_jugada cobra según los TIERS DEL GRUPO (10.5), aunque el grupo default sea plano');

  const luis = calcularComisionTotalCliente('LUIS', resumenClientes, porcentajesPropios, avalesMap, configComision);
  check(luis.porcentajePropio === 8, 'LUIS no tiene excepción -> sigue el modelo default del grupo (plano), su % de 8');
  check(luis.comisionPropia === 16, 'LUIS cobra 200*8% = 16 (plano), IGNORA los 999 de comisionPorTipoAcumulada');
})();

// --- 4) excepción 'plano' con % en 0 -> "sin %" a propósito ---
(function () {
  const resumenClientes = { ANA: { arriesgadoComisionable: 500, comisionPorTipoAcumulada: 25 } };
  const porcentajesPropios = {}; // ANA sin % propio cargado (0, "sin %")
  const avalesMap = {};
  const configComision = { modelo: 'por_tipo_jugada', tiers: TIERS, modelosPorCliente: { ANA: 'plano' } };

  const ana = calcularComisionTotalCliente('ANA', resumenClientes, porcentajesPropios, avalesMap, configComision);
  check(ana.porcentajePropio === 0, 'ANA con excepción "plano" y sin % cargado -> 0% ("sin %" a propósito, no hereda los tiers del grupo)');
  check(ana.comisionPropia === 0, 'comisionPropia de ANA da 0 (500*0%), no los 25 de comisionPorTipoAcumulada');
})();

// --- 5) los avales nunca cambian por ninguna excepción de modelo ---
(function () {
  const resumenClientes = {
    ANA: { arriesgadoComisionable: 300, comisionPorTipoAcumulada: 12 },
    LUIS: { arriesgadoComisionable: 100, comisionPorTipoAcumulada: 4 }
  };
  const porcentajesPropios = { LUIS: 5 };
  const avalesMap = { LUIS: { ANA: 10 } }; // LUIS avala a ANA al 10% plano, siempre
  const configComision = { modelo: 'por_tipo_jugada', tiers: TIERS, modelosPorCliente: { LUIS: 'plano' } };

  const luis = calcularComisionTotalCliente('LUIS', resumenClientes, porcentajesPropios, avalesMap, configComision);
  check(luis.comisionAval === 30, 'el aval de LUIS sobre ANA sigue siendo 300*10% = 30, sin que la excepción "plano" de LUIS lo toque');
  check(luis.comisionPropia === 5, 'la comisión PROPIA de LUIS sí usa su excepción plano (100*5% = 5)');
  check(luis.total === 35, 'total de LUIS = 5 (propia, excepción plano) + 30 (aval, siempre plano) = 35');
})();

// --- 6) sin modelosPorCliente en el configComision -> compatibilidad total ---
(function () {
  const resumenClientes = { ANA: { arriesgadoComisionable: 100, comisionPorTipoAcumulada: 7 } };
  const porcentajesPropios = { ANA: 5 };
  const avalesMap = {};

  const sinModelosPorCliente = calcularComisionTotalCliente('ANA', resumenClientes, porcentajesPropios, avalesMap, { modelo: 'por_tipo_jugada', tiers: TIERS });
  check(sinModelosPorCliente.porcentajePropio === null, 'sin modelosPorCliente en el configComision, sigue el modelo default (por_tipo_jugada) tal cual antes');
  check(sinModelosPorCliente.comisionPropia === 7, 'y cobra por los tiers del grupo, igual que antes de existir el grupo mixto');
})();

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
