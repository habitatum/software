-- 052 · Cantidades medidas en los cortes de cobro (control presupuestal) — aplicada el 06/10/2026, registro Supabase: cantidades_corte_control
-- La cantidad que se le presenta al cliente por ítem y por corte se registra en la app (antes se llenaba a mano en el Excel).
-- cantidad_ejecutada (suma de cantidades de las OC) se conserva como dato interno; para el cobro se usa cantidad_medida.

alter table public.presupuesto_corte_items
  add column if not exists cantidad_medida numeric check (cantidad_medida is null or cantidad_medida >= 0),
  add column if not exists cantidad_medida_por uuid,
  add column if not exists cantidad_medida_en timestamptz;

create table if not exists public.presupuesto_cantidades_en_curso (
  presupuesto_id uuid not null references public.presupuestos(id) on delete cascade,
  presupuesto_item_id uuid not null references public.presupuesto_items(id) on delete cascade,
  cantidad numeric not null check (cantidad >= 0),
  actualizado_por uuid,
  actualizado_en timestamptz not null default now(),
  primary key (presupuesto_id, presupuesto_item_id)
);
alter table public.presupuesto_cantidades_en_curso enable row level security;
drop policy if exists cantidades_en_curso_lectura on public.presupuesto_cantidades_en_curso;
create policy cantidades_en_curso_lectura on public.presupuesto_cantidades_en_curso for select using (auth.uid() is not null);
revoke all on public.presupuesto_cantidades_en_curso from public, anon;
grant select on public.presupuesto_cantidades_en_curso to authenticated;
grant all on public.presupuesto_cantidades_en_curso to service_role;

-- Blindaje (046) con una sola excepción: en un corte cerrado se pueden registrar las cantidades medidas
-- (nunca los valores), solo desde guardar_cantidad_medida.
create or replace function public.trg_corte_inmutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('habitatum.cerrando_corte', true), '') = 'si' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'presupuesto_corte_items' and coalesce(current_setting('habitatum.cantidades_corte', true), '') = 'si' then
    if tg_op = 'UPDATE' and new.id = old.id and new.corte_id = old.corte_id and new.presupuesto_item_id = old.presupuesto_item_id
       and new.cantidad_ejecutada is not distinct from old.cantidad_ejecutada
       and new.valor_ejecutado is not distinct from old.valor_ejecutado then
      return new;
    end if;
    if tg_op = 'INSERT' and coalesce(new.valor_ejecutado, 0) = 0 and coalesce(new.cantidad_ejecutada, 0) = 0 then
      return new;
    end if;
  end if;
  raise exception 'CORTE_CERRADO: los cortes de control presupuestal cerrados no se modifican ni se borran; las correcciones entran como ajuste en el corte en curso.';
end $$;
revoke all on function public.trg_corte_inmutable() from public, anon, authenticated;

