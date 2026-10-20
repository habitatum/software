-- 064 · Devolución de retenido: el corte de DEVOLUCION y su OC siempre con la misma cifra.
-- 1) actualizar_devolucion_retenido(corte, valor, descuento, motivo): solo admin. Cambia valor devuelto,
--    descuento al retenido y motivo; tope = retenido por devolver + lo que ese corte ya devolvía (nunca se
--    devuelve más de lo retenido). Reescala las líneas de la OC en proporción (conservan su imputación; la
--    última absorbe el redondeo) y deja nota en la OC. No permite: OC anulada, OC en corte de cobro cerrado,
--    pasar de valor > 0 a solo descuento ni al revés (en esos casos se anula y se registra de nuevo).
-- 2) Candado: las líneas (items_oc) de una OC con es_devolucion_retenido = true solo cambian desde las
--    funciones de devolución (bandera de sesión habitatum.sync_devolucion). Borrar la OC completa sigue igual.
-- 3) devolver_retenido_contrato levanta la misma bandera al crear las líneas.
-- No cambia datos existentes (las 3 devoluciones actuales ya cuadran corte = OC).

create or replace function public.actualizar_devolucion_retenido(p_corte uuid, p_valor numeric, p_descuento numeric default 0, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; k record; o record; v_oc_sub numeric := 0; v_disp numeric; v_n int := 0; v_cnt int; v_acum numeric := 0;
  v_tot numeric; r record; v_val numeric; v_cerrado int;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede editar una devolución de retenido.'; end if;
  select * into c from cortes where id = p_corte for update;
  if c.id is null or c.tipo <> 'DEVOLUCION' then raise exception 'El corte no es una devolución de retenido.'; end if;
  if c.estado <> 'APROBADO' then raise exception 'Solo aplica a devoluciones aprobadas.'; end if;
  select * into k from contratos where id = c.contrato_id;
  p_valor := round(coalesce(p_valor, 0), 2); p_descuento := round(coalesce(p_descuento, 0), 2);
  if p_valor < 0 or p_descuento < 0 then raise exception 'Los valores no pueden ser negativos.'; end if;
  if p_valor + p_descuento <= 0 then raise exception 'Escriba el valor a devolver o el descuento.'; end if;
  if p_descuento > 0 and length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escriba el motivo del descuento al retenido.'; end if;

  if c.oc_id is not null then
    select * into o from ordenes_compra where id = c.oc_id for update;
    if o.estado = 'ANULADA' then raise exception 'La OC % de esta devolución está anulada: registre la devolución de nuevo.', o.folio; end if;
    if p_valor = 0 then raise exception 'Esta devolución tiene la OC %: el valor devuelto no puede quedar en 0. Si solo hay descuento, anule la OC y registre de nuevo.', o.folio; end if;
    select count(*) into v_cerrado from v_oc_corte_cerrado where orden_compra_id = o.id;
    if v_cerrado > 0 then raise exception 'La OC % ya está en un corte de cobro cerrado: no se puede cambiar su valor.', o.folio; end if;
    select coalesce(subtotal, 0) into v_oc_sub from v_ordenes_compra_calculadas where id = o.id;
  elsif p_valor > 0 then
    raise exception 'Esta devolución se registró solo como descuento (sin OC): para devolver dinero, registre una devolución nueva.';
  end if;

  -- Disponible = retenido pendiente + lo que este mismo corte ya devolvía y descontaba.
  v_disp := public.retenido_por_devolver_contrato(k.id) + v_oc_sub + coalesce(c.descuento_retenido, 0);
  if p_valor + p_descuento > v_disp + 1 then
    raise exception 'DEVOLUCION: el contrato % solo tiene $% de retenido disponible para esta devolución; devolución + descuento suman $%.',
      k.numero_contrato, replace(to_char(round(v_disp), 'FM999,999,999,990'), ',', '.'),
      replace(to_char(round(p_valor + p_descuento), 'FM999,999,999,990'), ',', '.');
  end if;

  if o.id is not null then
    perform set_config('habitatum.sync_devolucion', '1', true);
    select coalesce(sum(cantidad * valor_unitario), 0), count(*) into v_tot, v_cnt from items_oc where orden_compra_id = o.id;
    if v_cnt = 0 then
      insert into items_oc (orden_compra_id, descripcion, unidad, cantidad, valor_unitario, orden)
      values (o.id, 'Devolución de retenido · contrato ' || k.numero_contrato, 'Glb', 1, p_valor, 0);
    else
      for r in select id, cantidad, valor_unitario from items_oc where orden_compra_id = o.id order by orden, id loop
        v_n := v_n + 1;
        v_val := case when v_n = v_cnt then p_valor - v_acum
                      when v_tot > 0 then round(p_valor * (r.cantidad * r.valor_unitario) / v_tot, 2)
                      else 0 end;
        v_acum := v_acum + v_val;
        update items_oc set cantidad = 1, valor_unitario = v_val where id = r.id;
      end loop;
    end if;
    update ordenes_compra set
      notas = nullif(btrim(coalesce(notas, '') || E'\n' || 'Actualizada desde el corte de devolución No. ' || c.numero || ' el '
              || to_char(now() at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') || ': devuelto $'
              || replace(to_char(round(p_valor), 'FM999,999,999,990'), ',', '.')
              || case when p_descuento > 0 then ', descuento $' || replace(to_char(round(p_descuento), 'FM999,999,999,990'), ',', '.') || ' (' || btrim(p_motivo) || ')' else '' end
              || '.'), '')
    where id = o.id;
    perform set_config('habitatum.sync_devolucion', '', true);
  end if;

  update cortes set valor_devolucion = p_valor, neto = p_valor, descuento_retenido = p_descuento,
         motivo_descuento = nullif(btrim(coalesce(p_motivo, '')), ''),
         notas = case when p_descuento > 0 then 'Devolución de retenido. Descuento: ' || btrim(p_motivo) else 'Devolución de retenido' end,
         editado_en = now(), editado_por = auth.uid()
   where id = c.id;

  return jsonb_build_object('corte', c.numero, 'folio', o.folio, 'devuelto', p_valor, 'descuento', p_descuento,
                            'retenido_por_devolver', public.retenido_por_devolver_contrato(k.id));
end $$;
revoke all on function public.actualizar_devolucion_retenido(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.actualizar_devolucion_retenido(uuid, numeric, numeric, text) to authenticated;

-- Candado de las líneas de una OC de devolución.
create or replace function public.trg_items_oc_devolucion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_oc uuid := case when tg_op = 'INSERT' then new.orden_compra_id else old.orden_compra_id end;
begin
  if coalesce(current_setting('habitatum.sync_devolucion', true), '') = '1' then
    return case when tg_op = 'INSERT' or tg_op = 'UPDATE' then new else old end;
  end if;
  -- Si la OC ya no existe (se está borrando completa), se deja pasar.
  if exists (select 1 from ordenes_compra where id = v_oc and es_devolucion_retenido)
     or (tg_op = 'UPDATE' and exists (select 1 from ordenes_compra where id = new.orden_compra_id and es_devolucion_retenido)) then
    raise exception 'DEVOLUCION: esta OC es una devolución de retenido. Corrige el valor desde el corte de devolución (Contrato → Cortes → ✎ Editar).';
  end if;
  return case when tg_op = 'INSERT' or tg_op = 'UPDATE' then new else old end;
end $$;
revoke all on function public.trg_items_oc_devolucion() from public, anon, authenticated;

-- Aplicado con apply_migration solo para insert/update; el borrado de líneas lo agrega 064b (SQL Editor).
create trigger items_oc_devolucion_candado before insert or update on public.items_oc
  for each row execute function public.trg_items_oc_devolucion();

-- devolver_retenido_contrato: levanta la bandera antes de crear las líneas de la OC.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.devolver_retenido_contrato(uuid,date,numeric,numeric,text,boolean)'::regprocedure);
  if position('  if p_valor > 0 then
    insert into public.ordenes_compra' in d) = 0 then raise exception 'Parche 064 no aplica en devolver_retenido_contrato'; end if;
  d := replace(d, '  if p_valor > 0 then
    insert into public.ordenes_compra', '  if p_valor > 0 then
    perform set_config(''habitatum.sync_devolucion'', ''1'', true);
    insert into public.ordenes_compra');
  d := replace(d, '    update public.cortes set oc_id = v_oc where id = v_corte;', '    update public.cortes set oc_id = v_oc where id = v_corte;
    perform set_config(''habitatum.sync_devolucion'', '''', true);');
  execute d;
end $do$;
