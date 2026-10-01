-- 045 · Ejecutado sin imputar visible y la imputación manual no se pierde (aplicada el 30/09/2026, registro Supabase: ejecutado_sin_imputar)
-- Decisión A de Andrés: el código del presupuesto en los ítems del contrato es OPCIONAL.
-- Lo que no se imputa queda visible como "sin imputar / no presupuestado" y se puede imputar después.
-- 1. items_oc.corte_item_id: vínculo explícito entre la línea de la OC y la línea del corte que la generó.
-- 2. aprobar_corte y actualizar_corte llenan ese vínculo; actualizar_corte conserva la imputación manual
--    de cada línea al reconstruir la OC (antes la borraba en silencio).
-- 3. v_ejecutado_sin_imputar: líneas de OC (o la parte no imputada) con la MISMA base de v_presupuesto_ejecutado.
-- 4. imputar_linea_oc: imputa una línea al 100% a un ítem del presupuesto (admin) y, opcionalmente,
--    recuerda el código en el ítem del contrato para los próximos cortes.
-- No cambia ninguna cifra existente.

-- 1 ─────────────────────────────────────────────────────────────
alter table public.items_oc add column if not exists corte_item_id uuid
  references public.corte_items(id) on delete set null;
create index if not exists items_oc_corte_item_id_idx on public.items_oc(corte_item_id);

-- Relleno: OC de cortes aprobados (no históricos, OC al día). La línea N de la OC es la N-ésima línea del
-- corte con cantidad <> 0 (así las crean aprobar_corte y actualizar_corte); se exige además la misma descripción.
with ci as (
  select k.id corte_item_id, c.oc_id, k.descripcion,
         row_number() over (partition by c.id order by k.orden) - 1 as pos
  from public.cortes c join public.corte_items k on k.corte_id = c.id
  where c.estado = 'APROBADO' and not coalesce(c.historico, false) and c.oc_id is not null
    and not coalesce(c.oc_desactualizada, false) and k.cantidad <> 0
)
update public.items_oc io set corte_item_id = ci.corte_item_id
from ci
where io.orden_compra_id = ci.oc_id and io.orden = ci.pos and io.descripcion = ci.descripcion
  and io.corte_item_id is null;

-- 2 ─────────────────────────────────────────────────────────────
do $m$
declare d text; n int;
begin
  -- aprobar_corte: guarda el vínculo al crear cada línea
  d := pg_get_functiondef('public.aprobar_corte(uuid)'::regprocedure);
  n := (length(d) - length(replace(d, 'insert into items_oc (orden_compra_id,', ''))) / length('insert into items_oc (orden_compra_id,');
  if n <> 1 then raise exception 'aprobar_corte: patrón insert no encontrado (%)', n; end if;
  d := replace(d, 'insert into items_oc (orden_compra_id,', 'insert into items_oc (corte_item_id, orden_compra_id,');
  if position('values (v_oc, r.descripcion' in d) = 0 then raise exception 'aprobar_corte: patrón values no encontrado'; end if;
  d := replace(d, 'values (v_oc, r.descripcion', 'values (r.id, v_oc, r.descripcion');
  execute d;

  -- actualizar_corte: vínculo + conserva la imputación manual de cada línea
  d := pg_get_functiondef('public.actualizar_corte(uuid,boolean)'::regprocedure);
  if position('v_n int := 0; v_folio text;' in d) = 0 then raise exception 'actualizar_corte: patrón declare no encontrado'; end if;
  d := replace(d, 'v_n int := 0; v_folio text;', 'v_n int := 0; v_folio text; v_imp jsonb;');
  if position('delete from items_oc where orden_compra_id = o.id;' in d) = 0 then raise exception 'actualizar_corte: patrón delete no encontrado'; end if;
  d := replace(d, 'delete from items_oc where orden_compra_id = o.id;', $r$-- Imputación manual actual de cada línea (por línea del corte), para no perderla al reconstruir (045).
    select coalesce(jsonb_object_agg(x.corte_item_id::text, x.imps), '{}'::jsonb) into v_imp from (
      select io.corte_item_id, jsonb_agg(jsonb_build_object('p', iop.presupuesto_item_id, 'pct', iop.porcentaje, 'o', iop.orden)) imps
      from items_oc io join items_oc_presupuesto iop on iop.item_oc_id = io.id
      where io.orden_compra_id = o.id and io.corte_item_id is not null
      group by io.corte_item_id) x;
    delete from items_oc where orden_compra_id = o.id;$r$);
  if position('insert into items_oc (orden_compra_id,' in d) = 0 then raise exception 'actualizar_corte: patrón insert no encontrado'; end if;
  d := replace(d, 'insert into items_oc (orden_compra_id,', 'insert into items_oc (corte_item_id, orden_compra_id,');
  if position('values (o.id, r.descripcion' in d) = 0 then raise exception 'actualizar_corte: patrón values no encontrado'; end if;
  d := replace(d, 'values (o.id, r.descripcion', 'values (r.id, o.id, r.descripcion');
  if d !~ 'values \(v_io, r\.presupuesto_item_id, 100, 0\);\s*end if;' then raise exception 'actualizar_corte: patrón imputación no encontrado'; end if;
  d := regexp_replace(d, 'values \(v_io, r\.presupuesto_item_id, 100, 0\);\s*end if;',
    $r$values (v_io, r.presupuesto_item_id, 100, 0);
      elsif v_imp ? r.id::text then
        insert into items_oc_presupuesto (item_oc_id, presupuesto_item_id, porcentaje, orden)
        select v_io, (e->>'p')::uuid, (e->>'pct')::numeric, coalesce((e->>'o')::int, 0)
        from jsonb_array_elements(v_imp -> r.id::text) e;
      end if;$r$);
  execute d;