-- Guarda la cantidad medida de un ítem: en el corte en curso (p_corte null; admin u operativo)
-- o en un corte cerrado (solo admin). p_cantidad null = borrar la cantidad.
create or replace function public.guardar_cantidad_medida(p_presupuesto uuid, p_item uuid, p_cantidad numeric, p_corte uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fila uuid; v_numero integer;
begin
  if not exists (select 1 from public.presupuesto_items pi join public.presupuesto_capitulos pc on pc.id = pi.capitulo_id
                 where pi.id = p_item and pc.presupuesto_id = p_presupuesto) then
    raise exception 'El ítem no pertenece a este presupuesto.';
  end if;
  if p_cantidad is not null and p_cantidad < 0 then raise exception 'La cantidad no puede ser negativa.'; end if;

  if p_corte is null then
    if public.rol_actual() not in ('admin', 'operativo') then raise exception 'Sin permiso para registrar cantidades.'; end if;
    if p_cantidad is null then
      delete from public.presupuesto_cantidades_en_curso where presupuesto_id = p_presupuesto and presupuesto_item_id = p_item;
    else
      insert into public.presupuesto_cantidades_en_curso (presupuesto_id, presupuesto_item_id, cantidad, actualizado_por, actualizado_en)
      values (p_presupuesto, p_item, p_cantidad, auth.uid(), now())
      on conflict (presupuesto_id, presupuesto_item_id) do update
        set cantidad = excluded.cantidad, actualizado_por = excluded.actualizado_por, actualizado_en = now();
    end if;
    return jsonb_build_object('corte', null, 'cantidad', p_cantidad);
  end if;

  if not public.es_admin() then raise exception 'Solo un administrador puede ajustar las cantidades de un corte cerrado.'; end if;
  select numero into v_numero from public.presupuesto_cortes where id = p_corte and presupuesto_id = p_presupuesto;
  if v_numero is null then raise exception 'El corte no pertenece a este presupuesto.'; end if;
  perform set_config('habitatum.cantidades_corte', 'si', true);
  update public.presupuesto_corte_items
     set cantidad_medida = p_cantidad, cantidad_medida_por = auth.uid(), cantidad_medida_en = now()
   where corte_id = p_corte and presupuesto_item_id = p_item
  returning id into v_fila;
  if v_fila is null and p_cantidad is not null then
    insert into public.presupuesto_corte_items (corte_id, presupuesto_item_id, cantidad_ejecutada, valor_ejecutado, cantidad_medida, cantidad_medida_por, cantidad_medida_en)
    values (p_corte, p_item, 0, 0, p_cantidad, auth.uid(), now());
  end if;
  perform set_config('habitatum.cantidades_corte', '', true);
  return jsonb_build_object('corte', v_numero, 'cantidad', p_cantidad);
end $$;
revoke all on function public.guardar_cantidad_medida(uuid, uuid, numeric, uuid) from public, anon;
grant execute on function public.guardar_cantidad_medida(uuid, uuid, numeric, uuid) to authenticated, service_role;

-- Al cerrar un corte, las cantidades escritas en el corte en curso quedan congeladas con él y se limpian.
do $m$ declare d text; ancla text := '  select coalesce(sum(valor), 0), coalesce(sum(valor) filter (where tipo = ''AJUSTE''), 0) into v_tot, v_aj from _lineas_corte;';
begin
  d := pg_get_functiondef('public.cerrar_corte_control(uuid,date)'::regprocedure);
  if position(ancla in d) = 0 then raise exception 'cerrar_corte_control: ancla no encontrada'; end if;
  if position('presupuesto_cantidades_en_curso' in d) > 0 then return; end if;
  d := replace(d, ancla,
'  update public.presupuesto_corte_items ci set cantidad_medida = q.cantidad, cantidad_medida_por = q.actualizado_por, cantidad_medida_en = q.actualizado_en
  from public.presupuesto_cantidades_en_curso q
  where q.presupuesto_id = p_presupuesto and ci.corte_id = v_corte and ci.presupuesto_item_id = q.presupuesto_item_id;
  insert into public.presupuesto_corte_items (corte_id, presupuesto_item_id, cantidad_ejecutada, valor_ejecutado, cantidad_medida, cantidad_medida_por, cantidad_medida_en)
  select v_corte, q.presupuesto_item_id, 0, 0, q.cantidad, q.actualizado_por, q.actualizado_en
  from public.presupuesto_cantidades_en_curso q
  where q.presupuesto_id = p_presupuesto
    and not exists (select 1 from public.presupuesto_corte_items ci where ci.corte_id = v_corte and ci.presupuesto_item_id = q.presupuesto_item_id);
  delete from public.presupuesto_cantidades_en_curso where presupuesto_id = p_presupuesto;
' || ancla);
  execute d;
end $m$;
revoke all on function public.cerrar_corte_control(uuid, date) from public, anon;
grant execute on function public.cerrar_corte_control(uuid, date) to authenticated, service_role;
