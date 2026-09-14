// =================================================================
// POLLA — un juego APARTE de la sábana (02-09-2026, a pedido del
// usuario). No se procesa como jugadas: el admin del grupo ya sabe el
// resultado final de cada cliente y lo pega a mano, UNA línea por
// cliente, con el monto que le quedó (positivo = ganó ese monto,
// negativo = perdió ese monto — el mismo signo con el que después lo
// ve reflejado en su saldo). El sistema junta esos montos al saldo del
// cliente y al de la banca, y ADEMÁS los deja como un ítem aparte
// ("Polla" / "Banca Polla") en vez de mezclarlos en silencio con los
// números de la sábana.
//
// Formato de texto esperado (una línea de encabezado libre —se
// ignora— + una línea por cliente):
//
//   resultado polla
//
//   itamar -200
//   tykhe +440
//   f150 -300
//   ronaldo -267
//
// Convención de signos, verificada contra el ejemplo que mandó el
// usuario (3 clientes pierden 767 en total, 1 gana 440 -> la banca
// tiene que quedar +327):
//   - El monto de cada cliente se suma DIRECTO a su saldo del día (si
//     es negativo, el saldo del cliente baja; si es positivo, sube) —
//     ver calcularBalanceGeneral() en balanceGeneral.js.
//   - El aporte de cada cliente a la banca es la NEGACIÓN de su monto:
//     itamar -200 -> +200 para la banca, tykhe +440 -> -440 para la
//     banca, etc. Es EXACTAMENTE la misma relación que ya existe entre
//     "lo que pierde/gana el cliente" y "lo que gana/pierde la banca"
//     en la sábana (rc.perdido - rc.ganado), aplicada a un monto neto
//     en vez de a arriesgado/ganado/perdido por separado.
//
// Igual que tickets_historial (ver historial.js): reprocesar la MISMA
// fecha reemplaza (borra + inserta) en vez de acumular, así el admin
// puede pegar una versión corregida sin duplicar nada. A diferencia de
// la sábana, acá NO se auto-registra a nadie nuevo como jugador — si un
// nombre no matchea ningún jugador ACTIVO del grupo, se devuelve en
// "noEncontrados" para que el admin corrija el nombre y vuelva a pegar
// el texto (texto libre a mano es más propenso a errores de tipeo que
// el parser de la sábana, que arma la lista de nombres solo).
//
// NOTA (asunción propia, no confirmada con el usuario): los montos de
// la polla NO se cuentan para el % Devuelto/comisión de nadie — no hay
// un "arriesgado" claro para un resultado neto de pozo como sí lo hay
// en cada ticket de la sábana. Si el usuario quiere que sí sume
// comisión, hay que avisarle a Claude para agregarlo.
const db = require('./../db');
const { cargarConfigGrupo } = require('./grupoConfig');
const { desconfirmarDia } = require('./historial');

// Reconoce una línea "<nombre> <monto>": el monto es el ÚLTIMO token
// de la línea (signo +/- opcional, hasta 2 decimales con "." o ","), y
// el nombre es todo lo que queda antes — así soporta nombres con
// espacios (ej. "juan perez -100"). Cualquier línea que no matchee
// (el encabezado libre "resultado polla", líneas vacías, etc.) se
// ignora y se reporta aparte para que el admin la revise si esperaba
// que contara.
const LINEA_POLLA = /^(.+?)\s+([+-]?\d+(?:[.,]\d{1,2})?)$/;

