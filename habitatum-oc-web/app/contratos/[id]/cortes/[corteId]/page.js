'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { compartirOAbrirArchivo } from '@/lib/compartirArchivo';
import NavBar from '@/components/NavBar';

// ============================================================
// Corte de obra: cantidades por ítem del contrato + adicionales,
// retención y amortización del anticipo. Al aprobar (solo admin),
// la función SQL aprobar_corte genera la OC imputada al presupuesto.
// ============================================================

const hoy = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
const r2 = (n) => Math.round(n * 100) / 100;
const fmtCant = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 }));
const CAMPO = 'border rounded px-2 py-1 text-sm';

function FilaSub({ etiqueta, valor }) {
  return (
    <tr className="border-t-2 border-dorado bg-[#b88a52]/[0.12] font-semibold">
      <td className="p-2 text-xs" colSpan={8}>{etiqueta}</td>
      <td className="p-2 text-right">{formatoPesos(valor)}</td>
    </tr>
  );
}

function TablaCorte({ titulo, filas, cantidades, setCantidades, puedeEditar, pie, sinMarco }) {
  const tabla = (
    <table className="w-full text-sm">
      <thead className="bg-gris-calido/30 text-left text-xs">
        <tr>
          <th className="p-2">Ítem</th><th className="p-2">Und</th>
          <th className="p-2 text-right">Contratado</th><th className="p-2 text-right">Anterior</th>
          <th className="p-2 text-right bg-[#b88a52]/[0.18]">Este corte</th>
          <th className="p-2 text-right">Acumulado</th><th className="p-2 text-right">Saldo</th>
          <th className="p-2 text-right">Vr. unitario</th><th className="p-2 text-right bg-[#3b5b7a]/[0.14]">Valor corte</th>
        </tr>
      </thead>
      <tbody>
        {filas.length === 0 && <tr><td colSpan={9} className="p-3 text-xs text-neutral-500">Sin ítems.</td></tr>}
        {filas.map((f) => (
          <tr key={f.id} className={`border-t ${f.excede && f.cant > 0 ? 'bg-red-50' : ''}`}>
            <td className="p-2 text-xs max-w-md">{f.codigo ? <strong>{f.codigo} · </strong> : null}{f.descripcion}</td>
            <td className="p-2 text-xs">{f.unidad}</td>
            <td className="p-2 text-right text-xs">{fmtCant(f.cantidad)}</td>
            <td className="p-2 text-right text-xs">{fmtCant(f.anterior)}</td>
            <td className="p-1 text-right bg-[#b88a52]/[0.09]">
              <input type="number" step="any" disabled={!puedeEditar} value={cantidades[f.id] ?? ''} placeholder="0"
                onChange={(e) => setCantidades({ ...cantidades, [f.id]: e.target.value })}
                className={`${CAMPO} w-24 text-right`} />
            </td>
            <td className={`p-2 text-right text-xs ${f.excede ? 'text-red-700 font-semibold' : ''}`}>{fmtCant(f.acumuladoNuevo)}</td>
            <td className={`p-2 text-right text-xs ${f.excede ? 'text-red-700' : ''}`}>{f.saldoNuevo == null ? '—' : fmtCant(f.saldoNuevo)}</td>
            <td className="p-2 text-right text-xs">{formatoPesos(f.valor_unitario)}</td>
            <td className="p-2 text-right bg-[#3b5b7a]/[0.07]">{f.subtotal ? formatoPesos(f.subtotal) : '—'}</td>
          </tr>
        ))}
        {pie}
      </tbody>
    </table>
  );
  if (sinMarco) return tabla;
  return (
    <div className="bg-white rounded-lg border overflow-x-auto">
      {titulo && <h2 className="font-semibold text-sm uppercase tracking-wide px-3 pt-3 pb-1">{titulo}</h2>}
      {tabla}
    </div>
  );
}

