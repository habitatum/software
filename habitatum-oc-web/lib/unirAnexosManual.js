// Une los anexos (manuales, fichas y certificados de proveedores) al final del
// PDF del manual de mantenimiento (051). Se hace en el navegador porque el
// servidor de Vercel no puede responder más de 4,5 MB y los manuales de
// fabricante suelen pesar más. Cada anexo lleva una página separadora con la
// estética de la app. Las imágenes (JPG/PNG) se ajustan a una hoja A4.

const A4 = [595.28, 841.89];

// Las fuentes estándar del PDF solo admiten Latin-1: se quitan los caracteres que no.
function seguro(texto) {
  return String(texto || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

function partirEnLineas(texto, fuente, tamano, ancho) {
  const palabras = seguro(texto).split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  palabras.forEach((p) => {
    const prueba = actual ? `${actual} ${p}` : p;
    if (fuente.widthOfTextAtSize(prueba, tamano) > ancho && actual) { lineas.push(actual); actual = p; } else actual = prueba;
  });
  if (actual) lineas.push(actual);
  return lineas;
}

export async function unirAnexosManual({ supabase, pdfBase, anexos, obra }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const carbon = rgb(0.18, 0.18, 0.18);
  const dorado = rgb(0.72, 0.54, 0.32);
  const gris = rgb(0.42, 0.4, 0.36);
  const doc = await PDFDocument.load(pdfBase);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const fallidos = [];

  for (let i = 0; i < anexos.length; i += 1) {
    const a = anexos[i];
    // Página separadora
    const sep = doc.addPage(A4);
    sep.drawRectangle({ x: 0, y: A4[1] - 92, width: A4[0], height: 92, color: carbon });
    sep.drawText(seguro(obra), { x: 40, y: A4[1] - 50, size: 13, font: normal, color: rgb(1, 1, 1) });
    sep.drawText('Manual de uso y mantenimiento', { x: 40, y: A4[1] - 70, size: 10, font: normal, color: dorado });
    sep.drawRectangle({ x: 40, y: 380, width: 3, height: 140, color: dorado });
    sep.drawText(`ANEXO ${i + 1}`, { x: 56, y: 500, size: 10, font: negrita, color: dorado });
    partirEnLineas(a.titulo, negrita, 22, A4[0] - 120).slice(0, 4).forEach((l, k) => {
      sep.drawText(l, { x: 56, y: 470 - k * 27, size: 22, font: negrita, color: carbon });
    });
    if (a.proveedor) sep.drawText(seguro(a.proveedor), { x: 56, y: 392, size: 12, font: normal, color: gris });

    try {
      if (!a.storage_path) throw new Error('sin archivo');
      const { data: firmada, error } = await supabase.storage.from('manuales').createSignedUrl(a.storage_path, 600);
      if (error) throw error;
      const bytes = await (await fetch(firmada.signedUrl)).arrayBuffer();
      const ruta = a.storage_path.toLowerCase();
      if (ruta.endsWith('.pdf')) {
        const origen = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const paginas = await doc.copyPages(origen, origen.getPageIndices());
        paginas.forEach((p) => doc.addPage(p));
      } else {
        const img = ruta.endsWith('.png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const pag = doc.addPage(A4);
        const margen = 36;
        const escala = Math.min((A4[0] - margen * 2) / img.width, (A4[1] - margen * 2) / img.height, 1);
        const w = img.width * escala; const h = img.height * escala;
        pag.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
      }
    } catch (e) {
      fallidos.push(a.titulo);
      sep.drawText('No se pudo incluir este archivo; solicítelo al responsable de la obra.', { x: 56, y: 360, size: 10, font: normal, color: rgb(0.7, 0.1, 0.1) });
    }
  }
  const salida = await doc.save();
  return { bytes: salida, fallidos };
}
