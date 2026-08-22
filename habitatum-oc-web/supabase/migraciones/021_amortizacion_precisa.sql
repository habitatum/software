-- Reorganiza la Amortización de anticipos en Órdenes de Compra:
--
-- 1) El % de amortización se guardaba en numeric(6,2) -> se truncaba a 2
--    decimales. Se amplía a numeric(9,6) para que cuenten TODOS los
--    decimales que se necesiten (ej. 33.333333%).
-- 2) Se agrega la posibilidad de amortizar con un MONTO FIJO en pesos, en
--    vez de un porcentaje (tipo_amortizacion: 'PORCENTAJE' | 'VALOR_FIJO').
-- 3) Se corrige un error latente en saldo_anticipo_por_amortizar: sumaba
--    también las amortizaciones de OC ya ANULADAS, así que un anticipo podía
--    quedar mostrando menos saldo del que realmente tiene disponible.
--    Ahora las OC anuladas no cuentan como amortización real.
--
-- Con esto, el formulario (ver lib/FormularioOC.js) puede avisar/objetar
-- cuando la amortización de una OC se pasaría del saldo pendiente del
-- anticipo que referencia.

-- ---------- Vistas dependientes: se botan y se vuelven a crear al final ----------
drop view if exists v_presupuesto_ejecutado;
drop view if exists v_acumulados_contrato;
drop view if exists v_ordenes_compra_calculadas;

-- ---------- Columnas nuevas / precisión ----------
alter table ordenes_compra
  alter column porcentaje_amortizacion type numeric(9,6) using porcentaje_amortizacion::numeric(9,6);

do $$ begin
  create type tipo_amortizacion_enum as enum ('PORCENTAJE', 'VALOR_FIJO');
exception when duplicate_object then null; end $$;

alter table ordenes_compra
  add column if not exists tipo_amortizacion tipo_amortizacion_enum not null default 'PORCENTAJE';
alter table ordenes_compra
  add column if not exists valor_amortizacion_manual numeric(14,2) not null default 0;

-- ---------- Recrear v_ordenes_compra_calculadas (con las dos correcciones) ----------
create view v_ordenes_compra_calculadas as
with subtotales as (
  select orden_compra_id, coalesce(sum(cantidad * valor_unitario), 0) as subtotal
  from items_oc
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
    -- tipo_amortizacion = 'VALOR_FIJO'; si no, el % de siempre sobre el total
    -- (ahora con precisión completa, ver alter column arriba).
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
  -- Corrección: una OC anulada no debe seguir "gastando" saldo del anticipo
  -- que amortizaba.
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

-- ---------- Recrear v_presupuesto_ejecutado (versión con prorrateo de IVA/AIU/Descuento, migración 019) ----------
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
