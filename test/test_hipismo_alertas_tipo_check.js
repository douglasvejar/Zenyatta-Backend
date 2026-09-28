// =================================================================
// PRUEBA: hipismo_alertas.tipo — que TODOS los "tipo" que usa el código
// (routes/hipismo.js, llamadas a registrarAlerta) estén admitidos por el
// último "check" de sql/schema.sql (28-09-2026).
//
// Motivo: al construir "Eliminar Winners" se agregaron 2 tipos nuevos
// (WINNER_EDITADO/WINNER_ELIMINADO) al código, pero por error NO se
// actualizó el check de sql/schema.sql. Como las pruebas normales usan
// una base de datos FALSA que no valida checks, todo pasaba en verde acá
// mismo mientras que contra el Postgres real de Supabase el INSERT en
// hipismo_alertas fallaba (violación del check) DESPUÉS de que la acción
// principal (por ejemplo, el DELETE de un Winner) ya se hubiera ejecutado
// y confirmado — el usuario veía "error interno del servidor" pero al
// refrescar la página el cambio ya estaba hecho.
//
// Esta prueba lee ambos archivos como texto plano y compara los 2
// conjuntos de "tipo", para que la próxima vez que se agregue un tipo
// nuevo en el código sin tocar el check de sql/schema.sql, la suite de
// pruebas se caiga en vez de descubrirlo en producción.
const fs = require('fs');
const path = require('path');

const RUTA_HIPISMO_JS = path.join(__dirname, '..', 'src', 'routes', 'hipismo.js');
const RUTA_SCHEMA_SQL = path.join(__dirname, '..', 'sql', 'schema.sql');

let pasaron = 0, fallaron = 0;
function check(cond, msg) {
  if (cond) { pasaron++; console.log('OK:', msg); }
  else { fallaron++; console.error('FALLÓ:', msg); }
}

const contenidoJs = fs.readFileSync(RUTA_HIPISMO_JS, 'utf8');
const contenidoSql = fs.readFileSync(RUTA_SCHEMA_SQL, 'utf8');

// 1) Todos los "tipo: 'ALGO'" usados en llamadas a registrarAlerta.
const tiposEnCodigo = new Set();
const regexTipoCodigo = /registrarAlerta\(req,\s*\{[^}]*?tipo:\s*'([A-Z_]+)'/gs;
let m;
while ((m = regexTipoCodigo.exec(contenidoJs)) !== null) {
  tiposEnCodigo.add(m[1]);
}
check(tiposEnCodigo.size >= 7, `1) Se detectaron ${tiposEnCodigo.size} tipos usados en registrarAlerta() (esperaba al menos 7)`);

// 2) El ÚLTIMO check de la constraint "hipismo_alertas_tipo_check" en
// sql/schema.sql -- el que de verdad queda vigente en la base de datos
// real, ya que cada bloque nuevo hace "drop constraint if exists" +
// "add constraint" con la lista completa (NO cualquier "tipo in (...)"
// del archivo -- hay otras tablas con su propia columna "tipo").
const regexCheckSql = /add constraint hipismo_alertas_tipo_check\s*\n\s*check \(tipo in \(([^)]+)\)\)/g;
let ultimoMatch = null;
let matchCheck;
while ((matchCheck = regexCheckSql.exec(contenidoSql)) !== null) {
  ultimoMatch = matchCheck;
}
check(!!ultimoMatch, '2) Se encontró al menos un "add constraint hipismo_alertas_tipo_check" en sql/schema.sql');

const tiposEnSchema = new Set(
  (ultimoMatch ? ultimoMatch[1] : '')
    .split(',')
    .map(s => s.trim().replace(/^'/, '').replace(/'$/, ''))
    .filter(Boolean)
);

// 3) Cada tipo que usa el código YA está admitido por el check vigente.
tiposEnCodigo.forEach(tipo => {
  check(tiposEnSchema.has(tipo), `3) El tipo '${tipo}' (usado en routes/hipismo.js) está en el check vigente de sql/schema.sql`);
});

console.log('\n' + pasaron + ' pruebas OK, ' + fallaron + ' fallaron.');
process.exit(fallaron > 0 ? 1 : 0);
