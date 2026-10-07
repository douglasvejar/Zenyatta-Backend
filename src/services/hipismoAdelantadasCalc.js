// =================================================================
// "Jugadas Adelantadas" — Tablas Fijas y Marcas (23-09-2026, a pedido
// del usuario, con un formato real de ejemplo pegado por él):
//
//   *🇻🇪PLANOS MARCAS Y TABLAS ADELANTADAS ZENYATTA 🇻🇪*
//
//   *JUGANDO HALLAND*
//
//   2) 5TF DEL 5 A 39 ,195/500$
//   ...
//    12) 8x4 120$
//
//   *JUGANDO HANRY*
//
//   9) 1X2 120$
//   ...
//
// Son 2 tipos de jugada TOTALMENTE distintos a los Tercios de "Cargar
// Planos", y también distintos entre sí:
//
// TABLAS FIJAS ("N TF DEL <ejemplar> A <precio> ,<monto>/<ganancia>$"):
//   el cliente juega N "tablas fijas" de un caballo puntual — cada tabla
//   fija paga $100 si ese caballo GANA la carrera (llega 1ro), así que
//   N tablas pagan N×100. El monto apostado es N×precio — esta
//   multiplicación (y la de N×100) viene siempre escrita en el propio
//   plano y hay que revisarla siempre: si no calza, es un error de
//   tipeo del operador al armar el plano, no un error de cálculo
//   nuestro, así que se marca con alerta identificando la carrera y el
//   cliente en vez de intentar "adivinar" cuál de los 2 números está
//   mal.
//   Si gana: cliente neto = ganancia - monto; comisión = %  del MONTO
//   apostado (no de la ganancia); "tablas fijas" (la banca) absorbe el
//   pago del cliente MÁS la comisión (para que las 3 líneas sumen 0),
//   ej. confirmado con el usuario: 3TF del 3 a 25 (monto 75, ganancia
//   300) con 2.5% → Linares +225, Tablas Fijas -226,88, Comisión Tablas
//   Fijas +1,88.
//   Si pierde: cliente pierde el monto completo; comisión = % del
//   monto; "tablas fijas" (la banca) se queda con el monto menos la
//   comisión, ej. confirmado: monto 80 con 2.5% → Manolo -80, Tablas
//   Fijas +78, Comisión Tablas Fijas +2.
//
// MARCAS ("<num1>x<num2> <monto>$", ej. "4x7 120$"): NO es una combinada
// al 1er y 2do lugar exactos (así se había entendido/programado al
// principio — CORREGIDO 28-09-2026 con un ticket real del usuario: "las
// marcas no [las estás calculando bien]... la marca no es una combinación
// de dos caballos, es una apuesta de un caballo CONTRA otro"). En "4x7",
// el cliente juega el caballo num1 (4) CONTRA el caballo num2 (7), cabeza
// a cabeza — gana el que haya llegado más cerca del 1er lugar, sea cual
// sea su puesto exacto (no hace falta que sea 1ro-2do), con 2 casos
// especiales (ver resolverClienteMarca más abajo para la fórmula exacta,
// confirmada con 2 ejemplos reales del usuario):
//   - Si NINGUNO de los 2 caballos figuró en la pizarra -> la apuesta
//     queda NULA (nadie gana ni pierde, resultadoCliente 0) — no es lo
//     mismo que "pierde": si ninguno de los 2 corrió/colocó, no hay forma
//     de decidir cuál iba mejor.
//   - Si SOLO UNO de los 2 figuró -> gana automático el que sí figuró
//     (el otro ni corrió/no colocó, así que quedó "más lejos" del 1er
//     lugar por definición).
// A diferencia de Tablas Fijas, el pago no es fijo por unidad: si
// acierta, se paga monto/1.2 (confirmado con el usuario: 120$ → paga
// 100$ si acierta) — ese 100 es la ganancia COMPLETA del cliente, sin
// netear el monto jugado. Si NO acierta (y no quedó nula), el cliente
// pierde el monto completo (confirmado explícitamente: "si no acierta
// houston pierde completo").
//   El pago (si acertó) o el monto cobrado (si no acertó) lo banquean
//   1 o más personas, cada una cubriendo un % (confirmado con el
//   usuario: "porcentaje por banquero") y decidiendo aparte si cobra
//   comisión sobre SU parte o no. La comisión de cada banquero que la
//   cobra se junta en una sola línea genérica "Comisión Marcas"
//   (confirmado con el usuario: "no le coloques comision marcas sammy,
//   colocale comision marcas" — un solo ítem, no uno por banquero) para
//   que TODA la jugada siga sumando 0 entre cliente + banqueros +
//   comisión, igual que Tablas Fijas.
//   Asignar los banqueros es un paso APARTE de cargar el plano (el
//   formato de arriba no trae ningún banquero escrito) — se hace desde
//   la pantalla, una vez que ya se sabe si la marca acertó o no, con
//   resolverBanqueoMarca() más abajo. Mientras tanto la jugada queda en
//   estado 'falta_banqueo': ya se sabe el neto del CLIENTE, pero todavía
//   no quién banca ni cuánto.
//
// DECIDIBILIDAD DE UNA MARCA (confirmado con el usuario: "pizarra de 5
// puestos" — el sistema pide siempre los primeros 5 puestos de la
// llegada en hipódromos NACIONALES, y decide la marca solo si esos 5
// alcanzan) — esto es DISTINTO del caso "NULA" de arriba: acá el problema
// es que la PIZARRA MISMA todavía no trae suficientes puestos (no se sabe
// ni quién ganó la carrera), mientras que "NULA" es con una pizarra YA
// completa, donde simplemente ninguno de los 2 caballos de ESA marca
// puntual apareció. Con una pizarra completa de 5 puestos, el 1er y 2do
// lugar siempre se conocen con certeza, así que una marca SIEMPRE es
// decidible en cuanto el plano de esa carrera trae una pizarra de 5
// posiciones o más. Si trae MENOS de 5 (hipódromo nacional), la marca
// no se puede decidir con confianza todavía y, tal como pidió el
// usuario ("la pasas igual al plano pero con 0 para todo el mundo,
// pero ya para las jugadas adelantadas esa apuesta se resolvio solo
// que no se decide"), se da por resuelta con 0 para todos (estado
// 'sin_decidir') en vez de quedar pendiente para siempre. En hipódromos
// NO nacionales (pais='US') esta exigencia de 5 puestos no aplica — el
// usuario la limitó explícitamente a "hipodromos nacionales" — así que
// ahí alcanza con que la pizarra tenga los 2 primeros lugares.
// =================================================================

