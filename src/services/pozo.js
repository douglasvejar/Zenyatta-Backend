// Portado de app.js (dentro de la sección 1C) — el pozo de un jugador
// "Avalado" se RECALCULA cada vez desde pozoInicial + todo su historial,
// en vez de mutar un número guardado paso a paso. Se mantiene ese mismo
// diseño aquí: como el usuario puede reprocesar la misma fecha varias
// veces en el día (guardarEnHistorial reemplaza limpio esa fecha), un
// valor mutado "en caliente" correría riesgo de contar un ticket 2 veces;
// recalculando siempre contra el historial guardado, nunca queda mal
// contado sin importar cuántas veces se reprocese el mismo día.
const { leerHistorial } = require('./historial');
const { esEstadoEnJuego } = require('./comisiones');

async function calcularPozoJugador(grupoId, jugador) {
  const pozoInicial = jugador && typeof jugador.pozo_inicial !== 'undefined' ? Number(jugador.pozo_inicial) : 0;
  const historial = await leerHistorial(grupoId, { cliente: jugador.nombre });

  let liquidado = 0;
  let congelado = 0;
  historial.forEach(h => {
    if (h.estado === 'GANADA') liquidado += h.gana;
    else if (h.estado === 'PERDIDA') liquidado -= h.arriesga;
    else if (esEstadoEnJuego(h.estado)) congelado += h.arriesga;
    // ANULADA (push): no suma ni resta nada, efecto $0 a propósito.
  });

  const pozoActual = pozoInicial + liquidado;
  return { pozoInicial, liquidado, congelado, pozoActual, pozoDisponible: pozoActual - congelado };
}

module.exports = { calcularPozoJugador };
