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
// Modalidades soportadas hoy (generalizadas el 24-09-2026, a partir de la
// lista completa "ASI SE JUEGA EN LAS OFICINAS" que mandó el usuario —
// confirma y extiende el patrón "AP/BN" ya confirmado desde el 22-09-2026
// en claude/spec-modulo-hipismo.md sección 6, generalizando a cualquier N
// las 2 familias que antes solo estaban hardcodeadas para N=2/N=3):
//   - "N puestos" (1p, 2p, 3p... sin tope fijo, "ASI HASTA LOS 10P" dijo
//     el usuario, pero la formula no depende de un limite): gana completo
//     -5% si coloca entre las primeras N posiciones, si no pierde
//     completo.
//   - Familia "Nn" (empata en la posicion N: "2N" empata en el 2do, "3N"
//     empata en el 3ro, generalizado ahora para 4n, 5n... 10n): gana
//     completo -5% en las posiciones ANTERIORES a N, "no se decide" (0 y
//     0) en la posicion N, pierde completo de ahi en adelante. Alias
//     historicos tolerados: "Nnini", "Nnn".
//   - Familia "AyB" (o "A/B" — alias de la misma matematica, generalizado
//     el 24-09-2026 a partir del patron "AP/BN" ya confirmado por el
//     usuario para CUALQUIER A/B, no solo A=1,2): cuando B===A ("2y2",
//     "3y3", "4y4"...): gana completo en 1..(A-1), gana LA MITAD -5% en la
//     posicion A, pierde completo despues. Cuando B===A+1 ("1/2"≡"1y2",
//     "2y3", "3y4"...): gana completo en 1..A, PIERDE la mitad (el
//     banquero gana esa mitad -5%) en la posicion B, pierde completo
//     despues. Se acepta con o sin la "n" final y con "/" en vez de "y" —
//     todas apuntan a la MISMA formula, ya verificada con ejemplos
//     numericos del usuario (spec seccion 6).
//   - "pp (AxB)": cruzado — gana completo -5% quien de los 2 caballos
//     llegue mejor colocado entre si (si hay empate/ninguno coloco,
//     gana el banquero — mismo criterio que ya tenia el mockup, ver
//     resolverModalidad('pp', ...) ahi).
//   - "10/N", "10aN" o "10 a N" (decimos, spec seccion 8): paga N/10 del
//     monto -5% si el caballo gana (llega 1ro), pierde completo si no.
//
// "PELO A PELO" (que el usuario listo como sinonimo de "1 puesto") queda
// AFUERA a proposito — ver la nota en claude/plan-modulo-hipismo.md, hay
// que confirmar primero si el token real que se pega en un plano es
// distinto de "pp" (que ya esta tomado por el cruzado de 2 caballos de
// arriba) antes de agregarlo.
//
// AGREGADO 24-09-2026 (plano real de otro grupo de WhatsApp, "Grupo
// Gorila", que mandó el usuario como ejemplo de "otra manera de leer
// jugadas"):
//   - Jugadas MIXTAS de 2 modalidades a la vez, del MISMO caballo y
//     MISMO monto (ej. "1/2-1p", "2n-1y2"): el monto se reparte 50/50
//     entre las 2 modalidades, cada mitad se resuelve por separado y se
//     suman — confirmado con 2 ejemplos numéricos del usuario (ver
//     resolverModalidadCompuesta() más abajo). El separador puede venir
//     pegado con guion ("1/2-1p") o con espacio ("2n 1y2") — se
//     normalizan las 2 formas a guion antes de calcular/guardar (ver
//     normalizarModalidadCombo()).
//   - Jugadas a VARIOS caballos con una sola modalidad y un solo monto
//     (ej. "1p 6,10" = 1p jugado a los caballos 6 y 10 con un mismo
//     monto): es una apuesta "o uno o el otro" — el monto COMPLETO se
//     resuelve con el MEJOR resultado entre los caballos listados
//     (confirmado por el usuario vía pregunta directa) — nunca se
//     reparte el monto entre los caballos (ver
//     resolverModalidadMultiCaballo()).
//   - Formato de línea COMPACTO, sin las palabras "Juega"/"con"/"da" ni
//     paréntesis: "<cliente> <modalidad> <caballo(s)> <banquero>
//     <monto>" (ver LINEA_REGEX_COMPACTA) — calcularPlano() prueba
//     primero el formato viejo y, si no calza, este — un mismo plano
//     pegado puede traer líneas de cualquiera de los 2 formatos.
//   - limpiarEncabezadoYPie() ahora también sabe recortar un encabezado
//     que NO trae ninguna línea "Pizarra:" (el caso de este plano de
//     ejemplo) — descarta todo lo que esté antes de la PRIMERA línea
//     que de verdad calce como una jugada.
//
// AGREGADO 24-09-2026, segunda ronda del mismo día (el usuario siguió
// explicando variantes reales de jugadas después de la entrega de arriba):
//   - "Morocha" (término del propio usuario) es como ahora se le dice a
//     la jugada de "varios caballos, o uno o el otro" de arriba (lo que
//     hizo Boss) — confirmado que puede ser de 2, 3 o más caballos (la
//     fórmula de resolverModalidadMultiCaballo() ya era genérica para
//     cualquier cantidad, no hizo falta cambiar nada ahí) y que también
//     se puede jugar con modalidades décimos ("10/7", "10a8"), no solo
//     con "Np" — ya funcionaba igual (resolverModalidadCompuesta() llama
//     resolverModalidad() sin restringir la familia), se agregó una
//     prueba de regresión para dejarlo confirmado.
//   - Los caballos de una morocha ahora también se pueden separar con
//     "y" o con guion, no solo coma: "6,10" ≡ "6y10" ≡ "6-10" (ver
//     CABALLO_SRC y el split en resolverResultadoLinea() más abajo). Un
//     caballo pegado SIN separador (ej. "43") sigue siendo SIEMPRE un
//     solo caballo (el 43) — confirmado explícitamente por el usuario
//     como la lectura más segura, nunca se intenta adivinar si son 2
//     caballos de una cifra pegados.
//   - Jugadas "A PREMIO" (término del usuario para la familia décimos,
//     10a9 hasta 10a1, o con decimales — paga N/10 si el caballo GANA):
//     se generalizó la notación para reconocer, además de "10/N"/
//     "10aN"/"10 a N" ya existentes, "10@N" y la forma corta "aN"/"a N"
//     (sin el "10" adelante), y N con coma decimal ("10a1,75") además de
//     punto — ver DECIMOS_RE/DECIMOS_SRC más abajo, un solo patrón
//     reusado por resolverModalidad() (el cálculo) y decimosN() (la
//     función de "sin comisión" de abajo), para que nunca se
//     desincronicen sobre qué es una jugada a premio.
//   - Función de "SIN COMISIÓN" para jugadas a premio (a pedido del
//     usuario: "hay grupos que a esas jugadas... no le quitan % al
//     ganador... se gana neto"): calcularPlano() ahora acepta
//     valoresSinComision (lista de valores N elegidos por el operador
//     ANTES de calcular esa carrera, en la pantalla de "Cargar Planos")
//     — si una línea es una jugada a premio SOLA (nunca combinada, nunca
//     "pp") y su N está en esa lista, el 5% no se descuenta cuando el
//     caballo gana (ver esModalidadSinComision()/montoMostrado()). Esa
//     bandera queda GUARDADA por ticket (hipismo_tickets.sin_comision —
//     hizo falta una columna nueva, ver sql/schema.sql) porque, aunque el
//     usuario confirmó que solo se elige antes de calcular (no se puede
//     tocar después), sí hace falta para que recalcularTicket()/
//     recalcularTotalesPlano() (que se usan cuando se EDITA cualquier
//     ticket del plano más adelante) sigan calculando bien ese ticket sin
//     volverle a aplicar o quitar la comisión por error. En modo "cruza
//     jugadas" (spec sección 7) los tickets exentos se liquidan APARTE,
//     con su propio monto ya neto — no entran al pozo que se netea al 5%
//     al final (ese pozo es solo para las jugadas de comisión normal),
//     ver la nota grande en calcularPlano()/recalcularTotalesPlano().
//   - PENDIENTE (no entregado en esta ronda, falta un ejemplo numérico
//     del usuario de cómo se resuelve el dinero): la jugada de "cliente
//     contra cliente" (ej. "raul 4y3 x adrian 5 con 400", cada cliente
//     con su propio grupo de caballos, incluso desparejo) — distinta de
//     la "morocha" de arriba (que es UN cliente con varios caballos).
// =================================================================

