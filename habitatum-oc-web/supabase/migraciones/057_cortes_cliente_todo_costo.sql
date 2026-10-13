-- 057 · Cortes de cobro y liquidación al CLIENTE en proyectos TODO COSTO (solo admin).
-- Cada corte acumula por capítulo, en modo CANTIDAD (cantidades por ítem) o GLOBAL (% de avance
-- acumulado del capítulo). El último corte puede marcarse como Liquidación final.
-- Capítulos PAGO_DIRECTO_CLIENTE (ej. cap. 14) se muestran pero NO suman al total liquidado.
-- Saldo = total liquidado acumulado − pagos del cliente (movimientos_caja INGRESO_CLIENTE hasta la fecha del corte).
-- No borra ni modifica datos existentes: solo tablas y funciones nuevas. No se borran filas: anular = estado ANULADO.

create table if not exists public.cortes_cliente (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id),
  numero integer not null,
  fecha date not null default current_date,
  es_final boolean not null default false,
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR','CERRADO','ANULADO')),
  notas text,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  cerrado_por uuid,
  cerrado_en timestamptz
);
create unique index if not exists cortes_cliente_numero_uq on public.cortes_cliente (proyecto_id, numero) where estado <> 'ANULADO';

create table if not exists public.cortes_cliente_capitulos (
  corte_id uuid not null references public.cortes_cliente(id),
  capitulo_id uuid not null references public.presupuesto_capitulos(id),
  modo text not null default 'CANTIDAD' check (modo in ('CANTIDAD','GLOBAL')),
  porcentaje numeric not null default 0 check (porcentaje >= 0 and porcentaje <= 100),
  primary key (corte_id, capitulo_id)
);

create table if not exists public.cortes_cliente_items (
  corte_id uuid not null references public.cortes_cliente(id),
  presupuesto_item_id uuid not null references public.presupuesto_items(id),
  cantidad numeric not null default 0,
  primary key (corte_id, presupuesto_item_id)
);

alter table public.cortes_cliente enable row level security;
alter table public.cortes_cliente_capitulos enable row level security;
alter table public.cortes_cliente_items enable row level security;
create policy cortes_cliente_admin on public.cortes_cliente for select using (public.es_admin());
create policy cortes_cliente_cap_admin on public.cortes_cliente_capitulos for select using (public.es_admin());
create policy cortes_cliente_items_admin on public.cortes_cliente_items for select using (public.es_admin());
revoke all on public.cortes_cliente, public.cortes_cliente_capitulos, public.cortes_cliente_items from anon, authenticated;
grant select on public.cortes_cliente, public.cortes_cliente_capitulos, public.cortes_cliente_items to authenticated;

