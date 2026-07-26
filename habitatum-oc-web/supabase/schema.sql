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
  usuario text unique, -- nombre de usuario para login sin correo real (correo interno sintético)
  rol rol_usuario not null default 'lectura',
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ---------- PROYECTOS ----------
-- Los Proveedores quedan GLOBALES (no llevan proyecto_id): un proveedor
-- creado una vez queda disponible para todos los proyectos.
create table proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo text not null unique, -- número consecutivo que el Admin asigna manualmente (ej. "001")
  cliente text,
  estado text not null default 'activo', -- 'activo' | 'inactivo'
  mostrar_marca_habitatum boolean not null default true, -- false = proyecto donde se actúa como persona natural, sin marca HABITATUM
  nombre_emisor text, -- nombre a mostrar en los documentos cuando mostrar_marca_habitatum = false (ej. "Arq. Andrés David Hincapié")
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
  proyecto_id uuid references proyectos(id),
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
-- El folio (OC-{código proyecto}-{consecutivo}) se calcula por proyecto mediante
-- el trigger set_folio_por_proyecto definido más abajo, no con una secuencia global.
create table ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  folio text,
  tipo_orden tipo_orden_enum not null default 'COMPRA',
  proyecto_id uuid references proyectos(id),
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
  modificado_por uuid references usuarios(id),
  modificado_en timestamptz,
  unique (folio)
);

-- Folio por proyecto: OC-{código proyecto}-{consecutivo propio del proyecto}.
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

create trigger trg_set_folio_por_proyecto
  before insert on ordenes_compra
  for each row execute function set_folio_por_proyecto();

-- Auditoría: creado_por/modificado_por se calculan siempre en el servidor con
-- auth.uid(), el cliente no puede suplantar a otro usuario.
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

create trigger trg_set_auditoria_oc
  before insert or update on ordenes_compra
  for each row execute function set_auditoria_oc();

-- Anular: solo el Admin puede pasar una OC a estado ANULADA (validado en la BD).
create or replace function prevent_non_admin_anular() returns trigger as $$
begin
  if new.estado = 'ANULADA' and old.estado <> 'ANULADA' and rol_actual() <> 'admin' then
    raise exception 'Solo un administrador puede anular una Orden de Compra';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_prevent_non_admin_anular
  before update on ordenes_compra
  for each row execute function prevent_non_admin_anular();

-- ---------- PRESUPUESTO ----------
-- Se carga desde el Excel "FORMULARIO DE PRECIOS" (mismo formato para todos
-- los proyectos). Un proyecto tiene UN presupuesto activo: al volver a cargar
-- el Excel se reemplaza todo (capítulos e ítems anteriores se borran por
-- cascada). Se define antes de ÍTEMS DE CADA ORDEN porque items_oc referencia
-- presupuesto_items.
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

-- ---------- CORTES DE CONTROL PRESUPUESTAL ----------
-- Un "corte" es una foto congelada de lo ejecutado en un periodo (normalmente
-- mensual, para la reunión de seguimiento de costos con el cliente). Una vez
-- cerrado, no se recalcula: sus valores quedan fijos aunque después se editen
-- o anulen Órdenes de Compra viejas. El periodo se define por oc.fecha.
create table presupuesto_cortes (
  id uuid primary key default gen_random_uuid(),
  presupuesto_id uuid not null references presupuestos(id) on delete cascade,
  numero int not null,
  fecha_desde date, -- null = sin límite inferior (Corte 1)
  fecha_hasta date not null,
  creado_por uuid references usuarios(id),
  creado_en timestamptz not null default now(),
  unique (presupuesto_id, numero)
);

-- Snapshot congelado de lo ejecutado por ítem DURANTE ese corte (no acumulado).
create table presupuesto_corte_items (
  id uuid primary key default gen_random_uuid(),
  corte_id uuid not null references presupuesto_cortes(id) on delete cascade,
  presupuesto_item_id uuid not null references presupuesto_items(id) on delete cascade,
  cantidad_ejecutada numeric(14,2) not null default 0,
  valor_ejecutado numeric(14,2) not null default 0,
  unique (corte_id, presupuesto_item_id)
);

-- Detalle congelado de las Órdenes de Compra que componen cada corte (hoja de
-- soporte tipo "EXT. N"), denormalizado para que nunca cambie aunque la OC
-- original se edite o borre después.
create table presupuesto_corte_ocs (
  id uuid primary key default gen_random_uuid(),
  corte_id uuid not null references presupuesto_cortes(id) on delete cascade,
  orden_compra_id uuid references ordenes_compra(id) on delete set null,
  folio text,
  fecha date,
  proveedor text,
  capitulo_codigo text,
  item_codigo text,
  item_descripcion text,
  descripcion text,
  cantidad numeric(14,2),
  valor_unitario numeric(14,2),
  valor numeric(14,2) not null default 0
);