// round2: ÚNICO redondeo de dinero de todo Hipismo (05-10-2026, "NO QUIERO MAS
// DIFERENCIA, UN CENTAVO A LA LARGA REPRESENTA CIENTOS DE DOLARES"). Antes era
// Math.round((n + Number.EPSILON) * 100) / 100: cuando un % cae justo en medio
// centavo (12,50 * 1% = 0,125) el producto en coma flotante queda un pelo
// arriba o abajo del empate según el ORDEN en que se sumaron las bases, y la
// Grilla (Cierre Final) y el Link del cliente -- que suman en distinto
// orden -- terminaban con $0,01 de diferencia. Ahora el medio centavo
// SIEMPRE sube (en valor absoluto) y el 1e-6 absorbe el ruido de coma
// flotante (los montos reales nunca caen a menos de 0,01 centavos de un
// empate de verdad). No uses Math.round(x * 100) / 100 suelto en ningún lado:
// usa esta función. Ver test/test_hipismo_cuadre_aleatorio.js.
function round2(n) {
  const x = Number(n) || 0;
  const signo = x < 0 ? -1 : 1;
  return signo * Math.round(Math.abs(x) * 100 + 1e-6) / 100 || 0;
}

// montoDecidido (02-10-2026, a pedido del usuario: "LOS % QUE SE DEVUELVEN
// ES DE LO DECIDIDO NO DE LO APOSTADO... SI JUGARON 700 10A4 Y LA GANAN SE
// SACA % BASE A LOS 280 QUE SE DECIDEN... SI LA PIERDE SI SERIA BASE A LOS
// 700... SIEMPRE ES BASE A LO DECIDIDO SIN SACARLE EL 5%"). Es la inversa
// EXACTA de montoMostrado() (services/hipismoCalc.js): a partir de un
// resultado YA MOSTRADO/guardado (resultado_jugador, resultado_banquero, o
// el resultado_cliente/monto del banquero de una Marca de Jugadas
// Adelantadas — ver resolverBanqueoMarca más abajo), devuelve el monto
// "decidido" tal cual quedó la jugada, SIN el 5% de comisión descontado.
//
// Por qué hace falta: en una jugada fraccionada (familia "decimos"/"a
// premio" de resolverModalidad en hipismoCalc.js, ej. "10A4"), el que GANA
// solo decide una FRACCIÓN del monto apostado (280 de 700, no 700) — así
// que el % propio/de aval de un cliente (o de su banquero) tiene que
// calcularse sobre esos 280, nunca sobre los 700 apostados. El que PIERDE,
// en cambio, casi siempre pierde el monto COMPLETO (por eso "si la pierde
// si seria base a los 700" -- ahí lo decidido Y lo apostado coinciden, y
// el bug viejo "pasaba colado" sin que se notara). montoMostrado() ya le
// resta el 5% a cualquier ganancia (salvo sinComision) antes de guardarla
// -- acá se hace la cuenta al revés (dividir entre 0.95) para recuperar lo
// decidido ANTES de esa resta, que es justo lo que pidió el usuario
// ("SIN SACARLE EL 5%").
//
// Para una pérdida (resultadoMostrado <= 0) no hay ningún 5% que deshacer
// -- montoMostrado() nunca le resta nada a una pérdida -- así que el
// "decidido" es directamente su valor absoluto (sea una pérdida completa,
// -monto, o una pérdida parcial de la familia "AyB", ej. -0.5*monto).
//
// montoDecididoExacto (02-10-2026, a pedido del usuario: comparó un
// hipódromo/carrera puntual contra "otro programa" y encontró diferencias
// de centavos que en la semana suman $10-20 — "quiero saber xq". La causa:
// esta función SIEMPRE redondeaba a centavos (round2(r/0.95) para una
// ganancia), y todo lugar que luego usa ese valor para sacar el % devuelto
// (routes/hipismo.js, hipismoResumenCliente.js, netearJugadorBanqueroTercios
// en hipismoCalc.js) lo volvía a multiplicar por el % y a redondear OTRA
// VEZ — doble redondeo en cadena. Cuando r/0.95 no cae justo en un centavo
// cerrado (pasa seguido con los dividendos reales de una carrera, a
// diferencia de un monto apostado "redondo" como 75,00), ese primer
// redondeo ya mueve el valor un pelín, y el segundo redondeo sobre ese
// valor movido a veces da $0.01 de más o de menos que calcular todo en un
// solo paso. Se separa la cuenta en 2: montoDecididoExacto (sin redondear,
// para CUALQUIER cálculo que todavía vaya a multiplicarse/sumarse con algo
// más — el % propio/de aval, el neteo jugador/banquero, etc.) y
// montoDecidido (la de siempre, = round2(montoDecididoExacto(...)), que
// sigue usándose tal cual donde el "decidido" se muestra directo en
// pantalla como un monto limpio — ej. "Jugó $X / Banqueó $Y" del neteo).
function montoDecididoExacto(resultadoMostrado, sinComision) {
  const r = Number(resultadoMostrado) || 0;
  if (r > 0 && !sinComision) return r / 0.95;
  return Math.abs(r);
}
function montoDecidido(resultadoMostrado, sinComision) {
  return round2(montoDecididoExacto(resultadoMostrado, sinComision));
}

