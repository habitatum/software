-- 046 · Blindaje de cortes de control presupuestal cerrados (PENDIENTE DE APLICAR)
-- Pedido de desarrollo (Casa 101, OC-02-0027). Decisión A de Andrés: la retención de 13,3% queda y el
-- −$30.030 entra como ajuste identificado al Corte 2. El Corte 1 ($30.934.197 directos) NO cambia.
-- 1. Estado explícito del corte y vínculo línea por línea (item_oc_id, presupuesto_item_id, tipo, motivo).
-- 2. Cortes inmutables: solo se leen; se crean con cerrar_corte_control() (admin). Nadie los edita ni borra.
-- 3. Corte en curso = vivo − congelado, línea por línea: NUEVO (nunca cortado) + AJUSTE (ya cortado y cambió).
--    Σ cortes = ejecutado vivo, siempre al peso.
-- 4. Blindaje: OC con líneas en un corte CERRADO no cambian su ejecutado (líneas, imputación, retención,
--    IVA/AIU, descuento, fecha, anulación) salvo con autorización del admin con motivo (30 min, auditada).

-- 1 ─────────────────────────────────────────────────────────────
alter table public.presupuesto_cortes add column if not exists estado text not null default 'CERRADO'
  check (estado in ('CERRADO'));
alter table public.presupuesto_corte_ocs
  add column if not exists item_oc_id uuid references public.items_oc(id) on delete set null,
  add column if not exists presupuesto_item_id uuid references public.presupuesto_items(id) on delete restrict,
  add column if not exists tipo text not null default 'NORMAL' check (tipo in ('NORMAL','AJUSTE')),
  add column if not exists corte_origen integer,
  add column if not exists motivo text;
create index if not exists presupuesto_corte_ocs_oc_idx on public.presupuesto_corte_ocs(orden_compra_id);

-- Relleno del Corte 1: ítem del presupuesto por código dentro del mismo presupuesto…
update public.presupuesto_corte_ocs co set presupuesto_item_id = pi.id
from public.presupuesto_cortes c, public.presupuesto_capitulos pc, public.presupuesto_items pi
where c.id = co.corte_id and pc.presupuesto_id = c.presupuesto_id and pi.capitulo_id = pc.id
  and pi.codigo = co.item_codigo and co.presupuesto_item_id is null;
-- …y la línea de la OC por coincidencia exacta (misma OC, descripción, valor unitario, ítem y cantidad prorrateada).
with cand as (
  select co.id co_id, io.id io_id,
         row_number() over (partition by co.id order by io.orden) rn_co,
         row_number() over (partition by io.id, x.presupuesto_item_id order by co.id) rn_io
  from public.presupuesto_corte_ocs co
  join public.items_oc io on io.orden_compra_id = co.orden_compra_id and io.descripcion = co.descripcion
                         and round(io.valor_unitario, 2) = round(co.valor_unitario, 2)
  join public.items_oc_presupuesto x on x.item_oc_id = io.id and x.presupuesto_item_id = co.presupuesto_item_id
                         and abs(io.cantidad * x.porcentaje / 100 - co.cantidad) < 0.0001
  where co.item_oc_id is null)
update public.presupuesto_corte_ocs co set item_oc_id = cand.io_id
from cand where cand.co_id = co.id and cand.rn_co = 1 and cand.rn_io = 1;

-- 2 ─────────────────────────────────────────────────────────────
drop policy if exists "presupuesto_cortes_escritura" on public.presupuesto_cortes;
drop policy if exists "presupuesto_corte_items_escritura" on public.presupuesto_corte_items;
drop policy if exists "presupuesto_corte_ocs_escritura" on public.presupuesto_corte_ocs;
do $p$ declare r record; begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('presupuesto_cortes','presupuesto_corte_items','presupuesto_corte_ocs') and cmd = 'ALL'
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $p$;

create or replace function public.trg_corte_inmutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('habitatum.cerrando_corte', true), '') <> 'si' then
    raise exception 'CORTE_CERRADO: los cortes de control presupuestal cerrados no se modifican ni se borran; las correcciones entran como ajuste en el corte en curso.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_corte_inmutable on public.presupuesto_cortes;
create trigger trg_corte_inmutable before insert or update or delete on public.presupuesto_cortes
  for each row execute function public.trg_corte_inmutable();
