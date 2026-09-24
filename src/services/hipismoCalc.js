// =================================================================
// Motor de cálculo de "Cargar Planos" — Módulo Hipismo (22-09-2026).
// =================================================================
// Puerto EXACTO, línea por línea, del motor que ya vivía sólo en el
// navegador (public/hipismo-mockup.html, funciones resolverModalidad()/
// calcularPlano()) — esas reglas ya están verificadas contra los
// ejemplos reales del usuario (ver claude/spec-modulo-hipismo.md,
// secciones 6, 7 y 8, que viven en el Proyecto "DEPORTES", no en este
// repo). Se movió acá para que el backend sea la fuente de verdad (a
// pedido del usuario: "conecta el modulo real al backend") y el plano
// quede guardado de verdad en vez de solo calculado en memoria del
// navegador — pero el ALGORITMO no cambió ni un poco a propósito, para
// no arriesgar resultados ya confirmados con el usuario.
//
// Modalidades soportadas hoy (las mismas que ya reconocía el mockup):
//   - "N puestos": 1p..10p (gana completo -5% si coloca entre las
//     primeras N posiciones, si no pierde completo)
//   - "1/2" (o "1y2"): gana completo -5% si 1ro; pierde la MITAD (el
//     banquero gana esa mitad -5%) si 2do; pierde completo si peor.
//   - "2n"/"2nini", "3n"/"3nn": gana completo -5% en las posiciones
//     anteriores a N, "no se decide" (0 y 0) en la posición N, pierde
//     completo de ahí en adelante.
//   - "2y2" (o "2/2", "2p/2n", "2py2n" — alias confirmados por el usuario
//     el 24-09-2026, mismo patrón que "1/2"≡"1y2": ver
//     claude/spec-modulo-hipismo.md sección 6, familia "AP/BN" donde
//     A===B): gana completo -5% si 1ro, gana LA MITAD -5% si 2do, pierde
//     completo si peor.
//   - "2y3" (o "2/3", "2p/3n" — alias confirmado por el usuario el
//     24-09-2026, mismo patrón, familia "AP/BN" donde B=A+1): gana
//     completo -5% en 1ro y 2do, pierde la mitad (banquero gana esa mitad
//     -5%) si 3ro, pierde completo si peor.
//   - "pp (AxB)": cruzado — gana completo -5% quien de los 2 caballos
//     llegue mejor colocado entre sí (si hay empate/ninguno colocó,
//     gana el banquero — mismo criterio que ya tenía el mockup, ver
//     resolverModalidad('pp', ...) ahí).
//   - "10/N" o "10aN" (décimos, spec sección 8 — formato de línea
//     todavía no confirmado del todo con el usuario, se soporta igual
//     porque la regla de pago SÍ está confirmada): paga N/10 del monto
//     -5% si el caballo gana (llega 1ro), pierde completo si no.
// =================================================================

