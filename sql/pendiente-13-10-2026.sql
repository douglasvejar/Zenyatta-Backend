-- =================================================================
-- LUDOX / Zenyatta — SQL pendiente (13-10-2026)
-- Pegar COMPLETO en el SQL Editor de Supabase y ejecutar (Run).
-- (Mejor aún: pega el archivo sql/schema.sql entero — es seguro correrlo varias veces.)
-- Cubre: panel de funciones por sección del Súper-admin.
-- =================================================================
alter table grupos add column if not exists funciones_habilitadas jsonb;
