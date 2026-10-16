// =================================================================
// HIPÓDROMOS PREDETERMINADOS (15-10-2026, a pedido del usuario: "todos los grupos deben tener esta lista de hipódromos ya
// cargados predeterminados para que comiencen a trabajar de una vez y no pierdan tanto tiempo creándolos").
// Cada grupo (los que ya existen y los nuevos) arranca con estos 3 de Venezuela y estos 48 de USA. Después cada grupo puede
// renombrarlos, borrarlos o agregar más en Administración > Hipódromos.
//
// Cómo se reparte, para que NUNCA vuelvan a aparecer solos los que un grupo borró a propósito:
//  - grupos.hipismo_hipodromos_iniciales (boolean) marca si el grupo ya recibió la lista. Se pone en true al sembrar.
//  - Grupo nuevo: superadmin.js llama sembrarHipodromosDefecto() al crearlo.
//  - Grupos que ya existen: una sola vez, con el SQL (sql/schema.sql, mismo contenido) o, si no se corrió, solo al arrancar el
//    servidor (db.js -> sembrarGruposExistentes). Con la marca en true, volver a correr cualquiera de los dos no hace nada.
//  - Si un grupo ya tenía uno con el mismo nombre (sin importar mayúsculas), se respeta el suyo (índice único por grupo+nombre).
// =================================================================
const VENEZUELA = ['La Rinconada', 'Valencia', 'Rancho Alegre'];
const USA = [
  'Aqueduct', 'Belmont Park', 'Charles Town', 'Churchill Downs', 'Colonial Downs', 'Del Mar', 'Delaware Park', 'Delta Downs',
  'Ellis Park', 'Emerald Downs', 'Evangeline Downs', 'Fair Grounds', 'Finger Lakes', 'Fonner Park', 'Freehold Raceway',
  'Golden Gate Fields', 'Gulfstream Park', 'Hawthorne Race Course', 'Hoosier Park', 'Keeneland', 'Kentucky Downs', 'Laurel Park',
  'Lone Star Park', 'Los Alamitos', 'Louisiana Downs', 'Mahoning Valley', 'Meadowlands Racetrack', 'Monmouth Park',
  'Mountaineer Casino Racetrack', 'Northfield Park', 'Oaklawn Park', 'Parx Racing', 'Penn National', 'Pimlico Race Course',
  'Plainridge Park Casino', 'Prairie Meadows', 'Red Mile', 'Remington Park', 'Sam Houston Race Park', 'Santa Anita Park',
  'Saratoga Race Course', 'Saratoga Raceway', 'Tampa Bay Downs', 'Thistledown', 'Turf Paradise', 'Turfway Park', 'Vernon Downs',
  'Yonkers Raceway'
];
const HIPODROMOS_DEFECTO = [
  ...VENEZUELA.map(nombre => ({ nombre, pais: 'VE' })),
  ...USA.map(nombre => ({ nombre, pais: 'US' }))
];

const NOMBRES = HIPODROMOS_DEFECTO.map(h => h.nombre);
const PAISES = HIPODROMOS_DEFECTO.map(h => h.pais);

// Agrega la lista a UN grupo (sin tocar lo que ya tenga) y lo marca como "ya recibió la lista". `db` es cualquier objeto con query().
async function sembrarHipodromosDefecto(db, grupoId) {
  await db.query(
    `INSERT INTO hipismo_hipodromos (grupo_id, nombre, pais)
     SELECT $1::uuid, h.nombre, h.pais FROM unnest($2::text[], $3::text[]) AS h(nombre, pais)
     ON CONFLICT DO NOTHING`,
    [grupoId, NOMBRES, PAISES]
  );
  try {
    await db.query('UPDATE grupos SET hipismo_hipodromos_iniciales = true WHERE id = $1', [grupoId]);
  } catch (e) {
    if (!(e && e.code === '42703')) throw e; // sin la columna (falta el SQL): igual quedaron cargados; solo no queda la marca
  }
}

// Al arrancar el servidor: les da la lista, UNA sola vez, a los grupos que todavía no la recibieron. Nunca lanza error.
async function sembrarGruposExistentes(db) {
  try {
    await db.query('ALTER TABLE grupos ADD COLUMN IF NOT EXISTS hipismo_hipodromos_iniciales boolean NOT NULL DEFAULT false');
    await db.query(
      `INSERT INTO hipismo_hipodromos (grupo_id, nombre, pais)
       SELECT g.id, h.nombre, h.pais FROM grupos g CROSS JOIN unnest($1::text[], $2::text[]) AS h(nombre, pais)
       WHERE NOT g.hipismo_hipodromos_iniciales
       ON CONFLICT DO NOTHING`,
      [NOMBRES, PAISES]
    );
    await db.query('UPDATE grupos SET hipismo_hipodromos_iniciales = true WHERE NOT hipismo_hipodromos_iniciales');
  } catch (e) {
    console.warn('[db] No se pudieron cargar los hipódromos predeterminados (corre sql/schema.sql en Supabase):', e.message);
  }
}

// Mismo contenido para sql/schema.sql (así el SQL y el código nunca difieren).
function sqlHipodromosDefecto() {
  const valores = HIPODROMOS_DEFECTO.map(h => `    ('${h.nombre.replace(/'/g, "''")}', '${h.pais}')`).join(',\n');
  return `alter table grupos add column if not exists hipismo_hipodromos_iniciales boolean not null default false;
do $$
begin
  insert into hipismo_hipodromos (grupo_id, nombre, pais)
  select g.id, h.nombre, h.pais
  from grupos g
  cross join (values
${valores}
  ) as h(nombre, pais)
  where not g.hipismo_hipodromos_iniciales
  on conflict do nothing;
  update grupos set hipismo_hipodromos_iniciales = true where not hipismo_hipodromos_iniciales;
end $$;`;
}

module.exports = { HIPODROMOS_DEFECTO, VENEZUELA, USA, sembrarHipodromosDefecto, sembrarGruposExistentes, sqlHipodromosDefecto };
