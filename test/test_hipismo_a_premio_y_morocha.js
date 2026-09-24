// Prueba (24-09-2026, segunda ronda del mismo día): notación extendida de
// jugadas "a premio" (10@N, aN, decimales con coma), morocha (multi-
// caballo) con 3+ caballos y con modalidades décimos, separadores nuevos
// de morocha (y/guion), la regla de "43 pegado = un solo caballo", y la
// función de "sin comisión" para jugadas a premio — ver la nota grande
// al inicio de src/services/hipismoCalc.js para el detalle completo de
// lo que confirmó el usuario.
const {
  calcularPlano, resolverModalidad, resolverModalidadCompuesta, resolverModalidadMultiCaballo,
  recalcularTicket, recalcularTotalesPlano, parsearPizarra, LINEA_REGEX_COMPACTA,
  decimosN, esModalidadSinComision, parsearValoresSinComision
} = require('../src/services/hipismoCalc.js');

let ok = 0, fallaron = 0;
function assertEq(desc, real, esperado) {
  let iguales;
  if (typeof real === 'number' && typeof esperado === 'number') iguales = Math.abs(real - esperado) < 0.001;
  else if (Array.isArray(real) && Array.isArray(esperado)) {
    iguales = real.length === esperado.length && real.every((v, i) => Math.abs(v - esperado[i]) < 0.001);
  } else iguales = real === esperado;
  if (iguales) { console.log(`OK   ${desc}`); ok++; }
  else { console.log(`FAIL ${desc}: real=${JSON.stringify(real)} esperado=${JSON.stringify(esperado)}`); fallaron++; }
}
function assertTrue(desc, cond) { assertEq(desc, !!cond, true); }

// ================= 1) Notación extendida de "a premio" =================
assertEq('decimosN("10a2")', decimosN('10a2'), 2);
assertEq('decimosN("10/2")', decimosN('10/2'), 2);
assertEq('decimosN("10 a 2")', decimosN('10 a 2'), 2);
assertEq('decimosN("10@2")', decimosN('10@2'), 2);
assertEq('decimosN("a2")', decimosN('a2'), 2);
assertEq('decimosN("a 2")', decimosN('a 2'), 2);
assertEq('decimosN("10a1,75") (coma decimal)', decimosN('10a1,75'), 1.75);
assertEq('decimosN("10a2,5") (coma decimal)', decimosN('10a2,5'), 2.5);
assertEq('decimosN("a1,75") (corta + coma)', decimosN('a1,75'), 1.75);
assertEq('decimosN("1/2-1p") (combo, NO cuenta)', decimosN('1/2-1p'), null);
assertEq('decimosN("pp") (NO cuenta)', decimosN('pp'), null);
assertEq('decimosN("1p") (NO cuenta)', decimosN('1p'), null);

// Todas las formas de "10a2" dan EXACTAMENTE el mismo resultado numérico
// que ya estaba confirmado para "10/2"/"10aN" (spec sección 8).
['10a2', '10/2', '10 a 2', '10@2', 'a2', 'a 2'].forEach(forma => {
  const rGana = resolverModalidad(forma, 1);   // caballo gana -> paga 2/10
  const rPierde = resolverModalidad(forma, 3); // no gana -> pierde completo
  assertEq(`resolverModalidad("${forma}") gana, j`, rGana.j, 0.2);
  assertEq(`resolverModalidad("${forma}") pierde, j`, rPierde.j, -1);
});
// Con decimales:
{
  const r = resolverModalidad('10a1,75', 1);
  assertEq('resolverModalidad("10a1,75") gana, j', r.j, 0.175);
}

// ================= 2) Morocha (multi-caballo) de 3+ caballos =================
{
  // "Boss 1p 6,9,10 300" — gana si CUALQUIERA de los 3 coloca en el 1er puesto.
  const rank = parsearPizarra('9.6.10'); // el 9 llega 1ro
  const r = resolverModalidadMultiCaballo('1p', [6, 9, 10], rank);
  assertEq('morocha de 3 caballos, gana uno de los 3 (el 9), j', r.j, 1);
}
{
  const rank = parsearPizarra('5.6.10'); // ninguno de los 3 (6,9,10) llega 1ro
  const r = resolverModalidadMultiCaballo('1p', [6, 9, 10], rank);
  assertEq('morocha de 3 caballos, ninguno gana, j', r.j, -1);
}

// Morocha con modalidad a premio (décimos), confirmado por el usuario
// ("las marcas de dos caballos... tambien las pueden jugar 10/7 10a8"):
{
  const rank = parsearPizarra('10.7.3'); // el 7 llega 2do
  // "10a8" a los caballos 6 y 7: el 7 llega 2do -> pierde completo (décimos
  // solo paga si llega 1ro) — ninguno de los 2 caballos ganó -> pierde todo.
  const r = resolverModalidadMultiCaballo('10a8', [6, 7], rank);
  assertEq('morocha (6,7) con "10a8", ninguno llega 1ro -> j', r.j, -1);
}
{
  const rank = parsearPizarra('7.10.3'); // el 7 llega 1ro
  const r = resolverModalidadMultiCaballo('10a8', [6, 7], rank);
  assertEq('morocha (6,7) con "10a8", el 7 gana -> j (paga 8/10)', r.j, 0.8);
}

