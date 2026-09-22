// =================================================================
// ORQUESTADOR: procesar una sábana completa para un grupo
// =================================================================
// Equivalente en el backend de procesarYVerificar() (app.js sección 6),
// pero sin DOM: recibe el texto crudo + la fecha, evalúa todo contra la
// API de MLB, guarda el historial en la base de datos, y devuelve un
// objeto JSON con exactamente los mismos números que mostraba la app
// original (resumen por cliente, totales del día, totales de la casa).
const db = require('../db');
const { cargarConfigGrupo } = require('./grupoConfig');
const { obtenerResultadosAPIs } = require('./mlbApi');
const { obtenerResultadosNFL } = require('./nflApi');
const { obtenerResultadosNHL } = require('./nhlApi');
const { obtenerResultadosNBA } = require('./nbaApi');
const { obtenerResultadosSoccer } = require('./soccerApi');
const { obtenerResultadosNCAAF } = require('./ncaafApi');
const { parsearSabana, calcularPagoParley, detectarMarcadorDeporteEnTexto } = require('./parser');
const { evaluarJugada } = require('./evaluador');
const { normalizarTexto } = require('./normalizar');
const { detectarEquipoSinLogro, extraerCuotaAmericana } = require('./parser');
const { esEstadoComisionable, calcularComisionTotalCliente, acumularComisionPorTipoJugada } = require('./comisiones');
const { guardarEnHistorial } = require('./historial');
const { cargarResolucionesManuales, crearAlerta } = require('./alertas');
const { leerPolla } = require('./polla');

// Da de alta en la tabla "jugadores" a cualquier cliente detectado en la
// sábana que todavía no esté registrado en este grupo — igual que
// autoRegistrarJugadoresDesdeSabana en la app original. "GENERAL" (cajón
// de sastre del parser cuando no detecta ningún nombre) se excluye.
async function autoRegistrarJugadores(grupoId, nombresClientes, jugadoresPorNombreExistentes) {
  const nuevos = nombresClientes.filter(n => n && n !== 'GENERAL' && !jugadoresPorNombreExistentes[n]);
  for (const nombre of nuevos) {
    await db.query(
      `INSERT INTO jugadores (grupo_id, nombre, activo, auto_creado, tipo_cuenta, pozo_inicial)
       VALUES ($1, $2, true, true, 'libre', 0)
       ON CONFLICT (grupo_id, nombre) DO NOTHING`,
      [grupoId, nombre]
    );
  }
  return nuevos.length > 0;
}

