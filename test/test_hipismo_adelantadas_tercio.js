// =================================================================
// PRUEBA: el plano de Tablas Fijas y Marcas con el cliente escrito como "TERCIO <cliente>"
// (09-10-2026, a pedido del usuario: "tercio significa cliente" — el cliente es el nombre que
// está al lado de la palabra TERCIO), con separadores ➖➖➖ entre clientes. Plano real pegado
// por el usuario.
// =================================================================
const assert = require('assert');
const path = require('path');
const calc = require(path.join(__dirname, '..', 'src', 'services', 'hipismoAdelantadasCalc'));

let ok = 0, mal = 0;
function check(c, m) { try { assert.ok(c); ok++; console.log('OK: ' + m); } catch (e) { mal++; console.log('FALLÓ: ' + m); } }

const PLANO = `*🇻🇪PLANOS MARCAS Y TABLAS ADELANTADAS ZENYATTA 🇻🇪*

➖➖➖➖➖➖➖➖➖➖

*#TERCIO HAALAND*

3) 5TF DEL 4 a 50 , 250/500$
4) 5TF DEL 3 a 36 , 180/500$
5) 5TF DEL 5 A 60 , 300/500$
6) 5TF DEL 5 a 60 , 300/500$
8) 5TF DEL 4 a 25 , 125/500$
11) 5TF DEL 2 a 46 , 230/500$
12) 5TF DEL 5 a 35 , 175/500$
13) 5TF DEL 9 a 48 , 240/500$

7) 6x2 120$

➖➖➖➖➖➖➖➖➖➖

*#TERCIO ZAMURAY*

10) 1x2 120$

1) 5TF DEL 2 a 1 , 5/500$

➖➖➖➖➖➖➖➖➖➖

*TERCIO HANRY*

4) 9x2 120$
4) 4x8 120$

➖➖➖➖➖➖➖➖➖➖

*TERCIO ROJAS*

8) 5TF DEL 1 A 1 , 5/500$

➖➖➖➖➖➖➖➖➖➖

*#TERCIO RAMBO*

1) 3x4 120$

1) 5TF DEL 3 a 16 , 80/500$
8) 4TF DEL 2 a 39 , 156/400$
11) 5TF DEL 7 a 4 , 20/500$

➖➖➖➖➖➖➖➖➖➖➖➖
`;

const { jugadas, sinReconocer } = calc.parsearJugadasAdelantadas(PLANO);
const de = n => jugadas.filter(j => j.cliente === n);
check(jugadas.length === 18, 'el plano real parsea las 18 jugadas (9 de HAALAND, 2 de ZAMURAY, 2 de HANRY, 1 de ROJAS, 4 de RAMBO)');
check(sinReconocer.length === 0, 'ninguna línea queda "sin reconocer" (los separadores ➖ y el encabezado se ignoran)');
check(jugadas.filter(j => j.errorCalculo).length === 0, 'ninguna línea tiene error de cálculo');
check([...new Set(jugadas.map(j => j.cliente))].join(',') === 'HAALAND,ZAMURAY,HANRY,ROJAS,RAMBO', 'el cliente es el nombre al lado de TERCIO (con o sin "#"): HAALAND, ZAMURAY, HANRY, ROJAS, RAMBO');
check(de('HAALAND').length === 9 && de('ZAMURAY').length === 2 && de('HANRY').length === 2 && de('ROJAS').length === 1 && de('RAMBO').length === 4, 'cada cliente trae sus jugadas');

const tf = de('HAALAND').find(j => j.carreraNumero === 3);
check(tf.tipo === 'tf' && tf.cantidadTf === 5 && tf.numeroEjemplar === 4 && tf.precioPorTf === 50 && tf.monto === 250 && tf.gananciaPotencial === 500, '3) 5TF DEL 4 a 50 , 250/500$ → 5 tablas fijas del 4 a 50, monto 250, ganancia 500');
const marca = de('HAALAND').find(j => j.tipo === 'marca');
check(marca.carreraNumero === 7 && marca.numero1 === 6 && marca.numero2 === 2 && marca.monto === 120, '7) 6x2 120$ → marca del 6 contra el 2, monto 120, carrera 7');
check(de('HANRY').length === 2 && de('HANRY').every(j => j.carreraNumero === 4 && j.tipo === 'marca'), 'dos marcas del mismo cliente en la misma carrera se leen las dos (9x2 y 4x8)');
check(de('RAMBO').find(j => j.carreraNumero === 8).cantidadTf === 4 && de('RAMBO').find(j => j.carreraNumero === 8).monto === 156, '8) 4TF DEL 2 a 39 , 156/400$ → 4 tablas, monto 156');
check(de('ZAMURAY').find(j => j.tipo === 'tf').precioPorTf === 1, '1) 5TF DEL 2 a 1 , 5/500$ → precio 1, monto 5');

// lo de siempre sigue igual
const viejo = calc.parsearJugadasAdelantadas('*JUGANDO PRUEBA*\n\n5) 3TF DEL 4 A 20 ,60/300$\n6) 4x7 120$\n');
check(viejo.jugadas.length === 2 && viejo.jugadas[0].cliente === 'PRUEBA' && viejo.sinReconocer.length === 0, 'el formato de siempre ("JUGANDO <cliente>") se sigue leyendo igual');
const mezcla = calc.parsearJugadasAdelantadas('*JUGANDO UNO*\n1) 4x7 120$\n➖➖➖\n*#TERCIO DOS*\n2) 1x2 120$\n');
check(mezcla.jugadas.map(j => j.cliente).join(',') === 'UNO,DOS', 'se pueden mezclar bloques JUGANDO y TERCIO en el mismo plano');
const conEspacios = calc.parsearJugadasAdelantadas('#TERCIO  JUAN   PEREZ\n3) 4x7 120$\n');
check(conEspacios.jugadas[0].cliente === 'JUAN PEREZ', 'un cliente con nombre de varias palabras se lee completo (espacios de más colapsados, en mayúsculas)');
const minusculas = calc.parsearJugadasAdelantadas('tercio rambo\n1) 3x4 120$\n');
check(minusculas.jugadas[0].cliente === 'RAMBO', 'mayúsculas/minúsculas no importan');

// lo que NO es un cliente se sigue reportando
const raro = calc.parsearJugadasAdelantadas('*TERCIOS*\n1) 4x7 120$\n');
check(raro.jugadas.length === 0 && raro.sinReconocer.length === 2, '"*TERCIOS*" (plural, el título de otros planos) NO se confunde con un cliente: la línea numerada queda sin reconocer');
const huerfana = calc.parsearJugadasAdelantadas('*#TERCIO RAMBO*\n1) esto no es una jugada\n');
check(huerfana.sinReconocer.length === 1 && huerfana.sinReconocer[0].includes('esto no es una jugada'), 'una línea numerada que no es TF ni marca sigue yendo a "sin reconocer"');

console.log('\n' + ok + ' pruebas OK, ' + mal + ' fallaron.');
process.exit(mal ? 1 : 0);