// ================= 3) Separadores nuevos de morocha (y / guion) =================
['Boss 1p 6,10 journalism 300', 'Boss 1p 6y10 journalism 300', 'Boss 1p 6-10 journalism 300'].forEach(linea => {
  const m = linea.match(LINEA_REGEX_COMPACTA);
  assertTrue(`LINEA_REGEX_COMPACTA reconoce "${linea}"`, m);
});
{
  // Las 3 formas de escribir la morocha de Boss dan el MISMO ticket guardado.
  const rank = parsearPizarra('10.5.3'); // el 10 llega 1ro
  const resultado = calcularPlano({ texto: 'Boss 1p 6y10 journalism 300', pizarra: '10.5.3', cruzar: false });
  const t = resultado.tickets[0];
  assertEq('caballo guardado de "6y10" queda normalizado a "6,10"', t.caballo, '6,10');
  assertEq('caballo guardado de "6-10" también normaliza a "6,10"',
    calcularPlano({ texto: 'Boss 1p 6-10 journalism 300', pizarra: '10.5.3', cruzar: false }).tickets[0].caballo, '6,10');
}

// ================= 4) "43" pegado sin separador = UN solo caballo =================
{
  const rank = parsearPizarra('43.5.3'); // ficticio, solo para la prueba
  const resultado = calcularPlano({ texto: 'Pedro 1p 43 juan 100', pizarra: '43.5.3', cruzar: false });
  assertEq('"43" sin separador se guarda como UN caballo, no 2', resultado.tickets[0].caballo, '43');
  assertEq('huboLineas sigue en true (se reconoció bien)', resultado.huboLineas, true);
  assertEq('no cae en sinReconocer', resultado.sinReconocer.length, 0);
}

// ================= 5) Función "sin comisión" para jugadas a premio =================
assertTrue('esModalidadSinComision("10a2", [2,3]) -> true', esModalidadSinComision('10a2', [2, 3]));
assertTrue('esModalidadSinComision NO aplica si el N no está en la lista', !esModalidadSinComision('10a2', [3]));
assertTrue('esModalidadSinComision NO aplica sin lista', !esModalidadSinComision('10a2', []));
assertTrue('esModalidadSinComision NO aplica a una combinada ("10a2-1p")', !esModalidadSinComision('10a2-1p', [2]));
assertTrue('esModalidadSinComision NO aplica a "pp"', !esModalidadSinComision('pp', [2]));
assertEq('parsearValoresSinComision(array)', parsearValoresSinComision([2, '3', '1,75']), [2, 3, 1.75]);
assertEq('parsearValoresSinComision(texto "2, 3, 1.75")', parsearValoresSinComision('2, 3, 1.75'), [2, 3, 1.75]);
assertEq('parsearValoresSinComision(undefined) -> []', parsearValoresSinComision(undefined), []);

// --- calcularPlano, modo NO cruza jugadas: 1 ticket exento + 1 normal ---
{
  const texto = 'Pedro 10a2 5 juan 1000\nPedro 1p 5 juan 200';
  const pizarra = '5.3.9'; // el 5 llega 1ro -> gana las 2 líneas
  const sinExencion = calcularPlano({ texto, pizarra, cruzar: false, valoresSinComision: [] });
  const conExencion = calcularPlano({ texto, pizarra, cruzar: false, valoresSinComision: [2] });

  // Sin exención: la línea "10a2" paga 1000*0.2=200 con 5% descontado = 190.
  assertEq('sin exención, ticket "10a2" paga con 5% (190)', sinExencion.tickets[0].resultadoJugador, 190);
  assertEq('sin exención, sinComision del ticket queda false', sinExencion.tickets[0].sinComision, false);

  // Con exención: la misma línea paga 200 NETO, sin el 5%.
  assertEq('con exención, ticket "10a2" paga NETO (200, sin 5%)', conExencion.tickets[0].resultadoJugador, 200);
  assertTrue('con exención, sinComision del ticket queda true', conExencion.tickets[0].sinComision);
  // La otra línea ("1p") NO está en la lista de exentos -> sigue con 5%.
  assertEq('la línea "1p" (no exenta) sigue pagando con 5% (190)', conExencion.tickets[1].resultadoJugador, 190);
  assertEq('sinComision de la línea "1p" queda false', conExencion.tickets[1].sinComision, false);

  // Total de PEDRO: 200 (neto) + 190 (con comisión) = 390.
  assertEq('PEDRO total (no cruza) con exención', conExencion.totalesFinales.PEDRO, 390);
  // comisionTotal: solo la línea "1p" pagó comisión (200*0.05=10) — la
  // línea exenta no aporta nada a comisionTotal.
  assertEq('comisionTotal (no cruza) con exención: solo la línea normal', conExencion.comisionTotal, 10);
}

