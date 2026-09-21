// Portado de app.js (sección 9B), sin la parte de DOM/checkboxes de
// columnas — eso ahora es responsabilidad del cliente que consuma la API
// (puede mostrar/ocultar columnas del JSON que devuelve esta función sin
// tener que volver a pedir nada al backend).
const { calcularResumenHistorico } = require('./historial');
const { calcularTransferenciasPorCliente } = require('./transferencias');
const { calcularComisionTotalCliente } = require('./comisiones');
const { calcularPollaPorCliente } = require('./polla');

// "Polla" (02-09-2026, a pedido del usuario): juego APARTE de la
// sábana — se suma/resta directo al saldo del cliente y a la banca. Ver
// services/polla.js para la fórmula completa y por qué el aporte de
// cada cliente a la banca es la NEGACIÓN de su monto de polla (misma
// relación que ya existe entre "lo que pierde/gana el cliente" y "lo
// que gana/pierde la banca" con los tickets de la sábana, ver
// totalBancaCliente más abajo). Se muestra SIEMPRE como un ítem
// aparte (campo "polla" por cliente y "balanceBancaPolla" total),
// además de quedar sumado dentro de "saldoCliente" de cada cliente.
//
// CORRECCIÓN (03-09-2026, a pedido del usuario — "me estás dejando el
// resultado polla aparte... para que el resultado de la polla se vea
// reflejado e influya en el total del saldo del grupo"): el campo
// "balanceBanca" que se muestra arriba de la tabla, ANTES, era SOLO la
// parte de la sábana (totalBancaGeneral) — la Polla quedaba nada más
// sumada adentro del saldo de cada cliente, pero el número grande de
// arriba ("Balance de la banca en el rango") no la incluía, aunque el
// comentario original decía que sí. Ahora "balanceBanca" es la suma de
// AMBAS cosas (sábana + polla), y se agregan "balanceBancaSabana" /
// "balanceBancaPolla" por separado para quien quiera ver el desglose.
// También se agrega "filaTotal": la SUMA de cada columna de la tabla
// (incluida la columna "Polla" de cada cliente) para que se pueda
// pintar una fila de "TOTAL" al final de la tabla en el frontend — así
// el resultado de la polla, que ya estaba adentro de cada
// "saldoCliente", queda VISIBLE sumado en un solo número al final, en
// vez de vivir nada más como un cuadrito aparte arriba de la tabla.
// configComision (08-09-2026, opcional) — { modelo, tiers }, ver la nota
// grande en comisiones.js/sql/schema.sql. Se pasa tal cual a
// calcularResumenHistorico (para que acumule comisionPorTipoAcumulada por
// ticket) y a calcularComisionTotalCliente (para que la use en vez de
// arriesgadoComisionable*pct). Si se omite, comportamiento de siempre.
//
// nombresPermitidos (18-09-2026, opcional, "moneda del grupo" — ver la
// nota grande en sql/schema.sql): un Set de nombres de cliente, para
// cuando el grupo está en modo 'mixto' y hace falta un Balance General
// SEPARADO por moneda (uno con solo los clientes en USD, otro con solo
// los de BS) en vez de un solo total que mezclaría las dos monedas en un
// mismo número. Si se omite (comportamiento de siempre), entran TODOS
// los clientes, sin filtrar — así ningún llamador existente cambia.
async function calcularBalanceGeneral(grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision, nombresPermitidos) {
  const modelo = configComision && configComision.modelo;
  const tiers = configComision && configComision.tiers;
  const resumen = await calcularResumenHistorico(grupoId, desde, hasta, modelo, tiers);
  const transferencias = await calcularTransferenciasPorCliente(grupoId, desde, hasta);
  const polla = await calcularPollaPorCliente(grupoId, desde, hasta);

  let clientes = new Set(Object.keys(resumen));
  Object.keys(transferencias).forEach(c => clientes.add(c));
  Object.keys(polla).forEach(c => clientes.add(c));

  // BUG (03-09-2026, a pedido del usuario — "manolo tiene % que se a
  // ganado de sus clientes... deben aparecer todos los códigos, para
  // que cuando yo sume aparte uno a uno los totales de cada cliente me
  // dé exactamente el monto del balance general"): un cliente que solo
  // AVALA a otros (cobra % de las jugadas de un avalado) pero él mismo
  // no jugó ni tiene Polla en el rango, NO estaba entrando al Set de
  // "clientes" de arriba — así que su fila (con su comisión de avalado)
  // nunca se armaba, y esa comisión se perdía TANTO de la tabla como del
  // total (filaTotal/balanceBanca) de este rango. Es el mismo bug #21
  // del proyecto original que ya se había corregido para "clientesDelDia"
  // en procesarSabana.js (ver ese archivo) pero nunca se portó acá — por
  // eso el mismo día podía dar un total distinto en el dashboard de la
  // sábana (que SÍ incluía a este tipo de cliente) que en Balance General
  // / el desglose "por día" de abajo (calcularBalancePorDia, que
  // reutiliza esta misma función). Se corrige con el mismo criterio:
  // agregar al avalador si, avalando, generaría una comisión distinta de
  // cero en este rango — así un avalador con % configurado pero cuyos
  // avalados no jugaron en este rango puntual sigue sin aparecer (su fila
  // sería $0.00 en todo, igual que no aparecer), pero uno que sí ganó
  // comisión ahora se ve, con exactamente esa comisión, en la tabla y en
  // el total.
  Object.keys(avalesMap || {}).forEach(avalador => {
    if (clientes.has(avalador)) return;
    const comisionSiAvala = calcularComisionTotalCliente(avalador, resumen, porcentajesPropios, avalesMap, configComision);
    if (Math.abs(comisionSiAvala.total) > 0.001) clientes.add(avalador);
  });

  // Filtro de moneda (ver comentario grande arriba) — se aplica AL
  // FINAL, después de armar el Set completo con el mismo criterio de
  // siempre (incluye avaladores que solo aparecen por su comisión), para
  // no cambiar en nada qué clientes califican — solo cuáles de ellos se
  // muestran en ESTE bloque puntual.
  if (nombresPermitidos) {
    clientes = new Set([...clientes].filter(c => nombresPermitidos.has(c)));
  }

  let totalBancaGeneral = 0;
  let totalBancaPolla = 0;
  const filas = Array.from(clientes).sort().map(cliente => {
    const rc = resumen[cliente] || { arriesgado: 0, arriesgadoComisionable: 0, ganado: 0, perdido: 0, pendientes: 0 };
    const comision = calcularComisionTotalCliente(cliente, resumen, porcentajesPropios, avalesMap, configComision);
    // Convención CASA: lo que le dejó ese cliente a la banca, ya restando
    // el % que se le pagó.
    const totalBancaCliente = rc.perdido - rc.ganado - comision.total;
    totalBancaGeneral += totalBancaCliente;

    // Convención POLLA: el monto del cliente (positivo = ganó, negativo
    // = perdió) es EXACTAMENTE lo que se le suma a su saldo; el aporte
    // a la banca es la negación de ese mismo monto (si el cliente
    // perdió, aporta a la banca; si ganó, le cuesta a la banca).
    const pollaCliente = polla[cliente] || 0;
    const bancaPollaCliente = -pollaCliente;
    totalBancaPolla += bancaPollaCliente;

    const netoTransferencias = transferencias[cliente] || 0;
    // Convención CLIENTE (positivo = él va ganando), + transferencias +
    // polla.
    const saldoCliente = -totalBancaCliente + netoTransferencias + pollaCliente;

    return {
      cliente,
      arriesgado: rc.arriesgado,
      ganado: rc.ganado,
      perdido: rc.perdido,
      comision: comision.total,
      transferencias: netoTransferencias,
      polla: pollaCliente,
      saldoCliente
    };
  });

  const filaTotal = filas.reduce((acc, f) => {
    acc.arriesgado += f.arriesgado;
    acc.ganado += f.ganado;
    acc.perdido += f.perdido;
    acc.comision += f.comision;
    acc.transferencias += f.transferencias;
    acc.polla += f.polla;
    acc.saldoCliente += f.saldoCliente;
    return acc;
  }, { cliente: 'TOTAL', arriesgado: 0, ganado: 0, perdido: 0, comision: 0, transferencias: 0, polla: 0, saldoCliente: 0 });

  return {
    filas,
    filaTotal,
    balanceBanca: totalBancaGeneral + totalBancaPolla,
    balanceBancaSabana: totalBancaGeneral,
    balanceBancaPolla: totalBancaPolla
  };
}

