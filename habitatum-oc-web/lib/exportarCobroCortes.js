// 083 · Excel del corte de cobro de administración por Órdenes de Compra (identidad visual de la app).
// Pestañas: CORTE N (OC del corte, TOTAL, base, % y ADMINISTRACIÓN A COBRAR) · ANTICIPOS · RESUMEN DE CORTES.
import ExcelJS from 'exceljs';

const CARBON = 'FF2E2E2E'; const DORADO = 'FFB88A52'; const HUESO = 'FFEFECE6'; const GRIS = 'FFE3DED6';
const B = { style: 'thin', color: { argb: 'FFCFC8BD' } };
const VF = '"$" #,##0;-"$" #,##0;"-"';
const VF2 = '"$" #,##0.00;-"$" #,##0.00;"-"';
const fecha = (f) => { const p = String(f || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ''; };
const fill = (c, argb) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };
const col = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function titulo(ws, ncols, t1, t2) {
  ws.mergeCells(1, 1, 1, ncols);
  const a = ws.getCell(1, 1); a.value = t1; a.font = { bold: true, size: 14, color: { argb: HUESO } }; fill(a, CARBON);
  a.alignment = { horizontal: 'center', vertical: 'middle' }; ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, ncols);
  const b = ws.getCell(2, 1); b.value = t2; b.font = { italic: true, size: 10, color: { argb: 'FF6B655D' } }; b.alignment = { horizontal: 'center' };
}
function encabezado(ws, fila, textos) {
  textos.forEach((t, i) => {
    const c = ws.getCell(fila, i + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; fill(c, DORADO);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = { top: B, bottom: B, left: B, right: B };
  });
  ws.getRow(fila).height = 30;
}

export async function exportarCobroCorte({ proyecto, corte, lineas, anticipos, cortes, abierto }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HABITATUM';
  const nombre = abierto ? `CORTE ${corte.numero} (EN CURSO)` : `CORTE ${corte.numero}`;
  const t2 = `${proyecto.nombre} · Corte de cobro No. ${corte.numero} · ${abierto ? 'en curso, sin cerrar' : `cerrado al ${fecha(corte.fecha_corte)}`} · Administración ${String(corte.pct_administracion).replace('.', ',')} %`;

  // ---------- Hoja 1: OC del corte ----------
  const ws = wb.addWorksheet(nombre.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
  const cab = ['FECHA', 'FOLIO', 'CONTRATO', 'PROVEEDOR', 'CONCEPTO', 'TOTAL', 'A PAGAR', 'TIPO', 'ESTADO'];
  [11, 13, 13, 30, 44, 16, 16, 12, 11].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  titulo(ws, cab.length, 'HABITATUM · CORTE DE COBRO DE ADMINISTRACIÓN (ÓRDENES DE COMPRA)', t2);
  encabezado(ws, 4, cab);
  let f = 5; const ini = f;
  lineas.forEach((l) => {
    const v = [fecha(l.fecha), l.folio, l.contrato || '', l.proveedor || '', l.concepto || '', Number(l.total) || 0, Number(l.a_pagar) || 0,
      l.tipo === 'AJUSTE' ? 'AJUSTE' : (l.tipo_pago === 'ANTICIPO' ? 'ANTICIPO' : ''), l.estado_oc || ''];
    v.forEach((x, i) => {
      const c = ws.getCell(f, i + 1); c.value = x; c.border = { top: B, bottom: B, left: B, right: B };
      c.alignment = { vertical: 'top', wrapText: i === 4, horizontal: i >= 5 && i <= 6 ? 'right' : (i >= 7 ? 'center' : 'left') };
      if (i === 5 || i === 6) c.numFmt = VF2;
      if (l.tipo === 'AJUSTE') fill(c, 'FFFFF4E5');
    });
    if (l.tipo === 'AJUSTE' && l.motivo) { ws.getCell(f, 5).value = `${l.concepto} · Motivo: ${l.motivo}`; }
    f++;
  });
  const fin = f - 1;
  const tot = (etq, formula, res, fmt, fondo, color) => {
    ws.mergeCells(f, 1, f, 5);
    const a = ws.getCell(f, 1); a.value = etq; a.font = { bold: true, color: { argb: color } }; fill(a, fondo); a.alignment = { horizontal: 'right' };
    const c = ws.getCell(f, 7); c.value = { formula, result: res }; c.numFmt = fmt; c.font = { bold: true, color: { argb: color } }; fill(c, fondo);
    [6, 8, 9].forEach((k) => fill(ws.getCell(f, k), fondo));
    return f++;
  };
  const sumTotal = lineas.reduce((a, l) => a + Number(l.total || 0), 0);
  const base = lineas.reduce((a, l) => a + Number(l.a_pagar || 0), 0);
  f++;
  const fT = f;
  ws.mergeCells(f, 1, f, 5);
  ws.getCell(f, 1).value = 'TOTAL'; ws.getCell(f, 1).font = { bold: true }; ws.getCell(f, 1).alignment = { horizontal: 'right' };
  ws.getCell(f, 6).value = { formula: lineas.length ? `SUM(F${ini}:F${fin})` : '0', result: sumTotal }; ws.getCell(f, 6).numFmt = VF2; ws.getCell(f, 6).font = { bold: true };
  ws.getCell(f, 7).value = { formula: lineas.length ? `SUM(G${ini}:G${fin})` : '0', result: base }; ws.getCell(f, 7).numFmt = VF2; ws.getCell(f, 7).font = { bold: true };
  for (let k = 1; k <= 9; k++) fill(ws.getCell(f, k), GRIS);
  f++;
  const fB = tot('BASE (Σ A PAGAR)', `G${fT}`, base, VF2, HUESO, 'FF2E2E2E');
  const fP = f;
  ws.mergeCells(f, 1, f, 5);
  ws.getCell(f, 1).value = '% ADMINISTRACIÓN'; ws.getCell(f, 1).font = { bold: true }; ws.getCell(f, 1).alignment = { horizontal: 'right' };
  ws.getCell(f, 7).value = Number(corte.pct_administracion) / 100; ws.getCell(f, 7).numFmt = '0.00%'; ws.getCell(f, 7).font = { bold: true };
  f++;
  tot('ADMINISTRACIÓN A COBRAR', `ROUND(G${fB}*G${fP},0)`, Math.round(base * Number(corte.pct_administracion) / 100), VF, CARBON, HUESO);
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ---------- Hoja 2: anticipos ----------
  const wa = wb.addWorksheet('ANTICIPOS', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
  const cabA = ['FECHA', 'FOLIO', 'CONTRATO', 'PROVEEDOR', 'VALOR', 'AMORTIZADO', 'SALDO'];
  [11, 13, 13, 34, 16, 16, 16].forEach((w, i) => { wa.getColumn(i + 1).width = w; });
  titulo(wa, cabA.length, 'HABITATUM · ANTICIPOS', `${proyecto.nombre} · al ${fecha(corte.fecha_corte || new Date().toISOString())}`);
  encabezado(wa, 4, cabA);
  let r = 5; const ia = r;
  anticipos.forEach((a) => {
    const valor = Number(a.total) || 0; const saldo = Number(a.saldo_anticipo_por_amortizar) || 0;
    [fecha(a.fecha), a.folio, a.contrato || '', a.proveedor || '', valor].forEach((x, i) => { const c = wa.getCell(r, i + 1); c.value = x; c.border = { top: B, bottom: B, left: B, right: B }; if (i === 4) c.numFmt = VF2; });
    const cAm = wa.getCell(r, 6); cAm.value = { formula: `E${r}-G${r}`, result: valor - saldo }; cAm.numFmt = VF2; cAm.border = { top: B, bottom: B, left: B, right: B };
    const cS = wa.getCell(r, 7); cS.value = saldo; cS.numFmt = VF2; cS.border = { top: B, bottom: B, left: B, right: B };
    r++;
  });
  if (anticipos.length) {
    wa.getCell(r, 4).value = 'TOTAL'; wa.getCell(r, 4).font = { bold: true }; wa.getCell(r, 4).alignment = { horizontal: 'right' };
    ['E', 'F', 'G'].forEach((L, i) => {
      const c = wa.getCell(r, 5 + i); const res = anticipos.reduce((s, a) => s + (i === 0 ? Number(a.total) : i === 2 ? Number(a.saldo_anticipo_por_amortizar || 0) : Number(a.total) - Number(a.saldo_anticipo_por_amortizar || 0)), 0);
      c.value = { formula: `SUM(${L}${ia}:${L}${r - 1})`, result: res }; c.numFmt = VF2; c.font = { bold: true };
    });
    for (let k = 1; k <= 7; k++) fill(wa.getCell(r, k), GRIS);
  } else { wa.getCell(r, 1).value = 'Sin anticipos en esta obra.'; }

  // ---------- Hoja 3: resumen de cortes ----------
  const wr = wb.addWorksheet('RESUMEN DE CORTES', { views: [{ showGridLines: false }] });
  const cabR = ['CORTE', 'FECHA', 'TOTAL OC', 'BASE (A PAGAR)', '% ADMIN.', 'ADMINISTRACIÓN COBRADA', 'ACUMULADO'];
  [10, 12, 18, 18, 10, 22, 18].forEach((w, i) => { wr.getColumn(i + 1).width = w; });
  titulo(wr, cabR.length, 'HABITATUM · RESUMEN DE CORTES DE COBRO', proyecto.nombre);
  encabezado(wr, 4, cabR);
  let q = 5; const iq = q;
  const lista = [...cortes].sort((a, b) => a.numero - b.numero);
  if (abierto) lista.push({ ...corte, total_ocs: sumTotal, base, valor_administracion: Math.round(base * Number(corte.pct_administracion) / 100), enCurso: true });
  let acum = 0;
  lista.forEach((c) => {
    acum += Number(c.valor_administracion) || 0;
    const vals = [`Corte ${c.numero}${c.enCurso ? ' (en curso)' : ''}`, c.enCurso ? '' : fecha(c.fecha_corte), Number(c.total_ocs) || 0, Number(c.base) || 0, Number(c.pct_administracion) / 100, Number(c.valor_administracion) || 0];
    vals.forEach((x, i) => { const k = wr.getCell(q, i + 1); k.value = x; k.border = { top: B, bottom: B, left: B, right: B }; if (i === 2 || i === 3) k.numFmt = VF2; if (i === 4) k.numFmt = '0.00%'; if (i === 5) k.numFmt = VF; if (c.enCurso) fill(k, 'FFFFF4E5'); });
    const k = wr.getCell(q, 7); k.value = { formula: q === iq ? `F${q}` : `G${q - 1}+F${q}`, result: acum }; k.numFmt = VF; k.border = { top: B, bottom: B, left: B, right: B };
    q++;
  });
  wr.getCell(q, 2).value = 'TOTAL'; wr.getCell(q, 2).font = { bold: true };
  const sumas = { 3: lista.reduce((x, c) => x + Number(c.total_ocs || 0), 0), 4: lista.reduce((x, c) => x + Number(c.base || 0), 0), 6: acum };
  [['C', 3], ['D', 4], ['F', 6]].forEach(([L, i]) => { const k = wr.getCell(q, i); k.value = { formula: `SUM(${L}${iq}:${L}${q - 1})`, result: sumas[i] }; k.numFmt = i === 6 ? VF : VF2; k.font = { bold: true }; });
  for (let k = 1; k <= 7; k++) fill(wr.getCell(q, k), GRIS);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const nombreArchivo = `Cobro administración - ${proyecto.nombre} - Corte ${corte.numero}${abierto ? ' (en curso)' : ''}.xlsx`;
  return { blob, nombreArchivo, wb };
}
