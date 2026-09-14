// =================================================================
// asyncHandler — evita que un error de red hacia la base de datos tumbe
// TODO el servidor.
// =================================================================
// Express no atrapa solo los errores de una función async: si un
// "await db.query(...)" dentro de una ruta rechaza (ej. la conexión a
// Supabase se cae un instante — ECONNRESET, timeout, etc.) y esa ruta no
// tiene su propio try/catch, la promesa queda "rechazada sin atrapar" y
// Node mata el proceso completo. Eso es justo lo que le pasó al usuario:
// un hipo de red al hacer login tumbó el servidor entero y dejó a TODOS
// los grupos sin servicio hasta reiniciar "npm start" a mano.
//
// Esta envoltura convierte cualquier rechazo en una llamada a next(err),
// que cae en el middleware de errores de server.js (responde 500 al que
// hizo esa única petición) en vez de matar el proceso para todo el mundo.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
