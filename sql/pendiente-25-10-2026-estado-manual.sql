-- =================================================================
-- ESTADO MANUAL DE UN TICKET (25-10-2026) — lo que se marca con ✏️ Editar en
-- Sábanas > Sábana del Día (GANADA/PERDIDA/...) se guarda acá además de en
-- tickets_historial, para que NO se pierda cuando se reprocesa la sábana de
-- esa fecha (ej. juegos de "1h" de días viejos que api-football.com ya no da
-- en el plan gratis y hay que resolver a mano). Se quita con "Automático".
-- =================================================================
create table if not exists tickets_estado_manual (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references grupos(id) on delete cascade,
  fecha          date not null,
  cliente_nombre text not null,
  ticket_label   text not null default '',
  estado         text not null,
  creado_en      timestamptz not null default now(),
  unique (grupo_id, fecha, cliente_nombre, ticket_label)
);
create index if not exists idx_estado_manual_grupo_fecha on tickets_estado_manual(grupo_id, fecha);
alter table tickets_estado_manual enable row level security;
