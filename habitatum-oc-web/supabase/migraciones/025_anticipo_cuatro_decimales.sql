-- Migración 025: permitir hasta 4 decimales en el % de Anticipo
--
-- El campo porcentaje_anticipo (ordenes_compra) se estaba guardando con
-- menos decimales de los necesarios (2), lo que redondeaba el % que
-- representa un anticipo frente al valor del contrato y desajustaba el
-- cálculo del subtotal del anticipo y su amortización.
--
-- Esta migración amplía la columna a numeric(9,4): hasta 5 dígitos
-- enteros y 4 decimales (ej. 33.3333). Los valores existentes no se ven
-- afectados, solo ganan precisión disponible hacia adelante.

alter table ordenes_compra
  alter column porcentaje_anticipo type numeric(9,4)
  using porcentaje_anticipo::numeric(9,4);
