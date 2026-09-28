import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaEstadoCuentaPDF from '@/lib/PlantillaEstadoCuentaPDF';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Siempre se genera con los datos del momento (nunca desde caché).
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = params;

  // Toda la lógica (movimientos, totales, saldos y alertas) vive en la función
  // SQL estado_cuenta_contrato, que usa v_ordenes_compra_calculadas por debajo.
  const { data: datos, error } = await supabase.rpc('estado_cuenta_contrato', { p_contrato_id: id });
  if (error) return new Response(`No se pudo generar el estado de cuenta: ${error.message}`, { status: 500 });
  if (!datos) return new Response('Contrato no encontrado', { status: 404 });

  const buffer = await renderToBuffer(PlantillaEstadoCuentaPDF({ datos }));
  const hoy = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Estado de cuenta ${datos.contrato?.numero || ''} ${hoy}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
