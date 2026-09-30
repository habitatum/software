-- 044 · Amortización exige anticipo válido (PENDIENTE DE APLICAR; se actualiza esta línea al aplicarla)
-- R1: una OC que amortiza (% > 0 o valor fijo > 0) debe tener anticipo enlazado.
-- R2: el anticipo debe existir, ser tipo ANTICIPO, estar VIGENTE y ser de la misma obra,
--     del mismo contratista y, si la OC tiene contrato, del mismo contrato.
-- R3: la amortización no puede superar el saldo del anticipo (sin contar esta misma OC; tolerancia $1).
-- Exentas: OC tipo ANTICIPO, OC ANULADAS y OC con excluir_control = true (decisión B de Andrés).
-- Sin retroactividad: al editar, solo valida si cambió algo que afecte la amortización.

create or replace function public._validar_amortizacion_oc(p_oc uuid, p_completa boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  o record; a record; v_hay_anticipo boolean; v_otros numeric; v_saldo numeric;
begin
  select v.id, v.folio, v.tipo_pago, v.estado, v.proyecto_id, v.proveedor_id, v.contrato_id,
         v.referencia_anticipo_id, v.tipo_amortizacion, v.porcentaje_amortizacion,
         v.valor_amortizacion_manual, v.valor_amortizacion, oc.excluir_control
    into o
  from public.v_ordenes_compra_calculadas v join public.ordenes_compra oc on oc.id = v.id
  where v.id = p_oc;
  if not found then return; end if;
  if o.tipo_pago = 'ANTICIPO' or o.estado = 'ANULADA' or coalesce(o.excluir_control, false) then return; end if;
  if not ((o.tipo_amortizacion = 'VALOR_FIJO' and coalesce(o.valor_amortizacion_manual, 0) > 0)
       or (o.tipo_amortizacion <> 'VALOR_FIJO' and coalesce(o.porcentaje_amortizacion, 0) > 0)) then
    return;
  end if;

  if o.referencia_anticipo_id is null then
    if p_completa then
      raise exception 'AMORTIZACION: La orden % amortiza pero no tiene anticipo enlazado. Elija el anticipo o deje la amortización en 0.',
        coalesce(o.folio, 'nueva');
    end if;
    return;
  end if;

  select v.id, v.folio, v.tipo_pago, v.estado, v.proyecto_id, v.proveedor_id, v.contrato_id, v.total
    into a
  from public.v_ordenes_compra_calculadas v where v.id = o.referencia_anticipo_id;
  v_hay_anticipo := found;

  if p_completa then
    if not v_hay_anticipo then
      raise exception 'AMORTIZACION: El anticipo enlazado no existe.';
    elsif a.tipo_pago <> 'ANTICIPO' then
      raise exception 'AMORTIZACION: La orden % no es un anticipo; elija una orden de tipo Anticipo.', a.folio;
    elsif a.estado = 'ANULADA' then
      raise exception 'AMORTIZACION: El anticipo % está anulado.', a.folio;
    elsif a.proyecto_id is distinct from o.proyecto_id then
      raise exception 'AMORTIZACION: El anticipo % es de otra obra.', a.folio;
    elsif a.proveedor_id is distinct from o.proveedor_id then
      raise exception 'AMORTIZACION: El anticipo % es de otro contratista; la orden solo puede amortizar anticipos de su mismo contratista.', a.folio;
    elsif o.contrato_id is not null and a.contrato_id is distinct from o.contrato_id then
      raise exception 'AMORTIZACION: El anticipo % no es del contrato de esta orden; elija un anticipo del mismo contrato.', a.folio;
    end if;
  end if;
  if not v_hay_anticipo then return; end if;

  select coalesce(sum(valor_amortizacion), 0) into v_otros
  from public.v_ordenes_compra_calculadas
  where referencia_anticipo_id = a.id and estado <> 'ANULADA' and id <> o.id;
  v_saldo := round(a.total - v_otros, 2);

  if coalesce(o.valor_amortizacion, 0) > v_saldo + 1 then
    raise exception 'AMORTIZACION: El anticipo % solo tiene $% por amortizar y esta orden amortiza $%. Ajuste el %% o el monto.',
      a.folio,
      replace(to_char(round(greatest(v_saldo, 0)), 'FM999,999,999,990'), ',', '.'),
      replace(to_char(round(o.valor_amortizacion), 'FM999,999,999,990'), ',', '.');
  end if;
end $$;

create or replace function public.trg_validar_amortizacion_oc()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_amort boolean; v_monto boolean;
begin
  if tg_op = 'INSERT' then
    perform public._validar_amortizacion_oc(new.id, true);
    return null;
  end if;
  v_amort := new.tipo_amortizacion is distinct from old.tipo_amortizacion
          or new.porcentaje_amortizacion is distinct from old.porcentaje_amortizacion
          or new.valor_amortizacion_manual is distinct from old.valor_amortizacion_manual
          or new.referencia_anticipo_id is distinct from old.referencia_anticipo_id
          or new.proveedor_id is distinct from old.proveedor_id
          or new.contrato_id is distinct from old.contrato_id
          or new.proyecto_id is distinct from old.proyecto_id
          or new.tipo_pago is distinct from old.tipo_pago
          or new.excluir_control is distinct from old.excluir_control
          or (old.estado = 'ANULADA' and new.estado <> 'ANULADA');
  v_monto := new.descuento is distinct from old.descuento
          or new.tipo_impuesto is distinct from old.tipo_impuesto
          or new.porcentaje_iva is distinct from old.porcentaje_iva
          or new.porcentaje_administracion is distinct from old.porcentaje_administracion
          or new.porcentaje_imprevistos is distinct from old.porcentaje_imprevistos
          or new.porcentaje_utilidad is distinct from old.porcentaje_utilidad;
  if v_amort then
    perform public._validar_amortizacion_oc(new.id, true);
  elsif v_monto then
    perform public._validar_amortizacion_oc(new.id, false);  -- solo saldo (R3)
  end if;
  return null;
end $$;

create or replace function public.trg_validar_amortizacion_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Con amortización por %, el valor depende de los ítems: se revisa el saldo (R3) al guardarlos.
  perform public._validar_amortizacion_oc(coalesce(new.orden_compra_id, old.orden_compra_id), false);
  return null;
end $$;

drop trigger if exists trg_validar_amortizacion_oc on public.ordenes_compra;
create trigger trg_validar_amortizacion_oc
  after insert or update on public.ordenes_compra
  for each row execute function public.trg_validar_amortizacion_oc();

drop trigger if exists trg_validar_amortizacion_items on public.items_oc;
create trigger trg_validar_amortizacion_items
  after insert or update or delete on public.items_oc
  for each row execute function public.trg_validar_amortizacion_items();

revoke all on function public._validar_amortizacion_oc(uuid, boolean) from public, anon, authenticated;
revoke all on function public.trg_validar_amortizacion_oc() from public, anon, authenticated;
revoke all on function public.trg_validar_amortizacion_items() from public, anon, authenticated;
grant execute on function public._validar_amortizacion_oc(uuid, boolean) to service_role;

-- Alertas: OC vigentes que hoy violan R1/R2 y anticipos sobreamortizados (solo lectura; no bloquea nada).
create or replace view public.v_alertas_amortizacion with (security_invoker = true) as
with oc as (
  select c.*, o.excluir_control
  from public.v_ordenes_compra_calculadas c join public.ordenes_compra o on o.id = c.id
), revisadas as (
  select oc.id as oc_id, oc.folio, oc.proyecto_id, oc.proveedor_id, oc.contrato_id,
         round(oc.valor_amortizacion, 2) as valor_amortizacion, a.folio as anticipo_folio,
         case
           when oc.referencia_anticipo_id is null then 'Amortiza sin anticipo enlazado'
           when a.id is null then 'Anticipo enlazado inexistente'
           when a.tipo_pago <> 'ANTICIPO' then 'La referencia no es un anticipo'
           when a.estado = 'ANULADA' then 'Anticipo anulado'
           when a.proyecto_id is distinct from oc.proyecto_id then 'Anticipo de otra obra'
           when a.proveedor_id is distinct from oc.proveedor_id then 'Anticipo de otro contratista'
           when oc.contrato_id is not null and a.contrato_id is distinct from oc.contrato_id then 'Anticipo de otro contrato'
         end as problema
  from oc left join public.v_ordenes_compra_calculadas a on a.id = oc.referencia_anticipo_id
  where oc.tipo_pago <> 'ANTICIPO' and oc.estado <> 'ANULADA'
    and not coalesce(oc.excluir_control, false) and oc.valor_amortizacion > 0
)
select oc_id, folio, proyecto_id, proveedor_id, contrato_id, valor_amortizacion, anticipo_folio, problema
from revisadas where problema is not null
union all
select a.id, a.folio, a.proyecto_id, a.proveedor_id, a.contrato_id,
       round(-a.saldo_anticipo_por_amortizar, 2), a.folio, 'Anticipo sobreamortizado'
from public.v_ordenes_compra_calculadas a
where a.tipo_pago = 'ANTICIPO' and a.estado <> 'ANULADA' and a.saldo_anticipo_por_amortizar < -1;

revoke all on public.v_alertas_amortizacion from public, anon;
grant select on public.v_alertas_amortizacion to authenticated, service_role;
