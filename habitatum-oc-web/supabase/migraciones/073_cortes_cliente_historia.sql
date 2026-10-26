-- 073 · Cortes al cliente (todo costo) con la historia por corte (pedido de Andrés, 26/10/2026).
-- corte_cliente_detalle agrega: 'cortes' (número y fecha de los cortes no anulados hasta este), por capítulo
-- 'historia' (modo, % acumulado y valor acumulado en cada corte) y por ítem 'por_corte' (cantidad de cada corte).
-- Con eso la pantalla, el PDF y el Excel muestran Corte 1 · Corte 2 · … · Acumulado, como el control presupuestal
-- de administración delegada. Solo lectura: no cambia cómo se guardan ni se calculan los cortes. Solo admin.
do $do$
declare d text; a text;
begin
  d := pg_get_functiondef('public.corte_cliente_detalle(uuid)'::regprocedure);
  a := $x$'acumulado', public._cc_valor_cap(p_corte, cap.id),$x$;
  if position(a in d) = 0 then raise exception '073: capítulos'; end if;
  d := replace(d, a, a || $x$
      'historia', coalesce((select jsonb_agg(jsonb_build_object('numero', k.numero, 'modo', km.modo, 'porcentaje', km.porcentaje,
          'acumulado', public._cc_valor_cap(k.id, cap.id)) order by k.numero)
        from cortes_cliente k left join cortes_cliente_capitulos km on km.corte_id = k.id and km.capitulo_id = cap.id
        where k.proyecto_id = c.proyecto_id and k.estado <> 'ANULADO' and k.numero <= c.numero), '[]'::jsonb),$x$);
  a := $x$'anterior', qa.ant, 'este', coalesce(ci.cantidad, 0),$x$;
  if position(a in d) = 0 then raise exception '073: ítems'; end if;
  d := replace(d, a, a || $x$
          'por_corte', coalesce((select jsonb_agg(coalesce(c2.cantidad, 0) order by k.numero)
            from cortes_cliente k left join cortes_cliente_items c2 on c2.corte_id = k.id and c2.presupuesto_item_id = i.id
            where k.proyecto_id = c.proyecto_id and k.estado <> 'ANULADO' and k.numero <= c.numero), '[]'::jsonb),$x$);
  a := $x$'anterior_id', v_prev,$x$;
  if position(a in d) = 0 then raise exception '073: cortes'; end if;
  d := replace(d, a, a || $x$
    'cortes', coalesce((select jsonb_agg(jsonb_build_object('numero', k.numero, 'fecha', k.fecha, 'estado', k.estado, 'es_final', k.es_final) order by k.numero)
      from cortes_cliente k where k.proyecto_id = c.proyecto_id and k.estado <> 'ANULADO' and k.numero <= c.numero), '[]'::jsonb),$x$);
  execute d;
end $do$;
