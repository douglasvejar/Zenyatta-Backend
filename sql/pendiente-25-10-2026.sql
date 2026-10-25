-- 25-10-2026: clientes PAGO DIARIO (marca por cliente). Es idempotente.
alter table jugadores add column if not exists pago_diario boolean not null default false;

-- 25-10-2026: SOCIOS DE HIPISMO y "Avalado por" (a pedido del usuario: "en comisiones una pestaña llamada comisiones por avales y
-- socios... cuando creas un cliente colocas avalado por (una lista con los socios del grupo; esos socios se crean en Ajustes > Socios
-- y la distribución debe dar exactamente 100%)... y en esa ventana te coloca ordenado cuánto produjo cada cliente en comisión (ya
-- devolviendo los %) por a quién pertenece, y debe dar exacto a la comisión de Balance General y Cierre Final. Un grupo que no cree
-- socios calcula como siempre"). DISTINTO de la tabla "socios" de Deportes (Saldos de Socios y sus Avalados): esa no se toca.
--   hipismo_socios: los socios del grupo con su % de distribución (el grupo los guarda juntos y deben sumar 100; lo valida el servidor).
--   jugadores.hipismo_socio_id: el socio por el que está avalado un cliente (a lo sumo uno; sin socio = vacío).
create table if not exists hipismo_socios (
  id          uuid primary key default gen_random_uuid(),
  grupo_id    uuid not null references grupos(id) on delete cascade,
  nombre      text not null,
  porcentaje  numeric not null default 0,
  creado_en   timestamptz not null default now(),
  unique (grupo_id, nombre)
);
create index if not exists idx_hipismo_socios_grupo on hipismo_socios(grupo_id);
alter table hipismo_socios enable row level security;
alter table jugadores add column if not exists hipismo_socio_id uuid references hipismo_socios(id) on delete set null;
create index if not exists idx_jugadores_hipismo_socio on jugadores(hipismo_socio_id);
