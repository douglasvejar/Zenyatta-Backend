// =================================================================
// PRUEBA DE INTEGRACIÓN: procesarSabana.js con un "grupo mixto"
// (09-09-2026, a pedido del usuario — ver la nota grande en
// comisiones.js/sql/schema.sql/jugadores.modelo_comision).
// =================================================================
// A diferencia de test_procesar_sabana_comision_por_tipo.js (donde el
// modelo 'por_tipo_jugada' es el DEFAULT del grupo entero), acá el grupo
// está en 'plano' (default) pero ANA tiene la fila
// jugadores.modelo_comision = 'por_tipo_jugada' cargada (una excepción
// puntual), mientras que LUIS sigue el modelo default del grupo con su
// propio % (plano, 5%).
//
// Escenario:
//   Grupo default: 'plano'. Tiers del grupo: 1 logro -> 2%, 2 logros -> 3%.
//   ANA (excepción 'por_tipo_jugada'): parley de 2 logros, arriesga 200,
//     GANADA -> comisión = 200*3% = 6 (por los tiers del grupo, aunque el
//     grupo default sea plano y ANA no tenga ningún % propio cargado).
//   LUIS (sin excepción, % propio = 5): directa, arriesga 100, PERDIDA ->
//     comisión = 100*5% = 5 (plano, el default del grupo).
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-mixto';
const FECHA_PRUEBA = '2026-09-09';

const TIERS = [
  { logros: 1, porcentaje: 2 },
  { logros: 2, porcentaje: 3 }
];

const JUGADORES = [
  { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', comision_propia: 0, modelo_comision: 'por_tipo_jugada', tipo_cuenta: 'libre' },
  { id: 'j-luis', grupo_id: GRUPO_ID, nombre: 'LUIS', comision_propia: 5, modelo_comision: null, tipo_cuenta: 'libre' }
];

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();

  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: JUGADORES.filter(j => j.grupo_id === params[0]) };
  }
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) return { rows: [] };
  if (/FROM equipos_globales/i.test(sql)) return { rows: [] };
  if (/FROM equipos_personalizados/i.test(sql)) return { rows: [] };

  // El grupo está en 'plano' (DEFAULT), con los 2 tiers de la prueba
  // disponibles para quien tenga la excepción individual cargada.
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) {
    return { rows: [{ modelo_comision: 'plano', comision_tiers: TIERS }] };
  }

  if (/DELETE FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO tickets_historial/i.test(sql)) return { rows: [] };
  if (/^SELECT cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado FROM tickets_historial/i.test(sql)) return { rows: [] };
  if (/INSERT INTO jugadores/i.test(sql)) return { rows: [] };
  if (/DELETE FROM dias_confirmados/i.test(sql)) return { rows: [] };
  if (/SELECT pata_texto, deporte_elegido FROM resoluciones_ambiguas/i.test(sql)) return { rows: [] };
  if (/FROM polla_historial/i.test(sql)) return { rows: [] };
  if (/^INSERT INTO alertas/i.test(sql)) return { rows: [{ id: 'alerta-' + Math.random().toString(36).slice(2) }] };

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

const JUEGOS = [
  ['Houston Astros', 'Texas Rangers', 6, 2],
  ['Boston Red Sox', 'New York Yankees', 5, 1]
];

function fakeFetch(url) {
  if (url.includes('statsapi.mlb.com')) {
    return Promise.resolve({
      json: async () => ({
        dates: [{
          games: JUEGOS.map((j, i) => ({
            status: { abstractGameState: 'Final', codedState: 'F', detailedState: 'Final' },
            teams: {
              home: { team: { name: j[0] }, score: j[2] },
              away: { team: { name: j[1] }, score: j[3] }
            },
            linescore: { innings: [], currentInning: 9, inningState: 'End' },
            gameDate: FECHA_PRUEBA + 'T23:00:00Z',
            gamePk: 800 + i
          }))
        }]
      })
    });
  }
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

function decimal(c) { return c > 0 ? 1 + c / 100 : 1 + 100 / Math.abs(c); }
function pago(cuotas, arriesgo) {
  return cuotas.reduce((acc, c) => acc * decimal(c), 1) * arriesgo - arriesgo;
}

(async function main() {
  const cuotaAstros = -150; // gana
  const cuotaRedSox = -130; // gana
  const cuotaRangers = 140; // LUIS apuesta al visitante que pierde -> PERDIDA

  // ANA: parley de 2 logros (Astros + Red Sox, ambos ganan) -> GANADA.
  const pagoAna = pago([cuotaAstros, cuotaRedSox], 200);
  const textoAna = ['ANA', 'Houston astros -150', 'Boston red sox -130', '200//' + pagoAna.toFixed(2)].join('\n');

  // LUIS: directa a Texas Rangers (que pierde) -> PERDIDA.
  const pagoLuis = pago([cuotaRangers], 100);
  const textoLuis = ['LUIS', 'Texas rangers +140', '100//' + pagoLuis.toFixed(2)].join('\n');

  const texto = [textoAna, '', textoLuis].join('\n');
  const resp = await procesarSabana(GRUPO_ID, texto, FECHA_PRUEBA);

  // El grupo sigue reportando su modelo DEFAULT ('plano') -- el "mixto"
  // es una excepción por cliente, no cambia el modelo general del grupo.
  check(resp.modeloComision === 'plano', 'la respuesta sigue trayendo el modelo DEFAULT del grupo ("plano"), el grupo mixto es una excepción individual, no cambia esto');

  const filaAna = resp.resumenPorCliente.find(c => c.cliente === 'ANA');
  check(!!filaAna, 'resumenPorCliente incluye a ANA');
  check(filaAna.porcentajePropio === null, 'ANA (excepción por_tipo_jugada) sale con porcentajePropio null, aunque el grupo default sea plano');
  check(Math.abs(filaAna.comisionPropia - 6) < 0.01, 'ANA cobra por los TIERS DEL GRUPO: 200*3% (2 logros) = 6, aunque su comision_propia en la fila sea 0 (' + filaAna.comisionPropia + ')');

  const filaLuis = resp.resumenPorCliente.find(c => c.cliente === 'LUIS');
  check(!!filaLuis, 'resumenPorCliente incluye a LUIS');
  check(filaLuis.porcentajePropio === 5, 'LUIS (sin excepción) sigue el modelo default del grupo (plano) con su propio 5%');
  check(Math.abs(filaLuis.comisionPropia - 5) < 0.01, 'LUIS cobra 100*5% = 5 (plano), aunque haya PERDIDO el ticket (PERDIDA también comisiona)');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba se cayó con una excepción:', e);
  process.exit(1);
});