export default function CorteDeObra() {
  const { id: contratoId, corteId } = useParams();
  const router = useRouter();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const esNuevo = corteId === 'nuevo';

  const [contrato, setContrato] = useState(null);
  const [items, setItems] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [anticipo, setAnticipo] = useState({});
  const [corte, setCorte] = useState(null);
  const [cantidades, setCantidades] = useState({});
  const [adicionales, setAdicionales] = useState([]);
  const [form, setForm] = useState({ numero: 1, fecha: hoy(), porcentaje_retencion: '', tipo_amortizacion: 'NINGUNA', porcentaje_amortizacion: '', valor_amortizacion_fijo: '', notas: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);
  const [previoPorItem, setPrevioPorItem] = useState({});

  const esAdmin = usuario?.rol === 'admin';
  const puedeEditar = (usuario?.rol === 'admin' || usuario?.rol === 'operativo') && (!corte || corte.estado === 'BORRADOR');

  useEffect(() => {
    if (!usuario || !proyecto) return;
    (async () => {
      const s = crearClienteSupabase();
      const [{ data: k }, { data: its }, { data: ant }, { data: pres }] = await Promise.all([
        s.from('contratos').select('*, proveedores:contratista_id(nombre, nit)').eq('id', contratoId).single(),
        s.from('v_contrato_items_avance').select('*').eq('contrato_id', contratoId).order('es_adicional').order('orden'),
        s.rpc('anticipo_contrato', { p_contrato: contratoId }),
        s.from('presupuestos').select('id').eq('proyecto_id', proyecto.id).maybeSingle(),
      ]);
      setContrato(k);
      setItems(its || []);
      setAnticipo(ant || {});
      if (pres) {
        const { data: caps } = await s.from('presupuesto_capitulos').select('id, codigo, nombre').eq('presupuesto_id', pres.id).order('orden');
        setCapitulos(caps || []);
      }

      if (esNuevo) {
        const { data: ult } = await s.from('cortes').select('numero').eq('contrato_id', contratoId).order('numero', { ascending: false }).limit(1);
        const { data: ultOC } = await s.from('ordenes_compra').select('porcentaje_retencion').eq('contrato_id', contratoId).eq('tipo_pago', 'NORMAL').neq('estado', 'ANULADA').order('fecha', { ascending: false }).limit(1);
        const saldoAnt = Number(ant?.saldo || 0);
        const pctProporcional = saldoAnt > 0 && Number(k?.valor_inicial) > 0 ? r2((Number(ant.valor) / Number(k.valor_inicial)) * 100) : 0;
        setForm((f) => ({
          ...f,
          numero: Math.max(ult?.[0]?.numero || 0, k?.cortes_previos || 0) + 1,
          porcentaje_retencion: String(ultOC?.[0]?.porcentaje_retencion ?? 0),
          tipo_amortizacion: saldoAnt > 0 ? 'PORCENTAJE' : 'NINGUNA',
          porcentaje_amortizacion: saldoAnt > 0 ? String(pctProporcional) : '',
        }));
      } else {
        const [{ data: c }, { data: ci }] = await Promise.all([
          s.from('cortes').select('*, ordenes_compra(folio)').eq('id', corteId).single(),
          s.from('corte_items').select('*').eq('corte_id', corteId).order('orden'),
        ]);
        setCorte(c);
        setForm({
          numero: c.numero, fecha: c.fecha, porcentaje_retencion: String(c.porcentaje_retencion ?? 0),
          tipo_amortizacion: c.tipo_amortizacion, porcentaje_amortizacion: String(c.porcentaje_amortizacion || ''),
          valor_amortizacion_fijo: String(c.valor_amortizacion_fijo || ''), notas: c.notas || '',
        });
        const cant = {};
        const ads = [];
        (ci || []).forEach((x) => {
          const esDelContrato = x.contrato_item_id && (its || []).some((i) => i.id === x.contrato_item_id);
          if (esDelContrato) cant[x.contrato_item_id] = String(x.cantidad);
          else ads.push({ descripcion: x.descripcion, unidad: x.unidad || '', cantidad: String(x.cantidad), valor_unitario: String(x.valor_unitario), capitulo_id: x.capitulo_id || '' });
        });
        setCantidades(cant);
        setAdicionales(ads);
      }
      // Cantidades de cortes APROBADOS con número menor a este (columna "Anterior").
      const numeroEste = esNuevo ? null : undefined;
      const { data: prev } = await s.from('corte_items')
        .select('contrato_item_id, cantidad, cortes!inner(numero, estado, contrato_id)')
        .eq('cortes.contrato_id', contratoId).eq('cortes.estado', 'APROBADO');
      setPrevioPorItem({ lista: prev || [], numeroEste });
      setListo(true);
    })();
  }, [usuario, proyecto, contratoId, corteId]); // eslint-disable-line

  // Acumulado anterior: la vista cuenta solo cortes APROBADOS; si este corte ya está aprobado, se descuenta.
  const aprobado = corte?.estado === 'APROBADO';
  const filas = useMemo(() => items.map((i) => {
    const cant = num(cantidades[i.id]);
    const previos = (previoPorItem.lista || []).filter((p) => p.contrato_item_id === i.id && p.cortes.numero < Number(form.numero));
    const anterior = num(i.cantidad_historica) + previos.reduce((a, p) => a + num(p.cantidad), 0);
    const acumulado = anterior + cant;
    return { ...i, cant, anterior, acumuladoNuevo: acumulado, saldoNuevo: i.cantidad == null ? null : num(i.cantidad) - acumulado, subtotal: r2(cant * num(i.valor_unitario)), excede: i.cantidad != null && acumulado > num(i.cantidad) + 0.0005 };
  }), [items, cantidades, previoPorItem, form.numero]);

  const subContrato = filas.filter((f) => !f.es_adicional).reduce((a, f) => a + f.subtotal, 0);
  const subAdicPactados = filas.filter((f) => f.es_adicional).reduce((a, f) => a + f.subtotal, 0);
  const subAdicionales = adicionales.reduce((a, x) => a + r2(num(x.cantidad) * num(x.valor_unitario)), 0);
  const subtotal = r2(subContrato + subAdicPactados + subAdicionales);
  const saldoAnticipo = aprobado ? num(corte.valor_amortizacion) : Math.max(num(anticipo.saldo), 0);
  let amort = form.tipo_amortizacion === 'PORCENTAJE' ? r2(subtotal * num(form.porcentaje_amortizacion) / 100)
    : form.tipo_amortizacion === 'SALDO' ? saldoAnticipo
    : form.tipo_amortizacion === 'VALOR_FIJO' ? num(form.valor_amortizacion_fijo) : 0;
  amort = aprobado ? num(corte.valor_amortizacion) : Math.min(Math.max(amort, 0), saldoAnticipo, subtotal);
  const retencion = r2(subtotal * num(form.porcentaje_retencion) / 100);
  const neto = r2(subtotal - amort - retencion);
  const excedidos = filas.filter((f) => f.excede && f.cant > 0);

  async function guardar() {
    setError('');
    const adicionalesValidos = adicionales.filter((a) => a.descripcion.trim() || num(a.cantidad));
    if (adicionalesValidos.some((a) => !a.descripcion.trim() || !num(a.cantidad) || !num(a.valor_unitario) || !a.capitulo_id)) {
      throw new Error('Cada adicional necesita descripción, cantidad, valor unitario y capítulo del presupuesto.');
    }
    if (subtotal <= 0) throw new Error('El corte no tiene cantidades.');
    const s = crearClienteSupabase();
    const cabecera = {
      contrato_id: contratoId, numero: Number(form.numero), fecha: form.fecha,
      porcentaje_retencion: num(form.porcentaje_retencion), tipo_amortizacion: form.tipo_amortizacion,
      porcentaje_amortizacion: num(form.porcentaje_amortizacion), valor_amortizacion_fijo: num(form.valor_amortizacion_fijo),
      notas: form.notas.trim() || null,
    };
    let idCorte = corte?.id;
    if (!idCorte) {
      const { data, error: e } = await s.from('cortes').insert({ ...cabecera, creado_por: usuario.id }).select().single();
      if (e) throw new Error(e.message.includes('duplicate') ? `Ya existe el corte No. ${form.numero} en este contrato.` : e.message);
      idCorte = data.id;
      setCorte(data);
    } else {
      const { error: e } = await s.from('cortes').update(cabecera).eq('id', idCorte);
      if (e) throw e;
    }
    await s.from('corte_items').delete().eq('corte_id', idCorte);
    const filasItems = [
      ...filas.filter((f) => f.cant !== 0).map((f, k) => ({
        corte_id: idCorte, contrato_item_id: f.id, descripcion: (f.codigo ? `${f.codigo} · ` : '') + f.descripcion,
        unidad: f.unidad, cantidad: f.cant, valor_unitario: num(f.valor_unitario),
        presupuesto_item_id: f.presupuesto_item_id, capitulo_id: f.capitulo_id, orden: k,
      })),
      ...adicionalesValidos.map((a, k) => ({
        corte_id: idCorte, contrato_item_id: null, descripcion: a.descripcion.trim(), unidad: a.unidad || null,
        cantidad: num(a.cantidad), valor_unitario: num(a.valor_unitario), capitulo_id: a.capitulo_id, orden: 1000 + k,
      })),
    ];
    if (filasItems.length) {
      const { error: e } = await s.from('corte_items').insert(filasItems);
      if (e) throw e;
    }
    return idCorte;
  }

  async function guardarBorrador() {
    setGuardando(true);
    try {
      const idCorte = await guardar();
      if (esNuevo) router.replace(`/contratos/${contratoId}/cortes/${idCorte}`);
    } catch (e) { setError(e.message); }
    setGuardando(false);
  }

  async function aprobar() {
    const aviso = excedidos.length ? `\n\n⚠️ ${excedidos.length} ítem(s) superan la cantidad contratada.` : '';
    if (!window.confirm(`¿Aprobar el corte No. ${form.numero} y generar la Orden de Compra?\n\nSubtotal ${formatoPesos(subtotal)}\nAmortización −${formatoPesos(amort)}\nRetención −${formatoPesos(retencion)}\nNeto a pagar ${formatoPesos(neto)}${aviso}`)) return;
    setGuardando(true);
    try {
      const idCorte = await guardar();
      const s = crearClienteSupabase();
      const { data, error: e } = await s.rpc('aprobar_corte', { p_corte: idCorte });
      if (e) throw e;
      window.alert(`Corte aprobado. Se generó la ${data.folio} por ${formatoPesos(data.neto)}.`);
      router.push(`/contratos/${contratoId}`);
    } catch (e) { setError(e.message); }
    setGuardando(false);
  }

  async function eliminarBorrador() {
    if (!corte || !window.confirm('¿Eliminar este borrador de corte?')) return;
    const s = crearClienteSupabase();
    await s.from('cortes').delete().eq('id', corte.id);
    router.push(`/contratos/${contratoId}`);
  }

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-8 max-w-7xl mx-auto space-y-5">
        <Link href={`/contratos/${contratoId}`} className="text-sm text-neutral-500">← Volver al contrato</Link>
        {!listo || !contrato ? <p className="text-sm text-neutral-500">Cargando…</p> : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">Corte de obra No. {form.numero}</h1>
                <p className="text-sm text-neutral-500">
                  Contrato {contrato.numero_contrato} · {contrato.proveedores?.nombre} · {contrato.concepto}
                </p>
              </div>
              {aprobado && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-green-700">Aprobado · {corte.ordenes_compra?.folio}</span>
                  <button onClick={() => compartirOAbrirArchivo(`/api/cortes/${corte.id}/pdf`, `Corte ${corte.numero} ${contrato.numero_contrato}.pdf`)} className="border border-dorado text-dorado px-4 py-2 rounded text-sm">Descargar corte (PDF)</button>
                </div>
              )}
            </div>

            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}

            <div className="bg-white rounded-lg border p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <label className="space-y-1"><span className="text-xs text-neutral-500">Fecha del corte</span>
                <input type="date" disabled={!puedeEditar} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={`${CAMPO} w-full`} /></label>
              <label className="space-y-1"><span className="text-xs text-neutral-500">No. de corte</span>
                <input type="number" disabled={!puedeEditar} value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} className={`${CAMPO} w-full`} /></label>
              <div className="space-y-1 col-span-2"><span className="text-xs text-neutral-500">Anticipo del contrato</span>
                <p>{anticipo.folio ? `${anticipo.folio} · ${formatoPesos(anticipo.valor)} · saldo por amortizar ${formatoPesos(anticipo.saldo)}` : 'Sin anticipo'}</p></div>
            </div>

            <TablaCorte titulo="Ítems del contrato" filas={filas.filter((f) => !f.es_adicional)} cantidades={cantidades} setCantidades={setCantidades} puedeEditar={puedeEditar}
              pie={<FilaSub etiqueta="SUBTOTAL ÍTEMS DEL CONTRATO" valor={subContrato} />} />

            <div className="bg-white rounded-lg border overflow-x-auto">
              <div className="flex items-center justify-between px-3 pt-3">
                <h2 className="font-semibold text-sm uppercase tracking-wide">Adicionales</h2>
                {puedeEditar && <button onClick={() => setAdicionales([...adicionales, { descripcion: '', unidad: '', cantidad: '', valor_unitario: '', capitulo_id: '' }])} className="text-sm text-dorado underline">+ Agregar adicional nuevo</button>}
              </div>
              <TablaCorte sinMarco filas={filas.filter((f) => f.es_adicional)} cantidades={cantidades} setCantidades={setCantidades} puedeEditar={puedeEditar} />
              {adicionales.length > 0 && (
                <div className="px-3 pb-3 space-y-2 border-t pt-3">
                  <p className="text-xs text-neutral-500">Adicionales nuevos (al aprobar quedan como ítems del contrato para los próximos cortes):</p>
                  {adicionales.map((a, k) => (
                    <div key={k} className="grid grid-cols-12 gap-2 items-center">
                      <input disabled={!puedeEditar} placeholder="Descripción" value={a.descripcion} onChange={(e) => { const x = [...adicionales]; x[k] = { ...a, descripcion: e.target.value }; setAdicionales(x); }} className={`${CAMPO} col-span-12 sm:col-span-4`} />
                      <input disabled={!puedeEditar} placeholder="Und" value={a.unidad} onChange={(e) => { const x = [...adicionales]; x[k] = { ...a, unidad: e.target.value }; setAdicionales(x); }} className={`${CAMPO} col-span-3 sm:col-span-1`} />
                      <input disabled={!puedeEditar} type="number" step="any" placeholder="Cant." value={a.cantidad} onChange={(e) => { const x = [...adicionales]; x[k] = { ...a, cantidad: e.target.value }; setAdicionales(x); }} className={`${CAMPO} col-span-3 sm:col-span-1 text-right`} />
                      <input disabled={!puedeEditar} type="number" placeholder="Vr. unit." value={a.valor_unitario} onChange={(e) => { const x = [...adicionales]; x[k] = { ...a, valor_unitario: e.target.value }; setAdicionales(x); }} className={`${CAMPO} col-span-6 sm:col-span-2 text-right`} />
                      <select disabled={!puedeEditar} value={a.capitulo_id} onChange={(e) => { const x = [...adicionales]; x[k] = { ...a, capitulo_id: e.target.value }; setAdicionales(x); }} className={`${CAMPO} col-span-9 sm:col-span-3`}>
                        <option value="">Capítulo del presupuesto…</option>
                        {capitulos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                      </select>
                      {puedeEditar && <button onClick={() => setAdicionales(adicionales.filter((_, j2) => j2 !== k))} className="col-span-3 sm:col-span-1 text-xs text-neutral-400 hover:text-red-600">Quitar</button>}
                    </div>
                  ))}
                </div>
              )}
              <table className="w-full text-sm"><tbody><FilaSub etiqueta="SUBTOTAL ADICIONALES" valor={subAdicPactados + subAdicionales} /></tbody></table>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white rounded-lg border p-4 space-y-3 text-sm">
                <h2 className="font-medium">Retención y amortización</h2>
                <label className="flex items-center justify-between gap-3"><span>% de retención</span>
                  <input type="number" step="any" disabled={!puedeEditar} value={form.porcentaje_retencion} onChange={(e) => setForm({ ...form, porcentaje_retencion: e.target.value })} className={`${CAMPO} w-24 text-right`} /></label>
                <label className="flex items-center justify-between gap-3"><span>Amortización del anticipo</span>
                  <select disabled={!puedeEditar || !anticipo.folio} value={form.tipo_amortizacion} onChange={(e) => setForm({ ...form, tipo_amortizacion: e.target.value })} className={CAMPO}>
                    <option value="NINGUNA">No amortizar</option>
                    <option value="PORCENTAJE">% del corte</option>
                    <option value="SALDO">Saldo completo del anticipo</option>
                    <option value="VALOR_FIJO">Valor fijo</option>
                  </select></label>
                {form.tipo_amortizacion === 'PORCENTAJE' && (
                  <label className="flex items-center justify-between gap-3"><span>% a amortizar</span>
                    <input type="number" step="any" disabled={!puedeEditar} value={form.porcentaje_amortizacion} onChange={(e) => setForm({ ...form, porcentaje_amortizacion: e.target.value })} className={`${CAMPO} w-24 text-right`} /></label>
                )}
                {form.tipo_amortizacion === 'VALOR_FIJO' && (
                  <label className="flex items-center justify-between gap-3"><span>Valor a amortizar</span>
                    <input type="number" disabled={!puedeEditar} value={form.valor_amortizacion_fijo} onChange={(e) => setForm({ ...form, valor_amortizacion_fijo: e.target.value })} className={`${CAMPO} w-36 text-right`} /></label>
                )}
                <textarea disabled={!puedeEditar} placeholder="Notas del corte (opcional)" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} className={`${CAMPO} w-full`} rows={2} />
              </div>

              <div className="bg-carbon text-hueso rounded-lg p-4 text-sm space-y-1.5">
                <h2 className="font-medium mb-2">Resumen del corte</h2>
                <div className="flex justify-between"><span>Subtotal ítems del contrato</span><span>{formatoPesos(subContrato)}</span></div>
                <div className="flex justify-between"><span>Subtotal adicionales</span><span>{formatoPesos(subAdicPactados + subAdicionales)}</span></div>
                <div className="flex justify-between font-semibold border-t border-dorado pt-1.5"><span>TOTAL CORTE</span><span>{formatoPesos(subtotal)}</span></div>
                {aprobado && num(corte.descuento) > 0 && <div className="flex justify-between"><span>(-) Descuento</span><span>{formatoPesos(corte.descuento)}</span></div>}
                <div className="flex justify-between"><span>(-) Retenido {num(form.porcentaje_retencion)}%</span><span>{formatoPesos(aprobado ? corte.valor_retencion : retencion)}</span></div>
                <div className="flex justify-between"><span>(-) Amortización anticipo</span><span>{formatoPesos(amort)}</span></div>
                <div className="flex justify-between text-lg font-semibold border-t border-dorado pt-2 mt-1 text-[#e6c89c]"><span>TOTAL PAGO</span><span>{formatoPesos(aprobado ? corte.neto : neto)}</span></div>
                {excedidos.length > 0 && (
                  <p className="text-xs bg-red-900/40 rounded p-2 mt-2">⚠️ {excedidos.length} ítem(s) superan la cantidad contratada: {excedidos.map((f) => f.codigo || f.descripcion.slice(0, 25)).join(', ')}. Verifica la medición o formaliza un otrosí.</p>
                )}
              </div>
            </div>

            {puedeEditar && (
              <div className="flex flex-wrap gap-3 justify-end">
                {corte && <button disabled={guardando} onClick={eliminarBorrador} className="text-sm text-neutral-500 underline mr-auto">Eliminar borrador</button>}
                <button disabled={guardando} onClick={guardarBorrador} className="border border-carbon px-4 py-2 rounded text-sm">{guardando ? 'Guardando…' : 'Guardar borrador'}</button>
                {esAdmin && <button disabled={guardando} onClick={aprobar} className="bg-carbon text-hueso px-5 py-2 rounded text-sm">Aprobar y generar OC</button>}
              </div>
            )}
            {puedeEditar && !esAdmin && <p className="text-xs text-neutral-500 text-right">El corte queda en borrador hasta que un administrador lo apruebe.</p>}
          </>
        )}
      </main>
    </div>
  );
}
