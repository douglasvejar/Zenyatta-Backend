// =================================================================
// hipismoTerciosAdelantadasCalc.js (04-10-2026, a pedido del usuario)
//
// Motor de cálculo PURO (sin DB, sin rutas) para la nueva pestaña
// "Jugadas entre Tercios Adelantadas" -- jugadas de Tercios normal que
// se pegan ANTES de la carrera y se resuelven automáticamente cuando se
// carga la pizarra de esa carrera (mismo espíritu arquitectónico que
// "Tablas Fijas y Marcas" / hipismoAdelantadasCalc.js, pero con la
// gramática de Tercios en vez de Tablas Fijas/Marcas).
//
// Reusa (nunca reimplementa) el motor de Tercios ya existente en
// hipismoCalc.js: resolverModalidadMultiCaballo/resolverModalidadCompuesta
// (modalidades normales), decimosN (jugadas "a premio"), resolverCruzado
// (el nuevo mecanismo de "cruce" -- caballo(s) del jugador CONTRA
// caballo(s) del banquero -- es matemáticamente el MISMO cálculo que ya
// usa una Marca "AxB" cruzada, solo que acá se aplica también a GRUPOS de
// caballos por lado, comparando la MEJOR posición de cada lado).
//
// -----------------------------------------------------------------
// GRAMÁTICA CONFIRMADA por el usuario (04-10-2026, 3 rondas de preguntas):
//
// Cada línea: <JUGADOR> [verbo opcional, relleno: JUEGA/JUEGO/JUGAR/
// JUGANDO/JUUGAR(typo)/PUEDE] [prefijo decorativo opcional, ej. "2PTS"]
// <especificación de apuesta> [CON] [<monto>] [LO|LOS] DA <BANQUERO>
// [<monto>]
//
// - El jugador SIEMPRE va primero, el banquero después de "DA" -- aunque
//   no diga "juega"/"jugando" ("a pesar de que no diga la palabra juega
//   o juego, el que esta de primero siempre es el que juega").
// - El monto puede ir ANTES de "DA" o DESPUÉS del nombre del banquero
//   (confirmado explícitamente con el ejemplo de "MR INCREIBLE").
// - Especificación de apuesta:
//   * Un solo caballo: "DEL <n>" o un número suelto.
//   * Varios caballos del MISMO lado ("morocha"): separados por coma,
//     guion, "y", O PEGADOS sin separador -- "47" significa los caballos
//     4 y 7 juntos (NO el caballo 47 -- confirmado: "si escriben 47 4-7
//     4y7 4,7 si son dos caballos juntos"). Esto es DISTINTO de Tercios
//     normal (donde un pegado tipo "43" siempre es UN caballo) -- en esta
//     pestaña nueva, un pegado SIN separador se interpreta como dígitos
//     sueltos SOLO cuando el valor de 2 dígitos no es un número de
//     caballo plausible (> 20); así "10" (caballo diez, perfectamente
//     normal) se queda como UN caballo, pero "47"/"78" (ningún hipódromo
//     corre con 47 u 78 caballos) se separan en dígitos sueltos. Esta
//     regla de "plausibilidad" es una inferencia mía para resolver la
//     ambigüedad entre "10X3" (10 contra 3, cada uno UN caballo) y "47 x
//     78" (4y7 contra 7y8, dos caballos por lado) -- reproduce los 2
//     ejemplos reales que dio el usuario, pero no se la hice confirmar
//     explícitamente a él todavía (ver mensaje de cierre).
//   * Cruce ("CONTRA"): "<ladoA> x <ladoB>" -- la "x"/"X" (pegada o con
//     espacios) SIEMPRE significa "contra", nunca separador de grupo
//     ("la X indica que es contra... lo importante es que lo que separa
//     los caballos contra el que va uno o otro es la x").
// - Modalidad:
//   * Si NO se indica ninguna modalidad en una apuesta de grupo (sin
//     cruce), se asume "1p" por defecto ("raul 47 con 400: raul esta
//     jugando 1p del 4 y del 7").
//   * Puede ir ANTES o DESPUÉS de la especificación de caballo(s)
//     ("raul juega 1p 47 con 300" vs "raul puede juugar 47 10a8 con
//     400").
//   * Un prefijo decorativo como "2PTS" antes de la modalidad real se
//     ignora -- la modalidad que cuenta es la que sigue ("2PTS 2Y3" se
//     calcula como "2y3").
//   * En un cruce SIN modalidad adjunta, es "pelo a pelo" -- gana el
//     lado cuyo MEJOR caballo (de los suyos) esté más cerca del primer
//     lugar (acotado a los primeros puestos que traiga la pizarra que
//     arma el operador -- igual que ya hace resolverCruzado/"pp"); si
//     ningún caballo de ningún lado aparece en la pizarra, no se decide.
//   * En un cruce CON décimos adjuntos (ej. "10a8"), se decide la MISMA
//     manera comparativa, pero se paga en fracción décimos: el que gana
//     cobra monto*N/10 menos el % configurado, el que pierde paga el
//     monto COMPLETO; si pierde el jugador, paga completo y el banquero
//     cobra completo menos el %.
// - El % de comisión de esta pestaña es configurable (reemplaza el 5%
//   fijo) y aplica TANTO al cliente que gana COMO a la comisión que se
//   queda el GRUPO -- nunca a las jugadas "a premio SIN comisión" (esa
//   funcionalidad es aparte y no aplica acá en absoluto).
// - Dato faltante (monto, jugador o banquero) NO bloquea el resto del
//   plano -- esa línea específica queda marcada con error (no se
//   descarta, se guarda igual para poder mostrarla en la alerta).
// - Toda jugada que no se decide no genera comisión ni % de devolución
//   para nadie (mismo criterio ya vigente en todo el sistema).
// =================================================================

