-- 065 · Recibo automático de caja menor cuando el gasto llega sin soporte.
-- 1) caja_menor_gastos: beneficiario (nombre, CC/NIT, cuenta) y recibo (número consecutivo por obra y folio
--    RCM-<código obra>-0001). El PDF del recibo se guarda en soportes-oc y queda como soporte_path.
-- 2) bot_registrar_caja_menor: guarda el beneficiario y, si el gasto no trae foto/PDF, asigna el recibo.
-- 3) asignar_recibo_caja_menor(gasto, nombre, documento, cuenta): para "Generar recibo" desde la App (solo
--    admin) o desde el bot (service role); conserva el número si ya lo tenía.
-- 4) datos_recibo_caja_menor(gasto): datos para dibujar el recibo (sin precios de venta ni utilidad).
-- No cambia el tope ni la legalización. No borra datos.

alter table public.caja_menor_gastos
  add column if not exists beneficiario_nombre text,
  add column if not exists beneficiario_documento text,
  add column if not exists beneficiario_cuenta text,
  add column if not exists recibo_numero integer,
  add column if not exists recibo_folio text;
create unique index if not exists caja_menor_gastos_recibo_uq on public.caja_menor_gastos (proyecto_id, recibo_numero) where recibo_numero is not null;

-- Número siguiente por obra, con bloqueo de la fila del proyecto para que dos registros simultáneos no repitan.
create or replace function public._siguiente_recibo_caja_menor(p_proyecto uuid)
returns table (numero integer, folio text) language plpgsql security definer set search_path = public as $$
declare v_cod text; v_n integer;
begin
  select codigo into v_cod from proyectos where id = p_proyecto for update;
  select coalesce(max(recibo_numero), 0) + 1 into v_n from caja_menor_gastos where proyecto_id = p_proyecto;
  return query select v_n, 'RCM-' || coalesce(v_cod, 'X') || '-' || lpad(v_n::text, 4, '0');
end $$;
revoke all on function public._siguiente_recibo_caja_menor(uuid) from public, anon, authenticated;

create or replace function public.bot_registrar_caja_menor(p_borrador uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record; d jsonb; v_acum numeric; v_tope numeric; v_leg jsonb; v_gasto uuid; r record;
begin
  select * into b from telegram_borradores where id = p_borrador for update;
  if b.id is null then raise exception 'Borrador no encontrado'; end if;
  if b.estado <> 'PENDIENTE' then return jsonb_build_object('ya_procesado', true, 'estado', b.estado); end if;
  d := b.datos;
  insert into caja_menor_gastos (proyecto_id, fecha, valor, concepto, capitulo_id, soporte_path, remitente, borrador_id, presupuesto_item_id,
                                 beneficiario_nombre, beneficiario_documento, beneficiario_cuenta)
  values (b.proyecto_id, coalesce(nullif(d->>'fecha','')::date, current_date), (d->>'valor')::numeric,
          coalesce(nullif(d->>'concepto',''), 'Gasto de caja menor'), nullif(d->>'capitulo_id','')::uuid,
          b.soporte_path, b.remitente, b.id, nullif(d->>'presupuesto_item_id', '')::uuid,
          nullif(btrim(d->>'beneficiario_nombre'), ''), nullif(btrim(d->>'beneficiario_documento'), ''), nullif(btrim(d->>'beneficiario_cuenta'), ''))
  returning id into v_gasto;
  -- 065: sin foto ni PDF → se le asigna recibo de caja menor (el PDF lo genera el bot enseguida).
  if b.soporte_path is null then
    select * into r from public._siguiente_recibo_caja_menor(b.proyecto_id);
    update caja_menor_gastos set recibo_numero = r.numero, recibo_folio = r.folio where id = v_gasto;
  end if;
  update telegram_borradores set estado = 'CONFIRMADO' where id = b.id;
  select coalesce(sum(valor),0) into v_acum from caja_menor_gastos where proyecto_id = b.proyecto_id and oc_id is null;
  select coalesce(tope_caja_menor, 1000000) into v_tope from proyectos where id = b.proyecto_id;
  if v_acum >= v_tope then
    v_leg := public._legalizar_caja_menor_interno(b.proyecto_id);
  end if;
  return jsonb_build_object('acumulado', v_acum, 'tope', v_tope, 'legalizacion', v_leg, 'gasto_id', v_gasto,
                            'recibo_folio', (select recibo_folio from caja_menor_gastos where id = v_gasto));
end $$;

create or replace function public.asignar_recibo_caja_menor(p_gasto uuid, p_nombre text default null, p_documento text default null, p_cuenta text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; r record;
begin
  if auth.uid() is not null and not public.es_admin() then raise exception 'Solo un administrador puede generar recibos de caja menor.'; end if;
  select * into g from caja_menor_gastos where id = p_gasto for update;
  if g.id is null then raise exception 'El gasto de caja menor no existe.'; end if;
  if g.soporte_path is not null and g.recibo_folio is null then
    raise exception 'Este gasto ya tiene soporte del proveedor; no necesita recibo.';
  end if;
  update caja_menor_gastos set
    beneficiario_nombre = coalesce(nullif(btrim(p_nombre), ''), beneficiario_nombre),
    beneficiario_documento = coalesce(nullif(btrim(p_documento), ''), beneficiario_documento),
    beneficiario_cuenta = coalesce(nullif(btrim(p_cuenta), ''), beneficiario_cuenta)
  where id = g.id;
  if g.recibo_numero is null then
    select * into r from public._siguiente_recibo_caja_menor(g.proyecto_id);
    update caja_menor_gastos set recibo_numero = r.numero, recibo_folio = r.folio where id = g.id;
  end if;
  return jsonb_build_object('gasto_id', g.id, 'recibo_folio', (select recibo_folio from caja_menor_gastos where id = g.id));
end $$;
revoke all on function public.asignar_recibo_caja_menor(uuid, text, text, text) from public, anon;
grant execute on function public.asignar_recibo_caja_menor(uuid, text, text, text) to authenticated;

create or replace function public.datos_recibo_caja_menor(p_gasto uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.es_admin() then raise exception 'Solo un administrador puede ver el recibo.'; end if;
  return (select jsonb_build_object(
    'id', g.id, 'proyecto_id', g.proyecto_id, 'fecha', g.fecha, 'valor', g.valor, 'concepto', g.concepto,
    'remitente', g.remitente, 'recibo_folio', g.recibo_folio, 'creado_en', g.creado_en,
    'beneficiario_nombre', g.beneficiario_nombre, 'beneficiario_documento', g.beneficiario_documento, 'beneficiario_cuenta', g.beneficiario_cuenta,
    'capitulo', case when c.id is not null then c.codigo || ' · ' || c.nombre end,
    'item', case when i.id is not null then i.codigo || ' · ' || left(i.descripcion, 90) end,
    'proyecto', jsonb_build_object('nombre', p.nombre, 'codigo', p.codigo, 'mostrar_marca_habitatum', p.mostrar_marca_habitatum,
                                   'nombre_emisor', p.nombre_emisor, 'nit_empresa', p.nit_empresa, 'ciudad', p.ciudad))
    from caja_menor_gastos g join proyectos p on p.id = g.proyecto_id
    left join presupuesto_items i on i.id = g.presupuesto_item_id
    left join presupuesto_capitulos c on c.id = coalesce(g.capitulo_id, i.capitulo_id)
    where g.id = p_gasto);
end $$;
revoke all on function public.datos_recibo_caja_menor(uuid) from public, anon;
grant execute on function public.datos_recibo_caja_menor(uuid) to authenticated;
