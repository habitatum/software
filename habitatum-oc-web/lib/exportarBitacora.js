'use client';
import ExcelJS from 'exceljs';

// Paleta de marca HABITATUM (igual a exportarControlPresupuestal.js).
const CARBON = 'FF2E2E2E';
const HUESO = 'FFEFECE6';
// Mismo tono que usa el skill bitacora-obra en el encabezado de la bitácora
// en Google Docs (#CEC5BA), para que el Excel luzca igual a lo que el equipo
// ya conoce.
const GRIS_ENCABEZADO = 'FFCEC5BA';

const BORDE_FINO = { style: 'thin', color: { argb: 'FFB9AFA0' } };

function fechaLargaEs(fecha) {
  const d = new Date(fecha + 'T00:00:00');
  const texto = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Convierte una URL (foto pública de Storage, o /logo-habitatum.png del
// propio sitio) a base64 + extensión, tal como lo necesita
// workbook.addImage(). Nunca lanza: si una foto no carga (ej. red lenta), la
// exportación sigue sin esa imagen en vez de fallar por completo.
async function urlABase64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const match = dataUrl.match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/s);
    if (!match) return null;
    const extension = match[1] === 'jpg' ? 'jpeg' : match[1];
    const base64 = match[2];
    // Dimensiones reales, para conservar la proporción al fijar el ancho.
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 4, height: 3 });
      img.src = dataUrl;
    });
    return { base64, extension, ...dims };
  } catch {
    return null;
  }
}

