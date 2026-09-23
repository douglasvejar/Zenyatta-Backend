// =================================================================
// Jugadas de HIPISMO de un cliente puntual, para un rango de fechas —
// compartido entre el portal público de Hipismo (routes/hipismoCliente.js,
// que lo usa para SU PROPIO cliente) y el portal público de Deportes
// (routes/cliente.js, que lo usa para "anclar" Hipismo cuando el
// Administrador prendió jugadores.modulos_anclados para ese cliente — ver
// la nota grande en sql/schema.sql, 23-09-2026).
//
// Se saca a un archivo propio para no duplicar la consulta ni la regla
// de "quién es el ganador de la línea" en 2 rutas distintas.
// =================================================================
const db = require('../db');

async function obtenerLineasHipismoCliente(grupoId, nombreJugador, desde, hasta) {
  const r = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.modalidad, t.caballo, t.monto,
            t.resultado_jugador, t.resultado_banquero,
            p.fecha, p.hipodromo_nombre, p.carrera_numero, p.pizarra,
            h.pais
       FROM hipismo_tickets t
       JOIN hipismo_planos p ON p.id = t.plano_id
       LEFT JOIN hipismo_hipodromos h ON h.id = p.hipodromo_id
      WHERE t.grupo_id = $1 AND (t.cliente_nombre = $2 OR t.banquero_nombre = $2)
        AND p.fecha BETWEEN $3 AND $4
      ORDER BY p.fecha DESC, p.creado_en ASC`,
    [grupoId, nombreJugador, desde, hasta]
  );

  return r.rows.map(row => {
    const esJugador = row.cliente_nombre === nombreJugador;
    const rol = esJugador ? 'jugador' : 'banquero';
    const resultado = Number(esJugador ? row.resultado_jugador : row.resultado_banquero);
    const fechaIso = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha;

    const linea = {
      fecha: fechaIso,
      hipodromoNombre: row.hipodromo_nombre,
      pais: row.pais || 'VE',
      carreraNumero: row.carrera_numero,
      pizarra: row.pizarra,
      modalidad: row.modalidad,
      caballo: row.caballo,
      monto: Number(row.monto),
      rol,
      resultado
    };
    if (row.modalidad === 'pp') {
      const partes = String(row.caballo).split(/x/i);
      linea.caballoA = partes[0];
      linea.caballoB = partes[1];
    }
    return linea;
  });
}

// Mismo texto en primera persona que ya usan hipismo-mockup.html y
// hipismo-cliente-portal.html (armarJugadaTexto): "Jugó 1P del 3" / "Dio
// 3P del 1" / "Jugó 2x6 PP" — se repite acá porque esas 2 son funciones
// de FRONTEND (corren en el navegador); esta es la versión de backend,
// para el link de Deportes con Hipismo anclado, donde el texto ya tiene
// que venir armado en el JSON (cliente.html reusa su plantilla de ticket
// de Deportes tal cual, sin lógica nueva de Hipismo del lado del cliente).
function textoJugadaHipismo(linea) {
  const verbo = linea.rol === 'banquero' ? 'Dio' : 'Jugó';
  if ((linea.modalidad || '').toLowerCase() === 'pp') {
    return `${verbo} ${linea.caballoA}x${linea.caballoB} PP`;
  }
  return `${verbo} ${linea.modalidad} del ${linea.caballo}`;
}

module.exports = { obtenerLineasHipismoCliente, textoJugadaHipismo };
