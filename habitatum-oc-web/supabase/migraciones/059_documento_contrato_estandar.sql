-- 059 · Documento del contrato estándar con contratista v1.0 (administración delegada).
-- Reemplaza la capa DOCUMENTO del contrato (cláusulas viejas, pólizas sí/no, ítems Excel, PDF viejo).
-- NO toca el núcleo: contratos, contrato_items (salvo la marca nueva `referencia`), cortes, OC,
-- anticipos, retenido ni estado de cuenta. No borra ni modifica datos existentes; las columnas
-- viejas del documento quedan sin uso (se borrarán en otra migración, solo con aprobación).
-- La plantilla 1.0 (JSON tal cual) se carga en 059b_plantilla_contrato_v1.sql.

-- 1) Plantillas versionadas: una versión publicada no se edita; un cambio = versión nueva.
create table if not exists public.contrato_plantillas (
  id uuid primary key default gen_random_uuid(),
  plantilla text not null,
  version text not null,
  modalidad text not null default 'ADMINISTRACION_DELEGADA',
  contenido jsonb not null,
  parametros jsonb not null default '{}'::jsonb,   -- ej. {"smmlv": 1423500} para la advertencia de 20 SMMLV
  vigente boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (plantilla, version)
);

-- 2) Propietarios del proyecto (el Contratante): lista en el proyecto, el primero es el principal.
--    [{tipo_persona NATURAL|JURIDICA, nombre, identificacion, representante_legal, cc_representante,
--      direccion, telefono, correo}]
alter table public.proyectos add column if not exists propietarios jsonb not null default '[]'::jsonb;

-- 3) Proyecto: director y horario (vacío = valor por defecto de la plantilla).
alter table public.proyectos
  add column if not exists director_obra text,
  add column if not exists horario_obra text;

-- 4) Proveedor: datos para las partes y el régimen.
alter table public.proveedores
  add column if not exists tipo_persona text default 'NATURAL',
  add column if not exists cc_representante text,
  add column if not exists direccion text,
  add column if not exists correo text,
  add column if not exists regimen_iva text,
  add column if not exists soporte_cobro text;
alter table public.proveedores
  add constraint proveedores_tipo_persona_chk check (tipo_persona in ('NATURAL','JURIDICA')),
  add constraint proveedores_regimen_iva_chk check (regimen_iva in ('NO_RESPONSABLE','RESPONSABLE')),
  add constraint proveedores_soporte_cobro_chk check (soporte_cobro in ('CUENTA_COBRO','FACTURA'));

-- 5) Ítems de referencia (Anexo 1, sección B): no suman al valor del contrato.
alter table public.contrato_items add column if not exists referencia boolean not null default false;

-- 6) Documento del contrato (1:1 con el contrato).
create table if not exists public.contrato_documentos (
  contrato_id uuid primary key references public.contratos(id),
  plantilla_id uuid not null references public.contrato_plantillas(id),
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR','GENERADO','FIRMADO')),
  campos jsonb not null default '{}'::jsonb,        -- Condiciones Particulares editables (clave del JSON → texto)
  contratante jsonb not null default '[]'::jsonb,   -- copia editable de los propietarios
  regimen text not null default 'SIN_IVA' check (regimen in ('IVA','AIU','SIN_IVA')),
  pct_a numeric not null default 0, pct_i numeric not null default 0,
  pct_u numeric not null default 0, pct_iva numeric not null default 19,
  anticipo_pct numeric not null default 0 check (anticipo_pct >= 0 and anticipo_pct <= 100),
  retencion_pct numeric not null default 10 check (retencion_pct >= 0 and retencion_pct <= 100),
  garantias jsonb not null default '[]'::jsonb,     -- [{clave, activa, pct, vigencia}]
  obligaciones jsonb not null default '[]'::jsonb,  -- ["texto", ...] Anexo 2, sección C
  fecha_firma date,
  snapshot jsonb,
  generado_en timestamptz, generado_por uuid,
  firmado_path text, firmado_en timestamptz, firmado_por uuid,
  actualizado_en timestamptz not null default now(), actualizado_por uuid
);

-- 7) Seguridad. Todos los usuarios internos leen; solo admin escribe (por funciones). Propietarios, director
--    y horario los edita el admin en proyectos (política existente: actualizar proyectos = admin).
alter table public.contrato_plantillas enable row level security;
alter table public.contrato_documentos enable row level security;
create policy plantillas_lectura on public.contrato_plantillas for select using (auth.uid() is not null);
create policy documentos_lectura on public.contrato_documentos for select using (auth.uid() is not null);
revoke all on public.contrato_plantillas, public.contrato_documentos from anon, authenticated;
grant select on public.contrato_plantillas, public.contrato_documentos to authenticated;

-- 8) Escaneados firmados: bucket privado, lectura interna, subida solo admin.
insert into storage.buckets (id, name, public) values ('contratos-firmados', 'contratos-firmados', false)
  on conflict (id) do nothing;
create policy contratos_firmados_lectura on storage.objects for select
  using (bucket_id = 'contratos-firmados' and auth.uid() is not null);
