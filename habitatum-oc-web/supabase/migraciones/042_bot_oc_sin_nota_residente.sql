-- 042 · El bot ya no anota autoría en las notas de la OC (aplicada el 30/09/2026, registro Supabase 20260930001441)
-- La autoría queda solo en la auditoría (creado_por). Reescribe bot_crear_oc quitando la línea
-- "Creada automáticamente por Residente C desde Telegram" y limpia esa línea en las OC ya creadas.
do $m$
declare d text; o text := $o$concat_ws(E'\n', 'Creada automáticamente por Residente C desde Telegram' || coalesce(' (enviada por ' || b.remitente || ')', '') || '.',
                case when coalesce(d->>'numero_factura','') <> '' then 'Factura N° ' || (d->>'numero_factura') end,
                nullif(d->>'nota',''))$o$;
begin
  d := pg_get_functiondef('public.bot_crear_oc(uuid)'::regprocedure);
  if position(o in d) = 0 then raise exception 'patron nota no encontrado'; end if;
  execute replace(d, o, $n$nullif(concat_ws(E'\n',
                case when coalesce(d->>'numero_factura','') <> '' then 'Factura N° ' || (d->>'numero_factura') end,
                nullif(d->>'nota','')), '')$n$);
end $m$;
revoke all on function public.bot_crear_oc(uuid) from public, anon, authenticated;
grant execute on function public.bot_crear_oc(uuid) to service_role;

-- Limpia la nota en las OC ya creadas por el bot.
update ordenes_compra
set notas = nullif(btrim(regexp_replace(notas, 'Creada automáticamente por Residente C desde Telegram[^\n]*\n?', '', 'g'), E'\n '), '')
where notas like '%Creada automáticamente por Residente C%';
