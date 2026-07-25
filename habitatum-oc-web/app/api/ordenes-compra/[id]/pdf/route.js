import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaOrdenCompraPDF from '@/lib/PlantillaPDF';
import { calcularOrdenCompra } from '@/lib/calculosOC';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request, { params }) {
  const { id } = params;

  const { data: oc } = await supabase
    .from('ordenes_compra')
    .select('*, proveedores(*), proyectos(nombre, mostrar_marca_habitatum, nombre_emisor)')
    .eq('id', id)
    .single();
  const { data: items } = await supabase.from('items_oc').select('*').eq('orden_compra_id', id);
  const { data: pagosData } = await supabase.from('pagos').select('valor').eq('orden_compra_id', id);

  if (!oc) return new Response('Orden de Compra no encontrada', { status: 404 });

  const pagado = (pagosData || []).reduce((acc, p) => acc + Number(p.valor), 0);
  const calculo = calcularOrdenCompra(oc, items || [], pagado);

  const buffer = await renderToBuffer(
    PlantillaOrdenCompraPDF({
      oc,
      items: items || [],
      calculo,
      nombreObra: oc.proyectos?.nombre,
      mostrarMarcaHabitatum: oc.proyectos?.mostrar_marca_habitatum,
      nombreEmisor: oc.proyectos?.nombre_emisor,
    })
  );

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${oc.folio}.pdf"`,
    },
  });
}
