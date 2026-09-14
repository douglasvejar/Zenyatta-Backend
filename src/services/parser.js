// =================================================================
// PARSER DE SÁBANA + CÁLCULO DE PAGOS DE PARLEYS
// =================================================================
// Portado tal cual de app.js (secciones 4, 4B y 4C) — es lógica pura de
// texto/números, no depende de DOM ni de localStorage, así que se pudo
// mover sin cambios de comportamiento. Recibe el diccionario de equipos ya
// resuelto para este grupo (base + personalizados) como parámetro, en vez
// de leerlo de una variable global.
const { normalizarTexto } = require('./normalizar');

// =================================================================
// COMA O PUNTO PARA DECIMALES EN LOS MONTOS (28-08-2026)
// =================================================================
// El grupo escribe los montos (arriesga/paga, "x $20,50", "para $50,25",
// "100,50//90,91") a veces con coma y a veces con punto para separar los
// decimales — para nosotros es EL MISMO monto ("," o "." separan
// decimales igual). Antes de este arreglo, esLineaSoloMonto/matchResultado
// más abajo solo reconocían el punto: una línea como "100,50//90,91" no
// hacía match completo y el regex terminaba "enganchando" mal los números
// (ej. tomaba 50 y 90 en vez de 100.50 y 90.91), dando totales incorrectos
// en la sábana. normalizarTexto() (normalizar.js) ya hace esta misma
// conversión para el texto de las jugadas (líneas de apuesta), pero esas
// líneas de MONTO se leen acá, en el parser crudo, ANTES de pasar por
// normalizarTexto — así que hace falta la misma conversión, temprano, para
// toda la línea (no solo la jugada).
function normalizarComasDecimales(texto) {
  return texto.replace(/(\d+),(\d+)/g, '$1.$2');
}

function esLineaSoloMonto(linea) {
  return /^(x\s*|para\s+(?:ganar\s+)?)?\$?\d+(?:\.\d+)?\$?$/i.test(linea.trim());
}

// OJO (28-08-2026): algunos grupos no escriben "PARA <monto>" a secas, sino
// "PARA GANAR <monto>" (ej. "MIAMI NFL -129 PARA GANAR 700") — la palabra
// "GANAR" metida entre "para" y el número. El regex tolera ese "ganar"
// opcional para no perder la ganancia deseada en esos casos (antes se
// perdía en silencio: el ticket quedaba "FALTA CERRAR EN SÁBANA" en vez de
// cerrarse solo con el arriesgo calculado desde la cuota).
function extraerGananciaDeseadaDeJugadas(jugadas) {
  for (const j of jugadas) {
    const m = j.match(/para\s+(?:ganar\s+)?\$?(\d+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1]);
  }
  return 0;
}

function extraerMontoStakeDeJugadas(jugadas) {
  for (const j of jugadas) {
    const m = j.match(/x\s*\$?(\d+(?:\.\d+)?)\b/i);
    if (m) return parseFloat(m[1]);
  }
  return 0;
}

function cuotaAmericanaADecimal(cuotaAmericana) {
  if (cuotaAmericana > 0) return 1 + (cuotaAmericana / 100);
  return 1 + (100 / Math.abs(cuotaAmericana));
}

function calcularArriesgoDesdeGanancia(cuotaAmericana, gananciaDeseada) {
  const decimal = cuotaAmericanaADecimal(cuotaAmericana);
  const factorGanancia = decimal - 1;
  if (!isFinite(factorGanancia) || factorGanancia <= 0) return null;
  return gananciaDeseada / factorGanancia;
}

function separarPatasPorX(lineaJugada) {
  const segmentos = lineaJugada.split(/\bx\b/i).map(s => s.trim()).filter(s => s !== '');
  if (segmentos.length < 2) return null;

  const esMontoSuelto = (s) => /^\$?\d+(?:\.\d+)?\$?$/.test(s);
  const ultimoEsMonto = esMontoSuelto(segmentos[segmentos.length - 1]);
  const candidatos = ultimoEsMonto ? segmentos.slice(0, -1) : segmentos;
  if (candidatos.length < 2) return null;

  const tieneCuotaPropia = (s) => /[+-]\d{2,4}(?:\.\d+)?/.test(s);
  if (!candidatos.every(tieneCuotaPropia)) return null;

  // Si el último segmento era un monto suelto (ej. "...-190 X HOUSTON NFL
  // -190 X 400"), no es una pata más del parley: es el monto arriesgado,
  // escrito en la MISMA línea de las jugadas en vez de en su propia línea
  // aparte (28-08-2026, ejemplo real de un grupo). Antes se perdía en
  // silencio: quedaba afuera de "candidatos" y ninguna otra parte del
  // parser lo recuperaba, así que el ticket nunca se cerraba solo. Se
  // devuelve aparte (candidatos.montoFinal) para que parsearSabana lo use
  // como monto arriesgado del boleto.
  if (ultimoEsMonto) {
    candidatos.montoFinal = parseFloat(segmentos[segmentos.length - 1].replace(/\$/g, ''));
  }

  return candidatos;
}

