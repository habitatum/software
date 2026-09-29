-- ============================================================
-- 037 · Módulo de CORTES DE OBRA
-- * contrato_items: alcance del contrato (código de presupuesto, cantidad contratada,
--   valor unitario) + cantidad_historica (lo ejecutado antes del módulo).
--   es_adicional = ítem fuera del alcance firmado (se crea desde un corte o por otrosí).
-- * cortes / corte_items: cantidades de cada corte, % retención y amortización.
-- * v_contrato_items_avance: contratado, acumulado aprobado y saldo por ítem.
-- * aprobar_corte(corte): (solo admin) genera la OC tipo CONTRATO ya imputada al
--   presupuesto (ítem o capítulo), con amortización exacta del anticipo y retención.
-- ============================================================
alter table public.contratos add column if not exists cortes_previos int not null default 0;

create table if not exists public.contrato_items (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  codigo text,
  descripcion text not null,
  unidad text,
  cantidad numeric(14,3),              -- contratada (null en adicionales sin cantidad pactada)
  valor_unitario numeric(16,2) not null default 0,
  cantidad_historica numeric(14,3) not null default 0,
  es_adicional boolean not null default false,
  presupuesto_item_id uuid references public.presupuesto_items(id) on delete set null,
  capitulo_id uuid references public.presupuesto_capitulos(id) on delete set null,
  orden int not null default 0,
  creado_en timestamptz not null default now()
);

create table if not exists public.cortes (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  numero int not null,
  fecha date not null default current_date,
  porcentaje_retencion numeric(7,4) not null default 0,
  tipo_amortizacion text not null default 'NINGUNA' check (tipo_amortizacion in ('PORCENTAJE','SALDO','VALOR_FIJO','NINGUNA')),
  porcentaje_amortizacion numeric(9,6) not null default 0,
  valor_amortizacion_fijo numeric(16,2) not null default 0,
  notas text,
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR','APROBADO')),
  subtotal numeric(16,2), valor_amortizacion numeric(16,2), valor_retencion numeric(16,2), neto numeric(16,2),
  oc_id uuid references public.ordenes_compra(id) on delete set null,
  creado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now(),
  aprobado_en timestamptz,
  unique (contrato_id, numero)
);

create table if not exists public.corte_items (
  id uuid primary key default gen_random_uuid(),
  corte_id uuid not null references public.cortes(id) on delete cascade,
  contrato_item_id uuid references public.contrato_items(id) on delete set null,
  descripcion text not null,
  unidad text,
  cantidad numeric(14,3) not null default 0,
  valor_unitario numeric(16,2) not null default 0,
  presupuesto_item_id uuid references public.presupuesto_items(id) on delete set null,
  capitulo_id uuid references public.presupuesto_capitulos(id) on delete set null,
  orden int not null default 0
);

do $p$
declare t text;
begin
  foreach t in array array['contrato_items','cortes','corte_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_lectura', t);
    execute format('create policy %I on public.%I for select using (auth.uid() is not null)', t||'_lectura', t);
    execute format('drop policy if exists %I on public.%I', t||'_escritura', t);
    execute format($q$create policy %I on public.%I for all using (rol_actual() = any (array['admin'::rol_usuario,'operativo'::rol_usuario])) with check (rol_actual() = any (array['admin'::rol_usuario,'operativo'::rol_usuario]))$q$, t||'_escritura', t);
  end loop;
end $p$;

create or replace view public.v_contrato_items_avance with (security_invoker = true) as
select ci.*,
  ci.cantidad_historica + coalesce((select sum(x.cantidad) from corte_items x join cortes c on c.id = x.corte_id
                                    where x.contrato_item_id = ci.id and c.estado = 'APROBADO'), 0) as acumulado,
  case when ci.cantidad is null then null
       else ci.cantidad - ci.cantidad_historica - coalesce((select sum(x.cantidad) from corte_items x join cortes c on c.id = x.corte_id
                                    where x.contrato_item_id = ci.id and c.estado = 'APROBADO'), 0) end as saldo
from contrato_items ci;
grant select on public.v_contrato_items_avance to authenticated, service_role;

-- Anticipo vigente del contrato y su saldo por amortizar.
create or replace function public.anticipo_contrato(p_contrato uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('oc_id', v.id, 'folio', v.folio, 'valor', v.total, 'saldo', v.saldo_anticipo_por_amortizar)
    from v_ordenes_compra_calculadas v
    where v.contrato_id = p_contrato and v.tipo_pago = 'ANTICIPO' and v.estado <> 'ANULADA'
    order by (v.saldo_anticipo_por_amortizar > 0.5) desc, v.fecha desc limit 1), '{}'::jsonb);
$$;
grant execute on function public.anticipo_contrato(uuid) to authenticated, service_role;

