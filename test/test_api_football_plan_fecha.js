// Caso real 25-10-2026: tickets "1h" del día 20 quedaban PENDIENTES con el texto
// "clave inválida o límite superado", pero api-football.com respondía
// {"plan":"Free plans do not have access to this date, try from ... to ..."}.
// Ahora se detecta y el mensaje dice la causa real (plan gratis: solo ayer/hoy/mañana).
delete process.env.API_FOOTBALL_PLAN_PAGO;
process.env.API_FOOTBALL_KEY = 'clave-de-prueba';
const api = require('../src/services/apiFootballApi');
const { obtenerResultadosSoccer } = require('../src/services/soccerApi');

let ok = 0, mal = 0;
function check(c, m) { if (c) { ok++; console.log('OK: ' + m); } else { mal++; console.log('FALLÓ: ' + m); } }

(async () => {
  const hoy = new Date('2026-10-25T12:00:00Z');
  check(api.fechaFueraDeVentanaGratis('2026-10-20', hoy) === true, '20/10 queda fuera de la ventana gratis');
  check(api.fechaFueraDeVentanaGratis('2026-10-24', hoy) === false && api.fechaFueraDeVentanaGratis('2026-10-25', hoy) === false && api.fechaFueraDeVentanaGratis('2026-10-26', hoy) === false, 'ayer, hoy y mañana sí entran');
  check(api.fechaFueraDeVentanaGratis('2026-10-27', hoy) === true, 'pasado mañana queda fuera');
  check(api.esErrorDePlanPorFecha({ plan: 'Free plans do not have access to this date, try from 2026-10-24 to 2026-10-26.' }) === true, 'se reconoce el error de plan por fecha');
  check(api.esErrorDePlanPorFecha({ token: 'Error/Missing application key' }) === false && api.esErrorDePlanPorFecha([]) === false, 'otros errores no se confunden');

  // Fecha vieja: no se hace ningún pedido real y el resultado marca plan-fecha.
  let pedidos = 0;
  global.fetch = async () => { pedidos++; return { ok: true, json: async () => ({ errors: [], response: [] }) }; };
  api._resetCacheParaPruebas();
  const r = await api.obtenerPrimeraMitadApiFootball('2026-10-20');
  check(pedidos === 0, 'fecha vieja: no se gasta ningún pedido de api-football.com');
  check(r.huboError === true && r.motivoError === 'plan-fecha', 'fecha vieja: huboError con motivo plan-fecha');

  // Plan pago: sí se pide.
  process.env.API_FOOTBALL_PLAN_PAGO = '1';
  api._resetCacheParaPruebas();
  await api.obtenerPrimeraMitadApiFootball('2026-10-20');
  check(pedidos === 1, 'con API_FOOTBALL_PLAN_PAGO=1 sí se pide');
  delete process.env.API_FOOTBALL_PLAN_PAGO;

  // Error de plan que llega dentro del cuerpo (ventana calculada distinto): también se reconoce.
  const hoyReal = new Date().toISOString().slice(0, 10);
  global.fetch = async () => ({ ok: true, json: async () => ({ errors: { plan: 'Free plans do not have access to this date, try from 2026-10-24 to 2026-10-26.' }, response: [] }) });
  api._resetCacheParaPruebas();
  const r2 = await api.obtenerPrimeraMitadApiFootball(hoyReal);
  check(r2.huboError === true && r2.motivoError === 'plan-fecha', 'error de plan dentro del cuerpo -> motivo plan-fecha');

  console.log('\n' + ok + ' OK, ' + mal + ' fallaron');
  process.exit(mal ? 1 : 0);
})();
