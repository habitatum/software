-- Migración: permiso delegado de Bitácora de Obra.
-- El Admin siempre puede editar textos, eliminar fotos y exportar. Además,
-- puede marcar a otros usuarios (ej. un residente de obra) con
-- puede_gestionar_bitacora = true para que también puedan hacerlo, sin
-- necesidad de subirlos a rol 'admin'.

alter table usuarios add column if not exists puede_gestionar_bitacora boolean not null default false;

-- Función auxiliar (mismo patrón que rol_actual()): true si el usuario
-- autenticado es admin O tiene el permiso delegado de bitácora.
create or replace function puede_gestionar_bitacora_actual() returns boolean as $$
  select coalesce(rol = 'admin' or puede_gestionar_bitacora, false)
  from usuarios where id = auth.uid();
$$ language sql stable security definer;

-- Editar (título/detalle de una foto) y eliminar fotos: admin o autorizado.
drop policy if exists "actualizar_bitacora_fotos_autorizados" on bitacora_fotos;
create policy "actualizar_bitacora_fotos_autorizados" on bitacora_fotos for update
  using (puede_gestionar_bitacora_actual()) with check (puede_gestionar_bitacora_actual());

drop policy if exists "eliminar_bitacora_fotos_autorizados" on bitacora_fotos;
create policy "eliminar_bitacora_fotos_autorizados" on bitacora_fotos for delete
  using (puede_gestionar_bitacora_actual());

-- Editar el resumen narrativo del día: admin o autorizado.
drop policy if exists "actualizar_bitacora_dias_autorizados" on bitacora_dias;
create policy "actualizar_bitacora_dias_autorizados" on bitacora_dias for update
  using (puede_gestionar_bitacora_actual()) with check (puede_gestionar_bitacora_actual());

-- Borrar el archivo de Storage al eliminar una foto: admin o autorizado.
drop policy if exists "eliminar_bitacora_fotos_storage" on storage.objects;
create policy "eliminar_bitacora_fotos_storage" on storage.objects for delete
  using (bucket_id = 'bitacora-fotos' and puede_gestionar_bitacora_actual());
