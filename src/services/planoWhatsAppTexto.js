// =================================================================
// TEXTO LISTO PARA WHATSAPP — versión de SERVIDOR (03-09-2026, más tarde
// todavía, a pedido del usuario: "el programa envie la sabana a medida
// de que se vaya teniendo resultados... al enviar sabana final...
// enviar la sabana y despues otro mensaje con todos los totales del
// dia").
//
// El botón "Generar Plano de WhatsApp" (public/app.js, generarPlanoWhatsApp()
// + construirPlanoDesdeRespuesta()) ya arma exactamente este mismo texto
// para cuando un humano copia/pega a mano — pero esa versión vive en el
// NAVEGADOR (usa `document`) y whatsappBot.js necesita mandar estos
// mismos mensajes SOLO, sin ningún navegador de por medio. Por eso este
// archivo es un PORT 1 a 1 de esas mismas fórmulas al backend (mismos
// nombres de función, mismo criterio de redondeo) — a propósito
// duplicado en vez de compartido con app.js, porque ese archivo corre en
// el navegador y este en Node, y no valía la pena montar un bundler para
// este proyecto solo por esto.
//
// A diferencia del botón manual (que arma UN SOLO texto con tickets +
// totales juntos), acá se separan en 2 funciones — porque el usuario
// pidió 2 mensajes DISTINTOS al cerrar el día: primero la sábana (el
// listado de tickets), después un mensaje aparte con los totales. La
// misma función de listado (generarTextoListadoSabana) también es la
// que se manda cada hora mientras el día sigue abierto — con o sin la
// palabra "FINAL" en el título, según corresponda (ver `opciones.esFinal`).
function formatMontoPlano(numero) {
  const redondeado = Math.round(numero * 100) / 100;
  return redondeado % 1 === 0 ? String(redondeado) : String(redondeado.toFixed(2)).replace(/0$/, '');
}

function formatDineroPlano(numero) {
  const redondeado = Math.round(numero * 100) / 100;
  const signo = redondeado < 0 ? '-' : '+';
  return signo + Math.abs(redondeado).toFixed(2) + '$';
}

function formatLineaResultadoPlano(arriesga, pagaMostrado, estadoFinal) {
  const arr = formatMontoPlano(arriesga);
  if (estadoFinal === 'GANADA') return arr + '//' + formatMontoPlano(pagaMostrado) + '✅';
  if (estadoFinal === 'PERDIDA') return '❌' + arr + '//' + formatMontoPlano(pagaMostrado);
  if (estadoFinal === 'ANULADA' || estadoFinal === 'SUSPENDIDA') return '⭕' + arr + '//';
  return arr + '//';
}

// Agrupa los tickets de la respuesta de procesarSabana() por cliente,
// preservando el orden de aparición — mismo criterio que
// construirPlanoDesdeRespuesta() en app.js.
function agruparTicketsPorCliente(tickets) {
  const gruposMap = new Map();
  (tickets || []).forEach(t => {
    if (!gruposMap.has(t.cliente)) gruposMap.set(t.cliente, { cliente: t.cliente, boletos: [] });
    gruposMap.get(t.cliente).boletos.push({
      ticket: t.ticket,
      jugadas: t.jugadas,
      arriesga: t.arriesga,
      pagaMostrado: t.paga,
      estadoFinal: t.estado
    });
  });
  return Array.from(gruposMap.values());
}

function formatFechaPlano(fechaISO) {
  if (!fechaISO) return null;
  const [anio, mes, dia] = fechaISO.split('-');
  return (anio && mes && dia) ? (dia + '-' + mes + '-' + anio) : null;
}

