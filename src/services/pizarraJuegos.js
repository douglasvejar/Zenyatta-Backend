// =================================================================
// Arma la lista deduplicada de juegos (todos los deportes conectados)
// para UNA fecha, a partir de lo que ya devolvió cada conector
// (mlbApi/nflApi/nhlApi/soccerApi/nbaApi). Extraído de la ruta
// GET /api/sabana/pizarra (routes/sabana.js) el 02-09-2026 para poder
// reusarlo también desde src/services/sabanaDia.js (pestaña "Sábanas":
// la "pizarra de resultados" de un día YA PROCESADO necesita esta misma
// lista, filtrada a los juegos relevantes de esa sábana — ver
// sabanaDia.js). Comportamiento idéntico al de siempre: 1 fila por
// juego (dedupe por equipo local+visitante o id de juego), cada fila con
// su propio campo `deporte` para que el frontend sepa con qué diseño de
// tarjeta dibujarla (ver renderJuegoCard() en app.js).
// =================================================================
function armarListaJuegos({ datosMLB, datosNFL, datosNHL, datosSoccer, datosNBA, datosNCAAF }) {
  const vistos = new Set();
  const juegos = [];
  function agregar(datosDeporte, deporte) {
    Object.values(datosDeporte || {}).forEach(info => {
      const idJuego = info.enVivo && info.enVivo.idJuego;
      const clave = deporte + ':' + (idJuego || (info.homeTeam + '@' + info.awayTeam));
      if (vistos.has(clave)) return;
      vistos.add(clave);
      juegos.push({ ...info, deporte });
    });
  }
  agregar(datosMLB, 'mlb');
  agregar(datosNFL, 'nfl');
  agregar(datosNHL, 'nhl');
  agregar(datosSoccer, 'soccer');
  agregar(datosNBA, 'basket');
  // NCAAF (12-09-2026): opcional a propósito (parámetro puede venir
  // undefined) — sabanaDia.js todavía no la pasa acá porque no arma esta
  // pizarra, solo routes/sabana.js (GET /pizarra) la manda.
  agregar(datosNCAAF, 'ncaaf');
  return juegos;
}

module.exports = { armarListaJuegos };
