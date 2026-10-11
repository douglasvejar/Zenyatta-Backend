// PRUEBA (11-10-2026): ticket real "Bayern Munich 1h -210 / Barcelona 1h
// -260" quedó PENDIENTE (sin-cruce) porque football-data.org escribe "FC
// Bayern München" y ESPN "Bayern Munich". Verifica los alias de club y el
// cruce flexible de un solo candidato.
const { obtenerResultadosSoccer, nombresDeEquipoCoinciden } = require('../src/services/soccerApi');
const { _resetCacheParaPruebas } = require('../src/services/footballDataApi');

let pasaron = 0, fallaron = 0;
const check = (c, m) => { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } };

const espn = (h, a) => ({ events: [{ id: 'e1', date: '2026-10-11T18:00Z', competitions: [{
  status: { type: { completed: true, description: 'Final', state: 'post' }, period: 2 },
  competitors: [
    { homeAway: 'home', winner: true, team: { displayName: h, logo: null }, score: '2' },
    { homeAway: 'away', winner: false, team: { displayName: a, logo: null }, score: '1' } ] }] }] });
const fd = (code, hn, hs, an, as, hh, ah) => ({ competition: { code }, status: 'FINISHED',
  homeTeam: { name: hn, shortName: hs }, awayTeam: { name: an, shortName: as },
  score: { halfTime: { home: hh, away: ah }, fullTime: { home: 2, away: 1 } } });

async function caso(liga, h, a, fdPartido) {
  _resetCacheParaPruebas();
  process.env.FOOTBALL_DATA_API_KEY = 'x';
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/' + liga + '/')) return { ok: true, json: async () => espn(h, a) };
    if (u.includes('site.api.espn.com')) return { ok: true, json: async () => ({ events: [] }) };
    if (u.includes('api.football-data.org')) return { ok: true, json: async () => ({ matches: [fdPartido] }) };
    throw new Error('URL inesperada ' + u);
  };
  return obtenerResultadosSoccer('2026-10-11');
}

(async () => {
  check(nombresDeEquipoCoinciden('Bayern Munich', 'FC Bayern München'), 'Bayern Munich = FC Bayern München');
  check(nombresDeEquipoCoinciden('FC Copenhagen', 'FC København'), 'Copenhagen = København');
  check(nombresDeEquipoCoinciden('Slavia Prague', 'SK Slavia Praha'), 'Prague = Praha');
  check(nombresDeEquipoCoinciden('Marseille', 'Olympique de Marseille'), 'Marseille = Olympique de Marseille');
  check(!nombresDeEquipoCoinciden('AC Milan', 'Inter Milan'), 'AC Milan != Inter Milan');

  // Bayern/Barcelona (Champions) — nombre largo SIN shortName útil
  let r = await caso('uefa.champions', 'Bayern Munich', 'Barcelona', fd('CL', 'FC Bayern München', 'FCB', 'FC Barcelona', 'Barça', 1, 0));
  let j = r['bayern munich'];
  check(j && j.final1H === true && j.homeScore1H === 1 && j.awayScore1H === 0 && !j.motivoSinPrimeraMitad, 'Bayern-Barcelona cruza y trae el 1h (1-0)');

  // Cruce flexible: Lille (1 palabra) vs "Lille OSC" y Lens vs "Racing Club de Lens"
  r = await caso('fra.1', 'Lille', 'Lens', fd('FL1', 'Lille OSC', 'LOSC', 'Racing Club de Lens', 'RC Lens X', 2, 1));
  j = r['lille'];
  check(j && j.final1H === true && j.homeScore1H === 2, 'Lille-Lens cruza por el segundo intento flexible (un solo candidato)');

  // Con 2 candidatos igual de flexibles NO se adivina
  _resetCacheParaPruebas();
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('site.api.espn.com') && u.includes('/soccer/fra.1/')) return { ok: true, json: async () => espn('Lille', 'Lens') };
    if (u.includes('site.api.espn.com')) return { ok: true, json: async () => ({ events: [] }) };
    return { ok: true, json: async () => ({ matches: [
      fd('FL1', 'Lille OSC', 'X1', 'Racing Club de Lens', 'X2', 2, 1),
      fd('FL1', 'Lille Metropole OSC', 'X3', 'Lens Racing Club', 'X4', 0, 0) ] }) };
  };
  r = await obtenerResultadosSoccer('2026-10-11');
  check(r['lille'] && r['lille'].final1H !== true && r['lille'].motivoSinPrimeraMitad === 'sin-cruce', 'Con 2 candidatos posibles no se adivina (sigue sin-cruce)');

  console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron');
  process.exit(fallaron ? 1 : 0);
})();
