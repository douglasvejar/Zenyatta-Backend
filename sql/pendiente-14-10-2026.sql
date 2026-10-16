-- =================================================================
-- LUDOX / Zenyatta — SQL pendiente (14-10-2026)
-- Pegar COMPLETO en el SQL Editor de Supabase y ejecutar (Run).
-- (Mejor aún: pega el archivo sql/schema.sql entero — es seguro correrlo varias veces.)
-- Cubre: (1) Cruzar jugadas como preferencia del grupo (Ajustes > Preferencias).
--        (2) Chat de soporte por Telegram: un tema por grupo (grupos.telegram_soporte_tema_id).
-- Hasta que se corra, el interruptor funciona igual pero se recuerda solo en cada navegador.
-- =================================================================
alter table grupos add column if not exists hipismo_cruzar_automatico boolean not null default true;
-- Número del tema de Telegram (grupo de soporte con Temas) que le corresponde a cada grupo. Sin esto el bot igual
-- funciona, pero tras reiniciar el servidor crearía un tema nuevo por grupo.
alter table grupos add column if not exists telegram_soporte_tema_id bigint;

-- 15-10-2026: tema visual del panel de Hipismo (Ajustes > Preferencias)
alter table grupos add column if not exists hipismo_tema text;

-- 15-10-2026: HIPÓDROMOS PREDETERMINADOS. Todos los grupos arrancan con 3 hipódromos de Venezuela y 48 de USA ya cargados
-- (después cada grupo los renombra, borra o agrega más). La marca hipismo_hipodromos_iniciales hace que esto se haga UNA sola vez
-- por grupo: correr este SQL otra vez NO vuelve a crear los que un grupo borró a propósito. Si un grupo ya tenía uno con el mismo
-- nombre se respeta el suyo. Contenido generado por services/hipismoHipodromosDefecto.js (una prueba verifica que coincida).
alter table grupos add column if not exists hipismo_hipodromos_iniciales boolean not null default false;
do $$
begin
  insert into hipismo_hipodromos (grupo_id, nombre, pais)
  select g.id, h.nombre, h.pais
  from grupos g
  cross join (values
    ('La Rinconada', 'VE'),
    ('Valencia', 'VE'),
    ('Rancho Alegre', 'VE'),
    ('Aqueduct', 'US'),
    ('Belmont Park', 'US'),
    ('Charles Town', 'US'),
    ('Churchill Downs', 'US'),
    ('Colonial Downs', 'US'),
    ('Del Mar', 'US'),
    ('Delaware Park', 'US'),
    ('Delta Downs', 'US'),
    ('Ellis Park', 'US'),
    ('Emerald Downs', 'US'),
    ('Evangeline Downs', 'US'),
    ('Fair Grounds', 'US'),
    ('Finger Lakes', 'US'),
    ('Fonner Park', 'US'),
    ('Freehold Raceway', 'US'),
    ('Golden Gate Fields', 'US'),
    ('Gulfstream Park', 'US'),
    ('Hawthorne Race Course', 'US'),
    ('Hoosier Park', 'US'),
    ('Keeneland', 'US'),
    ('Kentucky Downs', 'US'),
    ('Laurel Park', 'US'),
    ('Lone Star Park', 'US'),
    ('Los Alamitos', 'US'),
    ('Louisiana Downs', 'US'),
    ('Mahoning Valley', 'US'),
    ('Meadowlands Racetrack', 'US'),
    ('Monmouth Park', 'US'),
    ('Mountaineer Casino Racetrack', 'US'),
    ('Northfield Park', 'US'),
    ('Oaklawn Park', 'US'),
    ('Parx Racing', 'US'),
    ('Penn National', 'US'),
    ('Pimlico Race Course', 'US'),
    ('Plainridge Park Casino', 'US'),
    ('Prairie Meadows', 'US'),
    ('Red Mile', 'US'),
    ('Remington Park', 'US'),
    ('Sam Houston Race Park', 'US'),
    ('Santa Anita Park', 'US'),
    ('Saratoga Race Course', 'US'),
    ('Saratoga Raceway', 'US'),
    ('Tampa Bay Downs', 'US'),
    ('Thistledown', 'US'),
    ('Turf Paradise', 'US'),
    ('Turfway Park', 'US'),
    ('Vernon Downs', 'US'),
    ('Yonkers Raceway', 'US')
  ) as h(nombre, pais)
  where not g.hipismo_hipodromos_iniciales
  on conflict do nothing;
  update grupos set hipismo_hipodromos_iniciales = true where not hipismo_hipodromos_iniciales;
end $$;
