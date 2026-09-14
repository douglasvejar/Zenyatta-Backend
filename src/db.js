// Conexión a Postgres (Supabase u otro). Un solo Pool compartido por toda
// la app — pg maneja las conexiones concurrentes por debajo.
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Falta DATABASE_URL en el archivo .env — copia .env.example a .env y completa tu conexión de Supabase.');
  process.exit(1);
}

// Supabase requiere SSL. rejectUnauthorized:false porque el certificado de
// Supabase no siempre valida limpio contra el set de CAs por defecto de
// Node — es la misma configuración que recomienda la documentación de
// Supabase para conexiones directas con "pg".
const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Sin este listener, un error en un cliente que está IDLE dentro del pool
// (ej. Supabase cierra una conexión que llevaba un rato sin usarse, algo
// normal y esperable) no tiene a dónde ir — "pg" lo emite como evento
// 'error' del Pool, y un EventEmitter sin listener para 'error' hace que
// Node lo trate como una excepción no atrapada y MATE TODO EL PROCESO.
// Esto es aparte del asyncHandler de las rutas (ver
// src/middleware/asyncHandler.js), que cubre los errores que pasan
// DURANTE una consulta — este cubre los que pasan mientras la conexión
// está descansando en el pool, sin ninguna consulta corriendo en ese momento.
pool.on('error', (err) => {
  console.error('Aviso: una conexión inactiva del pool de PostgreSQL falló (normal de vez en cuando, "pg" abre otra sola):', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

// Corre varias queries dentro de UNA transacción (todo o nada) — se usa
// para "reemplazar" el historial de una fecha completa (borrar + insertar)
// sin dejar un estado a medias si algo falla en el medio.
async function transaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaccion };
