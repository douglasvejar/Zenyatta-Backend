// =================================================================
// PRUEBA: el estado puesto a mano con ✏️ Editar NO se pierde al reprocesar
// la sábana (25-10-2026, a pedido del usuario: tickets "1h" del día 20 que
// api-football.com ya no entrega en el plan gratis quedaban PENDIENTE; los
// marcaba GANADA/PERDIDA y a los pocos segundos volvían a PENDIENTE).
// =================================================================
// Mismo patrón de base falsa + fetch falso que test_marcador_manual_sin_mapeo.js.
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const MANUALES = []; // { grupo_id, fecha, cliente_nombre, ticket_label, estado }
const HISTORIAL = []; // filas de tickets_historial para editarTicket

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^SELECT \* FROM jugadores/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM avales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  if (/FROM polla_historial/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO alertas/i.test(sql)) return { rows: [{ id: 'alerta-1' }] };
  if (/^SELECT l\.cliente_nombre, l\.monto, c\.fecha[\s\S]*?FROM hipismo_cargas_especiales_lineas/i.test(sql)) return { rows: [] };

  // --- tickets_estado_manual ---
  if (/^SELECT cliente_nombre, ticket_label, estado FROM tickets_estado_manual WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    return { rows: MANUALES.filter(m => m.grupo_id === params[0] && m.fecha === params[1]) };
  }
  if (/^INSERT INTO tickets_estado_manual/i.test(sql)) {
    const [grupo_id, fecha, cliente_nombre, ticket_label, estado] = params;
    const ya = MANUALES.find(m => m.grupo_id === grupo_id && m.fecha === fecha && m.cliente_nombre === cliente_nombre && m.ticket_label === ticket_label);
    if (ya) ya.estado = estado; else MANUALES.push({ grupo_id, fecha, cliente_nombre, ticket_label, estado });
    return { rows: [] };
  }
  if (/^DELETE FROM tickets_estado_manual WHERE grupo_id = \$1 AND fecha = \$2 AND cliente_nombre = \$3 AND ticket_label = \$4/i.test(sql)) {
    const [grupo_id, fecha, cliente_nombre, ticket_label] = params;
    for (let i = MANUALES.length - 1; i >= 0; i--) {
      const m = MANUALES[i];
      if (m.grupo_id === grupo_id && m.fecha === fecha && m.cliente_nombre === cliente_nombre && m.ticket_label === ticket_label) MANUALES.splice(i, 1);
    }
    return { rows: [] };
  }

  // --- editarTicket (historial.js) ---
  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros FROM tickets_historial WHERE grupo_id = \$1 AND id = \$2/i.test(sql)) {
    const f = HISTORIAL.find(h => h.grupo_id === params[0] && h.id === params[1]);
    return { rows: f ? [{ id: f.id, fecha: f.fecha, cliente: f.cliente_nombre, ticket: f.ticket_label, detalle: f.detalle, arriesga: f.arriesga, gana: f.gana, estado: f.estado, logros: 1 }] : [] };
  }
  const mUpdate = sql.match(/^UPDATE tickets_historial SET (.+) WHERE grupo_id = \$(\d+) AND id = \$(\d+)$/i);
  if (mUpdate) {
    const f = HISTORIAL.find(h => h.grupo_id === params[Number(mUpdate[2]) - 1] && h.id === params[Number(mUpdate[3]) - 1]);
    if (f) mUpdate[1].split(',').map(s => s.trim()).forEach(parte => { const mm = parte.match(/^(\w+) = \$(\d+)$/); if (mm) f[mm[1]] = params[Number(mm[2]) - 1]; });
    return { rows: [] };
  }
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

const FECHA = '2026-10-20';
Module._load = function (request) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
global.fetch = () => Promise.resolve({ json: async () => ({ events: [] }) });

const { procesarSabana } = require(path.join(__dirname, '..', 'src', 'services', 'procesarSabana'));
const { editarTicket } = require(path.join(__dirname, '..', 'src', 'services', 'historial'));
Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(c, m) { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } }

