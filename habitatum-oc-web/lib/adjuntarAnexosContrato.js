// Pega al final del PDF del contrato (todo costo, 068) los documentos que hacen parte integral
// adjuntos en PDF o imagen (bucket privado contratos-anexos). Se hace en el navegador, como los
// comprobantes de la OC y los anexos del manual, porque el servidor de Vercel no puede responder
// más de 4,5 MB. Un PDF se agrega página por página; una imagen ocupa una hoja carta.
// Un adjunto que no se pueda leer se omite y se avisa en una hoja con su nombre.

const CARTA = [612, 792];

const seguro = (t) => String(t || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

// adjuntos: [{ nombre, path, tipo }] (solo PDF e imágenes; los Excel no se pegan)
export async function adjuntarAnexosContrato({ supabase, pdfBlob, adjuntos }) {
  if (!adjuntos || adjuntos.length === 0) return pdfBlob;
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.load(await pdfBlob.arrayBuffer());
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  for (const a of adjuntos) {
    try {
      const { data, error } = await supabase.storage.from('contratos-anexos').createSignedUrl(a.path, 600);
      if (error || !data?.signedUrl) throw error || new Error('sin enlace');
      const resp = await fetch(data.signedUrl);
      if (!resp.ok) throw new Error('no se pudo descargar');
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const tipo = a.tipo || resp.headers.get('content-type') || '';
      if (/pdf/.test(tipo) || /\.pdf$/i.test(a.path)) {
        const origen = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const paginas = await doc.copyPages(origen, origen.getPageIndices());
        paginas.forEach((p) => doc.addPage(p));
      } else {
        const img = /png/.test(tipo) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const [W, H] = CARTA; const m = 36;
        const k = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height, 1);
        doc.addPage(CARTA).drawImage(img, { x: (W - img.width * k) / 2, y: (H - img.height * k) / 2, width: img.width * k, height: img.height * k });
      }
    } catch (e) {
      const p = doc.addPage(CARTA);
      p.drawText(seguro(`No se pudo adjuntar: ${a.nombre || a.path}`), { x: 60, y: 700, size: 12, font: fuente, color: rgb(0.6, 0.1, 0.1) });
    }
  }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}