const {
  resolverModalidadMultiCaballo,
  resolverCruzado,
  decimosN,
  parsearPizarra,
  RANK_NO_COLOCO
} = require('./hipismoCalc');

// -----------------------------------------------------------------
// 04-10-2026, CORRECCIÓN del usuario sobre lo anterior (ver mensaje de
// aclaración + 2 rondas de AskUserQuestion que siguieron): un número
// pegado SIN separador (ej. "47", "78", incluso dentro de un cruce)
// SIEMPRE se lee como el número COMPLETO (caballo cuarenta y siete),
// igual que en el resto del sistema (CABALLO_SRC de hipismoCalc.js).
// Para indicar 2 CABALLOS hace falta un separador explícito: "4y7",
// "4-7", "4.7" o "4/7" (confirmado verbatim: "para que tu sepas que son
// dos caballo deben colcoarte 4y7 o 4-7 o 4.7 o 4/7... si te colcoan 47
// tu lo leeras como el numero cuarenta y siete"). El ejemplo de
// Raul/Hanry ("47 x 78" con pizarra "8-1-3-7-4" -> gana Hanry) en
// realidad llevaba separador y se escribe "4y7 x 7y8" -- el usuario lo
// confirmó al notar la contradicción ("se me fue el separador, era
// 4y7 x 7y8"). El cálculo de cruce de GRUPOS (mejorPosicion() más abajo)
// no cambia -- solo cambia CÓMO se reconoce un grupo de 2+ caballos en
// el texto (siempre con separador explícito, nunca por "plausibilidad").
// -----------------------------------------------------------------

// -----------------------------------------------------------------
// Tokens de relleno / decorativos
// -----------------------------------------------------------------
const FILLER_VERBO_RE = /^(?:JUEGA|JUEGO|JUGAR|JUGANDO|JUUGAR|PUEDE)$/i;
const DECORATIVO_RE = /^\d+PTS$/i;
const DEL_RE = /^DEL$/i;
const LO_LOS_RE = /^(?:LO|LOS)$/i;
const CON_RE = /^CON$/i;
const DA_RE = /^DA$/i;
const X_RE = /^X$/i;

