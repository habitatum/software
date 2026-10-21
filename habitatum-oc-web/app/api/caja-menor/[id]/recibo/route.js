import { createClient } from '@supabase/supabase-js';
import { generarReciboCajaMenor } from '@/lib/reciboCajaMenor';

// "Generar recibo" desde la App (065): solo admin. Asigna número (si no lo tenía) y beneficiario con el token
// del usuario (la función exige es_admin) y genera el PDF que queda como soporte del gasto.
export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Inicie sesión.' }, { status: 401 });
  const usuario = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const servicio = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const { error } = await usuario.rpc('asignar_recibo_caja_menor', {
    p_gasto: params.id, p_nombre: body.nombre || null, p_documento: body.documento || null, p_cuenta: body.cuenta || null,
  });
  if (error) return Response.json({ error: error.message }, { status: 403 });
  try {
    const r = await generarReciboCajaMenor({ lectura: usuario, servicio, gastoId: params.id });
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
