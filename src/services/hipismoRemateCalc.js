// =================================================================
// Motor de "Cargar Remate" — Módulo Hipismo (23-09-2026, a pedido del
// usuario, con un formato real de ejemplo):
//
//   *🇻🇪🐴REMATE ADELANTADO ZENYATTA🐴🇻🇪*
//
//   1️⃣- *INVADER* 150$ *MUJICA*
//   2️⃣- *MUFASA* 40$ *JUNKO*
//   ...
//   *CIERRA DOMINGO 12.30*
//   *PAGANDO  500$*
//   *PONLES DE 20 HASTA 100* ...
//
// Un remate es un pozo aparte de los Tercios normales: cada cliente le
// apuesta a UN caballo puntual (identificado por su número de ejemplar,
// el mismo que usa la pizarra real de la carrera). Si ESE número gana la
// carrera, ese cliente se gana el pozo completo (pool_total) menos la
// comisión de la casa — salvo que eso no alcance para cubrir lo que dice
// "PAGANDO/GARANTIZA/PAGA $X", en cuyo caso se le paga esa garantía
// completa. Si el número ganador de la carrera NO fue jugado por nadie
// en el remate, "queda para la banca": todos pierden lo apostado, sin
// sacar ningún % (ver la nota grande en sql/schema.sql).
//
// "vamos con este [formato], mas adelante te enviare otros" — el usuario
// avisó que este es el primero de varios formatos de remate; el parser
// de líneas (parsearRemate) es la única parte pensada para poder crecer
// con formatos nuevos sin tocar el resto (cálculo, mensaje, guardado).
// =================================================================
const { formatNombre, formatMontoTabla } = require('./hipismoCalc');

// Emoji "keycap" de WhatsApp para 1-9 (dígito + variation selector +
// combining enclosing keycap) y el emoji único de 🔟 para el 10 — son los
// números que usa el formato de ejemplo del usuario para enumerar cada
// caballo del remate.
const DIEZ_EMOJI = '\u{1F51F}';
const KEYCAP_DIGIT = /^(\d)️?⃣/;

function extraerNumeroEjemplar(lineaCruda) {
  let resto = lineaCruda;
  if (resto.startsWith(DIEZ_EMOJI)) {
    return { numero: 10, resto: resto.slice(DIEZ_EMOJI.length) };
  }
  let digitos = '';
  let m;
  while ((m = resto.match(KEYCAP_DIGIT))) {
    digitos += m[1];
    resto = resto.slice(m[0].length);
  }
  if (digitos) return { numero: parseInt(digitos, 10), resto };
  // Formato de respaldo, por si un remate futuro numera con "12-"/"12."
  // en vez de emojis — no hace falta todavía para el formato de hoy.
  m = resto.match(/^(\d{1,2})[.\-)]/);
  if (m) return { numero: parseInt(m[1], 10), resto: resto.slice(m[0].length) };
  return null;
}

// PAGANDO/PAGA $X vs GARANTIZA $X (26-09-2026, a pedido del usuario:
// "REMATE PAGA" y "REMATE GARANTIZA" — ver la nota grande de
// calcularRemate más abajo). Hasta la ronda anterior, el usuario había
// aclarado que las 3 palabras eran sinónimos de una misma "garantía"
// (piso + %) — ahora pide separar 2 modos con significados distintos:
// PAGANDO/PAGA describe un monto YA DECIDIDO que el remate paga tal cual
// (sin ningún % de por medio) -> "REMATE PAGA"; GARANTIZA describe un
// piso mínimo que se combina con el % de comisión de siempre -> "REMATE
// GARANTIZA". Nunca vienen los 2 a la vez en el mismo texto.
function extraerPagoOGarantia(textoLimpio) {
  let m = textoLimpio.match(/GARANTIZA\b[^\d]*?(\d+(?:[.,]\d+)?)\s*\$/i);
  if (m) return { pagoFijo: null, garantia: parseFloat(m[1].replace(',', '.')) };
  // Se busca "PAGANDO" antes de "PAGA" a secas para no cortar la palabra
  // a la mitad (PAGANDO también empieza con esas letras).
  m = textoLimpio.match(/PAGANDO\b[^\d]*?(\d+(?:[.,]\d+)?)\s*\$/i);
  if (m) return { pagoFijo: parseFloat(m[1].replace(',', '.')), garantia: null };
  m = textoLimpio.match(/\bPAGA\b[^\d]*?(\d+(?:[.,]\d+)?)\s*\$/i);
  if (m) return { pagoFijo: parseFloat(m[1].replace(',', '.')), garantia: null };
  return { pagoFijo: null, garantia: null };
}