// montoBaseComisionExacto(resultadoMostrado, sinComision) (04-10-2026, a
// pedido EXPLÍCITO del usuario: "estas jugadas a premio no dejan
// comision, ni % de devolucion para los clientes... ya que como bien dice
// la jugada son sin %.... solo se deciden las jugadas de los clientes
// netas pero ni generan comsion para el grupo ni % de devolcion para
// ellos mismo ni para sus avalados" — tras agregar la lista pegable de
// "Valores a premio SIN comisión" en Cargar Planos).
//
// La comisión del GRUPO ya excluía bien estas jugadas desde el 24-09-2026
// (ver comisionDeLado en routes/hipismo.js y los chequeos `if
// (t.sinComision) return;`/`if (t.sinComision) {...}` en hipismoCalc.js) —
// lo que faltaba era el % DEVUELTO (propio y de aval): TODO lugar que
// usaba montoDecididoExacto(resultado, <bandera REAL del ticket>) como
// BASE de un % (routes/hipismo.js: sumarBaseCarrera, entradasApostadasDeTickets,
// acumularSaldo, acumularDevueltoDia, el detalle de /comisiones-devueltas;
// hipismoResumenCliente.js: montoBaseParaPct, el toggle "incluir % en sus
// jugadas", acumularDevuelto de Cierre Final; hipismoCalc.js:
// netearJugadorBanqueroTercios) seguía usando el monto DECIDIDO real de
// la línea como base — sinComision solo evitaba dividir entre 0.95 (no
// inventar una comisión que nunca se cobró), pero el monto seguía
// contando como "volumen" para calcular el % propio/de aval. Esta función
// es exactamente montoDecididoExacto(), salvo que cuando sinComision es
// true devuelve 0 en vez del monto — una jugada "a premio" marcada sin
// comisión no debe aportar NADA a ninguna base de %, ni como ganancia ni
// como pérdida, para NINGÚN cálculo de comisión o % devuelto (propio o de
// aval, de la cuenta misma o de cualquiera que la avale).
//
// OJO: esto es SOLO para los llamadores que pasan la bandera REAL
// `t.sin_comision`/`linea.sinComision` del ticket (el toggle "a premio"
// de Tercios). Las líneas de Jugadas Adelantadas llaman a
// montoDecididoExacto con `sinComision` HARDCODEADO a `true` (un
// significado totalmente distinto: "este valor ya viene neto, sin ningún
// 5% embebido que deshacer" — nunca el toggle "a premio" de Tercios, que
// ni siquiera existe en Jugadas Adelantadas) — esos llamadores NO deben
// cambiar a esta función, o su base de % devuelto se volvería $0 SIEMPRE
// por error. Ver la nota grande de montoDecididoExacto más arriba para el
// detalle completo de esta doble bandera.
function montoBaseComisionExacto(resultadoMostrado, sinComision) {
  if (sinComision) return 0;
  return montoDecididoExacto(resultadoMostrado, false);
}

// Mismo criterio de parseo de montos que ya usa hipismoCalc.js/
// hipismoRemateCalc.js en el resto del módulo ("." = separador de miles,
// "," = decimal) — en la práctica los planos de ejemplo no traen
// decimales, pero se deja igual por consistencia con el resto del código.
function numDe(s) {
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
}

