-- Migración: Modificar y Eliminar un Proveedor, exclusivo del Administrador.
-- Antes "escritura_proveedores" era FOR ALL para admin+operativo (insert,
-- update y delete juntos). Se separa en 3 políticas: insertar (crear un
-- proveedor nuevo) sigue abierto a admin+operativo, pero actualizar y
-- eliminar quedan exclusivos del Admin.
--
-- El borrado, además, ya está protegido por las llaves foráneas de
-- contratos.contratista_id y ordenes_compra.proveedor_id: Postgres rechaza
-- el delete si el proveedor tiene Contratos u Órdenes de Compra asociadas
-- (para no perder ese historial). Esta migración solo agrega la restricción
-- de rol; la app traduce ese rechazo a un mensaje claro para el usuario.

drop policy if exists "escritura_proveedores" on proveedores;

create policy "insertar_proveedores" on proveedores for insert
  with check (rol_actual() in ('admin','operativo'));

create policy "actualizar_proveedores_admin" on proveedores for update
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

create policy "eliminar_proveedores_admin" on proveedores for delete
  using (rol_actual() = 'admin');
