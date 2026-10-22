import { createClient } from '@supabase/supabase-js';
import { renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import PlantillaDocumentoContratoPDF from '@/lib/PlantillaDocumentoContratoPDF';
import { precargar, modeloDocumento } from '@/lib/documentoContrato';

// Documento del contrato estándar (059). Exige sesión: los datos se leen CON el token del usuario.
//  GET  → si está GENERADO o FIRMADO, el PDF sale de la FOTO FIJA (nunca cambia); si no, borrador.
//  POST → vista previa con el formulario en pantalla (sin guardar), con marca BORRADOR.
// Todo costo (068): los documentos que hacen parte integral adjuntos en PDF o imagen se pegan al final,
// descargados con el token del usuario (depósito privado contratos-anexos). Los Excel no se pegan.
export const dynamic = 'force-dynamic';

function cliente(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Pega al final del contrato los adjuntos PDF/imagen. Si uno falla, se omite y se informa en un encabezado.
async function pegarAdjuntos(s, buffer, adjuntos) {
  if (!adjuntos?.length) return { buffer, omitidos: [] };
  const final = await PDFDocument.load(buffer);
  const omitidos = [];
  for (const a of adjuntos) {
    try {
      const { data, error } = await s.storage.from('contratos-anexos').download(a.path);
      if (error || !data) throw error || new Error('sin archivo');
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (/^image\//.test(a.tipo || '')) {
        const img = a.tipo === 'image/png' ? await final.embedPng(bytes) : await final.embedJpg(bytes);
        const W = 612, H = 792, margen = 36; // carta
        const k = Math.min((W - 2 * margen) / img.width, (H - 2 * margen) / img.height, 1);
        const pag = final.addPage([W, H]);
        pag.drawImage(img, { x: (W - img.width * k) / 2, y: (H - img.height * k) / 2, width: img.width * k, height: img.height * k });
      } else {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const paginas = await final.copyPages(doc, doc.getPageIndices());
        paginas.forEach((p) => final.addPage(p));
      }
    } catch {
      omitidos.push(a.nombre || a.archivo || a.path);
    }
  }
  return { buffer: Buffer.from(await final.save()), omitidos };
}

async function responder(s, datos, form, borrador) {
  if (!datos?.plantilla?.contenido) return new Response('No hay plantilla de contrato vigente.', { status: 400 });
  const m = modeloDocumento(datos, form || precargar(datos));
  const { buffer, omitidos } = await pegarAdjuntos(s, await renderToBuffer(PlantillaDocumentoContratoPDF({ m, borrador })), m.adjuntos);
  const nombre = `Contrato ${m.numero} - ${m.proyecto}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'no-store',
      ...(omitidos.length ? { 'X-Adjuntos-Omitidos': encodeURIComponent(omitidos.join(' | ')) } : {}),
    },
  });
}

export async function GET(request, { params }) {
  const s = cliente(request);
  if (!s) return new Response('Inicie sesión.', { status: 401 });
  const { data, error } = await s.rpc('documento_contrato_datos', { p_contrato: params.id });
  if (error || !data) return new Response(error?.message || 'Contrato no encontrado', { status: 404 });
  const estado = data.documento?.estado;
  if ((estado === 'GENERADO' || estado === 'FIRMADO') && data.snapshot) return responder(s, data.snapshot, null, false);
  return responder(s, data, null, true);
}

export async function POST(request, { params }) {
  const s = cliente(request);
  if (!s) return new Response('Inicie sesión.', { status: 401 });
  const { data, error } = await s.rpc('documento_contrato_datos', { p_contrato: params.id });
  if (error || !data) return new Response(error?.message || 'Contrato no encontrado', { status: 404 });
  let form = null;
  try { form = (await request.json())?.form || null; } catch { form = null; }
  return responder(s, data, form, true);
}
