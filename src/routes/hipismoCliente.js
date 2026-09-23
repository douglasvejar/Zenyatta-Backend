// =================================================================
// VISTA PÚBLICA DEL CLIENTE — Módulo Hipismo (22-09-2026, a pedido del
// usuario: "ya los clientes que tienen jugadas o los que se van a crear
// a futuro necesito tengan su link para ver sus saldos.... link sin
// clave ni nada solo entraran al link compartido que se lo daremos
// nosotros al darle click en copiar link, y veran sus jugadas
// semanales, o semana anterior").
//
// Mismo criterio EXACTO que ya usa Deportes en routes/cliente.js: sin
// login, el token largo e impredecible de la tabla "jugadores" (columna
// ya existente, pensada justo para esto — ver el comentario "link
// individual del cliente" en sql/schema.sql) ES el acceso, igual que un
// link "no listado". Cualquiera con el link ve SOLO los datos de ESE
// jugador en Hipismo, y de Deportes SOLO si el Administrador prendió
// jugadores.modulos_anclados para ese cliente puntual (ver más abajo).
//
// A diferencia de Deportes (que lee tickets_historial vía
// services/historial.js), esta vista lee de las tablas propias del
// módulo: hipismo_planos/hipismo_tickets. La comisión de 5% de Hipismo
// YA está aplicada línea por línea dentro de resultado_jugador/
// resultado_banquero (ver services/hipismoCalc.js) — a diferencia de
// Deportes, no depende de jugadores.comision_propia ni de ningún modelo
// de comisión por cliente, así que esta vista no los necesita.
//
// El usuario pidió explícitamente solo 2 estados (no un histórico
// infinito como el de Deportes): "sus jugadas semanales, o semana
// anterior" — ?semana=actual (default) | anterior. Semana FIJA de lunes
// a domingo, mismo criterio ya confirmado con el usuario para el mockup
// (public/hipismo-cliente-portal.html: "dejala fija que la semana
// arranque el lunes y cierre el domingo").
const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { obtenerLineasHipismoCliente } = require('../services/hipismoLineasCliente');
// leerHistorial (23-09-2026, a pedido del usuario: "separame los datos de
// deportes con los de hipismo... el cliente que juegue deportes o
// viceversa, se le puede anclar o incluir la información del otro
// módulo... pero deben salir separados en el link... deportes saldrá
// como si fuera otro hipódromo con sus jugadas detalladas por días") —
// misma función que ya usa el portal público de Deportes
// (routes/cliente.js), reusada tal cual para traer las jugadas de
// Deportes de ESTE MISMO cliente (mismo "jugadores.nombre", misma fila —
// un cliente que juega en los 2 módulos es UN SOLO registro en la tabla
// "jugadores" compartida). SOLO se trae si el Administrador prendió
// jugadores.modulos_anclados para este cliente puntual — "solo sucedera
// si yo anclo o lo activo esa funcion al cliente, si no cada pantalla es
// independiente" (23-09-2026, respuesta del usuario cuando se le
// preguntó si el anclado debía ser automático o por cliente).
const { leerHistorial } = require('../services/historial');

const router = express.Router();

// "⚽ Deportes" se guarda como un hipódromo más dentro de "dias[].hipodromos"
// (mismo shape que un hipódromo real), pero con tipo:'deportes' para que
// el frontend sepa que sus "carreras" en realidad son tickets de sábana
// (ticket/detalle/estado), no carreras de caballos — así queda SEPARADO
// visualmente (su propia tarjeta/chip) aunque el TOTAL de la semana sí
// los suma a los dos (pedido explícito: "en balance general si los uno
// si saldra un solo saldo que seria la suma de total hipismo mas total
// deportes").
const NOMBRE_BLOQUE_DEPORTES = 'Deportes';

