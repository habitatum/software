-- Permite eliminar un proyecto por completo (Admin, con doble verificación
-- en la interfaz: escribir el código del proyecto + confirmación final).
--
-- Hoy no existe forma de borrar un proyecto: ni siquiera hay política RLS de
-- "delete" para la tabla proyectos. Además, Contratos y Órdenes de Compra
-- referencian proyecto_id SIN "on delete cascade", así que un intento de
-- borrado quedaría bloqueado por esas llaves foráneas.
--
-- Esta migración:
--   1) Pone "on delete cascade" en contratos.proyecto_id y
--      ordenes_compra.proyecto_id (el resto del árbol — items_oc, pagos,
--      presupuestos, capítulos, ítems, cortes, bitácora — ya tenía cascada
--      definida desde el esquema original).
--   2) Agrega la política de borrado para proyectos, exclusiva de Admin.
--
-- Resultado: borrar un proyecto borra en cascada TODO lo suyo (Contratos,
-- Órdenes de Compra, ítems, pagos, Presupuesto, Cortes, Bitácora). Es
-- irreversible. Las fotos ya subidas a Storage (bucket bitacora-fotos) no se
-- borran automáticamente con esta migración; solo se borran las filas de la
-- base de datos que las referencian.

do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'contratos'::regclass
    and confrelid = 'proyectos'::regclass
    and contype = 'f';
  if v_constraint is not null then
    execute format('alter table contratos drop constraint %I', v_constraint);
  end if;
  alter table contratos
    add constraint contratos_proyecto_id_fkey
    foreign key (proyecto_id) references proyectos(id) on delete cascade;
end $$;

do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'ordenes_compra'::regclass
    and confrelid = 'proyectos'::regclass
    and contype = 'f';
  if v_constraint is not null then
    execute format('alter table ordenes_compra drop constraint %I', v_constraint);
  end if;
  alter table ordenes_compra
    add constraint ordenes_compra_proyecto_id_fkey
    foreign key (proyecto_id) references proyectos(id) on delete cascade;
end $$;

drop policy if exists "eliminar_proyectos_admin" on proyectos;
create policy "eliminar_proyectos_admin" on proyectos for delete
  using (rol_actual() = 'admin');
