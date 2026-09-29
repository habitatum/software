-- 039 · Edición de cortes aprobados (aplicada el 29/09/2026)
-- * puede_editar_corte(corte): borrador → admin/operativo; aprobado → admin siempre, operativo solo el
--   ÚLTIMO corte aprobado del contrato. Las políticas RLS de cortes y corte_items usan esta función.
-- * actualizar_corte(corte, actualizar_oc): recalcula subtotal, retención, amortización y neto; los
--   adicionales nuevos quedan como ítems del contrato; si actualizar_oc = true reemplaza los ítems e
--   imputaciones de la OC ligada y ajusta retención/amortización; si no, marca oc_desactualizada.
-- (Definiciones completas aplicadas en Supabase.)
alter table public.cortes add column if not exists oc_desactualizada boolean not null default false;
alter table public.cortes add column if not exists editado_en timestamptz;
alter table public.cortes add column if not exists editado_por uuid references public.usuarios(id);
