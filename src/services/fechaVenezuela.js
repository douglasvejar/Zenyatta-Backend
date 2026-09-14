// =================================================================
// FECHA/HORA DE VENEZUELA — América/Caracas está fija en UTC-4 TODO EL
// AÑO (Venezuela no usa horario de verano desde 2016), así que alcanza
// con restarle 4 horas al reloj UTC del servidor — no hace falta ninguna
// librería de zonas horarias.
//
// Se usa para: (a) el reloj que ve el Cliente en su link ("fecha en la
// que estan viendo el reporte con hora exacta de venezuela", a pedido del
// usuario), y (b) la fecha que se guarda en confirmaciones_cliente para
// hacer cumplir "una sola vez por día" — ver services/confirmaciones.js.
// =================================================================
const OFFSET_HORAS = 4;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function ahoraVenezuela() {
  return new Date(Date.now() - OFFSET_HORAS * 60 * 60 * 1000);
}

// 'YYYY-MM-DD' de HOY en Venezuela — misma fecha que usa
// confirmaciones_cliente.fecha para hacer cumplir "una vez por día".
function fechaVenezuelaHoy() {
  const d = ahoraVenezuela();
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mes}-${dia}`;
}

// Texto legible para mostrarle al Cliente, ej.:
// "jueves 2 de septiembre de 2026, 3:45 p. m. (hora de Venezuela)"
function fechaHoraVenezuelaTexto() {
  const d = ahoraVenezuela();
  const diaSemana = DIAS[d.getUTCDay()];
  const dia = d.getUTCDate();
  const mes = MESES[d.getUTCMonth()];
  const anio = d.getUTCFullYear();
  let horas = d.getUTCHours();
  const minutos = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = horas >= 12 ? 'p. m.' : 'a. m.';
  horas = horas % 12;
  if (horas === 0) horas = 12;
  return `${diaSemana} ${dia} de ${mes} de ${anio}, ${horas}:${minutos} ${ampm} (hora de Venezuela)`;
}

module.exports = { fechaVenezuelaHoy, fechaHoraVenezuelaTexto };
