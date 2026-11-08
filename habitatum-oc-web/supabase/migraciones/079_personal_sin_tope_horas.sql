-- 079 · Soporte de personal: sin tope de 24 horas por registro (08/11/2026). Solo se exige horas > 0.
alter table public.corte_personal drop constraint if exists corte_personal_horas_check;
alter table public.corte_personal alter column horas type numeric(10,2);
alter table public.corte_personal add constraint corte_personal_horas_check check (horas > 0);
