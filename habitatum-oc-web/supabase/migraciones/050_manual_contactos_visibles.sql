-- 050 · Manual de mantenimiento editable (fase 2) — aplicada el 04/10/2026, registro Supabase: manual_contactos_visibles
-- Check "Aparece en el PDF" por contacto. Las filas desmarcadas siguen en la base como respaldo interno.
-- manual_inicializar no cambia: solo agrega contratos nuevos y no toca lo editado.
alter table public.manual_contactos add column if not exists mostrar_en_pdf boolean not null default true;
