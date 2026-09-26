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
// Hipismo (26-09-2026, ver la nota grande en hipismoPozo.js) — hasta esta
// ronda este archivo solo miraba Deportes (tickets_historial), así que el
// pozo de un cliente de Hipismo nunca se movía jugando, solo con el +/-
// manual de "Ajustar pozo". Ahora se suma también el neto de TODO el
// histórico de Hipismo (Tercios + Remate + Adelantadas) de ese mismo
// nombre — así un cliente que solo juega Hipismo, uno que solo juega
// Deportes, y uno "anclado" a los 2 (mismo nombre en ambos) quedan todos
// bien reflejados en un solo pozo, sin tocar nada de lo que ya funcionaba.
const { calcularLiquidadoHipismo } = require('./hipismoPozo');

async function calcularPozoJugador(grupoId, jugador) {
  const pozoInicial = jugador && typeof jugador.pozo_inicial !== 'undefined' ? Number(jugador.pozo_inicial) : 0;
  const historial = await leerHistorial(grupoId, { cliente: jugador.nombre });

  let liquidadoDeportes = 0;
  let congelado = 0;
  historial.forEach(h => {
    if (h.estado === 'GANADA') liquidadoDeportes += h.gana;
    else if (h.estado === 'PERDIDA') liquidadoDeportes -= h.arriesga;
    else if (esEstadoEnJuego(h.estado)) congelado += h.arriesga;
    // ANULADA (push): no suma ni resta nada, efecto $0 a propósito.
  });

  const liquidadoHipismo = await calcularLiquidadoHipismo(grupoId, jugador.nombre);
  const liquidado = liquidadoDeportes + liquidadoHipismo;

  const pozoActual = pozoInicial + liquidado;
  return { pozoInicial, liquidado, liquidadoDeportes, liquidadoHipismo, congelado, pozoActual, pozoDisponible: pozoActual - congelado };
}

module.exports = { calcularPozoJugador };
