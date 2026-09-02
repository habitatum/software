'use client';
import ExcelJS from 'exceljs';

// Paleta de marca HABITATUM (igual a tailwind.config.js: carbon / dorado /
// gris-calido / hueso). Todo el Excel exportado debe usar SIEMPRE estos
// colores, nunca colores genéricos.
const CARBON = 'FF2E2E2E';
const DORADO = 'FFB88A52';
const GRIS_CALIDO = 'FFCDC5BA';
const HUESO = 'FFEFECE6';
const DORADO_CLARO = 'FFF0E2D0'; // tinte suave de dorado, para resaltar la columna acumulada

const BORDE_FINO = { style: 'thin', color: { argb: 'FFB9AFA0' } };

function estilizarCelda(celda, { negrita = false, relleno, colorTexto, alineacion = 'right', numero = true } = {}) {
  celda.font = { bold: negrita, color: colorTexto ? { argb: colorTexto } : undefined };
  celda.alignment = { horizontal: alineacion, vertical: 'middle' };
  celda.border = { top: BORDE_FINO, bottom: BORDE_FINO, left: BORDE_FINO, right: BORDE_FINO };
  if (relleno) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: relleno } };
  if (numero) celda.numFmt = '#,##0';
}

// Construye y descarga el Excel de Control Presupuestal por cortes, replicando
// el formato de referencia: columnas base del presupuesto + un bloque de 3
// columnas (Cantidad / Vr Unitario / Vr Parcial) por cada corte cerrado hasta
// el elegido + un bloque de Total acumulado + totales generales (incluyendo el
// total de cada corte y del acumulado, no solo del presupuesto). Incluye
// además una hoja de detalle por corte con las Órdenes de Compra que lo
// componen.
//
// esPreview: cuando es true, el último "corte" incluido (numero === hastaNumero)
// en realidad es un corte virtual (ver construirCorteVirtual en calcularCorte.js)
// que todavía no se ha cerrado en la base de datos — solo cambia las
// etiquetas del Excel para dejarlo claro (no afecta los cálculos).
export async function exportarControlPresupuestal({ proyecto, presupuesto, capitulos, cortes, hastaNumero, esPreview = false }) {
  const cortesAIncluir = cortes.filter((c) => c.numero <= hastaNumero).sort((a, b) => a.numero - b.numero);
  const numCortes = cortesAIncluir.length;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HABITATUM';
  workbook.created = new Date();

  const hoja = workbook.addWorksheet('CONTROL PPTAL');

  // ---------- Columnas ----------
  const columnasBase = [
    { header: 'ÍTEM', key: 'codigo', width: 10 },
    { header: 'DESCRIPCIÓN', key: 'descripcion', width: 42 },
    { header: 'UNIDAD', key: 'unidad', width: 8 },
    { header: 'CANTIDAD', key: 'cantidad', width: 11 },
    { header: 'VR UNITARIO', key: 'vr_unitario', width: 14 },
    { header: 'VR PARCIAL', key: 'vr_parcial', width: 15 },
  ];
  const columnas = [...columnasBase];
  cortesAIncluir.forEach(() => {
    columnas.push({ width: 2 }, { width: 11 }, { width: 14 }, { width: 15 });
  });
  columnas.push({ width: 2 }, { width: 11 }, { width: 14 }, { width: 15 });
  hoja.columns = columnas;

  // Posiciones de columna: cada bloque (corte j, o el acumulado) ocupa 1
  // columna de separación + 3 columnas (cantidad/vr unitario/vr parcial).
  const baseCol = columnasBase.length + 1; // primera columna después de la base
  const colBloqueCorte = (j) => baseCol + 1 + 4 * j;
  const colVrParcialCorte = (j) => colBloqueCorte(j) + 2;
  const colBloqueTotalAcum = baseCol + 1 + 4 * numCortes;
  const colVrParcialTotalAcum = colBloqueTotalAcum + 2;
  const totalColumnas = columnas.length;

  // ---------- Encabezado de proyecto ----------
  hoja.mergeCells(1, 1, 1, totalColumnas);
  const tituloCelda = hoja.getCell(1, 1);
  tituloCelda.value = `HABITATUM · CONTROL PRESUPUESTAL — ${proyecto?.nombre || ''}`;
  tituloCelda.font = { bold: true, size: 14, color: { argb: HUESO } };
  tituloCelda.alignment = { horizontal: 'center', vertical: 'middle' };
  tituloCelda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARBON } };
  hoja.getRow(1).height = 26;

  hoja.mergeCells(2, 1, 2, totalColumnas);
  const subtituloCelda = hoja.getCell(2, 1);
  const fechaCorteFinal = cortesAIncluir[cortesAIncluir.length - 1]?.fecha_hasta;
  subtituloCelda.value = esPreview
    ? `Vista previa al ${fechaCorteFinal || ''} — corte aún sin cerrar`
    : `Corte ${hastaNumero} — al ${fechaCorteFinal || ''}`;
  subtituloCelda.font = { italic: true, size: 10, color: { argb: CARBON } };
  subtituloCelda.alignment = { horizontal: 'center' };

  // ---------- Filas de encabezado de columnas ----------
  const filaGrupo = 4;
  const filaSub = 5;
  columnasBase.forEach((c, i) => {
    hoja.mergeCells(filaGrupo, i + 1, filaSub, i + 1);
    const celda = hoja.getCell(filaGrupo, i + 1);
    celda.value = c.header;
    estilizarCelda(celda, { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false, alineacion: i <= 1 ? 'left' : 'center' });
  });

  cortesAIncluir.forEach((c, j) => {
    const inicio = colBloqueCorte(j);
    hoja.mergeCells(filaGrupo, inicio, filaGrupo, inicio + 2);
    const celdaGrupo = hoja.getCell(filaGrupo, inicio);
    celdaGrupo.value = esPreview && c.numero === hastaNumero ? 'A HOY (SIN CERRAR)' : `CONTROL PRESUPUESTAL ${c.numero}`;
    estilizarCelda(celdaGrupo, { negrita: true, relleno: CARBON, colorTexto: HUESO, numero: false, alineacion: 'center' });
    ['CANTIDAD', 'VR UNITARIO', 'VR PARCIAL'].forEach((titulo, k) => {
      const celda = hoja.getCell(filaSub, inicio + k);
      celda.value = titulo;
      estilizarCelda(celda, { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false, alineacion: 'center' });
    });
  });

  const inicioTotal = colBloqueTotalAcum;
  hoja.mergeCells(filaGrupo, inicioTotal, filaGrupo, inicioTotal + 2);
  const celdaTotalGrupo = hoja.getCell(filaGrupo, inicioTotal);
  celdaTotalGrupo.value = 'TOTAL COSTOS DE OBRA (acumulado)';
  estilizarCelda(celdaTotalGrupo, { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false, alineacion: 'center' });
  ['CANTIDAD', 'VR UNITARIO', 'VR PARCIAL'].forEach((titulo, k) => {
    const celda = hoja.getCell(filaSub, inicioTotal + k);
    celda.value = titulo;
    estilizarCelda(celda, { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false, alineacion: 'center' });
  });

  // ---------- Filas de capítulos / ítems ----------
  let fila = filaSub + 1;
  let sumaDirecto = 0;
  let sumaIndirecto = 0;
  const sumaDirectoPorCorte = new Array(numCortes).fill(0);
  const sumaIndirectoPorCorte = new Array(numCortes).fill(0);
  let sumaDirectoAcum = 0;
  let sumaIndirectoAcum = 0;

  capitulos.forEach((cap) => {
    const esIndirecto = cap.categoria === 'INDIRECTO';

    hoja.mergeCells(fila, 1, fila, 2);
    const celdaCap = hoja.getCell(fila, 1);
    celdaCap.value = `${cap.codigo} ${cap.nombre}`;
    estilizarCelda(celdaCap, { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false, alineacion: 'left' });
    [3, 4, 5, 6].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false }));
    hoja.getCell(fila, 6).value = Number(cap.valor_presupuestado || 0);
    hoja.getCell(fila, 6).numFmt = '#,##0';

    let acumValCap = 0;
    cortesAIncluir.forEach((c, j) => {
      const val = c._capValor?.[cap.id] || 0;
      acumValCap += val;
      if (esIndirecto) sumaIndirectoPorCorte[j] += val; else sumaDirectoPorCorte[j] += val;
      const col = colBloqueCorte(j);
      [col, col + 1, col + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { relleno: GRIS_CALIDO, numero: false }));
      hoja.getCell(fila, col + 2).value = val;
      hoja.getCell(fila, col + 2).numFmt = '#,##0';
    });
    if (esIndirecto) sumaIndirectoAcum += acumValCap; else sumaDirectoAcum += acumValCap;

    [inicioTotal, inicioTotal + 1, inicioTotal + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { relleno: DORADO_CLARO, numero: false }));
    hoja.getCell(fila, colVrParcialTotalAcum).value = acumValCap;
    hoja.getCell(fila, colVrParcialTotalAcum).numFmt = '#,##0';

    if (esIndirecto) sumaIndirecto += Number(cap.valor_presupuestado || 0);
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

      let acumCant = 0; let acumVal = 0;
      cortesAIncluir.forEach((c, j) => {
        const registro = (c.items || []).find((ci) => ci.presupuesto_item_id === it.id);
        const cant = Number(registro?.cantidad_ejecutada || 0);
        const val = Number(registro?.valor_ejecutado || 0);
        acumCant += cant; acumVal += val;
        const col = colBloqueCorte(j);
        hoja.getCell(fila, col).value = cant || null;
        hoja.getCell(fila, col + 1).value = cant > 0 ? val / cant : null;
        hoja.getCell(fila, col + 2).value = val || null;
        [col, col + 1, col + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { alineacion: 'right' }));
      });
      hoja.getCell(fila, colVrParcialTotalAcum - 2).value = acumCant || null;
      hoja.getCell(fila, colVrParcialTotalAcum - 1).value = acumCant > 0 ? acumVal / acumCant : null;
      hoja.getCell(fila, colVrParcialTotalAcum).value = acumVal || null;
      [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1, colVrParcialTotalAcum].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { relleno: DORADO_CLARO, alineacion: 'right' }));

      fila += 1;
    });
  });

  // ---------- Totales generales (presupuesto, cada corte y el acumulado) ----------
  fila += 1;
  const valorTotal = sumaDirecto + sumaIndirecto;
  const filasTotales = [
    { texto: 'TOTAL COSTOS DIRECTOS =', base: sumaDirecto, porCorte: sumaDirectoPorCorte, acum: sumaDirectoAcum },
    { texto: 'TOTAL COSTOS INDIRECTOS =', base: sumaIndirecto, porCorte: sumaIndirectoPorCorte, acum: sumaIndirectoAcum },
    {
      texto: 'VALOR TOTAL =',
      base: valorTotal,
      porCorte: sumaDirectoPorCorte.map((v, j) => v + sumaIndirectoPorCorte[j]),
      acum: sumaDirectoAcum + sumaIndirectoAcum,
    },
  ];
  filasTotales.forEach(({ texto, base, porCorte, acum }) => {
    hoja.mergeCells(fila, 1, fila, 5);
    const celdaTexto = hoja.getCell(fila, 1);
    celdaTexto.value = texto;
    estilizarCelda(celdaTexto, { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false, alineacion: 'right' });
    [2, 3, 4, 5].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));

    const celdaBase = hoja.getCell(fila, 6);
    celdaBase.value = base;
    estilizarCelda(celdaBase, { negrita: true, relleno: DORADO, colorTexto: HUESO });

    porCorte.forEach((valor, j) => {
      const col = colBloqueCorte(j);
      [col, col + 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
      const celda = hoja.getCell(fila, col + 2);
      celda.value = valor;
      estilizarCelda(celda, { negrita: true, relleno: DORADO, colorTexto: HUESO });
    });

    [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
    const celdaAcum = hoja.getCell(fila, colVrParcialTotalAcum);
    celdaAcum.value = acum;
    estilizarCelda(celdaAcum, { negrita: true, relleno: DORADO, colorTexto: HUESO });

    fila += 1;
  });

  // ---------- Anticipos pendientes de amortizar ----------
  // No se vinculan a un ítem del presupuesto, así que no tienen "flujo por
  // corte": es un saldo acumulado (Total del anticipo - lo ya amortizado)
  // congelado a la fecha del último corte incluido. Se suma aparte al TOTAL
  // EJECUTADO (no al presupuesto contratado) para llegar al Total Control
  // Presupuestal real (el que coincide con el efectivo entregado al
  // contratista, y también la base correcta para cobrar la Administración).
  const anticiposPendientes = Number(cortesAIncluir[cortesAIncluir.length - 1]?.anticipos_pendientes || 0);
  // OJO: antes esto se calculaba como `valorTotal + anticiposPendientes`,
  // donde valorTotal es el PRESUPUESTO CONTRATADO completo (suma de
  // valor_presupuestado de todos los capítulos). Eso sobrestima el total
  // para cobro mientras la obra no esté 100% ejecutada. El total correcto
  // es lo YA EJECUTADO a la fecha (sumaDirectoAcum + sumaIndirectoAcum) más
  // los anticipos pendientes de amortizar — el mismo criterio que ya usa
  // la pantalla de Presupuesto en la app.
  const totalEjecutadoAcum = sumaDirectoAcum + sumaIndirectoAcum;
  const totalConAnticipos = totalEjecutadoAcum + anticiposPendientes;

  hoja.mergeCells(fila, 1, fila, 5);
  const celdaTextoAnt = hoja.getCell(fila, 1);
  celdaTextoAnt.value = 'ANTICIPOS PENDIENTES DE AMORTIZAR (no ligados a ítem) =';
  estilizarCelda(celdaTextoAnt, { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false, alineacion: 'right' });
  [2, 3, 4, 5, 6].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false }));
  cortesAIncluir.forEach((c, j) => {
    const col = colBloqueCorte(j);
    [col, col + 1, col + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false }));
  });
  [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false }));
  const celdaAntAcum = hoja.getCell(fila, colVrParcialTotalAcum);
  celdaAntAcum.value = anticiposPendientes;
  estilizarCelda(celdaAntAcum, { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON });
  fila += 1;

  hoja.mergeCells(fila, 1, fila, 5);
  const celdaTextoTotal = hoja.getCell(fila, 1);
  celdaTextoTotal.value = 'TOTAL CONTROL PRESUPUESTAL (para cobro) =';
  estilizarCelda(celdaTextoTotal, { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false, alineacion: 'right' });
  [2, 3, 4, 5, 6].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
  cortesAIncluir.forEach((c, j) => {
    const col = colBloqueCorte(j);
    [col, col + 1, col + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
  });
  [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
  const celdaTotalConAnt = hoja.getCell(fila, colVrParcialTotalAcum);
  celdaTotalConAnt.value = totalConAnticipos;
  estilizarCelda(celdaTotalConAnt, { negrita: true, relleno: DORADO, colorTexto: HUESO });
  fila += 1;

  // ---------- Administración (solo si el proyecto tiene % configurado) ----------
  // Base = Total Control Presupuestal (para cobro), es decir lo ya
  // ejecutado + anticipos pendientes de amortizar (neto, no doble-cuenta
  // cuando después se amortice). Así la Administración cobrada crece con
  // el avance real de la obra y con los anticipos entregados.
  const pctAdmin = Number(proyecto?.porcentaje_administracion || 0);
  if (pctAdmin > 0) {
    const valorAdministracion = totalConAnticipos * (pctAdmin / 100);

    hoja.mergeCells(fila, 1, fila, 5);
    const celdaTextoAdmin = hoja.getCell(fila, 1);
    celdaTextoAdmin.value = `ADMINISTRACIÓN (${pctAdmin}%) =`;
    estilizarCelda(celdaTextoAdmin, { negrita: true, relleno: CARBON, colorTexto: HUESO, numero: false, alineacion: 'right' });
    [2, 3, 4, 5, 6].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { negrita: true, relleno: CARBON, colorTexto: HUESO, numero: false }));
    cortesAIncluir.forEach((c, j) => {
      const col = colBloqueCorte(j);
      [col, col + 1, col + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: CARBON, colorTexto: HUESO, numero: false }));
    });
    [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: CARBON, colorTexto: HUESO, numero: false }));
    const celdaAdmin = hoja.getCell(fila, colVrParcialTotalAcum);
    celdaAdmin.value = valorAdministracion;
    estilizarCelda(celdaAdmin, { negrita: true, relleno: CARBON, colorTexto: HUESO });
    fila += 1;
  }

  hoja.views = [{ state: 'frozen', xSplit: 2, ySplit: filaSub }];

  // ---------- Hojas de detalle por corte (equivalente a EXT. N) ----------
  cortesAIncluir.forEach((c) => {
    const nombreHoja = esPreview && c.numero === hastaNumero ? 'A hoy - Detalle' : `Corte ${c.numero} - Detalle`;
    const hojaDet = workbook.addWorksheet(nombreHoja.slice(0, 31));
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
    hojaDet.getRow(1).eachCell((celda) => {
      celda.font = { bold: true, color: { argb: HUESO } };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARBON } };
    });
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
    filaTotal.font = { bold: true, color: { argb: CARBON } };
    filaTotal.eachCell((celda) => { celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DORADO_CLARO } }; });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Control Presupuestal - ${proyecto?.nombre || 'Proyecto'} - ${esPreview ? 'Vista previa' : `Corte ${hastaNumero}`}.xlsx`;
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
