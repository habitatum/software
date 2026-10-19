-- 062 · Todo costo: crear capítulos de adicionales desde la App (antes solo llegaban con el Excel).
-- crear_capitulo_adicional_tc(proyecto, nombre, tipo): solo admin y obras todo costo con presupuesto.
-- Tipo ADICIONAL_COSTO (sin utilidad, costo = venta) o PAGO_DIRECTO_CLIENTE. Código = siguiente número
-- de capítulo; queda al final del presupuesto. Luego se le agregan ítems con "+ Agregar ítem adicional".
-- No cambia datos existentes.

create or replace function public.crear_capitulo_adicional_tc(p_proyecto uuid, p_nombre text, p_tipo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pres uuid; v_modelo text; v_codigo text; v_orden int; v_id uuid; v_nombre text := upper(trim(coalesce(p_nombre, '')));
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede crear capítulos de adicionales.'; end if;
  select modelo_contratacion into v_modelo from proyectos where id = p_proyecto;
  if v_modelo is distinct from 'TODO_COSTO' then raise exception 'Esta opción es solo para obras todo costo.'; end if;
  select id into v_pres from presupuestos where proyecto_id = p_proyecto;
  if v_pres is null then raise exception 'Primero carga el presupuesto del proyecto.'; end if;
  if v_nombre = '' then raise exception 'Escribe el nombre del capítulo.'; end if;
  if p_tipo not in ('ADICIONAL_COSTO', 'PAGO_DIRECTO_CLIENTE') then raise exception 'Tipo de capítulo no válido para adicionales.'; end if;
  if exists (select 1 from presupuesto_capitulos where presupuesto_id = v_pres and upper(trim(nombre)) = v_nombre) then
    raise exception 'Ya existe un capítulo llamado %.', v_nombre;
  end if;
  select (coalesce(max(case when codigo ~ '^\d+$' then codigo::int end), 0) + 1)::text, coalesce(max(orden), -1) + 1
    into v_codigo, v_orden from presupuesto_capitulos where presupuesto_id = v_pres;
  insert into presupuesto_capitulos (presupuesto_id, codigo, nombre, categoria, valor_presupuestado, orden, tipo_capitulo)
  values (v_pres, v_codigo, v_nombre, 'DIRECTO', 0, v_orden, p_tipo)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_codigo);
end $$;
revoke all on function public.crear_capitulo_adicional_tc(uuid, text, text) from public, anon;
grant execute on function public.crear_capitulo_adicional_tc(uuid, text, text) to authenticated;
