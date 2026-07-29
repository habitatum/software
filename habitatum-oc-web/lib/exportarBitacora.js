'use client';
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, ShadingType, BorderStyle, PageBreak, VerticalAlign,
} from 'docx';

// Réplica exacta (en Word) de la arquitectura del Google Doc que ya genera el
// skill bitacora-obra (Codigo_Bitacora.gs, funciones crearEncabezado /
// llenarCelda / escribirEnBitacora): página vertical carta, márgenes de
// 0.5", encabezado de 3 columnas (logo | empresa+obra | código/versión/
// elaboración) sobre fondo #CEC5BA, FECHA en español, y cuadrícula de
// EXACTAMENTE 4 fotos por hoja (2x2) — si un día tiene más de 4 fotos, sigue
// en una hoja nueva sin repetir el encabezado, igual que en el Doc.
const CARBON = '2E2E2E';
const GRIS_ENCABEZADO = 'CEC5BA';
// Fuente única del documento: el Google Doc real usa Arial 11 por defecto
// (confirmado en el propio Doc). La librería `docx` no hereda esa fuente
// sola — sin `font` cada TextRun cae en la fuente por defecto de Word
// (normalmente Calibri/Aptos), que es la causa de que el Word descargado
// se vea con una tipografía distinta a la del Doc. Por eso aquí se fija
// explícitamente en cada TextRun del archivo.
const FUENTE = 'Arial';
// Borde de la cuadrícula de fotos: el Doc usa el borde por defecto de una
// tabla nueva de Google Docs (negro, ~1pt), no un gris claro. Antes esta
// constante usaba BFBFBF a 0.5pt, que se veía visiblemente más tenue que
// el Doc real.
const BORDE_GRID = { style: BorderStyle.SINGLE, size: 8, color: '000000' };
const SIN_BORDE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const SIN_BORDES = { top: SIN_BORDE, bottom: SIN_BORDE, left: SIN_BORDE, right: SIN_BORDE };

// Página carta vertical (Letter, 8.5"x11") con márgenes de 0.5" (36pt),
// igual que body.setMargin*(36) en el Doc. 1" = 1440 twips.
const PAGINA = {
  size: { width: 12240, height: 15840 }, // 8.5" x 11" en twips
  margin: { top: 720, bottom: 720, left: 720, right: 720 }, // 0.5" en twips
};

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
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    borders: SIN_BORDES,
    children: [new Paragraph('')],
  });
}

// Misma proporción que MAX_W=252 / MAX_H=283 puntos de llenarCelda() en el
// Doc (celda más alta que ancha, pensada para una hoja vertical con 2
// columnas) — convertidos a "píxeles" de docx a 96dpi (pt * 96/72).
const MAX_W = 336;
const MAX_H = 377;

async function celdaFoto(foto) {
  const img = await urlABuffer(foto.foto_url);
  const hijosCelda = [];
  if (img) {
    let w = MAX_W;
    let h = Math.round((MAX_W * img.height) / img.width);
    if (h > MAX_H) {
      h = MAX_H;
      w = Math.round((MAX_H * img.width) / img.height);
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
  // size en `docx` está en medios-punto: 22 = 11pt, igual que el texto
  // normal (Arial 11) del Doc real — antes estas leyendas usaban 18 (9pt),
  // más pequeño que en el Doc.
  if (titulo) runs.push(new TextRun({ text: titulo, bold: true, size: 22, color: CARBON, font: FUENTE }));
  if (titulo && detalle) runs.push(new TextRun({ text: ' — ', size: 22, color: CARBON, font: FUENTE }));
  if (detalle) runs.push(new TextRun({ text: detalle, size: 22, color: CARBON, font: FUENTE }));
  if (runs.length === 0) runs.push(new TextRun({ text: '', size: 22, font: FUENTE }));
  hijosCelda.push(new Paragraph({ spacing: { before: 80 }, children: runs }));

  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    borders: { top: BORDE_GRID, bottom: BORDE_GRID, left: BORDE_GRID, right: BORDE_GRID },
    children: hijosCelda,
  });
}

// Agrupa hasta 4 celdas de foto (2x2) en UNA sola tabla, igual que
// escribirEnBitacora() en el Doc, que llena una misma tabla `grid` hasta
// contarCeldas(grid) === 4 antes de abrir una hoja nueva.
function tablaGrupoDeFotos(celdas) {
  const filas = [];
  for (let i = 0; i < celdas.length; i += 2) {
    const par = [celdas[i], celdas[i + 1]].filter(Boolean);
    if (par.length === 1) par.push(celdaFotoVacia());
    filas.push(new TableRow({ children: par }));
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: filas });
}

