// =================================================================
// SOCIOS DE HIPISMO y "COMISIONES POR AVALES Y SOCIOS" (25-10-2026, a pedido del usuario: "cuando creas un cliente colocas avalado
// por (una lista con los socios del grupo; la distribución de los socios debe dar exactamente el 100%) y en esa ventana te coloca
// ordenado cuánto produjo cada cliente en comisión (ya devolviendo los %) por a quién pertenece, y debe dar exacto a la comisión
// que se ve en Balance General y Cierre"; sobre el % de cada socio respondió: "cuánto le toca a cada socio del total").
//
// Todo lo de este archivo es PURO (sin base de datos) para poder probarlo: validar la lista de socios, repartir un total en centavos
// según porcentajes (método del mayor resto, la suma sale EXACTA) y armar el reporte a partir de lo que ya calcula el Cierre Final
// (construirCierreFinalHipismo con { comisionPorCliente: true }).
//
// Cuentas: neto de un cliente = comisión bruta que generó − % que se devolvió por sus jugadas. La suma de los netos de todos los
// clientes + "Ajustes" (lo que no se puede atribuir a un cliente) es SIEMPRE la comisión del Cierre Final, al centavo.
// =================================================================

function normalizarNombreSocio(t) {
  return ((t == null ? '' : t) + '').trim().toUpperCase().replace(/\s+/g, ' ');
}
const aCentavos = n => Math.round((Number(n) || 0) * 100 + (Number(n) < 0 ? -1e-9 : 1e-9));
const deCentavos = c => c / 100;

// Valida la lista completa de socios que manda la pantalla de Ajustes. Una lista vacía es válida (el grupo no usa socios).
// Con socios: nombres no vacíos y distintos, % entre 0 y 100, y la suma EXACTAMENTE 100.
function validarConfigSocios(lista) {
  if (!Array.isArray(lista)) return { error: 'Falta la lista de socios.' };
  const socios = [];
  const vistos = new Set();
  for (const s of lista) {
    const nombre = normalizarNombreSocio(s && s.nombre);
    if (!nombre) return { error: 'Todos los socios necesitan un nombre.' };
    if (vistos.has(nombre)) return { error: `El socio ${nombre} está repetido.` };
    vistos.add(nombre);
    const pct = Number(s && s.porcentaje);
    if (!isFinite(pct) || pct < 0 || pct > 100) return { error: `El porcentaje de ${nombre} debe estar entre 0 y 100.` };
    socios.push({ id: (s && s.id) || null, nombre, porcentaje: Math.round(pct * 10000) / 10000 });
  }
  if (socios.length) {
    const suma = socios.reduce((a, s) => a + Math.round(s.porcentaje * 10000), 0);
    if (suma !== 1000000) return { error: `La distribución de los socios debe sumar exactamente 100% (ahora suma ${(suma / 10000).toLocaleString('es-VE', { maximumFractionDigits: 4 })}%).`, suma: suma / 10000 };
  }
  return { socios };
}

// Reparte `totalCentavos` (entero, puede ser negativo) según `porcentajes` (suman 100) en centavos enteros, por mayor resto.
function repartirCentavosPorPorcentajes(totalCentavos, porcentajes) {
  const signo = totalCentavos < 0 ? -1 : 1;
  const total = Math.abs(totalCentavos);
  const suma = porcentajes.reduce((a, p) => a + (Number(p) || 0), 0) || 1;
  const partes = porcentajes.map((p, i) => {
    const exacto = total * (Number(p) || 0) / suma;
    const piso = Math.floor(exacto + 1e-9);
    return { i, piso, resto: exacto - piso };
  });
  let faltan = total - partes.reduce((a, p) => a + p.piso, 0);
  partes.slice().sort((a, b) => b.resto - a.resto || a.i - b.i).forEach(p => { if (faltan > 0) { p.piso += 1; faltan -= 1; } });
  return partes.map(p => signo * p.piso);
}

// cierre: lo que devuelve construirCierreFinalHipismo(..., { comisionPorCliente: true }).
// socios: [{id, nombre, porcentaje}] del grupo; jugadores: [{nombre, hipismo_socio_id}].
function armarReporteSocios({ cierre, socios, jugadores, rango, nombreGrupo }) {
  const bruta = (cierre && cierre.comisionBrutaPorCliente) || {};
  const devuelto = (cierre && cierre.devueltoPorOrigen) || {};
  const socioDe = new Map();
  (jugadores || []).forEach(j => { if (j.hipismo_socio_id) socioDe.set(normalizarNombreSocio(j.nombre), j.hipismo_socio_id); });
  const nombresClientes = new Set([...Object.keys(bruta), ...Object.keys(devuelto)]);

  const tarjetas = (socios || []).map(s => ({ id: s.id, nombre: s.nombre, porcentaje: Number(s.porcentaje), clientes: [], totalCentavos: 0 }));
  const porId = new Map(tarjetas.map(t => [t.id, t]));
  const sinSocio = { clientes: [], totalCentavos: 0 };

  nombresClientes.forEach(nombre => {
    const c = aCentavos(bruta[nombre]) - aCentavos(devuelto[nombre]);
    if (!c) return;
    const destino = porId.get(socioDe.get(normalizarNombreSocio(nombre))) || sinSocio;
    destino.clientes.push({ nombre, centavos: c });
    destino.totalCentavos += c;
  });
  const ordenar = lista => lista.sort((a, b) => b.centavos - a.centavos || a.nombre.localeCompare(b.nombre, 'es'));
  tarjetas.forEach(t => ordenar(t.clientes));
  ordenar(sinSocio.clientes);

  const ajusteCentavos = aCentavos(cierre && cierre.comisionSinAtribuir);
  if (ajusteCentavos) { sinSocio.clientes.push({ nombre: 'AJUSTES (redondeo y comisión sin cliente)', centavos: ajusteCentavos, esAjuste: true }); sinSocio.totalCentavos += ajusteCentavos; }

  const comisionTotalCentavos = aCentavos(cierre && cierre.comisionSemana);
  const sumaCentavos = tarjetas.reduce((a, t) => a + t.totalCentavos, 0) + sinSocio.totalCentavos;
  const porSocioCentavos = tarjetas.length ? repartirCentavosPorPorcentajes(comisionTotalCentavos, tarjetas.map(t => t.porcentaje)) : [];

  const fmt = lista => lista.map(c => ({ nombre: c.nombre, monto: deCentavos(c.centavos), ...(c.esAjuste ? { esAjuste: true } : {}) }));
  return {
    activo: tarjetas.length > 0,
    nombreGrupo: nombreGrupo || null,
    rango,
    comisionTotal: deCentavos(comisionTotalCentavos),
    sumaTarjetas: deCentavos(sumaCentavos),
    diferencia: deCentavos(comisionTotalCentavos - sumaCentavos),
    cuadra: comisionTotalCentavos === sumaCentavos,
    socios: tarjetas.map(t => ({ id: t.id, nombre: t.nombre, porcentaje: t.porcentaje, clientes: fmt(t.clientes), total: deCentavos(t.totalCentavos) })),
    sinSocio: sinSocio.clientes.length ? { clientes: fmt(sinSocio.clientes), total: deCentavos(sinSocio.totalCentavos) } : null,
    porSocio: tarjetas.map((t, i) => ({ id: t.id, nombre: t.nombre, porcentaje: t.porcentaje, monto: deCentavos(porSocioCentavos[i]), produjo: deCentavos(t.totalCentavos) }))
  };
}

module.exports = { normalizarNombreSocio, validarConfigSocios, repartirCentavosPorPorcentajes, armarReporteSocios };
