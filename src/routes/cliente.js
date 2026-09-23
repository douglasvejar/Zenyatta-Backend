// =================================================================
// VISTA PÚBLICA DEL CLIENTE (apostador) — "CLIENTE: abre su link, solo
// lectura" del diagrama de arquitectura.
// =================================================================
// Sin autenticación de usuario/contraseña a propósito: el token largo e
// impredecible de la tabla "jugadores" ES el acceso — igual que un link
// "no listado" de Google Drive. Cualquiera con el link ve SOLO los datos
// de ESE jugador, nunca los de otro cliente del mismo grupo ni de otro
// grupo.
const express = require('express');
const db = require('../db');
const { calcularResumenHistorico } = require('../services/historial');
const { cargarConfigGrupo } = require('../services/grupoConfig');
const { calcularComisionTotalCliente } = require('../services/comisiones');
const { calcularPozoJugador } = require('../services/pozo');
const { leerHistorial, calcularRangoRapido, fechasConfirmadas } = require('../services/historial');
const { leerPolla } = require('../services/polla');
const { fechaHoraVenezuelaTexto } = require('../services/fechaVenezuela');
const { obtenerConfirmacionHoy, registrarConfirmacion } = require('../services/confirmaciones');
const { telefonoPrincipal } = require('../services/telefonos');
// Hipismo "anclado" (23-09-2026, a pedido del usuario: "hazlo tambien al
// revez, pero solo sucedera si yo anclo o lo avctivo esa funcion al
// cliente, si no cada pantalla es independiente") — mismo criterio en
// espejo del que ya usa el link de Hipismo para anclar Deportes (ver
// routes/hipismoCliente.js): SOLO si el Administrador prendió
// jugadores.modulos_anclados para este cliente puntual Y el grupo tiene
// el módulo de Hipismo habilitado, este link también trae sus jugadas
// de Hipismo — separadas (aparecen como tickets propios, con 🐎) pero
// sumadas al balance total de arriba.
const { obtenerLineasHipismoCliente, textoJugadaHipismo } = require('../services/hipismoLineasCliente');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Busca el jugador (por su token público) y valida que su grupo exista y
// esté activo — el mismo chequeo que hacían todas las rutas de acá, ahora
// compartido entre el GET de siempre y las 2 rutas nuevas de confirmar/
// diferencia (02-09-2026), para no repetirlo 3 veces.
async function buscarJugadorYGrupo(token) {
  const r = await db.query('SELECT * FROM jugadores WHERE token = $1', [token]);
  const jugador = r.rows[0];
  if (!jugador) {
    const err = new Error('Link inválido.');
    err.status = 404;
    throw err;
  }
  const grupoRes = await db.query('SELECT activo, nombre, logo_url, modulo_hipismo_habilitado FROM grupos WHERE id = $1', [jugador.grupo_id]);
  const grupo = grupoRes.rows[0];
  if (!grupo || !grupo.activo) {
    const err = new Error('Esta cuenta no está disponible en este momento.');
    err.status = 403;
    throw err;
  }
  return { jugador, grupo };
}

