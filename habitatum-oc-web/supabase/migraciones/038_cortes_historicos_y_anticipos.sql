-- 038 · Cortes históricos y anticipos (aplicada el 28/09/2026)
-- * cortes.historico / cortes.descuento: los cortes anteriores al módulo se importaron uno a uno
--   (desde los Excel de cortes y las OC existentes) para tener trazabilidad completa en la
--   "sábana de cortes". No generan OC: quedan ligados a la OC con la que se pagaron.
-- * crear_anticipo_contrato(contrato, valor, fecha, notas): (solo admin) registra el anticipo
--   como OC tipo ANTICIPO por el valor exacto; los cortes siguientes lo amortizan.
-- * anticipo_contrato(): amortiza primero el anticipo más antiguo con saldo (FIFO).
alter table public.cortes add column if not exists historico boolean not null default false;
alter table public.cortes add column if not exists descuento numeric(16,2) not null default 0;
-- (funciones crear_anticipo_contrato y anticipo_contrato: ver definición aplicada en Supabase)
