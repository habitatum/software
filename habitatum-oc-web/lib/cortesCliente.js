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
  const numActual = detalle.corte?.numero;
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
    // 073: historia por corte (valor y % de cada corte), con el corte actual en vivo.
    const hist = (c.historia || []).map((h) => ({ numero: h.numero, acumulado: num(h.acumulado) }));
    const iAct = hist.findIndex((h) => h.numero === numActual);
    if (iAct >= 0) hist[iAct].acumulado = acumulado; else hist.push({ numero: numActual, acumulado });
    const porCorte = hist.map((h, k) => {
      const valor = h.acumulado - (k > 0 ? hist[k - 1].acumulado : 0);
      return { numero: h.numero, valor, acumulado: h.acumulado, pct: num(c.contratado) > 0 ? (valor / num(c.contratado)) * 100 : 0 };
    });
    const itemsH = items.map((it) => {
      const q = (Array.isArray(it.por_corte) ? it.por_corte : []).map(num);
      while (q.length < porCorte.length) q.push(0);
      const k = porCorte.findIndex((h) => h.numero === numActual);
      if (k >= 0) q[k] = num(it.este);
      let cum = 0; let vAnt = 0;
      const porCorteIt = q.map((x, j) => {
        cum += x;
        const v = valorCantidad(cum, it.contratado, it.valor_unitario, it.valor_contratado);
        const r = { numero: porCorte[j]?.numero, cantidad: x, valor: v - vAnt };
        vAnt = v; return r;
      });
      return { ...it, porCorte: porCorteIt };
    });
    // Capítulos globales (por %): para el detalle, cada ítem avanza en la misma proporción del capítulo en cada
    // corte (cantidad = contratada × %; valor repartido según el valor del ítem, el redondeo va al ítem mayor).
    if (modo === 'GLOBAL' && itemsH.length && num(c.contratado) > 0) {
      const mayor = itemsH.reduce((m, it, j) => (num(it.valor_contratado) > num(itemsH[m].valor_contratado) ? j : m), 0);
      const cortesIt = porCorte.map((h) => {
        const f = h.valor / num(c.contratado);
        const vals = itemsH.map((it) => Math.round(num(it.valor_contratado) * f));
        vals[mayor] += h.valor - vals.reduce((a, v) => a + v, 0);
        return { numero: h.numero, f, vals };
      });
      itemsH.forEach((it, j) => {
        it.porCorte = cortesIt.map((x) => ({ numero: x.numero, cantidad: num(it.contratado) * x.f, valor: x.vals[j] }));
        it.acumulado = it.porCorte.reduce((a, h) => a + h.cantidad, 0);
        it.valor_acumulado = it.porCorte.reduce((a, h) => a + h.valor, 0);
        const act = it.porCorte.find((h) => h.numero === numActual) || { cantidad: 0, valor: 0 };
        it.este = act.cantidad; it.valor_este = act.valor;
        it.anterior = it.acumulado - act.cantidad; it.valor_anterior = it.valor_acumulado - act.valor;
        it.excede = false; it.proporcional = true;
      });
    }
    // % del capítulo antes de este corte (para escribir el % de ESTE corte en los capítulos globales).
    const pctAnterior = c.modo_anterior === 'GLOBAL' ? num(c.porcentaje_anterior)
      : (num(c.contratado) > 0 ? (anterior / num(c.contratado)) * 100 : 0);
    return {
      ...c, modo, porcentaje, items: itemsH, acumulado, anterior, este: acumulado - anterior, porCorte, pctAnterior,
      avance: num(c.contratado) > 0 ? (acumulado / num(c.contratado)) * 100 : 0,
      diferencia: acumulado - num(c.contratado),
      grupo: grupoDe(c.tipo),
    };
  });
  const sum = (lista, k) => lista.reduce((a, c) => a + num(c[k]), 0);
  const grupos = GRUPOS_CC.map((g) => {
    const caps = capitulos.filter((c) => c.grupo === g.clave);
    const porCorte = (caps[0]?.porCorte || []).map((h, k) => ({ numero: h.numero, valor: caps.reduce((a, c) => a + num(c.porCorte[k]?.valor), 0) }));
    return { ...g, capitulos: caps, contratado: sum(caps, 'contratado'), anterior: sum(caps, 'anterior'), este: sum(caps, 'este'), acumulado: sum(caps, 'acumulado'), porCorte };
  }).filter((g) => g.capitulos.length > 0);
  const suman = grupos.filter((g) => g.suma);
  const pagos = (detalle.pagos || []).reduce((a, p) => a + num(p.valor), 0);
  const tot = {
    contratado: sum(suman, 'contratado'), anterior: sum(suman, 'anterior'), este: sum(suman, 'este'), acumulado: sum(suman, 'acumulado'),
    pagos,
    porCorte: (suman[0]?.porCorte || []).map((h, k) => ({ numero: h.numero, valor: suman.reduce((a, g) => a + num(g.porCorte[k]?.valor), 0) })),
  };
  tot.saldo = tot.acumulado - pagos;
  const numerosCortes = (capitulos[0]?.porCorte || []).map((h) => h.numero);
  return { ...detalle, capitulos, grupos, tot, numerosCortes };
}