const RE_ENCABEZADO = /PLANOS?\s+MARCAS|TABLAS?\s+ADELANTAD/i;
const RE_CLIENTE = /^JUGANDO\s+(.+)$/i;
const RE_CARRERA = /^(\d{1,2})\)\s*(.+)$/;
const RE_TF = /^(\d+)\s*TF\s+DEL\s+(\d+)\s+A\s+(\d+(?:[.,]\d+)?)\s*,\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*\$/i;
const RE_MARCA = /^(\d{1,2})\s*[xX]\s*(\d{1,2})\s+(\d+(?:[.,]\d+)?)\s*\$/;

// parsearJugadasAdelantadas(texto) -> { jugadas: [{ cliente, carreraNumero,
// tipo: 'tf'|'marca', ...campos propios de cada tipo, errorCalculo,
// detalleError, textoOriginal }], sinReconocer: [líneas que parecían una
// jugada numerada pero no calzaron con ningún formato conocido] }
function parsearJugadasAdelantadas(textoOriginal) {
  const texto = (textoOriginal || '').replace(/\*/g, '');
  const lineas = texto.split(/\r?\n/);
  const jugadas = [];
  const sinReconocer = [];
  let clienteActual = null;

  lineas.forEach(lineaCruda => {
    const linea = lineaCruda.trim();
    if (!linea) return;
    if (RE_ENCABEZADO.test(linea)) return; // "PLANOS MARCAS Y TABLAS ADELANTADAS ZENYATTA" — decorativo

    const mCliente = linea.match(RE_CLIENTE);
    // 29-09-2026 — mismo criterio y mismo motivo que hipismoCalc.js
    // (colapsar espacios de más entre palabras, ver la nota grande ahí):
    // Jugadas Adelantadas comparte la misma tabla "jugadores" y el mismo
    // emparejamiento exacto por nombre para el % propio.
    if (mCliente) { clienteActual = mCliente[1].trim().toUpperCase().replace(/\s+/g, ' '); return; }

    const mCarrera = linea.match(RE_CARRERA);
    if (!mCarrera) { sinReconocer.push(linea); return; }
    if (!clienteActual) { sinReconocer.push(linea); return; } // línea numerada antes de cualquier "JUGANDO..."

    const carreraNumero = parseInt(mCarrera[1], 10);
    const resto = mCarrera[2].trim();

    const mTF = resto.match(RE_TF);
    if (mTF) {
      const cantidadTf = parseInt(mTF[1], 10);
      const numeroEjemplar = parseInt(mTF[2], 10);
      const precioPorTf = numDe(mTF[3]);
      const monto = numDe(mTF[4]);
      const gananciaPotencial = numDe(mTF[5]);
      const montoEsperado = round2(cantidadTf * precioPorTf);
      const gananciaEsperada = cantidadTf * 100;
      let errorCalculo = false, detalleError = null;
      if (Math.abs(montoEsperado - monto) > 0.01) {
        errorCalculo = true;
        detalleError = `${cantidadTf} TF × ${precioPorTf} = ${montoEsperado}, pero el plano dice ${monto}`;
      } else if (Math.abs(gananciaEsperada - gananciaPotencial) > 0.01) {
        errorCalculo = true;
        detalleError = `${cantidadTf} tabla(s) fija(s) deberían pagar ${gananciaEsperada} (100 c/u), pero el plano dice ${gananciaPotencial}`;
      }
      jugadas.push({
        cliente: clienteActual, carreraNumero, tipo: 'tf',
        cantidadTf, numeroEjemplar, precioPorTf, monto, gananciaPotencial,
        errorCalculo, detalleError, textoOriginal: linea
      });
      return;
    }

    const mMarca = resto.match(RE_MARCA);
    if (mMarca) {
      jugadas.push({
        cliente: clienteActual, carreraNumero, tipo: 'marca',
        numero1: parseInt(mMarca[1], 10), numero2: parseInt(mMarca[2], 10),
        monto: numDe(mMarca[3]),
        errorCalculo: false, detalleError: null, textoOriginal: linea
      });
      return;
    }

    sinReconocer.push(linea);
  });

  return { jugadas, sinReconocer };
}

// Igual formato/separadores que parsearPizarra() en hipismoCalc.js —
// cuenta cuántas posiciones trae una pizarra ("6.7.8.3.1" -> 5).
function contarPosicionesPizarra(pizarraTxt) {
  return (pizarraTxt || '').split(/[^0-9]+/).filter(Boolean).length;
}

// Ver la nota grande de arriba ("DECIDIBILIDAD DE UNA MARCA").
function esMarcaDecidible(pizarraTxt, esNacional) {
  const cantidad = contarPosicionesPizarra(pizarraTxt);
  return esNacional ? cantidad >= 5 : cantidad >= 2;
}

