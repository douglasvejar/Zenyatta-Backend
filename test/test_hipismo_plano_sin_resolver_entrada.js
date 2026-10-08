// Plano SIN RESOLVER (el que da "Copiar plano sin resolver") como entrada de Cargar Planos.
const { calcularPlano, armarTextoSinResolver } = require('../src/services/hipismoCalc');
let ok = 0, mal = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK: ' + m); } else { mal++; console.log('FALLO: ' + m); } };

const MODELO = `*🇻🇪🏇🏟️HIPISMO ZENYATTA🏟️🏇🇻🇪*
Belmont Park, 4ta Carrera

*TERCIOS*
1P (6) con 150
Juega Soyganador
Consigue North

1P (6) con 50
Juega Soyganador
Consigue North

1P (6) con 50
Juega Soyganador
Consigue North

1P (6) con 200
Juega Tykhe
Consigue Risas

1P (6) con 45
Juega Tykhe
Consigue Alberto

1P (6) con 40
Juega Yankee
Consigue Zmf

------------------------------
Total Jugadas: 6
------------------------------
------------------------------
*PLANO REFERENCIAL*
*_La guía es el chat_*
(se gana y se cobra con el chat)
*USTED ES SU PROPIO CORREDOR*
*RECLAMOS AL PRIVADO*
*NO DIGA:* ❌MALO❌; CASA FALTA...
*TILDE SU JUGADA Y SE REVISARÁ*`;

// 1) El modelo del usuario se lee completo y da igual que el formato de una sola línea
let r = calcularPlano({ texto: MODELO, pizarra: '6 1 2 3', cruzar: false });
check(r.tickets.length === 6, '1) lee las 6 jugadas del modelo (obtuvo ' + r.tickets.length + ')');
check(!(r.sinReconocer && r.sinReconocer.length), '2) no deja líneas sin reconocer');
const lineaUna = `Juega Soyganador 1P (6) con 150 da North\nJuega Soyganador 1P (6) con 50 da North\nJuega Soyganador 1P (6) con 50 da North\nJuega Tykhe 1P (6) con 200 da Risas\nJuega Tykhe 1P (6) con 45 da Alberto\nJuega Yankee 1P (6) con 40 da Zmf`;
const r1 = calcularPlano({ texto: lineaUna, pizarra: '6 1 2 3', cruzar: false });
check(JSON.stringify(r.tickets) === JSON.stringify(r1.tickets) && JSON.stringify(r.totalesFinales) === JSON.stringify(r1.totalesFinales), '3) mismos tickets y totales que el formato de una sola línea');
check(r.tickets[0].clienteNombre === 'SOYGANADOR' && r.tickets[0].banqueroNombre === 'NORTH' && r.tickets[0].monto === 150, '4) cliente, banquero y monto bien leídos');

// 2) Ida y vuelta: lo que arma el botón se vuelve a leer igual (incluye cruzadas pp y nombres con espacio)
const base = calcularPlano({ texto: 'Juega Sammy 1p (3) con 225 da Zenyatta\nJuega Mr Increible pp (4x3) con 100 da North\nJuega Tykhe 1/2 (4) con 200 da Sammy'.replace('Mr Increible', 'Mr'), pizarra: '3 4 8 1 7', cruzar: false });
const tickets = base.tickets.map(t => ({ ...t }));
const texto = armarTextoSinResolver({ tickets });
check(texto === 'Juega Sammy 1p (3) con 225,00 da Zenyatta\nJuega MR pp (4x3) con 100,00 da North\nJuega Tykhe 1/2 (4) con 200,00 da Sammy', '4b) el botón da el formato de carga: una línea "Juega X mod (caballo) con monto da Y" por jugada');
const vuelta = calcularPlano({ texto, pizarra: '3 4 8 1 7', cruzar: false });
check(vuelta.tickets.length === 3, '5) el texto del botón (con una cruzada pp) se lee de vuelta: 3 jugadas (obtuvo ' + vuelta.tickets.length + ')');
check(vuelta.tickets.map(t => t.monto).join() === '225,100,200', '6) montos iguales tras la vuelta');
// formato viejo de 3 líneas (con nombre con espacio) también se sigue leyendo
const tres = calcularPlano({ texto: '1P (6) con 50\nJuega Mr Increible\nConsigue North', pizarra: '6 1 2 3', cruzar: false });
check(tres.tickets.length === 1 && tres.tickets[0].clienteNombre === 'MR INCREIBLE', '7) el modelo de 3 líneas (con nombre con espacio) se sigue leyendo');
check(vuelta.tickets[1].resultadoJugador === base.tickets[1].resultadoJugador, '8) la cruzada pp da el mismo resultado');

// 3) El formato de siempre no cambia
check(r1.tickets.length === 6 && calcularPlano({ texto: 'Juega Ana 1p (5) con 30,00 da Beto', pizarra: '5.1.2', cruzar: false }).tickets.length === 1, '9) los formatos de una línea siguen igual');

console.log(`\n${ok} pruebas OK, ${mal} fallaron.`);
process.exit(mal ? 1 : 0);
