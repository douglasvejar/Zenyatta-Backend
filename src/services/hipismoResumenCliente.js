// =================================================================
// Resumen semanal de UN cliente de Hipismo (24-09-2026, a pedido del
// usuario: nueva pestaña "Saldos > Detallado por Cliente" — "basicamente
// lo mismo que balance general pero al darle click al cliente puedo ver
// todas sus jugadas, asi como ellos la ven en sus links personalizados").
//
// Esto es EXACTAMENTE el mismo armado (día > hipódromo > carreras, con
// Deportes "anclado" si aplica) que ya usaba routes/hipismoCliente.js
// (el portal público, sin login, por token) — se saca a este archivo
// propio para poder reusarlo tal cual desde 2 lugares sin duplicar la
// lógica:
//   1) el portal público del cliente (routes/hipismoCliente.js, busca al
//      jugador por su token, sin sesión), y
//   2) la nueva pantalla del Administrador "Detallado por Cliente"
//      (GET /api/hipismo/clientes/:nombre/detalle-semana en
//      routes/hipismo.js, con sesión normal, busca al jugador por
//      nombre+grupo) — así el Administrador ve EXACTAMENTE lo mismo que
//      el cliente ve en su propio link, sin poder desviarse nunca de esa
//      fuente ("puedo ver todas sus jugadas, asi como ellos la ven en
//      sus links personalizados").
const { obtenerLineasHipismoCliente } = require('./hipismoLineasCliente');
const { leerHistorial } = require('./historial');
const db = require('../db');
const { round2 } = require('./hipismoAdelantadasCalc');
// obtenerComisionesPropias (26-09-2026, ver la nota grande de
// construirResumenCuentaComisionHipismo más abajo) — MISMA función que ya
// usa routes/hipismo.js para Balance General/Cierre Final/Saldo
// Comisiones, ahora en su propio archivo (services/hipismoComisionPropia.js)
// precisamente para poder reusarla acá sin duplicarla.
const { obtenerComisionesPropias } = require('./hipismoComisionPropia');

// "⚽ Deportes" se guarda como un hipódromo más dentro de "dias[].hipodromos"
// (mismo shape que un hipódromo real), pero con tipo:'deportes' — ver la
// nota grande que tenía routes/hipismoCliente.js antes de este refactor.
const NOMBRE_BLOQUE_DEPORTES = 'Deportes';
// "🔄 Traspasos de Comisión" (26-09-2026, ver la nota grande de
// construirResumenCuentaComisionHipismo más abajo) — mismo criterio que
// el bloque de Deportes de arriba: un pseudo-hipódromo más dentro de
// "dias[].hipodromos", con tipo:'traspaso', SOLO puede aparecer en el
// resumen de una cuenta de comisión (nunca en el de un cliente normal).
const NOMBRE_BLOQUE_TRASPASOS = 'Traspasos de Comisión';

