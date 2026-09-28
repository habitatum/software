-- 034 · Ejecutado histórico (aplicada el 28/09/2026)
-- Para proyectos que venían llevando su control en otra herramienta (ej. Apto 423 en el
-- "FORMATO FINANCIERO" de la V1), el ejecutado hasta la fecha de corte se carga TAL CUAL
-- desde esa caja (tabla ejecutado_historico, solo admin), por capítulo o ítem.
-- Las OC anteriores quedan con excluir_control = true para no contar dos veces el mismo pago.
-- De la fecha de corte en adelante, el ejecutado sale de las OC imputadas (flujo normal).
-- La función control_todo_costo suma: OC imputadas (sin excluir_control) + ejecutado_historico.
-- (Definición completa aplicada en Supabase; ver migración 033 para la versión base.)
create table if not exists public.ejecutado_historico (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  fecha date not null,
  valor numeric(16,2) not null,
  concepto text not null,
  capitulo_id uuid references public.presupuesto_capitulos(id) on delete set null,
  presupuesto_item_id uuid references public.presupuesto_items(id) on delete set null,
  codigo_origen text,
  origen text not null default 'V1',
  creado_en timestamptz not null default now()
);
alter table public.ejecutado_historico enable row level security;
drop policy if exists ejecutado_historico_admin on public.ejecutado_historico;
create policy ejecutado_historico_admin on public.ejecutado_historico for all using (public.es_admin()) with check (public.es_admin());
alter table public.ordenes_compra add column if not exists excluir_control boolean not null default false;
