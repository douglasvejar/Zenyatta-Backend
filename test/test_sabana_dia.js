// =================================================================
// PRUEBA: pestaña "Sábanas" de Administración (02-09-2026, a pedido del
// usuario) — ver la nota grande en src/services/sabanaDia.js.
// =================================================================
// Cubre:
//   1. obtenerSabanaDeFecha(): reconstruye tickets + polla de una fecha
//      YA GUARDADA, arma resumenPorCliente con ganados/perdidos/
//      pendientes + polla — un cliente que SOLO jugó polla (sin tickets
//      ese día) también aparece, con jugoPolla:true y sus contadores de
//      tickets en 0. Y (03-09-2026, corrección de "pizarra de
//      resultados"): SÍ le pega a las 5 APIs de deportes (con fetch
//      falso, mismo patrón que test_sabana_polla_y_mayusculas.js) para
//      sacar el ícono de equipo (`jugadas[].equipoOficial`/`logoUrl`) de
//      cada jugada y el marcador real de los juegos de esa sábana
//      (`juegos[]`) — SIN que eso toque el `estado` ya guardado del
//      ticket (eso sigue viniendo SOLO de la base).
//   2. editarTicket() (historial.js) / editarTicketDia() (sabanaDia.js):
//      edita cliente/arriesga/gana/estado, detecta SOLO los campos que
//      de verdad cambiaron, deja el ticket en la base actualizado,
//      desconfirma el día (mismo criterio que reprocesar), y genera una
//      alerta TICKET_EDITADO (YA resuelta, informativa) SOLO si algo
//      cambió de verdad — guardar sin tocar nada no genera alerta. Un
//      id de otro grupo responde 404 (nunca se edita un ticket ajeno).
//   3. Las rutas GET /api/sabana/dia y PUT /api/sabana/tickets/:id
//      end-to-end (mismo patrón de Express/pg falsos que
//      test_polla.js/test_confirmaciones.js).
const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;

const GRUPO_ID = 'grupo-1';
const OTRO_GRUPO_ID = 'grupo-2';
const FECHA = '2026-09-02';

// Astros vs Rangers (MLB, final 5-1) es el único juego que la API falsa
// devuelve para esta fecha — así "Astros ML"/"Rangers +1.5" encuentran su
// partido (y su ícono), y "Yankees ML" (t-3, ANA) NO — a propósito, para
// probar que un equipo sin juego encontrado ese día simplemente no trae
// ícono ni entra en `juegos[]`, sin tumbar nada.
const TABLAS = {
  jugadores: [
    { id: 'j-pedro', grupo_id: GRUPO_ID, nombre: 'PEDRO', activo: true, comision_propia: 0 },
    { id: 'j-ana', grupo_id: GRUPO_ID, nombre: 'ANA', activo: true, comision_propia: 0 }
  ],
  avales: [],
  equipos_globales: [],
  equipos_personalizados: [],
  tickets_historial: [
    { id: 't-1', grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'PEDRO', ticket_label: 'Ticket #1', detalle: 'Astros ML', arriesga: 100, gana: 90, estado: 'GANADA' },
    { id: 't-2', grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'PEDRO', ticket_label: 'Ticket #2', detalle: 'Rangers +1.5', arriesga: 50, gana: 45, estado: 'PERDIDA' },
    { id: 't-3', grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'ANA', ticket_label: 'Ticket #3', detalle: 'Yankees ML', arriesga: 80, gana: 0, estado: 'PENDIENTE' },
    { id: 't-otro-grupo', grupo_id: OTRO_GRUPO_ID, fecha: FECHA, cliente_nombre: 'X', ticket_label: 'Ticket #9', detalle: 'x', arriesga: 10, gana: 0, estado: 'PENDIENTE' }
  ],
  polla_historial: [
    { id: 'p-1', grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'PEDRO', monto: -50, nota: null },
    { id: 'p-2', grupo_id: GRUPO_ID, fecha: FECHA, cliente_nombre: 'SOLOPOLLA', monto: 120, nota: null }
  ],
  dias_confirmados: [
    { grupo_id: GRUPO_ID, fecha: FECHA }
  ],
  alertas: []
};

// fetch falso: mismo patrón que test_sabana_polla_y_mayusculas.js — un
// solo juego MLB (Astros de local 5, Rangers de visita 1, Final), y las
// otras 4 APIs (todas ESPN, mismo formato ?dates=) sin ningún evento.
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
            gameDate: FECHA + 'T23:00:00Z',
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
global.fetch = fakeFetch;