function resultadoTicketDeportes(t) {
  if (t.estado === 'GANADA') return t.gana;
  if (t.estado === 'PERDIDA') return -t.arriesga;
  return 0;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDeFechaUTC(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function hoyVenezuela() { return new Date(Date.now() - 4 * 60 * 60 * 1000); }
function rangoSemana(fecha, offsetSemanas) {
  const diaSemana = fecha.getUTCDay();
  const diffHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(fecha);
  lunes.setUTCDate(lunes.getUTCDate() + diffHastaLunes + offsetSemanas * 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  return { desde: isoDeFechaUTC(lunes), hasta: isoDeFechaUTC(domingo) };
}

// =================================================================
// RESUMEN DE UNA CUENTA DE COMISIÓN (26-09-2026, a pedido del usuario:
// "LOS LINK DE % NO DAN SALDO DICEN 0") — hasta esta ronda, el link de
// un cliente "{nombre} - PORCENTAJE" (jugadores.es_cuenta_comision=true,
// ver la nota grande en sql/schema.sql) caía en la rama de siempre de
// construirResumenClienteHipismo de más abajo, que busca jugadas donde
// cliente_nombre/banquero_nombre = el nombre de la cuenta — pero una
// cuenta de comisión NUNCA tiene jugadas propias (Cargar Planos/Remates
// ni siquiera la ofrecen como "quién apostó", ver la nota grande de
// obtenerComisionesPropias en services/hipismoComisionPropia.js), así
// que esa consulta siempre volvía vacía y el link mostraba saldo 0,
// aunque GET /cierre-final y GET /saldo-comisiones (routes/hipismo.js) SÍ
// venían calculando bien su saldo agregado hace rato.
//
// Esta función replica ESA MISMA fórmula ("% de TODO lo que el cliente
// real apostó COMO JUGADOR — Tercios + Remate + Adelantadas, nunca lo que
// banqueó, y Winners nunca cuenta — gane o pierda cada jugada puntual",
// ver la nota grande de agregarPorcentajeDevuelto) pero a nivel de
// DETALLE (carrera por carrera, no solo el total semanal), reusando:
//   1) obtenerComisionesPropias (services/hipismoComisionPropia.js) para
//      resolver, de cada cliente real candidato, si su % (propio y/o de
//      aval) apunta a ESTA cuenta puntual, y
//   2) obtenerLineasHipismoCliente (mismo archivo que usa el resumen
//      normal, más abajo) para traer, SIN escribir ninguna consulta SQL
//      nueva de jugadas, el detalle carrera por carrera de cada cliente
//      real que alimenta esta cuenta.
// Los "Traspasos de Comisión" (ajustes manuales, ver POST
// /comisiones/traspaso en routes/hipismo.js) sí quedan guardados con el
// nombre de la cuenta como cliente_nombre directo, así que esos se leen
// aparte y se muestran como su propio pseudo-hipódromo "🔄 Traspasos de
// Comisión" (mismo criterio que ya usa el bloque "⚽ Deportes" anclado).
async function construirResumenCuentaComisionHipismo(jugador, grupo, semanaParam, rangoPersonalizado) {
  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  // Candidatos: clientes reales (nunca otra cuenta de comisión) cuyo %
  // propio y/o % de algún avalador resuelve a ESTA cuenta puntual — el
  // destino ya quedó enlazado acá en jugadores.cuenta_comision_id la
  // primera vez que se guardó un Plano/Remate que generó comisión (ver
  // asegurarCuentasComisionParaNombres en services/hipismoComisionPropia.js),
  // así que resolverlo es un simple JOIN/EXISTS, sin adivinar nombres.
  //
  // 28-09-2026: comision_propia ahora SIEMPRE es para el propio cliente
  // (se quitó la opción de mandarlo al aval), y el % de aval pasó de un
  // solo avalado_por_id/porcentaje_devuelto_aval a la tabla
  // jugadores_avales_porcentaje (varios avaladores por cliente) — ver la
  // nota grande de obtenerComisionesPropias en services/hipismoComisionPropia.js.
  //
  // 29-09-2026: "incluir % en sus jugadas" — si el propio cliente tiene
  // el toggle en ON, su comision_propia YA NO alimenta ninguna cuenta
  // aparte (se acumula directo en sus propias jugadas, ver
  // construirResumenClienteHipismo más abajo) — el primer cond1 lo
  // excluye a propósito. El % que gane por ser AVALADOR de otros
  // (cond2) nunca se ve afectado por su propio toggle.
  const rFuentes = await db.query(
    `SELECT j.nombre
       FROM jugadores j
      WHERE j.grupo_id = $1
        AND NOT COALESCE(j.es_cuenta_comision, false)
        AND (
          (j.cuenta_comision_id = $2 AND j.comision_propia > 0 AND NOT COALESCE(j.incluir_porcentaje_en_jugadas, false))
          OR EXISTS (
            SELECT 1 FROM jugadores_avales_porcentaje jap
              JOIN jugadores av ON av.id = jap.avalador_id
             WHERE jap.jugador_id = j.id AND jap.porcentaje > 0 AND av.cuenta_comision_id = $2
          )
        )`,
    [jugador.grupo_id, jugador.id]
  );
  const nombresFuente = rFuentes.rows.map(row => row.nombre);

  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;
  let cantidadJugadas = 0;

  if (nombresFuente.length) {
    const comisionesPropias = await obtenerComisionesPropias(jugador.grupo_id, nombresFuente);

    for (const nombreFuente of nombresFuente) {
      // Puede haber hasta 2 entradas para este mismo cliente (% propio +
      // % de aval, ver la nota grande de obtenerComisionesPropias) — acá
      // solo interesan las que apuntan a ESTA cuenta puntual.
      const entradas = (comisionesPropias[nombreFuente] || [])
        .filter(info => info && info.pct && info.cuentaNombre === jugador.nombre);
      if (!entradas.length) continue;

      const lineas = await obtenerLineasHipismoCliente(jugador.grupo_id, nombreFuente, desde, hasta);
      lineas.forEach(linea => {
        // Winners nunca genera % devuelto — no tiene "monto apostado"
        // (ver la nota grande de agregarPorcentajeDevuelto). Remate
        // (26-09-2026, a pedido del usuario: "LOS REMATES NO LE PRODUCEN
        // % DE DEVOLUCION A LOS CLIENTES") tampoco genera %, sin importar
        // el rol. "cruce_ajuste" (ver hipismoLineasCliente.js) no es una
        // jugada con monto propio, es un ajuste de saldo — no aporta base
        // para calcular ningún %.
        if (linea.tipo === 'winner') return;
        if (linea.tipo === 'remate') return;
        if (linea.tipo === 'cruce_ajuste') return;
        // TAMBIÉN EL LADO BANQUERO DE TERCIOS (29-09-2026, caso real
        // "Mrincreible": tenía 1% propio y avales configurados, pero en
        // la jugada real era el BANQUERO, no el cliente — antes esto se
        // excluía a propósito ("solo el rol JUGADOR genera %"); el
        // usuario confirmó que ahora SÍ quiere que el % se gane también
        // banqueando). El banqueo de Marcas (Jugadas Adelantadas) queda A
        // PROPÓSITO fuera de este cambio por ahora — su alcance no se
        // confirmó con el usuario, así que se sigue excluyendo.
        if (linea.tipo === 'adelantada' && linea.rol === 'banquero') return;

        entradas.forEach(info => {
          const devuelto = round2(Math.abs(Number(linea.monto) || 0) * (info.pct / 100));
          if (!devuelto) return;

          const fechaIso = linea.fecha;
          if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
          const hipMap = porDia.get(fechaIso);
          const hipNombre = linea.hipodromoNombre;
          if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, pais: linea.pais, carreras: [] });

          hipMap.get(hipNombre).carreras.push({
            tipo: 'comision',
            origenTipo: linea.tipo || 'tercios',
            carrera: linea.carreraNumero,
            pizarra: linea.pizarra,
            modalidad: linea.modalidad,
            caballo: linea.caballo,
            clienteOrigen: nombreFuente,
            porcentaje: info.pct,
            monto: Math.abs(Number(linea.monto) || 0),
            resultado: devuelto
          });

          totalSemana += devuelto;
          cantidadJugadas += 1;
          if (fechaIso === hoyIso) totalHoy += devuelto;
        });
      });
    }
  }

  // Traspasos de Comisión (ajustes manuales, ver POST /comisiones/traspaso
  // en routes/hipismo.js) — a diferencia de arriba, estos SÍ quedan
  // guardados directamente con el nombre de esta cuenta como
  // cliente_nombre, así que se leen tal cual, uno por fila.
  const rTraspasos = await db.query(
    `SELECT monto, fecha, nota FROM hipismo_comisiones_ajustes
      WHERE grupo_id = $1 AND cliente_nombre = $2 AND fecha BETWEEN $3 AND $4
      ORDER BY fecha DESC, creado_en ASC`,
    [jugador.grupo_id, jugador.nombre, desde, hasta]
  );
  rTraspasos.rows.forEach(row => {
    const monto = Number(row.monto);
    const fechaIso = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    if (!hipMap.has(NOMBRE_BLOQUE_TRASPASOS)) {
      hipMap.set(NOMBRE_BLOQUE_TRASPASOS, { nombre: NOMBRE_BLOQUE_TRASPASOS, tipo: 'traspaso', carreras: [] });
    }
    hipMap.get(NOMBRE_BLOQUE_TRASPASOS).carreras.push({
      tipo: 'traspaso',
      nota: row.nota || null,
      resultado: monto
    });

    totalSemana += monto;
    cantidadJugadas += 1;
    if (fechaIso === hoyIso) totalHoy += monto;
  });

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    grupo: { nombre: grupo.nombre, logoUrl: grupo.logo_url },
    jugador: { nombre: jugador.nombre },
    semana,
    rango: { desde, hasta },
    rangoPersonalizado: !!rangoPersonalizado,
    hoy: hoyIso,
    esSemanaActual: !rangoPersonalizado && hoyIso >= desde && hoyIso <= hasta,
    // Una cuenta de comisión nunca tiene Deportes anclado propio — su
    // saldo es 100% derivado de otros clientes de Hipismo.
    modulos: { hipismo: true, deportes: false },
    resumen: {
      totalSemana: round2(totalSemana),
      totalHoy: round2(totalHoy),
      cantidadJugadas,
      totalHipismo: round2(totalSemana),
      totalDeportes: 0,
      cantidadJugadasHipismo: cantidadJugadas,
      cantidadJugadasDeportes: 0
    },
    dias
  };
}

