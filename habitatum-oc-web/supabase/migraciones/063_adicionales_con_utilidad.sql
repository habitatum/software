-- 063 · Adicionales CON utilidad (tipo de capítulo ADICIONAL): se valoran igual que el contrato inicial.
-- Se escribe el costo (antes de AIU); la venta = costo × factor del proyecto (AIU o % de utilidad); llevan la
-- misma utilidad real incluida (costo de ejecución = costo ÷ (1 + %)) y el mismo IVA (AIU: sobre la U).
-- ADICIONAL_COSTO (sin utilidad) se conserva para lo existente (Apto 423). PAGO_DIRECTO_CLIENTE sigue igual.
-- Las funciones existentes se ajustan con parches de texto verificados (fallan si el texto esperado no está).
-- No cambia datos existentes.

alter table public.presupuesto_capitulos
  drop constraint if exists presupuesto_capitulos_tipo_capitulo_check,
  add constraint presupuesto_capitulos_tipo_capitulo_check
  check (tipo_capitulo in ('CONTRATO', 'ADICIONAL', 'ADICIONAL_COSTO', 'PAGO_DIRECTO_CLIENTE'));

create or replace function public._resumen_fin_tc(p_proyecto uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f record; v_pct numeric; v_pres uuid; v_res jsonb;
  c_costo numeric; c_venta numeric; a_venta numeric; ad_costo numeric; ad_venta numeric; v_ur_c numeric; v_iva_c numeric; v_iva_a numeric; v_ur numeric;
begin
  select * into f from proyectos_finanzas where proyecto_id = p_proyecto;
  select id into v_pres from presupuestos where proyecto_id = p_proyecto;
  v_pct := coalesce(f.porcentaje_utilidad_real, 0);   -- 061: margen incluido en el presupuesto antes de AIU
  with caps as (
    select cap.id, cap.tipo_capitulo,
           coalesce(sum(pi.valor_parcial), 0) venta, coalesce(sum(pc.valor_parcial_costo), 0) costo
    from presupuesto_capitulos cap
    left join presupuesto_items pi on pi.capitulo_id = cap.id
    left join presupuesto_items_costo pc on pc.presupuesto_item_id = pi.id
    where cap.presupuesto_id = v_pres group by cap.id, cap.tipo_capitulo
  )
  select coalesce(sum(costo) filter (where tipo_capitulo = 'CONTRATO'), 0),
         coalesce(sum(venta) filter (where tipo_capitulo = 'CONTRATO'), 0),
         coalesce(sum(venta) filter (where tipo_capitulo in ('ADICIONAL', 'ADICIONAL_COSTO')), 0),
         coalesce(sum(costo) filter (where tipo_capitulo = 'ADICIONAL'), 0),
         coalesce(sum(venta) filter (where tipo_capitulo = 'ADICIONAL'), 0),
         coalesce(sum(costo - round(costo / (1 + v_pct / 100))) filter (where tipo_capitulo in ('CONTRATO', 'ADICIONAL')), 0),
         coalesce(sum(costo - round(costo / (1 + v_pct / 100))) filter (where tipo_capitulo = 'CONTRATO'), 0)
    into c_costo, c_venta, a_venta, ad_costo, ad_venta, v_ur, v_ur_c from caps;
  v_iva_c := case f.modalidad_facturacion
               when 'AIU' then round(c_costo * coalesce(f.porcentaje_u, 0) / 100 * coalesce(f.porcentaje_iva, 0) / 100)
               when 'IVA' then round(c_venta * coalesce(f.porcentaje_iva, 0) / 100)
               else 0 end;
  -- 063: los adicionales con utilidad (ADICIONAL) llevan el mismo AIU y el mismo IVA que el contrato.
  v_iva_a := case f.modalidad_facturacion
               when 'AIU' then round(ad_costo * coalesce(f.porcentaje_u, 0) / 100 * coalesce(f.porcentaje_iva, 0) / 100)
               when 'IVA' then round(a_venta * coalesce(f.porcentaje_iva, 0) / 100)
               else 0 end;
  select jsonb_build_object(
    'modalidad', f.modalidad_facturacion, 'porcentaje_iva', coalesce(f.porcentaje_iva, 0),
    'porcentaje_utilidad_real', v_pct, 'utilidad_real_definida', f.porcentaje_utilidad_real is not null,
    'costo_contrato', c_costo, 'venta_contrato', c_venta, 'venta_adicionales', a_venta,
    'utilidad_real', v_ur, 'utilidad_real_contrato', v_ur_c, 'costo_ejecucion', c_costo - v_ur_c, 'margen_aiu', c_venta - c_costo,
    'costo_adicionales_utilidad', ad_costo, 'venta_adicionales_utilidad', ad_venta,
    'iva_contrato', v_iva_c, 'iva_adicionales', v_iva_a,
    'contrato_con_iva', c_venta + v_iva_c,
    'total_con_iva', c_venta + v_iva_c + a_venta + v_iva_a,
    'valor_contrato_cliente', f.valor_contrato_cliente,
    'diferencia_valor_cliente', case when f.valor_contrato_cliente is null then null else f.valor_contrato_cliente - (c_venta + v_iva_c) end,
    'tasa_iva_en_cobros', case when (c_venta + v_iva_c + a_venta + v_iva_a) > 0
                               then (v_iva_c + v_iva_a) / (c_venta + v_iva_c + a_venta + v_iva_a) else 0 end,
    'capitulos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', cp.id,
        'costo_ejecucion', case when cp.tipo_capitulo in ('CONTRATO', 'ADICIONAL') then round(cp.costo / (1 + v_pct / 100)) else cp.costo end,
        'utilidad_real', case when cp.tipo_capitulo in ('CONTRATO', 'ADICIONAL') then cp.costo - round(cp.costo / (1 + v_pct / 100)) else 0 end))
      from (select cap.id, cap.tipo_capitulo, coalesce(sum(pi.valor_parcial), 0) venta, coalesce(sum(pc.valor_parcial_costo), 0) costo
            from presupuesto_capitulos cap
            left join presupuesto_items pi on pi.capitulo_id = cap.id
            left join presupuesto_items_costo pc on pc.presupuesto_item_id = pi.id
            where cap.presupuesto_id = v_pres group by cap.id, cap.tipo_capitulo) cp), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public._resumen_fin_tc(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guardar_item_adicional_tc(p_item uuid, p_capitulo uuid, p_codigo text, p_descripcion text, p_unidad text, p_cantidad numeric, p_valor_unitario numeric, p_valor_parcial numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_cap record; v_parcial numeric; v_id uuid; v_codigo text := nullif(trim(p_codigo), ''); v_orden int;
  v_f numeric := 1; v_vu_venta numeric; v_parcial_venta numeric;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede crear o editar ítems adicionales.'; end if;
  select cap.id, cap.tipo_capitulo, cap.presupuesto_id, pr.modelo_contratacion, pr.id proyecto_id into v_cap
  from presupuesto_capitulos cap join presupuestos p on p.id = cap.presupuesto_id join proyectos pr on pr.id = p.proyecto_id
  where cap.id = p_capitulo;
  if v_cap.id is null then raise exception 'El capítulo no existe.'; end if;
  if v_cap.modelo_contratacion <> 'TODO_COSTO' then raise exception 'Esta opción es solo para obras todo costo.'; end if;
  if v_cap.tipo_capitulo not in ('ADICIONAL', 'ADICIONAL_COSTO', 'PAGO_DIRECTO_CLIENTE') then
    raise exception 'Solo se pueden agregar ítems en los capítulos de adicionales, no en los del contrato inicial.';
  end if;
  if v_codigo is null then raise exception 'Escribe el código del ítem.'; end if;
  if coalesce(trim(p_descripcion), '') = '' then raise exception 'Escribe la descripción del ítem.'; end if;
  if exists (select 1 from presupuesto_items i join presupuesto_capitulos c on c.id = i.capitulo_id
             where c.presupuesto_id = v_cap.presupuesto_id and trim(i.codigo) = v_codigo and i.id is distinct from p_item) then
    raise exception 'El código % ya existe en este presupuesto.', v_codigo;
  end if;
  -- Lo que se escribe es el COSTO (presupuestado antes de AIU). En ADICIONAL la venta = costo × factor del
  -- proyecto (igual que el contrato); en los demás tipos la venta = costo (sin utilidad).
  v_parcial := case when p_cantidad is not null and p_valor_unitario is not null then round(p_cantidad * p_valor_unitario, 0)
                    else round(coalesce(p_valor_parcial, 0), 0) end;
  if v_parcial < 0 then raise exception 'El valor no puede ser negativo.'; end if;
  if v_cap.tipo_capitulo = 'ADICIONAL' then v_f := public.factor_venta_proyecto(v_cap.proyecto_id); end if;
  v_vu_venta := case when p_valor_unitario is null then null else round(p_valor_unitario * v_f, 2) end;
  v_parcial_venta := round(v_parcial * v_f, 0);

  if p_item is null then
    select coalesce(max(orden), -1) + 1 into v_orden from presupuesto_items where capitulo_id = p_capitulo;
    insert into presupuesto_items (capitulo_id, codigo, descripcion, unidad, cantidad, valor_unitario, valor_parcial, orden)
    values (p_capitulo, v_codigo, trim(p_descripcion), nullif(trim(p_unidad), ''), p_cantidad, v_vu_venta, v_parcial_venta, v_orden)
    returning id into v_id;
  else
    if not exists (select 1 from presupuesto_items where id = p_item and capitulo_id = p_capitulo) then
      raise exception 'El ítem no pertenece a ese capítulo.';
    end if;
    update presupuesto_items set codigo = v_codigo, descripcion = trim(p_descripcion), unidad = nullif(trim(p_unidad), ''),
      cantidad = p_cantidad, valor_unitario = v_vu_venta, valor_parcial = v_parcial_venta
    where id = p_item;
    v_id := p_item;
  end if;
  insert into presupuesto_items_costo (presupuesto_item_id, valor_unitario_costo, valor_parcial_costo)
  values (v_id, p_valor_unitario, v_parcial)
  on conflict (presupuesto_item_id) do update set valor_unitario_costo = excluded.valor_unitario_costo,
                                                  valor_parcial_costo = excluded.valor_parcial_costo;
  perform public._totales_capitulo_tc(p_capitulo);
  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_codigo, 'valor', v_parcial_venta, 'costo', v_parcial);
end $function$;

-- recalcular_venta_presupuesto: el factor de venta aplica a contrato y a adicionales con utilidad.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.recalcular_venta_presupuesto(uuid)'::regprocedure);
  if position('when cap.tipo_capitulo = ''CONTRATO'' then v_f' in d) = 0 then raise exception 'Parche 063 no aplica en public.recalcular_venta_presupuesto'; end if;
  d := replace(d, 'when cap.tipo_capitulo = ''CONTRATO'' then v_f', 'when cap.tipo_capitulo in (''CONTRATO'', ''ADICIONAL'') then v_f');
  execute d;
end $do$;

-- crear_capitulo_adicional_tc: admite ADICIONAL (con utilidad).
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.crear_capitulo_adicional_tc(uuid,text,text)'::regprocedure);
  if position('if p_tipo not in (''ADICIONAL_COSTO'', ''PAGO_DIRECTO_CLIENTE'')' in d) = 0 then raise exception 'Parche 063 no aplica en public.crear_capitulo_adicional_tc'; end if;
  d := replace(d, 'if p_tipo not in (''ADICIONAL_COSTO'', ''PAGO_DIRECTO_CLIENTE'')', 'if p_tipo not in (''ADICIONAL'', ''ADICIONAL_COSTO'', ''PAGO_DIRECTO_CLIENTE'')');
  execute d;
end $do$;

-- eliminar_item_adicional_tc: admite ítems de capítulos ADICIONAL.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.eliminar_item_adicional_tc(uuid)'::regprocedure);
  if position('v_cap.tipo_capitulo not in (''ADICIONAL_COSTO'', ''PAGO_DIRECTO_CLIENTE'')' in d) = 0 then raise exception 'Parche 063 no aplica en public.eliminar_item_adicional_tc'; end if;
  d := replace(d, 'v_cap.tipo_capitulo not in (''ADICIONAL_COSTO'', ''PAGO_DIRECTO_CLIENTE'')', 'v_cap.tipo_capitulo not in (''ADICIONAL'', ''ADICIONAL_COSTO'', ''PAGO_DIRECTO_CLIENTE'')');
  execute d;
end $do$;

-- caja_proyecto: lo que se cobra de adicionales incluye los adicionales con utilidad.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.caja_proyecto(uuid)'::regprocedure);
  if position('where c->>''tipo'' = ''ADICIONAL_COSTO'';' in d) = 0 then raise exception 'Parche 063 no aplica en public.caja_proyecto'; end if;
  d := replace(d, 'where c->>''tipo'' = ''ADICIONAL_COSTO'';', 'where c->>''tipo'' in (''ADICIONAL'', ''ADICIONAL_COSTO'');');
  execute d;
end $do$;

-- corte_cliente_detalle: los adicionales con utilidad suman en 'Adicionales'.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.corte_cliente_detalle(uuid)'::regprocedure);
  if position('filter (where x->>''tipo'' = ''ADICIONAL_COSTO'')' in d) = 0 then raise exception 'Parche 063 no aplica en public.corte_cliente_detalle'; end if;
  d := replace(d, 'filter (where x->>''tipo'' = ''ADICIONAL_COSTO'')', 'filter (where x->>''tipo'' in (''ADICIONAL'', ''ADICIONAL_COSTO''))');
  execute d;
end $do$;