// Mensaje 1: el LISTADO de la sábana (ticket por ticket, agrupado por
// cliente, con el resultado actual de cada uno) — SIN los totales. Es el
// mismo mensaje que se manda cada hora mientras el día sigue abierto, y
// también el primer mensaje del cierre cuando llega "SABANA FINAL" y ya
// todo tiene resultado (`opciones.esFinal: true` le cambia el título).
function generarTextoListadoSabana(resp, opciones = {}) {
  const grupos = agruparTicketsPorCliente(resp.tickets);
  const partes = [];
  // OJO (04-09-2026, a pedido del usuario: "dice arriba deportes zenyatta
  // y debe decir es como se llama el grupo, como se puede cambiar eso"):
  // mismo arreglo que en app.js (construirPlanoDesdeRespuesta(), el botón
  // manual) — el encabezado usa el nombre REAL del Grupo dueño de esta
  // sábana (opciones.nombreGrupo, que whatsappBot.js completa desde
  // grupos.nombre antes de llamar esta función), con el nombre viejo como
  // respaldo solo si por algún motivo no se pasó ninguno.
  partes.push('*' + (opciones.nombreGrupo || 'Deportes Zenyatta') + '*');
  partes.push('🏀⚽🏈⚾');
  const fechaFmt = formatFechaPlano(resp.fecha);
  if (fechaFmt) partes.push(fechaFmt);
  partes.push(opciones.esFinal ? '✅ *SÁBANA FINAL — todos los resultados*' : '🔄 *Actualización de resultados*');
  partes.push('');

  if (grupos.length === 0) {
    partes.push('(sin tickets todavía)');
  }
  grupos.forEach(grupo => {
    partes.push('*' + grupo.cliente + '*');
    grupo.boletos.forEach(b => {
      partes.push((b.ticket || '').replace(/^Ticket #/, 'Ticket '));
      (b.jugadas || []).forEach(j => partes.push(j));
      partes.push(formatLineaResultadoPlano(b.arriesga, b.pagaMostrado, b.estadoFinal));
      partes.push('');
    });
  });

  return partes.join('\n').replace(/\n+$/, '');
}

// Mensaje 2: SOLO los totales del día (por cliente + TOTAL BANCA) — el
// mismo criterio de siempre (Polla ya sumada/restada cuando esa fecha la
// tiene registrada, comisión aparte en su propia línea). Se manda una
// única vez, en el cierre, después del listado de arriba.
function generarTextoTotalesDia(resp) {
  const totalesClientes = (resp.planoWhatsApp && resp.planoWhatsApp.totalesClientes) || [];
  const partes = [];
  partes.push('*TOTALES DEL DÍA*');
  const fechaFmt = formatFechaPlano(resp.fecha);
  if (fechaFmt) partes.push(fechaFmt);
  partes.push('');

  totalesClientes.forEach(c => {
    // Mismo cálculo que generarPlanoWhatsApp() en app.js: c.totalBanca
    // viene en convención CASA con la comisión ya restada adentro, así
    // que "-c.totalBanca - c.devolucion" da el resultado de las apuestas
    // SOLO (sin comisión) — y se le suma la Polla del día para el total
    // final del cliente.
    const resultadoSabana = -c.totalBanca - c.devolucion;
    const totalDiaCliente = resultadoSabana + (c.polla || 0);
    if (c.jugoHoy || c.jugoPolla) {
      partes.push(' *' + c.cliente + '* ');
      partes.push(formatDineroPlano(totalDiaCliente));
    }
    if (Math.abs(c.devolucion) > 0.001) {
      partes.push('*% ' + c.cliente + '*');
      partes.push('+' + Math.abs(Math.round(c.devolucion * 100) / 100).toFixed(2) + '$');
    }
  });

  partes.push('');
  partes.push(' *TOTAL BANCA* ');
  const totalBanca = (resp.planoWhatsApp && resp.planoWhatsApp.totalBanca) || 0;
  partes.push(formatDineroPlano(totalBanca));
  if (resp.planoWhatsApp && resp.planoWhatsApp.pollaRegistrada) {
    partes.push(' *🎲 BANCA POLLA* ');
    partes.push(formatDineroPlano(resp.planoWhatsApp.totalBancaPolla || 0));
  }

  return partes.join('\n').replace(/\n+$/, '');
}

// =================================================================
// TEXTOS DEL "CORTE SEMANA" (09-09-2026, a pedido del usuario: "corte
// semana... envias el total por dia y total semana de cada cliente...
// separado en mensajes diferentes... si el cliente tiene % se lo
// colocas separado" — ver balanceGeneral.calcularBalanceSemanalPorCliente
// y whatsappBot.js, comandos "corte semana"/"saldo total semana
// <nombre>"). Formato pedido textualmente por el usuario:
//
//   cliente : bernal
//   lunes: +200
//   martes : -100
//   miercoles: xxx
//   total semana : xxxx
//
// y, en un SEGUNDO mensaje aparte, lo mismo pero solo con su %.
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function nombreDiaSemana(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  return DIAS_SEMANA[d.getUTCDay()] || fechaISO;
}

// Mensaje 1: el balance día por día (todo lo que le movió el saldo —
// jugadas de la sábana, Polla y transferencias — SIN la comisión, que va
// aparte en el mensaje 2; ver la nota grande en
// balanceGeneral.calcularBalanceSemanalPorCliente) + el total de la
// semana.
function generarTextoBalanceSemanalCliente(cliente, datosCliente) {
  const partes = [];
  partes.push('*Cliente: ' + cliente + '*');
  partes.push('');
  const fechas = Object.keys((datosCliente && datosCliente.porFecha) || {}).sort();
  if (fechas.length === 0) {
    partes.push('(sin jugadas esta semana)');
  } else {
    fechas.forEach(fecha => {
      partes.push(nombreDiaSemana(fecha) + ': ' + formatDineroPlano(datosCliente.porFecha[fecha].resultado));
    });
  }
  partes.push('');
  partes.push('*TOTAL SEMANA*');
  partes.push(formatDineroPlano((datosCliente && datosCliente.totalResultado) || 0));
  return partes.join('\n');
}

// Mensaje 2: "igualito pero solo su %" — mismo formato de arriba, pero
// con la comisión de cada día en vez del resultado de sus jugadas. Solo
// tiene sentido mandarlo si el cliente tuvo alguna comisión distinta de
// cero en la semana (whatsappBot.js decide eso antes de llamar acá, ver
// hayComisionEnLaSemana).
function generarTextoPorcentajeSemanalCliente(cliente, datosCliente) {
  const partes = [];
  partes.push('*Cliente: ' + cliente + ' (%)*');
  partes.push('');
  const fechas = Object.keys((datosCliente && datosCliente.porFecha) || {})
    .filter(f => Math.abs(datosCliente.porFecha[f].comision) > 0.001)
    .sort();
  fechas.forEach(fecha => {
    partes.push(nombreDiaSemana(fecha) + ': ' + formatDineroPlano(datosCliente.porFecha[fecha].comision));
  });
  partes.push('');
  partes.push('*TOTAL SEMANA %*');
  partes.push(formatDineroPlano((datosCliente && datosCliente.totalComision) || 0));
  return partes.join('\n');
}

module.exports = {
  formatMontoPlano,
  formatDineroPlano,
  formatLineaResultadoPlano,
  agruparTicketsPorCliente,
  generarTextoListadoSabana,
  generarTextoTotalesDia,
  nombreDiaSemana,
  generarTextoBalanceSemanalCliente,
  generarTextoPorcentajeSemanalCliente
};
