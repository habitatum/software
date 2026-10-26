-- 071a · Nuevo tipo de impuesto de OC: CON_IVA_UTILIDAD (IVA sobre la utilidad: IVA = (subtotal − descuento) × %U × %IVA;
-- la utilidad va incluida en los precios y no se suma). Va en su propia migración porque un valor nuevo de enum no
-- se puede usar en la misma transacción en que se crea.
alter type public.tipo_impuesto_enum add value if not exists 'CON_IVA_UTILIDAD';
