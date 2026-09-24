// =================================================================
// Resumen semanal de UN cliente de Hipismo (24-09-2026, a pedido del
// usuario: nueva pestaña "Saldos > Detallado por Cliente" — "basicamente
// lo mismo que balance general pero al darle click al cliente puedo ver
// todas sus jugadas, asi como ellos la ven en sus links personalizados").
//
// Esto es EXACTAMENTE el mismo armado (día > hipódromo > carreras, con
// Deportes "anclado" si aplica) que ya usaba routes/hipismoCliente.js
// (el portal público, sin login, por token) — se saca a este archivo
// propio para poder reusarlo tal cual desde 2 lugares sin duplicar la
// lógica:
//   1) el portal público del cliente (routes/hipismoCliente.js, busca al
//      jugador por su token, sin sesión), y
//   2) la nueva pantalla del Administrador "Detallado por Cliente"
//      (GET /api/hipismo/clientes/:nombre/detalle-semana en
//      routes/hipismo.js, con sesión normal, busca al jugador por
//      nombre+grupo) — así el Administrador ve EXACTAMENTE lo mismo que
//      el cliente ve en su propio link, sin poder desviarse nunca de esa
//      fuente ("puedo ver todas sus jugadas, asi como ellos la ven en
//      sus links personalizados").
const { obtenerLineasHipismoCliente } = require('./hipismoLineasCliente');
const { leerHistorial } = require('./historial');

// "⚽ Deportes" se guarda como un hipódromo más dentro de "dias[].hipodromos"
// (mismo shape que un hipódromo real), pero con tipo:'deportes' — ver la
// nota grande que tenía routes/hipismoCliente.js antes de este refactor.
const NOMBRE_BLOQUE_DEPORTES = 'Deportes';

function resultadoTicketDeportes(t) {
  if (t.estado === 'GANADA') return t.gana;
  if (t.estado === 'PERDIDA') return -t.arriesga;
  return 0;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDeFechaUTC(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function hoyVenezuela() { return new Date(Date.now() - 4 * 60 * 60 * 1000); }
function rangoSemana(fecha, offsetSemanas) {
  const diaSemana = fecha.getUTCDay();
  const diffHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(fecha);
  lunes.setUTCDate(lunes.getUTCDate() + diffHastaLunes + offsetSemanas * 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  return { desde: isoDeFechaUTC(lunes), hasta: isoDeFechaUTC(domingo) };
}

// jugador: fila de "jugadores" (necesita .grupo_id, .nombre, .modulos_anclados).
// grupo: fila de "grupos" (necesita .nombre, .logo_url, .modulo_deportes_habilitado).
// semanaParam: 'actual' (default) | 'anterior'.
async function construirResumenClienteHipismo(jugador, grupo, semanaParam) {
  const semana = semanaParam === 'anterior' ? 'anterior' : 'actual';
  const offset = semana === 'anterior' ? -1 : 0;
  const hoyVe = hoyVenezuela();
  const { desde, hasta } = rangoSemana(hoyVe, offset);
  const hoyIso = isoDeFechaUTC(hoyVe);

  const lineasHipismo = await obtenerLineasHipismoCliente(jugador.grupo_id, jugador.nombre, desde, hasta);

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
      tipo: linea.tipo,
      ganoRemate: linea.ganoRemate,
      subtipo: linea.subtipo,
      numeroEjemplar: linea.numeroEjemplar,
      numero1: linea.numero1,
      numero2: linea.numero2
    };
    if (linea.modalidad === 'pp') {
      carrera.caballoA = linea.caballoA;
      carrera.caballoB = linea.caballoB;
    } else if (linea.tipo !== 'adelantada') {
      carrera.caballo = linea.caballo;
    }
    hipMap.get(hipNombre).carreras.push(carrera);

    totalSemana += linea.resultado;
    if (fechaIso === hoyIso) totalHoy += linea.resultado;
  });

  const totalHipismo = totalSemana;
  let totalDeportes = 0;
  let cantidadJugadasDeportes = 0;

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

  return {
    grupo: { nombre: grupo.nombre, logoUrl: grupo.logo_url },
    jugador: { nombre: jugador.nombre },
    semana,
    rango: { desde, hasta },
    hoy: hoyIso,
    esSemanaActual: hoyIso >= desde && hoyIso <= hasta,
    modulos: { hipismo: true, deportes: deportesAnclado },
    resumen: {
      totalSemana,
      totalHoy,
      cantidadJugadas: lineasHipismo.length + cantidadJugadasDeportes,
      totalHipismo,
      totalDeportes,
      cantidadJugadasHipismo: lineasHipismo.length,
      cantidadJugadasDeportes
    },
    dias
  };
}

module.exports = { construirResumenClienteHipismo };
