-- 072 · El valor del contrato (valor_inicial) es el valor CON impuestos (pedido de Andrés, 25/10/2026).
-- Nueva columna contratos.valor_antes_impuestos: el subtotal de la cotización. Con un régimen que discrimina
-- (IVA, AIU, IVA_UTILIDAD) se escribe el valor antes de impuestos y el trigger calcula
-- valor_inicial = redondeo(antes de impuestos + impuestos del régimen). Sin impuestos (SIN_IVA, SIN_DISCRIMINAR)
-- ambos valores son iguales. El anticipo (%), la amortización, la retención, el % de ejecución del estado de cuenta
-- y la comparación del Documento del contrato usan el valor antes de impuestos.
-- Contratos existentes: valor_antes_impuestos = valor_inicial (nada cambia). Servitodo: 06-2026-01 queda en
-- $101.350.352 con impuestos ($100.396.584 antes) y 02-2026-05 en $25.993.070 ($25.748.460 antes).

alter table public.contratos add column if not exists valor_antes_impuestos numeric;

create or replace function public.trg_valor_contrato() returns trigger language plpgsql set search_path = public as $$
begin
  if new.regimen_impuesto in ('IVA', 'AIU', 'IVA_UTILIDAD') then
    new.valor_antes_impuestos := coalesce(new.valor_antes_impuestos, new.valor_inicial);
    new.valor_inicial := round(coalesce(new.valor_antes_impuestos, 0)
      + public._impuestos_regimen(new.regimen_impuesto, new.pct_a, new.pct_i, new.pct_u, new.pct_iva, coalesce(new.valor_antes_impuestos, 0)));
  else
    new.valor_antes_impuestos := new.valor_inicial;
  end if;
  return new;
end $$;
drop trigger if exists valor_contrato on public.contratos;
-- Corre después de regimen_contrato (orden alfabético): el régimen ya fue validado.
create trigger valor_contrato before insert or update on public.contratos for each row execute function public.trg_valor_contrato();

-- Contratos existentes: el valor antes de impuestos es el mismo valor (sin régimen) o el que ya tenían (Servitodo).
update public.contratos set valor_antes_impuestos = valor_inicial where valor_antes_impuestos is null;

-- Estado de cuenta: el % de ejecución y el saldo por ejecutar comparan el ejecutado (antes de impuestos) contra
-- el valor antes de impuestos; 'valor' sigue siendo el valor del contrato.
do $do$
declare d text; a text;
begin
  d := pg_get_functiondef('public.estado_cuenta_contrato(uuid)'::regprocedure);
  a := 'end as fecha_fin';
  if position(a in d) = 0 then raise exception '072: estado_cuenta (fecha_fin)'; end if;
  d := replace(d, a, 'end as fecha_fin, coalesce(c.valor_antes_impuestos, c.valor_inicial) as base_ejec');
  d := replace(d, 'case when c.valor_inicial>0 then round(t.ejecutado/c.valor_inicial*100,2)', 'case when c.base_ejec>0 then round(t.ejecutado/c.base_ejec*100,2)');
  d := replace(d, 'greatest(c.valor_inicial - t.ejecutado,0)', 'greatest(c.base_ejec - t.ejecutado,0)');
  d := replace(d, 'greatest(t.ejecutado - c.valor_inicial,0)', 'greatest(t.ejecutado - c.base_ejec,0)');
  d := replace(d, 'when t.ejecutado > c.valor_inicial then', 'when t.ejecutado > c.base_ejec then');
  d := replace(d, 'and t.ejecutado < c.valor_inicial then', 'and t.ejecutado < c.base_ejec then');
  d := replace(d, $x$'valor',c.valor_inicial,$x$, $x$'valor',c.valor_inicial,'valor_antes_impuestos',c.base_ejec,$x$);
  if position('c.valor_inicial>0' in d) > 0 or position('t.ejecutado > c.valor_inicial' in d) > 0 then raise exception '072: estado_cuenta quedó a medias'; end if;
  execute d;
end $do$;

-- Anticipo: el % de la nota es sobre el valor antes de impuestos.
do $do$
declare d text; a text;
begin
  d := pg_get_functiondef('public.crear_anticipo_contrato(uuid, numeric, date, text)'::regprocedure);
  a := 'v_pct := case when k.valor_inicial > 0 then round(p_valor / k.valor_inicial * 100, 4) end;';
  if position(a in d) = 0 then raise exception '072: crear_anticipo_contrato'; end if;
  d := replace(d, a, 'v_pct := case when coalesce(k.valor_antes_impuestos, k.valor_inicial) > 0 then round(p_valor / coalesce(k.valor_antes_impuestos, k.valor_inicial) * 100, 4) end;');
  d := replace(d, $x$'% del valor del contrato)'$x$, $x$'% del valor antes de impuestos)'$x$);
  execute d;
end $do$;

-- Documento del contrato: también entrega el valor antes de impuestos.
do $do$
declare d text; a text;
begin
  d := pg_get_functiondef('public.documento_contrato_datos(uuid)'::regprocedure);
  a := $x$'regimen_impuesto', c.regimen_impuesto,$x$;
  if position(a in d) = 0 then raise exception '072: documento_contrato_datos'; end if;
  d := replace(d, a, $x$'regimen_impuesto', c.regimen_impuesto, 'valor_antes_impuestos', coalesce(c.valor_antes_impuestos, c.valor_inicial),$x$);
  execute d;
end $do$;
