-- Migración 025: permitir hasta 4 decimales en el % de Anticipo
--
-- El campo porcentaje_anticipo (ordenes_compra) se estaba guardando con
-- menos decimales de los necesarios (2), lo que redondeaba el % que
-- representa un anticipo frente al valor del contrato y desajustaba el
-- cálculo del subtotal del anticipo y su amortización.
--
-- Esta migración amplía la columna a numeric(9,4): hasta 5 dígitos
-- enteros y 4 decimales (ej. 33.3333). Los valores existentes no se ven
-- afectados, solo ganan precisión disponible hacia adelante.
--
-- Nota: porcentaje_anticipo es usada por la vista v_ordenes_compra_calculadas,
-- que a su vez alimenta v_acumulados_contrato y v_presupuesto_ejecutado.
-- Postgres no permite alterar el tipo de una columna usada por una vista,
-- así que hay que soltar esas 3 vistas (en orden de dependencia) antes del
-- ALTER, y luego recrearlas exactamente igual que en la migración 024.

drop view if exists v_presupuesto_ejecutado;
drop view if exists v_acumulados_contrato;
drop view if exists v_ordenes_compra_calculadas;

alter table ordenes_compra
  alter column porcentaje_anticipo type numeric(9,4)
  using porcentaje_anticipo::numeric(9,4);

create view v_ordenes_compra_calculadas as
with subtotales_items as (
  select
    orden_compra_id,
    coalesce(sum(cantidad * valor_unitario), 0) as subtotal_items,
    coalesce(sum(case when not sin_iva then cantidad * valor_unitario else 0 end), 0) as subtotal_gravable_items
  from items_oc
  group by orden_compra_id
),
subtotales as (
  select
    si.orden_compra_id,
    si.subtotal_items,
    case
      when oc.tipo_pago = 'ANTICIPO' and coalesce(oc.porcentaje_anticipo, 0) > 0
        then round(si.subtotal_items * oc.porcentaje_anticipo / 100, 2)
      else si.subtotal_items
    end as subtotal,
    case
      when oc.tipo_pago = 'ANTICIPO' and coalesce(oc.porcentaje_anticipo, 0) > 0
        then round(si.subtotal_gravable_items * oc.porcentaje_anticipo / 100, 2)
      else si.subtotal_gravable_items
    end as subtotal_gravable
  from subtotales_items si
  join ordenes_compra oc on oc.id = si.orden_compra_id
),
base as (
  select
    oc.*,
    coalesce(s.subtotal_items, 0) as subtotal_items,
    coalesce(s.subtotal, 0) as subtotal,
    -- El IVA/AIU nunca aplica sobre un Anticipo: se cobra en la orden Normal
    -- que lo amortiza, no en el anticipo mismo.
    case
      when oc.tipo_pago = 'ANTICIPO' then 0
      when oc.tipo_impuesto = 'CON_IVA' then round(coalesce(s.subtotal_gravable, 0) * oc.porcentaje_iva / 100, 2)
      when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * (oc.porcentaje_utilidad / 100) * (oc.porcentaje_iva / 100), 2)
      else 0
    end as valor_iva,
    case
      when oc.tipo_pago = 'ANTICIPO' then 0
      when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_administracion / 100, 2)
      else 0
    end as valor_administracion,
    case
      when oc.tipo_pago = 'ANTICIPO' then 0
      when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_imprevistos / 100, 2)
      else 0
    end as valor_imprevistos,
    case
      when oc.tipo_pago = 'ANTICIPO' then 0
      when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_utilidad / 100, 2)
      else 0
    end as valor_utilidad,
    case
      when oc.tipo_pago = 'ANTICIPO' then 0
      when oc.tipo_impuesto = 'CON_AIU' then (oc.porcentaje_administracion + oc.porcentaje_imprevistos + oc.porcentaje_utilidad)
      else 0
    end as porcentaje_aiu
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

-- ---------- Recrear v_presupuesto_ejecutado (sin cambios de lógica) ----------
create view v_presupuesto_ejecutado as
select
  io.presupuesto_item_id,
  sum(
    (io.cantidad * io.valor_unitario)
    + case
        when coalesce(oc.subtotal_items, 0) <= 0 then 0
        else (io.cantidad * io.valor_unitario) / oc.subtotal_items
          * (coalesce(oc.valor_iva, 0) + coalesce(oc.valor_aiu, 0) - coalesce(oc.descuento, 0))
      end
  ) as ejecutado
from items_oc io
join v_ordenes_compra_calculadas oc on oc.id = io.orden_compra_id
where io.presupuesto_item_id is not null and oc.estado <> 'ANULADA'
group by io.presupuesto_item_id;
