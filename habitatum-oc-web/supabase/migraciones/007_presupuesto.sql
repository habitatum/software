-- Migración: Módulo de Presupuesto (control presupuestal por capítulo/ítem).
-- Se carga desde el Excel "FORMULARIO DE PRECIOS" (mismo formato para todos
-- los proyectos). Un proyecto tiene UN presupuesto activo: al volver a cargar
-- el Excel se reemplaza todo (capítulos e ítems anteriores se borran por
-- cascada). Los ítems de Orden de Compra se pueden vincular opcionalmente a
-- un ítem del presupuesto (items_oc.presupuesto_item_id) para poder comparar
-- Presupuestado vs Ejecutado vs Saldo.
-- Ejecutar UNA VEZ en Supabase → SQL Editor → pegar todo → Run.

create table presupuestos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references proyectos(id) on delete cascade unique,
  nombre_archivo text,
  total_costos_directos numeric(14,2),
  total_costos_indirectos numeric(14,2),
  valor_total numeric(14,2),
  cargado_por uuid references usuarios(id),
  cargado_en timestamptz not null default now()
);

create table presupuesto_capitulos (
  id uuid primary key default gen_random_uuid(),
  presupuesto_id uuid not null references presupuestos(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  categoria text, -- 'DIRECTO' | 'INDIRECTO'
  valor_presupuestado numeric(14,2) not null default 0,
  orden int not null default 0
);

create table presupuesto_items (
  id uuid primary key default gen_random_uuid(),
  capitulo_id uuid not null references presupuesto_capitulos(id) on delete cascade,
  codigo text not null,
  descripcion text not null,
  unidad text,
  cantidad numeric(14,2),
  valor_unitario numeric(14,2),
  valor_parcial numeric(14,2) not null default 0,
  orden int not null default 0
);

alter table items_oc add column presupuesto_item_id uuid references presupuesto_items(id) on delete set null;

-- Ejecutado por ítem de presupuesto: suma de los ítems de OC vinculados,
-- excluyendo Órdenes de Compra ANULADAS.
create view v_presupuesto_ejecutado as
select
  io.presupuesto_item_id,
  sum(io.cantidad * io.valor_unitario) as ejecutado
from items_oc io
join ordenes_compra oc on oc.id = io.orden_compra_id
where io.presupuesto_item_id is not null and oc.estado <> 'ANULADA'
group by io.presupuesto_item_id;

-- Seguridad
alter table presupuestos enable row level security;
alter table presupuesto_capitulos enable row level security;
alter table presupuesto_items enable row level security;

create policy "lectura_general_presupuestos" on presupuestos for select using (auth.uid() is not null);
create policy "lectura_general_presupuesto_capitulos" on presupuesto_capitulos for select using (auth.uid() is not null);
create policy "lectura_general_presupuesto_items" on presupuesto_items for select using (auth.uid() is not null);

-- Cargar/reemplazar presupuesto: solo Admin.
create policy "escritura_presupuestos_admin" on presupuestos for all
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy "escritura_presupuesto_capitulos_admin" on presupuesto_capitulos for all
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy "escritura_presupuesto_items_admin" on presupuesto_items for all
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
