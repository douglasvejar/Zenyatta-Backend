// =================================================================
// PRUEBA DE INTEGRACIÓN: ticket con arriesgo pero SIN ninguna jugada
// asociada (05-09-2026, bug real reportado por el usuario con 2 capturas
// de la pestaña "🗂️ Sábanas": un ticket "vacío" — sin ninguna jugada para
// mostrar, "Sin datos de depuración" en el desglose — pero con un
// arriesgo real ($440/$240) y marcado GANADA con $0 de pago).
// =================================================================
// Causa reproducida acá: una línea "arriesga//paga" (o "arriesgo para
// ganancia") que aparece SIN ninguna jugada acumulada antes (ej. justo
// después del nombre de un cliente, o después de que el ticket anterior
// ya se cerró solo) — parser.js la cierra igual, con lo que HAYA en
// jugadasTemp en ese momento (CERO jugadas en este caso). Antes de este
// arreglo, procesarSabana.js no chequeaba esto y el ticket cerraba
// "GANADA" por default (ninguna pata perdedora porque no hay NINGUNA
// pata). Ahora se marca "NULA (SIN JUGADA)", se cuenta como pendiente
// (no como ganancia) y genera una alerta pidiendo revisar la sábana.
//
// Mismo patrón de base de datos falsa + fetch falso que
// test_alertas_integracion.js — corre el orquestador COMPLETO
// (procesarSabana.js), sin levantar un servidor HTTP ni pegarle a las
// APIs reales.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = { alertas: [] };
let siguienteIdAlerta = 1;

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

  if (/^INSERT INTO alertas/i.test(sql)) {
    const [grupoId, fecha, tipo, cliente, ticket, pata, mensaje, candidatos] = params;
    const yaHayUnaSinResolver = TABLAS.alertas.some(a => a.grupo_id === grupoId && a.fecha === fecha && a.pata === pata && !a.resuelta);
    if (yaHayUnaSinResolver) return { rows: [] };
    const id = 'alerta-' + (siguienteIdAlerta++);
    TABLAS.alertas.push({ id, grupo_id: grupoId, fecha, tipo, cliente_nombre: cliente, ticket_label: ticket, pata, mensaje, candidatos: JSON.parse(candidatos), resuelta: false });
    return { rows: [{ id }] };
  }

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

const FECHA_PRUEBA = '2026-09-05';
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            gameNumber: 1,
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: 'Detroit Tigers' }, score: 6 },
              away: { team: { name: 'Cleveland Guardians' }, score: 2 }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
            gamePk: 999101
          }]
        }]
      })
    });
  }
  // Cualquier otra API (NFL/NHL/NBA/fútbol) — esta prueba no depende de
  // ninguna, un scoreboard vacío alcanza para que procesarSabana() pueda
  // pedirlas en paralelo sin romper nada.
  return Promise.resolve({ json: async () => ({ events: [] }) });
}

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
global.fetch = fakeFetch;

const { procesarSabana } = require(path.join(__dirname, '..', 'src', 'services', 'procesarSabana'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // Reproduce EXACTAMENTE el reporte del usuario: una línea "440//0" (sin
  // ninguna jugada antes) seguida de un ticket real y completo — el
  // ticket real tiene que seguir procesándose bien, sin que el ticket
  // vacío lo afecte para nada.
  const texto = ['WISTON', '440//0', 'Detroit +115 x 250'].join('\n');
  const resultado = await procesarSabana('grupo-1', texto, FECHA_PRUEBA);

  const ticketVacio = resultado.tickets.find(t => t.jugadas.length === 0);
  const ticketReal = resultado.tickets.find(t => t.jugadas.length > 0);

  check(!!ticketVacio, 'El ticket sin ninguna jugada (arriesgo "440//0" suelto) sigue apareciendo en la lista (no se pierde silenciosamente)');
  check(ticketVacio && ticketVacio.estado === 'NULA (SIN JUGADA)', 'El ticket sin jugadas queda "NULA (SIN JUGADA)" — YA NO "GANADA" por default (el bug reportado)');
  check(ticketVacio && ticketVacio.arriesga === 440, 'El ticket sin jugadas conserva su arriesgo real ($440) — no se pierde el dato de plata');
  check(ticketVacio && ticketVacio.paga === 0, 'El ticket sin jugadas no reparte ningún pago ($0) — antes mostraba "GANADA" con $0, ahora al menos el estado es honesto');

  check(!!ticketReal && ticketReal.estado === 'GANADA' && ticketReal.arriesga === 250,
    'El ticket real de la MISMA sábana (Detroit +115 x 250) se sigue procesando normal — el ticket vacío no lo contamina');

  check(resultado.alertasNuevas === 1, 'procesarSabana devuelve 1 alerta nueva (la del ticket sin jugadas)');
  const alerta = TABLAS.alertas.find(a => a.tipo === 'SIN_JUGADA');
  check(!!alerta && alerta.cliente_nombre === 'WISTON', 'Se generó una alerta tipo SIN_JUGADA para WISTON, visible en 🔔 Alertas (Grupo y Súper-admin)');
  check(!!alerta && /sin ninguna jugada asociada/i.test(alerta.mensaje), 'El mensaje de la alerta explica el problema en criollo, para que se pueda corregir la sábana');

  const rcWiston = resultado.resumenPorCliente.find(c => c.cliente === 'WISTON');
  check(!!rcWiston && rcWiston.pendientes === 1, 'El ticket sin jugadas cuenta como "pendiente" en el resumen del cliente, no como ganado');
  check(!!rcWiston && Math.abs(rcWiston.ganado - 287.5) < 0.01, 'La ganancia del cliente sigue siendo SOLO la del ticket real (250 arriesgado a +115 = $287.50 de ganancia) — el ticket vacío no suma nada de más a "ganado" (ya no cuenta como GANADA)');

  // Reprocesar la MISMA sábana no debería duplicar la alerta (mismo
  // criterio de "ON CONFLICT ... DO NOTHING" que ya usan las alertas
  // AMBIGUA/SIN_LOGRO).
  const resultado2 = await procesarSabana('grupo-1', texto, FECHA_PRUEBA);
  check(resultado2.alertasNuevas === 0, 'Reprocesar la misma sábana no genera una 2da alerta duplicada para el mismo ticket vacío');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de "ticket sin jugadas" se cayó con una excepción:', e);
  process.exit(1);
});