export const fechaCC = (f) => { if (!f) return '—'; const p = String(f).slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
export const cantCC = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));
export const tituloCorte = (corte) => (corte?.es_final ? 'Liquidación final de obra' : `Corte de obra No. ${corte?.numero}`);

// ---------- Excel (formato HABITATUM, fórmulas con resultado precalculado para que se vean en iPhone) ----------
// 073: hoja RESUMEN con una columna por corte (como el control presupuestal de administración delegada), los
// adicionales con su detalle ítem por ítem, pagos y saldo; hoja aparte DETALLE POR CANTIDADES (sin adicionales).
const colL = (n) => { let x = ''; let k = n; while (k > 0) { const m = (k - 1) % 26; x = String.fromCharCode(65 + m) + x; k = Math.floor((k - 1) / 26); } return x; };

export async function exportarCorteClienteExcel(calc, proyecto) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const corte = calc.corte;
  const C = 'FF2E2E2E', D = 'FFB88A52', G = 'FFCEC5BA', H = 'FFEFECE6', CAFE = 'FFF3E9DC';
  const moneda = '_-"$"* #,##0_-;-"$"* #,##0_-;_-"$"* "-"??_-;_-@_-';
  const cortes = calc.numerosCortes?.length ? calc.numerosCortes : [corte.numero];
  const nC = cortes.length;
  const kAct = cortes.indexOf(corte.numero);
  const relleno = (c, argb) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };
  let logo = null;
  try {
    const bytes = new Uint8Array(await (await fetch('/logo-habitatum.png')).arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    logo = wb.addImage({ base64: btoa(bin), extension: 'png' });
  } catch { /* sin logo */ }
  const cabecera = (ws, nCols, subtitulo) => {
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= nCols; c++) relleno(ws.getCell(r, c), C);
    if (logo !== null) ws.addImage(logo, { tl: { col: 0.2, row: 0.2 }, ext: { width: 38, height: 48 } });
    ws.getCell('B1').value = 'HABITATUM'; ws.getCell('B1').font = { size: 18, color: { argb: 'FFFFFFFF' } };
    ws.getCell('B2').value = `${tituloCorte(corte)} · ${proyecto?.nombre || ''}${subtitulo ? ` · ${subtitulo}` : ''}`; ws.getCell('B2').font = { size: 12, color: { argb: D } };
    ws.getCell('B3').value = `Cliente: ${calc.proyecto?.cliente || '—'} · Fecha del corte: ${fechaCC(corte.fecha)}${corte.estado === 'CERRADO' ? '' : ' · BORRADOR'}`;
    ws.getCell('B3').font = { size: 10, color: { argb: 'FFCEC5BA' } };
  };
  const encabezado = (ws, titulos) => {
    const r = ws.addRow(titulos);
    r.eachCell((c) => { relleno(c, C); c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
    r.height = 30;
    return r;
  };
  const seccion = (ws, t) => { ws.addRow([]); const r = ws.addRow([t]); r.getCell(1).font = { bold: true, size: 12 }; r.getCell(1).border = { bottom: { style: 'thin', color: { argb: D } } }; };

  // ===== Hoja 1: RESUMEN =====
  const ws = wb.addWorksheet(corte.es_final ? 'LIQUIDACION' : 'RESUMEN', { views: [{ showGridLines: false, state: 'frozen', ySplit: 0 }] });
  // A cód · B nombre · C contratado · D.. cortes · acumulado · avance · por ejecutar
  const cCont = 3, cCorte = (k) => 4 + k, cAcum = 4 + nC, cAv = cAcum + 1, cSal = cAcum + 2, nCols = cSal;
  [9, 48, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let k = 0; k < nC; k++) ws.getColumn(cCorte(k)).width = 15;
  ws.getColumn(cAcum).width = 16; ws.getColumn(cAv).width = 9; ws.getColumn(cSal).width = 16;
  cabecera(ws, nCols, 'Resumen');
  seccion(ws, 'RESUMEN POR CAPÍTULO');
  encabezado(ws, ['Cap.', 'Capítulo', 'Contratado', ...cortes.map((n) => `Corte ${n}${n === corte.numero ? ' (este)' : ''}`), 'Acumulado', '% avance', 'Por ejecutar']);
  const filaValores = (r, contratado, porCorte, acumulado, { item = false } = {}) => {
    const n = r.number;
    r.getCell(cCont).value = contratado;
    porCorte.forEach((v, k) => { r.getCell(cCorte(k)).value = v || 0; });
    r.getCell(cAcum).value = { formula: `SUM(${colL(cCorte(0))}${n}:${colL(cCorte(nC - 1))}${n})`, result: acumulado };
    r.getCell(cAv).value = { formula: `IF(${colL(cCont)}${n}=0,0,${colL(cAcum)}${n}/${colL(cCont)}${n})`, result: contratado ? acumulado / contratado : 0 };
    r.getCell(cSal).value = { formula: `${colL(cCont)}${n}-${colL(cAcum)}${n}`, result: contratado - acumulado };
    for (let j = cCont; j <= cSal; j++) r.getCell(j).numFmt = moneda;
    r.getCell(cAv).numFmt = '0.0%';
    if (kAct >= 0) relleno(r.getCell(cCorte(kAct)), CAFE);
    if (item) r.eachCell((cell) => { cell.font = { size: 9, color: { argb: 'FF6B655D' } }; });
    r.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9D4CC' } } }; });
  };
  const filasSubtotal = [];
  calc.grupos.forEach((g) => {
    const t = ws.addRow([g.titulo.toUpperCase()]);
    t.getCell(1).font = { bold: true, color: { argb: 'FF6B4A22' } };
    for (let i = 1; i <= nCols; i++) relleno(t.getCell(i), H);
    const filasCap = [];
    g.capitulos.forEach((c) => {
      const r = ws.addRow([c.codigo, `${c.nombre}${c.modo === 'GLOBAL' ? ' (global por %)' : ''}`]);
      filaValores(r, c.contratado, c.porCorte.map((h) => h.valor), c.acumulado);
      r.getCell(2).font = { bold: true };
      filasCap.push(r.number);
      // Opción A: los ADICIONALES conservan su detalle ítem por ítem en la hoja principal.
      if ((g.clave === 'ADICIONAL_COSTO' || g.clave === 'PAGO_DIRECTO_CLIENTE') && c.modo === 'CANTIDAD') {
        c.items.forEach((it) => {
          const ri = ws.addRow([it.codigo, `   ${it.descripcion}${it.unidad ? ` (${cantCC(it.acumulado)} de ${cantCC(it.contratado)} ${it.unidad})` : ''}`]);
          filaValores(ri, Number(it.valor_contratado), it.porCorte.map((h) => h.valor), it.valor_acumulado, { item: true });
          ri.getCell(2).alignment = { wrapText: true, vertical: 'top' };
        });
      }
    });
    const s = ws.addRow(['', `Subtotal ${g.titulo.toLowerCase()}`]);
    const suma = (col) => filasCap.map((n) => `${colL(col)}${n}`).join('+') || '0';
    s.getCell(cCont).value = { formula: suma(cCont), result: g.contratado };
    g.porCorte.forEach((h, k) => { s.getCell(cCorte(k)).value = { formula: suma(cCorte(k)), result: h.valor }; });
    s.getCell(cAcum).value = { formula: suma(cAcum), result: g.acumulado };
    s.getCell(cAv).value = { formula: `IF(${colL(cCont)}${s.number}=0,0,${colL(cAcum)}${s.number}/${colL(cCont)}${s.number})`, result: g.contratado ? g.acumulado / g.contratado : 0 };
    s.getCell(cSal).value = { formula: `${colL(cCont)}${s.number}-${colL(cAcum)}${s.number}`, result: g.contratado - g.acumulado };
    for (let j = cCont; j <= cSal; j++) s.getCell(j).numFmt = moneda;
    s.getCell(cAv).numFmt = '0.0%';
    s.eachCell((cell) => { cell.font = { bold: true }; relleno(cell, G); });
    if (g.suma) filasSubtotal.push(s.number);
  });
  const tot = ws.addRow(['', 'TOTAL LIQUIDADO (contrato + adicionales)']);
  const sumaT = (col) => filasSubtotal.map((n) => `${colL(col)}${n}`).join('+') || '0';
  tot.getCell(cCont).value = { formula: sumaT(cCont), result: calc.tot.contratado };
  calc.tot.porCorte.forEach((h, k) => { tot.getCell(cCorte(k)).value = { formula: sumaT(cCorte(k)), result: h.valor }; });
  tot.getCell(cAcum).value = { formula: sumaT(cAcum), result: calc.tot.acumulado };
  tot.getCell(cAv).value = { formula: `IF(${colL(cCont)}${tot.number}=0,0,${colL(cAcum)}${tot.number}/${colL(cCont)}${tot.number})`, result: calc.tot.contratado ? calc.tot.acumulado / calc.tot.contratado : 0 };
  tot.getCell(cSal).value = { formula: `${colL(cCont)}${tot.number}-${colL(cAcum)}${tot.number}`, result: calc.tot.contratado - calc.tot.acumulado };
  for (let j = cCont; j <= cSal; j++) tot.getCell(j).numFmt = moneda;
  tot.getCell(cAv).numFmt = '0.0%';
  tot.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; relleno(cell, C); });
  const filaTotal = tot.number;

  // Pagos del cliente y saldo
  seccion(ws, 'PAGOS DEL CLIENTE (registrados en Caja hasta la fecha del corte)');
  const encP = ws.addRow(['Fecha', 'Concepto', 'Valor']);
  encP.eachCell((c) => { relleno(c, C); c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 }; });
  const iniP = ws.rowCount + 1;
  (calc.pagos || []).forEach((p) => {
    const r = ws.addRow([fechaCC(p.fecha), p.concepto, Number(p.valor)]);
    r.getCell(3).numFmt = moneda;
    r.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9D4CC' } } }; });
  });
  const finP = Math.max(iniP, ws.rowCount);
  ws.addRow([]);
  const filaPag = ws.rowCount + 2;
  [
    ['TOTAL LIQUIDADO ACUMULADO', { formula: `${colL(cAcum)}${filaTotal}`, result: calc.tot.acumulado }, H, C],
    ['(−) PAGOS RECIBIDOS DEL CLIENTE', { formula: (calc.pagos || []).length ? `SUM(C${iniP}:C${finP})` : '0', result: calc.tot.pagos }, 'FFE6F2E6', 'FF1E6B2E'],
    [calc.tot.saldo >= 0 ? 'SALDO A PAGAR POR EL CLIENTE' : 'SALDO A FAVOR DEL CLIENTE', { formula: `C${filaPag - 1}-C${filaPag}`, result: calc.tot.saldo }, C, 'FFFFFFFF'],
  ].forEach(([etq, val, fondo, color]) => {
    const r = ws.addRow(['', etq, val]);
    r.getCell(3).numFmt = moneda;
    [2, 3].forEach((j) => { const c = r.getCell(j); relleno(c, fondo); c.font = { bold: true, color: { argb: color } }; });
  });
  const info = calc.grupos.find((g) => !g.suma);
  if (info) {
    ws.addRow([]);
    const r = ws.addRow(['', `Pagos directos del cliente (informativo, no suma al total): ${formatoPesos(Math.round(info.acumulado))}`]);
    r.getCell(2).font = { italic: true, color: { argb: 'FF6B655D' } };
  }
  if (corte.notas) { ws.addRow([]); ws.addRow(['', `Observaciones: ${corte.notas}`]).getCell(2).alignment = { wrapText: true }; }

  // ===== Hoja 2: DETALLE POR CANTIDADES (solo el contrato; los adicionales y pagos directos van detallados en el resumen) =====
  const capsCant = calc.capitulos.filter((c) => c.grupo === 'CONTRATO' && c.items.length);
  if (capsCant.length) {
    const wd = wb.addWorksheet('DETALLE POR CANTIDADES', { views: [{ showGridLines: false }] });
    // A ítem · B descripción · C und · D cant. contratada · E vr unit · F valor contratado · por corte (cant, valor) · acum cant · acum valor · avance
    const dQ = (k) => 7 + 2 * k, dV = (k) => 8 + 2 * k, dAQ = 7 + 2 * nC, dAV = dAQ + 1, dAv = dAQ + 2, nD = dAv;
    [9, 46, 6, 11, 14, 16].forEach((w, i) => { wd.getColumn(i + 1).width = w; });
    for (let k = 0; k < nC; k++) { wd.getColumn(dQ(k)).width = 10; wd.getColumn(dV(k)).width = 15; }
    wd.getColumn(dAQ).width = 11; wd.getColumn(dAV).width = 16; wd.getColumn(dAv).width = 9;
    cabecera(wd, nD, 'Detalle por cantidades');
    wd.addRow([]);
    encabezado(wd, ['Ítem', 'Descripción', 'Und', 'Cant. contratada', 'Vr. unitario', 'Valor contratado',
      ...cortes.flatMap((n) => [`Corte ${n} cant.`, `Corte ${n} valor`]), 'Cant. acumulada', 'Valor acumulado', '% avance']);
    capsCant.forEach((c) => {
      const t = wd.addRow([c.codigo, c.nombre + (c.modo === 'GLOBAL' ? ' (global por %: cantidades en proporción al avance del capítulo)' : '')]);
      for (let i = 1; i <= nD; i++) { relleno(t.getCell(i), H); t.getCell(i).font = { bold: true }; }
      c.items.forEach((it) => {
        const r = wd.addRow([it.codigo, it.descripcion, it.unidad || '', Number(it.contratado), Number(it.valor_unitario), Number(it.valor_contratado)]);
        const n = r.number;
        it.porCorte.forEach((h, k) => { r.getCell(dQ(k)).value = h.cantidad || 0; r.getCell(dV(k)).value = h.valor || 0; });
        r.getCell(dAQ).value = { formula: Array.from({ length: nC }, (_, k) => `${colL(dQ(k))}${n}`).join('+'), result: it.acumulado };
        r.getCell(dAV).value = { formula: Array.from({ length: nC }, (_, k) => `${colL(dV(k))}${n}`).join('+'), result: it.valor_acumulado };
        r.getCell(dAv).value = { formula: `IF(D${n}=0,0,${colL(dAQ)}${n}/D${n})`, result: Number(it.contratado) ? it.acumulado / Number(it.contratado) : 0 };
        [4, dAQ, ...Array.from({ length: nC }, (_, k) => dQ(k))].forEach((j) => { r.getCell(j).numFmt = '#,##0.00'; });
        [5, 6, dAV, ...Array.from({ length: nC }, (_, k) => dV(k))].forEach((j) => { r.getCell(j).numFmt = moneda; });
        r.getCell(dAv).numFmt = '0.0%';
        r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
        if (kAct >= 0) { relleno(r.getCell(dQ(kAct)), CAFE); relleno(r.getCell(dV(kAct)), CAFE); }
        if (it.excede) r.getCell(dAQ).font = { bold: true, color: { argb: 'FF9B2C2C' } };
        r.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9D4CC' } } }; });
      });
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `${corte.es_final ? 'Liquidacion final' : `Corte cliente ${corte.numero}`} - ${proyecto?.nombre || ''}.xlsx`;
  a.click(); URL.revokeObjectURL(url);
}
