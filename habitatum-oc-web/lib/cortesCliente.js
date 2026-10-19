// ============================================================
// Cortes de cobro / liquidación al CLIENTE (todo costo) — 057.
// La verdad de los valores vive en SQL (corte_cliente_detalle). Aquí solo se replica el
// mismo cálculo para mostrar en vivo lo que el admin va escribiendo antes de guardar.
// ============================================================
import { formatoPesos } from './calculosOC';

export const GRUPOS_CC = [
  { clave: 'CONTRATO', titulo: 'Contrato', suma: true },
  { clave: 'ADICIONAL_COSTO', titulo: 'Adicionales', suma: true },
  { clave: 'PAGO_DIRECTO_CLIENTE', titulo: 'Pagos directos del cliente (informativo, no suma)', suma: false },
];
export const grupoDe = (tipo) => (tipo === 'ADICIONAL' || tipo === 'ADICIONAL_COSTO' ? 'ADICIONAL_COSTO' : tipo === 'PAGO_DIRECTO_CLIENTE' ? tipo : 'CONTRATO');

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

// Mismo criterio que public._cc_valor: si la cantidad iguala la contratada, se usa el valor parcial exacto.
export function valorCantidad(q, qc, vu, vp) {
  const x = num(q);
  if (!x) return 0;
  if (Math.abs(x - num(qc)) < 1e-9) return num(vp);
  return Math.round(x * num(vu));
}

/**
 * Aplica las ediciones (aún sin guardar) al detalle del servidor y recalcula todo.
 * edic = { caps: { [capId]: { modo, porcentaje } }, items: { [itemId]: cantidad } }
 */
export function recalcular(detalle, edic = { caps: {}, items: {} }) {
  if (!detalle) return null;
  const capitulos = (detalle.capitulos || []).map((c) => {
    const e = edic.caps?.[c.id] || {};
    const modo = e.modo || c.modo;
    const porcentaje = e.porcentaje !== undefined ? e.porcentaje : c.porcentaje;
    const items = (c.items || []).map((it) => {
      const este = edic.items?.[it.id] !== undefined ? edic.items[it.id] : it.este;
      const acumulado = num(it.anterior) + num(este);
      const valor_acumulado = valorCantidad(acumulado, it.contratado, it.valor_unitario, it.valor_contratado);
      const valor_anterior = num(it.valor_anterior);
      return {
        ...it, este, acumulado, valor_acumulado, valor_anterior, valor_este: valor_acumulado - valor_anterior,
        excede: acumulado > num(it.contratado) + 1e-9,
      };
    });
    const acumulado = modo === 'GLOBAL'
      ? Math.round(num(c.contratado) * num(porcentaje) / 100)
      : items.reduce((a, it) => a + it.valor_acumulado, 0);
    const anterior = num(c.anterior);
    return {
      ...c, modo, porcentaje, items, acumulado, anterior, este: acumulado - anterior,
      avance: num(c.contratado) > 0 ? (acumulado / num(c.contratado)) * 100 : 0,
      diferencia: acumulado - num(c.contratado),
      grupo: grupoDe(c.tipo),
    };
  });
  const sum = (lista, k) => lista.reduce((a, c) => a + num(c[k]), 0);
  const grupos = GRUPOS_CC.map((g) => {
    const caps = capitulos.filter((c) => c.grupo === g.clave);
    return { ...g, capitulos: caps, contratado: sum(caps, 'contratado'), anterior: sum(caps, 'anterior'), este: sum(caps, 'este'), acumulado: sum(caps, 'acumulado') };
  }).filter((g) => g.capitulos.length > 0);
  const suman = grupos.filter((g) => g.suma);
  const pagos = (detalle.pagos || []).reduce((a, p) => a + num(p.valor), 0);
  const tot = {
    contratado: sum(suman, 'contratado'), anterior: sum(suman, 'anterior'), este: sum(suman, 'este'), acumulado: sum(suman, 'acumulado'),
    pagos,
  };
  tot.saldo = tot.acumulado - pagos;
  return { ...detalle, capitulos, grupos, tot };
}

export const fechaCC = (f) => { if (!f) return '—'; const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
export const cantCC = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));
export const tituloCorte = (corte) => (corte?.es_final ? 'Liquidación final de obra' : `Corte de obra No. ${corte?.numero}`);

