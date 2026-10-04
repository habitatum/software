import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaManualPDF from '@/lib/PlantillaManualPDF';

// Manual de uso y mantenimiento (048). A diferencia de otros PDF, exige sesión:
// la página lo pide enviando el token del usuario en el encabezado Authorization.
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return new Response('Inicie sesión para descargar el manual.', { status: 401 });
  const { data: sesion, error: errSesion } = await supabase.auth.getUser(token);
  if (errSesion || !sesion?.user) return new Response('Sesión no válida.', { status: 401 });

  const { proyectoId } = params;
  const orden = { ascending: true };
  const [proy, man, con, aca, sis, rut, anx] = await Promise.all([
    supabase.from('proyectos').select('nombre, codigo, mostrar_marca_habitatum, nombre_emisor, modelo_contratacion').eq('id', proyectoId).maybeSingle(),
    supabase.from('manual_mantenimiento').select('*').eq('proyecto_id', proyectoId).maybeSingle(),
    supabase.from('manual_contactos').select('*').eq('proyecto_id', proyectoId).order('orden', orden),
    supabase.from('manual_acabados').select('*').eq('proyecto_id', proyectoId).order('espacio', orden).order('orden', orden),
    supabase.from('manual_sistemas').select('*').eq('proyecto_id', proyectoId).order('orden', orden),
    supabase.from('manual_rutinas').select('*').eq('proyecto_id', proyectoId).order('orden', orden),
    supabase.from('manual_anexos').select('id, titulo, proveedor, orden').eq('proyecto_id', proyectoId).order('orden', orden),
  ]);
  if (!proy.data) return new Response('Obra no encontrada', { status: 404 });
  if (!man.data) return new Response('Esta obra aún no tiene manual. Use "Preparar manual" en la app.', { status: 404 });

  const datos = {
    proyecto: proy.data, manual: man.data, contactos: con.data || [], acabados: aca.data || [],
    sistemas: sis.data || [], rutinas: rut.data || [], anexos: anx.data || [],
  };
  const buffer = await renderToBuffer(PlantillaManualPDF({ datos }));
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Manual de uso y mantenimiento ${proy.data.nombre}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
