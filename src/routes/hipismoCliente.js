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
// jugador en Hipismo, nunca los de otro cliente ni los de Deportes.
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

const router = express.Router();

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

  const rGrupo = await db.query('SELECT activo, nombre, logo_url, modulo_hipismo_habilitado FROM grupos WHERE id = $1', [jugador.grupo_id]);
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

  const r = await db.query(
    `SELECT t.cliente_nombre, t.banquero_nombre, t.modalidad, t.caballo, t.monto,
            t.resultado_jugador, t.resultado_banquero,
            p.fecha, p.hipodromo_nombre, p.carrera_numero, p.pizarra,
            h.pais
       FROM hipismo_tickets t
       JOIN hipismo_planos p ON p.id = t.plano_id
       LEFT JOIN hipismo_hipodromos h ON h.id = p.hipodromo_id
      WHERE t.grupo_id = $1 AND (t.cliente_nombre = $2 OR t.banquero_nombre = $2)
        AND p.fecha BETWEEN $3 AND $4
      ORDER BY p.fecha DESC, p.creado_en ASC`,
    [jugador.grupo_id, jugador.nombre, desde, hasta]
  );

  // Agrupa por día > hipódromo — mismo shape que ya esperaba el mockup
  // (DIAS: [{ fecha, hipodromos: [{ nombre, pais, carreras: [...] }] }]),
  // así el frontend nuevo casi no cambia respecto al borrador.
  const porDia = new Map();
  let totalSemana = 0;
  let totalHoy = 0;

  r.rows.forEach(row => {
    const esJugador = row.cliente_nombre === jugador.nombre;
    const rol = esJugador ? 'jugador' : 'banquero';
    const resultado = Number(esJugador ? row.resultado_jugador : row.resultado_banquero);
    const fechaIso = row.fecha instanceof Date ? row.fecha.toISOString().slice(0, 10) : row.fecha;

    if (!porDia.has(fechaIso)) porDia.set(fechaIso, new Map());
    const hipMap = porDia.get(fechaIso);
    const hipNombre = row.hipodromo_nombre;
    if (!hipMap.has(hipNombre)) hipMap.set(hipNombre, { nombre: hipNombre, pais: row.pais || 'VE', carreras: [] });

    const carrera = {
      carrera: row.carrera_numero,
      pizarra: row.pizarra,
      modalidad: row.modalidad,
      monto: Number(row.monto),
      rol,
      resultado
    };
    if (row.modalidad === 'pp') {
      const partes = String(row.caballo).split(/x/i);
      carrera.caballoA = partes[0];
      carrera.caballoB = partes[1];
    } else {
      carrera.caballo = row.caballo;
    }
    hipMap.get(hipNombre).carreras.push(carrera);

    totalSemana += resultado;
    if (fechaIso === hoyIso) totalHoy += resultado;
  });

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
    resumen: {
      totalSemana,
      totalHoy,
      cantidadJugadas: r.rows.length
    },
    dias
  });
}));

module.exports = router;