-- ---------- ÍTEMS DE CADA ORDEN ----------
create table items_oc (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references ordenes_compra(id) on delete cascade,
  descripcion text not null,
  unidad text, -- ej. "UND", "M2", "GLB"
  cantidad numeric(12,2) not null default 1,
  valor_unitario numeric(14,2) not null default 0,
  presupuesto_item_id uuid references presupuesto_items(id) on delete set null
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
-- (subtotal, impuestos, TOTAL, amortización, retención, neto a pagar, pagado,
-- saldo y saldo del anticipo por amortizar). Replica exactamente las fórmulas
-- del sistema en Google Sheets (ver references/mapa_columnas.md del skill
-- ordenes-de-compra-obra). Todo se calcula aquí, en SQL: es la única fuente
-- de verdad que usan por igual el listado, el detalle y el PDF.
-- ============================================================
create view v_ordenes_compra_calculadas as
with subtotales as (
  select orden_compra_id, coalesce(sum(cantidad * valor_unitario), 0) as subtotal
  from items_oc
  group by orden_compra_id
),
base as (
  select
    oc.*,
    coalesce(s.subtotal, 0) as subtotal,
    case
      when oc.tipo_impuesto = 'CON_IVA' then round(coalesce(s.subtotal, 0) * oc.porcentaje_iva / 100, 2)
      when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * (oc.porcentaje_utilidad / 100) * (oc.porcentaje_iva / 100), 2)
      else 0
    end as valor_iva,
    case when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_administracion / 100, 2) else 0 end as valor_administracion,
    case when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_imprevistos / 100, 2) else 0 end as valor_imprevistos,
    case when oc.tipo_impuesto = 'CON_AIU' then round(coalesce(s.subtotal, 0) * oc.porcentaje_utilidad / 100, 2) else 0 end as valor_utilidad,
    case when oc.tipo_impuesto = 'CON_AIU' then (oc.porcentaje_administracion + oc.porcentaje_imprevistos + oc.porcentaje_utilidad) else 0 end as porcentaje_aiu
  from ordenes_compra oc
  left join subtotales s on s.orden_compra_id = oc.id
),
calculado as (
  select
    base.*,
    (case when tipo_impuesto = 'CON_AIU' then valor_administracion + valor_imprevistos + valor_utilidad else 0 end) as valor_aiu,
    (subtotal - descuento + valor_iva
      + (case when tipo_impuesto = 'CON_AIU' then valor_administracion + valor_imprevistos + valor_utilidad else 0 end)
    ) as total
  from base
),
con_derivados as (
  select
    calculado.*,
    (case when tipo_pago = 'ANTICIPO' then 0 else round(total * coalesce(porcentaje_amortizacion, 0) / 100, 2) end) as valor_amortizacion,
    round(coalesce(porcentaje_retencion, 0) / 100 * total, 2) as valor_retenido
  from calculado
),
con_neto as (
  select
    con_derivados.*,
    (total - valor_amortizacion - valor_retenido + coalesce(devolucion_retenido, 0)) as neto_a_pagar,
    -- Toda OC se asume pagada desde que se crea (decisión del usuario): ya no se
    -- suma desde la tabla `pagos`.
    total as pagado,
    0::numeric as saldo
  from con_derivados
),
amortizado_por_anticipo as (
  select referencia_anticipo_id, sum(valor_amortizacion) as amortizado_total
  from con_neto
  where referencia_anticipo_id is not null
  group by referencia_anticipo_id
)
select
  con_neto.*,
  case when con_neto.tipo_pago = 'ANTICIPO'
    then round(con_neto.total - coalesce(amortizado_por_anticipo.amortizado_total, 0), 2)
    else null
  end as saldo_anticipo_por_amortizar
from con_neto
left join amortizado_por_anticipo on amortizado_por_anticipo.referencia_anticipo_id = con_neto.id;

