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
    .select(`
      *,
      proveedores(nombre, nit, representante_legal, telefono),
      proyectos(nombre, cliente, mostrar_marca_habitatum, nombre_emisor, nit_empresa, representante_legal, telefono_empresa, direccion_obra, ciudad)
    `)
    .eq('id', id)
    .single();

  if (!contrato) return new Response('Contrato no encontrado', { status: 404 });

  const buffer = await renderToBuffer(
    PlantillaContratoPDF({
      contrato,
      proyecto: contrato.proyectos,
      proveedor: contrato.proveedores,
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
