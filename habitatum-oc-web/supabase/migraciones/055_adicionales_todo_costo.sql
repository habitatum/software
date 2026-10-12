-- 055 · Presupuesto TODO COSTO: crear, editar y eliminar ítems adicionales desde la app (solo admin)
-- Aplicada en dos partes: 055a (totales + guardar_item_adicional_tc) por Claude; eliminar_item_adicional_tc la ejecuta Andrés en el SQL Editor de Supabase (la herramienta bloquea sentencias DELETE).
-- Solo en capítulos ADICIONAL_COSTO y PAGO_DIRECTO_CLIENTE (sin utilidad: costo = venta).
-- Nunca toca los capítulos de CONTRATO ni recalcula el resto del presupuesto: solo el
-- capítulo afectado y los totales del presupuesto. No borra datos existentes.

create or replace function public._totales_capitulo_tc(p_capitulo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pres uuid;
begin
  update presupuesto_capitulos cap set valor_presupuestado =
    coalesce((select sum(valor_parcial) from presupuesto_items where capitulo_id = cap.id), 0)
  where cap.id = p_capitulo returning presupuesto_id into v_pres;
  update presupuestos set
    total_costos_directos = (select coalesce(sum(valor_presupuestado),0) from presupuesto_capitulos where presupuesto_id = v_pres),
    valor_total = (select coalesce(sum(valor_presupuestado),0) from presupuesto_capitulos where presupuesto_id = v_pres)
  where id = v_pres;
end $$;
revoke all on function public._totales_capitulo_tc(uuid) from public, anon, authenticated;

-- p_item null = crear; con id = editar. Valor: cantidad × unitario si ambos vienen; si no, p_valor_parcial.
create or replace function public.guardar_item_adicional_tc(
  p_item uuid, p_capitulo uuid, p_codigo text, p_descripcion text, p_unidad text,
  p_cantidad numeric, p_valor_unitario numeric, p_valor_parcial numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cap record; v_parcial numeric; v_id uuid; v_codigo text := nullif(trim(p_codigo), ''); v_orden int;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede crear o editar ítems adicionales.'; end if;
  select cap.id, cap.tipo_capitulo, cap.presupuesto_id, pr.modelo_contratacion into v_cap
  from presupuesto_capitulos cap join presupuestos p on p.id = cap.presupuesto_id join proyectos pr on pr.id = p.proyecto_id
  where cap.id = p_capitulo;
  if v_cap.id is null then raise exception 'El capítulo no existe.'; end if;
  if v_cap.modelo_contratacion <> 'TODO_COSTO' then raise exception 'Esta opción es solo para obras todo costo.'; end if;
  if v_cap.tipo_capitulo not in ('ADICIONAL_COSTO', 'PAGO_DIRECTO_CLIENTE') then
    raise exception 'Solo se pueden agregar ítems en los capítulos de adicionales (sin utilidad), no en los del contrato.';
  end if;
  if v_codigo is null then raise exception 'Escribe el código del ítem.'; end if;
  if coalesce(trim(p_descripcion), '') = '' then raise exception 'Escribe la descripción del ítem.'; end if;
  if exists (select 1 from presupuesto_items i join presupuesto_capitulos c on c.id = i.capitulo_id
             where c.presupuesto_id = v_cap.presupuesto_id and trim(i.codigo) = v_codigo and i.id is distinct from p_item) then
    raise exception 'El código % ya existe en este presupuesto.', v_codigo;
  end if;
  v_parcial := case when p_cantidad is not null and p_valor_unitario is not null then round(p_cantidad * p_valor_unitario, 0)
                    else round(coalesce(p_valor_parcial, 0), 0) end;
  if v_parcial < 0 then raise exception 'El valor no puede ser negativo.'; end if;

  if p_item is null then
    select coalesce(max(orden), -1) + 1 into v_orden from presupuesto_items where capitulo_id = p_capitulo;
    insert into presupuesto_items (capitulo_id, codigo, descripcion, unidad, cantidad, valor_unitario, valor_parcial, orden)
    values (p_capitulo, v_codigo, trim(p_descripcion), nullif(trim(p_unidad), ''), p_cantidad, p_valor_unitario, v_parcial, v_orden)
    returning id into v_id;
  else
    if not exists (select 1 from presupuesto_items where id = p_item and capitulo_id = p_capitulo) then
      raise exception 'El ítem no pertenece a ese capítulo.';
    end if;
    update presupuesto_items set codigo = v_codigo, descripcion = trim(p_descripcion), unidad = nullif(trim(p_unidad), ''),
      cantidad = p_cantidad, valor_unitario = p_valor_unitario, valor_parcial = v_parcial
    where id = p_item;
    v_id := p_item;
  end if;
  -- Sin utilidad: costo = venta.
  insert into presupuesto_items_costo (presupuesto_item_id, valor_unitario_costo, valor_parcial_costo)
  values (v_id, p_valor_unitario, v_parcial)
  on conflict (presupuesto_item_id) do update set valor_unitario_costo = excluded.valor_unitario_costo,
                                                  valor_parcial_costo = excluded.valor_parcial_costo;
  perform public._totales_capitulo_tc(p_capitulo);
  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_codigo, 'valor', v_parcial);
end $$;
revoke all on function public.guardar_item_adicional_tc(uuid, uuid, text, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.guardar_item_adicional_tc(uuid, uuid, text, text, text, numeric, numeric, numeric) to authenticated;

-- Eliminar: solo si nada lo usa (OC, histórico, caja menor, contratos, cortes, control presupuestal).
create or replace function public.eliminar_item_adicional_tc(p_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cap record;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede eliminar ítems adicionales.'; end if;
  select cap.id, cap.tipo_capitulo, pr.modelo_contratacion, i.codigo into v_cap
  from presupuesto_items i join presupuesto_capitulos cap on cap.id = i.capitulo_id
  join presupuestos p on p.id = cap.presupuesto_id join proyectos pr on pr.id = p.proyecto_id where i.id = p_item;
  if v_cap.id is null then raise exception 'El ítem no existe.'; end if;
  if v_cap.modelo_contratacion <> 'TODO_COSTO' or v_cap.tipo_capitulo not in ('ADICIONAL_COSTO', 'PAGO_DIRECTO_CLIENTE') then
    raise exception 'Solo se pueden eliminar ítems de los capítulos de adicionales de obras todo costo.';
  end if;
  if exists (select 1 from items_oc_presupuesto where presupuesto_item_id = p_item)
     or exists (select 1 from items_oc where presupuesto_item_id = p_item)
     or exists (select 1 from ejecutado_historico where presupuesto_item_id = p_item)
     or exists (select 1 from caja_menor_gastos where presupuesto_item_id = p_item)
     or exists (select 1 from contrato_items where presupuesto_item_id = p_item)
     or exists (select 1 from corte_items where presupuesto_item_id = p_item)
     or exists (select 1 from presupuesto_corte_items where presupuesto_item_id = p_item)
     or exists (select 1 from presupuesto_corte_ocs where presupuesto_item_id = p_item)
     or exists (select 1 from presupuesto_cantidades_en_curso where presupuesto_item_id = p_item) then
    raise exception 'El ítem % tiene órdenes, contratos o cortes asociados; no se puede eliminar.', v_cap.codigo;
  end if;
  delete from presupuesto_items_costo where presupuesto_item_id = p_item;
  delete from presupuesto_items where id = p_item;
  perform public._totales_capitulo_tc(v_cap.id);
  return jsonb_build_object('ok', true, 'codigo', v_cap.codigo);
end $$;
revoke all on function public.eliminar_item_adicional_tc(uuid) from public, anon;
grant execute on function public.eliminar_item_adicional_tc(uuid) to authenticated;
