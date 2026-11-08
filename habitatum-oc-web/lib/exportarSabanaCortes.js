// ============================================================
// Descarga en Excel de la SÁBANA DE CORTES, con la misma estructura del Excel
// base de cortes de obra y la imagen de marca HABITATUM (logo, carbón, dorado,
// gris cálido). Usa el mismo modelo que la pantalla (lib/modeloSabana.js).
// ============================================================
const CARBON = 'FF2E2E2E';
const DORADO = 'FFB88A52';
const GRIS = 'FFCEC5BA';
const HUESO = 'FFEFECE6';
const MONEDA = '_-"$"* #,##0_-;-"$"* #,##0_-;_-"$"* "-"??_-;_-@_-';
const CANT = '#,##0.###';

import { CARGOS_PERSONAL, nombreCargo } from './personalCortes';

const relleno = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const borde = { bottom: { style: 'thin', color: { argb: 'FFD9D4CC' } } };

export async function construirLibroSabana({ m, contrato, proyecto, logoBase64, ExcelJS, personal }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HABITATUM';
  const ws = wb.addWorksheet('Cortes de obra', { views: [{ state: 'frozen', xSplit: 2, ySplit: 9, showGridLines: false }] });
  const cols = m.columnas;

  // Anchos como el Excel base: A 6 · B 58 · C-F · separador 3.8 · 3 columnas por corte
  const anchos = [6, 58, 8, 11, 16, 17];
  cols.forEach(() => anchos.push(3.8, 11, 16, 17));
  anchos.push(3.8, 11, 16, 17);
  anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const ultimaCol = anchos.length;
  const colCorte = (k) => 8 + k * 4;          // primera columna (Cantidad) del corte k
  const colAcum = 8 + cols.length * 4;

  // ---------- Encabezado de marca ----------
  for (let r = 1; r <= 4; r++) for (let c = 1; c <= ultimaCol; c++) ws.getCell(r, c).fill = relleno(CARBON);
  if (logoBase64) {
    const img = wb.addImage({ base64: logoBase64, extension: 'png' });
    ws.addImage(img, { tl: { col: 0.15, row: 0.25 }, ext: { width: 44, height: 56 } });
  }
  ws.getCell('B1').value = 'HABITATUM';
  ws.getCell('B1').font = { name: 'Calibri', size: 20, color: { argb: 'FFFFFFFF' } };
  ws.getCell('B2').value = `Cortes de obra · Contrato ${contrato.numero_contrato}`;
  ws.getCell('B2').font = { size: 13, color: { argb: DORADO } };
  ws.getCell('B3').value = proyecto?.nombre || '';
  ws.getCell('B3').font = { size: 10, color: { argb: 'FFCDC5BA' } };
  for (let r = 1; r <= ultimaCol; r++) ws.getCell(4, r).border = { bottom: { style: 'medium', color: { argb: DORADO } } };

  const info = [
    ['Contratista', contrato.proveedores?.nombre || ''],
    ['Objeto', contrato.concepto || ''],
    ['Valor del contrato', Number(contrato.valor_inicial) || 0],
  ];
  info.forEach(([k, v], i) => {
    const cell = ws.getCell(5 + i, 2);
    const texto = typeof v === 'number' ? '$ ' + Math.round(v).toLocaleString('es-CO') : v;
    cell.value = { richText: [{ text: `${k}: `, font: { size: 9, color: { argb: 'FF6B655D' } } }, { text: texto, font: { size: 10, bold: i === 0 } }] };
  });
  ws.getCell(5, 6).value = `Generado: ${new Date().toLocaleDateString('es-CO')}`;
  ws.getCell(5, 6).font = { size: 9, color: { argb: 'FF6B655D' } };

  // ---------- Encabezados de la tabla (filas 8 y 9, como filas 2 y 3 del Excel base) ----------
  const r1 = 8; const r2 = 9;
  const titulo = (r, c1, c2, texto, oscuro) => {
    ws.mergeCells(r, c1, r, c2);
    const cell = ws.getCell(r, c1);
    cell.value = texto;
    cell.font = { bold: true, color: { argb: oscuro ? 'FFFFFFFF' : CARBON } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    for (let c = c1; c <= c2; c++) { ws.getCell(r, c).fill = relleno(oscuro ? CARBON : GRIS); ws.getCell(r, c).border = { bottom: { style: 'thin', color: { argb: DORADO } } }; }
  };
  titulo(r1, 1, 6, 'ITEMS Y ELEMENTOS CONTRACTUALES (APROBADOS)');
  cols.forEach((c, k) => titulo(r1, colCorte(k), colCorte(k) + 2, `CORTE ${c.numero}${c.tipo === 'DEVOLUCION' ? ' · DEVOLUCIÓN RETENIDO' : ''}${c.fecha ? ` · ${c.fecha.split('-').reverse().join('/')}` : ''}${c.folio ? ` · ${c.folio}` : ''}`, c.editable));
  titulo(r1, colAcum, colAcum + 2, 'ACUMULADOS TOTALES CORTES');
  ws.getRow(r1).height = 30;
  const enc = ['Ítem', 'Descripción', 'Unidad', 'Cantidad', 'Valor Unit', 'SUBTOTAL'];
  enc.forEach((t, i) => { const cell = ws.getCell(r2, i + 1); cell.value = t; });
  cols.forEach((c, k) => ['Cantidad', 'Valor Unit', 'SUBTOTAL'].forEach((t, i) => { ws.getCell(r2, colCorte(k) + i).value = t; }));
  ['Cantidad', 'Valor Unit', 'SUBTOTAL'].forEach((t, i) => { ws.getCell(r2, colAcum + i).value = t; });
  for (let c = 1; c <= ultimaCol; c++) {
    const cell = ws.getCell(r2, c);
    if (cell.value) { cell.fill = relleno(GRIS); cell.font = { bold: true }; cell.alignment = { horizontal: c <= 2 ? 'left' : 'center' }; }
  }

  let r = r2 + 1;
  const numero = (cell, v, fmt) => { cell.value = v || null; cell.numFmt = fmt; };

  const filaItem = (item, contractual) => {
    ws.getCell(r, 1).value = item.codigo || (contractual ? '' : 'AD');
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = item.descripcion;
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
    ws.getCell(r, 3).value = item.unidad || '';
    if (contractual) { numero(ws.getCell(r, 4), Number(item.cantidad), CANT); numero(ws.getCell(r, 6), Number(item.cantidad) * Number(item.valor_unitario), MONEDA); }
    numero(ws.getCell(r, 5), Number(item.valor_unitario), MONEDA);
    cols.forEach((c, k) => {
      const q = c.cantidad(item.id);
      numero(ws.getCell(r, colCorte(k)), q, CANT);
      numero(ws.getCell(r, colCorte(k) + 1), c.vu(item.id), MONEDA);
      numero(ws.getCell(r, colCorte(k) + 2), q * c.vu(item.id), MONEDA);
      if (c.editable) [0, 1, 2].forEach((i) => { ws.getCell(r, colCorte(k) + i).fill = relleno('FFF3E9DC'); });
    });
    const aq = m.acumulado.cantidad(item.id);
    numero(ws.getCell(r, colAcum), aq, CANT);
    numero(ws.getCell(r, colAcum + 1), Number(item.valor_unitario), MONEDA);
    numero(ws.getCell(r, colAcum + 2), m.acumulado.valor(item.id), MONEDA);
    if (m.excede(item)) ws.getCell(r, colAcum).font = { bold: true, color: { argb: 'FF9B2C2C' } };
    for (let c = 1; c <= ultimaCol; c++) ws.getCell(r, c).border = borde;
    r++;
  };

  const cierre = ({ izq, valorIzq, etq, valor, etqAcum, valorAcum, gris }) => {
    if (izq) { ws.getCell(r, 2).value = izq; ws.getCell(r, 2).font = { bold: true }; }
    if (valorIzq !== undefined) { numero(ws.getCell(r, 6), valorIzq, MONEDA); ws.getCell(r, 6).font = { bold: true }; ws.getCell(r, 6).fill = relleno(GRIS); }
    cols.forEach((c, k) => {
      ws.mergeCells(r, colCorte(k), r, colCorte(k) + 1);
      const e = ws.getCell(r, colCorte(k)); e.value = etq(c); e.font = { bold: true };
      const v = ws.getCell(r, colCorte(k) + 2); numero(v, valor(c), MONEDA); v.font = { bold: true }; v.fill = relleno(GRIS);
      if (gris) e.fill = relleno(GRIS);
    });
    ws.mergeCells(r, colAcum, r, colAcum + 1);
    const ea = ws.getCell(r, colAcum); ea.value = etqAcum; ea.font = { bold: true };
    const va = ws.getCell(r, colAcum + 2); numero(va, valorAcum, MONEDA); va.font = { bold: true }; va.fill = relleno(GRIS);
    if (gris) ea.fill = relleno(GRIS);
    r++;
  };

  m.contractuales.forEach((i) => filaItem(i, true));
  cierre({ valorIzq: m.subtotalContratado, etq: (c) => `SUBTOTAL CORTE ${c.numero}`, valor: (c) => c.subContrato, etqAcum: 'SUBTOTAL CORTES', valorAcum: m.acumulado.subContrato });
  r++;
  // Sección ADICIONALES (como la fila 19 del Excel base)
  ws.mergeCells(r, 1, r, 6); ws.getCell(r, 1).value = 'ADICIONALES';
  cols.forEach((c, k) => { ws.mergeCells(r, colCorte(k), r, colCorte(k) + 2); ws.getCell(r, colCorte(k)).value = 'ADICIONALES'; });
  ws.mergeCells(r, colAcum, r, colAcum + 2); ws.getCell(r, colAcum).value = 'ADICIONALES';
  for (let c = 1; c <= ultimaCol; c++) if (ws.getCell(r, c).value) { ws.getCell(r, c).fill = relleno(GRIS); ws.getCell(r, c).font = { bold: true }; ws.getCell(r, c).alignment = { horizontal: 'center' }; }
  r++;
  m.adicionales.forEach((i) => filaItem(i, false));
  cierre({ etq: (c) => `SUBTOTAL ADIC. CORTE ${c.numero}`, valor: (c) => c.subAdicionales, etqAcum: 'ACUMULADO ADICIONALES', valorAcum: m.acumulado.subAdicionales });
  r++;
  cierre({ etq: (c) => `TOTAL CORTE ${c.numero}`, valor: (c) => c.total, etqAcum: 'TOTAL CORTES', valorAcum: m.acumulado.total });
  if (cols.some((c) => c.descuento)) cierre({ etq: () => '(-) Descuento', valor: (c) => c.descuento, etqAcum: '(-) TOTAL DESCUENTOS', valorAcum: m.acumulado.descuento });
  if (cols.some((c) => c.impuestos)) cierre({ etq: () => `(+) ${m.etiquetaImpuestos}`, valor: (c) => c.impuestos, etqAcum: `(+) TOTAL ${m.etiquetaImpuestos.toUpperCase()}`, valorAcum: m.acumulado.impuestos });
  cierre({ etq: (c) => `(-) Retenido ${c.pctRetencion}%`, valor: (c) => c.retencion, etqAcum: '(-) TOTAL RETENIDO', valorAcum: m.acumulado.retencion });
  // Devolución de retenidos (047)
  const hayDevolucion = cols.some((c) => c.devolucion || c.descuentoRetenido);
  if (hayDevolucion) cierre({ etq: () => '(+) Devolución retenido', valor: (c) => c.devolucion, etqAcum: '(+) TOTAL DEVUELTO', valorAcum: m.acumulado.devolucion });
  if (cols.some((c) => c.descuentoRetenido)) cierre({ etq: () => '(-) Descuento al retenido', valor: (c) => c.descuentoRetenido, etqAcum: '(-) DESCONTADO DEL RETENIDO', valorAcum: m.acumulado.descuentoRetenido });
  if (hayDevolucion) cierre({ etq: () => 'Retenido por devolver', valor: (c) => c.porDevolverAcum, etqAcum: 'RETENIDO POR DEVOLVER', valorAcum: m.acumulado.porDevolver, gris: true });
  cierre({
    izq: `ANTICIPO DE OBRA${m.totalAnticipos ? ` (${m.pctAnticipo}%)` : ''}`, valorIzq: m.totalAnticipos,
    etq: (c) => `(-) Amortización Anticipo${c.pctAmortizacion ? ` ${c.pctAmortizacion}%` : ''}`, valor: (c) => c.amortizacion,
    etqAcum: '(+) TOTAL POR AMORTIZAR', valorAcum: m.acumulado.porAmortizar,
  });
  cierre({ etq: (c) => `TOTAL PAGO CORTE ${c.numero}`, valor: (c) => c.neto, etqAcum: 'TOTAL PAGADO', valorAcum: m.acumulado.pagado, gris: true });

  // Línea tenue entre bloques de cortes (columna separadora), desde los encabezados hasta el final.
  const lineaSep = { right: { style: 'thin', color: { argb: GRIS } } };
  [...cols.map((c, k) => colCorte(k) - 1), colAcum - 1].forEach((col) => {
    for (let fila = r1; fila < r; fila++) ws.getCell(fila, col).border = lineaSep;
  });

  // Pie de marca
  r += 1;
  ws.getCell(r, 2).value = `HABITATUM · Documento generado desde la plataforma el ${new Date().toLocaleString('es-CO')}`;
  ws.getCell(r, 2).font = { size: 8, italic: true, color: { argb: 'FF6B655D' } };
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // 077 · Anexo: soporte de personal por administración de los cortes (registro y totales por cargo).
  if ((personal?.filas || []).length) hojaPersonal(wb, personal, contrato);

  return wb;
}

function hojaPersonal(wb, personal, contrato) {
  const wp = wb.addWorksheet('SOPORTE PERSONAL', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
  [9, 30, 16, 13, 10, 48].forEach((w, i) => { wp.getColumn(i + 1).width = w; });
  wp.mergeCells(1, 1, 1, 6);
  const t = wp.getCell(1, 1);
  t.value = `HABITATUM · SOPORTE DE PERSONAL POR ADMINISTRACIÓN — Contrato ${contrato.numero_contrato}`;
  t.font = { bold: true, size: 13, color: { argb: 'FFEFECE6' } }; t.fill = relleno(CARBON); t.alignment = { horizontal: 'center', vertical: 'middle' };
  wp.getRow(1).height = 24;
  wp.getCell(2, 1).value = `${contrato.proveedores?.nombre || ''} · ${contrato.concepto || ''}`;
  wp.getCell(2, 1).font = { italic: true, size: 9, color: { argb: 'FF6B655D' } };
  const enc = (fila, textos, fondo = DORADO) => textos.forEach((x, i) => {
    const c = wp.getCell(fila, i + 1); c.value = x; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = relleno(fondo);
    c.alignment = { horizontal: i === 4 || (fondo === CARBON && i >= 1) ? 'right' : 'left' };
  });
  enc(4, ['CORTE', 'NOMBRE', 'CARGO', 'DÍA LABORADO', 'HORAS', 'ACTIVIDAD']);
  let r = 5;
  const fechaTxt = (f) => { const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
  const filas = [...personal.filas].sort((a, b) => (a.corte - b.corte) || String(a.fecha).localeCompare(String(b.fecha)) || (a.orden - b.orden));
  const ini = r;
  filas.forEach((f) => {
    wp.getRow(r).values = [`Corte ${f.corte}`, f.nombre || '—', nombreCargo(f.cargo), fechaTxt(f.fecha), Number(f.horas), f.actividad || ''];
    wp.getCell(r, 5).numFmt = '#,##0.##';
    wp.getCell(r, 6).alignment = { wrapText: true, vertical: 'top' };
    for (let c = 1; c <= 6; c++) wp.getCell(r, c).border = borde;
    r++;
  });
  const fin = r - 1;
  wp.getCell(r, 4).value = 'TOTAL HORAS'; wp.getCell(r, 4).font = { bold: true };
  wp.getCell(r, 5).value = { formula: `SUM(E${ini}:E${fin})`, result: filas.reduce((a, f) => a + Number(f.horas), 0) };
  wp.getCell(r, 5).font = { bold: true }; wp.getCell(r, 5).numFmt = '#,##0.##';
  r += 2;
  // Totales por corte y cargo (fórmulas SUMIFS sobre el registro, con resultado precalculado).
  const cortesN = [...new Set(filas.map((f) => f.corte))];
  wp.mergeCells(r, 1, r, 2); wp.getCell(r, 1).value = 'TOTAL HORAS POR CARGO';
  wp.getCell(r, 1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; wp.getCell(r, 1).fill = relleno(CARBON);
  const colsCorte = cortesN.map((n, k) => 3 + k);
  cortesN.forEach((n, k) => { const c = wp.getCell(r, 3 + k); c.value = `Corte ${n}`; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = relleno(CARBON); c.alignment = { horizontal: 'right' }; wp.getColumn(3 + k).width = Math.max(wp.getColumn(3 + k).width || 0, 14); });
  r++;
  CARGOS_PERSONAL.forEach((cg) => {
    if (!filas.some((f) => f.cargo === cg.id)) return;
    wp.mergeCells(r, 1, r, 2); wp.getCell(r, 1).value = cg.largo; wp.getCell(r, 1).font = { bold: true };
    cortesN.forEach((n, k) => {
      const res = filas.filter((f) => f.cargo === cg.id && f.corte === n).reduce((a, f) => a + Number(f.horas), 0);
      const c = wp.getCell(r, colsCorte[k]);
      c.value = { formula: `SUMIFS($E$${ini}:$E$${fin},$A$${ini}:$A$${fin},"Corte ${n}",$C$${ini}:$C$${fin},"${cg.nombre}")`, result: res };
      c.numFmt = '#,##0.##;-#,##0.##;"-"';
    });
    r++;
  });
  wp.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

// Descarga desde el navegador.
export async function exportarSabanaCortes({ m, contrato, proyecto, personal }) {
  const ExcelJS = (await import('exceljs')).default;
  let logoBase64 = null;
  try {
    const bytes = new Uint8Array(await (await fetch('/logo-habitatum.png')).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    logoBase64 = btoa(bin);
  } catch { /* sin logo */ }
  const wb = await construirLibroSabana({ m, contrato, proyecto, logoBase64, ExcelJS, personal });
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${contrato.numero_contrato} - Cortes de obra - ${contrato.proveedores?.nombre || ''}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
