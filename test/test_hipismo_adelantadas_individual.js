// =================================================================
// PRUEBA: las Tablas Fijas y Marcas NO se cruzan en el texto del plano
// (06-10-2026, a pedido del usuario, con una captura de "Cargar Planos":
// La Rinconada 1ra carrera, pizarra 7 3 5 2 6 -- Halland (7x1) ganaba +100,
// Hanry (2x7) perdía -120, y el bloque PARADA ADELANTADAS mostraba un solo
// "Marcas +20" neteado. "HALLAND GANA Y HANRY PIERDE, MARCAS GANA UNA Y
// PIERDE LA OTRA... LAS TABLAS Y MARCAS QUE SE CARGUEN POR ESTE MODULO NO SE
// CRUZAN... SE CALCULA CADA JUGADA INDIVIDUAL" y "QUE EN EL PLANO SE VEA
// CLIENTE Y ABAJO EL ITEM YA SEA MARCAS O TABLAS... ASI TANTAS JUGADAS
// TENGAS").
// =================================================================
const path = require('path');
const { armarBloqueAdelantadas } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoAdelantadasCalc'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) { if (cond) { pasaron++; console.log('OK:', msg); } else { fallaron++; console.error('FALLÓ:', msg); } }

// Caso de la captura: dos Marcas en la misma carrera, cada una con su espejo "MARCAS".
const marcas = [
  { nombre: 'HALLAND', monto: 100, individual: true, grupo: 'm1' }, { nombre: 'MARCAS', monto: -100, individual: true, grupo: 'm1' },
  { nombre: 'HANRY', monto: -120, individual: true, grupo: 'm2' }, { nombre: 'MARCAS', monto: 120, individual: true, grupo: 'm2' }
];
const t = armarBloqueAdelantadas(marcas);
check(t.includes('✅ Halland +100,00\nMarcas -100,00\n\n❌ Hanry -120,00\nMarcas +120,00'), '1a) cada jugada sale como un par: el cliente y, justo debajo, el ítem Marcas (Halland +100 / Marcas -100, luego Hanry -120 / Marcas +120)');
check(!/Marcas \+20,00/.test(t), '1b) YA NO sale el "Marcas +20" neteado');
check((t.match(/Marcas/g) || []).length === 2, '1c) "Marcas" tiene un renglón por cada jugada (2)');
check(!/GANAN|PIERDEN/.test(t), '1d) sin Tercios Adelantadas no hay listas GANAN/PIERDEN: solo los pares');

// Tablas Fijas: un cliente con 2 jugadas en la carrera, una gana y otra pierde.
const tf = armarBloqueAdelantadas([
  { nombre: 'ANA', monto: 50, individual: true, grupo: 'a' }, { nombre: 'TABLAS FIJAS', monto: -50, individual: true, grupo: 'a' },
  { nombre: 'ANA', monto: -30, individual: true, grupo: 'b' }, { nombre: 'TABLAS FIJAS', monto: 30, individual: true, grupo: 'b' }
]);
check(tf.includes('✅ Ana +50,00\nTablas fijas -50,00') && tf.includes('❌ Ana -30,00\nTablas fijas +30,00') && !/Ana \+20,00/.test(tf), '2) un cliente con una Tabla que gana y otra que pierde sale con sus 2 pares, sin netearse (no "+20")');

// Tantas jugadas, tantos renglones del ítem.
const cinco = [];
for (let i = 0; i < 5; i++) { cinco.push({ nombre: 'C' + i, monto: 10 * (i + 1), individual: true, grupo: i }, { nombre: 'MARCAS', monto: -10 * (i + 1), individual: true, grupo: i }); }
check((armarBloqueAdelantadas(cinco).match(/Marcas -/g) || []).length === 5, '3) 5 jugadas = 5 renglones del ítem "Marcas"');

