-- Migración: folio de OC por proyecto + auditoría (quién creó/modificó) + Anular solo Admin.
-- Ejecutar UNA VEZ en Supabase → SQL Editor → pegar todo → Run.

-- ============================================================
-- 1) FOLIO POR PROYECTO
-- Antes: OC-0001, OC-0002... con una secuencia GLOBAL (oc_folio_seq),
-- compartida por todo el software sin importar el proyecto.
-- Ahora: OC-{código del proyecto}-{consecutivo propio de ese proyecto}
-- Ej: Casa 101 (código 01) → OC-01-0001, OC-01-0002...
--     Proyecto Personal (código 99) → OC-99-0001, OC-99-0002...
-- ============================================================

alter table ordenes_compra alter column folio drop default;
drop sequence if exists oc_folio_seq;

create or replace function set_folio_por_proyecto() returns trigger as $$
declare
  v_codigo text;
  v_siguiente int;
begin
  if new.folio is not null then
    return new;
  end if;

  select codigo into v_codigo from proyectos where id = new.proyecto_id;

  select coalesce(max((regexp_match(folio, '-(\d+)$'))[1]::int), 0) + 1
    into v_siguiente
  from ordenes_compra
  where proyecto_id = new.proyecto_id;

  new.folio := 'OC-' || v_codigo || '-' || lpad(v_siguiente::text, 4, '0');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_set_folio_por_proyecto on ordenes_compra;
create trigger trg_set_folio_por_proyecto
  before insert on ordenes_compra
  for each row execute function set_folio_por_proyecto();

-- Renumerar las OC ya existentes al nuevo esquema por proyecto (según orden de creación).
with numerados as (
  select oc.id, p.codigo as codigo_proyecto,
         row_number() over (partition by oc.proyecto_id order by oc.creado_en) as n
  from ordenes_compra oc
  join proyectos p on p.id = oc.proyecto_id
)
update ordenes_compra oc
set folio = 'OC-' || numerados.codigo_proyecto || '-' || lpad(numerados.n::text, 4, '0')
from numerados
where oc.id = numerados.id;

-- ============================================================
-- 2) AUDITORÍA: quién creó y quién modificó por última vez cada OC
-- ============================================================

alter table ordenes_compra add column if not exists modificado_por uuid references usuarios(id);
alter table ordenes_compra add column if not exists modificado_en timestamptz;

-- Se calcula siempre en el servidor a partir de auth.uid(): el cliente no puede
-- suplantar a otro usuario como creador/modificador.
create or replace function set_auditoria_oc() returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    new.creado_por := auth.uid();
  elsif TG_OP = 'UPDATE' then
    new.creado_por := old.creado_por;
    new.creado_en := old.creado_en;
    new.modificado_por := auth.uid();
    new.modificado_en := now();
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_set_auditoria_oc on ordenes_compra;
create trigger trg_set_auditoria_oc
  before insert or update on ordenes_compra
  for each row execute function set_auditoria_oc();

-- ============================================================
-- 3) ANULAR: solo el Admin puede pasar una OC a estado ANULADA
-- (se valida en la base de datos, no solo en la interfaz).
-- ============================================================

create or replace function prevent_non_admin_anular() returns trigger as $$
begin
  if new.estado = 'ANULADA' and old.estado <> 'ANULADA' and rol_actual() <> 'admin' then
    raise exception 'Solo un administrador puede anular una Orden de Compra';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_prevent_non_admin_anular on ordenes_compra;
create trigger trg_prevent_non_admin_anular
  before update on ordenes_compra
  for each row execute function prevent_non_admin_anular();
