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

// Convierte un número de columna (1 = A, 27 = AA, ...) a su letra de Excel,
// para poder escribir fórmulas con referencias de celda (=F12/D12, etc).
function columnaLetra(n) {
  let s = '';
  let num = n;
  while (num > 0) {
    const m = (num - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

// Construye y descarga el Excel de Control Presupuestal por cortes, replicando
// el formato de referencia: columnas base del presupuesto + un bloque de 3
// columnas (Cantidad / Vr Unitario / Vr Parcial) por cada corte cerrado hasta
// el elegido + un bloque de Total acumulado + totales generales (incluyendo el
// total de cada corte y del acumulado, no solo del presupuesto). Incluye
// además una hoja de detalle por corte con las Órdenes de Compra que lo
// componen.
//
// La columna PRESUPUESTO (base) es siempre un valor fijo, sin fórmulas: es
// el contrato/presupuesto original, no se toca desde aquí (excepto en la
// fila de ADMINISTRACIÓN, donde esa columna es la celda editable del %).
//
// Las columnas de cada CORTE y del ACUMULADO sí llevan FÓRMULAS reales de
// Excel (para que el usuario pueda auditar/editar en el propio archivo):
//   - Vr Unitario de cada ítem = Vr Parcial / Cantidad (de esa misma columna).
//   - Vr Parcial de cada Capítulo, por corte = suma de sus ítems (nunca de
//     otro Capítulo) en la columna de ese corte.
//   - TOTAL COSTOS DIRECTOS / INDIRECTOS, por corte = suma de los ítems de
//     esa categoría (nunca de las filas de Capítulo, para no sumar doble).
//   - ANTICIPOS PENDIENTES, por corte = variación del saldo de anticipos en
//     ese periodo (saldo al cierre de este corte - saldo al cierre del
//     corte anterior), para que sea sumable sin duplicar.
//   - TOTAL CONTROL PRESUPUESTAL, por corte = VALOR TOTAL de ese corte +
//     Anticipos de ese corte.
//   - ADMINISTRACIÓN, por corte = (Directos de ese corte + Anticipos de ese
//     corte) × % — el % se escribe a mano en la celda de "Presupuesto" de
//     esa fila (columna F) y aplica igual a todas las columnas.
//   - En el ACUMULADO, TODAS las filas (Cantidad, Vr Parcial, Directos,
//     Indirectos, Anticipos, Total Control Presupuestal y Administración)
//     son siempre la sumatoria de esa misma casilla en cada corte
//     (Corte 1 + Corte 2 + Corte 3...).
// La CANTIDAD de cada corte es la cantidad medida registrada en la app
// (Presupuesto → Cantidades del corte, migración 052). Si un ítem no la tiene,
// queda en blanco y se puede llenar a mano. La cantidad de las OC (materiales,
// jornales) no se usa: no mide la obra presentada al cliente.
//
// esPreview: cuando es true, el último "corte" incluido (numero === hastaNumero)
// en realidad es un corte virtual (ver construirCorteVirtual en calcularCorte.js)
// que todavía no se ha cerrado en la base de datos — solo cambia las
// etiquetas del Excel para dejarlo claro (no afecta los cálculos).
export async function exportarControlPresupuestal({ proyecto, presupuesto, capitulos, cortes, hastaNumero, esPreview = false, anticipos = null }) {
  const cortesAIncluir = cortes.filter((c) => c.numero <= hastaNumero).sort((a, b) => a.numero - b.numero);
  const numCortes = cortesAIncluir.length;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HABITATUM';
  workbook.created = new Date();
  // Fuerza a Excel a recalcular todas las fórmulas apenas se abra el
  // archivo, para que las casillas nunca queden mostrando un valor
  // desactualizado (por ejemplo apenas el usuario llene la Cantidad).
  workbook.calcProperties = { fullCalcOnLoad: true };

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
  // rangosPorCapitulo: fila de inicio/fin de los ÍTEMS de cada capítulo (no
  // incluye la fila del propio capítulo), para poder sumar SOLO ítems tanto
  // en la fórmula del capítulo como en la de TOTAL DIRECTOS/INDIRECTOS.
  const rangosPorCapitulo = [];

  let fila = filaSub + 1;
  let sumaDirecto = 0;
  let sumaIndirecto = 0;
  const sumaDirectoPorCorte = new Array(numCortes).fill(0);
  const sumaIndirectoPorCorte = new Array(numCortes).fill(0);
  let sumaDirectoAcum = 0;
  let sumaIndirectoAcum = 0;

  capitulos.forEach((cap) => {
    const esIndirecto = cap.categoria === 'INDIRECTO';
    const filaCap = fila;

    hoja.mergeCells(fila, 1, fila, 2);
    const celdaCap = hoja.getCell(fila, 1);
    celdaCap.value = `${cap.codigo} ${cap.nombre}`;
    estilizarCelda(celdaCap, { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false, alineacion: 'left' });
    [3, 4, 5, 6].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false }));

    cortesAIncluir.forEach((c, j) => {
      const col = colBloqueCorte(j);
      [col, col + 1, col + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { relleno: GRIS_CALIDO, numero: false }));
    });
    [inicioTotal, inicioTotal + 1, inicioTotal + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { relleno: DORADO_CLARO, numero: false }));

    if (esIndirecto) sumaIndirecto += Number(cap.valor_presupuestado || 0);
    else sumaDirecto += Number(cap.valor_presupuestado || 0);

    fila += 1;
    const filaInicioItems = fila;

    let acumValCap = 0;
    const acumValCapPorCorte = new Array(numCortes).fill(0);
    (cap.presupuesto_items || []).forEach((it) => {
      hoja.getCell(fila, 1).value = it.codigo;
      hoja.getCell(fila, 2).value = it.descripcion;
      hoja.getCell(fila, 3).value = it.unidad || '';
      hoja.getCell(fila, 4).value = Number(it.cantidad || 0);
      hoja.getCell(fila, 6).value = Number(it.valor_parcial || 0);
      // Presupuesto: valor fijo, tal como se cargó — sin fórmula (no se
      // toca desde aquí, a diferencia de los bloques de cada corte).
      hoja.getCell(fila, 5).value = Number(it.valor_unitario || 0);
      [1, 2, 3, 4, 5, 6].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { numero: c >= 4, alineacion: c <= 2 ? 'left' : 'right' }));

      let acumVal = 0;
      cortesAIncluir.forEach((c, j) => {
        const registro = (c.items || []).find((ci) => ci.presupuesto_item_id === it.id);
        const val = Number(registro?.valor_ejecutado || 0);
        acumVal += val;
        acumValCapPorCorte[j] += val;
        if (esIndirecto) sumaIndirectoPorCorte[j] += val; else sumaDirectoPorCorte[j] += val;
        const col = colBloqueCorte(j);
        // Cantidad de este corte: la cantidad medida registrada en la app
        // (052). Si no se registró, queda en blanco para llenarla a mano.
        const cantMedida = registro?.cantidad_medida;
        hoja.getCell(fila, col).value = cantMedida === null || cantMedida === undefined ? null : Number(cantMedida);
        hoja.getCell(fila, col + 1).value = { formula: `IFERROR(${columnaLetra(col + 2)}${fila}/${columnaLetra(col)}${fila},"")` };
        hoja.getCell(fila, col + 2).value = val || null;
        [col, col + 1, col + 2].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { alineacion: 'right' }));
      });
      acumValCap += acumVal;
      if (esIndirecto) sumaIndirectoAcum += acumVal; else sumaDirectoAcum += acumVal;

      const colCantAcum = colVrParcialTotalAcum - 2;
      const colUnitAcum = colVrParcialTotalAcum - 1;
      // Cantidad acumulada = suma de las cantidades manuales de cada corte
      // (fórmula: se recalcula sola a medida que el usuario las va
      // llenando en cada bloque de corte).
      if (numCortes > 0) {
        const sumaCantidades = cortesAIncluir.map((c, j) => `${columnaLetra(colBloqueCorte(j))}${fila}`).join('+');
        hoja.getCell(fila, colCantAcum).value = { formula: sumaCantidades };
      } else {
        hoja.getCell(fila, colCantAcum).value = null;
      }
      // Vr Parcial acumulado = suma de los Vr Parcial de cada corte
      // (fórmula real, no el número que ya sumamos por dentro en JS).
      if (numCortes > 0) {
        const sumaVrParciales = cortesAIncluir.map((c, j) => `${columnaLetra(colBloqueCorte(j) + 2)}${fila}`).join('+');
        hoja.getCell(fila, colVrParcialTotalAcum).value = { formula: sumaVrParciales, result: acumVal };
      } else {
        hoja.getCell(fila, colVrParcialTotalAcum).value = null;
      }
      hoja.getCell(fila, colUnitAcum).value = { formula: `IFERROR(${columnaLetra(colVrParcialTotalAcum)}${fila}/${columnaLetra(colCantAcum)}${fila},"")` };
      [colCantAcum, colUnitAcum, colVrParcialTotalAcum].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { relleno: DORADO_CLARO, alineacion: 'right' }));

      fila += 1;
    });

    const filaFinItems = fila - 1;
    rangosPorCapitulo.push({ filaInicioItems, filaFinItems, esIndirecto });

    // Presupuesto: valor fijo (cap.valor_presupuestado), sin fórmula.
    const celdaCapBase = hoja.getCell(filaCap, 6);
    celdaCapBase.value = Number(cap.valor_presupuestado || 0);
    celdaCapBase.numFmt = '#,##0';

    // Vr Parcial de este Capítulo, por cada corte = suma de SUS ítems
    // (nunca de otro capítulo), en la columna de ese corte.
    const colsCorteValor = cortesAIncluir.map((c, j) => colVrParcialCorte(j));
    colsCorteValor.forEach((colValor, j) => {
      const letra = columnaLetra(colValor);
      const celda = hoja.getCell(filaCap, colValor);
      if (filaFinItems >= filaInicioItems) {
        celda.value = { formula: `SUM(${letra}${filaInicioItems}:${letra}${filaFinItems})`, result: acumValCapPorCorte[j] };
      } else {
        celda.value = 0;
      }
      celda.numFmt = '#,##0';
    });

    // Vr Parcial acumulado del Capítulo = suma de SUS PROPIOS Vr Parcial de
    // cada corte (fórmula), el mismo criterio que en las filas de ítem.
    const celdaAcumCap = hoja.getCell(filaCap, colVrParcialTotalAcum);
    if (colsCorteValor.length > 0) {
      const sumaVrParcialesCap = colsCorteValor.map((colValor) => `${columnaLetra(colValor)}${filaCap}`).join('+');
      celdaAcumCap.value = { formula: sumaVrParcialesCap, result: acumValCap };
    } else {
      celdaAcumCap.value = 0;
    }
    celdaAcumCap.numFmt = '#,##0';
  });

  // ---------- Totales generales (presupuesto, cada corte y el acumulado) ----------
  fila += 1;
  const valorTotal = sumaDirecto + sumaIndirecto;

  // Fórmula de TOTAL COSTOS DIRECTOS / INDIRECTOS: suma SOLO las filas de
  // ÍTEM de esa categoría (nunca las filas de Capítulo, para no sumar
  // doble), en la columna de valor indicada.
  function formulaCategoria(colValor, indirecto) {
    const letra = columnaLetra(colValor);
    const rangos = rangosPorCapitulo.filter((r) => r.esIndirecto === indirecto && r.filaFinItems >= r.filaInicioItems);
    if (rangos.length === 0) return '0';
    return rangos.map((r) => `SUM(${letra}${r.filaInicioItems}:${letra}${r.filaFinItems})`).join('+');
  }

  const filaDirectos = fila;
  const filaIndirectos = fila + 1;
  const filaValorTotal = fila + 2;

  const filasTotales = [
    { fila: filaDirectos, texto: 'TOTAL COSTOS DIRECTOS =', base: sumaDirecto, porCorte: sumaDirectoPorCorte, acum: sumaDirectoAcum, indirecto: false },
    { fila: filaIndirectos, texto: 'TOTAL COSTOS INDIRECTOS =', base: sumaIndirecto, porCorte: sumaIndirectoPorCorte, acum: sumaIndirectoAcum, indirecto: true },
  ];
  filasTotales.forEach(({ fila: filaFila, texto, base, porCorte, acum, indirecto }) => {
    hoja.mergeCells(filaFila, 1, filaFila, 5);
    const celdaTexto = hoja.getCell(filaFila, 1);
    celdaTexto.value = texto;
    estilizarCelda(celdaTexto, { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false, alineacion: 'right' });
    [2, 3, 4, 5].forEach((c) => estilizarCelda(hoja.getCell(filaFila, c), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));

    // Presupuesto: valor fijo, sin fórmula.
    const celdaBase = hoja.getCell(filaFila, 6);
    celdaBase.value = base;
    estilizarCelda(celdaBase, { negrita: true, relleno: DORADO, colorTexto: HUESO });

    const colsCorteTotal = [];
    porCorte.forEach((valor, j) => {
      const col = colBloqueCorte(j);
      colsCorteTotal.push(col + 2);
      [col, col + 1].forEach((cc) => estilizarCelda(hoja.getCell(filaFila, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
      const celda = hoja.getCell(filaFila, col + 2);
      celda.value = { formula: formulaCategoria(col + 2, indirecto), result: valor };
      estilizarCelda(celda, { negrita: true, relleno: DORADO, colorTexto: HUESO });
    });

    [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1].forEach((cc) => estilizarCelda(hoja.getCell(filaFila, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
    const celdaAcum = hoja.getCell(filaFila, colVrParcialTotalAcum);
    // Acumulado = suma de los totales de cada corte (fórmula), no vuelve a
    // sumar los ítems otra vez.
    if (colsCorteTotal.length > 0) {
      const sumaCortes = colsCorteTotal.map((c) => `${columnaLetra(c)}${filaFila}`).join('+');
      celdaAcum.value = { formula: sumaCortes, result: acum };
    } else {
      celdaAcum.value = 0;
    }
    estilizarCelda(celdaAcum, { negrita: true, relleno: DORADO, colorTexto: HUESO });
  });

  // VALOR TOTAL = TOTAL COSTOS DIRECTOS + TOTAL COSTOS INDIRECTOS (fórmula
  // que referencia esas dos filas de arriba, no vuelve a sumar los ítems).
  hoja.mergeCells(filaValorTotal, 1, filaValorTotal, 5);
  const celdaTextoVT = hoja.getCell(filaValorTotal, 1);
  celdaTextoVT.value = 'VALOR TOTAL =';
  estilizarCelda(celdaTextoVT, { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false, alineacion: 'right' });
  [2, 3, 4, 5].forEach((c) => estilizarCelda(hoja.getCell(filaValorTotal, c), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));

  // Presupuesto: valor fijo, sin fórmula.
  const celdaBaseVT = hoja.getCell(filaValorTotal, 6);
  celdaBaseVT.value = valorTotal;
  estilizarCelda(celdaBaseVT, { negrita: true, relleno: DORADO, colorTexto: HUESO });

  cortesAIncluir.forEach((c, j) => {
    const col = colBloqueCorte(j);
    [col, col + 1].forEach((cc) => estilizarCelda(hoja.getCell(filaValorTotal, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
    const letra = columnaLetra(col + 2);
    const celda = hoja.getCell(filaValorTotal, col + 2);
    celda.value = { formula: `${letra}${filaDirectos}+${letra}${filaIndirectos}`, result: sumaDirectoPorCorte[j] + sumaIndirectoPorCorte[j] };
    estilizarCelda(celda, { negrita: true, relleno: DORADO, colorTexto: HUESO });
  });

  [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1].forEach((cc) => estilizarCelda(hoja.getCell(filaValorTotal, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
  const letraAcum = columnaLetra(colVrParcialTotalAcum);
  const celdaAcumVT = hoja.getCell(filaValorTotal, colVrParcialTotalAcum);
  celdaAcumVT.value = { formula: `${letraAcum}${filaDirectos}+${letraAcum}${filaIndirectos}`, result: sumaDirectoAcum + sumaIndirectoAcum };
  estilizarCelda(celdaAcumVT, { negrita: true, relleno: DORADO, colorTexto: HUESO });

  fila = filaValorTotal + 1;

  // ---------- Anticipos pendientes de amortizar ----------
  // No se vinculan a un ítem del presupuesto, así que no tienen ítems que
  // sumar por corte. Cada corte trae congelado el SALDO de anticipos a su
  // fecha de cierre (Total del anticipo - lo ya amortizado); para poder
  // mostrarlo por corte y que el ACUMULADO se pueda sumar sin duplicar, aquí
  // se muestra la VARIACIÓN de ese saldo en cada corte (saldo de este corte
  // - saldo del corte anterior) — la suma de esas variaciones da el saldo
  // total, igual que con cualquier otra fila de la hoja.
  const anticiposPorCorte = cortesAIncluir.map((c, j) => {
    const actual = Number(c.anticipos_pendientes || 0);
    const anterior = j > 0 ? Number(cortesAIncluir[j - 1].anticipos_pendientes || 0) : 0;
    return actual - anterior;
  });
  const anticiposPendientes = numCortes > 0 ? Number(cortesAIncluir[numCortes - 1].anticipos_pendientes || 0) : 0;
  const totalEjecutadoAcum = sumaDirectoAcum + sumaIndirectoAcum;
  const totalConAnticipos = totalEjecutadoAcum + anticiposPendientes;

  const filaAnticipos = fila;
  hoja.mergeCells(fila, 1, fila, 5);
  const celdaTextoAnt = hoja.getCell(fila, 1);
  celdaTextoAnt.value = 'ANTICIPOS PENDIENTES DE AMORTIZAR (no ligados a ítem) =';
  estilizarCelda(celdaTextoAnt, { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false, alineacion: 'right' });
  [2, 3, 4, 5, 6].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false }));
  const colsCorteAnticipos = [];
  cortesAIncluir.forEach((c, j) => {
    const col = colBloqueCorte(j);
    colsCorteAnticipos.push(col + 2);
    [col, col + 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false }));
    const celda = hoja.getCell(fila, col + 2);
    celda.value = anticiposPorCorte[j] || 0;
    estilizarCelda(celda, { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON });
  });
  [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON, numero: false }));
  const celdaAntAcum = hoja.getCell(fila, colVrParcialTotalAcum);
  // Acumulado = suma de las variaciones de cada corte (fórmula) = saldo
  // total vigente de anticipos pendientes.
  if (colsCorteAnticipos.length > 0) {
    const sumaAnticipos = colsCorteAnticipos.map((c) => `${columnaLetra(c)}${fila}`).join('+');
    celdaAntAcum.value = { formula: sumaAnticipos, result: anticiposPendientes };
  } else {
    celdaAntAcum.value = anticiposPendientes;
  }
  estilizarCelda(celdaAntAcum, { negrita: true, relleno: GRIS_CALIDO, colorTexto: CARBON });
  fila += 1;

  const filaTotalControl = fila;
  hoja.mergeCells(fila, 1, fila, 5);
  const celdaTextoTotal = hoja.getCell(fila, 1);
  celdaTextoTotal.value = 'TOTAL CONTROL PRESUPUESTAL (para cobro) =';
  estilizarCelda(celdaTextoTotal, { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false, alineacion: 'right' });
  [2, 3, 4, 5, 6].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
  cortesAIncluir.forEach((c, j) => {
    const col = colBloqueCorte(j);
    [col, col + 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
    const letraCorte = columnaLetra(col + 2);
    const celda = hoja.getCell(fila, col + 2);
    const valorCorte = sumaDirectoPorCorte[j] + sumaIndirectoPorCorte[j] + anticiposPorCorte[j];
    // Total Control Presupuestal de este corte = VALOR TOTAL de este corte +
    // Anticipos de este corte (misma columna, filas de arriba).
    celda.value = { formula: `${letraCorte}${filaValorTotal}+${letraCorte}${filaAnticipos}`, result: valorCorte };
    estilizarCelda(celda, { negrita: true, relleno: DORADO, colorTexto: HUESO });
  });
  [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: DORADO, colorTexto: HUESO, numero: false }));
  const celdaTotalConAnt = hoja.getCell(fila, colVrParcialTotalAcum);
  // Total Control Presupuestal (para cobro) = VALOR TOTAL (Directos +
  // Indirectos) + Anticipos pendientes, acumulados. Sigue incluyendo
  // Indirectos, sin cambios (solo la Administración de abajo los excluye).
  celdaTotalConAnt.value = { formula: `${letraAcum}${filaValorTotal}+${letraAcum}${filaAnticipos}`, result: totalConAnticipos };
  estilizarCelda(celdaTotalConAnt, { negrita: true, relleno: DORADO, colorTexto: HUESO });
  fila += 1;

  // ---------- Administración ----------
  // Base = TOTAL COSTOS DIRECTOS + Anticipos pendientes (por corte, y
  // acumulado) — los Costos Indirectos NO entran en esta base (a diferencia
  // del Total Control Presupuestal de arriba, que sí los incluye). El % NO
  // se calcula desde la app: se escribe a mano en la celda de "Presupuesto"
  // de esta fila (columna F) — si el proyecto tiene un % configurado se deja
  // como valor inicial, pero el usuario lo puede cambiar libremente en Excel
  // y todas las columnas de esta fila se recalculan solas.
  const filaAdmin = fila;
  const pctAdminInicial = Number(proyecto?.porcentaje_administracion || 0);
  const letraPct = columnaLetra(6);

  hoja.mergeCells(fila, 1, fila, 5);
  const celdaTextoAdmin = hoja.getCell(fila, 1);
  celdaTextoAdmin.value = 'ADMINISTRACIÓN (% manual en la celda de la derecha) — solo sobre Directos + Anticipos =';
  estilizarCelda(celdaTextoAdmin, { negrita: true, relleno: CARBON, colorTexto: HUESO, numero: false, alineacion: 'right' });
  [2, 3, 4, 5].forEach((c) => estilizarCelda(hoja.getCell(fila, c), { negrita: true, relleno: CARBON, colorTexto: HUESO, numero: false }));

  // Celda editable del %: no es fórmula, la escribe el usuario en Excel.
  const celdaPct = hoja.getCell(fila, 6);
  celdaPct.value = pctAdminInicial > 0 ? pctAdminInicial : null;
  estilizarCelda(celdaPct, { negrita: true, relleno: HUESO, colorTexto: CARBON, numero: false });
  celdaPct.numFmt = '0.00"%"';

  const colsCorteAdmin = [];
  cortesAIncluir.forEach((c, j) => {
    const col = colBloqueCorte(j);
    colsCorteAdmin.push(col + 2);
    [col, col + 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: CARBON, colorTexto: HUESO, numero: false }));
    const letraCorte = columnaLetra(col + 2);
    const valorCorte = pctAdminInicial > 0 ? (sumaDirectoPorCorte[j] + anticiposPorCorte[j]) * (pctAdminInicial / 100) : 0;
    const celda = hoja.getCell(fila, col + 2);
    // Administración de este corte = (Directos de este corte + Anticipos de
    // este corte) × % (celda de la izquierda, misma para todas las columnas).
    celda.value = {
      formula: `(${letraCorte}${filaDirectos}+${letraCorte}${filaAnticipos})*${letraPct}${filaAdmin}/100`,
      result: valorCorte,
    };
    estilizarCelda(celda, { negrita: true, relleno: CARBON, colorTexto: HUESO });
  });

  [colVrParcialTotalAcum - 2, colVrParcialTotalAcum - 1].forEach((cc) => estilizarCelda(hoja.getCell(fila, cc), { negrita: true, relleno: CARBON, colorTexto: HUESO, numero: false }));
  const celdaAdmin = hoja.getCell(fila, colVrParcialTotalAcum);
  const valorAdministracionAcum = pctAdminInicial > 0 ? (sumaDirectoAcum + anticiposPendientes) * (pctAdminInicial / 100) : 0;
  if (colsCorteAdmin.length > 0) {
    const sumaAdmin = colsCorteAdmin.map((c) => `${columnaLetra(c)}${filaAdmin}`).join('+');
    celdaAdmin.value = { formula: sumaAdmin, result: valorAdministracionAcum };
  } else {
    celdaAdmin.value = {
      formula: `(${letraAcum}${filaDirectos}+${letraAcum}${filaAnticipos})*${letraPct}${filaAdmin}/100`,
      result: valorAdministracionAcum,
    };
  }
  estilizarCelda(celdaAdmin, { negrita: true, relleno: CARBON, colorTexto: HUESO });
  fila += 1;

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
      // Desde la 046: las correcciones a OC de cortes ya cerrados entran como
      // ajuste identificado en el corte siguiente (no cambian el corte cerrado).
      { header: 'Tipo', key: 'tipo', width: 18 },
      { header: 'Motivo', key: 'motivo', width: 40 },
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
        tipo: oc.tipo === 'AJUSTE' ? `Ajuste a Corte ${oc.corte_origen ?? ''}`.trim() : '',
        motivo: oc.tipo === 'AJUSTE' ? (oc.motivo || '') : '',
      });
    });
    hojaDet.getColumn('vr_unitario').numFmt = '#,##0';
    hojaDet.getColumn('valor').numFmt = '#,##0';
    hojaDet.addRow({});
    const filaTotal = hojaDet.addRow({ descripcion: 'TOTAL', valor: (c.ocs || []).reduce((acc, o) => acc + Number(o.valor || 0), 0) });
    filaTotal.font = { bold: true, color: { argb: CARBON } };
    filaTotal.eachCell((celda) => { celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DORADO_CLARO } }; });
  });

  // ---------- Hoja de Órdenes de Compra del corte que se está cerrando/
  // previsualizando ----------
  // A diferencia de las hojas "Detalle" de arriba (una por cada corte
  // incluido en el acumulado), esta es UNA sola hoja con el listado de
  // Órdenes de Compra de "dicho corte" — el que se está cerrando (o el rango
  // "a hoy" en la vista previa) — con exactamente las mismas columnas que ve
  // el usuario en la pantalla de Órdenes de Compra, solo que con la Fecha
  // primero. corte.ordenesResumen viene de obtenerOCsEnRango/
  // construirCorteVirtual en calcularCorte.js (una fila por OC, ya con
  // imputacion_completa calculada).
  const corteObjetivo = cortesAIncluir[cortesAIncluir.length - 1];
  if (corteObjetivo) {
    const nombreHojaOC = esPreview && corteObjetivo.numero === hastaNumero
      ? 'A hoy - Ordenes de Compra'
      : `Corte ${corteObjetivo.numero} - Ordenes de Compra`;
    const hojaOC = workbook.addWorksheet(nombreHojaOC.slice(0, 31));
    hojaOC.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Folio', key: 'folio', width: 22 },
      { header: 'Contrato', key: 'contrato', width: 16 },
      { header: 'Proveedor', key: 'proveedor', width: 28 },
      { header: 'Total', key: 'total', width: 15 },
      { header: 'A Pagar', key: 'a_pagar', width: 15 },
      { header: 'Estado', key: 'estado', width: 12 },
    ];
    hojaOC.getRow(1).eachCell((celda) => {
      celda.font = { bold: true, color: { argb: HUESO } };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CARBON } };
    });
    const ordenesResumen = corteObjetivo.ordenesResumen || [];
    ordenesResumen.forEach((oc) => {
      // Excel no puede mostrar los "pills" de color de la pantalla, así que
      // se anotan como texto junto al Folio: (ANTICIPO) si es una orden de
      // anticipo, ✓ si quedó totalmente imputada al presupuesto.
      let folio = oc.folio || '';
      if (oc.tipo_pago === 'ANTICIPO') folio += ' (ANTICIPO)';
      if (oc.imputacion_completa) folio += ' ✓';
      hojaOC.addRow({
        fecha: oc.fecha,
        folio,
        contrato: oc.contratos?.numero_contrato || '—',
        proveedor: oc.proveedores?.nombre || '—',
        total: Number(oc.total || 0),
        a_pagar: Number(oc.neto_a_pagar || 0),
        estado: oc.estado || '',
      });
    });
    hojaOC.getColumn('total').numFmt = '#,##0';
    hojaOC.getColumn('a_pagar').numFmt = '#,##0';
    hojaOC.addRow({});
    const filaTotalOC = hojaOC.addRow({
      proveedor: 'TOTAL',
      total: ordenesResumen.reduce((acc, o) => acc + Number(o.total || 0), 0),
      a_pagar: ordenesResumen.reduce((acc, o) => acc + Number(o.neto_a_pagar || 0), 0),
    });
    filaTotalOC.font = { bold: true, color: { argb: CARBON } };
    filaTotalOC.eachCell((celda) => { celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DORADO_CLARO } }; });
    hojaOC.views = [{ state: 'frozen', ySplit: 1 }];
  }

  if (anticipos) agregarHojaAnticipos(workbook, { proyecto, cortes: cortesAIncluir, anticipos, esPreview, hastaNumero });

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


