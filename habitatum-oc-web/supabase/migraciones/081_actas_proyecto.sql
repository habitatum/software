-- 081 · Acta de inicio y Acta de entrega de obra por proyecto (13/11/2026)
-- Lo que se llena en el formulario de cada acta (pestaña Contratos). El PDF se arma con estos datos más
-- los del proyecto, el presupuesto y la Caja. Solo admin: incluye valor del contrato, pagos y saldo del cliente.
create table if not exists public.actas_proyecto (
  proyecto_id uuid not null references public.proyectos(id),
  tipo text not null check (tipo in ('INICIO', 'ENTREGA')),
  datos jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid default auth.uid(),
  primary key (proyecto_id, tipo)
);
alter table public.actas_proyecto enable row level security;
create policy actas_proyecto_admin on public.actas_proyecto for all
  using (public.es_admin()) with check (public.es_admin());
grant select, insert, update on public.actas_proyecto to authenticated;
