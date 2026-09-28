-- El descuento reduce la base ANTES de calcular IVA / AIU (aplicada el 27/09/2026).
-- Antes: total = subtotal - descuento + IVA(subtotal). Ahora: IVA sobre (subtotal - descuento).
-- Con ítems sin_iva, el descuento se reparte proporcionalmente entre la parte gravable y la no gravable.
-- En AIU, Administración, Imprevistos y Utilidad también se calculan sobre (subtotal - descuento).
-- Las 5 OC históricas afectadas (OC-09-0019, OC-02-0008, 0014, 0015, 0052) se ajustaron expresando
-- su descuento antes de IVA (descuento/1,19) para conservar al peso el valor que ya se pagó.
-- La misma regla se replicó en lib/calculosOC.js (formulario de OC).
do $mig$
declare
  d text := pg_get_viewdef('public.v_ordenes_compra_calculadas'::regclass, true);
  o1 text := 'WHEN oc.tipo_impuesto = ''CON_IVA''::tipo_impuesto_enum THEN round(COALESCE(s.subtotal_gravable, 0::numeric) * oc.porcentaje_iva / 100::numeric, 2)';
  n1 text := 'WHEN oc.tipo_impuesto = ''CON_IVA''::tipo_impuesto_enum THEN round(GREATEST(COALESCE(s.subtotal_gravable, 0::numeric) - COALESCE(oc.descuento, 0::numeric) * COALESCE(s.subtotal_gravable, 0::numeric) / NULLIF(COALESCE(s.subtotal, 0::numeric), 0::numeric), 0::numeric) * oc.porcentaje_iva / 100::numeric, 2)';
  o2 text := 'round(COALESCE(s.subtotal, 0::numeric) *';
  n2 text := 'round((COALESCE(s.subtotal, 0::numeric) - COALESCE(oc.descuento, 0::numeric)) *';
begin
  if position(o1 in d) = 0 then raise notice 'Ya aplicada (patrón IVA no encontrado)'; return; end if;
  d := replace(replace(d, o1, n1), o2, n2);
  execute 'create or replace view public.v_ordenes_compra_calculadas as ' || d;
  grant all on public.v_ordenes_compra_calculadas to anon, authenticated, service_role;
end
$mig$;
