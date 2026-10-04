// Prueba (04-10-2026, a pedido EXPLÍCITO del usuario): "estas jugadas a
// premio no dejan comision, ni % de devolución para los clientes... ni
// generan comisión para el grupo ni % de devolución para ellos mismo ni
// para sus avalados". La comisión del GRUPO ya excluía sinComision desde
// antes (ver test_hipismo_a_premio_y_morocha.js, sección 5) — esta prueba
// cubre la parte que SÍ tenía el bug: la base de % devuelto (propio y de
// avalados), que usa montoBaseComisionExacto (hipismoAdelantadasCalc.js) y
// netearJugadorBanqueroTercios (hipismoCalc.js).
const { montoDecididoExacto, montoBaseComisionExacto, round2 } = require('../src/services/hipismoAdelantadasCalc.js');
const { netearJugadorBanqueroTercios } = require('../src/services/hipismoCalc.js');

let ok = 0, fallaron = 0;
function assertEq(desc, real, esperado) {
  const iguales = (typeof real === 'number' && typeof esperado === 'number')
    ? Math.abs(real - esperado) < 0.001
    : real === esperado;
  if (iguales) { console.log(`OK   ${desc}`); ok++; }
  else { console.log(`FAIL ${desc}: real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`); fallaron++; }
}

// ================= 1) montoBaseComisionExacto: $0 siempre que sinComision =================
assertEq('sinComision=true, ganó -> base 0 (antes aportaba el monto neto)', montoBaseComisionExacto(200, true), 0);
assertEq('sinComision=true, perdió -> base 0 (antes aportaba abs(resultado))', montoBaseComisionExacto(-150, true), 0);
assertEq('sinComision=true, resultado 0 -> base 0', montoBaseComisionExacto(0, true), 0);
// sinComision=false: se comporta idéntico a montoDecididoExacto (sin cambios).
assertEq('sinComision=false, ganó -> igual que montoDecididoExacto', montoBaseComisionExacto(200, false), montoDecididoExacto(200, false));
assertEq('sinComision=false, perdió -> igual que montoDecididoExacto', montoBaseComisionExacto(-150, false), montoDecididoExacto(-150, false));
assertEq('sinComision=false, ganó 190 (de 1000*0.2*0.95) -> base 200 (des-escalado)', montoBaseComisionExacto(190, false), 200);

// ================= 2) netearJugadorBanqueroTercios: un solo rol, con y sin sinComision =================
{
  // GIANCO juega 2 líneas en la misma carrera: una normal (ganó, $190 =
  // 200 des-escalado) y una "a premio" sinComision (ganó $300 neto, debe
  // aportar $0 a la base).
  const tickets = [
    { clienteNombre: 'GIANCO', banqueroNombre: 'CASA', resultadoJugador: 190, resultadoBanquero: -190, sinComision: false, fecha: '2026-10-04', hipodromoNombre: 'LRC', carreraNumero: 1 },
    { clienteNombre: 'GIANCO', banqueroNombre: 'CASA', resultadoJugador: 300, resultadoBanquero: -300, sinComision: true, fecha: '2026-10-04', hipodromoNombre: 'LRC', carreraNumero: 1 }
  ];
  const neto = netearJugadorBanqueroTercios(tickets);
  const info = neto.get('2026-10-04::LRC::1').get('GIANCO');
  assertEq('GIANCO: decididoJugador solo cuenta la línea normal (200), no la sinComision (300)', info.decididoJugador, 200);
  assertEq('GIANCO: no es dual (nunca banqueó)', info.dual, false);
  assertEq('GIANCO: netoExacto = solo la base normal (200)', info.netoExacto, 200);
}
{
  // Caso límite: TODAS las líneas de un cliente en la carrera son
  // sinComision -- debe quedar una entrada con todo en 0 (nunca undefined,
  // para que los llamadores no caigan en un fallback que recalcule mal).
  const tickets = [
    { clienteNombre: 'SOLO_A_PREMIO', banqueroNombre: 'CASA', resultadoJugador: 500, resultadoBanquero: -500, sinComision: true, fecha: '2026-10-04', hipodromoNombre: 'LRC', carreraNumero: 2 }
  ];
  const neto = netearJugadorBanqueroTercios(tickets);
  const info = neto.get('2026-10-04::LRC::2').get('SOLO_A_PREMIO');
  assertEq('cliente con TODO sinComision: entrada existe (no undefined)', !!info, true);
  assertEq('cliente con TODO sinComision: decididoJugador 0', info.decididoJugador, 0);
  assertEq('cliente con TODO sinComision: netoExacto 0', info.netoExacto, 0);
  assertEq('cliente con TODO sinComision: dual false', info.dual, false);
}

// ================= 3) El raw de una línea sinComision NO contamina "ganó en los 2 lados" =================
{
  // LOBA: jugador normal PERDIÓ $50 (decididoJugador=50, sumaJugador=-50) +
  // además jugó una línea "a premio" sinComision que GANÓ $1000 (debe
  // aportar $0 a decididoJugador y NO debe sumar su +1000 a sumaJugador,
  // porque eso haría que sumaJugador diera positivo y disparara por error
  // la regla de "ganó en los 2 lados" de más abajo).
  // Banquero: ganó $30 banqueando (decididoBanquero ~31.58, sumaBanquero=30).
  const tickets = [
    { clienteNombre: 'LOBA', banqueroNombre: 'CASA', resultadoJugador: -50, resultadoBanquero: 50, sinComision: false, fecha: '2026-10-04', hipodromoNombre: 'LRC', carreraNumero: 3 },
    { clienteNombre: 'LOBA', banqueroNombre: 'CASA', resultadoJugador: 1000, resultadoBanquero: -1000, sinComision: true, fecha: '2026-10-04', hipodromoNombre: 'LRC', carreraNumero: 3 },
    { clienteNombre: 'CASA2', banqueroNombre: 'LOBA', resultadoJugador: -30, resultadoBanquero: 30, sinComision: false, fecha: '2026-10-04', hipodromoNombre: 'LRC', carreraNumero: 3 }
  ];
  const neto = netearJugadorBanqueroTercios(tickets);
  const info = neto.get('2026-10-04::LRC::3').get('LOBA');
  assertEq('LOBA: decididoJugador solo la línea normal (50, abs de la pérdida)', info.decididoJugador, 50);
  const decididoBanqueroEsperado = montoDecididoExacto(30, false); // 30/0.95
  // info.decididoBanquero viene round2() (display), compararlo contra el
  // esperado también redondeado -- netoExacto más abajo sí usa el valor
  // SIN redondear internamente.
  assertEq('LOBA: decididoBanquero la línea normal des-escalada', info.decididoBanquero, round2(decididoBanqueroEsperado));
  assertEq('LOBA: es dual (jugó y banqueó, ambos lados > 0)', info.dual, true);
  // Si sumaJugador hubiera incluido el +1000 de la línea sinComision,
  // sumaJugador habría dado +950 (positivo) y sumaBanquero +30 (positivo)
  // -> "ganó en los 2 lados" -> netoExacto = SUMA (50 + 31.58 = 81.58).
  // Con la exclusión correcta, sumaJugador = -50 (negativo) -> NO ganó en
  // los 2 lados -> netoExacto = DIFERENCIA (|50 - 31.58| = 18.42).
  const netoEsperado = Math.abs(50 - decididoBanqueroEsperado);
  assertEq('LOBA: netoExacto usa RESTA (la línea sinComision no disparó "ganó los 2 lados")', info.netoExacto, netoEsperado);
}

console.log(`\n${ok} OK, ${fallaron} FALLARON`);
if (fallaron > 0) process.exit(1);
