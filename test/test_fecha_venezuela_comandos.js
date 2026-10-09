// "Hoy" para el resumen automático de Telegram y los comandos act / saldo final / corte semana debe ser
// la fecha de Venezuela (UTC-4), no la UTC: desde las 8:00 pm de Caracas UTC ya está en el día siguiente
// y el bot buscaba la sábana de mañana (nunca actualizaba).
const Module = require('module');
const assert = require('assert');
let ok = 0, fallos = 0;
const t = (n, f) => { try { f(); ok++; console.log('OK  ' + n); } catch (e) { fallos++; console.log('FALLÓ ' + n + ': ' + e.message); } };

const realNow = Date.now;
const fijar = iso => { Date.now = () => new Date(iso).getTime(); const R = Date; global.Date = class extends R { constructor(...a) { if (a.length === 0) super(realNow === Date.now ? R.now() : new R(iso).getTime()); else super(...a); } static now() { return new R(iso).getTime(); } }; return () => { global.Date = R; }; };

const { fechaVenezuelaHoy } = require('../src/services/fechaVenezuela');
// 9-oct 21:30 en Caracas = 10-oct 01:30 UTC
let restaurar = fijar('2026-10-10T01:30:00Z');
t('21:30 en Caracas sigue siendo 09-10 (UTC ya dice 10-10)', () => assert.strictEqual(fechaVenezuelaHoy(), '2026-10-09'));
restaurar();
restaurar = fijar('2026-10-09T15:00:00Z');
t('11:00 am en Caracas es 09-10', () => assert.strictEqual(fechaVenezuelaHoy(), '2026-10-09'));
restaurar();

const src = require('fs').readFileSync(require('path').join(__dirname, '../src/services/telegramBot.js'), 'utf8');
const wb = require('fs').readFileSync(require('path').join(__dirname, '../src/services/whatsappBot.js'), 'utf8');
t('resumen automático de Telegram usa la fecha de Venezuela', () => assert(/const fecha = fechaVenezuelaHoy\(\)/.test(src) && !/formatearFechaISO\(new Date\(\)\)/.test(src)));
t('act / saldo final usan la fecha de Venezuela', () => assert(!/formatearFechaISO\(new Date\(\)\)/.test(wb) && (wb.match(/const fecha = fechaVenezuelaHoy\(\)/g) || []).length === 2));
t('corte semana y saldo total semana usan la semana de Venezuela', () => assert(!/calcularRangoRapido\(grupoId, 'semana'\)/.test(wb)));
console.log(fallos ? ('\n' + fallos + ' fallaron') : ('\nTodo OK (' + ok + ')'));
process.exit(fallos ? 1 : 0);
