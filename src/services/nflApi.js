// =================================================================
// CONECTOR A LA API DE NFL (vía la API "oculta"/no oficial de ESPN)
// =================================================================
// Mismo espíritu que mlbApi.js: sin API key, sin costo, se le pega
// directo al endpoint público que usa el propio sitio de ESPN. No es una
// API oficialmente documentada por ESPN (igual que statsapi.mlb.com no es
// 100% oficial de MLB) — puede cambiar sin aviso, pero es ampliamente
// usada por desarrolladores y viene siendo estable en la práctica.
//
// A diferencia de la API de MLB, esta SÍ trae el logo de cada equipo
// directo en la respuesta del marcador (team.logo) — no hace falta un
// segundo pedido para armar un mapa nombre->logo aparte.
//
// "1h" / primera mitad (31-08-2026, a pedido del usuario): confirmado
// contra la API real de ESPN (vía la herramienta de búsqueda web) que
// cada competitor SÍ trae un array `linescores` con el puntaje de CADA
// cuarto por separado (ej. [{period:1,value:0},{period:2,value:7},...]).
// La primera mitad es la suma de los períodos 1 y 2 — mismo espíritu que
// mlbApi.js suma las primeras 5 entradas de `linescore.innings`.
async function obtenerResultadosNFL(fechaISO) {
  const datosNFL = {};
  const fechaCompacta = (fechaISO || '').replace(/-/g, ''); // 'YYYY-MM-DD' -> 'YYYYMMDD' (formato que pide ESPN)

  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=' + fechaCompacta);
    const json = await res.json();

    (json.events || []).forEach(ev => {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) return;

      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      if (!home || !away || !home.team || !away.team) return;

      const tipoEstado = (comp.status && comp.status.type) || {};
      const finalizado = tipoEstado.completed === true;
      // Un "suspendido/pospuesto" en NFL es raro (mal tiempo severo), pero
      // se detecta igual que en MLB: por el texto de la descripción del
      // estado, no por un código fijo (ESPN no lo documenta oficialmente).
      const suspendido = !finalizado && /suspend|postpon|cancel/i.test(tipoEstado.description || tipoEstado.name || '');

      const homeScore = Number(home.score) || 0;
      const awayScore = Number(away.score) || 0;
      const periodo = (comp.status && comp.status.period) || 0;

      // Suma de los cuartos 1 y 2 = marcador de la primera mitad ("1h").
      // Si `linescores` no viniera (raro, pero por si acaso — ej. un
      // partido que ni empezó), queda en 0 y no se usa hasta que
      // `final1H` sea true (ver más abajo).
      const sumaPrimeraMitad = (competitor) => (competitor.linescores || [])
        .filter(ls => ls.period === 1 || ls.period === 2)
        .reduce((suma, ls) => suma + (Number(ls.value) || 0), 0);
      const homeScore1H = sumaPrimeraMitad(home);
      const awayScore1H = sumaPrimeraMitad(away);

      // ¿Ya terminó la primera mitad? Si el juego entero ya terminó, obvio
      // que sí. Si va por el 3er cuarto o más, la mitad ya pasó. Y si
      // sigue en el 2do cuarto, se usa el texto del estado para detectar
      // el entretiempo ("Halftime") — ESPN no documenta un código fijo
      // para esto, así que se busca por texto, mismo criterio que ya se
      // usa para detectar "suspendido/pospuesto" acá y en mlbApi.js.
      const enEntretiempo = periodo === 2 && /halftime|entretiempo/i.test(tipoEstado.description || tipoEstado.name || '');
      const final1H = finalizado || periodo > 2 || enEntretiempo;

      const info = {
        deporte: 'nfl',
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore,
        awayScore,
        totalScore: homeScore + awayScore,
        homeScore1H,
        awayScore1H,
        final1H,
        finalizado,
        suspendido,
        homeTeamLogo: home.team.logo || null,
        awayTeamLogo: away.team.logo || null,
        enVivo: {
          idJuego: ev.id,
          estadoDetallado: tipoEstado.description || '',
          estadoAbstracto: tipoEstado.state || '', // 'pre' | 'in' | 'post'
          horaInicioUTC: ev.date || null,
          periodo,
          periodoTexto: periodoATexto(periodo, tipoEstado.state),
          relojTexto: (comp.status && comp.status.displayClock) || ''
        }
      };

      // Igual que en MLB: se guarda 2 veces (local y visitante) para poder
      // buscar el juego por CUALQUIERA de los 2 nombres de equipo.
      datosNFL[home.team.displayName.toLowerCase()] = info;
      datosNFL[away.team.displayName.toLowerCase()] = info;
    });
  } catch (e) {
    console.error('Error al conectar con la API de NFL (ESPN):', e);
  }

  return datosNFL;
}

function periodoATexto(periodo, estadoAbstracto) {
  if (estadoAbstracto === 'pre' || !periodo) return '';
  const nombres = { 1: '1er cuarto', 2: '2do cuarto', 3: '3er cuarto', 4: '4to cuarto' };
  return nombres[periodo] || 'Tiempo extra';
}

module.exports = { obtenerResultadosNFL };