async function procesarSabana(grupoId, textoCrudo, fecha) {
  if (!textoCrudo || !textoCrudo.trim()) {
    const err = new Error('Pega la sábana de apuestas antes de continuar.');
    err.status = 400;
    throw err;
  }
  if (!fecha) {
    const err = new Error('Falta la fecha de los partidos (YYYY-MM-DD).');
    err.status = 400;
    throw err;
  }

  let { jugadoresPorNombre, porcentajesPropios, avalesMap, diccionarioEquipos, modeloComision, tiersComision, modelosComisionPorCliente } = await cargarConfigGrupo(grupoId);
  // Se arma una sola vez acá y se pasa siempre así a calcularComisionTotalCliente
  // (08-09-2026) — ver la nota grande en comisiones.js sobre por qué es
  // un 5to parámetro opcional y no cambia nada para los grupos 'plano'.
  // modelosPorCliente (09-09-2026, "grupo mixto") permite excepciones
  // puntuales por jugador — ver la nota grande en comisiones.js.
  const configComision = { modelo: modeloComision, tiers: tiersComision, modelosPorCliente: modelosComisionPorCliente };

  // Se piden TODAS las APIs de deportes conectadas EN PARALELO (una
  // sábana puede traer tickets de varios deportes mezclados) — cada
  // jugada se resuelve luego contra la que le corresponda según el
  // `deporte` de su equipo en el diccionario (ver evaluarJugada()).
  const [datosMLB, datosNFL, datosNHL, datosSoccer, datosNBA, datosNCAAF] = await Promise.all([
    obtenerResultadosAPIs(fecha),
    obtenerResultadosNFL(fecha),
    obtenerResultadosNHL(fecha),
    obtenerResultadosSoccer(fecha),
    obtenerResultadosNBA(fecha),
    obtenerResultadosNCAAF(fecha)
  ]);
  const datosPorDeporte = { mlb: datosMLB, nfl: datosNFL, nhl: datosNHL, soccer: datosSoccer, basket: datosNBA, ncaaf: datosNCAAF };
  const boletos = parsearSabana(textoCrudo, diccionarioEquipos);

  if (boletos.length === 0) {
    const err = new Error("No se detectaron apuestas válidas. Asegúrate de incluir las líneas con el formato 'monto//premio' (ej: 180//150).");
    err.status = 422;
    throw err;
  }

  // Resoluciones manuales ya guardadas para este grupo+fecha (jugadas que
  // habían quedado AMBIGUA y alguien las resolvió a mano desde la pestaña
  // Alertas) — se cargan UNA vez acá y evaluarJugada() las usa como la
  // capa más fuerte de desambiguación (ver evaluador.js/alertas.js).
  const resolucionesManuales = await cargarResolucionesManuales(grupoId, fecha);
  const alertasParaCrear = []; // se juntan durante el forEach (síncrono) y se insertan todas juntas al final

  let totalArriesgadoSum = 0;
  let totalPerdidoSum = 0;
  let totalPremiosSum = 0;
  const resumenClientes = {};
  const registrosHistorial = [];
  const ticketsDetalle = []; // equivalente de las filas de #tablaResultados, con su debug

  boletos.forEach(b => {
    totalArriesgadoSum += b.arriesga;

    let ticketPerdido = false;
    let ticketAnulado = false;
    let ticketPendiente = false;
    let ticketSuspendida = false;
    let ticketFaltaLogro = false;
    let ticketAmbiguo = false;
    let equipoFaltaLogro = null;
    // 06-09-2026 (a pedido del usuario: "hay equipos que no tenemos
    // mapeados porque esa liga aun no tenemos la api que lo analice
    // entonces mientras yo lo coloco manualmente si se dio o no... quiero
    // que ... lo dejes asi mientras aun no tenemos esa api trabajando") —
    // hace falta distinguir 2 motivos MUY distintos de "pendiente":
    //   - ticketTieneSinMapeo: alguna pata es de un equipo/liga que ni
    //     siquiera está en el diccionario todavía (SIN_MAPEO) — nunca se
    //     va a poder verificar solo, no hay ninguna API corriendo detrás.
    //   - ticketTienePendienteReal: alguna pata SÍ está mapeada a una
    //     liga con API conectada, pero esa API todavía no tiene el
    //     resultado (juego en curso/no encontrado) o está SUSPENDIDA — acá
    //     sí puede resolverse solo, más tarde, cuando la API tenga el dato.
    // Ver más abajo (cerca de "PENDIENTE") dónde se usa esta distinción.
    let ticketTieneSinMapeo = false;
    let ticketTienePendienteReal = false;
    let resueltoPorMarcadorManualSinMapeo = false;
    const patasSinMapeoTextos = [];
    let patasAnuladas = 0; // cuántas patas del parley resultaron push (ANULADA) — ver más abajo
    const debugPatas = [];
    const jugadasNormalizadas = [];
    const estadosPatas = []; // paralelo a jugadasNormalizadas, para calcularPagoParley (patas push se sacan del cálculo)

    b.jugadas.forEach(j => {
      const jNorm = normalizarTexto(j);
      jugadasNormalizadas.push(jNorm);

      const equipoSinLogro = detectarEquipoSinLogro(jNorm, diccionarioEquipos);
      if (equipoSinLogro) {
        ticketFaltaLogro = true;
        if (!equipoFaltaLogro) equipoFaltaLogro = equipoSinLogro;
      }

      // El marcador por-jugada (emoji/palabra clave, ej. "🏈" o "nba") se
      // busca en el texto ORIGINAL "j", no en "jNorm" — normalizarTexto()
      // le borra los emojis a propósito (ver normalizar.js), así que para
      // cuando llegara jNorm ya no estarían. Las palabras clave funcionan
      // igual en cualquiera de los dos, así que no hace falta buscarlas
      // dos veces.
      const deporteMarcador = detectarMarcadorDeporteEnTexto(j);
      const deporteResuelto = resolucionesManuales[jNorm] || null;

      const res = evaluarJugada(jNorm, datosPorDeporte, diccionarioEquipos, {
        deporteForzado: b.deporteForzado,
        deporteMarcador,
        deporteResuelto
      });

      // =============================================================
      // "SIN LOGRO" (28-08-2026, a pedido del usuario): una jugada puede
      // llegar sin el número que hace falta para verificarla o calcular
      // su pago — ni la línea de una alta/baja (over/under), ni la cuota
      // de un moneyline/hándicap (run line). Esto pasa con CUALQUIER tipo
      // de jugada, así que se chequea acá, una sola vez, después de que
      // evaluarJugada() ya resolvió A QUÉ EQUIPO/DEPORTE se refiere (para
      // no confundir "falta el logro" con "no encontré el equipo" o "es
      // ambiguo entre 2 deportes", que son problemas distintos y ya tienen
      // su propio manejo). Dos formas de detectarlo:
      //   - evaluarJugada() ya devolvió SIN_LOGRO (no había NINGÚN número
      //     utilizable — ver evaluador.js).
      //   - o sí pudo resolver GANADA/PERDIDA/etc. (ej. una alta con su
      //     línea puesta), pero extraerCuotaAmericana() no encuentra
      //     ninguna cuota real (magnitud ≥ 100) en la jugada — sin eso el
      //     parley (o la jugada directa) no se puede pagar bien.
      // En ambos casos el ticket entero queda NULA (FALTA LOGRO) — mismo
      // estado que ya existía para la jugada ambigua entre 2 equipos (ver
      // detectarEquipoSinLogro/bug #15) — y se genera una alerta en la
      // pestaña 🔔 Alertas pidiendo corregir la sábana con el dato que
      // falta y volver a procesar.
      // =============================================================
      const esProblemaDeEquipoOAmbiguedad = res.estado === 'SIN_MAPEO' || res.estado === 'AMBIGUA (VARIOS DEPORTES)';
      const faltaCuota = !equipoSinLogro && !esProblemaDeEquipoOAmbiguedad && extraerCuotaAmericana(jNorm) === null;

      if (equipoSinLogro || res.estado === 'SIN_LOGRO' || faltaCuota) {
        ticketFaltaLogro = true;
        if (!equipoFaltaLogro) {
          equipoFaltaLogro = equipoSinLogro || (res.debug && res.debug.apodoDetectado) || null;
        }
        const mensajeFaltaLogro = equipoSinLogro
          ? 'La jugada "' + j + '" menciona 2 equipos y no se puede determinar con certeza a cuál de los 2 pertenece la cuota escrita — corrige la sábana aclarando el logro de cada equipo y vuelve a procesar.'
          : 'A la jugada "' + j + '" le falta el logro (' + (res.estado === 'SIN_LOGRO' ? res.razon : 'no se encontró una cuota real, de magnitud 100 o más, para calcular el pago') + ') — sin ese dato no se puede verificar si la jugada se dio, ni calcular el parley (o la jugada directa, si es de 1 sola pata). Corrige la sábana con el valor que falta y vuelve a procesar.';
        alertasParaCrear.push({
          tipo: 'SIN_LOGRO',
          cliente: b.cliente,
          ticket: b.ticket,
          pata: jNorm,
          mensaje: mensajeFaltaLogro,
          candidatos: []
        });
      }

      estadosPatas.push(res.estado);

      if (res.estado === 'PERDIDA') ticketPerdido = true;
      if (res.estado === 'PENDIENTE' || res.estado === 'SIN_MAPEO' || res.estado === 'SUSPENDIDA') ticketPendiente = true;
      if (res.estado === 'SUSPENDIDA') ticketSuspendida = true;
      if (res.estado === 'SIN_MAPEO') {
        ticketTieneSinMapeo = true;
        patasSinMapeoTextos.push(j);
        // 13-09-2026 (a pedido explícito del usuario, ver evaluador.js —
        // el chequeo `deporteMarcadorNoCoincide`): un SIN_MAPEO común
        // (equipo que todavía no está en el diccionario, sin más) no
        // genera ninguna alerta — se espera en silencio el marcador
        // manual o que se agregue el equipo, como viene funcionando desde
        // el 06-09-2026. Pero ESTE sub-caso es distinto: la jugada trae
        // un identificador EXPLÍCITO de deporte (emoji/abreviatura/
        // palabra) que CONTRADICE lo único que hay mapeado para ese apodo
        // (ej. "Texas" + "nfl" explícito, pero "texas" en el diccionario
        // solo es Texas Rangers/mlb) — es una confusión real, no solo una
        // ausencia, así que sí se avisa en 🔔 Alertas para que se revise
        // (agregar el equipo correcto al diccionario, o corregir el
        // nombre escrito), en vez de depender solo de que alguien note el
        // ticket pendiente.
        if (res.debug && res.debug.deporteMarcadorNoCoincide) {
          alertasParaCrear.push({
            tipo: 'DEPORTE_NO_COINCIDE',
            cliente: b.cliente,
            ticket: b.ticket,
            pata: jNorm,
            mensaje: res.razon,
            candidatos: (res.debug && res.debug.candidatosDelApodo) || []
          });
        }
      }
      if (res.estado === 'PENDIENTE' || res.estado === 'SUSPENDIDA') ticketTienePendienteReal = true;
      if (res.estado === 'ANULADA') { ticketAnulado = true; patasAnuladas++; }
      if (res.estado === 'AMBIGUA (VARIOS DEPORTES)') {
        ticketAmbiguo = true;
        // Se junta acá y se inserta después del forEach (que es síncrono)
        // — ver alertasParaCrear más arriba. Alerta tanto al Grupo como al
        // Súper-admin (ambos leen de la misma tabla "alertas", ver
        // src/routes/sabana.js y src/routes/superadmin.js).
        alertasParaCrear.push({
          cliente: b.cliente,
          ticket: b.ticket,
          pata: jNorm,
          mensaje: res.razon,
          candidatos: (res.debug && res.debug.candidatosAmbiguosDetalle) || []
        });
      }
      debugPatas.push({
        pataOriginal: j,
        resultado: equipoSinLogro ? 'FALTA LOGRO' : (faltaCuota && res.estado !== 'SIN_LOGRO' ? 'FALTA LOGRO' : res.estado),
        razon: equipoSinLogro
          ? ('Falta el logro (cuota) de "' + equipoSinLogro + '"')
          : (faltaCuota && res.estado !== 'SIN_LOGRO' ? 'Falta la cuota de esta jugada para poder calcular el pago' : res.razon),
        ...res.debug
      });
    });

    let pagaMostrado = b.pagaSabana;
    let esPagoEstimado = false;
    let pagaConDiscrepancia = false;
    const pagaSabanaOriginal = b.pagaSabana;

    if (!b.sinResultadoEnSabana && !ticketFaltaLogro && !ticketAmbiguo) {
      // Las patas ANULADAS (push) se sacan de la cuota combinada del
      // parley — ver el comentario grande en calcularPagoBrutoParley()
      // (parser.js). Si TODAS las patas fueron push, calcularPagoParley
      // devuelve null a propósito: no hay parley que pagar, el ticket
      // entero queda ANULADA más abajo (se devuelve el arriesgado).
      const pagoCalculado = calcularPagoParley(jugadasNormalizadas, b.arriesga, estadosPatas);
      if (pagoCalculado !== null) {
        if (b.pagaSabana === 0) {
          pagaMostrado = pagoCalculado;
          esPagoEstimado = true;
        } else {
          // OJO (06-09-2026, a pedido del usuario: "hay un error en los
          // parleys si se pasan sellado ya en la sabana con lo arriesgado
          // y cuanto ganaria el cliente y esta mal ese calculo no lo
          // corrige pero en las directas si se corrigen"): la tolerancia
          // era SOLO un porcentaje (2%) del pago, sin ningún techo — para
          // una jugada directa el pago suele ser chico (decenas o pocos
          // cientos de dólares), así que el 2% es apenas $1-5 y CUALQUIER
          // error de verdad lo supera y se corrige. Pero un parley
          // combina varias cuotas MULTIPLICADAS entre sí, así que su pago
          // real es varias veces más grande — el MISMO 2% ahí ya son
          // $50, $100, hasta $300 de margen. Un error real de sábana (mal
          // sumado/multiplicado a mano) de esa magnitud quedaba adentro
          // de ese margen y NUNCA se corregía ni se avisaba, exactamente
          // el reporte del usuario. La tolerancia ahora tiene un TECHO
          // fijo ($5) sin importar cuán grande sea el pago del parley —
          // sigue tolerando el redondeo normal de centavos/dólar (por eso
          // el piso de $1 se mantiene), pero cualquier diferencia de más
          // de $5 se corrige y se avisa, sea un parley o una jugada
          // directa.
          const diferencia = Math.abs(pagoCalculado - b.pagaSabana);
          const tolerancia = Math.min(Math.max(1, pagoCalculado * 0.02), 5);
          if (diferencia > tolerancia) {
            pagaConDiscrepancia = true;
            pagaMostrado = pagoCalculado;
          }
        }
      }
    }

    // =================================================================
    // TICKET SIN NINGUNA JUGADA (05-09-2026, bug real reportado por el
    // usuario: en la pestaña Sábanas aparecía un ticket "vacío" — sin
    // ninguna jugada para mostrar, "Sin datos de depuración" en el
    // desglose — pero CON un arriesgo real ($440/$240 en los 2 casos que
    // reportó) y marcado GANADA con $0 de pago. Causa: algunas líneas del
    // parser (parser.js — "arriesga//paga" y "arriesgo para ganancia" en
    // su propia línea) cierran un boleto con lo que HAYA acumulado en
    // jugadasTemp en ese momento, sin chequear si eso es CERO jugadas (ej.
    // una línea de cierre repetida/de más, sin ninguna jugada nueva en el
    // medio). Con 0 jugadas, el forEach de más abajo nunca corre, así que
    // NINGUNA de las banderas (ticketPerdido/ticketPendiente/etc.) se
    // llega a prender, y sin este chequeo el ticket caía en el "GANADA"
    // por default de siempre — como si un ticket con CERO patas hubiera
    // "ganado" solo por no tener ninguna pata perdedora. Ahora se marca
    // aparte, bien explícito, y se avisa en 🔔 Alertas para que se revise
    // la sábana (probablemente una línea de cierre de más, sin la jugada
    // correspondiente arriba).
    // =================================================================
    const ticketSinJugadas = !b.jugadas || b.jugadas.length === 0;
    if (ticketSinJugadas) {
      alertasParaCrear.push({
        tipo: 'SIN_JUGADA',
        cliente: b.cliente,
        ticket: b.ticket,
        pata: 'SIN_JUGADA:' + (b.ticket || 'sin-ticket') + ':' + b.cliente + ':' + b.arriesga,
        mensaje: 'Se encontró un ticket de ' + b.cliente + ' (' + (b.ticket || 'Sin Ticket') + ') con arriesgo ' +
          '(' + b.arriesga + ') pero SIN ninguna jugada asociada — probablemente una línea de cierre ' +
          '("arriesga//paga" o "arriesgo para ganancia") de más en la sábana, sin la jugada correspondiente ' +
          'arriba. Revisa la sábana de ese cliente y vuelve a procesar.',
        candidatos: []
      });
    }

    let estadoFinal = 'GANADA';
    if (ticketSinJugadas) {
      estadoFinal = 'NULA (SIN JUGADA)';
    } else if (ticketFaltaLogro) {
      estadoFinal = 'NULA (FALTA LOGRO)';
    } else if (ticketAmbiguo) {
      // Igual que NULA (FALTA LOGRO): si alguna pata no se pudo resolver
      // con certeza a qué deporte pertenece (ver evaluarJugada), el
      // ticket ENTERO queda pendiente de aclarar — no tiene sentido
      // seguir evaluando las demás patas de un parley si una está en el
      // aire, ni calcular ni pagar nada todavía.
      estadoFinal = 'AMBIGUA (VARIOS DEPORTES)';
    } else if (b.sinResultadoEnSabana) {
      estadoFinal = 'FALTA CERRAR EN SÁBANA';
      ticketPendiente = true;
    } else if (ticketPerdido) {
      estadoFinal = 'PERDIDA';
    } else if (ticketSuspendida) {
      estadoFinal = 'SUSPENDIDA';
    } else if (ticketPendiente) {
      // 06-09-2026 (a pedido del usuario, ver el comentario grande sobre
      // ticketTieneSinMapeo más arriba): si el ÚNICO motivo por el que
      // este ticket seguiría PENDIENTE es que alguna pata es de un equipo
      // SIN MAPEAR (todavía no hay diccionario/API para esa liga) — y
      // NINGUNA otra pata está genuinamente pendiente/suspendida de una
      // API que sí funciona — se respeta el marcador manual (✅/❌/⭕) que
      // la persona ya puso a mano en esa línea de la sábana, en vez de
      // dejarlo PENDIENTE para siempre (no hay ninguna API corriendo
      // detrás de esa liga que algún día lo vaya a resolver solo). Si NO
      // hay marcador manual puesto (o no es ninguno de los 3 símbolos
      // reconocidos), el comportamiento es EXACTAMENTE el de siempre:
      // queda PENDIENTE hasta que se corrija la sábana a mano.
      const MARCADOR_A_ESTADO_SIN_MAPEO = { '✅': 'GANADA', '❌': 'PERDIDA', '⭕': 'ANULADA' };
      const estadoPorMarcadorManual = (ticketTieneSinMapeo && !ticketTienePendienteReal && b.marcadorManual)
        ? MARCADOR_A_ESTADO_SIN_MAPEO[b.marcadorManual]
        : null;
      if (estadoPorMarcadorManual) {
        estadoFinal = estadoPorMarcadorManual;
        resueltoPorMarcadorManualSinMapeo = true;
      } else {
        estadoFinal = 'PENDIENTE';
      }
    } else if (ticketAnulado && patasAnuladas === b.jugadas.length) {
      // TODAS las patas del ticket fueron push (vale tanto para una jugada
      // directa de 1 sola pata como para un parley donde CADA pata cerró
      // exacto en su línea) -> el ticket entero es push: se devuelve el
      // arriesgado, no cuenta como ganancia ni pérdida (ver
      // esEstadoComisionable/pozo.js, "$0 a propósito"). Si solo ALGUNAS
      // patas fueron push y el resto ganó (ninguna PERDIDA/PENDIENTE), el
      // ticket sigue GANADA por default más abajo — pagaMostrado ya viene
      // calculado arriba usando solo las cuotas de las patas que sí
      // jugaron, sin las que empujaron.
      estadoFinal = 'ANULADA';
    }

    // =================================================================
    // MARCADOR MANUAL (✅/❌/⭕) vs. RESULTADO REAL (03-09-2026, a pedido
    // del usuario)
    // =================================================================
    // Algunos empleados ya marcan a mano, en la propia sábana, si un
    // ticket se dio o no (ej. "150//508✅"). Ese marcador NUNCA decide el
    // resultado — como siempre, el resultado lo determina evaluarJugada()
    // contra la API en vivo (ver "emojis ignorados y reverificados" en el
    // parser) — pero ahora, si el marcador a mano quedó MAL puesto (dice
    // ✅ y en realidad perdió, por ejemplo), se lo corrige igual que
    // siempre y además se avisa en la sábana, con el mismo criterio que ya
    // se usa para avisar cuando el pago escrito a mano no coincide con el
    // calculado (pagaConDiscrepancia, más abajo).
    //
    // Solo se compara cuando el ticket ya quedó en un estado "definitivo"
    // (GANADA/PERDIDA/ANULADA/SUSPENDIDA) — si todavía está PENDIENTE,
    // AMBIGUA o NULA (FALTA LOGRO) no hay nada confirmado contra qué
    // comparar el marcador todavía.
    const MARCADOR_ESPERADO_POR_ESTADO = {
      GANADA: '✅',
      PERDIDA: '❌',
      ANULADA: '⭕',
      SUSPENDIDA: '⭕'
    };
    const marcadorEsperado = MARCADOR_ESPERADO_POR_ESTADO[estadoFinal] || null;
    const marcadorManualIncorrecto = !!(
      b.marcadorManual && marcadorEsperado && b.marcadorManual !== marcadorEsperado
    );
    const notaMarcadorManual = marcadorManualIncorrecto
      ? ('La sábana lo tenía marcado a mano como ' + b.marcadorManual + ', pero verificado contra el resultado real quedó ' +
         estadoFinal + ' (' + marcadorEsperado + ') — se corrigió automáticamente.')
      : null;
    const notaResueltoPorMarcadorManualSinMapeo = resueltoPorMarcadorManualSinMapeo
      ? ('El equipo/liga de "' + patasSinMapeoTextos.join('", "') + '" todavía no está mapeado (esa liga aún no tiene una API conectada) — ' +
         'se usó el marcador manual (' + b.marcadorManual + ') que ya traía la sábana para decidir el resultado, mientras esa API no esté funcionando.')
      : null;

    if (estadoFinal === 'GANADA') totalPremiosSum += pagaMostrado;
    else if (estadoFinal === 'PERDIDA') totalPerdidoSum += b.arriesga;

    // "logros" = cantidad de patas del ticket (1 = jugada directa, 2 =
    // parley de 2 logros, ...) — 08-09-2026, a pedido del usuario, para
    // el modelo de comisión 'por_tipo_jugada' (ver comisiones.js). Se
    // calcula acá SIEMPRE (no solo cuando el grupo usa ese modelo) para
    // que quede guardado en el historial de todos modos — así, si un
    // grupo pasa de 'plano' a 'por_tipo_jugada' más adelante, sus
    // tickets NUEVOS ya tienen este dato desde antes.
    const logros = b.jugadas ? b.jugadas.length : 0;

    if (!resumenClientes[b.cliente]) {
      resumenClientes[b.cliente] = { arriesgado: 0, arriesgadoComisionable: 0, ganado: 0, perdido: 0, pendientes: 0 };
    }
    const rc = resumenClientes[b.cliente];
    rc.arriesgado += b.arriesga;
    if (esEstadoComisionable(estadoFinal)) rc.arriesgadoComisionable += b.arriesga;
    if (estadoFinal === 'GANADA') rc.ganado += pagaMostrado;
    if (estadoFinal === 'PERDIDA') rc.perdido += b.arriesga;
    if (['PENDIENTE', 'FALTA CERRAR EN SÁBANA', 'NULA (FALTA LOGRO)', 'NULA (SIN JUGADA)', 'SUSPENDIDA', 'AMBIGUA (VARIOS DEPORTES)'].includes(estadoFinal)) rc.pendientes += 1;
    // (09-09-2026, "grupo mixto") se acumula SIEMPRE, sin importar el
    // modelo DEFAULT del grupo — un cliente puntual puede tener la
    // excepción 'por_tipo_jugada' cargada aunque el grupo esté en
    // 'plano' (ver modelosComisionPorCliente/configComision.
    // modelosPorCliente, y calcularComisionTotalCliente en comisiones.js,
    // que es quien de verdad decide qué valor usar por cliente). Si
    // tiersComision está vacío (grupo que nunca configuró niveles), esto
    // no hace nada — porcentajePorTipoJugada() devuelve 0% y sigue
    // exactamente igual que siempre para cualquier grupo 100% 'plano'.
    acumularComisionPorTipoJugada(rc, { arriesga: b.arriesga, estado: estadoFinal, logros }, tiersComision);

    registrosHistorial.push({
      cliente: b.cliente,
      ticket: b.ticket,
      detalle: b.detalleText,
      arriesga: b.arriesga,
      gana: pagaMostrado,
      estado: estadoFinal,
      logros
    });

    ticketsDetalle.push({
      cliente: b.cliente,
      ticket: b.ticket,
      jugadas: b.jugadas,
      arriesga: b.arriesga,
      paga: pagaMostrado,
      esPagoEstimado,
      pagaConDiscrepancia,
      pagaSabanaOriginal,
      estado: estadoFinal,
      cierreAutomatico: !!b.cierreAutomatico,
      marcadorManualOriginal: b.marcadorManual || null,
      marcadorManualIncorrecto,
      notaMarcadorManual,
      resueltoPorMarcadorManualSinMapeo,
      notaResueltoPorMarcadorManualSinMapeo,
      logros,
      debug: debugPatas
    });
  });

  // "clientesDelDia": los que jugaron hoy + cualquier avalador que, sin
  // jugar, sí generó comisión hoy por avalar a otro cliente — ver bug #21
  // del proyecto original.
  const clientesDelDia = new Set(Object.keys(resumenClientes));
  Object.keys(avalesMap).forEach(avalador => {
    if (clientesDelDia.has(avalador)) return;
    const comisionSiAvala = calcularComisionTotalCliente(avalador, resumenClientes, porcentajesPropios, avalesMap, configComision);
    if (Math.abs(comisionSiAvala.total) > 0.001) clientesDelDia.add(avalador);
  });

  // =============================================================
  // POLLA del mismo día (02-09-2026 / corregido 02-09-2026 más tarde, a
  // pedido del usuario): la Polla es un juego APARTE (ver polla.js) que se
  // carga a mano, sin pasar por "Procesar Sábana" — pero el usuario pidió
  // explícitamente que, si esa fecha YA tiene Polla cargada, sus montos
  // aparezcan en la pestaña Sábana (dashboard, Resumen por Cliente) y en
  // el Plano de WhatsApp, igual que ya pasaba en Balance General y en la
  // vista del Cliente. Se lee acá, UNA vez, para esta fecha puntual —
  // clientes que SOLO juegan Polla (sin ningún ticket de sábana ese día)
  // ahora también aparecen en "Resumen por Cliente" con su saldo de Polla.
  // =============================================================
  const pollaDelDia = await leerPolla(grupoId, { desde: fecha, hasta: fecha });
  const pollaPorCliente = {};
  pollaDelDia.forEach(p => { pollaPorCliente[p.cliente] = (pollaPorCliente[p.cliente] || 0) + p.monto; });
  Object.keys(pollaPorCliente).forEach(cliente => clientesDelDia.add(cliente));

  let totalDevolucionesSum = 0;
  let totalPollaSum = 0; // convención CLIENTE (positivo = a favor del cliente)
  const resumenPorCliente = Array.from(clientesDelDia).sort().map(cliente => {
    const rc = resumenClientes[cliente] || { arriesgado: 0, arriesgadoComisionable: 0, ganado: 0, perdido: 0, pendientes: 0 };
    const comision = calcularComisionTotalCliente(cliente, resumenClientes, porcentajesPropios, avalesMap, configComision);
    totalDevolucionesSum += comision.total;
    const polla = pollaPorCliente[cliente] || 0;
    totalPollaSum += polla;
    // "moneda del grupo" (18-09-2026) — se etiqueta cada fila con la
    // moneda de ESE cliente (jugadores.moneda) para que routes/sabana.js
    // pueda partir este listado en dos bloques (USD/BS) cuando el grupo
    // esté en modo 'mixto', sin tocar ningún número ya calculado arriba.
    // Default 'USD' si por lo que sea el cliente no está en
    // jugadoresPorNombre (no debería pasar: autoRegistrarJugadores() más
    // abajo da de alta a cualquier cliente nuevo antes de terminar).
    const moneda = (jugadoresPorNombre[cliente] && jugadoresPorNombre[cliente].moneda) || 'USD';
    return {
      cliente,
      jugoHoy: Object.prototype.hasOwnProperty.call(resumenClientes, cliente),
      jugoPolla: Object.prototype.hasOwnProperty.call(pollaPorCliente, cliente),
      arriesgado: rc.arriesgado,
      ganado: rc.ganado,
      perdido: rc.perdido,
      balance: rc.ganado - rc.perdido,
      porcentajePropio: comision.porcentajePropio,
      comisionPropia: comision.comisionPropia,
      comisionAval: comision.comisionAval,
      comisionTotal: comision.total,
      polla,
      pendientes: rc.pendientes,
      moneda
    };
  });
  // Banca: negación del total de Polla — misma convención usada en
  // balanceGeneral.js (bancaPollaCliente = -pollaCliente).
  const totalBancaPollaSum = -totalPollaSum;

  // Totales del día por cliente en convención CASA, para el cierre del
  // "Plano de WhatsApp" (positivo = ese cliente le dejó plata a la banca).
  // "polla"/"bancaPolla" se agregan aparte (misma convención que arriba)
  // para que el Plano pueda mostrar la Polla como su propia línea, sin
  // mezclarla en silencio con el resultado puro de la sábana.
  const totalesClientesPlano = resumenPorCliente.map(c => ({
    cliente: c.cliente,
    jugoHoy: c.jugoHoy,
    jugoPolla: c.jugoPolla,
    totalBanca: c.perdido - c.ganado - c.comisionTotal,
    devolucion: c.comisionTotal,
    polla: c.polla,
    bancaPolla: -c.polla
  }));
  const totalBancaGeneral = totalesClientesPlano.reduce((acc, c) => acc + c.totalBanca, 0);

  await autoRegistrarJugadores(grupoId, Object.keys(resumenClientes), jugadoresPorNombre);
  await guardarEnHistorial(grupoId, fecha, registrosHistorial);

  // Alertas de jugadas AMBIGUA (VARIOS DEPORTES) que ninguna capa de
  // evaluarJugada() pudo resolver sola — se insertan todas juntas acá
  // (después del forEach síncrono de arriba, ver alertasParaCrear) para no
  // mezclar async/await dentro de un forEach. crearAlerta() ya se encarga
  // de no duplicar si la MISMA jugada ambigua ya estaba alertada y sin
  // resolver (ver alertas.js) — devuelve true solo cuando de verdad insertó
  // una fila NUEVA, así "alertasNuevas" (el aviso EN PANTALLA que muestra
  // el panel apenas termina de procesar) no se dispara de nuevo cada vez
  // que se reprocesa una sábana que ya estaba avisada y sigue sin resolver.
  let alertasNuevas = 0;
  if (alertasParaCrear.length > 0) {
    const resultadosAlertas = await Promise.all(alertasParaCrear.map(a => crearAlerta(grupoId, fecha, a)));
    alertasNuevas = resultadosAlertas.filter(Boolean).length;
  }

  // =============================================================
  // "BALANCE NETO CASA" con Polla combinada (03-09-2026, a pedido del
  // usuario — corrige el criterio de "nunca mezclar" de más arriba, que
  // era justo lo que él NO quería acá): el mismo día que se registra la
  // Polla, su resultado (positivo o negativo) tiene que sumarse/restarse
  // al balance neto del día — igual que se corrigió "balanceBanca" en
  // balanceGeneral.js (bug de "la Polla no influye en el total"). Se
  // sigue guardando el desglose "solo sábana" aparte (totalBalanceCasaSabana
  // / totalesClientesPlano ya trae totalBanca del cliente sin Polla) para
  // no perder el detalle, pero el número que manda — el que se muestra en
  // la tarjeta "Balance Neto Casa" y en "TOTAL BANCA" del Plano — ahora sí
  // incluye la Polla del día. Cuando esa fecha no tiene Polla cargada,
  // totalBancaPollaSum da 0 y el combinado queda igual al de sábana sola,
  // así que no hace falta ninguna rama especial para "días sin Polla".
  //
  // "pollaRegistrada" (mismo cambio): flag explícito de "esta fecha SÍ
  // tiene filas de Polla cargadas" — a diferencia de mirar si el monto
  // neto de Polla es != 0 (lo que antes usaba el frontend para la
  // tarjeta), esto no se confunde si la Polla se jugó pero cerró en $0
  // neto exacto. El frontend lo usa para decidir si muestra la tarjeta
  // "Banca Polla" y las columnas "Polla"/"Total Día (con % y Polla)" del
  // Resumen por Cliente — el usuario pidió que esas partes NO aparezcan
  // en absoluto los días que su grupo no registra Polla (ej. cualquier
  // día que no sea el día fijo de la Polla de ese grupo).
  // =============================================================
  const pollaRegistrada = pollaDelDia.length > 0;
  const totalBalanceCasaSabana = totalPerdidoSum - totalPremiosSum - totalDevolucionesSum;
  const totalBalanceCasa = totalBalanceCasaSabana + totalBancaPollaSum;

  return {
    fecha,
    tickets: ticketsDetalle,
    resumenPorCliente,
    alertasNuevas,
    // (08-09-2026) el frontend usa esto para saber si tiene que mostrar
    // un % por cliente (modelo 'plano', de siempre) o la etiqueta "Por
    // tipo de jugada" en la columna de % del Resumen por Cliente (ver
    // public/app.js) — resumenPorCliente[].porcentajePropio ya viene en
    // `null` para ese modelo (ver comisiones.js), esto es solo para que
    // el frontend sepa CÓMO explicarlo.
    modeloComision,
    // "Guardar Día" (31-08-2026): CADA reproceso deja la fecha "sin
    // confirmar" (guardarEnHistorial llama a desconfirmarDia internamente),
    // así que el panel puede pintar el badge de una vez, sin otro
    // round-trip a /estado-dia, apenas termina de procesar.
    diaConfirmado: false,
    totales: {
      totalArriesgado: totalArriesgadoSum,
      totalPerdido: totalPerdidoSum,
      totalPremios: totalPremiosSum,
      totalDevoluciones: totalDevolucionesSum,
      // Balance neto del día, YA combinado con la Polla si esta fecha la
      // tiene registrada (ver comentario grande de arriba).
      totalBalanceCasa,
      // Desglose "solo sábana", sin Polla — se mantiene por si algún día
      // hace falta mostrarlo aparte (mismo patrón que balanceBancaSabana
      // en balanceGeneral.js).
      totalBalanceCasaSabana,
      totalPolla: totalPollaSum,
      totalBancaPolla: totalBancaPollaSum,
      pollaRegistrada
    },
    planoWhatsApp: {
      totalesClientes: totalesClientesPlano,
      // "TOTAL BANCA" del Plano: mismo criterio, ya combinado con la Polla
      // del día. totalBancaSabana queda para quien necesite el desglose.
      totalBancaSabana: totalBancaGeneral,
      totalBanca: totalBancaGeneral + totalBancaPollaSum,
      totalBancaPolla: totalBancaPollaSum,
      pollaRegistrada
    }
  };
}

// autoRegistrarJugadores también se exporta (22-09-2026) para que
// src/routes/hipismo.js la reuse tal cual al guardar un plano — mismo
// pedido del usuario ("al hacer un plano el cliente debe crearse
// automatico") pero para Hipismo, sobre la MISMA tabla "jugadores"
// compartida entre los 2 módulos (ver claude/plan-modulo-hipismo.md).
// Ningún cambio de comportamiento acá, solo queda accesible desde afuera.
module.exports = { procesarSabana, autoRegistrarJugadores };
