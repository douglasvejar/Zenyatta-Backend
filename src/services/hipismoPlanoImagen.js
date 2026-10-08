// =================================================================
// hipismoPlanoImagen.js (07-10-2026) — DATOS PARA LA IMAGEN DEL PLANO.
// Pedido del usuario: en Cargar Planos, además de "Copiar en texto" (el plano
// de siempre), un botón "Copiar en imagen" que arma una tarjeta con la llegada,
// lo que jugó cada cliente (modalidad + caballo, monto, quién da, resultado),
// el logo del grupo de fondo y, abajo, ordenado, quiénes ganan y quiénes
// pierden; y que al pegarla en WhatsApp vaya acompañada del texto
// "TOTALES DE LA CARRERA XXXX EN EL HIPÓDROMO XXXX EN EL GRUPO XXXX".
//
// La imagen se dibuja en el navegador (public/hipismo-mockup.html); este
// archivo solo arma los DATOS, con las MISMAS fuentes que el texto del plano
// (tickets calculados, totalesFinales y los movimientos de adelantadas), para
// que la imagen y el texto nunca muestren números distintos. No calcula nada
// nuevo: solo ordena y formatea lo que ya calculó el motor. Nunca incluye la
// comisión del grupo ni los nombres reales de los banqueadores de Marcas/TF
// (en el plano esos salen como el ítem genérico, igual que en el texto).
// =================================================================
const { formatNombre, ordinalCarrera } = require('./hipismoCalc');
const { agruparSeccionesAdelantadas, parsearRetirados } = require('./hipismoAdelantadasCalc');

const redondear = n => Math.round((Number(n) || 0) * 100) / 100;

// "TOTALES DE LA CARRERA 11MA EN EL HIPÓDROMO LA RINCONADA EN EL GRUPO ZENYATTA"
// (todo en mayúsculas, como lo pidió el usuario). Si falta la carrera o el
// hipódromo se omite esa parte en vez de dejar un hueco.
function armarTextoAcompanante({ grupoNombre, hipodromoNombre, carreraNumero }) {
  const carrera = (carreraNumero !== undefined && carreraNumero !== null && String(carreraNumero).trim() !== '')
    ? ` ${ordinalCarrera(carreraNumero)}` : '';
  const hipodromo = hipodromoNombre && String(hipodromoNombre).trim() ? ` EN EL HIPÓDROMO ${String(hipodromoNombre).trim()}` : '';
  const grupo = grupoNombre && String(grupoNombre).trim() ? ` EN EL GRUPO ${String(grupoNombre).trim()}` : '';
  return `TOTALES DE LA CARRERA${carrera}${hipodromo}${grupo}`.toUpperCase();
}

function ordenarTotales(totalesFinales) {
  const entradas = Object.entries(totalesFinales || {}).map(([n, v]) => [formatNombre(n), redondear(v)]);
  return {
    ganan: entradas.filter(([, v]) => v >= 0).sort((a, b) => b[1] - a[1]),
    pierden: entradas.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1])
  };
}

function armarDatosImagenPlano({ grupoNombre, hipodromoNombre, carreraNumero, fecha, ret, pizarra, tickets, totalesFinales, movimientosAdelantadas }) {
  const llegada = String(pizarra || '').trim().split(/[\s,]+/).filter(Boolean);
  const retirados = Array.from(parsearRetirados(ret)).sort((a, b) => a - b);
  const jugadas = (tickets || []).map(t => ({
    cliente: formatNombre(t.clienteNombre),
    modalidad: String(t.modalidad || ''),
    caballo: String(t.caballo === undefined || t.caballo === null ? '' : t.caballo),
    monto: redondear(t.monto),
    banquero: formatNombre(t.banqueroNombre),
    resultado: redondear(t.resultadoJugador)
  }));
  const { ganan, pierden } = ordenarTotales(totalesFinales);

  // PARADA ADELANTADAS, separada en secciones (08-10-2026): Tablas Fijas, Marcas
  // Adelantadas y Jugadas entre Tercios Adelantadas, cada una con su título (las
  // mismas del texto del plano). Cada Tabla Fija / Marca es su propio renglón
  // (cliente + ítem genérico); las Jugadas entre Tercios Adelantadas se suman por
  // nombre. `filas` junta todas (para contar renglones y para clientes viejos).
  let adelantadas = null;
  if (movimientosAdelantadas && movimientosAdelantadas.length) {
    const secciones = agruparSeccionesAdelantadas(movimientosAdelantadas).map(sec => {
      const filas = sec.pares.map(par => ({ cliente: formatNombre(par[0][0]), item: par[1] ? formatNombre(par[1][0]) : '', resultado: redondear(par[0][1]) }));
      [...sec.ganan, ...sec.pierden].forEach(([n, v]) => filas.push({ cliente: formatNombre(n), item: '', resultado: redondear(v) }));
      return { clave: sec.clave, titulo: sec.titulo, filas };
    });
    adelantadas = { secciones, filas: secciones.reduce((acc, sec) => acc.concat(sec.filas), []) };
  }

  return {
    grupo: grupoNombre || '',
    hipodromo: hipodromoNombre || '',
    carrera: carreraNumero === undefined || carreraNumero === null || carreraNumero === '' ? null : Number(carreraNumero),
    carreraTexto: (carreraNumero === undefined || carreraNumero === null || carreraNumero === '') ? '' : ordinalCarrera(carreraNumero),
    fecha: fecha || null,
    llegada,
    retirados,
    jugadas,
    ganan,
    pierden,
    adelantadas,
    textoAcompanante: armarTextoAcompanante({ grupoNombre, hipodromoNombre, carreraNumero })
  };
}

module.exports = { armarDatosImagenPlano, armarTextoAcompanante, ordenarTotales };