// Devuelve {j, b} como FRACCIÓN del monto (antes de comisión), desde la
// perspectiva del jugador (j) y del banquero (b) — siempre espejados
// (j === -b) salvo en un "no se decide" (0, 0).
function resolverModalidad(modalidadCruda, pos, posB) {
  const modalidad = modalidadCruda.toLowerCase().trim();

  // familia "N puestos": 1p, 2p, 3p ... 10p
  let m = modalidad.match(/^(\d{1,2})p$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return (pos <= n) ? { j: 1, b: -1 } : { j: -1, b: 1 };
  }

  if (modalidad === '1/2' || modalidad === '1y2') {
    if (pos === 1) return { j: 1, b: -1 };
    if (pos === 2) return { j: -0.5, b: 0.5 };
    return { j: -1, b: 1 };
  }
  if (modalidad === '2n' || modalidad === '2nini') {
    if (pos === 1) return { j: 1, b: -1 };
    if (pos === 2) return { j: 0, b: 0 };
    return { j: -1, b: 1 };
  }
  if (modalidad === '3n' || modalidad === '3nn') {
    if (pos === 1) return { j: 1, b: -1 };
    if (pos === 2) return { j: 1, b: -1 };
    if (pos === 3) return { j: 0, b: 0 };
    return { j: -1, b: 1 };
  }
  // "2/2" es alias de "2y2" (confirmado por el usuario 24-09-2026: "2/2 ES
  // IGUAL A 2PY2N O 2P/2N" — mismo patrón ya establecido para "1/2"≡"1y2").
  if (modalidad === '2y2' || modalidad === '2/2') {
    if (pos === 1) return { j: 1, b: -1 };
    if (pos === 2) return { j: 0.5, b: -0.5 };
    return { j: -1, b: 1 };
  }
  // "2/3" es alias de "2y3" (confirmado por el usuario 24-09-2026: "2/3 ES
  // IGUAL A 2P/3N").
  if (modalidad === '2y3' || modalidad === '2/3') {
    if (pos === 1) return { j: 1, b: -1 };
    if (pos === 2) return { j: 1, b: -1 };
    if (pos === 3) return { j: -0.5, b: 0.5 };
    return { j: -1, b: 1 };
  }
  if (modalidad === 'pp') {
    // pos = ranking del caballo A, posB = ranking del caballo B — gana
    // quien tenga el número MENOR (mejor colocado). Empate/ninguno
    // colocó (ambos en 99) -> gana el banquero, mismo criterio que ya
    // tenía el mockup (caso no confirmado explícitamente con el
    // usuario, documentado como tal en claude/spec-modulo-hipismo.md).
    return (pos < posB) ? { j: 1, b: -1 } : { j: -1, b: 1 };
  }
  // "10/N" o "10aN" (décimos, spec sección 8) — experimental, formato de
  // línea pendiente de confirmar con el usuario.
  m = modalidad.match(/^10[/a](\d+(?:\.\d+)?)$/);
  if (m) {
    const frac = parseFloat(m[1]) / 10;
    if (pos === 1) return { j: frac, b: -frac };
    return { j: -1, b: 1 };
  }
  return null; // modalidad no reconocida
}

// (?:\s+del)? (24-09-2026): tolera la palabra suelta "del" entre la
// modalidad y el paréntesis del caballo — el ejemplo real que mandó el
// usuario trae una línea así ("Juega Pedrito 2/2 del (8) con 4.000,00 da
// Tykhe"), mismo criterio ya usado en otras partes del sistema (ej. "3TF
// DEL 3 A 25" en Jugadas Adelantadas) donde "del" es puro relleno del
// lenguaje hablado, sin significado para el cálculo.
const LINEA_REGEX = /^juega\s+(\S+)\s+(\d{1,2}p|1\/2|1y2|2n|2nini|3n|3nn|2y2|2y3|2\/2|2\/3|pp|10[/a]\d+(?:\.\d+)?)(?:\s+del)?\s*\(([^)]+)\)\s*con\s+([\d.,]+)\s*da\s+(\S+)/i;

// Monto tal cual se MUESTRA en el texto de cada línea: ya con el 5%
// descontado si es una ganancia (spec sección 6), independiente de si el
// grupo cruza jugadas — el cruce (sección 7) solo cambia el TOTAL por
// persona al final, no cada línea individual.
function montoMostrado(fraccionMonto) {
  return fraccionMonto > 0 ? fraccionMonto * 0.95 : fraccionMonto;
}

