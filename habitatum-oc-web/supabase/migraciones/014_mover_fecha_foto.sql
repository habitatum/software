-- Migración: permite mover una foto de la Bitácora a otro día.
-- Si el día destino todavía no existe en bitacora_dias (nunca ha recibido
-- fotos), moverla requiere poder CREARLO desde el cliente (insert), no solo
-- actualizarlo. Antes solo existía política de update/delete para
-- puede_gestionar_bitacora_actual(); esta migración agrega el insert.

drop policy if exists "insertar_bitacora_dias_autorizados" on bitacora_dias;
create policy "insertar_bitacora_dias_autorizados" on bitacora_dias for insert
  with check (puede_gestionar_bitacora_actual());
