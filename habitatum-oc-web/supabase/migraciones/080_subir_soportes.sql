-- 080 · Subir / Reemplazar soporte (07/11 → 13/11/2026)
-- El administrador carga el soporte (PDF, JPG o PNG) de cualquier Orden de Compra, gasto de caja menor o
-- movimiento de caja. Reemplazar no borra el archivo anterior (queda en el almacén para auditoría).
--  · OC y gastos de caja menor → almacén soportes-oc (el mismo de los comprobantes del bot).
--  · Movimientos de caja (ingresos del cliente, retiros, ajustes) → almacén nuevo soportes-caja, SOLO admin
--    (son finanzas del proyecto; soportes-oc lo puede leer cualquier usuario con sesión).

alter table public.movimientos_caja add column if not exists soporte_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('soportes-caja', 'soportes-caja', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy soportes_caja_admin_lectura on storage.objects for select
  using (bucket_id = 'soportes-caja' and public.es_admin());
create policy soportes_caja_admin_subir on storage.objects for insert
  with check (bucket_id = 'soportes-caja' and public.es_admin());
create policy soportes_oc_admin_subir on storage.objects for insert
  with check (bucket_id = 'soportes-oc' and public.es_admin());

create or replace function public.asignar_soporte(p_tipo text, p_id uuid, p_path text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int := 0; v_bucket text;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo un administrador puede subir o reemplazar soportes';
  end if;
  if coalesce(btrim(p_path), '') = '' then raise exception 'Falta el archivo del soporte'; end if;
  if lower(p_path) !~ '\.(pdf|jpe?g|png)$' then raise exception 'El soporte debe ser PDF, JPG o PNG'; end if;
  v_bucket := case when p_tipo = 'MOVIMIENTO' then 'soportes-caja' else 'soportes-oc' end;
  if not exists (select 1 from storage.objects where bucket_id = v_bucket and name = p_path) then
    raise exception 'El archivo no está en el almacén de soportes';
  end if;
  if p_tipo = 'OC' then
    update ordenes_compra set soporte_path = p_path where id = p_id;
  elsif p_tipo = 'GASTO' then
    update caja_menor_gastos set soporte_path = p_path where id = p_id;
  elsif p_tipo = 'MOVIMIENTO' then
    update movimientos_caja set soporte_path = p_path where id = p_id;
  else
    raise exception 'Tipo de soporte no válido: %', p_tipo;
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'No se encontró el registro'; end if;
  return jsonb_build_object('ok', true, 'soporte_path', p_path);
end $function$;

revoke all on function public.asignar_soporte(text, uuid, text) from public, anon;
grant execute on function public.asignar_soporte(text, uuid, text) to authenticated;