// Mismo criterio que calcularResumenHistorico() en services/historial.js
// para convertir un ticket de Deportes en un neto por línea: GANADA suma
// lo que se ganó, PERDIDA resta lo arriesgado, cualquier otro estado
// (pendiente, anulada, etc.) todavía no define nada — no suma ni resta.
function resultadoTicketDeportes(t) {
  if (t.estado === 'GANADA') return t.gana;
  if (t.estado === 'PERDIDA') return -t.arriesga;
  return 0;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 'YYYY-MM-DD' de un Date, tratándolo como si sus campos UTC ya fueran
// la fecha que queremos mostrar (mismo truco que usa
// services/fechaVenezuela.js con la hora, y services/historial.js con
// formatearFechaISO para fechas que vienen de la base).
function isoDeFechaUTC(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// América/Caracas está fija en UTC-4 todo el año (sin horario de verano
// desde 2016) — mismo cálculo que services/fechaVenezuela.js, repetido
// acá porque esa función devuelve directamente el texto/ISO de HOY, no
// el objeto Date que necesitamos para calcular la semana anterior.
function hoyVenezuela() {
  return new Date(Date.now() - 4 * 60 * 60 * 1000);
}

// Lunes..domingo de la semana que contiene `fecha` (un Date "de
// Venezuela", ver arriba), desplazada `offsetSemanas` semanas completas
// (0 = esta semana, -1 = la semana anterior).
function rangoSemana(fecha, offsetSemanas) {
  const diaSemana = fecha.getUTCDay(); // 0=domingo..6=sábado
  const diffHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(fecha);
  lunes.setUTCDate(lunes.getUTCDate() + diffHastaLunes + offsetSemanas * 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  return { desde: isoDeFechaUTC(lunes), hasta: isoDeFechaUTC(domingo) };
}

router.get('/:token', asyncHandler(async (req, res) => {
  const rJugador = await db.query('SELECT * FROM jugadores WHERE token = $1', [req.params.token]);
  const jugador = rJugador.rows[0];
  if (!jugador) return res.status(404).json({ error: 'Link inválido.' });

  const rGrupo = await db.query('SELECT activo, nombre, logo_url, modulo_hipismo_habilitado, modulo_deportes_habilitado FROM grupos WHERE id = $1', [jugador.grupo_id]);
  const grupo = rGrupo.rows[0];
  if (!grupo || !grupo.activo) {
    return res.status(403).json({ error: 'Esta cuenta no está disponible en este momento.' });
  }
  if (!grupo.modulo_hipismo_habilitado) {
    return res.status(403).json({ error: 'El módulo de Hipismo no está disponible para este grupo.' });
  }

  const semana = req.query.semana === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const lineasHipismo = await obtenerLineasHipismoCliente(jugador.grupo_id, jugador.nombre, desde, hasta);

  // Agrupa por día > hipódromo — mismo shape que ya esperaba el mockup
  // (DIAS: [{ fecha, hipodromos: [{ nombre, pais, carreras: [...] }] }]),
  // así el frontend nuevo casi no cambia respecto al borrador.
  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;

  lineasHipismo.forEach(linea => {
    const fechaIso = linea.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    const hipNombre = linea.hipodromoNombre;
    if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, pais: linea.pais, carreras: [] });

    const carrera = {
      carrera: linea.carreraNumero,
      pizarra: linea.pizarra,
      modalidad: linea.modalidad,
      monto: linea.monto,
      rol: linea.rol,
      resultado: linea.resultado,
      // Remate (23-09-2026, ver la nota grande en
      // services/hipismoLineasCliente.js): pasa el tipo tal cual para que
      // el frontend (hipismo-cliente-portal.html) lo pinte distinto y
      // diga "Remate" en vez de una jugada normal de Tercios. Ausente
      // (undefined) para una línea de Tercios normal, sin cambiar nada
      // de su comportamiento actual.
      tipo: linea.tipo,
      ganoRemate: linea.ganoRemate
    };
    if (linea.modalidad === 'pp') {
      carrera.caballoA = linea.caballoA;
      carrera.caballoB = linea.caballoB;
    } else {
      carrera.caballo = linea.caballo;
    }
    hipMap.get(hipNombre).carreras.push(carrera);

    totalSemana += linea.resultado;
    if (fechaIso === hoyIso) totalHoy += linea.resultado;
  });

  const totalHipismo = totalSemana;
  let totalDeportes = 0;
  let cantidadJugadasDeportes = 0;

  // Deportes "anclado" (23-09-2026) — SOLO si el grupo tiene el módulo de
  // Deportes habilitado Y el Administrador prendió jugadores.modulos_anclados
  // para ESTE cliente puntual ("solo sucedera si yo anclo o lo activo esa
  // funcion al cliente, si no cada pantalla es independiente"). Mismo
  // cliente, misma fila en "jugadores" — se busca por el mismo nombre
  // canónico, ya en MAYÚSCULA en los 2 módulos.
  const deportesAnclado = !!(jugador.modulos_anclados && grupo.modulo_deportes_habilitado);
  if (deportesAnclado) {
    const ticketsDeportes = await leerHistorial(jugador.grupo_id, { desde, hasta, cliente: jugador.nombre });
    ticketsDeportes.forEach(t => {
      const resultado = resultadoTicketDeportes(t);
      const fechaIso = t.fecha;

      if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
      const hipMap = porDia.get(fechaIso);
      if (!hipMap.has(NOMBRE_BLOQUE_DEPORTES)) {
        hipMap.set(NOMBRE_BLOQUE_DEPORTES, { nombre: NOMBRE_BLOQUE_DEPORTES, tipo: 'deportes', carreras: [] });
      }
      hipMap.get(NOMBRE_BLOQUE_DEPORTES).carreras.push({
        ticket: t.ticket,
        detalle: t.detalle,
        estado: t.estado,
        monto: t.arriesga,
        resultado
      });

      totalDeportes += resultado;
      cantidadJugadasDeportes += 1;
      totalSemana += resultado;
      if (fechaIso === hoyIso) totalHoy += resultado;
    });
  }

  const dias = Array.from(porDia.entries())
    .map(([fecha, hipMap]) => ({ fecha, hipodromos: Array.from(hipMap.values()) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  res.json({
    grupo: { nombre: grupo.nombre, logoUrl: grupo.logo_url },
    jugador: { nombre: jugador.nombre },
    semana,
    rango: { desde, hasta },
    hoy: hoyIso,
    esSemanaActual: hoyIso >= desde && hoyIso <= hasta,
    // "deportes: true" acá significa "este link SÍ está mostrando
    // Deportes anclado ahora mismo" (no solo que el grupo lo tenga
    // habilitado) — el frontend lo usa para decidir si vale la pena
    // mostrar el desglose Hipismo/Deportes debajo del total combinado.
    modulos: { hipismo: true, deportes: deportesAnclado },
    resumen: {
      // Combinado (pedido explícito: "en balance general si los uno si
      // saldra un solo saldo que seria la suma de total hipismo mas
      // total deportes") — el desglose por módulo va aparte para
      // mostrarlo si hace falta, sin obligar al frontend a recalcularlo.
      totalSemana,
      totalHoy,
      cantidadJugadas: lineasHipismo.length + cantidadJugadasDeportes,
      totalHipismo,
      totalDeportes,
      cantidadJugadasHipismo: lineasHipismo.length,
      cantidadJugadasDeportes
    },
    dias
  });
}));

module.exports = router;
