// =================================================================
// hipismoOficinasCalc.js (09-10-2026) — HIPISMO OFICINAS: cuadre de la carrera y armado del plano.
// =================================================================
// Pedido del usuario: un módulo igual a "Hipismo Grupos Hípicos" (mismos cálculos) donde las jugadas
// NO se pegan como plano de texto sino que se cargan en una tabla:
//     jugador | jugó / dio | tipo de jugada (2p, 3n, 1p…) | caballo | monto
// y la carrera solo se puede guardar cuando lo que JUGARON es igual a lo que DIERON. Si no cuadra, una
// ventana dice cuánto falta (ej. "jose jugó 1p del 3 200 / raul jugó 1p del 3 150": faltan 350 por dar).
//
// Decisiones confirmadas con el usuario:
//   - El cuadre es por TIPO + CABALLO (1p del 3 contra 1p del 3), no solo por el total de la carrera.
//   - La llegada (pizarra) se carga junto con las jugadas y el cálculo sale al guardar.
//
// Cómo se calcula: este archivo NO calcula resultados. Empareja a los que jugaron con los que dieron y arma
// un plano de texto en el formato de 3 líneas que ya entiende el motor de siempre (hipismoCalc.calcularPlano):
//     1p (3) con 200
//     Juega JOSE
//     Consigue RAUL
// Así los resultados, el 5%, el cruce y los % devueltos son EXACTAMENTE los de Grupos Hípicos.
//
// Por qué el emparejamiento en orden no cambia nada: dentro de un mismo tipo + caballo todos los jugadores
// tienen la misma razón de ganancia/pérdida (el motor es lineal), así que repartir lo que jugó cada uno entre
// los que dieron en cualquier orden da los mismos totales por persona.
// =================================================================
const { round2 } = require('./hipismoAdelantadasCalc');
const { calcularPlano, normalizarModalidadCombo } = require('./hipismoCalc');

const LADOS = ['jugo', 'dio'];

function nombreCanonico(n) {
  return String(n || '').trim().toUpperCase().replace(/\s+/g, ' ');
}
function tipoCanonico(t) {
  return normalizarModalidadCombo(String(t || '').trim()).replace(/\s+/g, ' ');
}
function caballoCanonico(c) {
  return String(c || '').trim().replace(/\s+/g, '').replace(/X/g, 'x');
}
// "4x3" y "3x4" son el mismo cruce visto desde el otro lado: la clave los junta.
function claveCaballo(c) {
  const cab = caballoCanonico(c);
  const m = cab.match(/^(\d{1,2})x(\d{1,2})$/);
  if (m) return [m[1], m[2]].map(Number).sort((a, b) => a - b).join('x');
  return cab;
}
function claveGrupo(e) {
  return tipoCanonico(e.tipo).toLowerCase().replace(/\s+/g, '') + '|' + claveCaballo(e.caballo);
}
function etiquetaGrupo(tipo, caballo) {
  return `${tipoCanonico(tipo)} del ${caballoCanonico(caballo)}`;
}
function montoComoNumero(m) {
  if (typeof m === 'number') return m;
  const s = String(m === undefined || m === null ? '' : m).trim().replace(/\s/g, '');
  if (!s) return NaN;
  // "1.250,50" (punto de miles + coma decimal) o "1250.50" / "1250,5"
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return parseFloat(s.replace(',', '.'));
}

