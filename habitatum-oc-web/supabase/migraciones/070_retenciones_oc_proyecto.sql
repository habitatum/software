-- 070 · Órdenes de Compra: el pie "Total retenciones" muestra el pendiente por devolver. Pedido del chat 09, 24/10/2026.
-- retenciones_oc_proyecto(proyecto) devuelve, por OC no anulada: retenido (bruto), devuelto (devolución dentro de la OC
-- + subtotal de las OC de devolución 047), descuento al retenido (cortes DEVOLUCION aprobados ligados a esa OC) y si la
-- paga el cliente; más una fila por cada descuento sin OC (paga el cliente si el contrato no tiene OC de HABITATUM).
-- Misma base que retenido_por_devolver_contrato (suma por contratos) y que Caja → Retenidos por devolver (parte HABITATUM).
-- Solo lectura. security invoker: cada usuario ve solo las OC y cortes que ya puede ver (RLS).
create or replace function public.retenciones_oc_proyecto(p_proyecto uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(r), '[]'::jsonb) from (
    select jsonb_build_object('id', v.id, 'contrato_id', v.contrato_id,
             'retenido', coalesce(v.valor_retenido, 0),
             'devuelto', coalesce(v.devolucion_retenido, 0) + case when o.es_devolucion_retenido then coalesce(v.subtotal, 0) else 0 end,
             'descuento', coalesce((select sum(c.descuento_retenido) from cortes c
                                    where c.oc_id = v.id and c.tipo = 'DEVOLUCION' and c.estado = 'APROBADO'), 0),
             'paga_cliente', o.pagado_por_cliente) r
    from v_ordenes_compra_calculadas v join ordenes_compra o on o.id = v.id
    where v.proyecto_id = p_proyecto and v.estado <> 'ANULADA'
    union all
    select jsonb_build_object('id', null, 'contrato_id', c.contrato_id, 'retenido', 0, 'devuelto', 0,
             'descuento', coalesce(c.descuento_retenido, 0),
             'paga_cliente', not exists (select 1 from ordenes_compra x where x.contrato_id = c.contrato_id and x.estado <> 'ANULADA'
                                           and not x.pagado_por_cliente and not x.es_devolucion_retenido))
    from cortes c join contratos k on k.id = c.contrato_id
    where k.proyecto_id = p_proyecto and c.tipo = 'DEVOLUCION' and c.estado = 'APROBADO' and c.oc_id is null
      and coalesce(c.descuento_retenido, 0) <> 0
  ) z;
$$;
revoke all on function public.retenciones_oc_proyecto(uuid) from public, anon;
grant execute on function public.retenciones_oc_proyecto(uuid) to authenticated;
