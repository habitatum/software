-- 083 · Cortes de cobro de administración por Órdenes de Compra (28/11/2026)
-- Administración delegada sin presupuesto (o como alternativa): la administración se cobra sobre el A Pagar
-- (neto_a_pagar) de las OC, por cortes numerados. El corte en curso es virtual (cobro_corte_en_curso); cerrar
-- (solo admin) lo congela en cobro_cortes / cobro_corte_ocs y nunca cambia. Una OC ya cobrada que cambie de
-- valor o se anule entra como AJUSTE (diferencia) en el corte en curso: Σ cortes = A Pagar vivo, al peso.
-- Las OC cobradas quedan con el blindaje de la 046 (_corte_cerrado_de_oc → 🔒 y "Corregir con ajuste").
-- Un solo método por obra: si la obra ya tiene cortes del control presupuestal no se cierran cortes por OC, y al revés.

create table if not exists public.cobro_cortes (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id),
  numero integer not null,
  fecha_corte date not null,
  estado text not null default 'CERRADO' check (estado in ('CERRADO')),
  pct_administracion numeric(6,3) not null,
  total_ocs numeric(16,2) not null default 0,
  base numeric(16,2) not null,
  valor_administracion numeric(16,2) not null,
  notas text,
  cerrado_por uuid default auth.uid(),
  cerrado_en timestamptz not null default now(),
  unique (proyecto_id, numero)
);
create table if not exists public.cobro_corte_ocs (
  id uuid primary key default gen_random_uuid(),
  corte_id uuid not null references public.cobro_cortes(id),
  orden_compra_id uuid not null references public.ordenes_compra(id),
  tipo text not null check (tipo in ('NUEVO', 'AJUSTE')),
  folio text, fecha date, contrato text, proveedor text, concepto text,
  total numeric(16,2) not null default 0,
  a_pagar numeric(16,2) not null,
  tipo_pago text, estado_oc text,
  corte_origen integer,
  motivo text
);
create index if not exists cobro_corte_ocs_oc_idx on public.cobro_corte_ocs (orden_compra_id);
create index if not exists cobro_corte_ocs_corte_idx on public.cobro_corte_ocs (corte_id);
alter table public.cobro_cortes enable row level security;
alter table public.cobro_corte_ocs enable row level security;
create policy cobro_cortes_admin on public.cobro_cortes for select using (public.es_admin());
create policy cobro_corte_ocs_admin on public.cobro_corte_ocs for select using (public.es_admin());
revoke all on public.cobro_cortes, public.cobro_corte_ocs from anon, authenticated;
grant select on public.cobro_cortes, public.cobro_corte_ocs to authenticated;

-- Blindaje 046: una OC en un corte de cobro por OC cerrado también queda "en corte cerrado".
create or replace function public._corte_cerrado_de_oc(p_oc uuid)
returns integer language sql stable security definer set search_path to 'public'
as $function$
  select min(n) from (
    select c.numero n from public.presupuesto_corte_ocs co join public.presupuesto_cortes c on c.id = co.corte_id
     where co.orden_compra_id = p_oc and c.estado = 'CERRADO'
    union all
    select c.numero from public.cobro_corte_ocs co join public.cobro_cortes c on c.id = co.corte_id
     where co.orden_compra_id = p_oc) z;
$function$;

create or replace view public.v_oc_corte_cerrado as
  select orden_compra_id, min(corte_numero) corte_numero,
         array_agg(distinct item_oc_id) filter (where item_oc_id is not null) item_oc_ids
  from (
    select co.orden_compra_id, c.numero corte_numero, co.item_oc_id
      from public.presupuesto_corte_ocs co join public.presupuesto_cortes c on c.id = co.corte_id
     where c.estado = 'CERRADO' and co.orden_compra_id is not null
    union all
    select co.orden_compra_id, c.numero, io.id
      from public.cobro_corte_ocs co join public.cobro_cortes c on c.id = co.corte_id
      left join public.items_oc io on io.orden_compra_id = co.orden_compra_id
  ) z
  group by orden_compra_id;

