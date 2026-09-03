'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { parsearPresupuesto } from '@/lib/parsePresupuesto';
import { calcularPendientePorCortar, cerrarCorte, mapaItemsPresupuesto, construirCorteVirtual } from '@/lib/calcularCorte';
import { exportarControlPresupuestal, prepararCortesParaExportar } from '@/lib/exportarControlPresupuestal';
import NavBar from '@/components/NavBar';

export default function Presupuesto() {
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const [presupuesto, setPresupuesto] = useState(null);
  const [capitulos, setCapitulos] = useState([]);
  const [ejecutados, setEjecutados] = useState({}); // presupuesto_item_id -> ejecutado
  const [expandidos, setExpandidos] = useState({});
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const [cortes, setCortes] = useState([]);
  const [pendiente, setPendiente] = useState(null);
  const [cerrando, setCerrando] = useState(false);
  const [exportando, setExportando] = useState(null);
  const [fechaCierre, setFechaCierre] = useState(new Date().toISOString().slice(0, 10));

  // Modal de "inspeccionar ítem": qué costos de Órdenes de Compra están
  // cargados en un ítem del presupuesto.
  const [modalItem, setModalItem] = useState(null);
  const [detalleItem, setDetalleItem] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Modal de "agregar ítem adicional": siempre va a un capítulo fijo
  // llamado "Adicionales" al final del presupuesto (se crea si no existe),
  // para no tocar nunca los capítulos del presupuesto aprobado.
  const [modalAgregarItem, setModalAgregarItem] = useState(false);
  const [nuevoItem, setNuevoItem] = useState({ codigo: '', descripcion: '', unidad: '', cantidad: '', valor_unitario: '' });
  const [guardandoItem, setGuardandoItem] = useState(false);

  async function cargar() {
    setCargandoDatos(true);
    const supabase = crearClienteSupabase();
    const { data: p } = await supabase.from('presupuestos').select('*, usuarios(nombre)').eq('proyecto_id', proyecto.id).maybeSingle();
    setPresupuesto(p || null);

    if (p) {
      const { data: caps } = await supabase
        .from('presupuesto_capitulos')
        .select('*, presupuesto_items(*)')
        .eq('presupuesto_id', p.id)
        .order('orden');
      const capsOrdenados = (caps || []).map((c) => ({
        ...c,
        presupuesto_items: (c.presupuesto_items || []).slice().sort((a, b) => a.orden - b.orden),
      }));
      setCapitulos(capsOrdenados);

      const { data: ejec } = await supabase.from('v_presupuesto_ejecutado').select('*');
      const mapa = {};
      (ejec || []).forEach((e) => { mapa[e.presupuesto_item_id] = Number(e.ejecutado) || 0; });
      setEjecutados(mapa);

      const { data: cortesData } = await supabase
        .from('presupuesto_cortes')
        .select('*, presupuesto_corte_items(*), presupuesto_corte_ocs(*)')
        .eq('presupuesto_id', p.id)
        .order('numero');
      const cortesNormalizados = (cortesData || []).map((c) => ({
        ...c,
        items: c.presupuesto_corte_items || [],
        ocs: c.presupuesto_corte_ocs || [],
      }));
      setCortes(cortesNormalizados);

      const ultimoCorte = cortesNormalizados[cortesNormalizados.length - 1] || null;
      const pend = await calcularPendientePorCortar(supabase, proyecto.id, ultimoCorte);
      setPendiente(pend);
    } else {
      setCapitulos([]);
      setEjecutados({});
      setCortes([]);
      setPendiente(null);
    }
    setCargandoDatos(false);
  }

  useEffect(() => { if (usuario && proyecto) cargar(); }, [usuario, proyecto]); // eslint-disable-line

  async function confirmarCierreCorte() {
    if (!window.confirm(`¿Cerrar el Corte ${cortes.length + 1} con fecha de corte ${fechaCierre}? Una ver cerrado no se puede modificar.`)) return;
    setCerrando(true);
    setError('');
    try {
      const supabase = crearClienteSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const ultimoCorte = cortes[cortes.length - 1] || null;
      await cerrarCorte(supabase, {
        presupuestoId: presupuesto.id,
        proyectoId: proyecto.id,
        numero: cortes.length + 1,
        ultimoCorte,
        fechaHasta: fechaCierre,
        usuarioId: session?.user?.id || null,
        mapaItems: mapaItemsPresupuesto(capitulos),
      });
      await cargar();
    } catch (err) {
      setError(err.message || 'No se pudo cerrar el corte.');
    } finally {
      setCerrando(false);
    }
  }

  async function exportar(hastaNumero) {
    setExportando(hastaNumero);
    setError('');
    try {
      const cortesPreparados = prepararCortesParaExportar(cortes, capitulos);
      await exportarControlPresupuestal({ proyecto, presupuesto, capitulos, cortes: cortesPreparados, hastaNumero });
    } catch (err) {
      setError(err.message || 'No se pudo exportar el control presupuestal.');
    } finally {
      setExportando(null);
    }
  }

  // Descarga el Excel de Control Presupuestal con exactamente el mismo
  // formato de un corte, pero usando lo ejecutado "a hoy" (lo mismo que se
  // muestra en el bloque "Ejecutado sin cortar...") sin cerrar/congelar
  // ningún corte nuevo en la base de datos.
  async function exportarSinCorte() {
    setExportando('preview');
    setError('');
    try {
      const numeroVirtual = cortes.length + 1;
      const corteVirtual = construirCorteVirtual(pendiente, mapaItemsPresupuesto(capitulos), numeroVirtual);
      const cortesPreparados = prepararCortesParaExportar([...cortes, corteVirtual], capitulos);
      await exportarControlPresupuestal({
        proyecto,
        presupuesto,
        capitulos,
        cortes: cortesPreparados,
        hastaNumero: numeroVirtual,
        esPreview: true,
      });
    } catch (err) {
      setError(err.message || 'No se pudo exportar la vista previa del control presupuestal.');
    } finally {
      setExportando(null);
    }
  }

  function toggleCapitulo(id) {
    setExpandidos((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Trae, para un ítem puntual del presupuesto, el detalle de qué líneas de
  // qué Órdenes de Compra están cargadas contra él (para el botón "Ver").
  async function inspeccionarItem(it) {
    setModalItem(it);
    setDetalleItem(null);
    setCargandoDetalle(true);
    try {
      const supabase = crearClienteSupabase();
      // Desde la migración 028, un ítem de OC puede estar imputado a varios
      // ítems del presupuesto por %; se consulta la tabla puente
      // items_oc_presupuesto (no items_oc.presupuesto_item_id directamente)
      // y se prorratea la cantidad mostrada según el % de cada imputación.
      const { data, error: errDetalle } = await supabase
        .from('items_oc_presupuesto')
        .select('porcentaje, items_oc(id, descripcion, cantidad, valor_unitario, orden_compra_id, ordenes_compra(folio, fecha, estado, proveedores(nombre)))')
        .eq('presupuesto_item_id', it.id);
      if (errDetalle) throw errDetalle;
      const filas = (data || [])
        .filter((d) => d.items_oc && d.items_oc.ordenes_compra?.estado !== 'ANULADA')
        .map((d) => ({
          id: d.items_oc.id,
          descripcion: d.items_oc.descripcion,
          cantidad: Number(d.items_oc.cantidad || 0) * (Number(d.porcentaje || 0) / 100),
          valor_unitario: d.items_oc.valor_unitario,
          porcentaje: Number(d.porcentaje || 0),
          orden_compra_id: d.items_oc.orden_compra_id,
          ordenes_compra: d.items_oc.ordenes_compra,
        }));
      filas.sort((a, b) => (a.ordenes_compra?.fecha || '').localeCompare(b.ordenes_compra?.fecha || ''));
      setDetalleItem(filas);
    } catch (err) {
      setError(err.message || 'No se pudo cargar el detalle del ítem.');
      setModalItem(null);
    } finally {
      setCargandoDetalle(false);
    }
  }

  function cerrarModalItem() {
    setModalItem(null);
    setDetalleItem(null);
  }

function abrirAgregarItem() {
    setModalAgregarItem(true);
    setNuevoItem({ codigo: '', descripcion: '', unidad: '', cantidad: '', valor_unitario: '' });
  }

  function cerrarAgregarItem() {
    setModalAgregarItem(false);
  }

  async function guardarNuevoItem(e) {
    e.preventDefault();
    setGuardandoItem(true);
    try {
      const supabase = crearClienteSupabase();
      const cantidad = Number(nuevoItem.cantidad) || 0;
      const valorUnitario = Number(nuevoItem.valor_unitario) || 0;
      const valorParcial = cantidad * valorUnitario;

      // Los ítems adicionales van siempre a un capítulo "Adicionales" al
      // final del presupuesto (se crea la primera vez que se usa). Así el
      // presupuesto aprobado (los demás capítulos) nunca se modifica.
      let capAdicionales = capitulos.find((c) => c.nombre === 'Adicionales');
      if (!capAdicionales) {
        const maxOrden = capitulos.reduce((acc, c) => Math.max(acc, Number(c.orden) || 0), 0);
        const { data: nuevoCap, error: errCap } = await supabase
          .from('presupuesto_capitulos')
          .insert({
            presupuesto_id: presupuesto.id,
            codigo: 'ADIC',
            nombre: 'Adicionales',
            categoria: 'Adicionales',
            valor_presupuestado: 0,
            orden: maxOrden + 1,
          })
          .select()
          .single();
        if (errCap) throw errCap;
        capAdicionales = { ...nuevoCap, presupuesto_items: [] };
      }

      const orden = (capAdicionales.presupuesto_items || []).length;
      const { error: errInsert } = await supabase.from('presupuesto_items').insert({
        capitulo_id: capAdicionales.id,
        codigo: nuevoItem.codigo,
        descripcion: nuevoItem.descripcion,
        unidad: nuevoItem.unidad,
        cantidad,
        valor_unitario: valorUnitario,
        valor_parcial: valorParcial,
        orden,
      });
      if (errInsert) throw errInsert;

      const nuevoValorCap = Number(capAdicionales.valor_presupuestado || 0) + valorParcial;
      const { error: errUpdateCap } = await supabase
        .from('presupuesto_capitulos')
        .update({ valor_presupuestado: nuevoValorCap })
        .eq('id', capAdicionales.id);
      if (errUpdateCap) throw errUpdateCap;

      setModalAgregarItem(false);
      await cargar();
    } catch (err) {
      setError(err.message || 'No se pudo agregar el ítem adicional.');
    } finally {
      setGuardandoItem(false);
    }
  }

  async function subirArchivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (presupuesto && !window.confirm('Ya existe un presupuesto cargado para este proyecto. Subir uno nuevo REEMPLAZARÁ todos los capítulos e ítems actuales (y se perderán los vínculos con Órdenes de Compra ya guardados). ¿Continuar?')) {
      e.target.value = '';
      return;
    }
    setError('');
    setSubiendo(true);
    try {
      const buffer = await file.arrayBuffer();
      const datos = parsearPresupuesto(buffer);

      const supabase = crearClienteSupabase();
      const { data: { session } } = await supabase.auth.getSession();

      // Reemplaza todo: borra el presupuesto anterior del proyecto (cascada
      // borra capítulos e ítems) y crea uno nuevo.
      await supabase.from('presupuestos').delete().eq('proyecto_id', proyecto.id);

      const { data: nuevoPresupuesto, error: errP } = await supabase
        .from('presupuestos')
        .insert({
          proyecto_id: proyecto.id,
          nombre_archivo: file.name,
          total_costos_directos: datos.totales.totalCostosDirectos,
          total_costos_indirectos: datos.totales.totalCostosIndirectos,
          valor_total: datos.totales.valorTotal,
          cargado_por: session?.user?.id || null,
        })
        .select()
        .single();
      if (errP) throw errP;

      const filasCapitulos = datos.capitulos.map((c) => ({
        presupuesto_id: nuevoPresupuesto.id,
        codigo: c.codigo,
        nombre: c.nombre,
        categoria: c.categoria,
        valor_presupuestado: c.valor_presupuestado,
        orden: c.orden,
      }));
      const { data: capsInsertados, error: errCaps } = await supabase
        .from('presupuesto_capitulos')
        .insert(filasCapitulos)
        .select('id, codigo');
      if (errCaps) throw errCaps;

      const idPorCodigo = {};
      capsInsertados.forEach((c) => { idPorCodigo[c.codigo] = c.id; });

      const filasItems = [];
      datos.capitulos.forEach((c) => {
        c.items.forEach((it) => {
          filasItems.push({
            capitulo_id: idPorCodigo[c.codigo],
            codigo: it.codigo,
            descripcion: it.descripcion,
            unidad: it.unidad,
            cantidad: it.cantidad,
            valor_unitario: it.valor_unitario,
            valor_parcial: it.valor_parcial,
            orden: it.orden,
          });
        });
      });
      if (filasItems.length > 0) {
        const { error: errItems } = await supabase.from('presupuesto_items').insert(filasItems);
        if (errItems) throw errItems;
      }

      await cargar();
    } catch (err) {
      setError(err.message || 'No se pudo cargar el presupuesto.');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  if (cargando || !usuario || cargandoProyecto || !proyecto) return null;

  const totalPresupuestado = capitulos.reduce((acc, c) => acc + Number(c.valor_presupuestado || 0), 0);
  const totalEjecutado = capitulos.reduce((acc, c) => acc + sumaEjecutadoCapitulo(c, ejecutados), 0);
  const anticiposPendientesHoy = pendiente?.anticiposPendientes || 0;
  const totalControlPresupuestal = totalEjecutado + anticiposPendientesHoy;
  // % de administración: campo independiente y editable por proyecto
  // (Proyectos > Editar), NO derivado de ningún ítem del presupuesto
  // cargado. Se aplica sobre el Total Control Presupuestal (ejecutado +
  // anticipos pendientes de amortizar), el mismo total "para cobro" de
  // arriba, para que la Administración cobrada crezca con el avance real
  // de la obra y con los anticipos entregados, sin doble-contar cuando
  // luego se amorticen.
  const pctAdmin = Number(proyecto?.porcentaje_administracion || 0);
  const valorAdministracion = totalControlPresupuestal * (pctAdmin / 100);

  // Fila por corte con el acumulado corrido de ítems ejecutados (no solo lo
  // de ese periodo) + el saldo de anticipos pendientes congelado a esa
  // fecha, para mostrar el Total Control Presupuestal real de cada corte.
  let acumuladoItemsCorte = 0;
  const filasCortes = cortes.map((c) => {
    const valorCorte = (c.items || []).reduce((acc, it) => acc + Number(it.valor_ejecutado || 0), 0);
    acumuladoItemsCorte += valorCorte;
    const anticiposCorte = Number(c.anticipos_pendientes || 0);
    return { corte: c, valorCorte, anticiposCorte, totalAcumulado: acumuladoItemsCorte + anticiposCorte };
  });

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-8 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Presupuesto</h1>
            <p className="text-sm text-neutral-500">{proyecto.nombre}</p>
          </div>
          {usuario.rol === 'admin' && (
            <div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" id="input-presupuesto" onChange={subirArchivo} />
              <label htmlFor="input-presupuesto"
                className="bg-carbon text-hueso px-4 py-2 rounded text-sm cursor-pointer inline-block disabled:opacity-50">
                {subiendo ? 'Cargando...' : presupuesto ? 'Reemplazar presupuesto (Excel)' : 'Cargar presupuesto (Excel)'}
              </label>
            </div>
          )}
        </div>

        {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}

        {cargandoDatos ? null : !presupuesto ? (
          <div className="bg-white rounded-lg shadow-sm border p-8 text-center text-neutral-500">
            <p>Este proyecto todavía no tiene un presupuesto cargado.</p>
            {usuario.rol !== 'admin' && <p className="text-sm mt-1">Pídele a un administrador que cargue el Excel del presupuesto (pestaña &quot;FORMULARIO DE PRECIOS&quot;).</p>}
          </div>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-sm border p-5 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Dato label="Archivo cargado" valor={presupuesto.nombre_archivo} />
              <Dato label="Cargado por" valor={presupuesto.usuarios?.nombre} />
              <Dato label="Fecha de carga" valor={new Date(presupuesto.cargado_en).toLocaleString('es-CO')} />
              <Dato label="Valor total presupuesto" valor={formatoPesos(presupuesto.valor_total)} />
            </div>

            <div className="bg-carbon text-hueso rounded-lg p-5 grid grid-cols-3 gap-4 text-sm">
              <FilaResumenGrande label="Presupuestado" valor={totalPresupuestado} />
              <FilaResumenGrande label="Ejecutado (ítems)" valor={totalEjecutado} />
              <FilaResumenGrande label="Saldo" valor={totalPresupuestado - totalEjecutado} />
            </div>

            <div className={`bg-white rounded-lg shadow-sm border p-5 grid grid-cols-2 ${pctAdmin > 0 ? 'md:grid-cols-3' : ''} gap-4 text-sm`}>
              <div>
                <p className="text-neutral-500 text-xs mb-1">Anticipos pendientes de amortizar (a hoy)</p>
                <p className="text-lg font-semibold">{formatoPesos(anticiposPendientesHoy)}</p>
                <p className="text-[11px] text-neutral-400 mt-1">
                  Anticipos entregados que aún no se han vinculado a ítems reales del presupuesto (se reduce solo a medida que se amortizan).
                </p>
              </div>
              <div>
                <p className="text-neutral-500 text-xs mb-1">Total Control Presupuestal (para cobro)</p>
                <p className="text-lg font-semibold text-dorado">{formatoPesos(totalControlPresupuestal)}</p>
                <p className="text-[11px] text-neutral-400 mt-1">Ejecutado por ítems (ya neto de retención) + Anticipos pendientes de amortizar.</p>
              </div>
              {pctAdmin > 0 && (
                <div>
                  <p className="text-neutral-500 text-xs mb-1">Administración ({pctAdmin}%)</p>
                  <p className="text-lg font-semibold text-carbon">{formatoPesos(valorAdministracion)}</p>
                  <p className="text-[11px] text-neutral-400 mt-1">
                    % configurado en Proyectos &gt; Editar, calculado sobre el Total Control Presupuestal (ejecutado + anticipos pendientes).
                  </p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Cortes de Control Presupuestal</h2>
                {cortes.length > 0 && (
                  <button
                    onClick={() => exportar(cortes[cortes.length - 1].numero)}
                    disabled={exportando !== null}
                    className="text-sm border rounded px-3 py-1.5 hover:bg-gris-calido/20"
                  >
                    {exportando === cortes[cortes.length - 1].numero ? 'Exportando...' : `Exportar último corte (Corte ${cortes[cortes.length - 1].numero})`}
                  </button>
                )}
              </div>

              {cortes.length === 0 && (
                <p className="text-sm text-neutral-500">Todavía no se ha cerrado ningún corte para este proyecto.</p>
              )}

              {cortes.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="text-left text-neutral-500">
                    <tr>
                      <th className="py-1">Corte</th>
                      <th className="py-1">Periodo</th>
                      <th className="py-1 text-right">Ejecutado en el periodo</th>
                      <th className="py-1 text-right">Anticipos pendientes</th>
                      <th className="py-1 text-right">Total acumulado a este corte</th>
                      <th className="py-1 w-40"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasCortes.map(({ corte: c, valorCorte, anticiposCorte, totalAcumulado }) => (
                      <tr key={c.id} className="border-t">
                        <td className="py-2 font-medium">Corte {c.numero}</td>
                        <td className="py-2 text-neutral-500">{c.fecha_desde ? `${c.fecha_desde} → ${c.fecha_hasta}` : `hasta ${c.fecha_hasta}`}</td>
                        <td className="py-2 text-right">{formatoPesos(valorCorte)}</td>
                        <td className="py-2 text-right text-neutral-500">{formatoPesos(anticiposCorte)}</td>
                        <td className="py-2 text-right font-semibold">{formatoPesos(totalAcumulado)}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => exportar(c.numero)} disabled={exportando !== null} className="text-xs border rounded px-2 py-1 hover:bg-gris-calido/20">
                            {exportando === c.numero ? 'Exportando...' : 'Exportar hasta aquí'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {usuario.rol !== 'lectura' && pendiente && (
                <div className="bg-gris-calido/10 border border-gris-calido/40 rounded p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="text-sm">
                    <p className="text-neutral-500">
                      Ejecutado sin cortar {pendiente.fechaDesde ? `desde ${pendiente.fechaDesde}` : 'desde el inicio'} hasta hoy ({pendiente.ocs.length} Órdenes de Compra):
                    </p>
                    <p className="font-semibold text-base">
                      {formatoPesos(Object.values(pendiente.porItem).reduce((acc, v) => acc + v.valor, 0))}
                    </p>
                    <p className="text-neutral-500 mt-2">Anticipos pendientes de amortizar (a hoy):</p>
                    <p className="font-semibold text-base">{formatoPesos(pendiente.anticiposPendientes)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={exportarSinCorte}
                      disabled={exportando !== null}
                      className="text-sm border rounded px-3 py-1.5 hover:bg-gris-calido/20 disabled:opacity-50"
                    >
                      {exportando === 'preview' ? 'Exportando...' : 'Descargar Control Pptal sin hacer corte'}
                    </button>
                    <label className="text-xs text-neutral-500">Fecha de cierre</label>
                    <input type="date" value={fechaCierre} onChange={(e) => setFechaCierre(e.target.value)} className="border rounded px-2 py-1 text-sm" />
                    <button
                      onClick={confirmarCierreCorte}
                      disabled={cerrando}
                      className="bg-carbon text-hueso px-4 py-1.5 rounded text-sm disabled:opacity-50"
                    >
                      {cerrando ? 'Cerrando...' : `Cerrar Corte ${cortes.length + 1}`}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={abrirAgregarItem}
                className="text-xs border rounded px-3 py-1.5 hover:bg-gris-calido/20 text-dorado"
              >
                + Agregar ítem adicional
              </button>
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gris-calido/30 text-left">
                  <tr>
                    <th className="p-3 w-24">Ítem</th>
                    <th className="p-3">Descripción</th>
                    <th className="p-3 text-right">Presupuestado</th>
                    <th className="p-3 text-right">Ejecutado</th>
                    <th className="p-3 text-right">Saldo</th>
                    <th className="p-3 text-right w-20">% Usado</th>
                    <th className="p-3 w-32">Estado</th>
                    <th className="p-3 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {capitulos.map((cap) => {
                    const ejecutadoCap = sumaEjecutadoCapitulo(cap, ejecutados);
                    const presupuestadoCap = Number(cap.valor_presupuestado || 0);
                    const saldoCap = presupuestadoCap - ejecutadoCap;
                    const pctCap = presupuestadoCap > 0 ? (ejecutadoCap / presupuestadoCap) * 100 : 0;
                    const estado = estadoDe(presupuestadoCap, ejecutadoCap);
                    const abierto = !!expandidos[cap.id];
                    return (
                      <Fragment key={cap.id}>
                        <tr className="border-t bg-gris-calido/20 font-semibold cursor-pointer hover:bg-gris-calido/30" onClick={() => toggleCapitulo(cap.id)}>
                          <td className="p-3">{abierto ? '▾' : '▸'} {cap.codigo}</td>
                          <td className="p-3">{cap.nombre}</td>
                          <td className="p-3 text-right">{formatoPesos(presupuestadoCap)}</td>
                          <td className="p-3 text-right">{formatoPesos(ejecutadoCap)}</td>
                          <td className="p-3 text-right">{formatoPesos(saldoCap)}</td>
                          <td className="p-3 text-right">{pctCap.toFixed(0)}%</td>
                          <td className="p-3"><Estado estado={estado} /></td>
                          <td className="p-3"></td>
                        </tr>
                        {abierto && cap.presupuesto_items.map((it) => {
                          const ej = ejecutados[it.id] || 0;
                          const pres = Number(it.valor_parcial || 0);
                          return (
                            <tr key={it.id} className="border-t text-neutral-600">
                              <td className="p-3 pl-6">{it.codigo}</td>
                              <td className="p-3">{it.descripcion}</td>
                              <td className="p-3 text-right">{formatoPesos(pres)}</td>
                              <td className="p-3 text-right">{formatoPesos(ej)}</td>
                              <td className="p-3 text-right">{formatoPesos(pres - ej)}</td>
                              <td className="p-3 text-right">{pres > 0 ? ((ej / pres) * 100).toFixed(0) : 0}%</td>
                              <td className="p-3"></td>
                              <td className="p-3 text-right">
                                <button
                                  onClick={() => inspeccionarItem(it)}
                                  className="text-xs border rounded px-2 py-1 hover:bg-gris-calido/20"
                                  title="Ver costos de Órdenes de Compra cargados en este ítem"
                                >
                                  🔍 Ver
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {modalItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={cerrarModalItem}>
          <div className="bg-white rounded-lg shadow-lg max-w-3xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="bg-carbon text-hueso px-5 py-3 flex items-center justify-between rounded-t-lg sticky top-0">
              <div>
                <p className="font-semibold">{modalItem.codigo} — {modalItem.descripcion}</p>
                <p className="text-xs text-gris-calido">Costos de Órdenes de Compra cargados en este ítem</p>
              </div>
              <button onClick={cerrarModalItem} className="text-hueso hover:text-dorado text-lg leading-none px-2">✕</button>
            </div>
            <div className="p-5">
              {cargandoDetalle ? (
                <p className="text-sm text-neutral-500">Cargando...</p>
              ) : !detalleItem || detalleItem.length === 0 ? (
                <p className="text-sm text-neutral-500">Todavía no hay ningún costo de Orden de Compra cargado en este ítem.</p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead className="text-left text-neutral-500 border-b">
                      <tr>
                        <th className="py-2 pr-2">Folio OC</th>
                        <th className="py-2 pr-2">Proveedor</th>
                        <th className="py-2 pr-2">Fecha</th>
                        <th className="py-2 pr-2">Descripción</th>
                        <th className="py-2 pr-2 text-right">Cantidad</th>
                        <th className="py-2 pr-2 text-right">Vr Unitario</th>
                        <th className="py-2 pr-2 text-right">Subtotal</th>
                        <th className="py-2 text-right">% Imp.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalleItem.map((d) => (
                        <tr key={d.id} className="border-b last:border-0">
                          <td className="py-2 pr-2 font-medium">{d.ordenes_compra?.folio}</td>
                          <td className="py-2 pr-2">{d.ordenes_compra?.proveedores?.nombre || '—'}</td>
                          <td className="py-2 pr-2 text-neutral-500">{d.ordenes_compra?.fecha}</td>
                          <td className="py-2 pr-2">{d.descripcion}</td>
                          <td className="py-2 pr-2 text-right">{d.cantidad}</td>
                          <td className="py-2 pr-2 text-right">{formatoPesos(d.valor_unitario)}</td>
                          <td className="py-2 pr-2 text-right">{formatoPesos(Number(d.cantidad || 0) * Number(d.valor_unitario || 0))}</td>
                          <td className="py-2 text-right text-neutral-500">{d.porcentaje != null ? Number(d.porcentaje).toFixed(0) + '%' : '100%'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-neutral-400 mt-3">
                    Subtotal antes de prorratear IVA/AIU/Descuento/Retención de cada orden. El valor &quot;Ejecutado&quot; del ítem puede diferir levemente porque incluye esa parte proporcional.
                  </p>
                  <p className="text-right font-semibold mt-2">
                    Total: {formatoPesos(detalleItem.reduce((acc, d) => acc + Number(d.cantidad || 0) * Number(d.valor_unitario || 0), 0))}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {modalAgregarItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="bg-carbon text-hueso px-5 py-3 flex items-center justify-between rounded-t-lg">
              <div>
                <p className="font-semibold">Agregar ítem adicional</p>
                <p className="text-xs text-hueso/70">Se agrega al capítulo &quot;Adicionales&quot; (se crea si no existe todavía)</p>
              </div>
              <button type="button" onClick={cerrarAgregarItem} className="text-hueso hover:text-dorado text-lg leading-none px-2">✕</button>
            </div>
            <form onSubmit={guardarNuevoItem} className="p-5 space-y-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Código</label>
                <input type="text" required value={nuevoItem.codigo} onChange={(e) => setNuevoItem({ ...nuevoItem, codigo: e.target.value })} className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Descripción</label>
                <input type="text" required value={nuevoItem.descripcion} onChange={(e) => setNuevoItem({ ...nuevoItem, descripcion: e.target.value })} className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Unidad</label>
                  <input type="text" value={nuevoItem.unidad} onChange={(e) => setNuevoItem({ ...nuevoItem, unidad: e.target.value })} className="w-full border rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Cantidad</label>
                  <input type="number" step="0.01" required value={nuevoItem.cantidad} onChange={(e) => setNuevoItem({ ...nuevoItem, cantidad: e.target.value })} className="w-full border rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Valor unitario</label>
                  <input type="number" step="0.01" required value={nuevoItem.valor_unitario} onChange={(e) => setNuevoItem({ ...nuevoItem, valor_unitario: e.target.value })} className="w-full border rounded px-3 py-1.5 text-sm" />
                </div>
              </div>
              <p className="text-right text-sm text-neutral-500">
                Valor parcial: {formatoPesos((Number(nuevoItem.cantidad) || 0) * (Number(nuevoItem.valor_unitario) || 0))}
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={cerrarAgregarItem} className="text-sm px-3 py-1.5 rounded border">Cancelar</button>
                <button type="submit" disabled={guardandoItem} className="text-sm px-3 py-1.5 rounded bg-carbon text-hueso disabled:opacity-50">
                  {guardandoItem ? 'Guardando…' : 'Guardar ítem'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function sumaEjecutadoCapitulo(cap, ejecutados) {
  return (cap.presupuesto_items || []).reduce((acc, it) => acc + (ejecutados[it.id] || 0), 0);
}

function estadoDe(presupuestado, ejecutado) {
  if (presupuestado <= 0) return null;
  const pct = ejecutado / presupuestado;
  if (pct > 1) return 'SOBREGIRO';
  if (pct >= 0.9) return 'ALERTA';
  return 'OK';
}

function Estado({ estado }) {
  if (!estado) return <span className="text-neutral-400">—</span>;
  const estilos = {
    OK: 'bg-green-100 text-green-700',
    ALERTA: 'bg-amber-100 text-amber-700',
    SOBREGIRO: 'bg-red-100 text-red-700',
  };
  const etiquetas = { OK: '🟢 OK', ALERTA: '🟠 ALERTA', SOBREGIRO: '🔴 SOBREGIRO' };
  return <span className={`text-xs px-2 py-1 rounded font-medium ${estilos[estado]}`}>{etiquetas[estado]}</span>;
}

function Dato({ label, valor }) {
  return <div><span className="text-neutral-500 block text-xs">{label}</span><span className="font-medium">{valor ?? '—'}</span></div>;
}

function FilaResumenGrande({ label, valor }) {
  return (
    <div>
      <p className="text-gris-calido text-xs mb-1">{label}</p>
      <p className="text-lg font-semibold">{formatoPesos(valor)}</p>
    </div>
  );
}
