-- =================================================================
-- LUDOX / Zenyatta — SQL pendiente (14-10-2026)
-- Pegar COMPLETO en el SQL Editor de Supabase y ejecutar (Run).
-- (Mejor aún: pega el archivo sql/schema.sql entero — es seguro correrlo varias veces.)
-- Cubre: Cruzar jugadas como preferencia del grupo (Ajustes > Preferencias).
-- Hasta que se corra, el interruptor funciona igual pero se recuerda solo en cada navegador.
-- =================================================================
alter table grupos add column if not exists hipismo_cruzar_automatico boolean not null default true;
