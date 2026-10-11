-- =================================================================
-- LUDOX / Zenyatta — SQL pendiente (11-10-2026)
-- Pegar COMPLETO en el SQL Editor de Supabase y ejecutar (Run).
-- Es seguro correrlo varias veces: todo usa "if not exists".
-- Cubre: cierre automático al llegar SABANA FINAL (09-10) y los cambios de
-- Hipismo Oficinas (09-10 y 10-10). Las pantallas nuevas de Saldos
-- (Tablas y Marcas Premiadas / Adelantadas de Clientes) NO necesitan SQL.
-- =================================================================

alter table whatsapp_dia_estado add column if not exists cierre_final_enviado_en timestamptz;

alter table grupos add column if not exists modulo_hipismo_oficinas_habilitado boolean not null default false;

alter table hipismo_planos add column if not exists jugadas_oficina jsonb;

create table if not exists hipismo_oficinas_pendientes (
  id               uuid primary key default gen_random_uuid(),
  grupo_id         uuid not null references grupos(id) on delete cascade,
  hipodromo_id     uuid references hipismo_hipodromos(id) on delete set null,
  hipodromo_nombre text not null,
  carrera_numero   integer not null,
  fecha            date not null,
  ret              text,
  cruza_jugadas    boolean not null default false,
  jugadas          jsonb not null default '[]',
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  unique (grupo_id, hipodromo_nombre, carrera_numero, fecha)
);
create index if not exists idx_hipismo_oficinas_pendientes_grupo_fecha on hipismo_oficinas_pendientes(grupo_id, fecha);

alter table grupos add column if not exists oficinas_plano_resuelto boolean not null default false;