// Devuelve {j, b} como FRACCIÓN del monto (antes de comisión), desde la
// perspectiva del jugador (j) y del banquero (b) — siempre espejados
// (j === -b) salvo en un "no se decide" (0, 0). El lado del banquero es
// SIEMPRE la inversa exacta del jugador (confirmado explicitamente por el
// usuario el 24-09-2026: "esto ya te lo habia explicado... los que dan o
// banquea seria la inversa") — asi fue disenado desde el principio, nunca
// hizo falta un caso aparte para el lado del banquero.
function resolverModalidad(modalidadCruda, pos, posB) {
  const modalidad = modalidadCruda.toLowerCase().trim();

  // familia "N puestos": 1p, 2p, 3p ... sin tope fijo
  let m = modalidad.match(/^(\d{1,2})p$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return (pos <= n) ? { j: 1, b: -1 } : { j: -1, b: 1 };
  }

  // "10/N", "10aN", "10 a N", "10@N" o simplemente "aN"/"a N" (decimos —
  // "jugadas A PREMIO", 24-09-2026: el usuario confirmó que "10a2" se
  // puede escribir también "10/2", "10@2" o solo "a2", y así con
  // cualquier N — ver DECIMOS_RE más abajo, que centraliza TODAS estas
  // formas en un solo patrón). Se revisa ANTES que la familia generica
  // "A/B" de mas abajo porque ambas usan "/", y "10/3" tiene que leerse
  // como decimos (paga 3/10), no como A=10,B=3 de la familia AyB.
  m = modalidad.match(DECIMOS_RE);
  if (m) {
    const nTxt = (m[1] !== undefined ? m[1] : m[2]).replace(',', '.');
    const frac = parseFloat(nTxt) / 10;
    if (pos === 1) return { j: frac, b: -frac };
    return { j: -1, b: 1 };
  }

  // familia "Nn" (empata en la posicion N): 2n, 3n, 4n... 10n, y los
  // alias historicos "Nnini"/"Nnn" (generalizado 24-09-2026 — antes solo
  // estaban hardcodeados 2n y 3n).
  m = modalidad.match(/^(\d{1,2})n(?:ini)?$/) || modalidad.match(/^(\d{1,2})nn$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (pos < n) return { j: 1, b: -1 };
    if (pos === n) return { j: 0, b: 0 };
    return { j: -1, b: 1 };
  }

  // familia "AyB" (o "A/B", con o sin "n" final): patron general
  // confirmado por el usuario para CUALQUIER A/B (generalizado 24-09-2026
  // — antes solo estaban hardcodeados 1/2, 2y2 y 2y3). Reproduce EXACTO
  // el mismo resultado que las reglas anteriores para esos 3 casos ya
  // verificados (ver test_hipismo_modalidades_generalizadas.js).
  m = modalidad.match(/^(\d{1,2})y(\d{1,2})n?$/) || modalidad.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const A = parseInt(m[1], 10), B = parseInt(m[2], 10);
    if (B === A) {
      // "gana la mitad" en la posicion A (ej. 2y2, 3y3, 4y4...)
      if (pos < A) return { j: 1, b: -1 };
      if (pos === A) return { j: 0.5, b: -0.5 };
      return { j: -1, b: 1 };
    }
    if (B === A + 1) {
      // "pierde la mitad" en la posicion B=A+1 (ej. 1/2≡1y2, 2y3, 3y4...)
      if (pos <= A) return { j: 1, b: -1 };
      if (pos === B) return { j: -0.5, b: 0.5 };
      return { j: -1, b: 1 };
    }
    return null; // combinacion A/B que no sigue el patron confirmado
  }

  if (modalidad === 'pp') {
    // pos = ranking del caballo A, posB = ranking del caballo B — gana
    // quien tenga el número MENOR (mejor colocado). Empate/ninguno
    // colocó (ambos en 99) -> gana el banquero, mismo criterio que ya
    // tenía el mockup (caso no confirmado explícitamente con el
    // usuario, documentado como tal en claude/spec-modulo-hipismo.md).
    return (pos < posB) ? { j: 1, b: -1 } : { j: -1, b: 1 };
  }
  return null; // modalidad no reconocida
}

