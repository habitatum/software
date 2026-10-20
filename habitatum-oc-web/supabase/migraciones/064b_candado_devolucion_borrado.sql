-- 064b · Candado de devolución de retenido también para BORRAR líneas de la OC.
-- La herramienta de Claude cancela SQL con esta palabra: lo ejecuta Andrés en el SQL Editor de Supabase.
-- Reemplaza el trigger de la 064 (insert/update) por uno que cubre insert/update/borrado.
drop trigger if exists items_oc_devolucion_candado on public.items_oc;
create trigger items_oc_devolucion_candado before insert or update or delete on public.items_oc
  for each row execute function public.trg_items_oc_devolucion();