create or replace function public.aprobar_corte(p_corte uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c record; k record; v_ant jsonb; v_saldo numeric; v_sub numeric; v_amort numeric; v_ret numeric;
  v_oc uuid; v_folio text; r record; v_ci uuid; v_io uuid; v_n int := 0; v_neto numeric;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo un administrador puede aprobar cortes de obra';
  end if;
  select * into c from cortes where id = p_corte for update;
  if c.id is null then raise exception 'Corte no encontrado'; end if;
  if c.estado <> 'BORRADOR' then raise exception 'El corte ya fue aprobado'; end if;
  select * into k from contratos where id = c.contrato_id;

  select coalesce(sum(round(cantidad * valor_unitario, 2)), 0) into v_sub from corte_items where corte_id = c.id and cantidad <> 0;
  if v_sub <= 0 then raise exception 'El corte no tiene cantidades'; end if;

  v_ant := public.anticipo_contrato(k.id);
  v_saldo := greatest(coalesce((v_ant->>'saldo')::numeric, 0), 0);
  v_amort := case c.tipo_amortizacion
      when 'PORCENTAJE' then round(v_sub * c.porcentaje_amortizacion / 100, 2)
      when 'SALDO' then v_saldo
      when 'VALOR_FIJO' then c.valor_amortizacion_fijo
      else 0 end;
  v_amort := least(greatest(v_amort, 0), v_saldo, v_sub);
  v_ret := round(v_sub * c.porcentaje_retencion / 100, 2);

  -- Adicionales nuevos del corte → quedan como ítems adicionales del contrato.
  for r in select * from corte_items where corte_id = c.id and contrato_item_id is null and cantidad <> 0 loop
    insert into contrato_items (contrato_id, descripcion, unidad, cantidad, valor_unitario, es_adicional, presupuesto_item_id, capitulo_id, orden)
    values (k.id, r.descripcion, r.unidad, null, r.valor_unitario, true, r.presupuesto_item_id, r.capitulo_id,
            coalesce((select max(orden) + 1 from contrato_items where contrato_id = k.id), 0))
    returning id into v_ci;
    update corte_items set contrato_item_id = v_ci where id = r.id;
  end loop;

  insert into ordenes_compra (tipo_orden, contrato_id, fecha, proveedor_id, descripcion, estado, tipo_pago,
      referencia_anticipo_id, porcentaje_anticipo, porcentaje_amortizacion, tipo_amortizacion, valor_amortizacion_manual,
      responsable, descuento, tipo_impuesto, porcentaje_iva, porcentaje_retencion, devolucion_retenido, notas, proyecto_id, origen)
  values ('CONTRATO', k.id, c.fecha, k.contratista_id, 'Corte de obra No. ' || c.numero || ' · ' || k.concepto, 'VIGENTE', 'NORMAL',
      case when v_amort > 0 then (v_ant->>'oc_id')::uuid end, 0, 0,
      (case when v_amort > 0 then 'VALOR_FIJO' else 'PORCENTAJE' end)::tipo_amortizacion_enum, case when v_amort > 0 then v_amort end,
      public._responsable_proyecto(k.proyecto_id), 0, 'SIN_IVA', 19, c.porcentaje_retencion, 0,
      concat_ws(E'\n', 'Corte de obra No. ' || c.numero || ' del contrato ' || k.numero_contrato || '.', nullif(c.notas, '')),
      k.proyecto_id, 'CORTE')
  returning id, folio into v_oc, v_folio;

  for r in select * from corte_items where corte_id = c.id and cantidad <> 0 order by orden loop
    insert into items_oc (orden_compra_id, descripcion, unidad, cantidad, valor_unitario, orden, capitulo_id)
    values (v_oc, r.descripcion, r.unidad, r.cantidad, r.valor_unitario, v_n,
            case when r.presupuesto_item_id is null then r.capitulo_id end)
    returning id into v_io;
    if r.presupuesto_item_id is not null then
      insert into items_oc_presupuesto (item_oc_id, presupuesto_item_id, porcentaje, orden) values (v_io, r.presupuesto_item_id, 100, 0);
    end if;
    v_n := v_n + 1;
  end loop;

  select neto_a_pagar into v_neto from v_ordenes_compra_calculadas where id = v_oc;
  update cortes set estado = 'APROBADO', oc_id = v_oc, aprobado_en = now(),
         subtotal = v_sub, valor_amortizacion = v_amort, valor_retencion = v_ret, neto = v_neto
   where id = c.id;
  return jsonb_build_object('folio', v_folio, 'oc_id', v_oc, 'subtotal', v_sub, 'amortizacion', v_amort, 'retencion', v_ret, 'neto', v_neto);
end $$;
revoke all on function public.aprobar_corte(uuid) from public, anon;
grant execute on function public.aprobar_corte(uuid) to authenticated, service_role;
