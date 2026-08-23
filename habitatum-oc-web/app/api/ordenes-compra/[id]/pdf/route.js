import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaOrdenCompraPDF from '@/lib/PlantillaPDF';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request, { params }) {
  const { id } = params;

  // v_ordenes_compra_calculadas ya trae subtotal, total, valor_iva, valor_aiu,
  // valor_amortizacion, valor_retenido, neto_a_pagar, pagado, saldo y
  // saldo_anticipo_por_amortizar calculados en SQL: una sola fuente de verdad
  // compartida con el listado y el detalle.
  const { data: oc } = await supabase
    .from('v_ordenes_compra_calculadas')
    .select('*, proveedores(*), contratos(numero_contrato), proyectos(nombre, mostrar_marca_habitatum, nombre_emisor)')
    .eq('id', id)
    .single();

  if (!oc) return new Response('Orden de Compra no encontrada', { status: 404 });

  const { data: items } = await supabase.from('items_oc').select('*').eq('orden_compra_id', id).order('orden').order('id');

  let acumulados = null;
  let anticipoPendienteContrato = 0;
  if (oc.contrato_id) {
    const { data: acum } = await supabase.from('v_acumulados_contrato').select('*').eq('contrato_id', oc.contrato_id).single();
    acumulados = acum;
    // Suma el saldo pendiente por amortizar de todos los Anticipos (vigentes)
    // que pertenecen a este mismo contrato, igual que en la vista de detalle.
    const { data: anticiposContrato } = await supabase
      .from('v_ordenes_compra_calculadas')
      .select('saldo_anticipo_por_amortizar')
      .eq('contrato_id', oc.contrato_id)
      .eq('tipo_pago', 'ANTICIPO')
      .neq('estado', 'ANULADA');
    anticipoPendienteContrato = (anticiposContrato || []).reduce(
      (acc, a) => acc + Number(a.saldo_anticipo_por_amortizar || 0), 0
    );
  }

  const buffer = await renderToBuffer(
    PlantillaOrdenCompraPDF({
      oc,
      items: items || [],
      acumulados,
      anticipoPendienteContrato,
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
