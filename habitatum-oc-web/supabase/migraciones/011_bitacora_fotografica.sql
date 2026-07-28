-- Migración: Bitácora de obra + Registro Fotográfico alimentados por Telegram.
--
-- Cada proyecto puede vincularse a un grupo de Telegram (telegram_chat_id).
-- Un bot de Telegram (webhook en /api/telegram/webhook) recibe las fotos que
-- el equipo envía a ese grupo, las sube a Storage, las describe con IA
-- (Gemini) y guarda cada foto en bitacora_fotos. Cada vez que llega una foto
-- nueva se actualiza el resumen narrativo del día en bitacora_dias, que es lo
-- que se muestra en la pestaña "Bitácora". La pestaña "Registro Fotográfico"
-- muestra el mismo material (bitacora_fotos) como archivo cronológico simple.
--
-- Si un mensaje llega de un chat_id que todavía no está vinculado a ningún
-- proyecto, se registra en telegram_grupos_pendientes para que el Admin lo
-- vincule desde /proyectos.

-- ============================================================
-- 1) Vincular un grupo de Telegram a cada proyecto
-- ============================================================
alter table proyectos add column if not exists telegram_chat_id text unique;

-- ============================================================
-- 2) Fotos individuales recibidas por Telegram
-- ============================================================
create table if not exists bitacora_fotos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references proyectos(id) on delete cascade,
  fecha date not null,
  hora time not null default current_time,
  foto_url text not null,
  descripcion_ia text,
  remitente text,
  telegram_message_id bigint,
  creado_en timestamptz not null default now()
);
create index if not exists idx_bitacora_fotos_proyecto_fecha on bitacora_fotos (proyecto_id, fecha);

-- ============================================================
-- 3) Resumen narrativo del día (lo que alimenta la pestaña Bitácora)
-- Se recalcula cada vez que llega una foto nueva de ese día.
-- ============================================================
create table if not exists bitacora_dias (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references proyectos(id) on delete cascade,
  fecha date not null,
  resumen_texto text,
  cantidad_fotos int not null default 0,
  actualizado_en timestamptz not null default now(),
  unique (proyecto_id, fecha)
);

-- ============================================================
-- 4) Grupos de Telegram detectados que aún no están vinculados a un proyecto
-- ============================================================
create table if not exists telegram_grupos_pendientes (
  chat_id text primary key,
  titulo text,
  primer_mensaje_en timestamptz not null default now()
);

-- ============================================================
-- 5) RLS: cualquier usuario autenticado puede VER la bitácora y el registro
-- fotográfico (igual que el resto del software). Solo el webhook (con la
-- service role key, que no pasa por RLS) escribe en estas tablas. Los grupos
-- pendientes por vincular solo los ve/gestiona el Admin.
-- ============================================================
alter table bitacora_fotos enable row level security;
alter table bitacora_dias enable row level security;
alter table telegram_grupos_pendientes enable row level security;

create policy "lectura_general_bitacora_fotos" on bitacora_fotos for select using (auth.uid() is not null);
create policy "lectura_general_bitacora_dias" on bitacora_dias for select using (auth.uid() is not null);
create policy "admin_telegram_grupos_pendientes" on telegram_grupos_pendientes for all
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- ============================================================
-- 6) Bucket de Storage para las fotos (público: son fotos de avance de obra,
-- sin datos sensibles, y así el webhook no necesita generar URLs firmadas).
-- ============================================================
insert into storage.buckets (id, name, public)
values ('bitacora-fotos', 'bitacora-fotos', true)
on conflict (id) do nothing;

-- Cualquier usuario autenticado puede leer las fotos del bucket (consistente
-- con el resto del software). Solo el webhook (service role) escribe.
create policy "lectura_bitacora_fotos_storage" on storage.objects for select
  using (bucket_id = 'bitacora-fotos' and auth.uid() is not null);
