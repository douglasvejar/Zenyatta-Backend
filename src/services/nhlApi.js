// =================================================================
// CONECTOR A LA API DE NHL (vía la API "oculta"/no oficial de ESPN)
// =================================================================
// Mismo espíritu y misma forma que nflApi.js — confirmado pegándole
// directo al endpoint real (vía la herramienta de búsqueda web, que sí
// tiene salida a internet) antes de escribir este conector: la respuesta
// trae competitions[0].status.{type,period,displayClock} y
// competitions[0].competitors[].{homeAway,team.displayName,score,team.logo}
// — exactamente la misma forma que ya usa NFL, así que se reutiliza el
// mismo patrón sin sorpresas.
//
// "Por período" (31-08-2026, a pedido del usuario — le dice "cuarto" a
// cada período de hockey, ej. "Panthers over 1Q 3 -120"): NHL se juega en
// 3 períodos, no 4 cuartos como NBA, pero el MISMO mecanismo de
// evaluador.js sirve para los dos (ver CONFIG_POR_DEPORTE.nhl,
// cantidadCuartos: 3). Confirmado contra la API real que cada competitor
// SÍ trae un array `linescores` con los goles anotados EN CADA período por
// separado (no acumulado, ej. [0,0,2] suma el marcador final) — antes esto
// no se guardaba porque no hacía falta (NHL no tenía ningún tipo de
// apuesta por segmento todavía).
async function obtenerResultadosNHL(fechaISO) {
  const datosNHL = {};
  const fechaCompacta = (fechaISO || '').replace(/-/g, '');

  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=' + fechaCompacta);
    const json = await res.json();

    (json.events || []).forEach(ev => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return;

      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      if (!home || !away || !home.team || !away.team) return;

      const tipoEstado = (comp.status && comp.status.type) || {};
      const finalizado = tipoEstado.completed === true;
      const suspendido = !finalizado && /suspend|postpon|cancel/i.test(tipoEstado.description || tipoEstado.name || '');

      const homeScore = Number(home.score) || 0;
      const awayScore = Number(away.score) || 0;
      const periodo = (comp.status && comp.status.period) || 0;

      // Array de goles POR PERÍODO (no acumulado) — mismo criterio que
      // nbaApi.js. NHL juega 3 períodos en temporada regular (más tiempo
      // extra/shootout si empata, que no se cuenta acá como un "4to
      // período" — ver CONFIG_POR_DEPORTE.nhl.cantidadCuartos en
      // evaluador.js).
      const linescoresOrdenados = (competitor) => (competitor.linescores || [])
        .slice()
        .sort((a, b) => a.period - b.period)
        .map(ls => Number(ls.value) || 0);
      const homeLinescores = linescoresOrdenados(home);
      const awayLinescores = linescoresOrdenados(away);
      const cuartosCompletos = finalizado
        ? Math.min(homeLinescores.length, awayLinescores.length, 3)
        : Math.max(0, periodo - 1);

      const info = {
        deporte: 'nhl',
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore,
        awayScore,
        totalScore: homeScore + awayScore,
        homeLinescores,
        awayLinescores,
        cuartosCompletos,
        finalizado,
        suspendido,
        homeTeamLogo: home.team.logo || null,
        awayTeamLogo: away.team.logo || null,
        enVivo: {
          idJuego: ev.id,
          estadoDetallado: tipoEstado.description || '',
          estadoAbstracto: tipoEstado.state || '',
          horaInicioUTC: ev.date || null,
          periodo,
          periodoTexto: periodoATexto(periodo, tipoEstado.state),
          relojTexto: (comp.status && comp.status.displayClock) || ''
        }
      };

      datosNHL[home.team.displayName.toLowerCase()] = info;
      datosNHL[away.team.displayName.toLowerCase()] = info;
    });
  } catch (e) {
    console.error('Error al conectar con la API de NHL (ESPN):', e);
  }

  return datosNHL;
}

function periodoATexto(periodo, estadoAbstracto) {
  if (estadoAbstracto === 'pre' || !periodo) return '';
  const nombres = { 1: '1er período', 2: '2do período', 3: '3er período' };
  return nombres[periodo] || 'Tiempo extra / Shootout';
}

module.exports = { obtenerResultadosNHL };
