'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { parsearPresupuesto } from '@/lib/parsePresupuesto';

// ============================================================
// Presupuesto y control presupuestal de proyectos TODO COSTO.
// Todos los datos salen de la función SQL control_todo_costo(proyecto):
//  - El ADMIN recibe costo, utilidad, finanzas y caja.
//  - Residentes / operativos solo reciben el valor total (precio de venta) y lo
//    ejecutado; el costo nunca llega a su navegador (se filtra en la base de datos).
// ============================================================

const TIPOS_CAPITULO = {
  CONTRATO: 'Contrato (con utilidad)',
  ADICIONAL_COSTO: 'Adicional sin utilidad',
  PAGO_DIRECTO_CLIENTE: 'Pago directo del cliente',
};

// Columnas destacadas: Presupuestado (dorado) y Ejecutado (azul acero).
const COL_PPTO = 'bg-[#b88a52]/[0.18] text-[#6b4a22] font-semibold';
const COL_PPTO_SUAVE = 'bg-[#b88a52]/[0.09] text-[#6b4a22]';
const COL_PPTO_TOTAL = 'bg-[#b88a52]/[0.28] text-[#5a3d1a]';
const COL_EJEC = 'bg-[#3b5b7a]/[0.14] text-[#243b52] font-semibold';
const COL_EJEC_SUAVE = 'bg-[#3b5b7a]/[0.07] text-[#243b52]';
const COL_EJEC_TOTAL = 'bg-[#3b5b7a]/[0.22] text-[#1b2d40]';

// Capítulos donde el admin puede crear ítems desde la app (sin utilidad: costo = venta).
const TIPOS_ADICIONAL = ['ADICIONAL_COSTO', 'PAGO_DIRECTO_CLIENTE'];
const ITEM_VACIO = { id: null, capitulo_id: '', codigo: '', descripcion: '', unidad: '', cantidad: '', valor_unitario: '', valor_parcial: '' };

