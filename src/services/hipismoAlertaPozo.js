// =================================================================
// hipismoAlertaPozo.js (07-10-2026) — ALERTA "APUESTA MÁS DE LO QUE LE
// QUEDA". Pedido del usuario: "haz el 7 pero solo con la alerta de cuando
// un cliente apuesta más de lo que le queda".
//
// Solo AVISA, nunca bloquea ni cambia ningún monto: cuando se carga un
// plano (Tercios, Jugadas Adelantadas o Tercios Adelantadas), se suma lo
// que cada cliente "avalado" (el que tiene pozo) apostó en esa carga y se
// compara contra su pozo DISPONIBLE (calcularPozoJugador, el mismo número
// que ve el cliente en su link y el Administrador en la pestaña Pozos:
// pozo inicial + todo lo liquidado de Deportes e Hipismo − lo congelado en
// juego). Si apostó más de lo que le queda, la ruta deja una alerta en
// Administración > Alertas (hipismo_alertas, tipo APUESTA_SOBRE_POZO) y
// devuelve la lista en la respuesta para que la pantalla lo muestre.
//
// Reglas:
//   - Solo clientes con tipo_cuenta = 'avalado' (los "libres" no tienen
//     pozo que cuidar) y que no sean cuentas de comisión.
//   - El pozo se lee ANTES de guardar la carga, así que el resultado de
//     esta misma carga no se cuenta dos veces.
//   - Nunca rompe la carga: cualquier error al revisar se ignora (el plano
//     se guarda igual; la alerta es solo un aviso).
// =================================================================
const db = require('../db');
const { calcularPozoJugador } = require('./pozo');
const { round2 } = require('./hipismoAdelantadasCalc');

