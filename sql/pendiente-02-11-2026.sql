
-- 02-11-2026: DETALLE DEL PAGO de una recarga de pago diario o de un retiro (a pedido del usuario: método de pago, referencia y foto del
-- comprobante, opcionales, "para mayor control"). Los métodos predeterminados (Zelle, Pago móvil, Dólares efectivo, Bolívares efectivo,
-- Banesco Panamá, Cash App) viven en el código; cada grupo agrega los suyos al elegir "Otro" y quedan en hipismo_metodos_pago.
-- hipismo_pagos_detalle cuelga de la fila de ORIGEN del par de hipismo_comisiones_ajustes (al borrar el par se borra el detalle).
-- La imagen se guarda en base64 dentro de la base (no en el disco). El servidor también lo crea solo al arrancar. Es idempotente.
create table if not exists hipismo_metodos_pago (
  id          uuid primary key default gen_random_uuid(),
  grupo_id    uuid not null references grupos(id) on delete cascade,
  nombre      text not null,
  creado_en   timestamptz not null default now(),
  unique (grupo_id, nombre)
);
create index if not exists idx_hipismo_metodos_pago_grupo on hipismo_metodos_pago(grupo_id);
alter table hipismo_metodos_pago enable row level security;
create table if not exists hipismo_pagos_detalle (
  ajuste_id      uuid primary key references hipismo_comisiones_ajustes(id) on delete cascade,
  grupo_id       uuid not null references grupos(id) on delete cascade,
  metodo         text,
  referencia     text,
  imagen_base64  text,
  imagen_mime    text,
  creado_en      timestamptz not null default now()
);
create index if not exists idx_hipismo_pagos_detalle_grupo on hipismo_pagos_detalle(grupo_id);
alter table hipismo_pagos_detalle enable row level security;