// =================================================================
// Jugadas MIXTAS de 2 modalidades a la vez (24-09-2026, a pedido del
// usuario, con un plano real de otro grupo — "Grupo Gorila" — donde
// líneas como "Yellowtone 1/2-1p 10 puertolacruz 36" juegan 2
// modalidades del MISMO caballo con el MISMO monto). El usuario
// confirmó el cálculo con números reales: el monto se reparte 50/50
// entre las 2 modalidades, cada mitad se resuelve por separado contra
// la MISMA posición del caballo, y se suman — ej. "1/2-1p" con 55,00 y
// el caballo llega 2do: pierde el 1p completo (27,50) + la mitad del
// 1/2 (13,75) = 41,25 de pérdida total; si gana, gana completo -5%.
// También confirmó "2n" (ya existente, "no se decide") combinado con
// "1y2": con 100,00 y el caballo llega 2do, pierde solo 25 (la mitad
// de "2n" no se decide = 0, la mitad de "1y2" pierde la mitad = 25).
// resolverModalidadCompuesta() generaliza esto: separa hasta 2
// sub-modalidades (ya vienen normalizadas con guion, ver
// normalizarModalidadCombo() más abajo), resuelve cada una con
// resolverModalidad() tal cual (sin duplicar ninguna fórmula) y
// PROMEDIA sus fracciones {j,b} — matemáticamente idéntico a repartir
// el monto en 2 mitades y sumar los resultados de cada mitad por
// separado (confirmado contra los 2 ejemplos numéricos de arriba). Si
// alguna de las 2 sub-modalidades es "pp" (que necesita 2 caballos y un
// formato de caballo distinto, "AxB") no se combina — se devuelve null
// a propósito para que esa línea caiga en "sinReconocer" en vez de
// calcular algo silenciosamente mal.
function resolverModalidadCompuesta(modalidadCruda, pos, posB) {
  const partes = (modalidadCruda || '').toLowerCase().trim().split('-').map(s => s.trim()).filter(Boolean);
  if (partes.length === 1) return resolverModalidad(partes[0], pos, posB);
  if (partes.length === 2) {
    if (partes[0] === 'pp' || partes[1] === 'pp') return null;
    const r1 = resolverModalidad(partes[0], pos, posB);
    const r2 = resolverModalidad(partes[1], pos, posB);
    if (!r1 || !r2) return null;
    return { j: (r1.j + r2.j) / 2, b: (r1.b + r2.b) / 2 };
  }
  return null; // 3 o mas modalidades combinadas: no soportado
}

// normalizarModalidadCombo() (24-09-2026): el usuario confirmó que el
// separador entre 2 modalidades combinadas puede venir con guion pegado
// ("1/2-1p", como en el plano real de Grupo Gorila) O con espacio
// ("2n 1y2") — acá se normalizan AMBAS formas a guion pegado ANTES de
// resolver o guardar, así el resto del código (resolverModalidadCompuesta
// de arriba, que solo separa por "-") y lo que queda guardado en
// hipismo_tickets.modalidad son siempre consistentes, sin importar cómo
// lo haya escrito el operador.
// OJO (bug encontrado y corregido en esta misma ronda, ANTES de
// entregar): NO se puede partir por cualquier espacio a lo bruto — la
// modalidad "10 a 5" (décimos, ver resolverModalidad) es UN SOLO token
// que de por sí trae espacios adentro ("10", espacio, "a", espacio,
// "5") — partirla a lo bruto la convertía en "10-a-5" (3 pedazos,
// ninguno reconocido) y rompía esa modalidad ya confirmada. Por eso acá
// se usa MODALIDAD_COMBO_SPLIT_RE (definida más abajo junto a MOD_SRC):
// solo separa cuando el texto es EXACTAMENTE 2 modalidades válidas
// completas separadas por espacio(s)/guion — si no calza esa forma
// exacta (como "10 a 5", que es una modalidad válida ENTERA), se deja
// tal cual, sin tocarla.
function normalizarModalidadCombo(modalidadCruda) {
  const texto = (modalidadCruda || '').trim();
  const m = texto.match(MODALIDAD_COMBO_SPLIT_RE);
  if (m) return `${m[1]}-${m[2]}`;
  return texto;
}