create or replace function public.cobro_corte_en_curso(p_proyecto uuid, p_fecha date default null)
returns table(tipo text, orden_compra_id uuid, folio text, fecha date, contrato text, proveedor text, concepto text,
              total numeric, a_pagar numeric, tipo_pago text, estado_oc text, corte_origen integer, motivo text)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not public.es_admin() then raise exception 'Solo un administrador puede ver los cortes de cobro.'; end if;
  return query
  with cobradas as (
    select co.orden_compra_id, sum(co.a_pagar) cobrado, min(c.numero) corte_origen, max(c.cerrado_en) ult
      from public.cobro_corte_ocs co join public.cobro_cortes c on c.id = co.corte_id
     where c.proyecto_id = p_proyecto group by 1),
  ult_cierre as (select max(cerrado_en) t from public.cobro_cortes where proyecto_id = p_proyecto),
  ocs as (
    select v.id, v.folio, v.fecha, k.numero_contrato, pv.nombre proveedor, v.descripcion, v.total, v.neto_a_pagar,
           v.tipo_pago::text tipo_pago, v.estado::text estado
      from public.v_ordenes_compra_calculadas v
      left join public.contratos k on k.id = v.contrato_id
      left join public.proveedores pv on pv.id = v.proveedor_id
     where v.proyecto_id = p_proyecto)
  select 'NUEVO'::text, o.id, o.folio, o.fecha, o.numero_contrato, o.proveedor, o.descripcion,
         round(o.total, 2), round(o.neto_a_pagar, 2), o.tipo_pago, o.estado, null::integer, null::text
    from ocs o
   where o.estado <> 'ANULADA' and (p_fecha is null or o.fecha <= p_fecha)
     and not exists (select 1 from cobradas c where c.orden_compra_id = o.id)
  union all
  select 'AJUSTE', o.id, o.folio, o.fecha, o.numero_contrato, o.proveedor,
         'Ajuste a OC del Corte ' || c.corte_origen || case when o.estado = 'ANULADA' then ' (anulada)' else '' end,
         0::numeric, round(case when o.estado = 'ANULADA' then 0 else o.neto_a_pagar end - c.cobrado, 2), o.tipo_pago, o.estado, c.corte_origen,
         (select string_agg(a.motivo, ' · ' order by a.creado_en) from public.autorizaciones_corte_cerrado a
           where a.orden_compra_id = o.id and a.creado_en > coalesce((select t from ult_cierre), '-infinity'::timestamptz))
    from ocs o join cobradas c on c.orden_compra_id = o.id
   where abs(case when o.estado = 'ANULADA' then 0 else o.neto_a_pagar end - c.cobrado) > 0.5
  order by 4, 3;
end $function$;

create or replace function public.cerrar_cobro_corte(p_proyecto uuid, p_fecha date, p_pct numeric, p_notas text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_ult date; v_num int; v_corte uuid; v_base numeric; v_total numeric; v_adm numeric; v_n int;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede cerrar un corte de cobro.'; end if;
  if p_fecha is null then raise exception 'Indique la fecha del corte.'; end if;
  if coalesce(p_pct, -1) < 0 or p_pct > 100 then raise exception 'El porcentaje de administración no es válido.'; end if;
  if exists (select 1 from public.presupuesto_cortes pc join public.presupuestos p on p.id = pc.presupuesto_id
              where p.proyecto_id = p_proyecto and pc.estado = 'CERRADO') then
    raise exception 'Esta obra ya cobra por cortes del control presupuestal: no se mezclan los dos métodos.';
  end if;
  select max(fecha_corte), coalesce(max(numero), 0) + 1 into v_ult, v_num from public.cobro_cortes where proyecto_id = p_proyecto;
  if v_ult is not null and p_fecha < v_ult then raise exception 'La fecha debe ser igual o posterior al corte anterior (%).', v_ult; end if;
  create temp table _cobro on commit drop as select * from public.cobro_corte_en_curso(p_proyecto, p_fecha);
  select count(*), coalesce(sum(a_pagar), 0), coalesce(sum(total), 0) into v_n, v_base, v_total from _cobro;
  if v_n = 0 then raise exception 'No hay órdenes de compra para este corte.'; end if;
  v_adm := round(v_base * p_pct / 100, 0);
  insert into public.cobro_cortes (proyecto_id, numero, fecha_corte, pct_administracion, total_ocs, base, valor_administracion, notas)
  values (p_proyecto, v_num, p_fecha, p_pct, v_total, v_base, v_adm, nullif(btrim(coalesce(p_notas, '')), ''))
  returning id into v_corte;
  insert into public.cobro_corte_ocs (corte_id, orden_compra_id, tipo, folio, fecha, contrato, proveedor, concepto, total, a_pagar,
                                      tipo_pago, estado_oc, corte_origen, motivo)
  select v_corte, orden_compra_id, tipo, folio, fecha, contrato, proveedor, concepto, total, a_pagar, tipo_pago, estado_oc, corte_origen, motivo
    from _cobro;
  return jsonb_build_object('numero', v_num, 'corte_id', v_corte, 'ocs', v_n, 'total', v_total, 'base', v_base, 'administracion', v_adm);
end $function$;

revoke all on function public.cobro_corte_en_curso(uuid, date), public.cerrar_cobro_corte(uuid, date, numeric, text) from public, anon;
grant execute on function public.cobro_corte_en_curso(uuid, date), public.cerrar_cobro_corte(uuid, date, numeric, text) to authenticated;

-- Un solo método por obra: el control presupuestal no cierra cortes si la obra ya cobra por OC.
do $do$
declare v text;
begin
  v := pg_get_functiondef('public.cerrar_corte_control(uuid, date)'::regprocedure);
  if position('if v_proy is null then raise exception ''El presupuesto no existe.''; end if;' in v) = 0 then raise exception 'texto esperado no encontrado'; end if;
  v := replace(v, 'if v_proy is null then raise exception ''El presupuesto no existe.''; end if;',
    'if v_proy is null then raise exception ''El presupuesto no existe.''; end if;
  if exists (select 1 from public.cobro_cortes where proyecto_id = v_proy) then
    raise exception ''Esta obra cobra la administración por cortes de Órdenes de Compra: no se mezclan los dos métodos.'';
  end if;');
  execute v;
end $do$;
