// =================================================================
// LOGOS DE EQUIPO PARA LA CALCULADORA PARLEY Y LA PESTAÑA PARLEYS
// (01-10-2026, a pedido del usuario: "agrega a cada equipo su logo igual
// que en el modulo de deportes, colcoale su fondo blanco para que todo
// se vea, el logo va al lado izquierdo antes del nombre").
//
// Mismo criterio de todo el proyecto ("confirmado con un pedido real, no
// adivinado"): se reutilizan EXACTAMENTE los mismos 2 proveedores de
// logos que ya usa el módulo de Deportes, sin inventar un endpoint
// nuevo:
//   - MLB: statsapi.mlb.com/api/v1/teams (directorio de equipos, con su
//     id) + el patrón de URL mlbstatic.com/team-logos/{id}.svg — igual
//     que public/app.js, función cargarMapaLogosEquipos() (ahí corre en
//     el navegador; acá hace falta la misma lógica del lado del
//     servidor porque esto corre dentro del refresco automático de
//     parleyLogros.js, no en el navegador del cliente).
//   - NFL/NBA/Soccer: el MISMO endpoint de "scoreboard" de ESPN que ya
//     usan nflApi.js/nbaApi.js/soccerApi.js
//     (site.api.espn.com/.../scoreboard?dates=YYYYMMDD), que trae el
//     logo de cada equipo directo en competitors[].team.logo — se pide
//     una sola vez por cada combinación (liga, fecha) que de verdad
//     aparece entre los juegos que acaba de traer The Odds API, nunca
//     partido por partido.
//
// Se investigó también un endpoint separado de ESPN (".../teams", sin
// "/scoreboard") que traería un directorio de logos sin depender de la
// fecha, pero su forma exacta de respuesta NO se pudo confirmar contra
// una respuesta real en este sandbox (bloqueado por la propia
// herramienta de lectura web). Por la misma disciplina del proyecto, se
// descartó a propósito en vez de adivinar su forma, y en su lugar se
// reusa el patrón de "scoreboard por fecha" ya confirmado y en uso en el
// resto del sistema.
//
// Si un partido no tiene fecha, o su fecha/nombre de equipo no cruza con
// lo que devuelve ESPN (ej. The Odds API usa un nombre levemente
// distinto al de ESPN), el logo de ESE partido simplemente queda sin
// cargar — la plantilla ya oculta el <img> con onerror (igual que en el
// resto del sistema), nunca rompe la página ni el refresco.
//
// Esto NO gasta nada de los créditos de ODDS_API_KEY: estos 2
// proveedores (statsapi.mlb.com y site.api.espn.com) son gratis, sin
// clave, y están completamente separados del proveedor de cuotas (The
// Odds API).
// =================================================================

// Mapa de "sport_key" de The Odds API (tal cual aparece en
// ODDS_API_DEPORTES — ver DEPORTES_POR_DEFECTO en parleyLogros.js) a su
// ruta equivalente en ESPN. MLB no entra acá (va por el directorio de
// statsapi.mlb.com, no por fecha). Cubre, por ahora, exactamente los
// "sport_key" que DEPORTES_POR_DEFECTO ya usa; si el usuario agrega otra
// liga de fútbol a la variable de entorno ODDS_API_DEPORTES más
// adelante, hace falta sumarle acá su slug de ESPN (ver LIGAS_SOCCER en
// soccerApi.js para los slugs ya confirmados del módulo de Deportes) —
// si un sport_key no está en este mapa, el logo de esos partidos
// simplemente no carga, no revienta nada.
const MAPA_SPORT_KEY_A_ESPN = {
  americanfootball_nfl: 'football/nfl',
  basketball_nba: 'basketball/nba',
  soccer_epl: 'soccer/eng.1',
  soccer_spain_la_liga: 'soccer/esp.1',
  soccer_uefa_champs_league: 'soccer/uefa.champions'
};

// 'YYYY-MM-DDTHH:MM:SSZ' (commence_time de The Odds API) -> 'YYYYMMDD' (lo que pide ESPN)
function fechaCompacta(iso) {
  if (!iso || typeof iso !== 'string' || iso.length < 10) return null;
  return iso.slice(0, 10).replace(/-/g, '');
}