function fmt(n) {
  return Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// apuestas: [{ nombre, monto }] — varias filas del mismo cliente se suman.
// Devuelve [{ nombre, apostado, pozoDisponible, faltante }] solo de los que
// apostaron MÁS de lo que les queda.
async function detectarApuestasSobrePozo(grupoId, apuestas) {
  const porNombre = new Map();
  (apuestas || []).forEach(a => {
    const nombre = (a && a.nombre ? String(a.nombre) : '').trim();
    const monto = Math.abs(Number(a && a.monto));
    if (!nombre || !Number.isFinite(monto) || monto <= 0) return;
    porNombre.set(nombre, (porNombre.get(nombre) || 0) + monto);
  });
  if (!porNombre.size) return [];

  const r = await db.query(
    `SELECT * FROM jugadores
      WHERE grupo_id = $1 AND nombre = ANY($2) AND tipo_cuenta = 'avalado' AND COALESCE(es_cuenta_comision, false) = false`,
    [grupoId, Array.from(porNombre.keys())]
  );
  const sobre = [];
  for (const jugador of r.rows) {
    const pozo = await calcularPozoJugador(grupoId, jugador);
    const apostado = round2(porNombre.get(jugador.nombre));
    const disponible = round2(pozo.pozoDisponible);
    if (apostado > Math.max(0, disponible) + 0.005) {
      sobre.push({ nombre: jugador.nombre, apostado, pozoDisponible: disponible, faltante: round2(apostado - Math.max(0, disponible)) });
    }
  }
  return sobre;
}

// VALIDAR PLANO (14-10-2026, a pedido del usuario: "en validar plano se pega el plano sin calcular... y
// aparte de dar el resultado indicas qué tercios no pueden jugar porque se pasan del pozo y no les
// alcanza"). A diferencia de la alerta de arriba (que solo avisa el total), acá se mira JUGADA POR JUGADA,
// en el orden en que vienen en el plano: cada cliente con pozo (avalado) va "gastando" su pozo disponible y
// la jugada que ya no le cabe queda como "no alcanza" (esa NO gasta pozo, así una jugada más chica que viene
// después todavía puede caber). Solo mira lo que se pasa: los libres y las cuentas de comisión no tienen pozo
// que cuidar. NO guarda nada ni deja alertas: es solo una vista previa.
// tickets: [{ clienteNombre, modalidad, caballo, monto }]
// Devuelve [{ nombre, apostado, pozoDisponible, faltante, juegan:[...], noAlcanzan:[...] }] solo de los que
// tienen al menos una jugada que no les alcanza.
async function validarTerciosContraPozo(grupoId, tickets) {
  const porCliente = new Map();
  (tickets || []).forEach(t => {
    const nombre = (t && t.clienteNombre ? String(t.clienteNombre) : '').trim();
    const monto = Math.abs(Number(t && t.monto));
    if (!nombre || !Number.isFinite(monto) || monto <= 0) return;
    if (!porCliente.has(nombre)) porCliente.set(nombre, []);
    porCliente.get(nombre).push({ modalidad: t.modalidad, caballo: t.caballo, monto: round2(monto) });
  });
  if (!porCliente.size) return [];

  const r = await db.query(
    `SELECT * FROM jugadores
      WHERE grupo_id = $1 AND nombre = ANY($2) AND tipo_cuenta = 'avalado' AND COALESCE(es_cuenta_comision, false) = false`,
    [grupoId, Array.from(porCliente.keys())]
  );
  const salida = [];
  for (const jugador of r.rows) {
    const pozo = await calcularPozoJugador(grupoId, jugador);
    const disponible = round2(pozo.pozoDisponible);
    const tope = Math.max(0, disponible);
    let gastado = 0;
    const juegan = [];
    const noAlcanzan = [];
    for (const j of porCliente.get(jugador.nombre)) {
      if (gastado + j.monto <= tope + 0.005) { gastado = round2(gastado + j.monto); juegan.push(j); }
      else noAlcanzan.push(j);
    }
    if (!noAlcanzan.length) continue;
    const apostado = round2(juegan.concat(noAlcanzan).reduce((a, j) => a + j.monto, 0));
    salida.push({ nombre: jugador.nombre, apostado, pozoDisponible: disponible, faltante: round2(apostado - tope), juegan, noAlcanzan });
  }
  return salida;
}

function mensajeApuestaSobrePozo(s, etiqueta) {
  return `${s.nombre} apostó ${fmt(s.apostado)}${etiqueta ? ' en ' + etiqueta : ''} y su pozo disponible es ${fmt(s.pozoDisponible)} (se pasa por ${fmt(s.faltante)}).`;
}


// =================================================================
// POZO BAJO (26-10-2026, a pedido del usuario: "cuando un cliente tenga poco pozo, así sea pago diario o avalado, debes
// generar alertas"; "el pozo es un saldo que se le coloca, quiere decir que puede jugar hasta eso"). Después de guardar
// un plano / jugada se revisa, de los clientes que intervinieron, a cuáles les quedó POCO pozo para seguir jugando:
//   - Solo clientes CON pozo: avalados, pago diario con pozo (tipo_cuenta = 'avalado' + marca) y pago diario con RECARGAS de la
//     semana (su saldo recargado es su pozo: pozo + recargas). Los libres y los pago diario sin pozo ni recargas no se avisan.
//   - "Poco" = lo que les queda disponible (pozoDisponible, el mismo número de la pestaña Pozos) es menos del 15% del
//     pozo que se les colocó (el mismo corte del "pozo rojo" de la pantalla Pozos). Si ya no les queda nada, el aviso
//     dice "sin pozo".
//   - Los que además se pasaron en esta misma carga ya tienen su alerta APUESTA_SOBRE_POZO: se excluyen para no duplicar.
// Solo AVISA (nunca bloquea ni cambia montos) y un error al revisar jamás impide guardar.
// =================================================================
const PORCENTAJE_POZO_BAJO = 15;

// 26-10-2026: la cuenta fija donde se acumula el contrapeso de las recargas de pago diario (ver "Recarga Saldos Pago Diarios" en
// routes/hipismo.js). Un cliente de PAGO DIARIO juega con lo que se le recarga: su "pozo" de la semana = pozo que tenga + sus
// recargas de la semana, y "poco" se mide contra eso (aunque el cliente sea libre y no tenga pozo base).
const CUENTA_RECARGAS_PAGO_DIARIO = 'POZOS PAGO DIARIOS';

// Lo recargado a un cliente de pago diario dentro del rango de la semana (solo las filas que son recarga: positivas y hechas en el
// mismo momento que la fila de la cuenta POZOS PAGO DIARIOS).
async function recargasPagoDiarioSemana(grupoId, nombre, rango) {
  const r = await db.query(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM hipismo_comisiones_ajustes
      WHERE grupo_id = $1 AND cliente_nombre = $2 AND monto > 0 AND fecha >= $3 AND fecha <= $4
        AND creado_en IN (SELECT creado_en FROM hipismo_comisiones_ajustes WHERE grupo_id = $1 AND cliente_nombre = $5)`,
    [grupoId, nombre, rango.desde, rango.hasta, CUENTA_RECARGAS_PAGO_DIARIO]
  );
  return round2(Number(r.rows && r.rows[0] && r.rows[0].total) || 0);
}

// nombres: nombres de los clientes que intervinieron en la carga (se revisa su pozo YA con esa carga guardada).
// Devuelve [{ nombre, pagoDiario, pozoInicial, pozoDisponible, porcentaje, agotado }] solo de los que quedaron bajos.
async function detectarPozoBajo(grupoId, nombres, opciones) {
  const excluir = new Set(((opciones && opciones.excluir) || []).map(n => String(n)));
  const unicos = Array.from(new Set((nombres || []).map(n => (n ? String(n).trim() : '')).filter(n => n && !excluir.has(n))));
  if (!unicos.length) return [];
  const consulta = condicion => db.query(
    `SELECT * FROM jugadores
      WHERE grupo_id = $1 AND nombre = ANY($2) AND ${condicion} AND COALESCE(es_cuenta_comision, false) = false`,
    [grupoId, unicos]
  );
  let r;
  try {
    r = await consulta("(tipo_cuenta = 'avalado' OR pago_diario = true)");
  } catch (e) {
    if (!e || e.code !== '42703') throw e; // todavía no existe la columna pago_diario: solo los avalados
    r = await consulta("tipo_cuenta = 'avalado'");
  }
  const bajos = [];
  for (const jugador of r.rows) {
    const pozo = await calcularPozoJugador(grupoId, jugador);
    let base = round2(pozo.pozoInicial);
    let disponible = round2(pozo.pozoDisponible);
    if (jugador.pago_diario) {
      const recargas = pozo.rango ? await recargasPagoDiarioSemana(grupoId, jugador.nombre, pozo.rango) : 0;
      base = round2(base + recargas);
      disponible = round2(disponible + recargas);
      // Pago diario sin pozo ni recargas esta semana: no tiene saldo con el que jugar, no hay nada que cuidar.
      if (jugador.tipo_cuenta !== 'avalado' && base <= 0) continue;
    }
    const porcentaje = base > 0 ? Math.max(0, Math.round((disponible / base) * 100)) : (disponible > 0 ? 100 : 0);
    if (porcentaje < PORCENTAJE_POZO_BAJO) {
      bajos.push({ nombre: jugador.nombre, pagoDiario: !!jugador.pago_diario, pozoInicial: base, pozoDisponible: disponible, porcentaje, agotado: disponible <= 0.005 });
    }
  }
  return bajos;
}

function mensajePozoBajo(b, etiqueta) {
  const quien = `${b.nombre}${b.pagoDiario ? ' (pago diario)' : ''}`;
  const donde = etiqueta ? ` (después de ${etiqueta})` : '';
  if (b.agotado) return `${quien} se quedó SIN POZO${donde}: le quedan ${fmt(Math.max(0, b.pozoDisponible))} de ${fmt(b.pozoInicial)}.`;
  return `${quien} tiene POCO POZO${donde}: le quedan ${fmt(b.pozoDisponible)} de ${fmt(b.pozoInicial)} (${b.porcentaje}%).`;
}

module.exports = { detectarApuestasSobrePozo, mensajeApuestaSobrePozo, validarTerciosContraPozo, detectarPozoBajo, mensajePozoBajo, PORCENTAJE_POZO_BAJO };
