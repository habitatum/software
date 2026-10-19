-- 060 · Todo costo: Utilidad real, IVA del proyecto e IVA por pagar en la Caja.
-- 1) proyectos_finanzas.porcentaje_utilidad_real: % sobre el COSTO DIRECTO de los capítulos de contrato.
--    Vacío = la U (en AIU) o el % de utilidad (en IVA / Sin factura). El precio de venta NO cambia.
-- 2) _resumen_fin_tc / resumen_financiero_tc: costo, venta, utilidad real, administración e imprevistos
--    (= venta − costo − utilidad real) por capítulo y total; IVA (AIU: costo × U × IVA; IVA: venta × IVA;
--    Sin factura: 0); valor del contrato con IVA calculado y diferencia contra el valor escrito a mano.
-- 3) movimientos_caja admite PAGO_IVA (pago a la DIAN). caja_directa lo muestra como egreso "Pago de IVA".
-- 4) caja_proyecto: el saldo descuenta los pagos de IVA; compromiso "IVA por pagar" = IVA contenido en lo
--    cobrado − IVA pagado; proyección al cierre y retiro máximo descuentan el IVA (cobrado y por cobrar).
--    En obras sin IVA (Sin factura) los resultados no cambian.
-- No borra datos.

alter table public.proyectos_finanzas
  add column if not exists porcentaje_utilidad_real numeric
  check (porcentaje_utilidad_real is null or (porcentaje_utilidad_real >= 0 and porcentaje_utilidad_real <= 100));
comment on column public.proyectos_finanzas.porcentaje_utilidad_real is
  'Utilidad real (%) sobre el costo directo de los capítulos de contrato. Null = U (AIU) o % de utilidad.';

alter table public.movimientos_caja
  drop constraint if exists movimientos_caja_tipo_check,
  add constraint movimientos_caja_tipo_check
  check (tipo in ('INGRESO_CLIENTE','RETIRO_UTILIDAD','AJUSTE','PAGO_IVA'));

create or replace function public._resumen_fin_tc(p_proyecto uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f record; v_pct numeric; v_pres uuid; v_res jsonb;
  c_costo numeric; c_venta numeric; a_venta numeric; v_iva_c numeric; v_iva_a numeric; v_ur numeric;
begin
  select * into f from proyectos_finanzas where proyecto_id = p_proyecto;
  select id into v_pres from presupuestos where proyecto_id = p_proyecto;
  v_pct := coalesce(f.porcentaje_utilidad_real,
                    case when f.modalidad_facturacion = 'AIU' then f.porcentaje_u else f.porcentaje_utilidad end, 0);
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
         coalesce(sum(venta) filter (where tipo_capitulo = 'ADICIONAL_COSTO'), 0),
         coalesce(sum(round(costo * v_pct / 100)) filter (where tipo_capitulo = 'CONTRATO'), 0)  -- suma de capítulos: cuadra al peso
    into c_costo, c_venta, a_venta, v_ur from caps;
  v_iva_c := case f.modalidad_facturacion
               when 'AIU' then round(c_costo * coalesce(f.porcentaje_u, 0) / 100 * coalesce(f.porcentaje_iva, 0) / 100)
               when 'IVA' then round(c_venta * coalesce(f.porcentaje_iva, 0) / 100)
               else 0 end;
  v_iva_a := case when f.modalidad_facturacion = 'IVA' then round(a_venta * coalesce(f.porcentaje_iva, 0) / 100) else 0 end;
  select jsonb_build_object(
    'modalidad', f.modalidad_facturacion, 'porcentaje_iva', coalesce(f.porcentaje_iva, 0),
    'porcentaje_utilidad_real', v_pct, 'utilidad_real_definida', f.porcentaje_utilidad_real is not null,
    'costo_contrato', c_costo, 'venta_contrato', c_venta, 'venta_adicionales', a_venta,
    'utilidad_real', v_ur, 'adm_imprevistos', c_venta - c_costo - v_ur,
    'iva_contrato', v_iva_c, 'iva_adicionales', v_iva_a,
    'contrato_con_iva', c_venta + v_iva_c,
    'total_con_iva', c_venta + v_iva_c + a_venta + v_iva_a,
    'valor_contrato_cliente', f.valor_contrato_cliente,
    'diferencia_valor_cliente', case when f.valor_contrato_cliente is null then null else f.valor_contrato_cliente - (c_venta + v_iva_c) end,
    'tasa_iva_en_cobros', case when (c_venta + v_iva_c + a_venta + v_iva_a) > 0
                               then (v_iva_c + v_iva_a) / (c_venta + v_iva_c + a_venta + v_iva_a) else 0 end,
    'capitulos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', cp.id,
        'utilidad_real', case when cp.tipo_capitulo = 'CONTRATO' then round(cp.costo * v_pct / 100) else 0 end,
        'adm_imprevistos', case when cp.tipo_capitulo = 'CONTRATO' then cp.venta - cp.costo - round(cp.costo * v_pct / 100) else 0 end))
      from (select cap.id, cap.tipo_capitulo, coalesce(sum(pi.valor_parcial), 0) venta, coalesce(sum(pc.valor_parcial_costo), 0) costo
            from presupuesto_capitulos cap
            left join presupuesto_items pi on pi.capitulo_id = cap.id
            left join presupuesto_items_costo pc on pc.presupuesto_item_id = pi.id
            where cap.presupuesto_id = v_pres group by cap.id, cap.tipo_capitulo) cp), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public._resumen_fin_tc(uuid) from public, anon, authenticated;

