// =================================================================
// PRUEBA: planoWhatsAppTexto.js — el texto que arma el propio SERVIDOR
// para mandar por WhatsApp (listado en vivo + cierre), sin navegador de
// por medio (03-09-2026, más tarde todavía).
//
// 100% pura — sin base de datos ni red. Los "resp" de acá tienen
// exactamente la misma forma que devuelve procesarSabana() (ver
// test_sabana_polla_y_mayusculas.js, que prueba esos mismos campos:
// tickets[].{cliente,ticket,jugadas,arriesga,paga,estado} y
// planoWhatsApp.{totalesClientes[].{cliente,totalBanca,devolucion,polla,
// jugoHoy,jugoPolla}, totalBanca, totalBancaPolla, pollaRegistrada}),
// así que las fórmulas se verifican con la MISMA convención que ya usa
// el resto del proyecto (resultadoSabana = -totalBanca - devolucion).
// =================================================================
const {
  formatMontoPlano,
  formatDineroPlano,
  formatLineaResultadoPlano,
  agruparTicketsPorCliente,
  generarTextoListadoSabana,
  generarTextoTotalesDia
} = require('../src/services/planoWhatsAppTexto');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- 1) formatMontoPlano: sin ceros de más, sin ".00" ---
check(formatMontoPlano(100) === '100', 'formatMontoPlano(100) = "100" (entero, sin decimales)');
check(formatMontoPlano(100.5) === '100.5', 'formatMontoPlano(100.5) = "100.5" (un decimal, sin ceros de más)');
check(formatMontoPlano(90) === '90', 'formatMontoPlano(90) = "90"');
check(formatMontoPlano(45.25) === '45.25', 'formatMontoPlano(45.25) conserva los 2 decimales cuando hacen falta');

// --- 2) formatDineroPlano: signo +/- siempre, 2 decimales, "$" al final ---
check(formatDineroPlano(70) === '+70.00$', 'formatDineroPlano(70) = "+70.00$"');
check(formatDineroPlano(-70) === '-70.00$', 'formatDineroPlano(-70) = "-70.00$"');
check(formatDineroPlano(0) === '+0.00$', 'formatDineroPlano(0) = "+0.00$" (cero cuenta como positivo)');

// --- 3) formatLineaResultadoPlano: un ícono distinto por estado ---
check(formatLineaResultadoPlano(100, 90, 'GANADA') === '100//90✅', 'GANADA: "arriesga//paga✅"');
check(formatLineaResultadoPlano(100, 90, 'PERDIDA') === '❌100//90', 'PERDIDA: "❌arriesga//paga"');
check(formatLineaResultadoPlano(100, 0, 'ANULADA') === '⭕100//', 'ANULADA: "⭕arriesga//" (sin monto de pago)');
check(formatLineaResultadoPlano(100, 0, 'SUSPENDIDA') === '⭕100//', 'SUSPENDIDA: mismo ícono que ANULADA');
check(formatLineaResultadoPlano(100, 0, 'PENDIENTE') === '100//', 'PENDIENTE (o cualquier estado abierto): "arriesga//" sin ícono todavía');

// --- 4) agruparTicketsPorCliente: agrupa preservando orden de aparición ---
const ticketsCrudos = [
  { cliente: 'GIANCO', ticket: 'Ticket #1', jugadas: ['houston -120'], arriesga: 100, paga: 90, estado: 'GANADA' },
  { cliente: 'MANOLO', ticket: 'Ticket #1', jugadas: ['miami -110'], arriesga: 50, paga: 0, estado: 'PENDIENTE' },
  { cliente: 'GIANCO', ticket: 'Ticket #2', jugadas: ['dallas +150'], arriesga: 40, paga: 0, estado: 'PERDIDA' }
];
const grupos = agruparTicketsPorCliente(ticketsCrudos);
check(grupos.length === 2, 'agruparTicketsPorCliente: 2 clientes distintos -> 2 grupos');
check(grupos[0].cliente === 'GIANCO' && grupos[0].boletos.length === 2, 'GIANCO aparece primero (orden de aparición) con sus 2 tickets');
check(grupos[1].cliente === 'MANOLO' && grupos[1].boletos.length === 1, 'MANOLO aparece después, con su único ticket');
check(grupos[0].boletos[0].estadoFinal === 'GANADA' && grupos[0].boletos[1].estadoFinal === 'PERDIDA', 'cada boleto agrupado conserva su propio estado');

