import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaActaPDF from '@/lib/PlantillaActaPDF';

// 081 · PDF del Acta de inicio / Acta de entrega con lo que hay en el formulario (solo admin).
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return new Response('Inicie sesión.', { status: 401 });
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: esAdmin } = await s.rpc('es_admin');
  if (!esAdmin) return new Response('Solo administradores.', { status: 403 });
  const { tipo, proyectoId, datos, borrador } = await request.json().catch(() => ({}));
  if (!['INICIO', 'ENTREGA'].includes(tipo) || !proyectoId) return new Response('Datos incompletos.', { status: 400 });
  const { data: proyecto } = await s.from('proyectos').select('nombre, codigo, modelo_contratacion, mostrar_marca_habitatum, nombre_emisor').eq('id', proyectoId).single();
  if (!proyecto) return new Response('Proyecto no encontrado.', { status: 404 });
  const buffer = await renderToBuffer(PlantillaActaPDF({ m: { tipo, proyecto, d: datos || {}, borrador: !!borrador } }));
  const nombre = `${tipo === 'INICIO' ? 'Acta de inicio' : 'Acta de entrega'} - ${proyecto.nombre}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  return new Response(buffer, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`, 'Cache-Control': 'no-store' },
  });
}
