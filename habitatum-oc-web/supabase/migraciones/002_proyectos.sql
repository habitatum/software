-- Migración: módulo de Proyectos.
-- Ejecutar UNA VEZ en Supabase → SQL Editor → pegar todo → Run.
--
-- Nota importante: los PROVEEDORES quedan globales (compartidos por todos
-- los proyectos), por eso esta migración NO les agrega proyecto_id.
-- Los CONTRATOS y las ÓRDENES DE COMPRA sí quedan ligados a un proyecto.

create table if not exists proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo text not null unique, -- código corto, ej. "DYABOO" (se usa en el número de contrato)
  cliente text,
  estado text not null default 'activo', -- 'activo' | 'inactivo'
  creado_en timestamptz not null default now()
);

alter table contratos add column if not exists proyecto_id uuid references proyectos(id);
alter table ordenes_compra add column if not exists proyecto_id uuid references proyectos(id);

alter table proyectos enable row level security;

-- Lectura: cualquier usuario autenticado puede ver los proyectos
create policy "lectura_general_proyectos" on proyectos for select using (auth.uid() is not null);

-- Escritura: solo el Admin puede crear o modificar proyectos
create policy "creacion_proyectos_admin" on proyectos for insert with check (rol_actual() = 'admin');
create policy "actualizacion_proyectos_admin" on proyectos for update using (rol_actual() = 'admin');
