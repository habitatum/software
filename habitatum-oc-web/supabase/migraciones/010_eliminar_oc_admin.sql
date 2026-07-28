-- Migración: permitir ELIMINAR (borrado permanente) una Orden de Compra,
-- exclusivamente al Administrador.
--
-- Antes: la política "escritura_oc" era FOR ALL (select/insert/update/delete)
-- para admin y operativo por igual, así que operativo también podría borrar
-- si la interfaz lo permitiera. Ahora se separa en 3 políticas: insertar y
-- actualizar siguen abiertas a admin+operativo, pero eliminar queda
-- restringido solo a admin (se valida en la base de datos, no solo en la
-- interfaz).
--
-- items_oc.orden_compra_id ya tiene "on delete cascade" (ver schema.sql),
-- así que al eliminar la OC se borran automáticamente sus ítems. Postgres no
-- aplica RLS a los borrados en cascada por integridad referencial, así que
-- no hace falta tocar la política de items_oc.
--
-- El folio consecutivo se libera solo: el trigger set_folio_por_proyecto()
-- calcula el siguiente folio como MAX(consecutivo existente) + 1 en cada
-- proyecto, así que al borrar la última OC de un proyecto, ese número queda
-- disponible de nuevo para la próxima.

drop policy if exists "escritura_oc" on ordenes_compra;

create policy "insertar_oc" on ordenes_compra for insert
  with check (rol_actual() in ('admin','operativo'));

create policy "actualizar_oc" on ordenes_compra for update
  using (rol_actual() in ('admin','operativo'))
  with check (rol_actual() in ('admin','operativo'));

create policy "eliminar_oc_admin" on ordenes_compra for delete
  using (rol_actual() = 'admin');
