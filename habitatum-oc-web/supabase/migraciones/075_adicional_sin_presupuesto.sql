-- 075 · Adicionales en obras sin presupuesto cargado (07/11/2026)
-- editar_adicional_contrato (074) exigía capítulo; si el proyecto no tiene presupuesto, el capítulo es opcional.
do $do$
declare v text;
begin
  v := pg_get_functiondef('public.editar_adicional_contrato(uuid, text, text, uuid, numeric)'::regprocedure);
  if position('if v_cap is null then raise exception ''El adicional necesita el capítulo del presupuesto''; end if;' in v) = 0 then
    raise exception 'texto esperado no encontrado (1)';
  end if;
  v := replace(v,
    'if v_cap is null then raise exception ''El adicional necesita el capítulo del presupuesto''; end if;
  if not exists',
    'if v_cap is null and exists (select 1 from presupuestos p where p.proyecto_id = k.proyecto_id) then
    raise exception ''El adicional necesita el capítulo del presupuesto'';
  end if;
  if v_cap is not null and not exists');
  if position('if v_cap is not null and not exists' in v) = 0 then raise exception 'texto esperado no encontrado (2)'; end if;
  execute v;
end $do$;
revoke all on function public.editar_adicional_contrato(uuid, text, text, uuid, numeric) from public, anon;
grant execute on function public.editar_adicional_contrato(uuid, text, text, uuid, numeric) to authenticated;