// resolverTablaFija(jugada, rank, comisionPorcentaje) -> { gano,
// resultadoCliente, tablasFijas, comision } — ver la nota grande de
// arriba para la fórmula exacta, ya verificada contra los 2 ejemplos
// numéricos del usuario (Linares +225 / Manolo -80).
function resolverTablaFija({ numeroEjemplar, monto, gananciaPotencial }, rank, comisionPorcentaje) {
  const gano = rank(numeroEjemplar) === 1;
  const comision = round2(monto * (Number(comisionPorcentaje) / 100));
  if (gano) {
    const resultadoCliente = round2(gananciaPotencial - monto);
    const tablasFijas = round2(-(resultadoCliente + comision));
    return { gano, resultadoCliente, tablasFijas, comision };
  }
  const resultadoCliente = -monto;
  const tablasFijas = round2(monto - comision);
  return { gano, resultadoCliente, tablasFijas, comision };
}

// Mismo centinela que ya usa parsearPizarraRank() (routes/hipismo.js)
// para "este número no apareció en la pizarra" — declarado acá también
// para que resolverClienteMarca() pueda detectar el caso "ninguno de los
// 2 figuró" sin importar qué tan grande el caller haga su propio `rank`
// (los 2 rank() reales del sistema, y los de las pruebas, ya usan 99).
const NO_FIGURA_EN_PIZARRA = 99;

// resolverClienteMarca(jugada, rank) -> { nula, acierta, resultadoCliente,
// base } — solo el lado del cliente (no depende de quién banquea).
//
// CORREGIDO (28-09-2026, caso real del usuario — ver la nota grande de
// "MARCAS" arriba): NO es "1er y 2do lugar exactos". En "num1 x num2", el
// cliente juega num1 CONTRA num2, cabeza a cabeza:
//   - Si NINGUNO de los 2 apareció en la pizarra -> nula = true, nadie
//     gana ni pierde (resultadoCliente 0).
//   - Si SOLO UNO apareció -> gana automático el que sí apareció (rank()
//     le da NO_FIGURA_EN_PIZARRA al que no corrió/no colocó, así que la
//     comparación de abajo ya lo resuelve solo).
//   - Si los 2 aparecieron -> gana el de MEJOR posición (rank más chico,
//     más cerca del 1er lugar), sea cual sea su puesto exacto.
// Confirmado con 2 ejemplos reales del usuario: "4x2" con pizarra
// 2,4,5,6,7 (1ro el 2, 2do el 4) -> pierde (el 2, num2, quedó mejor
// puesto); "4x2" con pizarra 6,7,8,4,1 (4to el 4, el 2 ni aparece) ->
// gana (el 4, num1, sí colocó).
function resolverClienteMarca({ numero1, numero2, monto }, rank) {
  const rank1 = rank(numero1);
  const rank2 = rank(numero2);
  if (rank1 === NO_FIGURA_EN_PIZARRA && rank2 === NO_FIGURA_EN_PIZARRA) {
    return { nula: true, acierta: null, base: 0, resultadoCliente: 0 };
  }
  const acierta = rank1 < rank2;
  if (acierta) {
    const base = round2(monto / 1.2);
    return { nula: false, acierta, base, resultadoCliente: base };
  }
  return { nula: false, acierta, base: monto, resultadoCliente: -monto };
}

// resolverBanqueoMarca({ acierta, base }, banqueadores) -> {
// banqueadores: [{ nombre, porcentaje, pagaComision, monto }],
// comisionMarcas } — "base" es lo que ya calculó resolverClienteMarca
// (la ganancia bruta si acertó, o el monto completo si no). Cada
// banquero cubre `porcentaje`% de esa base; si cobra comisión, su parte
// se ve reducida (si acertó, además de pagar su parte paga la
// comisión — como Tablas Fijas) o aumentada (si no acertó, cobra su
// parte menos la comisión) — la comisión de TODOS los banqueros que
// cobran se junta en un solo total "Comisión Marcas" para que la línea
// del cliente + todos los banqueros + esa comisión sumen exactamente 0.
// Verificado contra el ejemplo real del usuario (Houston 4x7 120$,
// acierta, 2 banqueros al 50%, solo Sammy cobra 2.5%): Houston +100,
// Marcas Zenyatta -50, Marcas Sammy -51,25, Comisión Marcas +1,25.
function resolverBanqueoMarca({ acierta, base }, banqueadores, comisionPorcentajeDefecto) {
  let comisionMarcas = 0;
  const lista = banqueadores || [];
  const parteExacta = lista.length > 1 && Math.abs(lista.reduce((acc, b) => acc + (Number(b.porcentaje) || 0), 0) - 100) <= 0.01;
  let acumuladoPartes = 0;
  const resueltos = lista.map((b, idx) => {
    const porcentaje = Number(b.porcentaje) || 0;
    // Cuando los % suman 100, el ÚLTIMO banquero se queda con el resto
    // exacto de `base` (06-10-2026): 41,67 al 50/50 daba 20,84 + 20,84 =
    // 41,68 (un centavo de más sin contraparte). Así cliente + banqueadores
    // + comisión suman 0 siempre, sin importar los centavos.
    const parte = (parteExacta && idx === lista.length - 1)
      ? round2(base - acumuladoPartes)
      : round2(base * (porcentaje / 100));
    acumuladoPartes = round2(acumuladoPartes + parte);
    const pagaComision = !!b.pagaComision;
    const comisionPct = b.comisionPorcentaje != null ? Number(b.comisionPorcentaje) : Number(comisionPorcentajeDefecto);
    let comisionBanquero = 0;
    if (pagaComision) {
      comisionBanquero = round2(parte * (comisionPct / 100));
      comisionMarcas = round2(comisionMarcas + comisionBanquero);
    }
    const monto = acierta ? round2(-(parte + comisionBanquero)) : round2(parte - comisionBanquero);
    return { nombre: b.nombre, porcentaje, pagaComision, comisionPorcentaje: pagaComision ? comisionPct : null, monto };
  });
  return { banqueadores: resueltos, comisionMarcas };
}