function parsearResultadoPolla(texto) {
  const lineas = (texto || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const filas = [];
  const ignoradas = [];
  lineas.forEach(linea => {
    const m = linea.match(LINEA_POLLA);
    if (!m) { ignoradas.push(linea); return; }
    const nombre = m[1].trim().toUpperCase();
    const monto = Number(m[2].replace(',', '.'));
    if (!nombre || isNaN(monto)) { ignoradas.push(linea); return; }
    filas.push({ cliente: nombre, monto });
  });
  return { filas, ignoradas };
}

// Guarda el resultado de la polla de una fecha. Devuelve
// { guardadas: [{cliente, monto}], noEncontrados: [nombre, ...] } — el
// admin ve ambas listas en el panel para poder corregir un nombre mal
// escrito y volver a pegar el texto.
async function guardarPolla(grupoId, fecha, filas) {
  if (!fecha) { const err = new Error('Falta la fecha (YYYY-MM-DD).'); err.status = 400; throw err; }
  if (!filas || filas.length === 0) {
    const err = new Error('No se detectó ninguna línea de "cliente monto" en el texto pegado.');
    err.status = 400;
    throw err;
  }

  const { jugadoresPorNombre } = await cargarConfigGrupo(grupoId);

  const guardadas = [];
  const noEncontrados = [];
  filas.forEach(f => {
    const jugador = jugadoresPorNombre[f.cliente];
    if (!jugador || !jugador.activo) { noEncontrados.push(f.cliente); return; }
    guardadas.push({ cliente: f.cliente, monto: f.monto, jugadorId: jugador.id });
  });

  // Solo se reemplaza lo guardado de la fecha si HAY algo nuevo para
  // guardar — si todos los nombres del texto pegado vinieron mal
  // escritos, se deja intacta la última versión válida en vez de
  // borrarla sin tener con qué reemplazarla.
  if (guardadas.length > 0) {
    await db.transaccion(async (client) => {
      await client.query('DELETE FROM polla_historial WHERE grupo_id = $1 AND fecha = $2', [grupoId, fecha]);
      for (const g of guardadas) {
        await client.query(
          `INSERT INTO polla_historial (grupo_id, fecha, cliente_nombre, jugador_id, monto)
           VALUES ($1, $2, $3, $4, $5)`,
          [grupoId, fecha, g.cliente, g.jugadorId, g.monto]
        );
      }
    });
    // Mismo criterio que guardarEnHistorial() (ver historial.js): si la
    // polla de esta fecha cambió, el total del día ya no es el mismo,
    // así que cualquier "💾 Guardar Día" previo de esa fecha deja de
    // ser válido.
    await desconfirmarDia(grupoId, fecha);
  }

  return { guardadas: guardadas.map(g => ({ cliente: g.cliente, monto: g.monto })), noEncontrados };
}

async function leerPolla(grupoId, { desde, hasta, cliente } = {}) {
  const condiciones = ['grupo_id = $1'];
  const params = [grupoId];
  if (desde) { params.push(desde); condiciones.push('fecha >= $' + params.length); }
  if (hasta) { params.push(hasta); condiciones.push('fecha <= $' + params.length); }
  if (cliente) { params.push(cliente); condiciones.push('cliente_nombre = $' + params.length); }
  const res = await db.query(
    `SELECT id, fecha, cliente_nombre AS cliente, monto, nota
     FROM polla_historial WHERE ${condiciones.join(' AND ')} ORDER BY fecha DESC, creado_en`,
    params
  );
  return res.rows.map(r => ({
    id: r.id,
    fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha,
    cliente: r.cliente,
    monto: Number(r.monto),
    nota: r.nota
  }));
}

// {cliente: totalMonto} dentro de un rango — lo usa balanceGeneral.js
// para sumarlo al saldo de cada cliente y a la banca.
async function calcularPollaPorCliente(grupoId, desde, hasta) {
  const filas = await leerPolla(grupoId, { desde, hasta });
  const resultado = {};
  filas.forEach(f => { resultado[f.cliente] = (resultado[f.cliente] || 0) + f.monto; });
  return resultado;
}

async function eliminarPolla(grupoId, id) {
  await db.query('DELETE FROM polla_historial WHERE grupo_id = $1 AND id = $2', [grupoId, id]);
}

module.exports = { parsearResultadoPolla, guardarPolla, leerPolla, calcularPollaPorCliente, eliminarPolla };
