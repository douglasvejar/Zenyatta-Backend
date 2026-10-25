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

// AUTO-ARREGLO DE ESQUEMA AL ARRANCAR (13-10-2026): la columna grupos.funciones_habilitadas (funciones por sección, ver
// services/funcionesGrupo.js y sql/schema.sql) se crea sola, sin depender de que alguien se acuerde de correr el SQL
// antes del despliegue. Es idempotente ("if not exists") y, si la base no deja alterar la tabla, solo avisa en el log
// (el SQL de sql/schema.sql sigue siendo la vía oficial y requiereGrupo() tiene un respaldo sin esa columna).
pool.query('ALTER TABLE grupos ADD COLUMN IF NOT EXISTS funciones_habilitadas jsonb')
  .catch((err) => console.warn('[db] No se pudo asegurar la columna grupos.funciones_habilitadas (corre sql/schema.sql en Supabase):', err.message));

// 25-10-2026: marca "pago diario" de los clientes (ver sql/schema.sql); se crea sola igual que la de arriba.
pool.query('ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS pago_diario boolean NOT NULL DEFAULT false')
  .catch((err) => console.warn('[db] No se pudo asegurar la columna jugadores.pago_diario (corre sql/schema.sql en Supabase):', err.message));

// 25-10-2026: socios de Hipismo y "Avalado por" del cliente (ver sql/schema.sql). Se crean solos, en orden (la columna del cliente
// apunta a la tabla), y si la base no deja alterar solo avisan en el log.
pool.query(`create table if not exists hipismo_socios (
    id uuid primary key default gen_random_uuid(),
    grupo_id uuid not null references grupos(id) on delete cascade,
    nombre text not null,
    porcentaje numeric not null default 0,
    creado_en timestamptz not null default now(),
    unique (grupo_id, nombre))`)
  .then(() => pool.query('ALTER TABLE jugadores ADD COLUMN IF NOT EXISTS hipismo_socio_id uuid REFERENCES hipismo_socios(id) ON DELETE SET NULL'))
  .catch((err) => console.warn('[db] No se pudo asegurar hipismo_socios / jugadores.hipismo_socio_id (corre sql/schema.sql en Supabase):', err.message));

// 25-10-2026: estado puesto a mano en un ticket de Deportes (✏️ Editar) que NO se pierde al reprocesar la sábana (ver sql/schema.sql
// y services/historial.js). Se crea sola; si la base no deja, solo avisa en el log y todo sigue como antes.
pool.query(`create table if not exists tickets_estado_manual (
    id uuid primary key default gen_random_uuid(),
    grupo_id uuid not null references grupos(id) on delete cascade,
    fecha date not null,
    cliente_nombre text not null,
    ticket_label text not null default '',
    estado text not null,
    creado_en timestamptz not null default now(),
    unique (grupo_id, fecha, cliente_nombre, ticket_label))`)
  .then(() => pool.query('create index if not exists idx_estado_manual_grupo_fecha on tickets_estado_manual(grupo_id, fecha)'))
  .then(() => pool.query('alter table tickets_estado_manual enable row level security'))
  .catch((err) => console.warn('[db] No se pudo asegurar tickets_estado_manual (corre sql/schema.sql en Supabase):', err.message));

// HIPÓDROMOS PREDETERMINADOS (15-10-2026): los grupos que todavía no recibieron la lista (3 de Venezuela + 48 de USA) la reciben
// una sola vez al arrancar (marca grupos.hipismo_hipodromos_iniciales), sin depender de correr el SQL. Ver
// services/hipismoHipodromosDefecto.js. Nunca tumba el arranque: si algo falla, solo avisa en el log.
require('./services/hipismoHipodromosDefecto').sembrarGruposExistentes({ query: (t, p) => pool.query(t, p) });

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