function formatNombre(nombre) {
  const n = nombre.toString().trim().toLowerCase();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function formatMontoTabla(n) {
  return Math.abs(n).toFixed(2).replace('.', ',');
}

function parsearPizarra(pizarraTxt) {
  const posiciones = {};
  (pizarraTxt || '').split(/[^0-9]+/).filter(Boolean).forEach((h, i) => { posiciones[parseInt(h, 10)] = i + 1; });
  return h => (posiciones[h] !== undefined ? posiciones[h] : 99);
}

// ordinalCarrera(n) -> "1ra", "2da", "3ra", "4ta"..."7ma", "8va", "9na",
// "10ma", "11ma"... (24-09-2026, a pedido del usuario, que pegó un plano
// real con "La Rinconada, 11ma Carrera" como ejemplo del encabezado
// configurado). ANTES esto estaba mal: armarTextoResultado() le pegaba
// "ta" a CUALQUIER número ("11ta Carrera" en vez de "11ma Carrera") — acá
// se arregla con el sufijo correcto en español para 1-9, y "ma" del 10 en
// adelante (10ma, 11ma, 12ma...), que es exactamente lo que confirmó el
// ejemplo del usuario.
const SUFIJOS_ORDINALES = { 1: 'ra', 2: 'da', 3: 'ra', 4: 'ta', 5: 'ta', 6: 'ta', 7: 'ma', 8: 'va', 9: 'na' };
function ordinalCarrera(n) {
  const num = parseInt(n, 10);
  if (!Number.isFinite(num)) return `${n || ''}`;
  return num + (SUFIJOS_ORDINALES[num] || 'ma');
}

// =================================================================
// limpiarEncabezadoYPie() (24-09-2026, a pedido del usuario: pegó un
// plano REAL ya armado con encabezado ("🇻🇪🏇🏟️ZENYATTA🏟️🏇🇻🇪", hipódromo +
// carrera, "Ret:", "Pizarra:", "*TERCIOS*") y pie ("*PLANO REFERENCIAL*"
// completo) y pidió: "debes leerlo y calcularlo, si el encabezado o el
// pie cambia no importa, lo que te importa es que leas y me des de
// vuelta las jugadas con el encabezado y el pie que te configuro". O
// sea: el encabezado/pie que venga PEGADO en el texto es ruido — puede
// variar, no importa su contenido exacto — hay que descartarlo y usar
// SIEMPRE el que arma armarTextoResultado() (con el nombre del grupo,
// hipódromo, carrera, Ret y Pizarra que el operador ya eligió en el
// formulario de arriba, no lo que diga el texto pegado).
//
// Sin este filtro, si el operador pega el mensaje COMPLETO (como en su
// ejemplo, con encabezado y pie incluidos), esas líneas no calzan con
// LINEA_REGEX y quedaban pasando "tal cual" a salidaLineas (mismo
// criterio que cualquier línea no reconocida, para no perder categorías
// como "TERCIOS" escritas a mano) — el resultado final quedaba con el
// encabezado/pie DUPLICADO (una vez el que arma armarTextoResultado(),
// y otra vez el que venía pegado, colado en el medio del texto).
//
// Estrategia (tolerante a que el texto varíe, como pidió el usuario): se
// usan 2 anclas ESTABLES en vez de tratar de matchear el texto exacto —
// "Pizarra:" para saber dónde termina el encabezado, y "PLANO
// REFERENCIAL" para saber dónde empieza el pie. Todo lo que esté ANTES
// de "Pizarra:" (si aparece entre las primeras 8 líneas) y todo lo que
// esté DESDE "PLANO REFERENCIAL" hasta el final se descarta, junto con
// las líneas en blanco/rayas separadoras y un "*TERCIOS*" suelto que
// hayan quedado pegados justo después del ancla del encabezado (el
// propio armarTextoResultado() ya agrega su propio "*TERCIOS*"). Si el
// texto pegado NO trae ninguna de las 2 anclas (el caso de siempre: el
// operador pega solo las líneas "Juega..."), no se toca nada — el
// comportamiento de antes queda exactamente igual.
function limpiarEncabezadoYPie(texto) {
  if (!texto) return texto || '';
  const lineas = texto.split('\n');

  let inicio = 0;
  for (let i = 0; i < Math.min(lineas.length, 8); i++) {
    if (/^\s*pizarra\s*:/i.test(lineas[i])) { inicio = i + 1; break; }
  }
  while (inicio < lineas.length) {
    const l = lineas[inicio].replace(/\*/g, '').trim();
    if (l === '' || /^-{3,}$/.test(l) || /^tercios$/i.test(l)) { inicio++; } else break;
  }

  let fin = lineas.length;
  for (let i = inicio; i < lineas.length; i++) {
    if (/plano\s+referencial/i.test(lineas[i])) { fin = i; break; }
  }
  while (fin > inicio) {
    const l = lineas[fin - 1].replace(/\*/g, '').trim();
    if (l === '' || /^-{3,}$/.test(l)) fin--; else break;
  }

  return lineas.slice(inicio, fin).join('\n');
}

// calcularPlano({ texto, pizarra, cruzar }) -> {
//   ok, error, huboLineas, salidaLineas: [texto por línea, para armar el
//   bloque de jugadas resuelto], sinReconocer: [líneas que no calzaron
//   con ninguna modalidad conocida], tickets: [{ clienteNombre,
//   banqueroNombre, modalidad, caballo, monto, resultadoJugador,
//   resultadoBanquero }] (una fila por línea reconocida, para guardar en
//   hipismo_tickets), totalesFinales: { nombre: montoFinal, ... },
//   comisionTotal
// }
function calcularPlano({ texto, pizarra, cruzar }) {
  const rank = parsearPizarra(pizarra);
  // 24-09-2026: se descarta el encabezado/pie que venga pegado en el
  // texto (ver la nota grande de limpiarEncabezadoYPie más arriba) ANTES
  // de partirlo en líneas — así, si el operador pega el plano completo
  // (con "🇻🇪🏇🏟️ZENYATTA..." y "PLANO REFERENCIAL" incluidos), esas líneas
  // nunca llegan a salidaLineas ni se duplican con el encabezado/pie que
  // arma armarTextoResultado() más abajo.
  const lineas = limpiarEncabezadoYPie(texto || '').split('\n');

  const rawPorNombre = {};
  const add = (nombre, monto) => { rawPorNombre[nombre] = (rawPorNombre[nombre] || 0) + monto; };

  const salidaLineas = [];
  const sinReconocer = [];
  const tickets = [];
  let huboLineas = false;

  lineas.forEach(linea => {
    const limpia = linea.replace(/\*/g, '').trim();
    if (!limpia) { salidaLineas.push(''); return; }
    const mm = limpia.match(LINEA_REGEX);
    if (!mm) {
      // Encabezados de categoría (ej. "TERCIOS") u otras líneas se dejan
      // igual — solo se marca como "sin reconocer" si de verdad parece
      // una jugada mal escrita (contiene "Juega" pero no calzó el formato).
      salidaLineas.push(limpia);
      if (/juega/i.test(limpia)) sinReconocer.push(limpia);
      return;
    }
    huboLineas = true;
    const [, jugadorCrudo, modalidad, caballoTxt, montoTxt, bancoCrudo] = mm;
    const monto = parseFloat(montoTxt.replace(/\./g, '').replace(',', '.'));
    // Nombre CANÓNICO en MAYÚSCULA (22-09-2026, a pedido del usuario: "si
    // esta escrito en mayusuculas o minuscula no afecta contal se lea lo
    // mismo es igual") — mismo criterio que ya usa Deportes (ver
    // clienteActual.toUpperCase() en services/parser.js y
    // editarTicket() en services/historial.js): así "Mujica", "MUJICA" y
    // "mujica" en distintos planos son SIEMPRE el mismo cliente, nunca 3
    // clientes separados por un tipeo distinto. formatNombre() más abajo
    // sigue siendo la única que decide cómo se VE (Primera mayúscula) en
    // el texto que se copia a WhatsApp — esto es la clave interna.
    const jugador = jugadorCrudo.trim().toUpperCase();
    const banco = bancoCrudo.trim().toUpperCase();

    let resultado, caballoGuardado = caballoTxt.trim();
    if (modalidad.toLowerCase() === 'pp') {
      const [hA, hB] = caballoTxt.split(/x/i).map(h => parseInt(h.trim(), 10));
      resultado = resolverModalidad('pp', rank(hA), rank(hB));
      const jRaw = resultado.j * monto, bRaw = resultado.b * monto;
      add(jugador, jRaw); add(banco, bRaw);
      const jMostrado = montoMostrado(jRaw), bMostrado = montoMostrado(bRaw);
      salidaLineas.push(`pp (${hA}x${hB}) con ${montoTxt}`);
      salidaLineas.push(`(${hA}) ${formatNombre(jugador)} $ ${jMostrado >= 0 ? '+' : '-'}${formatMontoTabla(jMostrado)}`);
      salidaLineas.push(`(${hB}) ${formatNombre(banco)} $ ${bMostrado >= 0 ? '+' : '-'}${formatMontoTabla(bMostrado)}`);
      salidaLineas.push('');
      tickets.push({ clienteNombre: jugador, banqueroNombre: banco, modalidad: 'pp', caballo: caballoGuardado, monto, resultadoJugador: jMostrado, resultadoBanquero: bMostrado });
      return;
    }

    const caballo = parseInt(caballoTxt.trim(), 10);
    resultado = resolverModalidad(modalidad, rank(caballo));
    if (!resultado) { sinReconocer.push(limpia); salidaLineas.push(limpia); return; }
    const jRaw = resultado.j * monto, bRaw = resultado.b * monto;
    add(jugador, jRaw); add(banco, bRaw);
    const jMostrado = montoMostrado(jRaw), bMostrado = montoMostrado(bRaw);
    salidaLineas.push(`${modalidad} (${caballo}) con ${montoTxt}`);
    salidaLineas.push(`Juega ${formatNombre(jugador)} $ ${jMostrado >= 0 ? '+' : '-'}${formatMontoTabla(jMostrado)}`);
    salidaLineas.push(`Consigue ${formatNombre(banco)} $ ${bMostrado >= 0 ? '+' : '-'}${formatMontoTabla(bMostrado)}`);
    salidaLineas.push('');
    tickets.push({ clienteNombre: jugador, banqueroNombre: banco, modalidad, caballo: caballoGuardado, monto, resultadoJugador: jMostrado, resultadoBanquero: bMostrado });
  });

  const totalesFinales = {};
  let comisionTotal = 0;

  if (cruzar) {
    Object.keys(rawPorNombre).forEach(nombre => {
      const raw = rawPorNombre[nombre];
      if (raw > 0) {
        totalesFinales[nombre] = raw * 0.95;
        comisionTotal += raw * 0.05;
      } else {
        totalesFinales[nombre] = raw;
      }
    });
  } else {
    Object.keys(rawPorNombre).forEach(nombre => { totalesFinales[nombre] = 0; });
    tickets.forEach(t => {
      [[t.clienteNombre, t.resultadoJugador], [t.banqueroNombre, t.resultadoBanquero]].forEach(([nombre, montoMostradoLinea]) => {
        // resultadoJugador/resultadoBanquero YA vienen con el 5%
        // aplicado si ganaron esa línea (montoMostrado) — acá solo se
        // suman, no se les vuelve a aplicar comisión.
        totalesFinales[nombre] += montoMostradoLinea;
      });
    });
    // La comisión total "sin cruzar" es la suma de lo efectivamente
    // descontado línea por línea (spec sección 6): por cada línea, el
    // lado que ganó pagó 5% sobre su bruto.
    tickets.forEach(t => {
      const jRawGanador = t.resultadoJugador > 0 ? t.resultadoJugador / 0.95 : 0;
      const bRawGanador = t.resultadoBanquero > 0 ? t.resultadoBanquero / 0.95 : 0;
      comisionTotal += (jRawGanador * 0.05) + (bRawGanador * 0.05);
    });
  }

  return { huboLineas, salidaLineas, sinReconocer, tickets, totalesFinales, comisionTotal };
}

// =================================================================
// EDITAR un plano ya guardado — "Eliminar Planos" (23-09-2026, a pedido
// del usuario: "en editar realizare cambios de montos o de jugador, al
// realizar el cambio click a un boton que diga guardar y eso me editara
// el plano anterior de esa carrera"). Ver routes/hipismo.js, PUT
// /planos/:id/tickets/:ticketId.
//
// recalcularTicket(): recomputa resultadoJugador/resultadoBanquero de UN
// ticket puntual después de editar su monto/caballo, con la MISMA
// pizarra que ya se usó para todo el plano (nunca se le vuelve a pedir
// al operador) — reusa resolverModalidad() tal cual, sin duplicar la
// fórmula.
function recalcularTicket({ modalidad, caballo, monto }, rank) {
  let resultado;
  if (modalidad.toLowerCase() === 'pp') {
    const [hA, hB] = String(caballo).split(/x/i).map(h => parseInt(String(h).trim(), 10));
    resultado = resolverModalidad('pp', rank(hA), rank(hB));
  } else {
    resultado = resolverModalidad(modalidad, rank(parseInt(caballo, 10)));
  }
  if (!resultado) return null;
  const jRaw = resultado.j * monto, bRaw = resultado.b * monto;
  return { resultadoJugador: montoMostrado(jRaw), resultadoBanquero: montoMostrado(bRaw) };
}

// recalcularTotalesPlano(tickets, cruzar): recompone totalesFinales +
// comisionTotal de un plano ENTERO a partir de sus tickets YA guardados
// (cada uno con resultadoJugador/resultadoBanquero en formato "mostrado",
// tal como vive en hipismo_tickets) — hace falta después de editar UN
// ticket, porque en modo "cruza jugadas" el % se cobra sobre el NETO por
// persona de TODO el plano, no línea por línea, así que un cambio en un
// solo ticket puede mover el total de cualquier otro cliente que haya
// jugado más de una línea. EXACTAMENTE la misma fórmula que la sección
// final de calcularPlano() de arriba (deliberadamente no se tocó esa
// función para no arriesgar su comportamiento ya verificado/probado) —
// la única diferencia es que acá el "bruto" de cada línea se reconstruye
// desde el valor YA guardado (resultado>0 ? resultado/0.95 : resultado,
// mismo criterio que ya usa comisionDeLado() más abajo en este archivo)
// en vez de tenerlo a mano en memoria desde el parseo del texto.
function recalcularTotalesPlano(tickets, cruzar) {
  const rawPorNombre = {};
  const add = (nombre, monto) => { rawPorNombre[nombre] = (rawPorNombre[nombre] || 0) + monto; };
  tickets.forEach(t => {
    const jRaw = t.resultadoJugador > 0 ? t.resultadoJugador / 0.95 : t.resultadoJugador;
    const bRaw = t.resultadoBanquero > 0 ? t.resultadoBanquero / 0.95 : t.resultadoBanquero;
    add(t.clienteNombre, jRaw);
    add(t.banqueroNombre, bRaw);
  });

  const totalesFinales = {};
  let comisionTotal = 0;

  if (cruzar) {
    Object.keys(rawPorNombre).forEach(nombre => {
      const raw = rawPorNombre[nombre];
      if (raw > 0) { totalesFinales[nombre] = raw * 0.95; comisionTotal += raw * 0.05; }
      else { totalesFinales[nombre] = raw; }
    });
  } else {
    Object.keys(rawPorNombre).forEach(nombre => { totalesFinales[nombre] = 0; });
    tickets.forEach(t => {
      [[t.clienteNombre, t.resultadoJugador], [t.banqueroNombre, t.resultadoBanquero]].forEach(([nombre, m]) => {
        totalesFinales[nombre] += m;
      });
    });
    tickets.forEach(t => {
      const jRawGanador = t.resultadoJugador > 0 ? t.resultadoJugador / 0.95 : 0;
      const bRawGanador = t.resultadoBanquero > 0 ? t.resultadoBanquero / 0.95 : 0;
      comisionTotal += (jRawGanador * 0.05) + (bRawGanador * 0.05);
    });
  }

  Object.keys(totalesFinales).forEach(n => { totalesFinales[n] = Math.round((totalesFinales[n] + Number.EPSILON) * 100) / 100; });
  comisionTotal = Math.round((comisionTotal + Number.EPSILON) * 100) / 100;
  return { totalesFinales, comisionTotal };
}

// Arma las mismas 3 líneas + línea en blanco que calcularPlano() imprime
// por cada ticket reconocido (ver más arriba) — para poder regenerar
// texto_resultado después de editar un ticket, sin reparsear el texto
// original. Ver la nota grande en la ruta PUT /planos/:id/tickets/:id de
// routes/hipismo.js sobre cuándo esto se usa y cuándo NO (planos con
// bloque "PARADA ADELANTADAS" no se regeneran, para no arriesgar
// mezclarlo mal con ese bloque).
function armarSalidaLineasDeTickets(tickets) {
  const salidaLineas = [];
  tickets.forEach(t => {
    if (t.modalidad.toLowerCase() === 'pp') {
      const [hA, hB] = String(t.caballo).split(/x/i).map(h => parseInt(String(h).trim(), 10));
      salidaLineas.push(`pp (${hA}x${hB}) con ${formatMontoTabla(t.monto)}`);
      salidaLineas.push(`(${hA}) ${formatNombre(t.clienteNombre)} $ ${t.resultadoJugador >= 0 ? '+' : '-'}${formatMontoTabla(t.resultadoJugador)}`);
      salidaLineas.push(`(${hB}) ${formatNombre(t.banqueroNombre)} $ ${t.resultadoBanquero >= 0 ? '+' : '-'}${formatMontoTabla(t.resultadoBanquero)}`);
    } else {
      salidaLineas.push(`${t.modalidad} (${t.caballo}) con ${formatMontoTabla(t.monto)}`);
      salidaLineas.push(`Juega ${formatNombre(t.clienteNombre)} $ ${t.resultadoJugador >= 0 ? '+' : '-'}${formatMontoTabla(t.resultadoJugador)}`);
      salidaLineas.push(`Consigue ${formatNombre(t.banqueroNombre)} $ ${t.resultadoBanquero >= 0 ? '+' : '-'}${formatMontoTabla(t.resultadoBanquero)}`);
    }
    salidaLineas.push('');
  });
  return salidaLineas;
}

// Texto por defecto del "pie" del plano — se guarda como constante propia
// (23-09-2026) para que routes/hipismo.js pueda agregarlo DESPUÉS del
// bloque "PARADA ADELANTADAS" cuando corresponda (ver incluirPie abajo),
// en vez de tener que duplicar este texto en 2 lugares.
const PIE_PLANO_DEFECTO = '*PLANO REFERENCIAL*\n*_La guía es el chat_*\n(se gana y se cobra con el chat)\n*USTED ES SU PROPIO CORREDOR*\n*RECLAMOS AL PRIVADO*\n*NO DIGA:* ❌MALO❌; CASA FALTA...\n*TILDE SU JUGADA Y SE REVISARÁ*';

// Arma el bloque de texto final (encabezado + líneas resueltas +
// ✅GANAN/❌PIERDEN + pie) — spec secciones 1, 2 y 7.1. La comisión NO
// se imprime acá a propósito (el usuario fue explícito: "no quiero que
// los clientes vean" la comisión de la banca — sí se guarda aparte en
// hipismo_planos.comision_total para Balance General/Cierre Final).
//
// incluirPie (23-09-2026, a pedido del usuario: pegó un plano real donde
// el aviso "PLANO REFERENCIAL" quedaba en el MEDIO del mensaje —arriba
// del bloque "PARADA ADELANTADAS"— en vez de al final de todo, y pidió
// que quede siempre como lo ÚLTIMO. Cuando esta carrera tiene Jugadas
// Adelantadas para agregar, routes/hipismo.js llama esta función con
// incluirPie:false (así el pie NO se imprime acá) y lo agrega él mismo
// después del bloque "PARADA ADELANTADAS" — ver POST /planos y
// /planos/calcular.
// totalJugadas (23-09-2026, a pedido del usuario: "en el plano de las
// jugadas agrega como plus abajo antes del pie de plano Total Jugadas :
// y coloca el total de jugadas que hubo en ese plano") — opcional: si no
// se manda (undefined/null), no se agrega ninguna línea, así que
// cualquier otro llamador de esta función (o una prueba vieja) sigue
// funcionando exactamente igual que antes. routes/hipismo.js la manda
// siempre que arma un plano de "Cargar Planos" (resultado.tickets.length
// de ESA carrera puntual, nunca un acumulado de otras carreras/planos).
// Se agrega SIEMPRE antes del pie, tanto si el pie se imprime acá mismo
// (incluirPie:true) como si routes/hipismo.js lo va a agregar después,
// tras el bloque "PARADA ADELANTADAS" (incluirPie:false) — en los 2
// casos esta línea queda inmediatamente después de GANAN/PIERDEN.
function armarTextoResultado({ nombreGrupo, hipodromoNombre, carreraNumero, ret, pizarra, salidaLineas, totalesFinales, piePlano, incluirPie = true, totalJugadas }) {
  // 24-09-2026: encabezado FIJO/configurado (a pedido del usuario, que
  // pegó un plano real con exactamente este formato y pidió que sea
  // SIEMPRE este el que se devuelve, sin importar lo que traiga pegado el
  // texto de entrada — ver limpiarEncabezadoYPie() más arriba). Incluye
  // "*TERCIOS*" como parte fija del encabezado (antes no estaba) y usa
  // ordinalCarrera() en vez del sufijo "ta" fijo que tenía antes (bug:
  // "11ta Carrera" en vez de "11ma Carrera").
  const encabezado = `*🇻🇪🏇🏟️${(nombreGrupo || '').toUpperCase()}🏟️🏇🇻🇪*\n${hipodromoNombre}, ${ordinalCarrera(carreraNumero)} Carrera\nRet: ${ret || ''}\nPizarra: ${pizarra}\n\n*TERCIOS*`;
  const pie = piePlano || PIE_PLANO_DEFECTO;

  const entradasFinales = Object.entries(totalesFinales);
  const ganan = entradasFinales.filter(([, v]) => v >= 0).sort((a, b) => b[1] - a[1]);
  const pierden = entradasFinales.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);

  const bloques = [];
  if (ganan.length) bloques.push('✅ *GANAN*\n' + ganan.map(([n, v]) => `${formatNombre(n)} +${formatMontoTabla(v)}`).join('\n'));
  if (pierden.length) bloques.push('❌ *PIERDEN*\n' + pierden.map(([n, v]) => `${formatNombre(n)} -${formatMontoTabla(v)}`).join('\n'));
  const totalesTexto = bloques.join('\n\n');

  let salida = encabezado + '\n' + salidaLineas.join('\n') + '\n------------------------------\n------------------------------\n' + totalesTexto;
  if (totalJugadas !== undefined && totalJugadas !== null) {
    salida += `\n------------------------------\nTotal Jugadas: ${totalJugadas}`;
  }
  if (incluirPie) salida += '\n------------------------------\n------------------------------\n' + pie;
  return salida;
}

module.exports = {
  calcularPlano, armarTextoResultado, formatNombre, formatMontoTabla, PIE_PLANO_DEFECTO,
  resolverModalidad, parsearPizarra, recalcularTicket, recalcularTotalesPlano, armarSalidaLineasDeTickets,
  ordinalCarrera, limpiarEncabezadoYPie
};
