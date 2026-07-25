-- ============================================================
-- HABITATUM · Sistema de Contratos, Proveedores y Órdenes de Compra
-- Esquema de base de datos para Supabase (Postgres)
-- ============================================================

-- ---------- ENUMS ----------
create type rol_usuario as enum ('admin', 'operativo', 'lectura');
create type tipo_orden_enum as enum ('CONTRATO', 'SERVICIO', 'COMPRA');
create type estado_oc_enum as enum ('VIGENTE', 'ANULADA');
create type tipo_pago_enum as enum ('NORMAL', 'ANTICIPO');
create type tipo_impuesto_enum as enum ('SIN_IVA', 'CON_IVA', 'CON_AIU');

-- ---------- USUARIOS (perfil ligado a Supabase Auth) ----------
create table usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  email text not null,
  rol rol_usuario not null default 'lectura',
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ---------- PROVEEDORES ----------
create table proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nit text,
  banco text,
  tipo_cuenta text,
  numero_cuenta text,
  creado_en timestamptz not null default now()
);

-- ---------- CONTRATOS ----------
create table contratos (
  id uuid primary key default gen_random_uuid(),
  codigo_proyecto text not null,
  anio int not null,
  consecutivo int not null,
  numero_contrato text generated always as
    (codigo_proyecto || '-' || anio::text || '-' || lpad(consecutivo::text, 2, '0')) stored,
  contratista_id uuid references proveedores(id),
  concepto text,
  valor_inicial numeric(14,2) not null default 0,
  creado_en timestamptz not null default now(),
  unique (codigo_proyecto, anio, consecutivo)
);

-- ---------- ÓRDENES DE COMPRA ----------
create sequence oc_folio_seq start 1;

create table ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  folio text not null default ('OC-' || lpad(nextval('oc_folio_seq')::text, 4, '0')),
  tipo_orden tipo_orden_enum not null default 'COMPRA',
  contrato_id uuid references contratos(id),
  fecha date not null default current_date,
  proveedor_id uuid references proveedores(id),
  capitulo text,
  descripcion text,
  estado estado_oc_enum not null default 'VIGENTE',
  tipo_pago tipo_pago_enum not null default 'NORMAL',
  referencia_anticipo_id uuid references ordenes_compra(id),
  porcentaje_anticipo numeric(6,2) default 0,
  porcentaje_amortizacion numeric(6,2) default 0,
  responsable text,
  descuento numeric(14,2) not null default 0,
  tipo_impuesto tipo_impuesto_enum not null default 'SIN_IVA',
  porcentaje_iva numeric(6,2) default 0,
  porcentaje_administracion numeric(6,2) default 0,
  porcentaje_imprevistos numeric(6,2) default 0,
  porcentaje_utilidad numeric(6,2) default 0,
  porcentaje_retencion numeric(6,2) default 0,
  devolucion_retenido numeric(14,2) not null default 0,
  notas text,
  creado_por uuid references usuarios(id),
  creado_en timestamptz not null default now(),
  unique (folio)
);

-- ---------- ÍTEMS DE CADA ORDEN ----------
create table items_oc (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references ordenes_compra(id) on delete cascade,
  descripcion text not null,
  cantidad numeric(12,2) not null default 1,
  valor_unitario numeric(14,2) not null default 0
);

-- ---------- PAGOS ----------
create table pagos (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references ordenes_compra(id) on delete cascade,
  fecha date not null default current_date,
  valor numeric(14,2) not null,
  registrado_por uuid references usuarios(id),
  nota text,
  creado_en timestamptz not null default now()
);

