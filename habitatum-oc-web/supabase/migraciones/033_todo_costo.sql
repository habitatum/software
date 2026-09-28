-- ============================================================
-- 033 · Modelo de contratación TODO COSTO
-- ------------------------------------------------------------
-- * proyectos.modelo_contratacion: ADMINISTRACION_DELEGADA (default) | TODO_COSTO
-- * proyectos.tope_caja_menor: tope para legalizar la caja menor en una OC (fase 4)
-- * proyectos_finanzas (SOLO ADMIN): facturación (AIU / IVA / SIN_FACTURA), % margen,
--   % A-I-U, valor contratado con el cliente, cuenta receptora.
-- * presupuesto_items_costo (SOLO ADMIN): costo de cada ítem. En proyectos todo costo,
--   presupuesto_items.valor_* guarda el PRECIO DE VENTA (lo único que ven los no-admin).
-- * presupuesto_capitulos.tipo_capitulo: CONTRATO (con utilidad) | ADICIONAL_COSTO (sin
--   utilidad, lo paga el cliente a HABITATUM) | PAGO_DIRECTO_CLIENTE (no pasa por caja).
-- * ordenes_compra.pagado_por_cliente, factura_proveedor; items_oc.capitulo_id
--   (imputación a nivel de capítulo cuando no hay ítem).
-- * movimientos_caja (SOLO ADMIN): ingresos del cliente, retiros de utilidad, ajustes.
-- * control_todo_costo(proyecto): tablero; solo devuelve costo/utilidad si es admin.
-- La restricción es a nivel de base de datos (RLS + funciones), no solo de interfaz.
-- ============================================================

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where id = auth.uid() and rol = 'admin' and coalesce(activo, true));
$$;
grant execute on function public.es_admin() to authenticated, service_role;

alter table public.proyectos add column if not exists modelo_contratacion text not null default 'ADMINISTRACION_DELEGADA'
  check (modelo_contratacion in ('ADMINISTRACION_DELEGADA','TODO_COSTO'));
alter table public.proyectos add column if not exists tope_caja_menor numeric(14,2) not null default 1000000;

create table if not exists public.proyectos_finanzas (
  proyecto_id uuid primary key references public.proyectos(id) on delete cascade,
  modalidad_facturacion text not null default 'SIN_FACTURA' check (modalidad_facturacion in ('AIU','IVA','SIN_FACTURA')),
  porcentaje_utilidad numeric(7,4) not null default 0,      -- margen total cuando NO es AIU
  porcentaje_a numeric(7,4) not null default 0,
  porcentaje_i numeric(7,4) not null default 0,
  porcentaje_u numeric(7,4) not null default 0,
  porcentaje_iva numeric(7,4) not null default 19,
  valor_contrato_cliente numeric(16,2),
  cuenta_receptora text not null default 'HABITATUM' check (cuenta_receptora in ('HABITATUM','PERSONAL')),
  cuenta_detalle text,
  actualizado_en timestamptz not null default now()
);
alter table public.proyectos_finanzas enable row level security;
drop policy if exists proyectos_finanzas_admin on public.proyectos_finanzas;
create policy proyectos_finanzas_admin on public.proyectos_finanzas for all using (public.es_admin()) with check (public.es_admin());

alter table public.presupuesto_capitulos add column if not exists tipo_capitulo text not null default 'CONTRATO'
  check (tipo_capitulo in ('CONTRATO','ADICIONAL_COSTO','PAGO_DIRECTO_CLIENTE'));

create table if not exists public.presupuesto_items_costo (
  presupuesto_item_id uuid primary key references public.presupuesto_items(id) on delete cascade,
  valor_unitario_costo numeric(16,2),
  valor_parcial_costo numeric(16,2) not null default 0
);
alter table public.presupuesto_items_costo enable row level security;
drop policy if exists presupuesto_items_costo_admin on public.presupuesto_items_costo;
create policy presupuesto_items_costo_admin on public.presupuesto_items_costo for all using (public.es_admin()) with check (public.es_admin());

alter table public.ordenes_compra add column if not exists pagado_por_cliente boolean not null default false;
alter table public.ordenes_compra add column if not exists factura_proveedor text;
alter table public.items_oc add column if not exists capitulo_id uuid references public.presupuesto_capitulos(id) on delete set null;

create table if not exists public.movimientos_caja (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  fecha date not null default current_date,
  tipo text not null check (tipo in ('INGRESO_CLIENTE','RETIRO_UTILIDAD','AJUSTE')),
  valor numeric(16,2) not null,
  concepto text,
  soporte_url text,
  registrado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now()
);
alter table public.movimientos_caja enable row level security;
drop policy if exists movimientos_caja_admin on public.movimientos_caja;
create policy movimientos_caja_admin on public.movimientos_caja for all using (public.es_admin()) with check (public.es_admin());