router.get('/:token', asyncHandler(async (req, res) => {
  let jugador, grupo;
  try {
    ({ jugador, grupo } = await buscarJugadorYGrupo(req.params.token));
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }

  // Rango: ?desde&hasta, o ?rango=hoy|semana|mes|todo (por defecto: semana
  // actual lunes-domingo, igual que el resto de los reportes de la app).
  let desde = req.query.desde;
  let hasta = req.query.hasta;
  if (!desde && !hasta) {
    const rango = await calcularRangoRapido(jugador.grupo_id, req.query.rango || 'semana');
    desde = rango.desde;
    hasta = rango.hasta;
  }

  const { porcentajesPropios, avalesMap, modeloComision, tiersComision, modelosComisionPorCliente } = await cargarConfigGrupo(jugador.grupo_id);
  const configComision = { modelo: modeloComision, tiers: tiersComision, modelosPorCliente: modelosComisionPorCliente };
  const resumenGrupo = await calcularResumenHistorico(jugador.grupo_id, desde, hasta, modeloComision, tiersComision);
  const comision = calcularComisionTotalCliente(jugador.nombre, resumenGrupo, porcentajesPropios, avalesMap, configComision);
  const rc = resumenGrupo[jugador.nombre] || { arriesgado: 0, arriesgadoComisionable: 0, ganado: 0, perdido: 0, pendientes: 0 };
  const tickets = await leerHistorial(jugador.grupo_id, { desde, hasta, cliente: jugador.nombre });
  const pozo = jugador.tipo_cuenta === 'avalado' ? await calcularPozoJugador(jugador.grupo_id, jugador) : null;

  // "Polla" (02-09-2026, a pedido del usuario): juego aparte de la
  // sábana — ver services/polla.js. Se le suma al "balance" del rango y
  // se manda aparte (por fecha) para que el Cliente vea un renglón
  // "Polla: $X" en el día que corresponda, tal como pidió el usuario.
  const polla = await leerPolla(jugador.grupo_id, { desde, hasta, cliente: jugador.nombre });
  const totalPolla = polla.reduce((acc, p) => acc + p.monto, 0);

  // "Guardar Día" (01-09-2026, a pedido del usuario): el Cliente también
  // ve, por cada día que tenga jugadas en el rango, si esa sábana ya
  // quedó confirmada como la oficial del día ("💾 Guardar Día" del panel
  // del Grupo) o si todavía puede cambiar — mismo mecanismo ya usado en
  // el Historial por Cliente del panel de Administración.
  const fechasDelRango = [...new Set(tickets.map(t => t.fecha))];
  const confirmadas = await fechasConfirmadas(jugador.grupo_id, fechasDelRango);

  // Botones "Estamos cuadrados"/"Tengo diferencia" (02-09-2026, a pedido
  // del usuario): el frontend necesita saber si el jugador YA usó el
  // botón hoy (fecha de Venezuela) para pintarlo ya usado, y a qué
  // número de WhatsApp mandar el mensaje de "Tengo diferencia" (siempre
  // el primero cargado por el Súper-admin — ver services/telefonos.js).
  const confirmacionHoy = await obtenerConfirmacionHoy(jugador.id);
  const telefono = await telefonoPrincipal(jugador.grupo_id);

  // Hipismo "anclado" (23-09-2026) — ver la nota grande arriba y
  // sql/schema.sql. Las líneas de Hipismo se disfrazan de "ticket" de
  // Deportes (mismos campos: fecha/ticket/detalle/estado/arriesga/gana)
  // para que renderDias() del frontend las pinte con el MISMO componente
  // de siempre, sin tener que enseñarle nada nuevo — cada una lleva un
  // 🐎 adelante en el campo "ticket" para que se distingan de un vistazo.
  let totalHipismo = 0;
  let cantidadTicketsHipismo = 0;
  const hipismoAnclado = !!(jugador.modulos_anclados && grupo.modulo_hipismo_habilitado);
  if (hipismoAnclado) {
    const lineasHipismo = await obtenerLineasHipismoCliente(jugador.grupo_id, jugador.nombre, desde, hasta);
    lineasHipismo.forEach(linea => {
      totalHipismo += linea.resultado;
      cantidadTicketsHipismo += 1;
      tickets.push({
        fecha: linea.fecha,
        cliente: jugador.nombre,
        ticket: `🐎 ${linea.hipodromoNombre} · ${linea.carreraNumero}ta`,
        detalle: textoJugadaHipismo(linea),
        arriesga: linea.monto,
        gana: linea.resultado > 0 ? linea.resultado : 0,
        estado: linea.resultado > 0 ? 'GANADA' : (linea.resultado < 0 ? 'PERDIDA' : 'ANULADA'),
        logros: null
      });
    });
  }

  res.json({
    grupo: { nombre: grupo.nombre, logoUrl: grupo.logo_url },
    jugador: { nombre: jugador.nombre, tipoCuenta: jugador.tipo_cuenta },
    rango: { desde, hasta },
    horaVenezuela: fechaHoraVenezuelaTexto(),
    diasConfirmados: Array.from(confirmadas),
    confirmacionHoy,
    telefonoDiferencia: telefono ? telefono.telefono : null,
    // "hipismo: true" acá significa "este link SÍ está mostrando Hipismo
    // anclado ahora mismo" — mismo criterio en espejo que "modulos" en
    // routes/hipismoCliente.js.
    modulos: { deportes: true, hipismo: hipismoAnclado },
    resumen: {
      arriesgado: rc.arriesgado,
      ganado: rc.ganado,
      perdido: rc.perdido,
      // Combinado (mismo pedido que del lado de Hipismo: "un solo saldo
      // que sea la suma de los 2") — totalHipismo es 0 si no está anclado,
      // así que esta cuenta no cambia nada para nadie que no lo prendió.
      balance: rc.ganado - rc.perdido + totalPolla + totalHipismo,
      comision: comision.total,
      pendientes: rc.pendientes,
      polla: totalPolla,
      totalDeportes: rc.ganado - rc.perdido + totalPolla,
      totalHipismo,
      cantidadTicketsHipismo
    },
    pozo,
    tickets,
    polla
  });
}));

// "Estamos cuadrados" / "Tengo diferencia" (02-09-2026, a pedido del
// usuario) — "no es necesario que los clientes deban confirmar o no la
// cuenta para que el grupo se lleve con normalidad solo es un plus": esta
// ruta SOLO deja constancia (tabla confirmaciones_cliente + una alerta
// visible para el Grupo y Súper-admin, ver services/confirmaciones.js),
// nunca cambia ningún saldo ni bloquea nada. Body: { tipo: 'CUADRADO' |
// 'DIFERENCIA' }. Usable una sola vez por día (de Venezuela) por
// jugador — un segundo intento el mismo día responde 409.
router.post('/:token/confirmar', asyncHandler(async (req, res) => {
  let jugador, grupo;
  try {
    ({ jugador, grupo } = await buscarJugadorYGrupo(req.params.token));
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
  try {
    const resultado = await registrarConfirmacion(jugador.grupo_id, jugador, grupo.nombre, req.body.tipo);
    res.status(201).json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'No se pudo registrar la confirmación.' });
  }
}));

module.exports = router;
