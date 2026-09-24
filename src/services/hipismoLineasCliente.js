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

// AMPLIADO (23-09-2026, a pedido del usuario, tras confirmar que el
// cálculo de "Cargar Remate" ya daba bien: "esos totales se deben
// guardar en los saldos de los clientes, que le salga reflejado en la
// carrera y le indique que remate y cuanto... obviamente tambien debe
// cargarse a balances de saldos"). Hasta acá, esta función SOLO leía
// hipismo_tickets (las jugadas de "Cargar Planos"/Tercios) — el saldo
// semanal agregado de Cierre Final (GET /cierre-final en routes/hipismo.js)
// SÍ sumaba también hipismo_remate_apuestas desde que se construyó
// "Cargar Remate", pero estos 2 portales de cliente (el único lugar
// donde un cliente ve sus jugadas UNA POR UNA, con la carrera y el monto
// de cada una) nunca se habían tocado — un cliente que ganó o perdió un
// remate no lo veía reflejado en su propio link, aunque su saldo total
// de la semana en Cierre Final SÍ lo tuviera bien contado. Ahora se
// agrega una consulta a hipismo_remate_apuestas y se combina con la de
// Tercios — cada línea de remate lleva `tipo: 'remate'` (las de Tercios
// no llevan ese campo, por compatibilidad con el resto del código que ya
// asumía su ausencia) para que el frontend la pinte distinto y diga
// explícitamente "Remate" en vez de tratarla como una jugada normal.
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

  const lineasTercios = r.rows.map(row => {
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

  // Remate (ver la nota grande arriba): una línea por apuesta de este
  // cliente en cada remate — su `resultado` ya viene NETO (pago_ganador
  // menos lo apostado si ganó esa línea, o -monto si perdió; ver
  // calcularRemate() en services/hipismoRemateCalc.js), así que se suma
  // exactamente igual que una línea de Tercios sin ningún ajuste extra.
  const rRemate = await db.query(
    `SELECT a.caballo, a.numero_ejemplar, a.monto, a.resultado,
            rm.fecha, rm.hipodromo_nombre, rm.carrera_numero, rm.pizarra, rm.numero_ganador,
            h.pais
       FROM hipismo_remate_apuestas a
       JOIN hipismo_remates rm ON rm.id = a.remate_id
       LEFT JOIN hipismo_hipodromos h ON h.id = rm.hipodromo_id
      WHERE a.grupo_id = $1 AND a.cliente_nombre = $2
        AND rm.fecha BETWEEN $3 AND $4
      ORDER BY rm.fecha DESC, rm.creado_en ASC`,
    [grupoId, nombreJugador, desde, hasta]
  );

  const lineasRemate = rRemate.rows.map(row => {
    const fechaIso = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha;
    return {
      tipo: 'remate',
      fecha: fechaIso,
      hipodromoNombre: row.hipodromo_nombre,
      pais: row.pais || 'VE',
      carreraNumero: row.carrera_numero,
      pizarra: row.pizarra,
      caballo: row.caballo,
      numeroEjemplar: row.numero_ejemplar,
      monto: Number(row.monto),
      resultado: Number(row.resultado),
      ganoRemate: row.numero_ejemplar === row.numero_ganador
    };
  });

  // Jugadas Adelantadas (24-09-2026, a pedido del usuario: "los que los
  // clientes ven en su link debe contener toda sus jugadas no puede
  // faltar nada, yo no puedo tener un saldo y ellos otros" — reportó que
  // el saldo de Balance General y el del link de un cliente no
  // coincidían). Hasta acá, este archivo NUNCA leía
  // hipismo_adelantadas_jugadas: un cliente con una Tabla Fija o una
  // Marca ya resuelta no la veía reflejada en su propio link, aunque su
  // saldo real (el que usan Cierre Final/Semana por Días) sí la tuviera
  // contada. Mismo criterio de estados que ya usa GET /cierre-final
  // (routes/hipismo.js): el lado del CLIENTE que jugó (tf o marca) ya es
  // definitivo apenas sale de 'pendiente' — 'resuelto', 'falta_banqueo' y
  // 'sin_decidir' entran los 3. El lado de los BANQUEADORES de una Marca
  // (jsonb `banqueadores`) solo existe una vez 'resuelto' — si este mismo
  // jugador banqueó la marca de otro cliente, también le sale reflejado
  // acá como una línea aparte con rol 'banquero', igual que ya hace
  // Cierre Final con `acumular(b.nombre, b.monto)`.
  const rAdelantadas = await db.query(
    `SELECT j.tipo, j.cliente_nombre, j.carrera_numero, j.cantidad_tf, j.numero_ejemplar,
            j.numero1, j.numero2, j.monto, j.resultado_cliente, j.banqueadores, j.pizarra_usada,
            p.fecha, p.hipodromo_nombre, h.pais
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
       LEFT JOIN hipismo_hipodromos h ON h.id = p.hipodromo_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $3 AND $4
        AND j.estado IN ('resuelto', 'falta_banqueo', 'sin_decidir')
        AND (
          j.cliente_nombre = $2
          OR (j.banqueadores IS NOT NULL
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(j.banqueadores) b WHERE b->>'nombre' = $2))
        )
      ORDER BY p.fecha DESC, j.creado_en ASC`,
    [grupoId, nombreJugador, desde, hasta]
  );

  const lineasAdelantadas = [];
  rAdelantadas.rows.forEach(row => {
    const fechaIso = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha;
    const base = {
      tipo: 'adelantada',
      subtipo: row.tipo, // 'tf' | 'marca'
      fecha: fechaIso,
      hipodromoNombre: row.hipodromo_nombre,
      pais: row.pais || 'VE',
      carreraNumero: row.carrera_numero,
      pizarra: row.pizarra_usada || null,
      numeroEjemplar: row.numero_ejemplar,
      numero1: row.numero1,
      numero2: row.numero2,
      monto: Number(row.monto)
    };
    if (row.cliente_nombre === nombreJugador) {
      lineasAdelantadas.push({ ...base, rol: 'jugador', resultado: Number(row.resultado_cliente) });
    }
    if (Array.isArray(row.banqueadores)) {
      row.banqueadores.forEach(b => {
        if (b.nombre === nombreJugador) {
          lineasAdelantadas.push({ ...base, rol: 'banquero', resultado: Number(b.monto) });
        }
      });
    }
  });

  return [...lineasTercios, ...lineasRemate, ...lineasAdelantadas];
}

// Mismo texto en primera persona que ya usan hipismo-mockup.html y
// hipismo-cliente-portal.html (armarJugadaTexto): "Jugó 1P del 3" / "Dio
// 3P del 1" / "Jugó 2x6 PP" — se repite acá porque esas 2 son funciones
// de FRONTEND (corren en el navegador); esta es la versión de backend,
// para el link de Deportes con Hipismo anclado, donde el texto ya tiene
// que venir armado en el JSON (cliente.html reusa su plantilla de ticket
// de Deportes tal cual, sin lógica nueva de Hipismo del lado del cliente).
function textoJugadaHipismo(linea) {
  // Remate (23-09-2026, ver la nota grande arriba): no tiene "rol"
  // jugador/banquero ni modalidad — es una apuesta directa a un caballo
  // puntual del remate. Se marca explícitamente como "Remate" (pedido
  // del usuario: "que le indique que remate y cuanto") en vez de sonar a
  // una jugada más de Tercios.
  if (linea.tipo === 'remate') {
    return linea.ganoRemate ? `🏆 Remate — ganó con ${linea.caballo}` : `🏆 Remate — jugó ${linea.caballo}`;
  }
  // Adelantada (24-09-2026, ver la nota grande de obtenerLineasHipismoCliente
  // arriba): mismo texto ("Tabla fija (N)" / "Marca (AxB)") que ya usa
  // GET /adelantadas/pendientes en routes/hipismo.js para el operador,
  // con el mismo prefijo 🕐 que usa "Cargar Planos"/Cierre Final para
  // distinguirla de una jugada normal de Tercios.
  if (linea.tipo === 'adelantada') {
    const detalle = linea.subtipo === 'tf'
      ? `Tabla fija (${linea.numeroEjemplar})`
      : `Marca (${linea.numero1}x${linea.numero2})`;
    return linea.rol === 'banquero' ? `🕐 Adelantada — Banqueó ${detalle}` : `🕐 Adelantada — ${detalle}`;
  }
  const verbo = linea.rol === 'banquero' ? 'Dio' : 'Jugó';
  if ((linea.modalidad || '').toLowerCase() === 'pp') {
    return `${verbo} ${linea.caballoA}x${linea.caballoB} PP`;
  }
  return `${verbo} ${linea.modalidad} del ${linea.caballo}`;
}

module.exports = { obtenerLineasHipismoCliente, textoJugadaHipismo };
