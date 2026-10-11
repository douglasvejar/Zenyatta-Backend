// PRUEBA (11-10-2026): plano real "JUGADAS ADELANTADAS LA RINCONADA" de Jugadas
// entre Tercios Adelantadas. Antes: (1) la vista previa dejaba la columna
// "Jugada" vacía (o solo "10A8") en las líneas con cruce "NxM" porque
// textoJugadaTerciosAdelantada() no leía `l.cruce`; (2) los encabezados
// "*4TA RINCONADA*" (hipódromo en vez de "carrera") no se reconocían.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parsearPlanoTerciosAdelantadas } = require('../src/services/hipismoTerciosAdelantadasCalc');

const html = fs.readFileSync(path.join(__dirname, '../public/hipismo-mockup.html'), 'utf8');
const m = html.match(/function textoJugadaTerciosAdelantada\(l\) \{[\s\S]*?\n\}\n/);
assert.ok(m, 'se encontró textoJugadaTerciosAdelantada en el HTML');
const texto = eval('(' + m[0].replace('function textoJugadaTerciosAdelantada', 'function') + ')');

const plano = [
  '*1RA RINCONADA*', 'KRISTIAN 1Y2 DEL 1 DA MR.INCREÍBLE 120',
  '*4TA RINCONADA*', 'PUERTOLACRUZ 2x9 DA HANRY 100',
  '*7MA RINCONADA*', 'RIKY 5x3 DA RAMBO 50',
  '*9NA RINCONADA*', 'RAMBO 9x3 10a8 DA RIKY 60',
  '*13MA RINCONADA*', 'HANRY 6x2 10a8 DA RIKY 50', 'HANRY 9x7 DA HOUSTON 20', 'HANRY 9X7 10A8 DA SAM 500',
  '*🚨NOTA= JUGADAS ADELANTADAS  -3%*'
].join('\n');

const { lineas } = parsearPlanoTerciosAdelantadas(plano);
const esperado = [
  ['KRISTIAN', 1, '1 1Y2'], ['PUERTOLACRUZ', 4, '2 x 9'], ['RIKY', 7, '5 x 3'],
  ['RAMBO', 9, '9 x 3 10A8'], ['HANRY', 13, '6 x 2 10A8'], ['HANRY', 13, '9 x 7'], ['HANRY', 13, '9 x 7 10A8']
];
assert.strictEqual(lineas.length, esperado.length, '7 jugadas reconocidas');
let n = 0;
lineas.forEach((l, i) => {
  assert.strictEqual(l.jugadorNombre, esperado[i][0]);
  assert.strictEqual(l.carreraNumero, esperado[i][1], 'carrera de ' + l.lineaOriginal);
  assert.strictEqual(texto(l), esperado[i][2], 'columna Jugada de ' + l.lineaOriginal);
  n++;
  console.log('OK:', l.lineaOriginal, '->', l.carreraNumero, '|', texto(l));
});
// encabezado clásico sigue funcionando
assert.strictEqual(parsearPlanoTerciosAdelantadas('1RA CARRERA\nraul 47 con 400 da hanry').lineas[0].carreraNumero, 1);
// una jugada pública (de la base de datos, Pendientes) también se pinta igual
assert.strictEqual(texto({ esCruce: true, cruceGrupoA: [2], cruceGrupoB: [9], modalidad: null }), '2 x 9');
console.log('\n' + (n + 2) + ' checks OK');