-- ============================================================
-- VISTA: acumulados por contrato (excluye filas ANTICIPO del Subtotal/Total,
-- igual que en el sistema anterior, para no duplicar el valor del anticipo)
-- ============================================================
create view v_acumulados_contrato as
select
  contrato_id,
  sum(case when tipo_pago <> 'ANTICIPO' then subtotal else 0 end) as subtotal_acumulado,
  sum(case when tipo_pago <> 'ANTICIPO' then total else 0 end) as total_acumulado,
  sum(valor_retenido) as retenido_acumulado,
  sum(valor_amortizacion) as amortizado_acumulado,
  sum(devolucion_retenido) as devolucion_acumulada
from v_ordenes_compra_calculadas
where contrato_id is not null and estado <> 'ANULADA'
group by contrato_id;

-- ============================================================
-- VISTA: ejecutado por ítem de presupuesto (suma de los ítems de OC
-- vinculados, excluyendo Órdenes de Compra ANULADAS)
-- ============================================================
create view v_presupuesto_ejecutado as
select
  io.presupuesto_item_id,
  sum(io.cantidad * io.valor_unitario) as ejecutado
from items_oc io
join ordenes_compra oc on oc.id = io.orden_compra_id
where io.presupuesto_item_id is not null and oc.estado <> 'ANULADA'
group by io.presupuesto_item_id;

-- ============================================================
-- SEGURIDAD: Row Level Security por rol
-- ============================================================
alter table usuarios enable row level security;
alter table proyectos enable row level security;
alter table proveedores enable row level security;
alter table contratos enable row level security;
alter table ordenes_compra enable row level security;
alter table items_oc enable row level security;
alter table pagos enable row level security;
alter table presupuestos enable row level security;
alter table presupuesto_capitulos enable row level security;
alter table presupuesto_items enable row level security;
alter table presupuesto_cortes enable row level security;
alter table presupuesto_corte_items enable row level security;
alter table presupuesto_corte_ocs enable row level security;

-- Función auxiliar: rol del usuario autenticado
create or replace function rol_actual() returns rol_usuario as $$
  select rol from usuarios where id = auth.uid();
$$ language sql stable security definer;

-- Lectura: cualquier usuario autenticado y activo puede leer todo
create policy "lectura_general_usuarios" on usuarios for select using (auth.uid() is not null);
create policy "lectura_general_proyectos" on proyectos for select using (auth.uid() is not null);
create policy "lectura_general_proveedores" on proveedores for select using (auth.uid() is not null);
create policy "lectura_general_contratos" on contratos for select using (auth.uid() is not null);
create policy "lectura_general_oc" on ordenes_compra for select using (auth.uid() is not null);
create policy "lectura_general_items" on items_oc for select using (auth.uid() is not null);
create policy "lectura_general_pagos" on pagos for select using (auth.uid() is not null);
create policy "lectura_general_presupuestos" on presupuestos for select using (auth.uid() is not null);
create policy "lectura_general_presupuesto_capitulos" on presupuesto_capitulos for select using (auth.uid() is not null);
create policy "lectura_general_presupuesto_items" on presupuesto_items for select using (auth.uid() is not null);
create policy "lectura_general_presupuesto_cortes" on presupuesto_cortes for select using (auth.uid() is not null);
create policy "lectura_general_presupuesto_corte_items" on presupuesto_corte_items for select using (auth.uid() is not null);
create policy "lectura_general_presupuesto_corte_ocs" on presupuesto_corte_ocs for select using (auth.uid() is not null);

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

-- Presupuesto: cargar/reemplazar solo Admin (fuente de verdad = Excel).
create policy "escritura_presupuestos_admin" on presupuestos for all
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy "escritura_presupuesto_capitulos_admin" on presupuesto_capitulos for all
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy "escritura_presupuesto_items_admin" on presupuesto_items for all
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- Cortes: cerrar un corte es una acción operativa (como crear una OC), no
-- requiere ser admin. No se contempla "update": un corte cerrado no se edita.
create policy "escritura_presupuesto_cortes" on presupuesto_cortes for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));
create policy "escritura_presupuesto_corte_items" on presupuesto_corte_items for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));
create policy "escritura_presupuesto_corte_ocs" on presupuesto_corte_ocs for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));

-- Usuarios: solo admin puede crear/editar otros usuarios
create policy "escritura_usuarios_admin" on usuarios for update
  using (rol_actual() = 'admin');
create policy "insercion_usuarios_admin" on usuarios for insert
  with check (rol_actual() = 'admin' or auth.uid() = id);

-- Proyectos: solo admin puede crear o modificar
create policy "creacion_proyectos_admin" on proyectos for insert
  with check (rol_actual() = 'admin');
create policy "actualizacion_proyectos_admin" on proyectos for update
  using (rol_actual() = 'admin');
