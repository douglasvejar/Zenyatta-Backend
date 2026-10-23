-- 23-10-2026: orden de la lista de Pozos por grupo (Ajustes > Preferencias). Pegar y ejecutar en el SQL Editor de Supabase.
alter table grupos add column if not exists hipismo_pozos_orden text;
