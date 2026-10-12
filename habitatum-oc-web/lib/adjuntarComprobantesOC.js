// Agrega al final del PDF de una OC los comprobantes guardados en `soportes-oc`
// (factura que llegó por el bot y fotos de los gastos de caja menor legalizados),
// DOS POR HOJA, cada uno con su leyenda (fecha · concepto · valor).
// Se hace en el navegador, como los anexos del manual, porque el servidor de
// Vercel no puede responder más de 4,5 MB. Un comprobante en PDF se agrega
// página por página, cada una ocupando media hoja.

const A4 = [595.28, 841.89];

function seguro(texto) {
  return String(texto || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

function fechaCorta(f) {
  if (!f) return '';
  const p = String(f).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(f);
}

function pesos(v) {
  return `$ ${Math.round(Number(v || 0)).toLocaleString('es-CO')}`;
}

// Convierte cualquier imagen que el navegador sepa abrir (HEIC en Safari, WEBP…) a JPG.
async function aJpg(bytes, tipo) {
  const blob = new Blob([bytes], { type: tipo || 'image/*' });
  const bmp = await createImageBitmap(blob);
  const lienzo = document.createElement('canvas');
  const max = 1800;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  lienzo.width = Math.round(bmp.width * k); lienzo.height = Math.round(bmp.height * k);
  lienzo.getContext('2d').drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  const salida = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', 0.85));
  return new Uint8Array(await salida.arrayBuffer());
}

// comprobantes: [{ ruta, leyenda }]
export async function adjuntarComprobantesOC({ supabase, pdfBlob, comprobantes, folio }) {
  if (!comprobantes || comprobantes.length === 0) return pdfBlob;
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const carbon = rgb(0.18, 0.18, 0.18);
  const dorado = rgb(0.72, 0.54, 0.32);
  const gris = rgb(0.42, 0.4, 0.36);
  const doc = await PDFDocument.load(await pdfBlob.arrayBuffer());
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);

  // 1) Se arma la lista de "piezas" a dibujar (una imagen o una página de PDF).
  const piezas = [];
  for (const c of comprobantes) {
    try {
      const { data, error } = await supabase.storage.from('soportes-oc').createSignedUrl(c.ruta, 600);
      if (error || !data?.signedUrl) throw error || new Error('sin enlace');
      const resp = await fetch(data.signedUrl);
      const tipo = resp.headers.get('content-type') || '';
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const ruta = c.ruta.toLowerCase();
      if (ruta.endsWith('.pdf') || tipo.includes('pdf')) {
        const origen = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const embebidas = await doc.embedPdf(origen, origen.getPageIndices());
        embebidas.forEach((p, k) => piezas.push({ tipo: 'pdf', obj: p, leyenda: embebidas.length > 1 ? `${c.leyenda} (pág. ${k + 1})` : c.leyenda }));
      } else {
        let img;
        if (ruta.endsWith('.png') || tipo.includes('png')) img = await doc.embedPng(bytes);
        else {
          try { img = await doc.embedJpg(bytes); } catch { img = await doc.embedJpg(await aJpg(bytes, tipo)); }
        }
        piezas.push({ tipo: 'img', obj: img, leyenda: c.leyenda });
      }
    } catch (e) {
      piezas.push({ tipo: 'error', leyenda: c.leyenda });
    }
  }

  // 2) Dos por hoja: mitad superior e inferior, cada una con su leyenda.
  const [W, H] = A4;
  const margen = 32;
  const encabezado = 46;
  const altoMitad = (H - encabezado - margen) / 2;
  for (let i = 0; i < piezas.length; i += 2) {
    const pag = doc.addPage(A4);
    pag.drawRectangle({ x: 0, y: H - encabezado, width: W, height: encabezado, color: carbon });
    pag.drawText(seguro(`Comprobantes · ${folio}`), { x: margen, y: H - 29, size: 12, font: negrita, color: rgb(1, 1, 1) });
    pag.drawText(`Hoja ${Math.floor(i / 2) + 1} de ${Math.ceil(piezas.length / 2)}`, { x: W - margen - 80, y: H - 29, size: 9, font: normal, color: dorado });
    [piezas[i], piezas[i + 1]].forEach((p, k) => {
      if (!p) return;
      const techo = H - encabezado - 10 - k * altoMitad;
      pag.drawText(seguro(`${i + k + 1}. ${p.leyenda}`).slice(0, 110), { x: margen, y: techo - 12, size: 9, font: negrita, color: carbon });
      pag.drawLine({ start: { x: margen, y: techo - 17 }, end: { x: W - margen, y: techo - 17 }, thickness: 0.6, color: dorado });
      const cajaW = W - margen * 2;
      const cajaH = altoMitad - 34;
      const base = techo - 22 - cajaH;
      if (p.tipo === 'error') {
        pag.drawText('No se pudo incluir este comprobante; véalo en la app (Ver comprobante).', { x: margen, y: base + cajaH / 2, size: 9, font: normal, color: rgb(0.7, 0.1, 0.1) });
        return;
      }
      const ancho = p.obj.width; const alto = p.obj.height;
      const esc = Math.min(cajaW / ancho, cajaH / alto);
      const w = ancho * esc; const h = alto * esc;
      const x = margen + (cajaW - w) / 2; const y = base + (cajaH - h) / 2;
      if (p.tipo === 'img') pag.drawImage(p.obj, { x, y, width: w, height: h });
      else pag.drawPage(p.obj, { x, y, width: w, height: h });
      pag.drawRectangle({ x, y, width: w, height: h, borderColor: gris, borderWidth: 0.4 });
    });
  }

  const salida = await doc.save();
  return new Blob([salida], { type: 'application/pdf' });
}

export { fechaCorta, pesos };
