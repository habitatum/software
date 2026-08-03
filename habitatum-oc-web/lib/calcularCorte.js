// Lógica de "cortes" de control presupuestal: cada corte es una foto
// congelada de lo ejecutado en un periodo (normalmente mensual, para la
// reunión de seguimiento de costos con el cliente). El periodo se define por
// la fecha de la Orden de Compra (oc.fecha): fecha_desde = día siguiente al
// fecha_hasta del corte anterior (o sin límite inferior para el Corte 1),
// fecha_hasta = fecha de cierre elegida por el usuario.
//
// Una vez cerrado, un corte NO se recalcula: sus valores (presupuesto_corte_items,
// presupuesto_corte_ocs y anticipos_pendientes) quedan fijos para siempre,
// aunque después se edite o anule la Orden de Compra original.

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
// (fechaDesde, fechaHasta] (fechaDesde null = sin límite inferior).
async function obtenerOCsEnRango(supabase, proyectoId, fechaDesde, fechaHasta) {
  let consulta = supabase
    .from('ordenes_compra')
    .select('id, folio, fecha, proveedores(nombre)')
    .eq('proyecto_id', proyectoId)
    .neq('estado', 'ANULADA')
    .lte('fecha', fechaHasta);
  if (fechaDesde) consulta = consulta.gt('fecha', fechaDesde);
  const { data, error } = await consulta;
  if (error) throw error;
  return data || [];
}

// Trae los ítems de OC (vinculados a un ítem de presupuesto) de una lista de
// Órdenes de Compra.
async function obtenerItemsDeOrdenes(supabase, ordenIds) {
  if (ordenIds.length === 0) return [];
  const { data, error } = await supabase
    .from('items_oc')
    .select('id, orden_compra_id, descripcion, cantidad, valor_unitario, presupuesto_item_id')
    .in('orden_compra_id', ordenIds)
    .not('presupuesto_item_id', 'is', null);
  if (error) throw error;
  return data || [];
}

// Agrupa una lista de items_oc por ítem de presupuesto, sumando cantidad y
// valor total (cantidad * valor_unitario).
export function agruparPorItemPresupuesto(itemsOC) {
  const mapa = {};
  itemsOC.forEach((it) => {
    const id = it.presupuesto_item_id;
    if (!mapa[id]) mapa[id] = { cantidad: 0, valor: 0 };
    mapa[id].cantidad += Number(it.cantidad || 0);
    mapa[id].valor += Number(it.cantidad || 0) * Number(it.valor_unitario || 0);
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

// Calcula lo ejecutado (aún sin cortar) desde el fin del último corte hasta
// hoy: se usa para la vista previa en pantalla antes de cerrar el corte.
// anticiposPendientes es siempre "a hoy" (no depende del periodo del corte:
// es un saldo acumulado, no un flujo del periodo).
export async function calcularPendientePorCortar(supabase, proyectoId, ultimoCorte) {
  const fechaDesde = ultimoCorte?.fecha_hasta || null;
  const fechaHasta = new Date().toISOString().slice(0, 10);
  const ocs = await obtenerOCsEnRango(supabase, proyectoId, fechaDesde, fechaHasta);
  const items = await obtenerItemsDeOrdenes(supabase, ocs.map((o) => o.id));
  const anticiposPendientes = await calcularAnticiposPendientes(supabase, proyectoId, fechaHasta);
  return { ocs, items, porItem: agruparPorItemPresupuesto(items), fechaDesde, fechaHasta, anticiposPendientes };
}

// Cierra un corte nuevo: congela en BD lo ejecutado en el periodo, el
// detalle de Órdenes de Compra que lo componen, y el saldo de anticipos
// pendientes de amortizar a la fecha de cierre. Devuelve el corte creado.
export async function cerrarCorte(supabase, { presupuestoId, proyectoId, numero, ultimoCorte, fechaHasta, usuarioId, mapaItems }) {
  const fechaDesde = ultimoCorte?.fecha_hasta || null;

  const ocs = await obtenerOCsEnRango(supabase, proyectoId, fechaDesde, fechaHasta);
  const items = await obtenerItemsDeOrdenes(supabase, ocs.map((o) => o.id));
  const porItem = agruparPorItemPresupuesto(items);
  const anticiposPendientes = await calcularAnticiposPendientes(supabase, proyectoId, fechaHasta);
  const ocPorId = {};
  ocs.forEach((o) => { ocPorId[o.id] = o; });

  const { data: corte, error: errCorte } = await supabase
    .from('presupuesto_cortes')
    .insert({
      presupuesto_id: presupuestoId, numero, fecha_desde: fechaDesde, fecha_hasta: fechaHasta,
      creado_por: usuarioId, anticipos_pendientes: anticiposPendientes,
    })
    .select()
    .single();
  if (errCorte) throw errCorte;

  const filasCorteItems = Object.entries(porItem).map(([presupuesto_item_id, v]) => ({
    corte_id: corte.id,
    presupuesto_item_id,
    cantidad_ejecutada: v.cantidad,
    valor_ejecutado: v.valor,
  }));
  if (filasCorteItems.length > 0) {
    const { error } = await supabase.from('presupuesto_corte_items').insert(filasCorteItems);
    if (error) throw error;
  }

  const filasCorteOCs = items.map((it) => {
    const oc = ocPorId[it.orden_compra_id];
    const infoItem = mapaItems[it.presupuesto_item_id] || {};
    return {
      corte_id: corte.id,
      orden_compra_id: it.orden_compra_id,
      folio: oc?.folio || null,
      fecha: oc?.fecha || null,
      proveedor: oc?.proveedores?.nombre || null,
      capitulo_codigo: infoItem.capituloCodigo || null,
      item_codigo: infoItem.codigo || null,
      item_descripcion: infoItem.descripcion || null,
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad || 0),
      valor_unitario: Number(it.valor_unitario || 0),
      valor: Number(it.cantidad || 0) * Number(it.valor_unitario || 0),
    };
  });
  if (filasCorteOCs.length > 0) {
    const { error } = await supabase.from('presupuesto_corte_ocs').insert(filasCorteOCs);
    if (error) throw error;
  }

  return { ...corte, items: filasCorteItems, ocs: filasCorteOCs };
}