-- Factor de precio de venta del proyecto (1 + margen). Solo uso interno.
create or replace function public.factor_venta_proyecto(p_proyecto uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select 1 + case when f.modalidad_facturacion = 'AIU'
                                   then (f.porcentaje_a + f.porcentaje_i + f.porcentaje_u) / 100
                                   else f.porcentaje_utilidad / 100 end
                   from proyectos_finanzas f where f.proyecto_id = p_proyecto), 1);
$$;
revoke all on function public.factor_venta_proyecto(uuid) from public, anon, authenticated;

-- Recalcula el precio de venta de todo el presupuesto a partir del costo (solo admin).
-- CONTRATO: venta = costo × factor. ADICIONAL_COSTO y PAGO_DIRECTO_CLIENTE: venta = costo.
create or replace function public.recalcular_venta_presupuesto(p_proyecto uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_f numeric; v_pres uuid;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo un administrador puede recalcular el presupuesto';
  end if;
  v_f := public.factor_venta_proyecto(p_proyecto);
  select id into v_pres from presupuestos where proyecto_id = p_proyecto;
  if v_pres is null then return; end if;

  update presupuesto_items pi set
    valor_unitario = case when c.valor_unitario_costo is null then pi.valor_unitario
                          else round(c.valor_unitario_costo * case when cap.tipo_capitulo = 'CONTRATO' then v_f else 1 end, 2) end,
    valor_parcial  = round(c.valor_parcial_costo * case when cap.tipo_capitulo = 'CONTRATO' then v_f else 1 end, 0)
  from presupuesto_items_costo c, presupuesto_capitulos cap
  where c.presupuesto_item_id = pi.id and cap.id = pi.capitulo_id and cap.presupuesto_id = v_pres;

  update presupuesto_capitulos cap set valor_presupuestado =
    coalesce((select sum(valor_parcial) from presupuesto_items where capitulo_id = cap.id), 0)
  where cap.presupuesto_id = v_pres;

  update presupuestos set
    total_costos_directos = (select coalesce(sum(valor_presupuestado),0) from presupuesto_capitulos where presupuesto_id = v_pres),
    total_costos_indirectos = 0,
    valor_total = (select coalesce(sum(valor_presupuestado),0) from presupuesto_capitulos where presupuesto_id = v_pres)
  where id = v_pres;
end $$;
revoke all on function public.recalcular_venta_presupuesto(uuid) from public, anon;
grant execute on function public.recalcular_venta_presupuesto(uuid) to authenticated, service_role;

-- Convierte el presupuesto actual (cargado a costo) en presupuesto todo costo:
-- copia valor_* actual como costo y recalcula la venta. Solo admin. Idempotente:
-- solo copia costo de ítems que aún no lo tienen.
create or replace function public.convertir_presupuesto_a_todo_costo(p_proyecto uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo un administrador puede convertir el presupuesto';
  end if;
  insert into presupuesto_items_costo (presupuesto_item_id, valor_unitario_costo, valor_parcial_costo)
  select pi.id, pi.valor_unitario, coalesce(pi.valor_parcial, 0)
  from presupuesto_items pi
  join presupuesto_capitulos cap on cap.id = pi.capitulo_id
  join presupuestos p on p.id = cap.presupuesto_id
  where p.proyecto_id = p_proyecto
  on conflict (presupuesto_item_id) do nothing;
  perform public.recalcular_venta_presupuesto(p_proyecto);
end $$;
revoke all on function public.convertir_presupuesto_a_todo_costo(uuid) from public, anon;
grant execute on function public.convertir_presupuesto_a_todo_costo(uuid) to authenticated, service_role;

-- Tablero de control presupuestal TODO COSTO. Costo y utilidad solo si es admin.
-- Ejecutado = valor de los ítems de OC vigentes (no anticipos), con su parte proporcional
-- de IVA/AIU/descuento, imputados a ítem (items_oc_presupuesto) o a capítulo (items_oc.capitulo_id).
create or replace function public.control_todo_costo(p_proyecto uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := (auth.uid() is null) or public.es_admin(); v_res jsonb; v_pres uuid;
begin
  select id into v_pres from presupuestos where proyecto_id = p_proyecto;
  if v_pres is null then return jsonb_build_object('presupuesto', null); end if;

  with oc as (
    select * from v_ordenes_compra_calculadas
    where proyecto_id = p_proyecto and estado <> 'ANULADA' and tipo_pago <> 'ANTICIPO'
  ),
  lineas as (
    select io.id item_oc_id, io.capitulo_id,
      (io.cantidad * io.valor_unitario) + case when coalesce(oc.subtotal_items,0) <= 0 then 0
        else io.cantidad * io.valor_unitario / oc.subtotal_items * (coalesce(oc.valor_iva,0) + coalesce(oc.valor_aiu,0) - coalesce(oc.descuento,0)) end as valor
    from items_oc io join oc on oc.id = io.orden_compra_id
  ),
  imp_item as (
    select iop.presupuesto_item_id, sum(l.valor * iop.porcentaje / 100) ejecutado
    from items_oc_presupuesto iop join lineas l on l.item_oc_id = iop.item_oc_id
    group by 1
  ),
  imp_cap as (
    select l.capitulo_id, sum(l.valor) ejecutado
    from lineas l
    where l.capitulo_id is not null and not exists (select 1 from items_oc_presupuesto iop where iop.item_oc_id = l.item_oc_id)
    group by 1
  ),
  sin_imputar as (
    select coalesce(sum(l.valor * (1 - coalesce((select sum(porcentaje) from items_oc_presupuesto iop where iop.item_oc_id = l.item_oc_id),0) / 100)),0) valor
    from lineas l where l.capitulo_id is null
  ),
  items as (
    select pi.*, cap.id cap_id, coalesce(ii.ejecutado,0) ejecutado, pc.valor_parcial_costo costo, pc.valor_unitario_costo costo_unitario
    from presupuesto_items pi
    join presupuesto_capitulos cap on cap.id = pi.capitulo_id
    left join imp_item ii on ii.presupuesto_item_id = pi.id
    left join presupuesto_items_costo pc on pc.presupuesto_item_id = pi.id
    where cap.presupuesto_id = v_pres
  ),
  caps as (
    select cap.id, cap.codigo, cap.nombre, cap.tipo_capitulo, cap.orden,
      coalesce((select sum(valor_parcial) from items where cap_id = cap.id),0) venta,
      coalesce((select sum(costo) from items where cap_id = cap.id),0) costo,
      coalesce((select sum(ejecutado) from items where cap_id = cap.id),0) + coalesce((select ejecutado from imp_cap where capitulo_id = cap.id),0) ejecutado,
      coalesce((select ejecutado from imp_cap where capitulo_id = cap.id),0) ejecutado_capitulo,
      (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', i.id, 'codigo', i.codigo, 'descripcion', i.descripcion, 'unidad', i.unidad, 'cantidad', i.cantidad,
          'venta', i.valor_parcial, 'ejecutado', round(i.ejecutado,2),
          'costo', case when v_admin then i.costo end,
          'costo_unitario', case when v_admin then i.costo_unitario end,
          'venta_unitario', i.valor_unitario
        )) order by i.orden) from items i where i.cap_id = cap.id) items
    from presupuesto_capitulos cap where cap.presupuesto_id = v_pres
  )
  select jsonb_build_object(
    'es_admin', v_admin,
    'presupuesto', jsonb_build_object('id', v_pres),
    'capitulos', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', c.id, 'codigo', c.codigo, 'nombre', c.nombre, 'tipo', c.tipo_capitulo,
        'venta', c.venta, 'ejecutado', round(c.ejecutado,2), 'ejecutado_capitulo', round(c.ejecutado_capitulo,2),
        'costo', case when v_admin then c.costo end,
        'utilidad_presupuestada', case when v_admin then c.venta - c.costo end,
        'items', coalesce(c.items, '[]'::jsonb)
      )) order by c.orden) from caps c), '[]'::jsonb),
    'totales', (select jsonb_strip_nulls(jsonb_build_object(
        'venta', sum(venta), 'ejecutado', round(sum(ejecutado),2),
        'costo', case when v_admin then sum(costo) end,
        'utilidad_presupuestada', case when v_admin then sum(venta) - sum(costo) end)) from caps),
    'sin_imputar', (select round(valor,2) from sin_imputar),
    'finanzas', case when v_admin then (select to_jsonb(f) - 'proyecto_id' from proyectos_finanzas f where f.proyecto_id = p_proyecto) end,
    'caja', case when v_admin then (select jsonb_build_object(
        'ingresos_cliente', coalesce(sum(valor) filter (where tipo = 'INGRESO_CLIENTE'),0),
        'retiros_utilidad', coalesce(sum(valor) filter (where tipo = 'RETIRO_UTILIDAD'),0),
        'ajustes', coalesce(sum(valor) filter (where tipo = 'AJUSTE'),0))
      from movimientos_caja where proyecto_id = p_proyecto) end
  ) into v_res;
  return jsonb_strip_nulls(v_res);  -- sin llaves vacías para no-admin
end $$;
revoke all on function public.control_todo_costo(uuid) from public, anon;
grant execute on function public.control_todo_costo(uuid) to authenticated, service_role;
