// =================================================================
// COMISIONES (% PROPIO Y "AVALADOS POR") + ESTADOS "EN JUEGO"
// =================================================================
// Portado de app.js (secciones 1D y parte de 1C). Las funciones son
// puras: reciben la configuración del grupo (porcentajes propios y avales,
// ya cargados de la base de datos) como parámetro, en vez de leer
// variables globales como en la app original.

// Un ticket cuenta para la base de comisión (%) salvo que haya quedado en
// ANULADA (push/empate), SUSPENDIDA (juego suspendido/pospuesto), NULA
// (FALTA LOGRO) (jugada ambigua sin resolver), NULA (SIN JUGADA) (05-09-2026
// — un ticket con arriesgo pero sin ninguna jugada asociada, ver la nota
// grande en procesarSabana.js) o AMBIGUA (VARIOS DEPORTES) (no se pudo
// determinar de qué deporte era la jugada — ver evaluador.js).
function esEstadoComisionable(estado) {
  return estado !== 'ANULADA' && estado !== 'SUSPENDIDA' && estado !== 'NULA (FALTA LOGRO)' && estado !== 'NULA (SIN JUGADA)' && estado !== 'AMBIGUA (VARIOS DEPORTES)';
}

// Un ticket "todavía en juego" mantiene el arriesgado CONGELADO del pozo
// del jugador. ANULADA (push) no cuenta aquí: ya es un resultado FINAL,
// solo que su efecto en el pozo es $0.
function esEstadoEnJuego(estado) {
  return estado === 'PENDIENTE' || estado === 'SUSPENDIDA' || estado === 'FALTA CERRAR EN SÁBANA' || estado === 'NULA (FALTA LOGRO)' || estado === 'NULA (SIN JUGADA)' || estado === 'AMBIGUA (VARIOS DEPORTES)';
}

// =================================================================
// MODELO DE COMISIÓN "POR TIPO DE JUGADA" (08-09-2026, a pedido del
// usuario: "hay grupos que manejan de distintas maneras los %... tengo
// un grupo que el % es de lo arriesgado pero por tipo de jugadas... las
// directas es un 2%... dos logros es el 3%... y 3 logros es el 5%... y
// despues esos resultados se suman y dan el total").
// =================================================================
// tiers: [{ logros, porcentaje }, ...] (ver la nota grande en
// sql/schema.sql, columna grupos.comision_tiers) — NO hace falta que
// tengan exactamente 3 elementos ni que el más alto sea "3": el usuario
// avisó que más adelante puede querer un cuarto nivel (o más) para
// parleys de 4+ logros.
//
// Regla de coincidencia: se usa el tier con el "logros" más alto que sea
// <= a los logros REALES del ticket — así el tier más alto que exista
// actúa como "techo abierto" para cualquier parley todavía más grande
// (agregar un nivel nuevo es solo agregar una fila a `tiers`, nunca hay
// que tocar este código). Si el ticket tiene MENOS logros que el tier
// más chico configurado (ej. llega una jugada directa de 1 logro pero
// nadie configuró un tier para "1"), no hay ningún tier que aplique —
// se devuelve 0% en vez de adivinar cuál usar.
function porcentajePorTipoJugada(logros, tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return 0;
  const logrosNum = Number(logros) || 0;
  let elegido = null;
  [...tiers]
    .slice()
    .sort((a, b) => Number(a.logros) - Number(b.logros))
    .forEach(tier => {
      if (Number(tier.logros) <= logrosNum) elegido = tier;
    });
  return elegido ? Number(elegido.porcentaje) || 0 : 0;
}

// Acumula, en el "resumen por cliente" (rc) que ya viene armando
// procesarSabana.js/historial.js, la comisión de UN ticket bajo el
// modelo "por_tipo_jugada" — se suma en DÓLARES directo (no en %, porque
// el % puede ser distinto ticket por ticket según cuántos logros tenga
// cada uno), en un campo aparte (`comisionPorTipoAcumulada`) que
// calcularComisionTotalCliente usa en vez de arriesgadoComisionable*pct
// cuando el grupo está en este modelo. Se llama UNA vez por ticket, en
// los 2 lugares que ya arman este resumen (procesarSabana.js para el día
// que se está procesando ahora, e historial.js para reconstruir un rango
// histórico) — factorizado acá para que ambos usen exactamente la misma
// regla y no se desincronicen.
//
// `logros` puede venir undefined/null (tickets guardados ANTES de este
// campo existir, ver la columna tickets_historial.logros) — se tratan
// como "0 logros" (ningún tier calza) a propósito, en vez de adivinar.
function acumularComisionPorTipoJugada(rc, { arriesga, estado, logros }, tiers) {
  if (!esEstadoComisionable(estado)) return;
  const pct = porcentajePorTipoJugada(logros, tiers);
  rc.comisionPorTipoAcumulada = (rc.comisionPorTipoAcumulada || 0) + Number(arriesga || 0) * (pct / 100);
}

