// =================================================================
// PRUEBA: "📝 Extraer en texto" — pestaña "🗂️ Sábanas" (15-09-2026, a
// pedido del usuario: "en la seccion de sabana, coloca un boton que diga
// extraer en texto que me de esa sabana que seleccione en formato
// whatssap para asi si tengo que modificar algo poderlo hacer").
//
// generarTextoSabanaWhatsApp() vive en public/app.js (código de
// navegador: ese archivo NO está armado para importarse con require()
// desde Node, corre top-level código de DOM al cargar — ver el
// comentario grande junto a la función original). Portar todo app.js a
// algo "requireable" sería un refactor grande y riesgoso solo para poder
// probar una función pura — en vez de eso, se sigue el patrón que ya usa
// este proyecto para lógica de navegador (ver la nota grande arriba de
// generarTextoSabanaWhatsApp() en app.js): una COPIA EXACTA de la función
// pura, más abajo, marcada como tal. Si se toca la de app.js, hay que
// tocar esta también — son 2 funciones chicas y sin dependencias, así que
// el riesgo de que se desincronicen sin que alguna prueba lo note es bajo
// (y si pasa, esta prueba deja de servir de nada útil, lo cual ya es una
// señal en sí misma la próxima vez que alguien la lea).
//
// Lo que de verdad importa probar acá es el ROUND-TRIP completo: boletos
// YA PROCESADOS → generarTextoSabanaWhatsApp() → texto plano →
// parsearSabana() (la función REAL de src/services/parser.js, sin
// mockear nada) → deben salir los MISMOS boletos (mismo cliente, mismo
// arriesga, mismo gana, mismas jugadas). Eso es lo que garantiza que
// "extraer en texto" → editar a mano si hace falta → pegar de nuevo en
// "📋 Sábana" realmente funciona.
// =================================================================
const { parsearSabana } = require('../src/services/parser');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// =================================================================
// COPIA EXACTA de generarTextoSabanaWhatsApp() (y su helper
// formatearMontoParaTextoSabana()) tal como están en public/app.js —
// MANTENER SINCRONIZADA con esa versión si se toca una de las 2.
// =================================================================
function formatearMontoParaTextoSabana(monto) {
  const n = Number(monto);
  const limpio = isFinite(n) ? n : 0;
  return Number(limpio.toFixed(2)).toString();
}

function generarTextoSabanaWhatsApp(tickets) {
  const bloques = (tickets || []).map(t => {
    const lineas = [];
    lineas.push(String(t.cliente || 'GENERAL').toUpperCase());
    const ticketLabel = (t.ticket || '').trim();
    if (/^ticket\s*#?\s*\d+$/i.test(ticketLabel)) {
      lineas.push(ticketLabel);
    }
    const jugadas = String(t.detalle || '').split(' | ').map(j => j.trim()).filter(Boolean);
    jugadas.forEach(j => lineas.push(j));
    lineas.push(formatearMontoParaTextoSabana(t.arriesga) + '//' + formatearMontoParaTextoSabana(t.gana));
    return lineas.join('\n');
  });
  return bloques.join('\n\n');
}
// =================================================================
// FIN de la copia — de acá para abajo, todo es la prueba en sí.
// =================================================================

const cercaDe = (a, b, eps) => Math.abs(a - b) < (eps || 0.01);

// -----------------------------------------------------------------
// Fixture 1: 3 tickets — un parley de 2 patas, una directa de 1 pata, y
// un parley de 3 patas de otro cliente sin ticket numerado ("Sin
// Ticket", como los que se cerraron con "arriesga//paga" suelto). Montos
// con decimales, para probar que el redondeo no rompe el round-trip.
// -----------------------------------------------------------------
(function testRoundTripFixture1() {
  const ticketsFixture = [
    {
      cliente: 'PEDRO', ticket: 'Ticket #1',
      detalle: 'Yankees -150 | Dodgers -200',
      arriesga: 45.5, gana: 32.75
    },
    {
      cliente: 'PEDRO', ticket: 'Ticket #2',
      detalle: 'Rangers alta 7.5 -120',
      arriesga: 100, gana: 83.33
    },
    {
      cliente: 'MARIA JOSE', ticket: 'Sin Ticket',
      detalle: 'Lakers -110 | Heat +105 | Celtics -130',
      arriesga: 20.25, gana: 58.1
    }
  ];

  const texto = generarTextoSabanaWhatsApp(ticketsFixture);
  const boletos = parsearSabana(texto, {});

  check(boletos.length === 3, 'Fixture 1: los 3 tickets vuelven a salir como 3 boletos al reprocesar el texto generado');

  const b0 = boletos[0], b1 = boletos[1], b2 = boletos[2];
  check(b0.cliente === 'PEDRO' && b1.cliente === 'PEDRO' && b2.cliente === 'MARIA JOSE', 'Fixture 1: cada boleto vuelve con el mismo cliente (MARIA JOSE round-tripea bien aunque tenga espacio en el nombre)');

  check(cercaDe(b0.arriesga, 45.5) && cercaDe(b0.pagaSabana, 32.75), 'Fixture 1, Ticket #1 (parley 2 patas): arriesga/gana vuelven exactos ($45.50/$32.75)');
  check(cercaDe(b1.arriesga, 100) && cercaDe(b1.pagaSabana, 83.33), 'Fixture 1, Ticket #2 (directa 1 pata): arriesga/gana vuelven exactos ($100/$83.33)');
  check(cercaDe(b2.arriesga, 20.25) && cercaDe(b2.pagaSabana, 58.1), 'Fixture 1, boleto de MARIA JOSE (parley 3 patas, sin ticket numerado): arriesga/gana vuelven exactos ($20.25/$58.10)');

  check(b0.jugadas.length === 2, 'Fixture 1, Ticket #1: siguen siendo 2 patas (Yankees + Dodgers), ninguna se perdió ni se fusionó');
  check(b1.jugadas.length === 1, 'Fixture 1, Ticket #2: sigue siendo 1 sola pata (directa)');
  check(b2.jugadas.length === 3, 'Fixture 1, boleto de MARIA JOSE: siguen siendo las 3 patas (Lakers/Heat/Celtics)');

  check(b0.jugadas[0].includes('Yankees') && b0.jugadas[1].includes('Dodgers'), 'Fixture 1, Ticket #1: el texto de cada jugada se conserva tal cual (verbatim)');
})();

