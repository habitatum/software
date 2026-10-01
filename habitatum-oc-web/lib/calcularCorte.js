// Lógica de "cortes" de control presupuestal: cada corte es una foto
// congelada de lo ejecutado en un periodo (normalmente mensual, para la
// reunión de seguimiento de costos con el cliente). El periodo se define por
// la fecha de la Orden de Compra (oc.fecha): fecha_desde = día siguiente al
// fecha_hasta del corte anterior (o sin límite inferior para el Corte 1),
// fecha_hasta = fecha de cierre elegida por el usuario.
//
// Una vez cerrado, un corte NO se recalcula: sus valores (presupuesto_corte_items,
// presupuesto_corte_ocs y anticipos_pendientes) quedan fijos para siempre.
//
// Desde la migración 046 el corte en curso lo calcula la base de datos
// (corte_control_en_curso) como "lo vivo − lo ya congelado", línea por línea:
//   · NUEVO: líneas que nunca entraron a un corte (OC con fecha ≤ cierre).
//   · AJUSTE: líneas de OC ya cortadas cuyo valor cambió (con su motivo).
// Así la suma de los cortes siempre cuadra con el ejecutado vivo. El cierre lo
// hace cerrar_corte_control() en una sola transacción (solo admin), y las OC
// de un corte cerrado quedan blindadas en la base de datos.

// Construye, a partir de los capítulos/ítems ya cargados en la página, un
// mapa presupuesto_item_id -> { codigo, descripcion, capituloCodigo } para
// poder denormalizar el detalle de cada corte sin otra consulta.
export function mapaItemsPresupuesto(capitulos) {
  const mapa = {};
  (capitulos || []).forEach((cap) => {
    (cap.presupuesto_items || []).forEach((it) => {
      mapa[it.id] = { codigo: it.codigo, descripcion: it.descripcion, capituloCodigo: cap.codigo };
    });
  });
  return mapa;
}

// Trae las Órdenes de Compra vigentes del proyecto cuya fecha cae en el rango
// (fechaDesde, fechaHasta] (fechaDesde null = sin límite inferior). Se lee de
// la vista calculada (no de la tabla base) para tener también subtotal_items,
// valor_iva, valor_aiu, descuento, valor_retenido y devolucion_retenido: los
// necesitamos para prorratear el IVA/AIU/Descuento/Retención neta de cada
// orden entre sus ítems (ver valorEjecutadoItem más abajo), exactamente igual
// que lo hace v_presupuesto_ejecutado en la base de datos.
export async function obtenerOCsEnRango(supabase, proyectoId, fechaDesde, fechaHasta) {
  let consulta = supabase
    .from('v_ordenes_compra_calculadas')
    .select('id, folio, fecha, subtotal, subtotal_items, valor_iva, valor_aiu, descuento, valor_retenido, devolucion_retenido, total, neto_a_pagar, estado, tipo_pago, proveedores(nombre), contratos(numero_contrato)')
    .eq('proyecto_id', proyectoId)
    .neq('estado', 'ANULADA')
    .lte('fecha', fechaHasta)
    .order('fecha', { ascending: false });
  if (fechaDesde) consulta = consulta.gt('fecha', fechaDesde);
  const { data, error } = await consulta;
  if (error) throw error;
  const ocs = data || [];

  // Igual que en la pantalla de Órdenes de Compra: una OC queda "totalmente
  // imputada" cuando CADA uno de sus ítems tiene asignaciones al presupuesto
  // cuyo porcentaje suma 100% (ver calcularImputacionCompleta más abajo).
  // Se anota aquí, en cada fila, para que la pestaña "Órdenes de Compra" del
  // Excel pueda mostrar el mismo check ✓ que ve el usuario en pantalla.
  const mapaImputacion = await calcularImputacionCompleta(supabase, ocs.map((o) => o.id));
  ocs.forEach((o) => { o.imputacion_completa = mapaImputacion[o.id] || false; });
  return ocs;
}

// Réplica exacta de la lógica de app/ordenes-compra/page.js: una OC queda
// "totalmente imputada" cuando tiene ítems Y CADA ítem tiene asignaciones al
// presupuesto (items_oc_presupuesto) cuyo porcentaje suma >= 99.99%.
async function calcularImputacionCompleta(supabase, ordenIds) {
  if (!ordenIds || ordenIds.length === 0) return {};
  const { data: itemsData, error } = await supabase
    .from('items_oc')
    .select('orden_compra_id, items_oc_presupuesto(porcentaje)')
    .in('orden_compra_id', ordenIds);
  if (error) throw error;
  const itemsPorOC = {};
  (itemsData || []).forEach((it) => {
    if (!itemsPorOC[it.orden_compra_id]) itemsPorOC[it.orden_compra_id] = [];
    itemsPorOC[it.orden_compra_id].push(it);
  });
  const mapa = {};
  ordenIds.forEach((id) => {
    const itemsDeEstaOC = itemsPorOC[id] || [];
    mapa[id] = itemsDeEstaOC.length > 0 && itemsDeEstaOC.every((it) => {
      const suma = (it.items_oc_presupuesto || []).reduce((acc, a) => acc + Number(a.porcentaje || 0), 0);
      return suma >= 99.99;
    });
  });
  return mapa;
}

