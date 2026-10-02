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
const { round2, montoDecidido } = require('./hipismoAdelantadasCalc');
const { urlLogoGrupo, temaColorGrupo } = require('./logoGrupo');
// obtenerComisionesPropias (26-09-2026, ver la nota grande de
// construirResumenCuentaComisionHipismo más abajo) — MISMA función que ya
// usa routes/hipismo.js para Balance General/Cierre Final/Saldo
// Comisiones, ahora en su propio archivo (services/hipismoComisionPropia.js)
// precisamente para poder reusarla acá sin duplicarla.
const { obtenerComisionesPropias, obtenerAjustesComision } = require('./hipismoComisionPropia');
// calcularAjustesCruce (30-09-2026, ver la nota grande de
// construirCierreFinalHipismo más abajo) — misma función que ya usaba
// GET /cierre-final en routes/hipismo.js.
const { calcularAjustesCruce } = require('./hipismoCalc');

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
// Mismo nombre de ítem que ya usaba GET /cierre-final en routes/hipismo.js
// (NOMBRE_ITEM_REMATE) — ver la nota grande de construirCierreFinalHipismo
// más abajo.
const NOMBRE_ITEM_REMATE = 'REMATE';

function resultadoTicketDeportes(t) {
  if (t.estado === 'GANADA') return t.gana;
  if (t.estado === 'PERDIDA') return -t.arriesga;
  return 0;
}

