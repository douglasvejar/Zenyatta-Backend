// Administración > % Devueltos y Balance General.
const express = require('express');
const { requiereGrupo, requierePermiso, requiereAlgunoDe, monedaModoDe } = require('../middleware/auth');
const { cargarConfigGrupo } = require('../services/grupoConfig');
const { calcularComisionesDetalladas, calcularRangoRapido, leerHistorial, fechasConfirmadas, resumenConfirmacionRango } = require('../services/historial');
const { calcularBalanceGeneral, calcularBalancePorDia } = require('../services/balanceGeneral');
const { leerPolla } = require('../services/polla');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requiereGrupo);

// Arma { USD: Set(nombres...), BS: Set(nombres...) } a partir de la
// config ya cargada del grupo (18-09-2026, "moneda del grupo" — ver la
// nota grande en sql/schema.sql). Solo se usa cuando moneda_modo ===
// 'mixto'; en modo fijo ('usd'/'bs') todos los reportes siguen siendo un
// solo bloque, exactamente como antes de este cambio.
function agruparNombresPorMoneda(jugadores) {
  const usd = new Set();
  const bs = new Set();
  (jugadores || []).forEach(j => (j.moneda === 'BS' ? bs : usd).add(j.nombre));
  return { usd, bs };
}

// ?tipo=hoy|semana|mes|todo -> devuelve { desde, hasta } listo para usar
// en los otros dos endpoints (mismo comportamiento que aplicarRangoRapidoPanel).
// Sin permiso propio a propósito: no expone ningún dato de dinero, solo
// fechas — cualquier empleado logueado puede pedirlo sin que haga falta
// habilitarle una sección puntual para esto.
router.get('/rango-rapido', asyncHandler(async (req, res) => {
  const rango = await calcularRangoRapido(req.grupoId, req.query.tipo);
  if (!rango) return res.status(400).json({ error: 'tipo inválido (usa hoy, semana, mes o todo).' });
  res.json(rango);
}));

router.get('/porcentajes-devueltos', requierePermiso('porcentajes'), asyncHandler(async (req, res) => {
  const { desde, hasta } = req.query;
  const config = await cargarConfigGrupo(req.grupoId);
  const { porcentajesPropios, avalesMap, modeloComision, tiersComision, modelosComisionPorCliente } = config;
  const configComision = { modelo: modeloComision, tiers: tiersComision, modelosPorCliente: modelosComisionPorCliente };
  const datos = await calcularComisionesDetalladas(req.grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision);
  const monedaModo = monedaModoDe(req);

  if (monedaModo === 'mixto') {
    const { usd, bs } = agruparNombresPorMoneda(config.jugadores);
    const partir = (nombres) => {
      const porJugador = {};
      let totalGeneral = 0;
      Object.entries(datos).forEach(([cliente, d]) => {
        if (!nombres.has(cliente)) return;
        porJugador[cliente] = d;
        totalGeneral += d.total;
      });
      return { porJugador, totalGeneral };
    };
    return res.json({ mixto: true, USD: partir(usd), BS: partir(bs) });
  }

  const totalGeneral = Object.values(datos).reduce((acc, d) => acc + d.total, 0);
  res.json({ mixto: false, moneda: monedaModo.toUpperCase(), porJugador: datos, totalGeneral });
}));

router.get('/balance-general', requierePermiso('balanceGeneral'), asyncHandler(async (req, res) => {
  const { desde, hasta } = req.query;
  const config = await cargarConfigGrupo(req.grupoId);
  const { porcentajesPropios, avalesMap, modeloComision, tiersComision, modelosComisionPorCliente } = config;
  const configComision = { modelo: modeloComision, tiers: tiersComision, modelosPorCliente: modelosComisionPorCliente };

  // "Moneda del grupo" (18-09-2026) — cuando el grupo está en 'mixto', se
  // calcula el Balance General DOS VECES (una por cada moneda, filtrando
  // qué clientes entran en cada una) en vez de un solo total que
  // mezclaría dólares con bolívares en el mismo número. En modo fijo
  // ('usd'/'bs') se sigue calculando UNA sola vez, exactamente como
  // siempre — cero cambio de comportamiento para los grupos que no usan
  // esto.
  const monedaModo = monedaModoDe(req);
  if (monedaModo === 'mixto') {
    const { usd, bs } = agruparNombresPorMoneda(config.jugadores);
    const [resultadoUSD, porDiaUSD, resultadoBS, porDiaBS] = await Promise.all([
      calcularBalanceGeneral(req.grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision, usd),
      calcularBalancePorDia(req.grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision, usd),
      calcularBalanceGeneral(req.grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision, bs),
      calcularBalancePorDia(req.grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision, bs)
    ]);
    return res.json({
      mixto: true,
      USD: { ...resultadoUSD, porDia: porDiaUSD },
      BS: { ...resultadoBS, porDia: porDiaBS }
    });
  }

  const [resultado, porDia] = await Promise.all([
    calcularBalanceGeneral(req.grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision),
    calcularBalancePorDia(req.grupoId, desde, hasta, porcentajesPropios, avalesMap, configComision)
  ]);
  res.json({ mixto: false, moneda: monedaModo.toUpperCase(), ...resultado, porDia });
}));