create or replace function public.resumen_financiero_tc(p_proyecto uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede ver las finanzas del proyecto.'; end if;
  return public._resumen_fin_tc(p_proyecto);
end $$;
revoke all on function public.resumen_financiero_tc(uuid) from public, anon;
grant execute on function public.resumen_financiero_tc(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.caja_directa(p_proyecto uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo un administrador puede ver la caja directa';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.fecha, x.orden_tipo, x.creado_en)
    from (
      select m.fecha, m.creado_en, 1 orden_tipo, m.tipo,
             case when m.tipo = 'INGRESO_CLIENTE' or (m.tipo = 'AJUSTE' and m.valor > 0) then abs(m.valor) else 0 end ingreso,
             case when m.tipo in ('RETIRO_UTILIDAD','PAGO_IVA') or (m.tipo = 'AJUSTE' and m.valor < 0) then abs(m.valor) else 0 end egreso,
             m.concepto || coalesce(' · ' || m.beneficiario, '') concepto,
             case m.tipo when 'INGRESO_CLIENTE' then 'Ingreso cliente' when 'RETIRO_UTILIDAD' then 'Retiro de utilidad'
                         when 'PAGO_IVA' then 'Pago de IVA' else 'Ajuste' end capitulo,
             case when m.concepto like '%(V1)' then 'V1' else 'App' end origen, null::text folio
      from movimientos_caja m where m.proyecto_id = p_proyecto
      union all
      select h.fecha, h.creado_en, 2, 'EGRESO', 0, h.valor, h.concepto,
             coalesce(h.codigo_origen, (select codigo from presupuesto_capitulos where id = h.capitulo_id), 'Sin capítulo'),
             'V1', null
      from ejecutado_historico h where h.proyecto_id = p_proyecto
      union all
      select o.fecha, o.creado_en, 3, 'EGRESO', 0, v.neto_a_pagar,
             o.folio || ' · ' || coalesce(p.nombre, '') || coalesce(' · ' || nullif(o.descripcion, ''), ''),
             coalesce((select string_agg(distinct cod, ', ') from (
                 select pc.codigo cod from items_oc io join presupuesto_capitulos pc on pc.id = io.capitulo_id where io.orden_compra_id = o.id
                 union
                 select pi.codigo from items_oc io join items_oc_presupuesto iop on iop.item_oc_id = io.id
                   join presupuesto_items pi on pi.id = iop.presupuesto_item_id where io.orden_compra_id = o.id) z), 'Sin capítulo'),
             case o.origen when 'TELEGRAM' then 'Telegram' when 'CAJA_MENOR' then 'Caja menor' when 'CORTE' then 'Corte' else 'OC' end,
             o.folio
      from ordenes_compra o join v_ordenes_compra_calculadas v on v.id = o.id left join proveedores p on p.id = o.proveedor_id
      where o.proyecto_id = p_proyecto and o.estado <> 'ANULADA' and not o.excluir_control and not o.pagado_por_cliente
      union all
      select g.fecha, g.creado_en, 4, 'EGRESO', 0, g.valor, 'Caja menor (por legalizar) · ' || g.concepto || coalesce(' · ' || g.remitente, ''),
             coalesce((select codigo from presupuesto_capitulos where id = g.capitulo_id), 'Sin capítulo'), 'Caja menor', null
      from caja_menor_gastos g where g.proyecto_id = p_proyecto and g.oc_id is null
    ) x), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.caja_proyecto(p_proyecto uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_ctrl jsonb; v_fin record; v_rf jsonb;
  v_ing numeric; v_ret numeric; v_aju numeric; v_piva numeric; v_hist numeric; v_oc numeric;
  v_retenidos numeric; v_adic numeric; v_contrato numeric; v_por_ejecutar numeric; v_por_ejecutar_calc numeric;
  v_saldo numeric; v_por_cobrar numeric; v_conc record; v_res jsonb;
  v_tasa numeric; v_iva_cobrado numeric; v_iva_por_pagar numeric; v_iva_por_cobrar numeric; v_cubre numeric;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo un administrador puede ver la caja del proyecto';
  end if;
  select * into v_fin from proyectos_finanzas where proyecto_id = p_proyecto;
  v_ctrl := public.control_todo_costo(p_proyecto);
  v_rf := public._resumen_fin_tc(p_proyecto);

  select coalesce(sum(valor) filter (where tipo='INGRESO_CLIENTE'),0),
         coalesce(sum(valor) filter (where tipo='RETIRO_UTILIDAD'),0),
         coalesce(sum(valor) filter (where tipo='AJUSTE'),0),
         coalesce(sum(valor) filter (where tipo='PAGO_IVA'),0)
    into v_ing, v_ret, v_aju, v_piva from movimientos_caja where proyecto_id = p_proyecto;

  select coalesce(sum(valor),0) into v_hist from ejecutado_historico where proyecto_id = p_proyecto;

  select coalesce(sum(v.neto_a_pagar),0) into v_oc
  from v_ordenes_compra_calculadas v join ordenes_compra o on o.id = v.id
  where v.proyecto_id = p_proyecto and v.estado <> 'ANULADA' and not o.excluir_control and not o.pagado_por_cliente;

  select coalesce(sum(coalesce(v.valor_retenido,0) - coalesce(v.devolucion_retenido,0)),0) into v_retenidos
  from v_ordenes_compra_calculadas v join ordenes_compra o on o.id = v.id
  where v.proyecto_id = p_proyecto and v.estado <> 'ANULADA' and not o.pagado_por_cliente;

  -- Adicionales (sin utilidad) más su IVA cuando la modalidad es IVA sobre el total (060).
  select coalesce(sum((c->>'venta')::numeric),0) into v_adic
  from jsonb_array_elements(coalesce(v_ctrl->'capitulos','[]'::jsonb)) c where c->>'tipo' = 'ADICIONAL_COSTO';
  v_adic := v_adic + coalesce((v_rf->>'iva_adicionales')::numeric, 0);

  select coalesce(sum(greatest(coalesce((c->>'costo')::numeric,0) - coalesce((c->>'ejecutado')::numeric,0), 0)),0) into v_por_ejecutar_calc
  from jsonb_array_elements(coalesce(v_ctrl->'capitulos','[]'::jsonb)) c where c->>'tipo' <> 'PAGO_DIRECTO_CLIENTE';
  v_por_ejecutar := coalesce(v_fin.costo_por_ejecutar_manual, v_por_ejecutar_calc);

  select v_oc + coalesce(sum(valor),0) into v_oc from caja_menor_gastos where proyecto_id = p_proyecto and oc_id is null;
  v_contrato := coalesce(v_fin.valor_contrato_cliente, 0);
  v_saldo := v_ing - v_hist - v_oc - v_ret + v_aju - v_piva;
  v_por_cobrar := greatest(v_contrato + v_adic - v_ing, 0);

  -- 060: IVA contenido en lo cobrado y en lo que falta por cobrar (no es plata de HABITATUM).
  v_tasa := coalesce((v_rf->>'tasa_iva_en_cobros')::numeric, 0);
  v_iva_cobrado := round(v_ing * v_tasa);
  v_iva_por_pagar := greatest(v_iva_cobrado - v_piva, 0);
  v_iva_por_cobrar := round(v_por_cobrar * v_tasa);
  v_cubre := v_por_cobrar - v_iva_por_cobrar;   -- lo que el cliente aún paga que sí cubre costos

  select * into v_conc from conciliaciones_caja where proyecto_id = p_proyecto order by fecha desc, creado_en desc limit 1;

  select jsonb_build_object(
    'finanzas', to_jsonb(v_fin) - 'proyecto_id',
    'contrato', jsonb_build_object('valor_base', v_contrato, 'adicionales', v_adic, 'total', v_contrato + v_adic),
    'ingresos', v_ing, 'por_cobrar', v_por_cobrar,
    'egresos', jsonb_build_object('historico', v_hist, 'ordenes_compra', v_oc, 'pagos_iva', v_piva, 'total', v_hist + v_oc),
    'retiros_utilidad', v_ret, 'ajustes', v_aju,
    'saldo_libros', v_saldo,
    'compromisos', jsonb_build_object('retenidos_por_devolver', v_retenidos, 'costo_por_ejecutar', v_por_ejecutar,
        'costo_por_ejecutar_calculado', v_por_ejecutar_calc,
        'costo_por_ejecutar_manual', v_fin.costo_por_ejecutar_manual is not null,
        'costo_por_ejecutar_fecha', v_fin.costo_por_ejecutar_fecha,
        'iva_por_pagar', v_iva_por_pagar, 'iva_cobrado', v_iva_cobrado, 'iva_pagado', v_piva,
        'iva_por_cobrar', v_iva_por_cobrar, 'tasa_iva_en_cobros', v_tasa),
    'conciliacion', case when v_conc.id is null then null else jsonb_build_object(
        'fecha', v_conc.fecha, 'saldo_banco', v_conc.saldo_banco, 'nota', v_conc.nota,
        'diferencia', v_conc.saldo_banco - v_saldo) end,
    'caja_proyectada_cierre', v_saldo + v_por_cobrar - v_por_ejecutar - v_retenidos - v_iva_por_pagar - v_iva_por_cobrar,
    'retiro_maximo_libros', greatest(v_saldo - v_retenidos - v_iva_por_pagar - greatest(v_por_ejecutar - v_cubre, 0), 0),
    'retiro_maximo_banco', case when v_conc.id is null then null
        else greatest(v_conc.saldo_banco - v_retenidos - v_iva_por_pagar - greatest(v_por_ejecutar - v_cubre, 0), 0) end,
    'deficit_banco', case when v_conc.id is null then null
        else least(v_conc.saldo_banco - v_retenidos - v_iva_por_pagar - greatest(v_por_ejecutar - v_cubre, 0), 0) end,
    'plan_pagos', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'orden', p.orden, 'concepto', p.concepto, 'valor', p.valor,
                 'fecha_estimada', p.fecha_estimada,
                 'recibido', least(p.valor, greatest(v_ing - (p.acumulado - p.valor), 0)),
                 'estado', case when v_ing >= p.acumulado then 'PAGADO'
                                when v_ing > p.acumulado - p.valor then 'PARCIAL'
                                when p.fecha_estimada is not null and p.fecha_estimada < current_date then 'VENCIDO'
                                else 'PENDIENTE' end) order by p.orden, p.creado_en)
        from (select pp.*, sum(pp.valor) over (order by pp.orden, pp.creado_en) acumulado
              from plan_pagos_cliente pp where pp.proyecto_id = p_proyecto) p), '[]'::jsonb),
    'movimientos', coalesce((select jsonb_agg(to_jsonb(m) - 'proyecto_id' order by m.fecha desc, m.creado_en desc)
        from movimientos_caja m where m.proyecto_id = p_proyecto), '[]'::jsonb),
    'conciliaciones', coalesce((select jsonb_agg(to_jsonb(c) - 'proyecto_id' order by c.fecha desc, c.creado_en desc)
        from conciliaciones_caja c where c.proyecto_id = p_proyecto), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $function$;
