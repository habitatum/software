-- ============================================================
-- 035 · Caja de proyectos TODO COSTO (solo admin)
-- * plan_pagos_cliente: hitos de pago pactados con el cliente.
-- * conciliaciones_caja: saldo real de la cuenta receptora en una fecha.
-- * movimientos_caja.beneficiario: socio que recibe un retiro de utilidad.
-- * caja_proyecto(proyecto): resumen de caja, por cobrar, compromisos,
--   costo por ejecutar, conciliación y retiro máximo sugerido.
-- ============================================================
alter table public.movimientos_caja add column if not exists beneficiario text;

create table if not exists public.plan_pagos_cliente (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  orden int not null default 0,
  concepto text not null,
  valor numeric(16,2) not null,
  fecha_estimada date,
  creado_en timestamptz not null default now()
);
alter table public.plan_pagos_cliente enable row level security;
drop policy if exists plan_pagos_cliente_admin on public.plan_pagos_cliente;
create policy plan_pagos_cliente_admin on public.plan_pagos_cliente for all using (public.es_admin()) with check (public.es_admin());

create table if not exists public.conciliaciones_caja (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  fecha date not null default current_date,
  saldo_banco numeric(16,2) not null,
  nota text,
  registrado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now()
);
alter table public.conciliaciones_caja enable row level security;
drop policy if exists conciliaciones_caja_admin on public.conciliaciones_caja;
create policy conciliaciones_caja_admin on public.conciliaciones_caja for all using (public.es_admin()) with check (public.es_admin());

