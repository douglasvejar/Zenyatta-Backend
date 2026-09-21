// =================================================================
// PRUEBA: services/fechaSemana.js — número de semana ISO-8601 (21-09-2026,
// nuevo, para el header de "📅 Saldos Semana": "semana en la que estamos
// del año"). Casos de borde tomados de tablas de referencia ISO-8601
// conocidas (el "año-ISO" de una semana puede diferir del año calendario
// en los bordes de diciembre/enero).
// =================================================================
const path = require('path');
const { calcularSemana, numeroSemanaISO, formatearFechaISO } = require(path.join(__dirname, '..', 'src', 'services', 'fechaSemana'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// --- Semana 1 siempre contiene el 4 de enero ---
check(JSON.stringify(numeroSemanaISO('2026-01-04')) === JSON.stringify({ anio: 2026, semana: 1 }), '4 de enero de 2026 siempre es semana 1 de 2026 (regla ISO)');

// --- Bordes diciembre/enero: el año-ISO puede no ser el año calendario ---
check(JSON.stringify(numeroSemanaISO('2024-12-30')) === JSON.stringify({ anio: 2025, semana: 1 }), 'lunes 30-dic-2024 ya es semana 1 de 2025 (el jueves de esa semana, 2-ene-2025, cae en 2025)');
check(JSON.stringify(numeroSemanaISO('2025-12-31')) === JSON.stringify({ anio: 2026, semana: 1 }), 'miércoles 31-dic-2025 ya es semana 1 de 2026');
check(JSON.stringify(numeroSemanaISO('2023-01-01')) === JSON.stringify({ anio: 2022, semana: 52 }), 'domingo 1-ene-2023 todavía es semana 52 de 2022 (el lunes de esa semana es 26-dic-2022)');

// --- Años con 53 semanas ISO (más raros, buena prueba de que el
// redondeo del cálculo no se rompe en el borde) ---
check(JSON.stringify(numeroSemanaISO('2020-12-31')) === JSON.stringify({ anio: 2020, semana: 53 }), 'jueves 31-dic-2020 es semana 53 de 2020 (2020 es de los años con 53 semanas ISO)');

// --- calcularSemana(): rango lunes-domingo + número, para cualquier día
// de esa semana (no solo el lunes) ---
['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'].forEach(fecha => {
  const s = calcularSemana(fecha);
  check(s.desde === '2026-09-14' && s.hasta === '2026-09-20', 'calcularSemana("' + fecha + '") da la MISMA semana (lunes 14 a domingo 20) sin importar qué día de la semana se pida');
  check(s.anio === 2026 && s.semana === numeroSemanaISO('2026-09-14').semana, 'calcularSemana("' + fecha + '") trae el número de semana correcto');
});

// --- El lunes de la semana siempre es el primer día devuelto ---
const semanaLunes = calcularSemana('2026-09-14');
check(new Date(semanaLunes.desde + 'T00:00:00Z').getUTCDay() === 1, 'semana.desde siempre cae en LUNES (día 1)');
check(new Date(semanaLunes.hasta + 'T00:00:00Z').getUTCDay() === 0, 'semana.hasta siempre cae en DOMINGO (día 0)');

// --- formatearFechaISO: redondeo trivial de ida y vuelta ---
check(formatearFechaISO(new Date('2026-03-05T00:00:00Z')) === '2026-03-05', 'formatearFechaISO formatea con ceros a la izquierda (mes y día de un solo dígito)');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