// jugador: fila de "jugadores" (necesita .grupo_id, .nombre, .modulos_anclados).
// grupo: fila de "grupos" (necesita .nombre, .logo_url, .modulo_deportes_habilitado).
// semanaParam: 'actual' (default) | 'anterior'.
async function construirResumenClienteHipismo(jugador, grupo, semanaParam, rangoPersonalizado) {
  // Cuenta de comisión ("{nombre} - PORCENTAJE", ver la nota grande de
  // construirResumenCuentaComisionHipismo arriba) — nunca tiene jugadas
  // propias, así que su saldo se arma con una lógica completamente
  // aparte (26-09-2026, al arreglar "LOS LINK DE % NO DAN SALDO DICEN 0").
  if (jugador.es_cuenta_comision) {
    return construirResumenCuentaComisionHipismo(jugador, grupo, semanaParam, rangoPersonalizado);
  }

  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const lineasHipismo = await obtenerLineasHipismoCliente(jugador.grupo_id, jugador.nombre, desde, hasta);

  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;

  // "incluir % en sus jugadas" (29-09-2026, ver la nota grande en
  // sql/schema.sql, columna jugadores.incluir_porcentaje_en_jugadas) —
  // con el toggle en ON, la propia comisión de este cliente
  // (jugadores.comision_propia) se sube DIRECTO al resultado de cada una
  // de sus jugadas, en vez de ir a una cuenta "{nombre} - PORCENTAJE"
  // aparte (ver obtenerComisionesPropias en services/hipismoComisionPropia.js,
  // que es donde se corta esa cuenta aparte para este mismo cliente).
  const pctPropioIncluido = jugador.incluir_porcentaje_en_jugadas ? (Number(jugador.comision_propia) || 0) : 0;
  let comisionPropiaIncluidaSemana = 0;

  lineasHipismo.forEach(linea => {
    const fechaIso = linea.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    const hipNombre = linea.hipodromoNombre;
    if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, pais: linea.pais, carreras: [] });

    // Remate/Winner/cruce_ajuste nunca traen `.rol` en absoluto (ver
    // obtenerLineasHipismoCliente en services/hipismoLineasCliente.js),
    // así que quedan excluidos solos con el chequeo de `linea.rol`.
    //
    // TAMBIÉN EL LADO BANQUERO DE TERCIOS (29-09-2026, mismo caso
    // "Mrincreible" — ver la nota grande en
    // construirResumenCuentaComisionHipismo más arriba): antes esto solo
    // contaba `linea.rol === 'jugador'`, a propósito ("nunca lo que
    // banqueó"); el usuario confirmó que ahora el % también se gana
    // banqueando en Tercios. El banqueo de Marcas (Jugadas Adelantadas)
    // sigue A PROPÓSITO excluido — su alcance no se confirmó.
    let comisionIncluida = 0;
    if (pctPropioIncluido && linea.rol && !(linea.tipo === 'adelantada' && linea.rol === 'banquero')) {
      comisionIncluida = round2(Math.abs(Number(linea.monto) || 0) * (pctPropioIncluido / 100));
    }
    const resultadoFinal = comisionIncluida ? round2(linea.resultado + comisionIncluida) : linea.resultado;

    const carrera = {
      carrera: linea.carreraNumero,
      pizarra: linea.pizarra,
      modalidad: linea.modalidad,
      monto: linea.monto,
      rol: linea.rol,
      resultado: resultadoFinal,
      tipo: linea.tipo,
      ganoRemate: linea.ganoRemate,
      subtipo: linea.subtipo,
      numeroEjemplar: linea.numeroEjemplar,
      numero1: linea.numero1,
      numero2: linea.numero2
    };
    if (comisionIncluida) carrera.comisionPropiaIncluida = comisionIncluida;
    if (linea.modalidad === 'pp') {
      carrera.caballoA = linea.caballoA;
      carrera.caballoB = linea.caballoB;
    } else if (linea.tipo !== 'adelantada') {
      carrera.caballo = linea.caballo;
    }
    hipMap.get(hipNombre).carreras.push(carrera);

    totalSemana += resultadoFinal;
    comisionPropiaIncluidaSemana += comisionIncluida;
    if (fechaIso === hoyIso) totalHoy += resultadoFinal;
  });

  const totalHipismo = totalSemana;
  let totalDeportes = 0;
  let cantidadJugadasDeportes = 0;

  const deportesAnclado = !!(jugador.modulos_anclados && grupo.modulo_deportes_habilitado);
  if (deportesAnclado) {
    const ticketsDeportes = await leerHistorial(jugador.grupo_id, { desde, hasta, cliente: jugador.nombre });
    ticketsDeportes.forEach(t => {
      const resultado = resultadoTicketDeportes(t);
      const fechaIso = t.fecha;

      if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
      const hipMap = porDia.get(fechaIso);
      if (!hipMap.has(NOMBRE_BLOQUE_DEPORTES)) {
        hipMap.set(NOMBRE_BLOQUE_DEPORTES, { nombre: NOMBRE_BLOQUE_DEPORTES, tipo: 'deportes', carreras: [] });
      }
      hipMap.get(NOMBRE_BLOQUE_DEPORTES).carreras.push({
        ticket: t.ticket,
        detalle: t.detalle,
        estado: t.estado,
        monto: t.arriesga,
        resultado
      });

      totalDeportes += resultado;
      cantidadJugadasDeportes += 1;
      totalSemana += resultado;
      if (fechaIso === hoyIso) totalHoy += resultado;
    });
  }

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    grupo: { nombre: grupo.nombre, logoUrl: grupo.logo_url },
    jugador: { nombre: jugador.nombre },
    semana,
    rango: { desde, hasta },
    rangoPersonalizado: !!rangoPersonalizado,
    hoy: hoyIso,
    esSemanaActual: !rangoPersonalizado && hoyIso >= desde && hoyIso <= hasta,
    modulos: { hipismo: true, deportes: deportesAnclado },
    resumen: {
      totalSemana,
      totalHoy,
      cantidadJugadas: lineasHipismo.length + cantidadJugadasDeportes,
      totalHipismo,
      totalDeportes,
      cantidadJugadasHipismo: lineasHipismo.length,
      cantidadJugadasDeportes,
      // "incluir % en sus jugadas" (29-09-2026) — cuánto de totalSemana/
      // totalHipismo de arriba es comisión propia YA incluida en las
      // jugadas de este cliente (0 si el toggle está OFF o no tiene %) —
      // el frontend lo puede mostrar como referencia, sin que afecte el
      // total (que ya la trae sumada).
      comisionPropiaIncluidaSemana: round2(comisionPropiaIncluidaSemana)
    },
    dias
  };
}