// montoBaseParaPct(linea) (02-10-2026, a pedido del usuario: "LOS % QUE SE
// DEVUELVEN ES DE LO DECIDIDO NO DE LO APOSTADO... SIEMPRE ES BASE A LO
// DECIDIDO SIN SACARLE EL 5%... LO QUE SE DECIDA EN LA JUGADA NETA") —
// toma una línea de obtenerLineasHipismoCliente() (services/
// hipismoLineasCliente.js) y devuelve la base correcta sobre la que debe
// calcularse el % propio/de aval de un cliente (o de su banquero), para
// CUALQUIER tipo de línea: nunca `linea.monto` (lo apostado bruto), salvo
// que coincida con lo decidido (como en una pérdida completa).
//   - Tercios (linea.tipo ausente, ver obtenerLineasHipismoCliente): usa
//     montoDecidido() sobre linea.resultado (resultado_jugador o
//     resultado_banquero, según linea.rol) + linea.sinComision -- la
//     inversa exacta de montoMostrado() en hipismoCalc.js.
//   - Adelantada, rol jugador: linea.resultado YA es resultado_cliente, un
//     neto definitivo sin ningún 5% embebido (ver resolverTablaFija/
//     resolverClienteMarca en hipismoAdelantadasCalc.js) -- montoDecidido
//     con sinComision=true simplemente lo deja en valor absoluto.
//   - Adelantada, rol banquero: cada banquero cubre `porcentajeBanqueado`%
//     de la base DECIDIDA de la jugada completa (linea.resultadoClienteJugada
//     -- mismo "base" que ya usa resolverBanqueoMarca para repartir entre
//     banqueadores), nunca de linea.monto (el apostado bruto de la Marca
//     completa) ni de linea.resultado (que además puede traer una comisión
//     VARIABLE y opcional del propio banquero, un mecanismo totalmente
//     aparte del 5% de Tercios -- ver resolverBanqueoMarca).
function montoBaseParaPct(linea) {
  if (linea.tipo === 'adelantada' && linea.rol === 'banquero') {
    const baseJugada = montoDecidido(linea.resultadoClienteJugada, true);
    return round2(baseJugada * (Number(linea.porcentajeBanqueado) || 0) / 100);
  }
  if (linea.tipo === 'adelantada') {
    return montoDecidido(linea.resultado, true);
  }
  return montoDecidido(linea.resultado, linea.sinComision);
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
  //
  // 02-10-2026: cond2 ya NO pasa por av.cuenta_comision_id (esa
  // indirección doble quedó eliminada, ver la nota grande de
  // obtenerComisionesPropias en hipismoComisionPropia.js) — ahora
  // jap.avalador_id YA ES directamente la ficha elegida por el operador,
  // así que basta comparar avalador_id contra esta cuenta puntual.
  const rFuentes = await db.query(
    `SELECT j.nombre
       FROM jugadores j
      WHERE j.grupo_id = $1
        AND NOT COALESCE(j.es_cuenta_comision, false)
        AND (
          (j.cuenta_comision_id = $2 AND j.comision_propia > 0 AND NOT COALESCE(j.incluir_porcentaje_en_jugadas, false))
          OR EXISTS (
            SELECT 1 FROM jugadores_avales_porcentaje jap
             WHERE jap.jugador_id = j.id AND jap.porcentaje > 0 AND jap.avalador_id = $2
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
        // NUNCA una jugada que "no se decidió" (29-09-2026, a pedido
        // explícito del usuario: "toda jugada que no se decida no genera
        // % ni comisión"). linea.resultado queda en 0 exactamente cuando
        // la jugada no se decidió -- un Tercios "pp"/"a premio" donde
        // ningún caballo figuró (ver resolverCruzado() en
        // hipismoCalc.js), una familia "Nn" empatada en la posición N, o
        // una Marca de Jugadas Adelantadas resuelta nula (ver
        // resolverClienteMarca en hipismoAdelantadasCalc.js) -- nunca de
        // una jugada genuinamente decidida (que siempre gana o pierde
        // una fracción distinta de cero de un monto real).
        if (Number(linea.resultado) === 0) return;
        // TAMBIÉN EL LADO BANQUERO, EN CUALQUIER PRESENTACIÓN (29-09-2026,
        // caso real "Mrincreible" banqueando en Tercios, y luego a pedido
        // explícito del usuario: "las marcas en todas sus presentaciones
        // sean adelantadas o en jugadas contra tercios del plano... deben
        // cumplir todas la misma regla"). Antes esto se excluía a
        // propósito ("solo el rol JUGADOR genera %") — ahora banquear
        // también genera % propio/de aval, sea Tercios o una Marca de
        // Jugadas Adelantadas.
        //
        // montoParaPct (02-10-2026, "LOS % QUE SE DEVUELVEN ES DE LO
        // DECIDIDO NO DE LO APOSTADO" — ver la nota grande de
        // montoBaseParaPct arriba del todo del archivo): NUNCA
        // linea.monto (lo apostado bruto) salvo que coincida con lo
        // decidido — para una Marca banqueada, además, hay que escalar a
        // la PARTE real de ESTE banquero (`porcentajeBanqueado`).
        const montoParaPct = montoBaseParaPct(linea);

        entradas.forEach(info => {
          const devuelto = round2(Math.abs(Number(montoParaPct) || 0) * (info.pct / 100));
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
            // El monto mostrado en esta línea de comisión es la BASE real
            // sobre la que se calculó el %, no el monto completo de la
            // jugada — para que el detalle ("X% de $monto = $resultado")
            // cuadre también cuando montoParaPct viene escalado (banqueo
            // de una Marca).
            monto: Math.abs(Number(montoParaPct) || 0),
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
    grupo: { nombre: grupo.nombre, logoUrl: urlLogoGrupo(jugador.grupo_id, grupo), ...temaColorGrupo(grupo) },
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
    // TAMBIÉN EL LADO BANQUERO, EN CUALQUIER PRESENTACIÓN (29-09-2026,
    // mismo caso "Mrincreible" — ver la nota grande en
    // construirResumenCuentaComisionHipismo más arriba): antes esto solo
    // contaba `linea.rol === 'jugador'`, a propósito ("nunca lo que
    // banqueó"); el usuario confirmó primero que el % también se gana
    // banqueando en Tercios, y luego, a pedido explícito ("las marcas en
    // todas sus presentaciones... deben cumplir todas la misma regla"),
    // que el banqueo de una Marca (Jugadas Adelantadas) también cuenta.
    //
    // montoParaPct (02-10-2026, "LOS % QUE SE DEVUELVEN ES DE LO DECIDIDO
    // NO DE LO APOSTADO" — igual que en construirResumenCuentaComisionHipismo,
    // ver la nota grande de montoBaseParaPct arriba del todo del archivo):
    // NUNCA linea.monto salvo que coincida con lo decidido.
    // NUNCA una jugada que "no se decidió" (29-09-2026, a pedido
    // explícito del usuario: "toda jugada que no se decida no genera %
    // ni comisión") — mismo chequeo que construirResumenCuentaComisionHipismo
    // más arriba, ver esa nota grande para el detalle de qué casos caen
    // acá (linea.resultado en 0).
    let comisionIncluida = 0;
    if (pctPropioIncluido && linea.rol && Number(linea.resultado) !== 0) {
      const montoParaPct = montoBaseParaPct(linea);
      comisionIncluida = round2(Math.abs(Number(montoParaPct) || 0) * (pctPropioIncluido / 100));
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
    grupo: { nombre: grupo.nombre, logoUrl: urlLogoGrupo(jugador.grupo_id, grupo), ...temaColorGrupo(grupo) },
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
    grupo: { nombre: grupo.nombre, logoUrl: urlLogoGrupo(grupoId, grupo), ...temaColorGrupo(grupo) },
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
    grupo: { nombre: grupo.nombre, logoUrl: urlLogoGrupo(grupoId, grupo), ...temaColorGrupo(grupo) },
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

// =================================================================
// CIERRE FINAL / BALANCE GENERAL DE HIPISMO (30-09-2026, a pedido del
// usuario: "desde super admin muestrame en la pestaña balance por
// clientes, el balance general del grupo que corresponda modulo
// hipismo") — esta función es EXACTAMENTE la misma lógica que ya traía
// GET /cierre-final en routes/hipismo.js (el motor real detrás de la
// pantalla "📒 Balance General" de hipismo-mockup.html), sacada a este
// archivo compartido para poder reusarla desde 2 lugares SIN duplicar
// ninguna de sus reglas — varias de ellas fruto de bugs reales ya
// corregidos (LUSHO-100 con el cruce de jugadas, Halland con Tablas
// Fijas, el bug de comparación string/number de Sebastian, etc., ver los
// comentarios de cada bloque más abajo):
//   1) el propio GET /cierre-final (routes/hipismo.js), con
//      grupoId=req.grupoId (la resolución de semana/rango sigue viviendo
//      en la ruta, que es lo único realmente específico de esa pantalla), y
//   2) la nueva ruta de Super-admin GET
//      /api/superadmin/grupos/:id/hipismo-cierre-final, con
//      grupoId=el :id de la URL — mismo criterio ya usado para el
//      Balance por Cliente de Deportes (calcularBalanceGeneral).
//
// A diferencia de construirResumenClienteHipismo/RemateHipismo/
// WinnersHipismo de arriba (que arman el DETALLE día-por-día de UN
// cliente), esta función arma el RESUMEN de TODOS los clientes del grupo
// para un rango — por eso recibe desde/hasta ya resueltos (no
// semanaParam/rangoPersonalizado) y no arma "dias"/"hipodromos", solo la
// lista `clientes` con su saldo ya neto, tal cual el shape que devolvía
// GET /cierre-final.
async function construirCierreFinalHipismo(grupoId, desde, hasta) {
  const rTickets = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.resultado_jugador, t.resultado_banquero, t.monto,
            t.plano_id, t.sin_comision, p.cruza_jugadas
       FROM hipismo_tickets t
       JOIN hipismo_planos p ON p.id = t.plano_id
      WHERE t.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );
  const rApuestasRemate = await db.query(
    `SELECT a.cliente_nombre, a.resultado, a.monto
       FROM hipismo_remate_apuestas a
       JOIN hipismo_remates r ON r.id = a.remate_id
      WHERE a.grupo_id = $1 AND r.fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );
  // Jugadas Adelantadas (23-09-2026, ver la nota grande en
  // services/hipismoAdelantadasCalc.js): el lado del CLIENTE que jugó
  // (tf o marca) ya es definitivo apenas sale de 'pendiente' —
  // 'resuelto', 'falta_banqueo' y 'sin_decidir' entran todos acá (en
  // 'sin_decidir' resultado_cliente ya quedó en 0). El lado de los
  // BANQUEADORES de una Marca solo existe una vez 'resuelto' (adentro
  // del jsonb banqueadores) — cada banquero es, para efectos de saldo,
  // un cliente más (ej. "MARCAS ZENYATTA").
  const rAdelantadas = await db.query(
    `SELECT j.cliente_nombre, j.tipo, j.resultado_cliente, j.comision, j.banqueadores, j.monto, j.gano
       FROM hipismo_adelantadas_jugadas j
       JOIN hipismo_adelantadas_planos p ON p.id = j.plano_id
      WHERE j.grupo_id = $1 AND p.fecha BETWEEN $2 AND $3 AND j.estado IN ('resuelto','falta_banqueo','sin_decidir')`,
    [grupoId, desde, hasta]
  );
  // "Cargar Winners" (26-09-2026, ver la nota grande junto a POST /winners):
  // cada fila ya es el resultado NETO de ese cliente, así que se suma
  // exactamente igual que un ticket ya resuelto — sin comisión ni "monto
  // apostado" aparte (Winners no tiene ninguno de los 2).
  //
  // ÍTEM "WINNERS" (28-09-2026, a pedido del usuario: "ya le sale
  // reflejada al cliente su jugada y su positivo y negativo eso esta
  // excelente, pero eso debe ir contra el codigo llamado winners....
  // si lusho tiene +400 en winners, winners debe decir -400... todo
  // negativo debe tener su contra parte reflejado en la contabilidad")
  // — mismo principio ya aplicado a TABLAS FIJAS/PORCENTAJE MARCAS/
  // REMATE: cada monto que gana o pierde un cliente en Winners tiene
  // que tener su contraparte exacta en otro renglón, o el balance no
  // cuadra (la suma de TODOS los saldos positivos y negativos deja de
  // dar 0). Acá "WINNERS" es literalmente el otro lado de la apuesta —
  // si LUSHO ganó +400, alguien (el ítem "WINNERS") tiene que perder
  // esos mismos 400. Ver el forEach más abajo, que acumula el espejo
  // exacto (-monto) de cada fila junto con el lado del cliente.
  const rWinners = await db.query(
    `SELECT cliente_nombre, monto FROM hipismo_winners WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );

  const porCliente = new Map();
  function acumular(nombre, resultado) {
    if (!porCliente.has(nombre)) porCliente.set(nombre, { nombre, jugadas: 0, gano: 0, perdio: 0 });
    const c = porCliente.get(nombre);
    c.jugadas += 1;
    const n = Number(resultado);
    if (n > 0) c.gano += n;
    else if (n < 0) c.perdio += -n;
  }
  rTickets.rows.forEach(t => {
    acumular(t.cliente_nombre, t.resultado_jugador);
    acumular(t.banquero_nombre, t.resultado_banquero);
  });
  rApuestasRemate.rows.forEach(a => acumular(a.cliente_nombre, a.resultado));
  rWinners.rows.forEach(w => {
    acumular(w.cliente_nombre, w.monto);
    acumular('WINNERS', -Number(w.monto));
  });

  let comisionAdelantadasSemana = 0;
  rAdelantadas.rows.forEach(j => {
    acumular(j.cliente_nombre, j.resultado_cliente);
    if (j.comision != null) comisionAdelantadasSemana += Number(j.comision);
    // "TABLAS FIJAS" / "% DE TABLAS FIJAS" (28-09-2026, a pedido del
    // usuario: "el item tabla fijas no me sale en los balances... todos
    // los item deben verse reflejado con su saldo en balances", y
    // corregido el mismo día tras ver Halland -36 convertirse en "Tablas
    // fijas +36" en vez de "+35,10 / % de tablas fijas +0,90") — el
    // espejo de Tablas Fijas tiene que salir NETO de su propia comisión
    // (mismo invariante que resolverTablaFija: cliente + tablasFijas +
    // comisión = 0 exacto). Restar solo resultado_cliente (bruto) y
    // ADEMÁS mostrar "% DE TABLAS FIJAS" aparte deja ese monto "de más"
    // en el balance, sin ningún renglón que lo compense — por eso
    // comisionAdelantadasSemana (abajo) YA NO se suma al total de
    // "Comisión" del pie (ver la nota de comisionRemateSemana más abajo,
    // mismo criterio: un ítem que ya se ve solo en el balance no se
    // vuelve a sumar aparte).
    if (j.tipo === 'tf') {
      const comisionTf = j.comision != null ? Number(j.comision) : 0;
      acumular('TABLAS FIJAS', -(Number(j.resultado_cliente) + comisionTf));
      if (comisionTf) acumular('% DE TABLAS FIJAS', comisionTf);
    }
    // "PORCENTAJE MARCAS" (28-09-2026, a pedido del usuario: "ese item
    // que también es como un cliente, me vas a ir sumando siempre ese
    // 2.5% que deja [el banquero] en marcas") — la comisión de cada
    // Marca ya banqueada (j.comision, armada por resolverBanqueoMarca)
    // se suma acá como un "cliente" más, igual que "{cliente} -
    // PORCENTAJE" para el % devuelto — mismo criterio de
    // "TABLAS FIJAS"/"% DE TABLAS FIJAS" pero del lado de Marcas.
    if (j.tipo === 'marca' && j.comision) acumular('PORCENTAJE MARCAS', Number(j.comision));
    if (Array.isArray(j.banqueadores)) {
      j.banqueadores.forEach(b => acumular(b.nombre, b.monto));
    }
  });

  // "% DEVUELTO" (23-09-2026, undécima ronda, a pedido del usuario: "un
  // item llama pedro - porcentaje... recuerda todo debe verse reflejado
  // en balances") — mismo cálculo que Balance General de "Cargar Planos"
  // (ver agregarPorcentajeDevuelto más arriba), pero agregado para TODA
  // la semana: cada cliente con % propio configurado
  // (jugadores.comision_propia) se gana ese % de TODO lo que apostó,
  // gane o pierda cada jugada puntual, sumado como su propio "cliente"
  // aparte ("{NOMBRE} - PORCENTAJE") en esta misma lista.
  //
  // TAMBIÉN EL LADO BANQUERO, EN CUALQUIER PRESENTACIÓN (29-09-2026, caso
  // real "Mrincreible": tiene 1% propio configurado y avales, pero en la
  // jugada real él era el BANQUERO — antes esto se excluía a propósito
  // ("nunca lo que banqueó"); el usuario confirmó primero que quería el %
  // también banqueando Tercios, y luego, a pedido explícito ("las marcas
  // en todas sus presentaciones... deben cumplir todas la misma regla"),
  // que el banqueo de una Marca (Jugadas Adelantadas, j.banqueadores
  // arriba) también cuenta.
  const nombresJugadores = new Set();
  rTickets.rows.forEach(t => nombresJugadores.add(t.cliente_nombre));
  rTickets.rows.forEach(t => nombresJugadores.add(t.banquero_nombre));
  rApuestasRemate.rows.forEach(a => nombresJugadores.add(a.cliente_nombre));
  rAdelantadas.rows.forEach(j => {
    nombresJugadores.add(j.cliente_nombre);
    if (Array.isArray(j.banqueadores)) j.banqueadores.forEach(b => nombresJugadores.add(b.nombre));
  });
  const comisionesPropias = await obtenerComisionesPropias(grupoId, Array.from(nombresJugadores));
  // "COMISIÓN REAL" (29-09-2026, a pedido del usuario: "de la comisión
  // que queda en el grupo debes restar todos los % que se le devuelven a
  // los clientes para ver la comisión real de cuánto queda en el
  // grupo") — se necesita el TOTAL devuelto (todos los "{destino} -
  // PORCENTAJE" juntos) para restárselo a comisionSemana más abajo. A
  // propósito NO se le resta nada de "% DE TABLAS FIJAS" ni
  // "PORCENTAJE MARCAS" (ver la nota grande de comisionAdelantadasSemana
  // más abajo: esos 2 ya tienen su contraparte EXACTA dentro de la misma
  // lista de "clientes" — TABLAS FIJAS, y cliente+banqueadores de una
  // Marca — así que ya suman $0 netos entre sí; sumarlos o restarlos acá
  // sería contarlos 2 veces). El usuario confirmó con un ejemplo numérico
  // que la fórmula correcta es exactamente: comisión de Tercios del rango
  // MENOS todo lo devuelto — matemáticamente idéntico a "voltear el signo
  // de la suma de TODOS los saldos de la lista" (por eso, para no
  // duplicar lógica, `comisionSemana` se termina de calcular más abajo
  // restando `totalDevueltoSemana` de la comisión de Tercios).
  let totalDevueltoSemana = 0;
  function acumularDevuelto(nombre, monto) {
    const infos = comisionesPropias[nombre];
    if (!infos || !infos.length) return;
    // 24-09-2026: hasta 2 entradas simultáneas por cliente (ver la nota
    // grande de obtenerComisionesPropias) — cada una con su propio
    // destino, así que cada una suma su propio ítem "{destino} -
    // PORCENTAJE" aparte (pueden ser 2 ítems distintos para el mismo
    // cliente en la misma semana).
    infos.forEach(info => {
      if (!info || !info.pct) return;
      const devuelto = round2(Math.abs(Number(monto) || 0) * (info.pct / 100));
      if (!devuelto) return;
      // Ver la nota grande de arriba (agregarPorcentajeDevuelto):
      // info.cuentaNombre ya es el nombre final, no hace falta pegarle
      // el sufijo de nuevo.
      acumular(info.cuentaNombre, devuelto);
      totalDevueltoSemana = round2(totalDevueltoSemana + devuelto);
    });
  }
  // 26-09-2026, a pedido del usuario ("LOS REMATES NO LE PRODUCEN % DE
  // DEVOLUCION A LOS CLIENTES"): Remate SÍ suma al saldo normal (arriba,
  // acumular()) pero NUNCA genera % devuelto — a propósito no se llama
  // acumularDevuelto() con rApuestasRemate acá.
  //
  // NUNCA una jugada que "no se decidió" (29-09-2026, a pedido explícito
  // del usuario: "toda jugada que no se decida no genera % ni
  // comisión"): un ticket de Tercios queda con resultado_jugador Y
  // resultado_banquero en 0 cuando una Marca "pp"/"a premio" no tuvo
  // ningún caballo que figurara (ver resolverCruzado() en
  // hipismoCalc.js) — se excluye de acumularDevuelto() por completo. Una
  // Marca de Jugadas Adelantadas queda con j.gano en null SOLO cuando
  // quedó 'sin_decidir' (nula, ver resolverClienteMarca en
  // hipismoAdelantadasCalc.js) — Tabla Fija siempre decide true/false, así
  // que filtrar por "j.gano !== null" descarta justo esas.
  //
  // 29-09-2026, BUG REAL encontrado (caso Sebastian: seguía cobrando % de
  // una Marca "pp" nula aun DESPUÉS de este mismo filtro, commit 0fac94f):
  // "pg" devuelve una columna `numeric` como STRING de JS ("0.00"), nunca
  // como number -- así que "t.resultado_jugador === 0" (comparación
  // ESTRICTA string contra number) siempre daba false, sin importar el
  // valor real, y el filtro nunca excluía nada en producción (el mock de
  // los tests sí usaba numbers de JS directos, por eso las pruebas pasaban
  // igual). Se envuelve en Number(...) para comparar de verdad.
  // 02-10-2026 ("LOS % QUE SE DEVUELVEN ES DE LO DECIDIDO NO DE LO
  // APOSTADO... SIEMPRE ES BASE A LO DECIDIDO SIN SACARLE EL 5%"): la base
  // del % propio/de aval es montoDecidido() (la inversa de montoMostrado()
  // en hipismoCalc.js) sobre el resultado YA DECIDIDO de esa línea, nunca
  // t.monto (lo apostado bruto) — en una jugada fraccionada ("10A4") el
  // que gana solo decide una fracción del monto, aunque el que pierde sí
  // suele perder el monto completo (ahí lo decidido y lo apostado
  // coinciden, por eso el bug viejo no se notaba en las pérdidas).
  rTickets.rows.filter(t => !(Number(t.resultado_jugador) === 0 && Number(t.resultado_banquero) === 0))
    .forEach(t => acumularDevuelto(t.cliente_nombre, montoDecidido(t.resultado_jugador, t.sin_comision)));
  // 29-09-2026 (ver la nota grande de nombresJugadores más arriba): el
  // lado BANQUERO de Tercios ahora también genera % devuelto.
  rTickets.rows.filter(t => !(Number(t.resultado_jugador) === 0 && Number(t.resultado_banquero) === 0))
    .forEach(t => acumularDevuelto(t.banquero_nombre, montoDecidido(t.resultado_banquero, t.sin_comision)));
  // resultado_cliente de Jugadas Adelantadas ya es un neto DEFINITIVO sin
  // ningún 5% embebido (ver resolverTablaFija/resolverClienteMarca en
  // hipismoAdelantadasCalc.js) -- montoDecidido con sinComision=true lo
  // deja tal cual, en valor absoluto.
  rAdelantadas.rows.filter(j => j.gano !== null).forEach(j => acumularDevuelto(j.cliente_nombre, montoDecidido(j.resultado_cliente, true)));
  // 29-09-2026 (misma nota): el lado BANQUERO de una Marca también genera
  // % devuelto — cada banqueador solo banqueó su `porcentaje` de la base
  // DECIDIDA de la jugada completa (|resultado_cliente|, el mismo "base"
  // que ya usa resolverBanqueoMarca para repartir entre banqueadores —
  // ver services/hipismoAdelantadasCalc.js), nunca de j.monto (el
  // apostado bruto de la Marca completa). (Una Marca nula nunca llega a
  // tener banqueadores -- solo se banquea una Marca ya decidida -- así que
  // este bloque no necesita el mismo filtro de j.gano, pero se deja fuera
  // del .filter() de arriba a propósito para no confundir al próximo
  // lector con un filtro que acá nunca hace nada.)
  rAdelantadas.rows.forEach(j => {
    if (!Array.isArray(j.banqueadores)) return;
    const baseJugada = montoDecidido(j.resultado_cliente, true);
    j.banqueadores.forEach(b => {
      const parte = baseJugada * (Number(b.porcentaje) || 0) / 100;
      acumularDevuelto(b.nombre, parte);
    });
  });

  const clientes = Array.from(porCliente.values())
    .map(c => ({ ...c, saldo: c.gano - c.perdio }));

  // AJUSTE POR CRUCE (26-09-2026, a pedido del usuario: "LOS PLANOS SI ME
  // ESTAN CRUZANDO LAS JUGADAS SI ME LAS ESTA CRUZANDO FIJATE LUSHO-100
  // PERO EN LOS BALANCES NO ME LA ESTA CRUZANDO... CORRIGE" — el bug: en
  // un plano con cruza_jugadas=true, calcularPlano() guarda cada ticket
  // con su valor YA "mostrado" línea por línea (sin cruzar) — el cruce
  // real (neto por cliente, comisión una sola vez sobre el neto) solo
  // vive en el total efímero que "Cargar Planos" muestra una vez y
  // nunca se persiste. Acá se reconstruye ese neto cruzado por plano
  // (calcularAjustesCruce, en services/hipismoCalc.js) y se suma la
  // diferencia contra la suma "sin cruzar" de las líneas de ese cliente
  // en ese plano — así el saldo de Cierre Final (y, por el mismo
  // mecanismo en obtenerLineasHipismoCliente, Balance General y el link
  // del cliente) coincide con lo que el plano cruzado realmente cobra.
  const ticketsPorPlanoCruzado = new Map();
  rTickets.rows.forEach(t => {
    if (!t.cruza_jugadas) return;
    if (!ticketsPorPlanoCruzado.has(t.plano_id)) ticketsPorPlanoCruzado.set(t.plano_id, []);
    ticketsPorPlanoCruzado.get(t.plano_id).push({
      clienteNombre: t.cliente_nombre,
      banqueroNombre: t.banquero_nombre,
      resultadoJugador: Number(t.resultado_jugador),
      resultadoBanquero: Number(t.resultado_banquero),
      sinComision: t.sin_comision
    });
  });
  ticketsPorPlanoCruzado.forEach(ticketsDelPlano => {
    const ajustesCruce = calcularAjustesCruce(ticketsDelPlano);
    Object.keys(ajustesCruce).forEach(nombre => {
      const monto = ajustesCruce[nombre];
      if (!monto) return;
      let c = clientes.find(x => x.nombre === nombre);
      if (!c) { c = { nombre, jugadas: 0, gano: 0, perdio: 0, saldo: 0 }; clientes.push(c); }
      c.saldo = round2(c.saldo + monto);
    });
  });

  // TRASPASO DE COMISIÓN (26-09-2026, ver POST /comisiones/traspaso en
  // routes/hipismo.js) — se suma/resta encima del saldo ya calculado; si
  // el cliente del ajuste no tenía ninguna jugada esta semana (ej. recién
  // recibió un traspaso sin haber jugado nada), se agrega como una fila
  // nueva.
  const ajustesComision = await obtenerAjustesComision(grupoId, desde, hasta);
  Object.keys(ajustesComision).forEach(nombre => {
    const monto = ajustesComision[nombre];
    if (!monto) return;
    let c = clientes.find(x => x.nombre === nombre);
    if (!c) { c = { nombre, jugadas: 0, gano: 0, perdio: 0, saldo: 0 }; clientes.push(c); }
    c.saldo = round2(c.saldo + monto);
  });

  // ÍTEM "REMATE" (26-09-2026, a pedido del usuario: "esos 2000 negativos
  // deben salir en un ítem en balance como si fuera OTRO CLIENTE llamado
  // REMATE, igual detallado en que carrera fue y en que hipódromo... creo
  // que actualmente no lo estás colocando en su ítem llamado remate, sino
  // que lo estás sumando en la comisión... soluciona eso"). Cada remate
  // guarda en comision_total el resultado (ganancia o pérdida) de ESE
  // remate puntual — sea "REMATE PAGA" (monto fijo) o "REMATE GARANTIZA"
  // (piso + %, incluyendo el 20% de ganancia de la casa cuando aplica) —
  // ver la nota grande de calcularRemate en services/hipismoRemateCalc.js.
  // Acá se suma TODO eso como un ítem más de "clientes", nunca mezclado
  // con comisionSemana/comisionAdelantadasSemana.
  const rComisionRemate = await db.query(
    `SELECT COALESCE(SUM(comision_total), 0) AS total
       FROM hipismo_remates WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );
  const resultadoRemateSemana = round2(Number(rComisionRemate.rows[0].total));
  if (resultadoRemateSemana) {
    let cRemate = clientes.find(x => x.nombre === NOMBRE_ITEM_REMATE);
    if (!cRemate) { cRemate = { nombre: NOMBRE_ITEM_REMATE, jugadas: 0, gano: 0, perdio: 0, saldo: 0 }; clientes.push(cRemate); }
    cRemate.saldo = round2(cRemate.saldo + resultadoRemateSemana);
  }

  clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Comisión de Tercios de la semana: mismo total ya guardado por plano
  // (ver /comisiones-por-carrera en routes/hipismo.js) — no depende de
  // los tickets sueltos.
  const rComision = await db.query(
    `SELECT COALESCE(SUM(comision_total), 0) AS total
       FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3`,
    [grupoId, desde, hasta]
  );
  // "COMISIÓN REAL" (29-09-2026, ver la nota grande de totalDevueltoSemana
  // más arriba, a pedido explícito del usuario: "de la comisión que queda
  // en el grupo debes restar todos los % que se le devuelven a los
  // clientes para ver la comisión real de cuánto queda en el grupo" —
  // confirmado con un ejemplo numérico exacto, "CASO A PARA TODOS LOS
  // RENGLONES"). comisionSemana pasa de ser la comisión BRUTA de Tercios
  // a ser la comisión REAL: bruta menos todo lo devuelto — matemáticamente
  // idéntico a voltear el signo de la suma de TODOS los saldos de
  // "clientes" (ya que TABLAS FIJAS/% DE TABLAS FIJAS, PORCENTAJE
  // MARCAS+banqueadores+cliente, REMATE+sus apuestas y WINNERS+sus
  // clientes siempre suman $0 exacto entre sí — ver esos bloques más
  // arriba — así que la única plata que "sobra" sin repartir en toda la
  // lista es justo comisión de Tercios menos lo devuelto).
  const comisionSemana = round2(Number(rComision.rows[0].total) - totalDevueltoSemana);

  return {
    clientes,
    comisionSemana,
    // comisionRemateSemana (26-09-2026): se sigue devolviendo el dato
    // crudo por compatibilidad, pero YA NO representa "comisión" — el
    // frontend ya no lo suma al total de comisión mostrado (ver el ítem
    // "REMATE" arriba, dentro de "clientes", que es donde se muestra de
    // verdad ahora).
    comisionRemateSemana: Number(rComisionRemate.rows[0].total),
    // comisionAdelantadasSemana (23-09-2026, ya no sumado al total de
    // "Comisión" del pie desde el 28-09-2026): mismo criterio que
    // comisionRemateSemana arriba — desde que "% DE TABLAS FIJAS" y
    // "PORCENTAJE MARCAS" son ítems propios dentro de "clientes" (ver la
    // nota grande más arriba), este número ya está 100% representado ahí
    // adentro (con su contraparte exacta, no como un residuo suelto) —
    // volver a sumarlo acá sería pagar la misma comisión dos veces. Se
    // sigue devolviendo el dato crudo por compatibilidad.
    comisionAdelantadasSemana
  };
}

module.exports = {
  construirResumenClienteHipismo, construirResumenRemateHipismo, construirResumenWinnersHipismo,
  construirCierreFinalHipismo
};
