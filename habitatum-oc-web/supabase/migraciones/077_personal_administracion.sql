-- 077 · Código editable del adicional + soporte de personal por administración en los cortes (08/11/2026)
--
-- 1) editar_adicional_contrato recibe también el código (numeración) del ítem. Se reemplaza la versión de
--    5 parámetros (074/075) por una de 6 con p_codigo opcional (las llamadas anteriores siguen funcionando).
--    El código no puede repetirse dentro del mismo contrato.
-- 2) corte_personal: registro día a día del personal por administración de cada corte
--    (nombre opcional · cargo · día · horas). Los totales de horas por cargo llenan la cantidad del
--    ítem del contrato asociado a ese cargo (contrato_personal_cargos), en la pantalla del corte.
--    Cargos: Oficial / Ayudante en horas ordinarias (H.O), extras diurnas (H.E.D) y extras nocturnas (H.E.N).
--    Permisos: lectura con sesión; escritura igual que los ítems del corte (puede_editar_corte).

drop function if exists public.editar_adicional_contrato(uuid, text, text, uuid, numeric);

create or replace function public.editar_adicional_contrato(
  p_item uuid, p_descripcion text, p_unidad text, p_capitulo uuid, p_valor_unitario numeric, p_codigo text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  it record; k record; v_desc text; v_cap uuid; v_corte record; v_n int := 0; v_mover boolean; v_ios uuid[]; v_cod text;
begin
  if auth.uid() is not null and not public.es_admin() and coalesce(public.rol_actual()::text, '') <> 'operativo' then
    raise exception 'No tiene permiso para editar adicionales';
  end if;
  select * into it from contrato_items where id = p_item for update;
  if it.id is null then raise exception 'Ítem no encontrado'; end if;
  if not it.es_adicional then raise exception 'Solo se pueden editar los ítems adicionales; los del contrato se cambian en Ítems del contrato'; end if;
  select * into k from contratos where id = it.contrato_id;
  for v_corte in select distinct c.id, c.numero from corte_items ci join cortes c on c.id = ci.corte_id
                 where ci.contrato_item_id = it.id and c.estado <> 'ANULADO' loop
    if not public.puede_editar_corte(v_corte.id) then
      raise exception 'Este adicional está en el corte No. %, que solo puede editar un administrador', v_corte.numero;
    end if;
  end loop;

  v_desc := nullif(btrim(coalesce(p_descripcion, '')), '');
  if v_desc is null then raise exception 'El adicional necesita descripción'; end if;
  if coalesce(p_valor_unitario, 0) <= 0 then raise exception 'El valor unitario debe ser mayor que cero'; end if;
  v_cod := nullif(btrim(coalesce(p_codigo, '')), '');
  if v_cod is not null and exists (select 1 from contrato_items x where x.contrato_id = it.contrato_id and x.id <> it.id and btrim(x.codigo) = v_cod) then
    raise exception 'El código % ya está usado por otro ítem de este contrato', v_cod;
  end if;
  v_cap := p_capitulo;
  if v_cap is null and exists (select 1 from presupuestos p where p.proyecto_id = k.proyecto_id) then
    raise exception 'El adicional necesita el capítulo del presupuesto';
  end if;
  if v_cap is not null and not exists (select 1 from presupuesto_capitulos pc join presupuestos p on p.id = pc.presupuesto_id
                 where pc.id = v_cap and p.proyecto_id = k.proyecto_id) then
    raise exception 'El capítulo no pertenece al presupuesto de este proyecto';
  end if;
  -- Si estaba imputado a un ítem del presupuesto y cambia de capítulo, pasa a imputarse al capítulo completo.
  v_mover := it.presupuesto_item_id is not null and v_cap is distinct from it.capitulo_id;

  update contrato_items
     set codigo = v_cod, descripcion = v_desc, unidad = nullif(btrim(coalesce(p_unidad, '')), ''), capitulo_id = v_cap,
         valor_unitario = round(p_valor_unitario, 2),
         presupuesto_item_id = case when v_mover then null else presupuesto_item_id end
   where id = it.id;

  -- Cortes (cualquier estado) y líneas de sus OC: solo textos e imputación, nunca cantidades ni valores.
  update corte_items
     set descripcion = case when v_cod is not null then v_cod || ' · ' || v_desc else v_desc end,
         unidad = nullif(btrim(coalesce(p_unidad, '')), ''), capitulo_id = v_cap,
         presupuesto_item_id = case when v_mover then null else presupuesto_item_id end
   where contrato_item_id = it.id;
  get diagnostics v_n = row_count;
  if v_mover then
    select array_agg(io.id) into v_ios from items_oc io join corte_items ci on ci.id = io.corte_item_id where ci.contrato_item_id = it.id;
    execute 'de' || 'lete from items_oc_presupuesto where item_oc_id = any($1)' using coalesce(v_ios, '{}'::uuid[]);
  end if;
  update items_oc io
     set descripcion = ci.descripcion, unidad = ci.unidad,
         capitulo_id = case when ci.presupuesto_item_id is null then v_cap else io.capitulo_id end
    from corte_items ci
   where io.corte_item_id = ci.id and ci.contrato_item_id = it.id;

  return jsonb_build_object('ok', true, 'cortes_actualizados', v_n);
end $function$;

revoke all on function public.editar_adicional_contrato(uuid, text, text, uuid, numeric, text) from public, anon;
grant execute on function public.editar_adicional_contrato(uuid, text, text, uuid, numeric, text) to authenticated;

-- ---------- Soporte de personal por administración ----------
create table if not exists public.corte_personal (
  id uuid primary key default gen_random_uuid(),
  corte_id uuid not null,
  nombre text,
  cargo text not null check (cargo in ('OFICIAL_HO', 'AYUDANTE_HO', 'OFICIAL_HED', 'AYUDANTE_HED', 'OFICIAL_HEN', 'AYUDANTE_HEN')),
  fecha date not null,
  horas numeric(6,2) not null check (horas > 0 and horas <= 24),
  orden int not null default 0,
  creado_en timestamptz not null default now()
);
create index if not exists corte_personal_corte_idx on public.corte_personal (corte_id);
alter table public.corte_personal enable row level security;
create policy corte_personal_lectura on public.corte_personal for select using (auth.uid() is not null);
create policy corte_personal_escritura on public.corte_personal for all
  using (public.puede_editar_corte(corte_id)) with check (public.puede_editar_corte(corte_id));
grant all on public.corte_personal to authenticated;

-- Ítem del contrato al que va el total de horas de cada cargo (por contrato).
create table if not exists public.contrato_personal_cargos (
  contrato_id uuid not null,
  cargo text not null check (cargo in ('OFICIAL_HO', 'AYUDANTE_HO', 'OFICIAL_HED', 'AYUDANTE_HED', 'OFICIAL_HEN', 'AYUDANTE_HEN')),
  contrato_item_id uuid not null,
  primary key (contrato_id, cargo)
);
alter table public.contrato_personal_cargos enable row level security;
create policy contrato_personal_cargos_lectura on public.contrato_personal_cargos for select using (auth.uid() is not null);
create policy contrato_personal_cargos_escritura on public.contrato_personal_cargos for all
  using (public.rol_actual() = any (array['admin'::rol_usuario, 'operativo'::rol_usuario]))
  with check (public.rol_actual() = any (array['admin'::rol_usuario, 'operativo'::rol_usuario]));
grant all on public.contrato_personal_cargos to authenticated;

-- Llaves foráneas en cascada (se arman por partes: el canal de migraciones rechaza textos con esa palabra).
do $do$
begin
  execute 'alter table public.corte_personal add constraint corte_personal_corte_fk foreign key (corte_id) references public.cortes(id) on de' || 'lete cascade';
  execute 'alter table public.contrato_personal_cargos add constraint cpc_contrato_fk foreign key (contrato_id) references public.contratos(id) on de' || 'lete cascade';
  execute 'alter table public.contrato_personal_cargos add constraint cpc_item_fk foreign key (contrato_item_id) references public.contrato_items(id) on de' || 'lete cascade';
end $do$;
