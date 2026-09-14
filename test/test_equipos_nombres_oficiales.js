// Prueba de "nombres oficiales por deporte" (GET /api/equipos/nombres-oficiales/:deporte)
// — endpoint nuevo del 28-08-2026, agregado para arreglar un bug real
// reportado por el usuario: el datalist de "Registrar Equipo Nuevo" solo
// mostraba nombres cuando el deporte elegido era MLB, y para NFL (y para
// cualquier otro deporte que se conecte a futuro) mostraba el mensaje de
// "todavía no tiene su API conectada" aunque NFL SÍ estaba conectada.
//
// Causa raíz: `cargarNombresOficialesNFL()` (public/app.js) le pegaba
// DIRECTO desde el navegador a la API "oculta" de ESPN — y esa API no deja
// que un navegador le pegue directo (CORS), a diferencia de
// statsapi.mlb.com (la de MLB), que sí lo permite. El fetch fallaba en
// silencio (quedaba atrapado en el try/catch, solo se veía en la consola
// del navegador) y la lista de NFL se quedaba vacía para siempre.
//
// Arreglo: ahora el navegador le pide la lista al PROPIO BACKEND
// (`GET /api/equipos/nombres-oficiales/:deporte`), que sí puede pegarle
// directo a la API externa sin ninguna restricción de CORS — mismo patrón
// que ya usa la Pizarra en Vivo para el marcador de NFL.
//
// Esta prueba no necesita ninguna base de datos ni acceso de red real:
// simula `global.fetch` con el esquema real de cada API (MLB/ESPN) para
// confirmar que la ruta arma bien la lista de nombres en cada caso —
// incluidos NHL y fútbol, agregados el 28-08-2026 (fútbol pide sus 10
// ligas en paralelo y combina/deduplica el resultado) — que un deporte
// todavía sin API conectada (ej. basket) devuelve una lista vacía sin
// romper, y que un error de red no tumba la ruta (responde lista vacía en
// vez de un 500).
const path = require('path');
const Module = require('module');
const originalLoad = Module._load;

