// =================================================================
// hipismoAlertaPozo.js (07-10-2026) — ALERTA "APUESTA MÁS DE LO QUE LE
// QUEDA". Pedido del usuario: "haz el 7 pero solo con la alerta de cuando
// un cliente apuesta más de lo que le queda".
//
// Solo AVISA, nunca bloquea ni cambia ningún monto: cuando se carga un
// plano (Tercios, Jugadas Adelantadas o Tercios Adelantadas), se suma lo
// que cada cliente "avalado" (el que tiene pozo) apostó en esa carga y se
// compara contra su pozo DISPONIBLE (calcularPozoJugador, el mismo número
// que ve el cliente en su link y el Administrador en la pestaña Pozos:
// pozo inicial + todo lo liquidado de Deportes e Hipismo − lo congelado en
// juego). Si apostó más de lo que le queda, la ruta deja una alerta en
// Administración > Alertas (hipismo_alertas, tipo APUESTA_SOBRE_POZO) y
// devuelve la lista en la respuesta para que la pantalla lo muestre.
//
// Reglas:
//   - Solo clientes con tipo_cuenta = 'avalado' (los "libres" no tienen
//     pozo que cuidar) y que no sean cuentas de comisión.
//   - El pozo se lee ANTES de guardar la carga, así que el resultado de
//     esta misma carga no se cuenta dos veces.
//   - Nunca rompe la carga: cualquier error al revisar se ignora (el plano
//     se guarda igual; la alerta es solo un aviso).
// =================================================================
const db = require('../db');
const { calcularPozoJugador } = require('./pozo');
const { round2 } = require('./hipismoAdelantadasCalc');

function fmt(n) {
  return Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// apuestas: [{ nombre, monto }] — varias filas del mismo cliente se suman.
// Devuelve [{ nombre, apostado, pozoDisponible, faltante }] solo de los que
// apostaron MÁS de lo que les queda.
async function detectarApuestasSobrePozo(grupoId, apuestas) {
  const porNombre = new Map();
  (apuestas || []).forEach(a => {
    const nombre = (a && a.nombre ? String(a.nombre) : '').trim();
    const monto = Math.abs(Number(a && a.monto));
    if (!nombre || !Number.isFinite(monto) || monto <= 0) return;
    porNombre.set(nombre, (porNombre.get(nombre) || 0) + monto);
  });
  if (!porNombre.size) return [];

  const r = await db.query(
    `SELECT * FROM jugadores
      WHERE grupo_id = $1 AND nombre = ANY($2) AND tipo_cuenta = 'avalado' AND COALESCE(es_cuenta_comision, false) = false`,
    [grupoId, Array.from(porNombre.keys())]
  );
  const sobre = [];
  for (const jugador of r.rows) {
    const pozo = await calcularPozoJugador(grupoId, jugador);
    const apostado = round2(porNombre.get(jugador.nombre));
    const disponible = round2(pozo.pozoDisponible);
    if (apostado > Math.max(0, disponible) + 0.005) {
      sobre.push({ nombre: jugador.nombre, apostado, pozoDisponible: disponible, faltante: round2(apostado - Math.max(0, disponible)) });
    }
  }
  return sobre;
}

function mensajeApuestaSobrePozo(s, etiqueta) {
  return `${s.nombre} apostó ${fmt(s.apostado)}${etiqueta ? ' en ' + etiqueta : ''} y su pozo disponible es ${fmt(s.pozoDisponible)} (se pasa por ${fmt(s.faltante)}).`;
}

module.exports = { detectarApuestasSobrePozo, mensajeApuestaSobrePozo };
