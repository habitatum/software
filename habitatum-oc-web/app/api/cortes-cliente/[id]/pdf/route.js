import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaCorteClientePDF from '@/lib/PlantillaCorteClientePDF';
import { recalcular, tituloCorte } from '@/lib/cortesCliente';

// Acta de corte / liquidación al cliente (057). Exige sesión de ADMIN: los datos se piden a la
// base de datos CON el token del usuario, así corte_cliente_detalle aplica su chequeo es_admin().
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return new Response('Inicie sesión para descargar el corte.', { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('corte_cliente_detalle', { p_corte: params.id });
  if (error || !data) return new Response(error?.message || 'Corte no encontrado', { status: error ? 403 : 404 });

  const calc = recalcular(data);
  const buffer = await renderToBuffer(PlantillaCorteClientePDF({ calc }));
  const nombre = `${tituloCorte(calc.corte)} - ${calc.proyecto?.nombre || ''}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'no-store',
    },
  });
}
