import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import PlantillaDocumentoContratoPDF from '@/lib/PlantillaDocumentoContratoPDF';
import { precargar, modeloDocumento } from '@/lib/documentoContrato';

// Documento del contrato estándar (059). Exige sesión: los datos se leen CON el token del usuario.
//  GET  → si está GENERADO o FIRMADO, el PDF sale de la FOTO FIJA (nunca cambia); si no, borrador.
//  POST → vista previa con el formulario en pantalla (sin guardar), con marca BORRADOR.
export const dynamic = 'force-dynamic';

function cliente(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function responder(datos, form, borrador) {
  if (!datos?.plantilla?.contenido) return new Response('No hay plantilla de contrato vigente.', { status: 400 });
  const m = modeloDocumento(datos, form || precargar(datos));
  const buffer = await renderToBuffer(PlantillaDocumentoContratoPDF({ m, borrador }));
  const nombre = `Contrato ${m.numero} - ${m.proyecto}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request, { params }) {
  const s = cliente(request);
  if (!s) return new Response('Inicie sesión.', { status: 401 });
  const { data, error } = await s.rpc('documento_contrato_datos', { p_contrato: params.id });
  if (error || !data) return new Response(error?.message || 'Contrato no encontrado', { status: 404 });
  const estado = data.documento?.estado;
  if ((estado === 'GENERADO' || estado === 'FIRMADO') && data.snapshot) return responder(data.snapshot, null, false);
  return responder(data, null, true);
}

export async function POST(request, { params }) {
  const s = cliente(request);
  if (!s) return new Response('Inicie sesión.', { status: 401 });
  const { data, error } = await s.rpc('documento_contrato_datos', { p_contrato: params.id });
  if (error || !data) return new Response(error?.message || 'Contrato no encontrado', { status: 404 });
  let form = null;
  try { form = (await request.json())?.form || null; } catch { form = null; }
  return responder(data, form, true);
}
