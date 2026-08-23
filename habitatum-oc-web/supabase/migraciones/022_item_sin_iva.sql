-- Permite marcar un ítem de una Orden de Compra como "Sin IVA" (por ejemplo
-- "Transporte sin IVA": muchas ferreterías no gravan el transporte con IVA).
-- Un ítem marcado sin_iva sigue sumando normalmente al Subtotal y al Total
-- de la orden, pero su valor NO cuenta dentro de la base sobre la que se
-- calcula el IVA cuando la orden es tipo_impuesto = 'CON_IVA'.
--
-- El botón "+ Agregar Transporte sin IVA" (ver lib/FormularioOC.js) agrega
-- este ítem por defecto en cualquier proyecto, sin necesidad de crearlo en
-- el catálogo de presupuesto de cada obra.

-- ---------- Vistas dependientes: se botan y se vuelven a crear al final ----------
drop view if exists v_presupuesto_ejecutado;
drop view if exists v_acumulados_contrato;
drop view if exists v_ordenes_compra_calculadas;

-- ---------- Columna nueva ----------
alter table items_oc
add column if not exists sin_iva boolean not null default false;

-- ---------- Recrear v_ordenes_compra_calculadas (IVA solo sobre lo gravable) ----------
create view v_ordenes_compra_calculadas as
with subtotales as (
  select
    orden_compra_id,
    coalesce(sum(cantidad * valor_unitario), 0) as subtotal,
    -- Subtotal gravable: excluye los ítems marcados sin_iva (ej. Transporte).
    coalesce(sum(case when not sin_iva then cantidad * valor_unitario else 0 end), 0) as subtotal_gravable
  from items_oc
  group by orden_compra_id
),
base as (
  select
    oc.*,
    coalesce(s.subtotal, 0) as subtotal,
    case
      when oc.tipo_impuesto = 'CON_IVA' then round(coalesce(s.subtotal_gravable, 0) * oc.porcentaje_iva / 100, 2)
      when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * (oc.porcentaje_utilidad / 100) * (oc.porcentaje_iva / 100), 2)
      else 0
    end as valor_iva,
    case when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_administracion / 100, 2) else 0 end as valor_administracion,
    case when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_imprevistos / 100, 2) else 0 end as valor_imprevistos,
    case when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_utilidad / 100, 2) else 0 end as valor_utilidad,
    case when oc.tipo_impuesto = 'CON_AIU' then (oc.porcentaje_administracion + oc.porcentaje_imprevistos + oc.porcentaje_utilidad) else 0 end as porcentaje_aiu
  from ordenes_compra oc
  left join subtotales s on s.orden_compra_id = oc.id
),
calculado as (
  select
    base.*,
    (case when tipo_impuesto = 'CON_AIU' then valor_administracion + valor_imprevistos + valor_utilidad else 0 end) as valor_aiu,
    (subtotal - descuento + valor_iva
      + (case when tipo_impuesto = 'CON_AIU' then valor_administracion + valor_imprevistos + valor_utilidad else 0 end)
    ) as total
  from base
),
con_derivados as (
  select
    calculado.*,
    -- Amortización: 0 si es el propio Anticipo; monto fijo si
    -- tipo_amortizacion = 'VALOR_FIJO'; si no, el % de siempre sobre el total.
    (case
      when tipo_pago = 'ANTICIPO' then 0
      when tipo_amortizacion = 'VALOR_FIJO' then round(coalesce(valor_amortizacion_manual, 0), 2)
      else round(total * coalesce(porcentaje_amortizacion, 0) / 100, 2)
    end) as valor_amortizacion,
    round(coalesce(porcentaje_retencion, 0) / 100 * total, 2) as valor_retenido
  from calculado
),
con_neto as (
  select
    con_derivados.*,
    (total - valor_amortizacion - valor_retenido + coalesce(devolucion_retenido, 0)) as neto_a_pagar,
    total as pagado,
    0::numeric as saldo
  from con_derivados
),
amortizado_por_anticipo as (
  select referencia_anticipo_id, sum(valor_amortizacion) as amortizado_total
  from con_neto
  where referencia_anticipo_id is not null and estado <> 'ANULADA'
  group by referencia_anticipo_id
)
select
  con_neto.*,
  case when con_neto.tipo_pago = 'ANTICIPO'
    then round(con_neto.total - coalesce(amortizado_por_anticipo.amortizado_total, 0), 2)
    else null
  end as saldo_anticipo_por_amortizar
from con_neto
left join amortizado_por_anticipo on amortizado_por_anticipo.referencia_anticipo_id = con_neto.id;

-- ---------- Recrear v_acumulados_contrato (sin cambios de lógica) ----------
create view v_acumulados_contrato as
select
  contrato_id,
  sum(case when tipo_pago <> 'ANTICIPO' then subtotal else 0 end) as subtotal_acumulado,
  sum(case when tipo_pago <> 'ANTICIPO' then total else 0 end) as total_acumulado,
  sum(valor_retenido) as retenido_acumulado,
  sum(valor_amortizacion) as amortizado_acumulado,
  sum(devolucion_retenido) as devolucion_acumulada
from v_ordenes_compra_calculadas
where contrato_id is not null and estado <> 'ANULADA'
group by contrato_id;

-- ---------- Recrear v_presupuesto_ejecutado (sin cambios de lógica, migración 019) ----------
create view v_presupuesto_ejecutado as
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