// Si no vienen ligados por `grupo`, se emparejan de a dos en el orden recibido.
const sinGrupo = armarBloqueAdelantadas([
  { nombre: 'X', monto: 5, individual: true }, { nombre: 'MARCAS', monto: -5, individual: true },
  { nombre: 'Y', monto: -7, individual: true }, { nombre: 'MARCAS', monto: 7, individual: true }
]);
check(sinGrupo.includes('✅ X +5,00\nMarcas -5,00\n\n❌ Y -7,00\nMarcas +7,00'), '4) sin `grupo` los movimientos individuales se emparejan de a 2 en orden');

// Los movimientos que NO son Tablas/Marcas (Tercios Adelantadas) se siguen sumando por nombre.
const mezcla = armarBloqueAdelantadas([
  { nombre: 'LUIS', monto: 40 }, { nombre: 'LUIS', monto: -10 },
  { nombre: 'HALLAND', monto: 100, individual: true, grupo: 'm1' }, { nombre: 'MARCAS', monto: -100, individual: true, grupo: 'm1' }
]);
check(mezcla.includes('✅ Halland +100,00\nMarcas -100,00') && /✅ \*GANAN\*\nLuis \+30,00/.test(mezcla), '5) los pares de Marcas van primero y las Jugadas entre Tercios Adelantadas siguen sumándose por nombre en GANAN/PIERDEN');

// 08-10-2026: PARADA ADELANTADAS separada en secciones con título (Tablas Fijas / Marcas Adelantadas /
// Jugadas entre Tercios Adelantadas), cada una solo si tiene jugadas y siempre en ese orden.
const todo = armarBloqueAdelantadas([
  { nombre: 'LUIS', monto: 40 }, { nombre: 'ANA', monto: -40 },
  { nombre: 'HALLAND', monto: 100, individual: true, grupo: 'm1' }, { nombre: 'MARCAS', monto: -100, individual: true, grupo: 'm1' },
  { nombre: 'PEPE', monto: 150, individual: true, grupo: 't1' }, { nombre: 'TABLAS FIJAS', monto: -152.5, individual: true, grupo: 't1' }
]);
const iTf = todo.indexOf('📌 *TABLAS FIJAS*'), iMa = todo.indexOf('📌 *MARCAS ADELANTADAS*'), iTe = todo.indexOf('🤝 *JUGADAS ENTRE TERCIOS ADELANTADAS*');
check(iTf > 0 && iMa > iTf && iTe > iMa, '7a) las 3 secciones salen separadas y en orden: Tablas Fijas, Marcas Adelantadas, Jugadas entre Tercios Adelantadas');
check(todo.slice(iTf, iMa).includes('Pepe +150,00') && !todo.slice(iTf, iMa).includes('Halland'), '7b) en TABLAS FIJAS solo van las tablas');
check(todo.slice(iMa, iTe).includes('Halland +100,00\nMarcas -100,00') && !todo.slice(iMa, iTe).includes('Pepe'), '7c) en MARCAS ADELANTADAS solo van las marcas');
check(/GANAN\*\nLuis \+40,00/.test(todo.slice(iTe)) && /PIERDEN\*\nAna -40,00/.test(todo.slice(iTe)), '7d) en JUGADAS ENTRE TERCIOS ADELANTADAS van sus GANAN/PIERDEN por nombre');
const soloTf = armarBloqueAdelantadas([{ nombre: 'PEPE', monto: 10, individual: true, grupo: 'x' }, { nombre: 'TABLAS FIJAS', monto: -10, individual: true, grupo: 'x' }]);
check(soloTf.includes('TABLAS FIJAS') && !soloTf.includes('MARCAS ADELANTADAS') && !soloTf.includes('TERCIOS ADELANTADAS'), '7e) una sección sin jugadas no se imprime');
check(!/%/.test(todo), '7f) ninguna sección muestra porcentajes (la comisión sigue oculta)');

check(armarBloqueAdelantadas([]) === '', '6) sin movimientos no hay bloque');

console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
process.exit(fallaron ? 1 : 0);