// cliente: nombre del cliente a evaluar.
// resumenClientes: { "NOMBRE": { arriesgadoComisionable, ... } } — de HOY
//   (procesarSabana) o reconstruido de un rango histórico. Cuando el
//   grupo usa el modelo 'por_tipo_jugada', cada entrada además trae
//   `comisionPorTipoAcumulada` (ver acumularComisionPorTipoJugada arriba).
// porcentajesPropios: { "NOMBRE": pct } — SOLO se usa en el modelo
//   'plano' (default); en 'por_tipo_jugada' se ignora a propósito, porque
//   ahí el % depende del tipo de cada jugada, no de un valor fijo por
//   cliente (ver la nota grande en sql/schema.sql).
// avalesMap: { "AVALADOR": { "AVALADO": pct, ... } } — la comisión por
//   avalar a otro cliente SIEMPRE es un % plano sobre lo arriesgado
//   comisionable del avalado, sin importar el modelo de comisión propia
//   del grupo — son 2 relaciones de comisión distintas (uno cobra por SUS
//   PROPIAS jugadas, el otro cobra por avalar a alguien más), y el
//   usuario solo pidió el modelo por tipo de jugada para la primera.
// configComision: { modelo, tiers, modelosPorCliente } opcional — si se
//   omite, o si `modelo` no es 'por_tipo_jugada' y este cliente no tiene
//   ningún override, el comportamiento es EXACTAMENTE el de siempre
//   (retrocompatible con todo el código/pruebas que llama esta función
//   sin el 5to parámetro, o con un configComision sin `modelosPorCliente`).
//
// modelosPorCliente (09-09-2026, "grupo mixto" — a pedido del usuario:
// "se puede tener un modelo de % en un grupo mixto... clientes que se le
// regrese % variados dependiendo de las patas de las jugadas... o
// establecerle % fijo por cualquier tipo de jugada" / "puedo elegir
// cualquier tipo de % o sin %" — ver la nota grande en sql/schema.sql,
// columna jugadores.modelo_comision): { "NOMBRE": 'plano'|'por_tipo_jugada' },
// SOLO trae una entrada para los clientes con una excepción puntual
// cargada — cualquier cliente que no aparezca ahí sigue el modelo DEFAULT
// del grupo (configComision.modelo), sin cambios. Cuando SÍ hay una
// excepción para este cliente, GANA por sobre el modelo default del
// grupo — así un grupo en 'por_tipo_jugada' puede tener un cliente
// puntual en % fijo (jugadores.comision_propia, que puede ser 0 = "sin
// %"), y un grupo en 'plano' puede tener un cliente puntual cobrando por
// tipo de jugada (usando los niveles del GRUPO — no hay niveles
// individuales por jugador todavía, ver la nota en sql/schema.sql).
function calcularComisionTotalCliente(cliente, resumenClientes, porcentajesPropios, avalesMap, configComision) {
  const rc = resumenClientes[cliente];
  const overridePorCliente = configComision && configComision.modelosPorCliente && configComision.modelosPorCliente[cliente];
  const modeloEfectivo = overridePorCliente || (configComision && configComision.modelo) || 'plano';
  const modeloPorTipo = modeloEfectivo === 'por_tipo_jugada';

  let porcentajePropio;
  let comisionPropia;
  if (modeloPorTipo) {
    // Sin un único % que mostrar (cada ticket pudo haber usado uno
    // distinto) — se deja explícitamente null para que el frontend sepa
    // que tiene que mostrar "Por tipo de jugada" en vez de un número.
    porcentajePropio = null;
    comisionPropia = rc ? (rc.comisionPorTipoAcumulada || 0) : 0;
  } else {
    const arriesgadoComisionablePropio = rc ? rc.arriesgadoComisionable : 0;
    porcentajePropio = porcentajesPropios[cliente] || 0;
    comisionPropia = arriesgadoComisionablePropio * (porcentajePropio / 100);
  }

  let comisionAval = 0;
  const avalados = avalesMap[cliente];
  if (avalados) {
    Object.keys(avalados).forEach(avalado => {
      const rcAvalado = resumenClientes[avalado];
      const arriesgadoAvalado = rcAvalado ? rcAvalado.arriesgadoComisionable : 0;
      comisionAval += arriesgadoAvalado * (avalados[avalado] / 100);
    });
  }

  return {
    porcentajePropio,
    comisionPropia,
    comisionAval,
    total: comisionPropia + comisionAval
  };
}

module.exports = {
  esEstadoComisionable,
  esEstadoEnJuego,
  porcentajePorTipoJugada,
  acumularComisionPorTipoJugada,
  calcularComisionTotalCliente
};
