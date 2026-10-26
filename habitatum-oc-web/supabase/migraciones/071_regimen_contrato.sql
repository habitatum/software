-- 071 · Régimen de impuestos en el contrato (aprobado por Andrés el 25/10/2026).
-- El contrato guarda su régimen: SIN_DISCRIMINAR (contratos anteriores: ítems a precio final, OC sin IVA, como hasta hoy),
-- SIN_IVA, IVA, AIU (IVA solo sobre la U) o IVA_UTILIDAD (IVA sobre la base gravable = %U × subtotal), con sus %.
-- Con un régimen que discrimina, los ítems y el valor del contrato (valor_inicial) van ANTES de impuestos, exactos
-- como la cotización, y cada corte genera su OC con el impuesto del contrato. Reglas:
--   · Anticipo: % del valor antes de IVA y sin impuestos (un anticipo no se factura) — ya era así.
--   · Amortización: sobre el subtotal del corte (antes de impuestos) — ya era así en aprobar_corte.
--   · Retención de garantía de las OC de cortes: sobre el subtotal antes de impuestos (ordenes_compra.
--     retencion_sobre_subtotal = true, igual que cortes.valor_retencion). Las OC existentes no cambian.
--   · El régimen no se puede cambiar cuando el contrato ya tiene cortes de obra aprobados.
--   · El documento del contrato toma el régimen del contrato (si no es SIN_DISCRIMINAR).
-- Corrige los dos contratos de Servitodo (sin cortes): 06-2026-01 vuelve a los precios aprobados sin IVA (valor
-- $100.396.584; total con IVA igual, $101.350.352) y 02-2026-05 queda en IVA sobre la utilidad 5 % × 19 %.

alter table public.contratos
  add column if not exists regimen_impuesto text not null default 'SIN_DISCRIMINAR'
    check (regimen_impuesto in ('SIN_DISCRIMINAR', 'SIN_IVA', 'IVA', 'AIU', 'IVA_UTILIDAD')),
  add column if not exists pct_a numeric not null default 0,
  add column if not exists pct_i numeric not null default 0,
  add column if not exists pct_u numeric not null default 0,
  add column if not exists pct_iva numeric not null default 19;
alter table public.ordenes_compra add column if not exists retencion_sobre_subtotal boolean not null default false;

-- Tipo de OC según el régimen del contrato.
create or replace function public._tipo_oc_regimen(p_regimen text)
returns public.tipo_impuesto_enum language sql immutable set search_path = public as $$
  select (case p_regimen when 'IVA' then 'CON_IVA' when 'AIU' then 'CON_AIU' when 'IVA_UTILIDAD' then 'CON_IVA_UTILIDAD'
               else 'SIN_IVA' end)::public.tipo_impuesto_enum;
$$;
-- Impuestos (A+I+U+IVA) de una base, con el mismo redondeo de v_ordenes_compra_calculadas.
create or replace function public._impuestos_regimen(p_regimen text, p_a numeric, p_i numeric, p_u numeric, p_iva numeric, p_base numeric)
returns numeric language sql immutable set search_path = public as $$
  select case p_regimen
    when 'IVA' then round(p_base * p_iva / 100, 2)
    when 'AIU' then round(p_base * p_a / 100, 2) + round(p_base * p_i / 100, 2) + round(p_base * p_u / 100, 2)
                    + round(p_base * (p_u / 100) * (p_iva / 100), 2)
    when 'IVA_UTILIDAD' then round(p_base * (p_u / 100) * (p_iva / 100), 2)
    else 0 end;
