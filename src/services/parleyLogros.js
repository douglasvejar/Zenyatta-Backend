// =================================================================
// LOGROS AUTOMÁTICOS DE LA CALCULADORA PARLEY (01-10-2026) — ver el
// comentario grande en sql/schema.sql (tablas parley_juegos y
// parley_estado) para el contexto completo del pedido del usuario.
//
// Este archivo SÍ toca la base de datos (a diferencia de
// services/oddsApiProvider.js, que solo sabe hablar con el proveedor
// externo) — junta "consultar The Odds API" + "guardar el resultado" +
// "dejar registrado cómo salió esa corrida" en un solo lugar.
// =================================================================
const db = require('../db');
const { obtenerTodosLosLogros } = require('./oddsApiProvider');

// Ligas por defecto si no se configura ODDS_API_DEPORTES — las 3 del
// pedido original del usuario que SIEMPRE usan moneyline americano
// (MLB, NFL, NBA) más un par de ligas de fútbol conocidas (fútbol se
// pidió también, pero sin aclarar liga puntual). Agregar/quitar una
// liga es solo cambiar la variable de entorno, nunca hace falta tocar
// este archivo — la lista completa de "sport key" válidos la da el
// propio proveedor en GET https://api.the-odds-api.com/v4/sports/?apiKey=...
const DEPORTES_POR_DEFECTO = [
  'baseball_mlb',
  'americanfootball_nfl',
  'basketball_nba',
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_uefa_champs_league'
];

function obtenerDeportesConfigurados() {
  const crudo = (process.env.ODDS_API_DEPORTES || '').trim();
  if (!crudo) return DEPORTES_POR_DEFECTO;
  return crudo.split(',').map(s => s.trim()).filter(Boolean);
}

// Reemplaza TODO el contenido de parley_juegos por lo que acaba de
// devolver el proveedor (mismo criterio que "SABANA DE JUGADAS...
// siempre sustituye a la anterior" — ver sql/schema.sql) y deja
// parley_estado con el resultado de esta corrida, haya salido bien o
// mal, para que la página pública siempre pueda explicar qué está
// pasando en vez de mostrar un silencio raro.
async function refrescarLogrosParley() {
  const apiKey = (process.env.ODDS_API_KEY || '').trim();
  if (!apiKey) {
    console.log('ODDS_API_KEY no configurada — la Calculadora Parley sigue funcionando en modo manual (sin logros automáticos).');
    return { ok: false, motivo: 'sin_api_key' };
  }

  const deportes = obtenerDeportesConfigurados();
  const { filas, errores } = await obtenerTodosLosLogros(deportes, apiKey);

  if (errores.length > 0) {
    console.error('Logros Parley: hubo errores consultando The Odds API:\n - ' + errores.join('\n - '));
  }

  await db.transaccion(async (client) => {
    await client.query('DELETE FROM parley_juegos');
    // Un solo INSERT multi-fila en vez de una query por fila — puede
    // haber varios cientos de filas (6+ ligas, varios partidos y
    // selecciones cada una) y no hace falta una ida y vuelta por fila.
    if (filas.length > 0) {
      const columnas = ['deporte', 'liga', 'evento_id', 'equipo_local', 'equipo_visitante', 'hora_inicio', 'seleccion', 'nombre_seleccion', 'logro'];
      const valores = [];
      const placeholders = filas.map((f, i) => {
        const base = i * columnas.length;
        valores.push(f.deporte, f.liga, f.eventoId, f.equipoLocal, f.equipoVisitante, f.horaInicio, f.seleccion, f.nombreSeleccion, f.logro);
        return '(' + columnas.map((_, j) => '$' + (base + j + 1)).join(', ') + ')';
      });
      await client.query(
        'INSERT INTO parley_juegos (' + columnas.join(', ') + ') VALUES ' + placeholders.join(', '),
        valores
      );
    }

    const exitosa = errores.length === 0 || filas.length > 0; // si al menos algún deporte respondió bien, se considera corrida útil
    const mensaje = errores.length > 0 ? errores.join(' | ') : null;
    await client.query(
      `insert into parley_estado (id, ultima_corrida_en, exitosa, mensaje, juegos_cargados)
       values (true, now(), $1, $2, $3)
       on conflict (id) do update set
         ultima_corrida_en = excluded.ultima_corrida_en,
         exitosa = excluded.exitosa,
         mensaje = excluded.mensaje,
         juegos_cargados = excluded.juegos_cargados`,
      [exitosa, mensaje, filas.length]
    );
  });

  console.log('Logros Parley: corrida completa — ' + filas.length + ' filas cargadas (' + deportes.length + ' ligas consultadas, ' + errores.length + ' con error).');
  return { ok: true, cantidad: filas.length, errores };
}

// Lo que consume GET /api/parley/juegos (routes/parley.js) — datos
// vigentes + hace cuánto se actualizaron, para que la propia página
// pueda avisar "logros actualizados hace X minutos" sin tener que
// adivinarlo.
async function obtenerLogrosVigentes() {
  const { rows: juegos } = await db.query(
    `select deporte, liga, evento_id, equipo_local, equipo_visitante, hora_inicio, seleccion, nombre_seleccion, logro
     from parley_juegos
     order by hora_inicio asc nulls last`
  );
  const { rows: estadoRows } = await db.query('select ultima_corrida_en, exitosa, mensaje from parley_estado where id = true');
  const estado = estadoRows[0] || null;

  let actualizadoHaceMinutos = null;
  if (estado && estado.ultima_corrida_en) {
    actualizadoHaceMinutos = Math.max(0, Math.round((Date.now() - new Date(estado.ultima_corrida_en).getTime()) / 60000));
  }

  return { juegos, actualizadoHaceMinutos, estado };
}

module.exports = { refrescarLogrosParley, obtenerLogrosVigentes, obtenerDeportesConfigurados };
