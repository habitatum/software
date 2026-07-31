-- Corrección de una sola vez: alinea los folios de Órdenes de Compra y los
-- códigos de Contratos ya existentes con el código ACTUAL de cada proyecto.
--
-- Por qué pasa esto: el folio de una OC ("OC-{código}-{consecutivo}") y el
-- codigo_proyecto de un Contrato se fijan una sola vez, en el momento de
-- crearlos (ver set_folio_por_proyecto() en schema.sql). Si después alguien
-- corrige el código de un Proyecto (ej. de "01" a "02"), los documentos que
-- ya existían con el código viejo NO se actualizan solos — quedan
-- desincronizados con el código actual del proyecto.
--
-- Este script corrige eso para TODOS los proyectos de una sola vez. Es
-- seguro correrlo más de una vez: solo toca las filas que en verdad no
-- coinciden con el código actual; si ya está todo correcto, no cambia nada.

-- 1) Órdenes de Compra: reconstruye el folio conservando el mismo consecutivo.
update ordenes_compra oc
set folio = 'OC-' || p.codigo || '-' || (regexp_match(oc.folio, '-(\d+)$'))[1]
from proyectos p
where p.id = oc.proyecto_id
  and oc.folio ~ '-(\d+)$'
  and oc.folio <> 'OC-' || p.codigo || '-' || (regexp_match(oc.folio, '-(\d+)$'))[1];

-- 2) Contratos: corrige codigo_proyecto. numero_contrato se recalcula solo,
-- porque es una columna generada a partir de codigo_proyecto + año + consecutivo.
update contratos c
set codigo_proyecto = p.codigo
from proyectos p
where p.id = c.proyecto_id
  and c.codigo_proyecto <> p.codigo;
