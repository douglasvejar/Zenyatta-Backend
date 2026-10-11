// PRUEBA (11-10-2026): ticket real "🏈 Toledo alta naacaf 55.5 -105 /
// 🏈 Charlotte alta ncaaf 57.5 -110" — la palabra de deporte escrita al lado
// del equipo ("ncaaf") debe ganar sobre el emoji 🏈 (que significa nfl), y
// "charlotte" (solo Hornets/basket pelado) debe resolverse a Charlotte 49ers
// cuando el deporte explícito es NCAAF.
const assert = require('assert');
const { detectarMarcadorDeporteEnTexto: det } = require('../src/services/parser');
const { evaluarJugada } = require('../src/services/evaluador');
const { DICCIONARIO_EQUIPOS_BASE: DIC } = require('../src/services/diccionarioEquipos');
const { normalizarTexto } = require('../src/services/normalizar');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('OK ' + m); };

ok(det('🏈 Charlotte alta ncaaf 57.5 -110') === 'ncaaf', 'palabra ncaaf gana sobre 🏈');
ok(det('🏈 Toledo alta naacaf 55.5 -105') === 'ncaaf', 'typo naacaf se reconoce como ncaaf');
ok(det('🏈 Houston Texans -3') === 'nfl', '🏈 solo sigue siendo nfl');
ok(det('Houston nba -3') === 'basket', 'palabra sola sigue igual');
ok(det('🏀 Charlotte -3') === 'basket', 'emoji solo sigue igual');

const linea = (t) => normalizarTexto(t);
const r = evaluarJugada(linea('Charlotte alta ncaaf 57.5 -110'), {}, DIC, { deporteMarcador: 'ncaaf' });
ok(!(r.debug && r.debug.deporteMarcadorNoCoincide), 'Charlotte + ncaaf ya no cae en SIN_MAPEO por mismatch (estado ' + r.estado + ')');
ok(r.estado !== 'SIN_MAPEO', 'Charlotte + ncaaf resuelve el equipo');

const r2 = evaluarJugada(linea('Charlotte alta nfl 57.5 -110'), {}, DIC, { deporteMarcador: 'nfl' });
ok(r2.estado !== 'SIN_MAPEO', 'Charlotte + nfl tolera ncaaf (par fútbol americano)');

const r3 = evaluarJugada(linea('Texas alta ncaaf 57.5 -110'), {}, DIC, { deporteMarcador: 'ncaaf' });
ok(r3.estado === 'SIN_MAPEO', 'Texas + ncaaf (varias escuelas) NO se adivina');

const r4 = evaluarJugada(linea('Charlotte -3 -110'), {}, DIC, {});
ok(r4.estado !== 'SIN_MAPEO', 'Charlotte sin marcador sigue resolviendo a Hornets');
console.log('\n' + n + ' checks OK');
