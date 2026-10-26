// ============================================================
// Cortes de cobro / liquidación al CLIENTE (todo costo) — 057.
// La verdad de los valores vive en SQL (corte_cliente_detalle). Aquí solo se replica el
// mismo cálculo para mostrar en vivo lo que el admin va escribiendo antes de guardar.
// ============================================================

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
    // Cortes liquidados por % global (073/074): para el detalle, en esos cortes cada ítem avanza en la misma
    // proporción del capítulo (cantidad = contratada × % del corte; el valor del corte se reparte según el valor de
    // cada ítem y el redondeo va al ítem mayor). Los cortes por cantidades conservan sus cantidades medidas.
    const modoDe = (n) => (n === numActual ? modo : ((c.historia || []).find((h) => h.numero === n)?.modo || c.modo));
    if (itemsH.length && num(c.contratado) > 0 && porCorte.some((h) => modoDe(h.numero) === 'GLOBAL')) {
      const mayor = itemsH.reduce((m, it, j) => (num(it.valor_contratado) > num(itemsH[m].valor_contratado) ? j : m), 0);
      porCorte.forEach((h, k) => {
        if (modoDe(h.numero) !== 'GLOBAL') return;
        const f = h.valor / num(c.contratado);
        const vals = itemsH.map((it) => Math.round(num(it.valor_contratado) * f));
        vals[mayor] += h.valor - vals.reduce((a, v) => a + v, 0);
        itemsH.forEach((it, j) => {
          it.porCorte = it.porCorte.map((x, kk) => (kk === k ? { numero: h.numero, cantidad: num(it.contratado) * f, valor: vals[j], proporcional: true } : x));
        });
      });
      itemsH.forEach((it) => {
        const act = it.porCorte.find((h) => h.numero === numActual) || { cantidad: 0, valor: 0 };
        it.acumulado = it.porCorte.reduce((a, h) => a + num(h.cantidad), 0);
        it.valor_acumulado = it.porCorte.reduce((a, h) => a + num(h.valor), 0);
        it.anterior = it.acumulado - num(act.cantidad); it.valor_anterior = it.valor_acumulado - num(act.valor);
        if (modo === 'GLOBAL') { it.este = act.cantidad; it.valor_este = act.valor; it.excede = false; it.proporcional = true; }
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
// 074: hoja principal CONTROL DE CORTES con la misma estructura del control presupuestal de administración delegada
// (lib/exportarControlPresupuestal.js): todos los ítems, un bloque Cantidad · Vr unitario · Vr parcial por cada corte,
// el acumulado y el avance; al final contrato, adicionales, total, pagos del cliente y saldo. (Una sola hoja.)
const colL = (n) => { let x = ''; let k = n; while (k > 0) { const m = (k - 1) % 26; x = String.fromCharCode(65 + m) + x; k = Math.floor((k - 1) / 26); } return x; };

export async function exportarCorteClienteExcel(calc, proyecto) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const corte = calc.corte;
  const C = 'FF2E2E2E', D = 'FFB88A52', G = 'FFCEC5BA', H = 'FFEFECE6', CAFE = 'FFF3E9DC';
  const cortes = calc.numerosCortes?.length ? calc.numerosCortes : [corte.numero];
  const nC = cortes.length;
  const kAct = cortes.indexOf(corte.numero);
  const relleno = (c, argb) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };
  // ===== Hoja 1: CONTROL DE CORTES (réplica de la estructura del control presupuestal de administración delegada) =====
  {
    const BF = { style: 'thin', color: { argb: 'FFB9AFA0' } };
    const DC = 'FFF0E2D0';
    const QF = '#,##0.00;-#,##0.00;"-"';
    const VF = '#,##0;-#,##0;"-"';
    const est = (cell, { b = false, f, col, al = 'right', fmt } = {}) => {
      cell.font = { bold: b, size: 10, color: col ? { argb: col } : undefined };
      cell.alignment = { horizontal: al, vertical: 'middle', wrapText: al === 'left' };
      cell.border = { top: BF, bottom: BF, left: BF, right: BF };
      if (f) relleno(cell, f);
      if (fmt) cell.numFmt = fmt;
    };
    const wc = wb.addWorksheet(corte.es_final ? 'LIQUIDACION' : `CORTE ${corte.numero}`, { views: [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 5 }] });
    const bQ = (k) => 8 + 4 * k; // cantidad del corte k (columna 7 + 4k es el separador)
    const aQ = 8 + 4 * nC; const aV = aQ + 2; const pE = aV + 2; const pX = pE + 1; const nT = pX;
    [10, 44, 8, 11, 14, 15].forEach((w, i) => { wc.getColumn(i + 1).width = w; });
    for (let k = 0; k <= nC; k++) { wc.getColumn(7 + 4 * k).width = 2; wc.getColumn(8 + 4 * k).width = 11; wc.getColumn(9 + 4 * k).width = 14; wc.getColumn(10 + 4 * k).width = 15; }
    wc.getColumn(pE - 1).width = 2; wc.getColumn(pE).width = 10; wc.getColumn(pX).width = 15;
    wc.mergeCells(1, 1, 1, nT);
    const t1 = wc.getCell(1, 1);
    t1.value = `HABITATUM · ${corte.es_final ? 'LIQUIDACIÓN FINAL DE OBRA' : 'CORTE DE OBRA AL CLIENTE'} — ${proyecto?.nombre || calc.proyecto?.nombre || ''}`;
    t1.font = { bold: true, size: 14, color: { argb: H } }; t1.alignment = { horizontal: 'center', vertical: 'middle' }; relleno(t1, C);
    wc.getRow(1).height = 26;
    wc.mergeCells(2, 1, 2, nT);
    const t2 = wc.getCell(2, 1);
    t2.value = `${tituloCorte(corte)} — al ${fechaCC(corte.fecha)} · Cliente: ${calc.proyecto?.cliente || '—'}${corte.estado === 'CERRADO' ? '' : ' · BORRADOR'}`;
    t2.font = { italic: true, size: 10, color: { argb: C } }; t2.alignment = { horizontal: 'center' };
    // Encabezados (filas 4 y 5)
    ['ÍTEM', 'DESCRIPCIÓN', 'UNIDAD', 'CANTIDAD', 'VR UNITARIO', 'VR PARCIAL'].forEach((t, i) => {
      wc.mergeCells(4, i + 1, 5, i + 1);
      const cell = wc.getCell(4, i + 1); cell.value = t;
      est(cell, { b: true, f: D, col: H, al: i <= 1 ? 'left' : 'center' });
    });
    const bloque = (c0, titulo, fGrupo, fSub, colSub) => {
      wc.mergeCells(4, c0, 4, c0 + 2);
      const g = wc.getCell(4, c0); g.value = titulo; est(g, { b: true, f: fGrupo, col: H, al: 'center' });
      ['CANTIDAD', 'VR UNITARIO', 'VR PARCIAL'].forEach((t, i) => { const cell = wc.getCell(5, c0 + i); cell.value = t; est(cell, { b: true, f: fSub, col: colSub, al: 'center' }); });
    };
    const fechaDe = (n) => (calc.cortes || []).find((x) => x.numero === n)?.fecha;
    cortes.forEach((n, k) => bloque(bQ(k), `CORTE ${n}${fechaDe(n) ? ` · ${fechaCC(fechaDe(n))}` : ''}${n === corte.numero && corte.estado !== 'CERRADO' ? ' (BORRADOR)' : ''}`, C, G, C));
    bloque(aQ, 'TOTAL EJECUTADO (acumulado)', D, D, H);
    wc.mergeCells(4, pE, 4, pX);
    const av = wc.getCell(4, pE); av.value = 'AVANCE'; est(av, { b: true, f: C, col: H, al: 'center' });
    ['% EJEC.', 'POR EJECUTAR'].forEach((t, i) => { const cell = wc.getCell(5, pE + i); cell.value = t; est(cell, { b: true, f: G, col: C, al: 'center' }); });
    wc.getRow(4).height = 28;

    let f = 6;
    const filasPorGrupo = {}; // clave de grupo → lista de rangos de ítems [ini, fin]
    const sumaRangos = (rangos, col) => (rangos.length ? rangos.map(([a, b]) => `SUM(${colL(col)}${a}:${colL(col)}${b})`).join('+') : '0');
    const pctFila = (fila) => ({ formula: `IFERROR(IF(F${fila}>0,${colL(aV)}${fila}/F${fila},""),"")` });
    calc.grupos.forEach((g) => {
      filasPorGrupo[g.clave] = [];
      g.capitulos.forEach((c) => {
        const fc = f;
        wc.mergeCells(fc, 1, fc, 2);
        const cc = wc.getCell(fc, 1);
        cc.value = `${c.codigo} ${c.nombre}${c.modo === 'GLOBAL' ? ' · global por %' : ''}${g.suma ? '' : ' (informativo, no suma)'}`;
        est(cc, { b: true, f: G, col: C, al: 'left' });
        [3, 4, 5].forEach((j) => est(wc.getCell(fc, j), { b: true, f: G }));
        est(wc.getCell(fc, 6), { b: true, f: G, fmt: VF }); wc.getCell(fc, 6).value = Number(c.contratado) || 0;
        f++;
        const ini = f;
        c.items.forEach((it) => {
          const vals = [it.codigo, it.descripcion, it.unidad || '', Number(it.contratado) || 0, Number(it.valor_unitario) || 0, Number(it.valor_contratado) || 0];
          vals.forEach((v, i) => { const cell = wc.getCell(f, i + 1); cell.value = v; est(cell, { al: i <= 1 ? 'left' : (i === 2 ? 'center' : 'right'), fmt: i === 3 ? QF : (i >= 4 ? VF : undefined) }); });
          cortes.forEach((n, k) => {
            const h = it.porCorte[k] || { cantidad: 0, valor: 0 };
            const q = Number(h.cantidad) || 0; const v = Number(h.valor) || 0;
            const cq = wc.getCell(f, bQ(k)); cq.value = q;
            const cu = wc.getCell(f, bQ(k) + 1); cu.value = { formula: `IFERROR(${colL(bQ(k) + 2)}${f}/${colL(bQ(k))}${f},"")`, result: q ? v / q : '' };
            const cv = wc.getCell(f, bQ(k) + 2); cv.value = v;
            const fondo = k === kAct ? CAFE : undefined;
            est(cq, { f: fondo, fmt: QF }); est(cu, { f: fondo, fmt: VF }); est(cv, { f: fondo, fmt: VF });
          });
          const sumQ = cortes.map((n, k) => `${colL(bQ(k))}${f}`).join('+');
          const sumV = cortes.map((n, k) => `${colL(bQ(k) + 2)}${f}`).join('+');
          const accQ = Number(it.acumulado) || 0; const accV = Number(it.valor_acumulado) || 0;
          wc.getCell(f, aQ).value = { formula: sumQ, result: accQ };
          wc.getCell(f, aQ + 1).value = { formula: `IFERROR(${colL(aV)}${f}/${colL(aQ)}${f},"")`, result: accQ ? accV / accQ : '' };
          wc.getCell(f, aV).value = { formula: sumV, result: accV };
          est(wc.getCell(f, aQ), { f: DC, fmt: QF }); est(wc.getCell(f, aQ + 1), { f: DC, fmt: VF }); est(wc.getCell(f, aV), { f: DC, fmt: VF });
          if (it.excede) wc.getCell(f, aQ).font = { bold: true, size: 10, color: { argb: 'FF9B2C2C' } };
          wc.getCell(f, pE).value = { ...pctFila(f), result: Number(it.valor_contratado) > 0 ? accV / Number(it.valor_contratado) : '' };
          wc.getCell(f, pX).value = { formula: `F${f}-${colL(aV)}${f}`, result: (Number(it.valor_contratado) || 0) - accV };
          est(wc.getCell(f, pE), { fmt: '0.0%' }); est(wc.getCell(f, pX), { fmt: VF });
          f++;
        });
        const fin = f - 1;
        if (fin >= ini) filasPorGrupo[g.clave].push([ini, fin]);
        // Fila del capítulo: valor de cada corte = suma de SUS ítems; en capítulos globales, el % del corte va en Cantidad.
        cortes.forEach((n, k) => {
          const h = c.porCorte[k] || { valor: 0, pct: 0 };
          const cq = wc.getCell(fc, bQ(k));
          if (c.modo === 'GLOBAL' || (c.historia || []).find((x) => x.numero === n)?.modo === 'GLOBAL') { cq.value = (Number(h.pct) || 0) / 100; est(cq, { b: true, f: G, fmt: '0.0%;-0.0%;"-"' }); } else est(cq, { f: G });
          est(wc.getCell(fc, bQ(k) + 1), { f: G });
          const cv = wc.getCell(fc, bQ(k) + 2);
          cv.value = fin >= ini ? { formula: `SUM(${colL(bQ(k) + 2)}${ini}:${colL(bQ(k) + 2)}${fin})`, result: h.valor } : h.valor;
          est(cv, { b: true, f: G, fmt: VF });
        });
        est(wc.getCell(fc, aQ), { f: DC }); est(wc.getCell(fc, aQ + 1), { f: DC });
        wc.getCell(fc, aV).value = { formula: cortes.map((n, k) => `${colL(bQ(k) + 2)}${fc}`).join('+'), result: c.acumulado };
        est(wc.getCell(fc, aV), { b: true, f: DC, fmt: VF });
        wc.getCell(fc, pE).value = { ...pctFila(fc), result: Number(c.contratado) > 0 ? c.acumulado / Number(c.contratado) : '' };
        wc.getCell(fc, pX).value = { formula: `F${fc}-${colL(aV)}${fc}`, result: (Number(c.contratado) || 0) - c.acumulado };
        est(wc.getCell(fc, pE), { b: true, f: G, fmt: '0.0%' }); est(wc.getCell(fc, pX), { b: true, f: G, fmt: VF });
      });
    });

    // ---------- Totales (contrato, adicionales, total del corte, pagos del cliente y saldo) ----------
    f++;
    const filaTot = (etq, { base, porCorte, acum, formula, fondo = D, color = H }) => {
      wc.mergeCells(f, 1, f, 5);
      const e = wc.getCell(f, 1); e.value = etq; est(e, { b: true, f: fondo, col: color, al: 'left' });
      const cb = wc.getCell(f, 6);
      if (base !== undefined) cb.value = formula ? { formula: formula(6), result: base } : base;
      est(cb, { b: true, f: fondo, col: color, fmt: VF });
      if (porCorte) cortes.forEach((n, k) => {
        const cv = wc.getCell(f, bQ(k) + 2);
        cv.value = formula ? { formula: formula(bQ(k) + 2), result: porCorte[k] } : porCorte[k];
        est(cv, { b: true, f: fondo, col: color, fmt: VF });
      });
      const ca = wc.getCell(f, aV);
      ca.value = porCorte ? { formula: cortes.map((n, k) => `${colL(bQ(k) + 2)}${f}`).join('+'), result: acum } : (formula ? { formula: formula(aV), result: acum } : acum);
      est(ca, { b: true, f: fondo, col: color, fmt: VF });
      if (base !== undefined && base) {
        wc.getCell(f, pE).value = { ...pctFila(f), result: acum / base };
        wc.getCell(f, pX).value = { formula: `F${f}-${colL(aV)}${f}`, result: base - acum };
        est(wc.getCell(f, pE), { b: true, f: fondo, col: color, fmt: '0.0%' }); est(wc.getCell(f, pX), { b: true, f: fondo, col: color, fmt: VF });
      }
      return f++;
    };
    const filasSuma = [];
    calc.grupos.forEach((g) => {
      const rangos = filasPorGrupo[g.clave] || [];
      const fila = filaTot(`TOTAL ${g.titulo.toUpperCase()}${g.suma ? '' : ' (informativo, no suma)'}`, {
        base: g.contratado, porCorte: g.porCorte.map((h) => h.valor), acum: g.acumulado,
        formula: (col) => sumaRangos(rangos, col), fondo: g.suma ? G : H, color: C,
      });
      if (g.suma) filasSuma.push(fila);
    });
    const filaTotal = filaTot(`VALOR TOTAL ${corte.es_final ? 'LIQUIDADO' : 'DEL CORTE'} (contrato + adicionales)`, {
      base: calc.tot.contratado, porCorte: calc.tot.porCorte.map((h) => h.valor), acum: calc.tot.acumulado,
      formula: (col) => filasSuma.map((x) => `${colL(col)}${x}`).join('+') || '0', fondo: D, color: H,
    });
    // Pagos del cliente y saldo: van en la columna del acumulado (los pagos no se reparten por corte).
    const iniPag = f + 4;
    const nPag = (calc.pagos || []).length;
    const filaPagos = filaTot('(−) PAGOS RECIBIDOS DEL CLIENTE (ver detalle abajo)', { porCorte: null, acum: calc.tot.pagos, formula: () => (nPag ? `SUM(F${iniPag}:F${iniPag + nPag - 1})` : '0'), fondo: 'FFE6F2E6', color: 'FF1E6B2E' });
    const fs = f;
    wc.mergeCells(fs, 1, fs, 5);
    const es = wc.getCell(fs, 1); es.value = calc.tot.saldo >= 0 ? 'SALDO A PAGAR POR EL CLIENTE' : 'SALDO A FAVOR DEL CLIENTE';
    est(es, { b: true, f: C, col: H, al: 'left' });
    const sa = wc.getCell(fs, aV);
    sa.value = { formula: `${colL(aV)}${filaTotal}-${colL(aV)}${filaPagos}`, result: calc.tot.saldo };
    est(sa, { b: true, f: C, col: H, fmt: VF });
    f += 2;
    // Detalle de pagos
    wc.mergeCells(f, 1, f, 6);
    const tp = wc.getCell(f, 1); tp.value = 'PAGOS RECIBIDOS DEL CLIENTE (registrados en Caja hasta la fecha del corte)'; est(tp, { b: true, f: G, col: C, al: 'left' });
    f++;
    (calc.pagos || []).forEach((p) => {
      wc.getCell(f, 1).value = fechaCC(p.fecha); est(wc.getCell(f, 1), { al: 'left' });
      wc.mergeCells(f, 2, f, 5); wc.getCell(f, 2).value = p.concepto || ''; est(wc.getCell(f, 2), { al: 'left' });
      wc.getCell(f, 6).value = Number(p.valor) || 0; est(wc.getCell(f, 6), { fmt: VF });
      f++;
    });
    if (corte.notas) { f++; wc.mergeCells(f, 1, f, 6); wc.getCell(f, 1).value = `Observaciones: ${corte.notas}`; wc.getCell(f, 1).alignment = { wrapText: true }; }
    f += 2;
    wc.getCell(f, 2).value = `HABITATUM · Documento generado desde la plataforma el ${new Date().toLocaleString('es-CO')}. En los capítulos globales por %, las cantidades de cada ítem son proporcionales al avance del capítulo en ese corte.`;
    wc.getCell(f, 2).font = { size: 8, italic: true, color: { argb: 'FF6B655D' } };
    wc.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `${corte.es_final ? 'Liquidacion final' : `Corte cliente ${corte.numero}`} - ${proyecto?.nombre || ''}.xlsx`;
  a.click(); URL.revokeObjectURL(url);
}
