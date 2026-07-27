-- Los items_oc no tenían ninguna columna de posición: se ordenaban por `id`
-- (uuid aleatorio), así que el PDF, el detalle y el formulario de edición
-- podían mostrar los ítems en un orden distinto al que el usuario los capturó.
-- Esta columna guarda el índice real (0, 1, 2...) en que el usuario los ve/
-- captura en el formulario, para que web, edición y PDF siempre coincidan.
alter table items_oc add column orden int not null default 0;