// BANQUEO DE TABLAS FIJAS (06-10-2026, a pedido del usuario: "HAGAMOS LA
// MISMA CONFIGURACION PARA TABLAS FIJAS, CADA GRUPO ESTABLECE SU
// CONFIGURACION"). Igual que las Marcas: en vez del ítem fijo "TABLAS
// FIJAS" (la banca), un grupo puede definir quién banquea sus Tablas Fijas
// (hasta 4, con % que suman 100 y si pagan comisión). Mismas reglas de
// signo que resolverBanqueoMarca: si el cliente GANA cada banquero paga su
// parte MÁS la comisión que le toque; si PIERDE cada banquero cobra su parte
// MENOS esa comisión. La comisión de una TF es la de siempre sobre lo
// apostado (monto × %): se reparte entre los banqueadores marcados "paga
// comisión" según su % (y si todos pagan, suma exactamente la comisión
// completa). Invariante: cliente + banqueadores + comisión = 0 exacto.
// Con un solo banquero al 100% que paga, da lo MISMO que el ítem "TABLAS
// FIJAS" de siempre (Linares +225 -> -226,88 / Manolo -80 -> +78).
// -> { banqueadores: [{nombre, porcentaje, pagaComision, comisionPorcentaje, monto}], comision }
function resolverBanqueoTablaFija({ gano, resultadoCliente, monto }, banqueadores, comisionPorcentaje) {
  const lista = banqueadores || [];
  const base = Math.abs(Number(resultadoCliente) || 0);
  const comisionTotal = round2(Number(monto) * (Number(comisionPorcentaje) / 100));
  const todosPagan = lista.length > 0 && lista.every(b => !!b.pagaComision);
  const parteExacta = lista.length > 1 && Math.abs(lista.reduce((acc, b) => acc + (Number(b.porcentaje) || 0), 0) - 100) <= 0.01;
  let acumuladoPartes = 0;
  let acumuladoComision = 0;
  const resueltos = lista.map((b, idx) => {
    const porcentaje = Number(b.porcentaje) || 0;
    const esUltimo = idx === lista.length - 1;
    const parte = (parteExacta && esUltimo) ? round2(base - acumuladoPartes) : round2(base * (porcentaje / 100));
    acumuladoPartes = round2(acumuladoPartes + parte);
    const pagaComision = !!b.pagaComision;
    let comisionBanquero = 0;
    if (pagaComision) {
      comisionBanquero = (todosPagan && parteExacta && esUltimo)
        ? round2(comisionTotal - acumuladoComision)
        : round2(comisionTotal * (porcentaje / 100));
    }
    acumuladoComision = round2(acumuladoComision + comisionBanquero);
    const montoBanquero = gano ? round2(-(parte + comisionBanquero)) : round2(parte - comisionBanquero);
    return { nombre: b.nombre, porcentaje, pagaComision, comisionPorcentaje: pagaComision ? Number(comisionPorcentaje) : null, monto: montoBanquero };
  });
  return { banqueadores: resueltos, comision: acumuladoComision };
}

// Igual que banqueoAutomaticoMarca: null si no hay con qué banquear.
function banqueoAutomaticoTablaFija({ gano, resultadoCliente, monto }, comisionPorcentaje, previos, configGrupo) {
  let lista = null;
  if (previos) {
    try { lista = typeof previos === 'string' ? JSON.parse(previos) : previos; } catch (e) { lista = null; }
  }
  if (!Array.isArray(lista) || !lista.length) lista = Array.isArray(configGrupo) && configGrupo.length ? configGrupo : null;
  if (!lista) return null;
  return resolverBanqueoTablaFija({ gano, resultadoCliente, monto }, lista, comisionPorcentaje);
}

