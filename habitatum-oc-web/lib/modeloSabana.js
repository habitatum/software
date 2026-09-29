// ============================================================
// Modelo de la SÁBANA DE CORTES (réplica del Excel de cortes de obra).
// Lo usan: la pantalla de la sábana, la pantalla del corte nuevo (columna
// editable) y la descarga en Excel. Así los tres dan las mismas cifras.
// ============================================================

const n = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * @param items     contrato_items del contrato
 * @param cortes    cortes APROBADOS con corte_items (ordenados por número)
 * @param anticipos OC tipo anticipo del contrato ({ total })
 * @param edicion   opcional: corte en edición { numero, fecha, cantidades:{itemId:cant}, nuevos:[{tmpId, descripcion, unidad, valor_unitario, cantidad}], pctRetencion, amortizacion }
 */
export function construirSabana({ items = [], cortes = [], anticipos = [], edicion = null, valorContrato = 0 }) {
  const contractuales = items.filter((i) => !i.es_adicional);
  const adicionales = [
    ...items.filter((i) => i.es_adicional),
    ...((edicion?.nuevos || []).map((x) => ({
      id: `nuevo:${x.tmpId}`, tmpId: x.tmpId, es_nuevo: true, es_adicional: true, codigo: null,
      descripcion: x.descripcion, unidad: x.unidad, cantidad: null, valor_unitario: n(x.valor_unitario),
    }))),
  ];
  const todos = [...contractuales, ...adicionales];

  const columnas = cortes.map((c) => {
    const q = {};
    (c.corte_items || []).forEach((x) => { if (x.contrato_item_id) q[x.contrato_item_id] = (q[x.contrato_item_id] || 0) + n(x.cantidad); });
    return {
      id: c.id, numero: c.numero, fecha: c.fecha, folio: c.ordenes_compra?.folio || null, historico: c.historico, editable: false,
      cantidad: (itemId) => q[itemId] || 0,
      pctRetencion: n(c.porcentaje_retencion), retencion: n(c.valor_retencion), amortizacion: n(c.valor_amortizacion),
      descuento: n(c.descuento), neto: n(c.neto), notas: c.notas,
    };
  });

  if (edicion) {
    columnas.push({
      id: 'edicion', numero: edicion.numero, fecha: edicion.fecha, folio: null, editable: true,
      cantidad: (itemId) => (String(itemId).startsWith('nuevo:')
        ? n((edicion.nuevos || []).find((x) => `nuevo:${x.tmpId}` === itemId)?.cantidad)
        : n(edicion.cantidades?.[itemId])),
      pctRetencion: n(edicion.pctRetencion), amortizacion: n(edicion.amortizacion), descuento: 0,
    });
  }

  // Subtotales por columna
  columnas.forEach((col) => {
    col.subContrato = r2(contractuales.reduce((a, i) => a + col.cantidad(i.id) * n(i.valor_unitario), 0));
    col.subAdicionales = r2(adicionales.reduce((a, i) => a + col.cantidad(i.id) * n(i.valor_unitario), 0));
    col.total = r2(col.subContrato + col.subAdicionales);
    if (col.editable) {
      col.retencion = r2(col.total * col.pctRetencion / 100);
      col.neto = r2(col.total - col.retencion - col.amortizacion);
    }
    col.pctAmortizacion = col.total > 0 ? Math.round((col.amortizacion / col.total) * 10000) / 100 : 0;
  });

  const totalAnticipos = anticipos.reduce((a, x) => a + n(x.total), 0);
  const acumulado = {
    cantidad: (itemId) => columnas.reduce((a, c) => a + c.cantidad(itemId), 0),
    subContrato: r2(columnas.reduce((a, c) => a + c.subContrato, 0)),
    subAdicionales: r2(columnas.reduce((a, c) => a + c.subAdicionales, 0)),
    total: r2(columnas.reduce((a, c) => a + c.total, 0)),
    descuento: r2(columnas.reduce((a, c) => a + c.descuento, 0)),
    retencion: r2(columnas.reduce((a, c) => a + n(c.retencion), 0)),
    amortizacion: r2(columnas.reduce((a, c) => a + c.amortizacion, 0)),
  };
  acumulado.porAmortizar = r2(totalAnticipos - acumulado.amortizacion);
  // Igual que el Excel: TOTAL PAGADO = total cortes + por amortizar − retenido (= pagos de cortes + anticipos).
  acumulado.pagado = r2(acumulado.total - acumulado.descuento - acumulado.retencion + totalAnticipos - acumulado.amortizacion);

  const subtotalContratado = r2(contractuales.reduce((a, i) => a + n(i.cantidad) * n(i.valor_unitario), 0));
  return {
    contractuales, adicionales, todos, columnas, acumulado, totalAnticipos, subtotalContratado,
    pctAnticipo: n(valorContrato) > 0 ? Math.round((totalAnticipos / n(valorContrato)) * 1000) / 10 : 0,
    excede: (item) => item.cantidad != null && acumulado.cantidad(item.id) > n(item.cantidad) + 0.0005,
  };
}