// Encabezado de 3 columnas (85:293:162 pt ≈ 16%:54%:30% de las 540pt de
// ancho útil de la página), fondo #CEC5BA en las tres, igual que
// crearEncabezado() en el Doc: logo | empresa/obra | código-versión-elaboración.
function tablaEncabezado(proyecto, logo) {
  const celdaLogo = new TableCell({
    width: { size: 16, type: WidthType.PERCENTAGE },
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
                  // wLogo=70pt en el Doc → 70*96/72 ≈ 93px.
                  transformation: { width: 93, height: Math.round((93 * logo.height) / logo.width) },
                }),
              ],
            }),
          ]
        : [new Paragraph('')],
  });

  const celdaTitulo = new TableCell({
    width: { size: 54, type: WidthType.PERCENTAGE },
    shading: { fill: GRIS_ENCABEZADO, type: ShadingType.CLEAR, color: 'auto' },
    borders: SIN_BORDES,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({ children: [new TextRun({ text: 'HABITATUM SAS', bold: true, size: 22, color: CARBON, font: FUENTE })] }),
      new Paragraph({ children: [new TextRun({ text: 'BITÁCORA DIARIA DE OBRA', bold: true, size: 22, color: CARBON, font: FUENTE })] }),
      new Paragraph({ children: [new TextRun({ text: `OBRA: ${proyecto?.nombre || ''}`, bold: true, size: 22, color: CARBON, font: FUENTE })] }),
    ],
  });

  // Mismo bloque "Código / Versión / Elaboración" que CODIGO_PROYECTO /
  // VERSION_DOC / FECHA_ELABORACION en el Doc (metadatos fijos de control
  // documental, sin negrita, alineados a la izquierda). Como estos valores
  // se configuran una sola vez por proyecto en Apps Script y aquí el Word se
  // genera bajo demanda, "Elaboración" usa la fecha en que se genera el
  // archivo — si HABITATUM ya tiene código y versión fijos para este formato,
  // dime cuáles son y los dejo fijos también.
  const celdaCodigo = new TableCell({
    width: { size: 30, type: WidthType.PERCENTAGE },
    shading: { fill: GRIS_ENCABEZADO, type: ShadingType.CLEAR, color: 'auto' },
    borders: SIN_BORDES,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({ children: [new TextRun({ text: 'Código: PLC', size: 18, color: CARBON, font: FUENTE })] }),
      new Paragraph({ children: [new TextRun({ text: 'Versión: 01', size: 18, color: CARBON, font: FUENTE })] }),
      new Paragraph({ children: [new TextRun({ text: `Elaboración: ${new Date().toLocaleDateString('es-CO')}`, size: 18, color: CARBON, font: FUENTE })] }),
    ],
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [celdaLogo, celdaTitulo, celdaCodigo] })],
  });
}

// Construye y descarga el Word (.docx) de la Bitácora de Obra, replicando
// puntualmente la arquitectura del Google Doc que arma el skill
// bitacora-obra (Codigo_Bitacora.gs): página vertical carta, encabezado de
// 3 columnas, FECHA del día, y cuadrícula de 4 fotos por hoja (2x2) — los
// días con más de 4 fotos continúan en hojas nuevas sin repetir encabezado.
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

    hijos.push(tablaEncabezado(proyecto, logo));

    hijos.push(
      new Paragraph({
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: `FECHA: ${fechaLargaEs(dia.fecha)}`, bold: true, size: 22, color: CARBON, font: FUENTE })],
      })
    );

    if (dia.resumen_texto) {
      hijos.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun({ text: dia.resumen_texto, italics: true, size: 20, color: CARBON, font: FUENTE })],
        })
      );
    }

    // Cuadrícula: exactamente 4 fotos por hoja (2x2). Si el día tiene más de
    // 4, las siguientes van en hojas nuevas SIN repetir el encabezado ni la
    // FECHA, igual que en el Doc (solo la primera hoja del día los lleva).
    const fotos = fotosPorDia[dia.fecha] || [];
    for (let g = 0; g < fotos.length; g += 4) {
      if (g > 0) hijos.push(new Paragraph({ children: [new PageBreak()] }));
      const grupo = fotos.slice(g, g + 4);
      // eslint-disable-next-line no-await-in-loop
      const celdas = await Promise.all(grupo.map((foto) => celdaFoto(foto)));
      hijos.push(tablaGrupoDeFotos(celdas));
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: PAGINA },
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
