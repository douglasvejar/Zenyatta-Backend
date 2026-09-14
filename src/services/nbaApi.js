// =================================================================
// CONECTOR A LA API DE NBA (vía la API "oculta"/no oficial de ESPN)
// =================================================================
// Mismo espíritu y misma forma que nflApi.js/nhlApi.js — confirmado
// pegándole directo al endpoint real (vía la herramienta de búsqueda web)
// antes de escribir este conector: la respuesta trae
// competitions[0].status.{type,period,displayClock} y
// competitions[0].competitors[].{homeAway,team.displayName,score,team.logo,
// winner,linescores} — exactamente la misma forma que ya usan NFL/NHL, así
// que se reutiliza el mismo patrón sin sorpresas.
//
// "1ra mitad" / "2da mitad" en NBA (31-08-2026, corregido el mismo día
// después de una primera versión mal diseñada): el usuario aclaró que en
// NBA NO se apuesta por cuarto individual (a diferencia de NHL, donde SÍ
// se apuesta por período suelto — ver nhlApi.js/evaluador.js) — en NBA
// solo se apuesta por 1ra mitad (cuartos 1+2), 2da mitad (cuartos 3+4), o
// el juego completo. Se guardan `homeLinescores`/`awayLinescores` (puntos
// por cuarto, tal cual los da la API, útiles para la Pizarra en Vivo y
// para armar las sumas de abajo) MÁS los campos ya sumados que
// evaluador.js usa de verdad: `homeScore1H`/`awayScore1H`/`final1H` (cuartos
// 1+2, mismo patrón que ya usa NFL) y, nuevos, `homeScore2H`/`awayScore2H`/
// `final2H` (cuartos 3+4).
async function obtenerResultadosNBA(fechaISO) {
  const datosNBA = {};
  const fechaCompacta = (fechaISO || '').replace(/-/g, '');

  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=' + fechaCompacta);
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

      // Array de puntos POR CUARTO (no acumulado), tal cual lo trae ESPN,
      // ordenado por período. Si `linescores` no viniera (partido que ni
      // arrancó), queda como array vacío — `cuartosCompletos` en 0 evita
      // que se use cualquier dato a medio armar.
      const linescoresOrdenados = (competitor) => (competitor.linescores || [])
        .slice()
        .sort((a, b) => a.period - b.period)
        .map(ls => Number(ls.value) || 0);
      const homeLinescores = linescoresOrdenados(home);
      const awayLinescores = linescoresOrdenados(away);

      // Cuántos cuartos quedaron COMPLETOS de verdad (para no leer un
      // cuarto todavía en curso a medias): si el juego terminó, todos los
      // que haya jugado están completos; si no, solo los anteriores al
      // cuarto actual (ej. si va por el 3er cuarto, el 1ro y el 2do ya
      // cerraron, el 3ro todavía no) — mismo criterio que usa NFL para
      // "final1H" (periodo > 2). Ya no se usa para evaluar "por cuarto"
      // individual (NBA no tiene esa apuesta, ver comentario grande
      // arriba), pero se deja calculado por si sirve para la Pizarra en
      // Vivo u otra cosa a futuro.
      const cuartosCompletos = finalizado
        ? Math.min(homeLinescores.length, awayLinescores.length)
        : Math.max(0, periodo - 1);

      // 1ra mitad = cuartos 1+2. ¿Ya terminó? Si el juego entero terminó,
      // obvio que sí; si va por el 3er cuarto o más, ya pasó — mismo
      // criterio que usa NFL (ver nflApi.js).
      const homeScore1H = (homeLinescores[0] || 0) + (homeLinescores[1] || 0);
      const awayScore1H = (awayLinescores[0] || 0) + (awayLinescores[1] || 0);
      const final1H = finalizado || periodo > 2;

      // 2da mitad = cuartos 3+4 (sin contar tiempo(s) extra). ¿Ya terminó?
      // Si el juego entero terminó, o si ya va por un 5to período (tiempo
      // extra, lo que confirma que la 2da mitad de tiempo regular ya
      // cerró), es que sí.
      const homeScore2H = (homeLinescores[2] || 0) + (homeLinescores[3] || 0);
      const awayScore2H = (awayLinescores[2] || 0) + (awayLinescores[3] || 0);
      const final2H = finalizado || periodo > 4;

      const info = {
        deporte: 'basket',
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore,
        awayScore,
        totalScore: homeScore + awayScore,
        homeLinescores,
        awayLinescores,
        cuartosCompletos,
        homeScore1H,
        awayScore1H,
        final1H,
        homeScore2H,
        awayScore2H,
        final2H,
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

      // Igual que en MLB/NFL/NHL: se guarda 2 veces (local y visitante)
      // para poder buscar el juego por CUALQUIERA de los 2 nombres.
      datosNBA[home.team.displayName.toLowerCase()] = info;
      datosNBA[away.team.displayName.toLowerCase()] = info;
    });
  } catch (e) {
    console.error('Error al conectar con la API de NBA (ESPN):', e);
  }

  return datosNBA;
}

function periodoATexto(periodo, estadoAbstracto) {
  if (estadoAbstracto === 'pre' || !periodo) return '';
  const nombres = { 1: '1er cuarto', 2: '2do cuarto', 3: '3er cuarto', 4: '4to cuarto' };
  return nombres[periodo] || 'Tiempo extra';
}

module.exports = { obtenerResultadosNBA };
