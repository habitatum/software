-- 047 · Devolución de retenidos en los cortes de obra (aplicada el 03/10/2026, registro Supabase: devolucion_retenidos)
-- Pedido de Andrés (Apto 423, contrato 09-2026-06). Corte de DEVOLUCIÓN: sin cantidades, con el valor devuelto
-- (y opcionalmente un descuento contra el retenido, con motivo). Genera la OC de devolución, cuyas líneas
-- regresan el dinero a los mismos ítems del presupuesto donde se retuvo (los dos controles presupuestales
-- restan la retención del ejecutado; la devolución la suma de vuelta). El estado de cuenta y los acumulados
-- la cuentan como devolución, no como obra ejecutada. No se puede devolver más de lo retenido.

alter table public.cortes
  add column if not exists tipo text not null default 'OBRA' check (tipo in ('OBRA','DEVOLUCION')),
  add column if not exists valor_devolucion numeric not null default 0 check (valor_devolucion >= 0),
  add column if not exists descuento_retenido numeric not null default 0 check (descuento_retenido >= 0),
  add column if not exists motivo_descuento text;
alter table public.ordenes_compra add column if not exists es_devolucion_retenido boolean not null default false;

-- Retenido pendiente de devolver de un contrato: retenido − devuelto − descontado (cortes de devolución vigentes).
create or replace function public.retenido_por_devolver_contrato(p_contrato uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(
    coalesce((select sum(v.valor_retenido) - sum(coalesce(v.devolucion_retenido, 0))
                - sum(case when o.es_devolucion_retenido then v.subtotal else 0 end)
              from public.v_ordenes_compra_calculadas v join public.ordenes_compra o on o.id = v.id
              where v.contrato_id = p_contrato and v.estado <> 'ANULADA'), 0)
    - coalesce((select sum(c.descuento_retenido) from public.cortes c left join public.ordenes_compra o on o.id = c.oc_id
              where c.contrato_id = p_contrato and c.tipo = 'DEVOLUCION' and c.estado = 'APROBADO'
                and (c.oc_id is null or o.estado <> 'ANULADA')), 0), 2);
$$;

-- Registra la devolución (corte aprobado + OC) en una sola transacción. Solo admin.
create or replace function public.devolver_retenido_contrato(
  p_contrato uuid, p_fecha date, p_valor numeric, p_descuento numeric default 0,
  p_motivo text default null, p_pagado_por_cliente boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k record; v_saldo numeric; v_num integer; v_corte uuid; v_oc uuid; v_folio text;
        v_total_fuente numeric; v_n integer := 0; v_acum numeric := 0; r record; v_io uuid; v_val numeric; v_cnt integer;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede registrar la devolución de retenidos.'; end if;
  select * into k from public.contratos where id = p_contrato;
  if k.id is null then raise exception 'El contrato no existe.'; end if;
  p_valor := round(coalesce(p_valor, 0), 2); p_descuento := round(coalesce(p_descuento, 0), 2);
  if p_valor < 0 or p_descuento < 0 then raise exception 'Los valores no pueden ser negativos.'; end if;
  if p_valor + p_descuento <= 0 then raise exception 'Escriba el valor a devolver o el descuento.'; end if;
  if p_descuento > 0 and length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escriba el motivo del descuento al retenido.'; end if;
  v_saldo := public.retenido_por_devolver_contrato(p_contrato);
  if p_valor + p_descuento > v_saldo + 1 then
    raise exception 'DEVOLUCION: el contrato % solo tiene $% de retenido por devolver; devolución + descuento suman $%.',
      k.numero_contrato, replace(to_char(round(v_saldo), 'FM999,999,999,990'), ',', '.'),
      replace(to_char(round(p_valor + p_descuento), 'FM999,999,999,990'), ',', '.');
  end if;

  select coalesce(max(numero), 0) + 1 into v_num from public.cortes where contrato_id = p_contrato;
  insert into public.cortes (contrato_id, numero, fecha, porcentaje_retencion, tipo_amortizacion, porcentaje_amortizacion,
     valor_amortizacion_fijo, notas, estado, subtotal, valor_amortizacion, valor_retencion, neto, creado_por, aprobado_en,
     historico, descuento, tipo, valor_devolucion, descuento_retenido, motivo_descuento)
  values (p_contrato, v_num, coalesce(p_fecha, current_date), 0, 'NINGUNA', 0, 0,
     case when p_descuento > 0 then 'Devolución de retenido. Descuento: ' || btrim(p_motivo) else 'Devolución de retenido' end,
     'APROBADO', 0, 0, 0, p_valor, auth.uid(), now(), false, 0, 'DEVOLUCION', p_valor, p_descuento,
     nullif(btrim(coalesce(p_motivo, '')), ''))
  returning id into v_corte;

  if p_valor > 0 then
    insert into public.ordenes_compra (tipo_orden, contrato_id, fecha, proveedor_id, descripcion, estado, tipo_pago,
       porcentaje_anticipo, porcentaje_amortizacion, tipo_amortizacion, valor_amortizacion_manual, responsable, descuento,
       tipo_impuesto, porcentaje_iva, porcentaje_retencion, devolucion_retenido, notas, proyecto_id, origen,
       pagado_por_cliente, es_devolucion_retenido)
    values ('CONTRATO', p_contrato, coalesce(p_fecha, current_date), k.contratista_id,
       'Devolución de retenido · contrato ' || k.numero_contrato || ' (corte ' || v_num || ')', 'VIGENTE', 'NORMAL',
       0, 0, 'PORCENTAJE', 0, public._responsable_proyecto(k.proyecto_id), 0, 'SIN_IVA', 19, 0, 0,
       case when p_descuento > 0 then 'Descuento al retenido $' || replace(to_char(round(p_descuento), 'FM999,999,999,990'), ',', '.') || ': ' || btrim(p_motivo) end,
       k.proyecto_id, 'CORTE', coalesce(p_pagado_por_cliente, false), true)
    returning id, folio into v_oc, v_folio;

    -- Dónde se retuvo: cada OC del contrato con retención neta, repartida por sus líneas. Si la OC viene de
    -- un corte, se usan las líneas del corte (con su enlace al presupuesto); si no, las de la OC.
    drop table if exists _fuente;
    create temp table _fuente on commit drop as
    with oc_ret as (
      select v.id, (v.valor_retenido - coalesce(v.devolucion_retenido, 0)) ret, v.subtotal_items
      from public.v_ordenes_compra_calculadas v join public.ordenes_compra o on o.id = v.id
      where v.contrato_id = p_contrato and v.estado <> 'ANULADA' and v.tipo_pago <> 'ANTICIPO'
        and not o.es_devolucion_retenido and (v.valor_retenido - coalesce(v.devolucion_retenido, 0)) > 0),
    de_corte as (
      select ci.presupuesto_item_id, case when ci.presupuesto_item_id is null then ci.capitulo_id end capitulo_id,
             q.ret * (ci.cantidad * ci.valor_unitario) / nullif(sum(ci.cantidad * ci.valor_unitario) over (partition by q.id), 0) val
      from oc_ret q join public.cortes c on c.oc_id = q.id and c.tipo = 'OBRA'
      join public.corte_items ci on ci.corte_id = c.id and ci.cantidad <> 0),
    de_oc as (
      select coalesce(x.presupuesto_item_id, null) presupuesto_item_id, case when x.presupuesto_item_id is null then io.capitulo_id end capitulo_id,
             q.ret * (io.cantidad * io.valor_unitario) / nullif(q.subtotal_items, 0) * coalesce(x.porcentaje, 100) / 100 val
      from oc_ret q join public.items_oc io on io.orden_compra_id = q.id
      left join public.items_oc_presupuesto x on x.item_oc_id = io.id
      where not exists (select 1 from public.cortes c where c.oc_id = q.id and c.tipo = 'OBRA'))
    select presupuesto_item_id, capitulo_id, sum(val) val from (select * from de_corte union all select * from de_oc) z
    where val is not null group by 1, 2 having sum(val) > 0;

    select coalesce(sum(val), 0), count(*) into v_total_fuente, v_cnt from _fuente;
    if v_total_fuente <= 0 then
      insert into public.items_oc (orden_compra_id, descripcion, unidad, cantidad, valor_unitario, orden)
      values (v_oc, 'Devolución de retenido · contrato ' || k.numero_contrato, 'Glb', 1, p_valor, 0);
    else
      for r in select f.*, pi.codigo, pi.descripcion pdesc, pc.codigo ccod, pc.nombre cnom
               from _fuente f left join public.presupuesto_items pi on pi.id = f.presupuesto_item_id
               left join public.presupuesto_capitulos pc on pc.id = f.capitulo_id
               order by f.val desc loop
        v_n := v_n + 1;
        v_val := case when v_n = v_cnt then p_valor - v_acum else round(p_valor * r.val / v_total_fuente, 2) end;
        v_acum := v_acum + v_val;
        insert into public.items_oc (orden_compra_id, descripcion, unidad, cantidad, valor_unitario, orden, capitulo_id)
        values (v_oc, 'Devolución de retenido · ' || coalesce(r.codigo || ' ' || left(r.pdesc, 60), 'cap. ' || r.ccod || ' ' || r.cnom, 'sin ítem del presupuesto'),
                'Glb', 1, v_val, v_n - 1, r.capitulo_id)
        returning id into v_io;
        if r.presupuesto_item_id is not null then
          insert into public.items_oc_presupuesto (item_oc_id, presupuesto_item_id, porcentaje, orden) values (v_io, r.presupuesto_item_id, 100, 0);
        end if;
      end loop;
    end if;
    update public.cortes set oc_id = v_oc where id = v_corte;
  end if;

  return jsonb_build_object('corte', v_num, 'folio', v_folio, 'devuelto', p_valor, 'descuento', p_descuento,
                            'retenido_por_devolver', public.retenido_por_devolver_contrato(p_contrato));
end $$;

-- Un corte de devolución no se edita como corte de obra.
do $m$ declare d text; begin
  d := pg_get_functiondef('public.actualizar_corte(uuid,boolean)'::regprocedure);
  if d !~ 'if\s+c\.estado\s+<>\s+''APROBADO''\s+then\s+raise\s+exception\s+''Solo aplica a cortes aprobados'';\s+end\s+if;' then
    raise exception 'actualizar_corte: patrón no encontrado'; end if;
  d := regexp_replace(d, '(if\s+c\.estado\s+<>\s+''APROBADO''\s+then\s+raise\s+exception\s+''Solo aplica a cortes aprobados'';\s+end\s+if;)',
    E'\\1\n  if c.tipo = ''DEVOLUCION'' then raise exception ''Los cortes de devolución de retenido no se editan: si hay un error, anule su orden de compra y registre la devolución de nuevo.''; end if;');
  execute d;
end $m$;
revoke all on function public.actualizar_corte(uuid, boolean) from public, anon;
grant execute on function public.actualizar_corte(uuid, boolean) to authenticated, service_role;

-- Acumulados del contrato: la OC de devolución es devolución, no obra ejecutada.
create or replace view public.v_acumulados_contrato with (security_invoker = true) as
select v.contrato_id,
  sum(case when v.tipo_pago <> 'ANTICIPO' and not o.es_devolucion_retenido then v.subtotal else 0 end) as subtotal_acumulado,
  sum(case when v.tipo_pago <> 'ANTICIPO' and not o.es_devolucion_retenido then v.total else 0 end) as total_acumulado,
  sum(v.valor_retenido) as retenido_acumulado,
  sum(v.valor_amortizacion) as amortizado_acumulado,
  sum(coalesce(v.devolucion_retenido, 0) + case when o.es_devolucion_retenido then v.subtotal else 0 end) as devolucion_acumulada
from public.v_ordenes_compra_calculadas v join public.ordenes_compra o on o.id = v.id
where v.contrato_id is not null and v.estado <> 'ANULADA'
group by v.contrato_id;
revoke all on public.v_acumulados_contrato from public, anon;
grant select on public.v_acumulados_contrato to authenticated, service_role;

-- Estado de cuenta: devolución y descuento al retenido.
create or replace function public.estado_cuenta_contrato(p_contrato_id uuid)
 returns jsonb language sql stable set search_path to 'public' as $function$
with c as (
  select c.*,
    case
      when c.plazo_valor ~ '^\d+$' and c.plazo_unidad ilike 'd%' then c.fecha_inicio + c.plazo_valor::int
      when c.plazo_valor ~ '^\d+$' and c.plazo_unidad ilike 'mes%' then (c.fecha_inicio + (c.plazo_valor||' months')::interval)::date
      when c.plazo_valor ~ '^\d+$' and c.plazo_unidad ilike 'sem%' then c.fecha_inicio + c.plazo_valor::int*7
    end as fecha_fin
  from contratos c where c.id = p_contrato_id
),
mov as (
  select v.id, v.folio, v.fecha, v.tipo_pago, v.descripcion, v.notas,
    case when v.tipo_pago='ANTICIPO' or o.es_devolucion_retenido then 0 else round(v.subtotal,2) end ejecutado,
    case when v.tipo_pago='ANTICIPO' then round(v.subtotal,2) else 0 end anticipo,
    round(coalesce(v.valor_amortizacion,0),2) amortizacion,
    round(coalesce(v.valor_retenido,0),2) retencion,
    round(coalesce(v.devolucion_retenido,0) + case when o.es_devolucion_retenido then v.subtotal else 0 end,2) devolucion,
    round(coalesce(v.descuento,0),2) descuento,
    round(coalesce(v.valor_iva,0)+coalesce(v.valor_aiu,0),2) impuestos,
    round(v.neto_a_pagar,2) neto
  from v_ordenes_compra_calculadas v join ordenes_compra o on o.id = v.id
  where v.contrato_id = p_contrato_id and v.estado='VIGENTE'
),
t as (
  select coalesce(sum(ejecutado),0) ejecutado, coalesce(sum(anticipo),0) anticipo, coalesce(sum(amortizacion),0) amortizacion,
         coalesce(sum(retencion),0) retencion, coalesce(sum(devolucion),0) devolucion, coalesce(sum(neto),0) neto,
         coalesce(sum(descuento),0) descuento, coalesce(sum(impuestos),0) impuestos, count(*) n_ocs, max(fecha) ultima_oc,
         coalesce((select sum(cc.descuento_retenido) from cortes cc left join ordenes_compra oo on oo.id = cc.oc_id
                   where cc.contrato_id = p_contrato_id and cc.tipo = 'DEVOLUCION' and cc.estado = 'APROBADO'
                     and (cc.oc_id is null or oo.estado <> 'ANULADA')),0) descuento_retenido
  from mov
)
select jsonb_build_object(
  'generado_en', now(),
  'contrato', jsonb_build_object('id',c.id,'numero',c.numero_contrato,'concepto',c.concepto,'alcance',c.alcance_detallado,'tipo',c.tipo_contrato,
     'valor',c.valor_inicial,'fecha_contrato',c.fecha_contrato,'fecha_inicio',c.fecha_inicio,'plazo_valor',c.plazo_valor,'plazo_unidad',c.plazo_unidad,
     'fecha_fin',c.fecha_fin,'garantia_meses',c.garantia_meses,'estado',c.estado),
  'proyecto', (select jsonb_build_object('nombre',p.nombre,'codigo',p.codigo,'cliente',p.cliente,'direccion',p.direccion_obra,'ciudad',p.ciudad,
     'emisor',p.nombre_emisor,'nit_emisor',p.nit_empresa,'representante',p.representante_legal,'telefono',p.telefono_empresa,'marca_habitatum',p.mostrar_marca_habitatum)
     from proyectos p where p.id=c.proyecto_id),
  'contratista', (select jsonb_build_object('nombre',pr.nombre,'nit',pr.nit,'banco',pr.banco,'tipo_cuenta',pr.tipo_cuenta,'numero_cuenta',pr.numero_cuenta,'telefono',pr.telefono)
     from proveedores pr where pr.id=c.contratista_id),
  'movimientos', coalesce((select jsonb_agg(to_jsonb(m) - 'id' order by m.fecha, m.folio) from mov m),'[]'::jsonb),
  'totales', to_jsonb(t),
  'saldos', jsonb_build_object(
     'porcentaje_ejecucion', case when c.valor_inicial>0 then round(t.ejecutado/c.valor_inicial*100,2) else 0 end,
     'por_ejecutar', greatest(c.valor_inicial - t.ejecutado,0),
     'sobre_ejecucion', greatest(t.ejecutado - c.valor_inicial,0),
     'anticipo_por_amortizar', round(t.anticipo - t.amortizacion,2),
     'retenido_por_devolver', round(t.retencion - t.devolucion - t.descuento_retenido,2),
     'girado_neto', t.neto),
  'alertas', to_jsonb(array_remove(array[
     case when t.ejecutado > c.valor_inicial then 'SOBREEJECUCION' end,
     case when c.fecha_fin is not null and c.fecha_fin < current_date and t.ejecutado < c.valor_inicial then 'PLAZO_VENCIDO_CON_SALDO' end,
     case when c.fecha_fin is not null and t.ultima_oc > c.fecha_fin then 'EJECUCION_POSTERIOR_AL_PLAZO' end,
     case when coalesce(nullif(c.garantia_meses,''),'0') in ('0','') then 'SIN_GARANTIA' end,
     case when round(t.anticipo - t.amortizacion,2) > 1 then 'ANTICIPO_PENDIENTE' end,
     case when round(t.retencion - t.devolucion - t.descuento_retenido,2) > 0.5 then 'RETENIDO_PENDIENTE_DEVOLUCION' end
  ], null))
)
from c, t;
$function$;
revoke all on function public.estado_cuenta_contrato(uuid) from public, anon;
grant execute on function public.estado_cuenta_contrato(uuid) to authenticated, service_role;

revoke all on function public.retenido_por_devolver_contrato(uuid), public.devolver_retenido_contrato(uuid, date, numeric, numeric, text, boolean) from public, anon;
grant execute on function public.retenido_por_devolver_contrato(uuid), public.devolver_retenido_contrato(uuid, date, numeric, numeric, text, boolean) to authenticated, service_role;
