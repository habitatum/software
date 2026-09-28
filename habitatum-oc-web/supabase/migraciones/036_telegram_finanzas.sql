-- ============================================================
-- 036 · Bot de Telegram de FINANZAS (Residente C automático)
-- * proyectos.telegram_chat_id_finanzas: grupo de finanzas (distinto al de bitácora).
-- * telegram_borradores: lectura de la IA pendiente de confirmar con los botones.
-- * caja_menor_gastos: gastos de caja menor por legalizar; al llegar al tope del
--   proyecto se legalizan en una sola OC ("Caja menor"), incluyendo el último gasto.
-- * ordenes_compra.soporte_path / origen: foto de la factura y de dónde salió la OC.
-- * bot_crear_oc / bot_registrar_caja_menor / legalizar_caja_menor: la lógica vive
--   en la base de datos; las OC del bot quedan firmadas por el usuario "Residente C".
-- * control_todo_costo y caja_proyecto incluyen la caja menor por legalizar.
-- ============================================================
alter table public.proyectos add column if not exists telegram_chat_id_finanzas text unique;
alter table public.ordenes_compra add column if not exists soporte_path text;
alter table public.ordenes_compra add column if not exists origen text not null default 'APP';

create table if not exists public.telegram_borradores (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  chat_id text not null,
  tipo text not null check (tipo in ('OC','CAJA_MENOR')),
  datos jsonb not null,
  soporte_path text,
  remitente text,
  mensaje_id bigint,
  bot_mensaje_id bigint,
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE','CONFIRMADO','DESCARTADO')),
  oc_id uuid references public.ordenes_compra(id) on delete set null,
  creado_en timestamptz not null default now()
);
alter table public.telegram_borradores enable row level security;  -- solo service role

create table if not exists public.caja_menor_gastos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  fecha date not null,
  valor numeric(16,2) not null,
  concepto text not null,
  capitulo_id uuid references public.presupuesto_capitulos(id) on delete set null,
  soporte_path text,
  remitente text,
  borrador_id uuid references public.telegram_borradores(id) on delete set null,
  oc_id uuid references public.ordenes_compra(id) on delete set null,
  creado_en timestamptz not null default now()
);
alter table public.caja_menor_gastos enable row level security;
drop policy if exists caja_menor_lectura on public.caja_menor_gastos;
create policy caja_menor_lectura on public.caja_menor_gastos for select using (auth.uid() is not null);
drop policy if exists caja_menor_admin on public.caja_menor_gastos;
create policy caja_menor_admin on public.caja_menor_gastos for all using (public.es_admin()) with check (public.es_admin());

insert into storage.buckets (id, name, public) values ('soportes-oc', 'soportes-oc', false) on conflict (id) do nothing;
drop policy if exists soportes_oc_lectura on storage.objects;
create policy soportes_oc_lectura on storage.objects for select using (bucket_id = 'soportes-oc' and auth.uid() is not null);

-- Firma como "Residente C" las escrituras hechas por el bot (service role, sin sesión).
create or replace function public._firmar_como_residente_c() returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null then return; end if;
  select id into v_id from usuarios where nombre = 'Residente C' order by creado_en limit 1;
  if v_id is null then return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_id::text, true);
end $$;
revoke all on function public._firmar_como_residente_c() from public, anon, authenticated;

create or replace function public._responsable_proyecto(p_proyecto uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select responsable from ordenes_compra where proyecto_id = p_proyecto and responsable is not null
                   order by creado_en desc limit 1), 'Residente C');
$$;
revoke all on function public._responsable_proyecto(uuid) from public, anon, authenticated;

