// Portado de app.js (sección 3) — conector a la API pública de MLB.
// Único cambio real: usa el "fetch" global de Node (18+) en vez del fetch
// del navegador; el resto de la lógica es idéntica.
//
// =================================================================
// DOBLE JUEGO / DOUBLEHEADER (05-09-2026, a pedido del usuario con un
// ticket real: "Tigers G2 (+120)" — "hay dias en la mlb que los equipos
// juegan 2 veces... el juego 2 puede venir como G2 o GM2 o g2 o gm o
// juego2"). ANTES de este arreglo, cada equipo se guardaba en `datosMLB`
// con SOLO su nombre como clave — si ese mismo equipo tenía 2 partidos la
// MISMA fecha (doble juego), el segundo partido SILENCIOSAMENTE pisaba al
// primero en el objeto (misma clave, `forEach` los procesa en el orden
// que los devuelve la API), y no había ninguna forma de pedir el juego 1
// en particular. Un ticket real del juego 1 terminaba evaluándose SIEMPRE
// contra el juego 2 sin que nadie se diera cuenta.
//
// Ahora cada juego de la API trae su propio `gameNumber` (1 o 2 — la
// API de MLB SIEMPRE lo manda, sea o no doble juego). Se guarda cada
// partido en 2 claves a la vez:
//   - "<equipo> juego<N>" — clave explícita, para cuando la jugada
//     puntualiza el juego (ver detectarNumeroJuegoEnJugada() en
//     evaluador.js).
//   - "<equipo>" a secas — clave "por defecto", que ahora SIEMPRE apunta
//     al JUEGO 1 (o al único juego del día, el caso de toda la vida) en
//     vez de "lo último que se haya procesado" como antes — así, una
//     jugada de un día con doble juego que NO aclara "G1"/"G2" sigue
//     evaluándose contra el juego 1, que es lo que casi siempre se quiere
//     decir cuando no se aclara nada.
async function obtenerResultadosAPIs(fechaISO) {
  const datosMLB = {};

  try {
    const res = await fetch('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=' + fechaISO + '&hydrate=linescore');
    const json = await res.json();

    if (json.dates && json.dates[0]) {
      json.dates[0].games.forEach(g => {
        let h5 = 0, a5 = 0;
        if (g.linescore && g.linescore.innings) {
          g.linescore.innings.slice(0, 5).forEach(inn => {
            h5 += (inn.home && inn.home.runs) || 0;
            a5 += (inn.away && inn.away.runs) || 0;
          });
        }
        const finalizado = g.status.abstractGameState === 'Final' || g.status.codedState === 'F';
        const suspendido = !finalizado && /suspend|postpon/i.test(g.status.detailedState || '');

        const currentInning = (g.linescore && g.linescore.currentInning) || 0;
        const inningState = (g.linescore && g.linescore.inningState) || '';
        const final5inn = finalizado || currentInning > 5 || (currentInning === 5 && inningState === 'End');

        const ls = g.linescore || {};
        const enVivo = {
          idJuego: g.gamePk,
          estadoDetallado: g.status.detailedState || '',
          estadoAbstracto: g.status.abstractGameState || '',
          horaInicioUTC: g.gameDate || null,
          entradaActual: ls.currentInning || 0,
          entradaActualTexto: ls.currentInningOrdinal || '',
          entradaAlta: ls.isTopInning !== false,
          estadoEntrada: ls.inningState || '',
          outs: ls.outs || 0,
          bolas: ls.balls || 0,
          strikes: ls.strikes || 0,
          corredor1B: !!(ls.offense && ls.offense.first),
          corredor2B: !!(ls.offense && ls.offense.second),
          corredor3B: !!(ls.offense && ls.offense.third)
        };

        const numeroJuego = g.gameNumber || 1;
        const info = {
          homeTeam: g.teams.home.team.name,
          awayTeam: g.teams.away.team.name,
          homeRuns: g.teams.home.score || 0,
          awayRuns: g.teams.away.score || 0,
          totalRuns: (g.teams.home.score || 0) + (g.teams.away.score || 0),
          home5innRuns: h5,
          away5innRuns: a5,
          total5innRuns: h5 + a5,
          finalizado,
          final5inn,
          suspendido,
          numeroJuego,
          enVivo
        };

        const homeKey = g.teams.home.team.name.toLowerCase();
        const awayKey = g.teams.away.team.name.toLowerCase();

        // Clave explícita CON el número de juego — se guarda siempre,
        // haya o no doble juego ese día (no hace daño tenerla de más).
        datosMLB[homeKey + ' juego' + numeroJuego] = info;
        datosMLB[awayKey + ' juego' + numeroJuego] = info;

        // Clave "por defecto", sin número de juego: se queda con el
        // juego de MENOR numeroJuego visto hasta ahora para ese equipo
        // (juego 1, si hay 2) — no con "el último procesado" como antes.
        if (!datosMLB[homeKey] || (datosMLB[homeKey].numeroJuego || 1) > numeroJuego) datosMLB[homeKey] = info;
        if (!datosMLB[awayKey] || (datosMLB[awayKey].numeroJuego || 1) > numeroJuego) datosMLB[awayKey] = info;
      });
    }
  } catch (e) {
    console.error('Error al conectar con la API de MLB:', e);
  }

  return datosMLB;
}

// `numeroJuego` (05-09-2026, opcional): si se pasa, busca PUNTUALMENTE el
// juego 1 o 2 de ese equipo (clave "<equipo> juego<N>", ver la nota
// grande arriba) — si esa fecha no tuvo ese juego en particular, devuelve
// null a propósito (NUNCA cae de vuelta al juego "por defecto": evaluar
// contra el juego equivocado sería peor que avisar que no se encontró).
// Sin `numeroJuego` (el uso de toda la vida, y el de cualquier otro
// deporte que reutiliza esta misma función), el comportamiento es
// exactamente el de antes — incluida la búsqueda floja por mascota — solo
// que ahora esa búsqueda floja ignora a propósito las claves "<equipo>
// juego<N>" (para no engancharse por error con una de esas en vez de la
// clave plana que corresponde).
function buscarJuegoPorNombre(datosMLB, nombreEquipo, numeroJuego) {
  const nombreLower = nombreEquipo.toLowerCase();
  const mascota = nombreLower.split(' ').pop();

  if (numeroJuego) {
    const claveExacta = nombreLower + ' juego' + numeroJuego;
    if (datosMLB[claveExacta]) return datosMLB[claveExacta];

    const sufijo = ' juego' + numeroJuego;
    const claveEncontrada = Object.keys(datosMLB).find(k => k.endsWith(sufijo) && k.slice(0, -sufijo.length).split(' ').pop() === mascota);
    return claveEncontrada ? datosMLB[claveEncontrada] : null;
  }

  if (datosMLB[nombreLower]) return datosMLB[nombreLower];

  const claveEncontrada = Object.keys(datosMLB)
    .filter(k => !/ juego\d+$/.test(k))
    .find(k => k.split(' ').pop() === mascota);
  return claveEncontrada ? datosMLB[claveEncontrada] : null;
}

module.exports = { obtenerResultadosAPIs, buscarJuegoPorNombre };