function separarPatas(lineaJugada) {
  const regexPata = /(?:(?:over|under|alta|baja)\s+)?[^()]+?\(\s*[+-]?[\d.,½]+\s*\)\s*(?:[+-]\d{2,4})?/gi;
  const patas = [];
  let match;
  while ((match = regexPata.exec(lineaJugada)) !== null) {
    const pata = match[0].trim();
    if (pata) patas.push(pata);
  }
  if (patas.length > 0) return patas;

  const patasPorX = separarPatasPorX(lineaJugada);
  if (patasPorX) return patasPorX;

  return [lineaJugada];
}

// Necesita el diccionario de equipos (base + personalizados del grupo)
// para saber cuántos equipos distintos se mencionan en la pata.
function detectarEquipoSinLogro(pataNormalizada, diccionarioEquipos) {
  const apodosEncontrados = [];
  for (const apodo of Object.keys(diccionarioEquipos)) {
    const regexPalabra = new RegExp('\\b' + apodo + '\\b', 'i');
    const matchPalabra = pataNormalizada.match(regexPalabra);
    if (matchPalabra) {
      apodosEncontrados.push({ apodo, index: matchPalabra.index });
      continue;
    }
    const idxSub = pataNormalizada.toLowerCase().indexOf(apodo.toLowerCase());
    if (idxSub !== -1) apodosEncontrados.push({ apodo, index: idxSub });
  }
  if (apodosEncontrados.length < 2) return null;

  const regexX = /\bx\b/gi;
  let matchX;
  while ((matchX = regexX.exec(pataNormalizada)) !== null) {
    const equipoAntes = apodosEncontrados
      .filter(e => e.index < matchX.index)
      .sort((a, b) => b.index - a.index)[0];
    if (!equipoAntes) continue;

    const antesDeLaX = pataNormalizada.slice(0, matchX.index).replace(/\s+$/, '');
    if (/\d$/.test(antesDeLaX)) continue;

    const despuesDeLaX = pataNormalizada.slice(matchX.index + matchX[0].length);
    if (/^\s*\$?\d/.test(despuesDeLaX)) continue;

    return equipoAntes.apodo;
  }

  return null;
}

// OJO (28-08-2026): antes esta función tomaba a ciegas el ÚLTIMO número
// que encontraba en la jugada, sin importar qué tan chico fuera — así que
// una jugada de over/under con la línea puesta ("alta 8") pero SIN su
// cuota ("-120") terminaba usando el "8" como si fuera la cuota, dando un
// pago carísimamente mal calculado (una cuota americana real SIEMPRE
// tiene 100 de magnitud para arriba — ver el comentario de
// CONFIG_POR_DEPORTE en evaluador.js, misma idea acá). Ahora solo se
// acepta como cuota un número de magnitud ≥ 100 — si no hay ninguno,
// devuelve null (a la jugada le falta su logro) en vez de agarrar
// cualquier otro número de la línea por error.
//
// OJO 2 (03-09-2026, ticket real del usuario: "Cincinati 1h +130 100$"):
// cuando el monto arriesgado va pegado al FINAL de la jugada sin la
// palabra "x" ni "para" delante (ej. "...100$", en vez de "...x 100" o
// "...para 100"), antes quedaba sin limpiar del texto — y como una cuota
// americana real (+130) y ese monto (100$) tienen los dos magnitud >= 100,
// extraerCuotaAmericana() terminaba devolviendo el ÚLTIMO número que
// encontraba (el monto, no la cuota), calculando el pago con una cuota
// equivocada. La cuota americana real SIEMPRE lleva el signo +/- delante
// (así se escribe siempre en la sábana); un monto en dólares NUNCA lo
// lleva. Exigir el signo alcanza para distinguir los dos sin necesitar
// que el monto esté marcado con "x"/"para"/"$" de ninguna forma en
// particular.
function extraerCuotaAmericana(lineaJugadaNormalizada) {
  const limpia = lineaJugadaNormalizada
    .replace(/\bx\s*\$?\d+(?:\.\d+)?\b/gi, ' ')
    .replace(/\bpara\s+(?:ganar\s+)?\$?\d+(?:\.\d+)?\$?\b/gi, ' ')
    .replace(/5inn/gi, ' ');

  const numeros = limpia.match(/[+-]\d+(?:\.\d+)?/g);
  if (!numeros || numeros.length === 0) return null;

  const candidatas = numeros.map(parseFloat).filter(n => Math.abs(n) >= 100);
  if (candidatas.length === 0) return null;

  return candidatas[candidatas.length - 1];
}

