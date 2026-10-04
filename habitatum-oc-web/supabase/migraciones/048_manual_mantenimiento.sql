-- 048 · Manual de uso y mantenimiento (entrega al cliente) — aplicada el 04/10/2026, registro Supabase: manual_mantenimiento
-- Un manual por obra. Lo alimentan los chats de obra (residente virtual) y se descarga en PDF desde la app.
-- Nunca lleva precios, costos ni valores de contratos.

create table if not exists public.manual_mantenimiento (
  proyecto_id uuid primary key references public.proyectos(id) on delete cascade,
  cliente text, direccion text, fecha_entrega date,
  presentacion text,
  contacto_postventa text,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
create table if not exists public.manual_contactos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  contrato_id uuid references public.contratos(id) on delete set null,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  empresa text not null, actividad text, persona_contacto text, telefono text, correo text,
  garantia_meses numeric, garantia_desde date, garantia_hasta date, notas text,
  orden integer not null default 0
);
create table if not exists public.manual_acabados (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  espacio text, elemento text not null, material text, marca text, referencia text, color text,
  donde_comprar text, proveedor_id uuid references public.proveedores(id) on delete set null,
  cuidado text, notas text, orden integer not null default 0
);
create table if not exists public.manual_sistemas (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  sistema text not null, titulo text not null, descripcion text, uso text, mantenimiento text, que_hacer text,
  orden integer not null default 0
);
create table if not exists public.manual_rutinas (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  sistema text not null, tarea text not null,
  frecuencia text not null check (frecuencia in ('MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL','CADA_2_ANOS','SEGUN_USO')),
  responsable text not null default 'PROPIETARIO' check (responsable in ('PROPIETARIO','TECNICO')),
  orden integer not null default 0
);
create table if not exists public.manual_anexos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  titulo text not null, proveedor text, storage_path text, orden integer not null default 0,
  subido_en timestamptz not null default now()
);
create index if not exists manual_contactos_proy on public.manual_contactos(proyecto_id);
create index if not exists manual_acabados_proy on public.manual_acabados(proyecto_id);
create index if not exists manual_sistemas_proy on public.manual_sistemas(proyecto_id);
create index if not exists manual_rutinas_proy on public.manual_rutinas(proyecto_id);
create index if not exists manual_anexos_proy on public.manual_anexos(proyecto_id);

