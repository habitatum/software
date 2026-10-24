-- 069 · Plan de pagos del cliente solo con el contrato (todo costo). Pedido del chat 09 (Apto 423), 24/10/2026.
-- caja_proyecto agrega el bloque 'cobro': contrato (valor = proyectos_finanzas.valor_contrato_cliente, pagado,
-- pendiente) y adicionales cobrables (valor = capítulos ADICIONAL/ADICIONAL_COSTO con su IVA, pagado = lo que el
-- cliente pagó por encima del contrato, pendiente). contrato.pendiente + adicionales.pendiente = por_cobrar siempre.
-- Los hitos del plan se siguen llenando en orden; no se crean hitos de adicionales. No cambia ningún otro cálculo
-- ni datos. Sigue siendo solo admin (chequeo dentro de la función; grants sin cambio).
do $do$
declare v_def text; v_ant text := $a$    'ingresos', v_ing, 'por_cobrar', v_por_cobrar,$a$;
begin
  v_def := pg_get_functiondef('public.caja_proyecto(uuid)'::regprocedure);
  if position(v_ant in v_def) = 0 then raise exception '069: no se encontró el texto esperado en caja_proyecto'; end if;
  v_def := replace(v_def, v_ant, v_ant || $n$
    'cobro', jsonb_build_object(
        'contrato', jsonb_build_object('valor', v_contrato, 'pagado', least(v_ing, v_contrato),
                                       'pendiente', greatest(v_contrato - v_ing, 0)),
        'adicionales', jsonb_build_object('valor', v_adic, 'pagado', least(greatest(v_ing - v_contrato, 0), v_adic),
                                          'pendiente', greatest(v_adic - greatest(v_ing - v_contrato, 0), 0)),
        'excedente', greatest(v_ing - v_contrato - v_adic, 0)),$n$);
  execute v_def;
end $do$;
