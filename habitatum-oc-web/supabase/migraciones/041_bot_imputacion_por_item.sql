-- 041 · Bot de finanzas en ADMINISTRACIÓN DELEGADA (aplicada el 29/09/2026)
-- En administración delegada el control presupuestal solo cuenta OC imputadas a un ÍTEM.
-- * caja_menor_gastos.presupuesto_item_id
-- * bot_crear_oc: si el borrador trae presupuesto_item_id, cada ítem de la OC se imputa 100% a ese ítem.
-- * bot_registrar_caja_menor / _legalizar_caja_menor_interno: guardan e imputan el ítem.
-- (Definiciones completas aplicadas en Supabase.)
alter table public.caja_menor_gastos add column if not exists presupuesto_item_id uuid references public.presupuesto_items(id) on delete set null;
