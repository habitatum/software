-- 066 · Caja todo costo: "Retenidos por devolver" con la misma base que retenido_por_devolver_contrato.
-- Antes: Σ (valor_retenido − devolucion_retenido) de las OC, sin restar las devoluciones hechas con
-- "Devolver retenido" (047: OC es_devolucion_retenido), que además salen como egreso → contadas dos veces.
-- Ahora: retenido − devoluciones 047 − descuentos al retenido, excluyendo contratos/OC pagados por el cliente.
-- Afecta Retenidos por devolver, Utilidad que se puede retirar hoy, déficit con banco y Caja proyectada al cierre.
-- Apto 423 (21/10/2026): $4.059.428 → $3.036.110; retiro y cierre suben $1.023.318. No cambia datos.
do $do$
declare d text; a text; b text;
begin
  d := pg_get_functiondef('public.caja_proyecto(uuid)'::regprocedure);
  a := '  select coalesce(sum(coalesce(v.valor_retenido,0) - coalesce(v.devolucion_retenido,0)),0) into v_retenidos
  from v_ordenes_compra_calculadas v join ordenes_compra o on o.id = v.id
  where v.proyecto_id = p_proyecto and v.estado <> ''ANULADA'' and not o.pagado_por_cliente;';
  b := '  -- 066: misma base que retenido_por_devolver_contrato: retenido − devoluciones (OC de devolución 047) − descuentos
  -- al retenido, sin los contratos/OC que paga directamente el cliente.
  select coalesce(sum(coalesce(v.valor_retenido,0) - coalesce(v.devolucion_retenido,0)
                      - case when o.es_devolucion_retenido then coalesce(v.subtotal,0) else 0 end),0) into v_retenidos
  from v_ordenes_compra_calculadas v join ordenes_compra o on o.id = v.id
  where v.proyecto_id = p_proyecto and v.estado <> ''ANULADA'' and not o.pagado_por_cliente;
  v_retenidos := v_retenidos - coalesce((select sum(c.descuento_retenido) from cortes c join contratos k on k.id = c.contrato_id
                  left join ordenes_compra od on od.id = c.oc_id
                  where k.proyecto_id = p_proyecto and c.tipo = ''DEVOLUCION'' and c.estado = ''APROBADO''
                    and (case when c.oc_id is not null then od.estado <> ''ANULADA'' and not od.pagado_por_cliente
                              else exists (select 1 from ordenes_compra x where x.contrato_id = k.id and x.estado <> ''ANULADA''
                                             and not x.pagado_por_cliente and not x.es_devolucion_retenido) end)), 0);
  v_retenidos := greatest(v_retenidos, 0);';
  if position(a in d) = 0 then raise exception 'Parche 066 no aplica en caja_proyecto'; end if;
  execute replace(d, a, b);
end $do$;
