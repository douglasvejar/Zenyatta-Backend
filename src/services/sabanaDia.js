// =================================================================
// PESTAÑA "SÁBANAS" (Administración) — 02-09-2026, a pedido del usuario:
// "en administracion creame una pestaña que se llame sabanas, alli se
// cargue en formato de imagen la sabana del dia que yo seleccione con
// todos los resultado, y la pizarra de resultado a la derecha ... tenga
// un botón para editar la sabana, en caso de editar algo generar un
// mensaje en alerta indicando cual ticket se modifico".
//
// Reconstruye la sábana de UN día puntual a partir de lo YA GUARDADO en
// tickets_historial y polla_historial — el ESTADO de cada ticket (quién
// ganó/perdió/quedó pendiente) sale siempre de ahí, nunca se recalcula.
// Sí se le vuelve a pedir a las APIs de deportes el marcador FINAL de
// los juegos de esa fecha puntual (para la pizarra real, ver más abajo)
// — a diferencia de "Procesar Sábana" (procesarSabana.js), acá eso es
// solo para MOSTRAR el resultado del partido, nunca para decidir si un
// ticket ganó o perdió: esto es para VER/EDITAR/fotografiar un día que
// ya se procesó, no para reprocesarlo.
//
// La "pizarra de resultados" (03-09-2026, corregido a pedido del
// usuario — "en pizarra de resultados me referia a como quedaron los
// juegos... coloca los resultados de los juegos que jugaron en esa
// sabana, y abajo de eso los resultados de los clientes") tiene 2
// partes: arriba, los marcadores REALES de los juegos que aparecen en
// las jugadas de esta sábana (sí se le vuelve a pedir a las APIs de
// deportes, pero SOLO el marcador de esa fecha puntual — todas aceptan
// una fecha arbitraria, ver mlbApi.js/nflApi.js/etc., así que un juego
// ya terminado hace tiempo devuelve su resultado final igual que uno de
// hoy); abajo, un resumen por cliente armado con los ESTADOS que YA
// quedaron guardados por ticket (GANADA/PERDIDA/PENDIENTE/...). Para
// saber CUÁLES juegos son "de esta sábana", cada jugada guardada
// (`detalle`, con las patas separadas por " | " — mismo separador que
// usa parser.js al guardar) se vuelve a pasar por evaluarJugada() SOLO
// para sacarle `equipoOficial`/`logoUrl` del "debug" (para el ícono del
// equipo y para filtrar la pizarra) — el `estado` que evaluarJugada
// devuelva se descarta siempre, el estado real del ticket es el que ya
// está guardado (puede incluir una edición manual, ver editarTicket()
// más abajo) y nunca se pisa acá.
// =================================================================
const db = require('../db');
const { leerHistorial, editarTicket } = require('./historial');
const { leerPolla } = require('./polla');
const { cargarConfigGrupo } = require('./grupoConfig');
const { obtenerResultadosAPIs } = require('./mlbApi');
const { obtenerResultadosNFL } = require('./nflApi');
const { obtenerResultadosNHL } = require('./nhlApi');
const { obtenerResultadosNBA } = require('./nbaApi');
const { obtenerResultadosSoccer } = require('./soccerApi');
const { obtenerResultadosNCAAF } = require('./ncaafApi');
const { evaluarJugada } = require('./evaluador');
const { normalizarTexto } = require('./normalizar');
const { detectarMarcadorDeporteEnTexto } = require('./parser');
const { armarListaJuegos } = require('./pizarraJuegos');

