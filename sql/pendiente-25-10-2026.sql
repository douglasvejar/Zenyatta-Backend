-- 25-10-2026: clientes PAGO DIARIO (marca por cliente). Es idempotente.
alter table jugadores add column if not exists pago_diario boolean not null default false;