// Jugadas a VARIOS caballos con una sola modalidad y un solo monto
// (24-09-2026, a pedido del usuario, ejemplo real: "Boss 1p 6,10
// journalism 300" — Boss juega 1p a los caballos 6 y 10 con un solo
// monto de 300). Confirmado por el usuario (AskUserQuestion): es una
// apuesta "o uno o el otro" — el monto COMPLETO se resuelve con el
// MEJOR resultado entre los caballos listados (gana completo si
// CUALQUIERA de los caballos cumple la modalidad, pierde completo solo
// si NINGUNO la cumple) — nunca se reparte el monto entre los
// caballos. Para modalidades con resultados parciales (ej. una mitad),
// "mejor resultado" se generaliza como la fracción `j` más alta entre
// todos los caballos. Si algún caballo de la lista no se puede resolver
// (modalidad no reconocida), se devuelve null a propósito — la línea
// completa cae en "sinReconocer" en vez de arriesgar un cálculo
// parcial/incorrecto.
function resolverModalidadMultiCaballo(modalidadCruda, caballos, rank) {
  let mejor = null;
  for (const h of caballos) {
    if (!Number.isFinite(h)) return null;
    const r = resolverModalidadCompuesta(modalidadCruda, rank(h));
    if (!r) return null;
    if (!mejor || r.j > mejor.j) mejor = r;
  }
  return mejor;
}

// (?:\s+del)? (24-09-2026): tolera la palabra suelta "del" entre la
// modalidad y el paréntesis del caballo — el ejemplo real que mandó el
// usuario trae una línea así ("Juega Pedrito 2/2 del (8) con 4.000,00 da
// Tykhe"), mismo criterio ya usado en otras partes del sistema (ej. "3TF
// DEL 3 A 25" en Jugadas Adelantadas) donde "del" es puro relleno del
// lenguaje hablado, sin significado para el cálculo.
// Modalidad generalizada (24-09-2026): en vez de enumerar cada token
// literal ("1/2","2y2","2y3",...), el grupo de modalidad ahora matchea
// las FORMAS generales de cada familia (Np, Nn, AyB/A-B, décimos, pp) —
// resolverModalidad() es quien decide después qué significa cada una. Así
// "3y3","4y4","4y5","5y5", "4n","5n"..."10n", etc. quedan reconocidas sin
// tener que volver a tocar este regex cada vez que aparece una posición
// nueva.
// MOD_SRC (24-09-2026): la MISMA alternación de modalidades de siempre,
// factorizada en una constante de texto para poder reusarla tal cual en
// 2 lugares — el regex viejo ("Juega...da...") y el regex nuevo del
// formato compacto de abajo — sin arriesgar que se desincronicen entre
// sí. MODALIDAD_SRC envuelve 2 MOD_SRC opcionalmente unidos por guion O
// espacio(s) ("[\s-]+"), para las jugadas mixtas de 2 modalidades a la
// vez (ver resolverModalidadCompuesta()/normalizarModalidadCombo() más
// arriba) — el jugador puede escribir "1/2-1p" (pegado, como en el
// plano real de Grupo Gorila) o "2n 1y2" (con espacio), ambas formas
// quedan en el MISMO grupo de captura de modalidad.
// DECIMOS_RE / DECIMOS_SRC (24-09-2026, "jugadas A PREMIO" — el usuario
// explicó que las jugadas décimos "10a9" hasta "10a1" (o con decimales,
// "10a1,75", "10a2,5") se llaman así, "a premio", y que se escriben de
// varias formas equivalentes: "10/N", "10aN", "10 a N", "10@N", o
// directo "aN"/"a N" sin el "10" (se sobreentiende) — y que N puede
// traer coma decimal en vez de punto, como se escribe normalmente en
// Venezuela. Se centraliza el patrón acá en una sola constante para que
// resolverModalidad() (el cálculo) y decimosN()/esModalidadSinComision()
// (la función de "sin comisión" de más abajo) nunca se desincronicen
// sobre qué cuenta como una jugada a premio y cuál es su valor N.
const DECIMOS_RE = /^(?:10\s*[/a@]\s*(\d+(?:[.,]\d+)?)|a\s*(\d+(?:[.,]\d+)?))$/i;
const DECIMOS_SRC = '(?:10\\s*[/a@]\\s*\\d+(?:[.,]\\d+)?|a\\s*\\d+(?:[.,]\\d+)?)';
const MOD_SRC = '(?:\\d{1,2}p|' + DECIMOS_SRC + '|\\d{1,2}n(?:ini)?|\\d{1,2}nn|\\d{1,2}y\\d{1,2}n?|\\d{1,2}\\/\\d{1,2}|pp)';
const MODALIDAD_SRC = '(' + MOD_SRC + '(?:[\\s-]+' + MOD_SRC + ')?)';
// MODALIDAD_COMBO_SPLIT_RE: usada por normalizarModalidadCombo() de más
// arriba — exige que el texto ENTERO sean 2 modalidades válidas
// completas (cada una un MOD_SRC de principio a fin) separadas por
// espacio(s)/guion, para no confundir una modalidad que de por sí trae
// espacios adentro (ej. "10 a 5") con una combinación de 2.
const MODALIDAD_COMBO_SPLIT_RE = new RegExp('^(' + MOD_SRC + ')[\\s-]+(' + MOD_SRC + ')$', 'i');
const LINEA_REGEX = new RegExp('^juega\\s+(\\S+)\\s+' + MODALIDAD_SRC + '(?:\\s+del)?\\s*\\(([^)]+)\\)\\s*con\\s+([\\d.,]+)\\s*da\\s+(\\S+)', 'i');

