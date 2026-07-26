import * as XLSX from 'xlsx';

// Parser del Excel de Presupuesto de HABITATUM. Mismo formato para todos los
// proyectos: siempre se lee la pestaña "FORMULARIO DE PRECIOS" (o la primera
// pestaña, si no encuentra una con ese nombre exacto).
//
// Estructura real de la hoja (ver 02_S. JORGE - CASA 101 - ZONA SOCIAL):
//   Fila con encabezados: ÍTEM | DESCRIPCIÓN | UNIDAD | CANTIDAD | VR UNITARIO | VR PARCIAL
//   Fila de CAPÍTULO: código SIN punto (ej. "14"), descripción = nombre del
//     capítulo, unidad/cantidad/vr unitario vacíos, vr parcial = subtotal.
//   Fila de ÍTEM: código CON punto (ej. "14.01"), con todos los datos.
//   Filas de "ZONA ..." (ej. "ZONA SOCIAL"): código vacío, se ignoran (solo
//     texto informativo, no afectan el presupuesto).
//   Filas de fila en blanco: separadores, se ignoran.
//   "TOTAL COSTOS DIRECTOS =": marca el fin de los capítulos de COSTOS
//     DIRECTOS; todo lo que sigue (ej. capítulo 27 "COSTOS INDIRECTOS") se
//     clasifica como categoria 'INDIRECTO'.
//   "TOTAL COSTOS INDIRECTOS =" y "VALOR TOTAL =": totales finales.

function normalizar(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita tildes
    .toUpperCase().trim();
}

function esNumero(v) {
  return typeof v === 'number' && !Number.isNaN(v);
}

/**
 * Parsea un ArrayBuffer (contenido del archivo .xlsx) y devuelve:
 * { nombreProyecto, capitulos: [{ codigo, nombre, categoria, valor_presupuestado, orden,
 *     items: [{ codigo, descripcion, unidad, cantidad, valor_unitario, valor_parcial, orden }] }],
 *   totales: { totalCostosDirectos, totalCostosIndirectos, valorTotal } }
 */
export function parsearPresupuesto(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const nombreHoja = wb.SheetNames.find((n) => normalizar(n) === 'FORMULARIO DE PRECIOS') || wb.SheetNames[0];
  const ws = wb.Sheets[nombreHoja];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  // Nombre del proyecto: primera fila que empiece con "PROYECTO:"
  let nombreProyecto = null;
  for (const fila of filas.slice(0, 5)) {
    const primera = normalizar(fila?.[0]);
    if (primera.startsWith('PROYECTO')) {
      nombreProyecto = String(fila[0]).split(':').slice(1).join(':').trim();
      break;
    }
  }

  // Fila de encabezados: busca "ÍTEM" y "DESCRIPCION" en la misma fila.
  let indiceEncabezado = -1;
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i] || [];
    const normalizada = fila.map(normalizar);
    if (normalizada.includes('ITEM') && normalizada.some((c) => c.startsWith('DESCRIPCION'))) {
      indiceEncabezado = i;
      break;
    }
  }
  if (indiceEncabezado === -1) {
    throw new Error('No se encontró la fila de encabezados (ÍTEM, DESCRIPCIÓN, ...) en la hoja "' + nombreHoja + '".');
  }

  const capitulos = [];
  let capituloActual = null;
  let categoriaActual = 'DIRECTO';
  let ordenCapitulo = 0;
  const totales = { totalCostosDirectos: null, totalCostosIndirectos: null, valorTotal: null };

  for (let i = indiceEncabezado + 1; i < filas.length; i++) {
    const fila = filas[i] || [];
    const [colCodigo, colDesc, colUnidad, colCantidad, colValorUnit, colValorParcial] = fila;
    const codigo = colCodigo === null || colCodigo === undefined ? '' : String(colCodigo).trim();
    const descNorm = normalizar(colDesc);

    // Filas de totales finales (sin código, descripción con "TOTAL"/"VALOR TOTAL")
    if (!codigo && descNorm.includes('TOTAL COSTOS DIRECTOS')) {
      totales.totalCostosDirectos = esNumero(colValorParcial) ? colValorParcial : null;
      categoriaActual = 'INDIRECTO';
      continue;
    }
    if (!codigo && descNorm.includes('TOTAL COSTOS INDIRECTOS')) {
      totales.totalCostosIndirectos = esNumero(colValorParcial) ? colValorParcial : null;
      continue;
    }
    if (!codigo && descNorm.includes('VALOR TOTAL')) {
      totales.valorTotal = esNumero(colValorParcial) ? colValorParcial : null;
      continue;
    }

    // Fila vacía o de sección/zona (sin código): se ignora.
    if (!codigo) continue;

    const esItem = codigo.includes('.');

    if (!esItem) {
      // Fila de CAPÍTULO. El valor_presupuestado del capítulo se recalcula
      // como la suma de sus ítems (más abajo, al terminar de leerlos) en vez
      // de usar directamente el VR PARCIAL de esta fila: en algunos Excel esa
      // celda viene vacía en la fila del capítulo aunque los ítems sí tengan
      // valores (ej. "COSTOS INDIRECTOS"), y sumar los ítems es más confiable.
      capituloActual = {
        codigo,
        nombre: (colDesc || '').toString().trim(),
        categoria: categoriaActual,
        valor_presupuestado_excel: esNumero(colValorParcial) ? colValorParcial : 0,
        valor_presupuestado: 0,
        orden: ordenCapitulo++,
        items: [],
      };
      capitulos.push(capituloActual);
    } else {
      // Fila de ÍTEM: pertenece al último capítulo visto. Si por algún motivo
      // no hay capítulo previo (Excel mal formado), se crea uno genérico.
      if (!capituloActual) {
        capituloActual = {
          codigo: codigo.split('.')[0],
          nombre: 'Sin capítulo',
          categoria: categoriaActual,
          valor_presupuestado: 0,
          orden: ordenCapitulo++,
          items: [],
        };
        capitulos.push(capituloActual);
      }
      capituloActual.items.push({
        codigo,
        descripcion: (colDesc || '').toString().trim(),
        unidad: colUnidad ? String(colUnidad).trim() : null,
        cantidad: esNumero(colCantidad) ? colCantidad : null,
        valor_unitario: esNumero(colValorUnit) ? colValorUnit : null,
        valor_parcial: esNumero(colValorParcial) ? colValorParcial : 0,
        orden: capituloActual.items.length,
      });
    }
  }

  if (capitulos.length === 0) {
    throw new Error('No se encontraron capítulos ni ítems en la hoja "' + nombreHoja + '". Verifica el formato del Excel.');
  }

  // Recalcula el valor presupuestado de cada capítulo como la suma de sus
  // ítems (con respaldo en el valor leído del Excel si el capítulo no trae
  // ítems, caso atípico).
  for (const cap of capitulos) {
    const sumaItems = cap.items.reduce((acc, it) => acc + (it.valor_parcial || 0), 0);
    cap.valor_presupuestado = cap.items.length > 0 ? sumaItems : cap.valor_presupuestado_excel;
    delete cap.valor_presupuestado_excel;
  }

  return { nombreProyecto, nombreHoja, capitulos, totales };
}
