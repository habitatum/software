-- Migración: permitir ANULAR y ELIMINAR un Contrato, exclusivamente al Administrador.
-- Sigue el mismo patrón ya usado en Órdenes de Compra (ver migraciones 004 y 010):
--   - Un contrato ANULADO no se borra: queda visible pero bloqueado para uso operativo
--     (no se puede editar, no aparece disponible para seleccionar en una nueva Orden
--     de Compra). Solo un admin puede anular o reactivar un contrato.
--   - El borrado permanente (ELIMINAR) es una acción aparte, también exclusiva del
--     Admin, y separada de "actualizar" para que operativo ya no pueda borrar
--     contratos accidentalmente (antes "escritura_contratos" era FOR ALL para
--     admin+operativo, lo que incluía delete).

create type estado_contrato_enum as enum ('VIGENTE', 'ANULADO');

alter table contratos add column estado estado_contrato_enum not null default 'VIGENTE';

-- Anular/reactivar: solo el Admin puede cambiar el estado de un contrato
-- (validado en la base de datos, igual que prevent_non_admin_anular() para OC).
create or replace function prevent_non_admin_anular_contrato() returns trigger as $$
begin
  if new.estado is distinct from old.estado and rol_actual() <> 'admin' then
    raise exception 'Solo un administrador puede anular o reactivar un Contrato';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_prevent_non_admin_anular_contrato
  before update on contratos
  for each row execute function prevent_non_admin_anular_contrato();

-- Separar "escritura_contratos" (antes FOR ALL para admin+operativo, lo que permitía
-- a operativo borrar contratos) en 3 políticas: insertar/actualizar siguen abiertas a
-- admin+operativo (actualizar ya queda protegido para el campo estado por el trigger
-- de arriba), eliminar (borrado permanente) queda solo para admin.
drop policy if exists "escritura_contratos" on contratos;

create policy "insertar_contratos" on contratos for insert
  with check (rol_actual() in ('admin','operativo'));

create policy "actualizar_contratos" on contratos for update
  using (rol_actual() in ('admin','operativo'))
  with check (rol_actual() in ('admin','operativo'));

create policy "eliminar_contratos_admin" on contratos for delete
  using (rol_actual() = 'admin');
