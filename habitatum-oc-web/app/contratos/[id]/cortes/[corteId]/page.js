'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUsuarioActual } from '@/lib/useUsuarioActual';
import { useProyectoActual } from '@/lib/useProyectoActual';
import { crearClienteSupabase } from '@/lib/supabaseClient';
import { formatoPesos } from '@/lib/calculosOC';
import { compartirOAbrirArchivo } from '@/lib/compartirArchivo';
import { construirSabana } from '@/lib/modeloSabana';
import SabanaCortes from '@/lib/SabanaCortes';
import NavBar from '@/components/NavBar';

// ============================================================
// Corte de obra: la misma sábana del Excel, con los cortes anteriores a la
// vista y el corte nuevo como columna editable (como agregar una columna en
// el Excel). Aprobar (solo admin) → aprobar_corte genera la OC imputada.
// ============================================================

const hoy = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
const r2 = (n) => Math.round(n * 100) / 100;
const CAMPO = 'border rounded px-2 py-1 text-sm';

export default function CorteDeObra() {
  const { id: contratoId, corteId } = useParams();
  const router = useRouter();
  const { usuario, cargando } = useUsuarioActual();
  const { proyecto, cargando: cargandoProyecto } = useProyectoActual();
  const esNuevo = corteId === 'nuevo';

  const [d, setD] = useState(null);
  const [corte, setCorte] = useState(null);
  const [cantidades, setCantidades] = useState({});
  const [vus, setVus] = useState({});
  const [nuevos, setNuevos] = useState([]);
  const [form, setForm] = useState({ numero: 1, fecha: hoy(), pctRetencion: '0', tipo_amortizacion: 'NINGUNA', porcentaje_amortizacion: '', valor_amortizacion_fijo: '', notas: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [actualizarOC, setActualizarOC] = useState(true);
  const [itemsCorte, setItemsCorte] = useState([]);

  const esAdmin = usuario?.rol === 'admin';
  const aprobado = corte?.estado === 'APROBADO';
  const modoEdicion = !aprobado || editando;
  const puedeEditar = (usuario?.rol === 'admin' || usuario?.rol === 'operativo') && modoEdicion;

  useEffect(() => {
    if (!usuario || !proyecto) return;
    (async () => {
      const s = crearClienteSupabase();
      const [{ data: contrato }, { data: items }, { data: cortes }, { data: anticipos }, { data: ant }, { data: pres }] = await Promise.all([
        s.from('contratos').select('*, proveedores:contratista_id(nombre)').eq('id', contratoId).single(),
        s.from('contrato_items').select('*').eq('contrato_id', contratoId).order('orden'),
        s.from('cortes').select('*, ordenes_compra(folio), corte_items(*)').eq('contrato_id', contratoId).eq('estado', 'APROBADO').order('numero'),
        s.from('v_ordenes_compra_calculadas').select('id, folio, fecha, total').eq('contrato_id', contratoId).eq('tipo_pago', 'ANTICIPO').neq('estado', 'ANULADA').order('fecha'),
        s.rpc('anticipo_contrato', { p_contrato: contratoId }),
        s.from('presupuestos').select('id').eq('proyecto_id', proyecto.id).maybeSingle(),
      ]);
      let capitulos = [];
      if (pres) {
        const { data: caps } = await s.from('presupuesto_capitulos').select('id, codigo, nombre').eq('presupuesto_id', pres.id).order('orden');
        capitulos = caps || [];
      }
      const base = { contrato, items: items || [], cortes: cortes || [], anticipos: anticipos || [], anticipo: ant || {}, capitulos };

      if (esNuevo) {
        const { data: todos } = await s.from('cortes').select('numero').eq('contrato_id', contratoId).order('numero', { ascending: false }).limit(1);
        const ultimo = (cortes || []).slice(-1)[0];
        // Saldos residuales de redondeo (menos de $100) no se proponen para amortizar.
        const saldoAnt = num(ant?.saldo) >= 100 ? num(ant?.saldo) : 0;
        const pctProp = saldoAnt > 0 && num(contrato?.valor_inicial) > 0 ? r2((num(ant.valor) / num(contrato.valor_inicial)) * 100) : 0;
        setForm((f) => ({
          ...f,
          numero: (todos?.[0]?.numero || 0) + 1,
          pctRetencion: String(ultimo ? num(ultimo.porcentaje_retencion) : 0),
          tipo_amortizacion: saldoAnt > 0 ? 'PORCENTAJE' : 'NINGUNA',
          porcentaje_amortizacion: saldoAnt > 0 ? String(pctProp) : '',
        }));
      } else {
        const [{ data: c }, { data: ci }] = await Promise.all([
          s.from('cortes').select('*, ordenes_compra(folio)').eq('id', corteId).single(),
          s.from('corte_items').select('*').eq('corte_id', corteId).order('orden'),
        ]);
        setCorte(c);
        setItemsCorte(ci || []);
        setForm({
          numero: c.numero, fecha: c.fecha, pctRetencion: String(num(c.porcentaje_retencion)),
          tipo_amortizacion: c.tipo_amortizacion, porcentaje_amortizacion: String(c.porcentaje_amortizacion || ''),
          valor_amortizacion_fijo: String(c.valor_amortizacion_fijo || ''), notas: c.notas || '',
        });
        if (c.estado === 'BORRADOR') {
          const cant = {}; const nv = [];
          const vv = {};
          (ci || []).forEach((x, k) => {
            if (x.contrato_item_id) { cant[x.contrato_item_id] = String(x.cantidad); vv[x.contrato_item_id] = String(x.valor_unitario); }
            else nv.push({ tmpId: k + 1, descripcion: x.descripcion, unidad: x.unidad || '', valor_unitario: String(x.valor_unitario), capitulo_id: x.capitulo_id || '', cantidad: String(x.cantidad) });
          });
          setCantidades(cant); setNuevos(nv); setVus(vv);
        }
      }
      setD(base);
    })();
  }, [usuario, proyecto, contratoId, corteId]); // eslint-disable-line

  if (cargando || cargandoProyecto || !usuario || !proyecto) return null;

  const ultimoAprobado = d ? Math.max(0, ...d.cortes.map((k) => k.numero)) : 0;
  const puedeEditarAprobado = aprobado && (esAdmin || (usuario.rol === 'operativo' && corte.numero === ultimoAprobado));

  function iniciarEdicion() {
    const cant = {}; const nv = [];
    const vv = {};
    itemsCorte.forEach((x, k) => {
      if (x.contrato_item_id) { cant[x.contrato_item_id] = String(x.cantidad); vv[x.contrato_item_id] = String(x.valor_unitario); }
      else nv.push({ tmpId: k + 1, descripcion: x.descripcion, unidad: x.unidad || '', valor_unitario: String(x.valor_unitario), capitulo_id: x.capitulo_id || '', cantidad: String(x.cantidad) });
    });
    setCantidades(cant); setNuevos(nv); setVus(vv); setActualizarOC(!!corte.oc_id); setError(''); setEditando(true);
  }

  async function guardarEdicion() {
    if (!window.confirm(`¿Guardar los cambios del corte No. ${corte.numero}?${actualizarOC && corte.oc_id ? `\n\nTambién se actualizará la ${corte.ordenes_compra?.folio} con las nuevas cantidades y valores.` : corte.oc_id ? '\n\nLa OC NO se actualizará y el corte quedará marcado como "OC desactualizada".' : ''}`)) return;
    setGuardando(true);
    try {
      await guardar();
      const { data, error: e } = await crearClienteSupabase().rpc('actualizar_corte', { p_corte: corte.id, p_actualizar_oc: actualizarOC });
      if (e) throw e;
      window.alert(`Corte No. ${corte.numero} actualizado. TOTAL PAGO ${formatoPesos(data.neto)}${data.oc_actualizada ? ` · ${data.oc} actualizada` : ''}.`);
      window.location.reload();
    } catch (e) { setError(e.message); }
    setGuardando(false);
  }

  // ---------- Cálculos (mismo modelo de la sábana) ----------
  let m = null; let amort = 0; let excedidos = [];
  if (d && modoEdicion) {
    const cortesPrevios = aprobado ? d.cortes.filter((k) => k.id !== corte.id) : d.cortes.filter((k) => k.numero < Number(form.numero));
    const edicionBase = {
      numero: form.numero, fecha: form.fecha, cantidades, vus, nuevos, pctRetencion: form.pctRetencion, amortizacion: 0,
      descuento: aprobado ? Number(corte.descuento || 0) : 0, titulo: aprobado ? 'EDITANDO' : 'NUEVO',
    };
    const m0 = construirSabana({ items: d.items, cortes: cortesPrevios, anticipos: d.anticipos, edicion: edicionBase, valorContrato: d.contrato.valor_inicial });
    const total = m0.columnas.find((c) => c.editable).total;
    // Al editar un corte aprobado, su propia amortización vuelve a estar disponible.
    const saldo = Math.max(num(d.anticipo.saldo), 0) + (aprobado ? num(corte.valor_amortizacion) : 0);
    amort = form.tipo_amortizacion === 'PORCENTAJE' ? r2(total * num(form.porcentaje_amortizacion) / 100)
      : form.tipo_amortizacion === 'SALDO' ? saldo
      : form.tipo_amortizacion === 'VALOR_FIJO' ? num(form.valor_amortizacion_fijo) : 0;
    amort = Math.min(Math.max(amort, 0), saldo, total);
    m = construirSabana({ items: d.items, cortes: cortesPrevios, anticipos: d.anticipos, edicion: { ...edicionBase, amortizacion: amort }, valorContrato: d.contrato.valor_inicial });
    const colEd = m.columnas.find((c) => c.editable);
    excedidos = m.todos.filter((i) => m.excede(i) && colEd.cantidad(i.id) > 0);
  } else if (d) {
    m = construirSabana({ items: d.items, cortes: d.cortes, anticipos: d.anticipos, valorContrato: d.contrato.valor_inicial });
  }
  const colEdicion = m && modoEdicion ? m.columnas.find((c) => c.editable) : null;

  async function guardar() {
    setError('');
    if (!colEdicion || colEdicion.total <= 0) throw new Error('El corte no tiene cantidades.');
    const s = crearClienteSupabase();
    const cabecera = {
      contrato_id: contratoId, numero: Number(form.numero), fecha: form.fecha,
      porcentaje_retencion: num(form.pctRetencion), tipo_amortizacion: form.tipo_amortizacion,
      porcentaje_amortizacion: num(form.porcentaje_amortizacion), valor_amortizacion_fijo: num(form.valor_amortizacion_fijo),
      notas: form.notas.trim() || null,
    };
    let idCorte = corte?.id;
    if (!idCorte) {
      const { data, error: e } = await s.from('cortes').insert({ ...cabecera, creado_por: usuario.id }).select().single();
      if (e) throw new Error(e.message.includes('duplicate') ? `Ya existe el corte No. ${form.numero} en este contrato.` : e.message);
      idCorte = data.id; setCorte(data);
    } else {
      const { error: e } = await s.from('cortes').update(cabecera).eq('id', idCorte);
      if (e) throw e;
    }
    await s.from('corte_items').delete().eq('corte_id', idCorte);
    const filas = [
      ...d.items.filter((i) => num(cantidades[i.id]) !== 0).map((i) => ({
        corte_id: idCorte, contrato_item_id: i.id, descripcion: (i.codigo ? `${i.codigo} · ` : '') + i.descripcion, unidad: i.unidad,
        cantidad: num(cantidades[i.id]), valor_unitario: colEdicion.vu(i.id), presupuesto_item_id: i.presupuesto_item_id, capitulo_id: i.capitulo_id,
        orden: i.orden + (i.es_adicional ? 1000 : 0),
      })),
      ...nuevos.filter((x) => num(x.cantidad) !== 0).map((x, k) => ({
        corte_id: idCorte, contrato_item_id: null, descripcion: x.descripcion.trim(), unidad: x.unidad || null,
        cantidad: num(x.cantidad), valor_unitario: num(x.valor_unitario), capitulo_id: x.capitulo_id, orden: 5000 + k,
      })),
    ];
    if (filas.length) { const { error: e } = await s.from('corte_items').insert(filas); if (e) throw e; }
    return idCorte;
  }

  async function guardarBorrador() {
    setGuardando(true);
    try { const idC = await guardar(); if (esNuevo) router.replace(`/contratos/${contratoId}/cortes/${idC}`); }
    catch (e) { setError(e.message); }
    setGuardando(false);
  }

  async function aprobar() {
    const sinCant = nuevos.filter((x) => !num(x.cantidad));
    if (sinCant.length) { setError(`Hay ${sinCant.length} adicional(es) nuevo(s) sin cantidad en este corte.`); return; }
    const aviso = excedidos.length ? `\n\n⚠️ ${excedidos.length} ítem(s) superan la cantidad contratada.` : '';
    if (!window.confirm(`¿Aprobar el corte No. ${form.numero} y generar la Orden de Compra?\n\nTOTAL CORTE ${formatoPesos(colEdicion.total)}\n(-) Retenido ${formatoPesos(colEdicion.retencion)}\n(-) Amortización ${formatoPesos(colEdicion.amortizacion)}\nTOTAL PAGO ${formatoPesos(colEdicion.neto)}${aviso}`)) return;
    setGuardando(true);
    try {
      const idC = await guardar();
      const { data, error: e } = await crearClienteSupabase().rpc('aprobar_corte', { p_corte: idC });
      if (e) throw e;
      window.alert(`Corte aprobado. Se generó la ${data.folio} por ${formatoPesos(data.neto)}.`);
      router.push(`/contratos/${contratoId}/cortes`);
    } catch (e) { setError(e.message); }
    setGuardando(false);
  }

  async function eliminarBorrador() {
    if (!corte || !window.confirm('¿Eliminar este borrador de corte?')) return;
    await crearClienteSupabase().from('cortes').delete().eq('id', corte.id);
    router.push(`/contratos/${contratoId}`);
  }

  const edicion = modoEdicion && d ? {
    puedeEditar, cantidades, nuevos, capitulos: d.capitulos,
    pctRetencionTexto: form.pctRetencion,
    onPctRetencion: (v) => setForm({ ...form, pctRetencion: v }),
    onCantidad: (itemId, v) => setCantidades({ ...cantidades, [itemId]: v }),
    vus, onVU: (itemId, v) => setVus({ ...vus, [itemId]: v }),
    onCantidadNuevo: (tmpId, v) => setNuevos(nuevos.map((x) => (x.tmpId === tmpId ? { ...x, cantidad: v } : x))),
    onAgregarNuevo: (x) => setNuevos([...nuevos, x]),
    onQuitarNuevo: (tmpId) => setNuevos(nuevos.filter((x) => x.tmpId !== tmpId)),
  } : null;

  return (
    <div>
      <NavBar usuario={usuario} proyecto={proyecto} />
      <main className="p-4 sm:p-6 space-y-4">
        <Link href={`/contratos/${contratoId}/cortes`} className="text-sm text-neutral-500">← Volver a los cortes del contrato</Link>
        {!d ? <p className="text-sm text-neutral-500">Cargando…</p> : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">{editando ? `Editando corte de obra No. ${corte.numero}` : aprobado ? `Corte de obra No. ${corte.numero}` : `Nuevo corte de obra No. ${form.numero}`}</h1>
                <p className="text-sm text-neutral-500">Contrato {d.contrato.numero_contrato} · {d.contrato.proveedores?.nombre} · {d.contrato.concepto}</p>
              </div>
              {aprobado && !editando ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-green-700">Aprobado · {corte.ordenes_compra?.folio || 'sin OC'}</span>
                  {corte.oc_desactualizada && <span className="text-xs bg-amber-100 text-amber-800 rounded px-2 py-1">⚠️ La OC no refleja la última edición del corte</span>}
                  {puedeEditarAprobado && !editando && <button onClick={iniciarEdicion} className="bg-carbon text-hueso px-4 py-2 rounded text-sm">Editar corte</button>}
                  {aprobado && !puedeEditarAprobado && usuario.rol === 'operativo' && <span className="text-xs text-neutral-500">Solo un administrador puede editar cortes anteriores al último.</span>}
                  <button onClick={() => compartirOAbrirArchivo(`/api/cortes/${corte.id}/pdf`, `Corte ${corte.numero} ${d.contrato.numero_contrato}.pdf`)} className="border border-dorado text-dorado px-4 py-2 rounded text-sm">Descargar corte (PDF)</button>
                </div>
              ) : (
                <div className="flex items-end gap-3 text-sm">
                  <label className="space-y-1"><span className="block text-xs text-neutral-500">Fecha del corte</span>
                    <input type="date" disabled={!puedeEditar} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={CAMPO} /></label>
                  <label className="space-y-1"><span className="block text-xs text-neutral-500">No.</span>
                    <input type="number" disabled={!puedeEditar || aprobado} value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} className={`${CAMPO} w-16`} /></label>
                </div>
              )}
            </div>

            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{error}</p>}

            <SabanaCortes m={m} contrato={d.contrato} edicion={edicion}
              onPdf={(c) => compartirOAbrirArchivo(`/api/cortes/${c.id}/pdf`, `Corte ${c.numero} ${d.contrato.numero_contrato}.pdf`)} />

            {modoEdicion && (
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg border p-4 space-y-2 text-sm">
                  <h2 className="font-medium">Amortización del anticipo</h2>
                  <p className="text-xs text-neutral-500">{d.anticipo.folio ? `${d.anticipo.folio} · ${formatoPesos(d.anticipo.valor)} · por amortizar ${formatoPesos(d.anticipo.saldo)}` : 'Este contrato no tiene anticipo.'}</p>
                  <select disabled={!puedeEditar || !d.anticipo.folio} value={form.tipo_amortizacion} onChange={(e) => setForm({ ...form, tipo_amortizacion: e.target.value })} className={`${CAMPO} w-full`}>
                    <option value="NINGUNA">No amortizar</option>
                    <option value="PORCENTAJE">% del corte</option>
                    <option value="SALDO">Saldo completo del anticipo</option>
                    <option value="VALOR_FIJO">Valor fijo</option>
                  </select>
                  {form.tipo_amortizacion === 'PORCENTAJE' && <input type="number" step="any" disabled={!puedeEditar} value={form.porcentaje_amortizacion} onChange={(e) => setForm({ ...form, porcentaje_amortizacion: e.target.value })} placeholder="% a amortizar" className={`${CAMPO} w-full`} />}
                  {form.tipo_amortizacion === 'VALOR_FIJO' && <input type="number" disabled={!puedeEditar} value={form.valor_amortizacion_fijo} onChange={(e) => setForm({ ...form, valor_amortizacion_fijo: e.target.value })} placeholder="Valor a amortizar" className={`${CAMPO} w-full`} />}
                </div>
                <div className="bg-white rounded-lg border p-4 space-y-2 text-sm">
                  <h2 className="font-medium">Notas del corte</h2>
                  <textarea disabled={!puedeEditar} rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} className={`${CAMPO} w-full`} placeholder="Observaciones (opcional)" />
                  {excedidos.length > 0 && <p className="text-xs text-red-700">⚠️ {excedidos.length} ítem(s) superan la cantidad contratada: verifica la medición o formaliza un otrosí.</p>}
                </div>
                <div className="bg-carbon text-hueso rounded-lg p-4 text-sm space-y-1.5">
                  <div className="flex justify-between"><span>TOTAL CORTE {form.numero}</span><span>{formatoPesos(colEdicion.total)}</span></div>
                  <div className="flex justify-between"><span>(-) Retenido {num(form.pctRetencion)}%</span><span>{formatoPesos(colEdicion.retencion)}</span></div>
                  <div className="flex justify-between"><span>(-) Amortización anticipo</span><span>{formatoPesos(colEdicion.amortizacion)}</span></div>
                  <div className="flex justify-between text-lg font-semibold border-t border-dorado pt-2 text-[#e6c89c]"><span>TOTAL PAGO</span><span>{formatoPesos(colEdicion.neto)}</span></div>
                  {editando && (
                    <div className="pt-3 space-y-2">
                      {corte.oc_id && (
                        <label className="flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={actualizarOC} onChange={(e) => setActualizarOC(e.target.checked)} />
                          Actualizar también la {corte.ordenes_compra?.folio} ligada a este corte
                        </label>
                      )}
                      <div className="flex gap-2">
                        <button disabled={guardando} onClick={guardarEdicion} className="bg-dorado text-carbon font-semibold px-3 py-1.5 rounded text-xs">{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
                        <button disabled={guardando} onClick={() => { setEditando(false); setError(''); }} className="border border-hueso px-3 py-1.5 rounded text-xs">Cancelar</button>
                      </div>
                    </div>
                  )}
                  {puedeEditar && !editando && (
                    <div className="flex flex-wrap gap-2 pt-3">
                      <button disabled={guardando} onClick={guardarBorrador} className="border border-hueso px-3 py-1.5 rounded text-xs">{guardando ? 'Guardando…' : 'Guardar borrador'}</button>
                      {esAdmin && <button disabled={guardando} onClick={aprobar} className="bg-dorado text-carbon font-semibold px-3 py-1.5 rounded text-xs">Aprobar y generar OC</button>}
                      {corte && <button disabled={guardando} onClick={eliminarBorrador} className="text-xs underline text-gris-calido ml-auto">Eliminar borrador</button>}
                    </div>
                  )}
                  {puedeEditar && !esAdmin && <p className="text-[11px] text-gris-calido">Queda en borrador hasta que un administrador lo apruebe.</p>}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
