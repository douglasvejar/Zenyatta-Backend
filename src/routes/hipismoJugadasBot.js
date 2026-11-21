// =================================================================
// JUGADAS BOT IA (19-11-2026) — pestaña del panel de Hipismo para los grupos que tienen contratado el bot de Corredores.
// Aquí se ven los planos que arma el bot (las paradas confirmadas en el chat, que esperan la pizarra), con una alerta "FALTA PIZARRA",
// se puede poner la pizarra desde el panel, y se pueden agregar / editar / eliminar jugadas, o reabrir una carrera ya calculada.
//
// Las jugadas del bot viven en hipismo_chat_jugadas (NO son adelantadas): mientras no llega la pizarra están "en espera" (resuelta=false) y
// descuentan saldo; al cargar la pizarra el bot hace lo mismo que el empleado en Cargar Planos (ver hipismoJugadasChatBot.cargarPizarraChat).
// Se monta en /api/hipismo/bot (hereda sesión, permiso 'hipismo' y módulo habilitado de hipismo.js).
// =================================================================
const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const motor = require('../services/hipismoJugadasChat');
const { requiereAdministrador } = require('../middleware/auth');

const fechaHoyVenezuela = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const quitarTildes = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = t => quitarTildes(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const aLista = v => (Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v) : []));

// La apuesta en el mismo idioma que se escribe en el chat ("4x1 doy a8", "3n del 8"), para mostrarla y poder editarla.
function apuestaComoTexto(a) {
  if (!a) return '';
  const lista = l => (l || []).join('.');
  if (a.cruce) {
    const mod = String(a.modalidad || '');
    const m = /^10a(\d+)$/i.exec(mod);
    return lista(a.cruce.gruposA) + 'x' + lista(a.cruce.gruposB) + (m ? ' doy a' + m[1] : (mod ? ' ' + mod : ''));
  }
  return String(a.modalidad || '1p').replace(/-/g, ' y ') + ' del ' + lista(a.grupo); // combos: 2y2-2p -> "2y2 y 2p"
}

// Texto del panel -> jugada lista para guardar (misma lectura que el chat: "Juego <apuesta> con <monto>", juega el jugador).
function armarJugada({ apuestaTxt, monto }) {
  const m = Number(monto);
  if (!(m > 0)) return { ok: false, motivo: 'El monto debe ser mayor que 0.' };
  const txt = String(apuestaTxt || '').trim().replace(/^juego\s+/i, '');
  if (!txt) return { ok: false, motivo: 'Escribe la apuesta (por ejemplo: 4x1 doy a8, o 3n del 8).' };
  const o = motor.interpretarOferta('Juego ' + txt + ' con ' + motor.montoParaLinea(m));
  if (!o || !o.ok) return { ok: false, motivo: 'No entendí la apuesta "' + txt + '" (' + ((o && o.motivo) || 'formato') + '). Escríbela como en el chat: 4x1 doy a8, 3n del 8, 2p del 5…' };
  const apuesta = motor.apuestaDesdeElJugador({ lado: o.lado, apuesta: o.apuesta });
  const r = motor.riesgoPorUnidad(apuesta);
  return { ok: true, apuesta, monto: motor.round2(m), riesgoJugador: motor.round2(m * r.jugador), riesgoBanquero: motor.round2(m * r.banquero) };
}

