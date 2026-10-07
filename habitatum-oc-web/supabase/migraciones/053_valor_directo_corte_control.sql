-- 053 · Valor pagado directo por el cliente (sin OC) en los cortes de cobro — aplicada el 06/10/2026, registro Supabase: valor_directo_corte_control
-- Para costos que el cliente paga directo y no tienen OC (ej. 27.01 Residente de obra). Se suma al valor del ítem en el corte;
-- valor_directo guarda esa parte aparte de lo que viene de las OC. No afecta el corte en curso (que compara solo líneas de OC).

alter table public.presupuesto_corte_items add column if not exists valor_directo numeric check (valor_directo is null or valor_directo >= 0);
alter table public.presupuesto_cantidades_en_curso alter column cantidad drop not null;
alter table public.presupuesto_cantidades_en_curso add column if not exists valor_directo numeric check (valor_directo is null or valor_directo >= 0);

-- Blindaje: además de las cantidades (052), permite registrar el valor directo en un corte cerrado (solo desde guardar_valor_directo).
create or replace function public.trg_corte_inmutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('habitatum.cerrando_corte', true), '') = 'si' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'presupuesto_corte_items' and coalesce(current_setting('habitatum.cantidades_corte', true), '') = 'si' then
    if tg_op = 'UPDATE' and new.id = old.id and new.corte_id = old.corte_id and new.presupuesto_item_id = old.presupuesto_item_id
       and new.cantidad_ejecutada is not distinct from old.cantidad_ejecutada
       and new.valor_ejecutado is not distinct from old.valor_ejecutado
       and new.valor_directo is not distinct from old.valor_directo then
      return new;
    end if;
    if tg_op = 'INSERT' and coalesce(new.valor_ejecutado, 0) = 0 and coalesce(new.cantidad_ejecutada, 0) = 0 and new.valor_directo is null then
      return new;
    end if;
  end if;
  if tg_table_name = 'presupuesto_corte_items' and coalesce(current_setting('habitatum.valor_directo', true), '') = 'si' then
    -- Solo cambia valor_directo y, en la misma medida, valor_ejecutado.
    if tg_op = 'UPDATE' and new.id = old.id and new.corte_id = old.corte_id and new.presupuesto_item_id = old.presupuesto_item_id
       and new.cantidad_ejecutada is not distinct from old.cantidad_ejecutada
       and new.cantidad_medida is not distinct from old.cantidad_medida
       and round(coalesce(new.valor_ejecutado, 0) - coalesce(new.valor_directo, 0), 2) = round(coalesce(old.valor_ejecutado, 0) - coalesce(old.valor_directo, 0), 2) then
      return new;
    end if;
    if tg_op = 'INSERT' and coalesce(new.cantidad_ejecutada, 0) = 0 and coalesce(new.valor_ejecutado, 0) = coalesce(new.valor_directo, 0) then
      return new;
    end if;
  end if;
  raise exception 'CORTE_CERRADO: los cortes de control presupuestal cerrados no se modifican ni se borran; las correcciones entran como ajuste en el corte en curso.';
end $$;
revoke all on function public.trg_corte_inmutable() from public, anon, authenticated;

