-- Migración 026: "Ejecutado (ítems)" del presupuesto queda neto de retención
--
-- Antes, v_presupuesto_ejecutado prorrateaba por ítem el IVA + AIU - descuento
-- de cada orden, pero no tocaba la retención. Eso hacía que "Ejecutado (ítems)"
-- y "Saldo" en la pestaña de Presupuesto mostraran un valor que no corresponde
-- a lo realmente comprometido/pagado (la retención es plata que el cliente
-- todavía no ha desembolsado).
--
-- Esta migración prorratea también la retención neta (valor_retenido menos
-- lo ya devuelto) de cada orden entre sus ítems, igual que ya se hacía con
-- IVA/AIU/descuento. No depende de otras vistas ni tiene vistas dependientes,
-- así que basta con reemplazarla directamente.

create or replace view v_presupuesto_ejecutado as
select
  io.presupuesto_item_id,
  sum(
    (io.cantidad * io.valor_unitario)
    + case
        when coalesce(oc.subtotal_items, 0) <= 0 then 0
        else (io.cantidad * io.valor_unitario) / oc.subtotal_items
          * (
              coalesce(oc.valor_iva, 0) + coalesce(oc.valor_aiu, 0) - coalesce(oc.descuento, 0)
              - (coalesce(oc.valor_retenido, 0) - coalesce(oc.devolucion_retenido, 0))
            )
      end
  ) as ejecutado
from items_oc io
join v_ordenes_compra_calculadas oc on oc.id = io.orden_compra_id
where io.presupuesto_item_id is not null and oc.estado <> 'ANULADA'
group by io.presupuesto_item_id;
