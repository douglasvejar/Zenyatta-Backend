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

// =================================================================
// CHEQUEO DE CONEXIÓN AL ARRANCAR (03-10-2026) — a pedido del usuario,
// después de un caso real de migración de base (cambio de Supabase/
// DATABASE_URL hecho desde otra máquina) donde no había forma clara de
// confirmar, sin tocar código, si Railway realmente estaba conectando
// bien a la base nueva o seguía fallando. Antes esto era "silencioso":
// sin DATABASE_URL el proceso no arrancaba (ver arriba), pero CON una
// DATABASE_URL puesta — aunque esté mal, apunte a una base vieja, o la
// contraseña no sea la vigente — el servidor arrancaba igual, porque
// "pg" conecta recién en la primera consulta real. Este chequeo corre
// una sola vez, 2 segundos después de levantar el pool (para no competir
// con el resto del arranque), y deja bien claro en el log si la conexión
// funciona o no — y si no, el motivo real que devuelve Postgres.
// =================================================================
setTimeout(() => {
  pool.query('SELECT 1')
    .then(() => console.log('[db] Conexión a PostgreSQL OK.'))
    .catch((err) => console.error('[db] NO SE PUDO CONECTAR a PostgreSQL — revisar DATABASE_URL en Railway. Motivo real:', err.message));
}, 2000);

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
