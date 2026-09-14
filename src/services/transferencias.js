// Portado de app.js (sección 9C), con la lista de transferencias en la
// tabla "transferencias" en vez de localStorage.
const db = require('../db');

async function listarTransferencias(grupoId) {
  const res = await db.query(
    'SELECT id, fecha, cliente_origen, cliente_destino, monto, nota FROM transferencias WHERE grupo_id = $1 ORDER BY fecha DESC, creado_en DESC',
    [grupoId]
  );
  return res.rows;
}

async function crearTransferencia(grupoId, { fecha, clienteOrigen, clienteDestino, monto, nota }) {
  if (!clienteOrigen || !clienteDestino) throw new Error('Selecciona el cliente de origen y el cliente de destino.');
  if (clienteOrigen === clienteDestino) throw new Error('El cliente de origen y el de destino no pueden ser el mismo.');
  if (isNaN(monto) || monto <= 0) throw new Error('Ingresa un monto válido, mayor a cero.');

  const res = await db.query(
    `INSERT INTO transferencias (grupo_id, fecha, cliente_origen, cliente_destino, monto, nota)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, fecha, cliente_origen, cliente_destino, monto, nota`,
    [grupoId, fecha, clienteOrigen, clienteDestino, monto, nota || null]
  );
  return res.rows[0];
}

async function eliminarTransferencia(grupoId, id) {
  await db.query('DELETE FROM transferencias WHERE grupo_id = $1 AND id = $2', [grupoId, id]);
}

// Neto de transferencias por cliente dentro de un rango: positivo =
// recibió más de lo que envió. Cero-suma entre los 2 clientes de cada
// transferencia — no afecta el Balance General de la banca.
async function calcularTransferenciasPorCliente(grupoId, desde, hasta) {
  const condiciones = ['grupo_id = $1'];
  const params = [grupoId];
  if (desde) { params.push(desde); condiciones.push('fecha >= $' + params.length); }
  if (hasta) { params.push(hasta); condiciones.push('fecha <= $' + params.length); }
  const res = await db.query(
    `SELECT cliente_origen, cliente_destino, monto FROM transferencias WHERE ${condiciones.join(' AND ')}`,
    params
  );
  const resultado = {};
  res.rows.forEach(t => {
    const monto = Number(t.monto);
    resultado[t.cliente_destino] = (resultado[t.cliente_destino] || 0) + monto;
    resultado[t.cliente_origen] = (resultado[t.cliente_origen] || 0) - monto;
  });
  return resultado;
}

module.exports = { listarTransferencias, crearTransferencia, eliminarTransferencia, calcularTransferenciasPorCliente };
