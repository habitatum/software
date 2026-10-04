-- 049 · Manual de mantenimiento según el modelo de contratación (aplicada el 04/10/2026, registro Supabase: manual_por_modelo)
-- Pedido del chat 09 · Apto 423. En TODO_COSTO las garantías y la posventa son del responsable de la obra
-- (HABITATUM o el emisor configurado), por sistema y desde la fecha de entrega; los contratistas no se muestran
-- con teléfono ni correo (opcionalmente solo empresa y actividad). En ADMINISTRACION_DELEGADA no cambia nada.
alter table public.manual_sistemas add column if not exists garantia_meses numeric check (garantia_meses is null or garantia_meses >= 0);
-- null = según el modelo: oculto en todo costo, visible en administración delegada.
alter table public.manual_mantenimiento add column if not exists mostrar_contratistas boolean;
