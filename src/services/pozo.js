// Portado de app.js (dentro de la sección 1C) — el pozo de un jugador
// "Avalado" se RECALCULA cada vez desde pozoInicial + todo su historial,
// en vez de mutar un número guardado paso a paso. Se mantiene ese mismo
// diseño aquí: como el usuario puede reprocesar la misma fecha varias
// veces en el día (guardarEnHistorial reemplaza limpio esa fecha), un
// valor mutado "en caliente" correría riesgo de contar un ticket 2 veces;
// recalculando siempre contra el historial guardado, nunca queda mal
// contado sin importar cuántas veces se reprocese el mismo día.
//
// POZO SEMANAL (07-10-2026, a pedido del usuario: "los pozos deben
// reiniciarse a lo que les coloqué en un principio cada semana nueva...
// si un tercio decía 5000 de pozo, al venir semana nueva debe volver a
// tener sus 5000"): hasta esta ronda el pozo era pozo_inicial + TODO lo
// ganado/perdido de siempre, así que nunca volvía a su monto. Ahora:
//
//   pozo de la semana = POZO BASE (jugadores.pozo_inicial: lo que se le
//                       colocó al cliente, con sus ajustes +/-)
//                     + lo ganado/perdido jugando ESTA semana
//
// "Esta semana" es la semana activa del grupo (Administración > Fecha de
// Semana, services/hipismoSemana.js — Lunes→Domingo si no la cambió), la
// misma que usan Balance General y Cierre Final. Al cambiar de semana el
// liquidado vuelve a 0 y el pozo queda otra vez en su base.
//
// Decisión confirmada con el usuario: lo que se coloque con "Ajustar pozo"
// (+/-) queda como el pozo BASE del cliente para siempre (en Hipismo es la
// única forma de ponerle pozo a un cliente, así que si solo valiera una
// semana los pozos volverían a 0). Cada semana nueva el pozo vuelve a ese
// monto base: jugadores.pozo_inicial.
//
// Lo que está EN JUEGO (Deportes pendiente) sigue congelado mientras no se
// resuelva, sin importar de qué semana sea: todavía es plata arriesgada.
const { leerHistorial } = require('./historial');
const { esEstadoEnJuego } = require('./comisiones');
// Hipismo (26-09-2026, ver la nota grande en hipismoPozo.js) — hasta esta
// ronda este archivo solo miraba Deportes (tickets_historial), así que el
// pozo de un cliente de Hipismo nunca se movía jugando, solo con el +/-
// manual de "Ajustar pozo". Ahora se suma también el neto de Hipismo
// (Tercios + Remate + Adelantadas + Winners) de ese mismo nombre — así un
// cliente que solo juega Hipismo, uno que solo juega Deportes, y uno
// "anclado" a los 2 (mismo nombre en ambos) quedan todos bien reflejados
// en un solo pozo, sin tocar nada de lo que ya funcionaba.
const { calcularLiquidadoHipismo } = require('./hipismoPozo');
const { rangoSemanaGrupo } = require('./hipismoSemana');

// 'hoy' en hora de Venezuela (UTC-4), igual que el resto de Hipismo.
function hoyVenezuela() { return new Date(Date.now() - 4 * 60 * 60 * 1000); }

const redondear = n => Math.round((Number(n) || 0) * 100) / 100;

// Semana activa del grupo como { desde, hasta } ('YYYY-MM-DD'). Si no se
// puede leer la configuración cae a Lunes→Domingo (rangoSemanaGrupo ya lo
// hace) — nunca tumba el pozo.
async function rangoSemanaActualPozo(grupoId) {
  const r = await rangoSemanaGrupo(grupoId, hoyVenezuela(), 0);
  return { desde: r.desde, hasta: r.hasta };
}

// opciones.rango: semana ya resuelta (para no recalcularla por cada jugador
// cuando se arma la lista completa).
async function calcularPozoJugador(grupoId, jugador, opciones) {
  const pozoGuardado = jugador && typeof jugador.pozo_inicial !== 'undefined' ? Number(jugador.pozo_inicial) : 0;
  const rango = (opciones && opciones.rango) || await rangoSemanaActualPozo(grupoId);
  // "Pozo asignado" = la base; a eso se le suma/resta lo jugado esta semana —
  // así pozoInicial + liquidado = pozoActual, como lo muestra la pantalla Pozos.
  const pozoInicial = pozoGuardado;

  const historial = await leerHistorial(grupoId, { cliente: jugador.nombre });

  let liquidadoDeportes = 0;
  let congelado = 0;
  historial.forEach(h => {
    if (esEstadoEnJuego(h.estado)) { congelado += h.arriesga; return; } // siempre congelado, sea de la semana que sea
    if (!(h.fecha >= rango.desde && h.fecha <= rango.hasta)) return;       // lo ya resuelto solo cuenta en SU semana
    if (h.estado === 'GANADA') liquidadoDeportes += h.gana;
    else if (h.estado === 'PERDIDA') liquidadoDeportes -= h.arriesga;
    // ANULADA (push): no suma ni resta nada, efecto $0 a propósito.
  });

  const liquidadoHipismo = await calcularLiquidadoHipismo(grupoId, jugador.nombre, rango);
  const liquidado = liquidadoDeportes + liquidadoHipismo;

  const pozoActual = pozoInicial + liquidado;
  return {
    pozoInicial, rango,
    liquidado, liquidadoDeportes, liquidadoHipismo, congelado,
    pozoActual, pozoDisponible: pozoActual - congelado
  };
}

module.exports = { calcularPozoJugador, rangoSemanaActualPozo };
