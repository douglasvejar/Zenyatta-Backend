// =================================================================
// PRUEBA: parsearPizarra() de services/hipismoCalc.js — separadores
// libres en la pizarra (orden de llegada) — (23-09-2026, duodécima-
// tercera ronda, a pedido del usuario: "las llegadas la puedes leer asi
// : 1.9.10.5 o 1-9-10-5 o 1,9,10,5 o 1/9/10/5, es lo mismo lo que cambia
// es la separacion"). El parseo YA era separador-agnóstico desde antes
// de este pedido (split(/[^0-9]+/) — cualquier cosa que no sea un
// dígito corta entre números), así que este archivo no cambia
// hipismoCalc.js: solo deja EXPLÍCITO, con una prueba dedicada, que los
// 4 formatos que dio el usuario (y mezclas/espacios) dan exactamente el
// mismo resultado. El cambio real de este pedido fue en el frontend
// (hints/title en los inputs de pizarra de "Cargar Planos" y "Cargar
// Remate" — ver public/hipismo-mockup.html).
// =================================================================
const path = require('path');
const { parsearPizarra } = require(path.join(__dirname, '..', 'src', 'services', 'hipismoCalc'));

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

// rank(caballo) -> posición de llegada (1 = ganador), 99 si no llegó/no está.
const FORMATOS = {
  'con puntos (1.9.10.5)': '1.9.10.5',
  'con guiones (1-9-10-5)': '1-9-10-5',
  'con comas (1,9,10,5)': '1,9,10,5',
  'con barras (1/9/10/5)': '1/9/10/5',
  'mezclado (1. 9-10,5)': '1. 9-10,5',
  'con espacios de más (1 . 9 - 10 , 5)': '1 . 9 - 10 , 5'
};

Object.entries(FORMATOS).forEach(([nombre, texto]) => {
  const rank = parsearPizarra(texto);
  check(rank(1) === 1, `Pizarra ${nombre}: el ejemplar 1 queda de 1er lugar`);
  check(rank(9) === 2, `Pizarra ${nombre}: el ejemplar 9 queda de 2do lugar`);
  check(rank(10) === 3, `Pizarra ${nombre}: el ejemplar 10 (dos dígitos) queda de 3er lugar, sin romperse con el separador`);
  check(rank(5) === 4, `Pizarra ${nombre}: el ejemplar 5 queda de 4to lugar`);
  check(rank(7) === 99, `Pizarra ${nombre}: un ejemplar que no corrió (7) da 99 (no colocó)`);
});

// Los 4 formatos del pedido del usuario dan EXACTAMENTE el mismo mapa de
// posiciones entre sí (no solo cada uno por separado contra lo esperado).
const ranks = Object.values(FORMATOS).map(txt => {
  const rank = parsearPizarra(txt);
  return [1, 9, 10, 5, 7].map(rank).join(',');
});
check(ranks.every(r => r === ranks[0]), 'Los 4 formatos (punto/guion/coma/barra) y sus mezclas dan el mismo resultado, letra por letra');

// Pizarra vacía o undefined: nadie coloca (99 para cualquiera), no revienta.
check(parsearPizarra('')(1) === 99, 'Pizarra vacía: nadie colocó, no revienta');
check(parsearPizarra(undefined)(1) === 99, 'Pizarra undefined: nadie colocó, no revienta');

console.log(`\n${pasaron} pruebas OK, ${fallaron} fallaron.`);
process.exit(fallaron > 0 ? 1 : 0);
