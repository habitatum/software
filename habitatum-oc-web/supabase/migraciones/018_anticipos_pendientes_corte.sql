-- Los Anticipos no se vinculan a un ítem específico del presupuesto (a
-- propósito: cuando se dan, todavía no se sabe en qué ítem real se van a
-- gastar), así que hasta ahora no sumaban en ningún lado del Presupuesto ni
-- de los Cortes de Control Presupuestal.
--
-- Solución: cada Corte ahora también congela, además de lo ejecutado por
-- ítem, el saldo pendiente de amortizar de los Anticipos vigentes a la
-- fecha de cierre (Total del anticipo - lo ya amortizado por OCs normales
-- fechadas hasta ese momento). Ese saldo se suma aparte al total de ítems
-- ejecutados para obtener el "Total Control Presupuestal" real — el mismo
-- número que corresponde al efectivo realmente entregado al contratista,
-- sin duplicar nada cuando el anticipo se va amortizando.

alter table presupuesto_cortes
  add column anticipos_pendientes numeric(14,2) not null default 0;
