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
