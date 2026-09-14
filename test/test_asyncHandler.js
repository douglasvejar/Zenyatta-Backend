// Prueba de regresión del error real que tumbó el servidor del usuario:
// un "ECONNRESET" de Postgres durante el login (POST /api/auth/login)
// tumbaba TODO el proceso porque la ruta era una función async sin
// try/catch — la promesa rechazada quedaba "sin atrapar" y Node mataba el
// servidor entero, dejando a TODOS los grupos sin servicio.
//
// Esta prueba no necesita ninguna base de datos real: solo confirma que
// asyncHandler(fn) NUNCA deja escapar una promesa rechazada sin atrapar —
// la entrega siempre a next(err), como espera Express, en vez de tirarla
// al aire.
const assert = require('assert');
const asyncHandler = require('../src/middleware/asyncHandler');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

(async function testAsyncHandlerAtrapaElRechazo() {
  const errorSimulado = new Error('ECONNRESET simulado (igual al que tumbó el servidor real)');
  errorSimulado.code = 'ECONNRESET';

  const handler = asyncHandler(async (req, res) => {
    // Simula exactamente lo que pasaba en routes/auth.js: un
    // "await db.query(...)" que rechaza en medio de la ruta.
    throw errorSimulado;
  });

  let erroresNoAtrapados = 0;
  const verNoAtrapado = () => { erroresNoAtrapados++; };
  process.on('unhandledRejection', verNoAtrapado);

  let errorRecibidoPorNext = null;
  await new Promise((resolve) => {
    handler({}, {}, (err) => { errorRecibidoPorNext = err; resolve(); });
  });

  // Le da una vuelta al event loop para que, SI algo se escapó como
  // rechazo sin atrapar, el listener de arriba ya lo haya visto.
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', verNoAtrapado);

  check(errorRecibidoPorNext === errorSimulado, 'asyncHandler entrega el error a next(err) en vez de tirarlo al aire');
  check(erroresNoAtrapados === 0, 'ningún "unhandledRejection" se dispara — el proceso NO se hubiera caído con esto');
})().then(() => {
  console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
  if (fallaron > 0) process.exit(1);
});