// LINEA_REGEX_COMPACTA (24-09-2026, a pedido del usuario, con un plano
// real de otro grupo de WhatsApp — "Grupo Gorila" — como ejemplo: "otro
// plano, otra manera de leer jugadas"): formato SIN las palabras
// "Juega"/"con"/"da" y sin paréntesis alrededor del caballo — 5 campos
// separados por espacio, en este orden fijo: cliente, modalidad,
// caballo(s), banquero, monto. Ejemplos reales confirmados:
//   "Gordo 1/2 10 soyganador 100"        -> Gordo juega 1/2 del caballo
//                                           10 con 100, se lo da soyganador.
//   "Yellowtone 1/2-1p 10 puertolacruz 36" -> modalidad mixta (ver arriba).
//   "Boss 1p 6,10 journalism 300"        -> 1p a 2 caballos (6 y 10) con
//                                           un solo monto — "o uno o el
//                                           otro", ver
//                                           resolverModalidadMultiCaballo().
// El campo de caballo(s) acepta uno o más números separados por coma
// (apuesta a varios caballos, "o uno o el otro") O un par "AxB" (cruzado
// "pp", mismo formato que ya usaba el regex viejo). calcularPlano()
// intenta primero LINEA_REGEX (formato "Juega...") y, si no calza,
// intenta este — así un mismo plano pegado puede tener líneas de
// cualquiera de los 2 formatos, sin que el operador tenga que avisar
// cuál está usando.
// CABALLO_SRC (extendido 24-09-2026: el usuario confirmó que una "morocha"
// —su término para lo que ya hacía Boss, un mismo cliente jugando la
// MISMA modalidad en 2 o más caballos con un solo monto— también se
// escribe separando los caballos con "y" o con guion, no solo con coma:
// "6,10", "6y10" o "6-10" son la MISMA jugada. Un caballo SOLO sin
// separador (ej. "43") se sigue leyendo SIEMPRE como un solo caballo,
// nunca como 2 caballos pegados — confirmado explícitamente por el
// usuario, es la lectura más segura).
const CABALLO_SRC = '((?:\\d{1,2}(?:\\s*[,y-]\\s*\\d{1,2})*)|(?:\\d{1,2}\\s*x\\s*\\d{1,2}))';
const LINEA_REGEX_COMPACTA = new RegExp('^(\\S+)\\s+' + MODALIDAD_SRC + '\\s+' + CABALLO_SRC + '\\s+(\\S+)\\s+([\\d.,]+)\\s*$', 'i');

// PARECE_JUGADA_RE: heurística para no perder de vista una línea que de
// verdad parece una jugada (compacta, sin la palabra "Juega") pero que
// no terminó de calzar ningún formato — mismo criterio que ya existía
// para el formato viejo (que se fija si la línea contiene "Juega"), acá
// generalizado buscando cualquier token de modalidad conocido como
// palabra suelta dentro de la línea.
const PARECE_JUGADA_RE = new RegExp('\\b' + MOD_SRC + '\\b', 'i');

// decimosN(modalidadNorm) -> el valor N de una jugada "a premio" (familia
// décimos, ver DECIMOS_RE más arriba), como número, o null si la
// modalidad no es una jugada a premio SOLA (una combinada con guion,
// ej. "10a2-1p", NUNCA cuenta acá a propósito — la función de "sin
// comisión" de más abajo solo aplica a una jugada a premio sin mezclar,
// tal como la explicó el usuario).
function decimosN(modalidadNorm) {
  const m = (modalidadNorm || '').toLowerCase().trim().match(DECIMOS_RE);
  if (!m) return null;
  return parseFloat((m[1] !== undefined ? m[1] : m[2]).replace(',', '.'));
}

// esModalidadSinComision() (24-09-2026, a pedido del usuario: "hay grupos
// que a esas jugadas [a premio, ej. 10a2, 10a3]... no le quitan % al
// ganador... se gana neto (solo si el caballo gana)") — valoresSinComision
// es la lista de valores N (números) que el operador eligió para ESTA
// carrera antes de calcular (ver calcularPlano/POST /planos). Si la
// modalidad de la línea es una jugada a premio sola y su N está en esa
// lista, el 5% no se descuenta cuando el caballo gana (ver montoMostrado
// más abajo). Comparación con tolerancia (0.001) para que "1.75"/"1,75"
// no falle por redondeo de punto flotante.
function esModalidadSinComision(modalidadNorm, valoresSinComision) {
  if (!valoresSinComision || !valoresSinComision.length) return false;
  const n = decimosN(modalidadNorm);
  if (n === null) return false;
  return valoresSinComision.some(v => Math.abs(parseFloat(v) - n) < 0.001);
}

// parsearValoresSinComision(): normaliza lo que llega del formulario de
// "Cargar Planos" (un array, o un texto separado por comas como
// "2, 3, 1.75") a un array de números — usado por routes/hipismo.js para
// no repetir este parseo en /planos/calcular y /planos.
function parsearValoresSinComision(raw) {
  const partes = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
  return partes.map(v => parseFloat(String(v).trim().replace(',', '.'))).filter(Number.isFinite);
}