async function obtenerSabanaDeFecha(grupoId, fecha) {
  const [tickets, polla, config, datosMLB, datosNFL, datosNHL, datosSoccer, datosNBA, datosNCAAF] = await Promise.all([
    leerHistorial(grupoId, { desde: fecha, hasta: fecha }),
    leerPolla(grupoId, { desde: fecha, hasta: fecha }),
    cargarConfigGrupo(grupoId),
    obtenerResultadosAPIs(fecha),
    obtenerResultadosNFL(fecha),
    obtenerResultadosNHL(fecha),
    obtenerResultadosSoccer(fecha),
    obtenerResultadosNBA(fecha),
    obtenerResultadosNCAAF(fecha)
  ]);
  const datosPorDeporte = { mlb: datosMLB, nfl: datosNFL, nhl: datosNHL, soccer: datosSoccer, basket: datosNBA, ncaaf: datosNCAAF };
  const diccionarioEquipos = config.diccionarioEquipos;

  // Cada jugada guardada vuelve a pasar por evaluarJugada() SOLO para el
  // ícono del equipo — nunca para recalcular el estado del ticket (ver
  // nota grande arriba).
  const equiposVistos = new Set();
  tickets.forEach(t => {
    const patas = (t.detalle || '').split(' | ').map(s => s.trim()).filter(Boolean);
    t.jugadas = patas.map(pataTexto => {
      let equipoOficial = null;
      let logoUrl = null;
      try {
        const jNorm = normalizarTexto(pataTexto);
        const deporteMarcador = detectarMarcadorDeporteEnTexto(pataTexto);
        const res = evaluarJugada(jNorm, datosPorDeporte, diccionarioEquipos, { deporteMarcador });
        const info = (res && res.debug) || {};
        equipoOficial = info.equipoOficial || null;
        logoUrl = info.logoUrl || null;
      } catch (e) {
        // Best-effort: si algo falla acá, la jugada se muestra sin
        // ícono — nunca tumba la pestaña por esto.
      }
      if (equipoOficial) equiposVistos.add(equipoOficial);
      return { texto: pataTexto, equipoOficial, logoUrl };
    });
  });

  // La pizarra real: de TODOS los juegos de esa fecha (todos los
  // deportes conectados), solo los que tienen algún equipo detectado en
  // las jugadas de esta sábana.
  const todosLosJuegos = armarListaJuegos({ datosMLB, datosNFL, datosNHL, datosSoccer, datosNBA });
  const juegos = todosLosJuegos.filter(j => equiposVistos.has(j.homeTeam) || equiposVistos.has(j.awayTeam));

  const porCliente = {};
  function fila(cliente) {
    if (!porCliente[cliente]) {
      porCliente[cliente] = {
        cliente,
        tickets: 0, ganados: 0, perdidos: 0, pendientes: 0,
        arriesgado: 0, ganado: 0, perdido: 0,
        jugoPolla: false, polla: 0
      };
    }
    return porCliente[cliente];
  }

  tickets.forEach(t => {
    const f = fila(t.cliente);
    f.tickets += 1;
    f.arriesgado += t.arriesga;
    if (t.estado === 'GANADA') { f.ganado += t.gana; f.ganados += 1; }
    else if (t.estado === 'PERDIDA') { f.perdido += t.arriesga; f.perdidos += 1; }
    else if (t.estado !== 'ANULADA') { f.pendientes += 1; }
  });

  polla.forEach(p => {
    const f = fila(p.cliente);
    f.jugoPolla = true;
    f.polla += p.monto;
  });

  const resumenPorCliente = Object.values(porCliente).sort((a, b) => a.cliente.localeCompare(b.cliente));

  return { fecha, tickets, polla, resumenPorCliente, juegos };
}

// Edita un ticket del día Y deja constancia en Alertas si de verdad
// cambió algo — mismo patrón que confirmaciones.js (CONFIRMACION_CLIENTE):
// informativa, se guarda YA resuelta (no hay nada que "arreglar", solo
// avisar). Visible tanto para el Grupo (su pestaña Alertas) como para el
// Súper-admin (pidió el usuario: "la alerta es para el grupo y para
// super admin") — como las dos listas leen de la misma tabla "alertas"
// por grupo_id (ver listarAlertasGrupo/listarAlertasTodas en
// alertas.js), con insertar UNA sola fila alcanza para que la vean los
// dos, sin tener que avisarle a cada uno por separado.
async function editarTicketDia(grupoId, ticketId, cambios) {
  const resultado = await editarTicket(grupoId, ticketId, cambios);

  if (resultado.cambios.length > 0) {
    const detalleCambios = resultado.cambios
      .map(c => c.campo + ': "' + c.antes + '" → "' + c.despues + '"')
      .join(', ');
    const mensaje = 'Se editó a mano el ticket ' + (resultado.nuevo.ticket || 'sin número') +
      ' de ' + resultado.nuevo.cliente + ' (' + resultado.nuevo.fecha + '). ' + detalleCambios;

    await db.query(
      `INSERT INTO alertas (grupo_id, fecha, tipo, cliente_nombre, ticket_label, pata, mensaje, resuelta, resuelto_en)
       VALUES ($1, $2, 'TICKET_EDITADO', $3, $4, $5, $6, true, now())`,
      [
        grupoId,
        resultado.nuevo.fecha,
        resultado.nuevo.cliente,
        resultado.nuevo.ticket,
        'TICKET_EDITADO:' + ticketId + ':' + Date.now(),
        mensaje
      ]
    );
  }

  return resultado;
}

module.exports = { obtenerSabanaDeFecha, editarTicketDia };