// =================================================================
// RESUMEN DEL ÍTEM "REMATE" (26-09-2026, a pedido del usuario, ver la
// nota grande de GET /cierre-final en routes/hipismo.js y de
// calcularRemate en services/hipismoRemateCalc.js: "esos 2000 negativos
// deben salir en un ítem en balance como si fuera OTRO CLIENTE llamado
// REMATE, igual detallado en que carrera fue y en que hipódromo"). No es
// un cliente real — NUNCA tiene fila en "jugadores", así que GET
// /clientes/:nombre/detalle-semana lo especial-casa (ver ese archivo)
// en vez de buscarlo ahí, y llama a esta función en su lugar. SOLO se
// usa desde la parte administrativa (Detallado por Cliente en
// hipismo-mockup.html) — nunca hay un link público para esto, así que
// el resultado/ganancia-o-pérdida de cada remate nunca llega al cliente.
async function construirResumenRemateHipismo(grupoId, grupo, semanaParam, rangoPersonalizado) {
  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const rRemates = await db.query(
    `SELECT hipodromo_nombre, carrera_numero, fecha, pizarra, pool_total, pago_ganador,
            comision_total, comision_porcentaje, garantia, pago_fijo, hubo_ganador
       FROM hipismo_remates WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3
       ORDER BY fecha DESC, creado_en ASC`,
    [grupoId, desde, hasta]
  );

  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;
  let cantidadJugadas = 0;

  rRemates.rows.forEach(r => {
    // comision_total (nombre de columna sin cambios, ver la nota grande
    // en sql/schema.sql) ya ES el resultado de este remate — un remate
    // con resultado 0 (rarísimo, pero posible) no aporta ninguna línea
    // visible.
    const resultado = round2(Number(r.comision_total));
    if (!resultado) return;
    const fechaIso = r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : r.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    const hipNombre = r.hipodromo_nombre;
    if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, carreras: [] });

    hipMap.get(hipNombre).carreras.push({
      tipo: 'remate_resultado',
      carrera: r.carrera_numero,
      pizarra: r.pizarra,
      // "paga" = REMATE PAGA (monto fijo, sin %); "garantiza" = REMATE
      // GARANTIZA (piso + %); "porcentaje" = ni una ni otra, solo el %
      // de siempre — ver la nota grande de calcularRemate.
      modo: r.pago_fijo != null ? 'paga' : (r.garantia != null ? 'garantiza' : 'porcentaje'),
      poolTotal: Number(r.pool_total),
      pagoGanador: Number(r.pago_ganador),
      huboGanador: r.hubo_ganador,
      resultado
    });

    totalSemana += resultado;
    cantidadJugadas += 1;
    if (fechaIso === hoyIso) totalHoy += resultado;
  });

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    grupo: { nombre: grupo.nombre, logoUrl: grupo.logo_url },
    jugador: { nombre: 'REMATE' },
    semana,
    rango: { desde, hasta },
    rangoPersonalizado: !!rangoPersonalizado,
    hoy: hoyIso,
    esSemanaActual: !rangoPersonalizado && hoyIso >= desde && hoyIso <= hasta,
    modulos: { hipismo: true, deportes: false },
    resumen: {
      totalSemana: round2(totalSemana),
      totalHoy: round2(totalHoy),
      cantidadJugadas,
      totalHipismo: round2(totalSemana),
      totalDeportes: 0,
      cantidadJugadasHipismo: cantidadJugadas,
      cantidadJugadasDeportes: 0
    },
    dias
  };
}