-- 052 ajustada: en el corte en curso, borrar la cantidad no borra el valor directo del mismo ítem.
create or replace function public.guardar_cantidad_medida(p_presupuesto uuid, p_item uuid, p_cantidad numeric, p_corte uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fila uuid; v_numero integer;
begin
  if not exists (select 1 from public.presupuesto_items pi join public.presupuesto_capitulos pc on pc.id = pi.capitulo_id
                 where pi.id = p_item and pc.presupuesto_id = p_presupuesto) then
    raise exception 'El ítem no pertenece a este presupuesto.';
  end if;
  if p_cantidad is not null and p_cantidad < 0 then raise exception 'La cantidad no puede ser negativa.'; end if;
  if p_corte is null then
    if public.rol_actual() not in ('admin', 'operativo') then raise exception 'Sin permiso para registrar cantidades.'; end if;
    insert into public.presupuesto_cantidades_en_curso (presupuesto_id, presupuesto_item_id, cantidad, actualizado_por, actualizado_en)
    values (p_presupuesto, p_item, p_cantidad, auth.uid(), now())
    on conflict (presupuesto_id, presupuesto_item_id) do update
      set cantidad = excluded.cantidad, actualizado_por = excluded.actualizado_por, actualizado_en = now();
    delete from public.presupuesto_cantidades_en_curso
     where presupuesto_id = p_presupuesto and presupuesto_item_id = p_item and cantidad is null and valor_directo is null;
    return jsonb_build_object('corte', null, 'cantidad', p_cantidad);
  end if;
  if not public.es_admin() then raise exception 'Solo un administrador puede ajustar las cantidades de un corte cerrado.'; end if;
  select numero into v_numero from public.presupuesto_cortes where id = p_corte and presupuesto_id = p_presupuesto;
  if v_numero is null then raise exception 'El corte no pertenece a este presupuesto.'; end if;
  perform set_config('habitatum.cantidades_corte', 'si', true);
  update public.presupuesto_corte_items
     set cantidad_medida = p_cantidad, cantidad_medida_por = auth.uid(), cantidad_medida_en = now()
   where corte_id = p_corte and presupuesto_item_id = p_item
  returning id into v_fila;
  if v_fila is null and p_cantidad is not null then
    insert into public.presupuesto_corte_items (corte_id, presupuesto_item_id, cantidad_ejecutada, valor_ejecutado, cantidad_medida, cantidad_medida_por, cantidad_medida_en)
    values (p_corte, p_item, 0, 0, p_cantidad, auth.uid(), now());
  end if;
  perform set_config('habitatum.cantidades_corte', '', true);
  return jsonb_build_object('corte', v_numero, 'cantidad', p_cantidad);
end $$;
revoke all on function public.guardar_cantidad_medida(uuid, uuid, numeric, uuid) from public, anon;
grant execute on function public.guardar_cantidad_medida(uuid, uuid, numeric, uuid) to authenticated, service_role;

-- Valor pagado directo por el cliente (sin OC): corte en curso (p_corte null) o corte cerrado. Solo admin.
create or replace function public.guardar_valor_directo(p_presupuesto uuid, p_item uuid, p_valor numeric, p_corte uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_numero integer; v_fila record;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede registrar valores pagados directo por el cliente.'; end if;
  if not exists (select 1 from public.presupuesto_items pi join public.presupuesto_capitulos pc on pc.id = pi.capitulo_id
                 where pi.id = p_item and pc.presupuesto_id = p_presupuesto) then
    raise exception 'El ítem no pertenece a este presupuesto.';
  end if;
  if p_valor is not null and p_valor < 0 then raise exception 'El valor no puede ser negativo.'; end if;
  if p_valor = 0 then p_valor := null; end if;
  if p_corte is null then
    insert into public.presupuesto_cantidades_en_curso (presupuesto_id, presupuesto_item_id, cantidad, valor_directo, actualizado_por, actualizado_en)
    values (p_presupuesto, p_item, null, p_valor, auth.uid(), now())
    on conflict (presupuesto_id, presupuesto_item_id) do update
      set valor_directo = excluded.valor_directo, actualizado_por = excluded.actualizado_por, actualizado_en = now();
    delete from public.presupuesto_cantidades_en_curso
     where presupuesto_id = p_presupuesto and presupuesto_item_id = p_item and cantidad is null and valor_directo is null;
    return jsonb_build_object('corte', null, 'valor_directo', p_valor);
  end if;
  select numero into v_numero from public.presupuesto_cortes where id = p_corte and presupuesto_id = p_presupuesto;
  if v_numero is null then raise exception 'El corte no pertenece a este presupuesto.'; end if;
  perform set_config('habitatum.valor_directo', 'si', true);
  select * into v_fila from public.presupuesto_corte_items where corte_id = p_corte and presupuesto_item_id = p_item;
  if v_fila.id is not null then
    update public.presupuesto_corte_items
       set valor_ejecutado = coalesce(valor_ejecutado, 0) - coalesce(valor_directo, 0) + coalesce(p_valor, 0),
           valor_directo = p_valor
     where id = v_fila.id;
  elsif p_valor is not null then
    insert into public.presupuesto_corte_items (corte_id, presupuesto_item_id, cantidad_ejecutada, valor_ejecutado, valor_directo)
    values (p_corte, p_item, 0, p_valor, p_valor);
  end if;
  perform set_config('habitatum.valor_directo', '', true);
  return jsonb_build_object('corte', v_numero, 'valor_directo', p_valor);
end $$;
revoke all on function public.guardar_valor_directo(uuid, uuid, numeric, uuid) from public, anon;
grant execute on function public.guardar_valor_directo(uuid, uuid, numeric, uuid) to authenticated, service_role;

-- Al cerrar el corte: además de las cantidades (052), congela el valor directo y lo suma al ítem.
do $m$ declare d text;
  viejo text := '  update public.presupuesto_corte_items ci set cantidad_medida = q.cantidad, cantidad_medida_por = q.actualizado_por, cantidad_medida_en = q.actualizado_en
  from public.presupuesto_cantidades_en_curso q
  where q.presupuesto_id = p_presupuesto and ci.corte_id = v_corte and ci.presupuesto_item_id = q.presupuesto_item_id;
  insert into public.presupuesto_corte_items (corte_id, presupuesto_item_id, cantidad_ejecutada, valor_ejecutado, cantidad_medida, cantidad_medida_por, cantidad_medida_en)
  select v_corte, q.presupuesto_item_id, 0, 0, q.cantidad, q.actualizado_por, q.actualizado_en';
  nuevo text := '  update public.presupuesto_corte_items ci set cantidad_medida = q.cantidad, cantidad_medida_por = q.actualizado_por, cantidad_medida_en = q.actualizado_en,
         valor_directo = q.valor_directo, valor_ejecutado = coalesce(ci.valor_ejecutado, 0) + coalesce(q.valor_directo, 0)
  from public.presupuesto_cantidades_en_curso q
  where q.presupuesto_id = p_presupuesto and ci.corte_id = v_corte and ci.presupuesto_item_id = q.presupuesto_item_id;
  insert into public.presupuesto_corte_items (corte_id, presupuesto_item_id, cantidad_ejecutada, valor_ejecutado, valor_directo, cantidad_medida, cantidad_medida_por, cantidad_medida_en)
  select v_corte, q.presupuesto_item_id, 0, coalesce(q.valor_directo, 0), q.valor_directo, q.cantidad, q.actualizado_por, q.actualizado_en';
begin
  d := pg_get_functiondef('public.cerrar_corte_control(uuid,date)'::regprocedure);
  if position('valor_directo' in d) > 0 then return; end if;
  if position(viejo in d) = 0 then raise exception 'cerrar_corte_control: bloque de la 052 no encontrado'; end if;
  d := replace(d, viejo, nuevo);
  execute d;
end $m$;
revoke all on function public.cerrar_corte_control(uuid, date) from public, anon;
grant execute on function public.cerrar_corte_control(uuid, date) to authenticated, service_role;