$$;
revoke all on function public._tipo_oc_regimen(text) from public, anon, authenticated;
revoke all on function public._impuestos_regimen(text, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- El régimen no cambia con cortes de obra aprobados (descuadraría las OC ya generadas).
create or replace function public.trg_regimen_contrato() returns trigger language plpgsql set search_path = public as $$
begin
  if (new.regimen_impuesto, new.pct_a, new.pct_i, new.pct_u, new.pct_iva) is distinct from
     (old.regimen_impuesto, old.pct_a, old.pct_i, old.pct_u, old.pct_iva)
     and exists (select 1 from cortes c where c.contrato_id = new.id and c.estado = 'APROBADO' and coalesce(c.tipo, 'OBRA') <> 'DEVOLUCION') then
    raise exception 'El contrato % ya tiene cortes aprobados: su régimen de impuestos no se puede cambiar.', new.numero_contrato;
  end if;
  return new;
end $$;
drop trigger if exists regimen_contrato on public.contratos;
create trigger regimen_contrato before update on public.contratos for each row execute function public.trg_regimen_contrato();

-- Vista de cálculo de las OC: CON_IVA_UTILIDAD y retención sobre el subtotal cuando la OC lo pide.
do $do$
declare v text; a text; b text;
begin
  v := pg_get_viewdef('public.v_ordenes_compra_calculadas'::regclass, true);
  a := $x$WHEN oc.tipo_impuesto = 'CON_AIU'::tipo_impuesto_enum THEN round((COALESCE(s.subtotal, 0::numeric) - COALESCE(oc.descuento, 0::numeric)) * (oc.porcentaje_utilidad / 100::numeric) * (oc.porcentaje_iva / 100::numeric), 2)$x$;
  b := $x$WHEN oc.tipo_impuesto = ANY (ARRAY['CON_AIU'::tipo_impuesto_enum, 'CON_IVA_UTILIDAD'::tipo_impuesto_enum]) THEN round((COALESCE(s.subtotal, 0::numeric) - COALESCE(oc.descuento, 0::numeric)) * (oc.porcentaje_utilidad / 100::numeric) * (oc.porcentaje_iva / 100::numeric), 2)$x$;
  if position(a in v) = 0 then raise exception '071: no se encontró el IVA de AIU en la vista'; end if;
  v := replace(v, a, b);
  a := $x$round(COALESCE(calculado.porcentaje_retencion, 0::numeric) / 100::numeric * calculado.total, 2) AS valor_retenido$x$;
  b := $x$round(COALESCE(calculado.porcentaje_retencion, 0::numeric) / 100::numeric * CASE WHEN (SELECT x.retencion_sobre_subtotal FROM ordenes_compra x WHERE x.id = calculado.id) THEN calculado.subtotal - calculado.descuento ELSE calculado.total END, 2) AS valor_retenido$x$;
  if position(a in v) = 0 then raise exception '071: no se encontró la retención en la vista'; end if;
  v := replace(v, a, b);
  execute 'create or replace view public.v_ordenes_compra_calculadas with (security_invoker = true) as ' || v;
end $do$;

-- aprobar_corte: la OC del corte toma el régimen del contrato y retiene sobre el subtotal.
do $do$
declare d text; a text;
begin
  d := pg_get_functiondef('public.aprobar_corte(uuid)'::regprocedure);
  a := 'responsable, descuento, tipo_impuesto, porcentaje_iva, porcentaje_retencion, devolucion_retenido, notas, proyecto_id, origen)';
  if position(a in d) = 0 then raise exception '071: aprobar_corte (columnas)'; end if;
  d := replace(d, a, 'responsable, descuento, tipo_impuesto, porcentaje_iva, porcentaje_retencion, devolucion_retenido, notas, proyecto_id, origen,'
                     || ' porcentaje_administracion, porcentaje_imprevistos, porcentaje_utilidad, retencion_sobre_subtotal)');
  a := $x$'SIN_IVA', 19, c.porcentaje_retencion$x$;
  if position(a in d) = 0 then raise exception '071: aprobar_corte (impuesto)'; end if;
  d := replace(d, a, $x$public._tipo_oc_regimen(k.regimen_impuesto), coalesce(k.pct_iva, 19), c.porcentaje_retencion$x$);
  a := $x$k.proyecto_id, 'CORTE')$x$;
  if position(a in d) = 0 then raise exception '071: aprobar_corte (valores)'; end if;
  d := replace(d, a, $x$k.proyecto_id, 'CORTE',
      case when k.regimen_impuesto = 'AIU' then k.pct_a else 0 end, case when k.regimen_impuesto = 'AIU' then k.pct_i else 0 end,
      case when k.regimen_impuesto in ('AIU', 'IVA_UTILIDAD') then k.pct_u else 0 end, true)$x$);
  execute d;
end $do$;

-- actualizar_corte: si no se actualiza la OC, el neto del corte suma los impuestos del régimen.
do $do$
declare d text; a text;
begin
  d := pg_get_functiondef('public.actualizar_corte(uuid, boolean)'::regprocedure);
  a := 'v_neto := round(v_sub - c.descuento - v_ret - v_amort, 2);';
  if position(a in d) = 0 then raise exception '071: actualizar_corte'; end if;
  d := replace(d, a, 'v_neto := round(v_sub - c.descuento - v_ret - v_amort'
      || ' + public._impuestos_regimen(k.regimen_impuesto, k.pct_a, k.pct_i, k.pct_u, k.pct_iva, v_sub - c.descuento), 2);');
  execute d;
