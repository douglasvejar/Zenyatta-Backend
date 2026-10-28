// =================================================================
// EN JUEGO DE HIPISMO (28-10-2026) — lo que un cliente tiene arriesgado ahora mismo en Hipismo y todavía no se resolvió:
//   - Jugadas Adelantadas (Tablas Fijas / Marcas) en estado 'pendiente'  (hipismo_adelantadas_jugadas.monto)
//   - Tercios Adelantadas en estado 'pendiente'                          (hipismo_tercios_adelantadas_jugadas.monto)
// Los Tercios de "Cargar Planos", el Remate y los Winners nacen ya resueltos, así que no quedan "en juego".
// Esto ES plata que el cliente ya no puede volver a jugar, aunque todavía no haya ganado ni perdido: el pozo de Deportes ya la
// congela (services/pozo.js, `congelado`), pero el de Hipismo no la miraba. Lo usan el Tablero de Control de Pozos y las alertas
// de pozo (hipismoAlertaPozo.js) para que "lo que le queda" sea el mismo número en todos lados.
// =================================================================
const db = require('../db');
const { round2 } = require('./hipismoAdelantadasCalc');

// Devuelve Map(nombre -> monto en juego). Una sola consulta por tabla para todos los nombres.
async function hipismoEnJuegoPorCliente(grupoId, nombres) {
  const salida = new Map();
  const lista = Array.from(new Set((nombres || []).filter(Boolean)));
  if (!lista.length) return salida;
  const suma = (n, monto) => salida.set(n, round2((salida.get(n) || 0) + (Number(monto) || 0)));
  const rAdel = await db.query(
    `SELECT cliente_nombre AS nombre, COALESCE(SUM(monto), 0) AS total
       FROM hipismo_adelantadas_jugadas
      WHERE grupo_id = $1 AND estado = 'pendiente' AND cliente_nombre = ANY($2)
      GROUP BY cliente_nombre`,
    [grupoId, lista]
  );
  (rAdel.rows || []).forEach(f => suma(f.nombre, f.total));
  const rTerc = await db.query(
    `SELECT jugador_nombre AS nombre, COALESCE(SUM(monto), 0) AS total
       FROM hipismo_tercios_adelantadas_jugadas
      WHERE grupo_id = $1 AND estado = 'pendiente' AND jugador_nombre = ANY($2)
      GROUP BY jugador_nombre`,
    [grupoId, lista]
  );
  (rTerc.rows || []).forEach(f => suma(f.nombre, f.total));
  return salida;
}

module.exports = { hipismoEnJuegoPorCliente };
