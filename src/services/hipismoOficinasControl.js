// =================================================================
// HIPISMO OFICINAS — control del día y de los períodos (05-11-2026, a pedido del usuario: "aviso de carreras pendientes en el
// Balance General" y "cierre del día: qué carreras faltan por cargar o por calcular, y que cuadre el día contra el Balance General").
//
// Solo LEE: no cambia ninguna carrera ni saldo.
//   carrerasPendientesPeriodo(grupoId, desde, hasta)  -> carreras guardadas SIN llegada (no cuentan en los saldos) dentro del período
//   construirCierreDia(grupoId, fecha)                -> por hipódromo, qué carreras están calculadas / pendientes / en hueco, y si el
//                                                        saldo de todos los clientes + la comisión de la oficina da 0 ese día
// "Hueco": un número de carrera que falta entre la 1 y la última cargada de ese hipódromo ese día (puede ser normal, pero conviene
// mirarlo: es lo que pasa cuando se olvida cargar una carrera).
// =================================================================
const db = require('../db');
const { round2 } = require('./hipismoAdelantadasCalc');

const iso = f => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f || '').slice(0, 10));

async function carrerasPendientesPeriodo(grupoId, desde, hasta) {
  let filas = [];
  try {
    const r = await db.query(
      `SELECT fecha, hipodromo_nombre, carrera_numero FROM hipismo_oficinas_pendientes
        WHERE grupo_id = $1 AND fecha BETWEEN $2 AND $3 ORDER BY fecha, hipodromo_nombre, carrera_numero`,
      [grupoId, desde, hasta]
    );
    filas = r.rows || [];
  } catch (e) {
    if (!e || e.code !== '42P01') throw e; // todavía no existe la tabla (falta el SQL): no hay pendientes
  }
  const carreras = filas.map(f => ({ fecha: iso(f.fecha), hipodromo: f.hipodromo_nombre, carrera: Number(f.carrera_numero) }));
  return { rango: { desde, hasta }, total: carreras.length, carreras };
}

// Pura (se prueba sin base): planos = [{hipodromo_nombre, carrera_numero}] calculadas; pendientes = igual; cierre = respuesta de
// construirCierreFinalHipismo para ese día (clientes[{nombre, saldo}], comisionSemana).
function armarCierreDia({ fecha, planos, pendientes, cierre }) {
  const porHip = new Map();
  const tomar = (nombre) => { if (!porHip.has(nombre)) porHip.set(nombre, new Map()); return porHip.get(nombre); };
  (planos || []).forEach(p => { const m = tomar(p.hipodromo_nombre); if (!m.has(Number(p.carrera_numero))) m.set(Number(p.carrera_numero), 'calculada'); });
  (pendientes || []).forEach(p => { const m = tomar(p.hipodromo_nombre); if (!m.has(Number(p.carrera_numero))) m.set(Number(p.carrera_numero), 'pendiente'); });
  const hipodromos = Array.from(porHip.entries()).map(([nombre, mapa]) => {
    const numeros = Array.from(mapa.keys()).sort((a, b) => a - b);
    const maximo = numeros.length ? numeros[numeros.length - 1] : 0;
    const faltantes = [];
    for (let n = 1; n <= maximo; n++) if (!mapa.has(n)) faltantes.push(n);
    return {
      nombre, faltantes,
      calculadas: numeros.filter(n => mapa.get(n) === 'calculada').length,
      pendientes: numeros.filter(n => mapa.get(n) === 'pendiente').length,
      carreras: numeros.map(n => ({ numero: n, estado: mapa.get(n) }))
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const clientes = ((cierre && cierre.clientes) || []).map(c => ({ nombre: c.nombre, saldo: round2(c.saldo) }));
  const totalClientes = round2(clientes.reduce((s, c) => s + c.saldo, 0));
  const comisionOficina = round2(Number(cierre && cierre.comisionSemana) || 0);
  const diferencia = round2(totalClientes + comisionOficina);
  const cuadra = Math.abs(diferencia) < 0.01;

  const totales = {
    carreras: hipodromos.reduce((s, h) => s + h.calculadas + h.pendientes, 0),
    calculadas: hipodromos.reduce((s, h) => s + h.calculadas, 0),
    pendientes: hipodromos.reduce((s, h) => s + h.pendientes, 0),
    huecos: hipodromos.reduce((s, h) => s + h.faltantes.length, 0)
  };
  const avisos = [];
  if (!totales.carreras) avisos.push({ nivel: 'info', texto: 'Ese día no hay carreras cargadas.' });
  if (totales.pendientes) avisos.push({ nivel: 'error', texto: `${totales.pendientes} ${totales.pendientes === 1 ? 'carrera está' : 'carreras están'} sin llegada: no cuentan en los saldos hasta que se les cargue la pizarra.` });
  hipodromos.filter(h => h.faltantes.length).forEach(h => avisos.push({ nivel: 'aviso', texto: `${h.nombre}: no hay carga de la carrera ${h.faltantes.join(', ')} (hay otras con número mayor).` }));
  if (totales.carreras && !cuadra) avisos.push({ nivel: 'error', texto: `El día no cuadra: saldo de todos los clientes + comisión de la oficina da ${diferencia}.` });
  return {
    fecha, hipodromos, totales,
    saldos: { totalClientes, comisionOficina, diferencia, cuadra, clientes },
    avisos,
    listo: totales.carreras > 0 && totales.pendientes === 0 && cuadra
  };
}

async function construirCierreDia(grupoId, fecha, construirCierreFinal) {
  const [rPlanos, rPend] = await Promise.all([
    db.query('SELECT hipodromo_nombre, carrera_numero FROM hipismo_planos WHERE grupo_id = $1 AND fecha = $2 AND jugadas_oficina IS NOT NULL', [grupoId, fecha]),
    db.query('SELECT hipodromo_nombre, carrera_numero FROM hipismo_oficinas_pendientes WHERE grupo_id = $1 AND fecha = $2', [grupoId, fecha]).catch(e => {
      if (e && e.code === '42P01') return { rows: [] };
      throw e;
    })
  ]);
  const cierre = await construirCierreFinal(grupoId, fecha, fecha);
  return armarCierreDia({ fecha, planos: rPlanos.rows, pendientes: rPend.rows, cierre });
}

module.exports = { carrerasPendientesPeriodo, armarCierreDia, construirCierreDia };
