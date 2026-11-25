-- 082 · Agregar un gasto a una legalización de caja menor ya cerrada, con aprobación del admin (25/11/2026)
-- La caja menor sigue igual (tope y legalización automática). Solo en las OC de legalización (origen CAJA_MENOR)
-- vigentes se puede pedir un gasto adicional con su comprobante:
--  · operativo → queda PENDIENTE: no toca la OC, la caja menor ni el control presupuestal hasta que el admin apruebe.
--  · admin → se aplica de una vez.
-- Al aprobar se crea el gasto de caja menor ligado a la OC (como si viniera del bot) y el ítem en la OC.
create table if not exists public.solicitudes_gasto_legalizacion (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references public.ordenes_compra(id),
  fecha date not null,
  concepto text not null,
  valor numeric(14,2) not null check (valor > 0),
  capitulo_id uuid references public.presupuesto_capitulos(id),
  presupuesto_item_id uuid references public.presupuesto_items(id),
  soporte_path text not null,
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  solicitado_por uuid default auth.uid(),
  solicitante text,
  creado_en timestamptz not null default now(),
  resuelto_por uuid,
  resuelto_en timestamptz,
  motivo_rechazo text,
  gasto_id uuid
);
create index if not exists sgl_oc_idx on public.solicitudes_gasto_legalizacion (oc_id);
alter table public.solicitudes_gasto_legalizacion enable row level security;
create policy sgl_lectura on public.solicitudes_gasto_legalizacion for select using (auth.uid() is not null);
revoke all on public.solicitudes_gasto_legalizacion from anon, authenticated;
grant select on public.solicitudes_gasto_legalizacion to authenticated;

-- Los operativos también pueden subir comprobantes al almacén de soportes de OC (para estas solicitudes).
create policy soportes_oc_operativo_subir on storage.objects for insert
  with check (bucket_id = 'soportes-oc' and public.rol_actual() = any (array['admin'::rol_usuario, 'operativo'::rol_usuario]));

create or replace function public.aprobar_gasto_legalizacion(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare s record; o record; v_gasto uuid; v_io uuid; v_ord int;
begin
  if auth.uid() is not null and not public.es_admin() then raise exception 'Solo un administrador puede aprobar gastos de legalización'; end if;
  select * into s from solicitudes_gasto_legalizacion where id = p_id for update;
  if s.id is null then raise exception 'Solicitud no encontrada'; end if;
  if s.estado <> 'PENDIENTE' then raise exception 'La solicitud ya fue %', lower(s.estado); end if;
  select * into o from ordenes_compra where id = s.oc_id for update;
  if o.origen <> 'CAJA_MENOR' or o.estado <> 'VIGENTE' then raise exception 'La OC ya no es una legalización de caja menor vigente'; end if;

  insert into caja_menor_gastos (proyecto_id, fecha, valor, concepto, capitulo_id, soporte_path, remitente, presupuesto_item_id, oc_id)
  values (o.proyecto_id, s.fecha, s.valor, s.concepto, s.capitulo_id, s.soporte_path, s.solicitante, s.presupuesto_item_id, o.id)
  returning id into v_gasto;
  select coalesce(max(orden), -1) + 1 into v_ord from items_oc where orden_compra_id = o.id;
  insert into items_oc (orden_compra_id, descripcion, unidad, cantidad, valor_unitario, orden, capitulo_id)
  values (o.id, to_char(s.fecha, 'DD/MM') || ' · ' || s.concepto || coalesce(' (' || s.solicitante || ')', ''), 'Glb', 1, s.valor, v_ord, s.capitulo_id)
  returning id into v_io;
  if s.presupuesto_item_id is not null then
    insert into items_oc_presupuesto (item_oc_id, presupuesto_item_id, porcentaje, orden) values (v_io, s.presupuesto_item_id, 100, 0);
  end if;
  update solicitudes_gasto_legalizacion set estado = 'APROBADA', resuelto_por = auth.uid(), resuelto_en = now(), gasto_id = v_gasto where id = s.id;
  return jsonb_build_object('ok', true, 'gasto_id', v_gasto, 'item_oc_id', v_io);
end $function$;

create or replace function public.rechazar_gasto_legalizacion(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not public.es_admin() then raise exception 'Solo un administrador puede rechazar gastos de legalización'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo del rechazo'; end if;
  update solicitudes_gasto_legalizacion set estado = 'RECHAZADA', resuelto_por = auth.uid(), resuelto_en = now(), motivo_rechazo = btrim(p_motivo)
   where id = p_id and estado = 'PENDIENTE';
  if not found then raise exception 'La solicitud no está pendiente'; end if;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.solicitar_gasto_legalizacion(p_oc uuid, p_fecha date, p_concepto text, p_valor numeric,
  p_capitulo uuid, p_item uuid, p_soporte text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare o record; v_id uuid; v_nombre text;
begin
  if auth.uid() is null or coalesce(public.rol_actual()::text, '') not in ('admin', 'operativo') then
    raise exception 'No tiene permiso para agregar gastos a una legalización';
  end if;
  select * into o from ordenes_compra where id = p_oc;
  if o.id is null or o.origen <> 'CAJA_MENOR' then raise exception 'Solo aplica a OC de legalización de caja menor'; end if;
  if o.estado <> 'VIGENTE' then raise exception 'La OC no está vigente'; end if;
  if length(btrim(coalesce(p_concepto, ''))) < 3 then raise exception 'Escriba el concepto del gasto'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'El valor debe ser mayor que cero'; end if;
  if coalesce(btrim(p_soporte), '') = '' or lower(p_soporte) !~ '\.(pdf|jpe?g|png)$'
     or not exists (select 1 from storage.objects where bucket_id = 'soportes-oc' and name = p_soporte) then
    raise exception 'Adjunte el comprobante (PDF, JPG o PNG)';
  end if;
  if p_capitulo is not null and not exists (select 1 from presupuesto_capitulos pc join presupuestos p on p.id = pc.presupuesto_id
      where pc.id = p_capitulo and p.proyecto_id = o.proyecto_id) then
    raise exception 'El capítulo no pertenece al presupuesto de esta obra';
  end if;
  if p_item is not null and not exists (select 1 from presupuesto_items where id = p_item and capitulo_id = p_capitulo) then
    raise exception 'El ítem no pertenece al capítulo elegido';
  end if;
  select nombre into v_nombre from usuarios where id = auth.uid();
  insert into solicitudes_gasto_legalizacion (oc_id, fecha, concepto, valor, capitulo_id, presupuesto_item_id, soporte_path, solicitante)
  values (o.id, coalesce(p_fecha, current_date), btrim(p_concepto), round(p_valor, 2), p_capitulo, p_item, p_soporte, v_nombre)
  returning id into v_id;
  if public.es_admin() then
    perform public.aprobar_gasto_legalizacion(v_id);
    return jsonb_build_object('ok', true, 'id', v_id, 'estado', 'APROBADA');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'estado', 'PENDIENTE');
end $function$;

revoke all on function public.aprobar_gasto_legalizacion(uuid), public.rechazar_gasto_legalizacion(uuid, text),
  public.solicitar_gasto_legalizacion(uuid, date, text, numeric, uuid, uuid, text) from public, anon;
grant execute on function public.aprobar_gasto_legalizacion(uuid), public.rechazar_gasto_legalizacion(uuid, text),
  public.solicitar_gasto_legalizacion(uuid, date, text, numeric, uuid, uuid, text) to authenticated;