-- ============================================================
-- VISTA: cálculo completo de cada Orden de Compra
-- (subtotal, impuestos, amortización, retención, neto, pagado, saldo)
-- Replica exactamente las fórmulas del sistema en Google Sheets.
-- ============================================================
create view v_ordenes_compra_calculadas as
with subtotales as (
  select orden_compra_id, coalesce(sum(cantidad * valor_unitario), 0) as subtotal
  from items_oc
  group by orden_compra_id
),
pagado as (
  select orden_compra_id, coalesce(sum(valor), 0) as pagado
  from pagos
  group by orden_compra_id
)
select
  oc.*,
  s.subtotal,
  case
    when oc.tipo_impuesto = 'CON_IVA' then round(s.subtotal * oc.porcentaje_iva / 100, 2)
    when oc.tipo_impuesto = 'CON_AIU' then round(s.subtotal * (oc.porcentaje_utilidad / 100) * (oc.porcentaje_iva / 100), 2)
    else 0
  end as valor_iva,
  case when oc.tipo_impuesto = 'CON_AIU' then round(s.subtotal * oc.porcentaje_administracion / 100, 2) else 0 end as valor_administracion,
  case when oc.tipo_impuesto = 'CON_AIU' then round(s.subtotal * oc.porcentaje_imprevistos / 100, 2) else 0 end as valor_imprevistos,
  case when oc.tipo_impuesto = 'CON_AIU' then round(s.subtotal * oc.porcentaje_utilidad / 100, 2) else 0 end as valor_utilidad,
  case when oc.tipo_impuesto = 'CON_AIU' then (oc.porcentaje_administracion + oc.porcentaje_imprevistos + oc.porcentaje_utilidad) else 0 end as porcentaje_aiu,
  case when oc.tipo_impuesto = 'CON_AIU' then
    round(s.subtotal * oc.porcentaje_administracion / 100, 2)
    + round(s.subtotal * oc.porcentaje_imprevistos / 100, 2)
    + round(s.subtotal * oc.porcentaje_utilidad / 100, 2)
  else 0 end as valor_aiu,
  round(oc.porcentaje_retencion / 100 *
    (s.subtotal - oc.descuento
      + (case when oc.tipo_impuesto = 'CON_IVA' then round(s.subtotal * oc.porcentaje_iva / 100, 2)
              when oc.tipo_impuesto = 'CON_AIU' then round(s.subtotal * (oc.porcentaje_utilidad/100) * (oc.porcentaje_iva/100), 2)
              else 0 end)
      + (case when oc.tipo_impuesto = 'CON_AIU' then
           round(s.subtotal * oc.porcentaje_administracion/100,2) + round(s.subtotal * oc.porcentaje_imprevistos/100,2) + round(s.subtotal * oc.porcentaje_utilidad/100,2)
         else 0 end)
    ), 2) as valor_retenido,
  coalesce(p.pagado, 0) as pagado
from ordenes_compra oc
left join subtotales s on s.orden_compra_id = oc.id
left join pagado p on p.orden_compra_id = oc.id;

-- Nota: TOTAL, VALOR_AMORTIZACIÓN, NETO_A_PAGAR y SALDO se calculan en la capa de
-- aplicación (lib/calculosOC.js) a partir de esta vista, porque VALOR_AMORTIZACIÓN
-- depende de otra fila (la orden referenciada) y es más claro y testeable en JS
-- que anidado en SQL. La vista entrega todos los insumos base ya calculados.

-- ============================================================
-- VISTA: acumulados por contrato (excluye filas ANTICIPO del Subtotal/Total,
-- igual que en el sistema actual, para no duplicar el valor del anticipo)
-- ============================================================
create view v_acumulados_contrato as
select
  contrato_id,
  sum(case when tipo_pago <> 'ANTICIPO' then subtotal else 0 end) as subtotal_acumulado,
  sum(valor_retenido) as retenido_acumulado,
  sum(devolucion_retenido) as devolucion_acumulada
from v_ordenes_compra_calculadas
where contrato_id is not null and estado <> 'ANULADA'
group by contrato_id;

-- ============================================================
-- SEGURIDAD: Row Level Security por rol
-- ============================================================
alter table usuarios enable row level security;
alter table proveedores enable row level security;
alter table contratos enable row level security;
alter table ordenes_compra enable row level security;
alter table items_oc enable row level security;
alter table pagos enable row level security;

-- Función auxiliar: rol del usuario autenticado
create or replace function rol_actual() returns rol_usuario as $$
  select rol from usuarios where id = auth.uid();
$$ language sql stable security definer;

-- Lectura: cualquier usuario autenticado y activo puede leer todo
create policy "lectura_general_usuarios" on usuarios for select using (auth.uid() is not null);
create policy "lectura_general_proveedores" on proveedores for select using (auth.uid() is not null);
create policy "lectura_general_contratos" on contratos for select using (auth.uid() is not null);
create policy "lectura_general_oc" on ordenes_compra for select using (auth.uid() is not null);
create policy "lectura_general_items" on items_oc for select using (auth.uid() is not null);
create policy "lectura_general_pagos" on pagos for select using (auth.uid() is not null);

-- Escritura: admin y operativo, NUNCA lectura
create policy "escritura_proveedores" on proveedores for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));
create policy "escritura_contratos" on contratos for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));
create policy "escritura_oc" on ordenes_compra for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));
create policy "escritura_items" on items_oc for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));
create policy "escritura_pagos" on pagos for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));

-- Usuarios: solo admin puede crear/editar otros usuarios
create policy "escritura_usuarios_admin" on usuarios for update
  using (rol_actual() = 'admin');
create policy "insercion_usuarios_admin" on usuarios for insert
  with check (rol_actual() = 'admin' or auth.uid() = id);