// Limpia y valida las filas de la tabla. Devuelve { entradas, errores } — errores por fila (1-based).
function normalizarEntradas(filas) {
  const entradas = [];
  const errores = [];
  (Array.isArray(filas) ? filas : []).forEach((f, i) => {
    if (!f) return;
    const vacia = !String(f.jugador || '').trim() && !String(f.tipo || '').trim() && !String(f.caballo || '').trim() && (f.monto === '' || f.monto === undefined || f.monto === null);
    if (vacia) return; // una fila en blanco de la tabla no es un error
    const n = i + 1;
    const jugador = nombreCanonico(f.jugador);
    const lado = String(f.lado || '').toLowerCase().replace('ó', 'o');
    const tipo = tipoCanonico(f.tipo);
    const caballo = caballoCanonico(f.caballo);
    const monto = round2(montoComoNumero(f.monto));
    if (!jugador) errores.push({ fila: n, error: 'Falta el jugador.' });
    else if (!LADOS.includes(lado)) errores.push({ fila: n, error: 'Elige si jugó o dio.' });
    else if (!tipo) errores.push({ fila: n, error: 'Falta el tipo de jugada (2p, 3n…).' });
    else if (!caballo) errores.push({ fila: n, error: 'Falta el caballo.' });
    else if (!(monto > 0)) errores.push({ fila: n, error: 'El monto debe ser mayor que 0.' });
    else entradas.push({ jugador, lado, tipo, caballo, monto });
  });
  return { entradas, errores };
}

// Agrupa por tipo + caballo, neteando a la misma persona que aparezca de los 2 lados en el mismo grupo
// (jugó 100 y dio 100 en el mismo 1p del 3 = no hay nada que emparejar).
function agruparPorTipoYCaballo(entradas) {
  const mapa = new Map();
  for (const e of entradas) {
    const k = claveGrupo(e);
    if (!mapa.has(k)) mapa.set(k, { clave: k, tipo: e.tipo, caballo: e.caballo, personas: new Map() });
    const g = mapa.get(k);
    const previo = g.personas.get(e.jugador) || { neto: 0, caballoJugo: null };
    // En un cruce ("4x3") quien juega va con SU caballo (el primero que escribió): se recuerda para armar el plano.
    if (e.lado === 'jugo' && !previo.caballoJugo) previo.caballoJugo = e.caballo;
    previo.neto = round2(previo.neto + (e.lado === 'jugo' ? e.monto : -e.monto));
    g.personas.set(e.jugador, previo);
  }
  const grupos = [];
  for (const g of mapa.values()) {
    const jugaron = [], dieron = [];
    for (const [nombre, { neto, caballoJugo }] of g.personas) {
      if (neto > 0) jugaron.push({ nombre, monto: neto, caballo: caballoJugo || g.caballo });
      else if (neto < 0) dieron.push({ nombre, monto: round2(-neto) });
    }
    const jugo = round2(jugaron.reduce((s, x) => s + x.monto, 0));
    const dio = round2(dieron.reduce((s, x) => s + x.monto, 0));
    grupos.push({ clave: g.clave, tipo: g.tipo, caballo: g.caballo, etiqueta: etiquetaGrupo(g.tipo, g.caballo), jugaron, dieron, jugo, dio });
  }
  return grupos;
}

// Cuadre por tipo + caballo. falta > 0 en 'dio' = faltan por dar; en 'jugo' = faltan por jugar.
function calcularCuadre(filas) {
  const { entradas, errores } = normalizarEntradas(filas);
  const grupos = agruparPorTipoYCaballo(entradas);
  const detalle = grupos.map(g => {
    const diferencia = round2(g.jugo - g.dio);
    return {
      etiqueta: g.etiqueta, tipo: g.tipo, caballo: g.caballo,
      jugo: g.jugo, dio: g.dio, diferencia,
      cuadra: diferencia === 0,
      // Quién falta: si jugaron más de lo que dieron, falta que alguien dé la diferencia (y al revés).
      falta: Math.abs(diferencia),
      faltaLado: diferencia > 0 ? 'dio' : (diferencia < 0 ? 'jugo' : null),
      jugaron: g.jugaron, dieron: g.dieron
    };
  });
  const descuadrados = detalle.filter(d => !d.cuadra);
  const mensajes = descuadrados.map(d => d.faltaLado === 'dio'
    ? `${d.etiqueta}: jugaron ${d.jugo} y dieron ${d.dio} — faltan ${d.falta} por dar.`
    : `${d.etiqueta}: jugaron ${d.jugo} y dieron ${d.dio} — faltan ${d.falta} por jugar (o sobran ${d.falta} dados).`);
  const totalJugo = round2(detalle.reduce((sum, d) => sum + d.jugo, 0));
  // Si todo se anula entre sí (una misma persona jugó y dio lo mismo) no queda nada que emparejar ni guardar.
  if (entradas.length > 0 && descuadrados.length === 0 && totalJugo === 0) {
    mensajes.push('Las jugadas se anulan entre sí (la misma persona jugó y dio lo mismo): no hay nada que guardar.');
  }
  return {
    cuadra: errores.length === 0 && entradas.length > 0 && descuadrados.length === 0 && totalJugo > 0,
    hayJugadas: entradas.length > 0,
    errores, detalle, mensajes,
    totalJugo,
    totalDio: round2(detalle.reduce((s, d) => s + d.dio, 0))
  };
}