// ---------- Excel (formato HABITATUM, fórmulas con resultado precalculado para que se vean en iPhone) ----------
export async function exportarCorteClienteExcel(calc, proyecto) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const corte = calc.corte;
  const ws = wb.addWorksheet(corte.es_final ? 'LIQUIDACION' : `CORTE ${corte.numero}`, { views: [{ showGridLines: false }] });
  const C = 'FF2E2E2E', D = 'FFB88A52', G = 'FFCEC5BA', H = 'FFEFECE6', CAFE = 'FFF3E9DC';
  const moneda = '_-"$"* #,##0_-;-"$"* #,##0_-;_-"$"* "-"??_-;_-@_-';
  [10, 52, 8, 13, 13, 13, 13, 16, 16, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= 11; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C } };
  try {
    const bytes = new Uint8Array(await (await fetch('/logo-habitatum.png')).arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    ws.addImage(wb.addImage({ base64: btoa(bin), extension: 'png' }), { tl: { col: 0.2, row: 0.2 }, ext: { width: 38, height: 48 } });
  } catch { /* sin logo */ }
  ws.getCell('B1').value = 'HABITATUM'; ws.getCell('B1').font = { size: 18, color: { argb: 'FFFFFFFF' } };
  ws.getCell('B2').value = `${tituloCorte(corte)} · ${proyecto?.nombre || ''}`; ws.getCell('B2').font = { size: 12, color: { argb: D } };
  ws.getCell('B3').value = `Cliente: ${calc.proyecto?.cliente || '—'} · Fecha del corte: ${fechaCC(corte.fecha)}${corte.estado === 'CERRADO' ? '' : ' · BORRADOR'}`;
  ws.getCell('B3').font = { size: 10, color: { argb: 'FFCEC5BA' } };

  const encabezado = (titulos) => {
    const r = ws.addRow(titulos);
    r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C } }; c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 }; c.alignment = { vertical: 'middle', wrapText: true }; });
    r.height = 28;
    return r;
  };
  const seccion = (t) => { ws.addRow([]); const r = ws.addRow([t]); r.getCell(1).font = { bold: true, size: 12 }; r.getCell(1).border = { bottom: { style: 'thin', color: { argb: D } } }; };

  // 1) Resumen por capítulo
  seccion('RESUMEN POR CAPÍTULO');
  encabezado(['Cap.', 'Capítulo', 'Modo', '% avance', '', '', '', 'Contratado', 'Anterior', 'Este corte', 'Acumulado']);
  const filasSubtotal = [];
  calc.grupos.forEach((g) => {
    const t = ws.addRow([g.titulo.toUpperCase()]);
    t.getCell(1).font = { bold: true, color: { argb: 'FF6B4A22' } };
    for (let i = 1; i <= 11; i++) t.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: H } };
    const ini = ws.rowCount + 1;
    g.capitulos.forEach((c) => {
      const r = ws.addRow([c.codigo, c.nombre, c.modo === 'GLOBAL' ? 'Global' : 'Cantidades', c.avance / 100, '', '', '', c.contratado, c.anterior,
        { formula: `K${ws.rowCount + 1}-I${ws.rowCount + 1}`, result: c.este }, c.acumulado]);
      r.getCell(4).numFmt = '0.0%';
      [8, 9, 10, 11].forEach((i) => { r.getCell(i).numFmt = moneda; });
      r.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CAFE } };
      r.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9D4CC' } } }; });
    });
    const fin = ws.rowCount;
    const s = ws.addRow(['', `Subtotal ${g.titulo.toLowerCase()}`, '', '', '', '', '',
      { formula: `SUM(H${ini}:H${fin})`, result: g.contratado }, { formula: `SUM(I${ini}:I${fin})`, result: g.anterior },
      { formula: `SUM(J${ini}:J${fin})`, result: g.este }, { formula: `SUM(K${ini}:K${fin})`, result: g.acumulado }]);
    [8, 9, 10, 11].forEach((i) => { s.getCell(i).numFmt = moneda; });
    s.eachCell((cell) => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: G } }; });
    if (g.suma) filasSubtotal.push(s.number);
  });
  const ref = (col) => filasSubtotal.map((n) => `${col}${n}`).join('+') || '0';
  const tot = ws.addRow(['', 'TOTAL LIQUIDADO (contrato + adicionales)', '', '', '', '', '',
    { formula: ref('H'), result: calc.tot.contratado }, { formula: ref('I'), result: calc.tot.anterior },
    { formula: ref('J'), result: calc.tot.este }, { formula: ref('K'), result: calc.tot.acumulado }]);
  [8, 9, 10, 11].forEach((i) => { tot.getCell(i).numFmt = moneda; });
  tot.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C } }; });
  const filaTotal = tot.number;

  // 2) Detalle por cantidades
  const capsCant = calc.capitulos.filter((c) => c.modo === 'CANTIDAD' && c.items.some((it) => Number(it.contratado) || Number(it.acumulado)));
  if (capsCant.length) {
    seccion('DETALLE POR CANTIDADES');
    encabezado(['Ítem', 'Descripción', 'Und', 'Contratado', 'Anterior', 'Este corte', 'Acumulado', 'Vr. unitario', 'Valor anterior', 'Valor este corte', 'Valor acumulado']);
    capsCant.forEach((c) => {
      const t = ws.addRow([c.codigo, c.nombre + (c.grupo === 'PAGO_DIRECTO_CLIENTE' ? ' (informativo)' : '')]);
      for (let i = 1; i <= 11; i++) { t.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: H } }; t.getCell(i).font = { bold: true }; }
      c.items.filter((it) => Number(it.contratado) || Number(it.acumulado)).forEach((it) => {
        const n = ws.rowCount + 1;
        const r = ws.addRow([it.codigo, it.descripcion, it.unidad || '', Number(it.contratado), Number(it.anterior), Number(it.este) || 0,
          { formula: `E${n}+F${n}`, result: it.acumulado }, Number(it.valor_unitario), it.valor_anterior,
          { formula: `K${n}-I${n}`, result: it.valor_este }, it.valor_acumulado]);
        [4, 5, 6, 7].forEach((i) => { r.getCell(i).numFmt = '#,##0.00'; });
        [8, 9, 10, 11].forEach((i) => { r.getCell(i).numFmt = moneda; });
        r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
        r.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CAFE } };
        if (it.excede) r.getCell(7).font = { bold: true, color: { argb: 'FF9B2C2C' } };
        r.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9D4CC' } } }; });
      });
    });
  }

  // 3) Pagos del cliente y saldo
  seccion('PAGOS DEL CLIENTE (registrados en Caja hasta la fecha del corte)');
  encabezado(['Fecha', 'Concepto', '', '', '', '', '', '', '', '', 'Valor']);
  const iniP = ws.rowCount + 1;
  (calc.pagos || []).forEach((p) => {
    const r = ws.addRow([fechaCC(p.fecha), p.concepto]);
    r.getCell(11).value = Number(p.valor); r.getCell(11).numFmt = moneda;
    r.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9D4CC' } } }; });
  });
  const finP = Math.max(iniP, ws.rowCount);
  ws.addRow([]);
  const filaPag = ws.rowCount + 2;
  const resumen = [
    ['TOTAL LIQUIDADO ACUMULADO', { formula: `K${filaTotal}`, result: calc.tot.acumulado }, H, 'FF2E2E2E'],
    ['(−) PAGOS RECIBIDOS DEL CLIENTE', { formula: (calc.pagos || []).length ? `SUM(K${iniP}:K${finP})` : '0', result: calc.tot.pagos }, 'FFE6F2E6', 'FF1E6B2E'],
    [calc.tot.saldo >= 0 ? 'SALDO A PAGAR POR EL CLIENTE' : 'SALDO A FAVOR DEL CLIENTE', { formula: `K${filaPag - 1}-K${filaPag}`, result: calc.tot.saldo }, C, 'FFFFFFFF'],
  ];
  resumen.forEach(([etq, val, fondo, color]) => {
    const r = ws.addRow(['', '', '', '', '', '', '', etq]);
    r.getCell(11).value = val; r.getCell(11).numFmt = moneda;
    ws.mergeCells(r.number, 8, r.number, 10);
    [8, 11].forEach((j) => { const c = r.getCell(j); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fondo } }; c.font = { bold: true, color: { argb: color } }; });
  });
  const info = calc.grupos.find((g) => !g.suma);
  if (info) {
    ws.addRow([]);
    const r = ws.addRow(['', `Pagos directos del cliente (informativo, no suma al total): ${formatoPesos(Math.round(info.acumulado))}`]);
    r.getCell(2).font = { italic: true, color: { argb: 'FF6B655D' } };
  }
  if (corte.notas) { ws.addRow([]); ws.addRow(['', `Observaciones: ${corte.notas}`]).getCell(2).alignment = { wrapText: true }; }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `${corte.es_final ? 'Liquidacion final' : `Corte cliente ${corte.numero}`} - ${proyecto?.nombre || ''}.xlsx`;
  a.click(); URL.revokeObjectURL(url);
}
