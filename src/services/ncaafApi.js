// =================================================================
// CONECTOR A LA API DE NCAAF / fútbol americano universitario (vía la
// misma API "oculta"/no oficial de ESPN que ya usa nflApi.js)
// =================================================================
// Agregado 12-09-2026, a pedido explícito del usuario ("crees que puedas
// agregar una api para ncaaf? existe?"), como continuación directa del
// arreglo de ese mismo día (ver la nota grande en evaluador.js y
// diccionarioEquipos.js sobre el ticket real de "Miami Florida"): hasta
// ahora NCAAF quedaba SIN_MAPEO a propósito porque no había ninguna API
// conectada — eso dejaba que el marcador manual (✅/❌/⭕) resolviera el
// ticket, pero nunca de forma automática. Con esta API conectada, un
// ticket de NCAAF por fin puede resolverse SOLO, igual que MLB/NFL/NHL/
// fútbol/NBA — el marcador manual sigue funcionando igual que siempre
// como respaldo para cualquier equipo que todavía no esté en el
// diccionario (ver DICCIONARIO_EQUIPOS_NCAAF_BASE).
//
// Mismo endpoint que nflApi.js, cambiando solo "nfl" por "college-football"
// en la URL (confirmado con la herramienta de búsqueda web contra la propia
// ESPN y contra gists públicos que documentan esta misma API "escondida" —
// no es oficial ni tiene key, igual que statsapi.mlb.com no es 100% oficial
// de MLB, pero es ampliamente usada y viene siendo estable). Misma forma de
// respuesta exacta que NFL (events[].competitions[0].competitors[], cada
// competitor con team.displayName/team.logo/score, y linescores por cuarto)
// — por eso este archivo es, a propósito, casi una copia literal de
// nflApi.js, con el mismo mecanismo de "1ra mitad" (suma de los cuartos 1 y
// 2 en linescores).
//
// OJO con la escala: NCAAF tiene ~130 equipos de División I FBS (contra 32
// de NFL) — el diccionario de equipos (ver diccionarioEquipos.js) por ahora
// solo cubre los programas más conocidos/apostados (las 4 conferencias
// "Power" + Notre Dame), NO los 130. Un equipo de NCAAF que todavía no esté
// en el diccionario sigue quedando SIN_MAPEO (no PENDIENTE — ver la rama
// "!config" en evaluador.js, que ya NO aplica para 'ncaaf' ahora que este
// archivo existe, pero sigue aplicando para cualquier otro equipo que ni
// siquiera esté mapeado), y el marcador manual lo sigue resolviendo igual
// que siempre. Se van agregando más programas al diccionario a medida que
// aparezcan en sábanas reales, mismo criterio ya usado para ir sumando
// MLB/NFL/NHL/fútbol/NBA con el tiempo.
async function obtenerResultadosNCAAF(fechaISO) {
  const datosNCAAF = {};
  const fechaCompacta = (fechaISO || '').replace(/-/g, ''); // 'YYYY-MM-DD' -> 'YYYYMMDD' (formato que pide ESPN)

  try {
    // Sin "groups"/"group": el endpoint de scoreboard de ESPN devuelve, por
    // defecto, los juegos de División I FBS de la fecha pedida — pero SOLO
    // los de FBS, no los de FCS (Division I-AA). Esto quedó confirmado del
    // todo el 20-09-2026, a raíz de un pedido explícito del usuario:
    // "quiero que esten todos los equipos de ncaaf que existan... north
    // dakota state bison... quiero que este todos los que existen" — North
    // Dakota State Bison es un programa de FCS, no de FBS, así que un
    // partido suyo NUNCA iba a aparecer acá sin pedir explícitamente ese
    // otro grupo (groups=81 es FCS, confirmado contra la propia ESPN:
    // espn.com/college-football/scoreboard/_/group/81). Se pide groups=80
    // (FBS) y groups=81 (FCS) EN PARALELO, mismo día/fecha, y se combinan
    // los partidos de los 2 en un solo mapa — mismo criterio ya usado en
    // src/routes/equipos.js para el listado de nombres oficiales. No se
    // agregó división II/III: ESPN no las cubre de forma confiable en esta
    // misma API "oculta", y no son ligas que se apuesten en la práctica.
    const [resFbs, resFcs] = await Promise.all([
      fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=' + fechaCompacta + '&groups=80').then(r => r.json()).catch(() => ({ events: [] })),
      fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=' + fechaCompacta + '&groups=81').then(r => r.json()).catch(() => ({ events: [] }))
    ]);
    // Combina los eventos de los 2 grupos, evitando contar 2 veces un mismo
    // partido si por algún motivo ESPN lo listara en ambos (no debería
    // pasar — FBS y FCS son grupos excluyentes — pero por las dudas se
    // deduplica por id de evento).
    const eventosVistos = new Set();
    const eventosCombinados = [];
    [].concat(resFbs.events || [], resFcs.events || []).forEach(ev => {
      if (eventosVistos.has(ev.id)) return;
      eventosVistos.add(ev.id);
      eventosCombinados.push(ev);
    });
    const json = { events: eventosCombinados };

    (json.events || []).forEach(ev => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return;

      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      if (!home || !away || !home.team || !away.team) return;

      const tipoEstado = (comp.status && comp.status.type) || {};
      const finalizado = tipoEstado.completed === true;
      // Igual que en NFL: un "suspendido/pospuesto" (mal tiempo, evacuación
      // de estadio, etc.) se detecta por el texto del estado, no por un
      // código fijo (ESPN no lo documenta oficialmente).
      const suspendido = !finalizado && /suspend|postpon|cancel/i.test(tipoEstado.description || tipoEstado.name || '');

      const homeScore = Number(home.score) || 0;
      const awayScore = Number(away.score) || 0;
      const periodo = (comp.status && comp.status.period) || 0;

      // Suma de los cuartos 1 y 2 = marcador de la primera mitad ("1h") —
      // mismo mecanismo que nflApi.js.
      const sumaPrimeraMitad = (competitor) => (competitor.linescores || [])
        .filter(ls => ls.period === 1 || ls.period === 2)
        .reduce((suma, ls) => suma + (Number(ls.value) || 0), 0);
      const homeScore1H = sumaPrimeraMitad(home);
      const awayScore1H = sumaPrimeraMitad(away);

      // NCAAF juega 4 cuartos como NFL (nunca hay empate: desde 1996 la
      // NCAA obliga a tiempo extra hasta que haya ganador) — el mismo
      // criterio de "cuándo ya pasó la 1ra mitad" de nflApi.js aplica tal
      // cual acá.
      const enEntretiempo = periodo === 2 && /halftime|entretiempo/i.test(tipoEstado.description || tipoEstado.name || '');
      const final1H = finalizado || periodo > 2 || enEntretiempo;

      const info = {
        deporte: 'ncaaf',
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore,
        awayScore,
        totalScore: homeScore + awayScore,
        homeScore1H,
        awayScore1H,
        final1H,
        finalizado,
        suspendido,
        homeTeamLogo: home.team.logo || null,
        awayTeamLogo: away.team.logo || null,
        enVivo: {
          idJuego: ev.id,
          estadoDetallado: tipoEstado.description || '',
          estadoAbstracto: tipoEstado.state || '', // 'pre' | 'in' | 'post'
          horaInicioUTC: ev.date || null,
          periodo,
          periodoTexto: periodoATexto(periodo, tipoEstado.state),
          relojTexto: (comp.status && comp.status.displayClock) || ''
        }
      };

      // Igual que en MLB/NFL: se guarda 2 veces (local y visitante) para
      // poder buscar el juego por CUALQUIERA de los 2 nombres de equipo.
      datosNCAAF[home.team.displayName.toLowerCase()] = info;
      datosNCAAF[away.team.displayName.toLowerCase()] = info;
    });
  } catch (e) {
    console.error('Error al conectar con la API de NCAAF (ESPN):', e);
  }

  return datosNCAAF;
}

function periodoATexto(periodo, estadoAbstracto) {
  if (estadoAbstracto === 'pre' || !periodo) return '';
  const nombres = { 1: '1er cuarto', 2: '2do cuarto', 3: '3er cuarto', 4: '4to cuarto' };
  return nombres[periodo] || 'Tiempo extra';
}

module.exports = { obtenerResultadosNCAAF };