// Separadores válidos entre 2+ caballos de un mismo lado: coma, guion,
// "y", punto o "/" (confirmado 04-10-2026). "y" y "/" también son
// usados por la familia de modalidad "AyB"/"A/B" (ver
// tokenEsModalidadValida() más abajo) -- la ambigüedad se resuelve ahí,
// nunca acá: un token "Ay B" solo se reconoce como modalidad si además
// cumple la regla real de esa familia (B=A o B=A+1); si no la cumple
// (ej. "4y7", "4/7"), nunca puede ser una modalidad válida de todos
// modos, así que es seguro tratarlo como grupo de caballos.
const SEP_CABALLO = '[,y./-]';
// Grupo de caballos SIN cruce: uno o más números separados como arriba
// (nunca "x", que siempre es el separador de cruce, ver CRUCE_PEGADO_RE).
const GRUPO_RE = new RegExp('^\\d{1,2}(?:' + SEP_CABALLO + '\\d{1,2})*$', 'i');
// Cruce "pegado" en un solo token, ej. "2x7", "10X3" (sin espacios
// alrededor de la x). Cada lado puede también traer su propio grupo de
// 2+ caballos con separador, ej. "4y7x7y8".
const CRUCE_PEGADO_RE = new RegExp('^(\\d{1,2}(?:' + SEP_CABALLO + '\\d{1,2})*)x(\\d{1,2}(?:' + SEP_CABALLO + '\\d{1,2})*)$', 'i');
const SEP_CABALLO_SPLIT_RE = new RegExp(SEP_CABALLO, 'i');

function esMontoToken(tok) {
  return /^\d+(?:[.,]\d+)?$/.test(tok);
}