-- Ítem "contratado": si no tiene cantidad/unitario se toma como 1 global por su valor parcial.
create or replace function public._cc_items(p_cap uuid)
returns table(id uuid, codigo text, descripcion text, unidad text, orden integer, vp numeric, qc numeric, vu numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.codigo, i.descripcion,
         case when i.cantidad is null or i.valor_unitario is null then coalesce(i.unidad,'Glb') else i.unidad end,
         i.orden, coalesce(i.valor_parcial,0),
         case when i.cantidad is null or i.valor_unitario is null then 1 else i.cantidad end,
         case when i.cantidad is null or i.valor_unitario is null then coalesce(i.valor_parcial,0) else i.valor_unitario end
  from presupuesto_items i where i.capitulo_id = p_cap
$$;

-- Valor de una cantidad acumulada: si iguala la contratada se usa el valor parcial exacto (sin redondeos).
create or replace function public._cc_valor(p_q numeric, p_qc numeric, p_vu numeric, p_vp numeric)
returns numeric language sql immutable as $$
  select case when coalesce(p_q,0) = 0 then 0 when p_q = p_qc then p_vp else round(p_q * p_vu) end
$$;

-- Cantidad acumulada de un ítem hasta el corte p_corte (inclusive).
create or replace function public._cc_q_acum(p_corte uuid, p_item uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(ci.cantidad),0)
  from cortes_cliente_items ci join cortes_cliente k on k.id = ci.corte_id
  join cortes_cliente c on c.id = p_corte
  where ci.presupuesto_item_id = p_item and k.proyecto_id = c.proyecto_id and k.estado <> 'ANULADO' and k.numero <= c.numero
$$;

-- Valor acumulado de un capítulo en un corte (según el modo de ese corte).
create or replace function public._cc_valor_cap(p_corte uuid, p_cap uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_modo text; v_pct numeric;
begin
  if p_corte is null then return 0; end if;
  select modo, porcentaje into v_modo, v_pct from cortes_cliente_capitulos where corte_id = p_corte and capitulo_id = p_cap;
  if v_modo = 'GLOBAL' then
    return round((select coalesce(sum(valor_parcial),0) from presupuesto_items where capitulo_id = p_cap) * coalesce(v_pct,0) / 100);
  end if;
  return coalesce((select sum(public._cc_valor(public._cc_q_acum(p_corte, i.id), i.qc, i.vu, i.vp)) from public._cc_items(p_cap) i), 0);
end $$;

create or replace function public._cc_anterior(p_corte uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select k.id from cortes_cliente k join cortes_cliente c on c.id = p_corte
  where k.proyecto_id = c.proyecto_id and k.estado <> 'ANULADO' and k.numero < c.numero
  order by k.numero desc limit 1
$$;

revoke all on function public._cc_items(uuid), public._cc_q_acum(uuid, uuid), public._cc_valor_cap(uuid, uuid), public._cc_anterior(uuid) from public, anon, authenticated;

-- Detalle completo de un corte (pantalla, PDF y Excel).
create or replace function public.corte_cliente_detalle(p_corte uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; v_prev uuid; v_pres uuid; v_caps jsonb; v_pagos jsonb; v_res jsonb;
  v_tot_pagos numeric;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede ver los cortes al cliente.'; end if;
  select * into c from cortes_cliente where id = p_corte;
  if c.id is null then raise exception 'Corte no encontrado.'; end if;
  v_prev := public._cc_anterior(p_corte);
  select id into v_pres from presupuestos where proyecto_id = c.proyecto_id;

  select coalesce(jsonb_agg(x.j order by x.orden), '[]'::jsonb) into v_caps from (
    select cap.orden, jsonb_build_object(
      'id', cap.id, 'codigo', cap.codigo, 'nombre', cap.nombre, 'tipo', cap.tipo_capitulo,
      'modo', coalesce(m.modo, 'CANTIDAD'), 'porcentaje', coalesce(m.porcentaje, 0),
      'porcentaje_anterior', coalesce(mp.porcentaje, 0), 'modo_anterior', mp.modo,
      'contratado', (select coalesce(sum(valor_parcial),0) from presupuesto_items where capitulo_id = cap.id),
      'anterior', public._cc_valor_cap(v_prev, cap.id),
      'acumulado', public._cc_valor_cap(p_corte, cap.id),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id, 'codigo', i.codigo, 'descripcion', i.descripcion, 'unidad', i.unidad,
          'contratado', i.qc, 'valor_unitario', i.vu, 'valor_contratado', i.vp,
          'anterior', qa.ant, 'este', coalesce(ci.cantidad, 0), 'acumulado', qa.ant + coalesce(ci.cantidad, 0),
          'valor_anterior', public._cc_valor(qa.ant, i.qc, i.vu, i.vp),
          'valor_acumulado', public._cc_valor(qa.ant + coalesce(ci.cantidad, 0), i.qc, i.vu, i.vp)
        ) order by i.orden, i.codigo)
        from public._cc_items(cap.id) i
        cross join lateral (select case when v_prev is null then 0 else public._cc_q_acum(v_prev, i.id) end ant) qa
        left join cortes_cliente_items ci on ci.corte_id = p_corte and ci.presupuesto_item_id = i.id), '[]'::jsonb)
    ) j
    from presupuesto_capitulos cap
    left join cortes_cliente_capitulos m on m.corte_id = p_corte and m.capitulo_id = cap.id
    left join cortes_cliente_capitulos mp on mp.corte_id = v_prev and mp.capitulo_id = cap.id
    where cap.presupuesto_id = v_pres
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('fecha', fecha, 'valor', valor, 'concepto', concepto) order by fecha, creado_en), '[]'::jsonb),
         coalesce(sum(valor), 0)
    into v_pagos, v_tot_pagos
  from movimientos_caja where proyecto_id = c.proyecto_id and tipo = 'INGRESO_CLIENTE' and fecha <= c.fecha;

  select jsonb_build_object(
    'corte', to_jsonb(c),
    'anterior_id', v_prev,
    'numero_anterior', (select numero from cortes_cliente where id = v_prev),
    'proyecto', (select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'cliente', p.cliente, 'ciudad', p.ciudad,
                   'direccion_obra', p.direccion_obra, 'mostrar_marca_habitatum', p.mostrar_marca_habitatum,
                   'nombre_emisor', p.nombre_emisor, 'nit_empresa', p.nit_empresa, 'representante_legal', p.representante_legal)
                 from proyectos p where p.id = c.proyecto_id),
    'capitulos', v_caps,
    'pagos', v_pagos,
    'totales', (select jsonb_build_object(
        'contratado', coalesce(sum((x->>'contratado')::numeric) filter (where x->>'tipo' <> 'PAGO_DIRECTO_CLIENTE'), 0),
        'anterior', coalesce(sum((x->>'anterior')::numeric) filter (where x->>'tipo' <> 'PAGO_DIRECTO_CLIENTE'), 0),
        'acumulado', coalesce(sum((x->>'acumulado')::numeric) filter (where x->>'tipo' <> 'PAGO_DIRECTO_CLIENTE'), 0),
        'contrato_acumulado', coalesce(sum((x->>'acumulado')::numeric) filter (where coalesce(x->>'tipo','CONTRATO') = 'CONTRATO'), 0),
        'adicionales_acumulado', coalesce(sum((x->>'acumulado')::numeric) filter (where x->>'tipo' = 'ADICIONAL_COSTO'), 0),
        'informativo_acumulado', coalesce(sum((x->>'acumulado')::numeric) filter (where x->>'tipo' = 'PAGO_DIRECTO_CLIENTE'), 0),
        'pagos', v_tot_pagos)
      from jsonb_array_elements(v_caps) x)
  ) into v_res;
  v_res := jsonb_set(v_res, '{totales,este_corte}', to_jsonb((v_res#>>'{totales,acumulado}')::numeric - (v_res#>>'{totales,anterior}')::numeric));
  v_res := jsonb_set(v_res, '{totales,saldo}', to_jsonb((v_res#>>'{totales,acumulado}')::numeric - v_tot_pagos));
  return v_res;
end $$;

-- Lista de cortes del proyecto con sus totales.
create or replace function public.cortes_cliente_lista(p_proyecto uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pres uuid;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede ver los cortes al cliente.'; end if;
  select id into v_pres from presupuestos where proyecto_id = p_proyecto;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', k.id, 'numero', k.numero, 'fecha', k.fecha, 'es_final', k.es_final, 'estado', k.estado, 'notas', k.notas,
      'acumulado', t.acum, 'este_corte', t.acum - t.ant,
      'pagos', (select coalesce(sum(valor),0) from movimientos_caja where proyecto_id = p_proyecto and tipo = 'INGRESO_CLIENTE' and fecha <= k.fecha)
    ) order by k.numero)
    from cortes_cliente k
    cross join lateral (
      select coalesce(sum(public._cc_valor_cap(k.id, cap.id)),0) acum,
             coalesce(sum(public._cc_valor_cap(public._cc_anterior(k.id), cap.id)),0) ant
      from presupuesto_capitulos cap where cap.presupuesto_id = v_pres and coalesce(cap.tipo_capitulo,'CONTRATO') <> 'PAGO_DIRECTO_CLIENTE') t
    where k.proyecto_id = p_proyecto and k.estado <> 'ANULADO'), '[]'::jsonb);
end $$;

-- Crear corte nuevo (copia los modos y % del corte anterior).
create or replace function public.crear_corte_cliente(p_proyecto uuid, p_fecha date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prev record; v_num integer; v_pres uuid;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede crear cortes al cliente.'; end if;
  if (select modelo_contratacion from proyectos where id = p_proyecto) is distinct from 'TODO_COSTO' then
    raise exception 'Los cortes al cliente son solo para proyectos todo costo.'; end if;
  select id into v_pres from presupuestos where proyecto_id = p_proyecto;
  if v_pres is null then raise exception 'El proyecto no tiene presupuesto cargado.'; end if;
  if exists (select 1 from cortes_cliente where proyecto_id = p_proyecto and estado = 'BORRADOR') then
    raise exception 'Ya hay un corte abierto. Ciérrelo o anúlelo antes de crear otro.'; end if;
  if exists (select 1 from cortes_cliente where proyecto_id = p_proyecto and estado = 'CERRADO' and es_final) then
    raise exception 'La obra ya tiene la liquidación final cerrada.'; end if;
  select * into v_prev from cortes_cliente where proyecto_id = p_proyecto and estado <> 'ANULADO' order by numero desc limit 1;
  if v_prev.id is not null and p_fecha < v_prev.fecha then
    raise exception 'La fecha no puede ser anterior al corte No. % (%).', v_prev.numero, v_prev.fecha; end if;
  v_num := coalesce(v_prev.numero, 0) + 1;
  insert into cortes_cliente (proyecto_id, numero, fecha) values (p_proyecto, v_num, coalesce(p_fecha, current_date)) returning id into v_id;
  insert into cortes_cliente_capitulos (corte_id, capitulo_id, modo, porcentaje)
  select v_id, cap.id,
         coalesce(mp.modo, case when exists (select 1 from presupuesto_items i where i.capitulo_id = cap.id and (i.cantidad is null or i.valor_unitario is null))
                                 then 'GLOBAL' else 'CANTIDAD' end),
         coalesce(mp.porcentaje, 0)
  from presupuesto_capitulos cap
  left join cortes_cliente_capitulos mp on mp.corte_id = v_prev.id and mp.capitulo_id = cap.id
  where cap.presupuesto_id = v_pres;
  return v_id;
end $$;

-- Guardar el borrador: fecha, final, notas, modos/% por capítulo y cantidades del periodo por ítem.
-- p_capitulos: [{capitulo_id, modo, porcentaje}]  ·  p_items: [{item_id, cantidad}]
create or replace function public.guardar_corte_cliente(p_corte uuid, p_fecha date, p_final boolean, p_notas text,
  p_capitulos jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v_prev record; v_mal text;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede modificar cortes al cliente.'; end if;
  select * into c from cortes_cliente where id = p_corte for update;
  if c.id is null then raise exception 'Corte no encontrado.'; end if;
  if c.estado <> 'BORRADOR' then raise exception 'El corte No. % está cerrado y no se puede modificar.', c.numero; end if;
  select * into v_prev from cortes_cliente where id = public._cc_anterior(p_corte);
  if v_prev.id is not null and p_fecha < v_prev.fecha then
    raise exception 'La fecha no puede ser anterior al corte No. % (%).', v_prev.numero, v_prev.fecha; end if;

  update cortes_cliente set fecha = coalesce(p_fecha, fecha), es_final = coalesce(p_final, false), notas = nullif(trim(p_notas), '')
  where id = p_corte;

  insert into cortes_cliente_capitulos (corte_id, capitulo_id, modo, porcentaje)
  select p_corte, (x->>'capitulo_id')::uuid, coalesce(x->>'modo','CANTIDAD'), coalesce(nullif(x->>'porcentaje','')::numeric, 0)
  from jsonb_array_elements(coalesce(p_capitulos, '[]'::jsonb)) x
  join presupuesto_capitulos cap on cap.id = (x->>'capitulo_id')::uuid
  join presupuestos pr on pr.id = cap.presupuesto_id and pr.proyecto_id = c.proyecto_id
  on conflict (corte_id, capitulo_id) do update set modo = excluded.modo, porcentaje = excluded.porcentaje;

  insert into cortes_cliente_items (corte_id, presupuesto_item_id, cantidad)
  select p_corte, (x->>'item_id')::uuid, coalesce(nullif(x->>'cantidad','')::numeric, 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  join presupuesto_items i on i.id = (x->>'item_id')::uuid
  join presupuesto_capitulos cap on cap.id = i.capitulo_id
  join presupuestos pr on pr.id = cap.presupuesto_id and pr.proyecto_id = c.proyecto_id
  on conflict (corte_id, presupuesto_item_id) do update set cantidad = excluded.cantidad;

  select string_agg(i.codigo, ', ') into v_mal
  from cortes_cliente_items ci join presupuesto_items i on i.id = ci.presupuesto_item_id
  where ci.corte_id = p_corte and public._cc_q_acum(p_corte, i.id) < 0;
  if v_mal is not null then raise exception 'La cantidad acumulada no puede quedar negativa (ítems %).', v_mal; end if;

  return public.corte_cliente_detalle(p_corte);
end $$;

create or replace function public.cerrar_corte_cliente(p_corte uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede cerrar cortes al cliente.'; end if;
  select * into c from cortes_cliente where id = p_corte for update;
  if c.id is null or c.estado <> 'BORRADOR' then raise exception 'Solo se puede cerrar un corte abierto.'; end if;
  update cortes_cliente set estado = 'CERRADO', cerrado_por = auth.uid(), cerrado_en = now() where id = p_corte;
  return jsonb_build_object('ok', true);
end $$;

-- Anular: solo el último corte y mientras siga abierto (no se borra, queda como ANULADO).
create or replace function public.anular_corte_cliente(p_corte uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede anular cortes al cliente.'; end if;
  select * into c from cortes_cliente where id = p_corte for update;
  if c.id is null or c.estado <> 'BORRADOR' then raise exception 'Solo se puede anular un corte abierto.'; end if;
  if exists (select 1 from cortes_cliente where proyecto_id = c.proyecto_id and estado <> 'ANULADO' and numero > c.numero) then
    raise exception 'Solo se puede anular el último corte.'; end if;
  update cortes_cliente set estado = 'ANULADO' where id = p_corte;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.corte_cliente_detalle(uuid), public.cortes_cliente_lista(uuid), public.crear_corte_cliente(uuid, date),
  public.guardar_corte_cliente(uuid, date, boolean, text, jsonb, jsonb), public.cerrar_corte_cliente(uuid), public.anular_corte_cliente(uuid)
  from public, anon;
grant execute on function public.corte_cliente_detalle(uuid), public.cortes_cliente_lista(uuid), public.crear_corte_cliente(uuid, date),
  public.guardar_corte_cliente(uuid, date, boolean, text, jsonb, jsonb), public.cerrar_corte_cliente(uuid), public.anular_corte_cliente(uuid)
  to authenticated;