// --- 5) generarTextoListadoSabana: título distinto según opciones.esFinal ---
const respListado = {
  fecha: '2026-09-03',
  tickets: [
    { cliente: 'GIANCO', ticket: 'Ticket #1', jugadas: ['houston -120'], arriesga: 100, paga: 90, estado: 'GANADA' },
    { cliente: 'MANOLO', ticket: 'Ticket #1', jugadas: ['miami -110'], arriesga: 50, paga: 0, estado: 'PENDIENTE' }
  ]
};
const textoActualizacion = generarTextoListadoSabana(respListado, { esFinal: false });
check(textoActualizacion.includes('🔄 *Actualización de resultados*'), 'esFinal:false -> título de "Actualización de resultados"');
check(!textoActualizacion.includes('SÁBANA FINAL'), 'esFinal:false -> NO dice "SÁBANA FINAL" en ningún lado');
check(textoActualizacion.includes('03-09-2026'), 'la fecha se muestra en formato DD-MM-YYYY');
check(textoActualizacion.includes('*GIANCO*') && textoActualizacion.includes('*MANOLO*'), 'ambos clientes aparecen, cada uno con su nombre en negrita');
check(textoActualizacion.includes('100//90✅'), 'el ticket GANADA de GIANCO trae su línea de resultado con el ícono correcto');
check(textoActualizacion.includes('50//'), 'el ticket PENDIENTE de MANOLO todavía no trae ícono (sigue abierto)');

const textoCierre = generarTextoListadoSabana(respListado, { esFinal: true });
check(textoCierre.includes('✅ *SÁBANA FINAL — todos los resultados*'), 'esFinal:true -> título de cierre "SÁBANA FINAL"');

const textoSinTickets = generarTextoListadoSabana({ fecha: '2026-09-03', tickets: [] }, {});
check(textoSinTickets.includes('(sin tickets todavía)'), 'un día sin tickets todavía no revienta, avisa "(sin tickets todavía)"');

// --- 6) generarTextoTotalesDia: mismas fórmulas que el Plano de WhatsApp de siempre ---
// Mismo criterio ya verificado en test_sabana_polla_y_mayusculas.js:
// resultadoSabana = -totalBanca - devolucion ; totalDiaCliente = resultadoSabana + polla.
const respTotales = {
  fecha: '2026-09-03',
  planoWhatsApp: {
    totalBanca: -70, // convención CASA (negativo = la banca pagó más de lo que ganó)
    totalBancaPolla: -70,
    pollaRegistrada: true,
    totalesClientes: [
      // PEDRO: arriesgó y ganó -> totalBanca (CASA) = 10 - 90 - 0 = -80 (perdió la casa 80 con la jugada sola);
      // resultadoSabana = -(-80) - 0 = 80 (el cliente ganó 80); con Polla -50 -> totalDiaCliente = 30.
      { cliente: 'PEDRO', totalBanca: -80, devolucion: 0, polla: -50, jugoHoy: true, jugoPolla: true },
      // SOLOPOLLA: no jugó sábana, solo Polla +120.
      { cliente: 'SOLOPOLLA', totalBanca: 0, devolucion: 0, polla: 120, jugoHoy: false, jugoPolla: true },
      // MANOLO: tiene comisión (devolucion) pero no jugó nada más hoy ni Polla -> no debería aparecer con línea de total,
      // pero SÍ con su línea de "%" si la comisión es distinta de 0.
      { cliente: 'MANOLO', totalBanca: 0, devolucion: 5, polla: 0, jugoHoy: false, jugoPolla: false }
    ]
  }
};
const textoTotales = generarTextoTotalesDia(respTotales);
check(textoTotales.includes('*TOTALES DEL DÍA*'), 'generarTextoTotalesDia: encabezado fijo "TOTALES DEL DÍA"');
check(textoTotales.includes('03-09-2026'), 'generarTextoTotalesDia: trae la fecha en DD-MM-YYYY');
check(textoTotales.includes('*PEDRO*') && textoTotales.includes('+30.00$'), 'PEDRO: resultadoSabana(80) + polla(-50) = +30.00$ (misma fórmula que el Plano de siempre)');
check(textoTotales.includes('*SOLOPOLLA*') && textoTotales.includes('+120.00$'), 'SOLOPOLLA: solo Polla, +120.00$ (aparece aunque no jugó sábana, por jugoPolla:true)');
check(!textoTotales.includes('*MANOLO*'), 'MANOLO: ni jugoHoy ni jugoPolla -> no aparece con línea de total');
check(textoTotales.includes('*% MANOLO*') && textoTotales.includes('+5.00$'), 'MANOLO: sí aparece con su línea de comisión "% MANOLO" (devolucion != 0)');
check(textoTotales.includes('*TOTAL BANCA*') && textoTotales.includes('-70.00$'), 'TOTAL BANCA general: -70.00$ (planoWhatsApp.totalBanca)');
check(textoTotales.includes('*🎲 BANCA POLLA*'), 'pollaRegistrada:true -> aparece la línea aparte de BANCA POLLA');

const respTotalesSinPolla = {
  fecha: '2026-09-04',
  planoWhatsApp: { totalBanca: 40, totalBancaPolla: 0, pollaRegistrada: false, totalesClientes: [] }
};
const textoTotalesSinPolla = generarTextoTotalesDia(respTotalesSinPolla);
check(!textoTotalesSinPolla.includes('BANCA POLLA'), 'pollaRegistrada:false -> NO aparece la línea de BANCA POLLA (mismo criterio que el Plano de siempre)');
check(textoTotalesSinPolla.includes('+40.00$'), 'sin clientes con jugadas, igual muestra el TOTAL BANCA general');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