// Construye y descarga el Excel de la Bitácora de Obra, replicando la misma
// arquitectura visual que ya usa el skill bitacora-obra en el Google Doc:
// encabezado (logo + empresa + "BITÁCORA DIARIA DE OBRA" + obra, fondo gris
// cálido), FECHA del día en español, y una cuadrícula de fotos en pares con
// título en negrita + detalle en texto normal debajo. Cada día es una hoja
// (tab) nueva del libro, en vez de una página nueva del documento.
export async function exportarBitacora({ proyecto, dias, fotosPorDia }) {
  const diasOrdenados = [...dias].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  if (diasOrdenados.length === 0) return;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HABITATUM';
  workbook.created = new Date();

  const logo = await urlABase64('/logo-habitatum.png');
  let logoImageId = null;
  if (logo) logoImageId = workbook.addImage({ base64: logo.base64, extension: logo.extension === 'jpeg' ? 'jpeg' : 'png' });

  const ANCHO_COL = 13; // columnas iguales, 4 por bloque de foto (2 bloques por fila)
  const TOTAL_COLS = 8;
  const ANCHO_IMG = 250;
  const ALTO_IMG_MAX = 190;

  for (const dia of diasOrdenados) {
    const nombreHoja = dia.fecha.slice(0, 31);
    const hoja = workbook.addWorksheet(nombreHoja);
    hoja.columns = new Array(TOTAL_COLS).fill(null).map(() => ({ width: ANCHO_COL }));

    // ---------- Encabezado: logo | empresa/obra | metadatos, fondo gris cálido ----------
    for (let f = 1; f <= 3; f++) {
      for (let c = 1; c <= TOTAL_COLS; c++) {
        hoja.getCell(f, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_ENCABEZADO } };
      }
    }
    hoja.mergeCells(1, 1, 3, 1);
    if (logoImageId) {
      const r = logo.height / logo.width;
      const w = 70;
      const h = Math.round(w * r);
      hoja.addImage(logoImageId, { tl: { col: 0.1, row: 0.1 }, ext: { width: w, height: h } });
    }

    hoja.mergeCells(1, 2, 3, 5);
    const celdaTexto = hoja.getCell(1, 2);
    celdaTexto.value = { richText: [
      { font: { bold: true, size: 11, color: { argb: CARBON } }, text: 'HABITATUM SAS\n' },
      { font: { bold: true, size: 11, color: { argb: CARBON } }, text: 'BITÁCORA DIARIA DE OBRA\n' },
      { font: { bold: true, size: 11, color: { argb: CARBON } }, text: `OBRA: ${proyecto?.nombre || ''}` },
    ] };
    celdaTexto.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

    hoja.mergeCells(1, 6, 3, TOTAL_COLS);
    const celdaMeta = hoja.getCell(1, 6);
    const hoy = new Date();
    celdaMeta.value = { richText: [
      { font: { size: 9, color: { argb: CARBON } }, text: `Generado: ${hoy.toLocaleDateString('es-CO')}\n` },
      { font: { size: 9, color: { argb: CARBON } }, text: `Fotos del día: ${dia.cantidad_fotos ?? (fotosPorDia[dia.fecha] || []).length}` },
    ] };
    celdaMeta.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    hoja.getRow(1).height = 18;
    hoja.getRow(2).height = 18;
    hoja.getRow(3).height = 18;

    // ---------- FECHA del día ----------
    const filaFecha = 5;
    hoja.mergeCells(filaFecha, 1, filaFecha, TOTAL_COLS);
    const celdaFecha = hoja.getCell(filaFecha, 1);
    celdaFecha.value = `FECHA: ${fechaLargaEs(dia.fecha)}`;
    celdaFecha.font = { bold: true, size: 11, color: { argb: CARBON } };
    celdaFecha.alignment = { horizontal: 'left', vertical: 'middle' };

    // Resumen narrativo del día (si ya lo redactó la IA), justo debajo de la fecha.
    let filaCursor = filaFecha + 1;
    if (dia.resumen_texto) {
      hoja.mergeCells(filaCursor, 1, filaCursor, TOTAL_COLS);
      const celdaResumen = hoja.getCell(filaCursor, 1);
      celdaResumen.value = dia.resumen_texto;
      celdaResumen.font = { italic: true, size: 9, color: { argb: CARBON } };
      celdaResumen.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
      hoja.getRow(filaCursor).height = 30;
      filaCursor += 1;
    }
    filaCursor += 1;

    // ---------- Cuadrícula de fotos: 2 por fila (bloques de 4 columnas c/u) ----------
    const fotos = fotosPorDia[dia.fecha] || [];
    for (let i = 0; i < fotos.length; i += 2) {
      const filaImg = filaCursor;
      hoja.getRow(filaImg).height = ALTO_IMG_MAX * 0.78; // puntos ≈ px * 0.75, con margen
      const filaTxt = filaImg + 1;
      hoja.getRow(filaTxt).height = 30;

      const par = [fotos[i], fotos[i + 1]].filter(Boolean);
      for (let j = 0; j < par.length; j++) {
        const foto = par[j];
        const colInicio = 1 + j * 4;
        hoja.mergeCells(filaImg, colInicio, filaImg, colInicio + 3);
        hoja.mergeCells(filaTxt, colInicio, filaTxt, colInicio + 3);

        const celdaImgBorde = hoja.getCell(filaImg, colInicio);
        celdaImgBorde.border = { top: BORDE_FINO, bottom: BORDE_FINO, left: BORDE_FINO, right: BORDE_FINO };
        const celdaTxtBorde = hoja.getCell(filaTxt, colInicio);
        celdaTxtBorde.border = { top: BORDE_FINO, bottom: BORDE_FINO, left: BORDE_FINO, right: BORDE_FINO };
        celdaTxtBorde.alignment = { wrapText: true, vertical: 'top' };

        // eslint-disable-next-line no-await-in-loop
        const imgData = await urlABase64(foto.foto_url);
        if (imgData) {
          const imageId = workbook.addImage({ base64: imgData.base64, extension: imgData.extension });
          let w = ANCHO_IMG;
          let h = Math.round(ANCHO_IMG * imgData.height / imgData.width);
          if (h > ALTO_IMG_MAX) { h = ALTO_IMG_MAX; w = Math.round(ALTO_IMG_MAX * imgData.width / imgData.height); }
          hoja.addImage(imageId, { tl: { col: colInicio - 1 + 0.05, row: filaImg - 1 + 0.05 }, ext: { width: w, height: h } });
        }

        const titulo = foto.titulo_ia || '';
        const detalle = foto.descripcion_ia || '';
        celdaTxtBorde.value = titulo && detalle
          ? { richText: [
              { font: { bold: true, size: 9, color: { argb: CARBON } }, text: titulo },
              { font: { size: 9, color: { argb: CARBON } }, text: ` — ${detalle}` },
            ] }
          : { richText: [{ font: { bold: true, size: 9, color: { argb: CARBON } }, text: titulo || detalle || '' }] };
      }
      filaCursor += 2;
    }

    hoja.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Bitácora de Obra - ${proyecto?.nombre || 'Proyecto'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