// OJO (05-09-2026, a pedido del usuario con un ticket real: "⚾Mets -200
// para 150" seguido, en la línea de abajo, de "⚾Whit sox 5to -115 para
// 250" — 2 jugadas SUELTAS, sin ningún ticket/cliente/monto de por medio
// que las separe): cuando un grupo escribe varias jugadas de UNA SOLA
// pata seguidas, cada una con SU PROPIA cuota y su PROPIA ganancia
// deseada ("cuota para monto"), antes se acumulaban todas juntas como si
// fueran las patas de UN SOLO parley — el ticket terminaba con
// arriesga=$0/paga=$0 ("FALTA CERRAR EN SÁBANA") porque el cierre
// automático de "cuota para monto" (más abajo, cerrarBoletoColgado) solo
// se dispara cuando el boleto tiene EXACTAMENTE 1 pata. El usuario lo
// explicó así: "ya tu tienes el logro de cuanto paga el equipo... con eso
// no hace falta cerrar en la sabana porque ya puedes calcular cuanto
// tiene que arriesgar para ganar eso" — cada una de esas líneas es, ELLA
// SOLA, un ticket completo de una sola pata, no una pata más de un
// parley ajeno. Se detecta acá (una pata que trae su propia cuota real
// —con signo, magnitud ≥ 100— seguida de "para (ganar)? <monto>" al
// final de la misma línea) para cerrar cada una como su propio ticket en
// vez de dejarla mezclada con lo que venga antes o después (ver el uso
// más abajo, en el bucle principal).
//
// Tolera además un espacio entre el signo y el número de la cuota (ej.
// "- 120"), mismo arreglo que se hizo en normalizarTexto() (normalizar.js)
// para el mismo reporte del usuario: "si el logro que paga un equipo es
// -120 y hay un espacio entre el signo y la cantidad no distingue el
// logro sea cual sea el signo".
function pataTieneCuotaYParaPropia(pataTexto) {
  const m = pataTexto.match(/([+-])\s?(\d+(?:\.\d+)?)\s*para\s+(?:ganar\s+)?\$?\d+(?:\.\d+)?\$?\s*$/i);
  if (!m) return false;
  return Math.abs(parseFloat(m[1] + m[2])) >= 100;
}

// OJO (31-08-2026, a pedido del usuario con un ticket real): en un parley,
// una pata que resultó ANULADA (push — ej. una alta/baja que cerró EXACTO
// en la línea) no se pierde ni se gana, así que NO puede seguir contando
// en la cuota combinada del parley (multiplicar por su cuota como si se
// hubiera jugado normal infla o desinfla el pago sin motivo). La regla real
// de casas de apuestas — confirmada por el usuario con un ticket real de su
// grupo — es "sacar" esa pata del parley y recalcular usando SOLO las
// cuotas de las patas que sí se jugaron, sobre el mismo monto arriesgado
// original. Si la pata anulada era la ÚNICA del ticket (o TODAS lo fueron),
// no hay ninguna cuota que combinar — ese caso no se resuelve acá, lo
// maneja procesarSabana.js dejando el ticket entero como ANULADA (se
// devuelve el arriesgado, sin pago de parley).
//
// `estadosPorPata`, si se pasa, es un array paralelo a `jugadasNormalizadas`
// con el estado (GANADA/PERDIDA/ANULADA/...) que ya resolvió evaluarJugada()
// para esa pata — quien llama a esta función es quien ya evaluó cada pata,
// así que no hace falta volver a evaluar nada acá, solo filtrar.
function calcularPagoBrutoParley(jugadasNormalizadas, montoArriesgado, estadosPorPata) {
  const cuotas = jugadasNormalizadas.map(extraerCuotaAmericana);
  if (cuotas.some(c => c === null || isNaN(c))) return null;

  const cuotasActivas = estadosPorPata
    ? cuotas.filter((_, i) => estadosPorPata[i] !== 'ANULADA')
    : cuotas;

  // Todas las patas fueron push -> no hay parley que calcular acá (el
  // ticket entero queda ANULADA, se resuelve en procesarSabana.js).
  if (cuotasActivas.length === 0) return null;

  const decimalCombinado = cuotasActivas.reduce((acc, c) => acc * cuotaAmericanaADecimal(c), 1);
  return montoArriesgado * decimalCombinado;
}

function calcularPagoParley(jugadasNormalizadas, montoArriesgado, estadosPorPata) {
  const bruto = calcularPagoBrutoParley(jugadasNormalizadas, montoArriesgado, estadosPorPata);
  if (bruto === null) return null;
  return bruto - montoArriesgado;
}

