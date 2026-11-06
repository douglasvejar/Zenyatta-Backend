-- 06-11-2026: TIPO DE CLIENTE en Hipismo Oficinas — al crear un cliente se elige si es "tercio" (cliente normal) o "oficina" (la que lleva
-- % de devolución). Solo la oficina lleva las preguntas del % de devolución; el resto (pozo, pago diario, "le genera % a otro cliente")
-- aplica a los dos. Al crear la columna, los clientes que ya existen se clasifican UNA sola vez: con % de devolución = oficina, sin % = tercio.
-- Después se puede cambiar desde la lista de clientes. El servidor también lo aplica solo al arrancar. Es idempotente.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'jugadores' and column_name = 'tipo_cliente') then
    alter table jugadores add column tipo_cliente text not null default 'tercio' check (tipo_cliente in ('tercio','oficina'));
    update jugadores set tipo_cliente = 'oficina' where coalesce(comision_propia, 0) > 0;
  end if;
end $$;

-- 06-11-2026: POZO DEL CLIENTE en tres opciones al crearlo (Hipismo Oficinas): con pozo (avalado, puede jugar hasta lo que tenga), SIN pozo
-- (todavía no puede jugar: cualquier jugada que se le cargue avisa) o libre (sin límites, como siempre). "Sin pozo" = cliente libre con
-- jugadores.sin_pozo = true. Los clientes que ya existen quedan en false = libres sin límite. El servidor también lo aplica solo al arrancar.
-- Es idempotente.
alter table jugadores add column if not exists sin_pozo boolean not null default false;