drop trigger if exists trg_corte_inmutable on public.presupuesto_corte_items;
create trigger trg_corte_inmutable before insert or update or delete on public.presupuesto_corte_items
  for each row execute function public.trg_corte_inmutable();
drop trigger if exists trg_corte_inmutable on public.presupuesto_corte_ocs;
create trigger trg_corte_inmutable before insert or update or delete on public.presupuesto_corte_ocs
  for each row execute function public.trg_corte_inmutable();

-- 4a. Autorizaciones de corrección (auditoría) ──────────────────
create table if not exists public.autorizaciones_corte_cerrado (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references public.ordenes_compra(id),
  corte_numero integer not null,
  motivo text not null,
  autorizado_por uuid,
  creado_en timestamptz not null default now(),
  expira_en timestamptz not null
);
alter table public.autorizaciones_corte_cerrado enable row level security;
drop policy if exists autorizaciones_corte_lectura on public.autorizaciones_corte_cerrado;
create policy autorizaciones_corte_lectura on public.autorizaciones_corte_cerrado for select using (auth.uid() is not null);
revoke all on public.autorizaciones_corte_cerrado from anon;

-- Número del primer corte CERRADO que contiene la OC (null si no está en ninguno).
create or replace function public._corte_cerrado_de_oc(p_oc uuid)
returns integer language sql stable security definer set search_path = public as $$
  select min(c.numero) from public.presupuesto_corte_ocs co
  join public.presupuesto_cortes c on c.id = co.corte_id
  where co.orden_compra_id = p_oc and c.estado = 'CERRADO';
