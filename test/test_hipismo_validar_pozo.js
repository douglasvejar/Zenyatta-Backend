// =================================================================
// PRUEBA: Validar Plano — qué Tercios no le alcanzan al cliente con su pozo (14-10-2026).
// Se prueba validarTerciosContraPozo() con la base y el cálculo de pozo SIMULADOS (sin red).
// =================================================================
const Module = require('module');
const path = require('path');
const original = Module._load;
const POZOS = { PEDRO: 100, ANA: 0, LUIS: -50, MARIO: 1000 };
const JUGADORES = [
  { nombre: 'PEDRO', tipo_cuenta: 'avalado' }, { nombre: 'ANA', tipo_cuenta: 'avalado' },
  { nombre: 'LUIS', tipo_cuenta: 'avalado' }, { nombre: 'MARIO', tipo_cuenta: 'avalado' },
  { nombre: 'SINPOZO', tipo_cuenta: 'libre', sin_pozo: true }, { nombre: 'LIBRE2', tipo_cuenta: 'libre', sin_pozo: false }
];
Module._load = function (request, parent, isMain) {
  const base = parent && parent.filename ? path.basename(parent.filename) : '';
  if (base === 'hipismoEnJuego.js' && request === '../db') return { query: async () => ({ rows: [] }) }; // sin adelantadas pendientes
  if (base === 'hipismoAlertaPozo.js' && request === '../db') {
    return { query: async (sql, params) => ({ rows: JUGADORES.filter(j => params[1].includes(j.nombre)) }) };
  }
  if (base === 'hipismoAlertaPozo.js' && request === './pozo') {
    return { calcularPozoJugador: async (g, j) => ({ pozoDisponible: POZOS[j.nombre] }) };
  }
  return original.apply(this, arguments);
};
const { validarTerciosContraPozo, detectarApuestasSobrePozo, detectarPozoBajo, mensajeApuestaSobrePozo } = require('../src/services/hipismoAlertaPozo');
Module._load = original;

let ok = 0, mal = 0;
function chequear(nombre, cond, extra) { if (cond) { ok++; console.log('OK: ' + nombre); } else { mal++; console.log('FALLÓ: ' + nombre + (extra ? ' -- ' + extra : '')); } }

(async () => {
  const t = (c, m, cab, monto) => ({ clienteNombre: c, modalidad: m, caballo: cab, monto });
  // 1) Pedro tiene 100: 60 entra, 50 ya no (110 > 100), 30 sí entra (90 <= 100) — se evalúa en orden y la que no cabe no gasta pozo.
  let r = await validarTerciosContraPozo('g', [t('PEDRO', '1p', 5, 60), t('PEDRO', '2p', 3, 50), t('PEDRO', '1p', 7, 30), t('MARIO', '1p', 1, 500)]);
  chequear('1a) solo sale Pedro (Mario alcanza de sobra)', r.length === 1 && r[0].nombre === 'PEDRO', JSON.stringify(r));
  chequear('1b) juegan la 1ra y la 3ra', r[0].juegan.map(j => j.monto).join() === '60,30', JSON.stringify(r[0].juegan));
  chequear('1c) no alcanza la de 50', r[0].noAlcanzan.length === 1 && r[0].noAlcanzan[0].monto === 50 && r[0].noAlcanzan[0].caballo === 3);
  chequear('1d) apostado 140, pozo 100, se pasa por 40', r[0].apostado === 140 && r[0].pozoDisponible === 100 && r[0].faltante === 40, JSON.stringify(r[0]));
  // 2) Pozo en 0 o negativo: ninguna jugada alcanza.
  r = await validarTerciosContraPozo('g', [t('ANA', '1p', 1, 10), t('LUIS', '1p', 2, 5)]);
  chequear('2a) pozo 0 y pozo negativo: salen los dos', r.length === 2);
  const luis = r.find(x => x.nombre === 'LUIS');
  chequear('2b) con pozo negativo no juega ninguna y el faltante se mide contra 0', luis.juegan.length === 0 && luis.faltante === 5 && luis.pozoDisponible === -50, JSON.stringify(luis));
  // 3) Un cliente libre / inexistente en jugadores avalados no se revisa.
  r = await validarTerciosContraPozo('g', [t('LIBRE1', '1p', 1, 999999)]);
  chequear('3) un cliente sin pozo (libre) nunca sale', r.length === 0);
  // 4) Justo en el límite sí alcanza.
  r = await validarTerciosContraPozo('g', [t('PEDRO', '1p', 5, 100)]);
  chequear('4) apostar exactamente el pozo alcanza', r.length === 0);
  // 5) Entradas raras no rompen.
  r = await validarTerciosContraPozo('g', [{ clienteNombre: '', monto: 5 }, { clienteNombre: 'PEDRO', monto: 0 }, null]);
  chequear('5) montos 0 / nombres vacíos se ignoran', r.length === 0);
  r = await validarTerciosContraPozo('g', []);
  chequear('6) sin jugadas -> vacío', Array.isArray(r) && r.length === 0);
  // 7) Cliente libre marcado "sin pozo" (06-11-2026): todavía no puede jugar nada; el libre sin marca sigue sin límites.
  r = await validarTerciosContraPozo('g', [t('SINPOZO', '1p', 1, 10), t('LIBRE2', '1p', 2, 999999)]);
  chequear('7a) el cliente "sin pozo" sale con TODAS sus jugadas sin alcanzar; el libre sin marca no sale', r.length === 1 && r[0].nombre === 'SINPOZO' && r[0].juegan.length === 0 && r[0].noAlcanzan.length === 1 && r[0].sinPozo === true, JSON.stringify(r));
  const sobre = await detectarApuestasSobrePozo('g', [{ nombre: 'SINPOZO', monto: 25 }, { nombre: 'SINPOZO', monto: 5 }, { nombre: 'LIBRE2', monto: 500 }, { nombre: 'PEDRO', monto: 50 }]);
  chequear('7b) la alerta de "apuesta más de lo que le queda" incluye al sin pozo (suma 30) y no al libre ni a Pedro (alcanza)', sobre.length === 1 && sobre[0].nombre === 'SINPOZO' && sobre[0].apostado === 30 && sobre[0].sinPozo === true, JSON.stringify(sobre));
  chequear('7c) el mensaje dice que todavía no tiene pozo y no puede jugar', /todavía NO tiene pozo: aún no puede jugar/.test(mensajeApuestaSobrePozo(sobre[0], 'GULFSTREAM 3')), mensajeApuestaSobrePozo(sobre[0], 'X'));
  const bajos = await detectarPozoBajo('g', ['SINPOZO', 'LIBRE2']);
  chequear('7d) "pozo bajo" NO avisa de un cliente sin pozo (nunca tuvo pozo que se le acabe)', bajos.length === 0, JSON.stringify(bajos));
  console.log(`\n${ok} pruebas OK, ${mal} fallaron.`);
  process.exit(mal ? 1 : 0);
})();