// Parsea el texto crudo de la sábana en una lista de "boletos" (tickets).
// diccionarioEquipos se usa solo dentro de cerrarBoletoColgado (caso 1,
// para chequear detectarEquipoSinLogro antes de auto-cerrar un ticket).
// Palabras reconocidas para el marcador de sección opcional "[NFL]"/
// "[MLB]"/etc. (ver más abajo) — mapea la palabra escrita al código de
// deporte interno que usa el resto del sistema (evaluador.js/CONFIG_POR_DEPORTE).
// Además del nombre "formal" del deporte (nfl/mlb/nhl/...), se reconocen
// palabras REFERENCIALES de cada uno — lo que un trabajador escribiría de
// forma natural en WhatsApp en vez del nombre técnico (ej. "houston bate"
// en vez de "houston mlb"), a pedido explícito del usuario (28-08-2026):
// "si te colocan houston y una pelota de beisbol o un bate... es houston
// mlb, así para todos los deportes". Se eligieron a propósito palabras que
// NO se prestan a confusión entre los deportes que hoy conviven en la
// sábana (MLB/NFL) ni con los que se van a sumar después (NHL/fútbol/
// basket) — por eso NO se incluyó, por ejemplo, "balón"/"gol" (se usan
// igual en fútbol, basket y hockey) ni "triple" (es un hit de 3 bases en
// MLB, pero también una canasta de 3 puntos en basket).
const PALABRAS_DEPORTE = {
  nfl: 'nfl', 'futbol americano': 'nfl', 'fútbol americano': 'nfl',
  touchdown: 'nfl', mariscal: 'nfl', 'mariscal de campo': 'nfl',
  mlb: 'mlb', beisbol: 'mlb', 'béisbol': 'mlb', besibol: 'mlb',
  bate: 'mlb', jonron: 'mlb', 'jonrón': 'mlb', 'home run': 'mlb', pitcher: 'mlb', 'pícher': 'mlb',
  nhl: 'nhl', hockey: 'nhl', 'hockey sobre hielo': 'nhl',
  disco: 'nhl', patines: 'nhl', puck: 'nhl',
  futbol: 'soccer', 'fútbol': 'soccer', soccer: 'soccer', balompié: 'soccer',
  arquero: 'soccer', portero: 'soccer',
  nba: 'basket', basket: 'basket', basquet: 'basket', 'básquet': 'basket', baloncesto: 'basket',
  canasta: 'basket', aro: 'basket',
  // NCAAF (12-09-2026, junto con la API — ver ncaafApi.js): a propósito NO
  // se reusa el emoji 🏈 (sigue significando SIEMPRE nfl, ver EMOJI_DEPORTE
  // más abajo — cambiarlo ahí rompería toda sábana vieja que ya lo usa para
  // NFL) — el usuario tiene que aclarar con una de estas PALABRAS cuando
  // quiera forzar NCAAF en vez de NFL para un apodo ambiguo (ej. un futuro
  // "houston ncaaf" si algún día "houston" también fuera un programa de
  // NCAAF). A propósito NO se incluyó la palabra suelta "universitario"
  // (es también el nombre de un club de fútbol peruano real — Universitario
  // de Deportes — y forzaría NCAAF por error en una sábana de fútbol que lo
  // mencione): solo frases que no dejan dudas.
  ncaaf: 'ncaaf', 'college football': 'ncaaf', 'ncaa football': 'ncaaf',
  'futbol universitario': 'ncaaf', 'fútbol universitario': 'ncaaf',
  'futbol colegial': 'ncaaf', 'fútbol colegial': 'ncaaf',
  // NCAAB (13-09-2026, a pedido explícito del usuario, junto con el
  // arreglo de "Texas state/Texas rangers" — ver la nota grande de
  // detectarMarcadorDeporteEnTexto() más abajo): el baloncesto
  // universitario todavía NO tiene diccionario ni API conectada en este
  // sistema (no existe 'ncaab' en CONFIG_POR_DEPORTE) — se reconoce igual
  // como IDENTIFICADOR EXPLÍCITO para que, si alguien lo escribe, la
  // jugada quede en SIN_MAPEO (esperando marcador manual/que se conecte
  // la API el día de mañana) en vez de colarse por error como NBA solo
  // porque comparte la palabra "baloncesto"/"basket".
  ncaab: 'ncaab', 'college basketball': 'ncaab', 'ncaa basketball': 'ncaab',
  'baloncesto universitario': 'ncaab', 'baloncesto colegial': 'ncaab',
  auto: null, todos: null // "apagan" el marcador — vuelve a la detección automática
};

// =================================================================
// MARCADOR POR JUGADA (emoji o palabra clave pegada al equipo, 28-08-2026)
// =================================================================
// Además del marcador de SECCIÓN "[NFL]" (arriba), el Grupo puede aclarar
// el deporte de UNA jugada puntual poniendo, antes o después del nombre
// del equipo, un emoji del deporte (ej. "🏈 houston texans -3") o una
// palabra clave junto al equipo (ej. "houston nba" para dejar en claro que
// es basket y no MLB/NFL). A diferencia del marcador de sección, este es
// por-jugada y GANA con más prioridad que cualquier detección automática
// (calendario, tamaño del número) — es la persona diciendo explícitamente
// de qué deporte se trata, así que no hace falta adivinar nada más. Ver
// resolverCandidatoAmbiguo() en evaluador.js para dónde se usa esto.
//
// OJO: esto se tiene que buscar en el texto ORIGINAL de la jugada, ANTES
// de normalizarTexto() (ver normalizar.js) — normalizarTexto le borra a
// propósito los emojis a la jugada (para no confundir al resto del
// parser), así que si se buscara sobre el texto ya normalizado el emoji
// ya no estaría ahí. Las palabras clave, en cambio, funcionan igual antes
// o después de normalizar.
const EMOJI_DEPORTE = {
  '⚾': 'mlb', '🥎': 'mlb',
  '🏈': 'nfl',
  '🏀': 'basket',
  '⚽': 'soccer',
  '🏒': 'nhl'
};