// --- calcularPlano, modo SÍ cruza jugadas: el exento NO se netea con el resto ---
{
  // ANA juega normal "1p" (gana 1000, sin comisión todavía) y además una
  // "10a3" EXENTA que también gana (paga 300 neto). Si se netearan juntos
  // (1000+300=1300, positivo) el 5% se aplicaría sobre los 1300 -> 1235,
  // pero la línea exenta tiene que quedar AL MARGEN del pozo neteado y
  // sumarse aparte ya neta -> el total correcto es 1000*0.95 + 300 = 1250,
  // con comisionTotal = 50 (solo de la línea normal), NUNCA 65 (5% de 1300).
  const texto = 'Ana 1p 5 juan 1000\nAna 10a3 5 juan 1000';
  const pizarra = '5.3.9';
  const resultado = calcularPlano({ texto, pizarra, cruzar: true, valoresSinComision: [3] });
  assertEq('ANA total (cruza jugadas) con 1 línea exenta + 1 normal', resultado.totalesFinales.ANA, 1250);
  assertEq('comisionTotal (cruza jugadas): solo la línea normal paga 5%', resultado.comisionTotal, 50);
  // JUAN (el que pierde las 2 líneas) paga el RAW completo de cada una,
  // -1000 (línea normal, nunca se descuenta el lado que pierde) + -300
  // (línea exenta, tampoco se descuenta porque ya perdía) = -1300. Esto
  // NO es un espejo de los 1250 de ANA — el 5% de comisión (50) es la
  // diferencia que se queda la banca, ya así se comportaba "cruza
  // jugadas" ANTES de esta ronda (ver el código original: el lado que
  // pierde siempre pagó el raw completo, solo al que gana se le aplica
  // el 0.95 después de netear) — la función de "sin comisión" de hoy no
  // cambia esa asimetría, solo saca la línea exenta del pozo neteado.
  assertEq('JUAN (banquero) total (cruza jugadas)', resultado.totalesFinales.JUAN, -1300);
}

// ================= 6) recalcularTicket respeta sinComision guardado =================
{
  const rank = parsearPizarra('5.3.9'); // el 5 llega 1ro
  const normal = recalcularTicket({ modalidad: '10a3', caballo: '5', monto: 1000, sinComision: false }, rank);
  const exento = recalcularTicket({ modalidad: '10a3', caballo: '5', monto: 1000, sinComision: true }, rank);
  assertEq('recalcularTicket sin exención: 300*0.95=285', normal.resultadoJugador, 285);
  assertEq('recalcularTicket CON exención: 300 neto', exento.resultadoJugador, 300);
}

// ================= 7) recalcularTotalesPlano coincide con calcularPlano =================
{
  // Mismo escenario del punto 5 (cruza jugadas), pero armado como si viniera
  // YA GUARDADO desde hipismo_tickets (formato "mostrado" + sinComision por
  // ticket) — recalcularTotalesPlano() tiene que dar el MISMO resultado que
  // calcularPlano() dio al calcular por primera vez (1250/50), para que
  // editar cualquier OTRO ticket del mismo plano no corrompa este total.
  const ticketsGuardados = [
    { clienteNombre: 'ANA', banqueroNombre: 'JUAN', resultadoJugador: 950, resultadoBanquero: -950, sinComision: false },
    { clienteNombre: 'ANA', banqueroNombre: 'JUAN', resultadoJugador: 300, resultadoBanquero: -300, sinComision: true }
  ];
  const { totalesFinales, comisionTotal } = recalcularTotalesPlano(ticketsGuardados, true);
  assertEq('recalcularTotalesPlano ANA (cruza) coincide con calcularPlano', totalesFinales.ANA, 1250);
  assertEq('recalcularTotalesPlano comisionTotal (cruza) coincide', comisionTotal, 50);
}
{
  // Mismo, pero en modo "no cruza jugadas".
  const ticketsGuardados = [
    { clienteNombre: 'PEDRO', banqueroNombre: 'JUAN', resultadoJugador: 190, resultadoBanquero: -190, sinComision: false },
    { clienteNombre: 'PEDRO', banqueroNombre: 'JUAN', resultadoJugador: 200, resultadoBanquero: -200, sinComision: true }
  ];
  const { totalesFinales, comisionTotal } = recalcularTotalesPlano(ticketsGuardados, false);
  assertEq('recalcularTotalesPlano PEDRO (no cruza) coincide con calcularPlano', totalesFinales.PEDRO, 390);
  assertEq('recalcularTotalesPlano comisionTotal (no cruza) coincide', comisionTotal, 10);
}

console.log(`\n${ok} pruebas OK, ${fallaron} fallaron.`);
if (fallaron > 0) process.exitCode = 1;
