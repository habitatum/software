-- Migración 027: % de Administración por proyecto
--
-- Cada proyecto de HABITATUM cobra un % de administración (gestión de obra)
-- sobre el avance real del proyecto (ejecutado por ítems + anticipos
-- pendientes de amortizar). Antes este % solo existía "de facto" como un
-- ítem más dentro del presupuesto cargado (ej. "17.1 Administración de
-- Obra", %CD), calculado una sola vez sobre el presupuesto CONTRATADO
-- completo — no servía para recalcular la administración corte a corte
-- a medida que avanza la obra y se entregan anticipos.
--
-- Esta columna guarda ese % directamente en el proyecto (editable en
-- Proyectos > Editar), independiente del presupuesto cargado, para poder
-- calcular en cada corte: Administración = % × (Ejecutado + Anticipos
-- pendientes de amortizar).

alter table proyectos
  add column if not exists porcentaje_administracion numeric(5,2);
