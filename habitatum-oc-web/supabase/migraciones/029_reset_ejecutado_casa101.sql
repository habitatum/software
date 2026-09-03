-- Reinicia a $0 el "Ejecutado" del Control Presupuestal de Casa 101.
--
-- Borra ÚNICAMENTE las imputaciones (vínculos con %) entre los ítems de
-- Órdenes de Compra de Casa 101 y los ítems del presupuesto de Casa 101,
-- en la tabla puente items_oc_presupuesto (creada en la migración 028).
--
-- NO borra: las Órdenes de Compra, sus ítems, ni el presupuesto. Solo el
-- vínculo. Después de correr esto, todo el presupuesto de Casa 101 queda
-- con Ejecutado = $0, y hay que volver a imputar cada ítem de cada Orden
-- de Compra desde el botón "Imputar al presupuesto" en cada OC (nueva o
-- editar).
--
-- Los demás proyectos NO se tocan.

-- 1) Antes de borrar, corre este SELECT para confirmar cuántas filas se
--    van a borrar (el número de imputaciones que hay hoy en Casa 101):
--
-- select count(*)
-- from items_oc_presupuesto iop
-- join items_oc io on io.id = iop.item_oc_id
-- join ordenes_compra oc on oc.id = io.orden_compra_id
-- join proyectos p on p.id = oc.proyecto_id
-- where p.nombre = 'Casa 101';

-- 2) Si el número tiene sentido, corre este DELETE
--    (Supabase → SQL Editor → pegar todo → Run):

delete from items_oc_presupuesto
where item_oc_id in (
  select io.id
  from items_oc io
  join ordenes_compra oc on oc.id = io.orden_compra_id
  join proyectos p on p.id = oc.proyecto_id
  where p.nombre = 'Casa 101'
);