// 13-09-2026 (bug real encontrado implementando el arreglo de "Texas
// state/Texas rangers" del usuario, mientras se agregaban más palabras
// clave de NCAAF/NCAAB): antes este `for` recorría PALABRAS_DEPORTE en el
// orden en que Object.keys() las devuelve — el orden en que se fueron
// agregando al objeto — y devolvía el deporte de la PRIMERA palabra que
// matcheara. Eso es exactamente el mismo bug de fondo que "Inter Miami"
// (06-09-2026) y "Texas state" (12-09-2026), pero acá con PALABRAS de
// marcador en vez de apodos de equipo: "futbol universitario"/"fútbol
// universitario" (agregadas para forzar NCAAF) CONTIENEN la palabra
// completa "futbol"/"fútbol" (agregada mucho antes, para forzar soccer)
// — así que una jugada como "Georgia futbol universitario -7 -110"
// encontraba "futbol" primero y devolvía 'soccer', sin llegar nunca a ver
// "futbol universitario" — forzando el deporte EQUIVOCADO en vez del que
// la persona escribió a propósito para aclarar. Confirmado con una
// prueba directa antes de este arreglo. El arreglo: en vez de confiar en
// el orden de inserción del objeto (fràgil — cualquier palabra nueva mal
// ubicada puede repetir este mismo bug), se ordenan las palabras por
// LARGO (de más larga a más corta) antes de buscar, así una frase más
// específica ("futbol universitario") siempre se prueba antes que la
// palabra corta que contiene ("futbol"), sin importar en qué orden se
// hayan escrito en PALABRAS_DEPORTE.
const PALABRAS_DEPORTE_ORDENADAS_POR_LARGO = Object.keys(PALABRAS_DEPORTE)
  .filter(palabra => palabra !== 'auto' && palabra !== 'todos')
  .sort((a, b) => b.length - a.length);

function detectarMarcadorDeporteEnTexto(textoOriginal) {
  if (!textoOriginal) return null;

  for (const simbolo of Object.keys(EMOJI_DEPORTE)) {
    if (textoOriginal.includes(simbolo)) return EMOJI_DEPORTE[simbolo];
  }

  const textoMin = textoOriginal.toLowerCase();
  for (const palabra of PALABRAS_DEPORTE_ORDENADAS_POR_LARGO) {
    const regex = new RegExp('\\b' + palabra + '\\b', 'i');
    if (regex.test(textoMin)) return PALABRAS_DEPORTE[palabra];
  }

  return null;
}