function parseMonto(txt) {
  const n = parseFloat(String(txt).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// tokenEsModalidadValida(): clasifica un token como una modalidad
// REALMENTE válida (misma precedencia que resolverModalidad() en
// hipismoCalc.js: décimos antes que la familia "AyB", porque ambas
// usan "/"). La familia "AyB" ("Y"/"/ ") exige B=A o B=A+1 -- un token
// que no cumpla eso (ej. "4y7", "4/7") NUNCA es una modalidad válida,
// así que queda libre para leerse como grupo de caballos (ver
// SEP_CABALLO arriba).
function tokenEsModalidadValida(tokCrudo) {
  const t = tokCrudo.toLowerCase().trim();
  if (/^\d{1,2}p$/.test(t)) return true;
  if (decimosN(t) !== null) return true;
  if (/^\d{1,2}n(?:ini)?$/.test(t) || /^\d{1,2}nn$/.test(t)) return true;
  if (t === 'pp') return true;
  const mAyB = t.match(/^(\d{1,2})y(\d{1,2})n?$/) || t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (mAyB) {
    const A = parseInt(mAyB[1], 10), B = parseInt(mAyB[2], 10);
    return B === A || B === A + 1;
  }
  return false;
}

// parseCaballosToken(): convierte un token numérico (sin separador "x")
// a la lista de caballos que representa. Si trae separador explícito
// (ver SEP_CABALLO), se parte por ahí SIEMPRE (ej. "10-15" -> [10,15],
// "4y7" -> [4,7]). Si NO trae separador (pegado puro), es SIEMPRE el
// número completo como UN solo caballo (ej. "47" -> [47], "10" -> [10]
// -- corrección 04-10-2026, ver nota grande al principio del archivo).
function parseCaballosToken(tok) {
  const limpio = tok.trim();
  if (SEP_CABALLO_SPLIT_RE.test(limpio)) {
    return limpio.split(SEP_CABALLO_SPLIT_RE).map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
  }
  const n = parseInt(limpio, 10);
  return Number.isFinite(n) ? [n] : [];
}

// mejorPosicion(): la posición (rank) MÁS CHICA (mejor colocado) entre
// una lista de caballos -- RANK_NO_COLOCO si ninguno figura en la
// pizarra. Usada para decidir un cruce de GRUPOS (ej. "47 x 78"): cada
// lado gana o pierde según el MEJOR de sus propios caballos, nunca el
// peor (confirmado con el ejemplo real "8-1-3-7-4" -> gana Hanry porque
// una de sus 2 opciones llegó mejor que las 2 del otro).
function mejorPosicion(caballos, rank) {
  let mejor = RANK_NO_COLOCO;
  for (const h of caballos) {
    const p = rank(h);
    if (p < mejor) mejor = p;
  }
  return mejor;
}

// -----------------------------------------------------------------
// parsearLineaTerciosAdelantada(linea) -> {
//   ok: true,
//   jugadorNombre, banqueroNombre, monto (o null),
//   cruce: null | { gruposA: [...], gruposB: [...] },
//   grupo: null | [...],       // caballos cuando NO es cruce
//   modalidad: 'xxx' | null,   // tal cual vino (minúscula ya normalizada abajo), null si no se indicó
//   errores: { faltaMonto, faltaJugador, faltaBanquero, faltaApuesta }
// } | { ok: false }  -- ok:false para líneas que de plano no parecen
// una jugada (encabezados sueltos, texto libre), para no ensuciar el
// listado de "sin reconocer"/alertas con ruido.
// -----------------------------------------------------------------
function parsearLineaTerciosAdelantada(lineaCruda) {
  const limpia = lineaCruda.replace(/\*/g, '').trim();
  if (!limpia) return { ok: false };

  const tokens = limpia.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { ok: false };

  let i = 0;

  // 1) Nombre del jugador: tokens de solo letras, hasta el primer verbo
  //    de relleno o el primer token que empieza la apuesta (numérico).
  const nombreTokens = [];
  while (i < tokens.length && /^[A-Za-zÁÉÍÓÚÑáéíóúñ]+$/.test(tokens[i]) && !FILLER_VERBO_RE.test(tokens[i])) {
    nombreTokens.push(tokens[i]);
    i++;
  }
  while (i < tokens.length && FILLER_VERBO_RE.test(tokens[i])) i++;
  const jugadorNombre = nombreTokens.join(' ').trim().toUpperCase().replace(/\s+/g, ' ');

  // Si no se consumió NINGÚN token de nombre y lo que sigue tampoco
  // parece una apuesta (ej. un encabezado de categoría suelto como
  // "TERCIOS"), esto no es una línea de jugada -- se descarta sin
  // generar alerta.
  if (!jugadorNombre && !(i < tokens.length && (tokenEsModalidadValida(tokens[i]) || GRUPO_RE.test(tokens[i]) || CRUCE_PEGADO_RE.test(tokens[i]) || DEL_RE.test(tokens[i])))) {
    return { ok: false };
  }

  // 2) Especificación de apuesta: modalidad y/o caballo(s)/cruce, en
  //    cualquier orden, cada uno como máximo una vez.
  let modalidad = null;
  let gruposCruce = null; // { gruposA, gruposB }
  let grupo = null;       // caballos (sin cruce)

  let avanzo = true;
  while (avanzo && i < tokens.length) {
    avanzo = false;
    if (DECORATIVO_RE.test(tokens[i])) { i++; avanzo = true; continue; }
    if (!grupo && !gruposCruce && DEL_RE.test(tokens[i]) && i + 1 < tokens.length && /^\d{1,2}$/.test(tokens[i + 1])) {
      grupo = [parseInt(tokens[i + 1], 10)];
      i += 2; avanzo = true; continue;
    }
    if (!modalidad && tokenEsModalidadValida(tokens[i])) {
      modalidad = tokens[i].toLowerCase().replace(/\s+/g, '');
      i++; avanzo = true; continue;
    }
    if (!grupo && !gruposCruce) {
      if (CRUCE_PEGADO_RE.test(tokens[i])) {
        const m = tokens[i].match(CRUCE_PEGADO_RE);
        gruposCruce = { gruposA: parseCaballosToken(m[1]), gruposB: parseCaballosToken(m[2]) };
        i++; avanzo = true; continue;
      }
      if (GRUPO_RE.test(tokens[i]) && i + 2 < tokens.length && X_RE.test(tokens[i + 1]) && GRUPO_RE.test(tokens[i + 2])) {
        gruposCruce = { gruposA: parseCaballosToken(tokens[i]), gruposB: parseCaballosToken(tokens[i + 2]) };
        i += 3; avanzo = true; continue;
      }
      if (GRUPO_RE.test(tokens[i])) {
        grupo = parseCaballosToken(tokens[i]);
        i++; avanzo = true; continue;
      }
    }
  }

  // 3) Monto ANTES de "DA" (con o sin "CON" por delante).
  let monto = null;
  if (i < tokens.length && CON_RE.test(tokens[i])) i++;
  if (i < tokens.length && esMontoToken(tokens[i])) { monto = parseMonto(tokens[i]); i++; }

  // 4) "LO"/"LOS" (opcional) + "DA" + nombre del banquero.
  while (i < tokens.length && LO_LOS_RE.test(tokens[i])) i++;
  let huboDA = false;
  if (i < tokens.length && DA_RE.test(tokens[i])) { huboDA = true; i++; }

  const banqueroTokens = [];
  while (i < tokens.length && !esMontoToken(tokens[i])) { banqueroTokens.push(tokens[i]); i++; }
  const banqueroNombre = banqueroTokens.join(' ').trim().toUpperCase().replace(/\s+/g, ' ');

  // 5) Monto DESPUÉS del nombre del banquero (si no vino antes).
  if (monto === null && i < tokens.length && esMontoToken(tokens[i])) { monto = parseMonto(tokens[i]); i++; }

  const faltaApuesta = !grupo && !gruposCruce;
  if (!jugadorNombre && faltaApuesta) return { ok: false };

  return {
    ok: true,
    jugadorNombre,
    banqueroNombre,
    monto,
    cruce: gruposCruce,
    grupo,
    modalidad,
    errores: {
      faltaJugador: !jugadorNombre,
      faltaBanquero: !banqueroNombre || !huboDA,
      faltaMonto: monto === null,
      faltaApuesta
    }
  };
}

// -----------------------------------------------------------------
// resolverLineaTerciosAdelantada(linea, rank, pctComision) -> {
//   resultado: { j, b } | null  -- fracción del monto (null si no se
//   pudo resolver, ej. modalidad no reconocida o cruce sin décimos ni
//   "pp" -- siempre cae en "pelo a pelo" por defecto, así que esto solo
//   pasa con una modalidad de grupo desconocida),
//   decidida: true/false  -- false cuando "no se decide" (0,0) o
//   cuando resultado es null,
//   montoJugadorMostrado, montoBanqueroMostrado  -- ya con el %
//   configurado aplicado SOLO a la fracción ganadora (igual criterio
//   que montoMostrado() de siempre, generalizado a un % configurable
//   en vez del 5% fijo),
//   comisionGrupo  -- lo que se queda el grupo por esta jugada (mismo
//   % configurado, 0 si no se decide)
// }
// -----------------------------------------------------------------
function montoMostradoConPct(fraccionMonto, pctComision) {
  return (fraccionMonto > 0) ? fraccionMonto * (1 - pctComision / 100) : fraccionMonto;
}

function resolverLineaTerciosAdelantada(linea, rank, pctComision) {
  const monto = Number(linea.monto) || 0;
  let resultado = null;

  if (linea.cruce) {
    const decimosNVal = linea.modalidad ? decimosN(linea.modalidad) : null;
    const fraccionGanador = (decimosNVal !== null) ? (decimosNVal / 10) : 1;
    const posA = mejorPosicion(linea.cruce.gruposA, rank);
    const posB = mejorPosicion(linea.cruce.gruposB, rank);
    resultado = resolverCruzado(posA, posB, fraccionGanador);
  } else if (linea.grupo) {
    const modalidadUsar = linea.modalidad || '1p';
    resultado = resolverModalidadMultiCaballo(modalidadUsar, linea.grupo, rank);
  }

  if (!resultado) {
    return { resultado: null, decidida: false, montoJugadorMostrado: 0, montoBanqueroMostrado: 0, comisionGrupo: 0 };
  }

  const noSeDecide = resultado.j === 0 && resultado.b === 0;
  if (noSeDecide) {
    return { resultado, decidida: false, montoJugadorMostrado: 0, montoBanqueroMostrado: 0, comisionGrupo: 0 };
  }

  const fraccionJugador = resultado.j * monto;
  const fraccionBanquero = resultado.b * monto;
  const montoJugadorMostrado = montoMostradoConPct(fraccionJugador, pctComision);
  const montoBanqueroMostrado = montoMostradoConPct(fraccionBanquero, pctComision);
  // La comisión del grupo es la diferencia entre la fracción cruda
  // ganadora y lo que de verdad se le mostró/pagó al que ganó (mismo
  // patrón que comisionDeLado() en routes/hipismo.js, generalizado a
  // un % configurable).
  const comisionGrupo = Math.abs(fraccionJugador) - Math.abs(montoJugadorMostrado) + Math.abs(fraccionBanquero) - Math.abs(montoBanqueroMostrado);

  return { resultado, decidida: true, montoJugadorMostrado, montoBanqueroMostrado, comisionGrupo };
}

// -----------------------------------------------------------------
// extraerPctDeTexto(texto) -> número (positivo) o null. Busca una línea
// "NOTA= ... -X%" (o variantes sin el signo) en el plano pegado --
// confirmado: "si el plano indica cuanto es el %, colocamelo
// automatico, sin embargo lo puedo cambiar" (el operador puede
// pisar el valor leído, esto solo da el valor SUGERIDO).
// -----------------------------------------------------------------
function extraerPctDeTexto(texto) {
  const m = (texto || '').match(/nota\s*=?[^\n%]*?(-?\d+(?:[.,]\d+)?)\s*%/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) ? Math.abs(n) : null;
}

// -----------------------------------------------------------------
// extraerHipodromoDeTexto(texto) -> string | null. Busca el encabezado
// "JUGADAS ADELANTADAS <HIPODROMO>" (mismo encabezado que ya usa la
// pestaña de Tablas Fijas/Marcas -- un solo hipódromo por plano
// pegado).
// -----------------------------------------------------------------
function extraerHipodromoDeTexto(texto) {
  const lineas = (texto || '').split('\n');
  for (const l of lineas) {
    const limpia = l.replace(/\*/g, '').trim();
    const m = limpia.match(/jugadas\s+adelantadas\s+(.+)$/i);
    if (m) {
      const hip = m[1].replace(/[^\p{L}\p{N}\s]/gu, '').trim();
      if (hip) return hip;
    }
  }
  return null;
}

const CARRERA_HEADER_RE = /^(\d{1,2})\s*(?:ra|da|ta|va|ma|na)\s+carrera$/i;

// -----------------------------------------------------------------
// parsearPlanoTerciosAdelantadas(texto) -> {
//   hipodromo, pctSugerido, lineas: [{ ...parsearLineaTerciosAdelantada,
//   carreraNumero, lineaOriginal }]
// }
// Agrupa cada línea de jugada bajo el número de carrera del encabezado
// más reciente ("1RA CARRERA", "7MA CARRERA"...) visto antes de ella.
// -----------------------------------------------------------------
function parsearPlanoTerciosAdelantadas(texto) {
  const hipodromo = extraerHipodromoDeTexto(texto);
  const pctSugerido = extraerPctDeTexto(texto);
  const lineasTexto = (texto || '').split('\n');

  const lineas = [];
  let carreraActual = null;
  lineasTexto.forEach(lineaCruda => {
    const limpia = lineaCruda.replace(/\*/g, '').trim();
    if (!limpia) return;
    const mCarrera = limpia.match(CARRERA_HEADER_RE);
    if (mCarrera) { carreraActual = parseInt(mCarrera[1], 10); return; }
    if (/jugadas\s+adelantadas/i.test(limpia)) return; // encabezado de hipódromo, ya extraído arriba
    if (/^nota\s*=/i.test(limpia)) return; // línea de NOTA del %, ya extraída arriba
    if (/^(?:👉|👈|🏇|🇻🇪).*(?:plano|guia|refer)/i.test(limpia)) return; // pie informativo, ruido

    const parsed = parsearLineaTerciosAdelantada(limpia);
    if (!parsed.ok) return;
    lineas.push({ ...parsed, carreraNumero: carreraActual, lineaOriginal: limpia });
  });

  return { hipodromo, pctSugerido, lineas };
}

module.exports = {
  parsearLineaTerciosAdelantada,
  resolverLineaTerciosAdelantada,
  parsearPlanoTerciosAdelantadas,
  extraerPctDeTexto,
  extraerHipodromoDeTexto,
  parseCaballosToken,
  mejorPosicion,
  montoMostradoConPct
};
