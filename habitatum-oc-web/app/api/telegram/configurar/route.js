import { createClient } from '@supabase/supabase-js';
import { telegramFetch } from '@/lib/telegramComun';

// Activa en el webhook del bot la recepción de botones (callback_query), que
// el bot de finanzas necesita para ✅ Confirmar / 📂 Capítulo / ❌ Descartar.
// Conserva la misma URL y el mismo secreto del webhook ya configurado.
// Solo un administrador con sesión puede llamarlo.
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function POST(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: { user } = {} } = await supabase.auth.getUser(token);
  if (!user) return Response.json({ ok: false, error: 'Sin sesión' }, { status: 401 });
  const { data: u } = await supabase.from('usuarios').select('rol').eq('id', user.id).maybeSingle();
  if (u?.rol !== 'admin') return Response.json({ ok: false, error: 'Solo administradores' }, { status: 403 });

  const info = await telegramFetch('getWebhookInfo', {});
  let url = info?.result?.url;
  if (!url) url = `${new URL(request.url).origin}/api/telegram/webhook`;
  const params = { url, allowed_updates: ['message', 'callback_query'] };
  if (process.env.TELEGRAM_WEBHOOK_SECRET) params.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
  const res = await telegramFetch('setWebhook', params);
  const comandos = await telegramFetch('setMyCommands', {
    commands: [
      { command: 'estado', description: 'Caja menor acumulada del proyecto' },
      { command: 'cerrarcaja', description: 'Legalizar la caja menor ahora' },
      { command: 'ayuda', description: 'Cómo registrar facturas y gastos' },
    ],
  });
  return Response.json({ ok: !!res?.ok, webhook: url, descripcion: res?.description, comandos: !!comandos?.ok });
}