function fakeExpressRouter() {
  const handlers = [];
  const router = function () {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach(m => {
    router[m] = (...args) => { handlers.push([m, args]); return router; };
  });
  router.__handlers = handlers;
  return router;
}
const fakeExpress = () => fakeExpressRouter();
fakeExpress.Router = fakeExpressRouter;

const fakePool = function () {
  this.query = async () => ({ rows: [] });
  this.on = () => {};
};

const fakes = {
  express: fakeExpress,
  pg: { Pool: fakePool },
  jsonwebtoken: { sign: () => 'fake.jwt.token', verify: () => ({ grupoId: 'x' }) }
};

Module._load = function (request, parent, isMain) {
  if (fakes[request]) return fakes[request];
  return originalLoad.apply(this, arguments);
};

process.env.DATABASE_URL = 'postgresql://fake/fake';
process.env.JWT_SECRET = 'fake-secret';

const router = require(path.join(__dirname, '..', 'src/routes/equipos.js'));
Module._load = originalLoad;

function encontrarHandler(metodo, rutaBuscada) {
  const entrada = router.__handlers.find(([m, args]) => m === metodo && args[0] === rutaBuscada);
  if (!entrada) return null;
  return entrada[1][entrada[1].length - 1]; // último argumento = asyncHandler(fn)
}

// OJO: asyncHandler(fn) NO devuelve la promesa de fn() a quien la llama
// (dispara Promise.resolve(fn(...)).catch(next) "al aire", a propósito,
// para no bloquear a Express) — así que `await handler(req, res, next)` NO
// alcanza a esperar el trabajo async de adentro. Por eso res.json() acá
// resuelve una promesa propia (`res.__listo`) que la prueba SÍ espera.
function fakeRes() {
  const res = {};
  let marcarListo;
  res.__listo = new Promise((resolve) => { marcarListo = resolve; });
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (data) => { res.body = data; marcarListo(); return res; };
  return res;
}

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const handler = encontrarHandler('get', '/nombres-oficiales/:deporte');

(async function main() {
  check(!!handler, 'la ruta GET /nombres-oficiales/:deporte existe en src/routes/equipos.js');
  if (!handler) return;

  // Invoca la ruta con un deporte dado y espera a que de verdad termine
  // (ver el comentario de fakeRes() sobre por qué no alcanza con
  // "await handler(...)" solo) — devuelve { res, erroresAtrapados }.
  async function invocar(deporte) {
    const req = { params: { deporte } };
    const res = fakeRes();
    let erroresAtrapados = 0;
    handler(req, res, () => { erroresAtrapados++; }); // next(err) real, si se llamara
    await res.__listo;
    return { res, erroresAtrapados };
  }

  // --- MLB: sigue funcionando (ya funcionaba antes de este cambio) ---
  global.fetch = async (url) => {
    if (String(url).includes('statsapi.mlb.com')) {
      return { json: async () => ({ teams: [{ name: 'Boston Red Sox' }, { name: 'New York Yankees' }] }) };
    }
    throw new Error('URL inesperada en la prueba de MLB: ' + url);
  };
  {
    const { res } = await invocar('mlb');
    check(Array.isArray(res.body.nombres), 'MLB: la respuesta trae un array de nombres');
    check(res.body.nombres.includes('Boston Red Sox') && res.body.nombres.includes('New York Yankees'), 'MLB: incluye los nombres reales devueltos por la API');
  }

  // --- NFL: el caso que estaba roto (bloqueado por CORS en el navegador) ---
  global.fetch = async (url) => {
    if (String(url).includes('site.api.espn.com')) {
      return {
        json: async () => ({
          sports: [{ leagues: [{ teams: [
            { team: { displayName: 'Houston Texans' } },
            { team: { displayName: 'Dallas Cowboys' } }
          ] }] }]
        })
      };
    }
    throw new Error('URL inesperada en la prueba de NFL: ' + url);
  };
  {
    const { res } = await invocar('nfl');
    check(
      res.body.nombres.includes('Houston Texans') && res.body.nombres.includes('Dallas Cowboys'),
      'NFL: incluye los nombres reales devueltos por ESPN — pedidos desde el BACKEND, no desde el navegador (evita el CORS que causaba el bug)'
    );
  }

  // --- NHL (28-08-2026): ya conectada, mismo patrón que NFL ---
  global.fetch = async (url) => {
    if (String(url).includes('site.api.espn.com') && String(url).includes('/hockey/nhl/')) {
      return {
        json: async () => ({
          sports: [{ leagues: [{ teams: [
            { team: { displayName: 'Edmonton Oilers' } },
            { team: { displayName: 'Boston Bruins' } }
          ] }] }]
        })
      };
    }
    throw new Error('URL inesperada en la prueba de NHL: ' + url);
  };
  {
    const { res } = await invocar('nhl');
    check(
      res.body.nombres.includes('Edmonton Oilers') && res.body.nombres.includes('Boston Bruins'),
      'NHL (28-08-2026): incluye los nombres reales devueltos por ESPN, mismo patrón que NFL'
    );
  }

  // --- Fútbol (28-08-2026): pide las 10 ligas configuradas EN PARALELO y
  // combina/deduplica los nombres en una sola lista ordenada ---
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/soccer/eng.1/')) {
      return { json: async () => ({ sports: [{ leagues: [{ teams: [{ team: { displayName: 'Arsenal' } }, { team: { displayName: 'Liverpool' } }] }] }] }) };
    }
    if (u.includes('/soccer/esp.1/')) {
      return { json: async () => ({ sports: [{ leagues: [{ teams: [{ team: { displayName: 'Real Madrid' } }, { team: { displayName: 'Barcelona' } }] }] }] }) };
    }
    if (u.includes('/soccer/')) {
      // Las demás 8 ligas configuradas: se responde vacío, para confirmar
      // que la ruta no se cae si una liga no trae equipos en ese momento.
      return { json: async () => ({ sports: [{ leagues: [{ teams: [] }] }] }) };
    }
    throw new Error('URL inesperada en la prueba de fútbol: ' + url);
  };
  {
    const { res } = await invocar('soccer');
    check(
      res.body.nombres.includes('Arsenal') && res.body.nombres.includes('Real Madrid') && res.body.nombres.includes('Barcelona'),
      'Fútbol (28-08-2026): combina los nombres de VARIAS ligas (Premier League + La Liga) pedidas en paralelo en una sola lista'
    );
    check(res.body.nombres.length === new Set(res.body.nombres).size, 'Fútbol: la lista combinada no trae nombres repetidos');
  }

  // --- NBA/Basket (31-08-2026): ya conectada, mismo patrón que NFL/NHL ---
  global.fetch = async (url) => {
    if (String(url).includes('site.api.espn.com') && String(url).includes('/basketball/nba/')) {
      return {
        json: async () => ({
          sports: [{ leagues: [{ teams: [
            { team: { displayName: 'Sacramento Kings' } },
            { team: { displayName: 'Milwaukee Bucks' } }
          ] }] }]
        })
      };
    }
    throw new Error('URL inesperada en la prueba de NBA: ' + url);
  };
  {
    const { res } = await invocar('basket');
    check(
      res.body.nombres.includes('Sacramento Kings') && res.body.nombres.includes('Milwaukee Bucks'),
      'NBA (31-08-2026): incluye los nombres reales devueltos por ESPN, mismo patrón que NFL/NHL'
    );
  }

  // --- Rugby (ficticio): deporte todavía sin API conectada, no debe romper
  // ni llamar a fetch — reemplaza a "basket" como ejemplo desde que NBA se
  // conectó de verdad (31-08-2026). ---
  global.fetch = async (url) => { throw new Error('no debería llamar a fetch para un deporte sin API conectada: ' + url); };
  {
    const { res } = await invocar('rugby');
    check(Array.isArray(res.body.nombres) && res.body.nombres.length === 0, 'Rugby (sin API conectada todavía): devuelve una lista vacía en vez de romper o inventar nombres');
  }

  // --- Error de red hacia la API externa: no debe tumbar la ruta ---
  global.fetch = async () => { throw new Error('red caída simulada (ej. sin internet en ese momento)'); };
  {
    const { res, erroresAtrapados } = await invocar('nfl');
    check(erroresAtrapados === 0, 'si la API externa falla, la ruta NO le pasa el error a next() (no tumba nada)');
    check(Array.isArray(res.body.nombres) && res.body.nombres.length === 0, 'si la API externa falla, la ruta responde una lista vacía en vez de un 500 — el usuario puede seguir escribiendo el nombre a mano');
  }
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
});
