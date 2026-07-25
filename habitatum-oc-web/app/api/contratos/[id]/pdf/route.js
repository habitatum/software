import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaContratoPDF from '@/lib/PlantillaContratoPDF';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request, { params }) {
  const { id } = params;

  const { data: contrato } = await supabase
    .from('contratos')
    .select('*, proveedores(nombre, nit), proyectos(nombre, mostrar_marca_habitatum, nombre_emisor)')
    .eq('id', id)
    .single();

  if (!contrato) return new Response('Contrato no encontrado', { status: 404 });

  const { data: acumulados } = await supabase.from('v_acumulados_contrato').select('*').eq('contrato_id', id).single();
  const { data: ordenes } = await supabase
    .from('v_ordenes_compra_calculadas')
    .select('*')
    .eq('contrato_id', id)
    .order('fecha');

  const buffer = await renderToBuffer(
    PlantillaContratoPDF({
      contrato,
      acumulados,
      ordenes: ordenes || [],
      nombreObra: contrato.proyectos?.nombre,
      mostrarMarcaHabitatum: contrato.proyectos?.mostrar_marca_habitatum,
      nombreEmisor: contrato.proyectos?.nombre_emisor,
    })
  );

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${contrato.numero_contrato}.pdf"`,
    },
  });
}
