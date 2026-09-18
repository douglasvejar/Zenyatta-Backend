// =================================================================
// PRUEBAS: formato real del grupo "Bernal" (04-09-2026, a pedido del
// usuario, con un mensaje real de su grupo) — un estilo de sábana bien
// distinto al de siempre:
//   1. Banner propio del grupo ("*DEPORTES BERNAL VERDURA⚾⚽*") y el
//      nombre del día en letras ("*JUEVES*") arriba de todo, en vez de
//      (o antes de) una fecha.
//   2. Cada ticket se cierra con "<arriesgo> para <ganancia>" en su
//      propia línea (ej. "500 para 1121"), no con "arriesga//paga" ni con
//      "para <ganancia>" a secas.
//   3. El nombre del cliente ("Bernal") va DESPUÉS de cada ticket, a modo
//      de firma — no ANTES, como el resto del sistema esperaba.
//   4. El encabezado de ticket trae un "#" ("*Ticket #1*"), que antes no
//      se reconocía (la línea entera colaba como si fuera una jugada más).
//
// Es lógica 100% pura (parser.js) — no depende de base de datos ni de la
// API real de MLB, mismo espíritu que test_logica.js.
// =================================================================
const { parsearSabana } = require('../src/services/parser');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const TEXTO_BERNAL = [
  '*DEPORTES BERNAL VERDURA⚾⚽*',
  '🔥🔥🔥🔥🔥🔥🔥🔥',
  '*JUEVES*',
  '*Ticket #1*',
  '⚾ Rangers alta 7,5 -120',
  '⚾ Brewers baja 5to 4,5 -130',
  '500 para 1121',
  'Bernal',
  '➖➖➖➖➖➖️➖️➖️➖️',
  '*Ticket #2*',
  '⚾ Royals baja 9 -105',
  '⚾ Tampa -119',
  '⚾ Dodgers -265',
  '100 para 394',
  'Bernal',
  '➖➖➖➖➖➖➖➖➖➖',
  '*Ticket #3*',
  '⚾ Royals baja 9 -105',
  '⚾ Tampa -119',
  '⚾ Dodgers -265',
  '200 para 789',
  'Bernal',
  '➖➖➖➖➖➖➖➖➖➖',
  '*Ticket #4*',
  '➖➖➖➖➖➖➖➖➖➖'
].join('\n');

(function testSabanaBernalCompleta() {
  const boletos = parsearSabana(TEXTO_BERNAL, {});

  check(boletos.length === 3, 'los 3 tickets con jugadas de verdad se cierran como 3 boletos (Ticket #4, vacío, no genera ningún boleto fantasma)');
  check(boletos.every(b => b.cliente === 'BERNAL'), 'los 3 quedan atribuidos a "BERNAL" — la firma que viene DESPUÉS de cada ticket se aplicó retroactivamente en vez de perderse bajo "GENERAL"');
  check(boletos.map(b => b.ticket).join(',') === 'Ticket #1,Ticket #2,Ticket #3', '"*Ticket #1*"/"#2"/"#3" (con el "#") se reconocen bien como encabezado de ticket, con su número correcto');

  check(boletos[0].arriesga === 500 && boletos[0].pagaSabana === 1121, 'Ticket #1: "500 para 1121" se lee como arriesga=500, paga=1121 (los 2 números tal cual, sin calcular nada desde la cuota)');
  check(boletos[1].arriesga === 100 && boletos[1].pagaSabana === 394, 'Ticket #2: "100 para 394" igual');
  check(boletos[2].arriesga === 200 && boletos[2].pagaSabana === 789, 'Ticket #3: "200 para 789" igual');

  check(boletos[0].jugadas.length === 2 && boletos[0].jugadas.every(j => !/ticket/i.test(j)), 'Ticket #1 solo tiene sus 2 jugadas reales — ni el encabezado "Ticket #1" ni la firma "Bernal" ni el banner/día colaron adentro');
  check(boletos[0].jugadas[0].includes('Rangers') && boletos[0].jugadas[1].includes('Brewers'), 'las 2 jugadas del parley del Ticket #1 se guardan completas (equipo + línea + cuota)');
})();

(function testUsoClasicoSigueIgual() {
  // Regresión: el uso de SIEMPRE (nombre del cliente ANTES de sus tickets)
  // no se tiene que romper con el arreglo de la firma-al-final.
  const textoClasico = [
    '*RICKY*',
    'Ticket 1',
    'houston -120',
    '100//90'
  ].join('\n');
  const boletos = parsearSabana(textoClasico, {});
  check(boletos.length === 1 && boletos[0].cliente === 'RICKY', 'formato clásico (nombre ANTES de sus tickets) sigue funcionando exactamente igual que siempre');
})();

(function testMultipleClientesClasicoNoSeCorrompe() {
  // Regresión CRÍTICA: una sábana clásica con 2+ clientes (nombre antes de
  // cada uno) nunca se tiene que ver afectada por el arreglo de la firma
  // al final — el nombre del SEGUNDO cliente no puede "contaminar" hacia
  // atrás los tickets ya cerrados del PRIMERO.
  const textoDosClientes = [
    '*RICKY*',
    'Ticket 1',
    'houston -120',
    '100//90',
    '*MANOLO*',
    'Ticket 1',
    'yankees -110',
    '50//45'
  ].join('\n');
  const boletos = parsearSabana(textoDosClientes, {});
  check(boletos.length === 2, 'los 2 tickets de los 2 clientes se cierran normal');
  check(boletos[0].cliente === 'RICKY' && boletos[1].cliente === 'MANOLO', 'cada uno queda con SU PROPIO cliente — el nombre de MANOLO (el segundo) no reescribe retroactivamente el ticket ya cerrado de RICKY (el primero), porque clienteActual ya no era "GENERAL" cuando apareció "MANOLO"');
})();