// =================================================================
// RESUMEN DEL ÍTEM "WINNERS" (28-09-2026, a pedido del usuario: "al
// meterme en detallado por cliente [WINNERS] ... no se encontró ese
// cliente") — mismo caso EXACTO que construirResumenRemateHipismo de
// arriba: "WINNERS" es un ítem sintético del balance (ver la nota
// grande del ítem "WINNERS" en GET /cierre-final, routes/hipismo.js),
// NUNCA una fila real de "jugadores", así que GET
// /clientes/:nombre/detalle-semana lo especial-casa en vez de buscarlo
// ahí. Antes de esta función, hacer click en el cuadro "WINNERS" de
// "Detallado por Cliente" siempre daba 404 ("No se encontró ese
// cliente"), aunque su saldo SÍ apareciera bien en Balance General/
// Cierre Final (que arman ese saldo aparte, sin pasar por esta ruta).
//
// El detalle, fila por fila, es el ESPEJO exacto de cada registro de
// "Cargar Winners": si el cliente ganó +400 con un caballo, "WINNERS"
// "perdió" esos mismos 400 — nunca el monto tal cual del cliente (mismo
// invariante de "todo negativo tiene su contraparte" que ya aplica
// acumular('WINNERS', -monto) en /cierre-final).
async function construirResumenWinnersHipismo(grupoId, grupo, semanaParam, rangoPersonalizado) {
  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoPersonalizado || rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const rWinners = await db.query(
    `SELECT hipodromo_nombre, carrera_numero, fecha, cliente_nombre, caballo, monto
       FROM hipismo_winners WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3
       ORDER BY fecha DESC, creado_en ASC`,
    [grupoId, desde, hasta]
  );

  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;
  let cantidadJugadas = 0;

  rWinners.rows.forEach(w => {
    const resultado = round2(-Number(w.monto));
    if (!resultado) return;
    const fechaIso = w.fecha instanceof Date ? w.fecha.toISOString().slice(0, 10) : w.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    const hipNombre = w.hipodromo_nombre;
    if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, carreras: [] });

    hipMap.get(hipNombre).carreras.push({
      tipo: 'winner_contraparte',
      carrera: w.carrera_numero,
      caballo: w.caballo,
      clienteNombre: w.cliente_nombre,
      monto: Math.abs(Number(w.monto)),
      resultado
    });

    totalSemana += resultado;
    cantidadJugadas += 1;
    if (fechaIso === hoyIso) totalHoy += resultado;
  });

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    grupo: { nombre: grupo.nombre, logoUrl: grupo.logo_url },
    jugador: { nombre: 'WINNERS' },
    semana,
    rango: { desde, hasta },
    rangoPersonalizado: !!rangoPersonalizado,
    hoy: hoyIso,
    esSemanaActual: !rangoPersonalizado && hoyIso >= desde && hoyIso <= hasta,
    modulos: { hipismo: true, deportes: false },
    resumen: {
      totalSemana: round2(totalSemana),
      totalHoy: round2(totalHoy),
      cantidadJugadas,
      totalHipismo: round2(totalSemana),
      totalDeportes: 0,
      cantidadJugadasHipismo: cantidadJugadas,
      cantidadJugadasDeportes: 0
    },
    dias
  };
}

module.exports = { construirResumenClienteHipismo, construirResumenRemateHipismo, construirResumenWinnersHipismo };
