// =================================================================
// PRUEBA (27-10-2026): "Oklahoma city thunder rl -8.5 -115" se leía como UNDER porque "thunder" CONTIENE "under" (y quedaba
// PENDIENTE: "Ninguno de los números ... línea numérica válida"). over/under/alta/baja solo cuentan como palabra suelta.
// =================================================================
const { normalizarTexto } = require('../src/services/normalizar');
const { evaluarJugada } = require('../src/services/evaluador');
const { DICCIONARIO_EQUIPOS_BASE } = require('../src/services/diccionarioEquipos');
let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }
const juego = { homeTeam: 'Oklahoma City Thunder', awayTeam: 'Denver Nuggets', deporte: 'basket', finalizado: true, homeScore: 120, awayScore: 110, totalScore: 230,
  final1H: true, homeScore1H: 60, awayScore1H: 55, enVivo: { estadoAbstracto: 'post' } };
const basket = { 'oklahoma city thunder': juego, 'denver nuggets': juego };
const ev = t => evaluarJugada(normalizarTexto(t), { mlb: {}, nfl: {}, nhl: {}, soccer: {}, basket, ncaaf: {} }, DICCIONARIO_EQUIPOS_BASE);

let r = ev('Oklahoma city thunder rl -8.5 -115');
check(r.estado === 'GANADA' && /HÁNDICAP -8.5/.test(r.debug.tipoApuesta), 'Thunder rl -8.5: es hándicap y gana por 10 (no se lee como UNDER)');
r = ev('Thunder rl -12.5 -110');
check(r.estado === 'PERDIDA' && /HÁNDICAP/.test(r.debug.tipoApuesta), 'Thunder rl -12.5: hándicap, gana por 10 -> PERDIDA');
r = ev('Thunder +3.5 -110');
check(r.estado === 'GANADA' && /HÁNDICAP/.test(r.debug.tipoApuesta), 'Thunder +3.5 sin "rl" tampoco se lee como under');
r = ev('Oklahoma city thunder under 230.5 -110');
check(r.estado === 'GANADA' && /UNDER/.test(r.debug.tipoApuesta), 'Un "under 230.5" de verdad sigue funcionando (230 < 230.5)');
r = ev('Thunder baja 229.5 -110');
check(r.estado === 'PERDIDA' && /UNDER/.test(r.debug.tipoApuesta), '"baja" sigue funcionando');
r = ev('Thunder alta 229.5 -110');
check(r.estado === 'GANADA' && /OVER/.test(r.debug.tipoApuesta), '"alta" sigue funcionando');
r = ev('Thunder over 229.5 -110');
check(r.estado === 'GANADA' && /OVER/.test(r.debug.tipoApuesta), '"over" sigue funcionando');
r = ev('Thunder under230.5');
check(/UNDER/.test(r.debug.tipoApuesta), '"under230.5" (pegado al número) sigue valiendo');

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron ? 1 : 0);
