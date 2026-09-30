-- 043 · Seguridad de vistas y funciones (aplicada el 30/09/2026, registro Supabase 20260930052216
--       con el nombre seguridad_vistas_y_funciones; en el manual v1.3 figuraba como "042")
-- Las vistas respetan el RLS de quien consulta; sin acceso anónimo a vistas ni funciones; search_path fijo.
-- Postgres da EXECUTE a PUBLIC por defecto: por eso se revoca public Y anon.

-- 1. Vistas: respetan el RLS del usuario que consulta
alter view public.v_ordenes_compra_calculadas set (security_invoker = true);
alter view public.v_presupuesto_ejecutado     set (security_invoker = true);
alter view public.v_acumulados_contrato       set (security_invoker = true);

-- 2. Sin acceso anónimo a ninguna vista
revoke all on public.v_ordenes_compra_calculadas, public.v_presupuesto_ejecutado,
              public.v_acumulados_contrato, public.v_contrato_items_avance from anon;

-- 3. anticipo_contrato y estado_cuenta_contrato: solo usuarios con sesión y servicio
revoke execute on function public.anticipo_contrato(uuid) from public, anon;
grant  execute on function public.anticipo_contrato(uuid) to authenticated, service_role;
revoke execute on function public.estado_cuenta_contrato(uuid) from public, anon;
grant  execute on function public.estado_cuenta_contrato(uuid) to authenticated, service_role;

-- 4. search_path fijo
alter function public.rol_actual()                        set search_path = public;
alter function public.set_folio_por_proyecto()            set search_path = public;
alter function public.set_auditoria_oc()                  set search_path = public;
alter function public.prevent_non_admin_anular()          set search_path = public;
alter function public.prevent_non_admin_anular_contrato() set search_path = public;
alter function public.puede_gestionar_bitacora_actual()   set search_path = public;

-- 5. Funciones de trigger y helpers: fuera anon y PUBLIC
revoke execute on function public.es_admin(), public.rol_actual(), public.puede_editar_corte(uuid),
  public.puede_gestionar_bitacora_actual(), public.prevent_non_admin_anular(),
  public.prevent_non_admin_anular_contrato(), public.set_auditoria_oc(), public.set_folio_por_proyecto()
  from public, anon;
grant execute on function public.es_admin(), public.rol_actual(), public.puede_editar_corte(uuid),
  public.puede_gestionar_bitacora_actual(), public.prevent_non_admin_anular(),
  public.prevent_non_admin_anular_contrato(), public.set_auditoria_oc(), public.set_folio_por_proyecto()
  to authenticated, service_role;
