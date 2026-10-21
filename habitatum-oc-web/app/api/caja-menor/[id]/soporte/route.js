import { createClient } from '@supabase/supabase-js';

// "Reemplazar" el soporte de un gasto de caja menor (065): solo admin. Sube la foto o el PDF real del proveedor
// (o el recibo firmado) a `soportes-oc` y lo deja como soporte del gasto. El número de recibo se conserva.
export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Inicie sesión.' }, { status: 401 });
  const usuario = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: esAdmin } = await usuario.rpc('es_admin');
  if (!esAdmin) return Response.json({ error: 'Solo un administrador puede reemplazar soportes.' }, { status: 403 });
  const servicio = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: g } = await servicio.from('caja_menor_gastos').select('id, proyecto_id, fecha').eq('id', params.id).maybeSingle();
  if (!g) return Response.json({ error: 'Gasto no encontrado.' }, { status: 404 });

  const form = await request.formData();
  const archivo = form.get('archivo');
  if (!archivo || typeof archivo === 'string') return Response.json({ error: 'Adjunte la foto o el PDF.' }, { status: 400 });
  const tipo = archivo.type || 'application/octet-stream';
  if (!/^image\//.test(tipo) && tipo !== 'application/pdf') return Response.json({ error: 'Solo fotos o PDF.' }, { status: 400 });
  const ext = tipo === 'application/pdf' ? 'pdf' : (tipo.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const ruta = `${g.proyecto_id}/${String(g.fecha).slice(0, 7)}/gasto-${g.id}-${Date.now()}.${ext}`;
  const bytes = Buffer.from(await archivo.arrayBuffer());
  const { error: errUp } = await servicio.storage.from('soportes-oc').upload(ruta, bytes, { contentType: tipo, upsert: true });
  if (errUp) return Response.json({ error: errUp.message }, { status: 500 });
  const { error: errUpd } = await servicio.from('caja_menor_gastos').update({ soporte_path: ruta }).eq('id', g.id);
  if (errUpd) return Response.json({ error: errUpd.message }, { status: 500 });
  return Response.json({ ruta });
}