function parsearSabana(texto, diccionarioEquipos) {
  const lineas = texto.split('\n').map(l => l.trim()).filter(l => l !== '');
  let clienteActual = 'GENERAL';
  let ticketActual = 'Sin Ticket';
  let jugadasTemp = [];
  let gananciaDeseadaTemp = 0;
  let montoStakeTemp = 0;
  // Deporte "forzado" por un marcador de sección opcional en el texto
  // (ver el chequeo de PALABRAS_DEPORTE más abajo) — null si no hay
  // ninguno activo. Una vez activado, se queda así para TODOS los
  // tickets siguientes hasta que aparezca otro marcador (o "[auto]"/
  // "[todos]" para apagarlo), sin importar de qué cliente sean — es
  // pensado para cuando una tanda entera de la sábana es de un solo
  // deporte y hace falta una ayuda extra para desambiguar un apodo que
  // choca entre 2 o más deportes (ver evaluarJugada en evaluador.js).
  let deporteForzadoActual = null;
  const boletos = [];

  function cerrarBoletoColgado() {
    if (jugadasTemp.length === 0) return;

    const gananciaDeseada = gananciaDeseadaTemp || extraerGananciaDeseadaDeJugadas(jugadasTemp);
    const montoStake = montoStakeTemp || extraerMontoStakeDeJugadas(jugadasTemp);
    const jugadasCopia = [...jugadasTemp];
    const detalle = jugadasTemp.join(' | ');

    const normalizadaUnicaPata = jugadasCopia.length === 1 ? normalizarTexto(jugadasCopia[0]) : null;
    const equipoSinLogroCaso1 = normalizadaUnicaPata ? detectarEquipoSinLogro(normalizadaUnicaPata, diccionarioEquipos) : null;
    if (jugadasCopia.length === 1 && gananciaDeseada > 0 && !equipoSinLogroCaso1) {
      const cuota = extraerCuotaAmericana(normalizadaUnicaPata);
      const arriesgoCalculado = (cuota !== null && !isNaN(cuota)) ? calcularArriesgoDesdeGanancia(cuota, gananciaDeseada) : null;
      if (arriesgoCalculado !== null) {
        boletos.push({
          cliente: clienteActual,
          ticket: ticketActual,
          jugadas: jugadasCopia,
          detalleText: detalle,
          arriesga: Math.round(arriesgoCalculado * 100) / 100,
          pagaSabana: gananciaDeseada,
          cierreAutomatico: true,
          cuotaCierreAutomatico: cuota,
          deporteForzado: deporteForzadoActual
        });
        jugadasTemp = [];
        gananciaDeseadaTemp = 0;
        montoStakeTemp = 0;
        return;
      }
    }

    if (montoStake > 0) {
      boletos.push({
        cliente: clienteActual,
        ticket: ticketActual,
        jugadas: jugadasCopia,
        detalleText: detalle,
        arriesga: montoStake,
        pagaSabana: 0,
        deporteForzado: deporteForzadoActual
      });
      jugadasTemp = [];
      gananciaDeseadaTemp = 0;
      montoStakeTemp = 0;
      return;
    }

    boletos.push({
      cliente: clienteActual,
      ticket: ticketActual,
      jugadas: jugadasCopia,
      detalleText: detalle,
      arriesga: 0,
      pagaSabana: 0,
      sinResultadoEnSabana: true,
      deporteForzado: deporteForzadoActual
    });
    jugadasTemp = [];
    gananciaDeseadaTemp = 0;
    montoStakeTemp = 0;
  }

  for (let i = 0; i < lineas.length; i++) {
    const lineaOriginal = lineas[i];
    const lineaLimpia = normalizarComasDecimales(lineaOriginal.replace(/\*/g, '').trim());

    if (!lineaLimpia) continue;

    const soloSimbolos = /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}✅❌⭕]+$/u.test(lineaLimpia);
    // OJO (04-09-2026, formato real del grupo "Bernal"): algunos grupos
    // arrancan su sábana con un banner propio ("*DEPORTES BERNAL
    // VERDURA⚾⚽*") y/o el nombre del día en letras ("*JUEVES*") en vez de
    // una fecha — antes solo se ignoraba el banner EXACTO "deportes
    // zenyatta" (el de este mismo sistema); se generaliza a cualquier
    // línea que arranque con "deportes " (cualquier grupo puede tener su
    // propio nombre después), y se suma la lista de días de la semana, para
    // que ninguna de las 2 quede mal interpretada como si fuera el nombre
    // de un cliente (antes de este arreglo, "*JUEVES*"/el banner hubieran
    // entrado por la rama de encabezado de cliente más abajo).
    const esBannerDeportes = /^deportes\s+/i.test(lineaLimpia);
    const DIAS_SEMANA = ['LUNES', 'MARTES', 'MIERCOLES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'SÁBADO', 'DOMINGO'];
    const esNombreDeDia = DIAS_SEMANA.includes(lineaLimpia.toUpperCase());
    if (soloSimbolos || esBannerDeportes || esNombreDeDia || lineaLimpia.match(/^\d{2}[-/]\d{2}[-/]\d{4}$/)) {
      continue;
    }

    // Marcador de sección opcional: una línea como "[NFL]" (entre
    // corchetes, a propósito, para no confundirse jamás con un nombre de
    // cliente ni con ninguna otra cosa de la sábana) fija el deporte para
    // TODOS los tickets siguientes, hasta el próximo marcador o "[auto]"/
    // "[todos]" para volver a la detección automática. Es la última capa
    // de ayuda para cuando un apodo choca entre 2+ deportes que juegan el
    // mismo día — ver evaluarJugada() en evaluador.js. No hace falta
    // usarlo nunca si no hay ambigüedad real: por defecto cada ticket se
    // sigue identificando solo.
    const matchMarcadorDeporte = lineaLimpia.match(/^\[\s*([a-záéíóúñ ]+?)\s*\]$/i);
    if (matchMarcadorDeporte) {
      const palabra = matchMarcadorDeporte[1].trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(PALABRAS_DEPORTE, palabra)) {
        deporteForzadoActual = PALABRAS_DEPORTE[palabra];
      }
      continue;
    }

    // OJO (04-09-2026, formato real del grupo "Bernal"): "Ticket #1" (con
    // "#" entre la palabra y el número) no matcheaba antes — el "#" no es
    // ni espacio ni dígito, así que el regex viejo lo rechazaba entero y la
    // línea cola colaba en las jugadas del ticket como si fuera parte de
    // una apuesta real (ensuciando el conteo de patas del parley). Se
    // agrega un "#" opcional entre la palabra y el número.
    const matchTicket = lineaLimpia.match(/^tic?ke?ts?\s*#?\s*(\d+)$/i);
    if (matchTicket) {
      cerrarBoletoColgado();
      ticketActual = 'Ticket #' + matchTicket[1];
      continue;
    }

    if (esLineaSoloMonto(lineaLimpia)) {
      const numMonto = lineaLimpia.match(/\d+(?:\.\d+)?/);
      if (numMonto) {
        if (/^para\s+/i.test(lineaLimpia.trim())) {
          gananciaDeseadaTemp = parseFloat(numMonto[0]);
        } else {
          montoStakeTemp = parseFloat(numMonto[0]);
        }
      }
      continue;
    }

    // OJO (04-09-2026, formato real del grupo "Bernal"): "500 para 1121" en
    // su PROPIA línea (arriesgo Y ganancia juntos, sin "//") es distinto de
    // "para $50" a secas (esLineaSoloMonto, arriba — SOLO la ganancia
    // deseada, calcula el arriesgo desde la cuota) y de "-120 para 300"
    // pegado a la jugada (extraerGananciaDeseadaDeJugadas, también calcula
    // el arriesgo desde la cuota): acá el arriesgo YA viene dado, así que
    // se cierra el boleto directo con los 2 números tal cual, igual que
    // "arriesga//paga" un poco más abajo — nunca se calcula desde la cuota.
    const matchArriesgaParaGanancia = lineaLimpia.match(/^\$?(\d+(?:\.\d+)?)\$?\s+para\s+(?:ganar\s+)?\$?(\d+(?:\.\d+)?)\$?$/i);
    if (matchArriesgaParaGanancia) {
      boletos.push({
        cliente: clienteActual,
        ticket: ticketActual,
        jugadas: [...jugadasTemp],
        detalleText: jugadasTemp.join(' | '),
        arriesga: parseFloat(matchArriesgaParaGanancia[1]),
        pagaSabana: parseFloat(matchArriesgaParaGanancia[2]),
        deporteForzado: deporteForzadoActual
      });
      jugadasTemp = [];
      gananciaDeseadaTemp = 0;
      montoStakeTemp = 0;
      ticketActual = 'Sin Ticket';
      continue;
    }

    const esConAsterisco = /^\*+[^*]+\*+$/.test(lineaOriginal) && !/tic?ke?ts?/i.test(lineaLimpia);
    // OJO (02-09-2026, a pedido del usuario): este regex reconoce una línea
    // como "encabezado de cliente" (ej. "PEDRO", "F150") — antes solo
    // matcheaba MAYÚSCULAS (sin flag "i"), así que un cliente escrito en
    // minúscula o mixto ("pedro", "Pedro") NO se reconocía como encabezado:
    // sus jugadas quedaban atribuidas al cliente anterior (o "GENERAL"), con
    // el saldo mal calculado en silencio. clienteActual ya se guarda siempre
    // en MAYÚSCULA más abajo (lineaLimpia.toUpperCase()), así que agregar el
    // flag "i" acá alcanza para que mayúscula/minúscula/mixto den el mismo
    // resultado sin tocar nada más.
    const esTextoCliente = /^[A-ZÁÉÍÓÚÑ0-9\s]{2,20}$/i.test(lineaLimpia) && !/tic?ke?ts?|over|under|alta|baja|para|\/\//i.test(lineaLimpia);

    if (esConAsterisco || esTextoCliente) {
      cerrarBoletoColgado();
      const nombreNuevo = lineaLimpia.toUpperCase();
      // OJO (04-09-2026, formato real del grupo "Bernal"): este grupo NO
      // pone el nombre del cliente ANTES de sus tickets (el único orden que
      // el parser esperaba hasta ahora) sino DESPUÉS, a modo de firma, al
      // final de cada ticket. Si todavía no había aparecido NINGÚN nombre
      // de cliente en esta sábana (clienteActual sigue en "GENERAL", el
      // valor por defecto), los boletos que ya se cerraron bajo "GENERAL"
      // son justamente los que le pertenecen a esta firma — se corrigen acá
      // retroactivamente en vez de perderse bajo "GENERAL". Si el nombre
      // viene ANTES de los tickets (el uso de siempre), esto no hace nada
      // (todavía no hay ningún boleto "GENERAL" que corregir). Una vez que
      // clienteActual deja de ser "GENERAL" la primera vez, este arreglo ya
      // no se vuelve a activar — evita corromper una sábana clásica de
      // varios clientes (donde el nombre del SIGUIENTE cliente jamás debe
      // renombrar los tickets ya cerrados del cliente ANTERIOR).
      if (clienteActual === 'GENERAL') {
        boletos.forEach(b => { if (b.cliente === 'GENERAL') b.cliente = nombreNuevo; });
      }
      clienteActual = nombreNuevo;
      ticketActual = 'Sin Ticket';
      continue;
    }

    // OJO (03-09-2026, ticket real: "100///130✅" con 3 barras en vez de
    // 2): antes exigía EXACTAMENTE "//" — con una barra de más (fácil de
    // tipear sin querer en WhatsApp), el regex solo alcanzaba a comerse 2
    // de las 3 barras y la barra sobrante rompía el resto del match, así
    // que el pago escrito en la sábana (130) se perdía en silencio y el
    // ticket quedaba con pagaSabana=0 (pago "estimado" en vez del real
    // escrito). Ahora acepta "//" o más barras seguidas ("\/\/+").
    const matchResultado = lineaLimpia.match(/([✅❌⭕]?)\s*(?:x\s*|para\s+)?\$?(\d+(?:\.\d+)?)\$?\s*\/\/+\s*\$?(\d+(?:\.\d+)?)?\$?\s*([✅❌⭕]?)/i);

    if (matchResultado) {
      const arriesgaVal = parseFloat(matchResultado[2]);
      const pagaVal = matchResultado[3] ? parseFloat(matchResultado[3]) : 0;
      // Símbolo puesto A MANO en la sábana (✅/❌/⭕, antes o después de
      // "arriesga//paga") indicando que la persona que la mandó ya marcó
      // si esa jugada se ganó/perdió/anuló. NUNCA se usa para decidir el
      // resultado (eso lo sigue haciendo evaluarJugada() contra la API en
      // vivo, como siempre) — se guarda acá solo para que procesarSabana.js
      // pueda comparar ese marcador contra lo que en verdad dio la jugada
      // y avisar en la sábana si alguien marcó mal a mano (03-09-2026, a
      // pedido del usuario: "si mando la sabana con un ticket con el signo
      // de que se dio y tu ves que no se dio corrigelo y notificalo").
      const marcadorManual = matchResultado[1] || matchResultado[4] || null;

      boletos.push({
        cliente: clienteActual,
        ticket: ticketActual,
        jugadas: [...jugadasTemp],
        detalleText: jugadasTemp.join(' | '),
        arriesga: arriesgaVal,
        pagaSabana: pagaVal,
        marcadorManual,
        deporteForzado: deporteForzadoActual
      });

      jugadasTemp = [];
      gananciaDeseadaTemp = 0;
      montoStakeTemp = 0;
      ticketActual = 'Sin Ticket';
    } else {
      const patasDeLaLinea = separarPatas(lineaLimpia);
      // Ver el comentario en separarPatasPorX(): si la línea traía un monto
      // suelto pegado al final ("...X 400"), separarPatas() ya lo sacó de
      // las patas y lo dejó acá, en .montoFinal — se usa como monto
      // arriesgado del boleto (si no hay ya uno puesto por una línea aparte).
      if (patasDeLaLinea.montoFinal !== undefined && montoStakeTemp === 0) {
        montoStakeTemp = patasDeLaLinea.montoFinal;
      }
      patasDeLaLinea.forEach(pata => {
        const esContinuacionDeCuota = /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]*[+-]\d/u.test(pata);
        if (esContinuacionDeCuota && jugadasTemp.length > 0) {
          jugadasTemp[jugadasTemp.length - 1] += ' ' + pata;
        } else {
          // Ver la nota grande junto a pataTieneCuotaYParaPropia() más
          // arriba: si la ÚLTIMA jugada que ya estaba acumulada es, ELLA
          // SOLA, un ticket completo (cuota + "para" monto propios) y
          // ahora llega OTRA pata más sin que nada la haya cerrado en el
          // medio, son 2 (o más) patas SUELTAS que se cierran cada una
          // por su cuenta — no 2 patas de un mismo parley — así que se
          // cierra la anterior antes de sumar esta nueva.
          //
          // OJO: esto se chequea sobre la pata YA acumulada, no sobre la
          // que está por entrar — así se deja intacto el otro caso, ya
          // probado, de una sola pata "cuota para monto" seguida de un
          // "arriesgo//pago" EXPLÍCITO que la cierra (ver
          // test_alertas_integracion.js, caso "HOUSTON NFL"/"Toronto
          // alta"): ahí jugadasTemp queda con esa única pata pendiente,
          // pero nunca llega una pata nueva después — llega la línea de
          // cierre, que la toma por el camino de matchResultado(), sin
          // pasar por acá.
          if (jugadasTemp.length > 0 && pataTieneCuotaYParaPropia(jugadasTemp[jugadasTemp.length - 1])) {
            cerrarBoletoColgado();
          }
          jugadasTemp.push(pata);
        }
      });
    }
  }

  cerrarBoletoColgado();

  return boletos;
}

module.exports = {
  normalizarComasDecimales,
  esLineaSoloMonto,
  extraerGananciaDeseadaDeJugadas,
  extraerMontoStakeDeJugadas,
  cuotaAmericanaADecimal,
  calcularArriesgoDesdeGanancia,
  separarPatasPorX,
  separarPatas,
  detectarEquipoSinLogro,
  extraerCuotaAmericana,
  pataTieneCuotaYParaPropia,
  calcularPagoBrutoParley,
  calcularPagoParley,
  parsearSabana,
  PALABRAS_DEPORTE,
  EMOJI_DEPORTE,
  detectarMarcadorDeporteEnTexto
};
