-- 05-11-2026: HIPISMO OFICINAS — mejoras. Lo único que toca la base: un tipo de alerta nuevo para el Historial de Cambios
-- (PENDIENTE_ELIMINADO = alguien eliminó una carrera que estaba pendiente de llegada). Marcar "pago diario" a un cliente usa la
-- columna jugadores.pago_diario que ya existe. El servidor también lo aplica solo al arrancar. Es idempotente.
alter table hipismo_alertas drop constraint if exists hipismo_alertas_tipo_check;
alter table hipismo_alertas add constraint hipismo_alertas_tipo_check
  check (tipo in ('PLANO_EDITADO','PLANO_ELIMINADO','ADELANTADA_EDITADA','ADELANTADA_ELIMINADA','JORNADA_ELIMINADA','WINNER_EDITADO','WINNER_ELIMINADO','PIZARRA_EDITADA','PIZARRA_ELIMINADA','TERCIOS_ADELANTADA_EDITADA','TERCIOS_ADELANTADA_ELIMINADA','REMATE_MANUAL_ELIMINADO','APUESTA_SOBRE_POZO','CUADRE_DESCUADRADO','POZO_BAJO','PENDIENTE_ELIMINADO')) not valid;