// =================================================================
// Resumen de confirmación de un RANGO (01-09-2026, a pedido del usuario)
// — usado por Balance General y % Devueltos para avisar, arriba de la
// tabla, si TODOS los días con actividad de ese rango ya quedaron
// confirmados con "💾 Guardar Día" o si todavía falta alguno (esos
// números podrían cambiar si se vuelve a procesar esa fecha).
// =================================================================
router.get('/confirmacion-rango', requiereAlgunoDe('balanceGeneral', 'porcentajes'), asyncHandler(async (req, res) => {
  const { desde, hasta } = req.query;
  const resumen = await resumenConfirmacionRango(req.grupoId, desde, hasta);
  res.json(resumen);
}));

// =================================================================
// "CONTROL POR CLIENTE" (31-08-2026, a pedido del usuario; ampliado
// 02-09-2026 para incluir la Polla) — historial de jugadas Y de Polla de
// UN cliente puntual, para revisar cuando el usuario quiera (no solo el
// día en que se procesó). Reusa leerHistorial() (tickets) + leerPolla()
// (polla.js) filtrando ambas por el mismo cliente/rango, y las junta en
// una sola lista "movimientos" (cada una con tipo:'ticket'|'polla'),
// ordenada por fecha — así un cliente que SOLO juega Polla (sin ningún
// ticket de sábana) ya no queda con la lista vacía: antes el modal de
// "📖 Historial" (y, desde ahora, el botón "👁️ Ver" de Balance General)
// solo leía tickets_historial, así que un cliente polla-only aparecía
// sin ningún movimiento a pesar de tener saldo. Cada fila (de cualquiera
// de los 2 tipos) sigue trayendo el badge "confirmado" (ver historial.js
// / dias_confirmados) — reprocesar la sábana O la Polla de una fecha
// desconfirma esa fecha por igual (ver guardarPolla() en polla.js).
//
// Lo usan tanto Balance General como la pestaña Jugador (👁️ ver
// historial de un cliente) — de ahí requiereAlgunoDe() en vez de un solo
// permiso.
// =================================================================
router.get('/historial-cliente', requiereAlgunoDe('balanceGeneral', 'jugador'), asyncHandler(async (req, res) => {
  const { cliente, desde, hasta } = req.query;
  if (!cliente || !cliente.trim()) {
    return res.status(400).json({ error: 'Falta el nombre del cliente.' });
  }
  const nombreCliente = cliente.trim();
  const [tickets, polla] = await Promise.all([
    leerHistorial(req.grupoId, { desde, hasta, cliente: nombreCliente }),
    leerPolla(req.grupoId, { desde, hasta, cliente: nombreCliente })
  ]);
  const fechasUnicas = [...new Set([...tickets.map(t => t.fecha), ...polla.map(p => p.fecha)])];
  const confirmadas = await fechasConfirmadas(req.grupoId, fechasUnicas);

  const movimientos = [
    ...tickets.map(t => ({
      tipo: 'ticket',
      fecha: t.fecha,
      ticket: t.ticket,
      detalle: t.detalle,
      arriesga: t.arriesga,
      gana: t.gana,
      estado: t.estado,
      diaConfirmado: confirmadas.has(t.fecha)
    })),
    ...polla.map(p => ({
      tipo: 'polla',
      fecha: p.fecha,
      monto: p.monto,
      diaConfirmado: confirmadas.has(p.fecha)
    }))
  ].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.tipo === b.tipo ? 0 : (a.tipo === 'ticket' ? -1 : 1))));

  // "tickets" se mantiene por compatibilidad (nadie más lo consumía fuera
  // de public/app.js, que se actualiza en la misma entrega para usar
  // "movimientos"); se deja igual además por si algo externo llegó a
  // depender del nombre viejo del campo.
  res.json({ cliente: nombreCliente, movimientos, tickets });
}));

module.exports = router;
