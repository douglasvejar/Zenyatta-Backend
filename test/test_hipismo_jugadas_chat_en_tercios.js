// =================================================================
// PRUEBA (18-11-2026): las jugadas que el bot leyó del chat de WhatsApp salen en la sección TERCIOS del plano resuelto
// (texto e imagen), con las mismas líneas de una jugada de Tercios normal, y NO en "PARADA ADELANTADAS".
// =================================================================
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:1/x';
const assert = require('assert');
const router = require('../src/routes/hipismo');
const { armarTextoResultado } = require('../src/services/hipismoCalc');
const { armarDatosImagenPlano } = require('../src/services/hipismoPlanoImagen');
const motor = require('../src/services/hipismoJugadasChat');

let ok = 0, mal = 0;
function check(c, m) { try { assert.ok(c); ok++; console.log('OK: ' + m); } catch (e) { mal++; console.log('FALLÓ: ' + m); } }

const vacio = { salidaLineas: [], totalesFinales: {}, tickets: [] };
const v1 = { jugador: 'GOKU', banquero: 'TYKHE', modalidad: '1P', monto: 460, esCruce: false, grupo: [1], gruposA: null, gruposB: null, resultadoJugador: 437, resultadoBanquero: -460 };
const base = router.extenderPlanoConJugadasChat(vacio, [v1]);

check(base.salidaLineas.join('\n') === '1P (1) con 460,00\nJuega Goku $ +437,00\nConsigue Tykhe $ -460,00\n', 'la jugada del chat sale con las mismas líneas que una de Tercios');
check(base.totalesFinales.GOKU === 437 && base.totalesFinales.TYKHE === -460 && base.tickets.length === 1, 'suma sus resultados a GANAN/PIERDEN de Tercios y cuenta como jugada');
check(vacio.salidaLineas.length === 0 && vacio.tickets.length === 0, 'no modifica el plano original (solo presentación)');

const texto = armarTextoResultado({ nombreGrupo: 'prueba sabanas', hipodromoNombre: 'Gulfstream Park', carreraNumero: 13, ret: '', pizarra: '1.2.5.3', salidaLineas: base.salidaLineas, totalesFinales: base.totalesFinales, incluirPie: true, totalJugadas: base.tickets.length });
check(/\*TERCIOS\*\n1P \(1\) con 460,00\nJuega Goku \$ \+437,00\nConsigue Tykhe \$ -460,00/.test(texto) && /Total Jugadas: 1/.test(texto), 'en el texto del plano: TERCIOS trae la jugada y "Total Jugadas: 1"');
check(/✅ \*GANAN\*\nGoku \+437,00/.test(texto) && /❌ \*PIERDEN\*\nTykhe -460,00/.test(texto) && !/PARADA ADELANTADAS/.test(texto), 'GANAN/PIERDEN de Tercios y sin sección de adelantadas');

// cruce
const v2 = { jugador: 'CACHACO', banquero: 'MARVEL', modalidad: '10A8', monto: 22, esCruce: true, grupo: null, gruposA: [4], gruposB: [1], resultadoJugador: 22, resultadoBanquero: -17.6 };
const c2 = router.extenderPlanoConJugadasChat(vacio, [v2]);
check(c2.salidaLineas.slice(0, 3).join('|') === '10A8 (4x1) con 22,00|(4) Cachaco $ +22,00|(1) Marvel $ -17,60', 'un cruce sale como "10A8 (4x1)" con un renglón por lado');
const v3 = { ...v2, modalidad: null, gruposA: ['4', '1'], gruposB: [5] };
check(router.extenderPlanoConJugadasChat(vacio, [v3]).salidaLineas[0] === 'pp (4.1x5) con 22,00', 'un cruce sin modalidad es "pp" y varios caballos se unen con punto');

// mezcla con tickets normales
const normales = { salidaLineas: ['2p (8) con 100,00', 'Juega Luis $ +50,00', 'Consigue Ana $ -50,00', ''], totalesFinales: { LUIS: 50, ANA: -50 }, tickets: [{ clienteNombre: 'LUIS', banqueroNombre: 'ANA', modalidad: '2p', caballo: '8', monto: 100, resultadoJugador: 50, resultadoBanquero: -50 }] };
const mezcla = router.extenderPlanoConJugadasChat(normales, [v1]);
check(mezcla.tickets.length === 2 && mezcla.salidaLineas.length === 8 && mezcla.totalesFinales.LUIS === 50 && mezcla.totalesFinales.GOKU === 437, 'junto a jugadas normales: se agregan al final, sin mezclar nombres');

// jugadas que no se decidieron (ej.: 2N): salen en el plano con 0,00 y no meten a nadie en GANAN/PIERDEN
const nd = { jugador: 'TYKHE', banquero: 'GOKU', modalidad: '2N', monto: 290, esCruce: false, grupo: [8], gruposA: null, gruposB: null, resultadoJugador: 0, resultadoBanquero: 0, sinDecidir: true };
const v4 = { jugador: 'GOKU', banquero: 'TYKHE', modalidad: '3N', monto: 500, esCruce: false, grupo: [8], gruposA: null, gruposB: null, resultadoJugador: 475, resultadoBanquero: -500 };
const nd2 = { ...nd, monto: 110 };
const sd = router.extenderPlanoConJugadasChat(vacio, [nd, v4, nd2]);
check(sd.salidaLineas.slice(0, 3).join('|') === '2N (8) con 290,00|Juega Tykhe $ +0,00|Consigue Goku $ +0,00', 'una jugada sin decidir sale con 0,00 para los dos');
check(sd.tickets.length === 3 && Object.keys(sd.totalesFinales).sort().join() === 'GOKU,TYKHE' && sd.totalesFinales.GOKU === 475 && sd.totalesFinales.TYKHE === -500, 'las 3 cuentan en el plano y los totales solo suman la decidida');
const soloNd = router.extenderPlanoConJugadasChat(vacio, [nd]);
check(Object.keys(soloNd.totalesFinales).length === 0 && soloNd.tickets.length === 1, 'si solo hubo jugadas sin decidir, nadie aparece en GANAN/PIERDEN');

// datos de la imagen
const img = armarDatosImagenPlano({ grupoNombre: 'prueba sabanas', hipodromoNombre: 'Gulfstream Park', carreraNumero: 13, fecha: '2026-11-17', ret: '', pizarra: '1.2.5.3', tickets: base.tickets, totalesFinales: base.totalesFinales, movimientosAdelantadas: [] });
check(img.jugadas.length === 1 && img.jugadas[0].cliente === 'Goku' && img.jugadas[0].monto === 460 && img.jugadas[0].resultado === 437 && img.adelantadas === null, 'en la imagen: la jugada va en la tabla principal, no en adelantadas');
check(img.ganan[0][0] === 'Goku' && img.pierden[0][0] === 'Tykhe', 'en la imagen: GANAN y PIERDEN');

check(router.extenderPlanoConJugadasChat(vacio, []) === vacio && router.extenderPlanoConJugadasChat(vacio, null) === vacio, 'sin jugadas del chat el plano queda igual');
check(motor.TEXTO_PLANO_BOT === 'Jugadas del chat de WhatsApp (bot)', 'la marca que identifica las jugadas del bot es la misma que guarda el bot');

console.log('\n' + ok + ' pruebas OK, ' + mal + ' fallaron.');
process.exit(mal ? 1 : 0);