// =================================================================
// DESGLOSE POR DÍA (03-09-2026, a pedido del usuario: "arriba donde
// dice balance quiero ver una tabla donde se vea el saldo del grupo
// por día de esa semana: lunes -200, martes +100, miercoles -200").
//
// Reusa calcularBalanceGeneral() UNA VEZ POR CADA FECHA del rango (en
// vez de reescribir toda la lógica de suma agrupada por fecha) — es
// más lento que una sola consulta agrupada, pero muchísimo más simple
// y con cero riesgo de que el desglose diario no cuadre con el total
// del rango, porque literalmente usa la misma función ya probada. Para
// no disparar una consulta por cada día de un rango gigante (ej. "Todo
// el historial"), se limita a rangos de hasta LIMITE_DIAS_DESGLOSE
// días — si el rango es más largo que eso, se devuelve un arreglo
// vacío y el frontend simplemente no muestra la tabla de desglose.
// =================================================================
const LIMITE_DIAS_DESGLOSE = 31;

function listaDeFechas(desde, hasta) {
  const fechas = [];
  let actual = new Date(desde + 'T00:00:00Z');
  const fin = new Date(hasta + 'T00:00:00Z');
  if (isNaN(actual.getTime()) || isNaN(fin.getTime())) return fechas;
  while (actual <= fin && fechas.length <= LIMITE_DIAS_DESGLOSE + 1) {
    fechas.push(actual.toISOString().split('T')[0]);
    actual = new Date(actual.getTime() + 24 * 60 * 60 * 1000);
  }
  return fechas;
}

