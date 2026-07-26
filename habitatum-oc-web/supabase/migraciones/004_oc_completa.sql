-- Migración: completar Órdenes de Compra al nivel del sistema anterior (Apps Script).
-- 1) Agrega UNIDAD a los ítems.
-- 2) Reescribe v_ordenes_compra_calculadas para que TOTAL, VALOR_AMORTIZACIÓN,
--    VALOR_RETENIDO (sobre el Total, no el subtotal), NETO_A_PAGAR, SALDO y
--    SALDO_ANTICIPO_POR_AMORTIZAR se calculen en SQL — una sola fuente de verdad
--    para el listado, el detalle y el PDF (antes cada pantalla las recalculaba
--    aparte en JavaScript, y el listado y el detalle tenían un bug: usaban el
--    Subtotal en vez del Total).
-- 3) Reescribe v_acumulados_contrato agregando TOTAL_ACUMULADO y AMORTIZADO_ACUMULADO.
-- Ejecutar UNA VEZ en Supabase → SQL Editor → pegar todo → Run.

alter table items_oc add column if not exists unidad text;

drop view if exists v_acumulados_contrato;
drop view if exists v_ordenes_compra_calculadas;

create view v_ordenes_compra_calculadas as
with subtotales as (
  select orden_compra_id, coalesce(sum(cantidad * valor_unitario), 0) as subtotal
  from items_oc
  group by orden_compra_id
),
pagado_por_oc as (
  select orden_compra_id, coalesce(sum(valor), 0) as pagado
  from pagos
  group by orden_compra_id
),
base as (
  select
    oc.*,
    coalesce(s.subtotal, 0) as subtotal,
    case
      when oc.tipo_impuesto = 'CON_IVA' then round(coalesce(s.subtotal, 0) * oc.porcentaje_iva / 100, 2)
      when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * (oc.porcentaje_utilidad / 100) * (oc.porcentaje_iva / 100), 2)
      else 0
    end as valor_iva,
    case when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_administracion / 100, 2) else 0 end as valor_administracion,
    case when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_imprevistos / 100, 2) else 0 end as valor_imprevistos,
    case when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_utilidad / 100, 2) else 0 end as valor_utilidad,
    case when oc.tipo_impuesto = 'CON_AIU' then (oc.porcentaje_administracion + oc.porcentaje_imprevistos + oc.porcentaje_utilidad) else 0 end as porcentaje_aiu,
    coalesce(p.pagado, 0) as pagado
  from ordenes_compra oc
  left join subtotales s on s.orden_compra_id = oc.id
  left join pagado_por_oc p on p.orden_compra_id = oc.id
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
    (case when tipo_pago = 'ANTICIPO' then 0 else round(total * coalesce(porcentaje_amortizacion, 0) / 100, 2) end) as valor_amortizacion,
    round(coalesce(porcentaje_retencion, 0) / 100 * total, 2) as valor_retenido
  from calculado
),
con_neto as (
  select
    con_derivados.*,
    (total - valor_amortizacion - valor_retenido + coalesce(devolucion_retenido, 0)) as neto_a_pagar,
    (total - pagado) as saldo
  from con_derivados
),
amortizado_por_anticipo as (
  select referencia_anticipo_id, sum(valor_amortizacion) as amortizado_total
  from con_neto
  where referencia_anticipo_id is not null
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