// Valor realmente ejecutado de un ítem de OC: su subtotal (cantidad × valor
// unitario) más la parte proporcional que le corresponde del IVA + AIU menos
// el Descuento y la Retención neta (retenido - devolución) de ESA orden
// completa, repartido según el peso de ese ítem dentro del subtotal_items de
// la orden (la misma proporción que ya se muestra en la columna "% Orden" del
// detalle de cada OC). Así, la suma de los ítems de una OC siempre coincide
// exactamente con el Total de esa OC, y el Ejecutado del Presupuesto (este
// archivo, para los cortes/Excel) cuadra con el Ejecutado que ya muestra la
// pantalla de Presupuesto (v_presupuesto_ejecutado en la base de datos).
function valorEjecutadoItem(item, oc) {
  const subtotalItem = Number(item.cantidad || 0) * Number(item.valor_unitario || 0);
  // OJO: el prorrateo es sobre subtotal_items (la suma cruda de los ítems de
  // la orden), NO sobre subtotal (que en una orden ANTICIPO con % ya viene
  // reducido) — igual que v_presupuesto_ejecutado desde la migración 023.
  // Usar subtotal aquí infla el ejecutado de una orden ANTICIPO con % y
  // descuadra el Excel contra la pantalla de Presupuesto.
  const subtotalOC = Number(oc?.subtotal_items || 0);
  if (!oc || subtotalOC <= 0) return subtotalItem;
  // La retención neta (retenido - devolución) se resta igual que en
  // v_presupuesto_ejecutado desde la migración 026: el Ejecutado real es lo
  // que de verdad se le debe/pagó al contratista, no el bruto antes de
  // retener.
  const ajusteOC = Number(oc.valor_iva || 0) + Number(oc.valor_aiu || 0) - Number(oc.descuento || 0)
    - (Number(oc.valor_retenido || 0) - Number(oc.devolucion_retenido || 0));
  const proporcion = subtotalItem / subtotalOC;
  return subtotalItem + proporcion * ajusteOC;
}

// Agrupa una lista de items_oc por ítem de presupuesto, sumando cantidad y
// valor total (incluyendo la parte proporcional de IVA/AIU/Descuento/
// Retención neta de cada orden — ver valorEjecutadoItem). ocPorId: mapa id
// de OC -> fila de v_ordenes_compra_calculadas.
export function agruparPorItemPresupuesto(itemsOC, ocPorId = {}) {
  const mapa = {};
  itemsOC.forEach((it) => {
    const id = it.presupuesto_item_id;
    if (!mapa[id]) mapa[id] = { cantidad: 0, valor: 0 };
    mapa[id].cantidad += Number(it.cantidad || 0);
    mapa[id].valor += valorEjecutadoItem(it, ocPorId[it.orden_compra_id]);
  });
  return mapa;
}

// Saldo pendiente de amortizar de los Anticipos del proyecto, a una fecha
// dada: Total de cada Anticipo (dado hasta esa fecha) - lo ya amortizado por
// Órdenes de Compra normales fechadas hasta esa misma fecha. Un Anticipo no
// se vincula a un ítem específico del presupuesto, así que este saldo se
// suma APARTE del ejecutado por ítem — y se reduce solo, automáticamente, a
// medida que OCs con ítems reales lo van amortizando. Ver conversación:
// "Total Control Presupuestal = ítems ejecutados + anticipos pendientes"
// siempre coincide con el efectivo realmente entregado al contratista.
export async function calcularAnticiposPendientes(supabase, proyectoId, fechaHasta) {
  const { data: anticipos, error } = await supabase
    .from('v_ordenes_compra_calculadas')
    .select('id, total')
    .eq('proyecto_id', proyectoId)
    .eq('tipo_pago', 'ANTICIPO')
    .neq('estado', 'ANULADA')
    .lte('fecha', fechaHasta);
  if (error) throw error;
  if (!anticipos || anticipos.length === 0) return 0;

  const { data: amortizaciones, error: errAmort } = await supabase
    .from('v_ordenes_compra_calculadas')
    .select('referencia_anticipo_id, valor_amortizacion')
    .eq('proyecto_id', proyectoId)
    .neq('estado', 'ANULADA')
    .lte('fecha', fechaHasta)
    .not('referencia_anticipo_id', 'is', null);
  if (errAmort) throw errAmort;

  const amortizadoPorAnticipo = {};
  (amortizaciones || []).forEach((a) => {
    amortizadoPorAnticipo[a.referencia_anticipo_id] =
      (amortizadoPorAnticipo[a.referencia_anticipo_id] || 0) + Number(a.valor_amortizacion || 0);
  });

  return anticipos.reduce((acc, a) => {
    const amortizado = amortizadoPorAnticipo[a.id] || 0;
    const saldo = Number(a.total || 0) - amortizado;
    return acc + Math.max(saldo, 0);
  }, 0);
}