function filtrarTickets(sql, params) {
  if (/WHERE grupo_id = \$1 AND id = \$2/i.test(sql)) {
    const [grupoId, id] = params;
    return TABLAS.tickets_historial.filter(t => t.grupo_id === grupoId && t.id === id);
  }
  const grupoId = params[0];
  let idx = 1, desde, hasta, cliente;
  if (/fecha >= \$/i.test(sql)) { desde = params[idx]; idx++; }
  if (/fecha <= \$/i.test(sql)) { hasta = params[idx]; idx++; }
  if (/cliente_nombre = \$/i.test(sql)) { cliente = params[idx]; idx++; }
  return TABLAS.tickets_historial.filter(r =>
    r.grupo_id === grupoId &&
    (!desde || r.fecha >= desde) &&
    (!hasta || r.fecha <= hasta) &&
    (!cliente || r.cliente_nombre === cliente)
  );
}

function mapTicketRow(r) {
  return { id: r.id, fecha: r.fecha, cliente: r.cliente_nombre, ticket: r.ticket_label, detalle: r.detalle, arriesga: r.arriesga, gana: r.gana, estado: r.estado };
}

function ejecutarQuery(text, params) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql)) return { rows: [] };

  // cargarConfigGrupo() (grupoConfig.js) — se le pega ahora también desde
  // obtenerSabanaDeFecha() (03-09-2026, para armar el diccionario de
  // equipos y detectar el ícono/juego de cada jugada).
  if (/^SELECT \* FROM jugadores WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.jugadores.filter(j => j.grupo_id === params[0]) };
  }
  if (/^SELECT \* FROM avales WHERE grupo_id = \$1/i.test(sql)) {
    return { rows: TABLAS.avales.filter(a => a.grupo_id === params[0]) };
  }
  if (/FROM equipos_globales/i.test(sql)) return { rows: TABLAS.equipos_globales };
  if (/FROM equipos_personalizados/i.test(sql)) {
    return { rows: TABLAS.equipos_personalizados.filter(e => e.grupo_id === params[0]) };
  }

  if (/^SELECT id, fecha, cliente_nombre AS cliente, ticket_label AS ticket, detalle, arriesga, gana, estado, logros FROM tickets_historial WHERE/i.test(sql)) {
    return { rows: filtrarTickets(sql, params).map(mapTicketRow) };
  }
  if (/^SELECT modelo_comision, comision_tiers FROM grupos WHERE id = \$1/i.test(sql)) return { rows: [{ modelo_comision: 'plano', comision_tiers: [] }] };

  if (/^SELECT id, fecha, cliente_nombre AS cliente, monto, nota FROM polla_historial WHERE/i.test(sql)) {
    const grupoId = params[0];
    let idx = 1, desde, hasta, cliente;
    if (/fecha >= \$/i.test(sql)) { desde = params[idx]; idx++; }
    if (/fecha <= \$/i.test(sql)) { hasta = params[idx]; idx++; }
    if (/cliente_nombre = \$/i.test(sql)) { cliente = params[idx]; idx++; }
    const filas = TABLAS.polla_historial.filter(r =>
      r.grupo_id === grupoId &&
      (!desde || r.fecha >= desde) &&
      (!hasta || r.fecha <= hasta) &&
      (!cliente || r.cliente_nombre === cliente)
    );
    return { rows: filas.map(f => ({ id: f.id, fecha: f.fecha, cliente: f.cliente_nombre, monto: f.monto, nota: f.nota })) };
  }

  // UPDATE tickets_historial SET <col=$n, ...> WHERE grupo_id = $x AND id = $y
  // (editarTicket, historial.js) — se parsea genérico en vez de matchear
  // texto exacto, porque la lista de columnas que se tocan varía según
  // qué campos vengan en `cambios`.
  const mUpdate = sql.match(/^UPDATE tickets_historial SET (.+) WHERE grupo_id = \$(\d+) AND id = \$(\d+)$/i);
  if (mUpdate) {
    const grupoId = params[Number(mUpdate[2]) - 1];
    const id = params[Number(mUpdate[3]) - 1];
    const fila = TABLAS.tickets_historial.find(t => t.grupo_id === grupoId && t.id === id);
    if (fila) {
      mUpdate[1].split(',').map(s => s.trim()).forEach(parte => {
        const mm = parte.match(/^(\w+) = \$(\d+)$/);
        if (mm) fila[mm[1]] = params[Number(mm[2]) - 1];
      });
    }
    return { rows: [] };
  }

  if (/^DELETE FROM dias_confirmados WHERE grupo_id = \$1 AND fecha = \$2/i.test(sql)) {
    const [grupoId, fecha] = params;
    TABLAS.dias_confirmados = TABLAS.dias_confirmados.filter(d => !(d.grupo_id === grupoId && d.fecha === fecha));
    return { rows: [] };
  }

  if (/^INSERT INTO alertas \(grupo_id, fecha, tipo, cliente_nombre, ticket_label, pata, mensaje, resuelta, resuelto_en\) VALUES \(\$1, \$2, 'TICKET_EDITADO', \$3, \$4, \$5, \$6, true, now\(\)\)/i.test(sql)) {
    const [grupoId, fecha, cliente, ticketLabel, pata, mensaje] = params;
    TABLAS.alertas.push({ id: 'a-' + (TABLAS.alertas.length + 1), grupo_id: grupoId, fecha, tipo: 'TICKET_EDITADO', cliente_nombre: cliente, ticket_label: ticketLabel, pata, mensaje, resuelta: true });
    return { rows: [] };
  }

  throw new Error('La base de datos falsa de esta prueba no sabe responder: ' + sql);
}

