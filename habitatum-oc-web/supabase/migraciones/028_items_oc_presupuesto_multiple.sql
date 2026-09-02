-- Migración 028: permite que un ítem de Orden de Compra se impute a VARIOS
-- ítems del presupuesto, discriminado por porcentaje (antes,
-- items_oc.presupuesto_item_id solo permitía vincular a UN ítem al 100%).
--
-- Se crea una tabla puente items_oc_presupuesto (item_oc_id,
-- presupuesto_item_id, porcentaje) que reemplaza a items_oc.presupuesto_item_id
-- como fuente de verdad para todos los cálculos (v_presupuesto_ejecutado,
-- cortes, "Ver" en Presupuesto). La columna items_oc.presupuesto_item_id
-- queda en la tabla sin usarse (no se borra, por si algo externo la
-- necesita), pero el código de la app deja de leerla/escribirla desde ahora.
--
-- Se migran los datos existentes: cada ítem de OC ya vinculado queda con una
-- sola fila al 100%, exactamente el mismo resultado que tenía antes.
--
-- Ejecutar UNA VEZ en Supabase → SQL Editor → pegar todo → Run.

create table items_oc_presupuesto (
  id uuid primary key default gen_random_uuid(),
  item_oc_id uuid not null references items_oc(id) on delete cascade,
  presupuesto_item_id uuid not null references presupuesto_items(id) on delete cascade,
  porcentaje numeric(5,2) not null default 100 check (porcentaje > 0),
  orden int not null default 0
);
create index items_oc_presupuesto_item_oc_id_idx on items_oc_presupuesto(item_oc_id);
create index items_oc_presupuesto_presupuesto_item_id_idx on items_oc_presupuesto(presupuesto_item_id);

alter table items_oc_presupuesto enable row level security;
create policy "lectura_general_items_oc_presupuesto" on items_oc_presupuesto for select using (auth.uid() is not null);
create policy "escritura_items_oc_presupuesto" on items_oc_presupuesto for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));

-- Migra lo ya vinculado: una fila al 100% por cada ítem de OC con presupuesto_item_id.
insert into items_oc_presupuesto (item_oc_id, presupuesto_item_id, porcentaje)
select id, presupuesto_item_id, 100
from items_oc
where presupuesto_item_id is not null;

-- v_presupuesto_ejecutado ahora se arma desde items_oc_presupuesto,
-- prorrateando por porcentaje (antes se armaba directo desde
-- items_oc.presupuesto_item_id, siempre al 100%). La fórmula de IVA/AIU/
-- descuento/retención neta prorrateada es exactamente la misma que ya
-- existía (migración 026); solo cambia la fuente (join con la tabla puente)
-- y se multiplica el resultado por (porcentaje / 100).
create or replace view v_presupuesto_ejecutado as
select
  iop.presupuesto_item_id,
  sum(
    (
      (io.cantidad * io.valor_unitario)
      + case
          when coalesce(oc.subtotal_items, 0) <= 0 then 0
          else (io.cantidad * io.valor_unitario) / oc.subtotal_items
            * (
                coalesce(oc.valor_iva, 0) + coalesce(oc.valor_aiu, 0) - coalesce(oc.descuento, 0)
                - (coalesce(oc.valor_retenido, 0) - coalesce(oc.devolucion_retenido, 0))
              )
        end
    ) * (iop.porcentaje / 100)
  ) as ejecutado
from items_oc_presupuesto iop
join items_oc io on io.id = iop.item_oc_id
join v_ordenes_compra_calculadas oc on oc.id = io.orden_compra_id
where oc.estado <> 'ANULADA'
group by iop.presupuesto_item_id;