// parsearRemate(texto) -> { apuestas: [{numeroEjemplar, caballo, cliente,
// monto}], garantia: number|null, sinReconocer: [líneas que parecían
// numeradas pero no se pudieron leer del todo] }
function parsearRemate(textoOriginal) {
  const textoLimpio = (textoOriginal || '').replace(/\*/g, '');
  const lineas = textoLimpio.split(/\r?\n/);
  const apuestas = [];
  const sinReconocer = [];

  lineas.forEach(lineaCruda => {
    const linea = lineaCruda.trim();
    if (!linea) return;
    const extraido = extraerNumeroEjemplar(linea);
    if (!extraido) return; // no es una línea de apuesta (encabezado, "CIERRA...", "PAGANDO...", etc.)

    let resto = extraido.resto.replace(/^[\s\-.):]+/, '').trim();
    const mMonto = resto.match(/(\d+(?:[.,]\d+)?)\s*\$/);
    if (!mMonto) { sinReconocer.push(linea); return; }

    const caballo = resto.slice(0, mMonto.index).trim();
    const cliente = resto.slice(mMonto.index + mMonto[0].length).trim().toUpperCase();
    const monto = parseFloat(mMonto[1].replace(',', '.'));
    if (!caballo || !cliente || !isFinite(monto)) { sinReconocer.push(linea); return; }

    apuestas.push({ numeroEjemplar: extraido.numero, caballo, cliente, monto });
  });

  const { pagoFijo, garantia } = extraerPagoOGarantia(textoLimpio);
  return { apuestas, pagoFijo, garantia, sinReconocer };
}

// Primer número de la pizarra (posición 1 = quién ganó la carrera) —
// mismo formato/separadores que ya usa hipismoCalc.js (parsearPizarra),
// ej. "6.10.4.8.2" -> 6. Acá solo hace falta el primer lugar, no el
// ranking completo de cada caballo.
function primerNumeroPizarra(pizarraTxt) {
  const tokens = (pizarraTxt || '').split(/[^0-9]+/).filter(Boolean);
  return tokens.length ? parseInt(tokens[0], 10) : null;
}

// calcularRemate({ apuestas, garantia, pagoFijo, comisionPorcentaje,
// numeroGanador }) -> { poolTotal, hayGanador, pagoGanador, resultadoRemate,
// advertenciaGarantiaNoAlcanza, apuestaGanadora, totalesPorCliente:
// [{cliente, neto}] ordenados alfabéticamente }
//
// 3 modos posibles, nunca combinados (26-09-2026, a pedido del usuario —
// ver la nota grande de extraerPagoOGarantia arriba):
//   1) "REMATE PAGA" (pagoFijo puesto): el remate paga EXACTAMENTE
//      pagoFijo al ganador, sin tocar ningún % — toda la diferencia
//      contra el pool (a favor o en contra) es resultadoRemate.
//   2) "REMATE GARANTIZA" (garantia puesta, con comisionPorcentaje): se
//      cobra el % de siempre sobre el pool, pero nunca se paga MENOS que
//      la garantía — si el % calculado no alcanza la garantía, se paga
//      la garantía completa igual (el usuario: "si no se llega a lo que
//      se garantizó, paga lo que se garantizó... y el negativo restante
//      para llegar a lo que se garantizó [va] en el ítem remate").
//   3) Ni pagoFijo ni garantia: el % de comisionPorcentaje se aplica
//      siempre, sin ningún piso (comportamiento de siempre cuando no hay
//      garantía).
//
// IMPORTANTE (26-09-2026, a pedido del usuario: "esos 2000 negativos
// deben salir en un ítem en balance como si fuera otro cliente llamado
// REMATE... ese 20% que es la ganancia de la casa ESO TAMBIEN VA EN EL
// ITEM DE REMATE"): resultadoRemate YA NO es "comisión" en ningún modo —
// es el resultado (ganancia o pérdida) de este remate puntual. Quien lo
// usa (GET /cierre-final) lo muestra como su propio ítem "REMATE" en los
// balances, nunca sumado a la comisión de Tercios/Adelantadas.
function calcularRemate({ apuestas, garantia, pagoFijo, comisionPorcentaje, numeroGanador }) {
  const poolTotal = apuestas.reduce((acc, a) => acc + a.monto, 0);
  const hayGanador = apuestas.some(a => a.numeroEjemplar === numeroGanador);

  let pagoGanador = 0;
  let resultadoRemate;
  let advertenciaGarantiaNoAlcanza = false;
  if (hayGanador) {
    if (pagoFijo != null) {
      // "REMATE PAGA": monto fijo y manual, sin ningún % de por medio.
      pagoGanador = Number(pagoFijo);
    } else {
      const potencial = poolTotal * (1 - (Number(comisionPorcentaje) || 0) / 100);
      const garantiaNum = garantia != null ? Number(garantia) : 0;
      pagoGanador = Math.max(potencial, garantiaNum);
      // Ni vendiendo el pool COMPLETO (0% de comisión) alcanza para
      // cubrir la garantía — a pedido del usuario, avisar de esto en vez
      // de solo restarlo en silencio ("si le quito X cantidad de % no da
      // para pagar el premio garantizado, indicame en un mensaje").
      if (garantiaNum > poolTotal) advertenciaGarantiaNoAlcanza = true;
    }
    resultadoRemate = poolTotal - pagoGanador;
  } else {
    // "Quedó para la banca" (23-09-2026, confirmado con el usuario): el
    // caballo ganador de la carrera no fue jugado por nadie en este
    // remate -> todos pierden lo apostado, no se paga nada (ni pagoFijo
    // ni garantia aplican si no hubo ganador) — el pool completo queda
    // como resultado a favor.
    pagoGanador = 0;
    resultadoRemate = poolTotal;
  }

  const porCliente = new Map();
  apuestas.forEach(a => {
    const esGanadora = hayGanador && a.numeroEjemplar === numeroGanador;
    const neto = esGanadora ? (pagoGanador - a.monto) : -a.monto;
    porCliente.set(a.cliente, (porCliente.get(a.cliente) || 0) + neto);
  });
  const totalesPorCliente = Array.from(porCliente.entries())
    .map(([cliente, neto]) => ({ cliente, neto }))
    .sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'));

  const apuestaGanadora = hayGanador ? apuestas.find(a => a.numeroEjemplar === numeroGanador) : null;

  return { poolTotal, hayGanador, pagoGanador, resultadoRemate, advertenciaGarantiaNoAlcanza, apuestaGanadora, totalesPorCliente };
}