create policy contratos_firmados_subir on storage.objects for insert
  with check (bucket_id = 'contratos-firmados' and public.es_admin());

-- 9) Datos del documento (precarga + borrador guardado). Lo leen todos los usuarios internos.
create or replace function public.documento_contrato_datos(p_contrato uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; v_res jsonb;
begin
  if auth.uid() is null then raise exception 'Inicie sesión.'; end if;
  select * into c from contratos where id = p_contrato;
  if c.id is null then raise exception 'Contrato no encontrado.'; end if;
  select jsonb_build_object(
    'contrato', jsonb_build_object('id', c.id, 'numero_contrato', c.numero_contrato, 'concepto', c.concepto,
        'alcance_detallado', c.alcance_detallado, 'fecha_contrato', c.fecha_contrato, 'pct_anticipo', c.pct_anticipo,
        'estado', c.estado),
    'proyecto', (select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'codigo', p.codigo, 'cliente', p.cliente,
        'direccion_obra', p.direccion_obra, 'ciudad', p.ciudad, 'modelo_contratacion', p.modelo_contratacion,
        'director_obra', p.director_obra, 'horario_obra', p.horario_obra) from proyectos p where p.id = c.proyecto_id),
    'propietarios', coalesce((select p.propietarios from proyectos p where p.id = c.proyecto_id), '[]'::jsonb),
    'proveedor', (select jsonb_build_object('id', v.id, 'nombre', v.nombre, 'nit', v.nit, 'telefono', v.telefono,
        'representante_legal', v.representante_legal, 'tipo_persona', v.tipo_persona, 'cc_representante', v.cc_representante,
        'direccion', v.direccion, 'correo', v.correo, 'regimen_iva', v.regimen_iva, 'soporte_cobro', v.soporte_cobro)
        from proveedores v where v.id = c.contratista_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'codigo', i.codigo, 'descripcion', i.descripcion,
        'unidad', i.unidad, 'cantidad', i.cantidad, 'valor_unitario', i.valor_unitario, 'referencia', i.referencia)
        order by i.orden, i.codigo) from contrato_items i where i.contrato_id = c.id and not i.es_adicional), '[]'::jsonb),
    'documento', (select to_jsonb(d) - 'snapshot' from contrato_documentos d where d.contrato_id = c.id),
    'snapshot', (select d.snapshot from contrato_documentos d where d.contrato_id = c.id),
    'plantilla', (select jsonb_build_object('id', t.id, 'version', t.version, 'contenido', t.contenido, 'parametros', t.parametros)
        from contrato_plantillas t
        where t.id = coalesce((select d.plantilla_id from contrato_documentos d where d.contrato_id = c.id),
                              (select id from contrato_plantillas where plantilla = 'contrato_obra_contratista' and vigente
                               order by creado_en desc limit 1)))
  ) into v_res;
  return v_res;
end $$;

