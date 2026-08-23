// ============================================================
// Lógica de cálculo de una Orden de Compra.
// Replica exactamente las fórmulas del sistema en Google Sheets
// (ver references/mapa_columnas.md del sistema anterior).
// Se usa tanto en el formulario (cálculo en vivo) como al generar el PDF,
// para garantizar que ambos lugares siempre calculen exactamente igual.
// ============================================================

export function calcularSubtotal(items) {
  return items.reduce((acc, it) => acc + (Number(it.cantidad) || 0) * (Number(it.valor_unitario) || 0), 0);
}

// Subtotal de los ítems que SÍ deben cobrar IVA: excluye los ítems marcados
// sin_iva (ej. "Transporte sin IVA", que muchas ferreterías no gravan). Estos
// ítems siguen sumando normalmente al Subtotal y al Total de la orden, solo
// se excluyen de la base sobre la que se calcula el IVA.
export function calcularSubtotalGravable(items) {
  return items.reduce(
    (acc, it) => acc + (it.sin_iva ? 0 : (Number(it.cantidad) || 0) * (Number(it.valor_unitario) || 0)),
    0
  );
}

export function calcularImpuestos(oc, subtotal, subtotalGravable = subtotal) {
  let valor_iva = 0, valor_administracion = 0, valor_imprevistos = 0, valor_utilidad = 0, valor_aiu = 0;

  if (oc.tipo_impuesto === 'CON_IVA') {
    // El IVA se cobra solo sobre la parte gravable (excluye ítems sin_iva).
    valor_iva = redondear(subtotalGravable * (oc.porcentaje_iva || 0) / 100);
  } else if (oc.tipo_impuesto === 'CON_AIU') {
    valor_administracion = redondear(subtotal * (oc.porcentaje_administracion || 0) / 100);
    valor_imprevistos = redondear(subtotal * (oc.porcentaje_imprevistos || 0) / 100);
    valor_utilidad = redondear(subtotal * (oc.porcentaje_utilidad || 0) / 100);
    valor_aiu = valor_administracion + valor_imprevistos + valor_utilidad;
    // Regla clave: el IVA de una orden CON AIU se cobra SOLO sobre la Utilidad,
    // nunca sobre Administración + Imprevistos, y se suma aparte al total.
    valor_iva = redondear(valor_utilidad * (oc.porcentaje_iva || 0) / 100);
  }

  const porcentaje_aiu = oc.tipo_impuesto === 'CON_AIU'
    ? (Number(oc.porcentaje_administracion || 0) + Number(oc.porcentaje_imprevistos || 0) + Number(oc.porcentaje_utilidad || 0))
    : 0;

  return { valor_iva, valor_administracion, valor_imprevistos, valor_utilidad, valor_aiu, porcentaje_aiu };
}

/**
 * Calcula todos los valores derivados de una Orden de Compra.
 * @param {object} oc - datos base de la orden (porcentajes, descuento, tipo_impuesto, etc.)
 * @param {array} items - ítems de la orden [{cantidad, valor_unitario, sin_iva}]
 * @param {number} pagado - suma de pagos ya registrados (de la tabla `pagos`)
 * @param {number} totalAnticipoReferenciado - Total de la OC de anticipo que esta orden amortiza (si aplica)
 */
export function calcularOrdenCompra(oc, items, pagado = 0, totalAnticipoReferenciado = 0) {
  const subtotal = calcularSubtotal(items);
  const subtotal_gravable = calcularSubtotalGravable(items);
  const { valor_iva, valor_administracion, valor_imprevistos, valor_utilidad, valor_aiu, porcentaje_aiu } =
    calcularImpuestos(oc, subtotal, subtotal_gravable);

  const descuento = Number(oc.descuento || 0);
  const total = redondear(subtotal - descuento + valor_iva + valor_aiu);

  const valor_retenido = redondear(total * (Number(oc.porcentaje_retencion) || 0) / 100);

  // El Anticipo es una OC más: no se amortiza a sí mismo. Fuera de eso, la
  // amortización puede ser un % del total (con toda la precisión decimal que
  // se necesite, ya no se trunca a 2 decimales) o un monto fijo en pesos,
  // según oc.tipo_amortizacion.
  const valor_amortizacion = oc.tipo_pago === 'ANTICIPO'
    ? 0
    : oc.tipo_amortizacion === 'VALOR_FIJO'
      ? redondear(Number(oc.valor_amortizacion_manual || 0))
      : redondear(total * (Number(oc.porcentaje_amortizacion) || 0) / 100);

  const devolucion_retenido = Number(oc.devolucion_retenido || 0);

  const neto_a_pagar = redondear(total - valor_amortizacion - valor_retenido + devolucion_retenido);
  const saldo = redondear(total - pagado);

  // Solo tiene sentido en la fila del propio Anticipo: cuánto le queda por amortizar.
  const saldo_anticipo_por_amortizar = oc.tipo_pago === 'ANTICIPO'
    ? redondear(total - (totalAnticipoReferenciado || 0))
    : null;

  return {
    subtotal, subtotal_gravable, valor_iva, valor_administracion, valor_imprevistos, valor_utilidad,
    valor_aiu, porcentaje_aiu, total, valor_retenido, valor_amortizacion,
    neto_a_pagar, pagado, saldo, saldo_anticipo_por_amortizar,
  };
}

// Verifica que la amortización que se va a guardar en una OC no se pase del
// saldo pendiente del Anticipo que referencia. `anticipo` debe venir de
// v_ordenes_compra_calculadas (trae saldo_anticipo_por_amortizar ya
// descontando lo amortizado por otras OC vigentes). Si esta MISMA orden ya
// tenía guardada una amortización contra el mismo anticipo (edición), ese
// valor se "libera" antes de comparar — si no, se estaría restando dos veces
// lo que la orden ya tenía amortizado.
export function validarAmortizacion({ anticipo, valorAmortizacion, referenciaId, referenciaOriginalId, valorAmortizacionGuardada }) {
  if (!anticipo || !referenciaId) return { ok: true, disponible: null, mensaje: '' };

  const EPS = 0.01; // tolerancia de centavos por redondeo
  const seLiberaPropia = referenciaId === referenciaOriginalId;
  const disponible = redondear(
    Number(anticipo.saldo_anticipo_por_amortizar || 0) + (seLiberaPropia ? Number(valorAmortizacionGuardada || 0) : 0)
  );

  if (Number(valorAmortizacion || 0) > disponible + EPS) {
    return {
      ok: false,
      disponible,
      mensaje: `El anticipo ${anticipo.folio} solo tiene ${formatoPesos(disponible)} pendiente por amortizar y se está intentando amortizar ${formatoPesos(valorAmortizacion)}. Ajusta el % o el monto.`,
    };
  }
  return {
    ok: true,
    disponible,
    mensaje: `Disponible en ${anticipo.folio} para amortizar: ${formatoPesos(disponible)}.`,
  };
}

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Convierte a número seguro cualquier valor que venga de un input de texto.
// Si el campo se deja vacío ("") o con algo no numérico, un input type="number"
// entrega ese "" tal cual en el estado de React, y si eso se manda directo a
// Supabase/Postgres para una columna numeric, la base de datos lo rechaza con
// "invalid input syntax for type numeric". Se usa justo antes de guardar
// (insert/update) para que un campo vacío se guarde como 0 en vez de romper.
export function numeroSeguro(valor, porDefecto = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

export function formatoPesos(valor) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(Number(valor) || 0);
}