(function testFirmaConSimboloPegadoAlNombre() {
  // 18-09-2026, ticket real del usuario: "Ticket #1 / ⚽ Cristal palace 1h
  // rl -0,5 -136 / 272 para 200 / ❌Hanry" — mismo mecanismo de "firma al
  // final" que Bernal, pero con el símbolo de resultado (✅❌⭕) PEGADO al
  // nombre, sin espacio, y con VARIOS clientes distintos en la misma
  // sábana (no un solo cliente repetido como Bernal) — el usuario avisó
  // que esto se envía así y "no puede haber problemas con eso".
  const textoDosFirmasConSimbolo = [
    'Ticket #1',
    'Yankees -150',
    '100 para 190',
    '✅Gianco',
    'Ticket #1',
    'Cristal palace 1h rl -0.5 -136',
    '272 para 200',
    '❌Hanry'
  ].join('\n');
  const boletos = parsearSabana(textoDosFirmasConSimbolo, {});

  check(boletos.length === 2, 'los 2 tickets (uno de Gianco, otro de Hanry) se cierran como 2 boletos — NINGÚN boleto fantasma "Sin Ticket"/$0 por la firma mal leída');
  check(boletos[0].cliente === 'GIANCO' && boletos[1].cliente === 'HANRY', 'CADA ticket queda con SU PROPIO cliente correcto — la firma de Gianco no se le pega al ticket de Hanry (el bug real: antes, el segundo ticket heredaba el cliente de la firma ANTERIOR porque clienteActual ya no era "GENERAL")');
  check(boletos[0].arriesga === 100 && boletos[0].pagaSabana === 190, 'Ticket de Gianco: "100 para 190" se sigue leyendo igual (arriesga/paga tal cual)');
  check(boletos[1].arriesga === 272 && boletos[1].pagaSabana === 200, 'Ticket de Hanry: "272 para 200" también');
  check(boletos[0].marcadorManual === '✅' && boletos[1].marcadorManual === '❌', 'el símbolo pegado al nombre (✅/❌) se guarda como el marcador manual de CADA ticket — antes se perdía por completo, sin que procesarSabana.js pudiera compararlo contra el resultado real');
  check(boletos[0].jugadas.length === 1 && boletos[0].jugadas[0].includes('Yankees'), 'las jugadas de Gianco no se mezclan con las de Hanry');
  check(boletos[1].jugadas.length === 1 && boletos[1].jugadas[0].includes('Cristal palace'), 'las jugadas de Hanry no se mezclan con las de Gianco');
})();

(function testFirmaConSimboloDespuesDelNombre() {
  // Regresión de la otra forma del mismo patrón: el símbolo puede ir
  // DESPUÉS del nombre en vez de antes ("Hanry❌"), mismo resultado.
  const texto = [
    'Ticket 1',
    'Dodgers -150',
    '50 para 90',
    'Hanry❌'
  ].join('\n');
  const boletos = parsearSabana(texto, {});
  check(boletos.length === 1 && boletos[0].cliente === 'HANRY' && boletos[0].marcadorManual === '❌', '"Hanry❌" (símbolo DESPUÉS del nombre) se reconoce igual de bien que "❌Hanry"');
})();

(function testFirmaSinSimboloSigueFuncionandoConVariosClientes() {
  // Regresión: la firma "clásica" de Bernal (sin ningún símbolo, solo el
  // nombre a secas) también tiene que encadenar bien con VARIOS clientes
  // distintos, no solo con uno repetido — mismo arreglo (clienteActual
  // vuelve a "GENERAL" después de cada firma), sin el símbolo de por medio.
  const texto = [
    'Ticket 1',
    'Yankees -150',
    '100 para 190',
    'Gianco',
    'Ticket 1',
    'Dodgers -150',
    '50 para 90',
    'Hanry'
  ].join('\n');
  const boletos = parsearSabana(texto, {});
  check(boletos.length === 2 && boletos[0].cliente === 'GIANCO' && boletos[1].cliente === 'HANRY', 'firma sin símbolo, con 2 clientes distintos: cada ticket queda con su propio cliente, sin ningún marcadorManual (no había símbolo)');
  check(!boletos[0].marcadorManual && !boletos[1].marcadorManual, 'sin símbolo en la firma, no se inventa ningún marcadorManual');
})();

(function testBannerYDiaNuncaSonCliente() {
  // Si el banner/día de la semana llegaran a colarse como si fueran el
  // nombre de un cliente, todo lo que sigue quedaría mal atribuido a
  // "DEPORTES BERNAL VERDURA" o "JUEVES" en vez de a "GENERAL"/al cliente
  // real — se verifica que NINGUNO de los boletos termine con esos
  // "clientes" fantasma.
  const boletos = parsearSabana(TEXTO_BERNAL, {});
  const clientesRaros = boletos.filter(b => /DEPORTES|JUEVES/i.test(b.cliente));
  check(clientesRaros.length === 0, 'ningún boleto queda atribuido al banner del grupo o al nombre del día — ambos se ignoran como decoración, nunca como nombre de cliente');
})();

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exitCode = fallaron > 0 ? 1 : 0;