async function calcularBalancePorDia(grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision, nombresPermitidos) {
  if (!desde || !hasta) return [];
  const fechas = listaDeFechas(desde, hasta);
  if (fechas.length === 0 || fechas.length > LIMITE_DIAS_DESGLOSE) return [];

  const dias = [];
  for (const fecha of fechas) {
    const resultado = await calcularBalanceGeneral(grupoId, fecha, fecha, porcentajesPropios, avalesMap, configComision, nombresPermitidos);
    dias.push({ fecha, balanceBanca: resultado.balanceBanca });
  }
  return dias;
}

// =================================================================
// DESGLOSE SEMANAL POR CLIENTE (09-09-2026, a pedido del usuario: "corte
// semana... envias el total por dia y total semana de cada cliente
// registrado en el grupo... si el cliente tiene % se lo colocas
// separado", para los comandos de chat "corte semana"/"saldo semana"/
// "saldo total semana <nombre>" — ver whatsappTrigger.detectarComando y
// whatsappBot.js).
//
// A diferencia de calcularBalancePorDia (que da el balance de LA BANCA
// por día, sin abrir por cliente), esto es lo mismo pero desglosado por
// CLIENTE y separando el resultado de TODO lo demás de la comisión (%) —
// porque el usuario pidió el % en un MENSAJE APARTE, "igualito pero solo
// su %".
//
// Reusa calcularBalanceGeneral() una vez por día (mismo criterio, mismo
// límite de LIMITE_DIAS_DESGLOSE, que una semana de 7 días nunca toca) —
// así el número de cada día coincide 1 a 1 con lo que ya muestra el
// panel para ese mismo día puntual, sin duplicar ninguna cuenta.
//
// Por cliente, cada día guarda:
//   resultado: TODO lo que le movió el saldo ese día — jugadas de la
//     sábana, Polla Y transferencias — SIN la comisión (09-09-2026, a
//     pedido EXPLÍCITO del usuario: "en el balance entra todo, polla,
//     traspasos, todo" — antes este campo era solo ganado-perdido de la
//     sábana; ahora es EXACTAMENTE saldoCliente sin la comisión, o sea
//     saldoCliente - comision, que da (ganado-perdido) + transferencias
//     + polla, porque saldoCliente ya trae la comisión sumada de vuelta
//     — ver la convención CLIENTE en calcularBalanceGeneral arriba). Es
//     el "balance" que pidió el usuario en el primer mensaje.
//   comision: la comisión (propia + por avalar) de ese día — lo que va
//     en el segundo mensaje, "solo su %".
// Un día sin ninguna actividad de ese cliente (ni jugó, ni tiene Polla,
// ni transferencias, ni comisión) NO se agrega — así el reporte no
// queda lleno de líneas en $0.00 para los días sin nada.
//
// AMPLIADO (21-09-2026, a pedido del usuario — pestaña nueva "⬇️
// Descargar" > "📅 Saldos Semana": "tambien coloca opcion donde puedo
// agregar mas columnas si quiero, como cuanto a arriesgado, cuanto gano
// etc todo lo que tenemos"): antes cada día solo guardaba
// "resultado"/"comision" — el resto de lo que ya calcula
// calcularBalanceGeneral() por cliente (arriesgado/ganado/perdido/
// transferencias/polla/saldoCliente) se recalculaba y se tiraba en cada
// vuelta del for. Ahora cada día guarda TAMBIÉN esos campos (y se suman
// en totalArriesgado/totalGanado/etc., un total por semana de cada uno),
// y se agrega totalPorFecha (mismo desglose pero de la fila TOTAL de
// cada día, ya armada por calcularBalanceGeneral) — así
// services/saldosSemana.js puede armar la fila de "TOTAL" del reporte
// sin tener que volver a sumar cliente por cliente. 100% ADITIVO: los 2
// campos de siempre (resultado/comision, totalResultado/totalComision)
// no cambiaron en nada, así que los llamadores existentes
// (whatsappBot.js, "corte semana"/"saldo semana") siguen funcionando
// exactamente igual, sin tocarlos.
async function calcularBalanceSemanalPorCliente(grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision) {
  const fechas = listaDeFechas(desde, hasta);
  if (fechas.length === 0 || fechas.length > LIMITE_DIAS_DESGLOSE) return { porCliente: {}, fechas: [], totalPorFecha: {} };

  const porCliente = {};
  const totalPorFecha = {};
  for (const fecha of fechas) {
    const resultado = await calcularBalanceGeneral(grupoId, fecha, fecha, porcentajesPropios, avalesMap, configComision);
    resultado.filas.forEach(f => {
      const huboActividad = Math.abs(f.arriesgado) > 0.001 || Math.abs(f.polla) > 0.001 || Math.abs(f.transferencias) > 0.001 || Math.abs(f.comision) > 0.001;
      if (!huboActividad) return;
      if (!porCliente[f.cliente]) {
        porCliente[f.cliente] = {
          porFecha: {},
          totalResultado: 0,
          totalComision: 0,
          totalArriesgado: 0,
          totalGanado: 0,
          totalPerdido: 0,
          totalTransferencias: 0,
          totalPolla: 0,
          totalSaldoCliente: 0
        };
      }
      const c = porCliente[f.cliente];
      const resultadoDia = f.saldoCliente - f.comision;
      c.porFecha[fecha] = {
        resultado: resultadoDia,
        comision: f.comision,
        arriesgado: f.arriesgado,
        ganado: f.ganado,
        perdido: f.perdido,
        transferencias: f.transferencias,
        polla: f.polla,
        saldoCliente: f.saldoCliente
      };
      c.totalResultado += resultadoDia;
      c.totalComision += f.comision;
      c.totalArriesgado += f.arriesgado;
      c.totalGanado += f.ganado;
      c.totalPerdido += f.perdido;
      c.totalTransferencias += f.transferencias;
      c.totalPolla += f.polla;
      c.totalSaldoCliente += f.saldoCliente;
    });
    totalPorFecha[fecha] = {
      resultado: resultado.filaTotal.saldoCliente - resultado.filaTotal.comision,
      comision: resultado.filaTotal.comision,
      arriesgado: resultado.filaTotal.arriesgado,
      ganado: resultado.filaTotal.ganado,
      perdido: resultado.filaTotal.perdido,
      transferencias: resultado.filaTotal.transferencias,
      polla: resultado.filaTotal.polla,
      saldoCliente: resultado.filaTotal.saldoCliente
    };
  }
  return { porCliente, fechas, totalPorFecha };
}

module.exports = { calcularBalanceGeneral, calcularBalancePorDia, calcularBalanceSemanalPorCliente };