// -----------------------------------------------------------------
// Fixture 2: 2 clientes distintos, cada uno con un solo ticket directo,
// para confirmar que repetir el encabezado de cliente antes de CADA
// ticket (en vez de "agrupar" tickets de un mismo cliente) no rompe nada
// — y que un monto entero (sin decimales) también round-tripea bien.
// -----------------------------------------------------------------
(function testRoundTripFixture2() {
  const ticketsFixture = [
    { cliente: 'CARLOS', ticket: 'Ticket #5', detalle: 'Mets -200', arriesga: 300, gana: 150 },
    { cliente: 'ROSA', ticket: 'Ticket #1', detalle: 'White Sox 5to -115', arriesga: 287.5, gana: 250 }
  ];

  const texto = generarTextoSabanaWhatsApp(ticketsFixture);
  const boletos = parsearSabana(texto, {});

  check(boletos.length === 2, 'Fixture 2: los 2 tickets de 2 clientes distintos vuelven como 2 boletos');
  check(boletos[0].cliente === 'CARLOS' && boletos[1].cliente === 'ROSA', 'Fixture 2: cada boleto conserva su propio cliente, sin mezclarse');
  check(cercaDe(boletos[0].arriesga, 300) && cercaDe(boletos[0].pagaSabana, 150), 'Fixture 2, CARLOS: arriesga/gana enteros vuelven exactos ($300/$150)');
  check(cercaDe(boletos[1].arriesga, 287.5) && cercaDe(boletos[1].pagaSabana, 250), 'Fixture 2, ROSA: arriesga/gana vuelven exactos ($287.50/$250)');
  check(boletos[0].jugadas.length === 1 && boletos[1].jugadas.length === 1, 'Fixture 2: cada boleto sigue con su única pata directa');
})();

// -----------------------------------------------------------------
// Fixture 3: un solo ticket con 4 patas (parley grande) para confirmar
// que el round-trip también aguanta parleys de más de 3 patas, algo que
// no se probó en los fixtures anteriores.
// -----------------------------------------------------------------
(function testRoundTripFixture3ParleyGrande() {
  const ticketsFixture = [
    {
      cliente: 'F150', ticket: 'Ticket #3',
      detalle: 'Astros -180 | Braves +150 | Cubs -110 | Mets -200',
      arriesga: 10.99, gana: 97.42
    }
  ];

  const texto = generarTextoSabanaWhatsApp(ticketsFixture);
  const boletos = parsearSabana(texto, {});

  check(boletos.length === 1, 'Fixture 3: el único ticket vuelve como 1 solo boleto');
  check(boletos[0].cliente === 'F150', 'Fixture 3: el cliente (nombre alfanumérico, "F150") round-tripea bien');
  check(boletos[0].jugadas.length === 4, 'Fixture 3: las 4 patas del parley grande se conservan todas, ninguna se pierde');
  check(cercaDe(boletos[0].arriesga, 10.99) && cercaDe(boletos[0].pagaSabana, 97.42), 'Fixture 3: arriesga/gana con centavos "feos" vuelven exactos ($10.99/$97.42)');
})();

// -----------------------------------------------------------------
// Guarda de "no hay nada que extraer" (!ULTIMA_SABANA_DIA o .tickets
// vacío, en extraerTextoSabanaWhatsApp() de app.js): esa rama es 100%
// DOM (lee ULTIMA_SABANA_DIA, un global del navegador, y muestra un
// alert()) — no hay nada de lógica pura ahí para probar sin un navegador
// de por medio. Se deja constancia acá en vez de fingir una prueba: lo
// único verificable sin DOM es que generarTextoSabanaWhatsApp() no
// revienta con una lista vacía o undefined, lo cual sí se prueba abajo.
// -----------------------------------------------------------------
(function testGeneradorConListaVaciaNoRevienta() {
  check(generarTextoSabanaWhatsApp([]) === '', 'Lista de tickets vacía: el generador devuelve string vacío en vez de reventar');
  check(generarTextoSabanaWhatsApp(undefined) === '', 'Lista de tickets undefined: el generador devuelve string vacío en vez de reventar (mismo guard que usa ULTIMA_SABANA_DIA.tickets.length === 0 en app.js antes de llamar al generador)');
})();

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exitCode = fallaron > 0 ? 1 : 0;
