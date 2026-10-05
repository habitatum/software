-- 051 · Manual de mantenimiento fase 3: anexos de proveedores y "Restaurar texto base" (aplicada el 04/10/2026, registro Supabase: manual_anexos_y_plantilla)
-- 1. Almacenamiento privado 'manuales' (PDF, JPG, PNG hasta 25 MB). Leen usuarios con sesión; suben y borran admin y operativo.
--    Los anexos se unen al final del PDF en el navegador (el servidor de Vercel no puede responder más de 4,5 MB).
-- 2. La plantilla base de HABITATUM pasa a tablas (única fuente para crear manuales y para restaurar textos).
-- 3. manual_restaurar_sistema: devuelve un sistema de una obra a los textos base (no toca descripción ni garantía).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuales', 'manuales', false, 26214400, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists manuales_lectura on storage.objects;
create policy manuales_lectura on storage.objects for select using (bucket_id = 'manuales' and auth.uid() is not null);
drop policy if exists manuales_subir on storage.objects;
create policy manuales_subir on storage.objects for insert with check (bucket_id = 'manuales' and public.rol_actual() in ('admin','operativo'));
drop policy if exists manuales_borrar on storage.objects;
create policy manuales_borrar on storage.objects for delete using (bucket_id = 'manuales' and public.rol_actual() in ('admin','operativo'));

create table if not exists public.manual_plantilla_sistemas (
  sistema text primary key, titulo text not null, uso text, mantenimiento text, que_hacer text, orden integer not null default 0);
create table if not exists public.manual_plantilla_rutinas (
  id uuid primary key default gen_random_uuid(), sistema text not null, tarea text not null,
  frecuencia text not null check (frecuencia in ('MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL','CADA_2_ANOS','SEGUN_USO')),
  responsable text not null default 'PROPIETARIO' check (responsable in ('PROPIETARIO','TECNICO')), orden integer not null default 0);