// ---------- Pestaña ANTICIPOS ----------
// Una sola pestaña que se actualiza con cada corte: los anticipos agrupados
// por el corte en que sumaron (se entregaron), lo amortizado en cada corte y
// el saldo pendiente. Su total cuadra con la fila "Anticipos pendientes de
// amortizar" del último corte (salvo centavos de redondeo, que se muestran).
function fechaExcel(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function diaSiguiente(iso) {
  const d = fechaExcel(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function textoFecha(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function agregarHojaAnticipos(workbook, { proyecto, cortes, anticipos, esPreview, hastaNumero }) {
  if (!cortes.length) return;
  const hoja = workbook.addWorksheet('ANTICIPOS');
  const ultimo = cortes[cortes.length - 1];
  const nombreCorte = (c) => (esPreview && c.numero === hastaNumero ? `Corte ${c.numero} (a hoy)` : `Corte ${c.numero}`);
  // Corte al que pertenece una fecha: el primero cuyo fecha_hasta la incluye.
  const corteDe = (fecha) => {
    const f = String(fecha || '').slice(0, 10);
    return cortes.find((c) => c.fecha_hasta && f <= String(c.fecha_hasta).slice(0, 10)) || null;
  };

  const lista = (anticipos.anticipos || []).map((a) => ({ ...a, corte: corteDe(a.fecha) })).filter((a) => a.corte);
  const amortPor = {}; // anticipo_id -> { numeroCorte: valor }
  (anticipos.amortizaciones || []).forEach((am) => {
    const c = corteDe(am.fecha);
    if (!c) return;
    amortPor[am.anticipo_id] = amortPor[am.anticipo_id] || {};
    amortPor[am.anticipo_id][c.numero] = (amortPor[am.anticipo_id][c.numero] || 0) + am.valor;
  });

  const base = [
    { key: 'folio', width: 14 }, { key: 'fecha', width: 11 }, { key: 'contratista', width: 30 },
    { key: 'concepto', width: 36 }, { key: 'contrato', width: 12 }, { key: 'valor', width: 15 },
  ];
  hoja.columns = [...base, ...cortes.map((c) => ({ key: `c${c.numero}`, width: 15 })), { key: 'saldo', width: 15 }];
  const nCols = base.length + cortes.length + 1;
  const colValor = 6;
  const colPrimerCorte = 7;
  const colSaldo = nCols;
  const L = columnaLetra;
  const rellenar = (fila, argb) => { for (let c = 1; c <= nCols; c += 1) hoja.getCell(fila, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };

  // Encabezado
  hoja.mergeCells(1, 1, 1, nCols);
  hoja.getCell(1, 1).value = `ANTICIPOS Y AMORTIZACIONES · ${proyecto?.nombre || ''}`;
  hoja.getCell(1, 1).font = { bold: true, size: 13, color: { argb: HUESO } };
  rellenar(1, CARBON);
  hoja.mergeCells(2, 1, 2, nCols);
  hoja.getCell(2, 1).value = `Hasta el ${nombreCorte(ultimo)} · ${textoFecha(ultimo.fecha_hasta)}`;
  hoja.getCell(2, 1).font = { bold: true, color: { argb: DORADO } };
  rellenar(2, CARBON);
  hoja.mergeCells(3, 1, 3, nCols);
  hoja.getCell(3, 1).value = 'Cada anticipo suma en el corte en que se entregó. Después, cuando la obra se ejecuta, se descuenta (amortiza) en los cortes siguientes y ese valor pasa a los ítems de obra.';
  hoja.getCell(3, 1).font = { italic: true, size: 9, color: { argb: 'FF6B655D' } };
  hoja.getCell(3, 1).alignment = { wrapText: true, vertical: 'top' };
  hoja.getRow(3).height = 28;

  const titulos = ['Anticipo', 'Fecha', 'Contratista', 'Concepto', 'Contrato', 'Valor anticipo',
    ...cortes.map((c) => `Amortizado en ${nombreCorte(c)}`), 'Saldo pendiente'];
  const filaEnc = 5;
  titulos.forEach((t, i) => {
    const celda = hoja.getCell(filaEnc, i + 1);
    celda.value = t;
    estilizarCelda(celda, { negrita: true, relleno: CARBON, colorTexto: HUESO, alineacion: i >= colValor - 1 ? 'right' : 'left', numero: false });
    celda.alignment = { ...celda.alignment, wrapText: true };
  });
  hoja.getRow(filaEnc).height = 30;

  let fila = filaEnc + 1;
  const filasSubtotal = [];
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  cortes.forEach((c, gi) => {
    const grupo = lista.filter((a) => a.corte.numero === c.numero);
    if (!grupo.length) return;
    const desde = gi === 0 ? null : cortes[gi - 1].fecha_hasta;
    hoja.mergeCells(fila, 1, fila, nCols);
    hoja.getCell(fila, 1).value = `${letras[filasSubtotal.length] || '·'}. Anticipos que sumaron en el ${nombreCorte(c)} `
      + (desde ? `(entregados entre el ${textoFecha(diaSiguiente(desde))} y el ${textoFecha(c.fecha_hasta)})` : `(entregados hasta el ${textoFecha(c.fecha_hasta)})`);
    hoja.getCell(fila, 1).font = { bold: true, color: { argb: 'FF7A5A32' } };
    rellenar(fila, DORADO_CLARO);
    fila += 1;
    const ini = fila;
    grupo.forEach((a) => {
      const valores = [a.folio, fechaExcel(a.fecha), a.contratista, a.concepto, a.contrato, a.valor];
      valores.forEach((v, i) => {
        const celda = hoja.getCell(fila, i + 1);
        celda.value = v;
        estilizarCelda(celda, { negrita: i === 0, alineacion: i >= colValor - 1 ? 'right' : (i === 1 ? 'center' : 'left'), numero: i === colValor - 1 });
        if (i === 1) celda.numFmt = 'dd/mm/yyyy';
      });
      cortes.forEach((ck, k) => {
        const celda = hoja.getCell(fila, colPrimerCorte + k);
        const v = amortPor[a.id]?.[ck.numero] || 0;
        celda.value = v;
        estilizarCelda(celda, { negrita: v > 0, colorTexto: v > 0 ? 'FF7A5A32' : undefined });
      });
      const celdaSaldo = hoja.getCell(fila, colSaldo);
      celdaSaldo.value = { formula: `${L(colValor)}${fila}-SUM(${L(colPrimerCorte)}${fila}:${L(colSaldo - 1)}${fila})` };
      estilizarCelda(celdaSaldo, { negrita: true });
      fila += 1;
    });
    const fin = fila - 1;
    hoja.mergeCells(fila, 1, fila, colValor - 1);
    hoja.getCell(fila, 1).value = `Subtotal ${letras[filasSubtotal.length] || ''}`;
    for (let col = colValor; col <= nCols; col += 1) {
      const celda = hoja.getCell(fila, col);
      celda.value = { formula: `SUM(${L(col)}${ini}:${L(col)}${fin})` };
      estilizarCelda(celda, { negrita: true, relleno: HUESO });
    }
    estilizarCelda(hoja.getCell(fila, 1), { negrita: true, relleno: HUESO, alineacion: 'right', numero: false });
    filasSubtotal.push(fila);
    fila += 2;
  });

  if (!filasSubtotal.length) {
    hoja.getCell(fila, 1).value = 'No hay anticipos registrados hasta este corte.';
    return;
  }
  // Total
  hoja.mergeCells(fila, 1, fila, colValor - 1);
  hoja.getCell(fila, 1).value = 'TOTAL';
  for (let col = colValor; col <= nCols; col += 1) {
    const celda = hoja.getCell(fila, col);
    celda.value = { formula: filasSubtotal.map((f) => `${L(col)}${f}`).join('+') };
    estilizarCelda(celda, { negrita: true, relleno: CARBON, colorTexto: col === colSaldo ? DORADO : HUESO });
  }
  estilizarCelda(hoja.getCell(fila, 1), { negrita: true, relleno: CARBON, colorTexto: HUESO, alineacion: 'right', numero: false });
  const filaTotal = fila;

  // Cuadre con el control presupuestal
  const saldoControl = Number(ultimo.anticipos_pendientes);
  if (Number.isFinite(saldoControl)) {
    fila += 2;
    hoja.mergeCells(fila, 1, fila, colSaldo - 1);
    hoja.getCell(fila, 1).value = `Saldo de anticipos pendientes de amortizar en el control presupuestal (${nombreCorte(ultimo)})`;
    estilizarCelda(hoja.getCell(fila, 1), { alineacion: 'right', numero: false });
    hoja.getCell(fila, colSaldo).value = saldoControl;
    estilizarCelda(hoja.getCell(fila, colSaldo), { negrita: true });
    fila += 1;
    hoja.mergeCells(fila, 1, fila, colSaldo - 1);
    hoja.getCell(fila, 1).value = 'Diferencia por redondeo de centavos (cortes anteriores)';
    estilizarCelda(hoja.getCell(fila, 1), { alineacion: 'right', numero: false });
    hoja.getCell(fila, colSaldo).value = { formula: `${L(colSaldo)}${fila - 1}-${L(colSaldo)}${filaTotal}` };
    estilizarCelda(hoja.getCell(fila, colSaldo), {});
    hoja.getCell(fila, colSaldo).numFmt = '#,##0.00';
  }
  hoja.views = [{ state: 'frozen', ySplit: filaEnc }];
}
