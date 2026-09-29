import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaCortePDF from '@/lib/PlantillaCortePDF';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
export const dynamic = 'force-dynamic';

const r2 = (n) => Math.round(n * 100) / 100;

export async function GET(request, { params }) {
  const { id } = params;
  const { data: corte } = await supabase.from('cortes').select('*, ordenes_compra(folio)').eq('id', id).maybeSingle();
  if (!corte) return new Response('Corte no encontrado', { status: 404 });

  const [{ data: contrato }, { data: items }, { data: filasCorte }, { data: anticipo }] = await Promise.all([
    supabase.from('contratos').select('*').eq('id', corte.contrato_id).single(),
    supabase.from('contrato_items').select('*').eq('contrato_id', corte.contrato_id),
    supabase.from('corte_items').select('*').eq('corte_id', id).order('orden'),
    supabase.rpc('anticipo_contrato', { p_contrato: corte.contrato_id }),
  ]);
  const [{ data: proyecto }, { data: contratista }] = await Promise.all([
    supabase.from('proyectos').select('*').eq('id', contrato.proyecto_id).single(),
    supabase.from('proveedores').select('*').eq('id', contrato.contratista_id).single(),
  ]);

  // Cantidades de cortes APROBADOS anteriores a este (por número), para el "anterior" de cada ítem.
  const { data: previos } = await supabase
    .from('corte_items')
    .select('contrato_item_id, cantidad, cortes!inner(numero, estado, contrato_id)')
    .eq('cortes.contrato_id', corte.contrato_id)
    .eq('cortes.estado', 'APROBADO')
    .lt('cortes.numero', corte.numero);
  const previoPorItem = {};
  (previos || []).forEach((p) => { previoPorItem[p.contrato_item_id] = (previoPorItem[p.contrato_item_id] || 0) + Number(p.cantidad); });
  const porId = Object.fromEntries((items || []).map((i) => [i.id, i]));

  const filas = (filasCorte || []).map((f) => {
    const ci = f.contrato_item_id ? porId[f.contrato_item_id] : null;
    const anterior = ci ? Number(ci.cantidad_historica) + (previoPorItem[ci.id] || 0) : 0;
    const acumulado = anterior + Number(f.cantidad);
    const contratado = ci && ci.cantidad != null ? Number(ci.cantidad) : null;
    return {
      descripcion: f.descripcion, unidad: f.unidad, contratado, anterior, cantidad: Number(f.cantidad), acumulado,
      valor_unitario: Number(f.valor_unitario), valor: r2(Number(f.cantidad) * Number(f.valor_unitario)),
      es_adicional: ci ? ci.es_adicional : true,
      excede: contratado != null && acumulado > contratado + 0.0005,
    };
  });

  const subtotal = r2(filas.reduce((a, f) => a + f.valor, 0));
  let amort, ret, neto;
  if (corte.estado === 'APROBADO') {
    amort = Number(corte.valor_amortizacion || 0); ret = Number(corte.valor_retencion || 0); neto = Number(corte.neto || 0);
  } else {
    const saldo = Math.max(Number(anticipo?.saldo || 0), 0);
    amort = corte.tipo_amortizacion === 'PORCENTAJE' ? r2(subtotal * Number(corte.porcentaje_amortizacion) / 100)
      : corte.tipo_amortizacion === 'SALDO' ? saldo
      : corte.tipo_amortizacion === 'VALOR_FIJO' ? Number(corte.valor_amortizacion_fijo) : 0;
    amort = Math.min(Math.max(amort, 0), saldo, subtotal);
    ret = r2(subtotal * Number(corte.porcentaje_retencion) / 100);
    neto = r2(subtotal - amort - ret);
  }

  const d = {
    corte: { ...corte, folio: corte.ordenes_compra?.folio, subtotal_calc: subtotal, amort_calc: amort, ret_calc: ret, neto_calc: neto },
    contrato, proyecto, contratista, filas, anticipo,
  };
  const buffer = await renderToBuffer(PlantillaCortePDF({ d }));
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Corte ${corte.numero} ${contrato.numero_contrato}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
