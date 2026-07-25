-- Migración: permitir que un proyecto NO muestre la marca HABITATUM
-- (para proyectos donde se actúa como persona natural, ej. Arq. Andrés
-- David Hincapié, sin pasar por la empresa HABITATUM).
-- Ejecutar UNA VEZ en Supabase → SQL Editor → pegar todo → Run.

alter table proyectos add column if not exists mostrar_marca_habitatum boolean not null default true;
alter table proyectos add column if not exists nombre_emisor text;