// Empareja (en orden) a los que jugaron con los que dieron. Cada pareja es un ticket del plano.
function emparejar(filas) {
  const { entradas } = normalizarEntradas(filas);
  const grupos = agruparPorTipoYCaballo(entradas);
  const parejas = [];
  for (const g of grupos) {
    const jugaron = g.jugaron.map(x => ({ ...x }));
    const dieron = g.dieron.map(x => ({ ...x }));
    let i = 0, j = 0;
    while (i < jugaron.length && j < dieron.length) {
      const m = round2(Math.min(jugaron[i].monto, dieron[j].monto));
      if (m > 0) parejas.push({ jugador: jugaron[i].nombre, banquero: dieron[j].nombre, tipo: g.tipo, caballo: jugaron[i].caballo || g.caballo, monto: m });
      jugaron[i].monto = round2(jugaron[i].monto - m);
      dieron[j].monto = round2(dieron[j].monto - m);
      if (jugaron[i].monto <= 0) i++;
      if (dieron[j].monto <= 0) j++;
    }
  }
  return parejas;
}

function montoParaTexto(n) {
  return String(round2(n)).replace('.', ',');
}
// Para el caballo cruzado ("4x3") el jugador va con el PRIMER caballo escrito, igual que en el plano.
function armarTextoPlano(parejas) {
  return parejas.map(p => [
    `${p.tipo} (${p.caballo}) con ${montoParaTexto(p.monto)}`,
    `Juega ${p.jugador}`,
    `Consigue ${p.banquero}`
  ].join('\n')).join('\n\n');
}

// Prueba cada tipo + caballo contra el motor con una llegada de mentira para avisar ANTES de guardar si algo
// no se reconoce (un tipo mal escrito). Devuelve la lista de etiquetas que el motor no entiende.
function tiposNoReconocidos(filas) {
  const { entradas } = normalizarEntradas(filas);
  const vistos = new Map();
  for (const e of entradas) if (!vistos.has(claveGrupo(e))) vistos.set(claveGrupo(e), e);
  const pizarraPrueba = Array.from({ length: 20 }, (_, i) => i + 1).join('-');
  const malos = [];
  for (const e of vistos.values()) {
    const texto = armarTextoPlano([{ jugador: 'A', banquero: 'B', tipo: e.tipo, caballo: e.caballo, monto: 100 }]);
    let r;
    try { r = calcularPlano({ texto, pizarra: pizarraPrueba, cruzar: false }); } catch (err) { r = null; }
    if (!r || !r.huboLineas || r.sinReconocer.length) malos.push(etiquetaGrupo(e.tipo, e.caballo));
  }
  return malos;
}

module.exports = {
  normalizarEntradas, calcularCuadre, emparejar, armarTextoPlano, tiposNoReconocidos,
  nombreCanonico, tipoCanonico, caballoCanonico, claveGrupo, montoComoNumero
};