-- Permisos: leen todos los usuarios con sesión; escriben admin y operativo (el residente virtual).
do $p$ declare t text; begin
  foreach t in array array['manual_mantenimiento','manual_contactos','manual_acabados','manual_sistemas','manual_rutinas','manual_anexos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format('create policy %I on public.%I for select using (auth.uid() is not null)', t || '_lectura', t);
    execute format('drop policy if exists %I on public.%I', t || '_escritura', t);
    execute format('create policy %I on public.%I for all using (public.rol_actual() in (''admin'',''operativo'')) with check (public.rol_actual() in (''admin'',''operativo''))', t || '_escritura', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $p$;

-- Crea el manual de una obra con la plantilla base de HABITATUM e importa el directorio desde los contratos.
-- Es idempotente: si ya existe, solo agrega contratos nuevos y no toca lo editado.
create or replace function public.manual_inicializar(p_proyecto uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nuevos_contactos int := 0; v_base boolean := false; p record;
begin
  if public.rol_actual() not in ('admin','operativo') then raise exception 'Sin permiso para preparar el manual.'; end if;
  select * into p from public.proyectos where id = p_proyecto;
  if p.id is null then raise exception 'La obra no existe.'; end if;

  insert into public.manual_mantenimiento (proyecto_id, cliente, direccion, presentacion, actualizado_por)
  values (p_proyecto, p.cliente, nullif(concat_ws(', ', p.direccion_obra, p.ciudad), ''),
    'Este manual reúne la información necesaria para usar, cuidar y mantener su inmueble: los contratistas y proveedores que participaron en la obra, las garantías vigentes, los acabados y materiales instalados (para reponerlos si algún día lo necesita), las recomendaciones de uso y mantenimiento de cada sistema y las rutinas de mantenimiento preventivo. Consérvelo junto con los documentos del inmueble y compártalo con quien realice trabajos en él.',
    auth.uid())
  on conflict (proyecto_id) do nothing;

  -- Directorio desde los contratos (un registro por contrato, sin duplicar).
  with nuevos as (
    insert into public.manual_contactos (proyecto_id, contrato_id, proveedor_id, empresa, actividad, persona_contacto, telefono,
                                         garantia_meses, orden)
    select p_proyecto, k.id, pr.id, pr.nombre, coalesce(nullif(k.concepto, ''), k.tipo_contrato::text), pr.representante_legal, pr.telefono,
           case when coalesce(k.garantia_meses, '') ~ '^\d+(\.\d+)?$' and k.garantia_meses::numeric > 0 then k.garantia_meses::numeric end,
           row_number() over (order by k.numero_contrato)::int
    from public.contratos k join public.proveedores pr on pr.id = k.contratista_id
    where k.proyecto_id = p_proyecto and k.estado <> 'ANULADO'
      and not exists (select 1 from public.manual_contactos c where c.contrato_id = k.id)
    returning 1)
  select count(*) into v_nuevos_contactos from nuevos;

  -- Plantilla base por sistema (solo la primera vez).
  if not exists (select 1 from public.manual_sistemas where proyecto_id = p_proyecto) then
    v_base := true;
    insert into public.manual_sistemas (proyecto_id, sistema, titulo, uso, mantenimiento, que_hacer, orden) values
    (p_proyecto, 'ELECTRICO', 'Instalaciones eléctricas',
     'No sobrecargue tomacorrientes con multitomas ni extensiones en cadena. Los equipos de alto consumo (horno, estufa eléctrica, calentador, aire acondicionado) deben ir en su circuito propio. Identifique en el tablero qué circuito alimenta cada zona; el cuadro de circuitos está pegado en la tapa del tablero.',
     'Revise una vez al año que los tacos (interruptores automáticos) no estén calientes ni hagan ruido. Pruebe mensualmente el botón TEST de los tomacorrientes GFCI de baños y cocina. Cambie las bombillas por otras de la misma potencia y tipo. Cualquier modificación debe hacerla un electricista certificado (RETIE).',
     'Si un taco se dispara, desconecte los equipos de ese circuito, súbalo y conecte uno a uno para identificar el que falla. Si se dispara sin nada conectado o huele a quemado, no lo vuelva a subir y llame al electricista del directorio.', 1),
    (p_proyecto, 'HIDROSANITARIO', 'Instalaciones hidráulicas y sanitarias',
     'Conozca la ubicación del registro general y de los registros de cada baño y cocina. No arroje papel, toallas, grasas ni residuos de construcción por sanitarios y desagües. Use rejillas en los sifones.',
     'Limpie los sifones y rejillas de duchas y lavamanos cada mes. Revise cada seis meses que no haya goteos en llaves, mezcladores y acoples. Limpie los aireadores de las griferías cada tres meses para retirar el sarro. Revise el sello de silicona de duchas y lavaplatos una vez al año y reemplácelo si se agrieta.',
     'Ante una fuga, cierre de inmediato el registro de la zona o el registro general y llame al contratista del directorio. Si hay humedad en muros o techos, no pinte encima: primero hay que encontrar y reparar el origen.', 2),
    (p_proyecto, 'GAS', 'Red de gas',
     'Use la red solo con gasodomésticos aprobados y con la ventilación permanente libre: no tape rejillas ni ventanas de ventilación. Cierre la válvula del gasodoméstico cuando no lo use por periodos largos.',
     'La red debe tener revisión técnica periódica por un organismo acreditado (según la empresa de gas, normalmente cada cinco años). Revise cada año el estado de las mangueras y cámbielas antes de su fecha de vencimiento.',
     'Si huele a gas: no encienda ni apague luces o aparatos, no use fósforos, abra puertas y ventanas, cierre la válvula del medidor, salga del inmueble y llame a la línea de emergencia de la empresa de gas.', 3),
    (p_proyecto, 'CARPINTERIA', 'Carpintería y muebles',
     'Evite golpes y humedad directa sobre las superficies. No sobrecargue entrepaños ni cuelgue peso de las puertas. Abra y cierre puertas y cajones sin forzar los herrajes.',
     'Limpie con un paño húmedo y jabón neutro; no use productos abrasivos ni con solventes. Ajuste bisagras y correderas cada seis meses. Seque de inmediato cualquier derrame de agua, en especial en muebles de cocina y baño.',
     'Si una puerta se descuadra o un herraje se suelta, no lo fuerce: ajústelo o llame al carpintero del directorio, que puede atenderlo dentro de la garantía.', 4),
    (p_proyecto, 'PISOS', 'Pisos y enchapes',
     'Use protectores de fieltro en las patas de los muebles. Evite arrastrar objetos pesados y el contacto prolongado con agua en pisos de madera o laminados.',
     'Limpie con trapero húmedo y jabón neutro. No use ácidos ni límpidos concentrados sobre porcelanatos, mármoles o boquillas. Revise las boquillas una vez al año y reponga las que estén fisuradas para evitar filtraciones.',
     'Si una pieza se fisura o suena hueca, consulte el acabado exacto en la sección de acabados para comprar una igual y llame al contratista del directorio.', 5),
    (p_proyecto, 'PINTURA', 'Muros, pintura, drywall y cielos',
     'No perfore muros sin verificar antes que no pasen tuberías o cables por ese punto. En drywall use chazos especiales para cargas y no cuelgue peso excesivo.',
     'Limpie manchas con paño húmedo y jabón suave sin frotar fuerte. Haga retoques con la misma referencia y color de pintura indicados en la sección de acabados. Repinte zonas húmedas (baños, cocina) cada dos o tres años.',
     'Si aparecen fisuras, manchas de humedad o hongos, no pinte encima: puede indicar una filtración. Reporte al contratista del directorio.', 6);

    insert into public.manual_rutinas (proyecto_id, sistema, tarea, frecuencia, responsable, orden) values
    (p_proyecto, 'HIDROSANITARIO', 'Limpiar sifones y rejillas de duchas y lavamanos', 'MENSUAL', 'PROPIETARIO', 1),
    (p_proyecto, 'ELECTRICO', 'Probar el botón TEST de los tomacorrientes GFCI', 'MENSUAL', 'PROPIETARIO', 2),
    (p_proyecto, 'HIDROSANITARIO', 'Limpiar aireadores de griferías', 'TRIMESTRAL', 'PROPIETARIO', 3),
    (p_proyecto, 'HIDROSANITARIO', 'Revisar goteos en llaves, mezcladores y acoples', 'SEMESTRAL', 'PROPIETARIO', 4),
    (p_proyecto, 'CARPINTERIA', 'Ajustar bisagras y correderas de muebles', 'SEMESTRAL', 'PROPIETARIO', 5),
    (p_proyecto, 'HIDROSANITARIO', 'Revisar y renovar sellos de silicona en duchas y lavaplatos', 'ANUAL', 'PROPIETARIO', 6),
    (p_proyecto, 'PISOS', 'Revisar y reponer boquillas fisuradas', 'ANUAL', 'PROPIETARIO', 7),
    (p_proyecto, 'ELECTRICO', 'Revisión general del tablero eléctrico', 'ANUAL', 'TECNICO', 8),
    (p_proyecto, 'GAS', 'Revisar mangueras y fecha de vencimiento', 'ANUAL', 'PROPIETARIO', 9),
    (p_proyecto, 'PINTURA', 'Repintar zonas húmedas (baños y cocina)', 'CADA_2_ANOS', 'TECNICO', 10);
  end if;

  update public.manual_mantenimiento set actualizado_en = now(), actualizado_por = auth.uid() where proyecto_id = p_proyecto;
  return jsonb_build_object('contactos_nuevos', v_nuevos_contactos, 'plantilla_base', v_base);
end $$;
revoke all on function public.manual_inicializar(uuid) from public, anon;
grant execute on function public.manual_inicializar(uuid) to authenticated, service_role;
