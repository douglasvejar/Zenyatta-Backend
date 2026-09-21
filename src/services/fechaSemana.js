// =================================================================
// SEMANA ISO-8601 (21-09-2026, a pedido del usuario, pestaña nueva
// "⬇️ Descargar" > "📅 Saldos Semana": "arriba fecha, y semana en la que
// estamos del año"). Ninguna otra parte del proyecto calculaba todavía
// un NÚMERO de semana del año — calcularRangoRapido('semana')
// (historial.js) ya arma el lunes-a-domingo de la semana actual, pero
// nunca le pone un número — así que se agrega este archivo chiquito y
// aparte en vez de mezclarlo ahí.
//
// Convención ISO-8601 (la misma que usan calendarios/agendas comunes):
// la semana arranca LUNES, y la Semana 1 de un año es la que contiene el
// primer JUEVES de ese año (equivalente a "la semana que contiene el
// 4 de enero"). Todo en UTC, mismo criterio que listaDeFechas() en
// balanceGeneral.js, para que una fecha 'YYYY-MM-DD' nunca se corra un
// día por la zona horaria del servidor.
// =================================================================
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function formatearFechaISO(d) {
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mes}-${dia}`;
}

// Lunes (00:00 UTC) de la semana que contiene `fechaISO`.
function lunesDeLaSemana(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  const diaSemana = d.getUTCDay(); // 0 = domingo ... 6 = sábado
  const diffHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(d.getTime() + diffHastaLunes * UN_DIA_MS);
  return lunes;
}

// { anio, semana } ISO-8601 de la semana que contiene `fechaISO` — el
// "año de la semana" puede diferir del año calendario en los bordes de
// diciembre/enero (ej. el lunes 30-12-2024 ya es semana 1 de 2025).
function numeroSemanaISO(fechaISO) {
  const lunes = lunesDeLaSemana(fechaISO);
  // El jueves de esta misma semana decide a qué año-ISO pertenece toda
  // la semana (la semana "pertenece" al año que tiene más días de ella).
  const jueves = new Date(lunes.getTime() + 3 * UN_DIA_MS);
  const anio = jueves.getUTCFullYear();

  let primerJueves = new Date(Date.UTC(anio, 0, 1));
  while (primerJueves.getUTCDay() !== 4) {
    primerJueves = new Date(primerJueves.getTime() + UN_DIA_MS);
  }

  const semana = 1 + Math.round((jueves.getTime() - primerJueves.getTime()) / (7 * UN_DIA_MS));
  return { anio, semana };
}

// Semana completa (lunes a domingo) que contiene `fechaReferenciaISO`,
// con su número ISO — esto es lo que consume services/saldosSemana.js
// para armar el reporte de "📅 Saldos Semana".
function calcularSemana(fechaReferenciaISO) {
  const lunes = lunesDeLaSemana(fechaReferenciaISO);
  const domingo = new Date(lunes.getTime() + 6 * UN_DIA_MS);
  const desde = formatearFechaISO(lunes);
  const hasta = formatearFechaISO(domingo);
  const { anio, semana } = numeroSemanaISO(desde);
  return { desde, hasta, anio, semana };
}

module.exports = { calcularSemana, numeroSemanaISO, formatearFechaISO };
