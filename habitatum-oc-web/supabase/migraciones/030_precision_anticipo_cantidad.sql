-- Amplía la precisión de dos columnas (aplicada el 27/09/2026 durante la migración del Apto 423 desde la V1).
--  * ordenes_compra.porcentaje_anticipo: 4 → 6 decimales. Con 4 decimales, anticipos pactados en pesos
--    exactos (ej. $1.000.000 sobre $15.830.000 = 6,31712%) quedaban en $999.997.
--  * items_oc.cantidad: 2 → 3 decimales (ej. 41,184 m²).
-- Las vistas dependientes se reconstruyen con su misma definición.
do $mig$
declare
  d_calc text := pg_get_viewdef('public.v_ordenes_compra_calculadas'::regclass, true);
  d_acum text := pg_get_viewdef('public.v_acumulados_contrato'::regclass, true);
  d_pres text := pg_get_viewdef('public.v_presupuesto_ejecutado'::regclass, true);
begin
  drop view public.v_presupuesto_ejecutado;
  drop view public.v_acumulados_contrato;
  drop view public.v_ordenes_compra_calculadas;
  alter table public.ordenes_compra alter column porcentaje_anticipo type numeric(11,6);
  alter table public.items_oc alter column cantidad type numeric(14,3);
  execute 'create view public.v_ordenes_compra_calculadas as ' || d_calc;
  execute 'create view public.v_acumulados_contrato as ' || d_acum;
  execute 'create view public.v_presupuesto_ejecutado as ' || d_pres;
  grant all on public.v_ordenes_compra_calculadas, public.v_acumulados_contrato, public.v_presupuesto_ejecutado to anon, authenticated, service_role;
end
$mig$;
