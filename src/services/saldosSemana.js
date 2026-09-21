// =================================================================
// "📅 Saldos Semana" (21-09-2026, a pedido del usuario — nueva pestaña
// "⬇️ Descargar" en Administración, usable tanto desde el propio panel
// del Grupo como desde Súper-admin: "quiero que me calcule los tickets
// ganados y perdidos y los totales de los clientes... descargar toda la
// semana... a la izquierda el nombre de los clientes y si tiene % su %
// abajo... al lado el saldo semana... y hacia la derecha lunes martes
// miercoles... esto incluye todas las jugadas, pollas, traspaso, todo
// absolutamente todo").
//
// Arma el JSON completo del reporte semanal — la generación de la
// imagen (HD)/PDF/Excel en sí es 100% del lado del navegador (mismo
// criterio que Balance General y Sábanas, ver public/app.js), esta
// función solo deja los NÚMEROS ya calculados y listos para pintar, sin
// que el frontend tenga que volver a sumar nada.
//
// Reusa calcularBalanceSemanalPorCliente() (balanceGeneral.js, ya
// probada por el comando de chat "corte semana" desde el 09-09-2026) —
// esta función es la ÚNICA que hace la cuenta real; acá solo se le
// agrega: (a) el número de semana ISO + rango lunes-domingo (ver
// fechaSemana.js, nuevo), (b) el % propio de cada cliente (que
// calcularBalanceSemanalPorCliente no devuelve, solo el resultado en $),
// (c) TODOS los clientes activos del grupo (igual que "corte semana" del
// bot de WhatsApp — así ningún cliente registrado queda afuera del
// reporte solo porque esta semana puntual no tuvo ningún movimiento; su
// fila sale en $0.00 en vez de faltar), y (d) cada día de la semana
// relleno con ceros para el cliente/columna que no tuvo nada ESE día en
// particular (para que la grilla de 7 días siempre salga completa).
// =================================================================
const { cargarConfigGrupo } = require('./grupoConfig');
const { calcularBalanceSemanalPorCliente } = require('./balanceGeneral');
const { calcularSemana } = require('./fechaSemana');
const { fechaVenezuelaHoy } = require('./fechaVenezuela');

const DIAS_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function diaVacio() {
  return { resultado: 0, comision: 0, arriesgado: 0, ganado: 0, perdido: 0, transferencias: 0, polla: 0, saldoCliente: 0 };
}

// Los 7 días (lunes a domingo) de la semana que arranca en `desde`, con
// su nombre completo y corto — se parsea como UTC, mismo criterio que
// listaDeFechas() en balanceGeneral.js, para que no se corra un día por
// la zona horaria del servidor.
function diasDeLaSemana(desde) {
  const dias = [];
  let actual = new Date(desde + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) {
    const fecha = actual.toISOString().split('T')[0];
    dias.push({ fecha, nombre: DIAS_LARGO[actual.getUTCDay()], corta: DIAS_CORTO[actual.getUTCDay()] });
    actual = new Date(actual.getTime() + 24 * 60 * 60 * 1000);
  }
  return dias;
}

// grupoId/grupoNombre/grupoLogoUrl vienen de quien llama (el propio
// Grupo desde su token, o Súper-admin por :id de la URL — ver
// routes/descargas.js y routes/superadmin.js) para que esta función no
// tenga que decidir de dónde sale el permiso, solo armar el reporte.
async function construirSaldosSemana(grupoId, grupoNombre, grupoLogoUrl, fechaReferencia) {
  const semana = calcularSemana(fechaReferencia || fechaVenezuelaHoy());
  const dias = diasDeLaSemana(semana.desde);

  const config = await cargarConfigGrupo(grupoId);
  const configComision = { modelo: config.modeloComision, tiers: config.tiersComision, modelosPorCliente: config.modelosComisionPorCliente };
  const { porCliente, totalPorFecha } = await calcularBalanceSemanalPorCliente(
    grupoId, semana.desde, semana.hasta, config.porcentajesPropios, config.avalesMap, configComision
  );

  // Mismo criterio que manejarComandoCorteSemana() (whatsappBot.js): TODOS
  // los clientes activos, más cualquiera que tuvo movimiento esta semana
  // aunque ya no esté activo — así nadie con actividad real queda afuera.
  const nombres = config.jugadores.filter(j => j.activo).map(j => j.nombre);
  Object.keys(porCliente).forEach(nombre => { if (!nombres.includes(nombre)) nombres.push(nombre); });
  nombres.sort();

  const clientes = nombres.map(nombre => {
    const c = porCliente[nombre] || {
      totalResultado: 0, totalComision: 0, totalArriesgado: 0, totalGanado: 0,
      totalPerdido: 0, totalTransferencias: 0, totalPolla: 0, totalSaldoCliente: 0, porFecha: {}
    };
    const porDia = {};
    dias.forEach(d => { porDia[d.fecha] = c.porFecha[d.fecha] || diaVacio(); });
    return {
      nombre,
      porcentaje: Number(config.porcentajesPropios[nombre] || 0),
      saldoSemana: c.totalSaldoCliente,
      comisionSemana: c.totalComision,
      arriesgadoSemana: c.totalArriesgado,
      ganadoSemana: c.totalGanado,
      perdidoSemana: c.totalPerdido,
      transferenciasSemana: c.totalTransferencias,
      pollaSemana: c.totalPolla,
      porDia
    };
  });

  const totalPorDia = {};
  dias.forEach(d => { totalPorDia[d.fecha] = totalPorFecha[d.fecha] || diaVacio(); });

  const totales = clientes.reduce((acc, c) => {
    acc.saldoSemana += c.saldoSemana;
    acc.comisionSemana += c.comisionSemana;
    acc.arriesgadoSemana += c.arriesgadoSemana;
    acc.ganadoSemana += c.ganadoSemana;
    acc.perdidoSemana += c.perdidoSemana;
    acc.transferenciasSemana += c.transferenciasSemana;
    acc.pollaSemana += c.pollaSemana;
    return acc;
  }, { saldoSemana: 0, comisionSemana: 0, arriesgadoSemana: 0, ganadoSemana: 0, perdidoSemana: 0, transferenciasSemana: 0, pollaSemana: 0 });
  totales.porDia = totalPorDia;

  return {
    grupo: { nombre: grupoNombre, logoUrl: grupoLogoUrl || null },
    semana: { desde: semana.desde, hasta: semana.hasta, anio: semana.anio, numero: semana.semana, dias },
    clientes,
    totales
  };
}

module.exports = { construirSaldosSemana };
