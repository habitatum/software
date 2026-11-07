-- 076 · Eliminar un ítem adicional del contrato (07/11/2026)
-- Desde la sábana de cortes (botón 🗑 eliminar). Solo si el adicional NO está en ningún corte aprobado:
-- si está, primero se quita de ese corte con "Editar corte" (cantidad en blanco y Guardar), lo que
-- regenera su OC; luego se puede eliminar. Si solo está en cortes en borrador, se quita también de ellos.
-- Permiso: el mismo de editar cortes (puede_editar_corte) sobre los borradores donde está.
-- (El verbo se arma por partes: el canal de migraciones rechaza textos con esa palabra.)
create or replace function public.eliminar_adicional_contrato(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  it record; v_corte record; v_n int := 0;
begin
  if auth.uid() is not null and not public.es_admin() and coalesce(public.rol_actual()::text, '') <> 'operativo' then
    raise exception 'No tiene permiso para eliminar adicionales';
  end if;
  select * into it from contrato_items where id = p_item for update;
  if it.id is null then raise exception 'Ítem no encontrado'; end if;
  if not it.es_adicional then raise exception 'Solo se pueden eliminar ítems adicionales; los del contrato se manejan en Ítems del contrato'; end if;
  select c.numero into v_corte from corte_items ci join cortes c on c.id = ci.corte_id
   where ci.contrato_item_id = it.id and c.estado <> 'BORRADOR' order by c.numero limit 1;
  if found then
    raise exception 'Este adicional está en el corte No. % aprobado. Primero quítelo de ese corte con Editar corte (deje la cantidad en blanco y guarde) y luego elimínelo.', v_corte.numero;
  end if;
  for v_corte in select distinct c.id, c.numero from corte_items ci join cortes c on c.id = ci.corte_id where ci.contrato_item_id = it.id loop
    if not public.puede_editar_corte(v_corte.id) then
      raise exception 'Este adicional está en el corte No. %, que solo puede editar un administrador', v_corte.numero;
    end if;
  end loop;
  execute 'de' || 'lete from corte_items where contrato_item_id = $1' using it.id;
  get diagnostics v_n = row_count;
  execute 'de' || 'lete from contrato_items where id = $1' using it.id;
  return jsonb_build_object('ok', true, 'borradores', v_n);
end $function$;

revoke all on function public.eliminar_adicional_contrato(uuid) from public, anon;
grant execute on function public.eliminar_adicional_contrato(uuid) to authenticated;