// Directorio completo de MLB (nombre oficial -> URL del escudo) — se
// pide UNA sola vez por corrida de refrescarLogrosParley(), sin importar
// cuántos partidos de MLB haya.
async function obtenerMapaLogosMLB() {
  const mapa = {};
  try {
    const res = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Yes');
    if (!res.ok) return mapa;
    const json = await res.json();
    (json.teams || []).forEach(t => {
      if (t && t.name && t.id) mapa[t.name.toLowerCase()] = 'https://www.mlbstatic.com/team-logos/' + t.id + '.svg';
    });
  } catch (e) {
    console.error('Logos Parley: error consultando el directorio de equipos de MLB (statsapi.mlb.com):', e.message);
  }
  return mapa;
}

// Logos de todos los partidos de UNA liga/fecha de ESPN (nombre oficial -> URL del escudo).
async function obtenerLogosDeFecha(ruta, fecha) {
  const mapa = {};
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/' + ruta + '/scoreboard?dates=' + fecha);
    if (!res.ok) return mapa;
    const json = await res.json();
    (json.events || []).forEach(ev => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return;
      comp.competitors.forEach(c => {
        if (c && c.team && c.team.displayName && c.team.logo) {
          mapa[c.team.displayName.toLowerCase()] = c.team.logo;
        }
      });
    });
  } catch (e) {
    console.error('Logos Parley: error consultando ESPN (' + ruta + ', fecha ' + fecha + '):', e.message);
  }
  return mapa;
}

// Arma, para TODAS las filas que acaba de traer oddsApiProvider.js, un
// mapa "eventoId -> {logoLocal, logoVisitante}" — pide cada combinación
// (liga, fecha) de ESPN UNA SOLA VEZ aunque haya varios partidos o
// mercados de esa misma combinación ese día, y el directorio de MLB UNA
// SOLA VEZ para toda la corrida, sin importar cuántas filas/mercados
// haya en total.
async function construirMapaLogos(filas) {
  const mapaLogosPorEvento = {};
  if (!filas || filas.length === 0) return mapaLogosPorEvento;

  // 1 "evento" por partido (no hace falta repetir el trabajo por cada mercado/outcome del mismo partido).
  const eventosUnicos = [];
  const vistos = new Set();
  filas.forEach(f => {
    if (!vistos.has(f.eventoId)) { vistos.add(f.eventoId); eventosUnicos.push(f); }
  });

  const eventosMLB = eventosUnicos.filter(f => f.deporte === 'baseball');
  const eventosESPN = eventosUnicos.filter(f => f.deporte !== 'baseball');

  // Combinaciones (ruta ESPN, fecha) realmente necesarias — nunca una por partido.
  const combinacionesNecesarias = new Map(); // clave 'ruta|fecha' -> {ruta, fecha}
  eventosESPN.forEach(f => {
    const ruta = MAPA_SPORT_KEY_A_ESPN[f.sportKeyOriginal];
    const fecha = fechaCompacta(f.horaInicio);
    if (!ruta || !fecha) return; // liga sin mapear a ESPN, o sin fecha: ese partido simplemente no tendrá logo
    combinacionesNecesarias.set(ruta + '|' + fecha, { ruta, fecha });
  });

  const [mapaMLB, mapasESPN] = await Promise.all([
    eventosMLB.length > 0 ? obtenerMapaLogosMLB() : Promise.resolve({}),
    Promise.all(Array.from(combinacionesNecesarias.values()).map(c => obtenerLogosDeFecha(c.ruta, c.fecha)))
  ]);
  const mapaESPNCombinado = Object.assign({}, ...mapasESPN);

  function buscarLogo(deporte, nombreEquipo) {
    const clave = (nombreEquipo || '').toLowerCase();
    if (!clave) return null;
    if (deporte === 'baseball') return mapaMLB[clave] || null;
    return mapaESPNCombinado[clave] || null;
  }

  eventosUnicos.forEach(f => {
    mapaLogosPorEvento[f.eventoId] = {
      logoLocal: buscarLogo(f.deporte, f.equipoLocal),
      logoVisitante: buscarLogo(f.deporte, f.equipoVisitante)
    };
  });

  return mapaLogosPorEvento;
}

module.exports = { obtenerMapaLogosMLB, obtenerLogosDeFecha, construirMapaLogos, fechaCompacta, MAPA_SPORT_KEY_A_ESPN };
