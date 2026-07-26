'use client';
import ExcelJS from 'exceljs';

const COLOR_ENCABEZADO = 'FF1F2937'; // carbon
const COLOR_TEXTO_ENCABEZADO = 'FFFFFFFF';
const COLOR_CAPITULO = 'FFE5E7EB';
const COLOR_TOTAL = 'FFFDE68A'; // dorado suave
const BORDE_FINO = { style: 'thin', color: { argb: 'FFD1D5DB' } };

function estilizarCelda(celda, { negrita = false, relleno, alineacion = 'right', numero = true, tamano } = {}) {
  celda.font = { bold: negrita, color: relleno ? { argb: '000000' } : undefined, size: tamano };
  celda.alignment = { horizontal: alineacion, vertical: 'middle' };
  celda.border = { top: BORDE_FINO, bottom: BORDE_FINO, left: BORDE_FINO, right: BORDE_FINO };
  if (relleno) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: relleno } };
  if (numero) celda.numFmt = '#,##0';
}

// Construye y descarga el Excel de Control Presupuestal por cortes, replicando
// el formato de referencia: columnas base del presupuesto + un bloque de 3
// columnas (Cantidad / Vr Unitario / Vr Parcial) por cada corte cerrado hasta
// el elegido + un bloque de Total acumulado + totales generales. Incluye
// además una hoja de detalle por corte con las Órdenes de Compra que lo
// componen.
export async function exportarControlPresupuestal({ proyecto, presupuesto, capitulos, cortes, hastaNumero }) {
  const cortesAIncluir = cortes.filter((c) => c.numero <= hastaNumero).sort((a, b) => a.numero - b.numero);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HABITATUM';
  workbook.created = new Date();

  const hoja = workbook.addWorksheet('CONTROL PPTAL');

  // ---------- Columnas ----------
  // A-F: base del presupuesto. Luego 3 columnas por corte + 1 de separación,
  // luego 3 columnas de Total acumulado.
  const columnasBase = [
    { header: 'ÍTEM', key: 'codigo', width: 10 },
    { header: 'DESCRIPCIÓN', key: 'descripcion', width: 42 },
    { header: 'UNIDAD', key: 'unidad', width: 8 },
    { header: 'CANTIDAD', key: 'cantidad', width: 11 },
    { header: 'VR UNITARIO', key: 'vr_unitario', width: 14 },
    { header: 'VR PARCIAL', key: 'vr_parcial', width: 15 },
  ];
  const columnas = [...columnasBase];
  cortesAIncluir.forEach((c) => {
    columnas.push({ width: 2 }); // separación
    columnas.push({ width: 11 }); // cantidad
    columnas.push({ width: 14 }); // vr unitario
    columnas.push({ width: 15 }); // vr parcial
  });
  columnas.push({ width: 2 });
  columnas.push({ width: 11 });
  columnas.push({ width: 14 });
  columnas.push({ width: 15 });
  hoja.columns = columnas;

  // ---------- Encabezado de proyecto ----------
  const totalColumnas = columnas.length;
  hoja.mergeCells(1, 1, 1, totalColumnas);
  const tituloCelda = hoja.getCell(1, 1);
  tituloCelda.value = `HABITATUM · CONTROL PRESUPUESTAL — ${proyecto?.nombre || ''}`;
  tituloCelda.font = { bold: true, size: 14, color: { argb: COLOR_TEXTO_ENCABEZADO } };
  tituloCelda.alignment = { horizontal: 'center', vertical: 'middle' };
  tituloCelda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
  hoja.getRow(1).height = 26;

  hoja.mergeCells(2, 1, 2, totalColumnas);
  const subtituloCelda = hoja.getCell(2, 1);
  const fechaCorteFinal = cortesAIncluir[cortesAIncluir.length - 1]?.fecha_hasta;
  subtituloCelda.value = `Corte ${hastaNumero} — al ${fechaCorteFinal || ''}`;
  subtituloCelda.font = { italic: true, size: 10 };
  subtituloCelda.alignment = { horizontal: 'center' };

  // ---------- Filas de encabezado de columnas (2 filas: grupo de corte + sub-encabezado) ----------
  const filaGrupo = 4;
  const filaSub = 5;
  columnasBase.forEach((c, i) => {
    hoja.mergeCells(filaGrupo, i + 1, filaSub, i + 1);
    const celda = hoja.getCell(filaGrupo, i + 1);
    celda.value = c.header;
    estilizarCelda(celda, { negrita: true, relleno: 'FFD1D5DB', numero: false, alineacion: i <= 1 ? 'left' : 'center' });
  });

  let colActual = columnasBase.length + 1;
  cortesAIncluir.forEach((c) => {
    colActual += 1; // salta columna de separación
    hoja.mergeCells(filaGrupo, colActual, filaGrupo, colActual + 2);
    const celdaGrupo = hoja.getCell(filaGrupo, colActual);
    celdaGrupo.value = `CONTROL PRESUPUESTAL ${c.numero}`;
    estilizarCelda(celdaGrupo, { negrita: true, relleno: 'FFBFDBFE', numero: false, alineacion: 'center' });
    ['CANTIDAD', 'VR UNITARIO', 'VR PARCIAL'].forEach((titulo, j) => {
      const celda = hoja.getCell(filaSub, colActual + j);
      celda.value = titulo;
      estilizarCelda(celda, { negrita: true, relleno: 'FFDBEAFE', numero: false, alineacion: 'center' });
    });
    colActual += 3;
  });
  colActual += 1;
  hoja.mergeCells(filaGrupo, colActual, filaGrupo, colActual + 2);
  const celdaTotalGrupo = hoja.getCell(filaGrupo, colActual);
  celdaTotalGrupo.value = 'TOTAL COSTOS DE OBRA (acumulado)';
  estilizarCelda(celdaTotalGrupo, { negrita: true, relleno: COLOR_TOTAL, numero: false, alineacion: 'center' });
  ['CANTIDAD', 'VR UNITARIO', 'VR PARCIAL'].forEach((titulo, j) => {
    const celda = hoja.getCell(filaSub, colActual + j);
    celda.value = titulo;
    estilizarCelda(celda, { negrita: true, relleno: COLOR_TOTAL, numero: false, alineacion: 'center' });
  });

  // ---------- Filas de capítulos / ítems ----------
  let fila = filaSub + 1;
  let sumaDirecto = 0;
  let sumaIndirecto = 0;

  capitulos.forEach((cap) => {
    hoja.mergeCells(fila, 1, fila, 2);
    const celdaCap = hoja.getCell(fila, 1);
    celdaCap.value = `${cap.codigo}  ${cap.nombre}`;
    estilizarCelda(celdaCap, { negrita: true, relleno: COLOR_CAPITULO, numero: false, alineacion: 'left' });
    const celdaVacia = hoja.getCell(fila, 2); estilizarCelda(celdaVacia, { relleno: COLOR_CAPITULO, numero: false });
    [3, 4, 5, 6].forEach((c) => { const cc = hoja.getCell(fila, c); estilizarCelda(cc, { relleno: COLOR_CAPITULO, numero: false }); });
    hoja.getCell(fila, 6).value = Number(cap.valor_presupuestado || 0);
    hoja.getCell(fila, 6).numFmt = '#,##0';

    let colCorte = columnasBase.length + 1;
    let acumCantCap = 0;
    let acumValCap = 0;
    cortesAIncluir.forEach((c) => {
      colCorte += 1;
      const cant = c._capCantidad?.[cap.id] || 0;
      const val = c._capValor?.[cap.id] || 0;
      acumCantCap += cant; acumValCap += val;
      [colCorte, colCorte + 1, colCorte + 2].forEach((cc) => { const celda = hoja.getCell(fila, cc); estilizarCelda(celda, { relleno: COLOR_CAPITULO, numero: false }); });
      hoja.getCell(fila, colCorte + 2).value = val;
      hoja.getCell(fila, colCorte + 2).numFmt = '#,##0';
      colCorte += 3;
    });
    colCorte += 1;
    [colCorte, colCorte + 1, colCorte + 2].forEach((cc) => { const celda = hoja.getCell(fila, cc); estilizarCelda(celda, { relleno: COLOR_TOTAL, numero: false }); });
    hoja.getCell(fila, colCorte + 2).value = acumValCap;
    hoja.getCell(fila, colCorte + 2).numFmt = '#,##0';

    if (cap.categoria === 'INDIRECTO') sumaIndirecto += Number(cap.valor_presupuestado || 0);
    else sumaDirecto += Number(cap.valor_presupuestado || 0);

    fila += 1;

    (cap.presupuesto_items || []).forEach((it) => {
      hoja.getCell(fila, 1).value = it.codigo;
      hoja.getCell(fila, 2).value = it.descripcion;
      hoja.getCell(fila, 3).value = it.unidad || '';
      hoja.getCell(fila, 4).value = Number(it.cantidad || 0);
      hoja.getCell(fila, 5).value = Number(it.valor_unitario || 0);
      hoja.getCell(fila, 6).value = Number(it.valor_parcial || 0);
      [1, 2, 3, 4, 5, 6].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { numero: c >= 4, alineacion: c <= 2 ? 'left' : 'right' }));

      let colItem = columnasBase.length + 1;
      let acumCant = 0; let acumVal = 0;
      cortesAIncluir.forEach((c) => {
        colItem += 1;
        const registro = (c.items || []).find((ci) => ci.presupuesto_item_id === it.id);
        const cant = Number(registro?.cantidad_ejecutada || 0);
        const val = Number(registro?.valor_ejecutado || 0);
        acumCant += cant; acumVal += val;
        hoja.getCell(fila, colItem).value = cant || null;
        hoja.getCell(fila, colItem + 1).value = cant > 0 ? val / cant : null;
        hoja.getCell(fila, colItem + 2).value = val || null;
        [colItem, colItem + 1, colItem + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { alineacion: 'right' }));
        colItem += 3;
      });
      colItem += 1;
      hoja.getCell(fila, colItem).value = acumCant || null;
      hoja.getCell(fila, colItem + 1).value = acumCant > 0 ? acumVal / acumCant : null;
      hoja.getCell(fila, colItem + 2).value = acumVal || null;
      [colItem, colItem + 1, colItem + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { relleno: 'FFFEF9E7', alineacion: 'right' }));

      // Guardamos para el rollup del capítulo (recorremos ítems antes de
      // escribir la fila del capítulo hubiera sido más limpio, pero como el
      // capítulo ya se escribió arriba usando c._capValor precomputado, aquí
      // solo avanzamos la fila).
      fila += 1;
    });
  });

  // ---------- Totales generales ----------
  fila += 1;
  const valorTotal = sumaDirecto + sumaIndirecto;
  [
    ['TOTAL COSTOS DIRECTOS =', sumaDirecto],
    ['TOTAL COSTOS INDIRECTOS =', sumaIndirecto],
    ['VALOR TOTAL PRESUPUESTO =', valorTotal],
  ].forEach(([texto, valor]) => {
    hoja.mergeCells(fila, 1, fila, 5);
    const celdaTexto = hoja.getCell(fila, 1);
    celdaTexto.value = texto;
    celdaTexto.font = { bold: true };
    celdaTexto.alignment = { horizontal: 'right' };
    const celdaValor = hoja.getCell(fila, 6);
    celdaValor.value = valor;
    celdaValor.numFmt = '#,##0';
    celdaValor.font = { bold: true };
    fila += 1;
  });

  hoja.views = [{ state: 'frozen', xSplit: 2, ySplit: filaSub }];

  // ---------- Hojas de detalle por corte (equivalente a EXT. N) ----------
  cortesAIncluir.forEach((c) => {
    const hojaDet = workbook.addWorksheet(`Corte ${c.numero} - Detalle`.slice(0, 31));
    hojaDet.columns = [
      { header: 'Folio OC', key: 'folio', width: 16 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Proveedor', key: 'proveedor', width: 26 },
      { header: 'Capítulo', key: 'capitulo', width: 10 },
      { header: 'Ítem Presupuesto', key: 'item', width: 12 },
      { header: 'Descripción', key: 'descripcion', width: 36 },
      { header: 'Cantidad', key: 'cantidad', width: 11 },
      { header: 'Vr Unitario', key: 'vr_unitario', width: 14 },
      { header: 'Valor', key: 'valor', width: 15 },
    ];
    hojaDet.getRow(1).font = { bold: true };
    hojaDet.getRow(1).eachCell((celda) => { celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_CAPITULO } }; });
    (c.ocs || []).forEach((oc) => {
      hojaDet.addRow({
        folio: oc.folio, fecha: oc.fecha, proveedor: oc.proveedor,
        capitulo: oc.capitulo_codigo, item: oc.item_codigo, descripcion: oc.descripcion || oc.item_descripcion,
        cantidad: Number(oc.cantidad || 0), vr_unitario: Number(oc.valor_unitario || 0), valor: Number(oc.valor || 0),
      });
    });
    hojaDet.getColumn('vr_unitario').numFmt = '#,##0';
    hojaDet.getColumn('valor').numFmt = '#,##0';
    hojaDet.addRow({});
    const filaTotal = hojaDet.addRow({ descripcion: 'TOTAL', valor: (c.ocs || []).reduce((acc, o) => acc + Number(o.valor || 0), 0) });
    filaTotal.font = { bold: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Control Presupuestal - ${proyecto?.nombre || 'Proyecto'} - Corte ${hastaNumero}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Prepara, para cada corte, mapas rápidos de ejecución por capítulo y por
// ítem (a partir de presupuesto_corte_items), para no recorrer arrays anidados
// repetidamente al construir la hoja principal.
export function prepararCortesParaExportar(cortes, capitulos) {
  const capituloDeItem = {};
  capitulos.forEach((cap) => (cap.presupuesto_items || []).forEach((it) => { capituloDeItem[it.id] = cap.id; }));

  return cortes.map((c) => {
    const capCantidad = {};
    const capValor = {};
    (c.items || []).forEach((ci) => {
      const capId = capituloDeItem[ci.presupuesto_item_id];
      if (!capId) return;
      capCantidad[capId] = (capCantidad[capId] || 0) + Number(ci.cantidad_ejecutada || 0);
      capValor[capId] = (capValor[capId] || 0) + Number(ci.valor_ejecutado || 0);
    });
    return { ...c, _capCantidad: capCantidad, _capValor: capValor };
  });
}