$$;
create or replace function public._correccion_autorizada(p_oc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_admin() and exists (select 1 from public.autorizaciones_corte_cerrado a
    where a.orden_compra_id = p_oc and a.expira_en > now());
$$;
create or replace function public._exigir_oc_abierta(p_oc uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_n integer; v_folio text;
begin
  if p_oc is null then return; end if;
  v_n := public._corte_cerrado_de_oc(p_oc);
  if v_n is null or public._correccion_autorizada(p_oc) then return; end if;
  select folio into v_folio from public.ordenes_compra where id = p_oc;
  raise exception 'CORTE_CERRADO: la OC % pertenece al corte de cobro %. Solo el administrador puede corregirla con "Corregir con ajuste" y un motivo.', v_folio, v_n;
end $$;

create or replace function public.autorizar_correccion_oc(p_oc uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer; v_exp timestamptz := now() + interval '30 minutes'; v_folio text;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede autorizar correcciones de un corte cerrado.'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escriba el motivo de la corrección.'; end if;
  v_n := public._corte_cerrado_de_oc(p_oc);
  if v_n is null then raise exception 'La orden no pertenece a ningún corte cerrado; no necesita autorización.'; end if;
  select folio into v_folio from public.ordenes_compra where id = p_oc;
  insert into public.autorizaciones_corte_cerrado (orden_compra_id, corte_numero, motivo, autorizado_por, expira_en)
  values (p_oc, v_n, btrim(p_motivo), auth.uid(), v_exp);
  return jsonb_build_object('folio', v_folio, 'corte', v_n, 'expira_en', v_exp);
end $$;

-- 4b. Triggers de blindaje ──────────────────────────────────────
create or replace function public.trg_blindaje_oc_corte()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public._exigir_oc_abierta(old.id); return old; end if;
  if new.fecha is distinct from old.fecha
     or new.estado is distinct from old.estado and (new.estado = 'ANULADA' or old.estado = 'ANULADA')
     or new.tipo_pago is distinct from old.tipo_pago
     or new.proyecto_id is distinct from old.proyecto_id
     or new.descuento is distinct from old.descuento
     or new.tipo_impuesto is distinct from old.tipo_impuesto
     or new.porcentaje_iva is distinct from old.porcentaje_iva
     or new.porcentaje_administracion is distinct from old.porcentaje_administracion
     or new.porcentaje_imprevistos is distinct from old.porcentaje_imprevistos
     or new.porcentaje_utilidad is distinct from old.porcentaje_utilidad
     or new.porcentaje_retencion is distinct from old.porcentaje_retencion
     or new.devolucion_retenido is distinct from old.devolucion_retenido
     or new.porcentaje_anticipo is distinct from old.porcentaje_anticipo then
    perform public._exigir_oc_abierta(old.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_blindaje_oc_corte on public.ordenes_compra;
create trigger trg_blindaje_oc_corte before update or delete on public.ordenes_compra
  for each row execute function public.trg_blindaje_oc_corte();

create or replace function public.trg_blindaje_items_corte()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public._exigir_oc_abierta(new.orden_compra_id); return new; end if;
  if tg_op = 'DELETE' then perform public._exigir_oc_abierta(old.orden_compra_id); return old; end if;
  if new.cantidad is distinct from old.cantidad or new.valor_unitario is distinct from old.valor_unitario
     or new.orden_compra_id is distinct from old.orden_compra_id then
    perform public._exigir_oc_abierta(old.orden_compra_id);
    perform public._exigir_oc_abierta(new.orden_compra_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_blindaje_items_corte on public.items_oc;
create trigger trg_blindaje_items_corte before insert or update or delete on public.items_oc
  for each row execute function public.trg_blindaje_items_corte();

create or replace function public.trg_blindaje_imputacion_corte()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_oc_abierta((select orden_compra_id from public.items_oc
    where id = coalesce(new.item_oc_id, old.item_oc_id)));
  if tg_op = 'UPDATE' and new.item_oc_id is distinct from old.item_oc_id then
    perform public._exigir_oc_abierta((select orden_compra_id from public.items_oc where id = new.item_oc_id));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_blindaje_imputacion_corte on public.items_oc_presupuesto;
create trigger trg_blindaje_imputacion_corte before insert or update or delete on public.items_oc_presupuesto
  for each row execute function public.trg_blindaje_imputacion_corte();

-- 3 ─────────────────────────────────────────────────────────────
-- Líneas del corte en curso a una fecha de cierre: NUEVO (líneas nunca cortadas de OC con fecha ≤ cierre)
-- y AJUSTE (diferencia entre lo vivo y lo ya congelado en cortes cerrados, por OC e ítem del presupuesto).
create or replace function public.corte_control_en_curso(p_presupuesto uuid, p_fecha_hasta date)
returns table (tipo text, orden_compra_id uuid, item_oc_id uuid, presupuesto_item_id uuid, folio text, fecha date,
               proveedor text, capitulo_codigo text, item_codigo text, item_descripcion text, descripcion text,
               cantidad numeric, valor_unitario numeric, valor numeric, corte_origen integer, motivo text)
language sql stable security invoker set search_path = public as $$
with proy as (select proyecto_id from public.presupuestos where id = p_presupuesto),
cerrados as (select id, numero, creado_en from public.presupuesto_cortes
             where presupuesto_id = p_presupuesto and estado = 'CERRADO'),
congelado as (
  select co.orden_compra_id, co.presupuesto_item_id, sum(co.valor) valor, sum(co.cantidad) cantidad
  from public.presupuesto_corte_ocs co join cerrados c on c.id = co.corte_id
  where co.orden_compra_id is not null group by 1, 2),
ocs_cortadas as (
  select co.orden_compra_id, min(c.numero) corte_origen
  from public.presupuesto_corte_ocs co join cerrados c on c.id = co.corte_id
  where co.orden_compra_id is not null group by 1),
vivo as (
  select io.orden_compra_id, io.id item_oc_id, x.presupuesto_item_id, io.descripcion,
         io.cantidad * x.porcentaje / 100 cantidad, io.valor_unitario,
         ((io.cantidad * io.valor_unitario) +
           case when coalesce(oc.subtotal_items, 0) <= 0 then 0
                else ((io.cantidad * io.valor_unitario) / oc.subtotal_items)
                     * ((coalesce(oc.valor_iva, 0) + coalesce(oc.valor_aiu, 0) - coalesce(oc.descuento, 0))
                        - (coalesce(oc.valor_retenido, 0) - coalesce(oc.devolucion_retenido, 0))) end) * x.porcentaje / 100 valor,
         oc.fecha
  from public.items_oc_presupuesto x
  join public.items_oc io on io.id = x.item_oc_id
  join public.v_ordenes_compra_calculadas oc on oc.id = io.orden_compra_id
  where oc.proyecto_id = (select proyecto_id from proy) and oc.estado <> 'ANULADA'),
lineas as (
  select 'NUEVO'::text tipo, v.orden_compra_id, v.item_oc_id, v.presupuesto_item_id, v.descripcion,
         v.cantidad, v.valor_unitario, v.valor, null::integer corte_origen
  from vivo v
  where v.fecha <= p_fecha_hasta and not exists (select 1 from ocs_cortadas k where k.orden_compra_id = v.orden_compra_id)
  union all
  select 'AJUSTE', coalesce(a.orden_compra_id, g.orden_compra_id), null::uuid, coalesce(a.presupuesto_item_id, g.presupuesto_item_id),
         'Ajuste a OC del Corte ' || k.corte_origen,
         coalesce(a.cantidad, 0) - coalesce(g.cantidad, 0), null::numeric,
         coalesce(a.valor, 0) - coalesce(g.valor, 0), k.corte_origen
  from (select orden_compra_id, presupuesto_item_id, sum(cantidad) cantidad, sum(valor) valor from vivo
        where exists (select 1 from ocs_cortadas k where k.orden_compra_id = vivo.orden_compra_id) group by 1, 2) a
  full join congelado g on g.orden_compra_id = a.orden_compra_id and g.presupuesto_item_id = a.presupuesto_item_id
  join ocs_cortadas k on k.orden_compra_id = coalesce(a.orden_compra_id, g.orden_compra_id)
  where abs(coalesce(a.valor, 0) - coalesce(g.valor, 0)) > 0.5)
select l.tipo, l.orden_compra_id, l.item_oc_id, l.presupuesto_item_id, o.folio, o.fecha, pv.nombre,
       pc.codigo, pi.codigo, pi.descripcion, l.descripcion, round(l.cantidad, 6), l.valor_unitario, round(l.valor, 2),
       l.corte_origen,
       case when l.tipo = 'AJUSTE' then
         (select string_agg(a.motivo, ' · ' order by a.creado_en) from public.autorizaciones_corte_cerrado a
          where a.orden_compra_id = l.orden_compra_id
            and a.creado_en > coalesce((select max(creado_en) from cerrados), '-infinity'::timestamptz)) end
from lineas l
join public.ordenes_compra o on o.id = l.orden_compra_id
left join public.proveedores pv on pv.id = o.proveedor_id
left join public.presupuesto_items pi on pi.id = l.presupuesto_item_id
left join public.presupuesto_capitulos pc on pc.id = pi.capitulo_id;
$$;

-- Saldo de anticipos pendientes a una fecha (misma regla que la app: total del anticipo − lo amortizado hasta esa fecha).
create or replace function public._anticipos_pendientes(p_proyecto uuid, p_fecha date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(a.total - coalesce((select sum(o.valor_amortizacion) from public.v_ordenes_compra_calculadas o
           where o.referencia_anticipo_id = a.id and o.estado <> 'ANULADA' and o.fecha <= p_fecha
             and o.proyecto_id = p_proyecto), 0), 0)), 0)
  from public.v_ordenes_compra_calculadas a
  where a.proyecto_id = p_proyecto and a.tipo_pago = 'ANTICIPO' and a.estado <> 'ANULADA' and a.fecha <= p_fecha;
$$;

-- Cierra el corte en una sola transacción (solo admin).
create or replace function public.cerrar_corte_control(p_presupuesto uuid, p_fecha_hasta date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ultimo date; v_num integer; v_corte uuid; v_proy uuid; v_ant numeric; v_tot numeric; v_aj numeric;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede cerrar un corte de control presupuestal.'; end if;
  select proyecto_id into v_proy from public.presupuestos where id = p_presupuesto;
  if v_proy is null then raise exception 'El presupuesto no existe.'; end if;
  select max(fecha_hasta), coalesce(max(numero), 0) + 1 into v_ultimo, v_num
  from public.presupuesto_cortes where presupuesto_id = p_presupuesto;
  if v_ultimo is not null and p_fecha_hasta <= v_ultimo then
    raise exception 'La fecha de cierre debe ser posterior al corte anterior (%).', v_ultimo;
  end if;
  v_ant := public._anticipos_pendientes(v_proy, p_fecha_hasta);
  perform set_config('habitatum.cerrando_corte', 'si', true);
  insert into public.presupuesto_cortes (presupuesto_id, numero, fecha_desde, fecha_hasta, creado_por, anticipos_pendientes, estado)
  values (p_presupuesto, v_num, v_ultimo, p_fecha_hasta, auth.uid(), v_ant, 'CERRADO') returning id into v_corte;
  create temp table _lineas_corte on commit drop as
    select * from public.corte_control_en_curso(p_presupuesto, p_fecha_hasta);
  insert into public.presupuesto_corte_ocs (corte_id, orden_compra_id, item_oc_id, presupuesto_item_id, folio, fecha, proveedor,
    capitulo_codigo, item_codigo, item_descripcion, descripcion, cantidad, valor_unitario, valor, tipo, corte_origen, motivo)
  select v_corte, orden_compra_id, item_oc_id, presupuesto_item_id, folio, fecha, proveedor, capitulo_codigo, item_codigo,
         item_descripcion, descripcion, cantidad, valor_unitario, valor,
         case when tipo = 'AJUSTE' then 'AJUSTE' else 'NORMAL' end, corte_origen, motivo
  from _lineas_corte;
  insert into public.presupuesto_corte_items (corte_id, presupuesto_item_id, cantidad_ejecutada, valor_ejecutado)
  select v_corte, presupuesto_item_id, sum(cantidad), sum(valor) from _lineas_corte group by presupuesto_item_id;
  select coalesce(sum(valor), 0), coalesce(sum(valor) filter (where tipo = 'AJUSTE'), 0) into v_tot, v_aj from _lineas_corte;
  perform set_config('habitatum.cerrando_corte', '', true);
  return jsonb_build_object('numero', v_num, 'corte_id', v_corte, 'total', round(v_tot, 2), 'ajustes', round(v_aj, 2), 'anticipos_pendientes', round(v_ant, 2));
end $$;

-- Para las etiquetas 🔒 de la app: OC y líneas que pertenecen a un corte cerrado.
create or replace view public.v_oc_corte_cerrado with (security_invoker = true) as
select co.orden_compra_id, min(c.numero) as corte_numero, array_agg(distinct co.item_oc_id) filter (where co.item_oc_id is not null) as item_oc_ids
from public.presupuesto_corte_ocs co join public.presupuesto_cortes c on c.id = co.corte_id
where c.estado = 'CERRADO' and co.orden_compra_id is not null
group by co.orden_compra_id;

-- Decisión A: el cambio de retención de la OC-02-0027 (anterior al blindaje) queda registrado con su motivo.
insert into public.autorizaciones_corte_cerrado (orden_compra_id, corte_numero, motivo, autorizado_por, creado_en, expira_en)
select id, 1, 'Retención 10% → 13,3% registrada el 30/09/2026, antes del blindaje; aprobada por Andrés como ajuste al corte siguiente',
       'e3152039-1230-4d57-a3c4-7a3f2e093181', '2026-09-30 12:00:00-05', '2026-09-30 12:00:00-05'
from public.ordenes_compra where folio = 'OC-02-0027'
  and not exists (select 1 from public.autorizaciones_corte_cerrado a join public.ordenes_compra o on o.id = a.orden_compra_id where o.folio = 'OC-02-0027');

-- Permisos ──────────────────────────────────────────────────────
revoke all on function public._corte_cerrado_de_oc(uuid), public._correccion_autorizada(uuid), public._exigir_oc_abierta(uuid),
  public._anticipos_pendientes(uuid, date), public.trg_corte_inmutable(), public.trg_blindaje_oc_corte(),
  public.trg_blindaje_items_corte(), public.trg_blindaje_imputacion_corte() from public, anon, authenticated;
grant execute on function public._corte_cerrado_de_oc(uuid), public._correccion_autorizada(uuid), public._exigir_oc_abierta(uuid),
  public._anticipos_pendientes(uuid, date) to service_role;
revoke all on function public.autorizar_correccion_oc(uuid, text), public.corte_control_en_curso(uuid, date),
  public.cerrar_corte_control(uuid, date) from public, anon;
grant execute on function public.autorizar_correccion_oc(uuid, text), public.corte_control_en_curso(uuid, date),
  public.cerrar_corte_control(uuid, date) to authenticated, service_role;
revoke all on public.v_oc_corte_cerrado from public, anon;
grant select on public.v_oc_corte_cerrado to authenticated, service_role;