// BANQUEO AUTOMÁTICO DE MARCAS (06-10-2026, a pedido del usuario, viendo
// Balance General con Hanry -120 y Halland +100 pero SIN renglón de quién
// banqueó esas marcas: "DEBE SALIR EL ITEM DE MARCAS SAMMY Y MARCAS
// ZENYATTA... IGUAL QUE TABLAS AL TENER JUGADAS DE TABLAS"). La
// plataforma se vende a varios grupos y NO todos banquean las Marcas igual
// ("OTRO GRUPO NO NECESARIAMENTE BANQUEA LAS MARCAS ASÍ Y TAMPOCO EXISTA
// SAMMY NI ZENYATTA PARA ELLOS"), así que NADA va fijo en el código: cada
// grupo define en su configuración (grupos.hipismo_marcas_banqueo, pantalla
// "Banqueo de Marcas") quién banquea por defecto -- hasta 4 nombres con su
// % y si pagan comisión -- y recién ahí sus Marcas se banquean solas. Un
// grupo SIN configuración sigue exactamente como antes: la Marca queda
// 'falta_banqueo' hasta que el operador la banquea a mano.
//
// -> null si no hay con qué banquear (sin banqueadores previos ni
// configuración del grupo); si no, { banqueadores: [{nombre, porcentaje,
// pagaComision, comisionPorcentaje, monto}], comisionMarcas }.
// `previos` (opcional): banqueadores ya asignados a mano (array o JSON
// string del jsonb) -- si vienen, tienen prioridad sobre la configuración.
function banqueoAutomaticoMarca({ acierta, base }, comisionPorcentaje, previos, configGrupo) {
  let lista = null;
  if (previos) {
    try { lista = typeof previos === 'string' ? JSON.parse(previos) : previos; } catch (e) { lista = null; }
  }
  if (!Array.isArray(lista) || !lista.length) lista = Array.isArray(configGrupo) && configGrupo.length ? configGrupo : null;
  if (!lista) return null;
  return resolverBanqueoMarca({ acierta, base }, lista, Number(comisionPorcentaje));
}

