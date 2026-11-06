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