// Monto tal cual se MUESTRA en el texto de cada línea: ya con el 5%
// descontado si es una ganancia (spec sección 6), independiente de si el
// grupo cruza jugadas — el cruce (sección 7) solo cambia el TOTAL por
// persona al final, no cada línea individual. sinComision (24-09-2026,
// ver esModalidadSinComision arriba): si es true y la fracción es una
// ganancia, NO se descuenta el 5% — se muestra/guarda neto tal cual. Una
// pérdida nunca llevó comisión de por sí, así que sinComision no cambia
// nada en ese caso (coincide con "pierden neto" que explicó el usuario).
function montoMostrado(fraccionMonto, sinComision) {
  return (fraccionMonto > 0 && !sinComision) ? fraccionMonto * 0.95 : fraccionMonto;
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
  let encontroPizarra = false;
  for (let i = 0; i < Math.min(lineas.length, 8); i++) {
    if (/^\s*pizarra\s*:/i.test(lineas[i])) { inicio = i + 1; encontroPizarra = true; break; }
  }
  if (encontroPizarra) {
    while (inicio < lineas.length) {
      const l = lineas[inicio].replace(/\*/g, '').trim();
      if (l === '' || /^-{3,}$/.test(l) || /^tercios$/i.test(l)) { inicio++; } else break;
    }
  } else {
    // 24-09-2026 (plano real de "Grupo Gorila"): ese formato NO trae
    // ninguna línea "Pizarra:" en el encabezado (nombre del grupo +
    // hipódromo/carrera + "*TERCIOS*" directo) — sin este segundo
    // mecanismo, esas líneas se colaban tal cual a salidaLineas y el
    // "*TERCIOS*" del operador terminaba duplicado con el que ya arma
    // armarTextoResultado() más abajo. Mismo espíritu que el mecanismo
    // de "Pizarra:" (2 anclas, tolerante a que el encabezado varíe): acá
    // la ancla es la PRIMERA línea que de verdad calza como una jugada
    // (LINEA_REGEX o LINEA_REGEX_COMPACTA) — todo lo de ANTES de esa
    // línea se descarta. Si ninguna línea del texto llega a calzar como
    // jugada, no se toca nada (mismo comportamiento de siempre).
    let i = 0;
    while (i < lineas.length) {
      const l = lineas[i].replace(/\*/g, '').trim();
      if (l !== '' && (LINEA_REGEX.test(l) || LINEA_REGEX_COMPACTA.test(l))) break;
      i++;
    }
    if (i < lineas.length) inicio = i;
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

// resolverResultadoLinea() (24-09-2026): junta en un solo lugar los 3
// casos posibles de UNA línea de jugada ya con sus campos separados —
// "pp" (cruzado, caballoTxt viene como "AxB"), varios caballos con la
// misma modalidad (caballoTxt trae comas, ver
// resolverModalidadMultiCaballo — "o uno o el otro") o un caballo solo
// (con o sin modalidad mixta, ver resolverModalidadCompuesta) — para
// que calcularPlano() y no tenga que repetir esta lógica y
// recalcularTicket() (edición de un ticket ya guardado, más abajo)
// puedan compartirla tal cual. Devuelve null si no se pudo resolver (la
// línea cae en "sinReconocer" en vez de arriesgar un cálculo mal
// hecho). caballoGuardado es lo que se guarda en hipismo_tickets.caballo
// (formato "de archivo") y caballoDisplay es lo que se imprime en el
// texto de vuelta al operador — para el caso de un caballo solo estos 2
// pueden diferir un poco (ej. "08" guardado vs "8" mostrado) porque así
// se comportaba ya el código antes de este cambio, y no había motivo
// para tocar ese detalle.
function resolverResultadoLinea({ modalidadNorm, caballoTxt, rank }) {
  if (modalidadNorm.toLowerCase() === 'pp') {
    const [hA, hB] = caballoTxt.split(/x/i).map(h => parseInt(h.trim(), 10));
    if (!Number.isFinite(hA) || !Number.isFinite(hB)) return null;
    const resultado = resolverModalidad('pp', rank(hA), rank(hB));
    if (!resultado) return null;
    return { resultado, caballoGuardado: caballoTxt.trim(), caballoDisplay: `${hA}x${hB}`, esPP: true, hA, hB };
  }
  // "morocha" (24-09-2026, término del usuario para esto): varios
  // caballos con la MISMA modalidad y un solo monto, separados por coma,
  // "y" o guion ("6,10", "6y10", "6-10" son la misma jugada — ver
  // CABALLO_SRC más arriba). Un token SIN separador (ej. "43") nunca
  // entra por acá — el split de abajo lo deja en 1 sola parte y cae al
  // caso de caballo solo, más abajo (confirmado por el usuario: "43"
  // pegado es siempre UN caballo, el 43, nunca 2 caballos pegados).
  const partesCaballo = caballoTxt.split(/\s*[,y-]\s*/).map(s => s.trim()).filter(Boolean);
  if (partesCaballo.length > 1) {
    const caballos = partesCaballo.map(h => parseInt(h, 10));
    if (caballos.some(h => !Number.isFinite(h))) return null;
    const resultado = resolverModalidadMultiCaballo(modalidadNorm, caballos, rank);
    if (!resultado) return null;
    const texto = caballos.join(',');
    return { resultado, caballoGuardado: texto, caballoDisplay: texto, esPP: false };
  }
  const caballo = parseInt(caballoTxt.trim(), 10);
  if (!Number.isFinite(caballo)) return null;
  const resultado = resolverModalidadCompuesta(modalidadNorm, rank(caballo));
  if (!resultado) return null;
  return { resultado, caballoGuardado: caballoTxt.trim(), caballoDisplay: `${caballo}`, esPP: false };
}

// calcularPlano({ texto, pizarra, cruzar, valoresSinComision }) -> {
//   ok, error, huboLineas, salidaLineas: [texto por línea, para armar el
//   bloque de jugadas resuelto], sinReconocer: [líneas que no calzaron
//   con ninguna modalidad conocida], tickets: [{ clienteNombre,
//   banqueroNombre, modalidad, caballo, monto, resultadoJugador,
//   resultadoBanquero, sinComision }] (una fila por línea reconocida,
//   para guardar en hipismo_tickets), totalesFinales: { nombre:
//   montoFinal, ... }, comisionTotal
//
// valoresSinComision (24-09-2026, ver esModalidadSinComision más arriba):
// array de valores N (ej. [2, 3]) de jugadas "a premio" (10a2, 10a3...)
// que para ESTA carrera van SIN el 5% de comisión al ganador — opcional,
// default [] (comportamiento de siempre, nadie exento).
function calcularPlano({ texto, pizarra, cruzar, valoresSinComision = [] }) {
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

    // 24-09-2026: se intenta primero el formato viejo ("Juega... con...
    // da...") y, si no calza, el formato compacto nuevo (ver
    // LINEA_REGEX_COMPACTA más arriba) — así un mismo plano pegado puede
    // traer líneas de cualquiera de los 2 formatos.
    let jugadorCrudo, modalidadCruda, caballoTxt, montoTxt, bancoCrudo;
    let mm = limpia.match(LINEA_REGEX);
    if (mm) {
      [, jugadorCrudo, modalidadCruda, caballoTxt, montoTxt, bancoCrudo] = mm;
    } else {
      mm = limpia.match(LINEA_REGEX_COMPACTA);
      if (mm) [, jugadorCrudo, modalidadCruda, caballoTxt, bancoCrudo, montoTxt] = mm;
    }
    if (!mm) {
      // Encabezados de categoría (ej. "TERCIOS") u otras líneas se dejan
      // igual — solo se marca como "sin reconocer" si de verdad parece
      // una jugada mal escrita (formato viejo: contiene "Juega" pero no
      // calzó; formato compacto: trae un token de modalidad conocido
      // como palabra suelta pero no calzó el resto de los campos).
      salidaLineas.push(limpia);
      if (/juega/i.test(limpia) || PARECE_JUGADA_RE.test(limpia)) sinReconocer.push(limpia);
      return;
    }
    huboLineas = true;

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
    // modalidadNorm: normaliza "guion pegado" vs "con espacio" en una
    // jugada mixta a SIEMPRE guion pegado (ver normalizarModalidadCombo
    // más arriba) — para una modalidad simple (sin combinar) esto no
    // cambia nada (queda igual que antes).
    const modalidadNorm = normalizarModalidadCombo(modalidadCruda);
    const resuelto = resolverResultadoLinea({ modalidadNorm, caballoTxt, rank });
    if (!resuelto) { sinReconocer.push(limpia); salidaLineas.push(limpia); return; }

    const monto = parseFloat(montoTxt.replace(/\./g, '').replace(',', '.'));
    const { resultado, caballoGuardado, caballoDisplay, esPP, hA, hB } = resuelto;
    // sinComision (24-09-2026): solo aplica a una jugada a premio SOLA
    // (nunca a "pp" ni a una modalidad combinada — decimosN() ya lo
    // filtra). Si esta línea está exenta, su bruto NO entra al pozo
    // "rawPorNombre" (que sirve para el neteo de "cruza jugadas" con 5%
    // al final) — se liquida aparte, ver la sección de totales más abajo.
    const sinComision = esModalidadSinComision(modalidadNorm, valoresSinComision);
    const jRaw = resultado.j * monto, bRaw = resultado.b * monto;
    if (!sinComision) { add(jugador, jRaw); add(banco, bRaw); }
    const jMostrado = montoMostrado(jRaw, sinComision), bMostrado = montoMostrado(bRaw, sinComision);
    if (esPP) {
      salidaLineas.push(`pp (${hA}x${hB}) con ${montoTxt}`);
      salidaLineas.push(`(${hA}) ${formatNombre(jugador)} $ ${jMostrado >= 0 ? '+' : '-'}${formatMontoTabla(jMostrado)}`);
      salidaLineas.push(`(${hB}) ${formatNombre(banco)} $ ${bMostrado >= 0 ? '+' : '-'}${formatMontoTabla(bMostrado)}`);
    } else {
      salidaLineas.push(`${modalidadNorm} (${caballoDisplay}) con ${montoTxt}`);
      salidaLineas.push(`Juega ${formatNombre(jugador)} $ ${jMostrado >= 0 ? '+' : '-'}${formatMontoTabla(jMostrado)}`);
      salidaLineas.push(`Consigue ${formatNombre(banco)} $ ${bMostrado >= 0 ? '+' : '-'}${formatMontoTabla(bMostrado)}`);
    }
    salidaLineas.push('');
    tickets.push({ clienteNombre: jugador, banqueroNombre: banco, modalidad: esPP ? 'pp' : modalidadNorm, caballo: caballoGuardado, monto, resultadoJugador: jMostrado, resultadoBanquero: bMostrado, sinComision });
  });

  const totalesFinales = {};
  let comisionTotal = 0;
  // Nombres de TODOS los tickets (jugador y banquero), sin importar si
  // están o no en rawPorNombre — una línea sin comisión no agrega ahí
  // (ver arriba), así que si un cliente SOLO tuvo líneas sin comisión no
  // aparecería si se inicializara desde rawPorNombre nada más.
  const todosNombres = new Set();
  tickets.forEach(t => { todosNombres.add(t.clienteNombre); todosNombres.add(t.banqueroNombre); });
  todosNombres.forEach(nombre => { totalesFinales[nombre] = 0; });

  if (cruzar) {
    // Las líneas sin comisión (24-09-2026) se liquidan DIRECTO con su
    // propio resultado ya neto (nunca entraron a rawPorNombre) — el
    // resto de las líneas (comisión normal) se netea entre sí como
    // siempre y paga 5% una sola vez al final si el neto es positivo.
    tickets.forEach(t => {
      if (t.sinComision) {
        totalesFinales[t.clienteNombre] += t.resultadoJugador;
        totalesFinales[t.banqueroNombre] += t.resultadoBanquero;
      }
    });
    Object.keys(rawPorNombre).forEach(nombre => {
      const raw = rawPorNombre[nombre];
      if (raw > 0) {
        totalesFinales[nombre] += raw * 0.95;
        comisionTotal += raw * 0.05;
      } else {
        totalesFinales[nombre] += raw;
      }
    });
  } else {
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
    // lado que ganó pagó 5% sobre su bruto. Una línea sin comisión
    // (24-09-2026) no descontó nada — no suma a comisionTotal.
    tickets.forEach(t => {
      if (t.sinComision) return;
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
// sinComision (24-09-2026): viene de hipismo_tickets.sin_comision, tal
// cual quedó guardado ese ticket al calcular el plano — editar un ticket
// (monto/caballo) NUNCA cambia si va o no sin comisión, eso se decide
// una sola vez, al calcular (ver POST /planos y la respuesta a la
// pregunta del usuario: "solo antes de calcular").
function recalcularTicket({ modalidad, caballo, monto, sinComision }, rank) {
  let resultado;
  if (modalidad.toLowerCase() === 'pp') {
    const [hA, hB] = String(caballo).split(/x/i).map(h => parseInt(String(h).trim(), 10));
    resultado = resolverModalidad('pp', rank(hA), rank(hB));
  } else if (String(caballo).includes(',')) {
    // 24-09-2026: ticket de "varios caballos, o uno o el otro" (morocha,
    // ver resolverModalidadMultiCaballo más arriba) — se reconoce por la
    // coma guardada en hipismo_tickets.caballo (siempre coma: los
    // separadores "y"/guion que acepta el parseo se normalizan a coma
    // ANTES de guardar, ver resolverResultadoLinea).
    const caballos = String(caballo).split(',').map(h => parseInt(String(h).trim(), 10));
    resultado = resolverModalidadMultiCaballo(modalidad, caballos, rank);
  } else {
    // resolverModalidadCompuesta (24-09-2026) reemplaza la llamada
    // directa a resolverModalidad — para una modalidad simple (sin
    // combinar) se comporta exactamente igual que antes (delega en
    // resolverModalidad tal cual), y además soporta modalidades mixtas
    // ya guardadas con guion (ej. "1/2-1p").
    resultado = resolverModalidadCompuesta(modalidad, rank(parseInt(caballo, 10)));
  }
  if (!resultado) return null;
  const jRaw = resultado.j * monto, bRaw = resultado.b * monto;
  return { resultadoJugador: montoMostrado(jRaw, sinComision), resultadoBanquero: montoMostrado(bRaw, sinComision) };
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
  const todosNombres = new Set();
  tickets.forEach(t => { todosNombres.add(t.clienteNombre); todosNombres.add(t.banqueroNombre); });

  tickets.forEach(t => {
    // sinComision (24-09-2026): un ticket exento NUNCA tuvo el 5%
    // aplicado — su resultado guardado YA es el bruto, dividirlo por
    // 0.95 acá lo inflaría mal. No entra al pozo neto de "cruza
    // jugadas" — se liquida aparte, más abajo (mismo criterio que
    // calcularPlano()).
    if (t.sinComision) return;
    const jRaw = t.resultadoJugador > 0 ? t.resultadoJugador / 0.95 : t.resultadoJugador;
    const bRaw = t.resultadoBanquero > 0 ? t.resultadoBanquero / 0.95 : t.resultadoBanquero;
    add(t.clienteNombre, jRaw);
    add(t.banqueroNombre, bRaw);
  });

  const totalesFinales = {};
  let comisionTotal = 0;
  todosNombres.forEach(nombre => { totalesFinales[nombre] = 0; });

  if (cruzar) {
    tickets.forEach(t => {
      if (t.sinComision) {
        totalesFinales[t.clienteNombre] += t.resultadoJugador;
        totalesFinales[t.banqueroNombre] += t.resultadoBanquero;
      }
    });
    Object.keys(rawPorNombre).forEach(nombre => {
      const raw = rawPorNombre[nombre];
      if (raw > 0) { totalesFinales[nombre] += raw * 0.95; comisionTotal += raw * 0.05; }
      else { totalesFinales[nombre] += raw; }
    });
  } else {
    tickets.forEach(t => {
      [[t.clienteNombre, t.resultadoJugador], [t.banqueroNombre, t.resultadoBanquero]].forEach(([nombre, m]) => {
        totalesFinales[nombre] += m;
      });
    });
    tickets.forEach(t => {
      if (t.sinComision) return;
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
  ordinalCarrera, limpiarEncabezadoYPie,
  // 24-09-2026 (jugadas mixtas + formato compacto "Grupo Gorila"):
  resolverModalidadCompuesta, resolverModalidadMultiCaballo, normalizarModalidadCombo,
  LINEA_REGEX, LINEA_REGEX_COMPACTA,
  // 24-09-2026 (segunda ronda — jugadas "a premio" con notación extendida
  // y función de "sin comisión"):
  decimosN, esModalidadSinComision, parsearValoresSinComision, DECIMOS_RE
};