create or replace function public._proveedor_para(p_nombre text, p_nit text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_dig text := regexp_replace(coalesce(p_nit,''), '\D', '', 'g');
begin
  if length(v_dig) >= 6 then
    -- Se compara sin dígito de verificación ni puntos (900998350-0 = 900998350).
    select id into v_id from proveedores
     where regexp_replace(coalesce(nit,''), '\D', '', 'g') in (v_dig, left(v_dig, length(v_dig) - 1))
        or v_dig like regexp_replace(coalesce(nit,''), '\D', '', 'g') || '_'
        or regexp_replace(coalesce(nit,''), '\D', '', 'g') like v_dig || '_'
     order by creado_en limit 1;
  end if;
  if v_id is null and coalesce(trim(p_nombre),'') <> '' then
    select id into v_id from proveedores where lower(trim(nombre)) = lower(trim(p_nombre)) order by creado_en limit 1;
  end if;
  if v_id is null then
    insert into proveedores (nombre, nit, representante_legal)
    values (coalesce(nullif(trim(p_nombre),''), 'Proveedor sin nombre'), nullif(trim(p_nit),''), nullif(trim(p_nombre),''))
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public._proveedor_para(text, text) from public, anon, authenticated;

create or replace function public.bot_crear_oc(p_borrador uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; d jsonb; v_prov uuid; v_oc uuid; v_folio text; v_dup record; v_iva numeric; v_total numeric;
begin
  select * into b from telegram_borradores where id = p_borrador for update;
  if b.id is null then raise exception 'Borrador no encontrado'; end if;
  if b.estado <> 'PENDIENTE' then
    return jsonb_build_object('ya_procesado', true, 'estado', b.estado,
      'folio', (select folio from ordenes_compra where id = b.oc_id));
  end if;
  d := b.datos;
  v_prov := public._proveedor_para(d->>'proveedor_nombre', d->>'proveedor_nit');

  if coalesce(trim(d->>'numero_factura'),'') <> '' then
    select o.id, o.folio into v_dup from ordenes_compra o
     where o.proveedor_id = v_prov and o.estado <> 'ANULADA'
       and upper(regexp_replace(coalesce(o.factura_proveedor,''), '\s', '', 'g')) = upper(regexp_replace(d->>'numero_factura', '\s', '', 'g'))
     limit 1;
    if v_dup.id is not null then
      update telegram_borradores set estado = 'DESCARTADO' where id = b.id;
      return jsonb_build_object('duplicado', true, 'folio', v_dup.folio);
    end if;
  end if;

  perform public._firmar_como_residente_c();
  v_iva := coalesce((d->>'iva_porcentaje')::numeric, 0);

  insert into ordenes_compra (tipo_orden, fecha, proveedor_id, descripcion, estado, tipo_pago, porcentaje_anticipo,
      porcentaje_amortizacion, tipo_amortizacion, responsable, descuento, tipo_impuesto, porcentaje_iva,
      porcentaje_retencion, devolucion_retenido, notas, proyecto_id, factura_proveedor, soporte_path, origen)
  values (coalesce(nullif(d->>'tipo_orden',''),'COMPRA')::tipo_orden_enum,
      coalesce(nullif(d->>'fecha','')::date, current_date), v_prov, nullif(d->>'concepto',''), 'VIGENTE', 'NORMAL', 0,
      0, 'PORCENTAJE', public._responsable_proyecto(b.proyecto_id), coalesce((d->>'descuento')::numeric, 0),
      (case when v_iva > 0 then 'CON_IVA' else 'SIN_IVA' end)::tipo_impuesto_enum, case when v_iva > 0 then v_iva else 19 end,
      0, 0,
      concat_ws(E'\n', 'Creada automáticamente por Residente C desde Telegram' || coalesce(' (enviada por ' || b.remitente || ')', '') || '.',
                case when coalesce(d->>'numero_factura','') <> '' then 'Factura N° ' || (d->>'numero_factura') end,
                nullif(d->>'nota','')),
      b.proyecto_id, nullif(d->>'numero_factura',''), b.soporte_path, 'TELEGRAM')
  returning id, folio into v_oc, v_folio;

  insert into items_oc (orden_compra_id, descripcion, unidad, cantidad, valor_unitario, orden, capitulo_id, sin_iva)
  select v_oc, coalesce(nullif(i.value->>'descripcion',''), 'Ítem'), nullif(i.value->>'unidad',''),
         coalesce((i.value->>'cantidad')::numeric, 1), coalesce((i.value->>'valor_unitario')::numeric, 0),
         (i.ordinality - 1)::int, nullif(d->>'capitulo_id','')::uuid, coalesce((i.value->>'sin_iva')::boolean, false)
  from jsonb_array_elements(coalesce(d->'items','[]'::jsonb)) with ordinality i;

  update telegram_borradores set estado = 'CONFIRMADO', oc_id = v_oc where id = b.id;
  select total into v_total from v_ordenes_compra_calculadas where id = v_oc;
  return jsonb_build_object('folio', v_folio, 'id', v_oc, 'total', v_total);
end $$;
revoke all on function public.bot_crear_oc(uuid) from public, anon, authenticated;
grant execute on function public.bot_crear_oc(uuid) to service_role;

create or replace function public.legalizar_caja_menor(p_proyecto uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prov uuid; v_oc uuid; v_folio text; v_n int; v_total numeric; v_cant int;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo un administrador puede legalizar la caja menor';
  end if;
  select count(*), coalesce(sum(valor),0) into v_cant, v_total from caja_menor_gastos where proyecto_id = p_proyecto and oc_id is null;
  if v_cant = 0 then return jsonb_build_object('legalizada', false, 'motivo', 'No hay gastos por legalizar'); end if;

  select id into v_prov from proveedores where nit = 'CAJA-MENOR' limit 1;
  if v_prov is null then
    insert into proveedores (nombre, nit, representante_legal) values ('CAJA MENOR', 'CAJA-MENOR', 'CAJA MENOR') returning id into v_prov;
  end if;
  select count(*) + 1 into v_n from ordenes_compra where proyecto_id = p_proyecto and origen = 'CAJA_MENOR';

  perform public._firmar_como_residente_c();
  insert into ordenes_compra (tipo_orden, fecha, proveedor_id, descripcion, estado, tipo_pago, porcentaje_anticipo,
      porcentaje_amortizacion, tipo_amortizacion, responsable, descuento, tipo_impuesto, porcentaje_iva,
      porcentaje_retencion, devolucion_retenido, notas, proyecto_id, origen)
  values ('COMPRA', current_date, v_prov, 'Legalización caja menor No. ' || v_n, 'VIGENTE', 'NORMAL', 0, 0, 'PORCENTAJE',
      public._responsable_proyecto(p_proyecto), 0, 'SIN_IVA', 19, 0, 0,
      'Legaliza ' || v_cant || ' gastos de caja menor registrados por Telegram. Soportes en cada gasto.',
      p_proyecto, 'CAJA_MENOR')
  returning id, folio into v_oc, v_folio;

  insert into items_oc (orden_compra_id, descripcion, unidad, cantidad, valor_unitario, orden, capitulo_id)
  select v_oc, to_char(g.fecha, 'DD/MM') || ' · ' || g.concepto || coalesce(' (' || g.remitente || ')', ''), 'Glb', 1, g.valor,
         (row_number() over (order by g.fecha, g.creado_en) - 1)::int, g.capitulo_id
  from caja_menor_gastos g where g.proyecto_id = p_proyecto and g.oc_id is null;

  update caja_menor_gastos set oc_id = v_oc where proyecto_id = p_proyecto and oc_id is null;
  return jsonb_build_object('legalizada', true, 'folio', v_folio, 'id', v_oc, 'gastos', v_cant, 'total', v_total);
end $$;
revoke all on function public.legalizar_caja_menor(uuid) from public, anon;
grant execute on function public.legalizar_caja_menor(uuid) to authenticated, service_role;

create or replace function public.bot_registrar_caja_menor(p_borrador uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; d jsonb; v_acum numeric; v_tope numeric; v_leg jsonb;
begin
  select * into b from telegram_borradores where id = p_borrador for update;
  if b.id is null then raise exception 'Borrador no encontrado'; end if;
  if b.estado <> 'PENDIENTE' then return jsonb_build_object('ya_procesado', true, 'estado', b.estado); end if;
  d := b.datos;
  insert into caja_menor_gastos (proyecto_id, fecha, valor, concepto, capitulo_id, soporte_path, remitente, borrador_id)
  values (b.proyecto_id, coalesce(nullif(d->>'fecha','')::date, current_date), (d->>'valor')::numeric,
          coalesce(nullif(d->>'concepto',''), 'Gasto de caja menor'), nullif(d->>'capitulo_id','')::uuid,
          b.soporte_path, b.remitente, b.id);
  update telegram_borradores set estado = 'CONFIRMADO' where id = b.id;
  select coalesce(sum(valor),0) into v_acum from caja_menor_gastos where proyecto_id = b.proyecto_id and oc_id is null;
  select coalesce(tope_caja_menor, 1000000) into v_tope from proyectos where id = b.proyecto_id;
  if v_acum >= v_tope then
    v_leg := public.legalizar_caja_menor(b.proyecto_id);
  end if;
  return jsonb_build_object('acumulado', v_acum, 'tope', v_tope, 'legalizacion', v_leg);
end $$;
revoke all on function public.bot_registrar_caja_menor(uuid) from public, anon, authenticated;
grant execute on function public.bot_registrar_caja_menor(uuid) to service_role;

-- Caja menor por legalizar: cuenta en el control y en la caja desde el primer día.
do $m$
declare d text;
begin
  d := pg_get_functiondef('public.control_todo_costo(uuid)'::regprocedure);
  if position('hist as (select * from ejecutado_historico where proyecto_id = p_proyecto),' in d) = 0 then raise exception 'patron hist'; end if;
  d := replace(d, 'hist as (select * from ejecutado_historico where proyecto_id = p_proyecto),',
    'hist as (select capitulo_id, presupuesto_item_id, valor, fecha from ejecutado_historico where proyecto_id = p_proyecto
             union all select capitulo_id, null::uuid, valor, fecha from caja_menor_gastos where proyecto_id = p_proyecto and oc_id is null),');
  if position('from hist) end,' in d) = 0 then raise exception 'patron resumen'; end if;
  d := replace(d, 'from hist) end,', 'from ejecutado_historico where proyecto_id = p_proyecto) end,
    ''caja_menor'', (select jsonb_build_object(''por_legalizar'', coalesce(sum(valor),0), ''gastos'', count(*), ''desde'', min(fecha))
                   from caja_menor_gastos where proyecto_id = p_proyecto and oc_id is null),');
  execute d;

  d := pg_get_functiondef('public.caja_proyecto(uuid)'::regprocedure);
  if position('  v_contrato := coalesce(v_fin.valor_contrato_cliente, 0);' in d) = 0 then raise exception 'patron caja'; end if;
  d := replace(d, '  v_contrato := coalesce(v_fin.valor_contrato_cliente, 0);',
    '  select v_oc + coalesce(sum(valor),0) into v_oc from caja_menor_gastos where proyecto_id = p_proyecto and oc_id is null;
  v_contrato := coalesce(v_fin.valor_contrato_cliente, 0);');
  execute d;
end $m$;
revoke all on function public.control_todo_costo(uuid) from public, anon;
grant execute on function public.control_todo_costo(uuid) to authenticated, service_role;
revoke all on function public.caja_proyecto(uuid) from public, anon;
grant execute on function public.caja_proyecto(uuid) to authenticated, service_role;
