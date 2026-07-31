import * as XLSX from 'xlsx';

// Lee el cuadro de ítems de un contrato desde un archivo Excel/CSV.
//
// A propósito NO exige que el formato sea siempre exactamente el mismo: los
// cuadros de precios de HABITATUM son "muy similares" entre sí pero no
// idénticos (encabezados abreviados como "Valor Uni" en vez de "Valor
// Unitario", columnas de más como "Item" o "Subtotal", una fila de "TOTAL"
// al final, o alguna fila de título antes del encabezado real). Esta función
// intenta reconocer la intención del archivo en vez de exigir columnas
// exactas, y solo falla con un mensaje claro si de verdad no logra
// identificar Descripción, Cantidad y Valor unitario.

const NORMALIZAR_TILDES = /[̀-ͯ]/g;

function normalizar(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(NORMALIZAR_TILDES, '');
}

function palabrasDe(headerNormalizado) {
  return headerNormalizado.split(/[^a-z0-9]+/).filter(Boolean);
}

// Coincidencia exacta: el encabezado completo (ya normalizado) es igual a
// alguno de estos alias. Se revisan en orden de prioridad, así que las
// variantes más específicas ("descripcion") van antes que las más
// ambiguas ("item", que a veces es solo un código de renglón).
const ALIAS_EXACTOS = {
  descripcion: ['descripcion', 'concepto', 'actividad', 'descripcion del item', 'item', 'itm'],
  unidad: ['unidad', 'und', 'un', 'unid', 'unidad de medida'],
  cantidad: ['cantidad', 'cant', 'cnt'],
  valorUnitario: [
    'valor unitario', 'valor_unitario', 'valor uni', 'valor unit', 'valor und',
    'precio unitario', 'precio_unitario', 'precio uni', 'precio unit',
    'vr unitario', 'vr unit', 'vr uni', 'vlr unitario', 'vlr unit', 'vlr uni',
    'valor por unidad', 'precio por unidad',
  ],
};

// Coincidencia difusa por palabras clave, para cuando el encabezado no calza
// exacto con ningún alias pero claramente se refiere al mismo campo.
const CLAVES_DIFUSAS = {
  descripcion: [['descrip', 'concepto', 'activid']],
  cantidad: [['cant']],
  // Debe tener una palabra de "valor/precio" Y una palabra de "unidad/unitario"
  // en el mismo encabezado (ej. "Vr x Und", "Precio Unit").
  valorUnitario: [
    ['valor', 'precio', 'vr', 'vlr', 'costo'],
    ['uni', 'unit', 'unid', 'und'],
  ],
};

// Solo para valorUnitario: si nada más calzó, un encabezado que sea
// literalmente una sola de estas palabras también cuenta (cuadros donde la
// columna de precio unitario simplemente se llama "Valor" o "Precio").
const PALABRA_SUELTA_VALOR = ['valor', 'precio', 'vr', 'vlr', 'costo'];

function coincideDifuso(headerNormalizado, campo) {
  const grupos = CLAVES_DIFUSAS[campo];
  if (!grupos) return false;
  const palabras = palabrasDe(headerNormalizado);
  return grupos.every((raices) => palabras.some((palabra) => raices.some((raiz) => palabra.startsWith(raiz))));
}

function encontrarColumna(headers, campo) {
  const normalizados = headers.map(normalizar);

  // 1) coincidencia exacta, en orden de prioridad de alias
  for (const alias of ALIAS_EXACTOS[campo]) {
    const idx = normalizados.indexOf(normalizar(alias));
    if (idx !== -1) return headers[idx];
  }
  // 2) coincidencia difusa por palabras clave
  for (let i = 0; i < normalizados.length; i++) {
    if (coincideDifuso(normalizados[i], campo)) return headers[i];
  }
  // 3) solo para valor unitario: una palabra suelta tipo "Valor" o "Precio"
  if (campo === 'valorUnitario') {
    for (let i = 0; i < normalizados.length; i++) {
      if (PALABRA_SUELTA_VALOR.includes(normalizados[i])) return headers[i];
    }
  }
  return null;
}