end $m$;
-- create or replace conserva los permisos; se reafirman por regla del manual.
revoke all on function public.aprobar_corte(uuid) from public, anon;
grant execute on function public.aprobar_corte(uuid) to authenticated, service_role;
revoke all on function public.actualizar_corte(uuid, boolean) from public, anon;
grant execute on function public.actualizar_corte(uuid, boolean) to authenticated, service_role;

-- 3 ─────────────────────────────────────────────────────────────
create or replace view public.v_ejecutado_sin_imputar with (security_invoker = true) as
with lineas as (
  select io.id as item_oc_id, io.orden_compra_id as oc_id, oc.folio, oc.fecha, oc.proyecto_id,
         oc.proveedor_id, oc.contrato_id, o.origen, io.corte_item_id, ci.contrato_item_id,
         io.descripcion, io.unidad, io.cantidad, io.valor_unitario, io.capitulo_id, p.modelo_contratacion,
         -- misma base que v_presupuesto_ejecutado: valor de la línea + su parte de IVA/AIU − descuento − retención neta
         ((io.cantidad * io.valor_unitario) +
           case when coalesce(oc.subtotal_items, 0) <= 0 then 0
                else ((io.cantidad * io.valor_unitario) / oc.subtotal_items)
                     * ((coalesce(oc.valor_iva, 0) + coalesce(oc.valor_aiu, 0) - coalesce(oc.descuento, 0))
                        - (coalesce(oc.valor_retenido, 0) - coalesce(oc.devolucion_retenido, 0))) end) as valor_ejecutado,
         coalesce((select sum(x.porcentaje) from public.items_oc_presupuesto x where x.item_oc_id = io.id), 0) as pct_imputado
  from public.items_oc io
  join public.v_ordenes_compra_calculadas oc on oc.id = io.orden_compra_id
  join public.ordenes_compra o on o.id = io.orden_compra_id
  join public.proyectos p on p.id = oc.proyecto_id
  left join public.corte_items ci on ci.id = io.corte_item_id
  where oc.estado <> 'ANULADA' and oc.tipo_pago <> 'ANTICIPO' and not coalesce(o.excluir_control, false)
)
select item_oc_id, oc_id, folio, fecha, proyecto_id, proveedor_id, contrato_id, origen, corte_item_id, contrato_item_id,
       descripcion, unidad, cantidad, valor_unitario,
       round(valor_ejecutado, 2) as valor_linea,
       least(pct_imputado, 100) as pct_imputado,
       round(valor_ejecutado * (1 - least(pct_imputado, 100) / 100), 2) as valor_sin_imputar
from lineas
where round(valor_ejecutado * (1 - least(pct_imputado, 100) / 100), 2) > 0.5
  -- En todo costo la imputación por capítulo cuenta como imputada; en administración delegada no.
  and not (modelo_contratacion::text = 'TODO_COSTO' and capitulo_id is not null and pct_imputado = 0);
revoke all on public.v_ejecutado_sin_imputar from public, anon;
grant select on public.v_ejecutado_sin_imputar to authenticated, service_role;

-- 4 ─────────────────────────────────────────────────────────────
create or replace function public.imputar_linea_oc(p_item_oc uuid, p_presupuesto_item uuid, p_recordar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; v_cap uuid; v_proy uuid; v_codigo text; v_recordado boolean := false;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede imputar al presupuesto.'; end if;
  select io.id, io.corte_item_id, o.proyecto_id, o.estado, o.folio, ci.contrato_item_id
    into l
  from items_oc io join ordenes_compra o on o.id = io.orden_compra_id
  left join corte_items ci on ci.id = io.corte_item_id
  where io.id = p_item_oc;
  if not found then raise exception 'La línea de la orden no existe.'; end if;
  if l.estado = 'ANULADA' then raise exception 'La orden % está anulada.', l.folio; end if;
  select pi.capitulo_id, p.proyecto_id, pi.codigo into v_cap, v_proy, v_codigo
  from presupuesto_items pi join presupuesto_capitulos pc on pc.id = pi.capitulo_id
  join presupuestos p on p.id = pc.presupuesto_id where pi.id = p_presupuesto_item;
  if v_proy is null then raise exception 'El ítem del presupuesto no existe.'; end if;
  if v_proy <> l.proyecto_id then raise exception 'El ítem del presupuesto es de otra obra.'; end if;
  if exists (select 1 from items_oc_presupuesto where item_oc_id = p_item_oc) then
    raise exception 'La línea ya tiene imputación; para cambiarla o repartirla edite la orden %.', l.folio;
  end if;

  insert into items_oc_presupuesto (item_oc_id, presupuesto_item_id, porcentaje, orden) values (p_item_oc, p_presupuesto_item, 100, 0);
  -- Si la línea viene de un corte, el corte la conserva al actualizarse.
  if l.corte_item_id is not null then
    update corte_items set presupuesto_item_id = p_presupuesto_item, capitulo_id = v_cap
    where id = l.corte_item_id and presupuesto_item_id is null;
  end if;
  -- Recordar para los próximos cortes (solo si el ítem del contrato aún no tiene código).
  if p_recordar and l.contrato_item_id is not null then
    update contrato_items set presupuesto_item_id = p_presupuesto_item, capitulo_id = v_cap,
           codigo = coalesce(nullif(codigo, ''), v_codigo)
    where id = l.contrato_item_id and presupuesto_item_id is null;
    v_recordado := found;
  end if;
  return jsonb_build_object('ok', true, 'folio', l.folio, 'codigo', v_codigo, 'recordado', v_recordado);
end $$;
revoke all on function public.imputar_linea_oc(uuid, uuid, boolean) from public, anon;
grant execute on function public.imputar_linea_oc(uuid, uuid, boolean) to authenticated, service_role;
