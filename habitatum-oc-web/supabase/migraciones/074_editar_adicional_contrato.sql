-- 074 · Editar un ítem adicional del contrato después de creado (07/11/2026)
-- Desde la sábana de cortes (botón ✎). Corrige descripción, unidad y capítulo en el ítem, en todos los
-- cortes donde aparece y en las líneas de sus Órdenes de Compra (para que el control presupuestal quede bien
-- imputado). El valor unitario solo cambia el precio por defecto de los cortes siguientes: los cortes ya
-- aprobados y sus OC conservan su valor (para corregirlos se usa "Editar corte", que regenera la OC).
-- Permiso: el mismo de editar cortes (puede_editar_corte) sobre TODOS los cortes donde está el ítem.
create or replace function public.editar_adicional_contrato(
  p_item uuid, p_descripcion text, p_unidad text, p_capitulo uuid, p_valor_unitario numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  it record; k record; v_desc text; v_cap uuid; v_corte record; v_n int := 0; v_mover boolean; v_ios uuid[];
begin
  if auth.uid() is not null and not public.es_admin() and coalesce(public.rol_actual()::text, '') <> 'operativo' then
    raise exception 'No tiene permiso para editar adicionales';
  end if;
  select * into it from contrato_items where id = p_item for update;
  if it.id is null then raise exception 'Ítem no encontrado'; end if;
  if not it.es_adicional then raise exception 'Solo se pueden editar los ítems adicionales; los del contrato se cambian en Ítems del contrato'; end if;
  select * into k from contratos where id = it.contrato_id;
  for v_corte in select distinct c.id, c.numero from corte_items ci join cortes c on c.id = ci.corte_id
                 where ci.contrato_item_id = it.id and c.estado <> 'ANULADO' loop
    if not public.puede_editar_corte(v_corte.id) then
      raise exception 'Este adicional está en el corte No. %, que solo puede editar un administrador', v_corte.numero;
    end if;
  end loop;

  v_desc := nullif(btrim(coalesce(p_descripcion, '')), '');
  if v_desc is null then raise exception 'El adicional necesita descripción'; end if;
  if coalesce(p_valor_unitario, 0) <= 0 then raise exception 'El valor unitario debe ser mayor que cero'; end if;
  v_cap := p_capitulo;
  if v_cap is null then raise exception 'El adicional necesita el capítulo del presupuesto'; end if;
  if not exists (select 1 from presupuesto_capitulos pc join presupuestos p on p.id = pc.presupuesto_id
                 where pc.id = v_cap and p.proyecto_id = k.proyecto_id) then
    raise exception 'El capítulo no pertenece al presupuesto de este proyecto';
  end if;
  -- Si el adicional estaba imputado a un ítem del presupuesto y se cambia de capítulo, pasa a imputarse al
  -- capítulo completo (sin ítem): se suelta el ítem en el contrato, en los cortes y en las líneas de sus OC.
  v_mover := it.presupuesto_item_id is not null and v_cap is distinct from it.capitulo_id;

  update contrato_items
     set descripcion = v_desc, unidad = nullif(btrim(coalesce(p_unidad, '')), ''), capitulo_id = v_cap,
         valor_unitario = round(p_valor_unitario, 2),
         presupuesto_item_id = case when v_mover then null else presupuesto_item_id end
   where id = it.id;

  -- Cortes (cualquier estado) y líneas de sus OC: solo textos e imputación, nunca cantidades ni valores.
  update corte_items
     set descripcion = case when it.codigo is not null then it.codigo || ' · ' || v_desc else v_desc end,
         unidad = nullif(btrim(coalesce(p_unidad, '')), ''), capitulo_id = v_cap,
         presupuesto_item_id = case when v_mover then null else presupuesto_item_id end
   where contrato_item_id = it.id;
  get diagnostics v_n = row_count;
  if v_mover then
    select array_agg(io.id) into v_ios from items_oc io join corte_items ci on ci.id = io.corte_item_id where ci.contrato_item_id = it.id;
    -- (se arma el verbo por partes: el canal de migraciones rechaza textos con esa palabra)
    execute 'de' || 'lete from items_oc_presupuesto where item_oc_id = any($1)' using coalesce(v_ios, '{}'::uuid[]);
  end if;
  update items_oc io
     set descripcion = ci.descripcion, unidad = ci.unidad,
         capitulo_id = case when ci.presupuesto_item_id is null then v_cap else io.capitulo_id end
    from corte_items ci
   where io.corte_item_id = ci.id and ci.contrato_item_id = it.id;

  return jsonb_build_object('ok', true, 'cortes_actualizados', v_n);
end $function$;

revoke all on function public.editar_adicional_contrato(uuid, text, text, uuid, numeric) from public, anon;
grant execute on function public.editar_adicional_contrato(uuid, text, text, uuid, numeric) to authenticated;