// (30-09-2026, a pedido del usuario: separador de mil + 2 decimales
// también en los mensajes de WhatsApp) — texto de salida únicamente.
function formatMontoTabla(n) {
  return Math.abs(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatNombre(nombre) {
  const n = (nombre || '').toString().trim().toLowerCase();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// Arma el bloque "PARADA ADELANTADAS" que se agrega ABAJO del plano
// normal de esa carrera (a pedido del usuario: "quiero que las jugadas
// adelantadas se agreguen al plano de las jugadas de esa carrera...
// pero separado, tendrías los totales de quien gano y quien pierde en
// esa carrera y abajo un item que diga parada adelantadas, despues
// igual quien gana y quien pierde"). Recibe una lista plana de {
// nombre, monto } ya resueltos (cliente de cada tf/marca + cada
// banquero de cada marca ya banqueada) — la comisión NO se imprime acá
// a propósito, mismo criterio que el resto de "Cargar Planos" (no se le
// muestra al cliente, solo se guarda aparte para Cierre Final).
function armarBloqueAdelantadas(movimientos) {
  if (!movimientos.length) return '';
  // 06-10-2026, a pedido del usuario ("LAS TABLAS Y MARCAS QUE SE CARGUEN POR
  // ESTE MODULO NO SE CRUZAN... SE CALCULA CADA JUGADA INDIVIDUAL" y "QUE EN
  // EL PLANO SE VEA CLIENTE Y ABAJO EL ITEM YA SEA MARCAS O TABLAS... ASI
  // TANTAS JUGADAS TENGAS"; caso: Halland +100 y Hanry -120 en la misma
  // carrera, y el plano mostraba un solo "Marcas +20" neteado): cada Tabla
  // Fija / Marca (movimientos con `individual: true`, de a PAR: el cliente y
  // su espejo "MARCAS"/"TABLAS FIJAS", ligados por `grupo`) se imprime como
  // su propio par -- el cliente y, justo abajo, el ítem -- sin sumarse con
  // ninguna otra jugada. Un plano con 5 jugadas sale con 5 pares, y "MARCAS"
  // o "TABLAS FIJAS" tiene tantos renglones como jugadas hubo. Los demás
  // movimientos (Jugadas entre Tercios Adelantadas) siguen sumándose por
  // nombre en las listas GANAN/PIERDEN de siempre. Esto es solo el TEXTO del
  // plano; los saldos nunca cambian.
  const porNombre = new Map();
  const pares = new Map();
  let nIndividuales = 0;
  movimientos.forEach(({ nombre, monto, individual, grupo }) => {
    if (individual) {
      const clave = grupo != null ? `g:${grupo}` : `auto:${Math.floor(nIndividuales / 2)}`;
      nIndividuales += 1;
      if (!pares.has(clave)) pares.set(clave, []);
      pares.get(clave).push([nombre, round2(monto)]);
      return;
    }
    porNombre.set(nombre, round2((porNombre.get(nombre) || 0) + monto));
  });
  const entradas = Array.from(porNombre.entries());
  const ganan = entradas.filter(([, v]) => v >= 0).sort((a, b) => b[1] - a[1]);
  const pierden = entradas.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
  const linea = ([n, v]) => `${formatNombre(n)} ${v < 0 ? '-' : '+'}${formatMontoTabla(v)}`;

  const bloques = ['------------------------------\nPARADA ADELANTADAS'];
  pares.forEach(par => {
    // La primera línea del par es el cliente (con ✅ si ganó / ❌ si perdió);
    // el espejo (MARCAS / TABLAS FIJAS) va debajo, sin marca.
    const [cliente, ...resto] = par;
    bloques.push([`${cliente[1] < 0 ? '❌' : '✅'} ${linea(cliente)}`, ...resto.map(linea)].join('\n'));
  });
  if (ganan.length) bloques.push('✅ *GANAN*\n' + ganan.map(linea).join('\n'));
  if (pierden.length) bloques.push('❌ *PIERDEN*\n' + pierden.map(linea).join('\n'));
  return bloques.join('\n\n');
}

// =================================================================
// JUGADA "SIN COMISIÓN" (07-10-2026, a pedido del usuario: "cuando edite una
// jugada dame la opción de colocarla normal, donde el programa calculará sus %
// normalmente, o SIN COMISIÓN: se guarda con los montos exactos, sin darle
// comisión a nadie ni generar comisión para el grupo; es como un traspaso,
// monto ya neto"). La jugada se resuelve igual con la pizarra (el cliente gana
// o pierde lo mismo de siempre), pero con 0% para TODOS: la contraparte (ítem
// TABLAS FIJAS o los banqueadores) recibe el opuesto EXACTO, no se cobra
// comisión a ningún banquero, no hay comisión del grupo y la jugada no
// genera % devuelto (propio/de aval). Se guarda como bandera
// (`sin_comision`) para no perder el % original si se vuelve a "normal".
// =================================================================
// % de comisión efectivo de una jugada (fila de hipismo_adelantadas_jugadas).
function pctJugada(j) {
  return j && j.sin_comision ? 0 : Number(j.comision_porcentaje);
}

// banqueadores ya guardados de la jugada, con su % propio de comisión en 0 si
// la jugada es "sin comisión" (cada banquero trae el % con el que se calculó).
function banqueadoresJugada(j, volverANormal) {
  let prev = j && j.banqueadores;
  if (typeof prev === 'string') { try { prev = JSON.parse(prev); } catch (e) { prev = null; } }
  if (!Array.isArray(prev)) return prev || null;
  if (j.sin_comision) return prev.map(b => Object.assign({}, b, { comisionPorcentaje: 0 }));
  if (volverANormal) return prev.map(b => Object.assign({}, b, { comisionPorcentaje: null }));
  return prev;
}

// =================================================================
// CABALLO RETIRADO => APUESTA NULA (06-10-2026, a pedido del usuario, caso
// real La Rinconada 11ma: "Ret: 6" y aun así se resolvía la Marca 6x3 y una
// Tabla Fija del 6: "YA QUE RETIRARON UN CABALLO QUE ESTÁ INCLUIDO EN LAS
// MARCAS O EN LAS TABLAS... O EN ALGUNA APUESTA, ESA APUESTA QUEDA NULA").
// Regla general, igual para todos los grupos y todos los clientes: si
// CUALQUIER caballo que forma parte de la apuesta figura en "Ret:" de esa
// carrera, la apuesta no se juega -- 0 para el cliente y para todos, sin
// banqueo, sin comisión, sin % devuelto y sin línea en el plano (mismo
// tratamiento que 'sin_decidir'/nula de siempre).
// =================================================================
// "Ret:" puede traer varios caballos ("6", "6,8", "6 y 8", "6-8"): se toman
// todos los números que aparezcan, sin importar el separador.
function parsearRetirados(ret) {
  const set = new Set();
  String(ret === undefined || ret === null ? '' : ret).split(/[^0-9]+/).filter(Boolean).forEach(n => set.add(parseInt(n, 10)));
  return set;
}

// Acepta un arreglo (o su JSON como texto, o anidado) de números de caballo.
function aplanarCaballos(v) {
  if (v === undefined || v === null || v === '') return [];
  if (typeof v === 'string') {
    try { return aplanarCaballos(JSON.parse(v)); } catch (e) { return parsearRetirados(v).size ? Array.from(parsearRetirados(v)) : []; }
  }
  if (Array.isArray(v)) return v.reduce((acc, x) => acc.concat(aplanarCaballos(x)), []);
  const n = parseInt(v, 10);
  return isNaN(n) ? [] : [n];
}

// true si algún caballo de la apuesta (lista de números) está retirado.
function apuestaConRetirado(caballos, retirados) {
  if (!retirados || !retirados.size) return false;
  return aplanarCaballos(caballos).some(n => retirados.has(n));
}

// Jugada de Tablas Fijas / Marca (fila de hipismo_adelantadas_jugadas).
function adelantadaConRetirado(j, retirados) {
  return apuestaConRetirado(j.tipo === 'tf' ? [j.numero_ejemplar] : [j.numero1, j.numero2], retirados);
}

module.exports = {
  parsearJugadasAdelantadas,
  parsearRetirados,
  pctJugada,
  banqueadoresJugada,
  apuestaConRetirado,
  adelantadaConRetirado,
  contarPosicionesPizarra,
  esMarcaDecidible,
  resolverTablaFija,
  resolverClienteMarca,
  resolverBanqueoMarca,
  banqueoAutomaticoMarca,
  resolverBanqueoTablaFija,
  banqueoAutomaticoTablaFija,
  armarBloqueAdelantadas,
  formatMontoTabla,
  formatNombre,
  round2,
  montoDecidido,
  montoDecididoExacto,
  montoBaseComisionExacto
};
