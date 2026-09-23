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
//   - "2y2": gana completo -5% si 1ro, gana LA MITAD -5% si 2do, pierde
//     completo si peor.
//   - "2y3": gana completo -5% en 1ro y 2do, pierde la mitad (banquero
//     gana esa mitad -5%) si 3ro, pierde completo si peor.
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
  if (modalidad === '2y2') {
    if (pos === 1) return { j: 1, b: -1 };
    if (pos === 2) return { j: 0.5, b: -0.5 };
    return { j: -1, b: 1 };
  }
  if (modalidad === '2y3') {
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

const LINEA_REGEX = /^juega\s+(\S+)\s+(\d{1,2}p|1\/2|1y2|2n|2nini|3n|3nn|2y2|2y3|pp|10[/a]\d+(?:\.\d+)?)\s*\(([^)]+)\)\s*con\s+([\d.,]+)\s*da\s+(\S+)/i;

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
  const lineas = (texto || '').split('\n');

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
function armarTextoResultado({ nombreGrupo, hipodromoNombre, carreraNumero, ret, pizarra, salidaLineas, totalesFinales, piePlano, incluirPie = true }) {
  const encabezado = `*🇻🇪🏇🏟️${(nombreGrupo || '').toUpperCase()}🏟️🏇🇻🇪*\n${hipodromoNombre}, ${carreraNumero}ta Carrera\nRet: ${ret || ''}\nPizarra: ${pizarra}`;
  const pie = piePlano || PIE_PLANO_DEFECTO;

  const entradasFinales = Object.entries(totalesFinales);
  const ganan = entradasFinales.filter(([, v]) => v >= 0).sort((a, b) => b[1] - a[1]);
  const pierden = entradasFinales.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);

  const bloques = [];
  if (ganan.length) bloques.push('✅ *GANAN*\n' + ganan.map(([n, v]) => `${formatNombre(n)} +${formatMontoTabla(v)}`).join('\n'));
  if (pierden.length) bloques.push('❌ *PIERDEN*\n' + pierden.map(([n, v]) => `${formatNombre(n)} -${formatMontoTabla(v)}`).join('\n'));
  const totalesTexto = bloques.join('\n\n');

  let salida = encabezado + '\n\n' + salidaLineas.join('\n') + '\n------------------------------\n------------------------------\n' + totalesTexto;
  if (incluirPie) salida += '\n------------------------------\n------------------------------\n' + pie;
  return salida;
}

module.exports = { calcularPlano, armarTextoResultado, formatNombre, formatMontoTabla, PIE_PLANO_DEFECTO };