end $do$;

-- Documento del contrato: lee el régimen del contrato y, si discrimina, lo impone al guardar.
do $do$
declare d text; a text;
begin
  d := pg_get_functiondef('public.documento_contrato_datos(uuid)'::regprocedure);
  a := $x$'garantia_meses', c.garantia_meses)$x$;
  if position(a in d) = 0 then raise exception '071: documento_contrato_datos'; end if;
  d := replace(d, a, $x$'garantia_meses', c.garantia_meses, 'regimen_impuesto', c.regimen_impuesto,
        'pct_a', c.pct_a, 'pct_i', c.pct_i, 'pct_u', c.pct_u, 'pct_iva', c.pct_iva)$x$);
  execute d;

  d := pg_get_functiondef('public.guardar_documento_contrato(uuid, jsonb)'::regprocedure);
  a := $x$      coalesce(p_datos->>'regimen', 'SIN_IVA'),
      coalesce((p_datos->>'pct_a')::numeric, 0), coalesce((p_datos->>'pct_i')::numeric, 0),
      coalesce((p_datos->>'pct_u')::numeric, 0), coalesce((p_datos->>'pct_iva')::numeric, 19),$x$;
  if position(a in d) = 0 then raise exception '071: guardar_documento_contrato (régimen)'; end if;
  d := replace(d, a, $x$      case when c.regimen_impuesto <> 'SIN_DISCRIMINAR' then c.regimen_impuesto else coalesce(p_datos->>'regimen', 'SIN_IVA') end,
      case when c.regimen_impuesto <> 'SIN_DISCRIMINAR' then c.pct_a else coalesce((p_datos->>'pct_a')::numeric, 0) end,
      case when c.regimen_impuesto <> 'SIN_DISCRIMINAR' then c.pct_i else coalesce((p_datos->>'pct_i')::numeric, 0) end,
      case when c.regimen_impuesto <> 'SIN_DISCRIMINAR' then c.pct_u else coalesce((p_datos->>'pct_u')::numeric, 0) end,
      case when c.regimen_impuesto <> 'SIN_DISCRIMINAR' then c.pct_iva else coalesce((p_datos->>'pct_iva')::numeric, 19) end,$x$);
  a := $x$      coalesce((p_datos->>'precios_con_iva')::boolean, false), coalesce(p_datos->'anexos_integrales', '[]'::jsonb),$x$;
  if position(a in d) = 0 then raise exception '071: guardar_documento_contrato (precios)'; end if;
  d := replace(d, a, $x$      c.regimen_impuesto = 'SIN_DISCRIMINAR' and coalesce((p_datos->>'precios_con_iva')::boolean, false), coalesce(p_datos->'anexos_integrales', '[]'::jsonb),$x$);
  execute d;
end $do$;

-- Corrección de los contratos de Servitodo (sin cortes; totales verificados antes y después).
do $do$
declare v_antes numeric; v_despues numeric; k06 uuid := '10d3c50e-c491-4a10-8059-921ed045bf91'; k02 uuid;
begin
  if exists (select 1 from cortes where contrato_id = k06) then raise exception '071: el 06-2026-01 ya tiene cortes'; end if;
  select round(sum(cantidad * valor_unitario)) into v_antes from contrato_items where contrato_id = k06 and not es_adicional;
  update contrato_items set valor_unitario = round(valor_unitario / 1.0095, 2) where contrato_id = k06 and not es_adicional;
  update contratos set valor_inicial = 100396584, regimen_impuesto = 'IVA_UTILIDAD', pct_u = 5, pct_iva = 19 where id = k06;
  select sum(cantidad * valor_unitario) + public._impuestos_regimen('IVA_UTILIDAD', 0, 0, 5, 19, sum(cantidad * valor_unitario))
    into v_despues from contrato_items where contrato_id = k06 and not es_adicional;
  if v_antes <> 101350352 or round(v_despues) <> 101350352
     or (select sum(cantidad * valor_unitario) from contrato_items where contrato_id = k06 and not es_adicional) <> 100396584 then
    raise exception '071: 06-2026-01 no cuadra (antes %, después %)', v_antes, v_despues;
  end if;
  select id into k02 from contratos where numero_contrato = '02-2026-05';
  if exists (select 1 from cortes where contrato_id = k02) then raise exception '071: el 02-2026-05 ya tiene cortes'; end if;
  update contratos set regimen_impuesto = 'IVA_UTILIDAD', pct_u = 5, pct_iva = 19 where id = k02;
end $do$;
