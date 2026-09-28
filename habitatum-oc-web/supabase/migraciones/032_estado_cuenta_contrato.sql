-- Función que arma el Estado de cuenta de un contrato (usada por /api/contratos/[id]/estado-cuenta).
-- Devuelve un JSON con: contrato, proyecto, contratista, movimientos (OC vigentes), totales,
-- saldos y alertas (SOBREEJECUCION, PLAZO_VENCIDO_CON_SALDO, EJECUCION_POSTERIOR_AL_PLAZO,
-- SIN_GARANTIA, ANTICIPO_PENDIENTE, RETENIDO_PENDIENTE_DEVOLUCION).
-- Toda OC se asume pagada desde que se crea (migración 006): "girado" = suma de netos a pagar.
create or replace function public.estado_cuenta_contrato(p_contrato_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
with c as (
  select c.*,
    case
      when c.plazo_valor ~ '^\d+$' and c.plazo_unidad ilike 'd%' then c.fecha_inicio + c.plazo_valor::int
      when c.plazo_valor ~ '^\d+$' and c.plazo_unidad ilike 'mes%' then (c.fecha_inicio + (c.plazo_valor||' months')::interval)::date
      when c.plazo_valor ~ '^\d+$' and c.plazo_unidad ilike 'sem%' then c.fecha_inicio + c.plazo_valor::int*7
    end as fecha_fin
  from contratos c where c.id = p_contrato_id
),
mov as (
  select v.id, v.folio, v.fecha, v.tipo_pago, v.descripcion, v.notas,
    case when v.tipo_pago='ANTICIPO' then 0 else round(v.subtotal,2) end ejecutado,
    case when v.tipo_pago='ANTICIPO' then round(v.subtotal,2) else 0 end anticipo,
    round(coalesce(v.valor_amortizacion,0),2) amortizacion,
    round(coalesce(v.valor_retenido,0),2) retencion,
    round(coalesce(v.devolucion_retenido,0),2) devolucion,
    round(coalesce(v.descuento,0),2) descuento,
    round(coalesce(v.valor_iva,0)+coalesce(v.valor_aiu,0),2) impuestos,
    round(v.neto_a_pagar,2) neto
  from v_ordenes_compra_calculadas v
  where v.contrato_id = p_contrato_id and v.estado='VIGENTE'
),
t as (
  select coalesce(sum(ejecutado),0) ejecutado, coalesce(sum(anticipo),0) anticipo, coalesce(sum(amortizacion),0) amortizacion,
         coalesce(sum(retencion),0) retencion, coalesce(sum(devolucion),0) devolucion, coalesce(sum(neto),0) neto,
         coalesce(sum(descuento),0) descuento, coalesce(sum(impuestos),0) impuestos, count(*) n_ocs, max(fecha) ultima_oc
  from mov
)
select jsonb_build_object(
  'generado_en', now(),
  'contrato', jsonb_build_object('id',c.id,'numero',c.numero_contrato,'concepto',c.concepto,'alcance',c.alcance_detallado,'tipo',c.tipo_contrato,
     'valor',c.valor_inicial,'fecha_contrato',c.fecha_contrato,'fecha_inicio',c.fecha_inicio,'plazo_valor',c.plazo_valor,'plazo_unidad',c.plazo_unidad,
     'fecha_fin',c.fecha_fin,'garantia_meses',c.garantia_meses,'estado',c.estado),
  'proyecto', (select jsonb_build_object('nombre',p.nombre,'codigo',p.codigo,'cliente',p.cliente,'direccion',p.direccion_obra,'ciudad',p.ciudad,
     'emisor',p.nombre_emisor,'nit_emisor',p.nit_empresa,'representante',p.representante_legal,'telefono',p.telefono_empresa,'marca_habitatum',p.mostrar_marca_habitatum)
     from proyectos p where p.id=c.proyecto_id),
  'contratista', (select jsonb_build_object('nombre',pr.nombre,'nit',pr.nit,'banco',pr.banco,'tipo_cuenta',pr.tipo_cuenta,'numero_cuenta',pr.numero_cuenta,'telefono',pr.telefono)
     from proveedores pr where pr.id=c.contratista_id),
  'movimientos', coalesce((select jsonb_agg(to_jsonb(m) - 'id' order by m.fecha, m.folio) from mov m),'[]'::jsonb),
  'totales', to_jsonb(t),
  'saldos', jsonb_build_object(
     'porcentaje_ejecucion', case when c.valor_inicial>0 then round(t.ejecutado/c.valor_inicial*100,2) else 0 end,
     'por_ejecutar', greatest(c.valor_inicial - t.ejecutado,0),
     'sobre_ejecucion', greatest(t.ejecutado - c.valor_inicial,0),
     'anticipo_por_amortizar', round(t.anticipo - t.amortizacion,2),
     'retenido_por_devolver', round(t.retencion - t.devolucion,2),
     'girado_neto', t.neto),
  'alertas', to_jsonb(array_remove(array[
     case when t.ejecutado > c.valor_inicial then 'SOBREEJECUCION' end,
     case when c.fecha_fin is not null and c.fecha_fin < current_date and t.ejecutado < c.valor_inicial then 'PLAZO_VENCIDO_CON_SALDO' end,
     case when c.fecha_fin is not null and t.ultima_oc > c.fecha_fin then 'EJECUCION_POSTERIOR_AL_PLAZO' end,
     case when coalesce(nullif(c.garantia_meses,''),'0') in ('0','') then 'SIN_GARANTIA' end,
     case when round(t.anticipo - t.amortizacion,2) > 1 then 'ANTICIPO_PENDIENTE' end,
     case when round(t.retencion - t.devolucion,2) > 0 then 'RETENIDO_PENDIENTE_DEVOLUCION' end
  ], null))
)
from c, t;
$fn$;
grant execute on function public.estado_cuenta_contrato(uuid) to authenticated, service_role;