// Siguiente código del capítulo: 13.07 → 13.08 (sin repetir ninguno del presupuesto).
function siguienteCodigo(cap, todos) {
  const pref = `${cap.codigo}.`;
  const max = (cap.items || []).reduce((m, it) => {
    const c = String(it.codigo || '');
    const n = c.startsWith(pref) ? parseInt(c.slice(pref.length), 10) : NaN;
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  const usados = new Set(todos.map((x) => String(x).trim()));
  let n = max + 1;
  while (usados.has(`${pref}${String(n).padStart(2, '0')}`)) n += 1;
  return `${pref}${String(n).padStart(2, '0')}`;
}

const MODALIDADES = { AIU: 'AIU con IVA sobre la utilidad', IVA: 'IVA sobre el total', SIN_FACTURA: 'Sin facturación' };

function pct(a, b) {
  const x = Number(b) > 0 ? (Number(a) / Number(b)) * 100 : 0;
  return Math.round(x * 10) / 10;
}

// Mismo semáforo del formato financiero: 🟢 OK · 🟡 ALERTA (≥ 90%) · 🔴 SOBREGIRO (> 100%).
function Semaforo({ valor }) {
  const [emoji, texto, color] = valor > 100 ? ['🔴', 'SOBREGIRO', 'text-red-700'] : valor >= 90 ? ['🟡', 'ALERTA', 'text-amber-700'] : ['🟢', 'OK', 'text-green-700'];
  return <span className={`text-xs font-semibold whitespace-nowrap ${color}`}>{emoji} {texto}</span>;
}

function Barra({ valor }) {
  return (
    <div className="h-1.5 bg-hueso rounded w-full min-w-[60px]">
      <div className={`h-1.5 rounded ${valor > 100 ? 'bg-red-600' : 'bg-dorado'}`} style={{ width: `${Math.min(valor, 100)}%` }} />
    </div>
  );
}

function Tarjeta({ titulo, valor, nota, oscura }) {
  return (
    <div className={`${oscura ? 'bg-carbon text-hueso' : 'bg-white'} rounded-lg border p-4 border-t-2 border-t-dorado`}>
      <p className={`text-[11px] uppercase tracking-wide ${oscura ? 'text-gris-calido' : 'text-neutral-500'}`}>{titulo}</p>
      <p className="text-lg font-semibold mt-1">{valor}</p>
      {nota && <p className={`text-xs mt-0.5 ${oscura ? 'text-gris-calido' : 'text-neutral-500'}`}>{nota}</p>}
    </div>
  );
}

export default function PresupuestoTodoCosto({ usuario, proyecto }) {
  const [datos, setDatos] = useState(null);
  const [rf, setRf] = useState(null); // resumen_financiero_tc (solo admin): costo de ejecución, utilidad real, IVA
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [expandidos, setExpandidos] = useState({});
  const [guardandoTipo, setGuardandoTipo] = useState(null);
  const [itemForm, setItemForm] = useState(null); // ventana + Agregar / ✎ Editar ítem adicional
  const [guardandoItem, setGuardandoItem] = useState(false);
  const [errorItem, setErrorItem] = useState('');
  const [capForm, setCapForm] = useState(null); // ventana + Nuevo capítulo de adicionales
  const [guardandoCap, setGuardandoCap] = useState(false);
  const [errorCap, setErrorCap] = useState('');
  const inputRef = useRef(null);
  const esAdmin = usuario?.rol === 'admin';

  async function cargar() {
    setCargando(true);
    const supabase = crearClienteSupabase();
    const [{ data, error: err }, resF] = await Promise.all([
      supabase.rpc('control_todo_costo', { p_proyecto: proyecto.id }),
      esAdmin ? supabase.rpc('resumen_financiero_tc', { p_proyecto: proyecto.id }) : Promise.resolve({ data: null }),
    ]);
    if (err) setError(err.message);
    setDatos(data || null);
    setRf(resF?.data || null);
    setCargando(false);
  }
  useEffect(() => { cargar(); }, [proyecto.id]); // eslint-disable-line

  async function cambiarTipo(capituloId, tipo) {
    setGuardandoTipo(capituloId);
    setError('');
    const supabase = crearClienteSupabase();
    const { error: err } = await supabase.from('presupuesto_capitulos').update({ tipo_capitulo: tipo }).eq('id', capituloId);
    if (!err) {
      const { error: err2 } = await supabase.rpc('recalcular_venta_presupuesto', { p_proyecto: proyecto.id });
      if (err2) setError(err2.message);
    } else setError(err.message);
    setGuardandoTipo(null);
    cargar();
  }

  // El Excel se carga SIEMPRE a costo (mismo formato "FORMULARIO DE PRECIOS" de siempre).
  // El precio de venta lo calcula la base de datos con el margen del proyecto.
  async function subirArchivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (datos?.presupuesto && !window.confirm('Ya existe un presupuesto. Subir uno nuevo REEMPLAZARÁ todos los capítulos e ítems (y sus imputaciones con Órdenes de Compra). ¿Continuar?')) {
      e.target.value = '';
      return;
    }
    setError('');
    setSubiendo(true);
    try {
      const d = parsearPresupuesto(await file.arrayBuffer());
      const supabase = crearClienteSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      await supabase.from('presupuestos').delete().eq('proyecto_id', proyecto.id);
      const { data: pres, error: errP } = await supabase.from('presupuestos').insert({
        proyecto_id: proyecto.id, nombre_archivo: file.name,
        total_costos_directos: d.totales.totalCostosDirectos, total_costos_indirectos: d.totales.totalCostosIndirectos,
        valor_total: d.totales.valorTotal, cargado_por: session?.user?.id || null,
      }).select().single();
      if (errP) throw errP;
      const { data: caps, error: errC } = await supabase.from('presupuesto_capitulos').insert(
        d.capitulos.map((c) => ({ presupuesto_id: pres.id, codigo: c.codigo, nombre: c.nombre, categoria: c.categoria, valor_presupuestado: c.valor_presupuestado, orden: c.orden }))
      ).select('id, codigo');
      if (errC) throw errC;
      const idPorCodigo = Object.fromEntries(caps.map((c) => [c.codigo, c.id]));
      const filas = d.capitulos.flatMap((c) => c.items.map((it) => ({
        capitulo_id: idPorCodigo[c.codigo], codigo: it.codigo, descripcion: it.descripcion, unidad: it.unidad,
        cantidad: it.cantidad, valor_unitario: it.valor_unitario, valor_parcial: it.valor_parcial, orden: it.orden,
      })));
      if (filas.length) {
        const { error: errI } = await supabase.from('presupuesto_items').insert(filas);
        if (errI) throw errI;
      }
      const { error: errConv } = await supabase.rpc('convertir_presupuesto_a_todo_costo', { p_proyecto: proyecto.id });
      if (errConv) throw errConv;
      await cargar();
    } catch (err) {
      setError(err.message || 'No se pudo cargar el presupuesto.');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  if (cargando && !datos) return <p className="text-sm text-neutral-500">Cargando presupuesto...</p>;

  const capitulos = datos?.capitulos || [];
  const t = datos?.totales || {};
  const fin = datos?.finanzas;
  const caja = datos?.caja;

  // Utilidad real (061): ya viene INCLUIDA en el presupuesto antes de AIU (columna "Presupuestado").
  // Costo de ejecución = presupuestado ÷ (1 + %): es lo disponible para gastar sin tocar la utilidad.
  // El % de ejecución, el semáforo y el sobrecosto se miden contra el costo de ejecución.
  const pctReal = Number(rf?.porcentaje_utilidad_real || 0);
  const realPorCap = Object.fromEntries((rf?.capitulos || []).map((x) => [x.id, x]));
  const ejecCap = (c) => Number(realPorCap[c.id]?.costo_ejecucion ?? c.costo ?? 0);
  const ejecItem = (c, it) => (c.tipo === 'CONTRATO' ? Math.round(Number(it.costo || 0) / (1 + pctReal / 100)) : Number(it.costo || 0));
  const sobrecosto = capitulos.reduce((acc, c) => acc + Math.max(Number(c.ejecutado || 0) - ejecCap(c), 0), 0);
  const utilidadReal = Number(rf?.utilidad_real || 0);
  const utilidadProyectada = utilidadReal - sobrecosto;
  const margenPresupuestado = pct(t.utilidad_presupuestada, t.costo);

  // ---------- Agrupación igual al formato financiero ----------
  const sumar = (lista) => lista.reduce((a, c) => ({
    venta: a.venta + Number(c.venta || 0),
    costo: a.costo + Number(c.costo || 0),
    utilidad: a.utilidad + Number(c.utilidad_presupuestada || 0),
    ejec: a.ejec + ejecCap(c),
    ejecutado: a.ejecutado + Number(c.ejecutado || 0),
  }), { venta: 0, costo: 0, utilidad: 0, ejec: 0, ejecutado: 0 });
  const capsContrato = capitulos.filter((c) => c.tipo === 'CONTRATO');
  const capsAdicionales = capitulos.filter((c) => c.tipo !== 'CONTRATO');
  const grupos = [
    { clave: 'contrato', titulo: 'Presupuesto · contrato inicial', tituloCorto: 'contrato inicial', capitulos: capsContrato, totales: sumar(capsContrato) },
    ...(capsAdicionales.length ? [{ clave: 'adicionales', titulo: 'Adicionales', tituloCorto: 'adicionales', capitulos: capsAdicionales, totales: sumar(capsAdicionales) }] : []),
  ].filter((g) => g.capitulos.length > 0);
  const totalGeneral = sumar(capitulos);

  const capsEditables = capitulos.filter((c) => TIPOS_ADICIONAL.includes(c.tipo));
  const todosCodigos = capitulos.flatMap((c) => (c.items || []).map((it) => it.codigo || ''));

  function abrirNuevoItem() {
    const cap = capsEditables[0];
    setErrorItem('');
    setItemForm({ ...ITEM_VACIO, capitulo_id: cap?.id || '', codigo: cap ? siguienteCodigo(cap, todosCodigos) : '' });
  }
  function abrirEditarItem(c, it) {
    setErrorItem('');
    setItemForm({
      id: it.id, capitulo_id: c.id, codigo: it.codigo || '', descripcion: it.descripcion || '', unidad: it.unidad || '',
      cantidad: it.cantidad ?? '', valor_unitario: it.venta_unitario ?? '', valor_parcial: it.venta ?? '',
    });
  }
  const valorItemForm = itemForm
    ? (itemForm.cantidad !== '' && itemForm.valor_unitario !== '' ? Number(itemForm.cantidad) * Number(itemForm.valor_unitario) : Number(itemForm.valor_parcial || 0))
    : 0;
  async function guardarItem(e) {
    e.preventDefault();
    setErrorItem('');
    const usaUnit = itemForm.cantidad !== '' && itemForm.valor_unitario !== '';
    if (!usaUnit && !(Number(itemForm.valor_parcial) > 0)) { setErrorItem('Escribe cantidad y valor unitario, o el valor total del ítem.'); return; }
    setGuardandoItem(true);
    const { error: err } = await crearClienteSupabase().rpc('guardar_item_adicional_tc', {
      p_item: itemForm.id, p_capitulo: itemForm.capitulo_id, p_codigo: itemForm.codigo, p_descripcion: itemForm.descripcion,
      p_unidad: itemForm.unidad || null,
      p_cantidad: usaUnit ? Number(itemForm.cantidad) : null,
      p_valor_unitario: usaUnit ? Number(itemForm.valor_unitario) : null,
      p_valor_parcial: usaUnit ? null : Number(itemForm.valor_parcial),
    });
    setGuardandoItem(false);
    if (err) { setErrorItem(err.message); return; }
    setItemForm(null);
    await cargar();
  }
  async function guardarCapitulo(e) {
    e.preventDefault();
    setErrorCap('');
    setGuardandoCap(true);
    const { data, error: err } = await crearClienteSupabase().rpc('crear_capitulo_adicional_tc', {
      p_proyecto: proyecto.id, p_nombre: capForm.nombre, p_tipo: capForm.tipo,
    });
    setGuardandoCap(false);
    if (err) { setErrorCap(err.message); return; }
    setCapForm(null);
    await cargar();
    // Abre de una vez la ventana para el primer ítem del capítulo nuevo.
    setErrorItem('');
    setItemForm({ ...ITEM_VACIO, capitulo_id: data.id, codigo: `${data.codigo}.01` });
  }

  // Cálculo del contrato debajo del subtotal: AIU (o utilidad), IVA y TOTAL. Solo admin.
  function bloqueContrato(tot) {
    if (!fin) return null;
    const costo = Number(tot.costo || 0);
    const venta = Number(tot.venta || 0);
    const m = fin.modalidad_facturacion;
    const ivaPct = Number(fin.porcentaje_iva ?? 19);
    const filas = [];
    if (m === 'AIU') {
      const a = Math.round(costo * Number(fin.porcentaje_a || 0) / 100);
      const i = Math.round(costo * Number(fin.porcentaje_i || 0) / 100);
      const u = Math.round(costo * Number(fin.porcentaje_u || 0) / 100);
      filas.push([`Administración (${Number(fin.porcentaje_a || 0)}%)`, a], [`Imprevistos (${Number(fin.porcentaje_i || 0)}%)`, i], [`Utilidad (${Number(fin.porcentaje_u || 0)}%)`, u]);
      const ajuste = venta - costo - a - i - u;
      if (Math.abs(ajuste) >= 1) filas.push(['Ajuste por redondeo de los ítems', ajuste, 'nota']);
    } else {
      filas.push([`Utilidad (${Number(fin.porcentaje_utilidad || 0)}%)`, venta - costo]);
    }
    filas.push(['Subtotal sin IVA', venta, 'sub']);
    const iva = rf ? Number(rf.iva_contrato || 0)
      : m === 'AIU' ? Math.round(costo * Number(fin.porcentaje_u || 0) / 100 * ivaPct / 100)
      : m === 'IVA' ? Math.round(venta * ivaPct / 100) : 0;
    if (m !== 'SIN_FACTURA') filas.push([m === 'AIU' ? `IVA ${ivaPct}% sobre la U` : `IVA ${ivaPct}%`, iva]);
    filas.push([m === 'SIN_FACTURA' ? 'TOTAL CONTRATO' : 'TOTAL CONTRATO (con IVA)', venta + iva, 'total']);
    return filas.map(([t2, v, tipo]) => (
      <tr key={t2} className={tipo === 'total' ? 'bg-carbon text-hueso font-bold' : tipo === 'sub' ? 'bg-hueso font-semibold border-t' : 'border-t text-neutral-700'}>
        <td className={`px-3 py-2 ${tipo === 'nota' ? 'text-xs italic text-neutral-500' : ''}`} colSpan={2}>{t2}</td>
        <td className={`px-3 py-2 text-right ${tipo === 'total' ? '' : COL_PPTO_SUAVE}`}>{formatoPesos(v)}</td>
        <td colSpan={4} />
      </tr>
    ));
  }

  async function eliminarItem(it) {
    if (!window.confirm(`¿Eliminar el ítem ${it.codigo} · ${it.descripcion}? Solo se puede si no tiene nada imputado.`)) return;
    setError('');
    const { error: err } = await crearClienteSupabase().rpc('eliminar_item_adicional_tc', { p_item: it.id });
    if (err) { setError(err.message); return; }
    await cargar();
  }

  function filaCapitulo(c) {
    const abierto = !!expandidos[c.id];
    const pctCosto = pct(c.ejecutado, esAdmin ? ejecCap(c) : c.costo);
    const pctVenta = pct(c.ejecutado, c.venta);
    return (
      <Fragment key={c.id}>
        <tr className="border-t hover:bg-hueso/60 cursor-pointer" onClick={() => setExpandidos((p) => ({ ...p, [c.id]: !p[c.id] }))}>
          <td className="p-3 font-medium">
            <span className="text-neutral-400 mr-1">{abierto ? '▾' : '▸'}</span>
            {c.codigo} · {c.nombre}
          </td>
          {esAdmin ? (
            <>
              <td className="p-3" onClick={(e) => e.stopPropagation()}>
                <select value={c.tipo} disabled={guardandoTipo === c.id} onChange={(e) => cambiarTipo(c.id, e.target.value)} className="border rounded px-2 py-1 text-xs">
                  {Object.entries(TIPOS_CAPITULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td className={`p-3 text-right ${COL_PPTO}`}>{formatoPesos(c.costo)}</td>
              <td className="p-3 text-right font-medium">{formatoPesos(ejecCap(c))}</td>
              <td className={`p-3 text-right ${COL_EJEC}`}>{formatoPesos(c.ejecutado)}</td>
              <td className="p-3 text-right">{pctCosto}%</td>
              <td className="p-3"><Semaforo valor={pctCosto} /></td>
            </>
          ) : (
            <>
              <td className={`p-3 text-right ${COL_PPTO}`}>{formatoPesos(c.venta)}</td>
              <td className={`p-3 text-right ${COL_EJEC}`}>{formatoPesos(c.ejecutado)}</td>
              <td className="p-3"><div className="flex items-center gap-2"><Barra valor={pctVenta} /><span className="text-xs w-12 text-right">{pctVenta}%</span></div></td>
              <td className="p-3"><Semaforo valor={pctVenta} /></td>
            </>
          )}
        </tr>
        {abierto && (c.items || []).map((it) => {
          const pi = pct(it.ejecutado, esAdmin ? ejecItem(c, it) : it.venta);
          return (
            <tr key={it.id} className="border-t text-xs text-neutral-600">
              <td className="p-2 pl-9">
                {it.codigo} · {it.descripcion}
                {esAdmin && TIPOS_ADICIONAL.includes(c.tipo) && (
                  <span className="ml-2 inline-flex gap-1 align-middle">
                    <button type="button" onClick={() => abrirEditarItem(c, it)} title="Editar este ítem adicional"
                      className="text-[11px] border border-dorado text-[#6b4a22] rounded px-1.5 py-0.5 hover:bg-hueso">✎ Editar</button>
                    {!Number(it.ejecutado) && (
                      <button type="button" onClick={() => eliminarItem(it)} title="Eliminar (solo si no tiene nada imputado)"
                        className="text-[11px] border border-red-200 text-red-600 rounded px-1.5 py-0.5 hover:bg-red-50">Eliminar</button>
                    )}
                  </span>
                )}
              </td>
              {esAdmin ? (
                <>
                  <td className="p-2 text-neutral-400">{it.unidad || ''}{it.cantidad ? ` · ${it.cantidad}` : ''}</td>
                  <td className={`p-2 text-right ${COL_PPTO_SUAVE}`}>{formatoPesos(it.costo)}</td>
                  <td className="p-2 text-right">{formatoPesos(ejecItem(c, it))}</td>
                  <td className={`p-2 text-right ${COL_EJEC_SUAVE}`}>{Number(it.ejecutado) ? formatoPesos(it.ejecutado) : '—'}</td>
                  <td className="p-2 text-right">{Number(it.ejecutado) ? `${pi}%` : ''}</td>
                  <td className="p-2">{Number(it.ejecutado) > 0 && <Semaforo valor={pi} />}</td>
                </>
              ) : (
                <>
                  <td className={`p-2 text-right ${COL_PPTO_SUAVE}`}>{formatoPesos(it.venta)}</td>
                  <td className={`p-2 text-right ${COL_EJEC_SUAVE}`}>{Number(it.ejecutado) ? formatoPesos(it.ejecutado) : '—'}</td>
                  <td className="p-2" colSpan={2} />
                </>
              )}
            </tr>
          );
        })}
        {abierto && Number(c.ejecutado_capitulo) > 0 && (
          <tr className="border-t text-xs italic text-neutral-500">
            <td className="p-2 pl-9" colSpan={esAdmin ? 4 : 2}>Ejecutado registrado al capítulo (sin ítem específico)</td>
            <td className={`p-2 text-right ${COL_EJEC_SUAVE}`}>{formatoPesos(c.ejecutado_capitulo)}</td>
            <td colSpan={esAdmin ? 2 : 2} />
          </tr>
        )}
      </Fragment>
    );
  }

  function filaTotal(etiqueta, t2, general) {
    const pc = pct(t2.ejecutado, t2.ejec);
    const pv = pct(t2.ejecutado, t2.venta);
    const base = general ? 'bg-carbon text-hueso font-bold border-t-2 border-dorado' : 'bg-hueso font-semibold border-t-2 border-dorado';
    const ppto = general ? '' : COL_PPTO_TOTAL;
    const ejec = general ? '' : COL_EJEC_TOTAL;
    return (
      <tr className={base}>
        <td className="p-3">{etiqueta}</td>
        {esAdmin ? (
          <>
            <td />
            <td className={`p-3 text-right ${ppto}`}>{formatoPesos(t2.costo)}</td>
            <td className="p-3 text-right">{formatoPesos(t2.ejec)}</td>
            <td className={`p-3 text-right ${ejec}`}>{formatoPesos(t2.ejecutado)}</td>
            <td className="p-3 text-right">{pc}%</td>
            <td className="p-3">{general ? <span className="text-xs">{pc > 100 ? '🔴 SOBREGIRO' : pc >= 90 ? '🟡 ALERTA' : '🟢 OK'}</span> : <Semaforo valor={pc} />}</td>
          </>
        ) : (
          <>
            <td className={`p-3 text-right ${ppto}`}>{formatoPesos(t2.venta)}</td>
            <td className={`p-3 text-right ${ejec}`}>{formatoPesos(t2.ejecutado)}</td>
            <td className="p-3"><div className="flex items-center gap-2"><Barra valor={pv} /><span className="text-xs w-12 text-right">{pv}%</span></div></td>
            <td className="p-3" />
          </>
        )}
      </tr>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Presupuesto · Todo costo</h1>
          <p className="text-sm text-neutral-500">{proyecto.nombre}</p>
          {esAdmin && datos?.presupuesto && (
            <Link href="/presupuesto/cortes-cliente" className="inline-block mt-2 border border-dorado text-[#6b4a22] bg-[#b88a52]/10 hover:bg-[#b88a52]/20 px-3 py-1.5 rounded text-sm font-medium">
              Cortes al cliente →
            </Link>
          )}
        </div>
        {esAdmin && (
          <div className="text-right">
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" id="input-presupuesto-tc" onChange={subirArchivo} />
            <label htmlFor="input-presupuesto-tc" className="bg-carbon text-hueso px-4 py-2 rounded text-sm cursor-pointer inline-block">
              {subiendo ? 'Cargando...' : datos?.presupuesto ? 'Reemplazar presupuesto (Excel a costo)' : 'Cargar presupuesto (Excel a costo)'}
            </label>
            <p className="text-[11px] text-neutral-400 mt-1">El precio de venta se calcula con el margen del proyecto.</p>
          </div>
        )}
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}

      {!datos?.presupuesto ? (
        <div className="bg-white rounded-lg shadow-sm border p-8 text-center text-neutral-500">
          <p>Este proyecto todavía no tiene un presupuesto cargado.</p>
        </div>
      ) : (
        <>
          {esAdmin ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tarjeta oscura titulo="Venta al cliente sin IVA (contrato + adicionales)" valor={formatoPesos(t.venta)}
                nota={fin ? `${MODALIDADES[fin.modalidad_facturacion]}${rf && fin.modalidad_facturacion !== 'SIN_FACTURA' ? ` · IVA ${formatoPesos(Number(rf.iva_contrato) + Number(rf.iva_adicionales))} · con IVA ${formatoPesos(rf.total_con_iva)}` : ''}` : null} />
              <Tarjeta titulo="Presupuestado antes de AIU" valor={formatoPesos(t.costo)}
                nota={`Costo de ejecución ${formatoPesos(totalGeneral.ejec)} · margen AIU ${margenPresupuestado}%`} />
              <Tarjeta titulo="Ejecutado (costo real)" valor={formatoPesos(t.ejecutado)} nota={`${pct(t.ejecutado, totalGeneral.ejec)}% del costo de ejecución`} />
              <Tarjeta
                titulo="Utilidad real proyectada"
                valor={formatoPesos(utilidadProyectada)}
                nota={`Incluida en el presupuesto ${formatoPesos(utilidadReal)} (${pctReal}%)${sobrecosto > 0 ? ` · sobrecosto ${formatoPesos(sobrecosto)}` : ''} · aparte, margen AIU ${formatoPesos(Number(t.venta || 0) - Number(t.costo || 0))}`}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Tarjeta oscura titulo="Presupuestado" valor={formatoPesos(t.venta)} />
              <Tarjeta titulo="Avance ejecutado" valor={`${pct(t.ejecutado, t.venta)}%`} nota="Sobre el valor total" />
            </div>
          )}

          {esAdmin && caja && (
            <div className="bg-white rounded-lg border p-4 text-sm flex flex-wrap gap-x-8 gap-y-2">
              <span>Ingresos del cliente: <strong>{formatoPesos(caja.ingresos_cliente)}</strong></span>
              <span>Retiros de utilidad: <strong>{formatoPesos(caja.retiros_utilidad)}</strong></span>
              <span>Cuenta receptora: <strong>{fin?.cuenta_receptora === 'PERSONAL' ? 'Personal' : 'HABITATUM'}</strong></span>
              <span className="text-neutral-400">Caja, plan de pagos y conciliación: próxima fase</span>
            </div>
          )}

          {esAdmin && datos.historico && Number(datos.historico.movimientos) > 0 && (
            <div className="bg-hueso border border-gris-calido rounded p-3 text-xs text-neutral-600">
              Incluye <strong>{datos.historico.movimientos}</strong> pagos históricos por <strong>{formatoPesos(datos.historico.valor)}</strong>,
              cargados tal cual desde el formato financiero anterior (hasta {datos.historico.hasta}). Desde esa fecha, el ejecutado sale de las Órdenes de Compra.
            </div>
          )}
          {Number(datos.sin_imputar) > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 text-sm">
              Hay <strong>{formatoPesos(datos.sin_imputar)}</strong> en pagos sin capítulo del presupuesto asignado.
              Ese valor todavía no se refleja en el control por capítulo.
            </div>
          )}

          {esAdmin && (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { setErrorCap(''); setCapForm({ nombre: '', tipo: 'ADICIONAL_COSTO' }); }}
                className="border border-carbon text-carbon px-4 py-2 rounded text-sm hover:bg-hueso">+ Nuevo capítulo de adicionales</button>
              {capsEditables.length > 0 && (
                <button type="button" onClick={abrirNuevoItem} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">+ Agregar ítem adicional</button>
              )}
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gris-calido/30 text-left">
                {esAdmin ? (
                  <tr>
                    <th className="p-3">Capítulo</th>
                    <th className="p-3">Tipo</th>
                    <th className={`p-3 text-right ${COL_PPTO}`} title="Costo directo del presupuesto, antes de AIU">Presupuestado<br /><span className="text-[11px] font-normal">antes de AIU</span></th>
                    <th className="p-3 text-right" title={`Presupuestado ÷ (1 + ${pctReal}%)`}>Costo ejecución<br /><span className="text-[11px] font-normal">sin utilidad real ({pctReal}%)</span></th>
                    <th className={`p-3 text-right ${COL_EJEC}`}>Ejecutado</th>
                    <th className="p-3 text-right">% ejec.</th>
                    <th className="p-3">Estado</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="p-3">Capítulo</th>
                    <th className={`p-3 text-right ${COL_PPTO}`}>Presupuestado</th>
                    <th className={`p-3 text-right ${COL_EJEC}`}>Ejecutado</th>
                    <th className="p-3 w-40">Avance</th>
                    <th className="p-3">Estado</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <Fragment key={g.clave}>
                    <tr className="bg-carbon text-hueso">
                      <td colSpan={esAdmin ? 7 : 5} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">{g.titulo}</td>
                    </tr>
                    {g.capitulos.map((c) => filaCapitulo(c))}
                    {filaTotal(`Subtotal ${g.tituloCorto}`, g.totales, false)}
                    {esAdmin && g.clave === 'contrato' && bloqueContrato(g.totales)}
                  </Fragment>
                ))}
                {grupos.length > 1 && filaTotal('TOTAL (contrato inicial + adicionales)', totalGeneral, true)}
                {esAdmin && grupos.length > 1 && rf && (
                  <tr className="bg-carbon text-hueso font-bold border-t-2 border-dorado">
                    <td className="px-3 py-2" colSpan={2}>TOTAL AL CLIENTE (contrato con IVA + adicionales{Number(rf.iva_adicionales) > 0 ? ' con IVA' : ''})</td>
                    <td className="px-3 py-2 text-right">{formatoPesos(rf.total_con_iva)}</td>
                    <td colSpan={4} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {esAdmin && (
            <p className="text-xs text-neutral-500">
              Estado contra el <strong>costo de ejecución</strong> (presupuestado antes de AIU ÷ (1 + {pctReal}%)): 🟢 OK &lt; 90% · 🟡 ALERTA 90–100% · 🔴 SOBREGIRO &gt; 100% (ya se está gastando la utilidad real).
              En los adicionales (sin utilidad y pagos directos del cliente) el costo de ejecución es igual al presupuestado.
            </p>
          )}
        </>
      )}

      {capForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setCapForm(null)}>
          <div className="bg-white rounded-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="bg-carbon text-hueso px-5 py-3 flex items-center justify-between rounded-t-lg">
              <div>
                <p className="font-semibold">Nuevo capítulo de adicionales</p>
                <p className="text-xs text-gris-calido">Queda al final del presupuesto con el siguiente número de capítulo.</p>
              </div>
              <button type="button" onClick={() => setCapForm(null)} className="text-hueso hover:text-dorado text-lg leading-none px-2">✕</button>
            </div>
            <form onSubmit={guardarCapitulo} className="p-5 space-y-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Nombre del capítulo</label>
                <input required autoFocus value={capForm.nombre} onChange={(e) => setCapForm({ ...capForm, nombre: e.target.value })}
                  placeholder="Ej. ADICIONALES DE OBRA" className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Tipo</label>
                <select value={capForm.tipo} onChange={(e) => setCapForm({ ...capForm, tipo: e.target.value })} className="w-full border rounded px-3 py-2 text-sm">
                  {TIPOS_ADICIONAL.map((k) => <option key={k} value={k}>{TIPOS_CAPITULO[k]}</option>)}
                </select>
                <p className="text-[11px] text-neutral-500 mt-1">
                  {capForm.tipo === 'ADICIONAL_COSTO'
                    ? 'Lo paga HABITATUM y se le cobra al cliente al costo (sin utilidad).'
                    : 'Lo paga el cliente directamente al proveedor: no entra a la caja de HABITATUM.'}
                </p>
              </div>
              {errorCap && <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{errorCap}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setCapForm(null)} className="text-sm px-3 py-2 rounded border">Cancelar</button>
                <button type="submit" disabled={guardandoCap} className="text-sm px-4 py-2 rounded bg-carbon text-hueso disabled:opacity-50">
                  {guardandoCap ? 'Creando…' : 'Crear capítulo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {itemForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setItemForm(null)}>
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="bg-carbon text-hueso px-5 py-3 flex items-center justify-between rounded-t-lg">
              <div>
                <p className="font-semibold">{itemForm.id ? 'Editar ítem adicional' : 'Agregar ítem adicional'}</p>
                <p className="text-xs text-gris-calido">Sin utilidad: el costo es igual al valor que se le reconoce al cliente.</p>
              </div>
              <button type="button" onClick={() => setItemForm(null)} className="text-hueso hover:text-dorado text-lg leading-none px-2">✕</button>
            </div>
            <form onSubmit={guardarItem} className="p-5 space-y-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Capítulo</label>
                <select value={itemForm.capitulo_id} disabled={!!itemForm.id}
                  onChange={(e) => {
                    const cap = capsEditables.find((x) => x.id === e.target.value);
                    setItemForm({ ...itemForm, capitulo_id: e.target.value, codigo: cap ? siguienteCodigo(cap, todosCodigos) : '' });
                  }}
                  className="w-full border rounded px-3 py-2 text-sm">
                  {capsEditables.map((cap) => <option key={cap.id} value={cap.id}>{cap.codigo} · {cap.nombre} ({TIPOS_CAPITULO[cap.tipo]})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Código</label>
                  <input required value={itemForm.codigo} onChange={(e) => setItemForm({ ...itemForm, codigo: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-neutral-500 block mb-1">Unidad</label>
                  <input value={itemForm.unidad} onChange={(e) => setItemForm({ ...itemForm, unidad: e.target.value })} placeholder="Glb, Un, m2…" className="w-full border rounded px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Descripción</label>
                <textarea required rows={2} value={itemForm.descripcion} onChange={(e) => setItemForm({ ...itemForm, descripcion: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Cantidad</label>
                  <input type="number" inputMode="decimal" step="any" value={itemForm.cantidad} onChange={(e) => setItemForm({ ...itemForm, cantidad: e.target.value })} className="w-full border rounded px-3 py-2 text-sm text-right" />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Valor unitario</label>
                  <input type="number" inputMode="decimal" step="any" value={itemForm.valor_unitario} onChange={(e) => setItemForm({ ...itemForm, valor_unitario: e.target.value })} className="w-full border rounded px-3 py-2 text-sm text-right" />
                </div>
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">…o valor total del ítem (si no usas cantidad × unitario)</label>
                <input type="number" inputMode="decimal" step="any" value={itemForm.valor_parcial}
                  disabled={itemForm.cantidad !== '' && itemForm.valor_unitario !== ''}
                  onChange={(e) => setItemForm({ ...itemForm, valor_parcial: e.target.value })} className="w-full border rounded px-3 py-2 text-sm text-right disabled:bg-neutral-100" />
              </div>
              <p className="text-right text-sm">Valor del ítem: <strong>{formatoPesos(Math.round(valorItemForm))}</strong></p>
              {errorItem && <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{errorItem}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setItemForm(null)} className="text-sm px-3 py-2 rounded border">Cancelar</button>
                <button type="submit" disabled={guardandoItem} className="text-sm px-4 py-2 rounded bg-carbon text-hueso disabled:opacity-50">
                  {guardandoItem ? 'Guardando…' : (itemForm.id ? 'Guardar cambios' : 'Guardar ítem')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
