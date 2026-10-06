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
const { asegurarBanqueoAutomaticoMarcas } = require('./hipismoMarcasBanqueoAuto');
// calcularAjustesCruce (26-09-2026, a pedido del usuario: "LOS PLANOS SI
// ME ESTAN CRUZANDO LAS JUGADAS... PERO EN LOS BALANCES NO ME LA ESTA
// CRUZANDO" — ver la nota grande junto a donde se usa más abajo, y la
// nota grande de esta función en services/hipismoCalc.js).
const { calcularAjustesCruce } = require('./hipismoCalc');

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
  await asegurarBanqueoAutomaticoMarcas(grupoId); // 06-10-2026: Marcas viejas sin banquear
  const r = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.modalidad, t.caballo, t.monto,
            t.resultado_jugador, t.resultado_banquero,
            t.plano_id, t.sin_comision, p.cruza_jugadas,
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
      // sinComision (02-10-2026, a pedido del usuario: "LOS % QUE SE
      // DEVUELVEN ES DE LO DECIDIDO NO DE LO APOSTADO... SIN SACARLE EL
      // 5%") -- hace falta para que montoDecidido() (services/
      // hipismoAdelantadasCalc.js) pueda reconstruir el monto DECIDIDO de
      // esta línea a partir de `resultado` (que ya viene con el 5%
      // descontado si fue una ganancia con comisión, ver montoMostrado()
      // en hipismoCalc.js) sin inventar un 5% que en realidad nunca se
      // cobró en una jugada exenta.
      sinComision: row.sin_comision,
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

  // AJUSTE POR CRUCE (26-09-2026, a pedido del usuario: "LOS PLANOS SI ME
  // ESTAN CRUZANDO LAS JUGADAS SI ME LAS ESTA CRUZANDO FIJATE LUSHO-100
  // PERO EN LOS BALANCES NO ME LA ESTA CRUZANDO... CORRIGE" — un plano
  // con cruza_jugadas=true calcula, EN "Cargar Planos", el neto de cada
  // cliente y le cobra comisión UNA SOLA VEZ sobre ese neto — pero
  // hipismo_tickets siempre guarda cada línea "sin cruzar" (ver la nota
  // grande de calcularAjustesCruce en services/hipismoCalc.js), así que
  // lineasTercios de arriba, tal cual, NUNCA refleja el cruce. En vez de
  // alterar cada línea individual (el usuario pidió explícitamente
  // mantener cada línea como está y agregar el ajuste aparte, para poder
  // seguir viendo "Jugó/Dio X del Y" con su valor de siempre), se agrega
  // UNA línea extra por plano cruzado con la diferencia entre el neto
  // cruzado de ESTE cliente y la suma "sin cruzar" de sus propias líneas
  // en ese plano — así el total de la semana (suma de TODAS las líneas
  // visibles, incluida esta) coincide con lo que el plano realmente
  // cobra, igual en Balance General, Cierre Final y este mismo link.
  //
  // Nota: r.rows ya viene filtrado a SOLO las filas de ESTE cliente
  // (cliente_nombre = $2 OR banquero_nombre = $2) — alcanza para calcular
  // su propio ajuste, porque el neto cruzado de un nombre en un plano
  // depende ÚNICAMENTE de sus propias líneas en ese plano (nunca de las
  // de otro cliente), así que no hace falta traer el plano completo.
  const porPlanoCruzado = new Map();
  r.rows.forEach(row => {
    if (!row.cruza_jugadas) return;
    if (!porPlanoCruzado.has(row.plano_id)) porPlanoCruzado.set(row.plano_id, { tickets: [], meta: row });
    porPlanoCruzado.get(row.plano_id).tickets.push({
      clienteNombre: row.cliente_nombre,
      banqueroNombre: row.banquero_nombre,
      resultadoJugador: Number(row.resultado_jugador),
      resultadoBanquero: Number(row.resultado_banquero),
      sinComision: row.sin_comision
    });
  });
  const lineasCruce = [];
  porPlanoCruzado.forEach(({ tickets, meta }) => {
    const ajuste = calcularAjustesCruce(tickets)[nombreJugador];
    if (!ajuste) return;
    const fechaIso = meta.fecha instanceof Date ? meta.fecha.toISOString().slice(0, 10) : meta.fecha;
    lineasCruce.push({
      tipo: 'cruce_ajuste',
      fecha: fechaIso,
      hipodromoNombre: meta.hipodromo_nombre,
      pais: meta.pais || 'VE',
      carreraNumero: meta.carrera_numero,
      pizarra: meta.pizarra,
      resultado: ajuste
    });
  });

  // Remate (ver la nota grande arriba): una línea por apuesta de este
  // cliente en cada remate — su `resultado` ya viene NETO (pago_ganador
  // menos lo apostado si ganó esa línea, o -monto si perdió; ver
  // calcularRemate() en services/hipismoRemateCalc.js), así que se suma
  // exactamente igual que una línea de Tercios sin ningún ajuste extra.
  const rRemate = await db.query(
    `SELECT a.caballo, a.numero_ejemplar, a.monto, a.resultado,
            rm.fecha, rm.hipodromo_nombre, rm.carrera_numero, rm.pizarra, rm.numero_ganador, rm.modo,
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
      // "manual" (04-10-2026, ver la nota grande de POST
      // /remates/manual): no hay numero_ganador (siempre NULL en este
      // modo) — acá "ganó" se decide por el signo del monto neto que
      // escribió el operador (positivo = ganó), nunca comparando contra
      // un número ganador que no existe.
      ganoRemate: row.modo === 'manual' ? Number(row.monto) > 0 : row.numero_ejemplar === row.numero_ganador
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
      monto: Number(row.monto),
      // resultadoClienteJugada (02-10-2026, "SIEMPRE ES BASE A LO
      // DECIDIDO... LO QUE SE DECIDA EN LA JUGADA NETA"): el resultado del
      // CLIENTE que jugó esta Marca/Tabla Fija, sin importar de quién es
      // ESTA línea puntual (jugador o banquero) -- hace falta en la línea
      // del BANQUERO porque su % propio/de aval tiene que calcularse sobre
      // la PARTE decidida de la jugada (ver resolverClienteMarca/
      // resolverBanqueoMarca en hipismoAdelantadasCalc.js: "base" ahí es
      // exactamente |resultado_cliente|, gane o pierda), nunca sobre
      // `monto` (el apostado bruto de la Marca completa).
      resultadoClienteJugada: Number(row.resultado_cliente)
    };
    if (row.cliente_nombre === nombreJugador) {
      lineasAdelantadas.push({ ...base, rol: 'jugador', resultado: Number(row.resultado_cliente) });
    }
    if (Array.isArray(row.banqueadores)) {
      row.banqueadores.forEach(b => {
        if (b.nombre === nombreJugador) {
          // porcentajeBanqueado (29-09-2026, a pedido del usuario: "las
          // marcas en todas sus presentaciones... deben cumplir todas la
          // misma regla" — el % propio/de aval ya se gana banqueando en
          // Tercios, ver hipismoComisionPropia.js/hipismo.js, y ahora
          // también al banquear una Marca). `base.monto` es el monto TOTAL
          // de la jugada (no lo que banqueó puntualmente ESTE banquero) —
          // se expone `b.porcentaje` aparte para que quien calcule el %
          // propio pueda escalarlo a la PARTE real de este banquero
          // (mismo `base` que arma resolverBanqueoMarca en
          // hipismoAdelantadasCalc.js: parte = monto * porcentaje/100),
          // sin tocar el campo `monto` de siempre (se sigue mostrando
          // igual en la UI).
          lineasAdelantadas.push({ ...base, rol: 'banquero', resultado: Number(b.monto), porcentajeBanqueado: Number(b.porcentaje) || 0 });
        }
      });
    }
  });

  // "Jugadas entre Tercios Adelantadas" (04-10-2026, a pedido del
  // usuario: "NO CARGA NI LAS JUGADAS ADEALNTADAS ENTRE TERCIO NI LAS
  // TABLAS O MARCAS" -> "LA JUGADA QUE NO SALE LA CARGA POR JUGADAS
  // ADELANTDAS ENTRE TERCIOS" — este archivo nunca había leído
  // hipismo_tercios_adelantadas_jugadas: un cliente que jugó o banqueó
  // una de estas jugadas no la veía reflejada en su propio link ni en
  // "Detallado por Cliente", aunque el saldo ya se mostrara una vez (y
  // de forma efímera, sin persistir) en el Balance General de "Cargar
  // Planos" justo al guardar el plano que la resolvió (ver
  // mezclarTerciosAdelantadasEnBalance en routes/hipismo.js). A
  // diferencia de Tablas Fijas/Marcas, acá jugador Y banquero son 2
  // nombres de texto planos en la misma fila (más parecido a
  // hipismo_tickets que a hipismo_adelantadas_jugadas) — no hace falta
  // revisar un jsonb de banqueadores aparte, cada fila ya le pertenece a
  // los 2. 'sin_decidir' (jugada resuelta pero neta en 0 para los 2
  // lados) entra igual que en Tablas Fijas/Marcas, con resultado 0 de
  // los 2 lados — no afecta el saldo pero sí cuenta como "jugada" ya
  // decidida. No existe estado 'falta_banqueo' acá (jugador Y banquero
  // ya vienen puestos desde el texto original, nunca falta uno de los 2
  // para que la jugada se resuelva).
  const rTerciosAdelantadas = await db.query(
    `SELECT j.jugador_nombre, j.banquero_nombre, j.carrera_numero, j.es_cruce,
            j.grupo_caballos, j.cruce_grupo_a, j.cruce_grupo_b, j.modalidad, j.monto,
            j.resultado_jugador, j.resultado_banquero, j.comision_grupo, j.comision_porcentaje, j.pizarra_usada,
            p.fecha, p.hipodromo_nombre, h.pais
       FROM hipismo_tercios_adelantadas_jugadas j
       JOIN hipismo_tercios_adelantadas_planos p ON p.id = j.plano_id
       LEFT JOIN hipismo_hipodromos h ON h.id = p.hipodromo_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $3 AND $4
        AND j.estado IN ('resuelto', 'sin_decidir')
        AND (j.jugador_nombre = $2 OR j.banquero_nombre = $2)
      ORDER BY p.fecha DESC, j.creado_en ASC`,
    [grupoId, nombreJugador, desde, hasta]
  );
  const lineasTerciosAdelantadas = rTerciosAdelantadas.rows.map(row => {
    const esJugador = row.jugador_nombre === nombreJugador;
    const rol = esJugador ? 'jugador' : 'banquero';
    const resultado = Number(esJugador ? row.resultado_jugador : row.resultado_banquero);
    const fechaIso = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha;
    return {
      tipo: 'tercios_adelantada',
      fecha: fechaIso,
      hipodromoNombre: row.hipodromo_nombre,
      pais: row.pais || 'VE',
      carreraNumero: row.carrera_numero,
      pizarra: row.pizarra_usada,
      esCruce: row.es_cruce,
      grupoCaballos: row.grupo_caballos,
      cruceGrupoA: row.cruce_grupo_a,
      cruceGrupoB: row.cruce_grupo_b,
      modalidad: row.modalidad,
      monto: Number(row.monto),
      rol,
      resultado,
      // % de comisión configurado en ESTA jugada (default 5) -- hace falta
      // para deshacerlo y obtener la base decidida del % devuelto propio/de
      // aval (ver montoBaseTerciosAdelantadaExacto en
      // hipismoTerciosAdelantadasCalc.js).
      comisionPorcentaje: row.comision_porcentaje === undefined || row.comision_porcentaje === null ? 5 : Number(row.comision_porcentaje)
    };
  });

  // "Cargar Winners" (26-09-2026, a pedido del usuario: "es como si
  // fuera una jugada mas... eso mueve su balance y su pozo") — cada fila
  // ya es el resultado NETO de este cliente (monto con signo), sin
  // comisión ni "monto apostado" aparte (Winners no tiene ninguno de los
  // 2, a diferencia de Tercios/Remate/Adelantadas).
  const rWinners = await db.query(
    `SELECT w.caballo, w.monto, w.fecha, w.hipodromo_nombre, w.carrera_numero, h.pais
       FROM hipismo_winners w
       LEFT JOIN hipismo_hipodromos h ON h.id = w.hipodromo_id
      WHERE w.grupo_id = $1 AND w.cliente_nombre = $2
        AND w.fecha BETWEEN $3 AND $4
      ORDER BY w.fecha DESC, w.creado_en ASC`,
    [grupoId, nombreJugador, desde, hasta]
  );
  const lineasWinners = rWinners.rows.map(row => {
    const fechaIso = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha;
    return {
      tipo: 'winner',
      fecha: fechaIso,
      hipodromoNombre: row.hipodromo_nombre,
      pais: row.pais || 'VE',
      carreraNumero: row.carrera_numero,
      caballo: row.caballo,
      monto: Number(row.monto),
      resultado: Number(row.monto)
    };
  });

  return [...lineasTercios, ...lineasRemate, ...lineasAdelantadas, ...lineasTerciosAdelantadas, ...lineasWinners, ...lineasCruce];
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
  // Winner (26-09-2026, ver la nota grande arriba): no tiene modalidad ni
  // rol jugador/banquero — es el resultado directo que cargó el operador
  // para ese caballo.
  if (linea.tipo === 'winner') {
    return linea.resultado >= 0 ? `🏆 Winner — ganó con ${linea.caballo}` : `🏆 Winner — perdió con ${linea.caballo}`;
  }
  // Ajuste por cruce (26-09-2026, ver la nota grande de arriba): no tiene
  // modalidad ni rol jugador/banquero — es la diferencia que deja el
  // cruce de jugadas de ese plano.
  if (linea.tipo === 'cruce_ajuste') {
    return '🔀 Ajuste por cruce';
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
  // Jugadas entre Tercios Adelantadas (04-10-2026, ver la nota grande de
  // obtenerLineasHipismoCliente arriba): mismo texto EXACTO que ya arma
  // textoJugadaTerciosAdelantada() en hipismo-mockup.html para el
  // operador, con el prefijo 🎯 (mismo emoji del nav de esa pestaña) en
  // vez del 🕐 de Tablas Fijas/Marcas, para no confundir las 2.
  if (linea.tipo === 'tercios_adelantada') {
    const modTxt = linea.modalidad ? ` ${String(linea.modalidad).toUpperCase()}` : '';
    const detalle = linea.esCruce
      ? `${(linea.cruceGrupoA || []).join('y')} x ${(linea.cruceGrupoB || []).join('y')}${modTxt}`
      : `${(linea.grupoCaballos || []).join('y')}${modTxt}`;
    return linea.rol === 'banquero' ? `🎯 Adelantada entre tercios — Dio ${detalle}` : `🎯 Adelantada entre tercios — Jugó ${detalle}`;
  }
  const verbo = linea.rol === 'banquero' ? 'Dio' : 'Jugó';
  if ((linea.modalidad || '').toLowerCase() === 'pp') {
    return `${verbo} ${linea.caballoA}x${linea.caballoB} PP`;
  }
  return `${verbo} ${linea.modalidad} del ${linea.caballo}`;
}

module.exports = { obtenerLineasHipismoCliente, textoJugadaHipismo };
