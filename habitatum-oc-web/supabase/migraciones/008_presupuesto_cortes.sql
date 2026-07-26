-- ============================================================
-- CORTES DE CONTROL PRESUPUESTAL
-- Un "corte" es una foto congelada (snapshot) de lo ejecutado en un periodo
-- (normalmente mensual, coincidiendo con la reunión de seguimiento de costos
-- con el cliente). Una vez cerrado, un corte NO se recalcula: sus valores
-- quedan fijos aunque después se editen o anulen Órdenes de Compra viejas.
--
-- El periodo de cada corte se define por la fecha de la Orden de Compra
-- (oc.fecha): fecha_desde = día siguiente al fecha_hasta del corte anterior
-- (o sin límite inferior para el Corte 1), fecha_hasta = fecha de cierre que
-- el usuario elige (por defecto hoy).
-- ============================================================

create table presupuesto_cortes (
  id uuid primary key default gen_random_uuid(),
  presupuesto_id uuid not null references presupuestos(id) on delete cascade,
  numero int not null,
  fecha_desde date, -- null = sin límite inferior (Corte 1: todo lo anterior a fecha_hasta)
  fecha_hasta date not null,
  creado_por uuid references usuarios(id),
  creado_en timestamptz not null default now(),
  unique (presupuesto_id, numero)
);

-- Snapshot congelado: cuánto se ejecutó de cada ítem de presupuesto DURANTE
-- ese corte (no acumulado). Es lo que alimenta el bloque de 3 columnas
-- "CONTROL PRESUPUESTAL N" (cantidad / vr unitario / vr parcial) del Excel.
create table presupuesto_corte_items (
  id uuid primary key default gen_random_uuid(),
  corte_id uuid not null references presupuesto_cortes(id) on delete cascade,
  presupuesto_item_id uuid not null references presupuesto_items(id) on delete cascade,
  cantidad_ejecutada numeric(14,2) not null default 0,
  valor_ejecutado numeric(14,2) not null default 0,
  unique (corte_id, presupuesto_item_id)
);

-- Detalle congelado de las Órdenes de Compra que componen cada corte (hoja
-- de soporte tipo "EXT. N" del archivo de referencia). Se guarda todo
-- denormalizado (folio, proveedor, ítem de presupuesto, valores) para que el
-- detalle nunca cambie aunque la Orden de Compra original se edite o borre
-- después.
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

alter table presupuesto_cortes enable row level security;
alter table presupuesto_corte_items enable row level security;
alter table presupuesto_corte_ocs enable row level security;

create policy "lectura_general_presupuesto_cortes" on presupuesto_cortes for select using (auth.uid() is not null);
create policy "lectura_general_presupuesto_corte_items" on presupuesto_corte_items for select using (auth.uid() is not null);
create policy "lectura_general_presupuesto_corte_ocs" on presupuesto_corte_ocs for select using (auth.uid() is not null);

-- Cerrar un corte es una acción operativa (como crear una OC): admin y
-- operativo pueden hacerlo. No se permite update (un corte cerrado no se
-- edita); solo insert y, si hace falta corregir un error reciente, delete.
create policy "escritura_presupuesto_cortes" on presupuesto_cortes for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));
create policy "escritura_presupuesto_corte_items" on presupuesto_corte_items for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));
create policy "escritura_presupuesto_corte_ocs" on presupuesto_corte_ocs for all
  using (rol_actual() in ('admin','operativo')) with check (rol_actual() in ('admin','operativo'));