-- 10) Guardar borrador (solo admin; nunca un FIRMADO; solo administración delegada).
--     Editar un documento GENERADO lo devuelve a BORRADOR (hay que volver a generar).
create or replace function public.guardar_documento_contrato(p_contrato uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v_estado text; v_plantilla uuid;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede editar el documento del contrato.'; end if;
  select k.*, p.modelo_contratacion into c from contratos k join proyectos p on p.id = k.proyecto_id where k.id = p_contrato;
  if c.id is null then raise exception 'Contrato no encontrado.'; end if;
  if c.modelo_contratacion = 'TODO_COSTO' then raise exception 'Formato todo costo pendiente.'; end if;
  select estado, plantilla_id into v_estado, v_plantilla from contrato_documentos where contrato_id = p_contrato for update;
  if v_estado = 'FIRMADO' then raise exception 'El contrato está firmado y no se puede modificar.'; end if;
  if v_plantilla is null then
    select id into v_plantilla from contrato_plantillas where plantilla = 'contrato_obra_contratista' and vigente order by creado_en desc limit 1;
    if v_plantilla is null then raise exception 'No hay plantilla vigente.'; end if;
  end if;

  insert into contrato_documentos (contrato_id, plantilla_id, estado, campos, contratante, regimen, pct_a, pct_i, pct_u, pct_iva,
      anticipo_pct, retencion_pct, garantias, obligaciones, fecha_firma, actualizado_en, actualizado_por)
  values (p_contrato, v_plantilla, 'BORRADOR',
      coalesce(p_datos->'campos', '{}'::jsonb), coalesce(p_datos->'contratante', '[]'::jsonb),
      coalesce(p_datos->>'regimen', 'SIN_IVA'),
      coalesce((p_datos->>'pct_a')::numeric, 0), coalesce((p_datos->>'pct_i')::numeric, 0),
      coalesce((p_datos->>'pct_u')::numeric, 0), coalesce((p_datos->>'pct_iva')::numeric, 19),
      coalesce((p_datos->>'anticipo_pct')::numeric, 0), coalesce((p_datos->>'retencion_pct')::numeric, 10),
      coalesce(p_datos->'garantias', '[]'::jsonb), coalesce(p_datos->'obligaciones', '[]'::jsonb),
      nullif(p_datos->>'fecha_firma', '')::date, now(), auth.uid())
  on conflict (contrato_id) do update set
      estado = 'BORRADOR', campos = excluded.campos, contratante = excluded.contratante, regimen = excluded.regimen,
      pct_a = excluded.pct_a, pct_i = excluded.pct_i, pct_u = excluded.pct_u, pct_iva = excluded.pct_iva,
      anticipo_pct = excluded.anticipo_pct, retencion_pct = excluded.retencion_pct,
      garantias = excluded.garantias, obligaciones = excluded.obligaciones, fecha_firma = excluded.fecha_firma,
      actualizado_en = now(), actualizado_por = auth.uid();

  -- Marca de ítems de referencia (Anexo 1 sección B), solo si se envía la lista.
  if p_datos ? 'referencias' then
    update contrato_items set referencia = (id::text in (select jsonb_array_elements_text(p_datos->'referencias')))
    where contrato_id = p_contrato and not es_adicional;
  end if;
  return public.documento_contrato_datos(p_contrato);
end $$;

-- 11) Generar: valida obligatorios y congela la foto fija (datos + plantilla). Estado GENERADO.
create or replace function public.generar_documento_contrato(p_contrato uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; v_datos jsonb; f jsonb; v_falta text[] := '{}'; o jsonb;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede generar el contrato.'; end if;
  select * into d from contrato_documentos where contrato_id = p_contrato for update;
  if d.contrato_id is null then raise exception 'Guarde el documento antes de generarlo.'; end if;
  if d.estado = 'FIRMADO' then raise exception 'El contrato ya está firmado.'; end if;
  f := d.campos;
  if jsonb_array_length(d.contratante) = 0 then v_falta := array_append(v_falta, 'propietarios del Contratante'::text); end if;
  for o in select * from jsonb_array_elements(d.contratante) loop
    if coalesce(trim(o->>'nombre'), '') = '' or coalesce(trim(o->>'identificacion'), '') = '' then
      v_falta := array_append(v_falta, 'nombre e identificación de cada propietario'::text); exit; end if;
  end loop;
  if coalesce(trim(f->>'contratista_nombre'), '') = '' or coalesce(trim(f->>'contratista_identificacion'), '') = '' then
    v_falta := array_append(v_falta, 'nombre e identificación del Contratista'::text); end if;
  if coalesce(trim(f->>'proyecto_nombre'), '') = '' or coalesce(trim(f->>'proyecto_ubicacion'), '') = '' then
    v_falta := array_append(v_falta, 'proyecto y ubicación'::text); end if;
  if coalesce(trim(f->>'actividad'), '') = '' then v_falta := array_append(v_falta, 'actividad'::text); end if;
  if coalesce(trim(f->>'alcance'), '') = '' then v_falta := array_append(v_falta, 'alcance'::text); end if;
  if coalesce(trim(f->>'plazo'), '') = '' then v_falta := array_append(v_falta, 'plazo'::text); end if;
  if coalesce(trim(f->>'lugar_firma'), '') = '' or d.fecha_firma is null then v_falta := array_append(v_falta, 'lugar y fecha de firma'::text); end if;
  if not exists (select 1 from contrato_items i where i.contrato_id = p_contrato and not i.es_adicional and not i.referencia
                 and coalesce(i.cantidad, 0) > 0 and coalesce(i.valor_unitario, 0) > 0) then
    v_falta := array_append(v_falta, 'al menos un ítem con cantidad y valor'::text); end if;
  if array_length(v_falta, 1) > 0 then raise exception 'Faltan datos obligatorios: %.', array_to_string(v_falta, ', '); end if;

  v_datos := public.documento_contrato_datos(p_contrato) - 'snapshot';
  update contrato_documentos set estado = 'GENERADO', snapshot = v_datos || jsonb_build_object('generado_en', now()),
    generado_en = now(), generado_por = auth.uid() where contrato_id = p_contrato;
  return public.documento_contrato_datos(p_contrato);
end $$;

-- 12) Firmar: requiere GENERADO y el escaneado ya subido. Queda bloqueado.
create or replace function public.firmar_documento_contrato(p_contrato uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede marcar el contrato como firmado.'; end if;
  select estado into v_estado from contrato_documentos where contrato_id = p_contrato for update;
  if v_estado is distinct from 'GENERADO' then raise exception 'Primero genere el contrato.'; end if;
  if coalesce(trim(p_path), '') = '' then raise exception 'Suba el PDF del contrato firmado.'; end if;
  update contrato_documentos set estado = 'FIRMADO', firmado_path = p_path, firmado_en = now(), firmado_por = auth.uid()
  where contrato_id = p_contrato;
  return public.documento_contrato_datos(p_contrato);
end $$;

revoke all on function public.documento_contrato_datos(uuid), public.guardar_documento_contrato(uuid, jsonb),
  public.generar_documento_contrato(uuid), public.firmar_documento_contrato(uuid, text) from public, anon;
grant execute on function public.documento_contrato_datos(uuid), public.guardar_documento_contrato(uuid, jsonb),
  public.generar_documento_contrato(uuid), public.firmar_documento_contrato(uuid, text) to authenticated;