function keycapEmoji(n) {
  if (n === 10) return DIEZ_EMOJI;
  if (n >= 1 && n <= 9) return `${n}️⃣`;
  return `${n}.`;
}

// Arma el mensaje final para copiar a WhatsApp: el remate devuelto con
// ✅💰 en la línea ganadora, el aviso de felicitación (o de "quedó para
// la banca" si nadie jugó el número ganador) y la lista de TOTALES por
// cliente — formato exacto pedido por el usuario, 23-09-2026.
function armarTextoResultadoRemate({ nombreGrupo, hipodromoNombre, carreraNumero, pizarra, apuestas, garantia, pagoFijo, numeroGanador, resultado }) {
  const { hayGanador, pagoGanador, apuestaGanadora, totalesPorCliente } = resultado;

  const encabezado = `*🇻🇪🐴REMATE ${(nombreGrupo || '').toUpperCase()}🐴🇻🇪*\n${hipodromoNombre}, ${carreraNumero}ta Carrera\nLlegada: ${pizarra}`;

  const lineas = apuestas.map(a => {
    const esGanadora = hayGanador && a.numeroEjemplar === numeroGanador;
    const marca = esGanadora ? ' ✅💰' : '';
    return `${keycapEmoji(a.numeroEjemplar)}- *${a.caballo}* ${formatMontoTabla(a.monto)}$ *${formatNombre(a.cliente)}*${marca}`;
  });

  // 26-09-2026: el texto que ve el cliente solo dice CUÁNTO se paga —
  // nunca revela si es "REMATE PAGA" (monto fijo) o "REMATE GARANTIZA"
  // (piso + %), ni el % de comisión, ni el resultado del remate (a
  // pedido del usuario: "eso de si el remate pierde o gana... no me lo
  // des en el plano... me lo llevas a la parte administrativa").
  const lineaGarantia = pagoFijo != null
    ? `*PAGANDO ${formatMontoTabla(pagoFijo)}$*`
    : (garantia != null ? `*GARANTIZA ${formatMontoTabla(garantia)}$*` : '');

  let bloqueFelicitacion;
  if (hayGanador) {
    bloqueFelicitacion =
      `✅💰 *FELICITAMOS AL GANADOR DE NUESTRO REMATE DE LA ${carreraNumero}TA CARRERA, EN EL HIPODROMO ${(hipodromoNombre || '').toUpperCase()}, ${formatNombre(apuestaGanadora.cliente)}* 💰💰💰`;
  } else {
    bloqueFelicitacion =
      `⚠️ El número ${numeroGanador} (ganador de la carrera) no fue jugado en este remate — quedó todo para la banca.`;
  }

  const lineasTotales = totalesPorCliente.map(t =>
    `${formatNombre(t.cliente)} ${t.neto >= 0 ? '+' : '-'}${formatMontoTabla(t.neto)}`
  );

  return [
    encabezado,
    '',
    ...lineas,
    lineaGarantia,
    '',
    bloqueFelicitacion,
    '',
    'TOTALES:',
    ...lineasTotales
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

module.exports = {
  parsearRemate,
  primerNumeroPizarra,
  calcularRemate,
  armarTextoResultadoRemate
};
