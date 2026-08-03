-- Hasta ahora, "Ejecutado" (por ítem, por capítulo, y el Total Control
-- Presupuestal) solo sumaba cantidad × valor_unitario de cada ítem de OC,
-- sin enterarse de que la Orden de Compra completa después le suma IVA/AIU
-- o le resta un descuento. Eso hacía que, en cualquier proyecto con al menos
-- una OC con IVA o descuento, el Total de Órdenes de Compra NO cuadrara con
-- el Total del Presupuesto (ej. Casa 101: diferencia de $33.903, exactamente
-- el IVA/descuento de 3 OCs que no se estaba reflejando en el presupuesto).
--
-- Solución: cada ítem de una OC ahora "hereda" su parte proporcional del
-- IVA + AIU - Descuento de esa orden, según el peso de ese ítem dentro del
-- subtotal de la orden (la misma proporción que ya se muestra en la columna
-- "% Orden" del detalle de cada OC). Así, la suma de los ítems de una OC
-- siempre coincide exactamente con el Total de esa OC.

create or replace view v_presupuesto_ejecutado as
select
  io.presupuesto_item_id,
  sum(
    (io.cantidad * io.valor_unitario)
    + case
        when coalesce(oc.subtotal, 0) <= 0 then 0
        else (io.cantidad * io.valor_unitario) / oc.subtotal
             * (coalesce(oc.valor_iva, 0) + coalesce(oc.valor_aiu, 0) - coalesce(oc.descuento, 0))
      end
  ) as ejecutado
from items_oc io
join v_ordenes_compra_calculadas oc on oc.id = io.orden_compra_id
where io.presupuesto_item_id is not null and oc.estado <> 'ANULADA'
group by io.presupuesto_item_id;
