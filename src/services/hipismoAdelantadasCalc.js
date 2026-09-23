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
// MARCAS ("<num1>x<num2> <monto>$", ej. "4x7 120$"): una combinada al
// 1er y 2do lugar exactos de la carrera (num1 = 1er lugar, num2 = 2do).
// A diferencia de Tablas Fijas, el pago no es fijo por unidad: si
// acierta, se paga monto/1.2 (confirmado con el usuario: 120$ → paga
// 100$ si acierta) — ese 100 es la ganancia COMPLETA del cliente, sin
// netear el monto jugado. Si NO acierta, el cliente pierde el monto
// completo (confirmado explícitamente: "si no acierta houston pierde
// completo").
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
// alcanzan): con una pizarra completa de 5 puestos, el 1er y 2do lugar
// siempre se conocen con certeza, así que una marca SIEMPRE es
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

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
    if (mCliente) { clienteActual = mCliente[1].trim().toUpperCase(); return; }

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

// resolverClienteMarca(jugada, rank) -> { acierta, resultadoCliente,
// base } — solo el lado del cliente (no depende de quién banquea). El
// "acierta" exige 1er Y 2do lugar exactos, en ese orden.
function resolverClienteMarca({ numero1, numero2, monto }, rank) {
  const acierta = rank(numero1) === 1 && rank(numero2) === 2;
  if (acierta) {
    const base = round2(monto / 1.2);
    return { acierta, base, resultadoCliente: base };
  }
  return { acierta, base: monto, resultadoCliente: -monto };
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
  const resueltos = (banqueadores || []).map(b => {
    const porcentaje = Number(b.porcentaje) || 0;
    const parte = round2(base * (porcentaje / 100));
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

function formatMontoTabla(n) {
  return Math.abs(n).toFixed(2).replace('.', ',');
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
  const porNombre = new Map();
  movimientos.forEach(({ nombre, monto }) => {
    porNombre.set(nombre, round2((porNombre.get(nombre) || 0) + monto));
  });
  const entradas = Array.from(porNombre.entries());
  const ganan = entradas.filter(([, v]) => v >= 0).sort((a, b) => b[1] - a[1]);
  const pierden = entradas.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);

  const bloques = ['------------------------------\nPARADA ADELANTADAS'];
  if (ganan.length) bloques.push('✅ *GANAN*\n' + ganan.map(([n, v]) => `${formatNombre(n)} +${formatMontoTabla(v)}`).join('\n'));
  if (pierden.length) bloques.push('❌ *PIERDEN*\n' + pierden.map(([n, v]) => `${formatNombre(n)} -${formatMontoTabla(v)}`).join('\n'));
  return bloques.join('\n\n');
}

module.exports = {
  parsearJugadasAdelantadas,
  contarPosicionesPizarra,
  esMarcaDecidible,
  resolverTablaFija,
  resolverClienteMarca,
  resolverBanqueoMarca,
  armarBloqueAdelantadas,
  formatMontoTabla,
  formatNombre,
  round2
};