// Convierte celdas de valores a número, soportando formatos como
// "$ 1.234.567", "1,234.56", "15000" o celdas ya numéricas.
function aNumero(valor) {
  if (typeof valor === 'number') return valor;
  if (valor == null) return 0;
  let s = String(valor).trim();
  if (!s) return 0;
  s = s.replace(/[^0-9,.\-]/g, '');
  if (!s) return 0;
  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');
  if (tieneComa && tienePunto) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (tieneComa) {
    const partes = s.split(',');
    s = partes[partes.length - 1].length <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (tienePunto) {
    const partes = s.split('.');
    if (partes.length > 2 || partes[partes.length - 1].length === 3) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const PALABRAS_TOTAL = ['total', 'subtotal', 'gran total', 'valor total', 'suma', 'totales'];
function esFilaDeTotal(descripcion) {
  const d = normalizar(descripcion);
  return PALABRAS_TOTAL.some((p) => d === p || d.startsWith(p + ' ') || d.endsWith(' ' + p));
}

// Entre las primeras filas de la hoja, busca cuál es la fila de encabezados
// reales (permite título, logo o filas vacías antes de los encabezados).
function encontrarFilaEncabezado(filasCrudas) {
  const MAX_FILAS_A_REVISAR = 15;
  let mejor = { indice: 0, encontrados: -1 };
  for (let i = 0; i < Math.min(MAX_FILAS_A_REVISAR, filasCrudas.length); i++) {
    const fila = (filasCrudas[i] || []).map((c) => (c == null ? '' : String(c)));
    if (fila.every((c) => !c.trim())) continue;
    const encontrados = ['descripcion', 'cantidad', 'valorUnitario'].filter((campo) => encontrarColumna(fila, campo)).length;
    if (encontrados > mejor.encontrados) mejor = { indice: i, encontrados };
    if (encontrados === 3) break;
  }
  return mejor.indice;
}

function elegirHoja(libro) {
  const preferidos = ['formulario de precios', 'precios', 'cuadro de items', 'cuadro de ítems', 'items', 'presupuesto'];
  const normalizados = libro.SheetNames.map(normalizar);
  for (const preferido of preferidos) {
    const idx = normalizados.findIndex((n) => n.includes(preferido));
    if (idx !== -1) return libro.SheetNames[idx];
  }
  return libro.SheetNames[0];
}

// Punto de entrada: recibe el ArrayBuffer leído del archivo y devuelve la
// lista de ítems, o lanza un Error con un mensaje claro en español.
export function parseItemsExcel(datosArrayBuffer) {
  const libro = XLSX.read(datosArrayBuffer, { type: 'array' });
  const nombreHoja = elegirHoja(libro);
  const hoja = libro.Sheets[nombreHoja];
  const filasCrudas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
  if (!filasCrudas.length) throw new Error('El archivo no tiene filas de datos.');

  const indiceEncabezado = encontrarFilaEncabezado(filasCrudas);
  const headers = (filasCrudas[indiceEncabezado] || []).map((c) => String(c ?? '').trim());

  const colDescripcion = encontrarColumna(headers, 'descripcion');
  const colUnidad = encontrarColumna(headers, 'unidad');
  const colCantidad = encontrarColumna(headers, 'cantidad');
  const colValorUnitario = encontrarColumna(headers, 'valorUnitario');

  if (!colDescripcion || !colCantidad || !colValorUnitario) {
    throw new Error(
      'No se encontraron las columnas esperadas (Descripción, Cantidad, Valor unitario). ' +
      'Columnas encontradas en el archivo: ' + headers.filter(Boolean).join(', ')
    );
  }

  const idxDescripcion = headers.indexOf(colDescripcion);
  const idxUnidad = colUnidad ? headers.indexOf(colUnidad) : -1;
  const idxCantidad = headers.indexOf(colCantidad);
  const idxValorUnitario = headers.indexOf(colValorUnitario);

  const items = [];
  for (let i = indiceEncabezado + 1; i < filasCrudas.length; i++) {
    const fila = filasCrudas[i] || [];
    const descripcion = String(fila[idxDescripcion] ?? '').trim();
    if (!descripcion || esFilaDeTotal(descripcion)) continue;
    const cantidad = aNumero(fila[idxCantidad]);
    const valorUnitario = aNumero(fila[idxValorUnitario]);
    items.push({
      descripcion,
      unidad: idxUnidad !== -1 ? String(fila[idxUnidad] ?? '').trim() : '',
      cantidad,
      valorUnitario,
      total: cantidad * valorUnitario,
    });
  }

  if (!items.length) throw new Error('No se encontraron filas con descripción para importar.');
  return items;
}
