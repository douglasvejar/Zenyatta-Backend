// =================================================================
// PRUEBA: marcador manual (✅/❌/⭕) puesto A MANO en la sábana, vs. el
// resultado REAL verificado contra la API (03-09-2026, a pedido del
// usuario).
// =================================================================
// El usuario a veces manda tickets que un empleado ya marcó a mano en la
// propia sábana (ej. "100//180✅"). Ese marcador NUNCA decide el resultado
// — evaluarJugada() lo sigue calculando siempre contra la API en vivo,
// como toda la vida ("emojis ignorados y reverificados") — pero ahora,
// si el marcador a mano quedó MAL puesto, además de corregirse solo (como
// ya pasaba) se avisa en la sábana con una nota, igual que ya se avisa
// cuando el pago escrito a mano no coincide con el calculado
// (pagaConDiscrepancia). Se verifica acá con el orquestador COMPLETO
// (procesarSabana.js) contra una base de datos falsa en memoria (mismo
// patrón que test_sabana_polla_y_mayusculas.js).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const TABLAS = {
  jugadores: [],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  polla_historial: []
};

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };
  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  // (04-09-2026) registrosSinCambios() en historial.js — esta prueba no
  // trackea el contenido real de tickets_historial, así que "sin filas
  // guardadas todavía" es siempre la respuesta correcta acá.
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) return { rows: [] };
  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

// Houston Astros (local) 5, Texas Rangers (visita) 1 — partido terminado.
// Houston (favorito, moneyline negativo) GANÓ; Texas PERDIÓ.
const FECHA_PRUEBA = '2026-09-02';
function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: [{
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: 'Houston Astros' }, score: 5 },
              away: { team: { name: 'Texas Rangers' }, score: 1 }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
            gamePk: 1
          }]
        }]
      })
    });
  }
  if (url.includes('/football/nfl/') || url.includes('/hockey/nhl/') || url.includes('/basketball/nba/') || url.includes('/soccer/')) {
    return Promise.resolve({ json: async () => ({ events: [] }) });
  }
  return Promise.reject(new Error('URL inesperada en la prueba: ' + url));
}

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
global.fetch = fakeFetch;

const { procesarSabana } = require(path.join(__dirname, '..', 'src', 'services', 'procesarSabana'));
const { parsearSabana } = require(path.join(__dirname, '..', 'src', 'services', 'parser'));

Module._load = originalLoad;

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // --- 1) Parser: el emoji antes/después de "arriesga//paga" se guarda
  // en marcadorManual, sin afectar arriesga/pagaSabana ---
  const dic = {};
  const b1 = parsearSabana(['RICKY', 'houston -120', '100//180✅'].join('\n'), dic);
  check(b1[0].marcadorManual === '✅', 'parsearSabana(): guarda el ✅ puesto después de "//" en marcadorManual');
  check(b1[0].arriesga === 100 && b1[0].pagaSabana === 180, 'parsearSabana(): arriesga/pagaSabana se leen igual, sin importar el emoji');

  const b2 = parsearSabana(['RICKY', 'houston -120', '❌100//180'].join('\n'), dic);
  check(b2[0].marcadorManual === '❌', 'parsearSabana(): también reconoce el emoji ANTES del monto (❌100//180)');

  const b3 = parsearSabana(['RICKY', 'houston -120', '100//180'].join('\n'), dic);
  check(b3[0].marcadorManual === null, 'parsearSabana(): sin emoji, marcadorManual queda null');

  // --- 2) procesarSabana(): el marcador manual CORRECTO no genera aviso ---
  const textoCorrecto = ['RICKY', 'houston -120', '100//180✅', 'PETER', 'texas +130', '100//0❌'].join('\n');
  const respCorrecto = await procesarSabana('g1', textoCorrecto, FECHA_PRUEBA);

  const tRicky = respCorrecto.tickets.find(t => t.cliente === 'RICKY');
  check(tRicky.estado === 'GANADA', 'RICKY (houston -120, favorito que ganó 5-1): estado real = GANADA');
  check(tRicky.marcadorManualIncorrecto === false, 'RICKY: el ✅ que puso a mano SÍ coincide con GANADA — no se marca como incorrecto');
  check(tRicky.notaMarcadorManual === null, 'RICKY: sin aviso porque el marcador manual estaba bien puesto');

  const tPeter = respCorrecto.tickets.find(t => t.cliente === 'PETER');
  check(tPeter.estado === 'PERDIDA', 'PETER (texas +130, perdió 1-5): estado real = PERDIDA');
  check(tPeter.marcadorManualIncorrecto === false, 'PETER: el ❌ que puso a mano SÍ coincide con PERDIDA — no se marca como incorrecto');

  // --- 3) procesarSabana(): el marcador manual INCORRECTO se corrige Y se avisa ---
  const textoIncorrecto = ['GIANCO', 'texas +130', '100//230✅', 'WISTON', 'houston -120', '100//180❌'].join('\n');
  const respIncorrecto = await procesarSabana('g1', textoIncorrecto, FECHA_PRUEBA);

  const tGianco = respIncorrecto.tickets.find(t => t.cliente === 'GIANCO');
  check(tGianco.estado === 'PERDIDA', 'GIANCO (texas +130, en realidad perdió): el estado FINAL sigue siendo el real (PERDIDA), pase lo que pase con el ✅ a mano');
  check(tGianco.marcadorManualIncorrecto === true, 'GIANCO: marcado ✅ a mano pero en realidad PERDIÓ — queda marcado como incorrecto');
  check(tGianco.marcadorManualOriginal === '✅', 'GIANCO: se conserva cuál fue el marcador original que puso la sábana (✅)');
  check(typeof tGianco.notaMarcadorManual === 'string' && tGianco.notaMarcadorManual.includes('PERDIDA'), 'GIANCO: la nota explica que quedó PERDIDA aunque la sábana decía ✅');

  const tWiston = respIncorrecto.tickets.find(t => t.cliente === 'WISTON');
  check(tWiston.estado === 'GANADA', 'WISTON (houston -120, en realidad ganó): el estado final es el real (GANADA)');
  check(tWiston.marcadorManualIncorrecto === true, 'WISTON: marcado ❌ a mano pero en realidad GANÓ — también queda marcado como incorrecto (funciona en los 2 sentidos)');
  check(tWiston.marcadorManualOriginal === '❌', 'WISTON: se conserva el marcador original (❌)');

  // --- 4) Sin marcador manual en la sábana: nunca se marca "incorrecto" ---
  const textoSinMarcador = ['ANA', 'houston -120', '100//180'].join('\n');
  const respSinMarcador = await procesarSabana('g1', textoSinMarcador, FECHA_PRUEBA);
  const tAna = respSinMarcador.tickets.find(t => t.cliente === 'ANA');
  check(tAna.marcadorManualOriginal === null, 'ANA: sin emoji en la sábana, marcadorManualOriginal queda null');
  check(tAna.marcadorManualIncorrecto === false, 'ANA: sin marcador manual no hay nada que corregir — nunca se avisa de la nada');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
