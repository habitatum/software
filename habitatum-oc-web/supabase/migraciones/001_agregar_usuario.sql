-- Migración: permitir crear usuarios sin depender de un correo real.
-- Ejecutar UNA VEZ en Supabase → SQL Editor → pegar todo → Run.

alter table usuarios add column if not exists usuario text unique;