create or replace function public.caja_proyecto(p_proyecto uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ctrl jsonb; v_fin record;
  v_ing numeric; v_ret numeric; v_aju numeric; v_hist numeric; v_oc numeric;
  v_retenidos numeric; v_adic numeric; v_contrato numeric; v_por_ejecutar numeric;
  v_saldo numeric; v_por_cobrar numeric; v_conc record; v_res jsonb;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo un administrador puede ver la caja del proyecto';
  end if;
  select * into v_fin from proyectos_finanzas where proyecto_id = p_proyecto;
  v_ctrl := public.control_todo_costo(p_proyecto);

  select coalesce(sum(valor) filter (where tipo='INGRESO_CLIENTE'),0),
         coalesce(sum(valor) filter (where tipo='RETIRO_UTILIDAD'),0),
         coalesce(sum(valor) filter (where tipo='AJUSTE'),0)
    into v_ing, v_ret, v_aju from movimientos_caja where proyecto_id = p_proyecto;

  select coalesce(sum(valor),0) into v_hist from ejecutado_historico where proyecto_id = p_proyecto;

  -- Egresos por OC posteriores al histórico, pagadas desde la caja de HABITATUM.
  select coalesce(sum(v.neto_a_pagar),0) into v_oc
  from v_ordenes_compra_calculadas v join ordenes_compra o on o.id = v.id
  where v.proyecto_id = p_proyecto and v.estado <> 'ANULADA' and not o.excluir_control and not o.pagado_por_cliente;

  -- Retenidos por devolver a contratistas (solo los que paga HABITATUM).
  select coalesce(sum(coalesce(v.valor_retenido,0) - coalesce(v.devolucion_retenido,0)),0) into v_retenidos
  from v_ordenes_compra_calculadas v join ordenes_compra o on o.id = v.id
  where v.proyecto_id = p_proyecto and v.estado <> 'ANULADA' and not o.pagado_por_cliente;

  -- Adicionales cobrables al cliente = venta de capítulos ADICIONAL_COSTO.
  select coalesce(sum((c->>'venta')::numeric),0) into v_adic
  from jsonb_array_elements(coalesce(v_ctrl->'capitulos','[]'::jsonb)) c where c->>'tipo' = 'ADICIONAL_COSTO';

  -- Costo que falta por ejecutar en capítulos que paga HABITATUM.
  select coalesce(sum(greatest(coalesce((c->>'costo')::numeric,0) - coalesce((c->>'ejecutado')::numeric,0), 0)),0) into v_por_ejecutar
  from jsonb_array_elements(coalesce(v_ctrl->'capitulos','[]'::jsonb)) c where c->>'tipo' <> 'PAGO_DIRECTO_CLIENTE';

  v_contrato := coalesce(v_fin.valor_contrato_cliente, 0);
  v_saldo := v_ing - v_hist - v_oc - v_ret + v_aju;
  v_por_cobrar := greatest(v_contrato + v_adic - v_ing, 0);

  select * into v_conc from conciliaciones_caja where proyecto_id = p_proyecto order by fecha desc, creado_en desc limit 1;

  select jsonb_build_object(
    'finanzas', to_jsonb(v_fin) - 'proyecto_id',
    'contrato', jsonb_build_object('valor_base', v_contrato, 'adicionales', v_adic, 'total', v_contrato + v_adic),
    'ingresos', v_ing, 'por_cobrar', v_por_cobrar,
    'egresos', jsonb_build_object('historico', v_hist, 'ordenes_compra', v_oc, 'total', v_hist + v_oc),
    'retiros_utilidad', v_ret, 'ajustes', v_aju,
    'saldo_libros', v_saldo,
    'compromisos', jsonb_build_object('retenidos_por_devolver', v_retenidos, 'costo_por_ejecutar', v_por_ejecutar),
    'conciliacion', case when v_conc.id is null then null else jsonb_build_object(
        'fecha', v_conc.fecha, 'saldo_banco', v_conc.saldo_banco, 'nota', v_conc.nota,
        'diferencia', v_conc.saldo_banco - v_saldo) end,
    -- Caja al cierre si se cobra todo lo pendiente y se paga todo lo que falta.
    'caja_proyectada_cierre', v_saldo + v_por_cobrar - v_por_ejecutar - v_retenidos,
    -- Máximo retirable hoy sin desfinanciar la obra (sobre libros y sobre banco).
    'retiro_maximo_libros', greatest(v_saldo - v_retenidos - greatest(v_por_ejecutar - v_por_cobrar, 0), 0),
    'retiro_maximo_banco', case when v_conc.id is null then null
        else greatest(v_conc.saldo_banco - v_retenidos - greatest(v_por_ejecutar - v_por_cobrar, 0), 0) end,
    'deficit_banco', case when v_conc.id is null then null
        else least(v_conc.saldo_banco - v_retenidos - greatest(v_por_ejecutar - v_por_cobrar, 0), 0) end,
    'plan_pagos', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'orden', p.orden, 'concepto', p.concepto, 'valor', p.valor,
                 'fecha_estimada', p.fecha_estimada,
                 'recibido', least(p.valor, greatest(v_ing - (p.acumulado - p.valor), 0)),
                 'estado', case when v_ing >= p.acumulado then 'PAGADO'
                                when v_ing > p.acumulado - p.valor then 'PARCIAL'
                                when p.fecha_estimada is not null and p.fecha_estimada < current_date then 'VENCIDO'
                                else 'PENDIENTE' end) order by p.orden, p.creado_en)
        from (select pp.*, sum(pp.valor) over (order by pp.orden, pp.creado_en) acumulado
              from plan_pagos_cliente pp where pp.proyecto_id = p_proyecto) p), '[]'::jsonb),
    'movimientos', coalesce((select jsonb_agg(to_jsonb(m) - 'proyecto_id' order by m.fecha desc, m.creado_en desc)
        from movimientos_caja m where m.proyecto_id = p_proyecto), '[]'::jsonb),
    'conciliaciones', coalesce((select jsonb_agg(to_jsonb(c) - 'proyecto_id' order by c.fecha desc, c.creado_en desc)
        from conciliaciones_caja c where c.proyecto_id = p_proyecto), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.caja_proyecto(uuid) from public, anon;
grant execute on function public.caja_proyecto(uuid) to authenticated, service_role;
