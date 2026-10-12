-- =================================================================
-- LUDOX / Zenyatta — SQL pendiente (12-10-2026)
-- Pegar COMPLETO en el SQL Editor de Supabase y ejecutar (Run).
-- Es seguro correrlo varias veces: todo usa "if not exists".
-- Cubre: Pozos > "quién sale en el plano" (los desmarcados quedan fijos para siempre, en cualquier dispositivo).
-- Hasta que se corra, la pantalla sigue funcionando con la selección guardada en el navegador.
-- =================================================================

create table if not exists hipismo_pozos_excluidos (
  grupo_id uuid not null references grupos(id) on delete cascade,
  nombre   text not null,
  creado_en timestamptz not null default now(),
  primary key (grupo_id, nombre)
);
