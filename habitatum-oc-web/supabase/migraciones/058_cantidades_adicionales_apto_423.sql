-- 058 · Apto 423: unidad, cantidad y valor unitario de los adicionales (cap. 13 y 14) según el cuadro de Andrés.
-- NO cambia ningún valor parcial: unitario = valor parcial de la app / cantidad (costo = venta, sin utilidad).
-- 13.01 y 13.02 se dejan como están (13.01 neto global). 13.07: 5 Un con el valor de la app ($542.676).
with d(codigo, u, q) as (values ('13.03','Un',9),('13.04','Un',13),('13.05','Un',2),('13.06','Un',1),('13.07','Un',5),
  ('14.01','Un',3),('14.02','Un',4),('14.03','Un',1),('14.04','Un',1),('14.05','Un',2),('14.06','Un',1)),
it as (select i.id, d.u, d.q::numeric q, i.valor_parcial / d.q vu from presupuesto_items i
  join presupuesto_capitulos c on c.id=i.capitulo_id join presupuestos pr on pr.id=c.presupuesto_id
  join proyectos p on p.id=pr.proyecto_id join d on d.codigo=i.codigo
  where p.nombre='Apto 423' and c.codigo in ('13','14')),
u1 as (update presupuesto_items i set unidad=it.u, cantidad=it.q, valor_unitario=round(it.vu,2) from it where i.id=it.id returning i.id)
update presupuesto_items_costo k set valor_unitario_costo=round(it.vu,2) from it where k.presupuesto_item_id=it.id;