do $p$ declare t text; begin
  foreach t in array array['manual_plantilla_sistemas','manual_plantilla_rutinas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format('create policy %I on public.%I for select using (auth.uid() is not null)', t || '_lectura', t);
    execute format('drop policy if exists %I on public.%I', t || '_escritura', t);
    execute format('create policy %I on public.%I for all using (public.es_admin()) with check (public.es_admin())', t || '_escritura', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $p$;

insert into public.manual_plantilla_sistemas (sistema, titulo, uso, mantenimiento, que_hacer, orden) values
    ('ELECTRICO', 'Instalaciones eléctricas',
     'No sobrecargue tomacorrientes con multitomas ni extensiones en cadena. Los equipos de alto consumo (horno, estufa eléctrica, calentador, aire acondicionado) deben ir en su circuito propio. Identifique en el tablero qué circuito alimenta cada zona; el cuadro de circuitos está pegado en la tapa del tablero.',
     'Revise una vez al año que los tacos (interruptores automáticos) no estén calientes ni hagan ruido. Pruebe mensualmente el botón TEST de los tomacorrientes GFCI de baños y cocina. Cambie las bombillas por otras de la misma potencia y tipo. Cualquier modificación debe hacerla un electricista certificado (RETIE).',
     'Si un taco se dispara, desconecte los equipos de ese circuito, súbalo y conecte uno a uno para identificar el que falla. Si se dispara sin nada conectado o huele a quemado, no lo vuelva a subir y llame al electricista del directorio.', 1),
    ('HIDROSANITARIO', 'Instalaciones hidráulicas y sanitarias',
     'Conozca la ubicación del registro general y de los registros de cada baño y cocina. No arroje papel, toallas, grasas ni residuos de construcción por sanitarios y desagües. Use rejillas en los sifones.',
     'Limpie los sifones y rejillas de duchas y lavamanos cada mes. Revise cada seis meses que no haya goteos en llaves, mezcladores y acoples. Limpie los aireadores de las griferías cada tres meses para retirar el sarro. Revise el sello de silicona de duchas y lavaplatos una vez al año y reemplácelo si se agrieta.',
     'Ante una fuga, cierre de inmediato el registro de la zona o el registro general y llame al contratista del directorio. Si hay humedad en muros o techos, no pinte encima: primero hay que encontrar y reparar el origen.', 2),
    ('GAS', 'Red de gas',
     'Use la red solo con gasodomésticos aprobados y con la ventilación permanente libre: no tape rejillas ni ventanas de ventilación. Cierre la válvula del gasodoméstico cuando no lo use por periodos largos.',
     'La red debe tener revisión técnica periódica por un organismo acreditado (según la empresa de gas, normalmente cada cinco años). Revise cada año el estado de las mangueras y cámbielas antes de su fecha de vencimiento.',
     'Si huele a gas: no encienda ni apague luces o aparatos, no use fósforos, abra puertas y ventanas, cierre la válvula del medidor, salga del inmueble y llame a la línea de emergencia de la empresa de gas.', 3),
    ('CARPINTERIA', 'Carpintería y muebles',
     'Evite golpes y humedad directa sobre las superficies. No sobrecargue entrepaños ni cuelgue peso de las puertas. Abra y cierre puertas y cajones sin forzar los herrajes.',
     'Limpie con un paño húmedo y jabón neutro; no use productos abrasivos ni con solventes. Ajuste bisagras y correderas cada seis meses. Seque de inmediato cualquier derrame de agua, en especial en muebles de cocina y baño.',
     'Si una puerta se descuadra o un herraje se suelta, no lo fuerce: ajústelo o llame al carpintero del directorio, que puede atenderlo dentro de la garantía.', 4),
    ('PISOS', 'Pisos y enchapes',
     'Use protectores de fieltro en las patas de los muebles. Evite arrastrar objetos pesados y el contacto prolongado con agua en pisos de madera o laminados.',
     'Limpie con trapero húmedo y jabón neutro. No use ácidos ni límpidos concentrados sobre porcelanatos, mármoles o boquillas. Revise las boquillas una vez al año y reponga las que estén fisuradas para evitar filtraciones.',
     'Si una pieza se fisura o suena hueca, consulte el acabado exacto en la sección de acabados para comprar una igual y llame al contratista del directorio.', 5),
    ('PINTURA', 'Muros, pintura, drywall y cielos',
     'No perfore muros sin verificar antes que no pasen tuberías o cables por ese punto. En drywall use chazos especiales para cargas y no cuelgue peso excesivo.',
     'Limpie manchas con paño húmedo y jabón suave sin frotar fuerte. Haga retoques con la misma referencia y color de pintura indicados en la sección de acabados. Repinte zonas húmedas (baños, cocina) cada dos o tres años.',
     'Si aparecen fisuras, manchas de humedad o hongos, no pinte encima: puede indicar una filtración. Reporte al contratista del directorio.', 6)
on conflict (sistema) do nothing;
insert into public.manual_plantilla_rutinas (sistema, tarea, frecuencia, responsable, orden)
select * from (values
    ('HIDROSANITARIO', 'Limpiar sifones y rejillas de duchas y lavamanos', 'MENSUAL', 'PROPIETARIO', 1),
    ('ELECTRICO', 'Probar el botón TEST de los tomacorrientes GFCI', 'MENSUAL', 'PROPIETARIO', 2),
    ('HIDROSANITARIO', 'Limpiar aireadores de griferías', 'TRIMESTRAL', 'PROPIETARIO', 3),
    ('HIDROSANITARIO', 'Revisar goteos en llaves, mezcladores y acoples', 'SEMESTRAL', 'PROPIETARIO', 4),
    ('CARPINTERIA', 'Ajustar bisagras y correderas de muebles', 'SEMESTRAL', 'PROPIETARIO', 5),
    ('HIDROSANITARIO', 'Revisar y renovar sellos de silicona en duchas y lavaplatos', 'ANUAL', 'PROPIETARIO', 6),
    ('PISOS', 'Revisar y reponer boquillas fisuradas', 'ANUAL', 'PROPIETARIO', 7),
    ('ELECTRICO', 'Revisión general del tablero eléctrico', 'ANUAL', 'TECNICO', 8),
    ('GAS', 'Revisar mangueras y fecha de vencimiento', 'ANUAL', 'PROPIETARIO', 9),
    ('PINTURA', 'Repintar zonas húmedas (baños y cocina)', 'CADA_2_ANOS', 'TECNICO', 10)) v(sistema, tarea, frecuencia, responsable, orden)
where not exists (select 1 from public.manual_plantilla_rutinas);

-- manual_inicializar: igual que en la 048, pero la plantilla sale de las tablas.
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

  if not exists (select 1 from public.manual_sistemas where proyecto_id = p_proyecto) then
    v_base := true;
    insert into public.manual_sistemas (proyecto_id, sistema, titulo, uso, mantenimiento, que_hacer, orden)
    select p_proyecto, sistema, titulo, uso, mantenimiento, que_hacer, orden from public.manual_plantilla_sistemas;
    insert into public.manual_rutinas (proyecto_id, sistema, tarea, frecuencia, responsable, orden)
    select p_proyecto, sistema, tarea, frecuencia, responsable, orden from public.manual_plantilla_rutinas;
  end if;

  update public.manual_mantenimiento set actualizado_en = now(), actualizado_por = auth.uid() where proyecto_id = p_proyecto;
  return jsonb_build_object('contactos_nuevos', v_nuevos_contactos, 'plantilla_base', v_base);
end $$;
revoke all on function public.manual_inicializar(uuid) from public, anon;
grant execute on function public.manual_inicializar(uuid) to authenticated, service_role;

-- Devuelve un sistema de UNA obra a los textos de la plantilla (título, uso, mantenimiento y qué hacer).
-- No toca "qué se instaló" ni la garantía, ni las demás obras.
create or replace function public.manual_restaurar_sistema(p_sistema_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; b record;
begin
  if public.rol_actual() not in ('admin','operativo') then raise exception 'Sin permiso para editar el manual.'; end if;
  select * into s from public.manual_sistemas where id = p_sistema_id;
  if s.id is null then raise exception 'El sistema no existe.'; end if;
  select * into b from public.manual_plantilla_sistemas where sistema = s.sistema;
  if b.sistema is null then raise exception 'Este sistema no tiene texto base en la plantilla.'; end if;
  update public.manual_sistemas set titulo = b.titulo, uso = b.uso, mantenimiento = b.mantenimiento, que_hacer = b.que_hacer
  where id = p_sistema_id;
  return jsonb_build_object('sistema', s.sistema, 'restaurado', true);
end $$;
revoke all on function public.manual_restaurar_sistema(uuid) from public, anon;
grant execute on function public.manual_restaurar_sistema(uuid) to authenticated, service_role;