// Corte en curso (vista previa): líneas NUEVO + AJUSTE calculadas en la base de
// datos (corte_control_en_curso, migración 046) a la fecha de hoy.
// anticiposPendientes es siempre "a hoy" (saldo acumulado, no flujo del periodo).
export async function calcularPendientePorCortar(supabase, proyectoId, ultimoCorte, presupuestoId) {
  const fechaDesde = ultimoCorte?.fecha_hasta || null;
  const fechaHasta = new Date().toISOString().slice(0, 10);
  const { data: lineas, error } = await supabase.rpc('corte_control_en_curso', {
    p_presupuesto: presupuestoId, p_fecha_hasta: fechaHasta,
  });
  if (error) throw error;
  const filas = lineas || [];
  const porItem = {};
  filas.forEach((l) => {
    if (!porItem[l.presupuesto_item_id]) porItem[l.presupuesto_item_id] = { cantidad: 0, valor: 0 };
    porItem[l.presupuesto_item_id].cantidad += Number(l.cantidad || 0);
    porItem[l.presupuesto_item_id].valor += Number(l.valor || 0);
  });
  const ajustes = filas.filter((l) => l.tipo === 'AJUSTE');
  const totalNuevo = filas.filter((l) => l.tipo === 'NUEVO').reduce((a, l) => a + Number(l.valor || 0), 0);
  const totalAjustes = ajustes.reduce((a, l) => a + Number(l.valor || 0), 0);
  // Resumen de Órdenes de Compra del periodo (pestaña "Órdenes de Compra" del Excel).
  const ocs = await obtenerOCsEnRango(supabase, proyectoId, fechaDesde, fechaHasta);
  const anticiposPendientes = await calcularAnticiposPendientes(supabase, proyectoId, fechaHasta);
  return { ocs, lineas: filas, porItem, ajustes, totalNuevo, totalAjustes, fechaDesde, fechaHasta, anticiposPendientes };
}

// Cierra un corte nuevo en una sola transacción en la base de datos
// (cerrar_corte_control, solo admin): congela las líneas NUEVO y AJUSTE, el
// ejecutado por ítem y el saldo de anticipos pendientes a la fecha de cierre.
export async function cerrarCorte(supabase, { presupuestoId, fechaHasta }) {
  const { data, error } = await supabase.rpc('cerrar_corte_control', {
    p_presupuesto: presupuestoId, p_fecha_hasta: fechaHasta,
  });
  if (error) throw error;
  return data;
}

// Construye el mismo "shape" que produce cerrarCorte (items + ocs), pero a
// partir de datos ya calculados en memoria (el resultado de
// calcularPendientePorCortar) y SIN escribir nada en la base de datos. Sirve
// para poder exportar el Control Presupuestal "a hoy" — con el mismo formato
// del Excel de un corte — sin necesidad de cerrar oficialmente el corte.
export function construirCorteVirtual(pendiente, mapaItems, numero) {
  const items = Object.entries(pendiente.porItem || {}).map(([presupuesto_item_id, v]) => ({
    presupuesto_item_id,
    cantidad_ejecutada: v.cantidad,
    valor_ejecutado: v.valor,
  }));
  // Las líneas ya vienen calculadas por la base de datos (NUEVO y AJUSTE).
  const ocs = (pendiente.lineas || []).map((l) => ({
    orden_compra_id: l.orden_compra_id,
    folio: l.folio,
    fecha: l.fecha,
    proveedor: l.proveedor,
    capitulo_codigo: l.capitulo_codigo,
    item_codigo: l.item_codigo,
    item_descripcion: l.item_descripcion,
    descripcion: l.descripcion,
    cantidad: Number(l.cantidad || 0),
    valor_unitario: Number(l.valor_unitario || 0),
    valor: Number(l.valor || 0),
    tipo: l.tipo === 'AJUSTE' ? 'AJUSTE' : 'NORMAL',
    corte_origen: l.corte_origen,
    motivo: l.motivo,
  }));
  return {
    numero,
    fecha_desde: pendiente.fechaDesde,
    fecha_hasta: pendiente.fechaHasta,
    anticipos_pendientes: pendiente.anticiposPendientes,
    items,
    ocs,
    ordenesResumen: pendiente.ocs || [],
  };
}