const fakePool = function () {
  this.query = async (text, params) => ejecutarQuery(text, params);
  this.connect = async () => ({ query: async (text, params) => ejecutarQuery(text, params), release() {} });
  this.on = () => {};
};

function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => {
    router[m] = (...args) => { handlers.push([m, args]); return router; };
  });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;

Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool: fakePool };
  if (request === 'express') return fakeExpress;
  if (request === 'jsonwebtoken') return { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: GRUPO_ID }) };
  return originalLoad.apply(this, arguments);
};
process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const { obtenerSabanaDeFecha, editarTicketDia } = require(path.join(__dirname, '..', 'src', 'services', 'sabanaDia'));
const sabanaRouter = require(path.join(__dirname, '..', 'src', 'routes', 'sabana'));

Module._load = originalLoad;

function invocarRuta(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    res._status = 200;
    res._json = null;
    res.status = (codigo) => { res._status = codigo; return res; };
    res.json = (obj) => { res._json = obj; resolve(res); return res; };
    res.end = () => { resolve(res); return res; };
    handler(req, res, (err) => { if (err) reject(err); });
  });
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function main() {
  // =================================================================
  // 1. obtenerSabanaDeFecha()
  // =================================================================
  const sabana = await obtenerSabanaDeFecha(GRUPO_ID, FECHA);
  check(sabana.tickets.length === 3, 'obtenerSabanaDeFecha(): trae los 3 tickets del grupo en esa fecha (no el del otro grupo)');
  check(sabana.tickets.every(t => !!t.id), 'obtenerSabanaDeFecha(): cada ticket trae su id (para poder editarlo)');
  check(sabana.polla.length === 2, 'obtenerSabanaDeFecha(): trae las 2 filas de polla de esa fecha');

  const filaPedro = sabana.resumenPorCliente.find(c => c.cliente === 'PEDRO');
  check(filaPedro.ganados === 1 && filaPedro.perdidos === 1 && filaPedro.pendientes === 0, 'resumenPorCliente: PEDRO tiene 1 ticket ganado y 1 perdido');
  check(filaPedro.arriesgado === 150, 'resumenPorCliente: PEDRO arriesgó 100+50=150 entre sus 2 tickets');
  check(filaPedro.ganado === 90 && filaPedro.perdido === 50, 'resumenPorCliente: PEDRO ganó 90 (su ticket GANADA) y perdió 50 (lo arriesgado en el PERDIDA)');
  check(filaPedro.jugoPolla === true && filaPedro.polla === -50, 'resumenPorCliente: PEDRO también jugó polla y perdió 50 ahí (ítem aparte)');

  const filaAna = sabana.resumenPorCliente.find(c => c.cliente === 'ANA');
  check(filaAna.pendientes === 1 && filaAna.jugoPolla === false, 'resumenPorCliente: ANA tiene 1 ticket pendiente y no jugó polla');

  const filaSolopolla = sabana.resumenPorCliente.find(c => c.cliente === 'SOLOPOLLA');
  check(!!filaSolopolla, 'resumenPorCliente: un cliente que SOLO jugó polla (sin tickets de sábana) también aparece');
  check(filaSolopolla.tickets === 0 && filaSolopolla.jugoPolla === true && filaSolopolla.polla === 120, 'resumenPorCliente: SOLOPOLLA tiene 0 tickets y su polla +120 como único dato');

  // =================================================================
  // 1b. Íconos de equipo por jugada + pizarra real de juegos
  //     (03-09-2026, corrección de "pizarra de resultados")
  // =================================================================
  const ticket1 = sabana.tickets.find(t => t.id === 't-1');
  check(!!ticket1.jugadas && ticket1.jugadas.length === 1, 'obtenerSabanaDeFecha(): el ticket #1 trae su detalle partido en jugadas[]');
  check(ticket1.jugadas[0].texto === 'Astros ML', 'jugadas[]: el texto de la pata es el mismo que quedó guardado en detalle');
  check(ticket1.jugadas[0].equipoOficial === 'Houston Astros', 'jugadas[]: "Astros ML" resuelve equipoOficial = Houston Astros (via evaluarJugada, sin tocar el estado)');

  const ticket2 = sabana.tickets.find(t => t.id === 't-2');
  check(ticket2.jugadas[0].equipoOficial === 'Texas Rangers', 'jugadas[]: "Rangers +1.5" resuelve al Rangers de MLB (el único con partido esa fecha en el fetch falso), no al de NHL');

  // "Yankees ML" SÍ resuelve equipoOficial (el diccionario base tiene un
  // solo candidato para "yankees", así que evaluarJugada no necesita
  // buscarle partido para identificar el equipo) — pero como la API
  // falsa no le devuelve ningún juego a los Yankees esa fecha, ese
  // equipo simplemente no genera ninguna fila en juegos[] (ver más abajo).
  const ticket3 = sabana.tickets.find(t => t.id === 't-3');
  check(ticket3.jugadas[0].equipoOficial === 'New York Yankees', 'jugadas[]: "Yankees ML" sí identifica el equipo (único candidato en el diccionario) aunque no tenga partido ese día');

  check(sabana.juegos.length === 1, 'juegos[]: solo aparece 1 juego (Astros-Rangers), el único relacionado con las jugadas de esta sábana');
  const juegoAstros = sabana.juegos[0];
  check(juegoAstros.deporte === 'mlb' && juegoAstros.homeTeam === 'Houston Astros' && juegoAstros.awayTeam === 'Texas Rangers', 'juegos[]: trae el juego completo (equipos + deporte) tal cual lo devuelve la API, listo para renderJuegoCard()');
  check(juegoAstros.homeRuns === 5 && juegoAstros.awayRuns === 1, 'juegos[]: trae el marcador final real (5-1), no relacionado con quién ganó el ticket');

  // El estado GUARDADO del ticket nunca se pisa con lo que recalcularía
  // evaluarJugada — t-2 (Rangers +1.5) sigue PERDIDA aunque Rangers haya
  // anotado en el marcador real, porque esta re-evaluación es solo para
  // el ícono/la pizarra, nunca para decidir quién ganó.
  check(ticket2.estado === 'PERDIDA', 'obtenerSabanaDeFecha(): el estado ya guardado del ticket (PERDIDA) NUNCA se recalcula ni se pisa con esta re-evaluación de solo-ícono');

  // =================================================================
  // 2. editarTicketDia() — cambia algo de verdad
  // =================================================================
  const idTicketPedro = TABLAS.tickets_historial.find(t => t.grupo_id === GRUPO_ID && t.cliente_nombre === 'PEDRO' && t.ticket_label === 'Ticket #2').id;
  const r1 = await editarTicketDia(GRUPO_ID, idTicketPedro, { estado: 'ganada', gana: 45 });
  check(r1.nuevo.estado === 'GANADA', 'editarTicketDia(): el estado se guarda normalizado a MAYÚSCULA aunque se mande en minúscula');
  check(r1.cambios.length === 1 && r1.cambios[0].campo === 'Estado', 'editarTicketDia(): "cambios" trae SOLO el campo que de verdad cambió (Estado) — gana ya era 45, no cuenta');
  check(TABLAS.tickets_historial.find(t => t.id === idTicketPedro).estado === 'GANADA', 'editarTicketDia(): el ticket queda actualizado en la base');
  check(!TABLAS.dias_confirmados.find(d => d.grupo_id === GRUPO_ID && d.fecha === FECHA), 'editarTicketDia(): al cambiar un ticket, el día queda SIN confirmar (mismo criterio que reprocesar)');

  const alertaTicket = TABLAS.alertas.find(a => a.tipo === 'TICKET_EDITADO' && a.cliente_nombre === 'PEDRO');
  check(!!alertaTicket, 'editarTicketDia(): genera una alerta TICKET_EDITADO cuando de verdad cambió algo');
  check(alertaTicket.resuelta === true, 'editarTicketDia(): la alerta TICKET_EDITADO queda YA resuelta (informativa, nada que atender)');
  check(/Estado/.test(alertaTicket.mensaje) && /PEDRO/.test(alertaTicket.mensaje), 'editarTicketDia(): el mensaje de la alerta menciona el cliente y el campo que cambió');

  // --- Guardar SIN tocar nada -> no genera una segunda alerta ---
  const totalAlertasAntes = TABLAS.alertas.length;
  const r2 = await editarTicketDia(GRUPO_ID, idTicketPedro, { estado: 'GANADA', gana: 45, cliente: 'PEDRO', arriesga: 50 });
  check(r2.cambios.length === 0, 'editarTicketDia(): guardar sin cambiar nada de verdad devuelve cambios: []');
  check(TABLAS.alertas.length === totalAlertasAntes, 'editarTicketDia(): guardar sin cambios NO genera una alerta nueva');

  // --- Un id de OTRO grupo -> 404, nunca se edita un ticket ajeno ---
  let error404 = null;
  try { await editarTicketDia(GRUPO_ID, 't-otro-grupo', { estado: 'GANADA' }); }
  catch (e) { error404 = e; }
  check(error404 && error404.status === 404, 'editarTicketDia(): un id de un ticket de OTRO grupo responde 404, no lo edita');
  check(TABLAS.tickets_historial.find(t => t.id === 't-otro-grupo').estado === 'PENDIENTE', 'editarTicketDia(): el ticket ajeno queda intacto');

  // =================================================================
  // 3. Rutas GET /dia y PUT /tickets/:id, end-to-end
  // =================================================================
  const entradaGetDia = sabanaRouter.__handlers.find(([metodo, args]) => metodo === 'get' && args[0] === '/dia');
  const handlerGetDia = entradaGetDia[1][entradaGetDia[1].length - 1];
  const resGetDia = await invocarRuta(handlerGetDia, { grupoId: GRUPO_ID, query: { fecha: FECHA } });
  check(resGetDia._status === 200 && resGetDia._json.tickets.length === 3, 'GET /api/sabana/dia responde 200 con los tickets de esa fecha');

  const resGetDiaSinFecha = await invocarRuta(handlerGetDia, { grupoId: GRUPO_ID, query: {} });
  check(resGetDiaSinFecha._status === 400, 'GET /api/sabana/dia sin fecha responde 400');

  const entradaPut = sabanaRouter.__handlers.find(([metodo, args]) => metodo === 'put' && args[0] === '/tickets/:id');
  const handlerPut = entradaPut[1][entradaPut[1].length - 1];
  const idTicketAna = TABLAS.tickets_historial.find(t => t.cliente_nombre === 'ANA').id;
  const resPut = await invocarRuta(handlerPut, { grupoId: GRUPO_ID, params: { id: idTicketAna }, body: { estado: 'PERDIDA' } });
  check(resPut._status === 200 && resPut._json.cambios.length === 1, 'PUT /api/sabana/tickets/:id responde 200 y trae los cambios que se guardaron');
  check(TABLAS.tickets_historial.find(t => t.id === idTicketAna).estado === 'PERDIDA', 'PUT /api/sabana/tickets/:id: el ticket de ANA quedó en PERDIDA');

  const resPutInexistente = await invocarRuta(handlerPut, { grupoId: GRUPO_ID, params: { id: 'no-existe' }, body: { estado: 'GANADA' } });
  check(resPutInexistente._status === 404, 'PUT /api/sabana/tickets/:id con un id que no existe responde 404, no revienta el servidor');

  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  process.exit(fallaron > 0 ? 1 : 0);
})().catch(e => {
  console.error('La prueba de la pestaña Sábanas se cayó con una excepción:', e);
  process.exit(1);
});