(async function main() {
  const texto = ['GIANCO', 'Ticket #2', 'Equipo Inventado FC alta 2-115', '100//87'].join('\n');

  // 1. Sin marca manual: el ticket queda PENDIENTE (equipo que ninguna fuente resuelve).
  const r0 = await procesarSabana('grupo-1', texto, FECHA);
  const t0 = r0.tickets.find(t => t.cliente === 'GIANCO');
  check(t0 && t0.estado === 'PENDIENTE', 'Sin marca manual el ticket queda PENDIENTE');
  check(t0.estadoManual === false, 'Sin marca manual estadoManual=false');
  const etiqueta = t0.ticket;

  // 2. Se edita a mano desde ✏️ Editar -> se guarda la marca aparte.
  HISTORIAL.push({ id: 'h-1', grupo_id: 'grupo-1', fecha: FECHA, cliente_nombre: 'GIANCO', ticket_label: etiqueta, detalle: 'x', arriesga: 100, gana: 87, estado: 'PENDIENTE' });
  const e1 = await editarTicket('grupo-1', 'h-1', { estado: 'ganada' });
  check(e1.nuevo.estado === 'GANADA' && e1.marcaManualGuardada === true, 'editarTicket: el estado queda GANADA y la marca manual se guarda');
  check(MANUALES.length === 1 && MANUALES[0].estado === 'GANADA' && MANUALES[0].cliente_nombre === 'GIANCO', 'La marca manual quedó en tickets_estado_manual');

  // 3. REPROCESAR (lo que hacía volver a PENDIENTE): ahora se respeta lo manual.
  const r1 = await procesarSabana('grupo-1', texto, FECHA);
  const t1 = r1.tickets.find(t => t.cliente === 'GIANCO');
  check(t1.estado === 'GANADA', 'Al reprocesar la sábana el ticket sigue GANADA (antes volvía a PENDIENTE)');
  check(t1.estadoManual === true, 'El ticket se marca como estadoManual=true');

  // 4. Cambiar de opinión: PERDIDA reemplaza la marca anterior (no la duplica).
  await editarTicket('grupo-1', 'h-1', { estado: 'PERDIDA' });
  check(MANUALES.length === 1 && MANUALES[0].estado === 'PERDIDA', 'Cambiar a PERDIDA actualiza la misma marca, no crea otra');
  const r2 = await procesarSabana('grupo-1', texto, FECHA);
  check(r2.tickets.find(t => t.cliente === 'GIANCO').estado === 'PERDIDA', 'Al reprocesar queda PERDIDA');

  // 5. Otro cliente / otra fecha no se afectan.
  const r3 = await procesarSabana('grupo-1', ['OTRO', 'Ticket #2', 'Equipo Inventado FC alta 2-115', '100//87'].join('\n'), FECHA);
  check(r3.tickets.find(t => t.cliente === 'OTRO').estado === 'PENDIENTE', 'Otro cliente con el mismo número de ticket no se ve afectado');
  const r4 = await procesarSabana('grupo-1', texto, '2026-10-21');
  check(r4.tickets.find(t => t.cliente === 'GIANCO').estado === 'PENDIENTE', 'La misma jugada en otra fecha no se ve afectada');

  // 6. "Automático" quita la marca: vuelve a calcularse solo.
  const e3 = await editarTicket('grupo-1', 'h-1', { estado: 'AUTO' });
  check(e3.quitoMarcaManual === true && MANUALES.length === 0, 'Elegir Automático borra la marca manual');
  const r5 = await procesarSabana('grupo-1', texto, FECHA);
  check(r5.tickets.find(t => t.cliente === 'GIANCO').estado === 'PENDIENTE', 'Sin marca, el reproceso vuelve a dejarlo PENDIENTE (cálculo automático)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron ? 1 : 0);
})().catch(e => { console.error('La prueba se cayó:', e); process.exit(1); });
