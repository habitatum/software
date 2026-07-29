'use client';
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, ShadingType, BorderStyle, PageBreak, VerticalAlign, PageOrientation,
} from 'docx';

// Paleta de marca HABITATUM, igual a la usada en el resto del sistema.
const CARBON = '2E2E2E';
// Mismo tono que usa el skill bitacora-obra en el encabezado de la bitácora
// en Google Docs (#CEC5BA), para que el Word luzca igual a lo que el equipo
// ya conoce.
const GRIS_ENCABEZADO = 'CEC5BA';
const BORDE_FINO = { style: BorderStyle.SINGLE, size: 2, color: 'B9AFA0' };
const SIN_BORDE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const SIN_BORDES = { top: SIN_BORDE, bottom: SIN_BORDE, left: SIN_BORDE, right: SIN_BORDE };

function fechaLargaEs(fecha) {
  const d = new Date(fecha + 'T00:00:00');
  const texto = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Convierte una URL (foto pública de Storage, o /logo-habitatum.png del
// propio sitio) a los bytes + tipo + dimensiones que necesita ImageRun de
// docx. Nunca lanza: si una foto no carga (ej. red lenta), la exportación
// sigue sin esa imagen en vez de fallar por completo.
async function urlABuffer(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const dims = await new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(objectUrl);
      };
      img.onerror = () => {
        resolve({ width: 4, height: 3 });
        URL.revokeObjectURL(objectUrl);
      };
      img.src = objectUrl;
    });
    const tipo = blob.type.includes('png') ? 'png' : 'jpg';
    return { data: new Uint8Array(arrayBuffer), tipo, ...dims };
  } catch {
    return null;
  }
}

function celdaFotoVacia() {
  return new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: SIN_BORDES, children: [new Paragraph('')] });
}

async function celdaFoto(foto) {
  const img = await urlABuffer(foto.foto_url);
  const hijosCelda = [];
  if (img) {
    let w = 260;
    let h = Math.round((260 * img.height) / img.width);
    if (h > 195) {
      h = 195;
      w = Math.round((195 * img.width) / img.height);
    }
    hijosCelda.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ data: img.data, type: img.tipo === 'png' ? 'png' : 'jpg', transformation: { width: w, height: h } })],
      })
    );
  } else {
    hijosCelda.push(new Paragraph(''));
  }

  const titulo = foto.titulo_ia || '';
  const detalle = foto.descripcion_ia || '';
  const runs = [];
  if (titulo) runs.push(new TextRun({ text: titulo, bold: true, size: 18, color: CARBON }));
  if (titulo && detalle) runs.push(new TextRun({ text: ' — ', size: 18, color: CARBON }));
  if (detalle) runs.push(new TextRun({ text: detalle, size: 18, color: CARBON }));
  if (runs.length === 0) runs.push(new TextRun({ text: '', size: 18 }));
  hijosCelda.push(new Paragraph({ spacing: { before: 80 }, children: runs }));

  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    borders: { top: BORDE_FINO, bottom: BORDE_FINO, left: BORDE_FINO, right: BORDE_FINO },
    children: hijosCelda,
  });
}

// Construye y descarga el Word (.docx) de la Bitácora de Obra, replicando la
// misma arquitectura visual que ya usa el skill bitacora-obra: encabezado
// (logo + empresa + "BITÁCORA DIARIA DE OBRA" + obra, fondo gris cálido),
// FECHA del día en español, y una cuadrícula de fotos en pares con título en
// negrita + detalle en texto normal debajo. Cada día empieza en una hoja
// (página) nueva, igual que en la bitácora que el equipo ya conoce.
//
// `fechasSeleccionadas`: Set opcional de fechas ('YYYY-MM-DD') a incluir; si
// no se pasa, exporta todos los días recibidos.
export async function exportarBitacora({ proyecto, dias, fotosPorDia, fechasSeleccionadas }) {
  const diasFiltrados = fechasSeleccionadas ? dias.filter((d) => fechasSeleccionadas.has(d.fecha)) : dias;
  const diasOrdenados = [...diasFiltrados].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  if (diasOrdenados.length === 0) return;

  const logo = await urlABuffer('/logo-habitatum.png');
  const hijos = [];

  for (let i = 0; i < diasOrdenados.length; i++) {
    const dia = diasOrdenados[i];
    if (i > 0) hijos.push(new Paragraph({ children: [new PageBreak()] }));

    // ---------- Encabezado: logo | empresa/obra | metadatos, fondo gris cálido ----------
    const celdaLogo = new TableCell({
      width: { size: 15, type: WidthType.PERCENTAGE },
      shading: { fill: GRIS_ENCABEZADO, type: ShadingType.CLEAR, color: 'auto' },
      borders: SIN_BORDES,
      verticalAlign: VerticalAlign.CENTER,
      children:
        logo && logo.width
          ? [
              new Paragraph({
                children: [
                  new ImageRun({
                    data: logo.data,
                    type: logo.tipo === 'png' ? 'png' : 'jpg',
                    transformation: { width: 70, height: Math.round((70 * logo.height) / logo.width) },
                  }),
                ],
              }),
            ]
          : [new Paragraph('')],
    });

    const celdaTitulo = new TableCell({
      width: { size: 55, type: WidthType.PERCENTAGE },
      shading: { fill: GRIS_ENCABEZADO, type: ShadingType.CLEAR, color: 'auto' },
      borders: SIN_BORDES,
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({ children: [new TextRun({ text: 'HABITATUM SAS', bold: true, size: 22, color: CARBON })] }),
        new Paragraph({ children: [new TextRun({ text: 'BITÁCORA DIARIA DE OBRA', bold: true, size: 22, color: CARBON })] }),
        new Paragraph({ children: [new TextRun({ text: `OBRA: ${proyecto?.nombre || ''}`, bold: true, size: 22, color: CARBON })] }),
      ],
    });

    const hoy = new Date();
    const celdaMeta = new TableCell({
      width: { size: 30, type: WidthType.PERCENTAGE },
      shading: { fill: GRIS_ENCABEZADO, type: ShadingType.CLEAR, color: 'auto' },
      borders: SIN_BORDES,
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Generado: ${hoy.toLocaleDateString('es-CO')}`, size: 18, color: CARBON })] }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: `Fotos del día: ${dia.cantidad_fotos ?? (fotosPorDia[dia.fecha] || []).length}`, size: 18, color: CARBON })],
        }),
      ],
    });

    hijos.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ children: [celdaLogo, celdaTitulo, celdaMeta] })],
      })
    );

    // ---------- FECHA del día ----------
    hijos.push(new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text: `FECHA: ${fechaLargaEs(dia.fecha)}`, bold: true, size: 24, color: CARBON })] }));

    if (dia.resumen_texto) {
      hijos.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun({ text: dia.resumen_texto, italics: true, size: 20, color: CARBON })],
        })
      );
    }

    // ---------- Cuadrícula de fotos: 2 por fila ----------
    const fotos = fotosPorDia[dia.fecha] || [];
    for (let f = 0; f < fotos.length; f += 2) {
      const par = [fotos[f], fotos[f + 1]].filter(Boolean);
      // eslint-disable-next-line no-await-in-loop
      const celdas = await Promise.all(par.map((foto) => celdaFoto(foto)));
      if (celdas.length === 1) celdas.push(celdaFotoVacia());
      hijos.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: celdas })] }));
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
        children: hijos,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Bitácora de Obra - ${proyecto?.nombre || 'Proyecto'}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