module.exports = function crearRouterBot({ registrarAlerta, hipismoPlanosPapelera }) {
  const router = express.Router();

  // Solo los grupos con el bot contratado (Súper-admin > Corredores y Administración Inteligente).
  router.use(asyncHandler(async (req, res, next) => {
    const r = await db.query('SELECT hipismo_chat_habilitado FROM grupos WHERE id = $1', [req.grupoId]);
    req.botHabilitado = !!(r.rows[0] && r.rows[0].hipismo_chat_habilitado);
    if (!req.botHabilitado && req.path !== '/estado') return res.status(403).json({ error: 'Este grupo no tiene contratado el bot de Corredores y Administración Inteligente.' });
    next();
  }));

  router.use('/conexion', requiereAdministrador);
  router.get('/conexion', asyncHandler(async (req, res) => {
    const gestor = require('../services/whatsappSesionesGrupo');
    const { conectado, tieneQr, numero, ultimoError, ultimo, ultimoEvento, requiereNuevoQr } = gestor.estadoPublico(req.grupoId);
    const r = await db.query(
      'SELECT whatsapp_propio_activo, whatsapp_propio_jid, whatsapp_propio_chats FROM grupos WHERE id = $1',
      [req.grupoId]
    );
    const fila = r.rows[0];
    const chats = fila.whatsapp_propio_chats || (fila.whatsapp_propio_jid ? [fila.whatsapp_propio_jid] : []);
    const qr = tieneQr && gestor.obtenerQr(req.grupoId);
    res.set('Cache-Control', 'no-store');
    res.json({
      conectado, numero, ultimoError, ultimo, ultimoEvento, requiereNuevoQr, vinculando: !!fila.whatsapp_propio_activo && !conectado,
      chatsAutorizados: chats.length,
      qr: qr ? await require('qrcode').toDataURL(qr, { width: 320, margin: 2 }) : null
    });
  }));

  router.post('/conexion/iniciar', asyncHandler(async (req, res) => {
    const gestor = require('../services/whatsappSesionesGrupo');
    if (gestor.estaConectada(req.grupoId)) return res.json({ ok: true });
    const r = await db.query(
      `UPDATE grupos SET whatsapp_propio_activo = true,
         whatsapp_propio_chats = COALESCE(whatsapp_propio_chats, array_remove(ARRAY[whatsapp_propio_jid], NULL))
       WHERE id = $1 AND activo = true AND hipismo_chat_habilitado = true RETURNING id`,
      [req.grupoId]
    );
    if (!r.rowCount) return res.status(403).json({ error: 'Súper-admin debe habilitar Bot IA para este grupo.' });
    await gestor.iniciarSesion(req.grupoId);
    res.json({ ok: true });
  }));

  router.post('/conexion/reconectar', asyncHandler(async (req, res) => {
    const r = await db.query(
      'SELECT id FROM grupos WHERE id = $1 AND activo = true AND hipismo_chat_habilitado = true AND whatsapp_propio_activo = true',
      [req.grupoId]
    );
    if (!r.rows.length) return res.status(409).json({ error: 'Primero debes vincular WhatsApp desde el portal.' });
    await require('../services/whatsappSesionesGrupo').reconectarSesion(req.grupoId);
    res.json({ ok: true });
  }));

  async function nombreCliente(grupoId, texto) {
    const r = await db.query('SELECT nombre FROM jugadores WHERE grupo_id = $1 AND COALESCE(es_cuenta_comision, false) = false', [grupoId]);
    const buscado = norm(texto);
    if (!buscado) return null;
    const lista = r.rows.map(f => ({ nombre: f.nombre, n: norm(f.nombre) }));
    const exactos = lista.filter(f => f.n === buscado);
    if (exactos.length === 1) return exactos[0].nombre;
    const parecidos = lista.filter(f => f.n.includes(buscado));
    return parecidos.length === 1 ? parecidos[0].nombre : null;
  }

  // GET /estado — ¿tiene el bot contratado? (la pestaña solo aparece si es true) y cuántas carreras esperan pizarra (la alerta del menú).
  router.get('/estado', asyncHandler(async (req, res) => {
    if (!req.botHabilitado) return res.json({ habilitado: false, faltanPizarra: 0 });
    const r = await db.query(
      `SELECT count(*)::int AS n FROM (
         SELECT 1 FROM hipismo_chat_jugadas
          WHERE grupo_id = $1 AND resuelta = false AND adelantada_jugada_id IS NULL AND fecha >= $2::date
          GROUP BY fecha, hipodromo_nombre, carrera_numero
         HAVING max(cerrada_en) IS NOT NULL OR max(creado_en) < now() - interval '30 minutes') t`,
      [req.grupoId, new Date(Date.now() - 4 * 3600 * 1000 - 3 * 86400000).toISOString().slice(0, 10)]
    );
    res.json({ habilitado: true, faltanPizarra: r.rows[0].n });
  }));

  // GET /planos?desde=&hasta= — una fila por carrera con jugadas del bot: cuántas, total, y si FALTA PIZARRA.
  router.get('/planos', asyncHandler(async (req, res) => {
    const hasta = FECHA_RE.test(String(req.query.hasta || '')) ? req.query.hasta : fechaHoyVenezuela();
    const desde = FECHA_RE.test(String(req.query.desde || '')) ? req.query.desde : new Date(Date.parse(hasta + 'T12:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);
    const r = await db.query(
      `SELECT to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.hipodromo_nombre, c.carrera_numero,
              count(*)::int AS jugadas, COALESCE(sum(c.monto), 0)::float AS total,
              (count(*) FILTER (WHERE c.resuelta = false AND c.adelantada_jugada_id IS NULL))::int AS pendientes,
              (count(*) FILTER (WHERE c.resuelta = true))::int AS calculadas,
              (count(*) FILTER (WHERE c.adelantada_jugada_id IS NOT NULL))::int AS anteriores,
              max(c.cerrada_en) AS cerrada_en, max(c.creado_en) AS ultima, now() AS ahora
         FROM hipismo_chat_jugadas c
        WHERE c.grupo_id = $1 AND c.fecha BETWEEN $2::date AND $3::date
        GROUP BY c.fecha, c.hipodromo_nombre, c.carrera_numero
        ORDER BY c.fecha DESC, max(c.creado_en) DESC`,
      [req.grupoId, desde, hasta]
    );
    const rp = await db.query(
      `SELECT id, to_char(fecha, 'YYYY-MM-DD') AS fecha, hipodromo_nombre, carrera_numero, pizarra, ret
         FROM hipismo_planos WHERE grupo_id = $1 AND fecha BETWEEN $2::date AND $3::date`,
      [req.grupoId, desde, hasta]
    );
    const planos = new Map(rp.rows.map(p => [p.fecha + '|' + p.hipodromo_nombre + '|' + p.carrera_numero, p]));
    const filas = r.rows.map(f => {
      const plano = planos.get(f.fecha + '|' + f.hipodromo_nombre + '|' + f.carrera_numero) || null;
      const cerrada = f.cerrada_en ? new Date(f.cerrada_en) : null;
      const ahora = new Date(f.ahora);
      const minutos = cerrada ? Math.max(0, Math.round((ahora - cerrada) / 60000)) : null;
      const hace30 = f.ultima && (ahora - new Date(f.ultima)) > 30 * 60000;
      let estado = 'calculado';
      if (f.pendientes > 0) estado = (cerrada || hace30) ? 'falta_pizarra' : 'abierta';
      else if (!f.calculadas && f.anteriores) estado = 'anterior';
      return {
        fecha: f.fecha, hipodromo: f.hipodromo_nombre, carrera: f.carrera_numero, jugadas: f.jugadas, total: f.total,
        pendientes: f.pendientes, calculadas: f.calculadas, anteriores: f.anteriores, estado,
        minutosSinPizarra: estado === 'falta_pizarra' ? (minutos !== null ? minutos : Math.round((ahora - new Date(f.ultima)) / 60000)) : null,
        pizarra: plano ? plano.pizarra : null, ret: plano ? plano.ret : null, planoId: plano ? plano.id : null
      };
    });
    res.json({ desde, hasta, planos: filas, faltanPizarra: filas.filter(f => f.estado === 'falta_pizarra').length });
  }));

  // GET /planos/jugadas?fecha=&hipodromo=&carrera= — las jugadas del bot de esa carrera.
  router.get('/planos/jugadas', asyncHandler(async (req, res) => {
    const { fecha, hipodromo } = req.query; const carrera = parseInt(req.query.carrera, 10);
    if (!FECHA_RE.test(String(fecha || '')) || !hipodromo || !(carrera > 0)) return res.status(400).json({ error: 'Faltan la fecha, el hipódromo o la carrera.' });
    const r = await db.query(
      `SELECT c.id, c.jugador_nombre, c.banquero_nombre, c.monto, c.apuesta, c.resuelta, c.adelantada_jugada_id, c.texto_linea,
              a.es_cruce, a.grupo_caballos, a.cruce_grupo_a, a.cruce_grupo_b, a.modalidad
         FROM hipismo_chat_jugadas c LEFT JOIN hipismo_tercios_adelantadas_jugadas a ON a.id = c.adelantada_jugada_id
        WHERE c.grupo_id = $1 AND c.fecha = $2::date AND c.hipodromo_nombre = $3 AND c.carrera_numero = $4
        ORDER BY c.creado_en`,
      [req.grupoId, fecha, hipodromo, carrera]
    );
    const jugadas = r.rows.map(f => {
      let ap = typeof f.apuesta === 'string' ? JSON.parse(f.apuesta) : f.apuesta;
      if (!ap && f.adelantada_jugada_id) ap = f.es_cruce ? { cruce: { gruposA: aLista(f.cruce_grupo_a), gruposB: aLista(f.cruce_grupo_b) }, grupo: null, modalidad: f.modalidad } : { cruce: null, grupo: aLista(f.grupo_caballos), modalidad: f.modalidad };
      return {
        id: f.id, jugador: f.jugador_nombre, banquero: f.banquero_nombre, monto: Number(f.monto),
        apuesta: ap ? motor.apuestaVisible(ap) : '', apuestaTexto: apuestaComoTexto(ap),
        calculada: !!f.resuelta, version_anterior: !!f.adelantada_jugada_id,
        editable: !f.resuelta && !f.adelantada_jugada_id
      };
    });
    res.json({ fecha, hipodromo, carrera, jugadas });
  }));

  // POST /pizarra — pone la pizarra: igual que el empleado, pega el plano, calcula y confirma (mismo manejador de Cargar Planos).
  router.post('/pizarra', asyncHandler(async (req, res) => {
    const { fecha, hipodromo, ret } = req.body || {}; const carrera = parseInt((req.body || {}).carrera, 10);
    const pizarra = String((req.body || {}).pizarra || '').trim();
    if (!FECHA_RE.test(String(fecha || '')) || !hipodromo || !(carrera > 0)) return res.status(400).json({ error: 'Faltan la fecha, el hipódromo o la carrera.' });
    if (!pizarra) return res.status(400).json({ error: 'Escribe la pizarra (la llegada), por ejemplo: 3 1 2 4.' });
    const llegada = motor.interpretarPizarra('pizarra ' + pizarra);
    if (!llegada) return res.status(400).json({ error: 'No entendí la pizarra "' + pizarra + '". Escríbela con los números de la llegada: 3 1 2 4.' });
    const bot = require('../services/hipismoJugadasChatBot');
    const out = await bot.cargarPizarraChat(req.grupoId, { hipodromo, carrera, fecha, pizarra: llegada.llegada, ret: ret ? String(ret).trim() : '' });
    if (!out.ok) return res.status(400).json({ error: out.motivo || 'No se pudo cargar la pizarra.' });
    res.json({ ok: true, texto: out.texto });
  }));

  async function validarCarreraEditable(req, fecha, hipodromo, carrera) {
    const r = await db.query('SELECT 1 FROM hipismo_planos WHERE grupo_id = $1 AND fecha = $2::date AND hipodromo_nombre = $3 AND carrera_numero = $4 LIMIT 1', [req.grupoId, fecha, hipodromo, carrera]);
    return r.rows.length === 0;
  }

  // POST /jugadas — agrega una jugada que faltó (queda en espera de la pizarra, como las del chat).
  router.post('/jugadas', asyncHandler(async (req, res) => {
    const b = req.body || {}; const carrera = parseInt(b.carrera, 10);
    const fecha = b.fecha || fechaHoyVenezuela();
    if (!FECHA_RE.test(String(fecha)) || !b.hipodromo || !(carrera > 0)) return res.status(400).json({ error: 'Faltan la fecha, el hipódromo o la carrera.' });
    const jugador = await nombreCliente(req.grupoId, b.jugador), banquero = await nombreCliente(req.grupoId, b.banquero);
    if (!jugador) return res.status(400).json({ error: 'No encontré al cliente que juega ("' + (b.jugador || '') + '"). Escríbelo como está en Clientes.' });
    if (!banquero) return res.status(400).json({ error: 'No encontré al cliente que da ("' + (b.banquero || '') + '"). Escríbelo como está en Clientes.' });
    if (jugador === banquero) return res.status(400).json({ error: 'El que juega y el que da no pueden ser el mismo cliente.' });
    const j = armarJugada({ apuestaTxt: b.apuesta, monto: b.monto });
    if (!j.ok) return res.status(400).json({ error: j.motivo });
    if (!(await validarCarreraEditable(req, fecha, b.hipodromo, carrera))) return res.status(409).json({ error: 'Esa carrera ya tiene plano calculado. Reábrela primero para poder agregar jugadas.' });
    const textoLinea = 'Juega ' + jugador + ' ' + motor.apuestaSegura(j.apuesta) + ' con ' + motor.montoParaLinea(j.monto) + ' da ' + banquero;
    const r = await db.query(
      `INSERT INTO hipismo_chat_jugadas (grupo_id, fecha, hipodromo_nombre, carrera_numero, jugador_nombre, banquero_nombre, monto, riesgo_jugador, riesgo_banquero, texto_linea, apuesta, cerrada_en)
       VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11, (SELECT max(cerrada_en) FROM hipismo_chat_jugadas WHERE grupo_id = $1 AND fecha = $2::date AND hipodromo_nombre = $3 AND carrera_numero = $4 AND resuelta = false))
       RETURNING id`,
      [req.grupoId, fecha, b.hipodromo, carrera, jugador, banquero, j.monto, j.riesgoJugador, j.riesgoBanquero, textoLinea, JSON.stringify(j.apuesta)]
    );
    res.status(201).json({ ok: true, id: r.rows[0].id });
  }));

  async function jugadaEditable(req, res) {
    const r = await db.query('SELECT id, resuelta, adelantada_jugada_id FROM hipismo_chat_jugadas WHERE id = $1 AND grupo_id = $2', [req.params.id, req.grupoId]);
    if (!r.rows.length) { res.status(404).json({ error: 'Esa jugada no existe.' }); return null; }
    if (r.rows[0].resuelta) { res.status(409).json({ error: 'Esa jugada ya fue calculada con la pizarra. Reabre la carrera para poder cambiarla.' }); return null; }
    if (r.rows[0].adelantada_jugada_id) { res.status(409).json({ error: 'Esa jugada es de la versión anterior del bot: edítala en Jugadas entre Tercios Adelantadas.' }); return null; }
    return r.rows[0];
  }

  // PUT /jugadas/:id — corrige jugador, banquero, apuesta o monto de una jugada en espera.
  router.put('/jugadas/:id', asyncHandler(async (req, res) => {
    if (!(await jugadaEditable(req, res))) return;
    const b = req.body || {};
    const jugador = await nombreCliente(req.grupoId, b.jugador), banquero = await nombreCliente(req.grupoId, b.banquero);
    if (!jugador) return res.status(400).json({ error: 'No encontré al cliente que juega ("' + (b.jugador || '') + '").' });
    if (!banquero) return res.status(400).json({ error: 'No encontré al cliente que da ("' + (b.banquero || '') + '").' });
    if (jugador === banquero) return res.status(400).json({ error: 'El que juega y el que da no pueden ser el mismo cliente.' });
    const j = armarJugada({ apuestaTxt: b.apuesta, monto: b.monto });
    if (!j.ok) return res.status(400).json({ error: j.motivo });
    const textoLinea = 'Juega ' + jugador + ' ' + motor.apuestaSegura(j.apuesta) + ' con ' + motor.montoParaLinea(j.monto) + ' da ' + banquero;
    await db.query(
      `UPDATE hipismo_chat_jugadas SET jugador_nombre = $1, banquero_nombre = $2, monto = $3, riesgo_jugador = $4, riesgo_banquero = $5, texto_linea = $6, apuesta = $7
        WHERE id = $8 AND grupo_id = $9 AND resuelta = false`,
      [jugador, banquero, j.monto, j.riesgoJugador, j.riesgoBanquero, textoLinea, JSON.stringify(j.apuesta), req.params.id, req.grupoId]
    );
    res.json({ ok: true });
  }));

  // DELETE /jugadas/:id — elimina una jugada en espera (su saldo se libera al instante).
  router.delete('/jugadas/:id', asyncHandler(async (req, res) => {
    if (!(await jugadaEditable(req, res))) return;
    await db.query('DELETE FROM hipismo_chat_jugadas WHERE id = $1 AND grupo_id = $2 AND resuelta = false', [req.params.id, req.grupoId]);
    res.json({ ok: true });
  }));

  // POST /reabrir — una carrera ya calculada: el plano pasa a la papelera (se revierten saldos y tickets, igual que Eliminar Planos),
  // y las jugadas del bot vuelven a quedar en espera para editarlas y poner la pizarra otra vez.
  router.post('/reabrir', asyncHandler(async (req, res) => {
    const { fecha, hipodromo } = req.body || {}; const carrera = parseInt((req.body || {}).carrera, 10);
    if (!FECHA_RE.test(String(fecha || '')) || !hipodromo || !(carrera > 0)) return res.status(400).json({ error: 'Faltan la fecha, el hipódromo o la carrera.' });
    const calc = await db.query('SELECT count(*)::int AS n FROM hipismo_chat_jugadas WHERE grupo_id = $1 AND fecha = $2::date AND hipodromo_nombre = $3 AND carrera_numero = $4 AND resuelta = true', [req.grupoId, fecha, hipodromo, carrera]);
    if (!calc.rows[0].n) return res.status(409).json({ error: 'Esa carrera no tiene jugadas calculadas del bot.' });
    const p = await db.query('SELECT id FROM hipismo_planos WHERE grupo_id = $1 AND fecha = $2::date AND hipodromo_nombre = $3 AND carrera_numero = $4 ORDER BY creado_en DESC', [req.grupoId, fecha, hipodromo, carrera]);
    for (const plano of p.rows) {
      const resultado = await hipismoPlanosPapelera.eliminarPlano(req.grupoId, plano.id);
      if (registrarAlerta) await registrarAlerta(req, { tipo: 'PLANO_ELIMINADO', hipodromoNombre: hipodromo, carreraNumero: carrera, fecha, mensaje: 'Se reabrió ' + hipodromo + ', carrera ' + carrera + ' desde JUGADAS BOT IA: el plano calculado se movió a la papelera.' });
      void resultado;
    }
    await db.query(
      `UPDATE hipismo_chat_jugadas SET resuelta = false, cerrada_en = now()
        WHERE grupo_id = $1 AND fecha = $2::date AND hipodromo_nombre = $3 AND carrera_numero = $4 AND resuelta = true AND adelantada_jugada_id IS NULL`,
      [req.grupoId, fecha, hipodromo, carrera]
    );
    res.json({ ok: true });
  }));

  return router;
};
module.exports._armarJugada = armarJugada;
module.exports._apuestaComoTexto = apuestaComoTexto;
